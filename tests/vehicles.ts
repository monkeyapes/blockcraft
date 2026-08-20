/** Vehicle physics and recipe checks. Run: npx tsx tests/vehicles.ts */

import { Block } from '../shared/src/blocks.js';
import { Dimension, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { Item, breakTime, canHarvest, vehicleItem, vehicleKind } from '../shared/src/items.js';
import { findRecipe, type Grid } from '../shared/src/recipes.js';

// The vehicle module imports client-only types but no browser APIs at runtime.
import { SPECS, Vehicle, VehicleWorld } from '../client/src/vehicles.js';
import { bodyOf, buildVehicleMesh } from '../client/src/gfx/vehiclemesh.js';
import { buildPlayerMesh } from '../client/src/gfx/playermesh.js';
import type { InputState } from '../client/src/player.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

const _ = null;
const grid = (width: number, height: number, cells: Array<number | null>): Grid =>
  ({ width, height, cells });

/** A flat stone world at y<=40, air above. Mimics ClientWorld's interface. */
const flatWorld = {
  getBlock(_x: number, y: number, _z: number): number {
    if (y < 0 || y >= WORLD_Y) return Block.Air;
    return y <= 40 ? Block.Stone : Block.Air;
  },
  isLoaded: () => true,
} as any;

function keys(over: Partial<InputState> = {}): InputState {
  return {
    forward: false, back: false, left: false, right: false,
    jump: false, sneak: false, sprint: false, ...over,
  };
}

function simulate(v: Vehicle, input: InputState | null, seconds: number, dt = 1 / 60): void {
  for (let i = 0; i < seconds / dt; i++) v.update(dt, flatWorld, input);
}

// --- recipes ----------------------------------------------------------------
const P = Block.Planks;
const I = Item.IronIngot;
const G = Block.Glass;
const D = Item.Diamond;
const S = Item.Stick;

check('skateboard recipe',
  findRecipe(grid(3, 3, [P, P, P, I, _, I, _, _, _]))?.result.id === Item.Skateboard);
check('car recipe',
  findRecipe(grid(3, 3, [_, G, _, I, I, I, I, _, I]))?.result.id === Item.Car);
check('plane recipe',
  findRecipe(grid(3, 3, [I, _, I, I, G, I, I, D, I]))?.result.id === Item.Plane);
check('helicopter recipe',
  findRecipe(grid(3, 3, [I, I, I, _, G, _, I, D, I]))?.result.id === Item.Helicopter);
check('mining drill recipe',
  findRecipe(grid(3, 3, [_, D, I, D, I, I, I, _, S]))?.result.id === Item.MiningDrill);

// --- item <-> kind mapping --------------------------------------------------
check('vehicle items map to kinds', vehicleKind(Item.Car) === 'car');
check('kinds map back to items', vehicleItem('helicopter') === Item.Helicopter);
check('ordinary items are not vehicles', vehicleKind(Block.Stone) === null);

// --- the drill --------------------------------------------------------------
check('drill beats a diamond pickaxe on stone',
  breakTime(Block.Stone, Item.MiningDrill) < breakTime(Block.Stone, Item.DiamondPickaxe),
  `${breakTime(Block.Stone, Item.MiningDrill).toFixed(3)}s vs ` +
  `${breakTime(Block.Stone, Item.DiamondPickaxe).toFixed(3)}s`);
check('drill is fast on wood too, not just stone',
  breakTime(Block.Log, Item.MiningDrill) < breakTime(Block.Log, Item.DiamondPickaxe));
check('drill harvests everything',
  canHarvest(Block.Obsidian, Item.MiningDrill) &&
  canHarvest(Block.DiamondOre, Item.MiningDrill) &&
  canHarvest(Block.Dirt, Item.MiningDrill));
check('drill still cannot break bedrock',
  breakTime(Block.Bedrock, Item.MiningDrill) === Infinity);

// --- gravity and landing ----------------------------------------------------
const dropped = new Vehicle('car', 8.5, 60, 8.5, 0);
simulate(dropped, null, 6);
check('a vehicle falls and lands on the ground',
  dropped.onGround && Math.abs(dropped.y - 41) < 1.2, `y=${dropped.y.toFixed(2)}`);

// --- the car accelerates and steers ----------------------------------------
const car = new Vehicle('car', 8.5, 41, 8.5, 0);
simulate(car, null, 1);
const startX = car.x;
simulate(car, keys({ forward: true }), 3);
check('car accelerates forward', car.x > startX + 5,
  `travelled ${(car.x - startX).toFixed(1)} blocks, ${car.speed.toFixed(1)} m/s`);
check('car respects its top speed', car.speed <= SPECS.car.maxSpeed + 0.01);

const headingBefore = car.yaw;
simulate(car, keys({ forward: true, right: true }), 1);
check('car steers while moving', Math.abs(car.yaw - headingBefore) > 10,
  `turned ${(car.yaw - headingBefore).toFixed(0)} degrees`);

const parked = new Vehicle('car', 8.5, 41, 8.5, 0);
simulate(parked, null, 0.5);
const parkedYaw = parked.yaw;
simulate(parked, keys({ right: true }), 1);
check('a stationary car does not spin on the spot',
  Math.abs(parked.yaw - parkedYaw) < 1, `moved ${(parked.yaw - parkedYaw).toFixed(2)} degrees`);

// --- the skateboard keeps its momentum -------------------------------------
const board = new Vehicle('skateboard', 8.5, 41, 8.5, 0);
simulate(board, null, 0.5);
simulate(board, keys({ forward: true }), 2.5);
const rollingSpeed = board.speed;
simulate(board, keys(), 1.5); // stop pushing
check('skateboard coasts rather than stopping dead',
  board.speed > rollingSpeed * 0.5,
  `${rollingSpeed.toFixed(1)} -> ${board.speed.toFixed(1)} m/s after 1.5s`);

const carCoast = new Vehicle('car', 8.5, 41, 8.5, 0);
simulate(carCoast, null, 0.5);
simulate(carCoast, keys({ forward: true }), 2.5);
const carRolling = carCoast.speed;
simulate(carCoast, keys(), 1.5);
check('a car slows faster than a skateboard',
  carCoast.speed / carRolling < board.speed / rollingSpeed,
  `car kept ${((carCoast.speed / carRolling) * 100).toFixed(0)}%, ` +
  `board kept ${((board.speed / rollingSpeed) * 100).toFixed(0)}%`);

// --- the plane needs airspeed ----------------------------------------------
const plane = new Vehicle('plane', 8.5, 60, 8.5, 0);
simulate(plane, keys(), 2);
check('a plane with no throttle sinks', plane.y < 60, `y=${plane.y.toFixed(1)}`);

// Already at cruising speed and level: it should hold its altitude, which is
// what the damped-climb model exists to get right.
const cruising = new Vehicle('plane', 8.5, 60, 8.5, 0);
cruising.speed = 40;
simulate(cruising, keys({ forward: true }), 2.5);
check('a plane cruising level holds its altitude', Math.abs(cruising.y - 60) < 2,
  `y=${cruising.y.toFixed(2)} at ${cruising.speed.toFixed(1)} m/s`);

// The real gameplay path: sat on the ground, throttle up, then pull back on
// the stick. Pitch lives on the mouse now, which is `aimY`.
const takeoff = new Vehicle('plane', 8.5, 41, 8.5, 0);
simulate(takeoff, keys({ forward: true }), 2.5); // roll out
takeoff.aimY = 1;                                // pull back
simulate(takeoff, keys({ forward: true }), 3);
check('a plane takes off from the ground', takeoff.y > 50,
  `y=${takeoff.y.toFixed(1)} at ${takeoff.speed.toFixed(1)} m/s`);
check('plane reaches a high top speed', takeoff.speed > 25,
  `${takeoff.speed.toFixed(1)} m/s`);

// Hands off the stick, the aircraft should level itself out.
const levelling = new Vehicle('plane', 8.5, 70, 8.5, 0);
levelling.speed = 40;
levelling.roll = 55;
levelling.pitch = 30;
simulate(levelling, keys({ forward: true }), 3);
check('a plane self-levels when you let go',
  Math.abs(levelling.roll) < 12 && Math.abs(levelling.pitch) < 12,
  `roll ${levelling.roll.toFixed(1)}, pitch ${levelling.pitch.toFixed(1)}`);

// Banking, by keyboard and by mouse alike.
for (const [label, apply] of [
  ['keyboard', (v: Vehicle) => simulate(v, keys({ forward: true, right: true }), 2)],
  ['mouse', (v: Vehicle) => { v.aimX = 1; simulate(v, keys({ forward: true }), 2); }],
] as const) {
  const banking = new Vehicle('plane', 8.5, 60, 8.5, 0);
  simulate(banking, keys({ forward: true }), 3);
  const bankYaw = banking.yaw;
  apply(banking);
  check(`a banking plane changes heading (${label})`, Math.abs(banking.yaw - bankYaw) > 5,
    `turned ${(banking.yaw - bankYaw).toFixed(0)} degrees`);
}

// --- the helicopter hovers --------------------------------------------------
const heli = new Vehicle('helicopter', 8.5, 50, 8.5, 0);
simulate(heli, keys({ jump: true }), 2);
check('helicopter climbs on collective', heli.y > 52, `y=${heli.y.toFixed(1)}`);

// Let the climb bleed off first, then check it actually parks in the air.
simulate(heli, keys(), 2);
const hoverY = heli.y;
simulate(heli, keys(), 1.5);
check('helicopter holds a hover with no input', Math.abs(heli.y - hoverY) < 0.5,
  `${hoverY.toFixed(2)} -> ${heli.y.toFixed(2)}`);

const abandoned = new Vehicle('helicopter', 8.5, 60, 8.5, 0);
simulate(abandoned, null, 3);
check('a pilotless helicopter descends', abandoned.y < 58, `y=${abandoned.y.toFixed(1)}`);

// --- collision --------------------------------------------------------------
const wallWorld = {
  getBlock(x: number, y: number, _z: number): number {
    if (y < 0 || y >= WORLD_Y) return Block.Air;
    if (y <= 40) return Block.Stone;
    return x >= 20 ? Block.Stone : Block.Air; // wall at x=20
  },
  isLoaded: () => true,
} as any;

const crash = new Vehicle('car', 8.5, 41, 8.5, 0);
for (let i = 0; i < 60 * 6; i++) crash.update(1 / 60, wallWorld, keys({ forward: true }));
check('a vehicle cannot drive through a wall', crash.x < 20,
  `stopped at x=${crash.x.toFixed(2)}`);

// --- ray picking ------------------------------------------------------------
const fleet = new VehicleWorld();
const target = fleet.spawn('car', 10.5, 41, 8.5, 0);
fleet.spawn('car', 40.5, 41, 8.5, 0);

// A car sitting on the ground at y=41 is only 0.9 tall, so a standing
// player's eye (y ~= 42.6) looks slightly *down* at it.
const eyeY = 42.6;
const down = -0.5;
check('looking at a vehicle picks it',
  fleet.pick(8.5, eyeY, 8.5, 1, down, 0, 5) === target);
check('looking level, over the roof, picks nothing',
  fleet.pick(8.5, eyeY, 8.5, 1, 0, 0, 5) === null);
check('looking away picks nothing',
  fleet.pick(8.5, eyeY, 8.5, -1, down, 0, 5) === null);
check('out-of-range vehicles are not picked',
  fleet.pick(8.5, eyeY, 8.5, 1, down, 0, 1) === null);

fleet.remove(target);
check('removing a vehicle takes it out of the world',
  fleet.vehicles.length === 1 && fleet.pick(8.5, eyeY, 8.5, 1, down, 0, 5) === null);

// --- model geometry ---------------------------------------------------------
// A stub atlas: the mesh builder only needs UV rectangles.
const stubAtlas = {
  uv: () => [0, 0, 0.25, 0.25] as [number, number, number, number],
  canvas: null,
  iconURL: () => '',
} as any;

for (const kind of ['skateboard', 'car', 'plane', 'helicopter'] as const) {
  const v = new Vehicle(kind, 100, 50, 200, 45);
  v.spin = 1.3;
  v.pitch = 8;
  v.roll = -12;
  const mesh = buildVehicleMesh(stubAtlas, [v]);

  const verts = mesh.vertices;
  const finite = verts.every((n) => Number.isFinite(n));
  const vertexCount = verts.length / 7;
  const indicesInRange = mesh.indices.every((i) => i < vertexCount);
  // Every face is a quad: 4 vertices, 6 indices.
  const quadsConsistent = vertexCount % 4 === 0 &&
    mesh.indices.length === (vertexCount / 4) * 6;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < verts.length; i += 7) {
    minX = Math.min(minX, verts[i]);
    maxX = Math.max(maxX, verts[i]);
    minY = Math.min(minY, verts[i + 1]);
    maxY = Math.max(maxY, verts[i + 1]);
  }
  const centred = Math.abs((minX + maxX) / 2 - 100) < 2.5;
  const sitsAboveOrigin = minY > 50 - 1.5 && maxY < 50 + 3;

  check(`${kind} model builds geometry`, vertexCount > 0 && finite,
    `${vertexCount} verts`);
  check(`${kind} model indices are valid`, indicesInRange && quadsConsistent);
  check(`${kind} model is positioned on its vehicle`, centred && sitsAboveOrigin,
    `x ${minX.toFixed(1)}..${maxX.toFixed(1)}, y ${minY.toFixed(1)}..${maxY.toFixed(1)}`);
}

