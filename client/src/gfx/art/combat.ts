/**
 * Textures for the combat pack's blocks (shared/src/content/combat.ts), and
 * for the things it throws around: arrows in flight, snowballs, fireballs,
 * and the smoke and flame an explosion leaves behind.
 *
 * The item icons -- bow, arrow, hammers, buckets -- are drawn with the rest
 * of the equipment in art/equipment.ts.
 */

import { TILE, type RGB, type Recipe, Tile } from '../tile.js';

// --- TNT -------------------------------------------------------------------
//
// Not a crate with a word painted on it: a bundle of sixteen paper-wrapped
// charges, four across and four deep, lashed round the middle with a
// yellow-and-black hazard band. The sticks read as dynamite from the side,
// the round ends and the fuse read as dynamite from above, and the band says
// "danger" to anyone who has seen a road sign.

const STICK_SHADOW: RGB = [118, 24, 20];
const STICK_LIGHT: RGB = [232, 92, 66];
const STICK_MID: RGB = [198, 48, 38];
const STICK_DARK: RGB = [160, 34, 28];
const HAZARD_YELLOW: RGB = [238, 196, 46];
const HAZARD_BLACK: RGB = [34, 30, 28];
const CORD: RGB = [70, 50, 32];

/** Four vertical sticks, each a four-unit cylinder shaded left to right. */
function sticks(t: Tile): Tile {
  t.fill(STICK_MID, 5);
  for (let s = 0; s < 4; s++) {
    const x = s * 4;
    t.rect(x, 0, 1, TILE, STICK_SHADOW, 3);
    t.rect(x + 1, 0, 1, TILE, STICK_LIGHT, 4);
    t.rect(x + 2, 0, 1, TILE, STICK_MID, 4);
    t.rect(x + 3, 0, 1, TILE, STICK_DARK, 3);
  }
  // Creases in the paper wrapping, so a stick is paper and not plastic.
  for (let i = 0; i < 7; i++) {
    const x = ((t.rng() * 4) | 0) * 4 + 1 + ((t.rng() * 2) | 0);
    const y = (t.rng() * TILE) | 0;
    t.blot(x, y, 1, 2, [206, 70, 52], 4);
  }
  return t;
}

/**
 * A charge seen end-on: a paper ring lit on its upper-left rim and shaded on
 * its lower-right, a card end-cap with a hole punched for the fuse, and dark
 * gaps where the round sticks do not meet.
 *
 * Each end has to read as a disc. Flat-coloured rings touching their
 * neighbours merge into a grid, and a red grid with pale squares in it reads
 * as a tablecloth rather than as sixteen sticks of anything.
 */
function stickEnds(t: Tile, cap: RGB, ring: RGB, gap: RGB): Tile {
  t.fill(gap, 3);
  const lit: RGB = [ring[0] + 40, ring[1] + 30, ring[2] + 24];
  const shade: RGB = [ring[0] * 0.62, ring[1] * 0.62, ring[2] * 0.62];
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const x = gx * 4;
      const y = gy * 4;
      // A rounded 4x4: the corners stay gap, which is what makes them round.
      t.rect(x + 1, y, 2, 1, lit, 4);
      t.rect(x, y + 1, 1, 2, lit, 4);
      t.rect(x + 3, y + 1, 1, 2, shade, 4);
      t.rect(x + 1, y + 3, 2, 1, shade, 4);
      t.rect(x + 1, y + 1, 2, 2, cap, 6);
      t.set(x + 2, y + 2, cap[0] * 0.55, cap[1] * 0.55, cap[2] * 0.55);
    }
  }
  return t;
}

// --- bounce pad --------------------------------------------------------------

const GEL: RGB = [112, 194, 72];
const GEL_LIGHT: RGB = [168, 232, 116];
const GEL_DARK: RGB = [58, 118, 40];
const STEEL: RGB = [148, 152, 160];
const STEEL_LIGHT: RGB = [196, 200, 208];
const STEEL_DARK: RGB = [84, 86, 94];

/** Brushed steel with a bolted rim, for the pad's base and the spike plate. */
function plate(t: Tile, base: RGB): Tile {
  t.fill(base, 4).streaks(8).patches(6, [base[0] - 14, base[1] - 14, base[2] - 14], 4, 3).posterize(10);
  t.border([base[0] - 50, base[1] - 50, base[2] - 48]);
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]] as const) {
    t.set(x, y, base[0] + 50, base[1] + 50, base[2] + 50);
    t.set(x + 1, y + 1, base[0] - 60, base[1] - 60, base[2] - 58);
  }
  return t;
}

// --- spikes -------------------------------------------------------------------

