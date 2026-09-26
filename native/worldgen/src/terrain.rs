//! World generation, ported from shared/src/terrain.ts.
//!
//! Every function here mirrors one in the TypeScript file, in the same order
//! of operations, because the point is not "similar terrain" but the same
//! bytes: a native client and a web client standing in the same world must
//! see the same blocks, and the server only ever sends edits on top of them.

use crate::block;
use crate::noise::{contrast, fbm2, fbm3, hash2, hash3, js_hypot, value2};
use crate::structures::build_structures;
use crate::{voxel_index, Dimension, CHUNK_VOLUME, CHUNK_X, CHUNK_Z, SEA_LEVEL, WORLD_Y};

const WORLD_Y_I: i32 = WORLD_Y as i32;
const CHUNK_X_I: i32 = CHUNK_X as i32;
const CHUNK_Z_I: i32 = CHUNK_Z as i32;

/// Terrain height of a column: continents, hills and a little roughness.
pub fn column_height(seed: i32, x: i32, z: i32) -> i32 {
    let (xf, zf) = (x as f64, z as f64);
    let continent = contrast(fbm2(xf / 260.0, zf / 260.0, seed, 3, 0.5), 2.4);
    let hills = contrast(
        fbm2(xf / 55.0, zf / 55.0, seed.wrapping_add(701), 4, 0.5),
        2.6,
    );
    let rough = contrast(
        fbm2(xf / 17.0, zf / 17.0, seed.wrapping_add(1301), 2, 0.5),
        2.0,
    );

    let mut h = 26.0 + continent * 42.0;
    h += (hills - 0.5) * 30.0 * (0.3 + continent);
    h += (rough - 0.5) * 5.0;
    (h.floor() as i32).clamp(3, WORLD_Y_I - 30)
}

// --- biomes -------------------------------------------------------------------

/// What a stretch of land is like. Biomes change only what grows on the
/// ground and what it is made of at the surface -- never the height.
///
/// The discriminants are the TypeScript enum's values, which the game stores
/// and sends, so they must not be reordered.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Biome {
    Plains = 0,
    Forest = 1,
    Taiga = 2,
    SnowyTaiga = 3,
    Desert = 4,
    Swamp = 5,
    Mountains = 6,
}

impl Biome {
    /// Every biome, in id order.
    pub const ALL: [Biome; 7] = [
        Biome::Plains,
        Biome::Forest,
        Biome::Taiga,
        Biome::SnowyTaiga,
        Biome::Desert,
        Biome::Swamp,
        Biome::Mountains,
    ];

    /// The biome with this id, if there is one.
    pub fn from_id(id: u8) -> Option<Biome> {
        Biome::ALL.get(id as usize).copied()
    }

    /// The name shown to players (the TypeScript `BIOME_NAMES`).
    pub fn name(self) -> &'static str {
        BIOME_NAMES[self as usize]
    }
}

/// Display names indexed by biome id, as in the TypeScript `BIOME_NAMES`.
pub const BIOME_NAMES: [&str; 7] = [
    "Plains",
    "Forest",
    "Taiga",
    "Snowy Taiga",
    "Desert",
    "Swamp",
    "Mountains",
];

/// Above this the ground is bare rock.
pub const MOUNTAIN_Y: i32 = 84;
/// Peaks above this carry snow whatever the climate.
pub const SNOWLINE_Y: i32 = 92;

/// Temperature and humidity of a column, each 0..1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Climate {
    pub temp: f64,
    pub wet: f64,
}

/// Two broad, two-octave noise fields: climate should change over hundreds
/// of blocks, and a biome that flickers every few steps reads as noise.
pub fn climate_at(seed: i32, x: i32, z: i32) -> Climate {
    let (xf, zf) = (x as f64, z as f64);
    Climate {
        temp: contrast(
            fbm2(xf / 420.0, zf / 420.0, seed.wrapping_add(2101), 2, 0.5),
            2.2,
        ),
        wet: contrast(
            fbm2(xf / 360.0, zf / 360.0, seed.wrapping_add(3303), 2, 0.5),
            2.2,
        ),
    }
}

/// The biome of a column, computing its height.
pub fn biome_at(seed: i32, x: i32, z: i32) -> Biome {
    biome_at_height(seed, x, z, column_height(seed, x, z))
}

/// The biome of a column whose terrain height `h` the caller already has.
pub fn biome_at_height(seed: i32, x: i32, z: i32, h: i32) -> Biome {
    if h >= MOUNTAIN_Y {
        return Biome::Mountains;
    }
    let Climate { temp, wet } = climate_at(seed, x, z);
    if temp < 0.16 {
        return Biome::SnowyTaiga;
    }
    if temp < 0.3 {
        return Biome::Taiga;
    }
    if temp > 0.68 && wet < 0.45 {
        return Biome::Desert;
    }
    if wet > 0.68 {
        return Biome::Swamp;
    }
    if wet > 0.46 {
        return Biome::Forest;
    }
    Biome::Plains
}

/// Chance a column is a tree candidate, by biome id. Candidates still have
/// to be the lowest roll among their eight neighbours.
const TREE_DENSITY: [f64; 7] = [0.006, 0.075, 0.045, 0.03, 0.0, 0.02, 0.01];
const MAX_TREE_DENSITY: f64 = 0.075;
/// How far outside a chunk a tree can start and still reach in.
const TREE_MARGIN: i32 = 3;

