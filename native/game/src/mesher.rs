//! Section mesher: turns a 16x16x16 slice of a chunk into quads.
//!
//! A port of client/src/mesher.ts. Only faces that touch a see-through block
//! are emitted; each vertex carries ambient occlusion and a light value
//! averaged over the voxels meeting at that corner, so shading grades across
//! a wall instead of switching block by block. Shaped blocks are drawn box by
//! box with the texture following each box's real extent, and plants are two
//! crossed planes.
//!
//! Light in this phase is sky light only, worked out locally (see
//! [`sky_light`]): full propagation across chunks, and torches, come with
//! Phase 2.
//!
//! Everything here is pure and runs on worker threads. The input is a
//! snapshot of the 3x3 chunks around the section, so a job never touches the
//! live world.

use std::sync::Arc;

use bytemuck::{Pod, Zeroable};
use worldgen::{voxel_index, CHUNK_X, CHUNK_Z, WORLD_Y};

use crate::content::{BlockTable, Cross};
use crate::world::{ChunkPos, Heightmap, SECTION_Y};

/// One corner of a quad. 16 bytes: bandwidth, not arithmetic, is what a
/// voxel renderer runs out of first, and a million vertices in view is
/// ordinary at a 12-chunk render distance.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct Vertex {
    /// Section-local position in 1/256 of a block, biased by [`POS_BIAS`]
    /// blocks so models that poke slightly out of their cell stay positive.
    /// The fourth lane is padding.
    pub pos: [u16; 4],
    /// Atlas coordinates, 0..65535 across the whole atlas.
    pub uv: [u16; 2],
    /// Light (already multiplied by the face's shade) and ambient occlusion,
    /// as 0..255; the last two lanes are padding.
    pub shade: [u8; 4],
}

/// Positions are stored as `(p + POS_BIAS) * POS_SCALE`.
pub const POS_BIAS: f32 = 4.0;
pub const POS_SCALE: f32 = 256.0;

impl Vertex {
    pub fn new(p: [f32; 3], uv: [f32; 2], light: f32, ao: f32) -> Self {
        let q = |v: f32| ((v + POS_BIAS) * POS_SCALE).round().clamp(0.0, 65535.0) as u16;
        let u = |v: f32| (v * 65535.0).round().clamp(0.0, 65535.0) as u16;
        let b = |v: f32| (v * 255.0).round().clamp(0.0, 255.0) as u8;
        Vertex {
            pos: [q(p[0]), q(p[1]), q(p[2]), 0],
            uv: [u(uv[0]), u(uv[1])],
            shade: [b(light), b(ao), 0, 0],
        }
    }

    /// The section-local position this vertex decodes to.
    pub fn position(&self) -> [f32; 3] {
        let d = |v: u16| v as f32 / POS_SCALE - POS_BIAS;
        [d(self.pos[0]), d(self.pos[1]), d(self.pos[2])]
    }
}

/// A section's geometry. Everything is quads, four vertices each, drawn with
/// one shared index buffer -- so no per-section index data at all.
#[derive(Default, Debug)]
pub struct SectionMesh {
    pub opaque: Vec<Vertex>,
    /// Water, glass and the like: blended, drawn after everything opaque.
    pub alpha: Vec<Vertex>,
}

impl SectionMesh {
    pub fn is_empty(&self) -> bool {
        self.opaque.is_empty() && self.alpha.is_empty()
    }
    pub fn quads(&self) -> usize {
        (self.opaque.len() + self.alpha.len()) / 4
    }
}

/// The 3x3 chunks around the one being meshed, as shared snapshots.
/// Index `(dz + 1) * 3 + (dx + 1)`. A missing chunk reads as air.
#[derive(Clone)]
pub struct Neighbourhood {
    pub center: ChunkPos,
    pub chunks: [Option<Arc<Vec<u8>>>; 9],
    pub heights: [Option<Arc<Heightmap>>; 9],
}

// --- faces ---------------------------------------------------------------------

struct Face {
    n: [i32; 3],
    /// Corner offsets, counter-clockwise seen from outside.
    corners: [[u8; 3]; 4],
    shade: f32,
    /// In-plane axes used for ambient occlusion sampling.
    ax: [i32; 3],
    az: [i32; 3],
    /// Which local axis drives each texture coordinate, and whether it runs
    /// backwards, so a partial box shows its real share of the tile.
    u_axis: usize,
    u_flip: bool,
    v_axis: usize,
    v_flip: bool,
}

