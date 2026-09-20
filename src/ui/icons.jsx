import React from "react";
import SvgIcon from "@mui/material/SvgIcon";

// 内联图标：替代 @mui/icons-material。
// 该包约 2.8 万个文件，仅为 2 个图标引入性价比极低，且在国内网络/受限环境下
// 解压极易失败（EPERM）。这里直接使用 MUI 自带的 SvgIcon，零额外依赖。
// 图标路径取自 Material Symbols 官方定义（24x24 视口）。

export function ContentCopyIcon(props) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
    </SvgIcon>
  );
}

export function CloseIcon(props) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </SvgIcon>
  );
}
