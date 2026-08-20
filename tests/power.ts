/**
 * NoVolt: the energy network.
 * Run: npx tsx tests/power.ts
 *
 * The whole point of the model is that pressure is spatial -- it falls off
 * with conduit distance and with how much the network is being asked to do.
 * These check that both really happen, because if they do not, NoVolt is just
 * an on/off switch wearing a number.
 */

import { Block } from '../shared/src/blocks.js';
import { Dimension, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { Item } from '../shared/src/items.js';
import {
  LINE_LOSS, MAX_BOOST, boostAt, demandOf, isConduit, isConsumer,
  isSource, pressureAt, requiresNoVolt,
} from '../shared/src/novolt.js';
import { findRecipe } from '../shared/src/recipes.js';
import { MachineWorld } from '../client/src/machines.js';
import { ClientWorld } from '../client/src/world.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

function flatWorld(): ClientWorld {
  const world = new ClientWorld(11, Dimension.Overworld);
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
  return world;
}

const NOWHERE = { x: -999, y: -999, z: -999 };
const run = (m: MachineWorld, w: ClientWorld, s: number, dt = 1 / 30): void => {
  for (let i = 0; i < Math.round(s / dt); i++) m.update(dt, w, NOWHERE, () => 0);
};

/** A fuelled generator wired east to a single miner, `cables` blocks along. */
function line(cables: number): {
  m: MachineWorld; w: ClientWorld; miner: [number, number, number];
} {
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(2, 41, 8, Block.Generator);
  for (let i = 1; i <= cables; i++) w.setBlock(2 + i, 41, 8, Block.Cable);
  const mx = 3 + cables;
  w.setBlock(mx, 41, 8, Block.Miner);
  m.register(2, 41, 8);
  m.register(mx, 41, 8);
  m.insert(2, 41, 8, Item.Coal, 6);
  return { m, w, miner: [mx, 41, 8] };
}

// --- The model ------------------------------------------------------------
{
  check('conduit conducts', isConduit(Block.Cable));
  check('stone does not', !isConduit(Block.Stone));
  check('a generator is a source', isSource(Block.Generator));
  check('a miner is a consumer', isConsumer(Block.Miner));
  check('a crusher will not run without NoVolt', requiresNoVolt(Block.Crusher));
  check('a miner will', !requiresNoVolt(Block.Miner));
  check('line loss is a real cost', LINE_LOSS > 0);

  check('pressure falls with distance',
    pressureAt(100, 10, 0) < pressureAt(100, 1, 0),
    `${pressureAt(100, 1, 0)} nV at 1 block vs ${pressureAt(100, 10, 0)} at 10`);
  check('pressure falls with load',
    pressureAt(100, 1, 80) < pressureAt(100, 1, 0),
    `${pressureAt(100, 1, 0)} nV idle vs ${pressureAt(100, 1, 80)} loaded`);
  check('pressure never goes negative', pressureAt(10, 99, 99) === 0);

  const min = demandOf(Block.Miner)!.minimum;
  check('below its minimum a machine does not run', boostAt(Block.Miner, min - 1) === 0);
  check('at its minimum it runs at base rate', boostAt(Block.Miner, min) === 1);
  check('more pressure runs it faster', boostAt(Block.Miner, min + 60) > 1);
  check('boost is capped', boostAt(Block.Miner, 10000) === MAX_BOOST);
  check('a crusher demands more than a furnace',
    demandOf(Block.Crusher)!.draw > demandOf(Block.Furnace)!.draw);
}

// --- Distance genuinely matters in the running game -----------------------
{
  const near = line(1);
  const far = line(12);
  run(near.m, near.w, 1);
  run(far.m, far.w, 1);
  const pNear = near.m.pressureAtBlock(...near.miner);
  const pFar = far.m.pressureAtBlock(...far.miner);

  check('a machine near its source gets more pressure than a distant one',
    pNear > pFar, `${pNear.toFixed(0)} nV at 1 block vs ${pFar.toFixed(0)} nV at 12`);
  check('a long run still delivers something', pFar > 0, `${pFar.toFixed(0)} nV`);

  const dug = (t: { m: MachineWorld; w: ClientWorld }): number => {
    let n = 0;
    t.m.onSetBlock = (x, y, z, b) => { n++; t.w.setBlock(x, y, z, b); };
    run(t.m, t.w, 25);
    return n;
  };
  const a = dug(near);
  const b = dug(far);
  check('and that difference shows up as work done', a > b,
    `${a} blocks mined close vs ${b} far away`);
}

// --- Too long a run starves a machine entirely ---------------------------
{
  const t = line(30);
  run(t.m, t.w, 1);
  check('a run long enough drops below the minimum', !t.m.isPowered(...t.miner),
    `${t.m.pressureAtBlock(...t.miner).toFixed(0)} nV`);
}

// --- A booster rescues a long run ----------------------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(0, 41, 8, Block.Generator);
  for (let x = 1; x <= 14; x++) w.setBlock(x, 41, 8, Block.Cable);
  w.setBlock(15, 41, 8, Block.Miner);
  m.register(0, 41, 8);
  m.register(15, 41, 8);
  m.insert(0, 41, 8, Item.Coal, 6);
  run(m, w, 1);
  const without = m.pressureAtBlock(15, 41, 8);

  w.setBlock(7, 41, 8, Block.Booster);
  run(m, w, 1);
  const boosted = m.pressureAtBlock(15, 41, 8);
  check('a booster restores pressure down a long run', boosted > without,
    `${without.toFixed(0)} nV without vs ${boosted.toFixed(0)} nV with`);
}

