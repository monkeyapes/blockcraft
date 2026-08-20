/**
 * Loose items lying in the world.
 *
 * Drawn as small cubes that bob and spin, so a line of them riding a
 * conveyor reads as motion even when the belt underneath is static.
 */

import { blockDef, isOpaque } from '@shared/blocks.js';
import { isBlockItem, itemDef } from '@shared/items.js';
import { FLOATS_PER_VERTEX } from '../mesher.js';
import type { DroppedItem } from '../machines.js';
import type { Atlas } from './atlas.js';
import { CORNER_UV, CUBE_FACES } from './decal.js';

/** Half-extent of a dropped item cube, in blocks. */
const SIZE = 0.14;

export function buildItemMesh(
  atlas: Atlas, items: DroppedItem[], time: number,
): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];

  for (const it of items) {
    // A block item shows its own side texture; a tool shows its icon.
    const name = isBlockItem(it.id) && isOpaque(it.id)
      ? blockDef(it.id).textures[2]
      : itemDef(it.id).texture;
    const [u0, v0, u1, v1] = atlas.uv(name);

    // Spin and bob are driven by position as well as time, so a row of
    // items on a belt is not locked in unison.
    const phase = time * 1.8 + it.x * 0.7 + it.z * 0.7;
    const angle = phase;
    const bob = Math.sin(phase * 1.4) * 0.045;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cy = it.y + SIZE + 0.06 + bob;

    for (const face of CUBE_FACES) {
      const first = verts.length / FLOATS_PER_VERTEX;
      for (let c = 0; c < 4; c++) {
        const [dx, dy, dz] = face[c];
        const lx = (dx * 2 - 1) * SIZE;
        const ly = (dy * 2 - 1) * SIZE;
        const lz = (dz * 2 - 1) * SIZE;
        verts.push(
          it.x + lx * cos - lz * sin,
          cy + ly,
          it.z + lx * sin + lz * cos,
          CORNER_UV[c * 2] === 0 ? u0 : u1,
          CORNER_UV[c * 2 + 1] === 0 ? v0 : v1,
          1, 1,
        );
      }
      idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}
