/** Wire protocol. JSON over WebSocket; every message carries a `t` tag. */

import type { Dimension } from './constants.js';

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 8787;
/** Player position broadcast rate. */
export const TICK_HZ = 20;

export interface PlayerSnapshot {
  id: number;
  name: string;
  dim: Dimension;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** A single edit inside a chunk: packed voxel index plus block id. */
export type PackedEdit = [index: number, block: number];

// ----------------------------------------------------------------- client -> server

export interface CHello {
  t: 'hello';
  v: number;
  name: string;
}
export interface CSub {
  t: 'sub';
  dim: Dimension;
  cx: number;
  cz: number;
}
export interface CUnsub {
  t: 'unsub';
  dim: Dimension;
  cx: number;
  cz: number;
}
export interface CSetBlock {
  t: 'set';
  dim: Dimension;
  x: number;
  y: number;
  z: number;
  b: number;
}
export interface CMove {
  t: 'move';
  dim: Dimension;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}
export interface CChat {
  t: 'chat';
  text: string;
}
/** "I am standing in a portal at these coordinates." */
export interface CPortal {
  t: 'portal';
  dim: Dimension;
  x: number;
  y: number;
  z: number;
}
/** Right-clicked a block with an item that acts on it (flint, eye of ender). */
export interface CUseItem {
  t: 'use';
  dim: Dimension;
  x: number;
  y: number;
  z: number;
  item: number;
}

/**
 * The player died. `by` names the killer when it was another player.
 *
 * Combat is simulated on the client, so the server has to be told. That does
 * mean trusting the client about who killed whom, which is worth being honest
 * about: on a server where money changes hands on a kill, a modified client
 * could claim kills it did not make. The cooldown and the cap bound how much
 * that is worth, and a server that cared more would have to move combat
 * server-side -- a much bigger change than this one.
 */
export interface CDeath {
  t: 'death';
  by?: number;
}

export type ClientMessage =
  | CHello | CSub | CUnsub | CSetBlock | CMove | CChat | CPortal | CUseItem
  | CDeath;

// ----------------------------------------------------------------- server -> client

export interface SWelcome {
  t: 'welcome';
  v: number;
  id: number;
  seed: number;
  name: string;
  dim: Dimension;
  spawn: { x: number; y: number; z: number };
  players: PlayerSnapshot[];
}
export interface SChunk {
  t: 'chunk';
  dim: Dimension;
  cx: number;
  cz: number;
  edits: PackedEdit[];
}
export interface SSetBlock {
  t: 'set';
  dim: Dimension;
  x: number;
  y: number;
  z: number;
  b: number;
  by: number;
}
export interface SPlayers {
  t: 'players';
  list: PlayerSnapshot[];
}
export interface SJoin {
  t: 'join';
  player: PlayerSnapshot;
}
export interface SLeave {
  t: 'leave';
  id: number;
}
export interface SChat {
  t: 'chat';
  id: number;
  name: string;
  text: string;
}
/** Server rejected an edit; the client must roll its optimistic change back. */
export interface SReject {
  t: 'reject';
  dim: Dimension;
  x: number;
  y: number;
  z: number;
  b: number;
  reason: string;
}

/** The player has changed dimension; the client must rebuild its world. */
export interface SDimension {
  t: 'dim';
  dim: Dimension;
  x: number;
  y: number;
  z: number;
}
/** An item was consumed by a world interaction (flint, eye of ender). */
export interface SConsume {
  t: 'consume';
  item: number;
  count: number;
}

/** The server put something in the player's inventory. */
export interface SGrant {
  t: 'grant';
  item: number;
  count: number;
}

export type ServerMessage =
  | SWelcome | SChunk | SSetBlock | SPlayers | SJoin | SLeave | SChat | SReject
  | SDimension | SConsume | SGrant;

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decode<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
