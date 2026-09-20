// 桌面版配置持久化：用 electron-store 替换浏览器扩展的 storage.local。
import Store from "electron-store";
import { DEFAULT_ENGINE_CONFIG } from "../src/engine/index.js";

const store = new Store({ name: "kiss-desktop" });

const DEFAULTS = {
  // 引擎配置（自定义 API v2 协议），默认指向本机 OpenAI 兼容端点。
  engine: { ...DEFAULT_ENGINE_CONFIG },
  // 取词热键，默认 Alt+D（uiohook keycode: D = 32）。
  hotkey: { alt: true, ctrl: false, meta: false, shift: false, keycode: 32 },
  // 复制即翻译（剪贴板监听模式）。
  copyToTranslate: false,
};

export const getConfig = () => {
  const cfg = store.get("config", {});
  return {
    engine: { ...DEFAULTS.engine, ...(cfg.engine || {}) },
    hotkey: { ...DEFAULTS.hotkey, ...(cfg.hotkey || {}) },
    copyToTranslate: cfg.copyToTranslate ?? DEFAULTS.copyToTranslate,
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
  };
  store.set("config", next);
  return next;
};
