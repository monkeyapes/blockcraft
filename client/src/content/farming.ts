/**
 * How the farming pack behaves in play. Its blocks and items are defined in
 * shared/src/content/farming.ts; this file registers what they *do* through the
 * hooks in ./api.ts. Imported for its side effects by ./index.ts.
 *
 * The loop is the familiar one: till soil with a hoe, keep water near it,
 * plant, wait, harvest, replant. Everything that changes a block goes
 * through ctx.setBlock, so the server's replace rule -- the farmland family
 * and the pack's declared transitions -- is what makes each step legal in
 * multiplayer.
 */

import { Block, isSolid } from '@shared/blocks.js';
import { Item } from '@shared/items.js';
import { CROPS, CROP_BLOCKS, cropAt, isFarmland, type CropKind } from '@shared/content/farming.js';
import {
  registerBreak, registerItemUse, registerNeighbourChange, registerPlacement, registerRandomTick,
  registerSystem, type GameContext, type PlaceContext, type UseContext,
} from './api.js';

const HOES = [Item.WoodHoe, Item.StoneHoe, Item.IronHoe, Item.DiamondHoe];

/** Water this far away sideways, level with the soil or one above, keeps it wet. */
export const HYDRATION_RANGE = 4;
/**
 * The chance a crop grows a stage when a random tick finds it. A cell is
 * visited about once a minute, so a hydrated field ripens in six minutes or
 * so and a dry one takes three times as long -- slow enough that watering
 * a field is worth the trouble, quick enough that a dry one still pays.
 */
export const WET_GROWTH = 0.45;
export const DRY_GROWTH = 0.15;
/** Crops stall below this much light, sky or torch, as a plant in a cellar would. */
export const MIN_GROW_LIGHT = 9;
/** Dry, bare farmland gives up and turns back to dirt at this chance per visit. */
export const DRY_REVERT = 0.25;
/**
 * Landing faster than this (blocks per second, downward) tramples farmland.
 * A jump comes down at about 8.8, stepping off a one-block ledge at about 7.5,
 * walking down the sixteenth from a grass block onto soil at under 2.
 */
export const TRAMPLE_SPEED = 5;

/** Is there water in reach of the soil at this cell? */
export function isHydrated(ctx: GameContext, x: number, y: number, z: number): boolean {
  for (let dy = 0; dy <= 1; dy++) {
    for (let dz = -HYDRATION_RANGE; dz <= HYDRATION_RANGE; dz++) {
      for (let dx = -HYDRATION_RANGE; dx <= HYDRATION_RANGE; dx++) {
        if (ctx.getBlock(x + dx, y + dy, z + dz) === Block.Water) return true;
      }
    }
  }
  return false;
}

/** The brighter of sunlight and torchlight at a cell, 0-15. */
function lightAt(ctx: GameContext, x: number, y: number, z: number): number {
  return Math.max(ctx.world.getSkyLight(x, y, z), ctx.world.getBlockLight(x, y, z));
}

/** A crop's stage `stage` steps on from where it is, stopping at ripe. */
function advance(crop: CropKind, stage: number, steps: number): number {
  return crop.stages[Math.min(crop.stages.length - 1, stage + steps)];
}

// --- tilling ------------------------------------------------------------------

/**
 * A hoe on the top of dirt or grass with nothing above it turns it to
 * farmland. Soil that is already in reach of water comes up wet, so a
 * freshly dug bed by a stream looks watered at once instead of a minute on.
 */
registerItemUse(HOES, (ctx: UseContext) => {
  if (ctx.id !== Block.Dirt && ctx.id !== Block.Grass) return false;
  if (ctx.face[1] !== 1) return false;
  if (ctx.getBlock(ctx.x, ctx.y + 1, ctx.z) !== Block.Air) return false;
  const soil = isHydrated(ctx, ctx.x, ctx.y, ctx.z) ? Block.FarmlandWet : Block.Farmland;
  if (!ctx.setBlock(ctx.x, ctx.y, ctx.z, soil)) return false;
  ctx.sound.blockPlace(Block.Dirt);
  return true;
});

// --- planting -------------------------------------------------------------------

/**
 * Seeds, carrots and potatoes plant straight into the farmland they are
 * pointed at. This runs as an item use rather than only as a placement so
 * it comes before eating: a hungry player right-clicking a bed with a carrot
 * means to plant it, not to eat it.
 */
for (const crop of CROPS) {
  const sprout = crop.stages[0];
  registerItemUse(crop.seed, (ctx: UseContext) => {
    if (!isFarmland(ctx.id) || ctx.face[1] !== 1) return false;
    if (ctx.getBlock(ctx.x, ctx.y + 1, ctx.z) !== Block.Air) return false;
    if (!ctx.setBlock(ctx.x, ctx.y + 1, ctx.z, sprout)) return false;
    ctx.consumeHeld(1);
    ctx.sound.blockPlace(sprout);
    return true;
  });
  // Any other way of placing one -- held right-click sweeping across a bed,
  // clicking the side of a neighbour -- still has to land on farmland.
  registerPlacement(crop.seed, (ctx: PlaceContext) =>
    isFarmland(ctx.getBlock(ctx.px, ctx.py - 1, ctx.pz)) ? sprout : null);
}

// --- growing ----------------------------------------------------------------------

