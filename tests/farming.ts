/**
 * The farming pack: tilling, planting, growing, hydration, trampling, drops,
 * bone meal, recipes and the block families that make it all legal online.
 * Run: npx tsx tests/farming.ts
 *
 * The client hooks are driven through the same dispatchers main.ts calls,
 * against a small fake world, so a hook that is written but never
 * registered fails here as surely as one that does the wrong thing.
 */

import { BLOCKS, Block, blockDef, canReplace, isOpaque, isSolid } from '../shared/src/blocks.js';
import { Item, blockDrops, itemDef, smeltResult } from '../shared/src/items.js';
import { findRecipe, type Grid } from '../shared/src/recipes.js';
import { collisionOf, selectionOf, shapeOf } from '../shared/src/shapes.js';
import { CROPS, cropAt } from '../shared/src/content/farming.js';
import {
  dispatchBreak, dispatchPlacement, dispatchUse, flushNeighbourChanges, noteBlockChanged,
  randomTickAround, updateSystems, type GameContext, type PlaceContext, type UseContext,
} from '../client/src/content/api.js';
import {
  DRY_GROWTH, WET_GROWTH, cropTick, farmlandTick,
} from '../client/src/content/farming.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

/** Seeded, so the statistical checks give the same answer every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- a fake game ------------------------------------------------------------------

interface Fake extends GameContext {
  blocks: Map<string, number>;
  drops: Array<{ id: number; count: number }>;
  held: number | null;
  heldCount: number;
  particles: number;
  sky: number;
  put(x: number, y: number, z: number, id: number): void;
}

/** The parts of the player the trample watch reads. */
interface FakePlayer {
  x: number; y: number; z: number; vy: number;
  onGround: boolean; flying: boolean; isSneaking?: boolean;
}

function fakeGame(seed = 1): Fake {
  const blocks = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const get = (x: number, y: number, z: number) => blocks.get(key(x, y, z)) ?? Block.Air;
  const g = {
    blocks,
    drops: [] as Array<{ id: number; count: number }>,
    held: null as number | null,
    heldCount: 0,
    particles: 0,
    sky: 15,
    creative: false,
    time: 0,
    dimension: 'overworld',
    mobs: {},
    player: { x: 0.5, y: 65, z: 0.5, vy: 0, onGround: true, flying: false },
    sound: { blockPlace() {}, blockBreak() {} },
    world: {
      getBlock: get,
      getSkyLight: () => g.sky,
      getBlockLight: () => 0,
      // One loaded chunk at the origin, for the random-tick sampler.
      chunk: (cx: number, cz: number) => (cx === 0 && cz === 0 ? {} : undefined),
    },
    put(x: number, y: number, z: number, id: number) {
      if (id === Block.Air) blocks.delete(key(x, y, z));
      else blocks.set(key(x, y, z), id);
    },
    getBlock: get,
    setBlock(x: number, y: number, z: number, id: number): boolean {
      if (!canReplace(get(x, y, z), id)) return false;
      g.put(x, y, z, id);
      noteBlockChanged(x, y, z);
      return true;
    },
    breakBlock(x: number, y: number, z: number) {
      const id = get(x, y, z);
      if (id === Block.Air) return;
      g.drops.push(...blockDrops(id, g.random, null));
      g.put(x, y, z, Block.Air);
      noteBlockChanged(x, y, z);
      dispatchBreak(g as unknown as GameContext, x, y, z, id, null);
    },
    heldItem: () => g.held,
    consumeHeld(count = 1) {
      if (g.heldCount < count) return false;
      g.heldCount -= count;
      return true;
    },
    replaceHeld() {},
    give(id: number, count: number) { g.drops.push({ id, count }); },
    dropItem(_x: number, _y: number, _z: number, id: number, count: number) { g.drops.push({ id, count }); },
    damagePlayer() {},
    healPlayer() {},
    pushPlayer() {},
    hurtMob() {},
    toast() {},
    chat() {},
    breakParticles() { g.particles++; },
    swing() {},
    random: mulberry32(seed),
  };
  return g as unknown as Fake;
}

function use(g: Fake, x: number, y: number, z: number, face: [number, number, number]): boolean {
  const ctx = Object.assign(Object.create(g) as GameContext, {
    x, y, z, id: g.getBlock(x, y, z), face, point: [x + 0.5, y + 1, z + 0.5],
    held: g.held, sneaking: false,
  }) as UseContext;
  return dispatchUse(ctx);
}

