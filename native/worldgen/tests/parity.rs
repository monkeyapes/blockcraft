//! Parity with the TypeScript generator.
//!
//! The vectors in `tests/data` are written by tools/export-worldgen-vectors.ts
//! from shared/src/terrain.ts. Every chunk there must come out of the Rust
//! generator byte for byte; a mismatch names the first voxel that differs so
//! the bug can be found rather than just detected.

use std::fs;
use std::path::PathBuf;

use worldgen::noise::{fbm2, fbm3, hash2, hash3, js_hypot, value2, value3};
use worldgen::*;

fn data_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/data")
        .join(name)
}

/// One exported chunk.
struct Vector {
    label: String,
    seed: i32,
    dim: Dimension,
    cx: i32,
    cz: i32,
    fnv: u32,
    blocks: Vec<u8>,
}

/// FNV-1a, 32-bit, as the exporter computes it.
fn fnv1a(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0x811c_9dc5u32, |h, &b| {
        (h ^ b as u32).wrapping_mul(0x0100_0193)
    })
}

/// Undoes the exporter's run-length encoding: (value, LEB128 length) pairs.
fn unrle(mut bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(CHUNK_VOLUME);
    while let Some((&value, rest)) = bytes.split_first() {
        let mut len = 0usize;
        let mut shift = 0;
        let mut i = 0;
        loop {
            let b = rest[i];
            len |= ((b & 0x7f) as usize) << shift;
            shift += 7;
            i += 1;
            if b & 0x80 == 0 {
                break;
            }
        }
        out.resize(out.len() + len, value);
        bytes = &rest[i..];
    }
    out
}

fn load_vectors() -> Vec<Vector> {
    let raw = fs::read(data_path("chunks.bin"))
        .expect("tests/data/chunks.bin missing: run tools/export-worldgen-vectors.ts");
    assert_eq!(&raw[0..4], b"BCWG", "not a worldgen vector file");
    let u32_at = |o: usize| u32::from_le_bytes(raw[o..o + 4].try_into().unwrap());
    assert_eq!(u32_at(4), 1, "unknown vector format version");
    let count = u32_at(8) as usize;
    let mut o = 12;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let label_len = raw[o] as usize;
        let label = String::from_utf8(raw[o + 1..o + 1 + label_len].to_vec()).unwrap();
        o += 1 + label_len;
        let seed = u32_at(o) as i32;
        let dim = Dimension::from_id(raw[o + 4]).expect("bad dimension id");
        let cx = u32_at(o + 5) as i32;
        let cz = u32_at(o + 9) as i32;
        let fnv = u32_at(o + 13);
        let len = u32_at(o + 17) as usize;
        o += 21;
        let blocks = unrle(&raw[o..o + len]);
        o += len;
        assert_eq!(
            blocks.len(),
            CHUNK_VOLUME,
            "vector {label} decodes to the wrong size"
        );
        assert_eq!(fnv1a(&blocks), fnv, "vector {label} is corrupt");
        out.push(Vector {
            label,
            seed,
            dim,
            cx,
            cz,
            fnv,
            blocks,
        });
    }
    assert_eq!(o, raw.len(), "trailing bytes in chunks.bin");
    out
}

/// Describes the first voxel where `got` differs from `want`, and how many do.
fn first_difference(want: &[u8], got: &[u8]) -> Option<String> {
    let first = (0..CHUNK_VOLUME).find(|&i| want[i] != got[i])?;
    let count = (0..CHUNK_VOLUME).filter(|&i| want[i] != got[i]).count();
    let (x, z, y) = (first & 15, (first >> 4) & 15, first >> 8);
    Some(format!(
        "first difference at local (x={x}, y={y}, z={z}): expected {} got {} ({count} voxels differ)",
        want[first], got[first]
    ))
}

#[test]
fn every_chunk_matches_typescript() {
    let vectors = load_vectors();
    assert!(
        vectors.len() >= 100,
        "expected a full vector set, found {}",
        vectors.len()
    );
    let mut failures = Vec::new();
    for v in &vectors {
        let got = generate_chunk(v.seed, v.dim, v.cx, v.cz);
        if fnv1a(&got) == v.fnv && got == v.blocks {
            continue;
        }
        let why = first_difference(&v.blocks, &got).unwrap_or_else(|| "hash differs".into());
        failures.push(format!(
            "[{}] seed {} {:?} chunk ({}, {}): {why}",
            v.label, v.seed, v.dim, v.cx, v.cz
        ));
    }
    assert!(
        failures.is_empty(),
        "{} of {} chunks differ:\n{}",
        failures.len(),
        vectors.len(),
        failures.join("\n")
    );
}

