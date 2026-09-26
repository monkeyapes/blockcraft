/**
 * Block icons are drawn from the block's model, not its side texture.
 *
 * Measured rather than eyeballed: a full block has to come out as the
 * inventory hexagon with three separately lit faces, a slab has to be
 * visibly shorter, a thin conduit visibly narrower, and anything that reads
 * better flat (a plant, a torch) has to stay flat. Each of these is what
 * disappears if the renderer quietly falls back to the old flat tile.
 * Run: npx tsx tests/blockicons.ts
 */

import { BLOCKS, Block, blockDef } from '../shared/src/blocks.js';
import { Item, allItemIds, itemDef } from '../shared/src/items.js';
import { crossOf } from '../shared/src/shapes.js';
import { slab } from '../shared/src/shapekit.js';
import { renderTile, type Atlas } from '../client/src/gfx/atlas.js';
import {
  FACE_SHADE, ICON_PX, IconCache, blockIconKind, renderBlockIcon, renderFlatIcon,
  renderModelIcon, type TilePixels,
} from '../client/src/gfx/blockicon.js';
import { buildTabs, matchesSearch } from '../client/src/ui/creative.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

const cache = new Map<string, TilePixels>();
const tiles = (name: string): TilePixels => {
  let t = cache.get(name);
  if (!t) cache.set(name, t = renderTile(name));
  return t;
};

const N = ICON_PX;
const alphaAt = (px: Uint8ClampedArray, x: number, y: number): number => px[(y * N + x) * 4 + 3];
const lum = (px: Uint8ClampedArray, x: number, y: number): number => {
  const i = (y * N + x) * 4;
  return (px[i] + px[i + 1] + px[i + 2]) / 3;
};

/** Opaque bounding box and pixel count. */
function extent(px: Uint8ClampedArray) {
  let x0 = N; let x1 = -1; let y0 = N; let y1 = -1; let area = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (alphaAt(px, x, y) < 16) continue;
      area++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area };
}

function rowWidth(px: Uint8ClampedArray, y: number): number {
  let n = 0;
  for (let x = 0; x < N; x++) if (alphaAt(px, x, y) >= 16) n++;
  return n;
}

/**
 * Height of the silhouette's leftmost vertical edge: the near-left corner
 * post of the model. The top diamond makes every icon a similar overall
 * height, so this is what actually measures how tall a model's sides are.
 */
function sideHeight(px: Uint8ClampedArray): number {
  const x = extent(px).x0 + 1;
  let n = 0;
  for (let y = 0; y < N; y++) if (alphaAt(px, x, y) >= 16) n++;
  return n;
}

/** Mean brightness of a small window. */
function windowLum(px: Uint8ClampedArray, cx: number, cy: number, r = 3): number {
  let sum = 0; let n = 0;
  for (let y = Math.round(cy) - r; y <= Math.round(cy) + r; y++) {
    for (let x = Math.round(cx) - r; x <= Math.round(cx) + r; x++) {
      if (alphaAt(px, x, y) < 16) continue;
      sum += lum(px, x, y); n++;
    }
  }
  return n ? sum / n : -1;
}

// --- a full block is the inventory hexagon ---------------------------------

const stone = renderBlockIcon(Block.Stone, tiles);
const se = extent(stone);
{
  check('Stone is drawn as a model, not a flat tile', blockIconKind(Block.Stone, tiles) === 'model');
  check('Stone fills most of the slot', se.w >= N * 0.75 && se.h >= N * 0.85, `${se.w}x${se.h} of ${N}`);
  // A hexagon standing on a vertex: pointed at the top and the bottom, widest
  // in the middle. A flat tile is equally wide on every row and fails all
  // three at once.
  const topW = rowWidth(stone, se.y0 + 1);
  const botW = rowWidth(stone, se.y1 - 1);
  const midW = rowWidth(stone, Math.round(se.y0 + se.h * 0.35));
  check('Stone silhouette comes to a point at the top', topW < midW * 0.3, `top row ${topW}px, middle ${midW}px`);
  check('Stone silhouette comes to a point at the bottom', botW < midW * 0.3, `bottom row ${botW}px`);
  // A hexagon covers three quarters of its bounding box; a square covers all
  // of it and a diamond half.
  const fill = se.area / (se.w * se.h);
  check('Stone silhouette covers ~3/4 of its bounds, like a hexagon', fill > 0.66 && fill < 0.84, fill.toFixed(3));
}