function placeWith(g: Fake, item: number, px: number, py: number, pz: number): number | null | undefined {
  const ctx = Object.assign(Object.create(g) as GameContext, {
    x: px, y: py - 1, z: pz, id: g.getBlock(px, py - 1, pz), face: [0, 1, 0], point: [0, 0, 0],
    held: item, sneaking: false, px, py, pz, allowReplace: false,
  }) as PlaceContext;
  return dispatchPlacement(ctx, item);
}

const UP: [number, number, number] = [0, 1, 0];
const SIDE: [number, number, number] = [1, 0, 0];
const Y = 64;

// --- tilling ------------------------------------------------------------------------

{
  const g = fakeGame();
  g.held = Item.WoodHoe;
  g.put(0, Y, 0, Block.Dirt);
  check('a hoe tills the top of dirt', use(g, 0, Y, 0, UP) && g.getBlock(0, Y, 0) === Block.Farmland,
    blockDef(g.getBlock(0, Y, 0)).name);

  g.put(2, Y, 0, Block.Grass);
  g.held = Item.DiamondHoe;
  check('and of grass, with any hoe', use(g, 2, Y, 0, UP) && g.getBlock(2, Y, 0) === Block.Farmland);

  g.put(4, Y, 0, Block.Dirt);
  check('but not from the side', !use(g, 4, Y, 0, SIDE) && g.getBlock(4, Y, 0) === Block.Dirt);

  g.put(6, Y, 0, Block.Dirt);
  g.put(6, Y + 1, 0, Block.TallGrass);
  check('nor with anything above it, even grass', !use(g, 6, Y, 0, UP) && g.getBlock(6, Y, 0) === Block.Dirt);

  g.put(8, Y, 0, Block.Stone);
  check('a hoe does nothing to stone', !use(g, 8, Y, 0, UP) && g.getBlock(8, Y, 0) === Block.Stone);

  const w = fakeGame();
  w.held = Item.StoneHoe;
  w.put(0, Y, 0, Block.Dirt);
  w.put(3, Y, 0, Block.Water);
  check('soil tilled beside water comes up wet', use(w, 0, Y, 0, UP) && w.getBlock(0, Y, 0) === Block.FarmlandWet);
}

// --- planting ------------------------------------------------------------------------

{
  const g = fakeGame();
  g.put(0, Y, 0, Block.Farmland);
  g.held = Item.WheatSeeds;
  g.heldCount = 5;
  check('seeds plant into the top of farmland',
    use(g, 0, Y, 0, UP) && g.getBlock(0, Y + 1, 0) === Block.Wheat0, blockDef(g.getBlock(0, Y + 1, 0)).name);
  check('and planting uses one seed', g.heldCount === 4, `${g.heldCount}`);

  g.put(2, Y, 0, Block.Dirt);
  check('seeds do not plant into dirt', !use(g, 2, Y, 0, UP) && g.getBlock(2, Y + 1, 0) === Block.Air);
  check('the placement hook refuses anywhere but farmland',
    placeWith(g, Item.WheatSeeds, 2, Y + 1, 0) === null);
  g.put(4, Y, 0, Block.FarmlandWet);
  check('and accepts wet farmland', placeWith(g, Item.WheatSeeds, 4, Y + 1, 0) === Block.Wheat0);

  for (const crop of CROPS) {
    const f = fakeGame();
    f.put(0, Y, 0, Block.Farmland);
    f.held = crop.seed;
    f.heldCount = 1;
    check(`${itemDef(crop.seed).name} plants ${crop.name} stage 0`,
      use(f, 0, Y, 0, UP) && f.getBlock(0, Y + 1, 0) === crop.stages[0]);
    check(`${itemDef(crop.seed).name} places ${crop.name} by item spec too`,
      itemDef(crop.seed).places === crop.stages[0]);
  }
  check('carrots and potatoes are also food',
    (itemDef(Item.Carrot).food ?? 0) > 0 && (itemDef(Item.Potato).food ?? 0) > 0);
}

// --- growing -------------------------------------------------------------------------

for (const crop of CROPS) {
  const g = fakeGame(7);
  g.put(0, Y, 0, Block.FarmlandWet);
  g.put(0, Y + 1, 0, crop.stages[0]);
  const seen = [crop.stages[0]];
  for (let i = 0; i < 400; i++) {
    cropTick(g, 0, Y + 1, 0, g.getBlock(0, Y + 1, 0));
    const now = g.getBlock(0, Y + 1, 0);
    if (now !== seen[seen.length - 1]) seen.push(now);
  }
  check(`${crop.name} grows through every stage in order`,
    JSON.stringify(seen) === JSON.stringify(crop.stages), seen.join(','));
  check(`${crop.name} stops at ripe`, g.getBlock(0, Y + 1, 0) === crop.stages[crop.stages.length - 1]);
}

