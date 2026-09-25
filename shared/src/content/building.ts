/**
 * The building pack. Slabs, stairs, fences, walls, panes, doors, trapdoors, lanterns, wool, storage blocks: everything with a shape that is not a cube.
 *
 * Block and item ids are fixed in blockids.ts / itemids.ts; this file
 * defines what they are. See types.ts for every field a pack can set.
 *
 * Behaviour -- which facing a stair takes, a door opening, two slabs
 * merging -- lives in client/src/content/building.ts. This file is data:
 * what each block is, how it is shaped, and how it is made.
 */

import { Block } from '../blockids.js';
import { Item } from '../itemids.js';
import {
  EAST, NORTH, WEST, px, rotateBoxes, slab,
  type Around, type Box, type ShapeEntry,
} from '../shapekit.js';
import type { Recipe } from '../recipes.js';
import type { BlockSpec, ContentPack, ItemSpec } from './types.js';

// --- neighbour rules ----------------------------------------------------------

/**
 * Legacy blocks that fill their cell and are solid: what a fence or pane
 * reaches toward when nothing better is known.
 *
 * A pack may not import the block registry as a value (it would be an import
 * cycle -- the registry loads the pack), so a shape function cannot simply
 * ask "is this a full solid block?". This list answers for the blocks that
 * existed before the packs, and the client module swaps in the real
 * registry-backed test at load via `connectRules`, which also covers every
 * other pack's blocks.
 */
const LEGACY_FULL = new Set<number>([
  Block.Grass, Block.Dirt, Block.Stone, Block.Cobblestone, Block.Sand, Block.Gravel,
  Block.Bedrock, Block.Log, Block.Leaves, Block.Planks, Block.Bricks, Block.Glass,
  Block.Glowstone, Block.CoalOre, Block.IronOre, Block.GoldOre, Block.DiamondOre,
  Block.IronBlock, Block.CraftingTable, Block.Furnace, Block.Netherrack, Block.SoulSand,
  Block.Obsidian, Block.NetherBricks, Block.Quartz, Block.EndStone, Block.Purpur,
]);

/** This pack's own full cubes. */
const OWN_FULL = new Set<number>([
  Block.StoneBricks, Block.MossyStoneBricks, Block.CrackedStoneBricks, Block.Bookshelf,
  Block.CoalBlock, Block.GoldBlock, Block.DiamondBlock, Block.CopperBlock, Block.RubyBlock,
  Block.WhiteWool, Block.RedWool, Block.BlueWool, Block.YellowWool, Block.GreenWool,
  Block.BlackWool, Block.Terracotta,
]);

/**
 * What connecting shapes treat as a wall to join. Replaced by the client
 * module with a test against the live registry; see LEGACY_FULL for why.
 */
export const connectRules = {
  fullBlock: (id: number): boolean => LEGACY_FULL.has(id) || OWN_FULL.has(id),
};

// --- shapes -----------------------------------------------------------------

/** The four horizontal directions in facing order, as [dx, dz]. */
const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Which of the four sides pass a test, in facing order. */
function sides(around: Around, joins: (id: number, facing: number) => boolean): boolean[] {
  return DIRS.map(([dx, dz], facing) => joins(around(dx, 0, dz), facing));
}

/** Boxes authored reaching north, repeated toward every connected side. */
function toward(connected: boolean[], north: Box[]): Box[] {
  const out: Box[] = [];
  connected.forEach((on, facing) => { if (on) out.push(...rotateBoxes(north, facing)); });
  return out;
}

export const GATES_X = [Block.FenceGateX, Block.FenceGateXOpen];
export const GATES_Z = [Block.FenceGateZ, Block.FenceGateZOpen];

/**
 * A gate joins whatever sits at its two ends. A gate running along x has its
 * ends east and west, so only a neighbour lying east or west of it sees it.
 */
function gateLinesUp(id: number, facing: number): boolean {
  const alongX = facing === EAST || facing === WEST;
  return alongX ? GATES_X.includes(id) : GATES_Z.includes(id);
}

export const PANES = [Block.GlassPane, Block.IronBars];

const fenceJoins = (id: number, facing: number) =>
  id === Block.PlankFence || gateLinesUp(id, facing) || connectRules.fullBlock(id);
