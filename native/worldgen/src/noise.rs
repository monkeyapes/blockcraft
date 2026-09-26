//! Deterministic value noise, ported from shared/src/noise.ts.
//!
//! The TypeScript version is careful to be bit-identical on every machine:
//! its integer math goes through `Math.imul` and unsigned shifts, and its
//! float math is plain IEEE-754 arithmetic. That makes an exact port possible.
//! JavaScript's 32-bit integer operators become `wrapping_*` on `i32`/`u32`,
//! and every JavaScript number stays an `f64`, with the operations written in
//! the same order so rounding happens at the same places.

/// JavaScript's `ToInt32`: truncate toward zero, then wrap modulo 2^32.
///
/// Every value this crate feeds a hash is already an integer well inside
/// i32, so the fast path is the only one taken in practice; the slow path is
/// here so the function means exactly what `Math.imul`'s argument conversion
/// means, rather than silently saturating the way `as i32` would.
#[inline]
pub fn to_int32(v: f64) -> i32 {
    if v >= i32::MIN as f64 && v <= i32::MAX as f64 {
        return v as i32;
    }
    if !v.is_finite() {
        return 0;
    }
    let m = v.trunc().rem_euclid(4_294_967_296.0);
    m as u64 as u32 as i32
}

/// The final avalanche shared by both hashes: `n ^ (n >>> 13)`, a
/// `Math.imul`, then `n ^ (n >>> 16)` read as unsigned, scaled to [0, 1).
#[inline(always)]
fn finish(n: i32) -> f64 {
    let n = n ^ ((n as u32) >> 13) as i32;
    let n = n.wrapping_mul(1_274_126_177);
    let n = (n as u32) ^ ((n as u32) >> 16);
    n as f64 / 4_294_967_296.0
}

/// A hash of an integer lattice point to [0, 1).
#[inline]
pub fn hash2(x: i32, y: i32, seed: i32) -> f64 {
    let n = x
        .wrapping_mul(1619)
        .wrapping_add(y.wrapping_mul(31337))
        .wrapping_add(seed.wrapping_mul(1013));
    finish(n)
}

/// The 3D counterpart of [`hash2`].
#[inline]
pub fn hash3(x: i32, y: i32, z: i32, seed: i32) -> f64 {
    let n = x
        .wrapping_mul(1619)
        .wrapping_add(y.wrapping_mul(7919))
        .wrapping_add(z.wrapping_mul(31337))
        .wrapping_add(seed.wrapping_mul(1013));
    finish(n)
}

#[inline(always)]
fn smooth(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

#[inline(always)]
fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Smoothly interpolated 2D value noise in [0, 1).
pub fn value2(x: f64, y: f64, seed: i32) -> f64 {
    let fx0 = x.floor();
    let fy0 = y.floor();
    let fx = smooth(x - fx0);
    let fy = smooth(y - fy0);
    let ix = to_int32(fx0);
    let iy = to_int32(fy0);

    let a = hash2(ix, iy, seed);
    let b = hash2(ix.wrapping_add(1), iy, seed);
    let c = hash2(ix, iy.wrapping_add(1), seed);
    let d = hash2(ix.wrapping_add(1), iy.wrapping_add(1), seed);

    let top = a + (b - a) * fx;
    let bottom = c + (d - c) * fx;
    top + (bottom - top) * fy
}

/// Smoothly interpolated 3D value noise in [0, 1).
pub fn value3(x: f64, y: f64, z: f64, seed: i32) -> f64 {
    let fx0 = x.floor();
    let fy0 = y.floor();
    let fz0 = z.floor();
    let fx = smooth(x - fx0);
    let fy = smooth(y - fy0);
    let fz = smooth(z - fz0);
    let ix = to_int32(fx0);
    let iy = to_int32(fy0);
    let iz = to_int32(fz0);
    let (ix1, iy1, iz1) = (ix.wrapping_add(1), iy.wrapping_add(1), iz.wrapping_add(1));

    let c000 = hash3(ix, iy, iz, seed);
    let c100 = hash3(ix1, iy, iz, seed);
    let c010 = hash3(ix, iy1, iz, seed);
    let c110 = hash3(ix1, iy1, iz, seed);
    let c001 = hash3(ix, iy, iz1, seed);
    let c101 = hash3(ix1, iy, iz1, seed);
    let c011 = hash3(ix, iy1, iz1, seed);
    let c111 = hash3(ix1, iy1, iz1, seed);

    let x00 = lerp(c000, c100, fx);
    let x10 = lerp(c010, c110, fx);
    let x01 = lerp(c001, c101, fx);
    let x11 = lerp(c011, c111, fx);

    lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz)
}

