/**
 * Textures for the fluids pack: the sides of running water and lava.
 *
 * The top of a stream is still the plain water or lava tile, so a river
 * reads as the same stuff as the lake it runs from. Only the sides change:
 * where a fluid is moving past you -- the face of a waterfall, the edge of a
 * stream spilling over a step -- the swells of the still tile are pulled out
 * into long vertical streaks, bright where they catch the light, the way
 * falling water looks from the side.
 */

import { S, TILE, makeNoise, nameSeed, type Recipe, type Tile } from '../tile.js';
import { Grid, bands, paint, type Ramp } from './blocks.js';

/** The still water tile's ramp, so a waterfall and its pool are one colour. */
const WATER: Ramp = [
  [24, 52, 132], [34, 74, 166], [46, 98, 194], [68, 128, 216], [132, 186, 238],
];

const LAVA: Ramp = [
  [88, 18, 16], [142, 32, 14], [196, 62, 16], [230, 102, 24], [248, 154, 40], [255, 216, 104],
];

/**
 * A noise field stretched along y: features several times taller than
 * they are wide. It is x that is scaled, by a whole number, so the lattice
 * still wraps at the tile's edges and a waterfall many blocks tall shows no
 * seam between them.
 */
function streaks(seed: number, stretch: number): Grid {
  const layers = [[3, 1], [6, 0.5]].map(([period, weight], i) =>
    ({ noise: makeNoise(seed + i * 7919), period, weight }));
  const g = new Grid();
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let v = 0;
      for (const { noise, period, weight } of layers) {
        v += (noise((x * S + S / 2) * stretch, y * S + S / 2, period) - 0.5) * weight;
      }
      g.v[y * TILE + x] = v;
    }
  }
  return g;
}

export const FLUID_ART: Record<string, Recipe> = {
  // Streaks of body blue with a few long glints running down them.
  water_flow: (t: Tile) => {
    const g = bands(streaks(nameSeed('water_flow'), 4), [0.14, 0.34, 0.36, 0.16]);
    paint(t, g.map((v, x, y) => (v === 3 && g.get(x, y - 1) === 3 && g.get(x - 1, y) < 3 ? 4 : v)),
      WATER, 190);
  },
  // Molten runnels: the hottest seams drawn out into threads.
  lava_flow: (t: Tile) => {
    const g = bands(streaks(nameSeed('lava_flow'), 4), [0.1, 0.18, 0.3, 0.24, 0.12, 0.06]);
    paint(t, g, LAVA);
  },
};
