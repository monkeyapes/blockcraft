/** Blockcraft server: static client host + authoritative multiplayer. */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';

import { Block } from '@shared/blocks.js';
import { Dimension, SEA_LEVEL, dimChunkKey } from '@shared/constants.js';
import { travelThroughPortal, useItemOnWorld } from '@shared/portal.js';
import { columnHeight, surfaceY } from '@shared/terrain.js';
import {
  DEFAULT_PORT, PROTOCOL_VERSION, TICK_HZ,
  type ClientMessage, type PlayerSnapshot, type ServerMessage,
} from '@shared/protocol.js';

import { ServerWorld, defaultSavePath } from './world.js';

const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
/** Works whether the server runs from the repo root, server/, or a bundle. */
function findClientDir(): string {
  if (process.env.BC_CLIENT_DIR) return resolve(process.env.BC_CLIENT_DIR);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), 'client', 'dist'),
    join(process.cwd(), '..', 'client', 'dist'),
    join(here, '..', '..', 'client', 'dist'),
    join(here, 'public'),
  ];
  return resolve(candidates.find((p) => existsSync(p)) ?? candidates[0]);
}

const CLIENT_DIR = findClientDir();
const REACH = 8; // generous: covers latency and creative-mode reach
const MAX_NAME = 16;
const SAVE_INTERVAL_MS = 30_000;
/** Stops a player bouncing straight back through the portal they arrived in. */
const PORTAL_COOLDOWN_MS = 3000;

const world = ServerWorld.load(defaultSavePath(), (Date.now() & 0xffff) || 1337);

interface Player {
  id: number;
  name: string;
  socket: WebSocket;
  dim: Dimension;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  subs: Set<string>;
  alive: boolean;
  moved: boolean;
  /** Timestamp of the last dimension change, to rate-limit travel. */
  lastTravel: number;
}

const players = new Map<number, Player>();
let nextId = 1;

function snapshot(p: Player): PlayerSnapshot {
  return {
    id: p.id, name: p.name, dim: p.dim,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
  };
}

function send(p: Player, msg: ServerMessage): void {
  if (p.socket.readyState === p.socket.OPEN) p.socket.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMessage, exceptId?: number): void {
  const raw = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id === exceptId) continue;
    if (p.socket.readyState === p.socket.OPEN) p.socket.send(raw);
  }
}

/** Only players who have that chunk loaded need the update. */
function broadcastToChunk(dim: Dimension, cx: number, cz: number, msg: ServerMessage): void {
  const key = dimChunkKey(dim, cx, cz);
  const raw = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.dim === dim && p.subs.has(key) && p.socket.readyState === p.socket.OPEN) {
      p.socket.send(raw);
    }
  }
}

// ------------------------------------------------------------------ http host

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: players.size, seed: world.seed }));
    return;
  }
  const urlPath = (req.url ?? '/').split('?')[0];
  let rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';

  let file = join(CLIENT_DIR, rel);
  if (!file.startsWith(CLIENT_DIR)) {
    res.writeHead(403).end('forbidden'); // path traversal
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    file = join(CLIENT_DIR, 'index.html'); // SPA fallback
    if (!existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Client not built yet. Run: npm run build --workspace @bc/client');
      return;
    }
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const http = createServer(serveStatic);
const wss = new WebSocketServer({ server: http });

// ------------------------------------------------------------------ sessions

/**
 * Spiral out from the origin until we find dry land, so nobody spawns at the
 * bottom of an ocean.
 */
function findSpawn(): { x: number; z: number } {
  for (let radius = 0; radius < 96; radius += 4) {
    for (let angle = 0; angle < 12; angle++) {
      const t = (angle / 12) * Math.PI * 2;
      const x = Math.round(Math.cos(t) * radius);
      const z = Math.round(Math.sin(t) * radius);
      const h = columnHeight(world.seed, x, z);
      if (h > SEA_LEVEL + 2 && h < 78) return { x, z };
      if (radius === 0) break; // the origin is a single point
    }
  }
  return { x: 0, z: 0 };
}

const SPAWN = findSpawn();
console.log(`[world] spawn at ${SPAWN.x}, ${SPAWN.z}`);

wss.on('connection', (socket) => {
  const id = nextId++;
  const spawnX = SPAWN.x;
  const spawnZ = SPAWN.z;
  const player: Player = {
    id,
    name: `Player${id}`,
    socket,
    dim: Dimension.Overworld,
    x: spawnX + 0.5,
    y: surfaceY(world.seed, Dimension.Overworld, spawnX, spawnZ) + 1,
    z: spawnZ + 0.5,
    yaw: -90,
    pitch: 0,
    subs: new Set(),
    alive: true,
    moved: false,
    lastTravel: 0,
  };

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return;
    }
    handle(player, msg);
  });

  socket.on('close', () => {
    if (!players.has(player.id)) return;
    players.delete(player.id);
    broadcast({ t: 'leave', id: player.id });
    console.log(`[net] ${player.name} left (${players.size} online)`);
  });

  socket.on('error', () => socket.terminate());
});

