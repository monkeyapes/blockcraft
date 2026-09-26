/**
 * The content-pack foundation: the replace rule both sides enforce, the
 * shape vocabulary, and clicking through the empty parts of a block.
 * Run: npx tsx tests/content.ts
 *
 * The packs themselves have their own tests; this one checks the layer they
 * all stand on, so a failure here means every pack is suspect.
 */

import { BLOCKS, Block, blockDef, canReplace, isReplaceable } from '../shared/src/blocks.js';
import { WORLD_Y } from '../shared/src/constants.js';
import { ITEM_ID_BASE, Item, allItemIds, itemDef } from '../shared/src/items.js';
import { EAST, NORTH, SOUTH, WEST, px, rotateBoxes } from '../shared/src/shapekit.js';
import { collisionOf, crossOf, selectionOf, shapeOf } from '../shared/src/shapes.js';
import { RECIPES } from '../shared/src/recipes.js';
import { PACKS } from '../shared/src/content/index.js';
import { Player, rayBoxes } from '../client/src/player.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- the id space -----------------------------------------------------------

check('items start at 256, so every byte value is free for blocks', ITEM_ID_BASE === 256);
check('every item id sits at or above the base',
  allItemIds().every((id) => id >= ITEM_ID_BASE), allItemIds().slice(0, 5).join(','));
check('every block id fits in the byte a chunk stores it in',
  BLOCKS.every((d, i) => !d || (i >= 0 && i < 256)));
check('the renumbered items still resolve by name',
  itemDef(Item.Stick).name === 'Stick' && itemDef(Item.DiamondSword).name === 'Diamond Sword');
check('a block id is still its own item', itemDef(Block.Stone).name === 'Stone');

// --- the replace rule ---------------------------------------------------------

check('placing into air is allowed', canReplace(Block.Air, Block.Stone));
check('placing into water is allowed', canReplace(Block.Water, Block.Stone));
check('breaking a breakable block is allowed', canReplace(Block.Stone, Block.Air));
check('breaking bedrock is refused', !canReplace(Block.Bedrock, Block.Air));
check('scooping up water is allowed', canReplace(Block.Water, Block.Air));
check('turning stone straight into dirt is refused', !canReplace(Block.Stone, Block.Dirt));
check('an unknown id is refused', !canReplace(Block.Air, 250));
check('an item id is refused as a block', !canReplace(Block.Air, Item.Stick));
check('a no-op change is refused', !canReplace(Block.Stone, Block.Stone));
check('air counts as replaceable', isReplaceable(Block.Air));
check('stone does not', !isReplaceable(Block.Stone));

// Families and declared transitions, wherever the packs use them.
for (const pack of PACKS) {
  for (const [from, to] of pack.transitions ?? []) {
    check(`${pack.name}: declared change ${blockDef(from).name} -> ${blockDef(to).name} is allowed`,
      canReplace(from, to));
  }
}
const families = new Map<string, number[]>();
for (const d of BLOCKS) {
  if (!d?.family) continue;
  families.set(d.family, [...(families.get(d.family) ?? []), d.id]);
}
for (const [family, ids] of families) {
  const ok = ids.every((a) => ids.every((b) => a === b || canReplace(a, b)));
  check(`family "${family}": every state converts to every other`, ok, ids.join(','));
}

// --- the shape kit ----------------------------------------------------------

{
  // A box against the north wall, turned a quarter at a time.
  const north = [px(0, 0, 0, 16, 16, 4)];
  const east = rotateBoxes(north, EAST)[0];
  const south = rotateBoxes(north, SOUTH)[0];
  const west = rotateBoxes(north, WEST)[0];
  check('rotating east puts a north-wall box on the east wall',
    east.x0 === 12 / 16 && east.x1 === 1 && east.z0 === 0 && east.z1 === 1, JSON.stringify(east));
  check('rotating south puts it on the south wall',
    south.z0 === 12 / 16 && south.z1 === 1 && south.x0 === 0, JSON.stringify(south));
  check('rotating west puts it on the west wall',
    west.x0 === 0 && west.x1 === 4 / 16, JSON.stringify(west));
  check('rotating by zero is a copy, not the same object',
    rotateBoxes(north, NORTH)[0] !== north[0] && rotateBoxes(north, NORTH)[0].z1 === 4 / 16);
  check('four quarter turns come back where they started',
    JSON.stringify(rotateBoxes(north, 4)) === JSON.stringify(north));
  check('px carries a per-box texture', px(0, 0, 0, 1, 1, 1, 'planks').tex === 'planks');
}

check('an ordinary block is still one shared full cube',
  shapeOf(Block.Stone) === shapeOf(Block.Dirt) && collisionOf(Block.Stone) === shapeOf(Block.Stone));
check('an ordinary block is not a cross', crossOf(Block.Stone) === null);

// Every cross-shaped block: no boxes drawn, no collision, something to click.
for (const d of BLOCKS) {
  if (!d || !crossOf(d.id)) continue;
  check(`${d.name}: a cross is drawn as planes, not boxes`, shapeOf(d.id).length === 0);
  check(`${d.name}: a cross has something to click`, selectionOf(d.id).length > 0);
  check(`${d.name}: a cross plant is not solid`, !d.solid);
}

// --- recipes from packs --------------------------------------------------------

check('pack recipes are in the crafting list',
  PACKS.every((p) => (p.recipes ?? []).every((r) => RECIPES.includes(r))));

// --- clicking through the empty part of a cell -------------------------------------

{
  // A conduit is a thin post; a ray that passes beside it must reach the
  // stone behind rather than stopping at the conduit's cell.
  const world = {
    getBlock(x: number, y: number, z: number): number {
      if (y < 0 || y >= WORLD_Y) return Block.Air;
      if (x === 5 && y === 50 && z === 0) return Block.Cable;
      if (x === 8 && y === 50 && z === 0) return Block.Stone;
      return Block.Air;
    },
    isLoaded: () => true,
  } as any;
  const p = new Player();
  // The eye at the height of the conduit's hub (5/16..11/16 of the cell),
  // off to the side of it, looking along +x.
  p.x = 2.5; p.y = 50.5 - 1.62; p.z = 0.1; p.yaw = 0; p.pitch = 0;
  const hit = p.raycast(world, 10);
  check('a ray beside a thin post passes through its cell', hit?.id === Block.Stone,
    JSON.stringify(hit));
  check('and places against the face it struck', !!hit && hit.place?.[0] === 7,
    JSON.stringify(hit?.place));
  check('the struck face points back at the player', !!hit && hit.face[0] === -1,
    JSON.stringify(hit?.face));

  p.z = 0.5;
  const onPost = p.raycast(world, 10);
  check('a ray straight at the post hits it', onPost?.id === Block.Cable, JSON.stringify(onPost));
  check('the hit point is on the post, not the cell wall',
    !!onPost && onPost.point[0] > 5.3 && onPost.point[0] < 5.4, JSON.stringify(onPost?.point));
}

{
  const boxes = [px(0, 0, 0, 16, 8, 16)];
  const down = rayBoxes(0.5, 2, 0.5, 0, -1, 0, 0, 0, 0, boxes, 10);
  check('a ray from above lands on a slab top', !!down && Math.abs(down.t - 1.5) < 1e-9 &&
    down.face[1] === 1, JSON.stringify(down));
  const over = rayBoxes(-1, 0.75, 0.5, 1, 0, 0, 0, 0, 0, boxes, 10);
  check('a ray over a slab misses it', over === null, JSON.stringify(over));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
