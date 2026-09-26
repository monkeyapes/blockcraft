/**
 * Material, food and vehicle icons: present, legible, and different from
 * each other in outline.
 *
 * What a player sees of an item in a hotbar is its silhouette. Colour alone
 * does not tell a snowball from a pearl at 32 pixels, so beyond "the recipe
 * exists" this measures the alpha masks themselves: every icon fills a sane
 * share of its tile and has a dark ring round it; each raw / cooked pair
 * keeps one outline but changes colour unmistakably; and different things
 * do not share an outline.
 * Run: npx tsx tests/itemicons.ts
 */

import { ART } from '../client/src/gfx/art/index.js';
import { renderTile } from '../client/src/gfx/atlas.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

/** Every texture art/items.ts is responsible for. */
const OWNED = [
  // materials
  'stick', 'coal', 'iron_ingot', 'gold_ingot', 'copper_ingot', 'diamond', 'ruby', 'leather',
  'feather', 'blaze_rod', 'blaze_powder', 'ender_pearl', 'eye_of_ender', 'snowball',
  'bone_item', 'string', 'slimeball', 'fuse_powder', 'bone_meal', 'sugar',
  // food and farming
  'raw_porkchop', 'cooked_porkchop', 'raw_beef', 'steak', 'raw_mutton', 'cooked_mutton',
  'raw_chicken', 'cooked_chicken', 'raw_fish', 'cooked_fish', 'raw_rabbit', 'cooked_rabbit',
  'wheat_seeds', 'wheat', 'bread', 'carrot', 'potato', 'baked_potato', 'pumpkin_pie',
  'apple', 'melon_slice',
  // placeables and vehicles
  'door_wood_item', 'boat', 'truck', 'skateboard', 'car', 'plane', 'helicopter',
];

interface Icon { px: Uint8ClampedArray; size: number; mask: boolean[] }
const icons = new Map<string, Icon>();
for (const name of OWNED) {
  if (!ART[name]) continue;
  const { px, size } = renderTile(name);
  const mask: boolean[] = [];
  for (let i = 3; i < px.length; i += 4) mask.push(px[i] >= 8);
  icons.set(name, { px, size, mask });
}

// --- present -----------------------------------------------------------------

{
  const missing = OWNED.filter((n) => !ART[n]);
  check(`all ${OWNED.length} owned icons have a recipe`, missing.length === 0, missing.join(', '));
  const magenta = [...icons].filter(([, { px }]) => {
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 200 && px[i] === 255 && px[i + 1] === 0 && px[i + 2] === 220) return true;
    }
    return false;
  }).map(([n]) => n);
  check('no icon renders as the missing-texture magenta', magenta.length === 0, magenta.join(', '));
}

// --- legible -----------------------------------------------------------------

/**
 * Coverage bounds. Under ~10% an icon is a scatter of specks that vanishes
 * against a slot; over 75% it is a filled square, with no silhouette left
 * to recognise. Seeds are the sparse extreme and a vehicle the full one.
 */
const MIN_COVER = 0.10;
const MAX_COVER = 0.75;

/** Mean brightness of the silhouette ring, and of everything inside it. */
function ringAndInside({ px, size }: Icon): { ring: number; inside: number } {
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= size || y >= size ? 0 : px[(y * size + x) * 4 + 3]);
  let ring = 0; let rn = 0; let inside = 0; let inn = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (a(x, y) < 8) continue;
      const i = (y * size + x) * 4;
      const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
      if (a(x - 1, y) < 8 || a(x + 1, y) < 8 || a(x, y - 1) < 8 || a(x, y + 1) < 8) { ring += l; rn++; } else { inside += l; inn++; }
    }
  }
  return { ring: rn ? ring / rn : 0, inside: inn ? inside / inn : 0 };
}

for (const [name, icon] of icons) {
  const cover = icon.mask.filter(Boolean).length / icon.mask.length;
  const { ring, inside } = ringAndInside(icon);
  // The ring is dark in absolute terms, or at least clearly darker than the
  // body it encloses -- a white bone's ring is grey rather than black, and
  // still separates it from a pale slot.
  const outlined = ring < 80 || ring < inside * 0.6;
  check(`${name}: covers ${(cover * 100).toFixed(0)}% of its tile, and is outlined`,
    cover >= MIN_COVER && cover <= MAX_COVER && outlined,
    `ring ${ring.toFixed(0)} vs inside ${inside.toFixed(0)}`);
}

// --- raw and cooked ----------------------------------------------------------

function iou(a: boolean[], b: boolean[]): number {
  let both = 0; let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) either++;
  }
  return either ? both / either : 1;
}

