/**
 * Mob registry.
 *
 * Definitions live in shared so the client, the single-player link and a
 * future authoritative server all agree on health, damage, drops and where
 * each creature may appear. How a mob *behaves* is client/src/mobs.ts; how it
 * looks is client/src/gfx/mobmesh.ts.
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
  Spider = 9,
  Skeleton = 10,
  Boomshroom = 11,
  /** The big slime. Each size is its own kind so each can have its own drops. */
  Slime = 12,
  MediumSlime = 13,
  SmallSlime = 14,
  Wolf = 15,
  Bat = 16,
  Rabbit = 17,
  Fish = 18,
}

/** Neutral mobs ignore you until you hit them, then never forget. */
export type MobTemper = 'passive' | 'hostile' | 'neutral';

/**
 * Which behaviour drives a mob. Most of what makes a spider a spider is here
 * rather than in numbers: it climbs, a skeleton keeps its distance, a slime
 * hops.
 */
export type MobBrain =
  | 'animal' | 'melee' | 'ranged' | 'boss'
  | 'spider' | 'archer' | 'bomber' | 'slime' | 'wolf' | 'bat' | 'rabbit' | 'fish';

/**
 * Spawn groups each have their own cap, so a cave full of bats never stops
 * zombies appearing and a lake full of fish never empties the meadows.
 */
export type SpawnGroup = 'creature' | 'monster' | 'ambient' | 'water';

/**
 * Where a natural spawn may happen:
 *  - surface: open sky over its spawn surface (animals)
 *  - dark:    any footing at light level 7 or less (monsters)
 *  - ground:  any footing whatever the light (the Nether has no night)
 *  - cave:    open air under cover, in the dark (bats)
 *  - water:   inside water (fish)
 *  - never:   only split off another mob, or summoned
 */
export type SpawnPlace = 'surface' | 'dark' | 'ground' | 'cave' | 'water' | 'never';

export interface MobDrop {
  id: number;
  min: number;
  max: number;
}

export interface SpawnRule {
  group: SpawnGroup;
  place: SpawnPlace;
  /** Relative chance against the others of its group. */
  weight: number;
  /** How many appear together: wolves come in packs. */
  pack: [number, number];
}

export interface MobDef {
  kind: MobKind;
  name: string;
  temper: MobTemper;
  brain: MobBrain;
  health: number;
  /** Collision box. */
  width: number;
  height: number;
  /** Blocks per second while wandering, and while chasing (or fleeing). */
  walkSpeed: number;
  chaseSpeed: number;
  /** Melee damage and cooldown in seconds. */
  attack: number;
  attackCooldown: number;
  /** How far a hostile notices the player. */
  aggroRange: number;
  drops: MobDrop[];
  /** Which dimensions it appears in. */
  dimensions: Dimension[];
  /** Spawns only in the dark: kept for older callers, derived from `spawn`. */
  spawnsInDarkOnly: boolean;
  /** Blocks it may spawn standing on; null means anything solid. */
  spawnSurface: number[] | null;
  spawn: SpawnRule;
  /** Ignores gravity and holds an altitude. */
  flying: boolean;
  /** Damage of a ranged attack (a blaze's fireball, a skeleton's arrow); 0 means melee only. */
  rangedAttack: number;
  /** Blinks away when hurt, the way an enderman does. */
  teleports: boolean;
  /** A boss: never despawns, never spawns naturally, and shows a health bar. */
  boss: boolean;
  /** Slime size, 1 to 3; scales the model. 1 for everything else. */
  size: number;
  /** What it breaks into when it dies, and how many. */
  splitsInto: MobKind | null;
  splitCount: number;
}

/** Fields most mobs share a sensible default for. */
const BASE = {
  flying: false,
  rangedAttack: 0,
  teleports: false,
  boss: false,
  size: 1,
  splitsInto: null,
  splitCount: 0,
};

const ANIMAL_SPAWN: SpawnRule = { group: 'creature', place: 'surface', weight: 10, pack: [1, 3] };
const MONSTER_SPAWN: SpawnRule = { group: 'monster', place: 'dark', weight: 10, pack: [1, 1] };
const NO_SPAWN: SpawnRule = { group: 'monster', place: 'never', weight: 0, pack: [1, 1] };

