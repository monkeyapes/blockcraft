/**
 * Item icons: materials, food and vehicles.
 *
 * An icon is the only thing telling a player what an item is before they
 * hover it, so each one has to read as its name from silhouette alone. Tools,
 * weapons and armour live in art/equipment.ts; everything else is here.
 *
 * Most icons are authored as pixel maps on the 16-unit grid rather than
 * built from overlapping rects. At the 32-48px a slot shows them, the exact
 * placement of each unit is what separates a feather from a stick or a chop
 * from a steak, and a map is the one way of writing that down where the
 * picture in the source is the picture on screen.
 */

import { type RGB, type Recipe, TILE, TILE_PX, Tile } from '../tile.js';

/**
 * Paints a pixel map: 16 characters per row, one row per authoring unit,
 * '.' left transparent and every other character looked up in the palette.
 *
 * Row width and palette are checked, loudly: a row one character short
 * shifts the whole rest of the row by a unit, which reads on screen as a
 * mysteriously crooked icon rather than as the typo it is.
 */
function sprite(t: Tile, rows: string[], pal: Record<string, RGB>, jitter = 4, top = 0): Tile {
  rows.forEach((row, i) => {
    if (row.length !== TILE) throw new Error(`sprite row ${i} is ${row.length} wide, not ${TILE}: "${row}"`);
    for (let x = 0; x < TILE; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const c = pal[ch];
      if (!c) throw new Error(`sprite colour "${ch}" is not in the palette`);
      const d = jitter ? (t.rng() * 2 - 1) * jitter : 0;
      t.set(x, top + i, c[0] + d, c[1] + d, c[2] + d);
    }
  });
  return t;
}

/** A colour scaled toward black (k < 1) or lightened toward white (k > 1). */
function tone([r, g, b]: RGB, k: number): RGB {
  if (k <= 1) return [r * k, g * k, b * k];
  const w = k - 1;
  return [r + (255 - r) * w, g + (255 - g) * w, b + (255 - b) * w];
}

/**
 * The house finish: a light cel pass for the shared upper-left light, then
 * the dark silhouette ring. The maps are shaded by hand already, so the cel
 * pass is gentle -- it only has to tie them in with the rest of the set.
 */
function finish(t: Tile, ring: RGB = [10, 10, 12], strength = 0.85): Tile {
  return t.celShade(10, -12).outline(ring, strength);
}

/**
 * A one-pixel dark edge round everything drawn so far, at the rendered
 * resolution rather than the authoring grid.
 *
 * `outline` is half a unit thick, which on a one-unit strand -- a thread, a
 * straw, a spark -- is the whole strand, turning it into a black line. This
 * rims such details after the fact instead, leaving their middles bright.
 */
function rim(t: Tile, colour: RGB = [14, 14, 18], strength = 0.75): void {
  const src = t.px.slice();
  const clear = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX || src[(y * TILE_PX + x) * 4 + 3] < 8;
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const i = (y * TILE_PX + x) * 4;
      if (src[i + 3] < 8) continue;
      if (!clear(x - 1, y) && !clear(x + 1, y) && !clear(x, y - 1) && !clear(x, y + 1)) continue;
      t.px[i] += (colour[0] - src[i]) * strength;
      t.px[i + 1] += (colour[1] - src[i + 1]) * strength;
      t.px[i + 2] += (colour[2] - src[i + 2]) * strength;
    }
  }
}

/**
 * Grill marks: parallel diagonal bars across whatever `inside` accepts.
 *
 * Drawn on the cooked half of each raw/cooked pair and nowhere else. Colour
 * alone says "cooked" only to someone who has seen both; the bars say it to
 * anyone.
 */
function grill(t: Tile, inside: (x: number, y: number) => boolean, colour: RGB, spacing = 4): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (!inside(x, y)) continue;
      if (((x + y) % spacing + spacing) % spacing === 0) t.set(x, y, colour[0], colour[1], colour[2]);
    }
  }
}

/** Where a pixel map has one of the given characters. */
function where(rows: string[], chars: string): (x: number, y: number) => boolean {
  return (x, y) => y >= 0 && y < rows.length && chars.includes(rows[y][x] ?? '.');
}

export const ITEM_ART: Record<string, Recipe> = {};

/* ------------------------------------------------------------------------
 * Materials
 * --------------------------------------------------------------------- */

// A stick, 3 units across so it survives the outline with wood left in the
// middle: lit on its upper-left edge, shaded on the lower-right, with a
// knot partway up so it is a branch rather than a rod.
ITEM_ART.stick = (t) => {
  for (let k = 0; k <= 10; k++) {
    const x = 2 + k;
    const y = 13 - k;
    t.set(x, y, 176, 132, 80);
    t.set(x + 1, y, 132, 94, 52);
    t.set(x + 2, y, 96, 66, 36);
  }
  t.set(7, 7, 88, 60, 32);          // knot
  t.set(8, 8, 150, 110, 64);
  finish(t);
};

// An angular chunk with glossy facets, rising to a broken edge at the
// upper right: round is the snowball's outline, and the potato's. Near-
// black means a flat shade delta caps out fast, so bright facets do the
// work shading cannot.
const COAL = [
  '................',
  '................',
  '..........hh....',
  '........hhbbc...',
  '......hhbwbbcc..',
  '....hhbbbbbbccd.',
  '...hbbwbbbbcccd.',
  '..hbbbbbbbccccd.',
  '..bbbbbbbcccccd.',
  '.hbbbbbccccccdd.',
  '.bbbbccccccddd..',
  '.bbcccccccdd....',
  '..cccccddd......',
  '...ddddd........',
  '................',
  '................',
];
ITEM_ART.coal = (t) => finish(sprite(t, COAL, {
  w: [168, 168, 180], h: [104, 104, 112], b: [62, 62, 68], c: [42, 42, 46], d: [26, 26, 30],
}, 3));

