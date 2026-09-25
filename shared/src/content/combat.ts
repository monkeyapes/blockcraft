/**
 * The combat pack. Bows and arrows, hammers, buckets, TNT and the bounce pad
 * -- and the spike trap, the one block here that fights on its own.
 *
 * Block and item ids are fixed in blockids.ts / itemids.ts; this file
 * defines what they are. See types.ts for every field a pack can set.
 *
 * Behaviour -- arrows in flight, a bow's draw, the blast, the hammer's wide
 * swing, sand falling -- lives in client/src/content/combat.ts. This file is
 * data: what each thing is, how it is shaped and how it is made.
 */

import { Block } from '../blockids.js';
import { Item } from '../itemids.js';
import { px, slab, type Box, type ShapeEntry } from '../shapekit.js';
import type { Recipe } from '../recipes.js';
import type { BlockSpec, ContentPack, ItemSpec } from './types.js';

// --- tuning ------------------------------------------------------------------

/**
 * How much of a landing speed the bounce pad hands back. Below 1 so every
 * bounce is lower than the last and a player who lets go settles; high
 * enough that dropping onto one from a roof puts you most of the way back.
 */
export const BOUNCE_PAD_BOUNCE = 0.85;

/** Height of the bounce pad's cushion, and of what you stand on. */
export const BOUNCE_PAD_HEIGHT = 12 / 16;

/** Damage per second from standing in a spike trap. */
export const SPIKE_DAMAGE = 4;

/**
 * Hammers against the pickaxe of the same material. A hammer clears nine
 * blocks a swing, so it has to be slower per block or it would simply be
 * the better pickaxe; it wears out twice as slowly because it is twice the
 * metal.
 */
export const HAMMERS: ReadonlyArray<{
  id: Item; name: string; texture: string; material: number;
  tier: number; speed: number; durability: number; attack: number;
}> = [
  {
    id: Item.StoneHammer, name: 'Stone Hammer', texture: 'hammer_stone', material: Block.Cobblestone,
    tier: 2, speed: 3, durability: 264, attack: 6,
  },
  {
    id: Item.IronHammer, name: 'Iron Hammer', texture: 'hammer_iron', material: Item.IronIngot,
    tier: 3, speed: 4.5, durability: 502, attack: 7,
  },
  {
    id: Item.DiamondHammer, name: 'Diamond Hammer', texture: 'hammer_diamond', material: Item.Diamond,
    tier: 4, speed: 6, durability: 3124, attack: 8,
  },
];

// --- shapes ----------------------------------------------------------------

/**
 * The bounce pad: an iron base plate, four coil springs, and a gel cushion
 * on top. The springs are what make it read as "this throws you" from across
 * a room -- a green slab on its own is just a green slab.
 *
 * It is drawn and collided as different things. The body stands on the
 * cushion's top at 12/16, a plain slab, so landing on it is as predictable as
 * landing on any slab; the springs are only something to look at.
 */
const BOUNCE_PAD_SHAPE: ShapeEntry = {
  visual: [
    px(0, 0, 0, 16, 3, 16, ['bounce_pad_bottom', 'bounce_pad_bottom', 'bounce_pad_side']),
    px(2, 3, 2, 5, 9, 5, 'bounce_pad_spring'),
    px(11, 3, 2, 14, 9, 5, 'bounce_pad_spring'),
    px(2, 3, 11, 5, 9, 14, 'bounce_pad_spring'),
    px(11, 3, 11, 14, 9, 14, 'bounce_pad_spring'),
    px(0, 9, 0, 16, 12, 16, ['bounce_pad_top', 'bounce_pad_top', 'bounce_pad_side']),
  ],
  collision: slab(BOUNCE_PAD_HEIGHT),
  selection: slab(BOUNCE_PAD_HEIGHT),
};

/**
 * One spike: four stacked boxes narrowing to a point, centred at (cx, cz).
 * Four steps rather than three because three read as a stack of posts; the
 * last step is half a sixteenth wide, which is as close to a point as boxes
 * get.
 */
function spike(cx: number, cz: number, height: number): Box[] {
  const widths = [4, 2.75, 1.5, 0.5];
  const step = height / widths.length;
  return widths.map((w, i) =>
    px(cx - w / 2, 1 + step * i, cz - w / 2, cx + w / 2, 1 + step * (i + 1), cz + w / 2));
}

/**
 * Spikes: a floor plate with five stepped points standing out of it, the
 * middle one tallest. A flat "spiky" texture on a slab reads as carpet; the
 * silhouette is what says "do not step here".
 *
 * There is nothing to collide with -- you walk into a spike trap, not onto
 * it, which is what lets it hurt you -- but the cursor still gets a box.
 */
