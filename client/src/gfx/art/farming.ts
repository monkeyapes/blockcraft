/**
 * Textures for the farming pack's blocks (shared/src/content/farming.ts).
 */

import type { Recipe } from '../tile.js';

export const FARMING_ART: Record<string, Recipe> = {};

/**
 * Tiles no block or item names but the renderer still needs -- a mob skin,
 * an overlay -- so they are packed into the atlas anyway.
 */
export const FARMING_EXTRA: string[] = [];
