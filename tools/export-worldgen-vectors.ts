/**
 * Exports world-generation test vectors for the native port (native/worldgen).
 *
 * The Rust generator must produce the same bytes as shared/src/terrain.ts, so
 * this runs the TypeScript generator over a spread of seeds, dimensions and
 * chunks and writes what it made:
 *
 *   native/worldgen/tests/data/chunks.bin   whole chunks, run-length encoded
 *   native/worldgen/tests/data/helpers.txt  helper results (heights, biomes,
 *                                           strongholds, noise, trees...)
 *   native/worldgen/src/block.rs            the block ids, from blockids.ts
 *
 * Whole chunks rather than hashes, because a hash can only say "different";
 * a failing Rust test should say which voxel, and what it should have been.
 *
 * Each seed runs in its own process. structures.ts memoises terrain heights
 * under a key made of the coordinates alone -- not the seed -- so a second
 * seed in the same process could read the first seed's heights. Keeping every
 * process to one seed (and every seed's chunks within 65536 blocks of each
 * other, where the key would also wrap) makes the vectors what a fresh game
 * would generate.
 *
 * Run: npx tsx tools/export-worldgen-vectors.ts
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Block } from '../shared/src/blockids.js';
import { CHUNK_X, CHUNK_Z, Dimension } from '../shared/src/constants.js';
import { fbm2, fbm3, hash2, hash3, value2, value3 } from '../shared/src/noise.js';
import { findPlacement } from '../shared/src/structures.js';
import {
  BIOME_NAMES, biomeAt, climateAt, columnHeight, generateChunk, isStrongholdChunk,
  strongholdLocation, surfaceY, treeCells, type TreeKind,
} from '../shared/src/terrain.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'native/worldgen/tests/data');
const BLOCK_RS = join(ROOT, 'native/worldgen/src/block.rs');

/**
 * Seeds: the one the TS tests use, zero, a negative one, and the extremes,
 * where `seed + salt` overflows 32 bits and only exact wrapping survives.
 */
const SEEDS = [2406, 0, -987654321, 2147483647, -2147483648];

// ----------------------------------------------------------------- encoding

/** FNV-1a, 32-bit: a cheap whole-chunk checksum both languages can compute. */
function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Runs of (value byte, LEB128 length). Chunks are mostly long runs of air and stone. */
function rle(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const v = bytes[i];
    let n = 1;
    while (i + n < bytes.length && bytes[i + n] === v) n++;
    out.push(v);
    let len = n;
    do {
      let b = len & 0x7f;
      len >>>= 7;
      if (len) b |= 0x80;
      out.push(b);
    } while (len);
    i += n;
  }
  return Uint8Array.from(out);
}

/** Exact bits of a double, so float helpers can be compared without rounding. */
function bits(v: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, v);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

