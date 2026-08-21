/**
 * The hosting window.
 *
 * Wiring only. The decisions live in hostlogic.ts and adminclient.ts, where
 * they can be tested without a window or a child process.
 */

import { isValidName, RESERVED } from '@shared/address.js';
import {
  type AdminPlayer, type AdminState, HELP_TEXT, dimensionName,
  findPlayer, mintToken, parseCommand,
} from './adminclient.js';
import {
  makeBackend, type AdminApi, type Backend, type ServerHandle,
} from './backend.js';
import {
  type HostStatus, applyToPlayers, classify, emptyStatus, explainFailure,
  reachability, shareAddresses, uptime, validatePort,
} from './hostlogic.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const powerBtn = $<HTMLButtonElement>('power');
const statePill = $<HTMLSpanElement>('state-pill');
const portEl = $<HTMLInputElement>('port');
const seedEl = $<HTMLInputElement>('seed');
const publicHostEl = $<HTMLInputElement>('public-host');
const bcNameEl = $<HTMLInputElement>('bc-name');
const settingsErr = $<HTMLParagraphElement>('settings-err');
const nameHelp = $<HTMLParagraphElement>('name-help');
const reachEl = $<HTMLSpanElement>('reach');
const primaryCode = $<HTMLElement>('primary-code');
const primaryWho = $<HTMLParagraphElement>('primary-who');
const copyPrimary = $<HTMLButtonElement>('copy-primary');
const otherAddresses = $<HTMLDetailsElement>('other-addresses');
const addressesEl = $<HTMLDivElement>('addresses');
const playerListEl = $<HTMLDivElement>('player-list');
const playerCountEl = $<HTMLElement>('player-count');
const logEl = $<HTMLDivElement>('log');
const commandEl = $<HTMLInputElement>('command');
const saveBtn = $<HTMLButtonElement>('save-now');
const reachHelp = $<HTMLElement>('reach-help');

let backend: Backend;
let handle: ServerHandle | null = null;
let admin: AdminApi | null = null;
let status: HostStatus = emptyStatus(8787);
let live: AdminState | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

/** Keep the log bounded: a server left up overnight would eat memory. */
const MAX_LOG_LINES = 600;

// --- log -------------------------------------------------------------------

function addLine(text: string, kindOverride?: 'you' | 'error'): void {
  const line = classify(text);
  if (!kindOverride) status.players = applyToPlayers(status.players, line);

  const el = document.createElement('div');
  el.className = `line ${kindOverride ?? line.kind}`;
  el.textContent = text;
  logEl.append(el);
  while (logEl.childElementCount > MAX_LOG_LINES) logEl.firstElementChild?.remove();

  // Only follow the tail if the reader is already at it -- yanking the view
  // back down while somebody is reading an error is its own small cruelty.
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}

// --- rendering -------------------------------------------------------------

function renderChrome(): void {
  statePill.textContent = {
    stopped: 'Stopped', starting: 'Starting', running: 'Running',
    stopping: 'Stopping', failed: 'Failed',
  }[status.state];
  statePill.dataset.state = status.state;

  const busy = status.state === 'starting' || status.state === 'stopping';
  const up = status.state === 'running';
  powerBtn.textContent = up ? 'Stop' : 'Start';
  powerBtn.className = `btn ${up ? 'btn-stop' : 'btn-go'}`;
  powerBtn.disabled = busy;

  // Port and seed are read when the server starts, so editing them while it
  // runs would show one thing and mean another.
  portEl.disabled = up || busy;
  seedEl.disabled = up || busy;

  commandEl.disabled = !up;
  saveBtn.disabled = !up;
  copyPrimary.disabled = !up;
}

