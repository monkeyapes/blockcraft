export const meta = {
  name: 'blockcraft-content-build',
  description: 'Eight parallel engineers build Blockcraft content packs, art and mobs in isolated worktrees',
  phases: [{ title: 'Build', detail: 'one agent per content area, each in its own git worktree' }],
}

const BASE = '7bbe6e0'

const PREAMBLE = `You are one of eight engineers working IN PARALLEL on Blockcraft (TypeScript monorepo: shared/, client/, server/, host/), an ORIGINAL Minecraft-inspired voxel game with a hand-written WebGL2 renderer and fully procedural textures (no image files). You are in your OWN git worktree on your own branch. Other engineers are changing other files at the same time in theirs; the lead engineer merges every branch afterwards.

THE USER'S REQUEST (verbatim, typos theirs): "do insane improvemtnt like new blocks mechanics new and improved minecraft ike textures custom blokc hitboxses models mobs and make sure the items resemble there name so a sword cant look like a n ahammer"

FIRST: verify your worktree contains the foundation: run "git merge-base --is-ancestor ${BASE} HEAD && echo ok". If that fails, run "git reset --hard ${BASE}" (your worktree is fresh, nothing is lost). If "npx tsx" / "npx tsc" cannot resolve modules in the worktree, link the main checkout's node_modules into the worktree root (Linux/macOS: ln -s <main checkout>/node_modules node_modules ; Windows Git Bash: cmd //c mklink /J node_modules <main checkout>\\node_modules), or run "npm ci" there. Never commit node_modules.

HARD RULES
1. ORIGINAL WORK ONLY. The project's founding rule is "make a game like Minecraft, not rip it": never copy Minecraft's textures, pixel layouts, code, sounds, or distinctive trademarked names/designs (no "Creeper", "Enderman"-style new names, etc.). Minecraft-LIKE is the goal: chunky 16-unit pixel art, readable silhouettes, familiar mechanics. Every texture is drawn by our own procedural code. Generic real-world names are fine (Poppy, Granite, Spider, Skeleton, Wolf, Bow, Hammer).
2. FILE OWNERSHIP. Edit ONLY the files under "You own" (and new files you create under the paths it allows). Reading anything is fine. If you need a change in a file you do not own, do NOT make it; describe it precisely (file, what, why) in "requests" in your final output — the lead applies these at merge time. The foundation files are stable and not yours unless listed: shared/src/blocks.ts, items.ts, shapes.ts, shapekit.ts, recipes.ts, content/types.ts, content/index.ts, client/src/content/api.ts, client/src/main.ts, player.ts, mesher.ts, gfx/tile.ts, gfx/atlas.ts, gfx/art/index.ts, package.json. Exception: in shared/src/blockids.ts and itemids.ts you may add NEW ids strictly inside YOUR pack's reserved free range (replace your own "// NN-MM free for the X pack." comment line), touching no other line.
3. Do not edit package.json. Put tests in the test file(s) named in your brief; the lead adds them to "npm test".
4. Match the codebase style: TypeScript, 2-space indent, single quotes, strict types, no unused locals (tsc has noUnusedLocals). Comments are explanatory prose that say WHY (read a few existing files and imitate the tone) — not labels.
5. MEASURE, DON'T GUESS. Every mechanic gets tests in the house style (see tests/content.ts: a check(label, ok, extra) helper printing PASS/FAIL, ending with process.exitCode = failures === 0 ? 0 : 1 — NEVER call process.exit()). Tests must fail if the feature is removed: mutation-test your key checks (temporarily break the code, confirm FAIL, restore).
6. LOOK AT YOUR ART. Your Read tool displays PNG images. For every texture/model you add or change, render it and look:
   - tiles:  npx tsx tests/diagnostics/sheet.ts --names=a,b,c --scale=3 --out=.scratch/x.png   (also --match=regex, --tiled to see seams, --items, --blocks)
   - models: npx tsx tests/diagnostics/scene.ts --blocks=Name1,Name2 --out=.scratch/y.png   (block names are Block enum member names), or --scene=layout.json with [[x,y,z,"BlockName"],...] (x,z from 0..40, y from 0 = on the floor), or --mobs=all / --mobs=Pig,Zombie ; camera --yaw=35 --pitch=30 --scale=48
   Iterate until it genuinely looks good at game scale AND reads as its name at a glance. .scratch/ is git-ignored; never commit PNGs.
7. BEFORE FINISHING, all must pass: npx tsc -p client/tsconfig.json --noEmit ; npx tsc -p server/tsconfig.json --noEmit ; your own tests ; npx tsx tests/content.ts ; npx tsx tests/blockart.ts ; npx tsx tests/itemart.ts ; npx tsx tests/feedback.ts ; npx tsx tests/shapes.ts ; npx tsx tests/physics.ts ; plus any other existing tests touching your area (grep tests/ for your files). If an existing test encodes behaviour you deliberately changed and you own that test, update it; otherwise report in "requests".
8. COMMIT on your worktree branch (git add only your files; never node_modules, never PNGs):
   GIT_AUTHOR_NAME=monkeyapes GIT_AUTHOR_EMAIL=muratmeteyildiz580@gmail.com GIT_COMMITTER_NAME=monkeyapes GIT_COMMITTER_EMAIL=muratmeteyildiz580@gmail.com git commit -m "<summary line>" -m "<body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
   Then report the branch name (git rev-parse --abbrev-ref HEAD) and the final commit hash (git rev-parse HEAD). A worktree with no commit is lost work.
   COMMIT EARLY AND OFTEN: make a work-in-progress commit (same author env vars) after every meaningful milestone — e.g. after the pack data, after the art, after the tests — not only at the end. The account's usage limit can cut a run off mid-task; committed work survives in your branch and can be resumed, uncommitted work is lost. Each WIP commit must at least typecheck. After EVERY commit, also push it to GitHub so it survives this machine: git push -f origin HEAD:refs/heads/wip/<your area key> (your key is given at the top of your brief).
9. The shell may be Linux bash or Git Bash on Windows. Ignore line-ending warnings.
10. Be ambitious — the user asked for an "insane" improvement — but finished and correct beats sprawling and broken. Prioritise: correctness, then the visual quality a player sees, then breadth.

THE FOUNDATION YOU BUILD ON (read these first; they are short and documented):
- shared/src/blockids.ts, itemids.ts: every new block/item id is ALREADY reserved, grouped by pack. Blocks are 0-255 (a chunk stores one byte); items are 256+.
- shared/src/content/types.ts: BlockSpec / ItemSpec / ContentPack. Your pack file shared/src/content/<pack>.ts exports a ContentPack (blocks, items, shapes, recipes, smelting, fuel, transitions); the registries load it — you never edit blocks.ts/items.ts. A pack imports VALUES only from blockids.ts, itemids.ts and shapekit.ts; anything else only as "import type" (otherwise an import cycle makes enum members undefined).
  BlockSpec highlights: textures ([top,bottom,side] or one name); solid/opaque/translucent — any block whose shape is not a full cube MUST set opaque:false or neighbours' faces get culled into see-through holes; hardness; tool + tier (mining class & minimum tier); drop / drops(random, tool); replaceable; family (states of one thing, swappable in place — door open/shut, crop stages; the server and the local link only accept an in-place change within a family, or one declared in the pack's transitions list); slipperiness / speedFactor / bounce / contactDamage / climbable (player physics already reads these); category (creative tab: building, nature, tools, combat, food, farming, machines, transport, materials, redstone, decoration — omit for hidden variants); icon (inventory tile when the side texture will not do).
  ItemSpec highlights: texture, stackSize, tool {kind: pickaxe|axe|shovel|hoe|hammer|shears, tier, speed, durability, actsAs?}, armor, attack, food, places (the block the item puts down), category.
- shared/src/shapekit.ts + shapes.ts: block MODELS. A ShapeEntry has visual / collision / selection (each a Box[] or a function of around(dx,dy,dz) returning neighbour block ids — for fences, panes, doors), and cross (X-shaped plants, drawn from the side texture on two crossed planes). Boxes may carry their own tex. Helpers: px(x0,y0,z0,x1,y1,z1,tex?) in sixteenths, slab(h), post(inset), rotateBoxes(boxes, quarterTurns) — author facing NORTH (-z); EAST=+x, SOUTH=+z, WEST=-x — FACING_STEP, shiftBoxes. Register in your pack's shapes: [[id or [ids], entry], ...]; you may also give an EXISTING (legacy) block a shape if it has none yet. The mesher, player collision (incl. collision taller than one block, e.g. a 1.5-high fence), the cursor raycast (selection boxes, hit face and point), placement and the highlight outline all follow these automatically. In the mesher, around() only sees neighbours within +-1.
- client/src/content/api.ts: BEHAVIOUR hooks. Your client module client/src/content/<pack>.ts registers: registerBlockUse, registerItemUse, registerItemUseAir, registerItemRelease, registerPlacement (choose or refuse (null) the block an item places; may move ctx.px/py/pz and set ctx.allowReplace), registerAfterPlace, registerBreak, registerBreakWith, registerRandomTick (each loaded cell near the player is visited roughly once a minute — crops, saplings), registerNeighbourChange, registerMobUse, registerSystem ({name, update, mesh, reset}: per-frame entities drawn in the terrain vertex format px py pz u v light ao — see client/src/gfx/mobmesh.ts for how to emit boxes), and services.explode / services.shoot (implemented by the combat pack, called by anyone). Everything touches the game through GameContext (setBlock obeys the server's canReplace rule; breakBlock; give; dropItem; damagePlayer; pushPlayer; hurtMob; toast; random...). game() returns the live context for code that is not handed one. main.ts already calls every dispatcher; you never edit main.ts. Client modules may import registries (blocks.ts, items.ts...) as values.
- In-game test commands exist: /give <item_name> [n] and /summon <mob_name> [n] (names are the registry names in lower_snake_case).
- ART: client/src/gfx/tile.ts is the brush set (Tile: fill, patches, posterize, blobs, courses, planks, rings, woodGrain, oreVein, mottle, grain, bevel, streaks, rect, line, disc, blot, outline, celShade, shadeShape, set, shade, flecks, fringe, chevrons, swirl...). Textures are authored on a 16x16 unit grid and rendered at 64px. Block faces must tile seamlessly (blot/patches wrap). Item icons: transparent background, strong silhouette, dark .outline(), .celShade(), lit from the upper-left. Study client/src/gfx/art/blocks.ts, items.ts and equipment.ts for the house style. Each pack has its own art module client/src/gfx/art/<pack>.ts exporting <PACK>_ART (recipes by tile name) and <PACK>_EXTRA (tile names no block or item references but the renderer needs). Tile names are global: art/index.ts throws on a duplicate name — grep before naming.
- A referenced tile with no recipe renders loud magenta. That is expected ONLY for item icons owned by the two icon engineers (table below).

ITEM ICON OWNERSHIP (pack engineers set these texture names on their items; icon engineers draw them):
  farming: WoodHoe 'hoe_wood', StoneHoe 'hoe_stone', IronHoe 'hoe_iron', DiamondHoe 'hoe_diamond', WheatSeeds 'wheat_seeds', Wheat 'wheat', Bread 'bread', Carrot 'carrot', Potato 'potato', BakedPotato 'baked_potato', BoneMeal 'bone_meal', PumpkinPie 'pumpkin_pie'
  nature: Apple 'apple', MelonSlice 'melon_slice', Sugar 'sugar', CopperIngot 'copper_ingot', Ruby 'ruby', Snowball 'snowball'
  building: WoodDoor 'door_wood_item'
  combat: Bow 'bow', Arrow 'arrow', StoneHammer 'hammer_stone', IronHammer 'hammer_iron', DiamondHammer 'hammer_diamond', Bucket 'bucket', WaterBucket 'bucket_water', LavaBucket 'bucket_lava'
  creatures: Bone 'bone_item', String 'string', Slimeball 'slimeball', FusePowder 'fuse_powder', RawFish 'raw_fish', CookedFish 'cooked_fish', Shears 'shears', RawRabbit 'raw_rabbit', CookedRabbit 'cooked_rabbit'
  The EQUIPMENT icon engineer draws every tool/weapon/armour icon: pickaxe_*, axe_*, shovel_*, sword_*, hoe_*, hammer_*, bow, arrow, shears, bucket, bucket_water, bucket_lava, flint_steel, drill, armor_*. The ITEM icon engineer draws everything else in the table plus all existing materials, food and vehicles. BLOCK textures are always drawn by the pack that owns the block.

FINAL OUTPUT (structured): branch, commit, summary (5-20 bullet strings of what you built), files (paths changed/added), tests (test files, number of checks, confirmation they pass), visuals (which renders you looked at and what you changed after looking), requests (precise changes needed in files you do not own), risks (anything unverified or fragile).`

