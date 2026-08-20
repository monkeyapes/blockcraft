/**
 * Procedural texture atlas.
 *
 * Every texture is drawn from code at startup, so the game ships with no
 * image assets.
 *
 * Textures are *authored* on a 16-unit grid but *rendered* at TILE pixels,
 * so a shape stays where it was designed while grain, mottling and edge
 * lighting are applied at the finer resolution. That matters next to a 64x
 * resource pack: flat 16px surfaces sit beside crisp pack art and read as
 * untextured.
 */

import { allTextureNames } from '@shared/blocks.js';
import { allItemTextureNames } from '@shared/items.js';

/**
 * The grid generators draw on. Every shape below is specified in these
 * units, which is why raising the rendered resolution did not require
 * touching a single generator.
 */
const TILE = 16;
/**
 * Rendered resolution of one tile, in real pixels.
 *
 * Matched to a 64x resource pack. The generators author on the 16-unit grid
 * above regardless, but every surface treatment -- grain, mottling, edge
 * lighting, the silhouette outline -- runs at this resolution, so raising it
 * makes all of them four times finer at a stroke. It also means the built-in
 * art and a 64x pack are the same sharpness, so switching packs changes the
 * look without changing the focus.
 */
export const TILE_PX = 64;
/** Real pixels per authoring unit. */
const S = TILE_PX / TILE;

// Grew from 12 to 13 when the crack overlays landed, and to 14 when the
// power machines did -- both times the tile count had crept one past the
// grid. The blockart test asserts the invariant, so an overflow shows up as
// a failing check rather than as a crash at startup.
export const GRID = 14;
export const ATLAS_SIZE = TILE_PX * GRID;

type RGB = [number, number, number];

/**
 * Tileable value noise.
 *
 * The lattice wraps at `period`, so a texture drawn with it still meets its
 * own edges cleanly when the same block repeats across a wall.
 */
