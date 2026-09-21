// 真实应用 + 浮窗可见性追踪：定位「翻译框闪一下 / 窗口开了两回」。
//
// 为什么不用 mock：这个 bug 出在**窗口生命周期**上，而不是取词逻辑里。
// 所以这里直接加载生产的 electron/main.js（真托盘、真配置、真引擎、真热键），
// 只在旁边挂"观察者"。
//
// ⚠️ 前两版跑不出问题的两个坑（保留下面的修正，别再退回去）：
//  1) 脚本 app 名是 kiss-desktop-e2e-app，userData 与正式应用不同 →
//     electron-store 读的是**默认配置**（Alt+D / 空引擎），
//     "用户真实配置 Ctrl+Alt+D"这条路根本没测到。→ 强制 app.setPath("userData", 正式目录)。
//  2) **鼠标不动**。positionFloatWindow() 是按光标位置算坐标的，光标不动等于
//     每轮坐标都一样 → "先出现在旧位置、再跳到新位置"这种闪动**测不出来**。
//     → 每轮用 SetCursorPos 把光标挪到不同位置。
//
// 三层证据：
//  1) BrowserWindow.prototype.show/hide/focus/setBounds 打桩：谁调、调几次、调用栈。
//  2) show/hide/move/resize/blur/focus 事件（精确到 OS 真的搬动窗口）+ 15ms 采样。
//  3) show 那一刻 capturePage() 看**首帧是不是空的**（空帧 = 用户看到的"闪一下"）。
//
// 用法（必须先清 ELECTRON_RUN_AS_NODE）：
//   Remove-Item Env:\ELECTRON_RUN_AS_NODE
//   node_modules\electron\dist\electron.exe scripts\e2e-app
// 结果写在 scripts\e2e-app\app-result.txt
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "app-result.txt");
const lines = [];
const log = (s) => {
  lines.push(s);
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { app, BrowserWindow, clipboard, screen } = require("electron");

const REAL_USER_DATA = path.join(process.env.APPDATA || "", "kiss-desktop");
app.setPath("userData", REAL_USER_DATA);
process.env.KISS_DEBUG_CAPTURE = "1";

const SAMPLE = "The quick brown fox jumps over the lazy dog";
const VK_ALT = 0x12;
const VK_CTRL = 0x11;
const KEYEVENTF_KEYUP = 0x0002;

const koffi = require("koffi");
const user32 = koffi.load("user32.dll");
const keybd_event = user32.func(
  "void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uint64 dwExtraInfo)"
);
const setCursorPos = user32.func("bool __stdcall SetCursorPos(int X, int Y)");
const down = (vk) => keybd_event(vk, 0, 0, 0);
const up = (vk) => keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);

const t0 = Date.now();
const now = () => Date.now() - t0;

const apiCalls = [];
const caller = () => {
  const st = new Error().stack || "";
  const hit = st
    .split("\n")
    .slice(2)
    .map((l) => l.trim())
    .find((l) => l.includes("electron/") || l.includes("main.cjs"));
  return hit ? hit.replace(/.*[/\\]/, "").replace(/:\d+:\d+\)?$/, "") : "?";
};
for (const method of ["show", "showInactive", "hide", "focus", "setBounds", "setPosition"]) {
  const orig = BrowserWindow.prototype[method];
  if (typeof orig !== "function") continue;
  BrowserWindow.prototype[method] = function patched(...args) {
    apiCalls.push(`${now()}ms ${method}(${args.map((a) => JSON.stringify(a)).join(",")}) ← ${caller()}`);
    return orig.apply(this, args);
  };
}

