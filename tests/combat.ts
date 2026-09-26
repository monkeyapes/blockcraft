/**
 * The combat pack: arrows and other things in flight, the bow, hammers,
 * buckets, TNT and its blast, falling sand, the bounce pad and spikes.
 * Run: npx tsx tests/combat.ts
 *
 * Behaviour is driven through the real hooks in client/src/content/combat.ts
 * against a real ClientWorld with a flat stone floor, a real Player and real
 * mobs, the same way main.ts drives them. The GameContext is a small fake
 * that records what the pack asked the game to do.
 */

import { Block, blockDef, canReplace } from '../shared/src/blocks.js';
import { Dimension, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { BOUNCE_PAD_BOUNCE, COMBAT, HAMMERS } from '../shared/src/content/combat.js';
import { Item, blockDrops, canHarvest, itemDef, toolSpec } from '../shared/src/items.js';
import { MobKind } from '../shared/src/mobs.js';
import { RECIPES, findRecipe, recipeLayout, type Recipe } from '../shared/src/recipes.js';
import { collisionOf, selectionOf, shapeOf } from '../shared/src/shapes.js';
import {
  dispatchAfterPlace, dispatchBreak, dispatchRelease, dispatchUse, dispatchUseAir,
  flushNeighbourChanges, hasRelease, noteBlockChanged, registeredCounts, resetSystems,
  services, type GameContext, type UseContext,
} from '../client/src/content/api.js';
import {
  ARROW_SPEED, SPIKE_BITE, bowPower, combatSystem, effects, explosions, falling, hammerTargets,
  isDrawing, liquidInSight, projectiles, type InventoryAccess,
} from '../client/src/content/combat.js';
import {
  CHAIN_FUSE_MAX, DROP_CHANCE, FLASH_TILE, FUSE_SECONDS, TNT_POWER, blastCells, blastDamage, impactAt,
} from '../client/src/content/combat/explosion.js';
import { FLIGHT, PICKUP_RADIUS, STUCK_LIFETIME } from '../client/src/content/combat/projectiles.js';
import { MeshBuilder } from '../client/src/content/combat/geometry.js';
import { Mob, MobWorld } from '../client/src/mobs.js';
import { EYE_HEIGHT, Player, type InputState } from '../client/src/player.js';
import { ClientWorld } from '../client/src/world.js';
import { atlasTileNames } from '../client/src/gfx/atlas.js';
import { ART } from '../client/src/gfx/art/index.js';
import { nodeAtlas } from './diagnostics/offscreen.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- a small world ------------------------------------------------------------------

/** The floor's top layer; everything at or below is stone, air above. */
const GROUND = 40;
const Y = GROUND + 1;

/** Deterministic 0..1 sequence, so a random roll can never flake the suite. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Game extends GameContext, InventoryAccess {
  held: number | null;
  inventory: Map<number, number>;
  given: Array<{ id: number; count: number }>;
  dropped: Array<{ id: number; count: number; x: number; y: number; z: number }>;
  broken: Array<{ x: number; y: number; z: number; id: number; drops: boolean }>;
  playerDamage: Array<{ amount: number; cause: string }>;
  pushes: Array<[number, number, number]>;
  mobHits: Array<{ mob: Mob; amount: number }>;
  toasts: string[];
  clock: number;
  put(x: number, y: number, z: number, id: number): void;
  /** Runs the combat pack's system and the neighbour queue for `seconds`. */
  run(seconds: number, dt?: number): void;
}

const NOOP = () => {};
const SOUND = new Proxy({}, { get: () => NOOP }) as GameContext['sound'];

/** A stone floor 48 blocks square, air above, a fresh player and no mobs. */
function makeGame(opts: { creative?: boolean; seed?: number; dimension?: Dimension } = {}): Game {
  resetSystems();
  const dimension = opts.dimension ?? Dimension.Overworld;
  const world = new ClientWorld(1, dimension);
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
      const chunk = world.ensureChunk(cx, cz);
      chunk.data.fill(0);
      for (let y = 0; y <= GROUND; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.data[voxelIndex(x, y, z)] = y === 0 ? Block.Bedrock : Block.Stone;
        }
      }
      chunk.rebuildHeightmap();
    }
  }
  const player = new Player();
  player.x = 0.5; player.y = Y; player.z = 0.5;
  player.yaw = 0; player.pitch = 0; // looking along +x
  const mobs = new MobWorld(dimension);
  const random = rng(opts.seed ?? 11);

  const g: Game = {
    world, dimension, player, mobs, sound: SOUND,
    creative: opts.creative ?? false,
    get time() { return g.clock; },
    clock: 0,
    held: null,
    inventory: new Map(),
    given: [], dropped: [], broken: [], playerDamage: [], pushes: [], mobHits: [], toasts: [],
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    setBlock(x, y, z, id) {
      if (y < 1 || y >= WORLD_Y) return false;
      if (!canReplace(world.getBlock(x, y, z), id)) return false;
      world.setBlock(x, y, z, id);
      noteBlockChanged(x, y, z);
      return true;
    },
    breakBlock(x, y, z, o) {
      const id = world.getBlock(x, y, z);
      if (id === Block.Air || !blockDef(id).breakable) return;
      const drops = o?.drops ?? true;
      g.broken.push({ x, y, z, id, drops });
      if (drops && !g.creative) {
        for (const d of blockDrops(id, random, null)) g.dropped.push({ ...d, x, y, z });
      }
      world.setBlock(x, y, z, Block.Air);
      noteBlockChanged(x, y, z);
      dispatchBreak(g, x, y, z, id, null);
    },
    heldItem: () => g.held,
    consumeHeld: () => g.held !== null,
    replaceHeld: (id) => { g.held = id; },
    give: (id, count) => { g.given.push({ id, count }); },
    dropItem: (x, y, z, id, count) => { g.dropped.push({ id, count, x, y, z }); },
    damagePlayer: (amount, cause) => { g.playerDamage.push({ amount, cause }); },
    healPlayer: NOOP,
    pushPlayer: (vx, vy, vz) => { g.pushes.push([vx, vy, vz]); },
    hurtMob: (mob, amount, fromX, fromZ) => {
      g.mobHits.push({ mob, amount });
      mob.hurt(amount, fromX, fromZ);
    },
    toast: (t) => { g.toasts.push(t); },
    chat: NOOP,
    breakParticles: NOOP,
    swing: NOOP,
    random,
    countItem: (id) => g.inventory.get(id) ?? 0,
    takeItem: (id, count) => {
      const have = g.inventory.get(id) ?? 0;
      if (have < count) return false;
      g.inventory.set(id, have - count);
      return true;
    },
    put(x, y, z, id) {
      world.setBlock(x, y, z, id);
    },
    run(seconds, dt = 1 / 60) {
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        g.clock += dt;
        projectiles.update(g, dt);
        explosions.update(g, dt);
        falling.update(g, dt);
        effects.update(dt);
        flushNeighbourChanges(g, 10000);
      }
    },
  };
  return g;
}