// --- ores and rock ------------------------------------------------------------

fn ore_at(seed: i32, x: i32, y: i32, z: i32) -> Option<u8> {
    let r = hash3(x, y, z, seed.wrapping_add(9001));
    if y < 16 && r < 0.0022 {
        return Some(block::DiamondOre);
    }
    if y < 30 && r < 0.005 {
        return Some(block::GoldOre);
    }
    if y < 52 && r < 0.011 {
        return Some(block::IronOre);
    }
    if y < 72 && r < 0.024 {
        return Some(block::CoalOre);
    }
    None
}

/// Copper veins per chunk, and the depth band they sit in.
pub const COPPER_VEINS: i32 = 7;
pub const COPPER_Y: (i32, i32) = (18, 62);
/// Ruby is rare and deep: at most one small pocket per chunk.
pub const RUBY_CHANCE: f64 = 0.45;
pub const RUBY_Y: (i32, i32) = (4, 18);

/// Grows a small vein by a random walk, replacing only stone. Veins stay
/// inside their own chunk, so no neighbour ever needs to know about them.
#[allow(clippy::too_many_arguments)]
fn vein(
    data: &mut [u8],
    seed: i32,
    cx: i32,
    cz: i32,
    index: i32,
    ore: u8,
    y_range: (i32, i32),
    size: i32,
) {
    let hx = cx.wrapping_mul(31).wrapping_add(index);
    let hz = cz.wrapping_mul(17).wrapping_sub(index);
    let hs = seed.wrapping_add(6161);
    let h = |k: i32| hash3(hx, k, hz, hs);
    let mut lx = 1 + (h(1) * 14.0).floor() as i32;
    let mut lz = 1 + (h(2) * 14.0).floor() as i32;
    let mut y = y_range.0 + (h(3) * (y_range.1 - y_range.0) as f64).floor() as i32;
    for i in 0..size {
        let idx = voxel_index(lx as usize, y as usize, lz as usize);
        if data[idx] == block::Stone {
            data[idx] = ore;
        }
        let step = (h(10 + i) * 6.0).floor() as i32;
        match step {
            0 => lx = (lx + 1).min(14),
            1 => lx = (lx - 1).max(1),
            2 => lz = (lz + 1).min(14),
            3 => lz = (lz - 1).max(1),
            4 => y = (y + 1).min(y_range.1),
            _ => y = (y - 1).max(y_range.0),
        }
    }
}

/// Pockets of granite, slate and limestone through the stone.
///
/// Blobs live on a 16-block lattice and a chunk looks at the cells around it
/// too, so a blob straddling a chunk edge is carved identically from both
/// sides. Only plain stone is replaced: ores stay put and caves stay open.
fn rock_pockets(seed: i32, cx: i32, cz: i32, data: &mut [u8]) {
    let ox = cx * CHUNK_X_I;
    let oz = cz * CHUNK_Z_I;
    for gz in cz - 1..=cz + 1 {
        for gx in cx - 1..=cx + 1 {
            for gy in 0..5 {
                if hash3(gx, gy, gz, seed.wrapping_add(5151)) > 0.7 {
                    continue;
                }
                let bx = (gx * 16) as f64 + hash3(gx, gy, gz, seed.wrapping_add(5252)) * 16.0;
                let by = (4 + gy * 16) as f64 + hash3(gx, gy, gz, seed.wrapping_add(5353)) * 16.0;
                let bz = (gz * 16) as f64 + hash3(gx, gy, gz, seed.wrapping_add(5454)) * 16.0;
                let r = 2.5 + hash3(gx, gy, gz, seed.wrapping_add(5555)) * 2.5;
                let pick = hash3(gx, gy, gz, seed.wrapping_add(5656));
                // Slate is the deep rock, limestone the shallow one, granite anywhere.
                let rock = if by < 30.0 {
                    if pick < 0.6 {
                        block::Slate
                    } else {
                        block::Granite
                    }
                } else if pick < 0.5 {
                    block::Granite
                } else if pick < 0.8 {
                    block::Limestone
                } else {
                    block::Slate
                };
                let x0 = ox.max((bx - r).floor() as i32);
                let x1 = (ox + CHUNK_X_I - 1).min((bx + r).ceil() as i32);
                let z0 = oz.max((bz - r).floor() as i32);
                let z1 = (oz + CHUNK_Z_I - 1).min((bz + r).ceil() as i32);
                if x0 > x1 || z0 > z1 {
                    continue;
                }
                let y0 = 2.max((by - r).floor() as i32);
                let y1 = (WORLD_Y_I - 1).min((by + r).ceil() as i32);
                for y in y0..=y1 {
                    let dy = (y as f64 - by) * 1.3; // a little flattened, like bedded rock
                    for z in z0..=z1 {
                        for x in x0..=x1 {
                            let dx = x as f64 - bx;
                            let dz = z as f64 - bz;
                            if dx * dx + dy * dy + dz * dz > r * r {
                                continue;
                            }
                            let i = voxel_index((x - ox) as usize, y as usize, (z - oz) as usize);
                            if data[i] == block::Stone {
                                data[i] = rock;
                            }
                        }
                    }
                }
            }
        }
    }
}

// --- trees --------------------------------------------------------------------

