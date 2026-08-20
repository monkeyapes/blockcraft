/** Survival rules: health, environmental damage, and block-breaking progress. */

import { Block, blockDef } from '@shared/blocks.js';
import { breakTime, damageAfterArmor } from '@shared/items.js';
import type { Player } from './player.js';
import type { ClientWorld } from './world.js';

export type GameMode = 'survival' | 'creative';

export const MAX_HEALTH = 20;
export const MAX_FOOD = 20;
/** Seconds of activity that burn one point of food. */
const FOOD_DRAIN = 22;
/** Food must be above this for health to regenerate at all. */
const REGEN_FOOD = 8;
const MAX_AIR = 10; // seconds underwater before drowning
const REGEN_INTERVAL = 4;
const REGEN_DELAY = 5; // seconds of no damage before healing resumes
const SAFE_FALL = 3.5;

export interface DamageEvent {
  amount: number;
  cause: string;
}

export class Survival {
  mode: GameMode = 'survival';
  health = MAX_HEALTH;
  /**
   * Food, 0-20.
   *
   * Without this, eating was pointless the moment you were at full health --
   * food only healed, so a full-health player could never use any of it. Food
   * now gates regeneration instead, so keeping fed is what keeps you healing.
   */
  food = MAX_FOOD;
  private foodTimer = 0;
  air = MAX_AIR;
  dead = false;
  /** Vehicles absorb landings, so fall damage is suspended while riding. */
  inVehicle = false;

  private fallStart: number | null = null;
  private sinceDamage = 0;
  private regenTimer = 0;
  private lavaTimer = 0;
  private drownTimer = 0;

  onDamage: (event: DamageEvent) => void = () => {};
  onDeath: (cause: string) => void = () => {};

  get creative(): boolean {
    return this.mode === 'creative';
  }

  /** Restores health, capped at full. */
  heal(amount: number): void {
    if (this.dead || amount <= 0) return;
    this.health = Math.min(MAX_HEALTH, this.health + amount);
  }

  reset(): void {
    this.health = MAX_HEALTH;
    this.food = MAX_FOOD;
    this.foodTimer = 0;
    this.air = MAX_AIR;
    this.dead = false;
    this.fallStart = null;
    this.sinceDamage = 0;
  }

  /** Armour points from worn gear, refreshed by the game loop. */
  defense = 0;

  damage(amount: number, cause: string): void {
    if (this.creative || this.dead || amount <= 0) return;
    // Armour softens everything except drowning and the void.
    const reduced = cause === 'drowned' || cause === 'fell out of the world'
      ? amount
      : damageAfterArmor(amount, this.defense);
    this.health = Math.max(0, this.health - reduced);
    this.sinceDamage = 0;
    this.onDamage({ amount, cause });
    if (this.health === 0) {
      this.dead = true;
      this.onDeath(cause);
    }
  }

  update(dt: number, player: Player, world: ClientWorld): void {
    if (this.creative) {
      this.health = MAX_HEALTH;
      this.food = MAX_FOOD;
      this.air = MAX_AIR;
      this.fallStart = null;
      return;
    }
    if (this.dead) return;

    this.trackFall(player);
    this.environment(dt, player, world);
    this.consumeFood(dt, player);
    this.regenerate(dt);
  }

  /** Fall damage is measured from the highest point of an unsupported drop. */
  private trackFall(player: Player): void {
    if (player.flying || this.inVehicle) {
      this.fallStart = null;
      return;
    }
    if (!player.onGround) {
      if (this.fallStart === null || player.y > this.fallStart) this.fallStart = player.y;
      return;
    }
    if (this.fallStart === null) return;

    const distance = this.fallStart - player.y;
    this.fallStart = null;
    if (distance > SAFE_FALL) {
      this.damage(Math.floor(distance - SAFE_FALL), 'fell from a high place');
    }
  }

