import React, { useEffect, useState } from "react";
import { Box, Paper, Typography, IconButton, Stack, CircularProgress } from "@mui/material";
import { ContentCopyIcon, CloseIcon } from "./icons.jsx";

// 浮窗译文卡片：接收主进程通过 IPC 推送的翻译结果。
export default function FloatingCard() {
  const [state, setState] = useState({ text: "", result: "", from: "", loading: false, error: "" });

  useEffect(() => {
    const off = window.desktop.onTranslation((payload) => {
      setState({
        text: payload.text || "",
        result: payload.result || "",
        from: payload.from || "",
        loading: !!payload.loading,
        error: payload.error || "",
      });
    });
    return () => off && off();
  }, []);

  const copyResult = () => {
    if (state.result) navigator.clipboard?.writeText(state.result);
  };

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
        <Stack direction="row" justifyContent="space-between" alignItems="center"
          sx={{ cursor: "move", WebkitAppRegion: "drag", mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            kiss-desktop
          </Typography>
          <IconButton size="small" sx={{ WebkitAppRegion: "no-drag" }} onClick={() => window.close()}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        {state.text && (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {state.text}
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
            <Typography variant="body1" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {state.result}
            </Typography>
          )}
        </Box>

        {state.result && !state.loading && (
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
            <IconButton size="small" onClick={copyResult} title="复制译文">
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
