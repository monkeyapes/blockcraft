/** Portal construction, activation and travel. Run: npx tsx tests/portals.ts */

import { Block } from '../shared/src/blocks.js';
import { Dimension, NETHER_SCALE, WORLD_Y } from '../shared/src/constants.js';
import { Item } from '../shared/src/items.js';
import {
  endPortalComplete, findPortalFrame, lightPortal, linkedPosition,
  portalDestination, travelThroughPortal, useItemOnWorld,
} from '../shared/src/portal.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

/** A sparse editable world over an infinite stone floor at y<=40. */
function makeWorld(floor = 40) {
  const edits = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  return {
    edits,
    read(x: number, y: number, z: number): number {
      if (y < 0 || y >= WORLD_Y) return Block.Air;
      const v = edits.get(key(x, y, z));
      if (v !== undefined) return v;
      return y <= floor ? Block.Stone : Block.Air;
    },
    write(x: number, y: number, z: number, b: number): void {
      edits.set(key(x, y, z), b);
    },
  };
}

/** Builds an obsidian frame with a `w` x `h` interior starting at (x, y, z). */
function buildFrame(
  world: ReturnType<typeof makeWorld>, x: number, y: number, z: number,
  w: number, h: number, axis: 'x' | 'z' = 'x',
): void {
  for (let dy = -1; dy <= h; dy++) {
    for (let du = -1; du <= w; du++) {
      const edge = dy === -1 || dy === h || du === -1 || du === w;
      const cx = axis === 'x' ? x + du : x;
      const cz = axis === 'x' ? z : z + du;
      world.write(cx, y + dy, cz, edge ? Block.Obsidian : Block.Air);
    }
  }
}

// --- frame detection --------------------------------------------------------
{
  const w = makeWorld();
  buildFrame(w, 10, 41, 10, 2, 3);
  const frame = findPortalFrame(w.read, 10, 41, 10);
  check('a 2x3 frame is recognised', frame?.cells.length === 6, `${frame?.cells.length} cells`);
  check('frame axis is detected', frame?.axis === 'x');
}

{
  const w = makeWorld();
  buildFrame(w, 10, 41, 10, 3, 4, 'z');
  const frame = findPortalFrame(w.read, 10, 41, 10);
  check('a frame on the z axis is recognised',
    frame?.axis === 'z' && frame.cells.length === 12, `${frame?.cells.length} cells`);
}

{
  const w = makeWorld();
  buildFrame(w, 10, 41, 10, 2, 3);
  // The interior spans y 41..43, so the top edge is y=44. Punching it lets
  // the flood fill escape into open sky.
  w.write(10, 44, 10, Block.Air);
  check('a leaking frame is rejected', findPortalFrame(w.read, 10, 41, 10) === null);
}

{
  const w = makeWorld();
  buildFrame(w, 10, 41, 10, 1, 3); // too narrow
  check('an undersized frame is rejected', findPortalFrame(w.read, 10, 41, 10) === null);
}

{
  const w = makeWorld();
  buildFrame(w, 10, 41, 10, 2, 3);
  w.write(11, 41, 10, Block.Stone); // wrong material inside
  check('a frame filled with the wrong block is rejected',
    findPortalFrame(w.read, 10, 41, 10) === null);
}

// --- lighting ---------------------------------------------------------------
{
  const w = makeWorld();
  buildFrame(w, 10, 41, 10, 2, 3);
  check('lighting fills the frame', lightPortal(w.read, w.write, 10, 41, 10));
  check('interior became portal blocks',
    w.read(10, 41, 10) === Block.NetherPortal && w.read(11, 43, 10) === Block.NetherPortal);
  check('the frame itself is untouched', w.read(9, 41, 10) === Block.Obsidian);
}

{
  const w = makeWorld();
  buildFrame(w, 10, 41, 10, 2, 3);
  // Flint clicked on the obsidian floor of the frame lights the space above.
  const used = useItemOnWorld(w.read, w.write, Item.FlintAndSteel, 10, 40, 10);
  check('flint and steel lights a portal from the frame base', used);
  check('portal blocks appeared', w.read(10, 41, 10) === Block.NetherPortal);
}

{
  const w = makeWorld();
  check('flint does nothing without a frame',
    !useItemOnWorld(w.read, w.write, Item.FlintAndSteel, 10, 40, 10));
}

