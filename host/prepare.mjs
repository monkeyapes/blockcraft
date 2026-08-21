/**
 * Assembles the two things the host app ships that are not its own code: a
 * bundled copy of the server, and a Node runtime to run it with.
 *
 * The runtime is copied from whatever Node is building the project rather
 * than downloaded or committed. Committing an 80 MB binary would bloat every
 * clone of the repository for the one person who is building an installer,
 * and downloading one at build time makes the build depend on a network and
 * on somebody else's hosting staying up.
 */

import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const binDir = join(here, 'src-tauri', 'bin');
mkdirSync(binDir, { recursive: true });

const ext = process.platform === 'win32' ? '.exe' : '';

// --- the server, as one file ---------------------------------------------
//
// Through esbuild's API rather than its command line. The banner below
// contains spaces and quotes, and passing it through a Windows shell splits
// it into fragments that esbuild then reads as several input files.
console.log('bundling the server...');
await build({
  entryPoints: [join(root, 'server', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: join(binDir, 'server.mjs'),
  banner: {
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
  logLevel: 'warning',
});
console.log(`  server.mjs  ${mb(join(binDir, 'server.mjs'))} MB`);

// --- the runtime ----------------------------------------------------------
const nodeTarget = join(binDir, `node${ext}`);
if (existsSync(nodeTarget)) {
  console.log(`  node${ext}    ${mb(nodeTarget)} MB (already staged)`);
} else {
  copyFileSync(process.execPath, nodeTarget);
  console.log(`  node${ext}    ${mb(nodeTarget)} MB (copied from ${process.execPath})`);
}

function mb(p) {
  return (statSync(p).size / 1024 / 1024).toFixed(1);
}

console.log('\nstaged. `npm run host:package` will build the installer.');
