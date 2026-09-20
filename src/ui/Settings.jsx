import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Alert,
  RadioGroup,
  Radio,
} from "@mui/material";
import { eventToHotkey } from "./hotkey-codes.js";

// 自定义接口的 apiType 常量值（引擎层 OPT_TRANS_CUSTOMIZE === "Custom"）。
// 渲染进程不 import 引擎层（会拉入 node 依赖），故此处用字面量并保持同步。
const API_TYPE_CUSTOM = "Custom";

const DEFAULT_HOTKEY = { alt: true, ctrl: false, shift: false, meta: false, keycode: 32 };

// 设置页：翻译引擎、取词热键（可录制 + 冲突检测）、发音、复制即翻译、在线测试。
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
  const [keyList, setKeyList] = useState([]);
  const [hotkey, setHotkey] = useState(DEFAULT_HOTKEY);
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [hotkeyMsg, setHotkeyMsg] = useState("");
  const [capture, setCapture] = useState({ started: false, label: "" });
  const [copyToTranslate, setCopyToTranslate] = useState(false);
  const [pronounce, setPronounce] = useState({ auto: false, accent: "us" });
  const [testText, setTestText] = useState("Hello world");
  const [testResult, setTestResult] = useState("");
  const [testErr, setTestErr] = useState("");
  const [saved, setSaved] = useState(false);
  // 用 ref 而不是 state：window 上的监听器只注册一次，必须读到最新值
  const recordingRef = useRef(false);

  useEffect(() => {
    window.desktop.getEngines().then((c) => c && setCatalog(c));
    window.desktop.getHotkeyKeys().then((k) => k && setKeyList(k));
    window.desktop.getCaptureStatus().then((s) => s && setCapture(s));
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
      if (cfg.hotkey) setHotkey(cfg.hotkey);
      setCopyToTranslate(!!cfg.copyToTranslate);
      if (cfg.pronounce) setPronounce(cfg.pronounce);
    });
  }, []);

  const current = useMemo(
    () => catalog.engines.find((x) => x.apiType === engine.apiType) || null,
    [catalog, engine.apiType]
  );

  const isCustom = engine.apiType === API_TYPE_CUSTOM;

  const update = (k) => (e) => setEngine({ ...engine, [k]: e.target.value });

  // 扫描码 → 显示名（用主进程给的权威表，避免两处各写一份）
  const nameOf = useCallback(
    (keycode) => keyList.find((k) => k.keycode === keycode)?.name || "?",
    [keyList]
  );

  const labelOf = useCallback(
    (hk) => {
      if (!hk || typeof hk.keycode !== "number") return "未设置";
      const mods = [hk.ctrl && "Ctrl", hk.alt && "Alt", hk.shift && "Shift", hk.meta && "Win"].filter(Boolean);
      return [...mods, nameOf(hk.keycode)].join(" + ");
    },
    [nameOf]
  );

  // ── 热键录制 ──────────────────────────────────────────────────────────────
  // 录制期间要暂停全局取词：否则按下当前热键会真的触发一次翻译、
  // 弹出浮窗把焦点从设置页抢走，录制直接被打断。
  const startRecording = async () => {
    setRecording(true);
    recordingRef.current = true;
    setDraft(null);
    setVerdict(null);
    setHotkeyMsg("");
    await window.desktop.setCapture(false);
  };

  const resumeCapture = async () => {
    const s = await window.desktop.setCapture(true);
    if (s) setCapture((prev) => ({ ...prev, started: s.started }));
  };

  const cancelRecording = async () => {
    recordingRef.current = false;
    setRecording(false);
    setHotkeyMsg("已取消录制");
    await resumeCapture();
  };

  useEffect(() => {
    const onKeyDown = async (e) => {
      if (!recordingRef.current) return;
      // 捕获阶段拦下，避免控件先响应（空格滚页、Tab 切焦点等）
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        await cancelRecording();
        return;
      }
      const hk = eventToHotkey(e);
      // 纯修饰键：忽略，继续等主键
      if (!hk) {
        setHotkeyMsg("请再按一个主键（字母/数字/F1–F12 等）");
        return;
      }
      recordingRef.current = false;
      setRecording(false);
      setDraft(hk);
      setVerdict(await window.desktop.checkHotkey(hk));
      await resumeCapture();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载时确保取词恢复，别把用户的热键留在暂停状态
  useEffect(
    () => () => {
      if (recordingRef.current) window.desktop.setCapture(true);
    },
    []
  );

  const applyHotkey = async () => {
    if (!draft) return;
    const r = await window.desktop.applyHotkey(draft);
    if (!r.ok) {
      setVerdict({ level: r.level, reason: r.reason });
      setHotkeyMsg("");
      return;
    }
    setHotkey(r.hotkey);
    setDraft(null);
    setVerdict(null);
    setHotkeyMsg(`已生效：${r.label}（无需重启）`);
    const s = await window.desktop.getCaptureStatus();
    if (s) setCapture(s);
  };

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
    await window.desktop.saveConfig({ engine, copyToTranslate, pronounce });
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

  const verdictSeverity =
    verdict?.level === "error" ? "error" : verdict?.level === "warning" ? "warning" : "success";

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
        <Typography variant="subtitle2" gutterBottom>
          取词热键
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }} useFlexGap>
          <Chip
            label={recording ? "请按下组合键…" : labelOf(draft || hotkey)}
            color={recording ? "warning" : "default"}
            variant={recording ? "filled" : "outlined"}
          />
          <Button size="small" variant="outlined" onClick={recording ? cancelRecording : startRecording}>
            {recording ? "取消录制" : "录制热键"}
          </Button>
          {draft && verdict?.ok !== false && (
            <Button size="small" variant="contained" onClick={applyHotkey}>
              应用 {labelOf(draft)}
            </Button>
          )}
        </Stack>

        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          按下组合键即录入（必须含 Ctrl / Alt / Shift 之一）；Esc 取消。
          录制期间会临时暂停取词，避免按下当前热键时误触发翻译。
        </Typography>

        {verdict && (
          <Alert severity={verdictSeverity} sx={{ mt: 1 }}>
            {verdict.reason}
          </Alert>
        )}
        {hotkeyMsg && (
          <Alert severity="info" sx={{ mt: 1 }}>
            {hotkeyMsg}
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          取词服务：{capture.started ? "运行中" : "已停止"}（当前热键 {capture.label || labelOf(hotkey)}）
        </Typography>
      </Paper>

      <Box sx={{ height: 16 }} />
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          发音
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={!!pronounce.auto}
              onChange={(e) => setPronounce({ ...pronounce, auto: e.target.checked })}
            />
          }
          label="翻译完成后自动朗读原文"
        />
        <Typography variant="caption" color="text.secondary" display="block">
          英文单词优先用有道音频（音质更好）；整句或中文用系统语音朗读。
          本机已装语音：en-US David / Zira，zh-CN Huihui / Kangkang / Yaoyao。
        </Typography>
        <Typography variant="body2" sx={{ mt: 1.5 }}>
          单词默认口音
        </Typography>
        <RadioGroup
          row
          value={pronounce.accent || "us"}
          onChange={(e) => setPronounce({ ...pronounce, accent: e.target.value })}
        >
          <FormControlLabel value="uk" control={<Radio size="small" />} label="英音" />
          <FormControlLabel value="us" control={<Radio size="small" />} label="美音" />
        </RadioGroup>
      </Paper>

      <Box sx={{ height: 16 }} />
      <Paper sx={{ p: 2 }}>
        <FormControlLabel
          control={<Switch checked={copyToTranslate} onChange={(e) => setCopyToTranslate(e.target.checked)} />}
          label="复制即翻译（监听剪贴板，无需热键）"
        />
        <Typography variant="caption" color="text.secondary" display="block">
          取词方式：选中文字后按热键，程序会模拟一次 Ctrl+C 取词并还原剪贴板。
          若某些程序取不到词（例如以管理员身份运行的窗口），可改用上面的剪贴板模式。
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
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }} useFlexGap>
        <Button variant="contained" onClick={save}>
          保存配置
        </Button>
        {saved && (
          <Typography variant="body2" color="success.main">
            已保存
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          （热键点「应用」即刻生效，不必在这里保存）
        </Typography>
      </Stack>
      <Box sx={{ height: 24 }} />
    </Box>
  );
}
