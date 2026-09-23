/**
 * Textures for the creatures pack's blocks (shared/src/content/creatures.ts).
 */

import type { Recipe } from '../tile.js';

export const CREATURE_ART: Record<string, Recipe> = {};

/**
 * Tiles no block or item names but the renderer still needs -- a mob skin,
 * an overlay -- so they are packed into the atlas anyway.
 */
export const CREATURE_EXTRA: string[] = [];
