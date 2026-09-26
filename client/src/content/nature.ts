/**
 * How the nature pack behaves in play. Its blocks and items are defined in
 * shared/src/content/nature.ts; this file registers what they *do* through the
 * hooks in ./api.ts. Imported for its side effects by ./index.ts.
 *
 * Almost everything here is about support and growth: a plant needs the
 * right ground under it and pops off when that goes, a sapling becomes a
 * tree when there is room for one, reeds and cacti climb to three blocks.
 */

import { Block, blockDef, isReplaceable } from '@shared/blocks.js';
import { WORLD_Y } from '@shared/constants.js';
import { isWater as isAnyWater } from '@shared/fluids.js';
import { APPLE_CHANCE, SAPLING_CHANCE } from '@shared/content/nature.js';
import { Item } from '@shared/items.js';
import { treeCells, treeHeight, type TreeKind } from '@shared/terrain.js';
import {
  registerAfterPlace, registerBreak, registerItemUse, registerNeighbourChange, registerPlacement,
  registerRandomTick, type GameContext, type PlaceContext,
} from './api.js';

// --- support ------------------------------------------------------------------

const FLOWERS = [Block.Dandelion, Block.Poppy, Block.Cornflower, Block.Tulip];
const SAPLINGS: Record<number, TreeKind> = {
  [Block.OakSapling]: 'oak',
  [Block.BirchSapling]: 'birch',
  [Block.PineSapling]: 'pine',
};
const MUSHROOMS = [Block.BrownMushroom, Block.RedMushroom];
/** Plants that grow in soil: grass, ferns, flowers, saplings. */
const SOIL_PLANTS = [Block.TallGrass, Block.Fern, ...FLOWERS, Block.OakSapling, Block.BirchSapling, Block.PineSapling];
/** Everything that pops off when it loses what it stands on. */
export const NEEDS_SUPPORT = [
  ...SOIL_PLANTS, ...MUSHROOMS, Block.DeadBush, Block.Reeds, Block.Cactus, Block.LilyPad, Block.SnowLayer,
];
/** Reeds and cacti stop growing at this height, counting the bottom block. */
export const MAX_STALK = 3;

/** Soil a plant takes root in. */
export function isSoil(id: number): boolean {
  return id === Block.Grass || id === Block.Dirt || id === Block.Podzol ||
    id === Block.SnowyGrass || id === Block.Farmland;
}

/** Still water: a lily pad floats on a pond, and running water carries it off. */
const isWater = (id: number): boolean => id === Block.Water;

/** A full, solid block: what a mushroom or a snow layer can rest on. */
function isFirm(id: number): boolean {
  const d = blockDef(id);
  return d.solid && d.opaque;
}

type Reader = Pick<GameContext, 'getBlock'>;

/**
 * Can `id` stand at (x, y, z)? The one rule placement and the neighbour
 * check share, so nothing can be put down that would fall off at once.
 */
export function canStay(ctx: Reader, x: number, y: number, z: number, id: number): boolean {
  const below = ctx.getBlock(x, y - 1, z);
  if (SOIL_PLANTS.includes(id)) return isSoil(below);
  if (MUSHROOMS.includes(id)) return isFirm(below);
  switch (id) {
    case Block.DeadBush:
      return below === Block.Sand || isSoil(below);
    case Block.LilyPad:
      return isWater(below) || below === Block.Ice;
    case Block.SnowLayer:
      return isFirm(below) || below === Block.Leaves || below === Block.BirchLeaves || below === Block.PineLeaves;
    case Block.Reeds: {
      if (below === Block.Reeds) return true;
      if (!(isSoil(below) || below === Block.Sand)) return false;
      // The ground under the bottom reed has to touch water, still or running.
      return isAnyWater(ctx.getBlock(x + 1, y - 1, z)) || isAnyWater(ctx.getBlock(x - 1, y - 1, z)) ||
        isAnyWater(ctx.getBlock(x, y - 1, z + 1)) || isAnyWater(ctx.getBlock(x, y - 1, z - 1));
    }
    case Block.Cactus: {
      if (below !== Block.Sand && below !== Block.Cactus) return false;
      // Anything solid pressing against a cactus breaks it: the rule that
      // makes cactus farms a puzzle rather than a block of green.
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (blockDef(ctx.getBlock(x + dx, y, z + dz)).solid) return false;
      }
      return true;
    }
    default:
      return true;
  }
}

registerNeighbourChange(NEEDS_SUPPORT, (ctx, x, y, z, id) => {
  if (!canStay(ctx, x, y, z, id)) ctx.breakBlock(x, y, z);
});

// Placing a plant where it could not live is refused rather than letting it
// drop straight back into the player's hands.
registerPlacement(NEEDS_SUPPORT.filter((id) => id !== Block.LilyPad), (ctx: PlaceContext) => {
  const id = ctx.held!;
  return canStay(ctx, ctx.px, ctx.py, ctx.pz, id) ? id : null;
});

