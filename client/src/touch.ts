/**
 * Touch controls.
 *
 * The screen is split rather than covered in buttons: the left half is a
 * thumbstick that appears wherever you first press, the right half is the
 * look area. That keeps the middle of the screen -- the part you are
 * actually trying to see -- free of chrome, and it means neither thumb has
 * to find a fixed target it cannot see under its own hand.
 *
 * Everything here writes into the same InputState the keyboard does, so the
 * rest of the game never learns there is such a thing as touch.
 */

import type { InputState } from './player.js';

/** Radius in px at which the stick reads as fully pushed. */
const STICK_RANGE = 58;
/** Dead zone, so resting a thumb does not creep the player forward. */
const STICK_DEAD = 0.18;
/** Past this fraction of the range, walking becomes sprinting. */
const SPRINT_AT = 0.92;
/** A press shorter than this, that barely moved, counts as a tap. */
const TAP_MS = 220;
const TAP_SLOP = 14;

export interface TouchActions {
  /** Look delta in the same units the mouse produces. */
  look: (dx: number, dy: number) => void;
  /** A tap on the world: mine the block being looked at. */
  tap: () => void;
  /** Held down: keep mining. */
  setMining: (on: boolean) => void;
  place: () => void;
  jump: () => void;
  toggleInventory: () => void;
  /** Sneak toggles rather than being held; a thumb cannot hold a modifier. */
  sneakChanged: (on: boolean) => void;
}

interface Stick {
  /** The touch driving it. */
  id: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

export class TouchControls {
  private stick: Stick | null = null;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private lookStart = 0;
  private lookMoved = 0;
  private sneaking = false;
  private mining = false;
  private miningTimer: ReturnType<typeof setTimeout> | null = null;

  /** True while a touch is driving the movement stick, for the HUD ring. */
  get stickActive(): boolean {
    return this.stick !== null;
  }

  get stickOffset(): { ox: number; oy: number; dx: number; dy: number } | null {
    if (!this.stick) return null;
    return {
      ox: this.stick.originX, oy: this.stick.originY,
      dx: this.stick.x - this.stick.originX,
      dy: this.stick.y - this.stick.originY,
    };
  }

  constructor(
    private surface: HTMLElement,
    private actions: TouchActions,
  ) {
    surface.addEventListener('touchstart', (e) => this.onStart(e), { passive: false });
    surface.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
    surface.addEventListener('touchend', (e) => this.onEnd(e), { passive: false });
    surface.addEventListener('touchcancel', (e) => this.onEnd(e), { passive: false });
  }

  /** Folds the stick into the input the player update reads. */
  apply(input: InputState, frozen: boolean): void {
    if (frozen || !this.stick) {
      input.forward = input.back = input.left = input.right = false;
      input.sprint = false;
      input.sneak = frozen ? false : this.sneaking;
      return;
    }

    const dx = this.stick.x - this.stick.originX;
    const dy = this.stick.y - this.stick.originY;
    const dist = Math.hypot(dx, dy);
    const amount = Math.min(1, dist / STICK_RANGE);

    if (amount < STICK_DEAD) {
      input.forward = input.back = input.left = input.right = false;
      input.sprint = false;
      input.sneak = this.sneaking;
      return;
    }

    // Booleans, not an analogue vector, because that is what InputState is:
    // the stick's angle picks which of the four the player is pressing, and
    // diagonals set two at once exactly as two keys would.
    const nx = dx / dist;
    const ny = dy / dist;
    input.forward = ny < -0.38;
    input.back = ny > 0.38;
    input.left = nx < -0.38;
    input.right = nx > 0.38;
    input.sprint = amount > SPRINT_AT;
    input.sneak = this.sneaking;
  }

  setSneak(on: boolean): void {
    this.sneaking = on;
    this.actions.sneakChanged(on);
  }

  get sneak(): boolean {
    return this.sneaking;
  }

  // --------------------------------------------------------------- handlers

  private isLookSide(x: number): boolean {
    return x > this.surface.clientWidth * 0.42;
  }

  private onStart(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (this.isLookSide(t.clientX)) {
        if (this.lookId !== null) continue;
        this.lookId = t.identifier;
        this.lookX = t.clientX;
        this.lookY = t.clientY;
        this.lookStart = performance.now();
        this.lookMoved = 0;
        // Holding still on the world means "keep mining"; the timer starts
        // here and is cancelled if the finger turns out to be a look drag.
        this.miningTimer = setTimeout(() => {
          this.mining = true;
          this.actions.setMining(true);
        }, TAP_MS);
      } else if (this.stick === null) {
        this.stick = {
          id: t.identifier,
          originX: t.clientX, originY: t.clientY,
          x: t.clientX, y: t.clientY,
        };
      }
    }
    e.preventDefault();
  }

  private onMove(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick.x = t.clientX;
        this.stick.y = t.clientY;
      } else if (t.identifier === this.lookId) {
        const dx = t.clientX - this.lookX;
        const dy = t.clientY - this.lookY;
        this.lookX = t.clientX;
        this.lookY = t.clientY;
        this.lookMoved += Math.hypot(dx, dy);
        // A real drag is a look, never a hold-to-mine.
        if (this.lookMoved > TAP_SLOP) this.cancelMiningTimer();
        this.actions.look(dx, dy);
      }
    }
    e.preventDefault();
  }

  private onEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick = null;
      } else if (t.identifier === this.lookId) {
        const held = performance.now() - this.lookStart;
        this.cancelMiningTimer();
        if (this.mining) {
          this.mining = false;
          this.actions.setMining(false);
        } else if (held < TAP_MS && this.lookMoved < TAP_SLOP) {
          this.actions.tap();
        }
        this.lookId = null;
      }
    }
    e.preventDefault();
  }

  private cancelMiningTimer(): void {
    if (this.miningTimer !== null) {
      clearTimeout(this.miningTimer);
      this.miningTimer = null;
    }
  }
}

/**
 * Whether this device should get the touch build.
 *
 * Coarse pointer plus no hover is the honest test -- a narrow desktop window
 * is still a mouse, and a large tablet is still touch, so neither width nor
 * the user-agent string answers it correctly on its own.
 */
export function isTouchDevice(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(pointer: coarse)').matches &&
    !matchMedia('(hover: hover)').matches;
}
