// 热键工具：按键表、可读化描述、合法性校验、冲突检测。
//
// ── 为什么必须做冲突检测 ────────────────────────────────────────────────────
// 本应用用 uiohook 的**低级键盘钩子**监听热键，它不向系统注册，所以「永远装得上」，
// 但会和别的程序抢同一个组合键：两边都会响应（例如 Alt+D 同时触发了某编辑器）。
// 这里用 user32!RegisterHotKey 做一次**探针**（注册成功就立刻注销）：
//   - 成功       → 该组合键当前无人占用
//   - 1409       → ERROR_HOTKEY_ALREADY_REGISTERED，已被其他程序或系统占用
//   - 其它错误码  → 无法注册，一并提示
// 探针实测有效：占用中的 Alt+Shift+F9 与系统自带的 Win+D 都稳定返回 1409。
//
// ⚠️ 两个注意点：
//  1) GetLastError **只在调用失败时才有意义**，成功时读会拿到上一次的陈旧值（实测踩过）。
//  2) RegisterHotKey 探不到 shell 层处理的组合键（Alt+Tab / Win+R / Ctrl+Esc 等），
//     所以另有一份硬编码清单，见 SHELL_RESERVED。
import koffi from "koffi";

// ── koffi 绑定 ─────────────────────────────────────────────────────────────
const MOD_ALT = 0x0001;
const MOD_CONTROL = 0x0002;
const MOD_SHIFT = 0x0004;
const MOD_WIN = 0x0008;
const ERROR_HOTKEY_ALREADY_REGISTERED = 1409;

const HOTKEY_PROBE_ID = 0x4b57; // 探针用的 id（"KW"），注册后立刻注销

let win32 = null;
function loadWin32() {
  if (win32 !== null) return win32;
  try {
    const user32 = koffi.load("user32.dll");
    const kernel32 = koffi.load("kernel32.dll");
    win32 = {
      register: user32.func(
        "int __stdcall RegisterHotKey(void *hWnd, int id, unsigned int mods, unsigned int vk)"
      ),
      unregister: user32.func("int __stdcall UnregisterHotKey(void *hWnd, int id)"),
      lastError: kernel32.func("unsigned int __stdcall GetLastError()"),
    };
  } catch (err) {
    console.error("[hotkey] 加载 user32/kernel32 失败，冲突检测将不可用:", err.message);
    win32 = false;
  }
  return win32;
}

// ── 按键表 ─────────────────────────────────────────────────────────────────
// uiohook 的 keycode 是 PS/2 set-1 扫描码，Windows VK 是另一套，必须显式对应。
// 表里只收录「描述、监听、探针」三件事都能做对的键：字母/数字/F1-F12/常用控制键。
// 不在表内的键一律判为「不支持」——宁可让用户换一个键，也不要出现
// 「看起来录进去了、实际监听不到」这种最难查的问题。
const KEY_TABLE = (() => {
  const t = new Map();
  const add = (keycode, name, vk) => t.set(keycode, { keycode, name, vk });
  // 扫描码与 VK 都显式列出（不要用偏移运算推导，那种写法算错了也看不出来）
  const pairs = (startScan, vks, names) =>
    names.forEach((name, i) => add(startScan + i, name, vks[i]));

  add(1, "Esc", 0x1b);
  pairs(2, [0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x30], "1234567890".split(""));
  add(12, "-", 0xbd);
  add(13, "=", 0xbb);
  add(14, "Backspace", 0x08);
  add(15, "Tab", 0x09);
  pairs(16, [0x51, 0x57, 0x45, 0x52, 0x54, 0x59, 0x55, 0x49, 0x4f, 0x50], "QWERTYUIOP".split(""));
  add(26, "[", 0xdb);
  add(27, "]", 0xdd);
  add(28, "Enter", 0x0d);
  pairs(30, [0x41, 0x53, 0x44, 0x46, 0x47, 0x48, 0x4a, 0x4b, 0x4c], "ASDFGHJKL".split(""));
  add(39, ";", 0xba);
  add(40, "'", 0xde);
  add(41, "`", 0xc0);
  add(43, "\\", 0xdc);
  pairs(44, [0x5a, 0x58, 0x43, 0x56, 0x42, 0x4e, 0x4d], "ZXCVBNM".split(""));
  add(51, ",", 0xbc);
  add(52, ".", 0xbe);
  add(53, "/", 0xbf);
  add(55, "Numpad*", 0x6a);
  add(57, "Space", 0x20);
  add(58, "CapsLock", 0x14);
  [0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79].forEach((vk, i) =>
    add(59 + i, `F${i + 1}`, vk)
  );
  add(69, "NumLock", 0x90);
  add(70, "ScrollLock", 0x91);
  add(87, "F11", 0x7a);
  add(88, "F12", 0x7b);
  Array.from({ length: 12 }, (_, i) => 0x7c + i).forEach((vk, i) => add(91 + i, `F${i + 13}`, vk));

  return t;
})();

