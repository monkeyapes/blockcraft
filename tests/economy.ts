/**
 * The SMP economy.
 * Run: npx tsx tests/economy.ts
 *
 * The failure worth fearing is not a crash, it is money appearing from
 * nowhere. A shop that pays more for something than it charges, a kill that
 * credits the killer more than it debits the victim, a payment that lands
 * twice -- any of those and the currency is worthless inside a week, and
 * nothing in the log looks wrong while it happens.
 *
 * So most of what follows is conservation: after every operation, count all
 * the money on the server and check it went where it was supposed to.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KILL_CAP, KILL_COOLDOWN_S, MAX_PAY, STARTING_BALANCE, formatMoney,
  killTransfer, payProblem, priceOf, shopItems,
} from '../shared/src/economy.js';
import { Block } from '../shared/src/blocks.js';
import { Item } from '../shared/src/items.js';
import { Economy, type EconomyHooks } from '../server/src/economy.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- the shop cannot mint money -------------------------------------------

{
  const crossed = shopItems().filter(({ price }) => price.sell >= price.buy);
  check('nothing sells for at least what it costs to buy',
    crossed.length === 0,
    crossed.map((c) => `${c.id}: buy ${c.price.buy} sell ${c.price.sell}`).join(', '));
  check('every price is a positive whole number',
    shopItems().every(({ price }) =>
      Number.isInteger(price.buy) && Number.isInteger(price.sell) &&
      price.buy > 0 && price.sell > 0));
  check('the shop actually stocks a useful range', shopItems().length >= 20,
    String(shopItems().length));
  check('prices are sorted cheapest first, so /shop page 1 is the cheap page',
    shopItems().every((v, i, a) => i === 0 || a[i - 1].price.buy <= v.price.buy));
}

// --- the kill cut ----------------------------------------------------------

check('killing somebody with nothing pays nothing', killTransfer(0) === 0);
check('a negative balance cannot pay out', killTransfer(-500) === 0);
check('a quarter is taken', killTransfer(400) === 100);
check('the cut is capped', killTransfer(10_000_000) === KILL_CAP);
check('the cut is always a whole number',
  Number.isInteger(killTransfer(333)) && killTransfer(333) === 83);

// --- refusing bad payments -------------------------------------------------

const rich = { name: 'Ada', balance: 1000 };
check('paying more than you have is refused',
  payProblem(rich, 'Bob', 2000)?.includes('only have') === true);
check('paying nothing is refused', payProblem(rich, 'Bob', 0) !== null);
check('paying a negative amount is refused', payProblem(rich, 'Bob', -5) !== null);
check('paying a fraction is refused', payProblem(rich, 'Bob', 1.5) !== null);
check('paying yourself is refused', payProblem(rich, 'ada', 10) !== null);
check('a payment over the cap is refused',
  payProblem({ name: 'Ada', balance: 1e9 }, 'Bob', MAX_PAY + 1) !== null);
check('an ordinary payment is allowed', payProblem(rich, 'Bob', 100) === null);

// --- the live economy ------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), 'bc-econ-'));
const savePath = join(dir, 'economy.json');

const told: Array<{ to: string; text: string }> = [];
let inventory: Record<string, Record<number, number>> = {};
let grantAllowed = true;

const hooks: EconomyHooks = {
  onlineNames: () => ['Ada', 'Bob', 'Carol'],
  tell: (to, text) => told.push({ to, text }),
  grant: (name, item, count) => {
    if (!grantAllowed) return false;
    inventory[name] ??= {};
    inventory[name][item] = (inventory[name][item] ?? 0) + count;
    return true;
  },
  take: (name, item, count) => {
    const have = inventory[name]?.[item] ?? 0;
    const taken = Math.min(have, count);
    if (taken > 0) inventory[name][item] = have - taken;
    return taken;
  },
};

const econ = new Economy(savePath, hooks);
const NAMES = ['Ada', 'Bob', 'Carol'];
const total = () => NAMES.reduce((s, n) => s + econ.balance(n), 0);
const lastTold = (to: string) =>
  [...told].reverse().find((t) => t.to === to)?.text ?? '';

check('everyone starts with the same balance',
  econ.balance('Ada') === STARTING_BALANCE && econ.balance('Bob') === STARTING_BALANCE);
check('a name is an identity regardless of case',
  econ.balance('ADA') === econ.balance('Ada'));

// Payments move money without creating any.
{
  const before = total();
  econ.handleChat('Ada', '/pay Bob 20');
  check('a payment moves money',
    econ.balance('Ada') === STARTING_BALANCE - 20 &&
    econ.balance('Bob') === STARTING_BALANCE + 20,
    `Ada ${econ.balance('Ada')} Bob ${econ.balance('Bob')}`);
  check('and creates none', total() === before, `${before} -> ${total()}`);
  check('and both sides are told', told.some((t) => t.to === 'Bob' && /sent you/.test(t.text)));
}
{
  const before = total();
  econ.handleChat('Ada', '/pay Bob 99999');
  check('an unaffordable payment changes nothing', total() === before);
  check('and says why', /only have/.test(lastTold('Ada')), lastTold('Ada'));
}
// A prefix is enough, but only when it is unambiguous.
{
  econ.handleChat('Ada', '/pay Car 5');
  check('a unique prefix resolves', econ.balance('Carol') === STARTING_BALANCE + 5);
}

// Kills: the killer gains exactly what the victim loses.
{
  const before = total();
  const bobBefore = econ.balance('Bob');
  const moved = econ.recordKill('Ada', 'Bob');
  check('a kill transfers a quarter', moved === Math.floor(bobBefore * 0.25),
    `moved ${moved} of ${bobBefore}`);
  check('the killer gains exactly what the victim loses', total() === before,
    `${before} -> ${total()}`);
  check('both are told what happened',
    /took .* from Bob/.test(lastTold('Ada')) && told.some((t) => t.to === 'Bob' && /took/.test(t.text)));
}
{
  // Immediately again: the cooldown must stop farming one person.
  const before = total();
  const moved = econ.recordKill('Ada', 'Bob');
  check('killing the same player again straight away pays nothing', moved === 0);
  check('and no money moves', total() === before);
  check('and the killer is told why', /too recently/.test(lastTold('Ada')), lastTold('Ada'));
}
{
  // Past the cooldown it pays again.
  const moved = econ.recordKill('Ada', 'Bob', Date.now() + KILL_COOLDOWN_S * 1000 + 1000);
  check('after the cooldown it pays again', moved > 0, String(moved));
}
check('killing yourself pays nothing', econ.recordKill('Ada', 'Ada') === 0);
{
  // Somebody with nothing is not a free income stream.
  econ.handleChat('Carol', `/pay Ada ${econ.balance('Carol')}`);
  const before = total();
  const moved = econ.recordKill('Bob', 'Carol');
  check('killing a player with nothing pays nothing', moved === 0 && total() === before);
}

// The shop: buying costs, selling pays, and neither invents money.
{
  const before = econ.balance('Ada');
  econ.handleChat('Ada', '/buy coal 2');
  const price = priceOf(Item.Coal)!;
  check('buying charges the listed price',
    econ.balance('Ada') === before - price.buy * 2,
    `${before} -> ${econ.balance('Ada')}`);
  check('and the items arrive', (inventory['Ada']?.[Item.Coal] ?? 0) === 2);
}
{
  const before = econ.balance('Ada');
  econ.handleChat('Ada', '/sell coal 2');
  const price = priceOf(Item.Coal)!;
  check('selling pays the listed price',
    econ.balance('Ada') === before + price.sell * 2);
  check('and the items go', (inventory['Ada']?.[Item.Coal] ?? 0) === 0);
}
{
  // The loop that would break everything: buy then sell must lose money.
  // Cobblestone, not diamond -- Ada has been spending, and a purchase she
  // cannot afford makes this pass by doing nothing at all.
  const start = econ.balance('Ada');
  econ.handleChat('Ada', '/buy cobblestone 1');
  econ.handleChat('Ada', '/sell cobblestone 1');
  check('buying then selling loses money rather than making it',
    econ.balance('Ada') < start, `${start} -> ${econ.balance('Ada')}`);
  check('and the round trip was actually affordable, so the check above ran',
    start >= priceOf(Block.Cobblestone)!.buy, `balance ${start}`);
}
{
  // A full inventory must not charge for goods it could not hand over.
  grantAllowed = false;
  const before = econ.balance('Ada');
  econ.handleChat('Ada', '/buy cobblestone 1');
  check('a failed delivery does not take the money', econ.balance('Ada') === before);
  check('and says so', /no room/i.test(lastTold('Ada')), lastTold('Ada'));
  grantAllowed = true;
}
{
  const before = econ.balance('Bob');
  econ.handleChat('Bob', '/sell diamond 5');
  check('selling what you do not have pays nothing', econ.balance('Bob') === before);
}
{
  // Two-word item names, with and without a count.
  econ.handleChat('Ada', '/buy iron ingot 2');
  check('a two-word item name works', (inventory['Ada']?.[Item.IronIngot] ?? 0) === 2,
    lastTold('Ada'));
}
{
  const before = econ.balance('Ada');
  econ.handleChat('Ada', '/buy nonsense 1');
  check('an unknown item is refused without charging', econ.balance('Ada') === before);
  check('and points at the shop', /shop/i.test(lastTold('Ada')), lastTold('Ada'));
}

// Commands the economy does not own must be left alone.
check('an unrelated command is not swallowed',
  econ.handleChat('Ada', '/tp spawn') === false);
check('ordinary chat is not swallowed',
  econ.handleChat('Ada', 'hello everyone') === false);
check('an economy command is claimed', econ.handleChat('Ada', '/bal') === true);

// --- persistence -----------------------------------------------------------

{
  const adaBefore = econ.balance('Ada');
  econ.save();
  const reloaded = new Economy(savePath, hooks);
  check('balances survive a restart', reloaded.balance('Ada') === adaBefore,
    `${adaBefore} vs ${reloaded.balance('Ada')}`);
  check('and so does the kill cooldown, so a restart is not a farm reset',
    reloaded.recordKill('Ada', 'Bob') === 0);
}

// --- panels ----------------------------------------------------------------
//
// The panels and the chat commands run the same buy and sell underneath, so
// what matters here is that the drawn version says the same thing the typed
// version does -- a shop that advertises one price in a window and charges
// another at the prompt is the failure to avoid.

{
  const shop = econ.panel('Ada', 'shop');
  check('the shop panel lists items with prices',
    shop.rows.length > 0 && shop.rows.every((r) => r.detail?.startsWith('$')),
    JSON.stringify(shop.rows[0]));
  check('and offers buy actions',
    shop.rows.every((r) => r.actions?.includes('buy')));
  check('and carries tabs so the other screens are reachable',
    (shop.tabs?.length ?? 0) >= 4 && shop.active === 'shop');
  check('and says what the player has',
    shop.subtitle?.includes(formatMoney(econ.balance('Ada'))) === true, shop.subtitle);

  // Anything unaffordable is greyed out with a reason rather than failing on
  // the click.
  const dear = shop.rows.find((r) => r.disabled);
  const expensive = econ.panel('Ada', 'shop', '3').rows.find((r) => r.disabled);
  check('items beyond the balance are marked, not hidden',
    !!(dear || expensive), 'no disabled row on any page');
}

{
  const before = econ.balance('Ada');
  const after = econ.panelAction('Ada', 'shop', 'buy', String(Block.Cobblestone), 1);
  check('buying through a panel charges the same as the command',
    econ.balance('Ada') === before - priceOf(Block.Cobblestone)!.buy,
    `${before} -> ${econ.balance('Ada')}`);
  check('and reports what happened in the panel itself',
    after.notice?.includes('Bought') === true, after.notice);
  check('and hands back the same screen the player was on', after.id === 'shop');
}

{
  const bogus = econ.panelAction('Ada', 'shop', 'buy', 'not-an-item');
  check('a panel action for something unsellable is refused, not crashed',
    bogus.notice?.includes('does not deal') === true, bogus.notice);
}

{
  const top = econ.panel('Ada', 'baltop');
  check('the leaderboard is ranked highest first',
    top.rows.length > 0 && top.rows[0].label.startsWith('1.'), JSON.stringify(top.rows[0]));
  check('and shows the name as its owner types it, not the lookup key',
    top.rows.some((r) => r.label.includes('Ada')),
    top.rows.map((r) => r.label).join(' | '));
}

{
  const me = econ.panel('Ada', 'me');
  check('the player panel shows a balance and a rank',
    me.rows.some((r) => r.label === 'Balance') && me.rows.some((r) => r.label === 'Rank'),
    JSON.stringify(me.rows.map((r) => r.label)));
}

check('money formats readably', formatMoney(1234567) === '$1,234,567');

rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
