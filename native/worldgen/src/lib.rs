//! Blockcraft world generation.
//!
//! A byte-for-byte port of shared/src/terrain.ts (and the noise and structure
//! code it uses), so a seed makes the same world natively as in the web game
//! and the two can share a server. Until the port lands this returns a flat
//! test world with the same layout.

/// Blocks along x and z in a chunk.
pub const CHUNK_X: usize = 16;
pub const CHUNK_Z: usize = 16;
/// World height in blocks.
pub const WORLD_Y: usize = 128;
pub const CHUNK_VOLUME: usize = CHUNK_X * CHUNK_Z * WORLD_Y;

/// Index into a chunk's flat array; y-major, then z, then x (as in shared/src/constants.ts).
#[inline]
pub fn voxel_index(lx: usize, y: usize, lz: usize) -> usize {
    (y << 8) | (lz << 4) | lx
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dimension {
    Overworld = 0,
    Nether = 1,
    End = 2,
}

/// Generates one chunk's block ids. Stub: flat stone, dirt and grass.
pub fn generate_chunk(_seed: i32, _dim: Dimension, _cx: i32, _cz: i32) -> Vec<u8> {
    let mut data = vec![0u8; CHUNK_VOLUME];
    for z in 0..CHUNK_Z {
        for x in 0..CHUNK_X {
            for y in 0..=40 {
                data[voxel_index(x, y, z)] = if y == 0 { 7 } else if y < 37 { 3 } else if y < 40 { 2 } else { 1 };
            }
        }
    }
    data
}
