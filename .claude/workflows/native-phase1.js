export const meta = {
  name: 'native-phase1',
  description: 'Build the native Blockcraft client core (renderer, player) and an exact Rust port of world generation, in parallel',
  phases: [{ title: 'Build', detail: 'native-core and worldgen, each in its own worktree' }],
}

const BASE = '5ec9e12'

const COMMON = `You are one of two engineers building Phase 1 of the NATIVE Blockcraft client, in parallel, each in your own git worktree. Blockcraft (repo root = your worktree; TypeScript monorepo: shared/, client/, server/) is an original Minecraft-inspired voxel game. Today its desktop exe is a Tauri webview around the web client; the user asked for a real native game instead. Plan: native/README.md (read it first). Rust 1.96 and cargo are installed (Windows, Git Bash shell; PowerShell also available).

FIRST: git merge-base --is-ancestor ${BASE} HEAD || git reset --hard ${BASE}  (the native/ workspace skeleton is in ${BASE}; branch 'native' on origin). If npx tsx cannot resolve modules, link the main checkout's node_modules into the worktree root (cmd //c mklink /J node_modules D:\\idks\\node_modules) — never commit it.

RULES
- Original work only (the project's rule: like Minecraft, never ripped from it).
- Edit only the files listed under "You own". Put anything else you need in "requests".
- Rust style: idiomatic, rustfmt-formatted, doc comments that explain WHY (the TS codebase's comments are prose that explain reasons — match that tone). No unsafe unless unavoidable and justified.
- Measure, don't guess: write tests (cargo test) that fail if the feature breaks.
- COMMIT EARLY AND OFTEN (WIP commits after each milestone, each must build), and after EVERY commit push it: git push -f origin HEAD:refs/heads/wip/<your area key>. Author env: GIT_AUTHOR_NAME=monkeyapes GIT_AUTHOR_EMAIL=muratmeteyildiz580@gmail.com GIT_COMMITTER_NAME=monkeyapes GIT_COMMITTER_EMAIL=muratmeteyildiz580@gmail.com, and add the trailer "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". The account's usage limit may cut you off at any time; pushed work survives.
- Do not commit build output (native/target is git-ignored) or large binaries other than the exported assets named below.
- Finish with the structured result: branch, commit, summary, files, tests, requests, risks.`

