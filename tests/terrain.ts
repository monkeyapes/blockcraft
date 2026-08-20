/** Sanity + performance checks for world generation. Run: npx tsx tests/terrain.ts */

import { Block } from '../shared/src/blocks.js';
import { CHUNK_X, CHUNK_Z, Dimension, SEA_LEVEL, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import {
  columnHeight, generateChunk, isStrongholdChunk, strongholdLocation,
} from '../shared/src/terrain.js';

const SEED = 2406;
let failures = 0;

function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- generation performance ------------------------------------------------
/**
 * Best of several batches. A single batch is at the mercy of whatever else
 * the machine is doing, and this is a smoke check against pathological
 * slowness, not a benchmark.
 */
function bestOf(batches: number, perBatch: number, run: (i: number) => void): number {
  let best = Infinity;
  for (let b = 0; b < batches; b++) {
    const start = performance.now();
    for (let i = 0; i < perBatch; i++) run(i);
    best = Math.min(best, (performance.now() - start) / perBatch);
  }
  return best;
}

const genMs = bestOf(4, 12, (i) =>
  void generateChunk(SEED, Dimension.Overworld, i % 5, (i / 5) | 0));
check('overworld chunk gen under 14ms', genMs < 14, `${genMs.toFixed(2)} ms/chunk`);

let t0 = 0;

const netherMs = bestOf(4, 8, (i) => void generateChunk(SEED, Dimension.Nether, i, 0));
check('nether chunk gen under 15ms', netherMs < 15, `${netherMs.toFixed(2)} ms/chunk`);

const endMs = bestOf(4, 8, (i) => void generateChunk(SEED, Dimension.End, i, 0));
check('end chunk gen under 15ms', endMs < 15, `${endMs.toFixed(2)} ms/chunk`);

// --- determinism -----------------------------------------------------------
const a = generateChunk(SEED, Dimension.Overworld, 3, -7);
const b = generateChunk(SEED, Dimension.Overworld, 3, -7);
check('generation is deterministic', a.every((v, i) => v === b[i]));

// --- terrain shape ---------------------------------------------------------
const heights: number[] = [];
for (let x = -400; x <= 400; x += 7) {
  for (let z = -400; z <= 400; z += 13) heights.push(columnHeight(SEED, x, z));
}
const min = Math.min(...heights);
const max = Math.max(...heights);
const below = heights.filter((h) => h < SEA_LEVEL).length / heights.length;
check('terrain has real relief', max - min > 35, `range ${min}..${max}`);
check('sea covers 15-70% of the surface', below > 0.15 && below < 0.7,
  `${(below * 100).toFixed(0)}% below sea level`);

// --- block layering --------------------------------------------------------
// Sample a spread of chunks: any single one may legitimately be all ocean.
let bedrock = true;
let hasWater = false;
let hasOre = false;
let hasTree = false;
let floatingSoil = 0;
let airBelowSurface = 0;

for (let ccx = -3; ccx <= 3; ccx++) {
  for (let ccz = -3; ccz <= 3; ccz++) {
    const chunk = generateChunk(SEED, Dimension.Overworld, ccx, ccz);
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        if (chunk[voxelIndex(lx, 0, lz)] !== Block.Bedrock) bedrock = false;
        const h = columnHeight(SEED, ccx * CHUNK_X + lx, ccz * CHUNK_Z + lz);
        for (let y = 1; y < WORLD_Y; y++) {
          const id = chunk[voxelIndex(lx, y, lz)];
          if (id === Block.Water) hasWater = true;
          if (id === Block.CoalOre || id === Block.IronOre) hasOre = true;
          if (id === Block.Log) hasTree = true;
          // Grass directly above air would mean a floating slab.
          if (id === Block.Grass && chunk[voxelIndex(lx, y - 1, lz)] === Block.Air) floatingSoil++;
          if (id === Block.Air && y > 4 && y < h - 3) airBelowSurface++;
        }
      }
    }
  }
}
check('bedrock floor is solid', bedrock);
check('water is generated', hasWater);
check('ores are generated', hasOre);
check('trees are generated', hasTree);
check('no floating grass slabs', floatingSoil < 6, `${floatingSoil} suspicious columns`);
check('caves carve some underground air', airBelowSurface > 0, `${airBelowSurface} air voxels`);

// --- nether/end ------------------------------------------------------------
let netherrackChunks = 0;
let lavaChunks = 0;
let glowChunks = 0;
for (let i = -2; i <= 2; i++) {
  const nether = generateChunk(SEED, Dimension.Nether, i, i);
  if (nether.includes(Block.Netherrack)) netherrackChunks++;
  if (nether.includes(Block.Lava)) lavaChunks++;
  if (nether.includes(Block.Glowstone)) glowChunks++;
}
check('nether is made of netherrack', netherrackChunks === 5);
check('nether has lava in most chunks', lavaChunks >= 4, `${lavaChunks}/5 chunks`);
check('nether has glowstone', glowChunks >= 3, `${glowChunks}/5 chunks`);
const end = generateChunk(SEED, Dimension.End, 0, 0);
check('end island exists near origin', end.includes(Block.EndStone));

// --- strongholds ------------------------------------------------------------
{
  // Exactly one stronghold per region, and it must contain a usable frame.
  let found = 0;
  let sample: { cx: number; cz: number } | null = null;
  for (let cx = 0; cx < 24; cx++) {
    for (let cz = 0; cz < 24; cz++) {
      if (!isStrongholdChunk(SEED, cx, cz)) continue;
      found++;
      sample = { cx, cz };
    }
  }
  check('exactly one stronghold per region', found === 1, `${found} in a 24x24 region`);

  const loc = strongholdLocation(SEED, 0, 0);
  check('the reported location matches the chunk',
    !!sample && Math.floor(loc.x / CHUNK_X) === sample.cx &&
    Math.floor(loc.z / CHUNK_Z) === sample.cz,
    `${loc.x}, ${loc.z}`);

  const room = generateChunk(SEED, Dimension.Overworld, sample!.cx, sample!.cz);
  let frames = 0;
  let centreClear = false;
  for (let y = 0; y < WORLD_Y; y++) {
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        if (room[voxelIndex(lx, y, lz)] === Block.EndPortalFrame) frames++;
      }
    }
  }
  check('the stronghold holds a full frame ring', frames === 8, `${frames} frames`);

  // The ring's centre must be empty so the portal can open there.
  for (let y = 0; y < WORLD_Y; y++) {
    if (room[voxelIndex(8, y, 8)] === Block.Air &&
        room[voxelIndex(7, y, 8)] === Block.EndPortalFrame) {
      centreClear = true;
    }
  }
  check('the ring centre is clear', centreClear);

  const plain = generateChunk(SEED, Dimension.Overworld, sample!.cx + 1, sample!.cz);
  check('ordinary chunks have no frames', !plain.includes(Block.EndPortalFrame));
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} failed`}`);
process.exit(failures ? 1 : 0);
