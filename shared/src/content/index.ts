/**
 * Every content pack, in load order.
 *
 * The registries read this list; nothing else needs to know which packs
 * exist. A pack that defines the same block or item id as another one is an
 * error at load, not a silent override.
 */

import { BUILDING } from './building.js';
import { COMBAT } from './combat.js';
import { CREATURES } from './creatures.js';
import { FARMING } from './farming.js';
import { NATURE } from './nature.js';
import type { ContentPack } from './types.js';

export const PACKS: readonly ContentPack[] = [NATURE, BUILDING, FARMING, COMBAT, CREATURES];

export type { BlockSpec, ContentPack, CreativeTab, ItemSpec, SmeltSpec } from './types.js';
