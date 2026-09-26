//! The GPU side: pipelines, the atlas, section buffers and the frame.
//!
//! Each meshed section owns one vertex buffer per pass. All of them share a
//! single quad index buffer (0 1 2, 0 2 3, then the next four vertices), so
//! sections carry no index data at all, and a section's world origin comes
//! from a small per-instance buffer indexed by the draw's instance number.
//! That keeps a draw to one vertex-buffer bind and one call, which matters
//! with a thousand-odd sections in view.
//!
//! The renderer is window-agnostic: it draws into whatever texture view it is
//! handed, which is how `--screenshot` renders the same frame offscreen.

use std::collections::HashMap;
use std::sync::Arc;

use glam::{Mat4, Vec3, Vec4};
use wgpu::util::DeviceExt;
use worldgen::{CHUNK_X, CHUNK_Z};

use crate::content::BlockTable;
use crate::hud::HudVertex;
use crate::mesher::{SectionMesh, Vertex};
use crate::streaming::Event;
use crate::world::{ChunkPos, SECTION_Y};

pub const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

/// Sections that can be resident at once. At a 12-chunk render distance
/// about 600 chunks are loaded, and rarely more than half their eight
/// sections hold anything; this leaves room for a render distance of 20.
const MAX_SECTIONS: u32 = 16384;

/// The uniform block every shader reads. Layout matches `Globals` in
/// shaders.wgsl.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Globals {
    view_proj: [[f32; 4]; 4],
    eye: [f32; 4],
    fog_color: [f32; 4],
    fog: [f32; 4],
    screen: [f32; 4],
}

/// Everything that describes one frame, apart from the world's geometry.
pub struct Frame<'a> {
    pub view_proj: Mat4,
    pub eye: Vec3,
    pub sky: [f32; 3],
    /// Distances at which fog starts and reaches full strength.
    pub fog: (f32, f32),
    pub ambient: f32,
    /// World-space boxes to outline (the targeted block's selection boxes).
    pub outline: &'a [(Vec3, Vec3)],
    pub hud: &'a [HudVertex],
}

/// Per-frame counts for the F3 overlay.
#[derive(Default, Clone, Copy, Debug)]
pub struct RenderStats {
    pub sections: usize,
    pub drawn: usize,
    pub quads_drawn: u64,
    pub vertex_bytes: u64,
}

struct Part {
    buffer: wgpu::Buffer,
    quads: u32,
}

struct GpuSection {
    slot: u32,
    opaque: Option<Part>,
    alpha: Option<Part>,
}

/// Frustum planes (xyz normal pointing in, w distance), from a view-projection
/// matrix with wgpu's 0..1 depth range.
#[derive(Clone, Copy, Debug)]
pub struct Frustum([Vec4; 6]);

impl Frustum {
    pub fn from_matrix(m: Mat4) -> Self {
        let (r0, r1, r2, r3) = (m.row(0), m.row(1), m.row(2), m.row(3));
        let planes = [r3 + r0, r3 - r0, r3 + r1, r3 - r1, r2, r3 - r2];
        Frustum(planes.map(|p| p / p.truncate().length()))
    }

    /// Whether any part of the box can be on screen. Conservative: a box near
    /// a frustum corner may pass without being visible, never the reverse.
    pub fn intersects(&self, lo: Vec3, hi: Vec3) -> bool {
        self.0.iter().all(|p| {
            // The box corner furthest along the plane's normal.
            let v = Vec3::new(
                if p.x >= 0.0 { hi.x } else { lo.x },
                if p.y >= 0.0 { hi.y } else { lo.y },
                if p.z >= 0.0 { hi.z } else { lo.z },
            );
            p.truncate().dot(v) + p.w >= 0.0
        })
    }
}

pub struct Renderer {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    format: wgpu::TextureFormat,
    globals: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    opaque: wgpu::RenderPipeline,
    alpha: wgpu::RenderPipeline,
    lines: wgpu::RenderPipeline,
    hud: wgpu::RenderPipeline,
    indices: wgpu::Buffer,
    index_quads: u32,
    origins: wgpu::Buffer,
    free_slots: Vec<u32>,
    next_slot: u32,
    sections: HashMap<(ChunkPos, usize), GpuSection>,
    depth: Option<(wgpu::TextureView, u32, u32)>,
    line_buffer: wgpu::Buffer,
    hud_buffer: wgpu::Buffer,
    hud_capacity: u64,
    pub stats: RenderStats,
}

