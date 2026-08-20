/**
 * Do adjacent faces agree about the light at the edge they share?
 *
 * Every quad carries light at its four corners and the GPU interpolates
 * between them. Two blocks stacked on a flat wall each emit their own quad,
 * and those quads share an edge. If both compute the same light at that
 * shared edge the wall is continuous; if they disagree, the seam between them
 * is a hard line at every block boundary -- which is what a player would
 * describe as horizontal lines across a wall.
 *
 * The mesher stores `light * face.shade`, and shade depends on which way the
 * face points, so only faces with the same normal are comparable. The normal
 * is recovered per quad from its own corner positions.
 */

import { Dimension, WORLD_Y, SECTION_Y } from '../shared/src/constants.js';
import { ClientWorld } from '../client/src/world.js';
import { meshSection, FLOATS_PER_VERTEX } from '../client/src/mesher.js';

const SEED = 59708;
const atlas = { uv: () => [0, 0, 1, 1] } as any;
const world = new ClientWorld(SEED, Dimension.Overworld);
for (let cx = -1; cx <= 1; cx++) {
  for (let cz = 2; cz <= 4; cz++) world.ensureChunk(cx, cz);
}

type Rec = { lights: number[] };
const shared = new Map<string, Rec>();

let quads = 0;
for (let s = 0; s < WORLD_Y / SECTION_Y; s++) {
  const mesh = meshSection(world, atlas, 0, 3, s, 1);
  if (!mesh) continue;
  for (const part of [mesh.opaque, mesh.alpha]) {
    const v = part.vertices;
    for (let q = 0; q + 4 * FLOATS_PER_VERTEX <= v.length; q += 4 * FLOATS_PER_VERTEX) {
      quads++;
      const p = (k: number) => [
        v[q + k * FLOATS_PER_VERTEX],
        v[q + k * FLOATS_PER_VERTEX + 1],
        v[q + k * FLOATS_PER_VERTEX + 2],
      ];
      const a = p(0), b = p(1), c = p(2);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [
        u[1] * w[2] - u[2] * w[1],
        u[2] * w[0] - u[0] * w[2],
        u[0] * w[1] - u[1] * w[0],
      ];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      const nk = n.map((t) => Math.round(t / len)).join(',');

      for (let k = 0; k < 4; k++) {
        const pos = p(k);
        // The shader draws light * ao, so a disagreement in EITHER shows up
        // as a seam. Comparing only light would miss half the ways this
        // surface can break.
        const light = v[q + k * FLOATS_PER_VERTEX + 5] * v[q + k * FLOATS_PER_VERTEX + 6];
        const key = `${pos[0]},${pos[1]},${pos[2]}|${nk}`;
        let rec = shared.get(key);
        if (!rec) { rec = { lights: [] }; shared.set(key, rec); }
        rec.lights.push(light);
      }
    }
  }
}

let sharedCorners = 0;
let disagreeing = 0;
let worst = 0;
const examples: string[] = [];
const spreads: number[] = [];

for (const [key, rec] of shared) {
  if (rec.lights.length < 2) continue;
  sharedCorners++;
  const min = Math.min(...rec.lights);
  const max = Math.max(...rec.lights);
  const spread = max - min;
  if (spread > 1e-6) {
    disagreeing++;
    spreads.push(spread);
    if (spread > worst) worst = spread;
    if (examples.length < 10) {
      examples.push(`  ${key}   ${rec.lights.map((l) => l.toFixed(3)).join(' vs ')}   spread ${spread.toFixed(3)}`);
    }
  }
}

spreads.sort((a, b) => b - a);
const pct = (a: number, b: number) => (b === 0 ? 0 : (a / b) * 100);

console.log(`seed ${SEED}, chunk (0,3)  -- comparing light * ao, what the shader draws`);
console.log(`quads: ${quads}`);
console.log(`corners shared by 2+ coplanar quads: ${sharedCorners}`);
console.log(`  disagreeing about light:           ${disagreeing}  (${pct(disagreeing, sharedCorners).toFixed(1)}%)`);
console.log(`  worst spread:                      ${worst.toFixed(3)}`);
if (spreads.length) {
  console.log(`  median spread of those:            ${spreads[Math.floor(spreads.length / 2)].toFixed(3)}`);
  console.log(`  spreads over 0.05:                 ${spreads.filter((s) => s > 0.05).length}`);
}

if (disagreeing === 0) {
  console.log('\n=> Coplanar faces agree everywhere. The mesh is continuous;');
  console.log('   the lines are not a lighting seam.');
} else {
  console.log('\nexamples (position | normal   lights):');
  examples.forEach((e) => console.log(e));
  console.log('\n=> Coplanar quads disagree at shared corners. That is a visible');
  console.log('   discontinuity at block boundaries -- the horizontal lines.');
}
