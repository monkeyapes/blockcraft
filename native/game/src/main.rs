//! Blockcraft's native client. See native/README.md.
//!
//!     blockcraft-native [--seed N] [--distance N] [--size WxH] [--no-vsync]
//!                       [--threads N] [--assets DIR] [--run-for SECONDS]
//!                       [--screenshot PATH [--camera X,Y,Z,YAW,PITCH]]
//!                       [--log PATH]
//!
//! `--screenshot` renders one frame offscreen once the world around the spawn
//! has loaded, writes it as a PNG and exits, logging load and frame timings on
//! the way; it needs a GPU but no window, which makes it the way to check the
//! renderer from a script.

// A game has no console window. Debug builds keep one for the log.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod app;
mod content;
mod game;
mod hud;
mod jobs;
mod mesher;
mod player;
mod render;
mod streaming;
mod world;

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use content::BlockTable;
use game::Game;
use hud::HudInput;
use render::{open_device, Renderer};

/// Where log lines go besides stderr, if `--log` was given.
static LOG_FILE: OnceLock<Mutex<std::fs::File>> = OnceLock::new();
static START: OnceLock<Instant> = OnceLock::new();

/// Writes a timestamped line to stderr and to the `--log` file.
pub fn log_line(msg: std::fmt::Arguments) {
    let t = START.get_or_init(Instant::now).elapsed().as_secs_f32();
    let line = format!("[{t:8.3}] {msg}\n");
    eprint!("{line}");
    if let Some(f) = LOG_FILE.get() {
        if let Ok(mut f) = f.lock() {
            let _ = f.write_all(line.as_bytes());
        }
    }
}

#[macro_export]
macro_rules! log {
    ($($arg:tt)*) => { $crate::log_line(format_args!($($arg)*)) };
}

pub struct Options {
    pub seed: i32,
    pub distance: i32,
    pub threads: usize,
    pub width: u32,
    pub height: u32,
    pub vsync: bool,
    pub assets: Option<PathBuf>,
    pub screenshot: Option<PathBuf>,
    pub camera: Option<[f32; 5]>,
    pub run_for: Option<f32>,
    pub log: Option<PathBuf>,
}

/// The seed a world gets when none is given, so two runs match.
const DEFAULT_SEED: i32 = 20240;

impl Default for Options {
    fn default() -> Self {
        // Leave one core to the main thread, which renders; the rest build
        // terrain. More than eight gains nothing at these job sizes.
        let cores = std::thread::available_parallelism().map_or(4, |n| n.get());
        Options {
            seed: DEFAULT_SEED,
            distance: 12,
            threads: cores.saturating_sub(1).clamp(1, 8),
            width: 1280,
            height: 720,
            vsync: true,
            assets: None,
            screenshot: None,
            camera: None,
            run_for: None,
            log: None,
        }
    }
}

fn parse_args(args: impl Iterator<Item = String>) -> Result<Options, String> {
    let mut o = Options::default();
    let mut args = args.peekable();
    while let Some(arg) = args.next() {
        let mut value = |name: &str| args.next().ok_or(format!("{name} needs a value"));
        let num = |name: &str, v: String| -> Result<f64, String> {
            v.parse::<f64>()
                .map_err(|_| format!("{name}: '{v}' is not a number"))
        };
        match arg.as_str() {
            "--seed" => o.seed = num("--seed", value("--seed")?)? as i32,
            "--distance" => {
                o.distance = (num("--distance", value("--distance")?)? as i32).clamp(2, 32)
            }
            "--threads" => o.threads = (num("--threads", value("--threads")?)? as usize).max(1),
            "--size" => {
                let v = value("--size")?;
                let (w, h) = v.split_once('x').ok_or("--size is WIDTHxHEIGHT")?;
                o.width = num("--size", w.into())? as u32;
                o.height = num("--size", h.into())? as u32;
            }
            "--no-vsync" => o.vsync = false,
            "--assets" => o.assets = Some(value("--assets")?.into()),
            "--screenshot" => o.screenshot = Some(value("--screenshot")?.into()),
            "--camera" => {
                let v = value("--camera")?;
                let parts: Vec<f32> = v
                    .split(',')
                    .map(|p| num("--camera", p.into()).map(|n| n as f32))
                    .collect::<Result<_, _>>()?;
                o.camera = Some(
                    parts
                        .try_into()
                        .map_err(|_| "--camera is X,Y,Z,YAW,PITCH")?,
                );
            }
            "--run-for" => o.run_for = Some(num("--run-for", value("--run-for")?)? as f32),
            "--log" => o.log = Some(value("--log")?.into()),
            "--help" | "-h" => {
                return Err(
                    "usage: blockcraft-native [--seed N] [--distance N] [--size WxH] \
                    [--no-vsync] [--threads N] [--assets DIR] [--run-for SECONDS] \
                    [--screenshot PATH [--camera X,Y,Z,YAW,PITCH]] [--log PATH]"
                        .into(),
                )
            }
            other => return Err(format!("unknown argument '{other}' (try --help)")),
        }
    }
    Ok(o)
}

