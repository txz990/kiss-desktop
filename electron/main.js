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
import { existsSync, readFileSync, writeFileSync } from "fs";
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

// ── 浮窗事件日志：排查「窗口开了两回 / 闪一下」这类**时序**问题的硬证据 ─────────
// 控制台日志在打包后看不见，所以落到 userData/float-events.log（只保留最后 400 行）。
// 用户复现一次，这个文件里就是每一次 创建/取词/show/hide/blur 的精确时刻，
// 谁先谁后、隔了多少毫秒一目了然 —— 不用再靠猜。
let floatLogPath = "";
function floatLog(msg) {
  try {
    if (!floatLogPath) {
      floatLogPath = path.join(app.getPath("userData"), "float-events.log");
    }
    let content = "";
    try {
      content = readFileSync(floatLogPath, "utf8");
    } catch {
      /* 首次还没有这个文件 */
    }
    const stamp = new Date().toISOString().slice(11, 23);
    const lines = content ? content.split("\n") : [];
    lines.push(`${stamp} ${msg}`);
    writeFileSync(floatLogPath, lines.slice(-400).join("\n"), "utf8");
  } catch {
    /* 日志失败绝不能影响功能 */
  }
}

let floatWin = null;
let settingsWin = null;
let tray = null;
let lastClipboard = "";
// 浮窗最近一次显示的时间：用来忽略"刚显示就被判定失焦"的抖动
let floatShownAt = 0;
// 浮窗渲染进程是否已挂上 onTranslation 监听（收到过 FLOATING_READY）。
// 新建窗口 / 渲染进程重载后必须复位，否则会往没准备好的渲染进程推消息 → 消息丢失 → 浮窗空白。
let floatReady = false;
// 两个回执（见 FloatingCard 的 ackTranslationPainted）：
//   dom     —— 内容已提交到 DOM（flushSync 之后）
//   painted —— Chromium 已真正画出一帧（双 rAF 之后）
let floatDomResolve = null;
let floatRenderResolve = null;

// 快引擎（有道免费实测 ~150ms）直接把结果等出来再显示，窗口一次到位、零闪烁；
// 超过这个时间还没结果（本地大模型、慢接口）就先亮"翻译中"，让用户有反馈。
const FAST_RESULT_MS = 350;

