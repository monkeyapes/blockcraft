/**
 * Section mesher.
 *
 * Turns a 16x16x16 slice of a chunk into interleaved vertex data. Only faces
 * that touch a see-through block are emitted, with per-vertex ambient
 * occlusion and smooth per-vertex light baked in.
 *
 * Light is sampled per vertex rather than per face: each corner averages the
 * four voxels that meet there, so a torch or a shaft of sunlight grades across
 * a wall instead of switching block by block.
 *
 * Vertex layout (7 floats, 28 bytes): px py pz u v light ao
 */

import { Block, blockDef, isOpaque } from '@shared/blocks.js';
import { CHUNK_X, CHUNK_Z, SECTION_Y, WORLD_Y, voxelIndex } from '@shared/constants.js';
import type { Atlas } from './gfx/atlas.js';
import { MAX_LIGHT } from './light.js';
import { fluidHeight, isFluidSource, sameFluid } from '@shared/fluids.js';
import { crossOf, isDynamicShape, shapeOf, type Around, type Box } from '@shared/shapes.js';
import type { ClientWorld } from './world.js';

export const FLOATS_PER_VERTEX = 7;

/** normal, 4 corner offsets (CCW seen from outside), shade. */
interface Face {
  n: [number, number, number];
  corners: Array<[number, number, number]>;
  shade: number;
  /** Two in-plane axes used for ambient occlusion sampling. */
  ax: [number, number, number];
  az: [number, number, number];
  /**
   * Which local axis drives each texture coordinate, and whether it runs
   * backwards. For a full cube the corner offsets are 0 or 1 and this
   * reproduces the fixed UV tables exactly; for a partial box the texture has
   * to follow the box's real extent instead, so a slab shows a slab's worth
   * of its side texture rather than the whole tile squashed.
   * Axes: 0 = x, 1 = y, 2 = z.
   */
  uAxis: 0 | 1 | 2; uFlip: boolean;
  vAxis: 0 | 1 | 2; vFlip: boolean;
}

const FACES: Face[] = [
  { n: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], shade: 1.0, ax: [1, 0, 0], az: [0, 0, 1] , uAxis: 0, uFlip: false, vAxis: 2, vFlip: false },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, ax: [1, 0, 0], az: [0, 0, 1] , uAxis: 0, uFlip: false, vAxis: 2, vFlip: true },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8, ax: [1, 0, 0], az: [0, 1, 0] , uAxis: 0, uFlip: false, vAxis: 1, vFlip: true },
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8, ax: [-1, 0, 0], az: [0, 1, 0] , uAxis: 0, uFlip: true, vAxis: 1, vFlip: true },
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.65, ax: [0, 0, -1], az: [0, 1, 0] , uAxis: 2, uFlip: true, vAxis: 1, vFlip: true },
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.65, ax: [0, 0, 1], az: [0, 1, 0] , uAxis: 2, uFlip: false, vAxis: 1, vFlip: true },
];

/*
 * The fixed UV tables these faces used to carry are gone. They only worked
 * because every corner offset was 0 or 1; a partial box needs the texture to
 * track the box's real edges, so each face now records which axis drives u
 * and v instead. For a full cube the two are equivalent.
 */

export interface SectionMesh {
  opaque: { vertices: Float32Array; indices: Uint32Array };
  alpha: { vertices: Float32Array; indices: Uint32Array };
}

const PAD = SECTION_Y + 2; // 18
const PAD2 = PAD * PAD;
const padded = new Uint8Array(PAD * PAD * PAD);
const paddedSky = new Uint8Array(PAD * PAD * PAD);
const paddedBlock = new Uint8Array(PAD * PAD * PAD);

function padIndex(x: number, y: number, z: number): number {
  return (y + 1) * PAD2 + (z + 1) * PAD + (x + 1);
}

/**
 * Copies the section plus a one-block skirt into a flat scratch buffer, so the
 * hot loop below is pure typed-array indexing.
 */
