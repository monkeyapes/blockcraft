//! Multi-chunk structures, ported from shared/src/structures.ts.
//!
//! Villages and mansions span many chunks, so every chunk asks which
//! structures *could* reach it and builds each one in full through a writer
//! that discards anything outside the chunk. Generation stays a pure function
//! of (seed, chunk), and no cross-chunk state is needed.
//!
//! The TypeScript version memoises terrain heights and placements in
//! module-level maps. Those caches only exist for speed, so the port computes
//! the values they stand for; see [`crate::terrain`] for the one place heights
//! are shared within a chunk instead.

use crate::block;
use crate::noise::hash2;
use crate::terrain::{column_height, ColumnHeights};
use crate::{voxel_index, CHUNK_X, CHUNK_Z, SEA_LEVEL, WORLD_Y};

const CHUNK_X_I: i32 = CHUNK_X as i32;
const CHUNK_Z_I: i32 = CHUNK_Z as i32;
const WORLD_Y_I: i32 = WORLD_Y as i32;

/// Region sizes in chunks: one structure of each kind per region, at most.
/// Villages should turn up while exploring; mansions are meant to be a find.
pub const VILLAGE_REGION: i32 = 12;
pub const MANSION_REGION: i32 = 40;

/// Half-extent of the largest structure, in chunks, used as the search radius.
const SEARCH_CHUNKS: i32 = 3;

/// The kinds of multi-chunk structure.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum StructureKind {
    Village,
    Mansion,
}

/// Where a structure stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Placement {
    pub kind: StructureKind,
    /// World coordinates of the structure's centre.
    pub x: i32,
    pub z: i32,
    /// Half-extent on x and z, for the overlap test.
    pub radius: i32,
}

/// Terrain heights, answered from the chunk's own table when it has them.
trait Heights {
    fn height(&self, x: i32, z: i32) -> i32;
}

impl Heights for ColumnHeights {
    fn height(&self, x: i32, z: i32) -> i32 {
        self.at(x, z)
    }
}

/// Plain uncached heights, for callers with no chunk in hand.
struct Uncached(i32);

impl Heights for Uncached {
    fn height(&self, x: i32, z: i32) -> i32 {
        column_height(self.0, x, z)
    }
}

/// The structure of this kind whose chosen chunk is (cx, cz), if the site
/// passes the land and flatness tests.
///
/// Exposed for tests and for tools that want to locate structures.
pub fn find_placement(seed: i32, kind: StructureKind, cx: i32, cz: i32) -> Option<Placement> {
    compute_placement(seed, kind, cx, cz, &Uncached(seed))
}

fn compute_placement(
    seed: i32,
    kind: StructureKind,
    cx: i32,
    cz: i32,
    heights: &impl Heights,
) -> Option<Placement> {
    let (region, salt) = match kind {
        StructureKind::Village => (VILLAGE_REGION, 5501),
        StructureKind::Mansion => (MANSION_REGION, 7703),
    };
    let rx = cx.div_euclid(region);
    let rz = cz.div_euclid(region);
    let s = seed.wrapping_add(salt);

    let pick_x = rx * region + (hash2(rx, rz, s) * region as f64).floor() as i32;
    let pick_z = rz * region + (hash2(rx + 311, rz - 197, s) * region as f64).floor() as i32;
    if pick_x != cx || pick_z != cz {
        return None;
    }

    let x = cx * CHUNK_X_I + 8;
    let z = cz * CHUNK_Z_I + 8;

    // Only on land, and only where the ground is reasonably even: a village
    // draped over a cliff looks broken however it is built.
    let h = heights.height(x, z);
    if h <= SEA_LEVEL + 2 || h >= 78 {
        return None;
    }

    let radius = if kind == StructureKind::Village {
        26
    } else {
        14
    };
    let mut lowest = h;
    let mut highest = h;
    let mut dz = -radius;
    while dz <= radius {
        let mut dx = -radius;
        while dx <= radius {
            let sample = heights.height(x + dx, z + dz);
            lowest = lowest.min(sample);
            highest = highest.max(sample);
            dx += 6;
        }
        dz += 6;
    }
    // Structures level their own ground, so this only rules out genuine cliffs.
    if highest - lowest
        > if kind == StructureKind::Village {
            24
        } else {
            20
        }
    {
        return None;
    }
    // Only a site sitting substantially in open water is refused.
    if lowest <= SEA_LEVEL - 6 {
        return None;
    }
    Some(Placement { kind, x, z, radius })
}

