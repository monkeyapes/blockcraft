//! The window: winit events in, frames out.
//!
//! Everything game-shaped lives in [`Game`]; this file only turns key presses
//! and mouse motion into calls on it, owns the surface, and keeps the frame
//! statistics the F3 overlay and the log report.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

use winit::application::ApplicationHandler;
use winit::dpi::PhysicalSize;
use winit::event::{
    DeviceEvent, DeviceId, ElementState, MouseButton, MouseScrollDelta, WindowEvent,
};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{CursorGrabMode, Fullscreen, Window, WindowId};

use crate::content::BlockTable;
use crate::game::{Game, AMBIENT, MOUSE_SENSITIVITY, SKY};
use crate::hud::{self, HudInput};
use crate::log;
use crate::render::{open_device, Frame, Renderer};
use crate::Options;

/// Frame times over the last couple of seconds, for FPS and the worst frame.
pub struct FrameStats {
    times: VecDeque<(Instant, Duration)>,
    pub frames: u64,
    pub worst_ever: Duration,
}

impl FrameStats {
    pub fn new() -> Self {
        FrameStats {
            times: VecDeque::new(),
            frames: 0,
            worst_ever: Duration::ZERO,
        }
    }

    pub fn push(&mut self, now: Instant, dt: Duration) {
        self.times.push_back((now, dt));
        self.frames += 1;
        // The first frames include loading; they are not what play feels like.
        if self.frames > 30 {
            self.worst_ever = self.worst_ever.max(dt);
        }
        while let Some(&(t, _)) = self.times.front() {
            if now.duration_since(t) > Duration::from_secs(1) {
                self.times.pop_front();
            } else {
                break;
            }
        }
    }

    /// (frames per second, mean frame ms, worst frame ms) over the last second.
    pub fn summary(&self) -> (usize, f32, f32) {
        let n = self.times.len().max(1);
        let total: Duration = self.times.iter().map(|t| t.1).sum();
        let worst = self.times.iter().map(|t| t.1).max().unwrap_or_default();
        (
            self.times.len(),
            total.as_secs_f32() * 1000.0 / n as f32,
            worst.as_secs_f32() * 1000.0,
        )
    }
}

/// The lines of the F3 overlay (and of the periodic log line).
pub fn debug_lines(game: &Game, renderer: &Renderer, frames: &FrameStats) -> Vec<String> {
    let (fps, avg, worst) = frames.summary();
    let p = game.player.pos;
    let s = &game.streamer.stats;
    let per = |d: Duration, n: u64| d.as_secs_f64() * 1000.0 / n.max(1) as f64;
    let (gen_q, mesh_q) = game.streamer.in_flight();
    let r = &renderer.stats;
    let mut lines = vec![
        format!("BLOCKCRAFT NATIVE {}", env!("CARGO_PKG_VERSION")),
        format!("{fps} FPS  {avg:.2} MS AVG  {worst:.2} MS MAX"),
        format!("XYZ {:.2} {:.2} {:.2}", p.x, p.y, p.z),
        format!(
            "CHUNKS {}  QUEUED GEN {gen_q} MESH {mesh_q}  DIST {}",
            game.streamer.world.chunks.len(),
            game.streamer.radius
        ),
        format!(
            "SECTIONS {} OF {}  {:.2}M QUADS  {:.0} MB",
            r.drawn,
            r.sections,
            r.quads_drawn as f64 / 1e6,
            r.vertex_bytes as f64 / 1048576.0
        ),
        format!(
            "GENERATED {} ({:.2} MS)  MESHED {} ({:.2} MS)",
            s.generated,
            per(s.generate_time, s.generated),
            s.meshed,
            per(s.mesh_time, s.meshed)
        ),
    ];
    if game.player.flying {
        lines.push("FLYING".into());
    }
    if let Some(hit) = game.target {
        let [x, y, z] = hit.block;
        lines.push(format!(
            "LOOKING AT {} {x} {y} {z}",
            game.table.get(hit.id).name
        ));
    }
    lines
}

/// Builds the frame the renderer draws, for either a window or offscreen.
pub fn draw(
    game: &Game,
    renderer: &mut Renderer,
    target: &wgpu::TextureView,
    size: (u32, u32),
    hud_input: HudInput,
) {
    let view = game.view(size.0 as f32 / size.1.max(1) as f32);
    let outline = game.outline();
    let hud = hud::build(&hud_input);
    renderer.render(
        target,
        size.0,
        size.1,
        &Frame {
            view_proj: view.view_proj,
            eye: view.eye,
            sky: SKY,
            fog: view.fog,
            ambient: AMBIENT,
            outline: &outline,
            hud: &hud,
        },
    );
}

struct Gfx {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    renderer: Renderer,
}

struct App {
    opts: Options,
    table: Arc<BlockTable>,
    atlas: Vec<u8>,
    game: Game,
    gfx: Option<Gfx>,
    captured: bool,
    debug: bool,
    frames: FrameStats,
    last_frame: Instant,
    started: Instant,
    last_log: Instant,
    settled_at: Option<Duration>,
    /// Keys held, so the movement flags are the OR of both bindings.
    keys: std::collections::HashSet<KeyCode>,
    error: Option<String>,
}

