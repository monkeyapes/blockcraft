//! Background work: generating chunks and meshing sections.
//!
//! A small pool of worker threads takes jobs from one shared queue and sends
//! results back over a channel; the main thread only ever inserts finished
//! chunks and uploads finished meshes, so a frame never waits on terrain.
//!
//! The queue is a plain vector searched for the most urgent job at each pop.
//! Urgency is the distance from wherever the player is *now* -- recorded in
//! the queue and read at pop time -- so turning round or flying off
//! re-prioritises everything already queued without re-sorting it, and the
//! chunks in front of the player are always the next ones built. A few
//! thousand entries scanned per pop costs microseconds against jobs that take
//! a fraction of a millisecond each.

use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, Sender};

use crate::content::BlockTable;
use crate::mesher::{mesh_section, Neighbourhood, Scratch, SectionMesh};
use crate::world::{Chunk, ChunkPos};

/// Where chunk data comes from.
#[derive(Clone, Copy, Debug)]
pub enum Terrain {
    /// The real generator, `worldgen`.
    Worldgen,
    /// The busy synthetic world for measuring the engine (stress.rs).
    Stress(crate::stress::Palette),
}

impl Terrain {
    pub fn generate(&self, seed: i32, pos: ChunkPos) -> Vec<u8> {
        match self {
            Terrain::Worldgen => {
                worldgen::generate_chunk(seed, worldgen::Dimension::Overworld, pos.0, pos.1)
            }
            Terrain::Stress(palette) => crate::stress::generate(seed, pos.0, pos.1, palette),
        }
    }
}

pub enum Job {
    Generate {
        pos: ChunkPos,
    },
    Mesh {
        pos: ChunkPos,
        section: usize,
        revision: u32,
        /// Edits jump the queue: the player is looking at the result.
        urgent: bool,
        hood: Neighbourhood,
    },
}

impl Job {
    fn pos(&self) -> ChunkPos {
        match self {
            Job::Generate { pos } | Job::Mesh { pos, .. } => *pos,
        }
    }
}

pub enum Done {
    Generated {
        pos: ChunkPos,
        chunk: Chunk,
        took: Duration,
    },
    Meshed {
        pos: ChunkPos,
        section: usize,
        revision: u32,
        mesh: SectionMesh,
        took: Duration,
    },
}

struct State {
    jobs: Vec<Job>,
    center: ChunkPos,
    shutdown: bool,
}

struct Queue {
    state: Mutex<State>,
    ready: Condvar,
}

impl Queue {
    fn pop(&self) -> Option<Job> {
        let mut s = self.state.lock().unwrap();
        loop {
            if s.shutdown {
                return None;
            }
            if !s.jobs.is_empty() {
                let (cx, cz) = s.center;
                let key = |j: &Job| -> i64 {
                    let (x, z) = j.pos();
                    let d = ((x - cx) as i64).pow(2) + ((z - cz) as i64).pow(2);
                    match j {
                        Job::Mesh { urgent: true, .. } => -1,
                        // A mesh needs its chunk and neighbours generated
                        // already, so at equal distance meshing goes first:
                        // it is what turns loaded data into something seen.
                        Job::Mesh { .. } => d * 2,
                        Job::Generate { .. } => d * 2 + 1,
                    }
                };
                let best = s
                    .jobs
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, j)| key(j))
                    .map(|(i, _)| i)
                    .unwrap();
                return Some(s.jobs.swap_remove(best));
            }
            s = self.ready.wait(s).unwrap();
        }
    }
}

pub struct JobPool {
    queue: Arc<Queue>,
    pub results: Receiver<Done>,
    workers: Vec<JoinHandle<()>>,
}

