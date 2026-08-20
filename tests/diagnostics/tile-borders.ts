/**
 * Do block tiles have a dark border baked into them?
 *
 * outline() finds edges by looking for neighbouring transparent pixels, and
 * its alphaAt() reports 0 for anything outside the tile. On an item, drawn on
 * a transparent field, that is exactly right. On a full-bleed block texture
 * every border pixel has an out-of-bounds neighbour, so the whole rim reads as
 * an edge -- and a dark rim on a tiling texture is a grid on the wall.
 */
import { renderTile, TILE_PX } from '../client/src/gfx/atlas.js';

const BLOCKS = [
  'stone', 'dirt', 'grass_top', 'grass_side', 'sand', 'cobble', 'planks',
  'log_side', 'log_top', 'leaves', 'gravel', 'coal_ore', 'iron_ore',
  'diamond_ore', 'bedrock', 'sandstone', 'snow', 'netherrack', 'end_stone',
];

const lum = (p: Uint8ClampedArray | Uint8Array, i: number) =>
  0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];

console.log(`tile ${TILE_PX}px   border vs interior mean luminance`);
console.log('  tile            border  interior   delta');
const suspects: string[] = [];

for (const name of BLOCKS) {
  let px: Uint8ClampedArray;
  try {
    px = renderTile(name).px;
  } catch {
    continue;
  }
  let bSum = 0, bN = 0, iSum = 0, iN = 0;
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const i = (y * TILE_PX + x) * 4;
      const onRim = x === 0 || y === 0 || x === TILE_PX - 1 || y === TILE_PX - 1;
      if (onRim) { bSum += lum(px, i); bN++; }
      // Compare against the middle, well away from any rim effect.
      else if (x > 3 && y > 3 && x < TILE_PX - 4 && y < TILE_PX - 4) { iSum += lum(px, i); iN++; }
    }
  }
  const b = bSum / bN, it = iSum / iN, d = b - it;
  if (d < -12) suspects.push(name);
  console.log(`  ${name.padEnd(14)} ${b.toFixed(1).padStart(6)}  ${it.toFixed(1).padStart(7)}  ${d.toFixed(1).padStart(7)}${d < -12 ? '   <- dark rim' : ''}`);
}

console.log(suspects.length
  ? `\n=> ${suspects.length} block tiles carry a dark rim: ${suspects.join(', ')}`
  : '\n=> No block tile has a dark rim. The lines come from somewhere else.');
