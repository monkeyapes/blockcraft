/**
 * The drawing surface every procedural texture is painted on, and the noise
 * and random sources behind it.
 *
 * Split out of atlas.ts so the art itself can live in separate modules
 * (art/*.ts) -- blocks, items and creatures each in their own file -- while
 * sharing one set of brushes. A texture drawn in any of them is authored on
 * the same 16-unit grid and rendered at the same resolution.
 */

/**
 * The grid generators draw on. Every shape below is specified in these
 * units, which is why raising the rendered resolution did not require
 * touching a single generator.
 */
export const TILE = 16;
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
export const S = TILE_PX / TILE;

export type RGB = [number, number, number];


/**
 * Tileable value noise.
 *
 * The lattice wraps at `period`, so a texture drawn with it still meets its
 * own edges cleanly when the same block repeats across a wall.
 */
export function makeNoise(seed: number) {
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
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function nameSeed(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Tile {
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

/** A texture recipe: draws one tile. */
export type Recipe = (t: Tile) => void;
