/**
 * Dresses the launcher in the game's own block art.
 *
 * The Minecraft launcher's most recognisable trait is that its chrome is
 * made of the game's textures rather than flat UI colours -- panels are
 * dirt, headers are stone. Everything here is generated from the same
 * procedural tiles the world is built from, so the launcher and the game
 * cannot drift apart, and it still ships with no image assets.
 */

import { renderTile } from '../gfx/atlas.js';

/**
 * One tile as a CSS url(), optionally darkened.
 *
 * `dim` multiplies brightness: UI chrome has text on top of it, so the raw
 * texture is almost always too loud to sit behind anything readable.
 */
function tileURL(name: string, dim = 1, scale = 3): string {
  const { px, size } = renderTile(name);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < px.length; i += 4) {
    image.data[i] = px[i] * dim;
    image.data[i + 1] = px[i + 1] * dim;
    image.data[i + 2] = px[i + 2] * dim;
    image.data[i + 3] = px[i + 3];
  }
  ctx.putImageData(image, 0, 0);

  // Scale up with smoothing off, so the pixels stay square rather than
  // being blurred by the browser when the pattern repeats.
  const out = document.createElement('canvas');
  out.width = size * scale;
  out.height = size * scale;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(canvas, 0, 0, out.width, out.height);
  return `url("${out.toDataURL('image/png')}")`;
}

/** Paints the launcher chrome with block textures. Safe to call once. */
export function applyLauncherSkin(): void {
  const root = document.documentElement;
  try {
    root.style.setProperty('--tex-dirt', tileURL('dirt', 0.42));
    // Two stones, deliberately: the hero and play bar lay a dark wash over
    // theirs and want it pre-dimmed, while a button has only its bevel for
    // contrast and wants the grain at full strength.
    root.style.setProperty('--tex-stone', tileURL('stone', 0.5));
    root.style.setProperty('--tex-stone-btn', tileURL('stone', 1));
    root.style.setProperty('--tex-planks', tileURL('planks', 1));
    root.style.setProperty('--tex-grass', tileURL('grass_top', 0.75, 4));
  } catch {
    // A browser that cannot give us a 2D canvas still gets the flat CSS
    // colours underneath; the launcher is styled to work without these.
  }
}

/**
 * A small block icon for a world row, picked from the world's own seed so
 * the same save always shows the same block -- the launcher's stand-in for
 * Minecraft's per-installation icons.
 */
const ICON_BLOCKS = [
  'grass_top', 'stone', 'planks', 'cobble', 'sand', 'brick',
  'diamond_ore', 'gold_ore', 'log_top', 'netherrack', 'end_stone', 'quartz',
];

export function worldIconURL(seed: number): string {
  const name = ICON_BLOCKS[Math.abs(seed) % ICON_BLOCKS.length];
  return tileURL(name, 1, 3);
}
