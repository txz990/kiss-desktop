// resolveApiSetting 的回归测试。
//
// 这几条规则都是用「翻译出来是空的」这种真实故障换来的，属于易回归点：
//   1) 设置页的空串不能覆盖内置默认（url / key）——否则 Google2 的内置 Key 会被冲掉、
//      Google 的地址会被冲成 ""。
//   2) 预设里的空 Prompt 字段要被剔除——否则模型收到空指令，译文为空。
//   3) reqHook / resHook 只能在自定义接口上出现——否则内置引擎的请求体被改写成 chat/completions。
//
// 用法：node scripts/test-resolve-setting.mjs
import assert from "node:assert/strict";
import { resolveApiSetting, DEFAULT_ENGINE_CONFIG, OPT_TRANS_CUSTOMIZE } from "../src/engine/index.js";

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    console.log(`FAIL  ${name}\n      ${e?.message || e}`);
    process.exitCode = 1;
  }
};

check("自定义接口：空 url 走桌面端默认 localhost，不被打成空串", () => {
  const s = resolveApiSetting({ apiType: OPT_TRANS_CUSTOMIZE, url: "", key: "", model: "" });
  assert.equal(s.url, DEFAULT_ENGINE_CONFIG.url);
  assert.equal(s.model, DEFAULT_ENGINE_CONFIG.model);
  assert.equal(typeof s.reqHook, "string");
  assert.equal(typeof s.resHook, "string");
});

check("自定义接口：用户填的值优先", () => {
  const s = resolveApiSetting({
    apiType: OPT_TRANS_CUSTOMIZE,
    url: "http://127.0.0.1:8080/v1/chat/completions",
    key: "sk-x",
    model: "qwen",
  });
  assert.equal(s.url, "http://127.0.0.1:8080/v1/chat/completions");
  assert.equal(s.key, "sk-x");
  assert.equal(s.model, "qwen");
});

check("自定义接口：空 Prompt 被剔除，交给引擎内置默认", () => {
  const s = resolveApiSetting({ apiType: OPT_TRANS_CUSTOMIZE, systemPrompt: "", userPrompt: "" });
  assert.equal(s.systemPrompt, undefined);
  assert.equal(s.userPrompt, undefined);
});

check("Google2：设置页 key:'' 不能冲掉内置 Key", () => {
  const s = resolveApiSetting({ apiType: "Google2", key: "" });
  assert.ok(s.key && s.key.length > 10, `内置 Key 应保留，实际 ${JSON.stringify(s.key)}`);
  assert.ok(s.url.includes("googleapis.com"), `内置 URL 应保留，实际 ${JSON.stringify(s.url)}`);
});

check("Google2：用户自备 Key 可覆盖内置 Key", () => {
  const s = resolveApiSetting({ apiType: "Google2", key: "my-own-key" });
  assert.equal(s.key, "my-own-key");
});

check("Microsoft：兜底出一个具体 URL，且不带 Hook（真实可用性由 probe-engines 验证）", () => {
  const s = resolveApiSetting({ apiType: "Microsoft" });
  // Microsoft 的预设 url 是空串（真实地址由 genMicrosoft 在代码里拼），
  // 空串被剔除后由 DEFAULT_ENGINE_CONFIG 兜底；该字段对 Microsoft 是惰性的。
  assert.equal(s.url, DEFAULT_ENGINE_CONFIG.url);
  assert.equal(s.reqHook, undefined);
  assert.equal(s.resHook, undefined);
});

check("内置引擎不得带 reqHook / resHook", () => {
  for (const apiType of ["Microsoft", "Google", "Tencent", "Volcengine", "Google2"]) {
    const s = resolveApiSetting({ apiType, reqHook: "x => x", resHook: "x => x" });
    assert.equal(s.reqHook, undefined, `${apiType} 不应有 reqHook`);
    assert.equal(s.resHook, undefined, `${apiType} 不应有 resHook`);
  }
});

check("预设里的空 Prompt 字段被剔除（回归：模型收到空指令 → 译文为空）", () => {
  for (const apiType of ["Microsoft", "Google", "Tencent", "Volcengine", "YandexFree", "DeepLFree"]) {
    const s = resolveApiSetting({ apiType });
    assert.notEqual(s.nobatchPrompt, "", `${apiType} 的 nobatchPrompt 不应是空串`);
    assert.equal(s.nobatchPrompt, undefined, `${apiType} 的 nobatchPrompt 应被剔除以便走默认`);
  }
});

check("明确的假值配置不能被当成「没填」丢掉", () => {
  const s = resolveApiSetting({
    apiType: OPT_TRANS_CUSTOMIZE,
    useStream: false,
    contextSize: 0,
    useContext: false,
  });
  assert.equal(s.useStream, false);
  assert.equal(s.contextSize, 0);
});

console.log(`\n${passed} 项通过，退出码 ${process.exitCode || 0}`);
