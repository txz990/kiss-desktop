// 热键模块回归测试：按键表映射、可读化描述、合法性校验、冲突检测。
//
// 重点盯两处最容易悄悄写错的地方：
//   1) 扫描码 → VK 的映射（写错不会报错，只会让冲突检测给错答案）
//   2) 「只在失败时读 GetLastError」——成功时读到的是陈旧值（实测踩过）
//
// 用法：node scripts/test-hotkey.mjs
import assert from "node:assert/strict";
import {
  getKeyInfo,
  getKeyList,
  describeHotkey,
  validateHotkey,
  checkHotkeyConflict,
} from "../electron/hotkey.js";
import { CODE_TO_KEYCODE, eventToHotkey } from "../src/ui/hotkey-codes.js";

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (e) {
    console.log(`FAIL  ${name}\n      ${e?.message || e}`);
    process.exitCode = 1;
  }
};

check("按键表：字母 A–Z 全覆盖，且扫描码与 VK 正确对应", () => {
  const expect = {
    A: [30, 0x41], B: [48, 0x42], C: [46, 0x43], D: [32, 0x44], E: [18, 0x45],
    F: [33, 0x46], G: [34, 0x47], H: [35, 0x48], I: [23, 0x49], J: [36, 0x4a],
    K: [37, 0x4b], L: [38, 0x4c], M: [50, 0x4d], N: [49, 0x4e], O: [24, 0x4f],
    P: [25, 0x50], Q: [16, 0x51], R: [19, 0x52], S: [31, 0x53], T: [20, 0x54],
    U: [22, 0x55], V: [47, 0x56], W: [17, 0x57], X: [45, 0x58], Y: [21, 0x59],
    Z: [44, 0x5a],
  };
  for (const [name, [scan, vk]] of Object.entries(expect)) {
    const info = getKeyInfo(scan);
    assert.ok(info, `${name} 未收录（扫描码 ${scan}）`);
    assert.equal(info.name, name, `扫描码 ${scan} 的按键名应为 ${name}，实际 ${info.name}`);
    assert.equal(info.vk, vk, `${name} 的 VK 应为 0x${vk.toString(16)}，实际 0x${info.vk.toString(16)}`);
  }
});

check("按键表：数字 / F 键 / 常用控制键正确", () => {
  assert.equal(getKeyInfo(2).name, "1");
  assert.equal(getKeyInfo(11).name, "0");
  assert.equal(getKeyInfo(11).vk, 0x30, "0 的 VK 应是 0x30（不是 0x3A）");
  assert.equal(getKeyInfo(59).name, "F1");
  assert.equal(getKeyInfo(59).vk, 0x70);
  assert.equal(getKeyInfo(88).name, "F12");
  assert.equal(getKeyInfo(88).vk, 0x7b);
  assert.equal(getKeyInfo(28).name, "Enter");
  assert.equal(getKeyInfo(57).vk, 0x20, "空格的 VK 是 0x20");
});

check("按键表：不支持的键返回 null（不能瞎猜）", () => {
  // 这些是 uiohook 的扩展键（0xE0 前缀编码），本版本明确不支持
  for (const code of [3657, 57419, 3666, 3639, undefined, null, "x"]) {
    assert.equal(getKeyInfo(code), null, `keycode=${code} 不应被识别`);
  }
});

check("描述：Alt+D → 'Alt + D'，修饰键顺序固定", () => {
  assert.equal(describeHotkey({ alt: true, keycode: 32 }), "Alt + D");
  assert.equal(describeHotkey({ shift: true, ctrl: true, keycode: 32 }), "Ctrl + Shift + D");
  assert.equal(describeHotkey({ meta: true, alt: true, ctrl: true, shift: true, keycode: 88 }), "Ctrl + Alt + Shift + Meta + F12");
  assert.equal(describeHotkey({ keycode: 999 }), "", "未知键描述为空");
});

