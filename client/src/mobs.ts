/**
 * Living mobs: physics, AI and spawning.
 *
 * Kept deliberately close to the player's own movement code -- sub-stepped
 * collision against the real block shapes, with a skin, so nothing tunnels
 * through walls, a mob walks up a slab or a stair like you do, and a fence
 * (1.5 blocks of collision) keeps the livestock in.
 *
 * Each mob has a brain (shared/src/mobs.ts): animals wander and bolt, a
 * spider climbs, a skeleton keeps its distance and shoots, a boomshroom
 * swells and bursts, a slime hops and splits, a wolf can be tamed.
 */

import { Block, blockDef, isLiquid, isSolid } from '@shared/blocks.js';
import { Dimension, WORLD_Y } from '@shared/constants.js';
import {
  MobKind, SPAWN_CAPS, mobDef, spawnGroupIn, type MobDef, type SpawnGroup,
} from '@shared/mobs.js';
import { game, services } from './content/api.js';
import { MAX_LIGHT } from './light.js';
import { collisionBoxesAt } from './player.js';
import type { ClientWorld } from './world.js';

const GRAVITY = 26;
const TERMINAL = 50;
const MAX_STEP = 0.3;
const SKIN = 1e-4;
/**
 * The tallest ledge a mob walks straight up: a full block, the way an
 * animal hops onto one. A fence stands at 1.5 so nothing clears it, which is
 * the whole point of a fence.
 */
export const STEP_UP = 1.05;
/** How far past the blocking face to put the body when stepping up. */
const STEP_PROBE = 1e-3;

/** Seconds a dead mob lies there tipping over and fading before it is removed. */
export const DEATH_TIME = 0.8;
/** Seconds a hit flashes the model. */
export const HURT_TIME = 0.35;
/** Horizontal speed a blow imparts, and the little hop that goes with it. */
export const KNOCKBACK = 6.5;
const KNOCK_LIFT = 4.2;

/** Light level (0..1 of full) at or below which it counts as dark: level 7. */
export const DARK_LEVEL = 7 / MAX_LIGHT;

/** A boomshroom starts its fuse this close, and calms if you get this far away. */
export const FUSE_RANGE = 3;
export const FUSE_CANCEL = 4.5;
/** Seconds from the first swell to the blast. */
export const FUSE_TIME = 1.5;
export const BLAST_POWER = 3;

/** A skeleton's comfort zone: closer and it backs off, further and it closes. */
export const ARCHER_NEAR = 8;
export const ARCHER_FAR = 12;
const ARCHER_RANGE = 16;
const ARROW_SPEED = 24;

/** A tamed wolf walks to you beyond this, and teleports to you beyond the next. */
const FOLLOW_START = 3.5;
export const WOLF_TELEPORT = 16;
/** Seconds a sheared sheep takes to grow its fleece back. */
export const WOOL_REGROW: [number, number] = [90, 180];

export type MobState =
  | 'idle' | 'wander' | 'flee' | 'chase' | 'follow' | 'sit' | 'fuse' | 'strafe';

/** What the world is like for a mob this frame, beyond the blocks. */
export interface MobEnv {
  /** 0 (midnight) to 1 (noon): how much the sky lights things. */
  daylight: number;
  /** Whether the sky counts as sunlight at all. The Nether and End have no day. */
  sunlit: boolean;
}

const DEFAULT_ENV: MobEnv = { daylight: 1, sunlit: true };

/** Brightness of a light level; the same curve the terrain mesher uses. */
function falloff(level01: number): number {
  return Math.pow(0.82, MAX_LIGHT * (1 - Math.max(0, Math.min(1, level01))));
}

/** Sky exposure and block light at a cell, 0..1 each, for any world-like object. */
function lightsAt(world: ClientWorld, x: number, y: number, z: number): [number, number] {
  const w = world as Partial<ClientWorld> & Pick<ClientWorld, 'skyLight'>;
  const sky = typeof w.skyLight === 'function' ? w.skyLight(x, y, z) : 1;
  const block = typeof w.getBlockLight === 'function' ? w.getBlockLight(x, y, z) / MAX_LIGHT : 0;
  return [sky, block];
}

/** Effective light level 0..1 for mob decisions: the sun only counts by day. */
export function effectiveLight(
  world: ClientWorld, x: number, y: number, z: number, env: MobEnv = DEFAULT_ENV,
): number {
  const [sky, block] = lightsAt(world, x, y, z);
  return Math.max(env.sunlit ? sky * env.daylight : 0, block);
}