{
  // Hydration: the same number of visits on wet and dry soil.
  const trials = 6000;
  const grown = (soil: number, sky: number) => {
    const g = fakeGame(99);
    g.sky = sky;
    g.put(0, Y, 0, soil);
    let n = 0;
    for (let i = 0; i < trials; i++) {
      g.put(0, Y + 1, 0, Block.Wheat0);
      cropTick(g, 0, Y + 1, 0, Block.Wheat0);
      if (g.getBlock(0, Y + 1, 0) === Block.Wheat1) n++;
    }
    return n / trials;
  };
  const wet = grown(Block.FarmlandWet, 15);
  const dry = grown(Block.Farmland, 15);
  check('wet soil grows crops at its stated rate', Math.abs(wet - WET_GROWTH) < 0.03, wet.toFixed(3));
  check('dry soil grows them at its own, slower rate', Math.abs(dry - DRY_GROWTH) < 0.03, dry.toFixed(3));
  check('hydration at least doubles the growth rate', wet > dry * 2, `${wet.toFixed(3)} vs ${dry.toFixed(3)}`);
  check('crops do not grow in the dark', grown(Block.FarmlandWet, 4) === 0);
}

{
  // The random-tick sampler really reaches a crop: the hook is registered.
  const g = fakeGame(3);
  g.put(5, Y, 5, Block.FarmlandWet);
  g.put(5, Y + 1, 5, Block.Wheat0);
  g.put(5, Y, 8, Block.Water);
  let ticks = 0;
  while (g.getBlock(5, Y + 1, 5) === Block.Wheat0 && ticks < 200000) {
    randomTickAround(g, 8, 8);
    ticks++;
  }
  check('random ticks grow a planted crop', g.getBlock(5, Y + 1, 5) === Block.Wheat1, `${ticks} ticks`);
}

// --- farmland over time ----------------------------------------------------------------

{
  const g = fakeGame(5);
  g.put(0, Y, 0, Block.Farmland);
  g.put(4, Y + 1, 0, Block.Water); // four across and one up: in reach
  farmlandTick(g, 0, Y, 0, Block.Farmland);
  check('dry farmland in reach of water turns wet', g.getBlock(0, Y, 0) === Block.FarmlandWet);

  g.put(4, Y + 1, 0, Block.Air);
  g.put(5, Y, 0, Block.Water); // five across: out of reach
  farmlandTick(g, 0, Y, 0, Block.FarmlandWet);
  check('wet farmland out of reach dries out first', g.getBlock(0, Y, 0) === Block.Farmland);

  for (let i = 0; i < 100 && g.getBlock(0, Y, 0) === Block.Farmland; i++) {
    farmlandTick(g, 0, Y, 0, g.getBlock(0, Y, 0));
  }
  check('bare dry farmland reverts to dirt', g.getBlock(0, Y, 0) === Block.Dirt);

  g.put(20, Y, 0, Block.Farmland);
  g.put(20, Y + 1, 0, Block.Carrots1);
  for (let i = 0; i < 200; i++) farmlandTick(g, 20, Y, 0, g.getBlock(20, Y, 0));
  check('dry farmland with a crop on it never reverts', g.getBlock(20, Y, 0) === Block.Farmland);

  g.put(6, Y, 6, Block.Farmland);
  g.put(6, Y + 1, 6, Block.Stone);
  noteBlockChanged(6, Y + 1, 6);
  flushNeighbourChanges(g);
  check('building on farmland packs it back to dirt', g.getBlock(6, Y, 6) === Block.Dirt);
}

// --- trampling ---------------------------------------------------------------------

/** One landing on the farmland under the player, and whether it survived. */
function landing(vy: number, opts: { sneaking?: boolean; flying?: boolean } = {}): { soil: number; crop: number; drops: number } {
  const g = fakeGame(11);
  g.put(0, Y, 0, Block.Farmland);
  g.put(0, Y + 1, 0, Block.Wheat2);
  const p = g.player as unknown as FakePlayer;
  p.x = 0.5; p.z = 0.5; p.y = Y + 15 / 16;
  p.isSneaking = opts.sneaking ?? false;
  p.flying = opts.flying ?? false;
  // A frame in the air, falling, then the frame the physics lands it.
  p.onGround = true; p.vy = 0;
  updateSystems(g, 1 / 60);
  p.onGround = false; p.vy = vy;
  updateSystems(g, 1 / 60);
  p.onGround = true; p.vy = 0;
  updateSystems(g, 1 / 60);
  flushNeighbourChanges(g);
  return { soil: g.getBlock(0, Y, 0), crop: g.getBlock(0, Y + 1, 0), drops: g.drops.length };
}

