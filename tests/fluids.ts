/**
 * The fluids pack: water and lava that flow, dry up, meet and push.
 * Run: npx tsx tests/fluids.ts
 *
 * The flow is driven through the real hooks -- the neighbour-change queue,
 * the after-place hook and the fluid system's update -- over a real
 * ClientWorld with a flat stone floor, the same way main.ts drives them.
 * The GameContext is a small fake that applies edits by the shared replace
 * rule and records what the pack asked the game to do.
 */

import { BLOCKS, Block, blockDef, canReplace } from '../shared/src/blocks.js';
import { Dimension, SEA_LEVEL, SECTION_Y, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { FLUIDS_PACK, WATER_FLUID, LAVA_FLUID } from '../shared/src/content/fluids.js';
import {
  canHoldFluid, flowVector, fluidHeight, fluidLevel, isFluidEdit, isFlowing, isWashable, isWater,
} from '../shared/src/fluids.js';
import { Item, blockDrops, itemDef } from '../shared/src/items.js';
import { MobKind } from '../shared/src/mobs.js';
import { columnHeight } from '../shared/src/terrain.js';
import {
  dispatchAfterPlace, dispatchBreak, dispatchUse, dispatchUseAir, flushNeighbourChanges,
  noteBlockChanged, resetSystems, type GameContext, type UseContext,
} from '../client/src/content/api.js';
import '../client/src/content/index.js';
import { liquidInSight } from '../client/src/content/combat.js';
import { EDIT_BUDGET, FLOW_RANGE, MAX_QUEUED, UPDATE_BUDGET, flow, fluidSystem } from '../client/src/content/fluids.js';
import { MachineWorld } from '../client/src/machines.js';
import { FLOATS_PER_VERTEX, meshSection } from '../client/src/mesher.js';
import { Mob, MobWorld } from '../client/src/mobs.js';
import { CURRENT_SPEED, EYE_HEIGHT, Player, type InputState } from '../client/src/player.js';
import { ClientWorld } from '../client/src/world.js';
import { nodeAtlas } from './diagnostics/offscreen.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- a small world ------------------------------------------------------------------

/** The floor's top layer; everything at or below is stone, air above. */
const GROUND = 40;
const Y = GROUND + 1;

interface Game extends GameContext {
  held: number | null;
  dropped: Array<{ id: number; count: number; x: number; y: number; z: number }>;
  /** Every edit the pack made through setBlock, in order. */
  edits: Array<{ x: number; y: number; z: number; id: number }>;
  clock: number;
  put(x: number, y: number, z: number, id: number): void;
  /** Runs the fluid system and the neighbour queue for `seconds`. */
  run(seconds: number, dt?: number): void;
}

const NOOP = () => {};
const SOUND = new Proxy({}, { get: () => NOOP }) as GameContext['sound'];

function contextOver(world: ClientWorld, opts: { creative?: boolean } = {}): Game {
  const player = new Player();
  player.x = 0.5; player.y = Y; player.z = 0.5;
  const g: Game = {
    world, dimension: world.dim, player, mobs: new MobWorld(world.dim), sound: SOUND,
    creative: opts.creative ?? false,
    get time() { return g.clock; },
    clock: 0,
    held: null,
    dropped: [],
    edits: [],
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    setBlock(x, y, z, id) {
      if (y < 1 || y >= WORLD_Y) return false;
      if (!canReplace(world.getBlock(x, y, z), id)) return false;
      world.setBlock(x, y, z, id);
      g.edits.push({ x, y, z, id });
      noteBlockChanged(x, y, z);
      return true;
    },
    breakBlock(x, y, z) {
      const id = world.getBlock(x, y, z);
      if (id === Block.Air || !blockDef(id).breakable) return;
      for (const d of blockDrops(id, () => 0.5, null)) g.dropped.push({ ...d, x, y, z });
      world.setBlock(x, y, z, Block.Air);
      g.edits.push({ x, y, z, id: Block.Air });
      noteBlockChanged(x, y, z);
      dispatchBreak(g, x, y, z, id, null);
    },
    heldItem: () => g.held,
    consumeHeld: () => g.held !== null,
    replaceHeld: (id) => { g.held = id; },
    give: NOOP,
    dropItem: (x, y, z, id, count) => { g.dropped.push({ id, count, x, y, z }); },
    damagePlayer: NOOP,
    healPlayer: NOOP,
    pushPlayer: NOOP,
    hurtMob: NOOP,
    toast: NOOP,
    chat: NOOP,
    breakParticles: NOOP,
    swing: NOOP,
    random: () => 0.5,
    countItem: () => 0,
    takeItem: () => false,
    put(x, y, z, id) {
      world.setBlock(x, y, z, id);
    },
    run(seconds, dt = 1 / 60) {
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        g.clock += dt;
        fluidSystem.update!(g, dt);
        flushNeighbourChanges(g, 100000);
      }
    },
  };
  return g;
}

