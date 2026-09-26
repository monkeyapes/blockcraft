/**
 * Boxes in the terrain vertex format (px py pz u v light ao), for the things
 * the combat pack draws between frames of the world: arrows, falling sand,
 * primed charges, smoke.
 *
 * Faces and UVs follow the mesher's conventions exactly, so a falling block
 * of sand looks like the sand it was a moment ago and lands without its
 * texture jumping round.
 */

import { FLOATS_PER_VERTEX } from '../../mesher.js';
import { CUBE_FACES } from '../../gfx/decal.js';
import type { Atlas } from '../../gfx/atlas.js';
import type { ClientWorld } from '../../world.js';
import { isOpaque } from '@shared/blocks.js';

/** Which corner of a tile each of a face's four corners samples: top face. */
const UV_TOP = [0, 0, 0, 1, 1, 1, 1, 0];
/** The same for the bottom and the sides, so the tile stands upright. */
const UV_SIDE = [0, 1, 1, 1, 1, 0, 0, 0];
/** Directional shading per face, the mesher's own values. */
const FACE_SHADE = [1.0, 0.5, 0.8, 0.8, 0.65, 0.65];

export type Vec3 = [number, number, number];

/** Longest single simulation step, in seconds. */
const MAX_STEP = 0.05;

/**
 * Runs `tick` enough times, in equal steps no longer than MAX_STEP, to cover
 * `dt`. A slow frame then simulates the same thing as several fast ones --
 * a fuse burns for the time that passed, a falling block covers the same
 * ground -- instead of one oversized step overshooting.
 */
export function substeps(dt: number, tick: (step: number) => void): void {
  const n = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-9));
  for (let i = 0; i < n; i++) tick(dt / n);
}

/** A tile for every face, or [top, bottom, side]. */
export type BoxTex = string | [string, string, string];

function faceTex(tex: BoxTex, f: number): string {
  if (typeof tex === 'string') return tex;
  return tex[f === 0 ? 0 : f === 1 ? 1 : 2];
}

/** Brightness of a light level, on the mesher's curve (0.82 per level). */
function falloff(level: number): number {
  return Math.pow(0.82, 15 - Math.max(0, Math.min(15, level)));
}

/**
 * How lit a small entity at this point should be: the brighter of sky and
 * block light in its cell, like the mesher's light for a lone cell. A point
 * buried in something opaque -- an arrow's tip in a wall -- reads the cell
 * above instead, which is where the light that shows it comes from.
 */
export function lightAt(world: ClientWorld, x: number, y: number, z: number): number {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  let by = Math.floor(y);
  if (isOpaque(world.getBlock(bx, by, bz))) by++;
  const sky = world.getSkyLight(bx, by, bz);
  const block = world.getBlockLight(bx, by, bz);
  return Math.max(0.06, falloff(sky), falloff(block));
}

/** Accumulates boxes into one mesh. */
export class MeshBuilder {
  private readonly verts: number[] = [];
  private readonly indices: number[] = [];

  get empty(): boolean {
    return this.indices.length === 0;
  }

  /**
   * A box given by its centre, three unit axes and the half-size along each.
   * Axis-aligned boxes pass the world axes; an arrow passes its heading.
   * `light` above 1 washes the texture toward white (a flashing charge).
   */
  box(
    atlas: Atlas, centre: Vec3, axes: [Vec3, Vec3, Vec3], half: Vec3,
    tex: BoxTex, light: number,
  ): this {
    const [ax, ay, az] = axes;
    for (let f = 0; f < 6; f++) {
      const [u0, v0, u1, v1] = atlas.uv(faceTex(tex, f));
      const uvs = f === 0 ? UV_TOP : UV_SIDE;
      const first = this.verts.length / FLOATS_PER_VERTEX;
      const shade = FACE_SHADE[f] * light;
      for (let c = 0; c < 4; c++) {
        const [cx, cy, cz] = CUBE_FACES[f][c];
        const sx = (cx * 2 - 1) * half[0];
        const sy = (cy * 2 - 1) * half[1];
        const sz = (cz * 2 - 1) * half[2];
        this.verts.push(
          centre[0] + ax[0] * sx + ay[0] * sy + az[0] * sz,
          centre[1] + ax[1] * sx + ay[1] * sy + az[1] * sz,
          centre[2] + ax[2] * sx + ay[2] * sy + az[2] * sz,
          uvs[c * 2] === 0 ? u0 : u1,
          uvs[c * 2 + 1] === 0 ? v0 : v1,
          shade, 1,
        );
      }
      this.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
    return this;
  }

  /** An axis-aligned box from its two corners. */
  cube(
    atlas: Atlas, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    tex: BoxTex, light: number,
  ): this {
    return this.box(
      atlas, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], WORLD_AXES,
      [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], tex, light);
  }

  build(): { vertices: Float32Array; indices: Uint32Array } {
    return { vertices: new Float32Array(this.verts), indices: new Uint32Array(this.indices) };
  }
}

export const WORLD_AXES: [Vec3, Vec3, Vec3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/**
 * Three unit axes with the third pointing along `dir`: [side, up, along].
 * For something flying straight up or down, where "up" is no help, the
 * world's x axis stands in.
 */
export function frameAlong(dx: number, dy: number, dz: number): [Vec3, Vec3, Vec3] {
  const len = Math.hypot(dx, dy, dz) || 1;
  const f: Vec3 = [dx / len, dy / len, dz / len];
  // side = up x f, normalised; falls back when f is nearly vertical.
  let s: Vec3 = [f[2], 0, -f[0]];
  let sl = Math.hypot(s[0], s[2]);
  if (sl < 1e-4) { s = [1, 0, 0]; sl = 1; }
  s = [s[0] / sl, 0, s[2] / sl];
  const u: Vec3 = [
    f[1] * s[2] - f[2] * s[1],
    f[2] * s[0] - f[0] * s[2],
    f[0] * s[1] - f[1] * s[0],
  ];
  return [s, u, f];
}

/** Rotates the first two axes of a frame about the third, for a spin. */
export function rollFrame(frame: [Vec3, Vec3, Vec3], angle: number): [Vec3, Vec3, Vec3] {
  const [s, u, f] = frame;
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  return [
    [s[0] * c + u[0] * n, s[1] * c + u[1] * n, s[2] * c + u[2] * n],
    [u[0] * c - s[0] * n, u[1] * c - s[1] * n, u[2] * c - s[2] * n],
    f,
  ];
}
