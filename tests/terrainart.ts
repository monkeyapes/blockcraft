/**
 * The terrain and material tiles, measured against what they were drawn to
 * do. Run: npx tsx tests/terrainart.ts
 *
 * tests/blockart.ts asks whether a tile tiles and is not blank. This asks
 * whether it is the right *kind* of picture: pixel art on the 16-unit grid
 * rather than filtered noise, a deliberate tone ramp whose shadows shift hue
 * instead of merely darkening, one light direction across the set, and
 * materials that stay distinguishable by their structure -- stone, cobble,
 * gravel and bedrock are all grey, so brightness alone cannot be what tells
 * them apart. It also pins the layout contracts other code depends on: the
 * torch tile that a stick model samples, the opaque leaves, the see-through
 * glass and ladder.
 *
 * Everything is read back from the rendered tile, the same pixels the atlas
 * uploads, so a recipe can be rewritten any way it likes and still pass as
 * long as the picture keeps these properties.
 */

import { renderTile } from '../client/src/gfx/atlas.js';
import { TILE, TILE_PX } from '../client/src/gfx/tile.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- reading a tile back as its 16x16 cells ---------------------------------

type RGBA = [number, number, number, number];
const K = TILE_PX / TILE;
const wrap = (n: number): number => ((n % TILE) + TILE) % TILE;
const at = (x: number, y: number): number => wrap(y) * TILE + wrap(x);

interface Cells {
  /** One colour per authoring unit, read from the unit's top-left pixel. */
  c: RGBA[];
  /** Units whose K x K real pixels are not all the same colour. */
  mixed: number;
}

const cache = new Map<string, Cells>();
function cells(name: string): Cells {
  let got = cache.get(name);
  if (got) return got;
  const { px, size } = renderTile(name);
  const c: RGBA[] = [];
  let mixed = 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = (y * K * size + x * K) * 4;
      const first: RGBA = [px[i], px[i + 1], px[i + 2], px[i + 3]];
      c.push(first);
      let flat = true;
      for (let dy = 0; dy < K && flat; dy++) {
        for (let dx = 0; dx < K; dx++) {
          const j = ((y * K + dy) * size + x * K + dx) * 4;
          if (px[j] !== first[0] || px[j + 1] !== first[1] || px[j + 2] !== first[2] || px[j + 3] !== first[3]) {
            flat = false;
            break;
          }
        }
      }
      if (!flat) mixed++;
    }
  }
  got = { c, mixed };
  cache.set(name, got);
  return got;
}

const lum = (c: RGBA): number => (c[0] + c[1] + c[2]) / 3;
const key = (c: RGBA): string => `${c[0]},${c[1]},${c[2]}`;

/** Tones covering at least `min` cells, darkest first. */
function tones(name: string, min = 5): Array<{ colour: RGBA; count: number }> {
  const counts = new Map<string, { colour: RGBA; count: number }>();
  for (const c of cells(name).c) {
    if (c[3] < 8) continue;
    const k = key(c);
    const e = counts.get(k) ?? { colour: c, count: 0 };
    e.count++;
    counts.set(k, e);
  }
  return [...counts.values()].filter((e) => e.count >= min).sort((a, b) => lum(a.colour) - lum(b.colour));
}

/** Sizes of the connected groups of cells matching `mask`, largest first. */
function groups(mask: boolean[], diagonal: boolean): number[][] {
  const seen = new Array<boolean>(TILE * TILE).fill(false);
  const out: number[][] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const members: number[] = [];
    const stack = [s];
    seen[s] = true;
    while (stack.length) {
      const q = stack.pop()!;
      members.push(q);
      const x = q % TILE;
      const y = (q / TILE) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || (!diagonal && dx && dy)) continue;
          const j = at(x + dx, y + dy);
          if (mask[j] && !seen[j]) {
            seen[j] = true;
            stack.push(j);
          }
        }
      }
    }
    out.push(members);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** How many runs of same-coloured, edge-touching cells the tile breaks into. */
