/**
 * Textures for the building pack's blocks (shared/src/content/building.ts).
 */

import type { Recipe } from '../tile.js';

export const BUILDING_ART: Record<string, Recipe> = {};

/**
 * Tiles no block or item names but the renderer still needs -- a mob skin,
 * an overlay -- so they are packed into the atlas anyway.
 */
export const BUILDING_EXTRA: string[] = [];