const wallJoins = (id: number, facing: number) =>
  id === Block.CobblestoneWall || gateLinesUp(id, facing) || connectRules.fullBlock(id);
const paneJoins = (id: number) =>
  PANES.includes(id) || id === Block.CobblestoneWall || connectRules.fullBlock(id);

/**
 * Fences are drawn one block tall but collide at one and a half, so nothing
 * hops a pen -- not the animals inside it and not the player. The cursor
 * follows the drawn post and rails, so aiming past a fence reaches what is
 * behind it.
 */
export const FENCE_COLLISION_HEIGHT = 24;

const FENCE: ShapeEntry = {
  visual: (around) => [
    px(6, 0, 6, 10, 16, 10),
    ...toward(sides(around, fenceJoins), [px(7, 6, 0, 9, 9, 6), px(7, 12, 0, 9, 15, 6)]),
  ],
  collision: (around) => [
    px(6, 0, 6, 10, FENCE_COLLISION_HEIGHT, 10),
    ...toward(sides(around, fenceJoins), [px(6, 0, 0, 10, FENCE_COLLISION_HEIGHT, 6)]),
  ],
  selection: (around) => [
    px(6, 0, 6, 10, 16, 10),
    ...toward(sides(around, fenceJoins), [px(7, 6, 0, 9, 15, 6)]),
  ],
};

/**
 * A wall is a chunkier fence of stone. Where it runs straight through with
 * nothing crossing it, the post drops away and it is one continuous run --
 * which is what stops a long wall reading as a row of pillars.
 */
function wallStraight(joined: boolean[]): boolean {
  const [n, e, s, w] = joined;
  return (n && s && !e && !w) || (e && w && !n && !s);
}

const WALL: ShapeEntry = {
  visual: (around) => {
    const joined = sides(around, wallJoins);
    if (wallStraight(joined)) return rotateBoxes([px(5, 0, 0, 11, 14, 16)], joined[0] ? NORTH : EAST);
    return [px(4, 0, 4, 12, 16, 12), ...toward(joined, [px(5, 0, 0, 11, 14, 4)])];
  },
  collision: (around) => {
    const joined = sides(around, wallJoins);
    if (wallStraight(joined)) return rotateBoxes([px(5, 0, 0, 11, 24, 16)], joined[0] ? NORTH : EAST);
    return [px(4, 0, 4, 12, 24, 12), ...toward(joined, [px(5, 0, 0, 11, 24, 4)])];
  },
};

/** Glass panes and iron bars: a thin sheet joining its neighbours. */
const PANE: ShapeEntry = {
  visual: (around) => [
    px(7, 0, 7, 9, 16, 9),
    ...toward(sides(around, paneJoins), [px(7, 0, 0, 9, 16, 7)]),
  ],
};

/**
 * Stairs, authored rising to the north: a bottom slab plus a half-block
 * along the back. The facing is the direction you walk to climb them.
 */
const STAIR_NORTH: Box[] = [px(0, 0, 0, 16, 8, 16), px(0, 8, 0, 16, 16, 8)];

/**
 * A fence gate running along x, closed: a post at each end (starting a
 * little off the ground, like the fence rails it lines up with), two rails
 * and a brace in the middle.
 */
const GATE_CLOSED: Box[] = [
  px(0, 5, 7, 2, 16, 9), px(14, 5, 7, 16, 16, 9),
  px(2, 6, 7, 14, 9, 9), px(2, 12, 7, 14, 15, 9),
  px(6, 9, 7, 10, 12, 9),
];
/** The same gate open: the two leaves swung back against their posts. */
const GATE_OPEN: Box[] = [
  px(0, 5, 7, 2, 16, 9), px(14, 5, 7, 16, 16, 9),
  px(0, 6, 9, 2, 9, 16), px(0, 12, 9, 2, 15, 16), px(0, 9, 13, 2, 12, 15),
  px(14, 6, 9, 16, 9, 16), px(14, 12, 9, 16, 15, 16), px(14, 9, 13, 16, 12, 15),
];
const GATE_COLLISION: Box[] = [px(0, 0, 6, 16, FENCE_COLLISION_HEIGHT, 10)];

/** How thick a door or open trapdoor is, in sixteenths. */
export const PANEL = 3;

