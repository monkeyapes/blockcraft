/**
 * Solar power, batteries, elevators, weather and hunger.
 * Run: npx tsx tests/power2.ts
 */

import { Block } from '../shared/src/blocks.js';
import { Dimension, WORLD_Y, voxelIndex } from '../shared/src/constants.js';
import { Item } from '../shared/src/items.js';
import { solarOutput, BATTERY_CAPACITY } from '../shared/src/machines.js';
import { MachineWorld } from '../client/src/machines.js';
import { MAX_FOOD, Survival } from '../client/src/survival.js';
import { Player } from '../client/src/player.js';
import { ClientWorld } from '../client/src/world.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

function flatWorld(): ClientWorld {
  const world = new ClientWorld(13, Dimension.Overworld);
  const chunk = world.ensureChunk(0, 0);
  for (let y = 0; y < WORLD_Y; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++)
        chunk.data[voxelIndex(x, y, z)] = y <= 40 ? Block.Stone : Block.Air;
  chunk.rebuildHeightmap();
  world.light.resetSky(0, 0);
  return world;
}
const NOWHERE = { x: -999, y: -999, z: -999 };
const run = (m: MachineWorld, w: ClientWorld, s: number, dt = 1 / 30) => {
  for (let i = 0; i < Math.round(s / dt); i++) m.update(dt, w, NOWHERE, () => 0);
};

// --- Solar output ---------------------------------------------------------
{
  check('a buried panel makes nothing at noon', solarOutput(1, false, false) === 0);
  check('an exposed panel makes power at noon', solarOutput(1, true, false) > 0);
  check('night stops it', solarOutput(0.12, true, false) === 0);
  check('rain cuts it', solarOutput(1, true, true) < solarOutput(1, true, false),
    `${solarOutput(1, true, true)} raining vs ${solarOutput(1, true, false)} clear`);
  check('heavy rain can stop it entirely', solarOutput(0.6, true, true) === 0);
}

// --- A solar panel powers a machine in daylight, not at night -------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(2, 41, 8, Block.SolarPanel);
  w.setBlock(3, 41, 8, Block.Cable);
  w.setBlock(4, 41, 8, Block.Miner);
  m.register(2, 41, 8);
  m.register(4, 41, 8);

  m.setEnvironment(1, false);
  run(m, w, 1);
  check('a panel in open daylight powers the run', m.isPowered(4, 41, 8));

  m.setEnvironment(0.1, false);
  run(m, w, 1);
  check('and stops at night', !m.isPowered(4, 41, 8));

  m.setEnvironment(1, true);
  run(m, w, 1);
  check('rain still leaves some daytime output', m.isPowered(4, 41, 8));
}

// --- A battery charges by day and carries the night ----------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(2, 41, 8, Block.SolarPanel);
  w.setBlock(3, 41, 8, Block.Cable);
  w.setBlock(4, 41, 8, Block.Battery);
  w.setBlock(5, 41, 8, Block.Cable);
  w.setBlock(6, 41, 8, Block.Miner);
  for (const p of [[2,41,8],[4,41,8],[6,41,8]] as const) m.register(p[0], p[1], p[2]);

  m.setEnvironment(1, false);
  run(m, w, 20);
  check('a battery charges from a live network',
    m.charge(4, 41, 8) > 5, `charge ${m.charge(4, 41, 8).toFixed(1)}s`);

  // Night: the panel dies, the battery should keep the miner going.
  m.setEnvironment(0.05, false);
  run(m, w, 1);
  check('a charged battery carries the network through the night',
    m.isPowered(6, 41, 8), `charge ${m.charge(4, 41, 8).toFixed(1)}s`);

  const before = m.charge(4, 41, 8);
  run(m, w, 6);
  check('and drains while doing so', m.charge(4, 41, 8) < before,
    `${before.toFixed(1)} -> ${m.charge(4, 41, 8).toFixed(1)}`);
}

// --- An empty battery supplies nothing ------------------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  w.setBlock(4, 41, 8, Block.Battery);
  w.setBlock(5, 41, 8, Block.Cable);
  w.setBlock(6, 41, 8, Block.Miner);
  m.register(4, 41, 8);
  m.register(6, 41, 8);
  m.setEnvironment(0.05, false);
  run(m, w, 1);
  check('a flat battery powers nothing', !m.isPowered(6, 41, 8));
  check('battery capacity is bounded', BATTERY_CAPACITY > 0 && BATTERY_CAPACITY < 1000);
}

// --- An elevator lifts items ---------------------------------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  for (let y = 41; y <= 50; y++) w.setBlock(8, y, 8, Block.Elevator);
  m.spawn(8.5, 41.5, 8.5, Item.Coal, 1, 0);
  const startY = m.items[0].y;
  run(m, w, 3);
  check('an item in an elevator shaft rises',
    m.items.length === 1 && m.items[0].y > startY + 4,
    `${startY.toFixed(1)} -> ${m.items[0]?.y.toFixed(1)}`);
  check('and stays centred in the shaft',
    Math.abs(m.items[0].x - 8.5) < 0.3 && Math.abs(m.items[0].z - 8.5) < 0.3,
    `x=${m.items[0]?.x.toFixed(2)} z=${m.items[0]?.z.toFixed(2)}`);
}

// --- Items leaving the top of a shaft fall back out ----------------------
{
  const w = flatWorld();
  const m = new MachineWorld();
  for (let y = 41; y <= 45; y++) w.setBlock(8, y, 8, Block.Elevator);
  m.spawn(8.5, 41.5, 8.5, Item.Coal, 1, 0);
  run(m, w, 6);
  const it = m.items[0];
  check('an item does not fly off forever above the shaft',
    !!it && it.y < 52, `ended at y=${it?.y.toFixed(1)}`);
}

// --- Hunger ---------------------------------------------------------------
{
  const w = flatWorld();
  const s = new Survival();
  const p = new Player();
  p.x = 8.5; p.y = 41; p.z = 8.5;
  check('you start full', s.food === MAX_FOOD);

  for (let i = 0; i < 60 * 200; i++) s.update(1 / 60, p, w);
  check('food drains over time', s.food < MAX_FOOD, `food ${s.food}`);

  s.food = 2;
  s.health = 20;
  for (let i = 0; i < 60 * 40; i++) s.update(1 / 60, p, w);
  check('low food blocks regeneration and starves you',
    s.health < 20, `health ${s.health}`);
  check('starving never kills outright', s.health >= 1, `health ${s.health}`);

  s.feed(20);
  check('eating restores food', s.food === MAX_FOOD, `food ${s.food}`);

  const c = new Survival();
  c.mode = 'creative';
  for (let i = 0; i < 600; i++) c.update(1 / 60, p, w);
  check('creative never gets hungry', c.food === MAX_FOOD);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
