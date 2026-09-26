/**
 * Block registry.
 *
 * Face order used by the mesher: 0=+Y, 1=-Y, 2=+Z, 3=-Z, 4=+X, 5=-X.
 * Texture names here are resolved against the procedurally built atlas.
 */

export { Block } from './blockids.js';
import { Block } from './blockids.js';

import type { ToolKind } from './items.js';
import { PACKS } from './content/index.js';
import type { BlockSpec, CreativeTab, DropFn } from './content/types.js';

export interface BlockDef {
  id: Block;
  name: string;
  /** Atlas tile names per face: [top, bottom, side]. */
  textures: [string, string, string];
  /** Blocks player movement. */
  solid: boolean;
  /** Hides the faces of neighbouring blocks. */
  opaque: boolean;
  /** Rendered in the blended pass. */
  translucent: boolean;
  liquid: boolean;
  breakable: boolean;
  /** 0-15, drives the emissive term in the shader. */
  light: number;
  /** Relative time to break, 1 = dirt. 0 means instant. */
  hardness: number;
  /** What the block drops when broken; defaults to itself. */
  drop?: Block;
  /** A drop roll, for chance and multiple items. Wins over `drop`. */
  drops?: DropFn;
  /** The tool class that mines it quickly; unset falls back to the table in items.ts. */
  tool?: ToolKind;
  /** Tool tier needed for it to drop anything; unset falls back likewise. */
  tier?: number;
  /** Placing a block into this cell simply overwrites it. */
  replaceable: boolean;
  /** States of one thing, swappable in place. See content/types.ts. */
  family?: string;
  slipperiness: number;
  speedFactor: number;
  bounce: number;
  contactDamage: number;
  climbable: boolean;
  category?: CreativeTab;
  icon?: string;
}

const defs: BlockDef[] = [];

type DefOpts = Partial<Omit<BlockDef, 'id' | 'name' | 'textures'>>;

function def(
  id: Block,
  name: string,
  textures: string | [string, string, string],
  opts: DefOpts = {},
): void {
  const tex: [string, string, string] =
    typeof textures === 'string' ? [textures, textures, textures] : textures;
  defs[id] = {
    id,
    name,
    textures: tex,
    solid: opts.solid ?? true,
    opaque: opts.opaque ?? true,
    translucent: opts.translucent ?? false,
    liquid: opts.liquid ?? false,
    breakable: opts.breakable ?? true,
    light: opts.light ?? 0,
    hardness: opts.hardness ?? 1,
    drop: opts.drop,
    drops: opts.drops,
    tool: opts.tool,
    tier: opts.tier,
    replaceable: opts.replaceable ?? false,
    family: opts.family,
    slipperiness: opts.slipperiness ?? 0,
    speedFactor: opts.speedFactor ?? 1,
    bounce: opts.bounce ?? 0,
    contactDamage: opts.contactDamage ?? 0,
    climbable: opts.climbable ?? false,
    category: opts.category,
    icon: opts.icon,
  };
}

def(Block.Air, 'Air', 'stone', { solid: false, opaque: false, breakable: false, hardness: 0 });
def(Block.Grass, 'Grass Block', ['grass_top', 'dirt', 'grass_side'], { drop: Block.Dirt });
def(Block.Dirt, 'Dirt', 'dirt');
def(Block.Stone, 'Stone', 'stone', { hardness: 3, drop: Block.Cobblestone });
def(Block.Cobblestone, 'Cobblestone', 'cobble', { hardness: 3 });
def(Block.Sand, 'Sand', 'sand', { hardness: 0.8 });
def(Block.Gravel, 'Gravel', 'gravel', { hardness: 0.9 });
def(Block.Bedrock, 'Bedrock', 'bedrock', { breakable: false });
def(Block.Log, 'Log', ['log_top', 'log_top', 'log_side'], { hardness: 2 });
// Shears are the leaf tool; the tier stays 0, so bare hands still clear them.
def(Block.Leaves, 'Leaves', 'leaves', { hardness: 0.3, tool: 'shears' });
def(Block.Planks, 'Planks', 'planks', { hardness: 2 });
def(Block.Bricks, 'Bricks', 'brick', { hardness: 3 });
def(Block.Glass, 'Glass', 'glass', { opaque: false, translucent: true, hardness: 0.5 });
def(Block.Water, 'Water', 'water', {
  solid: false, opaque: false, translucent: true, liquid: true, breakable: false, hardness: 0,
});
def(Block.Glowstone, 'Glowstone', 'glowstone', { light: 15, hardness: 0.6 });
// The inventory shows the flat torch sprite: the placed model is a thin stick
// that would be a speck at icon size.
def(Block.Torch, 'Torch', 'torch', {
  solid: false, opaque: false, translucent: true, light: 14, hardness: 0, icon: 'torch',
});
def(Block.CoalOre, 'Coal Ore', 'coal_ore', { hardness: 3 });
def(Block.IronOre, 'Iron Ore', 'iron_ore', { hardness: 4 });
def(Block.GoldOre, 'Gold Ore', 'gold_ore', { hardness: 4 });
def(Block.DiamondOre, 'Diamond Ore', 'diamond_ore', { hardness: 5 });
def(Block.IronBlock, 'Block of Iron', 'iron_block', { hardness: 5 });
def(Block.CraftingTable, 'Crafting Table', ['crafting_top', 'planks', 'crafting_side'], { hardness: 2 });
def(Block.Furnace, 'Furnace', ['furnace_top', 'furnace_top', 'furnace_front'], { hardness: 3 });
def(Block.Conveyor, 'Conveyor Belt', ['conveyor', 'iron_block', 'iron_block'], { hardness: 1 });
def(Block.Sorter, 'Item Sorter', ['sorter', 'iron_block', 'iron_block'], { hardness: 1 });
def(Block.Cable, 'NoVolt Conduit', 'cable', { hardness: 1 });

