//! The local player: movement, collision and block targeting.
//!
//! A port of the core of client/src/player.ts, keeping its constants and its
//! reasons. Movement is resolved one axis at a time against the blocks' real
//! collision boxes, so a conveyor stops you at belt height and a cable only
//! blocks the thin run it occupies; a low ledge is stepped onto rather than
//! jumped; and the cursor hits a block's selection boxes rather than its
//! cell.

use glam::Vec3;
use worldgen::WORLD_Y;

use crate::content::{Aabb, BlockTable};
use crate::world::Voxels;

pub const PLAYER_WIDTH: f32 = 0.6;
pub const PLAYER_HEIGHT: f32 = 1.8;
pub const EYE_HEIGHT: f32 = 1.62;

const GRAVITY: f32 = 28.0;
const TERMINAL: f32 = 58.0;
const JUMP_SPEED: f32 = 8.8;
const WALK_SPEED: f32 = 4.6;
const SPRINT_SPEED: f32 = 7.4;
const SNEAK_SPEED: f32 = 2.0;
const FLY_SPEED: f32 = 12.0;
const FLY_SPRINT: f32 = 28.0;
const CLIMB_SPEED: f32 = 4.0;
const CLIMB_MOVE_SPEED: f32 = 2.6;
const SWIM_SPEED: f32 = 3.6;
pub const REACH: f32 = 6.0;
/// Longest distance any single collision step may cover, in blocks. One long
/// frame at terminal velocity would otherwise tunnel through the floor: the
/// collision test only sees where a step starts and ends.
const MAX_STEP: f32 = 0.35;
/// Shrinks the body a hair so resting flush against a face does not count as
/// overlapping the block behind it -- otherwise standing against a wall makes
/// the vertical resolver find the wall and lift you onto it.
const SKIN: f32 = 1e-4;
/// Tallest ledge a walking body climbs without jumping.
const STEP_HEIGHT: f32 = 0.6;
/// How far past the blocking face to place the body when stepping up.
const STEP_PROBE: f32 = 1e-3;

#[derive(Default, Clone, Copy, Debug)]
pub struct Input {
    pub forward: bool,
    pub back: bool,
    pub left: bool,
    pub right: bool,
    pub jump: bool,
    pub sneak: bool,
    pub sprint: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RaycastHit {
    pub block: [i32; 3],
    /// Where a placed block goes: the cell beyond the struck face, or the
    /// struck cell itself when what is there is replaceable (tall grass).
    pub place: [i32; 3],
    pub id: u8,
    /// Outward normal of the struck face.
    pub face: [i32; 3],
    /// Distance along the ray.
    pub t: f32,
}

/// Ray against cell-local boxes: entry distance and outward face normal.
pub fn ray_boxes(
    o: Vec3,
    d: Vec3,
    cell: [i32; 3],
    boxes: &[Aabb],
    max_t: f32,
) -> Option<(f32, [i32; 3])> {
    let mut best: Option<(f32, [i32; 3])> = None;
    let o = o.to_array();
    let d = d.to_array();
    for b in boxes {
        let mut t_min = 0.0f32;
        let mut t_max = max_t;
        let mut face = [0, 1, 0];
        let mut miss = false;
        for a in 0..3 {
            let lo = cell[a] as f32 + b.min[a];
            let hi = cell[a] as f32 + b.max[a];
            if d[a].abs() < 1e-9 {
                if o[a] < lo || o[a] > hi {
                    miss = true;
                    break;
                }
                continue;
            }
            let mut t1 = (lo - o[a]) / d[a];
            let mut t2 = (hi - o[a]) / d[a];
            // Entering through the low face means the normal points down
            // that axis; through the high face, up it.
            let mut sign = -1;
            if t1 > t2 {
                std::mem::swap(&mut t1, &mut t2);
                sign = 1;
            }
            if t1 > t_min {
                t_min = t1;
                face = [0, 0, 0];
                face[a] = sign;
            }
            t_max = t_max.min(t2);
            if t_min > t_max {
                miss = true;
                break;
            }
        }
        if !miss && best.is_none_or(|(t, _)| t_min < t) {
            best = Some((t_min, face));
        }
    }
    best
}

#[derive(Debug, Clone)]
pub struct Player {
    /// Feet position: centre of the body's footprint, at its lowest point.
    pub pos: Vec3,
    /// Degrees; -90 looks toward -z, like the web game.
    pub yaw: f32,
    pub pitch: f32,
    pub vel: Vec3,
    pub flying: bool,
    pub on_ground: bool,
    pub in_liquid: bool,
    sneaking: bool,
}

impl Player {
    pub fn new(pos: Vec3) -> Self {
        Player {
            pos,
            yaw: -90.0,
            pitch: 0.0,
            vel: Vec3::ZERO,
            flying: false,
            on_ground: false,
            in_liquid: false,
            sneaking: false,
        }
    }

