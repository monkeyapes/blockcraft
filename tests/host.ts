/**
 * The hosting app's decisions.
 * Run: npx tsx tests/host.ts
 *
 * The failure this is really guarding against is the one every naive hosting
 * tool ships with: showing a LAN address as though it reached the internet.
 * The server runs, the app says "running", the address is copied into a chat
 * message, and the friend two towns away cannot connect. Nothing errors, so
 * nobody knows where to look.
 */

import {
  type HostStatus, applyToPlayers, classify, emptyStatus, explainFailure,
  reachability, shareAddresses, uptime, validatePort,
} from '../host/src/hostlogic.js';
import {
  dimensionName, findPlayer, mintToken, parseCommand,
} from '../host/src/adminclient.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

const running = (over: Partial<HostStatus> = {}): HostStatus => ({
  ...emptyStatus(8787), state: 'running', since: Date.now() - 65_000, ...over,
});

// --- which address to share ----------------------------------------------

{
  const s = running({ lanHost: '192.168.1.40' });
  const addrs = shareAddresses(s);
  check('a LAN-only host is not offered an internet address',
    !addrs.some((a) => a.tier === 'internet'));
  check('and the LAN address says who it actually works for',
    addrs.some((a) => a.tier === 'lan' && /network only|not friends/i.test(a.who)),
    JSON.stringify(addrs.find((a) => a.tier === 'lan')));
  check('localhost is always offered last, for testing',
    addrs[addrs.length - 1].tier === 'local');
}

{
  const s = running({ lanHost: '192.168.1.40', publicHost: '82.14.203.11' });
  const addrs = shareAddresses(s);
  check('a publicly reachable host is offered its public address first',
    addrs[0].tier === 'internet', JSON.stringify(addrs.map((a) => a.tier)));
}

{
  const s = running({ lanHost: '192.168.1.40', publicHost: 'abc.tunnel.example', bcName: 'donutsmp' });
  const addrs = shareAddresses(s);
  check('a named host leads with the name, which is the whole point',
    addrs[0].tier === 'name' && addrs[0].address === 'donutsmp.bc',
    JSON.stringify(addrs[0]));
}

// A tunnel often hands back a host that already carries a port.
{
  const s = running({ publicHost: 'abc.tunnel.example:31245' });
  const a = shareAddresses(s).find((x) => x.tier === 'internet')!;
  check('a tunnel address that already has a port does not get a second one',
    a.address === 'abc.tunnel.example:31245', a.address);
}

// --- is it actually reachable --------------------------------------------

check('a stopped server offers no address advice beyond starting it',
  !reachability(emptyStatus(8787)).reachable);

{
  const r = reachability(running({ lanHost: '192.168.1.40' }));
  check('running on a LAN only is reported as NOT reachable', !r.reachable);
  check('and the advice names both ways out, rather than just saying it failed',
    /forward/i.test(r.advice) && /tunnel/i.test(r.advice), r.advice);
  check('and says why, so it does not read as a bug',
    /router|behind/i.test(r.advice), r.advice);
}

{
  const r = reachability(running({ publicHost: '82.14.203.11' }));
  check('a public host is reachable', r.reachable);
  check('and is nudged toward a name', /\.bc|name/i.test(r.advice), r.advice);
}

{
  const r = reachability(running({ publicHost: '82.14.203.11', bcName: 'donutsmp' }));
  check('a named public host is told to share just the name',
    r.reachable && r.advice.includes('donutsmp.bc'), r.advice);
}

// --- reading the log ------------------------------------------------------

check('a join is recognised', classify('Player Ada joined').kind === 'join');
check('a leave is recognised', classify('Player Ada disconnected').kind === 'leave');
check('an error is recognised', classify('Error: EADDRINUSE').kind === 'error');
check('anything else is kept as info rather than dropped',
  classify('[server] Blockcraft on http://localhost:8787').kind === 'info');

{
  let n = 0;
  n = applyToPlayers(n, classify('Ada joined'));
  n = applyToPlayers(n, classify('Bob joined'));
  check('players are counted up', n === 2, String(n));
  n = applyToPlayers(n, classify('Ada left'));
  check('and down', n === 1, String(n));
  n = applyToPlayers(n, classify('Bob left'));
  n = applyToPlayers(n, classify('nobody left to leave'));
  check('and never below zero, whatever the log says', n >= 0, String(n));
}

// --- failures a host can act on ------------------------------------------

