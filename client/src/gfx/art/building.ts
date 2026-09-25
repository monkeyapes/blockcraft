/**
 * Textures for the building pack's blocks (shared/src/content/building.ts).
 *
 * Two kinds of tile live here. Block faces -- bricks, wool, storage blocks --
 * tile seamlessly like every other surface. Model parts -- a door, a lantern,
 * a flame -- are drawn in the cell's own coordinates instead: the mesher maps
 * a box's face onto the part of the tile it covers, so a lantern body at
 * x 5..11, y 0..7 shows columns 5..11 and the bottom seven rows, and that is
 * where the lantern is painted.
 *
 * The shaped blocks' inventory icons are not drawn by hand at all: they are
 * small renders of the block's real model with its real textures, so a stair
 * in the hotbar is the same stair that goes down in the world.
 */

import { blockDef } from '@shared/blocks.js';
import { Block } from '@shared/blockids.js';
import { shapeOf, type Around, type Box } from '@shared/shapes.js';
import { px } from '@shared/shapekit.js';
import { TILE, TILE_PX, mulberry32, nameSeed, type RGB, type Recipe, Tile } from '../tile.js';
import { BLOCK_ART } from './blocks.js';
import { NATURE_ART } from './nature.js';

// --- block faces ------------------------------------------------------------

/**
 * Dressed stone in big staggered courses: two rows of long blocks, each
 * with its own lit top edge and shadowed underside, so a wall of it reads
 * as masonry with depth rather than a grid drawn on stone.
 */
function stoneBricks(t: Tile): Tile {
  t.fill([126, 126, 130], 4)
    .patches(14, [110, 110, 114], 4, 3)
    .patches(10, [144, 144, 148], 4, 2);
  const mortar: RGB = [82, 82, 88];
  for (let row = 0; row < 2; row++) {
    const y0 = row * 8;
    t.blot(0, y0 + 7, TILE, 1, mortar, 3);
    const offset = row === 0 ? 0 : 4;
    for (const jx of [offset, offset + 8]) t.blot(jx, y0, 1, 7, mortar, 3);
    for (const jx of [offset, offset + 8]) {
      // One brick: x from the joint + 1, seven wide, seven tall.
      for (let i = 0; i < 7; i++) {
        t.shade((jx + 1 + i) % TILE, y0, 16);        // lit top edge
        t.shade((jx + 1 + i) % TILE, y0 + 6, -16);   // shadowed underside
      }
      for (let j = 1; j < 6; j++) {
        t.shade((jx + 1) % TILE, y0 + j, 9);
        t.shade((jx + 7) % TILE, y0 + j, -12);
      }
    }
  }
  return t;
}

/**
 * Brightness offsets for one knit stitch, four units square: two strands
 * leaning in to meet at the bottom (a V), lit on the left strand, with the
 * dark seam between columns at the edges.
 */
const STITCH: number[][] = [
  [14, -4, -4, 8],
  [-10, 12, 6, -12],
  [-12, 8, 4, -14],
  [-6, -2, -2, -8],
];

/**
 * A knitted face: columns of V-shaped stitches stacked like a sweater's,
 * with a fine fuzz over everything.
 *
 * The first version was random blotches with faint rows, which at any
 * distance read as static; a second pass with a dark furrow under each row
 * read as corduroy stripes. Real knitting runs in columns of Vs, and a V
 * has a shape -- two strands meeting in a point -- which is what the eye
 * reads as cloth. Stitches are staggered by a unit per column so the rows
 * never line up into stripes. Four stitches of four units tile the sixteen
 * exactly, so a wall of wool has no seams.
 */
