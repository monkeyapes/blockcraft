/**
 * Block shapes, and the hitboxes that have to agree with them.
 * Run: npx tsx tests/shapes.ts
 *
 * The failure that matters here is not a crash, it is a lie: a conveyor drawn
 * as a low belt that stops the player at full block height, or a cable drawn
 * as a thin run that walls off the whole cell. Both look like the game is
 * broken in a way no error message would explain, so each shape is checked
 * against the behaviour it promises.
 */

import { Block } from '../shared/src/blocks.js';
import { CHUNK_X, CHUNK_Z, Dimension, SECTION_Y, WORLD_Y } from '../shared/src/constants.js';
import { ClientWorld } from '../client/src/world.js';
import { meshSection, FLOATS_PER_VERTEX } from '../client/src/mesher.js';
import {
  CABLE_INSET, CONVEYOR_HEIGHT, FULL_BOX, GANTRY_BASE, boundingBox, isFullCube, shapeOf,
  supportHeight,
} from '../shared/src/shapes.js';
import { PLAYER_WIDTH, Player, type InputState } from '../client/src/player.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- the shape data itself ----------------------------------------------

check('an ordinary block is a full cube', isFullCube(Block.Stone));
check('a full cube shape is the shared instance, so the collision loop does not allocate',
  shapeOf(Block.Stone) === shapeOf(Block.Dirt));
check('a full cube covers the whole cell',
  JSON.stringify(shapeOf(Block.Stone)[0]) === JSON.stringify(FULL_BOX));

check('a conveyor is not a full cube', !isFullCube(Block.Conveyor));
check('a conveyor is a low slab',
  shapeOf(Block.Conveyor)[0].y1 === CONVEYOR_HEIGHT && shapeOf(Block.Conveyor)[0].y0 === 0);
check('every conveyor direction has the same shape',
  [Block.ConveyorNorth, Block.ConveyorEast, Block.ConveyorSouth, Block.ConveyorWest]
    .every((b) => shapeOf(b)[0].y1 === CONVEYOR_HEIGHT));

check('a cable is inset on x and z', shapeOf(Block.Cable)[0].x0 === CABLE_INSET);
check('a cable runs the full height',
  shapeOf(Block.Cable)[0].y0 === 0 && shapeOf(Block.Cable)[0].y1 === 1);

check('a sorter is two boxes: belt plus housing', shapeOf(Block.Sorter).length === 2);
// The housing is a gantry over the belt, not a box sitting on it. Cargo rests
// exactly at belt height, so a housing starting exactly there decides whether
// an item is blocked on a margin of half a thousandth.
check('a sorter housing clears the belt so cargo can pass under it',
  shapeOf(Block.Sorter)[1].y0 === GANTRY_BASE &&
  GANTRY_BASE > CONVEYOR_HEIGHT);

// Every box has to be inside its cell and non-degenerate, or the mesher will
// emit faces outside the block and the collider will snap to nonsense.
for (const id of Object.values(Block)) {
  if (typeof id !== 'number') continue;
  for (const b of shapeOf(id)) {
    const inside = b.x0 >= 0 && b.y0 >= 0 && b.z0 >= 0 && b.x1 <= 1 && b.y1 <= 1 && b.z1 <= 1;
    const positive = b.x1 > b.x0 && b.y1 > b.y0 && b.z1 > b.z0;
    if (!inside || !positive) {
      check(`block ${id} has a valid box`, false, JSON.stringify(b));
    }
  }
}
check('every shape is inside its cell and has volume', true);

check('the bounding box of a sorter covers both of its boxes',
  boundingBox(Block.Sorter).y1 === shapeOf(Block.Sorter)[1].y1 &&
  boundingBox(Block.Sorter).x0 === 0);

check('a conveyor supports a body at belt height', supportHeight(Block.Conveyor) === CONVEYOR_HEIGHT);
check('a full block supports at its top', supportHeight(Block.Stone) === 1);

// --- what the player actually does --------------------------------------

