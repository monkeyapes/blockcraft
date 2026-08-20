/**
 * Client-side world.
 *
 * Base terrain is generated locally from the shared seed; the server only
 * ever sends edits. Chunks are dense Uint8Arrays so caves, overhangs and
 * other dimensions all come for free.
 */

import { Block, isOpaque } from '@shared/blocks.js';
import {
  CHUNK_X, CHUNK_Z, Dimension, SECTION_COUNT, SECTION_Y, WORLD_Y, chunkKey, voxelIndex,
} from '@shared/constants.js';
import { generateChunk } from '@shared/terrain.js';
import type { PackedEdit } from '@shared/protocol.js';
import { LightEngine, MAX_LIGHT } from './light.js';

export class Chunk {
  readonly data: Uint8Array;
  /** Propagated block light, 0-15, from torches and other emitters. */
  readonly light = new Uint8Array(CHUNK_X * CHUNK_Z * WORLD_Y);
  /** Propagated sky light, 0-15, before time of day is applied. */
  readonly skylight = new Uint8Array(CHUNK_X * CHUNK_Z * WORLD_Y);
  /** Highest opaque block per column; seeds sky light and answers spawn tests. */
  readonly heightmap = new Uint8Array(CHUNK_X * CHUNK_Z);
  /** Per-section mesh-rebuild flags. */
  readonly dirty: boolean[] = new Array(SECTION_COUNT).fill(true);
  /** Set once the server has told us this chunk's edits. */
  synced = false;

  constructor(readonly cx: number, readonly cz: number, seed: number, dim: Dimension) {
    this.data = generateChunk(seed, dim, cx, cz);
    this.rebuildHeightmap();
  }

  rebuildHeightmap(): void {
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        this.heightmap[lz * CHUNK_X + lx] = this.columnTop(lx, lz);
      }
    }
  }

  private columnTop(lx: number, lz: number): number {
    for (let y = WORLD_Y - 1; y >= 0; y--) {
      if (isOpaque(this.data[voxelIndex(lx, y, lz)])) return y;
    }
    return 0;
  }

  updateColumn(lx: number, lz: number): void {
    this.heightmap[lz * CHUNK_X + lx] = this.columnTop(lx, lz);
  }

  markDirty(y: number): void {
    const s = Math.min(SECTION_COUNT - 1, Math.max(0, (y / SECTION_Y) | 0));
    this.dirty[s] = true;
    // A block on a section seam changes the neighbour's border faces too.
    if (y % SECTION_Y === 0 && s > 0) this.dirty[s - 1] = true;
    if (y % SECTION_Y === SECTION_Y - 1 && s < SECTION_COUNT - 1) this.dirty[s + 1] = true;
  }
}

export class ClientWorld {
  readonly chunks = new Map<number, Chunk>();
  /** Edits that arrived before their chunk existed. */
  private pending = new Map<number, PackedEdit[]>();
  readonly light = new LightEngine(this);

  constructor(readonly seed: number, readonly dim: Dimension) {}

  chunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  ensureChunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz, this.seed, this.dim);
      this.chunks.set(key, chunk);
      const queued = this.pending.get(key);
      if (queued) {
        this.pending.delete(key);
        this.applyEdits(cx, cz, queued);
      }
      // Neighbours' seam faces depend on this chunk's contents.
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const n = this.chunks.get(chunkKey(cx + dx, cz + dz));
        if (n) for (let s = 0; s < SECTION_COUNT; s++) n.dirty[s] = true;
      }
      this.light.seedChunk(cx, cz);
    }
    return chunk;
  }

  unloadChunk(cx: number, cz: number): void {
    this.chunks.delete(chunkKey(cx, cz));
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_Y) return Block.Air;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk) return Block.Air;
    return chunk.data[voxelIndex(x & 15, y, z & 15)];
  }

  /** True when the chunk is missing, i.e. "unknown" rather than "air". */
  isLoaded(x: number, z: number): boolean {
    return this.chunks.has(chunkKey(x >> 4, z >> 4));
  }

  setBlock(x: number, y: number, z: number, block: number): boolean {
    if (y < 0 || y >= WORLD_Y) return false;
    const cx = x >> 4;
    const cz = z >> 4;
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;

    const lx = x & 15;
    const lz = z & 15;
    const idx = voxelIndex(lx, y, lz);
    if (chunk.data[idx] === block) return false;

    chunk.data[idx] = block;
    chunk.updateColumn(lx, lz);
    chunk.markDirty(y);

    // Faces on a chunk seam belong to the neighbour's mesh.
    if (lx === 0) this.touchNeighbour(cx - 1, cz, y);
    else if (lx === 15) this.touchNeighbour(cx + 1, cz, y);
    if (lz === 0) this.touchNeighbour(cx, cz - 1, y);
    else if (lz === 15) this.touchNeighbour(cx, cz + 1, y);

    this.light.blockChanged(x, y, z, block);
    return true;
  }

  private touchNeighbour(cx: number, cz: number, y: number): void {
    this.chunks.get(chunkKey(cx, cz))?.markDirty(y);
  }

  applyEdits(cx: number, cz: number, edits: PackedEdit[]): void {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) {
      this.pending.set(key, edits);
      return;
    }
    chunk.synced = true;
    if (edits.length === 0) return;

    for (const [idx, block] of edits) {
      chunk.data[idx] = block;
    }
    chunk.rebuildHeightmap();
    // The terrain moved, so the sunlight that fell through it is stale.
    this.light.resetSky(cx, cz);
    for (let s = 0; s < SECTION_COUNT; s++) chunk.dirty[s] = true;
    // Seams: neighbours may now show or hide faces against this chunk.
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const n = this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (n) for (let s = 0; s < SECTION_COUNT; s++) n.dirty[s] = true;
    }
  }

  /**
   * Sky exposure at a voxel, 0 (sealed off) to 1 (open sky).
   *
   * This is the propagated sky-light level normalised, so it reaches sideways
   * under an overhang and down an open shaft the way real daylight does.
   */
  skyLight(x: number, y: number, z: number): number {
    if (!this.chunks.has(chunkKey(x >> 4, z >> 4))) return 1;
    return this.getSkyLight(x, y, z) / MAX_LIGHT;
  }

  /** Highest opaque block in a column, or -1 if that chunk is not loaded. */
  heightAt(x: number, z: number): number {
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return chunk ? chunk.heightmap[(z & 15) * CHUNK_X + (x & 15)] : -1;
  }

  getSkyLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_Y) return y >= WORLD_Y ? MAX_LIGHT : 0;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk) return 0;
    return chunk.skylight[voxelIndex(x & 15, y, z & 15)];
  }

  setSkyLight(x: number, y: number, z: number, level: number): void {
    if (y < 0 || y >= WORLD_Y) return;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk) return;
    const index = voxelIndex(x & 15, y, z & 15);
    if (chunk.skylight[index] === level) return;
    chunk.skylight[index] = level;
    this.touchLit(x, y, z);
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_Y) return 0;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk) return 0;
    return chunk.light[voxelIndex(x & 15, y, z & 15)];
  }

  setBlockLight(x: number, y: number, z: number, level: number): void {
    if (y < 0 || y >= WORLD_Y) return;
    const cx = x >> 4;
    const cz = z >> 4;
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return;
    const index = voxelIndex(x & 15, y, z & 15);
    if (chunk.light[index] === level) return;
    chunk.light[index] = level;
    this.touchLit(x, y, z);
  }

  /**
   * Light changes are visible, so the affected geometry must be rebuilt.
   * Smooth lighting averages across voxels, so a change one block outside a
   * chunk still alters that chunk's vertices -- hence the seam checks.
   */
  private touchLit(x: number, y: number, z: number): void {
    const cx = x >> 4;
    const cz = z >> 4;
    this.chunks.get(chunkKey(cx, cz))?.markDirty(y);
    const lx = x & 15;
    const lz = z & 15;
    if (lx === 0) this.chunks.get(chunkKey(cx - 1, cz))?.markDirty(y);
    else if (lx === 15) this.chunks.get(chunkKey(cx + 1, cz))?.markDirty(y);
    if (lz === 0) this.chunks.get(chunkKey(cx, cz - 1))?.markDirty(y);
    else if (lz === 15) this.chunks.get(chunkKey(cx, cz + 1))?.markDirty(y);
  }
}
