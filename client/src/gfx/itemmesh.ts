/**
 * Loose items lying in the world.
 *
 * A block drops as a miniature of its own model and anything else as its
 * extruded icon standing on edge, so a sword on the ground is a small solid
 * sword rather than a cube with a picture of one on each side. They bob and
 * spin, so a line of them riding a conveyor reads as motion even when the
 * belt underneath is static.
 */

import { isBlockItem } from '@shared/items.js';
import type { DroppedItem } from '../machines.js';
import type { Atlas } from './atlas.js';
import { MeshWriter, chain, itemModel, rotY, scale, translate } from './extrude.js';

/** Edge of a dropped block, in blocks. */
export const DROPPED_BLOCK = 0.28;
/** Height of a dropped item's icon, in blocks. */
export const DROPPED_SPRITE = 0.42;

const writer = new MeshWriter();

export function buildItemMesh(
  atlas: Atlas, items: DroppedItem[], time: number,
): { vertices: Float32Array; indices: Uint32Array } {
  writer.reset();
  for (const it of items) {
    const { model, block } = itemModel(atlas, it.id, isBlockItem(it.id));
    const size = block ? DROPPED_BLOCK : DROPPED_SPRITE;

    // Spin and bob are driven by position as well as time, so a row of
    // items on a belt is not locked in unison.
    const phase = time * 1.8 + it.x * 0.7 + it.z * 0.7;
    const bob = Math.sin(phase * 1.4) * 0.045;
    // The model's centre, lifted so its lowest point clears the ground
    // however far the bob dips.
    const cy = it.y + size / 2 + 0.06 + bob;
    writer.model(model, atlas, chain(translate(it.x, cy, it.z), rotY(phase), scale(size)), 1);
  }
  return writer.finish();
}
