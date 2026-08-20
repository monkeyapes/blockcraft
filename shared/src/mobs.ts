/**
 * Mob registry.
 *
 * Definitions live in shared so the client, the single-player link and a
 * future authoritative server all agree on health, damage and drops.
 */

import { Block } from './blocks.js';
import { Dimension } from './constants.js';
import { Item } from './items.js';

export enum MobKind {
  Pig = 1,
  Cow = 2,
  Sheep = 3,
  Chicken = 4,
  Zombie = 5,
  Blaze = 6,
  Enderman = 7,
  EnderDragon = 8,
}

/** Neutral mobs ignore you until you hit them, then never forget. */
export type MobTemper = 'passive' | 'hostile' | 'neutral';

export interface MobDrop {
  id: number;
  min: number;
  max: number;
}

export interface MobDef {
  kind: MobKind;
  name: string;
  temper: MobTemper;
  health: number;
  /** Collision box. */
  width: number;
  height: number;
  /** Blocks per second while wandering, and while chasing. */
  walkSpeed: number;
  chaseSpeed: number;
  /** Melee damage and cooldown in seconds; hostiles only. */
  attack: number;
  attackCooldown: number;
  /** How far a hostile notices the player. */
  aggroRange: number;
  drops: MobDrop[];
  /** Which dimensions it appears in. */
  dimensions: Dimension[];
  /** Spawns only below this light-ish depth, for things that hate daylight. */
  spawnsInDarkOnly: boolean;
  /** Block it prefers to stand on when spawning; null means anything solid. */
  spawnSurface: Block | null;
  /** Ignores gravity and holds an altitude. */
  flying: boolean;
  /** Attacks at range rather than in melee; 0 means melee only. */
  rangedAttack: number;
  /** Blinks away when hurt, the way an enderman does. */
  teleports: boolean;
  /** A boss: never despawns, never spawns naturally, and shows a health bar. */
  boss: boolean;
}

/** Fields every mob shares a sensible default for. */
const BASE = {
  flying: false,
  rangedAttack: 0,
  teleports: false,
  boss: false,
};

const defs = new Map<MobKind, MobDef>();

function mob(def: MobDef): void {
  defs.set(def.kind, def);
}

mob({
  kind: MobKind.Pig, name: 'Pig', temper: 'passive', health: 10,
  width: 0.9, height: 0.9, walkSpeed: 1.6, chaseSpeed: 2.6,
  attack: 0, attackCooldown: 0, aggroRange: 0,
  drops: [{ id: Item.RawPorkchop, min: 1, max: 3 }],
  dimensions: [Dimension.Overworld], spawnsInDarkOnly: false,
  spawnSurface: Block.Grass, ...BASE,
});

mob({
  kind: MobKind.Cow, name: 'Cow', temper: 'passive', health: 10,
  width: 0.9, height: 1.4, walkSpeed: 1.4, chaseSpeed: 2.4,
  attack: 0, attackCooldown: 0, aggroRange: 0,
  drops: [
    { id: Item.RawBeef, min: 1, max: 3 },
    { id: Item.Leather, min: 0, max: 2 },
  ],
  dimensions: [Dimension.Overworld], spawnsInDarkOnly: false,
  spawnSurface: Block.Grass, ...BASE,
});

mob({
  kind: MobKind.Sheep, name: 'Sheep', temper: 'passive', health: 8,
  width: 0.9, height: 1.3, walkSpeed: 1.5, chaseSpeed: 2.4,
  attack: 0, attackCooldown: 0, aggroRange: 0,
  drops: [{ id: Item.RawMutton, min: 1, max: 2 }],
  dimensions: [Dimension.Overworld], spawnsInDarkOnly: false,
  spawnSurface: Block.Grass, ...BASE,
});

mob({
  kind: MobKind.Chicken, name: 'Chicken', temper: 'passive', health: 4,
  width: 0.4, height: 0.7, walkSpeed: 1.8, chaseSpeed: 2.8,
  attack: 0, attackCooldown: 0, aggroRange: 0,
  drops: [
    { id: Item.RawChicken, min: 1, max: 1 },
    { id: Item.Feather, min: 0, max: 2 },
  ],
  dimensions: [Dimension.Overworld], spawnsInDarkOnly: false,
  spawnSurface: Block.Grass, ...BASE,
});

mob({
  kind: MobKind.Zombie, name: 'Zombie', temper: 'hostile', health: 20,
  width: 0.6, height: 1.95, walkSpeed: 1.2, chaseSpeed: 3.4,
  attack: 3, attackCooldown: 1.0, aggroRange: 16,
  drops: [{ id: Item.Leather, min: 0, max: 1 }],
  dimensions: [Dimension.Overworld], spawnsInDarkOnly: true,
  spawnSurface: null, ...BASE,
});

mob({
  kind: MobKind.Blaze, name: 'Blaze', temper: 'hostile', health: 20,
  width: 0.6, height: 1.8, walkSpeed: 1.6, chaseSpeed: 3.0,
  attack: 0, attackCooldown: 1.6, aggroRange: 18,
  drops: [{ id: Item.BlazeRod, min: 1, max: 2 }],
  dimensions: [Dimension.Nether], spawnsInDarkOnly: false,
  spawnSurface: null, ...BASE,
  flying: true, rangedAttack: 3,
});

mob({
  kind: MobKind.Enderman, name: 'Enderman', temper: 'neutral', health: 40,
  width: 0.6, height: 2.9, walkSpeed: 1.2, chaseSpeed: 4.4,
  attack: 4, attackCooldown: 1.0, aggroRange: 20,
  drops: [{ id: Item.EnderPearl, min: 1, max: 1 }],
  dimensions: [Dimension.End, Dimension.Overworld], spawnsInDarkOnly: false,
  spawnSurface: null, ...BASE,
  teleports: true,
});

mob({
  kind: MobKind.EnderDragon, name: 'Ender Dragon', temper: 'hostile', health: 200,
  width: 3.4, height: 2.2, walkSpeed: 6, chaseSpeed: 11,
  attack: 8, attackCooldown: 1.4, aggroRange: 200,
  drops: [],
  dimensions: [Dimension.End], spawnsInDarkOnly: false,
  spawnSurface: null, ...BASE,
  flying: true, boss: true,
});

export function mobDef(kind: MobKind): MobDef {
  return defs.get(kind) ?? defs.get(MobKind.Pig)!;
}

export function allMobKinds(): MobKind[] {
  return [...defs.keys()];
}

/**
 * Which mobs spawn naturally in a dimension, split by temper.
 * Bosses are placed deliberately, never rolled for.
 */
export function spawnableIn(dim: Dimension, temper: MobTemper): MobDef[] {
  return [...defs.values()].filter(
    (d) => !d.boss && d.temper === temper && d.dimensions.includes(dim));
}

/** Rolls a mob's drops. `random` should return 0..1. */
export function rollDrops(kind: MobKind, random: () => number): Array<{ id: number; count: number }> {
  const out: Array<{ id: number; count: number }> = [];
  for (const drop of mobDef(kind).drops) {
    const count = drop.min + Math.floor(random() * (drop.max - drop.min + 1));
    if (count > 0) out.push({ id: drop.id, count });
  }
  return out;
}