function runs(c: RGBA[]): number {
  const seen = new Array<boolean>(c.length).fill(false);
  let n = 0;
  for (let s = 0; s < c.length; s++) {
    if (seen[s]) continue;
    n++;
    const stack = [s];
    seen[s] = true;
    while (stack.length) {
      const q = stack.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = at((q % TILE) + dx, ((q / TILE) | 0) + dy);
        if (!seen[j] && key(c[j]) === key(c[q]) && c[j][3] === c[q][3]) {
          seen[j] = true;
          stack.push(j);
        }
      }
    }
  }
  return n;
}

// The tiles this module owns and redrew as pixel art.
const TERRAIN = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobble', 'sand', 'gravel', 'bedrock',
  'log_top', 'log_side', 'leaves', 'planks', 'brick', 'glass', 'water', 'lava', 'glowstone',
  'torch', 'ladder', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'iron_block', 'quartz',
  'crafting_top', 'crafting_side', 'furnace_top', 'furnace_front', 'chest_top', 'chest_side',
  'bed_top', 'bed_side', 'netherrack', 'soul_sand', 'obsidian', 'nether_brick', 'portal',
  'end_stone', 'end_frame_top', 'end_frame_side', 'end_frame_eye', 'end_portal', 'purpur',
];

// Surfaces that are a material rather than a picture of an object: these are
// the ones the ramp, hue-shift and cluster rules are about.
const MATERIALS = [
  'grass_top', 'dirt', 'stone', 'cobble', 'sand', 'bedrock', 'log_side', 'leaves', 'planks',
  'brick', 'water', 'lava', 'glowstone', 'quartz', 'netherrack', 'soul_sand', 'obsidian',
  'nether_brick', 'portal', 'end_stone', 'purpur',
];

// --- pixel art on the grid ----------------------------------------------------

// Every unit is one flat colour. Filtered noise at the rendered resolution
// is exactly the "mush" these tiles replaced: it averages to one flat tone a
// few blocks away, where flat 16-unit cells still read.
for (const name of TERRAIN) {
  const { mixed } = cells(name);
  check(`${name}: drawn in flat cells on the 16-unit grid`, mixed === 0, `${mixed} mixed cells`);
}

// Clusters, not static: on average a cell belongs to a run of same-coloured
// neighbours. Random per-cell noise over five tones averages about 1.6.
// Gravel is loose grit by design and allowed finer grain; the rest of the
// materials must clump.
for (const name of MATERIALS) {
  const mean = (TILE * TILE) / runs(cells(name).c);
  check(`${name}: features clump into clusters`, mean >= 2.5, `mean run ${mean.toFixed(2)} cells`);
}

// --- tone ramps --------------------------------------------------------------

// A deliberate ramp: four to eight tones that each cover a real share of the
// surface, spanning a readable range. Fewer and the surface is flat paint;
// many more and it is noise again.
for (const name of MATERIALS) {
  const t = tones(name);
  const span = lum(t[t.length - 1].colour) - lum(t[0].colour);
  check(`${name}: uses a real tone ramp`, t.length >= 4 && t.length <= 8 && span >= 30,
    `${t.length} tones spanning ${span.toFixed(0)}`);
}

/** Chromaticity: a colour with its brightness divided out. */
function chroma(c: RGBA): [number, number, number] {
  const s = c[0] + c[1] + c[2] || 1;
  return [c[0] / s, c[1] / s, c[2] / s];
}

// Shadows shift hue rather than just darkening. If a material's darkest
// tone were its lightest scaled down, their chromaticities would be equal;
// they must differ visibly.
for (const name of MATERIALS) {
  const t = tones(name);
  const dark = chroma(t[0].colour);
  const light = chroma(t[t.length - 1].colour);
  const shift = Math.hypot(dark[0] - light[0], dark[1] - light[1], dark[2] - light[2]);
  check(`${name}: shadows are hue-shifted, not just darker`, shift >= 0.03, `shift ${shift.toFixed(3)}`);
}