/// The kinds of tree the world grows (and saplings grow into).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TreeKind {
    Oak,
    Birch,
    Pine,
}

/// One block of a tree, relative to the cell its trunk starts in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TreeCell {
    pub dx: i32,
    pub dy: i32,
    pub dz: i32,
    pub id: u8,
    /// Trunk blocks overwrite whatever is there; leaves only fill air.
    pub trunk: bool,
}

/// Trunk height for a tree, from a 0..1 roll.
pub fn tree_height(kind: TreeKind, roll: f64) -> i32 {
    let extra = (roll * 3.0).floor() as i32;
    match kind {
        TreeKind::Birch => 5 + extra,
        TreeKind::Pine => 7 + extra,
        TreeKind::Oak => 4 + extra,
    }
}

/// Every block of a tree, trunk first.
///
/// One definition serves world generation and a sapling growing in play, so
/// a tree you plant is the same tree you find. The order matters: cells are
/// written in sequence and leaves never replace what is already there.
pub fn tree_cells(kind: TreeKind, height: i32) -> Vec<TreeCell> {
    let (log, leaves) = match kind {
        TreeKind::Birch => (block::BirchLog, block::BirchLeaves),
        TreeKind::Pine => (block::PineLog, block::PineLeaves),
        TreeKind::Oak => (block::Log, block::Leaves),
    };
    let mut cells = Vec::with_capacity(96);
    for i in 0..height {
        cells.push(TreeCell {
            dx: 0,
            dy: i,
            dz: 0,
            id: log,
            trunk: true,
        });
    }
    let top = height - 1;

    // A square layer of the given radius; `round` drops its four corners.
    let mut layer = |dy: i32, radius: i32, round: bool| {
        for dz in -radius..=radius {
            for dx in -radius..=radius {
                if dx == 0 && dz == 0 && dy <= top {
                    continue;
                }
                if round && radius > 0 && dx.abs() == radius && dz.abs() == radius {
                    continue;
                }
                cells.push(TreeCell {
                    dx,
                    dy,
                    dz,
                    id: leaves,
                    trunk: false,
                });
            }
        }
    };

    match kind {
        TreeKind::Oak => {
            layer(top - 1, 2, true);
            layer(top, 2, true);
            layer(top + 1, 1, true);
            layer(top + 2, 0, false);
        }
        TreeKind::Birch => {
            layer(top - 2, 2, true);
            layer(top - 1, 2, true);
            layer(top, 1, false);
            layer(top + 1, 1, true);
        }
        TreeKind::Pine => {
            // Radii from the tip down: a point, then tiers that step out and
            // back in again, which gives a conifer its layered silhouette.
            const RADII: [i32; 9] = [0, 1, 1, 2, 1, 2, 3, 2, 3];
            const BOTTOM: i32 = 2; // bare trunk below this
            let mut dy = top + 1;
            let mut i = 0;
            while dy >= BOTTOM && i < RADII.len() {
                let r = RADII[i];
                layer(dy, r, r != 1 || i % 2 == 1);
                dy -= 1;
                i += 1;
            }
        }
    }
    cells
}

/// Which tree a biome grows at a spot.
fn tree_kind_for(biome: Biome, roll: f64) -> TreeKind {
    match biome {
        Biome::Taiga | Biome::SnowyTaiga | Biome::Mountains => TreeKind::Pine,
        Biome::Forest if roll < 0.4 => TreeKind::Birch,
        _ => TreeKind::Oak,
    }
}

fn is_tree_spot(seed: i32, x: i32, z: i32, chance: f64) -> bool {
    let s = seed.wrapping_add(99);
    let r = hash2(x, z, s);
    if r > chance {
        return false;
    }
    // Only the local minimum of the 3x3 neighbourhood wins, which spaces trees out.
    for dz in -1..=1 {
        for dx in -1..=1 {
            if dx == 0 && dz == 0 {
                continue;
            }
            if hash2(x + dx, z + dz, s) < r {
                return false;
            }
        }
    }
    true
}

/// Writes a block only if it lands inside the chunk being generated, and
/// (unless `overwrite`) only into air.
#[allow(clippy::too_many_arguments)]
#[inline]
fn put(data: &mut [u8], ox: i32, oz: i32, x: i32, y: i32, z: i32, id: u8, overwrite: bool) {
    if !(0..WORLD_Y_I).contains(&y) {
        return;
    }
    let lx = x - ox;
    let lz = z - oz;
    if !(0..CHUNK_X_I).contains(&lx) || !(0..CHUNK_Z_I).contains(&lz) {
        return;
    }
    let i = voxel_index(lx as usize, y as usize, lz as usize);
    if !overwrite && data[i] != block::Air {
        return;
    }
    data[i] = id;
}

#[allow(clippy::too_many_arguments)]
fn place_tree(
    data: &mut [u8],
    ox: i32,
    oz: i32,
    seed: i32,
    x: i32,
    z: i32,
    ground_y: i32,
    kind: TreeKind,
) {
    let height = tree_height(kind, hash2(x, z, seed.wrapping_add(4242)));
    let base = ground_y + 1;
    for c in tree_cells(kind, height) {
        put(data, ox, oz, x + c.dx, base + c.dy, z + c.dz, c.id, c.trunk);
    }
}

// --- strongholds --------------------------------------------------------------