    pub fn eye(&self) -> Vec3 {
        self.pos + Vec3::new(0.0, EYE_HEIGHT, 0.0)
    }

    pub fn forward(&self) -> Vec3 {
        let (sy, cy) = self.yaw.to_radians().sin_cos();
        let (sp, cp) = self.pitch.to_radians().sin_cos();
        Vec3::new(cy * cp, sp, sy * cp)
    }

    /// Mouse look, in raw counts; sensitivity is degrees per count.
    pub fn look(&mut self, dx: f32, dy: f32, sensitivity: f32) {
        self.yaw = (self.yaw + dx * sensitivity) % 360.0;
        self.pitch = (self.pitch - dy * sensitivity).clamp(-89.9, 89.9);
    }

    fn cell(v: f32) -> i32 {
        v.floor() as i32
    }

    fn block_at<W: Voxels>(world: &W, x: f32, y: f32, z: f32) -> u8 {
        world.block(Self::cell(x), Self::cell(y), Self::cell(z))
    }

    pub fn update<W: Voxels>(&mut self, dt: f32, world: &W, table: &BlockTable, input: &Input) {
        // An unloaded chunk reads as air; without this the player would drop
        // through terrain that has not streamed in yet.
        if !world.loaded(Self::cell(self.pos.x), Self::cell(self.pos.z)) {
            self.vel.y = 0.0;
            return;
        }
        let head = Self::block_at(world, self.pos.x, self.pos.y + EYE_HEIGHT, self.pos.z);
        self.in_liquid = table.get(head).liquid;
        self.sneaking = input.sneak;

        // What the feet are in and stand on sets grip and pace: ice keeps you
        // sliding, soul sand and cobwebs hold you back.
        let feet = table.get(Self::block_at(
            world,
            self.pos.x,
            self.pos.y + 0.1,
            self.pos.z,
        ));
        let under = table.get(Self::block_at(
            world,
            self.pos.x,
            self.pos.y - 0.05,
            self.pos.z,
        ));
        let pace = feet.speed_factor.min(if self.on_ground {
            under.speed_factor
        } else {
            1.0
        });
        let slip = if self.on_ground {
            under.slipperiness
        } else {
            0.0
        };

        let (fz, fx) = self.yaw.to_radians().sin_cos();
        let (mut mx, mut mz) = (0.0f32, 0.0f32);
        if input.forward {
            mx += fx;
            mz += fz;
        }
        if input.back {
            mx -= fx;
            mz -= fz;
        }
        if input.right {
            mx -= fz;
            mz += fx;
        }
        if input.left {
            mx += fz;
            mz -= fx;
        }
        let len = (mx * mx + mz * mz).sqrt();
        if len > 0.0 {
            mx /= len;
            mz /= len;
        }

        if self.flying {
            let speed = if input.sprint { FLY_SPRINT } else { FLY_SPEED };
            self.vel = Vec3::ZERO;
            let mut vy = 0.0;
            if input.jump {
                vy += speed;
            }
            if input.sneak {
                vy -= speed;
            }
            self.move_by(world, table, Vec3::new(mx * speed, vy, mz * speed) * dt);
            self.on_ground = false;
            return;
        }

        // A ladder at the feet or chest is climbable: checked at both so the
        // bottom rung catches you and you do not drop off at the top.
        let on_ladder = table
            .get(Self::block_at(
                world,
                self.pos.x,
                self.pos.y + 0.2,
                self.pos.z,
            ))
            .climbable
            || table
                .get(Self::block_at(
                    world,
                    self.pos.x,
                    self.pos.y + 1.2,
                    self.pos.z,
                ))
                .climbable;
        if on_ladder && !self.in_liquid {
            // Climbing overrides gravity: jump goes up, sneak down, and
            // otherwise you hang still rather than sliding off.
            self.vel.y = if input.jump {
                CLIMB_SPEED
            } else if input.sneak {
                -CLIMB_SPEED
            } else {
                0.0
            };
            let d = Vec3::new(mx * CLIMB_MOVE_SPEED, self.vel.y, mz * CLIMB_MOVE_SPEED) * dt;
            self.move_by(world, table, d);
            self.on_ground = true;
            return;
        }

        let mut speed;
        if self.in_liquid {
            speed = SWIM_SPEED;
            self.vel.y = (self.vel.y - GRAVITY * 0.3 * dt).max(-4.0);
            if input.jump {
                self.vel.y = 4.4;
            }
        } else {
            speed = if input.sneak {
                SNEAK_SPEED
            } else if input.sprint {
                SPRINT_SPEED
            } else {
                WALK_SPEED
            };
            if input.jump && self.on_ground {
                self.vel.y = JUMP_SPEED * if pace < 0.5 { 0.6 } else { 1.0 };
            }
            self.vel.y = (self.vel.y - GRAVITY * dt).max(-TERMINAL);
            // A cobweb holds a falling body too, not just a walking one.
            if feet.speed_factor < 0.5 && self.vel.y < -2.0 {
                self.vel.y = -2.0;
            }
        }
        speed *= pace;

        // Ordinary ground answers the controls at once; ice lets the old
        // velocity linger, so you slide past where you meant to stop.
        let response = if slip > 0.0 {
            1.0 - slip.powf(dt * 10.0)
        } else {
            1.0
        };
        self.vel.x += (mx * speed - self.vel.x) * response;
        self.vel.z += (mz * speed - self.vel.z) * response;
        self.move_by(world, table, self.vel * dt);
    }

