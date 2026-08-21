/**
 * Server addresses: parsing `donutsmp.bc` and resolving it.
 * Run: npx tsx tests/address.ts
 *
 * Every failure here is quiet. A name that only nearly matches resolves to
 * nothing, and what the player sees is a server that will not connect -- so
 * they blame the server, or the host, and never think to look at what they
 * typed. That makes the difference between "no such name", "cannot reach the
 * registry" and "that address is malformed" worth getting exactly right:
 * three problems with three different fixes, and only the message tells them
 * apart.
 */

import { readFileSync } from 'node:fs';

import {
  BC_SUFFIX, DEFAULT_PORT, NAME_MAX, NAME_MIN, REGISTRY_VERSION, RESERVED,
  type Registry, displayAddress, isValidName, parseAddress, parseRegistry,
  resolveAddress, socketUrl,
} from '../shared/src/address.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- names it should accept ----------------------------------------------

{
  const a = parseAddress('donutsmp.bc');
  check('a plain name parses', a.kind === 'name' && a.name === 'donutsmp',
    JSON.stringify(a));
}
check('capitals are folded, since nobody types a name the same way twice',
  (() => { const a = parseAddress('DonutSMP.BC'); return a.kind === 'name' && a.name === 'donutsmp'; })());
check('surrounding space is ignored',
  (() => { const a = parseAddress('  donutsmp.bc  '); return a.kind === 'name' && a.name === 'donutsmp'; })());
check('a pasted URL still finds the name',
  (() => { const a = parseAddress('https://donutsmp.bc/'); return a.kind === 'name' && a.name === 'donutsmp'; })());
check('digits and hyphens are allowed',
  (() => { const a = parseAddress('my-server-2.bc'); return a.kind === 'name' && a.name === 'my-server-2'; })());

// --- names it must refuse -------------------------------------------------
//
// Each of these would otherwise become an unresolvable name, and an
// unresolvable name looks exactly like an offline server.

const rejects: Array<[string, string]> = [
  ['', 'nothing at all'],
  ['.bc', 'a suffix with no name'],
  ['ab.bc', 'shorter than the minimum'],
  ['a'.repeat(NAME_MAX + 1) + '.bc', 'longer than the maximum'],
  ['-donut.bc', 'a leading hyphen'],
  ['donut-.bc', 'a trailing hyphen'],
  ['donut--smp.bc', 'a double hyphen'],
  ['donut smp.bc', 'a space inside the name'],
  ['donut_smp.bc', 'an underscore'],
  ['donut.smp.bc', 'a dot inside the name'],
  ['dönut.bc', 'a non-ascii letter'],
];
for (const [input, why] of rejects) {
  const a = parseAddress(input);
  check(`refuses ${why}`, a.kind === 'invalid',
    a.kind !== 'invalid' ? `got ${JSON.stringify(a)}` : '');
}

check('every rejection explains itself',
  rejects.every(([input]) => {
    const a = parseAddress(input);
    return a.kind === 'invalid' && a.reason.length > 8 && a.reason.endsWith('.') === false
      ? true
      : a.kind === 'invalid' && a.reason.length > 8;
  }));

// Reserved names are refused with their own message, not the generic one.
for (const name of ['localhost', 'official', 'admin']) {
  const a = parseAddress(`${name}.bc`);
  check(`"${name}" is reserved`,
    a.kind === 'invalid' && a.reason.includes(name),
    a.kind === 'invalid' ? a.reason : JSON.stringify(a));
}
check('the reserved list covers the names a newcomer would assume are official',
  RESERVED.has('official') && RESERVED.has('blockcraft') && RESERVED.has('localhost'));

// --- direct addresses still work -----------------------------------------
//
// The naming layer sits on top of addressing. If it ever became a dependency,
// a registry outage would take every server offline at once.

{
  const a = parseAddress('82.14.203.11:8787');
  check('an ip and port parse', a.kind === 'direct' && a.host === '82.14.203.11' && a.port === 8787,
    JSON.stringify(a));
}
{
  const a = parseAddress('play.example.com');
  check('a bare hostname gets the default port',
    a.kind === 'direct' && a.host === 'play.example.com' && a.port === DEFAULT_PORT,
    JSON.stringify(a));
}
{
  const a = parseAddress('localhost:3000');
  check('localhost works as a direct address even though it is a reserved name',
    a.kind === 'direct' && a.host === 'localhost' && a.port === 3000, JSON.stringify(a));
}
check('a port above the range is refused', parseAddress('host:70000').kind === 'invalid');
check('a port of zero is refused', parseAddress('host:0').kind === 'invalid');

// --- resolution -----------------------------------------------------------

const registry: Registry = {
  donutsmp: { host: '82.14.203.11', port: 8787, title: 'Donut SMP' },
  minimal: { host: 'example.com' },
  broken: { host: '' },
};

{
  const r = resolveAddress(parseAddress('donutsmp.bc'), registry);
  check('a registered name resolves to its address',
    r.ok && r.host === '82.14.203.11' && r.port === 8787, JSON.stringify(r));
  check('and carries the title through for the server list',
    r.ok && r.title === 'Donut SMP');
}
{
  const r = resolveAddress(parseAddress('minimal.bc'), registry);
  check('an entry with no port gets the default',
    r.ok && r.port === DEFAULT_PORT, JSON.stringify(r));
}
{
  const r = resolveAddress(parseAddress('nosuch.bc'), registry);
  check('an unregistered name says so, rather than failing silently',
    !r.ok && r.reason.includes('nosuch'), JSON.stringify(r));
}
{
  const r = resolveAddress(parseAddress('broken.bc'), registry);
  check('a registered name with no address is its own error',
    !r.ok && r.reason.includes('broken'), JSON.stringify(r));
}

