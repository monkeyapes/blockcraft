/** WebGL2 renderer: one shader for terrain, plus line overlays. */

import { CHUNK_X, CHUNK_Z, SECTION_Y } from '@shared/constants.js';
import {
  boxInFrustum, frustumPlanes, lookAt, mat4, multiply, perspective, type Vec3,
} from '../math.js';
import { FLOATS_PER_VERTEX, type SectionMesh } from '../mesher.js';
import type { Atlas } from './atlas.js';

const TERRAIN_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in float aLight;
layout(location = 3) in float aAO;

uniform mat4 uViewProj;
uniform vec3 uOrigin;
uniform vec3 uEye;

out vec2 vUV;
out float vShade;
out float vDist;

void main() {
  vec3 world = aPos + uOrigin;
  vUV = aUV;
  vShade = aLight * aAO;
  vDist = length(world - uEye);
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vShade;
in float vDist;

uniform sampler2D uAtlas;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAmbient;

out vec4 fragColor;

void main() {
  vec4 tex = texture(uAtlas, vUV);
  if (tex.a < 0.02) discard;
  vec3 lit = tex.rgb * max(vShade, uAmbient);
  float fog = clamp((vDist - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);
  fragColor = vec4(mix(lit, uFogColor, fog), tex.a);
}`;

const LINE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); }`;

const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main() { fragColor = uColor; }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

interface GpuPart {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
}

export interface GpuSection {
  cx: number;
  cz: number;
  section: number;
  opaque: GpuPart | null;
  alpha: GpuPart | null;
}

export interface SkySettings {
  color: [number, number, number];
  ambient: number;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private terrain: WebGLProgram;
  private lines: WebGLProgram;
  private uTerrain: Record<string, WebGLUniformLocation | null> = {};
  private uLines: Record<string, WebGLUniformLocation | null> = {};
  private texture: WebGLTexture;
  private lineVao: WebGLVertexArrayObject;
  private lineVbo: WebGLBuffer;

  private sections = new Map<string, GpuSection>();
  private overlay: GpuPart | null = null;
  private proj = mat4();
  private view = mat4();
  private viewProj = mat4();
  /** Narrow-FOV projection for the first-person hand. */
  private handProj = mat4();

  sky: SkySettings = { color: [0.55, 0.72, 0.93], ambient: 0.06 };
  fov = 72;
  renderDistance = 8;
  /** Fraction of the far plane at which fog is fully opaque. */
  fogFar = 0.95;

  drawnSections = 0;
  drawnTriangles = 0;

  /** Camera position from the last `render`, reused by overlay passes. */
  private lastEye: Vec3 = [0, 0, 0];
  /** Atlas revision already uploaded, so a pack swap re-uploads once. */
  private uploadedAtlas = -1;

  /** Re-uploads the atlas if its pixels changed (a resource pack was applied). */
  syncAtlas(atlas: Atlas): void {
    if (atlas.revision === this.uploadedAtlas) return;
    this.uploadedAtlas = atlas.revision;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  constructor(readonly canvas: HTMLCanvasElement, atlas: Atlas) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    this.terrain = link(gl, TERRAIN_VS, TERRAIN_FS);
    this.lines = link(gl, LINE_VS, LINE_FS);
    for (const name of ['uViewProj', 'uOrigin', 'uEye', 'uAtlas', 'uFogColor', 'uFogNear', 'uFogFar', 'uAmbient']) {
      this.uTerrain[name] = gl.getUniformLocation(this.terrain, name);
    }
    for (const name of ['uViewProj', 'uColor']) {
      this.uLines[name] = gl.getUniformLocation(this.lines, name);
    }

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    // Nearest filtering keeps the pixel-art look and avoids atlas bleed.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.lineVao = gl.createVertexArray()!;
    this.lineVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // -------------------------------------------------------------- geometry

  private static key(cx: number, cz: number, section: number): string {
    return `${cx},${cz},${section}`;
  }

  private upload(vertices: Float32Array, indices: Uint32Array): GpuPart | null {
    if (indices.length === 0) return null;
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    const ibo = gl.createBuffer()!;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 24);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    return { vao, vbo, ibo, count: indices.length };
  }

  private destroyPart(part: GpuPart | null): void {
    if (!part) return;
    const gl = this.gl;
    gl.deleteVertexArray(part.vao);
    gl.deleteBuffer(part.vbo);
    gl.deleteBuffer(part.ibo);
  }

  setSection(cx: number, cz: number, section: number, mesh: SectionMesh | null): void {
    const key = Renderer.key(cx, cz, section);
    const existing = this.sections.get(key);
    if (existing) {
      this.destroyPart(existing.opaque);
      this.destroyPart(existing.alpha);
      this.sections.delete(key);
    }
    if (!mesh) return;

    this.sections.set(key, {
      cx, cz, section,
      opaque: this.upload(mesh.opaque.vertices, mesh.opaque.indices),
      alpha: this.upload(mesh.alpha.vertices, mesh.alpha.indices),
    });
  }

  dropChunk(cx: number, cz: number): void {
    for (const [key, sec] of this.sections) {
      if (sec.cx === cx && sec.cz === cz) {
        this.destroyPart(sec.opaque);
        this.destroyPart(sec.alpha);
        this.sections.delete(key);
      }
    }
  }

  dropAll(): void {
    for (const sec of this.sections.values()) {
      this.destroyPart(sec.opaque);
      this.destroyPart(sec.alpha);
    }
    this.sections.clear();
  }

  // ----------------------------------------------------------------- frame

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(eye: Vec3, forward: Vec3): void {
    const gl = this.gl;
    this.resize();
    this.lastEye = eye;

    const far = this.renderDistance * CHUNK_X + 48;
    const aspect = this.canvas.width / this.canvas.height;
    perspective(this.proj, this.fov, aspect, 0.1, far);
    perspective(this.handProj, 68, aspect, 0.02, 8);
    lookAt(this.view, eye, [eye[0] + forward[0], eye[1] + forward[1], eye[2] + forward[2]]);
    multiply(this.viewProj, this.proj, this.view);
    const planes = frustumPlanes(this.viewProj);

    gl.clearColor(this.sky.color[0], this.sky.color[1], this.sky.color[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.terrain);
    gl.uniformMatrix4fv(this.uTerrain.uViewProj, false, this.viewProj);
    gl.uniform3fv(this.uTerrain.uEye, eye);
    gl.uniform3fv(this.uTerrain.uFogColor, this.sky.color);
    gl.uniform1f(this.uTerrain.uFogNear, far * this.fogFar * 0.58);
    gl.uniform1f(this.uTerrain.uFogFar, far * this.fogFar);
    gl.uniform1f(this.uTerrain.uAmbient, this.sky.ambient);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uTerrain.uAtlas, 0);

    // Cull, then sort: opaque front-to-back for early-z, alpha back-to-front.
    const visible: Array<{ sec: GpuSection; dist: number }> = [];
    for (const sec of this.sections.values()) {
      const ox = sec.cx * CHUNK_X;
      const oz = sec.cz * CHUNK_Z;
      const oy = sec.section * SECTION_Y;
      if (!boxInFrustum(planes, ox, oy, oz, ox + CHUNK_X, oy + SECTION_Y, oz + CHUNK_Z)) continue;
      const dx = ox + 8 - eye[0];
      const dy = oy + 8 - eye[1];
      const dz = oz + 8 - eye[2];
      visible.push({ sec, dist: dx * dx + dy * dy + dz * dz });
    }
    visible.sort((a, b) => a.dist - b.dist);

    this.drawnSections = 0;
    this.drawnTriangles = 0;

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (const { sec } of visible) {
      if (!sec.opaque) continue;
      this.drawPart(sec, sec.opaque);
    }

    // Liquids and glass are drawn double-sided, so a water surface is still
    // there when you look up at it from underneath.
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    for (let i = visible.length - 1; i >= 0; i--) {
      const sec = visible[i].sec;
      if (!sec.alpha) continue;
      this.drawPart(sec, sec.alpha);
    }
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  private drawPart(sec: GpuSection, part: GpuPart): void {
    const gl = this.gl;
    gl.uniform3f(this.uTerrain.uOrigin, sec.cx * CHUNK_X, 0, sec.cz * CHUNK_Z);
    gl.bindVertexArray(part.vao);
    gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, 0);
    this.drawnSections++;
    this.drawnTriangles += part.count / 3;
  }

  /**
   * Draws dynamic world-space geometry (vehicles) with the terrain shader.
   * Rebuilt every frame, so it uses a streaming buffer.
   */
  drawWorldMesh(vertices: Float32Array, indices: Uint32Array): void {
    if (indices.length === 0) return;
    const gl = this.gl;
    this.ensureOverlay();

    gl.bindVertexArray(this.overlay!.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.overlay!.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.overlay!.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);

    gl.useProgram(this.terrain);
    gl.uniformMatrix4fv(this.uTerrain.uViewProj, false, this.viewProj);
    gl.uniform3f(this.uTerrain.uOrigin, 0, 0, 0);
    gl.uniform3fv(this.uTerrain.uEye, this.lastEye);
    gl.uniform3fv(this.uTerrain.uFogColor, this.sky.color);
    const far = this.renderDistance * CHUNK_X + 48;
    gl.uniform1f(this.uTerrain.uFogNear, far * this.fogFar * 0.58);
    gl.uniform1f(this.uTerrain.uFogFar, far * this.fogFar);
    gl.uniform1f(this.uTerrain.uAmbient, this.sky.ambient);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uTerrain.uAtlas, 0);

    // Double-sided: the thin plates used for wings and rotors have no back.
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  private ensureOverlay(): void {
    if (this.overlay) return;
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    const ibo = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindVertexArray(null);
    this.overlay = { vao, vbo, ibo, count: 0 };
  }

  /**
   * Draws a mesh whose vertices are already in view space, on top of the
   * world. Used for the first-person hand and held item.
   */
  drawViewSpace(vertices: Float32Array, indices: Uint32Array): void {
    if (indices.length === 0) return;
    const gl = this.gl;
    this.ensureOverlay();

    gl.bindVertexArray(this.overlay!.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.overlay!.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.overlay!.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);

    // Fresh depth range so the hand never clips into nearby geometry.
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.terrain);
    gl.uniformMatrix4fv(this.uTerrain.uViewProj, false, this.handProj);
    gl.uniform3f(this.uTerrain.uOrigin, 0, 0, 0);
    gl.uniform3f(this.uTerrain.uEye, 0, 0, 0);
    gl.uniform1f(this.uTerrain.uFogNear, 1e6);
    gl.uniform1f(this.uTerrain.uFogFar, 1e7);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uTerrain.uAtlas, 0);

    gl.disable(gl.CULL_FACE);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  /** Wireframe box, used for the block highlight and remote player bodies. */
  drawBox(
    min: Vec3, max: Vec3, color: [number, number, number, number] = [0, 0, 0, 0.9],
  ): void {
    const gl = this.gl;
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const c: Vec3[] = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
    const edges = [
      0, 1, 1, 2, 2, 3, 3, 0,
      4, 5, 5, 6, 6, 7, 7, 4,
      0, 4, 1, 5, 2, 6, 3, 7,
    ];
    const data = new Float32Array(edges.length * 3);
    edges.forEach((idx, i) => {
      data[i * 3] = c[idx][0];
      data[i * 3 + 1] = c[idx][1];
      data[i * 3 + 2] = c[idx][2];
    });

    gl.useProgram(this.lines);
    gl.uniformMatrix4fv(this.uLines.uViewProj, false, this.viewProj);
    gl.uniform4fv(this.uLines.uColor, color);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.drawArrays(gl.LINES, 0, edges.length);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
