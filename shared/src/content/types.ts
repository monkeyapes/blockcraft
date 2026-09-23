/**
 * What a content pack is made of.
 *
 * A pack is one area of the game -- nature, building, farming, combat,
 * creatures -- described as data: its blocks, items, shapes, recipes,
 * smelting and fuel. The registries (blocks.ts, items.ts, shapes.ts,
 * recipes.ts) load every pack, so adding a block means editing one pack file
 * and nothing else.
 *
 * Packs import values only from the id files (blockids.ts, itemids.ts) and
 * the shape kit, and *types* from anywhere. Importing a registry as a value
 * from a pack would be an import cycle -- the registry loads the pack -- and
 * a cycle here fails quietly, with enum members reading as undefined.
 */

import type { ArmorSpec, ToolKind, ToolSpec } from '../items.js';
import type { Recipe } from '../recipes.js';
import type { ShapeEntry } from '../shapekit.js';

/** Which creative-menu tab lists a block or item. Omit to leave it out. */
export type CreativeTab =
  'building' | 'nature' | 'tools' | 'combat' | 'food' | 'farming' |
  'machines' | 'transport' | 'materials' | 'redstone' | 'decoration';

/** A drop roll: `random` returns 0..1, the tool is whatever broke the block. */
export type DropFn = (random: () => number, tool: number | null) => Array<{ id: number; count: number }>;

export interface BlockSpec {
  id: number;
  name: string;
  /** One tile for every face, or [top, bottom, side]. */
  textures: string | [string, string, string];
  /** Blocks movement. Default true. */
  solid?: boolean;
  /** Hides neighbouring faces. Default true -- set false for any partial shape. */
  opaque?: boolean;
  /** Drawn in the blended pass. Default false. */
  translucent?: boolean;
  liquid?: boolean;
  breakable?: boolean;
  /** 0-15. */
  light?: number;
  /** Relative break time, 1 = dirt. */
  hardness?: number;

  /** What breaking it gives, when it is not simply itself. */
  drop?: number;
  /** A drop roll, for anything with chance or more than one item. Wins over `drop`. */
  drops?: DropFn;
  /** The tool class that mines it quickly. */
  tool?: ToolKind;
  /** The tool tier needed for it to drop anything at all. */
  tier?: number;

  /**
   * Placing a block here simply overwrites this one -- tall grass, a snow
   * layer. Without it a meadow is a field of blocks you have to clear by
   * hand before you can build.
   */
  replaceable?: boolean;
  /**
   * Blocks in the same family are states of one thing -- a door open and
   * shut, a crop at each stage -- and may be swapped in place. The server
   * refuses any other in-place change, so a family is what lets a door open
   * in multiplayer at all.
   */
  family?: string;

  /** Ice: 0 is ordinary grip, towards 1 is frictionless. */
  slipperiness?: number;
  /** Speed multiplier while standing on or in it: soul sand, cobweb. */
  speedFactor?: number;
  /** Landing on it throws you back up with this fraction of your fall speed. */
  bounce?: number;
  /** Damage per second while touching it: cactus. */
  contactDamage?: number;
  /** Climbed like a ladder. */
  climbable?: boolean;

  /** Where it appears in the creative menu. */
  category?: CreativeTab;
  /** Icon, when the side texture would not read as the block. */
  icon?: string;
}

export interface ItemSpec {
  id: number;
  name: string;
  /** Atlas tile for the icon and the held model. */
  texture: string;
  stackSize?: number;
  tool?: ToolSpec;
  armor?: ArmorSpec;
  /** Melee damage. */
  attack?: number;
  /** Health restored when eaten. */
  food?: number;
  /**
   * Placing the item puts this block down -- seeds plant a crop, a door item
   * a door. The pack's placement hook can refine or refuse it.
   */
  places?: number;
  category?: CreativeTab;
}

export interface SmeltSpec {
  from: number;
  to: number;
  count?: number;
}

export interface ContentPack {
  name: string;
  blocks?: BlockSpec[];
  items?: ItemSpec[];
  /** Shapes, by block id; one entry may cover several ids. */
  shapes?: Array<[number | number[], ShapeEntry]>;
  recipes?: Recipe[];
  smelting?: SmeltSpec[];
  fuel?: Array<{ id: number; value: number }>;
  /**
   * One-way in-place changes the server should accept, as [from, to]:
   * tilling dirt into farmland, a sapling becoming a trunk, two slabs
   * becoming a full block. Families cover the two-way ones.
   */
  transitions?: Array<[number, number]>;
}