/** A context for right-clicking the block at (x, y, z) on its `face`. */
function useOn(g: Game, x: number, y: number, z: number, face: [number, number, number]): UseContext {
  return Object.assign(Object.create(g), {
    x, y, z, id: g.getBlock(x, y, z), face,
    point: [x + 0.5 + face[0] / 2, y + 0.5 + face[1] / 2, z + 0.5 + face[2] / 2],
    held: g.held, sneaking: false,
  }) as UseContext;
}

/** Points the player's view at a world point. */
function lookAt(p: Player, x: number, y: number, z: number): void {
  const dx = x - p.x;
  const dy = y - (p.y + EYE_HEIGHT);
  const dz = z - p.z;
  p.yaw = (Math.atan2(dz, dx) * 180) / Math.PI;
  p.pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
}

const approx = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

// --- registration -------------------------------------------------------------------

{
  const counts = registeredCounts();
  check('the pack registers a system to run and draw', counts.systems >= 1, JSON.stringify(counts));
  check('the bow has a release hook', hasRelease(Item.Bow));
  const g = makeGame();
  const before = projectiles.list.length;
  services.shoot(g, { x: 0, y: 50, z: 0, dx: 1, dy: 0, dz: 0, speed: 10, damage: 2, shooter: 'player', kind: 'arrow' });
  check('services.shoot is the combat pack\'s', projectiles.list.length === before + 1);
  g.put(3, Y, 3, Block.Stone);
  const blasts = explosions.history.length;
  services.explode(g, 3.5, Y + 0.5, 3.5, 2);
  check('services.explode is the combat pack\'s', explosions.history.length === blasts + 1);
}

// --- projectiles: flight -----------------------------------------------------------------

{
  // A level shot from high up, over nothing: it must fall, and by about what
  // gravity says over half a second (drag trims a little off).
  const g = makeGame();
  const p = projectiles.shoot(g, { x: 0, y: 70, z: 0.5, dx: 1, dy: 0, dz: 0, speed: 30, damage: 5, shooter: 'player', kind: 'arrow' });
  g.run(0.5);
  const drop = 70 - p.y;
  const expected = 0.5 * FLIGHT.arrow.gravity * 0.25;
  check('an arrow shot level falls under gravity', drop > expected * 0.8 && drop < expected * 1.1,
    `dropped ${drop.toFixed(2)}, free fall says ${expected.toFixed(2)}`);
  check('and carries on forward, slowed a little by drag', p.x > 12 && p.x < 15, `x=${p.x.toFixed(2)}`);
  check('it points along its path, nose down as it falls', p.hy < -0.1 && p.hx > 0.5,
    `heading ${p.hx.toFixed(2)},${p.hy.toFixed(2)}`);

  // A thrown snowball arcs up and comes down to burst on the floor, at
  // about the range its speed and gravity give (drag shortens it a little).
  const s = projectiles.shoot(g, { x: 0, y: Y + 1, z: 10.5, dx: 1, dy: 1, dz: 0, speed: 16, damage: 0, shooter: 'player', kind: 'snowball' });
  let snowX = 0;
  let snowPeak = 0;
  for (let i = 0; i < 240 && !s.dead; i++) {
    g.run(1 / 60);
    snowX = s.x;
    snowPeak = Math.max(snowPeak, s.y);
  }
  const range = (16 * 16) / FLIGHT.snowball.gravity;
  check('a thrown snowball arcs and bursts where it lands',
    s.dead && snowPeak > Y + 3 && snowX > range * 0.7 && snowX < range * 1.1,
    `landed at x=${snowX.toFixed(1)}, peak ${(snowPeak - Y).toFixed(1)} up, drag-free range ${range.toFixed(1)}`);
}

{
  // A wall across the path: the arrow stops at its face and sticks there.
  const g = makeGame();
  for (let y = Y; y < Y + 4; y++) for (let z = -2; z <= 2; z++) g.put(10, y, z, Block.Stone);
  const p = projectiles.shoot(g, { x: 0, y: Y + 1.5, z: 0.5, dx: 1, dy: 0, dz: 0, speed: 40, damage: 5, shooter: 'player', kind: 'arrow' });
  g.run(1);
  check('an arrow stops at a wall', p.stuck !== null && p.x >= 10 && p.x < 10.5,
    `x=${p.x.toFixed(3)} stuck=${JSON.stringify(p.stuck)}`);
  check('and sticks in the block it hit', p.stuck?.x === 10 && p.stuck?.id === Block.Stone);
  check('it has not gone through', g.getBlock(10, Math.floor(p.y), 0) === Block.Stone && p.x < 11);

  // Fast enough to cross a whole block in one frame, and still stopped.
  const fast = projectiles.shoot(g, { x: 0, y: Y + 2.5, z: -0.5, dx: 1, dy: 0, dz: 0, speed: 200, damage: 5, shooter: 'player', kind: 'arrow' });
  g.run(0.2, 1 / 20);
  check('even a shot covering several blocks a frame does not tunnel', fast.stuck !== null && fast.x < 10.5,
    `x=${fast.x.toFixed(2)}`);

  // The block it is in is broken: it comes loose and falls to the floor.
  g.breakBlock(10, Math.floor(p.y), 0);
  g.run(1.5);
  check('breaking the block drops a stuck arrow, which lands on the floor below',
    p.stuck !== null && p.stuck.y === GROUND && !p.dead, `stuck in ${JSON.stringify(p.stuck)}`);

  // Left alone long enough, a stuck arrow crumbles away.
  const before = projectiles.list.length;
  g.run(STUCK_LIFETIME + 1, 1 / 4);
  check('stuck arrows despawn after a while', projectiles.list.length < before && p.dead);
}

{
  // Real collision boxes, not cells: over the top of a bounce pad (12/16
  // tall) an arrow flies on; lower down it hits it.
  const g = makeGame();
  g.put(6, Y, 0, Block.BouncePad);
  const over = projectiles.shoot(g, { x: 0, y: Y + 0.95, z: 0.5, dx: 1, dy: 0, dz: 0, speed: 60, damage: 5, shooter: 'player', kind: 'arrow' });
  const into = projectiles.shoot(g, { x: 0, y: Y + 0.5, z: 0.5, dx: 1, dy: 0, dz: 0, speed: 60, damage: 5, shooter: 'player', kind: 'arrow' });
  g.run(0.2);
  check('an arrow skims over a low block\'s real shape', over.stuck === null || over.stuck.id !== Block.BouncePad,
    `stuck=${JSON.stringify(over.stuck)} x=${over.x.toFixed(1)}`);
  check('and hits it when lower', into.stuck?.id === Block.BouncePad, `stuck=${JSON.stringify(into.stuck)}`);
}

