// 一次性 codemod：给引擎层/主进程里所有「相对导入」补上 .js 扩展名。
// 起因：上游 kiss-translator 走 webpack/vite，允许省略扩展名；
//      但 Node ESM 强制要求显式扩展名，否则 ERR_MODULE_NOT_FOUND。
// 目录导入（如 "../config"）会补成 "../config/index.js"。
import fs from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node fix-esm-ext.mjs <dir> [dir...]");
  process.exit(1);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(p, out);
    } else if (e.name.endsWith(".js") || e.name.endsWith(".jsx")) {
      out.push(p);
    }
  }
  return out;
}

// 匹配 import/export ... from "xxx"  以及动态 import("xxx")
const fromRe = /((?:from|import)\s*\(?\s*["'])(\.[^"']*)(["'])/g;

let total = 0;
for (const root of roots) {
  for (const file of walk(path.resolve(root))) {
    const dir = path.dirname(file);
    const before = fs.readFileSync(file, "utf8");
    let changed = false;
    const after = before.replace(fromRe, (m, head, spec, tail) => {
      if (/\.(js|jsx|mjs|cjs|json)$/.test(spec)) return m;
      const abs = path.resolve(dir, spec);
      let next;
      try {
        next = fs.statSync(abs).isDirectory() ? spec + "/index.js" : spec + ".js";
      } catch {
        next = spec + ".js";
      }
      changed = true;
      return head + next + tail;
    });
    if (changed) {
      fs.writeFileSync(file, after);
      console.log("fixed", path.relative(process.cwd(), file));
      total++;
    }
  }
}
console.log(`done, ${total} file(s) updated`);
