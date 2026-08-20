/**
 * Keeping the mouse captured.
 *
 * Two browser rules shape everything here:
 *
 *   1. Pointer lock is only granted during a user gesture. A retry on a
 *      timer is refused however long it waits, so there is no such thing as
 *      "try again in a second" -- the only useful retry is on the player's
 *      next click.
 *   2. Escape is the browser's own "let me out" gesture. It releases the
 *      lock before any script runs, and re-requesting from within that same
 *      keydown is refused. Pressing Escape to pause therefore *always*
 *      unlocks, and the lock has to be taken again on a later gesture.
 *
 * Getting either wrong strands the player with a loose cursor: an earlier
 * version latched a "denied" flag on the first refusal and never asked
 * again, and a later one retried on a timer that could not succeed and then
 * gave up for the same reason. So this keeps no permanent verdict at all --
 * every click is free to try again, and failures only decide whether the
 * fallback steering is switched on alongside.
 */

/** Consecutive refusals before the click-to-steer fallback is offered. */
export const FALLBACK_AFTER = 3;

export interface LockDecision {
  /** Turn on absolute-cursor steering, because capture is not happening. */
  useFallback: boolean;
  /** Keep asking on future clicks -- always true; capture may yet be granted. */
  keepTrying: boolean;
}

/**
 * What to do after a refused lock attempt. Pure, so the policy can be
 * checked without a browser.
 *
 * `keepTrying` is deliberately always true: a refusal says something about
 * this moment, never about the session. The only thing that accumulates is
 * whether to *also* steer from raw cursor movement so the game stays
 * playable where capture genuinely never comes.
 */
export function afterFailure(consecutiveFailures: number): LockDecision {
  return {
    useFallback: consecutiveFailures >= FALLBACK_AFTER,
    keepTrying: true,
  };
}

/**
 * Tracks lock attempts against one element.
 *
 * `request()` is safe to call from any user gesture and does nothing when
 * already locked, so callers can simply call it on every click.
 */
export class PointerLockKeeper {
  private failures = 0;

  /**
   * True once capture has been refused enough times that the game should
   * also steer from raw cursor movement. Never stops the keeper asking.
   */
  fallback = false;

  /** Fired when the fallback state changes, so the UI can show a hint. */
  onChange: () => void = () => {};

  constructor(private element: HTMLElement) {}

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  /**
   * True when the game should act on a click rather than spend it on
   * capture. The fallback counts, so a context that refuses capture is
   * still fully playable.
   */
  get ready(): boolean {
    return this.locked || this.fallback;
  }

  /** Ask for capture. Only meaningful inside a user gesture. */
  request(): void {
    if (this.locked) return;
    try {
      const result = this.element.requestPointerLock() as unknown as
        Promise<void> | undefined;
      // Older browsers return undefined and report failure through the
      // pointerlockerror event, which routes to noteFailure as well.
      result?.then?.(() => this.noteSuccess())?.catch?.(() => this.noteFailure());
    } catch {
      this.noteFailure();
    }
  }

  /** Call from a `pointerlockchange` listener when capture is acquired. */
  noteSuccess(): void {
    const changed = this.fallback;
    this.failures = 0;
    this.fallback = false;
    if (changed) this.onChange();
  }

  /** Call from a `pointerlockerror` listener, or on a rejected request. */
  noteFailure(): void {
    this.failures++;
    const { useFallback } = afterFailure(this.failures);
    if (useFallback && !this.fallback) {
      this.fallback = true;
      this.onChange();
    }
  }

  /**
   * The player deliberately released the lock (pause, inventory, chat).
   *
   * This is not a failure: the next click should have as good a chance of
   * capturing as the first one did, so the failure count resets.
   */
  released(): void {
    this.failures = 0;
  }
}
