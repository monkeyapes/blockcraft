/**
 * Inventory icons for blocks, drawn from the block's real model.
 *
 * Every inventory used to show a block as its flat side texture, so a stair,
 * a slab and a plank block were the same brown square in the hotbar and the
 * only way to tell them apart was to hover each one. An icon drawn from the
 * model itself -- the three faces you see of a block sitting on a shelf --
 * says "slab" or "fence" by its outline before anyone reads a name.
 *
 * The core here is a tiny software rasteriser with no DOM in it, so tests
 * can render an icon in Node and measure it. The browser half, at the end,
 * only feeds it tile pixels read back from the atlas canvas and turns the
 * result into data URLs.
 *
 * Crossed plants keep their flat sprite: two crossed planes seen at an
 * angle are a thin muddle, while the sprite is the plant. So do blocks that
 * name their own `icon`, and wall-hugging see-through cubes such as a torch
 * or a ladder, whose "cube" is really a picture painted on air.
 */

import { blockDef } from '@shared/blocks.js';
import { isBlockItem, itemDef } from '@shared/items.js';
import {
  boundsOf, crossOf, isDynamicShape, isFullCube, shapeOf, type Box,
} from '@shared/shapes.js';
import type { Atlas } from './atlas.js';

/** Side of a rendered icon, in pixels. Matches a tile, so both scale alike in CSS. */
export const ICON_PX = 64;

/** One tile's pixels, square, RGBA. */
export interface TilePixels {
  px: Uint8ClampedArray;
  size: number;
}

/** Looks a tile up by name. */
export type TileSource = (name: string) => TilePixels;

/*
 * The camera: the classic inventory three-quarter view, turned 45 degrees
 * and tipped 30 degrees down. At exactly these angles the top face's edges
 * run two pixels across for every one down, the one diagonal a pixel grid
 * draws without stair-step noise -- which is why every block-game inventory
 * settled on them.
 */
const PITCH = Math.PI / 6;
const COS_P = Math.cos(PITCH);
const SIN_P = Math.sin(PITCH);
const INV_SQRT2 = Math.SQRT1_2;

/** Screen position of a model-space point: right, down, and toward the viewer. */
function project(x: number, y: number, z: number): [number, number, number] {
  const across = (x - z) * INV_SQRT2;
  const toward = (x + z) * INV_SQRT2;
  return [across, toward * SIN_P - y * COS_P, toward * COS_P + y * SIN_P];
}

/**
 * Face brightness. Top brightest, then the left (south) face, then the right
 * (east) one: the same light-from-the-upper-left the item icons are shaded
 * with, so blocks and items sit together in one hotbar. The three steps are
 * far enough apart that the faces separate even on a dark, busy texture.
 */
export const FACE_SHADE = { top: 1.0, left: 0.8, right: 0.6, bottom: 0.5 } as const;

interface Face {
  /** Outward normal. */
  n: [number, number, number];
  shade: number;
  /** 0 top, 1 bottom, 2 side -- the slot in a block's [top, bottom, side] textures. */
  slot: 0 | 1 | 2;
  /**
   * Which local axis drives u and v, and whether each runs backwards. Kept
   * identical to the mesher's table, so a partial box shows the same part
   * of its texture in the hand as it does in the world.
   */
  uAxis: 0 | 1 | 2; uFlip: boolean;
  vAxis: 0 | 1 | 2; vFlip: boolean;
}

const FACES: Face[] = [
  { n: [0, 1, 0], shade: FACE_SHADE.top, slot: 0, uAxis: 0, uFlip: false, vAxis: 2, vFlip: false },
  { n: [0, -1, 0], shade: FACE_SHADE.bottom, slot: 1, uAxis: 0, uFlip: false, vAxis: 2, vFlip: true },
  { n: [0, 0, 1], shade: FACE_SHADE.left, slot: 2, uAxis: 0, uFlip: false, vAxis: 1, vFlip: true },
  { n: [0, 0, -1], shade: FACE_SHADE.left, slot: 2, uAxis: 0, uFlip: true, vAxis: 1, vFlip: true },
  { n: [1, 0, 0], shade: FACE_SHADE.right, slot: 2, uAxis: 2, uFlip: true, vAxis: 1, vFlip: true },
  { n: [-1, 0, 0], shade: FACE_SHADE.right, slot: 2, uAxis: 2, uFlip: false, vAxis: 1, vFlip: true },
];

/** Transparent fraction above which a full-cube, non-solid block is really a sprite. */
const SPRITE_CUTOFF = 0.4;

function transparentFraction(tile: TilePixels): number {
  let clear = 0;
  for (let i = 3; i < tile.px.length; i += 4) if (tile.px[i] < 16) clear++;
  return clear / (tile.px.length / 4);
}

/**
 * The boxes an icon shows.
 *
 * A fence or a pane standing alone is only its post, which reads as a stick.
 * Shapes that grow toward their neighbours are therefore also tried with a
 * twin on either side along x, and that version is used when it actually
 * reaches further -- a door or a stair, which do not grow sideways, keep
 * their lone shape.
 */
