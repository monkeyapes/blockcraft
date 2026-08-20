/**
 * Block registry.
 *
 * Face order used by the mesher: 0=+Y, 1=-Y, 2=+Z, 3=-Z, 4=+X, 5=-X.
 * Texture names here are resolved against the procedurally built atlas.
 */

export enum Block {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Cobblestone = 4,
  Sand = 5,
  Gravel = 6,
  Bedrock = 7,
  Log = 8,
  Leaves = 9,
  Planks = 10,
  Bricks = 11,
  Glass = 12,
  Water = 13,
  Glowstone = 14,
  CoalOre = 15,
  IronOre = 16,
  GoldOre = 17,
  DiamondOre = 18,
  IronBlock = 19,
  CraftingTable = 20,
  Furnace = 21,
  Conveyor = 22,
  Sorter = 23,
  Cable = 24,
  Netherrack = 25,
  SoulSand = 26,
  Lava = 27,
  Obsidian = 28,
  NetherPortal = 29,
  NetherBricks = 30,
  Quartz = 31,
  EndStone = 32,
  EndPortalFrame = 33,
  EndPortal = 34,
  Purpur = 35,
  EndPortalFrameFilled = 36,
  Torch = 37,

  /*
   * Placed conveyors carry a facing.
   *
   * A chunk is a flat Uint8Array with no room for per-block metadata, so
   * direction has to live in the block id itself. Placement picks the
   * variant from where the player is looking, and all four drop the plain
   * Conveyor item, so the split is invisible in the inventory.
   */
  ConveyorNorth = 38,
  ConveyorEast = 39,
  ConveyorSouth = 40,
  ConveyorWest = 41,

  Chest = 42,
  Collector = 43,
  Miner = 44,
  Ladder = 45,
  Bed = 46,
  Generator = 47,
  Crusher = 48,
  SolarPanel = 49,
  Battery = 50,
  Elevator = 51,
  Booster = 52,

  /* NoVolt consumers, and one more renewable source. */
  StoneGenerator = 53,
  ElectricFurnace = 54,
  Sawmill = 55,
  Compressor = 56,
  Quarry = 57,
  WaterWheel = 58,
  // Logistics. Conveyors move items along the floor; these decide where the
  // items go, which is the difference between a belt and a factory.
  Splitter = 59,
  Tube = 60,
  Filter = 61,
  Incinerator = 62,
}

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
}

const defs: BlockDef[] = [];

function def(
  id: Block,
  name: string,
  textures: string | [string, string, string],
  opts: Partial<Omit<BlockDef, 'id' | 'name' | 'textures'>> = {},
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
def(Block.Leaves, 'Leaves', 'leaves', { hardness: 0.3 });
def(Block.Planks, 'Planks', 'planks', { hardness: 2 });
def(Block.Bricks, 'Bricks', 'brick', { hardness: 3 });
def(Block.Glass, 'Glass', 'glass', { opaque: false, translucent: true, hardness: 0.5 });
def(Block.Water, 'Water', 'water', {
  solid: false, opaque: false, translucent: true, liquid: true, breakable: false, hardness: 0,
});
def(Block.Glowstone, 'Glowstone', 'glowstone', { light: 15, hardness: 0.6 });
def(Block.Torch, 'Torch', 'torch', {
  solid: false, opaque: false, translucent: true, light: 14, hardness: 0,
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
def(Block.Chest, 'Chest', ['chest_top', 'chest_top', 'chest_side'], { hardness: 2 });
// A ladder is climbed, not stood on, so it must not be solid or opaque --
// the climbing itself is handled in the player's vertical movement.
def(Block.Ladder, 'Ladder', 'ladder', {
  solid: false, opaque: false, translucent: true, hardness: 0.4,
});
def(Block.Bed, 'Bed', ['bed_top', 'planks', 'bed_side'], {
  solid: false, opaque: false, translucent: true, hardness: 0.4,
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
def(Block.SoulSand, 'Soul Sand', 'soul_sand', { hardness: 1 });
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

export const BLOCKS: readonly BlockDef[] = defs;

export function blockDef(id: Block | number): BlockDef {
  return defs[id] ?? defs[Block.Air];
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

/** Every distinct atlas tile the registry references, in a stable order. */
export function allTextureNames(): string[] {
  const seen = new Set<string>();
  for (const d of defs) {
    if (!d) continue;
    for (const t of d.textures) seen.add(t);
  }
  return [...seen].sort();
}
