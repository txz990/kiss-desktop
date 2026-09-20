# kiss-desktop

桌面划词翻译（Windows）。基于 [kiss-translator](https://github.com/fishjar/kiss-translator) 的**纯引擎层**（`src/apis/trans.js`，零浏览器依赖），套一层 Electron 外壳，实现「在任意本地程序里划词 → 翻译 → 无边框置顶浮窗显示」。

## 为什么不是 fork

kiss-translator 本体是浏览器扩展，UI/取词/注入全部耦合在页面 DOM 里，桌面端用不上。本项目只复用其**翻译引擎**（39 家内置 API + 自定义 API 协议），其余全新建。上游 License 为 **GPL-3.0**，本项目同步 GPL-3.0，分发即开源。

## 架构分层

| 层 | 来源 | 处理方式 |
|---|---|---|
| 引擎层 `src/engine/apis/trans.js` | kiss-translator（原样复制） | 100% 复用 |
| UI 层 `src/ui/*` | 新建（React18 + MUI5） | ~70% 复用设计 |
| 桥接层 `src/engine/config/desktop.js` `electron/store.js` | 新建 | 替换 storage/runtime.sendMessage |
| 取词层 `electron/capture.js` | 全新 | uiohook-napi + koffi + 剪贴板 |
| 外壳层 `electron/main.js` | 全新 | 窗口/托盘/热键/IPC |

## 取词原理

全局热键（默认 `Alt+D`）→ 备份剪贴板 → 模拟 `Ctrl+C`（koffi `SendInput`）→ 等待 ~120ms → 读回选中文字 → 恢复剪贴板 → 调 `handleTranslate` → 浮窗渲染。

进阶可选：koffi 调 Win32 UI Automation `TextPattern` 直接取选中文本（不碰剪贴板）。

## 开发

```bash
npm install          # 或 pnpm install
npm run dev          # Vite dev + Electron 主进程
npm run build        # 打包 renderer
npm run dist         # electron-builder 出 exe
```

默认翻译接口指向本机 `http://localhost:17377/v1`（模型 gpt-5.5），可在设置页改为任意 OpenAI 兼容端点或内置 API。

## License

GPL-3.0（与上游一致）。
