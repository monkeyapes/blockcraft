/**
 * The parts of the hosting app that are decisions rather than plumbing.
 *
 * Kept apart from the window and the child process so they can be tested
 * without either. What is left in the UI is wiring; what is here is the stuff
 * that is actually easy to get wrong -- which address to tell people to use,
 * whether the thing is really reachable, and what the log is saying.
 */

/** Server lifecycle, as far as the window is concerned. */
export type HostState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';

export interface HostStatus {
  state: HostState;
  /** Port it was asked to listen on. */
  port: number;
  /** LAN address, if one could be determined. */
  lanHost: string | null;
  /** Public address, if a tunnel or lookup provided one. */
  publicHost: string | null;
  /** The claimed .bc name, if the host has one. */
  bcName: string | null;
  players: number;
  since: number | null;
}

export function emptyStatus(port: number): HostStatus {
  return {
    state: 'stopped', port, lanHost: null, publicHost: null,
    bcName: null, players: 0, since: null,
  };
}

/**
 * Which address to give people, and how far it actually reaches.
 *
 * This is the question the whole app exists to answer, and the one that a
 * naive hosting tool gets wrong by showing a LAN address as though it were
 * the internet. Someone shares 192.168.x.x with a friend two towns away, the
 * friend cannot connect, and neither of them can tell why.
 */
export type ReachTier = 'name' | 'internet' | 'lan' | 'local';

export interface ShareAddress {
  tier: ReachTier;
  address: string;
  /** Who can actually use this, said plainly. */
  who: string;
}

/** Addresses to offer, best first. */
export function shareAddresses(s: HostStatus): ShareAddress[] {
  const out: ShareAddress[] = [];
  if (s.bcName) {
    out.push({
      tier: 'name',
      address: `${s.bcName}.bc`,
      who: 'Anyone, once the name is published.',
    });
  }
  if (s.publicHost) {
    out.push({
      tier: 'internet',
      address: withPort(s.publicHost, s.port),
      who: 'Anyone on the internet.',
    });
  }
  if (s.lanHost) {
    out.push({
      tier: 'lan',
      address: `${s.lanHost}:${s.port}`,
      who: 'People on your network only — not friends elsewhere.',
    });
  }
  out.push({
    tier: 'local',
    address: `localhost:${s.port}`,
    who: 'This computer only. Useful for testing.',
  });
  return out;
}

/** A tunnel host may already carry its own port; do not add a second one. */
function withPort(host: string, port: number): string {
  return /:\d+$/.test(host) ? host : `${host}:${port}`;
}

/**
 * Whether people outside the network can actually join yet.
 *
 * A home connection is behind NAT, so a server that runs perfectly is still
 * unreachable until either a port is forwarded or a tunnel is up. Saying so
 * before anyone tries is the difference between a five-minute fix and an
 * evening of "it says running, why can nobody join".
 */
export function reachability(s: HostStatus): { reachable: boolean; advice: string } {
  if (s.state !== 'running') {
    return { reachable: false, advice: 'Start the server to get an address to share.' };
  }
  if (s.bcName && s.publicHost) {
    return { reachable: true, advice: `Share ${s.bcName}.bc — that is all anyone needs.` };
  }
  if (s.publicHost) {
    return {
      reachable: true,
      advice: 'Reachable from the internet. Claim a .bc name to give it something memorable.',
    };
  }
  return {
    reachable: false,
    advice:
      'Running, but only on your own network. A home connection is behind a router, ' +
      'so friends elsewhere cannot reach it yet: either forward the port on your ' +
      'router, or start a free tunnel.',
  };
}

/** A line the server printed, tagged by what it means. */
export interface LogLine {
  text: string;
  kind: 'info' | 'join' | 'leave' | 'error';
  at: number;
}

/**
 * Classifies a line of server output.
 *
 * Only so the window can colour joins and errors differently, and count who
 * is on. Anything unrecognised stays 'info' rather than being dropped -- a
 * hosting app that hides output it did not expect is hiding exactly the line
 * that explains the problem.
 */
export function classify(text: string, at = Date.now()): LogLine {
  const t = text.toLowerCase();
  if (/\berror\b|\bfailed\b|eaddrinuse|exception|unhandled/.test(t)) {
    return { text, kind: 'error', at };
  }
  if (/\bjoined\b|\bconnected\b/.test(t)) return { text, kind: 'join', at };
  if (/\bleft\b|\bdisconnected\b/.test(t)) return { text, kind: 'leave', at };
  return { text, kind: 'info', at };
}

/** Running player count after a line, given the count before it. */
export function applyToPlayers(count: number, line: LogLine): number {
  if (line.kind === 'join') return count + 1;
  if (line.kind === 'leave') return Math.max(0, count - 1);
  return count;
}

/**
 * Turns a server failure into something a person can act on.
 *
 * The default output of a crashed Node process is a stack trace, which tells
 * a host nothing about what to do next. These are the two failures that
 * actually happen.
 */
export function explainFailure(output: string): string {
  const t = output.toLowerCase();
  if (t.includes('eaddrinuse')) {
    return 'That port is already in use — something else on this machine has it. ' +
      'Pick a different port, or close whatever is using it.';
  }
  if (t.includes('eacces') || t.includes('permission denied')) {
    return 'Windows refused the port. Ports below 1024 need admin rights; pick a higher one.';
  }
  if (t.includes('enoent')) {
    return 'The server could not be found in the install. Reinstalling should fix it.';
  }
  return 'The server stopped unexpectedly. The log below has what it printed.';
}

/** Ports that will not work or will annoy: the app should refuse them early. */
export function validatePort(value: unknown): { ok: true; port: number } | { ok: false; why: string } {
  const port = Number(value);
  if (!Number.isInteger(port)) return { ok: false, why: 'Port must be a whole number.' };
  if (port < 1024) {
    return { ok: false, why: 'Use 1024 or above — lower ports need admin rights.' };
  }
  if (port > 65535) return { ok: false, why: 'The highest port is 65535.' };
  return { ok: true, port };
}

/** How long the server has been up, for the status line. */
export function uptime(since: number | null, now = Date.now()): string {
  if (!since) return '—';
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
