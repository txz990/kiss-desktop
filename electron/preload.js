// 预加载脚本：通过 contextBridge 把受限的 IPC 能力暴露给渲染进程（window.desktop）。
// 不直接暴露 node/electron 模块，保持 contextIsolation 安全边界。
import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./ipc.js";

contextBridge.exposeInMainWorld("desktop", {
  getConfig: () => ipcRenderer.invoke(IPC.GET_CONFIG),
  saveConfig: (cfg) => ipcRenderer.invoke(IPC.SAVE_CONFIG, cfg),
  translate: (text) => ipcRenderer.invoke(IPC.TRANSLATE, text),
  openSettings: () => ipcRenderer.send(IPC.OPEN_SETTINGS),
  onTranslation: (cb) =>
    ipcRenderer.on(IPC.TRANSLATION, (_e, payload) => cb(payload)),
});
