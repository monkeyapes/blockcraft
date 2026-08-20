/**
 * Portal construction and detection.
 *
 * Kept free of any world class so the client, the single-player link and the
 * server can all run the identical logic over their own block accessors.
 */

import { Block } from './blocks.js';
import { Dimension, NETHER_SCALE, WORLD_Y } from './constants.js';
import { Item } from './items.js';

export type BlockReader = (x: number, y: number, z: number) => number;
export type BlockWriter = (x: number, y: number, z: number, block: number) => void;

/** Nether portals may be built in either vertical plane. */
export type PortalAxis = 'x' | 'z';

export const MIN_PORTAL_WIDTH = 2;
export const MAX_PORTAL_WIDTH = 8;
export const MIN_PORTAL_HEIGHT = 3;
export const MAX_PORTAL_HEIGHT = 12;

export interface PortalFrame {
  axis: PortalAxis;
  /** Interior air cells that become portal blocks. */
  cells: Array<[number, number, number]>;
}

/**
 * Flood-fills the air pocket containing (x, y, z) within one vertical plane
 * and confirms obsidian on every side.
 *
 * Returns the interior cells, or null if the pocket leaks, is the wrong size,
 * or is not fully framed.
 */
function traceFrame(
  read: BlockReader, x: number, y: number, z: number, axis: PortalAxis,
): PortalFrame | null {
  const start = read(x, y, z);
  if (start !== Block.Air) return null;

  const seen = new Set<string>();
  const cells: Array<[number, number, number]> = [];
  const queue: Array<[number, number, number]> = [[x, y, z]];

  let minU = Infinity;
  let maxU = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Neighbours within the plane: along the axis, and vertically.
  const step: Array<[number, number, number]> = axis === 'x'
    ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]
    : [[0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];

  while (queue.length > 0) {
    const [cx, cy, cz] = queue.pop()!;
    const key = `${cx},${cy},${cz}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (cy < 1 || cy >= WORLD_Y) return null;
    // A pocket bigger than the largest legal portal is not a frame at all.
    if (cells.length > MAX_PORTAL_WIDTH * MAX_PORTAL_HEIGHT) return null;

    cells.push([cx, cy, cz]);
    const u = axis === 'x' ? cx : cz;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minY = Math.min(minY, cy);
    maxY = Math.max(maxY, cy);

    for (const [dx, dy, dz] of step) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      const block = read(nx, ny, nz);
      if (block === Block.Air) {
        queue.push([nx, ny, nz]);
      } else if (block !== Block.Obsidian) {
        return null; // the frame is not sealed
      }
    }
  }

  const width = maxU - minU + 1;
  const height = maxY - minY + 1;
  if (width < MIN_PORTAL_WIDTH || width > MAX_PORTAL_WIDTH) return null;
  if (height < MIN_PORTAL_HEIGHT || height > MAX_PORTAL_HEIGHT) return null;
  // The pocket must be a filled rectangle, not an L or a ring.
  if (cells.length !== width * height) return null;

  return { axis, cells };
}

/** Looks for a valid unlit portal frame around this air block, either axis. */
export function findPortalFrame(
  read: BlockReader, x: number, y: number, z: number,
): PortalFrame | null {
  return traceFrame(read, x, y, z, 'x') ?? traceFrame(read, x, y, z, 'z');
}

/** Lights a frame. Returns false when there is no valid frame here. */
export function lightPortal(
  read: BlockReader, write: BlockWriter, x: number, y: number, z: number,
): boolean {
  const frame = findPortalFrame(read, x, y, z);
  if (!frame) return false;
  for (const [cx, cy, cz] of frame.cells) write(cx, cy, cz, Block.NetherPortal);
  return true;
}

// ------------------------------------------------------------------ the End

/** The eight frame positions surrounding an End portal's centre. */
export function endFrameRing(x: number, y: number, z: number): Array<[number, number, number]> {
  const ring: Array<[number, number, number]> = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      ring.push([x + dx, y, z + dz]);
    }
  }
  return ring;
}

/**
 * Is there a complete ring of filled End portal frames around this centre?
 * The centre itself must be air or an existing portal.
 */
export function endPortalComplete(
  read: BlockReader, x: number, y: number, z: number,
): boolean {
  const middle = read(x, y, z);
  if (middle !== Block.Air && middle !== Block.EndPortal) return false;
  return endFrameRing(x, y, z).every(
    ([fx, fy, fz]) => read(fx, fy, fz) === Block.EndPortalFrameFilled,
  );
}

/**
 * After a frame block is filled, checks every centre it could belong to and
 * activates the first complete ring.
 */
export function tryActivateEndPortal(
  read: BlockReader, write: BlockWriter, x: number, y: number, z: number,
): [number, number, number] | null {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const cx = x + dx;
      const cz = z + dz;
      if (!endPortalComplete(read, cx, y, cz)) continue;
      write(cx, y, cz, Block.EndPortal);
      return [cx, y, cz];
    }
  }
  return null;
}

// ------------------------------------------------------------- destinations

/** Where a portal in `from` lands you in `to`. The Nether is 1:8. */
export function linkedPosition(
  from: Dimension, to: Dimension, x: number, y: number, z: number,
): { x: number; y: number; z: number } {
  if (from === Dimension.Overworld && to === Dimension.Nether) {
    return { x: Math.floor(x / NETHER_SCALE), y, z: Math.floor(z / NETHER_SCALE) };
  }
  if (from === Dimension.Nether && to === Dimension.Overworld) {
    return { x: Math.floor(x * NETHER_SCALE), y, z: Math.floor(z * NETHER_SCALE) };
  }
  return { x, y, z };
}

/** Which dimension a portal block leads to. */
export function portalDestination(current: Dimension, portal: number): Dimension | null {
  if (portal === Block.NetherPortal) {
    return current === Dimension.Nether ? Dimension.Overworld : Dimension.Nether;
  }
  if (portal === Block.EndPortal) {
    return current === Dimension.End ? Dimension.Overworld : Dimension.End;
  }
  return null;
}

/**
 * Carves out a safe arrival spot and builds a return portal there.
 *
 * Without this, arriving in the Nether frequently means arriving inside solid
 * netherrack or on top of a lava sea.
 */
export function buildArrivalPortal(
  read: BlockReader, write: BlockWriter, dim: Dimension,
  x: number, y: number, z: number,
): { x: number; y: number; z: number } {
  const groundY = findFooting(read, x, y, z);
  const platform = dim === Dimension.End ? Block.EndStone : Block.Obsidian;

  // A 5x5 platform with a hollow above it.
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      write(x + dx, groundY - 1, z + dz, platform);
      for (let dy = 0; dy < 5; dy++) write(x + dx, groundY + dy, z + dz, Block.Air);
    }
  }

  // A 2x3 portal standing on the platform, framed in obsidian.
  for (let dy = -1; dy <= 3; dy++) {
    for (let du = -1; du <= 2; du++) {
      const edge = dy === -1 || dy === 3 || du === -1 || du === 2;
      if (edge) write(x + du, groundY + dy, z, Block.Obsidian);
    }
  }
  for (let dy = 0; dy <= 2; dy++) {
    for (let du = 0; du <= 1; du++) write(x + du, groundY + dy, z, Block.NetherPortal);
  }

  return { x: x + 0.5, y: groundY, z: z + 0.5 };
}

/**
 * Right-click behaviour for items that act on the world.
 * Returns true when the item did something (and should be consumed).
 */
export function useItemOnWorld(
  read: BlockReader, write: BlockWriter, item: number, x: number, y: number, z: number,
): boolean {
  if (item === Item.FlintAndSteel) {
    // Players click the frame, so try the space above it, then the cell itself.
    for (const [cx, cy, cz] of [[x, y + 1, z], [x, y, z]] as const) {
      if (read(cx, cy, cz) !== Block.Air) continue;
      if (lightPortal(read, write, cx, cy, cz)) return true;
    }
    return false;
  }

  if (item === Item.EyeOfEnder) {
    if (read(x, y, z) !== Block.EndPortalFrame) return false;
    write(x, y, z, Block.EndPortalFrameFilled);
    tryActivateEndPortal(read, write, x, y, z);
    return true;
  }

  return false;
}

/** An already-built portal near the target, so a round trip reuses it. */
function findExistingPortal(
  read: BlockReader, x: number, y: number, z: number,
): [number, number, number] | null {
  const RADIUS = 8;
  const V_RADIUS = 16;
  let best: [number, number, number] | null = null;
  let bestDist = Infinity;

  for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      for (let dy = -V_RADIUS; dy <= V_RADIUS; dy++) {
        const cy = y + dy;
        if (cy < 2 || cy >= WORLD_Y) continue;
        if (read(x + dx, cy, z + dz) !== Block.NetherPortal) continue;
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist < bestDist) {
          bestDist = dist;
          best = [x + dx, cy, z + dz];
        }
      }
    }
  }
  return best;
}

export interface TravelResult {
  dim: Dimension;
  x: number;
  y: number;
  z: number;
}

/**
 * Works out where a player standing in a portal should come out, building a
 * landing site if there is nothing there yet.
 */
export function travelThroughPortal(
  readIn: BlockReader, readOut: BlockReader, writeOut: BlockWriter,
  from: Dimension, x: number, y: number, z: number,
): TravelResult | null {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);

  const portal = readIn(bx, by, bz);
  const to = portalDestination(from, portal);
  if (to === null) return null;

  const target = linkedPosition(from, to, bx, by, bz);
  const clampedY = Math.max(6, Math.min(target.y, WORLD_Y - 12));

  // The End gets a fixed arrival island rather than a linked position.
  if (to === Dimension.End) {
    const spot = buildArrivalPortal(readOut, writeOut, to, 0, 70, 0);
    return { dim: to, x: spot.x, y: spot.y, z: spot.z };
  }

  const existing = findExistingPortal(readOut, target.x, clampedY, target.z);
  if (existing) {
    return { dim: to, x: existing[0] + 0.5, y: existing[1], z: existing[2] + 0.5 };
  }

  const spot = buildArrivalPortal(readOut, writeOut, to, target.x, clampedY, target.z);
  return { dim: to, x: spot.x, y: spot.y, z: spot.z };
}

/** First solid-topped spot at or below `y`, clamped into the world. */
function findFooting(read: BlockReader, x: number, y: number, z: number): number {
  const start = Math.max(6, Math.min(y, WORLD_Y - 12));
  for (let cy = start; cy > 3; cy--) {
    if (read(x, cy - 1, z) !== Block.Air && read(x, cy, z) === Block.Air) return cy;
  }
  return start;
}
