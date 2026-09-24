/**
 * Block textures: terrain, building materials, machines, and the other
 * dimensions.
 *
 * The terrain and material tiles are drawn as pixel art rather than as
 * filtered noise. Each is a 16x16 picture of flat cells, and every cell is
 * one tone from a small ramp picked by hand for its material. Three rules
 * hold across the set, and most of what makes it look like one game rather
 * than a pile of swatches comes from them:
 *
 *  - Chunky clusters, not static. A texture that varies pixel to pixel
 *    averages out into one flat colour at a few blocks' distance, and the
 *    wall stops reading as stone or wood. Features here are two to six
 *    units across, so they survive being seen from across a valley.
 *  - Ramps that bend. Shadows drift cool (toward blue or purple) and
 *    highlights drift warm, instead of the same hue scaled darker, which is
 *    what separates a painted material from a greyscale one tinted after.
 *  - One light. Everything raised catches the light on its upper-left rim
 *    and drops a shadow off its lower-right, the same direction item icons
 *    are lit from, so a cobble wall and a chest beside it agree.
 *
 * tests/terrainart.ts measures each of those rather than trusting the eye.
 */

import { S, TILE, makeNoise, mulberry32, nameSeed, type RGB, type Recipe, Tile } from '../tile.js';

// --- the pixel-art kit ---------------------------------------------------

/** A material's tones, darkest first. */
export type Ramp = readonly RGB[];

const wrap = (n: number): number => ((n % TILE) + TILE) % TILE;

/**
 * One number per authoring unit, wrapping at the tile edges.
 *
 * Tiles are designed as a grid of tone levels first and coloured last, so
 * lighting and shadow can be reasoned about as "one level up" or "one level
 * down" on the material's own ramp. Wrapping reads and writes are what keep
 * anything placed near an edge continuous when the block repeats.
 */
export class Grid {
  readonly v = new Float32Array(TILE * TILE);

  constructor(init = 0) {
    this.v.fill(init);
  }

  get(x: number, y: number): number {
    return this.v[wrap(y) * TILE + wrap(x)];
  }

  set(x: number, y: number, value: number): void {
    this.v[wrap(y) * TILE + wrap(x)] = value;
  }

  map(fn: (value: number, x: number, y: number) => number): Grid {
    const out = new Grid();
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) out.v[y * TILE + x] = fn(this.v[y * TILE + x], x, y);
    }
    return out;
  }
}

/**
 * Tileable fractal noise sampled once per authoring unit, centred on zero.
 *
 * Each octave is [period, weight]; a period of 4 makes features about four
 * units across. `squash` flattens features into sideways drifts, the way
 * rock strata and water run. It must be a whole number, or the field would
 * stop meeting itself at the tile edge.
 */
export function noiseField(
  seed: number, octaves: ReadonlyArray<readonly [number, number]>, squash = 1,
): Grid {
  const layers = octaves.map(([period, weight], i) =>
    ({ noise: makeNoise(seed + i * 7919), period, weight }));
  const g = new Grid();
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let v = 0;
      for (const { noise, period, weight } of layers) {
        v += (noise(x * S + S / 2, (y * S + S / 2) * squash, period) - 0.5) * weight;
      }
      g.v[y * TILE + x] = v;
    }
  }
  return g;
}

/**
 * Splits a field into tone levels by rank rather than by value.
 *
 * `shares` says what fraction of the tile each level covers, darkest first.
 * Thresholds picked by value drift with the seed -- one stone would come out
 * nearly all dark, the next nearly all light -- while ranks pin exactly how
 * much of the surface each tone gets, which is the thing being designed.
 */
export function bands(field: Grid, shares: readonly number[]): Grid {
  const order = Array.from(field.v.keys()).sort((a, b) => field.v[a] - field.v[b]);
  const total = shares.reduce((a, b) => a + b, 0);
  const out = new Grid();
  let level = 0;
  let edge = (shares[0] / total) * order.length;
  order.forEach((cell, rank) => {
    while (rank >= edge && level < shares.length - 1) {
      level++;
      edge += (shares[level] / total) * order.length;
    }
    out.v[cell] = level;
  });
  return out;
}

/**
 * +1 where the surface rises toward the upper-left light, -1 where it falls
 * away from it, 0 on the flat.
 *
 * Reading the level grid as a height map and comparing each cell with its
 * upper-left neighbour gives both halves of a raised shape's lighting at
 * once: its own upper-left rim brightens, and the cells just past its
 * lower-right edge darken, which is the shadow it drops.
 */
export function emboss(height: Grid): Grid {
  return height.map((h, x, y) => Math.sign(h - height.get(x - 1, y - 1)));
}

/** Colours every cell from its level on the ramp, clamped to the ramp's ends. */
export function paint(t: Tile, levels: Grid, ramp: Ramp, alpha = 255): Tile {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = levels.get(x, y);
      const [r, g, b] = ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(v)))];
      t.set(x, y, r, g, b, alpha);
    }
  }
  return t;
}

/** One cell, wrapping, so a feature that crosses an edge carries on from the far side. */
function dot(t: Tile, x: number, y: number, [r, g, b]: RGB, alpha = 255): void {
  t.set(wrap(x), wrap(y), r, g, b, alpha);
}

/** Seed points on a jittered grid: evenly spread, never regimented. */
function jittered(rng: () => number, cols: number, rows: number, jitter = 0.8): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const w = TILE / cols;
  const h = TILE / rows;
  for (let r = 0; r < rows; r++) {
    // Alternate rows shift half a cell, so stones interlock like a laid
    // wall instead of lining up in columns.
    const shift = r % 2 ? w / 2 : 0;
    for (let c = 0; c < cols; c++) {
      pts.push([
        (c + 0.5) * w + shift + (rng() - 0.5) * w * jitter,
        (r + 0.5) * h + (rng() - 0.5) * h * jitter,
      ]);
    }
  }
  return pts;
}

/** Cells grouped around seed points, measured on the wrapping tile. */
interface Cells {
  /** Which seed point each cell belongs to. */
  owner: Int16Array;
  /**
   * How much nearer the owner is than the runner-up. Small along the
   * borders between cells, which is where mortar and cracks go.
   */
  margin: Float32Array;
}

function voronoi(points: ReadonlyArray<readonly [number, number]>): Cells {
  const owner = new Int16Array(TILE * TILE);
  const margin = new Float32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let best = Infinity;
      let second = Infinity;
      let who = 0;
      points.forEach(([px, py], i) => {
        let dx = Math.abs(x + 0.5 - px) % TILE;
        let dy = Math.abs(y + 0.5 - py) % TILE;
        dx = Math.min(dx, TILE - dx);
        dy = Math.min(dy, TILE - dy);
        const d = Math.hypot(dx, dy);
        if (d < best) {
          second = best;
          best = d;
          who = i;
        } else if (d < second) {
          second = d;
        }
      });
      owner[y * TILE + x] = who;
      margin[y * TILE + x] = second - best;
    }
  }
  return { owner, margin };
}

/**
 * Lights a field of separate pieces -- stones, pebbles, crystals -- each
 * from its own upper-left, given which piece owns each cell and which cells
 * are the recessed gaps between them.
 *
 * A piece's upper-left rim faces the light (+1), its lower-right rim faces
 * away (-1). That per-piece rim, rather than one gradient across the whole
 * tile, is what makes a heap of stones read as rounded.
 */
function pieceLight(owner: Int16Array, gap: (x: number, y: number) => boolean): Grid {
  const own = (x: number, y: number): number => owner[wrap(y) * TILE + wrap(x)];
  const g = new Grid();
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (gap(x, y)) continue;
      const me = own(x, y);
      const outside = (dx: number, dy: number): boolean =>
        gap(x + dx, y + dy) || own(x + dx, y + dy) !== me;
      const lit = outside(-1, 0) || outside(0, -1) || outside(-1, -1);
      const shaded = outside(1, 0) || outside(0, 1) || outside(1, 1);
      g.set(x, y, lit && !shaded ? 1 : shaded && !lit ? -1 : 0);
    }
  }
  return g;
}

// --- ground --------------------------------------------------------------

// Seeds for surfaces other tiles have to match exactly: every ore sits in
// the same stone as the stone block, and the soil under a grass block's
// fringe is the dirt block, so a grass block over dirt shows no join.
const STONE_SEED = 555;
const DIRT_SEED = 4409;

const STONE: Ramp = [
  [78, 80, 93], [101, 102, 112], [123, 123, 128], [143, 142, 143], [164, 161, 155],
];

const DIRT: Ramp = [
  [66, 42, 48], [94, 64, 50], [119, 84, 58], [140, 103, 68], [160, 124, 82],
];

const GRASS: Ramp = [
  [38, 80, 46], [58, 106, 46], [80, 132, 52], [104, 156, 58], [138, 184, 74],
];

/**
 * The stone surface, as levels on STONE.
 *
 * Small irregular patches of lighter and darker rock, two or three units
 * across and spread evenly, most of them with a lit rim or a shadowed edge.
 *
 * Evenness matters more here than anywhere else. Stone is the surface a
 * player sees most, hundreds of repeats at once, and one big feature per
 * tile -- the first version had a single broad drift -- turns a hillside
 * into wallpaper with the same blotch stamped every block. Many small
 * features at similar weight repeat without a focal point to catch.
 */
function stoneLevels(): Grid {
  const field = noiseField(STONE_SEED, [[8, 1], [16, 0.6], [4, 0.3]]);
  const g = bands(field, [0.2, 0.56, 0.24]).map((v) => v + 1);
  const light = emboss(g);
  const rng = mulberry32(STONE_SEED);
  const out = g.map((v, x, y) => {
    const l = light.get(x, y);
    if (v === 3 && l > 0 && rng() < 0.7) return 4;
    if (v === 1 && l < 0 && rng() < 0.5) return 0;
    return v;
  });
  // Lone flecks of mineral give the surface a grain up close without
  // adding anything big enough to repeat visibly.
  for (let i = 0; i < 6; i++) {
    const x = (rng() * TILE) | 0;
    const y = (rng() * TILE) | 0;
    if (out.get(x, y) === 2) out.set(x, y, rng() < 0.6 ? 1 : 3);
  }
  return out;
}

/** The soil surface, on DIRT. */
function drawDirt(t: Tile): void {
  const rng = mulberry32(DIRT_SEED);
  const field = noiseField(DIRT_SEED, [[8, 1], [16, 0.7], [4, 0.45]]);
  const g = bands(field, [0.05, 0.25, 0.42, 0.23, 0.05]);
  paint(t, g, DIRT);
  // Pebbles: pale grit sitting proud of the soil, each with a dark crumb
  // under its lower-right corner.
  const PEBBLE: Ramp = [[128, 116, 108], [166, 150, 124]];
  for (let i = 0; i < 6; i++) {
    const x = (rng() * TILE) | 0;
    const y = (rng() * TILE) | 0;
    const wide = rng() < 0.5;
    dot(t, x, y, PEBBLE[1]);
    if (wide) dot(t, x + 1, y, PEBBLE[0]);
    dot(t, x + (wide ? 2 : 1), y + 1, DIRT[0]);
    dot(t, x + (wide ? 1 : 0), y + 1, DIRT[0]);
  }
  // Root threads: short dark strands wandering diagonally.
  for (let i = 0; i < 3; i++) {
    let x = (rng() * TILE) | 0;
    let y = (rng() * TILE) | 0;
    const dir = rng() < 0.5 ? 1 : -1;
    for (let s = 0; s < 3; s++) {
      dot(t, x, y, DIRT[0]);
      x += dir;
      y += rng() < 0.6 ? 1 : 0;
    }
  }
}

