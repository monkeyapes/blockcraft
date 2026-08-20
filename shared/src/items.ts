/**
 * Item registry.
 *
 * Ids below ITEM_ID_BASE are block ids, so any block is directly an item that
 * places itself. Ids at or above it are pure items: sticks, ingots, tools,
 * and later the blaze rods and ender pearls the ending needs.
 */

import { Block, blockDef } from './blocks.js';

export const ITEM_ID_BASE = 128;

export enum Item {
  Stick = 128,
  Coal = 129,
  IronIngot = 130,
  GoldIngot = 131,
  Diamond = 132,

  WoodPickaxe = 140,
  StonePickaxe = 141,
  IronPickaxe = 142,
  DiamondPickaxe = 143,
  WoodAxe = 144,
  StoneAxe = 145,
  IronAxe = 146,
  DiamondAxe = 147,
  WoodShovel = 148,
  StoneShovel = 149,
  IronShovel = 150,
  DiamondShovel = 151,
  MiningDrill = 152,
  FlintAndSteel = 153,

  Skateboard = 170,
  Car = 171,
  Plane = 172,
  Helicopter = 173,
  Boat = 174,
  Truck = 175,

  // Reserved for the ending; recipes land with the dimensions work.
  BlazeRod = 160,
  BlazePowder = 161,
  EnderPearl = 162,
  EyeOfEnder = 163,

  LeatherHelmet = 180,
  LeatherChestplate = 181,
  LeatherLeggings = 182,
  LeatherBoots = 183,
  IronHelmet = 184,
  IronChestplate = 185,
  IronLeggings = 186,
  IronBoots = 187,
  DiamondHelmet = 188,
  DiamondChestplate = 189,
  DiamondLeggings = 190,
  DiamondBoots = 191,

  Leather = 195,
  Feather = 196,

  WoodSword = 200,
  StoneSword = 201,
  IronSword = 202,
  DiamondSword = 203,

  RawPorkchop = 210,
  CookedPorkchop = 211,
  RawBeef = 212,
  Steak = 213,
  RawMutton = 214,
  CookedMutton = 215,
  RawChicken = 216,
  CookedChicken = 217,
}

/** Equipment slots, in the order they appear in the inventory. */
export type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet';
export const ARMOR_SLOTS: readonly ArmorSlot[] = ['head', 'chest', 'legs', 'feet'];

export interface ArmorSpec {
  slot: ArmorSlot;
  /** Armour points; 20 is the practical maximum across a full set. */
  defense: number;
  durability: number;
}

export type ToolKind = 'pickaxe' | 'axe' | 'shovel';

export interface ToolSpec {
  kind: ToolKind;
  /** 0 hand, 1 wood, 2 stone, 3 iron, 4 diamond, 5 drill. */
  tier: number;
  /** Mining speed multiplier against matching blocks. */
  speed: number;
  durability: number;
  /** Counts as the right tool for every block. The drill does. */
  universal?: boolean;
}

/** Vehicles are items you place into the world and then ride. */
export type VehicleKind =
  'skateboard' | 'car' | 'plane' | 'helicopter' | 'boat' | 'truck';

const VEHICLE_ITEMS: Partial<Record<number, VehicleKind>> = {
  [Item.Skateboard]: 'skateboard',
  [Item.Car]: 'car',
  [Item.Plane]: 'plane',
  [Item.Helicopter]: 'helicopter',
  [Item.Boat]: 'boat',
  [Item.Truck]: 'truck',
};

export function vehicleKind(id: number): VehicleKind | null {
  return VEHICLE_ITEMS[id] ?? null;
}

export function vehicleItem(kind: VehicleKind): Item {
  switch (kind) {
    case 'skateboard': return Item.Skateboard;
    case 'car': return Item.Car;
    case 'plane': return Item.Plane;
    case 'helicopter': return Item.Helicopter;
    case 'boat': return Item.Boat;
    case 'truck': return Item.Truck;
  }
}

export interface ItemDef {
  id: number;
  name: string;
  /** Atlas tile used for the icon and the held-item model. */
  texture: string;
  stackSize: number;
  tool?: ToolSpec;
  armor?: ArmorSpec;
  /** Damage dealt to mobs. Bare hands do 1. */
  attack?: number;
  /** Health restored when eaten. */
  food?: number;
}