const empty = buildVehicleMesh(stubAtlas, []);
check('no vehicles means no geometry', empty.indices.length === 0);

// --- the rider actually sits on the thing ----------------------------------
for (const kind of ['skateboard', 'car', 'plane', 'helicopter'] as const) {
  const v = new Vehicle(kind, 50, 30, 60, 0); // facing +X
  const [sx, sy, sz] = v.seat();
  const spec = SPECS[kind];

  check(`${kind} seat sits above the hull`, sy > 30 && sy < 30 + spec.height,
    `seat y=${(sy - 30).toFixed(2)} of ${spec.height} tall`);
  // Facing +X, the forward offset must land on the x axis, not z.
  check(`${kind} seat follows the heading`,
    Math.abs(sx - (50 + spec.seatForward)) < 1e-6 && Math.abs(sz - 60) < 1e-6,
    `x offset ${(sx - 50).toFixed(2)}`);

  // Turned 90 degrees, the same offset must swing round to z.
  v.yaw = 90;
  const [rx, , rz] = v.seat();
  check(`${kind} seat rotates with the vehicle`,
    Math.abs(rx - 50) < 1e-6 && Math.abs(rz - (60 + spec.seatForward)) < 1e-6);
}

// --- headroom ---------------------------------------------------------------
// A seated player's head reaches ~1.03 above the seat. Nothing may occupy the
// column directly above the seat, or the head clips through it -- which is
// exactly what a roof over the car's cockpit did.
for (const kind of ['skateboard', 'car', 'plane', 'helicopter'] as const) {
  const v = new Vehicle(kind, 0, 0, 0, 0);
  const spec = SPECS[kind];
  const mesh = buildVehicleMesh(stubAtlas, [v]);

  void mesh;
  const seatX = spec.seatForward;
  const headLow = spec.seatHeight + 0.30;
  const headHigh = spec.seatHeight + 1.05;

  // Box overlap, not vertex sampling: a wide roof slab passing over the seat
  // has all four corners outside the head column and would slip through.
  const blocking = bodyOf(v).filter((box) =>
    Math.abs(box.cx - seatX) < box.hx + 0.22 &&
    Math.abs(box.cz - 0) < box.hz + 0.22 &&
    box.cy + box.hy > headLow &&
    box.cy - box.hy < headHigh);

  check(`${kind} leaves headroom above the seat`, blocking.length === 0,
    blocking.length ? `blocked by ${blocking.map((b) => b.texture).join(', ')}` : 'clear');
}

// A seated model must hang from its hips, not stand on the seat surface.
{
  const seatY = 40;
  const seated = buildPlayerMesh(stubAtlas, [
    { x: 0, y: seatY, z: 0, yaw: 0, phase: 0, stride: 0, seated: true },
  ]);
  const standing = buildPlayerMesh(stubAtlas, [
    { x: 0, y: seatY, z: 0, yaw: 0, phase: 0, stride: 0 },
  ]);
  const topOf = (m: { vertices: Float32Array }) => {
    let top = -Infinity;
    for (let i = 1; i < m.vertices.length; i += 7) top = Math.max(top, m.vertices[i]);
    return top;
  };
  const seatedTop = topOf(seated);
  const standingTop = topOf(standing);
  check('a seated player is lower than a standing one', seatedTop < standingTop - 0.5,
    `seated head ${(seatedTop - seatY).toFixed(2)}, standing head ${(standingTop - seatY).toFixed(2)}`);
  check('a seated head still clears the seat', seatedTop - seatY > 0.7,
    `${(seatedTop - seatY).toFixed(2)} above the seat`);
}

// keep the imports honest
void Dimension;
void voxelIndex;

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} failed`}`);
process.exit(failures ? 1 : 0);
