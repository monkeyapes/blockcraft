/**
 * Automation layer: conveyors, collectors, furnaces and miners.
 * Run: npx tsx tests/machines.ts
 *
 * These are checked by running the simulation, not by inspecting it -- the
 * question that matters is whether an item actually gets from one end of a
 * chain to the other, which no amount of unit-testing the parts answers.
 */

import { Block } from '../shared/src/blocks.js';
import { Dimension, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { Item } from '../shared/src/items.js';
import { conveyorForYaw, isConveyor, CONVEYOR_FACING } from '../shared/src/machines.js';
import { renderTile } from '../client/src/gfx/atlas.js';
import { MachineWorld } from '../client/src/machines.js';
import { ClientWorld } from '../client/src/world.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

/** Flat stone floor at y<=40, air above. */
function flatWorld(): ClientWorld {
  const world = new ClientWorld(5, Dimension.Overworld);
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

const NOWHERE = { x: -999, y: -999, z: -999 };
const NO_PICKUP = () => 0;

function run(m: MachineWorld, w: ClientWorld, seconds: number, dt = 1 / 30,
             player = NOWHERE, collect = NO_PICKUP): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) m.update(dt, w, player, collect);
}

// --- Facing ---------------------------------------------------------------
{
  // Yaw grows clockwise from -Z, so 0 faces north and a quarter turn east.
  check('yaw 0 places a north-facing belt', conveyorForYaw(0) === Block.ConveyorNorth);
  check('a quarter turn places east', conveyorForYaw(Math.PI / 2) === Block.ConveyorEast);
  check('a half turn places south', conveyorForYaw(Math.PI) === Block.ConveyorSouth);
  check('three quarters places west', conveyorForYaw(-Math.PI / 2) === Block.ConveyorWest);
  check('yaw wraps rather than falling off the end',
    conveyorForYaw(Math.PI * 4) === Block.ConveyorNorth &&
    conveyorForYaw(-Math.PI * 4) === Block.ConveyorNorth);
  check('all four facings are recognised as conveyors',
    [Block.ConveyorNorth, Block.ConveyorEast, Block.ConveyorSouth, Block.ConveyorWest]
      .every(isConveyor));
  check('a plain block is not a conveyor', !isConveyor(Block.Stone));
  check('every facing has a direction vector',
    Object.keys(CONVEYOR_FACING).length === 4);
}

// --- The arrow on a belt matches the way it actually carries -------------
// Direction lives in the block id, so this arrow is the only thing telling a
// player which way a belt runs. If it disagrees with the simulation the
// machine is not wrong, but every base built with it will be.
{
  const centre = (name: string): { x: number; y: number } => {
    const { px, size } = renderTile(name);
    // The arrow is the gold ink; find where its mass sits relative to centre.
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        if (r > 150 && g > 130 && b < 110) { sx += x; sy += y; n++; }
      }
    }
    const mid = (size - 1) / 2;
    return n === 0 ? { x: 0, y: 0 } : { x: sx / n - mid, y: sy / n - mid };
  };

  // Tile space maps u to +X and v to +Z on a top face, so tile-down is south.
  const n = centre('conveyor_n');
  const e = centre('conveyor_e');
  const s = centre('conveyor_s');
  const wv = centre('conveyor_w');
  check('the north belt points -Z', n.y < -0.5, `arrow offset y=${n.y.toFixed(2)}`);
  check('the south belt points +Z', s.y > 0.5, `arrow offset y=${s.y.toFixed(2)}`);
  check('the east belt points +X', e.x > 0.5, `arrow offset x=${e.x.toFixed(2)}`);
  check('the west belt points -X', wv.x < -0.5, `arrow offset x=${wv.x.toFixed(2)}`);
}

// --- A conveyor carries an item along its facing --------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  // A belt running east along y=40, from x=4 to x=11.
  for (let x = 4; x <= 11; x++) w.setBlock(x, 40, 8, Block.ConveyorEast);

  m.spawn(4.5, 41.2, 8.5, Block.Cobblestone, 1, 0);
  const startX = m.items[0].x;
  run(m, w, 3);

  check('an item on a belt is carried along it', m.items.length === 1 &&
    m.items[0].x > startX + 2, `moved from ${startX.toFixed(1)} to ${m.items[0]?.x.toFixed(1)}`);
  check('it stays on the belt line', Math.abs(m.items[0].z - 8.5) < 0.6,
    `z drifted to ${m.items[0]?.z.toFixed(2)}`);
}

// --- Belts in opposite directions push opposite ways ----------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  for (let x = 2; x <= 13; x++) w.setBlock(x, 40, 4, Block.ConveyorEast);
  for (let x = 2; x <= 13; x++) w.setBlock(x, 40, 10, Block.ConveyorWest);

  m.spawn(8.5, 41.2, 4.5, Block.Sand, 1, 0);
  m.spawn(8.5, 41.2, 10.5, Block.Sand, 1, 0);
  run(m, w, 2.5);

  const east = m.items.find((i) => Math.abs(i.z - 4.5) < 1);
  const west = m.items.find((i) => Math.abs(i.z - 10.5) < 1);
  check('an east belt moves +x and a west belt moves -x',
    !!east && !!west && east.x > 9 && west.x < 8,
    `east at ${east?.x.toFixed(1)}, west at ${west?.x.toFixed(1)}`);
}

