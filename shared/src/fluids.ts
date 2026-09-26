/**
 * Fluid rules that need the block registry.
 *
 * shared/src/content/fluids.ts says what the fluid states *are* and can only
 * see ids. The questions here need to know what other blocks are like --
 * is this solid, is that a flower -- so they live beside the registry, where
 * the client (flow, physics, rendering) and the server (what edits to take)
 * can both ask them and never disagree.
 */

import { Block, blockDef, isSolid } from './blocks.js';
import {
  fluidHeight, fluidOf, isFlowing, isFluidSource, isLava, isWater, sameFluid,
} from './content/fluids.js';
import { crossOf } from './shapes.js';

export {
  FALLING_LEVEL, FLUIDS, LAVA_FLUID, SOURCE_HEIGHT, WATER_FLUID, fluidHeight, fluidLevel,
  fluidOf, isFalling, isFlowing, isFluidSource, isLava, isWater, sameFluid,
  type FluidKind,
} from './content/fluids.js';

/**
 * Would a current sweep this block away?
 *
 * Things with no body to stand against the water: plants drawn as crossed
 * planes (grass, flowers, crops, saplings, a cobweb), anything a placed
 * block simply overwrites (a snow layer), and small fittings like a torch.
 * Never something climbable -- a ladder holds the water back -- and never
 * anything with some heft to it: iron spikes and an item elevator are not
 * solid either, but a stream does not carry off machinery.
 */
export function isWashable(id: number): boolean {
  if (id === Block.Air) return false;
  const d = blockDef(id);
  if (d.solid || d.liquid || !d.breakable || d.climbable) return false;
  return d.replaceable || crossOf(id) !== null || d.hardness <= 0.5;
}

/** Can fluid move into a cell holding this, sweeping away whatever is there? */
export function canHoldFluid(id: number): boolean {
  return id === Block.Air || isWashable(id);
}

type Reader = (x: number, y: number, z: number) => number;

/**
 * Which way the fluid in this cell is running, as a unit horizontal vector,
 * or [0, 0] for still water (a lake, an ocean) and anything not a fluid.
 *
 * A current runs from a higher surface to a lower one: toward a neighbour of
 * the same fluid standing lower, and hardest toward an edge where the fluid
 * pours down into the cell below. An open neighbour with nothing under it
 * pulls nothing -- the thin rim of a spreading puddle does not drag you off
 * it.
 */
export function flowVector(get: Reader, x: number, y: number, z: number): [number, number] {
  const id = get(x, y, z);
  if (!fluidOf(id)) return [0, 0];
  const own = sameFluid(get(x, y + 1, z), id) ? 1 : fluidHeight(id);
  let fx = 0;
  let fz = 0;
  for (const [dx, dz] of HORIZONTAL) {
    const n = get(x + dx, y, z + dz);
    let delta = 0;
    if (sameFluid(n, id)) {
      delta = own - (sameFluid(get(x + dx, y + 1, z + dz), id) ? 1 : fluidHeight(n));
    } else if (!isSolid(n)) {
      // Over an edge: the surface it is heading for is a whole block lower.
      const below = get(x + dx, y - 1, z + dz);
      if (sameFluid(below, id)) delta = own - (fluidHeight(below) - 1);
    }
    fx += dx * delta;
    fz += dz * delta;
  }
  const len = Math.hypot(fx, fz);
  return len < 1e-6 ? [0, 0] : [fx / len, fz / len];
}

const HORIZONTAL: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Is changing `current` to `next` something a fluid does on its own?
 *
 * The server only takes edits within a player's arm's reach, but a stream
 * runs well past that: a bucket poured at the top of a cliff lands twenty
 * blocks below. These edits are the ones allowed from further off: fluid
 * spreading into open space, drying up, changing level, sweeping a flower
 * away, and water and lava setting into stone where they meet. Placing a
 * lava source from across the map is not among them.
 */
export function isFluidEdit(current: number, next: number): boolean {
  // Spreading, changing level, two sources making a third (water only).
  if (isFlowing(next)) return canHoldFluid(current) || sameFluid(current, next);
  if (next === Block.Water) return isWater(current) && !isFluidSource(current);
  // Drying up, and a current sweeping something away.
  if (next === Block.Air) return isFlowing(current) || isWashable(current);
  // Where lava and water meet.
  if (next === Block.Obsidian) return current === Block.Lava;
  if (next === Block.Cobblestone) return isLava(current) && !isFluidSource(current);
  if (next === Block.Stone) return (isLava(current) && !isFluidSource(current)) || isWater(current);
  return false;
}
