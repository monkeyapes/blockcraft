/**
 * Living mobs: physics, AI and spawning.
 *
 * Kept deliberately close to the player's own movement code -- sub-stepped
 * collision with a skin, so nothing tunnels through walls or climbs them.
 */

import { isLiquid, isSolid } from '@shared/blocks.js';
import { Dimension, WORLD_Y } from '@shared/constants.js';
import { MobKind, mobDef, spawnableIn, type MobDef } from '@shared/mobs.js';
import type { ClientWorld } from './world.js';

const GRAVITY = 26;
const TERMINAL = 50;
const MAX_STEP = 0.3;
const SKIN = 1e-4;
/** How high a mob will walk up without needing to jump. */
const STEP_UP = 1.05;

export type MobState = 'idle' | 'wander' | 'flee' | 'chase';

let nextId = 1;

export class Mob {
  readonly id = nextId++;
  readonly def: MobDef;

  x: number;
  y: number;
  z: number;
  yaw: number;
  vy = 0;
  onGround = false;

  health: number;
  state: MobState = 'idle';
  /** Seconds left in the current AI state. */
  private stateTimer = 0;
  private attackTimer = 0;
  /** Walk-cycle phase for the model. */
  phase = 0;
  /** Set for a moment after taking a hit, so the model can flash. */
  hurtTimer = 0;
  dead = false;
  /** Neutral mobs stay calm until provoked, then never forget. */
  angered = false;
  /** Boss circling angle, and the altitude it wants to hold. */
  private orbit = Math.random() * Math.PI * 2;
  private hoverTarget = 0;

  constructor(kind: MobKind, x: number, y: number, z: number, yaw = 0) {
    this.def = mobDef(kind);
    this.health = this.def.health;
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
  }

  get kind(): MobKind {
    return this.def.kind;
  }

  /** Centre of the body, used for targeting and distance checks. */
  get centre(): [number, number, number] {
    return [this.x, this.y + this.def.height / 2, this.z];
  }

  hurt(amount: number): void {
    if (this.dead) return;
    this.health -= amount;
    this.hurtTimer = 0.3;
    if (this.health <= 0) {
      this.dead = true;
      return;
    }
    // Passive animals bolt; anything else turns on you.
    if (this.def.temper === 'passive') {
      this.state = 'flee';
      this.stateTimer = 3 + Math.random() * 2;
    } else {
      this.angered = true;
      this.state = 'chase';
    }
    // An enderman blinks a short distance away each time it is struck.
    if (this.def.teleports) this.blink();
  }

  /** Jumps a short random distance, keeping the current altitude. */
  private blink(): void {
    const angle = Math.random() * Math.PI * 2;
    const distance = 4 + Math.random() * 6;
    this.x += Math.cos(angle) * distance;
    this.z += Math.sin(angle) * distance;
  }

  update(
    dt: number, world: ClientWorld,
    player: { x: number; y: number; z: number },
    random: () => number,
  ): void {
    if (this.dead) return;

    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.stateTimer -= dt;

    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const distance = Math.hypot(dx, dz);

    if (this.def.boss) {
      this.updateBoss(dt, world, player);
      return;
    }

    this.think(dt, distance, dx, dz, random);

    let speed = 0;
    if (this.state === 'wander') speed = this.def.walkSpeed;
    else if (this.state === 'chase') speed = this.def.chaseSpeed;
    else if (this.state === 'flee') speed = this.def.chaseSpeed;

    const yawRad = (this.yaw * Math.PI) / 180;
    const moveX = Math.cos(yawRad) * speed * dt;
    const moveZ = Math.sin(yawRad) * speed * dt;

    if (this.def.flying) {
      // Fliers hold station a little above the player rather than falling.
      if (this.hoverTarget === 0) this.hoverTarget = this.y;
      const wanted = this.state === 'chase' ? player.y + 2.5 : this.hoverTarget;
      this.vy = (wanted - this.y) * 1.8;
      this.vy = Math.max(-6, Math.min(6, this.vy));
    } else {
      this.vy -= GRAVITY * dt;
      if (this.vy < -TERMINAL) this.vy = -TERMINAL;
    }

    this.move(world, moveX, this.vy * dt, moveZ);

    if (speed > 0) this.phase += dt * (speed * 2.2);
  }

