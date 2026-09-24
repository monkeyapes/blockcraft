/**
 * Equipment icons: tools, weapons and armour.
 *
 * Split from art/items.ts because these share one problem the rest do not:
 * most of them are "a shape on a stick", and at icon size the head's
 * silhouette is the only thing telling a pickaxe from an axe from a hammer,
 * or a sword from a hoe. Each kind has to be recognisable from its outline
 * alone, and each tier from its colour.
 *
 * They are painted from pixel maps (art/equipment-maps.ts) rather than
 * stacked rectangles. A diagonal blade built from rects and thick lines comes
 * out lumpy -- the old sword's notched edge read as a wrench -- whereas a map
 * places every unit on purpose: the sword's edge runs one clean staircase,
 * the pickaxe's arms are mirror images across the haft, and the light falls
 * on the same side of every part. One map per kind, one colour ramp per
 * tier, so the four pickaxes are the same shape by construction and differ
 * only in material.
 */

import { type RGB, type Recipe, S, TILE, TILE_PX, Tile } from '../tile.js';
import {
  ARROW, AXE, BOOTS, BOW, BUCKET, CHEST, DRILL, FLINT_STEEL, HAMMER, HELMET, HOE, LEGS,
  PICKAXE, SHEARS, SHOVEL, SWORD,
} from './equipment-maps.js';

// --- colour ---------------------------------------------------------------

/** Five tones of one material, lightest first: highlight to deep shadow. */
interface Ramp { H: RGB; L: RGB; M: RGB; D: RGB; S: RGB }

export type ToolTier = 'wood' | 'stone' | 'iron' | 'diamond';
export type ArmorMaterial = 'leather' | 'iron' | 'diamond';

/*
 * The tier ramps are what a player reads the tier from, so they are spread
 * apart on purpose: wood is warm and mid-dark, stone a flat mid grey, iron
 * near-white, diamond saturated cyan. Stone and iron are both grey, so they
 * are kept a full ~70 levels of brightness apart rather than relying on hue.
 */
const RAMPS: Record<ToolTier | ArmorMaterial, Ramp> = {
  // Plank-coloured, and noticeably lighter and yellower than the stick it
  // is fixed to -- a wooden head the same brown as its handle is just a
  // bent stick.
  wood: {
    H: [246, 212, 150], L: [222, 180, 116], M: [190, 146, 86], D: [148, 108, 60], S: [106, 76, 40],
  },
  stone: {
    H: [188, 188, 184], L: [156, 156, 154], M: [126, 126, 126], D: [96, 96, 100], S: [68, 68, 74],
  },
  iron: {
    H: [255, 255, 255], L: [232, 234, 238], M: [200, 204, 212], D: [150, 156, 168], S: [106, 112, 126],
  },
  diamond: {
    H: [228, 255, 252], L: [150, 246, 236], M: [78, 216, 208], D: [36, 160, 166], S: [18, 102, 118],
  },
  leather: {
    H: [212, 152, 100], L: [184, 124, 78], M: [152, 100, 62], D: [116, 74, 46], S: [84, 52, 32],
  },
};

/** The stick every tool is hafted on: a darker, redder wood than any head. */
const STICK = { h: [150, 106, 60] as RGB, m: [112, 78, 44] as RGB, d: [80, 54, 30] as RGB };
/** Leather strapping: bindings, grips, the bow's hand-hold. */
const WRAP = { b: [156, 96, 60] as RGB, B: [98, 58, 38] as RGB };

type Palette = Record<string, RGB>;

function rampPalette(r: Ramp): Palette {
  return { H: r.H, L: r.L, M: r.M, D: r.D, S: r.S };
}

// --- drawing --------------------------------------------------------------

/**
 * Paints a 16x16 character map, one authoring unit per character.
 * '.' is transparent; every other character must have a colour, so a typo
 * in a map fails loudly instead of leaving a silent hole.
 */
function paint(t: Tile, rows: readonly string[], palette: Palette): void {
  if (rows.length !== TILE) throw new Error(`pixel map has ${rows.length} rows, not ${TILE}`);
  rows.forEach((row, y) => {
    if (row.length !== TILE) throw new Error(`pixel map row ${y} is ${row.length} wide: "${row}"`);
    for (let x = 0; x < TILE; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const c = palette[ch];
      if (!c) throw new Error(`pixel map uses '${ch}' but the palette has no colour for it`);
      t.set(x, y, c[0], c[1], c[2]);
    }
  });
}

/** Calls fn for every authoring unit whose map character is in `chars`. */
function cells(rows: readonly string[], chars: string, fn: (x: number, y: number) => void): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < TILE; x++) if (chars.includes(row[x])) fn(x, y);
  });
}

/** Shifts the brightness of a block of real pixels inside one unit. */
function dab(t: Tile, x: number, y: number, ox: number, oy: number, w: number, h: number, delta: number): void {
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const X = Math.round(x * S) + ox + px;
      const Y = Math.round(y * S) + oy + py;
      if (X < 0 || Y < 0 || X >= TILE_PX || Y >= TILE_PX) continue;
      const i = (Y * TILE_PX + X) * 4;
      if (t.px[i + 3] < 8) continue;
      t.px[i] += delta;
      t.px[i + 1] += delta;
      t.px[i + 2] += delta;
    }
  }
}

