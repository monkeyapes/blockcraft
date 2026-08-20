/** Inventory screen: storage grid, hotbar, and 2x2 / 3x3 crafting. */

import {
  EQUIP_SIZE, HOTBAR_SIZE, Inventory, OFFHAND_INDEX,
  type Slots, type Stack, transfer,
} from '@shared/inventory.js';
import { ARMOR_SLOTS, armorSpec, itemDef } from '@shared/items.js';
import {
  canCraft, findRecipe, recipeIngredients, recipeLayout, recipesForGrid,
  type Grid, type Recipe,
} from '@shared/recipes.js';
import type { Atlas } from '../gfx/atlas.js';

export class InventoryUI {
  private root: HTMLDivElement;
  private craftEl: HTMLDivElement;
  private resultEl: HTMLDivElement;
  private storageEl: HTMLDivElement;
  private hotbarEl: HTMLDivElement;
  private cursorEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private bookListEl!: HTMLDivElement;
  private showAllEl!: HTMLInputElement;
  private equipmentEl!: HTMLDivElement;
  private containerEl!: HTMLDivElement;
  private containerWrap!: HTMLDivElement;
  private containerLabel!: HTMLDivElement;

  /**
   * The open container's slots, or null when this is a plain inventory.
   *
   * Held as fixed-length slots rather than the machine's own compact list so
   * the player can leave gaps while rearranging; it is compacted again on
   * close, because the machine tick reads `buffer[0]` as "next item out".
   */
  private container: Slots | null = null;
  private containerCommit: ((slots: Slots) => void) | null = null;

  /** The stack currently "in hand" while rearranging. */
  private cursor: Stack | null = null;
  private craft: Slots = new Array(9).fill(null);
  private craftSize: 2 | 3 = 2;
  private result: Stack | null = null;

  open = false;
  onChange: () => void = () => {};
  /** Fired with the result id whenever the player takes a crafted stack. */
  onCrafted: (id: number) => void = () => {};