/// Face order: 0=+Y, 1=-Y, 2=+Z, 3=-Z, 4=+X, 5=-X, exactly as in mesher.ts,
/// shades included (top 1.0, bottom 0.5, N/S 0.8, E/W 0.65).
const FACES: [Face; 6] = [
    Face {
        n: [0, 1, 0],
        corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
        shade: 1.0,
        ax: [1, 0, 0],
        az: [0, 0, 1],
        u_axis: 0,
        u_flip: false,
        v_axis: 2,
        v_flip: false,
    },
    Face {
        n: [0, -1, 0],
        corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
        shade: 0.5,
        ax: [1, 0, 0],
        az: [0, 0, 1],
        u_axis: 0,
        u_flip: false,
        v_axis: 2,
        v_flip: true,
    },
    Face {
        n: [0, 0, 1],
        corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
        shade: 0.8,
        ax: [1, 0, 0],
        az: [0, 1, 0],
        u_axis: 0,
        u_flip: false,
        v_axis: 1,
        v_flip: true,
    },
    Face {
        n: [0, 0, -1],
        corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
        shade: 0.8,
        ax: [-1, 0, 0],
        az: [0, 1, 0],
        u_axis: 0,
        u_flip: true,
        v_axis: 1,
        v_flip: true,
    },
    Face {
        n: [1, 0, 0],
        corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
        shade: 0.65,
        ax: [0, 0, -1],
        az: [0, 1, 0],
        u_axis: 2,
        u_flip: true,
        v_axis: 1,
        v_flip: true,
    },
    Face {
        n: [-1, 0, 0],
        corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
        shade: 0.65,
        ax: [0, 0, 1],
        az: [0, 1, 0],
        u_axis: 2,
        u_flip: false,
        v_axis: 1,
        v_flip: true,
    },
];

// --- the working region ------------------------------------------------------------

/// Blocks of context kept around the section on every side. The mesher needs
/// one (neighbour faces, AO); the sky light needs its full reach beyond that,
/// so the light at the section's skirt is exact and adjacent sections agree
/// at their shared border -- no seams.
const MARGIN: usize = SKY_REACH as usize + 1;
/// Edge of the cube of cells a job works on.
const R: usize = SECTION_Y + 2 * MARGIN;
const R2: usize = R * R;
const R3: usize = R * R * R;

#[inline]
fn ri(x: usize, y: usize, z: usize) -> usize {
    (y * R + z) * R + x
}

/// Sky light at an open-sky cell.
pub const MAX_LIGHT: u8 = 15;
/// Sky light lost per block it spreads sideways or down from open sky.
///
/// Two per block rather than the web game's one keeps the spread local --
/// seven blocks -- so a section can be lit exactly from a small window of
/// the world instead of from a whole-world light pass, which is Phase 2.
/// Shade under a tree or an overhang still grades from the edge inward.
pub const SKY_STEP: u8 = 2;
/// How far sky light spreads from open sky, in blocks.
pub const SKY_REACH: i32 = (MAX_LIGHT / SKY_STEP) as i32;

/// Never fully black, so an unlit cave is gloomy rather than invisible.
const AMBIENT_FLOOR: f32 = 0.06;
/// Each light level keeps this fraction of the one above (mesher.ts).
const LIGHT_STEP: f32 = 0.82;

fn falloff(level: f32) -> f32 {
    // Rounded to sixteenths of a level, like the web game's lookup table.
    let level = (level * 16.0).round() / 16.0;
    LIGHT_STEP.powf(MAX_LIGHT as f32 - level.clamp(0.0, MAX_LIGHT as f32))
}

/// Classic voxel AO: darker where two sides and the corner are filled.
fn vertex_ao(side1: bool, side2: bool, corner: bool) -> f32 {
    if side1 && side2 {
        return 0.52;
    }
    [1.0, 0.84, 0.68, 0.52][side1 as usize + side2 as usize + corner as usize]
}

/// Scratch buffers for one job, reused between jobs on the same thread so a
/// worker allocates nothing per section after its first.
pub struct Scratch {
    ids: Vec<u8>,
    opaque: Vec<bool>,
    /// Opaque *and* filling the cell: only these hide the face of the block
    /// beside them. An opaque conveyor is a 3/16 slab, and the underside of
    /// the block above it shows through the gap.
    hides: Vec<bool>,
    sky: Vec<u8>,
    queue: Vec<u16>,
}

