/**
 * The building pack: slabs, stairs, fences, gates, walls, panes, doors,
 * trapdoors, the campfire, and the recipes that make them.
 * Run: npx tsx tests/building.ts
 *
 * Everything here is driven the way the game drives it -- placement through
 * the pack's placement hooks, right-clicks through the use dispatcher,
 * breaking through the break hooks, movement through a real Player -- so a
 * check passing means the thing works in play, not merely that the data
 * looks plausible.
 */

import { Block, blockDef, canReplace, isSolid } from '../shared/src/blocks.js';
import { WORLD_Y } from '../shared/src/constants.js';
import { Item, blockDrops, fuelValue, isBlockItem, itemDef, smeltResult } from '../shared/src/items.js';
import { findRecipe } from '../shared/src/recipes.js';
import { collisionOf, selectionOf, shapeOf, type Around, type Box } from '../shared/src/shapes.js';
import { DOORS_CLOSED, DOORS_OPEN, TRAPDOORS_OPEN } from '../shared/src/content/building.js';
import { Player, type InputState } from '../client/src/player.js';
import {
  dispatchAfterPlace, dispatchBreak, dispatchPlacement, dispatchUse,
  type GameContext, type PlaceContext, type UseContext,
} from '../client/src/content/api.js';
import { campfireCooks, facingFromYaw } from '../client/src/content/building.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- a small world and a game context over it ---------------------------------

const GROUND = 40;

interface Game {
  ctx: GameContext;
  world: { getBlock(x: number, y: number, z: number): number; isLoaded(): boolean };
  put(x: number, y: number, z: number, id: number): void;
  get(x: number, y: number, z: number): number;
  /** Everything handed to the player, in order. */
  given: Array<{ id: number; count: number }>;
  held: { id: number | null; count: number };
  place(x: number, y: number, z: number, face: [number, number, number], yaw?: number): boolean;
  use(x: number, y: number, z: number, yaw?: number): boolean;
  /** Mining by hand, as main.ts's breakBlock does it. */
  mine(x: number, y: number, z: number): void;
}

function makeGame(): Game {
  const cells = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const get = (x: number, y: number, z: number): number => {
    if (y < 0 || y >= WORLD_Y) return Block.Air;
    const own = cells.get(key(x, y, z));
    if (own !== undefined) return own;
    return y <= GROUND ? Block.Stone : Block.Air;
  };
  const put = (x: number, y: number, z: number, id: number) => { cells.set(key(x, y, z), id); };
  const world = { getBlock: get, isLoaded: () => true };
  const given: Array<{ id: number; count: number }> = [];
  const held = { id: null as number | null, count: 0 };
  const player = new Player();
  // Well away from the action, so placement never refuses for overlapping it.
  player.x = 100.5; player.y = GROUND + 1; player.z = 100.5;

  const ctx: GameContext = {
    world: world as unknown as GameContext['world'],
    dimension: 0 as GameContext['dimension'],
    player,
    mobs: null as unknown as GameContext['mobs'],
    creative: false,
    time: 0,
    sound: null as unknown as GameContext['sound'],
    getBlock: get,
    setBlock(x, y, z, id) {
      if (!canReplace(get(x, y, z), id)) return false;
      put(x, y, z, id);
      return true;
    },
    breakBlock(x, y, z, opts) {
      const id = get(x, y, z);
      if (id === Block.Air) return;
      if (opts?.drops !== false) for (const d of blockDrops(id, () => 0.5, null)) given.push(d);
      put(x, y, z, Block.Air);
      dispatchBreak(ctx, x, y, z, id, null);
    },
    heldItem: () => held.id,
    consumeHeld(count = 1) {
      if (held.id === null || held.count < count) return false;
      held.count -= count;
      if (held.count === 0) held.id = null;
      return true;
    },
    replaceHeld(id, count = 1) { held.id = id; held.count = count; },
    give(id, count) { given.push({ id, count }); },
    dropItem(_x, _y, _z, id, count) { given.push({ id, count }); },
    damagePlayer() {}, healPlayer() {}, pushPlayer() {}, hurtMob() {},
    toast() {}, chat() {}, breakParticles() {}, swing() {},
    random: () => 0.5,
  };

  const useCtx = (x: number, y: number, z: number, face: [number, number, number]): UseContext => ({
    ...ctx, x, y, z, id: get(x, y, z), face,
    point: [x + 0.5 + face[0] * 0.5, y + 0.5 + face[1] * 0.5, z + 0.5 + face[2] * 0.5],
    held: held.id, sneaking: false,
  });

  return {
    ctx, world, put, get, given, held,
    // Mirrors main.ts's tryPlace: hooks first, then the item's own block, then
    // the replace rule and the body check, then the after-place hooks.
    place(x, y, z, face, yaw = -90) {
      player.yaw = yaw;
      const item = held.id;
      if (item === null) return false;
      const pctx = Object.assign(useCtx(x, y, z, face), {
        px: x + face[0], py: y + face[1], pz: z + face[2], allowReplace: false,
      }) as PlaceContext;
      const hooked = dispatchPlacement(pctx, item);
      if (hooked === null) return false;
      const placed = hooked ?? (isBlockItem(item) ? item : itemDef(item).places);
      if (placed === undefined) return false;
      const current = get(pctx.px, pctx.py, pctx.pz);
      if (!pctx.allowReplace && !canReplace(current, placed)) return false;
      if (pctx.allowReplace && current !== Block.Air && !canReplace(current, placed)) return false;
      if (player.intersects(pctx.px, pctx.py, pctx.pz, placed, world as never)) return false;
      if (!ctx.consumeHeld(1)) return false;
      put(pctx.px, pctx.py, pctx.pz, placed);
      dispatchAfterPlace(ctx, pctx.px, pctx.py, pctx.pz, placed);
      return true;
    },
    use(x, y, z, yaw = -90) {
      player.yaw = yaw;
      return dispatchUse(useCtx(x, y, z, [0, 1, 0]));
    },
    mine(x, y, z) {
      const id = get(x, y, z);
      for (const d of blockDrops(id, () => 0.5, null)) given.push(d);
      put(x, y, z, Block.Air);
      dispatchBreak(ctx, x, y, z, id, null);
    },
  };
}

