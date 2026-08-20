/**
 * Advancements, and the NoVolt machines they point at.
 * Run: npx tsx tests/advancements.ts
 */

import { Block } from '../shared/src/blocks.js';
import { Dimension, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { Item } from '../shared/src/items.js';
import {
  ADVANCEMENTS, advancementById, matching,
} from '../shared/src/advancements.js';
import { demandOf, requiresNoVolt } from '../shared/src/novolt.js';
import { RECIPES, findRecipe } from '../shared/src/recipes.js';
import { MachineWorld } from '../client/src/machines.js';
import { ClientWorld } from '../client/src/world.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

function flatWorld(): ClientWorld {
  const world = new ClientWorld(17, Dimension.Overworld);
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

/** A machine wired to a fuelled generator, close enough to run well. */
function powered(block: Block): { m: MachineWorld; w: ClientWorld; at: [number, number, number] } {
  const w = flatWorld();
  const m = new MachineWorld();
  const at: [number, number, number] = [8, 41, 8];
  w.setBlock(at[0], at[1], at[2], block);
  w.setBlock(7, 41, 8, Block.Generator);
  m.register(at[0], at[1], at[2]);
  m.register(7, 41, 8);
  m.insert(7, 41, 8, Item.Coal, 8);
  return { m, w, at };
}

// --- The advancement set itself ------------------------------------------
{
  check('there is a decent trail to follow', ADVANCEMENTS.length >= 15,
    `${ADVANCEMENTS.length} advancements`);

  const ids = ADVANCEMENTS.map((a) => a.id);
  check('every id is unique', new Set(ids).size === ids.length);
  check('every one has a title and a description',
    ADVANCEMENTS.every((a) => a.title.length > 0 && a.description.length > 0));
  check('every one has an icon', ADVANCEMENTS.every((a) => a.icon > 0));
  check('lookup by id works', advancementById('novolt')?.title === 'No Volts Required');
  check('an unknown id returns nothing', advancementById('nope') === undefined);

  // Descriptions are meant to say what to do next, not congratulate you.
  check('descriptions are instructive, not just praise',
    ADVANCEMENTS.every((a) => a.description.length > 20));
}

// --- Triggers fire the right things ---------------------------------------
{
  check('mining a log is a trigger',
    matching({ kind: 'mine', id: Block.Log }).some((a) => a.id === 'wood'));
  check('crafting a bench is a trigger',
    matching({ kind: 'craft', id: Block.CraftingTable }).some((a) => a.id === 'bench'));
  check('placing a generator is a trigger',
    matching({ kind: 'place', id: Block.Generator }).some((a) => a.id === 'novolt'));
  check('picking up a diamond is a trigger',
    matching({ kind: 'pickup', id: Item.Diamond }).some((a) => a.id === 'diamond'));
  check('riding a boat is a trigger',
    matching({ kind: 'ride', kind2: 'boat' }).some((a) => a.id === 'boat'));
  check('beating the dragon is a trigger',
    matching({ kind: 'event', name: 'dragon' }).some((a) => a.id === 'dragon'));

  check('an unrelated trigger matches nothing',
    matching({ kind: 'mine', id: Block.Bedrock }).length === 0);
  // Kinds must not bleed into each other: crafting a log is not mining one.
  check('trigger kinds do not cross over',
    matching({ kind: 'craft', id: Block.Log }).length === 0);
  check('ride and event names are matched, not just kinds',
    matching({ kind: 'ride', kind2: 'submarine' }).length === 0 &&
    matching({ kind: 'event', name: 'nothing' }).length === 0);
}

// --- Every advancement is actually reachable -----------------------------
// One that points at a block nobody can obtain is worse than none at all.
{
  // A craft trigger has to correspond to a recipe that actually exists, or
  // the advancement can never be earned. Checked against the recipe list
  // itself rather than by trying to build each grid.
  const craftable = new Set(RECIPES.map((r) => r.result.id));
  const unreachable = ADVANCEMENTS.filter(
    (a) => a.trigger.kind === 'craft' && !craftable.has(a.trigger.id));
  check('every craft advancement names a real recipe', unreachable.length === 0,
    unreachable.map((a) => a.id).join(', ') || 'all reachable');

  const placeable = ADVANCEMENTS.filter((a) => a.trigger.kind === 'place');
  check('the placement trail covers the automation chain', placeable.length >= 5,
    `${placeable.length} placement advancements`);
}

// --- The NoVolt machines --------------------------------------------------
{
  for (const b of [
    Block.StoneGenerator, Block.ElectricFurnace, Block.Sawmill,
    Block.Compressor, Block.Quarry,
  ]) {
    check(`${Block[b]}: demands NoVolt`, requiresNoVolt(b));
    check(`${Block[b]}: has a draw and a minimum`, !!demandOf(b));
  }
  check('the quarry is the hungriest of them',
    demandOf(Block.Quarry)!.minimum > demandOf(Block.StoneGenerator)!.minimum);
}

// --- Stone generator ------------------------------------------------------
{
  const t = powered(Block.StoneGenerator);
  run(t.m, t.w, 10);
  const cobble = t.m.items.filter((i) => i.id === Block.Cobblestone);
  check('a powered stone generator makes cobblestone', cobble.length > 0,
    `${cobble.length} drops`);

  // And nothing at all without power.
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(8, 41, 8, Block.StoneGenerator);
  m.register(8, 41, 8);
  run(m, w, 10);
  check('an unpowered one makes nothing', m.items.length === 0,
    `${m.items.length} drops`);
}

// --- Electric furnace: smelts with no fuel of its own --------------------
{
  const t = powered(Block.ElectricFurnace);
  t.m.insert(8, 41, 8, Block.IronOre, 1);
  run(t.m, t.w, 8);
  check('an electric furnace smelts without fuel in it',
    t.m.items.some((i) => i.id === Item.IronIngot),
    `out: ${[...new Set(t.m.items.map((i) => i.id))].join(',')}`);
}

// --- Sawmill: more planks than by hand ------------------------------------
{
  const byHand = findRecipe({
    width: 3, height: 3,
    cells: [Block.Log, null, null, null, null, null, null, null, null],
  })!.result.count;

  const t = powered(Block.Sawmill);
  t.m.insert(8, 41, 8, Block.Log, 1);
  run(t.m, t.w, 6);
  const planks = t.m.items.find((i) => i.id === Block.Planks);
  check('a sawmill beats crafting planks by hand',
    !!planks && planks.count > byHand,
    `${planks?.count} from a sawmill vs ${byHand} by hand`);
}

// --- Compressor: nine into one, using the ordinary recipes ---------------
{
  const t = powered(Block.Compressor);
  t.m.insert(8, 41, 8, Item.IronIngot, 9);
  run(t.m, t.w, 8);
  check('a compressor packs nine ingots into a block',
    t.m.items.some((i) => i.id === Block.IronBlock),
    `out: ${[...new Set(t.m.items.map((i) => i.id))].join(',')}`);

  // Fewer than nine is not enough.
  const u = powered(Block.Compressor);
  u.m.insert(8, 41, 8, Item.IronIngot, 8);
  run(u.m, u.w, 8);
  check('eight is not enough', !u.m.items.some((i) => i.id === Block.IronBlock));
}

// --- Quarry: clears a square, not a single column ------------------------
{
  const t = powered(Block.Quarry);
  const columns = new Set<string>();
  t.m.onSetBlock = (x, y, z, b) => { columns.add(`${x},${z}`); t.w.setBlock(x, y, z, b); };
  run(t.m, t.w, 25);
  check('a quarry works more than one column', columns.size > 1,
    `${columns.size} columns touched`);
  check('and stays inside its own footprint',
    [...columns].every((c) => {
      const [x, z] = c.split(',').map(Number);
      return Math.abs(x - 8) <= 1 && Math.abs(z - 8) <= 1;
    }), [...columns].join(' '));
}

// --- Water wheel: a source, but only in water ----------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(4, 41, 8, Block.WaterWheel);
  w.setBlock(5, 41, 8, Block.Cable);
  w.setBlock(6, 41, 8, Block.Miner);
  m.register(4, 41, 8);
  m.register(6, 41, 8);
  run(m, w, 1);
  check('a dry water wheel produces nothing', !m.isPowered(6, 41, 8));

  w.setBlock(4, 42, 8, Block.Water);
  run(m, w, 1);
  check('put it in water and it turns', m.isPowered(6, 41, 8),
    `${m.pressureAtBlock(6, 41, 8).toFixed(0)} nV`);
}

// --- All craftable --------------------------------------------------------
{
  const I = Item.IronIngot;
  const C = Block.Cobblestone;
  const P = Block.Planks;
  check('the stone generator is craftable',
    findRecipe({ width: 3, height: 3, cells: [I, C, I, C, Block.Furnace, C, I, C, I] })
      ?.result.id === Block.StoneGenerator);
  check('the water wheel is craftable',
    findRecipe({ width: 3, height: 3, cells: [P, P, P, P, I, P, P, P, P] })
      ?.result.id === Block.WaterWheel);
  check('the quarry is craftable',
    findRecipe({ width: 3, height: 3, cells: [I, Item.Diamond, I, I, Block.Miner, I, I, I, I] })
      ?.result.id === Block.Quarry);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