check('a busy port is explained, not dumped as a stack trace',
  /already in use/i.test(explainFailure('Error: listen EADDRINUSE: address already in use')));
check('and suggests what to do about it',
  /different port|close/i.test(explainFailure('EADDRINUSE')));
check('a privileged port is explained',
  /admin/i.test(explainFailure('Error: listen EACCES: permission denied')));
check('an unknown failure still points at the log rather than saying nothing',
  /log/i.test(explainFailure('something nobody predicted')));

// --- port validation ------------------------------------------------------

check('a sensible port is accepted', validatePort('8787'));
check('a privileged port is refused with the reason',
  (() => { const r = validatePort(80); return !r.ok && /admin/i.test(r.why); })());
check('a port above the range is refused', !validatePort(70000).ok);
check('a non-number is refused', !validatePort('abc').ok);
check('a fractional port is refused', !validatePort('80.5').ok);

// --- uptime ---------------------------------------------------------------

check('uptime with no start time is a dash', uptime(null) === '—');
check('seconds read as seconds', uptime(Date.now() - 12_000) === '12s');
check('minutes read as minutes', uptime(Date.now() - 125_000).startsWith('2m'));
check('hours read as hours', uptime(Date.now() - 7_400_000).startsWith('2h'));

// --- the console -----------------------------------------------------------
//
// Guessing wrong about whether something is a command or a message is
// annoying in both directions: a message read as a command does nothing, and
// a command broadcast as chat tells everyone what you were trying to do.

check('plain text is a message', (() => {
  const c = parseCommand('back in five');
  return c?.kind === 'say' && c.text === 'back in five';
})());
check('a slash makes it a command', parseCommand('/save')?.kind === 'save');
check('an empty line does nothing at all', parseCommand('   ') === null);

check('/say takes the rest of the line, spaces and all', (() => {
  const c = parseCommand('/say back  in five');
  return c?.kind === 'say' && c.text === 'back  in five';
})());
check('/say with nothing to say explains itself',
  parseCommand('/say')?.kind === 'error');

check('/kick takes a name', (() => {
  const c = parseCommand('/kick Ada');
  return c?.kind === 'kick' && c.who === 'Ada';
})());
check('and a reason after it', (() => {
  const c = parseCommand('/kick Ada being rude');
  return c?.kind === 'kick' && c.reason === 'being rude';
})());
check('with a default reason when none is given, so nobody is kicked silently',
  (() => {
    const c = parseCommand('/kick Ada');
    return c?.kind === 'kick' && c.reason.length > 0;
  })());
check('/kick with no name explains itself', parseCommand('/kick')?.kind === 'error');

check('commands are case-insensitive, because nobody holds shift for /SAY',
  parseCommand('/SAVE')?.kind === 'save');
check('an unknown command names itself and points at help', (() => {
  const c = parseCommand('/frobnicate');
  return c?.kind === 'error' && c.message.includes('frobnicate') && /help/i.test(c.message);
})());
check('/help and /? are the same thing',
  parseCommand('/help')?.kind === 'help' && parseCommand('/?')?.kind === 'help');

// --- finding who was meant --------------------------------------------------

const roster = [
  { id: 1, name: 'Ada', dim: 0, x: 0, y: 0, z: 0 },
  { id: 2, name: 'Adam', dim: 0, x: 0, y: 0, z: 0 },
  { id: 3, name: 'Bob', dim: 0, x: 0, y: 0, z: 0 },
];

check('an exact name wins even when it is a prefix of another',
  findPlayer(roster, 'Ada')?.id === 1, JSON.stringify(findPlayer(roster, 'Ada')));
check('case does not matter', findPlayer(roster, 'bob')?.id === 3);
check('a unique prefix is enough, so nobody types a whole name',
  findPlayer(roster, 'Bo')?.id === 3);
check('an ambiguous prefix matches nobody rather than guessing',
  findPlayer(roster, 'Ad') === null);
check('a name nobody has matches nobody', findPlayer(roster, 'Zed') === null);

check('dimensions read as names, not numbers',
  dimensionName(0) === 'Overworld' && dimensionName(1) === 'Nether');
check('and an unknown dimension still says something sensible',
  dimensionName(9).includes('9'));

// A token has to be unguessable and long enough for the server to accept it.
{
  const a = mintToken();
  const b = mintToken();
  check('a minted token is 32 hex characters', /^[0-9a-f]{32}$/.test(a), a);
  check('and two of them differ', a !== b);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
