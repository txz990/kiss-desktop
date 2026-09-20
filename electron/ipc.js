// 主进程 ↔ 渲染进程 IPC 通道常量，避免字符串散落。
// ⚠️ 沙箱化 preload 无法 require 本文件（受限 require），
//    electron/preload.cjs 里内联了一份同样的常量 —— 改这里必须同步改那边。
export const IPC = {
  GET_CONFIG: "get-config",
  SAVE_CONFIG: "save-config",
  TRANSLATE: "translate",
  TRANSLATION: "translation",
  OPEN_SETTINGS: "open-settings",
  COPY_TO_TRANSLATE: "copy-to-translate",
};
