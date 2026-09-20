// 桌面版（Electron 主进程 / Node）网络层：用原生 fetch 替代浏览器扩展的
// cache / request / requestStream / webextension-polyfill 整套耦合链。
// 契约与原 fetch.js 保持一致：fetchData 返回解析后的响应；fetchStream 逐条 yield SSE data 字段。

import { createSSEParser } from "./stream";

/**
 * 发起普通网络请求，返回解析后的响应数据。
 * @param {string} input 请求 URL。
 * @param {Object} [init] fetch 初始化参数（method/headers/body/signal）。
 * @returns {Promise<*>}
 */
export const fetchData = async (input, init = {}) => {
  if (!input || typeof input !== "string") {
    throw new Error("URL is empty");
  }
  const res = await fetch(input, init);
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!text) return "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * 发起 SSE 流式请求，逐条产出 data 字段内容。
 * @param {string} input 请求 URL。
 * @param {Object} [init] fetch 初始化参数。
 * @yields {string} SSE data 字段内容。
 */
export async function* fetchStream(input, init = {}) {
  if (!input || typeof input !== "string") {
    throw new Error("URL is empty");
  }
  const res = await fetch(input, init);
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    for (const data of createSSEParser()(text)) {
      if (data) yield data;
    }
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parseSSE = createSSEParser();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const data of parseSSE(chunk)) {
        if (data) yield data;
      }
    }
  } finally {
    for (const data of parseSSE("")) {
      if (data) yield data;
    }
  }
}
