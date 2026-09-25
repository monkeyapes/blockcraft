/**
 * The nature pack: plants and their support, trees from saplings, cactus,
 * snow and ice, drops, and the biomes and ores of world generation.
 * Run: npx tsx tests/nature.ts
 *
 * Behaviour is driven through the real hooks in client/src/content/nature.ts
 * against a small in-memory world, the same way main.ts drives them.
 */

import { Block, blockDef, canReplace, isReplaceable } from '../shared/src/blocks.js';
import { CHUNK_X, CHUNK_Z, Dimension, SEA_LEVEL, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { APPLE_CHANCE, SAPLING_CHANCE, SEED_CHANCE } from '../shared/src/content/nature.js';
import { Item, blockDrops, smeltResult } from '../shared/src/items.js';
import { RECIPES } from '../shared/src/recipes.js';
import { collisionOf, crossOf, shapeOf } from '../shared/src/shapes.js';
import {
  Biome, BIOME_NAMES, COPPER_Y, RUBY_Y, biomeAt, columnHeight, generateChunk, treeCells,
} from '../shared/src/terrain.js';
import { Player, type InputState } from '../client/src/player.js';
import {
  dispatchBreak, dispatchPlacement, dispatchUse, flushNeighbourChanges, noteBlockChanged,
  type GameContext, type PlaceContext, type UseContext,
} from '../client/src/content/api.js';
import {
  MAX_STALK, canStay, growStalk, growTree, spreadMushroom, sproutAround,
} from '../client/src/content/nature.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- a tiny world ---------------------------------------------------------------

const GROUND = 40;

/** Deterministic 0..1 sequence, so a flaky roll can never fail the suite. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface World extends GameContext {
  cells: Map<string, number>;
  drops: Array<{ id: number; count: number }>;
  consumed: number;
  toasts: string[];
  sky: number;
  settle(): void;
}

/** Flat ground: `floor` at y = GROUND, stone below, air above. */
function makeWorld(floor: number = Block.Grass, opts: { creative?: boolean; seed?: number } = {}): World {
  const cells = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const base = (y: number) => (y < GROUND ? Block.Stone : y === GROUND ? floor : Block.Air);
  const random = rng(opts.seed ?? 7);
  const w: World = {
    cells,
    drops: [],
    consumed: 0,
    toasts: [],
    sky: 1,
    creative: opts.creative ?? false,
    time: 0,
    dimension: Dimension.Overworld,
    world: { skyLight: () => w.sky } as never,
    player: {} as never,
    mobs: {} as never,
    sound: {} as never,
    getBlock: (x, y, z) => cells.get(key(x, y, z)) ?? base(y),
    setBlock(x, y, z, id) {
      if (!canReplace(w.getBlock(x, y, z), id)) return false;
      cells.set(key(x, y, z), id);
      noteBlockChanged(x, y, z);
      return true;
    },
    breakBlock(x, y, z, o) {
      const id = w.getBlock(x, y, z);
      if (o?.drops !== false && !w.creative) w.drops.push(...blockDrops(id, random, null));
      cells.set(key(x, y, z), Block.Air);
      noteBlockChanged(x, y, z);
      dispatchBreak(w, x, y, z, id, null);
    },
    heldItem: () => null,
    consumeHeld: () => { w.consumed++; return true; },
    replaceHeld: () => {},
    give: (id, count) => { w.drops.push({ id, count }); },
    dropItem: (_x, _y, _z, id, count) => { w.drops.push({ id, count }); },
    damagePlayer: () => {},
    healPlayer: () => {},
    pushPlayer: () => {},
    hurtMob: () => {},
    toast: (t) => { w.toasts.push(t); },
    chat: () => {},
    breakParticles: () => {},
    swing: () => {},
    random,
    settle: () => { for (let i = 0; i < 8; i++) flushNeighbourChanges(w, 10000); },
  };
  return w;
}

/** Puts a block directly, as world generation would, without any hook. */
function plant(w: World, x: number, y: number, z: number, id: number): void {
  w.cells.set(`${x},${y},${z}`, id);
}

function useOn(w: World, x: number, y: number, z: number, held: number): boolean {
  const ctx = Object.assign(Object.create(w), {
    x, y, z, id: w.getBlock(x, y, z), face: [0, 1, 0], point: [x + 0.5, y + 1, z + 0.5],
    held, sneaking: false,
  }) as UseContext;
  return dispatchUse(ctx);
}

function placeResult(w: World, item: number, px: number, py: number, pz: number): { id: number | null | undefined; py: number } {
  const ctx = Object.assign(Object.create(w), {
    x: px, y: py - 1, z: pz, id: w.getBlock(px, py - 1, pz), face: [0, 1, 0], point: [px, py, pz],
    held: item, sneaking: false, px, py, pz, allowReplace: false,
  }) as PlaceContext;
  const id = dispatchPlacement(ctx, item);
  return { id, py: ctx.py };
}

const Y = GROUND + 1;

// --- plants need support ----------------------------------------------------------

{
  const w = makeWorld();
  plant(w, 0, Y, 0, Block.Poppy);
  plant(w, 2, Y, 0, Block.TallGrass);
  plant(w, 4, Y, 0, Block.OakSapling);
  w.setBlock(0, GROUND, 0, Block.Air);
  w.setBlock(2, GROUND, 0, Block.Air);
  w.setBlock(4, GROUND, 0, Block.Air);
  w.settle();
  check('a poppy pops off when the ground under it goes', w.getBlock(0, Y, 0) === Block.Air);
  check('...and drops itself', w.drops.some((d) => d.id === Block.Poppy));
  check('tall grass pops off without ground', w.getBlock(2, Y, 0) === Block.Air);
  check('a sapling pops off without ground', w.getBlock(4, Y, 0) === Block.Air);

  const kept = makeWorld();
  plant(kept, 0, Y, 0, Block.Dandelion);
  kept.setBlock(1, Y, 0, Block.Stone);
  kept.settle();
  check('a flower with its soil intact stays put', kept.getBlock(0, Y, 0) === Block.Dandelion);

  const pond = makeWorld(Block.Water);
  plant(pond, 0, Y, 0, Block.LilyPad);
  pond.cells.set(`0,${GROUND},0`, Block.Air);
  noteBlockChanged(0, GROUND, 0);
  pond.settle();
  check('a lily pad goes when its water does', pond.getBlock(0, Y, 0) === Block.Air);

  const cave = makeWorld(Block.Stone);
  check('a mushroom can stand on stone', canStay(cave, 0, Y, 0, Block.RedMushroom));
  check('a flower cannot', !canStay(cave, 0, Y, 0, Block.Poppy));
  check('placing a flower on stone is refused', placeResult(cave, Block.Poppy, 0, Y, 0).id === null);
  check('placing a flower on grass is allowed', placeResult(w, Block.Poppy, 8, Y, 8).id === Block.Poppy);
  const desert = makeWorld(Block.Sand);
  check('a dead bush grows on sand', canStay(desert, 0, Y, 0, Block.DeadBush));
  check('a sapling does not', !canStay(desert, 0, Y, 0, Block.OakSapling));
}

// --- lily pad placement --------------------------------------------------------

{
  const w = makeWorld(Block.Sand);
  for (let y = GROUND - 3; y <= GROUND; y++) plant(w, 0, y, 0, Block.Water);
  const onBed = placeResult(w, Block.LilyPad, 0, GROUND - 3, 0);
  check('a lily pad aimed at the pond bed floats to the surface',
    onBed.id === Block.LilyPad && onBed.py === GROUND + 1, `py ${onBed.py}`);
  check('a lily pad on dry land is refused', placeResult(w, Block.LilyPad, 3, Y, 3).id === null);
  const lily = shapeOf(Block.LilyPad)[0];
  check('a lily pad is a sixteenth-thick pad', lily.y1 === 1 / 16 && lily.x1 - lily.x0 === 1);
}

// --- trees ------------------------------------------------------------------------

function grow(kind: number, seed = 3): { w: World; grew: boolean } {
  const w = makeWorld(Block.Grass, { seed });
  plant(w, 0, Y, 0, kind);
  return { w, grew: growTree(w, 0, Y, 0) };
}

function census(w: World): Map<number, Array<[number, number, number]>> {
  const out = new Map<number, Array<[number, number, number]>>();
  for (const [k, id] of w.cells) {
    const [x, y, z] = k.split(',').map(Number);
    out.set(id, [...(out.get(id) ?? []), [x, y, z]]);
  }
  return out;
}

{
  const oak = grow(Block.OakSapling);
  const oakCells = census(oak.w);
  const oakTrunk = oakCells.get(Block.Log) ?? [];
  check('an oak sapling grows into an oak', oak.grew && oakTrunk.length >= 4 && oakTrunk.length <= 6,
    `${oakTrunk.length} logs`);
  check('...with oak leaves round the top', (oakCells.get(Block.Leaves)?.length ?? 0) > 20);
  check('...rooted where the sapling was', oak.w.getBlock(0, Y, 0) === Block.Log);

  const birch = grow(Block.BirchSapling);
  const birchCells = census(birch.w);
  const birchTrunk = birchCells.get(Block.BirchLog) ?? [];
  check('a birch sapling grows a pale birch trunk 5-7 tall',
    birch.grew && birchTrunk.length >= 5 && birchTrunk.length <= 7, `${birchTrunk.length} logs`);
  check('...with birch leaves, and no oak in it',
    (birchCells.get(Block.BirchLeaves)?.length ?? 0) > 15 && !birchCells.has(Block.Log));

  const pine = grow(Block.PineSapling);
  const pineCells = census(pine.w);
  const pineTrunk = pineCells.get(Block.PineLog) ?? [];
  check('a pine sapling grows a tall pine trunk', pine.grew && pineTrunk.length >= 7, `${pineTrunk.length} logs`);
  // A cone: the widest layer of needles sits below the narrowest, and the
  // very top is a single block over the trunk.
  const widthAt = new Map<number, number>();
  for (const [x, y] of pineCells.get(Block.PineLeaves) ?? []) {
    widthAt.set(y, Math.max(widthAt.get(y) ?? 0, Math.abs(x)));
  }
  const ys = [...widthAt.keys()].sort((a, b) => a - b);
  const tip = ys[ys.length - 1];
  const widest = ys.reduce((best, y) => (widthAt.get(y)! > widthAt.get(best)! ? y : best), ys[0]);
  check('a pine is a cone: widest low, a point on top',
    widthAt.get(tip) === 0 && widest < tip - 3 && widthAt.get(widest)! >= 2,
    `tip r${widthAt.get(tip)} at ${tip}, widest r${widthAt.get(widest)} at ${widest}`);
  check('a pine has bare trunk at the bottom', !(pineCells.get(Block.PineLeaves) ?? []).some(([, y]) => y <= Y + 1));

  const blocked = makeWorld();
  plant(blocked, 0, Y, 0, Block.OakSapling);
  plant(blocked, 0, Y + 3, 0, Block.Stone);
  check('a sapling under a low ceiling does not grow',
    !growTree(blocked, 0, Y, 0) && blocked.getBlock(0, Y, 0) === Block.OakSapling &&
    blocked.getBlock(0, Y + 1, 0) === Block.Air);

  const wall = makeWorld();
  plant(wall, 0, Y, 0, Block.BirchSapling);
  for (let y = Y; y < Y + 12; y++) plant(wall, 2, y, 0, Block.Stone);
  check('a sapling beside a wall still grows, trimmed by it',
    growTree(wall, 0, Y, 0) && wall.getBlock(2, Y + 4, 0) === Block.Stone);

  // The same definition shapes generated trees.
  const oakShape = treeCells('oak', 5);
  check('generated oak shape: 5 logs and a crown of leaves',
    oakShape.filter((c) => c.trunk).length === 5 && oakShape.filter((c) => !c.trunk).length > 30);

  // Bone meal.
  const meal = makeWorld();
  plant(meal, 0, Y, 0, Block.PineSapling);
  check('bone meal on a sapling is handled', useOn(meal, 0, Y, 0, Item.BoneMeal));
  check('...and grows the tree at once', meal.getBlock(0, Y, 0) === Block.PineLog && meal.consumed === 1);
  const lawn = makeWorld();
  check('bone meal on grass is handled', useOn(lawn, 0, GROUND, 0, Item.BoneMeal));
  const sprouted = [...lawn.cells.values()].filter((id) => id === Block.TallGrass || blockDef(id).category === 'decoration');
  check('...and sprouts grass and flowers around', sprouted.length >= 4 && lawn.consumed === 1, `${sprouted.length} plants`);
  check('sprouting only puts plants on grass', sproutAround(makeWorld(Block.Stone), 0, GROUND, 0) === 0);
  check('bone meal on stone is left to other packs', !useOn(makeWorld(Block.Stone), 0, GROUND, 0, Item.BoneMeal));
}

// --- cactus -----------------------------------------------------------------------

{
  const d = blockDef(Block.Cactus);
  check('cactus hurts to touch', d.contactDamage > 0);
  check('cactus is not an opaque full cube', !d.opaque && shapeOf(Block.Cactus)[0].x0 === 1 / 16);

  const w = makeWorld(Block.Sand);
  plant(w, 0, Y, 0, Block.Cactus);
  check('a cactus grows', growStalk(w, 0, Y, 0, Block.Cactus));
  check('...again', growStalk(w, 0, Y + 1, 0, Block.Cactus));
  check(`...but not past ${MAX_STALK}`, !growStalk(w, 0, Y + 2, 0, Block.Cactus));
  w.setBlock(1, Y + 1, 0, Block.Stone);
  w.settle();
  check('a solid block beside a cactus breaks it', w.getBlock(0, Y + 1, 0) === Block.Air);
  check('...dropping cactus', w.drops.some((x) => x.id === Block.Cactus));
  check('the piece below, with nothing beside it, stays', w.getBlock(0, Y, 0) === Block.Cactus);
  plant(w, 6, Y, 5, Block.Stone);
  check('a cactus cannot be placed beside a solid block',
    placeResult(w, Block.Cactus, 5, Y, 5).id === null && placeResult(w, Block.Cactus, 9, Y, 9).id === Block.Cactus);

  // A player standing against a cactus is being pricked.
  const cactusWorld = {
    getBlock: (x: number, y: number, z: number) =>
      y <= GROUND ? Block.Sand : x === 1 && z === 0 && y === Y ? Block.Cactus : Block.Air,
    isLoaded: () => true,
  } as never;
  const p = new Player();
  p.x = 0.2; p.y = Y; p.z = 0.5; p.yaw = 0;
  for (let i = 0; i < 40; i++) p.update(1 / 60, cactusWorld, keys({ forward: true }));
  check('walking into a cactus stops at its inset side', p.x > 0.6 && p.x < 1 + 1 / 16, `x ${p.x.toFixed(3)}`);
  check('...and pricks', p.contactDamage > 0, `${p.contactDamage}/s`);
  const apart = new Player();
  apart.x = 0.3; apart.y = Y; apart.z = 0.5;
  apart.update(1 / 60, cactusWorld, keys());
  check('standing clear of a cactus does not', apart.contactDamage === 0);

  // Reeds climb beside water only.
  const bank = makeWorld(Block.Sand);
  plant(bank, 1, GROUND, 0, Block.Water);
  plant(bank, 0, Y, 0, Block.Reeds);
  check('reeds grow on a bank by water', growStalk(bank, 0, Y, 0, Block.Reeds));
  check('reeds cannot stand on dry sand', !canStay(bank, 5, Y, 5, Block.Reeds));
  bank.setBlock(1, GROUND, 0, Block.Air);
  bank.cells.set(`1,${GROUND},0`, Block.Sand);
  noteBlockChanged(1, GROUND, 0);
  bank.settle();
  check('reeds pop off when the water goes, the whole stalk',
    bank.getBlock(0, Y, 0) === Block.Air && bank.getBlock(0, Y + 1, 0) === Block.Air);
}

function keys(over: Partial<InputState> = {}): InputState {
  return { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false, ...over };
}

// --- mushrooms ---------------------------------------------------------------------

{
  const shade = makeWorld(Block.Stone, { seed: 11 });
  shade.sky = 0.2;
  plant(shade, 0, Y, 0, Block.BrownMushroom);
  let spread = 0;
  for (let i = 0; i < 200; i++) if (spreadMushroom(shade, 0, Y, 0, Block.BrownMushroom)) spread++;
  const sun = makeWorld(Block.Stone, { seed: 11 });
  plant(sun, 0, Y, 0, Block.BrownMushroom);
  let sunny = 0;
  for (let i = 0; i < 200; i++) if (spreadMushroom(sun, 0, Y, 0, Block.BrownMushroom)) sunny++;
  check('mushrooms spread in shade', spread > 0, `${spread}`);
  check('...but thin themselves out', spread <= 5, `${spread}`);
  check('...and never into sunlight', sunny === 0);
}

// --- snow and ice -------------------------------------------------------------------

{
  check('a snow layer is replaceable', isReplaceable(Block.SnowLayer) && canReplace(Block.SnowLayer, Block.Stone));
  const layer = shapeOf(Block.SnowLayer);
  check('a snow layer is a 2/16 slab', layer.length === 1 && layer[0].y1 === 2 / 16 && layer[0].x1 === 1);
  check('a snow layer does not hide what is beside it', !blockDef(Block.SnowLayer).opaque);
  check('snow layers drop a snowball to a shovel',
    blockDrops(Block.SnowLayer, Math.random, Item.WoodShovel).some((d) => d.id === Item.Snowball));
  check('...and nothing to a bare hand', blockDrops(Block.SnowLayer, Math.random, null).length === 0);
  check('a snow block gives four snowballs to a shovel',
    blockDrops(Block.Snow, Math.random, Item.IronShovel)[0]?.count === 4);
  check('four snowballs make a snow block',
    RECIPES.some((r) => r.result.id === Block.Snow && r.key && Object.values(r.key).includes(Item.Snowball)));

  const ice = blockDef(Block.Ice);
  check('ice is slippery', ice.slipperiness >= 0.85, `${ice.slipperiness}`);
  check('ice is see-through', ice.translucent && !ice.opaque);

  // Slide test: walk, let go, measure how far the player coasts.
  function coast(floor: number): number {
    const world = {
      getBlock: (_x: number, y: number) => (y <= GROUND ? floor : Block.Air),
      isLoaded: () => true,
    } as never;
    const p = new Player();
    p.x = 0.5; p.y = Y; p.z = 0.5; p.yaw = 0;
    for (let i = 0; i < 60; i++) p.update(1 / 60, world, keys({ forward: true }));
    const x0 = p.x;
    const z0 = p.z;
    for (let i = 0; i < 120; i++) p.update(1 / 60, world, keys());
    return Math.hypot(p.x - x0, p.z - z0);
  }
  const onStone = coast(Block.Stone);
  const onIce = coast(Block.Ice);
  check('a player slides much further on ice than on stone', onIce > onStone * 3,
    `${onIce.toFixed(2)} vs ${onStone.toFixed(2)} blocks`);

  const melt = makeWorld(Block.Water);
  plant(melt, 0, GROUND, 0, Block.Ice);
  melt.breakBlock(0, GROUND, 0);
  check('broken ice melts back into water', melt.getBlock(0, GROUND, 0) === Block.Water);

  const snowy = makeWorld();
  snowy.setBlock(0, Y, 0, Block.SnowLayer);
  snowy.settle();
  check('grass under snow turns snowy', snowy.getBlock(0, GROUND, 0) === Block.SnowyGrass);
  snowy.setBlock(0, Y, 0, Block.Air);
  snowy.settle();
  check('...and back to grass when the snow is cleared', snowy.getBlock(0, GROUND, 0) === Block.Grass);
}

// --- drops -----------------------------------------------------------------------------

{
  const N = 20000;
  const r = rng(99);
  let seeds = 0;
  for (let i = 0; i < N; i++) if (blockDrops(Block.TallGrass, r, null).some((d) => d.id === Item.WheatSeeds)) seeds++;
  check('tall grass drops seeds about one time in eight',
    Math.abs(seeds / N - SEED_CHANCE) < 0.01, `${(seeds / N * 100).toFixed(1)}%`);
  check('sheared tall grass drops itself', blockDrops(Block.TallGrass, r, Item.Shears)[0]?.id === Block.TallGrass);

  const counts = new Set<number>();
  for (let i = 0; i < 2000; i++) {
    const d = blockDrops(Block.Melon, r, null);
    counts.add(d.find((x) => x.id === Item.MelonSlice)?.count ?? 0);
  }
  check('a melon drops 3-7 slices, and every count in that range occurs',
    Math.min(...counts) === 3 && Math.max(...counts) === 7 && counts.size === 5, [...counts].sort().join(','));

  let birch = 0;
  for (let i = 0; i < N; i++) if (blockDrops(Block.BirchLeaves, r, null).some((d) => d.id === Block.BirchSapling)) birch++;
  check('birch leaves drop saplings about one time in twenty',
    Math.abs(birch / N - SAPLING_CHANCE) < 0.008, `${(birch / N * 100).toFixed(1)}%`);
  check('pine needles drop pine saplings',
    Array.from({ length: 400 }, () => blockDrops(Block.PineLeaves, r, null)).flat().some((d) => d.id === Block.PineSapling));

  const w = makeWorld();
  for (let i = 0; i < N; i++) dispatchBreak(w, 0, Y, 0, Block.Leaves, null);
  const saplings = w.drops.filter((d) => d.id === Block.OakSapling).length;
  const apples = w.drops.filter((d) => d.id === Item.Apple).length;
  check('oak leaves drop oak saplings about one time in twenty',
    Math.abs(saplings / N - SAPLING_CHANCE) < 0.008, `${(saplings / N * 100).toFixed(1)}%`);
  check('...and apples about one time in a hundred',
    Math.abs(apples / N - APPLE_CHANCE) < 0.004 && apples > 0, `${(apples / N * 100).toFixed(2)}%`);
  const creative = makeWorld(Block.Grass, { creative: true });
  for (let i = 0; i < 2000; i++) dispatchBreak(creative, 0, Y, 0, Block.Leaves, null);
  check('leaves drop nothing in creative', creative.drops.length === 0);

  check('ruby ore drops a ruby', blockDrops(Block.RubyOre, r, null)[0]?.id === Item.Ruby);
  check('copper ore smelts into a copper ingot', smeltResult(Block.CopperOre)?.id === Item.CopperIngot);
  for (const planks of [Block.BirchPlanks, Block.PinePlanks]) {
    const name = blockDef(planks).name;
    for (const [what, id] of [['sticks', Item.Stick], ['a crafting table', Block.CraftingTable], ['a chest', Block.Chest]] as const) {
      check(`${name} make ${what}`, RECIPES.some((rc) => rc.result.id === id && Object.values(rc.key ?? {}).includes(planks)));
    }
  }
  check('reeds make sugar', RECIPES.some((rc) => rc.result.id === Item.Sugar && rc.shapeless?.includes(Block.Reeds)));
}

// --- models ------------------------------------------------------------------------------

{
  const plants = [
    Block.TallGrass, Block.Fern, Block.Dandelion, Block.Poppy, Block.Cornflower, Block.Tulip,
    Block.BrownMushroom, Block.RedMushroom, Block.OakSapling, Block.BirchSapling, Block.PineSapling,
    Block.Reeds, Block.DeadBush,
  ];
  check('every plant is drawn as crossed planes', plants.every((id) => crossOf(id) !== null));
  check('no plant blocks movement or hides its neighbours',
    plants.every((id) => !blockDef(id).solid && !blockDef(id).opaque && blockDef(id).hardness === 0));
  check('tall grass, ferns and dead bushes are replaceable',
    [Block.TallGrass, Block.Fern, Block.DeadBush].every(isReplaceable));
  check('flowers are not', !isReplaceable(Block.Poppy));
  check('a cactus collides with its inset box', collisionOf(Block.Cactus)[0].z1 === 15 / 16);
}

// --- world generation --------------------------------------------------------------------

const SEED = 2406;
{
  const a = generateChunk(SEED, Dimension.Overworld, 9, -4);
  const b = generateChunk(SEED, Dimension.Overworld, 9, -4);
  const c = generateChunk(SEED + 1, Dimension.Overworld, 9, -4);
  check('same seed, same chunk', a.every((v, i) => v === b[i]));
  check('a different seed gives a different chunk', a.some((v, i) => v !== c[i]));
}

/** Chunks whose centre column is in the biome, nearest the origin first. */
function chunksIn(biome: Biome, limit: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let r = 0; r < 60 && out.length < limit; r++) {
    for (let cx = -r; cx <= r && out.length < limit; cx++) {
      for (let cz = -r; cz <= r && out.length < limit; cz++) {
        if (Math.max(Math.abs(cx), Math.abs(cz)) !== r) continue;
        const x = cx * CHUNK_X + 8;
        const z = cz * CHUNK_Z + 8;
        const h = columnHeight(SEED, x, z);
        if (biomeAt(SEED, x, z, h) !== biome) continue;
        if (biome !== Biome.Swamp && h <= SEA_LEVEL + 1) continue;
        if (biome === Biome.Swamp && Math.abs(h - SEA_LEVEL) > 3) continue;
        out.push([cx, cz]);
      }
    }
  }
  return out;
}

