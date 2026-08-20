/**
 * Failure reporting.
 *
 * A game that vanishes with no explanation is the worst possible outcome, so
 * every route that can kill the session -- an uncaught error, a rejected
 * promise, a lost WebGL context, a throw inside the frame loop -- surfaces
 * here instead.
 */

const overlay = document.getElementById('crash') as HTMLDivElement;
const messageEl = document.getElementById('crash-message') as HTMLParagraphElement;
const detailEl = document.getElementById('crash-detail') as HTMLPreElement;
const reloadBtn = document.getElementById('crash-reload') as HTMLButtonElement;

let shown = false;

reloadBtn?.addEventListener('click', () => location.reload());

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}\n\n${error.stack ?? ''}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

export function showCrash(message: string, error?: unknown): void {
  // Only the first failure is useful; later ones are usually knock-on noise.
  if (shown) return;
  shown = true;

  console.error('[blockcraft]', message, error);
  if (!overlay) return;
  messageEl.textContent = message;
  detailEl.textContent = error === undefined ? '' : describe(error);
  overlay.hidden = false;
  document.exitPointerLock?.();
}

/** Wire up the global failure routes. Call once at startup. */
export function installCrashHandlers(canvas: HTMLCanvasElement): void {
  window.addEventListener('error', (event) => {
    showCrash('The game hit an unexpected error.', event.error ?? event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    showCrash('The game hit an unexpected error.', event.reason);
  });

  // A lost context is recoverable in principle, but every GPU resource is
  // gone, so the honest move is to tell the player and offer a reload.
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    showCrash(
      'The graphics context was lost. This usually means the GPU driver reset, ' +
      'or the browser ran out of video memory. Lowering the render distance in ' +
      'Settings makes it less likely.',
    );
  });
}

/** Runs the frame callback, reporting rather than silently dying. */
export function guardFrame(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch (error) {
    showCrash('The game loop stopped because of an error.', error);
    return false;
  }
}
