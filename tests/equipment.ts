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
import { Block } from '../shared/src/blockids.js';
import { Item } from '../shared/src/itemids.js';
import {
  blockModel, extrudeSprite, faceShade, spriteMask, spriteModel, type Model,
} from '../client/src/gfx/extrude.js';
import { buildHeldMesh, heldAsTool, heldTransform } from '../client/src/gfx/held.js';
import { DROPPED_SPRITE, buildItemMesh } from '../client/src/gfx/itemmesh.js';
import type { DroppedItem } from '../client/src/machines.js';
import { FLOATS_PER_VERTEX } from '../client/src/mesher.js';
import { nodeAtlas } from './diagnostics/offscreen.js';

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

// --- 3D items: extruded icons and miniature blocks ------------------------------------

/** A quad's own winding normal, from its first three corners. */
function windingNormal(m: Model, q: number): [number, number, number] {
  const p = (c: number, k: number): number => m.pos[q * 12 + c * 3 + k];
  const e1 = [p(1, 0) - p(0, 0), p(1, 1) - p(0, 1), p(1, 2) - p(0, 2)];
  const e2 = [p(2, 0) - p(0, 0), p(2, 1) - p(0, 1), p(2, 2) - p(0, 2)];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

function bounds(pos: Float32Array): { lo: number[]; hi: number[] } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], pos[i]);
    hi[i % 3] = Math.max(hi[i % 3], pos[i]);
  }
  return { lo, hi };
}

function dropped(id: number, x: number, y: number, z: number): DroppedItem {
  return { id, x, y, z, vx: 0, vy: 0, vz: 0, count: 1, age: 0, pickupDelay: 0 } as DroppedItem;
}

{
  const { px, size } = renderTile('sword_diamond');
  const sword = extrudeSprite(px, size, 'sword_diamond');
  const { grid: g, solid } = spriteMask(px, size);
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < g && y < g && solid[y * g + x] === 1;

  // Front faces cover every opaque cell exactly once and nothing else.
  const cover = new Int32Array(g * g);
  let fronts = 0;
  let wallsX = 0;
  let wallsY = 0;
  for (let q = 0; q < sword.quads; q++) {
    const { lo, hi } = bounds(sword.pos.subarray(q * 12, q * 12 + 12));
    if (sword.normal[q * 3 + 2] > 0.5) {
      fronts++;
      for (let cy = Math.round((0.5 - hi[1]) * g); cy < Math.round((0.5 - lo[1]) * g); cy++) {
        for (let cx = Math.round((lo[0] + 0.5) * g); cx < Math.round((hi[0] + 0.5) * g); cx++) cover[cy * g + cx]++;
      }
    } else if (Math.abs(sword.normal[q * 3]) > 0.5) {
      wallsX += Math.round((hi[1] - lo[1]) * g);
    } else if (Math.abs(sword.normal[q * 3 + 1]) > 0.5) {
      wallsY += Math.round((hi[0] - lo[0]) * g);
    }
  }
  let wrong = 0;
  for (let i = 0; i < g * g; i++) if (cover[i] !== solid[i]) wrong++;
  check('an extruded sword has faces only where the icon is opaque, each cell once',
    wrong === 0 && fronts > 0, `${wrong} cells wrong, ${fronts} front rectangles`);

  // Every opaque/open boundary gets exactly one texel of wall.
  let edgesX = 0;
  let edgesY = 0;
  for (let y = 0; y < g; y++) {
    for (let x = 0; x < g; x++) {
      if (!at(x, y)) continue;
      if (!at(x - 1, y)) edgesX++;
      if (!at(x + 1, y)) edgesX++;
      if (!at(x, y - 1)) edgesY++;
      if (!at(x, y + 1)) edgesY++;
    }
  }
  check('the sword has a side wall along every edge of its silhouette',
    wallsX === edgesX && wallsY === edgesY && edgesX > 0,
    `walls ${wallsX}+${wallsY}, edges ${edgesX}+${edgesY}`);

  let badWinding = 0;
  for (let q = 0; q < sword.quads; q++) {
    const w = windingNormal(sword, q);
    const n = [sword.normal[q * 3], sword.normal[q * 3 + 1], sword.normal[q * 3 + 2]];
    if (w[0] * n[0] + w[1] * n[1] + w[2] * n[2] < 0.99) badWinding++;
  }
  check('every quad winds outward (the world pass culls back faces)', badWinding === 0,
    `${badWinding} of ${sword.quads} wrong`);

  const b = bounds(sword.pos);
  check('the sword is one texel thick', Math.abs(b.hi[2] - b.lo[2] - 1 / g) < 1e-6,
    `${(b.hi[2] - b.lo[2]).toFixed(4)} vs ${(1 / g).toFixed(4)}`);

  // Merged runs keep the geometry small enough to rebuild every frame.
  check('the sword stays a few hundred quads at most', sword.quads < 260, `${sword.quads} quads`);

  // Walls sample the texel just inside their edge, so the rim is the icon's outline.
  let offEdge = 0;
  for (let q = 0; q < sword.quads; q++) {
    if (Math.abs(sword.normal[q * 3 + 2]) > 0.5) continue;
    const u = (sword.uv[q * 8] + sword.uv[q * 8 + 4]) / 2;
    const v = (sword.uv[q * 8 + 1] + sword.uv[q * 8 + 5]) / 2;
    if (!at(Math.floor(u * g), Math.floor(v * g))) offEdge++;
  }
  check('side walls are painted from opaque edge texels', offEdge === 0, `${offEdge} sample open cells`);

  const blank = extrudeSprite(new Uint8ClampedArray(64 * 64 * 4), 64);
  const full = extrudeSprite(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64);
  check('a blank tile extrudes to nothing, a solid one to a single box',
    blank.quads === 0 && full.quads === 6, `${blank.quads} and ${full.quads} quads`);
}

