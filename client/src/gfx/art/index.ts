/**
 * Every texture recipe, gathered from the art modules.
 *
 * Each domain keeps its own file so the art for blocks, items and creatures
 * can change independently. A name defined twice is a mistake -- two recipes
 * racing for one tile, with whichever loads last silently winning -- so the
 * merge refuses it rather than picking one.
 */

import type { Recipe } from '../tile.js';
import { BLOCK_ART } from './blocks.js';
import { ENTITY_ART, EXTRA_TILES as ENTITY_TILES } from './entities.js';
import { ITEM_ART } from './items.js';

function merge(...sources: Array<[string, Record<string, Recipe>]>): Record<string, Recipe> {
  const out: Record<string, Recipe> = {};
  const owner: Record<string, string> = {};
  for (const [module, recipes] of sources) {
    for (const [name, recipe] of Object.entries(recipes)) {
      if (owner[name]) {
        throw new Error(`texture "${name}" is defined in both ${owner[name]} and ${module}`);
      }
      owner[name] = module;
      out[name] = recipe;
    }
  }
  return out;
}

export const ART: Record<string, Recipe> = merge(
  ['art/blocks', BLOCK_ART],
  ['art/items', ITEM_ART],
  ['art/entities', ENTITY_ART],
);

/** Tiles the block/item registries don't reference but the renderer needs. */
export const EXTRA_TILES: string[] = [...ENTITY_TILES];
