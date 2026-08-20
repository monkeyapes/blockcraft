/**
 * Break particles: a short burst of tiny cubes sampled from the broken
 * block's own texture, the way Minecraft's particles read as "chunks of the
 * block" rather than a generic effect.
 *
 * Kept as one flat array rebuilt into a mesh each frame -- there are never
 * more than a few hundred of these, so a fresh Float32Array per frame is
 * cheaper than the bookkeeping a pooled GPU buffer would need.
 */

import { Block, blockDef } from '@shared/blocks.js';
import { FLOATS_PER_VERTEX } from '../mesher.js';
import type { ClientWorld } from '../world.js';
import { CORNER_UV, CUBE_FACES } from './decal.js';
import type { Atlas } from './atlas.js';

const GRAVITY = 20;
/** Hard cap so a mining spree cannot grow the vertex buffer without bound. */
const MAX_PARTICLES = 300;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  size: number;
  u0: number; v0: number; u1: number; v1: number;
}

export class ParticleSystem {
  private particles: Particle[] = [];

  get count(): number {
    return this.particles.length;
  }

  /** Spawns a burst at a block that just broke. */
  spawnBreak(atlas: Atlas, x: number, y: number, z: number, blockId: number): void {
    if (blockId === Block.Air) return;
    // The side texture reads reasonably on every face of the fragment, and
    // sparing one atlas lookup for six textures keeps this cheap.
    const [u0, v0, u1, v1] = atlas.uv(blockDef(blockId).textures[2]);
    const uSpan = u1 - u0;
    const vSpan = v1 - v0;

    const count = 10;
    for (let i = 0; i < count; i++) {
      // A random small corner of the block's own texture, so fragments from
      // the same block still look varied rather than identical confetti.
      const patch = 0.35;
      const su0 = u0 + Math.random() * uSpan * (1 - patch);
      const sv0 = v0 + Math.random() * vSpan * (1 - patch);

      const life = 0.4 + Math.random() * 0.5;
      this.particles.push({
        x: x + 0.2 + Math.random() * 0.6,
        y: y + 0.2 + Math.random() * 0.6,
        z: z + 0.2 + Math.random() * 0.6,
        vx: (Math.random() - 0.5) * 2.6,
        vy: Math.random() * 3 + 1.5,
        vz: (Math.random() - 0.5) * 2.6,
        age: 0,
        life,
        size: 0.1 + Math.random() * 0.08,
        u0: su0, v0: sv0, u1: su0 + uSpan * patch, v1: sv0 + vSpan * patch,
      });
    }

    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  }

  update(dt: number, world: ClientWorld): void {
    if (this.particles.length === 0) return;
    const next: Particle[] = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;

      p.vy -= GRAVITY * dt;
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      const nz = p.z + p.vz * dt;
      // A block underfoot stops the fragment where it lands instead of
      // letting it sink into the floor -- not real collision, just enough to
      // read as "settling" for something this short-lived.
      if (world.getBlock(Math.floor(nx), Math.floor(ny - 0.05), Math.floor(nz)) !== Block.Air) {
        p.vx *= 0.6; p.vz *= 0.6; p.vy = 0;
      } else {
        p.x = nx; p.y = ny; p.z = nz;
      }
      next.push(p);
    }
    this.particles = next;
  }

  buildMesh(): { vertices: Float32Array; indices: Uint32Array } {
    const verts: number[] = [];
    const idx: number[] = [];
    for (const p of this.particles) {
      // Shrinks toward the end of its life rather than fading alpha, so it
      // never needs the translucent draw pass.
      const s = (p.size * (1 - p.age / p.life)) / 2;
      if (s <= 0) continue;
      for (const face of CUBE_FACES) {
        const first = verts.length / FLOATS_PER_VERTEX;
        for (let c = 0; c < 4; c++) {
          const [dx, dy, dz] = face[c];
          const px = p.x + (dx * 2 - 1) * s;
          const py = p.y + (dy * 2 - 1) * s;
          const pz = p.z + (dz * 2 - 1) * s;
          const u = CORNER_UV[c * 2] === 0 ? p.u0 : p.u1;
          const v = CORNER_UV[c * 2 + 1] === 0 ? p.v0 : p.v1;
          verts.push(px, py, pz, u, v, 1, 0.8);
        }
        idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
      }
    }
    return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
  }
}