/** The grass surface as levels on GRASS: tufts over a turf of broad patches. */
function grassLevels(seed: number): Grid {
  const rng = mulberry32(seed);
  const field = noiseField(seed, [[8, 1], [4, 0.7], [16, 0.5]]);
  const g = bands(field, [0.04, 0.26, 0.42, 0.24, 0.04]);
  // Blade tips: a lit cell with the shadow of the blade under it. On a top
  // face this is what separates a lawn from green felt.
  for (let i = 0; i < 22; i++) {
    const x = (rng() * TILE) | 0;
    const y = (rng() * TILE) | 0;
    g.set(x, y, Math.min(4, g.get(x, y) + 2));
    g.set(x, y + 1, Math.max(0, g.get(x, y + 1) - 1));
  }
  return g;
}

const TERRAIN_ART: Record<string, Recipe> = {
  grass_top: (t) => {
    paint(t, grassLevels(nameSeed('grass_top')), GRASS);
  },

  // Turf over the dirt block's own soil. The fringe hangs down in uneven
  // drips -- some a single blade, some two wide and long -- and each drip
  // drops a dark line of shadow onto the soil under it, which is what makes
  // it read as overhanging rather than painted on.
  grass_side: (t) => {
    drawDirt(t);
    const rng = mulberry32(nameSeed('grass_side'));
    // The turf's lower edge wanders between three and four rows, then drips
    // hang from it at irregular spacing.
    const depth: number[] = [];
    let run = 3;
    for (let x = 0; x < TILE; x++) {
      if (rng() < 0.45) run = run === 3 ? 4 : 3;
      depth.push(run);
    }
    for (let i = 0; i < 5; i++) {
      const x = (rng() * TILE) | 0;
      const long = 5 + ((rng() * 4) | 0);
      depth[x] = Math.max(depth[x], long);
      if (rng() < 0.6) depth[wrap(x + 1)] = Math.max(depth[wrap(x + 1)], long - 1 - ((rng() * 2) | 0));
    }
    depth[(rng() * TILE) | 0] = 2;
    const turf = grassLevels(nameSeed('grass_top'));
    for (let x = 0; x < TILE; x++) {
      const d = depth[x];
      for (let y = 0; y < d; y++) {
        let level = Math.max(1, Math.min(3, turf.get(x, y)));
        if (y === 0) level = Math.max(level, 3);        // the lip catches the sky
        if (y === d - 1) level = Math.min(level, 1);    // tip of the drip
        dot(t, x, y, GRASS[level]);
      }
      dot(t, x, d, DIRT[0]);                             // the shadow under it
    }
  },

  dirt: (t) => drawDirt(t),

  stone: (t) => {
    paint(t, stoneLevels(), STONE);
  },

  // Rounded stones packed in dark mortar. The gaps are what separate cobble
  // from stone at any distance; the per-stone rim light is what makes each
  // piece look rounded instead of flat paving.
  cobble: (t) => {
    const COBBLE: Ramp = [
      [42, 42, 52], [76, 76, 86], [102, 102, 108], [125, 124, 128], [147, 145, 145], [171, 168, 161],
    ];
    const rng = mulberry32(nameSeed('cobble'));
    const pts = jittered(rng, 3, 3, 0.9);
    pts.push([rng() * TILE, rng() * TILE], [rng() * TILE, rng() * TILE]);
    const { owner, margin } = voronoi(pts);
    const gap = (x: number, y: number): boolean => margin[wrap(y) * TILE + wrap(x)] < 0.8;
    const light = pieceLight(owner, gap);
    const tone = pts.map(() => 2 + ((rng() * 2.4) | 0));
    const g = new Grid().map((_, x, y) => {
      if (gap(x, y)) return 0;
      return tone[owner[y * TILE + x]] + light.get(x, y);
    });
    // Where a stone's rim meets the mortar on its shadowed side, the mortar
    // itself sits deeper still; where it meets the lit side it catches a
    // little light. That asymmetry is what seats the stones in the wall.
    paint(t, g.map((v, x, y) => (v === 0 && gap(x - 1, y - 1) && !gap(x + 1, y + 1) ? 1 : v)), COBBLE);
  },

  // Loose pebbles of mixed rock: smaller than cobble's stones, in several
  // hues, and packed with only hairline gaps, so the two never read alike.
  gravel: (t) => {
    const rng = mulberry32(nameSeed('gravel'));
    const HUES: Ramp[] = [
      [[84, 84, 94], [120, 118, 120], [148, 145, 142], [176, 172, 164]],   // grey
      [[88, 72, 68], [126, 108, 96], [154, 134, 118], [180, 160, 140]],    // brown
      [[96, 76, 82], [138, 114, 112], [168, 144, 136], [196, 174, 162]],   // pink granite
      [[60, 58, 70], [88, 86, 94], [112, 110, 116], [140, 138, 140]],      // dark flint
    ];
    const pts = jittered(rng, 5, 5, 0.7);
    const { owner, margin } = voronoi(pts);
    const gap = (x: number, y: number): boolean => margin[wrap(y) * TILE + wrap(x)] < 0.5;
    const light = pieceLight(owner, gap);
    const hue = pts.map((_, i) => HUES[i % 3 === 0 ? 0 : (rng() * HUES.length) | 0]);
    const tone = pts.map(() => 1 + ((rng() * 2) | 0));
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = y * TILE + x;
        if (gap(x, y)) {
          // The gaps between pebbles are shallow grit, not the deep mortar
          // of cobble; the cell in a pebble's shadow is the only dark one.
          dot(t, x, y, gap(x - 1, y - 1) ? [96, 88, 86] : [64, 58, 62]);
          continue;
        }
        const ramp = hue[owner[i]];
        const level = Math.max(0, Math.min(3, tone[owner[i]] + light.get(x, y)));
        dot(t, x, y, ramp[level]);
      }
    }
  },

  sand: (t) => {
    const SAND: Ramp = [
      [156, 128, 114], [198, 174, 128], [220, 201, 146], [233, 218, 164], [246, 236, 186],
    ];
    const rng = mulberry32(nameSeed('sand'));
    const field = noiseField(nameSeed('sand'), [[8, 1], [16, 0.8]], 2);
    const g = bands(field, [0.16, 0.5, 0.34]).map((v) => v + 1);
    // Single grains: dark ones sit in the troughs, bright ones catch the sun.
    for (let i = 0; i < 16; i++) {
      const x = (rng() * TILE) | 0;
      const y = (rng() * TILE) | 0;
      g.set(x, y, rng() < 0.55 ? 0 : 4);
    }
    paint(t, g, SAND);
  },

  // The floor of the world: near-black voids around pale, sharp-edged
  // chunks. The contrast is deliberately harsher than any other stone, so
  // reaching it reads as a limit rather than more rock.
  bedrock: (t) => {
    const BEDROCK: Ramp = [
      [16, 16, 24], [40, 40, 50], [70, 70, 78], [104, 103, 106], [140, 138, 134],
    ];
    const field = noiseField(nameSeed('bedrock'), [[8, 1], [4, 0.6], [16, 0.45]]);
    const g = bands(field, [0.24, 0.26, 0.26, 0.24]);
    const light = emboss(g);
    // The pale chunks get a lit rim; every edge falling away drops into the
    // void below it.
    paint(t, g.map((v, x, y) => {
      const l = light.get(x, y);
      if (l > 0 && v >= 2) return v + 1;
      return l < 0 ? v - 1 : v;
    }), BEDROCK);
  },
};

// --- wood and foliage ----------------------------------------------------

const BARK: Ramp = [
  [38, 28, 30], [64, 46, 38], [88, 65, 46], [110, 84, 57], [132, 104, 71],
];

const WOOD: Ramp = [
  [100, 68, 44], [136, 98, 60], [162, 122, 76], [184, 144, 94], [204, 168, 116],
];

const PLANK: Ramp = [
  [66, 42, 34], [116, 82, 52], [142, 106, 66], [164, 127, 80], [186, 150, 98],
];

const LEAF: Ramp = [
  [20, 44, 34], [34, 72, 40], [52, 98, 44], [74, 126, 50], [106, 156, 62],
];

/**
 * Four boards on PLANK levels, each with its own tone, a run of grain, a
 * dark seam under it and one end joint -- the joints staggered so no two
 * line up, the way boards are really laid.
 */
function plankLevels(seed: number): Grid {
  const rng = mulberry32(seed);
  const g = new Grid();
  const joints = [3, 11, 7, 14];
  const tones = [3, 2, 3, 2];
  for (let board = 0; board < 4; board++) {
    const y0 = board * 4;
    const base = tones[board];
    for (let y = y0; y < y0 + 3; y++) {
      for (let x = 0; x < TILE; x++) g.set(x, y, base);
    }
    for (let x = 0; x < TILE; x++) g.set(x, y0 + 3, 0);
    // Grain: long streaks a shade either side of the board's own tone.
    for (let i = 0; i < 4; i++) {
      const y = y0 + ((rng() * 3) | 0);
      const x = (rng() * TILE) | 0;
      const len = 3 + ((rng() * 5) | 0);
      const d = i % 2 ? -1 : 1;
      for (let k = 0; k < len; k++) g.set(x + k, y, base + d);
    }
    // The board's upper edge catches the light; its lower edge, over the
    // seam, falls into shadow.
    for (let x = 0; x < TILE; x++) {
      if (rng() < 0.7) g.set(x, y0, Math.max(g.get(x, y0), base + 1));
      if (rng() < 0.5) g.set(x, y0 + 2, Math.min(g.get(x, y0 + 2), base - 1));
    }
    const j = joints[board];
    for (let y = y0; y < y0 + 3; y++) {
      g.set(j, y, 0);
      g.set(j + 1, y, base + 1);   // the next board's end, lit
      g.set(j - 1, y, base - 1);   // this one's, in the joint's shadow
    }
  }
  return g;
}

/** Leaf clusters, by shape: a few cells each, their upper-left cell first. */
const LEAF_SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]],
  [[0, 0], [0, 1], [1, 1], [1, 2]],
];