/**
 * Steel for the spikes, brightest in the rows the points sample.
 *
 * Each step of a spike shows a band of this tile (texture follows the box's
 * real height): the base course samples the bottom rows, the tips the middle.
 * So the tile goes dark at the bottom where the spikes meet the plate, bright
 * towards the points, and back to dark again at the top -- which nothing
 * samples, and which lets the tile still wrap onto itself without a seam.
 */
function spikeSteel(t: Tile): void {
  t.fill([118, 122, 132], 3);
  const bands: Array<[number, RGB]> = [
    [0, [100, 104, 114]], [2, [150, 154, 166]], [3, [206, 210, 220]], [6, [180, 184, 196]],
    [9, [146, 150, 162]], [12, [112, 116, 126]], [14, [92, 94, 102]],
  ];
  for (let i = 0; i < bands.length; i++) {
    const [y, c] = bands[i];
    const next = i + 1 < bands.length ? bands[i + 1][0] : TILE;
    t.rect(0, y, TILE, next - y, c, 4);
  }
  // A glint up the points, and rust only down where the steel meets the plate.
  for (let x = 1; x < TILE; x += 4) t.rect(x, 3, 1, 6, [238, 240, 246], 3);
  for (let i = 0; i < 6; i++) {
    t.blot((t.rng() * TILE) | 0, 13 + ((t.rng() * 2) | 0), 2, 1, [124, 72, 46], 8);
  }
  t.streaks(6, true).posterize(12);
}

