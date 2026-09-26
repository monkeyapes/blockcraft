//! Which chunks are loaded, which are meshed, and what the renderer must hear.
//!
//! The streamer is the bookkeeping between the player's position, the job
//! pool and the renderer. It keeps chunks generated a ring wider than the
//! render distance -- a chunk can only be meshed once all eight of its
//! neighbours exist, since its border faces, AO and light read one block into
//! them -- and unloads a ring wider again, so walking back and forth across a
//! chunk border does not throw work away and redo it.
//!
//! It owns no GPU state. What the renderer should do is handed back as
//! [`Event`]s, which keeps all of this testable without a device.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use crate::content::BlockTable;
use crate::jobs::{Done, Job, JobPool};
use crate::mesher::{Neighbourhood, SectionMesh};
use crate::world::{Chunk, ChunkPos, Voxels, World, SECTIONS};

/// What the renderer has to do after an update.
pub enum Event {
    /// A section's new geometry; an empty mesh means "draw nothing here".
    Mesh {
        pos: ChunkPos,
        section: usize,
        mesh: SectionMesh,
    },
    /// Drop every section of this chunk.
    Unload(ChunkPos),
}

/// Throughput counters, for the F3 overlay and the log.
#[derive(Default, Clone, Copy, Debug)]
pub struct Stats {
    pub generated: u64,
    pub generate_time: Duration,
    pub meshed: u64,
    pub mesh_time: Duration,
    pub quads: u64,
}

/// Inside a circle of `r` chunks. `r * (r + 1)` rather than `r * r` rounds
/// the circle out a little, so the cardinal directions do not end in a
/// one-chunk nub.
#[inline]
pub fn within(a: ChunkPos, b: ChunkPos, r: i32) -> bool {
    let dx = (a.0 - b.0) as i64;
    let dz = (a.1 - b.1) as i64;
    dx * dx + dz * dz <= (r as i64) * (r as i64 + 1)
}

pub struct Streamer {
    pub world: World,
    table: Arc<BlockTable>,
    /// Chunks drawn around the player.
    pub radius: i32,
    center: ChunkPos,
    /// Generation jobs submitted and not yet back.
    requested: HashSet<ChunkPos>,
    /// Chunks whose sections have been sent to be meshed at least once.
    meshed: HashSet<ChunkPos>,
    /// Current revision of each section. A mesh result carrying an older one
    /// was built from data an edit has since changed, and is dropped.
    revisions: HashMap<(ChunkPos, usize), u32>,
    /// Mesh jobs submitted and not yet back (or cancelled).
    pending_meshes: usize,
    started: bool,
    pub stats: Stats,
}

impl Streamer {
    pub fn new(table: Arc<BlockTable>, radius: i32) -> Self {
        Streamer {
            world: World::default(),
            table,
            radius: radius.max(1),
            center: (0, 0),
            requested: HashSet::new(),
            meshed: HashSet::new(),
            revisions: HashMap::new(),
            pending_meshes: 0,
            started: false,
            stats: Stats::default(),
        }
    }

    /// Chunks kept generated: one ring past the drawn ones, for neighbours.
    fn load_radius(&self) -> i32 {
        self.radius + 1
    }

    /// Chunks kept at all: one more ring, as hysteresis.
    fn keep_radius(&self) -> i32 {
        self.radius + 2
    }

    /// Nothing queued or in flight: the world around the player is complete.
    pub fn settled(&self) -> bool {
        self.requested.is_empty() && self.pending_meshes == 0
    }

    pub fn in_flight(&self) -> (usize, usize) {
        (self.requested.len(), self.pending_meshes)
    }

    /// Moves the centre of the loaded area, queues what is missing, drops
    /// what is too far, and collects finished work.
    pub fn update(&mut self, center: ChunkPos, pool: &JobPool) -> Vec<Event> {
        let mut events = Vec::new();
        if center != self.center || !self.started {
            self.started = true;
            self.center = center;
            pool.set_center(center);
            self.recenter(pool, &mut events);
        }
        while let Ok(done) = pool.results.try_recv() {
            self.accept(done, pool, &mut events);
        }
        events
    }