/**
 * A straight line at the rendered resolution, for things far thinner than
 * one authoring unit.
 */
function fineLine(t: Tile, x0: number, y0: number, x1: number, y1: number, colour: RGB, width = 2): void {
  const ax = x0 * S;
  const ay = y0 * S;
  const bx = x1 * S;
  const by = y1 * S;
  const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2);
  const r = width / 2;
  for (let i = 0; i <= steps; i++) {
    const cx = ax + ((bx - ax) * i) / steps;
    const cy = ay + ((by - ay) * i) / steps;
    for (let py = Math.floor(cy - r); py < cy + r; py++) {
      for (let px = Math.floor(cx - r); px < cx + r; px++) {
        if (px < 0 || py < 0 || px >= TILE_PX || py >= TILE_PX) continue;
        const j = (py * TILE_PX + px) * 4;
        t.px[j] = colour[0];
        t.px[j + 1] = colour[1];
        t.px[j + 2] = colour[2];
        t.px[j + 3] = 255;
      }
    }
  }
}

const INK: RGB = [16, 12, 20];

/**
 * A dark rim drawn just *outside* the silhouette, tinted by what it borders.
 *
 * Tile.outline() darkens the shape's own edge pixels, which is right for
 * chunky food and materials but eats thin parts alive: a haft two units
 * wide loses half a unit on each side and turns into a dark line with a
 * brown seam. Growing the rim outward instead keeps every painted unit its
 * own colour, so a two-unit stick still reads as wood. Where a shape runs
 * to the tile's edge there is no room outside, and those edge pixels are
 * inked in place the way outline() would.
 */
function rim(t: Tile): void {
  const reach = Math.max(1, Math.round(S / 2));
  const N = TILE_PX;
  const src = t.px.slice();
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < N && y < N && src[(y * N + x) * 4 + 3] >= 8;
  const ink = (i: number, from: number): void => {
    t.px[i] = src[from] + (INK[0] - src[from]) * 0.8;
    t.px[i + 1] = src[from + 1] + (INK[1] - src[from + 1]) * 0.8;
    t.px[i + 2] = src[from + 2] + (INK[2] - src[from + 2]) * 0.8;
    t.px[i + 3] = 255;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      if (src[i + 3] >= 8) {
        if (x < reach || y < reach || x >= N - reach || y >= N - reach) ink(i, i);
        continue;
      }
      let best = -1;
      let bestD = Infinity;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if (!solid(x + dx, y + dy)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = ((y + dy) * N + (x + dx)) * 4;
          }
        }
      }
      if (best >= 0) ink(i, best);
    }
  }
}

/**
 * Per-material surface at the rendered resolution. The maps give every
 * unit one flat tone; these add the texture that says what it is made of --
 * pitted stone, a glint on cut diamond, a sheen on iron, grain in wood and
 * hide.
 */
function finish(t: Tile, rows: readonly string[], material: ToolTier | ArmorMaterial, chars = 'HLMDS'): void {
  const r = t.rng;
  if (material === 'stone') {
    cells(rows, chars, (x, y) => {
      if (r() < 0.45) dab(t, x, y, (r() * 3) | 0, (r() * 3) | 0, 2, 2, r() < 0.5 ? -22 : 16);
    });
  } else if (material === 'diamond') {
    cells(rows, 'H', (x, y) => dab(t, x, y, 0, 0, 2, 2, 40));
    cells(rows, 'L', (x, y) => { if (r() < 0.3) dab(t, x, y, 1, 1, 1, 1, 60); });
  } else if (material === 'iron') {
    cells(rows, 'HL', (x, y) => dab(t, x, y, 0, 0, 1, 4, 12));
  } else {
    cells(rows, chars, (x, y) => {
      if (r() < 0.35) dab(t, x, y, 0, (r() * 4) | 0, 4, 1, -12);
    });
  }
}

/** Grain along the stick, so a handle reads as wood and not brown plastic. */
function stickGrain(t: Tile, rows: readonly string[]): void {
  const r = t.rng;
  cells(rows, 'hmd', (x, y) => {
    if (r() < 0.5) dab(t, x, y, (r() * 3) | 0, (r() * 3) | 0, 2, 1, -14);
  });
}

// --- tools and weapons ----------------------------------------------------

function toolIcon(rows: readonly string[], tier: ToolTier): Recipe {
  const palette: Palette = { ...rampPalette(RAMPS[tier]), ...STICK, ...WRAP };
  return (t) => {
    paint(t, rows, palette);
    stickGrain(t, rows);
    finish(t, rows, tier);
    rim(t);
  };
}

function swordIcon(tier: ToolTier): Recipe {
  const r = RAMPS[tier];
  const palette: Palette = { ...rampPalette(r), g: r.D, G: r.S, p: r.M, P: r.D, ...WRAP };
  return (t) => {
    paint(t, SWORD, palette);
    finish(t, SWORD, tier, 'HLMD');
    rim(t);
  };
}

