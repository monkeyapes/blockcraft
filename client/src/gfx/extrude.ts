/**
 * Item models: extruded sprites and miniature blocks.
 *
 * A tool drawn as one flat quad is a sticker: side-on it vanishes, and a
 * sword in the hand has no more substance than a playing card. Real voxel
 * games solve this by extruding the icon -- the picture on the front, its
 * mirror on the back, and a one-texel wall along every edge where an opaque
 * texel meets a transparent one, painted with that edge texel's colour. The
 * result is a thin solid with exactly the icon's silhouette, which is what
 * makes a held sword read as a blade and a hammer as a lump of metal on a
 * stick, from any angle.
 *
 * Blocks go the other way: they are drawn as their own model (the same
 * boxes the mesher draws in the world), so a held slab is a slab and a
 * dropped cable is a cable, not a cube wearing the cable's texture.
 *
 * Geometry is built once per tile or block and cached; the held-item and
 * dropped-item meshes rebuild every frame, and all they do per frame is run
 * the cached corners through one affine transform. The extrusion itself is
 * a pure function of the tile's pixels, so a test can feed it renderTile()
 * output in Node and measure the result.
 */

import { crossOf, isDynamicShape, shapeOf, type Around, type Box } from '@shared/shapes.js';
import { blockDef } from '@shared/blocks.js';
import { itemDef } from '@shared/items.js';
import { FLOATS_PER_VERTEX } from '../mesher.js';
import type { Atlas } from './atlas.js';

/**
 * A cached model: a list of quads, each with four corners in its own model
 * space, texture coordinates as fractions of its tile, one outward normal
 * and the tile it samples. Corners wind counter-clockwise seen from outside.
 */
export interface Model {
  quads: number;
  /** 12 floats per quad: four xyz corners. */
  pos: Float32Array;
  /** 8 floats per quad: four uv pairs, 0..1 across the quad's tile. */
  uv: Float32Array;
  /** 3 floats per quad: the outward unit normal. */
  normal: Float32Array;
  /** The tile each quad samples. */
  tiles: string[];
}

class ModelBuilder {
  pos: number[] = [];
  uv: number[] = [];
  normal: number[] = [];
  tiles: string[] = [];

  quad(corners: number[], uvs: number[], n: [number, number, number], tile: string): void {
    this.pos.push(...corners);
    this.uv.push(...uvs);
    this.normal.push(...n);
    this.tiles.push(tile);
  }

  build(): Model {
    return {
      quads: this.tiles.length,
      pos: new Float32Array(this.pos),
      uv: new Float32Array(this.uv),
      normal: new Float32Array(this.normal),
      tiles: this.tiles,
    };
  }
}

/**
 * The grid a sprite is extruded on. Our icons are authored on sixteen units
 * and rendered at 64 pixels, so the silhouette lives on the 16-grid: walls
 * one pixel apart would be four times the geometry for edges nobody can see.
 * A resource-pack tile that is not a multiple of 16 is taken at face value.
 */
export function spriteGrid(size: number): number {
  return size % 16 === 0 ? 16 : size;
}

/**
 * Which cells of the grid are solid. A cell counts when at least half its
 * pixels are opaque, so a stray anti-aliased pixel neither punches a hole
 * nor grows a wart.
 */
export function spriteMask(px: Uint8ClampedArray, size: number): { grid: number; solid: Uint8Array } {
  const grid = spriteGrid(size);
  const step = size / grid;
  const solid = new Uint8Array(grid * grid);
  for (let cy = 0; cy < grid; cy++) {
    for (let cx = 0; cx < grid; cx++) {
      let opaque = 0;
      for (let y = 0; y < step; y++) {
        for (let x = 0; x < step; x++) {
          if (px[((cy * step + y) * size + cx * step + x) * 4 + 3] >= 128) opaque++;
        }
      }
      solid[cy * grid + cx] = opaque * 2 >= step * step ? 1 : 0;
    }
  }
  return { grid, solid };
}

/**
 * Extrudes a sprite into a solid one texel thick.
 *
 * Model space: the tile spans x -0.5..0.5 (left to right) and y 0.5..-0.5
 * (top to bottom), centred on z = 0 with the picture facing +z. Front and
 * back are greedy rectangles over the solid cells only -- no geometry where
 * the icon is transparent -- and each side wall is a run of edges merged
 * along its row or column, sampling the texels just inside the edge.
 */