    fn move_by<W: Voxels>(&mut self, world: &W, table: &BlockTable, d: Vec3) {
        let longest = d.abs().max_element();
        let steps = ((longest / MAX_STEP).ceil() as i32).clamp(1, 16);
        let s = d / steps as f32;
        for _ in 0..steps {
            self.step(world, table, s);
        }
    }

    fn step<W: Voxels>(&mut self, world: &W, table: &BlockTable, d: Vec3) {
        // One axis at a time, so walking into a wall slides along it.
        self.pos.x += d.x;
        if self.resolve(world, table, 0, d.x) {
            self.try_step_up(world, table, 0, d.x);
        }
        self.pos.z += d.z;
        if self.resolve(world, table, 2, d.z) {
            self.try_step_up(world, table, 2, d.z);
        }
        self.pos.y += d.y;
        if self.resolve(world, table, 1, d.y) {
            // Already bounced earlier this frame: later sub-steps still carry
            // the frame's downward travel and would land the bounce dead.
            if d.y < 0.0 && self.vel.y > 0.0 {
                return;
            }
            let bounce = if d.y < 0.0 && !self.sneaking {
                table
                    .get(Self::block_at(
                        world,
                        self.pos.x,
                        self.pos.y - 0.05,
                        self.pos.z,
                    ))
                    .bounce
            } else {
                0.0
            };
            if bounce > 0.0 && self.vel.y < -3.0 {
                self.vel.y = -self.vel.y * bounce;
                self.on_ground = false;
                return;
            }
            if d.y < 0.0 {
                self.on_ground = true;
            }
            self.vel.y = 0.0;
        } else if d.y != 0.0 {
            self.on_ground = false;
        }
    }

