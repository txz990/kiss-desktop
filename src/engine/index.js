// 桌面版引擎入口：在浏览器扩展的 handleTranslate 之上包一层简单易用的 translate()。
// 既支持内置引擎（谷歌/Bing/DeepL/Yandex/腾讯/火山 等，见 electron/engines.js），
// 也支持自建引擎（有道免费）与自定义接口（本机 OpenAI 兼容端点）。
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

// ── 桌面端自建引擎（上游没有的）──────────────────────────────────────────────
//
// 有道**不在** kiss-translator 的引擎清单里，所以不能靠 DEFAULT_API_LIST 白拿。
// 但它的公开接口（aidemo.youdao.com/trans）实测可用，于是用「自定义 Hook」机制接进来：
// 完全不需要改上游 src/engine/apis/trans.js，上游同步时零冲突。
//
// 约定：每个自建引擎有自己的 id（不复用 "Custom"），否则在下拉里会和
// 「自定义接口」撞值（Select 的 value 用的是 apiType）；id → 真实 apiType
// 的落点在 resolveApiSetting()。
//
// ⚠️ 这段必须在 DEFAULT_ENGINE_CONFIG **之前**定义（默认引擎就是它，见下）。
const YOUDAO_REQUEST_HOOK = `(args) => {
  // 有道的语言码与标准码不同：zh-CN → zh-CHS、zh-TW → zh-CHT，其余同名；
  // 源语言未指定时用 "Auto"（注意首字母大写）。
  const LANG = {
    "zh-CN": "zh-CHS", "zh-TW": "zh-CHT",
    "en": "en", "ja": "ja", "ko": "ko", "fr": "fr", "de": "de",
    "es": "es", "ru": "ru", "it": "it", "pt": "pt", "ar": "ar",
    "th": "th", "vi": "vi", "id": "id", "nl": "nl", "pl": "pl", "tr": "tr",
  };
  const from = LANG[args.fromLang] || "Auto";
  const to = LANG[args.toLang] || "Auto";
  const texts = args.texts || [];
  const url = args.url
    + "?q=" + encodeURIComponent(texts.join("\\n"))
    + "&from=" + from
    + "&to=" + to;
  return { url: url, method: "GET", headers: {} };
}`;

const YOUDAO_RESPONSE_HOOK = `({ res, texts }) => {
  const list = (res && res.translation) || [];
  const src = texts || [];
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const translated = list[i] !== undefined ? list[i] : (list[0] || "");
    out.push([translated, src[i]]);
  }
  return { translations: out };
}`;

export const DESKTOP_API_PRESETS = {
  YoudaoFree: {
    apiType: OPT_TRANS_CUSTOMIZE, // 复用「自定义 Hook」通道
    apiSlug: "youdao-free",
    url: "https://aidemo.youdao.com/trans",
    useStream: false,
    useBatchFetch: false,
    reqHook: YOUDAO_REQUEST_HOOK,
    resHook: YOUDAO_RESPONSE_HOOK,
    // 单位是**秒**（同 DEFAULT_HTTP_TIMEOUT 的约定），fetch 层会 ×1000。
    httpTimeout: 30,
  },
};

// 「自定义接口」（本机 LLM 等）的兜底配置。
// 必须与默认引擎**解耦**：默认引擎现在是有道，若「自定义接口」继承有道的地址，
// 就会出现「有道的 URL + OpenAI 的 Hook」这种自相矛盾的组合，一测就报错。
export const CUSTOM_API_FALLBACK = {
  url: "http://localhost:17377/v1/chat/completions",
  model: "gpt-5.5",
  httpTimeout: 30000,
};

// ── 默认引擎：有道免费翻译 ───────────────────────────────────────────────────
//
// 为什么默认用有道而不是本机 LLM：桌面包装完就该"打开即用"。
// 早期默认指向 `localhost:17377/v1`（本机 OpenAI 兼容端点），
// 结果是新用户第一次划词必然看到连接失败 —— 门槛太高，也不像成品。
// 有道免 Key、免注册、实测 130ms 返回，适合当默认；想用 LLM 的到设置页切「自定义接口」。
//
// ⚠️ apiType 用的是**自建引擎 id**（YoudaoFree），不是它内部落到的 "Custom" ——
//    resolveApiSetting() 负责把 id 翻译成真实 apiType，并带上有道自己的 Hook。
export const DEFAULT_ENGINE_CONFIG = {
  ...DESKTOP_API_PRESETS.YoudaoFree,
  apiType: "YoudaoFree",
  // 补齐引擎会用到的其余字段（有道预设里没写的那些）
  key: "",
  model: "",
  contextSize: 0,
  useContext: false,
  fetchInterval: 0,
  fetchLimit: 0,
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
 * 5) 自建引擎（DESKTOP_API_PRESETS）的 id 要落到 preset 里的真实 apiType，
 *    且**它的 Hook 优先于桌面端默认 Hook**（否则有道会被当成 OpenAI 端点）。
 */
export function resolveApiSetting(input = {}) {
  const requested = input.apiType || DEFAULT_ENGINE_CONFIG.apiType;
  const desktopPreset = DESKTOP_API_PRESETS[requested];
  const preset = desktopPreset || API_DEFAULTS.get(requested) || {};
  // 自建引擎的 id 在这里落到真实 apiType（如 YoudaoFree → "Custom"）
  const apiType = preset.apiType || requested;
  const userInput = stripEmptyStrings(input);

  const merged = { ...DEFAULT_ENGINE_CONFIG, ...stripEmptyStrings(preset), ...userInput, apiType };

  if (apiType === OPT_TRANS_CUSTOMIZE) {
    // 优先级：用户在设置页手写的 Hook > **自建引擎自带**的 Hook > 桌面端默认 Hook。
    // ⚠️ 这里只能用 desktopPreset.reqHook，**绝不能**用上游 Custom 预设的 reqHook ——
    //    上游那份是 `defaultRequestHook` 调试占位（只有 console.log、没有 return，
    //    见 config/api.js），一旦泄进兜底链，请求规格会退化成 {text,from,to}，
    //    表现为「翻译不报错但译文为空」。
    const presetHook = desktopPreset || {};
    merged.reqHook = userInput.reqHook || presetHook.reqHook || DEFAULT_REQUEST_HOOK;
    merged.resHook = userInput.resHook || presetHook.resHook || DEFAULT_RESPONSE_HOOK;

    // 「用户自己填地址」的那个「自定义接口」要单独兜底：
    // 它不该继承默认引擎（有道）的 url，否则会拿有道地址配 OpenAI Hook。
    // 自建引擎（desktopPreset 存在）不在此列 —— 它的 url 来自自己的预设。
    if (!desktopPreset) {
      merged.url = userInput.url || CUSTOM_API_FALLBACK.url;
      merged.model = userInput.model || CUSTOM_API_FALLBACK.model;
      merged.httpTimeout = userInput.httpTimeout || CUSTOM_API_FALLBACK.httpTimeout;
    }
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
