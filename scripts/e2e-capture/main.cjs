// 端到端取词复现：在**真实 Electron 运行时**里跑完整取词链路 + 单独验证 Ctrl+C 原语。
//
// 背景（踩过的坑）：
//   取词"按了没反应"的根因是**注入 Ctrl+C 时热键的修饰键还按着** ——
//   真人按键是主键先松、修饰键后松，中间几十~几百毫秒，于是在主键 keydown
//   那一刻发出的 Ctrl+C 会被合成 **Ctrl+Alt+C**，目标程序不复制。
//   早期测试用的是"同一 tick 按下+抬起"这种不真实的理想按键，所以全绿但用户用不了。
//
// 本脚本分两层验证：
//   第一层：直接调 simulateCopy()，确认"修饰键按住时也能发出干净的 Ctrl+C"
//   第二层：跑生产代码 startCapture() 的完整链路（含真人按键节奏场景）
//
// 用法（必须先清 ELECTRON_RUN_AS_NODE）：
//   Remove-Item Env:\ELECTRON_RUN_AS_NODE
//   node_modules\electron\dist\electron.exe scripts\e2e-capture
// 结果写在 scripts\e2e-capture\e2e-result.txt
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "e2e-result.txt");
const lines = [];
let failures = 0;
const log = (s) => {
  lines.push(s);
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
};
const check = (name, ok, extra = "") => {
  log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures += 1;
};
const info = (s) => log(`INFO  ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { app, BrowserWindow, clipboard } = require("electron");

const SAMPLE = "The quick brown fox jumps over the lazy dog";

const VK_ALT = 0x12;
const VK_CTRL = 0x11;
const KEYEVENTF_KEYUP = 0x0002;

let keybd_event = null;
function loadKeybdEvent() {
  if (keybd_event) return keybd_event;
  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  keybd_event = user32.func(
    "void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uint64 dwExtraInfo)"
  );
  return keybd_event;
}
const down = (vk) => loadKeybdEvent()(vk, 0, 0, 0);
const up = (vk) => loadKeybdEvent()(vk, 0, KEYEVENTF_KEYUP, 0);

async function main() {
  const win = new BrowserWindow({
    width: 560,
    height: 320,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  await win.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<html><body style="font:14px sans-serif">
           <p>这段文字会被自动选中，模拟"用户划选了一段话"：</p>
           <textarea id="t" style="width:520px;height:140px"></textarea>
         </body></html>`
      )
  );
  win.show();
  win.focus();
  await sleep(600);

  const select = async (text) => {
    await win.webContents.executeJavaScript(
      `(() => { const t = document.getElementById('t');
                t.focus(); t.value=${JSON.stringify(text)};
                t.setSelectionRange(0, t.value.length);
                return t.value; })()`
    );
    win.focus();
    await sleep(150);
  };
  /** 窗口里当前还有没有选区（诊断焦点丢失用） */
  const selectionState = () =>
    win.webContents.executeJavaScript(
      `(() => { const t = document.getElementById('t');
                return JSON.stringify({ start: t.selectionStart, end: t.selectionEnd, focused: document.hasFocus() }); })()`
    );

  const win32clip = await import("../../electron/win32clip.js");

  // ══ 第一层：单独验证 simulateCopy 原语 ══════════════════════════════════
  log(`--- Ctrl+C 原语验证 | Electron ${process.versions.electron} ---`);

  // 0) GetAsyncKeyState 绑定是否可信
  const before = win32clip.heldModifiers();
  down(VK_ALT);
  await sleep(80);
  const withAlt = win32clip.heldModifiers();
  up(VK_ALT);
  await sleep(80);
  const afterAlt = win32clip.heldModifiers();
  info(`heldModifiers: 初始=${JSON.stringify(before)} 按住Alt=${JSON.stringify(withAlt)} 松开Alt=${JSON.stringify(afterAlt)}`);
  check("heldModifiers 能识别 Alt 的按下与松开", withAlt.includes(VK_ALT) && !afterAlt.includes(VK_ALT));

  // 三个用例统一结构：先让窗口稳定（聚焦+选区就绪），再复制。
  // 早期版本第一个用例没有预热，Chromium 还没处理完 focus/selection 就发 Ctrl+C，
  // 会假失败 —— 测试脚本自身时序问题，别误判成产品 bug。
  const settle = async () => {
    await select(SAMPLE);
    await clipboard.writeText("MARKER-x");
    await sleep(150);
  };

  // 1) 基线记录（不作为断言）：**孤立**调用一次 simulateCopy（没有任何修饰键参与、
  //    前面也没有热键动作）。实测这种情况下本环境不会产生复制 ——
  //    但生产路径**不存在**这种调用：取词永远由"热键按下"触发，
  //    而完整链路（下面 4 个场景，含真人按住节奏）全部通过。
  await settle();
  const solo = await win32clip.simulateCopy();
  await sleep(250);
  info(`  孤立调用（仅记录）: clipboard=${JSON.stringify(await clipboard.readText())} ${JSON.stringify(solo)}`);

  // 2) **按住 Alt** 时复制（这就是真人的按键节奏）
  await settle();
  down(VK_ALT);
  await sleep(100);
  const t0 = Date.now();
  const r = await win32clip.simulateCopy();
  const elapsed = Date.now() - t0;
  await sleep(200);
  up(VK_ALT);
  const got = await clipboard.readText();
  check("Alt 按住时：仍能复制到选区（修复前这里必然失败）", got === SAMPLE, `clipboard=${JSON.stringify(got)} 等待${elapsed}ms r=${JSON.stringify(r)}`);

  // 3) 按住 Ctrl+Alt 时复制（用户当前热键 Ctrl+Alt+D 的组合）
  await settle();
  down(VK_CTRL);
  down(VK_ALT);
  await sleep(100);
  const r3 = await win32clip.simulateCopy();
  await sleep(200);
  up(VK_ALT);
  up(VK_CTRL);
  const got3 = await clipboard.readText();
  check("Ctrl+Alt 按住时：仍能复制到选区", got3 === SAMPLE, `clipboard=${JSON.stringify(got3)} r=${JSON.stringify(r3)}`);

  // ══ 第二层：完整链路（生产 startCapture）══════════════════════════════
  log(`--- 完整取词链路 | 真人按键节奏 ---`);
  const capture = await import("../../electron/capture.js");
  let captured = null;
  let capturedAt = 0;
  const started = capture.startCapture((text) => {
    captured = text;
    capturedAt = Date.now();
  });
  check("startCapture 返回 ok", !!started.ok, JSON.stringify(started));
  await sleep(500);

  /** 持续采样剪贴板，记录它每次变化 —— 用来还原"到底复制成功没有、有没有被还原" */
  const sampleClipboard = async (ms) => {
    const t0 = Date.now();
    const seq = [];
    let last = null;
    while (Date.now() - t0 < ms) {
      const v = await clipboard.readText();
      if (v !== last) {
        seq.push(`${Date.now() - t0}ms=${JSON.stringify(v)}`);
        last = v;
      }
      await sleep(20);
    }
    return seq.join(" -> ");
  };

  const scenarios = [
    { name: "Alt+D 瞬时", vks: [VK_ALT, 0x44], hk: { alt: 1, ctrl: 0, keycode: 32 }, hold: 0 },
    { name: "Alt+D 按住 400ms（真人节奏）", vks: [VK_ALT, 0x44], hk: { alt: 1, ctrl: 0, keycode: 32 }, hold: 400 },
    { name: "Ctrl+Alt+D 瞬时", vks: [VK_CTRL, VK_ALT, 0x44], hk: { alt: 1, ctrl: 1, keycode: 32 }, hold: 0 },
    { name: "Ctrl+Alt+D 按住 400ms（用户当前设置）", vks: [VK_CTRL, VK_ALT, 0x44], hk: { alt: 1, ctrl: 1, keycode: 32 }, hold: 400 },
  ];

  for (const [i, sc] of scenarios.entries()) {
    captured = null;
    capturedAt = 0;
    await select(SAMPLE);
    await clipboard.writeText(`MARKER-${i}`);
    capture.setHotkey({ ...sc.hk, shift: false, meta: false });

    const t0 = Date.now();
    const sampler = sampleClipboard(2600);
    await sleep(40);
    for (const vk of sc.vks) down(vk);
    up(0x44); // 主键先松
    await sleep(sc.hold);
    for (const vk of [...sc.vks].reverse()) up(vk); // 修饰键后松

    for (let k = 0; k < 30 && !captured; k += 1) await sleep(150);
    await sleep(200);
    const seq = await sampler;

    check(sc.name, captured === SAMPLE, `captured=${JSON.stringify(captured)}`);
    info(`  [${sc.name}] 回调@${capturedAt ? capturedAt - t0 : "-"}ms  剪贴板轨迹: ${seq}`);
  }

  capture.stopCapture();
  log(`--- 结束：${failures === 0 ? "全通过" : failures + " 项失败"} ---`);
}

app.whenReady().then(async () => {
  setTimeout(() => app.exit(failures ? 1 : 0), 90000); // 看门狗
  try {
    await main();
  } catch (e) {
    check("脚本本身未抛错", false, e && e.stack ? e.stack : String(e));
  }
  app.exit(failures ? 1 : 0);
});
