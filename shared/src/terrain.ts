/**
 * World generation.
 *
 * Pure function of (seed, dimension, chunk coords) so the client and the
 * server produce identical terrain and only *edits* ever cross the network.
 */

import { Block } from './blocks.js';
import { CHUNK_X, CHUNK_Z, Dimension, SEA_LEVEL, WORLD_Y, voxelIndex } from './constants.js';
import { contrast, fbm2, fbm3, hash2, hash3 } from './noise.js';
import { buildStructures } from './structures.js';

const TREE_CHANCE = 0.016;
const TREE_MARGIN = 3; // how far outside a chunk a tree can start and still reach in

export function columnHeight(seed: number, x: number, z: number): number {
  const continent = contrast(fbm2(x / 260, z / 260, seed, 3), 2.4);
  const hills = contrast(fbm2(x / 55, z / 55, seed + 701, 4), 2.6);
  const rough = contrast(fbm2(x / 17, z / 17, seed + 1301, 2), 2.0);

  let h = 26 + continent * 42;
  h += (hills - 0.5) * 30 * (0.3 + continent);
  h += (rough - 0.5) * 5;
  return Math.max(3, Math.min(WORLD_Y - 30, Math.floor(h)));
}

/**
 * Cave test, driven by two coarse noise fields.
 *
 * Evaluating the fBm per voxel meant ~490k hash calls per chunk and dominated
 * generation. Caves are large and smooth, so sampling on a lattice and
 * interpolating is visually equivalent and vastly cheaper.
 */
function caveTester(
  seed: number, cx: number, cz: number,
): (lx: number, y: number, lz: number) => boolean {
  const ox = cx * CHUNK_X;
  const oz = cz * CHUNK_Z;
  const a = coarseField3(seed + 555, ox, oz, WORLD_Y, 4, 38, 22, 2);
  const b = coarseField3(seed + 777, ox, oz, WORLD_Y, 4, 38, 22, 2);
  // Two fields near their midline intersect in long winding tunnels.
  return (lx, y, lz) =>
    Math.abs(a(lx, y, lz) - 0.5) <= 0.055 && Math.abs(b(lx, y, lz) - 0.5) <= 0.055;
}

function oreAt(seed: number, x: number, y: number, z: number): Block | null {
  const r = hash3(x, y, z, seed + 9001);
  if (y < 16 && r < 0.0022) return Block.DiamondOre;
  if (y < 30 && r < 0.005) return Block.GoldOre;
  if (y < 52 && r < 0.011) return Block.IronOre;
  if (y < 72 && r < 0.024) return Block.CoalOre;
  return null;
}

function isTreeSpot(seed: number, x: number, z: number): boolean {
  const r = hash2(x, z, seed + 99);
  if (r > TREE_CHANCE) return false;
  // Only the local minimum of the 3x3 neighbourhood wins, which spaces trees out.
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      if (hash2(x + dx, z + dz, seed + 99) < r) return false;
    }
  }
  return true;
}

/** Writes a block only if it lands inside the chunk being generated. */
function put(
  data: Uint8Array, ox: number, oz: number, x: number, y: number, z: number, id: Block,
  overwrite = false,
): void {
  if (y < 0 || y >= WORLD_Y) return;
  const lx = x - ox;
  const lz = z - oz;
  if (lx < 0 || lx >= CHUNK_X || lz < 0 || lz >= CHUNK_Z) return;
  const i = voxelIndex(lx, y, lz);
  if (!overwrite && data[i] !== Block.Air) return;
  data[i] = id;
}

function placeTree(
  data: Uint8Array, ox: number, oz: number, seed: number, x: number, z: number, groundY: number,
): void {
  const trunk = 4 + Math.floor(hash2(x, z, seed + 4242) * 3);
  const base = groundY + 1;
  const top = base + trunk - 1;
  for (let i = 0; i < trunk; i++) put(data, ox, oz, x, base + i, z, Block.Log, true);

  const layers: Array<[number, number]> = [[-1, 2], [0, 2], [1, 1]];
  for (const [dy, radius] of layers) {
    const ly = top + dy;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dz === 0 && dy < 1) continue;
        if (Math.abs(dx) === radius && Math.abs(dz) === radius) continue; // round the corners
        put(data, ox, oz, x + dx, ly, z + dz, Block.Leaves);
      }
    }
  }
  put(data, ox, oz, x, top + 2, z, Block.Leaves);
}

