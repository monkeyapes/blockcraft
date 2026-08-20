/**
 * The marketing site, checked against the game it describes.
 * Run: npx tsx tests/site.ts
 *
 * The site quotes hard numbers -- how much pressure a machine needs, how many
 * blocks exist, how long a cycle takes -- and a reader has no way to tell a
 * stale figure from a true one. So every number on the page is pinned here to
 * the value it claims to be reporting. If the game's balance moves and the
 * page does not, this fails rather than letting the site quietly lie.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Block } from '../shared/src/blocks.js';
import { CRUSH_SECONDS } from '../shared/src/machines.js';
import {
  COMPRESS_SECONDS, ESMELT_SECONDS, LINE_LOSS, MAX_BOOST, QUARRY_SECONDS,
  SAWMILL_SECONDS, SOURCE_PRESSURE, STONEGEN_SECONDS, demandOf,
} from '../shared/src/novolt.js';
import { RECIPES } from '../shared/src/recipes.js';
import { ADVANCEMENTS } from '../shared/src/advancements.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'site', 'index.html'), 'utf8');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}${detail ? '  -- ' + detail : ''}`);
  }
}

/** Pulls one `key: value` out of the rig's MACHINES table in the page. */
function rigField(machineKey: string, field: string): number | null {
  const row = html.match(new RegExp(`${machineKey}:\\s*\\{([^}]*)\\}`));
  if (!row) return null;
  const m = row[1].match(new RegExp(`${field}:\\s*([0-9.]+)`));
  return m ? Number(m[1]) : null;
}

// --- the interactive rig reports the game's own numbers -------------------

const RIG_TO_BLOCK: Array<[string, Block, number]> = [
  ['crusher', Block.Crusher, CRUSH_SECONDS],
  ['stonegen', Block.StoneGenerator, STONEGEN_SECONDS],
  ['sawmill', Block.Sawmill, SAWMILL_SECONDS],
  ['efurnace', Block.ElectricFurnace, ESMELT_SECONDS],
  ['compressor', Block.Compressor, COMPRESS_SECONDS],
  ['quarry', Block.Quarry, QUARRY_SECONDS],
];

for (const [key, block, seconds] of RIG_TO_BLOCK) {
  const demand = demandOf(block)!;
  check(`rig ${key} draw matches the game`,
    rigField(key, 'draw') === demand.draw,
    `page says ${rigField(key, 'draw')}, game says ${demand.draw}`);
  check(`rig ${key} minimum matches the game`,
    rigField(key, 'minimum') === demand.minimum,
    `page says ${rigField(key, 'minimum')}, game says ${demand.minimum}`);
  check(`rig ${key} cycle time matches the game`,
    rigField(key, 'seconds') === seconds,
    `page says ${rigField(key, 'seconds')}s, game says ${seconds}s`);
}

check('rig line loss matches the game',
  new RegExp(`var LINE_LOSS = ${LINE_LOSS};`).test(html));
check('rig boost ceiling matches the game',
  new RegExp(`var MAX_BOOST = ${MAX_BOOST};`).test(html));

// The source dropdown's values are pressures the game actually produces.
const sourceOptions = [...html.matchAll(/<option value="(\d+)">([^<]*?)—/g)]
  .map((m) => Number(m[1]));
const realPressures = Object.values(SOURCE_PRESSURE);
check('every source on the page is a real source pressure',
  sourceOptions.length > 0 && sourceOptions.every((v) => realPressures.includes(v)),
  `page offers ${sourceOptions.join(', ')}; game has ${realPressures.join(', ')}`);

// --- the machine table's stated minimums ---------------------------------

const TABLE_ROWS: Array<[string, Block]> = [
  ['Stone generator', Block.StoneGenerator],
  ['Sawmill', Block.Sawmill],
  ['Miner', Block.Miner],
  ['Electric furnace', Block.ElectricFurnace],
  ['Compressor', Block.Compressor],
  ['Crusher', Block.Crusher],
  ['Quarry', Block.Quarry],
];

for (const [label, block] of TABLE_ROWS) {
  const row = html.match(new RegExp(`>${label}</td>[\\s\\S]{0,160}?>(\\d+) nV<`));
  const stated = row ? Number(row[1]) : null;
  check(`table row "${label}" states the real minimum`,
    stated === demandOf(block)!.minimum,
    `page says ${stated}, game says ${demandOf(block)!.minimum}`);
}

// --- the headline stats --------------------------------------------------

/** Reads one `<b>N</b><span>label</span>` out of the hero stats strip. */
function statValue(label: string): number | null {
  const m = html.match(new RegExp(`<b>([\\d]+)</b><span>${label}</span>`));
  return m ? Number(m[1]) : null;
}

const blockCount = Object.keys(Block).filter((k) => isNaN(Number(k))).length;
const machineCount = Object.values(Block)
  .filter((b) => typeof b === 'number' && demandOf(b as number)).length;

check('stat "blocks" is the real block count',
  statValue('blocks') === blockCount,
  `page says ${statValue('blocks')}, game has ${blockCount}`);
check('stat "recipes" is the real recipe count',
  statValue('recipes') === RECIPES.length,
  `page says ${statValue('recipes')}, game has ${RECIPES.length}`);
check('stat "machines" is the real count of NoVolt consumers',
  statValue('machines') === machineCount,
  `page says ${statValue('machines')}, game has ${machineCount}`);

// The advancement count is not on the page today, but the site claims a
// finishable game, so at least assert there is an ending to advance to.
check('the game has advancements for the site to claim', ADVANCEMENTS.length > 0);

// --- claims that are checkable ------------------------------------------

check('the "0 image files" claim is marked as the key stat',
  /<div class="stat key"><b>0<\/b><span>image files<\/span>/.test(html));

// Every GitHub link has to point at one repository. A half-substituted page --
// a real owner on the download button and a leftover placeholder on the source
// link -- would send someone to a 404 from the one place they went looking.
const repos = [...html.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)/g)]
  .map((m) => `${m[1]}/${m[2]}`);
check('the page carries GitHub links at all', repos.length >= 2, `found ${repos.length}`);
check('every GitHub link points at the same repository',
  new Set(repos).size === 1, `found ${[...new Set(repos)].join(', ')}`);
check('no unsubstituted placeholder is left in a link',
  !/YOUR-USERNAME/.test(html));

// The play link is relative, so the site works from a project subpath.
check('the play link is relative, not rooted',
  html.includes('href="play/"') && !html.includes('href="/play/"'));

// Assets the page references must exist on disk.
const referenced = [
  ...html.matchAll(/(?:src|href)="((?:img|fonts)\/[^"]+)"/g),
  // Block textures are pulled in as CSS backgrounds, not as elements.
  ...html.matchAll(/url\('((?:img|fonts)\/[^']+)'\)/g),
];
for (const asset of referenced
  .map((m) => m[1])
  .filter((v, i, a) => a.indexOf(v) === i)) {
  let exists = true;
  try {
    readFileSync(join(here, '..', 'site', asset));
  } catch {
    exists = false;
  }
  check(`referenced asset exists: ${asset}`, exists);
}

console.log(failures === 0
  ? '\nAll site checks passed.'
  : `\n${failures} site check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
