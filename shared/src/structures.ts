/**
 * Multi-chunk structures.
 *
 * The stronghold fits inside one chunk on purpose. Villages and mansions do
 * not, so they work the other way round: every chunk asks which structures
 * *could* reach it, then builds each one in full through a writer that
 * discards anything outside the chunk. Generation stays a pure function of
 * (seed, chunk), and no cross-chunk state is needed.
 */

import { Block } from './blocks.js';
import { CHUNK_X, CHUNK_Z, SEA_LEVEL, WORLD_Y, voxelIndex } from './constants.js';
import { hash2 } from './noise.js';
import { columnHeight } from './terrain.js';

/**
 * Region sizes in chunks: one structure of each kind per region, at most.
 *
 * Most candidates are rejected for being at sea or on a cliff, so the regions
 * are smaller than the resulting spacing suggests. Villages should turn up
 * while exploring; mansions are meant to be a find.
 */
const VILLAGE_REGION = 12;
const MANSION_REGION = 40;

/** Half-extent of the largest structure, in chunks, used as the search radius. */
const SEARCH_CHUNKS = 3;

/**
 * A block writer bound to one chunk.
 *
 * It carries the chunk's bounds so the drawing primitives can clamp their
 * loops. Every chunk a structure overlaps rebuilds that structure in full, so
 * without clamping a village spanning 25 chunks does 25x the work and only
 * 1/25th of it lands.
 */
