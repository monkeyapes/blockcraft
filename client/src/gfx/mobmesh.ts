/**
 * Mob models.
 *
 * Every mob is a set of boxes authored in sixteenths of a block -- the same
 * unit block art is drawn in -- with +x forward, +y up and +z to the mob's
 * right, standing on the origin. A box may carry a chain of rotations about
 * pivots, applied innermost first, which is how a leg swings from its hip, a
 * spider's shin bends at the knee under a thigh that is itself lifting, and a
 * head turns on its neck toward you.
 *
 * Skins are mapped at one texel per sixteenth: a leg four units wide shows
 * four columns of its skin, a flank sixteen, so fur and scales stay the same
 * size all over the body instead of stretching on big faces and smearing on
 * small ones. Faces, eyes and other decals are mapped whole onto their face.
 *
 * Feel comes from the transient state the AI leaves on the mob: a hit
 * flashes the model red, a corpse tips over, darkens and shrinks away, a
 * boomshroom swells and blinks before it bursts, a slime squashes when it
 * lands.
 */

import { MobKind } from '@shared/mobs.js';
import { FLOATS_PER_VERTEX } from '../mesher.js';
import { DEATH_TIME, FUSE_TIME, type Mob } from '../mobs.js';
import type { Atlas } from './atlas.js';

type V3 = [number, number, number];

type Face = 'top' | 'bottom' | 'right' | 'left' | 'front' | 'back';
const FACES: Face[] = ['top', 'bottom', 'right', 'left', 'front', 'back'];

/** A rotation about a pivot, in sixteenths and radians: z pitches, x rolls, y turns. */
interface Xf {
  p: V3;
  rx: number;
  ry: number;
  rz: number;
  /** Moved by this after turning: a sitting wolf settling onto its haunches. */
  t?: V3;
}

interface PartOpts {
  /** Decals mapped whole onto one face: a face, an eye, a snout. */
  faces?: Partial<Record<Face, string>>;
  /** Where in the skin this box's texels start, in sixteenths. */
  uv?: [number, number];
  /** Lit from within: eyes, a blaze's core. */
  glow?: boolean;
  /** Translucent, so drawn after everything solid: a slime's shell. */
  late?: boolean;
}

interface Part extends PartOpts {
  lo: V3;
  hi: V3;
  tex: string;
  xf: Xf[];
}

const P = 1 / 16;

function box(
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  tex: string, opts: PartOpts = {},
): Part {
  return { lo: [x0, y0, z0], hi: [x1, y1, z1], tex, xf: [], ...opts };
}

function rot(p: V3, rx = 0, ry = 0, rz = 0, t?: V3): Xf {
  return t ? { p, rx, ry, rz, t } : { p, rx, ry, rz };
}

/** Adds an outer rotation to every part: the head turning carries the ears with it. */
function pose(parts: Part[], xf: Xf): Part[] {
  for (const part of parts) part.xf.push(xf);
  return parts;
}

/** The same box on both sides of the body, mirrored across z. */
function pair(
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  tex: string, opts: PartOpts = {},
): [Part, Part] {
  return [box(x0, y0, z0, x1, y1, z1, tex, opts), box(x0, y0, -z1, x1, y1, -z0, tex, opts)];
}

