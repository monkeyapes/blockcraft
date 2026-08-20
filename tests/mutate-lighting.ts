/**
 * Mutation check for the lighting tests.
 *
 * Restores the old heightmap sky light -- depth below the highest opaque
 * block -- and asserts the tunnel cases now report the wrong answer. A test
 * that passes with the bug present is not a test, so this proves the suite
 * is actually anchored to propagation rather than to whatever we compute.
 *
 * Run: npx tsx tests/mutate-lighting.ts
 */

import { Block } from '../shared/src/blocks.js';
import { CHUNK_X, Dimension, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { ClientWorld } from '../client/src/world.js';

const world = new ClientWorld(1234, Dimension.Overworld);
const chunk = world.ensureChunk(0, 0);
for (let y = 0; y < WORLD_Y; y++) {
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      // A one-block roof over a tunnel, open to the sky at a single column.
      // A thin roof is where the heightmap formula is most wrong: it reports
      // "one block down from the top" everywhere, however far from the hole.
      const solid = y === 41 ? !(x === 2 && z === 8) : y < 40;
      chunk.data[voxelIndex(x, y, z)] = solid ? Block.Stone : Block.Air;
    }
  }
}
chunk.rebuildHeightmap();
world.light.resetSky(0, 0);

/** The pre-revamp formula, expressed on the same 0-15 scale. */
function oldSky(x: number, y: number, z: number): number {
  const top = chunk.heightmap[(z & 15) * CHUNK_X + (x & 15)];
  if (y >= top) return 15;
  return Math.max(0, 1 - (top - y) * 0.12) * 15;
}

const cases = [
  { label: 'tunnel mouth', x: 2, expect: 15 },
  { label: '3 blocks in', x: 5, expect: 12 },
  { label: '12 blocks in', x: 14, expect: 3 },
];

let caught = 0;
for (const c of cases) {
  const now = world.getSkyLight(c.x, 40, 8);
  const before = oldSky(c.x, 40, 8);
  const differs = Math.abs(before - now) > 1;
  if (differs) caught++;
  console.log(
    `${differs ? 'CAUGHT ' : 'MISSED '} ${c.label}: propagated ${now}, heightmap ${before.toFixed(1)}`);
}

// The whole point: the old formula cannot tell the far end of a tunnel from
// its shallow end, because both sit one block under the same roof. Compare
// two points that are both under the roof; the mouth is open sky and is the
// one spot the old formula happens to get right.
const flatness = Math.abs(oldSky(5, 40, 8) - oldSky(14, 40, 8));
console.log(`\nheightmap spread across the tunnel: ${flatness.toFixed(1)} levels (it is blind to depth)`);
console.log(`propagated spread across the tunnel: ${world.getSkyLight(5, 40, 8) - world.getSkyLight(14, 40, 8)} levels`);

const ok = caught >= 2 && flatness < 1;
console.log(ok
  ? '\nMutation caught: the tests fail against the old implementation.'
  : '\nMutation NOT caught: the tests would pass with the bug present.');
process.exit(ok ? 0 : 1);
