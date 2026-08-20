/**
 * Single-player: the server, in-process.
 *
 * Implements exactly the same protocol as the real server, so the whole
 * client stack (optimistic edits, rejects, chunk subscriptions) is exercised
 * offline too. Worlds persist to IndexedDB.
 */

import { Block, blockDef } from '@shared/blocks.js';
import {
  CHUNK_X, CHUNK_Z, Dimension, WORLD_Y, dimChunkKey, voxelIndex,
} from '@shared/constants.js';
import { portalDestination, travelThroughPortal, useItemOnWorld } from '@shared/portal.js';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@shared/protocol.js';
import { columnHeight, generateChunk } from '@shared/terrain.js';
import { WORLDS_STORE, dbGet, dbPut } from './db.js';
import type { Link } from './link.js';

const SAVE_DEBOUNCE_MS = 2000;
const PORTAL_COOLDOWN_MS = 3000;

interface SaveData {
  slot: string;
  seed: number;
  edits: Array<[string, Array<[number, number]>]>;
  player?: unknown;
}

async function loadSave(slot: string): Promise<SaveData | null> {
  // Undefined covers both "no save" and "storage unavailable"; either way the
  // caller starts a fresh world.
  return (await dbGet<SaveData>(WORLDS_STORE, slot)) ?? null;
}

async function writeSave(data: SaveData): Promise<void> {
  await dbPut(WORLDS_STORE, data);
}

export class LocalLink implements Link {
  readonly connected = true;

  private messageCb: (msg: ServerMessage) => void = () => {};
  private statusCb: (text: string) => void = () => {};
  private edits = new Map<string, Map<number, number>>();
  private chunkCache = new Map<string, Uint8Array>();
  private seed = 1337;
  private ready = false;
  private backlog: ClientMessage[] = [];
  private saveTimer = 0;
  private lastTravel = 0;
  private player = { x: 0, y: 80, z: 0, dim: Dimension.Overworld };
  private playerState: unknown = undefined;

  constructor(private slot = 'world1', seed?: number) {
    this.boot(seed).catch(() => this.statusCb('Could not open local storage.'));
  }

  private async boot(seed?: number): Promise<void> {
    const save = await loadSave(this.slot);
    if (save) {
      // An existing save always wins, seed argument or not: the seed is
      // recorded in the save, and honouring the argument here would silently
      // regenerate the world and throw away everything built in it.
      this.seed = save.seed;
      for (const [key, list] of save.edits) this.edits.set(key, new Map(list));
      this.playerState = save.player;
      this.statusCb(`Loaded local world (seed ${this.seed}).`);
    } else {
      this.seed = seed ?? (((Date.now() ^ (Math.random() * 0xffff)) & 0xffff) || 1337);
      this.statusCb(`New local world (seed ${this.seed}).`);
    }
    this.ready = true;

    const queued = this.backlog;
    this.backlog = [];
    for (const msg of queued) this.handle(msg);
  }

  // ------------------------------------------------------------------ world

  private chunk(dim: Dimension, cx: number, cz: number, key: string): Uint8Array {
    let data = this.chunkCache.get(key);
    if (!data) {
      data = generateChunk(this.seed, dim, cx, cz);
      if (this.chunkCache.size > 512) {
        const oldest = this.chunkCache.keys().next().value;
        if (oldest !== undefined) this.chunkCache.delete(oldest);
      }
      this.chunkCache.set(key, data);
    }
    return data;
  }

