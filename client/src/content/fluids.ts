/**
 * How water and lava flow. The states are defined in
 * shared/src/content/fluids.ts; this file moves them about.
 *
 * The model is a queue of cells waiting to be looked at, each due a fixed
 * time after it was queued -- a quarter of a second for water, a second and a
 * half for lava. Looking at a cell does three things, in order:
 *
 *  1. Lava touching water sets: a source into obsidian, flowing lava into
 *     cobblestone, or into stone where the water came down on top of it.
 *  2. A cell that is not a source takes the level its neighbours give it: a
 *     column falling straight down if the same fluid is above, otherwise one
 *     weaker than the strongest horizontal neighbour, or nothing at all when
 *     nothing feeds it -- which is how a stream dries up, a step at a time,
 *     once its source is gone. Two water sources over a floor make a third.
 *  3. It spreads: straight down if it can, else sideways one level weaker,
 *     toward the nearest drop within a few blocks if there is one, the way a
 *     stream runs for a cliff edge rather than pooling.
 *
 * Any change queues the cell and the fluid around it again, so a flood
 * moves outward one ring per update and stops by itself when nothing
 * changes. Nothing is queued unless something changed: a world full of
 * oceans loads and sits still, and only water somebody disturbs moves.
 *
 * Work is bounded per frame -- a number of cells looked at and a number of
 * blocks changed -- so a broken dam slows down rather than stalling the
 * game, and the queue itself has a ceiling.
 *
 * Every change is an ordinary block edit, like falling sand: the server sees
 * blocks placed and removed, and needs to know nothing about fluids beyond
 * letting these edits happen further away than a player can reach (see
 * isFluidEdit in shared/src/fluids.ts). Only the client that caused a
 * change simulates it; the others receive the result.
 */

import { Block, isSolid } from '@shared/blocks.js';
import {
  FLUIDS, canHoldFluid, fluidLevel, fluidOf, isFalling, isFlowing, isFluidSource, isLava, isWashable,
  isWater, sameFluid, type FluidKind,
} from '@shared/fluids.js';
import {
  registerAfterPlace, registerNeighbourChange, registerSystem, type GameContext, type GameSystem,
} from './api.js';

// --- tuning ------------------------------------------------------------------------

/** Cells looked at per frame, at most. */
export const UPDATE_BUDGET = 384;
/**
 * Blocks changed per frame, at most. Each change is a network message and
 * seven neighbour notes, so this is the tighter limit in a real flood.
 */
export const EDIT_BUDGET = 32;
/** Cells waiting at once, at most. Past this a flood simply stops spreading. */
export const MAX_QUEUED = 16384;

const HORIZONTAL: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const AROUND: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** One number per cell, for the queued set. Good for |x|, |z| < 2^20, 0 <= y < 128. */
function cellKey(x: number, y: number, z: number): number {
  return ((x + 0x100000) * 0x200000 + (z + 0x100000)) * 128 + y;
}

interface Due {
  x: number;
  y: number;
  z: number;
  /** On the flow's own clock. */
  at: number;
}

/** A first-in, first-out list. Every entry of one fluid waits equally long, so this is also due order. */
class Queue {
  private items: Due[] = [];
  private head = 0;

  get size(): number {
    return this.items.length - this.head;
  }

  push(d: Due): void {
    this.items.push(d);
  }

  peek(): Due | undefined {
    return this.items[this.head];
  }

  shift(): Due {
    const d = this.items[this.head++];
    // Drop the consumed front now and then, rather than on every shift.
    if (this.head > 1024 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return d;
  }

  clear(): void {
    this.items = [];
    this.head = 0;
  }
}

export class FluidFlow {
  private readonly queues = new Map<FluidKind, Queue>(FLUIDS.map((f) => [f, new Queue()]));
  private readonly queued = new Set<number>();
  private clock = 0;
  private edits = 0;
  private soundThisFrame = false;
  /** Work done in the last frame, for tests and the debug overlay. */
  readonly last = { updates: 0, edits: 0 };
  /** The most cells ever waiting at once, for tests. */
  peakQueued = 0;

