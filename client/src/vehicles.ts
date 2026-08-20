/**
 * Rideable vehicles.
 *
 * Each kind gets its own handling model rather than a shared "speed" number:
 * a skateboard keeps momentum and launches off ramps, a car steers and grips,
 * a plane needs airspeed for lift and stalls without it, and a helicopter
 * hovers on vertical thrust and tilts to move.
 */

import { Block, isLiquid, isSolid } from '@shared/blocks.js';
import { WORLD_Y } from '@shared/constants.js';
import type { VehicleKind } from '@shared/items.js';
import type { InputState } from './player.js';
import type { ClientWorld } from './world.js';

export interface VehicleSpec {
  kind: VehicleKind;
  label: string;
  /** Half-width and height of the collision box, in blocks. */
  halfWidth: number;
  height: number;
  /** Where the rider sits above the vehicle origin. */
  seatHeight: number;
  /** Seat offset along the vehicle's forward axis; negative sits further back. */
  seatForward: number;
  maxSpeed: number;
  accel: number;
  /** Velocity retained per second when coasting. */
  drag: number;
  /** Floats on water instead of sinking through it. */
  buoyant?: boolean;
  turnRate: number;
  gravity: number;
  flying: boolean;
}

export const SPECS: Record<VehicleKind, VehicleSpec> = {
  skateboard: {
    kind: 'skateboard', label: 'Skateboard',
    halfWidth: 0.45, height: 0.32, seatHeight: 0.27, seatForward: 0,
    maxSpeed: 24, accel: 16, drag: 0.86, turnRate: 155, gravity: 26, flying: false,
  },
  car: {
    // Sized against a 1.8-block player: a real car is longer than it is tall.
    kind: 'car', label: 'Car',
    halfWidth: 0.85, height: 1.25, seatHeight: 0.68, seatForward: -0.15,
    maxSpeed: 22, accel: 14, drag: 0.55, turnRate: 95, gravity: 28, flying: false,
  },
  plane: {
    kind: 'plane', label: 'Plane',
    halfWidth: 1.3, height: 1.15, seatHeight: 0.66, seatForward: 0.25,
    maxSpeed: 46, accel: 11, drag: 0.12, turnRate: 55, gravity: 22, flying: true,
  },
  helicopter: {
    kind: 'helicopter', label: 'Helicopter',
    halfWidth: 1.1, height: 2.0, seatHeight: 0.48, seatForward: 0.35,
    maxSpeed: 26, accel: 12, drag: 0.9, turnRate: 85, gravity: 22, flying: true,
  },
  boat: {
    // Low gravity because buoyancy does most of the vertical work; high drag
    // so it slows the moment you stop rowing, the way a hull does.
    kind: 'boat', label: 'Boat',
    halfWidth: 0.75, height: 0.55, seatHeight: 0.34, seatForward: -0.1,
    maxSpeed: 13, accel: 7, drag: 0.72, turnRate: 105, gravity: 16, flying: false,
    buoyant: true,
  },
  truck: {
    // Heavier than the car: slower to start, slower to turn, but it keeps
    // its speed on a climb where the car bogs down.
    kind: 'truck', label: 'Truck',
    halfWidth: 1.05, height: 1.7, seatHeight: 1.0, seatForward: -0.35,
    maxSpeed: 17, accel: 9, drag: 0.4, turnRate: 62, gravity: 30, flying: false,
  },
};

/** Airspeed below which a plane stops generating lift. */
const STALL_SPEED = 13;
const MAX_STEP = 0.3;
/** See the note on Player's SKIN: keeps flush contact from counting as overlap. */
const SKIN = 1e-4;

/** How far the chase camera sits behind each vehicle. */
export const CHASE_DISTANCE: Record<VehicleKind, number> = {
  skateboard: 3.4,
  car: 6.0,
  plane: 10.0,
  helicopter: 9.0,
  boat: 5.2,
  truck: 7.0,
};

let nextId = 1;

export class Vehicle {
  readonly id = nextId++;
  readonly spec: VehicleSpec;

  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch = 0;
  roll = 0;

  /** Forward speed along `yaw`; planes and helicopters also use vy. */
  speed = 0;
  vy = 0;
  onGround = false;
  /** Helicopter rotor / car wheel spin, for the model animation. */
  spin = 0;
  /** Smoothed steering input, -1..1. Raw key input is far too twitchy. */
  steer = 0;
  /**
   * Analogue aim from the mouse, each -1..1. Aircraft fly on this; ground
   * vehicles ignore it. Set by the game loop each frame.
   */
  aimX = 0;
  aimY = 0;