// Machines. Conveyors drop the plain item so the four facings never show up
// separately in an inventory.
for (const [id, tex] of [
  [Block.ConveyorNorth, 'conveyor_n'], [Block.ConveyorEast, 'conveyor_e'],
  [Block.ConveyorSouth, 'conveyor_s'], [Block.ConveyorWest, 'conveyor_w'],
] as const) {
  def(id, 'Conveyor Belt', [tex, 'iron_block', 'iron_block'],
    { hardness: 1, drop: Block.Conveyor });
}
// Opaque false: the building pack gives the chest an inset lidded model, and
// an opaque partial block would cull its neighbours' faces into holes.
def(Block.Chest, 'Chest', ['chest_top', 'chest_top', 'chest_side'], { hardness: 2, opaque: false });
// A ladder is climbed, not stood on, so it must not be solid or opaque --
// the climbing itself is handled in the player's vertical movement.
def(Block.Ladder, 'Ladder', 'ladder', {
  solid: false, opaque: false, translucent: true, hardness: 0.4, climbable: true,
});
// Solid since the building pack gave it a real 9/16 frame: you can stand on a
// bed, and walking through one looked like a rendering bug.
def(Block.Bed, 'Bed', ['bed_top', 'planks', 'bed_side'], {
  opaque: false, translucent: true, hardness: 0.4,
});
def(Block.Collector, 'Collector', ['collector_top', 'iron_block', 'collector_side'],
  { hardness: 2 });
def(Block.Miner, 'Miner', ['miner_top', 'iron_block', 'miner_side'], { hardness: 3 });
def(Block.Generator, 'Generator', ['generator_top', 'iron_block', 'generator_side'],
  { hardness: 3 });
def(Block.Crusher, 'Crusher', ['crusher_top', 'iron_block', 'crusher_side'], { hardness: 3 });
def(Block.SolarPanel, 'Solar Panel', ['solar_top', 'iron_block', 'solar_side'],
  { hardness: 2 });
def(Block.Battery, 'Battery', ['battery_top', 'iron_block', 'battery_side'],
  { hardness: 2 });
def(Block.Elevator, 'Item Elevator', ['elevator_top', 'iron_block', 'elevator_side'],
  { solid: false, opaque: false, translucent: true, hardness: 2 });
def(Block.Booster, 'NoVolt Booster', ['booster_top', 'iron_block', 'booster_side'],
  { hardness: 2, light: 4 });
def(Block.StoneGenerator, 'Stone Generator',
  ['stonegen_top', 'iron_block', 'stonegen_side'], { hardness: 3 });
def(Block.ElectricFurnace, 'Electric Furnace',
  ['efurnace_top', 'iron_block', 'efurnace_side'], { hardness: 3, light: 3 });
def(Block.Sawmill, 'Sawmill', ['sawmill_top', 'iron_block', 'sawmill_side'],
  { hardness: 3 });
def(Block.Compressor, 'Compressor', ['compressor_top', 'iron_block', 'compressor_side'],
  { hardness: 3 });
def(Block.Quarry, 'Quarry', ['quarry_top', 'iron_block', 'quarry_side'],
  { hardness: 4 });
def(Block.WaterWheel, 'Water Wheel', ['waterwheel_top', 'planks', 'waterwheel_side'],
  { hardness: 2 });

// --- logistics -----------------------------------------------------------
//
// None of these are full cubes; see shared/src/shapes.ts. They are the pieces
// that turn a conveyor loop into something that routes.

def(Block.Splitter, 'Splitter', ['splitter_top', 'iron_block', 'splitter_side'],
  { hardness: 1, opaque: false });
def(Block.Tube, 'Item Tube', 'tube', { hardness: 1, opaque: false, solid: true });
def(Block.Filter, 'Line Filter', ['filter_top', 'iron_block', 'filter_side'],
  { hardness: 1, opaque: false });
