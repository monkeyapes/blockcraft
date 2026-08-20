/**
 * First-person held item.
 *
 * Builds a small mesh directly in view space each frame: blocks render as a
 * cube, tools and other flat items as a billboard, and an empty hand as a
 * bare arm. Animated by a swing timer and a walking bob.
 */

import { blockDef } from '@shared/blocks.js';
import { isBlockItem, itemDef } from '@shared/items.js';
import { FLOATS_PER_VERTEX } from '../mesher.js';
import type { Atlas } from './atlas.js';

/** Cube corners per face, matching the mesher's face order. */
const CUBE_FACES: Array<{ corners: Array<[number, number, number]>; shade: number }> = [
  { corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], shade: 1.0 },
  { corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
  { corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.82 },
  { corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.82 },
  { corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.68 },
  { corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.68 },
];

const UV_TOP = [0, 0, 0, 1, 1, 1, 1, 0];
const UV_SIDE = [0, 1, 1, 1, 1, 0, 0, 0];

export interface HeldMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface HeldState {
  /** Item id, or null for an empty hand. */
  item: number | null;
  /** 0..1 through the swing animation. */
  swing: number;
  /** Accumulated walk cycle phase, in radians. */
  bob: number;
}

function rotate(
  p: [number, number, number], rx: number, ry: number,
): [number, number, number] {
  let [x, y, z] = p;
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  [x, z] = [x * cy - z * sy, x * sy + z * cy];
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  return [x, y, z];
}

export function buildHeldMesh(atlas: Atlas, state: HeldState): HeldMesh {
  const { item, swing, bob } = state;

  const isBlock = item !== null && isBlockItem(item);
  const flatItem = item !== null && !isBlock;

  // Swing arcs the item down and away, then back.
  const arc = Math.sin(swing * Math.PI);
  const rx = -0.35 + arc * 1.1;
  const ry = flatItem ? -0.5 : -0.62;

  const scale = isBlock ? 0.34 : flatItem ? 0.42 : 0.3;
  const originX = 0.46 + Math.sin(bob) * 0.012;
  const originY = -0.42 - arc * 0.34 + Math.abs(Math.cos(bob)) * 0.012;
  const originZ = -0.78;

  const verts: number[] = [];
  const indices: number[] = [];

  const push = (
    corners: Array<[number, number, number]>, uvs: number[],
    u0: number, v0: number, u1: number, v1: number, shade: number,
  ): void => {
    const first = verts.length / FLOATS_PER_VERTEX;
    for (let c = 0; c < 4; c++) {
      const [lx, ly, lz] = corners[c];
      const [rxp, ryp, rzp] = rotate(
        [(lx - 0.5) * scale, (ly - 0.5) * scale, (lz - 0.5) * scale], rx, ry);
      verts.push(
        originX + rxp, originY + ryp, originZ + rzp,
        uvs[c * 2] === 0 ? u0 : u1,
        uvs[c * 2 + 1] === 0 ? v0 : v1,
        shade, 1,
      );
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  };

  if (flatItem) {
    // A thin double-sided quad, so a pickaxe reads as a pickaxe.
    const [u0, v0, u1, v1] = atlas.uv(itemDef(item).texture);
    const face = CUBE_FACES[2];
    push(face.corners, UV_SIDE, u0, v0, u1, v1, 0.95);
    push([...face.corners].reverse() as typeof face.corners, UV_SIDE, u1, v0, u0, v1, 0.8);
    return { vertices: new Float32Array(verts), indices: new Uint32Array(indices) };
  }

  const textures: [string, string, string] = isBlock
    ? blockDef(item).textures
    : ['hand', 'hand', 'hand'];

  CUBE_FACES.forEach((face, f) => {
    const name = textures[f === 0 ? 0 : f === 1 ? 1 : 2];
    const [u0, v0, u1, v1] = atlas.uv(name);
    push(face.corners, f === 0 ? UV_TOP : UV_SIDE, u0, v0, u1, v1, face.shade);
  });

  return { vertices: new Float32Array(verts), indices: new Uint32Array(indices) };
}
