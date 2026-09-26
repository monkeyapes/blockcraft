/**
 * The gameplay hooks content packs plug into.
 *
 * The shared packs (shared/src/content/) say what blocks and items *are*.
 * This file is how they *behave*: what right-clicking a door does, what a
 * hoe does to dirt, how a crop grows, where an arrow flies. Each pack's
 * client module (client/src/content/<pack>.ts) registers handlers here when
 * it loads, and main.ts calls the dispatchers below at the right moments.
 * main.ts never needs to know which packs exist.
 *
 * Everything a handler can do to the game goes through GameContext, so a
 * handler is testable with a fake one and never reaches into main.ts.
 */

import type { Dimension } from '@shared/constants.js';
import type { SoundEngine } from '../audio.js';
import type { Atlas } from '../gfx/atlas.js';
import type { Mob, MobWorld } from '../mobs.js';
import type { Player } from '../player.js';
import type { ClientWorld } from '../world.js';

export interface GameContext {
  readonly world: ClientWorld;
  readonly dimension: Dimension;
  readonly player: Player;
  readonly mobs: MobWorld;
  readonly creative: boolean;
  /** Seconds since the session started. */
  readonly time: number;
  readonly sound: SoundEngine;

  getBlock(x: number, y: number, z: number): number;
  /**
   * Changes a block: applied at once and sent to the server, which accepts
   * it only if shared `canReplace` allows it. Returns false when the change
   * is refused locally for the same reason.
   */
  setBlock(x: number, y: number, z: number, id: number): boolean;
  /**
   * Breaks a block as mining would: its drops (unless `drops` is false),
   * its break hooks, particles and sound. For explosions and hammers.
   */
  breakBlock(x: number, y: number, z: number, opts?: { drops?: boolean }): void;

  /** The item in the selected hotbar slot. */
  heldItem(): number | null;
  /** Takes from the held stack. Always succeeds in creative without taking. */
  consumeHeld(count?: number): boolean;
  /** Swaps the held stack for something else: a bucket filling with water. */
  replaceHeld(id: number, count?: number): void;
  /** Into the inventory; whatever does not fit is dropped at the player's feet. */
  give(id: number, count: number): void;
  /** A physical item in the world, which the player can walk over to collect. */
  dropItem(x: number, y: number, z: number, id: number, count: number): void;

  damagePlayer(amount: number, cause: string): void;
  healPlayer(amount: number): void;
  /** Adds to the player's velocity: knockback, a blast. */
  pushPlayer(vx: number, vy: number, vz: number): void;
  /**
   * Hurts a mob and settles its death -- drops, the kill message -- the same
   * way a sword hit does. `fromX/fromZ` is where the blow came from, for
   * knockback.
   */
  hurtMob(mob: Mob, amount: number, fromX?: number, fromZ?: number): void;

  toast(text: string): void;
  chat(text: string): void;
  breakParticles(x: number, y: number, z: number, id: number): void;
  /** How many of an item the player carries, anywhere in the inventory. */
  countItem(id: number): number;
  /**
   * Takes items from anywhere in the inventory: a bow drawing arrows from the
   * bag, not just the hand. False, taking nothing, if there are not enough.
   * Always succeeds in creative without taking.
   */
  takeItem(id: number, count: number): boolean;
  /** Plays the held-item swing. */
  swing(): void;
  random(): number;
}

/** A right-click that struck a block. */
export interface UseContext extends GameContext {
  /** The block that was clicked, and its id. */
  x: number;
  y: number;
  z: number;
  id: number;
  /** Outward normal of the face that was clicked. */
  face: [number, number, number];
  /** Exact point clicked, in world space. */
  point: [number, number, number];
  held: number | null;
  sneaking: boolean;
}

/** A placement about to happen. */
export interface PlaceContext extends UseContext {
  /**
   * The cell the block is going into. A hook may move it -- stacking a slab
   * onto a slab puts the result into the clicked cell, not beside it.
   */
  px: number;
  py: number;
  pz: number;
  /** Set true to allow the target cell to be something other than air. */
  allowReplace: boolean;
}

export type BlockHandler = (ctx: GameContext, x: number, y: number, z: number, id: number) => void;