const itemDefs = new Map<number, ItemDef>();

function item(
  id: Item, name: string, texture: string,
  opts: {
    stackSize?: number; tool?: ToolSpec; armor?: ArmorSpec;
    attack?: number; food?: number;
  } = {},
): void {
  itemDefs.set(id, {
    id, name, texture,
    stackSize: opts.stackSize ?? (opts.tool || opts.armor ? 1 : 64),
    tool: opts.tool,
    armor: opts.armor,
    attack: opts.attack,
    food: opts.food,
  });
}

item(Item.Stick, 'Stick', 'stick');
item(Item.Coal, 'Coal', 'coal');
item(Item.IronIngot, 'Iron Ingot', 'iron_ingot');
item(Item.GoldIngot, 'Gold Ingot', 'gold_ingot');
item(Item.Diamond, 'Diamond', 'diamond');

const TIERS: Array<[string, string, number, number, number]> = [
  // label, texture suffix, tier, speed, durability
  ['Wooden', 'wood', 1, 2, 60],
  ['Stone', 'stone', 2, 4, 132],
  ['Iron', 'iron', 3, 6, 251],
  ['Diamond', 'diamond', 4, 8, 1562],
];

const KINDS: Array<[ToolKind, string, Item[]]> = [
  ['pickaxe', 'Pickaxe',
    [Item.WoodPickaxe, Item.StonePickaxe, Item.IronPickaxe, Item.DiamondPickaxe]],
  ['axe', 'Axe',
    [Item.WoodAxe, Item.StoneAxe, Item.IronAxe, Item.DiamondAxe]],
  ['shovel', 'Shovel',
    [Item.WoodShovel, Item.StoneShovel, Item.IronShovel, Item.DiamondShovel]],
];

for (const [kind, kindLabel, ids] of KINDS) {
  TIERS.forEach(([label, texSuffix, tier, speed, durability], i) => {
    item(ids[i], `${label} ${kindLabel}`, `${kind}_${texSuffix}`, {
      tool: { kind, tier, speed, durability },
    });
  });
}

item(Item.MiningDrill, 'Mining Drill', 'drill', {
  tool: { kind: 'pickaxe', tier: 5, speed: 24, durability: 3000, universal: true },
});

item(Item.FlintAndSteel, 'Flint and Steel', 'flint_steel', { stackSize: 1 });
item(Item.Leather, 'Leather', 'leather');
item(Item.Feather, 'Feather', 'feather');

// Swords: the tool tiers again, but for fighting rather than mining.
const SWORDS: Array<[Item, string, string, number]> = [
  [Item.WoodSword, 'Wooden', 'wood', 4],
  [Item.StoneSword, 'Stone', 'stone', 5],
  [Item.IronSword, 'Iron', 'iron', 6],
  [Item.DiamondSword, 'Diamond', 'diamond', 8],
];
for (const [id, label, tex, attack] of SWORDS) {
  item(id, `${label} Sword`, `sword_${tex}`, { stackSize: 1, attack });
}

// Food. Cooking roughly doubles what a piece restores.
const FOODS: Array<[Item, string, string, number]> = [
  [Item.RawPorkchop, 'Raw Porkchop', 'raw_porkchop', 2],
  [Item.CookedPorkchop, 'Cooked Porkchop', 'cooked_porkchop', 6],
  [Item.RawBeef, 'Raw Beef', 'raw_beef', 2],
  [Item.Steak, 'Steak', 'steak', 6],
  [Item.RawMutton, 'Raw Mutton', 'raw_mutton', 2],
  [Item.CookedMutton, 'Cooked Mutton', 'cooked_mutton', 5],
  [Item.RawChicken, 'Raw Chicken', 'raw_chicken', 1],
  [Item.CookedChicken, 'Cooked Chicken', 'cooked_chicken', 5],
];
for (const [id, name, tex, food] of FOODS) {
  item(id, name, tex, { food });
}

