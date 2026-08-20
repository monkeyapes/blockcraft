/** Crafting recipes and grid matching. */

import { Block } from './blocks.js';
import { Item } from './items.js';

export interface RecipeResult {
  id: number;
  count: number;
}

export interface Recipe {
  result: RecipeResult;
  /** Rows of single-character keys; a space means "must be empty". */
  pattern?: string[];
  key?: Record<string, number>;
  /** Order-independent ingredient list. */
  shapeless?: number[];
}

const P = Block.Planks;
const C = Block.Cobblestone;
const I = Item.IronIngot;
const D = Item.Diamond;
const S = Item.Stick;

/** The four standard armour shapes for one material. */
function armorSet(
  material: number, mark: string,
  [helmet, chest, legs, boots]: [Item, Item, Item, Item],
): Recipe[] {
  const key = { [mark]: material };
  const m = mark;
  return [
    { result: { id: helmet, count: 1 }, pattern: [`${m}${m}${m}`, `${m} ${m}`], key },
    { result: { id: chest, count: 1 }, pattern: [`${m} ${m}`, `${m}${m}${m}`, `${m}${m}${m}`], key },
    { result: { id: legs, count: 1 }, pattern: [`${m}${m}${m}`, `${m} ${m}`, `${m} ${m}`], key },
    { result: { id: boots, count: 1 }, pattern: [`${m} ${m}`, `${m} ${m}`], key },
  ];
}

function tools(material: number, mark: string, pick: Item, axe: Item, shovel: Item): Recipe[] {
  const key = { [mark]: material, S };
  return [
    { result: { id: pick, count: 1 }, pattern: [`${mark}${mark}${mark}`, ' S ', ' S '], key },
    { result: { id: axe, count: 1 }, pattern: [`${mark}${mark}`, `${mark}S`, ' S'], key },
    { result: { id: shovel, count: 1 }, pattern: [mark, 'S', 'S'], key },
  ];
}