function fillPadded(world: ClientWorld, cx: number, cz: number, section: number): void {
  const chunk = world.chunk(cx, cz)!;
  const baseY = section * SECTION_Y;
  padded.fill(0);
  paddedSky.fill(0);
  paddedBlock.fill(0);

  // Interior: x is contiguous in the chunk layout, so copy whole rows.
  for (let y = 0; y < SECTION_Y; y++) {
    const wy = baseY + y;
    for (let z = 0; z < CHUNK_Z; z++) {
      const src = voxelIndex(0, wy, z);
      const dst = padIndex(0, y, z);
      padded.set(chunk.data.subarray(src, src + CHUNK_X), dst);
      paddedSky.set(chunk.skylight.subarray(src, src + CHUNK_X), dst);
      paddedBlock.set(chunk.light.subarray(src, src + CHUNK_X), dst);
    }
  }

  // Skirt: six faces, pulled through the world so chunk seams are correct.
  const ox = cx * CHUNK_X;
  const oz = cz * CHUNK_Z;
  for (let y = -1; y <= SECTION_Y; y++) {
    const wy = baseY + y;
    for (let z = -1; z <= CHUNK_Z; z++) {
      for (let x = -1; x <= CHUNK_X; x++) {
        const inside =
          x >= 0 && x < CHUNK_X && z >= 0 && z < CHUNK_Z && y >= 0 && y < SECTION_Y;
        if (inside) continue;
        const i = padIndex(x, y, z);
        if (wy < 0) {
          padded[i] = Block.Air;
        } else if (wy >= WORLD_Y) {
          // Open sky above the world, so the top of a tower is lit.
          padded[i] = Block.Air;
          paddedSky[i] = MAX_LIGHT;
        } else {
          padded[i] = world.getBlock(ox + x, wy, oz + z);
          paddedSky[i] = world.getSkyLight(ox + x, wy, oz + z);
          paddedBlock[i] = world.getBlockLight(ox + x, wy, oz + z);
        }
      }
    }
  }
}

/** Classic voxel AO: darker where two sides and the corner are filled. */
function vertexAO(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 0.52;
  const n = (side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0);
  return [1.0, 0.84, 0.68, 0.52][n];
}

/** Never fully black, so an unlit cave is gloomy rather than invisible. */
const AMBIENT_FLOOR = 0.06;

/**
 * Brightness for a light level, as a lookup keyed by level*16.
 *
 * Each level down keeps a fixed fraction of the one above rather than a fixed
 * amount. Linear falloff makes a torch look like a flat disc; geometric
 * falloff gives the bright core and long dim tail that reads as a light.
 *
 * This describes distance from a source only. Time of day is a separate
 * dimmer applied to the result -- running the sun through this curve as well
 * would compound the two and leave dusk nearly as dark as midnight.
 */
const LIGHT_STEP = 0.82;
const LIGHT_CURVE = new Float32Array(MAX_LIGHT * 16 + 1);
for (let i = 0; i < LIGHT_CURVE.length; i++) {
  LIGHT_CURVE[i] = Math.pow(LIGHT_STEP, MAX_LIGHT - i / 16);
}

/** Brightness for a fractional light level, 0 to MAX_LIGHT. */
function falloff(level: number): number {
  const i = Math.round(level * 16);
  return LIGHT_CURVE[i < 0 ? 0 : i >= LIGHT_CURVE.length ? LIGHT_CURVE.length - 1 : i];
}

/** What cornerShade worked out, reused rather than allocated per vertex. */
const shade = { light: 0, ao: 1 };

/**
 * Light and ambient occlusion at one corner of a face, into `shade`.
 *
 * `nx, ny, nz` is the padded cell the face looks onto; `dx, dy, dz` the
 * corner's 0/1 offsets within its own cell, which say which way the corner
 * leans. Shared by boxes and liquid surfaces, so water sits in the same
 * light as the shore beside it.
 */