const UP: [number, number, number] = [0, 1, 0];
const count = (list: Array<{ id: number; count: number }>, id: number) =>
  list.filter((d) => d.id === id).reduce((a, d) => a + d.count, 0);
const top = (boxes: Box[]) => Math.max(...boxes.map((b) => b.y1));

// --- slabs ------------------------------------------------------------------

{
  const pairs: Array<[number, number]> = [
    [Block.StoneSlab, Block.Stone],
    [Block.CobblestoneSlab, Block.Cobblestone],
    [Block.PlankSlab, Block.Planks],
    [Block.StoneBrickSlab, Block.StoneBricks],
    [Block.BrickSlab, Block.Bricks],
  ];
  // Sandstone itself is the nature pack's block; stacking into it can only
  // be checked once that pack is in the build.
  if (blockDef(Block.Sandstone).id === Block.Sandstone) pairs.push([Block.SandstoneSlab, Block.Sandstone]);
  else console.log('note  sandstone slab stacking skipped: the nature pack is not loaded here');

  pairs.forEach(([slab, full], i) => {
    const g = makeGame();
    const x = i * 3;
    g.held.id = slab; g.held.count = 2;
    g.place(x, GROUND, 0, UP);
    check(`${blockDef(slab).name}: goes down as a half slab`, g.get(x, GROUND + 1, 0) === slab);
    g.place(x, GROUND + 1, 0, UP);
    check(`${blockDef(slab).name}: a second one on top makes ${blockDef(full).name}`,
      g.get(x, GROUND + 1, 0) === full && g.get(x, GROUND + 2, 0) === Block.Air,
      `got ${g.get(x, GROUND + 1, 0)} / ${g.get(x, GROUND + 2, 0)}`);
    check(`${blockDef(slab).name}: both slabs were used`, g.held.count === 0);
  });

  const g = makeGame();
  g.put(0, GROUND + 1, 0, Block.StoneSlab);
  g.held.id = Block.CobblestoneSlab; g.held.count = 1;
  g.place(0, GROUND + 1, 0, UP);
  check('a different slab on top stacks above instead of merging',
    g.get(0, GROUND + 1, 0) === Block.StoneSlab && g.get(0, GROUND + 2, 0) === Block.CobblestoneSlab);
  check('the replace rule refuses a mismatched merge', !canReplace(Block.StoneSlab, Block.Cobblestone));

  const side = makeGame();
  side.put(0, GROUND + 1, 0, Block.StoneSlab);
  side.held.id = Block.StoneSlab; side.held.count = 1;
  side.place(0, GROUND + 1, 0, [1, 0, 0]);
  check('a slab placed against the side of a slab goes beside it',
    side.get(0, GROUND + 1, 0) === Block.StoneSlab && side.get(1, GROUND + 1, 0) === Block.StoneSlab);

  const wall = makeGame();
  wall.put(1, GROUND + 1, 0, Block.StoneSlab);
  wall.held.id = Block.StoneSlab; wall.held.count = 1;
  wall.place(0, GROUND + 1, 0, [1, 0, 0]);
  check('aiming at a wall beside a slab of the same kind fills that slab',
    wall.get(1, GROUND + 1, 0) === Block.Stone);

  check('a slab is half a block', top(shapeOf(Block.StoneSlab)) === 0.5 && top(collisionOf(Block.StoneSlab)) === 0.5);
  check('a slab does not hide its neighbours', !blockDef(Block.StoneSlab).opaque);
}