/** A stone floor 48 blocks square (x and z from -16 to 31), air above. */
function makeGame(opts: { creative?: boolean } = {}): Game {
  resetSystems();
  const world = new ClientWorld(1, Dimension.Overworld);
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
      const chunk = world.ensureChunk(cx, cz);
      chunk.data.fill(0);
      for (let y = 0; y <= GROUND; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.data[voxelIndex(x, y, z)] = y === 0 ? Block.Bedrock : Block.Stone;
        }
      }
      chunk.rebuildHeightmap();
    }
  }
  return contextOver(world, opts);
}

/** Puts a source down the way a player would, hooks and all. */
function pour(g: Game, x: number, y: number, z: number, id: number): void {
  g.setBlock(x, y, z, id);
  dispatchAfterPlace(g, x, y, z, id);
}

/** A context for right-clicking the block at (x, y, z) on its `face`. */
function useOn(g: Game, x: number, y: number, z: number, face: [number, number, number]): UseContext {
  return Object.assign(Object.create(g), {
    x, y, z, id: g.getBlock(x, y, z), face,
    point: [x + 0.5 + face[0] / 2, y + 0.5 + face[1] / 2, z + 0.5 + face[2] / 2],
    held: g.held, sneaking: false,
  }) as UseContext;
}

function lookAt(p: Player, x: number, y: number, z: number): void {
  const dx = x - p.x;
  const dy = y - (p.y + EYE_HEIGHT);
  const dz = z - p.z;
  p.yaw = (Math.atan2(dz, dx) * 180) / Math.PI;
  p.pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
}

/** Water cells of any state in a box of the world. */
function waterIn(g: Game, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): number {
  let n = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (isWater(g.getBlock(x, y, z))) n++;
  }
  return n;
}

const level = (g: Game, x: number, y: number, z: number): number => fluidLevel(g.getBlock(x, y, z));
const name = (id: number): string => blockDef(id).name + `#${id}`;

// --- the states -------------------------------------------------------------------------

{
  const water = [Block.Water, ...WATER_FLUID.flows, WATER_FLUID.falling];
  const lava = [Block.Lava, ...LAVA_FLUID.flows, LAVA_FLUID.falling];
  check('water has seven flowing levels and a falling state', WATER_FLUID.flows.length === 7 &&
    water.every((id) => blockDef(id).liquid));
  check('lava has three', LAVA_FLUID.flows.length === 3 && lava.every((id) => blockDef(id).liquid));
  check('the fluids pack owns ids 210-229',
    [...water, ...lava].every((id) => id === Block.Water || id === Block.Lava || (id >= 210 && id <= 229)));
  check('every water state is in the source\'s family',
    water.every((id) => blockDef(id).family === 'water'), water.map((id) => blockDef(id).family).join(','));
  check('every lava state is in the source\'s family', lava.every((id) => blockDef(id).family === 'lava'));
  const flowing = [...water.slice(1), ...lava.slice(1)];
  check('flowing states cannot be mined', flowing.every((id) => !blockDef(id).breakable));
  check('and drop nothing', flowing.every((id) => blockDrops(id).length === 0));
  check('and are not in the creative menu', flowing.every((id) => !blockDef(id).category && !itemDef(id).category));
  check('flowing lava still glows', LAVA_FLUID.flows.every((id) => blockDef(id).light === 15));
  check('flowing water is see-through, like its source',
    flowing.every((id) => blockDef(id).translucent && !blockDef(id).opaque && !blockDef(id).solid));

  // What the server will take.
  check('any water state converts to any other', water.every((a) => water.every((b) => a === b || canReplace(a, b))));
  check('water can spread into air', canReplace(Block.Air, Block.WaterFlow3));
  check('and dry back up to it', canReplace(Block.WaterFlow3, Block.Air));
  check('a stream can be built into', canReplace(Block.WaterFlow2, Block.Stone));
  for (const [from, to] of FLUIDS_PACK.transitions ?? []) {
    check(`the server takes ${name(from)} -> ${name(to)}`, canReplace(from, to));
  }
  check('flow edits may reach past arm\'s length', isFluidEdit(Block.Air, Block.WaterFlow5) &&
    isFluidEdit(Block.WaterFlow5, Block.Air) && isFluidEdit(Block.WaterFlow1, Block.Water) &&
    isFluidEdit(Block.Torch, Block.Air) && isFluidEdit(Block.Lava, Block.Obsidian) &&
    isFluidEdit(Block.LavaFlow2, Block.Cobblestone) && isFluidEdit(Block.Water, Block.Stone));
  check('but placing a source or mining is not a flow edit', !isFluidEdit(Block.Air, Block.Water) &&
    !isFluidEdit(Block.Air, Block.Lava) && !isFluidEdit(Block.Stone, Block.Air) &&
    !isFluidEdit(Block.Air, Block.Stone) && !isFluidEdit(Block.Lava, Block.Stone));
  check('torches, flowers, crops, cobwebs and grass wash away',
    [Block.Torch, Block.Poppy, Block.TallGrass, Block.Wheat2, Block.Cobweb, Block.SnowLayer].every(isWashable));
  check('ladders, spikes and machinery do not',
    ![Block.Ladder, Block.IronSpikes, Block.Elevator, Block.Stone, Block.Chest, Block.Air].some(isWashable));
  check('open air holds fluid, stone does not', canHoldFluid(Block.Air) && !canHoldFluid(Block.Stone));
  check('no two blocks share an id', new Set(BLOCKS.filter(Boolean).map((d) => d.id)).size ===
    BLOCKS.filter(Boolean).length);
}