/** Chunks between strongholds. One per region, so they are findable. */
const STRONGHOLD_REGION = 24;
const STRONGHOLD_Y = 18;

/** Is this the stronghold chunk for its region? */
export function isStrongholdChunk(seed: number, cx: number, cz: number): boolean {
  const rx = Math.floor(cx / STRONGHOLD_REGION);
  const rz = Math.floor(cz / STRONGHOLD_REGION);
  const pick = hash2(rx, rz, seed + 7777);
  const offset = Math.floor(pick * STRONGHOLD_REGION * STRONGHOLD_REGION);
  const localX = offset % STRONGHOLD_REGION;
  const localZ = Math.floor(offset / STRONGHOLD_REGION);
  return cx - rx * STRONGHOLD_REGION === localX && cz - rz * STRONGHOLD_REGION === localZ;
}

/** Where the stronghold for a region sits, in world coordinates. */
export function strongholdLocation(
  seed: number, rx: number, rz: number,
): { x: number; y: number; z: number } {
  const pick = hash2(rx, rz, seed + 7777);
  const offset = Math.floor(pick * STRONGHOLD_REGION * STRONGHOLD_REGION);
  const cx = rx * STRONGHOLD_REGION + (offset % STRONGHOLD_REGION);
  const cz = rz * STRONGHOLD_REGION + Math.floor(offset / STRONGHOLD_REGION);
  return { x: cx * CHUNK_X + 8, y: STRONGHOLD_Y + 1, z: cz * CHUNK_Z + 8 };
}

/**
 * A buried room holding the End portal frame.
 *
 * Sized to sit entirely inside one chunk, so it needs no cross-chunk state.
 */
function buildStronghold(seed: number, cx: number, cz: number, data: Uint8Array): void {
  if (!isStrongholdChunk(seed, cx, cz)) return;

  const y0 = STRONGHOLD_Y;
  const roomHeight = 5;

  for (let lz = 3; lz <= 12; lz++) {
    for (let lx = 3; lx <= 12; lx++) {
      for (let dy = -1; dy <= roomHeight; dy++) {
        const y = y0 + dy;
        if (y < 1 || y >= WORLD_Y) continue;
        const wall = lx === 3 || lx === 12 || lz === 3 || lz === 12 ||
          dy === -1 || dy === roomHeight;
        data[voxelIndex(lx, y, lz)] = wall ? Block.Bricks : Block.Air;
      }
    }
  }

  // The portal frame ring, centred in the room, sunk one block into the floor.
  const centreX = 8;
  const centreZ = 8;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      data[voxelIndex(centreX + dx, y0, centreZ + dz)] = Block.EndPortalFrame;
    }
  }
  data[voxelIndex(centreX, y0, centreZ)] = Block.Air;

  // A couple of glowstone blocks so the room is not pitch dark.
  data[voxelIndex(4, y0 + roomHeight - 1, 4)] = Block.Glowstone;
  data[voxelIndex(11, y0 + roomHeight - 1, 11)] = Block.Glowstone;
}

