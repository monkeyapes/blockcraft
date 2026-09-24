/**
 * Equipment art: every tool, weapon and armour icon reads as its own name,
 * and every tier as its own material.
 * Run: npx tsx tests/equipment.ts
 *
 * The complaint this answers was concrete -- the sword read as a wrench,
 * the iron shovel as a hammer, the axes as flags -- and "looks fine to me"
 * is how those shipped. So the checks here are measurements: silhouettes
 * are compared pairwise and the whole matrix is printed, tier colours are
 * sampled from the head and nowhere else, and the few features a kind is
 * recognised by (a helmet's open face, the gap between two legs) are looked
 * for directly.
 */

import { renderTile } from '../client/src/gfx/atlas.js';
import { ART } from '../client/src/gfx/art/index.js';
import {
  ARMOR_MAPS, ARMOR_MATERIALS, EQUIPMENT_ART, KIND_TIERS, TOOL_MAPS, TOOL_TIERS,
} from '../client/src/gfx/art/equipment.js';
import { BUCKET, HELMET, LEGS } from '../client/src/gfx/art/equipment-maps.js';
import { TILE, TILE_PX } from '../client/src/gfx/tile.js';
import { allItemIds, itemDef } from '../shared/src/items.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

const S = TILE_PX / TILE;

/** Opaque pixels at the rendered resolution. */
function pixelMask(name: string): boolean[] {
  const { px } = renderTile(name);
  const out: boolean[] = [];
  for (let i = 0; i < px.length; i += 4) out.push(px[i + 3] >= 128);
  return out;
}

/**
 * The silhouette as painted, one flag per authoring unit.
 *
 * Every icon here carries a half-unit dark rim grown outward from its shape.
 * Measured with that rim, any two thin shapes that pass near each other --
 * every tool haft runs the same diagonal -- pick up a unit of overlap that is
 * outline, not shape. A unit counts as painted when at least 13 of its 16
 * pixels are opaque: a real unit has all 16, while rim spills into its
 * neighbours by 8 (one side) or 12 (an inside corner), never more.
 */
function cellMask(name: string): boolean[] {
  const { px } = renderTile(name);
  const out: boolean[] = [];
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let n = 0;
      for (let yy = 0; yy < S; yy++) {
        for (let xx = 0; xx < S; xx++) {
          if (px[((y * S + yy) * TILE_PX + x * S + xx) * 4 + 3] >= 128) n++;
        }
      }
      out.push(n >= 13);
    }
  }
  return out;
}

function iou(a: boolean[], b: boolean[]): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) union++;
  }
  return union === 0 ? 0 : inter / union;
}

