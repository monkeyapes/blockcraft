/**
 * Textures for the farming pack's blocks (shared/src/content/farming.ts).
 *
 * Crops are drawn as sprites on transparent ground: each one is shown on
 * the four planes of a '#', so a stage's tile is what a row of plants looks
 * like from the side, stalks standing in the soil along the bottom edge.
 * The sprites keep off the left and right columns so neighbouring planes
 * never butt two plants together into one.
 */

import { type RGB, type Recipe, type Tile } from '../tile.js';

// --- soil -----------------------------------------------------------------------

const DRY_SOIL: RGB = [122, 86, 58];
const WET_SOIL: RGB = [78, 54, 38];

/**
 * Tilled soil: ridges and furrows every four units, so a field reads as
 * ploughed from across a valley. The ridge catches the light on its top
 * edge and the furrow sits in shadow, and the period divides the tile so
 * rows run on unbroken from block to block.
 */
function farmland(t: Tile, base: RGB, steps: number): void {
  const lit: RGB = [base[0] + 18, base[1] + 14, base[2] + 10];
  const shadow: RGB = [base[0] - 22, base[1] - 18, base[2] - 13];
  const deep: RGB = [base[0] - 40, base[1] - 32, base[2] - 23];
  t.fill(base, 7);
  t.patches(16, [base[0] - 10, base[1] - 8, base[2] - 5], 6, 2);
  for (let y = 0; y < 16; y += 4) {
    for (let x = 0; x < 16; x++) {
      // The ridge's lit crest is broken, as a hand-dug row is; the furrow
      // floor is continuous, which is what makes the rows read at all.
      if (t.rng() < 0.6) dot(t, x, y, lit, 6);
      if (t.rng() < 0.7) dot(t, x, y + 2, shadow, 5);
      dot(t, x, y + 3, deep, 5);
    }
  }
  // Clods kicked up out of the furrows and crumbs on the ridges.
  t.patches(10, [base[0] + 10, base[1] + 8, base[2] + 5], 6, 2);
  t.patches(6, deep, 4, 1);
  t.posterize(steps);
}

// --- crops ----------------------------------------------------------------------

/** One unit, jittered a touch so a stalk is not a ruled line. */
function dot(t: Tile, x: number, y: number, c: RGB, jitter = 6): void {
  const j = (t.rng() * 2 - 1) * jitter;
  t.set(x, y, c[0] + j, c[1] + j, c[2] + j);
}

/** A stalk from the soil (row 15) up to `top`, darker toward its foot. */
function stalk(t: Tile, x: number, top: number, c: RGB, foot: RGB): void {
  for (let y = top; y <= 15; y++) dot(t, x, y, y >= 14 ? foot : c);
}

/** A leaf springing off a stalk: `len` units out and up, to the side `dir`. */
function leaf(t: Tile, x: number, y: number, dir: 1 | -1, len: number, c: RGB): void {
  for (let i = 1; i <= len; i++) dot(t, x + dir * i, y - i + 1, c);
}

const SHOOT: RGB = [104, 170, 58];
const SHOOT_DARK: RGB = [58, 104, 34];
const STEM_GREEN: RGB = [82, 148, 48];
const RIPENING: RGB = [156, 170, 62];
const GOLD_STEM: RGB = [196, 160, 66];
const GOLD_FOOT: RGB = [138, 110, 44];
const GRAIN: RGB = [228, 192, 92];
const GRAIN_DARK: RGB = [178, 136, 52];

/** Where the wheat stalks stand across the tile, and how tall each is relative to the tallest. */
const WHEAT_ROWS: Array<[number, number]> = [[2, 1], [5, 0], [8, 2], [11, 0], [13, 1]];

/** A wheat ear: a fat head of grain, a lighter kernel on every other unit, whiskers on top. */
function ear(t: Tile, x: number, top: number, len: number, grain: RGB, dark: RGB): void {
  dot(t, x, top - 1, dark, 4);                         // awn
  for (let y = top; y < top + len; y++) {
    dot(t, x, y, (y - top) % 2 === 0 ? grain : dark, 5);
    dot(t, x + 1, y, (y - top) % 2 === 0 ? dark : grain, 5);
  }
}

function wheat(stage: number): Recipe {
  return (t) => {
    if (stage === 0) {
      // Green shoots just through the soil.
      // A few green shoots just through the soil, kept clear of the
      // corners where the planes cross so they stand apart rather than
      // joining into a square.
      for (const [x, drop] of [[6, 1], [9, 0]]) {
        stalk(t, x, 12 + drop, SHOOT, SHOOT_DARK);
        leaf(t, x, 14, x < 8 ? -1 : 1, 1, SHOOT);
      }
    } else if (stage === 1) {
      for (const [x, drop] of WHEAT_ROWS) {
        stalk(t, x, 9 + drop, STEM_GREEN, SHOOT_DARK);
        leaf(t, x, 13, -1, 2, SHOOT);
        leaf(t, x, 11 + drop, 1, 1, SHOOT);
      }
    } else if (stage === 2) {
      // Grown up and heading out: pale green ears on yellowing stalks.
      for (const [x, drop] of WHEAT_ROWS) {
        stalk(t, x, 6 + drop, RIPENING, SHOOT_DARK);
        leaf(t, x, 12, -1, 2, STEM_GREEN);
        ear(t, x, 5 + drop, 3, [182, 200, 96], [140, 162, 64]);
      }
    } else {
      // Ripe: tall and gold, heavy ears nodding at the top.
      for (const [x, drop] of WHEAT_ROWS) {
        stalk(t, x, 3 + drop, GOLD_STEM, GOLD_FOOT);
        leaf(t, x, 11 + drop, x < 8 ? 1 : -1, 1, [176, 150, 60]);
        ear(t, x, 2 + drop, 5, GRAIN, GRAIN_DARK);
      }
    }
  };
}