/** A pseudo-id for the survey: a trunk standing on sand. */
const TREE_ON_SAND = -1;

/** Counts of each block id over some chunks, plus how many plants could not stand. */
function survey(chunks: Array<[number, number]>): { count: Map<number, number>; unsupported: string[] } {
  const count = new Map<number, number>();
  const unsupported: string[] = [];
  for (const [cx, cz] of chunks) {
    const data = generateChunk(SEED, Dimension.Overworld, cx, cz);
    const reader = {
      getBlock: (x: number, y: number, z: number) => {
        if (y < 0 || y >= WORLD_Y || x < 0 || x >= CHUNK_X || z < 0 || z >= CHUNK_Z) return Block.Air;
        return data[voxelIndex(x, y, z)];
      },
    };
    for (let y = 0; y < WORLD_Y; y++) {
      for (let z = 0; z < CHUNK_Z; z++) {
        for (let x = 0; x < CHUNK_X; x++) {
          const id = data[voxelIndex(x, y, z)];
          count.set(id, (count.get(id) ?? 0) + 1);
          if (y > 0 && data[voxelIndex(x, y - 1, z)] === Block.Sand &&
              (id === Block.Log || id === Block.BirchLog || id === Block.PineLog)) {
            count.set(TREE_ON_SAND, (count.get(TREE_ON_SAND) ?? 0) + 1);
          }
          // Every generated plant must satisfy the same rule play enforces,
          // or it would pop off the first time anything nearby changed.
          // Chunk-edge cells can depend on the next chunk, so skip those.
          if (x === 0 || z === 0 || x === CHUNK_X - 1 || z === CHUNK_Z - 1) continue;
          if (id >= Block.TallGrass && crossOf(id) !== null || id === Block.Cactus || id === Block.LilyPad || id === Block.SnowLayer) {
            if (!canStay(reader, x, y, z, id) && unsupported.length < 5) {
              unsupported.push(`${blockDef(id).name}@${cx * 16 + x},${y},${cz * 16 + z}`);
            }
          }
        }
      }
    }
  }
  return { count, unsupported };
}

