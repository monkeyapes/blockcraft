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
    onLine: (text: string) => void;
    onExit: (code: number | null) => void;
  }): Promise<ServerHandle>;
  /** This machine's address on the local network, if it has one. */
  lanAddress(): Promise<string | null>;
  /** Puts text on the clipboard. */
  copy(text: string): Promise<void>;
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
  };
}

/** The real one, over Tauri's command and event channels. */
async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');

  return {
    real: true,
    async start({ port, seed, onLine, onExit }) {
      const offLine = await listen<string>('server-line', (e) => onLine(e.payload));
      const offExit = await listen<number | null>('server-exit', (e) => {
        onExit(e.payload);
        offLine();
        offExit();
      });
      try {
        await invoke('start_server', { port, seed });
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
  };
}

export async function makeBackend(): Promise<Backend> {
  return inTauri() ? tauriBackend() : mockBackend();
}
