/**
 * How the combat pack behaves in play. Its blocks and items are defined in
 * shared/src/content/combat.ts; this file registers what they *do* through the
 * hooks in ./api.ts. Imported for its side effects by ./index.ts.
 *
 * The moving parts each live in ./combat/: projectiles, explosions and lit
 * charges, falling blocks, and the puffs they all leave behind. This file
 * wires them to the game -- the bow, snowballs, hammers, buckets, flint and
 * steel on TNT, sand that falls, spikes that bite -- and draws them as one
 * system, so the world gets one extra mesh a frame however busy it is.
 */

import { Block, blockDef, isLiquid } from '@shared/blocks.js';
import { Dimension } from '@shared/constants.js';
import { isFluidSource, isLava, isWater } from '@shared/fluids.js';
import { Item, canHarvest, preferredTool, toolSpec } from '@shared/items.js';
import { selectionOf } from '@shared/shapes.js';
import { isMachine } from '../machines.js';
import { EYE_HEIGHT, aroundAt, rayBoxes } from '../player.js';
import {
  registerAfterPlace, registerBreakWith, registerItemRelease, registerItemUse,
  registerItemUseAir, registerNeighbourChange, registerSystem, services,
  type GameContext, type GameSystem, type UseContext,
} from './api.js';
import { Effects } from './combat/effects.js';
import { Explosions, CHAIN_FUSE_MIN } from './combat/explosion.js';
import { FallingBlocks, GRAVITY_BLOCKS } from './combat/falling.js';
import { MeshBuilder, lightAt } from './combat/geometry.js';
import { Projectiles, muzzle } from './combat/projectiles.js';
import { traceCells } from './combat/trace.js';

// --- the moving parts -----------------------------------------------------------

export const effects = new Effects();
export const explosions = new Explosions(effects);
export const falling = new FallingBlocks();
/** A fireball landing on TNT lights it, with a short fuse. */
export const projectiles = new Projectiles(effects, (ctx, x, y, z) => {
  explosions.prime(ctx, x, y, z, CHAIN_FUSE_MIN);
});

services.explode = (ctx, x, y, z, power) => explosions.explode(ctx, x, y, z, power);
services.shoot = (ctx, shot) => { projectiles.shoot(ctx, shot); };

// --- inventory access -------------------------------------------------------------

/**
 * Taking an arrow from anywhere in the inventory, not just the hand.
 *
 * GameContext only reaches the held stack, and a bow is what is held while
 * the arrows sit elsewhere. main.ts is asked to add these two methods; until
 * it does, a bow in survival shoots without spending arrows rather than not
 * at all -- the lesser of two wrongs for a game someone is playing.
 */
export interface InventoryAccess {
  /** How many of an item the player carries, anywhere. */
  countItem(id: number): number;
  /** Takes that many from anywhere in the inventory; false if there are not enough. */
  takeItem(id: number, count: number): boolean;
}

function inventoryOf(ctx: GameContext): InventoryAccess | null {
  const c = ctx as GameContext & Partial<InventoryAccess>;
  return typeof c.countItem === 'function' && typeof c.takeItem === 'function'
    ? (c as unknown as InventoryAccess) : null;
}

function hasArrow(ctx: GameContext): boolean {
  if (ctx.creative) return true;
  const inv = inventoryOf(ctx);
  return inv ? inv.countItem(Item.Arrow) > 0 : true;
}

function takeArrow(ctx: GameContext): boolean {
  if (ctx.creative) return true;
  const inv = inventoryOf(ctx);
  return inv ? inv.takeItem(Item.Arrow, 1) : true;
}

// --- the bow -------------------------------------------------------------------------

/** Seconds of draw for a full-power shot. */
export const FULL_DRAW = 1;
/** Below this a shot is only a dribble. */
export const MIN_DRAW = 0.2;
/** Launch speed and damage of a full-power arrow. */
export const ARROW_SPEED = 42;
export const ARROW_DAMAGE = 9;

