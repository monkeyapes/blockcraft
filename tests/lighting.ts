/**
 * Lighting checks. Run: npx tsx tests/lighting.ts
 *
 * The interesting cases are the ones a heightmap cannot answer: light that
 * has to travel sideways to reach a voxel, and light that must fall a long
 * way without dimming. A depth-below-the-roof term gets both wrong, so these
 * double as a guard against quietly regressing to one.
 */

import { Block } from '../shared/src/blocks.js';
import { Dimension, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { ClientWorld } from '../client/src/world.js';
import { MAX_LIGHT } from '../client/src/light.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

/**
 * A world holding one chunk whose contents `carve` decides outright.
 * Returning true means solid stone.
 */
function makeWorld(carve: (x: number, y: number, z: number) => boolean): ClientWorld {
  const world = new ClientWorld(1234, Dimension.Overworld);
  const chunk = world.ensureChunk(0, 0);
  for (let y = 0; y < WORLD_Y; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        chunk.data[voxelIndex(x, y, z)] = carve(x, y, z) ? Block.Stone : Block.Air;
      }
    }
  }
  chunk.rebuildHeightmap();
  world.light.resetSky(0, 0);
  return world;
}

const sky = (w: ClientWorld, x: number, y: number, z: number) => w.getSkyLight(x, y, z);

// --- Flat ground: everything above it is open sky ------------------------
{
  const w = makeWorld((_x, y) => y <= 40);
  check('open sky above ground is full', sky(w, 8, 41, 8) === MAX_LIGHT,
    `got ${sky(w, 8, 41, 8)}`);
  check('inside solid ground is dark', sky(w, 8, 20, 8) === 0,
    `got ${sky(w, 8, 20, 8)}`);
}

// --- A shaft: sunlight falls a long way without dimming ------------------
{
  // Solid to the top of the world, with one 1x1 shaft bored down to y=40.
  const w = makeWorld((x, y, z) => !(x === 8 && z === 8 && y > 40));
  check('sunlight reaches the bottom of a deep shaft undimmed',
    sky(w, 8, 41, 8) === MAX_LIGHT, `got ${sky(w, 8, 41, 8)} after ${WORLD_Y - 41} blocks`);
  check('sunlight does not dim partway down',
    sky(w, 8, 80, 8) === MAX_LIGHT, `got ${sky(w, 8, 80, 8)}`);
}

// --- A tunnel: light must travel sideways, and run out ------------------
// One layer of air at y=40 under a solid roof, open to the sky at x=2 only.
// A heightmap says every voxel here is one block below the roof and so
// uniformly bright; real propagation makes it fade with distance from the
// mouth. This is the case the revamp exists for.
{
  const w = makeWorld((x, y, z) => {
    if (y === 40) return false;                     // the tunnel
    if (y === 41) return !(x === 2 && z === 8);     // thin roof, one hole in it
    if (y > 41) return false;                       // open sky above the roof
    return true;
  });

  const mouth = sky(w, 2, 40, 8);
  const near = sky(w, 5, 40, 8);
  const deep = sky(w, 14, 40, 8);
  check('tunnel mouth is fully lit', mouth === MAX_LIGHT, `got ${mouth}`);
  check('light fades with distance from the mouth', mouth > near && near > deep,
    `mouth ${mouth}, 3 in ${near}, 12 in ${deep}`);
  check('the far end of the tunnel is dark', deep <= 3, `got ${deep}`);
  check('fade is one level per block', near === MAX_LIGHT - 3, `got ${near}`);
}

// --- Sealed room: no way in, no light ------------------------------------
{
  const w = makeWorld((x, y, z) => !(y >= 20 && y <= 22 && x >= 4 && x <= 6 && z >= 4 && z <= 6));
  check('a sealed room gets no sky light', sky(w, 5, 21, 5) === 0,
    `got ${sky(w, 5, 21, 5)}`);
}

