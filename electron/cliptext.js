// 剪贴板适配层：把 Electron 44 的破坏性变更收敛在这一个文件里。
//
// ── 为什么需要它（真实事故复盘）─────────────────────────────────────────────
// Electron 44 重写了 clipboard 模块，两条规则都变了：
//   1) **所有方法都异步化**。`readText()` / `writeText()` / `read()` / `write()` /
//      `has()` / `clear()` 一律返回 Promise。
//      同步写法拿到的不是字符串，而是 **Promise 对象**——它 truthy 且没有 .trim，
//      于是 `(cur || "").trim()` 既绕不过 `|| ""`（Promise 是 truthy），
//      又真的没有 trim 方法，直接抛 `xxx.trim is not a function`。
//      这是本仓库线上报过的一次崩溃，别再写 `clipboard.readText()` 的同步形态。
//   2) **8 个便捷方法被删掉**。writeHTML / writeImage / writeRTF / readHTML /
//      readImage / readRTF / availableFormats / writeBookmark 全部没了，
//      换成基于 MIME 的 ClipboardItem API。`typeof clipboard.writeHTML === "undefined"`。
//
//   另外 renderer 进程里 `clipboard` 模块整体不再暴露（渲染侧请走 navigator.clipboard）。
//
// ── 对外承诺 ────────────────────────────────────────────────────────────────
//   readClipboardText()  永远返回 **string**（读失败/空剪贴板返回 ""，绝不抛、绝不返回 Promise）
//   writeClipboardText() 尽力写入，失败只记日志不抛
//   snapshotClipboard() / restoreClipboard() 富文本无损备份/恢复（见下方说明）
//
// electron 用 createRequire 懒加载：这样本模块在纯 Node 环境（单元测试）也能被 import。
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

let cached = null;
/** 取 electron 里的 clipboard / ClipboardItem。纯 Node 下 require("electron")
 *  返回的是二进制路径字符串，所以这里一定要延迟到真正调用时才取值。 */
function clipApi() {
  if (!cached) cached = require_("electron");
  return cached;
}

/**
 * 把 readText() 的原始返回值收敛成字符串。
 * 抽成纯函数是为了能在**不开 Electron** 的情况下单测——这是本次崩溃的直接触发点，
 * 理应有一条回归测试盯着它。
 *
 * 只认 string：Promise / null / undefined / object / number 全当空串处理。
 */
export function asClipboardText(value) {
  return typeof value === "string" ? value : "";
}

/** 读纯文本，永远返回 string。 */
export async function readClipboardText() {
  try {
    const { clipboard } = clipApi();
    // await 兼顾两种形态：Electron ≥44 返回 Promise，更老的版本返回 string（await 也安全）
    return asClipboardText(await clipboard.readText());
  } catch (err) {
    // 剪贴板在某些竞态下（被别的程序独占）会偶发失败，取词不该因此崩掉
    console.error("[cliptext] readText 失败:", err?.message || err);
    return "";
  }
}

/** 写纯文本。失败只记日志。 */
export async function writeClipboardText(text) {
  try {
    const { clipboard } = clipApi();
    await clipboard.writeText(typeof text === "string" ? text : "");
    return true;
  } catch (err) {
    console.error("[cliptext] writeText 失败:", err?.message || err);
    return false;
  }
}

/**
 * 备份剪贴板的**全部格式**（不只是文本）。
 * 注意 Electron 44 有个坑：`clipboard.write()` **拒绝接收 read() 返回的原始对象**
 * （报 "cannot accept a ClipboardItem returned from clipboard.read()"），
 * 必须拿 getType() 读出 Blob 后重建一整套新的 ClipboardItem。
 *
 * @returns {Promise<object[]|null>} 快照；失败返回 null（调用方据此降级）
 */
export async function snapshotClipboard() {
  try {
    const { clipboard, ClipboardItem } = clipApi();
    if (typeof ClipboardItem !== "function") return null; // 老版本 Electron，走降级
    const items = await clipboard.read();
    const cloned = [];
    for (const item of items || []) {
      const record = {};
      for (const type of item.types || []) {
        try {
          record[type] = await item.getType(type);
        } catch {
          // 个别 MIME 读不出来就跳过这一个类型，别让整份快照报废
        }
      }
      if (Object.keys(record).length) cloned.push(new ClipboardItem(record));
    }
    return cloned;
  } catch (err) {
    console.error("[cliptext] 剪贴板快照失败:", err?.message || err);
    return null;
  }
}

/**
 * 恢复剪贴板。
 * 优先用富格式快照原样还原；拿不到快照时退化成「写回纯文本」，
 * 再不行就清空——总比把用户的东西换成错误的部位内容强。
 *
 * @param {object[]|null} snapshot snapshotClipboard() 的结果
 * @param {string} fallbackText 降级用的纯文本
 */
export async function restoreClipboard(snapshot, fallbackText = "") {
  try {
    const { clipboard } = clipApi();
    if (snapshot && snapshot.length) {
      await clipboard.write(snapshot);
      return "snapshot";
    }
    if (fallbackText) {
      await clipboard.writeText(fallbackText);
      return "text";
    }
    await clipboard.clear();
    return "cleared";
  } catch (err) {
    console.error("[cliptext] 剪贴板恢复失败:", err?.message || err);
    return "failed";
  }
}
