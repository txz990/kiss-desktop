# kiss-desktop

桌面划词翻译（Windows）。基于 [kiss-translator](https://github.com/fishjar/kiss-translator) 的翻译引擎，在任意本地程序里选中文字，按热键即可翻译，结果以无边框置顶浮窗显示。

![platform](https://img.shields.io/badge/platform-Windows-blue) ![license](https://img.shields.io/badge/license-GPL--3.0-green)

## 功能

- **全局热键取词**：默认 `Alt+D`（可改），在任何程序里选中文字后按下即翻译，无需切换窗口
- **剪贴板模式**：可选「复制即翻译」，监听剪贴板变化自动翻译（适合取不到词的程序）
- **无边框置顶浮窗**：显示原文、译文、单词音标（英/美），支持一键朗读与复制
- **发音**：英文单词用有道音频（英音/美音），整句或中文用系统 TTS
- **39+ 翻译引擎**：内置有道、微软、腾讯、火山、Yandex、DeepL 等，开箱即用；支持任意 OpenAI 兼容接口
- **开机自启动**：可选，开机后在托盘待命
- **单实例运行**：重复启动自动聚焦已有实例，不会弹出多个窗口

## 下载

到 [Releases](https://github.com/txz990/kiss-desktop/releases) 页面下载：

| 文件 | 适合 |
|---|---|
| `kiss-desktop-Setup-x.y.z.exe` | 常规安装（推荐），支持开机自启动 |
| `kiss-desktop-x.y.z-portable.exe` | 免安装单文件，下载即用 |

## 使用

1. 启动后程序驻留**系统托盘**（托盘图标可打开设置或退出）
2. 在任意程序里选中文字，按 `Alt+D`，浮窗显示翻译结果
3. 热键、引擎、发音、自启动等都在设置页调整

**翻译引擎**：默认使用有道免费翻译（免 Key、免注册，装完即可用）。想接入自己的模型，在设置页把引擎切换为「自定义接口」，填入任意 OpenAI 兼容端点的地址和 Key 即可。

**取词原理**：程序会模拟一次 `Ctrl+C` 复制选中文字（随后自动还原你的剪贴板），因此目标程序需处于可响应状态；以管理员身份运行的窗口取不到词，请改用剪贴板模式。

## 开发

```bash
npm install       # 安装依赖
npm run dev       # 开发模式（Vite 热更新 + Electron）
npm test          # 单元测试
npm run dist      # 打包 exe（输出在 dist/ 目录）
```

- 引擎层复用 kiss-translator 的 `src/apis/trans.js`（纯模块，零浏览器依赖），同步上游零冲突
- 桌面壳层（取词、热键、浮窗、托盘）为全新实现，见 `electron/`
- 上游 License 为 **GPL-3.0**，本项目同步 GPL-3.0，分发即开源

## License

[GPL-3.0](LICENSE)（与上游 kiss-translator 一致）
