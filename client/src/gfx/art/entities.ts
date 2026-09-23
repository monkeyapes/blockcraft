/**
 * Creature, player and vehicle skins, plus the overlays the renderer draws
 * on top of the world (break cracks, the bare hand).
 */

import { TILE, type RGB, type Recipe, Tile, mulberry32 } from '../tile.js';

/** Tiles the block/item registries don't reference but the renderer needs. */
export const EXTRA_TILES = [
  'hand',
  'crack_0', 'crack_1', 'crack_2', 'crack_3', 'crack_4',
  'crack_5', 'crack_6', 'crack_7', 'crack_8', 'crack_9',
  'paint_red', 'paint_dark', 'chrome', 'tire', 'headlight', 'taillight', 'rotor',
  'skin', 'face', 'hair', 'shirt', 'sleeve', 'pants', 'boots',
  'pig', 'pig_face', 'cow', 'cow_head', 'cow_face', 'wool', 'sheep_face',
  'sheep_leg', 'chicken', 'chicken_face', 'beak', 'bone',
  'zombie_head', 'zombie_face', 'zombie_body', 'zombie_legs',
  'blaze_core', 'blaze_face', 'blaze_rod_mob',
  'ender_body', 'ender_face',
  'dragon_body', 'dragon_head', 'dragon_face', 'dragon_wing',
];

export const ENTITY_ART: Record<string, Recipe> = {};

// Mob hides. Faces get eyes on the front so you can tell which way one is
// looking, which matters when something is chasing you.
/**
 * Animal hide.
 *
 * A flat fill plus white-noise jitter averaged out to a single colour at any
 * distance -- the pig read as 175 brightness with a standard deviation of 4,
 * which is indistinguishable from a blank swatch. Coherent blotching and a
 * bevel give the surface something to catch the light on.
 */
function hide(base: RGB, jitter = 7) {
  const darker: RGB = [base[0] * 0.86, base[1] * 0.86, base[2] * 0.86];
  const lighter: RGB = [
    Math.min(255, base[0] * 1.12),
    Math.min(255, base[1] * 1.12),
    Math.min(255, base[2] * 1.12),
  ];
  return (t: Tile) => {
    t.fill(base, jitter + 8);
    t.mottle(darker, 0.55, 4);
    t.mottle(lighter, 0.4, 7);
    t.grain(16, 12);
    t.bevel(14);
  };
}

/**
 * Woven fabric: a visible weave plus dye unevenness.
 *
 * Used for every cloth surface so shirts, trousers and mob clothing stop
 * being flat colour swatches.
 */
function fabric(base: RGB) {
  const dark: RGB = [base[0] * 0.82, base[1] * 0.82, base[2] * 0.82];
  const light: RGB = [
    Math.min(255, base[0] * 1.15),
    Math.min(255, base[1] * 1.15),
    Math.min(255, base[2] * 1.15),
  ];
  return (t: Tile) => {
    t.fill(base, 10);
    t.streaks(11);        // weft
    t.streaks(9, true);   // warp
    t.mottle(dark, 0.4, 5);
    t.mottle(light, 0.3, 8);
    t.bevel(14);
  };
}

function faceOf(base: RGB, eye: RGB, snout: RGB | null, jitter = 6) {
  return (t: Tile) => {
    t.fill(base, jitter);
    t.rect(3, 5, 3, 3, eye);
    t.rect(10, 5, 3, 3, eye);
    t.set(4, 6, 250, 250, 250);
    t.set(11, 6, 250, 250, 250);
    if (snout) t.rect(5, 10, 6, 4, snout);
  };
}

ENTITY_ART.pig = hide([224, 148, 152]);
ENTITY_ART.pig_face = (t) => {
  faceOf([224, 148, 152], [40, 30, 32], [206, 122, 128])(t);
  t.set(7, 11, 150, 82, 90);
  t.set(9, 11, 150, 82, 90);
};
ENTITY_ART.cow = hide([70, 54, 46]);
ENTITY_ART.cow_head = hide([84, 66, 56]);
ENTITY_ART.cow_face = faceOf([84, 66, 56], [30, 24, 22], [206, 196, 186]);
// Wool needs visible fibre, not a pale wash. At 235 mean brightness with
// almost no variation it was the single worst offender for reading as blank
// white next to a resource pack.
ENTITY_ART.wool = (t) => {
  t.fill([226, 226, 222], 7);
  t.grain(16, 12);                       // fine fleece tooth
  t.mottle([198, 198, 194], 0.5, 5);     // clumping
  t.mottle([246, 246, 244], 0.3, 7);     // highlights on the clumps
  t.bevel(14);
};
ENTITY_ART.sheep_face = faceOf([228, 210, 196], [34, 30, 28], null);
ENTITY_ART.sheep_leg = hide([212, 200, 190], 5);
ENTITY_ART.chicken = (t) => t.fill([244, 244, 240], 7).flecks(14, [220, 220, 214]);
ENTITY_ART.chicken_face = (t) => {
  t.fill([244, 244, 240], 5);
  t.rect(4, 5, 3, 3, [30, 26, 24]);
  t.rect(9, 5, 3, 3, [30, 26, 24]);
  t.rect(6, 1, 4, 3, [216, 62, 54]); // comb
};
ENTITY_ART.beak = hide([232, 168, 48], 6);
ENTITY_ART.bone = hide([226, 224, 208], 5);

