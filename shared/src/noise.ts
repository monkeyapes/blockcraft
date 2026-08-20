/**
 * Deterministic value noise.
 *
 * Client and server both generate terrain from this, so it must produce
 * bit-identical results everywhere: integer math goes through Math.imul and
 * unsigned shifts, and the float ops are all IEEE-754 exact operations.
 */

export function hash2(x: number, y: number, seed: number): number {
  let n = (Math.imul(x, 1619) + Math.imul(y, 31337) + Math.imul(seed, 1013)) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

export function hash3(x: number, y: number, z: number, seed: number): number {
  let n =
    (Math.imul(x, 1619) + Math.imul(y, 7919) + Math.imul(z, 31337) + Math.imul(seed, 1013)) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function value2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);

  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);

  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

export function value3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const fz = smooth(z - iz);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);

  const x00 = lerp(c000, c100, fx);
  const x10 = lerp(c010, c110, fx);
  const x01 = lerp(c001, c101, fx);
  const x11 = lerp(c011, c111, fx);

  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

export function fbm2(x: number, y: number, seed: number, octaves = 4, gain = 0.5): number {
  let total = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    total += value2(x * freq, y * freq, seed + i * 131) * amp;
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return total / norm;
}

export function fbm3(
  x: number, y: number, z: number, seed: number, octaves = 3, gain = 0.5,
): number {
  let total = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    total += value3(x * freq, y * freq, z * freq, seed + i * 131) * amp;
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return total / norm;
}

/** Push an fBm sample away from its mean, otherwise terrain reads as mush. */
export function contrast(v: number, amount: number): number {
  const out = (v - 0.5) * amount + 0.5;
  return out < 0 ? 0 : out > 1 ? 1 : out;
}
