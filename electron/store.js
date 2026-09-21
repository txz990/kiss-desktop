// 桌面版配置持久化：用 electron-store 替换浏览器扩展的 storage.local。
import Store from "electron-store";
import { DEFAULT_ENGINE_CONFIG } from "../src/engine/index.js";

const store = new Store({ name: "kiss-desktop" });

const DEFAULTS = {
  // 引擎配置（自定义 API v2 协议），默认指向本机 OpenAI 兼容端点。
  engine: { ...DEFAULT_ENGINE_CONFIG },
  // 取词热键，默认 Alt+D。
  //  keycode 用的是 uiohook 的扫描码（D = 32），不是 Windows VK —— 匹配时直接比 keycode。
  //  可在设置页点「录制」改键，保存后主进程会热更新，不用重启。
  hotkey: { alt: true, ctrl: false, meta: false, shift: false, keycode: 32 },
  // 复制即翻译（剪贴板监听模式）。
  copyToTranslate: false,
  // 发音：auto = 翻译完成后自动朗读原文；accent = 单词发音默认口音
  pronounce: { auto: false, accent: "us" },
  // 开机自启动（Windows 当前用户注册表 Run 键，见 main.js applyAutoLaunch）
  autoLaunch: false,
};

export const getConfig = () => {
  const cfg = store.get("config", {});
  return {
    engine: { ...DEFAULTS.engine, ...(cfg.engine || {}) },
    hotkey: { ...DEFAULTS.hotkey, ...(cfg.hotkey || {}) },
    copyToTranslate: cfg.copyToTranslate ?? DEFAULTS.copyToTranslate,
    pronounce: { ...DEFAULTS.pronounce, ...(cfg.pronounce || {}) },
    autoLaunch: cfg.autoLaunch ?? DEFAULTS.autoLaunch,
  };
};

export const saveConfig = (partial) => {
  const current = getConfig();
  const next = {
    engine: { ...current.engine, ...(partial.engine || {}) },
    hotkey: { ...current.hotkey, ...(partial.hotkey || {}) },
    copyToTranslate:
      partial.copyToTranslate !== undefined
        ? partial.copyToTranslate
        : current.copyToTranslate,
    pronounce: { ...current.pronounce, ...(partial.pronounce || {}) },
    autoLaunch:
      partial.autoLaunch !== undefined ? partial.autoLaunch : current.autoLaunch,
  };
  store.set("config", next);
  return next;
};