/// Chunks between strongholds. One per region, so they are findable.
pub const STRONGHOLD_REGION: i32 = 24;
pub const STRONGHOLD_Y: i32 = 18;

/// The stronghold chunk of a region, as chunk coordinates.
fn stronghold_chunk(seed: i32, rx: i32, rz: i32) -> (i32, i32) {
    let pick = hash2(rx, rz, seed.wrapping_add(7777));
    let offset = (pick * STRONGHOLD_REGION as f64 * STRONGHOLD_REGION as f64).floor() as i32;
    (
        rx * STRONGHOLD_REGION + offset % STRONGHOLD_REGION,
        rz * STRONGHOLD_REGION + offset / STRONGHOLD_REGION,
    )
}

/// Is this the stronghold chunk for its region?
pub fn is_stronghold_chunk(seed: i32, cx: i32, cz: i32) -> bool {
    let rx = cx.div_euclid(STRONGHOLD_REGION);
    let rz = cz.div_euclid(STRONGHOLD_REGION);
    stronghold_chunk(seed, rx, rz) == (cx, cz)
}

/// Where the stronghold for a region sits, in world coordinates: the block
/// a player stands on inside its room.
pub fn stronghold_location(seed: i32, rx: i32, rz: i32) -> (i32, i32, i32) {
    let (cx, cz) = stronghold_chunk(seed, rx, rz);
    (cx * CHUNK_X_I + 8, STRONGHOLD_Y + 1, cz * CHUNK_Z_I + 8)
}

/// A buried room holding the End portal frame, sized to sit entirely inside
/// one chunk so it needs no cross-chunk state.
fn build_stronghold(seed: i32, cx: i32, cz: i32, data: &mut [u8]) {
    if !is_stronghold_chunk(seed, cx, cz) {
        return;
    }
    let y0 = STRONGHOLD_Y as usize;
    let room_height = 5i32;

    for lz in 3..=12 {
        for lx in 3..=12 {
            for dy in -1..=room_height {
                let y = STRONGHOLD_Y + dy;
                if !(1..WORLD_Y_I).contains(&y) {
                    continue;
                }
                let wall =
                    lx == 3 || lx == 12 || lz == 3 || lz == 12 || dy == -1 || dy == room_height;
                data[voxel_index(lx, y as usize, lz)] =
                    if wall { block::Bricks } else { block::Air };
            }
        }
    }

    // The portal frame ring, centred in the room, sunk one block into the floor.
    let (centre_x, centre_z) = (8usize, 8usize);
    for dz in -1i32..=1 {
        for dx in -1i32..=1 {
            if dx == 0 && dz == 0 {
                continue;
            }
            let x = (centre_x as i32 + dx) as usize;
            let z = (centre_z as i32 + dz) as usize;
            data[voxel_index(x, y0, z)] = block::EndPortalFrame;
        }
    }
    data[voxel_index(centre_x, y0, centre_z)] = block::Air;

    // A couple of glowstone blocks so the room is not pitch dark.
    let light_y = y0 + room_height as usize - 1;
    data[voxel_index(4, light_y, 4)] = block::Glowstone;
    data[voxel_index(11, light_y, 11)] = block::Glowstone;
}

// --- overworld ----------------------------------------------------------------

/// Terrain heights for a chunk plus a one-column margin.
///
/// Reeds look at the column beside them, and structures level the ground of
/// the chunk they are drawn into, so both are answered from here instead of
/// evaluating the height noise again. Anything outside falls back to
/// computing it -- which is also why this replaces the TypeScript height
/// cache: that cache is keyed by coordinates alone, so this port uses the
/// uncached (pure) value it stands for.
pub(crate) struct ColumnHeights {
    seed: i32,
    ox: i32,
    oz: i32,
    heights: [i32; HEIGHTS_W * HEIGHTS_W],
}

const HEIGHTS_W: usize = CHUNK_X + 2;

impl ColumnHeights {
    fn new(seed: i32, ox: i32, oz: i32) -> Self {
        let mut heights = [0; HEIGHTS_W * HEIGHTS_W];
        for lz in -1..=CHUNK_Z_I {
            for lx in -1..=CHUNK_X_I {
                heights[((lz + 1) as usize) * HEIGHTS_W + (lx + 1) as usize] =
                    column_height(seed, ox + lx, oz + lz);
            }
        }
        ColumnHeights {
            seed,
            ox,
            oz,
            heights,
        }
    }

    /// Height of a column by local coordinates, -1..=16 on each axis.
    #[inline]
    fn local(&self, lx: i32, lz: i32) -> i32 {
        self.heights[((lz + 1) as usize) * HEIGHTS_W + (lx + 1) as usize]
    }

    /// Height of any column, by world coordinates.
    #[inline]
    pub(crate) fn at(&self, x: i32, z: i32) -> i32 {
        let lx = x - self.ox;
        let lz = z - self.oz;
        if (-1..=CHUNK_X_I).contains(&lx) && (-1..=CHUNK_Z_I).contains(&lz) {
            self.local(lx, lz)
        } else {
            column_height(self.seed, x, z)
        }
    }
}

/// Samples a 3D noise field on a coarse lattice and trilinearly interpolates.
///
/// The lattice is stored as `f32` because the TypeScript version keeps it in
/// a `Float32Array`: every sample is rounded to single precision there, and
/// the port has to round the same way to carve the same caves.
struct CoarseField3 {
    grid: Vec<f32>,
    nx: usize,
    ny: usize,
    nz: usize,
    stride: usize,
}

