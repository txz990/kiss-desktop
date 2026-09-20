// 引擎目录：给设置页用的「可翻译引擎」清单。
//
// 数据源是引擎层自己导出的 DEFAULT_API_LIST（内置接口清单 + 各自默认 URL/Key/参数），
// 这里只负责补上中文名、分组、是否需要密钥 —— 不重复实现任何引擎逻辑。
//
// ⚠️ 免费引擎与本文件的关系：这些引擎的请求构造/响应解析全部在 src/engine/apis/trans.js
//    里已经实现（genGoogle / genBaidu / genMicrosoft / genDeeplFree / genYandexFree /
//    genTencent / genVolcengine）。桌面端没有浏览器 CORS 限制，反而比扩展版更省事。
import { DEFAULT_API_LIST, OPT_TRANS_CUSTOMIZE } from "../src/engine/config/index.js";
import { DESKTOP_API_PRESETS } from "../src/engine/index.js";

// 分组顺序：免费优先（按用户要求把免费的放在最前面）
export const ENGINE_GROUPS = [
  { key: "free", label: "免费引擎（无需 Key）" },
  { key: "ai", label: "大模型翻译（需 Key）" },
  { key: "local", label: "本地部署" },
  { key: "keyed", label: "其它需 Key" },
  { key: "custom", label: "自定义接口" },
];

const GROUP_ORDER = ENGINE_GROUPS.map((g) => g.key);

// 各引擎的中文名与说明；未列出的回退到 apiType。
// needsKey: 是否必须由用户填 Key 才能用（免费引擎都是 false）。
// needsModel: 是否必须填模型名。
const META = {
  // ── 免费（无需任何 Key）──
  Microsoft: { label: "微软翻译（Bing）", group: "free", hint: "Edge 内置通道，无需注册" },
  Google: { label: "谷歌翻译", group: "free", hint: "免费网页接口；需能访问 googleapis.com（可能要代理）" },
  DeepLFree: { label: "DeepL（免费）", group: "free", hint: "模拟官方 iOS 客户端；可能被限流" },
  YandexFree: { label: "Yandex 翻译（免费）", group: "free" },
  Tencent: { label: "腾讯翻译君", group: "free", hint: "内置通道" },
  Volcengine: { label: "火山翻译", group: "free", hint: "浏览器插件通道" },
  Google2: {
    label: "谷歌翻译 2（内置 Key）",
    group: "free",
    hint: "使用内置 Key，支持批量 HTML；需能访问 googleapis.com",
  },
  // 注意：百度（OPT_TRANS_BAIDU）**故意不收录**。上游已把它从 OPT_ALL_TRANS_TYPES
  // 移除（常量/构造器/解析器仍保留但不再对外提供），实测公开接口
  // fanyi.baidu.com/transapi 在本机返回空响应（浏览器端需靠 declarativeNetRequest
  // 改写 Origin 才能用）。收录它只会给用户一个「看着能选、实际不工作」的引擎。

  // ── 大模型（需自备 Key）──
  OpenAI: { label: "OpenAI", group: "ai", needsKey: true, needsModel: true },
  DeepSeek: { label: "DeepSeek", group: "ai", needsKey: true, needsModel: true },
  Gemini: { label: "谷歌 Gemini（原版接口）", group: "ai", needsKey: true, needsModel: true },
  Gemini2: { label: "谷歌 Gemini（OpenAI 兼容）", group: "ai", needsKey: true, needsModel: true },
  Claude: { label: "Anthropic Claude", group: "ai", needsKey: true, needsModel: true },
  SiliconFlow: { label: "硅基流动 SiliconFlow", group: "ai", needsKey: true, needsModel: true },
  XiaomiMimo: { label: "小米 MiMo", group: "ai", needsKey: true, needsModel: true },
  AliyunBailian: { label: "阿里云百炼", group: "ai", needsKey: true, needsModel: true },
  QwenMT: { label: "阿里云 Qwen-MT（专用翻译）", group: "ai", needsKey: true, needsModel: true },
  Cerebras: { label: "Cerebras", group: "ai", needsKey: true, needsModel: true },
  Zai: { label: "智谱 AI", group: "ai", needsKey: true, needsModel: true },
  OpenRouter: { label: "OpenRouter", group: "ai", needsKey: true, needsModel: true },
  OrcaRouter: { label: "OrcaRouter", group: "ai", needsKey: true, needsModel: true },
  OpenCodeGo: { label: "OpenCode Go", group: "ai", needsKey: true, needsModel: true },
  ePhoneAI: { label: "ePhone AI", group: "ai", needsKey: true, needsModel: true },
  CloudflareAI: { label: "Cloudflare Workers AI", group: "ai", needsKey: true, needsModel: true },

  // ── 本地部署 ──
  Ollama: { label: "Ollama（本地）", group: "local", needsKey: false, needsModel: true },

  // ── 其它需 Key 的专业翻译 API ──
  GoogleCloud: { label: "Google Cloud Translation", group: "keyed", needsKey: true },
  AzureAI: { label: "Azure 翻译", group: "keyed", needsKey: true },
  DeepL: { label: "DeepL 官方 API", group: "keyed", needsKey: true },
  Yandex: { label: "Yandex Cloud API", group: "keyed", needsKey: true },
  // DeepLX 其实**不需要 Key**，但需要自己先跑一个 DeepLX 服务并填它的地址，
  // 不是零配置开箱可用，所以留在本组；用 hint 说清楚，避免被组名误导。
  DeepLX: {
    label: "DeepLX（自建服务）",
    group: "keyed",
    needsKey: false,
    hint: "无需 Key，但要先自建 DeepLX 服务并把地址填到「接口 URL」",
  },

  // ── 自定义 ──
  [OPT_TRANS_CUSTOMIZE]: {
    label: "自定义接口（OpenAI 兼容 / 自写 Hook）",
    group: "custom",
    needsKey: false,
    hint: "填 URL + Key + 模型，用 Request/Response Hook 适配任意接口",
  },
};

