/**
 * Things in flight: arrows, snowballs and fireballs.
 *
 * Each frame a projectile falls a little (gravity), slows a little (drag, a
 * lot more under water), and then moves along a straight segment. Whatever
 * that segment strikes first -- a block's real collision box, a mob, the
 * player -- decides what happens. Testing the segment rather than the end
 * point is what stops a fast arrow tunnelling through a fence rail between
 * two frames.
 *
 * An arrow that hits a block sticks in it, head buried, for a minute; one
 * the player shot can be walked over and picked back up. Anything else
 * bursts where it lands.
 */

import { Block, isLiquid } from '@shared/blocks.js';
import { Item } from '@shared/items.js';
import { MobKind } from '@shared/mobs.js';
import type { GameContext, ShotSpec } from '../api.js';
import type { Atlas } from '../../gfx/atlas.js';
import type { Mob } from '../../mobs.js';
import { EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_WIDTH } from '../../player.js';
import type { Effects } from './effects.js';
import { frameAlong, lightAt, rollFrame, substeps, type MeshBuilder, type Vec3 } from './geometry.js';
import { firstSolidHit } from './trace.js';

export type ShotKind = ShotSpec['kind'];

/** How each kind flies. Units are blocks and seconds. */
export const FLIGHT: Record<ShotKind, { gravity: number; drag: number; waterDrag: number; maxAge: number }> = {
  // An arrow's arc: a full draw carries a long way but visibly drops.
  arrow: { gravity: 20, drag: 0.25, waterDrag: 4, maxAge: 30 },
  snowball: { gravity: 14, drag: 0.4, waterDrag: 5, maxAge: 15 },
  // A fireball is driven, not thrown: straight lines, burning out in time.
  fireball: { gravity: 0, drag: 0, waterDrag: 6, maxAge: 6 },
};

/** How long an arrow stays stuck in a block before it crumbles away. */
export const STUCK_LIFETIME = 60;
/** How close the player's feet have to come to a stuck arrow to take it back. */
export const PICKUP_RADIUS = 1.4;
/** Stuck arrows come loose if the block they are in is broken. */
const HEAD_DEPTH = 0.18;
/** An arrow is this long; the model is built back from its tip. */
export const ARROW_LENGTH = 0.66;

export interface Projectile {
  kind: ShotKind;
  /** The tip, for an arrow; the centre, for anything round. */
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Damage at launch speed. */
  damage: number;
  launchSpeed: number;
  shooter: 'player' | Mob;
  age: number;
  /** The block an arrow is stuck in, as it was when it struck. */
  stuck: { x: number; y: number; z: number; id: number } | null;
  stuckFor: number;
  /** Which way it points: its velocity in flight, frozen once stuck. */
  hx: number; hy: number; hz: number;
  /** May be walked over and collected. */
  pickup: boolean;
  /** A full-power shot: trails sparks and hits a little harder. */
  crit: boolean;
  dead: boolean;
}

/** What a projectile struck, for tests and for anyone curious. */
export type Impact =
  | { kind: 'block'; x: number; y: number; z: number; id: number }
  | { kind: 'mob'; mob: Mob; damage: number }
  | { kind: 'player'; damage: number };

/** Something that would like to hear about fireballs landing on TNT. */
export type IgniteHook = (ctx: GameContext, x: number, y: number, z: number) => void;

export class Projectiles {
  readonly list: Projectile[] = [];
  /** Every impact since the last reset, newest last. Capped. */
  readonly impacts: Impact[] = [];

  constructor(private readonly effects: Effects, private readonly ignite: IgniteHook) {}

  /** Launches a projectile. The direction need not be normalised. */
  shoot(ctx: GameContext, shot: ShotSpec, opts: { pickup?: boolean; crit?: boolean } = {}): Projectile {
    const len = Math.hypot(shot.dx, shot.dy, shot.dz) || 1;
    const p: Projectile = {
      kind: shot.kind,
      x: shot.x, y: shot.y, z: shot.z,
      vx: (shot.dx / len) * shot.speed,
      vy: (shot.dy / len) * shot.speed,
      vz: (shot.dz / len) * shot.speed,
      damage: shot.damage,
      launchSpeed: Math.max(0.001, shot.speed),
      shooter: shot.shooter,
      age: 0,
      stuck: null,
      stuckFor: 0,
      hx: shot.dx / len, hy: shot.dy / len, hz: shot.dz / len,
      pickup: opts.pickup ?? (shot.kind === 'arrow' && shot.shooter === 'player' && !ctx.creative),
      crit: opts.crit ?? false,
      dead: false,
    };
    this.list.push(p);
    return p;
  }

