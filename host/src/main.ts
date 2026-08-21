/**
 * The hosting window.
 *
 * Wiring only: the decisions live in hostlogic.ts, where they can be tested
 * without a window or a child process.
 */

import { isValidName, RESERVED } from '@shared/address.js';
import { makeBackend, type Backend, type ServerHandle } from './backend.js';
import {
  type HostStatus, applyToPlayers, classify, emptyStatus, explainFailure,
  reachability, shareAddresses, uptime, validatePort,
} from './hostlogic.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const portEl = $<HTMLInputElement>('port');
const seedEl = $<HTMLInputElement>('seed');
const settingsErr = $<HTMLParagraphElement>('settings-err');
const startBtn = $<HTMLButtonElement>('start');
const stopBtn = $<HTMLButtonElement>('stop');
const statePill = $<HTMLSpanElement>('state-pill');
const playersEl = $<HTMLElement>('players');
const uptimeEl = $<HTMLElement>('uptime');
const adviceEl = $<HTMLParagraphElement>('advice');
const addressesEl = $<HTMLDivElement>('addresses');
const reachHelp = $<HTMLElement>('reach-help');
const publicHostEl = $<HTMLInputElement>('public-host');
const bcNameEl = $<HTMLInputElement>('bc-name');
const nameErr = $<HTMLParagraphElement>('name-err');
const nameHelp = $<HTMLParagraphElement>('name-help');
const logEl = $<HTMLDivElement>('log');

let backend: Backend;
let handle: ServerHandle | null = null;
let status: HostStatus = emptyStatus(8787);

/** Keep the log bounded: a server left up overnight would otherwise eat memory. */
const MAX_LOG_LINES = 500;

function render(): void {
  statePill.textContent = {
    stopped: 'Stopped', starting: 'Starting…', running: 'Running',
    stopping: 'Stopping…', failed: 'Failed',
  }[status.state];
  statePill.dataset.state = status.state;

  const busy = status.state === 'starting' || status.state === 'stopping';
  startBtn.disabled = busy || status.state === 'running';
  stopBtn.disabled = busy || status.state !== 'running';
  portEl.disabled = status.state !== 'stopped' && status.state !== 'failed';
  seedEl.disabled = portEl.disabled;

  playersEl.textContent = String(status.players);
  uptimeEl.textContent = uptime(status.since);

  const reach = reachability(status);
  adviceEl.textContent = reach.advice;
  adviceEl.dataset.reach = reach.reachable ? 'yes' : 'no';
  // Only offer the how-to once there is something to fix.
  reachHelp.hidden = status.state !== 'running' || reach.reachable;

  addressesEl.replaceChildren();
  if (status.state === 'running') {
    for (const a of shareAddresses(status)) {
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
      copy.addEventListener('click', async () => {
        await backend.copy(a.address);
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
      });

      row.append(code, who, copy);
      addressesEl.append(row);
    }
  }
}

function addLine(text: string): void {
  const line = classify(text);
  status.players = applyToPlayers(status.players, line);

  const el = document.createElement('div');
  el.className = `line ${line.kind}`;
  el.textContent = text;
  logEl.append(el);
  while (logEl.childElementCount > MAX_LOG_LINES) logEl.firstElementChild?.remove();

  // Only follow the tail if the reader is already at it -- yanking the view
  // back down while someone is reading an error is its own small cruelty.
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;

  render();
}

async function start(): Promise<void> {
  const port = validatePort(portEl.value);
  if (!port.ok) {
    settingsErr.textContent = port.why;
    return;
  }
  settingsErr.textContent = '';

  status = { ...emptyStatus(port.port), state: 'starting' };
  applyOptionalFields();
  render();

  let sawOutput = '';
  handle = await backend.start({
    port: port.port,
    seed: seedEl.value.trim(),
    onLine: (text) => {
      sawOutput += text + '\n';
      // The server prints its listening line once it is actually up; until
      // then "running" would be a guess.
      if (status.state === 'starting' && /listening|blockcraft on/i.test(text)) {
        status.state = 'running';
        status.since = Date.now();
        void refreshLan();
      }
      addLine(text);
    },
    onExit: (code) => {
      const failed = status.state === 'starting' || (code !== 0 && code !== null);
      status.state = failed ? 'failed' : 'stopped';
      status.since = null;
      status.players = 0;
      handle = null;
      if (failed) {
        settingsErr.textContent = explainFailure(sawOutput);
      }
      render();
    },
  });
}

async function refreshLan(): Promise<void> {
  status.lanHost = await backend.lanAddress();
  render();
}

/** Public address and name are typed by the host, not discovered. */
function applyOptionalFields(): void {
  const pub = publicHostEl.value.trim();
  status.publicHost = pub || null;
  const name = bcNameEl.value.trim().toLowerCase();
  status.bcName = name && isValidName(name) && !RESERVED.has(name) ? name : null;
}

function checkName(): void {
  const raw = bcNameEl.value.trim().toLowerCase();
  if (!raw) {
    nameErr.textContent = '';
    nameHelp.textContent = 'Optional. Without one, share the address above.';
    return;
  }
  if (RESERVED.has(raw)) {
    nameErr.textContent = `"${raw}" is reserved.`;
    nameHelp.textContent = '';
    return;
  }
  if (!isValidName(raw)) {
    nameErr.textContent = '3–24 characters of a–z, 0–9 and hyphens.';
    nameHelp.textContent = '';
    return;
  }
  nameErr.textContent = '';
  // Say plainly that claiming is a separate step. A name typed here and
  // nowhere else resolves for nobody, and the host would never know.
  nameHelp.textContent =
    `${raw}.bc will work once it is published. Add it to registry.json on the ` +
    'Blockcraft repository — until then, share the address above.';
  applyOptionalFields();
  render();
}

async function main(): Promise<void> {
  backend = await makeBackend();
  if (!backend.real) {
    addLine('[app] preview mode — this page is not running a real server');
  }

  startBtn.addEventListener('click', () => { void start(); });
  stopBtn.addEventListener('click', () => {
    status.state = 'stopping';
    render();
    void handle?.stop();
  });
  publicHostEl.addEventListener('input', () => { applyOptionalFields(); render(); });
  bcNameEl.addEventListener('input', checkName);

  // Uptime is the only thing that changes on its own.
  setInterval(() => {
    if (status.state === 'running') uptimeEl.textContent = uptime(status.since);
  }, 1000);

  checkName();
  render();
}

void main();