// --- spreading on a floor ------------------------------------------------------------------

{
  const g = makeGame();
  pour(g, 8, Y, 8, Block.Water);
  g.run(0.1);
  check('a poured source waits its turn', level(g, 9, Y, 8) === -1);
  g.run(0.3);
  check('a quarter second later it has spread one block each way',
    level(g, 9, Y, 8) === 1 && level(g, 7, Y, 8) === 1 && level(g, 8, Y, 9) === 1 && level(g, 8, Y, 7) === 1);
  check('but not two', level(g, 10, Y, 8) === -1);
  g.run(4);
  const levels = [1, 2, 3, 4, 5, 6, 7].map((d) => level(g, 8 + d, Y, 8));
  check('along a line the level drops by one a block, 1..7', levels.join(',') === '1,2,3,4,5,6,7', levels.join(','));
  check('it reaches exactly seven blocks', level(g, 15, Y, 8) === 7 && g.getBlock(16, Y, 8) === Block.Air);
  check('the same in every direction',
    level(g, 1, Y, 8) === 7 && g.getBlock(0, Y, 8) === Block.Air &&
    level(g, 8, Y, 15) === 7 && g.getBlock(8, Y, 16) === Block.Air);
  check('levels count steps around corners, not straight lines', level(g, 11, Y, 11) === 6 &&
    level(g, 12, Y, 11) === 7 && g.getBlock(12, Y, 12) === Block.Air);
  const cells = waterIn(g, -8, 24, Y, Y, -8, 24);
  check('the pool is a diamond of 113 cells', cells === 113, String(cells));
  check('nothing spilled upward or into the floor', waterIn(g, -8, 24, Y + 1, Y + 3, -8, 24) === 0 &&
    waterIn(g, -8, 24, GROUND, GROUND, -8, 24) === 0);
  check('the source is still a source', g.getBlock(8, Y, 8) === Block.Water);
  const before = g.edits.length;
  g.run(2);
  check('and then it is still: nothing more changes', g.edits.length === before && flow.pending === 0,
    `${g.edits.length - before} edits, ${flow.pending} pending`);

  // Drying up.
  g.setBlock(8, Y, 8, Block.Air);
  g.run(0.3);
  const next = g.getBlock(9, Y, 8);
  check('with its source gone the nearest cell weakens rather than vanishing',
    isFlowing(next) && fluidLevel(next) > 1, name(next));
  g.run(6);
  const left = waterIn(g, -8, 24, Y, Y, -8, 24);
  check('and the whole pool dries up', left === 0, String(left));
}

// --- walls, cliffs and drops ------------------------------------------------------------------

{
  const g = makeGame();
  for (let z = 0; z < 16; z++) g.put(11, Y, z, Block.Stone);
  pour(g, 8, Y, 8, Block.Water);
  g.run(4);
  check('a wall stops it', g.getBlock(11, Y, 8) === Block.Stone && waterIn(g, 12, 20, Y, Y, 0, 15) === 0);
  check('and the water beside the wall has the level of its distance', level(g, 10, Y, 8) === 2);
  check('it still spreads the other way', level(g, 1, Y, 8) === 7);
}

{
  // A plateau five blocks high for x <= 8; the source sits on it, three
  // blocks back from the edge.
  const g = makeGame();
  const TOP = Y + 5;
  for (let x = -16; x <= 8; x++) for (let z = -16; z < 32; z++) for (let y = Y; y < TOP; y++) g.put(x, y, z, Block.Stone);
  pour(g, 5, TOP, 8, Block.Water);
  g.run(8);
  const column = [0, 1, 2, 3, 4].map((d) => g.getBlock(9, Y + d, 8));
  check('it runs off the cliff edge', isWater(g.getBlock(9, TOP, 8)));
  check('and falls straight down as falling water',
    column.every((id) => id === Block.WaterFalling), column.map(name).join(' '));
  check('and spreads again below, seven blocks from where it landed',
    level(g, 10, Y, 8) === 1 && level(g, 16, Y, 8) === 7 && g.getBlock(17, Y, 8) === Block.Air,
    [10, 16, 17].map((x) => name(g.getBlock(x, Y, 8))).join(' '));
  check('the fall ends in no puddle beside the column in mid-air', waterIn(g, 10, 12, Y + 1, TOP - 1, 0, 15) === 0);
  // A drop three blocks away draws the whole flow toward it.
  check('water on the plateau runs toward the edge, not away from it',
    g.getBlock(4, TOP, 8) === Block.Air && g.getBlock(5, TOP, 9) === Block.Air,
    `${name(g.getBlock(4, TOP, 8))} ${name(g.getBlock(5, TOP, 9))}`);

  // Take the source away and the fall stops too.
  g.setBlock(5, TOP, 8, Block.Air);
  g.run(12);
  const left = waterIn(g, -16, 31, Y, TOP, -16, 31);
  check('without its source the waterfall and its pool dry up', left === 0, String(left));
}