/**
 * An ingot in three-quarter view: a lit top face, a front face and a
 * shaded end, so it reads as a solid bar rather than a flat rectangle. The
 * three metals share the shape on purpose -- they are the same kind of
 * thing -- and differ in colour only.
 */
const INGOT = [
  '................',
  '................',
  '................',
  '................',
  '.....hhhhhhhhhh.',
  '....hTTTTTTTTTR.',
  '...hTTTTTTTTTRR.',
  '..LLLLLLLLLLRRR.',
  '..FFFFFFFFFFRRR.',
  '..FFFFFFFFFFRRR.',
  '..FFFFFFFFFFRR..',
  '..DDDDDDDDDDR...',
  '................',
  '................',
  '................',
  '................',
];
function ingot(base: RGB): Recipe {
  return (t) => finish(sprite(t, INGOT, {
    h: tone(base, 1.55), T: tone(base, 1.25), L: tone(base, 1.4),
    F: base, D: tone(base, 0.72), R: tone(base, 0.8),
  }, 3));
}
ITEM_ART.iron_ingot = ingot([196, 198, 206]);
ITEM_ART.gold_ingot = ingot([232, 176, 44]);
ITEM_ART.copper_ingot = ingot([204, 108, 64]);

// A brilliant cut: flat table, a girdle at the widest point, then a
// pavilion tapering to a point. The facets make it a gem, not a blue ball.
const DIAMOND = [
  '................',
  '................',
  '................',
  '.....hhhhhh.....',
  '....hWWWLLLm....',
  '...hWWLLLLMMm...',
  '..hLLLLLLMMMMd..',
  '..eeeeeeeeeeee..',
  '...LLLLMMMMDd...',
  '....LLMMMMDd....',
  '.....LMMMDd.....',
  '......MMDd......',
  '.......Dd.......',
  '................',
  '................',
  '................',
];
ITEM_ART.diamond = (t) => finish(sprite(t, DIAMOND, {
  h: [224, 255, 255], W: [196, 250, 248], L: [120, 232, 228], M: [72, 196, 202],
  m: [100, 212, 214], D: [44, 150, 162], d: [34, 124, 138], e: [176, 248, 246],
}, 3));

// A step-cut stone, taller than wide, so it cannot be mistaken for the
// diamond at a glance even before its colour registers.
const RUBY = [
  '................',
  '................',
  '......hhhh......',
  '.....hWWLLm.....',
  '....hWLLLLMm....',
  '....hLiiiiMm....',
  '....LLiLLiMd....',
  '....LLiMMiMd....',
  '....LLiMMiDd....',
  '....LMiiiiDd....',
  '....mMMMDDDd....',
  '.....mMDDDd.....',
  '......dddd......',
  '................',
  '................',
  '................',
];
ITEM_ART.ruby = (t) => finish(sprite(t, RUBY, {
  h: [255, 196, 206], W: [255, 160, 172], L: [230, 58, 80], i: [252, 110, 126],
  M: [188, 28, 50], m: [206, 48, 68], D: [140, 14, 36], d: [108, 8, 28],
}, 3));

// A pelt, pegged out: four limb flaps at the corners and a notch for the
// neck. A cut hide rather than a brown picture frame.
const LEATHER = [
  '................',
  '................',
  '..hh.......mm...',
  '..hLL.....LMm...',
  '...LLLLnLLLMm...',
  '...LLLLLLLLMM...',
  '....LLnLLLLM....',
  '....LLLLLnLM....',
  '....LLLLLLMM....',
  '...LLnLLLLLMM...',
  '...LLLLLLLMMM...',
  '..hLL.....MMm...',
  '..hh.......mm...',
  '................',
  '................',
  '................',
];
ITEM_ART.leather = (t) => finish(sprite(t, LEATHER, {
  h: [190, 138, 92], L: [164, 112, 70], M: [134, 90, 54], m: [112, 74, 44], n: [140, 94, 56],
}, 5), [58, 36, 20]);

/**
 * A feather: a quill running corner to corner, a vane either side of it
 * that swells in the middle and narrows to a rounded tip, a bare quill end,
 * and one notch split into the upper vane -- the detail that makes it read
 * as a feather rather than a leaf. Worked out per unit from the distance to
 * a gently bowed spine, so both vanes follow the same curve.
 */
ITEM_ART.feather = (t) => {
  const lit: RGB = [246, 246, 250];
  const shadow: RGB = [200, 204, 220];
  const shaft: RGB = [172, 160, 138];
  // Vane half-width by position along the quill, bottom-left to tip.
  const width = (along: number): number =>
    along < -5 ? 0 : along < -2 ? along + 6 : along <= 5 ? 4 : along <= 7 ? 3 : along <= 9 ? 2 : 1;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const along = x - y;
      // Across the quill, which is two units wide (d = 0 and 1) so it reads
      // as a line rather than a dotted diagonal; below 0 is the upper-left.
      const d = x + y - 15;
      if (along < -12 || along > 11) continue;
      if (d === 0 || d === 1) t.set(x, y, ...shaft);
      else if (d < 0 && -d <= width(along)) {
        if (along + d === 0) continue;       // the notch, slanting toward the tip
        t.set(x, y, ...lit);
      } else if (d > 1 && d - 1 <= width(along)) t.set(x, y, ...shadow);
    }
  }
  finish(t, [40, 42, 60]);
  // The bare quill goes on after the ring, so the thin end stays pale.
  for (let i = 0; i < 5; i++) {
    t.set(1 + i, 14 - i, 196, 184, 156);
    t.set(2 + i, 14 - i, 150, 140, 118);
  }
  rim(t, [40, 42, 60]);
};

