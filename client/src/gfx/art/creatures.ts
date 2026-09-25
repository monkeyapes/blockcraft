/**
 * Textures for the creatures pack: the cobweb block, and every mob's skin.
 *
 * Mob skins come in two kinds, matching how client/src/gfx/mobmesh.ts maps
 * them. *Materials* (hide, wool, scales) are sampled one texel per model
 * sixteenth from the tile's top-left, so a leg four units wide shows the
 * first four columns: anything meant for the edge of a body part -- a
 * sleeve cuff, a hoof, a fish's pale belly -- is drawn where that window
 * will find it. *Decals* (faces, eyes, snouts) are stretched whole over one
 * face and are drawn as pixel art on a grid the size of that face, so a
 * pixel of a face is the same size as a pixel of the body around it.
 *
 * Every design here is our own: a black-faced sheep, a rust-shirted zombie,
 * a crimson toadstool that walks. Minecraft-like in scale and chunkiness,
 * not in any particular layout.
 */

import { TILE_PX, type RGB, type Recipe, Tile } from '../tile.js';

export const CREATURE_ART: Record<string, Recipe> = {};

// --- helpers -------------------------------------------------------------------

/** Fills one cell of an nx-by-ny grid laid over the whole tile, in real pixels. */
function cell(t: Tile, nx: number, ny: number, gx: number, gy: number, c: RGB, a = 255): void {
  const x0 = Math.round((gx * TILE_PX) / nx);
  const x1 = Math.round(((gx + 1) * TILE_PX) / nx);
  const y0 = Math.round((gy * TILE_PX) / ny);
  const y1 = Math.round(((gy + 1) * TILE_PX) / ny);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * TILE_PX + x) * 4;
      t.px[i] = c[0];
      t.px[i + 1] = c[1];
      t.px[i + 2] = c[2];
      t.px[i + 3] = a;
    }
  }
}

/**
 * Pixel art from rows of characters, stretched over the whole tile: one row
 * per pixel of the face it goes on. '.' leaves what is underneath.
 */
function grid(t: Tile, rows: string[], palette: Record<string, RGB>, alpha: Record<string, number> = {}): void {
  const ny = rows.length;
  const nx = rows[0].length;
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      const ch = rows[gy][gx];
      if (ch === '.' || ch === undefined) continue;
      const c = palette[ch];
      if (c) cell(t, nx, ny, gx, gy, c, alpha[ch] ?? 255);
    }
  }
}

function scaled(c: RGB, k: number): RGB {
  return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
}

/** A hide: base colour, broad blotching, fine tooth, flattened to a few tones. */
function hide(base: RGB, jitter = 7, tones = 6): Recipe {
  return (t) => {
    t.fill(base, jitter + 6);
    t.mottle(scaled(base, 0.86), 0.5, 4);
    t.mottle(scaled(base, 1.1), 0.35, 7);
    t.grain(12, 12);
    t.posterize(tones);
  };
}

/** Fur: short vertical strands in two tones. */
function fur(base: RGB, strands: RGB): Recipe {
  return (t) => {
    t.fill(base, 8);
    t.streaks(10, true);
    for (let i = 0; i < 26; i++) {
      const x = (t.rng() * 16) | 0;
      const y = (t.rng() * 15) | 0;
      t.set(x, y, ...strands);
      t.set(x, y + 1, ...scaled(strands, 0.92));
    }
    t.mottle(scaled(base, 0.85), 0.35, 4);
    t.posterize(7);
  };
}

/** A whole-tile face decal: a fill of the head's own skin, then pixel art on top. */
function face(skin: Recipe, rows: string[], palette: Record<string, RGB>): Recipe {
  return (t) => {
    skin(t);
    grid(t, rows, palette);
  };
}

// --- overlays -------------------------------------------------------------------

/** The red wash over a mob that has just been hit, or is dying. */
CREATURE_ART.mob_hurt = (t) => t.fill([255, 40, 32], 0, 120);
/** The white blink of a fuse about to go. */
CREATURE_ART.mob_flash = (t) => t.fill([255, 255, 255], 0, 150);

