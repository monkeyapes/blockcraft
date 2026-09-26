/**
 * Exports what the native client needs from the TypeScript registries.
 *
 *   npx tsx tools/export-native.ts
 *
 * Writes native/assets/atlas.png (the texture atlas, laid out exactly as the
 * web game lays it out) and native/assets/content.json (every block and item
 * the game knows, with textures resolved to atlas slots). The native game
 * reads only these two files, so the art and the block table are authored
 * once, here, and a Rust build never needs Node.
 *
 * Re-run it whenever a block, item, shape or texture changes, and commit the
 * result. The JSON format is a contract the native code builds on; it is
 * documented in native/README.md, and the Rust side refuses a file whose
 * `format` it does not know rather than guessing at it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLOCKS } from '../shared/src/blocks.js';
import { allItemIds, itemDef, ITEM_ID_BASE } from '../shared/src/items.js';
import {
  collisionOf, crossOf, isDynamicShape, isFullCube, selectionOf, shapeOf, type Box,
} from '../shared/src/shapes.js';
import { GRID, atlasTileNames } from '../client/src/gfx/atlas.js';
import { TILE_PX } from '../client/src/gfx/tile.js';
import { nodeAtlas, writePNG } from '../tests/diagnostics/offscreen.js';

/** Bumped whenever the JSON changes in a way an older reader would misread. */
const FORMAT = 1;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'native', 'assets');
mkdirSync(outDir, { recursive: true });

// --- the atlas -----------------------------------------------------------------

const atlas = nodeAtlas();
const names = atlasTileNames();
const slotOf = new Map(names.map((name, index) => [name, index]));

/** Atlas slot of a tile name; a name the atlas lacks is a registry bug. */
function slot(name: string): number {
  const s = slotOf.get(name);
  if (s === undefined) throw new Error(`texture ${name} is not in the atlas`);
  return s;
}

writePNG(join(outDir, 'atlas.png'), atlas.size, atlas.size, atlas.pixels);

// --- shapes --------------------------------------------------------------------

/**
 * Rounds to a sixteenth-friendly precision. Shapes are authored in sixteenths
 * and derived boxes (a plant's stem box) in simple fractions, so six decimals
 * is exact enough and keeps 1/3-style floats from bloating the file.
 */
const r = (n: number): number => Math.round(n * 1e6) / 1e6;

type BoxOut = { min: [number, number, number]; max: [number, number, number]; tex?: [number, number, number] };

function box(b: Box): BoxOut {
  const out: BoxOut = { min: [r(b.x0), r(b.y0), r(b.z0)], max: [r(b.x1), r(b.y1), r(b.z1)] };
  if (b.tex !== undefined) {
    const t = typeof b.tex === 'string' ? [b.tex, b.tex, b.tex] : b.tex;
    out.tex = [slot(t[0]), slot(t[1]), slot(t[2])];
  }
  return out;
}

// --- blocks --------------------------------------------------------------------

const blocks = [];
for (let id = 0; id < 256; id++) {
  const d = BLOCKS[id];
  if (!d) continue;
  const cross = crossOf(id);
  // A full cube carries no shape at all: the reader treats a missing shape
  // as the whole cell, which is what nearly every block is, and a file that
  // spelt out [0,0,0]-[1,1,1] two hundred times would hide the ones that
  // are interesting.
  const shape = isFullCube(id)
    ? null
    : {
      visual: shapeOf(id).map(box),
      collision: collisionOf(id).map(box),
      selection: selectionOf(id).map(box),
      dynamic: isDynamicShape(id),
    };
  blocks.push({
    id,
    name: d.name,
    textures: [slot(d.textures[0]), slot(d.textures[1]), slot(d.textures[2])],
    icon: slot(d.icon ?? d.textures[2]),
    solid: d.solid,
    opaque: d.opaque,
    translucent: d.translucent,
    liquid: d.liquid,
    breakable: d.breakable,
    light: d.light,
    hardness: d.hardness,
    replaceable: d.replaceable,
    climbable: d.climbable,
    cross: cross ? { height: r(cross.height), inset: r(cross.inset) } : null,
    shape,
  });
}

// --- items ---------------------------------------------------------------------

const items = allItemIds()
  .filter((id) => id >= ITEM_ID_BASE)
  .map((id) => {
    const d = itemDef(id);
    return { id, name: d.name, icon: slot(d.texture), stack: d.stackSize, places: d.places ?? null };
  });

const content = {
  format: FORMAT,
  atlas: { file: 'atlas.png', grid: GRID, tile_px: TILE_PX, size: atlas.size, tiles: names },
  blocks,
  items,
};

// Pretty, but with number lists kept on one line: a box reads as
// "min": [0, 0, 0] rather than as five lines of brackets, which is what keeps
// the file something a person can review in a diff.
const json = JSON.stringify(content, null, 2).replace(
  /\[\s+(-?[\d.e+-]+(?:,\s+-?[\d.e+-]+)*)\s+\]/g,
  (_, list: string) => `[${list.split(/,\s+/).join(', ')}]`,
);
writeFileSync(join(outDir, 'content.json'), `${json}\n`);

console.log(
  `native/assets: atlas ${atlas.size}px (${names.length} tiles, ${GRID}x${GRID}), ` +
  `${blocks.length} blocks, ${items.length} items`,
);