  constructor(kind: VehicleKind, x: number, y: number, z: number, yaw: number) {
    this.spec = SPECS[kind];
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
  }

  get kind(): VehicleKind {
    return this.spec.kind;
  }

  /** Where the rider sits, in world space, following the vehicle's heading. */
  seat(): [number, number, number] {
    const yaw = (this.yaw * Math.PI) / 180;
    const forward = this.spec.seatForward;
    return [
      this.x + Math.cos(yaw) * forward,
      this.y + this.spec.seatHeight,
      this.z + Math.sin(yaw) * forward,
    ];
  }

  update(dt: number, world: ClientWorld, input: InputState | null): void {
    const spec = this.spec;
    const driven = input !== null;

    switch (spec.kind) {
      case 'skateboard':
        this.updateSkateboard(dt, input);
        break;
      case 'car':
        this.updateCar(dt, input);
        break;
      case 'plane':
        this.updatePlane(dt, input);
        break;
      case 'helicopter':
        this.updateHelicopter(dt, input);
        break;
    }

    if (!driven && !spec.flying) {
      // Riderless ground vehicles coast to a stop.
      this.speed *= Math.pow(1 - spec.drag, dt);
      if (Math.abs(this.speed) < 0.05) this.speed = 0;
    }

    this.integrate(dt, world);
    this.spin += (Math.abs(this.speed) + (spec.kind === 'helicopter' ? 14 : 0)) * dt;
  }

  // --------------------------------------------------------------- handling

  private updateSkateboard(dt: number, input: InputState | null): void {
    const spec = this.spec;
    if (input) {
      // Pushing only works with a foot down; in the air you keep your line.
      if (this.onGround) {
        if (input.forward) this.speed += spec.accel * dt;
        if (input.back) this.speed -= spec.accel * 1.4 * dt;
        const wanted = (input.left ? -1 : 0) + (input.right ? 1 : 0);
        this.steer += (wanted - this.steer) * Math.min(1, dt * 9);
        // Carving is sharper the slower you go, like a real board.
        const grip = 1 - Math.min(0.6, Math.abs(this.speed) / spec.maxSpeed);
        this.yaw += this.steer * spec.turnRate * (0.4 + grip) * dt;
        this.roll += (this.steer * 15 - this.roll) * Math.min(1, dt * 8);
      } else {
        this.roll *= 0.9;
      }
      // Ollie.
      if (input.jump && this.onGround) this.vy = 8.4;
    }

    // Very low rolling resistance: momentum is the whole point.
    if (this.onGround) this.speed *= Math.pow(0.94, dt);
    this.speed = clamp(this.speed, -spec.maxSpeed * 0.4, spec.maxSpeed);
  }

  private updateCar(dt: number, input: InputState | null): void {
    const spec = this.spec;
    if (input) {
      if (input.forward) this.speed += spec.accel * dt;
      else if (input.back) this.speed -= spec.accel * 0.8 * dt;
      else this.speed *= Math.pow(0.55, dt); // engine braking

      if (input.sprint) this.speed += spec.accel * 0.5 * dt; // boost
      if (input.jump) this.speed *= Math.pow(0.15, dt);      // handbrake
    }

    // The wheels turn toward the input rather than snapping to it, and
    // straighten themselves when you let go. This is most of what makes a
    // car feel drivable instead of twitchy.
    const wanted = input ? (input.left ? -1 : 0) + (input.right ? 1 : 0) : 0;
    this.steer += (wanted - this.steer) * Math.min(1, dt * 7);

    // No steering when stationary; authority builds with speed.
    const authority = Math.min(1, Math.abs(this.speed) / 5);
    this.yaw += this.steer * spec.turnRate * authority * Math.sign(this.speed || 1) * dt;
    this.roll += (-this.steer * authority * 9 - this.roll) * Math.min(1, dt * 6);
    this.speed = clamp(this.speed, -spec.maxSpeed * 0.35, spec.maxSpeed);
  }