{
  // A one-deep hole three blocks east: the source sends everything there.
  const g = makeGame();
  g.put(11, GROUND, 8, Block.Air);
  pour(g, 8, Y, 8, Block.Water);
  g.run(0.3);
  check('with a hole in reach the first step goes only toward it',
    level(g, 9, Y, 8) === 1 && g.getBlock(7, Y, 8) === Block.Air &&
    g.getBlock(8, Y, 9) === Block.Air && g.getBlock(8, Y, 7) === Block.Air);
  g.run(4);
  check('the hole fills', isWater(g.getBlock(11, GROUND, 8)));
  check('and the water never spreads the other way', waterIn(g, -8, 7, Y, Y, -8, 24) === 0 &&
    waterIn(g, 8, 8, Y, Y, 9, 24) === 0);
  check('nor past the hole', waterIn(g, 12, 24, Y, Y, 8, 8) === 0);

  // The same hole six blocks away is out of sight: it spreads evenly.
  const far = makeGame();
  far.put(14, GROUND, 8, Block.Air);
  pour(far, 8, Y, 8, Block.Water);
  far.run(0.3);
  check('a hole beyond the search distance does not steer it', level(far, 7, Y, 8) === 1 && level(far, 9, Y, 8) === 1);
}

// --- infinite water ------------------------------------------------------------------------------

{
  const g = makeGame();
  pour(g, 8, Y, 8, Block.Water);
  pour(g, 10, Y, 8, Block.Water);
  g.run(1);
  check('two sources with a gap between them fill it with a third', g.getBlock(9, Y, 8) === Block.Water);
  g.setBlock(8, Y, 8, Block.Air);
  g.run(1);
  check('which outlives either of the first two being taken', g.getBlock(9, Y, 8) === Block.Water &&
    isFlowing(g.getBlock(8, Y, 8)), name(g.getBlock(8, Y, 8)));

  // Over a hole there is nothing to hold it.
  const h = makeGame();
  h.put(9, GROUND, 20, Block.Air);
  h.put(9, GROUND - 1, 20, Block.Air);
  pour(h, 8, Y, 20, Block.Water);
  pour(h, 10, Y, 20, Block.Water);
  h.run(2);
  check('but not over a hole', h.getBlock(9, Y, 20) !== Block.Water, name(h.getBlock(9, Y, 20)));

  // Lava is not renewable.
  const l = makeGame();
  pour(l, 8, Y, 8, Block.Lava);
  pour(l, 10, Y, 8, Block.Lava);
  l.run(4);
  check('two lava sources make no third', l.getBlock(9, Y, 8) !== Block.Lava && isFlowing(l.getBlock(9, Y, 8)));
}

// --- lava --------------------------------------------------------------------------------------------

{
  const g = makeGame();
  pour(g, 8, Y, 8, Block.Lava);
  g.run(1);
  check('lava is slow: nothing after one second', g.getBlock(9, Y, 8) === Block.Air);
  g.run(1);
  check('one block after two', fluidLevel(g.getBlock(9, Y, 8)) === 1 && g.getBlock(10, Y, 8) === Block.Air);
  g.run(8);
  const ls = [1, 2, 3].map((d) => level(g, 8 + d, Y, 8));
  check('it runs three blocks, a level a block', ls.join(',') === '1,2,3' && g.getBlock(12, Y, 8) === Block.Air,
    ls.join(','));
}

// --- where water meets lava ------------------------------------------------------------------------

{
  // Lava source, water poured beside it: obsidian.
  const g = makeGame();
  g.put(8, Y, 8, Block.Lava);
  pour(g, 10, Y, 8, Block.Water);
  g.run(1);
  check('a lava source reached by water sets to obsidian', g.getBlock(8, Y, 8) === Block.Obsidian,
    name(g.getBlock(8, Y, 8)));
}

{
  // A channel along x: lava from the west has settled; water let in from the east.
  const g = makeGame();
  for (let x = 0; x <= 14; x++) { g.put(x, Y, 7, Block.Stone); g.put(x, Y, 9, Block.Stone); }
  g.put(1, Y, 8, Block.Stone);
  g.put(14, Y, 8, Block.Stone);
  pour(g, 2, Y, 8, Block.Lava);
  g.run(6);
  check('the lava settles three blocks down the channel', level(g, 5, Y, 8) === 3);
  pour(g, 12, Y, 8, Block.Water);
  g.run(4);
  check('flowing lava touched by running water sets to cobblestone', g.getBlock(5, Y, 8) === Block.Cobblestone,
    name(g.getBlock(5, Y, 8)));
  check('the water stops against it', isWater(g.getBlock(6, Y, 8)));
  check('and the lava behind, untouched, is still lava', g.getBlock(2, Y, 8) === Block.Lava &&
    fluidLevel(g.getBlock(3, Y, 8)) === 1);
}

