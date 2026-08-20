/** DOM HUD: hotbar, health, air, mining progress, chat, debug, death screen. */

import { HOTBAR_SIZE, type Inventory } from '@shared/inventory.js';
import { itemDef } from '@shared/items.js';
import type { Atlas } from './gfx/atlas.js';
import { MAX_FOOD, MAX_HEALTH } from './survival.js';

export class Hud {
  private root = document.getElementById('hud') as HTMLDivElement;
  private debugEl = document.getElementById('debug') as HTMLDivElement;
  private hotbarEl = document.getElementById('hotbar') as HTMLDivElement;
  private chatLog = document.getElementById('chat-log') as HTMLDivElement;
  private chatInput = document.getElementById('chat-input') as HTMLInputElement;
  private toastEl = document.getElementById('toast') as HTMLDivElement;
  private healthEl = document.getElementById('health') as HTMLDivElement;
  private airEl = document.getElementById('air') as HTMLDivElement;
  private miningEl = document.getElementById('mining') as HTMLDivElement;
  private miningBar = document.getElementById('mining-bar') as HTMLDivElement;
  private deathEl = document.getElementById('death') as HTMLDivElement;
  private deathCause = document.getElementById('death-cause') as HTMLParagraphElement;
  private respawnBtn = document.getElementById('respawn') as HTMLButtonElement;

  private slots: HTMLDivElement[] = [];
  private toastTimer = 0;
  private shownHealth = -1;
  private foodEl = document.getElementById('food') as HTMLDivElement;
  private shownFood = -2;
  private shownAir = -1;

  constructor(private atlas: Atlas, private inventory: Inventory) {
    this.buildHotbar();
  }

  show(): void {
    this.root.hidden = false;
  }

  private buildHotbar(): void {
    this.hotbarEl.replaceChildren();
    this.slots = [];
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(i + 1);
      const count = document.createElement('span');
      count.className = 'count';
      el.append(key, count);
      this.hotbarEl.append(el);
      this.slots.push(el);
    }
    this.refreshHotbar();
  }

  refreshHotbar(): void {
    this.slots.forEach((el, i) => {
      const stack = this.inventory.get(i);
      const count = el.querySelector('.count') as HTMLSpanElement;
      if (!stack) {
        el.style.backgroundImage = '';
        el.title = '';
        count.textContent = '';
        return;
      }
      const def = itemDef(stack.id);
      el.style.backgroundImage = `url(${this.atlas.iconURL(def.texture)})`;
      el.title = def.name;
      count.textContent = stack.count > 1 ? String(stack.count) : '';
    });
  }

  setSlot(index: number): void {
    this.slots.forEach((el, i) => el.classList.toggle('active', i === index));
  }

  // ------------------------------------------------------------------ vitals

  setHealth(health: number, creative: boolean): void {
    const rounded = creative ? -1 : Math.ceil(health);
    if (rounded === this.shownHealth) return;
    this.shownHealth = rounded;

    if (creative) {
      this.healthEl.hidden = true;
      return;
    }
    this.healthEl.hidden = false;
    this.healthEl.replaceChildren();
    const hearts = MAX_HEALTH / 2;
    for (let i = 0; i < hearts; i++) {
      const pip = document.createElement('span');
      const value = health - i * 2;
      pip.className = value >= 2 ? 'heart full' : value >= 1 ? 'heart half' : 'heart';
      this.healthEl.append(pip);
    }
  }

  /**
   * Hunger, drawn as drumsticks beside the hearts.
   *
   * Hidden entirely once full, so a well-fed player is not staring at a bar
   * that never changes -- it appears exactly when it starts to matter.
   */
  setFood(food: number, creative: boolean): void {
    const rounded = creative ? -1 : Math.ceil(food);
    if (rounded === this.shownFood) return;
    this.shownFood = rounded;

    if (creative || food >= MAX_FOOD) {
      this.foodEl.hidden = true;
      return;
    }
    this.foodEl.hidden = false;
    this.foodEl.replaceChildren();
    for (let i = 0; i < MAX_FOOD / 2; i++) {
      const pip = document.createElement('span');
      const value = food - i * 2;
      pip.className = value >= 2 ? 'drumstick full' : value >= 1 ? 'drumstick half' : 'drumstick';
      this.foodEl.append(pip);
    }
  }

  setAir(air: number, max: number): void {
    const bubbles = air >= max ? 0 : Math.ceil((air / max) * 10);
    if (bubbles === this.shownAir) return;
    this.shownAir = bubbles;

    this.airEl.hidden = bubbles === 0;
    this.airEl.replaceChildren();
    for (let i = 0; i < bubbles; i++) {
      const pip = document.createElement('span');
      pip.className = 'bubble';
      this.airEl.append(pip);
    }
  }

  /** Boss health bar; pass null to hide it. */
  setBoss(name: string | null, fraction = 0): void {
    const el = document.getElementById('boss') as HTMLDivElement;
    if (!name) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    (document.getElementById('boss-name') as HTMLDivElement).textContent = name;
    (document.getElementById('boss-bar') as HTMLDivElement).style.width =
      `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }

  /** The one-off screen for beating the game. */
  showVictory(text: string, onClose: () => void): void {
    const el = document.getElementById('victory') as HTMLDivElement;
    (document.getElementById('victory-text') as HTMLParagraphElement).textContent = text;
    el.hidden = false;
    (document.getElementById('victory-close') as HTMLButtonElement).onclick = () => {
      el.hidden = true;
      onClose();
    };
  }

  get victoryVisible(): boolean {
    return !(document.getElementById('victory') as HTMLDivElement).hidden;
  }

  setMining(progress: number): void {
    if (progress <= 0) {
      this.miningEl.hidden = true;
      return;
    }
    this.miningEl.hidden = false;
    this.miningBar.style.width = `${Math.min(100, progress * 100)}%`;
  }

  // ------------------------------------------------------------------ death

  showDeath(cause: string, onRespawn: () => void): void {
    this.deathCause.textContent = `You ${cause}.`;
    this.deathEl.hidden = false;
    this.respawnBtn.onclick = () => {
      this.deathEl.hidden = true;
      onRespawn();
    };
  }

  get deathVisible(): boolean {
    return !this.deathEl.hidden;
  }

  // ------------------------------------------------------------- misc panels

  setDebug(text: string): void {
    this.debugEl.textContent = text;
  }

  toggleDebug(visible: boolean): void {
    this.debugEl.hidden = !visible;
  }

  toast(text: string, ms = 1800): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  addChat(text: string, system = false): void {
    const line = document.createElement('div');
    if (system) line.className = 'sys';
    line.textContent = text;
    this.chatLog.append(line);
    while (this.chatLog.childElementCount > 10) this.chatLog.firstElementChild!.remove();
    setTimeout(() => line.remove(), 20000);
  }

  get chatOpen(): boolean {
    return !this.chatInput.hidden;
  }

  openChat(): void {
    this.chatInput.hidden = false;
    this.chatInput.value = '';
    this.chatInput.focus();
  }

  closeChat(): string | null {
    if (this.chatInput.hidden) return null;
    const text = this.chatInput.value.trim();
    this.chatInput.hidden = true;
    this.chatInput.blur();
    return text || null;
  }

  onChatKey(handler: (action: 'send' | 'cancel') => void): void {
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') handler('send');
      else if (e.key === 'Escape') handler('cancel');
    });
  }
}
