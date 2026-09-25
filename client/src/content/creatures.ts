/**
 * How the creatures pack behaves in play. Its blocks and items are defined in
 * shared/src/content/creatures.ts; this file registers what they *do* through the
 * hooks in ./api.ts. Imported for its side effects by ./index.ts.
 *
 * The mobs' own brains live in ../mobs.ts. What is here is the player's side
 * of the relationship: shearing a sheep, winning a wolf over with a bone,
 * telling it to sit, feeding it when it is hurt.
 */

import { Block } from '@shared/blocks.js';
import { Item } from '@shared/items.js';
import { MobKind } from '@shared/mobs.js';
import { WOOL_REGROW, type Mob } from '../mobs.js';
import { registerMobUse, type GameContext } from './api.js';

/**
 * Chance a bone wins a wild wolf over. One in three: taming should cost a
 * few bones, so a loyal wolf feels earned rather than bought.
 */
export const TAME_CHANCE = 1 / 3;

/** Health a tamed wolf gets back from a piece of meat. */
const MEAT_HEAL = 4;
const MEATS: ReadonlySet<number> = new Set([
  Item.RawPorkchop, Item.CookedPorkchop, Item.RawBeef, Item.Steak,
  Item.RawMutton, Item.CookedMutton, Item.RawChicken, Item.CookedChicken,
  Item.RawRabbit, Item.CookedRabbit,
]);

/**
 * Shears on a woolly sheep: one to three white wool fall off and the sheep
 * is left bare until its fleece grows back.
 */
export function shearSheep(ctx: GameContext, mob: Mob): boolean {
  if (mob.kind !== MobKind.Sheep || mob.dead || mob.sheared) return false;
  mob.sheared = true;
  mob.woolTimer = WOOL_REGROW[0] + ctx.random() * (WOOL_REGROW[1] - WOOL_REGROW[0]);
  const count = 1 + Math.floor(ctx.random() * 3);
  ctx.dropItem(mob.x, mob.y + mob.def.height * 0.8, mob.z, Block.WhiteWool, count);
  return true;
}

/**
 * A bone held out to a wild wolf. It is eaten either way; now and then the
 * wolf decides you are its person. An angry wolf will not be bought.
 */
export function offerBone(ctx: GameContext, mob: Mob): boolean {
  if (mob.kind !== MobKind.Wolf || mob.dead || mob.tamed || mob.angered) return false;
  if (!ctx.consumeHeld(1)) return false;
  if (ctx.random() < TAME_CHANCE) {
    mob.tamed = true;
    mob.sitting = false;
    mob.state = 'idle';
    mob.target = null;
    // A new companion starts at full strength.
    mob.health = mob.def.health;
    ctx.toast('The wolf is yours');
  } else {
    ctx.toast('The wolf eats the bone and eyes you warily');
  }
  return true;
}

/** An empty hand on your own wolf: sit, or come along again. */
export function toggleSit(ctx: GameContext, mob: Mob): boolean {
  if (mob.kind !== MobKind.Wolf || mob.dead || !mob.tamed) return false;
  mob.sitting = !mob.sitting;
  mob.target = null;
  ctx.toast(mob.sitting ? 'Your wolf sits and waits' : 'Your wolf follows you');
  return true;
}

/** Meat for a hurt companion. */
export function feedWolf(ctx: GameContext, mob: Mob, held: number): boolean {
  if (mob.kind !== MobKind.Wolf || mob.dead || !mob.tamed || !MEATS.has(held)) return false;
  if (mob.health >= mob.def.health) return false;
  if (!ctx.consumeHeld(1)) return false;
  mob.health = Math.min(mob.def.health, mob.health + MEAT_HEAL);
  return true;
}

registerMobUse((ctx, mob) => {
  const held = ctx.heldItem();
  if (held === Item.Shears) return shearSheep(ctx, mob);
  if (held === Item.Bone) return offerBone(ctx, mob);
  if (held === null) return toggleSit(ctx, mob);
  return feedWolf(ctx, mob, held);
});