const WOOD_ART: Record<string, Recipe> = {
  // Bark: raised ridges split by dark crevices that wander a step sideways
  // now and then. Each ridge is lit down its left side and shaded down its
  // right, so the trunk reads as round furrows rather than stripes.
  log_side: (t) => {
    const rng = mulberry32(nameSeed('log_side'));
    const crevices = [0, 4, 7, 11, 14];
    const at: number[][] = crevices.map((x0) => {
      const rows = new Array<number>(TILE).fill(x0);
      const from = (rng() * TILE) | 0;
      const len = 3 + ((rng() * 6) | 0);
      const step = rng() < 0.5 ? -1 : 1;
      for (let k = 0; k < len; k++) rows[(from + k) % TILE] = x0 + step;
      return rows;
    });
    const g = new Grid(2);
    for (let y = 0; y < TILE; y++) {
      for (const rows of at) {
        const x = rows[y];
        g.set(x, y, 0);
        g.set(x + 1, y, 3);
        g.set(x - 1, y, 1);
      }
    }
    // Lighter flakes on the ridges and a few horizontal checks across them.
    for (let i = 0; i < 10; i++) {
      const x = (rng() * TILE) | 0;
      const y = (rng() * TILE) | 0;
      if (g.get(x, y) !== 2) continue;
      if (i % 3 === 0) {
        g.set(x, y, 1);
      } else {
        g.set(x, y, 3);
        if (g.get(x, y + 1) === 2) g.set(x, y + 1, 4);
      }
    }
    paint(t, g, BARK);
  },

  // Growth rings in rounded squares -- a log's end is square in this world
  // -- inside a rim of the same bark as the sides, with a pale band of
  // sapwood just under the bark and a split running out from the heart.
  log_top: (t) => {
    const rng = mulberry32(nameSeed('log_top'));
    const wobble = noiseField(nameSeed('log_top'), [[4, 1]]);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const edge = Math.min(x, y, TILE - 1 - x, TILE - 1 - y);
        if (edge === 0) {
          const lit = x === 0 || y === 0;
          const level = (lit ? 3 : 1) + (rng() < 0.3 ? -1 : 0);
          dot(t, x, y, BARK[level]);
          continue;
        }
        if (edge === 1) {
          // Sapwood: pale just inside the bark, lit on the top and left.
          dot(t, x, y, WOOD[x === 1 || y === 1 ? 4 : 3]);
          continue;
        }
        const dx = Math.abs(x - 7.5);
        const dy = Math.abs(y - 7.5);
        const d = (Math.hypot(dx, dy) + Math.max(dx, dy)) / 2 + wobble.get(x, y) * 1.6;
        // Each year is a wide pale band and a thin dark line.
        const ring = d / 1.6;
        dot(t, x, y, WOOD[ring - Math.floor(ring) < 0.34 ? 1 : ring % 2 < 1 ? 3 : 2]);
      }
    }
    for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]]) dot(t, x, y, WOOD[1]);
    dot(t, 7, 7, WOOD[0]);
    // The split: a crack from the heart out toward the rim.
    for (const [x, y] of [[9, 9], [10, 10], [10, 11], [11, 12]]) dot(t, x, y, WOOD[0]);
  },

  // Dense overlapping clusters. The deep blue-green behind them is the
  // shadow inside the canopy -- leaves are opaque, so depth has to be
  // painted: back clusters darker, front ones lighter, each front cluster
  // dropping a shadow onto whatever is behind it.
  leaves: (t) => {
    const rng = mulberry32(nameSeed('leaves'));
    const g = bands(noiseField(nameSeed('leaves'), [[8, 1]]), [0.6, 0.4]);
    const layer = (count: number, base: number): void => {
      for (let i = 0; i < count; i++) {
        const shape = LEAF_SHAPES[(rng() * LEAF_SHAPES.length) | 0];
        const ox = (rng() * TILE) | 0;
        const oy = (rng() * TILE) | 0;
        const own = new Set(shape.map(([x, y]) => `${x},${y}`));
        for (const [x, y] of shape) {
          if (!own.has(`${x + 1},${y + 1}`)) g.set(ox + x + 1, oy + y + 1, Math.max(0, base - 2));
        }
        shape.forEach(([x, y], k) => g.set(ox + x, oy + y, k === 0 ? base + 1 : base));
      }
    };
    layer(20, 2);
    layer(16, 3);
    paint(t, g, LEAF);
  },

  planks: (t) => {
    paint(t, plankLevels(nameSeed('planks')), PLANK);
  },

  ladder: (t) => {
    // Two rails with rungs between them on a transparent tile, so the wall
    // behind shows through the gaps. Rungs repeat every four rows, which is
    // what lets a tall ladder stack without a hitch at each block.
    const L: Ramp = [[70, 48, 30], [112, 80, 48], [146, 108, 66], [176, 136, 86]];
    for (let y = 0; y < TILE; y++) {
      for (const x of [2, 12]) {
        dot(t, x, y, L[3]);
        dot(t, x + 1, y, L[1]);
      }
    }
    for (let y = 1; y < TILE; y += 4) {
      for (let x = 4; x < 12; x++) {
        dot(t, x, y, L[2]);
        dot(t, x, y + 1, L[1]);
      }
      // Pegs where each rung is fixed into the rails.
      dot(t, 3, y, L[0]);
      dot(t, 12, y + 1, L[0]);
    }
  },
};

// --- ores ----------------------------------------------------------------

/** A deposit: the cells it covers, and the one that carries its glint. */
interface Deposit {
  cells: Array<[number, number]>;
  glint: [number, number];
}

/**
 * Stone with deposits set into it.
 *
 * Every ore is the stone block's exact surface with something embedded, so
 * a vein reads as part of the rock around it. The deposit ramp runs
 * [shadow rim, body, lit face, glint]. Each deposit is lit from the upper
 * left and seated with a sliver of darkened stone off its lower right.
 */
function ore(t: Tile, ramp: Ramp, deposits: Deposit[]): void {
  const g = stoneLevels();
  const all = new Set<number>();
  const key = (x: number, y: number): number => wrap(y) * TILE + wrap(x);
  for (const d of deposits) for (const [x, y] of d.cells) all.add(key(x, y));
  const has = (x: number, y: number): boolean => all.has(key(x, y));
  for (const d of deposits) {
    for (const [x, y] of d.cells) {
      if (!has(x + 1, y + 1)) g.set(x + 1, y + 1, Math.max(0, Math.min(1, g.get(x + 1, y + 1) - 1)));
    }
  }
  paint(t, g, STONE);
  for (const d of deposits) {
    for (const [x, y] of d.cells) {
      const lit = !has(x - 1, y - 1) && (!has(x - 1, y) || !has(x, y - 1));
      const dim = !has(x + 1, y + 1) && (!has(x + 1, y) || !has(x, y + 1));
      dot(t, x, y, ramp[lit && !dim ? 2 : dim && !lit ? 0 : 1]);
    }
    dot(t, d.glint[0], d.glint[1], ramp[3]);
  }
}

/** Spreads deposit anchors over the tile so no two crowd each other. */
function anchors(rng: () => number, n: number): Array<[number, number]> {
  return jittered(rng, 2, 2, 0.5).slice(0, n).map(([x, y]) => [Math.floor(x) - 1, Math.floor(y) - 1]);
}

const ORE_ART: Record<string, Recipe> = {
  // Coal: blocky black lumps, the biggest and most angular deposits.
  coal_ore: (t) => {
    const rng = mulberry32(nameSeed('coal_ore'));
    const deposits = anchors(rng, 4).map(([ax, ay]): Deposit => {
      const cells: Array<[number, number]> = [];
      const w = 3 + ((rng() * 2) | 0);
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < w; x++) {
          const corner = (x === 0 || x === w - 1) && (y === 0 || y === 2);
          if (corner && rng() < 0.5) continue;
          cells.push([ax + x, ay + y]);
        }
      }
      cells.push([ax + (rng() < 0.5 ? 1 : w - 2), ay + 3]);
      return { cells, glint: cells[0] };
    });
    // Matte black: the lit face is barely lifted, so the lump stays one
    // solid mass and the glint alone says "hard and shiny".
    ore(t, [[10, 10, 14], [28, 28, 34], [54, 54, 66], [116, 116, 134]], deposits);
  },

  // Iron: clusters of small rounded nuggets, rusty tan.
  iron_ore: (t) => {
    const rng = mulberry32(nameSeed('iron_ore'));
    const deposits: Deposit[] = [];
    for (const [ax, ay] of anchors(rng, 4)) {
      for (const [ox, oy] of [[0, 0], [3, 1 + ((rng() * 2) | 0)]]) {
        const x = ax + ox;
        const y = ay + oy;
        deposits.push({ cells: [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]], glint: [x, y] });
      }
    }
    ore(t, [[118, 74, 58], [176, 124, 94], [214, 166, 130], [240, 208, 180]], deposits);
  },

  // Gold: thin bright veins running on the diagonal.
  gold_ore: (t) => {
    const rng = mulberry32(nameSeed('gold_ore'));
    const deposits = anchors(rng, 4).map(([ax, ay]): Deposit => {
      const cells: Array<[number, number]> = [];
      const down = rng() < 0.5;
      let x = ax;
      let y = ay + (down ? 0 : 4);
      for (let k = 0; k < 7; k++) {
        cells.push([x, y]);
        // Thickened in the middle, so the vein swells and thins like a seam.
        if (k >= 2 && k <= 4) cells.push([x, y + 1]);
        if (k % 2 === 0) x++;
        else y += down ? 1 : -1;
      }
      return { cells, glint: cells[2] };
    });
    ore(t, [[150, 96, 22], [222, 170, 40], [250, 216, 78], [255, 246, 176]], deposits);
  },

  // Diamond: faceted crystals, rhombus-cut, each with a white-hot facet.
  diamond_ore: (t) => {
    const rng = mulberry32(nameSeed('diamond_ore'));
    // One large crystal and a few small ones: the big rhombus is what reads
    // from across a cave, the small ones keep it from looking stamped.
    const deposits = anchors(rng, 4).map(([ax, ay], i): Deposit => {
      const cx = ax + 2;
      const cy = ay + 2;
      const reach = i === 0 ? 2 : 1;
      const cells: Array<[number, number]> = [];
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if (Math.abs(dx) + Math.abs(dy) <= reach) cells.push([cx + dx, cy + dy]);
        }
      }
      return { cells, glint: [cx - (reach - 1), cy - (reach - 1)] };
    });
    ore(t, [[18, 100, 112], [58, 192, 198], [128, 238, 232], [232, 255, 252]], deposits);
  },
};

// --- light and liquid ----------------------------------------------------