function renderAddresses(): void {
  const reach = reachability(status);
  reachEl.textContent = status.state === 'running'
    ? (reach.reachable ? 'reachable' : 'local network only')
    : '';
  reachEl.dataset.reach = reach.reachable ? 'yes' : 'no';
  reachHelp.hidden = status.state !== 'running' || reach.reachable;

  if (status.state !== 'running') {
    primaryCode.textContent = 'not running';
    primaryWho.textContent = 'Press Start and an address will appear here.';
    addressesEl.replaceChildren();
    otherAddresses.hidden = true;
    return;
  }

  const all = shareAddresses(status);
  const [best, ...rest] = all;
  primaryCode.textContent = best.address;
  primaryWho.textContent = best.who;
  $<HTMLDivElement>('primary-address').dataset.tier = best.tier;

  otherAddresses.hidden = rest.length === 0;
  addressesEl.replaceChildren();
  for (const a of rest) {
    const row = document.createElement('div');
    row.className = 'addr';
    row.dataset.tier = a.tier;

    const code = document.createElement('code');
    code.textContent = a.address;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = a.who;
    const copy = document.createElement('button');
    copy.className = 'btn btn-small';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => { void copyText(a.address, copy); });

    row.append(code, who, copy);
    addressesEl.append(row);
  }
}

async function copyText(text: string, btn: HTMLButtonElement): Promise<void> {
  await backend.copy(text);
  const was = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = was; }, 1200);
}

function renderPlayers(): void {
  const players = live?.players ?? [];
  playerCountEl.textContent = String(players.length);

  if (players.length === 0) {
    playerListEl.replaceChildren(
      Object.assign(document.createElement('p'), {
        className: 'empty',
        textContent: status.state === 'running'
          ? 'Nobody is connected yet.'
          : 'Nobody is connected.',
      }));
    return;
  }

  playerListEl.replaceChildren(...players.map((p) => row(p)));
}

function row(p: AdminPlayer): HTMLElement {
  const el = document.createElement('div');
  el.className = 'player';

  const head = document.createElement('span');
  head.className = 'avatar';
  // A colour derived from the name, so the same person looks the same every
  // session without the server having to store anything about them.
  let h = 0;
  for (let i = 0; i < p.name.length; i++) h = (h * 31 + p.name.charCodeAt(i)) % 360;
  head.style.background = `hsl(${h} 42% 42%)`;
  head.textContent = p.name.slice(0, 1).toUpperCase();

  const who = document.createElement('div');
  who.className = 'who';
  const name = document.createElement('b');
  name.textContent = p.name;
  const where = document.createElement('span');
  where.textContent = `${dimensionName(p.dim)} · ${p.x}, ${p.y}, ${p.z}`;
  who.append(name, where);

  const kick = document.createElement('button');
  kick.className = 'btn btn-small btn-danger';
  kick.textContent = 'Kick';
  kick.addEventListener('click', () => { void doKick(p); });

  el.append(head, who, kick);
  return el;
}

function renderStats(): void {
  $<HTMLElement>('s-players').textContent = String(live?.players.length ?? 0);
  $<HTMLElement>('s-uptime').textContent = uptime(status.since);
  $<HTMLElement>('s-seed').textContent = live ? String(live.seed) : '—';
  $<HTMLElement>('s-edits').textContent = live ? live.edits.toLocaleString() : '—';
  $<HTMLElement>('s-memory').textContent = live ? `${live.memoryMb} MB` : '—';
}

function render(): void {
  renderChrome();
  renderAddresses();
  renderPlayers();
  renderStats();
}

// --- actions ---------------------------------------------------------------

async function doKick(p: AdminPlayer): Promise<void> {
  if (!admin) return;
  const ok = await admin.kick(p.id, 'Kicked by the server owner');
  addLine(ok ? `> kicked ${p.name}` : `> could not kick ${p.name}`, ok ? 'you' : 'error');
  void refresh();
}

async function runCommand(input: string): Promise<void> {
  const cmd = parseCommand(input);
  if (!cmd || !admin) return;
  addLine(`> ${input.trim()}`, 'you');

  switch (cmd.kind) {
    case 'say':
      if (!(await admin.say(cmd.text))) addLine('Could not send that.', 'error');
      return;
    case 'save':
      addLine(await admin.save() ? 'World saved.' : 'Could not save.',
        'you');
      return;
    case 'help':
      HELP_TEXT.forEach((l) => addLine(l, 'you'));
      return;
    case 'error':
      addLine(cmd.message, 'error');
      return;
    case 'kick': {
      const target = findPlayer(live?.players ?? [], cmd.who);
      if (!target) {
        // Say which of the two problems it is: nobody by that name, or too
        // many. "Player not found" for an ambiguous prefix is a lie.
        const matches = (live?.players ?? []).filter((p) =>
          p.name.toLowerCase().startsWith(cmd.who.toLowerCase()));
        addLine(matches.length > 1
          ? `More than one player matches "${cmd.who}": ${matches.map((m) => m.name).join(', ')}`
          : `Nobody here is called "${cmd.who}".`, 'error');
        return;
      }
      const ok = await admin.kick(target.id, cmd.reason);
      addLine(ok ? `Kicked ${target.name}.` : `Could not kick ${target.name}.`,
        ok ? 'you' : 'error');
      void refresh();
      return;
    }
  }
}

