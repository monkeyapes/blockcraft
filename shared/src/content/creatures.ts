/**
 * The creatures pack. What the new mobs drop and need: bones, string, slimeballs, fuse powder, fish, shears, cobwebs.
 *
 * Block and item ids are fixed in blockids.ts / itemids.ts; this file
 * defines what they are. See types.ts for every field a pack can set.
 */

import type { ContentPack } from './types.js';

export const CREATURES: ContentPack = {
  name: 'creatures',
  blocks: [],
  items: [],
  shapes: [],
  recipes: [],
  smelting: [],
  fuel: [],
  transitions: [],
};
