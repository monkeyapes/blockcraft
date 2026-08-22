/**
 * Balances, the shop, and the chat commands that drive them.
 *
 * Kept apart from index.ts because everything here is a decision -- who can
 * afford what, what a kill is worth, whether a payment is allowed -- and
 * index.ts is sockets and chunks. The two mixed together would be untestable.
 *
 * Balances are keyed by name rather than by connection id, because an id
 * lasts one session and money has to survive a reconnect. That means names
 * are identities on an SMP, which is worth knowing: two people who pick the
 * same name share a wallet.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  KILL_CAP, KILL_COOLDOWN_S, STARTING_BALANCE, formatMoney, killTransfer,
  payProblem, priceOf, shopItems,
} from '@shared/economy.js';
import type { PanelRow, SPanel } from '@shared/protocol.js';
import { itemName } from '@shared/items.js';

/** What the economy needs from the server to act on the world. */
export interface EconomyHooks {
  /** Everyone connected, by name. */
  onlineNames(): string[];
  /** Sends a private line to one player. */
  tell(name: string, text: string): void;
  /** Puts items into a player's inventory. Returns false if it could not. */
  grant(name: string, item: number, count: number): boolean;
  /** Takes items out. Returns how many were actually taken. */
  take(name: string, item: number, count: number): number;
}

interface Account {
  /**
   * The name as its owner types it.
   *
   * Accounts are keyed by lowercase name so that Ada and ada are one wallet,
   * but the leaderboard has to show people their own name back, not the key.
   */
  display: string;
  balance: number;
  /** When this player was last killed by each other player, for the cooldown. */
  lastKilledBy: Record<string, number>;
}

export class Economy {
  private accounts = new Map<string, Account>();
  private dirty = false;

  constructor(private readonly savePath: string, private readonly hooks: EconomyHooks) {
    this.load();
  }

  /** Names are identities here, so they are matched case-insensitively. */
  private key(name: string): string {
    return name.toLowerCase();
  }

  private account(name: string): Account {
    const k = this.key(name);
    let a = this.accounts.get(k);
    if (!a) {
      a = { display: name, balance: STARTING_BALANCE, lastKilledBy: {} };
      this.accounts.set(k, a);
      this.dirty = true;
    }
    else if (a.display !== name) {
      a.display = name;
      this.dirty = true;
    }
    return a;
  }

  balance(name: string): number {
    return this.account(name).balance;
  }

  private adjust(name: string, delta: number): number {
    const a = this.account(name);
    a.balance = Math.max(0, a.balance + delta);
    this.dirty = true;
    return a.balance;
  }

  /**
   * Moves a cut of the victim's balance to the killer.
   *
   * The cooldown is per pair, so a group cannot farm one person by taking
   * turns, and killing somebody who has nothing is worth nothing -- otherwise
   * the cheapest income on the server is hunting new players, which is how an
   * SMP loses everybody who just joined.
   */
  recordKill(killerName: string, victimName: string, now = Date.now()): number {
    if (this.key(killerName) === this.key(victimName)) return 0;

    const victim = this.account(victimName);
    const last = victim.lastKilledBy[this.key(killerName)] ?? 0;
    if (now - last < KILL_COOLDOWN_S * 1000) {
      this.hooks.tell(killerName,
        `You killed ${victimName} too recently for that to pay.`);
      return 0;
    }

    const amount = killTransfer(victim.balance);
    victim.lastKilledBy[this.key(killerName)] = now;
    this.dirty = true;
    if (amount <= 0) {
      this.hooks.tell(killerName, `${victimName} had nothing worth taking.`);
      return 0;
    }

    this.adjust(victimName, -amount);
    this.adjust(killerName, amount);
    this.hooks.tell(killerName, `You took ${formatMoney(amount)} from ${victimName}.`);
    this.hooks.tell(victimName, `${killerName} took ${formatMoney(amount)} from you.`);
    return amount;
  }