    /// Walks up a small ledge instead of stopping dead at it -- a conveyor is
    /// a 3/16 slab, and without this it is a wall you have to jump. Only from
    /// the ground: from mid-air it would climb sheer faces.
    fn try_step_up<W: Voxels>(&mut self, world: &W, table: &BlockTable, axis: usize, delta: f32) {
        if !self.on_ground || delta == 0.0 {
            return;
        }
        let Some(rise) = self.ledge_height(world, table, axis, delta) else {
            return;
        };
        if rise <= 0.0 || rise > STEP_HEIGHT {
            return;
        }
        let saved = self.pos;
        self.pos.y += rise;
        let nudge = if delta > 0.0 { STEP_PROBE } else { -STEP_PROBE };
        if axis == 0 {
            self.pos.x += nudge;
        } else {
            self.pos.z += nudge;
        }
        // Only if the body fits up there; otherwise it would be pushed into a
        // one-block gap and stuck in the ceiling.
        if self.overlaps(world, table) {
            self.pos = saved;
        }
    }

    /// How far above the feet the blocking ledge sits, or None if unblocked.
    fn ledge_height<W: Voxels>(
        &self,
        world: &W,
        table: &BlockTable,
        axis: usize,
        delta: f32,
    ) -> Option<f32> {
        let probe = PLAYER_WIDTH / 2.0 - SKIN;
        let ahead = if delta > 0.0 {
            probe + STEP_PROBE
        } else {
            -probe - STEP_PROBE
        };
        let px = if axis == 0 {
            self.pos.x + ahead
        } else {
            self.pos.x
        };
        let pz = if axis == 2 {
            self.pos.z + ahead
        } else {
            self.pos.z
        };
        let bx = Self::cell(px);
        let bz = Self::cell(pz);
        let mut top: Option<f32> = None;
        // Only the cell at the feet: a ledge is something to step onto, and
        // anything higher is a wall whatever its shape.
        for by in Self::cell(self.pos.y) - 1..=Self::cell(self.pos.y + STEP_HEIGHT) {
            let id = world.block(bx, by, bz);
            if !table.solid[id as usize] {
                continue;
            }
            for b in &table.get(id).collision {
                // Only the part of the shape at the leading edge: a stair's tall
                // back half is the next step, not this one.
                let (along, lo, hi) = if axis == 0 {
                    (px - bx as f32, b.min[0], b.max[0])
                } else {
                    (pz - bz as f32, b.min[2], b.max[2])
                };
                if along < lo || along > hi {
                    continue;
                }
                let (across, alo, ahi) = if axis == 0 {
                    (self.pos.z - bz as f32, b.min[2], b.max[2])
                } else {
                    (self.pos.x - bx as f32, b.min[0], b.max[0])
                };
                if across + probe <= alo || across - probe >= ahi {
                    continue;
                }
                let box_top = by as f32 + b.max[1];
                if box_top <= self.pos.y + SKIN {
                    continue;
                }
                top = Some(top.map_or(box_top, |t: f32| t.max(box_top)));
            }
        }
        top.map(|t| t - self.pos.y)
    }

    fn body(&self) -> ([f32; 3], [f32; 3]) {
        let probe = PLAYER_WIDTH / 2.0 - SKIN;
        (
            [self.pos.x - probe, self.pos.y + SKIN, self.pos.z - probe],
            [
                self.pos.x + probe,
                self.pos.y + PLAYER_HEIGHT - SKIN,
                self.pos.z + probe,
            ],
        )
    }

    /// Calls `f` with each solid collision box, in world space, in the cells
    /// the body spans -- plus one cell lower, because a fence's collision
    /// stands half a block above its own cell.
    fn for_each_box<W: Voxels>(
        world: &W,
        table: &BlockTable,
        lo: [f32; 3],
        hi: [f32; 3],
        mut f: impl FnMut([f32; 3], [f32; 3]),
    ) {
        let y1 = Self::cell(hi[1]).min(WORLD_Y as i32 - 1);
        for bx in Self::cell(lo[0])..=Self::cell(hi[0]) {
            for by in Self::cell(lo[1]) - 1..=y1 {
                for bz in Self::cell(lo[2])..=Self::cell(hi[2]) {
                    let id = world.block(bx, by, bz);
                    if !table.solid[id as usize] {
                        continue;
                    }
                    for b in &table.get(id).collision {
                        f(
                            [
                                bx as f32 + b.min[0],
                                by as f32 + b.min[1],
                                bz as f32 + b.min[2],
                            ],
                            [
                                bx as f32 + b.max[0],
                                by as f32 + b.max[1],
                                bz as f32 + b.max[2],
                            ],
                        );
                    }
                }
            }
        }
    }

