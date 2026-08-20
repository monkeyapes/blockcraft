/**
 * Launcher: pick or create a world, then play.
 *
 * Worlds are "installations" in the launcher sense -- each is an independent
 * save with its own seed and mode, so you can keep a survival run and a
 * creative build going side by side.
 */

import type { GameMode } from '../survival.js';
import {
  createWorld, deleteWorld, describeWorld, listWorlds, type WorldEntry,
} from '../worlds.js';
import { applyLauncherSkin, worldIconURL } from './skin.js';

export interface LaunchRequest {
  multiplayer: boolean;
  world?: WorldEntry;
  serverAddress?: string;
}

export class Launcher {
  private root = document.getElementById('menu') as HTMLDivElement;
  private listEl = document.getElementById('world-list') as HTMLDivElement;
  private nameEl = document.getElementById('world-name') as HTMLInputElement;
  private seedEl = document.getElementById('world-seed') as HTMLInputElement;
  private modeEl = document.getElementById('mode') as HTMLSelectElement;
  private serverEl = document.getElementById('server') as HTMLInputElement;
  private createBtn = document.getElementById('create-world') as HTMLButtonElement;
  private multiBtn = document.getElementById('play-multi') as HTMLButtonElement;
  private tabsEl = document.getElementById('launcher-tabs') as HTMLDivElement;
  private playBtn = document.getElementById('play-now') as HTMLButtonElement;
  private selectedEl = document.getElementById('selected-world') as HTMLSpanElement;
  private pickerEl = document.getElementById('world-picker') as HTMLSelectElement;

  private selected: string | null = null;

  onLaunch: (request: LaunchRequest) => void = () => {};