export interface Writer {
  (x: number, y: number, z: number, block: Block): void;
  /** Inclusive chunk bounds. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * Memoised terrain height.
 *
 * Levelling asks for the same columns over and over -- once per overlapping
 * chunk, and several times within one structure as roads, plots and lamps all
 * flatten ground that overlaps. `columnHeight` is three fBm evaluations, so
 * without this the repeats dominate generation near a village.
 */
const heightCache = new Map<number, number>();
const HEIGHT_CACHE_CAP = 60000;

function heightAt(seed: number, x: number, z: number): number {
  // Pack the coordinates into one integer key; string keys were slower than
  // the lookup saved.
  const key = ((x & 0xffff) << 16) | (z & 0xffff);
  const hit = heightCache.get(key);
  if (hit !== undefined) return hit;

  const value = columnHeight(seed, x, z);
  if (heightCache.size >= HEIGHT_CACHE_CAP) heightCache.clear();
  heightCache.set(key, value);
  return value;
}

interface Placement {
  kind: 'village' | 'mansion';
  /** World coordinates of the structure's centre. */
  x: number;
  z: number;
  /** Half-extent on x and z, for the overlap test. */
  radius: number;
}

/**
 * Placement is asked for the same chunk by every neighbour within the search
 * radius, and a miss still costs a flatness scan, so the answers are cached.
 */
const placementCache = new Map<string, Placement | null>();
const PLACEMENT_CACHE_CAP = 4096;

function placementFor(
  seed: number, kind: 'village' | 'mansion', cx: number, cz: number,
): Placement | null {
  const key = `${seed}:${kind}:${cx},${cz}`;
  const cached = placementCache.get(key);
  if (cached !== undefined) return cached;

  const result = computePlacement(seed, kind, cx, cz);
  if (placementCache.size >= PLACEMENT_CACHE_CAP) {
    const oldest = placementCache.keys().next().value;
    if (oldest !== undefined) placementCache.delete(oldest);
  }
  placementCache.set(key, result);
  return result;
}

function computePlacement(
  seed: number, kind: 'village' | 'mansion', cx: number, cz: number,
): Placement | null {
  const region = kind === 'village' ? VILLAGE_REGION : MANSION_REGION;
  const salt = kind === 'village' ? 5501 : 7703;
  const rx = Math.floor(cx / region);
  const rz = Math.floor(cz / region);

  const pickX = rx * region + Math.floor(hash2(rx, rz, seed + salt) * region);
  const pickZ = rz * region + Math.floor(hash2(rx + 311, rz - 197, seed + salt) * region);
  if (pickX !== cx || pickZ !== cz) return null;

  const x = cx * CHUNK_X + 8;
  const z = cz * CHUNK_Z + 8;

  // Only on land, and only where the ground is reasonably even: a village
  // draped over a cliff looks broken however it is built.
  const h = heightAt(seed, x, z);
  if (h <= SEA_LEVEL + 2 || h >= 78) return null;

  const radius = kind === 'village' ? 26 : 14;
  let lowest = h;
  let highest = h;
  for (let dz = -radius; dz <= radius; dz += 6) {
    for (let dx = -radius; dx <= radius; dx += 6) {
      const sample = heightAt(seed, x + dx, z + dz);
      lowest = Math.min(lowest, sample);
      highest = Math.max(highest, sample);
    }
  }
  // Structures level their own ground, so this only rules out genuine
  // cliffs -- natural terrain varies ~16 blocks over a village footprint at
  // the flattest, so a tight bound here rejects everything.
  if (highest - lowest > (kind === 'village' ? 24 : 20)) return null;
  // The centre already has to be on land. Requiring the whole footprint above
  // water rejected most coastal sites for no good reason -- the pad is filled
  // down to the terrain anyway, so a dip at the edge is fine. Only a site
  // sitting substantially in open water is refused.
  if (lowest <= SEA_LEVEL - 6) return null;

  return { kind, x, z, radius };
}

// --------------------------------------------------------------- primitives

function fill(
  write: Writer, x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number, block: Block,
): void {
  const ax = Math.max(x0, write.x0);
  const bx = Math.min(x1, write.x1);
  const az = Math.max(z0, write.z0);
  const bz = Math.min(z1, write.z1);
  for (let y = y0; y <= y1; y++) {
    for (let z = az; z <= bz; z++) {
      for (let x = ax; x <= bx; x++) write(x, y, z, block);
    }
  }
}

/** Walls only: the box's sides, with the interior left alone. */
function walls(
  write: Writer, x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number, block: Block,
): void {
  // Clamp the iteration, but test "is this an edge" against the true box.
  const ax = Math.max(x0, write.x0);
  const bx = Math.min(x1, write.x1);
  const az = Math.max(z0, write.z0);
  const bz = Math.min(z1, write.z1);
  for (let y = y0; y <= y1; y++) {
    for (let z = az; z <= bz; z++) {
      for (let x = ax; x <= bx; x++) {
        if (x === x0 || x === x1 || z === z0 || z === z1) write(x, y, z, block);
      }
    }
  }
}

/** A stepped pyramid roof, one ring inset per level. */
function roof(
  write: Writer, x0: number, y: number, z0: number,
  x1: number, z1: number, block: Block, levels: number,
): void {
  for (let i = 0; i < levels; i++) {
    const ax = x0 + i;
    const az = z0 + i;
    const bx = x1 - i;
    const bz = z1 - i;
    if (ax > bx || az > bz) break;
    const cz0 = Math.max(az, write.z0);
    const cz1 = Math.min(bz, write.z1);
    const cx0 = Math.max(ax, write.x0);
    const cx1 = Math.min(bx, write.x1);
    for (let z = cz0; z <= cz1; z++) {
      for (let x = cx0; x <= cx1; x++) {
        if (x === ax || x === bx || z === az || z === bz || i === levels - 1) {
          write(x, y + i, z, block);
        }
      }
    }
  }
}

/**
 * Cuts a flat pad at `y` across the footprint.
 *
 * Natural terrain swings ~16-40 blocks across a village, so structures cannot
 * simply be dropped on it: each one flattens the ground it needs, filling
 * hollows down to the terrain and shaving anything above.
 */
function levelGround(
  write: Writer, seed: number, x0: number, z0: number, x1: number, z1: number,
  y: number, surface: Block, headroom: number,
): void {
  const az = Math.max(z0, write.z0);
  const bz = Math.min(z1, write.z1);
  const ax = Math.max(x0, write.x0);
  const bx = Math.min(x1, write.x1);
  for (let z = az; z <= bz; z++) {
    for (let x = ax; x <= bx; x++) {
      const terrain = heightAt(seed, x, z);
      // Shave everything above the pad, including any hill standing over it.
      const top = Math.max(y + headroom, terrain + 1);
      for (let cy = y; cy <= top; cy++) write(x, cy, z, Block.Air);
      // Fill down to meet the ground so nothing is left floating.
      for (let cy = Math.min(terrain, y - 1); cy <= y - 1; cy++) {
        write(x, cy, z, cy === y - 1 ? surface : Block.Dirt);
      }
    }
  }
}

/** Clears the space a building occupies and gives it a foundation. */
function clearAndFound(
  write: Writer, seed: number, x0: number, y: number, z0: number,
  x1: number, z1: number, height: number, floor: Block,
): void {
  levelGround(write, seed, x0, z0, x1, z1, y, floor, height + 3);
}

// ------------------------------------------------------------------ village

function buildHouse(
  write: Writer, seed: number, x: number, groundY: number, z: number,
  width: number, depth: number,
): void {
  const x0 = x - (width >> 1);
  const x1 = x0 + width - 1;
  const z0 = z - (depth >> 1);
  const z1 = z0 + depth - 1;
  const wallHeight = 4;
  const top = groundY + wallHeight;

  clearAndFound(write, seed, x0 - 1, groundY, z0 - 1, x1 + 1, z1 + 1,
    wallHeight + 3, Block.Planks);

  walls(write, x0, groundY, z0, x1, top - 1, z1, Block.Planks);
  // Log posts at the corners read as timber framing.
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as const) {
    fill(write, cx, groundY, cz, cx, top - 1, cz, Block.Log);
  }

