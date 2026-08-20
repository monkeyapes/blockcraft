"""Procedurally generated block texture atlas.

Everything here is drawn from scratch at startup, so the game ships with no
image files at all. The atlas is a 4x4 grid of 16x16 pixel tiles.
"""

import random

TILE = 16
COLS = 4
ROWS = 4
SIZE = TILE * COLS  # 64x64 atlas

# Tile slots, addressed as (column, row-from-top).
TILES = {
    "grass_top": (0, 0),
    "grass_side": (1, 0),
    "dirt": (2, 0),
    "stone": (3, 0),
    "sand": (0, 1),
    "log_side": (1, 1),
    "log_top": (2, 1),
    "leaves": (3, 1),
    "planks": (0, 2),
    "brick": (1, 2),
    "cobble": (2, 2),
    "water": (3, 2),
    "bedrock": (0, 3),
    "gravel": (1, 3),
    "glass": (2, 3),
    "glowstone": (3, 3),
}


def _clamp(v):
    return 0 if v < 0 else (255 if v > 255 else int(v))


def _speckle(rng, base, spread, alpha=255):
    """A flat colour with per-pixel brightness jitter."""
    px = []
    for _ in range(TILE * TILE):
        d = rng.uniform(-spread, spread)
        px.append((_clamp(base[0] + d), _clamp(base[1] + d), _clamp(base[2] + d), alpha))
    return px


def _grass_top(rng):
    px = _speckle(rng, (104, 160, 62), 14)
    for _ in range(26):  # darker tufts
        i = rng.randrange(TILE * TILE)
        r, g, b, a = px[i]
        px[i] = (_clamp(r - 24), _clamp(g - 20), _clamp(b - 16), a)
    return px


def _dirt(rng):
    px = _speckle(rng, (134, 96, 67), 13)
    for _ in range(18):  # small pebbles
        i = rng.randrange(TILE * TILE)
        px[i] = (96, 68, 46, 255)
    return px


def _grass_side(rng):
    px = _dirt(random.Random(rng.random()))
    # ragged grass fringe over the top few rows
    for x in range(TILE):
        depth = 3 + rng.randrange(3)
        for y in range(depth):
            d = rng.uniform(-14, 14)
            px[y * TILE + x] = (
                _clamp(104 + d), _clamp(160 + d), _clamp(62 + d), 255,
            )
    return px


def _stone(rng):
    return _speckle(rng, (128, 128, 128), 16)


def _cobble(rng):
    px = _speckle(rng, (122, 122, 122), 10)
    # scatter rounded stones with dark mortar between them
    for _ in range(9):
        cx, cy = rng.randrange(TILE), rng.randrange(TILE)
        r = rng.uniform(1.6, 3.0)
        tone = rng.uniform(-26, 26)
        for y in range(TILE):
            for x in range(TILE):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    d = tone + rng.uniform(-8, 8)
                    px[y * TILE + x] = (
                        _clamp(134 + d), _clamp(134 + d), _clamp(134 + d), 255,
                    )
    return px


def _sand(rng):
    return _speckle(rng, (219, 207, 163), 11)


def _gravel(rng):
    px = _speckle(rng, (129, 123, 118), 12)
    for _ in range(24):
        cx, cy = rng.randrange(TILE), rng.randrange(TILE)
        tone = rng.uniform(-30, 22)
        for y in range(cy, min(cy + 2, TILE)):
            for x in range(cx, min(cx + 2, TILE)):
                px[y * TILE + x] = (
                    _clamp(129 + tone), _clamp(123 + tone), _clamp(118 + tone), 255,
                )
    return px


def _bedrock(rng):
    px = _speckle(rng, (74, 74, 78), 10)
    for _ in range(30):
        cx, cy = rng.randrange(TILE), rng.randrange(TILE)
        tone = rng.uniform(-32, 30)
        px[cy * TILE + cx] = (_clamp(74 + tone), _clamp(74 + tone), _clamp(78 + tone), 255)
    return px


def _log_side(rng):
    px = _speckle(rng, (108, 84, 50), 8)
    for x in range(TILE):
        if rng.random() < 0.35:
            d = rng.uniform(-22, -8)
            for y in range(TILE):
                r, g, b, a = px[y * TILE + x]
                px[y * TILE + x] = (_clamp(r + d), _clamp(g + d), _clamp(b + d), a)
    return px