function wool(base: RGB): Recipe {
  const tone = (d: number): RGB => [base[0] + d, base[1] + d, base[2] + d];
  // Dark wool needs bigger steps to show its stitches at all; pale wool
  // would blow out to flat white with the same ones.
  const lum = (base[0] + base[1] + base[2]) / 3;
  const k = lum < 60 ? 1.7 : lum > 200 ? 0.8 : 1;
  return (t) => {
    t.fill(base, 3);
    for (let col = 0; col < 4; col++) {
      const stagger = col % 2;
      for (let row = 0; row < 4; row++) {
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            t.blot(col * 4 + x, row * 4 + y + stagger, 1, 1, tone(STITCH[y][x] * k), 2);
          }
        }
      }
    }
    // Fuzz at the rendered resolution, so the knit looks soft, not tiled.
    t.grain(5 * k, 16);
  };
}

/**
 * A storage block: the material itself, cut into a plate with a lit rim and
 * a shadowed one, so it reads as a solid ingot-block rather than as ore.
 */
function plate(base: RGB, light: RGB, dark: RGB, rim: RGB, steps: number): Recipe {
  return (t) => {
    t.fill(base, 4).patches(10, dark, 5, 3).patches(12, light, 5, 2);
    t.blot(0, 0, TILE, 1, rim, 2);
    t.blot(0, 0, 1, TILE, rim, 2);
    for (let i = 1; i < TILE; i++) {
      t.shade(i, 1, 26);
      t.shade(1, i, 18);
      t.shade(i, TILE - 1, -22);
      t.shade(TILE - 1, i, -18);
    }
    t.posterize(steps);
  };
}

/** Faceted gem blocks: a plate with bright diagonal facets struck across it. */
function gem(base: RGB, light: RGB, dark: RGB, rim: RGB): Recipe {
  return (t) => {
    plate(base, light, dark, rim, 12)(t);
    for (let i = 0; i < 5; i++) {
      t.set(3 + i, 7 - i, light[0] + 20, light[1] + 20, light[2] + 20);
      t.set(9 + i, 13 - i, light[0] + 20, light[1] + 20, light[2] + 20);
    }
    for (let i = 0; i < 4; i++) t.set(4 + i, 12 - i, dark[0], dark[1], dark[2]);
    t.set(3, 3, 255, 255, 255);
    t.set(11, 4, 255, 255, 255);
  };
}

const WOOL_COLOURS: Record<string, RGB> = {
  white: [226, 226, 228],
  red: [170, 46, 42],
  blue: [54, 72, 164],
  yellow: [226, 188, 52],
  green: [78, 124, 44],
  black: [40, 40, 44],
};

/** Spine colours for the bookshelf, leathers and cloths. */
const SPINES: RGB[] = [
  [138, 44, 38], [52, 76, 132], [60, 108, 58], [150, 112, 50], [96, 58, 104], [120, 84, 52],
];

const IRON_DARK: RGB = [52, 54, 62];
const IRON: RGB = [92, 94, 104];
const IRON_LIGHT: RGB = [150, 154, 166];

/**
 * Door art, in the cell's own coordinates. `outside` is the face seen from
 * the side the door was placed from; the inside is its mirror, because the
 * mesher maps opposite faces of a panel in opposite directions and the
 * handle must stay on the edge away from the hinge from both sides.
 */