pub fn run(opts: Options, table: Arc<BlockTable>, atlas: Vec<u8>) -> Result<(), String> {
    let event_loop = EventLoop::new().map_err(|e| format!("event loop: {e}"))?;
    event_loop.set_control_flow(ControlFlow::Poll);
    let game = Game::new(table.clone(), opts.seed, opts.distance, opts.threads);
    let mut app = App {
        opts,
        table,
        atlas,
        game,
        gfx: None,
        captured: false,
        debug: false,
        frames: FrameStats::new(),
        last_frame: Instant::now(),
        started: Instant::now(),
        last_log: Instant::now(),
        settled_at: None,
        keys: Default::default(),
        error: None,
    };
    event_loop
        .run_app(&mut app)
        .map_err(|e| format!("event loop: {e}"))?;
    let (_, avg, _) = app.frames.summary();
    log!(
        "exit after {:.1}s: {} frames, last second {:.2} ms avg, worst frame {:.2} ms",
        app.started.elapsed().as_secs_f32(),
        app.frames.frames,
        avg,
        app.frames.worst_ever.as_secs_f32() * 1000.0
    );
    match app.error {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

impl App {
    fn init(&mut self, event_loop: &ActiveEventLoop) -> Result<(), String> {
        let attrs = Window::default_attributes()
            .with_title("Blockcraft")
            .with_inner_size(PhysicalSize::new(self.opts.width, self.opts.height));
        let window = Arc::new(
            event_loop
                .create_window(attrs)
                .map_err(|e| format!("window: {e}"))?,
        );
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let surface = instance
            .create_surface(window.clone())
            .map_err(|e| format!("surface: {e}"))?;
        let (adapter, device, queue) = open_device(&instance, Some(&surface))?;
        let info = adapter.get_info();
        log!("gpu: {} ({:?})", info.name, info.backend);
        let caps = surface.get_capabilities(&adapter);
        // A plain (non-sRGB) format, like the web game's canvas: colours go
        // to the screen exactly as the textures and shading computed them.
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| !f.is_srgb())
            .or_else(|| caps.formats.first().copied())
            .ok_or("the surface supports no formats")?;
        let size = window.inner_size();
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space: wgpu::SurfaceColorSpace::Auto,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: if self.opts.vsync {
                wgpu::PresentMode::AutoVsync
            } else {
                wgpu::PresentMode::AutoNoVsync
            },
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);
        let renderer = Renderer::new(device, queue, format, &self.table, &self.atlas)?;
        self.gfx = Some(Gfx {
            window,
            surface,
            config,
            renderer,
        });
        Ok(())
    }

    fn set_captured(&mut self, on: bool) {
        let Some(gfx) = &self.gfx else {
            return;
        };
        if on {
            // Locked keeps the cursor still (macOS, Wayland); Windows only
            // offers Confined. Either way look comes from raw device motion.
            let grabbed = gfx
                .window
                .set_cursor_grab(CursorGrabMode::Locked)
                .or_else(|_| gfx.window.set_cursor_grab(CursorGrabMode::Confined));
            if let Err(e) = grabbed {
                log!("could not capture the mouse: {e}");
            }
            gfx.window.set_cursor_visible(false);
        } else {
            let _ = gfx.window.set_cursor_grab(CursorGrabMode::None);
            gfx.window.set_cursor_visible(true);
            // Nothing stays held once the game no longer has the input.
            self.keys.clear();
            self.sync_input();
            self.game.button(true, false);
            self.game.button(false, false);
        }
        self.captured = on;
    }

    fn sync_input(&mut self) {
        let k = |c: KeyCode| self.keys.contains(&c);
        let i = &mut self.game.input;
        i.forward = k(KeyCode::KeyW) || k(KeyCode::ArrowUp);
        i.back = k(KeyCode::KeyS) || k(KeyCode::ArrowDown);
        i.left = k(KeyCode::KeyA) || k(KeyCode::ArrowLeft);
        i.right = k(KeyCode::KeyD) || k(KeyCode::ArrowRight);
        i.jump = k(KeyCode::Space);
        i.sneak = k(KeyCode::ShiftLeft) || k(KeyCode::ShiftRight);
        i.sprint = k(KeyCode::ControlLeft) || k(KeyCode::ControlRight);
    }

    fn key(&mut self, code: KeyCode, pressed: bool, repeat: bool) {
        if pressed {
            self.keys.insert(code);
        } else {
            self.keys.remove(&code);
        }
        self.sync_input();
        if !pressed || repeat {
            return;
        }
        match code {
            KeyCode::Escape => self.set_captured(false),
            KeyCode::F11 => {
                if let Some(gfx) = &self.gfx {
                    let fs = match gfx.window.fullscreen() {
                        Some(_) => None,
                        None => Some(Fullscreen::Borderless(None)),
                    };
                    gfx.window.set_fullscreen(fs);
                }
            }
            KeyCode::F3 => self.debug = !self.debug,
            KeyCode::KeyF => self.game.toggle_flying(),
            KeyCode::Space => self.game.jump_pressed(),
            KeyCode::Digit1 => self.game.select(0),
            KeyCode::Digit2 => self.game.select(1),
            KeyCode::Digit3 => self.game.select(2),
            KeyCode::Digit4 => self.game.select(3),
            KeyCode::Digit5 => self.game.select(4),
            KeyCode::Digit6 => self.game.select(5),
            KeyCode::Digit7 => self.game.select(6),
            KeyCode::Digit8 => self.game.select(7),
            KeyCode::Digit9 => self.game.select(8),
            _ => {}
        }
    }

    fn frame(&mut self, event_loop: &ActiveEventLoop) {
        let now = Instant::now();
        let dt = now - self.last_frame;
        self.last_frame = now;
        self.frames.push(now, dt);

        let events = self.game.tick(dt.as_secs_f32());
        let Some(gfx) = &mut self.gfx else {
            return;
        };
        gfx.renderer.apply(events);
        if self.settled_at.is_none() && self.game.streamer.settled() {
            let t = self.started.elapsed();
            self.settled_at = Some(t);
            let s = &self.game.streamer.stats;
            log!(
                "world loaded in {:.2}s: {} chunks generated, {} sections meshed ({:.1} chunks/s)",
                t.as_secs_f32(),
                s.generated,
                s.meshed,
                s.generated as f32 / t.as_secs_f32()
            );
        }

        if gfx.config.width > 1 && gfx.config.height > 1 {
            let texture = match gfx.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(t)
                | wgpu::CurrentSurfaceTexture::Suboptimal(t) => Some(t),
                wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                    gfx.surface.configure(&gfx.renderer.device, &gfx.config);
                    None
                }
                other => {
                    if !matches!(
                        other,
                        wgpu::CurrentSurfaceTexture::Timeout
                            | wgpu::CurrentSurfaceTexture::Occluded
                    ) {
                        log!("surface: {other:?}");
                    }
                    None
                }
            };
            if let Some(texture) = texture {
                let view = texture
                    .texture
                    .create_view(&wgpu::TextureViewDescriptor::default());
                let lines = self
                    .debug
                    .then(|| debug_lines(&self.game, &gfx.renderer, &self.frames));
                let size = (gfx.config.width, gfx.config.height);
                draw(
                    &self.game,
                    &mut gfx.renderer,
                    &view,
                    size,
                    HudInput {
                        width: size.0 as f32,
                        height: size.1 as f32,
                        table: &self.table,
                        hotbar: &self.game.hotbar,
                        selected: self.game.selected,
                        debug: lines.as_deref(),
                        captured: self.captured,
                    },
                );
                gfx.window.pre_present_notify();
                gfx.renderer.queue.present(texture);
            }
        }

        if now.duration_since(self.last_log) >= Duration::from_secs(5) {
            self.last_log = now;
            let lines = debug_lines(&self.game, &gfx.renderer, &self.frames);
            log!("{}", lines[1..6].join(" | ").to_lowercase());
        }
        if let Some(limit) = self.opts.run_for {
            if self.started.elapsed().as_secs_f32() >= limit {
                event_loop.exit();
            }
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.gfx.is_some() {
            return;
        }
        if let Err(e) = self.init(event_loop) {
            log!("startup failed: {e}");
            self.error = Some(e);
            event_loop.exit();
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(gfx) = &mut self.gfx {
                    if size.width > 0 && size.height > 0 {
                        gfx.config.width = size.width;
                        gfx.config.height = size.height;
                        gfx.surface.configure(&gfx.renderer.device, &gfx.config);
                    }
                }
            }
            WindowEvent::Focused(false) => self.set_captured(false),
            WindowEvent::KeyboardInput { event, .. } => {
                if let PhysicalKey::Code(code) = event.physical_key {
                    self.key(code, event.state == ElementState::Pressed, event.repeat);
                }
            }
            WindowEvent::MouseInput { state, button, .. } => {
                let pressed = state == ElementState::Pressed;
                if !self.captured {
                    // The click that captures the mouse is not also a dig.
                    if pressed && button == MouseButton::Left {
                        self.set_captured(true);
                    }
                    return;
                }
                match button {
                    MouseButton::Left => self.game.button(true, pressed),
                    MouseButton::Right => self.game.button(false, pressed),
                    _ => {}
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let notches = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y.signum() as i32,
                    MouseScrollDelta::PixelDelta(p) => p.y.signum() as i32,
                };
                if self.captured && notches != 0 {
                    self.game.scroll(notches);
                }
            }
            WindowEvent::RedrawRequested => self.frame(event_loop),
            _ => {}
        }
    }

    fn device_event(&mut self, _: &ActiveEventLoop, _: DeviceId, event: DeviceEvent) {
        if let DeviceEvent::MouseMotion { delta } = event {
            if self.captured {
                self.game
                    .player
                    .look(delta.0 as f32, delta.1 as f32, MOUSE_SENSITIVITY);
            }
        }
    }

    fn about_to_wait(&mut self, _: &ActiveEventLoop) {
        if let Some(gfx) = &self.gfx {
            gfx.window.request_redraw();
        }
    }
}
