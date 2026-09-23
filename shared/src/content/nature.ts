/**
 * The nature pack. Plants, trees, new stone and ores, snow and ice, and the biomes they grow in.
 *
 * Block and item ids are fixed in blockids.ts / itemids.ts; this file
 * defines what they are. See types.ts for every field a pack can set.
 */

import type { ContentPack } from './types.js';

export const NATURE: ContentPack = {
  name: 'nature',
  blocks: [],
  items: [],
  shapes: [],
  recipes: [],
  smelting: [],
  fuel: [],
  transitions: [],
};
