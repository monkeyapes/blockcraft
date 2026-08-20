/**
 * The routing machines: tube, splitter, filter, incinerator.
 * Run: npx tsx tests/logistics.ts
 *
 * These decide where cargo goes, and every way they can fail is quiet. A
 * splitter that favours one side still moves items. A tube that drops its
 * cargo through the floor looks like the item despawned. A filter that lets
 * everything past looks like a filter with no filter set. So each one is
 * checked for the thing it is supposed to do *and* against a control that
 * would pass anyway if the machine did nothing.
 */

import { Block } from '../shared/src/blocks.js';
import { Dimension, WORLD_Y } from '../shared/src/constants.js';
import { Item } from '../shared/src/items.js';
import { acceptsItems } from '../shared/src/machines.js';
import { demandOf, requiresNoVolt } from '../shared/src/novolt.js';
import { RECIPES } from '../shared/src/recipes.js';
import { shapeOf, isFullCube } from '../shared/src/shapes.js';
import { MachineWorld } from '../client/src/machines.js';
import { ClientWorld } from '../client/src/world.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

const FLOOR = 40;

/** A cleared pocket of world with a stone floor at y=FLOOR. */
function stage(): ClientWorld {
  const w = new ClientWorld(1, Dimension.Overworld);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.ensureChunk(cx, cz);
  for (let x = -8; x <= 24; x++) {
    for (let z = -8; z <= 24; z++) {
      for (let y = FLOOR + 1; y < FLOOR + 12; y++) w.setBlock(x, y, z, Block.Air);
      w.setBlock(x, FLOOR, z, Block.Stone);
    }
  }
  return w;
}

const PLAYER = { x: 999, y: 999, z: 999 };   // far away: never collects
const noPickup = () => 0;

function run(m: MachineWorld, w: ClientWorld, seconds: number, dt = 1 / 30): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) m.update(dt, w, PLAYER, noPickup);
}

// --- the blocks exist and are shaped -------------------------------------

for (const [name, id] of [
  ['splitter', Block.Splitter], ['tube', Block.Tube],
  ['filter', Block.Filter], ['incinerator', Block.Incinerator],
] as const) {
  check(`${name} is a real block`, typeof id === 'number');
  const craftable = RECIPES.some((r) => r.result.id === id);
  check(`${name} can be crafted`, craftable);
}

check('a splitter is belt-shaped, not a cube', !isFullCube(Block.Splitter));
check('a filter is belt-shaped, not a cube', !isFullCube(Block.Filter));
check('a tube is a pipe, not a cube', !isFullCube(Block.Tube));
check('a tube is fatter than a cable',
  shapeOf(Block.Tube)[0].x0 < shapeOf(Block.Cable)[0].x0);

check('an incinerator draws NoVolt', demandOf(Block.Incinerator) !== null);
check('and refuses to run without it', requiresNoVolt(Block.Incinerator));
check('routing parts are free to run',
  demandOf(Block.Splitter) === null && demandOf(Block.Filter) === null &&
  demandOf(Block.Tube) === null);
check('an incinerator is somewhere items can be sent', acceptsItems(Block.Incinerator));

// --- a tube carries cargo, including upward ------------------------------

{
  const w = stage();
  const m = new MachineWorld();
  // A vertical pipe standing on the floor.
  for (let y = FLOOR + 1; y <= FLOOR + 6; y++) w.setBlock(4, y, 4, Block.Tube);

  m.spawn(4.5, FLOOR + 1.5, 4.5, Item.IronIngot, 1, 0);
  const startY = m.items[0].y;
  m.items[0].vy = 1;                     // sent upward
  run(m, w, 2);

  const item = m.items[0];
  check('a tube carries cargo upward against gravity',
    !!item && item.y > startY + 1.5, item ? `y ${startY.toFixed(2)} -> ${item.y.toFixed(2)}` : 'item gone');
  check('and holds it in the bore rather than letting it drift',
    !!item && Math.abs(item.x - 4.5) < 0.2 && Math.abs(item.z - 4.5) < 0.2,
    item ? `x=${item.x.toFixed(2)} z=${item.z.toFixed(2)}` : '');
}

// Control: the same item with no tube must fall instead of rising.
{
  const w = stage();
  const m = new MachineWorld();
  m.spawn(4.5, FLOOR + 1.5, 4.5, Item.IronIngot, 1, 0);
  const startY = m.items[0].y;
  m.items[0].vy = 1;
  run(m, w, 2);
  check('without a tube the same item falls back down (control)',
    m.items.length > 0 && m.items[0].y <= startY + 0.2,
    m.items.length ? `y ${startY.toFixed(2)} -> ${m.items[0].y.toFixed(2)}` : 'item gone');
}

