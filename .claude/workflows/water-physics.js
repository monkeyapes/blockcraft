export const meta = {
  name: 'water-physics',
  description: 'Add flowing water and lava physics to the Blockcraft web game',
  phases: [{ title: 'Build', detail: 'one engineer in a worktree' }],
}

const BRIEF = `You are adding WATER (and lava) PHYSICS to Blockcraft, an original Minecraft-inspired voxel game (TypeScript monorepo: shared/, client/, server/; repo root = your git worktree). Today water and lava are static blocks: a bucket pours one block and it just sits there. The user asked for water physics.

FIRST: run "git merge-base --is-ancestor 1b9e6ad HEAD || git reset --hard 1b9e6ad" (main at 1b9e6ad has everything). If npx tsx/tsc cannot resolve modules, link the main checkout's node_modules into the worktree root: cmd //c mklink /J node_modules D:\\\\idks\\\\node_modules (never commit it). Shell: Git Bash on Windows.

READ FIRST: shared/src/blockids.ts, shared/src/blocks.ts (canReplace, families, BlockDef), shared/src/content/types.ts and index.ts (content packs), shared/src/shapes.ts + shapekit.ts, client/src/content/api.ts (hooks: registerNeighbourChange, registerSystem, GameContext.setBlock obeys canReplace), client/src/content/combat.ts and client/src/content/combat/falling.ts (falling sand: the pattern to follow), client/src/content/combat.ts buckets, client/src/mesher.ts, client/src/player.ts (swimming via isLiquid), client/src/mobs.ts (mob swimming/fish), client/src/machines.ts (dropped items; the water wheel checks for Block.Water), tests/combat.ts (a fake GameContext over a real ClientWorld).

WHAT TO BUILD (Minecraft-like, original code):
- Flowing states. Add a new content pack "fluids" (shared/src/content/fluids.ts + client/src/content/fluids.ts + client/src/gfx/art/fluids.ts, registered in shared/src/content/index.ts, client/src/content/index.ts and client/src/gfx/art/index.ts — you may edit those three index files and blockids.ts for this). Reserve ids 210-229 for fluids in blockids.ts (add a commented range like the others). Water flows up to 7 blocks horizontally from a source, one level lower per block (levels 1..7), and falls straight down as a "falling" state; lava flows 3 blocks (slower). All water states share a family with Block.Water (the source) and all lava states with Block.Lava so the server accepts level changes; flowing states are liquid, replaceable-by-placement, not breakable, drop nothing, and are hidden from creative.
- Flow simulation: a registerSystem that owns a queue of cells to update, driven by registerNeighbourChange on water/lava states and on anything next to them, plus after-place of a source (bucket, creative). Water updates about every 0.25 s, lava about every 1.5 s. Rules: a flowing cell's level = 1 + min(level of horizontal neighbours that feed it) (sources are level 0), falling water feeds straight down at full strength, water prefers to flow toward the nearest drop within ~4 blocks (like Minecraft), cells whose feed disappears dry up level by level, two sources next to each other on a solid floor make a new source ("infinite water"). Flowing liquid washes away replaceable/non-solid things in its path (tall grass, flowers, torches, crops, cobwebs) dropping their items. Bounded work per frame (a budget of cell updates) so a big flood never stalls the game; a hard cap on flood size is fine.
- Water meets lava: flowing lava touching water becomes cobblestone, a lava SOURCE touching water becomes obsidian, water flowing onto lava from above makes stone (the combat pack's buckets already do some of this for pouring -- keep that consistent, don't duplicate its logic, move it into the fluids pack if cleaner).
- Rendering: liquid height follows level (source ~14/16 tall, each level lower; falling water full height), with the top face sloped toward the flow if feasible, otherwise flat at the level's height. The mesher currently draws liquids as full cubes -- make the change in the mesher cleanly (you may edit client/src/mesher.ts for liquids), and keep water translucent in the alpha pass. Hidden faces between water cells must stay culled.
- Physics: the player and mobs in flowing water are pushed along the flow direction (gentle current), dropped items float and drift with the current (client/src/machines.ts dropped items -- you may edit for this), swimming works in every level, falling into water cancels fall damage as today.
- Buckets: only a SOURCE fills a bucket; pouring places a source that then flows.
- The water wheel keeps working with flowing water too (it checks for Block.Water today -- make it accept any water state).
- Worldgen stays static (oceans and lakes are sources; don't simulate generation-time water). Make sure loading a world does NOT start every ocean flowing: only cells touched by a change are queued.
- Multiplayer: flows are computed client-side like falling sand and sent as setBlock edits; canReplace must accept them (families). Check the server/local link accept the transitions (tests/content.ts checks families).

QUALITY BAR: tests in tests/fluids.ts (house style: check(label, ok, extra), PASS/FAIL, process.exitCode not process.exit) that drive the real hooks over a real ClientWorld with a fake GameContext: a source on a flat floor spreads to exactly 7 blocks with the right levels, stops at walls, falls down cliffs and spreads again below, prefers a nearby drop, dries up when the source is removed, two sources make a new source, lava/water make obsidian/cobblestone/stone correctly, flowing water breaks a torch and a flower (with drops), an ocean chunk loaded from generation does not start updating, the per-frame budget holds under a large flood, the player is pushed by a current, buckets only fill from sources. Mutation-test your key checks. Keep every existing test passing (run them all: for t in $(grep -o 'tests/[a-z0-9-]*\\.ts' package.json); do npx tsx $t; done) and add tests/fluids.ts to the npm test script in package.json. Typecheck client and server (npx tsc -p client/tsconfig.json --noEmit; npx tsc -p server/tsconfig.json --noEmit).
LOOK at it: render a waterfall off a cliff, a spreading pool and a lava/water meeting with tests/diagnostics/scene.ts (--scene with [[x,y,z,"BlockName"],...]) and view the PNG with your Read tool; iterate until the water surface looks right.

Match the code style: TypeScript, prose comments explaining WHY, strict types, no unused locals. COMMIT EARLY AND OFTEN (each commit must typecheck) and push every commit: git push -f origin HEAD:refs/heads/wip/water-physics. Author env: GIT_AUTHOR_NAME=monkeyapes GIT_AUTHOR_EMAIL=muratmeteyildiz580@gmail.com GIT_COMMITTER_NAME=monkeyapes GIT_COMMITTER_EMAIL=muratmeteyildiz580@gmail.com, trailer "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Finish with the structured result.`

const RESULT = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, commit: { type: 'string' },
    summary: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    tests: { type: 'string' },
    requests: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'commit', 'summary', 'files', 'tests', 'requests', 'risks'],
}

phase('Build')
const resume = args && args.resume
const r = await agent(BRIEF + (resume ? '\n\nRESUMING: a previous attempt was cut off. After the base check: git fetch origin ' + resume + ' && git reset --hard FETCH_HEAD, read what is there, continue.' : ''), {
  label: 'water-physics', phase: 'Build', schema: RESULT, isolation: 'worktree', effort: 'high',
})
return r