// A rod of banked fire: thicker than a stick, ringed with hotter bands, and
// throwing sparks that are drawn after the outline so they glow.
ITEM_ART.blaze_rod = (t) => {
  for (let k = 0; k <= 9; k++) {
    const x = 2 + k;
    const y = 13 - k;
    const band = k % 3 === 0;
    t.set(x, y, 255, band ? 240 : 222, band ? 160 : 104);
    t.set(x + 1, y, 250, band ? 214 : 176, 60);
    t.set(x + 2, y, 226, band ? 160 : 128, 30);
    t.set(x + 3, y, 184, 100, 18);
  }
  finish(t, [50, 16, 4]);
  for (const [x, y] of [[13, 1], [2, 10], [10, 8], [6, 3]] as const) t.set(x, y, 255, 214, 90);
  rim(t, [50, 16, 4]);
};

// A cone of glowing powder with sparks lifting off it. Narrower and more
// pointed than the other heaps, so the four powders differ in outline.
const BLAZE_POWDER = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......hh.......',
  '......hYYo......',
  '......YYYo......',
  '.....hYYYYo.....',
  '.....YYyYYo.....',
  '....hYYYYYOo....',
  '....YYYYyYYOo...',
  '...hYyYYYYYOOo..',
  '...OOOOOOOOOOo..',
  '................',
  '................',
];
ITEM_ART.blaze_powder = (t) => {
  finish(sprite(t, BLAZE_POWDER, {
    h: [255, 234, 130], Y: [250, 184, 52], y: [255, 238, 150], o: [214, 118, 24], O: [196, 96, 18],
  }, 6), [60, 20, 4]);
  for (const [x, y] of [[7, 2], [10, 3], [5, 4], [12, 6], [3, 8]] as const) t.set(x, y, 255, 206, 80);
  rim(t, [60, 20, 4]);
};

// A dark sea-green sphere with a pale swirl caught in it.
ITEM_ART.ender_pearl = (t) => {
  t.disc(7.5, 8, 4.6, [30, 104, 96], 4);
  t.disc(7, 7.4, 3.4, [44, 138, 124], 4);
  t.disc(6.4, 6.8, 1.9, [96, 206, 182], 3);
  t.set(5, 5, 200, 250, 236);
  t.set(9, 10, 22, 70, 66);
  t.set(10, 9, 22, 70, 66);
  finish(t);
};

// The pearl with an eye opened in it: an almond of pale gold and a slit
// pupil, so the two read as related but never as the same item.
ITEM_ART.eye_of_ender = (t) => {
  t.disc(7.5, 8, 5.4, [34, 112, 88], 4);
  t.disc(7, 7.4, 4, [52, 146, 110], 4);
  sprite(t, [
    '....aaaaaaa.....',
    '..aaEEEEEEEaa...',
    '.aEEEEEkEEEEEa..',
    '..aaEEEkEEEaa...',
    '....aaaaaaa.....',
  ], { a: [150, 170, 60], E: [226, 234, 150], k: [20, 30, 16] }, 2, 6);
  finish(t);
};

// Packed snow: a slightly lumpy ball with a blue shadow side.
ITEM_ART.snowball = (t) => {
  t.disc(8, 8.2, 5.6, [214, 228, 244], 3);
  t.disc(7.2, 7.4, 4.4, [240, 246, 252], 3);
  t.disc(6.4, 6.4, 2, [255, 255, 255], 1);
  t.rect(12, 6, 1, 3, [214, 228, 244]);   // lumps knocked into the outline
  t.rect(4, 12, 3, 1, [214, 228, 244]);
  t.set(9, 10, 190, 206, 230);
  t.set(11, 9, 190, 206, 230);
  finish(t, [40, 56, 90]);
};

// A slumped ball of gel with two drips running off its underside, a
// darker core showing through and a hard glint. One centred drip made it a
// lollipop, or a tree; two off-centre ones make it sticky.
const SLIME = [
  '................',
  '................',
  '................',
  '......hhhh......',
  '....hhGGGGgg....',
  '...hGWWGGGGgg...',
  '..hGWGGGGGGGgg..',
  '..hGGGGCCGGGGg..',
  '.hGGGGCCCCGGGgg.',
  '.GGGGGCCCCGGGgg.',
  '.GGGGGGCCGGGGgg.',
  '..gGGGGGGGGGgg..',
  '...ggGgggGgg....',
  '.....Gg..Gg.....',
  '.....gg...g.....',
  '................',
];
ITEM_ART.slimeball = (t) => finish(sprite(t, SLIME, {
  h: [170, 240, 150], G: [112, 204, 92], W: [236, 255, 226], C: [70, 150, 60], g: [78, 160, 64],
}, 4), [22, 60, 20]);