// The three failures a player can hit must not share a message: they have
// three different fixes.
{
  const unreachable = resolveAddress(parseAddress('donutsmp.bc'), null);
  const unknown = resolveAddress(parseAddress('nosuch.bc'), registry);
  const malformed = resolveAddress(parseAddress('donut smp.bc'), registry);
  check('an unreachable registry is distinguishable from an unknown name',
    !unreachable.ok && !unknown.ok && unreachable.reason !== unknown.reason,
    `"${!unreachable.ok ? unreachable.reason : ''}" vs "${!unknown.ok ? unknown.reason : ''}"`);
  check('and both are distinguishable from a malformed address',
    !malformed.ok && malformed.reason !== unknown.reason &&
    malformed.reason !== (unreachable as { reason: string }).reason);
  check('an unreachable registry points at the way round it',
    !unreachable.ok && /host|port|address/i.test(unreachable.reason),
    !unreachable.ok ? unreachable.reason : '');
}

// A direct address resolves with no registry at all, which is the property
// that keeps a registry outage from taking every server down.
{
  const r = resolveAddress(parseAddress('82.14.203.11:8787'), null);
  check('a direct address resolves with no registry present',
    r.ok && r.host === '82.14.203.11', JSON.stringify(r));
}

// --- the bits that get shown or dialled ----------------------------------

check('the socket url is well formed',
  socketUrl('example.com', 8787) === 'ws://example.com:8787/ws');
check('and can be secure',
  socketUrl('example.com', 443, true) === 'wss://example.com:443/ws');

check('a name reads back as the player typed it',
  displayAddress(parseAddress('donutsmp.bc')) === `donutsmp${BC_SUFFIX}`);
check('a default port is not shown back, because nobody typed it',
  displayAddress(parseAddress('example.com')) === 'example.com');
check('a non-default port is shown back',
  displayAddress(parseAddress('example.com:9999')) === 'example.com:9999');

// --- the validator on its own --------------------------------------------

check('isValidName agrees with the parser about length',
  !isValidName('ab') && isValidName('abc') && isValidName('a'.repeat(NAME_MAX)) &&
  !isValidName('a'.repeat(NAME_MAX + 1)));
check('NAME_MIN is short enough to be usable and long enough to be a name',
  NAME_MIN >= 3 && NAME_MIN < NAME_MAX);

// --- the published file --------------------------------------------------
//
// This is fetched over the network from a file anyone can send a change to,
// so it is exactly the input that should not be trusted.

check('a well-formed file parses',
  (() => {
    const r = parseRegistry({ version: 1, servers: { donutsmp: { host: 'a.example', port: 25 } } });
    return !!r && r.donutsmp.host === 'a.example' && r.donutsmp.port === 25;
  })());

check('an entry with no port gets the default on the way in',
  (() => {
    const r = parseRegistry({ version: 1, servers: { alpha: { host: 'h' } } });
    return !!r && r.alpha.port === DEFAULT_PORT;
  })());

// A file the client cannot trust must read as "no registry", which the caller
// already treats as "use a host:port instead" -- not as "no servers exist".
for (const [bad, why] of [
  [null, 'null'],
  ['nope', 'a string'],
  [{}, 'no version'],
  [{ version: 999, servers: {} }, 'a version from the future'],
  [{ version: 1 }, 'no servers key'],
  [{ version: 1, servers: 'nope' }, 'a servers key that is not an object'],
] as Array<[unknown, string]>) {
  check(`refuses ${why}`, parseRegistry(bad) === null);
}

// One bad line must not take everybody else's server down with it.
{
  const r = parseRegistry({
    version: 1,
    servers: {
      goodone: { host: 'ok.example' },
      '-bad-name-': { host: 'ok.example' },
      localhost: { host: 'ok.example' },
      nohost: {},
      badport: { host: 'ok.example', port: 99999 },
      notobject: 'nope',
    },
  });
  check('a malformed entry is dropped, not fatal', !!r && !!r.goodone, JSON.stringify(r));
  check('and only the malformed ones are dropped',
    !!r && Object.keys(r).length === 1, r ? Object.keys(r).join(',') : 'null');
  check('including names that would shadow a reserved one',
    !!r && !('localhost' in r));
}

check('an over-long title is trimmed rather than accepted whole',
  (() => {
    const r = parseRegistry({
      version: 1,
      servers: { alpha: { host: 'h', title: 'x'.repeat(500) } },
    });
    return !!r && (r.alpha.title?.length ?? 0) <= 48;
  })());

// The file that actually ships has to be one the client can read.
{
  const onDisk = JSON.parse(
    readFileSync(new URL('../site/registry.json', import.meta.url), 'utf8'));
  check('the published registry.json parses with the shipped parser',
    parseRegistry(onDisk) !== null, JSON.stringify(onDisk));
  check('and declares the version the client expects',
    onDisk.version === REGISTRY_VERSION);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
