/**
 * The SMP economy: money, a shop, and what happens when someone kills you.
 *
 * This is the layer that turns a survival world into a server people keep
 * coming back to. On its own, survival ends when you have diamond armour;
 * with an economy there is always something to be doing, and -- more to the
 * point -- other players stop being scenery and start being the reason
 * anything is interesting.
 *
 * The defining rule is the kill cut. Dying to a mob costs you nothing but
 * your stuff; dying to a *person* hands them a slice of your balance. That
 * one rule is what makes the world feel dangerous, makes carrying a large
 * balance a decision, and gives every fight a reason.
 *
 * Prices, cuts and limits live here because the client shows them and the
 * server enforces them, and the two disagreeing would mean a shop that
 * advertises one price and charges another.
 */

import { Block } from './blocks.js';
import { Item } from './items.js';

/** What a new player starts with. Enough for a first pickaxe, not a head start. */
export const STARTING_BALANCE = 50;

/**
 * The share of a victim's balance the killer takes.
 *
 * A quarter: enough that killing a rich player is worth the fight, low
 * enough that one bad death does not end somebody's week. Servers that take
 * everything end up with players who log off rather than risk what they have,
 * which is the opposite of the point.
 */
export const KILL_CUT = 0.25;

/** Nobody loses more than this in a single death, however rich they are. */
export const KILL_CAP = 5000;

/** Killing the same person again pays nothing for this long, in seconds. */
export const KILL_COOLDOWN_S = 120;

/** The largest single transfer, so a typo cannot empty an account. */
export const MAX_PAY = 1_000_000;

/** What the shop pays and charges. */
export interface Price {
  /** What it costs to buy one. */
  buy: number;
  /** What the shop pays for one. Always below buy, or money appears. */
  sell: number;
}

/**
 * The shop's stock.
 *
 * Sell prices sit well under buy prices throughout. If any pair ever crossed,
 * a player could buy and sell in a loop and mint money out of nothing -- so
 * the gap is not a margin, it is the thing that stops the economy collapsing.
 * There is a test that checks every line.
 */
export const SHOP: Partial<Record<Item | Block, Price>> = {
  // Raw materials: the floor of the economy, and what mining is worth.
  [Block.Cobblestone]: { buy: 2, sell: 1 },
  // Buy 2 / sell 1, not 1 / 1. Equal prices are a free round trip: no
  // profit, but no loss either, and the invariant the whole economy rests
  // on is that every trip through the shop costs something.
  [Block.Dirt]: { buy: 2, sell: 1 },
  [Block.Sand]: { buy: 2, sell: 1 },
  [Block.Log]: { buy: 8, sell: 4 },
  [Block.Planks]: { buy: 3, sell: 1 },
  [Item.Coal]: { buy: 12, sell: 6 },
  [Item.IronIngot]: { buy: 40, sell: 20 },
  [Item.GoldIngot]: { buy: 70, sell: 35 },
  [Item.Diamond]: { buy: 300, sell: 150 },

  // Tools: buyable, so a fresh spawn can get going without a mine.
  [Item.StonePickaxe]: { buy: 60, sell: 20 },
  [Item.IronPickaxe]: { buy: 220, sell: 80 },
  [Item.DiamondPickaxe]: { buy: 1400, sell: 500 },
  [Item.IronAxe]: { buy: 200, sell: 70 },
  [Item.FlintAndSteel]: { buy: 90, sell: 30 },

  // Armour: what money is mostly for, on a server where people fight.
  [Item.IronHelmet]: { buy: 200, sell: 70 },
  [Item.IronChestplate]: { buy: 320, sell: 110 },
  [Item.IronLeggings]: { buy: 280, sell: 95 },
  [Item.IronBoots]: { buy: 160, sell: 55 },
  [Item.DiamondHelmet]: { buy: 1500, sell: 520 },
  [Item.DiamondChestplate]: { buy: 2400, sell: 840 },
  [Item.DiamondLeggings]: { buy: 2100, sell: 730 },
  [Item.DiamondBoots]: { buy: 1200, sell: 420 },

  // The endgame ingredients, priced so buying the whole way is possible but
  // clearly worse than going and getting them.
  [Item.BlazeRod]: { buy: 400, sell: 160 },
  [Item.EnderPearl]: { buy: 350, sell: 140 },

  // Getting about.
  [Item.Boat]: { buy: 120, sell: 40 },
  [Item.Skateboard]: { buy: 200, sell: 70 },
  [Item.Car]: { buy: 2500, sell: 800 },
  [Item.Plane]: { buy: 6000, sell: 2000 },
};

/** Everything the shop deals in, in a stable order for listing. */
export function shopItems(): Array<{ id: number; price: Price }> {
  return Object.entries(SHOP)
    .map(([id, price]) => ({ id: Number(id), price: price! }))
    .sort((a, b) => a.price.buy - b.price.buy);
}

export function priceOf(id: number): Price | null {
  return SHOP[id as Item] ?? null;
}

/** Money as players see it. */
export function formatMoney(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

/**
 * What a kill is worth, and what it costs the victim.
 *
 * Returned as one object rather than two calls so the two can never disagree
 * -- the amount the killer gains is by definition the amount the victim
 * loses, and computing them separately is how servers end up minting money on
 * every fight.
 */
export function killTransfer(victimBalance: number): number {
  if (victimBalance <= 0) return 0;
  return Math.min(KILL_CAP, Math.floor(victimBalance * KILL_CUT));
}

/** Why a payment was refused, or null if it is fine. */
export function payProblem(
  from: { name: string; balance: number },
  toName: string,
  amount: number,
): string | null {
  if (!Number.isFinite(amount) || Math.floor(amount) !== amount) {
    return 'Amount must be a whole number.';
  }
  if (amount <= 0) return 'Amount must be more than zero.';
  if (amount > MAX_PAY) return `The most you can send at once is ${formatMoney(MAX_PAY)}.`;
  if (amount > from.balance) {
    return `You only have ${formatMoney(from.balance)}.`;
  }
  if (toName.toLowerCase() === from.name.toLowerCase()) {
    return 'You cannot pay yourself.';
  }
  return null;
}
