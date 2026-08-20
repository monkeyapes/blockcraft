/**
 * Chat commands.
 *
 * Handled entirely on the client: they move or inspect the local player and
 * never edit the world, so there is nothing for the server to validate.
 */

import { CHUNK_X, CHUNK_Z, Dimension } from '@shared/constants.js';
import { findPlacement } from '@shared/structures.js';
import { columnHeight } from '@shared/terrain.js';
import { MobKind } from '@shared/mobs.js';
import type { MobWorld } from './mobs.js';
import type { Player } from './player.js';
import type { Survival } from './survival.js';

export interface CommandContext {
  player: Player;
  survival: Survival;
  seed: number;
  dimension: Dimension;
  mobs: MobWorld;
  say: (text: string, system?: boolean) => void;
}

const MOB_NAMES: Record<string, MobKind> = {
  pig: MobKind.Pig,
  cow: MobKind.Cow,
  sheep: MobKind.Sheep,
  chicken: MobKind.Chicken,
  zombie: MobKind.Zombie,
};

const HELP = [
  '/help - this list',
  '/tp <x> <y> <z> - teleport, or /tp <x> <z> to land on the surface',
  '/locate <village|mansion|stronghold> - find the nearest one',
  '/summon <pig|cow|sheep|chicken|zombie> [count] - spawn mobs in front of you',
  '/gamemode <survival|creative> - switch mode',
  '/seed - show the world seed',
  '/pos - show your position',
];

/** Searches outward in rings for the nearest structure of a kind. */
function locate(
  seed: number, kind: 'village' | 'mansion', fromX: number, fromZ: number,
): { x: number; z: number } | null {
  const startCx = Math.floor(fromX / CHUNK_X);
  const startCz = Math.floor(fromZ / CHUNK_Z);

  for (let ring = 0; ring <= 90; ring++) {
    for (let dz = -ring; dz <= ring; dz++) {
      for (let dx = -ring; dx <= ring; dx++) {
        // Only the perimeter of each ring is new.
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const place = findPlacement(seed, kind, startCx + dx, startCz + dz);
        if (place) return { x: place.x, z: place.z };
      }
    }
  }
  return null;
}

/** Strongholds use their own region scheme, mirrored from the generator. */
function locateStronghold(
  seed: number, fromX: number, fromZ: number,
): { x: number; z: number } | null {
  const REGION = 24;
  const startRx = Math.floor(Math.floor(fromX / CHUNK_X) / REGION);
  const startRz = Math.floor(Math.floor(fromZ / CHUNK_Z) / REGION);

  for (let ring = 0; ring <= 6; ring++) {
    for (let dz = -ring; dz <= ring; dz++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const rx = startRx + dx;
        const rz = startRz + dz;
        // Mirrors strongholdChunk() in terrain.ts.
        const a = hashLike(rx, rz, seed + 24001);
        const b = hashLike(rx + 917, rz - 571, seed + 24001);
        const cx = rx * REGION + Math.floor(a * REGION);
        const cz = rz * REGION + Math.floor(b * REGION);
        return { x: cx * CHUNK_X + 7, z: cz * CHUNK_Z + 7 };
      }
    }
  }
  return null;
}

/** Same hash as noise.hash2, kept local to avoid an import cycle in tests. */
function hashLike(x: number, y: number, seed: number): number {
  let n = (Math.imul(x, 1619) + Math.imul(y, 31337) + Math.imul(seed, 1013)) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

/**
 * Runs a chat command. Returns false when the text is not a command, in
 * which case it should be sent as ordinary chat.
 */
export function runCommand(text: string, ctx: CommandContext): boolean {
  if (!text.startsWith('/')) return false;

  const parts = text.slice(1).trim().split(/\s+/);
  const name = (parts[0] ?? '').toLowerCase();
  const args = parts.slice(1);
  const { player, survival, say } = ctx;

  switch (name) {
    case 'help':
      for (const line of HELP) say(line, true);
      return true;

    case 'pos':
      say(`You are at ${player.x.toFixed(1)}, ${player.y.toFixed(1)}, ${player.z.toFixed(1)}`, true);
      return true;

    case 'seed':
      say(`Seed: ${ctx.seed}`, true);
      return true;

    case 'gamemode': {
      const mode = (args[0] ?? '').toLowerCase();
      if (mode !== 'survival' && mode !== 'creative') {
        say('Usage: /gamemode <survival|creative>', true);
        return true;
      }
      survival.mode = mode;
      if (mode === 'survival') player.flying = false;
      else survival.reset();
      say(`Game mode set to ${mode}`, true);
      return true;
    }

    case 'tp': {
      const numbers = args.map(Number);
      if (numbers.length === 2 && numbers.every(Number.isFinite)) {
        const [x, z] = numbers;
        const y = columnHeight(ctx.seed, Math.floor(x), Math.floor(z)) + 2;
        player.x = x;
        player.y = y;
        player.z = z;
        player.vy = 0;
        say(`Teleported to ${x}, ${y}, ${z}`, true);
        return true;
      }
      if (numbers.length === 3 && numbers.every(Number.isFinite)) {
        player.x = numbers[0];
        player.y = numbers[1];
        player.z = numbers[2];
        player.vy = 0;
        say(`Teleported to ${numbers.join(', ')}`, true);
        return true;
      }
      say('Usage: /tp <x> <y> <z>  or  /tp <x> <z>', true);
      return true;
    }

    case 'summon': {
      const kindName = (args[0] ?? '').toLowerCase();
      const kind = MOB_NAMES[kindName];
      if (kind === undefined) {
        say(`Usage: /summon <${Object.keys(MOB_NAMES).join('|')}> [count]`, true);
        return true;
      }
      const count = Math.max(1, Math.min(20, Math.floor(Number(args[1] ?? 1)) || 1));
      // Drop them just in front of the player, spread over a small arc.
      const yaw = (player.yaw * Math.PI) / 180;
      for (let i = 0; i < count; i++) {
        const spread = (i - (count - 1) / 2) * 1.6;
        const x = player.x + Math.cos(yaw) * 4 - Math.sin(yaw) * spread;
        const z = player.z + Math.sin(yaw) * 4 + Math.cos(yaw) * spread;
        ctx.mobs.spawn(kind, x, player.y + 1, z);
      }
      say(`Summoned ${count} ${kindName}${count > 1 ? 's' : ''}`, true);
      return true;
    }

    case 'locate': {
      const kind = (args[0] ?? '').toLowerCase();
      if (ctx.dimension !== Dimension.Overworld) {
        say('Nothing to locate in this dimension.', true);
        return true;
      }

      let found: { x: number; z: number } | null = null;
      if (kind === 'village' || kind === 'mansion') {
        found = locate(ctx.seed, kind, player.x, player.z);
      } else if (kind === 'stronghold') {
        found = locateStronghold(ctx.seed, player.x, player.z);
      } else {
        say('Usage: /locate <village|mansion|stronghold>', true);
        return true;
      }

      if (!found) {
        say(`No ${kind} found nearby.`, true);
        return true;
      }
      const distance = Math.round(Math.hypot(found.x - player.x, found.z - player.z));
      say(`Nearest ${kind}: ${found.x}, ${found.z} (${distance} blocks away)`, true);
      say(`Use /tp ${found.x} ${found.z} to go there.`, true);
      return true;
    }

    default:
      say(`Unknown command "${name}". Try /help`, true);
      return true;
  }
}
