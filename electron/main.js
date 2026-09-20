// Electron 主进程：无边框置顶浮窗 + 设置窗 + 系统托盘 + 全局热键取词 + IPC。
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  screen,
  clipboard,
} from "electron";
import * as path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { startCapture, stopCapture } from "./capture.js";
import { getConfig, saveConfig } from "./store.js";
import { translate } from "../src/engine/index.js";
import { IPC } from "./ipc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 开发模式：npm run dev 时传 --dev，走 Vite 开发服务器（5173，热更新）。
// 也支持显式指定 VITE_DEV_SERVER_URL。
const isDev = process.argv.includes("--dev");
const DEV_URL =
  process.env.VITE_DEV_SERVER_URL || (isDev ? "http://localhost:5173" : "");

function rendererUrl(view) {
  if (DEV_URL) return `${DEV_URL}?view=${view}`;
  return `file://${path.join(__dirname, "../dist/renderer/index.html")}?view=${view}`;
}

// 开发模式下 Vite 可能尚未就绪，连不上就重试（最多约 15 秒）。
async function loadRenderer(win, view) {
  const url = rendererUrl(view);
  if (!url.startsWith("http")) return win.loadURL(url);
  for (let i = 0; i < 30; i++) {
    try {
      return await win.loadURL(url);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return win.loadURL(url);
}

let floatWin = null;
let settingsWin = null;
let tray = null;
let lastClipboard = "";

function createFloatWindow() {
  floatWin = new BrowserWindow({
    width: 380,
    height: 220,
    minWidth: 240,
    minHeight: 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: {
      // 注意：必须是 .cjs（沙箱化 preload 不能写 import，见 preload.cjs 顶部说明）
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loadRenderer(floatWin, "floating");
  floatWin.on("blur", () => floatWin.hide());
  // 浮窗被关闭（点 X / window.close）后置空引用，下次取词会自动重建，
  // 否则后续对已销毁窗口调用 getBounds()/show() 会抛错。
  floatWin.on("closed", () => {
    floatWin = null;
  });
}

function createSettingsWindow() {
  settingsWin = new BrowserWindow({
    width: 760,
    height: 600,
    minWidth: 560,
    minHeight: 420,
    frame: true,
    show: false,
    webPreferences: {
      // 注意：必须是 .cjs（沙箱化 preload 不能写 import，见 preload.cjs 顶部说明）
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loadRenderer(settingsWin, "settings");
  settingsWin.on("closed", () => {
    settingsWin = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "../assets/tray.png");
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("kiss-desktop 划词翻译");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "设置", click: () => openSettings() },
      { type: "separator" },
      { label: "退出", click: () => app.quit() },
    ])
  );
  tray.on("click", () => openSettings());
}

function openSettings() {
  if (!settingsWin) createSettingsWindow();
  settingsWin.show();
  settingsWin.focus();
}

function positionFloatWindow() {
  if (!floatWin) return;
  const { x, y } = screen.getCursorScreenPoint();
  const { width, height } = floatWin.getBounds();
  floatWin.setBounds({ x: x + 12, y: y + 12, width, height });
}

// 命中热键并取到文字后：翻译 → 显示浮窗。
function onCaptured(text) {
  if (!floatWin) createFloatWindow();
  positionFloatWindow();
  floatWin.show();
  floatWin.webContents.send(IPC.TRANSLATION, { text, loading: true });
  translate(text, { apiSetting: getConfig().engine })
    .then((res) =>
      floatWin.webContents.send(IPC.TRANSLATION, {
        text,
        result: res.text,
        from: res.from,
      })
    )
    .catch((err) =>
      floatWin.webContents.send(IPC.TRANSLATION, {
        text,
        error: err.message || String(err),
      })
    );
}

// 复制即翻译模式：轮询剪贴板变化。
function startClipboardWatch() {
  lastClipboard = "";
  const timer = setInterval(() => {
    if (!getConfig().copyToTranslate) return;
    let cur = "";
    try {
      cur = clipboard.readText();
    } catch {
      return;
    }
    if (cur && cur !== lastClipboard) {
      lastClipboard = cur;
      onCaptured(cur.trim());
    }
  }, 600);
  app.on("before-quit", () => clearInterval(timer));
}

function registerIpc() {
  ipcMain.handle(IPC.GET_CONFIG, () => getConfig());
  ipcMain.handle(IPC.SAVE_CONFIG, (_e, cfg) => {
    const next = saveConfig(cfg);
    return next;
  });
  // engineOverride 让设置页用「当前表单值」直接测试，而不必先保存。
  ipcMain.handle(IPC.TRANSLATE, async (_e, text, engineOverride) => {
    const base = getConfig().engine;
    const apiSetting = engineOverride ? { ...base, ...engineOverride } : base;
    return await translate(text, { apiSetting });
  });
  ipcMain.on(IPC.OPEN_SETTINGS, () => openSettings());
}

app.whenReady().then(() => {
  // 托盘驱动的后台翻译工具，不需要 Electron 默认菜单栏（File/Edit/View/Window）。
  Menu.setApplicationMenu(null);

  createFloatWindow();
  createSettingsWindow();
  createTray();
  registerIpc();
  startCapture(onCaptured);
  startClipboardWatch();
});

// 菜单已移除，保留 F12 作为开发者工具的唯一入口，便于排查问题。
app.on("browser-window-created", (_e, win) => {
  win.webContents.on("before-input-event", (_ev, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      win.webContents.toggleDevTools();
    }
  });
});

app.on("window-all-closed", (e) => {
  // 后台翻译工具：关闭所有窗口不退出，仅托盘驻留。
  e.preventDefault();
});

app.on("before-quit", () => {
  stopCapture();
});