function wrapDegrees(a: number): number {
  let d = a % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function headingTo(dx: number, dz: number): number {
  return (Math.atan2(dz, dx) * 180) / Math.PI;
}

/**
 * Who is striking a mob right now. Set around a wolf's bite so the victim
 * knows it was a mob and not the player -- a tamed wolf must not start a
 * fight on your behalf with something it attacked itself.
 */
let striker: Mob | null = null;

let nextId = 1;

export class Mob {
  readonly id = nextId++;
  readonly def: MobDef;

  x: number;
  y: number;
  z: number;
  /** The way the body faces, in degrees; 0 is +x. */
  yaw: number;
  /** The way it is walking, which a strafing skeleton keeps apart from `yaw`. */
  moveYaw: number;
  /** Knockback and hop velocity, on top of whatever the mob is walking at. */
  vx = 0;
  vy = 0;
  vz = 0;
  onGround = false;

  health: number;
  state: MobState = 'idle';
  /** Seconds left in the current AI state. */
  private stateTimer = 0;
  private attackTimer = 0;
  /** Walk-cycle phase for the model. */
  phase = 0;
  /** Seconds alive, for idle animation (a bat's wings, a slime's wobble). */
  age = Math.random() * 10;
  /** Set for a moment after taking a hit, so the model can flash. */
  hurtTimer = 0;
  dead = false;
  /** Seconds since death; the model tips over and fades as it runs. */
  deathTime = 0;
  /** Removed without a corpse: a boomshroom that went off. */
  gone = false;
  /** Neutral mobs stay calm until provoked, then never forget. */
  angered = false;

  /** Brightness to draw at, from the light where it stands. */
  light = 1;
  /** Whether it is standing in the dark, which is what wakes a spider up. */
  dark = false;
  inWater = false;
  /** A spider pressed to a wall and going up it. */
  climbing = false;

  /** Head turn relative to the body, and nod, in degrees: it watches you. */
  headYaw = 0;
  headPitch = 0;
  /** 1 at the moment of an attack, decaying: a bite, a swing, a bow drawn. */
  attackAnim = 0;
  /** Seconds into a boomshroom's fuse. */
  fuse = 0;
  /** Slime squash after landing, 0..1. */
  squash = 0;
  /** Visual offset after a step up, easing to 0 so a hop is not a teleport. */
  yOffset = 0;

  /** A sheep's fleece. */
  sheared = false;
  woolTimer = 0;
  /** A wolf's loyalty. */
  tamed = false;
  sitting = false;
  /** What a tamed wolf is fighting. */
  target: Mob | null = null;

  /** Who landed the last blow, for wolves deciding whom to fight. */
  lastAttacker: 'player' | Mob | null = null;
  /** Set by a hit and consumed by MobWorld the next frame. */
  freshHurt = false;
  /** Already split into smaller slimes, or otherwise settled after death. */
  settled = false;

  /** Boss circling angle, and the altitude a flier wants to hold. */
  private orbit = Math.random() * Math.PI * 2;
  private hoverTarget = 0;
  private shootTimer = 1.5;
  private strafeDir = 1;
  private hopTimer = 0.5;
  private dryTimer = 1;
  /** Blocked sideways on the last move, and could not step up. */
  private blocked = false;

  constructor(kind: MobKind, x: number, y: number, z: number, yaw = 0) {
    this.def = mobDef(kind);
    this.health = this.def.health;
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.moveYaw = yaw;
  }

  get kind(): MobKind {
    return this.def.kind;
  }

  /** Slime size; 1 for everything else. */
  get size(): number {
    return this.def.size;
  }

  /** Centre of the body, used for targeting and distance checks. */
  get centre(): [number, number, number] {
    return [this.x, this.y + this.def.height / 2, this.z];
  }

  /** Is it going for the player right now (as opposed to wandering, or fighting for you)? */
  get aggressive(): boolean {
    return !this.dead && !this.tamed && (this.state === 'chase' || this.def.boss);
  }

  hurt(amount: number, fromX?: number, fromZ?: number): void {
    if (this.dead) return;
    this.health -= amount;
    this.hurtTimer = HURT_TIME;
    this.lastAttacker = striker ?? (fromX !== undefined ? 'player' : null);
    this.freshHurt = true;
    if (fromX !== undefined && fromZ !== undefined && !this.def.boss) {
      // Knocked straight away from wherever the blow came from.
      let kx = this.x - fromX;
      let kz = this.z - fromZ;
      const len = Math.hypot(kx, kz);
      if (len < 1e-4) {
        const back = ((this.yaw + 180) * Math.PI) / 180;
        kx = Math.cos(back);
        kz = Math.sin(back);
      } else {
        kx /= len;
        kz /= len;
      }
      // Heavier things budge less.
      const weight = this.def.width > 1 ? 0.6 : 1;
      this.knock(kx * KNOCKBACK * weight, KNOCK_LIFT * weight, kz * KNOCKBACK * weight);
    }
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathTime = 0;
      this.fuse = 0;
      return;
    }
    if (this.tamed) return;
    // Passive animals bolt; anything else turns on you.
    if (this.def.temper === 'passive') {
      this.state = 'flee';
      this.stateTimer = 3 + Math.random() * 2;
    } else if (!(this.lastAttacker instanceof Mob)) {
      // Provoked by you (or by a blast, an arrow); a scuffle with another
      // mob is not a reason to come after the player.
      this.angered = true;
      this.state = 'chase';
    }
    // An enderman blinks a short distance away each time it is struck.
    if (this.def.teleports) this.blink();
  }

  /** Adds velocity: a blow, a blast. */
  knock(vx: number, vy: number, vz: number): void {
    this.vx += vx;
    this.vz += vz;
    if (vy > 0) {
      this.vy = Math.max(this.vy, vy);
      this.onGround = false;
    }
  }

  /** Jumps a short random distance, keeping the current altitude. */
  private blink(): void {
    const angle = Math.random() * Math.PI * 2;
    const distance = 4 + Math.random() * 6;
    this.x += Math.cos(angle) * distance;
    this.z += Math.sin(angle) * distance;
  }

  /** Hits another mob, the way a wolf bites, settling drops through the game if one is running. */
  strike(victim: Mob, amount: number): void {
    const g = game();
    striker = this;
    try {
      if (g) g.hurtMob(victim, amount, this.x, this.z);
      else victim.hurt(amount, this.x, this.z);
    } finally {
      striker = null;
    }
    this.attackAnim = 1;
  }

  update(
    dt: number, world: ClientWorld,
    player: { x: number; y: number; z: number },
    random: () => number,
    env: MobEnv = DEFAULT_ENV,
  ): void {
    if (this.gone) return;
    this.age += dt;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt * 3);
    this.squash = Math.max(0, this.squash - dt * 4);
    this.yOffset *= Math.exp(-dt * 14);
    if (Math.abs(this.yOffset) < 1e-3) this.yOffset = 0;

    if (this.dead) {
      // A corpse falls and slides to a stop, and thinks no more.
      this.deathTime += dt;
      if (!this.def.flying || this.def.boss) this.physics(dt, world, 0, 0);
      return;
    }

    this.sense(world, env);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.stateTimer -= dt;

    if (this.def.boss) {
      this.updateBoss(dt, player);
      return;
    }

    if (this.sheared) {
      this.woolTimer -= dt;
      if (this.woolTimer <= 0) this.sheared = false;
    }

    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const distance = Math.hypot(dx, dz);

    let speed = 0;
    switch (this.def.brain) {
      case 'spider': speed = this.thinkSpider(distance, dx, dz, random); break;
      case 'archer': speed = this.thinkArcher(dt, world, player, distance, dx, dz, random); break;
      case 'bomber': speed = this.thinkBomber(dt, distance, dx, dz, random); break;
      case 'slime': speed = this.thinkSlime(dt, distance, dx, dz, random); break;
      case 'wolf': speed = this.thinkWolf(dt, world, player, distance, dx, dz, random); break;
      case 'bat': speed = this.thinkBat(dt, world, env, random); break;
      case 'rabbit': speed = this.thinkRabbit(distance, dx, dz, random); break;
      case 'fish': speed = this.thinkFish(dt, world, distance, dx, dz, random); break;
      default: {
        this.think(distance, dx, dz, random);
        if (this.state === 'wander') speed = this.def.walkSpeed;
        else if (this.state === 'chase' || this.state === 'flee') speed = this.def.chaseSpeed;
      }
    }
    if (this.def.brain !== 'archer') this.moveYaw = this.yaw;
    if (this.fuse > 0) speed = 0;

    this.lookAt(dt, player, distance);

    const yawRad = (this.moveYaw * Math.PI) / 180;
    // Webs and soul sand slow mobs as they slow you.
    const drag = this.def.flying ? 1 : this.slowdown(world);
    const walkX = Math.cos(yawRad) * speed * drag;
    const walkZ = Math.sin(yawRad) * speed * drag;

    if (this.def.flying) {
      if (this.def.brain === 'ranged') {
        // Fliers hold station a little above the player rather than falling.
        if (this.hoverTarget === 0) this.hoverTarget = this.y;
        const wanted = this.state === 'chase' ? player.y + 2.5 : this.hoverTarget;
        this.vy = Math.max(-6, Math.min(6, (wanted - this.y) * 1.8));
      }
    } else if (this.def.brain === 'fish' && this.inWater) {
      // vy was set by the fish's own steering; water holds it up.
    } else {
      this.vy -= GRAVITY * dt;
      if (this.vy < -TERMINAL) this.vy = -TERMINAL;
      if (this.inWater) {
        // Land animals float and paddle rather than sinking to the bottom.
        this.vy = Math.max(-2, Math.min(2.2, this.vy + (GRAVITY + 9) * dt));
      } else if (this.kind === MobKind.Chicken && this.vy < -3) {
        this.vy = -3; // flutters down
      }
    }

    this.physics(dt, world, walkX, walkZ);

    // A spider meeting a wall while it hunts goes straight up it.
    this.climbing = false;
    if (this.def.brain === 'spider' && this.blocked && speed > 0 && this.state === 'chase') {
      this.climbing = true;
      this.vy = 3.2;
    }

    const moving = speed > 0 || Math.hypot(this.vx, this.vz) > 0.5;
    if (moving) this.phase += dt * (Math.max(speed, 1.5) * 2.2);
    else if (this.def.flying) this.phase += dt * 6;
  }

  /** Light and water where the mob is standing. */
  private sense(world: ClientWorld, env: MobEnv): void {
    const bx = Math.floor(this.x);
    const bz = Math.floor(this.z);
    let sky = 0;
    let block = 0;
    for (const oy of [0.1, Math.min(0.9, this.def.height)]) {
      const [s, b] = lightsAt(world, bx, Math.floor(this.y + oy), bz);
      sky = Math.max(sky, s);
      block = Math.max(block, b);
    }
    this.light = Math.max(0.06, falloff(sky) * env.daylight, falloff(block));
    this.dark = Math.max(env.sunlit ? sky * env.daylight : 0, block) <= DARK_LEVEL;
    const mid = world.getBlock(bx, Math.floor(this.y + this.def.height * 0.5), bz);
    this.inWater = isLiquid(mid);
  }

  /**
   * The same pace rule the player walks by: whatever the feet are in (a web)
   * or standing on (soul sand) sets the speed. A spider is at home in a web.
   */
  private slowdown(world: ClientWorld): number {
    const x = Math.floor(this.x);
    const z = Math.floor(this.z);
    const feet = world.getBlock(x, Math.floor(this.y + 0.1), z);
    if (feet === Block.Cobweb && this.def.brain === 'spider') return 1;
    const under = world.getBlock(x, Math.floor(this.y - 0.05), z);
    return Math.min(blockDef(feet).speedFactor, this.onGround ? blockDef(under).speedFactor : 1);
  }

  /** Turns the head toward a player who is close, the way animals do. */
  private lookAt(dt: number, player: { x: number; y: number; z: number }, distance: number): void {
    let wantYaw = 0;
    let wantPitch = 0;
    if (distance < 8 && this.state !== 'flee') {
      wantYaw = Math.max(-70, Math.min(70, wrapDegrees(headingTo(player.x - this.x, player.z - this.z) - this.yaw)));
      const eye = this.y + this.def.height * 0.85;
      wantPitch = Math.max(-35, Math.min(35,
        (Math.atan2(player.y + 1.5 - eye, Math.max(distance, 0.5)) * 180) / Math.PI));
    }
    const k = Math.min(1, dt * 8);
    this.headYaw += (wantYaw - this.headYaw) * k;
    this.headPitch += (wantPitch - this.headPitch) * k;
  }

  /**
   * The dragon orbits the centre of the island and swoops at the player,
   * which keeps the fight about timing your hits rather than out-running it.
   */
  private updateBoss(dt: number, player: { x: number; y: number; z: number }): void {
    const CENTRE_X = 0;
    const CENTRE_Z = 0;
    const RADIUS = 34;
    const CRUISE_Y = 88;

    // Below half health it presses the attack far more often.
    const aggression = this.health < this.def.health / 2 ? 0.55 : 0.3;
    if (this.stateTimer <= 0) {
      this.state = this.state === 'chase' ? 'wander' : (Math.random() < aggression ? 'chase' : 'wander');
      this.stateTimer = this.state === 'chase' ? 5 : 7;
    }

    let targetX: number;
    let targetY: number;
    let targetZ: number;
    if (this.state === 'chase') {
      targetX = player.x;
      targetY = player.y + 1.5;
      targetZ = player.z;
    } else {
      this.orbit += dt * 0.42;
      targetX = CENTRE_X + Math.cos(this.orbit) * RADIUS;
      targetZ = CENTRE_Z + Math.sin(this.orbit) * RADIUS;
      targetY = CRUISE_Y;
    }

    const speed = this.state === 'chase' ? this.def.chaseSpeed : this.def.walkSpeed;
    const toX = targetX - this.x;
    const toY = targetY - this.y;
    const toZ = targetZ - this.z;
    const length = Math.hypot(toX, toY, toZ) || 1;

    // Flies straight through terrain: a boss that snags on a pillar is worse
    // than one that clips.
    this.x += (toX / length) * speed * dt;
    this.y += (toY / length) * speed * dt;
    this.z += (toZ / length) * speed * dt;

    this.yaw = headingTo(toX, toZ);
    this.moveYaw = this.yaw;
    this.headPitch = Math.max(-30, Math.min(30, (Math.atan2(toY, Math.hypot(toX, toZ)) * 180) / Math.PI));
    this.phase += dt * 3.2;
    if (this.state === 'chase' && length < 6) this.attackAnim = 1;
  }

  // ------------------------------------------------------------------ brains

  /** Animals, zombies, endermen, blazes: chase if hostile, else wander and bolt. */
  private think(distance: number, dx: number, dz: number, random: () => number): void {
    // Neutrals only count as hostile once provoked.
    const hostile = this.def.temper === 'hostile' ||
      (this.def.temper === 'neutral' && this.angered);
    this.thinkWith(hostile, distance, dx, dz, random);
  }

  private thinkWith(
    hostile: boolean, distance: number, dx: number, dz: number, random: () => number,
  ): void {
    if (hostile && distance < this.def.aggroRange) {
      this.state = 'chase';
      this.yaw = headingTo(dx, dz);
      return;
    }

    if (this.state === 'flee') {
      if (this.stateTimer > 0) {
        // Face directly away from whatever hit us.
        this.yaw = headingTo(-dx, -dz);
        return;
      }
      this.state = 'idle';
      this.stateTimer = 0;
    }

    if (this.state === 'chase' || this.state === 'fuse' || this.state === 'strafe' ||
      this.state === 'follow' || this.state === 'sit') {
      this.state = 'idle';
      this.stateTimer = 0;
    }

    // Idle and wander alternate on a timer, with a new heading each time.
    if (this.stateTimer <= 0) {
      if (this.state === 'wander') {
        this.state = 'idle';
        this.stateTimer = 1 + random() * 3;
      } else {
        this.state = 'wander';
        this.stateTimer = 2 + random() * 4;
        this.yaw = random() * 360;
      }
    }
  }

  /** Neutral in daylight, a hunter in the dark -- or once you have hit it. */
  private thinkSpider(distance: number, dx: number, dz: number, random: () => number): number {
    this.thinkWith(this.angered || this.dark, distance, dx, dz, random);
    if (this.state === 'chase' || this.state === 'flee') return this.def.chaseSpeed;
    return this.state === 'wander' ? this.def.walkSpeed : 0;
  }

  /** Keeps to a ring round the player and shoots from it. */
  private thinkArcher(
    dt: number, world: ClientWorld, player: { x: number; y: number; z: number },
    distance: number, dx: number, dz: number, random: () => number,
  ): number {
    if (distance >= this.def.aggroRange) {
      this.thinkWith(false, distance, dx, dz, random);
      this.moveYaw = this.yaw;
      return this.state === 'wander' ? this.def.walkSpeed : 0;
    }
    this.state = 'chase';
    this.yaw = headingTo(dx, dz);

    let speed: number;
    if (distance > ARCHER_FAR) {
      this.moveYaw = this.yaw;
      speed = this.def.chaseSpeed;
    } else if (distance < ARCHER_NEAR) {
      // Back off while still facing you, bow up.
      this.moveYaw = this.yaw + 180;
      speed = this.def.chaseSpeed;
    } else {
      // In the comfort zone: circle, changing direction now and then.
      if (this.stateTimer <= 0) {
        this.strafeDir = random() < 0.5 ? -1 : 1;
        this.stateTimer = 1.5 + random() * 2;
      }
      this.moveYaw = this.yaw + 90 * this.strafeDir;
      speed = this.def.walkSpeed;
    }
    // Walked into a wall while backing off: try circling the other way.
    if (this.blocked) this.strafeDir = -this.strafeDir;

    this.shootTimer -= dt;
    if (this.shootTimer <= 0 && distance <= ARCHER_RANGE && this.canSee(world, player)) {
      this.shootTimer = this.def.attackCooldown + random() * 0.8;
      this.shootAt(player, distance);
    }
    return speed;
  }

  /** Looses an arrow at the player through the combat pack's projectiles. */
  private shootAt(player: { x: number; y: number; z: number }, distance: number): void {
    this.attackAnim = 1;
    const g = game();
    if (!g) return;
    const sx = this.x + Math.cos((this.yaw * Math.PI) / 180) * 0.4;
    const sy = this.y + 1.5;
    const sz = this.z + Math.sin((this.yaw * Math.PI) / 180) * 0.4;
    // Aim at the chest, a little high to allow for the drop.
    services.shoot(g, {
      x: sx, y: sy, z: sz,
      dx: player.x - sx,
      dy: player.y + 1.2 - sy + distance * 0.08,
      dz: player.z - sz,
      speed: ARROW_SPEED,
      damage: this.def.rangedAttack,
      shooter: this,
      kind: 'arrow',
    });
  }

  /** A clear straight line from the eyes to the player's chest. */
  private canSee(world: ClientWorld, player: { x: number; y: number; z: number }): boolean {
    const ox = this.x;
    const oy = this.y + this.def.height * 0.85;
    const oz = this.z;
    const tx = player.x - ox;
    const ty = player.y + 1.2 - oy;
    const tz = player.z - oz;
    const length = Math.hypot(tx, ty, tz);
    const steps = Math.ceil(length / 0.25);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (isSolid(world.getBlock(Math.floor(ox + tx * t), Math.floor(oy + ty * t), Math.floor(oz + tz * t)))) {
        return false;
      }
    }
    return true;
  }

  /** Creeps up, swells, and bursts -- unless you back away in time. */
  private thinkBomber(dt: number, distance: number, dx: number, dz: number, random: () => number): number {
    const inRange = distance <= FUSE_RANGE || (this.fuse > 0 && distance < FUSE_CANCEL);
    if (inRange) {
      this.fuse += dt;
      this.state = 'fuse';
      this.yaw = headingTo(dx, dz);
      if (this.fuse >= FUSE_TIME) this.detonate();
      return 0;
    }
    // Out of reach: the swelling goes down rather than snapping off.
    this.fuse = Math.max(0, this.fuse - dt * 1.5);
    this.thinkWith(true, distance, dx, dz, random);
    if (this.state === 'chase') return this.def.chaseSpeed;
    return this.state === 'wander' ? this.def.walkSpeed : 0;
  }

  private detonate(): void {
    // Gone before the blast, so the blast cannot kill it again and hand out
    // its drops: it blew itself up, nobody earned anything.
    this.dead = true;
    this.gone = true;
    this.health = 0;
    const g = game();
    if (g) services.explode(g, this.x, this.y + this.def.height * 0.4, this.z, BLAST_POWER);
  }

  /** Slimes do not walk: they gather themselves and hop. */
  private thinkSlime(dt: number, distance: number, dx: number, dz: number, random: () => number): number {
    this.thinkWith(true, distance, dx, dz, random);
    if (!this.onGround) return 0;
    this.hopTimer -= dt;
    if (this.hopTimer > 0) return 0;
    const moving = this.state === 'chase' || this.state === 'wander';
    this.hopTimer = (this.state === 'chase' ? 0.6 : 1.4) + random() * 0.9;
    if (!moving) return 0;
    const speed = this.state === 'chase' ? this.def.chaseSpeed : this.def.walkSpeed;
    const a = (this.yaw * Math.PI) / 180;
    this.vx = Math.cos(a) * speed * 1.4;
    this.vz = Math.sin(a) * speed * 1.4;
    this.vy = 5.5 + this.size * 0.6;
    this.onGround = false;
    return 0;
  }

  /** Wild: a neutral pack animal. Tamed: your shadow, and your muscle. */
  private thinkWolf(
    dt: number, world: ClientWorld, player: { x: number; y: number; z: number },
    distance: number, dx: number, dz: number, random: () => number,
  ): number {
    void dt;
    if (!this.tamed) {
      this.think(distance, dx, dz, random);
      if (this.state === 'chase' || this.state === 'flee') return this.def.chaseSpeed;
      return this.state === 'wander' ? this.def.walkSpeed : 0;
    }
    if (this.sitting) {
      this.state = 'sit';
      this.target = null;
      return 0;
    }

    if (this.target && (this.target.dead || this.target === this ||
      Math.hypot(this.target.x - this.x, this.target.z - this.z) > 24)) {
      this.target = null;
    }
    if (this.target) {
      const t = this.target;
      const tx = t.x - this.x;
      const tz = t.z - this.z;
      this.state = 'chase';
      this.yaw = headingTo(tx, tz);
      const reach = 0.9 + (this.def.width + t.def.width) / 2;
      if (Math.hypot(tx, tz) <= reach && Math.abs(t.y - this.y) < 2) {
        if (this.attackTimer <= 0) {
          this.attackTimer = this.def.attackCooldown;
          this.strike(t, this.def.attack);
        }
        return 0;
      }
      return this.def.chaseSpeed;
    }

    if (distance > WOLF_TELEPORT) {
      // Lost you: turn up at your heels, as long as there is room there.
      for (const [ox, oz] of [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]]) {
        const nx = player.x + ox;
        const nz = player.z + oz;
        if (!this.overlapsAt(world, nx, player.y, nz)) {
          this.x = nx;
          this.y = player.y;
          this.z = nz;
          this.vx = 0;
          this.vz = 0;
          this.vy = 0;
          break;
        }
      }
      this.state = 'idle';
      return 0;
    }
    if (distance > FOLLOW_START) {
      this.state = 'follow';
      this.yaw = headingTo(dx, dz);
      return this.def.chaseSpeed * (distance > 8 ? 1 : 0.7);
    }
    this.state = 'idle';
    return 0;
  }

  /** Erratic flight in the dark; out of the light as fast as it can. */
  private thinkBat(dt: number, world: ClientWorld, env: MobEnv, random: () => number): number {
    const bx = Math.floor(this.x);
    const by = Math.floor(this.y + 0.4);
    const bz = Math.floor(this.z);
    const here = effectiveLight(world, bx, by, bz, env);

    if (this.stateTimer <= 0) {
      this.stateTimer = 0.4 + random() * 0.8;
      if (here > DARK_LEVEL) {
        // Try eight headings a few blocks out and take the darkest.
        let best = this.yaw;
        let bestLight = Infinity;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * 360 + random() * 20;
          const r = (a * Math.PI) / 180;
          const l = effectiveLight(world,
            Math.floor(this.x + Math.cos(r) * 4), by, Math.floor(this.z + Math.sin(r) * 4), env);
          if (l < bestLight) {
            bestLight = l;
            best = a;
          }
        }
        this.yaw = best;
        this.state = 'flee';
      } else {
        this.yaw += (random() - 0.5) * 200;
        this.state = 'wander';
      }
      this.hoverTarget = this.y + (random() - 0.5) * 2.4;
    }
    // Keep off the floor, and never straight up into the open sky.
    const below = world.getBlock(bx, Math.floor(this.y - 1.2), bz);
    if (isSolid(below)) this.hoverTarget = Math.max(this.hoverTarget, Math.floor(this.y - 1.2) + 2.3);
    this.vy += (Math.max(-3, Math.min(3, (this.hoverTarget - this.y) * 3)) - this.vy) * Math.min(1, dt * 5);
    if (this.blocked) this.yaw += 150;
    return this.state === 'flee' ? this.def.chaseSpeed : this.def.walkSpeed;
  }

  /** Hops about; runs from you if you come close. */
  private thinkRabbit(distance: number, dx: number, dz: number, random: () => number): number {
    if (distance < 6 && this.state !== 'flee') {
      this.state = 'flee';
      this.stateTimer = 2 + random() * 1.5;
    }
    this.thinkWith(false, distance, dx, dz, random);
    const speed = this.state === 'flee' ? this.def.chaseSpeed
      : this.state === 'wander' ? this.def.walkSpeed : 0;
    // A rabbit moves in bounces, not strides.
    if (speed > 0 && this.onGround && !this.inWater) {
      this.vy = this.state === 'flee' ? 5.2 : 4.2;
      this.onGround = false;
    }
    return speed;
  }

  /** Swims in water and darts from you; out of it, flops and suffocates. */
  private thinkFish(
    dt: number, world: ClientWorld, distance: number, dx: number, dz: number, random: () => number,
  ): number {
    if (!this.inWater) {
      this.state = 'idle';
      this.dryTimer -= dt;
      if (this.dryTimer <= 0) {
        this.dryTimer = 1;
        const g = game();
        if (g) g.hurtMob(this, 1);
        else this.hurt(1);
      }
      if (this.onGround && random() < dt * 3) {
        // Flop.
        this.vy = 3 + random() * 2;
        this.vx = (random() - 0.5) * 3;
        this.vz = (random() - 0.5) * 3;
        this.yaw = random() * 360;
        this.onGround = false;
      }
      return 0;
    }
    this.dryTimer = 1;

    if (distance < 4 && this.state !== 'flee') {
      this.state = 'flee';
      this.stateTimer = 1.2 + random();
    }
    if (this.state === 'flee' && this.stateTimer > 0) {
      this.yaw = headingTo(-dx, -dz);
    } else if (this.stateTimer <= 0) {
      this.state = random() < 0.7 ? 'wander' : 'idle';
      this.stateTimer = 1 + random() * 2.5;
      this.yaw = random() * 360;
      this.hoverTarget = this.y + (random() - 0.5) * 1.5;
    }

    // Keep to the water: turn back from the bank, sink from the surface.
    const a = (this.yaw * Math.PI) / 180;
    const ahead = world.getBlock(
      Math.floor(this.x + Math.cos(a) * 0.7), Math.floor(this.y + 0.2), Math.floor(this.z + Math.sin(a) * 0.7));
    if (!isLiquid(ahead)) this.yaw += 180;
    const above = world.getBlock(Math.floor(this.x), Math.floor(this.y + this.def.height + 0.15), Math.floor(this.z));
    if (!isLiquid(above)) this.hoverTarget = Math.min(this.hoverTarget, this.y - 0.3);
    this.vy = Math.max(-1.5, Math.min(1.5, (this.hoverTarget - this.y) * 2));

    if (this.state === 'flee') return this.def.chaseSpeed;
    return this.state === 'wander' ? this.def.walkSpeed : 0;
  }

  /** Damage dealt this frame, if in range and off cooldown. */
  tryAttack(playerX: number, playerY: number, playerZ: number): number {
    if (this.dead || this.attackTimer > 0) return 0;
    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const dz = playerZ - this.z;

    // A blaze throws from a distance. (A skeleton's arrows are real
    // projectiles, fired from its brain, so they are not counted here.)
    if (this.def.brain === 'ranged') {
      const range = this.def.aggroRange * 0.75;
      if (dx * dx + dy * dy + dz * dz > range * range) return 0;
      this.attackTimer = this.def.attackCooldown;
      this.attackAnim = 1;
      return this.def.rangedAttack;
    }

    if (this.def.attack <= 0) return 0;
    const reach = 1.2 + this.def.width;
    if (dx * dx + dz * dz > reach * reach || Math.abs(dy) > 2 + this.def.height) return 0;
    this.attackTimer = this.def.attackCooldown;
    this.attackAnim = 1;
    return this.def.attack;
  }

  // --------------------------------------------------------------- movement

  /** Pushes the body sideways through the collision code: a crowd jostling. */
  shove(world: ClientWorld, dx: number, dz: number): void {
    const blocked = this.blocked;
    this.move(world, dx, 0, dz);
    this.blocked = blocked;
  }

  /** Moves by walk velocity plus knockback, then lets knockback die away. */
  private physics(dt: number, world: ClientWorld, walkX: number, walkZ: number): void {
    this.blocked = false;
    this.move(world, (walkX + this.vx) * dt, this.vy * dt, (walkZ + this.vz) * dt);
    // Ground friction kills a shove quickly; in the air it carries.
    const friction = this.onGround ? 10 : this.inWater ? 3 : 0.6;
    const keep = Math.exp(-dt * friction);
    this.vx *= keep;
    this.vz *= keep;
    if (Math.abs(this.vx) < 1e-3) this.vx = 0;
    if (Math.abs(this.vz) < 1e-3) this.vz = 0;
  }

  private move(world: ClientWorld, dx: number, dy: number, dz: number): void {
    const longest = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.min(16, Math.max(1, Math.ceil(longest / MAX_STEP)));
    for (let i = 0; i < steps; i++) {
      this.step(world, dx / steps, dy / steps, dz / steps);
    }
  }

  private step(world: ClientWorld, dx: number, dy: number, dz: number): void {
    const wasOnGround = this.onGround;
    this.x += dx;
    if (this.resolve(world, 0, dx) && !this.tryStepUp(world, 0, dx, wasOnGround)) this.blocked = true;
    this.z += dz;
    if (this.resolve(world, 2, dz) && !this.tryStepUp(world, 2, dz, wasOnGround)) this.blocked = true;

    this.y += dy;
    const hitY = this.resolve(world, 1, dy);
    if (hitY) {
      if (dy < 0) {
        if (!this.onGround && this.vy < -4) this.squash = 1;
        this.onGround = true;
      }
      this.vy = 0;
    } else if (dy !== 0) {
      this.onGround = false;
    }
  }

  /**
   * Walks up a ledge instead of stopping at it -- a slab, a stair, a block --
   * but never one taller than STEP_UP, which is what keeps a fence a fence.
   */
  private tryStepUp(world: ClientWorld, axis: 0 | 2, delta: number, grounded: boolean): boolean {
    if (!grounded || delta === 0 || this.def.flying) return false;
    const rise = this.ledgeHeight(world, axis, delta);
    if (rise === null || rise <= 0 || rise > STEP_UP) return false;

    const savedX = this.x;
    const savedY = this.y;
    const savedZ = this.z;
    this.y = savedY + rise;
    if (axis === 0) this.x = savedX + (delta > 0 ? STEP_PROBE : -STEP_PROBE);
    else this.z = savedZ + (delta > 0 ? STEP_PROBE : -STEP_PROBE);
    // Only if the body fits up there: stepping into a one-block gap under a
    // ceiling would leave the mob stuck in it.
    if (this.overlapsAt(world, this.x, this.y, this.z)) {
      this.x = savedX;
      this.y = savedY;
      this.z = savedZ;
      return false;
    }
    this.yOffset -= rise;
    return true;
  }

  /** How far above the feet the blocking ledge ahead tops out, or null. */
  private ledgeHeight(world: ClientWorld, axis: 0 | 2, delta: number): number | null {
    const probe = this.def.width / 2 - SKIN;
    const ahead = delta > 0 ? probe + STEP_PROBE : -probe - STEP_PROBE;
    // The strip just ahead of the leading face, across the whole body width.
    const lo = [this.x - probe, this.z - probe];
    const hi = [this.x + probe, this.z + probe];
    if (axis === 0) { lo[0] = hi[0] = this.x + ahead; } else { lo[1] = hi[1] = this.z + ahead; }

    let top: number | null = null;
    for (let bx = Math.floor(lo[0]); bx <= Math.floor(hi[0]); bx++) {
      for (let bz = Math.floor(lo[1]); bz <= Math.floor(hi[1]); bz++) {
        for (let by = Math.floor(this.y) - 1; by <= Math.floor(this.y + STEP_UP); by++) {
          const id = world.getBlock(bx, by, bz);
          if (!isSolid(id)) continue;
          for (const box of collisionBoxesAt(world, id, bx, by, bz)) {
            if (bx + box.x1 < lo[0] || bx + box.x0 > hi[0] || bz + box.z1 < lo[1] || bz + box.z0 > hi[1]) continue;
            const boxTop = by + box.y1;
            if (boxTop <= this.y + SKIN) continue;
            if (top === null || boxTop > top) top = boxTop;
          }
        }
      }
    }
    return top === null ? null : top - this.y;
  }

  private resolve(world: ClientWorld, axis: 0 | 1 | 2, delta: number): boolean {
    if (delta === 0) return false;
    const half = this.def.width / 2;
    const probe = half - SKIN;
    const lo = [this.x - probe, this.y + SKIN, this.z - probe];
    const hi = [this.x + probe, this.y + this.def.height - SKIN, this.z + probe];

    let found = false;
    let edge = 0;
    // One cell lower than the body reaches: a fence's collision stands half
    // a block above its own cell, into the cell the body is in.
    for (let bx = Math.floor(lo[0]); bx <= Math.floor(hi[0]); bx++) {
      for (let by = Math.floor(lo[1]) - 1; by <= Math.min(Math.floor(hi[1]), WORLD_Y - 1); by++) {
        for (let bz = Math.floor(lo[2]); bz <= Math.floor(hi[2]); bz++) {
          const id = world.getBlock(bx, by, bz);
          if (!isSolid(id)) continue;
          for (const box of collisionBoxesAt(world, id, bx, by, bz)) {
            const bLo = [bx + box.x0, by + box.y0, bz + box.z0];
            const bHi = [bx + box.x1, by + box.y1, bz + box.z1];
            let clear = false;
            for (let a = 0; a < 3; a++) {
              if (bHi[a] <= lo[a] || bLo[a] >= hi[a]) { clear = true; break; }
            }
            if (clear) continue;
            // The face this box presents to the incoming body; keep the
            // nearest, or a thick wall snaps the body to its far side.
            const candidate = delta > 0 ? bLo[axis] : bHi[axis];
            if (!found) {
              found = true;
              edge = candidate;
            } else if (delta > 0 ? candidate < edge : candidate > edge) {
              edge = candidate;
            }
          }
        }
      }
    }
    if (!found) return false;

    if (axis === 0) this.x = delta < 0 ? edge + half : edge - half;
    else if (axis === 1) this.y = delta < 0 ? edge : edge - this.def.height;
    else this.z = delta < 0 ? edge + half : edge - half;
    return true;
  }

  /** Would the body overlap any solid shape standing here? */
  overlapsAt(world: ClientWorld, x: number, y: number, z: number): boolean {
    const probe = this.def.width / 2 - SKIN;
    const lo = [x - probe, y + SKIN, z - probe];
    const hi = [x + probe, y + this.def.height - SKIN, z + probe];
    for (let bx = Math.floor(lo[0]); bx <= Math.floor(hi[0]); bx++) {
      for (let by = Math.floor(lo[1]) - 1; by <= Math.min(Math.floor(hi[1]), WORLD_Y - 1); by++) {
        for (let bz = Math.floor(lo[2]); bz <= Math.floor(hi[2]); bz++) {
          const id = world.getBlock(bx, by, bz);
          if (!isSolid(id)) continue;
          for (const box of collisionBoxesAt(world, id, bx, by, bz)) {
            if (bx + box.x0 < hi[0] && bx + box.x1 > lo[0] &&
              by + box.y0 < hi[1] && by + box.y1 > lo[1] &&
              bz + box.z0 < hi[2] && bz + box.z1 > lo[2]) return true;
          }
        }
      }
    }
    return false;
  }

  /** Ray-vs-box, for working out which mob the player is looking at. Corpses are not targets. */
  hitByRay(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number, maxDist: number,
  ): number | null {
    if (this.dead) return null;
    const half = this.def.width / 2;
    let tMin = 0;
    let tMax = maxDist;
    const slab = (origin: number, dir: number, lo: number, hi: number): boolean => {
      if (Math.abs(dir) < 1e-8) return origin >= lo && origin <= hi;
      const t1 = (lo - origin) / dir;
      const t2 = (hi - origin) / dir;
      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
      return tMax >= tMin;
    };
    if (!slab(ox, dx, this.x - half, this.x + half)) return null;
    if (!slab(oy, dy, this.y, this.y + this.def.height)) return null;
    if (!slab(oz, dz, this.z - half, this.z + half)) return null;
    return tMin;
  }
}