impl JobPool {
    pub fn new(threads: usize, seed: i32, terrain: Terrain, table: Arc<BlockTable>) -> Self {
        let queue = Arc::new(Queue {
            state: Mutex::new(State {
                jobs: Vec::new(),
                center: (0, 0),
                shutdown: false,
            }),
            ready: Condvar::new(),
        });
        let (tx, rx) = crossbeam_channel::unbounded();
        let workers = (0..threads.max(1))
            .map(|i| {
                let queue = queue.clone();
                let tx: Sender<Done> = tx.clone();
                let table = table.clone();
                std::thread::Builder::new()
                    .name(format!("worker-{i}"))
                    .spawn(move || worker(&queue, &tx, seed, terrain, &table))
                    .expect("spawn worker thread")
            })
            .collect();
        JobPool {
            queue,
            results: rx,
            workers,
        }
    }

    pub fn submit(&self, job: Job) {
        self.queue.state.lock().unwrap().jobs.push(job);
        self.queue.ready.notify_one();
    }

    pub fn submit_all(&self, jobs: impl IntoIterator<Item = Job>) {
        let mut s = self.queue.state.lock().unwrap();
        let before = s.jobs.len();
        s.jobs.extend(jobs);
        let added = s.jobs.len() - before;
        drop(s);
        match added {
            0 => {}
            1 => self.queue.ready.notify_one(),
            _ => self.queue.ready.notify_all(),
        }
    }

    /// Where the player is; queued work is taken nearest-first from here.
    pub fn set_center(&self, center: ChunkPos) {
        self.queue.state.lock().unwrap().center = center;
    }

    /// Drops queued jobs the caller no longer wants (chunks that went out of
    /// range before a worker got to them).
    pub fn retain(&self, mut keep: impl FnMut(&Job) -> bool) {
        self.queue.state.lock().unwrap().jobs.retain(|j| keep(j));
    }

    pub fn queued(&self) -> usize {
        self.queue.state.lock().unwrap().jobs.len()
    }
}

impl Drop for JobPool {
    fn drop(&mut self) {
        self.queue.state.lock().unwrap().shutdown = true;
        self.queue.ready.notify_all();
        for w in self.workers.drain(..) {
            let _ = w.join();
        }
    }
}

fn worker(queue: &Queue, tx: &Sender<Done>, seed: i32, terrain: Terrain, table: &BlockTable) {
    let mut scratch = Scratch::default();
    while let Some(job) = queue.pop() {
        let start = Instant::now();
        let done = match job {
            Job::Generate { pos } => {
                let blocks = terrain.generate(seed, pos);
                Done::Generated {
                    pos,
                    chunk: Chunk::new(blocks, table),
                    took: start.elapsed(),
                }
            }
            Job::Mesh {
                pos,
                section,
                revision,
                hood,
                ..
            } => Done::Meshed {
                pos,
                section,
                revision,
                mesh: mesh_section(&hood, section, table, &mut scratch),
                took: start.elapsed(),
            },
        };
        if tx.send(done).is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_nearest_first_and_returns_everything() {
        let table = Arc::new(BlockTable::load(None).unwrap());
        let pool = JobPool::new(1, 1, Terrain::Worldgen, table);
        // Queue far chunks first; with one worker, results come back in
        // priority order after whichever job the worker had already begun.
        pool.set_center((0, 0));
        pool.submit_all([(5, 5), (3, 0), (0, 1), (0, 0)].map(|pos| Job::Generate { pos }));
        let mut order = Vec::new();
        for _ in 0..4 {
            match pool.results.recv_timeout(Duration::from_secs(10)).unwrap() {
                Done::Generated { pos, chunk, .. } => {
                    assert_eq!(chunk.blocks.len(), worldgen::CHUNK_VOLUME);
                    order.push(pos);
                }
                Done::Meshed { .. } => panic!("no mesh jobs were queued"),
            }
        }
        // The first may be any (the worker can grab it before the rest are
        // queued); the rest are nearest-first.
        let rest = &order[1..];
        let dist = |p: &ChunkPos| p.0 * p.0 + p.1 * p.1;
        assert!(
            rest.windows(2).all(|w| dist(&w[0]) <= dist(&w[1])),
            "{order:?}"
        );
        assert_eq!(pool.queued(), 0);
    }
}
