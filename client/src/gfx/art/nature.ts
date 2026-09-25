/**
 * Textures for the nature pack's blocks (shared/src/content/nature.ts).
 *
 * Two kinds of tile live here. Block faces fill the whole tile and repeat
 * seamlessly, like everything in art/blocks.ts. Plant sprites -- grass,
 * flowers, saplings -- are drawn on a transparent tile and shown on two
 * crossed planes, so they need a clear silhouette from either side and a
 * base that meets the ground on the bottom row. Plant bases are drawn dark:
 * it is the shade a real tuft has where it meets the soil, and it keeps the
 * sprite's bottom edge from reading as a hard line against the block below.
 */

import { TILE, type RGB, type Recipe, Tile } from '../tile.js';
import { BLOCK_ART } from './blocks.js';

// --- shared palettes ---------------------------------------------------------

const GRASS_ROOT: RGB = [32, 60, 24];
const GRASS_DARK: RGB = [46, 84, 32];
const GRASS: RGB = [92, 146, 54];
const GRASS_LIGHT: RGB = [134, 186, 84];
const STEM: RGB = [70, 118, 44];
const SNOW: RGB = [238, 242, 248];

const wrap = (n: number): number => ((n % TILE) + TILE) % TILE;

/** One sprite pixel, skipped when it falls off the tile. */
function dot(t: Tile, x: number, y: number, c: RGB, jitter = 0): void {
  if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
  const d = jitter ? (t.rng() * 2 - 1) * jitter : 0;
  t.set(x, y, c[0] + d, c[1] + d, c[2] + d);
}

/**
 * A grass blade rising from the bottom row, leaning as it goes: dark at the
 * root, mid-green along the body, light at the tip.
 */
function blade(t: Tile, x: number, height: number, lean: number): void {
  for (let i = 0; i < height; i++) {
    const y = TILE - 1 - i;
    const bx = x + Math.round(lean * (i / height) ** 1.6);
    const along = i / height;
    const c = i === 0 ? GRASS_ROOT : along < 0.25 ? GRASS_DARK : along > 0.72 ? GRASS_LIGHT : GRASS;
    dot(t, bx, y, c, 6);
  }
}

/** A thin upright stem from the bottom row to `top`. */
function stem(t: Tile, x: number, top: number, c: RGB = STEM): void {
  for (let y = top; y < TILE; y++) dot(t, x, y, y > 13 ? GRASS_DARK : c, 4);
}

/** A two-pixel leaf pointing up and out from a stem. */
function leaf(t: Tile, x: number, y: number, dir: 1 | -1, c: RGB = GRASS): void {
  dot(t, x + dir, y, c, 5);
  dot(t, x + dir * 2, y - 1, c, 5);
  dot(t, x + dir * 2, y, [c[0] - 16, c[1] - 20, c[2] - 12], 4);
}

/** A leafy cluster for sapling crowns: a few overlapping discs, lit top-left. */
function crown(t: Tile, cx: number, cy: number, base: RGB, light: RGB, dark: RGB): void {
  t.disc(cx, cy, 3.2, base, 8);
  t.disc(cx - 2.5, cy + 1.5, 2.2, base, 8);
  t.disc(cx + 2.5, cy + 1.2, 2.2, dark, 6);
  t.disc(cx - 1, cy - 1.2, 1.6, light, 6);
  dot(t, cx + 1, cy + 3, dark, 4);
  dot(t, cx - 3, cy - 1, light, 4);
}

// --- wood --------------------------------------------------------------------

/** Log end grain: alternating rings round a heart, inside a bark rim. */
function logTop(t: Tile, light: RGB, dark: RGB, heart: RGB, bark: RGB): void {
  t.fill(light, 4);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const band = Math.floor(Math.hypot(x - 7.5, y - 7.5) / 1.6);
      const c = band % 2 === 0 ? light : dark;
      const j = (t.rng() * 2 - 1) * 5;
      t.set(x, y, c[0] + j, c[1] + j, c[2] + j);
    }
  }
  t.blot(7, 7, 2, 2, heart, 4);
  t.border(bark);
}