/**
 * A door's panel, split front and back so each face can carry its own
 * picture: the handle has to sit on the side away from the hinge seen from
 * either side, and the mesher maps a texture across a face in a fixed
 * direction, so one texture would put it by the hinge on one of the two.
 *
 * Authored for a door on the north edge of its cell, hinged at the west.
 * Opening swings it inward on that hinge until it lies along the west edge.
 */
function doorBoxes(open: boolean, upper: boolean): Box[] {
  const half = upper ? 'upper' : 'lower';
  const outside = `door_wood_${half}`;
  const inside = `door_wood_${half}_in`;
  const mid = PANEL / 2;
  return open
    ? [px(0, 0, 0, mid, 16, 16, inside), px(mid, 0, 0, PANEL, 16, 16, outside)]
    : [px(0, 0, 0, 16, 16, mid, outside), px(0, 0, mid, 16, 16, PANEL, inside)];
}

function doorShape(id: number, facing: number, open: boolean): ShapeEntry {
  const lower = rotateBoxes(doorBoxes(open, false), facing);
  const upper = rotateBoxes(doorBoxes(open, true), facing);
  const panel = rotateBoxes([open ? px(0, 0, 0, PANEL, 16, 16) : px(0, 0, 0, 16, 16, PANEL)], facing);
  return {
    // Which half a cell holds is not stored anywhere: it is the upper half
    // exactly when the same door stands beneath it.
    visual: (around) => (around(0, -1, 0) === id ? upper : lower),
    collision: panel,
    selection: panel,
  };
}

/** A lantern on the floor, or hung beneath a chain or a ceiling. */
const LANTERN: ShapeEntry = {
  visual: (around) => {
    const body = [
      px(5, 0, 5, 11, 7, 11),
      px(6, 7, 6, 10, 9, 10, 'lantern_top'),
    ];
    const hanging = around(0, -1, 0) === Block.Air && around(0, 1, 0) !== Block.Air;
    return hanging
      ? [...body, px(7.5, 9, 6.5, 8.5, 16, 9.5, 'chain')]
      : [...body, px(7.5, 9, 6.5, 8.5, 11, 9.5, 'chain')];
  },
  collision: [px(5, 0, 5, 11, 9, 11)],
  selection: [px(5, 0, 5, 11, 11, 11)],
};

/**
 * A campfire: four logs stacked in a square, embers under them and a cross
 * of flame -- two crossed sheets of a cut-out flame tile, the way a plant
 * is two crossed planes, so the fire reads from every side.
 */
const FLAME: [string, string, string] = ['building_clear', 'building_clear', 'campfire_flame'];
const CAMPFIRE: ShapeEntry = {
  visual: [
    px(1, 0, 1, 15, 3, 5, 'campfire_log'), px(1, 0, 11, 15, 3, 15, 'campfire_log'),
    px(1, 3, 1, 5, 6, 15, 'campfire_log'), px(11, 3, 1, 15, 6, 15, 'campfire_log'),
    px(5, 0, 5, 11, 1, 11, 'campfire_embers'),
    px(2, 1, 7.5, 14, 15, 8.5, FLAME), px(7.5, 1, 2, 8.5, 15, 14, FLAME),
  ],
  collision: [px(0, 0, 0, 16, 6, 16)],
  selection: [px(0, 0, 0, 16, 7, 16)],
};

// --- blocks -----------------------------------------------------------------

/** Every slab, and the full block two of it make. */
export const SLAB_FULL: ReadonlyArray<readonly [number, number]> = [
  [Block.StoneSlab, Block.Stone],
  [Block.CobblestoneSlab, Block.Cobblestone],
  [Block.PlankSlab, Block.Planks],
  [Block.StoneBrickSlab, Block.StoneBricks],
  [Block.SandstoneSlab, Block.Sandstone],
];

/** Each stair material's four facings, north first -- the north one is the item. */
export const STAIRS: ReadonlyArray<readonly [number, number, number, number]> = [
  [Block.PlankStairsN, Block.PlankStairsE, Block.PlankStairsS, Block.PlankStairsW],
  [Block.CobblestoneStairsN, Block.CobblestoneStairsE, Block.CobblestoneStairsS, Block.CobblestoneStairsW],
  [Block.StoneBrickStairsN, Block.StoneBrickStairsE, Block.StoneBrickStairsS, Block.StoneBrickStairsW],
];

