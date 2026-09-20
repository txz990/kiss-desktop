import React, { useEffect, useState } from "react";
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Stack,
  FormControlLabel,
  Switch,
  Divider,
} from "@mui/material";

// 设置页：配置自定义 API（OpenAI 兼容端点）、热键、复制即翻译。
export default function Settings() {
  const [engine, setEngine] = useState({
    url: "http://localhost:17377/v1/chat/completions",
    key: "",
    model: "gpt-5.5",
    useStream: false,
    requestHook: "",
    responseHook: "",
  });
  const [copyToTranslate, setCopyToTranslate] = useState(false);
  const [testText, setTestText] = useState("Hello world");
  const [testResult, setTestResult] = useState("");
  const [testErr, setTestErr] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.desktop.getConfig().then((cfg) => {
      setEngine({
        url: cfg.engine.url,
        key: cfg.engine.key || "",
        model: cfg.engine.model,
        useStream: !!cfg.engine.useStream,
        requestHook: cfg.engine.requestHook || "",
        responseHook: cfg.engine.responseHook || "",
      });
      setCopyToTranslate(!!cfg.copyToTranslate);
    });
  }, []);

  const update = (k) => (e) => setEngine({ ...engine, [k]: e.target.value });

  const save = async () => {
    setSaved(false);
    await window.desktop.saveConfig({
      engine: {
        ...engine,
        apiType: "OPT_TRANS_CUSTOMIZE",
        apiSlug: "desktop-default",
        useBatchFetch: false,
        contextSize: 0,
        useContext: false,
        fetchInterval: 0,
        fetchLimit: 0,
        httpTimeout: 30000,
      },
      copyToTranslate,
    });
    setSaved(true);
  };

  const test = async () => {
    setTestResult("");
    setTestErr("");
    try {
      const res = await window.desktop.translate(testText);
      setTestResult(res.text);
    } catch (e) {
      setTestErr(e?.message || String(e));
    }
  };

  return (
    <Box sx={{ p: 3, fontFamily: "system-ui, sans-serif", maxWidth: 720, mx: "auto" }}>
      <Typography variant="h6" gutterBottom>
        kiss-desktop 设置
      </Typography>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          翻译接口（自定义 API v2 · OpenAI 兼容）
        </Typography>
        <Stack spacing={1.5}>
          <TextField label="接口 URL" value={engine.url} onChange={update("url")} fullWidth size="small" />
          <Stack direction="row" spacing={1.5}>
            <TextField label="API Key" value={engine.key} onChange={update("key")} fullWidth size="small" />
            <TextField label="模型" value={engine.model} onChange={update("model")} size="small" sx={{ width: 200 }} />
          </Stack>
          <FormControlLabel
            control={<Switch checked={engine.useStream} onChange={(e) => setEngine({ ...engine, useStream: e.target.checked })} />}
            label="流式输出"
          />
          <TextField
            label="Request Hook（JS）"
            value={engine.requestHook}
            onChange={update("requestHook")}
            fullWidth
            size="small"
            multiline
            minRows={3}
          />
          <TextField
            label="Response Hook（JS）"
            value={engine.responseHook}
            onChange={update("responseHook")}
            fullWidth
            size="small"
            multiline
            minRows={2}
          />
        </Stack>
      </Paper>

      <Box sx={{ height: 16 }} />
      <Paper sx={{ p: 2 }}>
        <FormControlLabel
          control={<Switch checked={copyToTranslate} onChange={(e) => setCopyToTranslate(e.target.checked)} />}
          label="复制即翻译（监听剪贴板，无需热键）"
        />
        <Typography variant="caption" color="text.secondary" display="block">
          热键默认 Alt+D（在设置页暂不可改，如需修改请编辑 electron/store.js 的 hotkey）。
        </Typography>
      </Paper>

      <Box sx={{ height: 16 }} />
      <Divider />
      <Box sx={{ height: 16 }} />
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          测试
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField label="测试文本" value={testText} onChange={(e) => setTestText(e.target.value)} size="small" sx={{ flex: 1 }} />
          <Button variant="outlined" onClick={test}>
            翻译
          </Button>
        </Stack>
        {testResult && (
          <Typography variant="body1" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
            {testResult}
          </Typography>
        )}
        {testErr && (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            {testErr}
          </Typography>
        )}
      </Paper>

      <Box sx={{ height: 16 }} />
      <Stack direction="row" spacing={1}>
        <Button variant="contained" onClick={save}>
          保存配置
        </Button>
        {saved && <Typography variant="body2" color="success.main" sx={{ alignSelf: "center" }}>已保存</Typography>}
      </Stack>
    </Box>
  );
}
