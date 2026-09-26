/**
 * The nature pack. Plants, trees, new stone and ores, snow and ice, and the biomes they grow in.
 *
 * Block and item ids are fixed in blockids.ts / itemids.ts; this file
 * defines what they are. See types.ts for every field a pack can set.
 *
 * How the plants behave -- needing soil, growing, popping off when their
 * support goes -- lives in client/src/content/nature.ts; where they grow in a
 * fresh world is shared/src/terrain.ts.
 */

import { Block } from '../blockids.js';
import { Item } from '../itemids.js';
import { px, slab, type ShapeEntry } from '../shapekit.js';
import type { BlockSpec, ContentPack, DropFn, ItemSpec } from './types.js';

type Drops = ReturnType<DropFn>;

const SHOVELS: ReadonlySet<number> = new Set([
  Item.WoodShovel, Item.StoneShovel, Item.IronShovel, Item.DiamondShovel,
]);

/** Leaves and grass keep their own form only when sheared, as they should. */
const sheared = (tool: number | null): boolean => tool === Item.Shears;

/**
 * Chance, per leaf block broken, of a sapling falling out of it.
 *
 * One in twenty means an average oak canopy (~40 leaves) gives back a couple
 * of saplings: enough to replant a forest, not so many they pile up.
 */
export const SAPLING_CHANCE = 0.05;
/** Chance an oak leaf block drops an apple as well. */
export const APPLE_CHANCE = 0.01;
/** Chance tall grass gives up a wheat seed -- how a farm gets started. */
export const SEED_CHANCE = 0.125;

function leafDrops(self: number, sapling: number): DropFn {
  return (random, tool): Drops => {
    if (sheared(tool)) return [{ id: self, count: 1 }];
    return random() < SAPLING_CHANCE ? [{ id: sapling, count: 1 }] : [];
  };
}

/** Anything drawn as crossed planes: no collision, no hardness, never hides a neighbour. */
function plant(id: number, name: string, tex: string, extra: Partial<BlockSpec> = {}): BlockSpec {
  return {
    id, name, textures: tex, solid: false, opaque: false, hardness: 0,
    category: 'nature', ...extra,
  };
}