// Armour: four pieces per material. Defense is split so a full set of a tier
// lands on a round total (leather 7, iron 15, diamond 20).
const ARMOR_TIERS: Array<{
  label: string;
  tex: string;
  durability: number;
  pieces: [Item, Item, Item, Item];
  /** head, chest, legs, feet */
  defense: [number, number, number, number];
}> = [
  {
    label: 'Leather', tex: 'leather', durability: 80,
    pieces: [Item.LeatherHelmet, Item.LeatherChestplate, Item.LeatherLeggings, Item.LeatherBoots],
    defense: [1, 3, 2, 1],
  },
  {
    label: 'Iron', tex: 'iron', durability: 240,
    pieces: [Item.IronHelmet, Item.IronChestplate, Item.IronLeggings, Item.IronBoots],
    defense: [2, 6, 5, 2],
  },
  {
    label: 'Diamond', tex: 'diamond', durability: 528,
    pieces: [Item.DiamondHelmet, Item.DiamondChestplate, Item.DiamondLeggings, Item.DiamondBoots],
    defense: [3, 8, 6, 3],
  },
];

const PIECE_NAMES: Record<ArmorSlot, string> = {
  head: 'Helmet', chest: 'Chestplate', legs: 'Leggings', feet: 'Boots',
};

for (const tier of ARMOR_TIERS) {
  ARMOR_SLOTS.forEach((slot, i) => {
    item(tier.pieces[i], `${tier.label} ${PIECE_NAMES[slot]}`, `armor_${slot}_${tier.tex}`, {
      armor: { slot, defense: tier.defense[i], durability: tier.durability },
    });
  });
}

item(Item.Skateboard, 'Skateboard', 'skateboard', { stackSize: 1 });
item(Item.Car, 'Car', 'car', { stackSize: 1 });
item(Item.Boat, 'Boat', 'boat', { stackSize: 1 });
item(Item.Truck, 'Truck', 'truck', { stackSize: 1 });
item(Item.Plane, 'Plane', 'plane', { stackSize: 1 });
item(Item.Helicopter, 'Helicopter', 'helicopter', { stackSize: 1 });

item(Item.BlazeRod, 'Blaze Rod', 'blaze_rod');
item(Item.BlazePowder, 'Blaze Powder', 'blaze_powder');
item(Item.EnderPearl, 'Ender Pearl', 'ender_pearl');
item(Item.EyeOfEnder, 'Eye of Ender', 'eye_of_ender');

/** Atlas tiles referenced by pure items, in a stable order. */
export function allItemTextureNames(): string[] {
  return [...new Set([...itemDefs.values()].map((d) => d.texture))].sort();
}

export function isBlockItem(id: number): boolean {
  return id > 0 && id < ITEM_ID_BASE;
}

export function itemDef(id: number): ItemDef {
  const existing = itemDefs.get(id);
  if (existing) return existing;
  // Blocks double as items that place themselves.
  const block = blockDef(id);
  return {
    id,
    name: block.name,
    texture: block.textures[2],
    stackSize: 64,
  };
}

export function itemName(id: number): string {
  return itemDef(id).name;
}

export function stackSize(id: number): number {
  return itemDef(id).stackSize;
}

export function toolSpec(id: number): ToolSpec | undefined {
  return itemDef(id).tool;
}

export function armorSpec(id: number): ArmorSpec | undefined {
  return itemDef(id).armor;
}

/** Damage a held item deals to a mob. Bare hands, blocks and tools all hit. */
export function attackDamage(heldItem: number | null): number {
  if (heldItem === null) return 1;
  const def = itemDef(heldItem);
  if (def.attack) return def.attack;
  // Tools are better than fists, but a sword is the right answer.
  if (def.tool) return def.tool.kind === 'axe' ? 3 : 2;
  return 1;
}

export function foodValue(id: number): number {
  return itemDef(id).food ?? 0;
}

export function isFood(id: number): boolean {
  return foodValue(id) > 0;
}

/** Cooking a raw food in a furnace. */
export function cookedForm(id: number): number | null {
  switch (id) {
    case Item.RawPorkchop: return Item.CookedPorkchop;
    case Item.RawBeef: return Item.Steak;
    case Item.RawMutton: return Item.CookedMutton;
    case Item.RawChicken: return Item.CookedChicken;
    default: return null;
  }
}

/**
 * Damage multiplier from a set of armour points.
 *
 * Caps at 80% reduction, so a full diamond set makes you tough rather than
 * invulnerable.
 */
export function damageAfterArmor(damage: number, defense: number): number {
  const reduction = Math.min(0.8, Math.max(0, defense) * 0.04);
  return damage * (1 - reduction);
}