export const DOORS_CLOSED = [Block.WoodDoorN, Block.WoodDoorE, Block.WoodDoorS, Block.WoodDoorW];
export const DOORS_OPEN = [Block.WoodDoorNOpen, Block.WoodDoorEOpen, Block.WoodDoorSOpen, Block.WoodDoorWOpen];
export const TRAPDOORS_OPEN = [Block.TrapdoorOpenN, Block.TrapdoorOpenE, Block.TrapdoorOpenS, Block.TrapdoorOpenW];

export const WOOLS: ReadonlyArray<readonly [number, number, string, string]> = [
  [Block.WhiteWool, Block.WhiteCarpet, 'White', 'white'],
  [Block.RedWool, Block.RedCarpet, 'Red', 'red'],
  [Block.BlueWool, Block.BlueCarpet, 'Blue', 'blue'],
  [Block.YellowWool, Block.YellowCarpet, 'Yellow', 'yellow'],
  [Block.GreenWool, Block.GreenCarpet, 'Green', 'green'],
  [Block.BlackWool, Block.BlackCarpet, 'Black', 'black'],
];

type Material = Omit<BlockSpec, 'id' | 'name'>;
const STONE_LIKE: Material = { textures: 'stone', hardness: 3, tool: 'pickaxe', tier: 1 };
const COBBLE_LIKE: Material = { textures: 'cobble', hardness: 3, tool: 'pickaxe', tier: 1 };
const PLANK_LIKE: Material = { textures: 'planks', hardness: 2, tool: 'axe' };
const BRICK_LIKE: Material = { textures: 'stone_bricks', hardness: 3, tool: 'pickaxe', tier: 1 };
const SANDSTONE_LIKE: Material = {
  textures: ['sandstone_top', 'sandstone_bottom', 'sandstone_side'], hardness: 1.2, tool: 'pickaxe', tier: 1,
};