// And for the ordinary lit materials the shift goes the painter's way: the
// shadow is cooler -- a larger share of blue -- than the highlight. Lava and
// glowstone are light sources, whose darkest tones are embers, and are left
// out.
for (const name of MATERIALS.filter((n) => n !== 'lava' && n !== 'glowstone')) {
  const t = tones(name);
  const dark = chroma(t[0].colour);
  const light = chroma(t[t.length - 1].colour);
  check(`${name}: shadows run cool, highlights warm`, dark[2] > light[2],
    `blue share ${dark[2].toFixed(3)} dark vs ${light[2].toFixed(3)} light`);
}

// --- one light, from the upper left ------------------------------------------

/**
 * For a surface of raised pieces separated by recessed gaps, the rim of a
 * piece just below-right of a gap is its upper-left edge, facing the light;
 * the rim just above-left of a gap is its lower-right edge, facing away.
 * Returns how much brighter the first set is than the second.
 */
function rimLighting(name: string, isGap: (c: RGBA) => boolean): number {
  const { c } = cells(name);
  const gap = c.map(isGap);
  let lit = 0;
  let litN = 0;
  let dim = 0;
  let dimN = 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = at(x, y);
      if (gap[i]) continue;
      const afterGap = gap[at(x - 1, y)] || gap[at(x, y - 1)];
      const beforeGap = gap[at(x + 1, y)] || gap[at(x, y + 1)];
      if (afterGap && !beforeGap) {
        lit += lum(c[i]);
        litN++;
      } else if (beforeGap && !afterGap) {
        dim += lum(c[i]);
        dimN++;
      }
    }
  }
  return litN && dimN ? lit / litN - dim / dimN : 0;
}

const darkest = (name: string) => {
  const d = key(tones(name)[0].colour);
  return (c: RGBA) => key(c) === d;
};
const greyish = (c: RGBA) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 30;

for (const [name, isGap] of [
  ['cobble', darkest('cobble')],
  ['planks', darkest('planks')],
  ['nether_brick', darkest('nether_brick')],
  ['glowstone', (c: RGBA) => lum(c) < 110],
  ['brick', greyish],
] as const) {
  const d = rimLighting(name, isGap);
  check(`${name}: pieces are lit from the upper left`, d >= 8, `upper-left rims ${d.toFixed(1)} brighter`);
}

// --- look-alike materials, told apart by structure ------------------------------

interface Structure {
  /** Share of the darkest fifth of cells joined into one network. */
  network: number;
  /** Share of those dark cells with dark on all four sides: thick voids, not lines. */
  thickness: number;
  /** Mean size of a same-colour run. */
  grain: number;
  /** (90th - 10th percentile brightness) / mean: contrast independent of how bright. */
  contrast: number;
  /** Distinct colours used. */
  palette: number;
}

function structure(name: string): Structure {
  const { c } = cells(name);
  const L = c.map(lum);
  const sorted = [...L].sort((a, b) => a - b);
  const dark = L.map((v) => v <= sorted[Math.floor(0.2 * sorted.length)]);
  const nets = groups(dark, true);
  const darkN = dark.filter(Boolean).length;
  let inner = 0;
  for (let s = 0; s < dark.length; s++) {
    if (!dark[s]) continue;
    const x = s % TILE;
    const y = (s / TILE) | 0;
    if (dark[at(x + 1, y)] && dark[at(x - 1, y)] && dark[at(x, y + 1)] && dark[at(x, y - 1)]) inner++;
  }
  const mean = L.reduce((a, b) => a + b, 0) / L.length;
  return {
    network: nets[0].length / darkN,
    thickness: inner / darkN,
    grain: c.length / runs(c),
    contrast: (sorted[Math.floor(0.9 * 255)] - sorted[Math.floor(0.1 * 255)]) / mean,
    palette: new Set(c.map(key)).size,
  };
}

