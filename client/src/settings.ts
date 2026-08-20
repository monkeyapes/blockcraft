/** Player settings, persisted to localStorage. */

export interface Settings {
  renderDistance: number;
  fov: number;
  /** Mouse look sensitivity, stored as an integer 2-40 for the slider. */
  sensitivity: number;
  /** 0-100. */
  volume: number;
  /**
   * Highest texture resolution to use from a resource pack, in pixels.
   * A pack finer than this is downscaled; a coarser one is left alone.
   */
  textureRes: number;
}

export const TEXTURE_RESOLUTIONS = [16, 32, 64, 128] as const;

const KEY = 'bc.settings';

/**
 * A phone is not a small desktop.
 *
 * Chunk generation and meshing dominate on mobile hardware long before the
 * GPU does, so the render distance is what has to come down -- and the atlas
 * with it, since a 64px atlas costs the same memory on a phone as on a
 * desktop for detail nobody can see at that screen size. These are first-run
 * defaults only: the sliders still reach the full range if someone wants it.
 */
function touchDefaults(): boolean {
  return typeof matchMedia === 'function' &&
    matchMedia('(pointer: coarse)').matches &&
    !matchMedia('(hover: hover)').matches;
}

const DEFAULTS: Settings = {
  renderDistance: touchDefaults() ? 4 : 8,
  fov: touchDefaults() ? 78 : 72,
  sensitivity: 12,
  volume: 60,
  textureRes: touchDefaults() ? 32 : 64,
};

const LIMITS: Record<keyof Settings, [number, number]> = {
  renderDistance: [3, 16],
  fov: [55, 110],
  sensitivity: [2, 40],
  volume: [0, 100],
  textureRes: [16, 128],
};

function clampAll(value: Partial<Settings>): Settings {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as Array<keyof Settings>) {
    const raw = value[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const [lo, hi] = LIMITS[key];
    out[key] = Math.round(Math.min(hi, Math.max(lo, raw)));
  }
  return out;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return clampAll(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable; settings just won't persist */
  }
}

/** Slider units to the multiplier the player actually uses. */
export function lookSensitivity(settings: Settings): number {
  return settings.sensitivity / 100;
}
