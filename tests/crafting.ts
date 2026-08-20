/** Inventory, recipe and mining-rule checks. Run: npx tsx tests/crafting.ts */

import { Block } from '../shared/src/blocks.js';
import { Inventory, transfer, type Slots } from '../shared/src/inventory.js';
import {
  Item, armorSpec, blockDrop, breakTime, canHarvest, damageAfterArmor, smeltResult,
} from '../shared/src/items.js';
import { findRecipe, type Grid } from '../shared/src/recipes.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

/** Builds a grid from rows of ids, using null for empty. */
function grid(width: number, height: number, cells: Array<number | null>): Grid {
  return { width, height, cells };
}

const _ = null;

// --- shapeless -------------------------------------------------------------
const planks = findRecipe(grid(2, 2, [Block.Log, _, _, _]));
check('log makes planks', planks?.result.id === Block.Planks && planks.result.count === 4);

// --- shaped, anywhere in the grid -----------------------------------------
const sticksTopLeft = findRecipe(grid(2, 2, [Block.Planks, _, Block.Planks, _]));
check('planks stacked make sticks',
  sticksTopLeft?.result.id === Item.Stick && sticksTopLeft.result.count === 4);

const sticksShifted = findRecipe(grid(2, 2, [_, Block.Planks, _, Block.Planks]));
check('recipe matches when shifted in the grid', sticksShifted?.result.id === Item.Stick);

const table = findRecipe(grid(2, 2, [Block.Planks, Block.Planks, Block.Planks, Block.Planks]));
check('2x2 planks make a crafting table', table?.result.id === Block.CraftingTable);

// --- 3x3 only ---------------------------------------------------------------
const C = Block.Cobblestone;
const furnaceCells = [C, C, C, C, _, C, C, C, C];
check('furnace needs a 3x3 grid', findRecipe(grid(2, 2, [C, C, C, C]))?.result.id !== Block.Furnace);
check('furnace crafts on a table',
  findRecipe(grid(3, 3, furnaceCells))?.result.id === Block.Furnace);

const P = Block.Planks;
const S = Item.Stick;
const pick = findRecipe(grid(3, 3, [P, P, P, _, S, _, _, S, _]));
check('wooden pickaxe recipe', pick?.result.id === Item.WoodPickaxe);

const axe = findRecipe(grid(3, 3, [P, P, _, P, S, _, _, S, _]));
check('wooden axe recipe', axe?.result.id === Item.WoodAxe);

check('a wrong arrangement makes nothing',
  findRecipe(grid(3, 3, [P, _, P, _, S, _, _, S, _])) === null);

// --- ending recipe ----------------------------------------------------------
const powder = findRecipe(grid(2, 2, [Item.BlazeRod, _, _, _]));
check('blaze rod makes blaze powder', powder?.result.id === Item.BlazePowder);
const eye = findRecipe(grid(2, 2, [Item.BlazePowder, Item.EnderPearl, _, _]));
check('blaze powder + ender pearl makes an eye of ender',
  eye?.result.id === Item.EyeOfEnder);

// --- inventory --------------------------------------------------------------
const inv = new Inventory();
check('add returns nothing left over', inv.add(Block.Dirt, 10) === 0);
check('count tracks the stack', inv.countOf(Block.Dirt) === 10);

inv.add(Block.Dirt, 60);
check('overflow rolls into a second stack', inv.countOf(Block.Dirt) === 70);
check('first stack caps at 64', inv.get(0)?.count === 64);

check('remove takes across stacks', inv.remove(Block.Dirt, 68) === 68);
check('remainder is correct', inv.countOf(Block.Dirt) === 2);

const full = new Inventory(1);
check('a full inventory reports leftovers', full.add(Block.Stone, 100) === 36,
  `slot holds ${full.get(0)?.count}`);

const small = new Inventory(2);
small.add(Item.WoodPickaxe, 1);
check('tools do not stack', small.get(0)?.count === 1 && small.get(1) === null);

// --- transfer ---------------------------------------------------------------
const from: Slots = [{ id: Block.Stone, count: 20 }];
const to: Slots = [{ id: Block.Stone, count: 10 }];
transfer(from, 0, to, 0);
check('transfer merges matching stacks', to[0]?.count === 30 && from[0] === null);

const swapA: Slots = [{ id: Block.Stone, count: 5 }];
const swapB: Slots = [{ id: Block.Dirt, count: 3 }];
transfer(swapA, 0, swapB, 0);
check('transfer swaps different items',
  swapA[0]?.id === Block.Dirt && swapB[0]?.id === Block.Stone);

const partial: Slots = [{ id: Block.Sand, count: 10 }];
const target: Slots = [null];
transfer(partial, 0, target, 0, 4);
check('partial transfer splits a stack',
  target[0]?.count === 4 && partial[0]?.count === 6);

