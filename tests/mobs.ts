/** Mob AI, combat and drops. Run: npx tsx tests/mobs.ts */

import { Block } from '../shared/src/blocks.js';
import { Dimension, WORLD_Y } from '../shared/src/constants.js';
import { Item, attackDamage, cookedForm, foodValue, isFood, smeltResult } from '../shared/src/items.js';
import { MobKind, mobDef, rollDrops, spawnableIn } from '../shared/src/mobs.js';
import { findRecipe, type Grid } from '../shared/src/recipes.js';
import { Mob, MobWorld } from '../client/src/mobs.js';
import { buildMobMesh } from '../client/src/gfx/mobmesh.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

const _ = null;
const grid = (w: number, h: number, cells: Array<number | null>): Grid =>
  ({ width: w, height: h, cells });

/** Flat grass world at y<=40, plus an optional extra solid predicate. */
function makeWorld(solid: (x: number, y: number, z: number) => boolean = () => false) {
  return {
    getBlock(x: number, y: number, z: number): number {
      if (y < 0 || y >= WORLD_Y) return Block.Air;
      if (y === 40) return Block.Grass;
      if (y < 40) return Block.Stone;
      return solid(x, y, z) ? Block.Stone : Block.Air;
    },
    isLoaded: () => true,
    skyLight: () => 1,
  } as any;
}

const flat = makeWorld();
const nowhere = { x: 1000, y: 41, z: 1000 };
function sim(mob: Mob, world: any, player: any, seconds: number, rng = () => 0.5): void {
  for (let i = 0; i < seconds * 60; i++) mob.update(1 / 60, world, player, rng);
}

// --- definitions ------------------------------------------------------------
check('animals are passive', mobDef(MobKind.Pig).temper === 'passive' &&
  mobDef(MobKind.Cow).temper === 'passive' && mobDef(MobKind.Chicken).temper === 'passive');
check('zombies are hostile', mobDef(MobKind.Zombie).temper === 'hostile');
check('only animals spawn as passives in the overworld',
  spawnableIn(Dimension.Overworld, 'passive').length === 4);
check('zombies do not spawn in the nether',
  !spawnableIn(Dimension.Nether, 'hostile').some((d) => d.kind === MobKind.Zombie));
check('nothing peaceful lives in the nether',
  spawnableIn(Dimension.Nether, 'passive').length === 0);

// --- gravity and standing ---------------------------------------------------
{
  const pig = new Mob(MobKind.Pig, 8.5, 60, 8.5);
  sim(pig, flat, nowhere, 4);
  check('a mob falls and lands on the ground',
    pig.onGround && Math.abs(pig.y - 41) < 0.01, `y=${pig.y.toFixed(3)}`);
}

// --- wandering --------------------------------------------------------------
{
  let moved = 0;
  for (let trial = 0; trial < 6; trial++) {
    const pig = new Mob(MobKind.Pig, 8.5, 41, 8.5, trial * 60);
    const start = { x: pig.x, z: pig.z };
    let seed = trial * 977 + 13;
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    sim(pig, flat, nowhere, 12, rng);
    if (Math.hypot(pig.x - start.x, pig.z - start.z) > 1) moved++;
  }
  check('animals wander around', moved >= 4, `${moved} of 6 wandered`);
}

// --- hostiles chase ---------------------------------------------------------
{
  const zombie = new Mob(MobKind.Zombie, 0.5, 41, 0.5);
  const player = { x: 10.5, y: 41, z: 0.5 };
  const before = Math.hypot(player.x - zombie.x, player.z - zombie.z);
  sim(zombie, flat, player, 4);
  const after = Math.hypot(player.x - zombie.x, player.z - zombie.z);
  check('a zombie closes on the player', after < before - 3,
    `${before.toFixed(1)} -> ${after.toFixed(1)} blocks`);
  check('the zombie is in the chase state', zombie.state === 'chase');
}

{
  const zombie = new Mob(MobKind.Zombie, 0.5, 41, 0.5);
  const distant = { x: 400.5, y: 41, z: 0.5 };
  sim(zombie, flat, distant, 3);
  check('a zombie ignores a distant player', zombie.state !== 'chase', zombie.state);
}

