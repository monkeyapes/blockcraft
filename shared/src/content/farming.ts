/**
 * The farming pack. Hoes, farmland, crops and their stages, and the food they make.
 *
 * Block and item ids are fixed in blockids.ts / itemids.ts; this file
 * defines what they are. See types.ts for every field a pack can set. How
 * any of it behaves -- tilling, growing, trampling -- lives in the client
 * module, client/src/content/farming.ts.
 */

import { Block } from '../blockids.js';
import { Item } from '../itemids.js';
import { px, slab, type Box, type ShapeEntry } from '../shapekit.js';
import type { BlockSpec, ContentPack, DropFn, ItemSpec } from './types.js';

/** Both looks of tilled soil. Wet is darker and grows crops faster. */
export const FARMLAND: readonly number[] = [Block.Farmland, Block.FarmlandWet];

export function isFarmland(id: number): boolean {
  return id === Block.Farmland || id === Block.FarmlandWet;
}

/** One crop: its stages from sprout to ripe, what plants it and what it yields. */
export interface CropKind {
  name: string;
  /** Block ids, youngest first. The last one is ripe. */
  stages: readonly number[];
  /** The item that plants stage 0. */
  seed: number;
  /** What the ripe crop is harvested for. */
  produce: number;
  /** How tall each stage stands, in sixteenths -- what the cursor picks. */
  heights: readonly number[];
}

export const CROPS: readonly CropKind[] = [
  {
    name: 'wheat',
    stages: [Block.Wheat0, Block.Wheat1, Block.Wheat2, Block.Wheat3],
    seed: Item.WheatSeeds,
    produce: Item.Wheat,
    heights: [4, 7, 11, 15],
  },
  {
    name: 'carrots',
    stages: [Block.Carrots0, Block.Carrots1, Block.Carrots2, Block.Carrots3],
    seed: Item.Carrot,
    produce: Item.Carrot,
    heights: [3, 5, 7, 9],
  },
  {
    name: 'potatoes',
    stages: [Block.Potatoes0, Block.Potatoes1, Block.Potatoes2, Block.Potatoes3],
    seed: Item.Potato,
    produce: Item.Potato,
    heights: [3, 5, 8, 10],
  },
];

const cropByBlock = new Map<number, { crop: CropKind; stage: number }>();
for (const crop of CROPS) crop.stages.forEach((id, stage) => cropByBlock.set(id, { crop, stage }));

/** The crop a block is a stage of, and which stage, or null for anything else. */
export function cropAt(id: number): { crop: CropKind; stage: number } | null {
  return cropByBlock.get(id) ?? null;
}

/** Every crop block id, every stage. */
export const CROP_BLOCKS: readonly number[] = CROPS.flatMap((c) => c.stages);

/**
 * What a crop gives when broken. Ripe wheat pays out grain and enough seed
 * to replant with some over; ripe roots are their own seed, so they pay out
 * a handful. Anything unripe only gives back what was planted, so breaking
 * a field early never loses it but never gains either.
 */
function cropDrops(crop: CropKind, stage: number): DropFn {
  const ripe = stage === crop.stages.length - 1;
  return (random) => {
    if (!ripe) return [{ id: crop.seed, count: 1 }];
    if (crop.produce === crop.seed) {
      return [{ id: crop.produce, count: 1 + Math.floor(random() * 4) }];
    }
    return [
      { id: crop.produce, count: 1 },
      { id: crop.seed, count: 1 + Math.floor(random() * 3) },
    ];
  };
}

/**
 * A crop is four thin planes in a '#', the way a row of stalks looks from
 * any side, rather than the X a flower uses: a field of them lines up into
 * rows instead of a haze. Each plane is a zero-thickness box, so the mesher
 * draws it from both sides and the sprite's transparent texels drop out.
 * They run the full height; the sprite decides how tall the plant looks.
 */
const CROP_PLANES: Box[] = [
  px(4, 0, 0, 4, 16, 16),
  px(12, 0, 0, 12, 16, 16),
  px(0, 0, 4, 16, 16, 4),
  px(0, 0, 12, 16, 16, 12),
];

function cropShape(height: number): ShapeEntry {
  return { visual: CROP_PLANES, selection: [px(1, 0, 1, 15, height, 15)] };
}