// --- the cobweb block -------------------------------------------------------------

/**
 * Silk strung across the cell: spokes from the centre to every edge and
 * corner, and sagging rings between them. Mirror-symmetric both ways, so
 * two webs side by side meet strand to strand.
 */
CREATURE_ART.cobweb = (t) => {
  t.fill([224, 226, 230], 0, 0);
  const silk: RGB = [236, 238, 242];
  const dim: RGB = [184, 188, 196];
  const plot = (x: number, y: number, c: RGB): void => {
    const px = Math.round(x * 4);
    const py = Math.round(y * 4);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      for (const [mx, my] of [[px + dx, py + dy], [63 - px - dx, py + dy], [px + dx, 63 - py - dy], [63 - px - dx, 63 - py - dy]]) {
        if (mx < 0 || my < 0 || mx > 63 || my > 63) continue;
        const i = (my * 64 + mx) * 4;
        t.px[i] = c[0];
        t.px[i + 1] = c[1];
        t.px[i + 2] = c[2];
        t.px[i + 3] = 235;
      }
    }
  };
  // Spokes: centre to corner, centre to edge middles, drawn in one quadrant
  // and mirrored into the others.
  for (let s = 0; s <= 8; s += 0.125) {
    plot(s, s, silk);
    plot(s, 8, silk);
    plot(8, s, silk);
    plot(s, 8 - (8 - s) * 0.45, dim);
  }
  // Rings that sag between the spokes.
  for (const r of [2.2, 4.4, 6.4]) {
    for (let a = 0; a <= Math.PI / 2; a += 0.02) {
      const sag = 0.35 * Math.sin(a * 4) ** 2;
      const rr = r - sag;
      plot(8 - Math.cos(a) * rr, 8 - Math.sin(a) * rr, r === 4.4 ? silk : dim);
    }
  }
  // A few dewy knots where strands cross.
  for (const [x, y] of [[8 - 4.4 * 0.707, 8 - 4.4 * 0.707], [8 - 2.2, 8]]) plot(x, y, [255, 255, 255]);
};

// --- pig ---------------------------------------------------------------------------

const PIG: RGB = [236, 160, 164];
CREATURE_ART.mob_pig_hide = (t) => {
  hide(PIG, 6)(t);
  // A few darker bristle patches, and dirt from wallowing low on the flanks.
  t.patches(5, scaled(PIG, 0.9), 4, 2);
  for (let x = 0; x < 16; x++) t.shade(x, 15, -14);
  // Trotters: the bottom of each leg's window is dark hoof.
  for (let x = 0; x < 4; x++) {
    t.set(x, 15, 92, 58, 58);
    t.set(x, 14, 150, 94, 96);
  }
};
CREATURE_ART.mob_pig_ear = hide(scaled(PIG, 0.88), 4);
CREATURE_ART.mob_pig_face = face(hide(PIG, 5), [
  '........',
  '........',
  '.wk..kw.',
  '.kk..kk.',
  '........',
  'b......b',
  '........',
  '........',
], { w: [250, 246, 244], k: [44, 26, 30], b: [246, 128, 140] });
CREATURE_ART.mob_pig_snout = face(hide(scaled(PIG, 0.94), 3), [
  'sssss',
  's.s.s',
  'snsns',
  'sssss',
], { s: [224, 136, 146], n: [104, 50, 60] });

// --- cow ---------------------------------------------------------------------------

const COW_BROWN: RGB = [92, 64, 46];
const COW_WHITE: RGB = [232, 228, 218];
/**
 * Patchy hide: broad brown with irregular white patches, wrapping so the
 * pattern runs on round the body instead of stopping at each edge.
 */
