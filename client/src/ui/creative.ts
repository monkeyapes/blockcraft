/**
 * Creative menu.
 *
 * Every block and item, grouped into tabs and searchable, so creative mode
 * is a catalogue you browse rather than a fixed nine-slot kit.
 */

import { BLOCKS, Block } from '@shared/blocks.js';
import { HOTBAR_SIZE, type Inventory } from '@shared/inventory.js';
import { Item, isBlockItem, itemDef, stackSize } from '@shared/items.js';
import type { Atlas } from '../gfx/atlas.js';

interface Tab {
  id: string;
  label: string;
  /** Icon item shown on the tab. */
  icon: number;
  ids: number[];
}

const B = Block;
const I = Item;

/** Explicit grouping beats an automatic one: the ordering is the design. */
function buildTabs(): Tab[] {
  const allBlocks = BLOCKS.filter((d) => d && d.id !== B.Air).map((d) => d.id);

  const building = [
    B.Stone, B.Torch, B.Cobblestone, B.Bricks, B.Planks, B.Log, B.Sand, B.Gravel, B.Dirt,
    B.Grass, B.Glass, B.IronBlock, B.Quartz, B.NetherBricks, B.Purpur, B.Obsidian,
    B.EndStone, B.Netherrack, B.SoulSand,
  ];
  const nature = [
    B.Grass, B.Dirt, B.Sand, B.Gravel, B.Log, B.Leaves, B.Water, B.Lava,
    B.CoalOre, B.IronOre, B.GoldOre, B.DiamondOre, B.Glowstone, B.Torch, B.Bedrock,
  ];
  const tools = [
    I.WoodPickaxe, I.StonePickaxe, I.IronPickaxe, I.DiamondPickaxe,
    I.WoodAxe, I.StoneAxe, I.IronAxe, I.DiamondAxe,
    I.WoodShovel, I.StoneShovel, I.IronShovel, I.DiamondShovel,
    I.MiningDrill, I.FlintAndSteel,
  ];
  const combat = [
    I.LeatherHelmet, I.LeatherChestplate, I.LeatherLeggings, I.LeatherBoots,
    I.IronHelmet, I.IronChestplate, I.IronLeggings, I.IronBoots,
    I.DiamondHelmet, I.DiamondChestplate, I.DiamondLeggings, I.DiamondBoots,
  ];
  const machines = [
    B.CraftingTable, B.Furnace, B.Conveyor, B.Sorter, B.Cable,
    B.Chest, B.Collector, B.Miner, B.Generator, B.Crusher,
    B.SolarPanel, B.Battery, B.Booster, B.WaterWheel,
    B.StoneGenerator, B.ElectricFurnace, B.Sawmill, B.Compressor, B.Quarry,
    B.Elevator, B.Ladder, B.Bed,
  ];
  const transport = [I.Skateboard, I.Car, I.Truck, I.Boat, I.Plane, I.Helicopter];
  const materials = [
    I.Stick, I.Coal, I.IronIngot, I.GoldIngot, I.Diamond, I.Leather,
    I.BlazeRod, I.BlazePowder, I.EnderPearl, I.EyeOfEnder,
  ];
  const portals = [B.EndPortalFrame, B.EndPortalFrameFilled, B.NetherPortal, B.EndPortal];

  return [
    { id: 'building', label: 'Building', icon: B.Bricks, ids: building },
    { id: 'nature', label: 'Nature', icon: B.Grass, ids: nature },
    { id: 'tools', label: 'Tools', icon: I.DiamondPickaxe, ids: tools },
    { id: 'combat', label: 'Armour', icon: I.IronChestplate, ids: combat },
    { id: 'transport', label: 'Transport', icon: I.Car, ids: transport },
    { id: 'machines', label: 'Machines', icon: B.Furnace, ids: machines },
    { id: 'materials', label: 'Materials', icon: I.Diamond, ids: materials },
    { id: 'portals', label: 'Portals', icon: B.EndPortalFrame, ids: portals },
    { id: 'all', label: 'Everything', icon: B.Glowstone, ids: [...allBlocks, ...tools, ...combat, ...transport, ...materials] },
  ];
}

export class CreativeMenu {
  private root: HTMLDivElement;
  private tabsEl: HTMLDivElement;
  private gridEl: HTMLDivElement;
  private searchEl: HTMLInputElement;
  private hotbarEl: HTMLDivElement;

  private tabs = buildTabs();
  private active = this.tabs[0].id;

  open = false;
  onChange: () => void = () => {};