  /** Cells waiting to be looked at. */
  get pending(): number {
    return this.queued.size;
  }

  /**
   * Queues the fluid in this cell to be looked at once its delay is up.
   * Anything that is not a fluid is ignored. False if nothing was queued.
   */
  schedule(ctx: GameContext, x: number, y: number, z: number): boolean {
    const fluid = fluidOf(ctx.getBlock(x, y, z));
    if (!fluid || y < 1) return false;
    const key = cellKey(x, y, z);
    if (this.queued.has(key)) return false;
    if (this.queued.size >= MAX_QUEUED) return false;
    this.queued.add(key);
    this.queues.get(fluid)!.push({ x, y, z, at: this.clock + fluid.tick });
    if (this.queued.size > this.peakQueued) this.peakQueued = this.queued.size;
    return true;
  }

  update(ctx: GameContext, dt: number): void {
    this.clock += dt;
    this.edits = 0;
    this.soundThisFrame = false;
    let updates = 0;
    // Lava first: it is rare and slow, and a water flood using up the
    // budget should not leave a lava fall hanging.
    for (const fluid of [...FLUIDS].reverse()) {
      const queue = this.queues.get(fluid)!;
      while (updates < UPDATE_BUDGET && this.edits < EDIT_BUDGET) {
        const next = queue.peek();
        if (!next || next.at > this.clock) break;
        queue.shift();
        this.queued.delete(cellKey(next.x, next.y, next.z));
        updates++;
        this.tick(ctx, next.x, next.y, next.z);
      }
    }
    this.last.updates = updates;
    this.last.edits = this.edits;
  }

  reset(): void {
    for (const q of this.queues.values()) q.clear();
    this.queued.clear();
    this.clock = 0;
    this.peakQueued = 0;
    this.last.updates = 0;
    this.last.edits = 0;
  }

  // --- one cell ------------------------------------------------------------------------

  private tick(ctx: GameContext, x: number, y: number, z: number): void {
    let id = ctx.getBlock(x, y, z);
    const fluid = fluidOf(id);
    if (!fluid) return;
    if (!ctx.world.isLoaded(x, z)) return;
    if (isLava(id) && this.meet(ctx, x, y, z)) return;

    // Unloaded columns read as air, which would dry up a stream fed from
    // beyond the edge of what has streamed in. Beside unknown ground a cell
    // keeps its level; it still spreads into what is known (see passable).
    if (!isFluidSource(id) && this.loadedAround(ctx, x, z)) {
      const want = this.fed(ctx, x, y, z, fluid);
      if (want !== id) {
        if (!this.set(ctx, x, y, z, want) || want === Block.Air) return;
        id = want;
      }
    }
    this.spread(ctx, x, y, z, id, fluid);
  }

  /**
   * What a non-source cell should be, from what feeds it: falling when the
   * same fluid is above, else one level weaker than its strongest horizontal
   * neighbour, else air.
   */
  private fed(ctx: GameContext, x: number, y: number, z: number, fluid: FluidKind): number {
    if (fluidOf(ctx.getBlock(x, y + 1, z)) === fluid) return fluid.falling;
    let strongest = Infinity;
    let sources = 0;
    for (const [dx, dz] of HORIZONTAL) {
      const n = ctx.getBlock(x + dx, y, z + dz);
      if (fluidOf(n) !== fluid) continue;
      if (isFluidSource(n)) sources++;
      strongest = Math.min(strongest, fluidLevel(n));
    }
    if (fluid.infinite && sources >= 2) {
      // Only over something that holds it: a floor, or more still water.
      const below = ctx.getBlock(x, y - 1, z);
      if (isSolid(below) || below === fluid.source) return fluid.source;
    }
    const level = strongest + 1;
    return level > fluid.flows.length ? Block.Air : fluid.flows[level - 1];
  }