// ------------------------------------------------------------------- world

/** Mobs are only simulated and kept within this distance of the player. */
const KEEP_RADIUS = 72;
const SPAWN_MIN = 24;
const SPAWN_MAX = 52;
const GROUPS: SpawnGroup[] = ['creature', 'monster', 'ambient', 'water'];

export class MobWorld {
  readonly mobs: Mob[] = [];
  private spawnTimer = 0;
  /**
   * How lit the sky is, 0 (midnight) to 1 (noon). main.ts sets it from the
   * day/night cycle each frame; it decides where monsters may spawn and how
   * brightly mobs are drawn out in the open.
   */
  daylight = 1;

  constructor(private dimension: Dimension) {}

  setDimension(dim: Dimension): void {
    this.dimension = dim;
    this.mobs.length = 0;
  }

  get env(): MobEnv {
    return { daylight: this.daylight, sunlit: this.dimension === Dimension.Overworld };
  }

  spawn(kind: MobKind, x: number, y: number, z: number): Mob {
    const mob = new Mob(kind, x, y, z, Math.random() * 360);
    this.mobs.push(mob);
    return mob;
  }

  remove(mob: Mob): void {
    const i = this.mobs.indexOf(mob);
    if (i >= 0) this.mobs.splice(i, 1);
  }

