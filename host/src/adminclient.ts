/**
 * Talking to the running server's admin surface.
 *
 * The window calls this over plain HTTP to 127.0.0.1. It does not go through
 * Rust: the server is on the same machine, the WebView can reach loopback,
 * and routing it through a command would add a hop that could only introduce
 * bugs.
 *
 * The token is generated fresh per launch and handed to the server as an
 * environment variable when it is spawned. Nothing is stored, so a token can
 * never outlive the server it was minted for.
 */

export interface AdminPlayer {
  id: number;
  name: string;
  dim: number;
  x: number;
  y: number;
  z: number;
}

export interface AdminState {
  players: AdminPlayer[];
  seed: number;
  edits: number;
  uptimeMs: number;
  memoryMb: number;
}

/** Names for the dimension numbers, so a console does not show "dim 1". */
export const DIMENSION_NAMES = ['Overworld', 'Nether', 'The End'];

export function dimensionName(dim: number): string {
  return DIMENSION_NAMES[dim] ?? `Dimension ${dim}`;
}

/** A fresh admin token. 32 hex characters from the platform's CSPRNG. */
export function mintToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class AdminClient {
  constructor(private port: number, private token: string) {}

  private async call<T>(path: string, body?: unknown): Promise<T | null> {
    try {
      // A short timeout: this is polled, and a hung request would stack up
      // behind the next one and make the console look frozen.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            'x-admin-token': this.token,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) return null;
        return (await res.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // The server may simply not be up yet, or may have just stopped. Both
      // are ordinary here and neither is worth shouting about.
      return null;
    }
  }

  state(): Promise<AdminState | null> {
    return this.call<AdminState>('/admin/state');
  }

  async kick(id: number, reason: string): Promise<boolean> {
    const r = await this.call<{ ok: boolean }>('/admin/kick', { id, reason });
    return !!r?.ok;
  }

  async say(text: string): Promise<boolean> {
    const r = await this.call<{ ok: boolean }>('/admin/say', { text });
    return !!r?.ok;
  }

  async save(): Promise<boolean> {
    const r = await this.call<{ ok: boolean }>('/admin/save', {});
    return !!r?.ok;
  }
}

/**
 * Parses what the host typed into the console box.
 *
 * Slash commands, because that is what anyone who has run a game server
 * expects, and plain text broadcasts because that is what they will type
 * without thinking. Guessing wrong in either direction is annoying: a
 * message silently treated as a command does nothing, and a command
 * broadcast as chat tells everyone what you were trying to do.
 */
export type ConsoleCommand =
  | { kind: 'say'; text: string }
  | { kind: 'kick'; who: string; reason: string }
  | { kind: 'save' }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

export function parseCommand(input: string): ConsoleCommand | null {
  const raw = input.trim();
  if (!raw) return null;
  if (!raw.startsWith('/')) return { kind: 'say', text: raw };

  // Split off the command word only, and keep the remainder verbatim.
  // Splitting the whole line and rejoining it collapses runs of spaces, so a
  // message would arrive saying something slightly different from what was
  // typed -- which is a strange thing for a chat box to do.
  const body = raw.slice(1);
  const gap = body.search(/\s/);
  const cmd = (gap === -1 ? body : body.slice(0, gap)).toLowerCase();
  const args = gap === -1 ? '' : body.slice(gap + 1).trim();

  switch (cmd) {
    case 'say':
      if (!args) return { kind: 'error', message: 'Usage: /say <message>' };
      return { kind: 'say', text: args };
    case 'kick': {
      if (!args) return { kind: 'error', message: 'Usage: /kick <player> [reason]' };
      const [who, ...why] = args.split(/\s+/);
      return {
        kind: 'kick',
        who,
        reason: why.join(' ') || 'Kicked by the server owner',
      };
    }
    case 'save':
      return { kind: 'save' };
    case 'help':
    case '?':
      return { kind: 'help' };
    default:
      return { kind: 'error', message: `Unknown command: /${cmd}. Try /help.` };
  }
}

export const HELP_TEXT = [
  '/say <message>          tell everyone something',
  '/kick <player> [reason] remove somebody',
  '/save                   write the world to disk now',
  '/help                   this list',
  'Anything without a slash is sent as a message.',
];

/** Finds a player by name, case-insensitively, or null if it is ambiguous. */
export function findPlayer(players: AdminPlayer[], who: string): AdminPlayer | null {
  const lower = who.toLowerCase();
  const exact = players.filter((p) => p.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  // Fall back to a unique prefix, so hosts do not have to type a whole name.
  const prefix = players.filter((p) => p.name.toLowerCase().startsWith(lower));
  return prefix.length === 1 ? prefix[0] : null;
}
