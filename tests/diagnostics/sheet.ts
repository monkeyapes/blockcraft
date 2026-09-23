/**
 * A labelled contact sheet of atlas tiles, as a PNG you can open and look at.
 *
 *   npx tsx tests/diagnostics/sheet.ts --items --out=items.png
 *   npx tsx tests/diagnostics/sheet.ts --blocks --out=blocks.png
 *   npx tsx tests/diagnostics/sheet.ts --match=sword|hammer --scale=2 --out=weapons.png
 *   npx tsx tests/diagnostics/sheet.ts --names=stone,cobble,granite --out=stones.png
 *   npx tsx tests/diagnostics/sheet.ts --blocks --tiled --out=walls.png
 *
 * Transparent pixels show as a grey checkerboard so an icon's silhouette is
 * visible. --tiled draws each tile 3x3 so seams show the way a wall of them
 * would. Missing recipes render loud magenta, which is the point.
 */

import { allTextureNames } from '../../shared/src/blocks.js';
import { allItemTextureNames } from '../../shared/src/items.js';
import { atlasTileNames, renderTile } from '../../client/src/gfx/atlas.js';
import { TILE_PX } from '../../client/src/gfx/tile.js';
import { drawText, writePNG } from './offscreen.js';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const [k, v] = a.replace(/^--/, '').split('=');
  args.set(k, v ?? 'true');
}

let names: string[];
if (args.has('names')) names = args.get('names')!.split(',').map((s) => s.trim()).filter(Boolean);
else if (args.has('items')) names = allItemTextureNames();
else if (args.has('blocks')) names = allTextureNames();
else names = atlasTileNames();
if (args.has('match')) {
  const re = new RegExp(args.get('match')!);
  names = names.filter((n) => re.test(n));
}

const scale = Number(args.get('scale') ?? (args.has('tiled') ? 1 : 2));
const reps = args.has('tiled') ? 3 : 1;
const cell = TILE_PX * scale * reps;
const labelH = 14;
const pad = 8;
const cols = Number(args.get('cols') ?? Math.max(1, Math.min(8, Math.floor(1400 / (cell + pad)))));
const rows = Math.ceil(names.length / cols);
const W = cols * (cell + pad) + pad;
const H = rows * (cell + labelH + pad) + pad;
const img = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) img.set([30, 32, 38, 255], i * 4);

names.forEach((name, n) => {
  const col = n % cols;
  const row = (n / cols) | 0;
  const ox = pad + col * (cell + pad);
  const oy = pad + row * (cell + labelH + pad);
  const { px } = renderTile(name);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const sx = ((x / scale) | 0) % TILE_PX;
      const sy = ((y / scale) | 0) % TILE_PX;
      const s = (sy * TILE_PX + sx) * 4;
      const a = px[s + 3] / 255;
      const checker = ((x >> 3) + (y >> 3)) % 2 ? 150 : 110;
      const d = ((oy + y) * W + ox + x) * 4;
      img[d] = px[s] * a + checker * (1 - a);
      img[d + 1] = px[s + 1] * a + checker * (1 - a);
      img[d + 2] = px[s + 2] * a + checker * (1 - a);
      img[d + 3] = 255;
    }
  }
  const maxChars = Math.floor(cell / 8);
  drawText(img, W, ox, oy + cell + 3, name.slice(0, maxChars), 2);
});

const out = args.get('out') ?? 'sheet.png';
writePNG(out, W, H, img);
console.log(`${names.length} tiles -> ${out} (${W}x${H})`);
for (let r = 0; r < rows; r++) {
  console.log(`row ${r + 1}: ${names.slice(r * cols, r * cols + cols).join(', ')}`);
}
