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

check("自建引擎 YoudaoFree：虚拟 id 落到真实 apiType，且保留自己的 Hook", () => {
  const s = resolveApiSetting({ apiType: "YoudaoFree" });
  // id 必须落成 Custom，否则 genReqFuncs 找不到构造器
  assert.equal(s.apiType, OPT_TRANS_CUSTOMIZE);
  assert.ok(s.url.includes("youdao.com"), `url 应指向有道，实际 ${JSON.stringify(s.url)}`);
  // 关键：不能被桌面端默认的 OpenAI Hook 覆盖
  assert.ok(!s.reqHook.includes("chat"), "不应套用 OpenAI 的默认 Hook");
  assert.ok(s.reqHook.includes("youdao") || s.reqHook.includes("q="), "应是有道专用 Hook");
  assert.ok(s.resHook.includes("translation"), "应是有道专用解析 Hook");
  // 单位是秒（同 DEFAULT_HTTP_TIMEOUT 约定）
  assert.equal(s.httpTimeout, 30);
});

check("自建引擎 YoudaoFree：用户在设置页手写的 Hook 优先于预设", () => {
  const s = resolveApiSetting({ apiType: "YoudaoFree", reqHook: "(a) => ({ url: a.url })" });
  assert.equal(s.reqHook, "(a) => ({ url: a.url })");
});

check("自建引擎不影响「自定义接口」的默认 Hook 兜底", () => {
  const s = resolveApiSetting({ apiType: OPT_TRANS_CUSTOMIZE });
  // 默认 Hook 不硬编码端点（用的是 args.url），所以断言它的结构特征
  assert.ok(s.reqHook.includes("messages"), "自定义接口应拿到 OpenAI 兼容默认 Hook");
  assert.ok(s.reqHook.includes("args.url"), "应走 args.url 而不是写死地址");
  assert.ok(s.resHook.includes("choices"), "响应 Hook 应按 OpenAI 格式解析");
});

check("上游 Custom 预设里的调试占位 Hook 绝不能泄进兜底链", () => {
  // config/api.js 的 defaultRequestHook 只有 console.log、没有 return，
  // 一旦生效请求规格会退化成 {text,from,to} → 翻译不报错但译文为空。
  for (const input of [
    { apiType: OPT_TRANS_CUSTOMIZE },
    { apiType: OPT_TRANS_CUSTOMIZE, url: "http://x/v1/chat/completions" },
    {}, // 不带 apiType，走默认
  ]) {
    const s = resolveApiSetting(input);
    assert.ok(
      !s.reqHook.includes("request hook args"),
      `占位 Hook 泄漏了：${s.reqHook.slice(0, 60)}`
    );
    assert.ok(!s.reqHook.includes("console.log"), "Hook 不应是调试占位实现");
    assert.ok(s.reqHook.includes("url"), "Hook 必须返回带 url 的对象");
  }
});

console.log(`\n${passed} 项通过，退出码 ${process.exitCode || 0}`);