/** Four boards, each its own tone, with seams and end joints. */
function boards(t: Tile, base: RGB, tones: number[], seam: number): void {
  t.fill(base, 5);
  for (let board = 0; board < 4; board++) {
    const d = tones[board];
    t.blot(0, board * 4, TILE, 4, [base[0] + d, base[1] + d, base[2] + d], 5);
  }
  // Grain: short darker runs along each board.
  for (let i = 0; i < 14; i++) {
    const y = ((t.rng() * 4) | 0) * 4 + 1 + ((t.rng() * 2) | 0);
    const x = (t.rng() * TILE) | 0;
    t.blot(x, y, 2 + ((t.rng() * 4) | 0), 1, [base[0] - 18, base[1] - 16, base[2] - 12], 4);
  }
  t.planks(seam);
  t.posterize(10);
}

// --- stone -------------------------------------------------------------------

/**
 * The legacy stone, so the new ores sit in exactly the rock the old ones do
 * -- and keep matching when that tile is redrawn.
 */
function stoneBase(t: Tile): Tile {
  BLOCK_ART.stone(t);
  return t;
}

/**
 * Faceted gems: a small diamond shape with a bright upper-left facet and a
 * dark lower-right one, which is what makes a red fleck read as a jewel
 * rather than rust.
 */
function gem(t: Tile, cx: number, cy: number, body: RGB, lit: RGB, deep: RGB): void {
  const cells: Array<[number, number, RGB]> = [
    [0, -1, lit], [-1, 0, lit], [0, 0, body], [1, 0, body], [0, 1, deep], [1, -1, body], [1, 1, deep],
  ];
  for (const [dx, dy] of [[0, -2], [-2, 0], [2, 0], [0, 2], [-1, -1], [2, -1], [-1, 1], [2, 1]] as const) {
    t.blot(cx + dx, cy + dy, 1, 1, [60, 36, 40], 4);
  }
  for (const [dx, dy, c] of cells) t.blot(cx + dx, cy + dy, 1, 1, c, 4);
  t.blot(cx - 1, cy - 1, 1, 1, [255, 220, 226], 0);
}

// --- the tiles ---------------------------------------------------------------

