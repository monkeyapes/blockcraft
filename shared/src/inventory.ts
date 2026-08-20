/** Item stacks and the player inventory. */

import { stackSize } from './items.js';

export interface Stack {
  id: number;
  count: number;
}

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 9 hotbar + 27 storage

/** Equipment: four armour slots then the offhand. */
export const EQUIP_SIZE = 5;
export const OFFHAND_INDEX = 4;

export type Slots = Array<Stack | null>;

export function sameItem(a: Stack | null, b: Stack | null): boolean {
  return !!a && !!b && a.id === b.id;
}

export class Inventory {
  readonly slots: Slots;
  /** Worn armour (0-3, head to feet) and the offhand item (4). */
  readonly equipment: Slots = new Array(EQUIP_SIZE).fill(null);

  constructor(size = INVENTORY_SIZE) {
    this.slots = new Array(size).fill(null);
  }

  get offhand(): Stack | null {
    return this.equipment[OFFHAND_INDEX];
  }

  /** Total armour points from every worn piece. */
  defense(pointsOf: (id: number) => number): number {
    let total = 0;
    for (let i = 0; i < OFFHAND_INDEX; i++) {
      const worn = this.equipment[i];
      if (worn) total += pointsOf(worn.id);
    }
    return total;
  }

  get(index: number): Stack | null {
    return this.slots[index] ?? null;
  }

  set(index: number, stack: Stack | null): void {
    this.slots[index] = stack && stack.count > 0 ? stack : null;
  }

  /**
   * Adds items, filling partial stacks first.
   * Returns how many could not fit.
   */
  add(id: number, count: number): number {
    const max = stackSize(id);
    let left = count;

    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.id !== id || slot.count >= max) continue;
      const room = max - slot.count;
      const moved = Math.min(room, left);
      slot.count += moved;
      left -= moved;
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i]) continue;
      const moved = Math.min(max, left);
      this.slots[i] = { id, count: moved };
      left -= moved;
    }
    return left;
  }

  countOf(id: number): number {
    let total = 0;
    for (const slot of this.slots) if (slot?.id === id) total += slot.count;
    return total;
  }

  /** Removes up to `count`; returns how many were actually taken. */
  remove(id: number, count: number): number {
    let left = count;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const slot = this.slots[i];
      if (slot?.id !== id) continue;
      const taken = Math.min(slot.count, left);
      slot.count -= taken;
      left -= taken;
      if (slot.count === 0) this.slots[i] = null;
    }
    return count - left;
  }

  /** Consumes one item from a specific slot, for placing a block. */
  consumeAt(index: number): boolean {
    const slot = this.slots[index];
    if (!slot) return false;
    slot.count--;
    if (slot.count <= 0) this.slots[index] = null;
    return true;
  }

  isEmpty(): boolean {
    return this.slots.every((s) => s === null);
  }

  clear(): void {
    this.slots.fill(null);
  }

  toJSON(): { slots: Array<[number, number, number]>; equipment: Array<[number, number, number]> } {
    const pack = (list: Slots): Array<[number, number, number]> => {
      const out: Array<[number, number, number]> = [];
      list.forEach((slot, i) => {
        if (slot) out.push([i, slot.id, slot.count]);
      });
      return out;
    };
    return { slots: pack(this.slots), equipment: pack(this.equipment) };
  }

  static fromJSON(
    data: { slots?: Array<[number, number, number]>; equipment?: Array<[number, number, number]> },
    size = INVENTORY_SIZE,
  ): Inventory {
    const inv = new Inventory(size);
    for (const [i, id, count] of data.slots ?? []) {
      if (i >= 0 && i < size) inv.slots[i] = { id, count };
    }
    for (const [i, id, count] of data.equipment ?? []) {
      if (i >= 0 && i < EQUIP_SIZE) inv.equipment[i] = { id, count };
    }
    return inv;
  }
}

/**
 * Moves a stack between two slot arrays, merging when the items match.
 * `amount` of Infinity moves everything.
 */
export function transfer(
  from: Slots, fromIndex: number, to: Slots, toIndex: number, amount = Infinity,
): void {
  const src = from[fromIndex];
  if (!src) return;
  const dst = to[toIndex];
  const moving = Math.min(src.count, amount);

  if (!dst) {
    to[toIndex] = { id: src.id, count: moving };
    src.count -= moving;
    if (src.count <= 0) from[fromIndex] = null;
    return;
  }

  if (dst.id === src.id) {
    const room = stackSize(dst.id) - dst.count;
    const moved = Math.min(room, moving);
    dst.count += moved;
    src.count -= moved;
    if (src.count <= 0) from[fromIndex] = null;
    return;
  }

  // Different items: swap, but only for a whole-stack move.
  if (moving === src.count) {
    from[fromIndex] = dst;
    to[toIndex] = src;
  }
}
