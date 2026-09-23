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
import { ART, EXTRA_TILES } from './art/index.js';
import { TILE_PX, Tile, mulberry32, nameSeed } from './tile.js';

export { TILE_PX } from './tile.js';
export { EXTRA_TILES } from './art/index.js';

/** Every tile the atlas holds, in slot order. */
export function atlasTileNames(): string[] {
  return [...new Set([...allTextureNames(), ...allItemTextureNames(), ...EXTRA_TILES])].sort();
}

/**
 * Tiles per atlas row.
 *
 * Sized from the registries rather than hard-coded. It used to be a constant
 * that had to be bumped by hand every time the tile count crept past it --
 * 12, then 13, then 14 -- and each bump was a crash at startup until someone
 * noticed. Now adding a block simply makes the atlas a row wider.
 */
export const GRID = Math.ceil(Math.sqrt(atlasTileNames().length));
export const ATLAS_SIZE = TILE_PX * GRID;

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
  const recipe = ART[name];
  if (recipe) recipe(tile);
  else tile.fill([255, 0, 220], 0);
  return { px: tile.px, size: TILE_PX };
}

export function buildAtlas(): Atlas {
  const names = atlasTileNames();
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
    const recipe = ART[name];
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

