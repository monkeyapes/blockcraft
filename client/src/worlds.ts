/**
 * Saved worlds ("installations").
 *
 * Each entry maps to a LocalLink storage slot; the metadata lives in
 * localStorage so the launcher can list worlds without opening IndexedDB.
 */

import { WORLDS_STORE, dbDelete } from './db.js';
import type { GameMode } from './survival.js';

export interface WorldEntry {
  /** Storage slot, also the IndexedDB key. */
  slot: string;
  name: string;
  /** Blank means "pick one for me". */
  seed: number | null;
  mode: GameMode;
  created: number;
  lastPlayed: number;
}

const KEY = 'bc.worlds';

function read(): WorldEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as WorldEntry[];
    return Array.isArray(list) ? list.filter((w) => w && typeof w.slot === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: WorldEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage may be unavailable */
  }
}

/** Most recently played first. */
export function listWorlds(): WorldEntry[] {
  return read().sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export function createWorld(name: string, seed: number | null, mode: GameMode): WorldEntry {
  const list = read();
  const entry: WorldEntry = {
    slot: `world-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: name.trim() || 'New World',
    seed,
    mode,
    created: Date.now(),
    lastPlayed: Date.now(),
  };
  list.push(entry);
  write(list);
  return entry;
}

export function touchWorld(slot: string): void {
  const list = read();
  const entry = list.find((w) => w.slot === slot);
  if (!entry) return;
  entry.lastPlayed = Date.now();
  write(list);
}

/** Forgets the world and drops its saved chunks. */
export async function deleteWorld(slot: string): Promise<void> {
  write(read().filter((w) => w.slot !== slot));
  await dbDelete(WORLDS_STORE, slot);
}

export function describeWorld(entry: WorldEntry): string {
  const when = new Date(entry.lastPlayed);
  const today = new Date();
  const sameDay = when.toDateString() === today.toDateString();
  const stamp = sameDay
    ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : when.toLocaleDateString();
  const mode = entry.mode === 'creative' ? 'Creative' : 'Survival';
  return `${mode} · ${entry.seed === null ? 'random seed' : `seed ${entry.seed}`} · ${stamp}`;
}