{
  // Walking over a player's stuck arrow takes it back; a creative shot and a
  // mob's arrow cannot be collected.
  const g = makeGame();
  const mine = projectiles.shoot(g, { x: 3.5, y: Y + 1, z: 0.5, dx: 0, dy: -1, dz: 0, speed: 20, damage: 5, shooter: 'player', kind: 'arrow' });
  const zombie = g.mobs.spawn(MobKind.Zombie, -8.5, Y, -8.5);
  const theirs = projectiles.shoot(g, { x: 2.5, y: Y + 1, z: 0.5, dx: 0, dy: -1, dz: 0, speed: 20, damage: 5, shooter: zombie, kind: 'arrow' });
  g.run(0.3);
  check('an arrow fired down sticks in the floor', mine.stuck?.y === GROUND && theirs.stuck?.y === GROUND);
  g.player.x = 3.5 - PICKUP_RADIUS - 0.5;
  g.run(0.1);
  check('out of reach, a stuck arrow stays put', !mine.dead && g.given.length === 0);
  g.player.x = 3.2;
  g.run(0.1);
  check('walking over it picks it back up', mine.dead && g.given.some((s) => s.id === Item.Arrow && s.count === 1));
  g.player.x = 2.5;
  g.run(0.1);
  check('a mob\'s arrow cannot be collected', !theirs.dead && g.given.length === 1);

  const c = makeGame({ creative: true });
  const free = projectiles.shoot(c, { x: 1.5, y: Y + 1, z: 0.5, dx: 0, dy: -1, dz: 0, speed: 20, damage: 5, shooter: 'player', kind: 'arrow' });
  c.run(0.5);
  check('an arrow shot in creative is not a free arrow to collect', !free.pickup && !free.dead && c.given.length === 0);
}

// --- projectiles: hitting things ---------------------------------------------------------------

{
  const g = makeGame();
  const zombie = g.mobs.spawn(MobKind.Zombie, 8.5, Y, 0.5);
  const health = zombie.health;
  const p = projectiles.shoot(g, { x: 0.5, y: Y + 1.2, z: 0.5, dx: 1, dy: 0, dz: 0, speed: 40, damage: 6, shooter: 'player', kind: 'arrow' });
  g.run(0.5);
  check('an arrow hurts the mob in its path', zombie.health < health && g.mobHits.length === 1,
    `health ${health} -> ${zombie.health}`);
  check('by about its damage at near full speed', g.mobHits[0]?.amount >= 5 && g.mobHits[0]?.amount <= 6,
    `hit for ${g.mobHits[0]?.amount}`);
  check('and is spent on it', p.dead);
  check('the mob is knocked up off its feet', zombie.vy > 0 || !zombie.onGround);

  // A slow arrow does less.
  const g2 = makeGame();
  const z2 = g2.mobs.spawn(MobKind.Zombie, 3.5, Y, 0.5);
  const slow = projectiles.shoot(g2, { x: 0.5, y: Y + 1.4, z: 0.5, dx: 1, dy: 0, dz: 0, speed: 40, damage: 6, shooter: 'player', kind: 'arrow' });
  slow.vx = 8; // as if it had flown a long way
  g2.run(0.6);
  check('a spent arrow hits for less', g2.mobHits.length === 1 && g2.mobHits[0].amount < 6 && g2.mobHits[0].amount >= 1,
    `hit for ${g2.mobHits[0]?.amount}`);
  void z2;
}

{
  // A mob's arrow starts inside the mob that fired it and must not hit it;
  // it carries on and hits the player.
  const g = makeGame();
  const archer = g.mobs.spawn(MobKind.Zombie, 0.5, Y, 0.5);
  g.player.x = 6.5; g.player.y = Y; g.player.z = 0.5;
  projectiles.shoot(g, { x: 0.5, y: Y + 1.3, z: 0.5, dx: 1, dy: 0, dz: 0, speed: 30, damage: 4, shooter: archer, kind: 'arrow' });
  g.run(0.5);
  check('a shooter is never hit by its own arrow', archer.health === archer.def.health && g.mobHits.length === 0);
  check('a mob\'s arrow hurts the player', g.playerDamage.length === 1 && g.playerDamage[0].amount >= 3,
    JSON.stringify(g.playerDamage));
  check('and pushes them along its flight', g.pushes.length === 1 && g.pushes[0][0] > 0);

  // The player's own arrow, starting inside the player's body, does not.
  const h = makeGame();
  projectiles.shoot(h, { x: 0.5, y: Y + 1, z: 0.5, dx: 1, dy: 0, dz: 0, speed: 30, damage: 4, shooter: 'player', kind: 'arrow' });
  projectiles.shoot(h, { x: 0.5, y: Y + 3, z: 0.5, dx: 0, dy: -1, dz: 0, speed: 30, damage: 4, shooter: 'player', kind: 'arrow' });
  h.run(0.5);
  check('the player\'s arrows never hit the player, even straight down on them', h.playerDamage.length === 0);
}

{
  // Snowballs sting nothing but a blaze, and knock back what they hit.
  const g = makeGame();
  const zombie = g.mobs.spawn(MobKind.Zombie, 5.5, Y, 0.5);
  const blaze = g.mobs.spawn(MobKind.Blaze, 5.5, Y, 4.5);
  projectiles.shoot(g, { x: 0.5, y: Y + 1.2, z: 0.5, dx: 1, dy: 0, dz: 0, speed: 25, damage: 0, shooter: 'player', kind: 'snowball' });
  projectiles.shoot(g, { x: 0.5, y: Y + 1, z: 4.5, dx: 1, dy: 0, dz: 0, speed: 25, damage: 0, shooter: 'player', kind: 'snowball' });
  const puffs = effects.puffs.length;
  g.run(0.1);
  g.run(0.3);
  check('a snowball does no damage to a zombie', zombie.health === zombie.def.health && g.mobHits.some((h) => h.mob === zombie && h.amount === 0));
  check('but knocks it back', zombie.vy > 0 || !zombie.onGround);
  check('it stings a blaze', blaze.health === blaze.def.health - 3, `blaze ${blaze.health}`);
  check('and bursts into a puff of snow', effects.puffs.length > puffs);

  // A fireball burns the player, is nothing to a blaze, and lights TNT.
  const f = makeGame();
  const shooter = f.mobs.spawn(MobKind.Blaze, 0.5, Y + 1, 5.5);
  f.player.x = 6.5; f.player.z = 5.5;
  projectiles.shoot(f, { x: 0.5, y: Y + 1.5, z: 5.5, dx: 1, dy: 0, dz: 0, speed: 20, damage: 5, shooter, kind: 'fireball' });
  f.put(8, Y, 0, Block.TNT);
  projectiles.shoot(f, { x: 0.5, y: Y + 0.5, z: 0.5, dx: 1, dy: 0, dz: 0, speed: 20, damage: 5, shooter, kind: 'fireball' });
  f.run(0.6);
  check('a fireball burns the player', f.playerDamage.some((d) => d.amount === 5 && /burn/.test(d.cause)), JSON.stringify(f.playerDamage));
  check('a fireball landing on TNT lights it', f.getBlock(8, Y, 0) === Block.Air && explosions.charges.length === 1);
}