// --- Load is shared: more machines means less for each -------------------
{
  const build = (miners: number): number => {
    const w = flatWorld();
    const m = new MachineWorld();
    w.setBlock(2, 41, 8, Block.Generator);
    for (let x = 3; x <= 5; x++) w.setBlock(x, 41, 8, Block.Cable);
    m.register(2, 41, 8);
    const spots: Array<[number, number, number]> = [];
    for (let i = 0; i < miners; i++) {
      const p: [number, number, number] = [3 + (i % 3), 42 + Math.floor(i / 3), 8];
      w.setBlock(p[0], p[1], p[2], Block.Miner);
      m.register(p[0], p[1], p[2]);
      spots.push(p);
    }
    m.insert(2, 41, 8, Item.Coal, 8);
    run(m, w, 1);
    return m.pressureAtBlock(spots[0][0], spots[0][1], spots[0][2]);
  };
  const alone = build(1);
  const crowded = build(6);
  check('each extra machine costs the others pressure', crowded < alone,
    `${alone.toFixed(0)} nV alone vs ${crowded.toFixed(0)} nV with six`);
}

// --- Fuel gates the whole thing ------------------------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(2, 41, 8, Block.Generator);
  w.setBlock(3, 41, 8, Block.Cable);
  w.setBlock(4, 41, 8, Block.Miner);
  m.register(2, 41, 8);
  m.register(4, 41, 8);
  run(m, w, 1);
  check('an unfuelled generator delivers nothing', !m.isPowered(4, 41, 8));
  m.insert(2, 41, 8, Item.Coal, 1);
  run(m, w, 1);
  check('fuelling it brings the run up', m.isPowered(4, 41, 8));
}

// --- A break in the conduit cuts the run ---------------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(2, 41, 8, Block.Generator);
  for (let x = 3; x <= 6; x++) w.setBlock(x, 41, 8, Block.Cable);
  w.setBlock(8, 41, 8, Block.Miner);   // gap at x=7
  m.register(2, 41, 8);
  m.register(8, 41, 8);
  m.insert(2, 41, 8, Item.Coal, 6);
  run(m, w, 1);
  check('a break in the conduit cuts the run', !m.isPowered(8, 41, 8));
  w.setBlock(7, 41, 8, Block.Cable);
  run(m, w, 1);
  check('repairing it restores the run', m.isPowered(8, 41, 8));
}

// --- The crusher gate ----------------------------------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(8, 41, 8, Block.Crusher);
  m.register(8, 41, 8);
  m.insert(8, 41, 8, Block.IronOre, 1);
  run(m, w, 8);
  check('an unpowered crusher produces nothing', m.items.length === 0,
    `${m.items.length} items out`);

  w.setBlock(7, 41, 8, Block.Generator);
  m.register(7, 41, 8);
  m.insert(7, 41, 8, Item.Coal, 3);
  run(m, w, 12);
  const out = m.items.filter((i) => i.id === Block.IronOre);
  check('a powered crusher doubles the ore', out.length > 0 && out[0].count === 2,
    out.length ? `count ${out[0].count}` : 'nothing produced');
}

// --- Everything is craftable ---------------------------------------------
{
  const I = Item.IronIngot;
  const C = Block.Cobblestone;
  check('conduit is craftable',
    findRecipe({
      width: 3, height: 3,
      cells: [I, I, I, null, null, null, null, null, null],
    })?.result.id === Block.Cable);
  check('a generator is craftable',
    findRecipe({
      width: 3, height: 3,
      cells: [I, I, I, I, Block.Furnace, I, I, C, I],
    })?.result.id === Block.Generator);
  check('a booster is craftable',
    findRecipe({
      width: 3, height: 3,
      cells: [null, I, null, I, Item.GoldIngot, I, null, I, null],
    })?.result.id === Block.Booster);
}

console.log(failures === 0 ? '\nAll NoVolt checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
