// 取词链路回归测试：**真的模拟按键**，验证热键能否被识别。
//
// 为什么值得这么测：这块曾经整个不工作，症状是"按了没反应"，光读代码很难判断断在哪一环。
// 一次覆盖四个易错点：
//   ① import 形态（uiohook-napi 没有 default 导出）
//   ② 事件名是 'keydown'
//   ③ 事件对象的 type 是数字枚举而不是字符串
//   ④ 修饰键标志位不可靠，必须自己跟踪
// 外加一项：钩子 stop 之后能否再 start —— 设置页录制热键就是靠"暂停/恢复取词"实现的，
// 如果重启不可用，用户第一次录完热键后热键就会静默失效。
//
// 注意：会向当前前台窗口发送 Alt+Shift+F9 / F10（都是无副作用的组合键）。
// 用法：node scripts/test-capture.mjs
import koffi from "koffi";
import { uIOhook, UiohookKey, EventType } from "uiohook-napi";
import { matchesHotkey, createModifierTracker } from "../electron/hotkey.js";

const HOTKEY = { alt: true, shift: true, keycode: UiohookKey.F9 };
const VK_ALT = 0x12;
const VK_SHIFT = 0x10;
const VK_F9 = 0x78;
const VK_F10 = 0x79;
const KEYEVENTF_KEYUP = 0x0002;

const user32 = koffi.load("user32.dll");
const keybd_event = user32.func(
  "void keybd_event(unsigned char bVk, unsigned char bScan, unsigned long dwFlags, unsigned long long dwExtraInfo)"
);

const down = (vk) => keybd_event(vk, 0, 0, 0);
const up = (vk) => keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);

const tapHotkey = () => {
  down(VK_ALT);
  down(VK_SHIFT);
  down(VK_F9);
  up(VK_F9);
  up(VK_SHIFT);
  up(VK_ALT);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures += 1;
};
const info = (msg) => console.log(`INFO  ${msg}`);

// ── ① 导入形态：这是最初坏掉的原因 ─────────────────────────────────────────
check("uiohook-napi 具名导入可用（uIOhook.on 是函数）", typeof uIOhook?.on === "function");
check(
  "EventType.EVENT_KEY_PRESSED 是数字（不是字符串）",
  typeof EventType.EVENT_KEY_PRESSED === "number",
  `值=${EventType.EVENT_KEY_PRESSED}`
);

// ── ② 真按键 → 事件 ───────────────────────────────────────────────────────
let seen = [];
const tracker = createModifierTracker();
const onKey = (e) => {
  seen.push({ type: e.type, keycode: e.keycode, alt: e.altKey, shift: e.shiftKey });
  tracker.update(e);
};
const onKeyUp = (e) => tracker.update(e);

uIOhook.on("keydown", onKey);
uIOhook.on("keyup", onKeyUp);
try {
  uIOhook.start();
} catch (err) {
  console.log("FAIL  钩子启动失败：", err?.message || err);
  process.exit(1);
}

console.log("钩子已启动，1 秒后模拟按下 Alt+Shift+F9 …");
await sleep(1000);
tapHotkey();
await sleep(1000);

check("模拟按键后收到 keydown 事件", seen.length > 0, `共收到 ${seen.length} 个事件`);
check(
  "事件 type 是数字枚举（不是字符串 \"keydown\"）",
  seen.length > 0 && typeof seen[0].type === "number",
  seen.length ? `type=${seen[0].type}` : ""
);

// 用生产代码同一份实现回放事件，验证能命中
const replay = createModifierTracker();
const matchedTracked = seen.filter((e) => matchesHotkey(e, HOTKEY, replay.update(e)));
check(
  "修饰键跟踪生效：Alt+Shift+F9 能被匹配（生产代码同一份实现）",
  matchedTracked.length > 0,
  matchedTracked.length ? `匹配 ${matchedTracked.length} 次` : "未匹配到目标组合键"
);

// libuiohook 的 altKey 时灵时不灵（首次实测为 false，复跑又为 true），
// 所以只报告不断言 —— 但生产代码不能依赖它。
const naked = seen.filter((e) => matchesHotkey(e, HOTKEY));
info(`只读事件标志位本次匹配 ${naked.length} 次（该行为不确定，故生产代码不依赖它）`);

// ── ③ 修饰键跟踪器的确定性验证（不依赖真实按键，可稳定复现平台坑）──────────
const noFlag = (keycode, type = EventType.EVENT_KEY_PRESSED) => ({
  type,
  keycode,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
});
const t2 = createModifierTracker();
t2.update(noFlag(56)); // Alt 按下（事件里没带 altKey）
t2.update(noFlag(42)); // Shift 按下（事件里没带 shiftKey）
const f9 = noFlag(HOTKEY.keycode);
check(
  "跟踪器能在事件修饰键标志全缺失时兜住（平台坑的确定性复现）",
  matchesHotkey(f9, HOTKEY, t2.update(f9)) === true
);
t2.update(noFlag(42, EventType.EVENT_KEY_RELEASED));
check(
  "松开 Shift 后同一组合键不再命中（防修饰键卡住导致误触发）",
  matchesHotkey(f9, HOTKEY, t2.update(f9)) === false
);

// 严格相等：多要一个修饰键就不该命中
const replay2 = createModifierTracker();
check(
  "严格匹配：没按下 Ctrl 时，要求 Ctrl 的组合键不应命中",
  seen.some((e) =>
    matchesHotkey(e, { alt: true, ctrl: true, shift: true, keycode: HOTKEY.keycode }, replay2.update(e))
  ) === false
);

// ── ④ 钩子能否 stop 后再 start（设置页录制热键依赖它）──────────────────────
uIOhook.off("keydown", onKey);
uIOhook.off("keyup", onKeyUp);
uIOhook.stop();

let afterRestart = 0;
const onKey2 = () => {
  afterRestart += 1;
};
uIOhook.on("keydown", onKey2);
uIOhook.start();
await sleep(400);
keybd_event(VK_F10, 0, 0, 0);
keybd_event(VK_F10, 0, KEYEVENTF_KEYUP, 0);
await sleep(700);
uIOhook.off("keydown", onKey2);
uIOhook.stop();

check(
  "钩子 stop 之后能再次 start 并收到事件（录制热键的暂停/恢复依赖它）",
  afterRestart > 0,
  `重启后收到 ${afterRestart} 个事件`
);

console.log(`\n${failures === 0 ? "全部通过" : failures + " 项失败"}，退出码 ${failures === 0 ? 0 : 1}`);
process.exit(failures === 0 ? 0 : 1);
