"""Deterministic value noise. Pure Python so the frozen exe stays small."""

import math

_MASK = 0xFFFFFFFF


def hash2(x, y, seed):
    """Hash an integer lattice point to a float in [0, 1)."""
    n = (x * 1619 + y * 31337 + seed * 1013) & _MASK
    n = (n ^ (n >> 13)) & _MASK
    n = (n * 1274126177) & _MASK
    n = (n ^ (n >> 16)) & _MASK
    return n / 4294967296.0


def _smooth(t):
    return t * t * (3.0 - 2.0 * t)


def value2(x, y, seed):
    """Bilinear value noise in [0, 1)."""
    ix = math.floor(x)
    iy = math.floor(y)
    fx = _smooth(x - ix)
    fy = _smooth(y - iy)
    ix = int(ix)
    iy = int(iy)

    a = hash2(ix, iy, seed)
    b = hash2(ix + 1, iy, seed)
    c = hash2(ix, iy + 1, seed)
    d = hash2(ix + 1, iy + 1, seed)

    top = a + (b - a) * fx
    bottom = c + (d - c) * fx
    return top + (bottom - top) * fy


def fbm(x, y, seed, octaves=4, lacunarity=2.0, gain=0.5):
    """Fractal sum of value noise, normalised to [0, 1)."""
    total = 0.0
    amplitude = 1.0
    norm = 0.0
    freq = 1.0
    for i in range(octaves):
        total += value2(x * freq, y * freq, seed + i * 131) * amplitude
        norm += amplitude
        amplitude *= gain
        freq *= lacunarity
    return total / norm