function makeNoise(seed: number) {
  const hash = (x: number, y: number): number => {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);

  /**
   * The lattice for a period only ever holds period*period distinct values,
   * but the sampler needs four of them per pixel. Hashing them afresh every
   * time made noise the dominant cost of building the atlas -- roughly
   * 25,000 hashes per tile for a cloth or hide surface. Build each lattice
   * once on first use and read from it instead.
   */
  const lattices = new Map<number, Float32Array>();
  const latticeFor = (period: number): Float32Array => {
    let grid = lattices.get(period);
    if (!grid) {
      grid = new Float32Array(period * period);
      for (let y = 0; y < period; y++) {
        for (let x = 0; x < period; x++) grid[y * period + x] = hash(x, y);
      }
      lattices.set(period, grid);
    }
    return grid;
  };

  return (x: number, y: number, rawPeriod: number): number => {
    // Callers pass real pixel coordinates, so the lattice spacing is in
    // rendered pixels, not authoring units.
    const period = Math.max(1, Math.round(rawPeriod));
    const grid = latticeFor(period);
    const fx = x / (TILE_PX / period);
    const fy = y / (TILE_PX / period);
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    // Wrapping is inlined rather than done through a local helper: this runs
    // once per pixel per octave -- tens of thousands of times per tile -- and
    // allocating a closure for it each time dominated the cost of building
    // the whole atlas.
    const x0 = ((ix % period) + period) % period;
    const y0 = ((iy % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = grid[y0 * period + x0];
    const b = grid[y0 * period + x1];
    const c = grid[y1 * period + x0];
    const d = grid[y1 * period + x1];
    const top = a + (b - a) * tx;
    return top + ((c + (d - c) * tx) - top) * ty;
  };
}

/** Deterministic PRNG so textures look the same every launch. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nameSeed(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

class Tile {
  readonly px = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  private readonly noise: (x: number, y: number, period: number) => number;

  constructor(readonly rng: () => number, seed = 1) {
    this.noise = makeNoise(seed);
  }

  // --- pixel access, in real pixels -------------------------------------

  private put(px: number, py: number, r: number, g: number, b: number, a: number): void {
    if (px < 0 || py < 0 || px >= TILE_PX || py >= TILE_PX) return;
    const i = (py * TILE_PX + px) * 4;
    this.px[i] = r;
    this.px[i + 1] = g;
    this.px[i + 2] = b;
    this.px[i + 3] = a;
  }

  /** Brightness delta on one real pixel, leaving alpha alone. */
  private shadePx(px: number, py: number, delta: number): void {
    if (px < 0 || py < 0 || px >= TILE_PX || py >= TILE_PX) return;
    const i = (py * TILE_PX + px) * 4;
    this.px[i] += delta;
    this.px[i + 1] += delta;
    this.px[i + 2] += delta;
  }

  // --- authoring-unit API, unchanged for callers -------------------------

  /** Sets one authoring unit, which covers S x S real pixels. */
  set(x: number, y: number, r: number, g: number, b: number, a = 255): void {
    const bx = Math.round(x * S);
    const by = Math.round(y * S);
    for (let dy = 0; dy < S; dy++) {
      for (let dx = 0; dx < S; dx++) this.put(bx + dx, by + dy, r, g, b, a);
    }
  }

  shade(x: number, y: number, delta: number): void {
    const bx = Math.round(x * S);
    const by = Math.round(y * S);
    for (let dy = 0; dy < S; dy++) {
      for (let dx = 0; dx < S; dx++) this.shadePx(bx + dx, by + dy, delta);
    }
  }

  /**
   * Base colour with coherent grain.
   *
   * Coherent noise rather than per-pixel randomness: white noise averages out
   * at a distance and leaves a flat colour, which is exactly how the old
   * wool and chrome ended up reading as blank white.
   */
  fill([r, g, b]: RGB, jitter = 12, alpha = 255): this {
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        // Two octaves: broad blotches plus a fine tooth.
        const coarse = this.noise(px, py, 4) - 0.5;
        const fine = this.noise(px + 37, py + 11, TILE_PX / 2) - 0.5;
        const d = (coarse * 1.3 + fine * 0.7) * jitter * 2;
        this.put(px, py, r + d, g + d, b + d, alpha);
      }
    }
    return this;
  }

  /** Adds coherent grain over whatever is already drawn. */
  grain(amount = 10, period = 8): this {
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        this.shadePx(px, py, (this.noise(px + 101, py + 53, period) - 0.5) * amount * 2);
      }
    }
    return this;
  }

  /**
   * Blotches of a second colour, for oxidation, moss, wear.
   *
   * The threshold is low so most of the surface takes some of the colour --
   * a narrow band only tints a few pixels and leaves the rest flat.
   */
  mottle(colour: RGB, strength = 0.35, period = 4, threshold = 0.35): this {
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        const n = this.noise(px + 211, py + 149, period);
        if (n < threshold) continue;
        const t = Math.min(1, (n - threshold) / (1 - threshold)) * strength;
        const i = (py * TILE_PX + px) * 4;
        if (this.px[i + 3] < 8) continue;
        this.px[i] += (colour[0] - this.px[i]) * t;
        this.px[i + 1] += (colour[1] - this.px[i + 1]) * t;
        this.px[i + 2] += (colour[2] - this.px[i + 2]) * t;
      }
    }
    return this;
  }

  /**
   * Lights the top and left edges and darkens the bottom and right.
   *
   * One consistent light direction across every material is most of what
   * makes a texture set look like a set rather than a pile of swatches.
   */
  bevel(strength = 18, depth = 2): this {
    const d = Math.max(1, Math.round(depth * S / 2));
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        const fromTop = Math.min(py, px);
        const fromBottom = Math.min(TILE_PX - 1 - py, TILE_PX - 1 - px);
        if (fromTop < d) this.shadePx(px, py, strength * (1 - fromTop / d));
        else if (fromBottom < d) this.shadePx(px, py, -strength * (1 - fromBottom / d));
      }
    }
    return this;
  }

  /**
   * Directional streaks at the rendered resolution, for brushed metal and
   * anything else whose surface has a grain direction.
   */
  streaks(amount = 12, vertical = false): this {
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        const along = vertical ? px : py;
        // A short repeating pattern reads as machining marks; pure noise
        // reads as dirt.
        const step = ((along * 7919) % 13) / 12 - 0.5;
        const wobble = this.noise(px + 313, py + 71, vertical ? 3 : 16) - 0.5;
        this.shadePx(px, py, (step * 1.4 + wobble * 0.9) * amount);
      }
    }
    return this;
  }

  /**
   * Lights whatever is already drawn from the upper left, ignoring the
   * transparent background.
   *
   * Unlike `bevel`, which works on the tile's own edges, this follows the
   * drawn shape -- what an item icon on a transparent background needs.
   */
  shadeShape(lit: RGB, shadow: RGB, strength = 0.4): this {
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        const i = (py * TILE_PX + px) * 4;
        if (this.px[i + 3] < 8) continue;
        // -1 at the top-left through +1 at the bottom-right.
        const ramp = (px + py) / (2 * (TILE_PX - 1)) * 2 - 1;
        const target = ramp < 0 ? lit : shadow;
        const t = Math.abs(ramp) * strength;
        this.px[i] += (target[0] - this.px[i]) * t;
        this.px[i + 1] += (target[1] - this.px[i + 1]) * t;
        this.px[i + 2] += (target[2] - this.px[i + 2]) * t;
      }
    }
    return this;
  }

  /**
   * A thin dark line around the drawn shape's silhouette: any opaque pixel
   * that borders a transparent one gets pulled toward `colour`.
   *
   * Item icons here are built from overlapping rects and lines, never a
   * single traced polygon, so there is no path to stroke -- this instead
   * finds the silhouette the same way the eye does, from the alpha edge,
   * which works no matter how the shape underneath was assembled. That
   * crisp border is most of what makes an icon read as "high fidelity"
   * rather than "flat colour" at a glance.
   */
  outline(colour: RGB = [10, 10, 12], strength = 0.85): this {
    const src = this.px.slice();
    const alphaAt = (px: number, py: number): number =>
      px < 0 || py < 0 || px >= TILE_PX || py >= TILE_PX ? 0 : src[(py * TILE_PX + px) * 4 + 3];
    // Half an authoring unit thick, whatever the render resolution. Measured
    // in raw pixels it would thin out every time TILE_PX rose, and the
    // crisp border is most of what makes an icon read.
    const w = Math.max(1, Math.round(S / 2));
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        const i = (py * TILE_PX + px) * 4;
        if (src[i + 3] < 8) continue;
        const edge = alphaAt(px - w, py) < 8 || alphaAt(px + w, py) < 8 ||
          alphaAt(px, py - w) < 8 || alphaAt(px, py + w) < 8;
        if (!edge) continue;
        this.px[i] += (colour[0] - src[i]) * strength;
        this.px[i + 1] += (colour[1] - src[i + 1]) * strength;
        this.px[i + 2] += (colour[2] - src[i + 2]) * strength;
      }
    }
    return this;
  }

  /**
   * Discrete two-tone shading across whatever is already drawn, lit from the
   * upper left -- a flat brighten near that corner, a flat darken near the
   * opposite one, nothing between.
   *
   * `shadeShape` blends continuously toward a fixed lit/shadow colour, which
   * pulls every part of a multi-material icon toward the same hue. This
   * instead nudges each pixel's own colour by a flat delta, so a tool's
   * metal head and wood handle keep their own tones while still picking up
   * the same crisp banding -- the cel-shaded look of a clean item icon
   * rather than the softer continuous gradient `shadeShape` gives.
   */
  celShade(highlight = 34, shadow = -30): this {
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        const i = (py * TILE_PX + px) * 4;
        if (this.px[i + 3] < 8) continue;
        const ramp = (px + py) / (2 * (TILE_PX - 1)); // 0 top-left .. 1 bottom-right
        if (ramp < 0.35) this.shadePx(px, py, highlight);
        else if (ramp > 0.7) this.shadePx(px, py, shadow);
      }
    }
    return this;
  }

  /** Random single-pixel flecks. */
  flecks(count: number, colour: RGB | null, delta = -26): this {
    for (let i = 0; i < count; i++) {
      const x = (this.rng() * TILE) | 0;
      const y = (this.rng() * TILE) | 0;
      if (colour) this.set(x, y, colour[0], colour[1], colour[2]);
      else this.shade(x, y, delta);
    }
    return this;
  }

  /** Soft rounded blobs, the cobble/gravel look. */
  blobs(count: number, base: RGB, spread = 26, radius: [number, number] = [1.5, 3]): this {
    for (let i = 0; i < count; i++) {
      const cx = this.rng() * TILE;
      const cy = this.rng() * TILE;
      const r = radius[0] + this.rng() * (radius[1] - radius[0]);
      const tone = (this.rng() * 2 - 1) * spread;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          const d = tone + (this.rng() * 2 - 1) * 7;
          this.set(x, y, base[0] + d, base[1] + d, base[2] + d);
        }
      }
    }
    return this;
  }

  /** Brick-style mortar courses. */
  courses(mortar: RGB, rowHeight = 4, stagger = 8): this {
    for (let y = 0; y < TILE; y++) {
      const row = (y / rowHeight) | 0;
      if (y % rowHeight === 0) {
        for (let x = 0; x < TILE; x++) this.set(x, y, ...mortar);
      } else {
        const offset = row % 2 === 0 ? 0 : stagger / 2;
        for (let x = 0; x < TILE; x++) {
          if ((x + offset) % stagger === 0) this.set(x, y, ...mortar);
        }
      }
    }
    return this;
  }

  /** Horizontal plank seams plus a couple of end joints. */
  planks(delta = -32): this {
    for (let y = 3; y < TILE; y += 4) {
      for (let x = 0; x < TILE; x++) this.shade(x, y, delta);
    }
    for (let band = 0; band < 4; band++) {
      const x = (this.rng() * TILE) | 0;
      for (let y = band * 4; y < band * 4 + 3; y++) this.shade(x, y, delta * 0.8);
    }
    return this;
  }

  /** Concentric growth rings, for log ends. */
  rings(light: RGB, dark: RGB, scale = 1.7): this {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const dist = Math.hypot(x - 7.5, y - 7.5);
        const c = (dist * scale) % 2 < 1 ? light : dark;
        const d = (this.rng() * 2 - 1) * 7;
        this.set(x, y, c[0] + d, c[1] + d, c[2] + d);
      }
    }
    return this;
  }

  /** Vertical streaks, for log sides. */
  woodGrain(chance = 0.35, delta = -16): this {
    for (let x = 0; x < TILE; x++) {
      if (this.rng() > chance) continue;
      const d = delta - this.rng() * 10;
      for (let y = 0; y < TILE; y++) this.shade(x, y, d);
    }
    return this;
  }

  /** Ore speckle clusters over an existing stone base. */
  ore(colour: RGB, clusters = 4, size = 2): this {
    for (let i = 0; i < clusters; i++) {
      const cx = 2 + ((this.rng() * (TILE - 4)) | 0);
      const cy = 2 + ((this.rng() * (TILE - 4)) | 0);
      for (let y = 0; y <= size; y++) {
        for (let x = 0; x <= size; x++) {
          if (this.rng() < 0.25) continue;
          const d = (this.rng() * 2 - 1) * 18;
          this.set(cx + x, cy + y, colour[0] + d, colour[1] + d, colour[2] + d);
        }
      }
    }
    return this;
  }

  /** 1px frame around the tile. */
  border(colour: RGB, alpha = 255): this {
    for (let i = 0; i < TILE; i++) {
      this.set(i, 0, ...colour, alpha);
      this.set(i, TILE - 1, ...colour, alpha);
      this.set(0, i, ...colour, alpha);
      this.set(TILE - 1, i, ...colour, alpha);
    }
    return this;
  }

  /** Grass fringe overhanging a dirt side. */
  fringe(colour: RGB, jitter = 14): this {
    for (let x = 0; x < TILE; x++) {
      const depth = 3 + ((this.rng() * 3) | 0);
      for (let y = 0; y < depth; y++) {
        const d = (this.rng() * 2 - 1) * jitter;
        this.set(x, y, colour[0] + d, colour[1] + d, colour[2] + d);
      }
    }
    return this;
  }

  /** Diagonal chevrons, for conveyor belts. */
  chevrons(colour: RGB): this {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if ((x + y) % 8 < 2 || (x - y + TILE) % 8 < 2) this.set(x, y, ...colour);
      }
    }
    return this;
  }

  /** Filled rectangle. */
  rect(x0: number, y0: number, w: number, h: number, colour: RGB, jitter = 0): this {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const d = jitter ? (this.rng() * 2 - 1) * jitter : 0;
        this.set(x, y, colour[0] + d, colour[1] + d, colour[2] + d);
      }
    }
    return this;
  }

  /** Thick line, for tool handles. */
  line(x0: number, y0: number, x1: number, y1: number, colour: RGB, width = 2): this {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      for (let w = 0; w < width; w++) this.set(x + w, y, ...colour);
    }
    return this;
  }

  /** Rough circle, for gems and pearls. */
  disc(cx: number, cy: number, r: number, colour: RGB, jitter = 10): this {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const d = (this.rng() * 2 - 1) * jitter;
        this.set(x, y, colour[0] + d, colour[1] + d, colour[2] + d);
      }
    }
    return this;
  }

  /**
   * Snaps every pixel's brightness onto a small number of flat steps,
   * keeping its hue.
   *
   * This is the single biggest thing separating this art from Minecraft's.
   * Continuous noise reads as mush at block size: the eye averages it into
   * one flat colour. Quantising to four or five tones instead gives the
   * distinct light and dark patches that make stone read as *stone* rather
   * than as grey fog, and it is what every tile below leans on.
   */
  posterize(steps = 4): this {
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        const i = (py * TILE_PX + px) * 4;
        if (this.px[i + 3] < 8) continue;
        const lum = (this.px[i] + this.px[i + 1] + this.px[i + 2]) / 3;
        if (lum < 1) continue;
        const snapped = Math.round((lum / 255) * (steps - 1)) / (steps - 1) * 255;
        const k = snapped / lum;
        this.px[i] *= k;
        this.px[i + 1] *= k;
        this.px[i + 2] *= k;
      }
    }
    return this;
  }

  /**
   * A filled rect in authoring units that wraps around the tile edges.
   *
   * `rect` clips, which silently truncates any feature straddling an edge and
   * leaves a visible seam once the block repeats across a wall. Everything
   * placed randomly on a tiling texture needs to wrap instead.
   */
  blot(x0: number, y0: number, w: number, h: number, colour: RGB, jitter = 0): this {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const d = jitter ? (this.rng() * 2 - 1) * jitter : 0;
        this.set(
          ((x % TILE) + TILE) % TILE, ((y % TILE) + TILE) % TILE,
          colour[0] + d, colour[1] + d, colour[2] + d);
      }
    }
    return this;
  }

  /**
   * Chunky rectangular patches of a second tone, scattered and wrapping.
   *
   * Minecraft's surfaces are built from 2-4px clumps, not single-pixel
   * noise -- `flecks` at one authoring unit disappears at any distance,
   * while a 2x3 patch still reads.
   */
  patches(count: number, colour: RGB, jitter = 10, maxSize = 3): this {
    for (let i = 0; i < count; i++) {
      const w = 1 + ((this.rng() * maxSize) | 0);
      const h = 1 + ((this.rng() * maxSize) | 0);
      this.blot(
        (this.rng() * TILE) | 0, (this.rng() * TILE) | 0, w, h, colour, jitter);
    }
    return this;
  }

  /**
   * Ore veins: a few compact clumps, each rimmed a shade darker.
   *
   * The old `ore` scattered loose pixels that read as confetti sprinkled on
   * stone. Real ore reads as a handful of solid lumps embedded in the rock,
   * which needs contiguous blobs and a darker edge to seat them.
   */
  oreVein(colour: RGB, clusters = 5): this {
    const rim: RGB = [colour[0] * 0.62, colour[1] * 0.62, colour[2] * 0.62];
    for (let i = 0; i < clusters; i++) {
      const cx = (this.rng() * TILE) | 0;
      const cy = (this.rng() * TILE) | 0;
      // Two or three overlapping boxes make a lumpy, non-rectangular clump.
      // Small: two lightly offset 2x2s make a ~3x3 lump. Bigger clumps than
      // this stop reading as ore embedded in rock and start reading as a
      // block made of ore.
      const parts = 2;
      const cells: Array<[number, number]> = [];
      for (let p = 0; p < parts; p++) {
        const ox = cx + ((this.rng() * 2) | 0);
        const oy = cy + ((this.rng() * 2) | 0);
        const w = 2;
        const h = 2;
        for (let y = oy; y < oy + h; y++) {
          for (let x = ox; x < ox + w; x++) cells.push([x, y]);
        }
      }
      const filled = new Set(cells.map(([x, y]) =>
        `${((x % TILE) + TILE) % TILE},${((y % TILE) + TILE) % TILE}`));
      // Rim first, then the body on top, so only the outside edge stays dark.
      for (const [x, y] of cells) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const key = `${((( x + dx) % TILE) + TILE) % TILE},${(((y + dy) % TILE) + TILE) % TILE}`;
          if (!filled.has(key)) this.blot(x + dx, y + dy, 1, 1, rim, 6);
        }
      }
      for (const [x, y] of cells) this.blot(x, y, 1, 1, colour, 14);
    }
    return this;
  }

  /** Swirling portal shimmer. */
  swirl(inner: RGB, outer: RGB, alpha = 200): this {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        const t = (Math.atan2(dy, dx) * 2 + Math.hypot(dx, dy) * 0.9) % (Math.PI * 2);
        const k = (Math.sin(t) + 1) / 2;
        const jitter = (this.rng() * 2 - 1) * 14;
        this.set(
          x, y,
          inner[0] + (outer[0] - inner[0]) * k + jitter,
          inner[1] + (outer[1] - inner[1]) * k + jitter,
          inner[2] + (outer[2] - inner[2]) * k + jitter,
          alpha,
        );
      }
    }
    return this;
  }
}

