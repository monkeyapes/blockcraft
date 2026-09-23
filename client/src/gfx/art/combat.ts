/**
 * Textures for the combat pack's blocks (shared/src/content/combat.ts).
 */

import type { Recipe } from '../tile.js';

export const COMBAT_ART: Record<string, Recipe> = {};

/**
 * Tiles no block or item names but the renderer still needs -- a mob skin,
 * an overlay -- so they are packed into the atlas anyway.
 */
export const COMBAT_EXTRA: string[] = [];