  private updatePlane(dt: number, input: InputState | null): void {
    const spec = this.spec;
    if (input) {
      // Throttle on W/S, which is where hands already are.
      if (input.forward) this.speed += spec.accel * dt;
      if (input.back) this.speed -= spec.accel * 0.9 * dt;

      // Pitch and roll come from the mouse (see `steerInput`). Keyboard
      // left/right still works as a rudder-ish assist for anyone who
      // prefers it.
      const keyRoll = (input.left ? -1 : 0) + (input.right ? 1 : 0);
      this.roll += keyRoll * spec.turnRate * 1.1 * dt;
      this.roll += this.aimX * spec.turnRate * 1.6 * dt;
      this.pitch += this.aimY * spec.turnRate * 0.9 * dt;
    }

    this.roll = clamp(this.roll, -70, 70);
    this.pitch = clamp(this.pitch, -55, 55);
    // Banking turns the aircraft: that is the only way to change heading.
    this.yaw += (this.roll / 70) * spec.turnRate * (this.speed / spec.maxSpeed) * dt;

    // Hands off the stick and the aircraft levels itself out. Without this,
    // a plane is a full-time job just to keep upright.
    const steering = input && (input.left || input.right || Math.abs(this.aimX) > 0.02);
    if (!steering) this.roll *= Math.pow(0.25, dt);
    if (!input || Math.abs(this.aimY) < 0.02) this.pitch *= Math.pow(0.5, dt);

    this.speed = clamp(this.speed, 0, spec.maxSpeed);

    // Above stall the aircraft follows its nose; below it, it falls out of
    // the sky. Damping toward a target climb rate (rather than accumulating
    // acceleration) is what makes level flight actually stay level -- adding
    // lift and gravity as forces leaves any sink rate you built up intact.
    const lift = clamp(this.speed / STALL_SPEED, 0, 1);
    const alongNose = Math.sin((this.pitch * Math.PI) / 180) * this.speed;
    const targetClimb = alongNose * lift - (1 - lift) * 20;
    this.vy += (targetClimb - this.vy) * Math.min(1, dt * 3.5);
    this.vy = clamp(this.vy, -34, 24);
    if (this.speed < STALL_SPEED) this.pitch -= 26 * dt; // stall: nose drops
  }

  private updateHelicopter(dt: number, input: InputState | null): void {
    const spec = this.spec;
    if (input) {
      // Collective: hold jump to climb, sneak to descend, hover otherwise.
      if (input.jump) this.vy += spec.accel * 1.5 * dt;
      else if (input.sneak) this.vy -= spec.accel * 1.2 * dt;
      else this.vy *= Math.pow(0.02, dt); // auto-hover: arrest the climb fast

      if (input.forward) this.speed += spec.accel * dt;
      else if (input.back) this.speed -= spec.accel * dt;
      else this.speed *= Math.pow(0.25, dt);

      // Yaw from A/D, or from the mouse for players who prefer to steer it.
      const steer = (input.left ? -1 : 0) + (input.right ? 1 : 0) + this.aimX;
      this.yaw += clamp(steer, -1, 1) * spec.turnRate * dt;
      // Nose dips in the direction of travel.
      this.pitch = -clamp(this.speed * 1.2, -22, 22);
      this.roll = steer * 12;
    } else {
      this.vy -= spec.gravity * 0.5 * dt; // no pilot, no lift
      this.speed *= Math.pow(0.2, dt);
      this.roll *= 0.9;
    }

    this.speed = clamp(this.speed, -spec.maxSpeed * 0.5, spec.maxSpeed);
    this.vy = clamp(this.vy, -14, 11);
  }

  // --------------------------------------------------------------- movement

  private integrate(dt: number, world: ClientWorld): void {
    const spec = this.spec;

    if (!spec.flying) {
      this.vy -= spec.gravity * dt;
      this.vy = Math.max(this.vy, -55);
    }

    // Buoyancy: a hull floats at the surface rather than sinking or resting
    // on the seabed. Push up while submerged, damp hard so it settles
    // instead of bobbing forever, and leave it to gravity once clear.
    if (spec.buoyant) {
      const atHull = world.getBlock(
        Math.floor(this.x), Math.floor(this.y + 0.15), Math.floor(this.z));
      const atDeck = world.getBlock(
        Math.floor(this.x), Math.floor(this.y + spec.height), Math.floor(this.z));
      if (atHull === Block.Water) {
        // Stronger lift the deeper it is, so it rises to a stable waterline.
        const submerged = atDeck === Block.Water ? 1 : 0.35;
        this.vy += (spec.gravity + 26 * submerged) * dt;
        this.vy *= Math.pow(0.02, dt);
      }
    }

    const yaw = (this.yaw * Math.PI) / 180;
    const dx = Math.cos(yaw) * this.speed * dt;
    const dz = Math.sin(yaw) * this.speed * dt;
    const dy = this.vy * dt;

    // Sub-step for the same reason the player does: no tunnelling.
    const longest = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.min(16, Math.max(1, Math.ceil(longest / MAX_STEP)));
    for (let i = 0; i < steps; i++) {
      this.stepAxis(world, 0, dx / steps);
      this.stepAxis(world, 2, dz / steps);
      this.stepAxis(world, 1, dy / steps);
    }

    if (this.y < -8) {
      this.y = -8;
      this.vy = 0;
    }
  }