{
  // Water poured on top of flowing lava, in a trough two blocks deep and
  // exactly as long as the lava runs, so the water can only go along it.
  const g = makeGame();
  for (let y = Y; y <= Y + 1; y++) {
    for (let x = 17; x <= 22; x++) { g.put(x, y, 7, Block.Stone); g.put(x, y, 9, Block.Stone); }
    g.put(17, y, 8, Block.Stone);
    g.put(22, y, 8, Block.Stone);
  }
  pour(g, 18, Y, 8, Block.Lava);
  g.run(6);
  check('lava runs down the trough', level(g, 21, Y, 8) === 3);
  pour(g, 21, Y + 1, 8, Block.Water);
  g.run(0.5);
  check('water coming down onto flowing lava makes stone', g.getBlock(21, Y, 8) === Block.Stone,
    name(g.getBlock(21, Y, 8)));
  g.run(3);
  check('onto the lava source, obsidian', g.getBlock(18, Y, 8) === Block.Obsidian, name(g.getBlock(18, Y, 8)));
}

{
  // Lava pouring down into a pool.
  const g = makeGame();
  g.put(26, Y, 20, Block.Stone);
  pour(g, 26, Y + 1, 20, Block.Water);
  pour(g, 26, Y + 3, 20, Block.Lava);
  g.run(0.2);
  check('the water under a lava fall is left alone at first', g.getBlock(26, Y + 1, 20) === Block.Water);
  g.run(4);
  check('lava falling onto water turns the water to stone', g.getBlock(26, Y + 1, 20) === Block.Stone,
    `${name(g.getBlock(26, Y + 2, 20))} over ${name(g.getBlock(26, Y + 1, 20))}`);
}

// --- washing things away ---------------------------------------------------------------------------

{
  const g = makeGame();
  g.put(10, Y, 8, Block.Torch);
  g.put(8, GROUND, 11, Block.Grass);
  g.put(8, Y, 11, Block.Poppy);
  g.put(6, Y, 8, Block.Ladder);
  pour(g, 8, Y, 8, Block.Water);
  g.run(3);
  check('running water sweeps a torch away', isWater(g.getBlock(10, Y, 8)));
  check('and a flower', isWater(g.getBlock(8, Y, 11)));
  check('dropping them both as items', g.dropped.some((d) => d.id === Block.Torch) &&
    g.dropped.some((d) => d.id === Block.Poppy), g.dropped.map((d) => name(d.id)).join(','));
  check('a ladder holds', g.getBlock(6, Y, 8) === Block.Ladder);
}

// --- loading a world ----------------------------------------------------------------------------------

{
  // Find an ocean: a column well below sea level, a few chunks from any shore.
  let ocean: [number, number] | null = null;
  for (let r = 0; r < 4000 && !ocean; r += 16) {
    for (const [x, z] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
      if (columnHeight(7, x, z) < SEA_LEVEL - 6 && columnHeight(7, x + 24, z) < SEA_LEVEL - 2 &&
          columnHeight(7, x - 24, z) < SEA_LEVEL - 2) { ocean = [x, z]; break; }
    }
  }
  check('the generator makes oceans to test with', ocean !== null);
  if (ocean) {
    resetSystems();
    const world = new ClientWorld(7, Dimension.Overworld);
    const [ox, oz] = ocean;
    for (let cx = (ox >> 4) - 2; cx <= (ox >> 4) + 2; cx++) {
      for (let cz = (oz >> 4) - 2; cz <= (oz >> 4) + 2; cz++) world.ensureChunk(cx, cz);
    }
    // And as a save with edits in it would arrive: applied, not placed.
    world.applyEdits(ox >> 4, oz >> 4, []);
    const g = contextOver(world);
    g.player.x = ox + 0.5; g.player.y = SEA_LEVEL + 1; g.player.z = oz + 0.5;
    let water = 0;
    for (let x = ox - 8; x < ox + 8; x++) for (let z = oz - 8; z < oz + 8; z++) if (isWater(g.getBlock(x, SEA_LEVEL, z))) water++;
    check('the chunk is ocean', water > 200, String(water));
    g.run(3);
    check('an ocean loaded from the generator does not start flowing',
      flow.pending === 0 && flow.parkedCount === 0 && g.edits.length === 0,
      `${flow.pending} pending, ${g.edits.length} edits`);

    // Scooping one bucket out of the sea wakes only the water around it,
    // which fills the hole straight back in from its neighbours.
    g.setBlock(ox, SEA_LEVEL, oz, Block.Air);
    flushNeighbourChanges(g, 100000);
    check('touching it queues only the cells around the change', flow.pending > 0 && flow.pending <= 6,
      String(flow.pending));
    g.run(3);
    check('and the sea closes over the hole', isWater(g.getBlock(ox, SEA_LEVEL, oz)) &&
      g.getBlock(ox, SEA_LEVEL, oz) === Block.Water, name(g.getBlock(ox, SEA_LEVEL, oz)));
    check('then goes still again', flow.pending === 0 && g.edits.length < 10, String(g.edits.length));
  }
}