// Each look-alike has a structural signature, and it must hold for that
// material and for none of the others -- otherwise the signature is not what
// tells them apart.
const SIGNATURES: Record<string, [string, (s: Structure) => boolean]> = {
  stone: ['soft mottling: broad runs, low contrast, no network of cracks',
    (s) => s.grain >= 4.5 && s.contrast < 0.6 && s.network < 0.7],
  cobble: ['stones in mortar: dark cells form one thin connected network',
    (s) => s.network >= 0.85 && s.thickness <= 0.05 && s.contrast >= 0.6 && s.contrast < 1.4],
  gravel: ['loose grit: fine grain in many colours',
    (s) => s.grain <= 2.2 && s.palette >= 10],
  bedrock: ['voids in rock: thick dark masses at harsh contrast',
    (s) => s.thickness >= 0.1 && s.contrast >= 1.4],
};
const LOOKALIKES = Object.keys(SIGNATURES);
for (const name of LOOKALIKES) {
  const s = structure(name);
  const [what, test] = SIGNATURES[name];
  const imposters = LOOKALIKES.filter((other) => other !== name && test(structure(other)));
  check(`${name}: reads as ${what}`, test(s),
    `network ${s.network.toFixed(2)} thickness ${s.thickness.toFixed(2)} grain ${s.grain.toFixed(2)} contrast ${s.contrast.toFixed(2)} palette ${s.palette}`);
  check(`${name}: no other grey stone shares that signature`, imposters.length === 0,
    imposters.join(', '));
}

// --- grass side --------------------------------------------------------------

{
  const { c } = cells('grass_side');
  const green = (p: RGBA) => p[1] > p[0] + 10 && p[1] > p[2] + 10;
  const depth: number[] = [];
  for (let x = 0; x < TILE; x++) {
    let d = 0;
    while (d < TILE && green(c[at(x, d)])) d++;
    depth.push(d);
  }
  const distinct = new Set(depth).size;
  let longestRun = 1;
  let run = 1;
  for (let x = 1; x < TILE * 2; x++) {
    run = depth[wrap(x)] === depth[wrap(x - 1)] ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
  }
  check('grass_side: turf covers the whole top edge', Math.min(...depth) >= 2, depth.join(''));
  check('grass_side: the fringe hangs irregularly',
    distinct >= 3 && Math.max(...depth) - Math.min(...depth) >= 3 && longestRun <= 4,
    `depths ${depth.join(',')}; longest flat run ${longestRun}`);
  check('grass_side: turf never reaches the lower half',
    Math.max(...depth) <= TILE / 2, `deepest ${Math.max(...depth)}`);

  // Each drip casts a shadow onto the soil directly under it.
  const dirt = cells('dirt').c;
  const soilMean = dirt.reduce((a, p) => a + lum(p), 0) / dirt.length;
  const shadowed = depth.filter((d, x) => lum(c[at(x, d)]) < soilMean - 20).length;
  check('grass_side: the fringe casts a shadow on the soil', shadowed === TILE,
    `${shadowed}/${TILE} columns shadowed`);

  // Below the fringe and its shadow the soil is the dirt block's own, so a
  // grass block on dirt shows no join.
  let differ = 0;
  for (let x = 0; x < TILE; x++) {
    for (let y = depth[x] + 1; y < TILE; y++) if (key(c[at(x, y)]) !== key(dirt[at(x, y)])) differ++;
  }
  check('grass_side: its soil is the dirt block\'s soil', differ === 0, `${differ} cells differ`);
}

// --- see-through and opaque contracts ---------------------------------------

{
  const { px } = renderTile('leaves');
  let holes = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) holes++;
  // Leaves are an opaque block: neighbours' faces behind them are culled, so
  // any see-through texel would show straight into the void.
  check('leaves: no transparent texels at all', holes === 0, `${holes} non-opaque pixels`);
}

