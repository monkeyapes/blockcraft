/**
 * The creatures pack. What the new mobs drop and need: bones, string,
 * slimeballs, fuse powder, fish, rabbit, shears and cobwebs.
 *
 * Block and item ids are fixed in blockids.ts / itemids.ts; this file
 * defines what they are. See types.ts for every field a pack can set. The
 * mobs themselves are in shared/src/mobs.ts, and what shears and bones do
 * to them is client/src/content/creatures.ts.
 */

import { Block } from '../blockids.js';
import { Item } from '../itemids.js';
import { px } from '../shapekit.js';
import type { BlockSpec, ContentPack, ItemSpec } from './types.js';

/** Blades that cut a web free in one piece instead of tearing it apart. */
const WEB_CUTTERS: ReadonlySet<number> = new Set([
  Item.Shears,
  Item.WoodSword, Item.StoneSword, Item.IronSword, Item.DiamondSword,
]);

/** Movement multiplier inside a web: a crawl, but never a trap you cannot leave. */
export const COBWEB_SLOWDOWN = 0.15;

const BLOCKS: BlockSpec[] = [
  {
    id: Block.Cobweb, name: 'Cobweb', textures: 'cobweb',
    // Not solid: you walk into a web, which is what makes it dangerous.
    solid: false, opaque: false, hardness: 4, tool: 'shears',
    speedFactor: COBWEB_SLOWDOWN,
    // Fists tear a web to nothing; a blade cuts the silk free.
    drops: (_random, tool) => (tool !== null && WEB_CUTTERS.has(tool)
      ? [{ id: Item.String, count: 1 }]
      : []),
    category: 'decoration',
  },
];

const ITEMS: ItemSpec[] = [
  { id: Item.Bone, name: 'Bone', texture: 'bone_item', category: 'materials' },
  { id: Item.String, name: 'String', texture: 'string', category: 'materials' },
  { id: Item.Slimeball, name: 'Slimeball', texture: 'slimeball', category: 'materials' },
  { id: Item.FusePowder, name: 'Fuse Powder', texture: 'fuse_powder', category: 'materials' },
  { id: Item.RawFish, name: 'Raw Fish', texture: 'raw_fish', food: 2, category: 'food' },
  { id: Item.CookedFish, name: 'Cooked Fish', texture: 'cooked_fish', food: 5, category: 'food' },
  { id: Item.RawRabbit, name: 'Raw Rabbit', texture: 'raw_rabbit', food: 2, category: 'food' },
  { id: Item.CookedRabbit, name: 'Cooked Rabbit', texture: 'cooked_rabbit', food: 5, category: 'food' },
  {
    id: Item.Shears, name: 'Shears', texture: 'shears', stackSize: 1,
    // Tier 0: shears harvest nothing a pickaxe would; they are simply fast
    // on what they are for -- leaves, wool and webs.
    tool: { kind: 'shears', tier: 0, speed: 6, durability: 238 },
    category: 'tools',
  },
];

export const CREATURES: ContentPack = {
  name: 'creatures',
  blocks: BLOCKS,
  items: ITEMS,
  shapes: [
    // Drawn as two crossed sheets of silk across the whole cell, but picked
    // by the whole cell: a web is aimed at, not threaded through.
    [Block.Cobweb, { cross: { height: 1, inset: 0 }, selection: [px(0, 0, 0, 16, 16, 16)] }],
  ],
  recipes: [
    { result: { id: Item.Shears, count: 1 }, pattern: [' I', 'I '], key: { I: Item.IronIngot } },
  ],
  smelting: [
    { from: Item.RawFish, to: Item.CookedFish },
    { from: Item.RawRabbit, to: Item.CookedRabbit },
  ],
  fuel: [],
  transitions: [],
};
