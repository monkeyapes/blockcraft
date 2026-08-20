/**
 * Vehicle models.
 *
 * Each vehicle is a handful of textured boxes assembled in local space, then
 * rotated by yaw/pitch/roll and emitted in world space. Cheap, and it matches
 * the blocky look of everything else.
 */

import { FLOATS_PER_VERTEX } from '../mesher.js';
import type { Vehicle } from '../vehicles.js';
import type { Atlas } from './atlas.js';

export interface Box {
  /** Centre offset in local space. */
  cx: number;
  cy: number;
  cz: number;
  /** Half-extents. */
  hx: number;
  hy: number;
  hz: number;
  texture: string;
  /** Extra rotation about the Y axis, for rotors. */
  spinY?: number;
  /** Extra rotation about the Z axis, for wheels. */
  spinZ?: number;
}

const FACE_CORNERS: Array<Array<[number, number, number]>> = [
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
];
const FACE_SHADE = [1.0, 0.5, 0.82, 0.82, 0.68, 0.68];
const UV_TOP = [0, 0, 0, 1, 1, 1, 1, 0];
const UV_SIDE = [0, 1, 1, 1, 1, 0, 0, 0];

/** The boxes a vehicle is built from, in its own local space. */
export function bodyOf(vehicle: Vehicle): Box[] {
  const spin = vehicle.spin;
  switch (vehicle.kind) {
    case 'skateboard':
      return [
        // Deck with kicked-up nose and tail, trucks, then wheels.
        { cx: 0, cy: 0.22, cz: 0, hx: 0.46, hy: 0.04, hz: 0.19, texture: 'planks' },
        { cx: 0.52, cy: 0.27, cz: 0, hx: 0.09, hy: 0.04, hz: 0.17, texture: 'planks' },
        { cx: -0.52, cy: 0.27, cz: 0, hx: 0.09, hy: 0.04, hz: 0.17, texture: 'planks' },
        { cx: 0.30, cy: 0.13, cz: 0, hx: 0.06, hy: 0.05, hz: 0.15, texture: 'chrome' },
        { cx: -0.30, cy: 0.13, cz: 0, hx: 0.06, hy: 0.05, hz: 0.15, texture: 'chrome' },
        { cx: 0.32, cy: 0.08, cz: 0.17, hx: 0.075, hy: 0.075, hz: 0.05, texture: 'tire', spinZ: spin * 3 },
        { cx: 0.32, cy: 0.08, cz: -0.17, hx: 0.075, hy: 0.075, hz: 0.05, texture: 'tire', spinZ: spin * 3 },
        { cx: -0.32, cy: 0.08, cz: 0.17, hx: 0.075, hy: 0.075, hz: 0.05, texture: 'tire', spinZ: spin * 3 },
        { cx: -0.32, cy: 0.08, cz: -0.17, hx: 0.075, hy: 0.075, hz: 0.05, texture: 'tire', spinZ: spin * 3 },
      ];

    case 'boat':
      return [
        // An open hull: a floor with four low walls, plus a raised prow and
        // stern so it reads as a boat rather than a floating crate. Left
        // open on top because the rider sits down inside it.
        { cx: 0, cy: 0.14, cz: 0, hx: 0.92, hy: 0.07, hz: 0.60, texture: 'planks' },
        { cx: 0, cy: 0.34, cz: 0.62, hx: 0.92, hy: 0.16, hz: 0.07, texture: 'planks' },
        { cx: 0, cy: 0.34, cz: -0.62, hx: 0.92, hy: 0.16, hz: 0.07, texture: 'planks' },
        { cx: 1.02, cy: 0.34, cz: 0, hx: 0.09, hy: 0.16, hz: 0.60, texture: 'planks' },
        { cx: -1.02, cy: 0.34, cz: 0, hx: 0.09, hy: 0.16, hz: 0.60, texture: 'planks' },
        // Prow and stern, tapered inward and lifted.
        { cx: 1.22, cy: 0.30, cz: 0, hx: 0.16, hy: 0.14, hz: 0.34, texture: 'planks' },
        { cx: -1.22, cy: 0.28, cz: 0, hx: 0.16, hy: 0.12, hz: 0.38, texture: 'planks' },
        // A bench to sit on, and gunwale rails.
        { cx: -0.34, cy: 0.30, cz: 0, hx: 0.16, hy: 0.10, hz: 0.50, texture: 'log_side' },
        { cx: 0, cy: 0.51, cz: 0.62, hx: 0.94, hy: 0.05, hz: 0.09, texture: 'log_side' },
        { cx: 0, cy: 0.51, cz: -0.62, hx: 0.94, hy: 0.05, hz: 0.09, texture: 'log_side' },
        // Oars, sweeping with travel so it looks rowed rather than dragged.
        { cx: 0.10, cy: 0.44, cz: 0.86, hx: 0.52, hy: 0.04, hz: 0.05,
          texture: 'log_side', spinZ: Math.sin(spin * 0.6) * 14 },
        { cx: 0.10, cy: 0.44, cz: -0.86, hx: 0.52, hy: 0.04, hz: 0.05,
          texture: 'log_side', spinZ: -Math.sin(spin * 0.6) * 14 },
      ];

    case 'truck':
      return [
        // A high cab up front and a flat load bed behind it: the two-volume
        // silhouette is what separates a truck from a car at a distance.
        { cx: 0.72, cy: 1.02, cz: 0, hx: 0.56, hy: 0.46, hz: 0.86, texture: 'paint_dark' },
        { cx: 0.74, cy: 1.30, cz: 0, hx: 0.40, hy: 0.20, hz: 0.78, texture: 'glass' },
        { cx: 1.28, cy: 0.62, cz: 0, hx: 0.10, hy: 0.34, hz: 0.86, texture: 'chrome' },
        // Chassis and bed.
        { cx: -0.10, cy: 0.52, cz: 0, hx: 1.42, hy: 0.20, hz: 0.86, texture: 'paint_dark' },
        { cx: -0.78, cy: 0.80, cz: 0.80, hx: 0.74, hy: 0.22, hz: 0.07, texture: 'iron_block' },
        { cx: -0.78, cy: 0.80, cz: -0.80, hx: 0.74, hy: 0.22, hz: 0.07, texture: 'iron_block' },
        { cx: -1.50, cy: 0.80, cz: 0, hx: 0.07, hy: 0.22, hz: 0.86, texture: 'iron_block' },
        // Lamps and four wheels.
        { cx: 1.32, cy: 0.78, cz: 0.58, hx: 0.06, hy: 0.13, hz: 0.20, texture: 'headlight' },
        { cx: 1.32, cy: 0.78, cz: -0.58, hx: 0.06, hy: 0.13, hz: 0.20, texture: 'headlight' },
        { cx: -1.54, cy: 0.72, cz: 0.60, hx: 0.05, hy: 0.10, hz: 0.18, texture: 'taillight' },
        { cx: -1.54, cy: 0.72, cz: -0.60, hx: 0.05, hy: 0.10, hz: 0.18, texture: 'taillight' },
        { cx: 0.78, cy: 0.34, cz: 0.82, hx: 0.32, hy: 0.32, hz: 0.14, texture: 'tire', spinZ: spin * 2 },
        { cx: 0.78, cy: 0.34, cz: -0.82, hx: 0.32, hy: 0.32, hz: 0.14, texture: 'tire', spinZ: spin * 2 },
        { cx: -0.92, cy: 0.34, cz: 0.82, hx: 0.32, hy: 0.32, hz: 0.14, texture: 'tire', spinZ: spin * 2 },
        { cx: -0.92, cy: 0.34, cz: -0.82, hx: 0.32, hy: 0.32, hz: 0.14, texture: 'tire', spinZ: spin * 2 },
      ];

    case 'car':
      return [
        // One solid body block, then a bonnet and boot stepped down from it,
        // so the silhouette reads as a car instead of stacked slabs. The
        // cabin is framed in bodywork with glass only in the window gaps --
        // glass on its own is near-invisible and looked like floating panels.
        { cx: -0.10, cy: 0.52, cz: 0, hx: 0.72, hy: 0.30, hz: 0.72, texture: 'paint_red' },
        { cx: 0.98, cy: 0.42, cz: 0, hx: 0.40, hy: 0.20, hz: 0.68, texture: 'paint_red' },
        { cx: -1.02, cy: 0.44, cz: 0, hx: 0.36, hy: 0.22, hz: 0.68, texture: 'paint_red' },

        // An open cockpit: a seated player needs about 0.9 blocks of headroom
        // above the seat, and a roof at that height would look like a van.
        // A convertible keeps the driver visible and the proportions right.
        { cx: 0.44, cy: 0.94, cz: 0, hx: 0.05, hy: 0.28, hz: 0.62, texture: 'glass' },
        { cx: 0.44, cy: 0.94, cz: 0.68, hx: 0.06, hy: 0.28, hz: 0.07, texture: 'paint_red' },
        { cx: 0.44, cy: 0.94, cz: -0.68, hx: 0.06, hy: 0.28, hz: 0.07, texture: 'paint_red' },
        { cx: 0.44, cy: 1.23, cz: 0, hx: 0.06, hy: 0.05, hz: 0.70, texture: 'chrome' },
        // Seat back and door tops frame the cockpit.
        { cx: -0.66, cy: 0.86, cz: 0, hx: 0.10, hy: 0.28, hz: 0.52, texture: 'paint_dark' },
        { cx: -0.10, cy: 0.84, cz: 0.70, hx: 0.60, hy: 0.06, hz: 0.06, texture: 'paint_red' },
        { cx: -0.10, cy: 0.84, cz: -0.70, hx: 0.60, hy: 0.06, hz: 0.06, texture: 'paint_red' },

        // Bumpers and lamps.
        { cx: 1.40, cy: 0.40, cz: 0, hx: 0.07, hy: 0.14, hz: 0.70, texture: 'chrome' },
        { cx: -1.40, cy: 0.42, cz: 0, hx: 0.07, hy: 0.14, hz: 0.70, texture: 'chrome' },
        { cx: 1.40, cy: 0.54, cz: 0.44, hx: 0.06, hy: 0.11, hz: 0.18, texture: 'headlight' },
        { cx: 1.40, cy: 0.54, cz: -0.44, hx: 0.06, hy: 0.11, hz: 0.18, texture: 'headlight' },
        { cx: -1.42, cy: 0.56, cz: 0.46, hx: 0.05, hy: 0.09, hz: 0.16, texture: 'taillight' },
        { cx: -1.42, cy: 0.56, cz: -0.46, hx: 0.05, hy: 0.09, hz: 0.16, texture: 'taillight' },

        // Wheels, sitting proud of the body.
        { cx: 0.86, cy: 0.30, cz: 0.76, hx: 0.30, hy: 0.30, hz: 0.13, texture: 'tire', spinZ: spin * 2 },
        { cx: 0.86, cy: 0.30, cz: -0.76, hx: 0.30, hy: 0.30, hz: 0.13, texture: 'tire', spinZ: spin * 2 },
        { cx: -0.90, cy: 0.30, cz: 0.76, hx: 0.30, hy: 0.30, hz: 0.13, texture: 'tire', spinZ: spin * 2 },
        { cx: -0.90, cy: 0.30, cz: -0.76, hx: 0.30, hy: 0.30, hz: 0.13, texture: 'tire', spinZ: spin * 2 },
      ];

    case 'plane':
      return [
        // Fuselage deep enough to sit inside, with an open cockpit well.
        { cx: -0.10, cy: 0.52, cz: 0, hx: 1.30, hy: 0.34, hz: 0.38, texture: 'chrome' },
        { cx: 1.32, cy: 0.52, cz: 0, hx: 0.18, hy: 0.26, hz: 0.30, texture: 'paint_red' },
        // Open cockpit with the windscreen ahead of the pilot. A canopy over
        // the seat would be solid geometry exactly where the head goes.
        { cx: 0.86, cy: 1.00, cz: 0, hx: 0.05, hy: 0.24, hz: 0.32, texture: 'glass' },
        { cx: 0.86, cy: 1.26, cz: 0, hx: 0.06, hy: 0.04, hz: 0.34, texture: 'chrome' },
        { cx: -0.24, cy: 0.98, cz: 0, hx: 0.09, hy: 0.22, hz: 0.30, texture: 'paint_red' },
        // Main wing, with red tips so roll reads at a glance.
        { cx: 0.10, cy: 0.44, cz: 0, hx: 0.44, hy: 0.07, hz: 1.70, texture: 'chrome' },
        { cx: 0.10, cy: 0.44, cz: 1.90, hx: 0.36, hy: 0.07, hz: 0.24, texture: 'paint_red' },
        { cx: 0.10, cy: 0.44, cz: -1.90, hx: 0.36, hy: 0.07, hz: 0.24, texture: 'paint_red' },
        // Tailplane and fin.
        { cx: -1.24, cy: 0.56, cz: 0, hx: 0.24, hy: 0.06, hz: 0.76, texture: 'chrome' },
        { cx: -1.30, cy: 0.94, cz: 0, hx: 0.22, hy: 0.36, hz: 0.06, texture: 'paint_red' },
        // Propeller.
        { cx: 1.52, cy: 0.52, cz: 0, hx: 0.05, hy: 0.86, hz: 0.07, texture: 'rotor', spinZ: spin * 9 },
        { cx: 1.54, cy: 0.52, cz: 0, hx: 0.07, hy: 0.12, hz: 0.12, texture: 'chrome' },
        // Fixed gear, so it does not look like it is lying on its belly.
        { cx: 0.40, cy: 0.12, cz: 0.42, hx: 0.14, hy: 0.14, hz: 0.07, texture: 'tire' },
        { cx: 0.40, cy: 0.12, cz: -0.42, hx: 0.14, hy: 0.14, hz: 0.07, texture: 'tire' },
      ];

    case 'helicopter':
      return [
        // The cabin is built as a shell -- floor, sides, back, roof -- so the
        // pilot sits in an open volume. A single solid block would swallow
        // the head.
        { cx: 0.05, cy: 0.32, cz: 0, hx: 0.74, hy: 0.12, hz: 0.58, texture: 'paint_dark' },
        { cx: 0.05, cy: 1.00, cz: 0.58, hx: 0.74, hy: 0.58, hz: 0.09, texture: 'paint_dark' },
        { cx: 0.05, cy: 1.00, cz: -0.58, hx: 0.74, hy: 0.58, hz: 0.09, texture: 'paint_dark' },
        { cx: -0.62, cy: 1.00, cz: 0, hx: 0.09, hy: 0.58, hz: 0.58, texture: 'paint_dark' },
        { cx: 0.05, cy: 1.70, cz: 0, hx: 0.76, hy: 0.09, hz: 0.60, texture: 'paint_dark' },
        // Glass nose, ahead of the pilot.
        { cx: 0.86, cy: 0.98, cz: 0, hx: 0.09, hy: 0.56, hz: 0.52, texture: 'glass' },
        { cx: 0.72, cy: 0.42, cz: 0, hx: 0.28, hy: 0.12, hz: 0.52, texture: 'paint_dark' },
        // Tail boom and fin.
        { cx: -1.24, cy: 1.20, cz: 0, hx: 0.66, hy: 0.11, hz: 0.11, texture: 'paint_dark' },
        { cx: -1.86, cy: 1.34, cz: 0, hx: 0.06, hy: 0.30, hz: 0.06, texture: 'paint_dark' },
        { cx: -1.60, cy: 1.20, cz: 0, hx: 0.18, hy: 0.05, hz: 0.34, texture: 'chrome' },
        // Mast and main rotor, clear above the roof.
        { cx: 0.05, cy: 1.86, cz: 0, hx: 0.08, hy: 0.14, hz: 0.08, texture: 'chrome' },
        { cx: 0.05, cy: 1.98, cz: 0, hx: 2.4, hy: 0.03, hz: 0.12, texture: 'rotor', spinY: spin * 6 },
        { cx: 0.05, cy: 1.98, cz: 0, hx: 0.12, hy: 0.03, hz: 2.4, texture: 'rotor', spinY: spin * 6 },
        // Tail rotor.
        { cx: -1.88, cy: 1.34, cz: 0.10, hx: 0.03, hy: 0.46, hz: 0.03, texture: 'rotor', spinZ: spin * 11 },
        // Skids.
        { cx: 0.05, cy: 0.10, cz: 0.56, hx: 0.84, hy: 0.05, hz: 0.05, texture: 'chrome' },
        { cx: 0.05, cy: 0.10, cz: -0.56, hx: 0.84, hy: 0.05, hz: 0.05, texture: 'chrome' },
        { cx: 0.40, cy: 0.20, cz: 0.40, hx: 0.05, hy: 0.16, hz: 0.20, texture: 'chrome' },
        { cx: -0.30, cy: 0.20, cz: 0.40, hx: 0.05, hy: 0.16, hz: 0.20, texture: 'chrome' },
        { cx: 0.40, cy: 0.20, cz: -0.40, hx: 0.05, hy: 0.16, hz: 0.20, texture: 'chrome' },
        { cx: -0.30, cy: 0.20, cz: -0.40, hx: 0.05, hy: 0.16, hz: 0.20, texture: 'chrome' },
      ];
  }
}