const GLOW_ART: Record<string, Recipe> = {
  // Glass is read by its edges and its highlights, not by any fill: a pale
  // frame lit along the top and left, a faint tint across the pane, and a
  // pair of glints.
  glass: (t) => {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) dot(t, x, y, [196, 226, 236], 20);
    }
    for (let i = 0; i < TILE; i++) {
      dot(t, i, 0, [236, 248, 252]);
      dot(t, 0, i, [226, 242, 248]);
      dot(t, i, TILE - 1, [142, 176, 192]);
      dot(t, TILE - 1, i, [160, 192, 206]);
    }
    dot(t, 0, TILE - 1, [182, 210, 222]);
    dot(t, TILE - 1, 0, [196, 222, 232]);
    for (const [x, y] of [[2, 6], [3, 5], [4, 4], [5, 3], [6, 2]]) dot(t, x, y, [255, 255, 255], 190);
    for (const [x, y] of [[4, 7], [5, 6], [6, 5], [7, 4]]) dot(t, x, y, [240, 250, 255], 110);
    for (const [x, y] of [[11, 13], [12, 12], [13, 11]]) dot(t, x, y, [236, 248, 255], 120);
  },

  // Long low swells: dark troughs, a body of blue, and bright crests
  // wherever a swell rises into the light.
  water: (t) => {
    const WATER: Ramp = [
      [24, 52, 132], [34, 74, 166], [46, 98, 194], [68, 128, 216], [132, 186, 238],
    ];
    const g = bands(noiseField(nameSeed('water'), [[4, 1], [8, 0.45]], 2), [0.12, 0.32, 0.38, 0.18]);
    // A crest is the top edge of a swell: a light cell with a darker one
    // above it. Only the horizontal edge counts, so the highlights come out
    // as the short flat glints of a moving surface.
    paint(t, g.map((v, x, y) => (v === 3 && g.get(x, y - 1) < 3 && g.get(x + 1, y) === 3 ? 4 : v)),
      WATER, 190);
  },

  // Molten rock: a glowing body, a few plates of cooling crust drifting on
  // it, and the hottest seams showing white-yellow.
  lava: (t) => {
    const LAVA: Ramp = [
      [88, 18, 16], [142, 32, 14], [196, 62, 16], [230, 102, 24], [248, 154, 40], [255, 216, 104],
    ];
    const g = bands(noiseField(nameSeed('lava'), [[4, 1], [8, 0.6], [16, 0.25]]),
      [0.08, 0.14, 0.3, 0.28, 0.14, 0.06]);
    const light = emboss(g);
    paint(t, g.map((v, x, y) => (v <= 1 && light.get(x, y) > 0 ? v + 1 : v)), LAVA);
  },

  // Crystals packed together, each lit on its upper-left facet, with the
  // brightest burning white at the core.
  glowstone: (t) => {
    const GLOW: Ramp = [
      [96, 56, 30], [150, 96, 42], [204, 146, 60], [236, 190, 94], [252, 226, 148], [255, 250, 214],
    ];
    const rng = mulberry32(nameSeed('glowstone'));
    const pts = jittered(rng, 3, 3, 0.8);
    pts.push([rng() * TILE, rng() * TILE]);
    const { owner, margin } = voronoi(pts);
    const gap = (x: number, y: number): boolean => margin[wrap(y) * TILE + wrap(x)] < 0.85;
    const light = pieceLight(owner, gap);
    const tone = pts.map(() => 2 + ((rng() * 2.3) | 0));
    paint(t, new Grid().map((_, x, y) => {
      if (gap(x, y)) return gap(x - 1, y - 1) ? 1 : 0;
      const own = owner[y * TILE + x];
      if (tone[own] >= 3 && margin[y * TILE + x] > 2.2 && light.get(x, y) >= 0) return 5;
      return tone[own] + light.get(x, y);
    }), GLOW);
  },

  // A thin stick model samples this tile at its own coordinates: the stick
  // is columns 7-8 and rows 6-15, and its 2x2 top face is rows 7-8. So the
  // wood runs down those columns, the flame sits on rows 6-7, and row 8 is
  // the charred tip glowing orange -- the side shows it under the flame, the
  // top face shows flame and ember together. Everything else is empty.
  torch: (t) => {
    for (let y = 9; y < TILE; y++) {
      dot(t, 7, y, [150, 110, 64]);
      dot(t, 8, y, [108, 76, 42]);
    }
    dot(t, 7, 14, [124, 90, 52]);
    dot(t, 7, 8, [236, 126, 44]);
    dot(t, 8, 8, [196, 82, 34]);
    dot(t, 7, 7, [255, 214, 96]);
    dot(t, 8, 7, [252, 170, 56]);
    dot(t, 7, 6, [255, 248, 196]);
    dot(t, 8, 6, [255, 222, 122]);
  },
};

// --- building materials --------------------------------------------------

/**
 * Courses of bricks in a running bond, as flat cells.
 *
 * `lengths` lists the bricks in one course, joint included, summing to the
 * tile width; alternate courses shift by `shift` so joints never stack.
 * Each brick takes a tone of its own, a lit top edge and a shadowed lower
 * edge; mortar joints sit in the brick's shadow. Returns nothing -- it
 * paints straight onto the tile.
 */
function brickwork(
  t: Tile, seed: number, ramp: Ramp, mortar: Ramp,
  lengths: readonly number[], courseHeight: number, shift: number,
): void {
  const rng = mulberry32(seed);
  for (let course = 0; course < TILE / courseHeight; course++) {
    const y0 = course * courseHeight;
    let x0 = course % 2 ? shift : 0;
    for (const len of lengths) {
      const tone = 2 + (rng() < 0.3 ? -1 : rng() < 0.45 ? 1 : 0);
      for (let dy = 0; dy < courseHeight - 1; dy++) {
        for (let dx = 0; dx < len - 1; dx++) {
          let level = tone;
          if (dy === 0 && dx < len - 2) level++;
          else if (dy === courseHeight - 2 || dx === len - 2) level--;
          if (rng() < 0.12) level += rng() < 0.5 ? 1 : -1;
          dot(t, x0 + dx, y0 + dy, ramp[Math.max(0, Math.min(ramp.length - 1, level))]);
        }
        dot(t, x0 + len - 1, y0 + dy, mortar[0]);   // vertical joint, in shadow
      }
      for (let dx = 0; dx < len; dx++) {
        // The bed joint: shaded under the brick, a crumb of light here and there.
        dot(t, x0 + dx, y0 + courseHeight - 1, mortar[rng() < 0.2 ? 2 : 1]);
      }
      x0 += len;
    }
  }
}

const BRICK: Ramp = [
  [72, 28, 46], [116, 46, 46], [146, 64, 52], [172, 88, 62], [198, 116, 78],
];

const IRON: Ramp = [
  [96, 100, 116], [136, 140, 154], [172, 175, 186], [198, 200, 208], [222, 224, 228], [244, 244, 242],
];

const QUARTZ: Ramp = [
  [176, 168, 188], [204, 198, 214], [226, 222, 214], [238, 235, 226], [252, 249, 234],
];

/**
 * A short vein wandering diagonally from a random start, as cells.
 *
 * Short on purpose. A vein that crossed the whole tile met its own copy in
 * the next block, and a wall of them turned into ruled lines; a few
 * fragments that stop partway read as natural flaws in the stone.
 */
function vein(rng: () => number, from: readonly [number, number]): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  let x = Math.floor(from[0]);
  let y = Math.floor(from[1]);
  const fall = rng() < 0.5 ? 1 : -1;
  const len = 5 + ((rng() * 4) | 0);
  for (let k = 0; k < len; k++) {
    cells.push([x, y]);
    x++;
    if (rng() < 0.6) y += fall;
  }
  return cells;
}

const MATERIAL_ART: Record<string, Recipe> = {
  brick: (t) => {
    brickwork(t, nameSeed('brick'), BRICK, [[108, 100, 104], [152, 142, 130], [186, 176, 154]], [8, 8], 4, 4);
  },

  // A worked metal plate: a bevelled rim, a pressed inner panel, a rivet in
  // each corner and a soft band of sheen. Nearly flat on purpose -- every
  // machine's casing is this tile, and it has to sit quietly under them.
  iron_block: (t) => {
    const g = new Grid(3);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const d = x + y;
        if (d >= 8 && d <= 10) g.set(x, y, 4);
        if (d >= 18 && d <= 19) g.set(x, y, 4);
      }
    }
    for (let i = 0; i < TILE; i++) {
      g.set(i, 0, 4);
      g.set(0, i, 4);
      g.set(i, TILE - 1, 1);
      g.set(TILE - 1, i, 1);
    }
    // The pressed panel: a groove whose upper-left wall is in shadow and
    // whose lower-right wall catches the light.
    for (let i = 3; i <= 12; i++) {
      g.set(i, 3, 2);
      g.set(3, i, 2);
      g.set(i, 12, 4);
      g.set(12, i, 4);
    }
    for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) {
      g.set(x, y, 5);
      g.set(x + 1, y + 1, 0);
    }
    paint(t, g, IRON);
  },

  // Polished, pale and calm, with a couple of faint veins running through
  // it -- enough to be stone rather than paint.
  quartz: (t) => {
    const rng = mulberry32(nameSeed('quartz'));
    const g = bands(noiseField(nameSeed('quartz'), [[4, 1], [8, 0.4]]), [0.3, 0.5, 0.2]).map((v) => v + 2);
    for (const start of jittered(rng, 2, 2, 0.8).slice(0, 3)) {
      // A hairline, darkest where it is deepest, with the polished face
      // just above it catching the light.
      for (const [x, y] of vein(rng, [start[0] - 3, start[1]])) {
        g.set(x, y, rng() < 0.15 ? 0 : 1);
        if (g.get(x, y - 1) > 1) g.set(x, y - 1, Math.max(g.get(x, y - 1), 3));
      }
    }
    for (let i = 0; i < 4; i++) g.set((rng() * TILE) | 0, (rng() * TILE) | 0, 4);
    paint(t, g, QUARTZ);
  },
};

// --- furniture -----------------------------------------------------------

const METAL: Ramp = [[34, 32, 38], [64, 62, 70], [104, 104, 114], [150, 150, 160], [196, 198, 206]];

/** A 1-unit frame lit on its top and left edges and shaded on the others. */
function frame(t: Tile, ramp: Ramp, lit: number, shaded: number): void {
  for (let i = 0; i < TILE; i++) {
    dot(t, i, 0, ramp[lit]);
    dot(t, 0, i, ramp[lit]);
    dot(t, i, TILE - 1, ramp[shaded]);
    dot(t, TILE - 1, i, ramp[shaded]);
  }
}

const FURNACE: Ramp = [
  [44, 44, 54], [74, 74, 84], [100, 100, 108], [122, 122, 127], [144, 143, 144], [166, 164, 158],
];

/** The furnace's stone housing: square-cut blocks with a lit rim. */
function furnaceStone(t: Tile, seed: number): void {
  const g = bands(noiseField(seed, [[8, 1], [4, 0.6]]), [0.2, 0.55, 0.25]).map((v) => v + 2);
  paint(t, g, FURNACE);
  frame(t, FURNACE, 5, 1);
}