const EXPECT: Array<[Biome, number[][]]> = [
  // Each inner list: at least one of these must appear.
  [Biome.Plains, [[Block.TallGrass], [Block.Dandelion, Block.Poppy, Block.Cornflower, Block.Tulip], [Block.Grass]]],
  [Biome.Forest, [[Block.Log], [Block.BirchLog], [Block.BirchLeaves], [Block.BrownMushroom, Block.RedMushroom]]],
  [Biome.Taiga, [[Block.PineLog], [Block.PineLeaves], [Block.Fern], [Block.Podzol]]],
  [Biome.SnowyTaiga, [[Block.PineLog], [Block.SnowLayer], [Block.SnowyGrass]]],
  [Biome.Desert, [[Block.Cactus], [Block.DeadBush], [Block.Sandstone]]],
  [Biome.Swamp, [[Block.LilyPad], [Block.Reeds], [Block.Clay]]],
];

let allUnsupported: string[] = [];
for (const [biome, wants] of EXPECT) {
  const chunks = chunksIn(biome, 6);
  const { count, unsupported } = survey(chunks);
  allUnsupported = allUnsupported.concat(unsupported);
  const missing = wants.filter((ids) => !ids.some((id) => (count.get(id) ?? 0) > 0))
    .map((ids) => blockDef(ids[0]).name);
  check(`${BIOME_NAMES[biome]} is found and grows its features`, chunks.length > 0 && missing.length === 0,
    `${chunks.length} chunks${missing.length ? '; missing ' + missing.join(', ') : ''}`);
  if (biome === Biome.Desert) {
    check('deserts grow no trees', (count.get(TREE_ON_SAND) ?? 0) === 0, `${count.get(TREE_ON_SAND) ?? 0} trunks on sand`);
  }
}
check('every generated plant has the ground it needs', allUnsupported.length === 0, allUnsupported.join(' '));