  private spread(ctx: GameContext, x: number, y: number, z: number, id: number, fluid: FluidKind): void {
    const below = y > 1 ? ctx.getBlock(x, y - 1, z) : Block.Stone;
    if (fluid.name === 'lava' && isWater(below)) {
      // Lava pouring onto water sets it to stone, and goes no further.
      this.set(ctx, x, y - 1, z, Block.Stone);
      return;
    }
    const downInto = canHoldFluid(below) ||
      (sameFluid(below, id) && isFlowing(below) && !isFalling(below));
    if (downInto) {
      this.flowInto(ctx, x, y - 1, z, fluid.falling);
      return;
    }
    // Over a column of itself only a source spreads sideways: a waterfall
    // landing in a lake does not also run across its surface.
    if (!isFluidSource(id) && sameFluid(below, id)) return;
    const level = fluidLevel(id) + 1;
    if (level > fluid.flows.length) return;
    const into = fluid.flows[level - 1];
    for (const [dx, dz] of this.preferred(ctx, x, y, z, fluid)) {
      if (canHoldFluid(ctx.getBlock(x + dx, y, z + dz))) this.flowInto(ctx, x + dx, y, z + dz, into);
    }
  }

  /**
   * The horizontal directions a spreading edge should take: the ones
   * leading soonest to somewhere it can pour down, within the fluid's
   * search distance; every open direction if there is no drop in reach.
   */
  private preferred(
    ctx: GameContext, x: number, y: number, z: number, fluid: FluidKind,
  ): Array<readonly [number, number]> {
    let best = Infinity;
    let out: Array<readonly [number, number]> = [];
    for (const dir of HORIZONTAL) {
      const nx = x + dir[0];
      const nz = z + dir[1];
      if (!this.passable(ctx, nx, y, nz, fluid)) continue;
      const d = this.dropDistance(ctx, nx, y, nz, x, z, fluid);
      if (d < best) {
        best = d;
        out = [dir];
      } else if (d === best) {
        out.push(dir);
      }
    }
    return out;
  }

  /** Could fluid travel through this cell: open, or flowing fluid of its own kind. */
  private passable(ctx: GameContext, x: number, y: number, z: number, fluid: FluidKind): boolean {
    if (!ctx.world.isLoaded(x, z)) return false;
    const id = ctx.getBlock(x, y, z);
    return canHoldFluid(id) || (fluidOf(id) === fluid && !isFluidSource(id));
  }

  /** Is there somewhere to pour down into, under this cell? */
  private dropBelow(ctx: GameContext, x: number, y: number, z: number, fluid: FluidKind): boolean {
    if (y <= 1) return false;
    const below = ctx.getBlock(x, y - 1, z);
    return canHoldFluid(below) || fluidOf(below) === fluid;
  }

  /**
   * Steps from (sx, sz) to the nearest drop, searching open cells
   * breadth-first up to the fluid's slope distance and never back through
   * the cell the search started beside. Infinity when there is none.
   */
  private dropDistance(
    ctx: GameContext, sx: number, y: number, sz: number, fromX: number, fromZ: number, fluid: FluidKind,
  ): number {
    if (this.dropBelow(ctx, sx, y, sz, fluid)) return 0;
    const seen = new Set<number>([cellKey(fromX, 0, fromZ), cellKey(sx, 0, sz)]);
    let frontier: Array<[number, number]> = [[sx, sz]];
    for (let depth = 1; depth <= fluid.slopeDistance; depth++) {
      const next: Array<[number, number]> = [];
      for (const [cx, cz] of frontier) {
        for (const [dx, dz] of HORIZONTAL) {
          const nx = cx + dx;
          const nz = cz + dz;
          const key = cellKey(nx, 0, nz);
          if (seen.has(key)) continue;
          seen.add(key);
          if (!this.passable(ctx, nx, y, nz, fluid)) continue;
          if (this.dropBelow(ctx, nx, y, nz, fluid)) return depth;
          next.push([nx, nz]);
        }
      }
      frontier = next;
    }
    return Infinity;
  }