const FURNITURE_ART: Record<string, Recipe> = {
  // A worktop in a dark frame with a carved three-by-three grid, brass
  // corner caps, and a lighter board surface -- the grid is what says
  // "craft here" at a glance.
  crafting_top: (t) => {
    // One smooth slab rather than boards: seams under the grid made it
    // read as a lattice of lines rather than a surface with a grid on it.
    const rng = mulberry32(nameSeed('crafting_top'));
    const g = new Grid(3);
    for (let i = 0; i < 9; i++) {
      const x = (rng() * TILE) | 0;
      const y = (rng() * TILE) | 0;
      const len = 2 + ((rng() * 4) | 0);
      for (let k = 0; k < len; k++) g.set(x + k, y, i % 3 === 0 ? 4 : 2);
    }
    paint(t, g, PLANK);
    frame(t, PLANK, 2, 0);
    // The grid is cut into the top, so each groove's lower-right lip is lit.
    for (let i = 1; i < TILE - 1; i++) {
      for (const k of [5, 10]) {
        dot(t, k, i, PLANK[0]);
        dot(t, i, k, PLANK[0]);
      }
    }
    for (let i = 1; i < TILE - 1; i++) {
      for (const k of [5, 10]) {
        if (i !== 5 && i !== 10) {
          dot(t, k + 1, i, PLANK[4]);
          dot(t, i, k + 1, PLANK[4]);
        }
      }
    }
    const BRASS: Ramp = [[112, 78, 30], [178, 138, 52], [226, 190, 92]];
    for (const [x, y] of [[0, 0], [14, 0], [0, 14], [14, 14]]) {
      dot(t, x, y, BRASS[2]);
      dot(t, x + 1, y, BRASS[1]);
      dot(t, x, y + 1, BRASS[1]);
      dot(t, x + 1, y + 1, BRASS[0]);
    }
  },

  // The side: a worktop lip, corner legs, and a tool rack with a saw and a
  // hammer hanging on it. The tools are what make it a crafting table and
  // not a plank block with a border.
  crafting_side: (t) => {
    const g = new Grid(2);
    // Vertical boards behind the tools.
    for (let y = 0; y < TILE; y++) {
      for (const x of [5, 10]) g.set(x, y, 1);
    }
    paint(t, g, PLANK);
    for (let x = 0; x < TILE; x++) {
      dot(t, x, 0, PLANK[4]);
      dot(t, x, 1, PLANK[3]);
      dot(t, x, 2, PLANK[0]);
    }
    for (let y = 3; y < TILE; y++) {
      dot(t, 0, y, PLANK[3]);
      dot(t, 1, y, PLANK[2]);
      dot(t, 14, y, PLANK[2]);
      dot(t, 15, y, PLANK[1]);
    }
    for (let x = 2; x < 14; x++) dot(t, x, 3, PLANK[1]);   // shadow under the lip
    const HANDLE: Ramp = [[74, 46, 26], [120, 80, 44], [158, 112, 64]];
    // Saw: a wooden handle with a grip hole, a pale blade, teeth down one side.
    for (const [x, y] of [[3, 4], [4, 4], [5, 4], [3, 5], [5, 5], [3, 6], [4, 6], [5, 6]]) {
      dot(t, x, y, HANDLE[y === 4 ? 2 : 1]);
    }
    dot(t, 4, 5, HANDLE[0]);
    for (let y = 7; y < 13; y++) {
      dot(t, 3, y, METAL[4]);
      dot(t, 4, y, METAL[3]);
      if (y < 12) dot(t, 5, y, y % 2 ? METAL[3] : METAL[1]);
    }
    dot(t, 3, 13, METAL[3]);
    dot(t, 4, 13, METAL[1]);
    // Hammer: a square iron head on a straight handle.
    for (let x = 8; x < 13; x++) {
      dot(t, x, 5, METAL[4]);
      dot(t, x, 6, METAL[2]);
    }
    dot(t, 8, 6, METAL[3]);
    dot(t, 12, 5, METAL[3]);
    for (let y = 7; y < 14; y++) {
      dot(t, 10, y, HANDLE[2]);
      dot(t, 11, y, HANDLE[0]);
    }
    // The pegs they hang from.
    dot(t, 4, 3, PLANK[0]);
    dot(t, 10, 4, HANDLE[0]);
  },

  furnace_top: (t) => {
    furnaceStone(t, nameSeed('furnace_top'));
    // A sooty flue grate in the middle, so the top reads as the top of
    // something that burns.
    for (let y = 5; y <= 10; y++) {
      for (let x = 5; x <= 10; x++) {
        const edge = x === 5 || y === 5 || x === 10 || y === 10;
        dot(t, x, y, edge ? FURNACE[1] : (x % 2 ? [30, 26, 28] : FURNACE[0]));
      }
    }
    for (let i = 5; i <= 10; i++) {
      dot(t, i, 11, FURNACE[5]);
      dot(t, 11, i, FURNACE[5]);
    }
  },

  // An arched firebox with a hearth of embers and flames licking up out of
  // it, a stone lintel over the mouth and a vent slot above.
  furnace_front: (t) => {
    furnaceStone(t, nameSeed('furnace_front'));
    const DARK: RGB = [28, 22, 24];
    // The mouth, with its arch.
    for (let y = 7; y < 14; y++) {
      for (let x = 3; x < 13; x++) {
        if (y === 7 && (x === 3 || x === 12)) continue;
        dot(t, x, y, DARK);
      }
    }
    // Rim of the opening: in shadow along the top and left inside, lit on
    // the lower lip.
    for (let x = 4; x < 12; x++) dot(t, x, 6, FURNACE[1]);
    dot(t, 3, 6, FURNACE[2]);
    dot(t, 12, 6, FURNACE[2]);
    for (let x = 3; x < 13; x++) dot(t, x, 14, FURNACE[5]);
    // Fire: embers along the hearth, flames rising from them.
    const FIRE: Ramp = [[120, 30, 16], [204, 78, 22], [244, 144, 40], [255, 206, 92], [255, 244, 190]];
    for (let x = 3; x < 13; x++) dot(t, x, 13, FIRE[x % 3 === 0 ? 1 : 2]);
    for (const [x, y, l] of [
      [4, 12, 2], [5, 12, 3], [6, 12, 2], [7, 12, 3], [8, 12, 3], [9, 12, 2], [10, 12, 3], [11, 12, 2],
      [5, 11, 2], [7, 11, 3], [8, 11, 4], [10, 11, 2],
      [7, 10, 2], [8, 10, 3], [5, 10, 1], [10, 10, 1],
      [8, 9, 2],
    ]) dot(t, x, y, FIRE[l]);
    // The vent above the mouth: dark slots between stone bars.
    for (let x = 5; x < 11; x++) dot(t, x, 3, x % 2 ? DARK : FURNACE[1]);
    for (let x = 5; x < 11; x++) dot(t, x, 4, FURNACE[5]);
  },

  // Chest lid from above: three boards held in an iron band with capped
  // corners.
  chest_top: (t) => {
    const CHEST: Ramp = [[60, 36, 26], [104, 68, 38], [136, 94, 52], [160, 116, 66], [182, 138, 82]];
    const g = new Grid(2);
    for (const y of [5, 10]) for (let x = 0; x < TILE; x++) g.set(x, y, 0);
    for (const y of [1, 6, 11]) for (let x = 0; x < TILE; x++) g.set(x, y, 3);
    const rng = mulberry32(nameSeed('chest_top'));
    for (let i = 0; i < 8; i++) {
      const y = [2, 3, 4, 7, 8, 9, 12, 13][i];
      const x = (rng() * TILE) | 0;
      for (let k = 0; k < 4; k++) g.set(x + k, y, i % 2 ? 1 : 3);
    }
    paint(t, g, CHEST);
    frame(t, METAL, 3, 1);
    for (const [x, y] of [[0, 0], [14, 0], [0, 14], [14, 14]]) {
      dot(t, x, y, METAL[4]);
      dot(t, x + 1, y, METAL[3]);
      dot(t, x, y + 1, METAL[3]);
      dot(t, x + 1, y + 1, METAL[2]);
    }
  },

  // Chest front: the lid over the body with a dark gap between them, and a
  // latch straddling the gap. Every side shows it, so any face tells you
  // this opens.
  chest_side: (t) => {
    const CHEST: Ramp = [[60, 36, 26], [104, 68, 38], [136, 94, 52], [160, 116, 66], [182, 138, 82]];
    const g = new Grid(2);
    for (let x = 0; x < TILE; x++) {
      g.set(x, 1, 3);
      g.set(x, 5, 1);
      g.set(x, 6, 0);
      g.set(x, 7, 3);
      g.set(x, 11, 0);
      g.set(x, 12, 3);
    }
    const rng = mulberry32(nameSeed('chest_side'));
    for (let i = 0; i < 6; i++) {
      const y = [2, 3, 8, 9, 13, 14][i];
      const x = (rng() * TILE) | 0;
      for (let k = 0; k < 4; k++) g.set(x + k, y, i % 2 ? 1 : 3);
    }
    paint(t, g, CHEST);
    frame(t, METAL, 3, 1);
    for (const [x, y] of [[0, 0], [14, 0], [0, 14], [14, 14]]) {
      dot(t, x, y, METAL[4]);
      dot(t, x + 1, y, METAL[3]);
      dot(t, x, y + 1, METAL[3]);
      dot(t, x + 1, y + 1, METAL[2]);
    }
    const GOLD: Ramp = [[96, 66, 20], [176, 136, 44], [230, 196, 86], [252, 234, 150]];
    for (let y = 5; y <= 9; y++) {
      dot(t, 7, y, GOLD[y === 5 ? 3 : 2]);
      dot(t, 8, y, GOLD[1]);
    }
    dot(t, 7, 7, GOLD[0]);
    dot(t, 8, 7, GOLD[0]);
    dot(t, 7, 10, GOLD[0]);
    dot(t, 8, 10, GOLD[0]);
  },

  // Bed from above: a plump pillow at the head, the blanket turned down
  // under it with a white sheet showing, and a quilted blanket over the rest.
  bed_top: (t) => {
    const RED: Ramp = [[92, 22, 36], [140, 34, 40], [178, 48, 48], [206, 72, 62]];
    const WHITE: Ramp = [[150, 150, 170], [196, 198, 210], [226, 228, 234], [246, 246, 248]];
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (y < 6) {
          const pillow = x >= 2 && x <= 13 && y >= 1 && y <= 4;
          const edge = x === 2 || x === 13 || y === 1 || y === 4;
          let level = pillow ? (edge ? 2 : 3) : 1;
          if (pillow && (x === 13 || y === 4)) level = 1;
          dot(t, x, y, WHITE[level]);
        } else if (y < 8) {
          dot(t, x, y, WHITE[y === 6 ? 3 : 2]);      // the turned-down sheet
        } else {
          // Quilting: a loose diamond of running stitches across the blanket.
          const onLine = (x + y) % 6 === 0 || (x - y + 18) % 6 === 0;
          const stitch = onLine && x % 2 === 0;
          dot(t, x, y, RED[y === 8 ? 3 : stitch ? 1 : 2]);
        }
      }
    }
    for (let x = 0; x < TILE; x++) dot(t, x, 5, WHITE[0]);
  },

  // Bed from the side: blanket hanging over the mattress edge, the frame
  // under it and a stubby leg at each end.
  bed_side: (t) => {
    const RED: Ramp = [[92, 22, 36], [140, 34, 40], [178, 48, 48], [206, 72, 62]];
    const WHITE: Ramp = [[150, 150, 170], [196, 198, 210], [226, 228, 234], [246, 246, 248]];
    const FRAME: Ramp = [[66, 42, 30], [110, 76, 46], [144, 106, 64], [170, 130, 82]];
    for (let x = 0; x < TILE; x++) {
      for (let y = 0; y < TILE; y++) {
        let c: RGB;
        if (y < 9) c = RED[y === 0 ? 3 : y === 8 ? 1 : 2];
        else if (y < 11) c = WHITE[y === 9 ? 2 : 1];
        else if (y < 13) c = FRAME[y === 11 ? 3 : 2];
        else if (x <= 2 || x >= 13) c = FRAME[x === 0 || x === 13 ? 2 : 1];
        else c = y === 13 ? FRAME[0] : [44, 30, 30];    // the shadow under the bed
        dot(t, x, y, c);
      }
    }
    // Folds in the hanging blanket.
    for (const x of [4, 9, 13]) for (let y = 2; y < 8; y++) dot(t, x, y, RED[1]);
    for (const x of [5, 10, 14]) for (let y = 2; y < 8; y++) dot(t, x, y, RED[3]);
  },
};

// --- the nether and the end ----------------------------------------------

const NETHERRACK: Ramp = [
  [50, 14, 28], [82, 24, 34], [110, 36, 40], [136, 54, 52], [162, 82, 72],
];

const OBSIDIAN: Ramp = [
  [8, 6, 16], [20, 14, 34], [34, 24, 56], [54, 38, 88], [90, 64, 134], [150, 124, 200],
];

const END_STONE: Ramp = [
  [124, 130, 110], [174, 176, 130], [206, 205, 150], [224, 222, 166], [244, 242, 186],
];

const END_TEAL: Ramp = [[26, 52, 54], [44, 82, 76], [66, 114, 98], [96, 148, 122], [134, 182, 150]];

const PURPUR: Ramp = [
  [92, 58, 104], [126, 86, 134], [152, 110, 158], [174, 134, 178], [198, 164, 200],
];

