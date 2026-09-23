/**
 * Renders blocks or mobs exactly as the game builds them, to a PNG.
 *
 * Blocks go through the real section mesher -- shapes, neighbour-aware
 * models, crossed plants, per-box textures -- and mobs through the real mob
 * mesher, so what you see is what the game draws (lit by face direction
 * rather than by the world's light).
 *
 *   # a row of blocks on a stone floor, each labelled
 *   npx tsx tests/diagnostics/scene.ts --blocks=Stone,PlankFence,GlassPane,Poppy --out=row.png
 *
 *   # an arrangement: a JSON file of [x, y, z, "BlockName" or id] entries
 *   npx tsx tests/diagnostics/scene.ts --scene=fences.json --out=fences.png
 *
 *   # every mob kind, or some of them
 *   npx tsx tests/diagnostics/scene.ts --mobs=all --out=mobs.png
 *   npx tsx tests/diagnostics/scene.ts --mobs=Pig,Zombie --yaw=200 --out=mobs.png
 *
 * Camera: --yaw (degrees, default 35), --pitch (default 30), --scale (pixels
 * per block), --width/--height. --floor=none drops the stone floor.
 */

import { readFileSync } from 'node:fs';

import { Block } from '../../shared/src/blocks.js';
import { Dimension, SECTION_Y, voxelIndex } from '../../shared/src/constants.js';
import { MobKind, allMobKinds, mobDef } from '../../shared/src/mobs.js';
import { meshSection } from '../../client/src/mesher.js';
import { buildMobMesh } from '../../client/src/gfx/mobmesh.js';
import { Mob } from '../../client/src/mobs.js';
import { ClientWorld } from '../../client/src/world.js';
import { drawText, nodeAtlas, projector, renderMeshes, writePNG, type Camera, type Mesh } from './offscreen.js';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const [k, ...rest] = a.replace(/^--/, '').split('=');
  args.set(k, rest.join('=') || 'true');
}

function blockId(token: string | number): number {
  if (typeof token === 'number') return token;
  const t = token.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const id = (Block as unknown as Record<string, number>)[t];
  if (id === undefined) throw new Error(`no block named ${t}`);
  return id;
}

const atlas = nodeAtlas();
const meshes: Mesh[] = [];
const labels: Array<{ at: [number, number, number]; text: string }> = [];
let center: [number, number, number] = [8, 42, 8];
let span = 8;

// A world of air over a stone floor, one chunk wide, big enough for a row.
const BASE_Y = 40;
const world = new ClientWorld(1, Dimension.Overworld);
const CHUNKS = 3;
for (let cx = 0; cx < CHUNKS; cx++) {
  const chunk = world.ensureChunk(cx, 0);
  chunk.data.fill(0);
  if (args.get('floor') !== 'none') {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) chunk.data[voxelIndex(x, BASE_Y, z)] = Block.Stone;
    }
  }
}

function put(x: number, y: number, z: number, id: number): void {
  const chunk = world.chunk(x >> 4, z >> 4);
  if (!chunk) throw new Error(`(${x}, ${z}) is outside the scene`);
  chunk.data[voxelIndex(x & 15, y, z & 15)] = id;
}

if (args.has('blocks')) {
  const ids = args.get('blocks')!.split(',').map(blockId);
  ids.forEach((id, i) => {
    const x = 1 + i * 2;
    put(x, BASE_Y + 1, 4, id);
    labels.push({ at: [x + 0.5, BASE_Y + 0.9, 5.4], text: (Block[id] ?? String(id)).slice(0, 14) });
  });
  span = Math.max(4, ids.length * 2);
  center = [1 + span / 2, BASE_Y + 1.2, 4.5];
}

if (args.has('scene')) {
  const entries = JSON.parse(readFileSync(args.get('scene')!, 'utf8')) as Array<[number, number, number, string | number]>;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, y, z, b] of entries) {
    put(x, BASE_Y + 1 + y, z, blockId(b));
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  span = Math.max(4, maxX - minX + 3, maxZ - minZ + 3);
  center = [(minX + maxX + 1) / 2, BASE_Y + 1.5, (minZ + maxZ + 1) / 2];
}

// Mesh every section that has anything in it.
for (let cx = 0; cx < CHUNKS; cx++) {
  for (let s = BASE_Y / SECTION_Y | 0; s <= ((BASE_Y + 8) / SECTION_Y | 0); s++) {
    const m = meshSection(world, atlas, cx, 0, s, 1);
    if (!m) continue;
    for (const part of [m.opaque, m.alpha]) {
      if (part.indices.length) meshes.push({ ...part, offset: [cx * 16, 0, 0] });
    }
  }
}

if (args.has('mobs')) {
  const wanted = args.get('mobs')!;
  const kinds = wanted === 'all'
    ? allMobKinds()
    : wanted.split(',').map((n) => {
      const k = (MobKind as unknown as Record<string, number>)[n.trim()];
      if (k === undefined) throw new Error(`no mob named ${n}`);
      return k as MobKind;
    });
  let x = 1;
  const mobs: Mob[] = [];
  for (const kind of kinds) {
    const def = mobDef(kind);
    const gap = Math.max(1.6, def.width + 1.2);
    x += gap / 2;
    const mob = new Mob(kind, x, BASE_Y + 1 + (def.flying ? 0.5 : 0), 5, Number(args.get('face') ?? 90));
    mob.phase = Number(args.get('phase') ?? 0.6);
    mobs.push(mob);
    labels.push({ at: [x, BASE_Y + 0.9, 6.6], text: def.name.slice(0, 14) });
    x += gap / 2;
  }
  const mesh = buildMobMesh(atlas, mobs);
  meshes.push(mesh);
  const tallest = Math.max(...kinds.map((k) => mobDef(k).height));
  span = Math.max(span, x + 1, tallest * 2);
  center = [x / 2, BASE_Y + 1 + tallest / 2, 5];
}

const scale = Number(args.get('scale') ?? Math.max(24, Math.min(96, Math.floor(1400 / (span + 2)))));
const cam: Camera = {
  width: Number(args.get('width') ?? Math.ceil((span + 3) * scale)),
  height: Number(args.get('height') ?? Math.ceil(Math.max(6, span * 0.6) * scale)),
  center,
  yaw: Number(args.get('yaw') ?? 35),
  pitch: Number(args.get('pitch') ?? 30),
  scale,
};

const img = renderMeshes(meshes, cam, atlas);
const project = projector(cam);
for (const { at, text } of labels) {
  const [sx, sy] = project(...at);
  drawText(img, cam.width, Math.round(sx - text.length * 4), Math.round(sy), text, 2);
}
const out = args.get('out') ?? 'scene.png';
writePNG(out, cam.width, cam.height, img);
console.log(`${meshes.length} meshes -> ${out} (${cam.width}x${cam.height})`);
