// 浏览器 KeyboardEvent.code → uiohook 扫描码。
//
// 为什么需要这层映射：设置页热键录制器拿到的是 DOM 事件的 `event.code`
// （"KeyD" / "Digit1" / "F9"…，代表**物理按键位置**），
// 而主进程用 uiohook 监听时比对的是**扫描码**（PS/2 set-1，D = 32）。
// 两套编码必须显式对应，不能靠 keyCode 猜（keyCode 已被废弃且各浏览器不一致）。
//
// 只收录 electron/hotkey.js 的 KEY_TABLE 里有的键；表外的键一律判为不支持，
// 宁可让用户换键，也不要产生"录进去了却监听不到"的假象。

const LETTERS = {
  KeyA: 30, KeyB: 48, KeyC: 46, KeyD: 32, KeyE: 18, KeyF: 33, KeyG: 34,
  KeyH: 35, KeyI: 23, KeyJ: 36, KeyK: 37, KeyL: 38, KeyM: 50, KeyN: 49,
  KeyO: 24, KeyP: 25, KeyQ: 16, KeyR: 19, KeyS: 31, KeyT: 20, KeyU: 22,
  KeyV: 47, KeyW: 17, KeyX: 45, KeyY: 21, KeyZ: 44,
};

const DIGITS = {
  Digit1: 2, Digit2: 3, Digit3: 4, Digit4: 5, Digit5: 6,
  Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11,
};

const FN_KEYS = {
  F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66,
  F9: 67, F10: 68, F11: 87, F12: 88,
};

const MISC = {
  Escape: 1, Backspace: 14, Tab: 15, Enter: 28, Space: 57,
  Minus: 12, Equal: 13, BracketLeft: 26, BracketRight: 27, Backslash: 43,
  Semicolon: 39, Quote: 40, Backquote: 41, Comma: 51, Period: 52, Slash: 53,
};
// 注意：**不要**把 NumpadEnter 映射到 28。小键盘回车在 uiohook 里是扩展码 3612，
// 映射成 28 会得到"录制成功但永远匹配不上"的假象（已由跨模块一致性测试拦下）。

// 导出原始映射表本身，供跨模块一致性测试对照（改单边会被测试抓到）
export const CODE_TO_KEYCODE = { ...LETTERS, ...DIGITS, ...FN_KEYS, ...MISC };

/** 纯修饰键：录制时忽略（热键必须有一个非修饰主键） */
export const MODIFIER_CODES = new Set([
  "AltLeft", "AltRight", "ControlLeft", "ControlRight",
  "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight",
  "CapsLock", "NumLock", "ScrollLock", "ContextMenu",
]);

/** @returns {number|null} 对应的 uiohook 扫描码；不支持则 null */
export function domCodeToKeycode(code) {
  return CODE_TO_KEYCODE[code] ?? null;
}

/**
 * 把一次 DOM 按键事件转成热键对象。
 * @returns {null | {alt:boolean,ctrl:boolean,shift:boolean,meta:boolean,keycode:number}}
 *          纯修饰键或不支持的键返回 null
 */
export function eventToHotkey(e) {
  if (MODIFIER_CODES.has(e.code)) return null;
  const keycode = domCodeToKeycode(e.code);
  if (keycode === null) return null;
  return {
    alt: e.altKey,
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    keycode,
  };
}