const BRIEFS = [
{
  key: 'native-worldgen',
  brief: `YOUR AREA KEY: native-worldgen
YOU OWN: native/worldgen/** (the Rust library), tools/export-worldgen-vectors.ts (new), native/worldgen/tests/** and any test-vector files under native/worldgen/tests/data/.

GOAL: port Blockcraft's world generation to Rust EXACTLY, so pub fn generate_chunk(seed: i32, dim: Dimension, cx: i32, cz: i32) -> Vec<u8> (keep this signature and the voxel_index layout already in native/worldgen/src/lib.rs) returns byte-for-byte the same chunk as TypeScript's generateChunk(seed, dim, cx, cz) in shared/src/terrain.ts, for every dimension (Overworld, Nether, End). Read shared/src/terrain.ts, shared/src/noise.ts, shared/src/structures.ts, shared/src/constants.ts, shared/src/blockids.ts and whatever else generation calls (biomes, ores, trees, plants, strongholds, villages/mansions, End island...). Port all of it.
Exactness notes: JavaScript numbers are f64; bitwise ops (|0, >>>, Math.imul) work on i32/u32 — use wrapping_mul / as i32 / as u32 casts to reproduce them exactly; Math.floor on negatives; % keeps the sign of the dividend in JS (like Rust's %), but check every use. Keep f64 everywhere JS uses numbers. Block ids come from shared/src/blockids.ts — generate a Rust constants module from it (a small script or by hand) and keep names identical.
Parity tests: write tools/export-worldgen-vectors.ts that runs the TS generator for a spread of (seed, dim, cx, cz) — at least 3 seeds incl. negative, all 3 dimensions, chunks near 0,0, far away (e.g. 1000 chunks out), negative coordinates, a stronghold chunk (isStrongholdChunk) and a chunk containing a structure placement — and writes compact test vectors (e.g. an FNV/CRC hash of each chunk plus a few full chunks as raw bytes, gzip if large; keep the committed data small, a few MB at most). Then cargo tests assert the Rust output matches every vector exactly; on a mismatch, report the first differing voxel (x, y, z, expected, got) so debugging is possible. Also port and test the helpers other code needs later: columnHeight, surfaceY, biomeAt / BIOME_NAMES, isStrongholdChunk/strongholdLocation.
Performance: generating one chunk should take well under 5 ms in release; add a quick benchmark test (ignored by default) and report the number.
Deliver: cargo test -p worldgen passes with every vector matching. Report parity status honestly in your result — if any dimension or feature is not yet exact, say which.`,
},
{
  key: 'native-core',
  brief: `YOUR AREA KEY: native-core
YOU OWN: native/game/** (the executable crate), native/assets/** (exported files), tools/export-native.ts (new), native/Cargo.toml (workspace; you may add shared dependency settings), native/README.md (keep it accurate).
DO NOT edit native/worldgen/** — the other engineer is porting world generation there right now. Use its public API (worldgen::generate_chunk(seed, Dimension, cx, cz) -> Vec<u8>, voxel_index, CHUNK_X/CHUNK_Z/WORLD_Y); today it returns a flat test world, and the real terrain will drop in without changes on your side.

GOAL: Phase 1 native core — a real native game window that feels like Blockcraft and runs well.
1) tools/export-native.ts (run with npx tsx): export the content the native game needs, from the TS registries, into native/assets/:
   - atlas.png: the full texture atlas, exactly as the web game builds it (use nodeAtlas() and writePNG from tests/diagnostics/offscreen.ts, or the same logic).
   - content.json: atlas grid size and tile px; for every block id: name, textures as atlas slots [top, bottom, side], solid, opaque, translucent, liquid, light, hardness, replaceable, cross (height/inset or null), static shape boxes (visual/collision/selection, each box with optional per-box texture slots; see shared/src/shapes.ts, shapekit.ts) and a flag for neighbour-dependent shapes; for items: name, icon slot. Keep the file readable (pretty JSON) — it is a contract other work builds on; document its format in native/README.md.
   Commit the exported assets (they are small) so the game builds without Node.
2) The game (native/game): winit 0.30 + wgpu (latest compatible) + glam + bytemuck + image + serde/serde_json (+ pollster or similar). Window titled "Blockcraft", F11 toggles true borderless fullscreen, Esc releases the mouse / click captures it (raw mouse motion via DeviceEvent), vsync on, resizable.
   - Load assets/atlas.png (nearest filtering, discard alpha < 0.5 in the shader like the web game) and assets/content.json (serde).
   - Chunks: generate with worldgen on BACKGROUND THREADS (a small job pool / channels), keep a render distance of ~12 chunks around the player (configurable), unload far ones.
   - Mesher on background threads: faces culled against opaque neighbours (like client/src/mesher.ts), per-box geometry for shaped blocks with texture coordinates following the box extent, crossed planes for cross blocks, ambient occlusion per vertex, a simple sky-light term (blocks under open sky bright, covered cells darker) — full light propagation is Phase 2. Opaque pass + alpha pass (water/glass).
   - Rendering: per-face shading like the web game (top 1.0, bottom 0.5, N/S 0.8, E/W 0.65), distance fog blending into a sky colour, frustum culling of chunk sections.
   - Player: port the core of client/src/player.ts — walking with gravity/jump, step-up, collision against the real collision boxes, flying (double-tap space or F), sprint, sneak; mouse look; the voxel raycast against selection boxes; left click breaks, right click places the selected hotbar block; 1-9 select from a starter hotbar (a few common blocks). Edits re-mesh the affected sections (and neighbours on borders).
   - HUD: crosshair and a simple hotbar with block icons from the atlas (flat side tile is fine for Phase 1), an FPS counter toggle on F3.
   - Seed from a command-line arg (--seed N), default fixed; spawn on the surface at 0,0 (use the heightmap of the generated chunk).
3) Performance matters (the user switched to native for it): report frame time and chunk throughput in your result. Release build must be smooth at 12-chunk render distance on a modest 4-core PC.
4) Tests: cargo tests for the pieces that can be tested without a GPU (content.json parsing, meshing face counts for a known chunk, collision/step-up, raycast hitting selection boxes, chunk load/unload bookkeeping).
5) Build a release exe (cargo build --release -p blockcraft-native), run it for a few seconds to confirm it starts and renders without errors (you cannot see the window; check the log, and add a --screenshot <path> option that renders one frame offscreen to a PNG after the world loads and exits — then LOOK at that PNG with your Read tool and iterate until it looks right).`,
},
]

const RESULT = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, commit: { type: 'string' },
    summary: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    tests: { type: 'string' },
    requests: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'commit', 'summary', 'files', 'tests', 'requests', 'risks'],
}

const RESUME = (args && args.resume) || {}
phase('Build')
const results = await parallel(BRIEFS.map((b) => () =>
  agent(COMMON + (RESUME[b.key] ? '\n\nRESUMING: a previous attempt was cut off. After the base check run: git fetch origin ' + RESUME[b.key] + ' && git reset --hard FETCH_HEAD, read what is there, and continue.' : '') + '\n\n' + b.brief, {
    label: 'native:' + b.key,
    phase: 'Build',
    schema: RESULT,
    isolation: 'worktree',
    effort: 'high',
  }).then((r) => ({ key: b.key, ...(r || { missing: true }) }))
))
return results.filter(Boolean)
