import React, { useEffect, useMemo, useState } from "react";
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  ListSubheader,
  Chip,
} from "@mui/material";

// 自定义接口的 apiType 常量值（引擎层 OPT_TRANS_CUSTOMIZE === "Custom"）。
// 渲染进程不 import 引擎层（会拉入 node 依赖），故此处用字面量并保持同步。
const API_TYPE_CUSTOM = "Custom";

// 设置页：选择翻译引擎（免费引擎优先）、配置参数、复制即翻译、在线测试。
//
// ⚠️ 字段名必须与引擎一致：引擎读的是 reqHook / resHook（不是 requestHook / responseHook）。
// ⚠️ 只提交本页负责的字段：apiType / apiSlug / httpTimeout 等引擎内部字段
//    由 electron/store.js + 引擎的 resolveApiSetting 兜底，UI 覆盖成错误值会让翻译报废。
export default function Settings() {
  const [engine, setEngine] = useState({
    apiType: API_TYPE_CUSTOM,
    url: "",
    key: "",
    model: "",
    useStream: false,
    reqHook: "",
    resHook: "",
  });
  const [catalog, setCatalog] = useState({ groups: [], engines: [] });
  const [copyToTranslate, setCopyToTranslate] = useState(false);
  const [testText, setTestText] = useState("Hello world");
  const [testResult, setTestResult] = useState("");
  const [testErr, setTestErr] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.desktop.getEngines().then((c) => c && setCatalog(c));
    window.desktop.getConfig().then((cfg) => {
      const e = cfg.engine || {};
      setEngine({
        apiType: e.apiType || API_TYPE_CUSTOM,
        url: e.url || "",
        key: e.key || "",
        model: e.model || "",
        useStream: !!e.useStream,
        reqHook: e.reqHook || "",
        resHook: e.resHook || "",
      });
      setCopyToTranslate(!!cfg.copyToTranslate);
    });
  }, []);

  const current = useMemo(
    () => catalog.engines.find((x) => x.apiType === engine.apiType) || null,
    [catalog, engine.apiType]
  );

  const isCustom = engine.apiType === API_TYPE_CUSTOM;

  const update = (k) => (e) => setEngine({ ...engine, [k]: e.target.value });

  // 切换引擎：用该引擎的内置默认回填（URL/模型）；Key 跨引擎清空以免串用。
  const changeEngine = (apiType) => {
    const item = catalog.engines.find((x) => x.apiType === apiType);
    const p = item?.preset || {};
    setEngine((prev) => ({
      apiType,
      url: p.url || "",
      key: apiType === prev.apiType ? prev.key : "",
      model: p.model || "",
      useStream: false,
      // Hook 只有自定义接口用到，切到别的引擎时清空
      reqHook: apiType === API_TYPE_CUSTOM ? prev.reqHook : "",
      resHook: apiType === API_TYPE_CUSTOM ? prev.resHook : "",
    }));
    setTestResult("");
    setTestErr("");
  };

  const save = async () => {
    setSaved(false);
    await window.desktop.saveConfig({ engine, copyToTranslate });
    setSaved(true);
  };

  const test = async () => {
    setTestResult("");
    setTestErr("");
    try {
      // 用当前表单配置测试（而非已保存的旧配置），所见即所得。
      const res = await window.desktop.translate(testText, engine);
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
          翻译引擎
        </Typography>

        <FormControl fullWidth size="small" sx={{ mt: 0.5 }}>
          <InputLabel id="engine-label">选择引擎</InputLabel>
          <Select
            labelId="engine-label"
            label="选择引擎"
            value={engine.apiType}
            onChange={(e) => changeEngine(e.target.value)}
          >
            {catalog.groups.flatMap((g) => [
              <ListSubheader key={`h-${g.key}`}>{g.label}</ListSubheader>,
              ...catalog.engines
                .filter((x) => x.group === g.key)
                .map((x) => (
                  <MenuItem key={x.apiType} value={x.apiType}>
                    {x.label}
                  </MenuItem>
                )),
            ])}
          </Select>
        </FormControl>

        {current && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, flexWrap: "wrap" }}>
            <Chip
              size="small"
              color={current.needsKey ? "warning" : "success"}
              label={current.needsKey ? "需自备 Key" : "无需 Key"}
            />
            {current.hint && (
              <Typography variant="caption" color="text.secondary">
                {current.hint}
              </Typography>
            )}
          </Stack>
        )}

        <Stack spacing={1.5} sx={{ mt: 2 }}>
          <TextField label="接口 URL" value={engine.url} onChange={update("url")} fullWidth size="small" />
          <Stack direction="row" spacing={1.5}>
            <TextField
              label={current?.needsKey ? "API Key（必填）" : "API Key（可选）"}
              value={engine.key}
              onChange={update("key")}
              fullWidth
              size="small"
            />
            {(current?.needsModel || !!engine.model) && (
              <TextField
                label="模型"
                value={engine.model}
                onChange={update("model")}
                size="small"
                sx={{ width: 220 }}
              />
            )}
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={engine.useStream}
                onChange={(e) => setEngine({ ...engine, useStream: e.target.checked })}
              />
            }
            label="流式输出"
          />

          {isCustom && (
            <>
              <Typography variant="caption" color="text.secondary">
                留空则使用内置的 OpenAI 兼容默认 Hook。
              </Typography>
              <TextField
                label="Request Hook（JS）"
                value={engine.reqHook}
                onChange={update("reqHook")}
                fullWidth
                size="small"
                multiline
                minRows={3}
              />
              <TextField
                label="Response Hook（JS）"
                value={engine.resHook}
                onChange={update("resHook")}
                fullWidth
                size="small"
                multiline
                minRows={2}
              />
            </>
          )}
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
          <TextField
            label="测试文本"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            size="small"
            sx={{ flex: 1 }}
          />
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
        {saved && (
          <Typography variant="body2" color="success.main" sx={{ alignSelf: "center" }}>
            已保存
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