  constructor(private atlas: Atlas, private inventory: Inventory) {
    this.root = document.createElement('div');
    this.root.id = 'creative';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="panel">
        <div class="head">
          <div class="title">Creative</div>
          <input class="search" type="text" placeholder="Search items..." />
        </div>
        <div class="tabs"></div>
        <div class="grid"></div>
        <div class="foot">
          <span class="hint">Click to put in your hand &middot; drag to a slot below</span>
          <div class="cr-hotbar"></div>
        </div>
      </div>`;
    document.body.append(this.root);

    this.tabsEl = this.root.querySelector('.tabs')!;
    this.gridEl = this.root.querySelector('.grid')!;
    this.searchEl = this.root.querySelector('.search')!;
    this.hotbarEl = this.root.querySelector('.cr-hotbar')!;

    this.searchEl.addEventListener('input', () => this.renderGrid());
    this.searchEl.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    this.buildTabsUI();
    this.buildHotbar();
  }

  private buildTabsUI(): void {
    this.tabsEl.replaceChildren();
    for (const tab of this.tabs) {
      const btn = document.createElement('button');
      btn.className = `cr-tab${tab.id === this.active ? ' active' : ''}`;
      btn.title = tab.label;

      const icon = document.createElement('span');
      icon.className = 'cr-tab-icon';
      icon.style.backgroundImage = `url(${this.atlas.iconURL(itemDef(tab.icon).texture)})`;

      const label = document.createElement('span');
      label.textContent = tab.label;

      btn.append(icon, label);
      btn.addEventListener('click', () => {
        this.active = tab.id;
        this.searchEl.value = '';
        this.buildTabsUI();
        this.renderGrid();
      });
      this.tabsEl.append(btn);
    }
  }

  private buildHotbar(): void {
    this.hotbarEl.replaceChildren();
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = document.createElement('div');
      slot.className = 'islot';
      slot.addEventListener('mousedown', (e) => {
        e.preventDefault();
        // Right-click empties the slot; left-click drops the picked item in.
        if (e.button === 2) this.inventory.set(i, null);
        else if (this.picked !== null) {
          this.inventory.set(i, { id: this.picked, count: stackSize(this.picked) });
        }
        this.refreshHotbar();
        this.onChange();
      });
      this.hotbarEl.append(slot);
    }
    this.refreshHotbar();
  }

  private picked: number | null = null;

  private refreshHotbar(): void {
    const slots = this.hotbarEl.children;
    for (let i = 0; i < slots.length; i++) {
      const el = slots[i] as HTMLDivElement;
      const stack = this.inventory.get(i);
      if (!stack) {
        el.style.backgroundImage = '';
        el.title = '';
        el.textContent = '';
        continue;
      }
      const def = itemDef(stack.id);
      el.style.backgroundImage = `url(${this.atlas.iconURL(def.texture)})`;
      el.title = def.name;
      el.textContent = stack.count > 1 ? String(stack.count) : '';
    }
  }

  private visibleIds(): number[] {
    const query = this.searchEl.value.trim().toLowerCase();
    const source = query
      ? this.tabs[this.tabs.length - 1].ids // search spans everything
      : this.tabs.find((t) => t.id === this.active)!.ids;

    const seen = new Set<number>();
    const out: number[] = [];
    for (const id of source) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (query && !itemDef(id).name.toLowerCase().includes(query)) continue;
      out.push(id);
    }
    return out;
  }

  private renderGrid(): void {
    const ids = this.visibleIds();
    this.gridEl.replaceChildren();

    if (ids.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'cr-empty';
      empty.textContent = 'Nothing matches that.';
      this.gridEl.append(empty);
      return;
    }

    for (const id of ids) {
      const def = itemDef(id);
      const cell = document.createElement('button');
      cell.className = 'islot cr-cell';
      cell.title = `${def.name}${isBlockItem(id) ? '' : ' (item)'}`;
      cell.style.backgroundImage = `url(${this.atlas.iconURL(def.texture)})`;
      cell.addEventListener('click', () => {
        this.picked = id;
        // Put it straight into the selected hotbar slot, like creative does.
        this.inventory.set(this.selectedSlot, { id, count: stackSize(id) });
        this.refreshHotbar();
        this.onChange();
        for (const other of this.gridEl.children) other.classList.remove('picked');
        cell.classList.add('picked');
      });
      this.gridEl.append(cell);
    }
  }

  /** Which hotbar slot a picked item lands in. */
  selectedSlot = 0;

  show(selectedSlot: number): void {
    this.selectedSlot = selectedSlot;
    this.root.hidden = false;
    this.open = true;
    this.renderGrid();
    this.refreshHotbar();
    this.searchEl.focus();
  }

  hide(): void {
    this.root.hidden = true;
    this.open = false;
    this.searchEl.blur();
  }
}
