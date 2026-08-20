/**
 * Mob models.
 *
 * Same box-and-pivot approach as the player: legs swing from the hip so
 * walking reads as walking, and a hurt mob flashes red.
 */

import { MobKind } from '@shared/mobs.js';
import { FLOATS_PER_VERTEX } from '../mesher.js';
import type { Mob } from '../mobs.js';
import type { Atlas } from './atlas.js';

interface Part {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  texture: string;
  /** Face texture applied to the +X side, e.g. a snout or a face. */
  front?: string;
  /**
   * Limbs rotate about their own joint. Both coordinates matter: pivoting
   * only in Y makes a leg set forward of the body swing about the centreline
   * instead of its hip, which drags the foot below the ground.
   */
  pivotX?: number;
  pivotY?: number;
  swing?: number;
}

const FACE_CORNERS: Array<Array<[number, number, number]>> = [
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
];
const FACE_SHADE = [1.0, 0.5, 0.82, 0.82, 0.7, 0.7];
const UV_TOP = [0, 0, 0, 1, 1, 1, 1, 0];
const UV_SIDE = [0, 1, 1, 1, 1, 0, 0, 0];
const FRONT_FACE = 4;

/** A four-legged body: torso, head, four legs swinging in diagonal pairs. */
function quadruped(
  body: string, head: string, face: string, legs: string,
  length: number, height: number, width: number,
  headSize: number, legHeight: number, swing: number,
): Part[] {
  const bodyY = legHeight + (height - legHeight) / 2;
  const legHalf = legHeight / 2;
  const lx = length / 2 - 0.12;
  const lz = width / 2 - 0.08;

  return [
    { cx: 0, cy: bodyY, cz: 0, hx: length / 2, hy: (height - legHeight) / 2, hz: width / 2, texture: body },
    {
      cx: length / 2 + headSize / 2 - 0.05, cy: height - headSize / 2 + 0.05, cz: 0,
      hx: headSize / 2, hy: headSize / 2, hz: headSize / 2, texture: head, front: face,
    },
    { cx: lx, cy: legHalf, cz: lz, hx: 0.09, hy: legHalf, hz: 0.09, texture: legs, pivotY: legHeight, swing },
    { cx: lx, cy: legHalf, cz: -lz, hx: 0.09, hy: legHalf, hz: 0.09, texture: legs, pivotY: legHeight, swing: -swing },
    { cx: -lx, cy: legHalf, cz: lz, hx: 0.09, hy: legHalf, hz: 0.09, texture: legs, pivotY: legHeight, swing: -swing },
    { cx: -lx, cy: legHalf, cz: -lz, hx: 0.09, hy: legHalf, hz: 0.09, texture: legs, pivotY: legHeight, swing },
  ];
}