// --- a splitter alternates its outputs -----------------------------------

{
  const w = stage();
  const m = new MachineWorld();
  // A splitter with a belt leaving each side, east and west.
  w.setBlock(8, FLOOR + 1, 8, Block.Splitter);
  w.setBlock(9, FLOOR + 1, 8, Block.ConveyorEast);
  w.setBlock(7, FLOOR + 1, 8, Block.ConveyorWest);
  m.register(8, FLOOR + 1, 8);

  const sent: number[] = [];
  for (let n = 0; n < 6; n++) {
    m.spawn(8.5, FLOOR + 1.6, 8.5, Item.IronIngot, 1, 0);
    run(m, w, 0.5);
    const it = m.items[m.items.length - 1];
    if (it) sent.push(Math.sign(it.vx));
    m.items.length = 0;                  // clear the stage between runs
  }
  const east = sent.filter((v) => v > 0).length;
  const west = sent.filter((v) => v < 0).length;
  check('a splitter alternates between its outputs rather than favouring one',
    east > 0 && west > 0 && Math.abs(east - west) <= 1,
    `east=${east} west=${west} of ${sent.length}`);
}

// --- a filter passes what matches and turns the rest aside ---------------

{
  const w = stage();
  const m = new MachineWorld();
  // Inline, the way one is actually built: a line running east through the
  // filter, and a spur north for whatever it rejects.
  w.setBlock(11, FLOOR + 1, 8, Block.ConveyorEast);   // the line coming in
  w.setBlock(12, FLOOR + 1, 8, Block.Filter);
  w.setBlock(13, FLOOR + 1, 8, Block.ConveyorEast);   // straight on
  // ConveyorSouth carries toward +z, so this spur leads away from the
  // filter. ConveyorNorth here would carry rejects straight back in.
  w.setBlock(12, FLOOR + 1, 9, Block.ConveyorSouth);  // the spur for rejects
  m.register(12, FLOOR + 1, 8);
  m.setFilter(12, FLOOR + 1, 8, [{ id: Item.Diamond, count: 1 }]);

  // Something that matches: it should carry straight on.
  m.spawn(12.5, FLOOR + 1.6, 8.5, Item.Diamond, 1, 0);
  m.items[0].vx = 3;
  run(m, w, 0.8);
  const passed = m.items[0];
  check('a filter lets a matching item carry straight on',
    !!passed && passed.vx > 1 && Math.abs(passed.vz) < 1,
    passed ? `vx=${passed.vx.toFixed(2)} vz=${passed.vz.toFixed(2)}` : 'gone');
  m.items.length = 0;

  // Something that does not: it should be turned aside.
  m.spawn(12.5, FLOOR + 1.6, 8.5, Item.IronIngot, 1, 0);
  m.items[0].vx = 3;
  run(m, w, 0.8);
  const turned = m.items[0];
  check('and turns anything else aside',
    !!turned && Math.abs(turned.vz) > 1,
    turned ? `vx=${turned.vx.toFixed(2)} vz=${turned.vz.toFixed(2)}` : 'gone');
}

// --- an incinerator destroys what is dropped in --------------------------

{
  const w = stage();
  const m = new MachineWorld();
  w.setBlock(16, FLOOR + 1, 8, Block.Incinerator);
  // Powered, or it is meant to do nothing at all.
  w.setBlock(16, FLOOR + 2, 8, Block.Cable);
  w.setBlock(17, FLOOR + 2, 8, Block.Generator);
  m.register(16, FLOOR + 1, 8);
  m.insert(17, FLOOR + 2, 8, Item.Coal, 8);

  m.spawn(16.5, FLOOR + 2.0, 8.5, Item.Dirt, 4, 0);
  const before = m.items.length;
  run(m, w, 1.5);
  check('a powered incinerator burns what lands in it',
    before > 0 && m.items.length === 0, `${before} -> ${m.items.length}`);
}

// Control: unpowered, it must keep its hands off the cargo.
{
  const w = stage();
  const m = new MachineWorld();
  w.setBlock(16, FLOOR + 1, 8, Block.Incinerator);
  m.register(16, FLOOR + 1, 8);
  m.spawn(16.5, FLOOR + 2.0, 8.5, Item.Dirt, 4, 0);
  run(m, w, 1.5);
  check('an unpowered incinerator destroys nothing (control)',
    m.items.length === 1, `items=${m.items.length}`);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