// --- A collector vacuums loose items and fills up -------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(8, 41, 8, Block.Collector);
  m.register(8, 41, 8);

  m.spawn(9.8, 41.4, 8.5, Item.IronIngot, 3, 0);
  run(m, w, 4);

  check('a collector pulls in a nearby item', m.items.length === 0,
    `${m.items.length} still loose`);
  const held = m.contents(8, 41, 8);
  check('what it collected is in its buffer',
    held.length === 1 && held[0].id === Item.IronIngot && held[0].count === 3,
    JSON.stringify(held));
}

// --- A collector pushes into an adjacent chest ----------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(8, 41, 8, Block.Collector);
  w.setBlock(9, 41, 8, Block.Chest);
  m.register(8, 41, 8);
  m.insert(8, 41, 8, Item.Coal, 4);

  run(m, w, 4);
  const chest = m.contents(9, 41, 8);
  check('a collector feeds an adjacent chest',
    chest.length === 1 && chest[0].id === Item.Coal && chest[0].count > 0,
    JSON.stringify(chest));
}

// --- A furnace smelts, but only with fuel ---------------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(8, 41, 8, Block.Furnace);
  m.register(8, 41, 8);
  m.insert(8, 41, 8, Block.IronOre, 1);

  run(m, w, 12);
  check('a furnace with no fuel smelts nothing', m.items.length === 0,
    `${m.items.length} items appeared`);

  m.insert(8, 41, 8, Item.Coal, 1);
  run(m, w, 12);
  const out = m.items.find((i) => i.id === Item.IronIngot);
  check('with fuel it smelts the ore', !!out,
    out ? 'iron ingot ejected' : `items: ${m.items.map((i) => i.id).join(',')}`);
}

// --- A miner digs downward and yields the drop ---------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  const broken: Array<[number, number, number]> = [];
  m.onSetBlock = (x, y, z, b) => {
    broken.push([x, y, z]);
    w.setBlock(x, y, z, b);
  };
  w.setBlock(8, 41, 8, Block.Miner);
  m.register(8, 41, 8);

  run(m, w, 6);
  check('a miner breaks blocks beneath it', broken.length >= 2,
    `${broken.length} blocks mined`);
  check('it digs straight down', broken.every(([x, , z]) => x === 8 && z === 8),
    JSON.stringify(broken.slice(0, 3)));
  check('mining stone yields cobblestone',
    m.items.some((i) => i.id === Block.Cobblestone),
    `dropped ids: ${[...new Set(m.items.map((i) => i.id))].join(',')}`);
}

// --- The player picks loose items up -------------------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  m.spawn(8.5, 41.2, 8.5, Item.Diamond, 2, 0);

  let received = 0;
  run(m, w, 2, 1 / 30, { x: 8.5, y: 41, z: 8.5 }, (_id, count) => {
    received += count;
    return count;
  });
  check('walking over an item picks it up', received === 2 && m.items.length === 0,
    `received ${received}, ${m.items.length} left`);
}

// --- A full inventory leaves the rest on the ground ----------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  m.spawn(8.5, 41.2, 8.5, Item.Diamond, 5, 0);

  // One slot free, then genuinely full. Returning 1 on *every* call would
  // model a working inventory, not a full one, and would legitimately
  // consume the whole stack over enough frames.
  let room = 1;
  run(m, w, 0.5, 1 / 30, { x: 8.5, y: 41, z: 8.5 }, (_id, count) => {
    const taken = Math.min(room, count);
    room -= taken;
    return taken;
  });
  check('a rejected item is not silently destroyed', m.items.length === 1,
    `${m.items.length} items left`);
  check('what was taken is deducted from the stack',
    m.items[0]?.count === 4, `count now ${m.items[0]?.count}`);
}

// --- Breaking a machine returns its contents -----------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(8, 41, 8, Block.Chest);
  m.insert(8, 41, 8, Item.GoldIngot, 7);

  const spilled = m.clearAt(8, 41, 8);
  check('a broken machine hands back what it held',
    spilled.length === 1 && spilled[0].id === Item.GoldIngot && spilled[0].count === 7,
    JSON.stringify(spilled));
  check('and forgets it afterwards', m.contents(8, 41, 8).length === 0);
}

// --- Items do not accumulate without bound -------------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  for (let i = 0; i < 600; i++) m.spawn(8.5, 41.2, 8.5, Block.Sand, 1, 99);
  check('loose items are capped', m.items.length <= 400, `${m.items.length} live`);
}


// --- A miner keeps digging past its first few blocks ---------------------
// It used to scan only six blocks down, so once it had cleared those it went
// permanently inert -- indistinguishable, in game, from being broken.
{
  const w = flatWorld();
  const m = new MachineWorld();
  let deepest = 0;
  m.onSetBlock = (x, y, z, b) => { deepest = Math.max(deepest, 41 - y); w.setBlock(x, y, z, b); };
  w.setBlock(8, 41, 8, Block.Miner);
  m.register(8, 41, 8);
  run(m, w, 40);
  check('a miner digs well past six blocks deep', deepest > 8,
    `reached ${deepest} blocks down`);
}

console.log(failures === 0 ? '\nAll machine checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