  /** Moves fluid into a cell, sweeping away whatever small thing stands there. */
  private flowInto(ctx: GameContext, x: number, y: number, z: number, id: number): void {
    const current = ctx.getBlock(x, y, z);
    if (isWashable(current)) {
      // Broken the way mining it would be, drops and all.
      ctx.breakBlock(x, y, z);
      this.edits++;
      if (ctx.getBlock(x, y, z) !== Block.Air) return;
    }
    this.set(ctx, x, y, z, id);
  }

  /**
   * Lava at this cell meeting water: a source sets to obsidian; flowing
   * lava to stone where the water is on top of it, to cobblestone where it
   * is beside it. True if it set.
   */
  meet(ctx: GameContext, x: number, y: number, z: number): boolean {
    const id = ctx.getBlock(x, y, z);
    if (!isLava(id)) return false;
    const above = isWater(ctx.getBlock(x, y + 1, z));
    let beside = false;
    for (const [dx, dz] of HORIZONTAL) if (isWater(ctx.getBlock(x + dx, y, z + dz))) beside = true;
    if (!above && !beside) return false;
    const result = isFluidSource(id) ? Block.Obsidian : above ? Block.Stone : Block.Cobblestone;
    if (!this.set(ctx, x, y, z, result)) return false;
    ctx.breakParticles(x, y, z, Block.Lava);
    if (!this.soundThisFrame && near(ctx, x, y, z)) {
      this.soundThisFrame = true;
      ctx.sound.blockPlace(result);
    }
    return true;
  }

  /**
   * One block edit, and everything it wakes: the cell itself and the fluid
   * around it are queued again, and lava it now touches water with sets at
   * once rather than after its own long delay.
   */
  private set(ctx: GameContext, x: number, y: number, z: number, id: number): boolean {
    if (!ctx.setBlock(x, y, z, id)) return false;
    this.edits++;
    for (const [dx, dy, dz] of AROUND) {
      const n = ctx.getBlock(x + dx, y + dy, z + dz);
      if (isLava(n) && this.meet(ctx, x + dx, y + dy, z + dz)) continue;
      this.schedule(ctx, x + dx, y + dy, z + dz);
    }
    return true;
  }

  private loadedAround(ctx: GameContext, x: number, z: number): boolean {
    const w = ctx.world;
    return w.isLoaded(x, z) && w.isLoaded(x + 1, z) && w.isLoaded(x - 1, z) &&
      w.isLoaded(x, z + 1) && w.isLoaded(x, z - 1);
  }
}

/** Close enough to the player for a hiss to be worth playing. */
function near(ctx: GameContext, x: number, y: number, z: number): boolean {
  const p = ctx.player;
  return (x + 0.5 - p.x) ** 2 + (y + 0.5 - p.y) ** 2 + (z + 0.5 - p.z) ** 2 < 24 * 24;
}

// --- wiring --------------------------------------------------------------------------

export const flow = new FluidFlow();

/** Every id a fluid can take. */
export const FLUID_IDS: readonly number[] = FLUIDS.flatMap((f) => [f.source, ...f.flows, f.falling]);

// Something changed beside a fluid, or the fluid itself changed: look at it.
// Lava checks for water at once, so pouring a bucket beside it sets it
// before it has a chance to spread.
registerNeighbourChange([...FLUID_IDS], (ctx, x, y, z, id) => {
  if (isLava(id) && flow.meet(ctx, x, y, z)) return;
  flow.schedule(ctx, x, y, z);
}, { localOnly: true });

// A source put down from the creative menu. A bucket's goes through setBlock
// and is caught above, like any other change.
registerAfterPlace([Block.Water, Block.Lava], (ctx, x, y, z) => {
  flow.schedule(ctx, x, y, z);
});

export const fluidSystem: GameSystem = {
  name: 'fluids',
  update(ctx, dt) {
    flow.update(ctx, dt);
  },
  reset() {
    flow.reset();
  },
};
registerSystem(fluidSystem);
