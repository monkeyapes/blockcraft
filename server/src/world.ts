/**
 * Authoritative world state.
 *
 * Base terrain is never stored or transmitted: it is a pure function of the
 * seed, so clients regenerate it locally. Only player edits live here.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Block, blockDef } from '@shared/blocks.js';
import {
  CHUNK_X, CHUNK_Z, Dimension, WORLD_Y, dimChunkKey, voxelIndex,
} from '@shared/constants.js';
import { generateChunk } from '@shared/terrain.js';
import type { PackedEdit } from '@shared/protocol.js';

const MAX_CACHED_CHUNKS = 768;

interface SaveFile {
  version: number;
  seed: number;
  edits: Record<string, Array<[number, number]>>;
}

export class ServerWorld {
  readonly seed: number;
  /** dim:cx,cz -> packed voxel index -> block id */
  private edits = new Map<string, Map<number, number>>();
  private chunkCache = new Map<string, Uint8Array>();
  private dirty = false;

  constructor(seed: number, private readonly savePath: string) {
    this.seed = seed;
  }

  static load(savePath: string, fallbackSeed: number): ServerWorld {
    if (existsSync(savePath)) {
      try {
        const data = JSON.parse(readFileSync(savePath, 'utf8')) as SaveFile;
        const world = new ServerWorld(data.seed, savePath);
        for (const [key, list] of Object.entries(data.edits ?? {})) {
          world.edits.set(key, new Map(list));
        }
        console.log(
          `[world] loaded seed ${data.seed}, ${world.editCount} edits from ${savePath}`,
        );
        return world;
      } catch (err) {
        console.warn('[world] save file unreadable, starting fresh:', err);
      }
    }
    return new ServerWorld(fallbackSeed, savePath);
  }

  get editCount(): number {
    let n = 0;
    for (const chunk of this.edits.values()) n += chunk.size;
    return n;
  }

  // ------------------------------------------------------------------ blocks

  /** Base terrain plus edits. Generates and caches the chunk on demand. */
  getBlock(dim: Dimension, x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_Y) return Block.Air;
    const cx = x >> 4;
    const cz = z >> 4;
    const idx = voxelIndex(x - cx * CHUNK_X, y, z - cz * CHUNK_Z);
    const key = dimChunkKey(dim, cx, cz);

    const overrides = this.edits.get(key);
    const edited = overrides?.get(idx);
    if (edited !== undefined) return edited;

    return this.chunk(dim, cx, cz, key)[idx];
  }

  setBlock(dim: Dimension, x: number, y: number, z: number, block: number): boolean {
    if (y < 0 || y >= WORLD_Y) return false;
    const cx = x >> 4;
    const cz = z >> 4;
    const key = dimChunkKey(dim, cx, cz);
    const idx = voxelIndex(x - cx * CHUNK_X, y, z - cz * CHUNK_Z);

    let overrides = this.edits.get(key);
    if (!overrides) {
      overrides = new Map();
      this.edits.set(key, overrides);
    }

    // An edit that restores the natural block is dropped, keeping saves small.
    const natural = this.chunk(dim, cx, cz, key)[idx];
    if (natural === block) overrides.delete(idx);
    else overrides.set(idx, block);

    this.dirty = true;
    return true;
  }

  chunkEdits(dim: Dimension, cx: number, cz: number): PackedEdit[] {
    const overrides = this.edits.get(dimChunkKey(dim, cx, cz));
    if (!overrides || overrides.size === 0) return [];
    return [...overrides.entries()] as PackedEdit[];
  }

  private chunk(dim: Dimension, cx: number, cz: number, key: string): Uint8Array {
    let data = this.chunkCache.get(key);
    if (!data) {
      data = generateChunk(this.seed, dim, cx, cz);
      if (this.chunkCache.size >= MAX_CACHED_CHUNKS) {
        // Cheap eviction: drop the oldest insertion.
        const oldest = this.chunkCache.keys().next().value;
        if (oldest !== undefined) this.chunkCache.delete(oldest);
      }
      this.chunkCache.set(key, data);
    }
    return data;
  }

  // ------------------------------------------------------------- validation

  /** Is this a legal block for a player to place? */
  canPlace(dim: Dimension, x: number, y: number, z: number, block: number): boolean {
    if (y < 1 || y >= WORLD_Y) return false;
    const def = blockDef(block);
    if (block !== Block.Air && def.id === Block.Air) return false; // unknown id
    const current = this.getBlock(dim, x, y, z);
    if (block === Block.Air) return blockDef(current).breakable;
    return current === Block.Air || blockDef(current).liquid;
  }

  // ------------------------------------------------------------------- save

  save(): void {
    if (!this.dirty) return;
    const out: SaveFile = { version: 1, seed: this.seed, edits: {} };
    for (const [key, chunk] of this.edits) {
      if (chunk.size === 0) continue;
      out.edits[key] = [...chunk.entries()];
    }
    mkdirSync(dirname(this.savePath), { recursive: true });
    const tmp = `${this.savePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(out));
    renameSync(tmp, this.savePath); // atomic: never leave a half-written save
    this.dirty = false;
  }
}

export function defaultSavePath(): string {
  const base = process.env.BC_DATA_DIR ?? join(process.cwd(), 'data');
  return join(base, 'world.json');
}
