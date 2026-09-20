// 桌面版（Electron 主进程 / Node）网络层：用原生 fetch 替代浏览器扩展的
// cache / request / requestStream / webextension-polyfill 整套耦合链。
//
// 契约与上游 fetch 保持一致，但注意第三个参数：
//   handleTranslate 调用的是 fetchData(input, init, { useCache, usePool, fetchInterval,
//   fetchLimit, httpTimeout, signal }) —— 超时与取消信号都在**第三个参数**里，
//   只接两个参数会把它们全部丢掉（请求可能永久挂起）。
import { createSSEParser } from "./stream.js";

// 超时单位归一化 —— 与上游 libs/request.js 的 normalizeHttpTimeout 完全一致：
// 配置里 httpTimeout 默认是 30，单位是**秒**；旧配置可能是毫秒。
// 规则：> 600 视为毫秒，否则视为秒并 ×1000。
// ⚠️ 不做归一化会把 30 当成 30 毫秒 → 请求瞬间被中止（实测踩过这个坑）。
const normalizeHttpTimeout = (timeout) => {
  const t = Number(timeout) || 0;
  if (t <= 0) return 0;
  return t > 600 ? t : t * 1000;
};

const buildSignal = (signal, httpTimeout) => {
  const signals = [];
  if (signal) signals.push(signal);
  const ms = normalizeHttpTimeout(httpTimeout);
  if (ms > 0) signals.push(AbortSignal.timeout(ms));
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
};

const parseBody = async (res) => {
  const text = await res.text();
  if (!text) {
    // 空响应通常意味着参数不被接口接受（例如语言码传错），带上状态码更好排查。
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}（响应为空）`);
    return "";
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return JSON.parse(text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * 发起普通网络请求，返回解析后的响应数据。
 * @param {string} input 请求 URL。
 * @param {Object} [init] fetch 初始化参数（method/headers/body）。
 * @param {Object} [opts] 网络选项：signal / httpTimeout。
 * @returns {Promise<*>}
 */
export const fetchData = async (input, init = {}, opts = {}) => {
  if (!input || typeof input !== "string") {
    throw new Error("URL is empty");
  }
  const signal = buildSignal(opts.signal, opts.httpTimeout);
  const res = await fetch(input, signal ? { ...init, signal } : init);
  return parseBody(res);
};

/**
 * 发起 SSE 流式请求，逐条产出 data 字段内容。
 * @param {string} input 请求 URL。
 * @param {Object} [init] fetch 初始化参数。
 * @param {Object} [opts] 网络选项：signal / httpTimeout。
 * @yields {string} SSE data 字段内容。
 */
export async function* fetchStream(input, init = {}, opts = {}) {
  if (!input || typeof input !== "string") {
    throw new Error("URL is empty");
  }
  const signal = buildSignal(opts.signal, opts.httpTimeout);
  const res = await fetch(input, signal ? { ...init, signal } : init);
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