async function main() {
  const store = await import("../../electron/store.js");
  await import("../../electron/main.js");
  await sleep(2500);

  const cfg = store.getConfig();
  log(`--- 真实应用浮窗可见性追踪 v3 | Electron ${process.versions.electron} ---`);
  log(`userData = ${REAL_USER_DATA}`);
  log(`配置：热键=${JSON.stringify(cfg.hotkey)} 引擎=${cfg.engine.apiType} 复制即翻译=${cfg.copyToTranslate}`);

  const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  log(`启动后窗口数 = ${all.length}：` + all.map((w) => `${JSON.stringify(w.getBounds())} top=${w.isAlwaysOnTop()}`).join(" | "));
  const float = all.find((w) => w.isAlwaysOnTop());
  if (!float) {
    log("FAIL 没找到浮窗");
    return;
  }
  log(`浮窗：${JSON.stringify(float.getBounds())} visible=${float.isVisible()}`);

  const events = [];
  const mark = (name, extra = "") => events.push(`${now()}ms ${name}${extra ? " " + extra : ""}`);
  const bounds = () => (float.isDestroyed() ? "-" : JSON.stringify(float.getBounds()));
  float.on("show", () => mark("SHOW", `bounds=${bounds()} loading=${float.webContents.isLoading()}`));
  float.on("hide", () => mark("hide", `bounds=${bounds()}`));
  float.on("move", () => mark("  move", `bounds=${bounds()}`));
  float.on("resize", () => mark("  resize", `bounds=${bounds()}`));
  float.on("focus", () => mark("focus"));
  float.on("blur", () => mark("blur"));
  float.on("closed", () => mark("closed"));

  // show 那一刻抓首帧：全透明/空白 = 用户看到的"闪一下"
  const frameStats = [];
  const grabFrame = async (tag) => {
    try {
      const img = await float.webContents.capturePage();
      const bmp = img.toBitmap(); // BGRA
      const size = img.getSize();
      if (!bmp.length) {
        frameStats.push(`${tag}: 空图`);
        return;
      }
      let opaque = 0;
      for (let i = 3; i < bmp.length; i += 4) if (bmp[i] > 8) opaque += 1;
      const pct = ((opaque / (bmp.length / 4)) * 100).toFixed(1);
      frameStats.push(`${tag}: ${size.width}x${size.height} 不透明像素 ${pct}%`);
    } catch (e) {
      frameStats.push(`${tag}: 抓帧失败 ${e.message}`);
    }
  };
  float.on("show", () => {
    grabFrame(`${now()}ms show+0`);
    setTimeout(() => grabFrame(`${now()}ms show+150`), 150);
  });

  const timeline = [];
  let prev = { v: false, b: "" };
  const watcher = setInterval(() => {
    if (float.isDestroyed()) return;
    const cur = { v: float.isVisible(), b: JSON.stringify(float.getBounds()) };
    if (cur.v !== prev.v || cur.b !== prev.b) {
      timeline.push(`${now()}ms ${cur.v ? "可见" : "隐藏"} ${cur.b}`);
      prev = cur;
    }
  }, 15);

  const target = new BrowserWindow({
    width: 520,
    height: 260,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  await target.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<html><body style="font:14px sans-serif"><p>模拟"用户在别的程序里划选了一段话"：</p>
         <textarea id="t" style="width:480px;height:120px">${SAMPLE}</textarea></body></html>`
      )
  );
  target.show();
  target.focus();
  await sleep(500);

  const hk = cfg.hotkey || {};
  const vks = [hk.ctrl && VK_CTRL, hk.alt && VK_ALT, hk.shift && 0x10].filter(Boolean);
  const origCursor = screen.getCursorScreenPoint();

  const pressHotkey = async () => {
    await target.webContents.executeJavaScript(
      `(() => { const t=document.getElementById('t'); t.focus(); t.setSelectionRange(0,t.value.length); return t.value; })()`
    );
    await target.focus();
    await clipboard.writeText("MARKER-" + Date.now());
    await sleep(250);
    for (const vk of [...vks, 0x44]) down(vk);
    up(0x44);
    await sleep(300);
    for (const vk of [...vks].reverse()) up(vk);
  };

  const rounds = [];
  const ROUNDS = Number(process.env.KISS_ROUNDS || 3);
  // KISS_PREVISIBLE=1：从第 2 轮起先把浮窗 showInactive() 挂在屏上（不抢焦点、
  // 也就不触发 blur→hide）。这模拟真实环境里 Windows 前台锁拒绝 focus() 时
  // "浮窗一直留着"的状态 —— 旧代码在这种状态下会"原地换内容+挪位置"，
  // 用户看起来就是又弹了一次。生产代码现在的对策是：先 hide 再重显。
  const PREVISIBLE = process.env.KISS_PREVISIBLE === "1";
  for (let i = 1; i <= ROUNDS; i += 1) {
    // ★ 把光标挪到不同位置 —— 这才是用户真实场景（每次在屏幕不同地方划词）
    const cx = 300 + i * 260;
    const cy = 200 + i * 90;
    setCursorPos(cx, cy);
    await sleep(300);

    // ⚠️ startIdx 必须放在"预备 showInactive"之后：那次 show 是脚手架自己造的
    //    可见状态，不算本轮的弹出，否则会把 SHOW 次数多数一遍（第一版就数错了）。
    if (PREVISIBLE && i > 1 && !float.isDestroyed()) {
      float.showInactive(); // 故意让浮窗留在屏上（不抢焦点）
      mark(`（预备：浮窗置为可见未聚焦 visible=${float.isVisible()}）`);
      await sleep(300);
    }
    const startIdx = events.length;
    mark(`=== 第 ${i} 次取词开始 ===`, `cursor=(${cx},${cy})`);
    await pressHotkey();
    await sleep(4500);
    const shown = events.slice(startIdx).filter((s) => s.includes("SHOW")).length;
    rounds.push({ i, shown });
    mark(`=== 第 ${i} 次取词结束（SHOW ${shown} 次）===`);
    if (!float.isDestroyed() && !PREVISIBLE) float.hide();
    if (PREVISIBLE && !float.isDestroyed()) float.hide(); // 收尾仍收起，下一轮再挂出来
    await sleep(700);
  }

  clearInterval(watcher);
  setCursorPos(origCursor.x, origCursor.y);

  log(`\n事件序列：\n  ${events.join("\n  ")}`);
  log(`\n可见性/位置时间线：\n  ${timeline.join("\n  ")}`);
  log(`\n首帧采样：\n  ${frameStats.join("\n  ") || "(无)"}`);
  log(`\n窗口 API 调用：\n  ${apiCalls.join("\n  ") || "(无)"}`);

  log(`\n各轮 SHOW 次数：` + rounds.map((r) => `第${r.i}轮=${r.shown}`).join("  "));
  const maxShown = Math.max(...rounds.map((r) => r.shown));
  log(maxShown <= 1 ? "结论：每轮只显示一次 ✓" : `结论：有轮次显示 ${maxShown} 次 —— "开了两回"`);
  log("--- 结束 ---");
}

app.whenReady().then(async () => {
  setTimeout(() => app.exit(0), 90000);
  try {
    await main();
  } catch (e) {
    log("脚本抛错: " + (e && e.stack ? e.stack : String(e)));
  }
  app.exit(0);
});
