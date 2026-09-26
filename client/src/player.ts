/** Local player: camera, movement, collision and block targeting. */

import { blockDef, isLiquid, isReplaceable, isSolid } from '@shared/blocks.js';
import { collisionOf, isDynamicShape, selectionOf, type Around, type Box } from '@shared/shapes.js';
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
  /**
   * Where a placed block goes: the cell on the other side of the face that
   * was hit, or the hit cell itself when what is there is replaceable (tall
   * grass, a snow layer).
   */
  place: [number, number, number] | null;
  id: number;
  /** Outward normal of the face the ray struck. */
  face: [number, number, number];
  /** Exact point struck, in world space. */
  point: [number, number, number];
}

/** Neighbour lookup centred on one cell of the world. */
export function aroundAt(world: ClientWorld, x: number, y: number, z: number): Around {
  return (dx, dy, dz) => world.getBlock(x + dx, y + dy, z + dz);
}

/**
 * The collision boxes of the block in one cell.
 *
 * Only fences, walls, panes and the like depend on their neighbours, so the
 * lookup closure is built for those alone -- this sits in the collision
 * inner loop, where a closure per cell would be most of the cost.
 */
export function collisionBoxesAt(world: ClientWorld, id: number, x: number, y: number, z: number): Box[] {
  return isDynamicShape(id) ? collisionOf(id, aroundAt(world, x, y, z)) : collisionOf(id);
}

/**
 * Ray against a list of cell-local boxes. Returns the entry distance and the
 * face normal, or null for a miss.
 */