// --- stairs -------------------------------------------------------------------

{
  const expect: Array<[number, number, string]> = [
    [-90, Block.PlankStairsN, 'north'], [0, Block.PlankStairsE, 'east'],
    [90, Block.PlankStairsS, 'south'], [180, Block.PlankStairsW, 'west'],
  ];
  for (const [yaw, id, label] of expect) {
    const g = makeGame();
    g.held.id = Block.PlankStairsN; g.held.count = 1;
    g.place(0, GROUND, 0, UP, yaw);
    check(`looking ${label}, a stair is placed rising ${label}`, g.get(0, GROUND + 1, 0) === id,
      `got ${g.get(0, GROUND + 1, 0)}`);
  }
  check('yaw snaps to the nearest quarter turn', facingFromYaw(-100) === 0 && facingFromYaw(40) === 1 &&
    facingFromYaw(130) === 2 && facingFromYaw(-170) === 3);

  // The tall half sits on the side the stair rises toward.
  const riser = (id: number) => shapeOf(id).find((b) => b.y0 === 0.5)!;
  check('a north stair has its upper step on the north half', riser(Block.PlankStairsN).z1 === 0.5);
  check('an east stair has its upper step on the east half', riser(Block.PlankStairsE).x0 === 0.5);
  check('a south stair has its upper step on the south half', riser(Block.PlankStairsS).z0 === 0.5);
  check('a west stair has its upper step on the west half', riser(Block.PlankStairsW).x1 === 0.5);
  for (const [yaw, id] of [[-90, Block.BrickStairsN], [0, Block.BrickStairsE], [90, Block.BrickStairsS], [180, Block.BrickStairsW]]) {
    const g = makeGame();
    g.held.id = Block.BrickStairsN; g.held.count = 1;
    g.place(0, GROUND, 0, UP, yaw);
    check(`brick stairs face the way the player looks too (yaw ${yaw})`, g.get(0, GROUND + 1, 0) === id);
  }
  check('every facing breaks back into the one stair item',
    [Block.CobblestoneStairsE, Block.CobblestoneStairsS, Block.CobblestoneStairsW]
      .every((id) => blockDrops(id)[0]?.id === Block.CobblestoneStairsN));
  check('only the north stair is listed in the creative menu',
    blockDef(Block.StoneBrickStairsN).category === 'building' && !blockDef(Block.StoneBrickStairsE).category);
}

// --- walking: slabs, stairs, fences, gates, doors -----------------------------------------

function keys(over: Partial<InputState> = {}): InputState {
  return { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false, ...over };
}

/** Walks a player north (-z) for a while from z = 8.5, holding jump if asked. */
function walkNorth(g: Game, seconds: number, jump = false): Player {
  const p = new Player();
  p.x = 0.5; p.y = GROUND + 1; p.z = 8.5; p.yaw = -90; p.pitch = 0;
  for (let i = 0; i < seconds * 60; i++) p.update(1 / 60, g.world as never, keys({ forward: true, jump }));
  return p;
}