function applyXf(p: V3, xf: Xf, withPivot: boolean): V3 {
  let x = p[0] - (withPivot ? xf.p[0] : 0);
  let y = p[1] - (withPivot ? xf.p[1] : 0);
  let z = p[2] - (withPivot ? xf.p[2] : 0);
  if (xf.rz) {
    const c = Math.cos(xf.rz);
    const s = Math.sin(xf.rz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  if (xf.rx) {
    const c = Math.cos(xf.rx);
    const s = Math.sin(xf.rx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (xf.ry) {
    const c = Math.cos(xf.ry);
    const s = Math.sin(xf.ry);
    [x, z] = [x * c - z * s, x * s + z * c];
  }
  if (!withPivot) return [x, y, z];
  const t = xf.t ?? [0, 0, 0];
  return [x + xf.p[0] + t[0], y + xf.p[1] + t[1], z + xf.p[2] + t[2]];
}

// --- the models ----------------------------------------------------------------

const DEG = Math.PI / 180;

/** Head turn and nod, about the neck. */
function headXf(mob: Mob, neck: V3, limit = 1): Xf {
  return rot(neck, 0, mob.headYaw * DEG * limit, mob.headPitch * DEG * limit);
}

/** The leg gait: diagonal pairs swing together. */
function gait(mob: Mob, amp = 0.6): number {
  return Math.sin(mob.phase) * amp;
}

/** Four legs hanging from hips at the given corners. */
function legs4(
  mob: Mob, tex: string, fx: number, bx: number, z: number, top: number,
  w: number, amp = 0.6, uv?: [number, number],
): Part[] {
  const s = gait(mob, amp);
  const out: Part[] = [];
  const corners: Array<[number, number, number]> = [[fx, z, s], [fx, -z, -s], [bx, z, -s], [bx, -z, s]];
  for (const [x, zz, swing] of corners) {
    const leg = box(x - w / 2, 0, zz - w / 2, x + w / 2, top, zz + w / 2, tex, { uv });
    leg.xf.push(rot([x, top, zz], 0, 0, swing));
    out.push(leg);
  }
  return out;
}

function pig(mob: Mob): Part[] {
  const neck: V3 = [8, 10, 0];
  const head = pose([
    box(8, 6, -4, 15, 14, 4, 'mob_pig_hide', { faces: { front: 'mob_pig_face' }, uv: [3, 2] }),
    box(15, 6.5, -2.5, 16.5, 10, 2.5, 'mob_pig_hide', { faces: { front: 'mob_pig_snout' } }),
    ...pair(9.5, 13.5, 2, 12, 14.5, 4.5, 'mob_pig_ear'),
  ], headXf(mob, neck));
  // The ears flop forward over the eyes.
  head[2].xf.unshift(rot([11, 14, 3], 0.25, 0, -0.35));
  head[3].xf.unshift(rot([11, 14, -3], -0.25, 0, -0.35));
  const wag = Math.sin(mob.age * 6) * 0.3;
  return [
    box(-8, 5, -5, 8, 13, 5, 'mob_pig_hide'),
    ...head,
    ...legs4(mob, 'mob_pig_hide', 5, -5, 3, 5, 4, 0.7, [0, 11]),
    // A curly tail: a stub and a curl, wagging.
    ...pose([
      box(-9, 10, -0.5, -8, 12, 0.5, 'mob_pig_ear'),
      box(-10, 11, -0.5, -9, 13, 0.5, 'mob_pig_ear'),
      box(-9.5, 12.5, -0.5, -8.5, 13.5, 0.5, 'mob_pig_ear'),
    ], rot([-8, 11, 0], 0, wag, 0)),
  ];
}

function cow(mob: Mob): Part[] {
  const neck: V3 = [9, 18, 0];
  const head = pose([
    box(9, 13, -4, 16, 21, 4, 'mob_cow_head', { faces: { front: 'mob_cow_face' } }),
    box(16, 13, -3, 17.5, 16.5, 3, 'mob_cow_muzzle', { faces: { front: 'mob_cow_nose' } }),
    // Horns curve up and out from the crown.
    ...pair(11.5, 19.5, 4, 13.5, 21, 6, 'mob_horn'),
    ...pair(11.8, 21, 5, 13.2, 23, 6.2, 'mob_horn'),
    ...pair(10, 18, 4, 12, 19, 5.5, 'mob_cow_ear'),
  ], headXf(mob, neck));
  // The tail switches at flies.
  const tail = box(-10, 11, -0.6, -9, 21, 0.6, 'mob_cow_hide', { uv: [12, 0] });
  tail.xf.push(rot([-9.5, 21, 0], Math.sin(mob.age * 2.2) * 0.25, 0, 0.1));
  return [
    box(-9, 12, -6, 9, 22, 6, 'mob_cow_hide'),
    ...head,
    box(-4, 10, -2.5, 1, 12, 2.5, 'mob_udder'),
    ...legs4(mob, 'mob_cow_leg', 6, -6, 3.5, 12, 4, 0.55),
    tail,
  ];
}

function sheep(mob: Mob): Part[] {
  const neck: V3 = [8, 16, 0];
  const woolly = !mob.sheared;
  const head = pose([
    box(7, 12, -3, 14, 19, 3, 'mob_sheep_skin', { faces: { front: 'mob_sheep_face' } }),
    ...pair(9, 16, 3, 11, 17, 5, 'mob_sheep_skin'),
    ...(woolly ? [box(6.5, 17, -3.6, 12, 20.5, 3.6, 'mob_wool')] : []),
  ], headXf(mob, neck));
  head[1].xf.unshift(rot([10, 16.5, 3], 0.4, 0, 0));
  head[2].xf.unshift(rot([10, 16.5, -3], -0.4, 0, 0));
  // Grazing: now and then the head drops to the grass.
  const graze = mob.state === 'idle' && Math.sin(mob.age * 0.7 + mob.id) > 0.6;
  if (graze) pose(head, rot(neck, 0, 0, -0.9));
  const body = woolly
    ? [
      box(-8.5, 9.5, -6.5, 8.5, 20.5, 6.5, 'mob_wool'),
      // A clump over the rump so the fleece is not a crate.
      box(-9.5, 12, -5, -8.5, 19, 5, 'mob_wool'),
    ]
    : [box(-7, 11, -4.5, 7, 18, 4.5, 'mob_sheep_shorn')];
  const legs = legs4(mob, 'mob_sheep_leg', 5, -5, 3, 11, 3, 0.55);
  if (woolly) {
    // Woolly tops to the legs, moving with them.
    for (const leg of legs.slice(0, 4)) {
      const [x, , z] = leg.xf[0].p;
      const cuff = box(x - 2, 8, z - 2, x + 2, 11, z + 2, 'mob_wool');
      cuff.xf.push(leg.xf[0]);
      legs.push(cuff);
    }
  }
  return [...body, ...head, ...legs];
}

function chicken(mob: Mob): Part[] {
  // The head bobs with each step, the way a hen's does.
  const bob = Math.sin(mob.phase * 2) * 0.9;
  const neck: V3 = [3, 10, 0];
  const head = pose([
    box(2 + bob, 9, -2, 5.5 + bob, 15, 2, 'mob_chicken', { faces: { front: 'mob_chicken_face' } }),
    box(5.5 + bob, 11.5, -1, 7.5 + bob, 13, 1, 'mob_beak'),
    box(5.2 + bob, 9.5, -0.6, 6.2 + bob, 11.5, 0.6, 'mob_wattle'),
    box(2.5 + bob, 15, -0.5, 5 + bob, 16, 0.5, 'mob_wattle'),
  ], headXf(mob, neck));
  // Wings flap when it is off the ground or running.
  const flapping = !mob.onGround || mob.state === 'flee';
  const flap = flapping ? 0.3 + Math.abs(Math.sin(mob.age * 22)) * 0.9 : 0;
  const [rightWing, leftWing] = pair(-3, 6, 3, 2, 10, 4, 'mob_chicken_wing');
  rightWing.xf.push(rot([0, 10, 3], -flap, 0, 0));
  leftWing.xf.push(rot([0, 10, -3], flap, 0, 0));
  const s = gait(mob, 0.8);
  const legs: Part[] = [];
  for (const [z, swing] of [[1.5, s], [-1.5, -s]] as const) {
    const leg = [
      box(-0.5, 0.8, z - 0.5, 0.5, 5, z + 0.5, 'mob_chicken_leg'),
      box(-0.5, 0, z - 1.5, 2.5, 0.8, z + 1.5, 'mob_chicken_leg'),
    ];
    legs.push(...pose(leg, rot([0, 5, z], 0, 0, swing)));
  }
  return [
    box(-4, 5, -3, 3, 11, 3, 'mob_chicken'),
    box(-5, 8.5, -2, -4, 12, 2, 'mob_chicken_wing'),
    ...head, rightWing, leftWing, ...legs,
  ];
}

/** Humanoid legs: hips at y 12, four wide. */
function humanLegs(mob: Mob, tex: string, amp = 0.7, width = 4, gap = 0): Part[] {
  const s = gait(mob, amp);
  const half = width / 2;
  const [r, l] = [
    box(-half, 0, gap, half, 12, gap + width, tex),
    box(-half, 0, -gap - width, half, 12, -gap, tex),
  ];
  r.xf.push(rot([0, 12, gap + half], 0, 0, s));
  l.xf.push(rot([0, 12, -gap - half], 0, 0, -s));
  return [r, l];
}

function zombie(mob: Mob): Part[] {
  // A shambling lurch: leaning forward, rocking side to side as it walks.
  const lean = rot([0, 12, 0], Math.sin(mob.phase) * 0.06, 0, -0.12);
  const sway = Math.sin(mob.age * 1.8) * 0.08;
  const reach = Math.PI / 2 - 0.1 + mob.attackAnim * 0.35;
  const arms: Part[] = [];
  for (const side of [1, -1]) {
    const arm = box(-2, 10, side > 0 ? 4 : -8, 2, 22, side > 0 ? 8 : -4, 'mob_zombie_arm');
    arm.xf.push(rot([0, 22, side * 6], 0, 0, reach + sway * side + Math.sin(mob.phase) * 0.12 * side));
    arms.push(arm);
  }
  const head = pose([
    box(-4, 24, -4, 4, 32, 4, 'mob_zombie_head', { faces: { front: 'mob_zombie_face' } }),
  ], headXf(mob, [0, 24, 0], 0.7));
  return [
    ...humanLegs(mob, 'mob_zombie_legs', 0.6),
    ...pose([
      box(-2, 12, -4, 2, 24, 4, 'mob_zombie_shirt'),
      ...arms, ...head,
    ], lean),
  ];
}

function skeleton(mob: Mob): Part[] {
  const aiming = mob.state === 'chase';
  const draw = mob.attackAnim;
  // Bow arm straight out when it has you in sight, the other hand at the string.
  const bowArm = box(-1, 12, -8, 1, 24, -6, 'mob_bone');
  const drawArm = box(-1, 12, 6, 1, 24, 8, 'mob_bone');
  let bow: Part[];
  if (aiming) {
    bowArm.xf.push(rot([0, 23, -7], 0, 0, Math.PI / 2));
    drawArm.xf.push(rot([0, 23, 7], 0, -0.55 + draw * 0.2, Math.PI / 2 - 0.1));
    // Held upright at the fist, tips curving back toward the archer.
    bow = [
      box(11, 18, -7.5, 12, 28, -6.5, 'mob_bow'),
      box(10, 27.5, -7.5, 11, 31, -6.5, 'mob_bow'),
      box(10, 15, -7.5, 11, 18.5, -6.5, 'mob_bow'),
      box(9.6 - draw * 3, 16, -7.2, 10 - draw * 3, 30, -6.8, 'mob_bowstring'),
    ];
  } else {
    const swing = Math.sin(mob.phase) * 0.5;
    const hold = rot([0, 23, -7], 0, 0, swing);
    bowArm.xf.push(hold);
    drawArm.xf.push(rot([0, 23, 7], 0, 0, -swing));
    // Carried low, along the arm.
    bow = pose([
      box(1, 6, -7.5, 2, 17, -6.5, 'mob_bow'),
      box(0, 16.5, -7.5, 1, 19, -6.5, 'mob_bow'),
      box(0, 4, -7.5, 1, 6.5, -6.5, 'mob_bow'),
      box(-0.4, 5, -7.2, 0, 18, -6.8, 'mob_bowstring'),
    ], hold);
  }
  const head = pose([
    box(-4, 24, -4, 4, 32, 4, 'mob_skull', { faces: { front: 'mob_skull_face' } }),
  ], headXf(mob, [0, 24, 0]));
  return [
    ...humanLegs(mob, 'mob_bone', 0.6, 2, 1),
    box(-1.5, 11, -3.5, 1.5, 13, 3.5, 'mob_bone'),
    box(-0.8, 13, -0.8, 0.8, 24, 0.8, 'mob_bone'),
    box(-2, 16, -3.5, 2, 23, 3.5, 'mob_ribs'),
    box(-1, 23, -5, 1, 24.5, 5, 'mob_bone'),
    bowArm, drawArm, ...bow, ...head,
  ];
}

function spider(mob: Mob): Part[] {
  const headParts = pose([
    box(4, 3.5, -4, 10, 10.5, 4, 'mob_spider_head', { faces: { front: 'mob_spider_face' } }),
    // Eyes catch the light even in a cave.
    box(10, 7.5, -3, 10.3, 9, -1, 'mob_spider_eye', { glow: true }),
    box(10, 7.5, 1, 10.3, 9, 3, 'mob_spider_eye', { glow: true }),
    box(10, 9.3, -1.2, 10.3, 10.1, 1.2, 'mob_spider_eye', { glow: true }),
    // Fangs.
    box(9.5, 2.5, -2, 10.5, 4, -1, 'mob_fang'),
    box(9.5, 2.5, 1, 10.5, 4, 2, 'mob_fang'),
  ], headXf(mob, [4, 7, 0], 0.5));
  if (mob.attackAnim > 0) pose(headParts.slice(4), rot([10, 4, 0], 0, 0, -mob.attackAnim * 0.6));

  const legs: Part[] = [];
  const hips = [3.5, 1.5, -0.5, -2.5];
  const spread = [0.75, 0.25, -0.25, -0.75];
  for (let i = 0; i < 4; i++) {
    for (const side of [1, -1]) {
      // Alternating tetrapod gait: legs 0 and 2 on one side move with 1 and 3 on the other.
      const beat = mob.phase * 1.6 + (((i + (side > 0 ? 0 : 1)) % 2) ? Math.PI : 0);
      const swing = Math.sin(beat) * 0.35;
      const lift = Math.max(0, Math.cos(beat)) * 0.3;
      const hip: V3 = [hips[i], 7, side * 3.5];
      const knee: V3 = [hips[i], 7, side * 11.5];
      const thigh = box(hips[i] - 0.8, 6.2, side > 0 ? 3.5 : -11.5, hips[i] + 0.8, 7.8, side > 0 ? 11.5 : -3.5, 'mob_spider_leg');
      const shin = box(hips[i] - 0.7, -5, side > 0 ? 10.8 : -12.2, hips[i] + 0.7, 7, side > 0 ? 12.2 : -10.8, 'mob_spider_leg');
      const legYaw = rot(hip, 0, -side * spread[i] + swing, 0);
      const legLift = rot(hip, -side * (0.62 + lift), 0, 0);
      // Shins angle back down, a little outward of vertical.
      shin.xf.push(rot(knee, side * (0.62 + lift) - side * 0.25, 0, 0), legLift, legYaw);
      thigh.xf.push(legLift, legYaw);
      legs.push(thigh, shin);
    }
  }
  const breathe = Math.sin(mob.age * 3) * 0.3;
  const parts = [
    box(-14, 3, -6, -2, 13 + breathe, 6, 'mob_spider_abdomen', { faces: { top: 'mob_spider_back' } }),
    box(-3, 4, -4, 4.5, 10, 4, 'mob_spider_head', { uv: [4, 4] }),
    ...headParts,
    ...legs,
  ];
  if (mob.climbing) pose(parts, rot([-2, 6, 0], 0, 0, 1.1));
  return parts;
}

function boomshroom(mob: Mob): Part[] {
  const s = gait(mob, 0.7);
  const legs: Part[] = [];
  for (const [x, z, swing] of [[2.5, 2.5, s], [2.5, -2.5, -s], [-2.5, 2.5, -s], [-2.5, -2.5, s]] as const) {
    const leg = box(x - 1.5, 0, z - 1.5, x + 1.5, 4, z + 1.5, 'mob_shroom_foot');
    leg.xf.push(rot([x, 4, z], 0, 0, swing));
    legs.push(leg);
  }
  // The cap wobbles as it creeps, and trembles as the fuse burns.
  const tremble = mob.fuse > 0 ? Math.sin(mob.age * 60) * 0.05 : 0;
  const cap = pose([
    box(-8, 13, -8, 8, 14, 8, 'mob_shroom_gills'),
    box(-9, 14, -9, 9, 19, 9, 'mob_shroom_cap', { faces: { top: 'mob_shroom_cap_top' } }),
    box(-6.5, 19, -6.5, 6.5, 21, 6.5, 'mob_shroom_cap', { uv: [2, 3] }),
  ], rot([0, 13, 0], Math.sin(mob.phase) * 0.05 + tremble, 0, tremble));
  return [
    box(-4, 4, -4, 4, 13.5, 4, 'mob_shroom_stem', { faces: { front: 'mob_shroom_face' } }),
    ...cap,
    ...legs,
  ];
}

function slime(mob: Mob): Part[] {
  const h = 8 * mob.size;
  const half = h / 2;
  const core = h * 0.3;
  const eye = Math.max(1, mob.size * 0.8);
  return [
    // Inside first: the shell is drawn over it.
    box(-core, h * 0.18, -core, core, h * 0.18 + core * 2, core, 'mob_slime_core'),
    box(half - 1.6, h * 0.55, -half * 0.55, half - 0.6, h * 0.55 + eye * 1.5, -half * 0.55 + eye, 'mob_slime_eye'),
    box(half - 1.6, h * 0.55, half * 0.55 - eye, half - 0.6, h * 0.55 + eye * 1.5, half * 0.55, 'mob_slime_eye'),
    box(half - 1.6, h * 0.3, -eye * 0.5, half - 0.6, h * 0.3 + Math.max(0.6, eye * 0.5), eye * 0.5, 'mob_slime_eye'),
    box(-half, 0, -half, half, h, half, 'mob_slime_shell', { late: true }),
  ];
}

function wolf(mob: Mob): Part[] {
  const sitting = mob.sitting;
  const angry = mob.angered && !mob.tamed;
  const neck: V3 = [6, 11, 0];
  const mouth = mob.attackAnim * 0.5;
  const head = pose([
    box(6, 8, -3, 12, 14, 3, 'mob_wolf_fur', {
      faces: { front: angry ? 'mob_wolf_face_angry' : 'mob_wolf_face' }, uv: [2, 2],
    }),
    box(12, 9.5, -1.5, 15, 11.5, 1.5, 'mob_wolf_muzzle', { faces: { front: 'mob_wolf_nose' } }),
    ...pose([box(12, 8, -1.3, 14.5, 9.5, 1.3, 'mob_wolf_muzzle')], rot([12, 9.5, 0], 0, 0, -mouth)),
    ...pair(7, 14, 1, 9, 16.5, 2.8, 'mob_wolf_fur', { uv: [0, 12] }),
  ], headXf(mob, neck));
  // Tail: up and waving when happy, stiff when angry, low when wary.
  const tailLift = mob.tamed ? 0.9 : angry ? 0.3 : -0.2;
  const tailWag = mob.tamed ? Math.sin(mob.age * 10) * 0.5 : 0;
  const tail = box(-13, 10, -1, -7, 12, 1, 'mob_wolf_fur', { uv: [4, 13] });
  tail.xf.push(rot([-7, 11, 0], 0, tailWag, sitting ? -0.4 : tailLift - 0.6));

  let legs: Part[];
  if (sitting) {
    // Haunches down, front legs straight.
    legs = [
      ...pair(4, 0, 1.2, 6, 8, 3.2, 'mob_wolf_fur', { uv: [0, 8] }),
      ...pair(-7, 0, 1.5, -2, 3, 3.8, 'mob_wolf_fur', { uv: [0, 8] }),
    ];
  } else {
    legs = legs4(mob, 'mob_wolf_fur', 4.5, -5, 2.2, 8, 2, 0.7, [0, 8]);
  }
  const body: Part[] = [
    box(-7, 7, -3, 5, 13, 3, 'mob_wolf_fur'),
    box(1, 7, -4, 6.5, 14.5, 4, 'mob_wolf_mane'),
    ...(mob.tamed ? [box(5.6, 8.4, -3.3, 7, 14, 3.3, 'mob_collar')] : []),
    ...head,
  ];
  // Sitting: the body tips up about the hips and settles onto the haunches.
  if (sitting) pose([...body, tail], rot([-6, 7, 0], 0, 0, 0.5, [0, -3.5, 0]));
  return [...body, tail, ...legs];
}

function bat(mob: Mob): Part[] {
  const flap = Math.sin(mob.age * 20) * 0.9;
  const wings: Part[] = [];
  for (const side of [1, -1]) {
    const inner = box(-3, 11.6, side > 0 ? 1.5 : -8, 2, 12.4, side > 0 ? 8 : -1.5, 'mob_bat_wing');
    const outer = box(-2.5, 11.6, side > 0 ? 8 : -14, 1, 12.4, side > 0 ? 14 : -8, 'mob_bat_wing', { uv: [4, 4] });
    const shoulder = rot([0, 12, side * 1.5], side * flap, 0, 0);
    outer.xf.push(rot([0, 12, side * 8], side * flap * 0.6, 0, 0), shoulder);
    inner.xf.push(shoulder);
    wings.push(inner, outer);
  }
  return [
    box(-1.5, 6, -1.5, 1.5, 12.5, 1.5, 'mob_bat_fur'),
    ...pose([
      box(-2, 12.5, -2, 2, 16.5, 2, 'mob_bat_fur', { faces: { front: 'mob_bat_face' }, uv: [4, 0] }),
      ...pair(-1, 16.5, 0.6, 0.5, 18.5, 1.8, 'mob_bat_ear'),
    ], headXf(mob, [0, 12.5, 0], 0.5)),
    ...pair(-0.5, 4, 0.3, 0.5, 6, 1.2, 'mob_bat_ear'),
    ...wings,
  ];
}

function rabbit(mob: Mob): Part[] {
  // Airborne, the body stretches out; on the ground it bunches up.
  const leap = mob.onGround ? 0 : Math.max(-0.4, Math.min(0.4, mob.vy * 0.08));
  const head = pose([
    box(2, 4, -2, 7, 8.5, 2, 'mob_rabbit_fur', { faces: { front: 'mob_rabbit_face' }, uv: [3, 3] }),
    ...pose(pair(3, 8.5, 0.4, 4.5, 13, 1.8, 'mob_rabbit_ear'), rot([3.75, 8.5, 0], 0, 0, 0.35)),
  ], headXf(mob, [3, 6, 0], 0.6));
  head[1].xf.unshift(rot([3.75, 8.5, 1.1], 0.2, 0, 0));
  head[2].xf.unshift(rot([3.75, 8.5, -1.1], -0.2, 0, 0));
  const kick = mob.onGround ? 0 : -0.7;
  const hind = pose([
    ...pair(-4, 0, 1.2, 1, 1.5, 3.2, 'mob_rabbit_fur', { uv: [6, 10] }),
    ...pair(-4, 1.5, 1.5, -0.5, 4, 3.4, 'mob_rabbit_fur', { uv: [6, 6] }),
  ], rot([-2, 3, 0], 0, 0, kick));
  const fore = pose(pair(1.8, 0, 0.5, 3, 2.5, 1.5, 'mob_rabbit_fur', { uv: [10, 10] }), rot([2.4, 2.5, 0], 0, 0, -kick));
  return pose([
    box(-4.5, 1.5, -2.5, 3, 6.5, 2.5, 'mob_rabbit_fur'),
    box(-5.5, 3.5, -1.2, -4.5, 5.5, 1.2, 'mob_rabbit_tail'),
    ...head, ...hind, ...fore,
  ], rot([0, 2, 0], 0, 0, leap));
}

function fish(mob: Mob): Part[] {
  const beat = Math.sin(mob.phase * 3 + mob.age * (mob.inWater ? 4 : 14)) * 0.45;
  const tail = pose([
    box(-9, 0.5, -0.3, -5, 6.5, 0.3, 'mob_fish_fin'),
  ], rot([-5, 3.5, 0], 0, beat, 0));
  const parts = [
    box(-5, 1, -1.5, 3, 6, 1.5, 'mob_fish_scales'),
    box(3, 1.5, -1.3, 6, 5.5, 1.3, 'mob_fish_scales', {
      faces: { right: 'mob_fish_eye', left: 'mob_fish_eye', front: 'mob_fish_mouth' }, uv: [10, 2],
    }),
    box(-2, 6, -0.25, 2, 8, 0.25, 'mob_fish_fin'),
    ...pair(1, 1.5, 1.5, 3, 3, 2.5, 'mob_fish_fin'),
    ...tail,
  ];
  // Out of the water it lies on its side and thrashes.
  if (!mob.inWater) pose(parts, rot([0, 1.5, 0], Math.PI / 2 + beat * 0.2, 0, 0));
  return parts;
}

function blaze(mob: Mob): Part[] {
  const rods: Part[] = [];
  // Two rings of rods turning opposite ways around the core.
  const rings: Array<[number, number, number, number]> = [
    [4, 8, 13, 1.6], [4, 5.5, 5, -2.2],
  ];
  for (const [count, radius, y, speed] of rings) {
    for (let i = 0; i < count; i++) {
      const a = mob.age * speed + (i / count) * Math.PI * 2 + (speed < 0 ? Math.PI / 4 : 0);
      const cx = Math.cos(a) * radius;
      const cz = Math.sin(a) * radius;
      const bobY = Math.sin(mob.age * 3 + i) * 1;
      rods.push(box(cx - 1, y + bobY, cz - 1, cx + 1, y + 8 + bobY, cz + 1, 'mob_blaze_rod', { glow: true }));
    }
  }
  const head = pose([
    box(-4, 20, -4, 4, 28, 4, 'mob_blaze_skin', { faces: { front: 'mob_blaze_face' }, glow: true }),
  ], headXf(mob, [0, 20, 0]));
  return [
    box(-1.5, 12, -1.5, 1.5, 20, 1.5, 'mob_blaze_rod', { glow: true }),
    ...head, ...rods,
  ];
}

function enderman(mob: Mob): Part[] {
  const angry = mob.angered;
  const s = gait(mob, 0.45);
  const jaw = angry ? 2.5 : 0;
  const head = pose([
    box(-4, 44, -4, 4, 50, 4, 'mob_ender_skin', { faces: { front: angry ? 'mob_ender_face_angry' : 'mob_ender_face' } }),
    box(-4, 42 - jaw, -4, 4, 44 - jaw, 4, 'mob_ender_skin', { faces: { front: 'mob_ender_jaw' }, uv: [4, 6] }),
    ...(angry ? [box(-3.5, 42 - jaw, -3.5, 3.5, 44, 3.5, 'mob_ender_mouth')] : []),
  ], headXf(mob, [0, 42, 0]));
  const arms: Part[] = [];
  for (const side of [1, -1]) {
    const arm = box(-1, 12, side > 0 ? 4 : -6, 1, 42, side > 0 ? 6 : -4, 'mob_ender_skin');
    arm.xf.push(rot([0, 41, side * 5], side * 0.06, 0,
      -s * side + (angry ? 0.5 + mob.attackAnim * 0.6 : 0)));
    arms.push(arm);
  }
  const legs: Part[] = [];
  for (const side of [1, -1]) {
    const leg = box(-1, 0, side > 0 ? 1 : -3, 1, 30, side > 0 ? 3 : -1, 'mob_ender_skin');
    leg.xf.push(rot([0, 30, side * 2], 0, 0, s * side));
    legs.push(leg);
  }
  return [
    box(-2, 30, -4, 2, 42, 4, 'mob_ender_skin', { uv: [2, 0] }),
    ...head, ...arms, ...legs,
  ];
}

function dragon(mob: Mob): Part[] {
  const flap = Math.sin(mob.phase);
  const parts: Part[] = [
    box(-18, 14, -10, 18, 30, 10, 'mob_dragon_scale'),
    box(-16, 12, -8, 14, 14, 8, 'mob_dragon_belly'),
  ];
  // Spines down the back.
  for (let x = -14; x <= 12; x += 6) parts.push(box(x, 30, -1, x + 2.5, 33, 1, 'mob_dragon_spine'));

  // A neck of five segments rising forward in an S, then the head.
  let nx = 18;
  let ny = 24;
  let ang = 0.35;
  const neckSway = Math.sin(mob.age * 1.3) * 0.08;
  for (let i = 0; i < 5; i++) {
    const seg = box(nx, ny - 4, -4, nx + 7, ny + 4, 4, 'mob_dragon_scale', { uv: [i * 2, 0] });
    seg.xf.push(rot([nx, ny, 0], 0, neckSway * i, ang));
    parts.push(seg, box(nx + 2, ny + 4, -0.8, nx + 4.5, ny + 6.5, 0.8, 'mob_dragon_spine'));
    parts[parts.length - 1].xf.push(rot([nx, ny, 0], 0, neckSway * i, ang));
    nx += Math.cos(ang) * 7;
    ny += Math.sin(ang) * 7;
    ang -= 0.16;
  }
  const bite = mob.attackAnim * 0.6 + 0.08;
  const head = pose([
    box(nx, ny - 5, -6, nx + 12, ny + 4, 6, 'mob_dragon_scale', { faces: { front: 'mob_dragon_face' } }),
    box(nx + 12, ny - 3, -4.5, nx + 20, ny + 1, 4.5, 'mob_dragon_scale', { faces: { front: 'mob_dragon_snout' }, uv: [4, 4] }),
    ...pose([box(nx + 10, ny - 7, -4, nx + 19, ny - 4, 4, 'mob_dragon_belly', { faces: { top: 'mob_dragon_teeth' } })],
      rot([nx + 10, ny - 5, 0], 0, 0, -bite)),
    ...pair(nx + 1, ny + 4, 2.5, nx + 3, ny + 9, 4.5, 'mob_dragon_horn'),
  ], rot([nx, ny, 0], 0, neckSway * 5 + mob.headYaw * DEG * 0.4, mob.headPitch * DEG * 0.4 - 0.2));
  parts.push(...head);

  // Tail: eight tapering segments, swaying behind.
  let tx = -18;
  let ty = 22;
  for (let i = 0; i < 8; i++) {
    const r = 6 - i * 0.6;
    const sway = Math.sin(mob.age * 1.6 - i * 0.6) * 0.12 * i;
    const seg = box(tx - 7, ty - r, -r, tx, ty + r, r, 'mob_dragon_scale', { uv: [i, 2] });
    seg.xf.push(rot([tx, ty, 0], 0, sway, 0.04));
    parts.push(seg);
    tx -= 7 * Math.cos(sway);
    ty -= 0.6;
  }

  // Wings: an inner panel from the shoulder and an outer one hinged at the
  // wrist, so the stroke folds instead of flapping like a board.
  for (const side of [1, -1]) {
    const shoulder: V3 = [6, 28, side * 10];
    const wrist: V3 = [6, 28, side * 38];
    const beat = rot(shoulder, side * flap * 0.55, 0, 0);
    const bone1 = box(3, 27, side > 0 ? 10 : -38, 9, 30, side > 0 ? 38 : -10, 'mob_dragon_scale');
    const skin1 = box(-16, 28.2, side > 0 ? 10 : -38, 4, 28.8, side > 0 ? 38 : -10, 'mob_dragon_wing');
    const fold = rot(wrist, side * (flap * 0.45 - 0.1), 0, 0);
    const bone2 = box(4, 27.5, side > 0 ? 38 : -66, 8, 29.5, side > 0 ? 66 : -38, 'mob_dragon_scale');
    const skin2 = box(-20, 28.2, side > 0 ? 38 : -66, 5, 28.8, side > 0 ? 66 : -38, 'mob_dragon_wing', { uv: [3, 3] });
    bone1.xf.push(beat);
    skin1.xf.push(beat);
    bone2.xf.push(fold, beat);
    skin2.xf.push(fold, beat);
    parts.push(bone1, skin1, bone2, skin2);
  }

  // Legs tucked up under the body in flight.
  for (const [x, z] of [[10, 8], [10, -8], [-12, 8], [-12, -8]] as const) {
    const leg = box(x - 3, 2, z - 3, x + 3, 14, z + 3, 'mob_dragon_scale', { uv: [6, 4] });
    leg.xf.push(rot([x, 14, z], 0, 0, 0.6));
    parts.push(leg, box(x + 2, 0, z - 3, x + 7, 2, z + 3, 'mob_dragon_belly'));
    parts[parts.length - 1].xf.push(rot([x, 14, z], 0, 0, 0.6));
  }
  return parts;
}

function partsFor(mob: Mob): Part[] {
  switch (mob.kind) {
    case MobKind.Pig: return pig(mob);
    case MobKind.Cow: return cow(mob);
    case MobKind.Sheep: return sheep(mob);
    case MobKind.Chicken: return chicken(mob);
    case MobKind.Zombie: return zombie(mob);
    case MobKind.Blaze: return blaze(mob);
    case MobKind.Enderman: return enderman(mob);
    case MobKind.EnderDragon: return dragon(mob);
    case MobKind.Spider: return spider(mob);
    case MobKind.Skeleton: return skeleton(mob);
    case MobKind.Boomshroom: return boomshroom(mob);
    case MobKind.Slime:
    case MobKind.MediumSlime:
    case MobKind.SmallSlime: return slime(mob);
    case MobKind.Wolf: return wolf(mob);
    case MobKind.Bat: return bat(mob);
    case MobKind.Rabbit: return rabbit(mob);
    case MobKind.Fish: return fish(mob);
  }
}

// --- meshing -----------------------------------------------------------------------

/** Corners of each face of a unit box, in the order top, bottom, +z, -z, +x, -x. */
const FACE_CORNERS: Array<Array<[number, number, number]>> = [
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
];
const FACE_NORMALS: V3[] = [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];
/** Texture coordinates per corner: top faces map u along x and v along z. */
const UV_TOP = [0, 0, 0, 1, 1, 1, 1, 0];
const UV_SIDE = [0, 1, 1, 1, 1, 0, 0, 0];
/** Which box extents a face's u and v run along, as axis indices. */
const FACE_AXES: Array<[number, number]> = [[0, 2], [0, 2], [0, 1], [0, 1], [2, 1], [2, 1]];

/** Brightness by the direction a face points, after posing: the terrain's own spread. */
function faceShade(n: V3): number {
  return 0.8 + 0.2 * n[1] - (n[1] < 0 ? 0.1 : 0) + 0.04 * Math.abs(n[2]) - 0.04 * Math.abs(n[0]);
}

interface Emit {
  verts: number[];
  indices: number[];
}

interface Frame {
  /** Mob origin and heading. */
  x: number;
  y: number;
  z: number;
  cos: number;
  sin: number;
  /** Uniform scale about the feet, and the death roll. */
  scale: number;
  roll: Xf | null;
  light: number;
  height: number;
}

function transformPoint(part: Part, local: V3, frame: Frame): V3 {
  let p = local;
  for (const xf of part.xf) p = applyXf(p, xf, true);
  if (frame.roll) p = applyXf(p, frame.roll, true);
  const x = p[0] * P * frame.scale;
  const y = p[1] * P * frame.scale;
  const z = p[2] * P * frame.scale;
  return [frame.x + x * frame.cos - z * frame.sin, frame.y + y, frame.z + x * frame.sin + z * frame.cos];
}

function transformNormal(part: Part, n: V3, frame: Frame): V3 {
  let p = n;
  for (const xf of part.xf) p = applyXf(p, xf, false);
  if (frame.roll) p = applyXf(p, frame.roll, false);
  return [p[0] * frame.cos - p[2] * frame.sin, p[1], p[0] * frame.sin + p[2] * frame.cos];
}

function emitPart(
  out: Emit, atlas: Atlas, part: Part, frame: Frame,
  override: string | null = null, inflate = 0, brightness = 1,
): void {
  const lo: V3 = [part.lo[0] - inflate, part.lo[1] - inflate, part.lo[2] - inflate];
  const hi: V3 = [part.hi[0] + inflate, part.hi[1] + inflate, part.hi[2] + inflate];
  const size: V3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const light = part.glow ? 1 : frame.light;

  for (let f = 0; f < 6; f++) {
    const decal = override ?? part.faces?.[FACES[f]] ?? null;
    const [u0, v0, u1, v1] = atlas.uv(decal ?? part.tex);
    let tu0 = u0;
    let tv0 = v0;
    let tu1 = u1;
    let tv1 = v1;
    if (!decal) {
      // One texel per sixteenth: take a window of the skin the size of the face.
      const [au, av] = FACE_AXES[f];
      const [ou, ov] = part.uv ?? [0, 0];
      const w = Math.min(16, Math.max(0.5, size[au]));
      const h = Math.min(16, Math.max(0.5, size[av]));
      const su = Math.min(ou, 16 - w);
      const sv = Math.min(ov, 16 - h);
      tu0 = u0 + (u1 - u0) * (su / 16);
      tu1 = u0 + (u1 - u0) * ((su + w) / 16);
      tv0 = v0 + (v1 - v0) * (sv / 16);
      tv1 = v0 + (v1 - v0) * ((sv + h) / 16);
    }
    const uvs = f === 0 ? UV_TOP : UV_SIDE;
    const n = transformNormal(part, FACE_NORMALS[f], frame);
    const shade = faceShade(n) * light * brightness;
    const first = out.verts.length / FLOATS_PER_VERTEX;

    for (let c = 0; c < 4; c++) {
      const [cx, cy, cz] = FACE_CORNERS[f][c];
      const local: V3 = [
        lo[0] + cx * size[0],
        lo[1] + cy * size[1],
        lo[2] + cz * size[2],
      ];
      const w = transformPoint(part, local, frame);
      // A little darker toward the ground, the way the terrain's corners are.
      const ground = Math.max(0, Math.min(1, (w[1] - frame.y) / Math.max(0.5, frame.height)));
      out.verts.push(
        w[0], w[1], w[2],
        uvs[c * 2] === 0 ? tu0 : tu1,
        uvs[c * 2 + 1] === 0 ? tv0 : tv1,
        shade * (0.84 + 0.16 * ground), 1,
      );
    }
    out.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
}

export interface WorldMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

/** Pose for this frame's corpse: tipped over onto its side, shrinking at the end. */
function deathPose(mob: Mob): { roll: Xf | null; scale: number; fade: number } {
  if (!mob.dead || mob.def.boss) return { roll: null, scale: 1, fade: 1 };
  const t = Math.min(1, mob.deathTime / DEATH_TIME);
  const tip = Math.min(1, t / 0.55);
  const eased = 1 - (1 - tip) * (1 - tip);
  const halfWidth = (mob.def.width / 2) / P;
  const late = Math.max(0, (t - 0.6) / 0.4);
  return {
    roll: rot([0, 0, halfWidth], eased * Math.PI / 2, 0, 0),
    scale: 1 - late * 0.85,
    fade: 1 - t * 0.6,
  };
}

/** Swelling while a fuse burns, and a slime's squash and stretch. */
function bodyScale(mob: Mob): number {
  if (mob.fuse > 0) {
    const f = Math.min(1, mob.fuse / FUSE_TIME);
    return 1 + f * 0.22 + Math.sin(mob.age * 30) * 0.03 * f;
  }
  return 1;
}

export function buildMobMesh(atlas: Atlas, mobs: Mob[]): WorldMesh {
  const solid: Emit = { verts: [], indices: [] };
  const late: Emit = { verts: [], indices: [] };

  for (const mob of mobs) {
    if (mob.gone) continue;
    if (mob.dead && (mob.def.boss || mob.deathTime >= DEATH_TIME)) continue;
    const yaw = (mob.yaw * Math.PI) / 180;
    const death = deathPose(mob);
    const scale = death.scale * bodyScale(mob);
    const frame: Frame = {
      x: mob.x,
      y: mob.y + mob.yOffset,
      z: mob.z,
      cos: Math.cos(yaw),
      sin: Math.sin(yaw),
      scale,
      roll: death.roll,
      light: mob.light * death.fade,
      height: mob.def.height,
    };

    let parts = partsFor(mob);
    if (mob.def.brain === 'slime' && mob.squash > 0) {
      // Squash: flatter and wider for a moment after landing.
      const sy = 1 - mob.squash * 0.3;
      const sxz = 1 + mob.squash * 0.18;
      parts = parts.map((p) => ({
        ...p,
        lo: [p.lo[0] * sxz, p.lo[1] * sy, p.lo[2] * sxz],
        hi: [p.hi[0] * sxz, p.hi[1] * sy, p.hi[2] * sxz],
      }));
    }

    for (const part of parts) emitPart(part.late ? late : solid, atlas, part, frame);

    // A hit, or death, washes the whole body red; a burning fuse blinks white.
    const red = mob.hurtTimer > 0 || mob.dead;
    const blink = mob.fuse > 0 && Math.sin(mob.age * (8 + mob.fuse * 10)) > 0;
    const overlay = red ? 'mob_hurt' : blink ? 'mob_flash' : null;
    if (overlay) {
      for (const part of parts) {
        emitPart(late, atlas, part, frame, overlay, 0.12, red ? 1 : 1.6);
      }
    }
  }

  // Translucent geometry goes last so what is behind it has already been drawn.
  const base = solid.verts.length / FLOATS_PER_VERTEX;
  const verts = solid.verts.concat(late.verts);
  const indices = solid.indices.concat(late.indices.map((i) => i + base));
  return { vertices: new Float32Array(verts), indices: new Uint32Array(indices) };
}