  private getBlock(dim: Dimension, x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_Y) return Block.Air;
    const cx = x >> 4;
    const cz = z >> 4;
    const key = dimChunkKey(dim, cx, cz);
    const idx = voxelIndex(x - cx * CHUNK_X, y, z - cz * CHUNK_Z);
    const edited = this.edits.get(key)?.get(idx);
    if (edited !== undefined) return edited;
    return this.chunk(dim, cx, cz, key)[idx];
  }

  private setBlock(dim: Dimension, x: number, y: number, z: number, block: number): void {
    const cx = x >> 4;
    const cz = z >> 4;
    const key = dimChunkKey(dim, cx, cz);
    const idx = voxelIndex(x - cx * CHUNK_X, y, z - cz * CHUNK_Z);

    let overrides = this.edits.get(key);
    if (!overrides) this.edits.set(key, (overrides = new Map()));

    // Restoring the natural block drops the edit, keeping saves small.
    if (this.chunk(dim, cx, cz, key)[idx] === block) overrides.delete(idx);
    else overrides.set(idx, block);

    this.scheduleSave();
  }

  private readerFor(dim: Dimension) {
    return (x: number, y: number, z: number) => this.getBlock(dim, x, y, z);
  }

  /** Portal edits must reach the renderer, so they are echoed back as sets. */
  private writerFor(dim: Dimension) {
    return (x: number, y: number, z: number, block: number) => {
      this.setBlock(dim, x, y, z, block);
      this.emit({ t: 'set', dim, x, y, z, b: block, by: 0 });
    };
  }

  private findSpawn(): { x: number; z: number } {
    for (let radius = 0; radius < 96; radius += 4) {
      for (let angle = 0; angle < 12; angle++) {
        const t = (angle / 12) * Math.PI * 2;
        const x = Math.round(Math.cos(t) * radius);
        const z = Math.round(Math.sin(t) * radius);
        const h = columnHeight(this.seed, x, z);
        if (h > 42 && h < 78) return { x, z };
        if (radius === 0) break;
      }
    }
    return { x: 0, z: 0 };
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), SAVE_DEBOUNCE_MS);
  }

  async save(): Promise<void> {
    const edits: Array<[string, Array<[number, number]>]> = [];
    for (const [key, chunk] of this.edits) {
      if (chunk.size > 0) edits.push([key, [...chunk.entries()]]);
    }
    await writeSave({ slot: this.slot, seed: this.seed, edits, player: this.playerState });
  }

  /** Lets the game stash player state (position, inventory) in the save. */
  setPlayerState(state: unknown): void {
    this.playerState = state;
    this.scheduleSave();
  }

  getPlayerState(): unknown {
    return this.playerState;
  }

  // --------------------------------------------------------------- protocol

  private emit(msg: ServerMessage): void {
    // Deliver asynchronously so callers never re-enter mid-send.
    queueMicrotask(() => this.messageCb(msg));
  }

  send(msg: ClientMessage): void {
    if (!this.ready) {
      this.backlog.push(msg);
      return;
    }
    this.handle(msg);
  }

  private handle(msg: ClientMessage): void {
    switch (msg.t) {
      case 'hello': {
        const spawn = this.findSpawn();
        const y = Math.max(columnHeight(this.seed, spawn.x, spawn.z), 40) + 2;
        this.player = { x: spawn.x + 0.5, y, z: spawn.z + 0.5, dim: Dimension.Overworld };
        this.emit({
          t: 'welcome',
          v: PROTOCOL_VERSION,
          id: 1,
          seed: this.seed,
          name: msg.name || 'Player',
          dim: Dimension.Overworld,
          spawn: { x: this.player.x, y: this.player.y, z: this.player.z },
          players: [],
        });
        return;
      }

      case 'sub': {
        const overrides = this.edits.get(dimChunkKey(msg.dim, msg.cx, msg.cz));
        this.emit({
          t: 'chunk',
          dim: msg.dim,
          cx: msg.cx,
          cz: msg.cz,
          edits: overrides ? ([...overrides.entries()] as Array<[number, number]>) : [],
        });
        return;
      }

      case 'unsub':
        return;

      case 'set': {
        const { dim, x, y, z, b } = msg;
        const current = this.getBlock(dim, x, y, z);
        const legal = b === Block.Air
          ? blockDef(current).breakable
          : current === Block.Air || blockDef(current).liquid;

        if (y < 1 || y >= WORLD_Y || !legal) {
          this.emit({ t: 'reject', dim, x, y, z, b: current, reason: 'blocked' });
          return;
        }
        this.setBlock(dim, x, y, z, b);
        // No echo: the client already applied this optimistically.
        return;
      }

      case 'move':
        this.player = { x: msg.x, y: msg.y, z: msg.z, dim: msg.dim };
        return;

      case 'use': {
        const read = this.readerFor(msg.dim);
        const write = this.writerFor(msg.dim);
        if (useItemOnWorld(read, write, msg.item, msg.x, msg.y, msg.z)) {
          this.emit({ t: 'consume', item: msg.item, count: 1 });
        }
        return;
      }

      case 'portal': {
        const now = Date.now();
        if (now - this.lastTravel < PORTAL_COOLDOWN_MS) return;

        const here = this.getBlock(msg.dim, Math.floor(msg.x), Math.floor(msg.y), Math.floor(msg.z));
        const to = portalDestination(msg.dim, here);
        if (to === null) return;

        const result = travelThroughPortal(
          this.readerFor(msg.dim), this.readerFor(to), this.writerFor(to),
          msg.dim, msg.x, msg.y, msg.z,
        );
        if (!result) return;

        this.lastTravel = now;
        this.player = { x: result.x, y: result.y, z: result.z, dim: result.dim };
        this.scheduleSave();
        this.emit({ t: 'dim', dim: result.dim, x: result.x, y: result.y, z: result.z });
        return;
      }

      case 'chat':
        this.emit({ t: 'chat', id: 1, name: 'You', text: msg.text });
        return;
    }
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.messageCb = cb;
  }

  onStatus(cb: (text: string) => void): void {
    this.statusCb = cb;
  }

  close(): void {
    clearTimeout(this.saveTimer);
    void this.save();
  }
}