fn quad_indices(quads: u32) -> Vec<u32> {
    (0..quads)
        .flat_map(|q| {
            let b = q * 4;
            [b, b + 1, b + 2, b, b + 2, b + 3]
        })
        .collect()
}

impl Renderer {
    pub fn new(
        device: wgpu::Device,
        queue: wgpu::Queue,
        format: wgpu::TextureFormat,
        table: &BlockTable,
        atlas_png: &[u8],
    ) -> Result<Self, String> {
        let atlas = image::load_from_memory_with_format(atlas_png, image::ImageFormat::Png)
            .map_err(|e| format!("atlas.png: {e}"))?
            .to_rgba8();
        if atlas.width() != table.atlas.size || atlas.height() != table.atlas.size {
            return Err(format!(
                "atlas.png is {}x{}, content.json says {}",
                atlas.width(),
                atlas.height(),
                table.atlas.size
            ));
        }
        let size = wgpu::Extent3d {
            width: atlas.width(),
            height: atlas.height(),
            depth_or_array_layers: 1,
        };
        // Unorm, not sRGB, on both ends: the web game samples and writes the
        // raw values with no conversion, and matching it means doing the same.
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("atlas"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &atlas,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4 * atlas.width()),
                rows_per_image: Some(atlas.height()),
            },
            size,
        );
        let atlas_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        // Nearest, no mipmaps: pixel art stays crisp, as in the web game.
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("atlas"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });

        let globals = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("globals"),
            size: std::mem::size_of::<Globals>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("globals"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("globals"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: globals.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&atlas_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("main"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("shaders.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders.wgsl").into()),
        });

        let terrain_buffers = [
            Some(wgpu::VertexBufferLayout {
                array_stride: std::mem::size_of::<Vertex>() as u64,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &wgpu::vertex_attr_array![
                    0 => Uint16x4, 1 => Unorm16x2, 2 => Unorm8x4
                ],
            }),
            Some(wgpu::VertexBufferLayout {
                array_stride: 16,
                step_mode: wgpu::VertexStepMode::Instance,
                attributes: &wgpu::vertex_attr_array![3 => Float32x4],
            }),
        ];
        let depth = |write: bool, compare: wgpu::CompareFunction| {
            Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(write),
                depth_compare: Some(compare),
                stencil: Default::default(),
                bias: Default::default(),
            })
        };
        let blend_target = [Some(wgpu::ColorTargetState {
            format,
            blend: Some(wgpu::BlendState::ALPHA_BLENDING),
            write_mask: wgpu::ColorWrites::ALL,
        })];
        let opaque_target = [Some(wgpu::ColorTargetState {
            format,
            blend: None,
            write_mask: wgpu::ColorWrites::ALL,
        })];
        let pipeline = |label: &str,
                        vs: &str,
                        fs: &str,
                        buffers: &[Option<wgpu::VertexBufferLayout>],
                        primitive: wgpu::PrimitiveState,
                        depth_stencil: Option<wgpu::DepthStencilState>,
                        targets: &[Option<wgpu::ColorTargetState>]| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some(vs),
                    compilation_options: Default::default(),
                    buffers,
                },
                primitive,
                depth_stencil,
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(fs),
                    compilation_options: Default::default(),
                    targets,
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let opaque = pipeline(
            "terrain opaque",
            "vs_terrain",
            "fs_opaque",
            &terrain_buffers,
            wgpu::PrimitiveState {
                cull_mode: Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth(true, wgpu::CompareFunction::Less),
            &opaque_target,
        );
        // Double-sided, so a water surface is still there seen from below,
        // and no depth writes, so water behind glass still shows.
        let alpha = pipeline(
            "terrain alpha",
            "vs_terrain",
            "fs_alpha",
            &terrain_buffers,
            wgpu::PrimitiveState::default(),
            depth(false, wgpu::CompareFunction::Less),
            &blend_target,
        );
        let lines = pipeline(
            "outline",
            "vs_line",
            "fs_line",
            &[Some(wgpu::VertexBufferLayout {
                array_stride: 12,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &wgpu::vertex_attr_array![0 => Float32x3],
            })],
            wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::LineList,
                ..Default::default()
            },
            depth(false, wgpu::CompareFunction::LessEqual),
            &blend_target,
        );
        let hud = pipeline(
            "hud",
            "vs_hud",
            "fs_hud",
            &[Some(wgpu::VertexBufferLayout {
                array_stride: std::mem::size_of::<HudVertex>() as u64,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &wgpu::vertex_attr_array![
                    0 => Float32x2, 1 => Float32x2, 2 => Float32x4
                ],
            })],
            wgpu::PrimitiveState::default(),
            depth(false, wgpu::CompareFunction::Always),
            &blend_target,
        );

        let index_quads = 16384;
        let indices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("quad indices"),
            contents: bytemuck::cast_slice(&quad_indices(index_quads)),
            usage: wgpu::BufferUsages::INDEX,
        });
        let origins = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("section origins"),
            size: MAX_SECTIONS as u64 * 16,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let line_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("outline"),
            // Up to eight boxes of twelve edges, two ends each.
            size: 8 * 24 * 12,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let hud_capacity = 4096 * std::mem::size_of::<HudVertex>() as u64;
        let hud_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("hud"),
            size: hud_capacity,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Ok(Renderer {
            device,
            queue,
            format,
            globals,
            bind_group,
            opaque,
            alpha,
            lines,
            hud,
            indices,
            index_quads,
            origins,
            free_slots: Vec::new(),
            next_slot: 0,
            sections: HashMap::new(),
            depth: None,
            line_buffer,
            hud_buffer,
            hud_capacity,
            stats: RenderStats::default(),
        })
    }

    pub fn format(&self) -> wgpu::TextureFormat {
        self.format
    }

    /// Applies what the streamer decided: uploads new meshes, frees old ones.
    pub fn apply(&mut self, events: Vec<Event>) {
        for event in events {
            match event {
                Event::Mesh { pos, section, mesh } => self.upload(pos, section, mesh),
                Event::Unload(pos) => {
                    for s in 0..crate::world::SECTIONS {
                        self.remove(pos, s);
                    }
                }
            }
        }
    }

    fn remove(&mut self, pos: ChunkPos, section: usize) {
        if let Some(old) = self.sections.remove(&(pos, section)) {
            self.free_slots.push(old.slot);
            for part in [&old.opaque, &old.alpha].into_iter().flatten() {
                self.stats.vertex_bytes -= part.buffer.size();
            }
        }
    }

    fn upload(&mut self, pos: ChunkPos, section: usize, mesh: SectionMesh) {
        self.remove(pos, section);
        if mesh.is_empty() {
            return;
        }
        let slot = match self.free_slots.pop() {
            Some(s) => s,
            None if self.next_slot < MAX_SECTIONS => {
                self.next_slot += 1;
                self.next_slot - 1
            }
            None => {
                eprintln!("renderer: out of section slots; raise MAX_SECTIONS");
                return;
            }
        };
        let origin = [
            (pos.0 * CHUNK_X as i32) as f32,
            (section * SECTION_Y) as f32,
            (pos.1 * CHUNK_Z as i32) as f32,
            0.0,
        ];
        self.queue.write_buffer(
            &self.origins,
            slot as u64 * 16,
            bytemuck::cast_slice(&origin),
        );
        let most = (mesh.opaque.len().max(mesh.alpha.len()) / 4) as u32;
        if most > self.index_quads {
            self.index_quads = most.next_power_of_two();
            self.indices = self
                .device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("quad indices"),
                    contents: bytemuck::cast_slice(&quad_indices(self.index_quads)),
                    usage: wgpu::BufferUsages::INDEX,
                });
        }
        let mut part = |verts: &[Vertex], label: &str| -> Option<Part> {
            if verts.is_empty() {
                return None;
            }
            let buffer = self
                .device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some(label),
                    contents: bytemuck::cast_slice(verts),
                    usage: wgpu::BufferUsages::VERTEX,
                });
            self.stats.vertex_bytes += buffer.size();
            Some(Part {
                buffer,
                quads: (verts.len() / 4) as u32,
            })
        };
        let opaque = part(&mesh.opaque, "section opaque");
        let alpha = part(&mesh.alpha, "section alpha");
        self.sections.insert(
            (pos, section),
            GpuSection {
                slot,
                opaque,
                alpha,
            },
        );
    }

    fn depth_view(&mut self, width: u32, height: u32) -> wgpu::TextureView {
        if let Some((view, w, h)) = &self.depth {
            if *w == width && *h == height {
                return view.clone();
            }
        }
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("depth"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.depth = Some((view.clone(), width, height));
        view
    }

    /// Draws a frame into `target` and submits it.
    pub fn render(&mut self, target: &wgpu::TextureView, width: u32, height: u32, frame: &Frame) {
        let globals = Globals {
            view_proj: frame.view_proj.to_cols_array_2d(),
            eye: frame.eye.extend(1.0).to_array(),
            fog_color: [frame.sky[0], frame.sky[1], frame.sky[2], 1.0],
            fog: [frame.fog.0, frame.fog.1, frame.ambient, 0.0],
            screen: [width as f32, height as f32, 0.0, 0.0],
        };
        self.queue
            .write_buffer(&self.globals, 0, bytemuck::bytes_of(&globals));

        let outline: Vec<[f32; 3]> = frame
            .outline
            .iter()
            .take(8)
            .flat_map(|&(lo, hi)| box_edges(lo, hi))
            .collect();
        if !outline.is_empty() {
            self.queue
                .write_buffer(&self.line_buffer, 0, bytemuck::cast_slice(&outline));
        }
        let hud_bytes = std::mem::size_of_val(frame.hud) as u64;
        if hud_bytes > self.hud_capacity {
            self.hud_capacity = hud_bytes.next_power_of_two();
            self.hud_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("hud"),
                size: self.hud_capacity,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
        }
        if !frame.hud.is_empty() {
            self.queue
                .write_buffer(&self.hud_buffer, 0, bytemuck::cast_slice(frame.hud));
        }

        let depth = self.depth_view(width, height);
        // Cull, then sort: opaque front to back so early depth rejects most
        // hidden fragments, alpha back to front so blending layers correctly.
        let frustum = Frustum::from_matrix(frame.view_proj);
        let mut visible: Vec<(f32, &GpuSection)> = Vec::with_capacity(self.sections.len());
        for (&((cx, cz), s), sec) in &self.sections {
            let lo = Vec3::new(
                (cx * CHUNK_X as i32) as f32,
                (s * SECTION_Y) as f32,
                (cz * CHUNK_Z as i32) as f32,
            );
            let hi = lo + Vec3::new(CHUNK_X as f32, SECTION_Y as f32, CHUNK_Z as f32);
            if frustum.intersects(lo, hi) {
                let centre = (lo + hi) * 0.5;
                visible.push((centre.distance_squared(frame.eye), sec));
            }
        }
        visible.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("frame"),
            });
        let mut stats = RenderStats {
            sections: self.sections.len(),
            vertex_bytes: self.stats.vertex_bytes,
            ..Default::default()
        };
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("world"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: frame.sky[0] as f64,
                            g: frame.sky[1] as f64,
                            b: frame.sky[2] as f64,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint32);
            pass.set_vertex_buffer(1, self.origins.slice(..));

            pass.set_pipeline(&self.opaque);
            for (_, sec) in &visible {
                if let Some(part) = &sec.opaque {
                    pass.set_vertex_buffer(0, part.buffer.slice(..));
                    pass.draw_indexed(0..part.quads * 6, 0, sec.slot..sec.slot + 1);
                    stats.drawn += 1;
                    stats.quads_drawn += part.quads as u64;
                }
            }
            pass.set_pipeline(&self.alpha);
            for (_, sec) in visible.iter().rev() {
                if let Some(part) = &sec.alpha {
                    pass.set_vertex_buffer(0, part.buffer.slice(..));
                    pass.draw_indexed(0..part.quads * 6, 0, sec.slot..sec.slot + 1);
                    stats.quads_drawn += part.quads as u64;
                }
            }

            if !outline.is_empty() {
                pass.set_pipeline(&self.lines);
                pass.set_vertex_buffer(0, self.line_buffer.slice(..));
                pass.draw(0..outline.len() as u32, 0..1);
            }
            if !frame.hud.is_empty() {
                pass.set_pipeline(&self.hud);
                pass.set_vertex_buffer(0, self.hud_buffer.slice(..));
                pass.draw(0..frame.hud.len() as u32, 0..1);
            }
        }
        self.queue.submit([encoder.finish()]);
        self.stats = stats;
    }

    /// Renders one frame offscreen and returns it as tightly packed RGBA.
    pub fn render_to_rgba(&mut self, width: u32, height: u32, frame: &Frame) -> Vec<u8> {
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("offscreen"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.render(&view, width, height, frame);

        // Rows in a buffer copy must be 256-byte aligned.
        let row = 4 * width;
        let padded = row.div_ceil(256) * 256;
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: (padded * height) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("readback"),
            });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit([encoder.finish()]);
        let slice = buffer.slice(..);
        slice.map_async(wgpu::MapMode::Read, |r| {
            if let Err(e) = r {
                eprintln!("readback failed: {e}");
            }
        });
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
        let data = slice.get_mapped_range().expect("readback buffer is mapped");
        let mut out = Vec::with_capacity((row * height) as usize);
        for y in 0..height {
            let start = (y * padded) as usize;
            out.extend_from_slice(&data[start..start + row as usize]);
        }
        drop(data);
        buffer.unmap();
        // A BGRA target reads back blue-first; PNG wants red-first.
        if matches!(
            self.format,
            wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb
        ) {
            for px in out.chunks_exact_mut(4) {
                px.swap(0, 2);
            }
        }
        out
    }

    /// Blocks until the GPU has finished everything submitted, for timing.
    pub fn wait_idle(&self) {
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
    }
}

