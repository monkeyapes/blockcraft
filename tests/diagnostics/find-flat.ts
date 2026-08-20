/**
 * Finds a large flat patch of one opaque block, for rendering tests.
 *
 * A banding measurement is only worth anything on a surface that should be
 * uniform. Hunting for one by flying around wastes time and tends to settle
 * for "flat enough"; the terrain generator can be asked directly, and it
 * answers in seconds.
 *
 * Water is excluded on purpose: it is translucent, so it brightens over
 * shallow ground, and it cost an afternoon once already.
 */

import { Block, blockDef, isOpaque } from '../../shared/src/blocks.js';
import { CHUNK_X, CHUNK_Z, Dimension, WORLD_Y } from '../../shared/src/constants.js';
import { ClientWorld } from '../../client/src/world.js';

const SEEDS = [59708, 1, 7, 42, 1234, 2026, 31337, 8080];
const SPAN = 6;            // chunks each way from the origin
const PATCH = 10;          // the flat square we want, in blocks

/** Height of the topmost solid block, or -1 if the column is empty. */
function surfaceY(world: ClientWorld, x: number, z: number): number {
  for (let y = WORLD_Y - 2; y > 0; y--) {
    if (blockDef(world.getBlock(x, y, z)).solid) return y;
  }
  return -1;
}

interface Found {
  seed: number; x: number; z: number; y: number; block: string; size: number;
}

const found: Found[] = [];

for (const seed of SEEDS) {
  const world = new ClientWorld(seed, Dimension.Overworld);
  for (let cx = -SPAN; cx <= SPAN; cx++) {
    for (let cz = -SPAN; cz <= SPAN; cz++) world.ensureChunk(cx, cz);
  }

  const minX = -SPAN * CHUNK_X, maxX = SPAN * CHUNK_X;
  const minZ = -SPAN * CHUNK_Z, maxZ = SPAN * CHUNK_Z;

  // Walk in strides: a patch this size does not need every origin tested.
  for (let x = minX; x + PATCH < maxX; x += 4) {
    for (let z = minZ; z + PATCH < maxZ; z += 4) {
      const y0 = surfaceY(world, x, z);
      if (y0 < 1) continue;
      const id = world.getBlock(x, y0, z);
      if (!isOpaque(id) || id === Block.Air) continue;
      // Water sitting on top would make the surface translucent from above.
      if (!blockDef(world.getBlock(x, y0 + 1, z)).solid &&
          world.getBlock(x, y0 + 1, z) !== Block.Air) continue;

      let ok = true;
      for (let dx = 0; dx < PATCH && ok; dx++) {
        for (let dz = 0; dz < PATCH; dz++) {
          if (surfaceY(world, x + dx, z + dz) !== y0 ||
              world.getBlock(x + dx, y0, z + dz) !== id ||
              world.getBlock(x + dx, y0 + 1, z + dz) !== Block.Air) { ok = false; break; }
        }
      }
      if (!ok) continue;

      found.push({
        seed, x: x + PATCH / 2, z: z + PATCH / 2, y: y0,
        block: String(blockDef(id).name ?? id), size: PATCH,
      });
      if (found.length >= 12) break;
    }
    if (found.length >= 12) break;
  }
  if (found.length >= 12) break;
}

if (!found.length) {
  console.log(`No flat ${PATCH}x${PATCH} patch of one opaque block found.`);
  console.log('Lower PATCH, or widen SEEDS.');
} else {
  console.log(`Flat ${PATCH}x${PATCH} patches, all one opaque block, open sky above:\n`);
  for (const f of found.slice(0, 8)) {
    console.log(`  seed ${String(f.seed).padEnd(6)} ${f.block.padEnd(10)} centre (${f.x}, ${f.z}) surface y=${f.y}`);
    // 523/d px per block at fov 72 on a 760px canvas; d is height above the
    // surface. Under 64 the 64px tile is minified, which is when NEAREST
    // sampling with no mipmaps starts to alias.
    for (const d of [8, 16, 32, 64]) {
      const px = 523 / d;
      console.log(`      /play/?seed=${f.seed}&pose=${f.x},${f.y + d},${f.z},0,-89.9` +
        `   d=${String(d).padStart(2)}  ${px.toFixed(1).padStart(5)} px/block  ` +
        `${px >= 64 ? 'magnified' : 'MINIFIED ' + (64 / px).toFixed(1) + 'x'}`);
    }
    console.log('');
  }
}