  /**
   * The dragon orbits the centre of the island and swoops at the player,
   * which keeps the fight about timing your hits rather than out-running it.
   */
  private updateBoss(
    dt: number, world: ClientWorld, player: { x: number; y: number; z: number },
  ): void {
    const CENTRE_X = 0;
    const CENTRE_Z = 0;
    const RADIUS = 34;
    const CRUISE_Y = 88;

    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const distance = Math.hypot(dx, dz);

    // Below half health it presses the attack far more often.
    const aggression = this.health < this.def.health / 2 ? 0.55 : 0.3;
    this.stateTimer -= dt;
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

    this.yaw = (Math.atan2(toZ, toX) * 180) / Math.PI;
    this.phase += dt * 3.2;
    void world;
    void distance;
  }

  /** Chooses a state and a heading. */
  private think(
    dt: number, distance: number, dx: number, dz: number, random: () => number,
  ): void {
    void dt;
    // Neutrals only count as hostile once provoked.
    const hostile = this.def.temper === 'hostile' ||
      (this.def.temper === 'neutral' && this.angered);

    if (hostile && distance < this.def.aggroRange) {
      this.state = 'chase';
      this.yaw = (Math.atan2(dz, dx) * 180) / Math.PI;
      return;
    }

    if (this.state === 'flee') {
      if (this.stateTimer > 0) {
        // Face directly away from whatever hit us.
        this.yaw = (Math.atan2(-dz, -dx) * 180) / Math.PI;
        return;
      }
      this.state = 'idle';
      this.stateTimer = 0;
    }

    if (this.state === 'chase' && (!hostile || distance >= this.def.aggroRange)) {
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

  /** Damage dealt this frame, if in range and off cooldown. */
  tryAttack(playerX: number, playerY: number, playerZ: number): number {
    if (this.dead || this.attackTimer > 0) return 0;
    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const dz = playerZ - this.z;

    // Ranged attackers throw from a distance; everything else needs contact.
    if (this.def.rangedAttack > 0) {
      const range = this.def.aggroRange * 0.75;
      if (dx * dx + dy * dy + dz * dz > range * range) return 0;
      this.attackTimer = this.def.attackCooldown;
      return this.def.rangedAttack;
    }

    if (this.def.attack <= 0) return 0;
    const reach = 1.2 + this.def.width;
    if (dx * dx + dz * dz > reach * reach || Math.abs(dy) > 2 + this.def.height) return 0;
    this.attackTimer = this.def.attackCooldown;
    return this.def.attack;
  }

  // --------------------------------------------------------------- movement

  private move(world: ClientWorld, dx: number, dy: number, dz: number): void {
    const longest = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.min(16, Math.max(1, Math.ceil(longest / MAX_STEP)));
    for (let i = 0; i < steps; i++) {
      this.step(world, dx / steps, dy / steps, dz / steps);
    }
  }

  private step(world: ClientWorld, dx: number, dy: number, dz: number): void {
    const beforeX = this.x;
    const beforeZ = this.z;

    this.x += dx;
    const hitX = this.resolve(world, 0, dx);
    this.z += dz;
    const hitZ = this.resolve(world, 2, dz);

    // Walked into a step: lift over it rather than stopping dead. Without
    // this, animals get permanently stuck on a single block of terrain.
    if ((hitX || hitZ) && this.onGround) {
      const lifted = this.y + STEP_UP;
      if (!this.overlaps(world, this.x + (hitX ? dx : 0), lifted, this.z + (hitZ ? dz : 0))) {
        this.y = lifted;
        if (hitX) this.x = beforeX + dx * 2;
        if (hitZ) this.z = beforeZ + dz * 2;
      }
    }

    this.y += dy;
    const hitY = this.resolve(world, 1, dy);
    if (hitY) {
      if (dy < 0) this.onGround = true;
      this.vy = 0;
    } else if (dy !== 0) {
      this.onGround = false;
    }
  }

  private resolve(world: ClientWorld, axis: 0 | 1 | 2, delta: number): boolean {
    if (delta === 0) return false;
    const half = this.def.width / 2;
    const probe = half - SKIN;
    const x0 = Math.floor(this.x - probe);
    const x1 = Math.floor(this.x + probe);
    const y0 = Math.floor(this.y + SKIN);
    const y1 = Math.min(Math.floor(this.y + this.def.height - SKIN), WORLD_Y - 1);
    const z0 = Math.floor(this.z - probe);
    const z1 = Math.floor(this.z + probe);

    let found = false;
    let edge = 0;
    for (let bx = x0; bx <= x1; bx++) {
      for (let by = y0; by <= y1; by++) {
        for (let bz = z0; bz <= z1; bz++) {
          if (!isSolid(world.getBlock(bx, by, bz))) continue;
          const candidate = axis === 0 ? bx : axis === 1 ? by : bz;
          if (!found) {
            found = true;
            edge = candidate;
          } else if (delta > 0) {
            if (candidate < edge) edge = candidate;
          } else if (candidate > edge) {
            edge = candidate;
          }
        }
      }
    }
    if (!found) return false;

    if (axis === 0) this.x = delta < 0 ? edge + 1 + half : edge - half;
    else if (axis === 1) this.y = delta < 0 ? edge + 1 : edge - this.def.height;
    else this.z = delta < 0 ? edge + 1 + half : edge - half;
    return true;
  }

  private overlaps(world: ClientWorld, x: number, y: number, z: number): boolean {
    const probe = this.def.width / 2 - SKIN;
    for (let bx = Math.floor(x - probe); bx <= Math.floor(x + probe); bx++) {
      for (let by = Math.floor(y + SKIN);
        by <= Math.min(Math.floor(y + this.def.height - SKIN), WORLD_Y - 1); by++) {
        for (let bz = Math.floor(z - probe); bz <= Math.floor(z + probe); bz++) {
          if (isSolid(world.getBlock(bx, by, bz))) return true;
        }
      }
    }
    return false;
  }

  /** Ray-vs-box, for working out which mob the player is looking at. */
  hitByRay(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number, maxDist: number,
  ): number | null {
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

const MAX_PASSIVE = 18;
const MAX_HOSTILE = 12;
/** Mobs are only simulated and kept within this distance of the player. */
const KEEP_RADIUS = 72;
const SPAWN_MIN = 24;
const SPAWN_MAX = 52;

export class MobWorld {
  readonly mobs: Mob[] = [];
  private spawnTimer = 0;

  constructor(private dimension: Dimension) {}

  setDimension(dim: Dimension): void {
    this.dimension = dim;
    this.mobs.length = 0;
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

  /** Nearest mob along the view ray. */
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

    for (const mob of this.mobs) {
      mob.update(dt, world, player, random);
      if (!mob.dead && (mob.state === 'chase' || mob.def.boss)) {
        damage += mob.tryAttack(player.x, player.y, player.z);
      }
    }

    // Drop anything dead or far away. A boss stays until it is beaten.
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      if (mob.def.boss) {
        if (mob.dead) this.mobs.splice(i, 1);
        continue;
      }
      const far = Math.hypot(mob.x - player.x, mob.z - player.z) > KEEP_RADIUS;
      if (mob.dead || far || mob.y < -8) this.mobs.splice(i, 1);
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2;
      this.trySpawn(world, player, random);
    }
    return damage;
  }

  private count(temper: 'passive' | 'hostile'): number {
    let n = 0;
    for (const mob of this.mobs) if (mob.def.temper === temper) n++;
    return n;
  }

  private trySpawn(
    world: ClientWorld,
    player: { x: number; y: number; z: number },
    random: () => number,
  ): void {
    for (const temper of ['passive', 'hostile'] as const) {
      const cap = temper === 'passive' ? MAX_PASSIVE : MAX_HOSTILE;
      if (this.count(temper) >= cap) continue;

      const candidates = spawnableIn(this.dimension, temper);
      if (candidates.length === 0) continue;
      const def = candidates[Math.floor(random() * candidates.length)];

      // A ring around the player: close enough to matter, far enough not to
      // appear in front of them.
      const angle = random() * Math.PI * 2;
      const radius = SPAWN_MIN + random() * (SPAWN_MAX - SPAWN_MIN);
      const x = Math.floor(player.x + Math.cos(angle) * radius) + 0.5;
      const z = Math.floor(player.z + Math.sin(angle) * radius) + 0.5;

      if (!world.isLoaded(Math.floor(x), Math.floor(z))) continue;

      const y = this.findFooting(world, Math.floor(x), Math.floor(z), def);
      if (y === null) continue;

      this.spawn(def.kind, x, y, z);
    }
  }

  /** Highest standable spot in the column that suits this mob. */
  private findFooting(
    world: ClientWorld, x: number, z: number, def: MobDef,
  ): number | null {
    // Hostiles look underground; animals want open ground.
    const from = def.spawnsInDarkOnly ? 46 : WORLD_Y - 2;
    const to = def.spawnsInDarkOnly ? 6 : 4;

    for (let y = from; y > to; y--) {
      const ground = world.getBlock(x, y - 1, z);
      if (!isSolid(ground) || isLiquid(ground)) continue;
      if (def.spawnSurface !== null && ground !== def.spawnSurface) continue;

      // Needs clear space for its whole body.
      let clear = true;
      for (let h = 0; h < Math.ceil(def.height); h++) {
        if (world.getBlock(x, y + h, z) !== 0) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;

      // Hostiles refuse to spawn with sky above them.
      if (def.spawnsInDarkOnly && world.skyLight(x, y, z) > 0.6) continue;
      return y;
    }
    return null;
  }
}
