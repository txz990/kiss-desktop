// Windows 剪贴板模拟：用 koffi 调 user32!keybd_event 发送 Ctrl+C，
// 触发前台程序把当前选区复制到系统剪贴板。比 SendInput 简单，足够稳定。
// 仅主进程（Windows）可用；非 Windows 平台调用会抛错，由 capture.js 捕获降级。
import koffi from "koffi";

let keybd_event = null;

function loadUser32() {
  if (keybd_event) return keybd_event;
  const user32 = koffi.load("user32.dll");
  keybd_event = user32.func(
    "void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uint64 dwExtraInfo)"
  );
  return keybd_event;
}

const VK_CONTROL = 0x11;
const VK_C = 0x43;
const KEYEVENTF_KEYUP = 0x0002;

// 模拟一次 Ctrl+C。调用方负责前后备份/恢复剪贴板。
export function simulateCopy() {
  const fn = loadUser32();
  fn(VK_CONTROL, 0, 0, 0);
  fn(VK_C, 0, 0, 0);
  fn(VK_C, 0, KEYEVENTF_KEYUP, 0);
  fn(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
}
