/**
 * End-to-end dimension travel against the running multiplayer server.
 *
 * Covers the wiring the pure portal tests cannot: item use over the wire,
 * server-side portal construction, the dimension switch message, and the
 * chunk re-subscription that has to follow it.
 *
 * Requires the server running (npm run dev). Run: node tests/dimensions.mjs
 */
import WebSocket from 'ws';

const URL = 'ws://localhost:8787/ws';
const V = 1;
const OVERWORLD = 0;
const NETHER = 1;

const AIR = 0;
const OBSIDIAN = 28;
const NETHER_PORTAL = 29;
const NETHERRACK = 25;
const FLINT_AND_STEEL = 153;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

function client(name) {
  const ws = new WebSocket(URL);
  const inbox = [];
  ws.on('message', (raw) => inbox.push(JSON.parse(String(raw))));
  return {
    name, ws, inbox,
    open: new Promise((res) => ws.on('open', res)),
    send: (m) => ws.send(JSON.stringify(m)),
    async expect(t, pred = () => true, ms = 4000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const hit = inbox.find((m) => m.t === t && pred(m));
        if (hit) return hit;
        await wait(25);
      }
      throw new Error(`[${name}] timed out waiting for "${t}"; saw: ${
        [...new Set(inbox.map((m) => m.t))].join(', ') || '(nothing)'}`);
    },
    seen(t, pred = () => true) {
      return inbox.some((m) => m.t === t && pred(m));
    },
  };
}

const A = client('A');
await A.open;
A.send({ t: 'hello', v: V, name: 'Traveller' });
const welcome = await A.expect('welcome');
check('connected', typeof welcome.seed === 'number', `seed ${welcome.seed}`);

// Work well away from spawn, at a fresh site each run: portal blocks are
// deliberately unbreakable, so a previous run's portal cannot be cleared.
const baseX = 2400 + ((Date.now() >> 4) % 400) * 16;
const baseZ = 2400 + ((Date.now() >> 9) % 400) * 16;
const baseY = 70;

const cx = baseX >> 4;
const cz = baseZ >> 4;
A.send({ t: 'sub', dim: OVERWORLD, cx, cz });
await A.expect('chunk', (m) => m.cx === cx && m.cz === cz);

// Stand next to the build site so every edit is within reach.
const stand = () => A.send({
  t: 'move', dim: OVERWORLD, x: baseX + 0.5, y: baseY, z: baseZ + 0.5, yaw: 0, pitch: 0,
});
stand();
await wait(120);

// --- build a 2x3 obsidian frame --------------------------------------------
const frame = [];
for (let dy = -1; dy <= 3; dy++) {
  for (let dx = -1; dx <= 2; dx++) {
    const edge = dy === -1 || dy === 3 || dx === -1 || dx === 2;
    if (edge) frame.push([baseX + dx, baseY + dy, baseZ]);
  }
}
// Clear the interior first, then lay the frame.
for (let dy = 0; dy <= 2; dy++) {
  for (let dx = 0; dx <= 1; dx++) {
    A.send({ t: 'set', dim: OVERWORLD, x: baseX + dx, y: baseY + dy, z: baseZ, b: AIR });
  }
}
for (const [x, y, z] of frame) {
  A.send({ t: 'set', dim: OVERWORLD, x, y, z, b: AIR });
}
await wait(250);
for (const [x, y, z] of frame) {
  A.send({ t: 'set', dim: OVERWORLD, x, y, z, b: OBSIDIAN });
}
await wait(400);
check('obsidian frame placed', !A.seen('reject', (m) => m.reason === 'out of reach'));

// --- light it ---------------------------------------------------------------
A.send({
  t: 'use', dim: OVERWORLD, x: baseX, y: baseY - 1, z: baseZ, item: FLINT_AND_STEEL,
});
const consumed = await A.expect('consume');
check('flint and steel was consumed', consumed.item === FLINT_AND_STEEL);

const litBlock = await A.expect(
  'set', (m) => m.b === NETHER_PORTAL && m.x === baseX && m.y === baseY);
check('portal blocks were broadcast', !!litBlock);

// --- step in ----------------------------------------------------------------
A.send({ t: 'portal', dim: OVERWORLD, x: baseX, y: baseY, z: baseZ });
const dim = await A.expect('dim');
check('server moved us to another dimension', dim.dim === NETHER, `dim=${dim.dim}`);
check('arrival is at 1/8 scale',
  Math.abs(dim.x - baseX / 8) < 6 && Math.abs(dim.z - baseZ / 8) < 6,
  `${dim.x.toFixed(1)}, ${dim.z.toFixed(1)} (expected ~${baseX / 8}, ${baseZ / 8})`);

// --- the arrival site must be real ------------------------------------------
const ncx = Math.floor(dim.x) >> 4;
const ncz = Math.floor(dim.z) >> 4;
A.send({ t: 'sub', dim: NETHER, cx: ncx, cz: ncz });
const netherChunk = await A.expect('chunk', (m) => m.dim === NETHER && m.cx === ncx);
check('the nether chunk carries the built arrival site', netherChunk.edits.length > 0,
  `${netherChunk.edits.length} edits`);

const blocks = new Set(netherChunk.edits.map(([, b]) => b));
check('a return portal was built', blocks.has(NETHER_PORTAL));
check('the landing platform is obsidian', blocks.has(OBSIDIAN));

// --- and back again ---------------------------------------------------------
A.send({
  t: 'move', dim: NETHER, x: dim.x, y: dim.y, z: dim.z, yaw: 0, pitch: 0,
});
await wait(3200); // portal cooldown
A.send({
  t: 'portal', dim: NETHER,
  x: Math.floor(dim.x), y: Math.floor(dim.y), z: Math.floor(dim.z),
});
const back = await A.expect('dim', (m) => m.dim === OVERWORLD);
check('travelling back returns to the overworld', back.dim === OVERWORLD);
check('we come out near where we started',
  Math.abs(back.x - baseX) < 24 && Math.abs(back.z - baseZ) < 24,
  `${back.x.toFixed(0)}, ${back.z.toFixed(0)} (from ${baseX}, ${baseZ})`);

// Travelling twice in quick succession must be refused, or you bounce
// straight back out of the portal you just arrived in.
A.send({ t: 'portal', dim: OVERWORLD, x: baseX, y: baseY, z: baseZ });
await wait(600);
const switches = A.inbox.filter((m) => m.t === 'dim').length;
check('the portal cooldown blocks an immediate second trip', switches === 2,
  `${switches} dimension switches`);

A.ws.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
