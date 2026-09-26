//! Generation speed. Ignored by default because timings only mean something
//! in a release build on a quiet machine:
//!
//!     cargo test -p worldgen --release --test bench -- --ignored --nocapture
//!
//! The budget is 5 ms a chunk: a client streaming in a view distance of 8
//! needs ~300 chunks, and they should arrive in well under two seconds on
//! one core.

use std::hint::black_box;
use std::time::Instant;

use worldgen::{find_placement, generate_chunk, Dimension, StructureKind};

/// Best average over several batches: a single batch is at the mercy of
/// whatever else the machine is doing.
fn best_ms_per_chunk(dim: Dimension, chunks: &[(i32, i32)]) -> f64 {
    let mut best = f64::INFINITY;
    for _ in 0..5 {
        let start = Instant::now();
        for &(cx, cz) in chunks {
            black_box(generate_chunk(black_box(2406), dim, cx, cz));
        }
        best = best.min(start.elapsed().as_secs_f64() * 1000.0 / chunks.len() as f64);
    }
    best
}

#[test]
#[ignore]
fn chunk_generation_is_fast() {
    let area: Vec<(i32, i32)> = (-8..8).flat_map(|z| (-8..8).map(move |x| (x, z))).collect();

    // A village's own chunks, the most expensive overworld case.
    let village = (-20..20)
        .flat_map(|z| (-20..20).map(move |x| (x, z)))
        .find(|&(x, z)| find_placement(2406, StructureKind::Village, x, z).is_some())
        .expect("a village near the origin");
    let near_village: Vec<(i32, i32)> = (-2..=2)
        .flat_map(|z| (-2..=2).map(move |x| (village.0 + x, village.1 + z)))
        .collect();

    for (name, dim, chunks) in [
        ("overworld", Dimension::Overworld, &area),
        ("overworld (village)", Dimension::Overworld, &near_village),
        ("nether", Dimension::Nether, &area),
        ("end", Dimension::End, &area),
    ] {
        let ms = best_ms_per_chunk(dim, chunks);
        println!("{name:>20}: {ms:.3} ms per chunk");
        assert!(ms < 5.0, "{name} generation takes {ms:.3} ms per chunk");
    }
}
