/**
 * Measures whether the Faithful-style pass on item icons (outline + crisp
 * banding) actually changed anything, the same way the earlier texture
 * revamp was verified by pixel statistics instead of eyeballing a screenshot.
 * Run: npx tsx tests/itemart.ts
 */

import { renderTile } from '../client/src/gfx/atlas.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

/** Opaque pixels bordering a transparent one: the silhouette outline ring. */
function edgePixelCount(px: Uint8ClampedArray, size: number): number {
  const alphaAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= size || y >= size ? 0 : px[(y * size + x) * 4 + 3];
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (alphaAt(x, y) < 8) continue;
      if (alphaAt(x - 1, y) < 8 || alphaAt(x + 1, y) < 8 ||
          alphaAt(x, y - 1) < 8 || alphaAt(x, y + 1) < 8) count++;
    }
  }
  return count;
}

/** How dark the average outline-ring pixel is, 0 (black) to 255 (white). */
function edgeBrightness(px: Uint8ClampedArray, size: number): number {
  const alphaAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= size || y >= size ? 0 : px[(y * size + x) * 4 + 3];
  let sum = 0;
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (alphaAt(x, y) < 8) continue;
      if (alphaAt(x - 1, y) < 8 || alphaAt(x + 1, y) < 8 ||
          alphaAt(x, y - 1) < 8 || alphaAt(x, y + 1) < 8) {
        sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
        count++;
      }
    }
  }
  return count ? sum / count : 0;
}

/** Spread between the brightest and darkest opaque pixel -- band contrast. */
function toneSpread(px: Uint8ClampedArray, size: number): number {
  let min = 255;
  let max = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
    min = Math.min(min, l);
    max = Math.max(max, l);
  }
  return max - min;
}

const ITEMS = [
  'pickaxe_diamond', 'axe_iron', 'shovel_stone', 'sword_wood',
  'diamond', 'coal', 'iron_ingot', 'gold_ingot',
  'armor_chest_iron', 'cooked_porkchop',
];

for (const name of ITEMS) {
  const { px, size } = renderTile(name);
  const edgeB = edgeBrightness(px, size);
  const edges = edgePixelCount(px, size);
  const spread = toneSpread(px, size);

  check(`${name}: has a silhouette (some transparent pixels)`,
    px.some((_, i) => i % 4 === 3 && px[i] < 8));
  check(`${name}: outline ring exists and is dark`, edges > 0 && edgeB < 70,
    `${edges} edge px, avg brightness ${edgeB.toFixed(0)}`);
  check(`${name}: has real tonal contrast (banding), not a flat fill`, spread > 60,
    `spread ${spread.toFixed(0)}`);
}

// Multi-material check: a tool's wood handle must stay wood-coloured, not get
// pulled toward the metal head's hue by the new shading pass. Search for the
// brownest pixel anywhere in the tile rather than guessing a coordinate --
// the handle stroke is only 1-2px wide, so a fixed point too easily lands on
// the outline ring around its own edge instead of its interior.
{
  const { px, size } = renderTile('pickaxe_iron');
  let best = { r: 0, g: 0, b: 0, brownness: -Infinity };
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const brownness = (r - b) + (g - b) * 0.3; // warm and not grey/blue-metal
    if (brownness > best.brownness) best = { r, g, b, brownness };
  }
  const isBrownish = best.r > best.g && best.g >= best.b - 5 && best.r > 90 && best.b < 140;
  check('a tool handle keeps its own wood colour after cel-shading', isBrownish,
    `brownest pixel found was rgb(${best.r},${best.g},${best.b})`);
}

/**
 * Silhouette distinctness.
 *
 * The eight foods were once the same disc in eight tints, which in a hotbar
 * is eight identical circles -- colour alone does not tell a raw porkchop
 * from a steak at 16 pixels. This compares the alpha masks of items that
 * ought to look like different objects and fails if two are near-identical
 * shapes, which is the only way that regression shows up in numbers.
 */
{
  const mask = (name: string): boolean[] => {
    const { px } = renderTile(name);
    const out: boolean[] = [];
    for (let i = 0; i < px.length; i += 4) out.push(px[i + 3] >= 8);
    return out;
  };

  /** Fraction of pixels where two masks agree. */
  const overlap = (a: boolean[], b: boolean[]): number => {
    let same = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
    return same / a.length;
  };

  // Items that represent visibly different objects. Tiers of the same tool
  // are excluded: a stone and an iron pickaxe *should* share a silhouette.
  const DISTINCT = [
    'raw_porkchop', 'raw_beef', 'raw_chicken', 'raw_mutton',
    'armor_head_iron', 'armor_chest_iron', 'armor_legs_iron', 'armor_feet_iron',
    'pickaxe_iron', 'axe_iron', 'shovel_iron', 'sword_iron',
    'car', 'plane', 'helicopter', 'skateboard',
    'feather', 'leather', 'stick', 'coal', 'diamond', 'iron_ingot',
  ];

  const masks = new Map(DISTINCT.map((n) => [n, mask(n)]));
  let worst = { a: '', b: '', score: 0 };
  for (let i = 0; i < DISTINCT.length; i++) {
    for (let j = i + 1; j < DISTINCT.length; j++) {
      const score = overlap(masks.get(DISTINCT[i])!, masks.get(DISTINCT[j])!);
      if (score > worst.score) worst = { a: DISTINCT[i], b: DISTINCT[j], score };
    }
  }
  check('no two different items share a silhouette', worst.score < 0.95,
    `closest pair: ${worst.a} vs ${worst.b} at ${(worst.score * 100).toFixed(1)}% identical`);

  // And each of the four meats should differ from the others specifically.
  const meats = ['raw_porkchop', 'raw_beef', 'raw_chicken', 'raw_mutton'];
  let worstMeat = { a: '', b: '', score: 0 };
  for (let i = 0; i < meats.length; i++) {
    for (let j = i + 1; j < meats.length; j++) {
      const score = overlap(masks.get(meats[i])!, masks.get(meats[j])!);
      if (score > worstMeat.score) worstMeat = { a: meats[i], b: meats[j], score };
    }
  }
  check('the meats are told apart by shape, not only tint', worstMeat.score < 0.9,
    `closest pair: ${worstMeat.a} vs ${worstMeat.b} at ${(worstMeat.score * 100).toFixed(1)}% identical`);
}

console.log(failures === 0 ? '\nAll item-art checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