// --- three faces, three brightnesses --------------------------------------

{
  // On a flat grey tile the faces can only differ by their shading, so this
  // counts exactly the distinct face tones and nothing from the texture.
  const grey: TilePixels = { px: new Uint8ClampedArray(16 * 16 * 4).fill(200), size: 16 };
  const flat = renderModelIcon([{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }],
    ['g', 'g', 'g'], () => grey);
  const tones = new Set<number>();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (alphaAt(flat, x, y) >= 16) tones.add(flat[(y * N + x) * 4]);
  check('a plain cube shows exactly three face tones', tones.size === 3, [...tones].sort((a, b) => b - a).join(', '));
  const fe = extent(flat);
  const top = lum(flat, N / 2, fe.y0 + Math.round(fe.h * 0.2));
  const left = lum(flat, fe.x0 + Math.round(fe.w * 0.25), fe.y0 + Math.round(fe.h * 0.62));
  const right = lum(flat, fe.x0 + Math.round(fe.w * 0.75), fe.y0 + Math.round(fe.h * 0.62));
  check('top face is the brightest, then left, then right', top > left && left > right,
    `top ${top.toFixed(0)}, left ${left.toFixed(0)}, right ${right.toFixed(0)}`);
  check('the face tones follow FACE_SHADE', Math.abs(top - 200 * FACE_SHADE.top) < 2 &&
    Math.abs(left - 200 * FACE_SHADE.left) < 2 && Math.abs(right - 200 * FACE_SHADE.right) < 2);

  // And on the real, busy stone texture the three faces still separate.
  const sTop = windowLum(stone, N / 2, se.y0 + se.h * 0.2);
  const sLeft = windowLum(stone, se.x0 + se.w * 0.25, se.y0 + se.h * 0.62);
  const sRight = windowLum(stone, se.x0 + se.w * 0.75, se.y0 + se.h * 0.62);
  check('Stone: top face brighter than left, left brighter than right',
    sTop > sLeft * 1.08 && sLeft > sRight * 1.08,
    `top ${sTop.toFixed(0)}, left ${sLeft.toFixed(0)}, right ${sRight.toFixed(0)}`);
}

// --- shapes change the icon ------------------------------------------------

{
  const half = renderModelIcon(slab(0.5), blockDef(Block.Stone).textures, tiles);
  const he = extent(half);
  check('a half slab icon is visibly shorter than a full block', he.h < se.h * 0.8, `${he.h}px vs ${se.h}px`);
  check('...and sits at the bottom of the slot, where a block\'s base is', Math.abs(he.y1 - se.y1) <= 1,
    `slab bottom ${he.y1}, block bottom ${se.y1}`);

  const stoneSide = sideHeight(stone);
  const panel = renderBlockIcon(Block.SolarPanel, tiles);
  check('Solar Panel (a 2/16 slab) is a thin plate', sideHeight(panel) < stoneSide * 0.3,
    `side ${sideHeight(panel)}px vs a block's ${stoneSide}px`);

  const cablePx = renderBlockIcon(Block.Chain, tiles);
  const cable = extent(cablePx);
  check('Chain (a thin post) is much narrower than a block', cable.w < se.w * 0.5, `${cable.w}px vs ${se.w}px`);
  // A post this thin shows its top face in the column measured, so its side
  // can read taller than a block's -- never shorter, which is what a
  // squashed post would look like.
  check('...but its sides are at least as tall as a full block\'s', sideHeight(cablePx) >= stoneSide - 3,
    `${sideHeight(cablePx)}px vs ${stoneSide}px`);

  const sorter = renderBlockIcon(Block.Sorter, tiles);
  const flatSorter = renderFlatIcon(itemDef(Block.Sorter).texture, tiles);
  let differs = 0;
  for (let i = 3; i < sorter.length; i += 4) if ((sorter[i] >= 16) !== (flatSorter[i] >= 16)) differs++;
  check('a multi-box machine (Sorter) is not its flat tile', differs > N * N * 0.2, `${differs} px differ`);
}

