/**
 * Item icons: tools, weapons, armour, food, materials, vehicles.
 *
 * An icon is the only thing telling a player what an item is before they
 * hover it, so each one has to read as its name from silhouette alone.
 */

import { type RGB, type Recipe, Tile } from '../tile.js';

const HANDLE: RGB = [122, 88, 48];



export const ITEM_ART: Record<string, Recipe> = {
  stick: (t) => t.line(5, 12, 10, 3, HANDLE, 2).outline(),
  // An irregular lump, not a circle: coal and diamond were both plain discs,
  // so the two shared a silhouette exactly and could only be told apart by
  // colour. Near-black also means a flat +/- shade delta caps out fast, so a
  // bright facet does the work the shading cannot.
  coal: (t) => t.rect(4, 4, 7, 4, [38, 38, 40], 12)
    .rect(3, 6, 9, 5, [38, 38, 40], 12)
    .rect(5, 10, 6, 3, [34, 34, 36], 10)
    .rect(2, 8, 3, 3, [42, 42, 44], 10)
    .rect(11, 5, 3, 4, [42, 42, 44], 10)
    .rect(6, 5, 2, 2, [124, 124, 130])
    .celShade(20, -20).outline(),
  iron_ingot: (t) => t.rect(3, 6, 10, 4, [214, 214, 218], 10).rect(4, 5, 8, 1, [236, 236, 240])
    .celShade(24, -20).outline(),
  gold_ingot: (t) => t.rect(3, 6, 10, 4, [238, 200, 80], 10).rect(4, 5, 8, 1, [252, 226, 130])
    .celShade(24, -20).outline(),
  // A cut gem: flat table on top, widening to a girdle, then tapering to a
  // point. The facets are what make it read as a gem rather than a blue ball.
  diamond: (t) => {
    const gem: RGB = [104, 226, 226];
    t.rect(5, 2, 6, 2, gem, 8);          // table
    t.rect(3, 4, 10, 2, gem, 10);        // crown
    t.rect(2, 6, 12, 2, gem, 10);        // girdle, the widest point
    t.rect(3, 8, 10, 2, gem, 10);        // pavilion
    t.rect(5, 10, 6, 2, gem, 10);
    t.rect(6, 12, 4, 1, gem, 8);
    t.rect(7, 13, 2, 1, gem, 6);         // cutlet
    t.rect(5, 4, 3, 2, [186, 248, 248]); // facet highlight
    t.rect(9, 8, 3, 2, [64, 168, 176]);  // facet shadow
    t.celShade(26, -20);
    t.outline();
  },

  boat: (t) => {
    // Seen from the side: a shallow hull with a raised prow, an oar, and the
    // waterline it sits at.
    t.rect(2, 8, 12, 3, [150, 112, 64], 7);       // hull
    t.rect(1, 7, 3, 2, [168, 128, 76], 6);        // prow
    t.rect(13, 7, 2, 2, [150, 112, 64], 6);       // stern
    t.rect(3, 7, 10, 1, [186, 148, 92], 5);       // gunwale
    t.rect(5, 6, 5, 1, [120, 86, 48], 4);         // bench
    t.line(6, 5, 12, 2, [140, 100, 56], 2);       // oar
    t.rect(2, 11, 12, 1, [72, 128, 196], 6);      // waterline
    t.celShade(20, -18);
    t.outline();
  },
  truck: (t) => {
    t.rect(1, 7, 14, 4, [60, 62, 70], 6);         // chassis + bed
    t.rect(9, 3, 5, 4, [80, 84, 94], 6);          // cab
    t.rect(10, 4, 3, 2, [150, 206, 232], 6);      // windscreen
    t.rect(1, 5, 7, 2, [96, 100, 110], 5);        // bed walls
    t.rect(14, 7, 1, 2, [232, 216, 150], 4);      // headlight
    t.rect(2, 11, 3, 3, [34, 34, 38], 3);         // wheels
    t.rect(10, 11, 3, 3, [34, 34, 38], 3);
    t.celShade(20, -18);
    t.outline();
  },
  skateboard: (t) => {
    t.rect(2, 6, 12, 3, [168, 132, 78], 8);     // deck
    t.rect(1, 5, 2, 2, [168, 132, 78], 6);      // upturned nose
    t.rect(13, 5, 2, 2, [168, 132, 78], 6);     // and tail
    t.rect(3, 9, 2, 2, [120, 120, 126], 4);     // trucks
    t.rect(11, 9, 2, 2, [120, 120, 126], 4);
    t.rect(3, 11, 3, 3, [40, 40, 44], 4);       // wheels
    t.rect(10, 11, 3, 3, [40, 40, 44], 4);
    t.celShade(20, -18);
    t.outline();
  },
  car: (t) => {
    t.rect(1, 8, 14, 4, [168, 62, 52], 7);      // body
    t.rect(4, 4, 8, 4, [150, 74, 60], 7);       // cabin
    t.rect(5, 5, 6, 2, [150, 206, 232], 6);     // glass
    t.rect(13, 8, 2, 2, [246, 226, 150], 4);    // headlight
    t.rect(2, 12, 3, 3, [36, 36, 40], 3);       // wheels
    t.rect(11, 12, 3, 3, [36, 36, 40], 3);
    t.celShade(20, -18);
    t.outline();
  },
  // Seen from above, which is the only view where a plane's wings, tail and
  // fuselage all read at once.
  plane: (t) => {
    t.rect(7, 1, 3, 13, [214, 214, 220], 6);    // fuselage
    t.rect(7, 0, 3, 2, [176, 176, 182], 5);     // nose
    t.rect(1, 6, 15, 3, [198, 198, 204], 6);    // main wing
    t.rect(4, 12, 9, 2, [198, 198, 204], 5);    // tailplane
    t.rect(7, 3, 3, 2, [150, 206, 232], 5);     // canopy
    t.rect(0, 6, 2, 3, [166, 66, 58], 4);       // wingtip flashes
    t.rect(14, 6, 2, 3, [166, 66, 58], 4);
    t.celShade(20, -18);
    t.outline();
  },
  helicopter: (t) => {
    t.rect(1, 2, 15, 1, [222, 222, 228], 3);    // main rotor
    t.rect(7, 3, 2, 3, [130, 130, 136], 3);     // mast
    t.rect(2, 6, 8, 6, [214, 214, 220], 6);     // cabin
    t.rect(3, 7, 4, 3, [150, 206, 232], 6);     // glass
    t.rect(10, 7, 5, 3, [190, 190, 196], 5);    // tail boom
    t.rect(14, 4, 1, 5, [150, 150, 156], 3);    // tail rotor
    t.rect(2, 13, 9, 1, [130, 130, 136], 3);    // skids
    t.rect(3, 12, 1, 2, [130, 130, 136], 3);
    t.rect(9, 12, 1, 2, [130, 130, 136], 3);
    t.celShade(20, -18);
    t.outline();
  },

  blaze_rod: (t) => {
    t.line(5, 13, 11, 3, [214, 152, 28], 4);      // the rod
    t.line(6, 12, 10, 4, [252, 214, 96], 2);      // glowing core
    t.rect(10, 1, 3, 3, [252, 232, 150], 6);      // hot tip
    t.rect(4, 13, 3, 3, [176, 120, 20], 5);       // cool end
    t.celShade(18, -16);
    t.outline();
  },
  blaze_powder: (t) => t.disc(8, 8, 4.5, [236, 158, 46], 20).celShade(20, -18).outline(),
  ender_pearl: (t) => t.disc(8, 8, 5, [42, 132, 122], 18).disc(7, 7, 2, [150, 236, 220], 10)
    .celShade(20, -18).outline(),
  eye_of_ender: (t) => t.disc(8, 8, 5, [42, 132, 122], 12).disc(8, 8, 2.4, [220, 240, 160], 8)
    .celShade(20, -18).outline(),
};



