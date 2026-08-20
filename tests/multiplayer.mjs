/** Integration test: two clients against the live server. */
import WebSocket from 'ws';

const URL = 'ws://localhost:8787/ws';
const V = 1;
const OVERWORLD = 0;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(URL);
  const inbox = [];
  ws.on('message', (raw) => inbox.push(JSON.parse(String(raw))));
  return {
    name, ws, inbox,
    open: new Promise((res) => ws.on('open', res)),
    send: (m) => ws.send(JSON.stringify(m)),
    /** Wait for a message of type t matching pred. */
    async expect(t, pred = () => true, ms = 2500) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const hit = inbox.find((m) => m.t === t && pred(m));
        if (hit) return hit;
        await wait(25);
      }
      throw new Error(`[${name}] timed out waiting for "${t}"; got: ${
        [...new Set(inbox.map((m) => m.t))].join(', ') || '(nothing)'}`);
    },
  };
}

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ label, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

const A = client('A');
const B = client('B');
await Promise.all([A.open, B.open]);

A.send({ t: 'hello', v: V, name: 'Alice' });
const welcomeA = await A.expect('welcome');
check('A gets welcome', !!welcomeA.seed || welcomeA.seed === 0,
  `id=${welcomeA.id} seed=${welcomeA.seed} spawn=${welcomeA.spawn.x},${welcomeA.spawn.y.toFixed(1)},${welcomeA.spawn.z}`);

B.send({ t: 'hello', v: V, name: 'Bob' });
const welcomeB = await B.expect('welcome');
check('B sees A in the player list', welcomeB.players.some((p) => p.name === 'Alice'));

const joinA = await A.expect('join', (m) => m.player.name === 'Bob');
check('A is told Bob joined', !!joinA);

check('same seed for both clients', welcomeA.seed === welcomeB.seed);

// --- chunk subscription + block edit propagation -------------------------
const { x: sx, y: sy, z: sz } = welcomeA.spawn;
const cx = Math.floor(sx) >> 4;
const cz = Math.floor(sz) >> 4;

A.send({ t: 'sub', dim: OVERWORLD, cx, cz });
B.send({ t: 'sub', dim: OVERWORLD, cx, cz });
const chunkA = await A.expect('chunk', (m) => m.cx === cx && m.cz === cz);
check('chunk edits delivered on subscribe', Array.isArray(chunkA.edits),
  `${chunkA.edits.length} existing edits`);

// Both players must be near the block for reach checks to pass.
for (const c of [A, B]) {
  c.send({ t: 'move', dim: OVERWORLD, x: sx, y: sy, z: sz, yaw: 0, pitch: 0 });
}
await wait(120);

const tx = Math.floor(sx);
const ty = Math.floor(sy) + 2;
const tz = Math.floor(sz);
A.send({ t: 'set', dim: OVERWORLD, x: tx, y: ty, z: tz, b: 11 }); // Bricks
const setB = await B.expect('set', (m) => m.x === tx && m.y === ty && m.z === tz);
check('B receives the block A placed', setB.b === 11, `block=${setB.b}`);

// --- reach validation -----------------------------------------------------
A.send({ t: 'set', dim: OVERWORLD, x: tx + 400, y: ty, z: tz, b: 11 });
const rejected = await A.expect('reject', (m) => m.x === tx + 400);
check('out-of-reach placement rejected', rejected.reason === 'out of reach', rejected.reason);

// --- placing into occupied space is refused ------------------------------
A.send({ t: 'set', dim: OVERWORLD, x: tx, y: ty, z: tz, b: 3 }); // already bricks
const blocked = await A.expect('reject', (m) => m.x === tx && m.b !== undefined);
check('placing into an occupied cell rejected', blocked.reason === 'blocked', blocked.reason);

// --- movement relay -------------------------------------------------------
A.send({ t: 'move', dim: OVERWORLD, x: sx + 3, y: sy, z: sz + 1, yaw: 45, pitch: 10 });
const moved = await B.expect('players', (m) => m.list.some((p) => p.name === 'Alice' && p.x === sx + 3));
check('B receives A movement', !!moved);

// --- chat -----------------------------------------------------------------
A.send({ t: 'chat', text: 'hello world' });
const chat = await B.expect('chat', (m) => m.text === 'hello world');
check('chat relayed', chat.name === 'Alice');

// --- a fresh client sees the persisted edit -------------------------------
const C = client('C');
await C.open;
C.send({ t: 'hello', v: V, name: 'Carol' });
await C.expect('welcome');
C.send({ t: 'sub', dim: OVERWORLD, cx, cz });
const chunkC = await C.expect('chunk', (m) => m.cx === cx && m.cz === cz);
const idx = (ty << 8) | ((tz & 15) << 4) | (tx & 15);
check('late joiner receives the edit', chunkC.edits.some(([i, b]) => i === idx && b === 11),
  `${chunkC.edits.length} edits`);

// --- leave ----------------------------------------------------------------
C.ws.close();
const left = await A.expect('leave');
check('leave broadcast', typeof left.id === 'number');

// Put the world back the way we found it.
A.send({ t: 'move', dim: OVERWORLD, x: sx, y: sy, z: sz, yaw: 0, pitch: 0 });
await wait(100);
A.send({ t: 'set', dim: OVERWORLD, x: tx, y: ty, z: tz, b: 0 });
await wait(200);

A.ws.close();
B.ws.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
