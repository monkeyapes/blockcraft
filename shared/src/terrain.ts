/**
 * World generation.
 *
 * Pure function of (seed, dimension, chunk coords) so the client and the
 * server produce identical terrain and only *edits* ever cross the network.
 */

import { Block } from './blocks.js';
import { CHUNK_X, CHUNK_Z, Dimension, SEA_LEVEL, WORLD_Y, voxelIndex } from './constants.js';
import { contrast, fbm2, fbm3, hash2, hash3, value2 } from './noise.js';
import { buildStructures } from './structures.js';

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

const TREE_MARGIN = 3; // how far outside a chunk a tree can start and still reach in

// --- biomes -------------------------------------------------------------------

/**
 * What a stretch of land is like. Biomes change only what grows on the
 * ground and what it is made of at the surface -- never the height -- so the
 * mountains, coasts and villages of a world stay where they always were.
 */
export enum Biome {
  Plains,
  Forest,
  Taiga,
  SnowyTaiga,
  Desert,
  Swamp,
  Mountains,
}

export const BIOME_NAMES: Record<Biome, string> = {
  [Biome.Plains]: 'Plains',
  [Biome.Forest]: 'Forest',
  [Biome.Taiga]: 'Taiga',
  [Biome.SnowyTaiga]: 'Snowy Taiga',
  [Biome.Desert]: 'Desert',
  [Biome.Swamp]: 'Swamp',
  [Biome.Mountains]: 'Mountains',
};

/** Above this the ground is bare rock, as it always was. */
const MOUNTAIN_Y = 84;
/** Peaks above this carry snow whatever the climate. */
const SNOWLINE_Y = 92;

/**
 * Temperature and humidity, 0..1, as two broad noise fields.
 *
 * Two octaves and a wide scale: climate should change over hundreds of
 * blocks, and a biome that flickers every few steps reads as noise rather
 * than as a place. `contrast` spreads the values so every band of the
 * climate table actually occurs (measured: each quartile spans ~0.25).
 */
export function climateAt(seed: number, x: number, z: number): { temp: number; wet: number } {
  return {
    temp: contrast(fbm2(x / 420, z / 420, seed + 2101, 2), 2.2),
    wet: contrast(fbm2(x / 360, z / 360, seed + 3303, 2), 2.2),
  };
}

/** The biome of a column. `h` is its terrain height, when the caller has it. */
export function biomeAt(seed: number, x: number, z: number, h = columnHeight(seed, x, z)): Biome {
  if (h >= MOUNTAIN_Y) return Biome.Mountains;
  const { temp, wet } = climateAt(seed, x, z);
  if (temp < 0.16) return Biome.SnowyTaiga;
  if (temp < 0.3) return Biome.Taiga;
  if (temp > 0.68 && wet < 0.45) return Biome.Desert;
  if (wet > 0.68) return Biome.Swamp;
  if (wet > 0.46) return Biome.Forest;
  return Biome.Plains;
}

/**
 * Chance a column is a tree candidate, by biome. Candidates still have to be
 * the lowest roll among their eight neighbours, which keeps even a dense
 * forest from fusing into one canopy.
 */
const TREE_DENSITY: Record<Biome, number> = {
  [Biome.Plains]: 0.006,
  [Biome.Forest]: 0.075,
  [Biome.Taiga]: 0.045,
  [Biome.SnowyTaiga]: 0.03,
  [Biome.Desert]: 0,
  [Biome.Swamp]: 0.02,
  [Biome.Mountains]: 0.01,
};
const MAX_TREE_DENSITY = 0.075;

// --- ores and rock ------------------------------------------------------------

function oreAt(seed: number, x: number, y: number, z: number): Block | null {
  const r = hash3(x, y, z, seed + 9001);
  if (y < 16 && r < 0.0022) return Block.DiamondOre;
  if (y < 30 && r < 0.005) return Block.GoldOre;
  if (y < 52 && r < 0.011) return Block.IronOre;
  if (y < 72 && r < 0.024) return Block.CoalOre;
  return null;
}