// --- attacking --------------------------------------------------------------
{
  const zombie = new Mob(MobKind.Zombie, 0.5, 41, 0.5);
  const adjacent = { x: 1.2, y: 41, z: 0.5 };
  const first = zombie.tryAttack(adjacent.x, adjacent.y, adjacent.z);
  const immediate = zombie.tryAttack(adjacent.x, adjacent.y, adjacent.z);
  check('a zombie in reach deals damage', first === mobDef(MobKind.Zombie).attack, `${first}`);
  check('attacks are on a cooldown', immediate === 0);

  const far = new Mob(MobKind.Zombie, 0.5, 41, 0.5);
  check('a zombie out of reach does not', far.tryAttack(9.5, 41, 0.5) === 0);
}

// --- damage, fleeing and death ----------------------------------------------
{
  const pig = new Mob(MobKind.Pig, 0.5, 41, 0.5);
  pig.hurt(3);
  check('a hurt animal loses health', pig.health === mobDef(MobKind.Pig).health - 3);
  check('a hurt animal flees', pig.state === 'flee');
  check('a hurt mob flashes', pig.hurtTimer > 0);

  const player = { x: 0.5, y: 41, z: 0.5 };
  const before = { x: pig.x, z: pig.z };
  sim(pig, flat, player, 2);
  check('it runs away from what hit it',
    Math.hypot(pig.x - before.x, pig.z - before.z) > 1.5,
    `${Math.hypot(pig.x - before.x, pig.z - before.z).toFixed(1)} blocks`);

  pig.hurt(100);
  check('enough damage kills', pig.dead);
}

// --- drops ------------------------------------------------------------------
{
  const drops = rollDrops(MobKind.Pig, () => 0.99);
  check('a pig drops porkchops', drops.some((d) => d.id === Item.RawPorkchop));

  const cow = rollDrops(MobKind.Cow, () => 0.99);
  check('a cow drops beef and leather',
    cow.some((d) => d.id === Item.RawBeef) && cow.some((d) => d.id === Item.Leather));

  // A minimum of zero must be able to roll nothing.
  const stingy = rollDrops(MobKind.Cow, () => 0);
  check('optional drops can roll nothing',
    !stingy.some((d) => d.id === Item.Leather), JSON.stringify(stingy));
}

// --- combat values ----------------------------------------------------------
check('bare hands are weak', attackDamage(null) === 1);
check('a sword beats a pickaxe',
  attackDamage(Item.DiamondSword) > attackDamage(Item.DiamondPickaxe));
check('an axe beats bare hands', attackDamage(Item.IronAxe) > attackDamage(null));
check('sword tiers escalate',
  attackDamage(Item.WoodSword) < attackDamage(Item.StoneSword) &&
  attackDamage(Item.StoneSword) < attackDamage(Item.IronSword) &&
  attackDamage(Item.IronSword) < attackDamage(Item.DiamondSword));

const P = Block.Planks;
const S = Item.Stick;
check('wooden sword recipe',
  findRecipe(grid(3, 3, [P, _, _, P, _, _, S, _, _]))?.result.id === Item.WoodSword);

// --- food -------------------------------------------------------------------
check('raw meat feeds you a little', foodValue(Item.RawPorkchop) > 0);
check('cooking is worth it', foodValue(Item.CookedPorkchop) > foodValue(Item.RawPorkchop));
check('stone is not food', !isFood(Block.Stone));
check('raw beef cooks into steak', cookedForm(Item.RawBeef) === Item.Steak);
check('a furnace cooks meat', smeltResult(Item.RawChicken)?.id === Item.CookedChicken);
check('smelting ore still works', smeltResult(Block.IronOre)?.id === Item.IronIngot);