const BLOCKS: BlockSpec[] = [
  // --- ground cover ---------------------------------------------------------
  plant(Block.TallGrass, 'Tall Grass', 'tall_grass', {
    replaceable: true,
    drops: (random, tool) => {
      if (sheared(tool)) return [{ id: Block.TallGrass, count: 1 }];
      return random() < SEED_CHANCE ? [{ id: Item.WheatSeeds, count: 1 }] : [];
    },
  }),
  plant(Block.Fern, 'Fern', 'fern', {
    replaceable: true,
    drops: (_random, tool) => (sheared(tool) ? [{ id: Block.Fern, count: 1 }] : []),
  }),
  plant(Block.DeadBush, 'Dead Bush', 'dead_bush', {
    replaceable: true,
    drops: (random, tool) => sheared(tool)
      ? [{ id: Block.DeadBush, count: 1 }]
      : [{ id: Item.Stick, count: Math.floor(random() * 3) }],
  }),
  plant(Block.Dandelion, 'Dandelion', 'dandelion', { category: 'decoration' }),
  plant(Block.Poppy, 'Poppy', 'poppy', { category: 'decoration' }),
  plant(Block.Cornflower, 'Cornflower', 'cornflower', { category: 'decoration' }),
  plant(Block.Tulip, 'Orange Tulip', 'tulip_orange', { category: 'decoration' }),
  plant(Block.BrownMushroom, 'Brown Mushroom', 'mushroom_brown'),
  plant(Block.RedMushroom, 'Red Mushroom', 'mushroom_red'),
  plant(Block.OakSapling, 'Oak Sapling', 'sapling_oak'),
  plant(Block.BirchSapling, 'Birch Sapling', 'sapling_birch'),
  plant(Block.PineSapling, 'Pine Sapling', 'sapling_pine'),
  plant(Block.Reeds, 'Reeds', 'reeds'),
  {
    id: Block.LilyPad, name: 'Lily Pad', textures: 'lily_pad',
    // Solid, so it can be walked across: a pad you sink through is just a
    // sticker on the water.
    opaque: false, hardness: 0, category: 'nature',
  },

  // --- trees ----------------------------------------------------------------
  {
    id: Block.BirchLog, name: 'Birch Log', textures: ['birch_log_top', 'birch_log_top', 'birch_log_side'],
    hardness: 2, tool: 'axe', category: 'nature',
  },
  {
    id: Block.PineLog, name: 'Pine Log', textures: ['pine_log_top', 'pine_log_top', 'pine_log_side'],
    hardness: 2, tool: 'axe', category: 'nature',
  },
  {
    id: Block.BirchLeaves, name: 'Birch Leaves', textures: 'birch_leaves', hardness: 0.3,
    drops: leafDrops(Block.BirchLeaves, Block.BirchSapling), category: 'nature',
  },
  {
    id: Block.PineLeaves, name: 'Pine Needles', textures: 'pine_leaves', hardness: 0.3,
    drops: leafDrops(Block.PineLeaves, Block.PineSapling), category: 'nature',
  },
  { id: Block.BirchPlanks, name: 'Birch Planks', textures: 'birch_planks', hardness: 2, tool: 'axe', category: 'building' },
  { id: Block.PinePlanks, name: 'Pine Planks', textures: 'pine_planks', hardness: 2, tool: 'axe', category: 'building' },

  // --- desert ---------------------------------------------------------------
  {
    id: Block.Cactus, name: 'Cactus', textures: ['cactus_top', 'cactus_bottom', 'cactus_side'],
    opaque: false, hardness: 0.4, contactDamage: 1, category: 'nature',
  },
  {
    id: Block.Sandstone, name: 'Sandstone', textures: ['sandstone_top', 'sandstone_bottom', 'sandstone_side'],
    hardness: 1.2, tool: 'pickaxe', tier: 1, category: 'building',
  },

  // --- cold -----------------------------------------------------------------
  {
    id: Block.Snow, name: 'Snow', textures: 'snow', hardness: 0.3, tool: 'shovel',
    drops: (_random, tool) => (tool !== null && SHOVELS.has(tool) ? [{ id: Item.Snowball, count: 4 }] : []),
    category: 'nature',
  },
  {
    id: Block.SnowLayer, name: 'Snow Layer', textures: 'snow',
    // Not solid: a dusting of snow is something you wade through, not a
    // ledge to climb onto at every step.
    solid: false, opaque: false, replaceable: true, hardness: 0.1, tool: 'shovel',
    drops: (_random, tool) => (tool !== null && SHOVELS.has(tool) ? [{ id: Item.Snowball, count: 1 }] : []),
    category: 'nature',
  },
  {
    id: Block.Ice, name: 'Ice', textures: 'ice',
    opaque: false, translucent: true, hardness: 0.5, tool: 'pickaxe', slipperiness: 0.9,
    // Ice melts rather than dropping (see the break hook), as in the game it
    // is modelled on; the only way to move it is to not break it.
    drops: () => [],
    category: 'nature',
  },
  {
    id: Block.SnowyGrass, name: 'Snowy Grass Block', textures: ['snow', 'dirt', 'snowy_grass_side'],
    drop: Block.Dirt, tool: 'shovel',
  },

  // --- soil -----------------------------------------------------------------
  { id: Block.Clay, name: 'Clay', textures: 'clay', hardness: 0.6, tool: 'shovel', category: 'nature' },
  {
    id: Block.Podzol, name: 'Podzol', textures: ['podzol_top', 'dirt', 'podzol_side'],
    drop: Block.Dirt, tool: 'shovel', category: 'nature',
  },

  // --- stone ----------------------------------------------------------------
  { id: Block.MossyCobblestone, name: 'Mossy Cobblestone', textures: 'mossy_cobble', hardness: 3, tool: 'pickaxe', tier: 1, category: 'building' },
  { id: Block.Granite, name: 'Granite', textures: 'granite', hardness: 3, tool: 'pickaxe', tier: 1, category: 'building' },
  { id: Block.Slate, name: 'Slate', textures: 'slate', hardness: 3, tool: 'pickaxe', tier: 1, category: 'building' },
  { id: Block.Limestone, name: 'Limestone', textures: 'limestone', hardness: 2, tool: 'pickaxe', tier: 1, category: 'building' },
  { id: Block.CopperOre, name: 'Copper Ore', textures: 'copper_ore', hardness: 3.5, tool: 'pickaxe', tier: 2, category: 'nature' },
  {
    id: Block.RubyOre, name: 'Ruby Ore', textures: 'ruby_ore', hardness: 5, tool: 'pickaxe', tier: 3,
    drop: Item.Ruby, category: 'nature',
  },

  // --- gourds ---------------------------------------------------------------
  { id: Block.Pumpkin, name: 'Pumpkin', textures: ['pumpkin_top', 'pumpkin_top', 'pumpkin_side'], hardness: 1, tool: 'axe', category: 'nature' },
  {
    id: Block.Melon, name: 'Melon', textures: ['melon_top', 'melon_top', 'melon_side'], hardness: 1, tool: 'axe',
    drops: (random) => [{ id: Item.MelonSlice, count: 3 + Math.floor(random() * 5) }],
    category: 'nature',
  },
];