// 会被 shell / 系统截走的组合键。RegisterHotKey 探针查不到它们
// （它们不是通过 RegisterHotKey 注册的），必须单独拦。
const SHELL_RESERVED = new Map([
  ["Alt+Tab", "系统用于切换窗口"],
  ["Alt+Shift+Tab", "系统用于反向切换窗口"],
  ["Alt+Esc", "系统用于切换窗口"],
  ["Alt+F4", "系统用于关闭窗口"],
  ["Alt+Space", "系统窗口菜单"],
  ["Alt+PrintScreen", "系统截图"],
  ["Ctrl+Esc", "系统开始菜单"],
  ["Ctrl+Shift+Esc", "系统任务管理器"],
  ["Ctrl+Alt+Delete", "系统安全界面（无法拦截）"],
  ["Ctrl+Alt+Esc", "系统任务管理器"],
  ["Ctrl+Shift+Tab", "常规标签页切换"],
  ["Meta+L", "系统锁屏"],
  ["Meta+Tab", "系统任务视图"],
]);

export const MODIFIER_KEYS = ["alt", "ctrl", "shift", "meta"];

export const getKeyInfo = (keycode) => KEY_TABLE.get(Number(keycode)) || null;

export const getKeyList = () =>
  [...KEY_TABLE.values()].sort((a, b) => a.keycode - b.keycode).map((k) => ({ ...k }));

/** 修饰键前缀（固定顺序，便于显示与去重比较） */
const modPrefix = (hotkey = {}) =>
  [
    hotkey.ctrl ? "Ctrl" : "",
    hotkey.alt ? "Alt" : "",
    hotkey.shift ? "Shift" : "",
    hotkey.meta ? "Meta" : "",
  ]
    .filter(Boolean)
    .join("+");

/** 把 hotkey 渲染成给人看的字符串，如 "Alt + D"。键未知时返回空串。 */
export function describeHotkey(hotkey = {}) {
  const info = getKeyInfo(hotkey.keycode);
  if (!info) return "";
  const mods = [hotkey.ctrl && "Ctrl", hotkey.alt && "Alt", hotkey.shift && "Shift", hotkey.meta && "Meta"]
    .filter(Boolean);
  return [...mods, info.name].join(" + ");
}

/** 归一化：只保留已知字段，keycode 转成数字。 */
export function normalizeHotkey(hotkey = {}) {
  return {
    alt: !!hotkey.alt,
    ctrl: !!hotkey.ctrl,
    shift: !!hotkey.shift,
    meta: !!hotkey.meta,
    keycode: Number(hotkey.keycode),
  };
}

// ── 修饰键状态跟踪 ──────────────────────────────────────────────────────────
//
// ⚠️ 为什么不直接用事件自带的 altKey / ctrlKey / shiftKey / metaKey：
//   实测 libuiohook 在 Windows 上**不一定会填 altKey**。用 keybd_event 合成
//   「按下 Alt → 按下 Shift → 按下 F9」时，收到的事件是：
//     {"altKey":false, ..., "keycode":56}   ← Alt 自己按下，altKey 仍是 false
//     {"altKey":false, "shiftKey":true, ..., "keycode":42}
//     {"altKey":false, "shiftKey":true, ..., "keycode":67}  ← 按住 Alt 时按 F9，altKey 还是 false
//   Shift 正常、Alt 失灵（Windows 那边 Alt 走的是 LLKHF_ALTDOWN 标记，合成事件不带该标记）。
//   后果：默认热键 Alt+D 永远匹配不上 —— 症状同样是「按了没反应」，且极难查。
//   因此这里自己按 keydown/keyup 维护一份修饰键状态，并**与事件标志取并集**
//   （任一来源说按下了就算按下：既绕开 Alt 失灵，也不丢事件标志本身的信息）。
const MODIFIER_KEYCODES = new Map([
  [56, "alt"], // Alt
  [3640, "alt"], // AltRight
  [29, "ctrl"], // Ctrl
  [3613, "ctrl"], // CtrlRight
  [42, "shift"], // Shift
  [54, "shift"], // ShiftRight
  [3675, "meta"], // Meta
  [3676, "meta"], // MetaRight
]);

// uiohook 的 EventType.EVENT_KEY_RELEASED = 5。
// 这里写字面量而不是 import 那个枚举，是为了让本模块在纯 Node 测试里
// 不必加载原生模块（hotkey.js 的其它部分都要能在无 Electron 环境下跑）。
const EVENT_KEY_RELEASED = 5;

/** 是否是我们跟踪的修饰键 */
export const isModifierKeycode = (keycode) => MODIFIER_KEYCODES.has(keycode);

/**
 * 创建一个修饰键状态跟踪器。
 * 用法：keydown/keyup 事件都喂给 update()，再把返回的 effective 值传给 matchesHotkey。
 */
export function createModifierTracker() {
  const held = { alt: false, ctrl: false, shift: false, meta: false };

  return {
    held,
    reset() {
      held.alt = held.ctrl = held.shift = held.meta = false;
    },
    /**
     * 更新状态并返回「本次事件生效的」修饰键。
     * @param {object} event uiohook 键盘事件（需含 type / keycode / altKey...）
     */
    update(event) {
      const mod = MODIFIER_KEYCODES.get(event?.keycode);
      if (mod) {
        held[mod] = event.type !== EVENT_KEY_RELEASED;
      }
      return {
        alt: held.alt || !!event?.altKey,
        ctrl: held.ctrl || !!event?.ctrlKey,
        shift: held.shift || !!event?.shiftKey,
        meta: held.meta || !!event?.metaKey,
      };
    },
  };
}