// --------------------------------------------------------------- the writer

/// A block writer bound to one chunk.
///
/// It carries the chunk's bounds so the drawing primitives can clamp their
/// loops: every chunk a structure overlaps rebuilds that structure in full,
/// so without clamping a village spanning 25 chunks does 25x the work.
struct Writer<'a, H: Heights> {
    data: &'a mut [u8],
    seed: i32,
    heights: &'a H,
    /// Inclusive chunk bounds in world coordinates.
    x0: i32,
    x1: i32,
    z0: i32,
    z1: i32,
}

impl<H: Heights> Writer<'_, H> {
    #[inline]
    fn write(&mut self, x: i32, y: i32, z: i32, id: u8) {
        if !(1..WORLD_Y_I).contains(&y) {
            return;
        }
        let lx = x - self.x0;
        let lz = z - self.z0;
        if !(0..CHUNK_X_I).contains(&lx) || !(0..CHUNK_Z_I).contains(&lz) {
            return;
        }
        self.data[voxel_index(lx as usize, y as usize, lz as usize)] = id;
    }

    fn height(&self, x: i32, z: i32) -> i32 {
        self.heights.height(x, z)
    }

    // ------------------------------------------------------------ primitives

    #[allow(clippy::too_many_arguments)]
    fn fill(&mut self, x0: i32, y0: i32, z0: i32, x1: i32, y1: i32, z1: i32, id: u8) {
        let ax = x0.max(self.x0);
        let bx = x1.min(self.x1);
        let az = z0.max(self.z0);
        let bz = z1.min(self.z1);
        for y in y0..=y1 {
            for z in az..=bz {
                for x in ax..=bx {
                    self.write(x, y, z, id);
                }
            }
        }
    }

    /// Walls only: the box's sides, with the interior left alone.
    #[allow(clippy::too_many_arguments)]
    fn walls(&mut self, x0: i32, y0: i32, z0: i32, x1: i32, y1: i32, z1: i32, id: u8) {
        // Clamp the iteration, but test "is this an edge" against the true box.
        let ax = x0.max(self.x0);
        let bx = x1.min(self.x1);
        let az = z0.max(self.z0);
        let bz = z1.min(self.z1);
        for y in y0..=y1 {
            for z in az..=bz {
                for x in ax..=bx {
                    if x == x0 || x == x1 || z == z0 || z == z1 {
                        self.write(x, y, z, id);
                    }
                }
            }
        }
    }

    /// A stepped pyramid roof, one ring inset per level.
    #[allow(clippy::too_many_arguments)]
    fn roof(&mut self, x0: i32, y: i32, z0: i32, x1: i32, z1: i32, id: u8, levels: i32) {
        for i in 0..levels {
            let ax = x0 + i;
            let az = z0 + i;
            let bx = x1 - i;
            let bz = z1 - i;
            if ax > bx || az > bz {
                break;
            }
            let cz0 = az.max(self.z0);
            let cz1 = bz.min(self.z1);
            let cx0 = ax.max(self.x0);
            let cx1 = bx.min(self.x1);
            for z in cz0..=cz1 {
                for x in cx0..=cx1 {
                    if x == ax || x == bx || z == az || z == bz || i == levels - 1 {
                        self.write(x, y + i, z, id);
                    }
                }
            }
        }
    }

    /// Cuts a flat pad at `y` across the footprint, filling hollows down to
    /// the terrain and shaving anything above: natural ground swings tens of
    /// blocks across a village, so structures cannot simply be dropped on it.
    #[allow(clippy::too_many_arguments)]
    fn level_ground(
        &mut self,
        x0: i32,
        z0: i32,
        x1: i32,
        z1: i32,
        y: i32,
        surface: u8,
        headroom: i32,
    ) {
        let az = z0.max(self.z0);
        let bz = z1.min(self.z1);
        let ax = x0.max(self.x0);
        let bx = x1.min(self.x1);
        for z in az..=bz {
            for x in ax..=bx {
                let terrain = self.height(x, z);
                // Shave everything above the pad, including any hill standing over it.
                let top = (y + headroom).max(terrain + 1);
                for cy in y..=top {
                    self.write(x, cy, z, block::Air);
                }
                // Fill down to meet the ground so nothing is left floating.
                for cy in terrain.min(y - 1)..=y - 1 {
                    self.write(x, cy, z, if cy == y - 1 { surface } else { block::Dirt });
                }
            }
        }
    }

    /// Clears the space a building occupies and gives it a foundation.
    #[allow(clippy::too_many_arguments)]
    fn clear_and_found(
        &mut self,
        x0: i32,
        y: i32,
        z0: i32,
        x1: i32,
        z1: i32,
        height: i32,
        floor: u8,
    ) {
        self.level_ground(x0, z0, x1, z1, y, floor, height + 3);
    }

    // --------------------------------------------------------------- village

    fn build_house(&mut self, x: i32, ground_y: i32, z: i32, width: i32, depth: i32) {
        let x0 = x - (width >> 1);
        let x1 = x0 + width - 1;
        let z0 = z - (depth >> 1);
        let z1 = z0 + depth - 1;
        let wall_height = 4;
        let top = ground_y + wall_height;

        self.clear_and_found(
            x0 - 1,
            ground_y,
            z0 - 1,
            x1 + 1,
            z1 + 1,
            wall_height + 3,
            block::Planks,
        );

        self.walls(x0, ground_y, z0, x1, top - 1, z1, block::Planks);
        // Log posts at the corners read as timber framing.
        for (cx, cz) in [(x0, z0), (x1, z0), (x0, z1), (x1, z1)] {
            self.fill(cx, ground_y, cz, cx, top - 1, cz, block::Log);
        }

        self.fill(x0, top, z0, x1, top, z1, block::Planks);
        self.roof(x0 - 1, top, z0 - 1, x1 + 1, z1 + 1, block::Cobblestone, 3);

        // Doorway on the -x wall, windows on the others.
        let door_z = z0 + (depth >> 1);
        self.fill(x0, ground_y, door_z, x0, ground_y + 1, door_z, block::Air);

        let window_y = ground_y + 2;
        let mut wz = z0 + 2;
        while wz < z1 {
            self.write(x1, window_y, wz, block::Glass);
            wz += 2;
        }
        let mut wx = x0 + 2;
        while wx < x1 {
            self.write(wx, window_y, z0, block::Glass);
            self.write(wx, window_y, z1, block::Glass);
            wx += 2;
        }

        // A little furniture, so interiors are not bare boxes.
        let r = hash2(x, z, self.seed.wrapping_add(88));
        let furniture = if r < 0.5 {
            block::CraftingTable
        } else {
            block::Furnace
        };
        self.write(x0 + 1, ground_y, z0 + 1, furniture);
        self.write(x1 - 1, ground_y + 2, z1 - 1, block::Glowstone);
    }

    fn build_lamp(&mut self, x: i32, ground_y: i32, z: i32) {
        self.fill(x, ground_y, z, x, ground_y + 3, z, block::Log);
        self.write(x, ground_y + 4, z, block::Glowstone);
    }

    fn build_village(&mut self, place: &Placement) {
        let seed = self.seed;
        let (px, pz) = (place.x, place.z);
        // One level for the whole settlement, so it reads as a planned place
        // rather than houses scattered down a hillside.
        let ground_y = self.height(px, pz) + 1;

        // A gravel crossroads through the middle, cut into the terrain.
        self.level_ground(px - 20, pz - 2, px + 20, pz + 2, ground_y, block::Gravel, 4);
        self.level_ground(px - 2, pz - 20, px + 2, pz + 20, ground_y, block::Gravel, 4);

        // A well at the crossing.
        self.walls(
            px - 2,
            ground_y,
            pz - 2,
            px + 2,
            ground_y + 1,
            pz + 2,
            block::Cobblestone,
        );
        self.fill(
            px - 1,
            ground_y - 1,
            pz - 1,
            px + 1,
            ground_y - 1,
            pz + 1,
            block::Water,
        );

        // Houses on plots either side of the roads, with deterministic jitter.
        const PLOTS: [(i32, i32); 8] = [
            (-14, -12),
            (14, -12),
            (-14, 12),
            (14, 12),
            (-16, 0),
            (16, 0),
            (0, -16),
            (0, 16),
        ];
        for (i, (ox, oz)) in PLOTS.into_iter().enumerate() {
            let (sx, sz) = (px + ox, pz + oz);
            let roll = hash2(sx, sz, seed.wrapping_add(4400 + i as i32));
            if roll > 0.82 {
                continue; // a gap in the village keeps it from looking stamped
            }
            let jx = (hash2(sx, sz, seed.wrapping_add(91)) * 3.0).floor() as i32 - 1;
            let jz = (hash2(sx, sz, seed.wrapping_add(137)) * 3.0).floor() as i32 - 1;
            let wide = roll < 0.4;
            // Every house shares the village's level, not its own column height.
            self.build_house(sx + jx, ground_y, sz + jz, if wide { 9 } else { 7 }, 7);
        }

        for (lx, lz) in [(-7, -7), (7, -7), (-7, 7), (7, 7)] {
            let x = px + lx;
            let z = pz + lz;
            self.level_ground(x - 1, z - 1, x + 1, z + 1, ground_y, block::Gravel, 6);
            self.build_lamp(x, ground_y, z);
        }
    }

    // --------------------------------------------------------------- mansion

    fn build_mansion(&mut self, place: &Placement) {
        let (px, pz) = (place.x, place.z);
        let ground_y = self.height(px, pz) + 1;
        let half = 11;
        let x0 = px - half;
        let x1 = px + half;
        let z0 = pz - half;
        let z1 = pz + half;
        let floors = 3;
        let floor_height = 5;

        self.clear_and_found(
            x0 - 1,
            ground_y,
            z0 - 1,
            x1 + 1,
            z1 + 1,
            floors * floor_height + 6,
            block::Planks,
        );

        for f in 0..floors {
            let base = ground_y + f * floor_height;
            let top = base + floor_height - 1;

            self.walls(x0, base, z0, x1, top - 1, z1, block::Planks);

            // Log pillars at the corners and at regular intervals along each wall.
            let mut x = x0;
            while x <= x1 {
                self.fill(x, base, z0, x, top - 1, z0, block::Log);
                self.fill(x, base, z1, x, top - 1, z1, block::Log);
                x += 5;
            }
            let mut z = z0;
            while z <= z1 {
                self.fill(x0, base, z, x0, top - 1, z, block::Log);
                self.fill(x1, base, z, x1, top - 1, z, block::Log);
                z += 5;
            }

            // Ceiling for this storey (the top one gets a roof instead).
            if f < floors - 1 {
                self.fill(x0, top, z0, x1, top, z1, block::Planks);
            }

            // Windows.
            let wy = base + 2;
            let mut x = x0 + 2;
            while x < x1 {
                self.write(x, wy, z0, block::Glass);
                self.write(x, wy, z1, block::Glass);
                self.write(x + 1, wy, z0, block::Glass);
                self.write(x + 1, wy, z1, block::Glass);
                x += 5;
            }
            let mut z = z0 + 2;
            while z < z1 {
                self.write(x0, wy, z, block::Glass);
                self.write(x1, wy, z, block::Glass);
                self.write(x0, wy, z + 1, block::Glass);
                self.write(x1, wy, z + 1, block::Glass);
                z += 5;
            }

            // Interior: a cross of partition walls making four rooms, with doorways.
            self.walls(px, base, z0 + 1, px, top - 1, z1 - 1, block::Planks);
            self.walls(x0 + 1, base, pz, x1 - 1, top - 1, pz, block::Planks);
            for (dx, dz) in [(0, -5), (0, 5), (-5, 0), (5, 0)] {
                self.fill(
                    px + dx,
                    base,
                    pz + dz,
                    px + dx,
                    base + 1,
                    pz + dz,
                    block::Air,
                );
            }

            // Lighting and a little loot-room flavour per floor.
            for (cx, cz) in [(-6, -6), (6, -6), (-6, 6), (6, 6)] {
                self.write(px + cx, top - 1, pz + cz, block::Glowstone);
            }
            if f == floors - 1 {
                self.write(px - 4, base, pz - 4, block::DiamondOre);
                self.write(px + 4, base, pz + 4, block::IronBlock);
            } else {
                self.write(px - 4, base, pz - 4, block::CraftingTable);
                self.write(px + 4, base, pz + 4, block::Furnace);
            }

            // Stairwell: a hole through the ceiling with steps up to it.
            if f < floors - 1 {
                self.fill(x0 + 2, top, z0 + 2, x0 + 4, top, z0 + 4, block::Air);
                for s in 0..4 {
                    self.fill(
                        x0 + 2,
                        base,
                        z0 + 2 + s,
                        x0 + 4,
                        base + s,
                        z0 + 2 + s,
                        block::Cobblestone,
                    );
                }
            }
        }

        // Grand entrance and a roof.
        let door_z = pz;
        self.fill(
            x0,
            ground_y,
            door_z - 1,
            x0,
            ground_y + 2,
            door_z + 1,
            block::Air,
        );
        self.roof(
            x0 - 1,
            ground_y + floors * floor_height - 1,
            z0 - 1,
            x1 + 1,
            z1 + 1,
            block::Cobblestone,
            5,
        );
    }
}

