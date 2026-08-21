/**
 * The server's admin surface.
 * Run: npx tsx tests/admin.ts
 *
 * This is the one place in the project that lets an outside caller kick
 * people and write to everyone's chat, so the checks that matter most are the
 * ones proving it stays shut: no token, wrong token, off-box, and no
 * ADMIN_TOKEN configured at all.
 *
 * The failure to fear is not a crash. It is a surface that quietly answers
 * somebody it should have ignored.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

const TOKEN = 'a'.repeat(32);
process.env.ADMIN_TOKEN = TOKEN;

// Imported after the env is set: the module reads it once, the way the real
// server does.
const { adminEnabled, handleAdmin } = await import('../server/src/admin.js');

const kicked: Array<{ id: number; reason: string }> = [];
const said: string[] = [];
let saves = 0;

const hooks = {
  players: () => [
    { id: 1, name: 'Ada', dim: 0, x: 10, y: 64, z: -3 },
    { id: 2, name: 'Bob', dim: 1, x: 0, y: 40, z: 0 },
  ],
  kick: (id: number, reason: string) => {
    if (id !== 1 && id !== 2) return false;
    kicked.push({ id, reason });
    return true;
  },
  say: (text: string) => { said.push(text); },
  save: () => { saves++; },
  seed: 4242,
  edits: () => 17,
  startedAt: Date.now() - 5000,
};

const server = createServer((req, res) => {
  void handleAdmin(req, res, hooks).then((handled) => {
    if (!handled) { res.writeHead(200).end('fell through'); }
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

async function call(path: string, opts: {
  token?: string; method?: string; body?: unknown;
} = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.token ? { 'x-admin-token': opts.token } : {}),
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body };
}

check('the surface is on when a token is configured', adminEnabled());

// --- it stays shut ---------------------------------------------------------

{
  const r = await call('/admin/state');
  check('no token is refused', r.status === 404, JSON.stringify(r));
}
{
  const r = await call('/admin/state', { token: 'b'.repeat(32) });
  check('a wrong token of the right length is refused', r.status === 404);
}
{
  const r = await call('/admin/state', { token: 'short' });
  check('a wrong token of the wrong length is refused', r.status === 404);
}
{
  const r = await call('/admin/state', { token: TOKEN + 'x' });
  check('a token with the right prefix is still refused', r.status === 404);
}
// A probe must not be able to tell a locked door from a wall.
{
  const locked = await call('/admin/state');
  const missing = await call('/admin/nosuchroute', { token: TOKEN });
  check('a refused request looks the same as a route that does not exist',
    locked.status === missing.status &&
    JSON.stringify(locked.body) === JSON.stringify(missing.body),
    `${locked.status} ${JSON.stringify(locked.body)} vs ${missing.status} ${JSON.stringify(missing.body)}`);
}

// The loopback lock cannot be tested over a real socket from here -- every
// connection this test can make already comes from 127.0.0.1. So call the
// handler directly with a request that claims to be from somewhere else.
// Without this, removing the check entirely breaks no test at all, which is
// exactly what a mutation run showed.
{
  const seen: { status?: number; body?: string } = {};
  const fakeReq = {
    url: '/admin/state',
    headers: { 'x-admin-token': TOKEN },
    socket: { remoteAddress: '203.0.113.9' },
  } as any;
  const fakeRes = {
    writeHead(code: number) { seen.status = code; return this; },
    end(body: string) { seen.body = body; },
  } as any;

  const handled = await handleAdmin(fakeReq, fakeRes, hooks);
  check('a request from off-box is refused even with the right token',
    handled === true && seen.status === 404, JSON.stringify(seen));

  // And the same request from loopback goes through, so the check above is
  // testing the address and not something else.
  const okSeen: { status?: number; body?: string } = {};
  const okRes = {
    writeHead(code: number) { okSeen.status = code; return this; },
    end(body: string) { okSeen.body = body; },
  } as any;
  await handleAdmin(
    { ...fakeReq, socket: { remoteAddress: '127.0.0.1' } } as any, okRes, hooks);
  check('the identical request from loopback is allowed (control)',
    okSeen.status === 200, JSON.stringify(okSeen).slice(0, 80));
}

// Anything that is not an admin route must pass through untouched, or the
// admin module would swallow the whole site.
{
  const r = await call('/index.html', { token: TOKEN });
  check('a non-admin URL falls through to the normal handler',
    r.status === 200 && r.body === 'fell through', JSON.stringify(r));
}

// --- it works when it should ----------------------------------------------

{
  const r = await call('/admin/state', { token: TOKEN });
  check('state returns the player list', r.status === 200 && r.body.players.length === 2,
    JSON.stringify(r.body));
  check('with names and positions, which is what a console has to show',
    r.body.players[0].name === 'Ada' && r.body.players[0].y === 64);
  check('and the numbers a host wants at a glance',
    r.body.seed === 4242 && r.body.edits === 17 && r.body.uptimeMs >= 5000 &&
    typeof r.body.memoryMb === 'number', JSON.stringify(r.body));
}

{
  const r = await call('/admin/kick', { token: TOKEN, method: 'POST', body: { id: 1, reason: 'Behave' } });
  check('kick removes the named player', r.status === 200 && r.body.ok === true);
  check('and passes the reason through, so they are told why',
    kicked.length === 1 && kicked[0].reason === 'Behave', JSON.stringify(kicked));
}
{
  const r = await call('/admin/kick', { token: TOKEN, method: 'POST', body: { id: 99 } });
  check('kicking somebody who is not there reports it rather than pretending',
    r.status === 200 && r.body.ok === false);
}
{
  const r = await call('/admin/kick', { token: TOKEN, method: 'POST', body: { id: 'Ada' } });
  check('a non-numeric id is refused with a reason', r.status === 400,
    JSON.stringify(r.body));
}

{
  const r = await call('/admin/say', { token: TOKEN, method: 'POST', body: { text: 'Back in five' } });
  check('say broadcasts', r.status === 200 && said[0] === 'Back in five');
}
{
  const r = await call('/admin/say', { token: TOKEN, method: 'POST', body: { text: '   ' } });
  check('an empty message is refused rather than broadcast as blank',
    r.status === 400 && said.length === 1);
}
{
  await call('/admin/say', { token: TOKEN, method: 'POST', body: { text: 'x'.repeat(400) } });
  check('an over-long message is trimmed, not rejected outright',
    said[said.length - 1].length === 256, String(said[said.length - 1].length));
}

{
  const r = await call('/admin/save', { token: TOKEN, method: 'POST' });
  check('save forces a world save', r.status === 200 && saves === 1);
}

// Drop keep-alive sockets before closing. fetch holds them open, so close()
// alone waits forever and exiting mid-close trips a libuv assertion that
// looks like a test failure to anyone reading the output.
server.closeAllConnections?.();
await new Promise<void>((r) => server.close(() => r()));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
