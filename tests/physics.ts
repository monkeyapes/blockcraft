/** Player collision checks. Run: npx tsx tests/physics.ts */

import { Block } from '../shared/src/blocks.js';
import { WORLD_Y } from '../shared/src/constants.js';
import { PLAYER_WIDTH, Player, type InputState } from '../client/src/player.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

const HALF = PLAYER_WIDTH / 2;

/** Ground at y<=40, plus whatever extra solid predicate is supplied. */
function makeWorld(solid: (x: number, y: number, z: number) => boolean) {
  return {
    getBlock(x: number, y: number, z: number): number {
      if (y < 0 || y >= WORLD_Y) return Block.Air;
      if (y <= 40) return Block.Stone;
      return solid(x, y, z) ? Block.Stone : Block.Air;
    },
    isLoaded: () => true,
  } as any;
}

function keys(over: Partial<InputState> = {}): InputState {
  return {
    forward: false, back: false, left: false, right: false,
    jump: false, sneak: false, sprint: false, ...over,
  };
}

function run(p: Player, world: any, input: InputState, seconds: number, dt = 1 / 60): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) p.update(dt, world, input);
}

/**
 * Is the player's body overlapping any solid block?
 *
 * Uses a hair of skin: resting flush against a face is correct contact, not
 * an overlap, and float noise (-18.7 - 0.3 = -19.000000000000004) would
 * otherwise report it as one.
 */
function insideTerrain(p: Player, world: any): boolean {
  const probe = HALF - 1e-3;
  for (let x = Math.floor(p.x - probe); x <= Math.floor(p.x + probe); x++) {
    for (let y = Math.floor(p.y + 1e-3); y <= Math.floor(p.y + 1.8 - 1e-3); y++) {
      for (let z = Math.floor(p.z - probe); z <= Math.floor(p.z + probe); z++) {
        if (world.getBlock(x, y, z) !== Block.Air) return true;
      }
    }
  }
  return false;
}

// --- standing ---------------------------------------------------------------
const flat = makeWorld(() => false);
const stander = new Player();
stander.x = 8.5; stander.y = 60; stander.z = 8.5;
run(stander, flat, keys(), 4);
check('player lands on the ground', stander.onGround && Math.abs(stander.y - 41) < 0.01,
  `y=${stander.y.toFixed(3)}`);
check('player is not inside terrain after landing', !insideTerrain(stander, flat));

// --- single wall, both directions ------------------------------------------
for (const [label, dir, wallAt, input] of [
  ['+X', 1, 20, keys({ forward: true })],
  ['-X', -1, -20, keys({ back: true })],
] as const) {
  const world = makeWorld((x) => (dir > 0 ? x >= wallAt : x <= wallAt));
  const p = new Player();
  p.x = 0.5; p.y = 41; p.z = 0.5; p.yaw = 0; // facing +X
  run(p, world, input, 12);
  const stopped = dir > 0 ? p.x < wallAt : p.x > wallAt + 1;
  const inside = insideTerrain(p, world);
  check(`player cannot walk through a wall (${label})`, stopped && !inside,
    `x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} stopped=${stopped} inside=${inside}`);
}

// --- thick wall: the direction bug showed up here ---------------------------
for (const [label, dir, input] of [
  ['+X', 1, keys({ forward: true })],
  ['-X', -1, keys({ back: true })],
] as const) {
  // A four-block-thick slab, so snapping to the wrong face lands inside it.
  const world = makeWorld((x) => (dir > 0 ? x >= 20 && x <= 23 : x <= -20 && x >= -23));
  const p = new Player();
  p.x = 0.5; p.y = 41; p.z = 0.5; p.yaw = 0;
  run(p, world, input, 14);
  const outside = dir > 0 ? p.x < 20 : p.x > -19;
  const inside = insideTerrain(p, world);
  check(`player cannot walk into a thick wall (${label})`, outside && !inside,
    `x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} outside=${outside} inside=${inside}`);
}

// --- same again on Z --------------------------------------------------------
for (const [label, dir, input] of [
  ['+Z', 1, keys({ right: true })],
  ['-Z', -1, keys({ left: true })],
] as const) {
  const world = makeWorld((_x, _y, z) => (dir > 0 ? z >= 20 && z <= 23 : z <= -20 && z >= -23));
  const p = new Player();
  p.x = 0.5; p.y = 41; p.z = 0.5; p.yaw = 0;
  run(p, world, input, 14);
  const outside = dir > 0 ? p.z < 20 : p.z > -19;
  const inside = insideTerrain(p, world);
  check(`player cannot walk into a thick wall (${label})`, outside && !inside,
    `z=${p.z.toFixed(2)} y=${p.y.toFixed(2)} outside=${outside} inside=${inside}`);
}

// --- tunnelling at terminal velocity ---------------------------------------
const deep = makeWorld(() => false);
const faller = new Player();
faller.x = 8.5; faller.y = 120; faller.z = 8.5;
// Deliberately awful frame times: this is what used to punch through the floor.
for (let i = 0; i < 200; i++) faller.update(0.1, deep, keys());
check('a long frame at terminal velocity does not tunnel',
  faller.onGround && Math.abs(faller.y - 41) < 0.01 && !insideTerrain(faller, deep),
  `y=${faller.y.toFixed(3)}`);

// --- a ceiling stops a jump -------------------------------------------------
const roofed = makeWorld((_x, y) => y === 44);
const jumper = new Player();
jumper.x = 8.5; jumper.y = 41; jumper.z = 8.5;
run(jumper, roofed, keys({ jump: true }), 3);
check('player cannot jump through a ceiling',
  jumper.y + 1.8 <= 44.001 && !insideTerrain(jumper, roofed), `y=${jumper.y.toFixed(2)}`);

// --- narrow gap -------------------------------------------------------------
// A one-block corridor: the player is 0.6 wide, so this must not wedge or leak.
const corridor = makeWorld((_x, _y, z) => z !== 8);
const walker = new Player();
walker.x = 0.5; walker.y = 41; walker.z = 8.5; walker.yaw = 0;
run(walker, corridor, keys({ forward: true }), 6);
check('player walks a one-block corridor without leaking out',
  !insideTerrain(walker, corridor) && walker.x > 10 && Math.abs(walker.z - 8.5) < 0.5,
  `x=${walker.x.toFixed(1)} z=${walker.z.toFixed(2)}`);

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} failed`}`);
process.exit(failures ? 1 : 0);