// A hide, not a picture frame: an irregular piece with the corners knocked
// off, so it reads as a cut skin rather than a bordered square.
ITEM_ART.leather = (t) => {
  t.rect(2, 4, 12, 8, [150, 106, 68], 8);
  t.rect(3, 3, 9, 1, [150, 106, 68], 6);
  t.rect(4, 12, 8, 1, [150, 106, 68], 6);
  t.rect(2, 4, 2, 1, [0, 0, 0], 0);          // nicked corners
  t.set(2, 4, 0, 0, 0, 0);
  t.set(13, 11, 0, 0, 0, 0);
  t.set(13, 4, 0, 0, 0, 0);
  t.set(2, 11, 0, 0, 0, 0);
  t.rect(5, 6, 4, 3, [128, 88, 54], 5);      // worn patch
  t.celShade(18, -16);
  t.outline([96, 66, 40]);
};

// A quill: a dark shaft with barbs fanning off it, rather than the bare
// diagonal line it used to be.
ITEM_ART.feather = (t) => {
  const vane: RGB = [244, 244, 248];
  const shade: RGB = [206, 206, 214];
  for (let i = 0; i < 9; i++) {
    const x = 4 + i;
    const y = 12 - i;
    t.rect(x - 2, y, 3, 1, i % 2 === 0 ? vane : shade);   // barbs
    if (i > 1) t.rect(x - 3, y + 1, 2, 1, shade);
  }
  t.line(3, 14, 12, 3, [176, 176, 186], 1);               // shaft
  t.rect(2, 14, 2, 2, [140, 140, 150], 3);                // calamus
  t.celShade(16, -14);
  t.outline([120, 120, 132]);
};


