/**
 * Offscreen rendering, for looking at art without a browser.
 *
 * Builds the texture atlas in plain Node from the same recipes the game
 * uses, and rasterises the game's own meshes -- terrain sections from the
 * real mesher, mob models, anything in the terrain vertex format -- into a
 * PNG. A picture you can open is how a texture or a model gets judged; a
 * pixel statistic only says it is not blank.
 *
 * Deliberately simple: orthographic camera, z-buffer, nearest-neighbour
 * texture sampling, alpha cut-out like the shader, and light taken from the
 * face direction rather than the baked light (which needs a lit world).
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

import { ATLAS_SIZE, GRID, atlasTileNames, renderTile, type Atlas } from '../../client/src/gfx/atlas.js';
import { TILE_PX } from '../../client/src/gfx/tile.js';
import { FLOATS_PER_VERTEX } from '../../client/src/mesher.js';

// --- PNG ---------------------------------------------------------------------

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encodes RGBA pixels as a PNG file. */
export function encodePNG(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export function writePNG(path: string, width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): void {
  writeFileSync(path, encodePNG(width, height, rgba));
}

// --- the atlas, without a canvas ----------------------------------------------

export interface NodeAtlas extends Atlas {
  pixels: Uint8ClampedArray;
  size: number;
}

let cached: NodeAtlas | null = null;

/** The game's atlas, laid out exactly as buildAtlas lays it out. */
export function nodeAtlas(): NodeAtlas {
  if (cached) return cached;
  const names = atlasTileNames();
  const size = ATLAS_SIZE;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const slots = new Map<string, number>();
  names.forEach((name, index) => {
    slots.set(name, index);
    const { px } = renderTile(name);
    const ox = (index % GRID) * TILE_PX;
    const oy = ((index / GRID) | 0) * TILE_PX;
    for (let y = 0; y < TILE_PX; y++) {
      pixels.set(px.subarray(y * TILE_PX * 4, (y + 1) * TILE_PX * 4), ((oy + y) * size + ox) * 4);
    }
  });
  const inset = 0.5 / size;
  cached = {
    pixels,
    size,
    canvas: null as unknown as HTMLCanvasElement,
    revision: 0,
    tileSize: TILE_PX,
    applyOverrides: () => 0,
    iconURL: () => '',
    uv(name: string) {
      const index = slots.get(name) ?? 0;
      const col = index % GRID;
      const row = (index / GRID) | 0;
      return [col / GRID + inset, row / GRID + inset, (col + 1) / GRID - inset, (row + 1) / GRID - inset];
    },
  };
  return cached;
}

// --- rasteriser ----------------------------------------------------------------

export interface Mesh {
  vertices: Float32Array;
  indices: Uint32Array;
  /** Added to every vertex position (section meshes are chunk-relative). */
  offset?: [number, number, number];
}

export interface Camera {
  width: number;
  height: number;
  /** World point at the centre of the image. */
  center: [number, number, number];
  /** Degrees; 0 looks toward -z from the south, 45 is the classic 3/4 view. */
  yaw?: number;
  /** Degrees above the horizon. */
  pitch?: number;
  /** Pixels per block. */
  scale?: number;
  background?: [number, number, number, number];
}

/** World point to [screen x, screen y, depth toward the viewer] for a camera. */
export function projector(cam: Camera): (x: number, y: number, z: number) => [number, number, number] {
  const scale = cam.scale ?? 48;
  const yaw = ((cam.yaw ?? 35) * Math.PI) / 180;
  const pitch = ((cam.pitch ?? 30) * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return (x, y, z) => {
    const dx = x - cam.center[0];
    const dy = y - cam.center[1];
    const dz = z - cam.center[2];
    // Turn about the vertical axis, then tip toward the viewer.
    const rx = dx * cy - dz * sy;
    const rz = dx * sy + dz * cy;
    const up = dy * cp - rz * sp;
    const toward = dy * sp + rz * cp;
    return [cam.width / 2 + rx * scale, cam.height / 2 - up * scale, toward];
  };
}

/**
 * Draws meshes in the terrain vertex format (px py pz u v light ao).
 * Light comes from each triangle's facing -- top brightest, bottom darkest --
 * so a model reads the same whatever world it came from.
 */
export function renderMeshes(meshes: Mesh[], cam: Camera, atlas = nodeAtlas()): Uint8ClampedArray {
  const { width, height } = cam;
  const out = new Uint8ClampedArray(width * height * 4);
  const bg = cam.background ?? [40, 44, 52, 255];
  for (let i = 0; i < width * height; i++) out.set(bg, i * 4);
  const depth = new Float32Array(width * height).fill(-Infinity);

  const project = projector(cam);

  const A = atlas.size;
  const tex = atlas.pixels;

  for (const mesh of meshes) {
    const v = mesh.vertices;
    const [ox, oy, oz] = mesh.offset ?? [0, 0, 0];
    const F = FLOATS_PER_VERTEX;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const ia = mesh.indices[t] * F;
      const ib = mesh.indices[t + 1] * F;
      const ic = mesh.indices[t + 2] * F;
      const wa: [number, number, number] = [v[ia] + ox, v[ia + 1] + oy, v[ia + 2] + oz];
      const wb: [number, number, number] = [v[ib] + ox, v[ib + 1] + oy, v[ib + 2] + oz];
      const wc: [number, number, number] = [v[ic] + ox, v[ic + 1] + oy, v[ic + 2] + oz];
      // Facing light from the world-space normal.
      const e1 = [wb[0] - wa[0], wb[1] - wa[1], wb[2] - wa[2]];
      const e2 = [wc[0] - wa[0], wc[1] - wa[1], wc[2] - wa[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      const ny = n[1] / nl;
      const nx = Math.abs(n[0] / nl);
      const shade = ny > 0.5 ? 1 : ny < -0.5 ? 0.5 : nx > 0.5 ? 0.72 : 0.86;
      // Mob flashes and the like carry a light above 1; keep their tint.
      const extra = Math.max(v[ia + 5], v[ib + 5], v[ic + 5]) > 1.2 ? 1.5 : 1;

      const pa = project(...wa);
      const pb = project(...wb);
      const pc = project(...wc);
      const minX = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0])));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])));
      const minY = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1])));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])));
      const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      if (Math.abs(area) < 1e-9) continue;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((pb[0] - px) * (pc[1] - py) - (pb[1] - py) * (pc[0] - px)) / area;
          const w1 = ((pc[0] - px) * (pa[1] - py) - (pc[1] - py) * (pa[0] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const d = w0 * pa[2] + w1 * pb[2] + w2 * pc[2];
          const di = y * width + x;
          if (d <= depth[di]) continue;
          const u = w0 * v[ia + 3] + w1 * v[ib + 3] + w2 * v[ic + 3];
          const vv = w0 * v[ia + 4] + w1 * v[ib + 4] + w2 * v[ic + 4];
          const tx = Math.min(A - 1, Math.max(0, Math.floor(u * A)));
          const ty = Math.min(A - 1, Math.max(0, Math.floor(vv * A)));
          const ti = (ty * A + tx) * 4;
          if (tex[ti + 3] < 5) continue; // the shader discards these too
          depth[di] = d;
          const k = shade * extra;
          out[di * 4] = tex[ti] * k;
          out[di * 4 + 1] = tex[ti + 1] * k;
          out[di * 4 + 2] = tex[ti + 2] * k;
          out[di * 4 + 3] = 255;
        }
      }
    }
  }
  return out;
}

