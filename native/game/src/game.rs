//! The game itself, independent of any window: world streaming, the player,
//! the hotbar, and what the mouse buttons do.
//!
//! The windowed app and the offscreen `--screenshot` run both drive this the
//! same way -- `tick`, then draw what `view` describes -- so a screenshot
//! shows exactly what a player would see.

use std::sync::Arc;

use glam::{Mat4, Vec3};
use worldgen::{CHUNK_X, WORLD_Y};

use crate::content::BlockTable;
use crate::hud::HOTBAR_SIZE;
use crate::jobs::JobPool;
use crate::player::{Input, Player, RaycastHit, REACH};
use crate::streaming::{Event, Streamer};
use crate::world::{chunk_of, surface_y, Voxels};

/// The overworld's sky, also the fog colour (client/src/dimension.ts).
pub const SKY: [f32; 3] = [0.55, 0.72, 0.93];
/// Floor brightness, so a cave is gloomy rather than black.
pub const AMBIENT: f32 = 0.06;
/// Fog is full strength at this fraction of the far plane (dimension.ts).
const FOG_FAR: f32 = 0.95;
/// Vertical field of view in degrees, the web game's default.
pub const FOV: f32 = 72.0;
/// Degrees of turn per raw mouse count: the web game's default setting.
pub const MOUSE_SENSITIVITY: f32 = 0.12;
/// Two jump presses closer together than this toggle flying.
const DOUBLE_TAP: f32 = 0.3;
/// Holding a mouse button repeats its action: first after this delay ...
const REPEAT_DELAY: f32 = 0.3;
/// ... then at this interval.
const REPEAT_EVERY: f32 = 0.2;

/// The blocks a new player starts with: the building basics, plus a slab,
/// stairs, glass and a torch, so every kind of shape is at hand to try.
const STARTER: [&str; HOTBAR_SIZE] = [
    "Grass Block",
    "Cobblestone",
    "Planks",
    "Log",
    "Stone Bricks",
    "Glass",
    "Stone Slab",
    "Plank Stairs",
    "Torch",
];

pub struct Game {
    pub table: Arc<BlockTable>,
    pub pool: JobPool,
    pub streamer: Streamer,
    pub player: Player,
    pub input: Input,
    pub hotbar: [u8; HOTBAR_SIZE],
    pub selected: usize,
    pub target: Option<RaycastHit>,
    /// Mouse buttons held: (break, place).
    held: (bool, bool),
    repeat_in: f32,
    time: f32,
    last_jump: f32,
}

/// What the camera sees, for the renderer.
pub struct View {
    pub view_proj: Mat4,
    pub eye: Vec3,
    pub fog: (f32, f32),
}

impl Game {
    pub fn new(table: Arc<BlockTable>, seed: i32, distance: i32, threads: usize) -> Self {
        // Spawn on the surface at 0,0: generate that one chunk here, which
        // takes a millisecond, rather than wait for the pool to reach it.
        let spawn = worldgen::generate_chunk(seed, worldgen::Dimension::Overworld, 0, 0);
        let y = surface_y(&spawn, &table, 0, 0).min(WORLD_Y as i32 - 2);
        let mut hotbar = [0u8; HOTBAR_SIZE];
        for (slot, name) in hotbar.iter_mut().zip(STARTER) {
            *slot = table.id_by_name(name).unwrap_or(0);
        }
        Game {
            pool: JobPool::new(threads, seed, table.clone()),
            streamer: Streamer::new(table.clone(), distance),
            table,
            player: Player::new(Vec3::new(0.5, y as f32, 0.5)),
            input: Input::default(),
            hotbar,
            selected: 0,
            target: None,
            held: (false, false),
            repeat_in: 0.0,
            time: 0.0,
            last_jump: f32::NEG_INFINITY,
        }
    }

    /// Advances the world by `dt` seconds and returns what the renderer
    /// needs to upload or free.
    pub fn tick(&mut self, dt: f32) -> Vec<Event> {
        self.time += dt;
        let p = self.player.pos;
        let events = self
            .streamer
            .update(chunk_of(p.x.floor() as i32, p.z.floor() as i32), &self.pool);
        // A long frame (a window drag, a breakpoint) is not replayed in full:
        // the player moves at most a tenth of a second at once.
        self.player
            .update(dt.min(0.1), &self.streamer.world, &self.table, &self.input);
        self.target = self
            .player
            .raycast(&self.streamer.world, &self.table, REACH);

        if self.held.0 || self.held.1 {
            self.repeat_in -= dt;
            if self.repeat_in <= 0.0 {
                self.repeat_in = REPEAT_EVERY;
                if self.held.0 {
                    self.break_target();
                } else {
                    self.place_target();
                }
            }
        }
        events
    }

    /// A mouse button went down (`true` = break, `false` = place) or up.
    pub fn button(&mut self, breaking: bool, down: bool) {
        if breaking {
            self.held.0 = down;
        } else {
            self.held.1 = down;
        }
        if down {
            self.repeat_in = REPEAT_DELAY;
            if breaking {
                self.break_target();
            } else {
                self.place_target();
            }
        }
    }

    /// Jump pressed: a quick second press toggles flying.
    pub fn jump_pressed(&mut self) {
        if self.time - self.last_jump < DOUBLE_TAP {
            self.toggle_flying();
            self.last_jump = f32::NEG_INFINITY;
        } else {
            self.last_jump = self.time;
        }
    }