const blocks: BlockSpec[] = [
  { id: Block.StoneBricks, name: 'Stone Bricks', ...BRICK_LIKE, category: 'building' },
  {
    id: Block.MossyStoneBricks, name: 'Mossy Stone Bricks', ...BRICK_LIKE,
    textures: 'stone_bricks_mossy', category: 'building',
  },
  {
    id: Block.CrackedStoneBricks, name: 'Cracked Stone Bricks', ...BRICK_LIKE,
    textures: 'stone_bricks_cracked', category: 'building',
  },

  { id: Block.StoneSlab, name: 'Stone Slab', ...STONE_LIKE, opaque: false, icon: 'icon_slab_stone', category: 'building' },
  { id: Block.CobblestoneSlab, name: 'Cobblestone Slab', ...COBBLE_LIKE, opaque: false, icon: 'icon_slab_cobble', category: 'building' },
  { id: Block.PlankSlab, name: 'Plank Slab', ...PLANK_LIKE, opaque: false, icon: 'icon_slab_planks', category: 'building' },
  { id: Block.StoneBrickSlab, name: 'Stone Brick Slab', ...BRICK_LIKE, opaque: false, icon: 'icon_slab_stone_bricks', category: 'building' },
  { id: Block.SandstoneSlab, name: 'Sandstone Slab', ...SANDSTONE_LIKE, opaque: false, icon: 'icon_slab_sandstone', category: 'building' },

  ...STAIRS.flatMap(([n, e, s, w], i) => {
    const [label, material, icon] = ([
      ['Plank Stairs', PLANK_LIKE, 'icon_stairs_planks'],
      ['Cobblestone Stairs', COBBLE_LIKE, 'icon_stairs_cobble'],
      ['Stone Brick Stairs', BRICK_LIKE, 'icon_stairs_stone_bricks'],
    ] as const)[i];
    // One item per material: only the north facing is listed, and every
    // facing breaks back into it, so the other three never show up loose.
    return [n, e, s, w].map((id): BlockSpec => ({
      id, name: label, ...material, opaque: false, drop: n,
      ...(id === n ? { icon, category: 'building' as const } : {}),
    }));
  }),

  {
    id: Block.PlankFence, name: 'Fence', ...PLANK_LIKE, opaque: false,
    icon: 'icon_fence', category: 'building',
  },
  {
    id: Block.FenceGateX, name: 'Fence Gate', ...PLANK_LIKE, opaque: false, family: 'fence_gate',
    icon: 'icon_fence_gate', category: 'building',
  },
  { id: Block.FenceGateZ, name: 'Fence Gate', ...PLANK_LIKE, opaque: false, family: 'fence_gate', drop: Block.FenceGateX },
  // Open gates are walked straight through.
  {
    id: Block.FenceGateXOpen, name: 'Fence Gate', ...PLANK_LIKE, opaque: false, solid: false,
    family: 'fence_gate', drop: Block.FenceGateX,
  },
  {
    id: Block.FenceGateZOpen, name: 'Fence Gate', ...PLANK_LIKE, opaque: false, solid: false,
    family: 'fence_gate', drop: Block.FenceGateX,
  },
  {
    id: Block.CobblestoneWall, name: 'Cobblestone Wall', ...COBBLE_LIKE, opaque: false,
    icon: 'icon_wall', category: 'building',
  },
  {
    id: Block.GlassPane, name: 'Glass Pane', textures: ['glass_pane_top', 'glass_pane_top', 'glass_pane'],
    opaque: false, translucent: true, hardness: 0.5, icon: 'icon_glass_pane', category: 'building',
  },
  {
    id: Block.IronBars, name: 'Iron Bars', textures: ['iron_bars_top', 'iron_bars_top', 'iron_bars'],
    opaque: false, hardness: 4, tool: 'pickaxe', tier: 1, icon: 'icon_iron_bars', category: 'building',
  },

  // Doors are placed by the door item and break back into it.
  ...[...DOORS_CLOSED, ...DOORS_OPEN].map((id): BlockSpec => ({
    id, name: 'Wooden Door', textures: 'planks', opaque: false, hardness: 2, tool: 'axe',
    family: 'wood_door', drop: Item.WoodDoor,
  })),

  {
    id: Block.Trapdoor, name: 'Trapdoor', textures: 'trapdoor', opaque: false, hardness: 2,
    tool: 'axe', family: 'trapdoor', icon: 'icon_trapdoor', category: 'building',
  },
  ...TRAPDOORS_OPEN.map((id): BlockSpec => ({
    id, name: 'Trapdoor', textures: 'trapdoor', opaque: false, hardness: 2, tool: 'axe',
    family: 'trapdoor', drop: Block.Trapdoor,
  })),

  {
    id: Block.Lantern, name: 'Lantern', textures: ['lantern_top', 'lantern_top', 'lantern'],
    opaque: false, light: 15, hardness: 2, tool: 'pickaxe', icon: 'icon_lantern', category: 'decoration',
  },
  {
    id: Block.Chain, name: 'Chain', textures: 'chain', opaque: false, hardness: 3, tool: 'pickaxe',
    icon: 'icon_chain', category: 'decoration',
  },
  {
    id: Block.Bookshelf, name: 'Bookshelf', textures: ['planks', 'planks', 'bookshelf'],
    hardness: 1.5, tool: 'axe', category: 'decoration',
  },

  // Storage: a material packed nine to a block, for building with and for
  // keeping a hoard in one slot.
  { id: Block.CoalBlock, name: 'Block of Coal', textures: 'coal_block', hardness: 4, tool: 'pickaxe', tier: 1, category: 'building' },
  { id: Block.GoldBlock, name: 'Block of Gold', textures: 'gold_block', hardness: 4, tool: 'pickaxe', tier: 3, category: 'building' },
  { id: Block.DiamondBlock, name: 'Block of Diamond', textures: 'diamond_block', hardness: 5, tool: 'pickaxe', tier: 3, category: 'building' },
  { id: Block.CopperBlock, name: 'Block of Copper', textures: 'copper_block', hardness: 4, tool: 'pickaxe', tier: 2, category: 'building' },
  { id: Block.RubyBlock, name: 'Block of Ruby', textures: 'ruby_block', hardness: 5, tool: 'pickaxe', tier: 3, category: 'building' },

  ...WOOLS.flatMap(([wool, carpet, label, key]): BlockSpec[] => [
    { id: wool, name: `${label} Wool`, textures: `wool_${key}`, hardness: 0.8, tool: 'shears', category: 'building' },
    {
      id: carpet, name: `${label} Carpet`, textures: `wool_${key}`, opaque: false, hardness: 0.1,
      icon: `icon_carpet_${key}`, category: 'decoration',
    },
  ]),

  {
    id: Block.Campfire, name: 'Campfire', textures: 'campfire_log', opaque: false, light: 15,
    hardness: 2, tool: 'axe', contactDamage: 1, icon: 'icon_campfire', category: 'decoration',
  },
  { id: Block.Terracotta, name: 'Terracotta', textures: 'terracotta', hardness: 2, tool: 'pickaxe', tier: 1, category: 'building' },
];