{
  const jump = landing(-8.8);
  check('landing from a jump tramples farmland to dirt', jump.soil === Block.Dirt, blockDef(jump.soil).name);
  check('and pops the crop off it', jump.crop === Block.Air && jump.drops > 0, `${jump.drops} drops`);
  check('stepping down gently does not', landing(-1.8).soil === Block.Farmland);
  check('sneaking onto it does not', landing(-8.8, { sneaking: true }).soil === Block.Farmland);
  check('flying onto it does not', landing(-8.8, { flying: true }).soil === Block.Farmland);
}

{
  // Digging the soil out from under a crop pops it too.
  const g = fakeGame();
  g.put(0, Y, 0, Block.FarmlandWet);
  g.put(0, Y + 1, 0, Block.Potatoes1);
  g.setBlock(0, Y, 0, Block.Air);
  flushNeighbourChanges(g);
  check('a crop with its farmland dug out breaks',
    g.getBlock(0, Y + 1, 0) === Block.Air && g.drops.some((d) => d.id === Item.Potato));
}

// --- drops ------------------------------------------------------------------------------

{
  const rnd = mulberry32(21);
  const counts = (block: number, item: number) => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      seen.add(blockDrops(block, rnd, null).filter((d) => d.id === item).reduce((a, d) => a + d.count, 0));
    }
    return [...seen].sort((a, b) => a - b);
  };
  for (const crop of CROPS) {
    for (let s = 0; s < crop.stages.length - 1; s++) {
      const d = blockDrops(crop.stages[s], rnd, null);
      check(`unripe ${crop.name} (stage ${s}) gives back one ${itemDef(crop.seed).name}`,
        d.length === 1 && d[0].id === crop.seed && d[0].count === 1, JSON.stringify(d));
    }
  }
  check('ripe wheat always gives one wheat', counts(Block.Wheat3, Item.Wheat).join() === '1');
  check('ripe wheat gives 1-3 seeds', counts(Block.Wheat3, Item.WheatSeeds).join() === '1,2,3',
    counts(Block.Wheat3, Item.WheatSeeds).join());
  check('ripe carrots give 1-4 carrots', counts(Block.Carrots3, Item.Carrot).join() === '1,2,3,4',
    counts(Block.Carrots3, Item.Carrot).join());
  check('ripe potatoes give 1-4 potatoes', counts(Block.Potatoes3, Item.Potato).join() === '1,2,3,4',
    counts(Block.Potatoes3, Item.Potato).join());
  check('farmland drops dirt', JSON.stringify(blockDrops(Block.Farmland, rnd, null)) ===
    JSON.stringify([{ id: Block.Dirt, count: 1 }]) &&
    blockDrops(Block.FarmlandWet, rnd, null)[0]?.id === Block.Dirt);
}

// --- bone meal ------------------------------------------------------------------------

{
  const steps = new Set<number>();
  let consumed = true;
  let particles = true;
  for (let i = 0; i < 60; i++) {
    const g = fakeGame(100 + i);
    g.put(0, Y, 0, Block.Farmland);
    g.put(0, Y + 1, 0, Block.Carrots0);
    g.held = Item.BoneMeal;
    g.heldCount = 3;
    use(g, 0, Y + 1, 0, UP);
    steps.add(cropAt(g.getBlock(0, Y + 1, 0))?.stage ?? -1);
    consumed &&= g.heldCount === 2;
    particles &&= g.particles > 0;
  }
  check('bone meal advances a crop one or two stages', [...steps].sort().join() === '1,2',
    [...steps].join());
  check('and is used up doing it', consumed);
  check('with a burst of particles', particles);

  const g = fakeGame();
  g.put(0, Y, 0, Block.Farmland);
  g.put(0, Y + 1, 0, Block.Wheat2);
  g.held = Item.BoneMeal;
  g.heldCount = 1;
  use(g, 0, Y + 1, 0, UP);
  check('bone meal never pushes past ripe', g.getBlock(0, Y + 1, 0) === Block.Wheat3);
  const ripeHandled = use(g, 0, Y + 1, 0, UP);
  check('on a ripe crop it does nothing and is kept', ripeHandled && g.heldCount === 0 &&
    g.getBlock(0, Y + 1, 0) === Block.Wheat3);
  g.heldCount = 1;
  g.put(3, Y, 0, Block.Dirt);
  check('on anything but a crop it is left to other hooks', !use(g, 3, Y, 0, UP) && g.heldCount === 1);
}