const defs = new Map<MobKind, MobDef>();

function mob(def: Omit<MobDef, 'spawnsInDarkOnly'>): void {
  defs.set(def.kind, { ...def, spawnsInDarkOnly: def.spawn.place === 'dark' || def.spawn.place === 'cave' });
}

mob({
  kind: MobKind.Pig, name: 'Pig', temper: 'passive', brain: 'animal', health: 10,
  width: 0.9, height: 0.9, walkSpeed: 1.6, chaseSpeed: 2.6,
  attack: 0, attackCooldown: 0, aggroRange: 0,
  drops: [{ id: Item.RawPorkchop, min: 1, max: 3 }],
  dimensions: [Dimension.Overworld],
  spawnSurface: [Block.Grass], spawn: ANIMAL_SPAWN, ...BASE,
});

mob({
  kind: MobKind.Cow, name: 'Cow', temper: 'passive', brain: 'animal', health: 10,
  width: 0.9, height: 1.4, walkSpeed: 1.4, chaseSpeed: 2.4,
  attack: 0, attackCooldown: 0, aggroRange: 0,
  drops: [
    { id: Item.RawBeef, min: 1, max: 3 },
    { id: Item.Leather, min: 0, max: 2 },
  ],
  dimensions: [Dimension.Overworld],
  spawnSurface: [Block.Grass], spawn: ANIMAL_SPAWN, ...BASE,
});

mob({
  kind: MobKind.Sheep, name: 'Sheep', temper: 'passive', brain: 'animal', health: 8,
  width: 0.9, height: 1.3, walkSpeed: 1.5, chaseSpeed: 2.4,
  attack: 0, attackCooldown: 0, aggroRange: 0,
  drops: [{ id: Item.RawMutton, min: 1, max: 2 }],
  dimensions: [Dimension.Overworld],
  spawnSurface: [Block.Grass, Block.SnowyGrass], spawn: ANIMAL_SPAWN, ...BASE,
});

mob({
  kind: MobKind.Chicken, name: 'Chicken', temper: 'passive', brain: 'animal', health: 4,
  width: 0.4, height: 0.7, walkSpeed: 1.8, chaseSpeed: 2.8,
  attack: 0, attackCooldown: 0, aggroRange: 0,
  drops: [
    { id: Item.RawChicken, min: 1, max: 1 },
    { id: Item.Feather, min: 0, max: 2 },
  ],
  dimensions: [Dimension.Overworld],
  spawnSurface: [Block.Grass], spawn: ANIMAL_SPAWN, ...BASE,
});

mob({
  kind: MobKind.Zombie, name: 'Zombie', temper: 'hostile', brain: 'melee', health: 20,
  width: 0.6, height: 1.95, walkSpeed: 1.2, chaseSpeed: 3.4,
  attack: 3, attackCooldown: 1.0, aggroRange: 16,
  drops: [{ id: Item.Leather, min: 0, max: 1 }],
  dimensions: [Dimension.Overworld],
  spawnSurface: null, spawn: MONSTER_SPAWN, ...BASE,
});

mob({
  kind: MobKind.Blaze, name: 'Blaze', temper: 'hostile', brain: 'ranged', health: 20,
  width: 0.6, height: 1.8, walkSpeed: 1.6, chaseSpeed: 3.0,
  attack: 0, attackCooldown: 1.6, aggroRange: 18,
  drops: [{ id: Item.BlazeRod, min: 1, max: 2 }],
  dimensions: [Dimension.Nether],
  spawnSurface: null, spawn: { ...MONSTER_SPAWN, place: 'ground' }, ...BASE,
  flying: true, rangedAttack: 3,
});

mob({
  kind: MobKind.Enderman, name: 'Enderman', temper: 'neutral', brain: 'melee', health: 40,
  width: 0.6, height: 2.9, walkSpeed: 1.2, chaseSpeed: 4.4,
  attack: 4, attackCooldown: 1.0, aggroRange: 20,
  drops: [{ id: Item.EnderPearl, min: 1, max: 1 }],
  // Rare in overworld darkness, common on the End's islands, which have no
  // daylight to keep them away.
  dimensions: [Dimension.End, Dimension.Overworld],
  spawnSurface: null, spawn: { ...MONSTER_SPAWN, weight: 2 }, ...BASE,
  teleports: true,
});