  constructor() {
    // ?seed= pre-fills the seed box, so a URL that carries a ?pose= also
    // carries the world that pose refers to. Without it the pose would
    // point at whatever terrain the next random seed happened to make,
    // which is no reproduction at all. It only fills the field -- creating
    // the world stays a deliberate click.
    const urlSeed = new URLSearchParams(location.search).get('seed');
    if (urlSeed) this.seedEl.value = urlSeed;

    // Choosing from the picker selects in the list too, so the two never
    // disagree about which world Play will open.
    this.pickerEl.addEventListener('change', () => {
      this.selected = this.pickerEl.value || null;
      this.refresh();
    });

    this.createBtn.addEventListener('click', () => this.create());
    this.multiBtn.addEventListener('click', () => {
      this.onLaunch({ multiplayer: true, serverAddress: this.serverEl.value.trim() });
    });

    // The play bar launches whatever is selected, or makes a world if there
    // is nothing to launch yet.
    this.playBtn.addEventListener('click', () => {
      const world = listWorlds().find((w) => w.slot === this.selected);
      if (world) this.onLaunch({ multiplayer: false, world });
      else this.create();
    });

    for (const tab of this.tabsEl.querySelectorAll<HTMLButtonElement>('.lt')) {
      tab.addEventListener('click', () => this.showPane(tab.dataset.pane!));
    }

    this.nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.create();
    });

    applyLauncherSkin();
    this.refresh();
  }

  private showPane(pane: string): void {
    for (const tab of this.tabsEl.querySelectorAll<HTMLButtonElement>('.lt')) {
      tab.classList.toggle('active', tab.dataset.pane === pane);
    }
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-pane-body]')) {
      el.hidden = el.dataset.paneBody !== pane;
    }
  }

  private create(): void {
    const raw = this.seedEl.value.trim();
    const seed = raw === '' ? null : hashSeed(raw);
    const entry = createWorld(this.nameEl.value, seed, this.modeEl.value as GameMode);
    this.nameEl.value = '';
    this.seedEl.value = '';
    this.refresh();
    this.onLaunch({ multiplayer: false, world: entry });
  }

  /** Keeps the play bar in step with the selection. */
  private updatePlayBar(worlds: WorldEntry[]): void {
    const world = worlds.find((w) => w.slot === this.selected);

    // Rebuild the options only when they have actually changed: replacing
    // them on every refresh closes the dropdown under the pointer of anyone
    // mid-choice.
    const wanted = worlds.map((w) => `${w.slot}:${w.name}`).join('|');
    if (this.pickerEl.dataset.built !== wanted) {
      this.pickerEl.dataset.built = wanted;
      this.pickerEl.replaceChildren();
      for (const w of worlds) {
        const opt = document.createElement('option');
        opt.value = w.slot;
        opt.textContent = `${w.name} — ${describeWorld(w)}`;
        this.pickerEl.append(opt);
      }
    }
    this.pickerEl.disabled = worlds.length === 0;
    if (world) this.pickerEl.value = world.slot;

    if (world) {
      this.selectedEl.textContent = '';
      this.playBtn.textContent = 'Play';
    } else if (worlds.length === 0) {
      this.selectedEl.textContent = 'No worlds yet — create one below';
      this.playBtn.textContent = 'Create';
    } else {
      this.selectedEl.textContent = 'Pick a world';
      this.playBtn.textContent = 'Play';
    }
  }

  refresh(): void {
    const worlds = listWorlds();
    // Default to the most recently played, so Play works straight away.
    if (!worlds.some((w) => w.slot === this.selected)) {
      this.selected = worlds[0]?.slot ?? null;
    }
    this.listEl.replaceChildren();
    this.updatePlayBar(worlds);

    if (worlds.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No worlds yet. Create one below to get started.';
      this.listEl.append(empty);
      return;
    }

    for (const world of worlds) {
      const row = document.createElement('div');
      row.className = `world${world.slot === this.selected ? ' selected' : ''}`;
      row.addEventListener('click', () => {
        this.selected = world.slot;
        this.refresh();
      });

      // A block icon per world, the way the Minecraft launcher gives every
      // installation its own tile.
      const icon = document.createElement('div');
      icon.className = 'world-icon';
      // A world saved with "random" has no seed recorded, so fall back to
      // its slot: either way the same save keeps the same icon forever.
      icon.style.backgroundImage = worldIconURL(world.seed ?? hashSeed(world.slot));

      const info = document.createElement('div');
      info.className = 'world-info';
      const title = document.createElement('div');
      title.className = 'world-name';
      title.textContent = world.name;
      const meta = document.createElement('div');
      meta.className = 'world-meta';
      meta.textContent = describeWorld(world);
      info.append(title, meta);

      const play = document.createElement('button');
      play.className = 'btn btn-primary world-play';
      play.textContent = 'Play';
      play.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onLaunch({ multiplayer: false, world });
      });

      const remove = document.createElement('button');
      remove.className = 'btn world-delete';
      remove.textContent = 'Delete';
      remove.title = `Delete "${world.name}" permanently`;
      remove.addEventListener('click', async (e) => {
        e.stopPropagation();
        // Deleting a save is unrecoverable, so make it a two-step action.
        if (remove.dataset.confirm !== 'yes') {
          remove.dataset.confirm = 'yes';
          remove.textContent = 'Really delete?';
          remove.classList.add('danger');
          setTimeout(() => {
            remove.dataset.confirm = '';
            remove.textContent = 'Delete';
            remove.classList.remove('danger');
          }, 4000);
          return;
        }
        await deleteWorld(world.slot);
        this.refresh();
      });

      row.append(icon, info, play, remove);
      this.listEl.append(row);
    }
  }

  hide(): void {
    this.root.hidden = true;
  }

  show(): void {
    this.root.hidden = false;
    this.refresh();
  }
}

/** Accepts a number, or hashes any text into one, like Minecraft does. */
export function hashSeed(text: string): number {
  const asNumber = Number(text);
  if (Number.isFinite(asNumber) && text !== '') return Math.abs(Math.trunc(asNumber)) & 0xffff;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) & 0xffff;
}