{
  const g = makeGame();
  for (let x = -3; x <= 3; x++) g.put(x, GROUND + 1, 5, Block.PlankFence);
  const p = walkNorth(g, 5, true);
  check('a player cannot jump a fence', p.z > 5.5, `z=${p.z.toFixed(2)} y=${p.y.toFixed(2)}`);
  check('fence collision is one and a half blocks tall',
    top(collisionOf(Block.PlankFence)) === 1.5 && top(shapeOf(Block.PlankFence)) === 1);
  check('but the fence is only drawn and selected one block tall',
    top(selectionOf(Block.PlankFence)) === 1);

  const s = makeGame();
  for (let x = -3; x <= 3; x++) { s.put(x, GROUND + 1, 5, Block.StoneSlab); s.put(x, GROUND + 1, 4, Block.StoneSlab); }
  let peak = 0;
  const q = new Player();
  q.x = 0.5; q.y = GROUND + 1; q.z = 8.5; q.yaw = -90;
  for (let i = 0; i < 5 * 60; i++) {
    q.update(1 / 60, s.world as never, keys({ forward: true }));
    peak = Math.max(peak, q.y);
  }
  check('a player walks up onto a slab without jumping', Math.abs(peak - (GROUND + 1.5)) < 1e-6,
    `peak y=${peak.toFixed(3)}`);
  check('and on over it', q.z < 3, `z=${q.z.toFixed(2)}`);

  // A flight of stairs climbs to a landing; the back of a stair is a wall.
  const st = makeGame();
  for (let x = -3; x <= 3; x++) {
    st.put(x, GROUND + 1, 5, Block.CobblestoneStairsN);
    for (let z = 0; z <= 4; z++) st.put(x, GROUND + 1, z, Block.Cobblestone);
  }
  // Stop on the landing rather than after a fixed time: walked for too long,
  // the climber strolls off the far edge and the height says nothing.
  const climber = new Player();
  climber.x = 0.5; climber.y = GROUND + 1; climber.z = 8.5; climber.yaw = -90;
  for (let i = 0; i < 5 * 60 && climber.z > 2; i++) {
    climber.update(1 / 60, st.world as never, keys({ forward: true }));
  }
  check('walking into a stair from its low side climbs it without jumping',
    Math.abs(climber.y - (GROUND + 2)) < 1e-6 && climber.z <= 2, `y=${climber.y.toFixed(3)} z=${climber.z.toFixed(2)}`);
  const back = makeGame();
  for (let x = -3; x <= 3; x++) back.put(x, GROUND + 1, 5, Block.CobblestoneStairsS);
  const stopped = walkNorth(back, 3);
  check('the tall back of a stair stops a walker', stopped.z > 6, `z=${stopped.z.toFixed(2)}`);

  // Gates: shut, they hold like the fence; open, they are walked through.
  const gate = makeGame();
  for (let x = -3; x <= 3; x++) gate.put(x, GROUND + 1, 5, x === 0 ? Block.FenceGateX : Block.PlankFence);
  check('a shut gate blocks like the fence', walkNorth(gate, 4, true).z > 5.5);
  gate.use(0, GROUND + 1, 5);
  check('right-clicking a gate opens it', gate.get(0, GROUND + 1, 5) === Block.FenceGateXOpen);
  check('an open gate has no collision', !isSolid(Block.FenceGateXOpen) && !isSolid(Block.FenceGateZOpen));
  check('a player walks through an open gate', walkNorth(gate, 4).z < 4);
  gate.use(0, GROUND + 1, 5);
  check('right-clicking again shuts it', gate.get(0, GROUND + 1, 5) === Block.FenceGateX);

  // Doors: a shut door holds; an open one clears the doorway.
  const d = makeGame();
  for (let x = -3; x <= 3; x++) {
    if (x === 0) continue;
    d.put(x, GROUND + 1, 5, Block.Stone);
    d.put(x, GROUND + 2, 5, Block.Stone);
  }
  d.put(0, GROUND + 1, 5, Block.WoodDoorN);
  d.put(0, GROUND + 2, 5, Block.WoodDoorN);
  check('a shut door blocks the doorway', walkNorth(d, 4).z > 5.1);
  d.use(0, GROUND + 1, 5);
  check('an open door lets a player through', walkNorth(d, 4).z < 4);
}

// --- fences, walls and panes: joining their neighbours ------------------------------------

