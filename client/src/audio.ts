/**
 * Synthesized sound effects via WebAudio -- no audio assets ship with the
 * game. Every sound is an oscillator and a filtered noise burst shaped by an
 * envelope, categorised by a rough guess at what a block is made of.
 */

import { blockDef } from '@shared/blocks.js';

type Material = 'wood' | 'stone' | 'gravel' | 'glass' | 'metal' | 'cloth' | 'grass' | 'generic';

/**
 * There is no material field on a block definition, so this reads the name
 * instead. Good enough to tell a footstep on wood from one on stone; wrong
 * guesses just land on a neutral thud rather than anything jarring.
 */
function materialOf(blockId: number): Material {
  const name = blockDef(blockId).name.toLowerCase();
  if (/log|plank|leaves|crafting|fence/.test(name)) return 'wood';
  if (/sand|gravel|soul/.test(name)) return 'gravel';
  if (/glass/.test(name)) return 'glass';
  if (/block of|ore|obsidian|furnace|cable|conveyor|sorter/.test(name)) return 'metal';
  if (/wool/.test(name)) return 'cloth';
  if (/grass|dirt|netherrack/.test(name)) return 'grass';
  if (/stone|brick|cobble/.test(name)) return 'stone';
  return 'generic';
}

/** Base pitch and noise-vs-tone balance per material, tuned by ear. */
const MATERIAL_TONE: Record<Material, { pitch: number; noisy: number }> = {
  wood: { pitch: 220, noisy: 0.5 },
  stone: { pitch: 140, noisy: 0.85 },
  gravel: { pitch: 180, noisy: 1.0 },
  glass: { pitch: 520, noisy: 0.3 },
  metal: { pitch: 380, noisy: 0.25 },
  cloth: { pitch: 260, noisy: 0.6 },
  grass: { pitch: 200, noisy: 0.7 },
  generic: { pitch: 200, noisy: 0.6 },
};

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastPlayed = new Map<string, number>();
  private volumeLevel = 0.6;

  set volume(v: number) {
    this.volumeLevel = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volumeLevel;
  }

  /**
   * Browsers refuse to start audio before a user gesture. Call this from the
   * first click or key press; cheap to call again on every one after that.
   */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return; // no WebAudio in this browser: sound is a bonus, never fatal
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumeLevel;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoiseBuffer(this.ctx);
  }

  private makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * Some sounds (footsteps, mining ticks) get triggered every frame the
   * condition holds; this drops repeats within a key's own cooldown so they
   * do not turn into a buzz. Independent per key, so a footstep never eats a
   * mining tick's budget.
   */
  private throttled(key: string, minGapMs: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime * 1000;
    const last = this.lastPlayed.get(key) ?? -Infinity;
    if (now - last < minGapMs) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  /** A short filtered noise burst plus a soft tone, shaped by an envelope. */
  private thump(material: Material, gain: number, duration: number, pitchMul = 1): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const tone = MATERIAL_TONE[material];
    const t0 = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = tone.pitch * pitchMul * 2.2;
    filter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(gain * tone.noisy, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    noise.connect(filter).connect(noiseGain).connect(this.master);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(tone.pitch * pitchMul, t0);
    osc.frequency.exponentialRampToValueAtTime(tone.pitch * pitchMul * 0.7, t0 + duration);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(gain * (1 - tone.noisy * 0.5), t0);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(oscGain).connect(this.master);

    noise.start(t0);
    noise.stop(t0 + duration);
    osc.start(t0);
    osc.stop(t0 + duration);
  }

  /** A descending blip, independent of any block material. */
  private blip(startHz: number, endHz: number, gain: number, duration: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(startHz, t0);
    osc.frequency.exponentialRampToValueAtTime(endHz, t0 + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration);
  }

  /** One tick during mining -- short, quiet, and rate-limited to a cadence. */
  mineTick(blockId: number): void {
    if (!this.throttled('mine', 220)) return;
    this.thump(materialOf(blockId), 0.11, 0.09, 1.3 + Math.random() * 0.15);
  }

  /** The block finally gives way -- louder and a touch lower than a tick. */
  blockBreak(blockId: number): void {
    this.thump(materialOf(blockId), 0.3, 0.22, 0.85);
  }

  /** Placing a block: a soft, slightly higher-pitched thud. */
  blockPlace(blockId: number): void {
    this.thump(materialOf(blockId), 0.22, 0.12, 1.15);
  }

  /** A footfall on whatever the player is standing on, rate-limited to a stride. */
  footstep(blockId: number): void {
    if (!this.throttled('step', 260)) return;
    this.thump(materialOf(blockId), 0.09, 0.09, 1.0 + Math.random() * 0.1);
  }

  /** Taking damage: short and sharp, distinct from any block sound. */
  hurt(): void {
    this.blip(320, 120, 0.22, 0.18);
  }

  /** Death: the same shape, slower and lower. */
  death(): void {
    this.blip(220, 50, 0.3, 1.0);
  }

  /** A neutral UI click, for menus and crafting. */
  click(): void {
    this.blip(700, 500, 0.12, 0.05);
  }
}
