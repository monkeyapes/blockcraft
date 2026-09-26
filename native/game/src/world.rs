//! Loaded chunks and block access in world coordinates.
//!
//! Chunk data is held in `Arc`s so a meshing job can take a snapshot of a
//! chunk and its neighbours without copying 32 KB each, and without holding
//! a lock while it works. An edit on the main thread then goes through
//! `Arc::make_mut`: if a job still holds the old data, the chunk is copied
//! once and the job finishes against the version it started with, and its
//! stale result is dropped when it arrives (see `SectionState::revision`).

use std::collections::HashMap;
use std::sync::Arc;

use worldgen::{voxel_index, CHUNK_VOLUME, CHUNK_X, CHUNK_Z, WORLD_Y};

use crate::content::BlockTable;

/// Blocks per section edge vertically; a chunk is meshed in slices this tall
/// so an edit rebuilds 16 layers rather than 128.
pub const SECTION_Y: usize = 16;
pub const SECTIONS: usize = WORLD_Y / SECTION_Y;

pub type ChunkPos = (i32, i32);

/// Anything blocks can be read from in world coordinates. The player and the
/// raycast are written against this, so tests can hand them a tiny world.
pub trait Voxels {
    /// The block at a world cell; outside the world (or an unloaded chunk)
    /// reads as air.
    fn block(&self, x: i32, y: i32, z: i32) -> u8;
    /// Whether the column holding this cell has been generated. Physics
    /// freezes over unloaded ground rather than falling through it.
    fn loaded(&self, x: i32, z: i32) -> bool;
}

/// Heights of the topmost sky-blocking block in each column, or -1.
pub type Heightmap = [i16; CHUNK_X * CHUNK_Z];

pub struct Chunk {
    pub blocks: Arc<Vec<u8>>,
    pub heights: Arc<Heightmap>,
    /// Per section: holds anything besides air. An empty section has no
    /// faces of its own, so it is never meshed at all -- most of the sky.
    pub occupied: [bool; SECTIONS],
}

impl Chunk {
    pub fn new(blocks: Vec<u8>, table: &BlockTable) -> Self {
        assert_eq!(blocks.len(), CHUNK_VOLUME);
        let heights = Arc::new(compute_heights(&blocks, table));
        let mut occupied = [false; SECTIONS];
        for (s, o) in occupied.iter_mut().enumerate() {
            let start = voxel_index(0, s * SECTION_Y, 0);
            let end = voxel_index(0, (s + 1) * SECTION_Y, 0);
            *o = blocks[start..end].iter().any(|&b| b != 0);
        }
        Chunk {
            blocks: Arc::new(blocks),
            heights,
            occupied,
        }
    }
}

/// Topmost opaque block per column. Sunlight is blocked by opaque blocks
/// only: glass and water let it through in this phase, which keeps a lake
/// bed and a greenhouse lit.
pub fn compute_heights(blocks: &[u8], table: &BlockTable) -> Heightmap {
    let mut h = [-1i16; CHUNK_X * CHUNK_Z];
    for z in 0..CHUNK_Z {
        for x in 0..CHUNK_X {
            h[z * CHUNK_X + x] = column_height(blocks, table, x, z);
        }
    }
    h
}

fn column_height(blocks: &[u8], table: &BlockTable, x: usize, z: usize) -> i16 {
    (0..WORLD_Y)
        .rev()
        .find(|&y| table.opaque[blocks[voxel_index(x, y, z)] as usize])
        .map_or(-1, |y| y as i16)
}

/// The loaded world: chunks by position.
#[derive(Default)]
pub struct World {
    pub chunks: HashMap<ChunkPos, Chunk>,
}

#[inline]
pub fn chunk_of(x: i32, z: i32) -> ChunkPos {
    (x.div_euclid(CHUNK_X as i32), z.div_euclid(CHUNK_Z as i32))
}

impl World {
    pub fn insert(&mut self, pos: ChunkPos, chunk: Chunk) {
        self.chunks.insert(pos, chunk);
    }

