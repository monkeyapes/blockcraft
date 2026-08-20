/**
 * Cube-shaped decal geometry: the mining-progress overlay today, a natural
 * home for anything else that needs "a block's faces, slightly inflated" --
 * a placement preview outline, for instance.
 */

import { FLOATS_PER_VERTEX } from '../mesher.js';
import type { Atlas } from './atlas.js';

/** Six faces, 4 CCW corners each as seen from outside -- matches the mesher. */
export const CUBE_FACES: Array<Array<[number, number, number]>> = [
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], // +Y
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // -Y
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // +Z
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], // -Z
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], // +X
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], // -X
];

/** Which corner of a UV rect each of a face's 4 CCW corners samples. */
export const CORNER_UV = [0, 0, 0, 1, 1, 1, 1, 0];

/** A one-block cube of decal geometry, sampling one UV rect on every face. */
export function cubeMesh(
  x: number, y: number, z: number, inflate: number,
  u0: number, v0: number, u1: number, v1: number,
): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  for (const face of CUBE_FACES) {
    const first = verts.length / FLOATS_PER_VERTEX;
    for (let c = 0; c < 4; c++) {
      const [dx, dy, dz] = face[c];
      const px = x - inflate + dx * (1 + inflate * 2);
      const py = y - inflate + dy * (1 + inflate * 2);
      const pz = z - inflate + dz * (1 + inflate * 2);
      const u = CORNER_UV[c * 2] === 0 ? u0 : u1;
      const v = CORNER_UV[c * 2 + 1] === 0 ? v0 : v1;
      // Full light and AO: the overlay should read the same regardless of
      // how dim the block underneath is, the way Minecraft's does.
      verts.push(px, py, pz, u, v, 1, 1);
    }
    idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

/** The mining-progress overlay for the block at (x, y, z), stage 0-9. */
export function buildCrackMesh(
  atlas: Atlas, x: number, y: number, z: number, stage: number,
): { vertices: Float32Array; indices: Uint32Array } {
  const clamped = Math.max(0, Math.min(9, Math.floor(stage)));
  const [u0, v0, u1, v1] = atlas.uv(`crack_${clamped}`);
  // Inflated a hair so the overlay wins the depth test against the block
  // face it sits on, rather than z-fighting with it.
  return cubeMesh(x, y, z, 0.003, u0, v0, u1, v1);
}