CREATURE_ART.mob_cow_hide = (t) => {
  hide(COW_BROWN, 5)(t);
  for (const [x, y, w, h] of [[2, 1, 5, 4], [3, 3, 3, 3], [10, 6, 4, 5], [9, 8, 3, 4], [5, 11, 4, 3], [13, 13, 4, 3], [0, 8, 2, 3]]) {
    t.blot(x, y, w, h, COW_WHITE, 5);
  }
  t.grain(8, 10);
};
CREATURE_ART.mob_cow_head = hide(COW_BROWN, 5);
CREATURE_ART.mob_cow_leg = (t) => {
  hide(COW_BROWN, 5)(t);
  // White socks over dark hooves at the bottom of the leg window.
  for (let x = 0; x < 16; x++) {
    for (let y = 7; y < 10; y++) t.set(x, y, ...COW_WHITE);
    for (let y = 10; y < 12; y++) t.set(x, y, 58, 50, 46);
  }
};
CREATURE_ART.mob_cow_face = face(hide(COW_BROWN, 5), [
  '...ww...',
  '...ww...',
  '.wk.wkw.',
  '.kk.wkk.',
  '....ww..',
  '...www..',
  '..wwww..',
  '..wwww..',
], { w: COW_WHITE, k: [28, 20, 18] });
CREATURE_ART.mob_cow_muzzle = hide([222, 190, 176], 4);
CREATURE_ART.mob_cow_nose = face(hide([222, 190, 176], 4), [
  '......',
  '.n..n.',
  '.n..n.',
  '......',
], { n: [92, 58, 56] });
CREATURE_ART.mob_horn = (t) => {
  t.fill([226, 216, 190], 6);
  for (let x = 0; x < 16; x++) t.shade(x, 0, 18);
  t.grain(10, 6);
  t.posterize(5);
};
CREATURE_ART.mob_cow_ear = hide([70, 50, 38], 4);
CREATURE_ART.mob_udder = (t) => {
  hide([240, 170, 172], 4)(t);
  for (const x of [1, 3]) t.set(x, 1, 206, 120, 128);
};

// --- sheep: black-faced, with a thick cream fleece ------------------------------

const WOOL: RGB = [236, 232, 220];
CREATURE_ART.mob_wool = (t) => {
  t.fill(WOOL, 6);
  // Curls: small rounded clumps with a shadowed underside.
  for (let y = 0; y < 16; y += 3) {
    for (let x = (y / 3) % 2 ? 1 : 0; x < 16; x += 3) {
      t.blot(x, y + 2, 2, 1, scaled(WOOL, 0.84), 3);
      t.blot(x, y, 2, 1, scaled(WOOL, 1.04), 3);
    }
  }
  t.mottle([206, 200, 186], 0.4, 5);
  t.grain(10, 16);
  t.posterize(6);
};
const SHEEP_SKIN: RGB = [52, 44, 42];
CREATURE_ART.mob_sheep_skin = hide(SHEEP_SKIN, 5);
CREATURE_ART.mob_sheep_leg = (t) => {
  hide(SHEEP_SKIN, 4)(t);
  for (let x = 0; x < 16; x++) t.set(x, 10, 30, 26, 26); // hooves
};
CREATURE_ART.mob_sheep_shorn = hide([226, 200, 184], 5);
CREATURE_ART.mob_sheep_face = face(hide(SHEEP_SKIN, 4), [
  '......',
  '......',
  'wk..kw',
  '......',
  '......',
  '..nn..',
  '..mm..',
], { w: [232, 222, 170], k: [16, 12, 12], n: [30, 24, 24], m: [96, 70, 70] });

// --- chicken -------------------------------------------------------------------------

const FEATHER: RGB = [246, 244, 236];
CREATURE_ART.mob_chicken = (t) => {
  t.fill(FEATHER, 6);
  // Overlapping feather scallops.
  for (let y = 1; y < 16; y += 3) {
    for (let x = (y % 2) * 2; x < 16; x += 4) t.blot(x, y, 3, 1, scaled(FEATHER, 0.88), 2);
  }
  t.grain(8, 10);
  t.posterize(6);
};
CREATURE_ART.mob_chicken_wing = (t) => {
  CREATURE_ART.mob_chicken(t);
  // Darker flight feathers along the trailing edge.
  for (let y = 0; y < 16; y++) for (let x = 0; x < 2; x++) t.set(x, y, 206, 200, 190);
  for (let x = 0; x < 16; x++) t.shade(x, 3, -16);
};
CREATURE_ART.mob_chicken_face = face(CREATURE_ART.mob_chicken, [
  '....',
  '....',
  'k..k',
  '....',
  '....',
  '....',
], { k: [24, 20, 18] });
CREATURE_ART.mob_beak = hide([244, 176, 48], 4);
CREATURE_ART.mob_wattle = hide([214, 48, 44], 4);
CREATURE_ART.mob_chicken_leg = hide([232, 170, 64], 3);