// --- the bow ------------------------------------------------------------------------------------

{
  check('bow power grows with draw time', bowPower(0.3) < bowPower(0.6) && bowPower(0.6) < bowPower(0.9),
    [0.3, 0.6, 0.9].map((t) => bowPower(t).toFixed(2)).join(' '));
  check('a full draw is full power, and holding longer adds nothing', bowPower(1) === 1 && bowPower(4) === 1);
  check('a tap is only a dribble', bowPower(0.1) <= 0.12 && bowPower(0.1) > 0);

  const g = makeGame();
  g.held = Item.Bow;
  g.inventory.set(Item.Arrow, 2);
  g.player.pitch = 0;
  check('drawing the bow is handled', dispatchUseAir(g, Item.Bow) && isDrawing());
  const before = projectiles.list.length;
  dispatchRelease(g, Item.Bow, 1.0);
  const full = projectiles.list[projectiles.list.length - 1];
  check('letting go looses an arrow', projectiles.list.length === before + 1 && full.shooter === 'player');
  check('a full draw flies at full speed', approx(Math.hypot(full.vx, full.vy, full.vz), ARROW_SPEED, 0.01),
    `speed ${Math.hypot(full.vx, full.vy, full.vz).toFixed(2)}`);
  check('it spends an arrow', g.inventory.get(Item.Arrow) === 1);

  dispatchUseAir(g, Item.Bow);
  dispatchRelease(g, Item.Bow, 0.1);
  const weak = projectiles.list[projectiles.list.length - 1];
  check('a quick tap is a weak dribble', Math.hypot(weak.vx, weak.vy, weak.vz) < ARROW_SPEED * 0.15 && weak.damage < full.damage);
  check('and still spends an arrow', g.inventory.get(Item.Arrow) === 0);

  const count = projectiles.list.length;
  dispatchUseAir(g, Item.Bow);
  check('with no arrows the bow will not draw', !isDrawing() && g.toasts.some((t) => /arrow/i.test(t)));
  dispatchRelease(g, Item.Bow, 1);
  check('and nothing is fired', projectiles.list.length === count);

  const c = makeGame({ creative: true });
  c.held = Item.Bow;
  dispatchUseAir(c, Item.Bow);
  dispatchRelease(c, Item.Bow, 1);
  check('in creative the bow needs no arrows', projectiles.list.length === 1);

  // A full-power shot, level from head height, reaches well across the map.
  const r = makeGame({ creative: true });
  r.held = Item.Bow;
  r.player.pitch = 10;
  dispatchUseAir(r, Item.Bow);
  dispatchRelease(r, Item.Bow, 1);
  const shot = projectiles.list[0];
  const shortShot = projectiles.shoot(r, { x: r.player.x, y: Y + 1.5, z: 3.5, dx: Math.cos(10 * Math.PI / 180), dy: Math.sin(10 * Math.PI / 180), dz: 0, speed: ARROW_SPEED * bowPower(0.4), damage: 3, shooter: 'player', kind: 'arrow' });
  r.run(3);
  check('a fuller draw carries further', shot.x > shortShot.x + 5, `full ${shot.x.toFixed(1)}, part ${shortShot.x.toFixed(1)}`);
}

{
  // Snowballs are thrown from the hand, one at a time.
  const g = makeGame();
  g.held = Item.Snowball;
  const before = projectiles.list.length;
  check('right-clicking a snowball throws it', dispatchUseAir(g, Item.Snowball) &&
    projectiles.list.length === before + 1 && projectiles.list[before].kind === 'snowball');
}

// --- hammers -----------------------------------------------------------------------------------

{
  const byId = new Map(HAMMERS.map((h) => [h.id, h]));
  const pick = [Item.WoodPickaxe, Item.StonePickaxe, Item.IronPickaxe, Item.DiamondPickaxe];
  for (const [id, tier] of [[Item.StoneHammer, 2], [Item.IronHammer, 3], [Item.DiamondHammer, 4]] as const) {
    const t = toolSpec(id)!;
    const p = toolSpec(pick[tier - 1])!;
    check(`${itemDef(id).name}: mines as a tier-${tier} pickaxe`, t.kind === 'hammer' && t.actsAs === 'pickaxe' && t.tier === tier);
    check(`${itemDef(id).name}: slower than the same pickaxe, and lasts about twice as long`,
      t.speed < p.speed && t.durability >= p.durability * 1.8 && t.durability <= p.durability * 2.6,
      `speed ${t.speed} vs ${p.speed}, durability ${t.durability} vs ${p.durability}`);
    check(`${itemDef(id).name}: hits hard`, (itemDef(id).attack ?? 0) >= 6 && (itemDef(id).attack ?? 0) <= 8);
    void byId;
  }
  check('a stone hammer harvests iron ore but not diamond ore',
    canHarvest(Block.IronOre, Item.StoneHammer) && !canHarvest(Block.DiamondOre, Item.StoneHammer));
}