/** The end stone surface, on END_STONE: pale, softly mottled, pocked with pits. */
function endStoneLevels(seed: number, pits: number): Grid {
  const rng = mulberry32(seed);
  const g = bands(noiseField(seed, [[4, 1], [8, 0.6]]), [0.25, 0.5, 0.25]).map((v) => v + 1);
  // Pits are dents, so their lighting is the reverse of a bump's: the
  // upper-left inside wall is in shadow and the lower-right one is lit.
  for (let i = 0; i < pits; i++) {
    const x = (rng() * TILE) | 0;
    const y = (rng() * TILE) | 0;
    const big = rng() < 0.4;
    g.set(x, y, 0);
    if (big) {
      g.set(x + 1, y, 0);
      g.set(x, y + 1, 1);
      g.set(x + 1, y + 1, 1);
      g.set(x + 2, y + 1, 4);
      g.set(x + 1, y + 2, 4);
    } else {
      g.set(x + 1, y + 1, 4);
    }
  }
  return g;
}

const DIMENSION_ART: Record<string, Recipe> = {
  // Raw, fleshy rock: drifts of colour with lit rims and a few dark cracks
  // snaking through.
  netherrack: (t) => {
    const rng = mulberry32(nameSeed('netherrack'));
    // Fine-grained like stone, for the same reason: the nether is walls of
    // this in every direction, and one big blotch per tile would stamp a
    // visible grid across all of them.
    const g = bands(noiseField(nameSeed('netherrack'), [[8, 1], [16, 0.6], [4, 0.45]]),
      [0.06, 0.28, 0.36, 0.22, 0.08]);
    const light = emboss(g);
    const out = g.map((v, x, y) => (v >= 2 && light.get(x, y) > 0 ? Math.min(4, v + 1) : v));
    for (let i = 0; i < 3; i++) {
      let x = (rng() * TILE) | 0;
      let y = (rng() * TILE) | 0;
      for (let k = 0; k < 4; k++) {
        out.set(x, y, k === 0 || k === 3 ? 1 : 0);
        out.set(x + 1, y + 1, Math.min(4, out.get(x + 1, y + 1) + 1));
        if (rng() < 0.5) x++;
        else y++;
      }
    }
    paint(t, out, NETHERRACK);
  },

  // Dull grey-brown sand full of sunken hollows. The hollows are dents, lit
  // on their lower-right inside wall, which is what makes them read as holes
  // rather than dark spots.
  soul_sand: (t) => {
    const SOUL: Ramp = [[34, 24, 24], [58, 42, 36], [82, 62, 50], [102, 80, 64], [124, 102, 82]];
    const rng = mulberry32(nameSeed('soul_sand'));
    const g = bands(noiseField(nameSeed('soul_sand'), [[8, 1], [16, 0.6]]), [0.25, 0.5, 0.25])
      .map((v) => v + 1);
    for (const [hx, hy] of [[2, 2], [9, 1], [5, 8], [12, 10], [1, 12]]) {
      const w = 2 + ((rng() * 2) | 0);
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < w; x++) g.set(hx + x, hy + y, y === 0 || x === 0 ? 0 : 1);
      }
      for (let x = 1; x <= w; x++) g.set(hx + x, hy + 2, 4);
      g.set(hx + w, hy + 1, 4);
    }
    paint(t, g, SOUL);
  },

  // Volcanic glass: dark shards split by hairline fractures, each shard
  // lit along its upper-left edge, with a purple glint or two where the
  // light catches it square.
  obsidian: (t) => {
    const rng = mulberry32(nameSeed('obsidian'));
    const pts = jittered(rng, 3, 3, 0.9);
    const { owner, margin } = voronoi(pts);
    const gap = (x: number, y: number): boolean => margin[wrap(y) * TILE + wrap(x)] < 0.5;
    const light = pieceLight(owner, gap);
    const tone = pts.map(() => 1 + ((rng() * 2) | 0));
    // Glass is all highlight or nothing: a lit edge jumps two levels, a
    // shadowed one only drops one.
    const g = new Grid().map((_, x, y) => {
      if (gap(x, y)) return 0;
      const l = light.get(x, y);
      return tone[owner[y * TILE + x]] + (l > 0 ? 2 : l);
    });
    for (let i = 0; i < 3; i++) {
      const x = (rng() * TILE) | 0;
      const y = (rng() * TILE) | 0;
      if (g.get(x, y) >= 3) g.set(x, y, 5);
    }
    paint(t, g, OBSIDIAN);
  },

  // Small, dark, tightly laid bricks with near-black joints -- smaller and
  // more irregular than overworld brick, so the two never look alike.
  nether_brick: (t) => {
    brickwork(t, nameSeed('nether_brick'),
      [[40, 14, 22], [62, 22, 30], [84, 32, 40], [106, 46, 52], [132, 66, 70]],
      [[18, 8, 14], [26, 12, 18], [40, 18, 26]],
      [5, 5, 6], 4, 3);
  },

  // A curtain of energy: bands of violet warped into slow swirls, see-through.
  portal: (t) => {
    const PORTAL: Ramp = [[46, 12, 96], [78, 26, 146], [112, 48, 192], [152, 86, 228], [204, 150, 252]];
    const warpA = noiseField(nameSeed('portal'), [[4, 1], [8, 0.5]]);
    const warpB = noiseField(nameSeed('portal') + 17, [[4, 1], [8, 0.5]]);
    // Diagonal bands, pushed around by two noise fields. The band repeats
    // every 8 across and 16 down -- both divide the tile, so it still wraps.
    const field = new Grid().map((_, x, y) => {
      const u = (x + warpA.get(x, y) * 7) / 8;
      const v = (y + warpB.get(x, y) * 7) / 16;
      return Math.sin((u + v) * Math.PI * 2);
    });
    paint(t, bands(field, [0.14, 0.26, 0.3, 0.2, 0.1]), PORTAL, 210);
  },

  end_stone: (t) => {
    paint(t, endStoneLevels(nameSeed('end_stone'), 7), END_STONE);
  },

  // The frame's top: a teal-green rim around an empty socket, sunk into
  // end stone.
  end_frame_top: (t) => {
    paint(t, endStoneLevels(nameSeed('end_frame_top'), 3), END_STONE);
    endFrameRim(t);
    endSocket(t, false);
  },

  // The frame's side: a band of the teal-green rim over end stone, with
  // notches cut into it.
  end_frame_side: (t) => {
    paint(t, endStoneLevels(nameSeed('end_frame_side'), 4), END_STONE);
    for (let x = 0; x < TILE; x++) {
      dot(t, x, 0, END_TEAL[4]);
      dot(t, x, 1, END_TEAL[3]);
      dot(t, x, 2, END_TEAL[2]);
      dot(t, x, 3, END_TEAL[1]);
      dot(t, x, 4, END_STONE[0]);
    }
    for (const x of [2, 7, 12]) {
      dot(t, x, 1, END_TEAL[0]);
      dot(t, x + 1, 1, END_TEAL[0]);
      dot(t, x, 2, END_TEAL[0]);
      dot(t, x + 1, 2, END_TEAL[4]);
    }
  },

  end_frame_eye: (t) => {
    paint(t, endStoneLevels(nameSeed('end_frame_top'), 3), END_STONE);
    endFrameRim(t);
    endSocket(t, true);
  },

  // The void between stars: near-black, a few faint clouds of violet, and a
  // scatter of stars -- the brightest with a small cross of light.
  end_portal: (t) => {
    const SKY: Ramp = [[6, 6, 20], [16, 12, 44], [34, 24, 82], [60, 46, 124]];
    const rng = mulberry32(nameSeed('end_portal'));
    const clouds = bands(noiseField(nameSeed('end_portal'), [[4, 1], [8, 0.5]]), [0.55, 0.25, 0.14, 0.06]);
    paint(t, clouds, SKY, 240);
    for (let i = 0; i < 9; i++) {
      const x = (rng() * TILE) | 0;
      const y = (rng() * TILE) | 0;
      const bright = i < 3;
      dot(t, x, y, bright ? [236, 240, 255] : [150, 170, 220], 240);
      if (!bright) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) dot(t, x + dx, y + dy, [96, 104, 176], 240);
    }
  },

  // Cut purple stone laid as four square tiles, each bevelled and with a
  // raised pad in its middle.
  purpur: (t) => {
    const rng = mulberry32(nameSeed('purpur'));
    const g = new Grid(2);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const lx = x % 8;
        const ly = y % 8;
        let v = 2;
        if (lx === 7 || ly === 7) v = 0;
        else if (lx === 0 || ly === 0) v = 4;
        else if (lx === 6 || ly === 6) v = 1;
        else if (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4) v = lx === 2 || ly === 2 ? 3 : 2;
        else if ((lx === 5 && ly >= 2 && ly <= 5) || (ly === 5 && lx >= 2 && lx <= 5)) v = 1;
        if (v === 2 && rng() < 0.12) v = rng() < 0.5 ? 1 : 3;
        g.set(x, y, v);
      }
    }
    paint(t, g, PURPUR);
  },
};

/** The End frame's teal-green rim, two units wide and bevelled. */
function endFrameRim(t: Tile): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const edge = Math.min(x, y, TILE - 1 - x, TILE - 1 - y);
      if (edge > 1) continue;
      const lit = (x <= 1 && y < TILE - 1 - edge) || (y <= 1 && x < TILE - 1 - edge);
      dot(t, x, y, END_TEAL[edge === 0 ? (lit ? 4 : 1) : (lit ? 3 : 2)]);
    }
  }
}

/** The socket in the frame's top, empty or holding its eye. */
function endSocket(t: Tile, filled: boolean): void {
  for (let y = 4; y <= 11; y++) {
    for (let x = 4; x <= 11; x++) {
      const corner = (x === 4 || x === 11) && (y === 4 || y === 11);
      if (corner) continue;
      const rim = x === 4 || y === 4 || x === 11 || y === 11;
      if (rim) dot(t, x, y, x === 4 || y === 4 ? END_TEAL[0] : END_TEAL[3]);
      else dot(t, x, y, [18, 30, 32]);
    }
  }
  if (!filled) return;
  const EYE: Ramp = [[20, 70, 60], [38, 120, 96], [70, 170, 126], [150, 220, 170], [226, 250, 214]];
  for (let y = 5; y <= 10; y++) {
    for (let x = 5; x <= 10; x++) {
      const corner = (x === 5 || x === 10) && (y === 5 || y === 10);
      if (corner) continue;
      const d = x + y;
      dot(t, x, y, EYE[d <= 12 ? 3 : d >= 18 ? 1 : 2]);
    }
  }
  // A slit pupil and a highlight.
  for (let y = 6; y <= 9; y++) dot(t, 8, y, EYE[0]);
  dot(t, 7, 7, [16, 36, 34]);
  dot(t, 7, 8, [16, 36, 34]);
  dot(t, 6, 6, EYE[4]);
}

// --- machines ------------------------------------------------------------
//
// Machines keep the look they already had: a player has learned to read a
// conveyor's arrow or a battery's charge bars, and those are drawn as hard
// geometry over dark metal rather than as a material, so they sit outside
// the pixel-art kit above.

/** The belt surface every conveyor variant shares. */
function beltBase(t: Tile): Tile {
  t.fill([64, 64, 70], 5).patches(8, [52, 52, 58], 6, 3).posterize(9);
  for (let y = 1; y < TILE; y += 4) t.blot(0, y, TILE, 2, [92, 92, 100], 4);
  for (let y = 2; y < TILE; y += 4) t.blot(0, y, TILE, 1, [40, 40, 46], 3);
  return t.border([36, 36, 42]);
}