function door(upper: boolean, outside: boolean): Recipe {
  return (t) => {
    const col = (x: number) => (outside ? TILE - 1 - x : x);
    t.fill([164, 124, 72], 5).patches(8, [150, 112, 62], 4, 2);
    // Vertical boards.
    for (const x of [4, 8, 12]) for (let y = 0; y < TILE; y++) t.shade(x, y, -22);
    t.woodGrain(0.3, -10);
    const frame: RGB = [112, 80, 44];
    t.rect(0, 0, 1, TILE, frame, 3).rect(TILE - 1, 0, 1, TILE, frame, 3);
    if (upper) {
      t.rect(0, 0, TILE, 2, frame, 3);
      // Two window panes, cut clean through the panel.
      for (const [x0, x1] of [[3, 7], [9, 13]]) {
        for (let y = 3; y < 11; y++) {
          for (let x = x0; x < x1; x++) t.set(x, y, 0, 0, 0, 0);
        }
        for (let x = x0 - 1; x <= x1; x++) { t.shade(x, 2, -30); t.shade(x, 11, 18); }
        for (let y = 3; y < 11; y++) { t.shade(x0 - 1, y, -30); t.shade(x1, y, 18); }
      }
      t.rect(2, 13, 12, 1, frame, 3);
    } else {
      t.rect(0, TILE - 2, TILE, 2, frame, 3);
      // Two raised panels.
      for (const [y0, y1] of [[2, 7], [9, 13]]) {
        for (let x = 3; x < 13; x++) { t.shade(x, y0, 20); t.shade(x, y1, -24); }
        for (let y = y0; y <= y1; y++) { t.shade(3, y, 16); t.shade(12, y, -20); }
      }
      // Handle and its plate, on the edge away from the hinge.
      t.set(col(12), 4, ...IRON_DARK);
      t.set(col(12), 5, ...IRON_DARK);
      t.set(col(13), 4, ...IRON_LIGHT);
      t.set(col(13), 5, ...IRON);
      t.set(col(13), 6, ...IRON_DARK);
    }
    // Hinges on the hinge edge.
    for (const y of upper ? [4, 5] : [10, 11]) {
      t.set(col(1), y, ...IRON);
      t.set(col(2), y, ...IRON_DARK);
    }
    t.posterize(10);
  };
}