const STONE: RGB = [128, 128, 128];
const HANDLE: RGB = [122, 88, 48];

/**
 * Shared silhouette for every tool, coloured by tier.
 *
 * The heads are deliberately chunky and very different in outline: at the
 * ~34px these are drawn at in the UI, a subtle head shape is unreadable and
 * every tool looks like the same brown stick.
 */
function toolTile(kind: 'pickaxe' | 'axe' | 'shovel', head: RGB) {
  const dark: RGB = [head[0] * 0.7, head[1] * 0.7, head[2] * 0.7];
  const lit: RGB = [
    Math.min(255, head[0] * 1.18 + 14),
    Math.min(255, head[1] * 1.18 + 14),
    Math.min(255, head[2] * 1.18 + 14),
  ];
  return (t: Tile) => {
    // Proportions matter more than any detail here. A real tool icon is
    // mostly *handle*: a long shaft running corner to corner, with a
    // comparatively small head perched on its top end. Earlier passes had a
    // stubby half-length shaft under an oversized slab of a head, which is
    // why they read as "a shape on a stick" rather than as a tool.
    t.line(1, 14, 11, 4, HANDLE, 2);
    t.line(1, 15, 10, 6, [92, 64, 34], 1);  // shaft shading
    t.rect(0, 13, 3, 3, HANDLE, 6);         // butt cap
    t.rect(0, 15, 3, 1, [80, 54, 28]);

    if (kind === 'pickaxe') {
      // An asymmetric crescent sweeping over the top, which the shaft passes
      // *through* near its right end -- not a symmetric bar sitting on top
      // of it. Stamped along an arc so the curve is a real curve.
      for (let a = 202; a <= 338; a += 4) {
        const r = (a * Math.PI) / 180;
        const cx = 8.5 + Math.cos(r) * 6.0;
        const cy = 9.2 + Math.sin(r) * 6.0;
        t.rect(Math.round(cx), Math.round(cy), 2, 2, head, 4);
      }
      // Tips, darkened so the ends read as points rather than stubs.
      t.rect(2, 6, 2, 2, dark, 3);
      t.rect(13, 6, 2, 2, dark, 3);
      t.rect(6, 2, 4, 1, lit);                // lit crown
    } else if (kind === 'axe') {
      // One solid head: a blade tapering from a flared cutting edge on the
      // left back to a squared poll that sits over the shaft's top. A poll
      // drawn as a separate disc left a gap the shaft showed through, which
      // turned the whole head into a spike.
      t.rect(5, 1, 6, 2, head, 6);            // top
      t.rect(4, 3, 7, 3, head, 6);            // widest, at the cutting edge
      t.rect(5, 6, 5, 2, head, 6);            // taper
      t.rect(6, 8, 3, 1, head, 5);
      t.rect(11, 3, 2, 3, head, 5);           // poll, over the shaft top
      t.rect(4, 3, 1, 3, lit);                // lit cutting edge
      t.rect(5, 1, 3, 1, lit);
      t.rect(11, 5, 2, 1, dark);              // shadow beneath the poll
    } else {
      // A small rounded spade on the shaft's top end.
      t.disc(10.6, 4.4, 3.3, head, 8);
      t.rect(8, 2, 5, 4, head, 6);
      t.rect(9, 6, 3, 2, head, 5);            // socket onto the shaft
      t.rect(8, 2, 2, 3, lit);                // lit face
      t.rect(12, 4, 1, 3, dark);              // shadowed side
    }

    // Crisp banding plus a dark silhouette edge. The highlight is gentler
    // than the default: iron and diamond are already pale, and a +34 step
    // pushed their whole head to near-white, losing the material colour.
    t.celShade(18, -26);
    t.outline();
  };
}

const TOOL_TIERS: Array<[string, RGB]> = [
  ['wood', [158, 122, 72]],
  ['stone', [136, 136, 136]],
  ['iron', [214, 214, 218]],
  ['diamond', [104, 226, 220]],
];

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

/** The stone every ore is embedded in, kept in one place so they match. */
function stoneBase(t: Tile): Tile {
  return t.fill(STONE, 4)
    .patches(14, [108, 108, 111], 4, 3)
    .patches(10, [146, 146, 149], 4, 3);
}

