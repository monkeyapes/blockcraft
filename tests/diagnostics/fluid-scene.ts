/**
 * Lets water and lava run, then writes what they left as a scene for
 * scene.ts to draw -- the flow is a simulation, so there is no hand-written
 * layout of a waterfall to look at.
 *
 *   npx tsx tests/diagnostics/fluid-scene.ts --out=flow.json [--seconds=8] [--xmin=0 --xmax=47]
 *   npx tsx tests/diagnostics/scene.ts --scene=flow.json --out=flow.png
 *
 * The world is scene.ts's: three chunks along x, one along z, a stone floor
 * at y 40. In it: a plateau with a spring that runs off the edge into a
 * waterfall and a pool, and further along a lava spring with water let in
 * beside and on top of it.
 */

import { writeFileSync } from 'node:fs';
import { Block, blockDef, canReplace } from '../../shared/src/blocks.js';
import { Dimension, WORLD_Y, voxelIndex } from '../../shared/src/constants.js';
import {
  dispatchAfterPlace, dispatchBreak, flushNeighbourChanges, noteBlockChanged, resetSystems, type GameContext,
} from '../../client/src/content/api.js';
import '../../client/src/content/index.js';
import { fluidSystem } from '../../client/src/content/fluids.js';
import { MobWorld } from '../../client/src/mobs.js';
import { Player } from '../../client/src/player.js';
import { ClientWorld } from '../../client/src/world.js';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const [k, ...rest] = a.replace(/^--/, '').split('=');
  args.set(k, rest.join('=') || 'true');
}

const FLOOR = 40;
const Y = FLOOR + 1;
resetSystems();
const world = new ClientWorld(1, Dimension.Overworld);
for (let cx = 0; cx < 3; cx++) {
  const chunk = world.ensureChunk(cx, 0);
  chunk.data.fill(0);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk.data[voxelIndex(x, FLOOR, z)] = Block.Stone;
  chunk.rebuildHeightmap();
}

const NOOP = () => {};
const ctx = {
  world, dimension: Dimension.Overworld, player: new Player(), mobs: new MobWorld(Dimension.Overworld),
  creative: true, time: 0, sound: new Proxy({}, { get: () => NOOP }),
  getBlock: (x: number, y: number, z: number) => world.getBlock(x, y, z),
  setBlock(x: number, y: number, z: number, id: number) {
    if (y < 1 || y >= WORLD_Y || !canReplace(world.getBlock(x, y, z), id)) return false;
    world.setBlock(x, y, z, id);
    noteBlockChanged(x, y, z);
    return true;
  },
  breakBlock(x: number, y: number, z: number) {
    const id = world.getBlock(x, y, z);
    if (id === Block.Air || !blockDef(id).breakable) return;
    world.setBlock(x, y, z, Block.Air);
    noteBlockChanged(x, y, z);
    dispatchBreak(ctx, x, y, z, id, null);
  },
  heldItem: () => null, consumeHeld: () => true, replaceHeld: NOOP, give: NOOP, dropItem: NOOP,
  damagePlayer: NOOP, healPlayer: NOOP, pushPlayer: NOOP, hurtMob: NOOP, toast: NOOP, chat: NOOP,
  breakParticles: NOOP, countItem: () => 0, takeItem: () => true, swing: NOOP, random: () => 0.5,
} as unknown as GameContext;

const put = (x: number, y: number, z: number, id: number): void => { world.setBlock(x, y, z, id); };
const pour = (x: number, y: number, z: number, id: number): void => {
  ctx.setBlock(x, y, z, id);
  dispatchAfterPlace(ctx, x, y, z, id);
};
const run = (seconds: number): void => {
  for (let i = 0; i < seconds * 60; i++) {
    fluidSystem.update!(ctx, 1 / 60);
    flushNeighbourChanges(ctx, 100000);
  }
};

// A plateau four high along the back, a spring on it two blocks from the edge.
for (let x = 0; x <= 14; x++) for (let z = 0; z <= 5; z++) for (let y = Y; y < Y + 4; y++) put(x, y, z, Block.Stone);
pour(4, Y + 4, 3, Block.Water);
// A torch and flowers in the way, to be swept off.
put(6, Y, 9, Block.Torch);

// Lava in a pit, and water let in beside it and dropped on top of it.
for (let x = 26; x <= 40; x++) for (let z = 2; z <= 12; z++) if (x === 26 || x === 40 || z === 2 || z === 12) put(x, Y, z, Block.Stone);
pour(29, Y, 5, Block.Lava);
pour(36, Y, 9, Block.Lava);
run(Number(args.get('lava') ?? 6));
pour(38, Y, 5, Block.Water);
pour(33, Y + 2, 9, Block.Water);
run(Number(args.get('seconds') ?? 6));

// --xmin/--xmax crop the output, for a closer look at one part.
const entries: Array<[number, number, number, string]> = [];
for (let x = Number(args.get('xmin') ?? 0); x <= Number(args.get('xmax') ?? 47); x++) {
  for (let z = 0; z < 16; z++) {
    for (let y = Y; y < Y + 10; y++) {
      const id = world.getBlock(x, y, z);
      if (id !== Block.Air) entries.push([x, y - Y, z, Block[id]]);
    }
  }
}
const out = args.get('out') ?? 'flow.json';
writeFileSync(out, JSON.stringify(entries));
console.log(`${entries.length} blocks -> ${out}`);