fn load_assets(o: &Options) -> Result<(Arc<BlockTable>, Vec<u8>), String> {
    let table = BlockTable::load(o.assets.as_deref())?;
    let atlas = match &o.assets {
        Some(dir) => {
            let path = dir.join(&table.atlas.file);
            std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?
        }
        None => content::EMBEDDED_ATLAS.to_vec(),
    };
    Ok((Arc::new(table), atlas))
}

/// Loads the world around the spawn with no window, times it, renders a
/// frame offscreen and saves it.
fn screenshot(
    o: &Options,
    table: Arc<BlockTable>,
    atlas: &[u8],
    path: &PathBuf,
) -> Result<(), String> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let (adapter, device, queue) = open_device(&instance, None)?;
    let info = adapter.get_info();
    log!("gpu: {} ({:?})", info.name, info.backend);
    let mut renderer = Renderer::new(
        device,
        queue,
        wgpu::TextureFormat::Rgba8Unorm,
        &table,
        atlas,
    )?;
    let mut game = Game::new(table.clone(), o.seed, o.distance, o.threads);
    log!(
        "seed {}, render distance {}, {} worker threads",
        o.seed,
        o.distance,
        o.threads
    );

    // Load: tick at a nominal 60 Hz until nothing is queued and the player
    // has landed, uploading meshes as they arrive, exactly as a window would.
    let start = Instant::now();
    let mut ticks = 0;
    loop {
        let events = game.tick(1.0 / 60.0);
        renderer.apply(events);
        ticks += 1;
        if game.streamer.settled() && (game.player.on_ground || game.player.flying) && ticks > 10 {
            break;
        }
        if start.elapsed() > Duration::from_secs(180) {
            return Err("the world did not finish loading in 180 s".into());
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    let load = start.elapsed().as_secs_f64();
    let s = game.streamer.stats;
    let per = |d: Duration, n: u64| d.as_secs_f64() * 1000.0 / n.max(1) as f64;
    log!(
        "world loaded in {load:.2}s: {} chunks ({:.2} ms each on a worker, {:.0} chunks/s overall), \
         {} sections meshed ({:.2} ms each), {} quads",
        s.generated,
        per(s.generate_time, s.generated),
        s.generated as f64 / load,
        s.meshed,
        per(s.mesh_time, s.meshed),
        s.quads
    );

    if let Some([x, y, z, yaw, pitch]) = o.camera {
        game.player.pos = glam::Vec3::new(x, y, z);
        game.player.yaw = yaw;
        game.player.pitch = pitch;
        game.player.flying = true;
    } else {
        // Looking a little down, so the ground and the horizon both show.
        game.player.pitch = -18.0;
    }
    game.tick(0.0);

    let (w, h) = (o.width, o.height);
    let target = renderer.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bench"),
        size: wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: renderer.format(),
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());

    // Frame timing: each frame is encoded, submitted and waited for, so the
    // figure is the whole CPU + GPU cost of a frame with nothing overlapped.
    let frames = 120;
    let mut times = Vec::with_capacity(frames);
    let mut stats = app::FrameStats::new();
    for i in 0..frames {
        let t = Instant::now();
        // Turn a little each frame so culling and sorting do real work.
        game.player.yaw += 3.0;
        draw_frame(&game, &mut renderer, &view, (w, h), &table, None);
        renderer.wait_idle();
        let dt = t.elapsed();
        stats.push(Instant::now(), dt);
        if i >= 10 {
            times.push(dt.as_secs_f64() * 1000.0);
        }
    }
    game.player.yaw -= 3.0 * frames as f32;
    times.sort_by(f64::total_cmp);
    let mean = times.iter().sum::<f64>() / times.len() as f64;
    log!(
        "offscreen {w}x{h}: {mean:.2} ms mean, {:.2} ms median, {:.2} ms p95 per frame \
         ({} of {} sections drawn, {:.2}M quads, {:.0} MB of vertices)",
        times[times.len() / 2],
        times[times.len() * 95 / 100],
        renderer.stats.drawn,
        renderer.stats.sections,
        renderer.stats.quads_drawn as f64 / 1e6,
        renderer.stats.vertex_bytes as f64 / 1048576.0
    );

    let lines = app::debug_lines(&game, &renderer, &stats);
    let rgba = {
        let view_proj = game.view(w as f32 / h as f32);
        let outline = game.outline();
        let hud = hud::build(&HudInput {
            width: w as f32,
            height: h as f32,
            table: &table,
            hotbar: &game.hotbar,
            selected: game.selected,
            debug: Some(&lines),
            captured: true,
        });
        renderer.render_to_rgba(
            w,
            h,
            &render::Frame {
                view_proj: view_proj.view_proj,
                eye: view_proj.eye,
                sky: game::SKY,
                fog: view_proj.fog,
                ambient: game::AMBIENT,
                outline: &outline,
                hud: &hud,
            },
        )
    };
    image::save_buffer(path, &rgba, w, h, image::ColorType::Rgba8)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    log!("wrote {}", path.display());
    Ok(())
}