function world(place: (x: number, y: number, z: number) => number) {
  return {
    getBlock(x: number, y: number, z: number): number {
      if (y < 0 || y >= WORLD_Y) return Block.Air;
      if (y <= 40) return Block.Stone;
      return place(x, y, z);
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

function run(p: Player, w: any, input: InputState, seconds: number, dt = 1 / 60): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) p.update(dt, w, input);
}

// Standing on a belt: the body should rest on the slab, not on the cell top.
{
  const w = world((x, y) => (y === 41 ? Block.Conveyor : Block.Air));
  const p = new Player();
  p.x = 0.5; p.y = 44; p.z = 0.5; p.yaw = 0;
  run(p, w, keys(), 2);
  check('a player lands on top of a conveyor belt, not on top of its cell',
    Math.abs(p.y - (41 + CONVEYOR_HEIGHT)) < 0.02,
    `y=${p.y.toFixed(3)} expected ${(41 + CONVEYOR_HEIGHT).toFixed(3)}`);
  check('and is standing, not falling', p.onGround);
}

// A belt is walk-over, not walk-into: crossing a line of them must not stop.
{
  const w = world((x, y) => (y === 41 && x >= 2 && x <= 6 ? Block.Conveyor : Block.Air));
  const p = new Player();
  p.x = 0.5; p.y = 42; p.z = 0.5; p.yaw = 0;   // yaw 0 faces +x
  run(p, w, keys({ forward: true }), 3);
  check('a player walks across a run of belts instead of being stopped by it',
    p.x > 7, `x=${p.x.toFixed(2)}`);
}

// A full block in the same place must stop them -- otherwise the test above
// proves nothing, since a player who cannot move at all also never stops.
{
  const w = world((x, y) => (y === 41 && x >= 2 && x <= 6 ? Block.Stone : Block.Air));
  const p = new Player();
  p.x = 0.5; p.y = 42; p.z = 0.5; p.yaw = 0;
  run(p, w, keys({ forward: true }), 3);
  check('the same run of full blocks does stop them (control)',
    p.x < 2, `x=${p.x.toFixed(2)}`);
}

// A cable is a thin run: you can stand in the cell beside it, hard against
// the cable, without being pushed out.
{
  const w = world((x, y, z) => (y === 41 && x === 3 && z === 0 ? Block.Cable : Block.Air));
  const p = new Player();
  // Sit at the cell edge next to the cable's inset face.
  p.x = 3 + CABLE_INSET - PLAYER_WIDTH / 2 - 0.01;
  p.y = 41; p.z = 0.5; p.yaw = 0;
  const before = p.x;
  run(p, w, keys(), 0.5);
  check('a player can stand flush against a cable without being shoved away',
    Math.abs(p.x - before) < 0.05, `x ${before.toFixed(3)} -> ${p.x.toFixed(3)}`);
}

// And the cable still blocks where it genuinely is.
{
  const w = world((x, y, z) => (y === 41 && x === 3 ? Block.Cable : Block.Air));
  const p = new Player();
  p.x = 0.5; p.y = 41; p.z = 0.5; p.yaw = 0;
  run(p, w, keys({ forward: true }), 3);
  // Stopped at the cable's own face, which sits CABLE_INSET into the cell --
  // not at the cell boundary, and definitely not on the far side of it.
  check('a cable still stops a player walking into it',
    p.x < 3 + CABLE_INSET && p.x > 2.9,
    `x=${p.x.toFixed(3)} expected just under ${(3 + CABLE_INSET).toFixed(3)}`);
}

// --- what the mesher actually emits --------------------------------------
//
// A hitbox that disagrees with the picture is the failure this whole change
// exists to avoid, so the geometry is checked against the same shapes the
// collider uses.

{
  const atlas = { uv: () => [0, 0, 1, 1] } as any;

  /**
   * Faces belonging to one block floating in cleared air.
   *
   * Whole quads only, and only those entirely inside the cell: filtering
   * loose vertices instead picks up the two corners a neighbouring block's
   * face happens to share with this cell's boundary, which silently inflated
   * every count here by half a dozen faces.
   */
  function facesOf(id: number, above = Block.Air) {
    const w = new ClientWorld(1, Dimension.Overworld);
    w.ensureChunk(0, 0);
    // Clear a pocket so nothing but the block under test emits anything.
    for (let x = 4; x < 13; x++) {
      for (let z = 4; z < 13; z++) {
        for (let y = 36; y < 47; y++) w.setBlock(x, y, z, Block.Air);
      }
    }
    w.setBlock(8, 41, 8, id);
    if (above !== Block.Air) w.setBlock(8, 42, 8, above);

    const mesh = meshSection(w, atlas, 0, 0, Math.floor(41 / SECTION_Y), 1);
    if (!mesh) return [] as number[][][];
    const quads: number[][][] = [];
    for (const part of [mesh.opaque, mesh.alpha]) {
      const v = part.vertices;
      for (let q = 0; q + 4 * FLOATS_PER_VERTEX <= v.length; q += 4 * FLOATS_PER_VERTEX) {
        const rows: number[][] = [];
        for (let c = 0; c < 4; c++) {
          const o = q + c * FLOATS_PER_VERTEX;
          rows.push(Array.from(v.subarray(o, o + FLOATS_PER_VERTEX)));
        }
        const inside = rows.every((r) =>
          r[0] >= 8 - 1e-6 && r[0] <= 9 + 1e-6 &&
          r[1] >= 41 - 1e-6 && r[1] <= 42 + 1e-6 &&
          r[2] >= 8 - 1e-6 && r[2] <= 9 + 1e-6);
        if (inside) quads.push(rows);
      }
    }
    return quads;
  }

  const flat = (qs: number[][][]) => qs.flat();

  const cube = facesOf(Block.Stone);
  check('a lone full cube emits six faces', cube.length === 6, `faces=${cube.length}`);
  check('a full cube spans the whole tile in u',
    Math.min(...flat(cube).map((r) => r[3])) === 0 &&
    Math.max(...flat(cube).map((r) => r[3])) === 1);
  check('a full cube reaches the top of its cell',
    Math.max(...flat(cube).map((r) => r[1])) === 42);

  const belt = facesOf(Block.Conveyor);
  check('a conveyor emits six faces too', belt.length === 6, `faces=${belt.length}`);
  check('a conveyor stops at belt height, not the cell top',
    Math.abs(Math.max(...flat(belt).map((r) => r[1])) - (41 + CONVEYOR_HEIGHT)) < 1e-6,
    `topY=${Math.max(...flat(belt).map((r) => r[1]))}`);
  check('a conveyor still spans its cell horizontally',
    Math.min(...flat(belt).map((r) => r[0])) === 8 &&
    Math.max(...flat(belt).map((r) => r[0])) === 9);

  // The texture has to track the box. A side face of a 3/16 slab should
  // sample 3/16 of the tile -- and the bottom 3/16, since v runs downward.
  // A side face is the one that spans the belt vertically; top and bottom
  // faces sit at a single y.
  const side = belt.find((q) =>
    q.some((r) => Math.abs(r[1] - 41) < 1e-6) &&
    q.some((r) => Math.abs(r[1] - (41 + CONVEYOR_HEIGHT)) < 1e-6));
  const vs = side ? side.map((r) => r[4]) : [];
  check('a slab samples a slab-sized strip of its side texture',
    vs.length > 0 && Math.abs((Math.max(...vs) - Math.min(...vs)) - CONVEYOR_HEIGHT) < 1e-6,
    vs.length ? `v spans ${(Math.max(...vs) - Math.min(...vs)).toFixed(4)}, want ${CONVEYOR_HEIGHT}` : 'no side face found');
  check('and takes it from the bottom of the tile, where the belt sits',
    vs.length > 0 && Math.abs(Math.max(...vs) - 1) < 1e-6);

  // A slab's top is in mid-cell, so nothing above it can hide it.
  const covered = facesOf(Block.Conveyor, Block.Stone);
  check('a slab keeps its top face even with a solid block directly above',
    covered.filter((q) => q.every((r) => Math.abs(r[1] - (41 + CONVEYOR_HEIGHT)) < 1e-6)).length === 1,
    `faces=${covered.length}`);

  // Whereas a full cube's top under a solid block is correctly hidden.
  const cubeCovered = facesOf(Block.Stone, Block.Stone);
  check('a full cube under a solid block still loses its top face (control)',
    cubeCovered.length === 5, `faces=${cubeCovered.length}`);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