/** Mean colour of the units whose map character is one of `chars`. */
function meanColour(name: string, rows: readonly string[], chars: string): [number, number, number] {
  const { px } = renderTile(name);
  const sum = [0, 0, 0];
  let n = 0;
  rows.forEach((row, y) => {
    for (let x = 0; x < TILE; x++) {
      if (!chars.includes(row[x])) continue;
      for (let yy = 0; yy < S; yy++) {
        for (let xx = 0; xx < S; xx++) {
          const i = ((y * S + yy) * TILE_PX + x * S + xx) * 4;
          sum[0] += px[i];
          sum[1] += px[i + 1];
          sum[2] += px[i + 2];
          n++;
        }
      }
    }
  });
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

const dist = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// --- every equipment tile has art ----------------------------------------------

const EXPECTED: string[] = [];
for (const kind of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']) {
  for (const tier of TOOL_TIERS) EXPECTED.push(`${kind}_${tier}`);
}
for (const tier of ['stone', 'iron', 'diamond']) EXPECTED.push(`hammer_${tier}`);
EXPECTED.push('bow', 'arrow', 'shears', 'bucket', 'bucket_water', 'bucket_lava', 'flint_steel', 'drill');
for (const slot of ['head', 'chest', 'legs', 'feet']) {
  for (const material of ARMOR_MATERIALS) EXPECTED.push(`armor_${slot}_${material}`);
}

{
  const missing = EXPECTED.filter((n) => !EQUIPMENT_ART[n]);
  check(`all ${EXPECTED.length} tool, weapon and armour tiles have a recipe`, missing.length === 0,
    missing.join(', '));
  const merged = EXPECTED.filter((n) => ART[n] !== EQUIPMENT_ART[n]);
  check('the art index serves these recipes, not another module\'s', merged.length === 0, merged.join(', '));

  // The registry side: any item already using one of these names must get
  // this art rather than the magenta placeholder.
  const used = allItemIds().map((id) => itemDef(id).texture)
    .filter((t) => /^(pickaxe|axe|shovel|hoe|hammer|sword|armor)_|^(bow|arrow|shears|bucket|bucket_water|bucket_lava|flint_steel|drill)$/.test(t));
  const unserved = used.filter((t) => !ART[t]);
  check('every registered equipment item has its icon drawn', unserved.length === 0,
    `${used.length} in use; unserved: ${unserved.join(', ') || 'none'}`);
}

// --- each icon is a real icon ------------------------------------------------------

{
  const bad: string[] = [];
  const edgeBad: string[] = [];
  const corners: string[] = [];
  for (const name of EXPECTED) {
    const mask = pixelMask(name);
    const cover = mask.filter(Boolean).length / mask.length;
    // Not a speck lost in the slot, not a slab filling it: the thinnest
    // icon here (the arrow) covers about a fifth of the tile, the bulkiest
    // (the chestplate) a little over half.
    if (cover < 0.12 || cover > 0.62) bad.push(`${name} ${(cover * 100).toFixed(0)}%`);

    // The rim: opaque pixels bordering transparency must be dark, or the
    // icon melts into a light background.
    const { px } = renderTile(name);
    const alpha = (x: number, y: number) =>
      x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX ? 0 : px[(y * TILE_PX + x) * 4 + 3];
    let sum = 0;
    let n = 0;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if (alpha(x, y) < 8) continue;
        if (alpha(x - 1, y) >= 8 && alpha(x + 1, y) >= 8 && alpha(x, y - 1) >= 8 && alpha(x, y + 1) >= 8) continue;
        const i = (y * TILE_PX + x) * 4;
        sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
        n++;
      }
    }
    // The bowstring is deliberately unrimmed, so the bow's edge runs lighter.
    if (n === 0 || sum / n > (name === 'bow' ? 95 : 70)) edgeBad.push(`${name} ${(sum / Math.max(1, n)).toFixed(0)}`);
    if (alpha(0, 0) > 0 && alpha(TILE_PX - 1, 0) > 0 && alpha(0, TILE_PX - 1) > 0) corners.push(name);
  }
  check('every icon covers a sensible share of its tile (12%-62%)', bad.length === 0, bad.join(', '));
  check('every icon has a dark outline round its silhouette', edgeBad.length === 0, edgeBad.join(', '));
  check('every icon stands on a transparent background', corners.length === 0, corners.join(', '));
}

// --- no two kinds share a silhouette ----------------------------------------------

/*
 * One icon per kind, diamond where there is a choice. Tiers are excluded by
 * design: a stone and an iron pickaxe *should* be the same shape.
 *
 * The threshold is 0.55, set from the icons this replaced. On this same
 * measure the old helmet and chestplate -- which read alike in a hotbar --
 * overlapped 0.67, the old chestplate and leggings 0.75, and the old pickaxe
 * and axe 0.56. Everything here has to be more distinct than the most
 * distinct of those confusable pairs.
 */
const KINDS: Record<string, string> = {
  pickaxe: 'pickaxe_diamond', axe: 'axe_diamond', shovel: 'shovel_diamond', hoe: 'hoe_diamond',
  hammer: 'hammer_diamond', sword: 'sword_diamond', bow: 'bow', arrow: 'arrow', shears: 'shears',
  bucket: 'bucket', flint: 'flint_steel', drill: 'drill', helmet: 'armor_head_diamond',
  chest: 'armor_chest_diamond', legs: 'armor_legs_diamond', boots: 'armor_feet_diamond',
};
const SIMILAR = 0.55;