mob({
  kind: MobKind.EnderDragon, name: 'Ender Dragon', temper: 'hostile', brain: 'boss', health: 200,
  width: 3.4, height: 2.2, walkSpeed: 6, chaseSpeed: 11,
  attack: 8, attackCooldown: 1.4, aggroRange: 200,
  drops: [],
  dimensions: [Dimension.End],
  spawnSurface: null, spawn: NO_SPAWN, ...BASE,
  flying: true, boss: true,
});

mob({
  kind: MobKind.Spider, name: 'Spider', temper: 'hostile', brain: 'spider', health: 16,
  // Low and wide: it fits under a one-block overhang but not through a
  // one-block gap, and it is the widest thing that chases you.
  width: 1.3, height: 0.9, walkSpeed: 1.6, chaseSpeed: 3.8,
  attack: 2, attackCooldown: 0.9, aggroRange: 16,
  drops: [{ id: Item.String, min: 0, max: 2 }],
  dimensions: [Dimension.Overworld],
  spawnSurface: null, spawn: { ...MONSTER_SPAWN, weight: 8 }, ...BASE,
});

mob({
  kind: MobKind.Skeleton, name: 'Skeleton', temper: 'hostile', brain: 'archer', health: 20,
  width: 0.6, height: 1.95, walkSpeed: 1.3, chaseSpeed: 3.0,
  attack: 0, attackCooldown: 2.2, aggroRange: 18,
  drops: [
    { id: Item.Bone, min: 0, max: 2 },
    { id: Item.Arrow, min: 0, max: 2 },
  ],
  dimensions: [Dimension.Overworld],
  spawnSurface: null, spawn: { ...MONSTER_SPAWN, weight: 8 }, ...BASE,
  rangedAttack: 3,
});

mob({
  kind: MobKind.Boomshroom, name: 'Boomshroom', temper: 'hostile', brain: 'bomber', health: 20,
  width: 0.7, height: 1.4, walkSpeed: 1.2, chaseSpeed: 2.7,
  attack: 0, attackCooldown: 0, aggroRange: 16,
  drops: [{ id: Item.FusePowder, min: 0, max: 2 }],
  dimensions: [Dimension.Overworld],
  spawnSurface: null, spawn: { ...MONSTER_SPAWN, weight: 6 }, ...BASE,
});

mob({
  kind: MobKind.Slime, name: 'Slime', temper: 'hostile', brain: 'slime', health: 16,
  width: 1.5, height: 1.5, walkSpeed: 1.2, chaseSpeed: 2.6,
  attack: 4, attackCooldown: 0.8, aggroRange: 16,
  drops: [],
  dimensions: [Dimension.Overworld],
  spawnSurface: null, spawn: { ...MONSTER_SPAWN, weight: 3 }, ...BASE,
  size: 3, splitsInto: MobKind.MediumSlime, splitCount: 2,
});

mob({
  kind: MobKind.MediumSlime, name: 'Medium Slime', temper: 'hostile', brain: 'slime', health: 4,
  width: 1.0, height: 1.0, walkSpeed: 1.4, chaseSpeed: 2.9,
  attack: 2, attackCooldown: 0.8, aggroRange: 16,
  drops: [],
  dimensions: [Dimension.Overworld],
  spawnSurface: null, spawn: NO_SPAWN, ...BASE,
  size: 2, splitsInto: MobKind.SmallSlime, splitCount: 2,
});

mob({
  kind: MobKind.SmallSlime, name: 'Small Slime', temper: 'hostile', brain: 'slime', health: 1,
  width: 0.5, height: 0.5, walkSpeed: 1.6, chaseSpeed: 3.2,
  attack: 1, attackCooldown: 1.0, aggroRange: 16,
  // Only the smallest pay out: killing a big one is the work, the little
  // ones are the reward.
  drops: [{ id: Item.Slimeball, min: 0, max: 2 }],
  dimensions: [Dimension.Overworld],
  spawnSurface: null, spawn: NO_SPAWN, ...BASE,
  size: 1,
});