// --- zombie: grey-green, in a torn rust-red tunic ---------------------------------

const ROT: RGB = [110, 138, 92];
const TUNIC: RGB = [150, 70, 48];
CREATURE_ART.mob_zombie_head = (t) => {
  hide(ROT, 6)(t);
  t.patches(6, [84, 104, 70], 4, 2);
  // Lank dark hair over the crown: the top rows of every side.
  for (let x = 0; x < 16; x++) {
    t.set(x, 0, 48, 50, 36);
    if ((x * 7) % 5 < 3) t.set(x, 1, 52, 56, 40);
  }
};
CREATURE_ART.mob_zombie_face = face(CREATURE_ART.mob_zombie_head, [
  'hhhhhhhh',
  'h.h..hh.',
  '........',
  '.ddr.dr.',
  '.dd..dd.',
  '...pp...',
  '..mmmm..',
  '..m..m..',
], {
  h: [48, 50, 36], d: [30, 38, 26], r: [150, 40, 30], p: [86, 108, 70], m: [40, 30, 28],
});
CREATURE_ART.mob_zombie_shirt = (t) => {
  t.fill(TUNIC, 8);
  t.streaks(10, true);
  t.mottle([118, 56, 40], 0.45, 4);
  // Rents in the cloth showing grey-green skin, and a rope belt at the bottom.
  for (const [x, y] of [[1, 3], [2, 4], [5, 8], [6, 8], [2, 10], [7, 6]]) t.set(x, y, ...ROT);
  for (let x = 0; x < 16; x++) t.set(x, 11, 120, 96, 60);
  t.posterize(6);
};
CREATURE_ART.mob_zombie_arm = (t) => {
  hide(ROT, 5)(t);
  // A ragged sleeve over the shoulder.
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 3; y++) t.set(x, y, ...TUNIC);
    if (x % 3 !== 1) t.set(x, 3, ...scaled(TUNIC, 0.85));
  }
  t.patches(4, [84, 104, 70], 4, 2);
};
CREATURE_ART.mob_zombie_legs = (t) => {
  t.fill([70, 64, 66], 8);
  t.streaks(8, true);
  t.mottle([54, 50, 52], 0.4, 5);
  for (let x = 0; x < 16; x++) t.set(x, 11, 44, 36, 32); // shoes
  for (const [x, y] of [[1, 6], [2, 6], [0, 8]]) t.set(x, y, ...ROT); // torn knee
  t.posterize(6);
};

// --- skeleton ----------------------------------------------------------------------

const BONE: RGB = [226, 222, 204];
CREATURE_ART.mob_bone = (t) => {
  t.fill(BONE, 6);
  t.grain(10, 8);
  t.mottle([196, 190, 170], 0.4, 5);
  t.posterize(6);
};
CREATURE_ART.mob_skull = CREATURE_ART.mob_bone;
CREATURE_ART.mob_skull_face = face(CREATURE_ART.mob_bone, [
  '........',
  '........',
  '.kkk.kk.',
  '.kkk.kk.',
  '....k...',
  '........',
  '.kbkbkb.',
  '..k.k...',
], { k: [30, 26, 24], b: [200, 196, 176] });
/** A ribcage: bars of bone with gaps you can see through. */
CREATURE_ART.mob_ribs = (t) => {
  t.fill(BONE, 0, 0);
  const rib: RGB = [220, 216, 198];
  for (let y = 0; y < 8; y += 2) {
    for (let x = 0; x < 16; x++) t.set(x, y, ...(x % 5 === 0 ? scaled(rib, 0.9) : rib));
  }
  for (let y = 0; y < 8; y++) t.set(3, y, 196, 192, 172);
};
CREATURE_ART.mob_bow = hide([120, 80, 44], 4);
CREATURE_ART.mob_bowstring = (t) => t.fill([232, 232, 226], 2);