  update(ctx: GameContext, dt: number): void {
    substeps(dt, (step) => this.tick(ctx, step));
  }

  private tick(ctx: GameContext, step: number): void {
    for (const p of this.list) {
      if (p.dead) continue;
      p.age += step;
      if (p.stuck) this.updateStuck(ctx, p, step);
      else this.fly(ctx, p, step);
    }
    let w = 0;
    for (const p of this.list) if (!p.dead) this.list[w++] = p;
    this.list.length = w;
  }

  private updateStuck(ctx: GameContext, p: Projectile, dt: number): void {
    const s = p.stuck!;
    p.stuckFor += dt;
    if (p.stuckFor >= STUCK_LIFETIME) {
      p.dead = true;
      return;
    }
    // The block it was in has gone (or changed): it drops out and falls.
    if (ctx.getBlock(s.x, s.y, s.z) !== s.id) {
      p.stuck = null;
      p.vx = 0; p.vy = 0; p.vz = 0;
      return;
    }
    if (p.pickup && !ctx.creative) {
      const pl = ctx.player;
      const dx = pl.x - p.x;
      const dz = pl.z - p.z;
      const dy = Math.max(0, Math.max(pl.y - p.y, p.y - (pl.y + PLAYER_HEIGHT)));
      if (Math.hypot(dx, dz, dy) <= PICKUP_RADIUS) {
        ctx.give(Item.Arrow, 1);
        p.dead = true;
      }
    }
  }