// --- the world manager ------------------------------------------------------
{
  const world = new MobWorld(Dimension.Overworld);
  const player = { x: 0.5, y: 41, z: 0.5 };
  // Run long enough for several spawn ticks.
  for (let i = 0; i < 60 * 12; i++) world.update(1 / 60, flat, player);
  check('mobs spawn around the player', world.mobs.length > 0, `${world.mobs.length} mobs`);
  check('spawns are not on top of the player',
    world.mobs.every((m) => Math.hypot(m.x - player.x, m.z - player.z) > 10));
  check('the mob cap is respected', world.mobs.length <= 30, `${world.mobs.length}`);
}

{
  const world = new MobWorld(Dimension.Overworld);
  const mob = world.spawn(MobKind.Pig, 0.5, 41, 0.5);
  // Walking far away should despawn it.
  for (let i = 0; i < 30; i++) world.update(1 / 60, flat, { x: 500, y: 41, z: 500 });
  check('distant mobs are dropped', !world.mobs.includes(mob));
}

{
  const world = new MobWorld(Dimension.Overworld);
  const target = world.spawn(MobKind.Cow, 6.5, 41, 0.5);
  world.spawn(MobKind.Cow, 40.5, 41, 0.5);
  check('looking at a mob picks it',
    world.pick(0.5, 41.6, 0.5, 1, 0, 0, 8) === target);
  check('looking away picks nothing',
    world.pick(0.5, 41.6, 0.5, -1, 0, 0, 8) === null);
  target.hurt(1000);
  check('a dead mob cannot be picked',
    world.pick(0.5, 41.6, 0.5, 1, 0, 0, 8) === null);
}

// --- models -----------------------------------------------------------------
{
  const stubAtlas = { uv: () => [0, 0, 0.25, 0.25], canvas: null, iconURL: () => '' } as any;
  for (const kind of [MobKind.Pig, MobKind.Cow, MobKind.Sheep, MobKind.Chicken, MobKind.Zombie]) {
    const mob = new Mob(kind, 10, 40, 20, 45);
    mob.phase = 1.1;
    const mesh = buildMobMesh(stubAtlas, [mob]);
    const count = mesh.vertices.length / 7;
    const finite = mesh.vertices.every(Number.isFinite);
    const indicesOk = mesh.indices.every((i) => i < count) &&
      count % 4 === 0 && mesh.indices.length === (count / 4) * 6;

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < mesh.vertices.length; i += 7) {
      minY = Math.min(minY, mesh.vertices[i]);
      maxY = Math.max(maxY, mesh.vertices[i + 0 - 0]);
    }
    const def = mobDef(kind);
    check(`${def.name} model builds`, count > 0 && finite && indicesOk, `${count} verts`);
    check(`${def.name} model stands on its feet`,
      minY > 40 - 0.2 && maxY < 40 + def.height + 0.35,
      `y ${(minY - 40).toFixed(2)}..${(maxY - 40).toFixed(2)} for a ${def.height} tall mob`);
  }

  const dead = new Mob(MobKind.Pig, 0, 40, 0);
  dead.hurt(1000);
  check('dead mobs are not drawn', buildMobMesh(stubAtlas, [dead]).indices.length === 0);
}

// --- the ending: blaze, enderman, dragon ------------------------------------
check('blazes live in the nether',
  spawnableIn(Dimension.Nether, 'hostile').some((d) => d.kind === MobKind.Blaze));
check('blazes fly', mobDef(MobKind.Blaze).flying);
check('blazes drop the rod the eye needs',
  rollDrops(MobKind.Blaze, () => 0.99).some((d) => d.id === Item.BlazeRod));

{
  // A flier should hold its altitude rather than dropping out of the air.
  const blaze = new Mob(MobKind.Blaze, 8.5, 60, 8.5);
  sim(blaze, flat, nowhere, 4);
  check('a blaze does not fall', blaze.y > 55, `y=${blaze.y.toFixed(1)}`);

  // And it attacks from range, unlike everything else.
  const gunner = new Mob(MobKind.Blaze, 0.5, 41, 0.5);
  const far = { x: 11.5, y: 41, z: 0.5 };
  check('a blaze hits from a distance',
    gunner.tryAttack(far.x, far.y, far.z) === mobDef(MobKind.Blaze).rangedAttack);
  const zombie = new Mob(MobKind.Zombie, 0.5, 41, 0.5);
  check('a zombie cannot', zombie.tryAttack(far.x, far.y, far.z) === 0);
}