export const BUILDING_ART: Record<string, Recipe> = {
  stone_bricks: (t) => { stoneBricks(t).posterize(10); },
  stone_bricks_mossy: (t) => {
    stoneBricks(t);
    t.mottle([70, 110, 48], 0.75, 4, 0.5);
    t.patches(9, [82, 124, 54], 8, 2);
    t.patches(6, [58, 92, 40], 6, 2);
    t.posterize(10);
  },
  stone_bricks_cracked: (t) => {
    stoneBricks(t);
    // Cracks wander inside the bricks, never across the tile edge, so the
    // face still tiles. Each is a dark line with a lit lip below it.
    const crack = (x: number, y: number, len: number, dir: number) => {
      for (let i = 0; i < len; i++) {
        t.set(x, y, 62, 62, 66);
        t.shade(x, y + 1, 14);
        x += dir;
        if (t.rng() < 0.5) y += t.rng() < 0.5 ? -1 : 1;
        y = Math.max(1, Math.min(13, y));
        if (y === 7 || y === 8) y = 6;
      }
    };
    crack(2, 3, 5, 1);
    crack(13, 11, 6, -1);
    crack(10, 2, 4, 1);
    t.patches(4, [104, 104, 108], 4, 1);
    t.posterize(10);
  },

  wool_white: wool(WOOL_COLOURS.white),
  wool_red: wool(WOOL_COLOURS.red),
  wool_blue: wool(WOOL_COLOURS.blue),
  wool_yellow: wool(WOOL_COLOURS.yellow),
  wool_green: wool(WOOL_COLOURS.green),
  wool_black: wool(WOOL_COLOURS.black),

  bookshelf: (t) => {
    const board: RGB = [150, 112, 62];
    t.fill([46, 32, 20], 3);
    for (const y of [0, 8]) {
      t.blot(0, y, TILE, 1, board, 4);
      // Books stand on the shelf below this board, spines outward.
      let x = 0;
      while (x < TILE) {
        const w = t.rng() < 0.6 ? 2 : 1;
        const top = y + 1 + ((t.rng() * 3) | 0);
        const c = SPINES[(t.rng() * SPINES.length) | 0];
        const d = (t.rng() * 2 - 1) * 12;
        const tone: RGB = [c[0] + d, c[1] + d, c[2] + d];
        const width = Math.min(w, TILE - x);
        t.blot(x, top, width, y + 8 - top, tone, 4);
        t.blot(x, top, width, 1, [tone[0] + 30, tone[1] + 30, tone[2] + 30], 2);
        // A band tooled across the spine.
        t.blot(x, y + 5, width, 1, [tone[0] + 44, tone[1] + 40, tone[2] + 24], 2);
        x += w + (t.rng() < 0.15 ? 1 : 0);
      }
    }
    t.posterize(10);
  },

  coal_block: (t) => {
    plate([36, 36, 40], [66, 66, 74], [22, 22, 26], [18, 18, 20], 14)(t);
    t.flecks(6, [104, 104, 116]);
  },
  gold_block: plate([232, 184, 56], [252, 222, 112], [198, 146, 34], [160, 110, 22], 10),
  copper_block: (t) => {
    plate([196, 112, 70], [228, 150, 100], [160, 84, 52], [128, 64, 38], 10)(t);
    // A first bloom of verdigris in the corners of the plate.
    t.blot(12, 13, 2, 1, [96, 160, 136], 6).blot(2, 12, 1, 2, [96, 160, 136], 6);
  },
  diamond_block: gem([112, 218, 222], [176, 246, 246], [66, 168, 176], [40, 120, 130]),
  ruby_block: gem([178, 32, 56], [230, 86, 104], [124, 16, 36], [90, 10, 26]),

  terracotta: (t) => t.fill([164, 94, 66], 4)
    .patches(14, [144, 80, 54], 5, 3)
    .patches(10, [188, 114, 84], 5, 2)
    .patches(5, [126, 68, 46], 4, 2)
    .posterize(16),

  glass_pane: (t) => {
    t.fill([214, 236, 244], 0, 22);
    t.border([150, 172, 184], 235);
    t.line(3, 11, 9, 5, [255, 255, 255], 1);
    t.line(5, 12, 8, 9, [255, 255, 255], 1);
  },
  glass_pane_top: (t) => {
    t.fill([168, 190, 200], 6, 225).patches(8, [200, 220, 228], 6, 2).patches(6, [136, 156, 168], 6, 2);
  },

  iron_bars: (t) => {
    for (const x of [3, 7, 11, 15]) {
      for (let y = 0; y < TILE; y++) {
        t.set(x, y, ...IRON_LIGHT);
        t.set((x + 1) % TILE, y, ...IRON);
      }
    }
    // One cross-strap, riveted where it meets each bar.
    for (let x = 0; x < TILE; x++) {
      t.set(x, 7, ...IRON);
      t.set(x, 8, ...IRON_DARK);
    }
    for (const x of [3, 7, 11, 15]) t.set(x, 7, 190, 194, 206);
    t.grain(6, 16);
  },
  iron_bars_top: (t) => { t.fill(IRON, 8).patches(8, IRON_LIGHT, 8, 2).patches(6, IRON_DARK, 6, 2); },

  trapdoor: (t) => {
    t.fill([150, 112, 64], 5).patches(8, [136, 100, 56], 4, 2);
    for (const y of [4, 8, 12]) for (let x = 0; x < TILE; x++) t.shade(x, y, -20);
    t.border([100, 72, 40]);
    t.rect(1, 7, 14, 2, [118, 86, 48], 3);   // cross brace
    // Four square holes, rimmed, cut right through.
    for (const [hx, hy] of [[3, 3], [10, 3], [3, 10], [10, 10]]) {
      for (let y = hy; y < hy + 3; y++) {
        for (let x = hx; x < hx + 3; x++) t.set(x, y, 0, 0, 0, 0);
      }
      for (let i = -1; i <= 3; i++) {
        t.shade(hx + i, hy - 1, -28);
        t.shade(hx - 1, hy + i, -28);
        t.shade(hx + i, hy + 3, 16);
        t.shade(hx + 3, hy + i, 16);
      }
    }
    t.posterize(10);
  },

  // The lantern body, in cell coordinates: columns 5..10, the bottom seven
  // rows. An iron cage with warm glass and a bright heart.
  lantern: (t) => {
    t.rect(5, 9, 6, 7, [255, 190, 84]);
    t.rect(6, 11, 4, 3, [255, 226, 140]);
    t.rect(7, 12, 2, 1, [255, 248, 210]);
    t.rect(5, 9, 6, 1, IRON_DARK).rect(5, 15, 6, 1, IRON_DARK);
    t.rect(5, 9, 1, 7, IRON).rect(10, 9, 1, 7, IRON_DARK);
    t.set(5, 10, ...IRON_LIGHT);
  },
  lantern_top: (t) => {
    t.fill([66, 68, 78], 6).patches(8, [104, 106, 118], 5, 2).patches(6, [44, 46, 54], 5, 2);
  },

  // Links in cell coordinates, down the middle of the tile: a ring seen
  // face-on, then one seen edge-on, twice.
  chain: (t) => {
    for (const y0 of [0, 8]) {
      for (let y = y0; y < y0 + 5; y++) {
        t.set(6, y, ...IRON_LIGHT);
        t.set(9, y, ...IRON_DARK);
      }
      t.rect(7, y0, 2, 1, IRON).rect(7, y0 + 4, 2, 1, IRON_DARK);
      for (let y = y0 + 5; y < y0 + 8; y++) {
        t.set(7, y, ...IRON_LIGHT);
        t.set(8, y, ...IRON);
      }
    }
  },

  campfire_log: (t) => {
    t.fill([98, 72, 44], 5);
    for (let y = 0; y < TILE; y++) {
      if (t.rng() < 0.4) for (let x = 0; x < TILE; x++) t.shade(x, y, -14 - t.rng() * 8);
    }
    t.patches(10, [52, 38, 26], 5, 2);    // char
    t.patches(6, [130, 98, 62], 5, 2);
    t.posterize(9);
  },
  campfire_embers: (t) => t.fill([200, 70, 26], 8)
    .patches(10, [255, 170, 60], 8, 2)
    .patches(8, [96, 34, 20], 6, 2)
    .posterize(8),

  // Flame tongues rising from the embers, in cell coordinates: columns
  // 2..13, from the bottom row up to each tongue's tip.
  campfire_flame: (t) => {
    const heights = [5, 8, 11, 9, 13, 10, 12, 14, 9, 11, 7, 5];
    heights.forEach((h, i) => {
      const x = 2 + i;
      for (let k = 0; k < h; k++) {
        const y = 14 - k;
        const f = k / h;
        const c: RGB = f < 0.35 ? [255, 238, 150] : f < 0.7 ? [255, 168, 40] : [236, 84, 22];
        t.set(x, y, c[0], c[1], c[2]);
      }
    });
    // A hot core low in the middle.
    t.rect(6, 11, 4, 3, [255, 250, 210]);
  },

  // Nothing at all: the top and bottom of a flame sheet, which would
  // otherwise show a sliver of fire floating over the logs.
  building_clear: () => {},

  door_wood_lower: door(false, true),
  door_wood_lower_in: door(false, false),
  door_wood_upper: door(true, true),
  door_wood_upper_in: door(true, false),
};

