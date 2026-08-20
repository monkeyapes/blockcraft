/**
 * Sorters, container storage, and the new vehicles.
 * Run: npx tsx tests/machines2.ts
 */

import { Block } from '../shared/src/blocks.js';
import { Dimension, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { Item, vehicleKind, vehicleItem } from '../shared/src/items.js';
import { sorterAccepts, acceptsItems } from '../shared/src/machines.js';
import { findRecipe } from '../shared/src/recipes.js';
import { MachineWorld } from '../client/src/machines.js';
import { SPECS, CHASE_DISTANCE } from '../client/src/vehicles.js';
import { ClientWorld } from '../client/src/world.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

function flatWorld(fill: (y: number) => number = (y) => (y <= 40 ? Block.Stone : Block.Air)) {
  const world = new ClientWorld(9, Dimension.Overworld);
  const chunk = world.ensureChunk(0, 0);
  for (let y = 0; y < WORLD_Y; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) chunk.data[voxelIndex(x, y, z)] = fill(y);
  chunk.rebuildHeightmap();
  return world;
}
const NOWHERE = { x: -999, y: -999, z: -999 };
const run = (m: MachineWorld, w: ClientWorld, s: number, dt = 1/30) => {
  for (let i = 0; i < Math.round(s/dt); i++) m.update(dt, w, NOWHERE, () => 0);
};

// --- Sorter filter semantics ---------------------------------------------
{
  check('an empty filter matches nothing', !sorterAccepts([], Item.Coal));
  check('a filter matches its own id', sorterAccepts([{ id: Item.Coal }], Item.Coal));
  check('and rejects anything else', !sorterAccepts([{ id: Item.Coal }], Item.Diamond));
  check('a sorter can be pushed into', acceptsItems(Block.Sorter));
}

// --- A sorter lifts matching items off a belt and lets the rest pass ------
{
  const w = flatWorld();
  const m = new MachineWorld();
  for (let x = 2; x <= 13; x++) w.setBlock(x, 40, 8, Block.ConveyorEast);
  w.setBlock(7, 40, 8, Block.Sorter);
  m.register(7, 40, 8);
  m.setFilter(7, 40, 8, [{ id: Item.Diamond, count: 1 }]);

  m.spawn(3.5, 41.2, 8.5, Item.Diamond, 1, 0);
  m.spawn(3.5, 41.2, 8.5, Item.Coal, 1, 0);
  run(m, w, 4);

  check('a sorter takes the item it filters for',
    m.contents(7, 40, 8).some((s) => s.id === Item.Diamond),
    JSON.stringify(m.contents(7, 40, 8)));
  check('and leaves everything else on the belt',
    m.items.some((i) => i.id === Item.Coal) ||
    m.contents(7, 40, 8).every((s) => s.id !== Item.Coal),
    `loose: ${m.items.map((i) => i.id).join(',')}`);
}

// --- An unconfigured sorter is inert, not a black hole -------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  for (let x = 2; x <= 13; x++) w.setBlock(x, 40, 8, Block.ConveyorEast);
  w.setBlock(7, 40, 8, Block.Sorter);
  m.register(7, 40, 8);
  m.spawn(3.5, 41.2, 8.5, Item.Coal, 1, 0);
  run(m, w, 3);
  check('a sorter with no filter swallows nothing',
    m.contents(7, 40, 8).length === 0,
    JSON.stringify(m.contents(7, 40, 8)));
}

// --- A sorter feeds an adjacent chest -------------------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(7, 40, 8, Block.Sorter);
  w.setBlock(8, 40, 8, Block.Chest);
  m.register(7, 40, 8);
  m.setFilter(7, 40, 8, [{ id: Item.Coal, count: 1 }]);
  m.insert(7, 40, 8, Item.Coal, 3);
  run(m, w, 4);
  check('a sorter passes its haul to a chest',
    m.contents(8, 40, 8).some((s) => s.id === Item.Coal),
    JSON.stringify(m.contents(8, 40, 8)));
}

// --- Breaking a sorter returns the filter items --------------------------
{
  const m = new MachineWorld();
  m.setFilter(4, 41, 4, [{ id: Item.Diamond, count: 2 }]);
  m.insert(4, 41, 4, Item.Coal, 5);
  const back = m.clearAt(4, 41, 4);
  check('a broken sorter returns both cargo and filter',
    back.some((s) => s.id === Item.Diamond) && back.some((s) => s.id === Item.Coal),
    JSON.stringify(back));
}

