/**
 * Explosions, and the lit charges that make them.
 *
 * A blast is worked out by casting a few hundred rays from its centre. Each
 * ray starts with a strength that scales with the blast's power and loses a
 * little per step to distance and a lot to every block it passes through,
 * in proportion to how hard that block is. A block is destroyed if any ray
 * still has strength left when it reaches it. That one rule gives all of
 * the things a player notices: a rough sphere in open ground, a smaller one
 * in stone, a shadow behind a thick wall, and nothing at all behind
 * obsidian, which no ray passes.
 *
 * What stands in the blast is hurt by how close it is and how much of it
 * the centre can see, and thrown away from it.
 */

import { Block, blockDef, isSolid } from '@shared/blocks.js';
import { blockDrops } from '@shared/items.js';
import { dispatchBreak, type GameContext } from '../api.js';
import type { Atlas } from '../../gfx/atlas.js';
import { isMachine } from '../../machines.js';
import { PLAYER_HEIGHT, collisionBoxesAt } from '../../player.js';
import type { Effects } from './effects.js';
import { lightAt, substeps, WORLD_AXES, type MeshBuilder } from './geometry.js';
import { clearLine } from './trace.js';

/** TNT's power. A mob that explodes might use 3; a chain adds up. */
export const TNT_POWER = 4;
/** Seconds from lighting a charge to the bang. */
export const FUSE_SECONDS = 4;
/** A charge set off by another blast goes much sooner, and not all at once. */
export const CHAIN_FUSE_MIN = 0.5;
export const CHAIN_FUSE_MAX = 1.5;
/** What a lit charge shows on the bright half of each blink (art/combat.ts). */
export const FLASH_TILE = 'tnt_flash';
/** Share of destroyed blocks that survive as items. */
export const DROP_CHANCE = 0.3;
/** Damage at the very centre is power times this (before armour). */
const DAMAGE_PER_POWER = 5;

/** Blocks no blast breaks and no blast passes through. */
const BLAST_PROOF = new Set<number>([
  Block.Obsidian, Block.Bedrock, Block.NetherPortal, Block.EndPortal,
  Block.EndPortalFrame, Block.EndPortalFrameFilled,
]);

/**
 * How much a block soaks up of a ray passing through it: its hardness,
 * scaled so stone stops a TNT ray after a couple of blocks while dirt lets
 * it carve three. Liquids are not destroyed but do absorb the blast, which
 * is why a charge set off under water leaves the lake bed alone.
 */
export function blastResistance(id: number): number {
  if (id === Block.Air) return 0;
  if (BLAST_PROOF.has(id)) return Infinity;
  const def = blockDef(id);
  if (def.liquid) return 30;
  if (!def.breakable) return Infinity;
  return def.hardness * 0.35;
}

/** Directions spread evenly over a sphere (a Fibonacci lattice). */
const RAYS: Array<[number, number, number]> = (() => {
  const n = 900;
  const out: Array<[number, number, number]> = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
})();

/** Step length along each ray, and what every step costs regardless. */
const RAY_STEP = 0.3;
const STEP_COST = 0.225;

/**
 * Which cells a blast of this power at this point destroys. Pure: reads the
 * world, changes nothing, so it can be tested and reasoned about alone.
 */