ENTITY_ART.zombie_head = hide([84, 124, 76]);
ENTITY_ART.zombie_face = (t) => {
  t.fill([84, 124, 76], 6);
  t.rect(3, 5, 3, 3, [22, 34, 24]); // sunken eyes
  t.rect(10, 5, 3, 3, [22, 34, 24]);
  t.rect(5, 11, 6, 1, [46, 60, 42]);
  t.flecks(14, [66, 100, 60]);
};
ENTITY_ART.zombie_body = fabric([58, 108, 148]);
ENTITY_ART.zombie_legs = fabric([52, 62, 104]);

// Blaze: hot yellow core, glowing rods.
ENTITY_ART.blaze_core = (t) => t.fill([246, 190, 60], 16).flecks(26, [255, 232, 140]);
ENTITY_ART.blaze_face = (t) => {
  t.fill([246, 190, 60], 12);
  t.rect(3, 5, 3, 3, [60, 34, 8]);
  t.rect(10, 5, 3, 3, [60, 34, 8]);
  t.rect(5, 11, 6, 1, [80, 44, 10]);
};
ENTITY_ART.blaze_rod_mob = (t) => t.fill([240, 166, 40], 14).flecks(18, [255, 224, 120]);

// Enderman: near-black with lit violet eyes.
ENTITY_ART.ender_body = (t) => t.fill([18, 16, 24], 5).flecks(16, [30, 26, 40]);
ENTITY_ART.ender_face = (t) => {
  t.fill([16, 14, 22], 4);
  t.rect(2, 6, 5, 3, [206, 150, 250]);
  t.rect(9, 6, 5, 3, [206, 150, 250]);
  t.rect(3, 7, 3, 1, [246, 226, 255]);
  t.rect(10, 7, 3, 1, [246, 226, 255]);
};

// Dragon: black scales with a purple sheen.
ENTITY_ART.dragon_body = (t) => t.fill([28, 24, 36], 7).flecks(22, [52, 38, 72]);
ENTITY_ART.dragon_head = (t) => t.fill([34, 28, 44], 7).flecks(16, [60, 44, 84]);
ENTITY_ART.dragon_face = (t) => {
  t.fill([34, 28, 44], 6);
  t.rect(2, 5, 5, 3, [214, 92, 244]);
  t.rect(9, 5, 5, 3, [214, 92, 244]);
  t.rect(4, 11, 8, 2, [16, 12, 20]);
  for (let x = 4; x < 12; x += 2) t.set(x, 10, 226, 220, 232); // teeth
};
ENTITY_ART.dragon_wing = (t) => t.fill([40, 32, 56], 8).flecks(20, [66, 50, 96]);

// Player model materials.
const SKIN: RGB = [222, 174, 136];
const HAIR: RGB = [78, 50, 32];

ENTITY_ART.skin = (t) => {
  t.fill(SKIN, 9);
  t.mottle([196, 148, 112], 0.4, 6);
  t.mottle([238, 196, 162], 0.28, 9);
  t.grain(12, 16);
  t.bevel(12);
};

/** Back and sides of the head: hair over the top two-thirds. */
ENTITY_ART.hair = (t) => {
  t.fill(SKIN, 4);
  for (let x = 0; x < TILE; x++) {
    for (let y = 0; y < 11; y++) t.set(x, y, HAIR[0], HAIR[1], HAIR[2]);
  }
  t.flecks(22, [96, 64, 42]);
};

ENTITY_ART.face = (t) => {
  t.fill(SKIN, 4);

  // Hair: a fringe with a slightly ragged edge rather than a flat block.
  for (let x = 0; x < TILE; x++) {
    const depth = 4 + (x % 3 === 0 ? 1 : 0);
    for (let y = 0; y < depth; y++) t.set(x, y, HAIR[0], HAIR[1], HAIR[2]);
  }
  t.set(2, 5, ...HAIR);
  t.set(13, 5, ...HAIR);

  // Brow line grounds the eyes; without it the face reads as a blank oval.
  for (let x = 3; x < 13; x++) t.shade(x, 6, -22);

  t.rect(3, 7, 4, 2, [246, 246, 250]);   // eye whites
  t.rect(9, 7, 4, 2, [246, 246, 250]);
  t.rect(5, 7, 2, 2, [62, 96, 158]);     // irises, looking slightly inward
  t.rect(9, 7, 2, 2, [62, 96, 158]);
  t.set(5, 7, 20, 28, 48);               // pupils
  t.set(10, 7, 20, 28, 48);

  t.rect(7, 9, 2, 2, [196, 146, 112]);   // nose
  t.rect(6, 12, 4, 1, [158, 96, 84]);    // mouth
  t.set(5, 12, 176, 122, 96);
  t.set(10, 12, 176, 122, 96);
};