// A bone: a shaft with a double knuckle at each end.
ITEM_ART.bone_item = (t) => {
  const bone: RGB = [234, 228, 206];
  t.line(3, 11, 10, 4, bone, 3);
  t.line(5, 11, 11, 5, [210, 200, 172], 1);
  // Two bulbs at each end, set apart across the shaft so a notch shows
  // between them: joined into one bar they read as a hammer head.
  for (const [x, y] of [[2, 10.8], [4.2, 13], [10.8, 2], [13, 4.2]] as const) {
    t.disc(x, y, 1.7, bone, 3);
  }
  t.set(10, 2, 252, 250, 240);
  t.set(2, 10, 252, 250, 240);
  finish(t, [60, 54, 40]);
};

/**
 * A ball of thread: wound strands crossing over a round core, and the loose
 * end coming away from it in a loop. The loose end is drawn after the
 * outline -- thread is one unit thick, and a ring around a one-unit line is
 * the whole line.
 */
ITEM_ART.string = (t) => {
  const BALL = [
    '................',
    '................',
    '........hhhh....',
    '......hWWWWWw...',
    '.....hWWWWWWWw..',
    '.....WWWWWWWWw..',
    '....hWWWWWWWWWw.',
    '....WWWWWWWWWWw.',
    '....WWWWWWWWWWw.',
    '.....WWWWWWWWw..',
    '.....wWWWWWWww..',
    '......wwwwwww...',
  ];
  sprite(t, BALL, { h: [255, 255, 255], W: [236, 236, 242], w: [196, 196, 208] }, 3);
  // Wound strands in diagonal bands, two units wide so each band stays one
  // unbroken line rather than a row of dashes.
  const ball = where(BALL, 'W');
  for (let y = 0; y < BALL.length; y++) {
    for (let x = 0; x < TILE; x++) {
      if (ball(x, y) && (x - y + 20) % 5 < 2) t.set(x, y, 176, 176, 192);
    }
  }
  finish(t, [40, 40, 52]);
  const strand: RGB = [236, 236, 242];
  // Each step shares an edge with the last: a strand that only touches at
  // corners falls apart into dashes once its edge is rimmed.
  for (const [x, y] of [
    [5, 10], [4, 10], [4, 11], [3, 11], [3, 12], [3, 13], [4, 13], [5, 13], [5, 12],
    [6, 12], [7, 12], [7, 13], [8, 13], [9, 13], [10, 13], [10, 14], [11, 14], [12, 14],
  ] as const) t.set(x, y, ...strand);
  rim(t, [40, 40, 52]);
};

/**
 * Fuse powder: a low, wide spill of coarse dark-grey grit with a few loose
 * grains around it and a hint of rust-red in the mix -- it is volatile, and
 * the flecks say so without a skull on the label.
 */
const FUSE = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......hh.......',
  '.....hhGGgg.....',
  '....hGGrGGGgg...',
  '..hhGGGGGGrGGg..',
  '.hGGrGGGGGGGGgg.',
  '.GGGGGGGGrGGGGg.',
  '.ggggggggggggggg',
  '................',
  '................',
];
ITEM_ART.fuse_powder = (t) => {
  finish(sprite(t, FUSE, {
    h: [134, 134, 140], G: [92, 92, 98], r: [150, 64, 52], g: [62, 62, 68],
  }, 10), [18, 18, 20]);
  for (const [x, y] of [[3, 9], [13, 8], [6, 5], [11, 5], [1, 14], [14, 14]] as const) {
    t.set(x, y, 120, 120, 126);
  }
};

// A soft round dome of white powder.
const BONE_MEAL = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '......hhhh......',
  '....hhWWWWww....',
  '...hWWWWWWWWw...',
  '..hWWWWWWWWWWw..',
  '..WWWWWWWWWWWww.',
  '.hWWWWWWWWWWWWw.',
  '.WWWWWWWWWWWWwww',
  '.wWWWWWWWWWWwww.',
  '..wwwwwwwwwwww..',
  '................',
  '................',
];
ITEM_ART.bone_meal = (t) => finish(sprite(t, BONE_MEAL, {
  h: [255, 255, 255], W: [236, 234, 226], w: [200, 196, 186],
}, 6), [70, 66, 60]);

// A tall heap of cube crystals, stacked in steps: pointed and stepped,
// where bone meal is a low smooth dome.
const SUGAR = [
  '................',
  '................',
  '.......WW.......',
  '.......Ws.......',
  '......WWWs......',
  '......Wsss......',
  '.....WWsWWs.....',
  '.....WssWss.....',
  '....WWsWWsWs....',
  '....WssWssss....',
  '...WWsWWsWWsWs..',
  '...WssWssWssss..',
  '..WWsWWsWWsWWsW.',
  '..sssssssssssss.',
  '................',
  '................',
];
ITEM_ART.sugar = (t) => {
  finish(sprite(t, SUGAR, { W: [250, 250, 255], s: [204, 208, 222] }, 3), [70, 74, 92]);
  for (const [x, y] of [[7, 3], [5, 7], [10, 9], [2, 11]] as const) t.set(x, y, 255, 255, 255);
};

/* ------------------------------------------------------------------------
 * Food
 *
 * Every food used to be the same disc in a different colour, so a hotbar
 * of eight was eight identical circles. Each one now has its own outline --
 * a chop has a bone, a rack has ribs, a fish has a tail -- and each raw /
 * cooked pair shares that outline but not its colour, with grill marks on
 * the cooked half.
 * --------------------------------------------------------------------- */

interface Cut {
  rows: string[];
  raw: Record<string, RGB>;
  cooked: Record<string, RGB>;
  /** Characters that are meat, where the grill marks go on the cooked one. */
  meat: string;
  sear: RGB;
}

