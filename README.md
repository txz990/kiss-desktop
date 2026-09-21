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

全局热键（默认 `Alt+D`）→ 备份剪贴板 → 等修饰键松开 → 模拟 `Ctrl+C`（koffi `keybd_event`）→ 自适应轮询读回选中文字 → 恢复剪贴板 → 调 `handleTranslate` → 浮窗渲染。

> ⚠️ 「等修饰键松开」不能省：真人按键是主键先松、修饰键后松，
> 不等就会把 `Ctrl+C` 送成 `Ctrl+Alt+C`，目标程序不复制 → 表现为「划词没反应」。

进阶可选：koffi 调 Win32 UI Automation `TextPattern` 直接取选中文本（不碰剪贴板）。

## 开发

```bash
npm install          # 或 pnpm install
npm run dev          # Vite dev + Electron 主进程
npm run build        # 打包 renderer
npm run dist         # electron-builder 出 exe
```

默认引擎是**有道免费翻译**（`aidemo.youdao.com`，免 Key、免注册、装完即可用）。
想用自己的模型，到设置页把引擎切成「自定义接口」，填任意 OpenAI 兼容端点（如本机 `http://localhost:17377/v1`，模型 `gpt-5.5`）。

## 浮窗显示时序（为什么不会"闪一下/弹两回"）

取词命中后的顺序是**固定的，别打乱**：

1. `translate()` 先跑，快引擎（有道 ~150ms）直接等出结果；
2. 结果推给渲染进程，等它 `flushSync` 落到 DOM 并回执（`translation-painted`）；
3. 这时才 `setPosition` + `show()` —— **窗口第一次亮出来就是完整译文**。

曾经「先 show 再推内容」的写法实测（`scripts/e2e-frames` 抓帧）：show+0ms 显示的是
**上一轮的旧译文**，show+40ms 塌成转圈，show+160ms 才换成新内容 —— 用户看到的就是
「翻译框闪一下 / 目视窗口开了两回」。另外两条防线：

- **单实例锁**（`app.requestSingleInstanceLock`）：没有它，重复启动的两个进程都挂全局钩子，
  按一次热键弹两个浮窗，肉眼同样是"开了两回"。
- **先隐藏再重显**：Windows 前台锁拒绝 `focus()` 时浮窗不触发 blur、会一直留在屏上；
  此时若"原地换内容+挪位置"，用户看到的还是两次视觉变化。所以重显前先 `hide()`。

## 排查问题

- 应用把浮窗生命周期写成日志：`%APPDATA%\kiss-desktop\float-events.log`
  （启动 / 取词命中 / 内容提交 / show / blur，只保留最后 400 行）。
  「窗口开两回」「闪一下」「按了没反应」这类时序问题，复现一次后直接看它。
- 取词链路另有控制台诊断开关：`KISS_DEBUG_CAPTURE=1`。
- `scripts/` 下有 4 个端到端复现脚本（真实 Electron 运行时）：`e2e-capture`（取词）、
  `e2e-app`（浮窗 show/hide 时序）、`e2e-frames`（逐帧抓图看首帧内容）、
  `e2e-slow`（慢引擎的"翻译中→结果"链路）。注意它们都要先清 `ELECTRON_RUN_AS_NODE`。

## License

GPL-3.0（与上游一致）。