{
  // A wall in front of the player, looking along +x: the square is in y/z.
  const g = makeGame();
  g.held = Item.StoneHammer;
  const X = 5;
  const layout: Record<string, number> = {
    '-1,-1': Block.Stone, '-1,0': Block.IronOre, '-1,1': Block.DiamondOre,
    '0,-1': Block.Dirt, '0,1': Block.Cobblestone,
    '1,-1': Block.Obsidian, '1,0': Block.Chest, '1,1': Block.Stone,
  };
  const cy = Y + 1;
  for (const [key, id] of Object.entries(layout)) {
    const [dy, dz] = key.split(',').map(Number);
    g.put(X, cy + dy, dz, id);
  }
  g.put(X + 1, cy, 0, Block.Stone);   // behind the struck block
  g.put(X, cy, 2, Block.Stone);       // just outside the square
  g.put(X, cy, 0, Block.Stone);       // the block struck
  lookAt(g.player, X, cy + 0.5, 0.5);
  // Break it the way main.ts does: gone first, then the hooks.
  g.put(X, cy, 0, Block.Air);
  dispatchBreak(g, X, cy, 0, Block.Stone, Item.StoneHammer);
  const left = (dy: number, dz: number) => g.getBlock(X, cy + dy, dz);
  check('the hammer takes the stone and cobblestone in the square',
    left(-1, -1) === Block.Air && left(1, 1) === Block.Air && left(0, 1) === Block.Air);
  check('and ore its tier can harvest', left(-1, 0) === Block.Air);
  check('but not ore it cannot', left(-1, 1) === Block.DiamondOre);
  check('nor what a pickaxe is not for', left(0, -1) === Block.Dirt);
  check('nor anything far harder than what was struck', left(1, -1) === Block.Obsidian);
  check('nor a machine that may hold things', left(1, 0) === Block.Chest);
  check('nothing behind the square or outside it',
    g.getBlock(X + 1, cy, 0) === Block.Stone && g.getBlock(X, cy, 2) === Block.Stone);
  check('exactly four blocks went', g.broken.length === 4, `${g.broken.length} broken`);

  // Looking down, the square lies flat.
  const d = makeGame();
  d.held = Item.IronHammer;
  lookAt(d.player, 0.5, GROUND + 0.5, 0.5);
  d.player.pitch = -89;
  const cells = hammerTargets(d, 3, GROUND, 3, Block.Stone, Item.IronHammer);
  check('looking down, the hammer clears a 3x3 of floor', cells.length === 8 && cells.every(([, y]) => y === GROUND),
    JSON.stringify(cells.slice(0, 3)));
  check('struck on dirt, a hammer takes nothing else', hammerTargets(d, 3, GROUND, 3, Block.Dirt, Item.IronHammer).length === 0);
  // Bedrock sits at y=0; never taken.
  d.put(4, 1, 3, Block.Bedrock);
  check('never bedrock', !hammerTargets(d, 3, 1, 3, Block.Stone, Item.DiamondHammer).some(([x, y, z]) => x === 4 && y === 1 && z === 3));

  // Any other tool breaks one block.
  const p = makeGame();
  p.held = Item.IronPickaxe;
  for (let z = -1; z <= 1; z++) p.put(4, Y, z, Block.Stone);
  lookAt(p.player, 4.5, Y + 0.5, 0.5);
  p.put(4, Y, 0, Block.Air);
  dispatchBreak(p, 4, Y, 0, Block.Stone, Item.IronPickaxe);
  check('a pickaxe breaks only the one block', p.broken.length === 0 && p.getBlock(4, Y, 1) === Block.Stone);
}

// --- buckets ------------------------------------------------------------------------------------

{
  const g = makeGame();
  g.put(3, GROUND, 0, Block.Water);
  g.put(3, GROUND, 3, Block.Lava);
  g.held = Item.Bucket;
  lookAt(g.player, 3.5, GROUND + 0.9, 0.5);
  check('the bucket sees the water the cursor looks through', liquidInSight(g)?.id === Block.Water);
  check('using an empty bucket on water is handled', dispatchUseAir(g, Item.Bucket));
  check('it fills with water', g.held === Item.WaterBucket);
  check('and the water is gone from the world', g.getBlock(3, GROUND, 0) === Block.Air);
  check('scooping is a change the server accepts', canReplace(Block.Water, Block.Air));

  g.held = Item.Bucket;
  lookAt(g.player, 3.5, GROUND + 0.9, 3.5);
  dispatchUseAir(g, Item.Bucket);
  check('an empty bucket fills with lava from lava', g.held === Item.LavaBucket && g.getBlock(3, GROUND, 3) === Block.Air);

  // Pouring: against the top face of the floor, the liquid goes in the cell above.
  g.held = Item.WaterBucket;
  const ctx = useOn(g, 6, GROUND, 0, [0, 1, 0]);
  check('pouring a water bucket is handled', dispatchUse(ctx));
  check('the water lands against the clicked face', g.getBlock(6, Y, 0) === Block.Water);
  check('and the bucket comes back empty', g.held === Item.Bucket);
  check('pouring is a change the server accepts', canReplace(Block.Air, Block.Water) && canReplace(Block.Air, Block.Lava));

  // Against a side face the liquid goes beside it -- unless that cell is
  // solid, when nothing is poured and the bucket stays full.
  g.put(7, Y, 0, Block.Stone);
  g.held = Item.LavaBucket;
  dispatchUse(useOn(g, 7, Y, 0, [1, 0, 0]));
  check('a lava bucket pours lava beside a side face', g.getBlock(8, Y, 0) === Block.Lava && g.held === Item.Bucket);
  g.held = Item.LavaBucket;
  dispatchUse(useOn(g, 7, GROUND, 0, [1, 0, 0]));
  check('with solid ground in the way, nothing is poured', g.getBlock(8, GROUND, 0) === Block.Stone && g.held === Item.LavaBucket);

  // Water on lava cools it to obsidian.
  g.put(9, Y, 5, Block.Lava);
  g.held = Item.WaterBucket;
  dispatchUse(useOn(g, 9, GROUND, 5, [0, 1, 0]));
  check('water poured onto lava sets it to obsidian', g.getBlock(9, Y, 5) === Block.Obsidian && g.held === Item.Bucket);

  // Something in the way: nothing to scoop.
  const w = makeGame();
  w.put(4, GROUND, 0, Block.Water);
  w.put(2, Y, 0, Block.Stone);
  w.put(2, Y + 1, 0, Block.Stone);
  w.held = Item.Bucket;
  lookAt(w.player, 4.5, GROUND + 0.9, 0.5);
  dispatchUseAir(w, Item.Bucket);
  check('a bucket cannot reach water behind a wall', w.held === Item.Bucket && w.getBlock(4, GROUND, 0) === Block.Water);

  // The Nether boils water away.
  const n = makeGame({ dimension: Dimension.Nether });
  n.held = Item.WaterBucket;
  dispatchUse(useOn(n, 3, GROUND, 0, [0, 1, 0]));
  check('water poured in the Nether boils away', n.getBlock(3, Y, 0) === Block.Air && n.held === Item.Bucket);
}

// --- TNT and explosions -------------------------------------------------------------------------

{
  const g = makeGame();
  g.put(4, Y, 0, Block.TNT);
  g.put(6, Y, 0, Block.Obsidian);
  g.held = Item.FlintAndSteel;
  check('flint and steel on obsidian is left to the portal code', !dispatchUse(useOn(g, 6, Y, 0, [0, 1, 0])));
  check('flint and steel on TNT lights it', dispatchUse(useOn(g, 4, Y, 0, [0, 1, 0])));
  check('the block becomes a lit charge', g.getBlock(4, Y, 0) === Block.Air && explosions.charges.length === 1);
  const charge = explosions.charges[0];
  g.run(0.5);
  check('a lit charge hops, then settles on the floor', approx(charge.y, Y, 0.02), `y=${charge.y.toFixed(3)}`);
  g.run(FUSE_SECONDS - 0.7);
  check('and has not gone off before its fuse runs out', explosions.charges.length === 1 && explosions.history.length === 0);
  g.run(0.4);
  check('it goes off after about four seconds', explosions.charges.length === 0 && explosions.history.length === 1);
  check('and blows a hole in the floor', g.getBlock(4, GROUND, 0) === Block.Air);
  check('the obsidian beside it is untouched', g.getBlock(6, Y, 0) === Block.Obsidian);

  // A charge lit in mid-air falls.
  const h = makeGame();
  h.put(0, Y + 6, 5, Block.TNT);
  explosions.prime(h, 0, Y + 6, 5);
  h.run(1.2);
  check('a lit charge falls under gravity', approx(explosions.charges[0].y, Y, 0.02), `y=${explosions.charges[0].y.toFixed(2)}`);
}