    /// Writes a block and returns the sections whose meshes it changes: its
    /// own, and any neighbour it touches across a section or chunk border
    /// (faces, AO and light all read one block over). Returns nothing if the
    /// chunk is not loaded.
    pub fn set_block(
        &mut self,
        table: &BlockTable,
        x: i32,
        y: i32,
        z: i32,
        id: u8,
    ) -> Vec<(i32, i32, usize)> {
        if y < 0 || y >= WORLD_Y as i32 {
            return Vec::new();
        }
        let pos = chunk_of(x, z);
        let Some(chunk) = self.chunks.get_mut(&pos) else {
            return Vec::new();
        };
        let lx = x.rem_euclid(CHUNK_X as i32) as usize;
        let lz = z.rem_euclid(CHUNK_Z as i32) as usize;
        let blocks = Arc::make_mut(&mut chunk.blocks);
        let index = voxel_index(lx, y as usize, lz);
        let old_id = blocks[index];
        blocks[index] = id;
        let height = column_height(blocks, table, lx, lz);
        let old_height = chunk.heights[lz * CHUNK_X + lx];
        Arc::make_mut(&mut chunk.heights)[lz * CHUNK_X + lx] = height;
        let section = y as usize / SECTION_Y;
        if id != 0 {
            chunk.occupied[section] = true;
        }

        // Faces, AO and light all read one block over, so the sections
        // within one block always change. When the edit changes what blocks
        // light -- or moves the column's sky height -- the sky term changes
        // as far as light spreads (mesher::SKY_REACH blocks) around every
        // cell whose light source changed.
        let light_changed = table.opaque[old_id as usize] != table.opaque[id as usize];
        let reach = if light_changed || height != old_height {
            crate::mesher::SKY_REACH
        } else {
            1
        };
        let lo_y = (y.min(height.min(old_height) as i32 + 1) - reach).max(0);
        let hi_y = (y.max(height.max(old_height) as i32) + reach).min(WORLD_Y as i32 - 1);
        let lo_s = lo_y as usize / SECTION_Y;
        let hi_s = hi_y as usize / SECTION_Y;
        let mut out = Vec::new();
        let mut chunks = Vec::with_capacity(9);
        for dz in [-reach, 0, reach] {
            for dx in [-reach, 0, reach] {
                let c = chunk_of(x + dx, z + dz);
                if !chunks.contains(&c) {
                    chunks.push(c);
                }
            }
        }
        for c in chunks {
            for s in lo_s..=hi_s {
                out.push((c.0, c.1, s));
            }
        }
        out
    }
}

impl Voxels for World {
    #[inline]
    fn block(&self, x: i32, y: i32, z: i32) -> u8 {
        if y < 0 || y >= WORLD_Y as i32 {
            return 0;
        }
        match self.chunks.get(&chunk_of(x, z)) {
            Some(c) => {
                c.blocks[voxel_index(
                    x.rem_euclid(CHUNK_X as i32) as usize,
                    y as usize,
                    z.rem_euclid(CHUNK_Z as i32) as usize,
                )]
            }
            None => 0,
        }
    }

    fn loaded(&self, x: i32, z: i32) -> bool {
        self.chunks.contains_key(&chunk_of(x, z))
    }
}

/// The surface at a column of a generated chunk: the first cell above the
/// topmost solid block, where a player can stand.
pub fn surface_y(blocks: &[u8], table: &BlockTable, lx: usize, lz: usize) -> i32 {
    (0..WORLD_Y)
        .rev()
        .find(|&y| table.solid[blocks[voxel_index(lx, y, lz)] as usize])
        .map_or(WORLD_Y as i32, |y| y as i32 + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> BlockTable {
        BlockTable::load(None).unwrap()
    }

    #[test]
    fn chunk_coordinates_floor_toward_negative_infinity() {
        assert_eq!(chunk_of(0, 0), (0, 0));
        assert_eq!(chunk_of(15, 16), (0, 1));
        assert_eq!(chunk_of(-1, -16), (-1, -1));
        assert_eq!(chunk_of(-17, 0), (-2, 0));
    }

    #[test]
    fn blocks_round_trip_across_negative_chunks() {
        let t = table();
        let mut w = World::default();
        w.insert((-1, 0), Chunk::new(vec![0; CHUNK_VOLUME], &t));
        assert!(w.loaded(-1, 5));
        assert!(!w.loaded(0, 5));
        let touched = w.set_block(&t, -1, 10, 5, 3);
        assert_eq!(w.block(-1, 10, 5), 3);
        assert_eq!(w.block(-2, 10, 5), 0);
        // On the chunk's east edge, so the chunk to the east is touched too.
        assert!(touched.contains(&(-1, 0, 0)));
        assert!(touched.contains(&(0, 0, 0)));
    }

    #[test]
    fn heights_follow_edits() {
        let t = table();
        let mut w = World::default();
        let mut blocks = vec![0; CHUNK_VOLUME];
        blocks[voxel_index(2, 5, 3)] = 3;
        w.insert((0, 0), Chunk::new(blocks, &t));
        assert_eq!(w.chunks[&(0, 0)].heights[3 * 16 + 2], 5);
        w.set_block(&t, 2, 40, 3, 3);
        assert_eq!(w.chunks[&(0, 0)].heights[3 * 16 + 2], 40);
        w.set_block(&t, 2, 40, 3, 0);
        assert_eq!(w.chunks[&(0, 0)].heights[3 * 16 + 2], 5);
        // Glass lets the sun through.
        let glass = t.id_by_name("Glass").unwrap();
        w.set_block(&t, 2, 50, 3, glass);
        assert_eq!(w.chunks[&(0, 0)].heights[3 * 16 + 2], 5);
    }

    #[test]
    fn surface_is_above_the_top_solid_block() {
        let t = table();
        let blocks = worldgen::generate_chunk(1, worldgen::Dimension::Overworld, 0, 0);
        let y = surface_y(&blocks, &t, 0, 0);
        assert!(y > 0 && (y as usize) < WORLD_Y);
        assert!(t.solid[blocks[voxel_index(0, y as usize - 1, 0)] as usize]);
        assert!(!t.solid[blocks[voxel_index(0, y as usize, 0)] as usize]);
    }
}
