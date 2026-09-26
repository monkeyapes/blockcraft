/**
 * Block ids.
 *
 * Kept in a file of their own, with no imports, so the content packs can
 * name blocks without importing the registry that loads them -- which would
 * be an import cycle, and a cycle here means a pack reads `Block.X` before
 * the enum exists and silently gets undefined.
 */

export enum Block {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Cobblestone = 4,
  Sand = 5,
  Gravel = 6,
  Bedrock = 7,
  Log = 8,
  Leaves = 9,
  Planks = 10,
  Bricks = 11,
  Glass = 12,
  Water = 13,
  Glowstone = 14,
  CoalOre = 15,
  IronOre = 16,
  GoldOre = 17,
  DiamondOre = 18,
  IronBlock = 19,
  CraftingTable = 20,
  Furnace = 21,
  Conveyor = 22,
  Sorter = 23,
  Cable = 24,
  Netherrack = 25,
  SoulSand = 26,
  Lava = 27,
  Obsidian = 28,
  NetherPortal = 29,
  NetherBricks = 30,
  Quartz = 31,
  EndStone = 32,
  EndPortalFrame = 33,
  EndPortal = 34,
  Purpur = 35,
  EndPortalFrameFilled = 36,
  Torch = 37,

  /*
   * Placed conveyors carry a facing.
   *
   * A chunk is a flat Uint8Array with no room for per-block metadata, so
   * direction has to live in the block id itself. Placement picks the
   * variant from where the player is looking, and all four drop the plain
   * Conveyor item, so the split is invisible in the inventory.
   */
  ConveyorNorth = 38,
  ConveyorEast = 39,
  ConveyorSouth = 40,
  ConveyorWest = 41,

  Chest = 42,
  Collector = 43,
  Miner = 44,
  Ladder = 45,
  Bed = 46,
  Generator = 47,
  Crusher = 48,
  SolarPanel = 49,
  Battery = 50,
  Elevator = 51,
  Booster = 52,

  /* NoVolt consumers, and one more renewable source. */
  StoneGenerator = 53,
  ElectricFurnace = 54,
  Sawmill = 55,
  Compressor = 56,
  Quarry = 57,
  WaterWheel = 58,
  // Logistics. Conveyors move items along the floor; these decide where the
  // items go, which is the difference between a belt and a factory.
  Splitter = 59,
  Tube = 60,
  Filter = 61,
  Incinerator = 62,

  // ------------------------------------------------------------------------
  // Everything below arrived with the content packs in shared/src/content/.
  // The ids are fixed here, in one place, so the packs can be written in
  // parallel without two of them ever claiming the same number. Each pack
  // owns a range; its blocks are *defined* (name, textures, shape, drops)
  // in its own file.
  //
  // Chunks store a block as one byte, so ids must stay below 256; items
  // start at ITEM_ID_BASE (256) for exactly that reason.
  // ------------------------------------------------------------------------

  // --- nature: 63-99 (shared/src/content/nature.ts) -------------------------
  TallGrass = 63,
  Fern = 64,
  Dandelion = 65,
  Poppy = 66,
  Cornflower = 67,
  BrownMushroom = 68,
  RedMushroom = 69,
  OakSapling = 70,
  BirchSapling = 71,
  PineSapling = 72,
  BirchLog = 73,
  BirchLeaves = 74,
  BirchPlanks = 75,
  PineLog = 76,
  PineLeaves = 77,
  PinePlanks = 78,
  Cactus = 79,
  Reeds = 80,
  DeadBush = 81,
  Snow = 82,
  SnowLayer = 83,
  Ice = 84,
  Clay = 85,
  Sandstone = 86,
  MossyCobblestone = 87,
  Granite = 88,
  Slate = 89,
  Limestone = 90,
  CopperOre = 91,
  RubyOre = 92,
  Pumpkin = 93,
  Melon = 94,
  LilyPad = 95,
  // Grass wearing snow on its sides, the needle-strewn soil of a pine
  // forest, and one more flower.
  SnowyGrass = 96,
  Podzol = 97,
  Tulip = 98,
  // 99 free for the nature pack.