  /** The live boss, if one is present. Drives the boss health bar. */
  get boss(): Mob | null {
    return this.mobs.find((m) => m.def.boss && !m.dead) ?? null;
  }

  has(kind: MobKind): boolean {
    return this.mobs.some((m) => m.kind === kind && !m.dead);
  }

  /** Nearest living mob along the view ray. */
  pick(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number, maxDist = 4,
  ): Mob | null {
    let best: Mob | null = null;
    let bestT = Infinity;
    for (const mob of this.mobs) {
      if (mob.dead) continue;
      const t = mob.hitByRay(ox, oy, oz, dx, dy, dz, maxDist);
      if (t !== null && t < bestT) {
        bestT = t;
        best = mob;
      }
    }
    return best;
  }

  /**
   * Advances every mob, spawns new ones and despawns distant ones.
   * Returns the total damage mobs dealt to the player this frame.
   */
  update(
    dt: number, world: ClientWorld,
    player: { x: number; y: number; z: number },
    random: () => number = Math.random,
  ): number {
    let damage = 0;
    const env = this.env;
    let aggressor: Mob | null = null;

    for (let i = 0; i < this.mobs.length; i++) {
      const mob = this.mobs[i];
      // Nothing moves where the world has not loaded: it would fall forever.
      if (!mob.dead && !world.isLoaded(Math.floor(mob.x), Math.floor(mob.z))) continue;
      mob.update(dt, world, player, random, env);
      if (mob.aggressive) {
        const bite = mob.tryAttack(player.x, player.y, player.z);
        if (bite > 0) {
          damage += bite;
          aggressor = mob;
        }
      }
    }

    this.afterUpdate(world, aggressor);
    this.separate(dt, world);

    // Drop anything dead or far away. A boss stays until it is beaten; a
    // corpse stays until it has finished falling over.
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      if (mob.def.boss) {
        if (mob.dead) this.mobs.splice(i, 1);
        continue;
      }
      const far = !mob.tamed && Math.hypot(mob.x - player.x, mob.z - player.z) > KEEP_RADIUS;
      const finished = mob.dead && (mob.gone || mob.deathTime >= DEATH_TIME);
      if (finished || far || mob.y < -8) this.mobs.splice(i, 1);
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2;
      this.trySpawn(world, player, random);
    }
    return damage;
  }

  /** Splits, and who the tamed wolves should be fighting. */
  private afterUpdate(world: ClientWorld, aggressor: Mob | null): void {
    let playerTarget: Mob | null = null;
    const hurtByPlayer: Mob[] = [];
    for (const mob of this.mobs) {
      if (mob.dead && !mob.settled) {
        mob.settled = true;
        if (!mob.gone) this.split(mob, world);
      }
      if (!mob.freshHurt) continue;
      mob.freshHurt = false;
      if (mob.lastAttacker === 'player') {
        hurtByPlayer.push(mob);
        if (!mob.dead && !mob.tamed) playerTarget = mob;
      }
    }

    // Strike one wolf and the pack comes for you.
    for (const hurt of hurtByPlayer) {
      if (hurt.def.brain !== 'wolf' || hurt.tamed) continue;
      for (const other of this.mobs) {
        if (other.def.brain === 'wolf' && !other.tamed && !other.dead &&
          Math.hypot(other.x - hurt.x, other.z - hurt.z) < 16) {
          other.angered = true;
        }
      }
    }

    const foe = aggressor && !aggressor.tamed ? aggressor : playerTarget;
    if (!foe) return;
    for (const wolf of this.mobs) {
      if (!wolf.tamed || wolf.sitting || wolf.dead || wolf === foe) continue;
      if (!wolf.target || wolf.target.dead) wolf.target = foe;
    }
  }

  /** A slime breaks into smaller slimes where it died. */
  private split(mob: Mob, world: ClientWorld): void {
    const into = mob.def.splitsInto;
    if (into === null) return;
    const spread = mob.def.width * 0.25;
    for (let i = 0; i < mob.def.splitCount; i++) {
      const a = (i / mob.def.splitCount) * Math.PI * 2 + mob.yaw;
      let x = mob.x + Math.cos(a) * spread;
      let z = mob.z + Math.sin(a) * spread;
      const child = new Mob(into, x, mob.y, z, mob.yaw + i * 90);
      if (child.overlapsAt(world, x, mob.y, z)) {
        x = mob.x;
        z = mob.z;
        child.x = x;
        child.z = z;
      }
      child.angered = true;
      child.knock(Math.cos(a) * 2.5, 4, Math.sin(a) * 2.5);
      this.mobs.push(child);
    }
  }

  /**
   * Keeps living bodies from standing inside one another. Moves go through
   * the collision code, so a crowd can push a mob along but never into a wall.
   */
  private separate(dt: number, world: ClientWorld): void {
    const push = Math.min(1, dt * 6);
    for (let i = 0; i < this.mobs.length; i++) {
      const a = this.mobs[i];
      if (a.dead || a.def.flying || a.def.boss) continue;
      for (let j = i + 1; j < this.mobs.length; j++) {
        const b = this.mobs[j];
        if (b.dead || b.def.flying || b.def.boss) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const reach = (a.def.width + b.def.width) / 2;
        if (Math.abs(dx) >= reach || Math.abs(dz) >= reach) continue;
        if (a.y >= b.y + b.def.height || b.y >= a.y + a.def.height) continue;
        const d = Math.hypot(dx, dz);
        const nx = d > 1e-4 ? dx / d : 1;
        const nz = d > 1e-4 ? dz / d : 0;
        const overlap = (reach - d) * 0.5 * push;
        a.shove(world, -nx * overlap, -nz * overlap);
        b.shove(world, nx * overlap, nz * overlap);
      }
    }
  }

  private count(group: SpawnGroup): number {
    let n = 0;
    for (const mob of this.mobs) {
      if (!mob.dead && !mob.tamed && mob.def.spawn.group === group) n++;
    }
    return n;
  }

  private trySpawn(
    world: ClientWorld,
    player: { x: number; y: number; z: number },
    random: () => number,
  ): void {
    for (const group of GROUPS) {
      if (this.count(group) >= SPAWN_CAPS[group]) continue;
      const candidates = spawnGroupIn(this.dimension, group);
      if (candidates.length === 0) continue;

      // Weighted pick: wolves are rarer than rabbits.
      let total = 0;
      for (const d of candidates) total += d.spawn.weight;
      let roll = random() * total;
      let def = candidates[candidates.length - 1];
      for (const d of candidates) {
        roll -= d.spawn.weight;
        if (roll < 0) { def = d; break; }
      }

      // A ring around the player: close enough to matter, far enough not to
      // appear in front of them.
      const angle = random() * Math.PI * 2;
      const radius = SPAWN_MIN + random() * (SPAWN_MAX - SPAWN_MIN);
      const cx = Math.floor(player.x + Math.cos(angle) * radius);
      const cz = Math.floor(player.z + Math.sin(angle) * radius);
      if (!world.isLoaded(cx, cz)) continue;

      const [lo, hi] = def.spawn.pack;
      const count = lo + Math.floor(random() * (hi - lo + 1));
      const room = SPAWN_CAPS[group] - this.count(group);
      for (let n = 0; n < Math.min(count, room); n++) {
        // The pack spreads over a few neighbouring columns.
        const x = cx + (n === 0 ? 0 : Math.floor(random() * 5) - 2);
        const z = cz + (n === 0 ? 0 : Math.floor(random() * 5) - 2);
        const y = findSpawnSpot(world, x, z, def, this.env, random);
        if (y === null) continue;
        const mob = new Mob(def.kind, x + 0.5, y, z + 0.5, random() * 360);
        if (mob.overlapsAt(world, mob.x, mob.y, mob.z)) continue;
        this.mobs.push(mob);
      }
    }
  }
}

