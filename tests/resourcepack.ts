/**
 * Resource pack reading, against real packs when they are present.
 * Run: npx tsx tests/resourcepack.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { mapPackEntries } from '../client/src/resourcepack.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

/** Builds a minimal zip in memory so the parser is tested without a fixture. */
function makeZip(files: Array<{ name: string; data: Uint8Array; store?: boolean }>): ArrayBuffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const body = file.store ? Buffer.from(file.data) : deflateRawSync(Buffer.from(file.data));
    const method = file.store ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);            // crc, unchecked by the reader
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(file.data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  const all = Buffer.concat([...chunks, centralBuf, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
}

const text = (s: string) => new TextEncoder().encode(s);

// --- the parser itself ------------------------------------------------------
{
  const zip = makeZip([
    { name: 'pack.mcmeta', data: text('{}') },
    { name: 'assets/minecraft/textures/block/stone.png', data: text('STONE-PIXELS') },
    { name: 'assets/minecraft/textures/item/diamond.png', data: text('DIAMOND'), store: true },
    { name: 'assets/minecraft/textures/block/not_a_block_we_have.png', data: text('x') },
  ]);
  const mapped = await mapPackEntries(zip);
  const byTile = new Map(mapped.map((m) => [m.tile, m]));

  check('reads deflated entries',
    new TextDecoder().decode(byTile.get('stone')!.bytes) === 'STONE-PIXELS');
  check('reads stored (uncompressed) entries',
    new TextDecoder().decode(byTile.get('diamond')!.bytes) === 'DIAMOND');
  check('maps block names to our tiles', byTile.has('stone'));
  check('maps item names to our tiles', byTile.has('diamond'));
  check('ignores textures we have no tile for', mapped.length === 2, `${mapped.length} mapped`);
}

// --- version overlays -------------------------------------------------------
{
  // Packs ship the same texture several times for different game versions.
  // The plain assets/ copy must win over a deeper overlay copy.
  const zip = makeZip([
    { name: '1.21.5/assets/minecraft/textures/block/stone.png', data: text('OVERLAY') },
    { name: 'assets/minecraft/textures/block/stone.png', data: text('CANONICAL') },
  ]);
  const mapped = await mapPackEntries(zip);
  check('one tile is claimed once', mapped.length === 1);
  check('the top-level copy wins, not a version overlay',
    new TextDecoder().decode(mapped[0].bytes) === 'CANONICAL',
    new TextDecoder().decode(mapped[0].bytes));
}

// --- the `_3d` suffix some packs use ---------------------------------------
{
  const zip = makeZip([
    { name: 'assets/minecraft/textures/item/cooked_beef_3d.png', data: text('STEAK') },
  ]);
  const mapped = await mapPackEntries(zip);
  check('handles the _3d suffix', mapped[0]?.tile === 'steak', mapped[0]?.tile ?? 'none');
}

// --- rejects rubbish --------------------------------------------------------
{
  let threw = false;
  try {
    await mapPackEntries(new TextEncoder().encode('this is not a zip').buffer as ArrayBuffer);
  } catch {
    threw = true;
  }
  check('a non-zip is rejected rather than silently ignored', threw);
}

// --- real packs, when the user has them ------------------------------------
const REAL_PACKS = [
  { path: 'C:/Users/HOME/Downloads/Fresh Food.zip', expect: ['raw_porkchop', 'steak'] },
  { path: 'C:/Users/HOME/Downloads/Faithful 64x - Release 14.zip', expect: ['stone', 'dirt', 'diamond'] },
];

for (const pack of REAL_PACKS) {
  const label = pack.path.split('/').pop();
  if (!existsSync(pack.path)) {
    console.log(`SKIP  ${label} (not present)`);
    continue;
  }
  const data = readFileSync(pack.path);
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const mapped = await mapPackEntries(buffer as ArrayBuffer);
  const tiles = new Set(mapped.map((m) => m.tile));

  check(`${label}: textures found`, mapped.length > 0, `${mapped.length} tiles`);
  for (const want of pack.expect) {
    check(`${label}: supplies "${want}"`, tiles.has(want));
  }
  // Every payload should start with the PNG signature.
  const allPng = mapped.every((m) =>
    m.bytes[0] === 0x89 && m.bytes[1] === 0x50 && m.bytes[2] === 0x4e && m.bytes[3] === 0x47);
  check(`${label}: every entry inflates to a valid PNG`, allPng);

  // Resolution, read straight from the IHDR width field.
  const sample = mapped.find((m) => m.tile === 'stone') ?? mapped[0];
  const width = new DataView(
    sample.bytes.buffer, sample.bytes.byteOffset + 16, 4).getUint32(0, false);
  console.log(`      ${label}: "${sample.tile}" is ${width}px`);
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} failed`}`);
process.exit(failures ? 1 : 0);