// --- End portal -------------------------------------------------------------
{
  const w = makeWorld();
  const ring: Array<[number, number]> = [
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
  ];
  for (const [dx, dz] of ring) w.write(20 + dx, 41, 20 + dz, Block.EndPortalFrame);
  w.write(20, 41, 20, Block.Air);

  check('an empty ring is not complete', !endPortalComplete(w.read, 20, 41, 20));

  // Insert eyes one at a time; only the last should activate it.
  let activatedEarly = false;
  for (let i = 0; i < ring.length; i++) {
    const [dx, dz] = ring[i];
    useItemOnWorld(w.read, w.write, Item.EyeOfEnder, 20 + dx, 41, 20 + dz);
    const active = w.read(20, 41, 20) === Block.EndPortal;
    if (active && i < ring.length - 1) activatedEarly = true;
  }
  check('the portal does not activate early', !activatedEarly);
  check('a full ring of eyes opens the portal', w.read(20, 41, 20) === Block.EndPortal);
  check('frames show as filled', w.read(19, 41, 19) === Block.EndPortalFrameFilled);
}

// --- destinations -----------------------------------------------------------
check('overworld to nether divides by 8',
  linkedPosition(Dimension.Overworld, Dimension.Nether, 800, 64, -160).x === 100 &&
  linkedPosition(Dimension.Overworld, Dimension.Nether, 800, 64, -160).z === -20);
check('nether to overworld multiplies by 8',
  linkedPosition(Dimension.Nether, Dimension.Overworld, 100, 64, -20).x === 800);
check('the scale constant is 8', NETHER_SCALE === 8);

check('a nether portal in the overworld leads to the nether',
  portalDestination(Dimension.Overworld, Block.NetherPortal) === Dimension.Nether);
check('a nether portal in the nether leads home',
  portalDestination(Dimension.Nether, Block.NetherPortal) === Dimension.Overworld);
check('an end portal leads to the end',
  portalDestination(Dimension.Overworld, Block.EndPortal) === Dimension.End);
check('a plain block is not a portal',
  portalDestination(Dimension.Overworld, Block.Stone) === null);

// --- travel -----------------------------------------------------------------
{
  const overworld = makeWorld();
  const nether = makeWorld(30);
  buildFrame(overworld, 800, 41, 100, 2, 3);
  lightPortal(overworld.read, overworld.write, 800, 41, 100);

  const result = travelThroughPortal(
    overworld.read, nether.read, nether.write,
    Dimension.Overworld, 800, 41, 100);

  check('travelling from a portal returns a destination', result !== null);
  check('destination is the nether', result?.dim === Dimension.Nether);
  check('arrival is near the scaled coordinates',
    !!result && Math.abs(result.x - 100) < 4 && Math.abs(result.z - 12.5) < 4,
    `${result?.x.toFixed(1)}, ${result?.z.toFixed(1)}`);
  check('a return portal was built on arrival',
    nether.read(Math.floor(result!.x), Math.floor(result!.y), Math.floor(result!.z)) ===
      Block.NetherPortal);
  check('the arrival platform is solid underfoot',
    nether.read(Math.floor(result!.x), Math.floor(result!.y) - 1, Math.floor(result!.z)) !==
      Block.Air);
}

{
  // Going back should reuse the portal that is already there.
  const nether = makeWorld(30);
  const overworld = makeWorld();
  buildFrame(nether, 100, 41, 12, 2, 3);
  lightPortal(nether.read, nether.write, 100, 41, 12);
  buildFrame(overworld, 800, 41, 96, 2, 3);
  lightPortal(overworld.read, overworld.write, 800, 41, 96);

  const back = travelThroughPortal(
    nether.read, overworld.read, overworld.write,
    Dimension.Nether, 100, 41, 12);
  check('returning reuses a nearby existing portal',
    !!back && Math.abs(back.x - 800.5) < 2 && Math.abs(back.z - 96.5) < 2,
    `${back?.x.toFixed(1)}, ${back?.z.toFixed(1)}`);
}

{
  const world = makeWorld();
  check('standing on a plain block is not travel',
    travelThroughPortal(world.read, world.read, world.write,
      Dimension.Overworld, 5, 41, 5) === null);
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} failed`}`);
process.exit(failures ? 1 : 0);
