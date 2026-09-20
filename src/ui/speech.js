// 朗读：渲染进程用 Web Speech API（Chromium 内置，底层走 Windows 的 SAPI）。
//
// 分工：
//   · 英文**单词** → 用有道音频（electron/dict.js 给的 uk/us 地址），音质更好且能区分英/美口音；
//   · 整句、中文及其它语言 → 用这里的系统 TTS。
// 本机实测已装的语音：en-US: David / Zira / Mark，zh-CN: Huihui / Kangkang / Yaoyao。

const LANG_RULES = [
  [/[\u4e00-\u9fff]/, "zh-CN"],
  [/[\u3040-\u30ff]/, "ja-JP"],
  [/[\uac00-\ud7af]/, "ko-KR"],
  [/[а-яА-Я]/, "ru-RU"],
];

/** 按内容猜一个合适的语言码。识别不出就用输入提示或 en-US。 */
export function guessLang(text, fallback = "en-US") {
  const t = String(text || "");
  for (const [re, lang] of LANG_RULES) if (re.test(t)) return lang;
  return fallback;
}

/** 运行环境是否支持语音合成 */
export function speechSupported() {
  return typeof window !== "undefined" && !!window.speechSynthesis;
}

/**
 * 列出可用语音。Chromium 的语音列表是**异步**填充的，
 * 首次同步调用 getVoices() 常返回空数组，因此这里等 voiceschanged 再给。
 */
export function listVoices({ timeout = 1500 } = {}) {
  return new Promise((resolve) => {
    if (!speechSupported()) return resolve([]);
    const now = window.speechSynthesis.getVoices();
    if (now && now.length) return resolve(now);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.speechSynthesis.onvoiceschanged = null;
      resolve(window.speechSynthesis.getVoices() || []);
    };
    window.speechSynthesis.onvoiceschanged = finish;
    setTimeout(finish, timeout);
  });
}

let currentAudio = null;

/** 停止一切正在进行的朗读（TTS + 音频） */
export function stopSpeaking() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
}

/**
 * 用系统 TTS 朗读文本。
 * @param {string} text
 * @param {{lang?:string, rate?:number, onEnd?:Function, onError?:Function}} [opts]
 */
export function speak(text, opts = {}) {
  const content = String(text || "").trim();
  if (!content || !speechSupported()) {
    opts.onError?.(new Error(speechSupported() ? "没有可朗读的内容" : "当前环境不支持语音合成"));
    return false;
  }
  stopSpeaking();
  try {
    const utter = new SpeechSynthesisUtterance(content);
    utter.lang = opts.lang || guessLang(content);
    utter.rate = opts.rate ?? 1;
    if (opts.onEnd) utter.onend = opts.onEnd;
    if (opts.onError) utter.onerror = opts.onError;
    // 选一个匹配语言的语音；找不到就让系统按 utter.lang 自己挑
    const voice = (window.speechSynthesis.getVoices() || []).find((v) =>
      (v.lang || "").toLowerCase().startsWith(utter.lang.slice(0, 2).toLowerCase())
    );
    if (voice) utter.voice = voice;
    window.speechSynthesis.speak(utter);
    return true;
  } catch (err) {
    opts.onError?.(err);
    return false;
  }
}

/**
 * 播放一段音频（有道发音 mp3）。失败时返回 false，由调用方决定要不要退回 TTS。
 * @returns {Promise<boolean>}
 */
export function playAudio(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    stopSpeaking();
    try {
      const audio = new Audio(url);
      currentAudio = audio;
      audio.onended = () => {
        currentAudio = null;
        resolve(true);
      };
      audio.onerror = () => {
        currentAudio = null;
        resolve(false);
      };
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          currentAudio = null;
          resolve(false);
        });
      }
    } catch {
      resolve(false);
    }
  });
}