/** Neighbours given as a map of "dx,dz" to block. */
function beside(map: Record<string, number>): Around {
  return (dx, dy, dz) => (dy === 0 ? map[`${dx},${dz}`] ?? Block.Air : Block.Air);
}
const reaches = (boxes: Box[], side: 'n' | 'e' | 's' | 'w') => boxes.some((b) =>
  side === 'n' ? b.z0 === 0 : side === 'e' ? b.x1 === 1 : side === 's' ? b.z1 === 1 : b.x0 === 0);

{
  const fence = (map: Record<string, number>) => shapeOf(Block.PlankFence, beside(map));
  check('a lone fence is just its post', fence({}).length === 1 && !reaches(fence({}), 'n'));
  check('a fence reaches toward a fence beside it', reaches(fence({ '1,0': Block.PlankFence }), 'e') &&
    !reaches(fence({ '1,0': Block.PlankFence }), 'w'));
  check('a fence reaches toward a full solid block', reaches(fence({ '0,-1': Block.Stone }), 'n'));
  check('a fence reaches toward a gate lined up with it', reaches(fence({ '1,0': Block.FenceGateX }), 'e') &&
    reaches(fence({ '0,1': Block.FenceGateZOpen }), 's'));
  check('but not toward a gate turned across it', !reaches(fence({ '1,0': Block.FenceGateZ }), 'e'));
  check('a fence does not reach toward a torch, a pane or a slab',
    !reaches(fence({ '1,0': Block.Torch, '-1,0': Block.GlassPane, '0,1': Block.StoneSlab }), 'e') &&
    fence({ '1,0': Block.Torch, '-1,0': Block.GlassPane, '0,1': Block.StoneSlab }).length === 1);
  check('a fence does not reach toward a chest, which is no longer a full cube',
    fence({ '1,0': Block.Chest }).length === 1);
  // The Miner is a full machine block the pack's fallback list does not
  // know; joining it proves the registry-backed rule is the one in force.
  check('a fence joins any full solid block through the registry', reaches(fence({ '1,0': Block.Miner }), 'e'));
  check('fence arms collide one and a half high too',
    top(collisionOf(Block.PlankFence, beside({ '1,0': Block.PlankFence }))) === 1.5 &&
    collisionOf(Block.PlankFence, beside({ '1,0': Block.PlankFence })).length === 2);

  const wall = (map: Record<string, number>) => shapeOf(Block.CobblestoneWall, beside(map));
  const straight = wall({ '0,-1': Block.CobblestoneWall, '0,1': Block.CobblestoneWall });
  check('a straight run of wall drops its post', straight.length === 1 && top(straight) < 1);
  const corner = wall({ '0,-1': Block.CobblestoneWall, '1,0': Block.CobblestoneWall });
  check('a wall corner keeps its post', corner.length === 3 && top(corner) === 1);
  check('a wall is chunkier than a fence', corner[0].x1 - corner[0].x0 === 0.5);
  check('a wall collides one and a half high', top(collisionOf(Block.CobblestoneWall)) === 1.5);

  const pane = (id: number, map: Record<string, number>) => shapeOf(id, beside(map));
  check('a lone pane is a small post', pane(Block.GlassPane, {}).length === 1 &&
    pane(Block.GlassPane, {})[0].x1 - pane(Block.GlassPane, {})[0].x0 === 2 / 16);
  check('panes join panes, bars and full blocks',
    reaches(pane(Block.GlassPane, { '1,0': Block.IronBars }), 'e') &&
    reaches(pane(Block.IronBars, { '-1,0': Block.Stone }), 'w') &&
    reaches(pane(Block.GlassPane, { '0,1': Block.GlassPane }), 's'));
  check('panes do not join fences', !reaches(pane(Block.GlassPane, { '1,0': Block.PlankFence }), 'e'));
}

// --- gates and doors in placement -------------------------------------------------