    fn recenter(&mut self, pool: &JobPool, events: &mut Vec<Event>) {
        let (c, load, keep) = (self.center, self.load_radius(), self.keep_radius());

        // Unload what fell out of range, and forget queued work for it.
        let gone: Vec<ChunkPos> = self
            .world
            .chunks
            .keys()
            .copied()
            .filter(|&p| !within(p, c, keep))
            .collect();
        for p in &gone {
            self.world.chunks.remove(p);
            self.meshed.remove(p);
            for s in 0..SECTIONS {
                self.revisions.remove(&(*p, s));
            }
            events.push(Event::Unload(*p));
        }
        let mut cancelled_meshes = 0;
        let world = &self.world;
        let requested = &mut self.requested;
        pool.retain(|job| match job {
            Job::Generate { pos } => {
                let keep_it = within(*pos, c, keep);
                if !keep_it {
                    requested.remove(pos);
                }
                keep_it
            }
            Job::Mesh { pos, .. } => {
                let keep_it = world.chunks.contains_key(pos);
                if !keep_it {
                    cancelled_meshes += 1;
                }
                keep_it
            }
        });
        self.pending_meshes -= cancelled_meshes;

        // Queue what is missing. The pool takes nearest-first, so the order
        // of submission does not matter.
        let mut wanted = Vec::new();
        for dz in -load..=load {
            for dx in -load..=load {
                let p = (c.0 + dx, c.1 + dz);
                if within(p, c, load)
                    && !self.world.chunks.contains_key(&p)
                    && !self.requested.contains(&p)
                {
                    wanted.push(p);
                }
            }
        }
        for &p in &wanted {
            self.requested.insert(p);
        }
        pool.submit_all(wanted.into_iter().map(|pos| Job::Generate { pos }));

        // Chunks that were loaded as someone's neighbour and have now come
        // into drawing range.
        let r = self.radius;
        for dz in -r..=r {
            for dx in -r..=r {
                self.try_mesh((c.0 + dx, c.1 + dz), pool);
            }
        }
    }

    fn accept(&mut self, done: Done, pool: &JobPool, events: &mut Vec<Event>) {
        match done {
            Done::Generated { pos, chunk, took } => {
                self.stats.generated += 1;
                self.stats.generate_time += took;
                // A late result for a chunk that was cancelled while a
                // worker already had it.
                if !self.requested.remove(&pos) || !within(pos, self.center, self.keep_radius()) {
                    return;
                }
                self.world.insert(pos, chunk);
                for dz in -1..=1 {
                    for dx in -1..=1 {
                        self.try_mesh((pos.0 + dx, pos.1 + dz), pool);
                    }
                }
            }
            Done::Meshed {
                pos,
                section,
                revision,
                mesh,
                took,
            } => {
                self.pending_meshes -= 1;
                self.stats.meshed += 1;
                self.stats.mesh_time += took;
                if self.revisions.get(&(pos, section)) != Some(&revision) {
                    return;
                }
                self.stats.quads += mesh.quads() as u64;
                events.push(Event::Mesh { pos, section, mesh });
            }
        }
    }

    /// Queues the first meshing of a chunk once it and its neighbours exist.
    fn try_mesh(&mut self, pos: ChunkPos, pool: &JobPool) {
        if self.meshed.contains(&pos) || !within(pos, self.center, self.radius) {
            return;
        }
        let Some(hood) = self.neighbourhood(pos) else {
            return;
        };
        self.meshed.insert(pos);
        let occupied = self.world.chunks[&pos].occupied;
        let jobs: Vec<Job> = (0..SECTIONS)
            .filter(|&s| occupied[s])
            .map(|section| {
                let revision = *self.revisions.entry((pos, section)).or_insert(0);
                Job::Mesh {
                    pos,
                    section,
                    revision,
                    urgent: false,
                    hood: hood.clone(),
                }
            })
            .collect();
        self.pending_meshes += jobs.len();
        pool.submit_all(jobs);
    }

    /// Snapshots of a chunk and its eight neighbours, if all are loaded.
    fn neighbourhood(&self, pos: ChunkPos) -> Option<Neighbourhood> {
        let mut chunks: [Option<Arc<Vec<u8>>>; 9] = Default::default();
        let mut heights: [Option<Arc<crate::world::Heightmap>>; 9] = Default::default();
        for dz in -1..=1 {
            for dx in -1..=1 {
                let c: &Chunk = self.world.chunks.get(&(pos.0 + dx, pos.1 + dz))?;
                let k = ((dz + 1) * 3 + (dx + 1)) as usize;
                chunks[k] = Some(c.blocks.clone());
                heights[k] = Some(c.heights.clone());
            }
        }
        Some(Neighbourhood {
            center: pos,
            chunks,
            heights,
        })
    }

    /// Writes a block and re-meshes whatever it changes, ahead of the queue.
    /// Returns whether the write happened (the chunk is loaded).
    pub fn set_block(&mut self, x: i32, y: i32, z: i32, id: u8, pool: &JobPool) -> bool {
        let table = self.table.clone();
        if !self.world.loaded(x, z) {
            return false;
        }
        let touched = self.world.set_block(&table, x, y, z, id);
        let mut jobs = Vec::new();
        for (cx, cz, section) in touched {
            let pos = (cx, cz);
            // Only chunks already on screen: one that has not been meshed yet
            // will read the new block when it is.
            if !self.meshed.contains(&pos) {
                continue;
            }
            let Some(hood) = self.neighbourhood(pos) else {
                continue;
            };
            let revision = self.revisions.entry((pos, section)).or_insert(0);
            *revision += 1;
            jobs.push(Job::Mesh {
                pos,
                section,
                revision: *revision,
                urgent: true,
                hood,
            });
        }
        self.pending_meshes += jobs.len();
        pool.submit_all(jobs);
        true
    }