function generateOverworld(seed: number, cx: number, cz: number, data: Uint8Array): void {
  const ox = cx * CHUNK_X;
  const oz = cz * CHUNK_Z;
  const isCave = caveTester(seed, cx, cz);

  for (let lz = 0; lz < CHUNK_Z; lz++) {
    const z = oz + lz;
    for (let lx = 0; lx < CHUNK_X; lx++) {
      const x = ox + lx;
      const h = columnHeight(seed, x, z);
      const beach = h <= SEA_LEVEL + 1;

      for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
        let id: Block;
        if (y <= 1) {
          id = Block.Bedrock;
        } else if (y > h) {
          id = Block.Water;
        } else if (y === h) {
          id = beach ? Block.Sand : h >= 84 ? Block.Stone : Block.Grass;
        } else if (y > h - 4) {
          id = beach ? Block.Sand : Block.Dirt;
        } else {
          id = oreAt(seed, x, y, z) ?? Block.Stone;
        }

        // Caves cut through stone, but never breach the seabed or bedrock.
        if (y > 2 && y < h - 2 && id !== Block.Water && h > SEA_LEVEL && isCave(lx, y, lz)) {
          id = Block.Air;
        }
        data[voxelIndex(lx, y, lz)] = id;
      }
    }
  }

  buildStronghold(seed, cx, cz, data);
  buildStructures(seed, cx, cz, data);

  // Trees, including ones rooted just outside the chunk whose canopy reaches in.
  for (let lz = -TREE_MARGIN; lz < CHUNK_Z + TREE_MARGIN; lz++) {
    for (let lx = -TREE_MARGIN; lx < CHUNK_X + TREE_MARGIN; lx++) {
      const x = ox + lx;
      const z = oz + lz;
      if (!isTreeSpot(seed, x, z)) continue;
      const h = columnHeight(seed, x, z);
      if (h <= SEA_LEVEL + 1 || h >= 84) continue;
      placeTree(data, ox, oz, seed, x, z, h);
    }
  }
}

/**
 * Samples a 3D noise field on a coarse lattice and trilinearly interpolates.
 *
 * Cavern shapes are blobby enough that per-voxel noise is wasted work: this
 * turns ~25k noise evaluations per chunk into a few hundred.
 */
function coarseField3(
  seed: number, ox: number, oz: number, height: number, stride: number,
  scaleXZ = 30, scaleY = 20, octaves = 2,
): (lx: number, y: number, lz: number) => number {
  const nx = CHUNK_X / stride + 1;
  const nz = CHUNK_Z / stride + 1;
  const ny = Math.ceil(height / stride) + 1;
  const grid = new Float32Array(nx * ny * nz);

  for (let j = 0; j < ny; j++) {
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        grid[(j * nz + k) * nx + i] = fbm3(
          (ox + i * stride) / scaleXZ,
          (j * stride) / scaleY,
          (oz + k * stride) / scaleXZ,
          seed, octaves);
      }
    }
  }

  return (lx, y, lz) => {
    const fx = lx / stride;
    const fy = y / stride;
    const fz = lz / stride;
    const i = Math.min(nx - 2, fx | 0);
    const j = Math.min(ny - 2, fy | 0);
    const k = Math.min(nz - 2, fz | 0);
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - k;

    // Indices computed inline: a helper closure here would be allocated once
    // per voxel, which dominated the whole generator.
    const b000 = (j * nz + k) * nx + i;
    const b100 = b000 + 1;
    const b010 = ((j + 1) * nz + k) * nx + i;
    const b110 = b010 + 1;
    const b001 = (j * nz + k + 1) * nx + i;
    const b101 = b001 + 1;
    const b011 = ((j + 1) * nz + k + 1) * nx + i;
    const b111 = b011 + 1;

    const x00 = grid[b000] + (grid[b100] - grid[b000]) * tx;
    const x10 = grid[b010] + (grid[b110] - grid[b010]) * tx;
    const x01 = grid[b001] + (grid[b101] - grid[b001]) * tx;
    const x11 = grid[b011] + (grid[b111] - grid[b011]) * tx;
    const y0 = x00 + (x10 - x00) * ty;
    const y1 = x01 + (x11 - x01) * ty;
    return y0 + (y1 - y0) * tz;
  };
}