async function refresh(): Promise<void> {
  if (!admin || status.state !== 'running') return;
  live = await admin.state();
  render();
}

// --- lifecycle -------------------------------------------------------------

function applyOptionalFields(): void {
  status.publicHost = publicHostEl.value.trim() || null;
  const name = bcNameEl.value.trim().toLowerCase();
  status.bcName = name && isValidName(name) && !RESERVED.has(name) ? name : null;
}

async function start(): Promise<void> {
  const port = validatePort(portEl.value);
  if (!port.ok) {
    settingsErr.textContent = port.why;
    return;
  }
  settingsErr.textContent = '';

  const token = mintToken();
  status = { ...emptyStatus(port.port), state: 'starting' };
  applyOptionalFields();
  live = null;
  render();

  let sawOutput = '';
  handle = await backend.start({
    port: port.port,
    seed: seedEl.value.trim(),
    token,
    onLine: (text) => {
      sawOutput += text + '\n';
      // The server prints its listening line when it is genuinely up; before
      // that, "running" would be a guess.
      if (status.state === 'starting' && /listening|blockcraft on/i.test(text)) {
        status.state = 'running';
        status.since = Date.now();
        admin = backend.admin(port.port, token);
        void backend.lanAddress().then((lan) => { status.lanHost = lan; render(); });
        poll = setInterval(() => { void refresh(); }, 2000);
        void refresh();
      }
      addLine(text);
      render();
    },
    onExit: (code) => {
      const failed = status.state === 'starting' || (code !== 0 && code !== null);
      status.state = failed ? 'failed' : 'stopped';
      status.since = null;
      status.players = 0;
      handle = null;
      admin = null;
      live = null;
      if (poll) { clearInterval(poll); poll = null; }
      if (failed) settingsErr.textContent = explainFailure(sawOutput);
      render();
    },
  });
}

function stop(): void {
  status.state = 'stopping';
  render();
  void handle?.stop();
}

function checkName(): void {
  const raw = bcNameEl.value.trim().toLowerCase();
  if (!raw) {
    nameHelp.textContent = '';
  } else if (RESERVED.has(raw)) {
    nameHelp.textContent = `"${raw}" is reserved.`;
  } else if (!isValidName(raw)) {
    nameHelp.textContent = '3–24 characters of a–z, 0–9 and hyphens.';
  } else {
    // Claiming is a separate step. A name typed here and nowhere else
    // resolves for nobody, and the host would never find out.
    nameHelp.textContent =
      `${raw}.bc works once it is published — add it to registry.json on the ` +
      'Blockcraft repository.';
  }
  applyOptionalFields();
  render();
}

async function main(): Promise<void> {
  backend = await makeBackend();
  if (!backend.real) addLine('[app] preview mode — no real server behind this window');

  powerBtn.addEventListener('click', () => {
    if (status.state === 'running') stop();
    else void start();
  });
  saveBtn.addEventListener('click', () => { void runCommand('/save'); });
  copyPrimary.addEventListener('click', () => {
    void copyText(primaryCode.textContent ?? '', copyPrimary);
  });
  commandEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const text = commandEl.value;
    commandEl.value = '';
    void runCommand(text);
  });
  publicHostEl.addEventListener('input', () => { applyOptionalFields(); render(); });
  bcNameEl.addEventListener('input', checkName);

  // Uptime is the only thing that moves on its own.
  setInterval(() => {
    if (status.state === 'running') renderStats();
  }, 1000);

  render();
}

void main();
