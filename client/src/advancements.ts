/**
 * Tracks which advancements the player has earned, and announces new ones.
 *
 * Earned ids live in localStorage per world, so a returning player is not
 * re-taught the game from scratch -- and so the list is a record of what
 * *this* save has done rather than a global checklist.
 */

import { ADVANCEMENTS, matching, type Advancement, type Trigger } from '@shared/advancements.js';

export class Advancements {
  private earned = new Set<string>();
  private key: string;

  /** Fired once per newly earned advancement. */
  onEarned: (advancement: Advancement) => void = () => {};

  constructor(worldSlot: string) {
    this.key = `bc.adv.${worldSlot}`;
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) for (const id of JSON.parse(raw) as string[]) this.earned.add(id);
    } catch {
      // A corrupt or unavailable store just means starting the list over,
      // which is far better than refusing to load the world.
    }
  }

  has(id: string): boolean {
    return this.earned.has(id);
  }

  get count(): number {
    return this.earned.size;
  }

  get total(): number {
    return ADVANCEMENTS.length;
  }

  /** All advancements, with whether each is earned, for a list screen. */
  list(): Array<{ advancement: Advancement; earned: boolean }> {
    return ADVANCEMENTS.map((a) => ({ advancement: a, earned: this.earned.has(a.id) }));
  }

  /**
   * Fires a trigger. Safe to call on every matching event -- an advancement
   * already earned is silently ignored, so callers never have to check first.
   */
  fire(trigger: Trigger): void {
    for (const advancement of matching(trigger)) {
      if (this.earned.has(advancement.id)) continue;
      this.earned.add(advancement.id);
      this.save();
      this.onEarned(advancement);
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify([...this.earned]));
    } catch {
      /* storage may be unavailable; the session still works */
    }
  }
}