  // --- building: 100-169 (shared/src/content/building.ts) -------------------
  StoneBricks = 100,
  MossyStoneBricks = 101,
  CrackedStoneBricks = 102,
  StoneSlab = 103,
  CobblestoneSlab = 104,
  PlankSlab = 105,
  StoneBrickSlab = 106,
  SandstoneSlab = 107,
  // Stairs carry their facing in the id, like conveyors: the direction the
  // player faced when placing them, i.e. the side the tall back sits on.
  PlankStairsN = 108,
  PlankStairsE = 109,
  PlankStairsS = 110,
  PlankStairsW = 111,
  CobblestoneStairsN = 112,
  CobblestoneStairsE = 113,
  CobblestoneStairsS = 114,
  CobblestoneStairsW = 115,
  StoneBrickStairsN = 116,
  StoneBrickStairsE = 117,
  StoneBrickStairsS = 118,
  StoneBrickStairsW = 119,
  PlankFence = 120,
  // A gate is closed or open, and runs along x or along z.
  FenceGateX = 121,
  FenceGateZ = 122,
  FenceGateXOpen = 123,
  FenceGateZOpen = 124,
  CobblestoneWall = 125,
  GlassPane = 126,
  IronBars = 127,
  // A door is a panel on one edge of its cell; opening it swings the panel to
  // the neighbouring edge. Both halves of a door use the same ids -- which
  // half a cell is comes from whether the same door sits beneath it.
  WoodDoorN = 128,
  WoodDoorE = 129,
  WoodDoorS = 130,
  WoodDoorW = 131,
  WoodDoorNOpen = 132,
  WoodDoorEOpen = 133,
  WoodDoorSOpen = 134,
  WoodDoorWOpen = 135,
  Trapdoor = 136,
  TrapdoorOpenN = 137,
  TrapdoorOpenE = 138,
  TrapdoorOpenS = 139,
  TrapdoorOpenW = 140,
  Lantern = 141,
  Bookshelf = 142,
  CoalBlock = 143,
  GoldBlock = 144,
  DiamondBlock = 145,
  CopperBlock = 146,
  RubyBlock = 147,
  WhiteWool = 148,
  RedWool = 149,
  BlueWool = 150,
  YellowWool = 151,
  GreenWool = 152,
  BlackWool = 153,
  WhiteCarpet = 154,
  RedCarpet = 155,
  BlueCarpet = 156,
  YellowCarpet = 157,
  GreenCarpet = 158,
  BlackCarpet = 159,
  Campfire = 160,
  Terracotta = 161,
  Chain = 162,
  BrickSlab = 163,
  BrickStairsN = 164,
  BrickStairsE = 165,
  BrickStairsS = 166,
  BrickStairsW = 167,
  // 168-169 free for the building pack.

  // --- farming: 170-189 (shared/src/content/farming.ts) ---------------------
  Farmland = 170,
  Wheat0 = 171,
  Wheat1 = 172,
  Wheat2 = 173,
  Wheat3 = 174,
  Carrots0 = 175,
  Carrots1 = 176,
  Carrots2 = 177,
  Carrots3 = 178,
  HayBale = 179,
  Potatoes0 = 180,
  Potatoes1 = 181,
  Potatoes2 = 182,
  Potatoes3 = 183,
  FarmlandWet = 184,
  // 185-189 free for the farming pack.

  // --- mechanics and combat: 190-199 (shared/src/content/combat.ts) ---------
  TNT = 190,
  BouncePad = 191,
  IronSpikes = 192,
  // 193-199 free for the combat pack.

  // --- creatures: 200-209 (shared/src/content/creatures.ts) -----------------
  Cobweb = 200,
  // 201-209 free for the creatures pack.

  // --- fluids: 210-229 (shared/src/content/fluids.ts) -----------------------
  // Water and Lava above are the sources. A chunk has no room for a fluid
  // level beside the block, so, like a conveyor's facing, the level lives in
  // the id: one id per step away from the source, and one for a column
  // falling straight down.
  WaterFlow1 = 210,
  WaterFlow2 = 211,
  WaterFlow3 = 212,
  WaterFlow4 = 213,
  WaterFlow5 = 214,
  WaterFlow6 = 215,
  WaterFlow7 = 216,
  WaterFalling = 217,
  LavaFlow1 = 218,
  LavaFlow2 = 219,
  LavaFlow3 = 220,
  LavaFalling = 221,
  // 222-229 free for the fluids pack.
}