{
  const g = makeGame();
  g.held.id = Block.FenceGateX; g.held.count = 2;
  g.place(0, GROUND, 0, UP, -90);
  g.place(2, GROUND, 0, UP, 0);
  check('looking north, a gate spans east-west', g.get(0, GROUND + 1, 0) === Block.FenceGateX);
  check('looking east, a gate spans north-south', g.get(2, GROUND + 1, 0) === Block.FenceGateZ);
  check('every gate state drops the one gate item',
    [Block.FenceGateZ, Block.FenceGateXOpen, Block.FenceGateZOpen].every((id) => blockDrops(id)[0]?.id === Block.FenceGateX));

  const d = makeGame();
  d.held.id = Item.WoodDoor; d.held.count = 1;
  d.place(0, GROUND, 0, UP, 90);
  check('a door item puts down both halves', d.get(0, GROUND + 1, 0) === Block.WoodDoorS &&
    d.get(0, GROUND + 2, 0) === Block.WoodDoorS, `${d.get(0, GROUND + 1, 0)} ${d.get(0, GROUND + 2, 0)}`);
  check('and uses exactly one door', d.held.count === 0);
  d.use(0, GROUND + 2, 0);
  check('clicking the top half opens both halves',
    d.get(0, GROUND + 1, 0) === Block.WoodDoorSOpen && d.get(0, GROUND + 2, 0) === Block.WoodDoorSOpen);
  d.use(0, GROUND + 1, 0);
  check('clicking the bottom half shuts both',
    d.get(0, GROUND + 1, 0) === Block.WoodDoorS && d.get(0, GROUND + 2, 0) === Block.WoodDoorS);
  d.mine(0, GROUND + 2, 0);
  check('breaking the top half takes the bottom too',
    d.get(0, GROUND + 1, 0) === Block.Air && d.get(0, GROUND + 2, 0) === Block.Air);
  check('and gives back exactly one door', count(d.given, Item.WoodDoor) === 1 && d.given.length === 1,
    JSON.stringify(d.given));

  const low = makeGame();
  low.put(0, GROUND + 1, 0, Block.WoodDoorEOpen);
  low.put(0, GROUND + 2, 0, Block.WoodDoorEOpen);
  low.mine(0, GROUND + 1, 0);
  check('breaking the bottom half of an open door takes both, one drop',
    low.get(0, GROUND + 2, 0) === Block.Air && count(low.given, Item.WoodDoor) === 1 && low.given.length === 1);

  const roof = makeGame();
  roof.put(0, GROUND + 2, 0, Block.Stone);
  roof.held.id = Item.WoodDoor; roof.held.count = 1;
  check('a door will not go under a one-high ceiling',
    !roof.place(0, GROUND, 0, UP) && roof.get(0, GROUND + 1, 0) === Block.Air && roof.held.count === 1);
  const stack = makeGame();
  stack.put(0, GROUND + 1, 0, Block.WoodDoorN);
  stack.put(0, GROUND + 2, 0, Block.WoodDoorN);
  stack.held.id = Item.WoodDoor; stack.held.count = 1;
  check('a door will not stack on a door', !stack.place(0, GROUND + 2, 0, UP));

  // Which half a cell draws as comes from the block beneath it.
  const lowerTex = shapeOf(Block.WoodDoorN, (_x, dy) => (dy === -1 ? Block.Stone : Block.WoodDoorN))[0].tex;
  const upperTex = shapeOf(Block.WoodDoorN, (_x, dy) => (dy === -1 ? Block.WoodDoorN : Block.Air))[0].tex;
  check('the bottom half draws the lower door and the top half the upper',
    String(lowerTex).includes('lower') && String(upperTex).includes('upper'), `${lowerTex} / ${upperTex}`);
  const shut = collisionOf(Block.WoodDoorN)[0];
  const open = collisionOf(Block.WoodDoorNOpen)[0];
  check('a shut door is a 3/16 panel on its edge', shut.z0 === 0 && shut.z1 === 3 / 16 && shut.x1 - shut.x0 === 1);
  check('an open door lies along the side of the doorway', open.x0 === 0 && open.x1 === 3 / 16 && open.z1 - open.z0 === 1);
}

// --- trapdoors ---------------------------------------------------------------------