/** Copper veins per chunk, and the depth band they sit in. */
export const COPPER_VEINS = 7;
export const COPPER_Y: readonly [number, number] = [18, 62];
/** Ruby is rare and deep: at most one small pocket per chunk. */
export const RUBY_CHANCE = 0.45;
export const RUBY_Y: readonly [number, number] = [4, 18];

/**
 * Grows a small vein by a random walk from a start cell, replacing only
 * stone. Veins are kept inside their own chunk, so no neighbour ever needs
 * to know about them.
 */
function vein(
  data: Uint8Array, seed: number, cx: number, cz: number, index: number,
  ore: Block, yRange: readonly [number, number], size: number,
): void {
  const h = (k: number) => hash3(cx * 31 + index, k, cz * 17 - index, seed + 6161);
  let lx = 1 + Math.floor(h(1) * 14);
  let lz = 1 + Math.floor(h(2) * 14);
  let y = yRange[0] + Math.floor(h(3) * (yRange[1] - yRange[0]));
  for (let i = 0; i < size; i++) {
    const idx = voxelIndex(lx, y, lz);
    if (data[idx] === Block.Stone) data[idx] = ore;
    const step = Math.floor(h(10 + i) * 6);
    if (step === 0) lx = Math.min(14, lx + 1);
    else if (step === 1) lx = Math.max(1, lx - 1);
    else if (step === 2) lz = Math.min(14, lz + 1);
    else if (step === 3) lz = Math.max(1, lz - 1);
    else if (step === 4) y = Math.min(yRange[1], y + 1);
    else y = Math.max(yRange[0], y - 1);
  }
}

/**
 * Pockets of granite, slate and limestone through the stone.
 *
 * Blobs live on a 16-block lattice; each lattice cell may hold one, and a
 * chunk looks at the cells around it too, so a blob straddling a chunk edge
 * is carved identically from both sides. Only plain stone is replaced: ores
 * stay put and caves stay open.
 */
function rockPockets(seed: number, cx: number, cz: number, data: Uint8Array): void {
  const ox = cx * CHUNK_X;
  const oz = cz * CHUNK_Z;
  for (let gz = cz - 1; gz <= cz + 1; gz++) {
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = 0; gy < 5; gy++) {
        if (hash3(gx, gy, gz, seed + 5151) > 0.7) continue;
        const bx = gx * 16 + hash3(gx, gy, gz, seed + 5252) * 16;
        const by = 4 + gy * 16 + hash3(gx, gy, gz, seed + 5353) * 16;
        const bz = gz * 16 + hash3(gx, gy, gz, seed + 5454) * 16;
        const r = 2.5 + hash3(gx, gy, gz, seed + 5555) * 2.5;
        const pick = hash3(gx, gy, gz, seed + 5656);
        // Slate is the deep rock, limestone the shallow one, granite anywhere.
        const rock = by < 30
          ? (pick < 0.6 ? Block.Slate : Block.Granite)
          : (pick < 0.5 ? Block.Granite : pick < 0.8 ? Block.Limestone : Block.Slate);
        const x0 = Math.max(ox, Math.floor(bx - r));
        const x1 = Math.min(ox + CHUNK_X - 1, Math.ceil(bx + r));
        const z0 = Math.max(oz, Math.floor(bz - r));
        const z1 = Math.min(oz + CHUNK_Z - 1, Math.ceil(bz + r));
        if (x0 > x1 || z0 > z1) continue;
        const y0 = Math.max(2, Math.floor(by - r));
        const y1 = Math.min(WORLD_Y - 1, Math.ceil(by + r));
        for (let y = y0; y <= y1; y++) {
          const dy = (y - by) * 1.3; // a little flattened, like bedded rock
          for (let z = z0; z <= z1; z++) {
            for (let x = x0; x <= x1; x++) {
              const dx = x - bx;
              const dz = z - bz;
              if (dx * dx + dy * dy + dz * dz > r * r) continue;
              const i = voxelIndex(x - ox, y, z - oz);
              if (data[i] === Block.Stone) data[i] = rock;
            }
          }
        }
      }
    }
  }
}