/// The vector set covers what it claims to: every dimension, several seeds
/// including negative ones, strongholds, structures and every biome.
#[test]
fn vectors_cover_the_interesting_cases() {
    let vectors = load_vectors();
    let has = |f: &dyn Fn(&Vector) -> bool| vectors.iter().any(f);
    for dim in [Dimension::Overworld, Dimension::Nether, Dimension::End] {
        assert!(has(&|v| v.dim == dim), "no {dim:?} vectors");
    }
    assert!(has(&|v| v.seed < 0), "no negative seed");
    assert!(
        has(&|v| v.cx <= -1000 || v.cz <= -1000),
        "no far negative chunk"
    );
    assert!(
        has(&|v| v.cx >= 1000 || v.cz >= 1000),
        "no far positive chunk"
    );
    for label in [
        "stronghold",
        "village",
        "village-edge",
        "mansion",
        "mansion-edge",
    ] {
        assert!(has(&|v| v.label == label), "no {label} vector");
    }
    for v in vectors.iter().filter(|v| v.label == "stronghold") {
        assert!(is_stronghold_chunk(v.seed, v.cx, v.cz));
    }
    for v in vectors
        .iter()
        .filter(|v| v.label == "village" || v.label == "mansion")
    {
        let kind = if v.label == "village" {
            StructureKind::Village
        } else {
            StructureKind::Mansion
        };
        assert!(
            find_placement(v.seed, kind, v.cx, v.cz).is_some(),
            "{} at ({}, {}) not found",
            v.label,
            v.cx,
            v.cz
        );
    }
    // Each seed has an overworld chunk centred in every biome (a chunk found
    // for its biome may already be in the set under another label).
    let mut seeds: Vec<i32> = vectors.iter().map(|v| v.seed).collect();
    seeds.dedup();
    assert!(seeds.len() >= 3, "only {} seeds", seeds.len());
    for seed in seeds {
        let mut seen = [false; 7];
        for v in vectors
            .iter()
            .filter(|v| v.seed == seed && v.dim == Dimension::Overworld)
        {
            seen[biome_at(seed, v.cx * 16 + 8, v.cz * 16 + 8) as usize] = true;
        }
        assert!(
            seen.iter().all(|&s| s),
            "seed {seed} lacks a biome: {seen:?}"
        );
    }
}

// ------------------------------------------------------------------ helpers

fn f(hex: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(hex, 16).unwrap())
}

fn i(s: &str) -> i32 {
    s.parse().unwrap()
}

/// Checks every helper line; returns the failures rather than stopping at
/// the first, so one run shows the whole picture.
#[test]
fn helpers_match_typescript() {
    let text =
        fs::read_to_string(data_path("helpers.txt")).expect("tests/data/helpers.txt missing");
    let mut failures = Vec::new();
    let mut checked = 0;
    for line in text
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
    {
        let p: Vec<&str> = line.split(' ').collect();
        let ok = match p[0] {
            "column" => {
                let (seed, x, z) = (i(p[1]), i(p[2]), i(p[3]));
                let c = climate_at(seed, x, z);
                column_height(seed, x, z) == i(p[4])
                    && biome_at(seed, x, z) as i32 == i(p[5])
                    && c.temp.to_bits() == f(p[6]).to_bits()
                    && c.wet.to_bits() == f(p[7]).to_bits()
            }
            "surface" => {
                let dim = Dimension::from_id(p[2].parse().unwrap()).unwrap();
                surface_y(i(p[1]), dim, i(p[3]), i(p[4])) == i(p[5])
            }
            "stronghold" => {
                stronghold_location(i(p[1]), i(p[2]), i(p[3])) == (i(p[4]), i(p[5]), i(p[6]))
            }
            "isstronghold" => is_stronghold_chunk(i(p[1]), i(p[2]), i(p[3])) == (p[4] == "1"),
            "placement" => {
                let kind = if p[2] == "village" {
                    StructureKind::Village
                } else {
                    StructureKind::Mansion
                };
                let got = find_placement(i(p[1]), kind, i(p[3]), i(p[4]));
                match (p[5], got) {
                    ("none", None) => true,
                    ("some", Some(_)) => true,
                    ("none" | "some", _) => false,
                    (_, Some(pl)) => (pl.x, pl.z, pl.radius) == (i(p[5]), i(p[6]), i(p[7])),
                    (_, None) => false,
                }
            }
            "hash2" => hash2(i(p[1]), i(p[2]), i(p[3])).to_bits() == f(p[4]).to_bits(),
            "hash3" => hash3(i(p[1]), i(p[2]), i(p[3]), i(p[4])).to_bits() == f(p[5]).to_bits(),
            "value2" => value2(f(p[1]), f(p[2]), i(p[3])).to_bits() == f(p[4]).to_bits(),
            "value3" => value3(f(p[1]), f(p[2]), f(p[3]), i(p[4])).to_bits() == f(p[5]).to_bits(),
            "fbm2" => {
                fbm2(f(p[1]), f(p[2]), i(p[3]), p[4].parse().unwrap(), 0.5).to_bits()
                    == f(p[5]).to_bits()
            }
            "fbm3" => {
                fbm3(
                    f(p[1]),
                    f(p[2]),
                    f(p[3]),
                    i(p[4]),
                    p[5].parse().unwrap(),
                    0.5,
                )
                .to_bits()
                    == f(p[6]).to_bits()
            }
            "hypot" => js_hypot(f(p[1]), f(p[2])).to_bits() == f(p[3]).to_bits(),
            "tree" => {
                let kind = match p[1] {
                    "oak" => TreeKind::Oak,
                    "birch" => TreeKind::Birch,
                    _ => TreeKind::Pine,
                };
                let cells: Vec<String> = tree_cells(kind, i(p[2]))
                    .iter()
                    .map(|c| format!("{},{},{},{},{}", c.dx, c.dy, c.dz, c.id, c.trunk as u8))
                    .collect();
                cells.join(";") == p.get(3).copied().unwrap_or("")
            }
            other => panic!("unknown helper vector kind {other:?}"),
        };
        checked += 1;
        if !ok {
            failures.push(line.to_string());
        }
    }
    assert!(checked > 1000, "only {checked} helper vectors");
    assert!(
        failures.is_empty(),
        "{} of {checked} helper vectors differ (first 20):\n{}",
        failures.len(),
        failures
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn biome_names_match_the_game() {
    assert_eq!(Biome::SnowyTaiga.name(), "Snowy Taiga");
    assert_eq!(BIOME_NAMES.len(), Biome::ALL.len());
    for b in Biome::ALL {
        assert_eq!(Biome::from_id(b as u8), Some(b));
    }
}