{
  // Blast size by material. The same charge carves further through dirt
  // than through stone; the rays decide both.
  const solid = (fill: number) => (x: number, y: number, z: number) =>
    Math.abs(x) < 20 && Math.abs(y - 60) < 20 && Math.abs(z) < 20 ? fill : Block.Air;
  const reach = (cells: Array<[number, number, number]>) =>
    Math.max(...cells.map(([x, y, z]) => Math.hypot(x + 0.5, y + 0.5 - 60, z + 0.5)));
  const inStone = blastCells(solid(Block.Stone), 0.5, 60.5, 0.5, TNT_POWER, rng(3));
  const inDirt = blastCells(solid(Block.Dirt), 0.5, 60.5, 0.5, TNT_POWER, rng(3));
  const inAir = blastCells((x, y, z) => (Math.hypot(x + 0.5, y - 59.5, z + 0.5) > 5.5 ? Block.Stone : Block.Air), 0.5, 60.5, 0.5, TNT_POWER, rng(3));
  check('TNT in solid stone digs a crater about two blocks across each way',
    reach(inStone) >= 1.5 && reach(inStone) <= 3.6, `reach ${reach(inStone).toFixed(2)}, ${inStone.length} cells`);
  check('softer ground gives a bigger crater', reach(inDirt) > reach(inStone) && inDirt.length > inStone.length * 1.5,
    `dirt reach ${reach(inDirt).toFixed(2)} (${inDirt.length}), stone ${reach(inStone).toFixed(2)} (${inStone.length})`);
  check('in open air the blast reaches the walls of a room 5 blocks out', inAir.length > 20, `${inAir.length} cells`);
  check('the crater is roughly round', (() => {
    const xs = inStone.map(([x]) => x);
    const ys = inStone.map(([, y]) => y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    return Math.abs(spanX - spanY) <= 1;
  })());

  // Obsidian, bedrock and liquids are never taken, and shelter what is behind.
  const wall = (x: number, y: number, z: number) => {
    if (x === 2 && Math.abs(y - 60) <= 3 && Math.abs(z) <= 3) return Block.Obsidian;
    if (x === 3 && y === 60 && z === 0) return Block.Planks;
    if (x === -2 && y === 60 && z === 0) return Block.Water;
    if (x === -3 && y === 60 && z === 0) return Block.Planks;
    if (x === 0 && y === 58 && z === 0) return Block.Bedrock;
    return Block.Air;
  };
  const cells = blastCells(wall, 0.5, 60.5, 0.5, TNT_POWER, rng(4));
  const has = (x: number, y: number, z: number) => cells.some((c) => c[0] === x && c[1] === y && c[2] === z);
  check('obsidian is never destroyed', !cells.some(([x]) => x === 2));
  check('and what is behind it is sheltered', !has(3, 60, 0));
  check('bedrock is never destroyed', !has(0, 58, 0));
  check('liquids are left alone', !has(-2, 60, 0));
  check('but absorb the blast, sheltering what is behind', !has(-3, 60, 0));
  const open = blastCells((x, y, z) => (x === 3 && y === 60 && z === 0 ? Block.Planks : Block.Air), 0.5, 60.5, 0.5, TNT_POWER, rng(4));
  check('without the wall, the same planks are blown away', open.length === 1);
}

{
  // A real blast in a real world: about 30% of what it destroys drops.
  const g = makeGame();
  for (let x = -6; x <= 6; x++) for (let y = Y; y < Y + 6; y++) for (let z = -6; z <= 6; z++) g.put(x, y, z, Block.Dirt);
  g.player.x = 0.5; g.player.y = Y + 20; g.player.z = 20.5;
  g.put(0, Y + 2, 0, Block.Air);
  g.put(0, Y + 3, 1, Block.Furnace);
  let sounds = 0;
  let debris = 0;
  g.sound = new Proxy({}, { get: () => () => { sounds++; } }) as GameContext['sound'];
  g.breakParticles = () => { debris++; };
  const solidBefore: Array<[number, number, number]> = [];
  for (let x = -10; x <= 10; x++) {
    for (let y = GROUND - 8; y < Y + 10; y++) {
      for (let z = -10; z <= 10; z++) if (g.getBlock(x, y, z) !== Block.Air) solidBefore.push([x, y, z]);
    }
  }
  explosions.explode(g, 0.5, Y + 2.5, 0.5, TNT_POWER);
  const total = explosions.history[explosions.history.length - 1].destroyed;
  const air = solidBefore.filter(([x, y, z]) => g.getBlock(x, y, z) === Block.Air).length;
  const dropped = g.dropped.filter((d) => d.id === Block.Dirt).length;
  check('a blast destroys a good crater of dirt', total > 60 && air === total, `${total} blocks, ${air} now air`);
  check(`about ${DROP_CHANCE * 100}% of them drop as items`, dropped / total > DROP_CHANCE - 0.1 && dropped / total < DROP_CHANCE + 0.1,
    `${dropped}/${total}`);
  check('a machine in the blast is broken the way that returns what it held',
    g.broken.length === 1 && g.broken[0].id === Block.Furnace, JSON.stringify(g.broken.map((b) => b.id)));
  check('the blast is one bang, not a break sound per block', sounds <= 4, `${sounds} sounds`);
  check('and throws debris from a spread of the crater', debris >= 10 && debris <= 30, `${debris} bursts`);
  check('the blast leaves smoke and flame behind', effects.puffs.length > 40);
}

{
  // Damage falls off with distance, and walls shelter.
  const hitAt = (distance: number, wall = false): { damage: number; push: [number, number, number] | null } => {
    const g = makeGame();
    g.player.x = 0.5 + distance; g.player.y = Y; g.player.z = 0.5;
    if (wall) for (let y = Y; y < Y + 4; y++) for (let z = -3; z <= 3; z++) g.put(2, y, z, Block.Obsidian);
    explosions.explode(g, 0.5, Y + 0.9, 0.5, TNT_POWER);
    return { damage: g.playerDamage.reduce((a, d) => a + d.amount, 0), push: g.pushes[0] ?? null };
  };
  const near = hitAt(1);
  const mid = hitAt(4);
  const far = hitAt(7);
  const out = hitAt(9);
  check('the blast hurts most up close', near.damage > mid.damage && mid.damage > far.damage,
    `${near.damage} > ${mid.damage} > ${far.damage}`);
  check('point blank TNT is nearly lethal before armour', near.damage >= 14 && near.damage <= 20, `${near.damage}`);
  check('out of reach, nothing', out.damage === 0 && out.push === null);
  check('the blast throws the player away from it', near.push !== null && near.push[0] > 0 && near.push[1] > 0,
    JSON.stringify(near.push));
  check('and harder up close', (near.push?.[0] ?? 0) > (mid.push?.[0] ?? 0));
  const sheltered = hitAt(4, true);
  check('a wall between you and the blast shelters you', sheltered.damage < mid.damage * 0.5,
    `${sheltered.damage} behind a wall vs ${mid.damage}`);
  check('the formula agrees: no impact at twice the power', impactAt(TNT_POWER, TNT_POWER * 2, 1) === 0 && blastDamage(TNT_POWER, 0) === 0);

  // Mobs are hurt and thrown too.
  const g = makeGame();
  const zombie = g.mobs.spawn(MobKind.Zombie, 2.5, Y, 0.5);
  const far2 = g.mobs.spawn(MobKind.Pig, 14.5, Y, 0.5);
  explosions.explode(g, 0.5, Y + 0.9, 0.5, TNT_POWER);
  check('a mob near the blast is hurt', zombie.health < zombie.def.health && zombie.vy > 0, `health ${zombie.health}`);
  check('a mob out of reach is not', far2.health === far2.def.health);
}

{
  // Chain reaction: a blast lights the charges near it on a short fuse.
  const g = makeGame();
  g.player.y = Y + 40;
  g.put(0, Y, 0, Block.TNT);
  g.put(2, Y, 0, Block.TNT);
  g.put(0, Y, 2, Block.TNT);
  g.put(12, Y, 12, Block.TNT);
  explosions.prime(g, 0, Y, 0);
  g.run(FUSE_SECONDS + 0.1);
  check('the first charge went off', explosions.history.length >= 1);
  const lit = explosions.charges.length;
  check('and lit the charges beside it', lit === 2 && g.getBlock(2, Y, 0) === Block.Air && g.getBlock(0, Y, 2) === Block.Air,
    `${lit} lit`);
  check('on a short fuse', explosions.charges.every((c) => c.fuse <= CHAIN_FUSE_MAX));
  check('but not one far away', g.getBlock(12, Y, 12) === Block.TNT);
  g.run(CHAIN_FUSE_MAX + 0.2);
  check('the chain goes off', explosions.history.length === 3 && explosions.charges.length === 0,
    `${explosions.history.length} blasts`);
}

// --- falling blocks ------------------------------------------------------------------------------

{
  // Placed in mid-air: sand falls and lands on the floor.
  const g = makeGame();
  g.put(3, Y + 5, 0, Block.Sand);
  dispatchAfterPlace(g, 3, Y + 5, 0, Block.Sand);
  check('sand with nothing under it starts to fall', g.getBlock(3, Y + 5, 0) === Block.Air && falling.list.length === 1);
  g.run(0.2);
  check('and is still falling a moment later', falling.list.length === 1 && falling.list[0].y < Y + 5);
  g.run(2);
  check('it lands on the floor as sand again', g.getBlock(3, Y, 0) === Block.Sand && falling.list.length === 0);

  // Supported sand stays.
  g.put(5, Y, 0, Block.Sand);
  dispatchAfterPlace(g, 5, Y, 0, Block.Sand);
  check('sand on the ground stays put', g.getBlock(5, Y, 0) === Block.Sand && falling.list.length === 0);

  // A column loses its support: all of it comes down, in order, and stacks.
  g.put(8, Y, 0, Block.Dirt);
  for (let y = Y + 1; y <= Y + 3; y++) g.put(8, y, 0, Block.Gravel);
  g.breakBlock(8, Y, 0);
  g.run(3);
  check('a whole column falls when its support is broken',
    g.getBlock(8, Y, 0) === Block.Gravel && g.getBlock(8, Y + 1, 0) === Block.Gravel &&
    g.getBlock(8, Y + 2, 0) === Block.Gravel && g.getBlock(8, Y + 3, 0) === Block.Air,
    [0, 1, 2, 3].map((d) => g.getBlock(8, Y + d, 0)).join(','));

  // Through water, to the bed.
  g.put(10, Y, 0, Block.Water);
  g.put(10, Y + 1, 0, Block.Water);
  g.put(10, Y + 4, 0, Block.Sand);
  dispatchAfterPlace(g, 10, Y + 4, 0, Block.Sand);
  g.run(3);
  check('sand sinks through water to the bottom', g.getBlock(10, Y, 0) === Block.Sand && g.getBlock(10, Y + 1, 0) === Block.Water);

  // Onto a torch: it cannot sit there, so it drops as an item.
  g.put(12, Y, 0, Block.Torch);
  g.put(12, Y + 4, 0, Block.Sand);
  dispatchAfterPlace(g, 12, Y + 4, 0, Block.Sand);
  g.run(3);
  check('sand landing on a torch breaks into an item', g.dropped.some((d) => d.id === Block.Sand && d.count === 1) &&
    g.getBlock(12, Y + 1, 0) === Block.Air);
  check('and the torch survives', g.getBlock(12, Y, 0) === Block.Torch);
  check('what came down is recorded', falling.landings.some((l) => !l.placed && l.x === 12));
}

// --- bounce pad and spikes --------------------------------------------------------------------------

{
  const def = blockDef(Block.BouncePad);
  check('bounce pad: springy', def.bounce === BOUNCE_PAD_BOUNCE && BOUNCE_PAD_BOUNCE >= 0.8 && BOUNCE_PAD_BOUNCE < 1);
  check('bounce pad: not a full cube, so its neighbours still draw', !def.opaque);
  check('bounce pad: stood on at 12/16', collisionOf(Block.BouncePad).length === 1 && collisionOf(Block.BouncePad)[0].y1 === 0.75);
  check('bounce pad: a spring model, not a slab', shapeOf(Block.BouncePad).length >= 5);
  check('bounce pad: outlined as what you stand on', selectionOf(Block.BouncePad)[0].y1 === 0.75);

  const keys = (over: Partial<InputState> = {}): InputState => ({
    forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false, ...over,
  });
  /** Drops the player `height` blocks onto a pad, stepping at `fps`, and measures the rebound. */
  const drop = (sneak: boolean, height: number, fps = 60) => {
    const g = makeGame();
    g.put(0, Y, 0, Block.BouncePad);
    const p = g.player;
    p.x = 0.5; p.y = Y + 0.75 + height; p.z = 0.5; p.vy = 0;
    let peak = -Infinity;
    let landed = false;
    let bounced = false;
    for (let i = 0; i < fps * 4; i++) {
      p.update(1 / fps, g.world, keys({ sneak }));
      if (p.vy > 0) bounced = true;
      if (bounced) peak = Math.max(peak, p.y);
      if (p.onGround) landed = true;
      if (bounced && p.vy < 0 && peak > -Infinity) break;
    }
    return { bounced, peak: peak - (Y + 0.75), landed, softLanding: p.softLanding };
  };
  const bounce = drop(false, 6);
  // 0.85 of the landing speed is 0.72 of the height: about 4.3 of 6.
  check('landing on a bounce pad throws you back up', bounce.bounced && bounce.peak > 3.8 && bounce.peak < 6,
    `back up ${bounce.peak.toFixed(2)} of a 6 block drop`);
  check('and cancels the fall damage', bounce.softLanding);
  const sneaking = drop(true, 6);
  check('sneaking onto it lands normally', !sneaking.bounced && sneaking.landed);

  // A fast landing -- a long drop, or a slow frame -- is sub-stepped by the
  // player's physics, and the sub-steps after the bounce used to carry the
  // frame's downward travel, land on the pad again and zero the rebound.
  for (const [height, fps] of [[10, 60], [3, 30]] as const) {
    const hard = drop(false, height, fps);
    check(`a ${height} block drop at ${fps} fps bounces too`, hard.bounced && hard.peak > height * 0.6,
      `back up ${hard.peak.toFixed(2)}`);
  }

  const spikes = blockDef(Block.IronSpikes);
  check('spikes: walked into, not onto', !spikes.solid && !spikes.opaque && collisionOf(Block.IronSpikes).length === 0);
  check('spikes: hurt and slow whoever is in them', spikes.contactDamage > 0 && spikes.speedFactor < 1);
  check('spikes: drawn as points on a plate', shapeOf(Block.IronSpikes).length > 10);
  const g = makeGame();
  g.put(4, Y, 0, Block.IronSpikes);
  const zombie = g.mobs.spawn(MobKind.Zombie, 4.5, Y, 0.5);
  // The pack's own system, as main.ts runs it -- not updateSystems, which
  // would run every other pack's systems against this fake world too.
  for (let i = 0; i < 60; i++) combatSystem.update!(g, 1 / 60);
  check('a mob standing in spikes is bitten, about twice a second',
    g.mobHits.filter((h) => h.mob === zombie).length === 2 && zombie.health === zombie.def.health - SPIKE_BITE * 2,
    `${g.mobHits.length} bites, health ${zombie.health}`);
}

// --- recipes --------------------------------------------------------------------------------------

{
  /** A 3x3 grid with the recipe's own layout in its top-left corner. */
  const gridFor = (r: Recipe) => {
    const layout = recipeLayout(r);
    const cells: Array<number | null> = new Array(9).fill(null);
    for (let y = 0; y < layout.height; y++) {
      for (let x = 0; x < layout.width; x++) cells[y * 3 + x] = layout.cells[y * layout.width + x];
    }
    return { width: 3, height: 3, cells };
  };
  for (const r of COMBAT.recipes ?? []) {
    const name = itemDef(r.result.id).name;
    const found = findRecipe(gridFor(r));
    check(`recipe for ${name} crafts ${name}`, found === r, found ? itemDef(found.result.id).name : 'nothing');
    const same = RECIPES.filter((o) => o !== r && o.pattern &&
      JSON.stringify(recipeLayout(o)) === JSON.stringify(recipeLayout(r)));
    check(`recipe for ${name} is unambiguous against every other recipe`, same.length === 0,
      same.map((o) => itemDef(o.result.id).name).join(','));
  }
  // And the pack takes nothing away: a pickaxe is still a pickaxe.
  const pickaxe = RECIPES.find((r) => r.result.id === Item.StonePickaxe)!;
  check('a stone pickaxe still crafts as a pickaxe', findRecipe(gridFor(pickaxe))?.result.id === Item.StonePickaxe);
}

// --- drawing ---------------------------------------------------------------------------------------

{
  const g = makeGame();
  const atlas = nodeAtlas();
  const p = projectiles.shoot(g, { x: 0.5, y: 60, z: 0.5, dx: 1, dy: 1, dz: 0, speed: 20, damage: 1, shooter: 'player', kind: 'arrow' });
  g.put(0, Y + 3, 4, Block.TNT);
  explosions.prime(g, 0, Y + 3, 4);
  falling.list.push({ id: Block.Sand, x: 5, z: 5, y: Y + 4, vy: 0, done: false });
  const mesh = combatSystem.mesh!(g, atlas)!;
  check('the system draws what is in flight', mesh !== null && mesh.indices.length > 0);
  // The arrow on its own: its vertices should stretch along its heading.
  const out = new MeshBuilder();
  projectiles.draw(g, out, atlas);
  const arrow = out.build();
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < arrow.vertices.length; i += 7) {
    const along = (arrow.vertices[i] - p.x) * Math.SQRT1_2 + (arrow.vertices[i + 1] - p.y) * Math.SQRT1_2;
    lo = Math.min(lo, along);
    hi = Math.max(hi, along);
  }
  check('an arrow is drawn along its flight, tip first', hi <= 0.01 && lo < -0.6 && lo > -0.75,
    `spans ${lo.toFixed(2)}..${hi.toFixed(2)} along its heading`);
  // A lit charge blinks: some frames it is the bundle, some the white flash.
  // Multiplying the red tile by a big light only ever gave brighter red.
  const [flashU, flashV] = atlas.uv(FLASH_TILE);
  const [sideU, sideV] = atlas.uv(blockDef(Block.TNT).textures[2]);
  const shows = (u: number, v: number, verts: Float32Array) => {
    for (let i = 0; i < verts.length; i += 7) {
      if (Math.abs(verts[i + 3] - u) < 1e-6 && Math.abs(verts[i + 4] - v) < 1e-6) return true;
    }
    return false;
  };
  let flashes = 0;
  let plain = 0;
  for (let i = 0; i < 60; i++) {
    explosions.update(g, 1 / 60);
    const frame = new MeshBuilder();
    explosions.draw(g, frame, atlas);
    const v = frame.build().vertices;
    if (shows(flashU, flashV, v) && !shows(sideU, sideV, v)) flashes++;
    else if (shows(sideU, sideV, v)) plain++;
  }
  check('a lit charge blinks between itself and a white flash', flashes >= 15 && plain >= 15,
    `${flashes} flash frames, ${plain} plain`);

  const tiles = atlasTileNames();
  const wanted = ['projectile_arrow_shaft', 'projectile_arrow_head', 'projectile_arrow_fletching',
    'projectile_snowball', 'projectile_fireball', 'fx_smoke', 'fx_flame', 'fx_spark', 'fx_snow',
    'bounce_pad_spring', 'spikes_plate', FLASH_TILE];
  check('every tile the drawing and the models use is in the atlas', wanted.every((t) => tiles.includes(t) && ART[t]),
    wanted.filter((t) => !tiles.includes(t) || !ART[t]).join(','));
}

console.log(failures === 0 ? '\nAll combat checks passed.' : `\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
