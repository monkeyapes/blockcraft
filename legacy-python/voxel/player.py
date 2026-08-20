"""Player state: camera orientation, movement, collision, block picking."""

import math

from . import blocks as B
from .world import WORLD_HEIGHT

WIDTH = 0.6          # AABB footprint
HEIGHT = 1.8
EYE = 1.62

GRAVITY = 26.0
TERMINAL = 55.0
JUMP_SPEED = 8.6
WALK_SPEED = 4.6
SPRINT_SPEED = 7.4
FLY_SPEED = 12.0
FLY_SPRINT = 26.0
SWIM_SPEED = 3.4

REACH = 6.0


class Player:
    def __init__(self, x=0.5, y=64.0, z=0.5):
        self.x, self.y, self.z = x, y, z
        self.yaw = -90.0       # degrees, 0 = +X
        self.pitch = 0.0
        self.dy = 0.0
        self.flying = False
        self.on_ground = False
        self.in_water = False
        self.slot = 0

    # ------------------------------------------------------------------ state

    @property
    def eye(self):
        return self.x, self.y + EYE, self.z

    def state(self):
        return {
            "pos": (self.x, self.y, self.z),
            "yaw": self.yaw, "pitch": self.pitch,
            "flying": self.flying, "slot": self.slot,
        }

    def restore(self, state):
        self.x, self.y, self.z = state["pos"]
        self.yaw = state["yaw"]
        self.pitch = state["pitch"]
        self.flying = state.get("flying", False)
        self.slot = state.get("slot", 0)

    def look(self, dx, dy, sensitivity=0.15):
        self.yaw += dx * sensitivity
        self.pitch = max(-89.9, min(89.9, self.pitch + dy * sensitivity))
        self.yaw %= 360.0

    def forward_vector(self):
        yaw = math.radians(self.yaw)
        pitch = math.radians(self.pitch)
        cp = math.cos(pitch)
        return (math.cos(yaw) * cp, math.sin(pitch), math.sin(yaw) * cp)

    # --------------------------------------------------------------- movement

    def update(self, dt, world, keys, sprint):
        head = world.get_block(int(math.floor(self.x)),
                               int(math.floor(self.y + EYE)),
                               int(math.floor(self.z)))
        self.in_water = B.REGISTRY[head].liquid

        yaw = math.radians(self.yaw)
        fx, fz = math.cos(yaw), math.sin(yaw)
        rx, rz = -fz, fx

        mx = mz = 0.0
        if keys["forward"]:
            mx += fx
            mz += fz
        if keys["back"]:
            mx -= fx
            mz -= fz
        if keys["right"]:
            mx += rx
            mz += rz
        if keys["left"]:
            mx -= rx
            mz -= rz
        length = math.hypot(mx, mz)
        if length > 0.0:
            mx /= length
            mz /= length

        if self.flying:
            speed = FLY_SPRINT if sprint else FLY_SPEED
            self.dy = 0.0
            vy = 0.0
            if keys["up"]:
                vy += speed
            if keys["down"]:
                vy -= speed
            self._move(world, mx * speed * dt, vy * dt, mz * speed * dt)
            self.on_ground = False
            return

        if self.in_water:
            speed = SWIM_SPEED
            self.dy -= GRAVITY * 0.28 * dt
            if self.dy < -4.0:
                self.dy = -4.0
            if keys["up"]:
                self.dy = 4.2
        else:
            speed = SPRINT_SPEED if sprint else WALK_SPEED
            if keys["up"] and self.on_ground:
                self.dy = JUMP_SPEED
            self.dy -= GRAVITY * dt
            if self.dy < -TERMINAL:
                self.dy = -TERMINAL

        self._move(world, mx * speed * dt, self.dy * dt, mz * speed * dt)

    def _move(self, world, dx, dy, dz):
        # Resolve one axis at a time so sliding along walls feels right.
        self.x += dx
        self._resolve(world, 0, dx)
        self.z += dz
        self._resolve(world, 2, dz)
        self.y += dy
        hit = self._resolve(world, 1, dy)
        if hit:
            if dy < 0:
                self.on_ground = True
            self.dy = 0.0
        elif dy != 0:
            self.on_ground = False

    def _resolve(self, world, axis, delta):
        """Push the player out of any solid block it now overlaps."""
        if delta == 0.0:
            return False
        half = WIDTH / 2.0
        x0 = int(math.floor(self.x - half))
        x1 = int(math.floor(self.x + half))
        y0 = int(math.floor(self.y))
        y1 = int(math.floor(self.y + HEIGHT - 0.001))
        z0 = int(math.floor(self.z - half))
        z1 = int(math.floor(self.z + half))

        hit = False
        for bx in range(x0, x1 + 1):
            for by in range(y0, min(y1, WORLD_HEIGHT - 1) + 1):
                for bz in range(z0, z1 + 1):
                    if not world.is_solid(bx, by, bz):
                        continue
                    hit = True
                    if axis == 0:
                        self.x = (bx + 1 + half) if delta < 0 else (bx - half)
                    elif axis == 1:
                        self.y = (by + 1) if delta < 0 else (by - HEIGHT)
                    else:
                        self.z = (bz + 1 + half) if delta < 0 else (bz - half)
                    return hit
        return hit

    # -------------------------------------------------------------- targeting

    def raycast(self, world):
        """Return (hit_block, adjacent_empty) as integer coords, or (None, None).

        Standard voxel DDA walk from the eye along the view vector.
        """
        ox, oy, oz = self.eye
        dx, dy, dz = self.forward_vector()

        bx, by, bz = int(math.floor(ox)), int(math.floor(oy)), int(math.floor(oz))
        step_x = 1 if dx > 0 else -1
        step_y = 1 if dy > 0 else -1
        step_z = 1 if dz > 0 else -1

        inf = float("inf")
        t_dx = abs(1.0 / dx) if dx != 0 else inf
        t_dy = abs(1.0 / dy) if dy != 0 else inf
        t_dz = abs(1.0 / dz) if dz != 0 else inf

        t_x = ((bx + 1 - ox) / dx) if dx > 0 else (((bx - ox) / dx) if dx < 0 else inf)
        t_y = ((by + 1 - oy) / dy) if dy > 0 else (((by - oy) / dy) if dy < 0 else inf)
        t_z = ((bz + 1 - oz) / dz) if dz > 0 else (((bz - oz) / dz) if dz < 0 else inf)

        prev = None
        travelled = 0.0
        while travelled <= REACH:
            block_id = world.get_block(bx, by, bz)
            if block_id != B.AIR and not B.REGISTRY[block_id].liquid:
                return (bx, by, bz), prev
            prev = (bx, by, bz)
            if t_x <= t_y and t_x <= t_z:
                travelled = t_x
                bx += step_x
                t_x += t_dx
            elif t_y <= t_z:
                travelled = t_y
                by += step_y
                t_y += t_dy
            else:
                travelled = t_z
                bz += step_z
                t_z += t_dz
        return None, None

    def intersects(self, bx, by, bz):
        """Would a block at these coords overlap the player's body?"""
        half = WIDTH / 2.0
        return (bx + 1 > self.x - half and bx < self.x + half and
                by + 1 > self.y and by < self.y + HEIGHT and
                bz + 1 > self.z - half and bz < self.z + half)