// --- a flood ----------------------------------------------------------------------------------------------

{
  // Forty sources at once across the floor, plus a sea let in through a wall.
  const g = makeGame();
  let worstUpdates = 0;
  let worstEdits = 0;
  let worstMs = 0;
  for (let x = -14; x <= 28; x += 7) for (let z = -14; z <= 28; z += 7) pour(g, x, Y, z, Block.Water);
  for (let i = 0; i < 60 * 20 && (flow.pending > 0 || i < 10); i++) {
    const t0 = performance.now();
    g.clock += 1 / 60;
    fluidSystem.update!(g, 1 / 60);
    flushNeighbourChanges(g, 100000);
    worstMs = Math.max(worstMs, performance.now() - t0);
    worstUpdates = Math.max(worstUpdates, flow.last.updates);
    worstEdits = Math.max(worstEdits, flow.last.edits);
  }
  check('under a flood no frame looks at more cells than the budget', worstUpdates <= UPDATE_BUDGET,
    `${worstUpdates} of ${UPDATE_BUDGET}`);
  // A cell started when the budget was nearly spent may finish its few edits.
  check('nor changes more than the budget and one cell\'s worth', worstEdits <= EDIT_BUDGET + 10 && worstEdits > 0,
    `${worstEdits}`);
  check('the queue stays under its ceiling', flow.peakQueued <= MAX_QUEUED);
  check('no frame stalls', worstMs < 250, `${worstMs.toFixed(1)} ms`);
  check('and the flood still finishes', flow.pending === 0);
  const covered = waterIn(g, -16, 31, Y, Y, -16, 31);
  check('covering the whole floor', covered === 48 * 48, String(covered));

  // Every cell of that sea woken at once, as a reload mid-flood would:
  // most have nothing to do, and the cell budget is what spreads them out.
  for (let x = -16; x <= 31; x++) for (let z = -16; z <= 31; z++) flow.schedule(g, x, Y, z);
  const woken = flow.pending;
  const perFrame: number[] = [];
  for (let i = 0; i < 60 && flow.pending > 0; i++) {
    fluidSystem.update!(g, 1 / 60);
    perFrame.push(flow.last.updates);
  }
  check('with thousands due at once a frame takes exactly its budget', woken === 48 * 48 &&
    Math.max(...perFrame) === UPDATE_BUDGET, `${woken} woken, ${Math.max(...perFrame)} per frame`);
  check('and the rest wait for the next frames', perFrame.filter((n) => n > 0).length >= Math.ceil(woken / UPDATE_BUDGET),
    perFrame.join(','));
}

// --- currents -------------------------------------------------------------------------------------------

const STILL: InputState = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false };

/** A channel along +x from a source at x=2: the stream runs east. */
function stream(): Game {
  const g = makeGame();
  for (let x = 0; x <= 16; x++) { g.put(x, Y, 7, Block.Stone); g.put(x, Y, 9, Block.Stone); }
  g.put(1, Y, 8, Block.Stone);
  pour(g, 2, Y, 8, Block.Water);
  g.run(3);
  return g;
}