// --- icons: the real model, rendered ------------------------------------------

/** A tile's pixels, drawn exactly as the atlas would draw it. */
const texelCache = new Map<string, Uint8ClampedArray | null>();
function texels(name: string): Uint8ClampedArray | null {
  if (!texelCache.has(name)) {
    const recipe = BUILDING_ART[name] ?? BLOCK_ART[name] ?? NATURE_ART[name];
    if (!recipe) {
      texelCache.set(name, null);
    } else {
      const t = new Tile(mulberry32(nameSeed(name)), nameSeed(name));
      recipe(t);
      texelCache.set(name, t.px);
    }
  }
  return texelCache.get(name)!;
}

/** Stand-in colour for a texture another pack has not supplied yet. */
const MISSING: RGB = [200, 184, 140];

interface IconOptions {
  /** Neighbours to shape against: a fence icon has rails reaching both ways. */
  around?: Around;
  /** Scale small models up to fill the icon rather than keep block scale. */
  fit?: boolean;
  /** Floor for alpha, so faint glass still shows as glass. */
  minAlpha?: number;
}

/**
 * Renders a block's model into an icon, isometric and lit from the upper
 * left the way the item icons are, with a z-buffer so boxes hide one
 * another properly. Each visible face is sampled from its own texture in
 * the same mapping the mesher uses, so the icon is the block.
 */