impl CoarseField3 {
    #[allow(clippy::too_many_arguments)]
    fn new(
        seed: i32,
        ox: i32,
        oz: i32,
        height: usize,
        stride: usize,
        scale_xz: f64,
        scale_y: f64,
        octaves: u32,
    ) -> Self {
        let nx = CHUNK_X / stride + 1;
        let nz = CHUNK_Z / stride + 1;
        let ny = height.div_ceil(stride) + 1;
        let mut grid = vec![0f32; nx * ny * nz];
        for j in 0..ny {
            for k in 0..nz {
                for i in 0..nx {
                    grid[(j * nz + k) * nx + i] = fbm3(
                        (ox + (i * stride) as i32) as f64 / scale_xz,
                        (j * stride) as f64 / scale_y,
                        (oz + (k * stride) as i32) as f64 / scale_xz,
                        seed,
                        octaves,
                        0.5,
                    ) as f32;
                }
            }
        }
        CoarseField3 {
            grid,
            nx,
            ny,
            nz,
            stride,
        }
    }

    #[inline]
    fn sample(&self, lx: usize, y: usize, lz: usize) -> f64 {
        let (nx, ny, nz) = (self.nx, self.ny, self.nz);
        let s = self.stride as f64;
        let fx = lx as f64 / s;
        let fy = y as f64 / s;
        let fz = lz as f64 / s;
        let i = (nx - 2).min(fx as usize);
        let j = (ny - 2).min(fy as usize);
        let k = (nz - 2).min(fz as usize);
        let tx = fx - i as f64;
        let ty = fy - j as f64;
        let tz = fz - k as f64;

        let g = |b: usize| self.grid[b] as f64;
        let b000 = (j * nz + k) * nx + i;
        let b100 = b000 + 1;
        let b010 = ((j + 1) * nz + k) * nx + i;
        let b110 = b010 + 1;
        let b001 = (j * nz + k + 1) * nx + i;
        let b101 = b001 + 1;
        let b011 = ((j + 1) * nz + k + 1) * nx + i;
        let b111 = b011 + 1;

        let x00 = g(b000) + (g(b100) - g(b000)) * tx;
        let x10 = g(b010) + (g(b110) - g(b010)) * tx;
        let x01 = g(b001) + (g(b101) - g(b001)) * tx;
        let x11 = g(b011) + (g(b111) - g(b011)) * tx;
        let y0 = x00 + (x10 - x00) * ty;
        let y1 = x01 + (x11 - x01) * ty;
        y0 + (y1 - y0) * tz
    }
}

/// Two coarse fields near their midline intersect in long winding tunnels.
struct Caves {
    a: CoarseField3,
    b: CoarseField3,
}

impl Caves {
    fn new(seed: i32, ox: i32, oz: i32) -> Self {
        Caves {
            a: CoarseField3::new(seed.wrapping_add(555), ox, oz, WORLD_Y, 4, 38.0, 22.0, 2),
            b: CoarseField3::new(seed.wrapping_add(777), ox, oz, WORLD_Y, 4, 38.0, 22.0, 2),
        }
    }

    #[inline]
    fn is_cave(&self, lx: usize, y: usize, lz: usize) -> bool {
        (self.a.sample(lx, y, lz) - 0.5).abs() <= 0.055
            && (self.b.sample(lx, y, lz) - 0.5).abs() <= 0.055
    }
}

/// The flowers a meadow picks from, most common first.
const FLOWERS: [u8; 5] = [
    block::Dandelion,
    block::Poppy,
    block::Dandelion,
    block::Cornflower,
    block::Tulip,
];