/**
 * A conveyor top with an arrow pointing the way it carries.
 *
 * Direction lives in the block id, so the only way a player can tell which
 * way a belt runs is by looking at it -- the arrow is load-bearing, not
 * decoration.
 */
function conveyorTile(dx: number, dz: number) {
  return (t: Tile) => {
    beltBase(t);
    const gold: RGB = [206, 182, 62];
    const dark: RGB = [70, 60, 18];
    // Draw the arrow pointing +Y (south//down-screen), then rotate the
    // finished shape into place, so all four share one definition.
    const shaft: Array<[number, number, number, number]> = [
      [7, 3, 2, 8],        // stem
      [5, 9, 6, 2],        // head shoulders
      [6, 11, 4, 1],
      [7, 12, 2, 1],       // tip
    ];
    const put = (x: number, y: number, w: number, h: number, c: RGB) => {
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          // Rotate about the tile centre to match (dx, dz).
          const cx = xx - 7.5;
          const cy = yy - 7.5;
          // The base arrow points +Y in tile space, which on a top face is
          // +Z, i.e. south. Rotate from there.
          let rx = cx;
          let ry = cy;
          if (dx === 1 && dz === 0) { rx = cy; ry = -cx; }         // east: +X
          else if (dx === 0 && dz === -1) { rx = -cx; ry = -cy; }  // north: -Z
          else if (dx === -1 && dz === 0) { rx = -cy; ry = cx; }   // west: -X
          t.set(Math.round(rx + 7.5), Math.round(ry + 7.5), c[0], c[1], c[2]);
        }
      }
    };
    for (const [x, y, w, h] of shaft) put(x + 1, y + 1, w, h, dark);
    for (const [x, y, w, h] of shaft) put(x, y, w, h, gold);
  };
}

