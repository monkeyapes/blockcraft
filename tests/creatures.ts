/**
 * The creatures pack: the new mobs' brains, how every mob moves, dies and
 * spawns, and what the player can do to them -- shear, tame, harvest webs.
 * Run: npx tsx tests/creatures.ts
 *
 * Mobs are driven the way MobWorld drives them, frame by frame at 60 Hz,
 * through small worlds built for each check: a wall to climb, a lake to
 * swim in, a cave with a torch at one end. services.shoot / explode are
 * replaced with recorders, so a check sees exactly what the combat pack
 * would be asked to do.
 */

import { Block, blockDef, isSolid } from '../shared/src/blocks.js';
import { Dimension, WORLD_Y } from '../shared/src/constants.js';
import { Item, blockDrops, breakTime, itemDef, smeltResult, toolSpec } from '../shared/src/items.js';
import { findRecipe } from '../shared/src/recipes.js';
import { MobKind, mobDef, rollDrops, spawnGroupIn, type MobDef } from '../shared/src/mobs.js';
import {
  ARCHER_FAR, ARCHER_NEAR, BLAST_POWER, DEATH_TIME, FUSE_TIME, Mob, MobWorld, STEP_UP,
  WOLF_TELEPORT, findSpawnSpot, type MobEnv,
} from '../client/src/mobs.js';
import { buildMobMesh } from '../client/src/gfx/mobmesh.js';
import {
  dispatchMobUse, services, setGameContext, type GameContext, type ShotSpec,
} from '../client/src/content/api.js';
import { TAME_CHANCE } from '../client/src/content/creatures.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- small worlds ---------------------------------------------------------------

const GROUND = 40;

interface TestWorld {
  getBlock(x: number, y: number, z: number): number;
  isLoaded(): boolean;
  skyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
  put(x: number, y: number, z: number, id: number): void;
}

/**
 * Stone up to GROUND with open sky above, plus whatever is put in. `sky`
 * and `torch` give the sky exposure (0..1) and block light (0..15) of a cell.
 */
function makeWorld(
  sky: (x: number, y: number, z: number) => number = () => 1,
  torch: (x: number, y: number, z: number) => number = () => 0,
): TestWorld {
  const cells = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  return {
    getBlock(x, y, z) {
      if (y < 0 || y >= WORLD_Y) return Block.Air;
      const own = cells.get(key(x, y, z));
      if (own !== undefined) return own;
      return y <= GROUND ? Block.Stone : Block.Air;
    },
    isLoaded: () => true,
    skyLight: sky,
    getBlockLight: torch,
    put(x, y, z, id) { cells.set(key(x, y, z), id); },
  };
}

/**
 * Only the middle of a world loaded, so a MobWorld's spawn ring (24 to 52
 * blocks out) always lands on unloaded ground and the only mobs are the
 * ones a check put there.
 */
function noSpawns(world: TestWorld): TestWorld {
  return { ...world, isLoaded: ((x: number, z: number) => Math.abs(x) < 16 && Math.abs(z) < 16) as () => boolean };
}

const DAY: MobEnv = { daylight: 1, sunlit: true };
const NIGHT: MobEnv = { daylight: 0.12, sunlit: true };