{
  const g = makeGame();
  g.put(0, GROUND + 1, 0, Block.Trapdoor);
  check('a shut trapdoor is a thin slab on the floor', top(collisionOf(Block.Trapdoor)) === 3 / 16);
  g.use(0, GROUND + 1, 0, 0);
  check('opening it facing east stands it against the east edge', g.get(0, GROUND + 1, 0) === Block.TrapdoorOpenE &&
    collisionOf(Block.TrapdoorOpenE)[0].x0 === 13 / 16);
  g.use(0, GROUND + 1, 0, 0);
  check('clicking again shuts it', g.get(0, GROUND + 1, 0) === Block.Trapdoor);
  g.use(0, GROUND + 1, 0, -90);
  check('opened facing north it stands on the north edge', g.get(0, GROUND + 1, 0) === Block.TrapdoorOpenN &&
    collisionOf(Block.TrapdoorOpenN)[0].z1 === 3 / 16);
  check('every trapdoor state drops the trapdoor', TRAPDOORS_OPEN.every((id) => blockDrops(id)[0]?.id === Block.Trapdoor));
}

// --- families -------------------------------------------------------------------------

{
  const families: Record<string, number[]> = {
    fence_gate: [Block.FenceGateX, Block.FenceGateZ, Block.FenceGateXOpen, Block.FenceGateZOpen],
    wood_door: [...DOORS_CLOSED, ...DOORS_OPEN],
    trapdoor: [Block.Trapdoor, ...TRAPDOORS_OPEN],
  };
  for (const [name, ids] of Object.entries(families)) {
    check(`${name}: every state converts to every other`,
      ids.every((a) => ids.every((b) => a === b || canReplace(a, b))));
    check(`${name}: every state is in the family`, ids.every((id) => blockDef(id).family === name));
  }
  check('a door cannot become a trapdoor in place', !canReplace(Block.WoodDoorN, Block.Trapdoor));
  check('a gate cannot become a fence in place', !canReplace(Block.FenceGateX, Block.PlankFence));
  check('a full block does not split back into a slab in place', !canReplace(Block.Stone, Block.StoneSlab));
}

// --- the campfire ---------------------------------------------------------------------

{
  const g = makeGame();
  g.put(0, GROUND + 1, 0, Block.Campfire);
  g.held.id = Item.RawPorkchop; g.held.count = 2;
  const cooked = g.use(0, GROUND + 1, 0);
  check('right-clicking a campfire with raw meat cooks one piece',
    cooked && g.held.count === 1 && count(g.given, Item.CookedPorkchop) === 1, JSON.stringify(g.given));
  g.held.id = Item.Stick; g.held.count = 1;
  check('it will not cook a stick', !g.use(0, GROUND + 1, 0) && g.held.count === 1);
  check('nor cook what is already cooked', campfireCooks(Item.Steak) === null);
  check('it cooks each raw meat into its own dish', campfireCooks(Item.RawBeef) === Item.Steak &&
    campfireCooks(Item.RawChicken) === Item.CookedChicken);
  check('it will not smelt ore', campfireCooks(Block.IronOre) === null);
  check('a campfire gives off full light and burns to the touch',
    blockDef(Block.Campfire).light === 15 && blockDef(Block.Campfire).contactDamage > 0);
}

// --- models for the older blocks -------------------------------------------------------------

{
  const torch = shapeOf(Block.Torch)[0];
  check('a torch is a thin stick', torch.x0 === 7 / 16 && torch.x1 === 9 / 16 && torch.y1 === 10 / 16);
  const chest = shapeOf(Block.Chest)[0];
  check('a chest sits a pixel in from its cell and 14/16 tall',
    chest.x0 === 1 / 16 && chest.z1 === 15 / 16 && chest.y1 === 14 / 16);
  check('a bed is a 9/16 frame', top(shapeOf(Block.Bed)) === 9 / 16);
  check('a crafting table stays a cube', shapeOf(Block.CraftingTable).length === 1 &&
    top(shapeOf(Block.CraftingTable)) === 1);

  const hanging = shapeOf(Block.Lantern, (_x, dy) => (dy === 1 ? Block.Chain : Block.Air));
  const standing = shapeOf(Block.Lantern, (_x, dy) => (dy === -1 ? Block.Stone : Block.Air));
  check('a lantern under a chain hangs from it', top(hanging) === 1 && top(standing) < 1);
  check('a lantern is a full light', blockDef(Block.Lantern).light === 15);
  check('carpet is a sixteenth thick', top(shapeOf(Block.RedCarpet)) === 1 / 16);
}

// --- recipes, smelting and fuel -------------------------------------------------------------