export interface GameSystem {
  name: string;
  /** Every frame while playing. */
  update?(ctx: GameContext, dt: number): void;
  /** World-space geometry to draw this frame, in the terrain vertex format. */
  mesh?(ctx: GameContext, atlas: Atlas): { vertices: Float32Array; indices: Uint32Array } | null;
  /** The dimension changed: drop anything that belonged to the old one. */
  reset?(): void;
}

/** A projectile request. Implemented by the combat pack. */
export interface ShotSpec {
  x: number; y: number; z: number;
  /** Direction; need not be normalised. */
  dx: number; dy: number; dz: number;
  speed: number;
  damage: number;
  /** Who fired it, so a skeleton's arrow does not hit the skeleton. */
  shooter: 'player' | Mob;
  kind: 'arrow' | 'snowball' | 'fireball';
}

// --- registries -----------------------------------------------------------

type UseFn = (ctx: UseContext) => boolean;
type PlaceFn = (ctx: PlaceContext) => number | null;

const blockUse = new Map<number, UseFn[]>();
const itemUse = new Map<number, UseFn[]>();
const itemUseAir = new Map<number, Array<(ctx: GameContext) => boolean>>();
const itemRelease = new Map<number, Array<(ctx: GameContext, heldSeconds: number) => void>>();
const placement = new Map<number, PlaceFn[]>();
const afterPlace = new Map<number, BlockHandler[]>();
const onBreak = new Map<number, BlockHandler[]>();
const breakWith = new Map<number, BlockHandler[]>();
const randomTick = new Map<number, BlockHandler[]>();
const neighbourChange = new Map<number, BlockHandler[]>();
const localNeighbourChange = new Map<number, BlockHandler[]>();
const mobUse: Array<(ctx: GameContext, mob: Mob) => boolean> = [];
const systems: GameSystem[] = [];

function add<T>(map: Map<number, T[]>, ids: number | number[], fn: T): void {
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    const list = map.get(id) ?? [];
    list.push(fn);
    map.set(id, list);
  }
}

/** Right-clicking one of these blocks. Return true if handled. Skipped while sneaking. */
export function registerBlockUse(blocks: number | number[], fn: UseFn): void {
  add(blockUse, blocks, fn);
}

/** Right-clicking a block while holding one of these items. Return true if handled. */
export function registerItemUse(items: number | number[], fn: UseFn): void {
  add(itemUse, items, fn);
}

/** Right-clicking while holding one of these, whatever is (or is not) targeted. */
export function registerItemUseAir(items: number | number[], fn: (ctx: GameContext) => boolean): void {
  add(itemUseAir, items, fn);
}

/** Letting go of right-click after using one of these: a bow loosing. */
export function registerItemRelease(
  items: number | number[], fn: (ctx: GameContext, heldSeconds: number) => void,
): void {
  add(itemRelease, items, fn);
}

/**
 * Deciding what placing one of these items puts down: a block id, or null
 * to refuse. Stairs choose their facing here, seeds refuse anything that is
 * not farmland.
 */
export function registerPlacement(items: number | number[], fn: PlaceFn): void {
  add(placement, items, fn);
}

/** Just after one of these blocks was placed by the player: a door adds its top half. */
export function registerAfterPlace(blocks: number | number[], fn: BlockHandler): void {
  add(afterPlace, blocks, fn);
}

/** Just after one of these blocks was broken: a door takes its other half with it. */
export function registerBreak(blocks: number | number[], fn: BlockHandler): void {
  add(onBreak, blocks, fn);
}

/** Just after the player broke any block while holding one of these: a hammer's wide swing. */
export function registerBreakWith(items: number | number[], fn: BlockHandler): void {
  add(breakWith, items, fn);
}

/**
 * Called now and then for blocks of these ids near the player -- a few
 * random cells per section per tick, the way crops grow and saplings sprout.
 * A given cell is visited every minute or so on average.
 */
export function registerRandomTick(blocks: number | number[], fn: BlockHandler): void {
  add(randomTick, blocks, fn);
}

/**
 * A block beside one of these changed: sand falls when its support goes.
 *
 * `localOnly` handlers hear only about changes this client made. Something
 * that answers a change with more changes -- water spreading, drying up --
 * must run on one client only, the one that caused it: the others receive
 * its edits from the server, and simulating them again as well would send
 * every edit twice.
 */