  fill(write, x0, top, z0, x1, top, z1, Block.Planks);
  roof(write, x0 - 1, top, z0 - 1, x1 + 1, z1 + 1, Block.Cobblestone, 3);

  // Doorway on the -x wall, windows on the others.
  const doorZ = z0 + (depth >> 1);
  fill(write, x0, groundY, doorZ, x0, groundY + 1, doorZ, Block.Air);

  const windowY = groundY + 2;
  for (let wz = z0 + 2; wz < z1; wz += 2) {
    write(x1, windowY, wz, Block.Glass);
  }
  for (let wx = x0 + 2; wx < x1; wx += 2) {
    write(wx, windowY, z0, Block.Glass);
    write(wx, windowY, z1, Block.Glass);
  }

  // A little furniture, so interiors are not bare boxes.
  const r = hash2(x, z, seed + 88);
  if (r < 0.5) write(x0 + 1, groundY, z0 + 1, Block.CraftingTable);
  else write(x0 + 1, groundY, z0 + 1, Block.Furnace);
  write(x1 - 1, groundY + 2, z1 - 1, Block.Glowstone);
}

function buildLamp(write: Writer, x: number, groundY: number, z: number): void {
  fill(write, x, groundY, z, x, groundY + 3, z, Block.Log);
  write(x, groundY + 4, z, Block.Glowstone);
}

function buildVillage(write: Writer, seed: number, place: Placement): void {
  // One level for the whole settlement, so it reads as a planned place
  // rather than houses scattered down a hillside.
  const groundY = heightAt(seed, place.x, place.z) + 1;

  // A gravel crossroads through the middle, cut into the terrain.
  levelGround(write, seed, place.x - 20, place.z - 2, place.x + 20, place.z + 2,
    groundY, Block.Gravel, 4);
  levelGround(write, seed, place.x - 2, place.z - 20, place.x + 2, place.z + 20,
    groundY, Block.Gravel, 4);

  // A well at the crossing.
  walls(write, place.x - 2, groundY, place.z - 2, place.x + 2, groundY + 1, place.z + 2,
    Block.Cobblestone);
  fill(write, place.x - 1, groundY - 1, place.z - 1, place.x + 1, groundY - 1, place.z + 1,
    Block.Water);

  // Houses on plots either side of the roads, with deterministic jitter.
  const plots: Array<[number, number]> = [
    [-14, -12], [14, -12], [-14, 12], [14, 12],
    [-16, 0], [16, 0], [0, -16], [0, 16],
  ];
  plots.forEach(([ox, oz], i) => {
    const roll = hash2(place.x + ox, place.z + oz, seed + 4400 + i);
    if (roll > 0.82) return; // a gap in the village keeps it from looking stamped

    const jx = Math.floor(hash2(place.x + ox, place.z + oz, seed + 91) * 3) - 1;
    const jz = Math.floor(hash2(place.x + ox, place.z + oz, seed + 137) * 3) - 1;
    const hx = place.x + ox + jx;
    const hz = place.z + oz + jz;
    const wide = roll < 0.4;
    // Every house shares the village's level, not its own column height.
    buildHouse(write, seed, hx, groundY, hz, wide ? 9 : 7, 7);
  });

  for (const [lx, lz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]] as const) {
    const x = place.x + lx;
    const z = place.z + lz;
    levelGround(write, seed, x - 1, z - 1, x + 1, z + 1, groundY, Block.Gravel, 6);
    buildLamp(write, x, groundY, z);
  }
}

// ------------------------------------------------------------------ mansion