function cornerShade(
  face: Face, nx: number, ny: number, nz: number,
  dx: number, dy: number, dz: number, emitter: boolean, skyBrightness: number,
): void {
  const nIdx = padIndex(nx, ny, nz);

  // AO samples sit in the plane just outside this face. Which way each
  // corner leans comes from the corner offset itself, not the UVs, since the
  // top face winds differently from the sides.
  const ex = dx * 2 - 1;
  const ey = dy * 2 - 1;
  const ez = dz * 2 - 1;
  const su = ex * face.ax[0] + ey * face.ax[1] + ez * face.ax[2];
  const sv = ex * face.az[0] + ey * face.az[1] + ez * face.az[2];
  const i1 = padIndex(
    nx + face.ax[0] * su, ny + face.ax[1] * su, nz + face.ax[2] * su);
  const i2 = padIndex(
    nx + face.az[0] * sv, ny + face.az[1] * sv, nz + face.az[2] * sv);
  const ic = padIndex(
    nx + face.ax[0] * su + face.az[0] * sv,
    ny + face.ax[1] * su + face.az[1] * sv,
    nz + face.ax[2] * su + face.az[2] * sv);
  const o1 = isOpaque(padded[i1]);
  const o2 = isOpaque(padded[i2]);
  const oc = isOpaque(padded[ic]);
  const ao = vertexAO(o1, o2, oc);

  // Average the light of the four voxels meeting at this corner. Opaque ones
  // hold no light and would only drag the corner dark, so they sit out; AO
  // above is what darkens a tucked-in corner. A corner wedged between two
  // solids sees nothing but the face voxel itself, which is the one
  // guaranteed to be open. The two channels are averaged apart and combined
  // after, so the sun's dimmer never scales a torch and vice versa.
  let sky = paddedSky[nIdx];
  let blk = paddedBlock[nIdx];
  let count = 1;
  if (!o1) { sky += paddedSky[i1]; blk += paddedBlock[i1]; count++; }
  if (!o2) { sky += paddedSky[i2]; blk += paddedBlock[i2]; count++; }
  if (!oc && !(o1 && o2)) { sky += paddedSky[ic]; blk += paddedBlock[ic]; count++; }

  shade.light = emitter ? 1 : Math.max(
    AMBIENT_FLOOR,
    falloff(sky / count) * skyBrightness,
    falloff(blk / count),
  );
  shade.ao = ao;
}

/** The tile a box shows on face f (0 top, 1 bottom, else side). */
function faceTexture(box: Box, own: [string, string, string], f: number): string {
  const tex = box.tex ?? own;
  if (typeof tex === 'string') return tex;
  return tex[f === 0 ? 0 : f === 1 ? 1 : 2];
}

/** Neighbour lookup for a cell of the padded section, within one block. */
function aroundIn(x: number, y: number, z: number): Around {
  return (dx, dy, dz) => {
    if (dx < -1 || dx > 1 || dy < -1 || dy > 1 || dz < -1 || dz > 1) return 0;
    return padded[padIndex(x + dx, y + dy, z + dz)];
  };
}

/** Light at a single open cell, for geometry that has no faces to average. */
function cellLight(i: number, skyBrightness: number): number {
  return Math.max(
    AMBIENT_FLOOR,
    falloff(paddedSky[i]) * skyBrightness,
    falloff(paddedBlock[i]),
  );
}

/**
 * Two crossed planes, the way grass, flowers and crops are drawn.
 *
 * Each plane is emitted with both windings so it shows from either side --
 * the opaque pass culls back faces, and a flower that vanishes when you walk
 * round it is worse than no flower. Transparent texels are discarded by the
 * shader, so these can sit in the opaque pass with no sorting at all.
 */
