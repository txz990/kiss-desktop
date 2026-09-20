// 剪贴板适配层回归测试 —— 专盯那次线上崩溃。
//
// 事故回顾：Electron 44 把 clipboard 全异步化，`clipboard.readText()` 返回 Promise。
// 老代码写成同步形态 `(cur || "").trim()`：Promise 是 truthy，`|| ""` 兜不住，
// 于是真的调用了不存在的 trim —— 抛 "XXX.trim is not a function"。
//
// 这里验证两件事：
//   ① asClipboardText() 对任何脏输入都返回 string（尤其 Promise，不能被 took?||"" 蒙混过关）
//   ② readClipboardText() 在**没有 Electron 运行时**的环境也不炸，返回 ""
//      （保证其他模块在测试/降级路径下不会因为剪贴板把进程带崩）
//
// 用法：node scripts/test-cliptext.mjs
import { asClipboardText, readClipboardText } from "../electron/cliptext.js";

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures += 1;
};

// ── ① asClipboardText 的类型收敛 ────────────────────────────────────────────
check("正常字符串原样返回", asClipboardText("hello") === "hello");
check("空字符串返回空串", asClipboardText("") === "");
check("带空格的字符串保留", asClipboardText("  a b  ") === "  a b  ");

// 崩溃的真凶：一个 pending Promise。它 truthy，所以 `|| ""` 救不了你。
const pending = Promise.resolve("其实这里是文本");
check("Promise 不是 truthy 之后能用的东西：必须收敛成空串", typeof pending?.trim !== "function");
check("Promise -> 空串", asClipboardText(pending) === "");
await pending; // 消化掉，避免 Node 报 floating promise

check("null -> 空串", asClipboardText(null) === "");
check("undefined -> 空串", asClipboardText(undefined) === "");
check("对象 -> 空串", asClipboardText({ then: () => {} }) === "");
check("数组 -> 空串", asClipboardText(["a"]) === "");
check("数字 -> 空串", asClipboardText(123) === "");

// 收敛之后必须能安全 trim —— 这条直接对应当年那行 `(cur || "").trim()`
for (const v of [pending, null, undefined, {}, [], 0, 123]) {
  check(`asClipboardText(${typeof v}) 之后 .trim() 可用`, typeof asClipboardText(v).trim() === "string");
}

// ── ② readClipboardText 在无 Electron 运行时下必须软失败 ────────────────────
// 纯 Node 里 require("electron") 返回的是二进制路径字符串，取 clipboard 会失败；
// 取词链路不该因此把主进程带崩，返回空串即可。
const got = await readClipboardText();
check("无 Electron 运行时下 readClipboardText 返回空串", got === "", `实际=${JSON.stringify(got)}`);

console.log(`\n${failures === 0 ? "全部通过" : failures + " 项失败"}`);
process.exit(failures ? 1 : 0);
