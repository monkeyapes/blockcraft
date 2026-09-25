/**
 * Blocks that fall: sand and gravel.
 *
 * A gravity block with nothing under it -- air, water, lava, or something a
 * block may simply overwrite, like tall grass -- leaves its cell and becomes
 * a falling block: drawn as itself, dropping straight down its column. It
 * comes to rest on the first solid thing below and puts itself back into
 * the world there. If what it lands on is neither solid nor overwritable --
 * a torch, a flower -- there is nowhere for it to sit, and it breaks into
 * an item instead, the way sand dropped on a torch always has.
 *
 * Everything is done through the ordinary block edits, so the server sees a
 * block removed and a block placed and needs to know nothing about falling.
 */

import { Block, blockDef, isLiquid, isReplaceable, isSolid } from '@shared/blocks.js';
import type { GameContext } from '../api.js';
import type { Atlas } from '../../gfx/atlas.js';
import { lightAt, substeps, type MeshBuilder } from './geometry.js';

/** Blocks that fall when nothing holds them up. */
export const GRAVITY_BLOCKS: readonly number[] = [Block.Sand, Block.Gravel];

const GRAVITY = 30;
const TERMINAL = 40;

export interface FallingBlock {
  id: number;
  /** The column it falls down. */
  x: number;
  z: number;
  /** Its bottom face, in world units. */
  y: number;
  vy: number;
  done: boolean;
}

/** May a falling block pass down through a cell holding this? */
function passable(id: number): boolean {
  return id === Block.Air || isLiquid(id) || isReplaceable(id);
}

/** Would a gravity block at this cell fall right now? */
export function unsupported(ctx: GameContext, x: number, y: number, z: number): boolean {
  if (y <= 0) return false;
  return passable(ctx.getBlock(x, y - 1, z));
}

export class FallingBlocks {
  readonly list: FallingBlock[] = [];
  /** What became of each block that came down, newest last. For tests. */
  readonly landings: Array<{ id: number; x: number; y: number; z: number; placed: boolean }> = [];

  /** Starts the block in this cell falling, if it should. Returns whether it did. */
  release(ctx: GameContext, x: number, y: number, z: number): boolean {
    const id = ctx.getBlock(x, y, z);
    if (!GRAVITY_BLOCKS.includes(id) || !unsupported(ctx, x, y, z)) return false;
    if (!ctx.setBlock(x, y, z, Block.Air)) return false;
    this.list.push({ id, x, z, y, vy: 0, done: false });
    return true;
  }

  update(ctx: GameContext, dt: number): void {
    substeps(dt, (step) => this.tick(ctx, step));
  }

  private tick(ctx: GameContext, step: number): void {
    for (const f of this.list) {
      if (f.done) continue;
      // A column that has not streamed in is unknown, not empty: wait for it.
      if (!ctx.world.isLoaded(f.x, f.z)) continue;
      f.vy = Math.max(-TERMINAL, f.vy - GRAVITY * step);
      const next = f.y + f.vy * step;
      // Every cell whose top the bottom face passes through this step.
      for (let cell = Math.ceil(f.y) - 1; cell >= Math.floor(next); cell--) {
        if (cell < 0) {
          f.done = true; // out of the world
          break;
        }
        const below = ctx.getBlock(f.x, cell, f.z);
        if (passable(below)) continue;
        this.land(ctx, f, cell + 1, isSolid(below));
        break;
      }
      if (!f.done) f.y = next;
    }
    let w = 0;
    for (const f of this.list) if (!f.done) this.list[w++] = f;
    this.list.length = w;
  }

  /**
   * Comes to rest with its bottom at `y`. On something solid it becomes a
   * block again, if the cell will take it; on anything else, or if it will
   * not, it breaks into an item where it stopped.
   */
  private land(ctx: GameContext, f: FallingBlock, y: number, onSolid: boolean): void {
    f.done = true;
    f.y = y;
    const placed = onSolid && ctx.setBlock(f.x, y, f.z, f.id);
    if (placed) ctx.sound.blockPlace(f.id);
    else ctx.dropItem(f.x + 0.5, y + 0.3, f.z + 0.5, f.id, 1);
    this.landings.push({ id: f.id, x: f.x, y, z: f.z, placed });
    if (this.landings.length > 64) this.landings.shift();
  }

  draw(ctx: GameContext, out: MeshBuilder, atlas: Atlas): void {
    for (const f of this.list) {
      const tex = blockDef(f.id).textures;
      const light = lightAt(ctx.world, f.x + 0.5, f.y + 0.5, f.z + 0.5);
      out.cube(atlas, f.x, f.y, f.z, f.x + 1, f.y + 1, f.z + 1, tex, light);
    }
  }

  reset(): void {
    this.list.length = 0;
    this.landings.length = 0;
  }
}