/**
 * How strong a shot is after holding the bow drawn for this long, 0..1.
 * Rises quickly at first and levels off, so a half-second draw is already a
 * useful shot and the last few tenths are for range. A tap barely clears the
 * bow.
 */
export function bowPower(seconds: number): number {
  if (seconds < MIN_DRAW) return 0.1;
  const f = Math.min(1, seconds / FULL_DRAW);
  return Math.max(0.1, (f * f + 2 * f) / 3);
}

/** The draw in progress: when it started. Null when the bow is slack. */
let drawing: number | null = null;

/** Whether the bow is drawn right now. For the HUD, one day, and for tests. */
export function isDrawing(): boolean {
  return drawing !== null;
}

registerItemUseAir(Item.Bow, (ctx) => {
  if (!hasArrow(ctx)) {
    drawing = null;
    ctx.toast('You have no arrows');
    return true;
  }
  drawing = ctx.time;
  return true;
});

registerItemRelease(Item.Bow, (ctx, seconds) => {
  if (drawing === null) return;
  drawing = null;
  fireBow(ctx, seconds);
});

/** Looses an arrow drawn for `seconds`, spending one. Null if there were none. */
export function fireBow(ctx: GameContext, seconds: number) {
  if (!takeArrow(ctx)) {
    ctx.toast('You have no arrows');
    return null;
  }
  const power = bowPower(seconds);
  const m = muzzle(ctx);
  ctx.swing();
  ctx.sound.click();
  return projectiles.shoot(ctx, {
    ...m,
    speed: ARROW_SPEED * power,
    damage: Math.max(1, Math.round(ARROW_DAMAGE * power)),
    shooter: 'player', kind: 'arrow',
  }, { crit: power >= 1 });
}

// --- snowballs -------------------------------------------------------------------------

export const SNOWBALL_SPEED = 24;

registerItemUseAir(Item.Snowball, (ctx) => {
  if (!ctx.consumeHeld(1)) return true;
  ctx.swing();
  projectiles.shoot(ctx, { ...muzzle(ctx), speed: SNOWBALL_SPEED, damage: 0, shooter: 'player', kind: 'snowball' });
  return true;
});

// --- hammers ------------------------------------------------------------------------------

export const HAMMER_ITEMS: readonly number[] = [Item.StoneHammer, Item.IronHammer, Item.DiamondHammer];

/**
 * The cells a hammer takes with it when it breaks the block at (x, y, z):
 * the other eight of the 3x3 square around it, in the plane facing the
 * player -- a wall when looking along it, a floor when looking down.
 *
 * Only what a pickaxe of the hammer's tier would harvest, and never much
 * harder than the block actually mined: a hammer is a wide pickaxe, not a
 * way to flatten obsidian by mining the stone beside it. Never a machine
 * either, since machines hold things. And nothing at all unless the block
 * struck was itself pickaxe work: a hammer taken to dirt is just a clumsy
 * shovel.
 */
export function hammerTargets(
  ctx: GameContext, x: number, y: number, z: number, broken: number, hammer: number,
): Array<[number, number, number]> {
  if (preferredTool(broken) !== 'pickaxe') return [];
  const [fx, fy, fz] = ctx.player.forward;
  const ax = Math.abs(fx);
  const ay = Math.abs(fy);
  const az = Math.abs(fz);
  // The two axes the square spans: the ones the player is not looking along.
  const [u, v]: Array<[number, number, number]> =
    ay >= ax && ay >= az ? [[1, 0, 0], [0, 0, 1]]
      : ax >= az ? [[0, 1, 0], [0, 0, 1]]
        : [[1, 0, 0], [0, 1, 0]];
  const limit = blockDef(broken).hardness * 2 + 1;
  const out: Array<[number, number, number]> = [];
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue;
      const cx = x + u[0] * i + v[0] * j;
      const cy = y + u[1] * i + v[1] * j;
      const cz = z + u[2] * i + v[2] * j;
      const id = ctx.getBlock(cx, cy, cz);
      if (id === Block.Air || isLiquid(id) || isMachine(id)) continue;
      const def = blockDef(id);
      if (!def.breakable || def.hardness > limit) continue;
      if (preferredTool(id) !== 'pickaxe' || !canHarvest(id, hammer)) continue;
      out.push([cx, cy, cz]);
    }
  }
  return out;
}