// --- spider --------------------------------------------------------------------------

const CHITIN: RGB = [52, 40, 36];
CREATURE_ART.mob_spider_head = (t) => {
  t.fill(CHITIN, 6);
  // Bristles.
  for (let i = 0; i < 30; i++) t.set((t.rng() * 16) | 0, (t.rng() * 16) | 0, 78, 64, 56);
  t.posterize(6);
};
CREATURE_ART.mob_spider_face = face(CREATURE_ART.mob_spider_head, [
  '........',
  '........',
  '.r....r.',
  '........',
  '..h..h..',
  '........',
  '.m....m.',
], { r: [196, 36, 30], h: [90, 70, 60], m: [30, 22, 20] });
CREATURE_ART.mob_spider_eye = (t) => {
  t.fill([236, 44, 36], 6);
  t.set(1, 1, 255, 200, 190);
  t.set(2, 1, 255, 160, 150);
};
CREATURE_ART.mob_fang = hide([214, 206, 180], 3);
CREATURE_ART.mob_spider_leg = (t) => {
  t.fill([60, 46, 40], 5);
  // Banded joints.
  for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) t.set(x, y, 96, 76, 62);
  t.posterize(6);
};
CREATURE_ART.mob_spider_abdomen = (t) => {
  t.fill([62, 46, 40], 7);
  t.mottle([44, 32, 28], 0.5, 4);
  for (let i = 0; i < 40; i++) t.set((t.rng() * 16) | 0, (t.rng() * 16) | 0, 88, 70, 60);
  t.posterize(6);
};
/** The abdomen's back: two rows of pale spots down a dark saddle -- a garden spider's cross, not a copy of anyone's. */
CREATURE_ART.mob_spider_back = face(CREATURE_ART.mob_spider_abdomen, [
  '............',
  '....ssss....',
  '...s.oo.s...',
  '..o..oo..o..',
  '.....oo.....',
  '.o.oooooo.o.',
  '.....oo.....',
  '..o..oo..o..',
  '...s.oo.s...',
  '....ssss....',
  '.....oo.....',
  '............',
], { o: [222, 180, 110], s: [120, 90, 64] });

// --- boomshroom: a crimson toadstool on stubby feet ------------------------------

const CAP: RGB = [196, 40, 44];
const SPOT: RGB = [246, 236, 214];
const STEM: RGB = [232, 220, 192];
CREATURE_ART.mob_shroom_cap = (t) => {
  hide(CAP, 6, 7)(t);
  // Cream warts, wrapping so they sit all round the rim.
  for (const [x, y, w, h] of [[1, 1, 3, 2], [7, 3, 2, 2], [12, 1, 3, 3], [3, 6, 2, 2], [10, 8, 3, 2], [14, 5, 2, 2], [5, 10, 3, 3], [0, 13, 2, 2], [12, 13, 3, 2]]) {
    t.blot(x, y, w, h, SPOT, 5);
  }
  // The rim underside is darker.
  for (let x = 0; x < 16; x++) t.shade(x, 4, -20);
};
CREATURE_ART.mob_shroom_cap_top = face(hide(CAP, 6, 7), [
  '................',
  '..ss.......ss...',
  '..sss......ss...',
  '.......ss.......',
  '......ssss......',
  '.ss....ss....ss.',
  '.ss..........ss.',
  '.....ss..ss.....',
  '.....ss..ss.....',
  '..............s.',
  '.ss....sss......',
  '.ss....sss...ss.',
  '.............ss.',
  '....ss..........',
  '....ss....ss....',
  '................',
], { s: SPOT });
CREATURE_ART.mob_shroom_gills = (t) => {
  t.fill([188, 150, 116], 5);
  for (let x = 0; x < 16; x += 2) for (let y = 0; y < 16; y++) t.shade(x, y, -26);
  t.posterize(5);
};
CREATURE_ART.mob_shroom_stem = (t) => {
  t.fill(STEM, 6);
  t.streaks(8, true);
  t.mottle([210, 196, 164], 0.35, 5);
  t.posterize(6);
};
CREATURE_ART.mob_shroom_foot = (t) => {
  CREATURE_ART.mob_shroom_stem(t);
  for (let x = 0; x < 16; x++) t.set(x, 3, 150, 132, 104);
};
CREATURE_ART.mob_shroom_face = face(CREATURE_ART.mob_shroom_stem, [
  '........',
  '.kk..kk.',
  '..kk.kk.',
  '.kkk.kkk',
  '........',
  '..kkkk..',
  '.k....k.',
  '........',
  '........',
  '........',
], { k: [44, 30, 30] });

