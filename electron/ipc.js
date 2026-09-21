// 主进程 ↔ 渲染进程 IPC 通道常量，避免字符串散落。
// ⚠️ 沙箱化 preload 无法 require 本文件（受限 require），
//    electron/preload.cjs 里内联了一份同样的常量 —— 改这里必须同步改那边。
export const IPC = {
  GET_CONFIG: "get-config",
  SAVE_CONFIG: "save-config",
  ENGINES: "get-engines",
  TRANSLATE: "translate",
  TRANSLATION: "translation",
  OPEN_SETTINGS: "open-settings",
  COPY_TO_TRANSLATE: "copy-to-translate",
  // 热键：键位清单（录制器用）、合法性+占用检测、保存并热更新
  HOTKEY_KEYS: "hotkey-keys",
  HOTKEY_CHECK: "hotkey-check",
  HOTKEY_APPLY: "hotkey-apply",
  // 取词服务状态（是否真的挂上钩子了）
  CAPTURE_STATUS: "capture-status",
  // 暂停/恢复取词（设置页录制热键时用：否则录制时按下当前热键会真的触发翻译并抢走焦点）
  CAPTURE_SET: "capture-set",
  // 词典查询（音标 / 释义 / 发音音频地址）
  DICT_LOOKUP: "dict-lookup",
  // 浮窗渲染进程已挂上 onTranslation 监听 —— 主进程收到后才可以安全推内容，
  // 否则消息会丢（新开窗口 / 渲染进程重载时表现为"浮窗一片空白"）。
  FLOATING_READY: "floating-ready",
  // 渲染进程已把刚收到的内容**提交到 DOM** / **真正画出一帧** —— 主进程据此决定
  // 何时 show() / 何时 setOpacity(1)（见 main.js onCaptured 里"显示时机"的说明）。
  TRANSLATION_PAINTED: "translation-painted",
  // 浮窗高度自适应：渲染进程量出卡片自然高度，窗口跟着长/缩（去透明后的配套）
  FLOAT_RESIZE: "float-resize",
};