export const NATURE_ART: Record<string, Recipe> = {
  // ---- ground cover ----
  tall_grass: (t) => {
    const blades: Array<[number, number, number]> = [
      [1, 8, 1], [2, 12, -1], [4, 9, 2], [5, 14, 1], [7, 11, -2], [8, 15, 0],
      [9, 10, 2], [10, 13, -1], [12, 12, 1], [13, 8, -1], [14, 11, 0], [6, 7, -1], [11, 6, 1],
    ];
    for (const [x, h, lean] of blades) blade(t, x, h, lean);
  },
  fern: (t) => {
    // Fronds arc out of a crown: a spine with leaflets on both sides, the
    // leaflets shortening toward the tip.
    const fronds: Array<[number, number]> = [[-1, 0.9], [1, 0.9], [-1, 0.45], [1, 0.45], [0, 0.1]];
    const dark: RGB = [40, 86, 38];
    const mid: RGB = [66, 124, 52];
    const light: RGB = [104, 164, 72];
    for (const [side, spread] of fronds) {
      const len = side === 0 ? 13 : 11;
      for (let i = 0; i < len; i++) {
        const along = i / len;
        const x = Math.round(7.5 + side * spread * 7 * Math.sin(along * 1.4));
        const y = TILE - 1 - Math.round(i * (side === 0 ? 1 : 1 - along * 0.35));
        dot(t, x, y, along < 0.2 ? dark : mid, 5);
        if (i > 1 && i % 2 === 0) {
          const reach = Math.max(1, Math.round((1 - along) * 2.5));
          for (let r = 1; r <= reach; r++) {
            dot(t, x - r, y - (r > 1 ? 1 : 0), r === reach ? light : mid, 5);
            dot(t, x + r, y - (r > 1 ? 1 : 0), r === reach ? light : mid, 5);
          }
        }
      }
    }
  },
  dead_bush: (t) => {
    const wood: RGB = [126, 88, 48];
    const dark: RGB = [74, 50, 28];
    // A dry tangle: branches forking out of a short trunk.
    const twigs: Array<[number, number, number, number]> = [
      [8, 15, 8, 11], [8, 11, 4, 6], [8, 11, 12, 5], [8, 12, 3, 10], [8, 12, 13, 10],
      [5, 7, 3, 3], [5, 7, 7, 3], [11, 6, 10, 2], [11, 6, 14, 3], [4, 9, 1, 8], [12, 10, 15, 8],
    ];
    for (const [x0, y0, x1, y1] of twigs) {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= steps; i++) {
        const x = Math.round(x0 + ((x1 - x0) * i) / steps);
        const y = Math.round(y0 + ((y1 - y0) * i) / steps);
        dot(t, x, y, y > 13 ? dark : wood, 10);
      }
    }
  },
  dandelion: (t) => {
    stem(t, 8, 7);
    leaf(t, 8, 13, -1);
    leaf(t, 8, 12, 1);
    const petal: RGB = [246, 206, 40];
    const deep: RGB = [214, 150, 20];
    t.rect(6, 4, 5, 3, petal, 8);
    t.rect(7, 3, 3, 5, petal, 8);
    dot(t, 8, 5, [255, 240, 140], 0);
    dot(t, 10, 6, deep, 0);
    dot(t, 9, 7, deep, 0);
  },
  poppy: (t) => {
    stem(t, 8, 7);
    leaf(t, 8, 12, -1);
    leaf(t, 8, 10, 1);
    const red: RGB = [214, 36, 34];
    const dark: RGB = [150, 18, 24];
    t.rect(6, 3, 5, 4, red, 8);
    t.rect(5, 4, 7, 2, red, 8);
    dot(t, 6, 3, [240, 80, 70], 0);
    dot(t, 11, 5, dark, 0);
    dot(t, 10, 6, dark, 0);
    t.rect(8, 4, 1, 2, [34, 24, 28]);
  },
  cornflower: (t) => {
    stem(t, 8, 7);
    leaf(t, 8, 12, 1);
    leaf(t, 8, 10, -1);
    const blue: RGB = [70, 110, 226];
    const pale: RGB = [130, 164, 246];
    // A ragged ring of narrow petals round a dark eye.
    for (const [dx, dy] of [[0, -3], [-2, -2], [2, -2], [-3, 0], [3, 0], [-2, 2], [2, 2], [0, 2]] as const) {
      dot(t, 8 + dx, 5 + dy, blue, 8);
    }
    t.rect(7, 3, 3, 5, blue, 8);
    t.rect(6, 4, 5, 3, blue, 8);
    dot(t, 7, 3, pale, 0);
    dot(t, 5, 3, pale, 0);
    t.rect(8, 5, 1, 1, [44, 40, 96]);
  },
  tulip_orange: (t) => {
    stem(t, 8, 8);
    // Long strap leaves, then a closed cup of petals with a notched rim.
    for (let i = 0; i < 5; i++) {
      dot(t, 7 - (i > 2 ? 1 : 0), 14 - i, GRASS, 5);
      dot(t, 9 + (i > 3 ? 1 : 0), 15 - i, GRASS, 5);
    }
    const orange: RGB = [238, 122, 36];
    const deep: RGB = [196, 78, 22];
    t.rect(6, 4, 5, 4, orange, 8);
    dot(t, 6, 3, orange, 6);
    dot(t, 8, 3, orange, 6);
    dot(t, 10, 3, orange, 6);
    dot(t, 7, 4, [252, 180, 90], 0);
    t.rect(10, 5, 1, 3, deep, 4);
    t.rect(7, 7, 3, 1, deep, 4);
  },
  mushroom_brown: (t) => {
    const stalk: RGB = [214, 200, 176];
    t.rect(7, 12, 2, 4, stalk, 6);
    dot(t, 8, 15, [150, 136, 112], 0);
    const cap: RGB = [150, 108, 76];
    t.rect(4, 10, 8, 2, cap, 8);
    t.rect(5, 9, 6, 1, [176, 132, 96], 6);
    t.rect(4, 11, 8, 1, [110, 76, 52], 4);
  },
  mushroom_red: (t) => {
    const stalk: RGB = [226, 214, 196];
    t.rect(7, 12, 2, 4, stalk, 6);
    dot(t, 8, 15, [160, 146, 124], 0);
    const red: RGB = [204, 34, 34];
    t.rect(5, 8, 6, 4, red, 8);
    t.rect(4, 9, 8, 3, red, 8);
    t.rect(4, 11, 8, 1, [140, 20, 24], 4);
    for (const [x, y] of [[6, 9], [9, 8], [10, 10], [5, 10]] as const) dot(t, x, y, [244, 240, 232], 4);
  },
  sapling_oak: (t) => {
    const bark: RGB = [104, 76, 44];
    for (let y = 8; y < TILE; y++) dot(t, y > 12 ? 8 : 7 + (y % 3 === 0 ? 1 : 0), y, bark, 6);
    dot(t, 6, 11, bark, 6);
    crown(t, 8, 6, [66, 122, 48], [104, 160, 70], [40, 82, 32]);
  },
  sapling_birch: (t) => {
    for (let y = 7; y < TILE; y++) dot(t, 8, y, y % 3 === 1 ? [50, 48, 44] : [226, 224, 214], 4);
    dot(t, 9, 10, [120, 170, 70], 4);
    dot(t, 10, 9, [120, 170, 70], 4);
    crown(t, 8, 5, [118, 164, 64], [158, 200, 96], [80, 124, 44]);
  },
  sapling_pine: (t) => {
    const bark: RGB = [86, 60, 40];
    for (let y = 12; y < TILE; y++) dot(t, 8, y, bark, 4);
    const needle: RGB = [42, 92, 60];
    const light: RGB = [74, 128, 84];
    const dark: RGB = [26, 60, 42];
    // Three stacked tiers, each wider than the one above, dark underneath.
    const tiers: Array<[number, number]> = [[3, 1], [6, 2], [9, 3]];
    for (const [y, half] of tiers) {
      t.rect(8 - half, y, half * 2 + 1, 2, needle, 6);
      t.rect(8 - half - 1, y + 2, half * 2 + 3, 1, dark, 4);
      dot(t, 8 - half, y, light, 4);
    }
    dot(t, 8, 1, needle, 4);
    dot(t, 8, 2, light, 4);
  },
  reeds: (t) => {
    // Tall jointed stalks the full height of the cell, so a stack of reeds
    // reads as one continuous plant.
    const stalk: RGB = [132, 176, 82];
    const shade: RGB = [96, 140, 56];
    const node: RGB = [200, 214, 150];
    for (const [x, phase] of [[1, 0], [5, 2], [9, 1], [13, 3]] as const) {
      for (let y = 0; y < TILE; y++) {
        const c = (y + phase * 3) % 6 === 0 ? node : stalk;
        dot(t, x, y, c, 5);
        dot(t, x + 1, y, (y + phase * 3) % 6 === 0 ? node : shade, 5);
      }
    }
    for (const [x, y, dir] of [[1, 5, 1], [9, 9, 1], [6, 3, 1], [13, 12, -1]] as const) {
      dot(t, x + dir, y, GRASS_LIGHT, 5);
      dot(t, x + dir * 2, y + 1, GRASS, 5);
      dot(t, x + dir * 2, y + 2, GRASS, 5);
    }
  },
  lily_pad: (t) => {
    const pad: RGB = [44, 118, 44];
    const vein: RGB = [86, 160, 70];
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        if (dx * dx + dy * dy > 7.6 * 7.6) continue;
        // A wedge cut out toward the lower right, the pad's notch.
        const ang = Math.atan2(dy, dx);
        if (ang > 0.55 && ang < 0.95) continue;
        const ring = Math.hypot(dx, dy) > 6.3;
        const j = (t.rng() * 2 - 1) * 6;
        const c = ring ? [30, 92, 34] : pad;
        t.set(x, y, c[0] + j, c[1] + j, c[2] + j);
      }
    }
    for (const a of [-2.6, -1.6, -0.6, 0.2, 1.5, 2.4]) {
      for (let r = 1; r < 6; r++) {
        dot(t, Math.round(7.5 + Math.cos(a) * r), Math.round(7.5 + Math.sin(a) * r), vein, 4);
      }
    }
    dot(t, 7, 7, [120, 190, 96], 0);
  },

  // ---- trees ----
  birch_log_side: (t) => {
    // Pale papery bark crossed by dark horizontal scars -- the one thing
    // that makes a birch a birch at any distance.
    t.fill([222, 220, 208], 4)
      .patches(10, [200, 198, 186], 4, 3)
      .patches(6, [238, 236, 228], 3, 2);
    const scars: Array<[number, number, number]> = [
      [1, 2, 4], [9, 1, 3], [5, 6, 3], [12, 7, 3], [0, 10, 3], [7, 11, 4], [13, 13, 2], [3, 14, 3],
    ];
    for (const [x, y, w] of scars) {
      t.blot(x, y, w, 1, [48, 46, 42], 4);
      t.blot(x + 1, y + 1, Math.max(1, w - 2), 1, [110, 106, 98], 4);
    }
    t.posterize(10);
  },
  birch_log_top: (t) => logTop(t, [224, 202, 150], [196, 170, 118], [168, 140, 92], [226, 224, 212]),
  birch_leaves: (t) => t.fill([108, 150, 58], 10)
    .patches(24, [82, 120, 42], 12, 3)
    .patches(16, [138, 178, 80], 12, 2)
    .patches(8, [58, 92, 32], 8, 2)
    .posterize(6),
  birch_planks: (t) => boards(t, [214, 194, 144], [0, -12, 8, -6], -30),
  pine_log_side: (t) => {
    // Dark, deeply furrowed bark: vertical ridges with near-black cracks.
    t.fill([88, 62, 42], 4)
      .patches(10, [72, 50, 34], 4, 2)
      .patches(8, [110, 80, 54], 4, 2);
    for (const x of [1, 5, 9, 12]) {
      for (let y = 0; y < TILE; y++) {
        if (t.rng() < 0.85) t.blot(x + (y % 7 === 3 ? 1 : 0), y, 1, 1, [44, 30, 22], 4);
      }
    }
    t.woodGrain(0.3, -12).posterize(10);
  },
  pine_log_top: (t) => logTop(t, [178, 132, 86], [146, 104, 64], [120, 84, 50], [72, 50, 34]),
  pine_leaves: (t) => {
    // Needles: short diagonal strokes over a deep blue-green, not the round
    // clumps of broadleaf foliage.
    t.fill([40, 84, 56], 6).patches(16, [30, 66, 44], 6, 3);
    for (let i = 0; i < 40; i++) {
      const x = (t.rng() * TILE) | 0;
      const y = (t.rng() * TILE) | 0;
      const c: RGB = t.rng() < 0.5 ? [72, 124, 84] : [22, 52, 36];
      const dir = t.rng() < 0.5 ? 1 : -1;
      t.blot(x, y, 1, 1, c, 5);
      t.blot(wrap(x + dir), wrap(y + 1), 1, 1, c, 5);
    }
    t.posterize(16);
  },
  pine_planks: (t) => boards(t, [138, 94, 58], [0, -10, 6, -14], -30),

  // ---- desert ----
  cactus_side: (t) => {
    const green: RGB = [62, 136, 52];
    t.fill(green, 5);
    // Ribs every four columns: a lit ridge, a shadowed groove, spines in the
    // groove.
    for (let x = 0; x < TILE; x += 4) {
      t.blot(x, 0, 1, TILE, [40, 100, 38], 4);
      t.blot(x + 1, 0, 1, TILE, [86, 160, 70], 4);
      for (let y = (x / 4) % 2 === 0 ? 1 : 3; y < TILE; y += 4) {
        t.blot(x, y, 1, 1, [236, 226, 170], 6);
        t.blot(x - 1, y - 1, 1, 1, [210, 200, 150], 6);
      }
    }
    t.patches(6, [52, 120, 46], 4, 2).posterize(9);
  },
  cactus_top: (t) => {
    t.fill([70, 146, 58], 5);
    // A rim at the model's inset edge, a lighter crown, a flower-bud centre.
    for (let i = 1; i < 15; i++) {
      for (const [x, y] of [[i, 1], [i, 14], [1, i], [14, i]] as const) t.set(x, y, 44, 104, 40);
    }
    t.rect(4, 4, 8, 8, [96, 170, 78], 5);
    t.rect(6, 6, 4, 4, [120, 188, 96], 4);
    for (const [x, y] of [[4, 1], [11, 1], [1, 7], [14, 8], [7, 14], [3, 14]] as const) {
      t.set(x, y, 236, 226, 170);
    }
    t.posterize(9);
  },
  cactus_bottom: (t) => {
    t.fill([94, 136, 70], 5);
    for (let i = 1; i < 15; i++) {
      for (const [x, y] of [[i, 1], [i, 14], [1, i], [14, i]] as const) t.set(x, y, 60, 98, 48);
    }
    t.patches(6, [112, 150, 84], 4, 2).posterize(9);
  },
  sandstone_top: (t) => t.fill([220, 206, 152], 5)
    .patches(14, [206, 190, 136], 5, 3)
    .patches(8, [232, 220, 170], 5, 2)
    .posterize(20),
  sandstone_side: (t) => {
    // Bedded strata: a smooth cap band spanning the wrap (rows 12-15 and
    // 0-2), a speckled middle, and dark partings between them.
    t.fill([214, 198, 144], 4);
    t.blot(0, 12, TILE, 7, [226, 212, 160], 4);
    t.patches(10, [198, 182, 128], 5, 2);
    for (let x = 0; x < TILE; x++) {
      t.set(x, 3, 174, 156, 106);
      t.set(x, 11, 174, 156, 106);
      if (x % 5 !== 2) t.set(x, 7, 196, 178, 124);
    }
    t.posterize(8);
  },
  sandstone_bottom: (t) => t.fill([204, 188, 134], 5)
    .patches(14, [186, 168, 116], 6, 3)
    .patches(6, [218, 204, 152], 5, 2)
    .posterize(20),

  // ---- cold ----
  snow: (t) => t.fill(SNOW, 3)
    .patches(12, [216, 226, 240], 4, 3)
    .patches(8, [250, 252, 255], 2, 2)
    .patches(4, [200, 212, 232], 3, 2)
    .posterize(14),
  snowy_grass_side: (t) => {
    // Dirt with snow crusted over the top edge. Mostly a level line with a
    // few drips, the way packed snow sits on a block edge.
    t.fill([134, 96, 67], 9)
      .patches(16, [110, 78, 52], 10, 3)
      .patches(10, [152, 112, 80], 10, 2)
      .posterize(9);
    for (let x = 0; x < TILE; x++) {
      const drip = t.rng() < 0.2 ? 1 : 0;
      for (let y = 0; y < 4 + drip; y++) {
        const c: RGB = y === 0 ? [250, 252, 255] : y >= 3 ? [214, 224, 238] : SNOW;
        const j = (t.rng() * 2 - 1) * 3;
        t.set(x, y, c[0] + j, c[1] + j, c[2] + j);
      }
      // Damp soil in the snow's shadow, which is also what seats the crust.
      t.set(x, 4 + drip, 84, 58, 40);
    }
  },
  ice: (t) => {
    t.fill([150, 190, 236], 6, 196)
      .patches(8, [132, 174, 226], 5, 4);
    // Frozen-in cracks: pale diagonal lines, wrapped so they carry on into
    // the next block.
    for (const [x, y, len, dir] of [[2, 3, 7, 1], [9, 1, 5, -1], [11, 9, 7, 1], [4, 12, 4, -1]] as const) {
      for (let i = 0; i < len; i++) t.blot(x + i, y + i * dir, 1, 1, [220, 238, 252], 4);
    }
    t.patches(5, [236, 246, 255], 3, 1);
    // Re-apply the alpha the patches overwrote: the whole block stays glassy.
    for (let i = 3; i < t.px.length; i += 4) t.px[i] = 196;
    t.posterize(10);
  },

  // ---- soil ----
  clay: (t) => t.fill([158, 164, 178], 4)
    .patches(14, [144, 150, 166], 4, 3)
    .patches(8, [172, 178, 190], 4, 2)
    .patches(5, [130, 136, 150], 3, 1)
    .posterize(24),
  podzol_top: (t) => {
    t.fill([112, 76, 42], 7)
      .patches(14, [92, 62, 34], 8, 3)
      .patches(10, [140, 96, 52], 8, 2);
    // Fallen needles: short strokes in rust and dried green.
    for (let i = 0; i < 26; i++) {
      const x = (t.rng() * TILE) | 0;
      const y = (t.rng() * TILE) | 0;
      const c: RGB = t.rng() < 0.6 ? [166, 106, 50] : [96, 104, 48];
      t.blot(x, y, 1, 1, c, 6);
      t.blot(wrap(x + 1), wrap(y + (t.rng() < 0.5 ? 1 : 0)), 1, 1, c, 6);
    }
    t.posterize(16);
  },
  podzol_side: (t) => {
    t.fill([134, 96, 67], 9)
      .patches(16, [110, 78, 52], 10, 3)
      .patches(10, [152, 112, 80], 10, 2)
      .posterize(9);
    for (let x = 0; x < TILE; x++) {
      const drip = t.rng() < 0.3 ? 1 : 0;
      for (let y = 0; y < 3 + drip; y++) {
        const c: RGB = y === 0 ? [150, 100, 52] : [104, 68, 36];
        const j = (t.rng() * 2 - 1) * 6;
        t.set(x, y, c[0] + j, c[1] + j, c[2] + j);
      }
    }
  },

  // ---- stone ----
  mossy_cobble: (t) => {
    BLOCK_ART.cobble(t);
    // Moss settles in the gaps first and spreads over the stones in clumps.
    t.mottle([70, 116, 46], 0.55, 4, 0.52);
    t.patches(9, [74, 122, 50], 8, 3);
    t.patches(5, [104, 150, 66], 6, 2);
    t.posterize(10);
  },
  granite: (t) => {
    // Coarse-grained: a warm pink ground full of distinct mineral grains --
    // pale feldspar, dark mica -- rather than the soft patches of stone.
    t.fill([166, 110, 92], 5).patches(14, [148, 94, 78], 6, 3);
    t.patches(22, [196, 146, 124], 8, 1);
    t.patches(14, [214, 176, 158], 6, 1);
    t.patches(16, [84, 56, 50], 6, 1);
    t.posterize(10);
  },
  slate: (t) => {
    // Dark blue-grey in thin cleaved layers: horizontal lines, not blotches.
    t.fill([74, 80, 94], 3);
    for (let y = 0; y < TILE; y += 2) {
      const d = [0, -8, 6, -4, 10, -10, 4, -2][(y / 2) % 8];
      t.blot(0, y, TILE, 1, [74 + d, 80 + d, 94 + d], 3);
    }
    for (let i = 0; i < 10; i++) {
      const y = (t.rng() * TILE) | 0;
      const x = (t.rng() * TILE) | 0;
      t.blot(x, y, 3 + ((t.rng() * 5) | 0), 1, t.rng() < 0.5 ? [52, 56, 68] : [104, 110, 124], 3);
    }
    t.posterize(12);
  },
  limestone: (t) => {
    // Pale and chalky, with a few small shell-shaped pits.
    t.fill([206, 198, 172], 4)
      .patches(14, [192, 184, 156], 4, 3)
      .patches(8, [220, 214, 192], 4, 2);
    for (let i = 0; i < 5; i++) {
      const x = (t.rng() * TILE) | 0;
      const y = (t.rng() * TILE) | 0;
      t.blot(x, y, 2, 1, [158, 150, 124], 3);
      t.blot(x + 1, y + 1, 1, 1, [172, 164, 138], 3);
      t.blot(x - 1, y + 1, 1, 1, [230, 224, 206], 3);
    }
    t.posterize(10);
  },
  copper_ore: (t) => {
    stoneBase(t).oreVein([214, 116, 64], 4);
    // Verdigris: a few blue-green spots where the copper has weathered.
    t.patches(4, [84, 174, 146], 6, 1);
    t.posterize(10);
  },
  ruby_ore: (t) => {
    stoneBase(t);
    for (const [x, y] of [[4, 3], [12, 7], [5, 12]] as const) {
      gem(t, x, y, [206, 28, 54], [250, 96, 116], [120, 12, 32]);
    }
    t.posterize(12);
  },

  // ---- gourds ----
  pumpkin_side: (t) => {
    t.fill([222, 130, 34], 5);
    // Deep grooves between rounded ribs, each rib lit on its left.
    for (let x = 0; x < TILE; x += 4) {
      t.blot(x, 0, 1, TILE, [168, 88, 20], 4);
      t.blot(x + 1, 0, 1, TILE, [240, 158, 58], 4);
    }
    t.patches(6, [206, 116, 28], 4, 2).posterize(9);
  },
  pumpkin_top: (t) => {
    t.fill([214, 124, 32], 5);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const a = Math.atan2(y - 7.5, x - 7.5);
        // Eight grooves radiating from the stem.
        if (Math.abs(Math.sin(a * 4)) < 0.2) t.set(x, y, 170, 90, 22);
      }
    }
    t.patches(8, [236, 150, 54], 5, 2);
    t.rect(7, 7, 2, 2, [96, 110, 40]);
    t.set(7, 7, 130, 140, 60);
    t.posterize(16);
  },
  melon_side: (t) => {
    t.fill([98, 156, 44], 6);
    // Dark wavy stripes running top to bottom.
    for (let x = 1; x < TILE; x += 4) {
      for (let y = 0; y < TILE; y++) {
        const off = [0, 0, 1, 1, 1, 0, 0, -1, -1, -1, 0, 0, 1, 1, 0, 0][y];
        t.blot(x + off, y, 2, 1, [52, 104, 28], 6);
      }
    }
    t.patches(8, [130, 184, 70], 6, 1).posterize(9);
  },
  melon_top: (t) => {
    t.fill([106, 162, 50], 6);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const a = Math.atan2(y - 7.5, x - 7.5);
        if (Math.abs(Math.sin(a * 4)) < 0.25) t.set(x, y, 58, 110, 30);
      }
    }
    t.rect(7, 7, 2, 2, [90, 74, 40]);
    t.posterize(9);
  },
};

/**
 * Tiles no block or item names but the renderer still needs -- a mob skin,
 * an overlay -- so they are packed into the atlas anyway.
 */
export const NATURE_EXTRA: string[] = [];
