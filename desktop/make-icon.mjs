/**
 * Generates the app icon as a PNG, with no image dependencies.
 *
 * Draws the game's own grass block in isometric projection, so the launcher
 * icon and the world it opens are visibly the same thing.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const here = dirname(fileURLToPath(import.meta.url));

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- draw -------------------------------------------------------------------

const px = Buffer.alloc(SIZE * SIZE * 4);
const set = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
};

// Deterministic jitter so the faces have the game's speckled texture.
let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const S = SIZE / 2;          // half width of the cube
const cx = SIZE / 2;
const topY = SIZE * 0.13;
const midY = SIZE * 0.44;
const botY = SIZE * 0.87;

/** Isometric top face: a rhombus from (cx, topY) outward. */
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = (x - cx) / (S * 0.94);
    const dyTop = (y - (topY + (midY - topY) / 2)) / ((midY - topY) / 2);
    if (Math.abs(dx) + Math.abs(dyTop) <= 1) {
      const j = (rnd() - 0.5) * 26;
      set(x, y, 108 + j, 168 + j, 64 + j);
    }
  }
}

/** Left and right side faces, as sheared columns below the rhombus. */
for (let x = 0; x < SIZE; x++) {
  const t = (x - (cx - S * 0.94)) / (S * 0.94); // 0..2 across the cube
  if (t < 0 || t > 2) continue;
  const left = t <= 1;
  // Top edge of this column follows the rhombus, bottom edge follows the base.
  const edge = left
    ? midY - (midY - topY) * t
    : midY - (midY - topY) * (2 - t);
  const base = left
    ? botY - (botY - midY) * 0 - (midY - topY) * (1 - t) * 0
    : botY;
  const bottom = left
    ? botY - (midY - topY) * (1 - t) * 0
    : botY - (midY - topY) * (t - 1) * 0;
  const lowerEdge = left ? bottom - (midY - topY) * (1 - t) : base - (midY - topY) * (t - 1);

  for (let y = Math.ceil(edge); y < lowerEdge; y++) {
    const j = (rnd() - 0.5) * 22;
    const grassBand = y < edge + SIZE * 0.09;
    const shade = left ? 0 : -26;
    if (grassBand) set(x, y, 92 + j + shade, 146 + j + shade, 54 + j + shade);
    else set(x, y, 138 + j + shade, 98 + j + shade, 68 + j + shade);
  }
}

mkdirSync(join(here, 'src-tauri'), { recursive: true });
const out = join(here, 'src-tauri', 'app-icon.png');
writeFileSync(out, png(SIZE, SIZE, px));
console.log(`wrote ${out}`);
