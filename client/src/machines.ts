/**
 * Dropped items and the machines that move them.
 *
 * Loose items are the currency the whole automation layer trades in: a
 * conveyor with nothing to carry is scenery, so the entity comes first and
 * the machines act on it.
 *
 * Machines run on a fixed tick rather than per frame, so a slow frame cannot
 * make a furnace smelt faster or a miner dig quicker.
 */

import { Block, blockDef, isSolid } from '@shared/blocks.js';
import { blockDrop, smeltResult, fuelValue } from '@shared/items.js';
import {
  CONVEYOR_FACING, CONVEYOR_SPEED, COLLECTOR_RANGE, MACHINE_HZ, MINER_PERIOD,
  SMELT_SECONDS, acceptsItems, isConveyor, sorterAccepts,
  CRUSH_SECONDS, BATTERY_CAPACITY, ELEVATOR_SPEED, solarOutput,
} from '@shared/machines.js';
import {
  BOOSTER_DRAW, BOOSTER_OUTPUT, SOURCE_PRESSURE,
  COMPRESS_SECONDS, ESMELT_SECONDS, QUARRY_RADIUS, QUARRY_SECONDS,
  SAWMILL_SECONDS, SAWMILL_YIELD, STONEGEN_SECONDS,
  boostAt, demandOf, isConduit, isConsumer, pressureAt, requiresNoVolt,
} from '@shared/novolt.js';
import { findRecipe } from '@shared/recipes.js';
import { CONVEYOR_HEIGHT, shapeOf } from '@shared/shapes.js';
import type { ClientWorld } from './world.js';

/** Six-neighbour offsets, for power and item routing. */
const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

const GRAVITY = 22;
/** Loose items vanish eventually, so an automation loop cannot leak forever. */
const DESPAWN_S = 300;
/** How close the player must be to hoover one up. */
const PICKUP_RANGE = 1.4;
/** Ceiling on live entities; oldest go first. */
const MAX_ITEMS = 400;

/** Every way out of a tube. */
const TUBE_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0],
];

/**
 * How fast cargo travels inside a tube. Faster than a belt: a pipe costs more
 * to build and cannot be walked on, so it should be worth the trade.
 */
const TUBE_SPEED = 4.5;

export interface DroppedItem {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  id: number;
  count: number;
  age: number;
  /** Brief delay before the player can pick it up, so drops do not snap back. */
  pickupDelay: number;
  /**
   * The last direction this cargo was actually travelling, as a unit step.
   *
   * Velocity alone is not enough to answer "which way was it going?", because
   * an item that has just landed on a belt has none -- and both a filter
   * deciding what "straight on" means and a tube deciding which way to carry
   * something need that answer at exactly that moment. Without it they fall
   * back on whichever neighbour happens to be listed first, which looks like
   * a routing bug and is really an amnesia bug.
   */
  hx: number; hy: number; hz: number;
  /**
   * The cell of the last splitter or filter that routed this cargo, packed.
   *
   * Routing is a decision made once as something passes, not a force applied
   * continuously. Re-deciding every frame makes a filter flip its answer
   * thirty times a second -- it turns the item aside, sees it now heading
   * aside, decides *that* is the way on, turns it back, and the cargo
   * shivers in place on the belt instead of going anywhere.
   */
  routedAt: number;
}

/** A machine's stored contents, keyed by packed block position. */
interface MachineState {
  /** Chest and collector: whatever has been pushed in. */
  buffer: Array<{ id: number; count: number }>;
  /** Furnace: seconds of fuel left, and progress on the current item. */
  burn: number;
  cook: number;
  /** Miner: seconds until the next dig. */
  timer: number;
  /**
   * Sorter and filter: what it acts on. Kept apart from `buffer` because
   * these are a pattern, not cargo -- it must never consume its own filter.
   */
  filter: Array<{ id: number; count: number }>;
  /**
   * Splitter: which output went last. Round-robin rather than random, so a
   * line feeding two furnaces splits evenly instead of merely on average --
   * over a short run, random is visibly lopsided and reads as broken.
   */
  turn: number;
}

/**
 * What nine of an item pack into, if anything.
 *
 * Looked up through the ordinary crafting recipes so the compressor and the
 * crafting table can never disagree about it.
 */
function packedForm(id: number): { id: number; count: number } | null {
  const cells = new Array(9).fill(id);
  return findRecipe({ width: 3, height: 3, cells })?.result ?? null;
}

function packKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export class MachineWorld {
  readonly items: DroppedItem[] = [];
  private state = new Map<string, MachineState>();
  private tickAccum = 0;
  /**
   * Collector positions, refreshed on the machine tick.
   *
   * Attraction is a continuous force, so it has to be applied every frame
   * alongside gravity and drag. Applying it only on the 5 Hz machine tick
   * let per-frame drag eat each pull before the next one landed, and items
   * hovered in equilibrium a block short of the machine instead of arriving.
   */
  private collectors: Array<[number, number, number]> = [];

  /**
   * Machine positions currently receiving power, rebuilt each machine tick.
   *
   * Recomputed rather than cached-and-invalidated: a cable run can be
   * rerouted by breaking a single block anywhere along it, and a stale power
   * map is far more confusing to debug than a flood fill that costs nothing
   * at these sizes.
   */
  /**
   * NoVolt pressure reaching each machine, rebuilt every tick.
   *
   * A map rather than a set because pressure is a quantity: a machine at the
   * far end of a long run is not simply "off", it is running slower, and the
   * HUD wants the number to explain why.
   */
  private pressure = new Map<string, number>();

  /**
   * Sky brightness and weather, pushed in by the game loop.
   *
   * A solar panel's output depends on both, and the machine layer has no
   * business reaching into the day/night cycle itself.
   */
  private skyBrightness = 1;
  private raining = false;
  /** Batteries that had a live supplier this tick, so they fill rather than drain. */
  private charging = new Set<string>();

  setEnvironment(skyBrightness: number, raining: boolean): void {
    this.skyBrightness = skyBrightness;
    this.raining = raining;
  }

  /**
   * A battery's stored charge in seconds, or a generator's remaining burn.
   * Both are held in the same units, which is what lets the network treat
   * them interchangeably.
   */
  charge(x: number, y: number, z: number): number {
    return this.state.get(packKey(x, y, z))?.burn ?? 0;
  }

  /** NoVolt pressure reaching this machine, in nV. Zero means unpowered. */
  pressureAtBlock(x: number, y: number, z: number): number {
    return this.pressure.get(packKey(x, y, z)) ?? 0;
  }

  /** True when this machine has enough pressure to run at all. */
  isPowered(x: number, y: number, z: number): boolean {
    return this.pressureAtBlock(x, y, z) > 0;
  }

  /** Fired when a machine wants a block changed, so main can sync it. */
  onSetBlock: (x: number, y: number, z: number, block: number) => void = () => {};

  private stateAt(x: number, y: number, z: number): MachineState {
    const key = packKey(x, y, z);
    let s = this.state.get(key);
    if (!s) {
      s = { buffer: [], burn: 0, cook: 0, timer: 0, filter: [], turn: 0 };
      this.state.set(key, s);
    }
    return s;
  }

  /** Contents of a chest or collector, for the UI to show. */
  contents(x: number, y: number, z: number): Array<{ id: number; count: number }> {
    return this.state.get(packKey(x, y, z))?.buffer ?? [];
  }

  /** Drops an item into the world with a small random scatter. */
  spawn(x: number, y: number, z: number, id: number, count = 1, delay = 0.4): void {
    if (id === Block.Air || count <= 0) return;
    this.items.push({
      x, y, z,
      vx: (Math.random() - 0.5) * 1.4,
      vy: 1.8,
      vz: (Math.random() - 0.5) * 1.4,
      id, count, age: 0, pickupDelay: delay,
      hx: 0, hy: 0, hz: 0, routedAt: -1,
    });
    if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
  }

  /** Forgets a machine's contents; call when its block is destroyed. */
  clearAt(x: number, y: number, z: number): Array<{ id: number; count: number }> {
    const key = packKey(x, y, z);
    const s = this.state.get(key);
    this.state.delete(key);
    // A sorter's filter is made of real items the player put in, so it comes
    // back too -- otherwise configuring one quietly destroys them.
    return s ? [...s.buffer, ...s.filter] : [];
  }

  /**
   * Advances items and machines.
   * `collect` is called for anything the player should receive; it returns
   * how many were actually taken, so a full inventory leaves the rest on
   * the ground rather than deleting it.
   */
  update(
    dt: number, world: ClientWorld,
    player: { x: number; y: number; z: number },
    collect: (id: number, count: number) => number,
  ): void {
    this.moveItems(dt, world, player, collect);

    this.tickAccum += dt;
    const step = 1 / MACHINE_HZ;
    // Bounded so a long stall cannot run hundreds of catch-up ticks at once.
    let budget = 4;
    while (this.tickAccum >= step && budget-- > 0) {
      this.tickAccum -= step;
      this.tickMachines(step, world);
    }
    if (this.tickAccum > step) this.tickAccum = 0;
  }

  private moveItems(
    dt: number, world: ClientWorld,
    player: { x: number; y: number; z: number },
    collect: (id: number, count: number) => number,
  ): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      it.pickupDelay = Math.max(0, it.pickupDelay - dt);

      // Remember which way it is going while it still is, so machines can ask
      // later, when it has stopped on their belt.
      const sp = Math.hypot(it.vx, it.vy, it.vz);
      if (sp > 0.4) {
        const ax = Math.abs(it.vx), ay = Math.abs(it.vy), az = Math.abs(it.vz);
        if (ax >= ay && ax >= az) { it.hx = Math.sign(it.vx); it.hy = 0; it.hz = 0; }
        else if (ay >= az) { it.hx = 0; it.hy = Math.sign(it.vy); it.hz = 0; }
        else { it.hx = 0; it.hy = 0; it.hz = Math.sign(it.vz); }
      }
      if (it.age > DESPAWN_S) {
        this.items.splice(i, 1);
        continue;
      }

      // An elevator lifts anything inside its shaft. Conveyors only move
      // items horizontally, so without this a build could never get a stack
      // up to a higher floor.
      const inside = world.getBlock(
        Math.floor(it.x), Math.floor(it.y), Math.floor(it.z));
      if (inside === Block.Elevator) {
        it.vy = ELEVATOR_SPEED;
        // Pull toward the centre of the shaft so items do not scrape a wall
        // and stall halfway up.
        const cx = Math.floor(it.x) + 0.5;
        const cz = Math.floor(it.z) + 0.5;
        it.vx += (cx - it.x) * Math.min(1, dt * 12);
        it.vz += (cz - it.z) * Math.min(1, dt * 12);
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.z += it.vz * dt;
        if (this.attract(dt, i, it)) continue;
        continue;
      }

      // A tube carries its cargo inside it, in any direction including up,
      // and holds it against gravity while it travels. That is the whole
      // point: conveyors need a floor and cannot cross their own lines, so
      // without a pipe there is no way to route over or under anything.
      if (inside === Block.Tube) {
        this.driveThroughTube(dt, world, it);
        if (this.attract(dt, i, it)) continue;
        continue;
      }

      // A splitter or filter under the item steers it before the belt logic
      // below gets a say, since both exist to override where a line goes.
      const under = world.getBlock(
        Math.floor(it.x), Math.floor(it.y - 0.12), Math.floor(it.z));
      if (under === Block.Splitter || under === Block.Filter) {
        this.steer(world, under, it);
      }

      // A conveyor under the item drives it along its facing; otherwise
      // horizontal motion just bleeds off.
      const below = world.getBlock(
        Math.floor(it.x), Math.floor(it.y - 0.12), Math.floor(it.z));
      const facing = CONVEYOR_FACING[below as Block];
      if (facing) {
        it.vx += (facing[0] * CONVEYOR_SPEED - it.vx) * Math.min(1, dt * 8);
        it.vz += (facing[1] * CONVEYOR_SPEED - it.vz) * Math.min(1, dt * 8);
      } else {
        const drag = Math.pow(0.02, dt);
        it.vx *= drag;
        it.vz *= drag;
      }

      it.vy -= GRAVITY * dt;
      const nx = it.x + it.vx * dt;
      const ny = it.y + it.vy * dt;
      const nz = it.z + it.vz * dt;

      // Cheap axis-separated collision: enough for something this small.
      if (!this.blocked(world, nx, it.y, it.z)) {
        it.x = nx;
      } else it.vx = 0;
      if (!this.blocked(world, it.x, it.y, nz)) {
        it.z = nz;
      } else it.vz = 0;
      // Vertical rest has to follow the block's shape, not its cell. Belts
      // are a 3/16 slab now, so resting cargo on the cell above would leave
      // every item on a conveyor hovering thirteen sixteenths in the air.
      const landing = it.vy < 0 ? this.restHeight(world, it.x, it.y, ny, it.z) : null;
      if (landing === null) {
        it.y = ny;
      } else {
        it.y = landing;
        it.vy = 0;
      }

      if (this.attract(dt, i, it)) continue;

      if (it.pickupDelay <= 0) {
        const d = Math.hypot(it.x - player.x, it.y - (player.y + 0.9), it.z - player.z);
        if (d < PICKUP_RANGE) {
          const taken = collect(it.id, it.count);
          if (taken >= it.count) {
            this.items.splice(i, 1);
            continue;
          }
          it.count -= taken;
        }
      }
    }
  }

  /**
   * Draws an item toward any collector in range, and swallows it on arrival.
   * Returns true if the item was consumed, so the caller stops touching it.
   *
   * Aims at the space just *above* the collector rather than its centre: the
   * block is solid, so an item steered into it is stopped by collision a
   * third of a block short and can never arrive. Gathering on the top face
   * is both reachable and how a hopper reads.
   */
  /**
   * Moves an item along a tube run.
   *
   * The rule is "keep going if you can, otherwise take the only other way
   * out". Preferring the current heading is what makes a straight pipe
   * straight; without it an item entering a corner has two neighbours to
   * choose from and oscillates between them forever.
   *
   * Gravity is suspended while inside, so a tube can climb. Cargo is also
   * pulled to the bore, or it scrapes a wall and stalls.
   */
  private driveThroughTube(dt: number, world: ClientWorld, it: DroppedItem): void {
    const bx = Math.floor(it.x);
    const by = Math.floor(it.y);
    const bz = Math.floor(it.z);

    const connects = (dx: number, dy: number, dz: number): boolean => {
      const b = world.getBlock(bx + dx, by + dy, bz + dz);
      return b === Block.Tube || acceptsItems(b) || isConveyor(b);
    };

    // The heading it already had, remembered rather than read off a velocity
    // that this very method overwrote last frame.
    let dir: [number, number, number] | null =
      it.hx || it.hy || it.hz ? [it.hx, it.hy, it.hz] : null;

    if (!dir || !connects(dir[0], dir[1], dir[2])) {
      // Look for any exit that is not the way we came in.
      const back = dir ? [-dir[0], -dir[1], -dir[2]] : null;
      dir = null;
      for (const [dx, dy, dz] of TUBE_DIRS) {
        if (back && dx === back[0] && dy === back[1] && dz === back[2]) continue;
        if (connects(dx, dy, dz)) { dir = [dx, dy, dz]; break; }
      }
    }

    if (!dir) {
      // A capped tube. Hold the cargo still rather than letting it drop out
      // through the floor of a pipe it is supposed to be inside.
      it.vx = 0; it.vy = 0; it.vz = 0;
    } else {
      it.vx = dir[0] * TUBE_SPEED;
      it.vy = dir[1] * TUBE_SPEED;
      it.vz = dir[2] * TUBE_SPEED;
      it.hx = dir[0]; it.hy = dir[1]; it.hz = dir[2];

      // Centre it on the two axes it is not travelling along.
      const pull = Math.min(1, dt * 14);
      if (dir[0] === 0) it.x += (bx + 0.5 - it.x) * pull;
      if (dir[1] === 0) it.y += (by + 0.5 - it.y) * pull;
      if (dir[2] === 0) it.z += (bz + 0.5 - it.z) * pull;
    }

    it.x += it.vx * dt;
    it.y += it.vy * dt;
    it.z += it.vz * dt;
  }

  /**
   * A splitter or a filter deciding where a passing item goes.
   *
   * Both nudge velocity rather than teleporting the item, so cargo still
   * looks like it is being carried rather than snapping between cells.
   */
  private steer(world: ClientWorld, kind: number, it: DroppedItem): void {
    const bx = Math.floor(it.x);
    const by = Math.floor(it.y - 0.12);
    const bz = Math.floor(it.z);

    // Wait until the cargo is actually riding the belt. Deciding while it is
    // still falling through the airspace above spends the decision early:
    // there is no belt under it yet to hold the new heading, so drag bleeds
    // the push away before it lands, and it arrives going nowhere.
    if (it.y > by + CONVEYOR_HEIGHT + 0.2) return;

    // One decision per machine per item. See DroppedItem.routedAt.
    const cell = (bx & 0xffff) * 0x1000000 + (by & 0xfff) * 0x1000 + (bz & 0xfff);
    if (it.routedAt === cell) return;
    it.routedAt = cell;

    const s = this.stateAt(bx, by, bz);

    // Where could this thing go? Any belt, tube or machine beside it.
    const exits: Array<[number, number]> = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const b = world.getBlock(bx + dx, by, bz + dz);
      const above = world.getBlock(bx + dx, by + 1, bz + dz);
      if (isConveyor(b) || b === Block.Splitter || b === Block.Filter ||
          above === Block.Tube || acceptsItems(b)) {
        exits.push([dx, dz]);
      }
    }
    if (exits.length === 0) return;

    let pick: [number, number];
    if (kind === Block.Filter) {
      // A filter is a gate, not a router: matching cargo carries straight on
      // and everything else is turned aside. An empty filter passes all of
      // it, which is the same rule a sorter uses.
      const matches = s.filter.length === 0 || sorterAccepts(s.filter, it.id);
      const ahead = this.throughLine(world, bx, by, bz, it);
      if (matches && ahead && exits.some(([dx, dz]) => dx === ahead[0] && dz === ahead[1])) {
        pick = ahead;
      } else {
        // Rejects go sideways, never backwards. "Anything but straight on"
        // includes the way the cargo arrived from, and returning it up its own
        // input belt just sends it round again -- the line would knot itself
        // at the first item the filter did not want.
        const aside = ahead
          ? exits.find(([dx, dz]) => dx * ahead[0] + dz * ahead[1] === 0)
          : exits[0];
        // Nowhere to put it: better to let it ride on than to bounce it back.
        if (!aside) return;
        pick = aside;
      }
    } else {
      // Round-robin, so two outputs really do get half each.
      pick = exits[s.turn % exits.length];
      s.turn = (s.turn + 1) % exits.length;
    }

    it.vx = pick[0] * CONVEYOR_SPEED;
    it.vz = pick[1] * CONVEYOR_SPEED;
    it.hx = pick[0]; it.hy = 0; it.hz = pick[1];
  }

  /**
   * Which way "straight on" runs through this cell.
   *
   * Taken from the belt feeding the machine rather than from the item, and
   * for a good reason: cargo falling onto a filter has spent the drop with
   * its heading pointing down, so by the time it lands it no longer knows
   * which way it came from. The line itself does know.
   *
   * Falls back to whatever the cargo remembers, for a filter fed by hand or
   * by a machine rather than by a belt.
   */
  private throughLine(
    world: ClientWorld, bx: number, by: number, bz: number, it: DroppedItem,
  ): [number, number] | null {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const facing = CONVEYOR_FACING[world.getBlock(bx - dx, by, bz - dz) as Block];
      // A belt one step back, pointing this way, is the line coming in.
      if (facing && facing[0] === dx && facing[1] === dz) return [dx, dz];
    }
    return this.headingOf(it);
  }

  /** The way this cargo was last travelling on the horizontal plane. */
  private headingOf(it: DroppedItem): [number, number] | null {
    if (it.hx === 0 && it.hz === 0) return null;
    return [it.hx, it.hz];
  }

  /**
   * Is cargo at this position inside something solid?
   *
   * Shapes, not cells. Belts are opaque full cubes as far as light is
   * concerned, but they only occupy the bottom 3/16 of their cell -- so an
   * item resting on one sits *inside* that cell, and a cell-level test says
   * it is embedded in a wall and refuses to let it move along the line at
   * all. Which is to say: the belt would stop the very cargo it carries.
   */
  private blocked(world: ClientWorld, x: number, y: number, z: number): boolean {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const id = world.getBlock(bx, by, bz);
    if (!isSolid(id)) return false;
    for (const box of shapeOf(id)) {
      // A hair above the surface counts as clear, so cargo resting exactly
      // on a belt is not read as being inside it.
      if (y >= by + box.y0 + 1e-3 && y < by + box.y1 - 1e-3) return true;
    }
    return false;
  }

  /**
   * The surface a falling item lands on this step, or null if it lands on
   * nothing.
   *
   * It needs both ends of the move, not just the destination: landing means
   * crossing a surface, so the box top has to be at or below where the item
   * started and at or above where it is going. Testing only the destination
   * skips every floor the item has not reached yet -- which is all of them,
   * and the cargo falls out of the world.
   *
   * Shapes rather than cells, so cargo rests on a belt at belt height.
   */
  private restHeight(
    world: ClientWorld, x: number, fromY: number, toY: number, z: number,
  ): number | null {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    let best: number | null = null;
    // Every cell the move passes through, plus the one below it: a shallow
    // slab can be crossed entirely within a single step.
    for (let by = Math.floor(fromY) + 1; by >= Math.floor(toY) - 1; by--) {
      const id = world.getBlock(bx, by, bz);
      if (!isSolid(id)) continue;
      for (const box of shapeOf(id)) {
        const top = by + box.y1;
        if (top > fromY + 1e-6) continue;   // started below it: not a floor
        if (top < toY - 1e-6) continue;     // never reached it this step
        if (best === null || top > best) best = top;
      }
    }
    return best;
  }

  private attract(dt: number, index: number, it: DroppedItem): boolean {
    for (const [x, y, z] of this.collectors) {
      const dx = x + 0.5 - it.x;
      const dy = y + 1.05 - it.y;
      const dz = z + 0.5 - it.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > COLLECTOR_RANGE) continue;

      if (d < 0.7) {
        this.store(this.stateAt(x, y, z), it.id, it.count);
        this.items.splice(index, 1);
        return true;
      }

      // Steer velocity toward the mouth, and cancel gravity while held in
      // the field, so an item can be lifted onto a collector above it.
      const speed = 7;
      const k = Math.min(1, dt * 9);
      it.vx += ((dx / d) * speed - it.vx) * k;
      it.vy += ((dy / d) * speed - it.vy) * k + GRAVITY * dt;
      it.vz += ((dz / d) * speed - it.vz) * k;
      return false;
    }
    return false;
  }

  /**
   * Works out which machines have power this tick.
   *
   * Each fuelled generator floods outward through cables, collecting the
   * machines its run touches, pricing each by how far the energy travelled.
   * Machines already supplied by another generator are skipped, so two
   * generators on one network add capacity rather than fighting over it.
   */
  /**
   * Solves every NoVolt network.
   *
   * Each source floods its run, recording how far the energy travelled to
   * reach each machine. Total draw is summed first, then pressure is worked
   * out per machine from its own distance -- so the machine nearest the
   * generator really does run better than the one at the end of the line,
   * and adding one more consumer costs all of them a little.
   */
  private rebuildPower(world: ClientWorld): void {
    this.pressure.clear();
    const charging = this.charging;
    charging.clear();

    for (const [key, s] of this.state) {
      const [x, y, z] = key.split(',').map(Number);
      const block = world.getBlock(x, y, z);
      const rated = SOURCE_PRESSURE[block as Block];
      if (rated === undefined) continue;

      // What this source is actually managing right now.
      let output = 0;
      if (block === Block.Generator) {
        output = s.burn > 0 ? rated : 0;
      } else if (block === Block.SolarPanel) {
        const exposed = world.skyLight(x, y + 1, z) > 0.9;
        // solarOutput reports 0/1/2; scale that onto the rated pressure.
        output = rated * (solarOutput(this.skyBrightness, exposed, this.raining) / 2);
      } else if (block === Block.WaterWheel) {
        // Needs water touching it to turn at all, which is what stops one
        // being dropped in the middle of a base for free power.
        let wet = false;
        for (const [dx, dy, dz] of NEIGHBOURS) {
          if (world.getBlock(x + dx, y + dy, z + dz) === Block.Water) wet = true;
        }
        output = wet ? rated : 0;
      } else if (block === Block.Battery) {
        output = 0; // batteries only supply once nothing else can; see below
      }
      if (output > 0) this.energise(world, x, y, z, output, charging);
    }

    // Batteries are the fallback: they supply only runs nothing else reached.
    for (const [key, s] of this.state) {
      if (charging.has(key) || s.burn <= 0) continue;
      const [x, y, z] = key.split(',').map(Number);
      if (world.getBlock(x, y, z) !== Block.Battery) continue;
      this.energise(world, x, y, z, SOURCE_PRESSURE[Block.Battery]!, charging);
    }
  }

  /**
   * Walks one source's conduit run, then assigns pressure by distance.
   *
   * A breadth-first walk is what makes distance meaningful: the queue is
   * processed in order so the first time a machine is reached is along the
   * shortest conduit path to it, which is the path the energy would take.
   */
  private energise(
    world: ClientWorld, sx: number, sy: number, sz: number,
    output: number, charging: Set<string>,
  ): void {
    const seen = new Set<string>([packKey(sx, sy, sz)]);
    const queue: Array<[number, number, number, number]> = [[sx, sy, sz, 0]];
    const reached: Array<{ key: string; block: number; distance: number }> = [];
    let totalDraw = 0;

    for (let head = 0; head < queue.length; head++) {
      const [x, y, z, dist] = queue[head];
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        const nk = packKey(nx, ny, nz);
        if (seen.has(nk)) continue;
        seen.add(nk);

        const block = world.getBlock(nx, ny, nz);
        if (isConduit(block)) {
          queue.push([nx, ny, nz, dist + 1]);
          continue;
        }
        // A booster re-pressurises the run onward, at the cost of its own draw.
        if (block === Block.Booster) {
          totalDraw += BOOSTER_DRAW;
          output = Math.max(output, BOOSTER_OUTPUT);
          queue.push([nx, ny, nz, 0]);
          continue;
        }
        if (block === Block.Battery) {
          charging.add(nk);
          continue;
        }
        if (isConsumer(block)) {
          totalDraw += demandOf(block)!.draw;
          reached.push({ key: nk, block, distance: dist + 1 });
        }
      }
    }

    // Now that the whole network's draw is known, price each machine by how
    // far the energy had to travel to reach it.
    for (const { key, block, distance } of reached) {
      const p = pressureAt(output, distance, totalDraw);
      // Two sources feeding one machine: the better one wins rather than
      // the two summing, which would make daisy-chaining sources trivial.
      if (p > (this.pressure.get(key) ?? 0)) this.pressure.set(key, p);
      void block;
    }
  }

  private tickMachines(dt: number, world: ClientWorld): void {
    this.rebuildPower(world);

    // Refresh the collector list the per-frame attraction reads.
    this.collectors = [];
    for (const key of this.state.keys()) {
      const [x, y, z] = key.split(',').map(Number);
      if (world.getBlock(x, y, z) === Block.Collector) this.collectors.push([x, y, z]);
    }

    // Only machines near loaded chunks matter, and scanning every block would
    // be hopeless -- so machines are found from the items and states already
    // in play, plus a sweep of the chunks around each tracked machine.
    for (const [key, s] of this.state) {
      const [x, y, z] = key.split(',').map(Number);
      const block = world.getBlock(x, y, z);
      if (block === Block.Air) {
        // The machine was mined; spill anything it held, filter included.
        for (const stack of [...s.buffer, ...s.filter]) {
          this.spawn(x + 0.5, y + 0.5, z + 0.5, stack.id, stack.count);
        }
        this.state.delete(key);
        continue;
      }
      // Power makes a machine run faster; the speedup is applied as extra
      // simulated time rather than a separate code path, so a powered and an
      // unpowered machine cannot drift apart in behaviour.
      // NoVolt makes a machine faster in proportion to the pressure reaching
      // it, rather than flipping it between two speeds. Applied as extra
      // simulated time so a fed and a starved machine cannot drift apart in
      // behaviour -- only in rate.
      const nv = this.pressure.get(key) ?? 0;
      const rate = boostAt(block, nv);   // 0 when below the machine's minimum
      // Machines that need NoVolt stop dead without enough of it. This has to
      // be tested against the raw rate, not against the floored one below --
      // flooring first hands a starved crusher the base speed and the gate
      // never fires.
      if (requiresNoVolt(block) && rate <= 0) continue;
      // Everything else keeps working unpowered, just at its base rate.
      const boost = Math.max(1, rate);
      if (block === Block.Furnace) this.tickFurnace(dt * boost, x, y, z, s);
      else if (block === Block.Miner) this.tickMiner(dt * boost, world, x, y, z, s);
      else if (block === Block.Collector) this.tickCollector(dt, world, x, y, z, s);
      else if (block === Block.Sorter) this.tickSorter(world, x, y, z, s);
      else if (block === Block.Generator) this.tickGenerator(dt, s);
      else if (block === Block.Battery) this.tickBattery(dt, key, s);
      else if (block === Block.Crusher) this.tickCrusher(dt, x, y, z, s);
      else if (block === Block.StoneGenerator) this.tickStoneGen(dt, x, y, z, s);
      else if (block === Block.ElectricFurnace) this.tickElectricFurnace(dt, x, y, z, s);
      else if (block === Block.Sawmill) this.tickSawmill(dt, x, y, z, s);
      else if (block === Block.Compressor) this.tickCompressor(dt, x, y, z, s);
      else if (block === Block.Quarry) this.tickQuarry(dt, world, x, y, z, s);
      else if (block === Block.Incinerator) this.tickIncinerator(x, y, z);
    }

    // Collectors and miners have to run even before anything is stored in
    // them, so any such block near a loose item registers itself.
    for (const it of this.items) {
      const bx = Math.floor(it.x);
      const by = Math.floor(it.y);
      const bz = Math.floor(it.z);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const b = world.getBlock(bx + dx, by + dy, bz + dz);
            if (b === Block.Collector || b === Block.Sorter ||
                b === Block.Incinerator || b === Block.Splitter || b === Block.Filter) {
              this.stateAt(bx + dx, by + dy, bz + dz);
            }
          }
        }
      }
    }
  }

  /** Registers a machine so it starts ticking. Called when one is placed. */
  register(x: number, y: number, z: number): void {
    this.stateAt(x, y, z);
  }

  private tickFurnace(dt: number, x: number, y: number, z: number, s: MachineState): void {
    // Fuel first: without it nothing cooks.
    if (s.burn <= 0) {
      const fuelIdx = s.buffer.findIndex((st) => fuelValue(st.id) > 0);
      const cookableExists = s.buffer.some((st) => smeltResult(st.id) !== null);
      if (fuelIdx >= 0 && cookableExists) {
        s.burn = fuelValue(s.buffer[fuelIdx].id);
        if (--s.buffer[fuelIdx].count <= 0) s.buffer.splice(fuelIdx, 1);
      }
    }
    if (s.burn <= 0) return;
    s.burn -= dt;

    const idx = s.buffer.findIndex((st) => smeltResult(st.id) !== null);
    if (idx < 0) {
      s.cook = 0;
      return;
    }
    s.cook += dt;
    if (s.cook < SMELT_SECONDS) return;

    s.cook = 0;
    const stack = s.buffer[idx];
    const result = smeltResult(stack.id)!;
    if (--stack.count <= 0) s.buffer.splice(idx, 1);
    // Eject on top, so a conveyor above the furnace carries it away.
    this.spawn(x + 0.5, y + 1.1, z + 0.5, result.id, result.count, 0.1);
  }

  private tickMiner(
    dt: number, world: ClientWorld, x: number, y: number, z: number, s: MachineState,
  ): void {
    s.timer -= dt;
    if (s.timer > 0) return;
    s.timer = MINER_PERIOD;

    // Digs straight down, one block per period, until it reaches something
    // unbreakable. Scanning only a few blocks down meant a miner went
    // permanently inert the moment it had cleared them, which made it look
    // broken rather than finished.
    for (let depth = 1; depth <= y; depth++) {
      const target = world.getBlock(x, y - depth, z);
      if (target === Block.Air) continue;
      const def = blockDef(target);
      if (!def.breakable) return;
      const drop = blockDrop(target);
      this.onSetBlock(x, y - depth, z, Block.Air);
      if (drop) this.spawn(x + 0.5, y + 1.1, z + 0.5, drop.id, drop.count, 0.1);
      return;
    }
  }

  private tickCollector(
    dt: number, world: ClientWorld, x: number, y: number, z: number, s: MachineState,
  ): void {
    // Attraction and capture happen per frame in `attract`; this tick only
    // has to move what has already been gathered onward.
    // Push one item per tick into an adjacent chest or furnace.
    if (s.buffer.length === 0) return;
    for (const [dx, dy, dz] of [
      [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    ] as const) {
      const b = world.getBlock(x + dx, y + dy, z + dz);
      if (!acceptsItems(b) || b === Block.Collector) continue;
      const stack = s.buffer[0];
      const target = this.stateAt(x + dx, y + dy, z + dz);
      this.store(target, stack.id, 1);
      if (--stack.count <= 0) s.buffer.shift();
      return;
    }
  }

  /**
   * A sorter sits under a belt and lifts matching items off it.
   *
   * Items it does not want are left alone entirely -- they keep riding the
   * belt over the top of it -- so a line of sorters with different filters
   * splits one stream into several without any of them needing to know about
   * the others.
   */
  private tickSorter(
    world: ClientWorld, x: number, y: number, z: number, s: MachineState,
  ): void {
    if (s.filter.length > 0) {
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        // Only items passing directly over this block.
        if (Math.floor(it.x) !== x || Math.floor(it.z) !== z) continue;
        // Cargo rests on the belt at 3/16, not a whole block up: belts are
        // slabs now, and the old window started above everything a sorter is
        // meant to see.
        if (it.y < y - 0.1 || it.y > y + 2.2) continue;
        if (!sorterAccepts(s.filter, it.id)) continue;
        this.store(s, it.id, it.count);
        this.items.splice(i, 1);
      }
    }

    // Then hand one item per tick to an adjacent store, exactly as a
    // collector does, so a sorter can feed a chest directly.
    if (s.buffer.length === 0) return;
    for (const [dx, dy, dz] of [
      [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    ] as const) {
      const b = world.getBlock(x + dx, y + dy, z + dz);
      if (!acceptsItems(b) || b === Block.Sorter) continue;
      const stack = s.buffer[0];
      this.store(this.stateAt(x + dx, y + dy, z + dz), stack.id, 1);
      if (--stack.count <= 0) s.buffer.shift();
      return;
    }
  }

  /**
   * A generator turns fuel into burn time. It holds that time whether or not
   * anything is drawing on it -- a generator with fuel is "on", and the
   * network decides who benefits.
   */
  /**
   * Burns whatever is dropped into it.
   *
   * An automated base makes things nobody asked for -- cobble from a quarry,
   * dirt from a miner -- and without somewhere for the surplus to go, a
   * backed-up line stalls everything upstream of it. This is that somewhere.
   *
   * It needs NoVolt, so throwing away is a decision with a cost rather than
   * the obvious default for anything mildly inconvenient.
   */
  private tickIncinerator(x: number, y: number, z: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (Math.floor(it.x) !== x || Math.floor(it.z) !== z) continue;
      // The mouth is the top of the block and a little above it, so cargo
      // riding a belt into the side is not silently eaten.
      if (it.y < y + 0.5 || it.y > y + 1.6) continue;
      this.items.splice(i, 1);
    }
  }

  private tickGenerator(dt: number, s: MachineState): void {
    if (s.burn > 0) {
      s.burn -= dt;
      return;
    }
    const idx = s.buffer.findIndex((st) => fuelValue(st.id) > 0);
    if (idx < 0) return;
    s.burn = fuelValue(s.buffer[idx].id);
    if (--s.buffer[idx].count <= 0) s.buffer.splice(idx, 1);
  }

  /**
   * A battery fills while something else on its run is live and drains while
   * it is the one keeping the lights on.
   *
   * Charge is held in the same units as a generator's burn time, so the two
   * are interchangeable to the network and a battery needs no separate
   * accounting.
   */
  private tickBattery(dt: number, key: string, s: MachineState): void {
    if (this.charging.has(key)) {
      s.burn = Math.min(BATTERY_CAPACITY, s.burn + dt);
    } else if (this.pressure.size > 0 && s.burn > 0) {
      // Only drains when it is actually supplying something.
      s.burn = Math.max(0, s.burn - dt);
    }
  }

  /**
   * A crusher doubles ore, and is the one machine that does nothing at all
   * without power -- it is what makes wiring a base up worth doing rather
   * than merely faster.
   */
  private tickCrusher(
    dt: number, x: number, y: number, z: number, s: MachineState,
  ): void {
    const idx = s.buffer.findIndex((st) => blockDrop(st.id) !== null);
    if (idx < 0) {
      s.cook = 0;
      return;
    }
    // dt already carries the powered speedup from the caller.
    s.cook += dt;
    if (s.cook < CRUSH_SECONDS) return;

    s.cook = 0;
    const stack = s.buffer[idx];
    const drop = blockDrop(stack.id)!;
    if (--stack.count <= 0) s.buffer.splice(idx, 1);
    // Double output: the whole point of running ore through a crusher.
    this.spawn(x + 0.5, y + 1.1, z + 0.5, drop.id, drop.count * 2, 0.1);
  }

  /**
   * Turns NoVolt into cobblestone out of nothing.
   *
   * Deliberately the cheapest NoVolt machine to run: it is the one that
   * makes a network worth building before you own anything else, and stone
   * is the resource you burn through fastest when building.
   */
  private tickStoneGen(
    dt: number, x: number, y: number, z: number, s: MachineState,
  ): void {
    s.cook += dt;
    if (s.cook < STONEGEN_SECONDS) return;
    s.cook = 0;
    this.spawn(x + 0.5, y + 1.1, z + 0.5, Block.Cobblestone, 1, 0.1);
  }

  /** Smelts without fuel, faster than a furnace, on NoVolt alone. */
  private tickElectricFurnace(
    dt: number, x: number, y: number, z: number, s: MachineState,
  ): void {
    const idx = s.buffer.findIndex((st) => smeltResult(st.id) !== null);
    if (idx < 0) {
      s.cook = 0;
      return;
    }
    s.cook += dt;
    if (s.cook < ESMELT_SECONDS) return;

    s.cook = 0;
    const stack = s.buffer[idx];
    const result = smeltResult(stack.id)!;
    if (--stack.count <= 0) s.buffer.splice(idx, 1);
    this.spawn(x + 0.5, y + 1.1, z + 0.5, result.id, result.count, 0.1);
  }

  /** Cuts logs into more planks than doing it by hand gets you. */
  private tickSawmill(
    dt: number, x: number, y: number, z: number, s: MachineState,
  ): void {
    const idx = s.buffer.findIndex((st) => st.id === Block.Log);
    if (idx < 0) {
      s.cook = 0;
      return;
    }
    s.cook += dt;
    if (s.cook < SAWMILL_SECONDS) return;

    s.cook = 0;
    const stack = s.buffer[idx];
    if (--stack.count <= 0) s.buffer.splice(idx, 1);
    this.spawn(x + 0.5, y + 1.1, z + 0.5, Block.Planks, SAWMILL_YIELD, 0.1);
  }

  /**
   * Packs nine of something into its block form.
   *
   * Asks the crafting table rather than carrying its own table of what packs
   * into what: anything with a 3x3 same-item recipe works here automatically,
   * so adding a new storage block needs no change to this machine at all.
   */
  private tickCompressor(
    dt: number, x: number, y: number, z: number, s: MachineState,
  ): void {
    const idx = s.buffer.findIndex((st) => st.count >= 9 && packedForm(st.id) !== null);
    if (idx < 0) {
      s.cook = 0;
      return;
    }
    s.cook += dt;
    if (s.cook < COMPRESS_SECONDS) return;

    s.cook = 0;
    const stack = s.buffer[idx];
    const packed = packedForm(stack.id)!;
    stack.count -= 9;
    if (stack.count <= 0) s.buffer.splice(idx, 1);
    this.spawn(x + 0.5, y + 1.1, z + 0.5, packed.id, packed.count, 0.1);
  }

  /**
   * Digs a square shaft rather than a single column.
   *
   * The expensive machine on the network: it wants more pressure than
   * anything else, which is the trade for clearing nine times the volume a
   * miner does.
   */
  private tickQuarry(
    dt: number, world: ClientWorld, x: number, y: number, z: number, s: MachineState,
  ): void {
    s.timer -= dt;
    if (s.timer > 0) return;
    s.timer = QUARRY_SECONDS;

    // One block per pass, sweeping the square before going deeper, so the
    // shaft opens out evenly instead of boring one corner to bedrock first.
    for (let depth = 1; depth <= y; depth++) {
      for (let dz = -QUARRY_RADIUS; dz <= QUARRY_RADIUS; dz++) {
        for (let dx = -QUARRY_RADIUS; dx <= QUARRY_RADIUS; dx++) {
          const tx = x + dx;
          const ty = y - depth;
          const tz = z + dz;
          const target = world.getBlock(tx, ty, tz);
          if (target === Block.Air) continue;
          if (!blockDef(target).breakable) return;
          const drop = blockDrop(target);
          this.onSetBlock(tx, ty, tz, Block.Air);
          if (drop) this.spawn(x + 0.5, y + 1.1, z + 0.5, drop.id, drop.count, 0.1);
          return;
        }
      }
    }
  }

  /** A sorter's filter pattern, shown as its container screen. */
  filterAt(x: number, y: number, z: number): Array<{ id: number; count: number }> {
    return this.state.get(packKey(x, y, z))?.filter ?? [];
  }

  /** Replaces a sorter's filter. Counts are irrelevant; only ids matter. */
  setFilter(
    x: number, y: number, z: number,
    stacks: Array<{ id: number; count: number } | null>,
  ): void {
    this.stateAt(x, y, z).filter = stacks.filter(
      (v): v is { id: number; count: number } => v !== null && v.count > 0);
  }

  private store(s: MachineState, id: number, count: number): void {
    const existing = s.buffer.find((st) => st.id === id);
    if (existing) existing.count += count;
    else s.buffer.push({ id, count });
  }

  /** Hand-feeds a machine, for a player right-clicking one with an item. */
  insert(x: number, y: number, z: number, id: number, count = 1): void {
    this.store(this.stateAt(x, y, z), id, count);
  }

  /**
   * Replaces a machine's contents wholesale, for the container screen.
   *
   * Empty stacks are dropped rather than stored: the machine tick treats the
   * buffer as a compact list -- `buffer[0]` is "the next item to push" -- so
   * a hole left in the middle of it would stall a collector permanently.
   */
  setContents(
    x: number, y: number, z: number, stacks: Array<{ id: number; count: number } | null>,
  ): void {
    const s = this.stateAt(x, y, z);
    s.buffer = stacks.filter(
      (v): v is { id: number; count: number } => v !== null && v.count > 0);
  }

  /** How many item slots a machine shows when opened. */
  static capacity(block: number): number {
    return block === Block.Chest ? 27 : 9;
  }
}

/** True for any block the machine layer needs to track once placed. */
export function isMachine(block: number): boolean {
  return block === Block.Furnace || block === Block.Chest ||
    block === Block.Collector || block === Block.Miner ||
    block === Block.Sorter || block === Block.Generator ||
    block === Block.Crusher || block === Block.SolarPanel ||
    block === Block.Battery || block === Block.Elevator ||
    block === Block.Booster || block === Block.StoneGenerator ||
    block === Block.ElectricFurnace || block === Block.Sawmill ||
    block === Block.Compressor || block === Block.Quarry ||
    block === Block.WaterWheel || isConveyor(block);
}