check('endermen drop pearls',
  rollDrops(MobKind.Enderman, () => 0.99).some((d) => d.id === Item.EnderPearl));
check('endermen are neutral', mobDef(MobKind.Enderman).temper === 'neutral');

{
  // Neutral: ignores you until provoked, then commits.
  const enderman = new Mob(MobKind.Enderman, 4.5, 41, 0.5);
  const player = { x: 0.5, y: 41, z: 0.5 };
  sim(enderman, flat, player, 2);
  check('an unprovoked enderman leaves you alone', enderman.state !== 'chase', enderman.state);

  const before = { x: enderman.x, z: enderman.z };
  enderman.hurt(4);
  check('a struck enderman blinks away',
    Math.hypot(enderman.x - before.x, enderman.z - before.z) > 3,
    `${Math.hypot(enderman.x - before.x, enderman.z - before.z).toFixed(1)} blocks`);
  check('and it is now angry', enderman.angered);

  sim(enderman, flat, player, 3);
  check('an angry enderman hunts you down', enderman.state === 'chase');
}

// --- the dragon -------------------------------------------------------------
{
  const def = mobDef(MobKind.EnderDragon);
  check('the dragon is a boss', def.boss);
  check('the dragon has a lot of health', def.health >= 100, `${def.health}`);
  check('the dragon never spawns naturally',
    !spawnableIn(Dimension.End, 'hostile').some((d) => d.kind === MobKind.EnderDragon));

  const dragon = new Mob(MobKind.EnderDragon, 0, 88, 0);
  const player = { x: 6, y: 70, z: 6 };
  // It should circle rather than sit still.
  const start = { x: dragon.x, z: dragon.z };
  sim(dragon, flat, player, 3);
  check('the dragon flies a circuit',
    Math.hypot(dragon.x - start.x, dragon.z - start.z) > 5,
    `moved ${Math.hypot(dragon.x - start.x, dragon.z - start.z).toFixed(1)} blocks`);
  check('the dragon stays airborne', dragon.y > 40, `y=${dragon.y.toFixed(1)}`);

  // Over a long run it must come down and threaten the player at least once.
  let closest = Infinity;
  for (let i = 0; i < 60 * 40; i++) {
    dragon.update(1 / 60, flat, player, Math.random);
    closest = Math.min(closest, Math.hypot(dragon.x - player.x, dragon.z - player.z));
  }
  check('the dragon swoops at the player', closest < 12,
    `closest approach ${closest.toFixed(1)} blocks`);
}

{
  const world = new MobWorld(Dimension.End);
  const dragon = world.spawn(MobKind.EnderDragon, 0, 88, 0);
  check('the boss is findable for the health bar', world.boss === dragon);
  check('has() reports the boss', world.has(MobKind.EnderDragon));

  // A boss must not despawn when the player wanders off.
  for (let i = 0; i < 120; i++) world.update(1 / 60, flat, { x: 900, y: 60, z: 900 });
  check('the boss does not despawn', world.mobs.includes(dragon));

  dragon.hurt(1000);
  world.update(1 / 60, flat, { x: 0, y: 60, z: 0 });
  check('a beaten boss is removed', !world.mobs.includes(dragon) && world.boss === null);
}

{
  const stubAtlas = { uv: () => [0, 0, 0.25, 0.25], canvas: null, iconURL: () => '' } as any;
  for (const kind of [MobKind.Blaze, MobKind.Enderman, MobKind.EnderDragon]) {
    const mob = new Mob(kind, 0, 40, 0, 30);
    mob.phase = 0.8;
    const mesh = buildMobMesh(stubAtlas, [mob]);
    const count = mesh.vertices.length / 7;
    check(`${mobDef(kind).name} model builds`,
      count > 0 && mesh.vertices.every(Number.isFinite) &&
      mesh.indices.every((i) => i < count), `${count} verts`);
  }
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} failed`}`);
process.exit(failures ? 1 : 0);