/**
 * Small plants drawn from a picture, one character per unit: carrot fronds
 * and potato leaves are too fine for strokes, where a pixel either side
 * decides whether a top reads as feathery or as a lump. The last row sits
 * on the soil; '.' is left clear.
 */
const PLANT_INK: Record<string, RGB> = {
  l: [140, 206, 94],   // lit leaf
  g: [90, 168, 58],    // leaf
  d: [50, 108, 34],    // stem and shade
  o: [214, 110, 30],   // carrot shoulder
  O: [246, 150, 48],   // carrot shoulder, lit
  t: [204, 168, 108],  // potato skin
  T: [168, 132, 80],   // potato skin, shaded
  f: [240, 236, 220],  // potato flower
};

function plant(t: Tile, cx: number, rows: readonly string[]): void {
  const top = 16 - rows.length;
  rows.forEach((row, r) => {
    for (let i = 0; i < row.length; i++) {
      const ink = PLANT_INK[row[i]];
      if (ink) dot(t, cx - (row.length >> 1) + i, top + r, ink, 7);
    }
  });
}

/** Carrot tops by stage: fronds with daylight through them, orange at the crown once ripe. */
const CARROT_TOPS: ReadonlyArray<readonly string[]> = [
  ['.l.l.', '..d..'],
  ['l.l.l', '.g.g.', '..g..', '..d..'],
  ['.l.l.', 'l.g.l', '.g.g.', 'g.g.g', '.ggg.', '..d..'],
  ['l.l.l', '.l.g.', 'g.g.g', '.g.g.', 'l.g.l', '.ggg.', '..d..', '.oOo.'],
];

/** Potato plants by stage: broad paired leaves, pale flowers and tubers once ripe. */
const POTATO_TOPS: ReadonlyArray<readonly string[]> = [
  ['.lgl.', '..d..'],
  ['.lll.', 'lg.gl', '.gdg.', '..d..'],
  ['..l..', '.lgl.', 'lg.gl', '.gdg.', 'll.ll', '.gdg.', '..d..'],
  ['..f..', '.lfl.', 'lgggl', '.gdg.', 'lg.gl', 'gd.dg', '.gdg.', '..d..', 't.d.T'],
];

function carrots(stage: number): Recipe {
  return (t) => {
    // A seedling stands alone mid-plane, clear of where the planes cross.
    for (const x of stage === 0 ? [8] : [3, 8, 12]) plant(t, x, CARROT_TOPS[stage]);
  };
}

function potatoes(stage: number): Recipe {
  return (t) => {
    for (const x of stage === 0 ? [8] : [3, 8, 12]) plant(t, x, POTATO_TOPS[stage]);
  };
}

// --- hay ------------------------------------------------------------------------

const STRAW: RGB = [206, 172, 72];
const TWINE: RGB = [120, 84, 40];

export const FARMING_ART: Record<string, Recipe> = {
  farmland_dry: (t) => farmland(t, DRY_SOIL, 10),
  // Wet soil is darker and a little glossy along the ridges.
  farmland_wet: (t) => {
    farmland(t, WET_SOIL, 12);
    t.patches(6, [104, 78, 58], 4, 2);
  },
  // The side of wet farmland: plain dirt, soaked darker.
  farmland_side_wet: (t) => t.fill([96, 68, 48], 8)
    .patches(20, [78, 54, 38], 8, 3)
    .patches(12, [116, 84, 60], 8, 2)
    .posterize(10),

  wheat_stage0: wheat(0),
  wheat_stage1: wheat(1),
  wheat_stage2: wheat(2),
  wheat_stage3: wheat(3),
  carrots_stage0: carrots(0),
  carrots_stage1: carrots(1),
  carrots_stage2: carrots(2),
  carrots_stage3: carrots(3),
  potatoes_stage0: potatoes(0),
  potatoes_stage1: potatoes(1),
  potatoes_stage2: potatoes(2),
  potatoes_stage3: potatoes(3),

  // Straw runs top to bottom in strands of slightly different gold, held
  // by two bands of twine. The bands sit a whole half-tile apart so a
  // stack of bales repeats them evenly.
  hay_side: (t) => {
    t.fill(STRAW, 6);
    for (let x = 0; x < 16; x++) {
      const tone = (t.rng() * 2 - 1) * 22;
      for (let y = 0; y < 16; y++) {
        const j = (t.rng() * 2 - 1) * 6;
        t.set(x, y, STRAW[0] + tone + j, STRAW[1] + tone + j, STRAW[2] + tone * 0.6 + j);
      }
    }
    t.patches(8, [176, 142, 56], 6, 2);
    for (const y of [3, 11]) {
      for (let x = 0; x < 16; x++) {
        dot(t, x, y, TWINE, 8);
        dot(t, x, y + 1, [96, 66, 32], 6);
      }
    }
    t.posterize(12);
  },
  // Cut ends of straw: a golden mat with the dark hollows of stalk ends
  // pressed into it, and the twine crossing over.
  hay_top: (t) => {
    t.fill([198, 164, 70], 8);
    t.patches(22, [222, 190, 94], 8, 2);
    t.patches(18, [164, 130, 50], 8, 2);
    t.patches(10, [138, 106, 40], 6, 1);
    for (let i = 0; i < 16; i++) {
      dot(t, 3, i, TWINE, 8);
      dot(t, 11, i, TWINE, 8);
    }
    t.posterize(12);
  },
};

/**
 * Tiles no block or item names but the renderer still needs -- a mob skin,
 * an overlay -- so they are packed into the atlas anyway.
 */
export const FARMING_EXTRA: string[] = [];
