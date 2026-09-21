// 慢引擎路径验证：确认"慢接口先亮翻译中、结果到了再换"这条链路没被改坏。
//
// 背景：修「翻译框闪一下」时把 onCaptured 拆成了两条路——
//   快引擎（有道 ~150ms）→ 等出结果，一次性显示，零闪烁；
//   慢引擎（本地大模型等）→ 先亮"翻译中"，结果到了再更新。
// 快路径已由 scripts/e2e-frames 验证；这里用**故意延迟 1.2 秒**的 mock 端点验证慢路径。
//
// ⚠️ 安全：本脚本把 userData 指到临时目录，绝不碰用户的正式配置
//    （否则会把用户配置里的引擎改成指向测试用的 mock 端口）。
//
// 用法：Remove-Item Env:\ELECTRON_RUN_AS_NODE; node_modules\electron\dist\electron.exe scripts\e2e-slow
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const DIR = path.join(__dirname, "frames");
fs.mkdirSync(DIR, { recursive: true });
const OUT = path.join(__dirname, "slow-result.txt");
const lines = [];
const log = (s) => {
  lines.push(s);
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { app, BrowserWindow, clipboard, screen } = require("electron");
// 独立 userData：测试用的引擎配置只写在这里
app.setPath("userData", path.join(os.tmpdir(), "kiss-desktop-slowtest"));

const PORT = 17998;
const DELAY_MS = 1200;
const server = http.createServer((req, res) => {
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      // 故意慢：模拟本地大模型 / 慢接口
      setTimeout(() => {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch {}
        const userMsg = parsed.messages?.find((m) => m.role === "user")?.content || "";
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: `[慢译]${userMsg}`, role: "assistant" } }] }));
      }, DELAY_MS);
    });
    return;
  }
  res.statusCode = 404;
  res.end("nf");
});

const VK_ALT = 0x12;
const VK_CTRL = 0x11;
const KEYEVENTF_KEYUP = 0x0002;
const koffi = require("koffi");
const user32 = koffi.load("user32.dll");
const keybd_event = user32.func("void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uint64 dwExtraInfo)");
const setCursorPos = user32.func("bool __stdcall SetCursorPos(int X, int Y)");
const down = (vk) => keybd_event(vk, 0, 0, 0);
const up = (vk) => keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);

const t0 = Date.now();
const now = () => Date.now() - t0;

const stats = (img) => {
  const bmp = img.toBitmap();
  const total = bmp.length / 4;
  let opaque = 0;
  let hash = 0;
  for (let i = 0; i < bmp.length; i += 4) {
    if (bmp[i + 3] > 8) opaque += 1;
    if (i % 148 === 0) hash = (hash * 31 + bmp[i] + bmp[i + 1] * 7 + bmp[i + 2] * 13) | 0;
  }
  return { pct: ((opaque / total) * 100).toFixed(1), hash };
};

async function main() {
  const store = await import("../../electron/store.js");
  const cfgModule = await import("../../src/engine/config/index.js");

  // 把引擎指到慢 mock 端点（只写进临时 userData 的 store）。
  // ⚠️ saveConfig 是**合并**语义：默认引擎（有道免费）的 reqHook/resHook/apiSlug
  //    会残留下来 —— 有道的 reqHook 会把请求改成 GET，mock 只认 POST，
  //    于是 404 → 引擎静默吞掉 → 译文为空（第一版测试就是这样空跑的）。
  //    换引擎时必须显式清掉这三个字段。
  store.saveConfig({
    engine: {
      apiType: cfgModule.OPT_TRANS_CUSTOMIZE,
      apiSlug: "",
      reqHook: "",
      resHook: "",
      url: `http://localhost:${PORT}/v1/chat/completions`,
      key: "test",
      model: "mock-slow",
    },
  });
  log(`已写入临时 store：引擎=${cfgModule.OPT_TRANS_CUSTOMIZE} url=http://localhost:${PORT}/... 延迟=${DELAY_MS}ms`);

  await import("../../electron/main.js");
  await sleep(2500);

  const float = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isAlwaysOnTop());
  if (!float) {
    log("FAIL 没找到浮窗");
    return;
  }
  log(`浮窗初始 bounds=${JSON.stringify(float.getBounds())} visible=${float.isVisible()}`);

  let shows = 0;
  const boundsLog = [];
  float.on("show", () => {
    shows += 1;
    boundsLog.push(`${now()}ms show bounds=${JSON.stringify(float.getBounds())}`);
  });
  float.on("resize", () => boundsLog.push(`${now()}ms resize bounds=${JSON.stringify(float.getBounds())}`));

  const target = new BrowserWindow({
    width: 520,
    height: 260,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  await target.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<html><body style="font:14px sans-serif">
         <textarea id="t" style="width:480px;height:120px">slow engine check</textarea></body></html>`
      )
  );
  target.show();
  target.focus();
  await sleep(500);

  const hk = store.getConfig().hotkey;
  const vks = [hk.ctrl && VK_CTRL, hk.alt && VK_ALT].filter(Boolean);

  const runRound = async (i) => {
    setCursorPos(400 + i * 300, 240 + i * 120);
    await target.webContents.executeJavaScript(
      `(() => { const t=document.getElementById('t');
                t.value=${JSON.stringify("slow round " + i)};
                t.focus(); t.setSelectionRange(0,t.value.length); return t.value; })()`
    );
    await target.focus();
    await clipboard.writeText("MARKER-SLOW-" + i);
    await sleep(350);
    log(`\n===== 第 ${i} 轮（慢引擎）=====`);

    float.once("show", () => {
      // 慢路径：show 时应是"翻译中"，之后结果才到
      for (const off of [0, 200, 600, 1500]) {
        setTimeout(async () => {
          if (float.isDestroyed() || !float.isVisible()) return;
          try {
            const img = await float.webContents.capturePage();
            const s = stats(img);
            const file = path.join(DIR, `slow_r${i}_show+${off}ms.png`);
            fs.writeFileSync(file, img.toPNG());
            log(`  show+${off}ms  不透明=${s.pct}%  指纹=${s.hash}  → ${path.basename(file)}`);
          } catch (e) {
            log(`  show+${off}ms  抓帧失败 ${e.message}`);
          }
        }, off);
      }
    });

    for (const vk of [...vks, 0x44]) down(vk);
    up(0x44);
    await sleep(300);
    for (const vk of [...vks].reverse()) up(vk);
    await sleep(4500);
    if (!float.isDestroyed()) float.hide();
    await sleep(800);
  };

  await runRound(1);
  await runRound(2);

  log(`\nshow 事件总数 = ${shows}（期望 2：每轮各一次）`);
  log(`\nbounds 变化：\n  ${boundsLog.join("\n  ") || "(无)"}`);
  const grew = new Set(boundsLog.map((s) => s.split("bounds=")[1]?.split(" ")[0]?.match(/\d+,"height":(\d+)/)?.[1]).filter(Boolean));
  log(`\n出现过的窗口高度集合 = {${[...grew].join(", ")}}  ${grew.size <= 1 ? "→ 不再一轮长一像素 ✓" : "→ 仍有尺寸漂移"}`);
  log("--- 结束 ---");
}

app.whenReady().then(async () => {
  setTimeout(() => app.exit(0), 90000);
  try {
    await new Promise((resolve) => server.listen(PORT, resolve));
    await main();
  } catch (e) {
    log("脚本抛错: " + (e && e.stack ? e.stack : String(e)));
  }
  server.close();
  app.exit(0);
});