function modelIcon(block: number, opts: IconOptions = {}): Recipe {
  return (t) => boxesIcon(t, shapeOf(block, opts.around), blockDef(block).textures, opts);
}

/**
 * The same, for a hand-posed model: a fence reads best as two posts and
 * their rails, which no single cell of fence ever is.
 */
function posedIcon(boxes: Box[], texture: string, opts: IconOptions = {}): Recipe {
  return (t) => boxesIcon(t, boxes, [texture, texture, texture], opts);
}

function boxesIcon(t: Tile, boxes: Box[], textures: [string, string, string], opts: IconOptions): void {
  const C = 0.866;
  const project = (x: number, y: number, z: number): [number, number] => [(x - z) * C, (x + z) * 0.5 - y];

  // Scale and centre: a full cube spans the icon; a small model may be
  // blown up to fill it.
  let k = TILE_PX * 0.45;
  let ox = TILE_PX / 2;
  let oy = TILE_PX / 2;
  if (opts.fit) {
    let lo = [Infinity, Infinity];
    let hi = [-Infinity, -Infinity];
    for (const b of boxes) {
      for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) {
        const [sx, sy] = project(x, y, z);
        lo = [Math.min(lo[0], sx), Math.min(lo[1], sy)];
        hi = [Math.max(hi[0], sx), Math.max(hi[1], sy)];
      }
    }
    k = Math.min((TILE_PX - 6) / (hi[0] - lo[0]), (TILE_PX - 6) / (hi[1] - lo[1]), TILE_PX * 0.9);
    ox = TILE_PX / 2 - ((lo[0] + hi[0]) / 2) * k;
    oy = TILE_PX / 2 - ((lo[1] + hi[1]) / 2) * k;
  }

  const depth = new Float32Array(TILE_PX * TILE_PX).fill(-Infinity);
  const step = 1 / (k * 2.5);

  const face = (
    tex: string, shade: number,
    point: (a: number, b: number) => [number, number, number],
    uv: (a: number, b: number) => [number, number],
    a0: number, a1: number, b0: number, b1: number,
  ) => {
    const src = texels(tex);
    for (let a = a0 + step / 2; a < a1; a += step) {
      for (let b = b0 + step / 2; b < b1; b += step) {
        const [x, y, z] = point(a, b);
        const [sx, sy] = project(x, y, z);
        const px = Math.floor(ox + sx * k);
        const py = Math.floor(oy + sy * k);
        if (px < 0 || py < 0 || px >= TILE_PX || py >= TILE_PX) continue;
        const d = x + y + z;
        const di = py * TILE_PX + px;
        if (d < depth[di]) continue;
        let r = MISSING[0];
        let g = MISSING[1];
        let bl = MISSING[2];
        let al = 255;
        if (src) {
          const [u, v] = uv(a, b);
          const tx = Math.min(TILE_PX - 1, Math.max(0, Math.floor(u * TILE_PX)));
          const ty = Math.min(TILE_PX - 1, Math.max(0, Math.floor(v * TILE_PX)));
          const si = (ty * TILE_PX + tx) * 4;
          al = src[si + 3];
          if (al < 8) continue;
          r = src[si]; g = src[si + 1]; bl = src[si + 2];
        }
        depth[di] = d;
        const o = di * 4;
        t.px[o] = r * shade;
        t.px[o + 1] = g * shade;
        t.px[o + 2] = bl * shade;
        t.px[o + 3] = Math.max(al, opts.minAlpha ?? 0);
      }
    }
  };

  for (const b of boxes) {
    const tex = b.tex ?? textures;
    const top = typeof tex === 'string' ? tex : tex[0];
    const side = typeof tex === 'string' ? tex : tex[2];
    face(top, 1.0, (x, z) => [x, b.y1, z], (x, z) => [x, z], b.x0, b.x1, b.z0, b.z1);
    face(side, 0.8, (x, y) => [x, y, b.z1], (x, y) => [x, 1 - y], b.x0, b.x1, b.y0, b.y1);
    face(side, 0.62, (z, y) => [b.x1, y, z], (z, y) => [1 - z, 1 - y], b.z0, b.z1, b.y0, b.y1);
  }
  t.outline([26, 24, 28], 0.6);
}