  constructor(private atlas: Atlas, private inventory: Inventory) {
    this.root = document.createElement('div');
    this.root.id = 'inventory';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="panel">
        <div class="title"></div>
        <div class="columns">
          <div class="equip-wrap">
            <span class="equip-label">Gear</span>
            <div class="equipment"></div>
          </div>
          <div class="left">
            <div class="container-wrap" hidden>
              <span class="equip-label container-label"></span>
              <div class="container"></div>
            </div>
            <div class="crafting">
              <div class="craft-grid"></div>
              <div class="arrow">&#10142;</div>
              <div class="result"></div>
            </div>
            <div class="storage"></div>
            <div class="inv-hotbar"></div>
          </div>
          <div class="book">
            <div class="book-head">
              <span>Recipes</span>
              <label class="book-toggle">
                <input type="checkbox" id="book-all" /> show all
              </label>
            </div>
            <div class="book-list"></div>
            <p class="book-hint">Click to lay out &middot; Shift-click to craft</p>
          </div>
        </div>
        <p class="hint">Click to pick up &middot; right-click to split &middot; Esc or E to close</p>
      </div>`;
    document.body.append(this.root);

    this.titleEl = this.root.querySelector('.title')!;
    this.craftEl = this.root.querySelector('.craft-grid')!;
    this.resultEl = this.root.querySelector('.result')!;
    this.storageEl = this.root.querySelector('.storage')!;
    this.hotbarEl = this.root.querySelector('.inv-hotbar')!;
    this.equipmentEl = this.root.querySelector('.equipment')!;
    this.containerEl = this.root.querySelector('.container')!;
    this.containerWrap = this.root.querySelector('.container-wrap')!;
    this.containerLabel = this.root.querySelector('.container-label')!;
    this.bookListEl = this.root.querySelector('.book-list')!;
    this.showAllEl = this.root.querySelector('#book-all')!;
    this.showAllEl.addEventListener('change', () => this.refresh());

    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'cursor-stack';
    this.cursorEl.hidden = true;
    document.body.append(this.cursorEl);

    document.addEventListener('mousemove', (e) => {
      if (!this.open) return;
      this.cursorEl.style.left = `${e.clientX + 12}px`;
      this.cursorEl.style.top = `${e.clientY + 12}px`;
    });

    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.build();
  }

  // ------------------------------------------------------------------ build

  private slotEl(onClick: (whole: boolean) => void): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'islot';
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onClick(e.button !== 2);
    });
    return el;
  }

  private build(): void {
    this.craftEl.replaceChildren();
    for (let i = 0; i < 9; i++) {
      const el = this.slotEl((whole) => this.clickCraft(i, whole));
      this.craftEl.append(el);
    }

    this.resultEl.replaceChildren();
    const result = this.slotEl(() => this.takeResult());
    this.resultEl.append(result);

    this.storageEl.replaceChildren();
    for (let i = HOTBAR_SIZE; i < this.inventory.slots.length; i++) {
      this.storageEl.append(this.slotEl((whole) => this.clickInventory(i, whole)));
    }

    this.hotbarEl.replaceChildren();
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      this.hotbarEl.append(this.slotEl((whole) => this.clickInventory(i, whole)));
    }

    this.buildContainer(0);

    this.equipmentEl.replaceChildren();
    const labels = ['Helmet', 'Chestplate', 'Leggings', 'Boots', 'Offhand'];
    for (let i = 0; i < EQUIP_SIZE; i++) {
      const el = this.slotEl((whole) => this.clickEquipment(i, whole));
      el.classList.add('equip');
      if (i === OFFHAND_INDEX) el.classList.add('offhand');
      el.dataset.label = labels[i];
      this.equipmentEl.append(el);
    }
  }

  /**
   * Equipment slots only accept the right kind of item: armour goes where it
   * fits, and anything at all can go in the offhand.
   */
  private accepts(index: number, stack: Stack | null): boolean {
    if (!stack) return true;
    if (index === OFFHAND_INDEX) return true;
    const spec = armorSpec(stack.id);
    return !!spec && ARMOR_SLOTS.indexOf(spec.slot) === index;
  }

  private clickEquipment(index: number, whole: boolean): void {
    if (this.cursor) {
      if (!this.accepts(index, this.cursor)) return;
      const holder: Slots = [this.cursor];
      transfer(holder, 0, this.inventory.equipment, index, whole ? Infinity : 1);
      this.cursor = holder[0];
    } else {
      const stack = this.inventory.equipment[index];
      if (!stack) return;
      const holder: Slots = [null];
      transfer(this.inventory.equipment, index, holder, 0, stack.count);
      this.cursor = holder[0];
    }
    this.refresh();
  }

  // ------------------------------------------------------------ interaction

  /** (Re)builds the container grid to hold `size` slots. */
  private buildContainer(size: number): void {
    this.containerEl.replaceChildren();
    for (let i = 0; i < size; i++) {
      this.containerEl.append(this.slotEl((whole) => this.clickContainer(i, whole)));
    }
    this.containerWrap.hidden = size === 0;
  }

  /** Moves stacks between the cursor and an open container's slot. */
  private clickContainer(index: number, whole: boolean): void {
    const slots = this.container;
    if (!slots) return;
    if (this.cursor) {
      const holder: Slots = [this.cursor];
      transfer(holder, 0, slots, index, whole ? Infinity : 1);
      this.cursor = holder[0];
    } else {
      const stack = slots[index];
      if (!stack) return;
      const amount = whole ? stack.count : Math.ceil(stack.count / 2);
      const holder: Slots = [null];
      transfer(slots, index, holder, 0, amount);
      this.cursor = holder[0];
    }
    this.commitContainer();
    this.refresh();
  }

  private commitContainer(): void {
    if (this.container && this.containerCommit) this.containerCommit(this.container);
  }

  private clickInventory(index: number, whole: boolean): void {
    const slots = this.inventory.slots;
    if (this.cursor) {
      const holder: Slots = [this.cursor];
      transfer(holder, 0, slots, index, whole ? Infinity : 1);
      this.cursor = holder[0];
    } else {
      const stack = slots[index];
      if (!stack) return;
      const amount = whole ? stack.count : Math.ceil(stack.count / 2);
      const holder: Slots = [null];
      transfer(slots, index, holder, 0, amount);
      this.cursor = holder[0];
    }
    this.refresh();
  }

  private clickCraft(index: number, whole: boolean): void {
    if (this.cursor) {
      const holder: Slots = [this.cursor];
      transfer(holder, 0, this.craft, index, whole ? Infinity : 1);
      this.cursor = holder[0];
    } else {
      const stack = this.craft[index];
      if (!stack) return;
      const amount = whole ? stack.count : Math.ceil(stack.count / 2);
      const holder: Slots = [null];
      transfer(this.craft, index, holder, 0, amount);
      this.cursor = holder[0];
    }
    this.refresh();
  }

  private takeResult(): void {
    if (!this.result) return;
    const crafted = this.result.id;
    // Merge into the cursor when it already holds the same item.
    if (this.cursor && this.cursor.id !== this.result.id) return;
    if (this.cursor) this.cursor.count += this.result.count;
    else this.cursor = { ...this.result };

    for (let i = 0; i < 9; i++) {
      const slot = this.craft[i];
      if (!slot) continue;
      slot.count--;
      if (slot.count <= 0) this.craft[i] = null;
    }
    this.onCrafted(crafted);
    this.refresh();
  }

  // ----------------------------------------------------------- recipe book

  /** How many of each item the player is holding, across the inventory. */
  private inventoryCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const slot of this.inventory.slots) {
      if (!slot) continue;
      counts.set(slot.id, (counts.get(slot.id) ?? 0) + slot.count);
    }
    return counts;
  }

  /** Empties the crafting grid back into the inventory. */
  private clearCraft(): void {
    for (let i = 0; i < 9; i++) {
      const slot = this.craft[i];
      if (!slot) continue;
      this.inventory.add(slot.id, slot.count);
      this.craft[i] = null;
    }
  }

  /**
   * Lays a recipe out in the crafting grid, pulling the ingredients from the
   * inventory. The player still clicks the result to take it.
   */
  private layOut(recipe: Recipe): boolean {
    if (!canCraft(recipe, this.inventoryCounts())) return false;

    this.clearCraft();
    const layout = recipeLayout(recipe);
    if (layout.width > this.craftSize || layout.height > this.craftSize) return false;

    for (let y = 0; y < layout.height; y++) {
      for (let x = 0; x < layout.width; x++) {
        const id = layout.cells[y * layout.width + x];
        if (id === null) continue;
        if (this.inventory.remove(id, 1) !== 1) continue;
        this.craft[y * 3 + x] = { id, count: 1 };
      }
    }
    return true;
  }

  /** Consumes the ingredients and drops the result straight into the bag. */
  private craftNow(recipe: Recipe): boolean {
    if (!canCraft(recipe, this.inventoryCounts())) return false;
    for (const [id, count] of recipeIngredients(recipe)) {
      if (this.inventory.remove(id, count) !== count) return false;
    }
    const leftover = this.inventory.add(recipe.result.id, recipe.result.count);
    // No room: give the ingredients back rather than eating them.
    if (leftover > 0) {
      this.inventory.remove(recipe.result.id, recipe.result.count - leftover);
      for (const [id, count] of recipeIngredients(recipe)) this.inventory.add(id, count);
      return false;
    }
    return true;
  }

  private refreshBook(): void {
    const counts = this.inventoryCounts();
    const showAll = this.showAllEl.checked;
    const available = recipesForGrid(this.craftSize, this.craftSize);

    this.bookListEl.replaceChildren();
    let shown = 0;

    for (const recipe of available) {
      const makeable = canCraft(recipe, counts);
      if (!makeable && !showAll) continue;
      shown++;

      const def = itemDef(recipe.result.id);
      const entry = document.createElement('button');
      entry.className = `book-entry${makeable ? '' : ' locked'}`;
      entry.disabled = !makeable;

      const icon = document.createElement('span');
      icon.className = 'book-icon';
      icon.style.backgroundImage = `url(${this.atlas.iconURL(def.texture)})`;

      const label = document.createElement('span');
      label.className = 'book-label';
      label.textContent = recipe.result.count > 1
        ? `${def.name} ×${recipe.result.count}`
        : def.name;

      const needs = [...recipeIngredients(recipe)]
        .map(([id, n]) => `${n}× ${itemDef(id).name}`)
        .join(', ');
      entry.title = `${def.name} — needs ${needs}`;

      entry.append(icon, label);
      entry.addEventListener('click', (e) => {
        if (e.shiftKey) {
          if (!this.craftNow(recipe)) return;
        } else if (!this.layOut(recipe)) {
          return;
        }
        this.refresh();
      });

      this.bookListEl.append(entry);
    }

    if (shown === 0) {
      const empty = document.createElement('p');
      empty.className = 'book-empty';
      empty.textContent = showAll
        ? 'No recipes fit this grid.'
        : 'Nothing craftable yet — gather some materials.';
      this.bookListEl.append(empty);
    }
  }

  /** The crafting grid, cropped to the size the current bench allows. */
  private currentGrid(): Grid {
    const size = this.craftSize;
    const cells: Array<number | null> = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) cells.push(this.craft[y * 3 + x]?.id ?? null);
    }
    return { width: size, height: size, cells };
  }

  private updateResult(): void {
    const recipe = findRecipe(this.currentGrid());
    this.result = recipe ? { ...recipe.result } : null;
  }

  // --------------------------------------------------------------- painting

  private paint(el: Element, stack: Stack | null): void {
    const slot = el as HTMLDivElement;
    if (!stack) {
      slot.style.backgroundImage = '';
      slot.textContent = '';
      slot.title = '';
      return;
    }
    const def = itemDef(stack.id);
    slot.style.backgroundImage = `url(${this.atlas.iconURL(def.texture)})`;
    slot.textContent = stack.count > 1 ? String(stack.count) : '';
    slot.title = def.name;
  }

  refresh(): void {
    this.updateResult();

    // Unusable cells are hidden outright, so a 2x2 bench looks like a 2x2
    // rather than a 3x3 with holes punched in it.
    this.craftEl.style.gridTemplateColumns = `repeat(${this.craftSize}, 42px)`;
    const craftSlots = this.craftEl.children;
    for (let i = 0; i < 9; i++) {
      const row = (i / 3) | 0;
      const col = i % 3;
      const usable = row < this.craftSize && col < this.craftSize;
      (craftSlots[i] as HTMLDivElement).hidden = !usable;
      this.paint(craftSlots[i], usable ? this.craft[i] : null);
    }

    this.paint(this.resultEl.firstElementChild!, this.result);

    const storage = this.storageEl.children;
    for (let i = 0; i < storage.length; i++) {
      this.paint(storage[i], this.inventory.get(i + HOTBAR_SIZE));
    }

    const box = this.containerEl.children;
    for (let i = 0; i < box.length; i++) {
      this.paint(box[i], this.container?.[i] ?? null);
    }
    const hotbar = this.hotbarEl.children;
    for (let i = 0; i < hotbar.length; i++) {
      this.paint(hotbar[i], this.inventory.get(i));
    }

    const equipment = this.equipmentEl.children;
    for (let i = 0; i < equipment.length; i++) {
      const el = equipment[i] as HTMLDivElement;
      const stack = this.inventory.equipment[i];
      this.paint(el, stack);
      if (!stack) el.title = el.dataset.label ?? '';
    }

    if (this.cursor) {
      const def = itemDef(this.cursor.id);
      this.cursorEl.hidden = false;
      this.cursorEl.style.backgroundImage = `url(${this.atlas.iconURL(def.texture)})`;
      this.cursorEl.textContent = this.cursor.count > 1 ? String(this.cursor.count) : '';
    } else {
      this.cursorEl.hidden = true;
    }

    this.refreshBook();
    this.onChange();
  }

  // ------------------------------------------------------------------- open

  show(size: 2 | 3 = 2): void {
    this.craftSize = size;
    this.titleEl.textContent = size === 3 ? 'Crafting Table' : 'Inventory';
    this.container = null;
    this.containerCommit = null;
    this.buildContainer(0);
    this.root.hidden = false;
    this.open = true;
    this.refresh();
  }

  /**
   * Opens a machine's storage above the usual inventory.
   *
   * `commit` is called on every change rather than only on close, so items
   * are never stranded in a screen the player closes with Esc, a crash, or
   * by walking out of range.
   */
  showContainer(
    title: string, slots: Slots, commit: (slots: Slots) => void,
  ): void {
    this.craftSize = 2;
    this.titleEl.textContent = title;
    this.container = slots;
    this.containerCommit = commit;
    this.containerLabel.textContent = title;
    this.buildContainer(slots.length);
    this.root.hidden = false;
    this.open = true;
    this.refresh();
  }

  hide(): void {
    this.root.hidden = true;
    this.open = false;
    this.cursorEl.hidden = true;

    // Never eat items: return the cursor and the grid to the inventory.
    if (this.cursor) {
      this.inventory.add(this.cursor.id, this.cursor.count);
      this.cursor = null;
    }
    this.clearCraft();
    this.onChange();
  }
}