/**
 * One random visit to a crop: it grows a stage by chance, faster on wet
 * soil, not at all in the dark, and never past ripe. Exported so the tests
 * can measure the odds directly.
 */
export function cropTick(ctx: GameContext, x: number, y: number, z: number, id: number): void {
  const at = cropAt(id);
  if (!at) return;
  const soil = ctx.getBlock(x, y - 1, z);
  if (!isFarmland(soil)) {
    ctx.breakBlock(x, y, z);
    return;
  }
  if (at.stage >= at.crop.stages.length - 1) return;
  if (lightAt(ctx, x, y, z) < MIN_GROW_LIGHT) return;
  const chance = soil === Block.FarmlandWet ? WET_GROWTH : DRY_GROWTH;
  if (ctx.random() < chance) ctx.setBlock(x, y, z, advance(at.crop, at.stage, 1));
}

/**
 * One random visit to farmland: it takes on the wet or dry look to match
 * whether water is in reach, and dry soil with nothing planted in it slowly
 * slumps back to dirt, as an abandoned bed does.
 */
export function farmlandTick(ctx: GameContext, x: number, y: number, z: number, id: number): void {
  if (isHydrated(ctx, x, y, z)) {
    if (id !== Block.FarmlandWet) ctx.setBlock(x, y, z, Block.FarmlandWet);
    return;
  }
  if (id === Block.FarmlandWet) {
    ctx.setBlock(x, y, z, Block.Farmland);
    return;
  }
  if (cropAt(ctx.getBlock(x, y + 1, z))) return;
  if (ctx.random() < DRY_REVERT) ctx.setBlock(x, y, z, Block.Dirt);
}

registerRandomTick([...CROP_BLOCKS], cropTick);
registerRandomTick([Block.Farmland, Block.FarmlandWet], farmlandTick);

// A crop with no farmland under it -- dug out, trampled, dried to dirt --
// pops off as an item, the way a torch drops when its wall goes.
registerNeighbourChange([...CROP_BLOCKS], (ctx, x, y, z) => {
  if (!isFarmland(ctx.getBlock(x, y - 1, z))) ctx.breakBlock(x, y, z);
});

// Building on farmland packs it back down: nothing can be tilled under a
// block, so the soil under a placed block is plain dirt again.
registerNeighbourChange([Block.Farmland, Block.FarmlandWet], (ctx, x, y, z) => {
  if (isSolid(ctx.getBlock(x, y + 1, z))) ctx.setBlock(x, y, z, Block.Dirt);
});

// --- bone meal -----------------------------------------------------------------

/**
 * Bone meal pushes a crop on one or two stages. A ripe crop is still
 * "handled" -- nothing happens and the meal is kept -- so the click does not
 * fall through to placing. Anything that is not a crop is left for the
 * nature pack's own bone-meal hook (saplings, grass).
 */
registerItemUse(Item.BoneMeal, (ctx: UseContext) => {
  const at = cropAt(ctx.id);
  if (!at) return false;
  if (at.stage >= at.crop.stages.length - 1) return true;
  const next = advance(at.crop, at.stage, ctx.random() < 0.5 ? 1 : 2);
  if (!ctx.setBlock(ctx.x, ctx.y, ctx.z, next)) return false;
  ctx.consumeHeld(1);
  ctx.breakParticles(ctx.x, ctx.y, ctx.z, next);
  return true;
});

// --- seeds in the wild ----------------------------------------------------------

/** Chance that clearing a tuft of tall grass turns up a wheat seed. */
export const GRASS_SEED_CHANCE = 1 / 8;

// The only way into farming in survival: tall grass hides seeds.
registerBreak(Block.TallGrass, (ctx, x, y, z) => {
  if (ctx.creative) return;
  if (ctx.random() < GRASS_SEED_CHANCE) ctx.dropItem(x + 0.5, y + 0.3, z + 0.5, Item.WheatSeeds, 1);
});

// --- trampling ------------------------------------------------------------------

/**
 * Coming down hard on farmland -- a jump, a drop off a ledge -- stamps it
 * back to dirt, and the crop on it pops off with it. Sneaking steps down
 * gently and spares the soil; so does flying in.
 *
 * The player's physics zeroes the fall speed on the frame it lands, so this
 * keeps last frame's speed and compares it on the frame `onGround` flips.
 */
export function createTrampleWatch(): { update(ctx: GameContext): void; reset(): void } {
  let wasOnGround = true;
  let lastVy = 0;
  return {
    update(ctx) {
      const p = ctx.player;
      const landed = p.onGround && !wasOnGround;
      const impact = lastVy;
      wasOnGround = p.onGround;
      lastVy = p.vy;
      if (!landed || p.flying || impact > -TRAMPLE_SPEED) return;
      // Player keeps `sneaking` private; it is read here rather than widened.
      if ((p as unknown as { sneaking?: boolean }).sneaking) return;
      const x = Math.floor(p.x);
      const y = Math.floor(p.y - 0.25);
      const z = Math.floor(p.z);
      if (isFarmland(ctx.getBlock(x, y, z))) ctx.setBlock(x, y, z, Block.Dirt);
    },
    reset() {
      wasOnGround = true;
      lastVy = 0;
    },
  };
}

const trample = createTrampleWatch();
registerSystem({
  name: 'farmland-trample',
  update: (ctx) => trample.update(ctx),
  reset: () => trample.reset(),
});