{
  const stone = blockModel(Block.Stone)!;
  const sb = bounds(stone.pos);
  check('a held stone block is a whole cube', stone.quads === 6
    && sb.lo.every((v) => Math.abs(v + 0.5) < 1e-6) && sb.hi.every((v) => Math.abs(v - 0.5) < 1e-6));

  const panel = blockModel(Block.SolarPanel)!;
  const pb = bounds(panel.pos);
  check('a held solar panel is its own flat model, not a cube',
    Math.abs(pb.hi[1] - pb.lo[1] - 2 / 16) < 1e-6, `height ${(pb.hi[1] - pb.lo[1]).toFixed(3)}`);
  // The side of a slab shows the slab's share of its texture, as in the world.
  let sideV = 0;
  for (let q = 0; q < panel.quads; q++) {
    if (Math.abs(panel.normal[q * 3 + 1]) > 0.5) continue;
    const vs = [1, 3, 5, 7].map((k) => panel.uv[q * 8 + k]);
    sideV = Math.max(sideV, Math.max(...vs) - Math.min(...vs));
  }
  check('its sides sample a slab-high strip of the tile', Math.abs(sideV - 2 / 16) < 1e-6, sideV.toFixed(3));
}

{
  const atlas = nodeAtlas();
  const a = spriteModel(atlas, 'sword_iron');
  check('an extruded sprite is cached between frames', spriteModel(atlas, 'sword_iron') === a);
  const repainted = { ...atlas, revision: atlas.revision + 1 };
  check('a resource pack (atlas revision bump) re-extrudes it', spriteModel(repainted, 'sword_iron') !== a);

  const shadeOk = Math.abs(faceShade(0, 1, 0) - 1) < 1e-9 && Math.abs(faceShade(0, -1, 0) - 0.5) < 1e-9
    && Math.abs(faceShade(0, 0, 1) - 0.8) < 1e-9 && Math.abs(faceShade(1, 0, 0) - 0.65) < 1e-9;
  check('face shading matches the terrain mesher on the axes', shadeOk);

  const F = FLOATS_PER_VERTEX;
  const held = buildHeldMesh(atlas, { item: Item.DiamondSword, swing: 0, bob: 0 });
  const swordQuads = spriteModel(atlas, 'sword_diamond').quads;
  check('the held sword is its extruded model', held.vertices.length === swordQuads * 4 * F,
    `${held.vertices.length / F} vertices`);
  let near = 0;
  for (let i = 0; i < held.vertices.length; i += F) if (held.vertices[i + 2] > -0.2) near++;
  check('the held sword sits in front of the camera', near === 0, `${near} vertices too near`);

  check('swords and pickaxes are held like tools; ingots are not',
    heldAsTool(Item.DiamondSword) && heldAsTool(Item.IronPickaxe) && !heldAsTool(Item.IronIngot));

  // Head up: the icon's top-right (blade tip, tool head) sits above its
  // bottom-left (pommel, handle end) once in the hand.
  const m = heldTransform({ item: Item.DiamondSword, swing: 0, bob: 0 }, 'tool');
  const yOf = (x: number, y: number): number => m[4] * x + m[5] * y + m[7];
  check('a held tool is gripped with its head up', yOf(0.45, 0.45) - yOf(-0.45, -0.45) > 0.25,
    `tip ${yOf(0.45, 0.45).toFixed(2)} vs pommel ${yOf(-0.45, -0.45).toFixed(2)}`);

  const panel = buildHeldMesh(atlas, { item: Block.SolarPanel, swing: 0, bob: 0 });
  check('a held block is drawn as its model',
    panel.vertices.length === blockModel(Block.SolarPanel)!.quads * 4 * F);

  const hand = buildHeldMesh(atlas, { item: null, swing: 0.3, bob: 1 });
  check('an empty hand still draws an arm', hand.indices.length === 36);

  // Dropped items never sink into the floor, whatever the spin and bob.
  let lowest = Infinity;
  let tallest = 0;
  for (let t = 0; t < 6; t += 0.05) {
    const d = buildItemMesh(atlas, [dropped(Item.DiamondSword, 0.5, 10, 0.5), dropped(Block.Stone, 3.5, 10, 0.5)], t);
    let top = -Infinity;
    for (let i = 0; i < d.vertices.length; i += F) {
      lowest = Math.min(lowest, d.vertices[i + 1]);
      if (d.vertices[i] < 2) top = Math.max(top, d.vertices[i + 1]);
    }
    tallest = Math.max(tallest, top - 10);
  }
  check('dropped items float clear of the ground', lowest > 10, `lowest ${(lowest - 10).toFixed(3)} above it`);
  check('a dropped sword stands as tall as its icon', tallest > DROPPED_SPRITE * 0.8,
    `${tallest.toFixed(2)} blocks tall`);
}

function rgb3(c: number[]): string {
  return c.map((v) => v.toFixed(0)).join(',');
}

console.log(failures === 0 ? '\nAll equipment checks passed.' : `\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