function handle(player: Player, msg: ClientMessage): void {
  switch (msg.t) {
    case 'hello': {
      if (players.has(player.id)) return; // already greeted
      const name = String(msg.name ?? '').trim().slice(0, MAX_NAME);
      if (name) player.name = name;
      players.set(player.id, player);

      send(player, {
        t: 'welcome',
        v: PROTOCOL_VERSION,
        id: player.id,
        seed: world.seed,
        name: player.name,
        dim: player.dim,
        spawn: { x: player.x, y: player.y, z: player.z },
        players: [...players.values()]
          .filter((p) => p.id !== player.id)
          .map(snapshot),
      });
      broadcast({ t: 'join', player: snapshot(player) }, player.id);
      console.log(`[net] ${player.name} joined (${players.size} online)`);
      return;
    }

    case 'sub': {
      const key = dimChunkKey(msg.dim, msg.cx, msg.cz);
      player.subs.add(key);
      send(player, {
        t: 'chunk',
        dim: msg.dim,
        cx: msg.cx,
        cz: msg.cz,
        edits: world.chunkEdits(msg.dim, msg.cx, msg.cz),
      });
      return;
    }

    case 'unsub':
      player.subs.delete(dimChunkKey(msg.dim, msg.cx, msg.cz));
      return;

    case 'set': {
      const { dim, x, y, z, b } = msg;
      const dx = x + 0.5 - player.x;
      const dy = y + 0.5 - (player.y + 1.62);
      const dz = z + 0.5 - player.z;
      const tooFar = dx * dx + dy * dy + dz * dz > REACH * REACH;

      if (dim !== player.dim || tooFar || !world.canPlace(dim, x, y, z, b)) {
        send(player, {
          t: 'reject', dim, x, y, z,
          b: world.getBlock(dim, x, y, z),
          reason: tooFar ? 'out of reach' : 'blocked',
        });
        return;
      }

      world.setBlock(dim, x, y, z, b);
      broadcastToChunk(dim, x >> 4, z >> 4, { t: 'set', dim, x, y, z, b, by: player.id });
      return;
    }

    case 'move': {
      if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y) || !Number.isFinite(msg.z)) return;
      player.dim = msg.dim;
      player.x = msg.x;
      player.y = msg.y;
      player.z = msg.z;
      player.yaw = msg.yaw;
      player.pitch = msg.pitch;
      player.moved = true;
      return;
    }

    case 'use': {
      if (msg.dim !== player.dim) return;
      if (!withinReach(player, msg.x, msg.y, msg.z)) return;

      const read = readerFor(msg.dim);
      const write = writerFor(msg.dim);
      if (useItemOnWorld(read, write, msg.item, msg.x, msg.y, msg.z)) {
        send(player, { t: 'consume', item: msg.item, count: 1 });
      }
      return;
    }

    case 'portal': {
      if (msg.dim !== player.dim) return;
      // Cheap guard against a client spamming travel requests.
      const now = Date.now();
      if (now - player.lastTravel < PORTAL_COOLDOWN_MS) return;

      const result = travelThroughPortal(
        readerFor(msg.dim), readerFor(otherSide(msg.dim, msg.x, msg.y, msg.z)),
        writerFor(otherSide(msg.dim, msg.x, msg.y, msg.z)),
        msg.dim, msg.x, msg.y, msg.z,
      );
      if (!result) return;

      player.lastTravel = now;
      player.dim = result.dim;
      player.x = result.x;
      player.y = result.y;
      player.z = result.z;
      player.subs.clear();

      send(player, { t: 'dim', dim: result.dim, x: result.x, y: result.y, z: result.z });
      // Everyone else should stop seeing them in the dimension they left.
      broadcast({ t: 'leave', id: player.id }, player.id);
      broadcast({ t: 'join', player: snapshot(player) }, player.id);
      console.log(`[net] ${player.name} entered ${Dimension[result.dim]}`);
      return;
    }

    case 'chat': {
      const text = String(msg.text ?? '').trim().slice(0, 256);
      if (!text) return;
      broadcast({ t: 'chat', id: player.id, name: player.name, text });
      return;
    }
  }
}