/** A small deterministic generator for sample coordinates (not the game's noise). */
function lcg(state: number): () => number {
  let s = state >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ------------------------------------------------------------ chunk choices

interface ChunkCase { label: string; dim: Dimension; cx: number; cz: number }

function chunkCases(seed: number): ChunkCase[] {
  const cases: ChunkCase[] = [];
  const add = (label: string, dim: Dimension, cx: number, cz: number): void => {
    if (!cases.some((c) => c.dim === dim && c.cx === cx && c.cz === cz)) {
      cases.push({ label, dim, cx, cz });
    }
  };
  const O = Dimension.Overworld;

  // Near the origin, both signs, and far out. Every coordinate stays within
  // 1000 chunks of zero, so the TS height cache's 16-bit keys cannot alias.
  for (const [cx, cz] of [[0, 0], [-1, -1], [1, -2], [7, 3], [-13, 21]]) add('near', O, cx, cz);
  for (const [cx, cz] of [[1000, 1000], [-1000, 1000], [1000, -999]]) add('far', O, cx, cz);

  // Strongholds: the one in the origin region and the one to its south-west.
  for (const [rx, rz] of [[0, 0], [-1, -1]]) {
    const at = strongholdLocation(seed, rx, rz);
    const cx = Math.floor(at.x / CHUNK_X);
    const cz = Math.floor(at.z / CHUNK_Z);
    if (!isStrongholdChunk(seed, cx, cz)) throw new Error('stronghold location disagrees with its chunk test');
    add('stronghold', O, cx, cz);
  }

  // Structures: the nearest village and mansion, plus a neighbour chunk that
  // only part of the structure reaches into.
  for (const [kind, region, range, neighbours] of [
    ['village', 12, 6, [[2, -1], [-1, 2]]],
    ['mansion', 40, 3, [[1, 0], [-1, 1]]],
  ] as const) {
    let found = 0;
    for (let d = 0; d <= range && found < 2; d++) {
      for (let rz = -d; rz <= d && found < 2; rz++) {
        for (let rx = -d; rx <= d && found < 2; rx++) {
          if (Math.max(Math.abs(rx), Math.abs(rz)) !== d) continue;
          const pickX = rx * region + Math.floor(hash2(rx, rz, seed + (kind === 'village' ? 5501 : 7703)) * region);
          const pickZ = rz * region + Math.floor(hash2(rx + 311, rz - 197, seed + (kind === 'village' ? 5501 : 7703)) * region);
          if (!findPlacement(seed, kind, pickX, pickZ)) continue;
          found++;
          add(kind, O, pickX, pickZ);
          for (const [dx, dz] of neighbours) add(`${kind}-edge`, O, pickX + dx, pickZ + dz);
        }
      }
    }
  }

  // One chunk of each biome, found by its centre column, so every kind of
  // surface decoration (cactus, lily pad, snow, reeds...) is covered.
  const wanted = new Set(Object.keys(BIOME_NAMES).map(Number));
  for (let d = 0; d <= 250 && wanted.size; d += 1) {
    for (let cz = -d; cz <= d && wanted.size; cz += 1) {
      for (let cx = -d; cx <= d && wanted.size; cx += 1) {
        if (Math.max(Math.abs(cx), Math.abs(cz)) !== d) continue;
        const b = biomeAt(seed, cx * CHUNK_X + 8, cz * CHUNK_Z + 8);
        if (!wanted.has(b)) continue;
        wanted.delete(b);
        add(`biome-${BIOME_NAMES[b].replace(' ', '')}`, O, cx, cz);
      }
    }
  }

  for (const [cx, cz] of [[0, 0], [-1, 0], [3, -7], [125, -125], [-1000, 999]]) add('nether', Dimension.Nether, cx, cz);
  // The End: the main island, its rim near 90 blocks out, the empty ring,
  // outer islands past 140, and far away.
  for (const [cx, cz] of [
    [0, 0], [-1, -1], [5, 0], [-6, 0], [4, -4], [9, 9], [-10, 4], [20, -15], [-1000, 1000], [1000, 3],
  ]) add('end', Dimension.End, cx, cz);
  return cases;
}

// ------------------------------------------------------------------ helpers

function helperLines(seed: number): string[] {
  const lines: string[] = [];
  const rand = lcg(seed ^ 0x5eed);
  const coord = (span: number) => Math.floor((rand() - 0.5) * 2 * span);

  const points: Array<[number, number]> = [[0, 0], [-1, -1], [15, 16], [-17, 33], [16000, -16000]];
  for (let i = 0; i < 120; i++) points.push([coord(i < 60 ? 600 : 16000), coord(i < 60 ? 600 : 16000)]);
  for (const [x, z] of points) {
    const h = columnHeight(seed, x, z);
    const c = climateAt(seed, x, z);
    lines.push(`column ${seed} ${x} ${z} ${h} ${biomeAt(seed, x, z)} ${bits(c.temp)} ${bits(c.wet)}`);
    for (const dim of [Dimension.Overworld, Dimension.Nether, Dimension.End]) {
      lines.push(`surface ${seed} ${dim} ${x} ${z} ${surfaceY(seed, dim, x, z)}`);
    }
  }

  // Every stronghold in a block of regions, and its chunk test with neighbours.
  for (let rz = -3; rz <= 3; rz++) {
    for (let rx = -3; rx <= 3; rx++) {
      const at = strongholdLocation(seed, rx, rz);
      lines.push(`stronghold ${seed} ${rx} ${rz} ${at.x} ${at.y} ${at.z}`);
      const cx = Math.floor(at.x / CHUNK_X);
      const cz = Math.floor(at.z / CHUNK_Z);
      for (const [dx, dz] of [[0, 0], [1, 0], [0, -1], [-24, 0]]) {
        lines.push(`isstronghold ${seed} ${cx + dx} ${cz + dz} ${isStrongholdChunk(seed, cx + dx, cz + dz) ? 1 : 0}`);
      }
    }
  }

  // Structure placements at every region's chosen chunk, found or refused.
  for (const [kind, region, salt, range] of [['village', 12, 5501, 5], ['mansion', 40, 7703, 3]] as const) {
    for (let rz = -range; rz <= range; rz++) {
      for (let rx = -range; rx <= range; rx++) {
        const cx = rx * region + Math.floor(hash2(rx, rz, seed + salt) * region);
        const cz = rz * region + Math.floor(hash2(rx + 311, rz - 197, seed + salt) * region);
        const p = findPlacement(seed, kind, cx, cz);
        lines.push(`placement ${seed} ${kind} ${cx} ${cz} ` + (p ? `${p.x} ${p.z} ${p.radius}` : 'none'));
        // The chunk beside a chosen one never holds a structure.
        lines.push(`placement ${seed} ${kind} ${cx + 1} ${cz} ` + (findPlacement(seed, kind, cx + 1, cz) ? 'some' : 'none'));
      }
    }
  }
  return lines;
}

/** Seed-independent vectors: raw noise, hypot and tree shapes. */
function sharedLines(): string[] {
  const lines: string[] = [];
  const rand = lcg(12345);
  const int = (span: number) => Math.floor((rand() - 0.5) * 2 * span);
  const real = (span: number) => (rand() - 0.5) * 2 * span;
  for (let i = 0; i < 200; i++) {
    const [x, y, z, s] = [int(1e6), int(1e6), int(1e6), int(2 ** 31)];
    lines.push(`hash2 ${x} ${y} ${s} ${bits(hash2(x, y, s))}`);
    lines.push(`hash3 ${x} ${y} ${z} ${s} ${bits(hash3(x, y, z, s))}`);
  }
  for (let i = 0; i < 200; i++) {
    const [x, y, z, s] = [real(3000), real(3000), real(300), int(2 ** 31)];
    const oct = 1 + (i % 4);
    lines.push(`value2 ${bits(x)} ${bits(y)} ${s} ${bits(value2(x, y, s))}`);
    lines.push(`value3 ${bits(x)} ${bits(y)} ${bits(z)} ${s} ${bits(value3(x, y, z, s))}`);
    lines.push(`fbm2 ${bits(x)} ${bits(y)} ${s} ${oct} ${bits(fbm2(x, y, s, oct))}`);
    lines.push(`fbm3 ${bits(x)} ${bits(y)} ${bits(z)} ${s} ${oct} ${bits(fbm3(x, y, z, s, oct))}`);
  }
  // Math.hypot over the End's range, integers as the End uses it, plus reals.
  for (let i = 0; i < 400; i++) {
    const [a, b] = i < 300 ? [int(20000), int(200)] : [real(1e4), real(1e-3 + 1e4 * rand())];
    lines.push(`hypot ${bits(a)} ${bits(b)} ${bits(Math.hypot(a, b))}`);
  }
  for (const kind of ['oak', 'birch', 'pine'] as TreeKind[]) {
    for (let height = 3; height <= 10; height++) {
      const cells = treeCells(kind, height).map((c) => `${c.dx},${c.dy},${c.dz},${c.id},${c.trunk ? 1 : 0}`);
      lines.push(`tree ${kind} ${height} ${cells.join(';')}`);
    }
  }
  return lines;
}

// --------------------------------------------------------------- processes

/** Generates one seed's vectors in this process and writes them to `out`. */
function runWorker(seed: number, out: string): void {
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  let count = 0;
  for (const c of chunkCases(seed)) {
    const data = generateChunk(seed, c.dim, c.cx, c.cz);
    const packed = rle(data);
    const label = enc.encode(c.label);
    const head = new DataView(new ArrayBuffer(1 + label.length + 4 + 1 + 4 + 4 + 4 + 4));
    let o = 0;
    head.setUint8(o, label.length); o += 1;
    new Uint8Array(head.buffer).set(label, o); o += label.length;
    head.setInt32(o, seed, true); o += 4;
    head.setUint8(o, c.dim); o += 1;
    head.setInt32(o, c.cx, true); o += 4;
    head.setInt32(o, c.cz, true); o += 4;
    head.setUint32(o, fnv1a(data), true); o += 4;
    head.setUint32(o, packed.length, true);
    parts.push(new Uint8Array(head.buffer), packed);
    count++;
  }
  const size = parts.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(4 + size);
  new DataView(body.buffer).setUint32(0, count, true);
  let o = 4;
  for (const p of parts) { body.set(p, o); o += p.length; }
  writeFileSync(`${out}.bin`, body);
  writeFileSync(`${out}.txt`, helperLines(seed).join('\n') + '\n');
}

/** Writes block.rs: the Block enum, as Rust constants with the same names. */
function writeBlockModule(): void {
  const entries = Object.entries(Block)
    .filter(([, v]) => typeof v === 'number')
    .sort((a, b) => (a[1] as number) - (b[1] as number));
  const body = entries.map(([name, id]) => `pub const ${name}: u8 = ${id};`).join('\n');
  writeFileSync(BLOCK_RS, `//! Block ids, generated from shared/src/blockids.ts by
//! tools/export-worldgen-vectors.ts -- do not edit by hand, re-run the export.
//!
//! The names are the TypeScript enum's, unchanged, so code reads the same in
//! both languages; that is why they are not SCREAMING_CASE. Chunks store one
//! byte per block, which is why every id fits a \`u8\`.
#![allow(non_upper_case_globals)]

${body}
`);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] === '--worker') {
    runWorker(Number(args[1]), args[2]);
    return;
  }

  writeBlockModule();
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'worldgen-vectors-'));
  try {
    const bins: Uint8Array[] = [];
    const text: string[] = ['# Generated by tools/export-worldgen-vectors.ts -- do not edit.'];
    let count = 0;
    for (const seed of SEEDS) {
      const out = join(tmp, `seed${seed}`);
      // A fresh process per seed; see the header comment for why.
      const run = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--worker', String(seed), out], {
        stdio: 'inherit',
      });
      if (run.status !== 0) throw new Error(`worker for seed ${seed} failed`);
      const bin = readFileSync(`${out}.bin`);
      count += bin.readUInt32LE(0);
      bins.push(bin.subarray(4));
      text.push(readFileSync(`${out}.txt`, 'utf8').trimEnd());
      console.log(`seed ${seed}: ${bin.readUInt32LE(0)} chunks`);
    }
    text.push(...sharedLines());

    const head = Buffer.alloc(12);
    head.write('BCWG', 0, 'latin1');
    head.writeUInt32LE(1, 4); // format version
    head.writeUInt32LE(count, 8);
    const all = Buffer.concat([head, ...bins]);
    writeFileSync(join(DATA_DIR, 'chunks.bin'), all);
    writeFileSync(join(DATA_DIR, 'helpers.txt'), text.join('\n') + '\n');
    console.log(`wrote ${count} chunks (${(all.length / 1024).toFixed(0)} KB) and ${text.length} helper lines`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main();