// --- mining rules -----------------------------------------------------------
const byHand = breakTime(Block.Stone, null);
const byWood = breakTime(Block.Stone, Item.WoodPickaxe);
const byDiamond = breakTime(Block.Stone, Item.DiamondPickaxe);
check('tools speed up mining', byWood < byHand && byDiamond < byWood,
  `hand ${byHand.toFixed(2)}s, wood ${byWood.toFixed(2)}s, diamond ${byDiamond.toFixed(2)}s`);

check('wrong tool is no faster than hand',
  breakTime(Block.Stone, Item.WoodShovel) >= byHand);

check('bedrock never breaks', breakTime(Block.Bedrock, Item.DiamondPickaxe) === Infinity);

check('bare hands do not harvest stone', !canHarvest(Block.Stone, null));
check('a wooden pickaxe harvests stone', canHarvest(Block.Stone, Item.WoodPickaxe));
check('diamond ore needs iron or better',
  !canHarvest(Block.DiamondOre, Item.StonePickaxe) &&
  canHarvest(Block.DiamondOre, Item.IronPickaxe));
check('obsidian needs diamond',
  !canHarvest(Block.Obsidian, Item.IronPickaxe) &&
  canHarvest(Block.Obsidian, Item.DiamondPickaxe));

// --- drops and smelting -----------------------------------------------------
check('stone drops cobblestone', blockDrop(Block.Stone)?.id === Block.Cobblestone);
check('grass drops dirt', blockDrop(Block.Grass)?.id === Block.Dirt);
check('coal ore drops coal', blockDrop(Block.CoalOre)?.id === Item.Coal);
check('leaves drop nothing', blockDrop(Block.Leaves) === null);

check('iron ore smelts to an ingot', smeltResult(Block.IronOre)?.id === Item.IronIngot);
check('sand smelts to glass', smeltResult(Block.Sand)?.id === Block.Glass);
check('dirt does not smelt', smeltResult(Block.Dirt) === null);

// --- armour -----------------------------------------------------------------
const L = Item.Leather;
check('leather helmet recipe',
  findRecipe(grid(3, 3, [L, L, L, L, _, L, _, _, _]))?.result.id === Item.LeatherHelmet);
check('iron chestplate recipe',
  findRecipe(grid(3, 3, [Item.IronIngot, _, Item.IronIngot,
    Item.IronIngot, Item.IronIngot, Item.IronIngot,
    Item.IronIngot, Item.IronIngot, Item.IronIngot]))?.result.id === Item.IronChestplate);
check('diamond boots recipe',
  findRecipe(grid(2, 2, [Item.Diamond, Item.Diamond, Item.Diamond, Item.Diamond]))
    ?.result.id !== Item.DiamondBoots,
  'a filled 2x2 is not boots');
check('boots need the gap',
  findRecipe(grid(3, 3, [_, _, _, Item.Diamond, _, Item.Diamond, Item.Diamond, _, Item.Diamond]))
    ?.result.id === Item.DiamondBoots);

check('armour pieces know their slot',
  armorSpec(Item.IronHelmet)?.slot === 'head' &&
  armorSpec(Item.IronBoots)?.slot === 'feet');
check('tools are not armour', armorSpec(Item.IronPickaxe) === undefined);

check('armour reduces damage',
  damageAfterArmor(10, 0) === 10 && damageAfterArmor(10, 10) < 10);
check('a full diamond set is strong but not immune',
  damageAfterArmor(10, 20) > 0 && damageAfterArmor(10, 20) <= 2.1,
  `${damageAfterArmor(10, 20).toFixed(2)} of 10 damage taken`);
check('reduction is capped', Math.abs(damageAfterArmor(10, 999) - 2) < 1e-9,
  `${damageAfterArmor(10, 999)} damage at absurd armour`);

const geared = new Inventory();
geared.equipment[0] = { id: Item.DiamondHelmet, count: 1 };
geared.equipment[1] = { id: Item.DiamondChestplate, count: 1 };
geared.equipment[2] = { id: Item.DiamondLeggings, count: 1 };
geared.equipment[3] = { id: Item.DiamondBoots, count: 1 };
geared.equipment[4] = { id: Block.Planks, count: 64 }; // offhand
check('a full diamond set totals 20 points',
  geared.defense((id) => armorSpec(id)?.defense ?? 0) === 20,
  `${geared.defense((id) => armorSpec(id)?.defense ?? 0)} points`);
check('the offhand does not count as armour', geared.offhand?.id === Block.Planks);

const round = Inventory.fromJSON(geared.toJSON());
check('equipment survives a save round trip',
  round.equipment[1]?.id === Item.DiamondChestplate && round.offhand?.id === Block.Planks);

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} failed`}`);
process.exit(failures ? 1 : 0);