/** A seeded generator, so a run is the same every time. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

type Where = { x: number; y: number; z: number };

function sim(
  mob: Mob, world: TestWorld, player: Where, seconds: number,
  env: MobEnv = DAY, rng: () => number = lcg(7), each?: () => void,
): void {
  for (let i = 0; i < seconds * 60; i++) {
    mob.update(1 / 60, world as never, player, rng, env);
    each?.();
  }
}

// --- a game context, so hooks and services have something to act on -------------

const drops: Array<{ id: number; count: number }> = [];
const toasts: string[] = [];
const held = { id: null as number | null, count: 0 };
let random = 0.5;

const ctx: GameContext = {
  world: null as unknown as GameContext['world'],
  dimension: Dimension.Overworld,
  player: null as unknown as GameContext['player'],
  mobs: null as unknown as GameContext['mobs'],
  creative: false,
  time: 0,
  sound: null as unknown as GameContext['sound'],
  getBlock: () => Block.Air,
  setBlock: () => false,
  breakBlock() {},
  heldItem: () => held.id,
  consumeHeld(count = 1) {
    if (held.id === null || held.count < count) return false;
    held.count -= count;
    if (held.count === 0) held.id = null;
    return true;
  },
  replaceHeld(id, count = 1) { held.id = id; held.count = count; },
  give(id, count) { drops.push({ id, count }); },
  dropItem(_x, _y, _z, id, count) { drops.push({ id, count }); },
  damagePlayer() {}, healPlayer() {}, pushPlayer() {},
  // As main.ts does it: a corpse cannot be hurt again.
  hurtMob(mob, amount, fromX, fromZ) {
    if (!mob.dead) mob.hurt(amount, fromX, fromZ);
  },
  toast(text) { toasts.push(text); },
  chat() {}, breakParticles() {}, swing() {},
  random: () => random,
};
setGameContext(ctx);

const shots: ShotSpec[] = [];
const blasts: Array<{ x: number; y: number; z: number; power: number; selfDead: boolean }> = [];
let bomber: Mob | null = null;
services.shoot = (_ctx, shot) => { shots.push(shot); };
services.explode = (_ctx, x, y, z, power) => {
  blasts.push({ x, y, z, power, selfDead: bomber?.dead ?? false });
};

// --- the pack's blocks and items ----------------------------------------------------

{
  const web = blockDef(Block.Cobweb);
  check('a cobweb is not solid, so you walk into it', !web.solid && !isSolid(Block.Cobweb));
  check('a cobweb does not hide its neighbours', web.opaque === false);
  check('a cobweb slows you to a crawl', (web.speedFactor ?? 1) > 0 && (web.speedFactor ?? 1) <= 0.2,
    `${web.speedFactor}`);
  check('shears cut a web into string',
    blockDrops(Block.Cobweb, () => 0.5, Item.Shears).some((d) => d.id === Item.String));
  check('so does a sword',
    blockDrops(Block.Cobweb, () => 0.5, Item.IronSword).some((d) => d.id === Item.String));
  check('a bare hand tears it to nothing', blockDrops(Block.Cobweb, () => 0.5, null).length === 0);
  const byHand = breakTime(Block.Cobweb, null);
  const byShears = breakTime(Block.Cobweb, Item.Shears);
  check('shears are much faster on a web', byShears * 3 < byHand,
    `${byShears.toFixed(2)}s vs ${byHand.toFixed(2)}s`);
  check('shears are fast on wool', breakTime(Block.WhiteWool, Item.Shears) * 3 < breakTime(Block.WhiteWool, null));
  check('shears are a shearing tool', toolSpec(Item.Shears)?.kind === 'shears' && itemDef(Item.Shears).stackSize === 1);
  const shears = findRecipe({ width: 2, height: 2, cells: [null, Item.IronIngot, Item.IronIngot, null] });
  check('two iron ingots make shears', shears?.result.id === Item.Shears);
  check('raw fish cooks', smeltResult(Item.RawFish)?.id === Item.CookedFish);
  check('raw rabbit cooks', smeltResult(Item.RawRabbit)?.id === Item.CookedRabbit);
  const textures: Array<[number, string]> = [
    [Item.Bone, 'bone_item'], [Item.String, 'string'], [Item.Slimeball, 'slimeball'],
    [Item.FusePowder, 'fuse_powder'], [Item.RawFish, 'raw_fish'], [Item.CookedFish, 'cooked_fish'],
    [Item.Shears, 'shears'], [Item.RawRabbit, 'raw_rabbit'], [Item.CookedRabbit, 'cooked_rabbit'],
  ];
  const wrong = textures.filter(([id, tex]) => itemDef(id).texture !== tex);
  check('every item points at the icon its artist is drawing', wrong.length === 0,
    wrong.map(([id]) => itemDef(id).name).join(', '));
}

// --- drops -----------------------------------------------------------------------------

function dropRange(kind: MobKind, id: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.9999]) {
    const got = rollDrops(kind, () => r).find((d) => d.id === id)?.count ?? 0;
    lo = Math.min(lo, got);
    hi = Math.max(hi, got);
  }
  return [lo, hi];
}

for (const [kind, id, lo, hi] of [
  [MobKind.Spider, Item.String, 0, 2],
  [MobKind.Skeleton, Item.Bone, 0, 2],
  [MobKind.Skeleton, Item.Arrow, 0, 2],
  [MobKind.Boomshroom, Item.FusePowder, 0, 2],
  [MobKind.Rabbit, Item.RawRabbit, 0, 1],
  [MobKind.Rabbit, Item.Leather, 0, 1],
  [MobKind.Fish, Item.RawFish, 1, 1],
  [MobKind.SmallSlime, Item.Slimeball, 0, 2],
] as const) {
  const [a, b] = dropRange(kind, id);
  check(`${mobDef(kind).name} drops ${lo}-${hi} ${itemDef(id).name}`, a === lo && b === hi, `${a}-${b}`);
}
check('big and medium slimes drop nothing themselves',
  rollDrops(MobKind.Slime, () => 0.99).length === 0 && rollDrops(MobKind.MediumSlime, () => 0.99).length === 0);

// --- spider ------------------------------------------------------------------------------

{
  // A three-high wall across the spider's path to the player.
  const world = makeWorld(() => 0);
  for (let z = -8; z <= 8; z++) for (let y = GROUND + 1; y <= GROUND + 3; y++) world.put(5, y, z, Block.Stone);
  const spider = new Mob(MobKind.Spider, 1.5, GROUND + 1, 0.5, 0);
  const player = { x: 10.5, y: GROUND + 1, z: 0.5 };
  let top = spider.y;
  let climbed = false;
  sim(spider, world, player, 8, NIGHT, lcg(3), () => {
    top = Math.max(top, spider.y);
    climbed ||= spider.climbing;
  });
  check('a spider in the dark hunts you', spider.state === 'chase', spider.state);
  check('a spider climbs a wall it meets', climbed && top >= GROUND + 4 - 0.01, `peak y ${(top - GROUND).toFixed(2)}`);
  check('and comes down the far side', spider.x > 6, `x ${spider.x.toFixed(2)}`);

  const zombie = new Mob(MobKind.Zombie, 1.5, GROUND + 1, 0.5, 0);
  sim(zombie, world, player, 8, NIGHT);
  check('a zombie cannot climb that wall', zombie.x < 5, `x ${zombie.x.toFixed(2)}`);

  const lazy = new Mob(MobKind.Spider, 1.5, GROUND + 1, 0.5, 0);
  sim(lazy, makeWorld(), { x: 6.5, y: GROUND + 1, z: 0.5 }, 3, DAY);
  check('a spider in daylight leaves you alone', lazy.state !== 'chase', lazy.state);
  lazy.hurt(1, 6.5, 0.5);
  sim(lazy, makeWorld(), { x: 6.5, y: GROUND + 1, z: 0.5 }, 0.5, DAY);
  check('until you hit it', lazy.state === 'chase', lazy.state);
}

// --- skeleton ----------------------------------------------------------------------------

{
  const world = makeWorld(() => 0);
  shots.length = 0;
  const close = new Mob(MobKind.Skeleton, 0.5, GROUND + 1, 0.5, 0);
  const player = { x: 4.5, y: GROUND + 1, z: 0.5 };
  sim(close, world, player, 4, NIGHT, lcg(11));
  const backed = Math.hypot(player.x - close.x, player.z - close.z);
  check('a skeleton backs off from a player too close', backed >= ARCHER_NEAR - 1, `${backed.toFixed(1)} blocks`);
  check('and shoots arrows at them', shots.length >= 1, `${shots.length} shots`);
  const shot = shots[0];
  check('the shot is an arrow fired by the skeleton', shot?.kind === 'arrow' && shot.shooter === close);
  if (shot) {
    const aim = (shot.dx * (player.x - shot.x) + shot.dz * (player.z - shot.z)) /
      (Math.hypot(shot.dx, shot.dz) * Math.hypot(player.x - shot.x, player.z - shot.z));
    check('aimed at the player', aim > 0.95, `cos ${aim.toFixed(3)}`);
  }

  const far = new Mob(MobKind.Skeleton, 0.5, GROUND + 1, 0.5, 0);
  const distant = { x: 16.5, y: GROUND + 1, z: 0.5 };
  let inBand = 0;
  let frames = 0;
  sim(far, world, distant, 10, NIGHT, lcg(5), () => {
    frames++;
    const d = Math.hypot(distant.x - far.x, distant.z - far.z);
    if (frames > 4 * 60 && d >= ARCHER_NEAR - 1 && d <= ARCHER_FAR + 1) inBand++;
  });
  check('a skeleton keeps to its range once there', inBand >= (frames - 4 * 60) * 0.9,
    `${inBand} of ${frames - 4 * 60} frames at 7-13 blocks`);

  // Behind a wall it cannot see you, so it does not waste arrows.
  shots.length = 0;
  const walled = makeWorld(() => 0);
  for (let z = -20; z <= 20; z++) for (let y = GROUND + 1; y <= GROUND + 5; y++) walled.put(5, y, z, Block.Stone);
  const blind = new Mob(MobKind.Skeleton, 0.5, GROUND + 1, 0.5, 0);
  sim(blind, walled, { x: 10.5, y: GROUND + 1, z: 0.5 }, 5, NIGHT);
  check('no shots through a wall', shots.length === 0, `${shots.length}`);
}

// --- boomshroom ----------------------------------------------------------------------------

{
  const world = makeWorld(() => 0);
  blasts.length = 0;
  const shroom = new Mob(MobKind.Boomshroom, 0.5, GROUND + 1, 0.5, 0);
  bomber = shroom;
  const near = { x: 2.5, y: GROUND + 1, z: 0.5 };
  sim(shroom, world, near, 0.6, NIGHT);
  check('a boomshroom in range starts its fuse', shroom.fuse > 0 && shroom.state === 'fuse', `fuse ${shroom.fuse.toFixed(2)}`);
  check('and has not gone off yet', blasts.length === 0 && !shroom.dead);

  const away = { x: 20.5, y: GROUND + 1, z: 0.5 };
  sim(shroom, world, away, 1.5, NIGHT);
  check('backing off calms it down', shroom.fuse === 0 && !shroom.dead, `fuse ${shroom.fuse.toFixed(2)}`);
  check('without a blast', blasts.length === 0);

  // Stand still beside it: after the full fuse it bursts, exactly once.
  const beside = { x: shroom.x + 2, y: GROUND + 1, z: shroom.z };
  let fusedFor = 0;
  sim(shroom, world, beside, 3, NIGHT, lcg(7), () => { if (shroom.fuse > 0 && !shroom.dead) fusedFor += 1 / 60; });
  check('it explodes once', blasts.length === 1, `${blasts.length} blasts`);
  check('after about its fuse time', Math.abs(fusedFor - FUSE_TIME) < 0.1, `${fusedFor.toFixed(2)}s`);
  check('with the power of its blast', blasts[0]?.power === BLAST_POWER);
  check('and is dead before its own blast lands, so it drops nothing', blasts[0]?.selfDead === true && shroom.gone);
  const mw = new MobWorld(Dimension.Overworld);
  mw.mobs.push(shroom);
  mw.update(1 / 60, world as never, beside, () => 0.99);
  check('it leaves no corpse behind', !mw.mobs.includes(shroom));
  bomber = null;
}

// --- slime ---------------------------------------------------------------------------------

{
  const world = noSpawns(makeWorld(() => 0));
  const mw = new MobWorld(Dimension.Overworld);
  // Out of reach of their anger, but not so far they are despawned.
  const player = { x: 40.5, y: GROUND + 1, z: 0.5 };
  const big = new Mob(MobKind.Slime, 0.5, GROUND + 1, 0.5);
  mw.mobs.push(big);
  const count = (k: MobKind) => mw.mobs.filter((m) => m.kind === k && !m.dead).length;
  const noSpawn = () => 0.999;
  big.hurt(1000, player.x, player.z);
  mw.update(1 / 60, world as never, player, noSpawn);
  check('a big slime splits into two medium ones', count(MobKind.MediumSlime) === 2, `${count(MobKind.MediumSlime)}`);
  for (const m of mw.mobs.filter((m) => m.kind === MobKind.MediumSlime)) m.hurt(1000);
  mw.update(1 / 60, world as never, player, noSpawn);
  check('each medium slime into two small ones', count(MobKind.SmallSlime) === 4, `${count(MobKind.SmallSlime)}`);
  for (const m of mw.mobs.filter((m) => m.kind === MobKind.SmallSlime)) m.hurt(1000);
  mw.update(1 / 60, world as never, player, noSpawn);
  check('small slimes do not split', mw.mobs.every((m) => m.dead), `${mw.mobs.filter((m) => !m.dead).length} alive`);
  check('and nothing else turned up to confuse the count', mw.mobs.every((m) => m.def.brain === 'slime'), mw.mobs.map((m) => m.def.name + (m.dead ? '+' : '') + ' ' + m.x.toFixed(1) + ',' + m.z.toFixed(1)).join('; '));
  const sizes = [MobKind.Slime, MobKind.MediumSlime, MobKind.SmallSlime].map((k) => mobDef(k));
  check('bigger slimes hit harder', sizes[0].attack > sizes[1].attack && sizes[1].attack > sizes[2].attack,
    sizes.map((d) => d.attack).join(' > '));
  check('and are bigger', sizes[0].width > sizes[1].width && sizes[1].width > sizes[2].width);

  const hopper = new Mob(MobKind.SmallSlime, 0.5, GROUND + 1, 0.5, 0);
  let airborne = 0;
  const target = { x: 8.5, y: GROUND + 1, z: 0.5 };
  sim(hopper, world, target, 5, NIGHT, lcg(9), () => { if (!hopper.onGround) airborne++; });
  check('a slime hops toward you', hopper.x > 3 && airborne > 30, `x ${hopper.x.toFixed(1)}, ${airborne} frames aloft`);
}

// --- wolf ------------------------------------------------------------------------------------

{
  const world = makeWorld();
  const wolf = new Mob(MobKind.Wolf, 0.5, GROUND + 1, 0.5);
  held.id = Item.Bone;
  held.count = 5;
  random = 0.99;
  check('a bone fed to a wolf is used up', dispatchMobUse(ctx, wolf) && held.count === 4);
  check('but does not always win it over', !wolf.tamed);
  random = TAME_CHANCE / 2;
  dispatchMobUse(ctx, wolf);
  check('a bone can tame a wolf', wolf.tamed && held.count === 3);

  const player = { x: 10.5, y: GROUND + 1, z: 0.5 };
  sim(wolf, world, player, 5);
  const d = Math.hypot(player.x - wolf.x, player.z - wolf.z);
  check('a tamed wolf follows you', d < 5, `${d.toFixed(1)} blocks`);

  const faraway = { x: 60.5, y: GROUND + 1, z: 0.5 };
  sim(wolf, world, faraway, 0.1);
  const after = Math.hypot(faraway.x - wolf.x, faraway.z - wolf.z);
  check(`a tamed wolf more than ${WOLF_TELEPORT} blocks behind teleports to you`, after < 3, `${after.toFixed(1)} blocks`);

  held.id = null;
  held.count = 0;
  dispatchMobUse(ctx, wolf);
  check('an empty hand tells it to sit', wolf.sitting);
  const sitX = wolf.x;
  sim(wolf, world, { x: wolf.x + 10, y: GROUND + 1, z: wolf.z }, 3);
  check('and it stays sat', Math.abs(wolf.x - sitX) < 0.05);
  dispatchMobUse(ctx, wolf);
  check('another tap and it follows again', !wolf.sitting);

  // Hit a zombie, and your wolf joins in.
  const fenced = noSpawns(world);
  const mw = new MobWorld(Dimension.Overworld);
  const here = { x: 0.5, y: GROUND + 1, z: 0.5 };
  const pet = new Mob(MobKind.Wolf, 1.5, GROUND + 1, 0.5);
  pet.tamed = true;
  const zombie = new Mob(MobKind.Zombie, 4.5, GROUND + 1, 3.5);
  mw.mobs.push(pet, zombie);
  zombie.hurt(1, here.x, here.z);
  mw.update(1 / 60, fenced as never, here, () => 0.999);
  check('your wolf goes for what you hit', pet.target === zombie);
  const before = zombie.health;
  for (let i = 0; i < 5 * 60; i++) mw.update(1 / 60, fenced as never, here, () => 0.999);
  check('and bites it', zombie.health < before || zombie.dead, `${before} -> ${zombie.health}`);

  // A wild wolf struck by the player turns the whole pack.
  const pack = new MobWorld(Dimension.Overworld);
  const a = new Mob(MobKind.Wolf, 0.5, GROUND + 1, 5.5);
  const b = new Mob(MobKind.Wolf, 3.5, GROUND + 1, 5.5);
  pack.mobs.push(a, b);
  a.hurt(1, here.x, here.z);
  pack.update(1 / 60, fenced as never, here, () => 0.999);
  check('strike one wild wolf and the pack turns on you', a.angered && b.angered);
  const angry = new Mob(MobKind.Wolf, 0.5, GROUND + 1, 0.5);
  angry.angered = true;
  held.id = Item.Bone;
  held.count = 1;
  random = 0;
  check('an angry wolf will not take a bone', !dispatchMobUse(ctx, angry) && !angry.tamed && held.count === 1);
  held.id = null;
  held.count = 0;
  random = 0.5;
}

// --- sheep -------------------------------------------------------------------------------------

{
  const sheep = new Mob(MobKind.Sheep, 0.5, GROUND + 1, 0.5);
  drops.length = 0;
  held.id = Item.Shears;
  held.count = 1;
  random = 0.5;
  check('shears shear a sheep', dispatchMobUse(ctx, sheep) && sheep.sheared);
  const wool = drops.filter((d) => d.id === Block.WhiteWool).reduce((n, d) => n + d.count, 0);
  check('dropping white wool', wool >= 1 && wool <= 3, `${wool}`);
  check('a sheared sheep cannot be shorn again', !dispatchMobUse(ctx, sheep) && drops.length === 1);
  let most = 0;
  let least = Infinity;
  for (const r of [0, 0.5, 0.9999]) {
    const s = new Mob(MobKind.Sheep, 0, 0, 0);
    drops.length = 0;
    random = r;
    dispatchMobUse(ctx, s);
    const n = drops.reduce((sum, d) => sum + d.count, 0);
    most = Math.max(most, n);
    least = Math.min(least, n);
  }
  check('one to three wool a shearing', least === 1 && most === 3, `${least}-${most}`);
  random = 0.5;
  held.id = null;
  held.count = 0;

  // The model shows it: fleece before, bare skin after.
  const used: string[] = [];
  const atlas = { uv: (name: string) => { used.push(name); return [0, 0, 0.25, 0.25]; }, canvas: null, iconURL: () => '' } as never;
  const woolly = new Mob(MobKind.Sheep, 0, 0, 0);
  buildMobMesh(atlas, [woolly]);
  const woollyTiles = new Set(used);
  used.length = 0;
  buildMobMesh(atlas, [sheep]);
  const bareTiles = new Set(used);
  check('a woolly sheep is drawn in its fleece', woollyTiles.has('mob_wool') && !woollyTiles.has('mob_sheep_shorn'));
  check('a sheared one is drawn bare', bareTiles.has('mob_sheep_shorn') && !bareTiles.has('mob_wool'));

  sheep.woolTimer = 0.5;
  sim(sheep, makeWorld(), { x: 400, y: GROUND + 1, z: 0 }, 1);
  check('the fleece grows back', !sheep.sheared);
}

// --- fish ----------------------------------------------------------------------------------------

{
  // A pond: water from y 36 to 40 over x, z in -6..6, dug into the stone.
  const pond = makeWorld();
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) for (let y = 36; y <= GROUND; y++) pond.put(x, y, z, Block.Water);
  const fish = new Mob(MobKind.Fish, 0.5, 38, 0.5);
  let dry = 0;
  sim(fish, pond, { x: 2.5, y: GROUND + 1, z: 0.5 }, 20, DAY, lcg(21), () => {
    if (pond.getBlock(Math.floor(fish.x), Math.floor(fish.y + 0.2), Math.floor(fish.z)) !== Block.Water) dry++;
  });
  check('a fish stays in its water', dry === 0 && !fish.dead, `${dry} frames out`);
  check('a fish swims about', Math.hypot(fish.x - 0.5, fish.z - 0.5) > 0.5);

  const beached = new Mob(MobKind.Fish, 20.5, GROUND + 1, 0.5);
  let flopped = false;
  sim(beached, pond, { x: 400, y: GROUND + 1, z: 0 }, 6, DAY, lcg(4), () => { flopped ||= !beached.onGround; });
  check('a fish out of water flops about', flopped);
  check('and dies', beached.dead);
}

// --- bat ----------------------------------------------------------------------------------------

{
  // A long cave: roofed at y 46, torchlit for x > 0, pitch dark beyond x < -3.
  const cave = makeWorld(() => 0, (x) => (x > 0 ? 14 : x < -3 ? 0 : 6));
  for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) cave.put(x, 46, z, Block.Stone);
  const bat = new Mob(MobKind.Bat, 4.5, 43, 0.5);
  const lit = () => Math.floor(bat.x) > 0;
  let darkFrames = 0;
  sim(bat, cave, { x: 400, y: GROUND + 1, z: 0 }, 20, { daylight: 0, sunlit: false }, lcg(31), () => {
    if (!lit()) darkFrames++;
  });
  check('a bat leaves the torchlight for the dark', darkFrames > 20 * 60 * 0.6, `${darkFrames} of ${20 * 60} frames in the dark`);
  check('a bat stays airborne', bat.y > GROUND + 1.3, `y ${(bat.y - GROUND).toFixed(1)}`);
}

// --- rabbit -------------------------------------------------------------------------------------

{
  const rabbit = new Mob(MobKind.Rabbit, 0.5, GROUND + 1, 0.5);
  const player = { x: 3.5, y: GROUND + 1, z: 0.5 };
  sim(rabbit, makeWorld(), player, 2);
  check('a rabbit bolts from you', player.x - rabbit.x > 6, `${(player.x - rabbit.x).toFixed(1)} blocks`);
}

// --- knockback -----------------------------------------------------------------------------------

{
  const world = makeWorld();
  const struck = new Mob(MobKind.Zombie, 0.5, GROUND + 1, 0.5, 90);
  const control = new Mob(MobKind.Zombie, 0.5, GROUND + 1, 0.5, 90);
  sim(struck, world, { x: 400, y: GROUND + 1, z: 0 }, 0.1);
  sim(control, world, { x: 400, y: GROUND + 1, z: 0 }, 0.1);
  struck.hurt(1, struck.x - 1, struck.z);
  check('a blow pushes a mob away from the striker', struck.vx > 0 && Math.abs(struck.vz) < 1e-6, `vx ${struck.vx.toFixed(2)}`);
  check('with a little hop', struck.vy > 0);
  const player = { x: 400, y: GROUND + 1, z: 0 };
  sim(struck, world, player, 0.6, DAY, lcg(2));
  sim(control, world, player, 0.6, DAY, lcg(2));
  check('and it is thrown that way', struck.x - control.x > 0.8, `${(struck.x - control.x).toFixed(2)} blocks further`);
  check('a hit flashes the model', struck.hurtTimer >= 0);

  const north = new Mob(MobKind.Pig, 0.5, GROUND + 1, 0.5);
  north.hurt(1, 0.5, 5.5);
  check('struck from +z it flies toward -z', north.vz < 0 && Math.abs(north.vx) < 1e-6);
}

// --- dying ----------------------------------------------------------------------------------------

{
  const world = noSpawns(makeWorld());
  const mw = new MobWorld(Dimension.Overworld);
  const player = { x: 0.5, y: GROUND + 1, z: -3 };
  // A zombie: tall enough that lying down is unmistakable.
  const corpse = new Mob(MobKind.Zombie, 0.5, GROUND + 1, 0.5);
  mw.mobs.push(corpse);
  corpse.hurt(1000, player.x, player.z);
  check('a killed mob is dead at once', corpse.dead);
  check('a corpse cannot be targeted', mw.pick(0.5, GROUND + 1.5, -3, 0, 0, 1, 8) === null);
  const health = corpse.health;
  ctx.hurtMob(corpse, 5, player.x, player.z);
  check('or hurt again', corpse.health === health);

  const stubAtlas = { uv: () => [0, 0, 0.25, 0.25], canvas: null, iconURL: () => '' } as never;
  const standing = buildMobMesh(stubAtlas, [new Mob(MobKind.Zombie, 0.5, GROUND + 1, 0.5, 0)]);
  const topOf = (m: { vertices: Float32Array }) => {
    let top = -Infinity;
    for (let i = 1; i < m.vertices.length; i += 7) top = Math.max(top, m.vertices[i]);
    return top;
  };

  let seenAt = -1;
  let tipped = false;
  for (let i = 0; i < 2 * 60; i++) {
    mw.update(1 / 60, world as never, player, () => 0.999);
    if (!mw.mobs.includes(corpse)) break;
    seenAt = corpse.deathTime;
    if (Math.abs(corpse.deathTime - DEATH_TIME * 0.6) < 1 / 60) {
      tipped = topOf(buildMobMesh(stubAtlas, [corpse])) - corpse.y < topOf(standing) - (GROUND + 1) - 0.8;
    }
  }
  check('a corpse tips over as it dies', tipped);
  check(`and lies there about ${DEATH_TIME}s before it is removed`,
    seenAt > DEATH_TIME - 0.1 && !mw.mobs.includes(corpse), `last seen at ${seenAt.toFixed(2)}s`);

  // Two living bodies in one spot are pushed apart; a corpse pushes nobody.
  const pushed = (otherDead: boolean): number => {
    const w = new MobWorld(Dimension.Overworld);
    const a = new Mob(MobKind.Wolf, 0.5, GROUND + 1, 0.5);
    const b = new Mob(MobKind.Wolf, 0.6, GROUND + 1, 0.5);
    for (const m of [a, b]) { m.tamed = true; m.sitting = true; }
    if (otherDead) b.hurt(1000);
    w.mobs.push(a, b);
    for (let i = 0; i < 20; i++) w.update(1 / 60, world as never, { x: 0.5, y: GROUND + 1, z: 1.5 }, () => 0.999);
    return Math.abs(a.x - 0.5);
  };
  check('living mobs shoulder each other apart', pushed(false) > 0.05);
  check('a corpse does not collide', pushed(true) < 1e-6);
}

// --- walking over blocks -------------------------------------------------------------------------

{
  const across = (id: number): number => {
    const world = makeWorld(() => 0);
    for (let z = -12; z <= 12; z++) world.put(5, GROUND + 1, z, id);
    const zombie = new Mob(MobKind.Zombie, 2.5, GROUND + 1, 0.5, 0);
    sim(zombie, world, { x: 10.5, y: GROUND + 1, z: 0.5 }, 6, NIGHT);
    return zombie.x;
  };
  const fence = across(Block.PlankFence);
  // The post's collision starts 6/16 into the cell; a body stopped at it
  // has its centre no further than that minus half its width.
  check('a fence keeps a mob out', fence < 5 + 6 / 16 - 0.29, `x ${fence.toFixed(2)}`);
  const slab = across(Block.StoneSlab);
  check('a mob walks over a slab', slab > 6, `x ${slab.toFixed(2)}`);
  const block = across(Block.Stone);
  check('and hops up a full block', block > 6, `x ${block.toFixed(2)}`);
  check('the step height clears a block but not a fence', STEP_UP >= 1 && STEP_UP < 1.5, `${STEP_UP}`);

  // A band of webs: a zombie wades through at a crawl, a spider does not notice.
  const through = (kind: MobKind, webs: boolean): number => {
    const world = makeWorld(() => 0);
    if (webs) for (let x = 3; x <= 12; x++) for (let z = -3; z <= 3; z++) world.put(x, GROUND + 1, z, Block.Cobweb);
    const mob = new Mob(kind, 2.5, GROUND + 1, 0.5, 0);
    sim(mob, world, { x: 14.5, y: GROUND + 1, z: 0.5 }, 2, NIGHT);
    return mob.x - 2.5;
  };
  const clear = through(MobKind.Zombie, false);
  const webbed = through(MobKind.Zombie, true);
  check('webs slow a zombie to a crawl', webbed < clear * 0.4, `${webbed.toFixed(1)} vs ${clear.toFixed(1)} blocks`);
  const spiderClear = through(MobKind.Spider, false);
  const spiderWebbed = through(MobKind.Spider, true);
  check('but not a spider', spiderWebbed > spiderClear * 0.9, `${spiderWebbed.toFixed(1)} vs ${spiderClear.toFixed(1)} blocks`);

  // No tunnelling: a mob flung hard at a wall stops at it.
  const world = makeWorld();
  for (let z = -4; z <= 4; z++) for (let y = GROUND + 1; y <= GROUND + 3; y++) world.put(3, y, z, Block.Stone);
  const flung = new Mob(MobKind.Pig, 0.5, GROUND + 1, 0.5);
  flung.knock(400, 0, 0);
  sim(flung, world, { x: 400, y: GROUND + 1, z: 0 }, 0.2);
  check('a mob flung at a wall does not pass through it', flung.x < 3, `x ${flung.x.toFixed(2)}`);
}

// --- spawning ------------------------------------------------------------------------------------

{
  const def = (k: MobKind): MobDef => mobDef(k);
  const surface = makeWorld((_x, y) => (y > GROUND ? 1 : 0));
  const rng = () => 0.5;
  for (const k of [MobKind.Zombie, MobKind.Spider, MobKind.Skeleton, MobKind.Boomshroom]) {
    check(`no ${def(k).name} in daylight`, findSpawnSpot(surface as never, 0, 0, def(k), DAY, rng) === null);
    check(`a ${def(k).name} at night`, findSpawnSpot(surface as never, 0, 0, def(k), NIGHT, rng) === GROUND + 1);
  }
  const monsters = spawnGroupIn(Dimension.Overworld, 'monster');
  check('every overworld monster needs the dark', monsters.every((d) => d.spawn.place === 'dark'),
    monsters.map((d) => `${d.name}:${d.spawn.place}`).join(' '));
  check('nothing from the overworld spawns in the nether',
    ![MobKind.Spider, MobKind.Skeleton, MobKind.Boomshroom, MobKind.Slime, MobKind.Wolf, MobKind.Bat, MobKind.Fish]
      .some((k) => spawnGroupIn(Dimension.Nether, def(k).spawn.group).includes(def(k))));
  check('split slimes never spawn on their own',
    def(MobKind.MediumSlime).spawn.place === 'never' && def(MobKind.SmallSlime).spawn.place === 'never');

  const grassy = makeWorld((_x, y) => (y > GROUND ? 1 : 0));
  grassy.put(0, GROUND, 0, Block.Grass);
  grassy.put(0, GROUND + 1, 0, Block.TallGrass);
  check('a pig may spawn in tall grass', findSpawnSpot(grassy as never, 0, 0, def(MobKind.Pig), DAY, rng) === GROUND + 1);
  grassy.put(0, GROUND + 1, 0, Block.Stone);
  check('but not inside a solid block', findSpawnSpot(grassy as never, 0, 0, def(MobKind.Pig), DAY, rng) !== GROUND + 1);
  const stony = makeWorld((_x, y) => (y > GROUND ? 1 : 0));
  check('a pig will not spawn on bare stone', findSpawnSpot(stony as never, 0, 0, def(MobKind.Pig), DAY, rng) === null);

  const pond = makeWorld();
  for (let y = 36; y <= GROUND; y++) pond.put(0, y, 0, Block.Water);
  const fishAt = findSpawnSpot(pond as never, 0, 0, def(MobKind.Fish), DAY, rng);
  check('a fish spawns in water', fishAt !== null && pond.getBlock(0, Math.floor(fishAt), 0) === Block.Water, `${fishAt}`);
  check('a fish never spawns on land', findSpawnSpot(makeWorld() as never, 0, 0, def(MobKind.Fish), DAY, rng) === null);
  check('a pig never spawns in water', findSpawnSpot(pond as never, 0, 0, def(MobKind.Pig), DAY, rng) === null);

  const cave = makeWorld((_x, y) => (y > GROUND + 5 ? 1 : 0));
  cave.put(0, GROUND + 5, 0, Block.Stone);
  const batAt = findSpawnSpot(cave as never, 0, 0, def(MobKind.Bat), DAY, rng);
  check('a bat spawns in a dark cave', batAt !== null && batAt > GROUND + 1 && batAt < GROUND + 5, `${batAt}`);
  check('never out under the open sky',
    findSpawnSpot(makeWorld() as never, 0, 0, def(MobKind.Bat), NIGHT, rng) === null);
  const torchlit = makeWorld((_x, y) => (y > GROUND + 5 ? 1 : 0), () => 14);
  torchlit.put(0, GROUND + 5, 0, Block.Stone);
  check('nor in a torchlit cave', findSpawnSpot(torchlit as never, 0, 0, def(MobKind.Bat), DAY, rng) === null);

  // A night-time MobWorld over a wide dark field fills with monsters but
  // never beyond the cap.
  const field = makeWorld((_x, y) => (y > GROUND ? 1 : 0));
  const mw = new MobWorld(Dimension.Overworld);
  mw.daylight = 0.12;
  const r = lcg(99);
  for (let i = 0; i < 400; i++) mw.update(0.5, field as never, { x: 0.5, y: GROUND + 1, z: 0.5 }, r);
  const monstersNow = mw.mobs.filter((m) => !m.dead && m.def.spawn.group === 'monster').length;
  check('monsters spawn on a dark night', monstersNow > 0, `${monstersNow}`);
  check('up to the cap and no further', monstersNow <= 12, `${monstersNow}`);
  const day = new MobWorld(Dimension.Overworld);
  day.daylight = 1;
  for (let i = 0; i < 400; i++) day.update(0.5, field as never, { x: 0.5, y: GROUND + 1, z: 0.5 }, lcg(99));
  check('and none in broad daylight', day.mobs.every((m) => m.def.spawn.group !== 'monster'));
}

// --- models ----------------------------------------------------------------------------------------

{
  const stubAtlas = { uv: () => [0, 0, 0.25, 0.25], canvas: null, iconURL: () => '' } as never;
  for (const kind of [
    MobKind.Spider, MobKind.Skeleton, MobKind.Boomshroom, MobKind.Slime, MobKind.MediumSlime,
    MobKind.SmallSlime, MobKind.Wolf, MobKind.Bat, MobKind.Rabbit, MobKind.Fish,
  ]) {
    const mob = new Mob(kind, 10, GROUND, 20, 45);
    mob.phase = 1.1;
    mob.inWater = true;
    const mesh = buildMobMesh(stubAtlas, [mob]);
    const count = mesh.vertices.length / 7;
    let minY = Infinity;
    let maxY = -Infinity;
    let wide = 0;
    for (let i = 0; i < mesh.vertices.length; i += 7) {
      minY = Math.min(minY, mesh.vertices[i + 1]);
      maxY = Math.max(maxY, mesh.vertices[i + 1]);
      wide = Math.max(wide, Math.abs(mesh.vertices[i] - 10), Math.abs(mesh.vertices[i + 2] - 20));
    }
    const d = mobDef(kind);
    const ok = count > 0 && mesh.vertices.every(Number.isFinite) && mesh.indices.every((i) => i < count);
    check(`${d.name} model builds`, ok, `${count} verts`);
    check(`${d.name} model fits its body`,
      minY > GROUND - 0.3 && maxY < GROUND + d.height + 0.4 && wide < Math.max(1.2, d.width * 1.2),
      `y ${(minY - GROUND).toFixed(2)}..${(maxY - GROUND).toFixed(2)}, reach ${wide.toFixed(2)}`);
  }

  // The gait moves the legs: two phases of a walk are different meshes.
  const a = new Mob(MobKind.Spider, 0, GROUND, 0, 0);
  const b = new Mob(MobKind.Spider, 0, GROUND, 0, 0);
  a.phase = 0;
  b.phase = 1.6;
  const ma = buildMobMesh(stubAtlas, [a]).vertices;
  const mb = buildMobMesh(stubAtlas, [b]).vertices;
  let moved = 0;
  for (let i = 0; i < ma.length; i++) moved = Math.max(moved, Math.abs(ma[i] - mb[i]));
  check('a spider\'s legs move with its gait', moved > 0.05, `${moved.toFixed(2)}`);

  // A fuse swells the boomshroom.
  const calm = new Mob(MobKind.Boomshroom, 0, GROUND, 0, 0);
  const lit = new Mob(MobKind.Boomshroom, 0, GROUND, 0, 0);
  lit.fuse = FUSE_TIME * 0.9;
  const top = (m: Mob) => {
    const v = buildMobMesh(stubAtlas, [m]).vertices;
    let t = -Infinity;
    for (let i = 1; i < v.length; i += 7) t = Math.max(t, v[i]);
    return t;
  };
  check('a burning fuse swells the boomshroom', top(lit) > top(calm) + 0.1);

  const collar = (tamed: boolean) => {
    const used: string[] = [];
    const atlas = { uv: (n: string) => { used.push(n); return [0, 0, 0.25, 0.25]; }, canvas: null, iconURL: () => '' } as never;
    const w = new Mob(MobKind.Wolf, 0, 0, 0);
    w.tamed = tamed;
    buildMobMesh(atlas, [w]);
    return used.includes('mob_collar');
  };
  check('a tamed wolf wears a collar', collar(true) && !collar(false));
}

process.exitCode = failures === 0 ? 0 : 1;
if (failures) console.log(`\n${failures} failed`);
else console.log('\nall creature checks pass');