  private environment(dt: number, player: Player, world: ClientWorld): void {
    const feet = world.getBlock(
      Math.floor(player.x), Math.floor(player.y + 0.1), Math.floor(player.z));
    const head = world.getBlock(
      Math.floor(player.x), Math.floor(player.y + 1.6), Math.floor(player.z));

    // Lava burns steadily while you are standing in it.
    if (feet === Block.Lava || head === Block.Lava) {
      this.lavaTimer += dt;
      while (this.lavaTimer >= 0.5) {
        this.lavaTimer -= 0.5;
        this.damage(2, 'burned in lava');
      }
      this.fallStart = null; // lava breaks the fall
    } else {
      this.lavaTimer = 0;
    }

    // Breath, then drowning.
    if (head === Block.Water) {
      this.air = Math.max(0, this.air - dt);
      if (this.air === 0) {
        this.drownTimer += dt;
        while (this.drownTimer >= 1) {
          this.drownTimer -= 1;
          this.damage(2, 'drowned');
        }
      }
      this.fallStart = null; // water breaks the fall
    } else {
      this.air = Math.min(MAX_AIR, this.air + dt * 4);
      this.drownTimer = 0;
    }

    if (player.y < -4) this.damage(4 * dt, 'fell out of the world');
  }

  /**
   * Food drains with activity, and starving hurts.
   *
   * Standing still costs almost nothing, so a player who is building rather
   * than exploring is not nagged into eating every minute.
   */
  private consumeFood(dt: number, player: Player): void {
    const moving = !player.onGround || Math.abs(player.vy) > 0.1;
    const rate = moving ? 1.4 : 1;
    this.foodTimer += dt * rate;
    while (this.foodTimer >= FOOD_DRAIN) {
      this.foodTimer -= FOOD_DRAIN;
      this.food = Math.max(0, this.food - 1);
    }
    if (this.food <= 0) {
      this.starveTimer += dt;
      while (this.starveTimer >= 4) {
        this.starveTimer -= 4;
        // Starvation never kills outright; it leaves you on the edge so a
        // bad decision does, which is far less frustrating than dying to a
        // bar you forgot to watch.
        if (this.health > 1) this.damage(1, 'went hungry');
      }
    } else {
      this.starveTimer = 0;
    }
  }

  /** Restores food, capped. */
  feed(amount: number): void {
    this.food = Math.min(MAX_FOOD, this.food + amount);
  }

  private starveTimer = 0;

  private regenerate(dt: number): void {
    this.sinceDamage += dt;
    // Healing runs on a full stomach; that is what makes food matter.
    if (this.health >= MAX_HEALTH || this.sinceDamage < REGEN_DELAY ||
        this.food < REGEN_FOOD) {
      this.regenTimer = 0;
      return;
    }
    this.regenTimer += dt;
    while (this.regenTimer >= REGEN_INTERVAL) {
      this.regenTimer -= REGEN_INTERVAL;
      this.health = Math.min(MAX_HEALTH, this.health + 1);
    }
  }
}

/** Tracks progress while the player holds the mine button on one block. */
export class Mining {
  target: [number, number, number] | null = null;
  progress = 0;

  private required = 0;

  /** Returns true on the frame the block finally breaks. */
  update(
    dt: number,
    hit: { block: [number, number, number]; id: number } | null,
    heldItem: number | null,
    creative: boolean,
  ): boolean {
    if (!hit || !blockDef(hit.id).breakable) {
      this.cancel();
      return false;
    }
    if (creative) {
      this.target = hit.block;
      this.progress = 1;
      return true;
    }

    const [x, y, z] = hit.block;
    if (!this.target || this.target[0] !== x || this.target[1] !== y || this.target[2] !== z) {
      this.target = [x, y, z];
      this.progress = 0;
      this.required = breakTime(hit.id, heldItem);
    }

    if (!Number.isFinite(this.required)) return false;
    this.progress += dt / Math.max(this.required, 0.01);
    if (this.progress < 1) return false;

    this.progress = 0;
    return true;
  }

  cancel(): void {
    this.target = null;
    this.progress = 0;
  }
}