function generateNether(seed: number, cx: number, cz: number, data: Uint8Array): void {
  const ox = cx * CHUNK_X;
  const oz = cz * CHUNK_Z;
  const ROOF = 100;
  const LAVA_LEVEL = 22;
  const density = coarseField3(seed + 3131, ox, oz, ROOF, 4);

  for (let lz = 0; lz < CHUNK_Z; lz++) {
    const z = oz + lz;
    for (let lx = 0; lx < CHUNK_X; lx++) {
      const x = ox + lx;
      // Per-column, not per-voxel: this is the same value for the whole column.
      // Kept mostly below the lava line so basins actually flood.
      const floor = 6 + contrast(fbm2(x / 60, z / 60, seed + 4141, 3), 2.0) * 20;
      // Per-column decisions, so the inner loop stays cheap.
      const soulPatch = hash2(x, z, seed + 55) < 0.07;
      const glowColumn = hash2(x, z, seed + 606) < 0.03;

      for (let y = 0; y < ROOF; y++) {
        let id: Block;
        if (y <= 1 || y >= ROOF - 2) {
          id = Block.Bedrock;
        } else {
          // Carve open caverns out of a solid netherrack slab; anything open
          // below the lava line fills with lava in the same pass.
          const open = density(lx, y, lz) > 0.52 && y > floor;
          if (open) id = y <= LAVA_LEVEL ? Block.Lava : Block.Air;
          else if (soulPatch && y >= floor - 1 && y <= floor + 1) id = Block.SoulSand;
          else id = Block.Netherrack;
        }
        data[voxelIndex(lx, y, lz)] = id;
      }

      // Glowstone on cavern ceilings, so the place isn't pitch black. Only a
      // few columns qualify, so this scan is cheap.
      if (glowColumn) {
        for (let y = LAVA_LEVEL + 4; y < ROOF - 3; y++) {
          const i = voxelIndex(lx, y, lz);
          if (data[i] === Block.Air && data[voxelIndex(lx, y + 1, lz)] === Block.Netherrack) {
            data[i] = Block.Glowstone;
            break;
          }
        }
      }
    }
  }
}

function generateEnd(seed: number, cx: number, cz: number, data: Uint8Array): void {
  const ox = cx * CHUNK_X;
  const oz = cz * CHUNK_Z;
  const BASE = 56;

  for (let lz = 0; lz < CHUNK_Z; lz++) {
    const z = oz + lz;
    for (let lx = 0; lx < CHUNK_X; lx++) {
      const x = ox + lx;
      const dist = Math.hypot(x, z);

      // A main island around the origin, then scattered outer islands.
      let mass = 0;
      if (dist < 90) mass = 1 - dist / 90;
      const outer = contrast(fbm2(x / 70, z / 70, seed + 8181, 3), 2.6);
      if (dist > 140) mass = Math.max(mass, outer - 0.62);
      if (mass <= 0) continue;

      const thickness = Math.floor(4 + mass * 22);
      const bulge = Math.floor((contrast(fbm2(x / 24, z / 24, seed + 9191, 2), 2.0) - 0.5) * 8);
      const top = BASE + Math.floor(mass * 10) + bulge;
      for (let y = top - thickness; y <= top; y++) {
        if (y < 2 || y >= WORLD_Y) continue;
        data[voxelIndex(lx, y, lz)] = Block.EndStone;
      }
    }
  }
}

/** Base terrain for one chunk. Player edits are layered on top by the caller. */
export function generateChunk(
  seed: number, dim: Dimension, cx: number, cz: number,
): Uint8Array {
  const data = new Uint8Array(CHUNK_X * CHUNK_Z * WORLD_Y);
  switch (dim) {
    case Dimension.Nether:
      generateNether(seed, cx, cz, data);
      break;
    case Dimension.End:
      generateEnd(seed, cx, cz, data);
      break;
    default:
      generateOverworld(seed, cx, cz, data);
  }
  return data;
}

/** A safe standing height for spawning at a given column. */
export function surfaceY(seed: number, dim: Dimension, x: number, z: number): number {
  if (dim === Dimension.Overworld) {
    return Math.max(columnHeight(seed, x, z), SEA_LEVEL) + 1;
  }
  if (dim === Dimension.End) return 70;
  return 40;
}