"""Terrain generation, chunk storage and chunk meshing."""

import os
import pickle

from . import blocks as B
from .noise import fbm, hash2

CHUNK = 16
PADDED = CHUNK + 2       # chunk plus a one-block skirt, for border faces
WORLD_HEIGHT = 96
SEA_LEVEL = 16

TREE_CHANCE = 0.015

# Face table: (normal, four corner offsets, shade).
# Order: +Y, -Y, +Z, -Z, +X, -X  -- must match blocks.Block.uvs.
FACES = (
    ((0, 1, 0), ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)), 1.00),
    ((0, -1, 0), ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)), 0.50),
    ((0, 0, 1), ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)), 0.80),
    ((0, 0, -1), ((1, 0, 0), (0, 0, 0), (0, 1, 0), (1, 1, 0)), 0.80),
    ((1, 0, 0), ((1, 0, 1), (1, 0, 0), (1, 1, 0), (1, 1, 1)), 0.65),
    ((-1, 0, 0), ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)), 0.65),
)


def _contrast(v, amount):
    """Push a [0,1) fBm sample away from its mean so terrain isn't mush."""
    v = (v - 0.5) * amount + 0.5
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


class Chunk:
    __slots__ = ("cx", "cz", "heights", "generated", "dirty",
                 "gen", "edits", "opaque_vl", "alpha_vl")

    def __init__(self, cx, cz):
        self.cx = cx
        self.cz = cz
        self.heights = None
        self.generated = False
        self.dirty = True
        self.gen = {}      # worldgen blocks (trees) that landed in this chunk
        self.edits = {}    # player changes in this chunk
        self.opaque_vl = None
        self.alpha_vl = None

    @property
    def meshed(self):
        return self.opaque_vl is not None or self.alpha_vl is not None

    def unload(self):
        for vl in (self.opaque_vl, self.alpha_vl):
            if vl is not None:
                vl.delete()
        self.opaque_vl = None
        self.alpha_vl = None


