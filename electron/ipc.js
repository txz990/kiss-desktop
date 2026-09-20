// 主进程 ↔ 渲染进程 IPC 通道常量，避免字符串散落。
export const IPC = {
  GET_CONFIG: "get-config",
  SAVE_CONFIG: "save-config",
  TRANSLATE: "translate",
  TRANSLATION: "translation",
  OPEN_SETTINGS: "open-settings",
  COPY_TO_TRANSLATE: "copy-to-translate",
};
