/** Villages and mansions. Run: npx tsx tests/structures.ts */

import { Block } from '../shared/src/blocks.js';
import { CHUNK_X, CHUNK_Z, Dimension, SEA_LEVEL, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { findPlacement } from '../shared/src/structures.js';
import { columnHeight, generateChunk } from '../shared/src/terrain.js';

const SEED = 2406;
let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

/** Scans a wide area for the first structure of each kind. */
function findFirst(kind: 'village' | 'mansion', range = 70) {
  for (let cz = -range; cz <= range; cz++) {
    for (let cx = -range; cx <= range; cx++) {
      const place = findPlacement(SEED, kind, cx, cz);
      if (place) return { cx, cz, place };
    }
  }
  return null;
}

const village = findFirst('village');
const mansion = findFirst('mansion');

check('a village exists within range', village !== null,
  village ? `chunk ${village.cx},${village.cz} at ${village.place.x},${village.place.z}` : '');
check('a mansion exists within range', mansion !== null,
  mansion ? `chunk ${mansion.cx},${mansion.cz} at ${mansion.place.x},${mansion.place.z}` : '');

/** Counts blocks of each kind across a square of chunks. */
function survey(ccx: number, ccz: number, span: number) {
  const counts = new Map<number, number>();
  for (let dz = -span; dz <= span; dz++) {
    for (let dx = -span; dx <= span; dx++) {
      const data = generateChunk(SEED, Dimension.Overworld, ccx + dx, ccz + dz);
      for (let i = 0; i < data.length; i++) {
        const id = data[i];
        if (id !== Block.Air) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  return counts;
}

if (village) {
  const counts = survey(village.cx, village.cz, 2);
  check('village has plank buildings', (counts.get(Block.Planks) ?? 0) > 200,
    `${counts.get(Block.Planks) ?? 0} planks`);
  check('village has gravel roads', (counts.get(Block.Gravel) ?? 0) > 100,
    `${counts.get(Block.Gravel) ?? 0} gravel`);
  check('village is lit', (counts.get(Block.Glowstone) ?? 0) > 3,
    `${counts.get(Block.Glowstone) ?? 0} glowstone`);
  check('village has glass windows', (counts.get(Block.Glass) ?? 0) > 8,
    `${counts.get(Block.Glass) ?? 0} glass`);
  check('village has a well', (counts.get(Block.Water) ?? 0) > 0);
  check('village has furniture',
    (counts.get(Block.CraftingTable) ?? 0) + (counts.get(Block.Furnace) ?? 0) > 0);
}

if (mansion) {
  const counts = survey(mansion.cx, mansion.cz, 2);
  check('mansion is a large plank building', (counts.get(Block.Planks) ?? 0) > 1500,
    `${counts.get(Block.Planks) ?? 0} planks`);
  check('mansion has log pillars', (counts.get(Block.Log) ?? 0) > 100,
    `${counts.get(Block.Log) ?? 0} logs`);
  check('mansion has a treasure room', (counts.get(Block.DiamondOre) ?? 0) > 0);
  check('mansion is lit', (counts.get(Block.Glowstone) ?? 0) > 6,
    `${counts.get(Block.Glowstone) ?? 0} glowstone`);
}

// --- the important one: structures must not tear at chunk seams -------------
if (mansion) {
  const { place } = mansion;
  // The mansion spans 23 blocks, so it crosses at least one chunk border.
  // Read a horizontal slice straight through it, stitched from whichever
  // chunk each column belongs to, and confirm the walls are continuous.
  const groundY = columnHeight(SEED, place.x, place.z) + 1;
  const y = groundY + 2;

  const chunkCache = new Map<string, Uint8Array>();
  const blockAt = (x: number, z: number): number => {
    const cx = Math.floor(x / CHUNK_X);
    const cz = Math.floor(z / CHUNK_Z);
    const key = `${cx},${cz}`;
    let data = chunkCache.get(key);
    if (!data) {
      data = generateChunk(SEED, Dimension.Overworld, cx, cz);
      chunkCache.set(key, data);
    }
    return data[voxelIndex(x - cx * CHUNK_X, y, z - cz * CHUNK_Z)];
  };

  // The north and south walls should be solid all the way across.
  let gaps = 0;
  for (let x = place.x - 11; x <= place.x + 11; x++) {
    if (blockAt(x, place.z - 11) === Block.Air) gaps++;
    if (blockAt(x, place.z + 11) === Block.Air) gaps++;
  }
  // Windows are deliberate holes, so allow a few.
  check('mansion walls are continuous across chunk borders', gaps <= 12,
    `${gaps} air blocks in 46 wall columns`);

  const spansChunks =
    Math.floor((place.x - 11) / CHUNK_X) !== Math.floor((place.x + 11) / CHUNK_X);
  check('mansion really does span more than one chunk', spansChunks);
}

// --- determinism ------------------------------------------------------------
if (village) {
  const a = generateChunk(SEED, Dimension.Overworld, village.cx, village.cz);
  const b = generateChunk(SEED, Dimension.Overworld, village.cx, village.cz);
  check('structure generation is deterministic', a.every((v, i) => v === b[i]));
}

// --- placement rules --------------------------------------------------------
{
  let underwater = 0;
  let checked = 0;
  for (let cz = -60; cz <= 60; cz += 1) {
    for (let cx = -60; cx <= 60; cx += 1) {
      for (const kind of ['village', 'mansion'] as const) {
        const place = findPlacement(SEED, kind, cx, cz);
        if (!place) continue;
        checked++;
        if (columnHeight(SEED, place.x, place.z) <= SEA_LEVEL + 2) underwater++;
      }
    }
  }
  check('no structures are placed in the sea', underwater === 0,
    `${checked} structures checked`);
  // Common enough to find while exploring, rare enough to feel like a find.
  check('structures are findable but not everywhere', checked >= 8 && checked < 200,
    `${checked} across 121x121 chunks (~${(121 * 16 / Math.sqrt(checked)).toFixed(0)} blocks apart)`);
}

// --- performance ------------------------------------------------------------
{
  // Chunks near a structure do the most work; make sure they stay affordable.
  const target = village ?? mansion;
  if (target) {
    let best = Infinity;
    for (let batch = 0; batch < 3; batch++) {
      const start = performance.now();
      for (let i = 0; i < 9; i++) {
        generateChunk(SEED, Dimension.Overworld,
          target.cx + (i % 3) - 1, target.cz + Math.floor(i / 3) - 1);
      }
      best = Math.min(best, (performance.now() - start) / 9);
    }
    check('chunks containing structures generate under 40ms', best < 40,
      `${best.toFixed(1)} ms/chunk`);
  }
}

void WORLD_Y;
void CHUNK_Z;

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} failed`}`);
process.exit(failures ? 1 : 0);