    /// Is the body overlapping any solid shape where it stands?
    fn overlaps<W: Voxels>(&self, world: &W, table: &BlockTable) -> bool {
        let (lo, hi) = self.body();
        let mut hit = false;
        Self::for_each_box(world, table, lo, hi, |b_lo, b_hi| {
            if (0..3).all(|a| b_lo[a] < hi[a] && b_hi[a] > lo[a]) {
                hit = true;
            }
        });
        hit
    }

    /// Pushes the body out of whatever it moved into along `axis`, flush
    /// against the nearest blocking face. Returns whether anything blocked.
    fn resolve<W: Voxels>(
        &mut self,
        world: &W,
        table: &BlockTable,
        axis: usize,
        delta: f32,
    ) -> bool {
        if delta == 0.0 {
            return false;
        }
        let (lo, hi) = self.body();
        // The face nearest the one we are moving into. Taking whichever box
        // the scan reached first would snap the player to the far side of a
        // two-thick wall, which reads as walking through it.
        let mut edge: Option<f32> = None;
        Self::for_each_box(world, table, lo, hi, |b_lo, b_hi| {
            // Only a box the body now overlaps on all three axes is in the
            // way; the scan reaches one cell low, and the floor under the
            // feet must not read as a ceiling.
            if (0..3).any(|a| b_hi[a] <= lo[a] || b_lo[a] >= hi[a]) {
                return;
            }
            let candidate = if delta > 0.0 { b_lo[axis] } else { b_hi[axis] };
            edge = Some(match edge {
                None => candidate,
                Some(e) if delta > 0.0 => e.min(candidate),
                Some(e) => e.max(candidate),
            });
        });
        let Some(edge) = edge else {
            return false;
        };
        let half = PLAYER_WIDTH / 2.0;
        match axis {
            0 => {
                self.pos.x = if delta < 0.0 {
                    edge + half
                } else {
                    edge - half
                }
            }
            1 => {
                self.pos.y = if delta < 0.0 {
                    edge
                } else {
                    edge - PLAYER_HEIGHT
                }
            }
            _ => {
                self.pos.z = if delta < 0.0 {
                    edge + half
                } else {
                    edge - half
                }
            }
        }
        true
    }

    /// Voxel walk from the eye along the view, hitting selection boxes.
    pub fn raycast<W: Voxels>(
        &self,
        world: &W,
        table: &BlockTable,
        reach: f32,
    ) -> Option<RaycastHit> {
        raycast(world, table, self.eye(), self.forward(), reach)
    }

