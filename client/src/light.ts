/**
 * Light propagation, block and sky.
 *
 * Both channels are the same flood fill over the voxel grid, so they share one
 * propagator and differ only in how a level attenuates across a step. Block
 * light loses one level per block in every direction. Sky light does too --
 * except straight down at full strength, which stays full strength. That one
 * exception is what makes sunlight fall down a shaft undimmed while still
 * fading as it creeps sideways under an overhang.
 *
 * Removing light runs in two phases: first darken everything the source lit,
 * collecting any brighter neighbour met along the way, then re-propagate from
 * those. One-phase removal leaves lit "shadows" behind.
 */

import { blockDef, isOpaque } from '@shared/blocks.js';
import { CHUNK_X, WORLD_Y } from '@shared/constants.js';
import type { ClientWorld } from './world.js';

export const MAX_LIGHT = 15;

interface Node {
  x: number;
  y: number;
  z: number;
  level: number;
}

/** Six-neighbour offsets. */
const NEIGHBOURS: Array<[number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** What one channel needs in order to be flood filled. */
interface Channel {
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, level: number): void;
  /** The level a neighbour receives when stepping by dy from `level`. */
  attenuate(level: number, dy: number): number;
}

class Propagator {
  private additions: Node[] = [];
  private removals: Node[] = [];

  constructor(private world: ClientWorld, private ch: Channel) {}

  /** Queues a source. Call `flush` to actually propagate. */
  add(x: number, y: number, z: number, level: number): void {
    if (level <= 0) return;
    if (this.ch.get(x, y, z) < level) this.ch.set(x, y, z, level);
    this.additions.push({ x, y, z, level });
  }

  /** Queues re-propagation from an already-set value, without changing it. */
  seed(x: number, y: number, z: number, level: number): void {
    if (level > 1) this.additions.push({ x, y, z, level });
  }

  /** Reads the current level at a position. */
  level(x: number, y: number, z: number): number {
    return this.ch.get(x, y, z);
  }

  /** Lets a newly opened space pull light back in from around it. */
  bleedIn(x: number, y: number, z: number): void {
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const ny = y + dy;
      if (ny < 0 || ny >= WORLD_Y) continue;
      this.seed(x + dx, ny, z + dz, this.ch.get(x + dx, ny, z + dz));
    }
  }

  /** Queues removal of whatever light is at a position. */
  remove(x: number, y: number, z: number): void {
    const level = this.ch.get(x, y, z);
    if (level <= 0) return;
    this.ch.set(x, y, z, 0);
    this.removals.push({ x, y, z, level });
  }

  flush(): void {
    this.propagateRemovals();
    this.propagateAdditions();
  }

  private propagateRemovals(): void {
    while (this.removals.length > 0) {
      const node = this.removals.pop()!;
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const x = node.x + dx;
        const y = node.y + dy;
        const z = node.z + dz;
        if (y < 0 || y >= WORLD_Y) continue;

        const level = this.ch.get(x, y, z);
        if (level === 0) continue;

        // Anything no brighter than what this node fed it was lit by this
        // node. Asking the channel rather than comparing to node.level is
        // what lets a sunlit column below be recognised as ours: it holds
        // the same 15 we do, yet it is still our light.
        if (level <= this.ch.attenuate(node.level, dy)) {
          this.ch.set(x, y, z, 0);
          this.removals.push({ x, y, z, level });
        } else {
          this.additions.push({ x, y, z, level });
        }
      }
    }
  }

  private propagateAdditions(): void {
    // Bounded so a pathological case cannot lock the frame.
    let budget = 400000;
    while (this.additions.length > 0 && budget-- > 0) {
      const node = this.additions.pop()!;
      const level = this.ch.get(node.x, node.y, node.z);
      if (level <= 1) continue;

      for (const [dx, dy, dz] of NEIGHBOURS) {
        const x = node.x + dx;
        const y = node.y + dy;
        const z = node.z + dz;
        if (y < 0 || y >= WORLD_Y) continue;
        if (isOpaque(this.world.getBlock(x, y, z))) continue;

        const next = this.ch.attenuate(level, dy);
        if (next > 0 && this.ch.get(x, y, z) < next) {
          this.ch.set(x, y, z, next);
          this.additions.push({ x, y, z, level: next });
        }
      }
    }
  }
}

export class LightEngine {
  private block: Propagator;
  private sky: Propagator;

  constructor(private world: ClientWorld) {
    this.block = new Propagator(world, {
      get: (x, y, z) => world.getBlockLight(x, y, z),
      set: (x, y, z, l) => world.setBlockLight(x, y, z, l),
      attenuate: (level) => level - 1,
    });
    this.sky = new Propagator(world, {
      get: (x, y, z) => world.getSkyLight(x, y, z),
      set: (x, y, z, l) => world.setSkyLight(x, y, z, l),
      // Sunlight falls forever; everything else costs a level.
      attenuate: (level, dy) => (dy === -1 && level === MAX_LIGHT ? MAX_LIGHT : level - 1),
    });
  }

  /** Queues a block-light source. Kept for callers that place emitters. */
  add(x: number, y: number, z: number, level: number): void {
    this.block.add(x, y, z, level);
  }

