import React, { useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    const off = window.desktop.onTranslation((payload) => {
      setState({
        text: payload.text || "",
        result: payload.result || "",
        from: payload.from || "",
        loading: !!payload.loading,
        error: payload.error || "",
      });
      setPlaying("");
      stopSpeaking();
    });
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
    if (!text) {
      setDict(null);
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
  // 单词且设置了默认口音时，走有声道音频；否则用系统 TTS。
  useEffect(() => {
    const { auto, accent } = pronounceRef.current;
    if (!auto || !state.text || state.loading || state.error) return undefined;
    const t = setTimeout(() => {
      const audio = accent === "uk" ? dict?.uk : dict?.us;
      if (audio) {
        setPlaying(`word-${accent}`);
        playAudio(audio).then((ok) => {
          if (!ok) {
            speak(dict?.word || state.text, {
              lang: accent === "uk" ? "en-GB" : "en-US",
              onEnd: () => setPlaying(""),
              onError: () => setPlaying(""),
            });
            return;
          }
          setPlaying("");
        });
        return;
      }
      readSource();
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.result, state.loading, state.error, dict]);

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