// --- tall grass seeds ------------------------------------------------------------------------

{
  const g = fakeGame(8);
  let seeds = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    g.drops.length = 0;
    dispatchBreak(g, 0, Y, 0, Block.TallGrass, null);
    if (g.drops.some((d) => d.id === Item.WheatSeeds)) seeds++;
  }
  check('tall grass turns up a seed about one time in eight', Math.abs(seeds / n - 1 / 8) < 0.02,
    (seeds / n).toFixed(3));
}

// --- recipes and smelting ------------------------------------------------------------------

function grid(rows: Array<Array<number | null>>): Grid {
  return { width: 3, height: 3, cells: [0, 1, 2].flatMap((y) => [0, 1, 2].map((x) => rows[y]?.[x] ?? null)) };
}

{
  const W = Item.Wheat;
  const _ = null;
  check('three wheat in a row bake bread', findRecipe(grid([[_, _, _], [W, W, W]]))?.result.id === Item.Bread);
  const bale = findRecipe(grid([[W, W, W], [W, W, W], [W, W, W]]));
  check('nine wheat bind a hay bale', bale?.result.id === Block.HayBale && bale.result.count === 1);
  const back = findRecipe(grid([[Block.HayBale]]));
  check('and a bale breaks back into nine wheat', back?.result.id === Item.Wheat && back.result.count === 9);
  const meal = findRecipe(grid([[_, Item.Bone]]));
  check('a bone grinds into three bone meal', meal?.result.id === Item.BoneMeal && meal.result.count === 3);
  check('pumpkin, sugar and wheat make a pie, in any order',
    findRecipe(grid([[Item.Sugar, _, W], [_, Block.Pumpkin]]))?.result.id === Item.PumpkinPie);
  const S = Item.Stick;
  const hoes: Array<[number, number]> = [
    [Block.Planks, Item.WoodHoe], [Block.Cobblestone, Item.StoneHoe],
    [Item.IronIngot, Item.IronHoe], [Item.Diamond, Item.DiamondHoe],
  ];
  for (const [m, hoe] of hoes) {
    check(`${itemDef(hoe).name} is crafted from its material and sticks`,
      findRecipe(grid([[m, m], [_, S], [_, S]]))?.result.id === hoe);
    check(`${itemDef(hoe).name} is a hoe`, itemDef(hoe).tool?.kind === 'hoe');
  }
  check('a potato bakes in the furnace', smeltResult(Item.Potato)?.id === Item.BakedPotato);
}

// --- families, transitions, shapes ----------------------------------------------------------

for (const crop of CROPS) {
  const ok = crop.stages.every((a) => crop.stages.every((b) => a === b || canReplace(a, b)));
  check(`every ${crop.name} stage converts to every other`, ok);
  check(`${crop.name} cannot turn into another crop`,
    CROPS.filter((c) => c !== crop).every((c) => !canReplace(crop.stages[0], c.stages[0])));
}
check('farmland goes wet and dry in place',
  canReplace(Block.Farmland, Block.FarmlandWet) && canReplace(Block.FarmlandWet, Block.Farmland));
check('dirt and grass till in place',
  canReplace(Block.Dirt, Block.Farmland) && canReplace(Block.Grass, Block.Farmland) &&
  canReplace(Block.Dirt, Block.FarmlandWet));
check('farmland reverts to dirt in place',
  canReplace(Block.Farmland, Block.Dirt) && canReplace(Block.FarmlandWet, Block.Dirt));
check('but stone cannot be tilled', !canReplace(Block.Stone, Block.Farmland));

check('farmland is a slab a sixteenth short of a block',
  shapeOf(Block.Farmland).length === 1 && shapeOf(Block.Farmland)[0].y1 === 15 / 16 &&
  collisionOf(Block.FarmlandWet)[0].y1 === 15 / 16);
check('farmland does not hide its neighbours\' faces', !isOpaque(Block.Farmland) && !isOpaque(Block.FarmlandWet));
for (const crop of CROPS) {
  const heights = crop.stages.map((id) => selectionOf(id)[0].y1);
  check(`${crop.name} can be walked through`, crop.stages.every((id) => !isSolid(id) && !isOpaque(id)));
  check(`${crop.name} stands taller at each stage`, heights.every((h, i) => i === 0 || h > heights[i - 1]),
    heights.map((h) => (h * 16).toFixed(0)).join(','));
}
check('every farming block has a name', BLOCKS.filter((d) => d && (cropAt(d.id) || d.id === Block.HayBale))
  .every((d) => d.name.length > 0));

console.log(failures === 0 ? '\nall farming checks passed' : `\n${failures} farming check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
