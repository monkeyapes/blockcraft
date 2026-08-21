import { AdminClient, type AdminState } from './adminclient.js';

/**
 * The window's view of the machine underneath it.
 *
 * Everything the app cannot do itself -- start a process, find a LAN address,
 * open a folder -- goes through here. Two implementations: the real one over
 * Tauri, and a fake one used when the page is opened in an ordinary browser.
 *
 * The fake is not a testing nicety. The UI is the part most likely to need
 * a dozen iterations, and iterating on it through a full Rust rebuild each
 * time would be slow enough to discourage getting it right.
 */

export interface ServerHandle {
  stop(): Promise<void>;
}

export interface Backend {
  /** True when running inside the desktop shell rather than a browser tab. */
  readonly real: boolean;
  /** Starts the server; output arrives on `onLine` until it exits. */
  start(opts: {
    port: number;
    seed: string;
    /** Minted per launch and handed to the server as ADMIN_TOKEN. */
    token: string;
    onLine: (text: string) => void;
    onExit: (code: number | null) => void;
  }): Promise<ServerHandle>;
  /** This machine's address on the local network, if it has one. */
  lanAddress(): Promise<string | null>;
  /** Puts text on the clipboard. */
  copy(text: string): Promise<void>;
  /**
   * A client for the running server's admin surface.
   *
   * It comes from here rather than being constructed directly so the preview
   * can stand one in. Without that, the player list -- the whole reason this
   * window exists -- could only be looked at by building the desktop app,
   * which is exactly the sort of slow loop that leaves an interface bad.
   */
  admin(port: number, token: string): AdminApi;
}

/** What the window needs from the server, whether real or stood in for. */
export interface AdminApi {
  state(): Promise<AdminState | null>;
  kick(id: number, reason: string): Promise<boolean>;
  say(text: string): Promise<boolean>;
  save(): Promise<boolean>;
}

/** Are we inside the desktop shell? */
function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * A stand-in for use in a browser tab.
 *
 * It prints plausible server output on a timer so the log, the player count
 * and the state transitions can all be exercised without a Rust build. It never
 * pretends to be reachable from the internet, because a fake that claims more
 * than the real thing would let exactly the wrong bug through.
 */
function mockBackend(): Backend {
  return {
    real: false,
    async start({ port, seed, onLine, onExit }) {
      let stopped = false;
      const say = (t: string) => { if (!stopped) onLine(t); };
      say(`[server] Blockcraft on http://localhost:${port}  (seed ${seed || 'random'})`);
      say('[server] this is a preview backend — nothing is really listening');
      const t1 = setTimeout(() => say('Player Ada joined'), 1200);
      const t2 = setTimeout(() => say('Player Bob joined'), 2600);
      const t3 = setTimeout(() => say('Player Ada left'), 5200);
      return {
        async stop() {
          stopped = true;
          [t1, t2, t3].forEach(clearTimeout);
          onExit(0);
        },
      };
    },
    async lanAddress() { return '192.168.1.40'; },
    async copy(text) { await navigator.clipboard?.writeText(text).catch(() => {}); },
    admin: () => fakeAdmin(),
  };
}

/**
 * A stand-in for the server's admin surface.
 *
 * People wander between dimensions and move about, so the list has something
 * to show and kicking has something to remove. It never invents a player the
 * log did not mention, because a preview that is livelier than the real thing
 * hides the case where nothing is happening.
 */
function fakeAdmin(): AdminApi {
  let people = [
    { id: 1, name: 'Ada', dim: 0, x: 12, y: 68, z: -40 },
    { id: 2, name: 'Bob', dim: 1, x: -3, y: 32, z: 8 },
  ];
  const started = Date.now();
  return {
    async state() {
      // Drift, so the panel visibly updates rather than looking frozen.
      people = people.map((p) => ({
        ...p,
        x: p.x + Math.round(Math.random() * 2 - 1),
        z: p.z + Math.round(Math.random() * 2 - 1),
      }));
      return {
        players: people,
        seed: 55504,
        edits: 128 + Math.floor((Date.now() - started) / 4000),
        uptimeMs: Date.now() - started,
        memoryMb: 84,
      };
    },
    async kick(id) {
      const before = people.length;
      people = people.filter((p) => p.id !== id);
      return people.length < before;
    },
    async say() { return true; },
    async save() { return true; },
  };
}

/** The real one, over Tauri's command and event channels. */
async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');

  return {
    real: true,
    async start({ port, seed, token, onLine, onExit }) {
      const offLine = await listen<string>('server-line', (e) => onLine(e.payload));
      const offExit = await listen<number | null>('server-exit', (e) => {
        onExit(e.payload);
        offLine();
        offExit();
      });
      try {
        await invoke('start_server', { port, seed, token });
      } catch (err) {
        // Report through the same channel as any other failure, so the window
        // has one path for "it did not start" rather than two.
        onLine(`Error: ${String(err)}`);
        onExit(1);
        offLine();
        offExit();
      }
      return { async stop() { await invoke('stop_server'); } };
    },
    async lanAddress() {
      try { return await invoke<string | null>('lan_address'); } catch { return null; }
    },
    // The WebView is a secure context, so the ordinary clipboard API works
    // and there is no reason to cross into Rust for it.
    async copy(text) { await navigator.clipboard?.writeText(text).catch(() => {}); },
    admin: (port, token) => new AdminClient(port, token),
  };
}

export async function makeBackend(): Promise<Backend> {
  return inTauri() ? tauriBackend() : mockBackend();
}
