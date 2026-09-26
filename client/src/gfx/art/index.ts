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
import { BUILDING_ART, BUILDING_EXTRA } from './building.js';
import { COMBAT_ART, COMBAT_EXTRA } from './combat.js';
import { CREATURE_ART, CREATURE_EXTRA } from './creatures.js';
import { ENTITY_ART, EXTRA_TILES as ENTITY_TILES } from './entities.js';
import { EQUIPMENT_ART } from './equipment.js';
import { FARMING_ART, FARMING_EXTRA } from './farming.js';
import { FLUID_ART } from './fluids.js';
import { ITEM_ART } from './items.js';
import { NATURE_ART, NATURE_EXTRA } from './nature.js';

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
  ['art/equipment', EQUIPMENT_ART],
  ['art/entities', ENTITY_ART],
  ['art/nature', NATURE_ART],
  ['art/building', BUILDING_ART],
  ['art/farming', FARMING_ART],
  ['art/combat', COMBAT_ART],
  ['art/creatures', CREATURE_ART],
  ['art/fluids', FLUID_ART],
);

/** Tiles the block/item registries don't reference but the renderer needs. */
export const EXTRA_TILES: string[] = [...new Set([
  ...ENTITY_TILES, ...NATURE_EXTRA, ...BUILDING_EXTRA, ...FARMING_EXTRA,
  ...COMBAT_EXTRA, ...CREATURE_EXTRA,
])];