/** Nearest-neighbour upscale, so small renders stay crisp in an image viewer. */
export function upscale(src: Uint8ClampedArray, w: number, h: number, k: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * k * h * k * 4);
  for (let y = 0; y < h * k; y++) {
    for (let x = 0; x < w * k; x++) {
      const s = (((y / k) | 0) * w + ((x / k) | 0)) * 4;
      out.set(src.subarray(s, s + 4), (y * w * k + x) * 4);
    }
  }
  return out;
}

// --- a tiny bitmap font, for labelling sheets ------------------------------------

// 3x5 glyphs, one row per string, '1' = ink. Upper case, digits, a few marks.
const GLYPHS: Record<string, string[]> = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['110', '101', '101', '101', '101'],
  O: ['010', '101', '101', '101', '010'], P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '110', '011'], R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'], V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
  2: ['110', '001', '010', '100', '111'], 3: ['110', '001', '010', '001', '110'],
  4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '110', '001', '110'],
  6: ['011', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '110'],
  _: ['000', '000', '000', '000', '111'], '-': ['000', '000', '111', '000', '000'],
  ' ': ['000', '000', '000', '000', '000'], '.': ['000', '000', '000', '000', '010'],
};

/** Writes text into an RGBA buffer at (x, y), each font pixel k x k. */
export function drawText(
  buf: Uint8ClampedArray, width: number, x: number, y: number, text: string,
  k = 2, colour: [number, number, number] = [235, 235, 235],
): void {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (g[gy][gx] !== '1') continue;
        for (let yy = 0; yy < k; yy++) {
          for (let xx = 0; xx < k; xx++) {
            const px = cx + gx * k + xx;
            const py = y + gy * k + yy;
            if (px < 0 || py < 0 || px >= width) continue;
            const i = (py * width + px) * 4;
            if (i + 3 >= buf.length) continue;
            buf[i] = colour[0]; buf[i + 1] = colour[1]; buf[i + 2] = colour[2]; buf[i + 3] = 255;
          }
        }
      }
    }
    cx += 4 * k;
  }
}