const items: ItemSpec[] = [
  {
    id: Item.WoodDoor, name: 'Wooden Door', texture: 'door_wood_item', stackSize: 16,
    places: Block.WoodDoorN, category: 'building',
  },
];

// --- shapes, by id ------------------------------------------------------------

const shapes: Array<[number | number[], ShapeEntry]> = [
  [SLAB_FULL.map(([s]) => s), { visual: slab(0.5) }],
  ...STAIRS.flatMap((ids) => ids.map((id, facing): [number, ShapeEntry] =>
    [id, { visual: rotateBoxes(STAIR_NORTH, facing) }])),
  [Block.PlankFence, FENCE],
  [Block.CobblestoneWall, WALL],
  [PANES, PANE],
  [Block.FenceGateX, { visual: GATE_CLOSED, collision: GATE_COLLISION }],
  [Block.FenceGateZ, { visual: rotateBoxes(GATE_CLOSED, EAST), collision: rotateBoxes(GATE_COLLISION, EAST) }],
  [Block.FenceGateXOpen, { visual: GATE_OPEN }],
  [Block.FenceGateZOpen, { visual: rotateBoxes(GATE_OPEN, EAST) }],
  ...DOORS_CLOSED.map((id, facing): [number, ShapeEntry] => [id, doorShape(id, facing, false)]),
  ...DOORS_OPEN.map((id, facing): [number, ShapeEntry] => [id, doorShape(id, facing, true)]),
  [Block.Trapdoor, { visual: [px(0, 0, 0, 16, PANEL, 16)] }],
  ...TRAPDOORS_OPEN.map((id, facing): [number, ShapeEntry] =>
    [id, { visual: rotateBoxes([px(0, 0, 0, 16, 16, PANEL)], facing) }]),
  [Block.Lantern, LANTERN],
  [Block.Chain, { visual: [px(6.5, 0, 6.5, 9.5, 16, 9.5)] }],
  [WOOLS.map(([, carpet]) => carpet), { visual: slab(1 / 16) }],
  [Block.Campfire, CAMPFIRE],

  // Older blocks that were cubes only because nothing could say otherwise.
  // A torch is a stick; a chest sits a pixel in from its neighbours so a row
  // of them reads as separate chests; a bed is a low frame, not a cube.
  [Block.Torch, { visual: [px(7, 0, 7, 9, 10, 9)], selection: [px(6, 0, 6, 10, 11, 10)] }],
  [Block.Chest, { visual: [px(1, 0, 1, 15, 14, 15)] }],
  [Block.Bed, { visual: slab(9 / 16) }],
];

// --- recipes ------------------------------------------------------------------

const PLANK_KINDS = [Block.Planks, Block.BirchPlanks, Block.PinePlanks];
const S = Item.Stick;

const slabRecipe = (from: number, to: number): Recipe =>
  ({ result: { id: to, count: 6 }, pattern: ['MMM'], key: { M: from } });
const stairRecipe = (from: number, to: number): Recipe =>
  ({ result: { id: to, count: 4 }, pattern: ['M  ', 'MM ', 'MMM'], key: { M: from } });

/** Nine of a material make a block, and the block breaks back into nine. */
const STORAGE: ReadonlyArray<readonly [number, number]> = [
  [Item.Coal, Block.CoalBlock],
  [Item.GoldIngot, Block.GoldBlock],
  [Item.Diamond, Block.DiamondBlock],
  [Item.CopperIngot, Block.CopperBlock],
  [Item.Ruby, Block.RubyBlock],
];