const BRIEFS = [
{
  key: 'terrain-art',
  brief: `YOUR AREA: TERRAIN TEXTURES — make the existing block textures dramatically better and more Minecraft-like (while 100% original).

You own: client/src/gfx/art/blocks.ts, tests/blockart.ts, tests/terrainart.ts (new).

Redraw the natural and material block tiles in art/blocks.ts: grass_top, grass_side, dirt, stone, cobble, sand, gravel, bedrock, log_top, log_side, leaves, planks, brick, glass, water, lava, glowstone, torch, ladder, coal_ore, iron_ore, gold_ore, diamond_ore, iron_block, quartz, crafting_top, crafting_side, furnace_top, furnace_front, chest_top, chest_side, bed_top, bed_side, netherrack, soul_sand, obsidian, nether_brick, portal, end_stone, end_frame_top, end_frame_side, end_frame_eye, end_portal, purpur. The machine tiles (conveyor*, sorter, collector, miner, generator, crusher, solar, battery, elevator, booster, stonegen, efurnace, sawmill, compressor, quarry, waterwheel, splitter, filter, tube, incinerator, cable) keep their identity; polish them only if time allows, never make them unrecognisable.

What "better" means here: clear chunky pixel clusters on the 16-unit grid (not noise mush), a deliberate 4-6 tone ramp per material, shadows that shift hue (cooler/warmer) rather than just darken, a consistent upper-left light. Grass side: irregular overhanging grass fringe over dirt. Dirt: pebbles and root flecks. Stone: soft irregular mottling that reads as rock, not static. Cobble: distinct rounded stones with dark gaps between them. Planks: four clear boards with grain and end joints. Log side: vertical bark ridges; log top: growth rings with a bark rim. Leaves: dense clusters with depth — they MUST stay fully opaque (no transparent texels: leaves are an opaque block, holes would show the void). Ores: each ore reads differently in colour AND shape of its deposits. Glass: mostly transparent with a frame and a couple of glints. Water and lava: rich and readable. Bricks, nether bricks, end stone, purpur, obsidian: crisp and distinct. Crafting table / furnace / chest / bed: charming and clearly what they are.

Torch: the building engineer is reshaping the torch into a thin stick model: a box x 7..9, z 7..9, y 0..10 (sixteenths) using the tile 'torch' on every face. Box faces sample the tile at the box's own coordinates, so draw 'torch' with the stick in columns 7-8, rows 8-15 (wood), a glowing ember/flame head in columns 7-8, rows 6-7 (and bright pixels at rows 6-7 so the 2x2 top face is flame-coloured), and everything else fully transparent.
Ladder: keep it a full-cell translucent tile (rails and rungs, transparent between).

Tiling: every block face must repeat seamlessly (tests/blockart.ts checks seams — keep it passing, strengthen it if you can). Look at --tiled sheets. Also look at the textures in context: use tests/diagnostics/scene.ts --scene=... to build a small landscape (a grass/dirt hill with stone and ores exposed, a log with leaves, a plank-and-cobble wall, a furnace, crafting table and chest) from a few yaws, and iterate until it looks like a place you'd want to build in.

tests/terrainart.ts (new): measure what you care about — e.g. each material uses a real tone ramp (distinct posterised levels), shadows are hue-shifted, similar materials are distinguishable (stone vs cobble vs gravel vs bedrock by structure, not just brightness), grass side fringe is irregular, leaves have no transparent texels, glass is mostly transparent, the torch tile's transparent/opaque layout matches the column/row contract above.`,
},
{
  key: 'equipment-icons',
  brief: `YOUR AREA: TOOL, WEAPON AND ARMOUR ICONS, and 3D HELD / DROPPED ITEMS. This is the user's "a sword can't look like a hammer" request.

You own: client/src/gfx/art/equipment.ts, client/src/gfx/held.ts, client/src/gfx/itemmesh.ts, tests/itemart.ts, tests/equipment.ts (new), new files under client/src/gfx/ that you create for this (e.g. an extrusion module).

1) Icons. Look first: npx tsx tests/diagnostics/sheet.ts --match="pickaxe|axe_|shovel|sword|armor|drill|flint" --scale=3 --out=.scratch/eq.png. Today the swords have a notched blade that reads as a wrench, the iron shovel reads as a hammer, the axes read as flags. Redraw so EVERY item reads as its name from silhouette alone, and its tier from colour (wood brown, stone grey, iron silver-white, diamond cyan). Draw all of: pickaxe_/axe_/shovel_/sword_/hoe_ x {wood, stone, iron, diamond}; hammer_ x {stone, iron, diamond} (a big two-faced sledge head across a long handle — must not resemble a sword, axe or pickaxe); bow (curved limbs + taut string); arrow (shaft, fletching, point); shears (two crossed blades + loop handles); bucket (empty, open top), bucket_water (blue surface visible), bucket_lava (orange glowing surface); flint_steel; drill; armor_head/chest/legs/feet x {leather, iron, diamond} (a helmet must look like a helmet — dome, face opening, cheek guards — not a chestplate; boots a pair of boots; leggings clearly legs). Keep the house style (transparent bg, dark outline, cel shading, upper-left light), and make them look genuinely good at 32-48px.

2) tests/equipment.ts (new): the anti-confusion test. Build alpha-mask silhouettes of each kind (diamond tier) and assert every pair of DIFFERENT kinds is clearly dissimilar (e.g. IoU < 0.55 — pick a threshold you can justify and show the actual matrix in the output), that the tiers of one kind share a silhouette (IoU > 0.85) but differ in hue, every equipment tile has a recipe, sensible coverage (not a speck, not a slab). Keep tests/itemart.ts passing (update it for your items if needed).

3) 3D held and dropped items. held.ts draws non-block items as a flat double-sided quad; make them properly EXTRUDED sprites like a real voxel game's item models: front and back faces from the icon plus 1-texel side walls along every opaque/transparent edge, so a held sword has thickness. Hold tools naturally (angled in the hand, head up). Blocks held in hand should use the block's MODEL (shapeOf boxes, e.g. a held stair looks like a stair, a slab like a slab; crossed plants as extruded sprites). itemmesh.ts draws dropped items in the world (read it): extrude items there too and draw blocks as their mini model. Performance matters: held/dropped meshes rebuild every frame — cache the extruded geometry per tile name and only transform it. The extrusion must be a pure function of (tile pixels, size) so tests can feed it renderTile() output in Node; in the browser read tile pixels from the atlas canvas once per tile (getImageData) and cache; invalidate when atlas.revision changes (resource packs). Verify visually by rendering your meshes with tests/diagnostics/offscreen.ts (renderMeshes takes any terrain-format mesh) from a couple of angles, and test that e.g. a sword's extruded mesh has side walls and no faces where the icon is transparent.`,
},
{
  key: 'item-icons',
  brief: `YOUR AREA: MATERIAL / FOOD / MISC ICONS, and 3D ISOMETRIC BLOCK ICONS in every inventory UI.

You own: client/src/gfx/art/items.ts, client/src/hud.ts, client/src/ui/inventory.ts, client/src/ui/creative.ts, client/src/ui/panel.ts, new client/src/gfx/blockicon.ts (and any new helper file under client/src/gfx/ you create), tests/itemicons.ts (new), tests/blockicons.ts (new).

1) Icons that read as their name. Look first: npx tsx tests/diagnostics/sheet.ts --items --scale=2 --out=.scratch/items.png. Then redraw/draw in art/items.ts so each reads as its NAME at 32-48px: stick, coal, iron_ingot, gold_ingot, diamond, copper_ingot, ruby, leather, feather (a real curved feather: vane either side of a rachis, not a stick), blaze_rod, blaze_powder, ender_pearl, eye_of_ender, snowball, bone_item, string (a looped/coiled thread), slimeball, fuse_powder (a dark grey granular pile — original design), raw_porkchop, cooked_porkchop, raw_beef, steak, raw_mutton, cooked_mutton (NOT a triangle — a chop/rack cut), raw_chicken, cooked_chicken, raw_fish, cooked_fish (a fish: body, tail fin, eye), raw_rabbit, cooked_rabbit, wheat_seeds, wheat (a bundle of stalks with grain heads), bread (a loaf with a scored crust), carrot (orange taper + green top), potato (lumpy with eyes), baked_potato (split, golden), bone_meal (white powder heap), pumpkin_pie, apple (red, stem + leaf), melon_slice (rind, red flesh, seeds), sugar (white crystal heap), door_wood_item (a door: tall panel, window, handle), and the vehicles boat, truck, skateboard, car, plane, helicopter (already decent — polish). Raw vs cooked must differ unmistakably (colour + char/grill marks), and different foods must differ in SILHOUETTE, not just tint. House style: transparent background, dark outline, cel shading, upper-left light.
   tests/itemicons.ts: every item texture you own has a recipe; coverage sane (roughly 12%-75% opaque); an outline ring present; raw/cooked pairs share a silhouette but differ clearly in colour; distinct foods/materials are dissimilar in silhouette (pairwise IoU threshold you justify, print the worst pairs).

2) 3D block icons. Today every UI shows a block as its flat side texture, so stairs, slabs, fences and planks are indistinguishable in the hotbar. Build client/src/gfx/blockicon.ts: a small software rasteriser (pure core usable in Node) that renders a block's actual model — shapeOf(id) boxes with their per-box textures, top/left/right faces shaded like a classic isometric inventory icon — into an RGBA icon (e.g. 64x64). Crossed plants (crossOf(id) non-null), and blocks with blockDef(id).icon set, keep a flat sprite icon. Add a browser wrapper that turns icons into cached data URLs, reading tile pixels from the atlas canvas, and invalidates when atlas.revision changes (resource packs). Then switch the icon lookups in hud.ts, ui/inventory.ts, ui/creative.ts and ui/panel.ts (grep "iconURL(") to a single helper: block items get the 3D icon, everything else the flat item icon. tests/blockicons.ts: in Node (use renderTile for tile pixels), Stone's icon is a hexagon-like silhouette with three distinct face brightnesses (top brightest), a slab icon is visibly shorter than a full block's, a thin post (Block.Cable) is narrower, a cross block falls back to its flat sprite. LOOK at a sheet of block icons (write a quick diagnostic under tests/diagnostics/ that renders a labelled grid of your icons to PNG) and make them look crisp and Minecraft-inventory-like.

Also: the creative menu (ui/creative.ts) gained data-driven tabs from pack categories; keep that working, and make sure it stays usable with ~150 more entries (the grid scrolls; search works on names).`,
},
{
  key: 'nature',
  brief: `YOUR AREA: THE NATURE PACK — plants, trees, new stones and ores, snow and ice, biomes.

You own: shared/src/content/nature.ts, client/src/content/nature.ts, client/src/gfx/art/nature.ts, shared/src/terrain.ts, tests/nature.ts (new), tests/terrain.ts and tests/structures.ts (update only if your generation changes legitimately break their expectations).

Blocks (ids reserved in blockids.ts): TallGrass, Fern, Dandelion, Poppy, Cornflower, BrownMushroom, RedMushroom, OakSapling, BirchSapling, PineSapling, BirchLog, BirchLeaves, BirchPlanks, PineLog, PineLeaves, PinePlanks, Cactus, Reeds, DeadBush, Snow, SnowLayer, Ice, Clay, Sandstone, MossyCobblestone, Granite, Slate, Limestone, CopperOre, RubyOre, Pumpkin, Melon, LilyPad (+ ids 96-99 free). Items: Apple, MelonSlice, Sugar, CopperIngot, Ruby, Snowball (use the icon names from the table; the icon engineer draws them).

Behaviour:
- Plants are cross models, not solid, opaque:false, hardness 0; tall grass / fern / dead bush are replaceable. They need support: registerNeighbourChange so they pop off (dropping themselves where appropriate) when the block under them goes or is not valid soil. Tall grass sometimes drops Item.WheatSeeds (the farming pack defines that item; just use its id). Mushrooms prefer shade.
- Saplings grow into trees on random ticks (oak: the existing tree; birch: taller pale trunk; pine: conical layered tree), only if there is room; declare transitions [sapling, log] as needed. Bone meal (Item.BoneMeal, farming pack) on a sapling grows it at once, and on grass sprouts tall grass/flowers around — register your own registerItemUse(Item.BoneMeal, ...) that returns false for blocks that are not yours (the farming pack handles crops).
- Leaves: the legacy Leaves block drops nothing; add a registerBreak hook so oak leaves sometimes drop an OakSapling and occasionally an Apple (via ctx.dropItem, skip in creative). Birch/Pine leaves drop their saplings via drops().
- Cactus: a model inset 1/16 on the sides (opaque:false), contactDamage, grows up to 3 tall on sand, and breaks (dropping itself) if a solid block appears beside it.
- Reeds: cross, grow up to 3 tall on sand/grass/dirt next to water; craft into Sugar.
- SnowLayer: a 2/16 slab, replaceable, drops snowballs with a shovel; Snow block; 4 snowballs -> snow block. Ice: translucent, opaque:false, slipperiness ~0.9 (the player physics already applies it).
- Ores: CopperOre (common, mid depths, needs stone pickaxe, smelts to CopperIngot), RubyOre (rare, deep, needs iron pickaxe, drops Ruby). Granite/Slate/Limestone as underground blobs (pickaxe). Sandstone under desert sand. Clay patches in shallow water. MossyCobblestone (recipe: cobblestone + leaves). Pumpkin (top + side textures). Melon (drops 3-7 slices). LilyPad: 1/16 pad that sits on the water surface (a placement hook that puts it on top of water).
- Biomes in shared/src/terrain.ts (generation is shared and deterministic: server and client must produce identical chunks): driven by temperature/humidity noise — plains (grass, flowers), forest (oak + birch, mushrooms in shade), taiga/snowy (pine, snow layers, ice on still water), desert (sand over sandstone, cactus, dead bush, no trees), swamp (lily pads, reeds, clay), keeping the existing mountains. Scatter tall grass/ferns/flowers/pumpkins/melons sensibly. Keep it fast: measure chunk generation time before and after (write the numbers in your output) and do not regress it by more than ~30%. Existing worlds' unedited chunks will regenerate differently — acceptable, note it.
- Recipes: birch/pine logs -> their planks; add alternative recipes so birch and pine planks also make sticks, a crafting table and a chest (the legacy recipes name Block.Planks); sugar, snow block, mossy cobble, copper/ruby storage are the building pack's (do not add storage blocks). Smelting: copper ore -> copper ingot; sand stays glass.
- Categories: natural blocks 'nature', planks/stones/sandstone 'building', flowers 'decoration', items 'materials' / 'food'.
- Textures in art/nature.ts: all your blocks (logs with bark and rings, pale birch with dark flecks, dark pine, their planks in different tones, leaves (fully opaque — see terrain rules), flower/grass/sapling/mushroom/reeds/dead bush sprites on transparent backgrounds that look good as crossed planes, cactus with ribs and spines, snow, ice (partly transparent), clay, sandstone top/side/bottom, granite/slate/limestone clearly different from each other and from stone, ores on the stone base, pumpkin, melon, lily pad). LOOK at them with sheet.ts and as models with scene.ts (flowers and saplings in a row, a birch and a pine grown from saplings, a cactus on sand, a snowy patch, a desert patch).
- tests/nature.ts: plants pop off without support, saplings grow into the right tree shape given room and not without, cactus damages and breaks beside a solid block, snow layer is replaceable and slab-shaped, ice is slippery, drops (tall grass seeds chance, melon slices, leaves saplings/apples) are within their ranges, biome generation is deterministic (same seed -> same chunk) and actually produces each biome's features somewhere in a reasonable search area, ores appear at their depths.`,
},
{
  key: 'building',
  brief: `YOUR AREA: THE BUILDING PACK — everything with a shape that is not a cube, and custom hitboxes/models for existing blocks.

You own: shared/src/content/building.ts, client/src/content/building.ts, client/src/gfx/art/building.ts, tests/building.ts (new).

Blocks (ids reserved): StoneBricks, MossyStoneBricks, CrackedStoneBricks; StoneSlab, CobblestoneSlab, PlankSlab, StoneBrickSlab, SandstoneSlab; PlankStairs N/E/S/W, CobblestoneStairs N/E/S/W, StoneBrickStairs N/E/S/W; PlankFence; FenceGateX/Z and their Open states; CobblestoneWall; GlassPane; IronBars; WoodDoor N/E/S/W + Open variants; Trapdoor + TrapdoorOpen N/E/S/W; Lantern; Bookshelf; CoalBlock, GoldBlock, DiamondBlock, CopperBlock, RubyBlock; White/Red/Blue/Yellow/Green/Black Wool and Carpet; Campfire; Terracotta; Chain (+ ids 163-169 free). Item: WoodDoor ('door_wood_item', drawn by the icon engineer).

Models and behaviour (use shapekit helpers; every partial block opaque:false):
- Slabs: bottom half. Placing a slab onto the top face of the same slab turns that cell into the full block (StoneSlab->Stone, CobblestoneSlab->Cobblestone, PlankSlab->Planks, StoneBrickSlab->StoneBricks, SandstoneSlab->Block.Sandstone from the nature pack) via registerPlacement (move ctx.px/py/pz to the clicked cell, set allowReplace) plus declared transitions. A half slab is walkable up (step height 0.6).
- Stairs: one inventory item per material (the N variant, with a category; the other facings hidden and dropping the N item); placement picks the facing from the player's yaw so the stair ascends away from the player; model = bottom slab + upper half-block along the back; collision matches.
- Fences: post (6..10) with arms reaching toward neighbouring fences, gates and full solid blocks (a function of around); drawn 1 block tall but collision 1.5 tall so nothing jumps it; selection matches the drawn shape. CobblestoneWall likewise, chunkier (post 4..12, arms ~5..11, 14/16 tall, collision 1.5). GlassPane and IronBars: thin (7..9) panes joining neighbours and full blocks; a lone pane is a small post.
- Fence gates: X/Z orientation from the player's yaw; right-click toggles open/closed (family); closed blocks like a fence (1.5), open has no collision (the open ids are solid:false); gates connect to fences.
- Doors: the WoodDoor item places a two-high door (same id in both cells; which half is which comes from around(0,-1,0) being the same door, which picks the lower/upper door texture per box via tex). Facing from player yaw, intuitive hinge side. Right-click toggles BOTH halves between the closed edge and the open edge (family). Breaking either half removes both and drops exactly one door item. Collision is a 3/16 panel; an open door clears the doorway.
- Trapdoors: closed = 3/16 slab on the floor of the cell; right-click opens it into a 3/16 panel on an edge chosen from the player's facing (family).
- Lantern (small lantern box + top loop, light 15), Chain (thin post), Campfire (crossed log boxes + flame boxes with a transparent flame tile, light 15, contactDamage 1, and right-clicking it with raw food cooks one piece: consume the raw item and give cookedForm(raw) — client modules may import items.ts), Carpets (1/16), Wool (full), Terracotta (smelt Block.Clay from nature), Bookshelf, storage blocks (9 ingots/gems <-> 1 block, both directions; coal block is fuel).
- Existing blocks that deserve real models (register shapes for these legacy ids in your pack — the registry accepts them since they have none yet): Torch -> a thin stick box x 7..9, z 7..9, y 0..10 (sixteenths), using the existing 'torch' tile (the terrain-art engineer is redrawing that tile to match this contract); Chest -> a box inset 1/16 and 14/16 tall; Bed -> 9/16 tall slab; Crafting table stays a cube. Legacy definition flags you cannot change from a pack (e.g. Chest is opaque:true in blocks.ts and must become opaque:false once it is not a full cube): list exact flag changes in requests; the lead applies them at merge.
- Recipes for everything, original but Minecraft-like patterns; stairs give 4 per 6 material, slabs 6 per 3, fences 3 per (4 planks + 2 sticks), panes 16 per 6 glass, etc. Categories: building / decoration.
- Textures in art/building.ts: stone bricks + mossy + cracked, wool in six colours (soft woven texture), carpets reuse wool, bookshelf (books with varied spines), door lower/upper (planks with a window in the top half, handle), trapdoor (planks with a hatch pattern and holes), lantern (metal frame with warm glow), chain, campfire logs and a transparent flame tile, terracotta, coal/gold/diamond/copper/ruby blocks (each clearly the material), iron bars. Stairs/slabs/fences use their material's existing tiles.
- LOOK: scene.ts renders through the real mesher, including neighbour-aware shapes. Build layouts with --scene: a fence pen with a gate (closed and open), a wall corner, a glass pane window row, a doorway with a two-high door (closed and open variants), stairs in all four facings next to slabs and double slabs, a lantern on a chain, a campfire, carpets, and view from several yaws. The cursor outline and collision come from the same data; test them.
- tests/building.ts: slab stacking yields the full block (and not for mismatched slabs), stair facing follows yaw, fence arms appear only toward connectable neighbours, fence collision is 1.5 tall and a player cannot walk over it but can walk over a slab, gates toggle and open gates have no collision, doors place two halves, toggle both, break both with one drop, trapdoors toggle, every family converts within itself (canReplace), campfire cooks, recipes produce the right counts, and the player collision uses your boxes (drive a Player against them like tests/physics.ts does).`,
},
{
  key: 'farming',
  brief: `YOUR AREA: THE FARMING PACK.

You own: shared/src/content/farming.ts, client/src/content/farming.ts, client/src/gfx/art/farming.ts, tests/farming.ts (new).

Blocks (ids reserved): Farmland, Wheat0-3, Carrots0-3, Potatoes0-3, HayBale (+ ids 184-189 free — e.g. a separate wet-farmland id is fine if you want a visible hydrated look). Items: WoodHoe, StoneHoe, IronHoe, DiamondHoe (tool kind 'hoe'), WheatSeeds, Wheat, Bread, Carrot, Potato, BakedPotato, BoneMeal, PumpkinPie (texture names from the table; the icon engineers draw them).

Behaviour:
- Hoe: right-click the top of Dirt or Grass with air above -> Farmland (declared transitions; the legacy blocks are Block.Dirt/Block.Grass).
- Farmland: a 15/16 slab (opaque:false) that drops Dirt; hydrated when water is within 4 blocks horizontally (same level or one above) — hydrated farmland grows crops faster (a visibly darker wet variant is a plus); dry farmland with no crop slowly reverts to dirt; landing on it from a jump/fall tramples it to dirt (a registerSystem that watches the player's landings: track previous onGround / vertical speed; only when not sneaking).
- Crops: cross models (or a tidy '#' of thin boxes if you prefer) that grow taller per stage, not solid, only placeable on farmland (registerPlacement refuses otherwise), grow on random ticks (faster when hydrated and lit), break (dropping seeds) when their farmland is removed or trampled (registerNeighbourChange). Drops: mature wheat -> 1 Wheat + 1-3 WheatSeeds, immature -> 1 seed; mature carrots/potatoes -> 1-4 of the item, immature -> 1. Seeds/Carrot/Potato items place stage 0 (ItemSpec.places + a placement hook). Carrot and Potato are also edible (food), BakedPotato from smelting Potato.
- BoneMeal: 3 from 1 Bone (Item.Bone, creatures pack id); right-clicking a crop advances it 1-2 stages with a little particle burst (ctx.breakParticles) and consumes one. Return false for anything that is not a crop — the nature pack handles saplings and grass with its own hook.
- Bread (3 wheat in a row), HayBale (9 wheat <-> 1 bale; top/side textures), PumpkinPie (Block.Pumpkin + Item.Sugar + Item.Wheat, shapeless — nature pack ids).
- Categories: farming (hoes, seeds, farmland?), food (bread, carrot, potato, baked potato, pie), building (hay bale).
- Textures in art/farming.ts: farmland top (tilled furrows; dry and wet looks) and side, crop stage sprites (wheat from green shoots to golden ears, carrots with feathery tops and a hint of orange at maturity, potatoes with leafy tops), hay bale top/side. LOOK: scene.ts --scene with a small field (farmland rows, a water channel, crops at every stage) from a couple of yaws.
- tests/farming.ts: hoe tills dirt/grass only with air above, seeds only plant on farmland, growth advances through every stage and stops at the last, hydration speeds growth (statistical, seeded random), trampling reverts farmland and pops the crop, dry farmland reverts only without a crop, drops per stage, bone meal advances crops and is consumed, recipes and smelting work, every crop family converts within itself.`,
},
{
  key: 'combat',
  brief: `YOUR AREA: THE COMBAT AND MECHANICS PACK — projectiles, bows, hammers, buckets, TNT and explosions, falling sand, the bounce pad.

You own: shared/src/content/combat.ts, client/src/content/combat.ts (and any new files under client/src/content/combat/ that you create), client/src/gfx/art/combat.ts, tests/combat.ts (new).

Blocks (ids reserved): TNT (top/side/bottom textures), BouncePad (+ ids 192-199 free). Items: Bow, Arrow, StoneHammer, IronHammer, DiamondHammer, Bucket, WaterBucket, LavaBucket (texture names from the table; the equipment icon engineer draws them).

Behaviour:
- Projectiles: a registerSystem that simulates projectiles (gravity, drag), collides with blocks (using the real collision boxes — player.ts exports collisionBoxesAt), hits mobs (ctx.hurtMob with knockback) and the player (ctx.damagePlayer — for mob-fired shots), and draws them in the terrain vertex format (an arrow as a small 3D model: thin shaft box + head + fletching, oriented along its velocity; put any entity-only tiles in COMBAT_EXTRA). Arrows stick into blocks for a while, then despawn (or can be picked back up when walked over — nice to have). Implement services.shoot(ctx, shot) for kinds 'arrow' (damage), 'snowball' (no damage, knockback, puff on impact) and 'fireball' (small fire damage; blazes may use it). Shooter never hits itself.
- Bow: registerItemUseAir(Item.Bow) starts drawing if the player has an Arrow (or is creative); registerItemRelease fires with power scaling with hold time (full at ~1s, a weak dribble under 0.2s), consuming one arrow (not in creative). Snowballs (Item.Snowball, nature pack id): right-click throws one.
- Hammers: ItemSpec tool {kind: 'hammer', actsAs: 'pickaxe', tier: stone 2 / iron 3 / diamond 4, speed a bit below the same-tier pickaxe, durability ~2x}; registerBreakWith: after the player breaks a block with a hammer, also break the 3x3 plane around it perpendicular to the player's look direction, but only blocks a pickaxe of that tier can harvest (preferredTool/canHarvest from items.ts) — never bedrock, never machines with contents. Melee attack 6-8.
- Buckets: an empty Bucket used on water -> WaterBucket (the water cell becomes air), on lava -> LavaBucket; a filled bucket places its liquid in the cell against the clicked face and returns an empty Bucket (ctx.replaceHeld). Water/lava are static blocks in this game (no flow) — keep it that way.
- TNT: flint and steel on TNT (registerItemUse(Item.FlintAndSteel) returning true ONLY for TNT so portal lighting still works) removes the block and spawns a primed TNT entity (flashing white, falls with gravity) that explodes after ~4s. services.explode(ctx, x, y, z, power): destroy blocks in a rough sphere scaled by power and resisted by hardness (obsidian, bedrock, portals, liquids unaffected), drop ~30% of destroyed blocks as items, damage and knock back the player (ctx.damagePlayer / ctx.pushPlayer, falling off with distance, blocked partly by armour automatically) and mobs (ctx.hurtMob), prime nearby TNT (chain reaction, short fuse), and a burst of break particles. The creatures pack's exploding mob calls services.explode.
- Gravity blocks: Sand, Gravel (and TNT? no) fall when the block under them is air or liquid: registerNeighbourChange + registerAfterPlace for them; a falling-block system draws the block (a cube with its textures, via the atlas UVs), lands on the first solid/replaceable surface and re-places itself (or drops as an item if it lands in a non-replaceable cell, e.g. on a torch).
- Bounce pad: bounce ~0.85, a low spring model (e.g. a 12/16 slab with a pad box on top), textures of a springy pad. Sneaking lands normally (the physics already does this).
- Recipes (original but sensible): bow (3 sticks + 3 Item.String), arrows (Stick + Item.Feather + Item.CopperIngot -> 4), hammers (a T of material blocks/ingots on 2 sticks — must not collide with any existing recipe pattern: check findRecipe against the full RECIPES list), bucket (3 iron in a V), TNT (Item.FusePowder + Block.Sand checkerboard), bounce pad (Item.Slimeball + planks + iron). Category: combat / tools / redstone.
- Textures in art/combat.ts: TNT top/side/bottom (original design, readable as an explosive), bounce pad, and entity tiles for arrows in flight / primed TNT flash if you need them. LOOK at them (sheet.ts, scene.ts). For entity meshes, build them and render with tests/diagnostics/offscreen.ts renderMeshes.
- tests/combat.ts: projectile arcs fall under gravity and stop at blocks, arrows hurt mobs and not their shooter, bow power scales with draw time and consumes arrows, hammer breaks exactly the harvestable 3x3 plane, buckets fill/empty with correct transitions (canReplace allows them), explosion radius/resistance/drops/damage falloff/chain reaction behave, sand falls and re-lands, a falling block onto a torch drops as an item, bounce pad reflects a landing and sneaking cancels it, recipes are unambiguous against the whole recipe list. Use a fake GameContext (a small object implementing the methods you need over a real ClientWorld) — the api was designed for exactly that.`,
},
{
  key: 'creatures',
  brief: `YOUR AREA: THE CREATURES PACK — new mobs, much better mob models and animation, and their drops.

You own: shared/src/mobs.ts, client/src/mobs.ts, client/src/gfx/mobmesh.ts, client/src/gfx/art/entities.ts (the mob skins in it; keep the player, vehicle, crack and hand tiles working), client/src/gfx/art/creatures.ts, shared/src/content/creatures.ts, client/src/content/creatures.ts, tests/mobs.ts (existing), tests/creatures.ts (new).

Block (id reserved): Cobweb (a full-cell sprite or cross, not solid, speedFactor ~0.15 — the physics already slows the player in it; shears or a sword harvest it into String). Items: Bone, String, Slimeball, FusePowder, RawFish, CookedFish (smelting), Shears (tool kind 'shears', fast on leaves, wool and cobwebs), RawRabbit, CookedRabbit (smelting). Texture names from the table; the icon engineers draw the item icons.

New mobs (add MobKind members after the existing ones; original designs):
- Spider: hostile in darkness, neutral in daylight unless hit; low and wide (width ~1.3); CLIMBS walls (when blocked horizontally while chasing, it climbs); 8 jointed legs with a gait, red eyes; drops String (0-2).
- Skeleton: hostile in darkness; keeps its distance (strafes at ~8-12 blocks) and shoots arrows through services.shoot(ctx, {..., kind: 'arrow', shooter: mob}) — the combat pack implements it; with no implementation nothing happens, which is fine; drops Bone (0-2) and Item.Arrow (0-2).
- Boomshroom: an ORIGINAL exploding mob — a walking mushroom creature (fat spotted cap, stubby legs). It creeps toward the player, and within ~3 blocks swells and flashes for ~1.5s, then calls services.explode(ctx, x, y, z, 3) and is removed (no drops from its own blast); if the player backs off during the fuse it calms down. Killed normally, drops FusePowder (0-2). Spawns in darkness.
- Slime: a translucent-looking bouncing cube (outer shell + inner core boxes), hops toward the player, sizes 3 -> splits into two size 2 -> each into two size 1 on death; only the smallest drop Slimeball; damage scales with size.
- Wolf: neutral pack animal; right-click with a Bone (registerMobUse) has a chance to tame it: a tamed wolf (collar colour on the model) follows the player, teleports to them if far, and attacks mobs that hurt the player or that the player attacks; it sits if you right-click it with an empty hand (nice to have).
- Bat: small ambient flier in caves, erratic flight, passive; flees daylight.
- Rabbit: small passive hopper that flees the player; drops RawRabbit (0-1) and Leather (0-1).
- Fish: swims only in water, passive, darts away; out of water it flops and takes damage; drops RawFish. Spawns in water.
Existing mobs, much better: pig (snout, ears, curly tail), cow (horns, udder, patchy hide), sheep (woolly body separate from the skinny legs and face; SHEARABLE — registerMobUse with Item.Shears drops 1-3 Block.WhiteWool (building pack id) and shows a sheared skin; wool regrows after a while), chicken (wattle, flapping wings, bobbing head), zombie (swaying arms, lurch), blaze (rotating rod rings, glowing core), enderman (long limbs, open jaw when angry), dragon (segmented neck and tail, jaw, bigger wings).
Animation and feel: leg swing from the hip (proper pivots), heads turn toward a nearby player, attack animations, a hurt flash plus knockback (Mob.hurt already receives fromX/fromZ — implement it), and a death animation (tip over and fade over ~0.8s before removal — MobWorld owns removal; hurtMob in main.ts marks death and hands out drops immediately, so the corpse must not be attackable or collide).
Physics: mob collision must use the real block shapes (import collisionBoxesAt from client/src/player.ts) so mobs walk on slabs/stairs and CANNOT hop over a fence (fence collision is 1.5 high; the current STEP_UP of 1.05 must not clear it). Keep the substepping and the "no tunnelling" guarantees.
Spawning: per-mob rules (dimension, light/darkness, surface, water for fish, caves for bats), sensible caps, hostiles only in darkness; don't spawn inside non-air (pay attention to plants/replaceable blocks from the nature pack: spawning into tall grass is fine).
Skins in art/entities.ts / art/creatures.ts: Minecraft-LIKE readability, original art; faces on the front, clear eyes. Register new skin tiles in the module's EXTRA list so they are packed into the atlas.
LOOK constantly: npx tsx tests/diagnostics/scene.ts --mobs=all --yaw=35 (and --yaw=150, --yaw=250, --phase=0 / --phase=1.6 for the gait) --out=.scratch/mobs.png. Iterate until every mob is charming, proportioned and instantly recognisable.
tests/creatures.ts (and keep tests/mobs.ts passing): each new mob's AI state machine (spider climbs a wall when chasing, skeleton keeps range and calls services.shoot, boomshroom fuse starts in range / cancels out of range / calls services.explode once, slime splits into the right sizes and only the smallest drops slimeballs, wolf tames with a bone and then follows, fish dies out of water, bat avoids light), knockback direction, death animation lifetime and no collision/attack while dying, fence blocks mob movement but a slab does not, shearing drops wool and flips the sheared state, spawn rules respect light/dimension/water, drops within ranges.`,
},
]