impl Default for Scratch {
    fn default() -> Self {
        Scratch {
            ids: vec![0; R3],
            opaque: vec![false; R3],
            hides: vec![false; R3],
            sky: vec![0; R3],
            queue: Vec::with_capacity(R3),
        }
    }
}

/// Copies the section and its margin out of the neighbourhood and works out
/// which cells are opaque and which see the sky.
fn fill(n: &Neighbourhood, section: usize, table: &BlockTable, s: &mut Scratch) {
    let base_y = (section * SECTION_Y) as i32 - MARGIN as i32;
    for y in 0..R {
        let wy = base_y + y as i32;
        for z in 0..R {
            // Region z to chunk-local z and which chunk row it falls in.
            let rz = z as i32 - MARGIN as i32;
            let dz = rz.div_euclid(CHUNK_Z as i32);
            let lz = rz.rem_euclid(CHUNK_Z as i32) as usize;
            let row = ri(0, y, z);
            if wy < 0 {
                // Below the world: nothing to see and no light, and opaque so
                // the underside of the bottom layer is never drawn.
                s.ids[row..row + R].fill(0);
                s.opaque[row..row + R].fill(true);
                s.hides[row..row + R].fill(true);
                s.sky[row..row + R].fill(0);
                continue;
            }
            if wy >= WORLD_Y as i32 {
                // Above the world: open sky.
                s.ids[row..row + R].fill(0);
                s.opaque[row..row + R].fill(false);
                s.hides[row..row + R].fill(false);
                s.sky[row..row + R].fill(MAX_LIGHT);
                continue;
            }
            // x is contiguous in the chunk layout, so copy runs per chunk.
            let mut x = 0;
            while x < R {
                let rx = x as i32 - MARGIN as i32;
                let dx = rx.div_euclid(CHUNK_X as i32);
                let lx = rx.rem_euclid(CHUNK_X as i32) as usize;
                let run = (CHUNK_X - lx).min(R - x);
                let k = ((dz + 1) * 3 + (dx + 1)) as usize;
                let dst = row + x;
                match (&n.chunks[k], &n.heights[k]) {
                    (Some(blocks), Some(heights)) => {
                        let src = voxel_index(lx, wy as usize, lz);
                        s.ids[dst..dst + run].copy_from_slice(&blocks[src..src + run]);
                        for i in 0..run {
                            let id = s.ids[dst + i];
                            let opaque = table.opaque[id as usize];
                            s.opaque[dst + i] = opaque;
                            s.hides[dst + i] = table.hides[id as usize];
                            let open = wy > heights[lz * CHUNK_X + lx + i] as i32;
                            s.sky[dst + i] = if open && !opaque { MAX_LIGHT } else { 0 };
                        }
                    }
                    _ => {
                        s.ids[dst..dst + run].fill(0);
                        s.opaque[dst..dst + run].fill(false);
                        s.hides[dst..dst + run].fill(false);
                        s.sky[dst..dst + run].fill(MAX_LIGHT);
                    }
                }
                x += run;
            }
        }
    }
}

/// Spreads sky light from open-sky cells into covered ones, losing
/// [`SKY_STEP`] per block and stopped by opaque blocks.
///
/// A breadth-first flood: every source starts at the same level and every
/// step costs the same, so the first time a cell is reached is its best
/// value and a plain FIFO queue gives exact results.
pub fn sky_light(s: &mut Scratch) {
    s.queue.clear();
    // Seed only the edge of the open sky: an open cell with a covered,
    // see-through neighbour. Most open cells are surrounded by open air and
    // would only be popped and ignored.
    for y in 0..R {
        for z in 0..R {
            for x in 0..R {
                let i = ri(x, y, z);
                if s.sky[i] != MAX_LIGHT {
                    continue;
                }
                let dark = |j: usize| !s.opaque[j] && s.sky[j] < MAX_LIGHT - SKY_STEP;
                let edge = (x > 0 && dark(i - 1))
                    || (x + 1 < R && dark(i + 1))
                    || (z > 0 && dark(i - R))
                    || (z + 1 < R && dark(i + R))
                    || (y > 0 && dark(i - R2))
                    || (y + 1 < R && dark(i + R2));
                if edge {
                    s.queue.push(i as u16);
                }
            }
        }
    }
    let mut head = 0;
    while head < s.queue.len() {
        let i = s.queue[head] as usize;
        head += 1;
        let level = s.sky[i];
        if level <= SKY_STEP {
            continue;
        }
        let next = level - SKY_STEP;
        let x = i % R;
        let z = (i / R) % R;
        let y = i / R2;
        let visit = |j: usize, s: &mut Scratch| {
            if !s.opaque[j] && s.sky[j] < next {
                s.sky[j] = next;
                s.queue.push(j as u16);
            }
        };
        if x > 0 {
            visit(i - 1, s);
        }
        if x + 1 < R {
            visit(i + 1, s);
        }
        if z > 0 {
            visit(i - R, s);
        }
        if z + 1 < R {
            visit(i + R, s);
        }
        if y > 0 {
            visit(i - R2, s);
        }
        if y + 1 < R {
            visit(i + R2, s);
        }
    }
}