export function registerNeighbourChange(
  blocks: number | number[], fn: BlockHandler, opts: { localOnly?: boolean } = {},
): void {
  add(opts.localOnly ? localNeighbourChange : neighbourChange, blocks, fn);
}

/** Right-clicking a mob. Return true if handled: shearing a sheep, taming a wolf. */
export function registerMobUse(fn: (ctx: GameContext, mob: Mob) => boolean): void {
  mobUse.push(fn);
}

/** Something that runs every frame and may draw: arrows, falling sand, explosions. */
export function registerSystem(system: GameSystem): void {
  systems.push(system);
}

/**
 * Cross-pack services. The combat pack provides the real explosion and
 * projectile implementations; anything else -- a creeping mob, a skeleton --
 * calls them through here without importing the combat pack.
 */
export const services = {
  explode(_ctx: GameContext, _x: number, _y: number, _z: number, _power: number): void {},
  shoot(_ctx: GameContext, _shot: ShotSpec): void {},
};

// --- the live context -------------------------------------------------------

let current: GameContext | null = null;

/** main.ts sets this once a world is running. */
export function setGameContext(ctx: GameContext | null): void {
  current = ctx;
}

/** The running game, for code (like mob AI) that is not handed a context. */
export function game(): GameContext | null {
  return current;
}

// --- dispatch, called by main.ts ------------------------------------------

function first<T>(list: T[] | undefined, run: (fn: T) => boolean): boolean {
  if (!list) return false;
  for (const fn of list) if (run(fn)) return true;
  return false;
}

/**
 * A right-click on a block. Block handlers first (a door opens whatever you
 * hold), then the held item's (a hoe tills). Sneaking skips the block's own
 * handlers, so you can still build against a door or a bench.
 */
export function dispatchUse(ctx: UseContext): boolean {
  if (!ctx.sneaking && first(blockUse.get(ctx.id), (fn) => fn(ctx))) return true;
  if (ctx.held !== null && first(itemUse.get(ctx.held), (fn) => fn(ctx))) return true;
  return false;
}

export function dispatchUseAir(ctx: GameContext, held: number | null): boolean {
  if (held === null) return false;
  return first(itemUseAir.get(held), (fn) => fn(ctx));
}

export function hasRelease(held: number | null): boolean {
  return held !== null && itemRelease.has(held);
}

export function dispatchRelease(ctx: GameContext, held: number, seconds: number): void {
  for (const fn of itemRelease.get(held) ?? []) fn(ctx, seconds);
}

export function dispatchMobUse(ctx: GameContext, mob: Mob): boolean {
  return first(mobUse, (fn) => fn(ctx, mob));
}

/**
 * The block a held item places, after its hooks have had their say.
 * `undefined` means no hook claimed it and the default rule applies.
 */
export function dispatchPlacement(ctx: PlaceContext, item: number): number | null | undefined {
  const hooks = placement.get(item);
  if (!hooks) return undefined;
  for (const fn of hooks) {
    const result = fn(ctx);
    if (result !== null) return result;
  }
  return null;
}

export function dispatchAfterPlace(ctx: GameContext, x: number, y: number, z: number, id: number): void {
  for (const fn of afterPlace.get(id) ?? []) fn(ctx, x, y, z, id);
}

export function dispatchBreak(
  ctx: GameContext, x: number, y: number, z: number, id: number, held: number | null,
): void {
  for (const fn of onBreak.get(id) ?? []) fn(ctx, x, y, z, id);
  if (held !== null) for (const fn of breakWith.get(held) ?? []) fn(ctx, x, y, z, id);
}

/** True for ids with a random-tick handler; checked per sampled cell. */
const ticks = new Uint8Array(256);
let ticksBuilt = false;

function buildTickTable(): void {
  ticks.fill(0);
  for (const id of randomTick.keys()) if (id >= 0 && id < 256) ticks[id] = 1;
  ticksBuilt = true;
}

/** Random cells sampled per 16-cube section each tick. */
export const RANDOM_TICKS_PER_SECTION = 3;
/** Ticks per second. */
export const TICK_RATE = 20;
/** Chunk radius around the player that receives random ticks. */
export const TICK_RADIUS = 4;

