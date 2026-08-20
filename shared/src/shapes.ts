/**
 * Block shapes: what a block actually occupies, as opposed to the cell it
 * lives in.
 *
 * Everything used to be a full cube, which is fine for stone and wrong for
 * every machine. A conveyor is a belt you walk over, not a wall you climb;
 * a cable is a thin run, not a solid block. Making those read correctly means
 * the same description has to drive three things at once -- what is drawn,
 * what you bump into, and what the highlight outlines -- because a hitbox
 * that disagrees with the picture is worse than no hitbox at all.
 *
 * Coordinates are 0..1 inside the cell, y up. A shape is a list of boxes, so
 * a machine can be a slab with a post on top without needing a mesh format.
 */

import { Block } from './blocks.js';

/** An axis-aligned box in cell-local space, 0..1 on each axis. */
export interface Box {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
}

/** The whole cell. Anything without its own shape uses this. */
export const FULL_BOX: Box = { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 };
const FULL: Box[] = [FULL_BOX];

/** A slab of the given height, sitting on the cell floor. */
function slab(height: number): Box[] {
  return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: height, z1: 1 }];
}

/** A square post running the full height, inset from the cell walls. */
function post(inset: number): Box[] {
  return [{ x0: inset, y0: 0, z0: inset, x1: 1 - inset, y1: 1, z1: 1 - inset }];
}

/**
 * Belt height. Low enough to step onto without jumping -- a conveyor you have
 * to hop over would be miserable to build a factory around.
 */
export const CONVEYOR_HEIGHT = 3 / 16;

/** How far a cable is inset from the cell wall on each side. */
export const CABLE_INSET = 5 / 16;

/** Tubes are fatter than cables: cargo travels inside them. */
export const TUBE_INSET = 3 / 16;

/**
 * Where a machine's housing starts above the belt it straddles.
 *
 * Not at belt height. Cargo rests exactly on the belt, so a housing starting
 * exactly there decides whether an item is blocked on a margin of half a
 * thousandth -- and a conveyor that intermittently refuses to carry things
 * is a bug nobody could reproduce on purpose. Leaving 4/16 of clear air makes
 * these read as gantries over the line, with the cargo visible underneath.
 */
export const GANTRY_BASE = 7 / 16;

const SHAPES: Partial<Record<Block, Box[]>> = {
  // Belts: a low slab you walk across.
  [Block.Conveyor]: slab(CONVEYOR_HEIGHT),
  [Block.ConveyorNorth]: slab(CONVEYOR_HEIGHT),
  [Block.ConveyorEast]: slab(CONVEYOR_HEIGHT),
  [Block.ConveyorSouth]: slab(CONVEYOR_HEIGHT),
  [Block.ConveyorWest]: slab(CONVEYOR_HEIGHT),

  // A sorter splits a belt, so it sits at belt height with a raised housing
  // in the middle -- tall enough to read as a machine from across the room,
  // short enough that it does not wall the line off.
  [Block.Sorter]: [
    { x0: 0, y0: 0, z0: 0, x1: 1, y1: CONVEYOR_HEIGHT, z1: 1 },
    { x0: 4 / 16, y0: GANTRY_BASE, z0: 4 / 16, x1: 12 / 16, y1: 13 / 16, z1: 12 / 16 },
  ],

  // Conduit: a thin run. Walkable past rather than through.
  [Block.Cable]: post(CABLE_INSET),

  // A collector sits low and wide, like a hopper mouth.
  [Block.Collector]: slab(10 / 16),

  // Panels are flat to the ground; a solar panel you could hide behind would
  // be strange, and it has to catch sky anyway.
  [Block.SolarPanel]: slab(2 / 16),

  // A splitter is a belt with a low dome over the middle: it has to read as
  // machinery from above, where you are looking when you build a line, but
  // stay low enough to walk over like the belt it interrupts.
  [Block.Splitter]: [
    { x0: 0, y0: 0, z0: 0, x1: 1, y1: CONVEYOR_HEIGHT, z1: 1 },
    { x0: 3 / 16, y0: GANTRY_BASE, z0: 3 / 16, x1: 13 / 16, y1: 11 / 16, z1: 13 / 16 },
  ],

  // A filter is a belt with a gate across it, so you can see which way it
  // is set from a distance.
  [Block.Filter]: [
    { x0: 0, y0: 0, z0: 0, x1: 1, y1: CONVEYOR_HEIGHT, z1: 1 },
    { x0: 1 / 16, y0: GANTRY_BASE, z0: 6 / 16, x1: 15 / 16, y1: 14 / 16, z1: 10 / 16 },
  ],

  // Tubes are pipes. Wider than a cable, because items travel inside them
  // and a pipe you cannot see the cargo in is just a cable.
  [Block.Tube]: post(TUBE_INSET),

  // The booster is an inline device on a cable run, so it keeps the cable's
  // footprint and thickens in the middle.
  [Block.Booster]: [
    { x0: CABLE_INSET, y0: 0, z0: CABLE_INSET, x1: 1 - CABLE_INSET, y1: 1, z1: 1 - CABLE_INSET },
    { x0: 3 / 16, y0: 3 / 16, z0: 3 / 16, x1: 13 / 16, y1: 13 / 16, z1: 13 / 16 },
  ],
};

/**
 * The boxes a block occupies.
 *
 * Returns the shared FULL array for ordinary blocks, which is most of them --
 * this is called per cell in the collision inner loop, so it must not
 * allocate.
 */
export function shapeOf(block: number): Box[] {
  return SHAPES[block as Block] ?? FULL;
}

/** True when the block fills its cell, so the cheap paths apply. */
export function isFullCube(block: number): boolean {
  return shapeOf(block) === FULL;
}

/** The smallest box containing every box of the shape. Used for highlights. */
export function boundingBox(block: number): Box {
  const boxes = shapeOf(block);
  if (boxes.length === 1) return boxes[0];
  const out = { ...boxes[0] };
  for (const b of boxes) {
    if (b.x0 < out.x0) out.x0 = b.x0;
    if (b.y0 < out.y0) out.y0 = b.y0;
    if (b.z0 < out.z0) out.z0 = b.z0;
    if (b.x1 > out.x1) out.x1 = b.x1;
    if (b.y1 > out.y1) out.y1 = b.y1;
    if (b.z1 > out.z1) out.z1 = b.z1;
  }
  return out;
}

/**
 * Height of the surface a body standing in this cell would rest on, or null
 * if nothing in the shape supports it.
 *
 * Only boxes that reach the cell floor count: a shape floating in the middle
 * of its cell is something you walk under, not something you stand on.
 */
export function supportHeight(block: number): number | null {
  let best: number | null = null;
  for (const b of shapeOf(block)) {
    if (b.y0 > 0.0001) continue;
    if (best === null || b.y1 > best) best = b.y1;
  }
  return best;
}
