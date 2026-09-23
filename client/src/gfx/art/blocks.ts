/**
 * Block textures: terrain, building materials, machines, and the other
 * dimensions.
 */

import { TILE, type RGB, type Recipe, Tile } from '../tile.js';

const STONE: RGB = [128, 128, 128];

/** The belt surface every conveyor variant shares. */
function beltBase(t: Tile): Tile {
  t.fill([64, 64, 70], 5).patches(8, [52, 52, 58], 6, 3).posterize(9);
  for (let y = 1; y < TILE; y += 4) t.blot(0, y, TILE, 2, [92, 92, 100], 4);
  for (let y = 2; y < TILE; y += 4) t.blot(0, y, TILE, 1, [40, 40, 46], 3);
  return t.border([36, 36, 42]);
}

/**
 * A conveyor top with an arrow pointing the way it carries.
 *
 * Direction lives in the block id, so the only way a player can tell which
 * way a belt runs is by looking at it -- the arrow is load-bearing, not
 * decoration.
 */
function conveyorTile(dx: number, dz: number) {
  return (t: Tile) => {
    beltBase(t);
    const gold: RGB = [206, 182, 62];
    const dark: RGB = [70, 60, 18];
    // Draw the arrow pointing +Y (south//down-screen), then rotate the
    // finished shape into place, so all four share one definition.
    const shaft: Array<[number, number, number, number]> = [
      [7, 3, 2, 8],        // stem
      [5, 9, 6, 2],        // head shoulders
      [6, 11, 4, 1],
      [7, 12, 2, 1],       // tip
    ];
    const put = (x: number, y: number, w: number, h: number, c: RGB) => {
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          // Rotate about the tile centre to match (dx, dz).
          const cx = xx - 7.5;
          const cy = yy - 7.5;
          // The base arrow points +Y in tile space, which on a top face is
          // +Z, i.e. south. Rotate from there.
          let rx = cx;
          let ry = cy;
          if (dx === 1 && dz === 0) { rx = cy; ry = -cx; }         // east: +X
          else if (dx === 0 && dz === -1) { rx = -cx; ry = -cy; }  // north: -Z
          else if (dx === -1 && dz === 0) { rx = -cy; ry = cx; }   // west: -X
          t.set(Math.round(rx + 7.5), Math.round(ry + 7.5), c[0], c[1], c[2]);
        }
      }
    };
    for (const [x, y, w, h] of shaft) put(x + 1, y + 1, w, h, dark);
    for (const [x, y, w, h] of shaft) put(x, y, w, h, gold);
  };
}

/** The stone every ore is embedded in, kept in one place so they match. */
function stoneBase(t: Tile): Tile {
  return t.fill(STONE, 4)
    .patches(14, [108, 108, 111], 4, 3)
    .patches(10, [146, 146, 149], 4, 3);
}