export const COMBAT_ART: Record<string, Recipe> = {
  tnt_side: (t) => {
    sticks(t);
    // The lashing: cord above and below a band of hazard stripes.
    t.rect(0, 6, TILE, 1, CORD, 4);
    t.rect(0, 9, TILE, 1, CORD, 4);
    for (let y = 7; y <= 8; y++) {
      for (let x = 0; x < TILE; x++) {
        const c = (x + y) % 4 < 2 ? HAZARD_YELLOW : HAZARD_BLACK;
        t.set(x, y, c[0], c[1], c[2]);
      }
    }
    t.posterize(14);
  },
  tnt_top: (t) => {
    stickEnds(t, [196, 160, 112], STICK_MID, [46, 14, 12]);
    // The fuse: a twist of cord rising from where the middle four meet,
    // curling off to one side.
    // Pale twine with a dark shadow down its right side, so it stands out
    // against red and gap alike.
    const twine: RGB = [214, 204, 176];
    const shadow: RGB = [40, 34, 30];
    const path: Array<[number, number]> = [[7, 8], [8, 7], [9, 6], [10, 5], [10, 4], [11, 3]];
    for (const [x, y] of path) t.set(x + 1, y + 1, ...shadow);
    for (const [x, y] of path) t.set(x, y, ...twine);
    t.set(7, 8, 150, 140, 118); // where it disappears into the bundle
    t.set(11, 3, 246, 240, 222); // the frayed, unlit tip
    t.posterize(14);
  },
  tnt_bottom: (t) => {
    stickEnds(t, [150, 120, 84], STICK_DARK, [40, 12, 10]);
    t.posterize(12);
  },

  // The cushion from above: a gel mat inside a darker hem, with a raised
  // ring round the middle where you are meant to land.
  bounce_pad_top: (t) => {
    t.fill(GEL, 6).patches(8, [98, 178, 62], 5, 3).patches(5, [134, 212, 90], 5, 2);
    t.border(GEL_DARK);
    for (let i = 4; i <= 11; i++) {
      t.set(i, 4, ...GEL_LIGHT);
      t.set(4, i, ...GEL_LIGHT);
      t.set(i, 11, ...GEL_DARK);
      t.set(11, i, ...GEL_DARK);
    }
    t.rect(7, 7, 2, 2, GEL_LIGHT, 4);
    t.set(2, 2, 206, 246, 170); // a wet highlight
    t.set(3, 2, 186, 238, 148);
    t.posterize(12);
  },
  bounce_pad_bottom: (t) => {
    plate(t, [118, 120, 128]);
  },
  // Side view, top to bottom, lined up with the model (texture rows follow
  // the boxes' real heights): cushion from 16/16 down to 9/16, the springs'
  // gap, then the base plate in its hazard paint from 3/16 to the floor.
  bounce_pad_side: (t) => {
    t.fill(GEL, 6).patches(6, [98, 178, 62], 5, 2);
    t.rect(0, 0, TILE, 1, GEL_DARK, 3);
    t.rect(0, 4, TILE, 1, GEL_LIGHT, 4);   // the cushion's top edge at 12/16
    t.rect(0, 6, TILE, 1, GEL_DARK, 3);    // its hem
    t.rect(0, 7, TILE, 6, [40, 42, 46], 3); // the dark gap behind the springs
    for (const x of [2, 11]) {
      for (let y = 7; y < 13; y++) {
        const c = y % 2 === 0 ? STEEL_LIGHT : STEEL_DARK;
        t.rect(x, y, 3, 1, c, 3);
      }
    }
    t.rect(0, 13, TILE, 3, STEEL, 4);
    for (let x = 0; x < TILE; x++) {
      const c = x % 4 < 2 ? HAZARD_YELLOW : HAZARD_BLACK;
      t.set(x, 14, c[0], c[1], c[2]);
    }
    t.rect(0, 13, TILE, 1, STEEL_LIGHT, 3);
    t.rect(0, 15, TILE, 1, STEEL_DARK, 3);
    t.posterize(12);
  },
  // A coil seen side-on: bright turns and dark gaps.
  bounce_pad_spring: (t) => {
    t.fill(STEEL, 3);
    for (let y = 0; y < TILE; y++) {
      const phase = y % 2;
      t.rect(0, y, TILE, 1, phase === 0 ? STEEL_LIGHT : STEEL_DARK, 4);
    }
    t.rect(0, 0, 3, TILE, [120, 124, 132], 3); // the coil's shaded flank
    t.posterize(10);
  },

  spikes: spikeSteel,
  spikes_plate: (t) => {
    plate(t, [92, 94, 100]);
  },

  // --- in flight ------------------------------------------------------------

  // Wood grain running along the shaft.
  projectile_arrow_shaft: (t) => {
    t.fill([150, 110, 64], 6);
    for (let y = 0; y < TILE; y += 3) t.rect(0, y, TILE, 1, [118, 84, 46], 4);
    t.posterize(8);
  },
  // Copper, since that is what the recipe tips them with: bright and warm,
  // so the head is what you see coming.
  projectile_arrow_head: (t) => {
    t.fill([206, 118, 70], 6);
    t.rect(0, 0, TILE, 5, [240, 170, 116], 5);
    t.rect(0, 11, TILE, 5, [150, 78, 44], 5);
    t.posterize(8);
  },
  // A feather vane: a tapering shape on transparent, pale with a red bar,
  // attached along the bottom edge (the shaft side).
  projectile_arrow_fletching: (t) => {
    for (let x = 0; x < TILE; x++) {
      // Tallest at the back (x = 0), sweeping down to nothing at the front.
      const h = Math.max(2, Math.round(14 - x * 0.8));
      for (let y = TILE - h; y < TILE; y++) {
        const c: RGB = x >= 5 && x <= 7 ? [196, 46, 40] : [236, 234, 226];
        const d = (t.rng() * 2 - 1) * 8;
        t.set(x, y, c[0] + d, c[1] + d, c[2] + d);
      }
    }
    t.celShade(16, -24);
  },
  projectile_snowball: (t) => {
    t.fill([240, 246, 252], 5).patches(6, [206, 220, 236], 5, 3).posterize(6);
  },
  projectile_fireball: (t) => {
    t.fill([236, 136, 36], 8).patches(8, [252, 214, 90], 8, 3).patches(6, [196, 70, 24], 6, 3);
    t.swirl([255, 236, 140], [214, 84, 24], 255);
    t.posterize(8);
  },

  // --- effects ---------------------------------------------------------------

  fx_smoke: (t) => {
    t.fill([150, 150, 150], 12).patches(8, [116, 116, 118], 8, 4).patches(6, [186, 186, 186], 8, 3);
    t.posterize(6);
  },
  fx_flame: (t) => {
    t.fill([252, 180, 52], 10).patches(8, [255, 234, 128], 8, 3).patches(5, [234, 96, 30], 8, 3);
    t.posterize(6);
  },
  fx_spark: (t) => {
    t.fill([255, 246, 196], 8).patches(6, [255, 214, 110], 6, 3);
  },
  fx_snow: (t) => {
    t.fill([246, 250, 255], 4).patches(5, [214, 228, 244], 4, 3);
  },
};

/**
 * Tiles no block or item names but the renderer still needs: the pad's
 * springs and the spike plate (per-box textures in their models), and
 * everything the combat systems draw in flight.
 */
export const COMBAT_EXTRA: string[] = [
  'bounce_pad_spring', 'spikes_plate',
  'projectile_arrow_shaft', 'projectile_arrow_head', 'projectile_arrow_fletching',
  'projectile_snowball', 'projectile_fireball',
  'fx_smoke', 'fx_flame', 'fx_spark', 'fx_snow',
];