// --- things that stay flat -------------------------------------------------

{
  // A torch is a picture on a see-through cube; drawn as a cube it is a
  // floating box of stick fragments.
  check('Torch keeps its flat sprite', blockIconKind(Block.Torch, tiles) === 'flat');
  check('Ladder keeps its flat sprite', blockIconKind(Block.Ladder, tiles) === 'flat');
  check('Glass, see-through but solid, is still a cube', blockIconKind(Block.Glass, tiles) === 'model');
  check('Water is a cube', blockIconKind(Block.Water, tiles) === 'model');
  const torch = renderBlockIcon(Block.Torch, tiles);
  const sprite = renderFlatIcon('torch', tiles);
  check('Torch icon is exactly its sprite', torch.every((v, i) => v === sprite[i]));

  const crosses = BLOCKS.filter((d) => d && crossOf(d.id));
  if (crosses.length === 0) {
    console.log('SKIP  no crossed-plant blocks registered in this build');
  } else {
    const bad = crosses.filter((d) => blockIconKind(d.id, tiles) !== 'flat').map((d) => d.name);
    check(`all ${crosses.length} crossed plants fall back to their flat sprite`, bad.length === 0, bad.join(', '));
    const d = crosses[0];
    const icon = renderBlockIcon(d.id, tiles);
    const flat = renderFlatIcon(itemDef(d.id).texture, tiles);
    check(`${d.name}'s icon is its sprite`, icon.every((v, i) => v === flat[i]));
  }
}

// --- every block renders --------------------------------------------------

{
  const blank: string[] = [];
  let models = 0;
  let considered = 0;
  for (const d of BLOCKS) {
    if (!d || d.id === Block.Air) continue;
    // States of one thing with no creative tab -- a crop's growth stages, an
    // open door -- never sit in an inventory, so they need no icon.
    if (d.family && !d.category) continue;
    considered++;
    const px = renderBlockIcon(d.id, tiles);
    if (blockIconKind(d.id, tiles) === 'model') models++;
    let opaque = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] >= 16) opaque++;
    if (opaque < N * N * 0.03) blank.push(d.name);
  }
  check('every block renders a visible icon', blank.length === 0, blank.join(', '));
  check('most blocks are drawn as models', models > considered * 0.7, `${models} models of ${considered} inventory blocks`);
}

// --- the browser cache -----------------------------------------------------

{
  // Items never touch the DOM (they are the atlas's own tile URLs), so the
  // cache's bookkeeping can be driven with a stand-in atlas.
  let revision = 0;
  let calls = 0;
  const fake = {
    get revision() { return revision; },
    iconURL(name: string) { calls++; return `${name}@${revision}`; },
  } as unknown as Atlas;
  const icons = new IconCache(fake);
  const a = icons.url(Item.Diamond);
  icons.url(Item.Diamond);
  check('an icon is made once and then served from the cache', calls === 1 && a === 'diamond@0', `${calls} calls`);
  revision++;
  const b = icons.url(Item.Diamond);
  check('a new atlas revision (a resource pack) drops the cache', calls === 2 && b === 'diamond@1', b);
}

// --- the creative catalogue ---------------------------------------------------

{
  const tabs = buildTabs();
  const everything = new Set(tabs.find((t) => t.id === 'all')!.ids);
  const missing = tabs.flatMap((t) => t.ids).filter((id) => !everything.has(id));
  check('everything in any tab is in Everything, which search spans', missing.length === 0,
    missing.map((id) => itemDef(id).name).join(', '));
  const unlisted = allItemIds().filter((id) => itemDef(id).category && !everything.has(id));
  check('every categorised item is searchable', unlisted.length === 0);
  check('search matches words in any order', matchesSearch('Block of Iron', 'iron block'));
  check('search is case-blind', matchesSearch('Diamond Pickaxe', 'PICK'));
  check('search rejects a word the name lacks', !matchesSearch('Stone', 'iron'));
  check('an empty search matches everything', matchesSearch('Stone', '  '));
}

console.log(failures === 0 ? '\nAll block icon checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