// ── 桌面端自建引擎（上游没有，但公开接口可用）──
// 实现放在 src/engine/index.js 的 DESKTOP_API_PRESETS（复用自定义 Hook 通道），
// 这里只负责给它一个中文名/分组，让它和内置引擎一样出现在下拉里。
// 注意这些引擎的 apiType 是「虚拟 id」（如 YoudaoFree），由 resolveApiSetting
// 映射到真实的 apiType（Custom）—— 这样下拉里不会和「自定义接口」撞值。
const DESKTOP_META = {
  YoudaoFree: {
    label: "有道翻译（免费）",
    group: "free",
    hint: "公开接口，无需注册；多段文本按行合并发送",
  },
};

const DESKTOP_ENGINES = Object.entries(DESKTOP_API_PRESETS).map(([id, preset]) => {
  const m = DESKTOP_META[id] || {};
  return {
    apiType: id,
    apiSlug: preset.apiSlug || id,
    label: m.label || id,
    group: m.group || "free",
    hint: m.hint || "",
    needsKey: !!m.needsKey,
    needsModel: !!m.needsModel,
    // 保留虚拟 id：resolveApiSetting 认它
    preset: { ...preset, apiType: id },
  };
});

// 浏览器专有、Node 下不可用的引擎（Chrome 内置 Gemini AI），直接排除。
const UNSUPPORTED = new Set(["BuiltinAI"]);

function buildEngine(preset) {
  const apiType = preset.apiType;
  const m = META[apiType] || {};
  const group = m.group || "keyed";
  // 自定义接口的 Hook 用桌面端默认，不要带出 config 里那份「调试占位 Hook」。
  const cleaned = { ...preset };
  if (apiType === OPT_TRANS_CUSTOMIZE) {
    delete cleaned.reqHook;
    delete cleaned.resHook;
  }
  return {
    apiType,
    apiSlug: preset.apiSlug || apiType,
    label: m.label || apiType,
    group,
    hint: m.hint || "",
    needsKey: !!m.needsKey,
    needsModel: !!m.needsModel,
    preset: cleaned,
  };
}

export const ENGINES = [
  ...DESKTOP_ENGINES,
  ...DEFAULT_API_LIST.filter((x) => !UNSUPPORTED.has(x.apiType)).map(buildEngine),
].sort((a, b) => {
  const d = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
  return d !== 0 ? d : a.label.localeCompare(b.label, "zh-CN");
});

export const getEngine = (apiType) => ENGINES.find((e) => e.apiType === apiType);
