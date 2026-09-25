/**
 * A labelled sheet of inventory icons exactly as the slots draw them: blocks
 * as their rendered 3D model (or flat sprite), items as their tile.
 *
 *   npx tsx tests/diagnostics/icons.ts --out=.scratch/icons.png
 *   npx tsx tests/diagnostics/icons.ts --blocks=Stone,Cable,Conveyor --scale=2
 *   npx tsx tests/diagnostics/icons.ts --items --out=.scratch/item-icons.png
 *   npx tsx tests/diagnostics/icons.ts --match=ore|log
 *
 * Each icon sits on a slot-coloured square, so the silhouette is judged
 * against what it will really be seen on rather than a checkerboard.
 */

import { BLOCKS, Block } from '../../shared/src/blocks.js';
import { allItemIds, itemDef } from '../../shared/src/items.js';
import { renderTile } from '../../client/src/gfx/atlas.js';
import { ICON_PX, renderBlockIcon, renderFlatIcon, type TilePixels } from '../../client/src/gfx/blockicon.js';
import { drawText, writePNG } from './offscreen.js';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const [k, v] = a.replace(/^--/, '').split('=');
  args.set(k, v ?? 'true');
}

const tileCache = new Map<string, TilePixels>();
const tiles = (name: string): TilePixels => {
  let t = tileCache.get(name);
  if (!t) tileCache.set(name, t = renderTile(name));
  return t;
};

let ids: number[];
if (args.has('blocks') && args.get('blocks') !== 'true') {
  ids = args.get('blocks')!.split(',').map((n) => {
    const id = (Block as unknown as Record<string, number>)[n.trim()];
    if (id === undefined) throw new Error(`no block called ${n}`);
    return id;
  });
} else if (args.has('items')) {
  ids = allItemIds();
} else {
  ids = BLOCKS.filter((d) => d && d.id !== Block.Air).map((d) => d.id as number);
}
if (args.has('match')) {
  const re = new RegExp(args.get('match')!, 'i');
  ids = ids.filter((id) => re.test(itemDef(id).name));
}

const scale = Number(args.get('scale') ?? 2);
const cell = ICON_PX * scale;
const labelH = 14;
const pad = 8;
const cols = Number(args.get('cols') ?? Math.max(1, Math.min(10, Math.floor(1400 / (cell + pad)))));
const rows = Math.ceil(ids.length / cols);
const W = cols * (cell + pad) + pad;
const H = rows * (cell + labelH + pad) + pad;
const img = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) img.set([30, 32, 38, 255], i * 4);

// The hotbar slot's own fill, near enough.
const SLOT = [58, 60, 66];

ids.forEach((id, n) => {
  const col = n % cols;
  const row = (n / cols) | 0;
  const ox = pad + col * (cell + pad);
  const oy = pad + row * (cell + labelH + pad);
  const px = id < 256 ? renderBlockIcon(id, tiles) : renderFlatIcon(itemDef(id).texture, tiles);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const s = (((y / scale) | 0) * ICON_PX + ((x / scale) | 0)) * 4;
      const a = px[s + 3] / 255;
      const d = ((oy + y) * W + ox + x) * 4;
      img[d] = px[s] * a + SLOT[0] * (1 - a);
      img[d + 1] = px[s + 1] * a + SLOT[1] * (1 - a);
      img[d + 2] = px[s + 2] * a + SLOT[2] * (1 - a);
      img[d + 3] = 255;
    }
  }
  drawText(img, W, ox, oy + cell + 3, itemDef(id).name.slice(0, Math.floor(cell / 8)), 2);
});

const out = args.get('out') ?? '.scratch/icons.png';
writePNG(out, W, H, img);
console.log(`${ids.length} icons -> ${out} (${W}x${H})`);