fn generate_overworld(seed: i32, cx: i32, cz: i32, data: &mut [u8]) {
    let ox = cx * CHUNK_X_I;
    let oz = cz * CHUNK_Z_I;
    let caves = Caves::new(seed, ox, oz);
    let heights = ColumnHeights::new(seed, ox, oz);
    let mut biomes = [Biome::Plains; CHUNK_X * CHUNK_Z];

    for lz in 0..CHUNK_Z {
        let z = oz + lz as i32;
        for lx in 0..CHUNK_X {
            let x = ox + lx as i32;
            let h = heights.local(lx as i32, lz as i32);
            let biome = biome_at_height(seed, x, z, h);
            biomes[lz * CHUNK_X + lx] = biome;
            let beach = h <= SEA_LEVEL + 1;
            let desert = biome == Biome::Desert;

            // The surface and the few blocks under it.
            let mut top = if beach {
                block::Sand
            } else if h >= MOUNTAIN_Y {
                block::Stone
            } else {
                block::Grass
            };
            let mut soil = if beach { block::Sand } else { block::Dirt };
            let (xf, zf) = (x as f64, z as f64);
            if desert {
                top = block::Sand;
                soil = block::Sand;
            } else if !beach && h < MOUNTAIN_Y {
                if biome == Biome::SnowyTaiga {
                    top = block::SnowyGrass;
                } else if biome == Biome::Taiga
                    && value2(xf / 5.0, zf / 5.0, seed.wrapping_add(818)) > 0.62
                {
                    top = block::Podzol;
                }
            }
            // Clay settles in patches on shallow seabeds, most of all in swamps.
            if (SEA_LEVEL - 6..SEA_LEVEL).contains(&h)
                && value2(xf / 5.0, zf / 5.0, seed.wrapping_add(919))
                    > if biome == Biome::Swamp { 0.5 } else { 0.74 }
            {
                top = block::Clay;
                soil = block::Clay;
            }

            let caves_here = h > SEA_LEVEL;
            for y in 0..=h.max(SEA_LEVEL) {
                let mut id = if y <= 1 {
                    block::Bedrock
                } else if y > h {
                    block::Water
                } else if y == h {
                    top
                } else if y > h - 4 {
                    soil
                } else if desert && y > h - 8 {
                    // Sand rests on sandstone, which is what holds a desert up.
                    block::Sandstone
                } else {
                    ore_at(seed, x, y, z).unwrap_or(block::Stone)
                };

                // Caves cut through stone, but never breach the seabed or bedrock.
                if y > 2
                    && y < h - 2
                    && id != block::Water
                    && caves_here
                    && caves.is_cave(lx, y as usize, lz)
                {
                    id = block::Air;
                }
                data[voxel_index(lx, y as usize, lz)] = id;
            }
        }
    }

    rock_pockets(seed, cx, cz, data);
    for i in 0..COPPER_VEINS {
        let size = 5 + (hash3(cx, i, cz, seed.wrapping_add(6262)) * 5.0).floor() as i32;
        vein(data, seed, cx, cz, i, block::CopperOre, COPPER_Y, size);
    }
    if hash2(cx, cz, seed.wrapping_add(6363)) < RUBY_CHANCE {
        vein(data, seed, cx, cz, 99, block::RubyOre, RUBY_Y, 3);
    }

    build_stronghold(seed, cx, cz, data);
    build_structures(seed, cx, cz, data, &heights);

    // Trees, including ones rooted just outside the chunk whose canopy reaches in.
    let tree_seed = seed.wrapping_add(99);
    for lz in -TREE_MARGIN..CHUNK_Z_I + TREE_MARGIN {
        for lx in -TREE_MARGIN..CHUNK_X_I + TREE_MARGIN {
            let x = ox + lx;
            let z = oz + lz;
            // Cheap reject first: almost no column is even a candidate.
            if hash2(x, z, tree_seed) > MAX_TREE_DENSITY {
                continue;
            }
            let inside = (0..CHUNK_X_I).contains(&lx) && (0..CHUNK_Z_I).contains(&lz);
            let h = if inside {
                heights.local(lx, lz)
            } else {
                column_height(seed, x, z)
            };
            if h <= SEA_LEVEL + 1 {
                continue;
            }
            if h >= MOUNTAIN_Y {
                continue;
            }
            let biome = if inside {
                biomes[lz as usize * CHUNK_X + lx as usize]
            } else {
                biome_at_height(seed, x, z, h)
            };
            if !is_tree_spot(seed, x, z, TREE_DENSITY[biome as usize]) {
                continue;
            }
            let kind = tree_kind_for(biome, hash2(x, z, seed.wrapping_add(4343)));
            place_tree(data, ox, oz, seed, x, z, h, kind);
        }
    }

    decorate(seed, ox, oz, data, &heights, &biomes);
}

/// Soil a plant may stand on.
fn fertile(id: u8) -> bool {
    id == block::Grass || id == block::Dirt || id == block::Podzol || id == block::SnowyGrass
}

/// Small plants a snowfall covers over rather than settling on top of.
fn buried(id: u8) -> bool {
    id == block::TallGrass
        || id == block::Fern
        || id == block::BrownMushroom
        || id == block::RedMushroom
}

/// Chance a desert column grows a cactus.
const CACTUS_CHANCE: f64 = 0.009;

/// Cacti never grow side by side: a neighbour touching one would break it.
fn is_cactus_spot(seed: i32, x: i32, z: i32) -> bool {
    let s = seed.wrapping_add(1717);
    [(1, 0), (-1, 0), (0, 1), (0, -1)]
        .iter()
        .all(|&(dx, dz)| hash2(x + dx, z + dz, s) >= CACTUS_CHANCE)
}

/// Is there canopy a few blocks over this column? Mushrooms like the shade.
fn shaded(data: &[u8], lx: usize, h: i32, lz: usize) -> bool {
    for y in h + 2..=(WORLD_Y_I - 1).min(h + 9) {
        let id = data[voxel_index(lx, y as usize, lz)];
        if id == block::Leaves || id == block::BirchLeaves || id == block::PineLeaves {
            return true;
        }
    }
    false
}