const blocks: BlockSpec[] = [
  // Tilled soil sits a sixteenth low, as dug earth does, so it has to be
  // non-opaque or the block beside it would cull its face into a hole.
  {
    id: Block.Farmland, name: 'Farmland', textures: ['farmland_dry', 'dirt', 'dirt'],
    opaque: false, hardness: 1, tool: 'shovel', drop: Block.Dirt, family: 'farmland',
    category: 'farming', icon: 'farmland_dry',
  },
  {
    id: Block.FarmlandWet, name: 'Farmland', textures: ['farmland_wet', 'dirt', 'farmland_side_wet'],
    opaque: false, hardness: 1, tool: 'shovel', drop: Block.Dirt, family: 'farmland',
  },
  {
    id: Block.HayBale, name: 'Hay Bale', textures: ['hay_top', 'hay_top', 'hay_side'],
    hardness: 0.5, tool: 'hoe', category: 'building',
  },
];

for (const crop of CROPS) {
  crop.stages.forEach((id, stage) => {
    blocks.push({
      id,
      name: crop.name === 'wheat' ? 'Wheat' : crop.name === 'carrots' ? 'Carrots' : 'Potatoes',
      textures: `${crop.name}_stage${stage}`,
      solid: false, opaque: false, hardness: 0, family: crop.name,
      drops: cropDrops(crop, stage),
    });
  });
}

const HOES: Array<[number, string, string, number, number, number]> = [
  [Item.WoodHoe, 'Wooden Hoe', 'hoe_wood', 1, 2, 60],
  [Item.StoneHoe, 'Stone Hoe', 'hoe_stone', 2, 4, 132],
  [Item.IronHoe, 'Iron Hoe', 'hoe_iron', 3, 6, 251],
  [Item.DiamondHoe, 'Diamond Hoe', 'hoe_diamond', 4, 8, 1562],
];

const items: ItemSpec[] = [
  ...HOES.map(([id, name, texture, tier, speed, durability]): ItemSpec => ({
    id, name, texture, tool: { kind: 'hoe', tier, speed, durability }, attack: 1, category: 'farming',
  })),
  { id: Item.WheatSeeds, name: 'Wheat Seeds', texture: 'wheat_seeds', places: Block.Wheat0, category: 'farming' },
  { id: Item.Wheat, name: 'Wheat', texture: 'wheat', category: 'farming' },
  { id: Item.BoneMeal, name: 'Bone Meal', texture: 'bone_meal', category: 'farming' },
  // Roots are both seed and food: planting one costs a meal.
  { id: Item.Carrot, name: 'Carrot', texture: 'carrot', food: 3, places: Block.Carrots0, category: 'food' },
  { id: Item.Potato, name: 'Potato', texture: 'potato', food: 1, places: Block.Potatoes0, category: 'food' },
  { id: Item.BakedPotato, name: 'Baked Potato', texture: 'baked_potato', food: 5, category: 'food' },
  { id: Item.Bread, name: 'Bread', texture: 'bread', food: 5, category: 'food' },
  { id: Item.PumpkinPie, name: 'Pumpkin Pie', texture: 'pumpkin_pie', food: 8, category: 'food' },
];

const hoe = (material: number, id: number) => ({
  result: { id, count: 1 }, pattern: ['MM', ' S', ' S'], key: { M: material, S: Item.Stick },
});

const shapes: Array<[number | number[], ShapeEntry]> = [
  [[Block.Farmland, Block.FarmlandWet], { visual: slab(15 / 16) }],
];
for (const crop of CROPS) {
  crop.stages.forEach((id, stage) => shapes.push([id, cropShape(crop.heights[stage])]));
}

export const FARMING: ContentPack = {
  name: 'farming',
  blocks,
  items,
  shapes,
  recipes: [
    hoe(Block.Planks, Item.WoodHoe),
    hoe(Block.Cobblestone, Item.StoneHoe),
    hoe(Item.IronIngot, Item.IronHoe),
    hoe(Item.Diamond, Item.DiamondHoe),
    { result: { id: Item.Bread, count: 1 }, pattern: ['WWW'], key: { W: Item.Wheat } },
    { result: { id: Block.HayBale, count: 1 }, pattern: ['WWW', 'WWW', 'WWW'], key: { W: Item.Wheat } },
    { result: { id: Item.Wheat, count: 9 }, shapeless: [Block.HayBale] },
    { result: { id: Item.BoneMeal, count: 3 }, shapeless: [Item.Bone] },
    { result: { id: Item.PumpkinPie, count: 1 }, shapeless: [Block.Pumpkin, Item.Sugar, Item.Wheat] },
  ],
  smelting: [{ from: Item.Potato, to: Item.BakedPotato }],
  fuel: [],
  transitions: [
    // Tilling, straight to the wet look when water is already in reach.
    [Block.Dirt, Block.Farmland], [Block.Grass, Block.Farmland],
    [Block.Dirt, Block.FarmlandWet], [Block.Grass, Block.FarmlandWet],
    // Drying out, being trampled, being built on.
    [Block.Farmland, Block.Dirt], [Block.FarmlandWet, Block.Dirt],
  ],
};