// --- trees --------------------------------------------------------------------

export type TreeKind = 'oak' | 'birch' | 'pine';

/** One block of a tree, relative to the cell its trunk starts in. */
export interface TreeCell {
  dx: number;
  dy: number;
  dz: number;
  id: Block;
  trunk: boolean;
}

/** Trunk height for a tree, from a 0..1 roll. */
export function treeHeight(kind: TreeKind, roll: number): number {
  if (kind === 'birch') return 5 + Math.floor(roll * 3);
  if (kind === 'pine') return 7 + Math.floor(roll * 3);
  return 4 + Math.floor(roll * 3);
}

/**
 * Every block of a tree, trunk first.
 *
 * One definition serves world generation and a sapling growing in play, so a
 * tree you plant is the same tree you find. Oak is the original tree exactly;
 * birch is taller and narrower with a rounded crown; pine is a cone of
 * alternating wide and narrow tiers with bare trunk at the bottom.
 */
export function treeCells(kind: TreeKind, height: number): TreeCell[] {
  const log = kind === 'birch' ? Block.BirchLog : kind === 'pine' ? Block.PineLog : Block.Log;
  const leaves = kind === 'birch' ? Block.BirchLeaves : kind === 'pine' ? Block.PineLeaves : Block.Leaves;
  const cells: TreeCell[] = [];
  for (let i = 0; i < height; i++) cells.push({ dx: 0, dy: i, dz: 0, id: log, trunk: true });
  const top = height - 1;

  // A square layer of the given radius; `round` drops its four corners.
  const layer = (dy: number, radius: number, round: boolean): void => {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dz === 0 && dy <= top) continue;
        if (round && radius > 0 && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
        cells.push({ dx, dy, dz, id: leaves, trunk: false });
      }
    }
  };

  if (kind === 'oak') {
    layer(top - 1, 2, true);
    layer(top, 2, true);
    layer(top + 1, 1, true);
    layer(top + 2, 0, false);
  } else if (kind === 'birch') {
    layer(top - 2, 2, true);
    layer(top - 1, 2, true);
    layer(top, 1, false);
    layer(top + 1, 1, true);
  } else {
    // Radii from the tip down: a point, then tiers that step out and back
    // in again, which is what gives a conifer its layered silhouette.
    const radii = [0, 1, 1, 2, 1, 2, 3, 2, 3];
    const bottom = 2; // bare trunk below this
    for (let dy = top + 1, i = 0; dy >= bottom && i < radii.length; dy--, i++) {
      const r = radii[i];
      layer(dy, r, r !== 1 || i % 2 === 1);
    }
  }
  return cells;
}

/** Which tree a biome grows at a spot. */
function treeKindFor(biome: Biome, roll: number): TreeKind {
  if (biome === Biome.Taiga || biome === Biome.SnowyTaiga || biome === Biome.Mountains) return 'pine';
  if (biome === Biome.Forest && roll < 0.4) return 'birch';
  return 'oak';
}

