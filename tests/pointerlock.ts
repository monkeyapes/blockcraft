/**
 * Pointer-lock recovery.
 * Run: npx tsx tests/pointerlock.ts
 *
 * Two bugs live here, and both stranded the player with a loose cursor:
 *
 *   1. Latching a "denied" flag on the first refusal. Browsers refuse
 *      capture for about a second after Escape releases it, so one click in
 *      that window disabled mouse look for the whole session.
 *   2. Retrying on a timer, then giving up when those retries failed.
 *      Capture is only ever granted during a user gesture, so a timer retry
 *      cannot succeed however long it waits -- it just burned through the
 *      attempt budget and reached the same dead end by a longer road.
 *
 * The rule these encode: a refusal describes this moment, never the session.
 * Nothing may ever stop a later click from trying again.
 */

import { FALLBACK_AFTER, afterFailure } from '../client/src/pointerlock.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- Nothing ever stops the player trying again --------------------------
{
  let alwaysTries = true;
  for (let n = 1; n <= 50; n++) {
    if (!afterFailure(n).keepTrying) alwaysTries = false;
  }
  check('a click may always ask again, however many refusals came before',
    alwaysTries, 'this is the whole fix; both bugs were a permanent verdict');

  check('one refusal does not turn on the fallback',
    !afterFailure(1).useFallback,
    'an Escape-cooldown refusal is normal and means nothing');
}

// --- A sustained run turns on fallback steering, and only that ------------
{
  for (let n = 1; n < FALLBACK_AFTER; n++) {
    check(`refusal ${n} still expects capture`, !afterFailure(n).useFallback);
  }
  const settled = afterFailure(FALLBACK_AFTER);
  check('a sustained run turns on click-to-steer', settled.useFallback);
  check('and still keeps asking for capture', settled.keepTrying,
    'the fallback is an addition, never a surrender');
}

// --- The regression, stated directly -------------------------------------
{
  // Both previous versions, for comparison.
  const latchOnFirst = (n: number) => ({ keepTrying: n < 1 });
  const giveUpAfterFour = (n: number) => ({ keepTrying: n < 4 });
  const now = afterFailure(9);

  check('unlike the first version, one refusal is not fatal',
    !latchOnFirst(1).keepTrying && now.keepTrying);
  check('unlike the second, a run of refusals is not fatal either',
    !giveUpAfterFour(9).keepTrying && now.keepTrying,
    'timer retries could never succeed, so the budget always ran out');
}

console.log(failures === 0 ? '\nAll pointer-lock checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
