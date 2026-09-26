/**
 * Loads every pack's client behaviour. Imported once, for its side effects,
 * by main.ts; each module registers its hooks with ./api.ts as it loads.
 */

import './nature.js';
import './building.js';
import './farming.js';
import './combat.js';
import './creatures.js';
import './fluids.js';