function craft(rows: Array<Array<number | null>>): { id: number; count: number } | null {
  const width = Math.max(...rows.map((r) => r.length));
  const cells: Array<number | null> = [];
  for (const r of rows) for (let x = 0; x < width; x++) cells.push(r[x] ?? null);
  return findRecipe({ width, height: rows.length, cells })?.result ?? null;
}
const _ = null;

{
  const P = Block.Planks;
  const C = Block.Cobblestone;
  const S = Item.Stick;
  const yields = (label: string, got: { id: number; count: number } | null, id: number, n: number) =>
    check(`recipe: ${label}`, got?.id === id && got.count === n, JSON.stringify(got));
  yields('six cobblestone stairs-wise make 4 stairs', craft([[C, _, _], [C, C, _], [C, C, C]]), Block.CobblestoneStairsN, 4);
  yields('three stone in a row make 6 slabs', craft([[Block.Stone, Block.Stone, Block.Stone]]), Block.StoneSlab, 6);
  yields('four planks and two sticks make 3 fences', craft([[P, S, P], [P, S, P]]), Block.PlankFence, 3);
  yields('any planks make fences', craft([[Block.PinePlanks, S, Block.PinePlanks], [Block.PinePlanks, S, Block.PinePlanks]]),
    Block.PlankFence, 3);
  yields('a gate is planks between sticks', craft([[S, P, S], [S, P, S]]), Block.FenceGateX, 1);
  yields('six glass make 16 panes', craft([[Block.Glass, Block.Glass, Block.Glass], [Block.Glass, Block.Glass, Block.Glass]]),
    Block.GlassPane, 16);
  yields('six planks make 3 doors', craft([[P, P], [P, P], [P, P]]), Item.WoodDoor, 3);
  yields('six bricks stairs-wise make 4 brick stairs', craft([[Block.Bricks, _, _], [Block.Bricks, Block.Bricks, _],
    [Block.Bricks, Block.Bricks, Block.Bricks]]), Block.BrickStairsN, 4);
  yields('three bricks in a row make 6 brick slabs', craft([[Block.Bricks, Block.Bricks, Block.Bricks]]), Block.BrickSlab, 6);
  yields('four stone make 4 stone bricks', craft([[Block.Stone, Block.Stone], [Block.Stone, Block.Stone]]), Block.StoneBricks, 4);
  const nine = (id: number) => [[id, id, id], [id, id, id], [id, id, id]];
  yields('nine gold ingots make a gold block', craft(nine(Item.GoldIngot)), Block.GoldBlock, 1);
  yields('a gold block breaks back into nine ingots', craft([[Block.GoldBlock]]), Item.GoldIngot, 9);
  yields('nine diamonds make a diamond block', craft(nine(Item.Diamond)), Block.DiamondBlock, 1);
  yields('a coal block breaks back into nine coal', craft([[Block.CoalBlock]]), Item.Coal, 9);
  yields('two wool make three carpets', craft([[Block.RedWool, Block.RedWool]]), Block.RedCarpet, 3);
  yields('four string make wool', craft([[Item.String, Item.String], [Item.String, Item.String]]), Block.WhiteWool, 1);
  yields('a torch caged in iron makes lanterns', craft([[_, Item.IronIngot, _], [Item.IronIngot, Block.Torch, Item.IronIngot], [_, Item.IronIngot, _]]),
    Block.Lantern, 2);
  check('clay fires into terracotta', smeltResult(Block.Clay)?.id === Block.Terracotta);
  check('stone bricks crack in the furnace', smeltResult(Block.StoneBricks)?.id === Block.CrackedStoneBricks);
  check('a coal block burns ten times as long as coal', fuelValue(Block.CoalBlock) === fuelValue(Item.Coal) * 10);
}

// --- every shaped block admits it is not a cube ---------------------------------------------

{
  const shaped = [
    Block.StoneSlab, Block.PlankStairsN, Block.PlankFence, Block.FenceGateX, Block.CobblestoneWall,
    Block.GlassPane, Block.IronBars, Block.WoodDoorN, Block.Trapdoor, Block.Lantern, Block.Chain,
    Block.WhiteCarpet, Block.Campfire,
  ];
  check('no shaped block hides its neighbours\' faces', shaped.every((id) => !blockDef(id).opaque),
    shaped.filter((id) => blockDef(id).opaque).join(','));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
