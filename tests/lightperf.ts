/**
 * Cost of the lighting pass, and proof the mesher really does grade light
 * across a face. Run: npx tsx tests/lightperf.ts
 */

import { Block } from '../shared/src/blocks.js';
import { Dimension, SECTION_Y, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { generateChunk } from '../shared/src/terrain.js';
import { ClientWorld } from '../client/src/world.js';
import { meshSection, FLOATS_PER_VERTEX } from '../client/src/mesher.js';

// --- How long a chunk takes to load, now that sunlight is propagated -----
// Absolute timings on this box swing by 3x run to run, so measure lighting
// against terrain generation in the same run and report the ratio. Terrain is
// the budget everything else is judged against.
{
  const N = 24;
  const median = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];

  // Warm up, so the first sample is not paying for JIT.
  for (let i = 0; i < 4; i++) new ClientWorld(1, Dimension.Overworld).ensureChunk(0, 0);

  const terrainTimes: number[] = [];
  const totalTimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const seed = 20260809 + i;
    let t = performance.now();
    generateChunk(seed, Dimension.Overworld, 0, 0);
    terrainTimes.push(performance.now() - t);

    const world = new ClientWorld(seed, Dimension.Overworld);
    t = performance.now();
    world.ensureChunk(0, 0);
    totalTimes.push(performance.now() - t);
  }

  const terrain = median(terrainTimes);
  const total = median(totalTimes);
  const light = total - terrain;
  console.log(`per chunk: terrain ${terrain.toFixed(2)} ms, lighting ${light.toFixed(2)} ms ` +
    `(${(light / terrain).toFixed(2)}x terrain)`);
  console.log(light < terrain * 1.5
    ? 'OK  lighting costs less than generating the terrain it lights'
    : 'SLOW  lighting now dominates chunk load');
}

// --- Does light actually vary across a single face? ----------------------
// Flat ground with a torch on it. Before the revamp every vertex of a face
// shared one light value, so a face either was lit or was not. Now the four
// corners differ, which is what makes the falloff look round.
{
  const world = new ClientWorld(7, Dimension.Overworld);
  const chunk = world.ensureChunk(0, 0);
  for (let y = 0; y < WORLD_Y; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        chunk.data[voxelIndex(x, y, z)] = y <= 40 ? Block.Stone : Block.Air;
      }
    }
  }
  chunk.rebuildHeightmap();
  world.light.resetSky(0, 0);
  world.setBlock(8, 41, 8, Block.Torch);

  const atlas = { uv: () => [0, 0, 1, 1] } as any;
  // Night, so the torch is the only thing lighting the ground.
  const mesh = meshSection(world, atlas, 0, 0, (40 / SECTION_Y) | 0, 0);
  if (!mesh) throw new Error('no mesh');

  const v = mesh.opaque.vertices;
  let graded = 0;
  let flat = 0;
  for (let i = 0; i + FLOATS_PER_VERTEX * 4 <= v.length; i += FLOATS_PER_VERTEX * 4) {
    const l = [0, 1, 2, 3].map((c) => v[i + c * FLOATS_PER_VERTEX + 5]);
    const spread = Math.max(...l) - Math.min(...l);
    if (spread > 1e-4) graded++; else flat++;
  }
  const pct = (100 * graded) / (graded + flat);
  console.log(`\nfaces with light varying across their corners: ${graded}/${graded + flat} ` +
    `(${pct.toFixed(1)}%)`);
  console.log(graded > 0
    ? 'OK  light is interpolated per vertex, not per face'
    : 'FAIL  every face is still a single flat light value');

  // And the gradient should point away from the torch.
  const lights = [...Array(v.length / FLOATS_PER_VERTEX)]
    .map((_, i) => ({ x: v[i * FLOATS_PER_VERTEX], z: v[i * FLOATS_PER_VERTEX + 2],
                      y: v[i * FLOATS_PER_VERTEX + 1], l: v[i * FLOATS_PER_VERTEX + 5] }))
    .filter((p) => p.y === 41);
  const near = lights.filter((p) => Math.hypot(p.x - 8, p.z - 8) < 2);
  const far = lights.filter((p) => Math.hypot(p.x - 8, p.z - 8) > 9);
  const avg = (a: typeof near) => a.reduce((s, p) => s + p.l, 0) / (a.length || 1);
  console.log(`ground brightness near the torch ${avg(near).toFixed(3)}, ` +
    `far away ${avg(far).toFixed(3)}`);
  console.log(avg(near) > avg(far) * 2
    ? 'OK  the torch reads as a light source with a falloff'
    : 'FAIL  no meaningful falloff around the torch');
}