{
  const names = Object.keys(KINDS);
  const masks = names.map((k) => cellMask(KINDS[k]));
  const lines = ['        ' + names.map((n) => n.slice(0, 6).padStart(7)).join('')];
  let worst = { a: '', b: '', v: 0 };
  const over: string[] = [];
  names.forEach((a, i) => {
    lines.push(a.slice(0, 7).padEnd(8) + names.map((b, j) => {
      if (i === j) return '     --';
      const v = iou(masks[i], masks[j]);
      if (j > i) {
        if (v > worst.v) worst = { a, b, v };
        if (v >= SIMILAR) over.push(`${a}/${b} ${v.toFixed(2)}`);
      }
      return v.toFixed(2).padStart(7);
    }).join(''));
  });
  console.log('\nSilhouette overlap (IoU of painted units), one icon per kind:');
  console.log(lines.join('\n') + '\n');
  check(`every pair of different kinds overlaps less than ${SIMILAR}`, over.length === 0,
    over.length ? over.join(', ') : `closest: ${worst.a}/${worst.b} at ${worst.v.toFixed(2)}`);

  // The pairs the original complaint named, called out so a regression in
  // exactly those shows up by name.
  const pair = (a: string, b: string) => iou(masks[names.indexOf(a)], masks[names.indexOf(b)]);
  for (const [a, b] of [['sword', 'hammer'], ['shovel', 'hammer'], ['axe', 'hoe'], ['pickaxe', 'hammer'],
    ['helmet', 'chest'], ['chest', 'legs']] as const) {
    check(`${a} and ${b} are shaped differently`, pair(a, b) < SIMILAR, pair(a, b).toFixed(2));
  }
}

// --- tiers: one shape, different material ---------------------------------------

{
  const shapeBad: string[] = [];
  const colourBad: string[] = [];
  let closest = { what: '', d: Infinity };
  const kinds: Array<[string, readonly string[], readonly string[]]> = [
    ...Object.entries(TOOL_MAPS).map(([k, rows]) => [k, rows, KIND_TIERS[k]] as [string, readonly string[], readonly string[]]),
    ...Object.entries(ARMOR_MAPS).map(([slot, rows]) =>
      [`armor_${slot}`, rows, ARMOR_MATERIALS] as [string, readonly string[], readonly string[]]),
  ];
  for (const [kind, rows, tiers] of kinds) {
    const masks = tiers.map((t) => cellMask(`${kind}_${t}`));
    const cols = tiers.map((t) => meanColour(`${kind}_${t}`, rows, 'HLMDS'));
    for (let i = 0; i < tiers.length; i++) {
      for (let j = i + 1; j < tiers.length; j++) {
        const v = iou(masks[i], masks[j]);
        if (v <= 0.85) shapeBad.push(`${kind} ${tiers[i]}/${tiers[j]} ${v.toFixed(2)}`);
        const d = dist(cols[i], cols[j]);
        if (d < closest.d) closest = { what: `${kind} ${tiers[i]}/${tiers[j]}`, d };
        if (d < 45) colourBad.push(`${kind} ${tiers[i]}/${tiers[j]} ${d.toFixed(0)}`);
      }
    }
  }
  check('the tiers of each kind share one silhouette (IoU > 0.85)', shapeBad.length === 0, shapeBad.join(', '));
  check('the tiers of each kind differ clearly in colour', colourBad.length === 0,
    colourBad.length ? colourBad.join(', ') : `closest: ${closest.what}, ${closest.d.toFixed(0)} apart`);

  // And the colour says the right material, not merely a different one.
  const head = (name: string, rows: readonly string[]) => meanColour(name, rows, 'HLMDS');
  const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
  const lum = (c: number[]) => (c[0] + c[1] + c[2]) / 3;
  const wood = head('pickaxe_wood', TOOL_MAPS.pickaxe);
  const stone = head('pickaxe_stone', TOOL_MAPS.pickaxe);
  const iron = head('pickaxe_iron', TOOL_MAPS.pickaxe);
  const diamond = head('pickaxe_diamond', TOOL_MAPS.pickaxe);
  const leather = head('armor_chest_leather', ARMOR_MAPS.chest);
  const rgb = (c: number[]) => c.map((v) => v.toFixed(0)).join(',');
  check('wood reads warm brown', wood[0] > wood[2] + 50 && wood[0] > wood[1], rgb(wood));
  check('stone reads mid grey', sat(stone) < 20 && lum(stone) > 90 && lum(stone) < 160, rgb(stone));
  check('iron reads pale silver, well above stone', sat(iron) < 25 && lum(iron) > lum(stone) + 50, rgb(iron));
  check('diamond reads cyan', diamond[1] > diamond[0] + 70 && diamond[2] > diamond[0] + 70, rgb(diamond));
  check('leather reads brown', leather[0] > leather[2] + 40, rgb(leather));
}