/// Builds any structure overlapping this chunk, writing only inside it.
pub(crate) fn build_structures(
    seed: i32,
    cx: i32,
    cz: i32,
    data: &mut [u8],
    heights: &ColumnHeights,
) {
    let ox = cx * CHUNK_X_I;
    let oz = cz * CHUNK_Z_I;
    let mut writer = Writer {
        data,
        seed,
        heights,
        x0: ox,
        x1: ox + CHUNK_X_I - 1,
        z0: oz,
        z1: oz + CHUNK_Z_I - 1,
    };

    for dz in -SEARCH_CHUNKS..=SEARCH_CHUNKS {
        for dx in -SEARCH_CHUNKS..=SEARCH_CHUNKS {
            for kind in [StructureKind::Village, StructureKind::Mansion] {
                let Some(place) = compute_placement(seed, kind, cx + dx, cz + dz, heights) else {
                    continue;
                };
                // Skip structures whose footprint cannot reach this chunk.
                if place.x + place.radius < writer.x0 || place.x - place.radius > writer.x1 {
                    continue;
                }
                if place.z + place.radius < writer.z0 || place.z - place.radius > writer.z1 {
                    continue;
                }
                match kind {
                    StructureKind::Village => writer.build_village(&place),
                    StructureKind::Mansion => writer.build_mansion(&place),
                }
            }
        }
    }
}
