/** Pause menu, settings panel and the loading overlay. */

import { loadSettings, saveSettings, type Settings } from '../settings.js';

type Slider = 'renderDistance' | 'fov' | 'sensitivity' | 'volume';

const SLIDERS: Array<{
  key: Slider;
  input: string;
  value: string;
  format: (v: number) => string;
}> = [
  { key: 'renderDistance', input: 'set-distance', value: 'val-distance', format: (v) => `${v}` },
  { key: 'fov', input: 'set-fov', value: 'val-fov', format: (v) => `${v}°` },
  { key: 'sensitivity', input: 'set-sens', value: 'val-sens', format: (v) => `${v}` },
  { key: 'volume', input: 'set-volume', value: 'val-volume', format: (v) => `${v}%` },
];

export class Menus {
  private pauseEl = document.getElementById('pause') as HTMLDivElement;
  private settingsEl = document.getElementById('settings') as HTMLDivElement;
  private loadingEl = document.getElementById('loading') as HTMLDivElement;
  private loadingText = document.getElementById('loading-text') as HTMLParagraphElement;

  readonly settings: Settings = loadSettings();

  /** Fired whenever a setting changes, so the game can apply it live. */
  onSettingsChange: (settings: Settings) => void = () => {};
  onResume: () => void = () => {};
  onQuit: () => void = () => {};

  constructor() {
    (document.getElementById('resume') as HTMLButtonElement)
      .addEventListener('click', () => this.closePause());
    (document.getElementById('quit') as HTMLButtonElement)
      .addEventListener('click', () => this.onQuit());
    (document.getElementById('open-settings') as HTMLButtonElement)
      .addEventListener('click', () => {
        this.pauseEl.hidden = true;
        this.settingsEl.hidden = false;
      });
    (document.getElementById('close-settings') as HTMLButtonElement)
      .addEventListener('click', () => {
        this.settingsEl.hidden = true;
        // Return to the pause menu only if that is where we came from.
        if (this.wasPaused) this.pauseEl.hidden = false;
        else this.onResume();
      });

    for (const slider of SLIDERS) {
      const input = document.getElementById(slider.input) as HTMLInputElement;
      const label = document.getElementById(slider.value) as HTMLSpanElement;
      input.value = String(this.settings[slider.key]);
      label.textContent = slider.format(this.settings[slider.key]);

      input.addEventListener('input', () => {
        const v = Number(input.value);
        this.settings[slider.key] = v;
        label.textContent = slider.format(v);
        saveSettings(this.settings);
        this.onSettingsChange(this.settings);
      });
    }
  }

  /** Fired when the player picks or clears a resource pack. */
  onPackChosen: (file: Blob | null, name: string) => void = () => {};
  /** Fired when the texture resolution changes; the pack must be re-applied. */
  onTextureResChanged: (res: number) => void = () => {};

  private setupTextureRes(): void {
    const select = document.getElementById('set-texres') as HTMLSelectElement;
    select.value = String(this.settings.textureRes);
    select.addEventListener('change', () => {
      this.settings.textureRes = Number(select.value);
      saveSettings(this.settings);
      this.onTextureResChanged(this.settings.textureRes);
    });
  }

  /** Wires the resource pack controls; called once the atlas exists. */
  setupPackControls(currentName: string): void {
    this.setupTextureRes();
    const choose = document.getElementById('pack-choose') as HTMLButtonElement;
    const clear = document.getElementById('pack-clear') as HTMLButtonElement;
    const input = document.getElementById('pack-file') as HTMLInputElement;
    this.packNameEl.textContent = currentName;

    choose.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      this.onPackChosen(file, file.name.replace(/\.zip$/i, ''));
      input.value = '';
    });
    clear.addEventListener('click', () => this.onPackChosen(null, 'Built-in'));
  }

  setPackStatus(text: string): void {
    this.packNameEl.textContent = text;

    // Name the pack in the credits too, so whoever made it is acknowledged
    // wherever the player looks.
    const line = document.getElementById('credit-active');
    if (!line) return;
    const builtIn = /^built-in/i.test(text);
    line.hidden = builtIn;
    if (!builtIn) {
      line.textContent = `Currently loaded: ${text} — by its own authors, used from your files.`;
    }
  }

  private packNameEl = document.getElementById('pack-name') as HTMLSpanElement;
  private wasPaused = false;

  get paused(): boolean {
    return !this.pauseEl.hidden || !this.settingsEl.hidden;
  }

  openPause(): void {
    this.wasPaused = true;
    this.pauseEl.hidden = false;
    this.settingsEl.hidden = true;
  }

  closePause(): void {
    this.wasPaused = false;
    this.pauseEl.hidden = true;
    this.settingsEl.hidden = true;
    this.onResume();
  }

  togglePause(): void {
    if (this.paused) this.closePause();
    else this.openPause();
  }

  showLoading(text = 'Building the world...'): void {
    this.loadingText.textContent = text;
    this.loadingEl.hidden = false;
  }

  hideLoading(): void {
    this.loadingEl.hidden = true;
  }

  get loadingVisible(): boolean {
    return !this.loadingEl.hidden;
  }
}