function emitCross(
  verts: number[], indices: number[], atlas: Atlas, tex: string,
  x: number, y: number, z: number, baseY: number,
  cross: { height: number; inset: number }, light: number,
): void {
  const [u0, v0, u1, v1] = atlas.uv(tex);
  // Each plane is one block wide, turned 45 degrees -- corner to corner of
  // the cell less a little, so neighbouring plants do not z-fight.
  const lo = 0.5 - (0.5 - cross.inset) * Math.SQRT1_2;
  const hi = 1 - lo;
  const h = cross.height;
  const planes: Array<[number, number, number, number]> = [
    [lo, lo, hi, hi],
    [lo, hi, hi, lo],
  ];
  // The top of the texture lines up with the top of the plant, so a short
  // plant shows the bottom of its tile rather than a squashed whole.
  const vt = v1 - (v1 - v0) * h;
  for (const [ax, az, bx, bz] of planes) {
    for (const flip of [false, true]) {
      const first = verts.length / FLOATS_PER_VERTEX;
      const corners: Array<[number, number, number, number, number]> = [
        [ax, 0, az, u0, v1],
        [bx, 0, bz, u1, v1],
        [bx, h, bz, u1, vt],
        [ax, h, az, u0, vt],
      ];
      if (flip) corners.reverse();
      for (const [cx, cy, cz, u, v] of corners) {
        verts.push(x + cx, baseY + y + cy, z + cz, u, v, light * 0.92, 1);
      }
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }
}

// --- liquids ------------------------------------------------------------------

/**
 * How high the fluid stands at one top corner of a cell: where the four
 * cells around that corner meet.
 *
 * Averaging is what turns a staircase of levels into a slope, and because
 * every cell sharing a corner computes the same number the surface has no
 * seams. Fluid of the same kind counts its level's height; an open cell
 * counts as empty, so the edge of a stream runs down to nothing; a solid
 * one sits out, so water meets a wall at its own height. A corner touching
 * a cell with the same fluid above it -- a waterfall, a lake's deeper
 * layers -- is full height, which is what lets a falling column meet the
 * pool it lands in without a gap.
 */
function cornerHeight(id: number, x: number, y: number, z: number, cx: number, cz: number): number {
  let sum = 0;
  let weight = 0;
  for (let oz = cz - 1; oz <= cz; oz++) {
    for (let ox = cx - 1; ox <= cx; ox++) {
      const n = padded[padIndex(x + ox, y, z + oz)];
      if (sameFluid(n, id)) {
        if (sameFluid(padded[padIndex(x + ox, y + 1, z + oz)], id)) return 1;
        // Still water weighs heavier, so a lake keeps a level edge where a
        // stream leaves it instead of sagging toward the stream.
        const w = isFluidSource(n) ? 8 : 1;
        sum += fluidHeight(n) * w;
        weight += w;
      } else if (!blockDef(n).solid) {
        weight += 1;
      }
    }
  }
  return weight > 0 ? sum / weight : fluidHeight(id);
}

/** Corner heights of the top face, in FACES[0] corner order: (0,0) (0,1) (1,1) (1,0). */
const tops = [0, 0, 0, 0];

/**
 * A water or lava cell: a box whose top follows the fluid's level and
 * slopes toward where it is running.
 *
 * Faces against the same fluid are never drawn, whatever its level -- the
 * corner heights already make neighbouring surfaces meet -- nor against
 * anything opaque. The top shows unless the same fluid is above it, since
 * even under a solid block a fluid below full height leaves a gap you can
 * see into.
 */
function emitLiquid(
  verts: number[], indices: number[], atlas: Atlas, id: number, textures: [string, string, string],
  emitter: boolean, x: number, y: number, z: number, baseY: number, skyBrightness: number,
): void {
  const covered = sameFluid(padded[padIndex(x, y + 1, z)], id);
  if (covered) {
    tops[0] = tops[1] = tops[2] = tops[3] = 1;
  } else {
    tops[0] = cornerHeight(id, x, y, z, 0, 0);
    tops[1] = cornerHeight(id, x, y, z, 0, 1);
    tops[2] = cornerHeight(id, x, y, z, 1, 1);
    tops[3] = cornerHeight(id, x, y, z, 1, 0);
  }
  const heightAt = (dx: number, dz: number): number =>
    dx === 0 ? (dz === 0 ? tops[0] : tops[1]) : (dz === 0 ? tops[3] : tops[2]);

  for (let f = 0; f < 6; f++) {
    const face = FACES[f];
    const nx = x + face.n[0];
    const ny = y + face.n[1];
    const nz = z + face.n[2];
    const neighbour = padded[padIndex(nx, ny, nz)];
    if (sameFluid(neighbour, id)) continue;
    if (f === 0) {
      if (covered) continue;
      if (isOpaque(neighbour) && tops[0] + tops[1] + tops[2] + tops[3] >= 4) continue;
    } else if (isOpaque(neighbour)) {
      continue;
    }

    const [u0, v0, u1, v1] = atlas.uv(faceTexture(FULL_LIQUID, textures, f));
    const first = verts.length / FLOATS_PER_VERTEX;
    for (let c = 0; c < 4; c++) {
      const [dx, dy, dz] = face.corners[c];
      const cy = dy === 0 ? 0 : heightAt(dx, dz);
      const local = [dx, cy, dz];
      cornerShade(face, nx, ny, nz, dx, dy, dz, emitter, skyBrightness);
      const fu = face.uFlip ? 1 - local[face.uAxis] : local[face.uAxis];
      const fv = face.vFlip ? 1 - local[face.vAxis] : local[face.vAxis];
      verts.push(
        x + dx, baseY + y + cy, z + dz,
        u0 + (u1 - u0) * fu,
        v0 + (v1 - v0) * fv,
        shade.light * face.shade,
        shade.ao,
      );
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
}

/** A liquid is textured like a plain cube; only its top moves. */
const FULL_LIQUID: Box = { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 };

export function meshSection(
  world: ClientWorld, atlas: Atlas, cx: number, cz: number, section: number,
  skyBrightness = 1,
): SectionMesh | null {
  const chunk = world.chunk(cx, cz);
  if (!chunk) return null;

  fillPadded(world, cx, cz, section);

  const opaqueV: number[] = [];
  const opaqueI: number[] = [];
  const alphaV: number[] = [];
  const alphaI: number[] = [];

  const baseY = section * SECTION_Y;

  for (let y = 0; y < SECTION_Y; y++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const id = padded[padIndex(x, y, z)];
        if (id === Block.Air) continue;

        const def = blockDef(id);
        const translucent = def.translucent;
        const verts = translucent ? alphaV : opaqueV;
        const indices = translucent ? alphaI : opaqueI;

        // Plants are two crossed planes rather than boxes.
        const cross = crossOf(id);
        if (cross) {
          emitCross(verts, indices, atlas, def.textures[2], x, y, z, baseY, cross,
            def.light > 0 ? 1 : cellLight(padIndex(x, y, z), skyBrightness));
          continue;
        }

        // Water and lava have a surface that follows their level.
        if (def.liquid) {
          emitLiquid(verts, indices, atlas, id, def.textures, def.light > 0, x, y, z, baseY, skyBrightness);
          continue;
        }

        // Most blocks are a single full cube, so this loop runs once and the
        // shape lookup returns a shared array without allocating. Shapes that
        // reach toward their neighbours (fences, panes, doors) read them from
        // the padded copy, which holds exactly one block of skirt -- enough
        // for anything that looks at the cells touching it.
        const boxes = isDynamicShape(id)
          ? shapeOf(id, aroundIn(x, y, z))
          : shapeOf(id);

        for (const box of boxes) {
          const bLo = [box.x0, box.y0, box.z0];
          const bHi = [box.x1, box.y1, box.z1];

          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const axis = face.n[0] !== 0 ? 0 : face.n[1] !== 0 ? 1 : 2;
            const positive = face.n[axis] > 0;

            // A face can only be hidden by a neighbour if it actually sits on
            // the cell wall. A slab's top is in mid-cell and always shows,
            // however solid the block above happens to be.
            const flush = positive ? bHi[axis] >= 1 - 1e-6 : bLo[axis] <= 1e-6;

            const nx = x + face.n[0];
            const ny = y + face.n[1];
            const nz = z + face.n[2];
            const neighbour = padded[padIndex(nx, ny, nz)];

            if (flush) {
              // Same block hides its own internal faces (water/glass surfaces).
              if (neighbour === id) continue;
              if (isOpaque(neighbour)) continue;
            }

            const texName = faceTexture(box, def.textures, f);
            const [u0, v0, u1, v1] = atlas.uv(texName);

            const emitter = def.light > 0;

            const first = verts.length / FLOATS_PER_VERTEX;
            for (let c = 0; c < 4; c++) {
              const [dx, dy, dz] = face.corners[c];

              // The corner's real position, which for a full cube is the 0/1
              // offset and for a partial box is the box's own edge.
              const cx = dx === 0 ? bLo[0] : bHi[0];
              const cy = dy === 0 ? bLo[1] : bHi[1];
              const cz = dz === 0 ? bLo[2] : bHi[2];
              const local = [cx, cy, cz];

              cornerShade(face, nx, ny, nz, dx, dy, dz, emitter, skyBrightness);

              // Texture follows the box's real extent, so a slab shows a
              // slab's worth of its side texture instead of the whole tile
              // squashed into it.
              const fu = face.uFlip ? 1 - local[face.uAxis] : local[face.uAxis];
              const fv = face.vFlip ? 1 - local[face.vAxis] : local[face.vAxis];

              verts.push(
                x + cx, baseY + y + cy, z + cz,
                u0 + (u1 - u0) * fu,
                v0 + (v1 - v0) * fv,
                shade.light * face.shade,
                shade.ao,
              );
            }
            indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
          }
        }
      }
    }
  }

  if (opaqueI.length === 0 && alphaI.length === 0) return null;
  return {
    opaque: { vertices: new Float32Array(opaqueV), indices: new Uint32Array(opaqueI) },
    alpha: { vertices: new Float32Array(alphaV), indices: new Uint32Array(alphaI) },
  };
}
