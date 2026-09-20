// Electron 44 剪贴板行为验证脚本（带 PASS/FAIL 断言）。
//
// 起因：线上报 `(cur || "").trim is not a function`。查下来是 Electron 44 把
// clipboard 全部异步化——readText() 返回 Promise，Promise 是 truthy 且没有 .trim。
// 这个脚本把当时的几条结论固化成断言，将来升级 Electron 时可以拿来复验。
//
// ⚠️ 运行环境有两个坑：
//   1) 必须先清掉 ELECTRON_RUN_AS_NODE，否则 electron.exe 退化成纯 Node，
//      require("electron") 拿到的是路径字符串，`app` 是 undefined。
//   2) Windows 上 GUI 进程 stdout 不一定回显，所以结果一律写文件。
//
// 用法：
//   Remove-Item Env:\ELECTRON_RUN_AS_NODE
//   node_modules\electron\dist\electron.exe scripts\probe-clipboard
//   然后读 scripts\probe-clipboard\probe-result.txt
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "probe-result.txt");
const lines = [];
let failures = 0;

const log = (s) => {
  lines.push(s);
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
};
const check = (name, ok, extra = "") => {
  log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures += 1;
};

const { app, clipboard, ClipboardItem } = require("electron");

/** write() 拒绝 read() 返回的原对象，必须拿 getType() 重建一份 */
async function cloneItems(items) {
  const out = [];
  for (const item of items) {
    const record = {};
    for (const type of item.types || []) {
      try {
        record[type] = await item.getType(type);
      } catch {
        /* 个别 MIME 读不出来就跳过 */
      }
    }
    if (Object.keys(record).length) out.push(new ClipboardItem(record));
  }
  return out;
}

async function main() {
  log(`--- Electron ${process.versions.electron} / Node ${process.versions.node} 剪贴板行为验证 ---`);

  // ① 异步化：readText 必须返回 Promise
  await clipboard.writeText("基准文本");
  const raw = clipboard.readText();
  check("readText() 返回 Promise（不是字符串）", typeof raw?.then === "function", `ctor=${raw?.constructor?.name}`);
  check("Promise 没有 .trim —— 这就是当年崩溃的形状", typeof raw?.trim !== "function");
  const text = await raw;
  check("await 之后是字符串", typeof text === "string", `value=${JSON.stringify(text)}`);

  // ② 空剪贴板必须得到 ""，不能是 null / undefined
  await clipboard.clear();
  check("空剪贴板 await 后是空串", (await clipboard.readText()) === "");

  // ③ 存量 API 盘点（Electron 44 删了 8 个便捷方法）
  const keys = Object.keys(clipboard).sort();
  check("只剩 6 个方法", keys.length === 6, `实际=${keys.join(", ")}`);
  check("writeHTML 已移除", typeof clipboard.writeHTML === "undefined");
  check("availableFormats 已移除", typeof clipboard.availableFormats === "undefined");
  check("ClipboardItem 可用", typeof ClipboardItem === "function");

  // ④ 富格式：写 text/plain + text/html
  await clipboard.write([
    new ClipboardItem({ "text/plain": "粗体内容", "text/html": "<b>粗体内容</b>" }),
  ]);
  const beforeTypes = (await clipboard.read()).map((i) => i.types);
  check(
    "能写出多 MIME 条目",
    beforeTypes.some((t) => t.includes("text/html")),
    `types=${JSON.stringify(beforeTypes)}`
  );

  // ⑤ 快照 → 临时占用 → 恢复，富格式必须还在
  const snapshot = await cloneItems(await clipboard.read());
  await clipboard.writeText("这是临时占位");
  const mid = await clipboard.readText();
  check("临时占位写进去了", mid === "这是临时占位", `readText=${JSON.stringify(mid)}`);

  await clipboard.write(snapshot);
  const afterTypes = (await clipboard.read()).map((i) => i.types);
  check("恢复后仍有 text/html", afterTypes.some((t) => t.includes("text/html")), `types=${JSON.stringify(afterTypes)}`);
  check("恢复后文本还原", (await clipboard.readText()) === "粗体内容");
  const htmlItem = (await clipboard.read()).find((i) => i.types.includes("text/html"));
  if (htmlItem) {
    const html = await (await htmlItem.getType("text/html")).text();
    check("恢复后 html 内容一致", html === "<b>粗体内容</b>", `html=${JSON.stringify(html)}`);
  }

  log(`--- 结束：${failures === 0 ? "全通过" : failures + " 项失败"} ---`);
}

app.whenReady().then(async () => {
  setTimeout(() => app.exit(failures ? 1 : 0), 25000); // 看门狗：卡住也能自退
  try {
    await main();
  } catch (e) {
    check("脚本本身未抛错", false, e && e.stack ? e.stack : String(e));
  }
  app.exit(failures ? 1 : 0);
});
