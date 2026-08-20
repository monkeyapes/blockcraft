/**
 * Blocky humanoid player model.
 *
 * Used for remote players and for the local player in third person. Limbs
 * pivot at the shoulder and hip so walking actually swings rather than
 * sliding the whole box around.
 */

import { FLOATS_PER_VERTEX } from '../mesher.js';
import type { Atlas } from './atlas.js';

/** Overall height, matched to the player's collision box. */
const HEIGHT = 1.8;

interface Part {
  /** Centre of the box, before limb rotation. */
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  texture: string;
  /** Texture for the forward (+X) face, e.g. the face on a head. */
  front?: string;
  /** Pivot for limb swing, in model space. */
  pivotY?: number;
  /** Swing angle in radians, about the Z axis. */
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
/** Face index 4 is +X, which is the direction the model faces. */
const FRONT_FACE = 4;

export interface PlayerPose {
  x: number;
  y: number;
  z: number;
  /** Degrees, matching the player's yaw convention (0 = +X). */
  yaw: number;
  /** Walk cycle phase in radians. */
  phase: number;
  /** 0 = still, 1 = full stride. */
  stride: number;
  /** Riding: legs bend forward into a seated pose. */
  seated?: boolean;
}

/** Hip height; a seated model hangs from here rather than standing on its feet. */
const HIP = 0.76;

function parts(pose: PlayerPose): Part[] {
  const swing = Math.sin(pose.phase) * 0.85 * pose.stride;
  // Seated: thighs forward a right angle, arms reaching for the controls.
  const legFront = pose.seated ? -Math.PI / 2 : swing;
  const legBack = pose.seated ? -Math.PI / 2 : -swing;
  const armFront = pose.seated ? -0.75 : -swing * 0.8;
  const armBack = pose.seated ? -0.75 : swing * 0.8;

  return [
    // Head: hair on the sides and back, face on the front.
    { cx: 0, cy: 1.57, cz: 0, hx: 0.22, hy: 0.22, hz: 0.22, texture: 'hair', front: 'face' },
    // Torso.
    { cx: 0, cy: 1.06, cz: 0, hx: 0.13, hy: 0.29, hz: 0.24, texture: 'shirt' },
    // Arms: a sleeve down to the elbow, then a bare hand.
    {
      cx: 0, cy: 1.16, cz: 0.34, hx: 0.11, hy: 0.19, hz: 0.11,
      texture: 'sleeve', pivotY: 1.35, swing: armFront,
    },
    {
      cx: 0, cy: 1.16, cz: -0.34, hx: 0.11, hy: 0.19, hz: 0.11,
      texture: 'sleeve', pivotY: 1.35, swing: armBack,
    },
    {
      cx: 0, cy: 0.87, cz: 0.34, hx: 0.105, hy: 0.11, hz: 0.105,
      texture: 'skin', pivotY: 1.35, swing: armFront,
    },
    {
      cx: 0, cy: 0.87, cz: -0.34, hx: 0.105, hy: 0.11, hz: 0.105,
      texture: 'skin', pivotY: 1.35, swing: armBack,
    },
    // Legs, pivoting at the hip.
    {
      cx: 0, cy: 0.38, cz: 0.12, hx: 0.11, hy: 0.38, hz: 0.11,
      texture: 'pants', pivotY: 0.76, swing: legFront,
    },
    {
      cx: 0, cy: 0.38, cz: -0.12, hx: 0.11, hy: 0.38, hz: 0.11,
      texture: 'pants', pivotY: 0.76, swing: legBack,
    },
    // Boots.
    {
      cx: 0.02, cy: 0.05, cz: 0.12, hx: 0.13, hy: 0.05, hz: 0.12,
      texture: 'boots', pivotY: 0.76, swing: legFront,
    },
    {
      cx: 0.02, cy: 0.05, cz: -0.12, hx: 0.13, hy: 0.05, hz: 0.12,
      texture: 'boots', pivotY: 0.76, swing: legBack,
    },
  ];
}

/** Limbs rotate about their own joint, in both axes. See mobmesh for why. */
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

/** Builds world-space geometry for a set of posed players. */
export function buildPlayerMesh(atlas: Atlas, poses: PlayerPose[]): WorldMesh {
  const verts: number[] = [];
  const indices: number[] = [];

  for (const pose of poses) {
    const yaw = (pose.yaw * Math.PI) / 180;

    // `pose.y` is the seat surface when seated and the ground when standing,
    // so a seated model is lowered until its hips meet the seat.
    const drop = pose.seated ? -HIP : 0;

    for (const part of parts(pose)) {
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
            p = rotateZAbout(p, part.cx, part.pivotY, part.swing);
          }
          p = rotateY(p, -yaw);

          verts.push(
            pose.x + p[0], pose.y + p[1] + drop, pose.z + p[2],
            uvs[c * 2] === 0 ? u0 : u1,
            uvs[c * 2 + 1] === 0 ? v0 : v1,
            FACE_SHADE[f], 1,
          );
        }
        indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
      }
    }
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(indices) };
}

export { HEIGHT as PLAYER_MODEL_HEIGHT };