/** Neighbours on the listed sides, as [dx, dz] pairs, all the given block. */
function neighbours(id: number, at: Array<[number, number]>): Around {
  return (dx, dy, dz) => (dy === 0 && at.some(([x, z]) => x === dx && z === dz) ? id : Block.Air);
}

const ICONS: Record<string, Recipe> = {
  icon_slab_stone: modelIcon(Block.StoneSlab),
  icon_slab_cobble: modelIcon(Block.CobblestoneSlab),
  icon_slab_planks: modelIcon(Block.PlankSlab),
  icon_slab_stone_bricks: modelIcon(Block.StoneBrickSlab),
  icon_slab_brick: modelIcon(Block.BrickSlab),
  icon_slab_sandstone: modelIcon(Block.SandstoneSlab),
  // Seen from the south-east, a stair rising west shows its steps in profile.
  icon_stairs_planks: modelIcon(Block.PlankStairsW),
  icon_stairs_cobble: modelIcon(Block.CobblestoneStairsW),
  icon_stairs_stone_bricks: modelIcon(Block.StoneBrickStairsW),
  icon_stairs_brick: modelIcon(Block.BrickStairsW),
  icon_fence: posedIcon([
    px(0, 0, 6, 4, 16, 10), px(12, 0, 6, 16, 16, 10),
    px(4, 4, 7, 12, 7, 9), px(4, 10, 7, 12, 13, 9),
  ], 'planks', { fit: true }),
  icon_fence_gate: posedIcon([
    px(0, 0, 7, 2, 16, 9), px(14, 0, 7, 16, 16, 9),
    px(2, 3, 7, 14, 6, 9), px(2, 11, 7, 14, 14, 9), px(6, 6, 7, 10, 11, 9),
  ], 'planks', { fit: true }),
  icon_wall: posedIcon([
    px(0, 0, 4, 6, 16, 12), px(10, 0, 4, 16, 16, 12), px(6, 0, 5, 10, 12, 11),
  ], 'cobble', { fit: true }),
  icon_glass_pane: modelIcon(Block.GlassPane, {
    around: neighbours(Block.GlassPane, [[1, 0], [-1, 0]]), minAlpha: 120,
  }),
  icon_iron_bars: modelIcon(Block.IronBars, { around: neighbours(Block.IronBars, [[1, 0], [-1, 0]]) }),
  icon_trapdoor: modelIcon(Block.TrapdoorOpenN),
  icon_lantern: modelIcon(Block.Lantern, { fit: true }),
  icon_chain: modelIcon(Block.Chain, { fit: true }),
  icon_campfire: modelIcon(Block.Campfire),
  ...Object.fromEntries(Object.keys(WOOL_COLOURS).map((key) => {
    const carpet = {
      white: Block.WhiteCarpet, red: Block.RedCarpet, blue: Block.BlueCarpet,
      yellow: Block.YellowCarpet, green: Block.GreenCarpet, black: Block.BlackCarpet,
    }[key]!;
    return [`icon_carpet_${key}`, modelIcon(carpet)];
  })),
};
Object.assign(BUILDING_ART, ICONS);

/**
 * Tiles no block or item names but the renderer still needs -- a mob skin,
 * an overlay -- so they are packed into the atlas anyway.
 *
 * Here: the model parts only ever named by a box's own texture.
 */
export const BUILDING_EXTRA: string[] = [
  'door_wood_lower', 'door_wood_lower_in', 'door_wood_upper', 'door_wood_upper_in',
  'campfire_embers', 'campfire_flame', 'building_clear',
];
