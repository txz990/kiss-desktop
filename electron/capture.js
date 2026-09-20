// 取词层：uiohook-napi 全局热键监听 + 模拟 Ctrl+C + 读取/恢复系统剪贴板。
// 命中热键 → 备份剪贴板 → 模拟 Ctrl+C → 等前台程序复制 → 读回选中文字 → 恢复剪贴板。
//
// ── 这个文件先后崩过两次，坑全写在下面（别再踩第二次）──────────────────────
//  1) `uiohook-napi` **没有 default 导出**（只导出 uIOhook / UiohookKey / EventType 等具名成员）。
//     写成 `import uiohook from "uiohook-napi"` 时，Node 的 CJS 互操作会把 module.exports
//     整个当成 default —— 于是 `uiohook.on` 是 undefined，
//     `uiohook.on("keydown", ...)` 直接抛 "uiohook.on is not a function"。
//     **而且这个异常会把 startCapture() 之后的所有初始化一并带崩**（剪贴板监听就是这么消失的）。
//  2) 事件对象的 `type` 字段是**数字枚举** `EventType.EVENT_KEY_PRESSED (=4)`，不是字符串
//     `"keydown"`；`"keydown"` 只是 EventEmitter 的事件名。
//     所以 `if (e.type !== "keydown") return;` 会**永远提前返回**，热键一辈子不触发。
//  3) Electron **44 把 clipboard 全部异步化**。`clipboard.readText()` 返回的是
//     Promise 而不是字符串，写成同步形态 `(cur || "").trim()` 就会得到
//     "XXX.trim is not a function" —— Promise 是 truthy，`|| ""` 根本兜不住。
//     所以现在一切剪贴板读写都走 ./cliptext.js（那里保证**永远返回 string**）。
//     同时注意：writeHTML / writeImage / writeRTF / availableFormats 等 8 个
//     便捷方法在 Electron 44 里**已被删除**，只剩 clear/has/read/readText/write/writeText。
import { uIOhook, EventType } from "uiohook-napi";
import {
  readClipboardText,
  restoreClipboard,
  snapshotClipboard,
} from "./cliptext.js";
import { createModifierTracker, matchesHotkey } from "./hotkey.js";
import { simulateCopy } from "./win32clip.js";
import { getConfig } from "./store.js";

let grabbing = false;
let downHandler = null;
let upHandler = null;
let started = false;
// 当前生效的热键（内存里保存一份，改配置时热更新，不必重启）
let currentHotkey = null;
// 修饰键状态自己维护：libuiohook 在 Windows 上不一定填 altKey（见 hotkey.js 说明）
const mods = createModifierTracker();

/**
 * 抓取当前选区文字：备份剪贴板 → 模拟 Ctrl+C → 轮询读回选中文字 → 恢复剪贴板。
 *
 * 两处设计要考虑：
 * - 等待时间用**自适应轮询**：不同程序复制到剪贴板的耗时差别很大
 *   （记事本几乎瞬时，浏览器/Word/PDF 阅读器可能 200ms+）。
 *   原来固定 130ms 太短，是「热键按了但没反应」的常见原因之一。
 * - 恢复阶段**保留用户的富格式**：以前只回写纯文本，用户之前复制的图片/带格式文字
 *   会被静默冲掉。现在先做全格式快照，再整体还原；拿不到快照才退化成写纯文本。
 *
 * 全程读剪贴板都走 readClipboardText()，它保证返回 string —— Electron 44 之后
 * readText() 返回 Promise，直接 `.trim()` 会崩（详见文件头坑位 3）。
 */
async function grabSelection({ timeout = 600, interval = 30 } = {}) {
  // 先备份，再 Ctrl+C：顺序反了就把待抓的内容自己覆盖了
  const snapshot = await snapshotClipboard();
  const prev = await readClipboardText();

  try {
    simulateCopy();
  } catch (err) {
    // 非 Windows / koffi 不可用时不致命，交给调用方处理
    console.error("[capture] simulateCopy failed:", err.message);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + timeout;
  // 先给目标程序一点时间响应按键
  await sleep(interval);

  while (Date.now() < deadline) {
    const cur = await readClipboardText();
    const got = cur.trim();
    if (got && got !== prev.trim()) {
      // 拿到了新内容：把用户原来的剪贴板还原回去，避免污染
      await restoreClipboard(snapshot, prev);
      return got;
    }
    await sleep(interval);
  }
  return "";
}

/**
 * 热更新热键（设置页保存后调用，无需重启）。
 * 内存里直接换，连钩子都不用重装。
 */
export function setHotkey(hotkey) {
  currentHotkey = hotkey || null;
  return currentHotkey;
}

export function getCurrentHotkey() {
  return currentHotkey;
}

/**
 * 启动全局取词。
 * @param {(text:string)=>void} onText 命中热键并取到文字后的回调
 * @returns {{ok:boolean, error?:string}} 启动结果（调用方据此提示用户）
 */
export function startCapture(onText) {
  setHotkey(getConfig().hotkey);
  mods.reset();

  // 只订阅 'keydown' / 'keyup'：库内部已经把 EVENT_KEY_PRESSED / EVENT_KEY_RELEASED
  // 映射成这两个事件名。仍带一次 type 断言，避免以后库改了映射我们还以为在收按下事件。
  downHandler = async (e) => {
    if (e.type !== EventType.EVENT_KEY_PRESSED && e.type !== undefined) return;
    // 每个事件都先更新修饰键状态，再判定（修饰键自己按下时也要更新）
    const effective = mods.update(e);
    if (grabbing) return;
    if (!matchesHotkey(e, currentHotkey, effective)) return;
    grabbing = true;
    try {
      const text = await grabSelection();
      if (text) onText(text);
    } catch (err) {
      console.error("[capture] grab failed:", err?.message || err);
    } finally {
      grabbing = false;
    }
  };

  // 单独跟踪抬起：漏掉 keyup 会让修饰键"卡住"，导致之后不带修饰键的按键误触
  upHandler = (e) => {
    mods.update(e);
  };

  try {
    uIOhook.on("keydown", downHandler);
    uIOhook.on("keyup", upHandler);
    uIOhook.start();
    started = true;
    return { ok: true };
  } catch (err) {
    console.error("[capture] uiohook 启动失败:", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export function stopCapture() {
  if (downHandler) {
    try {
      uIOhook.off("keydown", downHandler);
    } catch {
      /* ignore */
    }
  }
  if (upHandler) {
    try {
      uIOhook.off("keyup", upHandler);
    } catch {
      /* ignore */
    }
  }
  if (started) {
    try {
      uIOhook.stop();
    } catch {
      /* ignore */
    }
    started = false;
  }
}

export const isCaptureStarted = () => started;