registerBreakWith([...HAMMER_ITEMS], (ctx, x, y, z, id) => {
  const hammer = ctx.heldItem();
  if (hammer === null || toolSpec(hammer)?.kind !== 'hammer') return;
  for (const [cx, cy, cz] of hammerTargets(ctx, x, y, z, id, hammer)) ctx.breakBlock(cx, cy, cz);
});

// --- buckets ---------------------------------------------------------------------------------

/** How far a bucket reaches. */
const BUCKET_REACH = 5;

/**
 * The first still water or lava along the player's line of sight, unless
 * something solid is in the way first. The ordinary cursor looks straight
 * through water -- you build on the lake bed, not on the surface -- so a
 * bucket has to look for itself. It looks through running water too: only
 * a source holds a bucketful, and a stream is scooped at its spring.
 */
export function liquidInSight(ctx: GameContext): { x: number; y: number; z: number; id: number } | null {
  const pl = ctx.player;
  const [dx, dy, dz] = pl.forward;
  const ox = pl.x;
  const oy = pl.y + EYE_HEIGHT;
  const oz = pl.z;
  let found: { x: number; y: number; z: number; id: number } | null = null;
  traceCells(ox, oy, oz, dx, dy, dz, BUCKET_REACH, (x, y, z) => {
    const id = ctx.getBlock(x, y, z);
    if (id === Block.Air) return false;
    if (isFluidSource(id)) {
      found = { x, y, z, id };
      return true;
    }
    if (isLiquid(id)) return false;
    const boxes = selectionOf(id, aroundAt(ctx.world, x, y, z));
    // Something in the way: stop looking, empty-handed.
    return rayBoxes(ox, oy, oz, dx, dy, dz, x, y, z, boxes, BUCKET_REACH) !== null;
  });
  return found;
}

/** Scoops up the liquid in sight into the held empty bucket. */
function fillBucket(ctx: GameContext): boolean {
  const target = liquidInSight(ctx);
  if (!target) return false;
  const full = target.id === Block.Lava ? Item.LavaBucket : target.id === Block.Water ? Item.WaterBucket : null;
  if (full === null) return false;
  if (!ctx.setBlock(target.x, target.y, target.z, Block.Air)) return false;
  ctx.replaceHeld(full, 1);
  ctx.sound.blockPlace(target.id);
  ctx.swing();
  return true;
}

registerItemUse(Item.Bucket, (ctx) => fillBucket(ctx));
registerItemUseAir(Item.Bucket, (ctx) => {
  fillBucket(ctx);
  // Swallow the click either way: an empty bucket is never placed.
  return true;
});

/**
 * What pouring a liquid into a cell holding this leaves there. Water on lava
 * cools it -- still lava to obsidian, running lava to cobblestone, the same
 * rule the fluids pack sets them by where they meet -- and lava into water
 * sets to cobblestone. A source into itself does nothing; into its own
 * running water it tops the stream up to a source again.
 */
export function pourResult(liquid: number, into: number): number | null {
  if (into === liquid) return null;
  if (liquid === Block.Water && isLava(into)) return isFluidSource(into) ? Block.Obsidian : Block.Cobblestone;
  if (liquid === Block.Lava && isWater(into)) return Block.Cobblestone;
  return liquid;
}

