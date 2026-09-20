// 取词层：uiohook-napi 全局热键监听 + 模拟 Ctrl+C + 读取/恢复系统剪贴板。
// 命中热键 → 备份剪贴板 → 模拟 Ctrl+C → 等待前台程序复制 → 读回选中文字 → 恢复剪贴板。
import uiohook from "uiohook-napi";
import { clipboard } from "electron";
import { simulateCopy } from "./win32clip.js";
import { getConfig } from "./store.js";

let grabbing = false;
let handler = null;

function matchHotkey(e, hotkey) {
  return (
    !!e.altKey === !!hotkey.alt &&
    !!e.ctrlKey === !!hotkey.ctrl &&
    !!e.metaKey === !!hotkey.meta &&
    !!e.shiftKey === !!hotkey.shift &&
    e.keycode === hotkey.keycode
  );
}

// 抓取当前选区文字：模拟 Ctrl+C 后从剪贴板读取，并恢复原内容。
function grabSelection() {
  const prev = clipboard.readText();
  try {
    simulateCopy();
  } catch (err) {
    // 非 Windows / koffi 不可用时不致命，交给调用方处理
    console.error("[capture] simulateCopy failed:", err.message);
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      const text = clipboard.readText();
      try {
        clipboard.writeText(prev);
      } catch {
        /* ignore */
      }
      const got = (text || "").trim();
      resolve(got && got !== prev.trim() ? got : "");
    }, 130);
  });
}

/**
 * 启动全局取词。
 * @param {(text:string)=>void} onText 命中热键并取到文字后的回调
 */
export function startCapture(onText) {
  const hotkey = getConfig().hotkey;
  handler = async (e) => {
    if (grabbing) return;
    if (e.type !== "keydown") return;
    if (!matchHotkey(e, hotkey)) return;
    grabbing = true;
    try {
      const text = await grabSelection();
      if (text) onText(text);
    } finally {
      grabbing = false;
    }
  };
  uiohook.on("keydown", handler);
  try {
    uiohook.start();
  } catch (err) {
    console.error("[capture] uiohook start failed:", err);
  }
}

export function stopCapture() {
  if (handler) uiohook.off("keydown", handler);
  try {
    uiohook.stop();
  } catch {
    /* ignore */
  }
}
