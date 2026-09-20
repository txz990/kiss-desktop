// 托盘图标：用纯 JS 现场画出来，不依赖任何二进制素材文件。
//
// 为什么要在代码里画（这不是过度设计，是修一个会让应用不可用的缺陷）：
//   main.js 原先是「assets/tray.png 存在就用，不存在就 nativeImage.createEmpty()」。
//   而本项目根本没有 assets/ 目录 → 得到一个**空图标**：Windows 任务栏里看不见、
//   也点不到。偏偏托盘是本应用打开设置页的唯一入口（浮窗上原本只有关闭按钮），
//   等于装上去之后完全没法配置。这里把图标变成代码的一部分：
//   ① 不会再因为缺素材而变成空图标；② electron/** 本来就在 electron-builder 的
//   打包范围内，不会出现「开发环境有图标、打包后图标丢了」。
import zlib from "node:zlib";

const SIZE = 32;
const BG = [15, 110, 86]; // #0F6E56，与浮窗顶边强调色一致
const FG = [255, 255, 255];

// ── PNG 编码（只用到 RGBA8 + 无滤波，够用且零依赖）────────────────────────────
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width, height, rgba) {
  // 每行前面那个 0 是滤波类型（None），必须逐行写。
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── 画布（source-over 混合，带抗锯齿边缘）────────────────────────────────────
function createCanvas(size) {
  const px = new Uint8Array(size * size * 4);

  const blend = (x, y, [r, g, b], alpha) => {
    if (alpha <= 0 || x < 0 || y < 0 || x >= size || y >= size) return;
    const a = Math.min(1, alpha);
    const i = (y * size + x) * 4;
    px[i] = Math.round(px[i] * (1 - a) + r * a);
    px[i + 1] = Math.round(px[i + 1] * (1 - a) + g * a);
    px[i + 2] = Math.round(px[i + 2] * (1 - a) + b * a);
    px[i + 3] = Math.round(px[i + 3] * (1 - a) + 255 * a);
  };

  // 圆角矩形：用「到圆角圆心距离」判断，边缘用 1px 过渡做抗锯齿
  const roundRect = (x0, y0, w, h, radius, color) => {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y += 1) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x += 1) {
        const cx = Math.min(Math.max(x + 0.5, x0 + radius), x0 + w - radius);
        const cy = Math.min(Math.max(y + 0.5, y0 + radius), y0 + h - radius);
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        blend(x, y, color, Math.min(1, radius - d + 0.5));
      }
    }
  };

  // 粗线段：沿路径撒圆点，等价于带圆头的 stroke
  const thickLine = (x1, y1, x2, y2, width, color) => {
    const r = width / 2;
    const steps = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 3));
    for (let s = 0; s <= steps; s += 1) {
      const cx = x1 + ((x2 - x1) * s) / steps;
      const cy = y1 + ((y2 - y1) * s) / steps;
      for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y += 1) {
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x += 1) {
          blend(x, y, color, Math.min(1, r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5));
        }
      }
    }
  };

  const rect = (x0, y0, w, h, color) => roundRect(x0, y0, w, h, 0.5, color);

  return { px, roundRect, thickLine, rect };
}

/**
 * 生成托盘图标的 PNG 字节。宽高 32px（Windows 会自行缩放到任务栏尺寸）。
 * 图形：深青底圆角方块 + 白色「文」字（翻译语义，笔画在 16px 下仍可辨认）。
 */
export function buildTrayIconPng(size = SIZE) {
  const k = size / 32;
  const c = createCanvas(size);
  const S = (v) => v * k;

  c.roundRect(0, 0, size, size, S(7), BG);

  // 「文」= 亠（点 + 横）+ 乂（交叉的两撇捺）
  c.rect(S(15), S(6), S(3), S(3.5), FG); // 点
  c.rect(S(8), S(11.5), S(16), S(2.6), FG); // 横
  c.thickLine(S(11.5), S(15), S(21.5), S(26), S(2.8), FG); // 撇
  c.thickLine(S(21), S(15), S(11), S(26), S(2.8), FG); // 捺

  return encodePng(size, size, c.px);
}