/*
 * Food.
 *
 * Every food used to be the same disc in a different colour, so a hotbar of
 * eight of them was eight identical circles. Each cut now gets its own
 * silhouette instead -- a chop has a bone, a drumstick has a handle, a steak
 * is a slab -- because at 16px the outline is the only thing distinguishing
 * them, not the tint.
 */

/**
 * A chop: rounded meat with a bone running into it.
 *
 * The bone has to overlap the meat, not sit beside it -- drawn apart it
 * reads as a second unrelated object floating in the corner rather than as
 * part of the cut.
 */
function chopTile(meat: RGB, fat: RGB) {
  return (t: Tile) => {
    t.disc(9, 9, 4.8, meat, 12);
    t.rect(5, 6, 6, 7, meat, 10);      // body, reaching up to the bone
    t.rect(4, 3, 4, 5, fat, 6);        // bone, overlapping the meat below it
    t.rect(5, 7, 3, 2, fat, 5);        // where it enters the meat
    t.disc(10, 10, 1.8, fat, 8);       // marbling
    t.celShade(22, -20);
    t.outline();
  };
}

/** A drumstick: a round meat end on a bone handle. */
function drumstickTile(meat: RGB, bone: RGB) {
  return (t: Tile) => {
    t.disc(10, 6, 4.2, meat, 12);
    t.rect(7, 8, 3, 3, meat, 10);
    t.line(8, 10, 4, 14, bone, 3);     // the bone running down-left
    t.rect(2, 12, 3, 3, bone, 6);      // knuckle
    t.celShade(22, -20);
    t.outline();
  };
}

/** A steak: a thick rectangular slab with marbling. */
function steakTile(meat: RGB, fat: RGB) {
  return (t: Tile) => {
    t.rect(2, 5, 12, 7, meat, 12);
    t.rect(3, 4, 10, 1, meat, 8);
    t.rect(3, 12, 10, 1, meat, 8);
    t.rect(4, 7, 3, 2, fat, 6);        // marbling streaks
    t.rect(9, 9, 3, 2, fat, 6);
    t.celShade(22, -20);
    t.outline();
  };
}

/**
 * A rack of ribs: a wedge that tapers, with bones jutting from its edge.
 *
 * Deliberately not another rectangle -- beef is already a slab, and two
 * rectangles differing only in tint are two items nobody can tell apart in
 * a hotbar.
 */
function ribTile(meat: RGB, fat: RGB) {
  return (t: Tile) => {
    // A pronounced triangular taper: narrow at the top, wide at the bottom.
    // A gentle taper still reads as the same rectangle beef already uses.
    t.rect(6, 2, 4, 2, meat, 9);
    t.rect(5, 4, 6, 2, meat, 10);
    t.rect(4, 6, 8, 2, meat, 11);
    t.rect(2, 8, 11, 3, meat, 12);
    t.rect(1, 11, 13, 3, meat, 12);
    // Bones poking out along the right, drawn last so they stay visible.
    for (let i = 0; i < 3; i++) t.rect(12, 3 + i * 3, 3, 1, fat, 4);
    t.rect(3, 11, 3, 2, fat, 5);        // marbling
    t.celShade(22, -20);
    t.outline();
  };
}

ITEM_ART.raw_porkchop = chopTile([236, 148, 148], [248, 214, 206]);
ITEM_ART.cooked_porkchop = chopTile([176, 110, 66], [226, 186, 134]);
ITEM_ART.raw_beef = steakTile([196, 82, 78], [232, 162, 154]);
ITEM_ART.steak = steakTile([138, 78, 46], [192, 136, 86]);
ITEM_ART.raw_mutton = ribTile([222, 128, 122], [246, 202, 194]);
ITEM_ART.cooked_mutton = ribTile([164, 100, 62], [214, 166, 112]);
ITEM_ART.raw_chicken = drumstickTile([242, 190, 166], [250, 232, 214]);
ITEM_ART.cooked_chicken = drumstickTile([198, 146, 86], [238, 210, 158]);