/**
 * A lily pad goes on the water's surface, wherever along the column the
 * player aimed: clicking the pond bed, or the bank beside the water, both
 * float it up to the top.
 */
registerPlacement(Block.LilyPad, (ctx: PlaceContext) => {
  let y = ctx.py;
  if (isWater(ctx.getBlock(ctx.px, y, ctx.pz))) {
    while (y < WORLD_Y - 1 && isWater(ctx.getBlock(ctx.px, y + 1, ctx.pz))) y++;
    y++;
  }
  if (y >= WORLD_Y || ctx.getBlock(ctx.px, y, ctx.pz) !== Block.Air) return null;
  if (!isWater(ctx.getBlock(ctx.px, y - 1, ctx.pz))) return null;
  ctx.py = y;
  return Block.LilyPad;
});

// --- snow on grass ------------------------------------------------------------

const isSnow = (id: number): boolean => id === Block.SnowLayer || id === Block.Snow;

// Grass under snow shows it on its sides, and loses it when the snow goes.
registerNeighbourChange(Block.Grass, (ctx, x, y, z) => {
  if (isSnow(ctx.getBlock(x, y + 1, z))) ctx.setBlock(x, y, z, Block.SnowyGrass);
});
registerNeighbourChange(Block.SnowyGrass, (ctx, x, y, z) => {
  if (!isSnow(ctx.getBlock(x, y + 1, z))) ctx.setBlock(x, y, z, Block.Grass);
});

// --- trees --------------------------------------------------------------------

/** Chance a sapling grows on each random tick: several minutes on average. */
export const SAPLING_GROW_CHANCE = 0.12;

/** A cell a growing tree may fill: empty, or something that gives way to it. */
function yields(id: number): boolean {
  return id === Block.Air || isReplaceable(id) || id === Block.Leaves ||
    id === Block.BirchLeaves || id === Block.PineLeaves;
}

/**
 * Grows the sapling at (x, y, z) into a tree, if there is room for one.
 *
 * Room means the whole trunk and the space over its crown are clear; leaves
 * then fill whatever air they find, so a tree grown against a wall is
 * trimmed by it rather than refusing to grow. Returns whether it grew.
 */
export function growTree(ctx: GameContext, x: number, y: number, z: number): boolean {
  const kind = SAPLINGS[ctx.getBlock(x, y, z)];
  if (!kind || !isSoil(ctx.getBlock(x, y - 1, z))) return false;
  const height = treeHeight(kind, ctx.random());
  const cells = treeCells(kind, height);
  const crown = Math.max(...cells.map((c) => c.dy));
  if (y + crown >= WORLD_Y) return false;
  for (let dy = 1; dy <= crown; dy++) {
    if (!yields(ctx.getBlock(x, y + dy, z))) return false;
  }
  for (const c of cells) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    const cz = z + c.dz;
    const here = ctx.getBlock(cx, cy, cz);
    if (c.trunk) ctx.setBlock(cx, cy, cz, c.id);
    else if (here === Block.Air || (isReplaceable(here) && !blockDef(here).liquid)) ctx.setBlock(cx, cy, cz, c.id);
  }
  return true;
}

registerRandomTick(Object.keys(SAPLINGS).map(Number), (ctx, x, y, z) => {
  if (ctx.random() < SAPLING_GROW_CHANCE) growTree(ctx, x, y, z);
});

// Oak leaves are the legacy block, which drops nothing by itself; saplings
// and the odd apple fall out of them here.
registerBreak(Block.Leaves, (ctx, x, y, z) => {
  if (ctx.creative) return;
  if (ctx.random() < SAPLING_CHANCE) ctx.dropItem(x + 0.5, y + 0.3, z + 0.5, Block.OakSapling, 1);
  if (ctx.random() < APPLE_CHANCE) ctx.dropItem(x + 0.5, y + 0.3, z + 0.5, Item.Apple, 1);
});

// --- stalks: cactus and reeds ------------------------------------------------

/** Chance the top of a cactus or reed stalk grows one block per random tick. */
export const STALK_GROW_CHANCE = 0.3;

/** How many of `id` are stacked at and below (x, y, z). */
function stalkHeight(ctx: Reader, x: number, y: number, z: number, id: number): number {
  let n = 0;
  while (n < MAX_STALK + 1 && ctx.getBlock(x, y - n, z) === id) n++;
  return n;
}

