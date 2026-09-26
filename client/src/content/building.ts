/**
 * How the building pack behaves in play. Its blocks and items are defined in
 * shared/src/content/building.ts; this file registers what they *do* through the
 * hooks in ./api.ts. Imported for its side effects by ./index.ts.
 *
 * Everything with a facing takes it from where the player is looking when it
 * goes down, the same way conveyors do: stairs climb away from you, a door
 * sits on the far edge of its doorway, a gate spans the way you are facing
 * across. Everything with an open and a shut state is a family, so each
 * toggle is one in-place change the server already knows to allow.
 */

import { Block, blockDef, isSolid } from '@shared/blocks.js';
import {
  DOORS_CLOSED, DOORS_OPEN, SLAB_FULL, STAIRS, TRAPDOORS_OPEN, connectRules,
} from '@shared/content/building.js';
import { Item, cookedForm, isFood, itemName, smeltResult } from '@shared/items.js';
import { isFullCube } from '@shared/shapes.js';
import { EAST, NORTH, SOUTH, WEST } from '@shared/shapekit.js';
import {
  registerAfterPlace, registerBlockUse, registerBreak, registerPlacement, type GameContext, type UseContext,
} from './api.js';

// Fences, walls and panes join any full solid block, whichever pack made it.
// The shared pack cannot ask the registry itself (see its connectRules), so
// the answer is supplied from here, where importing the registry is safe.
connectRules.fullBlock = (id) =>
  id !== Block.Air && isSolid(id) && isFullCube(id) && !blockDef(id).liquid;

/**
 * The facing the player is looking along, snapped to a quarter turn.
 *
 * Player yaw is in degrees with forward = (cos yaw, sin yaw) on x/z, so yaw
 * 0 looks east (+x) and -90 north (-z).
 */
export function facingFromYaw(yawDegrees: number): number {
  const r = (yawDegrees * Math.PI) / 180;
  const fx = Math.cos(r);
  const fz = Math.sin(r);
  if (Math.abs(fx) >= Math.abs(fz)) return fx > 0 ? EAST : WEST;
  return fz > 0 ? SOUTH : NORTH;
}

// --- slabs -----------------------------------------------------------------

const slabFull = new Map<number, number>(SLAB_FULL.map(([s, full]) => [s, full]));

/**
 * A slab placed on the top face of the same slab fills that cell out to the
 * full block instead of starting a new half above it -- which is how a
 * floor of slabs is raised to a full floor. Aiming at a wall beside an
 * existing slab of the same kind fills that one too.
 */
registerPlacement([...slabFull.keys()], (ctx) => {
  const item = ctx.held!;
  const full = slabFull.get(item)!;
  if (ctx.id === item && ctx.face[1] === 1) {
    ctx.px = ctx.x;
    ctx.py = ctx.y;
    ctx.pz = ctx.z;
    ctx.allowReplace = true;
    return full;
  }
  if (ctx.getBlock(ctx.px, ctx.py, ctx.pz) === item) {
    ctx.allowReplace = true;
    return full;
  }
  return item;
});

// --- stairs -----------------------------------------------------------------

for (const facings of STAIRS) {
  registerPlacement(facings[0], (ctx) => facings[facingFromYaw(ctx.player.yaw)]);
}

// --- fence gates -----------------------------------------------------------

/** Closed to open and back, keeping the gate's axis. */
const GATE_TOGGLE = new Map<number, number>([
  [Block.FenceGateX, Block.FenceGateXOpen], [Block.FenceGateXOpen, Block.FenceGateX],
  [Block.FenceGateZ, Block.FenceGateZOpen], [Block.FenceGateZOpen, Block.FenceGateZ],
]);

/**
 * A gate spans across the way the player faces: looking north or south, it
 * runs along x so you walk through it the way you were already going.
 */
registerPlacement(Block.FenceGateX, (ctx) => {
  const facing = facingFromYaw(ctx.player.yaw);
  return facing === NORTH || facing === SOUTH ? Block.FenceGateX : Block.FenceGateZ;
});

registerBlockUse([...GATE_TOGGLE.keys()], (ctx) => {
  const next = GATE_TOGGLE.get(ctx.id)!;
  // Swinging a gate shut on someone standing in it would trap them inside
  // its collision box; refuse rather than do that.
  if (isSolid(next) && ctx.player.intersects(ctx.x, ctx.y, ctx.z, next, ctx.world)) return true;
  ctx.setBlock(ctx.x, ctx.y, ctx.z, next);
  ctx.swing();
  return true;
});

