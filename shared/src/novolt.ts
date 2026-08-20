/**
 * NoVolt (nV) -- the game's energy system.
 *
 * The defining idea is *pressure*, and that pressure is spatial. A source
 * pushes energy into a conduit run at some pressure; every block of conduit
 * bleeds a little of it away, and every machine drawing on the network drags
 * it down further. A machine runs when the pressure reaching it clears its
 * own minimum, and runs faster the more headroom it has above that.
 *
 * Two consequences give the system its character:
 *
 *   - Distance matters. A generator on the far side of a base genuinely
 *     powers a machine worse than one next to it, so layout is a real
 *     decision rather than a cosmetic one.
 *   - It degrades rather than trips. Adding one machine too many does not
 *     black the network out; everything slows, which tells you what is
 *     happening while you can still fix it.
 *
 * The name is the joke: there is no voltage anywhere in it.
 */

import { Block } from './blocks.js';

/** Pressure a source puts into the network, in nV. */
export const SOURCE_PRESSURE: Partial<Record<Block, number>> = {
  [Block.Generator]: 100,
  [Block.SolarPanel]: 60,
  [Block.Battery]: 80,
  // Steady and fuel-free, but it has to sit in water, which puts it where
  // your base probably is not -- that distance is the cost of it.
  [Block.WaterWheel]: 70,
};

/** Pressure lost per block of conduit travelled. */
export const LINE_LOSS = 3;

/** Pressure a booster restores a run to, and what it costs to do it. */
export const BOOSTER_OUTPUT = 90;
export const BOOSTER_DRAW = 10;

/** How hard each machine pulls the network down, and what it needs to run. */
interface Demand {
  /** Pressure this machine removes from the network while connected. */
  draw: number;
  /** Below this it does not run at all. */
  minimum: number;
}

const DEMAND: Partial<Record<Block, Demand>> = {
  [Block.Miner]: { draw: 20, minimum: 30 },
  [Block.Crusher]: { draw: 35, minimum: 50 },
  [Block.Furnace]: { draw: 15, minimum: 20 },
  [Block.Collector]: { draw: 10, minimum: 15 },
  [Block.Elevator]: { draw: 10, minimum: 15 },
  // The NoVolt-only machines. Their minimums are set above what a lone
  // solar panel manages at the end of a long run, so each one is a reason
  // to actually build out the network rather than tack another box on.
  [Block.StoneGenerator]: { draw: 15, minimum: 25 },
  [Block.ElectricFurnace]: { draw: 25, minimum: 35 },
  [Block.Sawmill]: { draw: 20, minimum: 30 },
  [Block.Compressor]: { draw: 25, minimum: 35 },
  [Block.Quarry]: { draw: 40, minimum: 60 },
  // Cheap to run, because its job is to unblock a jammed line and a disposal
  // you cannot afford to run is not a disposal. Splitters, filters and tubes
  // draw nothing at all -- they only decide where cargo goes, and charging
  // for that would tax building a tidy base.
  [Block.Incinerator]: { draw: 10, minimum: 15 },
};

export function demandOf(block: number): Demand | null {
  return DEMAND[block as Block] ?? null;
}

/** Blocks energy travels through. */
export function isConduit(block: number): boolean {
  return block === Block.Cable;
}

/** Blocks that put pressure into a network. */
export function isSource(block: number): boolean {
  return block in SOURCE_PRESSURE;
}

/** Blocks that draw on a network. */
export function isConsumer(block: number): boolean {
  return demandOf(block) !== null;
}

/** Machines that will not run at all without NoVolt. */
export function requiresNoVolt(block: number): boolean {
  return block === Block.Crusher || block === Block.StoneGenerator ||
    block === Block.ElectricFurnace || block === Block.Sawmill ||
    block === Block.Compressor || block === Block.Quarry ||
    // Throwing things away should cost something, or it becomes the answer
    // to every mildly inconvenient surplus.
    block === Block.Incinerator;
}

/** Seconds each NoVolt-only machine takes per operation, before boost. */
export const STONEGEN_SECONDS = 3;
export const ESMELT_SECONDS = 2.5;
export const SAWMILL_SECONDS = 2;
export const COMPRESS_SECONDS = 3;
export const QUARRY_SECONDS = 1.6;
/** How wide a square the quarry works, centred under itself. */
export const QUARRY_RADIUS = 1;
/** Planks a sawmill gets from one log, against four by hand. */
export const SAWMILL_YIELD = 6;

/**
 * How much faster a machine runs at a given pressure.
 *
 * One at its bare minimum, rising with headroom and capped so a wildly
 * over-provisioned network cannot trivialise the game. Below the minimum it
 * returns 0, which callers read as "not running".
 */
export const MAX_BOOST = 3;

export function boostAt(block: number, pressure: number): number {
  const demand = demandOf(block);
  if (!demand) return 1;
  if (pressure < demand.minimum) return 0;
  const headroom = (pressure - demand.minimum) / 45;
  return Math.min(MAX_BOOST, 1 + headroom);
}

/**
 * Pressure reaching a machine.
 *
 * Line loss is charged per block travelled; total network draw is shared
 * across every consumer, so each extra machine costs all of them a little.
 */
export function pressureAt(
  sourcePressure: number, distance: number, totalDraw: number,
): number {
  return Math.max(0, sourcePressure - distance * LINE_LOSS - totalDraw * 0.5);
}
