/**
 * Puffs: smoke, flame, sparks, snow and steam.
 *
 * The world's break particles are fragments of a block's own texture, which
 * is right for a block breaking and wrong for everything else -- an
 * explosion is fire and smoke first and flying dirt second, and a snowball
 * bursting is not a block at all. These are small cubes of their own tiles
 * that grow, drift and shrink, drawn with the combat pack's other entities.
 */

import type { Atlas } from '../../gfx/atlas.js';
import { substeps, WORLD_AXES, type MeshBuilder } from './geometry.js';

export type PuffKind = 'smoke' | 'flame' | 'spark' | 'snow' | 'steam';

interface Puff {
  kind: PuffKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  size: number;
}

/** How each kind moves and looks. */
const KINDS: Record<PuffKind, {
  tile: string; gravity: number; drag: number; grow: number; light: number;
}> = {
  // Smoke rises, slows and swells; it is the part of a blast that lingers.
  smoke: { tile: 'fx_smoke', gravity: -1.6, drag: 2.2, grow: 1.8, light: 1 },
  // Flame is brief and self-lit, so it glows even at night.
  flame: { tile: 'fx_flame', gravity: -0.8, drag: 3.5, grow: 0.8, light: 1.7 },
  spark: { tile: 'fx_spark', gravity: 14, drag: 0.8, grow: -0.6, light: 2 },
  snow: { tile: 'fx_snow', gravity: 12, drag: 1.2, grow: -0.4, light: 1 },
  steam: { tile: 'fx_snow', gravity: -2.4, drag: 2.5, grow: 1.4, light: 1.1 },
};

/** Enough for a chain of blasts without the vertex buffer growing unbounded. */
const MAX_PUFFS = 600;

export class Effects {
  readonly puffs: Puff[] = [];

  /** A burst of `count` puffs around a point, flung outward at up to `speed`. */
  burst(
    kind: PuffKind, x: number, y: number, z: number, count: number,
    spread: number, speed: number, random: () => number, size = 0.18,
  ): void {
    for (let i = 0; i < count; i++) {
      // A random direction, biased upward: things thrown by a burst mostly
      // go up and out, not into the ground.
      const a = random() * Math.PI * 2;
      const up = random() * 1.4 - 0.4;
      const s = speed * (0.35 + random() * 0.65);
      this.puffs.push({
        kind,
        x: x + (random() - 0.5) * spread,
        y: y + (random() - 0.5) * spread,
        z: z + (random() - 0.5) * spread,
        vx: Math.cos(a) * s, vy: up * s, vz: Math.sin(a) * s,
        age: 0,
        life: (kind === 'smoke' || kind === 'steam' ? 1.1 : 0.45) * (0.7 + random() * 0.6),
        size: size * (0.7 + random() * 0.6),
      });
    }
    if (this.puffs.length > MAX_PUFFS) this.puffs.splice(0, this.puffs.length - MAX_PUFFS);
  }

  /**
   * The look of an explosion: a flash of flame at the heart, a ring of smoke
   * thrown out and rising, sparks raining from it. Scaled by power so a
   * small pop and a chain of charges look different.
   */
  explosion(x: number, y: number, z: number, power: number, random: () => number): void {
    const r = Math.max(1, power);
    // Puffs are kept small and many. At half a block, growing to 1.4, a
    // power-3 blast's 40-odd smoke puffs filled the whole screen as grey
    // cubes whenever it went off near the camera, as a boomshroom does.
    this.burst('flame', x, y, z, Math.round(10 * r), r * 0.6, r * 2.2, random, 0.22);
    this.burst('smoke', x, y, z, Math.round(12 * r), r * 0.9, r * 2.8, random, 0.28);
    this.burst('spark', x, y, z, Math.round(6 * r), r * 0.4, r * 4, random, 0.08);
  }

  update(dt: number): void {
    substeps(dt, (step) => this.tick(step));
  }

  private tick(dt: number): void {
    let w = 0;
    for (const p of this.puffs) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = KINDS[p.kind];
      const damp = Math.exp(-k.drag * dt);
      p.vx *= damp;
      p.vz *= damp;
      p.vy = p.vy * damp - k.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      this.puffs[w++] = p;
    }
    this.puffs.length = w;
  }

  draw(out: MeshBuilder, atlas: Atlas, lightAt: (x: number, y: number, z: number) => number): void {
    for (const p of this.puffs) {
      const k = KINDS[p.kind];
      const light = k.light > 1 ? k.light : lightAt(p.x, p.y, p.z) * k.light;
      const t = p.age / p.life;
      // Grows (or shrinks) over its life, then pinches out at the very end
      // so nothing pops out of existence at full size.
      const s = Math.max(0, p.size * (1 + k.grow * t) * Math.min(1, (1 - t) * 4)) / 2;
      if (s <= 0.002) continue;
      out.box(atlas, [p.x, p.y, p.z], WORLD_AXES, [s, s, s], k.tile, light);
    }
  }

  reset(): void {
    this.puffs.length = 0;
  }
}
