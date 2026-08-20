/** Per-dimension presentation: sky, fog and ambient light. */

import { Dimension } from '@shared/constants.js';

export interface DimensionLook {
  name: string;
  /** Clear colour, also used as the fog colour. */
  sky: [number, number, number];
  /** Floor brightness, so caves and the Nether are never pitch black. */
  ambient: number;
  /** Fog reaches full strength at this fraction of the far plane. */
  fogFar: number;
  /** Shown on arrival. */
  arrival: string;
}

const LOOKS: Record<Dimension, DimensionLook> = {
  [Dimension.Overworld]: {
    name: 'Overworld',
    sky: [0.55, 0.72, 0.93],
    ambient: 0.06,
    fogFar: 0.95,
    arrival: 'Back in the Overworld',
  },
  [Dimension.Nether]: {
    // Low, close, red: the Nether should feel like a cave that hates you.
    name: 'Nether',
    sky: [0.29, 0.06, 0.05],
    ambient: 0.30,
    fogFar: 0.6,
    arrival: 'The Nether',
  },
  [Dimension.End]: {
    name: 'The End',
    sky: [0.05, 0.04, 0.09],
    ambient: 0.42,
    fogFar: 0.85,
    arrival: 'The End',
  },
};

export function dimensionLook(dim: Dimension): DimensionLook {
  return LOOKS[dim] ?? LOOKS[Dimension.Overworld];
}

/** Tint applied when the camera is inside a liquid. */
export function submergedSky(block: 'water' | 'lava'): [number, number, number] {
  return block === 'water' ? [0.16, 0.34, 0.6] : [0.62, 0.24, 0.06];
}