export const RECIPES: Recipe[] = [
  { result: { id: Block.Planks, count: 4 }, shapeless: [Block.Log] },
  { result: { id: Item.Stick, count: 4 }, pattern: ['P', 'P'], key: { P } },
  {
    result: { id: Block.CraftingTable, count: 1 },
    pattern: ['PP', 'PP'],
    key: { P },
  },
  {
    result: { id: Block.Furnace, count: 1 },
    pattern: ['CCC', 'C C', 'CCC'],
    key: { C },
  },
  {
    result: { id: Block.IronBlock, count: 1 },
    pattern: ['III', 'III', 'III'],
    key: { I },
  },

  // Machines. Iron is the common material, so the automation chain gates
  // behind finding and smelting iron rather than behind anything exotic.
  {
    result: { id: Block.Conveyor, count: 6 },
    pattern: ['III', 'SSS'],
    key: { I, S },
  },
  // Vehicles. A boat is cheap because water is otherwise a wall; a truck
  // costs more than a car because it hauls more and climbs better.
  {
    result: { id: Item.Boat, count: 1 },
    pattern: ['P P', 'PPP'],
    key: { P },
  },
  {
    result: { id: Item.Truck, count: 1 },
    pattern: ['I I', 'III', 'I I'],
    key: { I },
  },
  { result: { id: Block.Ladder, count: 4 }, pattern: ['S S', 'SSS', 'S S'], key: { S } },
  // No wool block exists, so the soft half is leather -- which cows already
  // drop, keeping the bed behind the same "go find animals" step wool would.
  {
    result: { id: Block.Bed, count: 1 },
    pattern: ['LLL', 'PPP'],
    key: { L: Item.Leather, P },
  },
  {
    result: { id: Block.Chest, count: 1 },
    pattern: ['PPP', 'P P', 'PPP'],
    key: { P },
  },
  {
    result: { id: Block.Collector, count: 1 },
    pattern: ['I I', 'ICI', ' I '],
    key: { I, C },
  },
  {
    result: { id: Block.Miner, count: 1 },
    pattern: ['III', 'IDI', 'ICI'],
    key: { I, D, C },
  },
  // Power. A generator is a furnace with iron around it; cable is cheap so
  // wiring a base up is never the expensive part.
  {
    result: { id: Block.Generator, count: 1 },
    pattern: ['III', 'IFI', 'ICI'],
    key: { I, F: Block.Furnace, C },
  },
  { result: { id: Block.Cable, count: 6 }, pattern: ['III'], key: { I } },
  {
    result: { id: Block.SolarPanel, count: 1 },
    pattern: ['GGG', 'ICI', 'III'],
    key: { G: Block.Glass, I, C },
  },
  {
    result: { id: Block.Battery, count: 1 },
    pattern: ['ICI', 'IGI', 'ICI'],
    key: { I, C: Item.Coal, G: Item.GoldIngot },
  },
  // NoVolt machines. Each wants iron plus the thing it works on, so the
  // recipe hints at what it does.
  {
    result: { id: Block.StoneGenerator, count: 1 },
    pattern: ['ICI', 'CFC', 'ICI'],
    key: { I, C, F: Block.Furnace },
  },
  {
    result: { id: Block.ElectricFurnace, count: 1 },
    pattern: ['III', 'IFI', 'IGI'],
    key: { I, F: Block.Furnace, G: Item.GoldIngot },
  },
  {
    result: { id: Block.Sawmill, count: 1 },
    pattern: ['IPI', 'PIP', 'IPI'],
    key: { I, P },
  },
  {
    result: { id: Block.Compressor, count: 1 },
    pattern: ['III', 'I I', 'ICI'],
    key: { I, C },
  },
  {
    result: { id: Block.Quarry, count: 1 },
    pattern: ['IDI', 'IMI', 'III'],
    key: { I, D, M: Block.Miner },
  },
  {
    result: { id: Block.WaterWheel, count: 1 },
    pattern: ['PPP', 'PIP', 'PPP'],
    key: { P, I },
  },
  {
    result: { id: Block.Booster, count: 1 },
    pattern: [' I ', 'IGI', ' I '],
    key: { I, G: Item.GoldIngot },
  },
  {
    result: { id: Block.Elevator, count: 2 },
    pattern: ['I I', 'IDI', 'I I'],
    key: { I, D: Item.Diamond },
  },
  {
    result: { id: Block.Crusher, count: 1 },
    pattern: ['ICI', 'IDI', 'III'],
    key: { I, C, D },
  },
  {
    result: { id: Block.Sorter, count: 1 },
    pattern: ['III', 'ICI', 'III'],
    key: { I, C },
  },

  // --- logistics ---------------------------------------------------------
  //
  // Priced under the machines they serve. Routing is what makes a factory
  // worth building, and a splitter that costs as much as the furnace it feeds
  // just persuades people to build two furnaces instead.

  {
    // One belt in, three out -- so the recipe is a belt and a junction.
    result: { id: Block.Splitter, count: 1 },
    pattern: [' I ', 'ICI', ' I '],
    key: { I, C },
  },
  {
    // Glass around a copper spine: you can see the cargo travelling.
    result: { id: Block.Tube, count: 8 },
    pattern: ['GGG', 'I I', 'GGG'],
    key: { G: Block.Glass, I },
  },
  {
    result: { id: Block.Filter, count: 1 },
    pattern: ['III', 'CCC', 'III'],
    key: { I, C },
  },
  {
    // Cobble and iron around a furnace: it burns, and burning is what a
    // furnace already knows how to do.
    result: { id: Block.Incinerator, count: 1 },
    pattern: ['CIC', 'CFC', 'CCC'],
    key: { C, I, F: Block.Furnace },
  },
  { result: { id: Item.IronIngot, count: 9 }, shapeless: [Block.IronBlock] },
  {
    result: { id: Block.Bricks, count: 1 },
    pattern: ['CC', 'CC'],
    key: { C },
  },
  ...tools(P, 'P', Item.WoodPickaxe, Item.WoodAxe, Item.WoodShovel),
  ...tools(C, 'C', Item.StonePickaxe, Item.StoneAxe, Item.StoneShovel),
  ...tools(I, 'I', Item.IronPickaxe, Item.IronAxe, Item.IronShovel),
  ...tools(D, 'D', Item.DiamondPickaxe, Item.DiamondAxe, Item.DiamondShovel),
  // --------------------------------------------------------------- vehicles
  // A skateboard is cheap; everything with an engine wants iron, and the
  // aircraft want a diamond on top.
  {
    result: { id: Item.Skateboard, count: 1 },
    pattern: ['PPP', 'I I'],
    key: { P, I },
  },
  {
    result: { id: Item.Car, count: 1 },
    pattern: [' G ', 'III', 'I I'],
    key: { I, G: Block.Glass },
  },
  {
    result: { id: Item.Plane, count: 1 },
    pattern: ['I I', 'IGI', 'IDI'],
    key: { I, G: Block.Glass, D },
  },
  {
    result: { id: Item.Helicopter, count: 1 },
    pattern: ['III', ' G ', 'IDI'],
    key: { I, G: Block.Glass, D },
  },
  {
    result: { id: Item.MiningDrill, count: 1 },
    pattern: [' DI', 'DII', 'I S'],
    key: { D, I, S },
  },

  // Swords: two of the material over a stick.
  { result: { id: Item.WoodSword, count: 1 }, pattern: ['P', 'P', 'S'], key: { P, S } },
  { result: { id: Item.StoneSword, count: 1 }, pattern: ['C', 'C', 'S'], key: { C, S } },
  { result: { id: Item.IronSword, count: 1 }, pattern: ['I', 'I', 'S'], key: { I, S } },
  { result: { id: Item.DiamondSword, count: 1 }, pattern: ['D', 'D', 'S'], key: { D, S } },

  // Coal on a stick: four torches, the first thing worth making.
  { result: { id: Block.Torch, count: 4 }, pattern: ['C', 'S'], key: { C: Item.Coal, S } },

  // Lights a nether portal.
  { result: { id: Item.FlintAndSteel, count: 1 }, shapeless: [I, Item.Coal] },

  // ----------------------------------------------------------------- armour
  ...armorSet(Item.Leather, 'L',
    [Item.LeatherHelmet, Item.LeatherChestplate, Item.LeatherLeggings, Item.LeatherBoots]),
  ...armorSet(I, 'I',
    [Item.IronHelmet, Item.IronChestplate, Item.IronLeggings, Item.IronBoots]),
  ...armorSet(D, 'D',
    [Item.DiamondHelmet, Item.DiamondChestplate, Item.DiamondLeggings, Item.DiamondBoots]),

  // The ending: blaze powder plus an ender pearl makes an eye of ender.
  { result: { id: Item.BlazePowder, count: 2 }, shapeless: [Item.BlazeRod] },
  {
    result: { id: Item.EyeOfEnder, count: 1 },
    shapeless: [Item.BlazePowder, Item.EnderPearl],
  },
];

