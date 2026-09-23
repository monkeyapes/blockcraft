/**
 * The combat pack. Bows and arrows, hammers, buckets, TNT and the bounce pad.
 *
 * Block and item ids are fixed in blockids.ts / itemids.ts; this file
 * defines what they are. See types.ts for every field a pack can set.
 */

import type { ContentPack } from './types.js';

export const COMBAT: ContentPack = {
  name: 'combat',
  blocks: [],
  items: [],
  shapes: [],
  recipes: [],
  smelting: [],
  fuel: [],
  transitions: [],
};
