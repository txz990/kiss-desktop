// 预加载脚本：通过 contextBridge 把受限的 IPC 能力暴露给渲染进程（window.desktop）。
// 不直接暴露 node/electron 模块，保持 contextIsolation 安全边界。
//
// ⚠️ 为什么这个文件必须是 .cjs、且不能写 `import`：
//  1) Electron 的 preload **会忽略 package.json 的 "type": "module"**，.js 一律按 CommonJS 解析。
//     之前写成 `import ... from "electron"` → 语法错误 → preload 整个加载失败
//     → 渲染进程里 window.desktop 为 undefined → React 首屏就抛错 → 白屏。
//  2) 沙箱化 preload 的 require 是**受限 polyfill**，只允许 electron / events / timers / url，
//     **不能 require 相对路径文件**，所以这里的通道名无法从 ipc.js 复用，只能内联。
//
// 👉 约定：改动 IPC 通道名时，必须同步 electron/ipc.js 与本文件（两处保持一致）。
const { contextBridge, ipcRenderer } = require("electron");

// 与 electron/ipc.js 的 IPC 常量保持一致
const IPC = {
  GET_CONFIG: "get-config",
  SAVE_CONFIG: "save-config",
  ENGINES: "get-engines",
  TRANSLATE: "translate",
  TRANSLATION: "translation",
  OPEN_SETTINGS: "open-settings",
  COPY_TO_TRANSLATE: "copy-to-translate",
  HOTKEY_KEYS: "hotkey-keys",
  HOTKEY_CHECK: "hotkey-check",
  HOTKEY_APPLY: "hotkey-apply",
  CAPTURE_STATUS: "capture-status",
  CAPTURE_SET: "capture-set",
  DICT_LOOKUP: "dict-lookup",
  FLOATING_READY: "floating-ready",
  TRANSLATION_PAINTED: "translation-painted",
};

contextBridge.exposeInMainWorld("desktop", {
  getConfig: () => ipcRenderer.invoke(IPC.GET_CONFIG),
  saveConfig: (cfg) => ipcRenderer.invoke(IPC.SAVE_CONFIG, cfg),
  getEngines: () => ipcRenderer.invoke(IPC.ENGINES),
  translate: (text, engine) => ipcRenderer.invoke(IPC.TRANSLATE, text, engine),
  openSettings: () => ipcRenderer.send(IPC.OPEN_SETTINGS),
  // 热键相关
  getHotkeyKeys: () => ipcRenderer.invoke(IPC.HOTKEY_KEYS),
  checkHotkey: (hotkey) => ipcRenderer.invoke(IPC.HOTKEY_CHECK, hotkey),
  applyHotkey: (hotkey) => ipcRenderer.invoke(IPC.HOTKEY_APPLY, hotkey),
  getCaptureStatus: () => ipcRenderer.invoke(IPC.CAPTURE_STATUS),
  setCapture: (enabled) => ipcRenderer.invoke(IPC.CAPTURE_SET, !!enabled),
  // 词典查询（返回 null 表示不是词条或查询失败，调用方降级处理）
  lookupWord: (text) => ipcRenderer.invoke(IPC.DICT_LOOKUP, text),
  // 返回「取消订阅」函数，供 React useEffect 卸载时清理。
  // （若直接返回 ipcRenderer.on 的返回值，调用方拿到的是 ipcRenderer 对象而非函数，
  //   卸载时执行 off() 会抛 TypeError。）
  onTranslation: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(IPC.TRANSLATION, listener);
    return () => ipcRenderer.removeListener(IPC.TRANSLATION, listener);
  },
  // 浮窗卡片挂载完成（已注册 onTranslation）→ 通知主进程可以推内容了。
  notifyFloatingReady: () => ipcRenderer.send(IPC.FLOATING_READY),
  // 卡片已把译文提交到 DOM → 主进程收到后才 show()，避免先亮出上一轮的旧译文。
  ackTranslationPainted: () => ipcRenderer.send(IPC.TRANSLATION_PAINTED),
});