  private fly(ctx: GameContext, p: Projectile, dt: number): void {
    const f = FLIGHT[p.kind];
    const inLiquid = isLiquid(ctx.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
    const damp = Math.exp(-(inLiquid ? f.waterDrag : f.drag) * dt);
    p.vx *= damp;
    p.vy = p.vy * damp - f.gravity * dt;
    p.vz *= damp;

    if (p.age > f.maxAge || p.y < -16) {
      p.dead = true;
      return;
    }
    if (p.kind === 'fireball' && inLiquid) {
      // Doused.
      this.effects.burst('steam', p.x, p.y, p.z, 8, 0.3, 1.5, ctx.random);
      p.dead = true;
      return;
    }

    const speed = Math.hypot(p.vx, p.vy, p.vz);
    const len = speed * dt;
    if (len < 1e-6) return;
    const dx = p.vx / speed;
    const dy = p.vy / speed;
    const dz = p.vz / speed;
    p.hx = dx; p.hy = dy; p.hz = dz;

    // Whatever the segment reaches first wins.
    let best = len;
    let target: { mob: Mob } | { player: true } | null = null;
    const block = firstSolidHit(ctx.world, p.x, p.y, p.z, dx, dy, dz, len);
    if (block) best = block.t;

    for (const mob of ctx.mobs.mobs) {
      if (mob.dead || mob === p.shooter) continue;
      const t = mob.hitByRay(p.x, p.y, p.z, dx, dy, dz, best);
      if (t !== null && t <= best) {
        best = t;
        target = { mob };
      }
    }
    // Nobody is hit by their own shot; the player's arrows never hit the player.
    if (p.shooter !== 'player') {
      const t = hitPlayer(ctx, p.x, p.y, p.z, dx, dy, dz, best);
      if (t !== null && t <= best) {
        best = t;
        target = { player: true };
      }
    }

    const nx = p.x + dx * best;
    const ny = p.y + dy * best;
    const nz = p.z + dz * best;

    if (p.crit && ctx.random() < 0.6) {
      this.effects.burst('spark', p.x, p.y, p.z, 1, 0.05, 0.4, ctx.random, 0.06);
    }
    if (p.kind === 'fireball' && ctx.random() < 0.8) {
      this.effects.burst('flame', p.x, p.y, p.z, 1, 0.1, 0.5, ctx.random, 0.16);
    }

    if (target && 'mob' in target) {
      p.x = nx; p.y = ny; p.z = nz;
      this.strikeMob(ctx, p, target.mob, speed);
      return;
    }
    if (target) {
      p.x = nx; p.y = ny; p.z = nz;
      this.strikePlayer(ctx, p, speed);
      return;
    }
    if (block) {
      this.strikeBlock(ctx, p, nx, ny, nz, block.x, block.y, block.z, block.id);
      return;
    }
    p.x = nx; p.y = ny; p.z = nz;
  }

  /** Damage a projectile of this kind does to this mob at this speed. */
  damageTo(p: Projectile, speed: number, kind: MobKind | null): number {
    switch (p.kind) {
      case 'arrow': {
        // A spent arrow barely scratches; one at full flight hits for its
        // whole value, and a crit a touch more.
        const scale = Math.min(1, Math.max(0.3, speed / p.launchSpeed));
        return Math.max(1, Math.round(p.damage * scale + (p.crit ? 1 : 0)));
      }
      // Snow only stings the one thing made of fire.
      case 'snowball': return kind === MobKind.Blaze ? 3 : 0;
      // And fire does nothing to it.
      case 'fireball': return kind === MobKind.Blaze ? 0 : p.damage;
    }
  }

  private strikeMob(ctx: GameContext, p: Projectile, mob: Mob, speed: number): void {
    const damage = this.damageTo(p, speed, mob.kind);
    // The blow comes from behind the projectile, so the knockback carries on
    // the way it was flying.
    ctx.hurtMob(mob, damage, p.x - p.hx * 2, p.z - p.hz * 2);
    if (!mob.dead && !mob.def.flying && !mob.def.boss) {
      mob.vy = Math.max(mob.vy, p.kind === 'snowball' ? 4.5 : 3.5);
    }
    this.record({ kind: 'mob', mob, damage });
    this.burstAt(ctx, p);
    p.dead = true;
  }

  private strikePlayer(ctx: GameContext, p: Projectile, speed: number): void {
    const damage = this.damageTo(p, speed, null);
    if (damage > 0) {
      ctx.damagePlayer(damage, p.kind === 'fireball' ? 'was burned by a fireball' : 'was shot');
    }
    const push = p.kind === 'snowball' ? 4 : 3;
    ctx.pushPlayer(p.hx * push, 2.5, p.hz * push);
    this.record({ kind: 'player', damage });
    this.burstAt(ctx, p);
    p.dead = true;
  }

  private strikeBlock(
    ctx: GameContext, p: Projectile, hx: number, hy: number, hz: number,
    bx: number, by: number, bz: number, id: number,
  ): void {
    this.record({ kind: 'block', x: bx, y: by, z: bz, id });
    if (p.kind === 'arrow') {
      // Head buried, shaft left standing out of the face it hit.
      p.x = hx + p.hx * HEAD_DEPTH;
      p.y = hy + p.hy * HEAD_DEPTH;
      p.z = hz + p.hz * HEAD_DEPTH;
      p.vx = 0; p.vy = 0; p.vz = 0;
      p.stuck = { x: bx, y: by, z: bz, id };
      p.stuckFor = 0;
      ctx.sound.mineTick(id);
      return;
    }
    p.x = hx; p.y = hy; p.z = hz;
    if (p.kind === 'fireball' && id === Block.TNT) this.ignite(ctx, bx, by, bz);
    this.burstAt(ctx, p);
    p.dead = true;
  }

  /** The puff a projectile leaves where it ends. */
  private burstAt(ctx: GameContext, p: Projectile): void {
    if (p.kind === 'snowball') this.effects.burst('snow', p.x, p.y, p.z, 10, 0.2, 2.5, ctx.random, 0.1);
    else if (p.kind === 'fireball') this.effects.burst('flame', p.x, p.y, p.z, 10, 0.3, 2.5, ctx.random, 0.2);
  }

  private record(impact: Impact): void {
    this.impacts.push(impact);
    if (this.impacts.length > 64) this.impacts.shift();
  }

  /** Draws every projectile: arrows as little models, the rest as balls. */
  draw(ctx: GameContext, out: MeshBuilder, atlas: Atlas): void {
    for (const p of this.list) {
      const light = lightAt(ctx.world, p.x - p.hx * 0.3, p.y - p.hy * 0.3, p.z - p.hz * 0.3);
      if (p.kind === 'arrow') {
        drawArrow(out, atlas, p.x, p.y, p.z, p.hx, p.hy, p.hz, light);
      } else if (p.kind === 'snowball') {
        const frame = rollFrame(frameAlong(p.hx, p.hy, p.hz), p.age * 12);
        out.box(atlas, [p.x, p.y, p.z], frame, [0.1, 0.1, 0.1], 'projectile_snowball', light);
      } else {
        const frame = rollFrame(frameAlong(p.hx, p.hy, p.hz), p.age * 8);
        out.box(atlas, [p.x, p.y, p.z], frame, [0.17, 0.17, 0.17], 'projectile_fireball', 1.8);
      }
    }
  }

  reset(): void {
    this.list.length = 0;
    this.impacts.length = 0;
  }
}

/**
 * An arrow model, tip at (x, y, z) and pointing along (hx, hy, hz): a thin
 * wooden shaft, a copper head a little fatter than it, and two crossed
 * feather vanes at the tail. Built from the tip back, so a stuck arrow's
 * position is exactly where its point went in.
 */
export function drawArrow(
  out: MeshBuilder, atlas: Atlas, x: number, y: number, z: number,
  hx: number, hy: number, hz: number, light: number,
): void {
  const frame = frameAlong(hx, hy, hz);
  const f = frame[2];
  const back = (d: number): Vec3 => [x - f[0] * d, y - f[1] * d, z - f[2] * d];
  const L = ARROW_LENGTH;
  out.box(atlas, back(L / 2), frame, [0.028, 0.028, L / 2 - 0.04], 'projectile_arrow_shaft', light);
  // The head narrows in three steps to a point. One box reads as a blunt
  // copper plug at any distance; the taper is what says "sharp end".
  out.box(atlas, back(0.115), frame, [0.055, 0.055, 0.025], 'projectile_arrow_head', light);
  out.box(atlas, back(0.065), frame, [0.038, 0.038, 0.025], 'projectile_arrow_head', light * 1.08);
  out.box(atlas, back(0.02), frame, [0.018, 0.018, 0.02], 'projectile_arrow_head', light * 1.18);
  const tail = back(L - 0.11);
  out.box(atlas, tail, frame, [0.1, 0.006, 0.1], 'projectile_arrow_fletching', light);
  out.box(atlas, tail, frame, [0.006, 0.1, 0.1], 'projectile_arrow_fletching', light);
}

/** Where along a segment it enters the player's body, or null. */
function hitPlayer(
  ctx: GameContext, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number,
): number | null {
  const pl = ctx.player;
  const half = PLAYER_WIDTH / 2;
  let tMin = 0;
  let tMax = maxT;
  const slab = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    const a = (lo - o) / d;
    const b = (hi - o) / d;
    tMin = Math.max(tMin, Math.min(a, b));
    tMax = Math.min(tMax, Math.max(a, b));
    return tMax >= tMin;
  };
  if (!slab(ox, dx, pl.x - half, pl.x + half)) return null;
  if (!slab(oy, dy, pl.y, pl.y + PLAYER_HEIGHT)) return null;
  if (!slab(oz, dz, pl.z - half, pl.z + half)) return null;
  return tMin;
}

/** Where a shot from the player's eye starts: just in front of the face. */
export function muzzle(ctx: GameContext): { x: number; y: number; z: number; dx: number; dy: number; dz: number } {
  const [dx, dy, dz] = ctx.player.forward;
  return {
    x: ctx.player.x + dx * 0.4,
    y: ctx.player.y + EYE_HEIGHT - 0.1 + dy * 0.4,
    z: ctx.player.z + dz * 0.4,
    dx, dy, dz,
  };
}
