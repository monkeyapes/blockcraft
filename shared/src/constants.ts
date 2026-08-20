/** World geometry constants. Shared verbatim by client and server. */

export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const WORLD_Y = 128;

export const SECTION_Y = 16;
export const SECTION_COUNT = WORLD_Y / SECTION_Y; // 8

export const CHUNK_VOLUME = CHUNK_X * CHUNK_Z * WORLD_Y;

/** Voxel index inside a chunk's flat array. Layout is y-major, then z, then x. */
export function voxelIndex(lx: number, y: number, lz: number): number {
  return (y << 8) | (lz << 4) | lx;
}

export const SEA_LEVEL = 40;

export enum Dimension {
  Overworld = 0,
  Nether = 1,
  End = 2,
}

/** Nether is 1:8 scale against the overworld, same as you'd expect. */
export const NETHER_SCALE = 8;

export function chunkKey(cx: number, cz: number): number {
  // Packs two 16-bit signed chunk coords into one integer key.
  return ((cx & 0xffff) << 16) | (cz & 0xffff);
}

export function unpackChunkKey(key: number): [number, number] {
  let cx = (key >> 16) & 0xffff;
  let cz = key & 0xffff;
  if (cx > 0x7fff) cx -= 0x10000;
  if (cz > 0x7fff) cz -= 0x10000;
  return [cx, cz];
}

export function dimChunkKey(dim: Dimension, cx: number, cz: number): string {
  return `${dim}:${cx},${cz}`;
}