// --- the features each piece is recognised by -------------------------------------

/** Transparent units with painted units somewhere to their left and right in the same row. */
function enclosedGaps(mask: boolean[], rows: [number, number]): number {
  let n = 0;
  for (let y = rows[0]; y <= rows[1]; y++) {
    const row = mask.slice(y * TILE, y * TILE + TILE);
    const first = row.indexOf(true);
    const last = row.lastIndexOf(true);
    if (first < 0) continue;
    for (let x = first + 1; x < last; x++) if (!row[x]) n++;
  }
  return n;
}

/** Number of 4-connected painted regions. */
function components(mask: boolean[]): number {
  const seen = new Array(mask.length).fill(false);
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    n++;
    const stack = [i];
    seen[i] = true;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % TILE;
      const y = (c / TILE) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= TILE || ny >= TILE) continue;
        const j = ny * TILE + nx;
        if (mask[j] && !seen[j]) {
          seen[j] = true;
          stack.push(j);
        }
      }
    }
  }
  return n;
}

{
  // A helmet is a dome over an open face: the lower half has a hole the
  // width of a face between its cheek guards. A chestplate has none.
  const helmetLow: [number, number] = [8, 12];
  const helmetGap = enclosedGaps(cellMask('armor_head_iron'), helmetLow);
  const chestGap = enclosedGaps(cellMask('armor_chest_iron'), helmetLow);
  check('the helmet has an open face between cheek guards', helmetGap >= 12 && chestGap === 0,
    `helmet ${helmetGap} open units, chestplate ${chestGap}`);

  // The dome: the helmet's top row is narrower than its widest row.
  const widths = HELMET.map((r) => r.replace(/\./g, '').length).filter((w) => w > 0);
  check('the helmet has a rounded crown', widths[0] <= Math.max(...widths) - 6,
    `crown ${widths[0]} units wide, brim ${Math.max(...widths)}`);

  // Leggings: two legs with daylight between them for most of their length.
  const legRows = LEGS.map((r) => r.slice(7, 9)).filter((s, y) => y >= 4 && s === '..').length;
  check('the leggings have a gap between the legs', legRows >= 8, `${legRows} rows of gap`);

  check('the boots are a pair: two separate pieces', components(cellMask('armor_feet_iron')) === 2,
    `${components(cellMask('armor_feet_iron'))} pieces`);

  // A bucket's contents show through its open top: dark when empty, blue
  // with water, bright orange with lava.
  const empty = meanColour('bucket', BUCKET, 'w');
  const water = meanColour('bucket_water', BUCKET, 'w');
  const lava = meanColour('bucket_lava', BUCKET, 'w');
  check('an empty bucket shows a dark hollow', (empty[0] + empty[1] + empty[2]) / 3 < 80, rgb3(empty));
  check('a water bucket shows blue', water[2] > water[0] + 80, rgb3(water));
  check('a lava bucket glows orange', lava[0] > 220 && lava[0] > lava[2] + 120, rgb3(lava));
  const bucketShapes = ['bucket', 'bucket_water', 'bucket_lava'].map(cellMask);
  check('the three buckets are the same bucket', iou(bucketShapes[0], bucketShapes[1]) === 1 &&
    iou(bucketShapes[0], bucketShapes[2]) === 1);

  // The bowstring: a thin light line from nock to nock, not a second limb.
  const { px } = renderTile('bow');
  let light = 0;
  for (let k = 0; k < 40; k++) {
    const x = Math.round((13.4 - (k / 40) * 10.8) * S);
    const y = Math.round((2.6 + (k / 40) * 10.8) * S);
    const i = (y * TILE_PX + x) * 4;
    if (px[i + 3] > 128 && px[i] > 200) light++;
  }
  check('the bow is strung', light >= 36, `${light}/40 samples on the string`);
}

function rgb3(c: number[]): string {
  return c.map((v) => v.toFixed(0)).join(',');
}

console.log(failures === 0 ? '\nAll equipment checks passed.' : `\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