function buildMansion(write: Writer, seed: number, place: Placement): void {
  const groundY = heightAt(seed, place.x, place.z) + 1;
  const half = 11;
  const x0 = place.x - half;
  const x1 = place.x + half;
  const z0 = place.z - half;
  const z1 = place.z + half;
  const floors = 3;
  const floorHeight = 5;

  clearAndFound(write, seed, x0 - 1, groundY, z0 - 1, x1 + 1, z1 + 1,
    floors * floorHeight + 6, Block.Planks);

  for (let f = 0; f < floors; f++) {
    const base = groundY + f * floorHeight;
    const top = base + floorHeight - 1;

    walls(write, x0, base, z0, x1, top - 1, z1, Block.Planks);

    // Log pillars at the corners and at regular intervals along each wall.
    for (let x = x0; x <= x1; x += 5) {
      fill(write, x, base, z0, x, top - 1, z0, Block.Log);
      fill(write, x, base, z1, x, top - 1, z1, Block.Log);
    }
    for (let z = z0; z <= z1; z += 5) {
      fill(write, x0, base, z, x0, top - 1, z, Block.Log);
      fill(write, x1, base, z, x1, top - 1, z, Block.Log);
    }

    // Ceiling for this storey (the top one gets a roof instead).
    if (f < floors - 1) fill(write, x0, top, z0, x1, top, z1, Block.Planks);

    // Windows.
    const wy = base + 2;
    for (let x = x0 + 2; x < x1; x += 5) {
      write(x, wy, z0, Block.Glass);
      write(x, wy, z1, Block.Glass);
      write(x + 1, wy, z0, Block.Glass);
      write(x + 1, wy, z1, Block.Glass);
    }
    for (let z = z0 + 2; z < z1; z += 5) {
      write(x0, wy, z, Block.Glass);
      write(x1, wy, z, Block.Glass);
      write(x0, wy, z + 1, Block.Glass);
      write(x1, wy, z + 1, Block.Glass);
    }

    // Interior: a cross of partition walls making four rooms, with doorways.
    walls(write, place.x, base, z0 + 1, place.x, top - 1, z1 - 1, Block.Planks);
    walls(write, x0 + 1, base, place.z, x1 - 1, top - 1, place.z, Block.Planks);
    for (const [dx, dz] of [[0, -5], [0, 5], [-5, 0], [5, 0]] as const) {
      fill(write, place.x + dx, base, place.z + dz,
        place.x + dx, base + 1, place.z + dz, Block.Air);
    }

    // Lighting and a little loot-room flavour per floor.
    for (const [cx, cz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const) {
      write(place.x + cx, top - 1, place.z + cz, Block.Glowstone);
    }
    if (f === floors - 1) {
      write(place.x - 4, base, place.z - 4, Block.DiamondOre);
      write(place.x + 4, base, place.z + 4, Block.IronBlock);
    } else {
      write(place.x - 4, base, place.z - 4, Block.CraftingTable);
      write(place.x + 4, base, place.z + 4, Block.Furnace);
    }

    // Stairwell: a hole through the ceiling with steps up to it.
    if (f < floors - 1) {
      fill(write, x0 + 2, top, z0 + 2, x0 + 4, top, z0 + 4, Block.Air);
      for (let s = 0; s < 4; s++) {
        fill(write, x0 + 2, base, z0 + 2 + s, x0 + 4, base + s, z0 + 2 + s, Block.Cobblestone);
      }
    }
  }

  // Grand entrance and a roof.
  const doorZ = place.z;
  fill(write, x0, groundY, doorZ - 1, x0, groundY + 2, doorZ + 1, Block.Air);
  roof(write, x0 - 1, groundY + floors * floorHeight - 1, z0 - 1, x1 + 1, z1 + 1,
    Block.Cobblestone, 5);
}

// -------------------------------------------------------------------- entry

/**
 * Builds any structure overlapping this chunk, writing only inside it.
 */
export function buildStructures(
  seed: number, cx: number, cz: number, data: Uint8Array,
): void {
  const ox = cx * CHUNK_X;
  const oz = cz * CHUNK_Z;

  const write = ((x: number, y: number, z: number, block: Block) => {
    if (y < 1 || y >= WORLD_Y) return;
    const lx = x - ox;
    const lz = z - oz;
    if (lx < 0 || lx >= CHUNK_X || lz < 0 || lz >= CHUNK_Z) return;
    data[voxelIndex(lx, y, lz)] = block;
  }) as Writer;
  write.x0 = ox;
  write.x1 = ox + CHUNK_X - 1;
  write.z0 = oz;
  write.z1 = oz + CHUNK_Z - 1;

  for (let dz = -SEARCH_CHUNKS; dz <= SEARCH_CHUNKS; dz++) {
    for (let dx = -SEARCH_CHUNKS; dx <= SEARCH_CHUNKS; dx++) {
      for (const kind of ['village', 'mansion'] as const) {
        const place = placementFor(seed, kind, cx + dx, cz + dz);
        if (!place) continue;

        // Skip structures whose footprint cannot reach this chunk.
        if (place.x + place.radius < ox || place.x - place.radius > ox + CHUNK_X - 1) continue;
        if (place.z + place.radius < oz || place.z - place.radius > oz + CHUNK_Z - 1) continue;

        if (kind === 'village') buildVillage(write, seed, place);
        else buildMansion(write, seed, place);
      }
    }
  }
}

/** Exposed for tests and for tools that want to locate structures. */
export function findPlacement(
  seed: number, kind: 'village' | 'mansion', cx: number, cz: number,
): Placement | null {
  return placementFor(seed, kind, cx, cz);
}
