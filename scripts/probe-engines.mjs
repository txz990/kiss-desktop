// 探测各内置引擎在本机网络下是否真的可用。
//
// 用法：
//   node scripts/probe-engines.mjs                # 只测「无需 Key」的免费引擎
//   node scripts/probe-engines.mjs Baidu Google   # 指定引擎
//   node scripts/probe-engines.mjs --all          # 目录里全部引擎（含需 Key 的，多半会失败）
//
// 说明：这里只用每个引擎的「内置默认配置」试翻，不带用户 Key，
//      所以结果反映的是「零配置开箱可用性」。需 Key 的引擎失败是预期行为。
import { translate } from "../src/engine/index.js";
import { ENGINES } from "../electron/engines.js";

const TIMEOUT_MS = 15000;

const argv = process.argv.slice(2);
const freeTypes = ENGINES.filter((e) => e.group === "free").map((e) => e.apiType);
const targets = argv.includes("--all") ? ENGINES.map((e) => e.apiType) : argv.length ? argv : freeTypes;

console.log(`探测 ${targets.length} 个引擎（超时 ${TIMEOUT_MS}ms/个）\n`);

for (const apiType of targets) {
  const item = ENGINES.find((e) => e.apiType === apiType);
  if (!item) {
    console.log(`SKIP    ${apiType}（不在引擎目录中）`);
    continue;
  }
  const started = Date.now();
  try {
    const res = await translate("Hello world", {
      to: "zh-CN",
      apiSetting: { ...item.preset, apiType },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    const text = (res?.text || "").trim();
    const ok = text && !/^Hello world$/i.test(text);
    console.log(
      `${ok ? "OK     " : "EMPTY  "} ${apiType.padEnd(12)} ${String(ms).padStart(6)}ms  ${JSON.stringify(text.slice(0, 60))}`
    );
  } catch (e) {
    console.log(
      `FAIL   ${apiType.padEnd(12)} ${String(Date.now() - started).padStart(6)}ms  ${e?.message || e}`
    );
  }
}

console.log("\n完成。（EMPTY/FAIL 的引擎可能被墙、需要 Key，或接口已变更）");