function cutPair(rawName: string, cookedName: string, cut: Cut): void {
  ITEM_ART[rawName] = (t) => finish(sprite(t, cut.rows, cut.raw));
  ITEM_ART[cookedName] = (t) => {
    sprite(t, cut.rows, cut.cooked);
    grill(t, where(cut.rows, cut.meat), cut.sear);
    finish(t);
  };
}

// A chop: a round eye of meat inside a rim of fat, with the bone jutting
// out of the bottom-left.
cutPair('raw_porkchop', 'cooked_porkchop', {
  rows: [
    '................',
    '................',
    '......ffff......',
    '....ffPPPPff....',
    '...fPPhhPPPPf...',
    '..fPPhPPPPPPPf..',
    '..fPPPPPpPPPPf..',
    '..fPPPPPPPPPpf..',
    '..fPPPpPPPPPpf..',
    '...fPPPPPPPpf...',
    '..bbfPPPPppf....',
    '.bBBbfffff......',
    '.bBBb...........',
    '..bb............',
    '................',
    '................',
  ],
  raw: {
    f: [250, 226, 220], P: [232, 132, 140], h: [248, 176, 180], p: [196, 96, 108],
    B: [244, 240, 226], b: [212, 202, 180],
  },
  cooked: {
    f: [222, 170, 104], P: [178, 106, 58], h: [206, 138, 80], p: [140, 76, 38],
    B: [234, 220, 186], b: [196, 176, 136],
  },
  meat: 'Pph',
  sear: [92, 50, 24],
});

// Beef: a broad slab with a fat cap along the top and marbling through it.
cutPair('raw_beef', 'steak', {
  rows: [
    '................',
    '................',
    '................',
    '...fffffffff....',
    '..fRRRRRRRRRff..',
    '.fRRRmRRRRRRRRf.',
    '.RRRRRmmRRRRRRR.',
    '.RRRRRRRRRRmRRR.',
    '.RRRRRRRRRRRmRd.',
    '.RRmmRRRRRRRRRd.',
    '..RRRmRRRRRRRd..',
    '...dRRRRRRRdd...',
    '....dddddddd....',
    '................',
    '................',
    '................',
  ],
  raw: { f: [246, 214, 206], R: [196, 58, 62], m: [236, 150, 150], d: [150, 34, 42] },
  cooked: { f: [214, 160, 96], R: [132, 72, 40], m: [176, 116, 70], d: [96, 50, 26] },
  meat: 'Rm',
  sear: [60, 32, 16],
});

// Mutton: a rack, with the rib bones standing up clean out of the meat.
cutPair('raw_mutton', 'cooked_mutton', {
  rows: [
    '................',
    '...bb..bb..bb...',
    '...BB..BB..BB...',
    '...BB..BB..BB...',
    '...BB..BB..BB...',
    '..fBBffBBffBBf..',
    '.fMMMMMMMMMMMMf.',
    '.MMhMMMMMMMMMMMd',
    '.MhMMMmMMMMmMMd.',
    '.MMMMMMMMMMMMMd.',
    '.MMMmMMMMMMMMdd.',
    '..MMMMMMMmMMdd..',
    '...dddddddddd...',
    '................',
    '................',
    '................',
  ],
  raw: {
    b: [252, 248, 236], B: [236, 230, 212], f: [248, 222, 214], M: [214, 110, 108],
    h: [236, 160, 156], m: [180, 80, 82], d: [150, 60, 64],
  },
  cooked: {
    b: [240, 226, 196], B: [220, 200, 160], f: [216, 170, 110], M: [160, 96, 54],
    h: [196, 132, 80], m: [124, 70, 36], d: [100, 56, 28],
  },
  meat: 'Mhm',
  sear: [74, 40, 18],
});

// A whole bird, trussed: a plump oval body, a wing folded along its side
// and one drumstick cocked up with the bone end showing. Two legs drawn
// level at the top read as the ears of some animal's head; one reads as a
// roast.
cutPair('raw_chicken', 'cooked_chicken', {
  rows: [
    '................',
    '............bb..',
    '...........bBBb.',
    '...........bBb..',
    '..........LLb...',
    '.........LLLL...',
    '....CCCCLLLLL...',
    '..CCCCCCCLLLL...',
    '.CWWCCCCCCLLCC..',
    '.CWCCCCCCCCCCCs.',
    'CCCCCwwCCCCCCCs.',
    'CCCCCCCwwCCCCss.',
    '.CCCCCCCCCCCsss.',
    '..sCCCCCCCsss...',
    '....ssssss......',
    '................',
  ],
  raw: {
    b: [226, 214, 196], B: [250, 244, 232], L: [236, 180, 162], C: [246, 204, 186],
    W: [255, 234, 224], w: [214, 164, 148], s: [214, 160, 144],
  },
  cooked: {
    b: [206, 186, 150], B: [240, 226, 196], L: [196, 124, 52], C: [212, 148, 70],
    W: [244, 196, 120], w: [150, 90, 36], s: [156, 92, 36],
  },
  meat: 'CLWw',
  sear: [120, 66, 24],
});