/**
 * One random tick: a few cells in every section near the player. Handlers
 * are looked up by id through a flat table, so sampling air -- almost every
 * sample -- costs one array read.
 */
export function randomTickAround(ctx: GameContext, px: number, pz: number): void {
  if (!ticksBuilt) buildTickTable();
  if (randomTick.size === 0) return;
  const pcx = Math.floor(px) >> 4;
  const pcz = Math.floor(pz) >> 4;
  const world = ctx.world;
  for (let cz = pcz - TICK_RADIUS; cz <= pcz + TICK_RADIUS; cz++) {
    for (let cx = pcx - TICK_RADIUS; cx <= pcx + TICK_RADIUS; cx++) {
      if (!world.chunk(cx, cz)) continue;
      for (let section = 0; section < 8; section++) {
        for (let n = 0; n < RANDOM_TICKS_PER_SECTION; n++) {
          const r = (ctx.random() * 4096) | 0;
          const x = cx * 16 + (r & 15);
          const z = cz * 16 + ((r >> 4) & 15);
          const y = section * 16 + (r >> 8);
          const id = world.getBlock(x, y, z);
          if (!ticks[id]) continue;
          for (const fn of randomTick.get(id)!) fn(ctx, x, y, z, id);
        }
      }
    }
  }
}

/** Cells whose neighbours changed, waiting to be told, and whether any change was ours. */
const pending: Array<[number, number, number]> = [];
const pendingKeys = new Map<string, { local: boolean }>();

/**
 * Records that a block changed, so the blocks around it hear about it next
 * frame. Deferred rather than immediate: a falling block that lands and
 * wakes the one above it would otherwise recurse through a whole tower in a
 * single call.
 *
 * `remote` marks a change that arrived from the server -- another player's
 * edit, or a rollback -- which only the ordinary handlers hear about. See
 * registerNeighbourChange.
 */
export function noteBlockChanged(x: number, y: number, z: number, remote = false): void {
  if (neighbourChange.size === 0 && localNeighbourChange.size === 0) return;
  for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const key = `${x + dx},${y + dy},${z + dz}`;
    const queued = pendingKeys.get(key);
    if (queued) {
      if (!remote) queued.local = true;
      continue;
    }
    pendingKeys.set(key, { local: !remote });
    pending.push([x + dx, y + dy, z + dz]);
  }
}

/** Delivers queued neighbour changes, a bounded number per frame. */
export function flushNeighbourChanges(ctx: GameContext, budget = 256): void {
  let n = 0;
  while (pending.length > 0 && n < budget) {
    const [x, y, z] = pending.shift()!;
    const key = `${x},${y},${z}`;
    const local = pendingKeys.get(key)?.local ?? false;
    pendingKeys.delete(key);
    const id = ctx.getBlock(x, y, z);
    const handlers = neighbourChange.get(id);
    if (handlers) for (const fn of handlers) fn(ctx, x, y, z, id);
    const own = local ? localNeighbourChange.get(id) : undefined;
    if (own) for (const fn of own) fn(ctx, x, y, z, id);
    n++;
  }
}

export function updateSystems(ctx: GameContext, dt: number): void {
  for (const s of systems) s.update?.(ctx, dt);
}

export function systemMeshes(
  ctx: GameContext, atlas: Atlas,
): Array<{ vertices: Float32Array; indices: Uint32Array }> {
  const out: Array<{ vertices: Float32Array; indices: Uint32Array }> = [];
  for (const s of systems) {
    const mesh = s.mesh?.(ctx, atlas);
    if (mesh && mesh.indices.length > 0) out.push(mesh);
  }
  return out;
}

export function resetSystems(): void {
  for (const s of systems) s.reset?.();
  pending.length = 0;
  pendingKeys.clear();
}

/** For tests: what is registered. */
export function registeredCounts(): Record<string, number> {
  return {
    blockUse: blockUse.size, itemUse: itemUse.size, itemUseAir: itemUseAir.size,
    itemRelease: itemRelease.size, placement: placement.size, afterPlace: afterPlace.size,
    onBreak: onBreak.size, breakWith: breakWith.size, randomTick: randomTick.size,
    neighbourChange: neighbourChange.size + localNeighbourChange.size, mobUse: mobUse.length, systems: systems.length,
  };
}
