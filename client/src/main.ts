/** Blockcraft client entry point: input, streaming, game loop. */

import { Block, blockDef } from '@shared/blocks.js';
import { Dimension, SECTION_COUNT, WORLD_Y } from '@shared/constants.js';
import { HOTBAR_SIZE, Inventory } from '@shared/inventory.js';
import {
  Item, armorSpec, blockDrop, canHarvest, isBlockItem, itemDef,
  vehicleItem, vehicleKind,
} from '@shared/items.js';
import { TICK_HZ } from '@shared/protocol.js';

import { buildAtlas } from './gfx/atlas.js';
import { loadBundledArt } from './bundledart.js';
import { buildCrackMesh } from './gfx/decal.js';
import { buildHeldMesh } from './gfx/held.js';
import { buildItemMesh } from './gfx/itemmesh.js';
import { ParticleSystem } from './gfx/particles.js';
import { Renderer } from './gfx/renderer.js';
import { SoundEngine } from './audio.js';
import { MachineWorld, isMachine } from './machines.js';
import { Advancements } from './advancements.js';
import { conveyorForYaw } from '@shared/machines.js';
import { Hud } from './hud.js';
import { WebSocketLink, type Link } from './link.js';
import { LocalLink } from './local.js';
import { meshSection } from './mesher.js';
import { Connection, defaultServerUrl } from './net.js';
import { EYE_HEIGHT, Player, type InputState } from './player.js';
import { runCommand } from './commands.js';
import { DayNight } from './daynight.js';
import { dimensionLook, submergedSky } from './dimension.js';
import {
  clearStoredPack, loadResourcePack, loadStoredPack, storePack,
} from './resourcepack.js';
import { lookSensitivity } from './settings.js';
import { MAX_FOOD, Mining, Survival, type GameMode } from './survival.js';
import { guardFrame, installCrashHandlers, showCrash } from './ui/crash.js';
import { CreativeMenu } from './ui/creative.js';
import { InventoryUI } from './ui/inventory.js';
import { Launcher } from './ui/launcher.js';
import { touchWorld } from './worlds.js';
import { Menus } from './ui/menus.js';
import { buildMobMesh } from './gfx/mobmesh.js';
import { buildPlayerMesh, type PlayerPose } from './gfx/playermesh.js';
import { buildVehicleMesh } from './gfx/vehiclemesh.js';
import { MobWorld } from './mobs.js';
import { MobKind, rollDrops } from '@shared/mobs.js';
import { attackDamage, foodValue, isFood } from '@shared/items.js';
import { CHASE_DISTANCE, VehicleWorld, type Vehicle } from './vehicles.js';
import type { Vec3 } from './math.js';
import { ClientWorld } from './world.js';
import { PointerLockKeeper } from './pointerlock.js';
import { TouchControls, isTouchDevice } from './touch.js';

/** What creative mode offers in the hotbar: building blocks, then the toys. */
const CREATIVE_KIT = [
  Block.Grass, Block.Stone, Block.Planks, Block.Glass,
  Item.MiningDrill, Item.Skateboard, Item.Car, Item.Plane, Item.Helicopter,
];

const GEN_BUDGET_MS = 4;
const MESH_BUDGET_MS = 6;
const PLACE_REPEAT_MS = 220;
const SWING_TIME = 0.25;
/** Minimum gap between melee swings, so one click is one hit. */
const ATTACK_COOLDOWN_MS = 420;
/** Never strand the player on the loading screen if generation stalls. */
const LOAD_TIMEOUT_MS = 15000;
/** How long you must stand in a portal, and the lockout after arriving. */
const PORTAL_DWELL_S = 0.7;
const PORTAL_COOLDOWN_S = 3;

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const menu = document.getElementById('menu') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const serverInput = document.getElementById('server') as HTMLInputElement;
const modeSelect = document.getElementById('mode') as HTMLSelectElement;

installCrashHandlers(canvas);

nameInput.value = localStorage.getItem('bc.name') ?? '';
serverInput.value = localStorage.getItem('bc.server') ?? '';
modeSelect.value = localStorage.getItem('bc.mode') ?? 'survival';

/** Set once `start` creates the sound engine; audio can only ever unlock
 *  from within a user gesture, and this is the one that fires every click. */
let unlockAudio: (() => void) | null = null;

/**
 * Mouse capture. Transient refusals are retried rather than treated as a
 * permanent verdict -- see pointerlock.ts for why that distinction matters.
 */
const pointerLock = new PointerLockKeeper(canvas);

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) pointerLock.noteSuccess();
});
document.addEventListener('pointerlockerror', () => pointerLock.noteFailure());

function grabPointer(): void {
  unlockAudio?.();
  pointerLock.request();
}

/**
 * Deliberate release (pause, inventory, chat).
 *
 * Not a failure -- the next click should have as good a chance of capturing
 * as the first one did, so the refusal count is cleared.
 */
function releasePointer(): void {
  pointerLock.released();
  document.exitPointerLock();
}

/** True when the game should act on clicks rather than try to capture first. */
function inputReady(): boolean {
  return pointerLock.ready;
}

let launched = false;

/**
 * On a touch device the desktop launcher is replaced outright by a one-card
 * entry screen. It is not a narrower launcher -- a phone visit is almost
 * always "let me try this" rather than "manage my saves", so the world list
 * and the settings rail would be furniture in the way.
 */
const touchBuild = isTouchDevice();

if (touchBuild) {
  document.documentElement.classList.add('touch');
  const entry = document.getElementById('mobile-entry') as HTMLDivElement;
  const menuEl = document.getElementById('menu') as HTMLDivElement;
  entry.hidden = false;
  menuEl.hidden = true;

  let chosenMode: GameMode = 'creative';
  for (const b of entry.querySelectorAll<HTMLButtonElement>('.me-mode')) {
    b.addEventListener('click', () => {
      for (const other of entry.querySelectorAll('.me-mode')) other.classList.remove('active');
      b.classList.add('active');
      chosenMode = b.dataset.mode as GameMode;
    });
  }

  (document.getElementById('me-desktop') as HTMLAnchorElement)
    .addEventListener('click', (e) => {
      e.preventDefault();
      alert('The desktop build is the full version: longer view distance, '
        + 'the whole launcher, and it runs offline.');
    });

  (document.getElementById('me-play') as HTMLButtonElement)
    .addEventListener('click', () => {
      if (launched) return;
      launched = true;
      entry.hidden = true;
      // One rolling world on a phone, so nothing has to be managed.
      const slot = 'touch-world';
      touchWorld(slot);
      const name = `Player${Math.floor(Math.random() * 900 + 100)}`;
      start(name, chosenMode, new LocalLink(slot), false).catch((err) => {
        launched = false;
        entry.hidden = false;
        showCrash('The game could not start.', err);
      });
    });
}

