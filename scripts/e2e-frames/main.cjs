// 抓帧诊断：把浮窗在 show 之后的若干时刻**存成 PNG**，用眼睛看"闪一下"到底闪的是什么。
//
// 前序结论（scripts/e2e-app）：每轮只 show 一次，但 show+0 的帧只有 ~47~57% 不透明像素，
// 说明窗口"先亮起来、内容后画上去"。本脚本把这个过程逐帧存盘，确认是
//   (a) 空框 → 内容，还是 (b) 上一轮的旧内容 → 新内容。
//
// 用法：Remove-Item Env:\ELECTRON_RUN_AS_NODE; node_modules\electron\dist\electron.exe scripts\e2e-frames
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "frames");
fs.mkdirSync(DIR, { recursive: true });
const OUT = path.join(__dirname, "frames-result.txt");
const lines = [];
const log = (s) => {
  lines.push(s);
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { app, BrowserWindow, clipboard, screen } = require("electron");
app.setPath("userData", path.join(process.env.APPDATA || "", "kiss-desktop"));
process.env.KISS_DEBUG_CAPTURE = "1";

const VK_ALT = 0x12;
const VK_CTRL = 0x11;
const KEYEVENTF_KEYUP = 0x0002;
const koffi = require("koffi");
const user32 = koffi.load("user32.dll");
const keybd_event = user32.func("void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uint64 dwExtraInfo)");
const setCursorPos = user32.func("bool __stdcall SetCursorPos(int X, int Y)");
const down = (vk) => keybd_event(vk, 0, 0, 0);
const up = (vk) => keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);

const t0 = Date.now();
const now = () => Date.now() - t0;

/** 统计不透明像素占比 + 是否和上一帧完全一样（判断"内容有没有变"） */
const stats = (img) => {
  const bmp = img.toBitmap();
  const total = bmp.length / 4;
  let opaque = 0;
  let hash = 0;
  for (let i = 0; i < bmp.length; i += 4) {
    if (bmp[i + 3] > 8) opaque += 1;
    // 采样求个粗略指纹（只看每 37 个像素，够发现"变了没有"）
    if (i % 148 === 0) hash = (hash * 31 + bmp[i] + bmp[i + 1] * 7 + bmp[i + 2] * 13) | 0;
  }
  return { pct: ((opaque / total) * 100).toFixed(1), hash };
};

async function main() {
  const store = await import("../../electron/store.js");
  await import("../../electron/main.js");
  await sleep(2500);

  const cfg = store.getConfig();
  log(`--- 浮窗抓帧诊断 | Electron ${process.versions.electron} ---`);
  log(`热键=${JSON.stringify(cfg.hotkey)} 引擎=${cfg.engine.apiType}`);

  const float = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isAlwaysOnTop());
  if (!float) {
    log("FAIL 没找到浮窗");
    return;
  }
  log(`浮窗初始 bounds=${JSON.stringify(float.getBounds())}`);

  const target = new BrowserWindow({
    width: 520,
    height: 260,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  await target.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<html><body style="font:14px sans-serif"><p>目标程序：</p>
         <textarea id="t" style="width:480px;height:120px">VALUE</textarea></body></html>`
      )
  );
  target.show();
  target.focus();
  await sleep(500);

  const hk = cfg.hotkey || {};
  const vks = [hk.ctrl && VK_CTRL, hk.alt && VK_ALT].filter(Boolean);
  const orig = screen.getCursorScreenPoint();

  /** 一轮：设不同文本 → 按热键 → 逐帧抓图 */
  const round = async (i, text, cursor) => {
    setCursorPos(cursor[0], cursor[1]);
    await target.webContents.executeJavaScript(
      `(() => { const t=document.getElementById('t'); t.value=${JSON.stringify(text)};
                t.focus(); t.setSelectionRange(0,t.value.length); return t.value; })()`
    );
    await target.focus();
    await clipboard.writeText("MARKER-" + i + "-" + Date.now());
    await sleep(350);
    log(`\n===== 第 ${i} 轮：选区=${JSON.stringify(text)} 光标=${cursor} =====`);

    // show 事件一到就连拍
    const shots = [];
    const onShow = () => {
      shots.push(`${now()}ms`);
      const offsets = [0, 40, 90, 160, 300, 700];
      offsets.forEach((off) => {
        setTimeout(async () => {
          if (float.isDestroyed() || !float.isVisible()) return;
          try {
            const img = await float.webContents.capturePage();
            const s = stats(img);
            const file = path.join(DIR, `r${i}_show+${off}ms.png`);
            fs.writeFileSync(file, img.toPNG());
            log(`  show+${off}ms  不透明=${s.pct}%  指纹=${s.hash}  → ${path.basename(file)}`);
          } catch (e) {
            log(`  show+${off}ms  抓帧失败 ${e.message}`);
          }
        }, off);
      });
    };
    float.once("show", onShow);

    for (const vk of [...vks, 0x44]) down(vk);
    up(0x44);
    await sleep(300);
    for (const vk of [...vks].reverse()) up(vk);
    await sleep(4000);
    float.removeListener("show", onShow);
    if (!float.isDestroyed()) float.hide();
    await sleep(800);
  };

  // 第 1 轮：窗口从未显示过 → 首帧应该是空的
  await round(1, "alpha first capture", [420, 240]);
  // 第 2 轮：窗口里还留着第 1 轮的译文 → 首帧若是旧内容，就证明"先显示旧的再换新的"
  await round(2, "beta second capture", [900, 400]);
  // 第 3 轮：换个明显不同的内容，便于肉眼区分
  await round(3, "gamma third capture", [1250, 520]);

  setCursorPos(orig.x, orig.y);
  log("\n--- 结束：请直接看 frames/ 目录里的 PNG ---");
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