  private stepAxis(world: ClientWorld, axis: 0 | 1 | 2, delta: number): void {
    if (delta === 0) return;
    if (axis === 0) this.x += delta;
    else if (axis === 1) this.y += delta;
    else this.z += delta;

    if (!this.collides(world)) {
      if (axis === 1 && delta < 0) this.onGround = false;
      return;
    }

    // Back the move out and kill the relevant velocity component.
    if (axis === 0) this.x -= delta;
    else if (axis === 1) this.y -= delta;
    else this.z -= delta;

    if (axis === 1) {
      if (delta < 0) {
        this.onGround = true;
        // Rest exactly on top of whatever is holding us up, rather than
        // floating in the fractional gap left when the move was backed out.
        let level = Math.floor(this.y);
        while (level >= 0 && !this.solidAtLevel(world, level)) level--;
        this.y = level + 1;
      }
      this.vy = 0;
    } else {
      // Hitting a wall scrubs speed rather than stopping dead.
      this.speed *= 0.35;
      if (Math.abs(this.speed) < 0.4) this.speed = 0;
    }
  }

  /** Is any block under our footprint solid at this y level? */
  private solidAtLevel(world: ClientWorld, y: number): boolean {
    const spec = this.spec;
    const half = spec.halfWidth - SKIN;
    const x0 = Math.floor(this.x - half);
    const x1 = Math.floor(this.x + half);
    const z0 = Math.floor(this.z - half);
    const z1 = Math.floor(this.z + half);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const id = world.getBlock(x, y, z);
        if (isSolid(id) && !isLiquid(id)) return true;
      }
    }
    return false;
  }

  private collides(world: ClientWorld): boolean {
    const spec = this.spec;
    const half = spec.halfWidth - SKIN;
    const x0 = Math.floor(this.x - half);
    const x1 = Math.floor(this.x + half);
    const y0 = Math.floor(this.y + SKIN);
    const y1 = Math.floor(this.y + spec.height - SKIN);
    const z0 = Math.floor(this.z - half);
    const z1 = Math.floor(this.z + half);

    for (let x = x0; x <= x1; x++) {
      for (let y = Math.max(0, y0); y <= Math.min(y1, WORLD_Y - 1); y++) {
        for (let z = z0; z <= z1; z++) {
          const id = world.getBlock(x, y, z);
          if (isSolid(id) && !isLiquid(id)) return true;
        }
      }
    }
    return false;
  }

  /** Ray-vs-box test, used to work out which vehicle you're looking at. */
  hitByRay(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number, maxDist: number,
  ): number | null {
    const spec = this.spec;
    const minX = this.x - spec.halfWidth;
    const maxX = this.x + spec.halfWidth;
    const minY = this.y;
    const maxY = this.y + spec.height;
    const minZ = this.z - spec.halfWidth;
    const maxZ = this.z + spec.halfWidth;

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

    if (!slab(ox, dx, minX, maxX)) return null;
    if (!slab(oy, dy, minY, maxY)) return null;
    if (!slab(oz, dz, minZ, maxZ)) return null;
    return tMin;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class VehicleWorld {
  readonly vehicles: Vehicle[] = [];

  spawn(kind: VehicleKind, x: number, y: number, z: number, yaw: number): Vehicle {
    const vehicle = new Vehicle(kind, x, y, z, yaw);
    this.vehicles.push(vehicle);
    return vehicle;
  }

  remove(vehicle: Vehicle): void {
    const i = this.vehicles.indexOf(vehicle);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  update(dt: number, world: ClientWorld, ridden: Vehicle | null, input: InputState): void {
    for (const vehicle of this.vehicles) {
      vehicle.update(dt, world, vehicle === ridden ? input : null);
    }
  }

  /** Nearest vehicle along the view ray, if any. */
  pick(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number, maxDist = 5,
  ): Vehicle | null {
    let best: Vehicle | null = null;
    let bestT = Infinity;
    for (const vehicle of this.vehicles) {
      const t = vehicle.hitByRay(ox, oy, oz, dx, dy, dz, maxDist);
      if (t !== null && t < bestT) {
        bestT = t;
        best = vehicle;
      }
    }
    return best;
  }
}
