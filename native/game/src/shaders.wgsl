// Blockcraft's shaders: terrain (an opaque and a blended entry point), the
// block outline, and the flat HUD. One uniform block serves them all.
//
// The terrain shading is the web game's (client/src/gfx/renderer.ts): baked
// light times ambient occlusion, floored at the ambient level, then blended
// into the sky colour by distance.

struct Globals {
    view_proj: mat4x4<f32>,
    eye: vec4<f32>,
    fog_color: vec4<f32>,
    // x: fog start, y: fog end (full strength), z: ambient floor.
    fog: vec4<f32>,
    // x, y: framebuffer size in pixels.
    screen: vec4<f32>,
};

@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var atlas_sampler: sampler;

// --- terrain -------------------------------------------------------------------

struct TerrainIn {
    // Section-local position in 1/256 block, biased by 4 blocks (mesher.rs).
    @location(0) pos: vec4<u32>,
    @location(1) uv: vec2<f32>,
    // x: light (face shade included), y: ambient occlusion.
    @location(2) shade: vec4<f32>,
    // Per-section instance data: the section's world origin.
    @location(3) origin: vec4<f32>,
};

struct TerrainOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) shade: f32,
    @location(2) dist: f32,
};

@vertex
fn vs_terrain(v: TerrainIn) -> TerrainOut {
    let local = vec3<f32>(v.pos.xyz) / 256.0 - vec3<f32>(4.0);
    let world = local + v.origin.xyz;
    var out: TerrainOut;
    out.clip = g.view_proj * vec4<f32>(world, 1.0);
    out.uv = v.uv;
    out.shade = v.shade.x * v.shade.y;
    out.dist = distance(world, g.eye.xyz);
    return out;
}

fn lit(rgb: vec3<f32>, shade: f32, dist: f32) -> vec3<f32> {
    let c = rgb * max(shade, g.fog.z);
    let f = clamp((dist - g.fog.x) / max(g.fog.y - g.fog.x, 0.001), 0.0, 1.0);
    return mix(c, g.fog_color.rgb, f);
}

// Cut-out texels (leaf gaps, flower backgrounds) are discarded outright, so
// everything in this pass can write depth and needs no sorting.
@fragment
fn fs_opaque(in: TerrainOut) -> @location(0) vec4<f32> {
    let tex = textureSample(atlas, atlas_sampler, in.uv);
    if (tex.a < 0.5) {
        discard;
    }
    return vec4<f32>(lit(tex.rgb, in.shade, in.dist), 1.0);
}

// Water and glass keep their alpha and are blended over what is behind.
@fragment
fn fs_alpha(in: TerrainOut) -> @location(0) vec4<f32> {
    let tex = textureSample(atlas, atlas_sampler, in.uv);
    if (tex.a < 0.02) {
        discard;
    }
    return vec4<f32>(lit(tex.rgb, in.shade, in.dist), tex.a);
}

// --- block outline -------------------------------------------------------------

@vertex
fn vs_line(@location(0) p: vec3<f32>) -> @builtin(position) vec4<f32> {
    return g.view_proj * vec4<f32>(p, 1.0);
}

@fragment
fn fs_line() -> @location(0) vec4<f32> {
    return vec4<f32>(0.0, 0.0, 0.0, 0.55);
}

// --- HUD -------------------------------------------------------------------------

struct HudIn {
    // Pixels from the top-left corner.
    @location(0) pos: vec2<f32>,
    // Atlas coordinates; negative u means a flat colour, no texture.
    @location(1) uv: vec2<f32>,
    @location(2) color: vec4<f32>,
};

struct HudOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@vertex
fn vs_hud(v: HudIn) -> HudOut {
    var out: HudOut;
    let ndc = vec2<f32>(v.pos.x / g.screen.x * 2.0 - 1.0, 1.0 - v.pos.y / g.screen.y * 2.0);
    out.clip = vec4<f32>(ndc, 0.0, 1.0);
    out.uv = v.uv;
    out.color = v.color;
    return out;
}

@fragment
fn fs_hud(in: HudOut) -> @location(0) vec4<f32> {
    // Sampled unconditionally: a texture sample must sit in uniform control
    // flow, so the choice between texture and flat colour is a select.
    let tex = textureSample(atlas, atlas_sampler, max(in.uv, vec2<f32>(0.0)));
    let textured = in.uv.x >= 0.0;
    if (textured && tex.a < 0.5) {
        discard;
    }
    return select(in.color, tex * in.color, textured);
}
