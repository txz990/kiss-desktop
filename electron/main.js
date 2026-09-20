// Electron 主进程：无边框置顶浮窗 + 设置窗 + 系统托盘 + 全局热键取词 + IPC。
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  screen,
} from "electron";
import * as path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { startCapture, stopCapture, setHotkey, getCurrentHotkey, isCaptureStarted } from "./capture.js";
// Electron 44 起 clipboard 全部异步（readText() 返回 Promise），统一走适配层，
// 不要再直接用 clipboard.readText() —— 会把 Promise 当字符串用而崩溃。
import { readClipboardText } from "./cliptext.js";
import { getConfig, saveConfig } from "./store.js";
import { translate } from "../src/engine/index.js";
import { ENGINES, ENGINE_GROUPS } from "./engines.js";
import { buildTrayIconPng } from "./tray-icon.js";
import { checkHotkeyConflict, describeHotkey, getKeyList, normalizeHotkey } from "./hotkey.js";
import { lookupWord } from "./dict.js";
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

// 托盘图标：优先用 assets/tray.png（方便用户自行换图标），没有就在内存里生成。
// ⚠️ 绝不能再退回 nativeImage.createEmpty()：空图标在 Windows 下不可见也不可点，
//    而托盘是打开设置页的入口，等于整个应用没法配置（浮窗上的设置按钮是第二入口）。
export function loadTrayImage() {
  const iconPath = path.join(__dirname, "../assets/tray.png");
  if (existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img;
  }
  return nativeImage.createFromBuffer(buildTrayIconPng());
}

function createTray() {
  tray = new Tray(loadTrayImage());
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
  // 轮询体现在是 async 的（Electron 44 的 readText 返回 Promise），
  // 700ms 的间隔配 await 有可能重入，加个 busy 闸门，避免同一次复制被处理两遍。
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    if (!getConfig().copyToTranslate) return;
    busy = true;
    try {
      const cur = await readClipboardText();
      if (cur && cur !== lastClipboard) {
        lastClipboard = cur;
        onCaptured(cur.trim());
      }
    } finally {
      busy = false;
    }
  }, 600);
  app.on("before-quit", () => clearInterval(timer));
}

function registerIpc() {
  ipcMain.handle(IPC.GET_CONFIG, () => getConfig());
  // 可选引擎清单（含中文名/分组/是否需要 Key/内置默认值），供设置页渲染下拉。
  ipcMain.handle(IPC.ENGINES, () => ({ groups: ENGINE_GROUPS, engines: ENGINES }));
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

  // ── 热键 ──────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.HOTKEY_KEYS, () => getKeyList());
  // 检测分两层：先校验格式（必须带修饰键、键位可识别），
  // 再用 RegisterHotKey 探针查是否已被别的程序/系统占用。
  ipcMain.handle(IPC.HOTKEY_CHECK, (_e, hotkey) => checkHotkeyConflict(hotkey));
  ipcMain.handle(IPC.HOTKEY_APPLY, (_e, hotkey) => {
    const hk = normalizeHotkey(hotkey);
    const verdict = checkHotkeyConflict(hk);
    if (!verdict.ok) return { ok: false, reason: verdict.reason, level: verdict.level };
    saveConfig({ hotkey: hk });
    // 热更新：内存里换掉即可，钩子不用重装、程序不用重启
    setHotkey(hk);
    return { ok: true, hotkey: hk, label: describeHotkey(hk), reason: verdict.reason };
  });
  ipcMain.handle(IPC.CAPTURE_STATUS, () => ({
    started: isCaptureStarted(),
    hotkey: getCurrentHotkey(),
    label: describeHotkey(getCurrentHotkey() || {}),
  }));
  // 暂停/恢复取词。设置页进入热键录制时先暂停，避免按下当前热键真的触发翻译并抢焦点。
  ipcMain.handle(IPC.CAPTURE_SET, (_e, enabled) => {
    if (enabled) {
      if (!isCaptureStarted()) startCapture(onCaptured);
    } else {
      stopCapture();
    }
    return { started: isCaptureStarted() };
  });

  // ── 词典（音标 / 释义 / 发音音频）──────────────────────────────────────────
  // 查不到就返回 null，由渲染进程降级到系统 TTS，不要让异常冒到 UI。
  ipcMain.handle(IPC.DICT_LOOKUP, async (_e, text) => {
    try {
      return await lookupWord(text);
    } catch (err) {
      console.error("[dict] lookup failed:", err?.message || err);
      return null;
    }
  });
}

app.whenReady().then(() => {
  // 托盘驱动的后台翻译工具，不需要 Electron 默认菜单栏（File/Edit/View/Window）。
  Menu.setApplicationMenu(null);

  // ⚠️ 每一步单独兜住异常：之前 startCapture 抛错（uiohook 导入写法不对）
  //    直接把后面的 startClipboardWatch 一起带崩了，两个功能同时消失且毫无提示。
  //    现在任何一步失败都只影响自己，并被明确记录。
  const steps = [
    ["浮窗", createFloatWindow],
    ["设置窗", createSettingsWindow],
    ["托盘", createTray],
    ["IPC", registerIpc],
    ["剪贴板监听", startClipboardWatch],
  ];
  for (const [name, fn] of steps) {
    try {
      fn();
    } catch (err) {
      console.error(`[boot] ${name} 初始化失败:`, err?.message || err);
    }
  }

  // 取词放最后：它会挂全局键盘钩子，且失败信息对用户最有价值
  const result = startCapture(onCaptured);
  if (result.ok) {
    console.log(`[boot] 取词已就绪，热键 ${describeHotkey(getConfig().hotkey)}`);
  } else {
    console.error("[boot] 取词启动失败：", result.error);
  }
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