// --- doors ------------------------------------------------------------------

const ALL_DOORS = [...DOORS_CLOSED, ...DOORS_OPEN];
const isDoor = (id: number) => ALL_DOORS.includes(id);

/** The same door with its panel swung the other way. */
export function doorToggled(id: number): number {
  const closed = DOORS_CLOSED.indexOf(id);
  if (closed >= 0) return DOORS_OPEN[closed];
  return DOORS_CLOSED[DOORS_OPEN.indexOf(id)];
}

/**
 * A door needs two free cells and something other than a door beneath it:
 * which half a cell is comes from whether the same door stands below, so a
 * door stacked on a door would read as one tall broken one.
 */
registerPlacement(Item.WoodDoor, (ctx) => {
  const { px: x, py: y, pz: z } = ctx;
  const above = ctx.getBlock(x, y + 1, z);
  if (above !== Block.Air && !blockDef(above).replaceable) return null;
  if (isDoor(ctx.getBlock(x, y - 1, z))) return null;
  return DOORS_CLOSED[facingFromYaw(ctx.player.yaw)];
});

/** Finishes a door the player just put down by adding its upper half. */
function addUpperHalf(ctx: GameContext, x: number, y: number, z: number, id: number): void {
  if (ctx.getBlock(x, y - 1, z) === id) return;
  if (ctx.getBlock(x, y + 1, z) === id) return;
  if (!ctx.setBlock(x, y + 1, z, id)) {
    // Nowhere for the top to go after all: take the bottom back up.
    ctx.setBlock(x, y, z, Block.Air);
    ctx.give(Item.WoodDoor, 1);
  }
}

/** Opening or shutting either half moves both. */
function useDoor(ctx: UseContext): boolean {
  const lowerY = ctx.getBlock(ctx.x, ctx.y - 1, ctx.z) === ctx.id ? ctx.y - 1 : ctx.y;
  const next = doorToggled(ctx.id);
  ctx.setBlock(ctx.x, lowerY, ctx.z, next);
  if (ctx.getBlock(ctx.x, lowerY + 1, ctx.z) === ctx.id) ctx.setBlock(ctx.x, lowerY + 1, ctx.z, next);
  ctx.swing();
  return true;
}

registerAfterPlace(DOORS_CLOSED, addUpperHalf);
registerBlockUse(ALL_DOORS, useDoor);

/**
 * Breaking one half takes the other with it. Only the half actually broken
 * drops the door item, so a door always comes back as exactly one door.
 */
registerBreak(ALL_DOORS, (ctx, x, y, z, id) => {
  for (const dy of [-1, 1]) {
    if (ctx.getBlock(x, y + dy, z) === id) ctx.breakBlock(x, y + dy, z, { drops: false });
  }
});

// --- trapdoors ------------------------------------------------------------

/**
 * A shut trapdoor lies on the floor of its cell; opening it stands it up
 * against the edge the player is facing, so it swings away from them and
 * leaves the hole clear on their side.
 */
registerBlockUse([Block.Trapdoor, ...TRAPDOORS_OPEN], (ctx) => {
  const next = ctx.id === Block.Trapdoor
    ? TRAPDOORS_OPEN[facingFromYaw(ctx.player.yaw)]
    : Block.Trapdoor;
  if (ctx.player.intersects(ctx.x, ctx.y, ctx.z, next, ctx.world)) return true;
  ctx.setBlock(ctx.x, ctx.y, ctx.z, next);
  ctx.swing();
  return true;
});

// --- campfire ---------------------------------------------------------------

/**
 * What a campfire turns a held food into: the furnace's own answer, so
 * anything any pack teaches the furnace to cook, a campfire cooks as well --
 * but only food. A campfire is not a smelter.
 */
export function campfireCooks(id: number | null): number | null {
  if (id === null) return null;
  const direct = cookedForm(id);
  if (direct !== null) return direct;
  if (!isFood(id)) return null;
  const smelted = smeltResult(id);
  return smelted && isFood(smelted.id) ? smelted.id : null;
}

registerBlockUse(Block.Campfire, (ctx) => {
  const cooked = campfireCooks(ctx.held);
  if (cooked === null) return false;
  if (!ctx.consumeHeld(1)) return false;
  ctx.give(cooked, 1);
  ctx.breakParticles(ctx.x, ctx.y, ctx.z, Block.Campfire);
  ctx.toast(`Cooked ${itemName(cooked)}`);
  ctx.swing();
  return true;
});