export function extrudeSprite(px: Uint8ClampedArray, size: number, tile = ''): Model {
  const { grid: g, solid } = spriteMask(px, size);
  const at = (cx: number, cy: number): boolean =>
    cx >= 0 && cy >= 0 && cx < g && cy < g && solid[cy * g + cx] === 1;
  const X = (cx: number): number => cx / g - 0.5;
  const Y = (cy: number): number => 0.5 - cy / g;
  const h = 0.5 / g;
  const out = new ModelBuilder();

  // Faces: greedy rectangles, grown right then down.
  const used = new Uint8Array(g * g);
  for (let cy = 0; cy < g; cy++) {
    for (let cx = 0; cx < g; cx++) {
      if (!at(cx, cy) || used[cy * g + cx]) continue;
      let w = 1;
      while (at(cx + w, cy) && !used[cy * g + cx + w]) w++;
      let rows = 1;
      grow: while (cy + rows < g) {
        for (let i = 0; i < w; i++) {
          if (!at(cx + i, cy + rows) || used[(cy + rows) * g + cx + i]) break grow;
        }
        rows++;
      }
      for (let r = 0; r < rows; r++) used.fill(1, (cy + r) * g + cx, (cy + r) * g + cx + w);
      const x0 = X(cx), x1 = X(cx + w), yt = Y(cy), yb = Y(cy + rows);
      const u0 = cx / g, u1 = (cx + w) / g, vt = cy / g, vb = (cy + rows) / g;
      out.quad([x0, yb, h, x1, yb, h, x1, yt, h, x0, yt, h],
        [u0, vb, u1, vb, u1, vt, u0, vt], [0, 0, 1], tile);
      out.quad([x0, yt, -h, x1, yt, -h, x1, yb, -h, x0, yb, -h],
        [u0, vt, u1, vt, u1, vb, u0, vb], [0, 0, -1], tile);
    }
  }

  // Walls left and right: runs down a column where the neighbour is open.
  for (const side of [-1, 1] as const) {
    for (let cx = 0; cx < g; cx++) {
      let cy = 0;
      while (cy < g) {
        if (!(at(cx, cy) && !at(cx + side, cy))) { cy++; continue; }
        const start = cy;
        while (cy < g && at(cx, cy) && !at(cx + side, cy)) cy++;
        const x = X(side < 0 ? cx : cx + 1);
        const yt = Y(start), yb = Y(cy);
        const u = (cx + 0.5) / g, vt = start / g, vb = cy / g;
        if (side < 0) {
          out.quad([x, yb, -h, x, yb, h, x, yt, h, x, yt, -h],
            [u, vb, u, vb, u, vt, u, vt], [-1, 0, 0], tile);
        } else {
          out.quad([x, yb, h, x, yb, -h, x, yt, -h, x, yt, h],
            [u, vb, u, vb, u, vt, u, vt], [1, 0, 0], tile);
        }
      }
    }
  }

  // Walls top and bottom: runs along a row where the neighbour is open.
  for (const side of [-1, 1] as const) {
    for (let cy = 0; cy < g; cy++) {
      let cx = 0;
      while (cx < g) {
        if (!(at(cx, cy) && !at(cx, cy + side))) { cx++; continue; }
        const start = cx;
        while (cx < g && at(cx, cy) && !at(cx, cy + side)) cx++;
        const y = Y(side < 0 ? cy : cy + 1);
        const x0 = X(start), x1 = X(cx);
        const v = (cy + 0.5) / g, u0 = start / g, u1 = cx / g;
        if (side < 0) {
          // The top of a run of texels: its outside faces up.
          out.quad([x0, y, -h, x0, y, h, x1, y, h, x1, y, -h],
            [u0, v, u0, v, u1, v, u1, v], [0, 1, 0], tile);
        } else {
          out.quad([x0, y, -h, x1, y, -h, x1, y, h, x0, y, h],
            [u0, v, u1, v, u1, v, u0, v], [0, -1, 0], tile);
        }
      }
    }
  }

  return out.build();
}

// --- miniature blocks ----------------------------------------------------------

/**
 * The six faces of a box, as the mesher lays them out: corners
 * counter-clockwise from outside, and which axis drives each texture
 * coordinate so a partial box shows its share of the tile, not all of it
 * squashed. Kept in step with FACES in mesher.ts.
 */
const BOX_FACES: Array<{
  n: [number, number, number];
  corners: Array<[number, number, number]>;
  uAxis: 0 | 1 | 2; uFlip: boolean;
  vAxis: 0 | 1 | 2; vFlip: boolean;
}> = [
  { n: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], uAxis: 0, uFlip: false, vAxis: 2, vFlip: false },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uAxis: 0, uFlip: false, vAxis: 2, vFlip: true },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uAxis: 0, uFlip: false, vAxis: 1, vFlip: true },
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uAxis: 0, uFlip: true, vAxis: 1, vFlip: true },
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uAxis: 2, uFlip: true, vAxis: 1, vFlip: true },
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uAxis: 2, uFlip: false, vAxis: 1, vFlip: true },
];

