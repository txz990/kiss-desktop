import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Box, Paper, Typography, IconButton, Stack, CircularProgress, Tooltip } from "@mui/material";
import { ContentCopyIcon, CloseIcon, SettingsIcon, VolumeUpIcon, VolumeOffIcon } from "./icons.jsx";
import { playAudio, speak, stopSpeaking, guessLang } from "./speech.js";

// 浮窗译文卡片：接收主进程通过 IPC 推送的翻译结果。
//
// 发音走两条路（见 src/ui/speech.js 顶部说明）：
//   · 英文单词 → 有道音标 + 有道音频，能区分英/美口音、音质更好
//   · 整句 / 中文 → 系统 TTS
export default function FloatingCard() {
  const [state, setState] = useState({ text: "", result: "", from: "", loading: false, error: "" });
  const [dict, setDict] = useState(null);
  const [playing, setPlaying] = useState("");
  const pronounceRef = useRef({ auto: false, accent: "us" });
  // 词典查询是否已结束（成功或失败都算）。自动朗读必须等它落地，
  // 否则会先按"没有词典"用 TTS 读一遍、拿到音频后再读一遍 —— 朗读两次。
  const [dictReady, setDictReady] = useState(false);
  const autoPlayedRef = useRef("");

  useEffect(() => {
    const off = window.desktop.onTranslation((payload) => {
      // ⚠️ 必须用 flushSync 让这次更新**同步**落到 DOM，再回执给主进程。
      // 主进程要收到回执才 show() 浮窗；不回执的旧写法是"先 show 再 setState"，
      // 窗口第一眼看到的是**上一轮的旧译文**，几十毫秒后才跳成新内容 ——
      // 用户的原话就是「翻译框会闪一下 / 目视窗口开了两回」。
      // （抓帧实测：show+0 是旧译文 → show+40ms 变转圈 → show+160ms 才是新译文。）
      flushSync(() => {
        setState({
          text: payload.text || "",
          result: payload.result || "",
          from: payload.from || "",
          loading: !!payload.loading,
          error: payload.error || "",
        });
        setPlaying("");
      });
      stopSpeaking();
      // 回执①：内容已提交到 DOM（主进程据此知道"可以准备显示窗口了"）
      window.desktop.ackTranslationPainted?.("dom");
      // 回执②：等 Chromium **真正画出一帧**（双 rAF）再回执。
      // ⚠️ 透明窗口 show 的头几帧是逐层光栅化的：实拍（用户录屏逐帧抽帧）显示
      //    约 130ms 里只有文字、没有卡片背景，网页文字直接透过卡片 —— 用户
      //    看到的"闪一下/弹两回"就是它。主进程在这段时间让窗口全透明
      //    （setOpacity(0)），收到本回执才 setOpacity(1) 显形。
      //    （隐藏的窗口 rAF 不跑，所以必须等主进程 show 之后这里才会触发。）
      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.desktop.ackTranslationPainted?.("painted"))
      );
    });
    // 挂载即报名：主进程等这个信号才敢推内容（否则新窗口第一次取词会丢消息 → 空白）
    window.desktop.notifyFloatingReady?.();
    return () => {
      off && off();
      stopSpeaking();
    };
  }, []);

  // 发音设置（自动朗读开关 + 单词默认口音）
  useEffect(() => {
    window.desktop.getConfig().then((cfg) => {
      if (cfg?.pronounce) pronounceRef.current = cfg.pronounce;
    });
  }, []);

  // 新文本 → 查词典。主进程会判断"是否值得查"，查不到返回 null，这里据此降级。
  useEffect(() => {
    const text = state.text;
    setDictReady(false);
    autoPlayedRef.current = "";
    if (!text) {
      setDict(null);
      setDictReady(true);
      return undefined;
    }
    let alive = true;
    window.desktop
      .lookupWord(text)
      .then((d) => {
        if (alive) setDict(d);
      })
      .catch(() => {
        if (alive) setDict(null);
      })
      .finally(() => {
        if (alive) setDictReady(true);
      });
    return () => {
      alive = false;
    };
  }, [state.text]);

  // 单词发音：优先有道音频，失败退回系统 TTS
  const playAccent = async (accent) => {
    const key = `word-${accent}`;
    if (playing === key) {
      stopSpeaking();
      setPlaying("");
      return;
    }
    setPlaying(key);
    const ok = await playAudio(dict?.[accent]);
    if (!ok) {
      speak(dict?.word || state.text, {
        lang: accent === "uk" ? "en-GB" : "en-US",
        onEnd: () => setPlaying(""),
        onError: () => setPlaying(""),
      });
      return;
    }
    setPlaying("");
  };

  const toggle = (key, run) => {
    if (playing === key) {
      stopSpeaking();
      setPlaying("");
      return;
    }
    setPlaying(key);
    run();
  };

  const readSource = () =>
    toggle("source", () => speak(state.text, { onEnd: () => setPlaying(""), onError: () => setPlaying("") }));

  const readResult = () =>
    toggle("result", () =>
      speak(state.result, {
        lang: guessLang(state.result, "zh-CN"),
        onEnd: () => setPlaying(""),
        onError: () => setPlaying(""),
      })
    );

  // 翻译完成后自动朗读原文（可选，设置页开关）。
  // 两个前提：词典查询已结束（否则会朗读两次，见 dictReady 注释）、同一段文本只自动读一次。
  useEffect(() => {
    const { auto, accent } = pronounceRef.current;
    if (!auto || !dictReady || !state.text || state.loading || state.error) return undefined;
    if (autoPlayedRef.current === state.text) return undefined;
    autoPlayedRef.current = state.text;
    const t = setTimeout(() => {
      const audio = accent === "uk" ? dict?.uk : dict?.us;
      if (audio) {
        setPlaying(`word-${accent}`);
        playAudio(audio).then((ok) => {
          if (ok) {
            setPlaying("");
            return;
          }
          speak(dict?.word || state.text, {
            lang: accent === "uk" ? "en-GB" : "en-US",
            onEnd: () => setPlaying(""),
            onError: () => setPlaying(""),
          });
        });
        return;
      }
      readSource();
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.result, state.loading, state.error, dictReady, dict]);

  const copyResult = () => {
    if (state.result) navigator.clipboard?.writeText(state.result);
  };

  const hasPhonetic = !!(dict && (dict.ukphone || dict.usphone));

  // 音标药丸：与参考截图一致的「英/音标 🔊 美/音标 🔊」
  const PhoneticPill = ({ label, phone, accent }) => (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.25}
      sx={{
        px: 0.75,
        py: 0.15,
        borderRadius: "999px",
        bgcolor: "rgba(15,110,86,0.08)",
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 12, whiteSpace: "nowrap" }}>
        {label}/{phone}
      </Typography>
      <IconButton
        size="small"
        title={`朗读${label}音`}
        onClick={() => playAccent(accent)}
        sx={{ p: 0.25 }}
      >
        {playing === `word-${accent}` ? (
          <VolumeOffIcon sx={{ fontSize: 16 }} />
        ) : (
          <VolumeUpIcon sx={{ fontSize: 16 }} />
        )}
      </IconButton>
    </Stack>
  );

  const SpeakerButton = ({ id, title, onClick, size = 16 }) => (
    <Tooltip title={title}>
      <IconButton size="small" onClick={onClick} sx={{ p: 0.25 }}>
        {playing === id ? (
          <VolumeOffIcon sx={{ fontSize: size }} />
        ) : (
          <VolumeUpIcon sx={{ fontSize: size }} />
        )}
      </IconButton>
    </Tooltip>
  );

  return (
    <Box sx={{ p: 0.5, height: "100%", fontFamily: "system-ui, sans-serif" }}>
      <Paper
        elevation={6}
        sx={{
          p: 1.5,
          borderRadius: 2,
          maxHeight: "100%",
          overflow: "auto",
          background: "rgba(255,255,255,0.96)",
          borderTop: "3px solid #0F6E56",
        }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ cursor: "move", WebkitAppRegion: "drag", mb: 0.5 }}
        >
          <Typography variant="caption" color="text.secondary">
            kiss-desktop
          </Typography>
          <Stack direction="row" sx={{ WebkitAppRegion: "no-drag" }}>
            <IconButton size="small" title="设置" onClick={() => window.desktop.openSettings()}>
              <SettingsIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" title="关闭" onClick={() => window.close()}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>

        {state.text && (
          <Stack direction="row" alignItems="flex-start" spacing={0.25}>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ flex: 1, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {state.text}
            </Typography>
            {/* 没有音标（整句 / 非英文）时，给原文一个通用朗读按钮 */}
            {!hasPhonetic && <SpeakerButton id="source" title="朗读原文" onClick={readSource} />}
          </Stack>
        )}

        {hasPhonetic && (
          <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: "wrap" }} useFlexGap>
            {dict.ukphone && <PhoneticPill label="英" phone={dict.ukphone} accent="uk" />}
            {dict.usphone && <PhoneticPill label="美" phone={dict.usphone} accent="us" />}
          </Stack>
        )}

        {hasPhonetic && dict.explains && dict.explains.length > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              mt: 0.5,
              lineHeight: 1.35,
            }}
          >
            {dict.explains[0]}
          </Typography>
        )}

        <Box sx={{ mt: 1, minHeight: 24 }}>
          {state.loading && <CircularProgress size={18} />}
          {state.error && (
            <Typography variant="body2" color="error">
              翻译失败：{state.error}
            </Typography>
          )}
          {!state.loading && !state.error && state.result && (
            <Stack direction="row" alignItems="flex-start" spacing={0.25}>
              <Typography
                variant="body1"
                sx={{ flex: 1, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {state.result}
              </Typography>
              <SpeakerButton id="result" title="朗读译文" onClick={readResult} size={18} />
            </Stack>
          )}
        </Box>

        {state.result && !state.loading && (
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
            <Tooltip title="复制译文">
              <IconButton size="small" onClick={copyResult}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