// --- slime -----------------------------------------------------------------------------

const SLIME: RGB = [104, 196, 88];
/** The see-through jelly: pale and glassy, with a brighter rim along each edge. */
CREATURE_ART.mob_slime_shell = (t) => {
  t.fill(SLIME, 8, 150);
  for (let i = 0; i < TILE_PX; i++) {
    for (const [x, y] of [[i, 0], [i, 1], [0, i], [1, i], [i, TILE_PX - 1], [i, TILE_PX - 2], [TILE_PX - 1, i], [TILE_PX - 2, i]]) {
      const k = (y * TILE_PX + x) * 4;
      t.px[k] = 150;
      t.px[k + 1] = 230;
      t.px[k + 2] = 130;
      t.px[k + 3] = 200;
    }
  }
  // Glints.
  cell(t, 16, 16, 2, 2, [214, 250, 200], 210);
  cell(t, 16, 16, 3, 2, [214, 250, 200], 180);
  cell(t, 16, 16, 2, 3, [214, 250, 200], 180);
};
CREATURE_ART.mob_slime_core = hide([66, 150, 56], 6);
CREATURE_ART.mob_slime_eye = (t) => t.fill([20, 44, 20], 3);

// --- wolf --------------------------------------------------------------------------------

const WOLF: RGB = [150, 146, 140];
const WOLF_LIGHT: RGB = [210, 206, 198];
CREATURE_ART.mob_wolf_fur = (t) => {
  fur(WOLF, [176, 172, 164])(t);
  // A darker saddle along the top rows, a pale belly along the bottom.
  for (let x = 0; x < 16; x++) {
    t.shade(x, 0, -24);
    t.shade(x, 1, -14);
    t.set(x, 5, ...WOLF_LIGHT);
    t.set(x, 15, ...scaled(WOLF_LIGHT, 0.9));
  }
};
CREATURE_ART.mob_wolf_mane = fur([176, 172, 164], [206, 202, 194]);
CREATURE_ART.mob_wolf_muzzle = hide(WOLF_LIGHT, 4);
CREATURE_ART.mob_wolf_nose = face(hide(WOLF_LIGHT, 4), [
  '.nnn.',
  '.nnn.',
  '.....',
], { n: [34, 30, 30] });
const WOLF_FACE_ROWS = [
  '......',
  'bb..bb',
  'ek..ke',
  '......',
  'll..ll',
  'llllll',
];
CREATURE_ART.mob_wolf_face = face(fur(WOLF, [176, 172, 164]), WOLF_FACE_ROWS, {
  b: [110, 106, 100], e: [236, 176, 60], k: [28, 24, 20], l: WOLF_LIGHT,
});
CREATURE_ART.mob_wolf_face_angry = face(fur(WOLF, [176, 172, 164]), [
  'bb..bb',
  '.bbbb.',
  'ek..ke',
  '......',
  'll..ll',
  'llllll',
], { b: [70, 66, 62], e: [226, 50, 40], k: [30, 10, 10], l: WOLF_LIGHT });
CREATURE_ART.mob_collar = (t) => {
  t.fill([200, 36, 40], 5);
  for (let x = 0; x < 16; x++) t.shade(x, 0, 24);
  t.set(8, 2, 244, 206, 70); // tag
  t.set(8, 3, 220, 180, 50);
};