{
  const { px } = renderTile('glass');
  let clear = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 64) clear++;
  const share = clear / (px.length / 4);
  const { c } = cells('glass');
  let frame = 0;
  for (let i = 0; i < TILE; i++) {
    for (const j of [at(i, 0), at(0, i), at(i, TILE - 1), at(TILE - 1, i)]) if (c[j][3] === 255) frame++;
  }
  const glints = c.filter((p, i) => {
    const x = i % TILE;
    const y = (i / TILE) | 0;
    return x > 0 && y > 0 && x < TILE - 1 && y < TILE - 1 && p[3] >= 100 && lum(p) >= 220;
  }).length;
  check('glass: mostly transparent', share >= 0.7, `${(share * 100).toFixed(0)}% clear`);
  check('glass: a solid frame all the way round', frame === TILE * 4, `${frame}/${TILE * 4}`);
  check('glass: carries a couple of glints', glints >= 4, `${glints} glint cells`);
}

{
  const { c } = cells('ladder');
  const clear = c.filter((p) => p[3] === 0).length;
  check('ladder: see-through between the rails and rungs', clear >= 100 && clear <= 200, `${clear} clear cells`);
  // Rails run the full height; rungs repeat every four rows so a tall
  // ladder stacks without a hitch at each block.
  const railsSolid = [2, 3, 12, 13].every((x) => [...Array(TILE).keys()].every((y) => c[at(x, y)][3] === 255));
  check('ladder: two rails run the full height', railsSolid);
  let periodic = true;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) if (c[at(x, y)][3] !== c[at(x, y + 4)][3]) periodic = false;
  }
  check('ladder: rungs repeat every four rows', periodic);
  const rungRows = [...Array(TILE).keys()].filter((y) => [...Array(8).keys()].every((i) => c[at(4 + i, y)][3] === 255));
  check('ladder: has rungs spanning the rails', rungRows.length >= 4, `rows ${rungRows.join(',')}`);
}

// The torch contract. A stick model x 7..9, z 7..9, y 0..10 (sixteenths)
// samples this tile at its own coordinates: its sides are columns 7-8 over
// rows 6-15, and its top face is columns 7-8 over rows 7-8 (the mesher maps
// a top face's v to z). Anything drawn outside that window would never be
// seen; anything transparent inside it would be a hole in the stick.
{
  const { c } = cells('torch');
  let outside = 0;
  let inside = 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const inStick = (x === 7 || x === 8) && y >= 6;
      const a = c[at(x, y)][3];
      if (inStick && a === 255) inside++;
      if (!inStick && a !== 0) outside++;
    }
  }
  check('torch: stick columns 7-8, rows 6-15, fully opaque', inside === 20, `${inside}/20`);
  check('torch: everything else fully transparent', outside === 0, `${outside} stray cells`);
  const flame = [at(7, 6), at(8, 6), at(7, 7), at(8, 7)].map((i) => c[i]);
  check('torch: rows 6-7 burn bright and warm',
    flame.every((p) => lum(p) >= 150 && p[0] >= p[2] + 50), flame.map(key).join(' | '));
  const wood = [];
  for (let y = 9; y < TILE; y++) wood.push(c[at(7, y)], c[at(8, y)]);
  check('torch: rows 9-15 are wood', wood.every((p) => p[0] > p[1] && p[1] > p[2] && lum(p) >= 50 && lum(p) <= 150),
    `${wood.filter((p) => !(p[0] > p[1] && p[1] > p[2])).length} non-brown`);
  const top = [at(7, 7), at(8, 7), at(7, 8), at(8, 8)].map((i) => c[i]);
  check('torch: the 2x2 top face is flame and ember, not bare wood',
    top.every((p) => p[0] >= 190 && p[0] >= p[2] + 120), top.map(key).join(' | '));
}

// --- ores ----------------------------------------------------------------------

