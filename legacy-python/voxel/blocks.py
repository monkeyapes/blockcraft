"""Block registry.

Face order used everywhere: 0=+Y (top), 1=-Y (bottom), 2=+Z, 3=-Z, 4=+X, 5=-X.
"""

from . import textures

AIR = 0
GRASS = 1
DIRT = 2
STONE = 3
SAND = 4
LOG = 5
LEAVES = 6
PLANKS = 7
BRICK = 8
COBBLE = 9
WATER = 10
BEDROCK = 11
GRAVEL = 12
GLASS = 13
GLOWSTONE = 14


class Block:
    __slots__ = ("id", "name", "uvs", "solid", "opaque", "liquid", "breakable")

    def __init__(self, id_, name, top, side, bottom,
                 solid=True, opaque=True, liquid=False, breakable=True):
        self.id = id_
        self.name = name
        self.solid = solid
        self.opaque = opaque
        self.liquid = liquid
        self.breakable = breakable
        faces = (top, bottom, side, side, side, side)
        self.uvs = tuple(textures.tex_coords(f) for f in faces)


def _b(*args, **kwargs):
    block = Block(*args, **kwargs)
    REGISTRY[block.id] = block
    return block


REGISTRY = {}

_b(AIR, "Air", "stone", "stone", "stone", solid=False, opaque=False)
_b(GRASS, "Grass", "grass_top", "grass_side", "dirt")
_b(DIRT, "Dirt", "dirt", "dirt", "dirt")
_b(STONE, "Stone", "stone", "stone", "stone")
_b(SAND, "Sand", "sand", "sand", "sand")
_b(LOG, "Log", "log_top", "log_side", "log_top")
_b(LEAVES, "Leaves", "leaves", "leaves", "leaves")
_b(PLANKS, "Planks", "planks", "planks", "planks")
_b(BRICK, "Bricks", "brick", "brick", "brick")
_b(COBBLE, "Cobblestone", "cobble", "cobble", "cobble")
_b(WATER, "Water", "water", "water", "water",
   solid=False, opaque=False, liquid=True, breakable=False)
_b(BEDROCK, "Bedrock", "bedrock", "bedrock", "bedrock", breakable=False)
_b(GRAVEL, "Gravel", "gravel", "gravel", "gravel")
_b(GLASS, "Glass", "glass", "glass", "glass", opaque=False)
_b(GLOWSTONE, "Glowstone", "glowstone", "glowstone", "glowstone")

# What the player can hold, in hotbar order.
HOTBAR = [GRASS, DIRT, STONE, COBBLE, SAND, PLANKS, LOG, BRICK, GLASS]

# Blocks drawn in the alpha-blended pass instead of the opaque one.
TRANSPARENT = frozenset({WATER, GLASS})


def get(block_id):
    return REGISTRY[block_id]


def is_solid(block_id):
    return REGISTRY[block_id].solid


def is_opaque(block_id):
    return REGISTRY[block_id].opaque
