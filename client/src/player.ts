/** Local player: camera, movement, collision and block targeting. */

import { Block, blockDef, isLiquid, isSolid } from '@shared/blocks.js';
import { shapeOf } from '@shared/shapes.js';
import { WORLD_Y } from '@shared/constants.js';
import type { Vec3 } from './math.js';
import type { ClientWorld } from './world.js';

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;

const GRAVITY = 28;
const TERMINAL = 58;
const JUMP_SPEED = 8.8;
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 7.4;
const SNEAK_SPEED = 2.0;
const FLY_SPEED = 12;
const FLY_SPRINT = 28;
/** Vertical and horizontal speed while on a ladder. */
const CLIMB_SPEED = 4.0;
const CLIMB_MOVE_SPEED = 2.6;
const SWIM_SPEED = 3.6;
const REACH = 6;
/** Longest distance any single collision step may cover, in blocks. */
const MAX_STEP = 0.35;
/**
 * Shrinks the collision box a hair so a body resting exactly against a face
 * does not count as overlapping the block behind it. Without this, standing
 * flush against a wall makes the vertical resolver find the wall column and
 * teleport the player up onto it.
 */
const SKIN = 1e-4;

/** Tallest ledge a walking body climbs without jumping. */
const STEP_HEIGHT = 0.6;
/** How far past the blocking face to place the body when stepping up. */
const STEP_PROBE = 1e-3;

export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export interface RaycastHit {
  block: [number, number, number];
  /** The empty cell the ray passed through last, i.e. where a block goes. */
  place: [number, number, number] | null;
  id: number;
}

export class Player {
  x = 0.5;
  y = 80;
  z = 0.5;
  yaw = -90;
  pitch = 0;
  vy = 0;
  flying = false;
  onGround = false;
  inLiquid = false;
  slot = 0;

  get eye(): Vec3 {
    return [this.x, this.y + EYE_HEIGHT, this.z];
  }

  get forward(): Vec3 {
    const yaw = (this.yaw * Math.PI) / 180;
    const pitch = (this.pitch * Math.PI) / 180;
    const cp = Math.cos(pitch);
    return [Math.cos(yaw) * cp, Math.sin(pitch), Math.sin(yaw) * cp];
  }

  look(dx: number, dy: number, sensitivity = 0.12): void {
    if (sensitivity <= 0) return;
    this.yaw = (this.yaw + dx * sensitivity) % 360;
    this.pitch = Math.max(-89.9, Math.min(89.9, this.pitch - dy * sensitivity));
  }