mob({
  kind: MobKind.Wolf, name: 'Wolf', temper: 'neutral', brain: 'wolf', health: 10,
  width: 0.6, height: 0.85, walkSpeed: 1.6, chaseSpeed: 4.6,
  attack: 3, attackCooldown: 0.9, aggroRange: 16,
  drops: [],
  dimensions: [Dimension.Overworld],
  spawnSurface: [Block.Grass, Block.SnowyGrass, Block.Podzol],
  spawn: { group: 'creature', place: 'surface', weight: 4, pack: [2, 4] }, ...BASE,
});

mob({
  kind: MobKind.Bat, name: 'Bat', temper: 'passive', brain: 'bat', health: 6,
  width: 0.5, height: 0.9, walkSpeed: 3.2, chaseSpeed: 4.2,
  attack: 0, attackCooldown: 0, aggroRange: 0,
  drops: [],
  dimensions: [Dimension.Overworld],
  spawnSurface: null, spawn: { group: 'ambient', place: 'cave', weight: 10, pack: [1, 2] }, ...BASE,
  flying: true,
});

mob({
  kind: MobKind.Rabbit, name: 'Rabbit', temper: 'passive', brain: 'rabbit', health: 3,
  width: 0.4, height: 0.5, walkSpeed: 1.8, chaseSpeed: 4.8,
  attack: 0, attackCooldown: 0, aggroRange: 0,
  drops: [
    { id: Item.RawRabbit, min: 0, max: 1 },
    { id: Item.Leather, min: 0, max: 1 },
  ],
  dimensions: [Dimension.Overworld],
  spawnSurface: [Block.Grass, Block.SnowyGrass, Block.Sand, Block.Snow],
  spawn: { group: 'creature', place: 'surface', weight: 6, pack: [1, 3] }, ...BASE,
});

mob({
  kind: MobKind.Fish, name: 'Fish', temper: 'passive', brain: 'fish', health: 3,
  width: 0.5, height: 0.4, walkSpeed: 1.4, chaseSpeed: 4.4,
  attack: 0, attackCooldown: 0, aggroRange: 0,
  drops: [{ id: Item.RawFish, min: 1, max: 1 }],
  dimensions: [Dimension.Overworld],
  spawnSurface: null, spawn: { group: 'water', place: 'water', weight: 10, pack: [1, 3] }, ...BASE,
});

export function mobDef(kind: MobKind): MobDef {
  return defs.get(kind) ?? defs.get(MobKind.Pig)!;
}

export function allMobKinds(): MobKind[] {
  return [...defs.keys()];
}

/**
 * Which mobs spawn naturally in a dimension, by temper. Bosses and split-off
 * slimes are placed deliberately, never rolled for.
 */
export function spawnableIn(dim: Dimension, temper: MobTemper): MobDef[] {
  return [...defs.values()].filter((d) =>
    !d.boss && d.spawn.place !== 'never' && d.temper === temper && d.dimensions.includes(dim));
}

/** Which mobs a spawn group rolls from in a dimension. */
export function spawnGroupIn(dim: Dimension, group: SpawnGroup): MobDef[] {
  return [...defs.values()].filter((d) =>
    !d.boss && d.spawn.place !== 'never' && d.spawn.group === group && d.dimensions.includes(dim));
}

/** Most of each group alive at once around the player. */
export const SPAWN_CAPS: Record<SpawnGroup, number> = {
  creature: 18,
  monster: 12,
  ambient: 4,
  water: 6,
};

/** Rolls a mob's drops. `random` should return 0..1. */
export function rollDrops(kind: MobKind, random: () => number): Array<{ id: number; count: number }> {
  const out: Array<{ id: number; count: number }> = [];
  for (const drop of mobDef(kind).drops) {
    const count = drop.min + Math.floor(random() * (drop.max - drop.min + 1));
    if (count > 0) out.push({ id: drop.id, count });
  }
  return out;
}
