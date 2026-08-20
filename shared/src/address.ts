/**
 * Server addresses.
 *
 * `donutsmp.bc` instead of `82.14.203.11:8787`. A name people can say out loud
 * and type from memory, which is the whole point -- nobody shares an IP in a
 * chat message and expects their friends to still have it tomorrow.
 *
 * **`.bc` is not a real top-level domain and never will be.** It resolves
 * inside Blockcraft and nowhere else: it will not ping, it will not open in a
 * browser, and no DNS server has heard of it. That is normal for a game and
 * costs nothing, but it does mean the game has to do the lookup itself.
 *
 * The lookup is a JSON file on GitHub Pages, which is free, needs no server to
 * keep running, and is already where the game is published. A name is claimed
 * by adding a line to it. If the registry cannot be reached, direct
 * `host:port` addresses keep working exactly as before -- the naming layer is
 * a convenience over the top of addressing, never a dependency of it.
 */

/** Where names are looked up. Free, static, and already published. */
export const REGISTRY_URL =
  'https://monkeyapes.github.io/blockcraft/registry.json';

/** The suffix that marks a Blockcraft name. */
export const BC_SUFFIX = '.bc';

/** Default port, so `donutsmp.bc` needs no number attached. */
export const DEFAULT_PORT = 8787;

export const NAME_MIN = 3;
export const NAME_MAX = 24;

/**
 * Names that must not be claimed.
 *
 * `localhost` would shadow the address every host tests with. The rest are
 * the ones a newcomer would assume are official, and letting a stranger own
 * `official.bc` is how a naming scheme turns into a phishing surface.
 */
export const RESERVED = new Set([
  'localhost', 'local', 'host', 'server', 'test',
  'blockcraft', 'official', 'admin', 'www', 'api', 'registry',
]);

export type Address =
  | { kind: 'name'; name: string }
  | { kind: 'direct'; host: string; port: number }
  | { kind: 'invalid'; reason: string };

/** Is this a well-formed name, ignoring whether anyone has claimed it? */
export function isValidName(name: string): boolean {
  if (name.length < NAME_MIN || name.length > NAME_MAX) return false;
  if (!/^[a-z0-9-]+$/.test(name)) return false;
  // Leading or trailing hyphens read as typos and sort strangely.
  if (name.startsWith('-') || name.endsWith('-')) return false;
  if (name.includes('--')) return false;
  return true;
}

/**
 * Turns whatever someone typed into something the game can act on.
 *
 * Deliberately forgiving about shape -- people paste `http://`, type capitals,
 * and leave spaces -- and deliberately strict about the name itself, because a
 * name that only *nearly* matches resolves to nothing and the error would look
 * like the server being down.
 */
export function parseAddress(input: string): Address {
  let raw = (input ?? '').trim().toLowerCase();
  if (!raw) return { kind: 'invalid', reason: 'Enter a server address.' };

  // People paste URLs. Take the host out and carry on.
  raw = raw.replace(/^(https?|wss?):\/\//, '').replace(/\/.*$/, '');
  if (!raw) return { kind: 'invalid', reason: 'Enter a server address.' };

  if (raw.endsWith(BC_SUFFIX)) {
    const name = raw.slice(0, -BC_SUFFIX.length);
    if (!name) return { kind: 'invalid', reason: 'Missing a name before .bc' };
    if (name.includes('.')) {
      return { kind: 'invalid', reason: 'A .bc name has no dots in it.' };
    }
    if (RESERVED.has(name)) {
      return { kind: 'invalid', reason: `"${name}" is reserved.` };
    }
    if (!isValidName(name)) {
      return {
        kind: 'invalid',
        reason: `A name is ${NAME_MIN}-${NAME_MAX} characters of a-z, 0-9 and hyphens.`,
      };
    }
    return { kind: 'name', name };
  }

  // Anything else is a host, optionally with a port.
  const m = raw.match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return { kind: 'invalid', reason: 'That is not an address the game understands.' };
  const host = m[1];
  const port = m[2] === undefined ? DEFAULT_PORT : Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { kind: 'invalid', reason: 'Port must be between 1 and 65535.' };
  }
  return { kind: 'direct', host, port };
}

/** One entry in the published registry. */
export interface RegistryEntry {
  host: string;
  port?: number;
  /** Shown in the server list. Optional and purely cosmetic. */
  title?: string;
}

export type Registry = Record<string, RegistryEntry>;

/** What a lookup produced, or why it did not. */
export type Resolved =
  | { ok: true; host: string; port: number; title?: string }
  | { ok: false; reason: string };

/**
 * Turns a parsed address into something to connect to.
 *
 * Takes the registry as an argument rather than fetching it, so the rules can
 * be tested without a network and so a caller can cache however it likes.
 */
export function resolveAddress(addr: Address, registry: Registry | null): Resolved {
  if (addr.kind === 'invalid') return { ok: false, reason: addr.reason };
  if (addr.kind === 'direct') return { ok: true, host: addr.host, port: addr.port };

  if (!registry) {
    return {
      ok: false,
      reason: 'Could not reach the name registry. A host:port address still works.',
    };
  }
  const entry = registry[addr.name];
  if (!entry) {
    return { ok: false, reason: `No server is registered as ${addr.name}${BC_SUFFIX}.` };
  }
  if (!entry.host) {
    return { ok: false, reason: `${addr.name}${BC_SUFFIX} is registered but has no address.` };
  }
  return {
    ok: true,
    host: entry.host,
    port: entry.port ?? DEFAULT_PORT,
    title: entry.title,
  };
}

/** The websocket URL for a resolved address. */
export function socketUrl(host: string, port: number, secure = false): string {
  return `${secure ? 'wss' : 'ws'}://${host}:${port}/ws`;
}

/** How an address should read back to a player, once resolved. */
export function displayAddress(addr: Address): string {
  if (addr.kind === 'name') return `${addr.name}${BC_SUFFIX}`;
  if (addr.kind === 'direct') {
    return addr.port === DEFAULT_PORT ? addr.host : `${addr.host}:${addr.port}`;
  }
  return 'invalid address';
}