{
  const stone = cells('stone').c;
  const stoneTones = new Set(stone.map(key));
  const ORES = ['coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore'];
  interface Deposits { groups: number[][]; colour: [number, number, number] }
  const deposits: Record<string, Deposits> = {};
  for (const name of ORES) {
    const { c } = cells(name);
    const mask = c.map((p) => !stoneTones.has(key(p)));
    const sum = [0, 0, 0];
    let n = 0;
    c.forEach((p, i) => {
      if (!mask[i]) return;
      sum[0] += p[0];
      sum[1] += p[1];
      sum[2] += p[2];
      n++;
    });
    deposits[name] = { groups: groups(mask, false), colour: [sum[0] / n, sum[1] / n, sum[2] / n] };
    // Outside its deposits an ore is the stone block, cell for cell, apart
    // from the seat shadow darkening the rock under each one -- which is
    // what makes a vein read as embedded in the same rock.
    let foreign = 0;
    c.forEach((p, i) => {
      if (mask[i] || key(p) === key(stone[i])) return;
      if (lum(p) >= lum(stone[i])) foreign++;
    });
    check(`${name}: set into the stone block's own surface`, foreign === 0, `${foreign} cells neither stone nor shadow`);
  }

  const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const shapeOf = (g: number[]) => {
    const xs = g.map((q) => q % TILE);
    const ys = g.map((q) => (q / TILE) | 0);
    // Deposits never straddle the wrap in a way that matters here; unwrap
    // by taking the span as seen.
    const w = Math.max(...xs) - Math.min(...xs) + 1;
    const h = Math.max(...ys) - Math.min(...ys) + 1;
    const set = new Set(g.map((q) => `${q % TILE},${(q / TILE) | 0}`));
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const quarterTurn = g.every((q) => {
      const x = q % TILE - cx;
      const y = ((q / TILE) | 0) - cy;
      return set.has(`${cx - y},${cy + x}`);
    });
    // Elongation along the deposit's own principal axis, so a vein running
    // on the diagonal -- whose bounding box is square -- still counts as long.
    const mx = xs.reduce((a, b) => a + b, 0) / g.length;
    const my = ys.reduce((a, b) => a + b, 0) / g.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < g.length; i++) {
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
      sxy += (xs[i] - mx) * (ys[i] - my);
    }
    const half = (sxx + syy) / 2;
    const spread = Math.sqrt(Math.max(0, half * half - (sxx * syy - sxy * sxy)));
    const elongation = Math.sqrt((half + spread) / Math.max(half - spread, 0.05 * g.length));
    return { size: g.length, elongation, fill: g.length / (w * h), quarterTurn };
  };
  const shapes = Object.fromEntries(ORES.map((n) => [n, deposits[n].groups.map(shapeOf)]));
  type Shape = ReturnType<typeof shapeOf>;
  const TRAITS: Record<string, [string, (s: Shape[]) => boolean]> = {
    coal_ore: ['big blocky lumps', (s) => median(s.map((d) => d.size)) >= 7 && median(s.map((d) => d.elongation)) < 1.6],
    iron_ore: ['many small round nuggets', (s) => s.length >= 6 && median(s.map((d) => d.size)) <= 4 && median(s.map((d) => d.fill)) === 1],
    gold_ore: ['long thin veins', (s) => median(s.map((d) => d.elongation)) >= 1.6 && median(s.map((d) => d.fill)) < 0.6],
    diamond_ore: ['cut crystals', (s) => s.filter((d) => d.quarterTurn && d.fill < 0.7 && d.size >= 5).length >= s.length * 0.75],
  };
  for (const name of ORES) {
    const [what, test] = TRAITS[name];
    const others = ORES.filter((o) => o !== name && test(shapes[o]));
    check(`${name}: deposits are ${what}`, test(shapes[name]),
      shapes[name].map((d) => `${d.size}c/${d.elongation.toFixed(1)}e/${d.fill.toFixed(2)}f${d.quarterTurn ? '/sym' : ''}`).join(' '));
    check(`${name}: no other ore's deposits share that shape`, others.length === 0, others.join(', '));
  }
  for (let i = 0; i < ORES.length; i++) {
    for (let j = i + 1; j < ORES.length; j++) {
      const a = deposits[ORES[i]].colour;
      const b = deposits[ORES[j]].colour;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      check(`${ORES[i]} and ${ORES[j]}: different in colour too`, d >= 50, `distance ${d.toFixed(0)}`);
    }
  }
}

