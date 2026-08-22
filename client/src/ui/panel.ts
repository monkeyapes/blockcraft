/**
 * The in-game panel: shop, sell, leaderboard, and anything a plugin adds.
 *
 * Everything drawn here comes from the server. The client knows how to lay
 * out a title, some tabs and a list of rows with buttons, and nothing at all
 * about what a shop is. That is what lets a plugin add a whole screen without
 * shipping any client code -- the difference between a plugin system and a
 * patch.
 */

import { itemDef } from '@shared/items.js';
import type { PanelRow, SPanel } from '@shared/protocol.js';
import type { Atlas } from '../gfx/atlas.js';

/** What a row's buttons are labelled, so the server sends verbs not text. */
const ACTION_LABELS: Record<string, string> = {
  buy: 'Buy',
  buy10: 'Buy 10',
  sell: 'Sell',
  sellall: 'Sell 64',
};

export class PanelUI {
  private root = document.getElementById('panel') as HTMLDivElement;
  private titleEl = document.getElementById('panel-title') as HTMLElement;
  private subEl = document.getElementById('panel-subtitle') as HTMLElement;
  private tabsEl = document.getElementById('panel-tabs') as HTMLDivElement;
  private rowsEl = document.getElementById('panel-rows') as HTMLDivElement;
  private noticeEl = document.getElementById('panel-notice') as HTMLElement;

  /** Asks the server for a panel. */
  onOpen: (id: string, arg?: string) => void = () => {};
  /** Tells the server a row's button was pressed. */
  onAction: (id: string, action: string, arg?: string) => void = () => {};
  onClose: () => void = () => {};

  private current: SPanel | null = null;

  constructor(private readonly atlas: Atlas | null) {
    document.getElementById('panel-close')?.addEventListener('click', () => this.hide());
    // Clicking the dimmed background closes, the same as Escape.
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** Opens on a panel id, asking the server to fill it. */
  request(id: string, arg?: string): void {
    this.root.hidden = false;
    if (!this.current || this.current.id !== id) {
      // Say something immediately: a window that appears blank for a round
      // trip reads as broken, however short the trip is.
      this.titleEl.textContent = 'Loading…';
      this.subEl.textContent = '';
      this.rowsEl.replaceChildren();
      this.tabsEl.replaceChildren();
      this.noticeEl.textContent = '';
    }
    this.onOpen(id, arg);
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.current = null;
    this.onClose();
  }

  /** Draws what the server sent. */
  show(panel: SPanel): void {
    this.current = panel;
    this.root.hidden = false;
    this.titleEl.textContent = panel.title;
    this.subEl.textContent = panel.subtitle ?? '';
    this.noticeEl.textContent = panel.notice ?? '';
    this.noticeEl.hidden = !panel.notice;

    this.tabsEl.replaceChildren(...(panel.tabs ?? []).map(([id, label]) => {
      const b = document.createElement('button');
      b.className = `panel-tab${id === panel.active ? ' active' : ''}`;
      b.textContent = label;
      b.addEventListener('click', () => this.request(id));
      return b;
    }));
    this.tabsEl.hidden = !panel.tabs?.length;

    this.rowsEl.replaceChildren(...panel.rows.map((r) => this.row(panel.id, r)));
    this.rowsEl.scrollTop = 0;
  }

  private row(panelId: string, r: PanelRow): HTMLElement {
    const el = document.createElement('div');
    el.className = 'panel-row';
    if (r.disabled) el.dataset.disabled = 'yes';

    // The item's own texture, taken from the atlas the world is drawn with,
    // so the shop shows the thing rather than the word for it.
    if (r.item !== undefined && this.atlas) {
      const icon = document.createElement('span');
      icon.className = 'panel-icon';
      // The atlas is keyed by texture name, the same way the inventory and
      // the creative menu look icons up.
      const texture = itemDef(r.item).texture;
      if (texture) icon.style.backgroundImage = `url(${this.atlas.iconURL(texture)})`;
      el.append(icon);
    }

    const label = document.createElement('span');
    label.className = 'panel-label';
    label.textContent = r.label;
    el.append(label);

    if (r.detail) {
      const detail = document.createElement('span');
      detail.className = 'panel-detail';
      detail.textContent = r.detail;
      el.append(detail);
    }

    if (r.actions?.length) {
      const actions = document.createElement('span');
      actions.className = 'panel-actions';
      for (const action of r.actions) {
        const b = document.createElement('button');
        b.className = 'panel-btn';
        b.textContent = ACTION_LABELS[action] ?? action;
        if (r.disabled) {
          b.disabled = true;
          b.title = r.disabled;
        }
        b.addEventListener('click', () => {
          this.onAction(panelId, action, r.item === undefined ? undefined : String(r.item));
        });
        actions.append(b);
      }
      el.append(actions);
    } else if (r.disabled) {
      const why = document.createElement('span');
      why.className = 'panel-detail';
      why.textContent = r.disabled;
      el.append(why);
    }

    return el;
  }
}