export function iconBoxes(id: number): Box[] {
  const alone = shapeOf(id);
  if (!isDynamicShape(id)) return alone;
  const joined = shapeOf(id, (dx, dy, dz) => (dy === 0 && dz === 0 && dx !== 0 ? id : 0));
  const a = boundsOf(alone);
  const j = boundsOf(joined);
  if (a && j && j.x1 - j.x0 > a.x1 - a.x0 + 1e-6) return joined;
  return alone;
}

/** Whether a block's icon is its 3D model or a flat sprite. */
export function blockIconKind(id: number, tiles: TileSource): 'model' | 'flat' {
  const def = blockDef(id);
  if (def.icon) return 'flat';
  if (crossOf(id)) return 'flat';
  if (iconBoxes(id).length === 0) return 'flat';
  if (isFullCube(id) && !def.solid && !def.liquid &&
      transparentFraction(tiles(def.textures[2])) > SPRITE_CUTOFF) return 'flat';
  return 'model';
}

/** A tile resampled to the icon size, nearest-neighbour, for sprite icons. */
export function renderFlatIcon(name: string, tiles: TileSource, size = ICON_PX): Uint8ClampedArray {
  const tile = tiles(name);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(tile.size - 1, ((y + 0.5) * tile.size / size) | 0);
    for (let x = 0; x < size; x++) {
      const sx = Math.min(tile.size - 1, ((x + 0.5) * tile.size / size) | 0);
      const s = (sy * tile.size + sx) * 4;
      const d = (y * size + x) * 4;
      out[d] = tile.px[s];
      out[d + 1] = tile.px[s + 1];
      out[d + 2] = tile.px[s + 2];
      out[d + 3] = tile.px[s + 3];
    }
  }
  return out;
}

function faceTexture(box: Box, own: [string, string, string], slot: 0 | 1 | 2): string {
  const tex = box.tex ?? own;
  return typeof tex === 'string' ? tex : tex[slot];
}

/**
 * Rasterises boxes into an RGBA icon.
 *
 * Every face of every box is drawn, back faces included, through a depth
 * buffer: a glass block or a leaf block shows its far edges through its
 * see-through texels, just as it does in the world. Texels under a small
 * alpha are cut out exactly the way the terrain shader discards them.
 *
 * The framing is fixed to a whole unit cube, not fitted to the model, so a
 * slab sits low in its slot and a post stands thin in it: the icon keeps
 * the model's size, which is half of what tells a slab from a block.
 */
export function renderModelIcon(
  boxes: Box[], own: [string, string, string], tiles: TileSource, size = ICON_PX,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const depth = new Float32Array(size * size).fill(-Infinity);

  // Frame the unit cube, grown to take in anything that pokes out of it.
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  const frame = (b: Box): void => {
    for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) {
      const [sx, sy] = project(x, y, z);
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
  };
  frame({ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 });
  for (const b of boxes) frame(b);
  // A 1px margin all round keeps the silhouette clear of the slot's edge.
  const scale = (size - 2) / Math.max(maxX - minX, maxY - minY);
  const offX = size / 2 - ((minX + maxX) / 2) * scale;
  const offY = size / 2 - ((minY + maxY) / 2) * scale;

  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  for (const box of boxes) {
    lo[0] = box.x0; lo[1] = box.y0; lo[2] = box.z0;
    hi[0] = box.x1; hi[1] = box.y1; hi[2] = box.z1;
    for (const face of FACES) {
      const axis = face.n[0] !== 0 ? 0 : face.n[1] !== 0 ? 1 : 2;
      const plane = (face.n[axis] > 0 ? hi : lo)[axis];
      // The two in-plane axes, in ascending order.
      const a = axis === 0 ? 1 : 0;
      const b = axis === 2 ? 1 : 2;
      if (hi[a] - lo[a] <= 0 || hi[b] - lo[b] <= 0) continue;

      const corner = (ca: number, cb: number): [number, number, number] => {
        const p = [0, 0, 0];
        p[axis] = plane; p[a] = ca; p[b] = cb;
        const [sx, sy, sz] = project(p[0], p[1], p[2]);
        return [sx * scale + offX, sy * scale + offY, sz];
      };
      const o = corner(lo[a], lo[b]);
      const pa = corner(hi[a], lo[b]);
      const pb = corner(lo[a], hi[b]);
      const ax = pa[0] - o[0]; const ay = pa[1] - o[1];
      const bx = pb[0] - o[0]; const by = pb[1] - o[1];
      const det = ax * by - ay * bx;
      if (Math.abs(det) < 1e-6) continue; // seen exactly edge-on

      const tile = tiles(faceTexture(box, own, face.slot));
      const ts = tile.size;
      const x0 = Math.max(0, Math.floor(Math.min(o[0], pa[0], pb[0], pa[0] + bx)));
      const x1 = Math.min(size - 1, Math.ceil(Math.max(o[0], pa[0], pb[0], pa[0] + bx)));
      const y0 = Math.max(0, Math.floor(Math.min(o[1], pa[1], pb[1], pa[1] + by)));
      const y1 = Math.min(size - 1, Math.ceil(Math.max(o[1], pa[1], pb[1], pa[1] + by)));
      const dza = pa[2] - o[2];
      const dzb = pb[2] - o[2];

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          // Pixel centre in the face's own (s, t) coordinates, 0..1 each.
          const rx = x + 0.5 - o[0];
          const ry = y + 0.5 - o[1];
          const s = (rx * by - ry * bx) / det;
          const t = (ax * ry - ay * rx) / det;
          if (s < 0 || s > 1 || t < 0 || t > 1) continue;
          const z = o[2] + dza * s + dzb * t;
          const di = y * size + x;
          if (z <= depth[di]) continue;

          const local = [0, 0, 0];
          local[axis] = plane;
          local[a] = lo[a] + (hi[a] - lo[a]) * s;
          local[b] = lo[b] + (hi[b] - lo[b]) * t;
          const fu = face.uFlip ? 1 - local[face.uAxis] : local[face.uAxis];
          const fv = face.vFlip ? 1 - local[face.vAxis] : local[face.vAxis];
          const tx = Math.min(ts - 1, Math.max(0, Math.floor(fu * ts)));
          const ty = Math.min(ts - 1, Math.max(0, Math.floor(fv * ts)));
          const si = (ty * ts + tx) * 4;
          const alpha = tile.px[si + 3];
          if (alpha < 16) continue;

          depth[di] = z;
          const d = di * 4;
          out[d] = tile.px[si] * face.shade;
          out[d + 1] = tile.px[si + 1] * face.shade;
          out[d + 2] = tile.px[si + 2] * face.shade;
          out[d + 3] = alpha;
        }
      }
    }
  }
  return out;
}

