/**
 * Advancements: the game's answer to "what am I meant to do now?".
 *
 * A voxel sandbox hands you a world and no instructions, and the interesting
 * systems here -- the Nether, NoVolt, the dragon -- are invisible until
 * someone tells you they exist. Each entry names a next step rather than
 * rewarding a past one, so the list reads as a trail to follow.
 *
 * Triggers are plain data so the client fires them from wherever the event
 * naturally happens, and the whole set can be tested without a running game.
 */

import { Block } from './blocks.js';
import { Item } from './items.js';

/** What can set an advancement off. */
export type Trigger =
  | { kind: 'craft'; id: number }
  | { kind: 'mine'; id: number }
  | { kind: 'place'; id: number }
  | { kind: 'pickup'; id: number }
  | { kind: 'dimension'; id: number }
  | { kind: 'ride'; kind2: string }
  | { kind: 'event'; name: string };

export interface Advancement {
  id: string;
  title: string;
  /** One line saying what it unlocked or what to try next. */
  description: string;
  trigger: Trigger;
  /** Shown as the icon; an existing block or item id. */
  icon: number;
  /** Only revealed once earned, for the ending beats. */
  secret?: boolean;
}

export const ADVANCEMENTS: Advancement[] = [
  {
    id: 'wood', title: 'Getting Wood',
    description: 'Punch a tree. Everything starts here.',
    trigger: { kind: 'mine', id: Block.Log }, icon: Block.Log,
  },
  {
    id: 'bench', title: 'Somewhere to Work',
    description: 'A crafting table gives you the full 3x3 grid.',
    trigger: { kind: 'craft', id: Block.CraftingTable }, icon: Block.CraftingTable,
  },
  {
    id: 'pickaxe', title: 'Time to Mine',
    description: 'Stone needs a pickaxe. Better pickaxes reach better ore.',
    trigger: { kind: 'craft', id: Item.WoodPickaxe }, icon: Item.WoodPickaxe,
  },
  {
    id: 'iron', title: 'Hot Stuff',
    description: 'Smelt iron ore in a furnace. Iron opens up the machines.',
    trigger: { kind: 'pickup', id: Item.IronIngot }, icon: Item.IronIngot,
  },
  {
    id: 'diamond', title: 'Diamonds!',
    description: 'The best tools, and the way into the End.',
    trigger: { kind: 'pickup', id: Item.Diamond }, icon: Item.Diamond,
  },
  {
    id: 'bed', title: 'Good Night',
    description: 'Sleep to skip the night and set where you respawn.',
    trigger: { kind: 'craft', id: Block.Bed }, icon: Block.Bed,
  },
  {
    id: 'boat', title: 'Set Sail',
    description: 'Water stops being a wall.',
    trigger: { kind: 'ride', kind2: 'boat' }, icon: Item.Boat,
  },
  {
    id: 'flight', title: 'Slipped the Surly Bonds',
    description: 'Take off in a plane or a helicopter.',
    trigger: { kind: 'event', name: 'flew' }, icon: Item.Plane,
  },

  // --- automation ---------------------------------------------------------
  {
    id: 'belt', title: 'Things That Move',
    description: 'Conveyors carry dropped items. Point them where you want them.',
    trigger: { kind: 'place', id: Block.Conveyor }, icon: Block.Conveyor,
  },
  {
    id: 'novolt', title: 'No Volts Required',
    description: 'A generator pushes NoVolt down conduit. Keep machines close to it.',
    trigger: { kind: 'place', id: Block.Generator }, icon: Block.Generator,
  },
  {
    id: 'conduit', title: 'Wired Up',
    description: 'Every block of conduit costs pressure. Boosters buy it back.',
    trigger: { kind: 'place', id: Block.Cable }, icon: Block.Cable,
  },
  {
    id: 'crusher', title: 'Double or Nothing',
    description: 'A powered crusher doubles your ore. It will not run without NoVolt.',
    trigger: { kind: 'place', id: Block.Crusher }, icon: Block.Crusher,
  },
  {
    id: 'solar', title: 'Free Lunch',
    description: 'Solar needs open sky, and rain halves it. Batteries cover the gap.',
    trigger: { kind: 'place', id: Block.SolarPanel }, icon: Block.SolarPanel,
  },
  {
    id: 'stonegen', title: 'Stone From Nowhere',
    description: 'A stone generator turns NoVolt into cobblestone, forever.',
    trigger: { kind: 'place', id: Block.StoneGenerator }, icon: Block.StoneGenerator,
  },
  {
    id: 'quarry', title: 'Industrial Scale',
    description: 'A quarry clears nine columns at once, and drinks power to do it.',
    trigger: { kind: 'place', id: Block.Quarry }, icon: Block.Quarry,
  },

  // --- the ending ---------------------------------------------------------
  {
    id: 'nether', title: 'Into the Fire',
    description: 'Blaze rods are down here. You will need them for eyes of ender.',
    trigger: { kind: 'dimension', id: 1 }, icon: Block.Netherrack,
  },
  {
    id: 'eye', title: 'Eye of Ender',
    description: 'Blaze powder plus an ender pearl. The End portal wants twelve.',
    trigger: { kind: 'craft', id: Item.EyeOfEnder }, icon: Item.EyeOfEnder,
  },
  {
    id: 'end', title: 'The End?',
    description: 'Something very large lives here.',
    trigger: { kind: 'dimension', id: 2 }, icon: Block.EndStone, secret: true,
  },
  {
    id: 'dragon', title: 'Free the Sky',
    description: 'You beat the Ender Dragon. The world is yours.',
    trigger: { kind: 'event', name: 'dragon' }, icon: Item.EyeOfEnder, secret: true,
  },
];

/** Every advancement whose trigger matches, for the client to award. */
export function matching(trigger: Trigger): Advancement[] {
  return ADVANCEMENTS.filter((a) => {
    const t = a.trigger;
    if (t.kind !== trigger.kind) return false;
    if (t.kind === 'ride' && trigger.kind === 'ride') return t.kind2 === trigger.kind2;
    if (t.kind === 'event' && trigger.kind === 'event') return t.name === trigger.name;
    if ('id' in t && 'id' in trigger) return t.id === trigger.id;
    return false;
  });
}

export function advancementById(id: string): Advancement | undefined {
  return ADVANCEMENTS.find((a) => a.id === id);
}