{
  // Snowy water freezes on top.
  const { count } = survey(chunksIn(Biome.SnowyTaiga, 20));
  check('still water in the snow freezes over', (count.get(Block.Ice) ?? 0) > 0, `${count.get(Block.Ice) ?? 0} ice`);
}

// --- ores and rock -----------------------------------------------------------------------

{
  let copper = 0, ruby = 0, copperOut = 0, rubyOut = 0;
  const rock = new Map<number, number>();
  for (let cx = -4; cx < 4; cx++) {
    for (let cz = -4; cz < 4; cz++) {
      const data = generateChunk(SEED, Dimension.Overworld, cx, cz);
      for (let y = 0; y < WORLD_Y; y++) {
        for (let i = 0; i < CHUNK_X * CHUNK_Z; i++) {
          const id = data[voxelIndex(i & 15, y, i >> 4)];
          if (id === Block.CopperOre) { copper++; if (y < COPPER_Y[0] || y > COPPER_Y[1]) copperOut++; }
          if (id === Block.RubyOre) { ruby++; if (y < RUBY_Y[0] || y > RUBY_Y[1]) rubyOut++; }
          if (id === Block.Granite || id === Block.Slate || id === Block.Limestone) rock.set(id, (rock.get(id) ?? 0) + 1);
        }
      }
    }
  }
  check('copper ore is common', copper > 64 * 10, `${copper} in 64 chunks`);
  check(`copper sits between y ${COPPER_Y[0]} and ${COPPER_Y[1]}`, copperOut === 0);
  check('ruby ore exists but is rare', ruby > 0 && ruby * 8 < copper, `${ruby} in 64 chunks`);
  check(`ruby sits deep, y ${RUBY_Y[0]}-${RUBY_Y[1]}`, rubyOut === 0);
  check('granite, slate and limestone all occur underground',
    (rock.get(Block.Granite) ?? 0) > 0 && (rock.get(Block.Slate) ?? 0) > 0 && (rock.get(Block.Limestone) ?? 0) > 0,
    [...rock.entries()].map(([id, n]) => `${blockDef(id).name} ${n}`).join(', '));
}

// --- generation speed ------------------------------------------------------------------------

{
  let best = Infinity;
  for (let b = 0; b < 4; b++) {
    const t0 = performance.now();
    for (let i = 0; i < 12; i++) generateChunk(SEED, Dimension.Overworld, i % 5, (i / 5) | 0);
    best = Math.min(best, (performance.now() - t0) / 12);
  }
  // The generator ran ~2.8 ms/chunk on the development machine before biomes;
  // this is a guard against a pathological slowdown, not a benchmark.
  check('biome generation stays fast', best < 8, `${best.toFixed(2)} ms/chunk`);
}

console.log(`\n${failures === 0 ? 'all nature checks passed' : `${failures} FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