/** A block's icon: its model, or its flat sprite when that reads better. */
export function renderBlockIcon(id: number, tiles: TileSource, size = ICON_PX): Uint8ClampedArray {
  if (blockIconKind(id, tiles) === 'flat') return renderFlatIcon(itemDef(id).texture, tiles, size);
  return renderModelIcon(iconBoxes(id), blockDef(id).textures, tiles, size);
}

// --- the browser half -------------------------------------------------------

/**
 * Icon data URLs for anything that can sit in a slot.
 *
 * Block items get the rendered model, everything else the atlas tile, and
 * every UI asks through here so a hotbar, a chest and the creative menu can
 * never disagree about what a thing looks like. Icons are made on first use
 * and cached; the cache is dropped whenever the atlas revision moves, which
 * is what a resource pack being applied looks like from here.
 */
export class IconCache {
  private urls = new Map<number, string>();
  private tilePixels = new Map<string, TilePixels>();
  private revision = -1;

  constructor(private readonly atlas: Atlas) {}

  /** The icon for an item or block id, as a URL for a CSS background. */
  url(id: number): string {
    if (this.atlas.revision !== this.revision) {
      this.revision = this.atlas.revision;
      this.urls.clear();
      this.tilePixels.clear();
    }
    let url = this.urls.get(id);
    if (url) return url;
    url = isBlockItem(id) ? this.blockURL(id) : this.atlas.iconURL(itemDef(id).texture);
    this.urls.set(id, url);
    return url;
  }

  private blockURL(id: number): string {
    const tiles: TileSource = (name) => this.tile(name);
    if (blockIconKind(id, tiles) === 'flat') return this.atlas.iconURL(itemDef(id).texture);
    const px = renderBlockIcon(id, tiles, ICON_PX);
    const canvas = document.createElement('canvas');
    canvas.width = ICON_PX;
    canvas.height = ICON_PX;
    canvas.getContext('2d')!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, ICON_PX, ICON_PX), 0, 0);
    return canvas.toDataURL();
  }

  /**
   * One tile's pixels, read back from the atlas canvas rather than rendered
   * from its recipe, so a resource pack's replacement art is what the icon
   * is built from.
   */
  private tile(name: string): TilePixels {
    let tile = this.tilePixels.get(name);
    if (tile) return tile;
    const [u0, v0] = this.atlas.uv(name);
    const size = this.atlas.tileSize;
    const canvas = this.atlas.canvas;
    const grid = Math.round(canvas.width / size);
    // uv() is inset half a texel; rounding recovers the slot's corner.
    const col = Math.floor(u0 * grid + 1e-3);
    const row = Math.floor(v0 * grid + 1e-3);
    const data = canvas.getContext('2d')!.getImageData(col * size, row * size, size, size).data;
    tile = { px: data, size };
    this.tilePixels.set(name, tile);
    return tile;
  }
}

/** Shared per atlas, so every UI draws from one cache. */
const caches = new WeakMap<Atlas, IconCache>();

/** The icon URL for an item or block id, drawn from this atlas. */
export function itemIconURL(atlas: Atlas, id: number): string {
  let cache = caches.get(atlas);
  if (!cache) {
    cache = new IconCache(atlas);
    caches.set(atlas, cache);
  }
  return cache.url(id);
}
