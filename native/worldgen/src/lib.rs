//! Blockcraft world generation.
//!
//! A byte-for-byte port of shared/src/terrain.ts and the noise and structure
//! code it uses, so a seed makes the same world natively as in the web game
//! and the two can share a server, which only ever sends edits. The parity
//! tests in `tests/` compare against chunks exported from the TypeScript
//! generator by tools/export-worldgen-vectors.ts.

pub mod block;
pub mod noise;
pub mod structures;
pub mod terrain;

pub use structures::{find_placement, Placement, StructureKind};
pub use terrain::{
    biome_at, biome_at_height, climate_at, column_height, generate_chunk, is_stronghold_chunk,
    stronghold_location, surface_y, tree_cells, tree_height, Biome, Climate, TreeCell, TreeKind,
    BIOME_NAMES,
};

/// Blocks along x and z in a chunk.
pub const CHUNK_X: usize = 16;
pub const CHUNK_Z: usize = 16;
/// World height in blocks.
pub const WORLD_Y: usize = 128;
pub const CHUNK_VOLUME: usize = CHUNK_X * CHUNK_Z * WORLD_Y;
/// The ocean surface: water fills every column up to this height.
pub const SEA_LEVEL: i32 = 40;
/// The Nether is 1:8 scale against the overworld.
pub const NETHER_SCALE: i32 = 8;

/// Index into a chunk's flat array; y-major, then z, then x (as in shared/src/constants.ts).
#[inline]
pub fn voxel_index(lx: usize, y: usize, lz: usize) -> usize {
    (y << 8) | (lz << 4) | lx
}

/// The three worlds. The discriminants are the TypeScript enum's, which go
/// over the network.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Dimension {
    Overworld = 0,
    Nether = 1,
    End = 2,
}

impl Dimension {
    /// The dimension with this network id, if there is one.
    pub fn from_id(id: u8) -> Option<Dimension> {
        match id {
            0 => Some(Dimension::Overworld),
            1 => Some(Dimension::Nether),
            2 => Some(Dimension::End),
            _ => None,
        }
    }
}