check("校验：没有修饰键 → 拒绝", () => {
  const r = validateHotkey({ keycode: 32 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /修饰键/);
});

check("校验：不支持的键 → 拒绝并说明", () => {
  const r = validateHotkey({ alt: true, keycode: 3657 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /不支持/);
});

check("校验：Win + 字母 → 拒绝（系统占用）", () => {
  const r = validateHotkey({ meta: true, keycode: 32 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Win|系统/);
});

check("校验：shell 保留组合键 → 拒绝", () => {
  for (const hk of [
    { alt: true, keycode: 15 },          // Alt+Tab
    { alt: true, keycode: 1 },           // Alt+Esc
    { ctrl: true, keycode: 1 },          // Ctrl+Esc
    { ctrl: true, shift: true, keycode: 1 }, // Ctrl+Shift+Esc
  ]) {
    const r = validateHotkey(hk);
    assert.equal(r.ok, false, `${describeHotkey(hk)} 应被拒绝`);
  }
});

check("校验：默认热键 Alt+D 通过", () => {
  const r = validateHotkey({ alt: true, keycode: 32 });
  assert.equal(r.ok, true, r.reason);
});

check("冲突检测：与 validateHotkey 的结论保持一致（非法组合直接返回）", () => {
  const r = checkHotkeyConflict({ keycode: 32 });
  assert.equal(r.ok, false);
  assert.equal(r.probed, false, "非法组合不该去探测系统");
});

check("冲突检测：自由组合键 → ok（真实调用 RegisterHotKey 探针）", () => {
  // Alt+Shift+F9 实测空闲
  const r = checkHotkeyConflict({ alt: true, shift: true, keycode: 67 });
  assert.equal(r.level, "ok", r.reason);
  assert.equal(r.probed, true, "应真的探测过");
});

check("冲突检测：换一个空闲组合键再测，结论稳定（证明探针注册后会注销）", () => {
  const a = checkHotkeyConflict({ alt: true, shift: true, keycode: 67 });
  const b = checkHotkeyConflict({ alt: true, shift: true, keycode: 67 });
  assert.equal(a.level, "ok");
  assert.equal(b.level, "ok", "连续探测同一组合键应都成功（探针必须自己注销）");
});

check("按键表：列表导出无重复扫描码", () => {
  const list = getKeyList();
  const codes = new Set(list.map((k) => k.keycode));
  assert.equal(codes.size, list.length, "存在重复的扫描码");
  assert.ok(list.length >= 60, `收录的键太少：${list.length}`);
});

// ── 跨模块一致性：渲染进程的 DOM 映射表 vs 主进程的扫描码表 ───────────────
// 这两张表改单边就会出问题（录制能录、监听匹配不上），必须有测试盯着。
check("渲染进程 hotkey-codes 的每个 code 都能在主进程表里查到", () => {
  const domMap = CODE_TO_KEYCODE;
  assert.ok(Object.keys(domMap).length >= 60, `DOM 映射表太小：${Object.keys(domMap).length}`);
  for (const [code, keycode] of Object.entries(domMap)) {
    const info = getKeyInfo(keycode);
    assert.ok(info, `code=${code} 映射到 keycode=${keycode}，但主进程表里没有这个扫描码`);
  }
});

check("渲染进程 hotkey-codes 的映射与主进程按键名一致（防单边改动）", () => {
  // 显式列出期望名，不要靠 code 反推 —— 标点键在表里用的是符号名（"-" "[" 等）
  const EXPECTED_NAME = {
    Escape: "Esc",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
    Semicolon: ";", Quote: "'", Backquote: "`", Comma: ",", Period: ".", Slash: "/",
  };
  const mismatch = [];
  for (const [code, keycode] of Object.entries(CODE_TO_KEYCODE)) {
    const info = getKeyInfo(keycode);
    if (!info) continue;
    const expected = code.startsWith("Key")
      ? code.slice(3)
      : code.startsWith("Digit")
        ? code.slice(5)
        : EXPECTED_NAME[code] || code;
    if (info.name !== expected) mismatch.push(`${code} → 表中名为 ${info.name}，期望 ${expected}`);
  }
  assert.equal(mismatch.length, 0, mismatch.join("; "));
});

check("渲染进程 hotkey-codes：绝不映射小键盘回车（扩展码无法匹配）", () => {
  assert.equal(CODE_TO_KEYCODE.NumpadEnter, undefined, "NumpadEnter 是扩展码 3612，不能映射到 28");
});

check("渲染进程 hotkey-codes：纯修饰键与未知键不产生热键", () => {
  for (const code of ["ShiftLeft", "ControlRight", "AltRight", "MetaLeft", "CapsLock", "Numpad5", "IntlBackslash"]) {
    assert.equal(eventToHotkey({ code, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false }), null,
      `${code} 不应被当成主键`);
  }
});

check("渲染进程 hotkey-codes：Alt+D 能被正确转换", () => {
  const hk = eventToHotkey({ code: "KeyD", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false });
  assert.deepEqual(hk, { alt: true, ctrl: false, shift: false, meta: false, keycode: 32 });
});

console.log(`\n${passed} 项通过，退出码 ${process.exitCode || 0}`);
