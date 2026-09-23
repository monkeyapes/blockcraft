/**
 * Item ids. No imports, for the same reason as blockids.ts: content packs
 * name items without importing the registry that loads them.
 *
 * Ids start at ITEM_ID_BASE (256). Everything below is a block, which is
 * directly an item that places itself.
 */

export enum Item {
  Stick = 256,
  Coal = 257,
  IronIngot = 258,
  GoldIngot = 259,
  Diamond = 260,

  WoodPickaxe = 268,
  StonePickaxe = 269,
  IronPickaxe = 270,
  DiamondPickaxe = 271,
  WoodAxe = 272,
  StoneAxe = 273,
  IronAxe = 274,
  DiamondAxe = 275,
  WoodShovel = 276,
  StoneShovel = 277,
  IronShovel = 278,
  DiamondShovel = 279,
  MiningDrill = 280,
  FlintAndSteel = 281,

  Skateboard = 298,
  Car = 299,
  Plane = 300,
  Helicopter = 301,
  Boat = 302,
  Truck = 303,

  // Reserved for the ending; recipes land with the dimensions work.
  BlazeRod = 288,
  BlazePowder = 289,
  EnderPearl = 290,
  EyeOfEnder = 291,

  LeatherHelmet = 308,
  LeatherChestplate = 309,
  LeatherLeggings = 310,
  LeatherBoots = 311,
  IronHelmet = 312,
  IronChestplate = 313,
  IronLeggings = 314,
  IronBoots = 315,
  DiamondHelmet = 316,
  DiamondChestplate = 317,
  DiamondLeggings = 318,
  DiamondBoots = 319,

  Leather = 323,
  Feather = 324,

  WoodSword = 328,
  StoneSword = 329,
  IronSword = 330,
  DiamondSword = 331,

  RawPorkchop = 338,
  CookedPorkchop = 339,
  RawBeef = 340,
  Steak = 341,
  RawMutton = 342,
  CookedMutton = 343,
  RawChicken = 344,
  CookedChicken = 345,

  // ------------------------------------------------------------------------
  // Content-pack items. As with blocks, the ids live here so packs written in
  // parallel never collide, and each pack *defines* its own items in
  // shared/src/content/.
  // ------------------------------------------------------------------------

  // --- farming: 350-369 ------------------------------------------------------
  WoodHoe = 350,
  StoneHoe = 351,
  IronHoe = 352,
  DiamondHoe = 353,
  WheatSeeds = 354,
  Wheat = 355,
  Bread = 356,
  Carrot = 357,
  Potato = 358,
  BakedPotato = 359,
  BoneMeal = 360,
  PumpkinPie = 361,
  // 362-369 free for the farming pack.

  // --- nature: 370-389 -------------------------------------------------------
  Apple = 370,
  MelonSlice = 371,
  Sugar = 372,
  CopperIngot = 373,
  Ruby = 374,
  Snowball = 375,
  // 376-389 free for the nature pack.

  // --- building: 390-409 -----------------------------------------------------
  WoodDoor = 390,
  // 391-409 free for the building pack.

  // --- mechanics and combat: 410-439 ------------------------------------------
  Bow = 410,
  Arrow = 411,
  StoneHammer = 412,
  IronHammer = 413,
  DiamondHammer = 414,
  Bucket = 415,
  WaterBucket = 416,
  LavaBucket = 417,
  // 418-439 free for the combat pack.

  // --- creatures: 440-469 ----------------------------------------------------
  Bone = 440,
  String = 441,
  Slimeball = 442,
  FusePowder = 443,
  RawFish = 444,
  CookedFish = 445,
  Shears = 446,
  RawRabbit = 447,
  CookedRabbit = 448,
  // 449-469 free for the creatures pack.
}