/** Grows a stalk one block, if it is under height and could stand there. */
export function growStalk(ctx: GameContext, x: number, y: number, z: number, id: number): boolean {
  if (ctx.getBlock(x, y + 1, z) !== Block.Air) return false;
  if (stalkHeight(ctx, x, y, z, id) >= MAX_STALK) return false;
  // Test the new cell as if the stalk were already there.
  const future: Reader = {
    getBlock: (bx, by, bz) => (bx === x && by === y + 1 && bz === z ? id : ctx.getBlock(bx, by, bz)),
  };
  if (!canStay(future, x, y + 1, z, id)) return false;
  return ctx.setBlock(x, y + 1, z, id);
}

registerRandomTick([Block.Cactus, Block.Reeds], (ctx, x, y, z, id) => {
  if (ctx.random() < STALK_GROW_CHANCE) growStalk(ctx, x, y, z, id);
});

// --- mushrooms -----------------------------------------------------------------

/** Below this sky exposure a cell counts as shade. */
export const SHADE = 0.6;

function skyAt(ctx: GameContext, x: number, y: number, z: number): number {
  const world = ctx.world as { skyLight?: (x: number, y: number, z: number) => number };
  return world.skyLight ? world.skyLight(x, y, z) : 1;
}

/**
 * Mushrooms creep slowly through shade -- under trees, in caves -- and
 * never out into open sunlight, and they thin themselves out so a cave
 * floor does not become a carpet.
 */
export function spreadMushroom(ctx: GameContext, x: number, y: number, z: number, id: number): boolean {
  if (skyAt(ctx, x, y, z) >= SHADE) return false;
  let near = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) if (ctx.getBlock(x + dx, y + dy, z + dz) === id) near++;
    }
  }
  if (near >= 5) return false;
  const tx = x + Math.floor(ctx.random() * 5) - 2;
  const ty = y + Math.floor(ctx.random() * 3) - 1;
  const tz = z + Math.floor(ctx.random() * 5) - 2;
  if (ctx.getBlock(tx, ty, tz) !== Block.Air || !canStay(ctx, tx, ty, tz, id)) return false;
  if (skyAt(ctx, tx, ty, tz) >= SHADE) return false;
  return ctx.setBlock(tx, ty, tz, id);
}

registerRandomTick(MUSHROOMS, (ctx, x, y, z, id) => {
  if (ctx.random() < 0.1) spreadMushroom(ctx, x, y, z, id);
});

// --- ice ------------------------------------------------------------------------

// Broken ice melts into the water it froze from -- unless there is nothing
// under it to hold the water up.
registerBreak(Block.Ice, (ctx, x, y, z) => {
  if (ctx.creative) return;
  if (ctx.getBlock(x, y - 1, z) !== Block.Air) ctx.setBlock(x, y, z, Block.Water);
});

// Snow put down on grass turns the grass beneath snowy at once, rather than
// waiting for a neighbour update to notice.
registerAfterPlace([Block.SnowLayer, Block.Snow], (ctx, x, y, z) => {
  if (ctx.getBlock(x, y - 1, z) === Block.Grass) ctx.setBlock(x, y - 1, z, Block.SnowyGrass);
});

// --- bone meal ------------------------------------------------------------------

/**
 * Bone meal on grass: tall grass and the odd flower spring up round the
 * spot. Returns how many plants sprouted.
 */
export function sproutAround(ctx: GameContext, x: number, y: number, z: number): number {
  let grown = 0;
  for (let i = 0; i < 28; i++) {
    const tx = x + Math.floor(ctx.random() * 7) - 3;
    const tz = z + Math.floor(ctx.random() * 7) - 3;
    const ty = y + 1 + Math.floor(ctx.random() * 3) - 1;
    if (ctx.getBlock(tx, ty - 1, tz) !== Block.Grass || ctx.getBlock(tx, ty, tz) !== Block.Air) continue;
    const plant = ctx.random() < 0.8
      ? Block.TallGrass
      : FLOWERS[Math.floor(ctx.random() * FLOWERS.length)];
    if (ctx.setBlock(tx, ty, tz, plant)) grown++;
  }
  return grown;
}

// The farming pack handles crops with its own bone-meal hook; this one
// answers only for saplings and grass, and passes on everything else.
registerItemUse(Item.BoneMeal, (ctx) => {
  if (SAPLINGS[ctx.id] !== undefined) {
    if (growTree(ctx, ctx.x, ctx.y, ctx.z)) {
      ctx.consumeHeld(1);
      ctx.swing();
    } else {
      ctx.toast('Not enough room for a tree here');
    }
    return true;
  }
  if (ctx.id === Block.Grass && ctx.getBlock(ctx.x, ctx.y + 1, ctx.z) === Block.Air) {
    if (sproutAround(ctx, ctx.x, ctx.y, ctx.z) > 0) {
      ctx.consumeHeld(1);
      ctx.swing();
      ctx.breakParticles(ctx.x, ctx.y + 1, ctx.z, Block.TallGrass);
    }
    return true;
  }
  return false;
});