class World:
    def __init__(self, seed=1337):
        self.seed = seed
        self.chunks = {}
        self.col_low = {}      # per column, lowest y a player has dug out
        self.col_high = {}     # per column, highest y holding a block
        self._pending_edits = {}  # from a save file, keyed by chunk coords

    # ---------------------------------------------------------------- terrain

    def column_height(self, x, z):
        continent = _contrast(fbm(x / 260.0, z / 260.0, self.seed, 3), 2.4)
        hills = _contrast(fbm(x / 55.0, z / 55.0, self.seed + 701, 4), 2.6)
        rough = _contrast(fbm(x / 17.0, z / 17.0, self.seed + 1301, 2), 2.0)

        h = 6.0 + continent * 34.0
        h += (hills - 0.5) * 26.0 * (0.30 + continent)
        h += (rough - 0.5) * 4.0
        return max(1, min(WORLD_HEIGHT - 24, int(h)))

    @staticmethod
    def _terrain_block(y, h):
        """Block from the base terrain, before trees and player edits."""
        if y == 0:
            return B.BEDROCK
        if y > h:
            return B.WATER if y <= SEA_LEVEL else B.AIR
        if y == h:
            if h <= SEA_LEVEL + 1:
                return B.SAND
            if h >= 40:
                return B.STONE
            return B.GRASS
        if y > h - 4:
            return B.SAND if h <= SEA_LEVEL + 1 else B.DIRT
        return B.STONE

    # ------------------------------------------------------------------ query

    def _chunk_obj(self, cx, cz):
        """The Chunk object, created but never generated. Safe from worldgen."""
        key = (cx, cz)
        chunk = self.chunks.get(key)
        if chunk is None:
            chunk = Chunk(cx, cz)
            pending = self._pending_edits.pop(key, None)
            if pending:
                chunk.edits = pending
            self.chunks[key] = chunk
        return chunk

    def get_chunk(self, cx, cz):
        chunk = self._chunk_obj(cx, cz)
        if not chunk.generated:
            self.generate(chunk)
        return chunk

    def height(self, x, z):
        chunk = self.get_chunk(x >> 4, z >> 4)
        return chunk.heights[(z & 15) * CHUNK + (x & 15)]

    def get_block(self, x, y, z):
        if y < 0 or y >= WORLD_HEIGHT:
            return B.AIR
        chunk = self.get_chunk(x >> 4, z >> 4)
        key = (x, y, z)
        v = chunk.edits.get(key)
        if v is not None:
            return v
        v = chunk.gen.get(key)
        if v is not None:
            return v
        return self._terrain_block(y, chunk.heights[(z & 15) * CHUNK + (x & 15)])

    def is_solid(self, x, y, z):
        return B.REGISTRY[self.get_block(x, y, z)].solid

    # ------------------------------------------------------------- generation

    def generate(self, chunk):
        chunk.generated = True
        ox, oz = chunk.cx * CHUNK, chunk.cz * CHUNK
        heights = [0] * (CHUNK * CHUNK)
        column_height = self.column_height
        for lz in range(CHUNK):
            z = oz + lz
            row = lz * CHUNK
            for lx in range(CHUNK):
                heights[row + lx] = column_height(ox + lx, z)
        chunk.heights = heights

        for lz in range(CHUNK):
            for lx in range(CHUNK):
                h = heights[lz * CHUNK + lx]
                if h <= SEA_LEVEL + 1 or h >= 40:
                    continue
                x, z = ox + lx, oz + lz
                if self._is_tree_spot(x, z):
                    self._place_tree(x, h + 1, z)

    def _is_tree_spot(self, x, z):
        r = hash2(x, z, self.seed + 99)
        if r > TREE_CHANCE:
            return False
        # Keep trees apart: only the local minimum of the 3x3 neighbourhood wins.
        for dz in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx or dz:
                    if hash2(x + dx, z + dz, self.seed + 99) < r:
                        return False
        return True

    def _place_tree(self, x, y, z):
        trunk = 4 + int(hash2(x, z, self.seed + 4242) * 3)
        top = y + trunk - 1
        for i in range(trunk):
            self._gen_set(x, y + i, z, B.LOG)
        for dy, radius in ((-1, 2), (0, 2), (1, 1)):
            ly = top + dy
            for dz in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    if dx == 0 and dz == 0 and dy < 1:
                        continue
                    if abs(dx) == radius and abs(dz) == radius:
                        continue  # round the corners off
                    self._gen_set(x + dx, ly, z + dz, B.LEAVES)
        self._gen_set(x, top + 2, z, B.LEAVES)

    def _gen_set(self, x, y, z, block_id):
        if y >= WORLD_HEIGHT:
            return
        chunk = self._chunk_obj(x >> 4, z >> 4)
        key = (x, y, z)
        if key in chunk.gen:
            return
        chunk.gen[key] = block_id
        chunk.dirty = True
        col = (x, z)
        if y > self.col_high.get(col, -1):
            self.col_high[col] = y

    # ------------------------------------------------------------------ edits

    def set_block(self, x, y, z, block_id, mark_dirty=True):
        if y < 0 or y >= WORLD_HEIGHT:
            return
        chunk = self.get_chunk(x >> 4, z >> 4)
        chunk.edits[(x, y, z)] = block_id
        col = (x, z)
        if block_id == B.AIR:
            self.col_low[col] = min(self.col_low.get(col, WORLD_HEIGHT), y)
        elif y > self.col_high.get(col, -1):
            self.col_high[col] = y
        if mark_dirty:
            self.touch(x, y, z)

    def touch(self, x, y, z):
        """Mark the owning chunk dirty, plus neighbours when on a border."""
        cx, cz = x >> 4, z >> 4
        self._dirty(cx, cz)
        lx, lz = x & 15, z & 15
        if lx == 0:
            self._dirty(cx - 1, cz)
        elif lx == 15:
            self._dirty(cx + 1, cz)
        if lz == 0:
            self._dirty(cx, cz - 1)
        elif lz == 15:
            self._dirty(cx, cz + 1)

    def _dirty(self, cx, cz):
        chunk = self.chunks.get((cx, cz))
        if chunk is not None:
            chunk.dirty = True

    # ---------------------------------------------------------------- meshing

    def _column_span(self, x, z, h, neighbour_heights):
        """The y range of a column that can possibly show a face."""
        lo = min(h, *neighbour_heights) - 1
        dug = self.col_low.get((x, z))
        if dug is not None:
            lo = min(lo, dug - 1)
        for nx, nz in ((x - 1, z), (x + 1, z), (x, z - 1), (x, z + 1)):
            dug = self.col_low.get((nx, nz))
            if dug is not None:
                lo = min(lo, dug - 1)

        hi = h if h >= SEA_LEVEL else SEA_LEVEL
        top = self.col_high.get((x, z))
        if top is not None and top > hi:
            hi = top
        return max(0, lo), min(hi, WORLD_HEIGHT - 1)

    def build_mesh(self, chunk, batch, opaque_group, alpha_group):
        """Rebuild a chunk's geometry: only faces that touch a see-through block.

        Works off a padded column cache so the hot loop is list indexing rather
        than dict lookups and world queries.
        """
        cx, cz = chunk.cx, chunk.cz
        ox, oz = cx * CHUNK, cz * CHUNK
        terrain = self._terrain_block
        registry = B.REGISTRY
        transparent = B.TRANSPARENT

        # One flat override map for the 3x3 chunk neighbourhood. Worldgen first,
        # player edits second, so edits win.
        overrides = {}
        for ncx in range(cx - 1, cx + 2):
            for ncz in range(cz - 1, cz + 2):
                overrides.update(self.get_chunk(ncx, ncz).gen)
        for ncx in range(cx - 1, cx + 2):
            for ncz in range(cz - 1, cz + 2):
                overrides.update(self.chunks[(ncx, ncz)].edits)
        ov_get = overrides.get

        # Padded height field, indexed [(lx + 1) * PADDED + (lz + 1)].
        heights = [0] * (PADDED * PADDED)
        for lx in range(-1, CHUNK + 1):
            base = (lx + 1) * PADDED
            for lz in range(-1, CHUNK + 1):
                heights[base + lz + 1] = self.height(ox + lx, oz + lz)

        # Padded column cache: each entry is (lo, [block ids from lo upward]).
        columns = [None] * (PADDED * PADDED)
        for lx in range(-1, CHUNK + 1):
            x = ox + lx
            base = (lx + 1) * PADDED
            for lz in range(-1, CHUNK + 1):
                z = oz + lz
                idx = base + lz + 1
                h = heights[idx]
                neighbours = (
                    heights[idx - PADDED] if lx > -1 else h,
                    heights[idx + PADDED] if lx < CHUNK else h,
                    heights[idx - 1] if lz > -1 else h,
                    heights[idx + 1] if lz < CHUNK else h,
                )
                lo, hi = self._column_span(x, z, h, neighbours)
                ids = []
                for y in range(lo, hi + 1):
                    v = ov_get((x, y, z))
                    ids.append(terrain(y, h) if v is None else v)
                columns[idx] = (lo, ids)

        def slow_at(x, y, z):
            """Fallback for the rare lookup outside a cached column span."""
            if y < 0 or y >= WORLD_HEIGHT:
                return B.AIR
            v = ov_get((x, y, z))
            if v is not None:
                return v
            return terrain(y, self.height(x, z))

        op_v, op_t, op_c = [], [], []
        al_v, al_t, al_c = [], [], []

        for lx in range(CHUNK):
            x = ox + lx
            base = (lx + 1) * PADDED
            for lz in range(CHUNK):
                z = oz + lz
                idx = base + lz + 1
                lo, ids = columns[idx]

                for offset, block_id in enumerate(ids):
                    if block_id == B.AIR:
                        continue
                    y = lo + offset
                    block = registry[block_id]
                    if block_id in transparent:
                        verts, texs, cols = al_v, al_t, al_c
                    else:
                        verts, texs, cols = op_v, op_t, op_c

                    for fi in range(6):
                        normal, corners, shade = FACES[fi]
                        ny = y + normal[1]
                        if normal[1]:
                            n_lo, n_ids = lo, ids
                            nx, nz = x, z
                        else:
                            n_idx = idx + normal[0] * PADDED + normal[2]
                            n_lo, n_ids = columns[n_idx]
                            nx, nz = x + normal[0], z + normal[2]
                        n_off = ny - n_lo
                        if 0 <= n_off < len(n_ids):
                            neighbour = n_ids[n_off]
                        else:
                            neighbour = slow_at(nx, ny, nz)

                        if neighbour == block_id or registry[neighbour].opaque:
                            continue

                        u0, v0, u1, v1 = block.uvs[fi]
                        for dx, dy, dz in corners:
                            verts.append(x + dx)
                            verts.append(y + dy)
                            verts.append(z + dz)
                        if fi == 0:
                            texs.extend((u0, v0, u0, v1, u1, v1, u1, v0))
                        else:
                            texs.extend((u0, v0, u1, v0, u1, v1, u0, v1))
                        cols.extend((shade,) * 12)

        chunk.unload()
        if op_v:
            chunk.opaque_vl = batch.add(
                len(op_v) // 3, 7, opaque_group,   # 7 == GL_QUADS
                ("v3f/static", op_v), ("t2f/static", op_t), ("c3f/static", op_c))
        if al_v:
            chunk.alpha_vl = batch.add(
                len(al_v) // 3, 7, alpha_group,
                ("v3f/static", al_v), ("t2f/static", al_t), ("c3f/static", al_c))
        chunk.dirty = False

    # ------------------------------------------------------------------- save

    def save(self, path, player_state):
        edits = {}
        for chunk in self.chunks.values():
            edits.update(chunk.edits)
        for pending in self._pending_edits.values():
            edits.update(pending)
        data = {
            "version": 1,
            "seed": self.seed,
            "edits": edits,
            "col_low": self.col_low,
            "col_high": self.col_high,
            "player": player_state,
        }
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            pickle.dump(data, fh, protocol=4)
        os.replace(tmp, path)  # never leave a half-written save behind

    @classmethod
    def load(cls, path):
        with open(path, "rb") as fh:
            data = pickle.load(fh)
        world = cls(data["seed"])
        world.col_low = data.get("col_low", {})
        world.col_high = data.get("col_high", {})
        pending = {}
        for (x, y, z), block_id in data.get("edits", {}).items():
            pending.setdefault((x >> 4, z >> 4), {})[(x, y, z)] = block_id
        world._pending_edits = pending
        return world, data.get("player")
