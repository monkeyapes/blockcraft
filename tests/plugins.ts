/**
 * The plugin host.
 * Run: npx tsx tests/plugins.ts
 *
 * The thing that has to hold is isolation of *failure*, not of privilege.
 * Plugins run in-process with no sandbox and that is deliberate, but one
 * plugin throwing must never take down the server, block a player joining,
 * or stop the other plugins running. A server that will not boot because of
 * one broken plugin is a server whose owner cannot get in to remove it.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PluginHost, type PluginPlayer } from '../server/src/plugins.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

const told: Array<{ to: string; text: string }> = [];
const said: string[] = [];
const logged: string[] = [];

// The server log is where plugin failures are reported, so capture it.
const realLog = console.log;
console.log = (...a: unknown[]) => { logged.push(a.join(' ')); realLog(...a); };

const ada: PluginPlayer = { id: 1, name: 'Ada', dim: 0, x: 0, y: 64, z: 0 };

function makeHost(): PluginHost {
  return new PluginHost({
    serverName: 'Test',
    tell: (to, text) => told.push({ to, text }),
    broadcast: (text) => said.push(text),
    players: () => [ada],
    grant: () => true,
    take: () => 1,
    storagePath: (f) => join('storage', f),
  });
}

// --- registering and running ----------------------------------------------

{
  const host = makeHost();
  let ran = '';
  host.registerBuiltin('greeter', (ctx) => {
    ctx.command('hello', 'say hello', (p, args) => { ran = `${p.name}:${args}`; });
  });

  check('a builtin plugin loads', host.names.includes('greeter'));
  check('its command runs', host.runCommand(ada, '/hello there') === true && ran === 'Ada:there',
    ran);
  check('an unowned command is left alone', host.runCommand(ada, '/nosuch') === false);
  check('ordinary chat is left alone', host.runCommand(ada, 'hello') === false);
  check('help lists it', host.helpLines().some((l) => l.includes('/hello')),
    host.helpLines().join(' | '));
}

// Two plugins wanting the same command: first wins, and the clash is named.
{
  const host = makeHost();
  let which = '';
  host.registerBuiltin('first', (ctx) => {
    ctx.command('dup', 'first', () => { which = 'first'; });
  });
  host.registerBuiltin('second', (ctx) => {
    ctx.command('dup', 'second', () => { which = 'second'; });
  });
  host.runCommand(ada, '/dup');
  check('the first registration of a command wins', which === 'first', which);
  check('and the clash is reported, naming both plugins',
    logged.some((l) => l.includes('second') && l.includes('first') && l.includes('dup')),
    logged.filter((l) => l.includes('dup')).join(' | '));
}

// --- one plugin must not break another --------------------------------------

{
  const host = makeHost();
  const seen: string[] = [];
  host.registerBuiltin('broken', (ctx) => {
    ctx.on('join', () => { throw new Error('boom'); });
  });
  host.registerBuiltin('healthy', (ctx) => {
    ctx.on('join', (p) => { seen.push(p.name); });
  });

  const before = logged.length;
  host.emit('join', ada);
  check('a plugin throwing on an event does not stop the others',
    seen.includes('Ada'), seen.join(','));
  check('and the failure is logged against the plugin that caused it',
    logged.slice(before).some((l) => l.includes('broken') && l.includes('boom')),
    logged.slice(before).join(' | '));
}

{
  const host = makeHost();
  host.registerBuiltin('throwy', (ctx) => {
    ctx.command('bad', 'throws', () => { throw new Error('nope'); });
  });
  const before = told.length;
  const handled = host.runCommand(ada, '/bad');
  check('a command that throws is still reported as handled', handled === true);
  check('the player is told rather than left with silence',
    told.length > before, JSON.stringify(told.slice(before)));
  check('and the log names the plugin',
    logged.some((l) => l.includes('throwy') && l.includes('nope')));
}

{
  const host = makeHost();
  host.registerBuiltin('badpanel', (ctx) => {
    ctx.panel('oops', () => { throw new Error('panel boom'); });
  });
  check('a panel that throws returns null rather than propagating',
    host.buildPanel(ada, 'oops') === null);
  check('an unowned panel id is null too', host.buildPanel(ada, 'nothing') === null);
}

// A plugin whose register() throws must not stop the ones after it.
{
  const host = makeHost();
  host.registerBuiltin('explodes', () => { throw new Error('register boom'); });
  host.registerBuiltin('fine', (ctx) => { ctx.command('ok', 'ok', () => {}); });
  check('a plugin that fails to register is skipped, not fatal',
    !host.names.includes('explodes') && host.names.includes('fine'),
    host.names.join(','));
}

// --- panels ----------------------------------------------------------------

{
  const host = makeHost();
  host.registerBuiltin('shopish', (ctx) => {
    ctx.panel('things', (p, arg, notice) => ({
      t: 'panel', id: 'things', title: `${p.name} ${arg ?? ''}`.trim(),
      rows: [{ label: 'a thing' }], notice,
    }));
    ctx.panelAction('things', (p, action) => ({
      t: 'panel', id: 'things', title: 'after', rows: [], notice: `did ${action}`,
    }));
  });

  const panel = host.buildPanel(ada, 'things', 'page2', 'hi');
  check('a panel is built with the player and argument',
    panel?.title === 'Ada page2' && panel?.notice === 'hi', JSON.stringify(panel));
  const after = host.runPanelAction(ada, 'things', 'buy', '4', 2);
  check('a panel action runs and returns the next panel',
    after?.notice === 'did buy', JSON.stringify(after));
  check('an unowned action id is null',
    host.runPanelAction(ada, 'nothing', 'x') === null);
}

// --- loading from disk ------------------------------------------------------

{
  const dir = mkdtempSync(join(tmpdir(), 'bc-plugins-'));
  writeFileSync(join(dir, 'motd.mjs'),
    `export function register(ctx) {
       ctx.command('motd', 'the message', (p) => ctx.tell(p.name, 'Welcome to ' + ctx.serverName));
     }`);
  // A plugin that is not valid JavaScript at all.
  writeFileSync(join(dir, 'broken.mjs'), 'this is not javascript {{{');
  // A file that loads but exports nothing useful.
  writeFileSync(join(dir, 'empty.mjs'), 'export const nothing = 1;');
  // Not a plugin; must be ignored rather than loaded.
  writeFileSync(join(dir, 'notes.txt'), 'ignore me');

  const host = makeHost();
  const before = told.length;
  await host.loadFrom(dir);

  check('a plugin file on disk loads', host.names.includes('motd'), host.names.join(','));
  check('one that will not parse is skipped rather than fatal',
    !host.names.includes('broken'));
  check('one with no register function is skipped',
    !host.names.includes('empty'));
  check('non-.mjs files are ignored', !host.names.includes('notes'));
  check('both failures are named in the log',
    logged.some((l) => l.includes('broken')) && logged.some((l) => l.includes('empty')));

  host.runCommand(ada, '/motd');
  check('the loaded plugin can talk to players and knows the server name',
    told.slice(before).some((t) => t.text === 'Welcome to Test'),
    JSON.stringify(told.slice(before)));

  check('loading a directory that does not exist is not an error',
    await host.loadFrom(join(dir, 'nope')) === undefined);

  rmSync(dir, { recursive: true, force: true });
}

console.log = realLog;
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