// --- liquids and light ---------------------------------------------------------

{
  const water = cells('water').c;
  const alphas = new Set(water.map((p) => p[3]));
  check('water: evenly see-through', alphas.size === 1 && [...alphas][0] >= 150 && [...alphas][0] <= 230,
    `alpha ${[...alphas].join(',')}`);
  check('water: blue all through', water.every((p) => p[2] > p[1] && p[1] > p[0]));
  const crests = water.filter((p) => lum(p) >= 170).length;
  check('water: bright crests on the swell', crests >= 4 && crests <= 40, `${crests} crest cells`);

  const lava = cells('lava').c;
  check('lava: opaque', lava.every((p) => p[3] === 255));
  const hot = lava.filter((p) => lum(p) >= 170).length;
  const crust = lava.filter((p) => lum(p) <= 80).length;
  check('lava: glowing seams and cooled crust both show', hot >= 8 && crust >= 12, `${hot} hot, ${crust} crust cells`);
  check('lava: never blue', lava.every((p) => p[0] > p[2] + 60));

  const glow = cells('glowstone').c;
  check('glowstone: white-hot crystal cores', glow.filter((p) => lum(p) >= 235).length >= 4);
}

// --- objects that must read as what they are -------------------------------------

{
  const fire = (p: RGBA) => p[0] >= 190 && p[0] > p[2] + 100 && p[1] > p[2];
  const front = cells('furnace_front').c;
  const lowerFire = front.filter((p, i) => fire(p) && ((i / TILE) | 0) >= 8).length;
  const upperFire = front.filter((p, i) => fire(p) && ((i / TILE) | 0) < 8).length;
  check('furnace_front: fire burning low in the firebox', lowerFire >= 12 && upperFire === 0,
    `${lowerFire} low, ${upperFire} high`);
  const mouth = front.filter((p) => lum(p) < 40).length;
  check('furnace_front: a dark mouth around the fire', mouth >= 12, `${mouth} dark cells`);

  const top = cells('crafting_top').c;
  const grooved = [5, 10].every((k) =>
    [...Array(TILE - 2).keys()].every((i) => lum(top[at(k, i + 1)]) < 80 && lum(top[at(i + 1, k)]) < 80));
  check('crafting_top: a three-by-three grid cut into it', grooved);

  const side = cells('crafting_side').c;
  const steel = side.filter((p) => greyish(p) && lum(p) >= 100).length;
  check('crafting_side: tools hang on it', steel >= 12, `${steel} steel cells`);

  const chest = cells('chest_side').c;
  const latch = [at(7, 5), at(8, 5), at(7, 6), at(8, 6)].map((i) => chest[i]);
  check('chest_side: a gold latch in the middle', latch.every((p) => p[0] > 150 && p[0] > p[2] + 60),
    latch.map(key).join(' | '));
  check('chest_side: a dark gap between lid and body',
    [...Array(TILE - 4).keys()].filter((i) => lum(chest[at(i + 2, 6)]) < 50).length >= 8);

  const bed = cells('bed_top').c;
  const white = bed.filter((p, i) => ((i / TILE) | 0) < 8 && lum(p) >= 190).length;
  const red = bed.filter((p, i) => ((i / TILE) | 0) >= 8 && p[0] > 120 && p[0] > 2 * p[1]).length;
  check('bed_top: pillow and sheet at the head, red blanket below', white >= 60 && red >= 100,
    `${white} white, ${red} red`);
}

console.log(failures === 0 ? '\nall terrain-art checks passed' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