function createFloatWindow() {
  floatLog("浮窗创建");
  floatWin = new BrowserWindow({
    width: 380,
    height: 150, // 初值；渲染进程挂载后按卡片自然高度自动校正（FLOAT_RESIZE）
    // ⚠️ 不再透明（用户反复看到"幽灵卡"后拍板的：直接消灭，不保留）。
    // 透明 = Windows 分层窗口 alpha 合成，show 的头几帧 Chromium 逐层光栅化，
    // 会先亮出"只有文字没有背景"的半成品 —— opaque 窗口从物理上不存在这一类问题。
    // 视觉无缝靠：窗口白底 + 窗口高度自适应卡片内容（FLOAT_RESIZE）。
    transparent: false,
    backgroundColor: "#FFFFFF",
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // 高度随内容自适应后，手动拉伸已无意义，且会和自动校正打架
    resizable: false,
    show: false,
    webPreferences: {
      // 注意：必须是 .cjs（沙箱化 preload 不能写 import，见 preload.cjs 顶部说明）
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 渲染进程开始加载 → 之前的"已就绪"作废，等 FloatingCard 重新报名
  floatWin.webContents.on("did-start-loading", () => {
    floatReady = false;
  });
  loadRenderer(floatWin, "floating");
  // 失焦即隐藏（点别处就收起）。但**必须挡住刚显示时的抖动**：
  // 取词后我们 show() 浮窗，若 Windows 因前台锁没把焦点给它，
  // 会立刻触发一次 blur → 浮窗刚出现就消失，用户以为"划词没反应"。
  // 所以显示后 350ms 内的 blur 一律忽略。
  floatWin.on("blur", () => {
    const since = Date.now() - floatShownAt;
    const ignored = since < 350;
    floatLog(`blur（距上次显示 ${since}ms）→ ${ignored ? "忽略" : "隐藏浮窗"}`);
    if (ignored) return;
    floatWin.hide();
  });
  // 浮窗被关闭（点 X / window.close）后置空引用，下次取词会自动重建，
  // 否则后续对已销毁窗口调用 getBounds()/show() 会抛错。
  floatWin.on("closed", () => {
    floatLog("浮窗销毁（closed）");
    floatWin = null;
    floatReady = false;
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

// ⚠️ 实测（Electron 44 / Windows）：`resizable: false` 的窗口一旦 setBounds/setPosition，
// isAlwaysOnTop() 会变成 false（Electron 重设几何时把 WS_EX_TOPMOST 弄丢了），
// 浮窗就会被别的窗口盖住。所以凡是动过浮窗几何，都必须立刻把置顶补回来。
function floatKeepOnTop() {
  if (floatWin && !floatWin.isDestroyed() && !floatWin.isAlwaysOnTop()) {
    floatWin.setAlwaysOnTop(true);
  }
}

// 浮窗定位：**只挪位置，绝不回写尺寸**。
//
// 坑（抓帧实测）：以前写的是 setBounds({...getBounds()})，把读回来的尺寸原样写回去。
// 在 150% DPI 下这个"读-写"往返每次都会被系统向上取整 1px，窗口一轮长一像素
// （实测高度 220 → 221 → 222 → 223），而且每次都触发一次 resize → 整窗重新合成，
// 是"闪一下"的帮凶。改用 setPosition 后两个问题一起消失。
// 顺手夹到光标所在屏幕的工作区内，避免贴边时半个浮窗跑到屏幕外。
function positionFloatWindow() {
  if (!floatWin || floatWin.isDestroyed()) return;
  const { x, y } = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint({ x, y });
  const [w, h] = floatWin.getSize();
  const px = Math.round(
    Math.min(Math.max(x + 12, workArea.x), workArea.x + workArea.width - w)
  );
  const py = Math.round(
    Math.min(Math.max(y + 12, workArea.y), workArea.y + workArea.height - h)
  );
  floatWin.setPosition(px, py);
  floatKeepOnTop(); // setPosition 会弄丢 WS_EX_TOPMOST，立刻补回
}

// ── 开机自启动 ──────────────────────────────────────────────────────────────
// 用当前用户的注册表 Run 键（app.setLoginItemSettings），不需要管理员权限。
// 显式传 process.execPath：NSIS 装出来的是安装目录里的 exe，portable 则是运行中的
// exe —— 都能对上；exe 挪位置后下次启动会重新同步成新路径。
// ⚠️ 开发模式（electron.exe + --dev）绝不能注册，否则开机拉起的是开发环境的 Electron。
function applyAutoLaunch(enabled) {
  if (isDev) return;
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    path: process.execPath,
    args: ["--launched"], // 留个标记，便于区分"开机启动"这次运行
  });
}

/**
 * 拿到一个**渲染进程已就绪**的浮窗（已挂上 onTranslation 监听）。
 *
 * 为什么需要：新建窗口或渲染进程重载后，webContents.send() 会**丢消息**
 * （没人监听），表现就是"浮窗亮出来一片空白"。所以推内容前必须等 FLOATING_READY。
 */
async function ensureFloatWindow() {
  if (floatWin && !floatWin.isDestroyed() && floatReady) return floatWin;
  if (!floatWin || floatWin.isDestroyed()) createFloatWindow();
  const win = floatWin;
  const deadline = Date.now() + 2000;
  while (win && !win.isDestroyed() && !floatReady && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return win;
}

/**
 * 等浮窗渲染进程的某个阶段回执。
 * @param {"dom"|"painted"} stage
 * 带超时兜底 —— 渲染进程万一不回执，也不能让浮窗永远不显示。
 */
function waitFloatStage(stage, timeout) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (stage === "painted") {
        if (floatRenderResolve === finish) floatRenderResolve = null;
      } else if (floatDomResolve === finish) {
        floatDomResolve = null;
      }
      resolve();
    };
    if (stage === "painted") floatRenderResolve = finish;
    else floatDomResolve = finish;
    setTimeout(finish, timeout);
  });
}

/**
 * 命中热键并取到文字后：翻译 → 显示浮窗。
 *
 * ── 这里唯一讲究的是**显示的时机**（踩过的坑，别再改回"先 show 再推内容"）──
 * 旧写法把 `show()` 和 `send(loading)` 挤在同一个 tick：窗口先亮出来，里面装的
 * 还是**上一轮的旧译文**，几十毫秒后才换成新内容。抓帧实证（scripts/e2e-frames）：
 *   show+0ms   → 上一轮的"beta second capture / 秒捕获"
 *   show+40ms  → 塌成"只有原文 + 转圈"
 *   show+160ms → 才是本轮结果"gamma third capture / 第三次捕获"
 * 用户看到的就是「翻译框会闪一下，才正常显示翻译。也就是目视窗口开了 2 回」。
 *
 * 正解：**先把内容推进渲染进程、等它落到 DOM，再 show()**。窗口第一眼就是新内容。
 * 对快引擎（有道免费 ~150ms）干脆连"翻译中"都不显示，一次到位。
 */
async function showAndTranslate(text) {
  floatLog(`取词命中：${String(text).slice(0, 24)}`);
  const win = await ensureFloatWindow();
  if (!win || win.isDestroyed()) return;
  const apiSetting = getConfig().engine;

  const push = async (payload) => {
    if (win.isDestroyed()) return;
    win.webContents.send(IPC.TRANSLATION, payload);
    await waitFloatStage("dom", 150);
    floatLog(`内容已提交到 DOM（${payload.error ? "error" : payload.result ? "result" : "loading"}）`);
  };

  const showFloat = () => {
    if (win.isDestroyed()) return;
    // ⚠️ 浮窗如果**还挂在屏上**（Windows 前台锁拒绝 focus() 时它不会触发 blur、
    //    也就不会被收起），绝不能"原地换内容 + 挪位置"—— 用户会先看到旧译文换新、
    //    再看到窗口跳到新位置，两次视觉变化，观感就是「窗口又弹了一次 / 一闪一下」。
    //    所以先收起来，再按新内容、新位置一次性亮出 —— 用户眼里只有一次弹出。
    const wasVisible = win.isVisible();
    if (wasVisible) {
      floatLog("浮窗此前仍可见 → 先隐藏再重显（避免原地换内容+跳位置被看成两次弹出）");
      win.hide();
    }
    positionFloatWindow(); // 位置先定好再显示，避免"出现之后又跳一下"
    floatShownAt = Date.now();
    // ⚠️ 先全透明地 show，等"真正画出一帧"的回执（双 rAF）再显形。
    // 实拍证据（用户录屏 60fps 逐帧抽帧）：透明窗口 show 的头 8 帧（约 130ms）
    // 是逐层光栅化的 —— 只有文字、没有卡片背景，网页文字直接透过卡片，
    // 然后 58 帧突然变实心。这个"幽灵卡 → 实心卡"就是用户说的「闪一下/弹两回」。
    // 透明期间 rAF 会跑（隐藏时它不跑），所以回执一定能等到；超时兜底直接显形。
    win.setOpacity(0);
    win.show();
    win.focus();
    const showAt = Date.now();
    waitFloatStage("painted", 300).then(() => {
      if (!win.isDestroyed()) {
        win.setOpacity(1);
        floatShownAt = Date.now(); // 失焦抖动保护从"真正显形"这一刻起算
        const waited = Date.now() - showAt;
        // waited≈16~50ms = 正常（等到了双 rAF 回执）；≈300ms = 渲染进程没回执，
        // 走了超时兜底（若用户仍见"幽灵卡"，看这行就能定位是哪条路径）
        floatLog(`首帧回执后显形（等待 ${waited}ms${waited >= 300 ? "，超时兜底" : ""}）`);
      }
    });
  };

  const pending = translate(text, { apiSetting })
    .then((res) => {
      const out = { text, result: res.text, from: res.from };
      // ⚠️ 引擎层对请求失败是**静默吞掉**的：接口 404 / 超时 / 被拒都不抛错，
      //    而是resolve 出 text:""。不在这里补错误提示的话，浮窗会弹出一张
      //    「只有原文、没有译文也没有报错」的空卡片，用户只会觉得"这窗口是坏的"。
      if (!res.text || !String(res.text).trim()) {
        delete out.result;
        out.error = "翻译返回为空（接口无响应或请求被拒）";
      }
      return out;
    })
    .catch((err) => ({ text, error: err?.message || String(err) }));

  let fastTimer = null;
  const fast = await Promise.race([
    pending,
    new Promise((resolve) => {
      fastTimer = setTimeout(() => resolve(null), FAST_RESULT_MS);
    }),
  ]);
  clearTimeout(fastTimer);

  if (fast) {
    // 快：内容就位后再显示 —— 窗口第一次亮出来就是译文，全程只有一次呈现
    floatLog("快引擎路径：结果已就绪，一次性显示");
    await push(fast);
    showFloat();
    return;
  }

  // 慢：先给"翻译中"的反馈，结果到了再更新（此时窗口已可见，只换内容、不再重新定位）
  floatLog(`慢引擎路径：超过 ${FAST_RESULT_MS}ms 仍无结果，先显示"翻译中"`);
  await push({ text, loading: true });
  showFloat();
  await push(await pending);
}

// 对外保持同步签名（取词层、剪贴板监听都直接当回调用），内部异步并自己兜住异常。
function onCaptured(text) {
  showAndTranslate(text).catch((err) => {
    console.error("[float] 显示浮窗失败:", err?.message || err);
  });
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
    // 自启动开关随保存立即生效（写注册表 Run 键）
    if (cfg && cfg.autoLaunch !== undefined) applyAutoLaunch(next.autoLaunch);
    return next;
  });
  // engineOverride 让设置页用「当前表单值」直接测试，而不必先保存。
  ipcMain.handle(IPC.TRANSLATE, async (_e, text, engineOverride) => {
    const base = getConfig().engine;
    const apiSetting = engineOverride ? { ...base, ...engineOverride } : base;
    return await translate(text, { apiSetting });
  });
  ipcMain.on(IPC.OPEN_SETTINGS, () => openSettings());

  // ── 浮窗显示时序（防"闪一下/开了两回"，见 onCaptured 说明）────────────────
  // 渲染进程报名"已就绪" → 才允许推内容
  ipcMain.on(IPC.FLOATING_READY, () => {
    floatReady = true;
  });
  // 渲染进程回执（stage: "dom" = 内容已提交到 DOM；"painted" = 已真正画出一帧）
  ipcMain.on(IPC.TRANSLATION_PAINTED, (_e, stage) => {
    if (stage === "painted") {
      if (floatRenderResolve) floatRenderResolve();
    } else if (floatDomResolve) {
      floatDomResolve();
    }
  });

  // ── 浮窗高度自适应（去透明后的配套）──────────────────────────────────────
  // 渲染进程用 ResizeObserver 量卡片自然高度，窗口跟着长/缩；位置与宽度不动。
  // 只认浮窗自己的 sender，防止别的窗口乱调尺寸。
  ipcMain.on(IPC.FLOAT_RESIZE, (_e, size) => {
    if (!floatWin || floatWin.isDestroyed() || floatWin.webContents !== _e.sender) return;
    const want = Math.round(Number(size?.height) || 0);
    if (want < 60) return;
    const b = floatWin.getBounds();
    const { workArea } = screen.getDisplayNearestPoint({ x: b.x, y: b.y });
    const maxH = Math.max(120, workArea.height - 60);
    const h = Math.min(want, maxH);
    if (Math.abs(h - b.height) < 1) return;
    floatWin.setBounds({ x: b.x, y: b.y, width: b.width, height: h });
    floatKeepOnTop(); // setBounds 会弄丢 WS_EX_TOPMOST，立刻补回
  });

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