function rotateY(p: [number, number, number], a: number): [number, number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
}

function rotateZ(p: [number, number, number], a: number): [number, number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

function rotateX(p: [number, number, number], a: number): [number, number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

export interface WorldMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

/** Builds world-space geometry for every vehicle in one buffer. */
export function buildVehicleMesh(atlas: Atlas, vehicles: Vehicle[]): WorldMesh {
  const verts: number[] = [];
  const indices: number[] = [];

  for (const vehicle of vehicles) {
    const yaw = (vehicle.yaw * Math.PI) / 180;
    const pitch = (vehicle.pitch * Math.PI) / 180;
    const roll = (vehicle.roll * Math.PI) / 180;

    for (const box of bodyOf(vehicle)) {
      const [u0, v0, u1, v1] = atlas.uv(box.texture);

      for (let f = 0; f < 6; f++) {
        const corners = FACE_CORNERS[f];
        const uvs = f === 0 ? UV_TOP : UV_SIDE;
        const first = verts.length / FLOATS_PER_VERTEX;

        for (let c = 0; c < 4; c++) {
          const [lx, ly, lz] = corners[c];
          // Corner offset within the box.
          let p: [number, number, number] = [
            (lx * 2 - 1) * box.hx,
            (ly * 2 - 1) * box.hy,
            (lz * 2 - 1) * box.hz,
          ];
          // Part-local spin (rotors, wheels) happens before placement.
          if (box.spinY) p = rotateY(p, box.spinY);
          if (box.spinZ) p = rotateZ(p, box.spinZ);

          p = [p[0] + box.cx, p[1] + box.cy, p[2] + box.cz];

          // Then the vehicle's own orientation: roll, pitch, yaw.
          p = rotateZ(p, roll);
          p = rotateX(p, pitch);
          p = rotateY(p, -yaw);

          verts.push(
            vehicle.x + p[0], vehicle.y + p[1], vehicle.z + p[2],
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
