// 桌面版（Electron 主进程 / Node）适配：移除所有 DOM 依赖，改为纯 JS 实现。
// 原 browser 版依赖 DOMParser / document.createElement / trustedTypes，在 Node 下不可用。

const NAMED_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * 从 HTML 字符串抽取纯文本（桌面版用正则去标签，不依赖 DOM）。
 * @param {string} htmlStr
 * @param {string} skipTag
 * @returns {string}
 */
export const getHtmlText = (htmlStr, skipTag = "") => {
  if (!htmlStr || typeof htmlStr !== "string") return "";
  let s = htmlStr;
  if (skipTag) {
    const re = new RegExp(`<${skipTag}[^>]*>[\\s\\S]*?</${skipTag}>`, "gi");
    s = s.replace(re, "");
  }
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, (m) => NAMED_ENTITIES[m.toLowerCase()] || m)
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * 转义纯文本用于安全 HTML 渲染。
 * @param {string} str
 * @returns {string}
 */
export function escapeHTML(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 解码 HTML 实体为纯文本（纯 JS，支持命名实体与 &#NN; / &#xHH; 数字实体）。
 * @param {string} str
 * @returns {string}
 */
export function decodeHTMLEntities(str) {
  if (!str || typeof str !== "string") return str;
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gi, (m) => {
    const lower = m.toLowerCase();
    if (NAMED_ENTITIES[lower]) return NAMED_ENTITIES[lower];
    if (m[1] === "#") {
      const isHex = m[2] === "x" || m[2] === "X";
      const code = parseInt(isHex ? m.slice(3) : m.slice(2), isHex ? 16 : 10);
      return Number.isNaN(code) ? m : String.fromCodePoint(code);
    }
    return m;
  });
}

export const encodeHTMLTranslationText = (text) =>
  String(text || "").replace(/\r\n|\r|\n/g, "<br>");

export const decodeHTMLTranslationText = (text) =>
  decodeHTMLEntities(String(text || "").replace(/<br\s*\/?>[\t ]*/gi, "\n"));
