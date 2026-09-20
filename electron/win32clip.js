// Windows 剪贴板模拟：用 koffi 调 user32!keybd_event 发送 Ctrl+C，
// 触发前台程序把当前选区复制到系统剪贴板。比 SendInput 简单，足够稳定。
// 仅主进程（Windows）可用；非 Windows 平台调用会抛错，由 capture.js 捕获降级。
//
// ── 为什么不能简单地「按下 Ctrl → 按下 C」（踩过的坑，务必保留下面的等待逻辑）──
// 用户是按着热键让取词触发的，而**真人的按键节奏是主键先松、修饰键后松**，
// 中间有几十到几百毫秒。如果我们在主键 keydown 的瞬间就注入 Ctrl+C，
// 目标程序收到的其实是 **Ctrl+Alt+C**（热键自带的 Alt/Ctrl 还按着），
// 绝大多数程序不认这个组合 → **不复制** → 症状就是「划词没反应」。
//
// 实测复现（scripts/e2e-capture）：
//   Alt+D 瞬时按下抬起（理想按键）  → 取词成功
//   Alt+D 按住 400ms（真人节奏）    → 取词失败
//   Ctrl+Alt+D 按住 400ms           → 取词失败
// 所以必须先等修饰键真正松开，等不到就强制抬起，再发 Ctrl+C。
import koffi from "koffi";

let api = null;

function loadUser32() {
  if (api) return api;
  const user32 = koffi.load("user32.dll");
  api = {
    keybd_event: user32.func(
      "void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uint64 dwExtraInfo)"
    ),
    // 返回 short：高位（0x8000）为 1 表示该键**当前**处于按下状态
    getAsyncKeyState: user32.func("short __stdcall GetAsyncKeyState(int vKey)"),
  };
  return api;
}

const VK_CONTROL = 0x11;
const VK_C = 0x43;
const KEYEVENTF_KEYUP = 0x0002;

// 会污染 Ctrl+C 的修饰键（左右都查：只查通用码在部分场景下不可靠）
const MODIFIER_VKS = [
  0x10, // Shift
  0x11, // Ctrl
  0x12, // Alt
  0x5b, // Win 左
  0x5c, // Win 右
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 当前**真实**被按住的修饰键 VK 列表（直接问系统，不依赖事件标志） */
export function heldModifiers() {
  const { getAsyncKeyState } = loadUser32();
  return MODIFIER_VKS.filter((vk) => (getAsyncKeyState(vk) & 0x8000) !== 0);
}

/** 强制抬起所有修饰键（用户长按不放时的兜底） */
function forceReleaseModifiers() {
  const { keybd_event } = loadUser32();
  for (const vk of MODIFIER_VKS) keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
}

/**
 * 模拟一次 Ctrl+C。调用方负责前后备份/恢复剪贴板。
 *
 * @param {object} [opts]
 * @param {number} [opts.waitMs=250] 等修饰键松开的**上限**（毫秒）。
 *        真人松手通常 80~150ms；超过上限就直接强制抬起，不无限等。
 * @returns {Promise<{forced:number[], waited:number}>} 诊断信息（便于测试断言）
 */
export async function simulateCopy({ waitMs = 250, interval = 15 } = {}) {
  const started = Date.now();

  // 1) 等修饰键松开 —— 这一步才是让 Ctrl+C 真正成为 Ctrl+C 的关键
  while (heldModifiers().length && Date.now() - started < waitMs) {
    await sleep(interval);
  }

  // 2) 超时还按着（用户长按）→ 强制抬起来。宁可短暂与物理按键状态不同步，
  //    也不能把 Ctrl+C 送成 Ctrl+Alt+C；用户随后松开物理键是无副作用的。
  const still = heldModifiers();
  if (still.length) forceReleaseModifiers();

  // 3) 干净的 Ctrl+C
  const { keybd_event } = loadUser32();
  keybd_event(VK_CONTROL, 0, 0, 0);
  keybd_event(VK_C, 0, 0, 0);
  keybd_event(VK_C, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);

  return { forced: still, waited: Date.now() - started };
}
