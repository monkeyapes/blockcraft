"""Window, render loop, chunk streaming and HUD."""

import math
import os
import time

import pyglet
from pyglet.gl import *
from pyglet.window import key, mouse

from . import blocks as B
from . import textures
from .player import Player
from .world import CHUNK, SEA_LEVEL, World

TITLE = "Blockcraft"
SKY = (0.55, 0.72, 0.93)
WATER_TINT = (0.16, 0.35, 0.62, 0.42)

DEFAULT_RENDER_DISTANCE = 6
MIN_RENDER_DISTANCE = 2
MAX_RENDER_DISTANCE = 12

# Milliseconds per frame we are willing to spend building chunk meshes.
MESH_BUDGET = 0.008


def save_dir():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    path = os.path.join(base, "Blockcraft")
    os.makedirs(path, exist_ok=True)
    return path


class TextureGroup(pyglet.graphics.Group):
    """Binds the block atlas and sets up the opaque pass."""

    def __init__(self, texture):
        super().__init__()
        self.texture = texture

    def set_state(self):
        glEnable(self.texture.target)
        glBindTexture(self.texture.target, self.texture.id)

    def unset_state(self):
        glDisable(self.texture.target)


class AlphaGroup(pyglet.graphics.OrderedGroup):
    """Water and glass: blended, and no depth writes so they layer sanely."""

    def set_state(self):
        glEnable(GL_BLEND)
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
        glDepthMask(GL_FALSE)

    def unset_state(self):
        glDepthMask(GL_TRUE)
        glDisable(GL_BLEND)


class OpaqueGroup(pyglet.graphics.OrderedGroup):
    def set_state(self):
        glDisable(GL_BLEND)

    def unset_state(self):
        pass