// ── 单实例锁 ──────────────────────────────────────────────────────────────────
// 托盘应用极易被重复启动（再点一次 exe / 再跑一次 npm run dev / 旧实例没退干净）。
// 没有这把锁时**两个进程都挂着全局键盘钩子**：按一次热键，两个浮窗一起弹出来 ——
// 用户看到的就是「弹出两次窗口 / 一闪一下」，而且复现环境里永远只有单实例，查不到。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  floatLog("检测到已有实例在运行，本进程退出");
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    // 自动化测试也会触发这里（测试进程与正式实例共用 userData 时）；
    // 带 --e2e 标记的启动不打扰用户，只记录。
    if (argv && argv.includes("--e2e")) {
      floatLog("second-instance：e2e 测试进程尝试启动，已忽略");
      return;
    }
    floatLog("second-instance：又有人启动了一个实例，已聚焦到本实例的设置窗");
    openSettings();
  });

  app.whenReady().then(() => {
    floatLog("应用启动");
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

  // 自启动路径自愈：exe 挪过位置/改过名的话，注册表里还是旧路径。
  // 每次启动按已保存的开关重写一次，保证指向当前 exe（开发模式跳过）。
  try {
    applyAutoLaunch(getConfig().autoLaunch);
  } catch (err) {
    console.error("[boot] 自启动同步失败:", err?.message || err);
  }

  // 取词放最后：它会挂全局键盘钩子，且失败信息对用户最有价值
  const result = startCapture(onCaptured);
  if (result.ok) {
    console.log(`[boot] 取词已就绪，热键 ${describeHotkey(getConfig().hotkey)}`);
    floatLog(`取词钩子就绪，热键 ${describeHotkey(getConfig().hotkey)}`);
  } else {
    console.error("[boot] 取词启动失败：", result.error);
    floatLog(`取词钩子启动失败：${result.error}`);
  }
  });
}

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
