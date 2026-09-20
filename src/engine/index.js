// 桌面版引擎入口：在浏览器扩展的 handleTranslate 之上包一层简单易用的 translate()。
// 既支持内置引擎（谷歌/百度/Bing/DeepL/Yandex/腾讯/火山 等，见 electron/engines.js），
// 也支持自定义接口（默认对接本机 OpenAI 兼容端点 localhost:17377/v1，模型 gpt-5.5）。
// Hook 以字符串形式存储（与设置页、genTransReq 的 sval 求值保持一致）。

import { handleTranslate } from "./apis/trans.js";
import {
  DEFAULT_API_LIST,
  OPT_LANGS_FROM_SPEC,
  OPT_LANGS_SPEC_DEFAULT,
  OPT_LANGS_TO_SPEC,
  OPT_TRANS_CUSTOMIZE,
} from "./config/index.js";
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

// 内置引擎的默认配置表（数据源是引擎层自带的接口清单 DEFAULT_API_LIST）
const API_DEFAULTS = new Map(DEFAULT_API_LIST.map((x) => [x.apiType, x]));

// 统一语义：**空串 = 未配置**。
// 引擎层里「空串」和「没传」是不等价的（解构默认值 / `|| 默认值` 只认 undefined），
// 但内置接口清单 DEFAULT_API_LIST 给几乎每个字段都填了空串占位。若原样展开，
// 这些空串会把真正有用的兜底值全部覆盖掉 —— 实测踩过两次：
//   ① Google2 预设自带内置 Key（AIzaSy...），被设置页的 key:"" 覆盖后直接报废；
//   ② 预设的 systemPrompt:"" / nobatchPrompt:"" 覆盖了引擎自带的默认 Prompt，
//      发给模型的 messages 变成 [{"content":""},{"content":""}]，译文为空。
// 所以 preset 与用户表单里的空串一律剔除，由 DEFAULT_ENGINE_CONFIG + 引擎内置默认兜底。
// 注意只剔空串：useStream:false / contextSize:0 是「明确的配置」，必须保留。
const stripEmptyStrings = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === "") continue;
    out[k] = v;
  }
  return out;
};

/**
 * 把「设置页保存的引擎配置」解析成引擎可直接使用的 apiSetting。
 *
 * 关键点（踩过坑，别改）：
 * 1) 内置引擎的默认值必须覆盖桌面端通用兜底，否则 Google 的 url 会被
 *    DEFAULT_ENGINE_CONFIG 里的 localhost 盖掉。
 * 2) reqHook / resHook 只属于自定义接口：换成内置引擎必须清掉，
 *    否则这套 OpenAI 兼容 Hook 会被错误套用，把请求体改写成 chat/completions。
 * 3) 自定义接口的 Hook 用桌面端默认；config 里那份 defaultRequestHook 只是调试占位
 *    （只有 console.log，没有 return），不可用于生产。
 * 4) preset 与用户表单里的空串都不能参与覆盖，见 stripEmptyStrings。
 */
export function resolveApiSetting(input = {}) {
  const apiType = input.apiType || DEFAULT_ENGINE_CONFIG.apiType;
  const preset = API_DEFAULTS.get(apiType) || {};
  const userInput = stripEmptyStrings(input);

  const merged = { ...DEFAULT_ENGINE_CONFIG, ...stripEmptyStrings(preset), ...userInput, apiType };

  if (apiType === OPT_TRANS_CUSTOMIZE) {
    merged.reqHook = userInput.reqHook || DEFAULT_REQUEST_HOOK;
    merged.resHook = userInput.resHook || DEFAULT_RESPONSE_HOOK;
  } else {
    delete merged.reqHook;
    delete merged.resHook;
  }

  return merged;
}

/**
 * 翻译一段文本。
 * @param {string} text 待译文本
 * @param {Object} [opts]
 * @param {string} [opts.from='auto'] 源语言代码（标准码，如 en / auto）
 * @param {string} [opts.to='zh-CN'] 目标语言代码
 * @param {Object} [opts.apiSetting] 引擎配置（含 apiType；缺省则用桌面端默认自定义接口）
 * @param {AbortSignal} [opts.signal] 取消信号
 * @returns {Promise<{text:string, from:string}>}
 */
export async function translate(text, opts = {}) {
  const apiSetting = resolveApiSetting(opts.apiSetting);

  // 语言代码转换 —— 与上游 apis/index.js 的实现完全一致，这一步不能省：
  //   fromLang / toLang 是「标准码」（auto、zh-CN），供 Prompt 与 Hook 使用；
  //   from / to 是「该接口自己的代码」，必须查表得到。
  //   例：Microsoft 的 auto→""、zh-CN→zh-Hans；Tencent 的 zh-CN→zh；DeepLFree 的 ZH（大写）。
  //   不做转换的后果（实测踩过）：Microsoft 传 from=auto 直接返回空；
  //   Tencent 报 "Unrecognized target language: zh-CN"。
  const fromLang = opts.from || "auto";
  const toLang = opts.to || "zh-CN";
  const langMap = OPT_LANGS_TO_SPEC[apiSetting.apiType] || OPT_LANGS_SPEC_DEFAULT;
  const fromMap = OPT_LANGS_FROM_SPEC[apiSetting.apiType] || langMap;
  const from = fromMap.get(fromLang) ?? fromLang;
  const to = langMap.get(toLang);
  if (!to) {
    throw new Error(`目标语言「${toLang}」不被引擎 ${apiSetting.apiType} 支持`);
  }

  const parts = [];
  for await (const chunk of handleTranslate([text], {
    from,
    to,
    fromLang,
    toLang,
    langMap,
    apiSetting,
    docInfo: getDocInfo(),
    textFormat: "text",
    signal: opts.signal,
  })) {
    const piece = chunk?.result?.[0];
    if (piece) parts.push(piece);
  }

  return { text: parts.join(""), from: fromLang };
}

export { handleTranslate, OPT_TRANS_CUSTOMIZE };