/// The twelve edges of a box as a line list, pushed out a hair so they are
/// not buried in the faces they outline.
fn box_edges(lo: Vec3, hi: Vec3) -> [[f32; 3]; 24] {
    let e = 0.002;
    let (lo, hi) = (lo - Vec3::splat(e), hi + Vec3::splat(e));
    let c = |x: bool, y: bool, z: bool| {
        [
            if x { hi.x } else { lo.x },
            if y { hi.y } else { lo.y },
            if z { hi.z } else { lo.z },
        ]
    };
    let (f, t) = (false, true);
    [
        c(f, f, f),
        c(t, f, f),
        c(t, f, f),
        c(t, f, t),
        c(t, f, t),
        c(f, f, t),
        c(f, f, t),
        c(f, f, f),
        c(f, t, f),
        c(t, t, f),
        c(t, t, f),
        c(t, t, t),
        c(t, t, t),
        c(f, t, t),
        c(f, t, t),
        c(f, t, f),
        c(f, f, f),
        c(f, t, f),
        c(t, f, f),
        c(t, t, f),
        c(t, f, t),
        c(t, t, t),
        c(f, f, t),
        c(f, t, t),
    ]
}

/// Picks a GPU and opens a device on it, compatible with `surface` if given.
pub fn open_device(
    instance: &wgpu::Instance,
    surface: Option<&wgpu::Surface>,
) -> Result<(wgpu::Adapter, wgpu::Device, wgpu::Queue), String> {
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: surface,
        ..Default::default()
    }))
    .map_err(|e| format!("no usable GPU adapter: {e}"))?;
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("blockcraft"),
        required_features: wgpu::Features::empty(),
        required_limits: wgpu::Limits::downlevel_defaults().using_resolution(adapter.limits()),
        ..Default::default()
    }))
    .map_err(|e| format!("could not open the GPU: {e}"))?;
    device.on_uncaptured_error(Arc::new(|e| eprintln!("wgpu error: {e}")));
    Ok((adapter, device, queue))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn camera() -> Mat4 {
        let proj = glam::camera::rh::proj::directx::perspective(
            72f32.to_radians(),
            16.0 / 9.0,
            0.1,
            200.0,
        );
        let view = glam::camera::rh::view::look_to_mat4(Vec3::ZERO, Vec3::NEG_Z, Vec3::Y);
        proj * view
    }

    #[test]
    fn boxes_ahead_are_in_the_frustum_and_behind_are_not() {
        let f = Frustum::from_matrix(camera());
        let unit = Vec3::splat(16.0);
        assert!(f.intersects(
            Vec3::new(-8.0, -8.0, -40.0),
            Vec3::new(-8.0, -8.0, -40.0) + unit
        ));
        assert!(!f.intersects(
            Vec3::new(-8.0, -8.0, 20.0),
            Vec3::new(-8.0, -8.0, 20.0) + unit
        ));
        // Far to the side at a short distance: outside the 72-degree cone.
        assert!(!f.intersects(Vec3::new(100.0, 0.0, -20.0), Vec3::new(116.0, 16.0, -4.0)));
        // Past the far plane.
        assert!(!f.intersects(Vec3::new(-8.0, -8.0, -300.0), Vec3::new(8.0, 8.0, -284.0)));
    }

    #[test]
    fn the_box_around_the_camera_is_always_visible() {
        let f = Frustum::from_matrix(camera());
        assert!(f.intersects(Vec3::splat(-8.0), Vec3::splat(8.0)));
    }

    #[test]
    fn quad_indices_make_two_triangles_per_quad() {
        assert_eq!(quad_indices(2), vec![0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    }
}