/**
 * 判断一个 uiohook 键盘事件是否命中指定热键。
 *
 * 放在这里（而不是 capture.js 内部）是为了能被测试直接引用 ——
 * 这是整个取词链路的判定核心，必须有真实覆盖。
 * 修饰键用**严格相等**：没要求按下的修饰键也必须确实没按下，
 * 否则 Ctrl+Shift+D 也会被 Alt+D 命中。
 *
 * @param {object} event uiohook 键盘事件
 * @param {object} hotkey {alt,ctrl,shift,meta,keycode}
 * @param {object} [mods] 生效的修饰键状态（来自 createModifierTracker）；
 *                        不传则退回读事件自带的标志位
 */
export function matchesHotkey(event, hotkey, mods) {
  if (!event || !hotkey || typeof hotkey.keycode !== "number") return false;
  const m =
    mods ||
    {
      alt: !!event.altKey,
      ctrl: !!event.ctrlKey,
      shift: !!event.shiftKey,
      meta: !!event.metaKey,
    };
  return (
    !!m.alt === !!hotkey.alt &&
    !!m.ctrl === !!hotkey.ctrl &&
    !!m.meta === !!hotkey.meta &&
    !!m.shift === !!hotkey.shift &&
    event.keycode === hotkey.keycode
  );
}

/**
 * 合法性校验（不发系统调用，可在渲染进程侧直接调）。
 * @returns {{ok:boolean, level:'ok'|'error'|'warning', reason:string}}
 */
export function validateHotkey(hotkey) {
  const hk = normalizeHotkey(hotkey);
  const info = getKeyInfo(hk.keycode);
  if (!info) {
    return {
      ok: false,
      level: "error",
      reason: "不支持的按键，请用字母、数字、F1–F12 或空格/回车等常用键",
    };
  }
  const modCount = MODIFIER_KEYS.filter((k) => hk[k]).length;
  if (modCount === 0) {
    return {
      ok: false,
      level: "error",
      reason: "至少要带一个修饰键（Ctrl / Alt / Shift / Win），否则打字会一直被拦截",
    };
  }
  // 只剩修饰键、没有主键的场景由 keycode 保证不会出现（表里没有纯修饰键）。
  if (hk.meta && info.name.length <= 2) {
    return {
      ok: false,
      level: "error",
      reason: "Win 组合键由系统占用（如 Win+D / Win+L / Win+R），请换用 Ctrl / Alt",
    };
  }
  const combo = `${modPrefix(hk)}+${info.name}`;
  const reserved = SHELL_RESERVED.get(combo);
  if (reserved) {
    return { ok: false, level: "error", reason: `该组合键被系统占用：${reserved}` };
  }
  return { ok: true, level: "ok", reason: "可以使用" };
}

/**
 * 冲突检测：校验 + 用 RegisterHotKey 探针查「是否已被别的程序占用」。
 * @returns {{ok:boolean, level:'ok'|'error'|'warning', reason:string, probed:boolean}}
 */
export function checkHotkeyConflict(hotkey) {
  const basic = validateHotkey(hotkey);
  if (!basic.ok) return { ...basic, probed: false };

  const hk = normalizeHotkey(hotkey);
  const info = getKeyInfo(hk.keycode);
  const api = loadWin32();
  if (!api) {
    return {
      ok: true,
      level: "warning",
      reason: "无法调用系统接口做占用检测（仅校验了格式）",
      probed: false,
    };
  }

  const mods =
    (hk.alt ? MOD_ALT : 0) |
    (hk.ctrl ? MOD_CONTROL : 0) |
    (hk.shift ? MOD_SHIFT : 0) |
    (hk.meta ? MOD_WIN : 0);

  let registered = 0;
  let err = 0;
  try {
    registered = api.register(null, HOTKEY_PROBE_ID, mods, info.vk);
    // ⚠️ 只在失败时读 GetLastError：成功时读到的是上一次的陈旧值
    if (!registered) err = api.lastError();
  } catch (dump) {
    return {
      ok: true,
      level: "warning",
      reason: "占用检测执行失败（仅校验了格式）",
      probed: false,
    };
  } finally {
    if (registered) {
      try {
        api.unregister(null, HOTKEY_PROBE_ID);
      } catch {
        /* ignore */
      }
    }
  }

  if (registered) {
    return { ok: true, level: "ok", reason: `${describeHotkey(hk)} 当前没有被其他程序占用`, probed: true };
  }
  if (err === ERROR_HOTKEY_ALREADY_REGISTERED) {
    return {
      ok: false,
      level: "error",
      reason: `${describeHotkey(hk)} 已被其他程序或系统占用，请换一个组合键`,
      probed: true,
    };
  }
  return {
    ok: false,
    level: "error",
    reason: `系统拒绝了该组合键（错误码 ${err}），请换一个`,
    probed: true,
  };
}
