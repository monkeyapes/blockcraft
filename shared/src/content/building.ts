/**
 * The building pack. Slabs, stairs, fences, walls, panes, doors, trapdoors, lanterns, wool, storage blocks: everything with a shape that is not a cube.
 *
 * Block and item ids are fixed in blockids.ts / itemids.ts; this file
 * defines what they are. See types.ts for every field a pack can set.
 */

import type { ContentPack } from './types.js';

export const BUILDING: ContentPack = {
  name: 'building',
  blocks: [],
  items: [],
  shapes: [],
  recipes: [],
  smelting: [],
  fuel: [],
  transitions: [],
};