  /**
   * Handles a chat line if it is an economy command.
   *
   * Returns true when it was handled, so the caller knows not to broadcast it
   * as chat. Getting that wrong is how a server ends up publishing everyone's
   * mistyped commands to the whole player list.
   */
  handleChat(name: string, text: string): boolean {
    if (!text.startsWith('/')) return false;
    const body = text.slice(1);
    const gap = body.search(/\s/);
    const cmd = (gap === -1 ? body : body.slice(0, gap)).toLowerCase();
    const args = gap === -1 ? '' : body.slice(gap + 1).trim();

    switch (cmd) {
      case 'bal':
      case 'balance':
      case 'money':
        this.cmdBalance(name, args);
        return true;
      case 'pay':
        this.cmdPay(name, args);
        return true;
      case 'baltop':
      case 'rich':
        this.cmdBaltop(name);
        return true;
      case 'shop':
        this.cmdShop(name, args);
        return true;
      case 'buy':
        this.cmdBuy(name, args);
        return true;
      case 'sell':
        this.cmdSell(name, args);
        return true;
      case 'help':
        this.cmdHelp(name);
        return true;
      default:
        // Not ours. Let the caller decide -- it may be a command something
        // else handles, and swallowing it here would break that silently.
        return false;
    }
  }

  private cmdHelp(name: string): void {
    for (const line of [
      '/bal [player]        what you (or they) have',
      '/pay <player> <n>    send money',
      '/baltop              the richest players',
      '/shop [page]         what is for sale',
      '/buy <item> [n]      buy from the shop',
      '/sell <item> [n]     sell to the shop',
      'Killing a player takes a quarter of their balance.',
    ]) this.hooks.tell(name, line);
  }

  private cmdBalance(name: string, args: string): void {
    const who = args.trim();
    if (!who) {
      this.hooks.tell(name, `You have ${formatMoney(this.balance(name))}.`);
      return;
    }
    const target = this.resolveName(who);
    if (!target) {
      this.hooks.tell(name, `Nobody here is called "${who}".`);
      return;
    }
    this.hooks.tell(name, `${target} has ${formatMoney(this.balance(target))}.`);
  }

  private cmdPay(name: string, args: string): void {
    const [who, amountRaw] = args.split(/\s+/);
    if (!who || !amountRaw) {
      this.hooks.tell(name, 'Usage: /pay <player> <amount>');
      return;
    }
    const target = this.resolveName(who);
    if (!target) {
      this.hooks.tell(name, `Nobody here is called "${who}".`);
      return;
    }
    const amount = Number(amountRaw);
    const problem = payProblem(
      { name, balance: this.balance(name) }, target, amount);
    if (problem) {
      this.hooks.tell(name, problem);
      return;
    }
    this.adjust(name, -amount);
    this.adjust(target, amount);
    this.hooks.tell(name, `Sent ${formatMoney(amount)} to ${target}.`);
    this.hooks.tell(target, `${name} sent you ${formatMoney(amount)}.`);
  }

  private cmdBaltop(name: string): void {
    const top = [...this.accounts.entries()]
      .sort((a, b) => b[1].balance - a[1].balance)
      .slice(0, 10);
    if (!top.length) {
      this.hooks.tell(name, 'Nobody has anything yet.');
      return;
    }
    this.hooks.tell(name, 'Richest players:');
    top.forEach(([who, acc], i) => {
      this.hooks.tell(name, `  ${i + 1}. ${acc.display ?? who} — ${formatMoney(acc.balance)}`);
    });
  }

  private cmdShop(name: string, args: string): void {
    const all = shopItems();
    const perPage = 8;
    const pages = Math.ceil(all.length / perPage);
    const page = Math.min(Math.max(1, Number(args) || 1), pages);
    this.hooks.tell(name, `Shop (page ${page}/${pages}) — /buy and /sell by name`);
    for (const { id, price } of all.slice((page - 1) * perPage, page * perPage)) {
      this.hooks.tell(name,
        `  ${itemName(id).padEnd(18)} buy ${formatMoney(price.buy)}  sell ${formatMoney(price.sell)}`);
    }
  }

  private cmdBuy(name: string, args: string): void {
    const parsed = this.parseItemArgs(name, args, 'buy');
    if (!parsed) return;
    this.hooks.tell(name, this.buy(name, parsed.id, parsed.count));
  }

  private cmdSell(name: string, args: string): void {
    const parsed = this.parseItemArgs(name, args, 'sell');
    if (!parsed) return;
    this.hooks.tell(name, this.sell(name, parsed.id, parsed.count));
  }

