/**
 * Walking a straight line through the voxel grid, and what a line hits.
 *
 * Arrows, buckets and blasts all ask the same question -- what is the first
 * thing along this line -- and each used to be the kind of thing written
 * three slightly different ways. Here it is written once: a DDA that visits
 * cells in the order the line enters them, and a test of the real collision
 * boxes inside each cell, so an arrow flies over a slab and under a fence
 * rail rather than stopping at the cell's edge.
 */

import { isSolid } from '@shared/blocks.js';
import { rayBoxes, collisionBoxesAt } from '../../player.js';
import type { ClientWorld } from '../../world.js';

/**
 * Visits every cell a segment passes through, nearest first. `visit` gets the
 * cell and the distance along the line at which it was entered; returning
 * true stops the walk. Direction must be a unit vector; `length` is how far
 * to walk.
 */
export function traceCells(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, length: number,
  visit: (x: number, y: number, z: number, t: number) => boolean,
): void {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx > 0 ? (x + 1 - ox) / dx : dx < 0 ? (x - ox) / dx : Infinity;
  let tMaxY = dy > 0 ? (y + 1 - oy) / dy : dy < 0 ? (y - oy) / dy : Infinity;
  let tMaxZ = dz > 0 ? (z + 1 - oz) / dz : dz < 0 ? (z - oz) / dz : Infinity;
  let t = 0;
  // Bounded: a line of any sane length crosses far fewer cells than this.
  for (let guard = 0; guard < 4096 && t <= length; guard++) {
    if (visit(x, y, z, t)) return;
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      t = tMaxX; x += stepX; tMaxX += tDeltaX;
    } else if (tMaxY <= tMaxZ) {
      t = tMaxY; y += stepY; tMaxY += tDeltaY;
    } else {
      t = tMaxZ; z += stepZ; tMaxZ += tDeltaZ;
    }
  }
}

export interface BlockHit {
  /** Distance along the (unit) direction. */
  t: number;
  x: number;
  y: number;
  z: number;
  id: number;
  /** Outward normal of the face struck. */
  face: [number, number, number];
}

/**
 * The first solid collision box a segment strikes, or null. Only solid
 * blocks count: an arrow flies through a torch, a flower and the surface of
 * a lake, and stops at the stone under it.
 */
export function firstSolidHit(
  world: ClientWorld,
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, length: number,
): BlockHit | null {
  let hit: BlockHit | null = null;
  traceCells(ox, oy, oz, dx, dy, dz, length, (x, y, z) => {
    const id = world.getBlock(x, y, z);
    if (!isSolid(id)) return false;
    const struck = rayBoxes(ox, oy, oz, dx, dy, dz, x, y, z, collisionBoxesAt(world, id, x, y, z), length);
    if (!struck) return false;
    hit = { t: struck.t, x, y, z, id, face: struck.face };
    return true;
  });
  return hit;
}

/** Is the straight line between two points free of solid blocks? */
export function clearLine(
  world: ClientWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number,
): boolean {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  if (len < 1e-6) return true;
  const dx = (bx - ax) / len;
  const dy = (by - ay) / len;
  const dz = (bz - az) / len;
  return firstSolidHit(world, ax, ay, az, dx, dy, dz, len) === null;
}