  update(dt: number, world: ClientWorld, input: InputState): void {
    // An unloaded chunk reads as air. Without this guard the player drops
    // through terrain that simply has not streamed in yet.
    if (!world.isLoaded(Math.floor(this.x), Math.floor(this.z))) {
      this.vy = 0;
      return;
    }

    const head = world.getBlock(
      Math.floor(this.x), Math.floor(this.y + EYE_HEIGHT), Math.floor(this.z));
    this.inLiquid = isLiquid(head);

    const yaw = (this.yaw * Math.PI) / 180;
    const fx = Math.cos(yaw);
    const fz = Math.sin(yaw);

    let mx = 0;
    let mz = 0;
    if (input.forward) { mx += fx; mz += fz; }
    if (input.back) { mx -= fx; mz -= fz; }
    if (input.right) { mx += -fz; mz += fx; }
    if (input.left) { mx -= -fz; mz -= fx; }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    if (this.flying) {
      const speed = input.sprint ? FLY_SPRINT : FLY_SPEED;
      this.vy = 0;
      let vy = 0;
      if (input.jump) vy += speed;
      if (input.sneak) vy -= speed;
      this.move(world, mx * speed * dt, vy * dt, mz * speed * dt);
      this.onGround = false;
      return;
    }

    // A ladder in the body's own column is climbable. Checked at the feet and
    // at chest height so stepping onto the bottom rung works and so you do
    // not drop off the moment your feet clear the top one.
    const onLadder =
      world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z))
        === Block.Ladder ||
      world.getBlock(Math.floor(this.x), Math.floor(this.y + 1.2), Math.floor(this.z))
        === Block.Ladder;

    let speed: number;
    if (onLadder && !this.inLiquid) {
      // Climbing overrides gravity entirely: hold jump to go up, sneak to go
      // down, and otherwise hang still rather than sliding off.
      speed = CLIMB_MOVE_SPEED;
      this.vy = input.jump ? CLIMB_SPEED : input.sneak ? -CLIMB_SPEED : 0;
      this.move(world, mx * speed * dt, this.vy * dt, mz * speed * dt);
      // Standing on a ladder counts as grounded, so a jump off the top works.
      this.onGround = true;
      return;
    }

    if (this.inLiquid) {
      speed = SWIM_SPEED;
      this.vy -= GRAVITY * 0.3 * dt;
      if (this.vy < -4) this.vy = -4;
      if (input.jump) this.vy = 4.4;
    } else {
      speed = input.sneak ? SNEAK_SPEED : input.sprint ? SPRINT_SPEED : WALK_SPEED;
      if (input.jump && this.onGround) this.vy = JUMP_SPEED;
      this.vy -= GRAVITY * dt;
      if (this.vy < -TERMINAL) this.vy = -TERMINAL;
    }

    this.move(world, mx * speed * dt, this.vy * dt, mz * speed * dt);
  }

  private move(world: ClientWorld, dx: number, dy: number, dz: number): void {
    // Sub-step so no single step crosses more than part of a block. Without
    // this, one long frame at terminal velocity tunnels straight through the
    // floor: the collision test only ever sees the start and end positions.
    const longest = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.min(16, Math.max(1, Math.ceil(longest / MAX_STEP)));
    const sx = dx / steps;
    const sy = dy / steps;
    const sz = dz / steps;

    for (let i = 0; i < steps; i++) {
      this.step(world, sx, sy, sz);
    }
  }

  private step(world: ClientWorld, dx: number, dy: number, dz: number): void {
    // One axis at a time, so walking into a wall slides instead of sticking.
    this.x += dx;
    if (this.resolve(world, 0, dx)) this.tryStepUp(world, 0, dx);
    this.z += dz;
    if (this.resolve(world, 2, dz)) this.tryStepUp(world, 2, dz);
    this.y += dy;
    const hit = this.resolve(world, 1, dy);
    if (hit) {
      if (dy < 0) this.onGround = true;
      this.vy = 0;
    } else if (dy !== 0) {
      this.onGround = false;
    }
  }

  /**
   * Walk up a small ledge instead of stopping dead at it.
   *
   * Shapes made this necessary rather than merely nice. A conveyor is a
   * 3/16 slab, and without step assist it is a wall you have to jump -- which
   * would make walking along your own production line worse than walking
   * beside it, and no amount of getting the hitbox right would fix that.
   *
   * Only from the ground, and only over a ledge low enough to be a step: from
   * mid-air it would let a player climb a sheer face by holding forward.
   */
  private tryStepUp(world: ClientWorld, axis: 0 | 2, delta: number): void {
    if (!this.onGround || delta === 0) return;

    const rise = this.ledgeHeight(world, axis, delta);
    if (rise === null || rise <= 0 || rise > STEP_HEIGHT) return;

    const savedX = this.x;
    const savedY = this.y;
    const savedZ = this.z;

    // Put the body back where it was heading, lifted onto the ledge.
    this.y = savedY + rise;
    if (axis === 0) this.x = savedX + (delta > 0 ? STEP_PROBE : -STEP_PROBE);
    else this.z = savedZ + (delta > 0 ? STEP_PROBE : -STEP_PROBE);

    // Accept only if the body actually fits up there -- otherwise this would
    // push the player into a one-block gap and leave them stuck in the
    // ceiling.
    if (this.overlaps(world)) {
      this.x = savedX;
      this.y = savedY;
      this.z = savedZ;
    }
  }

  /** How far above the feet the blocking ledge sits, or null if unblocked. */
  private ledgeHeight(world: ClientWorld, axis: 0 | 2, delta: number): number | null {
    const half = PLAYER_WIDTH / 2;
    const probe = half - SKIN;
    const ahead = delta > 0 ? probe + STEP_PROBE : -probe - STEP_PROBE;

    const px = axis === 0 ? this.x + ahead : this.x;
    const pz = axis === 2 ? this.z + ahead : this.z;

    const bx = Math.floor(px);
    const bz = Math.floor(pz);
    let top: number | null = null;

    // Only the cell at the feet: a ledge is something to step onto, and
    // anything higher is a wall whatever its shape.
    for (let by = Math.floor(this.y); by <= Math.floor(this.y + STEP_HEIGHT); by++) {
      const id = world.getBlock(bx, by, bz);
      if (!isSolid(id)) continue;
      for (const box of shapeOf(id)) {
        const boxTop = by + box.y1;
        if (boxTop <= this.y + SKIN) continue;
        if (top === null || boxTop > top) top = boxTop;
      }
    }
    return top === null ? null : top - this.y;
  }

  /** Is the body overlapping any solid shape where it currently stands? */
  private overlaps(world: ClientWorld): boolean {
    const half = PLAYER_WIDTH / 2;
    const probe = half - SKIN;
    const lo = [this.x - probe, this.y + SKIN, this.z - probe];
    const hi = [this.x + probe, this.y + PLAYER_HEIGHT - SKIN, this.z + probe];

    for (let bx = Math.floor(lo[0]); bx <= Math.floor(hi[0]); bx++) {
      for (let by = Math.floor(lo[1]); by <= Math.min(Math.floor(hi[1]), WORLD_Y - 1); by++) {
        for (let bz = Math.floor(lo[2]); bz <= Math.floor(hi[2]); bz++) {
          const id = world.getBlock(bx, by, bz);
          if (!isSolid(id)) continue;
          for (const box of shapeOf(id)) {
            if (bx + box.x0 < hi[0] && bx + box.x1 > lo[0] &&
                by + box.y0 < hi[1] && by + box.y1 > lo[1] &&
                bz + box.z0 < hi[2] && bz + box.z1 > lo[2]) return true;
          }
        }
      }
    }
    return false;
  }

  private resolve(world: ClientWorld, axis: 0 | 1 | 2, delta: number): boolean {
    if (delta === 0) return false;
    // Snap with the true half-width so the body ends up flush against the
    // face; probe with a slightly smaller one so that flush contact is not
    // then read as an overlap on the next axis.
    const half = PLAYER_WIDTH / 2;
    const probe = half - SKIN;

    // The body, as an interval on each axis.
    const lo = [this.x - probe, this.y + SKIN, this.z - probe];
    const hi = [this.x + probe, this.y + PLAYER_HEIGHT - SKIN, this.z + probe];

    const x0 = Math.floor(lo[0]);
    const x1 = Math.floor(hi[0]);
    const y0 = Math.floor(lo[1]);
    const y1 = Math.min(Math.floor(hi[1]), WORLD_Y - 1);
    const z0 = Math.floor(lo[2]);
    const z1 = Math.floor(hi[2]);

    // Find the blocking face *nearest the one we are moving into*. Taking
    // whichever block the scan happened to reach first snaps the player to
    // the far side of a two-block-thick wall, which reads as walking through
    // it.
    //
    // Faces come from the block's shape rather than from the cell, so a
    // conveyor stops the body at belt height instead of at the cell top, and
    // a cable only blocks the thin run it actually occupies. A shape whose
    // boxes do not overlap the body on the two perpendicular axes is not in
    // the way at all -- which is the whole point of a cable you can stand
    // beside.
    let found = false;
    let edge = 0;

    for (let bx = x0; bx <= x1; bx++) {
      for (let by = y0; by <= y1; by++) {
        for (let bz = z0; bz <= z1; bz++) {
          const id = world.getBlock(bx, by, bz);
          if (!isSolid(id)) continue;
          const cell = [bx, by, bz];

          for (const box of shapeOf(id)) {
            const bLo = [cell[0] + box.x0, cell[1] + box.y0, cell[2] + box.z0];
            const bHi = [cell[0] + box.x1, cell[1] + box.y1, cell[2] + box.z1];

            // Must overlap on both axes that are not being resolved.
            let clear = false;
            for (let a = 0; a < 3; a++) {
              if (a === axis) continue;
              if (bHi[a] <= lo[a] || bLo[a] >= hi[a]) { clear = true; break; }
            }
            if (clear) continue;

            // The face this box presents to an incoming body.
            const candidate = delta > 0 ? bLo[axis] : bHi[axis];
            if (!found) {
              found = true;
              edge = candidate;
            } else if (delta > 0) {
              if (candidate < edge) edge = candidate; // nearest on the +side
            } else if (candidate > edge) {
              edge = candidate; // nearest on the -side
            }
          }
        }
      }
    }
    if (!found) return false;

    if (axis === 0) this.x = delta < 0 ? edge + half : edge - half;
    else if (axis === 1) this.y = delta < 0 ? edge : edge - PLAYER_HEIGHT;
    else this.z = delta < 0 ? edge + half : edge - half;
    return true;
  }

  /** Voxel DDA from the eye along the view vector. */
  raycast(world: ClientWorld, reach = REACH): RaycastHit | null {
    const [ox, oy, oz] = this.eye;
    const [dx, dy, dz] = this.forward;

    let bx = Math.floor(ox);
    let by = Math.floor(oy);
    let bz = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;

    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

    let tMaxX = dx > 0 ? (bx + 1 - ox) / dx : dx < 0 ? (bx - ox) / dx : Infinity;
    let tMaxY = dy > 0 ? (by + 1 - oy) / dy : dy < 0 ? (by - oy) / dy : Infinity;
    let tMaxZ = dz > 0 ? (bz + 1 - oz) / dz : dz < 0 ? (bz - oz) / dz : Infinity;

    let prev: [number, number, number] | null = null;
    let travelled = 0;

    while (travelled <= reach) {
      const id = world.getBlock(bx, by, bz);
      if (id !== 0 && !blockDef(id).liquid) {
        return { block: [bx, by, bz], place: prev, id };
      }
      prev = [bx, by, bz];
      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        travelled = tMaxX; bx += stepX; tMaxX += tDeltaX;
      } else if (tMaxY <= tMaxZ) {
        travelled = tMaxY; by += stepY; tMaxY += tDeltaY;
      } else {
        travelled = tMaxZ; bz += stepZ; tMaxZ += tDeltaZ;
      }
    }
    return null;
  }

  /** Would a block at these coords overlap the player's body? */
  intersects(bx: number, by: number, bz: number): boolean {
    const half = PLAYER_WIDTH / 2;
    return (
      bx + 1 > this.x - half && bx < this.x + half &&
      by + 1 > this.y && by < this.y + PLAYER_HEIGHT &&
      bz + 1 > this.z - half && bz < this.z + half
    );
  }
}