{
  const g = stream();
  check('the stream runs east', level(g, 6, Y, 8) === 4);
  const [fx, fz] = flowVector(g.getBlock, 6, Y, 8);
  check('its current points downstream', fx > 0.99 && Math.abs(fz) < 1e-6, `${fx},${fz}`);
  const pond = makeGame();
  for (let x = 4; x <= 6; x++) for (let z = 4; z <= 6; z++) pond.put(x, Y, z, Block.Water);
  const [px, pz] = flowVector(pond.getBlock, 5, Y, 5);
  check('the middle of a pond has no current', px === 0 && pz === 0);

  const p = g.player;
  p.x = 5.5; p.y = Y; p.z = 8.5;
  p.onGround = true;
  for (let i = 0; i < 60; i++) p.update(1 / 60, g.world, STILL);
  check('a player wading in the stream is carried downstream', p.x > 6.1 && Math.abs(p.z - 8.5) < 0.05,
    `x ${p.x.toFixed(2)}`);
  check('at a gentle pace, no faster than the current', p.x - 5.5 <= CURRENT_SPEED + 0.05, `${(p.x - 5.5).toFixed(2)}`);

  // Swimming: with the head in water of any level, the player swims.
  const swim = makeGame();
  const states = [Block.Water, ...WATER_FLUID.flows, Block.WaterFalling];
  const swims = states.map((id) => {
    swim.put(20, Y + 1, 20, id);
    swim.player.x = 20.5; swim.player.y = Y; swim.player.z = 20.5;
    swim.player.update(1 / 60, swim.world, STILL);
    return swim.player.inLiquid;
  });
  check('the player swims in water of every level', swims.every(Boolean), swims.join(','));

  // On dry ground nothing pushes.
  const dry = makeGame();
  dry.player.x = 5.5; dry.player.y = Y; dry.player.z = 8.5;
  for (let i = 0; i < 60; i++) dry.player.update(1 / 60, dry.world, STILL);
  check('on dry ground the player stays put', Math.abs(dry.player.x - 5.5) < 1e-6);

  // A pig in the stream against a pig in a still pond.
  const wet = new Mob(MobKind.Pig, 5.5, Y, 8.5);
  const calm = new Mob(MobKind.Pig, 5.5, Y, 8.5);
  const nowhere = { x: 1000, y: Y, z: 1000 };
  const pondWorld = makeGame();
  for (let x = 0; x <= 16; x++) for (let z = 7; z <= 9; z++) pondWorld.put(x, Y, z, z === 8 ? Block.Water : Block.Stone);
  for (let i = 0; i < 60; i++) {
    wet.update(1 / 60, g.world, nowhere, () => 0.5);
    calm.update(1 / 60, pondWorld.world, nowhere, () => 0.5);
  }
  check('a mob in the stream drifts downstream of one in still water', wet.x - calm.x > 0.8,
    `${wet.x.toFixed(2)} vs ${calm.x.toFixed(2)}`);

  // Dropped items float up and ride the current.
  const machines = new MachineWorld();
  machines.spawn(4.5, Y + 0.05, 8.5, Block.Cobblestone, 1, 5);
  machines.items[0].vx = 0; machines.items[0].vy = 0; machines.items[0].vz = 0;
  for (let i = 0; i < 60; i++) machines.update(1 / 60, g.world, nowhere, () => 0);
  const it = machines.items[0];
  check('a dropped item in the stream drifts downstream', it.x > 5.5, it.x.toFixed(2));
  check('floating near the surface rather than sinking', it.y > Y + fluidHeight(g.getBlock(5, Y, 8)) - 0.5 &&
    it.y < Y + 1, it.y.toFixed(2));
  const sunk = new MachineWorld();
  const dryWorld = makeGame().world;
  sunk.spawn(4.5, Y + 0.5, 8.5, Block.Cobblestone, 1, 5);
  for (let i = 0; i < 60; i++) sunk.update(1 / 60, dryWorld, nowhere, () => 0);
  check('on dry ground an item falls to the floor instead', sunk.items[0].y < Y + 0.05, sunk.items[0].y.toFixed(2));
}

// --- the water wheel ------------------------------------------------------------------------------------

{
  // A wheel driving a miner down a short cable, with the wheel's water
  // changed between runs.
  const g = makeGame();
  const w = g.world;
  w.setBlock(20, Y, 20, Block.WaterWheel);
  w.setBlock(21, Y, 20, Block.Cable);
  w.setBlock(22, Y, 20, Block.Miner);
  const powered = (water: number): boolean => {
    w.setBlock(19, Y, 20, water);
    const m = new MachineWorld();
    m.register(20, Y, 20);
    m.register(22, Y, 20);
    for (let i = 0; i < 60; i++) m.update(1 / 60, w, { x: 1000, y: Y, z: 1000 }, () => 0);
    return m.isPowered(22, Y, 20);
  };
  check('a dry water wheel does not turn', !powered(Block.Air));
  check('still water turns it', powered(Block.Water));
  check('and so does running water', powered(Block.WaterFlow5) && powered(Block.WaterFalling));
  check('but not lava', !powered(Block.LavaFlow1));
}

// --- buckets ------------------------------------------------------------------------------------------------

{
  const g = stream();
  const p = g.player;
  // Hovering over the stream, looking straight down into it: nothing to scoop.
  p.x = 6.5; p.y = Y + 1.2; p.z = 8.5;
  g.held = Item.Bucket;
  lookAt(p, 6.5, Y + 0.5, 8.5);
  check('a bucket looks straight through running water', liquidInSight(g) === null);
  dispatchUseAir(g, Item.Bucket);
  check('and will not fill from it', g.held === Item.Bucket && isFlowing(g.getBlock(6, Y, 8)));
  // Looking upstream along it, at the spring, it does.
  lookAt(p, 2.5, Y + 0.5, 8.5);
  check('it sees the source through the stream', liquidInSight(g)?.id === Block.Water);
  dispatchUseAir(g, Item.Bucket);
  check('and fills from the source', g.held === Item.WaterBucket && g.getBlock(2, Y, 8) === Block.Air);
  g.run(4);
  check('with the spring scooped up the stream dries', waterIn(g, 0, 16, Y, Y, 8, 8) === 0);

  // Pouring puts down a source, which then runs.
  const h = makeGame();
  h.held = Item.WaterBucket;
  h.player.x = 4.5; h.player.z = 4.5;
  dispatchUse(useOn(h, 8, GROUND, 8, [0, 1, 0]));
  check('a poured bucket leaves a source', h.getBlock(8, Y, 8) === Block.Water && h.held === Item.Bucket);
  h.run(1);
  check('which flows', level(h, 10, Y, 8) === 2);
  // Pouring water into running lava sets it; into a lava source, obsidian.
  h.put(20, Y, 20, Block.LavaFlow2);
  h.held = Item.WaterBucket;
  dispatchUse(useOn(h, 20, GROUND, 20, [0, 1, 0]));
  check('water poured into running lava makes cobblestone', h.getBlock(20, Y, 20) === Block.Cobblestone);
}