// --- bat -------------------------------------------------------------------------------

CREATURE_ART.mob_bat_fur = fur([78, 60, 48], [98, 78, 62]);
CREATURE_ART.mob_bat_wing = (t) => {
  t.fill([56, 42, 40], 5);
  // Finger bones fanning through the membrane.
  for (let i = 0; i < 16; i++) {
    t.set(i, 0, 96, 78, 66);
    t.set(i, (i * 0.5) | 0, 88, 70, 60);
    t.set(i, Math.min(15, (i * 1.2) | 0), 88, 70, 60);
  }
  t.mottle([44, 32, 30], 0.4, 4);
  t.posterize(6);
};
CREATURE_ART.mob_bat_ear = hide([66, 50, 42], 3);
CREATURE_ART.mob_bat_face = face(fur([78, 60, 48], [98, 78, 62]), [
  '....',
  'k..k',
  '.nn.',
  '.ff.',
], { k: [20, 14, 14], n: [120, 84, 76], f: [236, 232, 220] });

// --- rabbit ------------------------------------------------------------------------------

const HARE: RGB = [156, 116, 80];
CREATURE_ART.mob_rabbit_fur = (t) => {
  fur(HARE, [180, 140, 100])(t);
  // A pale belly and paws at the bottom of each window.
  for (let x = 0; x < 16; x++) {
    t.set(x, 4, 214, 190, 160);
    t.set(x, 1, ...scaled(WOLF_LIGHT, 0.95));
  }
};
CREATURE_ART.mob_rabbit_ear = (t) => {
  hide(HARE, 4)(t);
  // Pink inside, dark tips.
  for (let y = 0; y < 16; y++) t.set(0, y, 222, 150, 150);
  for (let x = 0; x < 16; x++) t.set(x, 0, 70, 50, 40);
};
CREATURE_ART.mob_rabbit_tail = (t) => t.fill([244, 242, 236], 5);
CREATURE_ART.mob_rabbit_face = face(fur(HARE, [180, 140, 100]), [
  '.....',
  'kw.wk',
  '.....',
  '..n..',
  '.lll.',
], { k: [20, 16, 14], w: [240, 240, 240], n: [226, 132, 140], l: [224, 204, 176] });

// --- fish: an olive-backed, silver-sided pond fish with orange fins -------------------

CREATURE_ART.mob_fish_scales = (t) => {
  t.fill([176, 190, 186], 5);
  for (let x = 0; x < 16; x++) {
    t.set(x, 0, 84, 110, 72);
    t.set(x, 1, 100, 126, 88);
    t.set(x, 4, 232, 226, 206); // belly
  }
  // Dark vertical bars down the flank.
  for (const x of [1, 4, 7]) for (let y = 1; y < 4; y++) t.shade(x, y, -34);
  // Scale glints.
  for (let y = 1; y < 4; y++) for (let x = (y % 2); x < 16; x += 2) t.shade(x, y, 12);
};
CREATURE_ART.mob_fish_fin = (t) => {
  t.fill([236, 132, 52], 0, 0);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const ray = x % 3 === 0;
      t.set(x, y, ray ? 214 : 240, ray ? 104 : 148, ray ? 40 : 70, 225);
    }
  }
};
CREATURE_ART.mob_fish_eye = face((t) => t.fill([176, 190, 186], 4), [
  '....',
  '.wk.',
  '.kk.',
  '....',
], { w: [250, 250, 244], k: [16, 16, 20] });
CREATURE_ART.mob_fish_mouth = face((t) => t.fill([176, 190, 186], 4), [
  '...',
  '.m.',
  '...',
], { m: [96, 60, 60] });

// --- blaze -------------------------------------------------------------------------------