const launcher = new Launcher();
launcher.onLaunch = (request) => {
  if (launched) return; // the game takes over the page; one launch per session
  const name = nameInput.value.trim() || `Player${Math.floor(Math.random() * 900 + 100)}`;
  const mode = request.world?.mode ?? (modeSelect.value as GameMode);
  localStorage.setItem('bc.name', name);
  localStorage.setItem('bc.server', serverInput.value.trim());
  localStorage.setItem('bc.mode', mode);

  let link: Link;
  if (request.multiplayer) {
    link = new WebSocketLink(defaultServerUrl(request.serverAddress));
  } else {
    const world = request.world!;
    touchWorld(world.slot);
    link = new LocalLink(world.slot, world.seed ?? undefined);
  }

  launched = true;
  start(name, mode, link, request.multiplayer).catch((err) => {
    launched = false;
    statusEl.textContent = String(err?.message ?? err);
    showCrash('The game could not start.', err);
  });
};

async function start(
  name: string, mode: GameMode, link: Link, multiplayer: boolean,
): Promise<void> {
  const atlas = buildAtlas();
  const renderer = new Renderer(canvas, atlas);

  // Layered in after the procedural base, before any user resource pack --
  // a pack the player chose later always has the final say over a texture.
  void loadBundledArt().then((art) => {
    if (art.size === 0) return;
    atlas.applyOverrides(art);
    renderer.syncAtlas(atlas);
  });

  const menus = new Menus();

  /** The pack currently in use, kept so a resolution change can re-apply it. */
  let activePack: { blob: Blob; name: string } | null = null;

  /** Applies a resource pack, or restores the built-in textures. */
  async function usePack(file: Blob | null, packName: string): Promise<void> {
    if (!file) {
      activePack = null;
      await clearStoredPack();
      menus.setPackStatus('Built-in (reload to apply)');
      return;
    }
    try {
      menus.setPackStatus('Loading...');
      const pack = await loadResourcePack(file, packName);
      const applied = atlas.applyOverrides(pack.tiles, menus.settings.textureRes);
      renderer.syncAtlas(atlas);
      activePack = { blob: file, name: packName };
      await storePack(file, packName);
      menus.setPackStatus(`${packName} — ${applied} textures at ${atlas.tileSize}px`);
      hud.refreshHotbar();
      // Chunk meshes sample the atlas by UV, so nothing needs re-meshing --
      // only the GPU texture changed.
    } catch (err) {
      menus.setPackStatus('Could not read that pack');
      showCrash('That resource pack could not be read.', err);
    }
  }

  menus.onPackChosen = (file, packName) => void usePack(file, packName);
  menus.onTextureResChanged = () => {
    // Growing is easy; going finer-to-coarser needs the pack read again.
    if (activePack) void usePack(activePack.blob, activePack.name);
    else menus.setPackStatus('Built-in');
  };
  let sensitivity = lookSensitivity(menus.settings);
  let renderDistance = menus.settings.renderDistance;
  renderer.renderDistance = renderDistance;
  renderer.fov = menus.settings.fov;

  const sound = new SoundEngine();
  sound.volume = menus.settings.volume / 100;
  unlockAudio = () => sound.unlock();
  const particles = new ParticleSystem();
  // Keyed per world, so a returning player is not re-taught the game.
  const advancements = new Advancements(multiplayer ? 'server' : name);
  advancements.onEarned = (a) => {
    hud.addChat(`Advancement: ${a.title} — ${a.description}`, true);
    hud.toast(`Advancement: ${a.title}`, 3200);
    sound.click();
  };

  const machines = new MachineWorld();
  machines.onSetBlock = (x, y, z, block) => {
    world?.setBlock(x, y, z, block);
    net.send({ t: 'set', dim: dimension, x, y, z, b: block });
  };

  const inventory = new Inventory();
  const player = new Player();
  const survival = new Survival();
  const mining = new Mining();
  survival.mode = mode;

  const hud = new Hud(atlas, inventory);
  const invUI = new InventoryUI(atlas, inventory);
  const creativeUI = new CreativeMenu(atlas, inventory);
  invUI.onChange = () => hud.refreshHotbar();
  invUI.onCrafted = (id) => advancements.fire({ kind: 'craft', id });
  creativeUI.onChange = () => hud.refreshHotbar();

  if (survival.creative) {
    CREATIVE_KIT.forEach((id, i) => {
      inventory.set(i, { id, count: isBlockItem(id) ? 64 : 1 });
    });
  }

  const dayNight = new DayNight();

  const vehicles = new VehicleWorld();
  const mobs = new MobWorld(Dimension.Overworld);
  let riding: Vehicle | null = null;
  // First person on foot, third person the moment you get on something.
  let thirdPerson = false;
  /** Smoothed chase-camera distance, so it eases in rather than snapping. */
  let chaseDistance = 0;
  let loadStarted = 0;

  let world: ClientWorld | null = null;
  let dimension = Dimension.Overworld;
  let seed = 0;
  /** Seconds stood in a portal, and the lockout after arriving. */
  let portalTimer = 0;
  let portalCooldown = 0;
  let spawned = false;
  let spawnPoint = { x: 0, y: 80, z: 0 };
  let swing = 0;
  let bob = 0;
  /** Eased 0..1 walk amount, drives the third-person limb swing. */
  let selfStride = 0;
  /** Beating the dragon is once per world, so it never respawns. */
  let dragonBeaten = false;

  const net = new Connection(link, name, {
    welcome: (msg) => {
      dimension = msg.dim;
      advancements.fire({ kind: 'dimension', id: msg.dim });
      seed = msg.seed;
      world = new ClientWorld(msg.seed, msg.dim);
      spawnPoint = { ...msg.spawn };
      player.x = msg.spawn.x;
      player.y = msg.spawn.y;
      player.z = msg.spawn.z;
      spawned = false;
      renderer.dropAll();
      subscribed.clear();
      menu.hidden = true;
      menus.showLoading();
      loadStarted = performance.now();
      hud.show();
      hud.setSlot(player.slot);
      hud.addChat(
        `${multiplayer ? 'Connected' : 'Local world'} as ${msg.name} - seed ${msg.seed}`, true);
      grabPointer();
    },
    chunk: (msg) => {
      if (msg.dim !== dimension) return;
      world?.applyEdits(msg.cx, msg.cz, msg.edits);
    },
    set: (msg) => {
      if (msg.dim !== dimension || msg.by === net.selfId) return;
      world?.setBlock(msg.x, msg.y, msg.z, msg.b);
    },
    reject: (msg) => {
      // Server said no: roll the optimistic edit back to its truth.
      if (msg.dim === dimension) world?.setBlock(msg.x, msg.y, msg.z, msg.b);
      hud.toast(`Can't do that (${msg.reason})`);
    },
    dim: (msg) => {
      // A dimension change is a whole new world: rebuild everything.
      const look = dimensionLook(msg.dim);
      dimension = msg.dim;
      advancements.fire({ kind: 'dimension', id: msg.dim });
      world = new ClientWorld(seed, msg.dim);
      renderer.dropAll();
      subscribed.clear();
      // Mobs belong to the world you left, not the one you arrive in.
      mobs.setDimension(msg.dim);
      if (riding) dismount();
      player.x = msg.x;
      player.y = msg.y;
      player.z = msg.z;
      player.vy = 0;
      spawned = true;            // the server placed us on a built platform
      spawnPoint = { x: msg.x, y: msg.y, z: msg.z };
      portalTimer = 0;
      portalCooldown = PORTAL_COOLDOWN_S;
      menus.showLoading(`Entering ${look.name}...`);
      loadStarted = performance.now();
      hud.addChat(look.arrival, true);
      hud.toast(look.arrival);
    },
    consume: (msg) => {
      if (survival.creative) return;
      inventory.remove(msg.item, msg.count);
      hud.refreshHotbar();
    },
    join: (msg) => hud.addChat(`${msg.player.name} joined`, true),
    leave: (msg) => hud.addChat(`Player ${msg.id} left`, true),
    chat: (msg) => hud.addChat(`<${msg.name}> ${msg.text}`),
  });

  net.onStatus = (text) => {
    statusEl.textContent = text;
    if (menu.hidden) hud.addChat(text, true);
  };
  net.start();

  survival.onDamage = ({ cause }) => {
    hud.toast(cause);
    sound.hurt();
  };
  survival.onDeath = (cause) => {
    sound.death();
    releasePointer();
    hud.showDeath(cause, () => {
      survival.reset();
      player.x = spawnPoint.x;
      player.y = spawnPoint.y;
      player.z = spawnPoint.z;
      player.vy = 0;
      spawned = false;
      grabPointer();
    });
  };

  // ------------------------------------------------------------------ input

  const held = new Set<string>();
  const input: InputState = {
    forward: false, back: false, left: false, right: false,
    jump: false, sneak: false, sprint: false,
  };
  // The debug overlay is toggled with F3, which a phone does not have -- so
  // on the touch build it starts off rather than becoming permanent furniture.
  let showDebug = !touchBuild;
  let mineHeld = false;
  let placeHeld = false;
  let lastPlace = 0;
  let lastSwing = 0;

  function syncInput(): void {
    const frozen = anyPanelOpen();
    if (touch) {
      touch.apply(input, frozen);
      return;
    }
    input.forward = !frozen && (held.has('KeyW') || held.has('ArrowUp'));
    input.back = !frozen && (held.has('KeyS') || held.has('ArrowDown'));
    input.left = !frozen && (held.has('KeyA') || held.has('ArrowLeft'));
    input.right = !frozen && (held.has('KeyD') || held.has('ArrowRight'));
    input.jump = !frozen && held.has('Space');
    input.sneak = !frozen && (held.has('ShiftLeft') || held.has('ShiftRight'));
    input.sprint = !frozen && (held.has('ControlLeft') || held.has('ControlRight'));
  }

  /**
   * Touch controls, on the touch build only.
   *
   * They write into the same InputState the keyboard does, so nothing
   * downstream -- the player, the vehicles, the machines -- learns that
   * touch exists.
   */
  const touchUI = document.getElementById('touch-ui') as HTMLDivElement;
  const stickEl = document.getElementById('tc-stick') as HTMLDivElement;
  const knobEl = document.getElementById('tc-knob') as HTMLSpanElement;
  let touch: TouchControls | null = null;

  if (touchBuild) {
    touchUI.hidden = false;
    touch = new TouchControls(canvas, {
      look: (dx, dy) => {
        if (anyPanelOpen()) return;
        if (riding) steerFromMouse(dx, dy);
        else player.look(dx, dy, sensitivity * 1.35);
      },
      tap: () => {
        if (anyPanelOpen()) return;
        // A tap mines one block: press and release in the same frame, which
        // the mining timer reads as a single hit.
        mineHeld = true;
        setTimeout(() => { mineHeld = false; }, 120);
      },
      setMining: (on) => { if (!anyPanelOpen()) mineHeld = on; },
      place: () => { if (!anyPanelOpen()) tryPlace(); },
      jump: () => { /* handled by the pad below */ },
      toggleInventory: () => openInventory(2),
      sneakChanged: () => syncInput(),
    });

    const bind = (id: string, on: () => void, off?: () => void) => {
      const el = document.getElementById(id) as HTMLButtonElement;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
      if (off) el.addEventListener('touchend', (e) => { e.preventDefault(); off(); }, { passive: false });
      return el;
    };

    bind('tc-jump', () => { held.add('Space'); syncInput(); },
                    () => { held.delete('Space'); syncInput(); });
    bind('tc-place', () => tryPlace());
    bind('tc-inv', () => openInventory(2));

    const sneakBtn = bind('tc-sneak', () => {
      touch!.setSneak(!touch!.sneak);
      sneakBtn.classList.toggle('on', touch!.sneak);
    });
    const flyBtn = bind('tc-fly', () => {
      if (!survival.creative) {
        hud.toast('Flying is creative only');
        return;
      }
      player.flying = !player.flying;
      flyBtn.classList.toggle('on', player.flying);
    });
  }

  function closeInventory(): void {
    invUI.hide();
    hud.refreshHotbar();
    syncInput();
    grabPointer();
  }

  /** Any full-screen panel that should freeze the world and the controls. */
  function anyPanelOpen(): boolean {
    return invUI.open || creativeUI.open || hud.deathVisible || hud.victoryVisible || menus.paused;
  }

  function closeCreative(): void {
    creativeUI.hide();
    hud.refreshHotbar();
    syncInput();
    grabPointer();
  }

  hud.onChatKey((action) => {
    const text = hud.closeChat();
    if (action === 'send' && text) {
      // Slash commands are handled here and never reach the server.
      const handled = runCommand(text, {
        player, survival, seed, dimension, mobs,
        say: (line, system) => hud.addChat(line, system),
      });
      if (!handled) net.send({ t: 'chat', text });
    }
    grabPointer();
  });

  menus.onResume = () => {
    syncInput();
    grabPointer();
  };

  menus.onQuit = () => {
    link.close();
    location.reload(); // simplest clean teardown back to the title screen
  };

  window.addEventListener('keydown', (e) => {
    if (hud.chatOpen) return;

    if (e.code === 'Escape' && creativeUI.open) {
      e.preventDefault();
      closeCreative();
      return;
    }
    if (e.code === 'Escape' && !invUI.open) {
      e.preventDefault();
      if (!menus.paused) releasePointer();
      held.clear();
      menus.togglePause();
      syncInput();
      return;
    }
    if (menus.paused) return;

    if (e.code === 'KeyE' || (e.code === 'Escape' && invUI.open)) {
      e.preventDefault();
      // Creative gets the catalogue; survival gets the 2x2 grid. The 3x3
      // still comes from right-clicking an actual crafting table.
      if (invUI.open) closeInventory();
      else if (creativeUI.open) closeCreative();
      else if (survival.creative) {
        releasePointer();
        creativeUI.show(player.slot);
        held.clear();
        syncInput();
      } else {
        openInventory(2);
      }
      return;
    }
    if (anyPanelOpen()) return;

    if (e.code === 'KeyT') {
      e.preventDefault();
      releasePointer();
      hud.openChat();
      return;
    }

    held.add(e.code);
    syncInput();

    // Q, not Shift: helicopters and planes need Shift for descent/throttle.
    if (e.code === 'KeyQ' && riding) {
      dismount();
      return;
    }

    // L for the advancement list: the trail is only useful if you can look
    // at what is still ahead, not just catch a toast as it goes past.
    if (e.code === 'KeyL') {
      e.preventDefault();
      hud.addChat(
        `Advancements  ${advancements.count}/${advancements.total}`, true);
      for (const { advancement, earned } of advancements.list()) {
        if (advancement.secret && !earned) continue;
        hud.addChat(
          `${earned ? '[x]' : '[ ]'} ${advancement.title} — ${advancement.description}`,
          true);
      }
      return;
    }

    if (e.code === 'KeyV') {
      thirdPerson = !thirdPerson;
      hud.toast(thirdPerson ? 'Third-person view' : 'First-person view');
      return;
    }

    if (e.code === 'KeyF') {
      if (survival.creative) {
        player.flying = !player.flying;
        player.vy = 0;
        hud.toast(`Fly mode ${player.flying ? 'on' : 'off'}`);
      } else {
        hud.toast('Flying is creative-mode only');
      }
    } else if (e.code === 'F3') {
      e.preventDefault();
      showDebug = !showDebug;
      hud.toggleDebug(showDebug);
    } else if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= HOTBAR_SIZE) {
        player.slot = n - 1;
        hud.setSlot(player.slot);
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    held.delete(e.code);
    syncInput();
  });

  window.addEventListener('blur', () => {
    held.clear();
    syncInput();
    mineHeld = placeHeld = false;
    mining.cancel();
  });

  canvas.addEventListener('mousedown', (e) => {
    if (anyPanelOpen()) return;
    // A click is the only moment the browser will grant capture, so always
    // spend it asking when unlocked. Once the fallback is on the click also
    // does its normal job, so play is never blocked by an unanswered ask --
    // which is what left the cursor stranded before.
    if (!pointerLock.locked) {
      grabPointer();
      if (!inputReady()) return;
    }
    if (e.button === 0) mineHeld = true;
    else if (e.button === 2) {
      // Right-clicking an interactive block uses it instead of placing.
      // Sneaking overrides that, so you can still build against a bench.
      if (tryUse()) return;
      if (tryEat()) return;
      if (trySpawnVehicle()) return;
      placeHeld = true;
      lastPlace = 0;
    } else if (e.button === 1) pickBlock();
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
      mineHeld = false;
      mining.cancel();
    } else if (e.button === 2) placeHeld = false;
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  let lastMouse: { x: number; y: number } | null = null;
  /** Virtual control stick, -1..1 each axis, used while riding. */
  let aimX = 0;
  let aimY = 0;

  function steerFromMouse(dx: number, dy: number): void {
    // The mouse behaves like a self-centring stick rather than a camera:
    // push and hold to bank, let go and the aircraft levels itself.
    aimX = Math.max(-1, Math.min(1, aimX + dx * 0.012));
    aimY = Math.max(-1, Math.min(1, aimY + dy * 0.012));
  }

  window.addEventListener('mousemove', (e) => {
    if (anyPanelOpen()) {
      lastMouse = null;
      return;
    }
    if (document.pointerLockElement === canvas) {
      if (riding) steerFromMouse(e.movementX, e.movementY);
      else player.look(e.movementX, e.movementY, sensitivity);
      return;
    }
    // Without pointer lock, steer from absolute cursor movement instead, so
    // the game stays playable where the browser refuses to capture the mouse.
    if (!pointerLock.fallback) return;
    if (lastMouse) {
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      if (riding) steerFromMouse(dx, dy);
      else player.look(dx, dy, sensitivity);
    }
    lastMouse = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('wheel', (e) => {
    if (!inputReady()) return;
    const dir = Math.sign(e.deltaY);
    player.slot = (player.slot + dir + HOTBAR_SIZE) % HOTBAR_SIZE;
    hud.setSlot(player.slot);
  }, { passive: true });

  // ------------------------------------------------------------ block edits

  function heldItem(): number | null {
    return inventory.get(player.slot)?.id ?? null;
  }

  function openInventory(size: 2 | 3): void {
    releasePointer();
    invUI.show(size);
    held.clear();
    syncInput();
  }

  /** Opens a sorter's filter pattern. */
  function openSorter(x: number, y: number, z: number): void {
    machines.register(x, y, z);
    const slots: Array<{ id: number; count: number } | null> = new Array(5).fill(null);
    machines.filterAt(x, y, z).forEach((stack, i) => {
      if (i < slots.length) slots[i] = { ...stack };
    });
    releasePointer();
    invUI.showContainer('Sorter filter', slots,
      (edited) => machines.setFilter(x, y, z, edited));
    held.clear();
    syncInput();
  }

  /**
   * Opens a machine's storage.
   *
   * The machine keeps its contents as a compact list; the screen wants fixed
   * slots so gaps can be left while rearranging, so the two are converted
   * across on open and on every edit.
   */
  function openContainer(x: number, y: number, z: number, block: number): void {
    machines.register(x, y, z);
    const size = MachineWorld.capacity(block);
    const slots: Array<{ id: number; count: number } | null> =
      new Array(size).fill(null);
    machines.contents(x, y, z).forEach((stack, i) => {
      if (i < size) slots[i] = { ...stack };
    });

    releasePointer();
    invUI.showContainer(blockDef(block).name, slots, (edited) => {
      machines.setContents(x, y, z, edited);
    });
    held.clear();
    syncInput();
  }

  const RIDE_HINT: Record<string, string> = {
    skateboard: 'W push · A/D carve · Space ollie · Q off',
    car: 'W/S drive · A/D or mouse steer · Ctrl boost · Q off',
    plane: 'W/S throttle · mouse to fly · Q off',
    helicopter: 'Space up · Shift down · W/S move · A/D turn · Q off',
    boat: 'W/S row · A/D steer · Q off',
    truck: 'W/S drive · A/D or mouse steer · Ctrl boost · Q off',
  };

  function mount(vehicle: Vehicle): void {
    advancements.fire({ kind: 'ride', kind2: vehicle.kind });
    if (vehicle.spec.flying) advancements.fire({ kind: 'event', name: 'flew' });
    riding = vehicle;
    player.flying = false;
    player.vy = 0;
    aimX = aimY = 0;
    vehicle.aimX = vehicle.aimY = 0;
    thirdPerson = true; // you cannot drive what you cannot see
    chaseDistance = 0;
    hud.toast(`${vehicle.spec.label}: ${RIDE_HINT[vehicle.kind] ?? ''}`, 4000);
  }

  function dismount(): void {
    if (!riding) return;
    // Step off to the side, and up a little so we don't clip into the ground.
    const yaw = ((riding.yaw + 90) * Math.PI) / 180;
    player.x = riding.x + Math.cos(yaw) * (riding.spec.halfWidth + 0.6);
    player.z = riding.z + Math.sin(yaw) * (riding.spec.halfWidth + 0.6);
    player.y = riding.y + 0.6;
    player.vy = 0;
    riding = null;
    thirdPerson = false;
    chaseDistance = 0;
  }

  /** Picks the vehicle up again when you break it with an empty-ish hand. */
  function collectVehicle(vehicle: Vehicle): void {
    if (riding === vehicle) dismount();
    vehicles.remove(vehicle);
    if (!survival.creative) inventory.add(vehicleItem(vehicle.kind), 1);
    hud.refreshHotbar();
    hud.toast(`Picked up ${vehicle.spec.label}`);
  }

  /**
   * Right-click interaction: mount a vehicle, use a block, or fall through
   * to placing. Returns true when something handled the click.
   */
  /** Eating is the only right-click that does not need a target. */
  function tryEat(): boolean {
    const stack = inventory.get(player.slot);
    if (!stack || !isFood(stack.id)) return false;
    if (survival.creative) {
      hud.toast('No need to eat in creative');
      return true;
    }
    if (survival.food >= MAX_FOOD) {
      hud.toast('You are not hungry');
      return true;
    }
    survival.feed(foodValue(stack.id));
    inventory.consumeAt(player.slot);
    hud.refreshHotbar();
    swing = SWING_TIME;
    hud.toast(`Ate ${itemDef(stack.id).name}`);
    return true;
  }

  function tryUse(): boolean {
    if (!world || input.sneak) return false;

    // Vehicles take priority: they sit in front of whatever block is behind.
    const [ex, ey, ez] = player.eye;
    const [fx, fy, fz] = player.forward;
    const vehicle = vehicles.pick(ex, ey, ez, fx, fy, fz, 5);
    if (vehicle && !riding) {
      mount(vehicle);
      return true;
    }

    const hit = player.raycast(world);
    if (!hit) return false;

    if (hit.id === Block.CraftingTable) {
      openInventory(3);
      swing = SWING_TIME;
      return true;
    }

    // Machines with storage open as a container. Without this a chest was a
    // one-way trip: collectors could fill it, but the only way to get
    // anything back out was to break it.
    if (hit.id === Block.Chest || hit.id === Block.Furnace ||
        hit.id === Block.Collector || hit.id === Block.Generator ||
        hit.id === Block.Crusher || hit.id === Block.ElectricFurnace ||
        hit.id === Block.Sawmill || hit.id === Block.Compressor) {
      openContainer(hit.block[0], hit.block[1], hit.block[2], hit.id);
      swing = SWING_TIME;
      return true;
    }

    // Sleeping: skips the night and moves your respawn point here. Only
    // works after dusk, so a bed cannot be used to skip the working day.
    if (hit.id === Block.Bed) {
      const [bx, by, bz] = hit.block;
      spawnPoint = { x: bx + 0.5, y: by + 1, z: bz + 0.5 };
      if (!dayNight.state().isNight) {
        hud.toast('You can only sleep at night');
      } else {
        dayNight.setFraction(0);
        updateSkyBrightness();
        survival.heal(4);
        hud.toast('Good morning — spawn point set');
        sound.click();
      }
      swing = SWING_TIME;
      return true;
    }

    // A sorter opens its filter rather than its cargo: what you put here is
    // the pattern of what it should divert, not something it will consume.
    if (hit.id === Block.Sorter) {
      openSorter(hit.block[0], hit.block[1], hit.block[2]);
      swing = SWING_TIME;
      return true;
    }

    // Items that act on the world rather than being placed. The server owns
    // the result, so it can build the portal and take the item.
    const held = heldItem();
    if (held === Item.FlintAndSteel || held === Item.EyeOfEnder) {
      const [x, y, z] = hit.block;
      net.send({ t: 'use', dim: dimension, x, y, z, item: held });
      swing = SWING_TIME;
      return true;
    }
    return false;
  }

  /** Places a held vehicle item into the world as a rideable entity. */
  function trySpawnVehicle(): boolean {
    if (!world) return false;
    const stack = inventory.get(player.slot);
    if (!stack) return false;
    const kind = vehicleKind(stack.id);
    if (!kind) return false;

    const hit = player.raycast(world);
    if (!hit || !hit.place) {
      hud.toast('Aim at the ground to put it down');
      return true;
    }
    const [x, y, z] = hit.place;
    if (!survival.creative && !inventory.consumeAt(player.slot)) return true;
    hud.refreshHotbar();

    vehicles.spawn(kind, x + 0.5, y, z + 0.5, player.yaw);
    hud.toast(`Placed ${kind} - right-click to ride`);
    swing = SWING_TIME;
    return true;
  }

  function pickBlock(): void {
    if (!world) return;
    const hit = player.raycast(world);
    if (!hit) return;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (inventory.get(i)?.id === hit.id) {
        player.slot = i;
        hud.setSlot(i);
        return;
      }
    }
    if (survival.creative) {
      inventory.set(player.slot, { id: hit.id, count: 64 });
      hud.refreshHotbar();
    }
  }

  function breakBlock(x: number, y: number, z: number, id: number): void {
    if (!world) return;

    sound.blockBreak(id);
    particles.spawnBreak(atlas, x, y, z, id);
    advancements.fire({ kind: 'mine', id });

    // A machine holding items gives them back rather than swallowing them.
    for (const stack of machines.clearAt(x, y, z)) {
      machines.spawn(x + 0.5, y + 0.5, z + 0.5, stack.id, stack.count);
    }

    if (!survival.creative) {
      if (canHarvest(id, heldItem())) {
        const drop = blockDrop(id);
        if (drop) {
          const leftover = inventory.add(drop.id, drop.count);
          if (leftover < drop.count) advancements.fire({ kind: 'pickup', id: drop.id });
          if (leftover > 0) hud.toast('Inventory full');
        }
      } else {
        hud.toast(`You need a better tool for ${blockDef(id).name}`);
      }
      hud.refreshHotbar();
    }

    world.setBlock(x, y, z, Block.Air); // optimistic
    net.send({ t: 'set', dim: dimension, x, y, z, b: Block.Air });
  }

  function tryPlace(): void {
    if (!world) return;
    const hit = player.raycast(world);
    if (!hit || !hit.place) return;

    const stack = inventory.get(player.slot);
    if (!stack) return;
    if (!isBlockItem(stack.id)) {
      hud.toast(`${itemDef(stack.id).name} isn't placeable`);
      return;
    }

    const [x, y, z] = hit.place;
    if (player.intersects(x, y, z)) return;
    if (y < 1 || y >= WORLD_Y) return;
    const current = world.getBlock(x, y, z);
    if (current !== Block.Air && !blockDef(current).liquid) return;

    if (!survival.creative && !inventory.consumeAt(player.slot)) return;
    hud.refreshHotbar();
    swing = SWING_TIME;
    sound.blockPlace(stack.id);

    // A conveyor is stored as one of four facings, chosen from where the
    // player is looking, so belts lay themselves in the direction you walk.
    const placed = stack.id === Block.Conveyor
      ? conveyorForYaw(player.yaw)
      : stack.id;

    world.setBlock(x, y, z, placed); // optimistic
    net.send({ t: 'set', dim: dimension, x, y, z, b: placed });
    // Fired with the item's own id rather than the placed variant, so a
    // conveyor counts whichever of the four facings ends up in the world.
    advancements.fire({ kind: 'place', id: stack.id });
    if (isMachine(placed)) machines.register(x, y, z);
  }

  // -------------------------------------------------------------- streaming

  const subscribed = new Set<number>();

  /** Chunk offsets within the render distance, nearest first. */
  function buildOffsets(radius: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz <= radius * radius) out.push([dx, dz]);
      }
    }
    out.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
    return out;
  }

  let offsets = buildOffsets(renderDistance);

  menus.onSettingsChange = (s) => {
    sensitivity = lookSensitivity(s);
    renderer.fov = s.fov;
    sound.volume = s.volume / 100;
    if (s.renderDistance !== renderDistance) {
      renderDistance = s.renderDistance;
      renderer.renderDistance = renderDistance;
      offsets = buildOffsets(renderDistance);
    }
  };

  function key(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  /**
   * Sky brightness baked into chunk meshes.
   *
   * Only re-meshing picks up a change, so it steps in coarse increments
   * rather than continuously -- otherwise every chunk would rebuild on every
   * frame as the sun moved.
   */
  let skyBrightness = 1;
  let bakedBrightness = 1;

  function updateSkyBrightness(): void {
    if (!world) return;
    const raw = dimension === Dimension.Overworld ? dayNight.state().brightness : 1;
    const wanted = dayNight.raining && dimension === Dimension.Overworld
      ? raw * 0.72
      : raw;
    skyBrightness = Math.round(wanted * 8) / 8;
    if (skyBrightness === bakedBrightness) return;
    bakedBrightness = skyBrightness;
    // Rebuild everything so the new light level is visible.
    for (const chunk of world.chunks.values()) {
      for (let s = 0; s < SECTION_COUNT; s++) chunk.dirty[s] = true;
    }
  }

  function stream(): void {
    if (!world) return;
    const pcx = Math.floor(player.x) >> 4;
    const pcz = Math.floor(player.z) >> 4;

    // 1. Generate missing chunks nearest first, and subscribe to their edits.
    const genDeadline = performance.now() + GEN_BUDGET_MS;
    for (const [dx, dz] of offsets) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      if (world.chunk(cx, cz)) continue;
      if (performance.now() > genDeadline) break;
      world.ensureChunk(cx, cz);
      const k = key(cx, cz);
      if (!subscribed.has(k)) {
        subscribed.add(k);
        net.subscribe(dimension, cx, cz);
      }
    }

    // 2. Rebuild dirty sections nearest first, but only where all four
    //    neighbours exist, so seam faces are right the first time.
    const meshDeadline = performance.now() + MESH_BUDGET_MS;
    for (const [dx, dz] of offsets) {
      if (performance.now() > meshDeadline) break;
      const cx = pcx + dx;
      const cz = pcz + dz;
      const chunk = world.chunk(cx, cz);
      if (!chunk) continue;
      if (
        !world.chunk(cx - 1, cz) || !world.chunk(cx + 1, cz) ||
        !world.chunk(cx, cz - 1) || !world.chunk(cx, cz + 1)
      ) continue;

      for (let s = 0; s < SECTION_COUNT; s++) {
        if (!chunk.dirty[s]) continue;
        chunk.dirty[s] = false;
        renderer.setSection(cx, cz, s,
          meshSection(world, atlas, cx, cz, s, skyBrightness));
        if (performance.now() > meshDeadline) break;
      }
    }

    // 3. Drop anything well outside the view.
    const limit = renderDistance + 2;
    for (const chunk of [...world.chunks.values()]) {
      if (Math.abs(chunk.cx - pcx) <= limit && Math.abs(chunk.cz - pcz) <= limit) continue;
      world.unloadChunk(chunk.cx, chunk.cz);
      renderer.dropChunk(chunk.cx, chunk.cz);
      const k = key(chunk.cx, chunk.cz);
      if (subscribed.delete(k)) net.unsubscribe(dimension, chunk.cx, chunk.cz);
    }
  }

  /**
   * Camera for this frame.
   *
   * On foot it is just the player's eye. Riding, it pulls back behind the
   * vehicle so you can actually see what you are driving, pulling in close
   * when terrain would otherwise be between the camera and the vehicle.
   */
  function camera(dt: number): { eye: Vec3; forward: Vec3 } {
    if (!thirdPerson || !world) {
      chaseDistance = 0;
      return { eye: player.eye, forward: player.forward };
    }

    // On foot, orbit behind the player's own look direction.
    if (!riding) {
      const forward = player.forward;
      let wanted = 4.0;
      for (let t = 0.5; t <= wanted; t += 0.25) {
        const bx = Math.floor(player.x - forward[0] * t);
        const by = Math.floor(player.y + 1.4 - forward[1] * t);
        const bz = Math.floor(player.z - forward[2] * t);
        if (blockDef(world.getBlock(bx, by, bz)).solid) {
          wanted = Math.max(1.0, t - 0.4);
          break;
        }
      }
      chaseDistance += (wanted - chaseDistance) * Math.min(1, dt * 10);
      return {
        eye: [
          player.x - forward[0] * chaseDistance,
          player.y + 1.5 - forward[1] * chaseDistance,
          player.z - forward[2] * chaseDistance,
        ],
        forward,
      };
    }

    // The camera looks where the vehicle is going, angled down a touch so the
    // vehicle sits in the lower half of the frame. Aircraft add their own
    // pitch, so a climb actually looks like a climb.
    const yaw = (riding.yaw * Math.PI) / 180;
    const vehiclePitch = riding.spec.flying ? (riding.pitch * Math.PI) / 180 : 0;
    const pitch = vehiclePitch - 0.13;
    const cp = Math.cos(pitch);
    const forward: Vec3 = [Math.cos(yaw) * cp, Math.sin(pitch), Math.sin(yaw) * cp];

    const focusX = riding.x;
    const focusY = riding.y + riding.spec.seatHeight + 0.5;
    const focusZ = riding.z;

    // Walk backwards along the view ray and stop before entering a block.
    let wanted = CHASE_DISTANCE[riding.kind];
    for (let t = 0.5; t <= wanted; t += 0.25) {
      const bx = Math.floor(focusX - forward[0] * t);
      const by = Math.floor(focusY - forward[1] * t + 0.2);
      const bz = Math.floor(focusZ - forward[2] * t);
      if (blockDef(world.getBlock(bx, by, bz)).solid) {
        wanted = Math.max(1.2, t - 0.4);
        break;
      }
    }

    chaseDistance += (wanted - chaseDistance) * Math.min(1, dt * 8);
    return {
      eye: [
        focusX - forward[0] * chaseDistance,
        focusY - forward[1] * chaseDistance + 0.35,
        focusZ - forward[2] * chaseDistance,
      ],
      forward,
    };
  }

  /**
   * Standing inside a portal for a moment asks the server to move us.
   * The dwell time stops you being yanked away while walking past one.
   */
  function checkPortal(dt: number): void {
    if (!world) return;
    if (portalCooldown > 0) {
      portalCooldown -= dt;
      portalTimer = 0;
      return;
    }

    const bx = Math.floor(player.x);
    const by = Math.floor(player.y + 0.9);
    const bz = Math.floor(player.z);
    const block = world.getBlock(bx, by, bz);
    if (block !== Block.NetherPortal && block !== Block.EndPortal) {
      portalTimer = 0;
      return;
    }

    portalTimer += dt;
    if (portalTimer < PORTAL_DWELL_S) return;
    portalTimer = 0;
    portalCooldown = PORTAL_COOLDOWN_S; // don't ask twice while we wait
    net.send({ t: 'portal', dim: dimension, x: bx, y: by, z: bz });
  }

  /** Drop the player onto solid ground once their spawn chunk exists. */
  function settleSpawn(): void {
    if (spawned || !world) return;
    if (!world.isLoaded(Math.floor(player.x), Math.floor(player.z))) return;
    for (let y = WORLD_Y - 2; y > 0; y--) {
      if (blockDef(world.getBlock(Math.floor(player.x), y, Math.floor(player.z))).solid) {
        player.y = y + 1;
        spawnPoint = { x: player.x, y: y + 1, z: player.z };
        break;
      }
    }
    spawned = true;
  }

  // ------------------------------------------------------------- game loop

  let last = performance.now();
  let moveAccum = 0;
  let fps = 60;

  function frame(now: number): void {
    // A throw inside the loop would otherwise stop the game dead with no
    // explanation at all. Report it, and stop scheduling further frames.
    if (guardFrame(() => tick(now))) requestAnimationFrame(frame);
  }

  function tick(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    fps += (1 / Math.max(dt, 0.0001) - fps) * 0.1;

    if (world) {
      settleSpawn();

      // Hold the loading screen until there is enough world to stand on,
      // but never let it strand the player if generation stalls.
      if (menus.loadingVisible) {
        const target = Math.min(offsets.length, 24);
        const ready = world.chunks.size;
        const timedOut = now - loadStarted > LOAD_TIMEOUT_MS;
        if ((spawned && ready >= target) || timedOut) menus.hideLoading();
        else menus.showLoading(
          `Building the world... ${Math.min(99, Math.round((ready / target) * 100))}%`);
      }

      const frozen = anyPanelOpen();
      if (spawned && !frozen) {
        if (riding) {
          riding.aimX = aimX;
          riding.aimY = aimY;
        }
        // The stick springs back to centre, so hands-off means wings level.
        const centring = Math.pow(0.35, dt);
        aimX *= centring;
        aimY *= centring;

        vehicles.update(dt, world, riding, input);
        if (riding) {
          // The vehicle drives; the player is just cargo.
          const [sx, sy, sz] = riding.seat();
          player.x = sx;
          player.y = sy;
          player.z = sz;
          player.yaw = riding.yaw;
          player.vy = 0;
          player.onGround = riding.onGround;
        } else {
          player.update(dt, world, input);
        }
        survival.inVehicle = riding !== null;
        survival.defense = inventory.defense((id) => armorSpec(id)?.defense ?? 0);
        survival.update(dt, player, world);

        const bitten = mobs.update(dt, world, player);
        if (bitten > 0) survival.damage(bitten, 'was attacked');

        // Machines run whether or not anyone is watching them, which is the
        // point of automation; the callback is how loose items reach the
        // player's inventory.
        // Solar panels read both of these, so the machine layer never has to
        // reach into the day/night cycle itself.
        machines.setEnvironment(dayNight.state().brightness, dayNight.raining);
        machines.update(dt, world, player, (id, count) => {
          if (survival.creative) return count;
          const leftover = inventory.add(id, count);
          if (leftover < count) {
            hud.refreshHotbar();
            advancements.fire({ kind: 'pickup', id });
          }
          return count - leftover;
        });
        dayNight.advance(dt);
        updateSkyBrightness();
        checkPortal(dt);
      }
      stream();

      // A thumbstick moves continuously, so unlike keys -- which push their
      // state on keydown and keyup -- it has to be read every frame.
      if (touch) {
        syncInput();
        const at = touch.stickOffset;
        stickEl.classList.toggle('on', at !== null);
        if (at) {
          stickEl.style.left = `${at.ox}px`;
          stickEl.style.top = `${at.oy}px`;
          // Clamp the knob to the ring so it never escapes the dial.
          const d = Math.hypot(at.dx, at.dy);
          const k = d > 46 ? 46 / d : 1;
          knobEl.style.transform = `translate(${at.dx * k}px, ${at.dy * k}px)`;
        }
      }

      // Walk bob drives the held-item sway and the third-person leg swing.
      const walking = (input.forward || input.back || input.left || input.right) &&
        player.onGround && !riding;
      selfStride += ((walking ? 1 : 0) - selfStride) * Math.min(1, dt * 10);
      if (walking) {
        bob += dt * 9;
        // The tick, not this call, decides cadence: it drops anything
        // sooner than one stride apart, so this can just fire every frame.
        const underfoot = world.getBlock(
          Math.floor(player.x), Math.floor(player.y - 0.1), Math.floor(player.z));
        sound.footstep(underfoot);
      }

      const hit = frozen ? null : player.raycast(world);

      // The dragon is placed, never spawned at random: it appears the first
      // time you are properly inside the End.
      if (dimension === Dimension.End && !dragonBeaten && !mobs.has(MobKind.EnderDragon)) {
        mobs.spawn(MobKind.EnderDragon, 0, 88, 0);
        hud.addChat('The Ender Dragon circles overhead.', true);
      }

      const boss = mobs.boss;
      hud.setBoss(boss ? boss.def.name : null,
        boss ? boss.health / boss.def.health : 0);

      // Mobs, then vehicles, take priority over the block behind them.
      if (mineHeld && !frozen && now - lastSwing >= ATTACK_COOLDOWN_MS) {
        const [ex, ey, ez] = player.eye;
        const [fx, fy, fz] = player.forward;
        const targetMob = mobs.pick(ex, ey, ez, fx, fy, fz, 4);
        if (targetMob) {
          lastSwing = now;
          swing = Math.max(swing, 0.001);
          const damage = attackDamage(heldItem());
          targetMob.hurt(damage);
          if (targetMob.dead) {
            for (const drop of rollDrops(targetMob.kind, Math.random)) {
              if (!survival.creative) inventory.add(drop.id, drop.count);
            }
            hud.refreshHotbar();
            if (targetMob.def.boss) {
              dragonBeaten = true;
              advancements.fire({ kind: 'event', name: 'dragon' });
              hud.setBoss(null);
              releasePointer();
              hud.showVictory(
                'You have beaten the Ender Dragon. The world is yours to build in — ' +
                'the Overworld, the Nether, and everything you make of them.',
                () => grabPointer());
            } else {
              hud.toast(`Killed ${targetMob.def.name}`);
            }
          }
          mineHeld = false;
        } else {
          const targetVehicle = vehicles.pick(ex, ey, ez, fx, fy, fz, 5);
          if (targetVehicle) {
            collectVehicle(targetVehicle);
            mineHeld = false;
          }
        }
      }

      if (mineHeld && !frozen && hit) {
        swing = Math.max(swing, 0.001);
        if (mining.update(dt, hit, heldItem(), survival.creative)) {
          breakBlock(hit.block[0], hit.block[1], hit.block[2], hit.id);
          mining.cancel();
        }
      } else if (!mineHeld) {
        mining.cancel();
      }

      if (placeHeld && !frozen && now - lastPlace >= PLACE_REPEAT_MS) {
        lastPlace = now;
        tryPlace();
      }

      // Swing animation: mining loops it, placing plays it once.
      if (mineHeld && hit) swing = (swing + dt / SWING_TIME) % 1;
      else if (swing > 0) swing = Math.max(0, swing - dt / SWING_TIME);

      moveAccum += dt;
      if (moveAccum >= 1 / TICK_HZ) {
        moveAccum = 0;
        net.send({
          t: 'move', dim: dimension,
          x: player.x, y: player.y, z: player.z,
          yaw: player.yaw, pitch: player.pitch,
        });
      }
      net.interpolate(dt);

      const head = world.getBlock(
        Math.floor(player.x), Math.floor(player.y + EYE_HEIGHT), Math.floor(player.z));
      const look = dimensionLook(dimension);
      // Only the Overworld has a sky worth cycling; the other dimensions have
      // their own fixed look.
      const sky = dayNight.state();
      const baseSky = dimension === Dimension.Overworld ? sky.sky : look.sky;
      renderer.sky.color = head === Block.Water
        ? submergedSky('water')
        : head === Block.Lava
          ? submergedSky('lava')
          : baseSky;
      // Overcast: pull the sky toward grey and take the edge off the light,
      // so rain is visible from inside a base as well as outside.
      if (dayNight.raining && dimension === Dimension.Overworld) {
        const c = renderer.sky.color;
        const grey = (c[0] + c[1] + c[2]) / 3;
        renderer.sky.color = [
          c[0] + (grey - c[0]) * 0.55,
          c[1] + (grey - c[1]) * 0.55,
          c[2] + (grey - c[2]) * 0.55,
        ];
      }
      renderer.sky.ambient = look.ambient;
      renderer.fogFar = look.fogFar;

      const view = camera(dt);
      renderer.render(view.eye, view.forward);

      if (hit) {
        const [x, y, z] = hit.block;
        renderer.drawBox([x - 0.002, y - 0.002, z - 0.002], [x + 1.002, y + 1.002, z + 1.002]);
      }

      // Mining-progress cracks, only in survival: creative breaks instantly,
      // so there is never a partial state worth showing.
      if (mineHeld && hit && !survival.creative && mining.progress > 0) {
        sound.mineTick(hit.id);
        const [x, y, z] = hit.block;
        const crack = buildCrackMesh(atlas, x, y, z, Math.floor(mining.progress * 10));
        renderer.drawWorldMesh(crack.vertices, crack.indices);
      }

      particles.update(dt, world);
      if (particles.count > 0) {
        const pmesh = particles.buildMesh();
        renderer.drawWorldMesh(pmesh.vertices, pmesh.indices);
      }

      if (machines.items.length > 0) {
        const imesh = buildItemMesh(atlas, machines.items, now / 1000);
        renderer.drawWorldMesh(imesh.vertices, imesh.indices);
      }

      // Remote players, plus the local one when the camera is behind us.
      const poses: PlayerPose[] = [];
      for (const p of net.players.values()) {
        const moving = Math.hypot(p.x - p.rx, p.z - p.rz) > 0.005;
        p.phase = (p.phase ?? 0) + (moving ? dt * 9 : 0);
        poses.push({
          x: p.rx, y: p.ry, z: p.rz, yaw: p.ryaw,
          phase: p.phase, stride: moving ? 1 : 0,
        });
      }
      if (thirdPerson) {
        // The player is already parked on the seat by the ride update, so the
        // pose just uses their position directly.
        poses.push({
          x: player.x, y: player.y, z: player.z,
          yaw: riding ? riding.yaw : player.yaw,
          phase: bob,
          stride: riding ? 0 : selfStride,
          seated: riding !== null && riding.kind !== 'skateboard',
        });
      }
      if (poses.length > 0) {
        const mesh = buildPlayerMesh(atlas, poses);
        renderer.drawWorldMesh(mesh.vertices, mesh.indices);
      }

      if (vehicles.vehicles.length > 0) {
        const mesh = buildVehicleMesh(atlas, vehicles.vehicles);
        renderer.drawWorldMesh(mesh.vertices, mesh.indices);
      }

      if (mobs.mobs.length > 0) {
        const mesh = buildMobMesh(atlas, mobs.mobs);
        renderer.drawWorldMesh(mesh.vertices, mesh.indices);
      }

      // The hand is hidden while driving: your hands are on the controls.
      if (!riding) {
        const heldMesh = buildHeldMesh(atlas, { item: heldItem(), swing, bob });
        renderer.drawViewSpace(heldMesh.vertices, heldMesh.indices);
      }

      hud.setHealth(survival.health, survival.creative);
      hud.setFood(survival.food, survival.creative);
      hud.setAir(survival.air, 10);
      hud.setMining(mineHeld && !survival.creative ? mining.progress : 0);

      if (showDebug) {
        const item = heldItem();
        hud.setDebug(
          `Blockcraft  ${fps.toFixed(0)} fps  ${survival.mode}\n` +
          `xyz  ${player.x.toFixed(1)} / ${player.y.toFixed(1)} / ${player.z.toFixed(1)}\n` +
          `chunk ${Math.floor(player.x) >> 4}, ${Math.floor(player.z) >> 4}  ` +
          `dim ${Dimension[dimension]}\n` +
          `sections ${renderer.drawnSections}  tris ${(renderer.drawnTriangles / 1000).toFixed(1)}k\n` +
          `chunks ${world.chunks.size}  players ${net.players.size + 1}  ` +
          `${multiplayer ? (net.connected ? 'online' : 'reconnecting') : 'local'}\n` +
          `holding ${item === null ? 'nothing' : itemDef(item).name}  ` +
          `${player.flying ? 'flying' : player.inLiquid ? 'swimming' : 'walking'}\n` +
          (riding
            ? `riding ${riding.spec.label}  ${Math.abs(riding.speed).toFixed(1)} m/s  ` +
              `alt ${riding.y.toFixed(0)}`
            : `vehicles ${vehicles.vehicles.length}  mobs ${mobs.mobs.length}` +
              `  items ${machines.items.length}`) +
          // NoVolt is a spatial system, so the number reaching the machine
          // you are looking at is the one thing you cannot work out by eye.
          (hit && isMachine(hit.id)
            ? `\nlooking at ${blockDef(hit.id).name}  ` +
              `${machines.pressureAtBlock(hit.block[0], hit.block[1], hit.block[2]).toFixed(0)} nV`
            : '') +
          (dayNight.raining ? '\nweather  raining' : ''),
        );
      }
    }
  }

  // Save local worlds when the tab goes away.
  window.addEventListener('pagehide', () => link.close());

  hud.toggleDebug(showDebug);
  hud.refreshHotbar();
  hud.setSlot(player.slot);

  // Restore a previously chosen pack, then wire the settings controls.
  menus.setupPackControls('Built-in');
  void loadStoredPack().then((stored) => {
    if (stored) void usePack(stored.blob, stored.name);
  });

  requestAnimationFrame(frame);
}

export {};