function armorIcon(rows: readonly string[], material: ArmorMaterial): Recipe {
  const r = RAMPS[material];
  const palette: Palette = { ...rampPalette(r), R: r.H };
  return (t) => {
    paint(t, rows, palette);
    finish(t, rows, material);
    rim(t);
  };
}

const IRON = RAMPS.iron;

function bucketIcon(contents: 'empty' | 'water' | 'lava'): Recipe {
  const inside: Record<typeof contents, [RGB, RGB]> = {
    empty: [[44, 46, 54], [70, 72, 82]],
    water: [[64, 132, 222], [40, 96, 186]],
    lava: [[255, 150, 40], [224, 84, 20]],
  };
  const [w, W] = inside[contents];
  return (t) => {
    paint(t, BUCKET, { ...rampPalette(IRON), k: IRON.D, w, W });
    if (contents === 'water') cells(BUCKET, 'w', (x, y) => { if (x % 3 === 1) dab(t, x, y, 0, 1, 4, 1, 50); });
    if (contents === 'lava') cells(BUCKET, 'wW', (x, y) => { if ((x + y) % 3 === 0) dab(t, x, y, 1, 1, 2, 2, 60); });
    finish(t, BUCKET, 'iron');
    rim(t);
  };
}

// --- the table ------------------------------------------------------------

export const TOOL_TIERS: readonly ToolTier[] = ['wood', 'stone', 'iron', 'diamond'];
export const ARMOR_MATERIALS: readonly ArmorMaterial[] = ['leather', 'iron', 'diamond'];

/** The map each tool kind is drawn from, keyed by its texture prefix. */
export const TOOL_MAPS: Record<string, readonly string[]> = {
  pickaxe: PICKAXE, axe: AXE, shovel: SHOVEL, hoe: HOE, hammer: HAMMER, sword: SWORD,
};

/** Which tiers each kind comes in. Hammers start at stone: no wooden sledge. */
export const KIND_TIERS: Record<string, readonly ToolTier[]> = {
  pickaxe: TOOL_TIERS, axe: TOOL_TIERS, shovel: TOOL_TIERS, hoe: TOOL_TIERS,
  sword: TOOL_TIERS, hammer: ['stone', 'iron', 'diamond'],
};

/** Armour maps by slot, keyed the way the texture names are. */
export const ARMOR_MAPS: Record<'head' | 'chest' | 'legs' | 'feet', readonly string[]> = {
  head: HELMET, chest: CHEST, legs: LEGS, feet: BOOTS,
};

export const EQUIPMENT_ART: Record<string, Recipe> = {
  bow: (t) => {
    paint(t, BOW, { ...STICK, ...WRAP });
    stickGrain(t, BOW);
    rim(t);
    // The string runs nock to nock, pulled taut: a fine line with no rim of
    // its own. A unit thick, or outlined like the limbs, it reads as a
    // second limb and the bow turns into a closed "D" of wood.
    fineLine(t, 13.4, 2.6, 2.6, 13.4, [236, 232, 218], 2);
  },
  arrow: (t) => {
    paint(t, ARROW, {
      ...rampPalette(RAMPS.stone), ...STICK,
      f: [240, 238, 232], F: [196, 192, 184], r: [204, 66, 52],
    });
    rim(t);
  },
  shears: (t) => {
    paint(t, SHEARS, { ...rampPalette(IRON), r: [196, 58, 48], O: [70, 72, 80] });
    rim(t);
  },
  bucket: bucketIcon('empty'),
  bucket_water: bucketIcon('water'),
  bucket_lava: bucketIcon('lava'),
  flint_steel: (t) => {
    paint(t, FLINT_STEEL, {
      ...rampPalette(IRON),
      c: [226, 216, 190], k: [98, 94, 102], K: [58, 54, 62],
      y: [255, 214, 96], Y: [255, 248, 196], o: [255, 142, 40],
    });
    rim(t);
  },
  drill: (t) => {
    paint(t, DRILL, {
      H: [255, 176, 96], L: [238, 136, 54], M: [212, 104, 36], D: [158, 70, 24], S: [110, 46, 16],
      c: [200, 204, 212], C: [140, 146, 158],
      s: RAMPS.diamond.L, z: RAMPS.diamond.D, t: RAMPS.diamond.H, u: RAMPS.diamond.M,
      g: [64, 60, 58], G: [40, 38, 38], b: [80, 84, 92], B: [52, 54, 60], y: [206, 60, 44],
    });
    rim(t);
  },
};

for (const [kind, rows] of Object.entries(TOOL_MAPS)) {
  for (const tier of KIND_TIERS[kind]) {
    EQUIPMENT_ART[`${kind}_${tier}`] = kind === 'sword' ? swordIcon(tier) : toolIcon(rows, tier);
  }
}

for (const material of ARMOR_MATERIALS) {
  for (const [slot, rows] of Object.entries(ARMOR_MAPS)) {
    EQUIPMENT_ART[`armor_${slot}_${material}`] = armorIcon(rows, material);
  }
}