// --- far from the player ------------------------------------------------------------------------------

{
  const g = makeGame();
  g.player.x = 8.5 + FLOW_RANGE + 20;
  g.player.z = 8.5;
  pour(g, 8, Y, 8, Block.Water);
  g.run(2);
  check('water poured out of range waits', g.getBlock(9, Y, 8) === Block.Air && flow.parkedCount > 0,
    `${flow.parkedCount} parked`);
  g.player.x = 8.5;
  g.run(1.5);
  check('and runs once the player is back', level(g, 9, Y, 8) === 1 && flow.parkedCount === 0,
    `${name(g.getBlock(9, Y, 8))}, ${flow.parkedCount} parked`);
}

// --- multiplayer ------------------------------------------------------------------------------------------

{
  // Another player's edit arriving from the server: this client leaves the
  // simulating to them.
  const g = makeGame();
  g.put(8, Y, 8, Block.Water);
  noteBlockChanged(8, Y, 8, true);
  flushNeighbourChanges(g, 1000);
  check('a remote change does not start a flow here', flow.pending === 0);
  g.run(1);
  check('so its water sits until its owner\'s edits arrive', g.getBlock(9, Y, 8) === Block.Air);
  noteBlockChanged(8, Y, 8);
  g.run(1);
  check('a change made here does', level(g, 9, Y, 8) === 1);
}

// --- drawing ---------------------------------------------------------------------------------------------

{
  const atlas = nodeAtlas();
  const g = makeGame();
  for (let x = 3; x <= 5; x++) for (let z = 3; z <= 5; z++) g.put(x, Y, z, Block.Water);
  g.put(8, Y, 4, Block.WaterFlow7);
  g.put(12, Y + 3, 4, Block.Water);
  g.put(12, Y + 2, 4, Block.WaterFalling);
  g.put(12, Y + 1, 4, Block.WaterFalling);
  const mesh = meshSection(g.world, atlas, 0, 0, Math.floor(Y / SECTION_Y), 1)!;
  const v = mesh.alpha.vertices;
  const tops = (cx: number, cz: number): number[] => {
    const ys: number[] = [];
    for (let i = 0; i < v.length; i += FLOATS_PER_VERTEX) {
      if (v[i] >= cx && v[i] <= cx + 1 && v[i + 2] >= cz && v[i + 2] <= cz + 1 && v[i + 1] > Y + 0.01) ys.push(v[i + 1] - Y);
    }
    return ys;
  };
  const sourceTop = Math.max(...tops(4, 4));
  check('still water is drawn a little under full height', Math.abs(sourceTop - 8 / 9) < 0.02, sourceTop.toFixed(3));
  const thin = Math.max(...tops(8, 4));
  check('the weakest flow is a thin sheet', thin > 0 && thin < 0.2, thin.toFixed(3));
  check('the flowing heights step down level by level',
    WATER_FLUID.flows.every((id, i) => i === 0 || fluidHeight(id) < fluidHeight(WATER_FLUID.flows[i - 1])));
  // Faces on the plane between two water cells are hidden.
  let shared = 0;
  for (let i = 0; i < v.length; i += FLOATS_PER_VERTEX * 4) {
    let onPlane = true;
    for (let c = 0; c < 4; c++) {
      const o = i + c * FLOATS_PER_VERTEX;
      if (Math.abs(v[o] - 5) > 1e-6 || v[o + 2] < 4 || v[o + 2] > 5 || v[o + 1] < Y || v[o + 1] > Y + 1) onPlane = false;
    }
    if (onPlane) shared++;
  }
  check('no face is drawn between two water cells', shared === 0, String(shared));
  const quads = v.length / FLOATS_PER_VERTEX / 4;
  // The pond: nine tops and its twelve outer sides; the floor hides its
  // bottom. The sheet: a top and four sides. The column: the source's top,
  // the lowest cell's bottom (it hangs over air) and four sides each -- the
  // faces where they meet are hidden.
  check('only the outside of each body of water is drawn', quads === 21 + 5 + 14, String(quads));
  let opaqueWater = 0;
  const o = mesh.opaque.vertices;
  for (let i = 0; i < o.length; i += FLOATS_PER_VERTEX) if (o[i + 1] > Y + 0.01) opaqueWater++;
  check('and all of it in the blended pass', opaqueWater === 0, String(opaqueWater));
  // A side of the middle cell of the column spans its whole height.
  let fullSide = false;
  for (let i = 0; i < v.length; i += FLOATS_PER_VERTEX * 4) {
    const ys: number[] = [];
    let inColumn = true;
    for (let c = 0; c < 4; c++) {
      const o2 = i + c * FLOATS_PER_VERTEX;
      if (v[o2] < 12 || v[o2] > 13 || v[o2 + 2] < 4 || v[o2 + 2] > 5) inColumn = false;
      ys.push(v[o2 + 1] - Y);
    }
    if (inColumn && Math.min(...ys) === 2 && Math.max(...ys) === 3) fullSide = true;
  }
  check('falling water fills its cell to the top', fullSide);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nall fluid checks passed');
}
