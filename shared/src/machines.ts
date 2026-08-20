/**
 * Machine rules: what each machine block does, and what smelts into what.
 *
 * Lives in shared because a server that ever runs these authoritatively has
 * to reach the same answers the client does. Everything here is pure -- no
 * world access, no entities -- so it can be tested directly.
 */

import { Block } from './blocks.js';

/** Unit vectors for the four conveyor facings, in block coordinates. */
export const CONVEYOR_FACING: Partial<Record<Block, readonly [number, number]>> = {
  [Block.ConveyorNorth]: [0, -1],
  [Block.ConveyorEast]: [1, 0],
  [Block.ConveyorSouth]: [0, 1],
  [Block.ConveyorWest]: [-1, 0],
};

export function isConveyor(block: number): boolean {
  return block in CONVEYOR_FACING;
}

/** Which conveyor variant a player looking along `yaw` should place. */
export function conveyorForYaw(yaw: number): Block {
  // Snap to the nearest quarter turn. Yaw grows clockwise from -Z.
  const turns = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  return [
    Block.ConveyorNorth, Block.ConveyorEast,
    Block.ConveyorSouth, Block.ConveyorWest,
  ][turns];
}

/** Blocks that hold an inventory a machine can push items into. */
export function acceptsItems(block: number): boolean {
  return block === Block.Chest || block === Block.Furnace ||
    block === Block.Collector || block === Block.Sorter ||
    // An incinerator takes anything, which is the point of it.
    block === Block.Incinerator;
}

/**
 * How a sorter decides what to keep.
 *
 * A sorter holds a filter -- the items placed in it are the pattern, not
 * cargo. Anything matching the filter is diverted into whatever the sorter
 * feeds; everything else rides straight past on the belt. An empty filter
 * matches nothing, so a freshly placed sorter is inert rather than a
 * black hole that swallows a whole production line.
 */
export function sorterAccepts(filter: ReadonlyArray<{ id: number }>, id: number): boolean {
  return filter.some((f) => f.id === id);
}

/**
 * Seconds to smelt one item. What something smelts *into*, and how far a
 * fuel goes, already live in items.ts as `smeltResult` and `fuelValue` --
 * this only adds the timing a running furnace needs.
 */
export const SMELT_SECONDS = 5;

/** Machine tick rate. Slow enough to be cheap, fast enough to feel alive. */
export const MACHINE_HZ = 5;

/** Blocks per second a conveyor pushes an item along its facing. */
export const CONVEYOR_SPEED = 2.6;

/** How far a collector reaches for loose items. */
export const COLLECTOR_RANGE = 3.5;

/** Seconds between a miner breaking one block and the next. */
export const MINER_PERIOD = 2.5;

/*
 * Energy lives in novolt.ts now. What remains here is the machine timing and
 * routing that the energy model multiplies, kept apart from it so the two can
 * be reasoned about separately.
 */



/**
 * A solar panel's output, from the sky brightness where it stands.
 *
 * Returns machines-supplied, so it slots into the same capacity budget a
 * fuelled generator uses. It falls to nothing at night and is halved by
 * rain, which is what makes a battery worth building rather than optional.
 */
export function solarOutput(skyBrightness: number, exposed: boolean, raining: boolean): number {
  if (!exposed) return 0;
  const light = raining ? skyBrightness * 0.45 : skyBrightness;
  if (light < 0.35) return 0;
  return light > 0.75 ? 2 : 1;
}

/** Seconds of burn a full battery holds. */
export const BATTERY_CAPACITY = 90;

/** How fast an elevator lifts an item, in blocks per second. */
export const ELEVATOR_SPEED = 4.5;



/** Seconds a crusher takes to process one item, before any speedup. */
export const CRUSH_SECONDS = 4;