  /**
   * Buys, and says what happened.
   *
   * Both the chat command and the shop panel come through here, so the two
   * cannot end up charging different prices for the same thing -- which is
   * exactly the sort of divergence that appears months later, in one code
   * path nobody tests.
   */
  buy(name: string, item: number, count: number): string {
    const price = priceOf(item);
    if (!price) return 'The shop does not deal in that.';

    const cost = price.buy * count;
    if (cost > this.balance(name)) {
      return `${itemName(item)} x${count} costs ${formatMoney(cost)}; ` +
        `you have ${formatMoney(this.balance(name))}.`;
    }
    // Take the money only once the items are actually in hand. A full
    // inventory that still charged would be the worst bug this could have.
    if (!this.hooks.grant(name, item, count)) {
      return 'No room for that. Clear some space and try again.';
    }
    this.adjust(name, -cost);
    return `Bought ${itemName(item)} x${count} for ${formatMoney(cost)}. ` +
      `You have ${formatMoney(this.balance(name))}.`;
  }

  /** Sells, and says what happened. */
  sell(name: string, item: number, count: number): string {
    const price = priceOf(item);
    if (!price) return 'The shop does not deal in that.';

    const taken = this.hooks.take(name, item, count);
    if (taken <= 0) return `You have no ${itemName(item)}.`;
    const paid = price.sell * taken;
    this.adjust(name, paid);
    return `Sold ${itemName(item)} x${taken} for ${formatMoney(paid)}. ` +
      `You have ${formatMoney(this.balance(name))}.`;
  }

  /** Shared argument handling for buy and sell. */
  private parseItemArgs(name: string, args: string, verb: string):
  { id: number; count: number; price: { buy: number; sell: number } } | null {
    if (!args) {
      this.hooks.tell(name, `Usage: /${verb} <item> [count]`);
      return null;
    }
    const parts = args.split(/\s+/);
    // A trailing number is a count; anything else is part of the name, so
    // "iron pickaxe 2" works as well as "ironpickaxe 2".
    let count = 1;
    if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
      count = Number(parts.pop());
    }
    if (count < 1 || count > 512) {
      this.hooks.tell(name, 'Count must be between 1 and 512.');
      return null;
    }
    const wanted = parts.join('').toLowerCase();

