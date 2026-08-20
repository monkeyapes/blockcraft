/** Protocol session: dispatch, remote-player tracking, interpolation. */

import type { Dimension } from '@shared/constants.js';
import {
  PROTOCOL_VERSION, type ClientMessage, type PlayerSnapshot, type ServerMessage,
} from '@shared/protocol.js';
import type { Link } from './link.js';

export type NetHandlers = {
  [K in ServerMessage['t']]?: (msg: Extract<ServerMessage, { t: K }>) => void;
};

export interface RemotePlayer extends PlayerSnapshot {
  /** Where we draw them: lerped toward the last snapshot. */
  rx: number;
  ry: number;
  rz: number;
  ryaw: number;
  /** Walk-cycle phase for the model animation. */
  phase: number;
}

export class Connection {
  readonly players = new Map<number, RemotePlayer>();
  selfId = 0;

  onStatus: (text: string) => void = () => {};

  constructor(private link: Link, readonly name: string, private handlers: NetHandlers) {
    link.onMessage((msg) => this.dispatch(msg));
    link.onStatus((text) => this.onStatus(text));
  }

  get connected(): boolean {
    return this.link.connected;
  }

  start(): void {
    this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name });
  }

  close(): void {
    this.link.close();
  }

  private dispatch(msg: ServerMessage): void {
    // Remote-player bookkeeping lives here so the game loop just reads
    // `players`; everything else goes to the registered handlers.
    switch (msg.t) {
      case 'welcome':
        this.selfId = msg.id;
        for (const p of msg.players) this.upsert(p);
        break;
      case 'join':
        this.upsert(msg.player);
        break;
      case 'leave':
        this.players.delete(msg.id);
        break;
      case 'players':
        for (const p of msg.list) this.upsert(p);
        break;
    }
    const handler = this.handlers[msg.t] as ((m: ServerMessage) => void) | undefined;
    handler?.(msg);
  }

  private upsert(p: PlayerSnapshot): void {
    if (p.id === this.selfId) return;
    const existing = this.players.get(p.id);
    if (existing) Object.assign(existing, p);
    else this.players.set(p.id, { ...p, rx: p.x, ry: p.y, rz: p.z, ryaw: p.yaw, phase: 0 });
  }

  /** Smooth remote players toward their last known position. */
  interpolate(dt: number): void {
    const k = Math.min(1, dt * 12);
    for (const p of this.players.values()) {
      p.rx += (p.x - p.rx) * k;
      p.ry += (p.y - p.ry) * k;
      p.rz += (p.z - p.rz) * k;
      let d = p.yaw - p.ryaw;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      p.ryaw += d * k;
    }
  }

  send(msg: ClientMessage): void {
    this.link.send(msg);
  }

  subscribe(dim: Dimension, cx: number, cz: number): void {
    this.send({ t: 'sub', dim, cx, cz });
  }

  unsubscribe(dim: Dimension, cx: number, cz: number): void {
    this.send({ t: 'unsub', dim, cx, cz });
  }
}

/** Works for `npm run dev` (Vite proxy) and for the packaged build alike. */
export function defaultServerUrl(override?: string): string {
  const raw = (override ?? '').trim();
  if (raw) {
    if (raw.startsWith('ws://') || raw.startsWith('wss://')) return raw;
    return `ws://${raw.replace(/^https?:\/\//, '')}`;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (location.port === '5173') return `${proto}//${location.hostname}:5173/ws`;
  return `${proto}//${location.host}/ws`;
}