function meanColour({ px }: Icon): [number, number, number] {
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
  }
  return [r / n, g / n, b / n];
}

const PAIRS: Array<[string, string]> = [
  ['raw_porkchop', 'cooked_porkchop'], ['raw_beef', 'steak'], ['raw_mutton', 'cooked_mutton'],
  ['raw_chicken', 'cooked_chicken'], ['raw_fish', 'cooked_fish'], ['raw_rabbit', 'cooked_rabbit'],
  ['potato', 'baked_potato'],
];

/**
 * Colour distance a pair must clear: the length of the RGB difference
 * between the two icons' mean colours. 45 is roughly the gap between a
 * pink and a tan -- far past anything a lighting change or jitter makes.
 */
const MIN_COOK_SHIFT = 45;

for (const [raw, cooked] of PAIRS) {
  const a = icons.get(raw)!;
  const b = icons.get(cooked)!;
  const shape = iou(a.mask, b.mask);
  const [r1, g1, b1] = meanColour(a);
  const [r2, g2, b2] = meanColour(b);
  const shift = Math.hypot(r1 - r2, g1 - g2, b1 - b2);
  check(`${raw} / ${cooked}: same outline`, shape > 0.9, `IoU ${shape.toFixed(2)}`);
  check(`${raw} / ${cooked}: clearly different colour, cooked darker`,
    shift > MIN_COOK_SHIFT && r2 + g2 + b2 < r1 + g1 + b1, `mean colour moved ${shift.toFixed(0)}`);
}

// --- different things look different -----------------------------------------

/**
 * Silhouettes that ought to be different objects, compared pairwise by
 * intersection-over-union of their alpha masks.
 *
 * Excluded on purpose: raw/cooked pairs (checked above to MATCH), the three
 * ingots (one object in three metals), and pearl / eye (the eye is the pearl,
 * awakened).
 *
 * The bar is measured, not picked: the IoU of a disc and a square of the
 * same area, both centred -- the classic pair of shapes anyone tells apart
 * at a glance. Any two centred compact icons score fairly high, because
 * most of each sits in the middle of the tile, so an absolute figure like
 * 0.5 would fail every pair of foods; but two items more alike than a
 * circle and a square really are the same outline in two colours. (Before
 * this pass bread and pumpkin pie scored 0.92, coal and potato 0.90.)
 */
function discVsSquare(): number {
  const n = 64;
  const r = 5 * (n / 16);
  const half = (Math.sqrt(Math.PI) * r) / 2;
  const disc: boolean[] = [];
  const square: boolean[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - n / 2;
      const dy = y + 0.5 - n / 2;
      disc.push(dx * dx + dy * dy <= r * r);
      square.push(Math.abs(dx) <= half && Math.abs(dy) <= half);
    }
  }
  return iou(disc, square);
}
const MAX_IOU = Number(discVsSquare().toFixed(2));
const DISTINCT = [
  'stick', 'coal', 'iron_ingot', 'diamond', 'ruby', 'leather', 'feather', 'blaze_rod',
  'blaze_powder', 'ender_pearl', 'snowball', 'bone_item', 'string', 'slimeball',
  'fuse_powder', 'bone_meal', 'sugar',
  'raw_porkchop', 'raw_beef', 'raw_mutton', 'raw_chicken', 'raw_fish', 'raw_rabbit',
  'wheat_seeds', 'wheat', 'bread', 'carrot', 'potato', 'pumpkin_pie', 'apple', 'melon_slice',
  'door_wood_item', 'boat', 'truck', 'skateboard', 'car', 'plane', 'helicopter',
];
{
  const scores: Array<[number, string, string]> = [];
  for (let i = 0; i < DISTINCT.length; i++) {
    for (let j = i + 1; j < DISTINCT.length; j++) {
      const a = icons.get(DISTINCT[i])!;
      const b = icons.get(DISTINCT[j])!;
      scores.push([iou(a.mask, b.mask), DISTINCT[i], DISTINCT[j]]);
    }
  }
  scores.sort((x, y) => y[0] - x[0]);
  console.log('      most alike:', scores.slice(0, 6).map(([s, a, b]) => `${a}/${b} ${s.toFixed(2)}`).join(', '));
  const clashes = scores.filter(([s]) => s > MAX_IOU);
  check(`no two of ${DISTINCT.length} distinct items share an outline (IoU <= ${MAX_IOU})`,
    clashes.length === 0, clashes.map(([s, a, b]) => `${a}/${b} ${s.toFixed(2)}`).join(', '));
}

console.log(failures === 0 ? '\nAll item icon checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