const SPIKES_SHAPE: ShapeEntry = {
  visual: [
    px(0, 0, 0, 16, 1, 16, 'spikes_plate'),
    ...spike(4, 4, 9), ...spike(12, 4, 9), ...spike(4, 12, 9), ...spike(12, 12, 9),
    ...spike(8, 8, 12),
  ],
  collision: [],
  selection: [px(1, 0, 1, 15, 12, 15)],
};

// --- blocks -------------------------------------------------------------------

const BLOCKS: BlockSpec[] = [
  {
    // Soft to mine: breaking a charge by hand is how you defuse a trap.
    id: Block.TNT, name: 'TNT', textures: ['tnt_top', 'tnt_bottom', 'tnt_side'],
    hardness: 0.2, category: 'redstone',
  },
  {
    id: Block.BouncePad, name: 'Bounce Pad',
    textures: ['bounce_pad_top', 'bounce_pad_bottom', 'bounce_pad_side'],
    opaque: false, hardness: 1, tool: 'pickaxe', bounce: BOUNCE_PAD_BOUNCE, category: 'redstone',
  },
  {
    id: Block.IronSpikes, name: 'Iron Spikes', textures: 'spikes',
    solid: false, opaque: false, hardness: 2, tool: 'pickaxe', tier: 1,
    contactDamage: SPIKE_DAMAGE, speedFactor: 0.45, category: 'combat',
  },
];

// --- items ------------------------------------------------------------------

const ITEMS: ItemSpec[] = [
  { id: Item.Bow, name: 'Bow', texture: 'bow', stackSize: 1, category: 'combat' },
  { id: Item.Arrow, name: 'Arrow', texture: 'arrow', category: 'combat' },
  ...HAMMERS.map((h): ItemSpec => ({
    id: h.id, name: h.name, texture: h.texture, attack: h.attack, category: 'tools',
    tool: { kind: 'hammer', actsAs: 'pickaxe', tier: h.tier, speed: h.speed, durability: h.durability },
  })),
  { id: Item.Bucket, name: 'Bucket', texture: 'bucket', stackSize: 16, category: 'tools' },
  { id: Item.WaterBucket, name: 'Water Bucket', texture: 'bucket_water', stackSize: 1, category: 'tools' },
  { id: Item.LavaBucket, name: 'Lava Bucket', texture: 'bucket_lava', stackSize: 1, category: 'tools' },
];

// --- recipes ------------------------------------------------------------------

const S = Item.Stick;

const RECIPES: Recipe[] = [
  // A curved stave of sticks strung along one side.
  { result: { id: Item.Bow, count: 1 }, pattern: [' ST', 'S T', ' ST'], key: { S, T: Item.String } },
  // Tip, shaft, flight, top to bottom: the recipe is a picture of the arrow.
  {
    result: { id: Item.Arrow, count: 4 }, pattern: ['C', 'S', 'F'],
    key: { C: Item.CopperIngot, S, F: Item.Feather },
  },
  // A heavy head -- a pickaxe's bar with two cheeks -- on a two-stick haft.
  ...HAMMERS.map((h): Recipe => ({
    result: { id: h.id, count: 1 }, pattern: ['MMM', 'MSM', ' S '], key: { M: h.material, S },
  })),
  // Three ingots in a V, the shape of the thing itself.
  { result: { id: Item.Bucket, count: 1 }, pattern: ['I I', ' I '], key: { I: Item.IronIngot } },
  // Powder packed in sand, alternating, so no two charges touch.
  {
    result: { id: Block.TNT, count: 1 }, pattern: ['PSP', 'SPS', 'PSP'],
    key: { P: Item.FusePowder, S: Block.Sand },
  },
  // Gel on an iron spring over a plank base.
  {
    result: { id: Block.BouncePad, count: 2 }, pattern: ['GGG', 'PIP'],
    key: { G: Item.Slimeball, P: Block.Planks, I: Item.IronIngot },
  },
  // Points up out of a plate.
  {
    result: { id: Block.IronSpikes, count: 4 }, pattern: ['I I', 'III'],
    key: { I: Item.IronIngot },
  },
];

export const COMBAT: ContentPack = {
  name: 'combat',
  blocks: BLOCKS,
  items: ITEMS,
  shapes: [
    [Block.BouncePad, BOUNCE_PAD_SHAPE],
    [Block.IronSpikes, SPIKES_SHAPE],
  ],
  recipes: RECIPES,
  smelting: [],
  fuel: [],
  transitions: [],
};
