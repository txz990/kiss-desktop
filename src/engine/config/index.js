// 桌面版 config 入口：只 re-export 引擎层真正需要的纯模块。
// 原 browser 版 src/config/index.js 还会 re-export storage.js / rules.js（带浏览器耦合），
// 桌面端不创建那些模块，避免污染依赖闭包。

export * from "./api";
export * from "./prompt";

// 原 client.js 定义的默认 User-Agent，桌面端直接内联，避免引入 client.js 的循环依赖。
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
