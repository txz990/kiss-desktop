// 词典查询：为「单词级」翻译补充音标与发音信息（对应浮窗里 英/美 音标 + 喇叭）。
//
// 数据源是有道公开词典接口（实测可用）：
//   GET https://dict.youdao.com/jsonapi?q=<word>
//     → ec.word[0].ukphone / usphone  = 英音 / 美音 音标
//       ec.word[0].trs                = 释义
//   GET https://dict.youdao.com/dictvoice?audio=<word>&type=1|2
//     → 发音音频（audio/mpeg，英音约 14KB / 美音约 12KB，1=英 2=美）
//
// 只在「看起来是一个词/短语」时才查。整句话去查词典既浪费请求也没有音标，
// 那种情况交给渲染进程的系统 TTS 朗读（见 src/ui/speech.js）。

const DICT_API = "https://dict.youdao.com/jsonapi";
const VOICE_API = "https://dict.youdao.com/dictvoice";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** 是否是值得查词典的输入：纯英文单词或短语（最多 3 个词），不含标点句尾。 */
export function isLookupableWord(text = "") {
  const t = String(text).trim();
  if (!t || t.length > 40) return false;
  if (!/^[A-Za-z][A-Za-z'’\- ]*$/.test(t)) return false;
  return t.split(/\s+/).length <= 3;
}

/** 发音音频地址：accent 为 "uk" | "us" */
export function speechUrl(word, accent = "us") {
  const type = accent === "uk" ? 1 : 2;
  return `${VOICE_API}?audio=${encodeURIComponent(String(word).trim())}&type=${type}`;
}

/**
 * 查询单词的音标与释义。
 * @returns {Promise<null | {word:string, ukphone:string, usphone:string, explains:string[], uk:string, us:string}>}
 *          查不到（网络失败 / 不是词条）返回 null —— 调用方据此降级，不要抛错。
 */
export async function lookupWord(text, { timeout = 6000 } = {}) {
  const word = String(text || "").trim();
  if (!isLookupableWord(word)) return null;

  let res;
  try {
    res = await fetch(`${DICT_API}?q=${encodeURIComponent(word)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  const entry = data?.ec?.word?.[0];
  if (!entry) return null;

  // 注意：trs[].tr[0].l.i 可能是**字符串数组**（不是字符串），必须摊平 ——
  // 直接当字符串用会得到一个数组，被后续的类型过滤整条丢掉，表现为"释义永远是空的"。
  const explains = (entry.trs || [])
    .flatMap((t) => {
      const i = t?.tr?.[0]?.l?.i;
      return Array.isArray(i) ? i : [i];
    })
    .filter((x) => typeof x === "string" && x.trim());

  const ukphone = String(entry.ukphone || "").trim();
  const usphone = String(entry.usphone || "").trim();
  // 既没有音标也没有释义 → 不算查到，避免浮窗出现一个空壳音标区
  if (!ukphone && !usphone && explains.length === 0) return null;

  return {
    word: entry["return-phrase"]?.l?.i || word,
    ukphone,
    usphone,
    explains: explains.slice(0, 3),
    uk: speechUrl(word, "uk"),
    us: speechUrl(word, "us"),
  };
}