    pub fn toggle_flying(&mut self) {
        self.player.flying = !self.player.flying;
        self.player.vel = Vec3::ZERO;
    }

    pub fn select(&mut self, slot: usize) {
        self.selected = slot.min(HOTBAR_SIZE - 1);
    }

    /// Mouse wheel: one notch moves one slot, wrapping round.
    pub fn scroll(&mut self, notches: i32) {
        let n = HOTBAR_SIZE as i32;
        self.selected = (self.selected as i32 - notches).rem_euclid(n) as usize;
    }

    pub fn break_target(&mut self) -> bool {
        let Some(hit) = self.target else {
            return false;
        };
        if !self.table.get(hit.id).breakable {
            return false;
        }
        let [x, y, z] = hit.block;
        let done = self.streamer.set_block(x, y, z, 0, &self.pool);
        self.refresh_target();
        done
    }

    pub fn place_target(&mut self) -> bool {
        let Some(hit) = self.target else {
            return false;
        };
        let id = self.hotbar[self.selected];
        let [x, y, z] = hit.place;
        if id == 0 || y < 0 || y >= WORLD_Y as i32 {
            return false;
        }
        let world = &self.streamer.world;
        if !self.table.is_replaceable(world.block(x, y, z))
            || self.player.intersects(&self.table, hit.place, id)
        {
            return false;
        }
        let done = self.streamer.set_block(x, y, z, id, &self.pool);
        self.refresh_target();
        done
    }

    /// The world changed under the cursor; aim again before the next repeat.
    fn refresh_target(&mut self) {
        self.target = self
            .player
            .raycast(&self.streamer.world, &self.table, REACH);
    }

    /// Camera matrices and fog for a framebuffer of this aspect ratio.
    pub fn view(&self, aspect: f32) -> View {
        let far = (self.streamer.radius * CHUNK_X as i32 + 48) as f32;
        let eye = self.player.eye();
        let proj = glam::camera::rh::proj::directx::perspective(FOV.to_radians(), aspect, 0.1, far);
        let view = glam::camera::rh::view::look_to_mat4(eye, self.player.forward(), Vec3::Y);
        View {
            view_proj: proj * view,
            eye,
            fog: (far * FOG_FAR * 0.58, far * FOG_FAR),
        }
    }

    /// The targeted block's selection boxes, in world space.
    pub fn outline(&self) -> Vec<(Vec3, Vec3)> {
        let Some(hit) = self.target else {
            return Vec::new();
        };
        let at = Vec3::new(
            hit.block[0] as f32,
            hit.block[1] as f32,
            hit.block[2] as f32,
        );
        self.table
            .get(hit.id)
            .selection
            .iter()
            .map(|b| (at + Vec3::from(b.min), at + Vec3::from(b.max)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn game() -> Game {
        let table = Arc::new(BlockTable::load(None).unwrap());
        Game::new(table, 1, 2, 2)
    }

    fn settle(g: &mut Game) {
        let start = Instant::now();
        loop {
            g.tick(1.0 / 60.0);
            if g.streamer.settled() && g.player.on_ground {
                break;
            }
            assert!(
                start.elapsed() < Duration::from_secs(60),
                "world never settled"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    #[test]
    fn spawns_standing_on_the_surface() {
        let mut g = game();
        let start_y = g.player.pos.y;
        settle(&mut g);
        assert!(
            (g.player.pos.y - start_y).abs() < 1e-3,
            "{start_y} -> {}",
            g.player.pos.y
        );
        let below = g.streamer.world.block(0, start_y as i32 - 1, 0);
        assert!(g.table.get(below).solid);
    }

    #[test]
    fn the_starter_hotbar_is_all_real_blocks() {
        let g = game();
        assert!(g.hotbar.iter().all(|&id| id != 0 && g.table.get(id).known));
    }

    #[test]
    fn looking_down_breaks_and_places_the_block_underfoot() {
        let mut g = game();
        settle(&mut g);
        g.player.pitch = -89.0;
        g.tick(0.0);
        let hit = g.target.expect("looking at the ground");
        let [x, y, z] = hit.block;
        assert_eq!(y, g.player.pos.y as i32 - 1);
        assert!(g.break_target());
        assert_eq!(g.streamer.world.block(x, y, z), 0);
        // Hover, and fill the hole back in: the ray now strikes the block
        // below it, and the new block goes on that block's top face.
        g.player.flying = true;
        g.tick(0.0);
        g.select(1);
        let target = g.target.expect("the block below the hole");
        assert_eq!(target.block, [x, y - 1, z]);
        assert_eq!(target.place, [x, y, z]);
        assert!(g.place_target());
        assert_eq!(g.streamer.world.block(x, y, z), g.hotbar[1]);
        // But not into the cell the body stands in.
        g.player.pitch = 0.0;
        g.player.pos.y += 0.5;
        assert!(g.player.intersects(&g.table, [x, y + 1, z], g.hotbar[1]));
    }

    #[test]
    fn double_tapping_jump_toggles_flying() {
        let mut g = game();
        g.jump_pressed();
        g.tick(0.1);
        g.jump_pressed();
        assert!(g.player.flying);
        g.tick(0.5);
        g.jump_pressed();
        assert!(g.player.flying, "a lone press does not toggle");
    }
}