const RECIPES: Record<string, (t: Tile) => void> = {
  grass_top: (t) => t.fill([106, 158, 64], 6)
    .patches(20, [80, 126, 46], 6, 3)
    .patches(14, [132, 186, 84], 6, 2)
    .patches(7, [62, 102, 36], 5, 2)
    .posterize(12),
  grass_side: (t) => t.fill([134, 96, 67], 9)
    .patches(16, [110, 78, 52], 10, 3)
    .patches(10, [152, 112, 80], 10, 2)
    .posterize(9)
    .fringe([106, 158, 64]),
  dirt: (t) => t.fill([134, 96, 67], 9)
    .patches(20, [110, 78, 52], 10, 3)
    .patches(12, [152, 112, 80], 10, 2)
    .posterize(9),
  // Stone is the most repeated surface in the game, so it has to hold up
  // both close and at distance: broad tonal patches read from far off, a
  // few dark pits give it something to catch the eye up close.
  //
  // Posterize steps have to be chosen against the material's own tonal
  // range, not picked by habit. Stone spans about 100-155, and at 5 steps
  // every band is 64 wide -- the whole range landed in one band and came
  // out flatter than the version this replaced. Subtle materials need finer
  // steps to stay quantised without being erased.
  stone: (t) => t.fill([124, 124, 127], 4)
    .patches(18, [100, 100, 103], 4, 3)
    .patches(13, [152, 152, 155], 4, 3)
    .patches(7, [86, 86, 89], 4, 2)
    .posterize(9),
  // Distinct rounded stones with dark gaps between them -- the thing that
  // separates cobble from plain stone at a glance.
  cobble: (t) => {
    t.fill([88, 88, 90], 5);                       // mortar showing through
    t.patches(13, [132, 132, 136], 12, 4);          // the stones themselves
    t.patches(9, [108, 108, 112], 10, 3);
    t.patches(7, [152, 152, 156], 8, 2);            // lit tops
    t.posterize(9);
  },
  sand: (t) => t.fill([222, 210, 162], 7)
    .patches(18, [206, 193, 144], 6, 2)
    .patches(10, [236, 226, 184], 6, 2)
    .posterize(4),
  gravel: (t) => {
    t.fill([116, 110, 106], 6);
    t.patches(16, [140, 134, 128], 10, 3);
    t.patches(12, [92, 88, 84], 10, 2);
    t.patches(8, [162, 156, 150], 8, 2);
    t.posterize(5);
  },
  bedrock: (t) => {
    t.fill([74, 74, 78], 4);
    t.patches(9, [44, 44, 48], 5, 4);
    t.patches(7, [108, 108, 114], 5, 4);
    t.patches(4, [26, 26, 30], 4, 3);
    t.posterize(8);
  },
  log_side: (t) => t.fill([112, 86, 52], 4)
    .patches(12, [84, 62, 36], 4, 2)
    .patches(8, [140, 110, 70], 4, 2)
    .woodGrain(0.45, -22)
    .posterize(10),
  // Concentric rings drawn as explicit alternating bands. The old smooth
  // radial gradient beat against the pixel grid into a plaid moire, and
  // posterising it afterwards only quantised the moire.
  log_top: (t) => {
    t.fill([150, 118, 72], 5);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        const band = Math.floor(d / 1.6);
        const tone: RGB = band % 2 === 0 ? [166, 132, 84] : [128, 100, 60];
        const j = (t.rng() * 2 - 1) * 5;
        t.set(x, y, tone[0] + j, tone[1] + j, tone[2] + j);
      }
    }
    t.blot(7, 7, 2, 2, [104, 80, 48], 4);  // heartwood
    t.border([120, 94, 56]);               // bark edge
  },
  // Leaves need gaps to read as foliage rather than a green wall; the dark
  // patches stand in for the shadowed depth between them.
  leaves: (t) => t.fill([66, 122, 48], 10)
    .patches(24, [44, 88, 34], 12, 3)
    .patches(16, [88, 148, 62], 12, 2)
    .patches(8, [30, 62, 24], 8, 2)
    .posterize(5),
  planks: (t) => {
    t.fill([172, 136, 82], 6);
    // Per-board tone variation, so the boards read as separate pieces of
    // wood rather than one sheet with lines scored across it.
    for (let board = 0; board < 4; board++) {
      const d = [0, -14, 8, -6][board];
      t.blot(0, board * 4, TILE, 4, [172 + d, 136 + d, 82 + d], 5);
    }
    t.planks(-34);
    t.posterize(9);
  },
  brick: (t) => t.fill([150, 74, 60], 7).courses([176, 172, 166]).posterize(5),
  glass: (t) => {
    // Mostly empty, with a frame and a diagonal glint -- glass reads by its
    // edges and its highlight, not by any fill.
    t.fill([214, 236, 244], 0, 18);
    t.border([228, 242, 250], 235);
    t.line(3, 11, 10, 4, [255, 255, 255], 1);
    t.line(5, 12, 9, 8, [255, 255, 255], 1);
  },
  // Water is seen through, so it stays smooth -- chunky patches read as
  // debris floating in it rather than as a moving surface.
  water: (t) => t.fill([58, 110, 200], 5, 170)
    .patches(6, [46, 94, 186], 4, 5)
    .patches(4, [78, 130, 216], 4, 4)
    .posterize(14),
  glowstone: (t) => t.fill([196, 158, 80], 5)
    .patches(9, [230, 198, 116], 6, 3)
    .patches(6, [252, 238, 172], 5, 2)
    .patches(7, [158, 120, 54], 6, 3)
    .posterize(8),
  torch: (t) => {
    // Drawn on transparent so it reads as a torch rather than a block.
    t.rect(7, 6, 2, 10, [138, 100, 58], 6);   // stick
    t.rect(6, 3, 4, 4, [86, 74, 62], 4);      // coal head
    t.rect(6, 2, 4, 2, [252, 206, 96], 10);   // flame
    t.rect(7, 1, 2, 2, [255, 240, 170], 8);
  },

  // Every ore is the same stone base with its own vein colour, so they read
  // as the same rock with different things in it.
  coal_ore: (t) => stoneBase(t).oreVein([38, 38, 40], 4).posterize(10),
  iron_ore: (t) => stoneBase(t).oreVein([196, 152, 118], 4).posterize(10),
  gold_ore: (t) => stoneBase(t).oreVein([238, 198, 76], 4).posterize(10),
  diamond_ore: (t) => stoneBase(t).oreVein([104, 222, 222], 4).posterize(10),
  // A worked metal panel: near-flat, with a soft sheen rather than the
  // speckling that suits rock. Scattered light flecks read as dirt on it.
  iron_block: (t) => t.fill([206, 206, 212], 3)
    .patches(6, [194, 194, 200], 3, 4)
    .patches(4, [222, 222, 228], 3, 3)
    .posterize(12)
    .border([176, 176, 182]),
  quartz: (t) => t.fill([226, 222, 210], 4)
    .patches(14, [200, 195, 182], 4, 3)
    .patches(9, [246, 244, 238], 4, 2)
    .posterize(12),

  // Deliberately unlike plain planks: a dark worktop with a marked-out grid,
  // and sides showing a tool rack, so it reads at a glance.
  crafting_top: (t) => {
    t.fill([124, 92, 54], 6).patches(10, [104, 76, 44], 6, 3).posterize(4);
    const line: RGB = [56, 38, 20];
    for (let i = 0; i < TILE; i++) {
      t.set(i, 5, ...line);
      t.set(i, 10, ...line);
      t.set(5, i, ...line);
      t.set(10, i, ...line);
    }
    t.border([74, 52, 30]);
  },
  crafting_side: (t) => {
    t.fill([150, 116, 68], 6).planks(-30).posterize(4);
    t.rect(2, 2, 12, 6, [92, 66, 38], 4);       // dark tool-rack panel
    // A saw blade: a bar with teeth, which survives being 12px wide in a way
    // the old crossed hammer-and-saw lines did not.
    t.rect(3, 4, 10, 2, [198, 198, 204], 5);
    for (let x = 3; x < 13; x += 2) t.set(x, 6, 198, 198, 204);
    t.rect(3, 3, 4, 1, [140, 100, 56]);         // its handle
    t.border([74, 52, 30]);
  },
  furnace_top: (t) => t.fill([112, 112, 116], 4)
    .patches(12, [94, 94, 98], 5, 3)
    .patches(8, [134, 134, 138], 5, 3)
    .posterize(12),
  furnace_front: (t) => {
    t.fill([112, 112, 116], 4).patches(10, [94, 94, 98], 5, 3).posterize(9);
    t.rect(3, 6, 10, 7, [52, 44, 40], 4);      // firebox recess
    t.rect(4, 7, 8, 5, [30, 24, 22], 3);       // its dark interior
    t.rect(4, 10, 8, 2, [206, 108, 34], 8);    // embers glowing at the base
    t.rect(5, 11, 6, 1, [244, 176, 60], 10);
  },
  // Machines read as machines through hard geometry -- panel, rivets, a
  // direction -- rather than through a decorative repeating lattice.
  conveyor: (t) => beltBase(t),

  // Chest, collector and miner: machine faces built from hard geometry so
  // each is identifiable at a glance in a wall of similar grey boxes.
  // A ladder: two rails with rungs between them, drawn on transparent so the
  // wall behind shows through the gaps.
  ladder: (t) => {
    const wood: RGB = [148, 108, 62];
    const dark: RGB = [104, 74, 40];
    t.rect(2, 0, 2, TILE, wood, 6);          // left rail
    t.rect(12, 0, 2, TILE, wood, 6);         // right rail
    t.rect(2, 0, 1, TILE, dark, 4);          // rail shading
    t.rect(12, 0, 1, TILE, dark, 4);
    for (let y = 2; y < TILE; y += 4) {      // rungs, spaced to tile vertically
      t.rect(4, y, 8, 2, wood, 5);
      t.rect(4, y + 1, 8, 1, dark, 3);
    }
  },
  bed_top: (t) => {
    t.rect(0, 0, TILE, 5, [232, 232, 236], 6);   // pillow
    t.rect(0, 5, TILE, 11, [186, 58, 54], 7);    // blanket
    t.rect(0, 5, TILE, 1, [140, 40, 38], 4);     // fold line
    t.patches(8, [166, 46, 44], 5, 3);
    t.posterize(10);
  },
  bed_side: (t) => {
    t.rect(0, 0, TILE, 4, [186, 58, 54], 7);     // blanket edge
    t.rect(0, 4, TILE, 3, [232, 232, 236], 6);   // mattress
    t.rect(0, 7, TILE, 9, [136, 100, 58], 7);    // wooden frame
    t.rect(0, 7, TILE, 1, [98, 70, 38], 4);
    t.rect(1, 13, 3, 3, [98, 70, 38], 4);        // legs
    t.rect(12, 13, 3, 3, [98, 70, 38], 4);
    t.posterize(10);
  },
  chest_top: (t) => {
    t.fill([148, 108, 58], 5).patches(9, [124, 88, 46], 5, 3).posterize(9);
    t.border([78, 54, 28]);
    t.rect(6, 6, 4, 4, [176, 148, 62]);   // latch plate
    t.rect(7, 7, 2, 2, [92, 74, 30]);
  },
  chest_side: (t) => {
    t.fill([148, 108, 58], 5).patches(9, [124, 88, 46], 5, 3).posterize(9);
    t.border([78, 54, 28]);
    t.rect(0, 6, TILE, 2, [78, 54, 28]);  // lid seam
    t.rect(6, 5, 4, 5, [176, 148, 62]);   // clasp
    t.rect(7, 7, 2, 2, [60, 46, 20]);     // keyhole
  },
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

  netherrack: (t) => t.fill([116, 46, 44], 5)
    .patches(18, [82, 28, 28], 5, 3)
    .patches(13, [150, 66, 62], 5, 3)
    .patches(7, [58, 18, 18], 5, 2)
    .posterize(9),
  soul_sand: (t) => {
    t.fill([88, 68, 56], 6).patches(14, [72, 54, 44], 8, 3).posterize(4);
    // The sunken hollows that give the block its name.
    for (const [hx, hy] of [[3, 4], [10, 3], [6, 10], [12, 11]] as const) {
      t.blot(hx, hy, 3, 3, [54, 40, 32], 5);
      t.blot(hx + 1, hy + 1, 1, 1, [38, 28, 22], 3);
    }
  },
  // Mostly molten rock with a bit of crust and only a few bright veins --
  // flooding it with yellow loses the deep red that says "lava".
  lava: (t) => t.fill([198, 74, 18], 7)
    .patches(11, [228, 118, 26], 8, 4)
    .patches(9, [128, 40, 12], 8, 3)     // cooled crust
    .patches(4, [250, 196, 66], 6, 2)    // the hot veins
    .posterize(8),
  obsidian: (t) => t.fill([26, 20, 38], 4)
    .patches(9, [40, 30, 58], 5, 4)
    .patches(4, [58, 44, 88], 4, 2)
    .patches(5, [14, 10, 22], 4, 3)
    .posterize(8),
  nether_brick: (t) => t.fill([70, 34, 38], 4).courses([50, 24, 28]).posterize(10),
  // Portals are chaotic light, not a tidy spiral: broken bright patches over
  // a dark field read far better than a regular swirl repeating across a frame.
  portal: (t) => t.fill([78, 28, 140], 10, 220)
    .patches(20, [128, 54, 206], 16, 3)
    .patches(14, [176, 104, 240], 16, 2)
    .patches(10, [48, 14, 92], 12, 3)
    .posterize(5),

  end_stone: (t) => t.fill([218, 220, 168], 6)
    .patches(16, [198, 200, 148], 8, 3)
    .patches(10, [238, 240, 194], 6, 2)
    .posterize(9),
  end_frame_top: (t) => t.fill([218, 220, 168], 6)
    .patches(10, [198, 200, 148], 6, 3).posterize(9).border([120, 148, 116]),
  end_frame_side: (t) => t.fill([196, 198, 150], 6)
    .patches(10, [176, 178, 132], 6, 3).posterize(9).courses([150, 156, 118], 8, 8),
  // A night sky: mostly deep black, a few faint nebulae, sparse stars.
  end_portal: (t) => t.fill([10, 8, 28], 4, 240)
    .patches(8, [34, 22, 82], 8, 4)
    .patches(4, [72, 54, 140], 6, 2)
    .patches(5, [210, 224, 244], 4, 1)   // the starfield glints
    .posterize(8),
  end_frame_eye: (t) => {
    t.fill([196, 198, 150], 6).patches(8, [176, 178, 132], 6, 3).posterize(4);
    t.border([120, 148, 116]);
    t.disc(7.5, 7.5, 4, [42, 132, 122], 10);
    t.disc(7.5, 7.5, 2, [220, 240, 160], 8);
  },
  // A C-shaped steel striker over a wedge of flint, with sparks between
  // them -- the two parts and the spark are what name the item.
  flint_steel: (t) => {
    t.rect(2, 5, 3, 8, [188, 188, 194], 6);   // striker back
    t.rect(2, 4, 6, 2, [188, 188, 194], 6);   // upper arm
    t.rect(2, 12, 6, 2, [160, 160, 166], 6);  // lower arm
    t.rect(6, 6, 2, 2, [140, 140, 146], 4);
    t.rect(9, 9, 5, 4, [78, 72, 68], 6);      // flint
    t.rect(10, 8, 3, 1, [104, 96, 90], 4);
    t.rect(9, 6, 2, 2, [250, 214, 120], 8);   // sparks
    t.rect(12, 5, 2, 2, [252, 238, 178], 6);
    t.celShade(18, -16);
    t.outline();
  },
  purpur: (t) => t.fill([170, 124, 172], 6)
    .patches(16, [150, 104, 152], 8, 3)
    .patches(10, [192, 150, 194], 6, 2)
    .posterize(9),

  // ------------------------------------------------------------------ items
  stick: (t) => t.line(5, 12, 10, 3, HANDLE, 2).outline(),
  // An irregular lump, not a circle: coal and diamond were both plain discs,
  // so the two shared a silhouette exactly and could only be told apart by
  // colour. Near-black also means a flat +/- shade delta caps out fast, so a
  // bright facet does the work the shading cannot.
  coal: (t) => t.rect(4, 4, 7, 4, [38, 38, 40], 12)
    .rect(3, 6, 9, 5, [38, 38, 40], 12)
    .rect(5, 10, 6, 3, [34, 34, 36], 10)
    .rect(2, 8, 3, 3, [42, 42, 44], 10)
    .rect(11, 5, 3, 4, [42, 42, 44], 10)
    .rect(6, 5, 2, 2, [124, 124, 130])
    .celShade(20, -20).outline(),
  iron_ingot: (t) => t.rect(3, 6, 10, 4, [214, 214, 218], 10).rect(4, 5, 8, 1, [236, 236, 240])
    .celShade(24, -20).outline(),
  gold_ingot: (t) => t.rect(3, 6, 10, 4, [238, 200, 80], 10).rect(4, 5, 8, 1, [252, 226, 130])
    .celShade(24, -20).outline(),
  // A cut gem: flat table on top, widening to a girdle, then tapering to a
  // point. The facets are what make it read as a gem rather than a blue ball.
  diamond: (t) => {
    const gem: RGB = [104, 226, 226];
    t.rect(5, 2, 6, 2, gem, 8);          // table
    t.rect(3, 4, 10, 2, gem, 10);        // crown
    t.rect(2, 6, 12, 2, gem, 10);        // girdle, the widest point
    t.rect(3, 8, 10, 2, gem, 10);        // pavilion
    t.rect(5, 10, 6, 2, gem, 10);
    t.rect(6, 12, 4, 1, gem, 8);
    t.rect(7, 13, 2, 1, gem, 6);         // cutlet
    t.rect(5, 4, 3, 2, [186, 248, 248]); // facet highlight
    t.rect(9, 8, 3, 2, [64, 168, 176]);  // facet shadow
    t.celShade(26, -20);
    t.outline();
  },

  // A power drill in profile: body, pistol grip, chuck, and a bit that
  // actually tapers to a point.
  drill: (t) => {
    t.rect(1, 5, 8, 6, [104, 104, 110], 5);     // motor housing
    t.rect(2, 4, 5, 1, [140, 140, 146], 4);     // lit top edge
    t.rect(3, 11, 4, 4, [66, 60, 56], 4);       // grip
    t.rect(3, 15, 4, 1, [46, 42, 40], 3);
    t.rect(9, 6, 3, 4, [188, 188, 194], 5);     // chuck
    t.rect(12, 7, 2, 2, [104, 226, 226], 6);    // bit
    t.rect(14, 7, 1, 2, [180, 246, 246], 4);    // its point
    t.celShade(20, -18);
    t.outline();
  },
  boat: (t) => {
    // Seen from the side: a shallow hull with a raised prow, an oar, and the
    // waterline it sits at.
    t.rect(2, 8, 12, 3, [150, 112, 64], 7);       // hull
    t.rect(1, 7, 3, 2, [168, 128, 76], 6);        // prow
    t.rect(13, 7, 2, 2, [150, 112, 64], 6);       // stern
    t.rect(3, 7, 10, 1, [186, 148, 92], 5);       // gunwale
    t.rect(5, 6, 5, 1, [120, 86, 48], 4);         // bench
    t.line(6, 5, 12, 2, [140, 100, 56], 2);       // oar
    t.rect(2, 11, 12, 1, [72, 128, 196], 6);      // waterline
    t.celShade(20, -18);
    t.outline();
  },
  truck: (t) => {
    t.rect(1, 7, 14, 4, [60, 62, 70], 6);         // chassis + bed
    t.rect(9, 3, 5, 4, [80, 84, 94], 6);          // cab
    t.rect(10, 4, 3, 2, [150, 206, 232], 6);      // windscreen
    t.rect(1, 5, 7, 2, [96, 100, 110], 5);        // bed walls
    t.rect(14, 7, 1, 2, [232, 216, 150], 4);      // headlight
    t.rect(2, 11, 3, 3, [34, 34, 38], 3);         // wheels
    t.rect(10, 11, 3, 3, [34, 34, 38], 3);
    t.celShade(20, -18);
    t.outline();
  },
  skateboard: (t) => {
    t.rect(2, 6, 12, 3, [168, 132, 78], 8);     // deck
    t.rect(1, 5, 2, 2, [168, 132, 78], 6);      // upturned nose
    t.rect(13, 5, 2, 2, [168, 132, 78], 6);     // and tail
    t.rect(3, 9, 2, 2, [120, 120, 126], 4);     // trucks
    t.rect(11, 9, 2, 2, [120, 120, 126], 4);
    t.rect(3, 11, 3, 3, [40, 40, 44], 4);       // wheels
    t.rect(10, 11, 3, 3, [40, 40, 44], 4);
    t.celShade(20, -18);
    t.outline();
  },
  car: (t) => {
    t.rect(1, 8, 14, 4, [168, 62, 52], 7);      // body
    t.rect(4, 4, 8, 4, [150, 74, 60], 7);       // cabin
    t.rect(5, 5, 6, 2, [150, 206, 232], 6);     // glass
    t.rect(13, 8, 2, 2, [246, 226, 150], 4);    // headlight
    t.rect(2, 12, 3, 3, [36, 36, 40], 3);       // wheels
    t.rect(11, 12, 3, 3, [36, 36, 40], 3);
    t.celShade(20, -18);
    t.outline();
  },
  // Seen from above, which is the only view where a plane's wings, tail and
  // fuselage all read at once.
  plane: (t) => {
    t.rect(7, 1, 3, 13, [214, 214, 220], 6);    // fuselage
    t.rect(7, 0, 3, 2, [176, 176, 182], 5);     // nose
    t.rect(1, 6, 15, 3, [198, 198, 204], 6);    // main wing
    t.rect(4, 12, 9, 2, [198, 198, 204], 5);    // tailplane
    t.rect(7, 3, 3, 2, [150, 206, 232], 5);     // canopy
    t.rect(0, 6, 2, 3, [166, 66, 58], 4);       // wingtip flashes
    t.rect(14, 6, 2, 3, [166, 66, 58], 4);
    t.celShade(20, -18);
    t.outline();
  },
  helicopter: (t) => {
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
  },

  blaze_rod: (t) => {
    t.line(5, 13, 11, 3, [214, 152, 28], 4);      // the rod
    t.line(6, 12, 10, 4, [252, 214, 96], 2);      // glowing core
    t.rect(10, 1, 3, 3, [252, 232, 150], 6);      // hot tip
    t.rect(4, 13, 3, 3, [176, 120, 20], 5);       // cool end
    t.celShade(18, -16);
    t.outline();
  },
  blaze_powder: (t) => t.disc(8, 8, 4.5, [236, 158, 46], 20).celShade(20, -18).outline(),
  ender_pearl: (t) => t.disc(8, 8, 5, [42, 132, 122], 18).disc(7, 7, 2, [150, 236, 220], 10)
    .celShade(20, -18).outline(),
  eye_of_ender: (t) => t.disc(8, 8, 5, [42, 132, 122], 12).disc(8, 8, 2.4, [220, 240, 160], 8)
    .celShade(20, -18).outline(),
};