// A whole dressed rabbit on its side: a long arched body, the hind leg
// stretched out behind with its bone end showing, a short foreleg tucked
// under the front. A single haunch read as the chicken drumstick with a
// different tint; the whole animal has a silhouette nothing else shares.
cutPair('raw_rabbit', 'cooked_rabbit', {
  rows: [
    '................',
    '................',
    '................',
    '................',
    '.....hhhhh......',
    '...hhMMMMMMh....',
    '..hMMMMMMMMMMh..',
    '.hMMMMMMMMMMMMm.',
    '.MMMMMMMMMMMMMMm',
    '.MMMMMMMMMMMMMmm',
    '..MMMmmmMMMMMMmm',
    '..MMm....mMMMmmB',
    '..Mm......mmmmBB',
    '..bB...........b',
    '..BB............',
    '................',
  ],
  raw: {
    h: [246, 190, 180], M: [222, 142, 132], m: [184, 104, 100],
    B: [244, 238, 222], b: [208, 198, 176],
  },
  cooked: {
    h: [210, 150, 90], M: [172, 108, 60], m: [128, 74, 36],
    B: [232, 216, 180], b: [190, 170, 130],
  },
  meat: 'hMm',
  sear: [84, 46, 20],
});

// A fish side on: forked tail, dorsal fin, dark back, pale belly, one eye.
cutPair('raw_fish', 'cooked_fish', {
  rows: [
    '................',
    '................',
    '................',
    '.......ddd......',
    '......dddd......',
    '.ff..BBBBBBBB...',
    '.fffBBBBBBBBBB..',
    '..ffBBBBBBBBeBB.',
    '..fBBBBBBBBBBBBB',
    '..ffLLLLLLLLLLL.',
    '.fffLLLLLLLLLL..',
    '.ff..LLLLLLLL...',
    '.......ll.......',
    '................',
    '................',
    '................',
  ],
  raw: {
    d: [70, 110, 150], f: [96, 140, 178], B: [84, 128, 168], L: [196, 218, 230],
    e: [16, 16, 20], l: [120, 160, 190],
  },
  cooked: {
    d: [130, 78, 34], f: [150, 92, 42], B: [176, 112, 56], L: [226, 176, 104],
    e: [236, 230, 214], l: [160, 100, 48],
  },
  meat: 'BL',
  sear: [96, 52, 22],
});

// Wheat seeds: a scatter of small pointed grains.
ITEM_ART.wheat_seeds = (t) => {
  const seeds: Array<[number, number]> = [[3, 3], [8, 2], [12, 4], [5, 7], [10, 8], [2, 11], [7, 12], [12, 11]];
  for (const [x, y] of seeds) {
    sprite(t, [
      '.s..............',
      'SS..............',
      'Sd..............',
    ].map((r) => ('.'.repeat(x) + r).slice(0, 16)),
    { s: [196, 206, 120], S: [150, 166, 74], d: [106, 120, 48] }, 5, y);
  }
  finish(t, [40, 48, 16]);
};

/**
 * One ear of wheat on its stalk, leaning up to the right.
 *
 * It used to be a sheaf of three heads, which read as three wheats in one
 * slot -- the icon has to say "one of these". A single plump ear of paired
 * kernels with its bristles (awns) at the tip, on a straw stalk with one
 * leaf, is unmistakably one wheat. Ear, stalk and leaf are one outlined
 * shape -- the stalk two units thick, since a one-unit diagonal breaks into
 * separate dots at icon size -- and only the awns go on afterwards, as fine
 * strands with a light rim.
 */
ITEM_ART.wheat = (t) => {
  sprite(t, [
    '................',
    '................',
    '...........hK...',
    '..........hKGg..',
    '..........KGsK..',
    '.........hKGKg..',
    '.........KGsK...',
    '........hKGKg...',
    '........KGsK....',
    '.......SgKg.....',
    '......SSs.......',
    '.....SSs.LL.....',
    '....SSsLLl......',
    '...SSs..........',
    '..SSs...........',
    '..Ss............',
  ], {
    h: [252, 232, 150], K: [226, 180, 70], G: [242, 208, 110], s: [196, 148, 50],
    g: [176, 128, 38], S: [220, 186, 96], L: [170, 176, 80], l: [132, 140, 58],
  }, 3);
  finish(t, [70, 46, 10]);
  // Awns: three bristles up and out from the tip of the ear.
  const awn: RGB = [240, 212, 128];
  for (const [x0, y0, x1, y1] of [[12, 2, 14, 0], [13, 3, 15, 1], [11, 2, 11, 0]] as const) {
    t.line(x0, y0, x1, y1, awn, 1);
  }
  rim(t, [70, 46, 10], 0.5);
};

// A loaf: domed crust with three slashes scored across it.
ITEM_ART.bread = (t) => finish(sprite(t, [
  '................',
  '................',
  '................',
  '................',
  '.....hhhhhh.....',
  '...hhCCCCCCCc...',
  '..hCCsCCCsCCCc..',
  '.hCCCCsCCCsCCsc.',
  '.CCCCCCsCCCsCCcc',
  '.CCCCCCCCCCCCCcc',
  '.CCCCCCCCCCCCCcc',
  '.cCCCCCCCCCCCccc',
  '..cccccccccccc..',
  '................',
  '................',
  '................',
], {
  h: [232, 170, 90], C: [204, 132, 56], s: [246, 216, 156], c: [150, 88, 34],
}, 5));

// A carrot: an orange taper, ridged, with a green top.
ITEM_ART.carrot = (t) => finish(sprite(t, [
  '................',
  '...........gg.G.',
  '..........gGGgG.',
  '...........GgG..',
  '..........OOgGG.',
  '.........hOOOg..',
  '........hOrOOO..',
  '.......hOOOrOo..',
  '......OOrOOOo...',
  '.....OOOOrOo....',
  '....OOrOOoo.....',
  '...OOOoo........',
  '..OOoo..........',
  '..Oo............',
  '................',
  '................',
], {
  g: [50, 126, 44], G: [86, 178, 62], O: [242, 138, 36], h: [255, 186, 92],
  o: [196, 92, 22], r: [206, 106, 28],
}, 4));

