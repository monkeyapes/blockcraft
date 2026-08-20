/**
 * Block texture quality, measured rather than eyeballed.
 * Run: npx tsx tests/blockart.ts
 *
 * Two properties matter for a block face, and neither is visible from a
 * single tile viewed alone:
 *   - it has to tile, because the same 16x16 repeats across a whole wall
 *   - it has to hold visible detail, because flat noise averages out to a
 *     single colour at any distance and the surface stops reading as stone,
 *     wood or anything else
 */

import { allTextureNames } from '../shared/src/blocks.js';
import { renderTile } from '../client/src/gfx/atlas.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

const lum = (px: Uint8ClampedArray, i: number) => (px[i] + px[i + 1] + px[i + 2]) / 3;

/**
 * How the wrap-around seam compares to the tile's own internal steps.
 *
 * Measured against the *largest* adjacent line-pair difference found inside
 * the tile, not the mean. Posterised art is mostly flat regions where
 * neighbouring pixels are identical, so a mean interior difference sits near
 * zero and dividing by it inflates every ratio into a failure whether or not
 * a seam exists -- which is exactly what the first version of this test did.
 *
 * The honest question is: does the wrap look like just another one of the
 * tile's internal edges? So compare it to the biggest edge already present.
 */
function seamScore(px: Uint8ClampedArray, size: number): { h: number; v: number } {
  const at = (x: number, y: number) => lum(px, (y * size + x) * 4);

  const colStep = (a: number, b: number) => {
    let s = 0;
    for (let y = 0; y < size; y++) s += Math.abs(at(b, y) - at(a, y));
    return s / size;
  };
  const rowStep = (a: number, b: number) => {
    let s = 0;
    for (let x = 0; x < size; x++) s += Math.abs(at(x, b) - at(x, a));
    return s / size;
  };

  let maxCol = 0;
  let maxRow = 0;
  for (let i = 0; i < size - 1; i++) {
    maxCol = Math.max(maxCol, colStep(i, i + 1));
    maxRow = Math.max(maxRow, rowStep(i, i + 1));
  }
  const wrapCol = colStep(size - 1, 0);
  const wrapRow = rowStep(size - 1, 0);

  // A uniform tile has no internal edges to compare against; any seam at all
  // would be glaring, so hold it to a small absolute difference instead.
  return {
    h: maxCol < 1 ? wrapCol : wrapCol / maxCol,
    v: maxRow < 1 ? wrapRow : wrapRow / maxRow,
  };
}

/** Standard deviation of brightness over opaque pixels. */
function detail(px: Uint8ClampedArray): number {
  const vals: number[] = [];
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    vals.push(lum(px, i));
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
}

/** How many distinct brightness levels the tile actually uses. */
function toneCount(px: Uint8ClampedArray): number {
  const seen = new Set<number>();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    seen.add(Math.round(lum(px, i) / 6)); // 6-unit buckets
  }
  return seen.size;
}

const names = allTextureNames();

// Blocks whose design is a deliberate frame or centred motif, which by
// construction does not continue across the seam. Listing them explicitly
// keeps the tiling check strict for everything that *should* tile.
const FRAMED = new Set([
  'glass', 'iron_block', 'crafting_top', 'crafting_side', 'furnace_front',
  'end_frame_top', 'end_frame_side', 'end_frame_eye', 'sorter', 'conveyor',
  'cable', 'torch', 'log_top',
]);

/**
 * Faces that repeat sideways but deliberately do not top-to-bottom.
 *
 * A grass side has turf along its top edge and soil below: stacking two of
 * them is meant to show a hard line where the next block's turf starts, so
 * checking its vertical wrap would be testing for the opposite of what the
 * texture is for.
 */
const HORIZONTAL_ONLY = new Set(['grass_side']);

let worstSeam = { name: '', ratio: 0 };
let flattest = { name: '', sigma: Infinity };

for (const name of names) {
  const { px, size } = renderTile(name);
  const sigma = detail(px);
  const tones = toneCount(px);

  if (!FRAMED.has(name)) {
    const { h, v } = seamScore(px, size);
    const worst = HORIZONTAL_ONLY.has(name) ? h : Math.max(h, v);
    if (worst > worstSeam.ratio) worstSeam = { name, ratio: worst };
    check(`${name}: tiles without a seam${HORIZONTAL_ONLY.has(name) ? ' (sideways)' : ''}`,
      worst <= 1.25,
      `wrap is ${worst.toFixed(2)}x the tile's largest internal edge`);
  }

  // Water and glass are see-through, so they are allowed to be faint.
  const floor = name === 'water' || name === 'glass' ? 3 : 6;
  if (sigma < flattest.sigma && name !== 'glass') flattest = { name, sigma };
  check(`${name}: holds visible detail`, sigma >= floor,
    `sigma ${sigma.toFixed(1)}`);
  check(`${name}: uses more than one tone`, tones >= 3, `${tones} tone buckets`);
}

console.log(`\nworst seam: ${worstSeam.name} at ${worstSeam.ratio.toFixed(2)}x interior`);
console.log(`flattest surface: ${flattest.name} at sigma ${flattest.sigma.toFixed(1)}`);
console.log(failures === 0 ? '\nAll block-art checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