/// Meshes one section. Returns an empty mesh for a section with no faces.
pub fn mesh_section(
    n: &Neighbourhood,
    section: usize,
    table: &BlockTable,
    s: &mut Scratch,
) -> SectionMesh {
    fill(n, section, table, s);
    sky_light(s);

    let mut out = SectionMesh::default();
    let m = MARGIN;

    for y in 0..SECTION_Y {
        for z in 0..CHUNK_Z {
            for x in 0..CHUNK_X {
                let here = ri(x + m, y + m, z + m);
                let id = s.ids[here];
                if id == 0 {
                    continue;
                }
                let def = table.get(id);
                let verts = if def.translucent {
                    &mut out.alpha
                } else {
                    &mut out.opaque
                };
                let emitter = def.light > 0;

                if let Some(cross) = def.cross {
                    let light = if emitter {
                        1.0
                    } else {
                        falloff(s.sky[here] as f32).max(AMBIENT_FLOOR)
                    };
                    let uv = table.tile_uv(def.textures[2]);
                    emit_cross(verts, uv, [x as f32, y as f32, z as f32], cross, light);
                    continue;
                }

                for model in &def.visual {
                    let lo = model.aabb.min;
                    let hi = model.aabb.max;
                    for (f, face) in FACES.iter().enumerate() {
                        let axis = if face.n[0] != 0 {
                            0
                        } else if face.n[1] != 0 {
                            1
                        } else {
                            2
                        };
                        let positive = face.n[axis] > 0;
                        // Only a face on the cell wall can be hidden by a
                        // neighbour: a slab's top is mid-cell and always shows.
                        let flush = if positive {
                            hi[axis] >= 1.0 - 1e-6
                        } else {
                            lo[axis] <= 1e-6
                        };
                        let nx = (x + m) as i32 + face.n[0];
                        let ny = (y + m) as i32 + face.n[1];
                        let nz = (z + m) as i32 + face.n[2];
                        let at = |dx: i32, dy: i32, dz: i32| {
                            ri((nx + dx) as usize, (ny + dy) as usize, (nz + dz) as usize)
                        };
                        let n_idx = at(0, 0, 0);
                        if flush {
                            let neighbour = s.ids[n_idx];
                            // Same block hides its own internal faces (water
                            // against water, glass against glass).
                            if (neighbour == id && neighbour != 0) || s.hides[n_idx] {
                                continue;
                            }
                        }

                        let slot = model.textures[match f {
                            0 => 0,
                            1 => 1,
                            _ => 2,
                        }];
                        let [u0, v0, u1, v1] = table.tile_uv(slot);

                        for c in &face.corners {
                            let local = [
                                if c[0] == 0 { lo[0] } else { hi[0] },
                                if c[1] == 0 { lo[1] } else { hi[1] },
                                if c[2] == 0 { lo[2] } else { hi[2] },
                            ];
                            // AO samples sit in the plane just outside this
                            // face; which way each corner leans comes from the
                            // corner offset.
                            let e = [
                                c[0] as i32 * 2 - 1,
                                c[1] as i32 * 2 - 1,
                                c[2] as i32 * 2 - 1,
                            ];
                            let su = e[0] * face.ax[0] + e[1] * face.ax[1] + e[2] * face.ax[2];
                            let sv = e[0] * face.az[0] + e[1] * face.az[1] + e[2] * face.az[2];
                            let i1 = at(face.ax[0] * su, face.ax[1] * su, face.ax[2] * su);
                            let i2 = at(face.az[0] * sv, face.az[1] * sv, face.az[2] * sv);
                            let ic = at(
                                face.ax[0] * su + face.az[0] * sv,
                                face.ax[1] * su + face.az[1] * sv,
                                face.ax[2] * su + face.az[2] * sv,
                            );
                            let (o1, o2, oc) = (s.opaque[i1], s.opaque[i2], s.opaque[ic]);
                            let ao = vertex_ao(o1, o2, oc);

                            let light = if emitter {
                                1.0
                            } else {
                                // Average the see-through voxels meeting at
                                // this corner; opaque ones hold no light and
                                // would only drag it dark (AO does that job).
                                let mut sky = s.sky[n_idx] as u32;
                                let mut count = 1;
                                if !o1 {
                                    sky += s.sky[i1] as u32;
                                    count += 1;
                                }
                                if !o2 {
                                    sky += s.sky[i2] as u32;
                                    count += 1;
                                }
                                if !oc && !(o1 && o2) {
                                    sky += s.sky[ic] as u32;
                                    count += 1;
                                }
                                falloff(sky as f32 / count as f32).max(AMBIENT_FLOOR)
                            };

                            let fu = if face.u_flip {
                                1.0 - local[face.u_axis]
                            } else {
                                local[face.u_axis]
                            };
                            let fv = if face.v_flip {
                                1.0 - local[face.v_axis]
                            } else {
                                local[face.v_axis]
                            };
                            verts.push(Vertex::new(
                                [
                                    x as f32 + local[0],
                                    y as f32 + local[1],
                                    z as f32 + local[2],
                                ],
                                [u0 + (u1 - u0) * fu, v0 + (v1 - v0) * fv],
                                light * face.shade,
                                ao,
                            ));
                        }
                    }
                }
            }
        }
    }
    out
}