/** Tiles the block/item registries don't reference but the renderer needs. */
export const EXTRA_TILES = [
  'hand',
  'crack_0', 'crack_1', 'crack_2', 'crack_3', 'crack_4',
  'crack_5', 'crack_6', 'crack_7', 'crack_8', 'crack_9',
  'paint_red', 'paint_dark', 'chrome', 'tire', 'headlight', 'taillight', 'rotor',
  'skin', 'face', 'hair', 'shirt', 'sleeve', 'pants', 'boots',
  'pig', 'pig_face', 'cow', 'cow_head', 'cow_face', 'wool', 'sheep_face',
  'sheep_leg', 'chicken', 'chicken_face', 'beak', 'bone',
  'zombie_head', 'zombie_face', 'zombie_body', 'zombie_legs',
  'blaze_core', 'blaze_face', 'blaze_rod_mob',
  'ender_body', 'ender_face',
  'dragon_body', 'dragon_head', 'dragon_face', 'dragon_wing',
];

// Mob hides. Faces get eyes on the front so you can tell which way one is
// looking, which matters when something is chasing you.
/**
 * Animal hide.
 *
 * A flat fill plus white-noise jitter averaged out to a single colour at any
 * distance -- the pig read as 175 brightness with a standard deviation of 4,
 * which is indistinguishable from a blank swatch. Coherent blotching and a
 * bevel give the surface something to catch the light on.
 */