ENTITY_ART.shirt = (t) => {
  t.fill([58, 122, 168], 6);
  // Collar and a centre seam so the torso is not a flat rectangle.
  for (let x = 0; x < TILE; x++) t.shade(x, 0, 20);
  for (let x = 5; x < 11; x++) t.set(x, 1, 40, 92, 132);
  for (let y = 2; y < TILE; y++) t.shade(8, y, -14);
  t.flecks(12, [46, 104, 146]);
};

ENTITY_ART.sleeve = fabric([52, 110, 152]);

ENTITY_ART.pants = (t) => {
  fabric([56, 60, 96])(t);
  for (let x = 0; x < TILE; x++) t.shade(x, 0, 16); // waistband
  for (let y = 2; y < TILE; y++) t.shade(3, y, -12); // seams
  for (let y = 2; y < TILE; y++) t.shade(12, y, -12);
};

ENTITY_ART.boots = (t) => {
  t.fill([64, 48, 40], 11);
  t.mottle([44, 33, 27], 0.45, 5);
  t.mottle([88, 68, 56], 0.3, 8);
  t.grain(13, 14);
  for (let x = 0; x < TILE; x++) t.shade(x, TILE - 1, -22); // sole
  t.bevel(13);
};

// Vehicle materials. Painted panels get a subtle top-lit sheen so a car body
// doesn't read as a flat slab of colour.
function panel(base: RGB, sheen: number) {
  return (t: Tile) => {
    t.fill(base, 5);
    for (let x = 0; x < TILE; x++) {
      for (let y = 0; y < 4; y++) t.shade(x, y, sheen - y * 3);
    }
    for (let x = 0; x < TILE; x++) t.shade(x, TILE - 1, -14);
  };
}

ENTITY_ART.paint_red = panel([176, 46, 42], 26);
ENTITY_ART.paint_dark = panel([44, 46, 54], 20);
// Chrome was a 207-brightness flat panel: effectively a white slab. Brushed
// metal reads as metal because of the streaks, not the brightness.
ENTITY_ART.chrome = (t) => {
  t.fill([174, 179, 190], 6);
  t.streaks(20);                      // brushed metal, horizontal
  t.mottle([214, 221, 233], 0.35, 3); // broad highlight
  t.mottle([132, 137, 150], 0.3, 5);  // and the shadowed side of it
  t.bevel(26);
};
ENTITY_ART.tire = (t) => {
  t.fill([32, 32, 36], 5);
  // Tread blocks around the edge, hub in the middle.
  for (let i = 0; i < TILE; i += 3) {
    t.rect(i, 0, 2, 2, [20, 20, 22]);
    t.rect(i, TILE - 2, 2, 2, [20, 20, 22]);
  }
  t.disc(7.5, 7.5, 4, [150, 152, 158], 8);
  t.disc(7.5, 7.5, 1.6, [92, 94, 100], 6);
};
ENTITY_ART.headlight = (t) => {
  t.fill([60, 62, 70], 6);
  t.disc(7.5, 7.5, 5, [252, 244, 200], 10);
  t.disc(7.5, 7.5, 2.4, [255, 255, 240], 4);
};
ENTITY_ART.taillight = (t) => {
  t.fill([60, 40, 42], 6);
  t.disc(7.5, 7.5, 4.6, [226, 54, 44], 12);
};
ENTITY_ART.rotor = (t) => {
  t.fill([56, 58, 66], 6);
  for (let x = 0; x < TILE; x++) t.shade(x, 7, 26);
};

ENTITY_ART.hand = (t) => t.fill([214, 162, 124], 8).flecks(10, [190, 138, 102]);

/**
 * Ten mining-progress overlays, drawn on transparent and blended over the
 * targeted block's faces.
 *
 * All ten stages share one seeded draw order, so stage 5 is exactly stage 4
 * plus more cracks rather than an unrelated pattern -- the same block reads
 * as progressively more broken instead of flickering between random shapes.
 */
function crackTile(stage: number) {
  return (t: Tile) => {
    const rng = mulberry32(0x9e3779b1);
    const dark: RGB = [16, 16, 16];
    const segments = 3 + stage * 3;
    let x = 8;
    let y = 8;
    for (let i = 0; i < segments; i++) {
      const angle = rng() * Math.PI * 2;
      const len = 2 + rng() * 3.5;
      const nx = Math.max(1, Math.min(15, x + Math.cos(angle) * len));
      const ny = Math.max(1, Math.min(15, y + Math.sin(angle) * len));
      t.line(x, y, nx, ny, dark, 1);
      // Every third segment branches back out from the centre, so cracks
      // spread across the whole face instead of one long wandering line.
      if (i % 3 === 2) { x = 8; y = 8; } else { x = nx; y = ny; }
    }
  };
}
for (let stage = 0; stage < 10; stage++) {
  ENTITY_ART[`crack_${stage}`] = crackTile(stage);
}
