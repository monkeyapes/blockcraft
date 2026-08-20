/**
 * `?pose=` -- put the camera somewhere exact, without touching the mouse.
 *
 * Rendering questions are answered by looking at one specific surface from one
 * specific angle, and until now there was no way to get there except to fly
 * over by hand and hope. Automation could not do it either: aiming the camera
 * needs pointer lock, pointer lock needs a real user gesture, and a synthetic
 * click does not count. So a whole class of bug could not be reproduced on
 * demand, only stumbled back into.
 *
 * With this, a finding can carry the URL that shows it:
 *
 *     ?pose=120,64,-30,90,-15      x,y,z, then yaw and pitch in degrees
 *     ?pose=120,64,-30             looking wherever the camera already looked
 *
 * The camera is left hovering rather than dropped onto the ground, because a
 * pose that falls somewhere else the moment it loads is not a pose.
 */

/** A camera placement. Angles are degrees; yaw -90 is the default facing. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Absent when the caller gave only a position. */
  yaw?: number;
  pitch?: number;
}

/** Pitch is clamped to match Player.look, which cannot pass straight up. */
export const MAX_PITCH = 89.9;

/**
 * Reads a pose out of a query string.
 *
 * Returns null for anything it cannot use, rather than a half-applied pose:
 * a debug hook that silently moves the camera somewhere other than where it
 * was asked would waste more time than it saves.
 */
export function parsePose(search: string): Pose | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get('pose');
  } catch {
    return null;
  }
  if (!raw) return null;

  const parts = raw.split(',').map((p) => p.trim());
  if (parts.length !== 3 && parts.length !== 5) return null;

  const n = parts.map(Number);
  // Number('') is 0 and Number('12abc') is NaN; both are mistakes, not poses.
  if (n.some((v) => !Number.isFinite(v)) || parts.some((p) => p === '')) return null;

  const pose: Pose = { x: n[0], y: n[1], z: n[2] };
  if (parts.length === 5) {
    pose.yaw = n[3];
    // Clamping rather than rejecting: 90 is the obvious way to ask for
    // straight down, and refusing the whole pose over a tenth of a degree
    // would be pedantic.
    pose.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, n[4]));
  }
  return pose;
}

/** What a pose needs to hold still: no gravity, no drift, no re-spawning. */
export interface Poseable {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vy: number;
  flying: boolean;
}

/**
 * Applies a pose to the player.
 *
 * Flying is switched on and vertical speed zeroed so the camera stays where it
 * was put; the caller is responsible for suppressing the usual drop-onto-solid
 * -ground step, which would otherwise move it on the first frame the chunk
 * finishes loading.
 */
export function applyPose(player: Poseable, pose: Pose): void {
  player.x = pose.x;
  player.y = pose.y;
  player.z = pose.z;
  if (pose.yaw !== undefined) player.yaw = pose.yaw;
  if (pose.pitch !== undefined) player.pitch = pose.pitch;
  player.vy = 0;
  player.flying = true;
}