/**
 * Neighbours for a block shown on its own. A fence or a pane alone is only
 * a post, which in the hand reads as a stick; pretending there is one of the
 * same block to the east and the west shows the length of fence or the pane
 * of glass the item actually places.
 */
function inARow(block: number): Around {
  return (dx, dy, dz) => (dy === 0 && dz === 0 && dx !== 0 ? block : 0);
}

/**
 * A block as a miniature of its world model, centred on the origin in a
 * unit cube (-0.5..0.5 on every axis). Null for crossed-plane plants, which
 * are shown as their extruded sprite instead.
 */
export function blockModel(block: number): Model | null {
  if (crossOf(block)) return null;
  const def = blockDef(block);
  const boxes: Box[] = shapeOf(block, isDynamicShape(block) ? inARow(block) : undefined);
  const out = new ModelBuilder();
  for (const box of boxes) {
    const lo = [box.x0, box.y0, box.z0];
    const hi = [box.x1, box.y1, box.z1];
    BOX_FACES.forEach((face, f) => {
      // A flat box (a pane, a pressure plate) has no faces edge-on.
      const axis = face.n[0] !== 0 ? 0 : face.n[1] !== 0 ? 1 : 2;
      const a = (axis + 1) % 3, b = (axis + 2) % 3;
      if (hi[a] - lo[a] <= 0 || hi[b] - lo[b] <= 0) return;
      const tex = box.tex ?? def.textures;
      const tile = typeof tex === 'string' ? tex : tex[f === 0 ? 0 : f === 1 ? 1 : 2];
      const corners: number[] = [];
      const uvs: number[] = [];
      for (const [dx, dy, dz] of face.corners) {
        const local = [dx ? hi[0] : lo[0], dy ? hi[1] : lo[1], dz ? hi[2] : lo[2]];
        corners.push(local[0] - 0.5, local[1] - 0.5, local[2] - 0.5);
        const fu = face.uFlip ? 1 - local[face.uAxis] : local[face.uAxis];
        const fv = face.vFlip ? 1 - local[face.vAxis] : local[face.vAxis];
        uvs.push(fu, fv);
      }
      out.quad(corners, uvs, face.n, tile);
    });
  }
  return out.build();
}

// --- reading tiles, and the caches ---------------------------------------------

/** An atlas that also carries its pixels, as the Node test atlas does. */
interface PixelAtlas extends Atlas {
  pixels: Uint8ClampedArray;
  size: number;
}

/**
 * One tile's RGBA pixels, straight from the atlas -- so a resource pack's
 * sword is extruded along its own silhouette, not ours.
 */
export function tilePixels(atlas: Atlas, name: string): { px: Uint8ClampedArray; size: number } {
  const [u0, v0] = atlas.uv(name);
  const size = atlas.tileSize;
  if ('pixels' in atlas) {
    const a = atlas as PixelAtlas;
    const ox = Math.floor(u0 * a.size);
    const oy = Math.floor(v0 * a.size);
    const px = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      px.set(a.pixels.subarray(((oy + y) * a.size + ox) * 4, ((oy + y) * a.size + ox + size) * 4), y * size * 4);
    }
    return { px, size };
  }
  const canvas = atlas.canvas;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.getImageData(
    Math.floor(u0 * canvas.width), Math.floor(v0 * canvas.height), size, size);
  return { px: image.data, size };
}

const sprites = new Map<string, Model>();
let spriteRevision = -1;
let spriteAtlas: Atlas | null = null;
const blocks = new Map<number, Model | null>();

/**
 * The extruded model of a tile, built on first use. A resource pack
 * repaints the atlas and bumps its revision, which throws every sprite away
 * so the next frame re-extrudes along the new silhouettes.
 */
export function spriteModel(atlas: Atlas, name: string): Model {
  if (atlas !== spriteAtlas || atlas.revision !== spriteRevision) {
    sprites.clear();
    spriteAtlas = atlas;
    spriteRevision = atlas.revision;
  }
  let model = sprites.get(name);
  if (!model) {
    const { px, size } = tilePixels(atlas, name);
    model = extrudeSprite(px, size, name);
    sprites.set(name, model);
  }
  return model;
}

/** How an item is modelled: a miniature block, or its extruded icon. */
export function itemModel(atlas: Atlas, id: number, isBlock: boolean): { model: Model; block: boolean } {
  if (isBlock) {
    let model = blocks.get(id);
    if (model === undefined) {
      model = blockModel(id);
      blocks.set(id, model);
    }
    if (model) return { model, block: true };
  }
  return { model: spriteModel(atlas, itemDef(id).texture), block: false };
}

// --- transforms and output -----------------------------------------------------

/** A 3x4 affine matrix, row-major: [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz]. */
export type Mat = number[];