function hide(base: RGB, jitter = 7) {
  const darker: RGB = [base[0] * 0.86, base[1] * 0.86, base[2] * 0.86];
  const lighter: RGB = [
    Math.min(255, base[0] * 1.12),
    Math.min(255, base[1] * 1.12),
    Math.min(255, base[2] * 1.12),
  ];
  return (t: Tile) => {
    t.fill(base, jitter + 8);
    t.mottle(darker, 0.55, 4);
    t.mottle(lighter, 0.4, 7);
    t.grain(16, 12);
    t.bevel(14);
  };
}

/**
 * Woven fabric: a visible weave plus dye unevenness.
 *
 * Used for every cloth surface so shirts, trousers and mob clothing stop
 * being flat colour swatches.
 */
function fabric(base: RGB) {
  const dark: RGB = [base[0] * 0.82, base[1] * 0.82, base[2] * 0.82];
  const light: RGB = [
    Math.min(255, base[0] * 1.15),
    Math.min(255, base[1] * 1.15),
    Math.min(255, base[2] * 1.15),
  ];
  return (t: Tile) => {
    t.fill(base, 10);
    t.streaks(11);        // weft
    t.streaks(9, true);   // warp
    t.mottle(dark, 0.4, 5);
    t.mottle(light, 0.3, 8);
    t.bevel(14);
  };
}

function faceOf(base: RGB, eye: RGB, snout: RGB | null, jitter = 6) {
  return (t: Tile) => {
    t.fill(base, jitter);
    t.rect(3, 5, 3, 3, eye);
    t.rect(10, 5, 3, 3, eye);
    t.set(4, 6, 250, 250, 250);
    t.set(11, 6, 250, 250, 250);
    if (snout) t.rect(5, 10, 6, 4, snout);
  };
}

RECIPES.pig = hide([224, 148, 152]);
RECIPES.pig_face = (t) => {
  faceOf([224, 148, 152], [40, 30, 32], [206, 122, 128])(t);
  t.set(7, 11, 150, 82, 90);
  t.set(9, 11, 150, 82, 90);
};
RECIPES.cow = hide([70, 54, 46]);
RECIPES.cow_head = hide([84, 66, 56]);
RECIPES.cow_face = faceOf([84, 66, 56], [30, 24, 22], [206, 196, 186]);
// Wool needs visible fibre, not a pale wash. At 235 mean brightness with
// almost no variation it was the single worst offender for reading as blank
// white next to a resource pack.
RECIPES.wool = (t) => {
  t.fill([226, 226, 222], 7);
  t.grain(16, 12);                       // fine fleece tooth
  t.mottle([198, 198, 194], 0.5, 5);     // clumping
  t.mottle([246, 246, 244], 0.3, 7);     // highlights on the clumps
  t.bevel(14);
};
RECIPES.sheep_face = faceOf([228, 210, 196], [34, 30, 28], null);
RECIPES.sheep_leg = hide([212, 200, 190], 5);
RECIPES.chicken = (t) => t.fill([244, 244, 240], 7).flecks(14, [220, 220, 214]);
RECIPES.chicken_face = (t) => {
  t.fill([244, 244, 240], 5);
  t.rect(4, 5, 3, 3, [30, 26, 24]);
  t.rect(9, 5, 3, 3, [30, 26, 24]);
  t.rect(6, 1, 4, 3, [216, 62, 54]); // comb
};
RECIPES.beak = hide([232, 168, 48], 6);
RECIPES.bone = hide([226, 224, 208], 5);

RECIPES.zombie_head = hide([84, 124, 76]);
RECIPES.zombie_face = (t) => {
  t.fill([84, 124, 76], 6);
  t.rect(3, 5, 3, 3, [22, 34, 24]); // sunken eyes
  t.rect(10, 5, 3, 3, [22, 34, 24]);
  t.rect(5, 11, 6, 1, [46, 60, 42]);
  t.flecks(14, [66, 100, 60]);
};
RECIPES.zombie_body = fabric([58, 108, 148]);
RECIPES.zombie_legs = fabric([52, 62, 104]);

// Blaze: hot yellow core, glowing rods.
RECIPES.blaze_core = (t) => t.fill([246, 190, 60], 16).flecks(26, [255, 232, 140]);
RECIPES.blaze_face = (t) => {
  t.fill([246, 190, 60], 12);
  t.rect(3, 5, 3, 3, [60, 34, 8]);
  t.rect(10, 5, 3, 3, [60, 34, 8]);
  t.rect(5, 11, 6, 1, [80, 44, 10]);
};
RECIPES.blaze_rod_mob = (t) => t.fill([240, 166, 40], 14).flecks(18, [255, 224, 120]);

// Enderman: near-black with lit violet eyes.
RECIPES.ender_body = (t) => t.fill([18, 16, 24], 5).flecks(16, [30, 26, 40]);
RECIPES.ender_face = (t) => {
  t.fill([16, 14, 22], 4);
  t.rect(2, 6, 5, 3, [206, 150, 250]);
  t.rect(9, 6, 5, 3, [206, 150, 250]);
  t.rect(3, 7, 3, 1, [246, 226, 255]);
  t.rect(10, 7, 3, 1, [246, 226, 255]);
};

// Dragon: black scales with a purple sheen.
RECIPES.dragon_body = (t) => t.fill([28, 24, 36], 7).flecks(22, [52, 38, 72]);
RECIPES.dragon_head = (t) => t.fill([34, 28, 44], 7).flecks(16, [60, 44, 84]);
RECIPES.dragon_face = (t) => {
  t.fill([34, 28, 44], 6);
  t.rect(2, 5, 5, 3, [214, 92, 244]);
  t.rect(9, 5, 5, 3, [214, 92, 244]);
  t.rect(4, 11, 8, 2, [16, 12, 20]);
  for (let x = 4; x < 12; x += 2) t.set(x, 10, 226, 220, 232); // teeth
};
RECIPES.dragon_wing = (t) => t.fill([40, 32, 56], 8).flecks(20, [66, 50, 96]);

// Player model materials.
const SKIN: RGB = [222, 174, 136];
const HAIR: RGB = [78, 50, 32];

RECIPES.skin = (t) => {
  t.fill(SKIN, 9);
  t.mottle([196, 148, 112], 0.4, 6);
  t.mottle([238, 196, 162], 0.28, 9);
  t.grain(12, 16);
  t.bevel(12);
};

/** Back and sides of the head: hair over the top two-thirds. */
RECIPES.hair = (t) => {
  t.fill(SKIN, 4);
  for (let x = 0; x < TILE; x++) {
    for (let y = 0; y < 11; y++) t.set(x, y, HAIR[0], HAIR[1], HAIR[2]);
  }
  t.flecks(22, [96, 64, 42]);
};

RECIPES.face = (t) => {
  t.fill(SKIN, 4);

  // Hair: a fringe with a slightly ragged edge rather than a flat block.
  for (let x = 0; x < TILE; x++) {
    const depth = 4 + (x % 3 === 0 ? 1 : 0);
    for (let y = 0; y < depth; y++) t.set(x, y, HAIR[0], HAIR[1], HAIR[2]);
  }
  t.set(2, 5, ...HAIR);
  t.set(13, 5, ...HAIR);

  // Brow line grounds the eyes; without it the face reads as a blank oval.
  for (let x = 3; x < 13; x++) t.shade(x, 6, -22);

  t.rect(3, 7, 4, 2, [246, 246, 250]);   // eye whites
  t.rect(9, 7, 4, 2, [246, 246, 250]);
  t.rect(5, 7, 2, 2, [62, 96, 158]);     // irises, looking slightly inward
  t.rect(9, 7, 2, 2, [62, 96, 158]);
  t.set(5, 7, 20, 28, 48);               // pupils
  t.set(10, 7, 20, 28, 48);

  t.rect(7, 9, 2, 2, [196, 146, 112]);   // nose
  t.rect(6, 12, 4, 1, [158, 96, 84]);    // mouth
  t.set(5, 12, 176, 122, 96);
  t.set(10, 12, 176, 122, 96);
};

RECIPES.shirt = (t) => {
  t.fill([58, 122, 168], 6);
  // Collar and a centre seam so the torso is not a flat rectangle.
  for (let x = 0; x < TILE; x++) t.shade(x, 0, 20);
  for (let x = 5; x < 11; x++) t.set(x, 1, 40, 92, 132);
  for (let y = 2; y < TILE; y++) t.shade(8, y, -14);
  t.flecks(12, [46, 104, 146]);
};

RECIPES.sleeve = fabric([52, 110, 152]);

RECIPES.pants = (t) => {
  fabric([56, 60, 96])(t);
  for (let x = 0; x < TILE; x++) t.shade(x, 0, 16); // waistband
  for (let y = 2; y < TILE; y++) t.shade(3, y, -12); // seams
  for (let y = 2; y < TILE; y++) t.shade(12, y, -12);
};

RECIPES.boots = (t) => {
  t.fill([64, 48, 40], 11);
  t.mottle([44, 33, 27], 0.45, 5);
  t.mottle([88, 68, 56], 0.3, 8);
  t.grain(13, 14);
  for (let x = 0; x < TILE; x++) t.shade(x, TILE - 1, -22); // sole
  t.bevel(13);
};

// Vehicle materials. Painted panels get a subtle top-lit sheen so a car body
// doesn't read as a flat slab of colour.
function panel(base: RGB, sheen: number) {
  return (t: Tile) => {
    t.fill(base, 5);
    for (let x = 0; x < TILE; x++) {
      for (let y = 0; y < 4; y++) t.shade(x, y, sheen - y * 3);
    }
    for (let x = 0; x < TILE; x++) t.shade(x, TILE - 1, -14);
  };
}