/** Which dimension a portal at these coordinates leads to. */
function otherSide(dim: Dimension, x: number, y: number, z: number): Dimension {
  const block = world.getBlock(dim, Math.floor(x), Math.floor(y), Math.floor(z));
  if (block === Block.EndPortal) {
    return dim === Dimension.End ? Dimension.Overworld : Dimension.End;
  }
  return dim === Dimension.Nether ? Dimension.Overworld : Dimension.Nether;
}

function readerFor(dim: Dimension) {
  return (x: number, y: number, z: number) => world.getBlock(dim, x, y, z);
}

/** Writes go straight out to anyone who has that chunk loaded. */
function writerFor(dim: Dimension) {
  return (x: number, y: number, z: number, block: number) => {
    world.setBlock(dim, x, y, z, block);
    broadcastToChunk(dim, x >> 4, z >> 4, { t: 'set', dim, x, y, z, b: block, by: 0 });
  };
}

function withinReach(player: Player, x: number, y: number, z: number): boolean {
  const dx = x + 0.5 - player.x;
  const dy = y + 0.5 - (player.y + 1.62);
  const dz = z + 0.5 - player.z;
  return dx * dx + dy * dy + dz * dz <= REACH * REACH;
}

// --------------------------------------------------------------------- ticks

setInterval(() => {
  if (players.size === 0) return;
  // Position relay, scoped to each dimension so the Nether doesn't leak into
  // the overworld's player list.
  const byDim = new Map<Dimension, PlayerSnapshot[]>();
  for (const p of players.values()) {
    if (!p.moved) continue;
    let list = byDim.get(p.dim);
    if (!list) byDim.set(p.dim, (list = []));
    list.push(snapshot(p));
    p.moved = false;
  }
  for (const [dim, list] of byDim) {
    if (list.length === 0) continue;
    const raw = JSON.stringify({ t: 'players', list } satisfies ServerMessage);
    for (const p of players.values()) {
      if (p.dim === dim && p.socket.readyState === p.socket.OPEN) p.socket.send(raw);
    }
  }
}, 1000 / TICK_HZ);

setInterval(() => world.save(), SAVE_INTERVAL_MS);

function shutdown(): void {
  console.log('\n[server] saving and shutting down');
  world.save();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

http.listen(PORT, () => {
  console.log(`[server] Blockcraft on http://localhost:${PORT}  (seed ${world.seed})`);
  console.log(`[server] serving client from ${CLIENT_DIR}`);
});