/// Two crossed planes, the way grass, flowers and crops are drawn.
///
/// Each plane goes out with both windings so it shows from either side --
/// the opaque pass culls back faces, and a flower that vanishes as you walk
/// round it is worse than none. Transparent texels are discarded by the
/// shader, so these sit in the opaque pass with no sorting at all.
fn emit_cross(verts: &mut Vec<Vertex>, uv: [f32; 4], p: [f32; 3], cross: Cross, light: f32) {
    let [u0, v0, u1, v1] = uv;
    // Corner to corner of the cell, less a little so neighbouring plants do
    // not z-fight.
    let lo = 0.5 - (0.5 - cross.inset) * std::f32::consts::FRAC_1_SQRT_2;
    let hi = 1.0 - lo;
    let h = cross.height;
    // The top of the texture lines up with the top of the plant, so a short
    // plant shows the bottom of its tile rather than a squashed whole.
    let vt = v1 - (v1 - v0) * h;
    for (ax, az, bx, bz) in [(lo, lo, hi, hi), (lo, hi, hi, lo)] {
        let corners = [
            ([ax, 0.0, az], [u0, v1]),
            ([bx, 0.0, bz], [u1, v1]),
            ([bx, h, bz], [u1, vt]),
            ([ax, h, az], [u0, vt]),
        ];
        for flip in [false, true] {
            for k in 0..4 {
                let (c, t) = corners[if flip { 3 - k } else { k }];
                verts.push(Vertex::new(
                    [p[0] + c[0], p[1] + c[1], p[2] + c[2]],
                    t,
                    light * 0.92,
                    1.0,
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use worldgen::CHUNK_VOLUME;

    fn table() -> BlockTable {
        BlockTable::load(None).unwrap()
    }

    /// A neighbourhood of nine chunks, all built by `f(world x, y, world z)`
    /// around chunk (0, 0).
    fn hood(table: &BlockTable, f: impl Fn(i32, i32, i32) -> u8) -> Neighbourhood {
        let mut chunks: [Option<Arc<Vec<u8>>>; 9] = Default::default();
        let mut heights: [Option<Arc<Heightmap>>; 9] = Default::default();
        for dz in -1..=1 {
            for dx in -1..=1 {
                let mut b = vec![0u8; CHUNK_VOLUME];
                for y in 0..WORLD_Y {
                    for z in 0..CHUNK_Z {
                        for x in 0..CHUNK_X {
                            b[voxel_index(x, y, z)] =
                                f(dx * 16 + x as i32, y as i32, dz * 16 + z as i32);
                        }
                    }
                }
                let k = ((dz + 1) * 3 + dx + 1) as usize;
                heights[k] = Some(Arc::new(crate::world::compute_heights(&b, table)));
                chunks[k] = Some(Arc::new(b));
            }
        }
        Neighbourhood {
            center: (0, 0),
            chunks,
            heights,
        }
    }

    fn mesh(t: &BlockTable, section: usize, f: impl Fn(i32, i32, i32) -> u8) -> SectionMesh {
        mesh_section(&hood(t, f), section, t, &mut Scratch::default())
    }

    const STONE: u8 = 3;

    #[test]
    fn a_lone_block_has_six_faces() {
        let t = table();
        let m = mesh(
            &t,
            0,
            |x, y, z| if (x, y, z) == (5, 5, 5) { STONE } else { 0 },
        );
        assert_eq!(m.opaque.len(), 6 * 4);
        assert!(m.alpha.is_empty());
    }

    #[test]
    fn touching_blocks_hide_the_faces_between_them() {
        let t = table();
        let m = mesh(&t, 0, |x, y, z| {
            if (y, z) == (5, 5) && (x == 5 || x == 6) {
                STONE
            } else {
                0
            }
        });
        assert_eq!(m.quads(), 10);
    }

    #[test]
    fn faces_across_chunk_borders_are_culled_too() {
        let t = table();
        // A wall of stone right across the chunk's west border.
        let m = mesh(&t, 0, |x, y, _| {
            if (x == -1 || x == 0) && y == 5 {
                STONE
            } else {
                0
            }
        });
        // Within the chunk: 16 blocks at x=0, each with top and bottom, the
        // east face (x=1 side), and nothing on the west (stone at x=-1).
        // The north/south faces of the row are only at the chunk's own ends,
        // which meet the neighbour chunks' stone.
        assert_eq!(m.quads(), 16 * 3);
    }

    #[test]
    fn a_flat_world_meshes_to_just_its_surface() {
        let t = table();
        let flat =
            |cx: i32, cz: i32| worldgen::generate_chunk(1, worldgen::Dimension::Overworld, cx, cz);
        let reference = flat(0, 0);
        let f = |x: i32, y: i32, z: i32| {
            reference[voxel_index(
                x.rem_euclid(16) as usize,
                y as usize,
                z.rem_euclid(16) as usize,
            )]
        };
        let n = hood(&t, f);
        let mut scratch = Scratch::default();
        let per_section: Vec<usize> = (0..8)
            .map(|s| mesh_section(&n, s, &t, &mut scratch).quads())
            .collect();
        // The flat test world is solid to y=40 with grass on top: exactly one
        // top face per column, in the section holding y=40, and nothing else
        // -- the bedrock underside faces the bottom of the world.
        let top = 40 / SECTION_Y;
        for (s, &q) in per_section.iter().enumerate() {
            assert_eq!(q, if s == top { 256 } else { 0 }, "section {s}");
        }
    }

    #[test]
    fn glass_hides_glass_but_not_the_stone_behind_it() {
        let t = table();
        let glass = t.id_by_name("Glass").unwrap();
        let m = mesh(&t, 0, |x, y, z| match (x, y, z) {
            (5, 5, 5) | (6, 5, 5) => glass,
            (7, 5, 5) => STONE,
            _ => 0,
        });
        // Two glass cubes: 10 faces, less the one pressed against the stone.
        assert_eq!(m.alpha.len() / 4, 9);
        // The stone shows all six faces: glass is not opaque.
        assert_eq!(m.opaque.len() / 4, 6);
    }

    #[test]
    fn a_slab_top_shows_under_a_solid_block() {
        let t = table();
        let belt = t.id_by_name("Conveyor Belt").unwrap();
        let m = mesh(&t, 0, |x, y, z| match (x, y, z) {
            (5, 5, 5) => belt,
            (5, 6, 5) => STONE,
            _ => 0,
        });
        // Belt: 6 faces including its mid-cell top. Stone: all 6 -- the belt
        // is flagged opaque, but it does not fill its cell, so the stone's
        // underside shows through the gap above it.
        assert_eq!(m.opaque.len() / 4, 6 + 6);
        // The belt's side faces are only 3/16 tall and show that much of
        // the tile, not the whole tile squashed.
        let side: Vec<&Vertex> = m.opaque[8..12].iter().collect();
        let ys: Vec<f32> = side.iter().map(|v| v.position()[1]).collect();
        let span = ys.iter().cloned().fold(f32::MIN, f32::max)
            - ys.iter().cloned().fold(f32::MAX, f32::min);
        assert!((span - 3.0 / 16.0).abs() < 0.01, "{ys:?}");
        let vs: Vec<f32> = side.iter().map(|v| v.uv[1] as f32 / 65535.0).collect();
        let v_span = vs.iter().cloned().fold(f32::MIN, f32::max)
            - vs.iter().cloned().fold(f32::MAX, f32::min);
        let tile = 1.0 / t.atlas.grid as f32;
        assert!(
            (v_span - tile * 3.0 / 16.0).abs() < tile * 0.05,
            "{v_span} vs tile {tile}"
        );
    }

    #[test]
    fn plants_are_two_double_sided_planes() {
        let t = table();
        let grass = t.id_by_name("Tall Grass").unwrap();
        let m = mesh(
            &t,
            0,
            |x, y, z| if (x, y, z) == (3, 3, 3) { grass } else { 0 },
        );
        assert_eq!(m.quads(), 4);
    }

    #[test]
    fn corners_against_walls_are_darker() {
        let t = table();
        // A floor with one block standing on it: the floor's top face next
        // to the block gets ambient occlusion, the far corners do not.
        let m = mesh(&t, 0, |x, y, z| {
            if y == 4 || (x, y, z) == (8, 5, 8) {
                STONE
            } else {
                0
            }
        });
        let ao: Vec<u8> = m.opaque.iter().map(|v| v.shade[1]).collect();
        assert!(ao.iter().any(|&a| a < 255));
        assert!(ao.iter().any(|&a| a == 255));
    }

    #[test]
    fn open_sky_is_bright_and_covered_ground_is_darker() {
        let t = table();
        // A floor, with a roof over part of it.
        let m = mesh(&t, 0, |x, y, _z| {
            if y == 2 || (y == 6 && (-20..=3).contains(&x)) {
                STONE
            } else {
                0
            }
        });
        // Floor top faces sit at y = 3. Light at x = 12 is open sky; at
        // x = -5 (deep under the roof, off in the neighbour chunk) it is
        // dark; at x = 0 it is in between, lit from the roof's edge.
        let floor_light = |x: f32| -> f32 {
            let v: Vec<u8> = m
                .opaque
                .iter()
                .filter(|v| {
                    let p = v.position();
                    (p[1] - 3.0).abs() < 1e-3 && (p[0] - x).abs() < 1e-3
                })
                .map(|v| v.shade[0])
                .collect();
            v.iter().map(|&s| s as f32).sum::<f32>() / v.len() as f32
        };
        let open = floor_light(12.0);
        let edge = floor_light(0.0);
        assert!(open > 250.0, "open sky {open}");
        assert!(edge < open * 0.8, "under the roof {edge}");
        assert!(
            edge > 255.0 * AMBIENT_FLOOR * 1.5,
            "near the edge still some light: {edge}"
        );
    }

    #[test]
    fn sky_light_is_blocked_by_walls() {
        let t = table();
        // A sealed stone box, hollow inside, in an open world.
        let m = mesh(&t, 0, |x, y, z| {
            let inside = (4..=10).contains(&x) && (2..=8).contains(&y) && (4..=10).contains(&z);
            let hollow = (5..=9).contains(&x) && (3..=7).contains(&y) && (5..=9).contains(&z);
            if inside && !hollow {
                STONE
            } else {
                0
            }
        });
        // The inner floor (top faces at y = 3, inside the box) is pitch dark.
        let inner: Vec<u8> = m
            .opaque
            .iter()
            .filter(|v| {
                let p = v.position();
                (p[1] - 3.0).abs() < 1e-3
                    && (5.0..=10.0).contains(&p[0])
                    && (5.0..=10.0).contains(&p[2])
            })
            .map(|v| v.shade[0])
            .collect();
        assert!(!inner.is_empty());
        let floor = (AMBIENT_FLOOR * 255.0).round() as u8;
        assert!(inner.iter().all(|&s| s <= floor + 1), "{inner:?}");
    }

    #[test]
    fn empty_sections_produce_nothing() {
        let t = table();
        assert!(mesh(&t, 3, |_, _, _| 0).is_empty());
    }
}
