// A tiny RGBA drawing surface plus a PNG encoder, with no browser needed.
// Used by the blueprint exporters so they run the same in the app and from
// the command line, and produce byte-identical files on every machine.

import { zlibSync } from "fflate";

export type RGBA = [number, number, number, number];

export function hexToRgba(hex: string, alpha = 255): RGBA {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, alpha];
}

export class Raster {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    background: RGBA = [255, 255, 255, 255],
  ) {
    this.data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) this.data.set(background, i * 4);
  }

  /** Blend one pixel (alpha 0–255) over what's there. */
  pixel(x: number, y: number, c: RGBA) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 4;
    const a = c[3] / 255;
    if (a >= 1) {
      this.data[o] = c[0];
      this.data[o + 1] = c[1];
      this.data[o + 2] = c[2];
      this.data[o + 3] = 255;
      return;
    }
    this.data[o] = Math.round(c[0] * a + this.data[o] * (1 - a));
    this.data[o + 1] = Math.round(c[1] * a + this.data[o + 1] * (1 - a));
    this.data[o + 2] = Math.round(c[2] * a + this.data[o + 2] * (1 - a));
    this.data[o + 3] = 255;
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGBA) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.pixel(xx, yy, c);
  }

  strokeRect(x: number, y: number, w: number, h: number, c: RGBA, thickness = 1) {
    this.fillRect(x, y, w, thickness, c);
    this.fillRect(x, y + h - thickness, w, thickness, c);
    this.fillRect(x, y, thickness, h, c);
    this.fillRect(x + w - thickness, y, thickness, h, c);
  }

  /** Straight line (Bresenham), `thickness` pixels wide. */
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA, thickness = 1) {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const half = Math.floor(thickness / 2);
    for (;;) {
      this.fillRect(x0 - half, y0 - half, thickness, thickness, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Draw text with the built-in 5×7 pixel font. Returns the width drawn. */
  text(x: number, y: number, s: string, c: RGBA, scale = 1): number {
    let cx = x;
    for (const ch of normalizeText(s)) {
      const rows = FONT[ch] ?? FONT["?"];
      for (let r = 0; r < 7; r++)
        for (let b = 0; b < 5; b++) if (rows[r] & (16 >> b)) this.fillRect(cx + b * scale, y + r * scale, scale, scale, c);
      cx += 6 * scale;
    }
    return cx - x;
  }

  /** Copy a rectangle of another raster into this one. */
  blit(src: Raster, sx: number, sy: number, w: number, h: number, dx: number, dy: number) {
    for (let y = 0; y < h; y++) {
      if (sy + y < 0 || sy + y >= src.height || dy + y < 0 || dy + y >= this.height) continue;
      for (let x = 0; x < w; x++) {
        if (sx + x < 0 || sx + x >= src.width || dx + x < 0 || dx + x >= this.width) continue;
        const so = ((sy + y) * src.width + sx + x) * 4;
        const o = ((dy + y) * this.width + dx + x) * 4;
        this.data[o] = src.data[so];
        this.data[o + 1] = src.data[so + 1];
        this.data[o + 2] = src.data[so + 2];
        this.data[o + 3] = src.data[so + 3];
      }
    }
  }

  /** Encode as a PNG file. */
  toPng(): Uint8Array {
    return encodePng(this.data, this.width, this.height);
  }
}

export function textWidth(s: string, scale = 1): number {
  return [...normalizeText(s)].length * 6 * scale;
}

/** Map any text onto the characters the pixel font has. */
function normalizeText(s: string): string {
  const alias: Record<string, string> = { "⇡": "↑", "⇣": "↓", "⇢": "→", "⇠": "←", "≋": "=", "≡": "=", "◎": "O", "∩": "A", "–": "-", "—": "-", "×": "X", "·": "." };
  return [...s.toUpperCase()].map((ch) => alias[ch] ?? ch).join("");
}

// 5×7 pixel font. Each glyph is 7 rows; bit 16 is the leftmost pixel.
const FONT: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 17, 31, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 17, 25, 21, 19, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "-": [0, 0, 0, 31, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 12, 4, 8],
  ":": [0, 12, 12, 0, 12, 12, 0],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  "/": [0, 1, 2, 4, 8, 16, 0],
  _: [0, 0, 0, 0, 0, 0, 31],
  "=": [0, 0, 31, 0, 31, 0, 0],
  "+": [0, 4, 4, 31, 4, 4, 0],
  "'": [12, 4, 8, 0, 0, 0, 0],
  "#": [10, 10, 31, 10, 31, 10, 10],
  "?": [14, 17, 1, 2, 4, 0, 4],
  "!": [4, 4, 4, 4, 0, 0, 4],
  "↑": [4, 14, 21, 4, 4, 4, 0],
  "↓": [0, 4, 4, 4, 21, 14, 4],
  "→": [0, 4, 2, 31, 2, 4, 0],
  "←": [0, 4, 8, 31, 8, 4, 0],
};

// --- PNG ----------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** Encode RGBA pixels as a PNG (truecolour + alpha, 8 bits per channel). */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
