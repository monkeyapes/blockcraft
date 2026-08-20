/**
 * Mining feedback: the crack overlay geometry and the break particle system.
 * Both are pure logic with no DOM or WebAudio dependency, so they run the
 * same way here as everywhere else. Run: npx tsx tests/feedback.ts
 */

import { allTextureNames, Block } from '../shared/src/blocks.js';
import { allItemTextureNames } from '../shared/src/items.js';
import { Dimension, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { EXTRA_TILES, GRID, type Atlas } from '../client/src/gfx/atlas.js';
import { buildCrackMesh } from '../client/src/gfx/decal.js';
import { ParticleSystem } from '../client/src/gfx/particles.js';
import { FLOATS_PER_VERTEX } from '../client/src/mesher.js';
import { ClientWorld } from '../client/src/world.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// buildAtlas() itself needs a real <canvas>, which does not exist here, so it
// has never actually run inside this test suite -- resourcepack.ts only
// parses zip contents, it never calls it either. That is exactly how a
// 145-tiles-into-144-slots overflow sat undetected: reproduce buildAtlas()'s
// own bookkeeping directly, with no DOM involved, so this invariant is
// actually exercised somewhere.
{
  const names = new Set([...allTextureNames(), ...allItemTextureNames(), ...EXTRA_TILES]);
  check(`registered tiles fit the ${GRID}x${GRID} atlas grid`,
    names.size <= GRID * GRID,
    `${names.size} tiles, ${GRID * GRID} slots, ${GRID * GRID - names.size} to spare`);
}

/** A minimal stand-in for the real atlas: deterministic, no canvas needed. */
function fakeAtlas(): Atlas {
  const slots = new Map<string, number>();
  let next = 0;
  const slotOf = (name: string) => {
    if (!slots.has(name)) slots.set(name, next++);
    return slots.get(name)!;
  };
  return {
    canvas: null as unknown as HTMLCanvasElement,
    uv: (name) => {
      const i = slotOf(name);
      return [i / 1000, 0, i / 1000 + 0.001, 0.001];
    },
    iconURL: () => '',
    applyOverrides: () => 0,
    revision: 0,
    tileSize: 32,
  };
}

const atlas = fakeAtlas();

// --- Crack overlay geometry ------------------------------------------------
{
  const mesh = buildCrackMesh(atlas, 5, 10, -3, 4);
  const vertCount = mesh.vertices.length / FLOATS_PER_VERTEX;
  check('crack mesh has one quad per cube face', vertCount === 24,
    `got ${vertCount} vertices`);
  check('crack mesh has two triangles per face', mesh.indices.length === 36,
    `got ${mesh.indices.length} indices`);

  // Every vertex should sit within a hair of the target block's cube -- not
  // at the origin, not at some other block, and not wildly inflated.
  let inBounds = true;
  for (let i = 0; i < vertCount; i++) {
    const px = mesh.vertices[i * FLOATS_PER_VERTEX];
    const py = mesh.vertices[i * FLOATS_PER_VERTEX + 1];
    const pz = mesh.vertices[i * FLOATS_PER_VERTEX + 2];
    if (px < 4.99 || px > 6.01 || py < 9.99 || py > 11.01 || pz < -3.01 || pz > -1.99) {
      inBounds = false;
    }
  }
  check('crack mesh sits on the targeted block, not elsewhere', inBounds);

  // Stage governs which atlas tile is sampled; two different stages should
  // read different texture coordinates, or the overlay would never visibly
  // progress as a block is mined.
  const early = buildCrackMesh(atlas, 0, 0, 0, 0);
  const late = buildCrackMesh(atlas, 0, 0, 0, 9);
  check('different stages sample different atlas tiles',
    early.vertices[3] !== late.vertices[3] || early.vertices[4] !== late.vertices[4]);

  // Out-of-range stages should clamp rather than crash or read garbage.
  const negative = buildCrackMesh(atlas, 0, 0, 0, -5);
  const tooHigh = buildCrackMesh(atlas, 0, 0, 0, 99);
  check('a negative stage clamps to stage 0',
    negative.vertices[3] === early.vertices[3] && negative.vertices[4] === early.vertices[4]);
  check('an overlarge stage clamps to stage 9',
    tooHigh.vertices[3] === late.vertices[3] && tooHigh.vertices[4] === late.vertices[4]);
}

// --- Break particles --------------------------------------------------------
function flatWorld(): ClientWorld {
  const world = new ClientWorld(1, Dimension.Overworld);
  const chunk = world.ensureChunk(0, 0);
  for (let y = 0; y < WORLD_Y; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        chunk.data[voxelIndex(x, y, z)] = y <= 40 ? Block.Stone : Block.Air;
      }
    }
  }
  chunk.rebuildHeightmap();
  return world;
}

{
  const particles = new ParticleSystem();
  check('starts empty', particles.count === 0);

  particles.spawnBreak(atlas, 8, 45, 8, Block.Stone);
  check('a break spawns particles', particles.count > 0, `got ${particles.count}`);

  const mesh = particles.buildMesh();
  check('mesh vertex count matches particle count x24 (one cube each)',
    mesh.vertices.length / FLOATS_PER_VERTEX === particles.count * 24,
    `${mesh.vertices.length / FLOATS_PER_VERTEX} verts for ${particles.count} particles`);

  const world = flatWorld();
  const before = particles.count;
  for (let i = 0; i < 300; i++) particles.update(1 / 60, world);
  check('particles eventually die out', particles.count === 0,
    `${before} -> ${particles.count} after 5s`);
}

// --- Particle spawning is bounded, so a mining spree cannot leak memory ---
{
  const particles = new ParticleSystem();
  const world = flatWorld();
  for (let i = 0; i < 60; i++) {
    particles.spawnBreak(atlas, 8, 45, 8, Block.Stone);
    particles.update(0.001, world); // negligible time: nothing should die yet
  }
  check('particle count is bounded regardless of spawn rate', particles.count <= 300,
    `got ${particles.count}`);
}

// --- Air blocks (an optimistic client-side break that never lands) --------
{
  const particles = new ParticleSystem();
  particles.spawnBreak(atlas, 0, 0, 0, Block.Air);
  check('breaking air spawns nothing', particles.count === 0, `got ${particles.count}`);
}

console.log(failures === 0 ? '\nAll mining-feedback checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