/// Fractal sum of [`value2`] octaves, normalised back to [0, 1).
///
/// TypeScript's defaults are four octaves at gain 0.5; Rust has no default
/// arguments, so callers pass them explicitly.
pub fn fbm2(x: f64, y: f64, seed: i32, octaves: u32, gain: f64) -> f64 {
    let mut total = 0.0;
    let mut amp = 1.0;
    let mut norm = 0.0;
    let mut freq = 1.0;
    for i in 0..octaves as i32 {
        total += value2(x * freq, y * freq, seed.wrapping_add(i.wrapping_mul(131))) * amp;
        norm += amp;
        amp *= gain;
        freq *= 2.0;
    }
    total / norm
}

/// Fractal sum of [`value3`] octaves (TypeScript defaults: 3 octaves, 0.5).
pub fn fbm3(x: f64, y: f64, z: f64, seed: i32, octaves: u32, gain: f64) -> f64 {
    let mut total = 0.0;
    let mut amp = 1.0;
    let mut norm = 0.0;
    let mut freq = 1.0;
    for i in 0..octaves as i32 {
        total += value3(
            x * freq,
            y * freq,
            z * freq,
            seed.wrapping_add(i.wrapping_mul(131)),
        ) * amp;
        norm += amp;
        amp *= gain;
        freq *= 2.0;
    }
    total / norm
}

/// Pushes an fBm sample away from its mean, otherwise terrain reads as mush.
#[inline]
pub fn contrast(v: f64, amount: f64) -> f64 {
    // `clamp` agrees with the TypeScript's pair of comparisons for every
    // input, NaN included (both pass it through).
    ((v - 0.5) * amount + 0.5).clamp(0.0, 1.0)
}

/// V8's `Math.hypot`, reproduced operation for operation.
///
/// Rust's `f64::hypot` calls the platform libm, which is free to round
/// differently, and the End's island shape floors values derived from this
/// distance -- a one-ulp disagreement would move a block. V8 normalises by
/// the larger magnitude and Kahan-sums the squares, so this does the same.
pub fn js_hypot(a: f64, b: f64) -> f64 {
    if a.is_infinite() || b.is_infinite() {
        return f64::INFINITY;
    }
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    let (a, b) = (a.abs(), b.abs());
    let max = if b > a { b } else { a };
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut compensation = 0.0;
    for v in [a, b] {
        let n = v / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_int32_wraps_like_javascript() {
        assert_eq!(to_int32(2_147_483_648.0), i32::MIN);
        assert_eq!(to_int32(-2_147_483_649.0), i32::MAX);
        assert_eq!(to_int32(4_294_967_297.0), 1);
        assert_eq!(to_int32(-1.9), -1);
        assert_eq!(to_int32(f64::NAN), 0);
    }

    #[test]
    fn hashes_stay_in_unit_interval() {
        for i in -50..50 {
            let h = hash2(i * 7919, i * -31, i);
            assert!((0.0..1.0).contains(&h));
            let h = hash3(i, i * 3, -i, i32::MAX - i);
            assert!((0.0..1.0).contains(&h));
        }
    }

    #[test]
    fn hypot_of_zero_and_axes() {
        assert_eq!(js_hypot(0.0, 0.0), 0.0);
        assert_eq!(js_hypot(-5.0, 0.0), 5.0);
        assert_eq!(js_hypot(3.0, 4.0), 5.0);
    }
}