CREATURE_ART.mob_blaze_skin = (t) => {
  t.fill([244, 178, 52], 12);
  t.mottle([255, 222, 120], 0.5, 4);
  t.posterize(6);
};
CREATURE_ART.mob_blaze_face = face(CREATURE_ART.mob_blaze_skin, [
  '........',
  '........',
  '.kk..kk.',
  '.ko..ok.',
  '........',
  '..kkkk..',
  '........',
  '........',
], { k: [70, 30, 8], o: [255, 240, 180] });
CREATURE_ART.mob_blaze_rod = (t) => {
  t.fill([246, 158, 36], 10);
  for (let y = 0; y < 16; y += 3) for (let x = 0; x < 16; x++) t.shade(x, y, 30);
  t.posterize(6);
};

// --- enderman ---------------------------------------------------------------------------

const VOID: RGB = [22, 18, 30];
CREATURE_ART.mob_ender_skin = (t) => {
  t.fill(VOID, 4);
  t.patches(10, [34, 28, 46], 3, 2);
  t.posterize(5);
};
CREATURE_ART.mob_ender_face = face(CREATURE_ART.mob_ender_skin, [
  '........',
  '........',
  '........',
  'eeE..Eee',
  '........',
  '........',
], { e: [196, 132, 244], E: [246, 226, 255] });
CREATURE_ART.mob_ender_face_angry = face(CREATURE_ART.mob_ender_skin, [
  '........',
  '.E....E.',
  'eEE..EEe',
  'eeE..Eee',
  '........',
  '........',
], { e: [236, 80, 220], E: [255, 214, 250] });
CREATURE_ART.mob_ender_jaw = face(CREATURE_ART.mob_ender_skin, [
  '........',
  '.m.m.m..',
], { m: [120, 60, 150] });
CREATURE_ART.mob_ender_mouth = (t) => t.fill([90, 20, 110], 6);

// --- dragon ------------------------------------------------------------------------------

const SCALE: RGB = [40, 32, 52];
CREATURE_ART.mob_dragon_scale = (t) => {
  t.fill(SCALE, 5);
  // Overlapping scale rows with a violet sheen on each leading edge.
  for (let y = 0; y < 16; y += 2) {
    for (let x = (y / 2) % 2 ? 1 : 0; x < 16; x += 2) t.set(x, y, 66, 48, 92);
  }
  t.mottle([30, 24, 38], 0.4, 4);
  t.posterize(6);
};
CREATURE_ART.mob_dragon_belly = (t) => {
  t.fill([84, 76, 96], 5);
  for (let y = 0; y < 16; y += 3) for (let x = 0; x < 16; x++) t.shade(x, y, -18);
  t.posterize(5);
};
CREATURE_ART.mob_dragon_spine = hide([150, 140, 150], 4);
CREATURE_ART.mob_dragon_horn = hide([188, 176, 170], 4);
CREATURE_ART.mob_dragon_face = face(CREATURE_ART.mob_dragon_scale, [
  '........',
  '.bb..bb.',
  '.ee..ee.',
  '........',
  '........',
  '........',
], { b: [24, 18, 30], e: [226, 100, 250] });
CREATURE_ART.mob_dragon_snout = face(CREATURE_ART.mob_dragon_scale, [
  '........',
  '.n....n.',
  '........',
  'tttttttt',
], { n: [14, 10, 18], t: [230, 224, 214] });
CREATURE_ART.mob_dragon_teeth = face(CREATURE_ART.mob_dragon_belly, [
  't.t.t.t.',
  '........',
  '........',
  '........',
  '........',
  '........',
  '........',
  't.t.t.t.',
], { t: [240, 236, 226] });
CREATURE_ART.mob_dragon_wing = (t) => {
  t.fill([52, 38, 72], 5);
  for (let i = 0; i < 16; i++) {
    t.set(i, 0, 110, 96, 120);
    t.set((i * 0.6) | 0, i, 96, 82, 110);
    t.set(Math.min(15, 6 + ((i * 0.6) | 0)), i, 96, 82, 110);
  }
  t.mottle([40, 30, 58], 0.4, 5);
  t.posterize(6);
};

/**
 * Tiles no block or item names but the renderer still needs -- a mob skin,
 * an overlay -- so they are packed into the atlas anyway.
 */
export const CREATURE_EXTRA: string[] = Object.keys(CREATURE_ART).filter((name) => name.startsWith('mob_'));