fn draw_frame(
    game: &Game,
    renderer: &mut Renderer,
    view: &wgpu::TextureView,
    size: (u32, u32),
    table: &BlockTable,
    debug: Option<&[String]>,
) {
    app::draw(
        game,
        renderer,
        view,
        size,
        HudInput {
            width: size.0 as f32,
            height: size.1 as f32,
            table,
            hotbar: &game.hotbar,
            selected: game.selected,
            debug,
            captured: true,
        },
    );
}

fn run() -> Result<(), String> {
    START.get_or_init(Instant::now);
    let o = parse_args(std::env::args().skip(1))?;
    if let Some(path) = &o.log {
        let f = std::fs::File::create(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let _ = LOG_FILE.set(Mutex::new(f));
    }
    let (table, atlas) = load_assets(&o)?;
    log!(
        "content: {} tiles, {} items; seed {}",
        table.atlas.tiles.len(),
        table.items.len(),
        o.seed
    );
    match &o.screenshot {
        Some(path) => screenshot(&o, table, &atlas, path),
        None => app::run(o, table, atlas),
    }
}

fn main() {
    if let Err(e) = run() {
        log!("error: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(s: &str) -> Result<Options, String> {
        parse_args(s.split_whitespace().map(String::from))
    }

    #[test]
    fn arguments_parse() {
        let o = parse("--seed 42 --distance 8 --size 800x600 --no-vsync").unwrap();
        assert_eq!(
            (o.seed, o.distance, o.width, o.height, o.vsync),
            (42, 8, 800, 600, false)
        );
        let o = parse("--camera 1,2,3,90,-10").unwrap();
        assert_eq!(o.camera, Some([1.0, 2.0, 3.0, 90.0, -10.0]));
        assert_eq!(parse("").unwrap().seed, DEFAULT_SEED);
        assert!(parse("--seed").is_err());
        assert!(parse("--bogus").is_err());
        assert!(parse("--camera 1,2").is_err());
    }
}