/** Empties a held full bucket against the clicked face. */
export function pourBucket(ctx: UseContext, liquid: number): boolean {
  // Into the clicked cell when it is something a block may simply replace
  // (tall grass); otherwise into the cell in front of the face.
  const here = blockDef(ctx.id).replaceable && !blockDef(ctx.id).liquid;
  const x = here ? ctx.x : ctx.x + ctx.face[0];
  const y = here ? ctx.y : ctx.y + ctx.face[1];
  const z = here ? ctx.z : ctx.z + ctx.face[2];
  const current = ctx.getBlock(x, y, z);
  if (liquid === Block.Water && ctx.dimension === Dimension.Nether) {
    // Too hot: the water boils off before it lands.
    effects.burst('steam', x + 0.5, y + 0.5, z + 0.5, 14, 0.6, 1.5, ctx.random, 0.3);
    ctx.replaceHeld(Item.Bucket, 1);
    ctx.swing();
    return true;
  }
  const result = pourResult(liquid, current);
  if (result === null) return true;
  if (!ctx.setBlock(x, y, z, result)) return true;
  if (result !== liquid) effects.burst('steam', x + 0.5, y + 0.8, z + 0.5, 12, 0.6, 1.5, ctx.random, 0.3);
  ctx.replaceHeld(Item.Bucket, 1);
  ctx.sound.blockPlace(liquid);
  ctx.swing();
  return true;
}

registerItemUse(Item.WaterBucket, (ctx) => pourBucket(ctx, Block.Water));
registerItemUse(Item.LavaBucket, (ctx) => pourBucket(ctx, Block.Lava));
// Nothing to pour against in open air, but the click is still the bucket's.
registerItemUseAir([Item.WaterBucket, Item.LavaBucket], () => true);

// --- TNT --------------------------------------------------------------------------------------

/**
 * Flint and steel lights TNT. Only TNT: anything else falls through to the
 * portal lighting main.ts already does with it.
 */
registerItemUse(Item.FlintAndSteel, (ctx) => {
  if (ctx.id !== Block.TNT) return false;
  if (!explosions.prime(ctx, ctx.x, ctx.y, ctx.z)) return false;
  ctx.sound.click();
  ctx.swing();
  return true;
});

// --- gravity -------------------------------------------------------------------------------------

const releaseIfLoose = (ctx: GameContext, x: number, y: number, z: number): void => {
  falling.release(ctx, x, y, z);
};
registerNeighbourChange([...GRAVITY_BLOCKS], releaseIfLoose);
registerAfterPlace([...GRAVITY_BLOCKS], releaseIfLoose);

// --- spikes ----------------------------------------------------------------------------------------

/** Seconds between spike bites on a mob standing in them. */
const SPIKE_INTERVAL = 0.5;
/** Damage per bite. The player is bitten by the physics (contactDamage). */
export const SPIKE_BITE = 2;
const spikeTimers = new WeakMap<object, number>();

/** Mobs walking through spikes are hurt too; they have no contact damage of their own. */
function spikeMobs(ctx: GameContext, dt: number): void {
  for (const mob of ctx.mobs.mobs) {
    if (mob.dead || mob.def.flying) continue;
    const id = ctx.getBlock(Math.floor(mob.x), Math.floor(mob.y + 0.05), Math.floor(mob.z));
    if (id !== Block.IronSpikes) {
      spikeTimers.delete(mob);
      continue;
    }
    const t = (spikeTimers.get(mob) ?? 0) - dt;
    if (t > 0) {
      spikeTimers.set(mob, t);
      continue;
    }
    spikeTimers.set(mob, SPIKE_INTERVAL);
    ctx.hurtMob(mob, SPIKE_BITE);
  }
}

// --- the system ----------------------------------------------------------------------------------

export const combatSystem: GameSystem = {
  name: 'combat',
  update(ctx, dt) {
    projectiles.update(ctx, dt);
    explosions.update(ctx, dt);
    falling.update(ctx, dt);
    effects.update(dt);
    spikeMobs(ctx, dt);
  },
  mesh(ctx, atlas) {
    if (projectiles.list.length + explosions.charges.length + falling.list.length +
        effects.puffs.length === 0) return null;
    const out = new MeshBuilder();
    projectiles.draw(ctx, out, atlas);
    explosions.draw(ctx, out, atlas);
    falling.draw(ctx, out, atlas);
    effects.draw(out, atlas, (x, y, z) => lightAt(ctx.world, x, y, z));
    return out.build();
  },
  reset() {
    projectiles.reset();
    explosions.reset();
    falling.reset();
    effects.reset();
    drawing = null;
  },
};
registerSystem(combatSystem);