// --- Editing blocks re-lights correctly ----------------------------------
{
  const w = makeWorld((x, y, z) => !(x === 8 && z === 8 && y > 40));
  check('shaft starts lit', sky(w, 8, 60, 8) === MAX_LIGHT);

  // Cap the shaft: everything below the cap must go dark, including voxels
  // far away from the block that actually changed.
  w.setBlock(8, 90, 8, Block.Stone);
  check('capping a shaft darkens the whole column below',
    sky(w, 8, 60, 8) === 0 && sky(w, 8, 41, 8) === 0,
    `y60 ${sky(w, 8, 60, 8)}, y41 ${sky(w, 8, 41, 8)}`);
  check('above the cap stays lit', sky(w, 8, 95, 8) === MAX_LIGHT,
    `got ${sky(w, 8, 95, 8)}`);

  // Re-opening it must restore full sunlight, not a dimmed remnant. A
  // one-phase removal would leave stale light behind here.
  w.setBlock(8, 90, 8, Block.Air);
  check('re-opening the shaft restores full sunlight',
    sky(w, 8, 60, 8) === MAX_LIGHT && sky(w, 8, 41, 8) === MAX_LIGHT,
    `y60 ${sky(w, 8, 60, 8)}, y41 ${sky(w, 8, 41, 8)}`);
}

// --- Block light still works, and is independent of the sky --------------
{
  const w = makeWorld((_x, y) => y <= 40);
  w.setBlock(8, 45, 8, Block.Torch);
  const at = (d: number) => w.getBlockLight(8 + d, 45, 8);
  check('a torch lights itself', at(0) > 0, `got ${at(0)}`);
  check('torch light falls off one level per block', at(1) === at(0) - 1 && at(2) === at(0) - 2,
    `${at(0)}, ${at(1)}, ${at(2)}`);
  check('torch light does not fall forever downward',
    w.getBlockLight(8, 44, 8) === at(0) - 1, `got ${w.getBlockLight(8, 44, 8)}`);

  w.setBlock(8, 45, 8, Block.Air);
  check('removing a torch clears its light entirely',
    at(0) === 0 && at(1) === 0 && at(2) === 0, `${at(0)}, ${at(1)}, ${at(2)}`);
}

// --- Light crosses a chunk seam, whichever chunk loads first -------------
// seedChunk skips unloaded neighbours and only exchanges light where the two
// sides disagree. Both shortcuts are only safe if a tunnel running across the
// boundary still lights up the same either way round.
{
  /** A tunnel at y=40 under a thin roof, open to the sky at x=2 only. */
  const carve = (x: number, y: number) =>
    y === 41 ? x !== 2 : y < 40;

  function build(order: Array<[number, number]>): ClientWorld {
    const w = new ClientWorld(99, Dimension.Overworld);
    for (const [cx, cz] of order) {
      const c = w.ensureChunk(cx, cz);
      for (let y = 0; y < WORLD_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            c.data[voxelIndex(x, y, z)] =
              carve(cx * 16 + x, y) ? Block.Stone : Block.Air;
          }
        }
      }
      c.rebuildHeightmap();
      // The light from the terrain this replaced is meaningless now. Left
      // behind, a neighbour would trade it back in and brighten the seam.
      c.skylight.fill(0);
    }
    // Re-light once every chunk exists, as a loaded save would.
    for (const [cx, cz] of order) w.light.resetSky(cx, cz);
    return w;
  }

  const forward = build([[0, 0], [1, 0]]);
  const reverse = build([[1, 0], [0, 0]]);

  // x=18 sits in the second chunk, 16 blocks from the mouth at x=2, so it
  // should be dark; x=8 is 6 blocks in and should still be lit.
  // x=16 is the first voxel of the second chunk, 14 blocks from the mouth.
  check('light reaches across a chunk seam at exactly the right level',
    forward.getSkyLight(16, 40, 8) === MAX_LIGHT - 14,
    `got ${forward.getSkyLight(16, 40, 8)}, expected ${MAX_LIGHT - 14}`);
  check('seam does not brighten or dim the gradient',
    forward.getSkyLight(8, 40, 8) === MAX_LIGHT - 6,
    `got ${forward.getSkyLight(8, 40, 8)}, expected ${MAX_LIGHT - 6}`);
  check('chunk load order does not change the result',
    forward.getSkyLight(16, 40, 8) === reverse.getSkyLight(16, 40, 8) &&
    forward.getSkyLight(8, 40, 8) === reverse.getSkyLight(8, 40, 8),
    `forward ${forward.getSkyLight(16, 40, 8)}, reverse ${reverse.getSkyLight(16, 40, 8)}`);
}

console.log(failures === 0 ? '\nAll lighting checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