export const BLOCK_ART: Record<string, Recipe> = {
  grass_top: (t) => t.fill([106, 158, 64], 6)
    .patches(20, [80, 126, 46], 6, 3)
    .patches(14, [132, 186, 84], 6, 2)
    .patches(7, [62, 102, 36], 5, 2)
    .posterize(12),
  grass_side: (t) => t.fill([134, 96, 67], 9)
    .patches(16, [110, 78, 52], 10, 3)
    .patches(10, [152, 112, 80], 10, 2)
    .posterize(9)
    .fringe([106, 158, 64]),
  dirt: (t) => t.fill([134, 96, 67], 9)
    .patches(20, [110, 78, 52], 10, 3)
    .patches(12, [152, 112, 80], 10, 2)
    .posterize(9),
  // Stone is the most repeated surface in the game, so it has to hold up
  // both close and at distance: broad tonal patches read from far off, a
  // few dark pits give it something to catch the eye up close.
  //
  // Posterize steps have to be chosen against the material's own tonal
  // range, not picked by habit. Stone spans about 100-155, and at 5 steps
  // every band is 64 wide -- the whole range landed in one band and came
  // out flatter than the version this replaced. Subtle materials need finer
  // steps to stay quantised without being erased.
  stone: (t) => t.fill([124, 124, 127], 4)
    .patches(18, [100, 100, 103], 4, 3)
    .patches(13, [152, 152, 155], 4, 3)
    .patches(7, [86, 86, 89], 4, 2)
    .posterize(9),
  // Distinct rounded stones with dark gaps between them -- the thing that
  // separates cobble from plain stone at a glance.
  cobble: (t) => {
    t.fill([88, 88, 90], 5);                       // mortar showing through
    t.patches(13, [132, 132, 136], 12, 4);          // the stones themselves
    t.patches(9, [108, 108, 112], 10, 3);
    t.patches(7, [152, 152, 156], 8, 2);            // lit tops
    t.posterize(9);
  },
  sand: (t) => t.fill([222, 210, 162], 7)
    .patches(18, [206, 193, 144], 6, 2)
    .patches(10, [236, 226, 184], 6, 2)
    .posterize(4),
  gravel: (t) => {
    t.fill([116, 110, 106], 6);
    t.patches(16, [140, 134, 128], 10, 3);
    t.patches(12, [92, 88, 84], 10, 2);
    t.patches(8, [162, 156, 150], 8, 2);
    t.posterize(5);
  },
  bedrock: (t) => {
    t.fill([74, 74, 78], 4);
    t.patches(9, [44, 44, 48], 5, 4);
    t.patches(7, [108, 108, 114], 5, 4);
    t.patches(4, [26, 26, 30], 4, 3);
    t.posterize(8);
  },
  log_side: (t) => t.fill([112, 86, 52], 4)
    .patches(12, [84, 62, 36], 4, 2)
    .patches(8, [140, 110, 70], 4, 2)
    .woodGrain(0.45, -22)
    .posterize(10),
  // Concentric rings drawn as explicit alternating bands. The old smooth
  // radial gradient beat against the pixel grid into a plaid moire, and
  // posterising it afterwards only quantised the moire.
  log_top: (t) => {
    t.fill([150, 118, 72], 5);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        const band = Math.floor(d / 1.6);
        const tone: RGB = band % 2 === 0 ? [166, 132, 84] : [128, 100, 60];
        const j = (t.rng() * 2 - 1) * 5;
        t.set(x, y, tone[0] + j, tone[1] + j, tone[2] + j);
      }
    }
    t.blot(7, 7, 2, 2, [104, 80, 48], 4);  // heartwood
    t.border([120, 94, 56]);               // bark edge
  },
  // Leaves need gaps to read as foliage rather than a green wall; the dark
  // patches stand in for the shadowed depth between them.
  leaves: (t) => t.fill([66, 122, 48], 10)
    .patches(24, [44, 88, 34], 12, 3)
    .patches(16, [88, 148, 62], 12, 2)
    .patches(8, [30, 62, 24], 8, 2)
    .posterize(5),
  planks: (t) => {
    t.fill([172, 136, 82], 6);
    // Per-board tone variation, so the boards read as separate pieces of
    // wood rather than one sheet with lines scored across it.
    for (let board = 0; board < 4; board++) {
      const d = [0, -14, 8, -6][board];
      t.blot(0, board * 4, TILE, 4, [172 + d, 136 + d, 82 + d], 5);
    }
    t.planks(-34);
    t.posterize(9);
  },
  brick: (t) => t.fill([150, 74, 60], 7).courses([176, 172, 166]).posterize(5),
  glass: (t) => {
    // Mostly empty, with a frame and a diagonal glint -- glass reads by its
    // edges and its highlight, not by any fill.
    t.fill([214, 236, 244], 0, 18);
    t.border([228, 242, 250], 235);
    t.line(3, 11, 10, 4, [255, 255, 255], 1);
    t.line(5, 12, 9, 8, [255, 255, 255], 1);
  },
  // Water is seen through, so it stays smooth -- chunky patches read as
  // debris floating in it rather than as a moving surface.
  water: (t) => t.fill([58, 110, 200], 5, 170)
    .patches(6, [46, 94, 186], 4, 5)
    .patches(4, [78, 130, 216], 4, 4)
    .posterize(14),
  glowstone: (t) => t.fill([196, 158, 80], 5)
    .patches(9, [230, 198, 116], 6, 3)
    .patches(6, [252, 238, 172], 5, 2)
    .patches(7, [158, 120, 54], 6, 3)
    .posterize(8),
  torch: (t) => {
    // Drawn on transparent so it reads as a torch rather than a block.
    t.rect(7, 6, 2, 10, [138, 100, 58], 6);   // stick
    t.rect(6, 3, 4, 4, [86, 74, 62], 4);      // coal head
    t.rect(6, 2, 4, 2, [252, 206, 96], 10);   // flame
    t.rect(7, 1, 2, 2, [255, 240, 170], 8);
  },

  // Every ore is the same stone base with its own vein colour, so they read
  // as the same rock with different things in it.
  coal_ore: (t) => stoneBase(t).oreVein([38, 38, 40], 4).posterize(10),
  iron_ore: (t) => stoneBase(t).oreVein([196, 152, 118], 4).posterize(10),
  gold_ore: (t) => stoneBase(t).oreVein([238, 198, 76], 4).posterize(10),
  diamond_ore: (t) => stoneBase(t).oreVein([104, 222, 222], 4).posterize(10),
  // A worked metal panel: near-flat, with a soft sheen rather than the
  // speckling that suits rock. Scattered light flecks read as dirt on it.
  iron_block: (t) => t.fill([206, 206, 212], 3)
    .patches(6, [194, 194, 200], 3, 4)
    .patches(4, [222, 222, 228], 3, 3)
    .posterize(12)
    .border([176, 176, 182]),
  quartz: (t) => t.fill([226, 222, 210], 4)
    .patches(14, [200, 195, 182], 4, 3)
    .patches(9, [246, 244, 238], 4, 2)
    .posterize(12),

  // Deliberately unlike plain planks: a dark worktop with a marked-out grid,
  // and sides showing a tool rack, so it reads at a glance.
  crafting_top: (t) => {
    t.fill([124, 92, 54], 6).patches(10, [104, 76, 44], 6, 3).posterize(4);
    const line: RGB = [56, 38, 20];
    for (let i = 0; i < TILE; i++) {
      t.set(i, 5, ...line);
      t.set(i, 10, ...line);
      t.set(5, i, ...line);
      t.set(10, i, ...line);
    }
    t.border([74, 52, 30]);
  },
  crafting_side: (t) => {
    t.fill([150, 116, 68], 6).planks(-30).posterize(4);
    t.rect(2, 2, 12, 6, [92, 66, 38], 4);       // dark tool-rack panel
    // A saw blade: a bar with teeth, which survives being 12px wide in a way
    // the old crossed hammer-and-saw lines did not.
    t.rect(3, 4, 10, 2, [198, 198, 204], 5);
    for (let x = 3; x < 13; x += 2) t.set(x, 6, 198, 198, 204);
    t.rect(3, 3, 4, 1, [140, 100, 56]);         // its handle
    t.border([74, 52, 30]);
  },
  furnace_top: (t) => t.fill([112, 112, 116], 4)
    .patches(12, [94, 94, 98], 5, 3)
    .patches(8, [134, 134, 138], 5, 3)
    .posterize(12),
  furnace_front: (t) => {
    t.fill([112, 112, 116], 4).patches(10, [94, 94, 98], 5, 3).posterize(9);
    t.rect(3, 6, 10, 7, [52, 44, 40], 4);      // firebox recess
    t.rect(4, 7, 8, 5, [30, 24, 22], 3);       // its dark interior
    t.rect(4, 10, 8, 2, [206, 108, 34], 8);    // embers glowing at the base
    t.rect(5, 11, 6, 1, [244, 176, 60], 10);
  },
  // Machines read as machines through hard geometry -- panel, rivets, a
  // direction -- rather than through a decorative repeating lattice.
  conveyor: (t) => beltBase(t),

  // Chest, collector and miner: machine faces built from hard geometry so
  // each is identifiable at a glance in a wall of similar grey boxes.
  // A ladder: two rails with rungs between them, drawn on transparent so the
  // wall behind shows through the gaps.
  ladder: (t) => {
    const wood: RGB = [148, 108, 62];
    const dark: RGB = [104, 74, 40];
    t.rect(2, 0, 2, TILE, wood, 6);          // left rail
    t.rect(12, 0, 2, TILE, wood, 6);         // right rail
    t.rect(2, 0, 1, TILE, dark, 4);          // rail shading
    t.rect(12, 0, 1, TILE, dark, 4);
    for (let y = 2; y < TILE; y += 4) {      // rungs, spaced to tile vertically
      t.rect(4, y, 8, 2, wood, 5);
      t.rect(4, y + 1, 8, 1, dark, 3);
    }
  },
  bed_top: (t) => {
    t.rect(0, 0, TILE, 5, [232, 232, 236], 6);   // pillow
    t.rect(0, 5, TILE, 11, [186, 58, 54], 7);    // blanket
    t.rect(0, 5, TILE, 1, [140, 40, 38], 4);     // fold line
    t.patches(8, [166, 46, 44], 5, 3);
    t.posterize(10);
  },
  bed_side: (t) => {
    t.rect(0, 0, TILE, 4, [186, 58, 54], 7);     // blanket edge
    t.rect(0, 4, TILE, 3, [232, 232, 236], 6);   // mattress
    t.rect(0, 7, TILE, 9, [136, 100, 58], 7);    // wooden frame
    t.rect(0, 7, TILE, 1, [98, 70, 38], 4);
    t.rect(1, 13, 3, 3, [98, 70, 38], 4);        // legs
    t.rect(12, 13, 3, 3, [98, 70, 38], 4);
    t.posterize(10);
  },
  chest_top: (t) => {
    t.fill([148, 108, 58], 5).patches(9, [124, 88, 46], 5, 3).posterize(9);
    t.border([78, 54, 28]);
    t.rect(6, 6, 4, 4, [176, 148, 62]);   // latch plate
    t.rect(7, 7, 2, 2, [92, 74, 30]);
  },
  chest_side: (t) => {
    t.fill([148, 108, 58], 5).patches(9, [124, 88, 46], 5, 3).posterize(9);
    t.border([78, 54, 28]);
    t.rect(0, 6, TILE, 2, [78, 54, 28]);  // lid seam
    t.rect(6, 5, 4, 5, [176, 148, 62]);   // clasp
    t.rect(7, 7, 2, 2, [60, 46, 20]);     // keyhole
  },
  collector_top: (t) => {
    t.fill([64, 64, 70], 5).patches(8, [52, 52, 58], 6, 3).posterize(9);
    t.border([36, 36, 42]);
    // A funnel: concentric rings stepping inward.
    t.rect(2, 2, 12, 12, [88, 88, 96]);
    t.rect(4, 4, 8, 8, [56, 56, 62]);
    t.rect(6, 6, 4, 4, [30, 30, 34]);
  },
  collector_side: (t) => {
    t.fill([64, 64, 70], 5).patches(8, [52, 52, 58], 6, 3).posterize(9);
    t.border([36, 36, 42]);
    t.rect(2, 3, 12, 3, [88, 88, 96]);    // wide mouth
    t.rect(5, 6, 6, 4, [46, 46, 52]);     // tapering
    t.rect(6, 10, 4, 4, [30, 30, 34]);    // spout
  },
  stonegen_top: (t) => {
    t.fill([74, 76, 86], 4).patches(8, [60, 62, 72], 5, 3).posterize(10);
    t.border([42, 44, 52]);
    t.disc(7.5, 7.5, 4.6, [128, 128, 132], 6);   // the cast stone forming
    t.disc(7.5, 7.5, 2.6, [96, 96, 100], 5);
    t.rect(6, 1, 4, 2, [96, 140, 200], 6);       // water inlet
    t.rect(6, 13, 4, 2, [206, 96, 40], 6);       // lava inlet
  },
  stonegen_side: (t) => {
    t.fill([74, 76, 86], 4).patches(8, [60, 62, 72], 5, 3).posterize(10);
    t.border([42, 44, 52]);
    t.rect(1, 5, 5, 6, [96, 140, 200], 6);       // water side
    t.rect(10, 5, 5, 6, [206, 96, 40], 6);       // lava side
    t.rect(6, 4, 4, 8, [128, 128, 132], 6);      // stone cast between them
    t.rect(6, 4, 4, 1, [160, 160, 164], 4);
  },
  efurnace_top: (t) => {
    t.fill([70, 74, 86], 4).patches(8, [58, 62, 72], 5, 3).posterize(10);
    t.border([40, 42, 50]);
    t.rect(3, 3, 10, 10, [44, 48, 60], 4);
    t.rect(5, 5, 6, 6, [122, 214, 234], 7);      // element glow
    t.rect(6, 6, 4, 4, [200, 244, 252], 5);
  },
  efurnace_side: (t) => {
    t.fill([70, 74, 86], 4).patches(8, [58, 62, 72], 5, 3).posterize(10);
    t.border([40, 42, 50]);
    t.rect(3, 6, 10, 7, [40, 44, 56], 4);        // chamber
    t.rect(4, 8, 8, 3, [122, 214, 234], 8);      // coils, not flame
    t.rect(4, 10, 8, 1, [86, 168, 194], 5);
    t.rect(4, 2, 8, 3, [150, 150, 158], 5);
    for (let x = 5; x < 12; x += 2) t.rect(x, 2, 1, 3, [70, 70, 76]);
  },
  sawmill_top: (t) => {
    t.fill([120, 92, 56], 5).patches(8, [100, 76, 46], 5, 3).posterize(10);
    t.border([70, 52, 30]);
    t.rect(7, 0, 2, TILE, [186, 186, 194], 5);   // the blade, edge on
    for (let y = 0; y < TILE; y += 3) t.rect(6, y, 1, 2, [220, 220, 228]);
    t.rect(2, 5, 3, 6, [150, 112, 66], 5);       // the log being cut
    t.rect(11, 5, 3, 6, [150, 112, 66], 5);
  },
  sawmill_side: (t) => {
    t.fill([120, 92, 56], 5).patches(8, [100, 76, 46], 5, 3).posterize(10);
    t.border([70, 52, 30]);
    t.disc(8, 7, 5.0, [186, 186, 194], 5);       // circular blade
    t.disc(8, 7, 3.2, [120, 92, 56], 4);
    for (let i = 0; i < 10; i++) {               // teeth
      const a = (i / 10) * Math.PI * 2;
      t.rect(Math.round(8 + Math.cos(a) * 5.2), Math.round(7 + Math.sin(a) * 5.2),
        1, 1, [232, 232, 240]);
    }
    t.rect(0, 12, TILE, 4, [96, 72, 44], 5);     // bench
  },
  compressor_top: (t) => {
    t.fill([68, 70, 80], 4).patches(8, [56, 58, 68], 5, 3).posterize(10);
    t.border([38, 40, 48]);
    t.rect(3, 3, 10, 10, [150, 150, 158], 5);    // the ram face
    t.rect(5, 5, 6, 6, [92, 94, 104], 5);
    t.rect(6, 6, 4, 4, [50, 52, 60], 4);
  },
  compressor_side: (t) => {
    t.fill([68, 70, 80], 4).patches(8, [56, 58, 68], 5, 3).posterize(10);
    t.border([38, 40, 48]);
    t.rect(4, 1, 8, 4, [150, 150, 158], 5);      // ram
    t.rect(6, 5, 4, 3, [110, 112, 122], 4);      // piston rod
    t.rect(2, 8, 12, 3, [50, 52, 60], 4);        // anvil
    t.rect(2, 11, 12, 2, [178, 150, 54], 5);     // hazard band
    for (let x = 3; x < 14; x += 3) t.rect(x, 11, 1, 2, [60, 52, 20]);
  },
  quarry_top: (t) => {
    t.fill([66, 68, 78], 4).patches(8, [54, 56, 66], 5, 3).posterize(10);
    t.border([36, 38, 46]);
    // A gantry frame, which is what a quarry reads as from above.
    t.rect(1, 1, 14, 2, [178, 150, 54], 5);
    t.rect(1, 13, 14, 2, [178, 150, 54], 5);
    t.rect(1, 1, 2, 14, [178, 150, 54], 5);
    t.rect(13, 1, 2, 14, [178, 150, 54], 5);
    t.rect(6, 6, 4, 4, [150, 150, 158], 5);      // the head
    t.rect(7, 7, 2, 2, [40, 42, 50], 3);
  },
  quarry_side: (t) => {
    t.fill([66, 68, 78], 4).patches(8, [54, 56, 66], 5, 3).posterize(10);
    t.border([36, 38, 46]);
    t.rect(1, 1, 14, 2, [178, 150, 54], 5);      // top rail
    t.rect(2, 3, 2, 10, [110, 112, 122], 4);     // legs
    t.rect(12, 3, 2, 10, [110, 112, 122], 4);
    t.rect(6, 3, 4, 7, [150, 150, 158], 5);      // drill head on its cable
    t.rect(7, 10, 2, 4, [96, 96, 104], 4);
    t.rect(7, 14, 2, 2, [60, 62, 70], 3);
  },
  waterwheel_top: (t) => {
    t.fill([132, 100, 60], 5).patches(8, [110, 82, 48], 5, 3).posterize(10);
    t.border([76, 56, 32]);
    t.rect(7, 0, 2, TILE, [150, 150, 158], 5);   // axle
    for (let y = 1; y < TILE; y += 4) t.rect(2, y, 12, 2, [150, 112, 66], 5);
  },
  waterwheel_side: (t) => {
    t.fill([96, 140, 200], 6, 200);              // water showing through
    t.disc(8, 8, 7.2, [150, 112, 66], 6);        // wheel
    t.disc(8, 8, 5.4, [96, 140, 200], 6);
    for (let i = 0; i < 8; i++) {                // paddles
      const a = (i / 8) * Math.PI * 2;
      t.rect(Math.round(8 + Math.cos(a) * 6 - 1), Math.round(8 + Math.sin(a) * 6 - 1),
        2, 2, [124, 92, 54], 5);
    }
    t.disc(8, 8, 1.8, [150, 150, 158], 4);       // hub
  },
  // Booster: a pressure vessel with a gauge, glowing when live.
  booster_top: (t) => {
    t.fill([72, 74, 84], 4).patches(8, [58, 60, 70], 5, 3).posterize(10);
    t.border([40, 42, 50]);
    t.disc(7.5, 7.5, 4.6, [128, 132, 146], 5);
    t.disc(7.5, 7.5, 3.0, [40, 44, 54], 4);
    t.disc(7.5, 7.5, 1.6, [122, 214, 234], 6);   // the nV glow
  },
  booster_side: (t) => {
    t.fill([72, 74, 84], 4).patches(8, [58, 60, 70], 5, 3).posterize(10);
    t.border([40, 42, 50]);
    t.rect(2, 4, 12, 8, [50, 54, 64], 4);        // vessel
    t.rect(3, 5, 10, 2, [122, 214, 234], 7);     // charge window
    t.rect(3, 8, 10, 1, [96, 168, 190], 5);
    t.rect(1, 6, 1, 4, [150, 150, 158], 4);      // inlet and outlet
    t.rect(14, 6, 1, 4, [150, 150, 158], 4);
    t.rect(6, 12, 4, 2, [186, 160, 52], 5);      // gauge
  },
  solar_top: (t) => {
    t.fill([28, 34, 58], 4).posterize(10);
    // A grid of dark blue cells with a lit strip along each -- the pattern
    // is what makes it read as a panel rather than a slab of glass.
    for (let y = 1; y < 15; y += 4) {
      for (let x = 1; x < 15; x += 4) {
        t.rect(x, y, 3, 3, [42, 62, 118], 6);
        t.rect(x, y, 3, 1, [78, 118, 190], 5);
      }
    }
    t.border([120, 124, 136]);
  },
  solar_side: (t) => {
    t.fill([96, 100, 112], 4).patches(8, [80, 84, 94], 5, 3).posterize(10);
    t.rect(0, 2, TILE, 3, [42, 62, 118], 5);   // the panel edge-on
    t.rect(0, 2, TILE, 1, [92, 132, 200], 4);
    t.border([56, 58, 66]);
  },
  battery_top: (t) => {
    t.fill([64, 66, 74], 4).patches(8, [52, 54, 62], 5, 3).posterize(10);
    t.border([36, 38, 44]);
    t.rect(3, 4, 4, 8, [186, 160, 52], 5);     // terminals
    t.rect(9, 4, 4, 8, [150, 150, 158], 5);
    t.rect(4, 6, 2, 4, [232, 208, 96], 4);
  },
  battery_side: (t) => {
    t.fill([64, 66, 74], 4).patches(8, [52, 54, 62], 5, 3).posterize(10);
    t.border([36, 38, 44]);
    t.rect(2, 2, 12, 10, [42, 44, 50], 4);     // cell body
    // Charge bars, the readable "this is a battery" cue.
    for (let i = 0; i < 3; i++) t.rect(4, 4 + i * 3, 8, 2, [120, 206, 96], 6);
    t.rect(6, 0, 4, 2, [186, 160, 52], 4);     // top terminal
  },
  elevator_top: (t) => {
    // Open shaft: a frame with nothing in the middle, since items pass through.
    t.rect(0, 0, TILE, 3, [104, 108, 120], 5);
    t.rect(0, 13, TILE, 3, [104, 108, 120], 5);
    t.rect(0, 0, 3, TILE, [104, 108, 120], 5);
    t.rect(13, 0, 3, TILE, [104, 108, 120], 5);
    t.rect(3, 3, 10, 10, [58, 132, 96], 40);   // the lift field
    t.border([50, 52, 60]);
  },
  elevator_side: (t) => {
    t.fill([88, 92, 102], 4).patches(8, [72, 76, 86], 5, 3).posterize(10);
    t.border([48, 50, 58]);
    // Upward chevrons, so the direction of travel is obvious.
    for (let y = 1; y < 15; y += 5) {
      t.rect(6, y, 4, 2, [120, 226, 140], 6);
      t.rect(4, y + 2, 3, 2, [120, 226, 140], 6);
      t.rect(9, y + 2, 3, 2, [120, 226, 140], 6);
    }
  },
  // Generator: a furnace-like firebox with a flywheel, so it reads as the
  // thing producing power rather than another storage box.
  generator_top: (t) => {
    t.fill([76, 76, 82], 4).patches(9, [62, 62, 68], 5, 3).posterize(9);
    t.border([40, 40, 46]);
    t.disc(7.5, 7.5, 4.4, [150, 150, 158], 6);   // flywheel
    t.disc(7.5, 7.5, 2.4, [70, 70, 76], 4);
    for (let i = 0; i < 4; i++) {                // spokes
      const a = (i * Math.PI) / 2 + 0.4;
      t.line(Math.round(7.5 + Math.cos(a) * 2), Math.round(7.5 + Math.sin(a) * 2),
        Math.round(7.5 + Math.cos(a) * 4), Math.round(7.5 + Math.sin(a) * 4),
        [186, 186, 194], 1);
    }
  },
  generator_side: (t) => {
    t.fill([76, 76, 82], 4).patches(9, [62, 62, 68], 5, 3).posterize(9);
    t.border([40, 40, 46]);
    t.rect(3, 7, 10, 6, [48, 42, 38], 4);        // firebox
    t.rect(4, 8, 8, 4, [28, 24, 22], 3);
    t.rect(4, 10, 8, 2, [214, 112, 34], 8);      // flames
    t.rect(5, 11, 6, 1, [248, 186, 66], 10);
    t.rect(4, 2, 8, 3, [150, 150, 158], 5);      // vent grille on top
    for (let x = 5; x < 12; x += 2) t.rect(x, 2, 1, 3, [70, 70, 76]);
  },
  // Crusher: opposed toothed rollers.
  crusher_top: (t) => {
    t.fill([70, 70, 76], 4).patches(9, [58, 58, 64], 5, 3).posterize(9);
    t.border([38, 38, 44]);
    t.rect(2, 4, 5, 8, [140, 140, 148], 5);      // rollers
    t.rect(9, 4, 5, 8, [140, 140, 148], 5);
    for (let y = 4; y < 12; y += 2) {            // teeth
      t.rect(6, y, 1, 1, [60, 60, 66]);
      t.rect(9, y + 1, 1, 1, [60, 60, 66]);
    }
    t.rect(7, 2, 2, 12, [40, 40, 46], 3);        // the gap between them
  },
  crusher_side: (t) => {
    t.fill([70, 70, 76], 4).patches(9, [58, 58, 64], 5, 3).posterize(9);
    t.border([38, 38, 44]);
    t.rect(2, 2, 12, 3, [96, 96, 104], 5);       // hopper mouth
    t.rect(4, 5, 8, 2, [44, 44, 50], 3);
    t.disc(5.5, 9.5, 2.6, [150, 150, 158], 5);   // roller ends
    t.disc(10.5, 9.5, 2.6, [150, 150, 158], 5);
    t.disc(5.5, 9.5, 1.0, [58, 58, 64], 3);
    t.disc(10.5, 9.5, 1.0, [58, 58, 64], 3);
    t.rect(5, 13, 6, 2, [178, 150, 54], 5);      // hazard band
  },
  miner_top: (t) => {
    t.fill([72, 72, 78], 5).patches(8, [58, 58, 64], 6, 3).posterize(9);
    t.border([38, 38, 44]);
    t.disc(7.5, 7.5, 4.5, [150, 150, 158], 8);   // drill collar
    t.disc(7.5, 7.5, 2.2, [58, 58, 64], 5);      // bore
  },
  miner_side: (t) => {
    t.fill([72, 72, 78], 5).patches(8, [58, 58, 64], 6, 3).posterize(9);
    t.border([38, 38, 44]);
    t.rect(3, 2, 10, 3, [188, 160, 54], 5);      // hazard stripe
    for (let x = 3; x < 13; x += 3) t.rect(x, 2, 1, 3, [60, 52, 20]);
    t.rect(6, 7, 4, 7, [150, 150, 158], 6);      // the bit
    t.rect(7, 12, 2, 3, [96, 96, 104], 4);
  },
  sorter: (t) => {
    t.fill([64, 64, 70], 5).patches(8, [52, 52, 58], 6, 3).posterize(4);
    t.border([36, 36, 42]);
    // A big arrow, readable at block size, so its direction is obvious.
    const gold: RGB = [206, 182, 62];
    t.rect(6, 3, 4, 7, gold);
    t.rect(3, 9, 10, 2, gold);
    t.rect(4, 11, 8, 1, gold);
    t.rect(6, 12, 4, 1, gold);
  },
  // --- logistics ---------------------------------------------------------
  //
  // Each one has to say what it does from directly above, since that is where
  // you stand while laying a line. A splitter fans, a filter gates, a tube
  // carries: the top faces spell that out rather than being decorated metal.

  splitter_top: (t) => {
    beltBase(t);
    const gold: RGB = [206, 182, 62];
    // One stem in, three arms out: the shape of what it does to a line.
    t.rect(7, 10, 2, 5, gold);
    t.rect(3, 8, 10, 2, gold);
    t.rect(3, 4, 2, 4, gold);
    t.rect(11, 4, 2, 4, gold);
    t.rect(7, 2, 2, 6, gold);
    t.rect(2, 3, 4, 1, gold);
    t.rect(10, 3, 4, 1, gold);
  },
  splitter_side: (t) => {
    beltBase(t);
    t.rect(0, 0, TILE, 3, [88, 88, 96], 4);
    t.blot(4, 5, 8, 6, [148, 130, 48], 5);
  },

  filter_top: (t) => {
    beltBase(t);
    // A grille across the belt: the thing the items have to get through.
    t.rect(2, 6, 12, 4, [176, 176, 186], 5);
    for (let x = 3; x < 13; x += 2) t.rect(x, 6, 1, 4, [58, 58, 66]);
    t.rect(2, 6, 12, 1, [214, 214, 224], 3);
  },
  filter_side: (t) => {
    beltBase(t);
    t.rect(1, 4, 14, 7, [120, 120, 130], 5);
    for (let x = 2; x < 15; x += 3) t.rect(x, 5, 1, 5, [52, 52, 60]);
  },

  tube: (t) => {
    // A glass pipe with a metal band, so cargo reads as travelling inside it.
    t.fill([70, 78, 88], 5).patches(7, [58, 66, 76], 6, 3).posterize(10);
    t.rect(4, 0, 8, TILE, [126, 148, 166], 6);      // the bore
    t.rect(4, 0, 1, TILE, [176, 200, 216], 4);      // lit edge
    t.rect(11, 0, 1, TILE, [78, 94, 110], 4);       // shadowed edge
    t.rect(0, 5, TILE, 3, [150, 150, 160], 5);      // band
    t.rect(0, 5, TILE, 1, [196, 196, 206], 3);
    t.border([40, 46, 54]);
  },

  incinerator_top: (t) => {
    t.fill([58, 52, 52], 5).patches(9, [46, 40, 40], 6, 3).posterize(6);
    t.border([32, 28, 28]);
    // An open mouth with fire in it: unmistakably where things go to die.
    t.rect(3, 3, 10, 10, [26, 20, 18], 4);
    t.blot(4, 8, 8, 4, [188, 78, 30], 6);
    t.blot(5, 10, 6, 3, [232, 148, 44], 5);
    t.blot(7, 11, 2, 2, [248, 214, 120], 3);
  },
  incinerator_side: (t) => {
    t.fill([58, 52, 52], 5).patches(9, [46, 40, 40], 6, 3).posterize(6);
    t.border([32, 28, 28]);
    t.rect(2, 2, 12, 3, [150, 62, 26], 5);          // hazard band
    for (let x = 3; x < 14; x += 3) t.rect(x, 2, 1, 3, [40, 26, 20]);
    t.rect(4, 8, 8, 5, [26, 20, 18], 4);            // vent
    t.blot(5, 10, 6, 2, [196, 92, 34], 5);
  },

  cable: (t) => {
    t.fill([52, 48, 56], 5).patches(8, [42, 38, 46], 6, 3).posterize(12);
    t.rect(0, 6, TILE, 4, [168, 118, 54], 6);   // copper run across the block
    t.rect(0, 6, TILE, 1, [206, 156, 84], 4);   // lit top edge
    t.rect(0, 9, TILE, 1, [112, 74, 34], 4);    // shadowed underside
    for (let x = 2; x < TILE; x += 5) t.blot(x, 5, 2, 6, [96, 96, 104], 5); // clamps
  },

  netherrack: (t) => t.fill([116, 46, 44], 5)
    .patches(18, [82, 28, 28], 5, 3)
    .patches(13, [150, 66, 62], 5, 3)
    .patches(7, [58, 18, 18], 5, 2)
    .posterize(9),
  soul_sand: (t) => {
    t.fill([88, 68, 56], 6).patches(14, [72, 54, 44], 8, 3).posterize(4);
    // The sunken hollows that give the block its name.
    for (const [hx, hy] of [[3, 4], [10, 3], [6, 10], [12, 11]] as const) {
      t.blot(hx, hy, 3, 3, [54, 40, 32], 5);
      t.blot(hx + 1, hy + 1, 1, 1, [38, 28, 22], 3);
    }
  },
  // Mostly molten rock with a bit of crust and only a few bright veins --
  // flooding it with yellow loses the deep red that says "lava".
  lava: (t) => t.fill([198, 74, 18], 7)
    .patches(11, [228, 118, 26], 8, 4)
    .patches(9, [128, 40, 12], 8, 3)     // cooled crust
    .patches(4, [250, 196, 66], 6, 2)    // the hot veins
    .posterize(8),
  obsidian: (t) => t.fill([26, 20, 38], 4)
    .patches(9, [40, 30, 58], 5, 4)
    .patches(4, [58, 44, 88], 4, 2)
    .patches(5, [14, 10, 22], 4, 3)
    .posterize(8),
  nether_brick: (t) => t.fill([70, 34, 38], 4).courses([50, 24, 28]).posterize(10),
  // Portals are chaotic light, not a tidy spiral: broken bright patches over
  // a dark field read far better than a regular swirl repeating across a frame.
  portal: (t) => t.fill([78, 28, 140], 10, 220)
    .patches(20, [128, 54, 206], 16, 3)
    .patches(14, [176, 104, 240], 16, 2)
    .patches(10, [48, 14, 92], 12, 3)
    .posterize(5),

  end_stone: (t) => t.fill([218, 220, 168], 6)
    .patches(16, [198, 200, 148], 8, 3)
    .patches(10, [238, 240, 194], 6, 2)
    .posterize(9),
  end_frame_top: (t) => t.fill([218, 220, 168], 6)
    .patches(10, [198, 200, 148], 6, 3).posterize(9).border([120, 148, 116]),
  end_frame_side: (t) => t.fill([196, 198, 150], 6)
    .patches(10, [176, 178, 132], 6, 3).posterize(9).courses([150, 156, 118], 8, 8),
  // A night sky: mostly deep black, a few faint nebulae, sparse stars.
  end_portal: (t) => t.fill([10, 8, 28], 4, 240)
    .patches(8, [34, 22, 82], 8, 4)
    .patches(4, [72, 54, 140], 6, 2)
    .patches(5, [210, 224, 244], 4, 1)   // the starfield glints
    .posterize(8),
  end_frame_eye: (t) => {
    t.fill([196, 198, 150], 6).patches(8, [176, 178, 132], 6, 3).posterize(4);
    t.border([120, 148, 116]);
    t.disc(7.5, 7.5, 4, [42, 132, 122], 10);
    t.disc(7.5, 7.5, 2, [220, 240, 160], 8);
  },
  // A C-shaped steel striker over a wedge of flint, with sparks between
  // them -- the two parts and the spark are what name the item.
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
  purpur: (t) => t.fill([170, 124, 172], 6)
    .patches(16, [150, 104, 152], 8, 3)
    .patches(10, [192, 150, 194], 6, 2)
    .posterize(9),
};

BLOCK_ART.conveyor_n = conveyorTile(0, -1);
BLOCK_ART.conveyor_e = conveyorTile(1, 0);
BLOCK_ART.conveyor_s = conveyorTile(0, 1);
BLOCK_ART.conveyor_w = conveyorTile(-1, 0);