export function rayBoxes(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number, boxes: Box[], maxT: number,
): { t: number; face: [number, number, number] } | null {
  let best: { t: number; face: [number, number, number] } | null = null;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (const b of boxes) {
    let tMin = 0;
    let tMax = maxT;
    let face: [number, number, number] = [0, 1, 0];
    const lo = [cx + b.x0, cy + b.y0, cz + b.z0];
    const hi = [cx + b.x1, cy + b.y1, cz + b.z1];
    let miss = false;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < lo[a] || o[a] > hi[a]) { miss = true; break; }
        continue;
      }
      let t1 = (lo[a] - o[a]) / d[a];
      let t2 = (hi[a] - o[a]) / d[a];
      // Entering through the low face means the outward normal points down
      // that axis; through the high face, up it.
      let sign = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
      if (t1 > tMin) {
        tMin = t1;
        face = [0, 0, 0];
        face[a] = sign;
      }
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) { miss = true; break; }
    }
    if (miss) continue;
    if (!best || tMin < best.t) best = { t: tMin, face };
  }
  return best;
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
  /** Horizontal velocity, which only lingers on slippery ground. */
  vx = 0;
  vz = 0;
  /**
   * Set when something cancels a fall -- a bounce pad -- so fall damage is
   * measured from the next peak rather than the one before the bounce.
   */
  softLanding = false;
  /** Damage per second from whatever the body is touching (cactus). */
  contactDamage = 0;
  private sneaking = false;

  /** Whether the player was sneaking on the last update: sneaking spares farmland and bounce pads. */
  get isSneaking(): boolean {
    return this.sneaking;
  }

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
    this.sneaking = input.sneak;
    this.contactDamage = this.touchDamage(world);

    // What the feet are in and what they stand on decide grip and pace: ice
    // keeps you sliding, soul sand and cobwebs hold you back.
    const feetDef = blockDef(world.getBlock(
      Math.floor(this.x), Math.floor(this.y + 0.1), Math.floor(this.z)));
    const underDef = blockDef(world.getBlock(
      Math.floor(this.x), Math.floor(this.y - 0.05), Math.floor(this.z)));
    const pace = Math.min(feetDef.speedFactor, this.onGround ? underDef.speedFactor : 1);
    const slip = this.onGround ? underDef.slipperiness : 0;

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
      blockDef(world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z)))
        .climbable ||
      blockDef(world.getBlock(Math.floor(this.x), Math.floor(this.y + 1.2), Math.floor(this.z)))
        .climbable;

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
      if (input.jump && this.onGround) this.vy = JUMP_SPEED * (pace < 0.5 ? 0.6 : 1);
      this.vy -= GRAVITY * dt;
      if (this.vy < -TERMINAL) this.vy = -TERMINAL;
      // A cobweb holds a falling body too, not just a walking one.
      if (feetDef.speedFactor < 0.5 && this.vy < -2) this.vy = -2;
    }
    speed *= pace;

    // Ordinary ground answers the controls at once. Ice lets the old
    // velocity linger, so you slide past where you meant to stop.
    const tx = mx * speed;
    const tz = mz * speed;
    const response = slip > 0 ? 1 - Math.pow(slip, dt * 10) : 1;
    this.vx += (tx - this.vx) * response;
    this.vz += (tz - this.vz) * response;

    this.move(world, this.vx * dt, this.vy * dt, this.vz * dt);
  }

  /** The worst contact damage of anything the body is pressed against. */
  private touchDamage(world: ClientWorld): number {
    const reach = PLAYER_WIDTH / 2 + 0.04;
    let worst = 0;
    for (let bx = Math.floor(this.x - reach); bx <= Math.floor(this.x + reach); bx++) {
      for (let by = Math.floor(this.y - 0.04); by <= Math.floor(this.y + PLAYER_HEIGHT); by++) {
        for (let bz = Math.floor(this.z - reach); bz <= Math.floor(this.z + reach); bz++) {
          const d = blockDef(world.getBlock(bx, by, bz)).contactDamage;
          if (d > worst) worst = d;
        }
      }
    }
    return worst;
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
      // Already bounced earlier in this frame: the later sub-steps still
      // carry the frame's downward travel, and without this they would land
      // on the pad again and kill the bounce -- so any long or low-frame-rate
      // fall landed dead. Only a bounce makes vy positive while moving down.
      if (dy < 0 && this.vy > 0) return;
      const bounce = dy < 0 && !this.sneaking ? this.bounceUnder(world) : 0;
      if (bounce > 0 && this.vy < -3) {
        // Thrown back up. Sneaking lands normally, so a pad can be stood on.
        this.vy = -this.vy * bounce;
        this.onGround = false;
        this.softLanding = true;
        return;
      }
      if (dy < 0) this.onGround = true;
      this.vy = 0;
    } else if (dy !== 0) {
      this.onGround = false;
    }
  }

  /** Bounce factor of whatever is directly beneath the feet. */
  private bounceUnder(world: ClientWorld): number {
    return blockDef(world.getBlock(
      Math.floor(this.x), Math.floor(this.y - 0.05), Math.floor(this.z))).bounce;
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
    for (let by = Math.floor(this.y) - 1; by <= Math.floor(this.y + STEP_HEIGHT); by++) {
      const id = world.getBlock(bx, by, bz);
      if (!isSolid(id)) continue;
      for (const box of collisionBoxesAt(world, id, bx, by, bz)) {
        // Only the part of the shape right at the leading edge: a stair's
        // tall back half is the *next* step, not this one.
        const along = axis === 0 ? px - bx : pz - bz;
        if (along < (axis === 0 ? box.x0 : box.z0) || along > (axis === 0 ? box.x1 : box.z1)) continue;
        const across = axis === 0 ? this.z - bz : this.x - bx;
        if (across + probe <= (axis === 0 ? box.z0 : box.x0) || across - probe >= (axis === 0 ? box.z1 : box.x1)) continue;
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
      for (let by = Math.floor(lo[1]) - 1; by <= Math.min(Math.floor(hi[1]), WORLD_Y - 1); by++) {
        for (let bz = Math.floor(lo[2]); bz <= Math.floor(hi[2]); bz++) {
          const id = world.getBlock(bx, by, bz);
          if (!isSolid(id)) continue;
          for (const box of collisionBoxesAt(world, id, bx, by, bz)) {
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
    // One cell lower than the body reaches: a fence's collision stands half
    // a block above its own cell, into the cell the body is in.
    const y0 = Math.floor(lo[1]) - 1;
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

          for (const box of collisionBoxesAt(world, id, bx, by, bz)) {
            const bLo = [cell[0] + box.x0, cell[1] + box.y0, cell[2] + box.z0];
            const bHi = [cell[0] + box.x1, cell[1] + box.y1, cell[2] + box.z1];

            // The body has just moved along this axis; only a box it now actually
            // overlaps -- on all three axes -- is in the way. Checking just the
            // other two was enough while every scanned cell sat inside the
            // body's span, but the scan now reaches one cell lower for tall
            // shapes, and the floor beneath the feet would otherwise read as a
            // ceiling.
            let clear = false;
            for (let a = 0; a < 3; a++) {
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

    let travelled = 0;

    while (travelled <= reach) {
      const id = world.getBlock(bx, by, bz);
      if (id !== 0 && !blockDef(id).liquid) {
        // The cell is only a candidate: the ray has to strike the block's
        // actual selection boxes, or it carries on past a fence's open side
        // or between a flower's leaves.
        const boxes = isDynamicShape(id)
          ? selectionOf(id, aroundAt(world, bx, by, bz))
          : selectionOf(id);
        const struck = rayBoxes(ox, oy, oz, dx, dy, dz, bx, by, bz, boxes, reach);
        if (struck) {
          const face = struck.face;
          const point: [number, number, number] = [
            ox + dx * struck.t, oy + dy * struck.t, oz + dz * struck.t,
          ];
          const place: [number, number, number] = isReplaceable(id)
            ? [bx, by, bz]
            : [bx + face[0], by + face[1], bz + face[2]];
          return { block: [bx, by, bz], place, id, face, point };
        }
      }
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

  /**
   * Would a block at these coords overlap the player's body?
   *
   * Tested against the block's own collision boxes when it is given, so a
   * slab can go down beside your feet and a flower can be planted where you
   * stand -- it has no collision at all.
   */
  intersects(bx: number, by: number, bz: number, block?: number, world?: ClientWorld): boolean {
    const half = PLAYER_WIDTH / 2;
    let boxes: Box[] = [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }];
    if (block !== undefined) {
      if (!isSolid(block)) return false;
      boxes = world ? collisionBoxesAt(world, block, bx, by, bz) : collisionOf(block);
    }
    return boxes.some((b) =>
      bx + b.x1 > this.x - half && bx + b.x0 < this.x + half &&
      by + b.y1 > this.y && by + b.y0 < this.y + PLAYER_HEIGHT &&
      bz + b.z1 > this.z - half && bz + b.z0 < this.z + half);
  }
}