class Game(pyglet.window.Window):
    def __init__(self, **kwargs):
        super().__init__(width=1280, height=720, caption=TITLE,
                         resizable=True, **kwargs)
        self.set_minimum_size(480, 320)

        atlas_data = textures.build_atlas_bytes()
        image = pyglet.image.ImageData(textures.SIZE, textures.SIZE,
                                       "RGBA", atlas_data)
        self.atlas = image.get_texture()
        glBindTexture(GL_TEXTURE_2D, self.atlas.id)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)

        self.batch = pyglet.graphics.Batch()
        tex_group = TextureGroup(self.atlas)
        self.opaque_group = OpaqueGroup(0, parent=tex_group)
        self.alpha_group = AlphaGroup(1, parent=tex_group)

        self.save_path = os.path.join(save_dir(), "world.dat")
        self.world, player_state = self._load_or_create()
        self.player = Player()
        if player_state:
            self.player.restore(player_state)
        else:
            self.player.y = self.world.height(0, 0) + 2.0

        self.render_distance = DEFAULT_RENDER_DISTANCE
        self._offsets = self._build_offsets(self.render_distance)
        self.keys = {k: False for k in
                     ("forward", "back", "left", "right", "up", "down")}
        self.sprint = False
        self.paused = False
        self.show_debug = True
        self.target = None
        self.place_at = None
        self.status = ""
        self.status_until = 0.0

        self.debug_label = pyglet.text.Label(
            "", font_name="Consolas", font_size=12, x=10, y=0,
            anchor_y="top", color=(255, 255, 255, 220), multiline=True,
            width=460)
        self.center_label = pyglet.text.Label(
            "", font_name="Consolas", font_size=18, anchor_x="center",
            anchor_y="center", color=(255, 255, 255, 235))
        self.status_label = pyglet.text.Label(
            "", font_name="Consolas", font_size=13, anchor_x="center",
            anchor_y="bottom", color=(255, 255, 255, 220))

        self._init_gl()
        self.set_exclusive_mouse(True)
        pyglet.clock.schedule_interval(self.update, 1.0 / 60.0)

    # ------------------------------------------------------------------ setup

    def _load_or_create(self):
        if os.path.exists(self.save_path):
            try:
                return World.load(self.save_path)
            except Exception:
                pass  # corrupt or old save: start fresh rather than crash
        return World(seed=int(time.time()) & 0xFFFF), None

    def _init_gl(self):
        glClearColor(*SKY, 1.0)
        glEnable(GL_DEPTH_TEST)
        glEnable(GL_CULL_FACE)
        glCullFace(GL_BACK)
        glEnable(GL_ALPHA_TEST)
        glAlphaFunc(GL_GREATER, 0.05)
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
        glEnable(GL_FOG)
        glFogfv(GL_FOG_COLOR, (GLfloat * 4)(*SKY, 1.0))
        glFogi(GL_FOG_MODE, GL_LINEAR)
        glHint(GL_FOG_HINT, GL_DONT_CARE)
        self._update_fog()

    def _update_fog(self):
        far = self.render_distance * CHUNK
        glFogf(GL_FOG_START, max(8.0, far - 28.0))
        glFogf(GL_FOG_END, far)

    @staticmethod
    def _build_offsets(radius):
        offsets = [(dx, dz)
                   for dx in range(-radius, radius + 1)
                   for dz in range(-radius, radius + 1)
                   if dx * dx + dz * dz <= radius * radius]
        offsets.sort(key=lambda o: o[0] * o[0] + o[1] * o[1])
        return offsets

    # ------------------------------------------------------------------ input

    def on_key_press(self, symbol, modifiers):
        if symbol == key.ESCAPE:
            self.paused = not self.paused
            self.set_exclusive_mouse(not self.paused)
            return pyglet.event.EVENT_HANDLED
        if self.paused:
            return
        if symbol in (key.W, key.UP):
            self.keys["forward"] = True
        elif symbol in (key.S, key.DOWN):
            self.keys["back"] = True
        elif symbol in (key.A, key.LEFT):
            self.keys["left"] = True
        elif symbol in (key.D, key.RIGHT):
            self.keys["right"] = True
        elif symbol == key.SPACE:
            self.keys["up"] = True
        elif symbol in (key.LSHIFT, key.RSHIFT):
            self.keys["down"] = True
        elif symbol in (key.LCTRL, key.RCTRL):
            self.sprint = True
        elif symbol == key.F:
            self.player.flying = not self.player.flying
            self.player.dy = 0.0
            self._flash("Fly mode: " + ("on" if self.player.flying else "off"))
        elif symbol == key.F3:
            self.show_debug = not self.show_debug
        elif symbol == key.F11:
            self.set_fullscreen(not self.fullscreen)
        elif symbol == key.BRACKETLEFT:
            self._set_render_distance(self.render_distance - 1)
        elif symbol == key.BRACKETRIGHT:
            self._set_render_distance(self.render_distance + 1)
        elif key._1 <= symbol <= key._9:
            self.player.slot = symbol - key._1
        elif symbol == key.F5:
            self._save()
            self._flash("World saved")

    def on_key_release(self, symbol, modifiers):
        if symbol in (key.W, key.UP):
            self.keys["forward"] = False
        elif symbol in (key.S, key.DOWN):
            self.keys["back"] = False
        elif symbol in (key.A, key.LEFT):
            self.keys["left"] = False
        elif symbol in (key.D, key.RIGHT):
            self.keys["right"] = False
        elif symbol == key.SPACE:
            self.keys["up"] = False
        elif symbol in (key.LSHIFT, key.RSHIFT):
            self.keys["down"] = False
        elif symbol in (key.LCTRL, key.RCTRL):
            self.sprint = False

    def on_mouse_motion(self, x, y, dx, dy):
        if not self.paused:
            self.player.look(dx, dy)

    def on_mouse_drag(self, x, y, dx, dy, buttons, modifiers):
        self.on_mouse_motion(x, y, dx, dy)

    def on_mouse_scroll(self, x, y, sx, sy):
        if self.paused:
            return
        count = len(B.HOTBAR)
        self.player.slot = (self.player.slot - int(sy)) % count

    def on_mouse_press(self, x, y, button, modifiers):
        if self.paused:
            self.paused = False
            self.set_exclusive_mouse(True)
            return
        if button == mouse.LEFT:
            self._break_block()
        elif button == mouse.RIGHT:
            self._place_block()
        elif button == mouse.MIDDLE:
            self._pick_block()

    def on_resize(self, width, height):
        glViewport(0, 0, max(1, width), max(1, height))
        return pyglet.event.EVENT_HANDLED

    def on_close(self):
        self._save()
        super().on_close()

    # ------------------------------------------------------------- world edit

    def _break_block(self):
        if self.target is None:
            return
        bx, by, bz = self.target
        block = B.REGISTRY[self.world.get_block(bx, by, bz)]
        if not block.breakable:
            self._flash("%s can't be broken" % block.name)
            return
        self.world.set_block(bx, by, bz, B.AIR)

    def _place_block(self):
        if self.place_at is None:
            return
        bx, by, bz = self.place_at
        if self.player.intersects(bx, by, bz):
            return
        current = self.world.get_block(bx, by, bz)
        if current != B.AIR and not B.REGISTRY[current].liquid:
            return
        self.world.set_block(bx, by, bz, B.HOTBAR[self.player.slot])

    def _pick_block(self):
        if self.target is None:
            return
        block_id = self.world.get_block(*self.target)
        if block_id in B.HOTBAR:
            self.player.slot = B.HOTBAR.index(block_id)

    def _set_render_distance(self, value):
        value = max(MIN_RENDER_DISTANCE, min(MAX_RENDER_DISTANCE, value))
        if value == self.render_distance:
            return
        self.render_distance = value
        self._offsets = self._build_offsets(value)
        self._update_fog()
        self._flash("Render distance: %d chunks" % value)

    def _flash(self, text, seconds=2.0):
        self.status = text
        self.status_until = time.time() + seconds

    def _save(self):
        try:
            self.world.save(self.save_path, self.player.state())
        except Exception:
            pass  # never let a save failure take the game down

    # ----------------------------------------------------------------- update

    def update(self, dt):
        if self.paused:
            return
        dt = min(dt, 0.1)  # a stalled frame shouldn't teleport the player
        self.player.update(dt, self.world, self.keys, self.sprint)
        self.target, self.place_at = self.player.raycast(self.world)
        self._stream_chunks()

    def _stream_chunks(self):
        pcx = int(math.floor(self.player.x)) >> 4
        pcz = int(math.floor(self.player.z)) >> 4
        deadline = time.perf_counter() + MESH_BUDGET
        wanted = set()

        for dx, dz in self._offsets:
            cx, cz = pcx + dx, pcz + dz
            wanted.add((cx, cz))
            chunk = self.world.chunks.get((cx, cz))
            if chunk is not None and not chunk.dirty:
                continue
            if time.perf_counter() > deadline:
                continue
            # Neighbours must exist first: border faces and trees depend on them.
            for nx in range(cx - 1, cx + 2):
                for nz in range(cz - 1, cz + 2):
                    self.world.get_chunk(nx, nz)
            chunk = self.world.get_chunk(cx, cz)
            self.world.build_mesh(chunk, self.batch,
                                  self.opaque_group, self.alpha_group)

        # Drop geometry (not terrain data) for anything far outside the view.
        limit = self.render_distance + 2
        for coords, chunk in self.world.chunks.items():
            if coords in wanted or chunk.opaque_vl is None and chunk.alpha_vl is None:
                continue
            if abs(coords[0] - pcx) > limit or abs(coords[1] - pcz) > limit:
                chunk.unload()
                chunk.dirty = True

    # ------------------------------------------------------------------- draw

    def on_draw(self):
        self.clear()
        self._setup_3d()
        self.batch.draw()
        self._draw_target()
        self._setup_2d()
        self._draw_hud()

    def _setup_3d(self):
        glEnable(GL_DEPTH_TEST)
        glEnable(GL_FOG)
        width, height = max(1, self.width), max(1, self.height)
        glMatrixMode(GL_PROJECTION)
        glLoadIdentity()
        gluPerspective(70.0, width / float(height), 0.1,
                       self.render_distance * CHUNK + 32.0)
        glMatrixMode(GL_MODELVIEW)
        glLoadIdentity()
        ex, ey, ez = self.player.eye
        fx, fy, fz = self.player.forward_vector()
        gluLookAt(ex, ey, ez, ex + fx, ey + fy, ez + fz, 0.0, 1.0, 0.0)

    def _setup_2d(self):
        glDisable(GL_DEPTH_TEST)
        glDisable(GL_FOG)
        width, height = max(1, self.width), max(1, self.height)
        glMatrixMode(GL_PROJECTION)
        glLoadIdentity()
        glOrtho(0, width, 0, height, -1, 1)
        glMatrixMode(GL_MODELVIEW)
        glLoadIdentity()
        glEnable(GL_BLEND)

    def _draw_target(self):
        if self.target is None:
            return
        x, y, z = self.target
        p = 0.003
        x0, y0, z0 = x - p, y - p, z - p
        x1, y1, z1 = x + 1 + p, y + 1 + p, z + 1 + p
        corners = [
            (x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1),
            (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1),
        ]
        edges = ((0, 1), (1, 2), (2, 3), (3, 0),
                 (4, 5), (5, 6), (6, 7), (7, 4),
                 (0, 4), (1, 5), (2, 6), (3, 7))
        verts = []
        for a, b in edges:
            verts.extend(corners[a])
            verts.extend(corners[b])
        glDisable(GL_TEXTURE_2D)
        glColor3f(0.05, 0.05, 0.05)
        glLineWidth(2.0)
        pyglet.graphics.draw(len(verts) // 3, GL_LINES, ("v3f/stream", verts))
        glColor3f(1.0, 1.0, 1.0)

    # -------------------------------------------------------------------- hud

    def _draw_hud(self):
        width, height = self.width, self.height

        if self.player.in_water:
            self._quad(0, 0, width, height, WATER_TINT)

        self._draw_crosshair(width // 2, height // 2)
        self._draw_hotbar(width)

        if self.show_debug:
            fps = pyglet.clock.get_fps()
            held = B.REGISTRY[B.HOTBAR[self.player.slot]].name
            meshed = sum(1 for c in self.world.chunks.values()
                         if c.opaque_vl is not None or c.alpha_vl is not None)
            self.debug_label.text = (
                "%s  %.0f fps\n"
                "xyz  %.1f / %.1f / %.1f\n"
                "yaw %.0f  pitch %.0f\n"
                "chunks %d meshed / %d loaded   distance %d\n"
                "holding %s   %s"
                % (TITLE, fps, self.player.x, self.player.y, self.player.z,
                   self.player.yaw, self.player.pitch, meshed,
                   len(self.world.chunks), self.render_distance, held,
                   "flying" if self.player.flying else
                   ("swimming" if self.player.in_water else "walking"))
            )
            self.debug_label.y = height - 10
            self.debug_label.draw()

        if self.status and time.time() < self.status_until:
            self.status_label.text = self.status
            self.status_label.x = width // 2
            self.status_label.y = 96
            self.status_label.draw()

        if self.paused:
            self._quad(0, 0, width, height, (0.0, 0.0, 0.0, 0.55))
            self.center_label.text = "Paused  -  click to resume, Esc to toggle"
            self.center_label.x = width // 2
            self.center_label.y = height // 2
            self.center_label.draw()

    def _draw_crosshair(self, cx, cy):
        glDisable(GL_TEXTURE_2D)
        glColor4f(1.0, 1.0, 1.0, 0.85)
        size = 9
        pyglet.graphics.draw(4, GL_LINES, ("v2f/stream", (
            cx - size, cy, cx + size, cy,
            cx, cy - size, cx, cy + size)))
        glColor4f(1.0, 1.0, 1.0, 1.0)

    def _draw_hotbar(self, width):
        slot = 46
        pad = 4
        count = len(B.HOTBAR)
        total = count * slot
        x0 = (width - total) // 2
        y0 = 14

        self._quad(x0 - pad, y0 - pad, total + pad * 2, slot + pad * 2,
                   (0.0, 0.0, 0.0, 0.45))

        glEnable(GL_TEXTURE_2D)
        glBindTexture(GL_TEXTURE_2D, self.atlas.id)
        glColor4f(1.0, 1.0, 1.0, 1.0)
        for i, block_id in enumerate(B.HOTBAR):
            u0, v0, u1, v1 = B.REGISTRY[block_id].uvs[0]
            x = x0 + i * slot + 5
            y = y0 + 5
            s = slot - 10
            pyglet.graphics.draw(4, GL_QUADS,
                                 ("v2f/stream", (x, y, x + s, y, x + s, y + s, x, y + s)),
                                 ("t2f/stream", (u0, v0, u1, v0, u1, v1, u0, v1)))
        glDisable(GL_TEXTURE_2D)

        sx = x0 + self.player.slot * slot
        self._outline(sx - 1, y0 - 1, slot + 2, slot + 2, (1.0, 1.0, 1.0, 0.95))

    @staticmethod
    def _quad(x, y, w, h, color):
        glDisable(GL_TEXTURE_2D)
        glColor4f(*color)
        pyglet.graphics.draw(4, GL_QUADS, ("v2f/stream", (
            x, y, x + w, y, x + w, y + h, x, y + h)))
        glColor4f(1.0, 1.0, 1.0, 1.0)

    @staticmethod
    def _outline(x, y, w, h, color):
        glDisable(GL_TEXTURE_2D)
        glColor4f(*color)
        glLineWidth(2.0)
        pyglet.graphics.draw(4, GL_LINE_LOOP, ("v2f/stream", (
            x, y, x + w, y, x + w, y + h, x, y + h)))
        glColor4f(1.0, 1.0, 1.0, 1.0)


def run():
    try:
        config = pyglet.gl.Config(double_buffer=True, depth_size=24,
                                  sample_buffers=1, samples=4)
        game = Game(config=config)
    except pyglet.window.NoSuchConfigException:
        game = Game()  # fall back for GPUs without multisampling
    pyglet.app.run()
    return game
