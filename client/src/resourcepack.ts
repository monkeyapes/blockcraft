/**
 * Resource pack loading.
 *
 * Reads a Minecraft-style resource pack `.zip` that the player supplies and
 * overrides matching atlas tiles with it. Packs are never bundled with the
 * game -- they stay the player's own files, loaded at runtime, which keeps
 * whoever made the pack in control of their work.
 *
 * The zip is parsed here rather than with a library: the central directory
 * is simple, and `DecompressionStream` handles the deflate.
 */

import { PACKS_STORE, dbDelete, dbGet, dbPut } from './db.js';

const SIG_END_OF_CENTRAL_DIR = 0x06054b50;
const SIG_CENTRAL_FILE = 0x02014b50;

interface ZipEntry {
  name: string;
  offset: number;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
}

/** Reads the central directory. Far cheaper than inflating everything. */
function readDirectory(view: DataView): ZipEntry[] {
  // The end record is at the tail, after an optional comment.
  let end = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === SIG_END_OF_CENTRAL_DIR) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip file (no end-of-directory record).');

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL_FILE) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      new Uint8Array(view.buffer, view.byteOffset + offset + 46, nameLength));

    entries.push({ name, offset: localOffset, compressedSize, uncompressedSize, method });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buffer);
  // The local header repeats the name and extra lengths, which may differ.
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const raw = new Uint8Array(buffer, start, entry.compressedSize);

  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`Unsupported compression (${entry.method})`);

  const stream = new Blob([raw]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Maps Minecraft texture names onto this game's atlas tiles.
 *
 * Only names we actually have a tile for are listed; anything else in a pack
 * is ignored and the procedural texture stays.
 */
const BLOCK_MAP: Record<string, string> = {
  grass_block_top: 'grass_top',
  grass_block_side: 'grass_side',
  dirt: 'dirt',
  stone: 'stone',
  cobblestone: 'cobble',
  sand: 'sand',
  gravel: 'gravel',
  bedrock: 'bedrock',
  oak_log: 'log_side',
  oak_log_top: 'log_top',
  oak_leaves: 'leaves',
  oak_planks: 'planks',
  bricks: 'brick',
  glass: 'glass',
  water_still: 'water',
  lava_still: 'lava',
  glowstone: 'glowstone',
  coal_ore: 'coal_ore',
  iron_ore: 'iron_ore',
  gold_ore: 'gold_ore',
  diamond_ore: 'diamond_ore',
  iron_block: 'iron_block',
  crafting_table_top: 'crafting_top',
  crafting_table_front: 'crafting_side',
  furnace_top: 'furnace_top',
  furnace_front: 'furnace_front',
  netherrack: 'netherrack',
  soul_sand: 'soul_sand',
  obsidian: 'obsidian',
  nether_bricks: 'nether_brick',
  quartz_block_side: 'quartz',
  end_stone: 'end_stone',
  end_portal_frame_top: 'end_frame_top',
  end_portal_frame_side: 'end_frame_side',
  purpur_block: 'purpur',
  nether_portal: 'portal',
  torch: 'torch',
  torch_on: 'torch',

  // Pre-1.13 packs use entirely different file names, and a `blocks/`
  // directory rather than `block/`. Both are still widely distributed.
  grass_top: 'grass_top',
  grass_side: 'grass_side',
  log_oak: 'log_side',
  log_oak_top: 'log_top',
  leaves_oak: 'leaves',
  planks_oak: 'planks',
  brick: 'brick',
  water_flow: 'water',
  lava_flow: 'lava',
  coal_block: 'coal_ore',
  quartz_block_top: 'quartz',
  crafting_table_side: 'crafting_side',
  furnace_side: 'furnace_top',
  end_stone_bricks: 'end_stone',
  soulsand: 'soul_sand',
  hardened_clay: 'brick',
  netherbrick: 'nether_brick',
  portal: 'portal',
};

const ITEM_MAP: Record<string, string> = {
  stick: 'stick',
  coal: 'coal',
  iron_ingot: 'iron_ingot',
  gold_ingot: 'gold_ingot',
  diamond: 'diamond',
  leather: 'leather',
  feather: 'feather',
  flint_and_steel: 'flint_steel',
  blaze_rod: 'blaze_rod',
  blaze_powder: 'blaze_powder',
  ender_pearl: 'ender_pearl',
  ender_eye: 'eye_of_ender',

  porkchop: 'raw_porkchop',
  cooked_porkchop: 'cooked_porkchop',
  beef: 'raw_beef',
  cooked_beef: 'steak',
  mutton: 'raw_mutton',
  cooked_mutton: 'cooked_mutton',
  chicken: 'raw_chicken',
  cooked_chicken: 'cooked_chicken',

  wooden_pickaxe: 'pickaxe_wood',
  stone_pickaxe: 'pickaxe_stone',
  iron_pickaxe: 'pickaxe_iron',
  diamond_pickaxe: 'pickaxe_diamond',
  wooden_axe: 'axe_wood',
  stone_axe: 'axe_stone',
  iron_axe: 'axe_iron',
  diamond_axe: 'axe_diamond',
  wooden_shovel: 'shovel_wood',
  stone_shovel: 'shovel_stone',
  iron_shovel: 'shovel_iron',
  diamond_shovel: 'shovel_diamond',
  wooden_sword: 'sword_wood',
  stone_sword: 'sword_stone',
  iron_sword: 'sword_iron',
  diamond_sword: 'sword_diamond',

  leather_helmet: 'armor_head_leather',
  leather_chestplate: 'armor_chest_leather',
  leather_leggings: 'armor_legs_leather',
  leather_boots: 'armor_feet_leather',
  iron_helmet: 'armor_head_iron',
  iron_chestplate: 'armor_chest_iron',
  iron_leggings: 'armor_legs_iron',
  iron_boots: 'armor_feet_iron',
  diamond_helmet: 'armor_head_diamond',
  diamond_chestplate: 'armor_chest_diamond',
  diamond_leggings: 'armor_legs_diamond',
  diamond_boots: 'armor_feet_diamond',

  // Pre-1.13 packs name the same items differently.
  eye_of_ender: 'eye_of_ender',
  porkchop_raw: 'raw_porkchop',
  porkchop_cooked: 'cooked_porkchop',
  beef_raw: 'raw_beef',
  beef_cooked: 'steak',
  mutton_raw: 'raw_mutton',
  mutton_cooked: 'cooked_mutton',
  chicken_raw: 'raw_chicken',
  chicken_cooked: 'cooked_chicken',
};

export interface MappedEntry {
  /** Atlas tile this file should replace. */
  tile: string;
  /** Path inside the zip. */
  path: string;
  /** Raw PNG bytes. */
  bytes: Uint8Array;
}

/**
 * Reads a pack and returns the PNG bytes for each tile it can supply.
 *
 * Split out from `loadResourcePack` so the zip handling and the name mapping
 * can be tested without a browser's image decoding.
 */
export async function mapPackEntries(buffer: ArrayBuffer): Promise<MappedEntry[]> {
  const entries = readDirectory(new DataView(buffer));
  const out: MappedEntry[] = [];
  const taken = new Set<string>();

  // Shortest paths first, so a pack's plain `assets/...` copy beats the
  // per-version overlay copies of the same texture. `blocks/` and `items/`
  // are the pre-1.13 directory names, still common in older packs.
  const candidates = entries
    .filter((e) => /\.png$/i.test(e.name) && /textures\/(blocks?|items?)\//i.test(e.name))
    .filter((e) => !/eatinganimation|food_particles|plated_food/i.test(e.name))
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length);

  for (const entry of candidates) {
    const isBlock = /textures\/blocks?\//i.test(entry.name);
    const tile = (isBlock ? BLOCK_MAP : ITEM_MAP)[baseName(entry.name)];
    if (!tile || taken.has(tile)) continue;
    taken.add(tile);
    try {
      out.push({ tile, path: entry.name, bytes: await readEntry(buffer, entry) });
    } catch {
      taken.delete(tile); // let a later copy try
    }
  }
  return out;
}

export interface PackTextures {
  /** Atlas tile name to the image to draw there. */
  tiles: Map<string, ImageBitmap>;
  name: string;
  /** Tiles matched, and files inspected. */
  matched: number;
  scanned: number;
}

/** Strips directories, the extension, and a pack's `_3d` style suffixes. */
function baseName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return file.replace(/\.png$/i, '').replace(/_3d$/i, '');
}