const MACHINE_ART: Record<string, Recipe> = {
  // Machines read as machines through hard geometry -- panel, rivets, a
  // direction -- rather than through a decorative repeating lattice.
  conveyor: (t) => beltBase(t),

  collector_top: (t) => {
    t.fill([64, 64, 70], 5).patches(8, [52, 52, 58], 6, 3).posterize(9);
    t.border([36, 36, 42]);
    // A funnel: concentric rings stepping inward.
    t.rect(2, 2, 12, 12, [88, 88, 96]);
    t.rect(4, 4, 8, 8, [56, 56, 62]);
    t.rect(6, 6, 4, 4, [30, 30, 34]);
  },
  collector_side: (t) => {
    t.fill([64, 64, 70], 5).patches(8, [52, 52, 58], 6, 3).posterize(9);
    t.border([36, 36, 42]);
    t.rect(2, 3, 12, 3, [88, 88, 96]);    // wide mouth
    t.rect(5, 6, 6, 4, [46, 46, 52]);     // tapering
    t.rect(6, 10, 4, 4, [30, 30, 34]);    // spout
  },
  stonegen_top: (t) => {
    t.fill([74, 76, 86], 4).patches(8, [60, 62, 72], 5, 3).posterize(10);
    t.border([42, 44, 52]);
    t.disc(7.5, 7.5, 4.6, [128, 128, 132], 6);   // the cast stone forming
    t.disc(7.5, 7.5, 2.6, [96, 96, 100], 5);
    t.rect(6, 1, 4, 2, [96, 140, 200], 6);       // water inlet
    t.rect(6, 13, 4, 2, [206, 96, 40], 6);       // lava inlet
  },
  stonegen_side: (t) => {
    t.fill([74, 76, 86], 4).patches(8, [60, 62, 72], 5, 3).posterize(10);
    t.border([42, 44, 52]);
    t.rect(1, 5, 5, 6, [96, 140, 200], 6);       // water side
    t.rect(10, 5, 5, 6, [206, 96, 40], 6);       // lava side
    t.rect(6, 4, 4, 8, [128, 128, 132], 6);      // stone cast between them
    t.rect(6, 4, 4, 1, [160, 160, 164], 4);
  },
  efurnace_top: (t) => {
    t.fill([70, 74, 86], 4).patches(8, [58, 62, 72], 5, 3).posterize(10);
    t.border([40, 42, 50]);
    t.rect(3, 3, 10, 10, [44, 48, 60], 4);
    t.rect(5, 5, 6, 6, [122, 214, 234], 7);      // element glow
    t.rect(6, 6, 4, 4, [200, 244, 252], 5);
  },
  efurnace_side: (t) => {
    t.fill([70, 74, 86], 4).patches(8, [58, 62, 72], 5, 3).posterize(10);
    t.border([40, 42, 50]);
    t.rect(3, 6, 10, 7, [40, 44, 56], 4);        // chamber
    t.rect(4, 8, 8, 3, [122, 214, 234], 8);      // coils, not flame
    t.rect(4, 10, 8, 1, [86, 168, 194], 5);
    t.rect(4, 2, 8, 3, [150, 150, 158], 5);
    for (let x = 5; x < 12; x += 2) t.rect(x, 2, 1, 3, [70, 70, 76]);
  },
  sawmill_top: (t) => {
    t.fill([120, 92, 56], 5).patches(8, [100, 76, 46], 5, 3).posterize(10);
    t.border([70, 52, 30]);
    t.rect(7, 0, 2, TILE, [186, 186, 194], 5);   // the blade, edge on
    for (let y = 0; y < TILE; y += 3) t.rect(6, y, 1, 2, [220, 220, 228]);
    t.rect(2, 5, 3, 6, [150, 112, 66], 5);       // the log being cut
    t.rect(11, 5, 3, 6, [150, 112, 66], 5);
  },
  sawmill_side: (t) => {
    t.fill([120, 92, 56], 5).patches(8, [100, 76, 46], 5, 3).posterize(10);
    t.border([70, 52, 30]);
    t.disc(8, 7, 5.0, [186, 186, 194], 5);       // circular blade
    t.disc(8, 7, 3.2, [120, 92, 56], 4);
    for (let i = 0; i < 10; i++) {               // teeth
      const a = (i / 10) * Math.PI * 2;
      t.rect(Math.round(8 + Math.cos(a) * 5.2), Math.round(7 + Math.sin(a) * 5.2),
        1, 1, [232, 232, 240]);
    }
    t.rect(0, 12, TILE, 4, [96, 72, 44], 5);     // bench
  },
  compressor_top: (t) => {
    t.fill([68, 70, 80], 4).patches(8, [56, 58, 68], 5, 3).posterize(10);
    t.border([38, 40, 48]);
    t.rect(3, 3, 10, 10, [150, 150, 158], 5);    // the ram face
    t.rect(5, 5, 6, 6, [92, 94, 104], 5);
    t.rect(6, 6, 4, 4, [50, 52, 60], 4);
  },
  compressor_side: (t) => {
    t.fill([68, 70, 80], 4).patches(8, [56, 58, 68], 5, 3).posterize(10);
    t.border([38, 40, 48]);
    t.rect(4, 1, 8, 4, [150, 150, 158], 5);      // ram
    t.rect(6, 5, 4, 3, [110, 112, 122], 4);      // piston rod
    t.rect(2, 8, 12, 3, [50, 52, 60], 4);        // anvil
    t.rect(2, 11, 12, 2, [178, 150, 54], 5);     // hazard band
    for (let x = 3; x < 14; x += 3) t.rect(x, 11, 1, 2, [60, 52, 20]);
  },
  quarry_top: (t) => {
    t.fill([66, 68, 78], 4).patches(8, [54, 56, 66], 5, 3).posterize(10);
    t.border([36, 38, 46]);
    // A gantry frame, which is what a quarry reads as from above.
    t.rect(1, 1, 14, 2, [178, 150, 54], 5);
    t.rect(1, 13, 14, 2, [178, 150, 54], 5);
    t.rect(1, 1, 2, 14, [178, 150, 54], 5);
    t.rect(13, 1, 2, 14, [178, 150, 54], 5);
    t.rect(6, 6, 4, 4, [150, 150, 158], 5);      // the head
    t.rect(7, 7, 2, 2, [40, 42, 50], 3);
  },
  quarry_side: (t) => {
    t.fill([66, 68, 78], 4).patches(8, [54, 56, 66], 5, 3).posterize(10);
    t.border([36, 38, 46]);
    t.rect(1, 1, 14, 2, [178, 150, 54], 5);      // top rail
    t.rect(2, 3, 2, 10, [110, 112, 122], 4);     // legs
    t.rect(12, 3, 2, 10, [110, 112, 122], 4);
    t.rect(6, 3, 4, 7, [150, 150, 158], 5);      // drill head on its cable
    t.rect(7, 10, 2, 4, [96, 96, 104], 4);
    t.rect(7, 14, 2, 2, [60, 62, 70], 3);
  },
  waterwheel_top: (t) => {
    t.fill([132, 100, 60], 5).patches(8, [110, 82, 48], 5, 3).posterize(10);
    t.border([76, 56, 32]);
    t.rect(7, 0, 2, TILE, [150, 150, 158], 5);   // axle
    for (let y = 1; y < TILE; y += 4) t.rect(2, y, 12, 2, [150, 112, 66], 5);
  },
  waterwheel_side: (t) => {
    t.fill([96, 140, 200], 6, 200);              // water showing through
    t.disc(8, 8, 7.2, [150, 112, 66], 6);        // wheel
    t.disc(8, 8, 5.4, [96, 140, 200], 6);
    for (let i = 0; i < 8; i++) {                // paddles
      const a = (i / 8) * Math.PI * 2;
      t.rect(Math.round(8 + Math.cos(a) * 6 - 1), Math.round(8 + Math.sin(a) * 6 - 1),
        2, 2, [124, 92, 54], 5);
    }
    t.disc(8, 8, 1.8, [150, 150, 158], 4);       // hub
  },
  // Booster: a pressure vessel with a gauge, glowing when live.
  booster_top: (t) => {
    t.fill([72, 74, 84], 4).patches(8, [58, 60, 70], 5, 3).posterize(10);
    t.border([40, 42, 50]);
    t.disc(7.5, 7.5, 4.6, [128, 132, 146], 5);
    t.disc(7.5, 7.5, 3.0, [40, 44, 54], 4);
    t.disc(7.5, 7.5, 1.6, [122, 214, 234], 6);   // the nV glow
  },
  booster_side: (t) => {
    t.fill([72, 74, 84], 4).patches(8, [58, 60, 70], 5, 3).posterize(10);
    t.border([40, 42, 50]);
    t.rect(2, 4, 12, 8, [50, 54, 64], 4);        // vessel
    t.rect(3, 5, 10, 2, [122, 214, 234], 7);     // charge window
    t.rect(3, 8, 10, 1, [96, 168, 190], 5);
    t.rect(1, 6, 1, 4, [150, 150, 158], 4);      // inlet and outlet
    t.rect(14, 6, 1, 4, [150, 150, 158], 4);
    t.rect(6, 12, 4, 2, [186, 160, 52], 5);      // gauge
  },
  solar_top: (t) => {
    t.fill([28, 34, 58], 4).posterize(10);
    // A grid of dark blue cells with a lit strip along each -- the pattern
    // is what makes it read as a panel rather than a slab of glass.
    for (let y = 1; y < 15; y += 4) {
      for (let x = 1; x < 15; x += 4) {
        t.rect(x, y, 3, 3, [42, 62, 118], 6);
        t.rect(x, y, 3, 1, [78, 118, 190], 5);
      }
    }
    t.border([120, 124, 136]);
  },
  solar_side: (t) => {
    t.fill([96, 100, 112], 4).patches(8, [80, 84, 94], 5, 3).posterize(10);
    t.rect(0, 2, TILE, 3, [42, 62, 118], 5);   // the panel edge-on
    t.rect(0, 2, TILE, 1, [92, 132, 200], 4);
    t.border([56, 58, 66]);
  },
  battery_top: (t) => {
    t.fill([64, 66, 74], 4).patches(8, [52, 54, 62], 5, 3).posterize(10);
    t.border([36, 38, 44]);
    t.rect(3, 4, 4, 8, [186, 160, 52], 5);     // terminals
    t.rect(9, 4, 4, 8, [150, 150, 158], 5);
    t.rect(4, 6, 2, 4, [232, 208, 96], 4);
  },
  battery_side: (t) => {
    t.fill([64, 66, 74], 4).patches(8, [52, 54, 62], 5, 3).posterize(10);
    t.border([36, 38, 44]);
    t.rect(2, 2, 12, 10, [42, 44, 50], 4);     // cell body
    // Charge bars, the readable "this is a battery" cue.
    for (let i = 0; i < 3; i++) t.rect(4, 4 + i * 3, 8, 2, [120, 206, 96], 6);
    t.rect(6, 0, 4, 2, [186, 160, 52], 4);     // top terminal
  },
  elevator_top: (t) => {
    // Open shaft: a frame with nothing in the middle, since items pass through.
    t.rect(0, 0, TILE, 3, [104, 108, 120], 5);
    t.rect(0, 13, TILE, 3, [104, 108, 120], 5);
    t.rect(0, 0, 3, TILE, [104, 108, 120], 5);
    t.rect(13, 0, 3, TILE, [104, 108, 120], 5);
    t.rect(3, 3, 10, 10, [58, 132, 96], 40);   // the lift field
    t.border([50, 52, 60]);
  },
  elevator_side: (t) => {
    t.fill([88, 92, 102], 4).patches(8, [72, 76, 86], 5, 3).posterize(10);
    t.border([48, 50, 58]);
    // Upward chevrons, so the direction of travel is obvious.
    for (let y = 1; y < 15; y += 5) {
      t.rect(6, y, 4, 2, [120, 226, 140], 6);
      t.rect(4, y + 2, 3, 2, [120, 226, 140], 6);
      t.rect(9, y + 2, 3, 2, [120, 226, 140], 6);
    }
  },
  // Generator: a furnace-like firebox with a flywheel, so it reads as the
  // thing producing power rather than another storage box.
  generator_top: (t) => {
    t.fill([76, 76, 82], 4).patches(9, [62, 62, 68], 5, 3).posterize(9);
    t.border([40, 40, 46]);
    t.disc(7.5, 7.5, 4.4, [150, 150, 158], 6);   // flywheel
    t.disc(7.5, 7.5, 2.4, [70, 70, 76], 4);
    for (let i = 0; i < 4; i++) {                // spokes
      const a = (i * Math.PI) / 2 + 0.4;
      t.line(Math.round(7.5 + Math.cos(a) * 2), Math.round(7.5 + Math.sin(a) * 2),
        Math.round(7.5 + Math.cos(a) * 4), Math.round(7.5 + Math.sin(a) * 4),
        [186, 186, 194], 1);
    }
  },
  generator_side: (t) => {
    t.fill([76, 76, 82], 4).patches(9, [62, 62, 68], 5, 3).posterize(9);
    t.border([40, 40, 46]);
    t.rect(3, 7, 10, 6, [48, 42, 38], 4);        // firebox
    t.rect(4, 8, 8, 4, [28, 24, 22], 3);
    t.rect(4, 10, 8, 2, [214, 112, 34], 8);      // flames
    t.rect(5, 11, 6, 1, [248, 186, 66], 10);
    t.rect(4, 2, 8, 3, [150, 150, 158], 5);      // vent grille on top
    for (let x = 5; x < 12; x += 2) t.rect(x, 2, 1, 3, [70, 70, 76]);
  },
  // Crusher: opposed toothed rollers.
  crusher_top: (t) => {
    t.fill([70, 70, 76], 4).patches(9, [58, 58, 64], 5, 3).posterize(9);
    t.border([38, 38, 44]);
    t.rect(2, 4, 5, 8, [140, 140, 148], 5);      // rollers
    t.rect(9, 4, 5, 8, [140, 140, 148], 5);
    for (let y = 4; y < 12; y += 2) {            // teeth
      t.rect(6, y, 1, 1, [60, 60, 66]);
      t.rect(9, y + 1, 1, 1, [60, 60, 66]);
    }
    t.rect(7, 2, 2, 12, [40, 40, 46], 3);        // the gap between them
  },
  crusher_side: (t) => {
    t.fill([70, 70, 76], 4).patches(9, [58, 58, 64], 5, 3).posterize(9);
    t.border([38, 38, 44]);
    t.rect(2, 2, 12, 3, [96, 96, 104], 5);       // hopper mouth
    t.rect(4, 5, 8, 2, [44, 44, 50], 3);
    t.disc(5.5, 9.5, 2.6, [150, 150, 158], 5);   // roller ends
    t.disc(10.5, 9.5, 2.6, [150, 150, 158], 5);
    t.disc(5.5, 9.5, 1.0, [58, 58, 64], 3);
    t.disc(10.5, 9.5, 1.0, [58, 58, 64], 3);
    t.rect(5, 13, 6, 2, [178, 150, 54], 5);      // hazard band
  },
  miner_top: (t) => {
    t.fill([72, 72, 78], 5).patches(8, [58, 58, 64], 6, 3).posterize(9);
    t.border([38, 38, 44]);
    t.disc(7.5, 7.5, 4.5, [150, 150, 158], 8);   // drill collar
    t.disc(7.5, 7.5, 2.2, [58, 58, 64], 5);      // bore
  },
  miner_side: (t) => {
    t.fill([72, 72, 78], 5).patches(8, [58, 58, 64], 6, 3).posterize(9);
    t.border([38, 38, 44]);
    t.rect(3, 2, 10, 3, [188, 160, 54], 5);      // hazard stripe
    for (let x = 3; x < 13; x += 3) t.rect(x, 2, 1, 3, [60, 52, 20]);
    t.rect(6, 7, 4, 7, [150, 150, 158], 6);      // the bit
    t.rect(7, 12, 2, 3, [96, 96, 104], 4);
  },
  sorter: (t) => {
    t.fill([64, 64, 70], 5).patches(8, [52, 52, 58], 6, 3).posterize(4);
    t.border([36, 36, 42]);
    // A big arrow, readable at block size, so its direction is obvious.
    const gold: RGB = [206, 182, 62];
    t.rect(6, 3, 4, 7, gold);
    t.rect(3, 9, 10, 2, gold);
    t.rect(4, 11, 8, 1, gold);
    t.rect(6, 12, 4, 1, gold);
  },
  // --- logistics ---------------------------------------------------------
  //
  // Each one has to say what it does from directly above, since that is where
  // you stand while laying a line. A splitter fans, a filter gates, a tube
  // carries: the top faces spell that out rather than being decorated metal.

  splitter_top: (t) => {
    beltBase(t);
    const gold: RGB = [206, 182, 62];
    // One stem in, three arms out: the shape of what it does to a line.
    t.rect(7, 10, 2, 5, gold);
    t.rect(3, 8, 10, 2, gold);
    t.rect(3, 4, 2, 4, gold);
    t.rect(11, 4, 2, 4, gold);
    t.rect(7, 2, 2, 6, gold);
    t.rect(2, 3, 4, 1, gold);
    t.rect(10, 3, 4, 1, gold);
  },
  splitter_side: (t) => {
    beltBase(t);
    t.rect(0, 0, TILE, 3, [88, 88, 96], 4);
    t.blot(4, 5, 8, 6, [148, 130, 48], 5);
  },

  filter_top: (t) => {
    beltBase(t);
    // A grille across the belt: the thing the items have to get through.
    t.rect(2, 6, 12, 4, [176, 176, 186], 5);
    for (let x = 3; x < 13; x += 2) t.rect(x, 6, 1, 4, [58, 58, 66]);
    t.rect(2, 6, 12, 1, [214, 214, 224], 3);
  },
  filter_side: (t) => {
    beltBase(t);
    t.rect(1, 4, 14, 7, [120, 120, 130], 5);
    for (let x = 2; x < 15; x += 3) t.rect(x, 5, 1, 5, [52, 52, 60]);
  },

  tube: (t) => {
    // A glass pipe with a metal band, so cargo reads as travelling inside it.
    t.fill([70, 78, 88], 5).patches(7, [58, 66, 76], 6, 3).posterize(10);
    t.rect(4, 0, 8, TILE, [126, 148, 166], 6);      // the bore
    t.rect(4, 0, 1, TILE, [176, 200, 216], 4);      // lit edge
    t.rect(11, 0, 1, TILE, [78, 94, 110], 4);       // shadowed edge
    t.rect(0, 5, TILE, 3, [150, 150, 160], 5);      // band
    t.rect(0, 5, TILE, 1, [196, 196, 206], 3);
    t.border([40, 46, 54]);
  },

  incinerator_top: (t) => {
    t.fill([58, 52, 52], 5).patches(9, [46, 40, 40], 6, 3).posterize(6);
    t.border([32, 28, 28]);
    // An open mouth with fire in it: unmistakably where things go to die.
    t.rect(3, 3, 10, 10, [26, 20, 18], 4);
    t.blot(4, 8, 8, 4, [188, 78, 30], 6);
    t.blot(5, 10, 6, 3, [232, 148, 44], 5);
    t.blot(7, 11, 2, 2, [248, 214, 120], 3);
  },
  incinerator_side: (t) => {
    t.fill([58, 52, 52], 5).patches(9, [46, 40, 40], 6, 3).posterize(6);
    t.border([32, 28, 28]);
    t.rect(2, 2, 12, 3, [150, 62, 26], 5);          // hazard band
    for (let x = 3; x < 14; x += 3) t.rect(x, 2, 1, 3, [40, 26, 20]);
    t.rect(4, 8, 8, 5, [26, 20, 18], 4);            // vent
    t.blot(5, 10, 6, 2, [196, 92, 34], 5);
  },

  cable: (t) => {
    t.fill([52, 48, 56], 5).patches(8, [42, 38, 46], 6, 3).posterize(12);
    t.rect(0, 6, TILE, 4, [168, 118, 54], 6);   // copper run across the block
    t.rect(0, 6, TILE, 1, [206, 156, 84], 4);   // lit top edge
    t.rect(0, 9, TILE, 1, [112, 74, 34], 4);    // shadowed underside
    for (let x = 2; x < TILE; x += 5) t.blot(x, 5, 2, 6, [96, 96, 104], 5); // clamps
  },
};

export const BLOCK_ART: Record<string, Recipe> = {
  ...TERRAIN_ART, ...WOOD_ART, ...ORE_ART, ...GLOW_ART, ...MATERIAL_ART, ...FURNITURE_ART,
  ...DIMENSION_ART, ...MACHINE_ART,
};

BLOCK_ART.conveyor_n = conveyorTile(0, -1);
BLOCK_ART.conveyor_e = conveyorTile(1, 0);
BLOCK_ART.conveyor_s = conveyorTile(0, 1);
BLOCK_ART.conveyor_w = conveyorTile(-1, 0);