RECIPES.paint_red = panel([176, 46, 42], 26);
RECIPES.paint_dark = panel([44, 46, 54], 20);
// Chrome was a 207-brightness flat panel: effectively a white slab. Brushed
// metal reads as metal because of the streaks, not the brightness.
RECIPES.chrome = (t) => {
  t.fill([174, 179, 190], 6);
  t.streaks(20);                      // brushed metal, horizontal
  t.mottle([214, 221, 233], 0.35, 3); // broad highlight
  t.mottle([132, 137, 150], 0.3, 5);  // and the shadowed side of it
  t.bevel(26);
};
RECIPES.tire = (t) => {
  t.fill([32, 32, 36], 5);
  // Tread blocks around the edge, hub in the middle.
  for (let i = 0; i < TILE; i += 3) {
    t.rect(i, 0, 2, 2, [20, 20, 22]);
    t.rect(i, TILE - 2, 2, 2, [20, 20, 22]);
  }
  t.disc(7.5, 7.5, 4, [150, 152, 158], 8);
  t.disc(7.5, 7.5, 1.6, [92, 94, 100], 6);
};
RECIPES.headlight = (t) => {
  t.fill([60, 62, 70], 6);
  t.disc(7.5, 7.5, 5, [252, 244, 200], 10);
  t.disc(7.5, 7.5, 2.4, [255, 255, 240], 4);
};
RECIPES.taillight = (t) => {
  t.fill([60, 40, 42], 6);
  t.disc(7.5, 7.5, 4.6, [226, 54, 44], 12);
};
RECIPES.rotor = (t) => {
  t.fill([56, 58, 66], 6);
  for (let x = 0; x < TILE; x++) t.shade(x, 7, 26);
};

RECIPES.hand = (t) => t.fill([214, 162, 124], 8).flecks(10, [190, 138, 102]);

/**
 * Ten mining-progress overlays, drawn on transparent and blended over the
 * targeted block's faces.
 *
 * All ten stages share one seeded draw order, so stage 5 is exactly stage 4
 * plus more cracks rather than an unrelated pattern -- the same block reads
 * as progressively more broken instead of flickering between random shapes.
 */
function crackTile(stage: number) {
  return (t: Tile) => {
    const rng = mulberry32(0x9e3779b1);
    const dark: RGB = [16, 16, 16];
    const segments = 3 + stage * 3;
    let x = 8;
    let y = 8;
    for (let i = 0; i < segments; i++) {
      const angle = rng() * Math.PI * 2;
      const len = 2 + rng() * 3.5;
      const nx = Math.max(1, Math.min(15, x + Math.cos(angle) * len));
      const ny = Math.max(1, Math.min(15, y + Math.sin(angle) * len));
      t.line(x, y, nx, ny, dark, 1);
      // Every third segment branches back out from the centre, so cracks
      // spread across the whole face instead of one long wandering line.
      if (i % 3 === 2) { x = 8; y = 8; } else { x = nx; y = ny; }
    }
  };
}
for (let stage = 0; stage < 10; stage++) {
  RECIPES[`crack_${stage}`] = crackTile(stage);
}

RECIPES.conveyor_n = conveyorTile(0, -1);
RECIPES.conveyor_e = conveyorTile(1, 0);
RECIPES.conveyor_s = conveyorTile(0, 1);
RECIPES.conveyor_w = conveyorTile(-1, 0);

for (const [tier, head] of TOOL_TIERS) {
  RECIPES[`pickaxe_${tier}`] = toolTile('pickaxe', head);
  RECIPES[`axe_${tier}`] = toolTile('axe', head);
  RECIPES[`shovel_${tier}`] = toolTile('shovel', head);
}

/** Armour silhouettes, one shape per slot, tinted per material. */
function armorTile(slot: 'head' | 'chest' | 'legs' | 'feet', tint: RGB) {
  const dark: RGB = [tint[0] * 0.72, tint[1] * 0.72, tint[2] * 0.72];
  // Plate needs a highlight and a shadow, or it reads as a coloured blob at
  // icon size -- iron leggings measured 216 brightness with almost no
  // variation, which is indistinguishable from a white rectangle.
  const lit: RGB = [
    Math.min(255, tint[0] * 1.2), Math.min(255, tint[1] * 1.2), Math.min(255, tint[2] * 1.2),
  ];
  const shadow: RGB = [tint[0] * 0.72, tint[1] * 0.72, tint[2] * 0.72];

  return (t: Tile) => {
    if (slot === 'head') {
      // A helmet: domed crown, a dark visor slot, and cheek guards down
      // either side. The slot is what stops it reading as a bucket.
      t.rect(4, 1, 8, 2, tint, 5);
      t.rect(2, 3, 12, 4, tint, 6);        // crown
      t.rect(2, 7, 3, 5, tint, 6);         // cheek guards
      t.rect(11, 7, 3, 5, tint, 6);
      t.rect(5, 7, 6, 2, dark, 3);         // visor slot
      t.rect(5, 9, 6, 3, tint, 5);         // nose guard below the slot
      t.rect(7, 9, 2, 3, dark, 3);
    } else if (slot === 'chest') {
      // Pauldrons standing proud of a torso, with a neck notch between them.
      t.rect(1, 3, 4, 4, tint, 6);         // left pauldron
      t.rect(11, 3, 4, 4, tint, 6);        // right pauldron
      t.rect(5, 4, 6, 2, tint, 5);         // collar
      t.rect(6, 2, 4, 2, dark, 3);         // neck opening
      t.rect(3, 6, 10, 7, tint, 6);        // torso
      t.rect(6, 8, 4, 4, dark, 3);         // breastplate seam
      t.rect(4, 13, 8, 1, dark, 3);        // hem
    } else if (slot === 'legs') {
      t.rect(3, 2, 10, 3, tint, 6);        // belt
      t.rect(3, 5, 4, 9, tint, 6);         // left leg
      t.rect(9, 5, 4, 9, tint, 6);         // right leg
      t.rect(7, 5, 2, 5, dark, 3);         // the gap between them
      t.rect(4, 3, 8, 1, dark, 3);         // belt line
    } else {
      // Two boots seen from the side: an ankle cuff over a toe that sticks
      // forward, which is the shape a plain rectangle was missing.
      t.rect(2, 5, 4, 6, tint, 6);         // left ankle
      t.rect(1, 11, 6, 3, tint, 6);        // left foot
      t.rect(10, 5, 4, 6, tint, 6);        // right ankle
      t.rect(9, 11, 6, 3, tint, 6);        // right foot
      t.rect(1, 13, 6, 1, dark, 3);        // soles
      t.rect(9, 13, 6, 1, dark, 3);
    }

    // Rake a highlight across the upper-left of the plate and a shadow along
    // the lower-right, so the shape reads as metal rather than a silhouette.
    t.shadeShape(lit, shadow, 0.42);
    t.grain(9, 10);
    t.outline();
  };
}

const ARMOR_MATERIALS: Array<[string, RGB]> = [
  ['leather', [148, 104, 66]],
  ['iron', [214, 214, 220]],
  ['diamond', [104, 226, 220]],
];

for (const [material, tint] of ARMOR_MATERIALS) {
  for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
    RECIPES[`armor_${slot}_${material}`] = armorTile(slot, tint);
  }
}

// A hide, not a picture frame: an irregular piece with the corners knocked
// off, so it reads as a cut skin rather than a bordered square.
RECIPES.leather = (t) => {
  t.rect(2, 4, 12, 8, [150, 106, 68], 8);
  t.rect(3, 3, 9, 1, [150, 106, 68], 6);
  t.rect(4, 12, 8, 1, [150, 106, 68], 6);
  t.rect(2, 4, 2, 1, [0, 0, 0], 0);          // nicked corners
  t.set(2, 4, 0, 0, 0, 0);
  t.set(13, 11, 0, 0, 0, 0);
  t.set(13, 4, 0, 0, 0, 0);
  t.set(2, 11, 0, 0, 0, 0);
  t.rect(5, 6, 4, 3, [128, 88, 54], 5);      // worn patch
  t.celShade(18, -16);
  t.outline([96, 66, 40]);
};

// A quill: a dark shaft with barbs fanning off it, rather than the bare
// diagonal line it used to be.
RECIPES.feather = (t) => {
  const vane: RGB = [244, 244, 248];
  const shade: RGB = [206, 206, 214];
  for (let i = 0; i < 9; i++) {
    const x = 4 + i;
    const y = 12 - i;
    t.rect(x - 2, y, 3, 1, i % 2 === 0 ? vane : shade);   // barbs
    if (i > 1) t.rect(x - 3, y + 1, 2, 1, shade);
  }
  t.line(3, 14, 12, 3, [176, 176, 186], 1);               // shaft
  t.rect(2, 14, 2, 2, [140, 140, 150], 3);                // calamus
  t.celShade(16, -14);
  t.outline([120, 120, 132]);
};

/** Swords: a blade up the diagonal with a crossguard and grip. */
function swordTile(blade: RGB) {
  const dark: RGB = [blade[0] * 0.72, blade[1] * 0.72, blade[2] * 0.72];
  const lit: RGB = [
    Math.min(255, blade[0] * 1.2 + 16),
    Math.min(255, blade[1] * 1.2 + 16),
    Math.min(255, blade[2] * 1.2 + 16),
  ];
  return (t: Tile) => {
    // A 3-unit blade rather than a hairline. At icon size a 1px diagonal is
    // nearly invisible, which is why every tier looked the same: the only
    // thing separating wood from diamond was a colour too thin to read.
    // Like the tools, this is mostly *blade*: a long diagonal running almost
    // corner to corner, with the hilt occupying only the bottom-left eighth.
    t.line(4, 12, 12, 4, blade, 4);
    t.line(4, 14, 11, 7, dark, 1);       // shadowed lower bevel
    t.line(5, 11, 12, 4, lit, 1);        // lit upper bevel
    t.rect(11, 2, 3, 3, blade);          // tip, kept clear of the corner
    t.rect(13, 1, 2, 2, lit);

    // A guard crossing the blade at right angles, and a round pommel at the
    // very corner -- the two things that stop a diagonal reading as a stick.
    // Kept thin: at two units deep it was a slab wider than the blade.
    const guard: RGB = [92, 64, 34];
    for (let i = -3; i <= 3; i++) {
      t.rect(5 + i, 11 + i, 2, 1, i < 0 ? [112, 80, 44] : guard);
    }
    t.line(1, 15, 4, 12, [64, 44, 24], 2);   // grip
    t.disc(1.6, 14.6, 1.7, [48, 34, 18], 4); // pommel

    t.celShade();
    t.outline();
  };
}

