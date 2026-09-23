/**
 * Textures for the nature pack's blocks (shared/src/content/nature.ts).
 */

import type { Recipe } from '../tile.js';

export const NATURE_ART: Record<string, Recipe> = {};

/**
 * Tiles no block or item names but the renderer still needs -- a mob skin,
 * an overlay -- so they are packed into the atlas anyway.
 */
export const NATURE_EXTRA: string[] = [];