function partsFor(mob: Mob): Part[] {
  const swing = Math.sin(mob.phase) * 0.7;

  switch (mob.kind) {
    case MobKind.Pig:
      return quadruped('pig', 'pig', 'pig_face', 'pig', 0.9, 0.9, 0.6, 0.5, 0.28, swing);

    case MobKind.Cow:
      return [
        ...quadruped('cow', 'cow_head', 'cow_face', 'cow_head', 1.1, 1.4, 0.7, 0.6, 0.55, swing),
        // Horns.
        { cx: 0.62, cy: 1.32, cz: 0.24, hx: 0.05, hy: 0.05, hz: 0.09, texture: 'bone' },
        { cx: 0.62, cy: 1.32, cz: -0.24, hx: 0.05, hy: 0.05, hz: 0.09, texture: 'bone' },
      ];

    case MobKind.Sheep:
      return [
        ...quadruped('wool', 'wool', 'sheep_face', 'sheep_leg', 1.0, 1.3, 0.7, 0.5, 0.5, swing),
      ];

    case MobKind.Chicken:
      return [
        { cx: 0, cy: 0.42, cz: 0, hx: 0.16, hy: 0.14, hz: 0.13, texture: 'chicken' },
        { cx: 0.2, cy: 0.6, cz: 0, hx: 0.1, hy: 0.1, hz: 0.1, texture: 'chicken', front: 'chicken_face' },
        { cx: 0.31, cy: 0.58, cz: 0, hx: 0.05, hy: 0.03, hz: 0.04, texture: 'beak' },
        { cx: 0, cy: 0.44, cz: 0.15, hx: 0.12, hy: 0.1, hz: 0.03, texture: 'chicken' },
        { cx: 0, cy: 0.44, cz: -0.15, hx: 0.12, hy: 0.1, hz: 0.03, texture: 'chicken' },
        { cx: 0, cy: 0.14, cz: 0.07, hx: 0.03, hy: 0.14, hz: 0.03, texture: 'beak', pivotY: 0.28, swing },
        { cx: 0, cy: 0.14, cz: -0.07, hx: 0.03, hy: 0.14, hz: 0.03, texture: 'beak', pivotY: 0.28, swing: -swing },
      ];

    case MobKind.Blaze: {
      // A floating core wrapped in rods that spin about it.
      const rods: Part[] = [];
      for (let i = 0; i < 8; i++) {
        const a = mob.phase * 1.5 + (i / 8) * Math.PI * 2;
        rods.push({
          cx: Math.cos(a) * 0.4, cy: 0.9 + Math.sin(a * 2) * 0.28, cz: Math.sin(a) * 0.4,
          hx: 0.05, hy: 0.22, hz: 0.05, texture: 'blaze_rod_mob',
        });
      }
      return [
        { cx: 0, cy: 0.95, cz: 0, hx: 0.22, hy: 0.26, hz: 0.22, texture: 'blaze_core', front: 'blaze_face' },
        ...rods,
      ];
    }

    case MobKind.Enderman:
      return [
        { cx: 0, cy: 2.62, cz: 0, hx: 0.2, hy: 0.22, hz: 0.2, texture: 'ender_body', front: 'ender_face' },
        { cx: 0, cy: 1.95, cz: 0, hx: 0.1, hy: 0.45, hz: 0.2, texture: 'ender_body' },
        // Long spindly limbs are the whole silhouette.
        { cx: 0, cy: 1.9, cz: 0.28, hx: 0.07, hy: 0.5, hz: 0.07, texture: 'ender_body', pivotY: 2.4, swing: swing * 0.5 },
        { cx: 0, cy: 1.9, cz: -0.28, hx: 0.07, hy: 0.5, hz: 0.07, texture: 'ender_body', pivotY: 2.4, swing: -swing * 0.5 },
        { cx: 0, cy: 0.72, cz: 0.12, hx: 0.07, hy: 0.72, hz: 0.07, texture: 'ender_body', pivotY: 1.44, swing },
        { cx: 0, cy: 0.72, cz: -0.12, hx: 0.07, hy: 0.72, hz: 0.07, texture: 'ender_body', pivotY: 1.44, swing: -swing },
      ];

    case MobKind.EnderDragon: {
      const flap = Math.sin(mob.phase) * 0.5;
      const wing: Part[] = [];
      // Each wing is built from panels so it can bend along its span.
      for (let i = 0; i < 4; i++) {
        const spanFrom = 0.6 + i * 0.9;
        wing.push(
          {
            cx: -0.2, cy: 1.5 + flap * (i + 1) * 0.35, cz: spanFrom,
            hx: 0.5, hy: 0.06, hz: 0.46, texture: 'dragon_wing',
          },
          {
            cx: -0.2, cy: 1.5 + flap * (i + 1) * 0.35, cz: -spanFrom,
            hx: 0.5, hy: 0.06, hz: 0.46, texture: 'dragon_wing',
          },
        );
      }
      return [
        { cx: 0, cy: 1.4, cz: 0, hx: 1.1, hy: 0.55, hz: 0.65, texture: 'dragon_body' },
        { cx: 1.5, cy: 1.6, cz: 0, hx: 0.5, hy: 0.32, hz: 0.38, texture: 'dragon_body' },
        { cx: 2.1, cy: 1.55, cz: 0, hx: 0.36, hy: 0.26, hz: 0.3, texture: 'dragon_head', front: 'dragon_face' },
        { cx: 1.9, cy: 1.9, cz: 0.2, hx: 0.06, hy: 0.16, hz: 0.06, texture: 'dragon_head' },
        { cx: 1.9, cy: 1.9, cz: -0.2, hx: 0.06, hy: 0.16, hz: 0.06, texture: 'dragon_head' },
        { cx: -1.6, cy: 1.35, cz: 0, hx: 0.6, hy: 0.26, hz: 0.26, texture: 'dragon_body' },
        { cx: -2.5, cy: 1.3, cz: 0, hx: 0.4, hy: 0.16, hz: 0.16, texture: 'dragon_body' },
        ...wing,
      ];
    }

    case MobKind.Zombie:
      return [
        { cx: 0, cy: 1.68, cz: 0, hx: 0.21, hy: 0.21, hz: 0.21, texture: 'zombie_head', front: 'zombie_face' },
        { cx: 0, cy: 1.15, cz: 0, hx: 0.12, hy: 0.32, hz: 0.22, texture: 'zombie_body' },
        // Arms held out in front, which is the whole silhouette.
        { cx: 0.28, cy: 1.3, cz: 0.3, hx: 0.28, hy: 0.1, hz: 0.1, texture: 'zombie_head' },
        { cx: 0.28, cy: 1.3, cz: -0.3, hx: 0.28, hy: 0.1, hz: 0.1, texture: 'zombie_head' },
        { cx: 0, cy: 0.42, cz: 0.11, hx: 0.1, hy: 0.42, hz: 0.1, texture: 'zombie_legs', pivotY: 0.84, swing },
        { cx: 0, cy: 0.42, cz: -0.11, hx: 0.1, hy: 0.42, hz: 0.1, texture: 'zombie_legs', pivotY: 0.84, swing: -swing },
      ];
  }
}

