// 桌面版引擎入口：在浏览器扩展的 handleTranslate 之上包一层简单易用的 translate()。
// 默认对接本机 OpenAI 兼容端点（localhost:17377/v1，模型 gpt-5.5），
// 通过自定义 API v2 协议的 Request/Response Hook 适配 OpenAI chat/completions 格式。
// Hook 以字符串形式存储（与设置页、genTransReq 的 sval 求值保持一致）。

import { handleTranslate } from "./apis/trans.js";
import { OPT_TRANS_CUSTOMIZE } from "./config/index.js";
import { getDocInfo } from "./libs/docInfo.js";

// OpenAI 兼容端点的默认 Request Hook（reshape 成 chat/completions 请求）。
// 注意：hook 由 sval 解释执行，避免使用 async / 可选链 / 模板字符串。
const DEFAULT_REQUEST_HOOK = `(args) => {
  const body = {
    model: args.model,
    messages: [
      { role: "system", content: args.systemPrompt },
      { role: "user", content: args.userPrompt },
    ],
    temperature: 0,
    stream: false,
  };
  const headers = {
    "Content-type": "application/json",
    Authorization: "Bearer " + (args.key || ""),
  };
  return { url: args.url, method: "POST", headers: headers, body: body };
}`;

// OpenAI 兼容端点的默认 Response Hook（从 chat/completions 响应抽取译文）。
// 返回 [[译文, 原文]]，与引擎的 result 约定一致。
const DEFAULT_RESPONSE_HOOK = `({ res, texts }) => {
  const choice = res && res.choices && res.choices[0];
  const content = (choice && choice.message && choice.message.content) || "";
  return { translations: [[content, (texts && texts[0]) || ""]] };
}`;

// 默认引擎配置（用户可在设置页覆盖 url / key / model，或改用内置 API）。
export const DEFAULT_ENGINE_CONFIG = {
  apiType: OPT_TRANS_CUSTOMIZE,
  apiSlug: "desktop-default",
  url: "http://localhost:17377/v1/chat/completions",
  key: "",
  model: "gpt-5.5",
  useStream: false,
  useBatchFetch: false,
  reqHook: DEFAULT_REQUEST_HOOK,
  resHook: DEFAULT_RESPONSE_HOOK,
  contextSize: 0,
  useContext: false,
  fetchInterval: 0,
  fetchLimit: 0,
  httpTimeout: 30000,
};

/**
 * 翻译一段文本。
 * @param {string} text 待译文本
 * @param {Object} [opts]
 * @param {string} [opts.from='auto'] 源语言代码（标准码，如 en / auto）
 * @param {string} [opts.to='zh-CN'] 目标语言代码
 * @param {Object} [opts.apiSetting] 覆盖默认引擎配置
 * @param {AbortSignal} [opts.signal] 取消信号
 * @returns {Promise<{text:string, from:string}>}
 */
export async function translate(text, opts = {}) {
  const apiSetting = { ...DEFAULT_ENGINE_CONFIG, ...(opts.apiSetting || {}) };
  const from = opts.from || "auto";
  const to = opts.to || "zh-CN";

  const parts = [];
  for await (const chunk of handleTranslate([text], {
    from,
    to,
    fromLang: from,
    toLang: to,
    apiSetting,
    docInfo: getDocInfo(),
    textFormat: "text",
    signal: opts.signal,
  })) {
    const piece = chunk?.result?.[0];
    if (piece) parts.push(piece);
  }

  return { text: parts.join(""), from: from === "auto" ? "auto" : from };
}

export { handleTranslate, OPT_TRANS_CUSTOMIZE };
