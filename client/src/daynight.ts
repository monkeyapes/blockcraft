/**
 * Time of day.
 *
 * Drives the sky colour, the sun and moon, and the sky-light level that the
 * mesher bakes into terrain. Night being genuinely dark is what makes torches
 * and hostile mobs matter.
 */

export const DAY_LENGTH_SECONDS = 600; // ten minutes for a full cycle

/** Key points in the cycle, as a fraction of a day. */
const DAWN = 0.0;
const NOON = 0.25;
const DUSK = 0.5;
const MIDNIGHT = 0.75;

export interface SkyState {
  /** 0..1 through the day; 0 is sunrise, 0.5 sunset. */
  fraction: number;
  /** 0 (midnight) to 1 (noon), used for terrain brightness. */
  brightness: number;
  /** Horizon colour. */
  sky: [number, number, number];
  /** Direction toward the sun; the moon is opposite. */
  sunDirection: [number, number, number];
  /** 0 by day, 1 at night: fades the stars in. */
  starAlpha: number;
  isNight: boolean;
}

function mix(
  a: [number, number, number], b: [number, number, number], t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

const DAY_SKY: [number, number, number] = [0.55, 0.72, 0.93];
const SUNSET_SKY: [number, number, number] = [0.86, 0.45, 0.26];
const NIGHT_SKY: [number, number, number] = [0.03, 0.04, 0.10];

export class DayNight {
  /** Seconds since dawn. */
  private elapsed = DAY_LENGTH_SECONDS * 0.08;
  /** Frozen time, for /time set. */
  paused = false;

  /*
   * Weather.
   *
   * Rain runs on its own slow clock rather than being rolled per tick, so a
   * shower lasts long enough to be worth sheltering from and dry spells are
   * long enough that solar power is usually worth building.
   */
  raining = false;
  private weatherTimer = 260;

  private advanceWeather(dt: number): void {
    this.weatherTimer -= dt;
    if (this.weatherTimer > 0) return;
    this.raining = !this.raining;
    // Showers are short; clear spells are long.
    this.weatherTimer = this.raining
      ? 60 + Math.random() * 90
      : 200 + Math.random() * 320;
  }

  advance(dt: number): void {
    this.advanceWeather(dt);
    if (!this.paused) this.elapsed = (this.elapsed + dt) % DAY_LENGTH_SECONDS;
  }

  get fraction(): number {
    return this.elapsed / DAY_LENGTH_SECONDS;
  }

  /** Sets the time from a 0..1 fraction of the day. */
  setFraction(value: number): void {
    this.elapsed = ((value % 1) + 1) % 1 * DAY_LENGTH_SECONDS;
  }

  /** Clock reading, for the debug overlay. */
  get clock(): string {
    // Dawn is 06:00, so the cycle reads like a real day.
    const hours = (this.fraction * 24 + 6) % 24;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  state(): SkyState {
    const f = this.fraction;

    // The sun rises at 0, peaks at 0.25, sets at 0.5.
    const sunAngle = f * Math.PI * 2;
    const sunDirection: [number, number, number] = [
      Math.cos(sunAngle), Math.sin(sunAngle), 0.15,
    ];

    // Brightness follows the sun's height, with a floor so night is navigable.
    const height = Math.sin(sunAngle);
    const brightness = Math.max(0.12, Math.min(1, height * 1.5 + 0.35));

    // Colour: day blue, warm at the horizon, deep blue at night.
    let sky: [number, number, number];
    if (f < NOON) {
      sky = mix(SUNSET_SKY, DAY_SKY, Math.min(1, (f - DAWN) / (NOON - DAWN) * 1.6));
    } else if (f < DUSK) {
      sky = mix(DAY_SKY, SUNSET_SKY, Math.max(0, (f - NOON) / (DUSK - NOON) * 1.6 - 0.6));
    } else if (f < MIDNIGHT) {
      sky = mix(SUNSET_SKY, NIGHT_SKY, Math.min(1, (f - DUSK) / (MIDNIGHT - DUSK) * 2.2));
    } else {
      sky = mix(NIGHT_SKY, SUNSET_SKY, Math.max(0, (f - MIDNIGHT) / (1 - MIDNIGHT) * 1.8 - 0.8));
    }

    const isNight = height < -0.05;
    const starAlpha = Math.max(0, Math.min(1, -height * 2.2));

    return { fraction: f, brightness, sky, sunDirection, starAlpha, isNight };
  }
}