    /// Would a block placed at this cell overlap the body? Tested against
    /// the block's own collision boxes, so a slab can go down beside your
    /// feet and a flower where you stand.
    pub fn intersects(&self, table: &BlockTable, cell: [i32; 3], id: u8) -> bool {
        if !table.solid[id as usize] {
            return false;
        }
        let half = PLAYER_WIDTH / 2.0;
        let p = self.pos;
        table.get(id).collision.iter().any(|b| {
            let lo = [
                cell[0] as f32 + b.min[0],
                cell[1] as f32 + b.min[1],
                cell[2] as f32 + b.min[2],
            ];
            let hi = [
                cell[0] as f32 + b.max[0],
                cell[1] as f32 + b.max[1],
                cell[2] as f32 + b.max[2],
            ];
            hi[0] > p.x - half
                && lo[0] < p.x + half
                && hi[1] > p.y
                && lo[1] < p.y + PLAYER_HEIGHT
                && hi[2] > p.z - half
                && lo[2] < p.z + half
        })
    }
}

/// Voxel DDA along a ray. Each non-air, non-liquid cell is only a candidate:
/// the ray has to strike the block's selection boxes, or it carries on past
/// a torch's side or between a flower's leaves.
pub fn raycast<W: Voxels>(
    world: &W,
    table: &BlockTable,
    origin: Vec3,
    dir: Vec3,
    reach: f32,
) -> Option<RaycastHit> {
    let mut b = [
        origin.x.floor() as i32,
        origin.y.floor() as i32,
        origin.z.floor() as i32,
    ];
    let o = origin.to_array();
    let d = dir.to_array();
    let step = d.map(|v| if v > 0.0 { 1 } else { -1 });
    let delta = d.map(|v| {
        if v != 0.0 {
            (1.0 / v).abs()
        } else {
            f32::INFINITY
        }
    });
    let mut t_max = [0.0f32; 3];
    for a in 0..3 {
        t_max[a] = if d[a] > 0.0 {
            (b[a] as f32 + 1.0 - o[a]) / d[a]
        } else if d[a] < 0.0 {
            (b[a] as f32 - o[a]) / d[a]
        } else {
            f32::INFINITY
        };
    }
    let mut travelled = 0.0;
    while travelled <= reach {
        let id = world.block(b[0], b[1], b[2]);
        if id != 0 && !table.get(id).liquid {
            if let Some((t, face)) = ray_boxes(origin, dir, b, &table.get(id).selection, reach) {
                let place = if table.is_replaceable(id) {
                    b
                } else {
                    [b[0] + face[0], b[1] + face[1], b[2] + face[2]]
                };
                return Some(RaycastHit {
                    block: b,
                    place,
                    id,
                    face,
                    t,
                });
            }
        }
        let a = if t_max[0] <= t_max[1] && t_max[0] <= t_max[2] {
            0
        } else if t_max[1] <= t_max[2] {
            1
        } else {
            2
        };
        travelled = t_max[a];
        b[a] += step[a];
        t_max[a] += delta[a];
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// A sparse little world for physics tests: everything is loaded.
    #[derive(Default)]
    struct TestWorld(HashMap<[i32; 3], u8>);

    impl TestWorld {
        fn set(&mut self, x: i32, y: i32, z: i32, id: u8) {
            self.0.insert([x, y, z], id);
        }
        fn floor(&mut self, y: i32, id: u8) {
            for x in -8..8 {
                for z in -8..8 {
                    self.set(x, y, z, id);
                }
            }
        }
    }

    impl Voxels for TestWorld {
        fn block(&self, x: i32, y: i32, z: i32) -> u8 {
            *self.0.get(&[x, y, z]).unwrap_or(&0)
        }
        fn loaded(&self, _: i32, _: i32) -> bool {
            true
        }
    }

    fn table() -> BlockTable {
        BlockTable::load(None).unwrap()
    }

    const STONE: u8 = 3;

    fn settle(p: &mut Player, w: &TestWorld, t: &BlockTable, input: &Input, seconds: f32) {
        for _ in 0..(seconds * 60.0) as i32 {
            p.update(1.0 / 60.0, w, t, input);
        }
    }

    #[test]
    fn falls_and_lands_on_the_floor() {
        let t = table();
        let mut w = TestWorld::default();
        w.floor(0, STONE);
        let mut p = Player::new(Vec3::new(0.5, 10.0, 0.5));
        settle(&mut p, &w, &t, &Input::default(), 2.0);
        assert!((p.pos.y - 1.0).abs() < 1e-4, "{}", p.pos.y);
        assert!(p.on_ground);
    }

    #[test]
    fn a_long_frame_does_not_tunnel_through_the_floor() {
        let t = table();
        let mut w = TestWorld::default();
        w.floor(0, STONE);
        let mut p = Player::new(Vec3::new(0.5, 3.0, 0.5));
        p.vel.y = -TERMINAL;
        p.update(0.1, &w, &t, &Input::default());
        assert!(p.pos.y >= 1.0 - 1e-4, "{}", p.pos.y);
    }

    #[test]
    fn walls_stop_walking() {
        let t = table();
        let mut w = TestWorld::default();
        w.floor(0, STONE);
        for y in 1..4 {
            for z in -8..8 {
                w.set(3, y, z, STONE);
            }
        }
        let mut p = Player::new(Vec3::new(0.5, 1.0, 0.5));
        p.yaw = 0.0; // facing +x
        let walk = Input {
            forward: true,
            ..Default::default()
        };
        settle(&mut p, &w, &t, &walk, 2.0);
        assert!(
            (p.pos.x - (3.0 - PLAYER_WIDTH / 2.0)).abs() < 1e-3,
            "{}",
            p.pos.x
        );
        assert!(
            (p.pos.y - 1.0).abs() < 1e-4,
            "stayed on the floor: {}",
            p.pos.y
        );
    }

    #[test]
    fn low_ledges_are_stepped_onto_and_full_blocks_are_not() {
        let t = table();
        let belt = t.id_by_name("Conveyor Belt").unwrap();
        let mut w = TestWorld::default();
        w.floor(0, STONE);
        for z in -8..8 {
            w.set(2, 1, z, belt);
            w.set(5, 1, z, STONE);
        }
        let mut p = Player::new(Vec3::new(0.5, 1.0, 0.5));
        p.yaw = 0.0;
        let walk = Input {
            forward: true,
            ..Default::default()
        };
        settle(&mut p, &w, &t, &walk, 0.1);
        settle(&mut p, &w, &t, &walk, 0.7);
        // Up onto the belt at 3/16 without jumping ...
        assert!(p.pos.x > 2.3, "crossed onto the belt: {}", p.pos.x);
        settle(&mut p, &w, &t, &walk, 2.0);
        // ... but a full block is a wall.
        assert!(
            (p.pos.x - (5.0 - PLAYER_WIDTH / 2.0)).abs() < 1e-3,
            "{}",
            p.pos.x
        );
        assert!(p.pos.y < 1.5, "{}", p.pos.y);
    }

    #[test]
    fn standing_on_a_slab_rests_at_its_top() {
        let t = table();
        let belt = t.id_by_name("Conveyor Belt").unwrap();
        let mut w = TestWorld::default();
        w.floor(0, STONE);
        w.set(0, 1, 0, belt);
        let mut p = Player::new(Vec3::new(0.5, 3.0, 0.5));
        settle(&mut p, &w, &t, &Input::default(), 1.0);
        assert!((p.pos.y - (1.0 + 3.0 / 16.0)).abs() < 1e-3, "{}", p.pos.y);
    }

    #[test]
    fn jumping_clears_one_block() {
        let t = table();
        let mut w = TestWorld::default();
        w.floor(0, STONE);
        let mut p = Player::new(Vec3::new(0.5, 1.0, 0.5));
        settle(&mut p, &w, &t, &Input::default(), 0.2);
        let jump = Input {
            jump: true,
            ..Default::default()
        };
        let mut peak: f32 = 0.0;
        for _ in 0..60 {
            p.update(1.0 / 60.0, &w, &t, &jump);
            peak = peak.max(p.pos.y);
        }
        assert!(peak > 2.2 && peak < 2.6, "peak {peak}");
    }

    #[test]
    fn flying_ignores_gravity() {
        let t = table();
        let w = TestWorld::default();
        let mut p = Player::new(Vec3::new(0.5, 50.0, 0.5));
        p.flying = true;
        settle(&mut p, &w, &t, &Input::default(), 1.0);
        assert_eq!(p.pos.y, 50.0);
    }

    #[test]
    fn frozen_over_unloaded_ground() {
        struct Nothing;
        impl Voxels for Nothing {
            fn block(&self, _: i32, _: i32, _: i32) -> u8 {
                0
            }
            fn loaded(&self, _: i32, _: i32) -> bool {
                false
            }
        }
        let t = table();
        let mut p = Player::new(Vec3::new(0.5, 50.0, 0.5));
        for _ in 0..60 {
            p.update(1.0 / 60.0, &Nothing, &t, &Input::default());
        }
        assert_eq!(p.pos.y, 50.0);
    }

    #[test]
    fn raycast_hits_the_face_it_enters() {
        let t = table();
        let mut w = TestWorld::default();
        w.set(0, 0, -3, STONE);
        let hit = raycast(
            &w,
            &t,
            Vec3::new(0.5, 0.5, 0.5),
            Vec3::new(0.0, 0.0, -1.0),
            REACH,
        )
        .unwrap();
        assert_eq!(hit.block, [0, 0, -3]);
        assert_eq!(hit.face, [0, 0, 1]);
        assert_eq!(hit.place, [0, 0, -2]);
        assert!((hit.t - 2.5).abs() < 1e-5);
    }

    #[test]
    fn raycast_uses_selection_boxes_not_cells() {
        let t = table();
        let torch = t.id_by_name("Torch").unwrap();
        let mut w = TestWorld::default();
        w.set(0, 0, -2, torch);
        w.set(0, 0, -4, STONE);
        // Through the torch's cell, off to the side of its stick: misses the
        // torch and hits the stone behind.
        let side = raycast(
            &w,
            &t,
            Vec3::new(0.15, 0.3, 0.5),
            Vec3::new(0.0, 0.0, -1.0),
            REACH,
        )
        .unwrap();
        assert_eq!(side.block, [0, 0, -4]);
        // Straight at the stick: hits the torch.
        let centre = raycast(
            &w,
            &t,
            Vec3::new(0.5, 0.3, 0.5),
            Vec3::new(0.0, 0.0, -1.0),
            REACH,
        )
        .unwrap();
        assert_eq!(centre.block, [0, 0, -2]);
        assert_eq!(centre.id, torch);
    }

    #[test]
    fn raycast_hits_a_slab_top_mid_cell() {
        let t = table();
        let belt = t.id_by_name("Conveyor Belt").unwrap();
        let mut w = TestWorld::default();
        w.set(0, 0, 0, belt);
        let hit = raycast(
            &w,
            &t,
            Vec3::new(0.5, 3.0, 0.5),
            Vec3::new(0.0, -1.0, 0.0),
            REACH,
        )
        .unwrap();
        assert_eq!(hit.face, [0, 1, 0]);
        assert!((hit.t - (3.0 - 3.0 / 16.0)).abs() < 1e-5, "{}", hit.t);
        assert_eq!(hit.place, [0, 1, 0]);
    }

    #[test]
    fn raycast_replaces_replaceable_blocks_in_place() {
        let t = table();
        let grass = t.id_by_name("Tall Grass").unwrap();
        assert!(t.is_replaceable(grass));
        let mut w = TestWorld::default();
        w.set(0, 0, 0, grass);
        let hit = raycast(
            &w,
            &t,
            Vec3::new(0.5, 2.0, 0.5),
            Vec3::new(0.0, -1.0, 0.0),
            REACH,
        )
        .unwrap();
        assert_eq!(hit.place, [0, 0, 0]);
    }

    #[test]
    fn raycast_passes_through_water_and_stops_at_reach() {
        let t = table();
        let water = t.id_by_name("Water").unwrap();
        let mut w = TestWorld::default();
        w.set(0, 0, -1, water);
        w.set(0, 0, -10, STONE);
        assert!(raycast(
            &w,
            &t,
            Vec3::new(0.5, 0.5, 0.5),
            Vec3::new(0.0, 0.0, -1.0),
            REACH
        )
        .is_none());
    }

    #[test]
    fn placing_into_the_body_is_refused_but_beside_it_is_fine() {
        let t = table();
        let p = Player::new(Vec3::new(0.5, 1.0, 0.5));
        assert!(p.intersects(&t, [0, 1, 0], STONE));
        assert!(p.intersects(&t, [0, 2, 0], STONE));
        assert!(!p.intersects(&t, [0, 3, 0], STONE));
        assert!(!p.intersects(&t, [1, 1, 0], STONE));
        let flower = t.id_by_name("Poppy").unwrap();
        assert!(!p.intersects(&t, [0, 1, 0], flower));
    }
}