/** A crafting grid: `width * height` cells, null where empty. */
export interface Grid {
  width: number;
  height: number;
  cells: Array<number | null>;
}

interface Trimmed {
  width: number;
  height: number;
  cells: Array<number | null>;
}

/** Crops empty rows and columns so a recipe can sit anywhere in the grid. */
function trim(grid: Grid): Trimmed | null {
  let minX = grid.width;
  let maxX = -1;
  let minY = grid.height;
  let maxY = -1;

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.cells[y * grid.width + x] === null) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cells: Array<number | null> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push(grid.cells[(y + minY) * grid.width + (x + minX)]);
    }
  }
  return { width, height, cells };
}

function patternToTrimmed(recipe: Recipe): Trimmed {
  const pattern = recipe.pattern!;
  const width = Math.max(...pattern.map((row) => row.length));
  const cells: Array<number | null> = [];
  for (const row of pattern) {
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? ' ';
      cells.push(ch === ' ' ? null : recipe.key![ch] ?? null);
    }
  }
  return { width, height: pattern.length, cells };
}

function matchesShaped(recipe: Recipe, trimmed: Trimmed): boolean {
  const want = patternToTrimmed(recipe);
  if (want.width !== trimmed.width || want.height !== trimmed.height) return false;
  return want.cells.every((cell, i) => cell === trimmed.cells[i]);
}

function matchesShapeless(recipe: Recipe, grid: Grid): boolean {
  const have = grid.cells.filter((c): c is number => c !== null).sort((a, b) => a - b);
  const want = [...recipe.shapeless!].sort((a, b) => a - b);
  return have.length === want.length && have.every((id, i) => id === want[i]);
}

/** The recipe a grid currently satisfies, if any. */
export function findRecipe(grid: Grid): Recipe | null {
  const trimmed = trim(grid);
  if (!trimmed) return null;

  for (const recipe of RECIPES) {
    if (recipe.shapeless) {
      if (matchesShapeless(recipe, grid)) return recipe;
    } else if (recipe.pattern) {
      if (trimmed.width > grid.width || trimmed.height > grid.height) continue;
      if (matchesShaped(recipe, trimmed)) return recipe;
    }
  }
  return null;
}

/** Total count of each ingredient a recipe consumes. */
export function recipeIngredients(recipe: Recipe): Map<number, number> {
  const needed = new Map<number, number>();
  const add = (id: number) => needed.set(id, (needed.get(id) ?? 0) + 1);

  if (recipe.shapeless) {
    for (const id of recipe.shapeless) add(id);
  } else if (recipe.pattern && recipe.key) {
    for (const row of recipe.pattern) {
      for (const ch of row) {
        if (ch === ' ') continue;
        const id = recipe.key[ch];
        if (id !== undefined) add(id);
      }
    }
  }
  return needed;
}

/** Where each ingredient sits, as offsets within the recipe's own bounding box. */
export function recipeLayout(recipe: Recipe): {
  width: number;
  height: number;
  cells: Array<number | null>;
} {
  if (recipe.pattern && recipe.key) return patternToTrimmed(recipe);
  // Shapeless recipes get packed left to right; any arrangement works.
  const ids = recipe.shapeless ?? [];
  const width = Math.min(3, Math.max(1, ids.length));
  const height = Math.ceil(ids.length / width);
  const cells: Array<number | null> = new Array(width * height).fill(null);
  ids.forEach((id, i) => { cells[i] = id; });
  return { width, height, cells };
}

/** Can this recipe be made from the given item counts? */
export function canCraft(recipe: Recipe, have: Map<number, number>): boolean {
  for (const [id, count] of recipeIngredients(recipe)) {
    if ((have.get(id) ?? 0) < count) return false;
  }
  return true;
}

/** Every recipe that fits within a grid of this size, for a recipe book UI. */
export function recipesForGrid(width: number, height: number): Recipe[] {
  return RECIPES.filter((recipe) => {
    if (recipe.shapeless) return recipe.shapeless.length <= width * height;
    const want = patternToTrimmed(recipe);
    return want.width <= width && want.height <= height;
  });
}