/**
 * Reads a pack and returns the tiles it can supply.
 *
 * Packs often ship several copies of the same texture for different game
 * versions in overlay directories. The plain `assets/...` copy wins, and
 * anything under an overlay is only used if nothing else provided that tile.
 */
export async function loadResourcePack(file: File | Blob, name = 'pack'): Promise<PackTextures> {
  const buffer = await file.arrayBuffer();
  const mapped = await mapPackEntries(buffer);
  const tiles = new Map<string, ImageBitmap>();

  for (const entry of mapped) {
    try {
      // Copy into a plain ArrayBuffer: Blob rejects a possibly-shared view.
      const png = new Uint8Array(entry.bytes.length);
      png.set(entry.bytes);
      const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
      // Animated textures are a vertical strip; take the first frame only.
      const size = Math.min(bitmap.width, bitmap.height);
      const frame = bitmap.height > bitmap.width
        ? await createImageBitmap(bitmap, 0, 0, size, size)
        : bitmap;
      tiles.set(entry.tile, frame);
    } catch {
      // A single unreadable texture should not fail the whole pack.
    }
  }

  return { tiles, name, matched: tiles.size, scanned: mapped.length };
}

/** Keeps the chosen pack so it survives a reload. */
export async function storePack(file: Blob, name: string): Promise<void> {
  await dbPut(PACKS_STORE, { id: 'active', blob: file, name });
}

export async function loadStoredPack(): Promise<{ blob: Blob; name: string } | null> {
  const value = await dbGet<{ blob: Blob; name: string }>(PACKS_STORE, 'active');
  return value ? { blob: value.blob, name: value.name } : null;
}

export async function clearStoredPack(): Promise<void> {
  await dbDelete(PACKS_STORE, 'active');
}