def(Block.Incinerator, 'Incinerator', ['incinerator_top', 'iron_block', 'incinerator_side'],
  { hardness: 1 });
def(Block.Netherrack, 'Netherrack', 'netherrack', { hardness: 0.7 });
def(Block.SoulSand, 'Soul Sand', 'soul_sand', { hardness: 1, speedFactor: 0.55 });
def(Block.Lava, 'Lava', 'lava', {
  solid: false, opaque: false, translucent: true, liquid: true, breakable: false,
  light: 15, hardness: 0,
});
def(Block.Obsidian, 'Obsidian', 'obsidian', { hardness: 12 });
def(Block.NetherPortal, 'Nether Portal', 'portal', {
  solid: false, opaque: false, translucent: true, breakable: false, light: 11, hardness: 0,
});
def(Block.NetherBricks, 'Nether Bricks', 'nether_brick', { hardness: 3 });
def(Block.Quartz, 'Quartz Block', 'quartz', { hardness: 2 });
def(Block.EndStone, 'End Stone', 'end_stone', { hardness: 3 });
def(Block.EndPortalFrame, 'End Portal Frame', ['end_frame_top', 'end_stone', 'end_frame_side'], {
  breakable: false, light: 1,
});
def(Block.EndPortal, 'End Portal', 'end_portal', {
  solid: false, opaque: false, translucent: true, breakable: false, light: 15, hardness: 0,
});
def(Block.EndPortalFrameFilled, 'End Portal Frame', ['end_frame_eye', 'end_stone', 'end_frame_side'], {
  breakable: false, light: 6,
});
def(Block.Purpur, 'Purpur Block', 'purpur', { hardness: 3 });

// --- content packs -------------------------------------------------------

/** Which pack defined each id, so a clash can name both sides. */
const definedBy = new Map<number, string>();
for (const d of defs) if (d) definedBy.set(d.id, 'blocks.ts');

/** One-way in-place changes, keyed `from:to`. */
const transitions = new Set<string>();

for (const pack of PACKS) {
  for (const spec of pack.blocks ?? []) {
    const clash = definedBy.get(spec.id);
    if (clash) {
      throw new Error(`block ${spec.id} (${spec.name}) is defined by both ${clash} and the ${pack.name} pack`);
    }
    if (spec.id <= 0 || spec.id >= 256) {
      throw new Error(`block ${spec.name} has id ${spec.id}; chunks store blocks in one byte`);
    }
    definedBy.set(spec.id, `the ${pack.name} pack`);
    const { id, name, textures, ...opts } = spec as BlockSpec;
    def(id as Block, name, textures, opts as DefOpts);
  }
  for (const [from, to] of pack.transitions ?? []) transitions.add(`${from}:${to}`);
}

export const BLOCKS: readonly BlockDef[] = defs;

export function blockDef(id: Block | number): BlockDef {
  return defs[id] ?? defs[Block.Air];
}

/** True for ids with a definition; an unknown id reads as air everywhere else. */
export function isKnownBlock(id: number): boolean {
  return id === Block.Air || (defs[id] !== undefined && id > 0 && id < 256);
}

export function isOpaque(id: number): boolean {
  return defs[id]?.opaque ?? false;
}

export function isSolid(id: number): boolean {
  return defs[id]?.solid ?? false;
}

export function isLiquid(id: number): boolean {
  return defs[id]?.liquid ?? false;
}

/** Placing into this cell is allowed: air, a liquid, or something replaceable. */
export function isReplaceable(id: number): boolean {
  if (id === Block.Air) return true;
  const d = defs[id];
  return !!d && (d.liquid || d.replaceable);
}

/**
 * May a player turn the block at a cell from `current` into `next`?
 *
 * The one rule both the server and the single-player link enforce, so what
 * is legal cannot drift between them. Four cases:
 *
 *  - placing: into air, a liquid, or a replaceable block
 *  - breaking: to air, if the block is breakable -- or scooping up a liquid
 *  - a state change within a family: a door opening, a crop growing
 *  - a one-way change some pack declared: dirt tilled into farmland
 */
export function canReplace(current: number, next: number): boolean {
  if (!isKnownBlock(next)) return false;
  if (current === next) return false;
  if (next === Block.Air) {
    const d = blockDef(current);
    return d.breakable || d.liquid;
  }
  if (isReplaceable(current)) return true;
  const family = defs[current]?.family;
  if (family && defs[next]?.family === family) return true;
  return transitions.has(`${current}:${next}`);
}

/** Every distinct atlas tile the registry references, in a stable order. */
export function allTextureNames(): string[] {
  const seen = new Set<string>();
  for (const d of defs) {
    if (!d) continue;
    for (const t of d.textures) seen.add(t);
    if (d.icon) seen.add(d.icon);
  }
  return [...seen].sort();
}
