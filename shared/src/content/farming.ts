/**
 * The farming pack. Hoes, farmland, crops and their stages, and the food they make.
 *
 * Block and item ids are fixed in blockids.ts / itemids.ts; this file
 * defines what they are. See types.ts for every field a pack can set.
 */

import type { ContentPack } from './types.js';

export const FARMING: ContentPack = {
  name: 'farming',
  blocks: [],
  items: [],
  shapes: [],
  recipes: [],
  smelting: [],
  fuel: [],
  transitions: [],
};