function rotateZAbout(
  p: [number, number, number], pivotX: number, pivotY: number, angle: number,
): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p[0] - pivotX;
  const dy = p[1] - pivotY;
  return [pivotX + dx * c - dy * s, pivotY + dx * s + dy * c, p[2]];
}

function rotateY(p: [number, number, number], a: number): [number, number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
}

export interface WorldMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

export function buildMobMesh(atlas: Atlas, mobs: Mob[]): WorldMesh {
  const verts: number[] = [];
  const indices: number[] = [];

  for (const mob of mobs) {
    if (mob.dead) continue;
    const yaw = (mob.yaw * Math.PI) / 180;
    // A hit flashes the whole model brighter for a moment.
    const flash = mob.hurtTimer > 0 ? 1.9 : 1;

    for (const part of partsFor(mob)) {
      for (let f = 0; f < 6; f++) {
        const name = f === FRONT_FACE && part.front ? part.front : part.texture;
        const [u0, v0, u1, v1] = atlas.uv(name);
        const uvs = f === 0 ? UV_TOP : UV_SIDE;
        const first = verts.length / FLOATS_PER_VERTEX;

        for (let c = 0; c < 4; c++) {
          const [lx, ly, lz] = FACE_CORNERS[f][c];
          let p: [number, number, number] = [
            part.cx + (lx * 2 - 1) * part.hx,
            part.cy + (ly * 2 - 1) * part.hy,
            part.cz + (lz * 2 - 1) * part.hz,
          ];
          if (part.swing !== undefined && part.pivotY !== undefined) {
            p = rotateZAbout(p, part.pivotX ?? part.cx, part.pivotY, part.swing);
          }
          p = rotateY(p, -yaw);

          verts.push(
            mob.x + p[0], mob.y + p[1], mob.z + p[2],
            uvs[c * 2] === 0 ? u0 : u1,
            uvs[c * 2 + 1] === 0 ? v0 : v1,
            FACE_SHADE[f] * flash, 1,
          );
        }
        indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
      }
    }
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(indices) };
}
