/**
 * 🔴 `current` WAS A POINTER NOTHING READ, AND THE UPDATER IS THE THING THAT
 * NEEDS IT. (found 16/09/2026)
 *
 * `scripts/package.ts` wrote `current`, while both entry points had the version
 * compiled in: `agentco.cmd` as a literal, `AgentCo.exe` through `/DAPPVER`. So
 * writing a newer `app/<ver>/` and flipping the pointer changed nothing at all —
 * and `AgentCo.exe` is held open while the daemon runs, so it cannot be the
 * thing that gets replaced either. An updater is only possible once the choice
 * lives OUTSIDE what is being replaced. → SPEC-packaging §3.7
 *
 * ⚠ THE `.cmd` IS ASSERTED AS TEXT, on purpose. Running it needs Windows; the
 * rule it has to keep — "ask `current`, fall back to something that exists,
 * never fall silent" — is a shape, and a shape can be checked anywhere. The
 * `.exe` half was measured by hand against a fake tree (`current` beats the
 * compiled-in version, a trailing CRLF is trimmed, a missing target falls back);
 * it needs `makensis`, which is why it is not here.
 *
 * ⚠ Everything in this file is synchronous — no sockets, no awaits. The runner
 * cancels pending tests whenever the event loop drains. → `test/port.test.ts`
 */

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { findNpmCli, updateScript } from '../dist/cli/update-run.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  version: string;
  name: string;
};

/** Build the packaged tree into a temp dir and read back what it generated. */
function packagedCmd(): string {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-pack-'));
  execFileSync(
    process.execPath,
    ['--experimental-strip-types', path.join(ROOT, 'scripts', 'package.ts'), '--out', out],
    { cwd: ROOT, stdio: 'pipe', timeout: 600_000 },
  );
  return fs.readFileSync(path.join(out, 'agentco.cmd'), 'utf8');
}

test('🔴 the packaged entry points ask `current` instead of naming a version', () => {
  const cmd = packagedCmd();

  // It reads the pointer…
  assert.match(cmd, /set \/p APPDIR=<"%HERE%current"/, cmd);
  // …and the line that finally runs node uses what it read, not a literal.
  assert.match(cmd, /"%NODE%\\node\.exe" "%HERE%%APPDIR%\\dist\\cli\\index\.js" %\*/, cmd);
  assert.doesNotMatch(
    cmd,
    new RegExp(`node\\.exe" "%HERE%app\\\\${PKG.version.replace(/\./g, '\\.')}`),
    'the version is still written into the command line',
  );

  // A missing or stale pointer lands on the version this tree was built as…
  assert.match(cmd, new RegExp(`set "APPDIR=app\\\\${PKG.version.replace(/\./g, '\\.')}"`), cmd);
  // …and when there is nothing at all, it SPEAKS. Silence is the failure this
  // launcher was rewritten away from.
  assert.match(cmd, /echo AgentCo: no app found/, cmd);
  assert.match(cmd, /exit \/b 2/, cmd);
});

test('the update helper never calls npm by name, and restarts by path', () => {
  const script = updateScript();

  // `spawn('npm')` cannot start a `.cmd` without a shell (EINVAL on Windows),
  // and a shell means three sets of quoting rules for one command.
  assert.doesNotMatch(script, /spawn\(\s*'npm'/, script);
  assert.match(script, /npmCli/, script);

  // After the install, the SAME path holds the NEW code — nothing to look up on
  // a PATH this shell may not have refreshed.
  assert.match(script, /packageRoot \+ '\/dist\/cli\/index\.js'/, script);

  // npm failing must leave the old package in place and say so.
  assert.match(script, /Nothing was replaced/, script);

  // A missing binary reports through the 'error' event or it kills the process.
  assert.match(script, /child\.on\('error'/, script);
});

test('npm is found beside this Node, and the lookup is layout-driven', () => {
  // The real machine running the suite: whatever its layout, npm came with it.
  assert.ok(findNpmCli(), 'no npm-cli.js found beside this Node');

  // Both layouts are checked rather than chosen by platform, so a tree
  // assembled the other way round still resolves.
  const win = '/fake/node.exe';
  const posix = '/fake/bin/node';
  const seen: string[] = [];
  findNpmCli(win, (p) => (seen.push(p), false));
  findNpmCli(posix, (p) => (seen.push(p), false));
  assert.ok(
    seen.some((p) => p.includes(path.join('node_modules', 'npm'))),
    seen.join('\n'),
  );
  assert.ok(
    seen.some((p) => p.includes(path.join('lib', 'node_modules', 'npm'))),
    seen.join('\n'),
  );
});