function isTreeSpot(seed: number, x: number, z: number, chance: number): boolean {
  const r = hash2(x, z, seed + 99);
  if (r > chance) return false;
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
  kind: TreeKind,
): void {
  const height = treeHeight(kind, hash2(x, z, seed + 4242));
  const base = groundY + 1;
  for (const c of treeCells(kind, height)) {
    put(data, ox, oz, x + c.dx, base + c.dy, z + c.dz, c.id, c.trunk);
  }
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

/** The flowers a meadow picks from, most common first. */
const FLOWERS: readonly Block[] = [Block.Dandelion, Block.Poppy, Block.Dandelion, Block.Cornflower, Block.Tulip];

function generateOverworld(seed: number, cx: number, cz: number, data: Uint8Array): void {
  const ox = cx * CHUNK_X;
  const oz = cz * CHUNK_Z;
  const isCave = caveTester(seed, cx, cz);

  // Heights with a one-column margin, so reeds can see the water beside them
  // without evaluating the terrain noise a second time.
  const W = CHUNK_X + 2;
  const heights = new Int16Array(W * (CHUNK_Z + 2));
  for (let lz = -1; lz <= CHUNK_Z; lz++) {
    for (let lx = -1; lx <= CHUNK_X; lx++) {
      heights[(lz + 1) * W + lx + 1] = columnHeight(seed, ox + lx, oz + lz);
    }
  }
  const heightOf = (lx: number, lz: number): number => heights[(lz + 1) * W + lx + 1];
  const biomes = new Uint8Array(CHUNK_X * CHUNK_Z);

  for (let lz = 0; lz < CHUNK_Z; lz++) {
    const z = oz + lz;
    for (let lx = 0; lx < CHUNK_X; lx++) {
      const x = ox + lx;
      const h = heightOf(lx, lz);
      const biome = biomeAt(seed, x, z, h);
      biomes[lz * CHUNK_X + lx] = biome;
      const beach = h <= SEA_LEVEL + 1;
      const desert = biome === Biome.Desert;

      // The surface and the few blocks under it.
      let top: Block = beach ? Block.Sand : h >= MOUNTAIN_Y ? Block.Stone : Block.Grass;
      let soil: Block = beach ? Block.Sand : Block.Dirt;
      if (desert) {
        top = Block.Sand;
        soil = Block.Sand;
      } else if (!beach && h < MOUNTAIN_Y) {
        if (biome === Biome.SnowyTaiga) top = Block.SnowyGrass;
        else if (biome === Biome.Taiga && value2(x / 5, z / 5, seed + 818) > 0.62) top = Block.Podzol;
      }
      // Clay settles in patches on shallow seabeds, most of all in swamps.
      if (h < SEA_LEVEL && h >= SEA_LEVEL - 6 &&
          value2(x / 5, z / 5, seed + 919) > (biome === Biome.Swamp ? 0.5 : 0.74)) {
        top = Block.Clay;
        soil = Block.Clay;
      }

      for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
        let id: Block;
        if (y <= 1) {
          id = Block.Bedrock;
        } else if (y > h) {
          id = Block.Water;
        } else if (y === h) {
          id = top;
        } else if (y > h - 4) {
          id = soil;
        } else if (desert && y > h - 8) {
          // Sand rests on sandstone, which is what holds a desert up.
          id = Block.Sandstone;
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

  rockPockets(seed, cx, cz, data);
  for (let i = 0; i < COPPER_VEINS; i++) {
    vein(data, seed, cx, cz, i, Block.CopperOre, COPPER_Y, 5 + Math.floor(hash3(cx, i, cz, seed + 6262) * 5));
  }
  if (hash2(cx, cz, seed + 6363) < RUBY_CHANCE) vein(data, seed, cx, cz, 99, Block.RubyOre, RUBY_Y, 3);

  buildStronghold(seed, cx, cz, data);
  buildStructures(seed, cx, cz, data);

  // Trees, including ones rooted just outside the chunk whose canopy reaches in.
  for (let lz = -TREE_MARGIN; lz < CHUNK_Z + TREE_MARGIN; lz++) {
    for (let lx = -TREE_MARGIN; lx < CHUNK_X + TREE_MARGIN; lx++) {
      const x = ox + lx;
      const z = oz + lz;
      // Cheap reject first: almost no column is even a candidate.
      if (hash2(x, z, seed + 99) > MAX_TREE_DENSITY) continue;
      const inside = lx >= 0 && lx < CHUNK_X && lz >= 0 && lz < CHUNK_Z;
      const h = inside ? heightOf(lx, lz) : columnHeight(seed, x, z);
      if (h <= SEA_LEVEL + 1) continue;
      const biome = inside ? biomes[lz * CHUNK_X + lx] as Biome : biomeAt(seed, x, z, h);
      if (h >= MOUNTAIN_Y) continue;
      if (!isTreeSpot(seed, x, z, TREE_DENSITY[biome])) continue;
      placeTree(data, ox, oz, seed, x, z, h, treeKindFor(biome, hash2(x, z, seed + 4343)));
    }
  }

  decorate(seed, ox, oz, data, heightOf, biomes);
}

/** Soil a plant may stand on. */
function fertile(id: number): boolean {
  return id === Block.Grass || id === Block.Dirt || id === Block.Podzol || id === Block.SnowyGrass;
}

/**
 * Everything that grows on the ground and lies on top of it: grass, flowers,
 * cacti, reeds, lily pads, then snow and ice over all of it in the cold.
 *
 * Runs after trees, so nothing sprouts inside a trunk and snow lands on the
 * canopy rather than under it. Each column only ever writes into itself, so
 * no chunk depends on its neighbours' decoration.
 */
function decorate(
  seed: number, ox: number, oz: number, data: Uint8Array,
  heightOf: (lx: number, lz: number) => number, biomes: Uint8Array,
): void {
  for (let lz = 0; lz < CHUNK_Z; lz++) {
    for (let lx = 0; lx < CHUNK_X; lx++) {
      const x = ox + lx;
      const z = oz + lz;
      const h = heightOf(lx, lz);
      const biome = biomes[lz * CHUNK_X + lx] as Biome;
      const r = hash2(x, z, seed + 1717);
      const pick = hash2(x, z, seed + 1818);
      const ground = data[voxelIndex(lx, h, lz)];
      const clear = h + 1 < WORLD_Y && data[voxelIndex(lx, h + 1, lz)] === Block.Air;
      const at = (dy: number, id: Block) => put(data, ox, oz, x, h + dy, z, id);

      if (h < SEA_LEVEL) {
        // Open water: lily pads on shallow swamp water. Only still surface
        // water counts, so nothing floats on a cave pool.
        if (biome === Biome.Swamp && SEA_LEVEL - h <= 4 && r < 0.12 &&
            data[voxelIndex(lx, SEA_LEVEL, lz)] === Block.Water &&
            data[voxelIndex(lx, SEA_LEVEL + 1, lz)] === Block.Air) {
          put(data, ox, oz, x, SEA_LEVEL + 1, z, Block.LilyPad);
        }
      } else if (clear) {
        // Reeds on any bank that touches water, in every climate but the frozen.
        const nearWater = h <= SEA_LEVEL + 1 && (ground === Block.Sand || fertile(ground)) &&
          (heightOf(lx + 1, lz) < SEA_LEVEL || heightOf(lx - 1, lz) < SEA_LEVEL ||
           heightOf(lx, lz + 1) < SEA_LEVEL || heightOf(lx, lz - 1) < SEA_LEVEL);
        if (nearWater && biome !== Biome.SnowyTaiga && r < (biome === Biome.Swamp ? 0.3 : 0.12)) {
          const tall = 1 + Math.floor(pick * 3);
          for (let i = 1; i <= tall; i++) at(i, Block.Reeds);
        } else if (biome === Biome.Desert) {
          if (ground === Block.Sand) {
            if (r < CACTUS_CHANCE && isCactusSpot(seed, x, z)) {
              const tall = 1 + Math.floor(pick * 3);
              for (let i = 1; i <= tall; i++) at(i, Block.Cactus);
            } else if (r > 0.985) {
              at(1, Block.DeadBush);
            }
          }
        } else if (fertile(ground)) {
          decorateGrass(biome, r, pick, at, () => shaded(data, lx, h, lz));
        }
      }

      // Snow over everything in the cold and on high peaks; ice on still water.
      if (biome === Biome.SnowyTaiga || (biome === Biome.Mountains && h >= SNOWLINE_Y)) {
        for (let y = Math.min(WORLD_Y - 2, Math.max(h, SEA_LEVEL) + 14); y >= h; y--) {
          const id = data[voxelIndex(lx, y, lz)];
          if (id === Block.Air) continue;
          if (id === Block.Water) data[voxelIndex(lx, y, lz)] = Block.Ice;
          else if (id !== Block.LilyPad && id !== Block.Reeds) {
            // Plants under a fresh fall are buried rather than poking through.
            if (BURIED.has(id)) data[voxelIndex(lx, y, lz)] = Block.SnowLayer;
            else data[voxelIndex(lx, y + 1, lz)] = Block.SnowLayer;
          }
          break;
        }
      }
    }
  }
}

/** Small plants a snowfall covers over rather than settling on top of. */
const BURIED: ReadonlySet<number> = new Set([
  Block.TallGrass, Block.Fern, Block.BrownMushroom, Block.RedMushroom,
]);

/** Chance a desert column grows a cactus. */
const CACTUS_CHANCE = 0.009;

/** Cacti never grow side by side: a neighbour touching one would break it. */
function isCactusSpot(seed: number, x: number, z: number): boolean {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (hash2(x + dx, z + dz, seed + 1717) < CACTUS_CHANCE) return false;
  }
  return true;
}

/** Is there canopy a few blocks over this column? Mushrooms like the shade. */
function shaded(data: Uint8Array, lx: number, h: number, lz: number): boolean {
  for (let y = h + 2; y <= Math.min(WORLD_Y - 1, h + 9); y++) {
    const id = data[voxelIndex(lx, y, lz)];
    if (id === Block.Leaves || id === Block.BirchLeaves || id === Block.PineLeaves) return true;
  }
  return false;
}

/** Ground cover on grassy soil, by biome. */
function decorateGrass(
  biome: Biome, r: number, pick: number, at: (dy: number, id: Block) => void, isShaded: () => boolean,
): void {
  switch (biome) {
    case Biome.Plains:
      if (r < 0.26) at(1, Block.TallGrass);
      else if (r < 0.3) at(1, FLOWERS[Math.floor(pick * FLOWERS.length)]);
      else if (r < 0.3012) at(1, Block.Pumpkin);
      else if (r < 0.3018) at(1, Block.Melon);
      break;
    case Biome.Forest:
      if (r < 0.05 && isShaded()) at(1, pick < 0.5 ? Block.BrownMushroom : Block.RedMushroom);
      else if (r < 0.16) at(1, Block.TallGrass);
      else if (r < 0.19) at(1, Block.Fern);
      else if (r < 0.205) at(1, FLOWERS[Math.floor(pick * FLOWERS.length)]);
      else if (r < 0.2062) at(1, Block.Pumpkin);
      break;
    case Biome.Taiga:
    case Biome.SnowyTaiga:
      if (r < 0.04 && isShaded()) at(1, pick < 0.7 ? Block.BrownMushroom : Block.RedMushroom);
      else if (r < 0.14) at(1, Block.Fern);
      else if (r < 0.2) at(1, Block.TallGrass);
      else if (r < 0.2015 && biome === Biome.Taiga) at(1, Block.Pumpkin);
      break;
    case Biome.Swamp:
      if (r < 0.03 && isShaded()) at(1, Block.BrownMushroom);
      else if (r < 0.3) at(1, Block.TallGrass);
      else if (r < 0.34) at(1, Block.Fern);
      else if (r < 0.345) at(1, Block.Cornflower);
      else if (r < 0.3465) at(1, Block.Melon);
      break;
    default:
      if (r < 0.12) at(1, Block.TallGrass);
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