  /**
   * Re-lights around a block that changed, in both channels.
   * Handles "a torch was placed" and "something now blocks the sun" alike.
   */
  blockChanged(x: number, y: number, z: number, block: number): void {
    const opaque = isOpaque(block);

    // Block light: whatever was here stops contributing.
    this.block.remove(x, y, z);
    const emission = blockDef(block).light;
    if (emission > 0) this.block.add(x, y, z, emission);
    else if (!opaque) this.block.bleedIn(x, y, z);

    // Sky light: an opaque block casts a shadow all the way down its column;
    // clearing one lets the sun and its neighbours flow back in.
    this.sky.remove(x, y, z);
    if (!opaque) {
      // Nothing is above the top of the world, so a column open at the very
      // top is lit by the sky itself, with no neighbour to borrow from.
      if (y === WORLD_Y - 1) this.sky.add(x, y, z, MAX_LIGHT);
      this.sky.bleedIn(x, y, z);
    }

    this.flush();
  }

  /** Seeds both channels for a freshly generated chunk. */
  seedChunk(cx: number, cz: number): void {
    const chunk = this.world.chunk(cx, cz);
    if (!chunk) return;

    this.seedSky(cx, cz);

    const ox = cx * 16;
    const oz = cz * 16;
    for (let y = 0; y < WORLD_Y; y++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const id = chunk.data[(y << 8) | (lz << 4) | lx];
          const emission = blockDef(id).light;
          if (emission > 0) this.block.add(ox + lx, y, oz + lz, emission);
        }
      }
    }

    // Neighbours may hold light that should spill into this chunk, and this
    // chunk's own light should now spill out into them.
    this.exchangeSeams(cx, cz, [this.block, this.sky]);
    this.flush();
  }

  /**
   * Trades light with the four neighbouring chunks.
   *
   * Only where the two sides of a seam actually disagree is there anything to
   * propagate; seeding every lit voxel along the seam would queue thousands
   * of nodes that each discover they have nothing to give.
   */
  private exchangeSeams(cx: number, cz: number, channels: Propagator[]): void {
    const ox = cx * 16;
    const oz = cz * 16;
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      // Nothing to exchange with a chunk that is not loaded; when it does
      // load, its own seeding runs this same pass from the other side.
      if (!this.world.chunk(cx + dx, cz + dz)) continue;

      // The column just outside this chunk on this side, and just inside it.
      const outer = dx === -1 || dz === -1 ? -1 : 16;
      const inner = dx === -1 || dz === -1 ? 0 : 15;
      for (let y = 0; y < WORLD_Y; y++) {
        for (let i = 0; i < 16; i++) {
          const ax = dx === 0 ? ox + i : ox + outer;
          const az = dz === 0 ? oz + i : oz + outer;
          const bx = dx === 0 ? ox + i : ox + inner;
          const bz = dz === 0 ? oz + i : oz + inner;
          for (const p of channels) this.spill(p, ax, y, az, bx, bz);
        }
      }
    }
  }

  /** Queues whichever side of a seam is bright enough to light the other. */
  private spill(
    p: Propagator, ax: number, y: number, az: number, bx: number, bz: number,
  ): void {
    const a = p.level(ax, y, az);
    const b = p.level(bx, y, bz);
    if (a > b + 1) p.seed(ax, y, az, a);
    else if (b > a + 1) p.seed(bx, y, bz, b);
  }

  /**
   * Fills sunlight down every column, then queues only the voxels that can
   * actually spread it: the ones beside a taller column, or at the bottom of
   * their own lit run. Seeding all 32k lit voxels would be correct too, and
   * about ten times the work for the same result.
   */
  private seedSky(cx: number, cz: number): void {
    const chunk = this.world.chunk(cx, cz)!;
    const ox = cx * 16;
    const oz = cz * 16;

    // Pass one: straight down from the sky until something opaque stops it.
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        for (let y = WORLD_Y - 1; y >= 0; y--) {
          if (isOpaque(chunk.data[(y << 8) | (lz << 4) | lx])) break;
          chunk.skylight[(y << 8) | (lz << 4) | lx] = MAX_LIGHT;
        }
      }
    }

    // Pass two: queue the voxels with somewhere darker to go.
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const top = chunk.heightmap[lz * CHUNK_X + lx];
        // How high the surrounding terrain reaches. Anything at or below that
        // has a neighbour that may be in shadow. Outside the chunk we do not
        // know, so we assume the worst and let the flood fill sort it out.
        let wall = 0;
        for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nx = lx + dx;
          const nz = lz + dz;
          wall = Math.max(wall, nx < 0 || nx > 15 || nz < 0 || nz > 15
            // Outside the chunk, ask the world. An unloaded neighbour returns
            // -1 and contributes nothing: the seam exchange in seedChunk
            // handles that pairing once the neighbour actually exists.
            ? this.world.heightAt(ox + nx, oz + nz)
            : chunk.heightmap[nz * CHUNK_X + nx]);
        }
        for (let y = WORLD_Y - 1; y >= 0; y--) {
          if (isOpaque(chunk.data[(y << 8) | (lz << 4) | lx])) break;
          if (y <= wall || y === top + 1) this.sky.seed(ox + lx, y, oz + lz, MAX_LIGHT);
        }
      }
    }
  }

  /** Clears and refills sky light for a chunk whose contents changed wholesale. */
  resetSky(cx: number, cz: number): void {
    const chunk = this.world.chunk(cx, cz);
    if (!chunk) return;
    chunk.skylight.fill(0);
    this.seedSky(cx, cz);
    // Clearing the chunk also threw away any light its neighbours had lent
    // it, so ask for it back before propagating.
    this.exchangeSeams(cx, cz, [this.sky]);
    this.sky.flush();
  }

  flush(): void {
    this.block.flush();
    this.sky.flush();
  }
}
