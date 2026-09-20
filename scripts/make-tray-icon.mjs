// 把代码里画的托盘图标落盘成 assets/tray.png。
//
// 为什么还要落盘：运行时本来就能在内存里生成（见 electron/tray-icon.js），
// 落盘是为了让用户有「直接替换 assets/tray.png 换图标」这个简单入口，
// 同时打包时 electron-builder 会把 assets/** 一起带上。
//
// 用法：node scripts/make-tray-icon.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTrayIconPng } from "../electron/tray-icon.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "assets");
mkdirSync(dir, { recursive: true });

for (const size of [16, 32, 64]) {
  const file = size === 32 ? "tray.png" : `tray@${size}.png`;
  const png = buildTrayIconPng(size);
  writeFileSync(path.join(dir, file), png);
  console.log(`wrote assets/${file}  ${png.length} bytes`);
}
