/**
 * The pixel maps behind the equipment icons, one per kind.
 *
 * Kept apart from art/equipment.ts, which paints them: the maps are the
 * design -- where every unit of a sword or a helmet sits -- and the painter
 * is the machinery that colours, textures and outlines them. Separating the
 * two means a silhouette can be reworked without scrolling past the
 * renderer, and tests/equipment.ts can check a map's shape directly.
 *
 * Each map is 16 rows of 16 characters, one per authoring unit, and '.' is
 * transparent. Upper-case H L M D S are the five tones of the main
 * material, lightest to darkest, with the light always from the upper left;
 * h m d are the wooden haft, b B leather binding. Anything else is named
 * where the map is painted.
 */

/*
 * Every tool shares one haft: a two-unit staircase from the bottom-left
 * corner toward the top-right, light on its upper-left pixel and dark on its
 * lower-right. The heads are what differ, and each is built to be
 * unmistakable in outline alone -- and to claim a different part of the tile,
 * which is what tests/equipment.ts measures:
 *
 *   pickaxe  a crescent across the haft, its two arms mirror images that
 *            hug the top and right edges and end in points
 *   axe      a broad bearded blade on ONE side of the haft, convex bright
 *            edge, narrow neck, a small poll behind
 *   shovel   a spade in line with the haft -- flat shoulders, a crease down
 *            the middle -- and a ring grip at the butt
 *   hoe      a hook: a thin neck across the top, a flat blade hanging from
 *            its far end
 *   hammer   a heavy squared block across the haft with two flat striking
 *            faces and a steel collar, lower down a longer haft than the
 *            others, and a wrapped grip -- short, thick and blunt
 */

export const PICKAXE: readonly string[] = [
  '................',
  '.....LHHHLLL....',
  '...LLDDDDDDLM...',
  '..MDD......DMM..',
  '.DS........bDMD.',
  '..........bb.MD.',
  '.........hm..MD.',
  '........hm...MD.',
  '.......hm....MD.',
  '......hm.....MD.',
  '.....hm......MD.',
  '....hm......MD..',
  '...hm.......DS..',
  '..hm.......DS...',
  '.dd........S....',
  '................',
];

export const AXE: readonly string[] = [
  '................',
  '...HL...........',
  '..HMML....LLLM..',
  '..HMMMLLLLMMMD..',
  '..HMMMMMMMMMMD..',
  '..HMMMMD..DDD...',
  '..HMMMMD.bb.....',
  '..HMMMD.hm......',
  '...HMD.hm.......',
  '....S.hm........',
  '.....hm.........',
  '....hm..........',
  '...hm...........',
  '..hm............',
  '.dd.............',
  '................',
];

export const SHOVEL: readonly string[] = [
  '................',
  '...........HLL..',
  '..........HLLMM.',
  '.........HLLHMD.',
  '........HLLHMMD.',
  '........LLHMMD..',
  '.........LHMD...',
  '.........DDS....',
  '........hm......',
  '.......hm.......',
  '......hm........',
  '.....hm.........',
  '...hhm..........',
  '...h.m..........',
  '...mmd..........',
  '................',
];

export const HOE: readonly string[] = [
  '................',
  '..HLLLLLLLLLMD..',
  '.HLLD.......MD..',
  '.LMD........hm..',
  '.LMD.......hm...',
  '.LMD......hm....',
  '.HLS.....hm.....',
  '........hm......',
  '.......hm.......',
  '......hm........',
  '.....hm.........',
  '....hm..........',
  '...hm...........',
  '..hm............',
  '.dd.............',
  '................',
];

export const HAMMER: readonly string[] = [
  '................',
  '.......HHL......',
  '......HLMML.....',
  '......LMMMML....',
  '.......DMMMDD...',
  '........DMDHML..',
  '.........DDMMML.',
  '........hmDMMDS.',
  '.......hm..DDSS.',
  '......hm....SS..',
  '.....hm.........',
  '....hm..........',
  '...bB...........',
  '..Bb............',
  '.bB.............',
  '................',
];

/*
 * The sword is the one weapon here that is not a head on a stick, so it is
 * built to look nothing like one: a straight blade three units wide running
 * most of the diagonal to a single-unit point -- lit edge, fuller, shadowed
 * edge -- over a crossguard at right angles (g G) and a wrapped grip, ending
 * in a pommel (p P).
 */
export const SWORD: readonly string[] = [
  '................',
  '..............H.',
  '............HM..',
  '...........HMD..',
  '..........HMD...',
  '.........LMD....',
  '........LMD.....',
  '.......LMD......',
  '...gG.LMD.......',
  '....gGMD........',
  '.....gG.........',
  '....bBgG........',
  '...Bb..G........',
  '..bB............',
  '.pP.............',
  '................',
];

/** Limbs and a leather hand-hold; the string is drawn separately, finer. */
export const BOW: readonly string[] = [
  '................',
  '................',
  '.......hhhhhhd..',
  '.....hhmmm......',
  '....bBm.........',
  '...hBb..........',
  '...hm...........',
  '..hm............',
  '..hm............',
  '..hm............',
  '..h.............',
  '..h.............',
  '..h.............',
  '..d.............',
  '................',
  '................',
];

