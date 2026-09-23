/**
 * Equipment icons: tools, weapons and armour.
 *
 * Split from art/items.ts because these share one problem the rest do not:
 * every one of them is "a shape on a stick", and at icon size the head's
 * silhouette is the only thing telling a pickaxe from an axe from a hammer,
 * or a sword from a hoe. Each kind has to be recognisable from its outline
 * alone, and each tier from its colour.
 */

import { type RGB, type Recipe, Tile } from '../tile.js';

const HANDLE: RGB = [122, 88, 48];

/**
 * Shared silhouette for every tool, coloured by tier.
 *
 * The heads are deliberately chunky and very different in outline: at the
 * ~34px these are drawn at in the UI, a subtle head shape is unreadable and
 * every tool looks like the same brown stick.
 */
function toolTile(kind: 'pickaxe' | 'axe' | 'shovel', head: RGB) {
  const dark: RGB = [head[0] * 0.7, head[1] * 0.7, head[2] * 0.7];
  const lit: RGB = [
    Math.min(255, head[0] * 1.18 + 14),
    Math.min(255, head[1] * 1.18 + 14),
    Math.min(255, head[2] * 1.18 + 14),
  ];
  return (t: Tile) => {
    // Proportions matter more than any detail here. A real tool icon is
    // mostly *handle*: a long shaft running corner to corner, with a
    // comparatively small head perched on its top end. Earlier passes had a
    // stubby half-length shaft under an oversized slab of a head, which is
    // why they read as "a shape on a stick" rather than as a tool.
    t.line(1, 14, 11, 4, HANDLE, 2);
    t.line(1, 15, 10, 6, [92, 64, 34], 1);  // shaft shading
    t.rect(0, 13, 3, 3, HANDLE, 6);         // butt cap
    t.rect(0, 15, 3, 1, [80, 54, 28]);

    if (kind === 'pickaxe') {
      // An asymmetric crescent sweeping over the top, which the shaft passes
      // *through* near its right end -- not a symmetric bar sitting on top
      // of it. Stamped along an arc so the curve is a real curve.
      for (let a = 202; a <= 338; a += 4) {
        const r = (a * Math.PI) / 180;
        const cx = 8.5 + Math.cos(r) * 6.0;
        const cy = 9.2 + Math.sin(r) * 6.0;
        t.rect(Math.round(cx), Math.round(cy), 2, 2, head, 4);
      }
      // Tips, darkened so the ends read as points rather than stubs.
      t.rect(2, 6, 2, 2, dark, 3);
      t.rect(13, 6, 2, 2, dark, 3);
      t.rect(6, 2, 4, 1, lit);                // lit crown
    } else if (kind === 'axe') {
      // One solid head: a blade tapering from a flared cutting edge on the
      // left back to a squared poll that sits over the shaft's top. A poll
      // drawn as a separate disc left a gap the shaft showed through, which
      // turned the whole head into a spike.
      t.rect(5, 1, 6, 2, head, 6);            // top
      t.rect(4, 3, 7, 3, head, 6);            // widest, at the cutting edge
      t.rect(5, 6, 5, 2, head, 6);            // taper
      t.rect(6, 8, 3, 1, head, 5);
      t.rect(11, 3, 2, 3, head, 5);           // poll, over the shaft top
      t.rect(4, 3, 1, 3, lit);                // lit cutting edge
      t.rect(5, 1, 3, 1, lit);
      t.rect(11, 5, 2, 1, dark);              // shadow beneath the poll
    } else {
      // A small rounded spade on the shaft's top end.
      t.disc(10.6, 4.4, 3.3, head, 8);
      t.rect(8, 2, 5, 4, head, 6);
      t.rect(9, 6, 3, 2, head, 5);            // socket onto the shaft
      t.rect(8, 2, 2, 3, lit);                // lit face
      t.rect(12, 4, 1, 3, dark);              // shadowed side
    }

    // Crisp banding plus a dark silhouette edge. The highlight is gentler
    // than the default: iron and diamond are already pale, and a +34 step
    // pushed their whole head to near-white, losing the material colour.
    t.celShade(18, -26);
    t.outline();
  };
}

