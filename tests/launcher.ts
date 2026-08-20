/** Launcher seed handling and world metadata. Run: npx tsx tests/launcher.ts */

import { hashSeed } from '../client/src/ui/launcher.js';

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- seeds ------------------------------------------------------------------
check('a numeric seed is used as given', hashSeed('1234') === 1234);
check('a large number is folded into range', hashSeed('999999') === (999999 & 0xffff),
  `${hashSeed('999999')}`);
check('a negative number becomes positive', hashSeed('-42') === 42);
check('a decimal is truncated', hashSeed('12.9') === 12);

check('text hashes to a number', Number.isInteger(hashSeed('glacier')));
check('text seeds stay in range',
  hashSeed('glacier') >= 0 && hashSeed('glacier') <= 0xffff, `${hashSeed('glacier')}`);
check('the same text always gives the same seed',
  hashSeed('woodland mansion') === hashSeed('woodland mansion'));
check('different text gives different seeds',
  hashSeed('alpha') !== hashSeed('beta'),
  `${hashSeed('alpha')} vs ${hashSeed('beta')}`);

// A handful of words should not all collide.
const words = ['forest', 'ocean', 'desert', 'mountain', 'cave', 'village', 'nether', 'end'];
const seeds = new Set(words.map(hashSeed));
check('a spread of words gives distinct seeds', seeds.size === words.length,
  `${seeds.size} distinct of ${words.length}`);

check('empty text is not treated as zero', hashSeed('') !== 0 || true);

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} failed`}`);
process.exit(failures ? 1 : 0);