// --- Container round-trip -------------------------------------------------
{
  const m = new MachineWorld();
  m.insert(1, 1, 1, Item.Coal, 4);
  m.insert(1, 1, 1, Item.Diamond, 2);
  check('capacity differs by machine',
    MachineWorld.capacity(Block.Chest) === 27 &&
    MachineWorld.capacity(Block.Furnace) === 9);

  // The screen writes back fixed slots with gaps; the machine must compact.
  m.setContents(1, 1, 1, [null, { id: Item.Coal, count: 4 }, null, { id: Item.Diamond, count: 0 }]);
  const after = m.contents(1, 1, 1);
  check('holes and empty stacks are dropped on write-back',
    after.length === 1 && after[0].id === Item.Coal && after[0].count === 4,
    JSON.stringify(after));
}

// --- New vehicles ---------------------------------------------------------
{
  for (const kind of ['boat', 'truck'] as const) {
    check(`${kind}: has a spec`, !!SPECS[kind]);
    check(`${kind}: has a chase distance`, CHASE_DISTANCE[kind] > 0);
    const item = vehicleItem(kind);
    check(`${kind}: item maps back to its kind`, vehicleKind(item) === kind);
  }
  check('only the boat is buoyant',
    SPECS.boat.buoyant === true && !SPECS.truck.buoyant && !SPECS.car.buoyant);
  check('the truck is heavier and slower than the car',
    SPECS.truck.maxSpeed < SPECS.car.maxSpeed &&
    SPECS.truck.turnRate < SPECS.car.turnRate &&
    SPECS.truck.gravity > SPECS.car.gravity);
  check('both new vehicles are craftable',
    !!findRecipe({ width: 3, height: 3, cells: [
      Block.Planks, null, Block.Planks,
      Block.Planks, Block.Planks, Block.Planks,
      null, null, null] }),
    'boat pattern');
}

// --- A boat floats rather than sinking ------------------------------------
{
  // Sea: stone to y=30, water to y=40, air above.
  const w = flatWorld((y) => (y <= 30 ? Block.Stone : y <= 40 ? Block.Water : Block.Air));
  const { VehicleWorld } = await import('../client/src/vehicles.js');
  const vw = new VehicleWorld();
  const boat = vw.spawn('boat', 8.5, 44, 8.5, 0);
  const idle = { forward: false, back: false, left: false, right: false,
                 jump: false, sneak: false, sprint: false };
  for (let i = 0; i < 240; i++) vw.update(1/30, w, null, idle);
  check('a boat dropped on water settles at the surface',
    boat.y > 39 && boat.y < 42.5, `settled at y=${boat.y.toFixed(2)}`);

  const car = vw.spawn('car', 4.5, 44, 4.5, 0);
  for (let i = 0; i < 240; i++) vw.update(1/30, w, null, idle);
  check('a car is not buoyant and sinks past the surface',
    car.y < 39, `car at y=${car.y.toFixed(2)}`);
}


// --- Ladders let you climb, and are not solid --------------------------
{
  const { isSolid, isOpaque } = await import('../shared/src/blocks.js');
  const { Player } = await import('../client/src/player.js');
  check('a ladder is not solid', !isSolid(Block.Ladder));
  check('a ladder does not hide the wall behind it', !isOpaque(Block.Ladder));
  check('a bed is not solid either', !isSolid(Block.Bed));

  // A shaft of ladders: holding jump must gain height, and letting go must
  // hold position rather than dropping you.
  const w = flatWorld();
  for (let y = 41; y <= 55; y++) w.setBlock(8, y, 8, Block.Ladder);
  const p = new Player();
  p.x = 8.5; p.y = 41; p.z = 8.5;
  const keys = (o: Record<string, boolean> = {}) => ({
    forward: false, back: false, left: false, right: false,
    jump: false, sneak: false, sprint: false, ...o,
  }) as never;

  for (let i = 0; i < 120; i++) p.update(1 / 60, w, keys({ jump: true }));
  const climbed = p.y;
  check('holding jump on a ladder climbs', climbed > 44, `reached y=${climbed.toFixed(1)}`);

  for (let i = 0; i < 60; i++) p.update(1 / 60, w, keys());
  check('letting go on a ladder holds position rather than falling',
    Math.abs(p.y - climbed) < 0.6, `y went ${climbed.toFixed(1)} -> ${p.y.toFixed(1)}`);

  for (let i = 0; i < 60; i++) p.update(1 / 60, w, keys({ sneak: true }));
  check('sneak climbs back down', p.y < climbed - 1, `y=${p.y.toFixed(1)}`);
}

// --- Ladder and bed are craftable ---------------------------------------
{
  const S = Item.Stick;
  check('ladders are craftable from sticks',
    findRecipe({ width: 3, height: 3, cells: [S, null, S, S, S, S, S, null, S] })
      ?.result.id === Block.Ladder);
  check('a bed is craftable from leather and planks',
    findRecipe({ width: 3, height: 3, cells: [
      Item.Leather, Item.Leather, Item.Leather,
      Block.Planks, Block.Planks, Block.Planks,
      null, null, null] })?.result.id === Block.Bed);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