// A potato: a lumpy oblong lying on the diagonal, with eyes. Lying at an
// angle keeps it from being one more round lump beside coal and bread.
const POTATO = [
  '................',
  '................',
  '................',
  '..........hhh...',
  '........hhPPPp..',
  '......hhPPPePPp.',
  '.....hPPPPPPPPp.',
  '....hPPePPPPPpp.',
  '...hPPPPPPPPPp..',
  '..hPPPPPPPePpp..',
  '..PPPPePPPPpp...',
  '.hPPPPPPPPpp....',
  '.PPPPPPPppp.....',
  '.pPPPPppp.......',
  '..ppppp.........',
  '................',
];
ITEM_ART.potato = (t) => finish(sprite(t, POTATO, {
  h: [236, 204, 142], P: [214, 174, 108], e: [128, 92, 46], p: [170, 128, 70],
}, 5));

// Baked: the same potato, its skin roasted dark and crisp, split open
// along its length to show a golden, steaming inside.
ITEM_ART.baked_potato = (t) => {
  sprite(t, POTATO, {
    h: [150, 96, 50], P: [118, 72, 36], e: [80, 46, 20], p: [86, 50, 24],
  }, 5);
  sprite(t, [
    '..........Yy....',
    '........YYyW....',
    '......YYyWY.....',
    '.....YyWYY......',
    '....YyYY........',
  ], { Y: [240, 196, 90], y: [255, 230, 150], W: [255, 248, 206] }, 3, 5);
  finish(t);
  for (const [x, y] of [[6, 2], [8, 1], [4, 4]] as const) t.set(x, y, 236, 236, 240);
  rim(t, [60, 60, 70], 0.5);
};

// A slice of pie in three-quarter view: the orange top narrowing to the
// point, the thick crust at its back, and the filling showing along its
// cut side. A slice rather than the whole pie, whose flat oval would be
// the loaf of bread's outline again.
ITEM_ART.pumpkin_pie = (t) => finish(sprite(t, [
  '................',
  '................',
  '................',
  '............cc..',
  '..........ccCC..',
  '........ccOOCC..',
  '......ccOOOOCC..',
  '....ccOOhOOOCC..',
  '..ccOOOhOOOOCC..',
  '.cOOOOOOOOOOCC..',
  '.FFFFFFFFFFFCC..',
  '.kkkkkkkkkkkCC..',
  '..DDDDDDDDDDDD..',
  '................',
  '................',
  '................',
], {
  c: [236, 194, 124], O: [226, 128, 38], h: [244, 164, 70], C: [204, 144, 76],
  F: [196, 100, 28], k: [214, 160, 92], D: [150, 96, 44],
}, 4));

// An apple: round with a dimple at the top, a stem and one leaf.
ITEM_ART.apple = (t) => finish(sprite(t, [
  '................',
  '........s.......',
  '.......sLL......',
  '.......sLLL.....',
  '...RRR.s.RRR....',
  '..RhhRRsRRRRr...',
  '.RhWRRRRRRRRRr..',
  '.RhRRRRRRRRRRr..',
  '.RRRRRRRRRRRRr..',
  '.RRRRRRRRRRRrr..',
  '.RRRRRRRRRRRrr..',
  '..RRRRRRRRRrr...',
  '...rRRRrRRrr....',
  '....rr...rr.....',
  '................',
  '................',
], {
  s: [110, 72, 36], L: [80, 170, 56], R: [210, 38, 40], h: [240, 110, 100],
  W: [255, 206, 196], r: [148, 18, 24],
}, 4));

// A slice of melon: a shallow half-round of red flesh with black seeds, a
// pale band and the green rind round the curve.
ITEM_ART.melon_slice = (t) => finish(sprite(t, [
  '................',
  '................',
  '................',
  '................',
  '................',
  'ffffffffffffffff',
  '.FFkFFFFkFFFFkF.',
  '.FFFFFkFFFFkFFF.',
  '..wFFFFFFkFFFw..',
  '..GwwFFFFFFwwG..',
  '...GGwwwwwwGG...',
  '....gGGGGGGg....',
  '................',
  '................',
  '................',
  '................',
], {
  f: [252, 120, 110], F: [230, 66, 70], k: [30, 20, 20], w: [238, 232, 196],
  G: [76, 156, 54], g: [44, 110, 34],
}, 4));

// A door, standing: two panes of glass up top, panelled below, a handle.
ITEM_ART.door_wood_item = (t) => finish(sprite(t, [
  '................',
  '....hPPPPPPd....',
  '....PgGPPgGd....',
  '....PGGPPGGd....',
  '....PPPPPPPd....',
  '....PpPPpPPd....',
  '....PpPPpPPd....',
  '....PpPPpPHd....',
  '....PpPPpPHd....',
  '....PpPPpPPd....',
  '....PPPPPPPd....',
  '....PpPPpPPd....',
  '....PpPPpPPd....',
  '....PpPPpPPd....',
  '....dddddddd....',
  '................',
], {
  h: [204, 156, 100], P: [172, 124, 72], p: [136, 94, 52], d: [112, 76, 40],
  g: [200, 236, 250], G: [132, 184, 214], H: [236, 204, 96],
}, 5));