/// Everything that grows on the ground and lies on top of it: grass,
/// flowers, cacti, reeds, lily pads, then snow and ice over all of it in the
/// cold. Runs after trees, so nothing sprouts inside a trunk and snow lands
/// on the canopy rather than under it.
fn decorate(
    seed: i32,
    ox: i32,
    oz: i32,
    data: &mut [u8],
    heights: &ColumnHeights,
    biomes: &[Biome; CHUNK_X * CHUNK_Z],
) {
    let sea = SEA_LEVEL as usize;
    for lz in 0..CHUNK_Z {
        for lx in 0..CHUNK_X {
            let x = ox + lx as i32;
            let z = oz + lz as i32;
            let (lxi, lzi) = (lx as i32, lz as i32);
            let h = heights.local(lxi, lzi);
            let biome = biomes[lz * CHUNK_X + lx];
            let r = hash2(x, z, seed.wrapping_add(1717));
            let pick = hash2(x, z, seed.wrapping_add(1818));
            let ground = data[voxel_index(lx, h as usize, lz)];
            let clear =
                h + 1 < WORLD_Y_I && data[voxel_index(lx, (h + 1) as usize, lz)] == block::Air;

            if h < SEA_LEVEL {
                // Open water: lily pads on shallow swamp water. Only still
                // surface water counts, so nothing floats on a cave pool.
                if biome == Biome::Swamp
                    && SEA_LEVEL - h <= 4
                    && r < 0.12
                    && data[voxel_index(lx, sea, lz)] == block::Water
                    && data[voxel_index(lx, sea + 1, lz)] == block::Air
                {
                    put(data, ox, oz, x, SEA_LEVEL + 1, z, block::LilyPad, false);
                }
            } else if clear {
                // Reeds on any bank that touches water, in every climate but
                // the frozen.
                let near_water = h == SEA_LEVEL
                    && (ground == block::Sand || fertile(ground))
                    && (heights.local(lxi + 1, lzi) < SEA_LEVEL
                        || heights.local(lxi - 1, lzi) < SEA_LEVEL
                        || heights.local(lxi, lzi + 1) < SEA_LEVEL
                        || heights.local(lxi, lzi - 1) < SEA_LEVEL);
                let reed_chance = if biome == Biome::Swamp { 0.45 } else { 0.2 };
                if near_water && biome != Biome::SnowyTaiga && r < reed_chance {
                    let tall = 1 + (pick * 3.0).floor() as i32;
                    for i in 1..=tall {
                        put(data, ox, oz, x, h + i, z, block::Reeds, false);
                    }
                } else if biome == Biome::Desert {
                    if ground == block::Sand {
                        // Level ground only: a dune step beside it would be
                        // sand pressing on its side, which a cactus cannot bear.
                        let level = heights.local(lxi + 1, lzi) <= h
                            && heights.local(lxi - 1, lzi) <= h
                            && heights.local(lxi, lzi + 1) <= h
                            && heights.local(lxi, lzi - 1) <= h;
                        if r < CACTUS_CHANCE && level && is_cactus_spot(seed, x, z) {
                            let tall = 1 + (pick * 3.0).floor() as i32;
                            for i in 1..=tall {
                                put(data, ox, oz, x, h + i, z, block::Cactus, false);
                            }
                        } else if r > 0.985 {
                            put(data, ox, oz, x, h + 1, z, block::DeadBush, false);
                        }
                    }
                } else if fertile(ground) {
                    if let Some(id) = grass_cover(biome, r, pick, || shaded(data, lx, h, lz)) {
                        put(data, ox, oz, x, h + 1, z, id, false);
                    }
                }
            }

            // Snow over everything in the cold and on high peaks; ice on still water.
            if biome == Biome::SnowyTaiga || (biome == Biome::Mountains && h >= SNOWLINE_Y) {
                let mut y = (WORLD_Y_I - 2).min(h.max(SEA_LEVEL) + 14);
                while y >= h {
                    let at = voxel_index(lx, y as usize, lz);
                    let id = data[at];
                    if id == block::Air {
                        y -= 1;
                        continue;
                    }
                    if id == block::Water {
                        data[at] = block::Ice;
                    } else if id != block::LilyPad && id != block::Reeds {
                        // Plants under a fresh fall are buried rather than poking through.
                        if buried(id) {
                            data[at] = block::SnowLayer;
                        } else {
                            data[voxel_index(lx, (y + 1) as usize, lz)] = block::SnowLayer;
                        }
                    }
                    break;
                }
            }
        }
    }
}

/// Ground cover on grassy soil, by biome: the one block (if any) to put on
/// top. The shade test is a closure because it scans the column, and the
/// TypeScript only runs it when the roll is low enough to matter.
fn grass_cover(biome: Biome, r: f64, pick: f64, is_shaded: impl FnOnce() -> bool) -> Option<u8> {
    let flower = || FLOWERS[(pick * FLOWERS.len() as f64).floor() as usize];
    match biome {
        Biome::Plains => {
            if r < 0.26 {
                Some(block::TallGrass)
            } else if r < 0.3 {
                Some(flower())
            } else if r < 0.3012 {
                Some(block::Pumpkin)
            } else if r < 0.3018 {
                Some(block::Melon)
            } else {
                None
            }
        }
        Biome::Forest => {
            if r < 0.05 && is_shaded() {
                Some(if pick < 0.5 {
                    block::BrownMushroom
                } else {
                    block::RedMushroom
                })
            } else if r < 0.16 {
                Some(block::TallGrass)
            } else if r < 0.19 {
                Some(block::Fern)
            } else if r < 0.205 {
                Some(flower())
            } else if r < 0.2062 {
                Some(block::Pumpkin)
            } else {
                None
            }
        }
        Biome::Taiga | Biome::SnowyTaiga => {
            if r < 0.04 && is_shaded() {
                Some(if pick < 0.7 {
                    block::BrownMushroom
                } else {
                    block::RedMushroom
                })
            } else if r < 0.14 {
                Some(block::Fern)
            } else if r < 0.2 {
                Some(block::TallGrass)
            } else if r < 0.2015 && biome == Biome::Taiga {
                Some(block::Pumpkin)
            } else {
                None
            }
        }
        Biome::Swamp => {
            if r < 0.03 && is_shaded() {
                Some(block::BrownMushroom)
            } else if r < 0.3 {
                Some(block::TallGrass)
            } else if r < 0.34 {
                Some(block::Fern)
            } else if r < 0.345 {
                Some(block::Cornflower)
            } else if r < 0.3465 {
                Some(block::Melon)
            } else {
                None
            }
        }
        _ => {
            if r < 0.12 {
                Some(block::TallGrass)
            } else {
                None
            }
        }
    }
}

