// Writes the toolbar icons: a plain letter tile (the placeholder mark; the Scouty logo is not
// published in this repository, plan 12.1 and open question 12). Deterministic, dependency-free.
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "icons");
const TILE = [0x18, 0x18, 0x1b];
const INK = [0xff, 0xff, 0xff];
// A 5 × 7 letter S.
const GLYPH = ["01111", "10000", "10000", "01110", "00001", "00001", "11110"];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

export function iconPng(size) {
  const radius = size * 0.22;
  const cell = Math.max(1, Math.floor((size * 0.56) / 7));
  const glyphW = cell * 5;
  const glyphH = cell * 7;
  const left = Math.round((size - glyphW) / 2);
  const top = Math.round((size - glyphH) / 2);
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const dx = Math.max(radius - x - 0.5, x + 0.5 - (size - radius), 0);
      const dy = Math.max(radius - y - 0.5, y + 0.5 - (size - radius), 0);
      const inside = dx * dx + dy * dy <= radius * radius;
      const gx = Math.floor((x - left) / cell);
      const gy = Math.floor((y - top) / cell);
      const ink = x >= left && y >= top && gx < 5 && gy < 7 && GLYPH[gy][gx] === "1";
      const [r, g, b] = ink ? INK : TILE;
      row.set([r, g, b, inside ? 255 : 0], 1 + x * 4);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(root, { recursive: true });
  for (const size of [16, 32, 48, 128]) await writeFile(path.join(root, `${size}.png`), iconPng(size));
  console.log("wrote icons/16.png, 32.png, 48.png, 128.png");
}