    const match = shopItems().find(
      ({ id }) => itemName(id).toLowerCase().replace(/[^a-z0-9]/g, '') === wanted);
    if (!match) {
      this.hooks.tell(name, `The shop does not deal in "${parts.join(' ')}". Try /shop.`);
      return null;
    }
    const price = priceOf(match.id);
    if (!price) return null;
    return { id: match.id, count, price };
  }

  /** Matches an online player by name or unique prefix. */
  private resolveName(who: string): string | null {
    const lower = who.toLowerCase();
    const online = this.hooks.onlineNames();
    const exact = online.find((n) => n.toLowerCase() === lower);
    if (exact) return exact;
    const prefix = online.filter((n) => n.toLowerCase().startsWith(lower));
    return prefix.length === 1 ? prefix[0] : null;
  }

  // --- panels --------------------------------------------------------------
  //
  // The same operations as the commands, drawn instead of typed. Both go
  // through the same methods below the surface, so a shop that works in one
  // and not the other is not possible.

  /**
   * Builds a panel for this player.
   *
   * Returns the whole screen every time rather than a diff. Panels are small,
   * they change only when the player asks or acts, and a diff protocol here
   * would be a lot of machinery guarding against a cost nobody is paying.
   */
  panel(name: string, id: string, arg?: string, notice?: string): SPanel {
    const tabs: Array<[string, string]> = [
      ['shop', 'Shop'], ['sell', 'Sell'], ['baltop', 'Leaderboard'], ['me', 'You'],
    ];
    const balance = this.balance(name);
    const money = formatMoney(balance);

    switch (id) {
      case 'sell': {
        // Only what the shop will actually take, so nobody hunts for the one
        // row that works.
        const rows: PanelRow[] = shopItems().map(({ id: item, price }) => ({
          item,
          label: itemName(item),
          detail: formatMoney(price.sell),
          actions: ['sell', 'sellall'],
        }));
        return {
          t: 'panel', id: 'sell', title: 'Sell', subtitle: `You have ${money}`,
          rows, tabs, active: 'sell', notice,
        };
      }

      case 'baltop': {
        const top = [...this.accounts.entries()]
          .sort((a, b) => b[1].balance - a[1].balance)
          .slice(0, 15);
        const rows: PanelRow[] = top.map(([who, acc], i) => ({
          label: `${i + 1}.  ${acc.display ?? who}`,
          detail: formatMoney(acc.balance),
        }));
        if (!rows.length) rows.push({ label: 'Nobody has anything yet.' });
        return {
          t: 'panel', id: 'baltop', title: 'Richest players',
          subtitle: `You have ${money}`, rows, tabs, active: 'baltop', notice,
        };
      }

      case 'me': {
        const rank = [...this.accounts.entries()]
          .sort((a, b) => b[1].balance - a[1].balance)
          .findIndex(([who]) => who === this.key(name)) + 1;
        return {
          t: 'panel', id: 'me', title: name, subtitle: money,
          rows: [
            { label: 'Balance', detail: money },
            { label: 'Rank', detail: rank ? `#${rank}` : '—' },
            { label: 'Killing a player takes', detail: '25% of their balance' },
            { label: 'Most you can lose at once', detail: formatMoney(KILL_CAP) },
            { label: 'Pay someone', detail: '/pay <player> <amount>' },
          ],
          tabs, active: 'me', notice,
        };
      }

      default: {
        // The shop, paged, with anything unaffordable greyed out and told why
        // rather than failing on the click.
        const all = shopItems();
        const perPage = 10;
        const pages = Math.max(1, Math.ceil(all.length / perPage));
        const page = Math.min(Math.max(1, Number(arg) || 1), pages);
        const rows: PanelRow[] = all
          .slice((page - 1) * perPage, page * perPage)
          .map(({ id: item, price }) => ({
            item,
            label: itemName(item),
            detail: formatMoney(price.buy),
            actions: ['buy', 'buy10'],
            disabled: price.buy > balance ? 'too expensive' : undefined,
          }));
        return {
          t: 'panel', id: 'shop', title: 'Shop',
          subtitle: `You have ${money}  ·  page ${page} of ${pages}`,
          rows, tabs, active: 'shop', notice,
        };
      }
    }
  }

  /**
   * Acts on a panel row and returns the panel to draw next.
   *
   * Every action routes through the same buy/sell methods the chat commands
   * use, so the two can never drift into charging different prices.
   */
  panelAction(
    name: string, id: string, action: string, arg?: string, count?: number,
  ): SPanel {
    const item = Number(arg);
    const price = Number.isFinite(item) ? priceOf(item) : null;
    if (!price) return this.panel(name, id, undefined, 'The shop does not deal in that.');

    let notice: string;
    switch (action) {
      case 'buy':
      case 'buy10': {
        const n = action === 'buy10' ? 10 : Math.max(1, count ?? 1);
        notice = this.buy(name, item, n);
        break;
      }
      case 'sell':
      case 'sellall': {
        // "All" is capped at a stack rather than unbounded: a single click
        // that empties an inventory is a click people make by accident.
        const n = action === 'sellall' ? 64 : Math.max(1, count ?? 1);
        notice = this.sell(name, item, n);
        break;
      }
      default:
        notice = `Unknown action "${action}".`;
    }
    return this.panel(name, id, undefined, notice);
  }

  // --- persistence ---------------------------------------------------------

  private load(): void {
    if (!existsSync(this.savePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.savePath, 'utf8')) as {
        accounts?: Record<string, Account>;
      };
      for (const [k, v] of Object.entries(raw.accounts ?? {})) {
        if (typeof v?.balance !== 'number' || !Number.isFinite(v.balance)) continue;
        this.accounts.set(k, {
          // Saves written before names were kept fall back to the key.
          display: v.display ?? k,
          balance: Math.max(0, Math.floor(v.balance)),
          lastKilledBy: v.lastKilledBy ?? {},
        });
      }
    } catch {
      // A corrupt file must not stop the server booting. Everyone starts
      // again rather than nobody being able to play.
      console.log('[economy] could not read balances; starting fresh');
    }
  }

  save(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.savePath), { recursive: true });
    const out = { accounts: Object.fromEntries(this.accounts) };
    const tmp = `${this.savePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(out));
    renameSync(tmp, this.savePath);   // atomic: never a half-written file
    this.dirty = false;
  }
}