/** What tints white wool each colour: the flower, or the soot, that stains it. */
const DYES: ReadonlyArray<readonly [number, number]> = [
  [Block.RedWool, Block.Poppy],
  [Block.BlueWool, Block.Cornflower],
  [Block.YellowWool, Block.Dandelion],
  [Block.GreenWool, Block.Cactus],
  [Block.BlackWool, Item.Coal],
];

const recipes: Recipe[] = [
  { result: { id: Block.StoneBricks, count: 4 }, pattern: ['SS', 'SS'], key: { S: Block.Stone } },
  { result: { id: Block.MossyStoneBricks, count: 1 }, shapeless: [Block.StoneBricks, Block.Leaves] },

  slabRecipe(Block.Stone, Block.StoneSlab),
  slabRecipe(Block.Cobblestone, Block.CobblestoneSlab),
  slabRecipe(Block.StoneBricks, Block.StoneBrickSlab),
  slabRecipe(Block.Sandstone, Block.SandstoneSlab),
  stairRecipe(Block.Cobblestone, Block.CobblestoneStairsN),
  stairRecipe(Block.StoneBricks, Block.StoneBrickStairsN),

  // Anything wooden can be made from any kind of plank.
  ...PLANK_KINDS.flatMap((P): Recipe[] => [
    slabRecipe(P, Block.PlankSlab),
    stairRecipe(P, Block.PlankStairsN),
    { result: { id: Block.PlankFence, count: 3 }, pattern: ['PSP', 'PSP'], key: { P, S } },
    { result: { id: Block.FenceGateX, count: 1 }, pattern: ['SPS', 'SPS'], key: { P, S } },
    { result: { id: Item.WoodDoor, count: 3 }, pattern: ['PP', 'PP', 'PP'], key: { P } },
    { result: { id: Block.Trapdoor, count: 2 }, pattern: ['PPP', 'PPP'], key: { P } },
    {
      result: { id: Block.Bookshelf, count: 1 }, pattern: ['PPP', 'RLR', 'PPP'],
      key: { P, R: Block.Reeds, L: Item.Leather },
    },
  ]),

  { result: { id: Block.CobblestoneWall, count: 6 }, pattern: ['CCC', 'CCC'], key: { C: Block.Cobblestone } },
  { result: { id: Block.GlassPane, count: 16 }, pattern: ['GGG', 'GGG'], key: { G: Block.Glass } },
  { result: { id: Block.IronBars, count: 16 }, pattern: ['III', 'III'], key: { I: Item.IronIngot } },
  { result: { id: Block.Chain, count: 4 }, pattern: ['I', 'I'], key: { I: Item.IronIngot } },
  {
    result: { id: Block.Lantern, count: 2 }, pattern: [' I ', 'ITI', ' I '],
    key: { I: Item.IronIngot, T: Block.Torch },
  },
  {
    result: { id: Block.Campfire, count: 1 }, pattern: [' S ', 'SCS', 'LLL'],
    key: { S, C: Item.Coal, L: Block.Log },
  },

  ...STORAGE.flatMap(([material, block]): Recipe[] => [
    { result: { id: block, count: 1 }, pattern: ['MMM', 'MMM', 'MMM'], key: { M: material } },
    { result: { id: material, count: 9 }, shapeless: [block] },
  ]),

  { result: { id: Block.WhiteWool, count: 1 }, pattern: ['SS', 'SS'], key: { S: Item.String } },
  ...DYES.map(([wool, dye]): Recipe => ({ result: { id: wool, count: 1 }, shapeless: [Block.WhiteWool, dye] })),
  ...WOOLS.map(([wool, carpet]): Recipe => ({ result: { id: carpet, count: 3 }, pattern: ['WW'], key: { W: wool } })),
];

export const BUILDING: ContentPack = {
  name: 'building',
  blocks,
  items,
  shapes,
  recipes,
  smelting: [
    { from: Block.StoneBricks, to: Block.CrackedStoneBricks },
    { from: Block.Clay, to: Block.Terracotta },
  ],
  fuel: [{ id: Block.CoalBlock, value: 80 }],
  // Two slabs of a kind become the full block. One way only: a full block
  // does not split back into slabs in place.
  transitions: SLAB_FULL.map(([s, full]) => [s, full] as [number, number]),
};
