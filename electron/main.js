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
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loadRenderer(floatWin, "floating");
  floatWin.on("blur", () => floatWin.hide());
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
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loadRenderer(settingsWin, "settings");
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
  ipcMain.handle(IPC.TRANSLATE, async (_e, text) => {
    const res = await translate(text, { apiSetting: getConfig().engine });
    return res;
  });
  ipcMain.on(IPC.OPEN_SETTINGS, () => openSettings());
}

app.whenReady().then(() => {
  createFloatWindow();
  createSettingsWindow();
  createTray();
  registerIpc();
  startCapture(onCaptured);
  startClipboardWatch();
});

app.on("window-all-closed", (e) => {
  // 后台翻译工具：关闭所有窗口不退出，仅托盘驻留。
  e.preventDefault();
});

app.on("before-quit", () => {
  stopCapture();
});