export function identity(): Mat {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
}

/** a then b applied to a point is mul(b, a): the right-hand matrix acts first. */
export function mul(a: Mat, b: Mat): Mat {
  const o: Mat = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c]
        + (c === 3 ? a[r * 4 + 3] : 0);
    }
  }
  return o;
}

export function translate(x: number, y: number, z: number): Mat {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
}

export function scale(s: number): Mat {
  return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0];
}

export function rotX(a: number): Mat {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
}

export function rotY(a: number): Mat {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
}

export function rotZ(a: number): Mat {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0];
}

/** Composes matrices right to left: chain(A, B, C) applies C first. */
export function chain(...ms: Mat[]): Mat {
  return ms.reduce((acc, m) => mul(acc, m), identity());
}

/**
 * How bright a face looks for the way it points, matching the mesher's
 * fixed face shades (top 1, bottom 0.5, north/south 0.8, east/west 0.65)
 * for axis-aligned faces and blending smoothly between them, so a spinning
 * item darkens as it turns away instead of snapping.
 */
export function faceShade(nx: number, ny: number, nz: number): number {
  return nx * nx * 0.65 + nz * nz * 0.8 + ny * ny * (ny > 0 ? 1 : 0.5);
}

/**
 * A growable vertex/index buffer reused frame after frame, so drawing a
 * belt full of items does not allocate a fresh array for every vertex.
 * finish() hands out views; the renderer copies them to the GPU at once.
 */
export class MeshWriter {
  private v = new Float32Array(FLOATS_PER_VERTEX * 1024);
  private i = new Uint32Array(1536);
  private nv = 0;
  private ni = 0;

  reset(): void {
    this.nv = 0;
    this.ni = 0;
  }

  private room(verts: number, idx: number): void {
    if ((this.nv + verts) * FLOATS_PER_VERTEX > this.v.length) {
      const next = new Float32Array(Math.max(this.v.length * 2, (this.nv + verts) * FLOATS_PER_VERTEX));
      next.set(this.v.subarray(0, this.nv * FLOATS_PER_VERTEX));
      this.v = next;
    }
    if (this.ni + idx > this.i.length) {
      const next = new Uint32Array(Math.max(this.i.length * 2, this.ni + idx));
      next.set(this.i.subarray(0, this.ni));
      this.i = next;
    }
  }

  /**
   * Appends a model through matrix m. `light` is the world light at the
   * item; each face is shaded by where it points after the transform.
   */
  model(model: Model, atlas: Atlas, m: Mat, light: number): void {
    this.room(model.quads * 4, model.quads * 6);
    const F = FLOATS_PER_VERTEX;
    const v = this.v;
    let tile = '';
    let rect: [number, number, number, number] = [0, 0, 0, 0];
    for (let q = 0; q < model.quads; q++) {
      if (model.tiles[q] !== tile) {
        tile = model.tiles[q];
        rect = atlas.uv(tile);
      }
      const [u0, v0, u1, v1] = rect;
      const nx0 = model.normal[q * 3], ny0 = model.normal[q * 3 + 1], nz0 = model.normal[q * 3 + 2];
      const nx = m[0] * nx0 + m[1] * ny0 + m[2] * nz0;
      const ny = m[4] * nx0 + m[5] * ny0 + m[6] * nz0;
      const nz = m[8] * nx0 + m[9] * ny0 + m[10] * nz0;
      const len = Math.hypot(nx, ny, nz) || 1;
      const shade = light * faceShade(nx / len, ny / len, nz / len);
      const first = this.nv;
      for (let c = 0; c < 4; c++) {
        const x = model.pos[q * 12 + c * 3];
        const y = model.pos[q * 12 + c * 3 + 1];
        const z = model.pos[q * 12 + c * 3 + 2];
        const o = this.nv * F;
        v[o] = m[0] * x + m[1] * y + m[2] * z + m[3];
        v[o + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
        v[o + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
        v[o + 3] = u0 + (u1 - u0) * model.uv[q * 8 + c * 2];
        v[o + 4] = v0 + (v1 - v0) * model.uv[q * 8 + c * 2 + 1];
        v[o + 5] = shade;
        v[o + 6] = 1;
        this.nv++;
      }
      const ix = this.i;
      ix[this.ni++] = first; ix[this.ni++] = first + 1; ix[this.ni++] = first + 2;
      ix[this.ni++] = first; ix[this.ni++] = first + 2; ix[this.ni++] = first + 3;
    }
  }

  finish(): { vertices: Float32Array; indices: Uint32Array } {
    return {
      vertices: this.v.subarray(0, this.nv * FLOATS_PER_VERTEX),
      indices: this.i.subarray(0, this.ni),
    };
  }
}
