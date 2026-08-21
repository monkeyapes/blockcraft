/**
 * Fetching the `.bc` name registry.
 *
 * One network call, cached for the session. The rules live in
 * shared/src/address.ts and are tested without a network; this file is only
 * the part that goes and gets the file, which is the part that cannot be
 * tested that way.
 *
 * Everything here fails toward "no registry", never toward a wrong answer. A
 * name that resolves to the wrong server is worse than one that does not
 * resolve at all -- the player would connect somewhere and have no idea they
 * had.
 */

import {
  REGISTRY_URL, type Registry, parseRegistry,
} from '@shared/address.js';

/** How long to wait before giving up. Joining a server should not hang. */
const TIMEOUT_MS = 4000;

/** Re-fetch at most this often, so a refresh button cannot hammer the file. */
const MIN_REFETCH_MS = 30_000;

let cached: Registry | null = null;
let fetchedAt = 0;
let inflight: Promise<Registry | null> | null = null;

/**
 * The registry, fetched once and reused.
 *
 * Returns null when it could not be had -- unreachable, timed out, malformed,
 * or a version this client does not understand. Callers pass that straight to
 * resolveAddress, which turns it into a message telling the player a
 * host:port still works.
 */
export async function getRegistry(force = false): Promise<Registry | null> {
  const now = Date.now();
  if (!force && cached && now - fetchedAt < MIN_REFETCH_MS) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(REGISTRY_URL, {
          signal: controller.signal,
          cache: 'no-cache',
        });
        if (!res.ok) return null;
        const parsed = parseRegistry(await res.json());
        if (parsed) {
          cached = parsed;
          fetchedAt = Date.now();
        }
        return parsed;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Offline, blocked, timed out, or not JSON. All the same to a caller:
      // there is no registry, so use an address.
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** What is in the cache right now, without going to the network. */
export function cachedRegistry(): Registry | null {
  return cached;
}

/** Forgets the cache. Used by the refresh control in the server browser. */
export function clearRegistry(): void {
  cached = null;
  fetchedAt = 0;
}
