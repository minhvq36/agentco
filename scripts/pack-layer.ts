/**
 * Build the `app` layer a running copy can fetch and apply.
 * → docs/SPEC-packaging.md §3.5, §3.7.3
 *
 *   node --experimental-strip-types scripts/pack-layer.ts --tree <out/AgentCo> [--out <dir>]
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 A RELEASE PUBLISHED ONE ASSET — THE INSTALLER — SO THERE WAS NOTHING   │
 * │ FOR AN UPDATER TO FETCH. Found 17/09/2026 while writing §3.7: the whole   │
 * │ update design existed on paper above a missing file.                     │
 * │                                                                          │
 * │ ⚠ It packs the APP layer only. `runtime/` moves about twice a year and    │
 * │ `company/` is the customer's, so a weekly release ships the ~78 MB that   │
 * │ changed rather than the ~170 MB that did not. That split is §2's whole    │
 * │ reason for existing and this is the first thing to cash it in.            │
 * │                                                                          │
 * │ ⚠ THE FILENAME CARRIES THE VERSION, unlike the installer's. The installer │
 * │ is reached through `releases/latest/download/<fixed name>`, which must be │
 * │ constant; this one is reached through a URL written INTO the manifest, so │
 * │ it can be exact — and exact is better, because two releases' layers must  │
 * │ never be able to collide in a cache.                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createTarGz, findTar } from '../src/core/archive.ts';

const argv = process.argv.slice(2);
function argOf(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

const TREE = path.resolve(argOf('--tree') ?? path.join('out', 'AgentCo'));
const OUT = path.resolve(argOf('--out') ?? 'out');

const tar = findTar();
if (!tar.found) {
  console.error(`\n✗ no tar on this system — looked at: ${tar.tried.join(', ')}\n`);
  process.exit(1);
}

const appRoot = path.join(TREE, 'app');
if (!fs.existsSync(appRoot)) {
  console.error(`\n✗ no app layer at ${appRoot} — run scripts/package.ts first\n`);
  process.exit(1);
}

// One version directory, always. More than one means a stale build tree, and
// packing the wrong one would ship a layer that says it is something it is not.
const versions = fs.readdirSync(appRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
if (versions.length !== 1) {
  console.error(`\n✗ expected exactly one version under ${appRoot}, found ${versions.length}\n`);
  process.exit(1);
}
const version = versions[0]!.name;

const archive = path.join(OUT, `agentco-app-${version}.tar.gz`);
await createTarGz(path.join(appRoot, version), archive);

const bytes = fs.readFileSync(archive);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

console.log(`\n  layer    app ${version}`);
console.log(`  file     ${archive}`);
console.log(`  size     ${bytes.length} bytes`);
console.log(`  sha256   ${sha256}\n`);

/*
 * ⚠ Written down beside the archive rather than only printed. `release-web.ts`
 * signs the manifest on the maintainer's machine, hours later and in another
 * repository; a number that only ever existed in a CI log would have to be
 * copied by hand, and a hash copied by hand is a hash that is eventually wrong.
 */
fs.writeFileSync(
  `${archive}.json`,
  `${JSON.stringify({ layer: 'app', version, size: bytes.length, sha256 }, null, 2)}\n`,
  'utf8',
);