const TOOL_TIERS: Array<[string, RGB]> = [
  ['wood', [158, 122, 72]],
  ['stone', [136, 136, 136]],
  ['iron', [214, 214, 218]],
  ['diamond', [104, 226, 220]],
];

export const EQUIPMENT_ART: Record<string, Recipe> = {
  // A power drill in profile: body, pistol grip, chuck, and a bit that
  // actually tapers to a point.
  drill: (t) => {
    t.rect(1, 5, 8, 6, [104, 104, 110], 5);     // motor housing
    t.rect(2, 4, 5, 1, [140, 140, 146], 4);     // lit top edge
    t.rect(3, 11, 4, 4, [66, 60, 56], 4);       // grip
    t.rect(3, 15, 4, 1, [46, 42, 40], 3);
    t.rect(9, 6, 3, 4, [188, 188, 194], 5);     // chuck
    t.rect(12, 7, 2, 2, [104, 226, 226], 6);    // bit
    t.rect(14, 7, 1, 2, [180, 246, 246], 4);    // its point
    t.celShade(20, -18);
    t.outline();
  },
  flint_steel: (t) => {
    t.rect(2, 5, 3, 8, [188, 188, 194], 6);   // striker back
    t.rect(2, 4, 6, 2, [188, 188, 194], 6);   // upper arm
    t.rect(2, 12, 6, 2, [160, 160, 166], 6);  // lower arm
    t.rect(6, 6, 2, 2, [140, 140, 146], 4);
    t.rect(9, 9, 5, 4, [78, 72, 68], 6);      // flint
    t.rect(10, 8, 3, 1, [104, 96, 90], 4);
    t.rect(9, 6, 2, 2, [250, 214, 120], 8);   // sparks
    t.rect(12, 5, 2, 2, [252, 238, 178], 6);
    t.celShade(18, -16);
    t.outline();
  },
};

for (const [tier, head] of TOOL_TIERS) {
  EQUIPMENT_ART[`pickaxe_${tier}`] = toolTile('pickaxe', head);
  EQUIPMENT_ART[`axe_${tier}`] = toolTile('axe', head);
  EQUIPMENT_ART[`shovel_${tier}`] = toolTile('shovel', head);
}

