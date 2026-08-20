/**
 * Diagnostic: is any *visible* face dark?
 *
 * The section-boundary hypothesis is dead -- the dark rate is flat across
 * Y mod 16. And counting dark vertices, which is what NEXT.md did, cannot
 * find this bug: a face sealed inside the terrain is *supposed* to be black,
 * so most of that 18.6% is correct behaviour and pure noise.
 *
 * The question that discriminates is narrower. Every emitted face looks out
 * onto some voxel. If that voxel is air the sky reaches, the face is one a
 * player can see, and it must not be at the ambient floor. If that voxel is
 * sealed-in air, the face is hidden and its darkness is irrelevant.
 *
 * So: enumerate exposed faces, split them on whether the air they face is lit,
 * and report only the ones that are both visible and black.
 */

import { Block, blockDef, isOpaque } from '../shared/src/blocks.js';
import { CHUNK_X, CHUNK_Z, Dimension, WORLD_Y } from '../shared/src/constants.js';
import { ClientWorld } from '../client/src/world.js';

const SEED = 59708;
const world = new ClientWorld(SEED, Dimension.Overworld);
for (let cx = -1; cx <= 1; cx++) {
  for (let cz = 2; cz <= 4; cz++) world.ensureChunk(cx, cz);
}

const NORMALS: Array<[number, number, number, string]> = [
  [0, 1, 0, 'top'], [0, -1, 0, 'bottom'],
  [0, 0, 1, 'north'], [0, 0, -1, 'south'],
  [1, 0, 0, 'east'], [-1, 0, 0, 'west'],
];

// Mirrors mesher.ts: geometric falloff, then a separate day dimmer.
const MAX_LIGHT = 15;
const AMBIENT_FLOOR = 0.06;
const falloff = (level: number) => Math.pow(0.82, MAX_LIGHT - level);

const CX = 0;
const CZ = 3;
const ox = CX * CHUNK_X;
const oz = CZ * CHUNK_Z;

let exposed = 0;
let facesLitAir = 0;
let facesSealedAir = 0;
let darkAndVisible = 0;
const offenders: Array<{ x: number; y: number; z: number; face: string; block: number; sky: number }> = [];
const perFace: Record<string, { vis: number; dark: number }> = {};
for (const [, , , name] of NORMALS) perFace[name] = { vis: 0, dark: 0 };

for (let y = 1; y < WORLD_Y - 1; y++) {
  for (let z = 0; z < CHUNK_Z; z++) {
    for (let x = 0; x < CHUNK_X; x++) {
      const id = world.getBlock(ox + x, y, oz + z);
      if (id === Block.Air || !isOpaque(id)) continue;

      for (const [nx, ny, nz, name] of NORMALS) {
        const wx = ox + x + nx;
        const wy = y + ny;
        const wz = oz + z + nz;
        const neighbour = world.getBlock(wx, wy, wz);
        if (neighbour === id || isOpaque(neighbour)) continue; // face not emitted
        exposed++;

        const sky = world.getSkyLight(wx, wy, wz);
        const block = world.getBlockLight(wx, wy, wz);

        // Sealed air: no sky reaches it and nothing burns there. A face onto
        // it cannot be seen from outside, so its darkness is not a defect.
        if (sky === 0 && block === 0) { facesSealedAir++; continue; }

        facesLitAir++;
        perFace[name].vis++;
        const light = Math.max(AMBIENT_FLOOR, falloff(sky), falloff(block));
        if (light <= AMBIENT_FLOOR + 1e-6) {
          darkAndVisible++;
          perFace[name].dark++;
          if (offenders.length < 12) {
            offenders.push({ x: ox + x, y, z: oz + z, face: name, block: id, sky });
          }
        }
      }
    }
  }
}

const pct = (a: number, b: number) => (b === 0 ? 0 : (a / b) * 100);

console.log(`seed ${SEED}, chunk (${CX},${CZ}), full column`);
console.log(`exposed faces:          ${exposed}`);
console.log(`  onto sealed air:      ${facesSealedAir}  (${pct(facesSealedAir, exposed).toFixed(1)}%) -- hidden, darkness expected`);
console.log(`  onto lit air:         ${facesLitAir}  (${pct(facesLitAir, exposed).toFixed(1)}%) -- a player can see these`);
console.log('');
console.log(`VISIBLE faces at the ambient floor: ${darkAndVisible}  (${pct(darkAndVisible, facesLitAir).toFixed(2)}% of visible)`);

if (darkAndVisible === 0) {
  console.log('\n=> No visible face is black. The lighting is not producing the artifact.');
  console.log('   Whatever the player is seeing, it is not a dark-lighting bug.');
} else {
  console.log('\nby facing:');
  for (const [, , , name] of NORMALS) {
    const p = perFace[name];
    console.log(`  ${name.padEnd(7)} ${String(p.dark).padStart(5)}/${String(p.vis).padEnd(6)} ${pct(p.dark, p.vis).toFixed(2)}%`);
  }
  console.log('\nfirst offenders:');
  for (const o of offenders) {
    console.log(`  (${o.x}, ${o.y}, ${o.z}) ${o.face}  block=${blockDef(o.block).name ?? o.block}  neighbourSky=${o.sky}`);
  }
}