/** Stone head, a one-unit shaft, feathers (f F) with a red cock feather (r). */
export const ARROW: readonly string[] = [
  '................',
  '...........DMLH.',
  '............LHM.',
  '............dMD.',
  '...........h..D.',
  '..........h.....',
  '.........h......',
  '........h.......',
  '.......h........',
  '....f.h.........',
  '...ffh..........',
  '..rFhFr.........',
  '...hFf..........',
  '..d.f...........',
  '................',
  '................',
];

/*
 * Open shears: two iron blades diverging from a pivot (O), each running on
 * through it to a lacquered ring grip (r). The rings are drawn with their
 * corners cut so they read as loops, not red squares.
 */
export const SHEARS: readonly string[] = [
  '................',
  '.............LH.',
  '............LM..',
  '...........LM...',
  '..........LM....',
  '..rr.....LM...H.',
  '.r..r...LM..LMD.',
  '.r..rrrrOLMMD...',
  '..rr....rD......',
  '.......r........',
  '.....rr.........',
  '....r..r........',
  '....r..r........',
  '.....rr.........',
  '................',
  '................',
];

/*
 * An iron pail seen a little from above, so the open top shows as a band:
 * w the surface, W its shadowed near edge -- dark and empty, blue water or
 * glowing lava. k is the raised bail handle.
 */
export const BUCKET: readonly string[] = [
  '................',
  '................',
  '......kkkk......',
  '.....k....k.....',
  '....k......k....',
  '....k......k....',
  '...LLLLLLLLLL...',
  '...LwwwwwwwwD...',
  '...DLWWWWWWDD...',
  '....LMMMMMMD....',
  '....LMMMMMMD....',
  '....DDHDDHDD....',
  '....LMMMMMMD....',
  '.....LMMMMD.....',
  '.....DDDDDD.....',
  '................',
];

/*
 * A C-shaped steel striker below, a knapped flint above with its pale chalky
 * rind (c) round a dark glassy core (k K), and sparks (y Y o) between.
 */
export const FLINT_STEEL: readonly string[] = [
  '................',
  '..........cc....',
  '.........cKkc...',
  '.........ckKKc..',
  '........cKkKK...',
  '........kKKK....',
  '.....y..KKk.....',
  '...Y.oy..K......',
  '....y...........',
  '..LHHHHHHL......',
  '.LMMMMMMMMD.....',
  '.LMD............',
  '.LMD............',
  '.LMMMMMMMMD.....',
  '..DDDDDDDS......',
  '................',
];

/*
 * A power drill in profile: housing, chuck (c C), a diamond bit (s z t u),
 * pistol grip (g G) with its trigger (y), and the battery (b B).
 */
export const DRILL: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '..LHHHHHL.......',
  '.LMMMMMMMLcc....',
  '.LMMMMMMMMcCsst.',
  '.LMMMMMMMMcCzzu.',
  '.DMMMMMMMDcc....',
  '..DDgDDDD.......',
  '...gGGy.........',
  '...gGG..........',
  '..gGG...........',
  '.bbbbbbb........',
  '.BBBBBBB........',
  '................',
];

/*
 * Armour, one map per slot, each claiming its own region of the tile so no
 * two read alike: the helmet is a wide dome with an open face, cheek guards
 * and a nose bar; the chestplate has shoulders the full width and a waist
 * much narrower; the leggings are a belt over two long legs; the boots sit
 * low, a pair. R marks rivets and buckles.
 */

export const HELMET: readonly string[] = [
  '................',
  '................',
  '.....HHLLL......',
  '...HHLLLLMMMD...',
  '..HLLLMMMMMMMD..',
  '.HLLMMMMMMMMMMD.',
  '.LLMMMMMMMMMMDD.',
  '.DDRDDDDDDDDRDS.',
  '.LMMD..MD..MMDS.',
  '.LMMD..MD..MMDS.',
  '.LMMD......MMDS.',
  '..LMD......MDS..',
  '..LD........DS..',
  '................',
  '................',
  '................',
];

export const CHEST: readonly string[] = [
  '................',
  '..HLL......LLM..',
  '..HLMM....MMMD..',
  '.HLMMMD..DMMMMD.',
  '.LMMMMMDDMMMMMD.',
  '.LMMMMMMMMMMMMD.',
  '.DDDLMMMMMMDDDD.',
  '....LMMDMMMD....',
  '....LMMDMMMD....',
  '....LMMDMMMD....',
  '....DDDRRDDD....',
  '....LMMMMMMD....',
  '.....DDDDDD.....',
  '................',
  '................',
  '................',
];

export const LEGS: readonly string[] = [
  '................',
  '...HLLLLLLLLM...',
  '...DDDDRRDDDD...',
  '...LMMMMMMMMD...',
  '...LMMD..LMMD...',
  '...LMMD..LMMD...',
  '...LMMD..LMMD...',
  '...LMMD..LMMD...',
  '...HLMD..HLMD...',
  '...LMMD..LMMD...',
  '...LMMD..LMMD...',
  '...LMMD..LMMD...',
  '...LMMD..LMMD...',
  '...LMMD..LMMD...',
  '...DDDS..DDDS...',
  '................',
];

export const BOOTS: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '...HLLL..HLLL...',
  '...LMMD..LMMD...',
  '...LMMD..LMMD...',
  '...LMMD..LMMD...',
  '.HLMMMD..LMMMMD.',
  '.LMMMMD..LMMMMD.',
  '.DDDDDS..DDDDDS.',
  '................',
  '................',
];