const RESULT = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    commit: { type: 'string' },
    summary: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    tests: { type: 'string' },
    visuals: { type: 'string' },
    requests: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'commit', 'summary', 'files', 'tests', 'visuals', 'requests', 'risks'],
}

phase('Build')
log('Launching 8 engineers in isolated worktrees from ' + BASE)
// Resuming after an interruption: args.resume maps an area to the progress its
// last attempt saved (a commit, plus an optional patch and tarball of work that
// was never committed). Areas without an entry get exactly the prompt they had
// before, so finished agents come back from the cache untouched.
// Two areas were already under way when the local run was moved to the cloud;
// their progress is on pushed branches. Pass args.resume to override.
const RESUME = (args && args.resume) || {
  'terrain-art': { branch: 'wip/terrain-art', note: 'The redraw looks complete (last commit "Redraw the terrain and material tiles as original pixel art"): verify everything in your brief, finish anything missing, run the full checks, and report.' },
  'equipment-icons': { branch: 'wip/equipment-icons', note: 'Icons were redrawn from pixel maps and a silhouette-distinctness test exists; the 3D held/dropped item extrusion is probably not started.' },
}
function resumeText(r) {
  const start = r.branch
    ? 'git fetch origin ' + r.branch + ' && git reset --hard FETCH_HEAD'
    : 'git reset --hard ' + r.commit
  return '\n\nRESUMING: a previous attempt at YOUR area was cut off. Do not start over. ' +
    (r.note ? r.note + ' ' : '') +
    'After the foundation check, run: ' + start +
    (r.patch ? ' && git apply --whitespace=nowarn "' + r.patch + '"' : '') +
    (r.tar ? ' && tar -xf "' + r.tar + '"' : '') +
    ' -- then read what is already there (git log, git diff, the files you own), commit it as a WIP checkpoint, and continue from where it stopped.'
}
const results = await parallel(BRIEFS.map((b) => () =>
  agent(PREAMBLE + (RESUME[b.key] ? resumeText(RESUME[b.key]) : '') + '\n\n=====================================================\nYOUR AREA KEY: ' + b.key + '\n' + b.brief, {
    label: 'build:' + b.key,
    phase: 'Build',
    schema: RESULT,
    isolation: 'worktree',
    // High rather than the session's xhigh: this is long, well-specified
    // work, and the plan's usage limit is the real bottleneck.
    effort: 'high',
  }).then((r) => ({ key: b.key, ...(r || { missing: true }) }))
))
return results.filter(Boolean)