export function blastCells(
  getBlock: (x: number, y: number, z: number) => number,
  x: number, y: number, z: number, power: number, random: () => number,
): Array<[number, number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number, number]> = [];
  for (const [dx, dy, dz] of RAYS) {
    let strength = power * (0.7 + random() * 0.6);
    let px = x;
    let py = y;
    let pz = z;
    while (strength > 0) {
      const cx = Math.floor(px);
      const cy = Math.floor(py);
      const cz = Math.floor(pz);
      const id = getBlock(cx, cy, cz);
      if (id !== Block.Air) {
        const resistance = blastResistance(id);
        if (resistance === Infinity) break;
        strength -= (resistance + 0.3) * RAY_STEP;
        const def = blockDef(id);
        if (strength > 0 && def.breakable && !def.liquid) {
          const key = `${cx},${cy},${cz}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push([cx, cy, cz]);
          }
        }
      }
      px += dx * RAY_STEP;
      py += dy * RAY_STEP;
      pz += dz * RAY_STEP;
      strength -= STEP_COST;
    }
  }
  return out;
}

/**
 * How much of a body the blast can see, 0 to 1: the share of points spread
 * over its box with a clear line to the centre. Hiding behind a wall
 * protects you; standing in the doorway does not.
 */
export function exposure(
  ctx: GameContext, x: number, y: number, z: number,
  bx: number, by: number, bz: number, width: number, height: number,
): number {
  let clear = 0;
  let total = 0;
  for (const fy of [0.1, 0.5, 0.9]) {
    for (const [fx, fz] of [[-0.4, -0.4], [0.4, 0.4], [0, 0]] as const) {
      total++;
      if (clearLine(ctx.world, x, y, z, bx + fx * width, by + fy * height, bz + fz * width)) clear++;
    }
  }
  return clear / total;
}

/**
 * How hard the blast hits at this distance and exposure, 0 to 1. Linear in
 * distance out to twice the power, so a TNT blast reaches eight blocks.
 */
export function impactAt(power: number, distance: number, seen: number): number {
  const reach = power * 2;
  if (distance >= reach) return 0;
  return (1 - distance / reach) * seen;
}

/** Damage for an impact: gentle at the edge, brutal in the middle. */
export function blastDamage(power: number, impact: number): number {
  return Math.round(((impact * impact + impact) / 2) * power * DAMAGE_PER_POWER);
}

// --- lit charges ---------------------------------------------------------------

export interface PrimedCharge {
  /** The corner of its unit box; it sits in a cell exactly when lit. */
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  fuse: number;
  /** Fuse it was lit with, for the flash rhythm. */
  lit: number;
}

const CHARGE_GRAVITY = 24;
const CHARGE_SIZE = 0.98;

export class Explosions {
  readonly charges: PrimedCharge[] = [];
  /** Blasts so far, newest last. For tests. */
  readonly history: Array<{ x: number; y: number; z: number; power: number; destroyed: number }> = [];

  constructor(private readonly effects: Effects) {}

  /**
   * Lights the charge in a cell: the block becomes a lit charge that falls
   * and flashes and goes off when its fuse runs out. Returns false if the
   * cell holds no TNT or the change was refused.
   */
  prime(ctx: GameContext, x: number, y: number, z: number, fuse = FUSE_SECONDS): boolean {
    if (ctx.getBlock(x, y, z) !== Block.TNT) return false;
    if (!ctx.setBlock(x, y, z, Block.Air)) return false;
    const off = (1 - CHARGE_SIZE) / 2;
    this.charges.push({
      x: x + off, y, z: z + off,
      // A little hop, the way a lit charge jumps as the fuse catches.
      vx: (ctx.random() - 0.5) * 0.8, vy: 2.5, vz: (ctx.random() - 0.5) * 0.8,
      fuse, lit: fuse,
    });
    return true;
  }

  explode(ctx: GameContext, x: number, y: number, z: number, power: number): void {
    const random = ctx.random;
    this.effects.explosion(x, y, z, power, random);
    ctx.sound.blockBreak(Block.Stone);
    ctx.sound.blockBreak(Block.Gravel);

    // Bodies first, against the world as it stands, so the wall you hid
    // behind shelters you even though the blast then takes it down.
    this.hurtPlayer(ctx, x, y, z, power);
    this.hurtMobs(ctx, x, y, z, power);
    this.throwCharges(x, y, z, power);

    const cells = blastCells((bx, by, bz) => ctx.getBlock(bx, by, bz), x, y, z, power, random);
    // Break particles from a spread of the cells, not all of them: the
    // particle pool keeps only the newest few hundred, so a burst per cell
    // would show just the last handful of blocks anyway.
    const puffEvery = Math.max(1, Math.ceil(cells.length / MAX_DEBRIS_BURSTS));
    let destroyed = 0;
    cells.forEach(([cx, cy, cz], i) => {
      const id = ctx.getBlock(cx, cy, cz);
      if (id === Block.Air) return; // taken already, with a door's other half
      if (id === Block.TNT) {
        this.prime(ctx, cx, cy, cz, CHAIN_FUSE_MIN + random() * (CHAIN_FUSE_MAX - CHAIN_FUSE_MIN));
        return;
      }
      if (!blastBreak(ctx, cx, cy, cz, id, random() < DROP_CHANCE)) return;
      destroyed++;
      if (i % puffEvery === 0) ctx.breakParticles(cx, cy, cz, id);
    });
    this.history.push({ x, y, z, power, destroyed });
    if (this.history.length > 32) this.history.shift();
  }

  private hurtPlayer(ctx: GameContext, x: number, y: number, z: number, power: number): void {
    const pl = ctx.player;
    const cy = pl.y + PLAYER_HEIGHT / 2;
    const distance = Math.hypot(pl.x - x, cy - y, pl.z - z);
    if (distance >= power * 2) return;
    const seen = exposure(ctx, x, y, z, pl.x, pl.y, pl.z, 0.6, PLAYER_HEIGHT);
    const impact = impactAt(power, distance, seen);
    if (impact <= 0) return;
    const damage = blastDamage(power, impact);
    if (damage > 0) ctx.damagePlayer(damage, 'was blown up');
    const [ux, uy, uz] = away(pl.x - x, cy - y, pl.z - z);
    const kick = impact * 14;
    ctx.pushPlayer(ux * kick, uy * kick + impact * 5, uz * kick);
  }

  private hurtMobs(ctx: GameContext, x: number, y: number, z: number, power: number): void {
    for (const mob of ctx.mobs.mobs) {
      if (mob.dead) continue;
      const cy = mob.y + mob.def.height / 2;
      const distance = Math.hypot(mob.x - x, cy - y, mob.z - z);
      if (distance >= power * 2) continue;
      const seen = exposure(ctx, x, y, z, mob.x, mob.y, mob.z, mob.def.width, mob.def.height);
      const impact = impactAt(power, distance, seen);
      if (impact <= 0) continue;
      ctx.hurtMob(mob, blastDamage(power, impact), x, z);
      if (!mob.dead && !mob.def.boss && !mob.def.flying) mob.vy = Math.max(mob.vy, impact * 12);
    }
  }

  /** Other lit charges are thrown by the blast, which is half the fun of a chain. */
  private throwCharges(x: number, y: number, z: number, power: number): void {
    for (const c of this.charges) {
      const cx = c.x + CHARGE_SIZE / 2;
      const cy = c.y + CHARGE_SIZE / 2;
      const cz = c.z + CHARGE_SIZE / 2;
      const distance = Math.hypot(cx - x, cy - y, cz - z);
      const impact = impactAt(power, distance, 1);
      if (impact <= 0) continue;
      const [ux, uy, uz] = away(cx - x, cy - y, cz - z);
      c.vx += ux * impact * 10;
      c.vy += uy * impact * 10 + impact * 4;
      c.vz += uz * impact * 10;
    }
  }

  update(ctx: GameContext, dt: number): void {
    substeps(dt, (step) => this.tick(ctx, step));
  }

  private tick(ctx: GameContext, step: number): void {
    // Copied: a charge going off can light (append) more.
    for (const c of [...this.charges]) {
      c.fuse -= step;
      c.vy = Math.max(-40, c.vy - CHARGE_GRAVITY * step);
      moveCharge(ctx, c, step);
      if (c.fuse <= 0) {
        this.charges.splice(this.charges.indexOf(c), 1);
        this.explode(ctx, c.x + CHARGE_SIZE / 2, c.y + CHARGE_SIZE / 16, c.z + CHARGE_SIZE / 2, TNT_POWER);
      } else if (ctx.random() < step * 12) {
        // The fuse fizzing at the top.
        this.effects.burst('spark', c.x + 0.5, c.y + CHARGE_SIZE + 0.05, c.z + 0.5, 1, 0.05, 1.2, ctx.random, 0.06);
      }
    }
  }

  draw(ctx: GameContext, out: MeshBuilder, atlas: Atlas): void {
    const tex = blockDef(Block.TNT).textures;
    for (const c of this.charges) {
      // Flashes white on a beat that quickens as the fuse burns down, and
      // swells a little in the last moment.
      const beat = c.fuse < 1 ? 0.16 : 0.5;
      const flash = (c.fuse % beat) < beat / 2;
      const swell = 1 + Math.max(0, 0.35 - c.fuse) / 0.35 * 0.14;
      const h = (CHARGE_SIZE / 2) * swell;
      const base = lightAt(ctx.world, c.x + 0.5, c.y + 0.5, c.z + 0.5);
      out.box(
        atlas,
        [c.x + CHARGE_SIZE / 2, c.y + CHARGE_SIZE / 2, c.z + CHARGE_SIZE / 2],
        // A flash glows: it is as bright in a cave as in daylight.
        WORLD_AXES, [h, h, h], flash ? FLASH_TILE : tex, flash ? 1.15 : base,
      );
    }
  }

  reset(): void {
    this.charges.length = 0;
    this.history.length = 0;
  }
}

/** Most cells of one blast that get a burst of break particles. */
const MAX_DEBRIS_BURSTS = 24;

/**
 * Takes one block out for a blast, dropping it as an item when `drops`.
 * Returns whether it went.
 *
 * Not ctx.breakBlock, which is the player's break: it plays the block's
 * break sound and throws its particles every time, and two hundred break
 * thumps landing on the same instant sum far past full scale -- a blast
 * that clips the speakers. A machine still goes through breakBlock, since
 * that is what hands back whatever it held. Everything else is the same
 * edit, the same drops and the same break hook, only quiet.
 */
function blastBreak(ctx: GameContext, x: number, y: number, z: number, id: number, drops: boolean): boolean {
  if (isMachine(id)) {
    ctx.breakBlock(x, y, z, { drops });
    return ctx.getBlock(x, y, z) !== id;
  }
  if (!ctx.setBlock(x, y, z, Block.Air)) return false;
  if (drops && !ctx.creative) {
    for (const d of blockDrops(id, ctx.random, null)) ctx.dropItem(x + 0.5, y + 0.3, z + 0.5, d.id, d.count);
  }
  dispatchBreak(ctx, x, y, z, id, null);
  return true;
}

function away(dx: number, dy: number, dz: number): [number, number, number] {
  const len = Math.hypot(dx, dy, dz);
  // Dead centre: straight up is the only honest direction.
  if (len < 1e-6) return [0, 1, 0];
  return [dx / len, dy / len, dz / len];
}

/**
 * Moves a charge through the world one axis at a time, stopping at solid
 * blocks' real collision boxes. Friction on the ground; a bounce pad under
 * it throws it back up, the same as it would a player.
 */
function moveCharge(ctx: GameContext, c: PrimedCharge, dt: number): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(c.vx), Math.abs(c.vy), Math.abs(c.vz)) * dt / 0.3));
  for (let i = 0; i < steps; i++) {
    for (const axis of [1, 0, 2] as const) {
      const v = axis === 0 ? c.vx : axis === 1 ? c.vy : c.vz;
      const d = (v * dt) / steps;
      if (d === 0) continue;
      if (axis === 0) c.x += d; else if (axis === 1) c.y += d; else c.z += d;
      const edge = blocking(ctx, c, axis, d);
      if (edge === null) continue;
      if (axis === 0) { c.x = d > 0 ? edge - CHARGE_SIZE : edge; c.vx = 0; }
      else if (axis === 2) { c.z = d > 0 ? edge - CHARGE_SIZE : edge; c.vz = 0; }
      else {
        c.y = d > 0 ? edge - CHARGE_SIZE : edge;
        if (d < 0) {
          const under = ctx.getBlock(Math.floor(c.x + 0.5), Math.floor(c.y - 0.05), Math.floor(c.z + 0.5));
          const bounce = blockDef(under).bounce;
          c.vy = bounce > 0 && c.vy < -3 ? -c.vy * bounce : 0;
          c.vx *= 0.7;
          c.vz *= 0.7;
        } else {
          c.vy = 0;
        }
      }
    }
  }
}

/** The nearest face of a solid box the charge now overlaps along `axis`, if any. */
function blocking(ctx: GameContext, c: PrimedCharge, axis: 0 | 1 | 2, d: number): number | null {
  const lo = [c.x + 1e-4, c.y + 1e-4, c.z + 1e-4];
  const hi = [c.x + CHARGE_SIZE - 1e-4, c.y + CHARGE_SIZE - 1e-4, c.z + CHARGE_SIZE - 1e-4];
  let edge: number | null = null;
  for (let bx = Math.floor(lo[0]); bx <= Math.floor(hi[0]); bx++) {
    for (let by = Math.floor(lo[1]) - 1; by <= Math.floor(hi[1]); by++) {
      for (let bz = Math.floor(lo[2]); bz <= Math.floor(hi[2]); bz++) {
        const id = ctx.getBlock(bx, by, bz);
        if (!isSolid(id)) continue;
        for (const b of collisionBoxesAt(ctx.world, id, bx, by, bz)) {
          const bl = [bx + b.x0, by + b.y0, bz + b.z0];
          const bh = [bx + b.x1, by + b.y1, bz + b.z1];
          if (bh[0] <= lo[0] || bl[0] >= hi[0] || bh[1] <= lo[1] || bl[1] >= hi[1] ||
              bh[2] <= lo[2] || bl[2] >= hi[2]) continue;
          const face = d > 0 ? bl[axis] : bh[axis];
          if (edge === null || (d > 0 ? face < edge : face > edge)) edge = face;
        }
      }
    }
  }
  return edge;
}


