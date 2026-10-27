// Draws the app icons (PNG) with no image library: a small pixel-art map
// (forest, path, water) scaled up. Run once: node scripts/make-icons.mjs
// Output goes to web-public/icons/.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

// 16×16 design. Letters map to colors from the PNW palette.
const design = [
  "BBBBBBBBBBBBBBBB",
  "BTTTTTTTTTTTTTTB",
  "BTTTTGGPPGGTTTTB",
  "BTTTGGGPPGGGTTTB",
  "BTTGGGGPPGGGGTTB",
  "BTTGGGPPGGGWWTTB",
  "BTGGGGPPGGWWWWTB",
  "BTGGGPPGGGWWWWTB",
  "BTGGGPPGGGWWWWTB",
  "BTGGGGPPGGGWWTTB",
  "BTTGGGGPPGGGGTTB",
  "BTTGGGGGPPGGGTTB",
  "BTTTGGGGPPGGTTTB",
  "BTTTTGGGPPGTTTTB",
  "BTTTTTTTPPTTTTTB",
  "BBBBBBBBBBBBBBBB",
];
const colors = {
  B: [0x1e, 0x24, 0x28],
  T: [0x2c, 0x44, 0x36],
  G: [0x4d, 0x6b, 0x4f],
  P: [0x9b, 0x8f, 0x74],
  W: [0x3b, 0x57, 0x66],
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const ch = design[Math.floor((y * 16) / size)][Math.floor((x * 16) / size)];
      const [r, g, b] = colors[ch];
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("web-public/icons", { recursive: true });
writeFileSync("web-public/icons/icon-192.png", png(192));
writeFileSync("web-public/icons/icon-512.png", png(512));
writeFileSync("web-public/icons/apple-touch-icon.png", png(180));
console.log("Wrote web-public/icons/icon-192.png, icon-512.png, apple-touch-icon.png");