/**
 * A height in the column at (x, z) where this mob may naturally appear, or
 * null. Every suitable height is collected and one chosen at random, so a
 * monster can turn up in a cave as readily as out on a dark hillside.
 *
 * The body must be in open space -- air, or something you can walk through
 * like tall grass or a flower, never a liquid (except for a fish) or a
 * solid block.
 */
export function findSpawnSpot(
  world: ClientWorld, x: number, z: number, def: MobDef, env: MobEnv, random: () => number,
): number | null {
  const place = def.spawn.place;
  if (place === 'never') return null;
  const spots: number[] = [];
  const cells = Math.max(1, Math.ceil(def.height));

  if (place === 'water') {
    for (let y = WORLD_Y - 2; y > 1; y--) {
      if (world.getBlock(x, y, z) !== Block.Water) continue;
      const above = world.getBlock(x, y + 1, z);
      if (above !== Block.Water && above !== Block.Air) continue;
      spots.push(y + 0.3);
    }
    return spots.length ? spots[Math.floor(random() * spots.length)] : null;
  }

  for (let y = WORLD_Y - 2; y > 2; y--) {
    const ground = world.getBlock(x, y - 1, z);
    if (!isSolid(ground) || isLiquid(ground)) continue;
    // Something to stand on across the whole top: not a slab, not a post.
    let top = 0;
    for (const box of collisionBoxesAt(world, ground, x, y - 1, z)) top = Math.max(top, box.y1);
    if (top < 0.99) continue;
    if (def.spawnSurface !== null && !def.spawnSurface.includes(ground)) continue;

    let clear = true;
    const extra = place === 'cave' ? 1 : 0;
    for (let h = 0; h < cells + extra; h++) {
      const id = world.getBlock(x, y + h, z);
      if (isSolid(id) || isLiquid(id)) { clear = false; break; }
    }
    if (!clear) continue;

    const [sky] = lightsAt(world, x, y, z);
    const level = effectiveLight(world, x, y, z, env);
    if (place === 'surface' && sky < 0.5) continue;
    if (place === 'dark' && level > DARK_LEVEL) continue;
    if (place === 'cave' && (sky > 0.3 || level > DARK_LEVEL || y > 62)) continue;
    spots.push(place === 'cave' ? y + 1 : y);
  }
  return spots.length ? spots[Math.floor(random() * spots.length)] : null;
}