for (const [tier, head] of TOOL_TIERS) {
  RECIPES[`sword_${tier}`] = swordTile(head);
}

/*
 * Food.
 *
 * Every food used to be the same disc in a different colour, so a hotbar of
 * eight of them was eight identical circles. Each cut now gets its own
 * silhouette instead -- a chop has a bone, a drumstick has a handle, a steak
 * is a slab -- because at 16px the outline is the only thing distinguishing
 * them, not the tint.
 */

/**
 * A chop: rounded meat with a bone running into it.
 *
 * The bone has to overlap the meat, not sit beside it -- drawn apart it
 * reads as a second unrelated object floating in the corner rather than as
 * part of the cut.
 */
function chopTile(meat: RGB, fat: RGB) {
  return (t: Tile) => {
    t.disc(9, 9, 4.8, meat, 12);
    t.rect(5, 6, 6, 7, meat, 10);      // body, reaching up to the bone
    t.rect(4, 3, 4, 5, fat, 6);        // bone, overlapping the meat below it
    t.rect(5, 7, 3, 2, fat, 5);        // where it enters the meat
    t.disc(10, 10, 1.8, fat, 8);       // marbling
    t.celShade(22, -20);
    t.outline();
  };
}

/** A drumstick: a round meat end on a bone handle. */
function drumstickTile(meat: RGB, bone: RGB) {
  return (t: Tile) => {
    t.disc(10, 6, 4.2, meat, 12);
    t.rect(7, 8, 3, 3, meat, 10);
    t.line(8, 10, 4, 14, bone, 3);     // the bone running down-left
    t.rect(2, 12, 3, 3, bone, 6);      // knuckle
    t.celShade(22, -20);
    t.outline();
  };
}

/** A steak: a thick rectangular slab with marbling. */
function steakTile(meat: RGB, fat: RGB) {
  return (t: Tile) => {
    t.rect(2, 5, 12, 7, meat, 12);
    t.rect(3, 4, 10, 1, meat, 8);
    t.rect(3, 12, 10, 1, meat, 8);
    t.rect(4, 7, 3, 2, fat, 6);        // marbling streaks
    t.rect(9, 9, 3, 2, fat, 6);
    t.celShade(22, -20);
    t.outline();
  };
}

/**
 * A rack of ribs: a wedge that tapers, with bones jutting from its edge.
 *
 * Deliberately not another rectangle -- beef is already a slab, and two
 * rectangles differing only in tint are two items nobody can tell apart in
 * a hotbar.
 */
function ribTile(meat: RGB, fat: RGB) {
  return (t: Tile) => {
    // A pronounced triangular taper: narrow at the top, wide at the bottom.
    // A gentle taper still reads as the same rectangle beef already uses.
    t.rect(6, 2, 4, 2, meat, 9);
    t.rect(5, 4, 6, 2, meat, 10);
    t.rect(4, 6, 8, 2, meat, 11);
    t.rect(2, 8, 11, 3, meat, 12);
    t.rect(1, 11, 13, 3, meat, 12);
    // Bones poking out along the right, drawn last so they stay visible.
    for (let i = 0; i < 3; i++) t.rect(12, 3 + i * 3, 3, 1, fat, 4);
    t.rect(3, 11, 3, 2, fat, 5);        // marbling
    t.celShade(22, -20);
    t.outline();
  };
}

RECIPES.raw_porkchop = chopTile([236, 148, 148], [248, 214, 206]);
RECIPES.cooked_porkchop = chopTile([176, 110, 66], [226, 186, 134]);
RECIPES.raw_beef = steakTile([196, 82, 78], [232, 162, 154]);
RECIPES.steak = steakTile([138, 78, 46], [192, 136, 86]);
RECIPES.raw_mutton = ribTile([222, 128, 122], [246, 202, 194]);
RECIPES.cooked_mutton = ribTile([164, 100, 62], [214, 166, 112]);
RECIPES.raw_chicken = drumstickTile([242, 190, 166], [250, 232, 214]);
RECIPES.cooked_chicken = drumstickTile([198, 146, 86], [238, 210, 158]);

export interface Atlas {
  canvas: HTMLCanvasElement;
  /** [u0, v0, u1, v1] with v0 = top edge of the tile. */
  uv(name: string): [number, number, number, number];
  /** A data URL of one tile, for HUD icons. */
  iconURL(name: string): string;
  /**
   * Replaces tiles with images from a resource pack. Anything the pack does
   * not supply keeps its procedural texture.
   */
  applyOverrides(tiles: Map<string, ImageBitmap>, maxTileSize?: number): number;
  /** Bumped whenever the pixels change, so the GPU texture can be re-uploaded. */
  readonly revision: number;
  /** Current authoring resolution per tile, in pixels. */
  readonly tileSize: number;
}

/**
 * Renders one tile's raw RGBA pixels without touching a canvas -- every
 * other entry point here needs a real DOM, which a plain test runner does
 * not have. Exists so texture quality (contrast, edge presence, that kind
 * of thing) can be measured by a script instead of eyeballed.
 */
export function renderTile(name: string): { px: Uint8ClampedArray; size: number } {
  const tile = new Tile(mulberry32(nameSeed(name)), nameSeed(name));
  const recipe = RECIPES[name];
  if (recipe) recipe(tile);
  else tile.fill([255, 0, 220], 0);
  return { px: tile.px, size: TILE_PX };
}

export function buildAtlas(): Atlas {
  const names = [
    ...new Set([...allTextureNames(), ...allItemTextureNames(), ...EXTRA_TILES]),
  ].sort();
  if (names.length > GRID * GRID) {
    throw new Error(`atlas overflow: ${names.length} tiles > ${GRID * GRID} slots`);
  }

  // Authoring resolution. A high-resolution pack grows this, so its detail
  // survives instead of being crushed down to 16x16.
  let tileSize = TILE_PX;
  let canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  let ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  /** Rebuilds the atlas at a larger tile size, scaling what is already drawn. */
  function growTo(newTileSize: number): void {
    const next = document.createElement('canvas');
    next.width = newTileSize * GRID;
    next.height = newTileSize * GRID;
    const nextCtx = next.getContext('2d')!;
    nextCtx.imageSmoothingEnabled = false; // keep procedural art crisp
    nextCtx.drawImage(canvas, 0, 0, next.width, next.height);
    canvas = next;
    ctx = nextCtx;
    tileSize = newTileSize;
  }

  const slots = new Map<string, number>();
  const icons = new Map<string, string>();

  names.forEach((name, index) => {
    slots.set(name, index);
    const tile = new Tile(mulberry32(nameSeed(name)), nameSeed(name));
    const recipe = RECIPES[name];
    if (recipe) recipe(tile);
    else tile.fill([255, 0, 220], 0); // loud magenta: a missing texture should shout

    const image = new ImageData(tile.px, TILE_PX, TILE_PX);
    ctx.putImageData(image, (index % GRID) * TILE_PX, ((index / GRID) | 0) * TILE_PX);
  });

  /*
   * Half-texel inset: sample at the texel's centre, never at its edge.
   *
   * The comment here long said half a texel while the value was a quarter;
   * this makes them agree, which is the standard for NEAREST sampling.
   *
   * It is NOT the cause of the dark lines on block edges -- widening the
   * inset to four texels made those worse rather than better, which a bleed
   * fix cannot do. Atlas bleed is ruled out; see NEXT.md.
   */
  const inset = 0.5 / ATLAS_SIZE;
  let revision = 0;

  return {
    get canvas() {
      return canvas;
    },
    get revision() {
      return revision;
    },
    applyOverrides(overrides: Map<string, ImageBitmap>, maxTileSize = 128) {
      // Grow the atlas to the pack's resolution first, capped by the setting,
      // so a 64x pack is drawn at 64x rather than squashed into 16x16.
      let packRes = 0;
      for (const image of overrides.values()) {
        packRes = Math.max(packRes, Math.min(image.width, image.height));
      }
      const wanted = Math.min(Math.max(packRes || TILE_PX, TILE_PX), maxTileSize);
      if (wanted > tileSize) growTo(wanted);

      let applied = 0;
      for (const [name, image] of overrides) {
        const index = slots.get(name);
        if (index === undefined) continue;
        const x = (index % GRID) * tileSize;
        const y = ((index / GRID) | 0) * tileSize;
        // Clear first: pack textures may have transparency where ours did not.
        ctx.clearRect(x, y, tileSize, tileSize);
        const side = Math.min(image.width, image.height);
        ctx.drawImage(image, 0, 0, side, side, x, y, tileSize, tileSize);
        icons.delete(name); // the cached HUD icon is now stale
        applied++;
      }
      if (applied > 0) revision++;
      return applied;
    },
    get tileSize() {
      return tileSize;
    },
    uv(name: string) {
      const index = slots.get(name) ?? 0;
      const col = index % GRID;
      const row = (index / GRID) | 0;
      return [
        col / GRID + inset,
        row / GRID + inset,
        (col + 1) / GRID - inset,
        (row + 1) / GRID - inset,
      ];
    },
    iconURL(name: string) {
      let url = icons.get(name);
      if (url) return url;
      const index = slots.get(name) ?? 0;
      const c = document.createElement('canvas');
      c.width = tileSize;
      c.height = tileSize;
      const cx = c.getContext('2d')!;
      cx.imageSmoothingEnabled = false;
      cx.drawImage(canvas,
        (index % GRID) * tileSize, ((index / GRID) | 0) * tileSize, tileSize, tileSize,
        0, 0, tileSize, tileSize);
      url = c.toDataURL();
      icons.set(name, url);
      return url;
    },
  };
}
