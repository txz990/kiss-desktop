// headless 验证：起一个 mock 的 OpenAI 兼容端点，调用引擎层 translate() 跑通一次翻译。
// 不依赖真实 LLM，只验证 引擎层 + 自定义 API v2 协议（Request/Response Hook）在 Node 下可用。
import http from "node:http";
import { translate } from "../src/engine/index.js";
import { OPT_TRANS_CUSTOMIZE } from "../src/engine/config/index.js";

const PORT = 17999;

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {}
      const userMsg = parsed.messages?.find((m) => m.role === "user")?.content || "";
      // 假装翻译：把原文前后加方括号返回。
      const translated = `[译]${userMsg}`;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: translated, role: "assistant" } }],
        })
      );
    });
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

server.listen(PORT, async () => {
  console.log(`mock OpenAI endpoint on :${PORT}`);
  try {
    const res = await translate("Hello world", {
      apiSetting: {
        // ⚠️ 必须显式写 apiType：默认引擎是有道免费（走它自己的 Hook），
        // 不写 apiType 会落到有道那条链上，本测试就测不到 OpenAI 兼容通道了。
        apiType: OPT_TRANS_CUSTOMIZE,
        url: `http://localhost:${PORT}/v1/chat/completions`,
        key: "test",
        model: "mock",
      },
    });
    console.log("TRANSLATE_OK:", JSON.stringify(res));
    if (!res.text || !res.text.includes("[译]")) {
      console.error("TRANSLATE_UNEXPECTED:", res.text);
      process.exitCode = 1;
    }
  } catch (e) {
    console.error("TRANSLATE_FAIL:", e?.message || e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