/* ------------------------------------------------------------------------
 * Vehicles
 * --------------------------------------------------------------------- */

ITEM_ART.boat = (t) => {
  // Seen from the side: a planked hull with a raised prow and stern, an
  // oar resting across it, and the water it sits in.
  t.rect(2, 8, 12, 3, [150, 112, 64], 7);       // hull
  t.rect(1, 7, 3, 2, [168, 128, 76], 6);        // prow
  t.rect(12, 7, 3, 2, [150, 112, 64], 6);       // stern
  t.rect(3, 7, 9, 1, [186, 148, 92], 5);        // gunwale
  t.rect(3, 9, 10, 1, [124, 90, 50], 4);        // plank seam
  t.rect(4, 11, 8, 1, [120, 86, 48], 4);        // keel
  t.line(4, 4, 11, 7, [120, 86, 48], 1);        // oar shaft
  t.rect(3, 3, 2, 2, [150, 112, 64], 4);        // oar blade
  t.rect(1, 12, 14, 1, [72, 128, 196], 6);      // water
  t.celShade(20, -18);
  t.outline();
};
ITEM_ART.truck = (t) => {
  t.rect(1, 7, 14, 4, [60, 62, 70], 6);         // chassis + bed
  t.rect(9, 3, 5, 4, [80, 84, 94], 6);          // cab
  t.rect(10, 4, 3, 2, [150, 206, 232], 6);      // windscreen
  t.rect(1, 5, 7, 2, [96, 100, 110], 5);        // bed walls
  t.rect(14, 7, 1, 2, [232, 216, 150], 4);      // headlight
  t.rect(2, 11, 3, 3, [34, 34, 38], 3);         // wheels
  t.rect(10, 11, 3, 3, [34, 34, 38], 3);
  t.rect(3, 12, 1, 1, [150, 150, 156]);         // hubs
  t.rect(11, 12, 1, 1, [150, 150, 156]);
  t.celShade(20, -18);
  t.outline();
};
ITEM_ART.skateboard = (t) => {
  t.rect(2, 7, 12, 2, [168, 132, 78], 8);     // deck
  t.rect(1, 6, 2, 2, [168, 132, 78], 6);      // upturned nose
  t.rect(13, 6, 2, 2, [168, 132, 78], 6);     // and tail
  t.rect(2, 6, 12, 1, [60, 60, 66], 4);       // grip tape
  t.rect(3, 9, 3, 1, [150, 150, 156], 4);     // trucks
  t.rect(10, 9, 3, 1, [150, 150, 156], 4);
  t.rect(3, 10, 2, 2, [232, 214, 120], 4);    // wheels
  t.rect(5, 10, 1, 2, [200, 180, 96], 2);
  t.rect(10, 10, 2, 2, [232, 214, 120], 4);
  t.rect(12, 10, 1, 2, [200, 180, 96], 2);
  t.celShade(20, -18);
  t.outline();
};
ITEM_ART.car = (t) => {
  t.rect(1, 8, 14, 4, [168, 62, 52], 7);      // body
  t.rect(4, 4, 8, 4, [150, 74, 60], 7);       // cabin
  t.rect(5, 5, 3, 2, [150, 206, 232], 6);     // glass, split by the pillar
  t.rect(9, 5, 2, 2, [150, 206, 232], 6);
  t.rect(13, 8, 2, 2, [246, 226, 150], 4);    // headlight
  t.rect(1, 9, 1, 2, [200, 60, 50], 2);       // tail light
  t.rect(2, 12, 3, 3, [36, 36, 40], 3);       // wheels
  t.rect(11, 12, 3, 3, [36, 36, 40], 3);
  t.rect(3, 13, 1, 1, [160, 160, 166]);       // hubs
  t.rect(12, 13, 1, 1, [160, 160, 166]);
  t.celShade(20, -18);
  t.outline();
};
// Seen from above, which is the only view where a plane's wings, tail and
// fuselage all read at once.
ITEM_ART.plane = (t) => {
  t.rect(7, 1, 3, 13, [214, 214, 220], 6);    // fuselage
  t.rect(7, 0, 3, 2, [176, 176, 182], 5);     // nose
  t.rect(1, 6, 15, 3, [198, 198, 204], 6);    // main wing
  t.rect(4, 12, 9, 2, [198, 198, 204], 5);    // tailplane
  t.rect(7, 3, 3, 2, [150, 206, 232], 5);     // canopy
  t.rect(0, 6, 2, 3, [166, 66, 58], 4);       // wingtip flashes
  t.rect(14, 6, 2, 3, [166, 66, 58], 4);
  t.celShade(20, -18);
  t.outline();
};
ITEM_ART.helicopter = (t) => {
  t.rect(1, 2, 15, 1, [222, 222, 228], 3);    // main rotor
  t.rect(7, 3, 2, 3, [130, 130, 136], 3);     // mast
  t.rect(2, 6, 8, 6, [214, 214, 220], 6);     // cabin
  t.rect(3, 7, 4, 3, [150, 206, 232], 6);     // glass
  t.rect(10, 7, 5, 3, [190, 190, 196], 5);    // tail boom
  t.rect(14, 4, 1, 5, [150, 150, 156], 3);    // tail rotor
  t.rect(2, 13, 9, 1, [130, 130, 136], 3);    // skids
  t.rect(3, 12, 1, 2, [130, 130, 136], 3);
  t.rect(9, 12, 1, 2, [130, 130, 136], 3);
  t.celShade(20, -18);
  t.outline();
};