const ITEMS: ItemSpec[] = [
  { id: Item.Apple, name: 'Apple', texture: 'apple', food: 4, category: 'food' },
  { id: Item.MelonSlice, name: 'Melon Slice', texture: 'melon_slice', food: 2, category: 'food' },
  { id: Item.Sugar, name: 'Sugar', texture: 'sugar', category: 'materials' },
  { id: Item.CopperIngot, name: 'Copper Ingot', texture: 'copper_ingot', category: 'materials' },
  { id: Item.Ruby, name: 'Ruby', texture: 'ruby', category: 'materials' },
  { id: Item.Snowball, name: 'Snowball', texture: 'snowball', stackSize: 16, category: 'materials' },
];

/** Crossed planes with a pick box that hugs the plant rather than the cell. */
const cross = (x0: number, h: number, x1 = 16 - x0): ShapeEntry =>
  ({ cross: true, selection: [px(x0, 0, x0, x1, h, x1)] });

const SHAPES: Array<[number | number[], ShapeEntry]> = [
  [[Block.TallGrass, Block.Fern], cross(2, 13)],
  [Block.DeadBush, cross(3, 12)],
  [[Block.Dandelion, Block.Poppy, Block.Cornflower, Block.Tulip], cross(5, 11)],
  [[Block.BrownMushroom, Block.RedMushroom], cross(5, 7)],
  [[Block.OakSapling, Block.BirchSapling, Block.PineSapling], cross(3, 14)],
  [Block.Reeds, cross(2, 16)],
  // Inset a sixteenth so cactus columns stand apart and the spines show.
  [Block.Cactus, { visual: [px(1, 0, 1, 15, 16, 15)] }],
  [Block.SnowLayer, { visual: slab(2 / 16) }],
  [Block.LilyPad, { visual: [px(0, 0, 0, 16, 1, 16)] }],
];

// Birch and pine planks do everything oak planks do. The legacy recipes name
// Block.Planks, so each wood gets its own copy of the basics.
const woodRecipes = (log: number, planks: number): ContentPack['recipes'] => [
  { result: { id: planks, count: 4 }, shapeless: [log] },
  { result: { id: Item.Stick, count: 4 }, pattern: ['P', 'P'], key: { P: planks } },
  { result: { id: Block.CraftingTable, count: 1 }, pattern: ['PP', 'PP'], key: { P: planks } },
  { result: { id: Block.Chest, count: 1 }, pattern: ['PPP', 'P P', 'PPP'], key: { P: planks } },
];

export const NATURE: ContentPack = {
  name: 'nature',
  blocks: BLOCKS,
  items: ITEMS,
  shapes: SHAPES,
  recipes: [
    ...woodRecipes(Block.BirchLog, Block.BirchPlanks)!,
    ...woodRecipes(Block.PineLog, Block.PinePlanks)!,
    { result: { id: Item.Sugar, count: 1 }, shapeless: [Block.Reeds] },
    { result: { id: Block.Snow, count: 1 }, pattern: ['SS', 'SS'], key: { S: Item.Snowball } },
    { result: { id: Block.MossyCobblestone, count: 1 }, shapeless: [Block.Cobblestone, Block.Leaves] },
    { result: { id: Block.Sandstone, count: 1 }, pattern: ['SS', 'SS'], key: { S: Block.Sand } },
  ],
  smelting: [
    { from: Block.CopperOre, to: Item.CopperIngot },
    { from: Block.BirchLog, to: Item.Coal },
    { from: Block.PineLog, to: Item.Coal },
  ],
  fuel: [
    { id: Block.BirchLog, value: 1.5 },
    { id: Block.PineLog, value: 1.5 },
    { id: Block.BirchPlanks, value: 1.5 },
    { id: Block.PinePlanks, value: 1.5 },
    { id: Block.OakSapling, value: 0.5 },
    { id: Block.BirchSapling, value: 0.5 },
    { id: Block.PineSapling, value: 0.5 },
  ],
  transitions: [
    // A sapling becomes the bottom of its own trunk.
    [Block.OakSapling, Block.Log],
    [Block.BirchSapling, Block.BirchLog],
    [Block.PineSapling, Block.PineLog],
    // Grass under snow wears it on its sides, and loses it when the snow goes.
    [Block.Grass, Block.SnowyGrass],
    [Block.SnowyGrass, Block.Grass],
  ],
};