/** Which tool class is effective against a block. */
export function preferredTool(block: Block): ToolKind | null {
  switch (block) {
    case Block.Stone:
    case Block.Cobblestone:
    case Block.CoalOre:
    case Block.IronOre:
    case Block.GoldOre:
    case Block.DiamondOre:
    case Block.IronBlock:
    case Block.Bricks:
    case Block.Furnace:
    case Block.Obsidian:
    case Block.Netherrack:
    case Block.NetherBricks:
    case Block.Quartz:
    case Block.EndStone:
    case Block.Purpur:
      return 'pickaxe';
    case Block.Log:
    case Block.Planks:
    case Block.CraftingTable:
      return 'axe';
    case Block.Dirt:
    case Block.Grass:
    case Block.Sand:
    case Block.Gravel:
    case Block.SoulSand:
      return 'shovel';
    default:
      return null;
  }
}

/** Minimum tool tier required for a block to drop anything at all. */
export function requiredTier(block: Block): number {
  switch (block) {
    case Block.Obsidian:
      return 4;
    case Block.DiamondOre:
    case Block.GoldOre:
      return 3;
    case Block.IronOre:
      return 2;
    case Block.Stone:
    case Block.Cobblestone:
    case Block.CoalOre:
    case Block.IronBlock:
    case Block.Bricks:
    case Block.Furnace:
      return 1;
    default:
      return 0;
  }
}

/**
 * Seconds to break a block with the given held item.
 * Roughly Minecraft's shape: hardness scaled by tool speed, with a stiff
 * penalty for using the wrong tool.
 */
export function breakTime(block: Block, heldItem: number | null): number {
  const def = blockDef(block);
  if (!def.breakable) return Infinity;
  if (def.hardness <= 0) return 0;

  const tool = heldItem === null ? undefined : toolSpec(heldItem);
  const wanted = preferredTool(block);
  const correct = !!tool && (tool.universal || (wanted !== null && tool.kind === wanted));
  const speed = correct ? tool.speed : 1;

  const base = (def.hardness * 1.5) / speed;
  // Mining without the right tool is possible but slow, and drops nothing.
  const penalty = canHarvest(block, heldItem) ? 1 : 5;
  return Math.max(0.05, base * penalty);
}

/**
 * Does this held item let the block drop its item?
 *
 * The tier gate only counts for the *matching* tool kind: a wooden shovel is
 * tier 1, but it still shouldn't harvest stone.
 */
export function canHarvest(block: Block, heldItem: number | null): boolean {
  const needed = requiredTier(block);
  if (needed === 0) return true;
  const tool = heldItem === null ? undefined : toolSpec(heldItem);
  if (!tool) return false;
  if (!tool.universal && tool.kind !== preferredTool(block)) return false;
  return tool.tier >= needed;
}

/** What a broken block yields. */
export function blockDrop(block: Block): { id: number; count: number } | null {
  switch (block) {
    case Block.Grass:
      return { id: Block.Dirt, count: 1 };
    case Block.Stone:
      return { id: Block.Cobblestone, count: 1 };
    case Block.CoalOre:
      return { id: Item.Coal, count: 1 };
    case Block.DiamondOre:
      return { id: Item.Diamond, count: 1 };
    case Block.Leaves:
      return null; // leaves crumble away
    case Block.Air:
    case Block.Water:
    case Block.Lava:
      return null;
    default:
      return { id: block, count: 1 };
  }
}

/** Furnace smelting results. */
export function smeltResult(id: number): { id: number; count: number } | null {
  const cooked = cookedForm(id);
  if (cooked !== null) return { id: cooked, count: 1 };
  switch (id) {
    case Block.IronOre:
      return { id: Item.IronIngot, count: 1 };
    case Block.GoldOre:
      return { id: Item.GoldIngot, count: 1 };
    case Block.Cobblestone:
      return { id: Block.Stone, count: 1 };
    case Block.Sand:
      return { id: Block.Glass, count: 1 };
    case Block.Log:
      return { id: Item.Coal, count: 1 }; // charcoal, near enough
    default:
      return null;
  }
}

/** How many items a fuel smelts. */
export function fuelValue(id: number): number {
  switch (id) {
    case Item.Coal:
      return 8;
    case Block.Planks:
      return 1.5;
    case Block.Log:
      return 1.5;
    case Item.Stick:
      return 0.5;
    default:
      return 0;
  }
}