// --- nether and end -----------------------------------------------------------

fn generate_nether(seed: i32, cx: i32, cz: i32, data: &mut [u8]) {
    let ox = cx * CHUNK_X_I;
    let oz = cz * CHUNK_Z_I;
    const ROOF: usize = 100;
    const LAVA_LEVEL: usize = 22;
    let density = CoarseField3::new(seed.wrapping_add(3131), ox, oz, ROOF, 4, 30.0, 20.0, 2);

    for lz in 0..CHUNK_Z {
        let z = oz + lz as i32;
        for lx in 0..CHUNK_X {
            let x = ox + lx as i32;
            // Per column, kept mostly below the lava line so basins flood.
            let floor = 6.0
                + contrast(
                    fbm2(
                        x as f64 / 60.0,
                        z as f64 / 60.0,
                        seed.wrapping_add(4141),
                        3,
                        0.5,
                    ),
                    2.0,
                ) * 20.0;
            let soul_patch = hash2(x, z, seed.wrapping_add(55)) < 0.07;
            let glow_column = hash2(x, z, seed.wrapping_add(606)) < 0.03;

            for y in 0..ROOF {
                let id = if y <= 1 || y >= ROOF - 2 {
                    block::Bedrock
                } else {
                    // Carve open caverns out of a solid netherrack slab;
                    // anything open below the lava line fills with lava.
                    let yf = y as f64;
                    let open = density.sample(lx, y, lz) > 0.52 && yf > floor;
                    if open {
                        if y <= LAVA_LEVEL {
                            block::Lava
                        } else {
                            block::Air
                        }
                    } else if soul_patch && yf >= floor - 1.0 && yf <= floor + 1.0 {
                        block::SoulSand
                    } else {
                        block::Netherrack
                    }
                };
                data[voxel_index(lx, y, lz)] = id;
            }

            // Glowstone on cavern ceilings, so the place isn't pitch black.
            if glow_column {
                for y in LAVA_LEVEL + 4..ROOF - 3 {
                    let i = voxel_index(lx, y, lz);
                    if data[i] == block::Air
                        && data[voxel_index(lx, y + 1, lz)] == block::Netherrack
                    {
                        data[i] = block::Glowstone;
                        break;
                    }
                }
            }
        }
    }
}

fn generate_end(seed: i32, cx: i32, cz: i32, data: &mut [u8]) {
    let ox = cx * CHUNK_X_I;
    let oz = cz * CHUNK_Z_I;
    const BASE: i32 = 56;

    for lz in 0..CHUNK_Z {
        let z = oz + lz as i32;
        for lx in 0..CHUNK_X {
            let x = ox + lx as i32;
            let (xf, zf) = (x as f64, z as f64);
            let dist = js_hypot(xf, zf);

            // A main island around the origin, then scattered outer islands.
            let mut mass: f64 = 0.0;
            if dist < 90.0 {
                mass = 1.0 - dist / 90.0;
            }
            if dist > 140.0 {
                let outer = contrast(
                    fbm2(xf / 70.0, zf / 70.0, seed.wrapping_add(8181), 3, 0.5),
                    2.6,
                );
                mass = mass.max(outer - 0.62);
            }
            if mass <= 0.0 {
                continue;
            }

            let thickness = (4.0 + mass * 22.0).floor() as i32;
            let bulge = ((contrast(
                fbm2(xf / 24.0, zf / 24.0, seed.wrapping_add(9191), 2, 0.5),
                2.0,
            ) - 0.5)
                * 8.0)
                .floor() as i32;
            let top = BASE + (mass * 10.0).floor() as i32 + bulge;
            for y in top - thickness..=top {
                if !(2..WORLD_Y_I).contains(&y) {
                    continue;
                }
                data[voxel_index(lx, y as usize, lz)] = block::EndStone;
            }
        }
    }
}

/// Base terrain for one chunk. Player edits are layered on top by the caller.
pub fn generate_chunk(seed: i32, dim: Dimension, cx: i32, cz: i32) -> Vec<u8> {
    let mut data = vec![0u8; CHUNK_VOLUME];
    match dim {
        Dimension::Nether => generate_nether(seed, cx, cz, &mut data),
        Dimension::End => generate_end(seed, cx, cz, &mut data),
        Dimension::Overworld => generate_overworld(seed, cx, cz, &mut data),
    }
    data
}

/// A safe standing height for spawning at a given column.
pub fn surface_y(seed: i32, dim: Dimension, x: i32, z: i32) -> i32 {
    match dim {
        Dimension::Overworld => column_height(seed, x, z).max(SEA_LEVEL) + 1,
        Dimension::End => 70,
        Dimension::Nether => 40,
    }
}
