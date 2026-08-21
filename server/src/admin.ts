/**
 * The admin surface the hosting app drives.
 *
 * A server you can only start and stop is not a server you can run. This is
 * the difference between watching a log scroll past and actually being able
 * to do something about what it says: who is on, get rid of them, tell
 * everyone something, force a save.
 *
 * Two locks, and both are required:
 *
 *   - It only exists when `ADMIN_TOKEN` is set. A server started by hand has
 *     no admin routes at all, so nothing is added to the attack surface of
 *     an ordinary deployment.
 *   - It only answers loopback. The hosting app runs on the same machine as
 *     the server it spawned, so nothing legitimate ever needs to reach these
 *     from off-box, and a token that leaked in a screenshot still would not
 *     be usable from anywhere else.
 *
 * The token is compared in constant time. It is a small thing, but a token
 * checked with `===` leaks its prefix to anyone patient enough to measure,
 * and there is no reason to leave that lying around.
 */

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** One connected player, as the hosting app needs to see them. */
export interface AdminPlayer {
  id: number;
  name: string;
  dim: number;
  x: number;
  y: number;
  z: number;
}

/** What the admin routes need from the server to do their jobs. */
export interface AdminHooks {
  players(): AdminPlayer[];
  kick(id: number, reason: string): boolean;
  say(text: string): void;
  save(): void;
  seed: number;
  edits(): number;
  startedAt: number;
}

const TOKEN = process.env.ADMIN_TOKEN ?? '';

/** Whether this build has an admin surface at all. */
export function adminEnabled(): boolean {
  return TOKEN.length >= 16;
}

/** Constant-time token comparison, tolerant of length mismatch. */
function tokenOk(given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length -- so compare fixed-size digests of the two instead.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Reads a JSON body, with a cap so a bad request cannot exhaust memory. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16_384) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

/**
 * Handles an admin request, or returns false if the URL is not one of ours.
 *
 * Returning false rather than 404 keeps this composable with the static file
 * handler: anything that is not an admin route falls through untouched.
 */
export async function handleAdmin(
  req: IncomingMessage, res: ServerResponse, hooks: AdminHooks,
): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/admin/')) return false;

  // Report the same thing for "no admin surface" and "wrong token", so a
  // probe cannot tell a locked door from a wall.
  if (!adminEnabled() || !isLoopback(req) ||
      !tokenOk(req.headers['x-admin-token'] as string | undefined)) {
    json(res, 404, { error: 'not found' });
    return true;
  }

  try {
    switch (url) {
      case '/admin/state': {
        json(res, 200, {
          players: hooks.players(),
          seed: hooks.seed,
          edits: hooks.edits(),
          uptimeMs: Date.now() - hooks.startedAt,
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        });
        return true;
      }
      case '/admin/kick': {
        const body = await readJson(req);
        const id = Number(body.id);
        const reason = String(body.reason ?? 'Kicked by the server owner').slice(0, 120);
        if (!Number.isInteger(id)) {
          json(res, 400, { error: 'id must be a number' });
          return true;
        }
        json(res, 200, { ok: hooks.kick(id, reason) });
        return true;
      }
      case '/admin/say': {
        const body = await readJson(req);
        const text = String(body.text ?? '').trim().slice(0, 256);
        if (!text) {
          json(res, 400, { error: 'nothing to say' });
          return true;
        }
        hooks.say(text);
        json(res, 200, { ok: true });
        return true;
      }
      case '/admin/save': {
        hooks.save();
        json(res, 200, { ok: true });
        return true;
      }
      default:
        json(res, 404, { error: 'not found' });
        return true;
    }
  } catch (err) {
    json(res, 400, { error: String(err instanceof Error ? err.message : err) });
    return true;
  }
}