/** Armour silhouettes, one shape per slot, tinted per material. */
function armorTile(slot: 'head' | 'chest' | 'legs' | 'feet', tint: RGB) {
  const dark: RGB = [tint[0] * 0.72, tint[1] * 0.72, tint[2] * 0.72];
  // Plate needs a highlight and a shadow, or it reads as a coloured blob at
  // icon size -- iron leggings measured 216 brightness with almost no
  // variation, which is indistinguishable from a white rectangle.
  const lit: RGB = [
    Math.min(255, tint[0] * 1.2), Math.min(255, tint[1] * 1.2), Math.min(255, tint[2] * 1.2),
  ];
  const shadow: RGB = [tint[0] * 0.72, tint[1] * 0.72, tint[2] * 0.72];

  return (t: Tile) => {
    if (slot === 'head') {
      // A helmet: domed crown, a dark visor slot, and cheek guards down
      // either side. The slot is what stops it reading as a bucket.
      t.rect(4, 1, 8, 2, tint, 5);
      t.rect(2, 3, 12, 4, tint, 6);        // crown
      t.rect(2, 7, 3, 5, tint, 6);         // cheek guards
      t.rect(11, 7, 3, 5, tint, 6);
      t.rect(5, 7, 6, 2, dark, 3);         // visor slot
      t.rect(5, 9, 6, 3, tint, 5);         // nose guard below the slot
      t.rect(7, 9, 2, 3, dark, 3);
    } else if (slot === 'chest') {
      // Pauldrons standing proud of a torso, with a neck notch between them.
      t.rect(1, 3, 4, 4, tint, 6);         // left pauldron
      t.rect(11, 3, 4, 4, tint, 6);        // right pauldron
      t.rect(5, 4, 6, 2, tint, 5);         // collar
      t.rect(6, 2, 4, 2, dark, 3);         // neck opening
      t.rect(3, 6, 10, 7, tint, 6);        // torso
      t.rect(6, 8, 4, 4, dark, 3);         // breastplate seam
      t.rect(4, 13, 8, 1, dark, 3);        // hem
    } else if (slot === 'legs') {
      t.rect(3, 2, 10, 3, tint, 6);        // belt
      t.rect(3, 5, 4, 9, tint, 6);         // left leg
      t.rect(9, 5, 4, 9, tint, 6);         // right leg
      t.rect(7, 5, 2, 5, dark, 3);         // the gap between them
      t.rect(4, 3, 8, 1, dark, 3);         // belt line
    } else {
      // Two boots seen from the side: an ankle cuff over a toe that sticks
      // forward, which is the shape a plain rectangle was missing.
      t.rect(2, 5, 4, 6, tint, 6);         // left ankle
      t.rect(1, 11, 6, 3, tint, 6);        // left foot
      t.rect(10, 5, 4, 6, tint, 6);        // right ankle
      t.rect(9, 11, 6, 3, tint, 6);        // right foot
      t.rect(1, 13, 6, 1, dark, 3);        // soles
      t.rect(9, 13, 6, 1, dark, 3);
    }

    // Rake a highlight across the upper-left of the plate and a shadow along
    // the lower-right, so the shape reads as metal rather than a silhouette.
    t.shadeShape(lit, shadow, 0.42);
    t.grain(9, 10);
    t.outline();
  };
}

const ARMOR_MATERIALS: Array<[string, RGB]> = [
  ['leather', [148, 104, 66]],
  ['iron', [214, 214, 220]],
  ['diamond', [104, 226, 220]],
];

for (const [material, tint] of ARMOR_MATERIALS) {
  for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
    EQUIPMENT_ART[`armor_${slot}_${material}`] = armorTile(slot, tint);
  }
}

/** Swords: a blade up the diagonal with a crossguard and grip. */
function swordTile(blade: RGB) {
  const dark: RGB = [blade[0] * 0.72, blade[1] * 0.72, blade[2] * 0.72];
  const lit: RGB = [
    Math.min(255, blade[0] * 1.2 + 16),
    Math.min(255, blade[1] * 1.2 + 16),
    Math.min(255, blade[2] * 1.2 + 16),
  ];
  return (t: Tile) => {
    // A 3-unit blade rather than a hairline. At icon size a 1px diagonal is
    // nearly invisible, which is why every tier looked the same: the only
    // thing separating wood from diamond was a colour too thin to read.
    // Like the tools, this is mostly *blade*: a long diagonal running almost
    // corner to corner, with the hilt occupying only the bottom-left eighth.
    t.line(4, 12, 12, 4, blade, 4);
    t.line(4, 14, 11, 7, dark, 1);       // shadowed lower bevel
    t.line(5, 11, 12, 4, lit, 1);        // lit upper bevel
    t.rect(11, 2, 3, 3, blade);          // tip, kept clear of the corner
    t.rect(13, 1, 2, 2, lit);

    // A guard crossing the blade at right angles, and a round pommel at the
    // very corner -- the two things that stop a diagonal reading as a stick.
    // Kept thin: at two units deep it was a slab wider than the blade.
    const guard: RGB = [92, 64, 34];
    for (let i = -3; i <= 3; i++) {
      t.rect(5 + i, 11 + i, 2, 1, i < 0 ? [112, 80, 44] : guard);
    }
    t.line(1, 15, 4, 12, [64, 44, 24], 2);   // grip
    t.disc(1.6, 14.6, 1.7, [48, 34, 18], 4); // pommel

    t.celShade();
    t.outline();
  };
}

for (const [tier, head] of TOOL_TIERS) {
  EQUIPMENT_ART[`sword_${tier}`] = swordTile(head);
}