    #[cfg(test)]
    fn is_meshed(&self, pos: ChunkPos) -> bool {
        self.meshed.contains(&pos)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn setup(radius: i32) -> (Streamer, JobPool) {
        let table = Arc::new(BlockTable::load(None).unwrap());
        let pool = JobPool::new(3, 7, crate::jobs::Terrain::Worldgen, table.clone());
        (Streamer::new(table, radius), pool)
    }

    /// Pumps until nothing is in flight; returns every event seen.
    fn pump(s: &mut Streamer, pool: &JobPool, center: ChunkPos) -> Vec<Event> {
        let start = Instant::now();
        let mut all = s.update(center, pool);
        while !s.settled() {
            assert!(
                start.elapsed() < Duration::from_secs(60),
                "streamer never settled"
            );
            std::thread::sleep(Duration::from_millis(2));
            all.extend(s.update(center, pool));
        }
        all
    }

    fn circle(c: ChunkPos, r: i32) -> HashSet<ChunkPos> {
        let mut out = HashSet::new();
        for dz in -r..=r {
            for dx in -r..=r {
                let p = (c.0 + dx, c.1 + dz);
                if within(p, c, r) {
                    out.insert(p);
                }
            }
        }
        out
    }

    #[test]
    fn loads_a_ring_past_what_it_draws_and_meshes_the_rest() {
        let (mut s, pool) = setup(3);
        let events = pump(&mut s, &pool, (0, 0));
        let loaded: HashSet<ChunkPos> = s.world.chunks.keys().copied().collect();
        assert_eq!(loaded, circle((0, 0), 4));
        for p in circle((0, 0), 3) {
            assert!(s.is_meshed(p), "{p:?} not meshed");
        }
        // Only the drawn chunks were meshed, not the neighbour ring.
        let meshed: HashSet<ChunkPos> = events
            .iter()
            .filter_map(|e| match e {
                Event::Mesh { pos, .. } => Some(*pos),
                _ => None,
            })
            .collect();
        assert_eq!(meshed, circle((0, 0), 3));
    }

    #[test]
    fn walking_away_unloads_far_chunks_and_loads_new_ones() {
        let (mut s, pool) = setup(2);
        pump(&mut s, &pool, (0, 0));
        let events = pump(&mut s, &pool, (10, 0));
        let unloaded: HashSet<ChunkPos> = events
            .iter()
            .filter_map(|e| match e {
                Event::Unload(p) => Some(*p),
                _ => None,
            })
            .collect();
        // Everything from the old area was out of the keep radius.
        assert_eq!(unloaded, circle((0, 0), 3));
        let loaded: HashSet<ChunkPos> = s.world.chunks.keys().copied().collect();
        assert_eq!(loaded, circle((10, 0), 3));
        assert!(!s.world.loaded(0, 0));
    }

    #[test]
    fn a_small_step_keeps_the_hysteresis_ring() {
        let (mut s, pool) = setup(2);
        pump(&mut s, &pool, (0, 0));
        let events = pump(&mut s, &pool, (1, 0));
        // Nothing within radius + 2 of the new centre is dropped.
        assert!(events.iter().all(|e| match e {
            Event::Unload(p) => !within(*p, (1, 0), 4),
            _ => true,
        }));
        assert!(s.world.chunks.contains_key(&(-3, 0)));
    }

    #[test]
    fn edits_remesh_their_section_and_the_neighbour_across_a_border() {
        let (mut s, pool) = setup(2);
        pump(&mut s, &pool, (0, 0));
        // A block on the chunk's west edge, high in the air: the chunk to the
        // west has a face against it, so both re-mesh.
        assert!(s.set_block(0, 100, 5, 3, &pool));
        let events = pump(&mut s, &pool, (0, 0));
        let sections: HashSet<(ChunkPos, usize)> = events
            .iter()
            .filter_map(|e| match e {
                Event::Mesh { pos, section, .. } => Some((*pos, *section)),
                _ => None,
            })
            .collect();
        assert!(sections.contains(&((0, 0), 100 / 16)), "{sections:?}");
        assert!(sections.contains(&((-1, 0), 100 / 16)), "{sections:?}");
        // The new block is drawn: its section has six faces' worth at least.
        let quads: usize = events
            .iter()
            .filter_map(|e| match e {
                Event::Mesh {
                    pos: (0, 0),
                    section: 6,
                    mesh,
                } => Some(mesh.quads()),
                _ => None,
            })
            .sum();
        assert_eq!(quads, 6);
        assert_eq!(s.world.block(0, 100, 5), 3);
    }

    #[test]
    fn stale_meshes_are_dropped() {
        let (mut s, pool) = setup(1);
        pump(&mut s, &pool, (0, 0));
        // Two edits in a row to the same section: only meshes carrying the
        // latest revision reach the renderer, and the final one shows both.
        s.set_block(3, 90, 3, 3, &pool);
        s.set_block(4, 90, 3, 3, &pool);
        let events = pump(&mut s, &pool, (0, 0));
        let last = events
            .iter()
            .rev()
            .find_map(|e| match e {
                Event::Mesh {
                    pos: (0, 0),
                    section: 5,
                    mesh,
                } => Some(mesh.quads()),
                _ => None,
            })
            .expect("section re-meshed");
        assert_eq!(last, 10);
    }
}
