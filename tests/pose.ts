/**
 * The ?pose= debug parameter. Run: npx tsx tests/pose.ts
 *
 * The point of a pose is that it is exact. A parser that half-accepts input --
 * taking "120,64" as (120, 64, 0), or "12abc" as 12 -- would put the camera
 * somewhere other than where it was asked and report success, which is worse
 * than refusing outright: the reader would trust the picture.
 */

import { MAX_PITCH, applyPose, parsePose, type Poseable } from '../client/src/pose.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`PASS  ${label}`);
  else { failures++; console.log(`FAIL  ${label}${detail ? '  -- ' + detail : ''}`); }
}

// --- what it should accept ----------------------------------------------

const full = parsePose('?pose=120,64,-30,90,-15');
check('a five-part pose parses',
  !!full && full.x === 120 && full.y === 64 && full.z === -30 &&
  full.yaw === 90 && full.pitch === -15, JSON.stringify(full));

const posOnly = parsePose('?pose=1,2,3');
check('a three-part pose parses as position only',
  !!posOnly && posOnly.x === 1 && posOnly.y === 2 && posOnly.z === 3 &&
  posOnly.yaw === undefined && posOnly.pitch === undefined, JSON.stringify(posOnly));

check('fractional coordinates survive',
  parsePose('?pose=0.5,64.25,-3.75')?.y === 64.25);

check('spaces around the numbers are tolerated',
  parsePose('?pose= 1 , 2 , 3 ')?.z === 3);

check('it reads pose from among other parameters',
  parsePose('?seed=7&pose=1,2,3&mode=creative')?.x === 1);

check('a leading ? is not required',
  parsePose('pose=4,5,6')?.x === 4);

// --- what it must refuse ------------------------------------------------
//
// Each of these is a plausible typo, and each would otherwise place the
// camera somewhere the caller did not ask for.

check('no pose parameter at all -> null', parsePose('?seed=7') === null);
check('an empty query -> null', parsePose('') === null);
check('an empty pose value -> null', parsePose('?pose=') === null);
check('two components -> null (not padded with zero)', parsePose('?pose=120,64') === null);
check('four components -> null (yaw without pitch is ambiguous)',
  parsePose('?pose=1,2,3,90') === null);
check('six components -> null', parsePose('?pose=1,2,3,4,5,6') === null);
check('a non-numeric component -> null', parsePose('?pose=1,two,3') === null);
check('a trailing-garbage number -> null', parsePose('?pose=12abc,2,3') === null);
check('a missing component -> null, not zero', parsePose('?pose=1,,3') === null);
check('Infinity -> null', parsePose('?pose=1,Infinity,3') === null);
check('NaN -> null', parsePose('?pose=1,NaN,3') === null);

// --- pitch is clamped, not rejected -------------------------------------
//
// 90 is the obvious way to write "straight down" and Player.look cannot pass
// 89.9, so meeting the caller where they are beats a lecture.

check('pitch 90 clamps to the limit', parsePose('?pose=0,0,0,0,90')?.pitch === MAX_PITCH);
check('pitch -90 clamps to the limit', parsePose('?pose=0,0,0,0,-90')?.pitch === -MAX_PITCH);
check('pitch inside the range is untouched', parsePose('?pose=0,0,0,0,-45')?.pitch === -45);

// --- applying it --------------------------------------------------------

function freshPlayer(): Poseable {
  return { x: 0, y: 80, z: 0, yaw: -90, pitch: 0, vy: -12, flying: false };
}

const p1 = freshPlayer();
applyPose(p1, { x: 10, y: 20, z: 30, yaw: 45, pitch: -20 });
check('applying moves the player', p1.x === 10 && p1.y === 20 && p1.z === 30);
check('applying sets the angles', p1.yaw === 45 && p1.pitch === -20);
check('applying stops the fall', p1.vy === 0);
check('applying switches flying on, so the camera holds', p1.flying === true);

// A position-only pose must not silently reset where the camera was aimed.
const p2 = freshPlayer();
p2.yaw = 123;
p2.pitch = -7;
applyPose(p2, { x: 1, y: 2, z: 3 });
check('a position-only pose leaves yaw alone', p2.yaw === 123);
check('a position-only pose leaves pitch alone', p2.pitch === -7);
check('a position-only pose still stops the fall', p2.vy === 0 && p2.flying === true);

// Round trip: the string a finding would be shared as.
const shared = '?pose=120.5,64,-30.25,180,-89.9';
const rt = parsePose(shared)!;
const p3 = freshPlayer();
applyPose(p3, rt);
check('a shareable URL round-trips to the exact camera',
  p3.x === 120.5 && p3.y === 64 && p3.z === -30.25 &&
  p3.yaw === 180 && p3.pitch === -89.9,
  JSON.stringify(p3));

console.log(failures === 0
  ? '\nAll pose checks passed.'
  : `\n${failures} pose check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