def _log_top(rng):
    px = []
    for y in range(TILE):
        for x in range(TILE):
            dist = ((x - 7.5) ** 2 + (y - 7.5) ** 2) ** 0.5
            ring = (dist * 1.7) % 2.0
            base = 158 if ring < 1.0 else 132
            d = rng.uniform(-7, 7)
            px.append((_clamp(base + d), _clamp(base * 0.78 + d), _clamp(base * 0.5 + d), 255))
    return px


def _leaves(rng):
    px = _speckle(rng, (58, 118, 44), 20)
    for _ in range(40):
        i = rng.randrange(TILE * TILE)
        px[i] = (34, 78, 28, 255)
    return px


def _planks(rng):
    px = _speckle(rng, (168, 132, 78), 9)
    for y in range(TILE):
        if y % 4 == 3:  # plank seams
            for x in range(TILE):
                r, g, b, a = px[y * TILE + x]
                px[y * TILE + x] = (_clamp(r - 34), _clamp(g - 30), _clamp(b - 22), a)
    for band in range(4):  # staggered end joints
        x = rng.randrange(TILE)
        for y in range(band * 4, band * 4 + 3):
            r, g, b, a = px[y * TILE + x]
            px[y * TILE + x] = (_clamp(r - 28), _clamp(g - 24), _clamp(b - 18), a)
    return px


def _brick(rng):
    mortar = (176, 172, 166, 255)
    px = _speckle(rng, (150, 74, 60), 9)
    for y in range(TILE):
        row = y // 4
        if y % 4 == 0:
            for x in range(TILE):
                px[y * TILE + x] = mortar
        else:
            offset = 0 if row % 2 == 0 else 4
            for x in range(TILE):
                if (x + offset) % 8 == 0:
                    px[y * TILE + x] = mortar
    return px


def _water(rng):
    px = _speckle(rng, (58, 110, 200), 9, alpha=165)
    for y in range(TILE):
        for x in range(TILE):
            if (x + y * 2) % 7 == 0:
                r, g, b, a = px[y * TILE + x]
                px[y * TILE + x] = (_clamp(r + 16), _clamp(g + 16), _clamp(b + 12), a)
    return px


def _glass(rng):
    px = [(214, 236, 244, 26)] * (TILE * TILE)
    px = list(px)
    for i in range(TILE):  # frame
        px[i] = (224, 240, 248, 210)
        px[(TILE - 1) * TILE + i] = (224, 240, 248, 210)
        px[i * TILE] = (224, 240, 248, 210)
        px[i * TILE + TILE - 1] = (224, 240, 248, 210)
    for _ in range(6):  # highlight glints
        x, y = rng.randrange(2, TILE - 2), rng.randrange(2, TILE - 2)
        px[y * TILE + x] = (255, 255, 255, 120)
    return px


def _glowstone(rng):
    px = _speckle(rng, (206, 170, 92), 14)
    for _ in range(22):
        i = rng.randrange(TILE * TILE)
        px[i] = (250, 232, 158, 255)
    return px


_GENERATORS = {
    "grass_top": _grass_top,
    "grass_side": _grass_side,
    "dirt": _dirt,
    "stone": _stone,
    "cobble": _cobble,
    "sand": _sand,
    "gravel": _gravel,
    "bedrock": _bedrock,
    "log_side": _log_side,
    "log_top": _log_top,
    "leaves": _leaves,
    "planks": _planks,
    "brick": _brick,
    "water": _water,
    "glass": _glass,
    "glowstone": _glowstone,
}


def build_atlas_bytes():
    """Render every tile into one RGBA buffer, bottom-up for OpenGL."""
    grid = [[(0, 0, 0, 0)] * SIZE for _ in range(SIZE)]  # top-down rows
    for name, (col, row) in TILES.items():
        rng = random.Random(hash(name) & 0xFFFF)
        pixels = _GENERATORS[name](rng)
        ox, oy = col * TILE, row * TILE
        for y in range(TILE):
            dst = grid[oy + y]
            for x in range(TILE):
                dst[ox + x] = pixels[y * TILE + x]

    out = bytearray()
    for row in reversed(grid):  # OpenGL wants the bottom row first
        for r, g, b, a in row:
            out += bytes((r, g, b, a))
    return bytes(out)


# Half-texel inset keeps neighbouring tiles from bleeding at grazing angles.
_INSET = 0.25 / SIZE


def tex_coords(name):
    """(u0, v0, u1, v1) for a tile, in atlas UV space."""
    col, row = TILES[name]
    u0 = col / COLS + _INSET
    u1 = (col + 1) / COLS - _INSET
    v0 = (ROWS - 1 - row) / ROWS + _INSET
    v1 = (ROWS - row) / ROWS - _INSET
    return u0, v0, u1, v1
