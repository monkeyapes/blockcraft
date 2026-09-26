//! A synthetic world for measuring the engine, not for playing.
//!
//! Until the real generator lands in `worldgen`, its stand-in is a flat
//! plain: one layer of faces per chunk, which says nothing about how the
//! mesher and renderer cope with hills, caves, water and trees. This builds a
//! deliberately busy world -- rolling hills, cave tunnels that open onto the
//! surface, lakes, trees and plants -- so `--stress-world` can put numbers on
//! a load at least as heavy as real terrain. It is simple value noise, and
//! makes no attempt to look like Blockcraft's own terrain.

use worldgen::{voxel_index, CHUNK_VOLUME, CHUNK_X, CHUNK_Z, WORLD_Y};

use crate::content::BlockTable;

/// Block ids the generator places, looked up once by name.
#[derive(Clone, Copy, Debug)]
pub struct Palette {
    grass: u8,
    dirt: u8,
    stone: u8,
    sand: u8,
    water: u8,
    log: u8,
    leaves: u8,
    bedrock: u8,
    plants: [u8; 3],
}

impl Palette {
    pub fn new(table: &BlockTable) -> Self {
        let id = |name: &str| table.id_by_name(name).unwrap_or(0);
        Palette {
            grass: id("Grass Block"),
            dirt: id("Dirt"),
            stone: id("Stone"),
            sand: id("Sand"),
            water: id("Water"),
            log: id("Log"),
            leaves: id("Leaves"),
            bedrock: id("Bedrock"),
            plants: [id("Tall Grass"), id("Poppy"), id("Dandelion")],
        }
    }
}

const SEA: i32 = 46;

fn hash(seed: i32, x: i32, y: i32, z: i32) -> u32 {
    let mut h = (seed as u32).wrapping_mul(0x9E37_79B1)
        ^ (x as u32).wrapping_mul(0x85EB_CA77)
        ^ (y as u32).wrapping_mul(0xC2B2_AE3D)
        ^ (z as u32).wrapping_mul(0x27D4_EB2F);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2C1B_3C6D);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297A_2D39);
    h ^ (h >> 15)
}

fn unit(seed: i32, x: i32, y: i32, z: i32) -> f32 {
    hash(seed, x, y, z) as f32 / u32::MAX as f32
}

fn smooth(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

/// Trilinear value noise on a lattice of `cell` blocks, 0..1.
fn noise3(seed: i32, x: i32, y: i32, z: i32, cell: i32) -> f32 {
    let (gx, gy, gz) = (x.div_euclid(cell), y.div_euclid(cell), z.div_euclid(cell));
    let f = |v: i32| smooth(v.rem_euclid(cell) as f32 / cell as f32);
    let (fx, fy, fz) = (f(x), f(y), f(z));
    let lerp = |a: f32, b: f32, t: f32| a + (b - a) * t;
    let c = |dx, dy, dz| unit(seed, gx + dx, gy + dy, gz + dz);
    let x00 = lerp(c(0, 0, 0), c(1, 0, 0), fx);
    let x10 = lerp(c(0, 1, 0), c(1, 1, 0), fx);
    let x01 = lerp(c(0, 0, 1), c(1, 0, 1), fx);
    let x11 = lerp(c(0, 1, 1), c(1, 1, 1), fx);
    lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz)
}

fn height(seed: i32, x: i32, z: i32) -> i32 {
    let n = noise3(seed, x, 0, z, 48) * 0.65
        + noise3(seed + 1, x, 0, z, 16) * 0.25
        + noise3(seed + 2, x, 0, z, 6) * 0.1;
    (30.0 + n * 42.0) as i32
}

pub fn generate(seed: i32, cx: i32, cz: i32, p: &Palette) -> Vec<u8> {
    let mut d = vec![0u8; CHUNK_VOLUME];
    let (ox, oz) = (cx * CHUNK_X as i32, cz * CHUNK_Z as i32);
    let mut heights = [0i32; CHUNK_X * CHUNK_Z];
    for lz in 0..CHUNK_Z {
        for lx in 0..CHUNK_X {
            let (x, z) = (ox + lx as i32, oz + lz as i32);
            let h = height(seed, x, z);
            heights[lz * CHUNK_X + lx] = h;
            for y in 0..WORLD_Y as i32 {
                let id = if y == 0 {
                    p.bedrock
                } else if y <= h {
                    // Worm-like tunnels where two noise fields cross zero.
                    let a = noise3(seed + 3, x, y, z, 12) - 0.5;
                    let b = noise3(seed + 4, x, y, z, 10) - 0.5;
                    if y > 4 && a.abs() < 0.06 && b.abs() < 0.08 {
                        0
                    } else if y == h {
                        if h < SEA + 2 {
                            p.sand
                        } else {
                            p.grass
                        }
                    } else if y > h - 4 {
                        if h < SEA + 2 {
                            p.sand
                        } else {
                            p.dirt
                        }
                    } else {
                        p.stone
                    }
                } else if y <= SEA {
                    p.water
                } else {
                    0
                };
                d[voxel_index(lx, y as usize, lz)] = id;
            }
        }
    }
    // Plants and trees, kept two blocks from the chunk edge so a tree never
    // needs its neighbour's data.
    for lz in 2..CHUNK_Z - 2 {
        for lx in 2..CHUNK_X - 2 {
            let (x, z) = (ox + lx as i32, oz + lz as i32);
            let h = heights[lz * CHUNK_X + lx] as usize;
            if h + 8 >= WORLD_Y || d[voxel_index(lx, h, lz)] != p.grass {
                continue;
            }
            let r = hash(seed + 5, x, 0, z) % 100;
            if r < 2 {
                for y in h + 1..h + 6 {
                    d[voxel_index(lx, y, lz)] = p.log;
                }
                for y in h + 4..h + 8 {
                    let spread: i32 = if y >= h + 6 { 1 } else { 2 };
                    for dz in -spread..=spread {
                        for dx in -spread..=spread {
                            let (tx, tz) = ((lx as i32 + dx) as usize, (lz as i32 + dz) as usize);
                            let i = voxel_index(tx, y, tz);
                            if d[i] == 0 {
                                d[i] = p.leaves;
                            }
                        }
                    }
                }
            } else if r < 22 {
                d[voxel_index(lx, h + 1, lz)] = p.plants[(r % 3) as usize];
            }
        }
    }
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stress_terrain_is_busy_and_deterministic() {
        let t = BlockTable::load(None).unwrap();
        let p = Palette::new(&t);
        let a = generate(3, 0, 0, &p);
        assert_eq!(a, generate(3, 0, 0, &p));
        assert_ne!(a, generate(3, 1, 0, &p));
        // Hilly: the surface is not one height everywhere.
        let tops: std::collections::HashSet<usize> = (0..16)
            .map(|x| {
                (0..WORLD_Y)
                    .rev()
                    .find(|&y| t.solid[a[voxel_index(x, y, 0)] as usize])
                    .unwrap()
            })
            .collect();
        assert!(tops.len() > 1);
    }
}
