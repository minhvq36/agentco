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
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { agentcoCmd } from '../dist/cli/launcher-text.js';
import { findNpmCli, globalPrefixFor, updateScript } from '../dist/cli/update-run.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli', 'index.js');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  version: string;
  name: string;
};

test('🔴 the packaged entry points ask `current` instead of naming a version', () => {
  /*
   * ⚠ THE GENERATOR, NOT THE WHOLE PACKAGING RUN. This test used to execute
   * `scripts/package.ts` and read the file it wrote — which copies ~90MB of
   * Node runtime, runs an `npm install`, and needs `web/dist`. `npm test` does
   * not build `web/dist`, and on CI `npm test` runs BEFORE `build:all`, so it
   * passed on a developer machine and failed at the only moment the suite runs
   * there: cutting a release. A rule about a string is checked against the
   * string. → src/cli/launcher-text.ts
   */
  const cmd = agentcoCmd('22.12.0', PKG.version);

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

test('🔴 the update helper is never handed THIS process’s stdio', () => {
  /*
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ `stdio: 'inherit'` gave the DETACHED helper our own stdout and stderr,  │
   * │ and it kept those handles open after we exited. Node fires `'close'`    │
   * │ only once a process has ended AND its streams have closed, so anything  │
   * │ WAITING on `agentco update` hung until its own timeout. A terminal      │
   * │ never notices — it is not waiting for EOF — and the smoke test found it │
   * │ on CI the first time it ran.                                            │
   * │                                                                         │
   * │ ⚠ THIS IS A SHAPE TEST, AND THE HONEST REASON IS THAT THE BEHAVIOURAL   │
   * │ ONE CANNOT BE HAD CHEAPLY. To tell the two apart the helper has to      │
   * │ OUTLIVE the command, which means a real `npm install` — and one that    │
   * │ did not name an isolated prefix would overwrite the machine's own       │
   * │ global copy. A first attempt at the behavioural test passed against the │
   * │ broken code, because it aimed at an unpublished version, so npm failed  │
   * │ instantly and the helper died before the inherited pipe could matter.   │
   * │                                                                         │
   * │ The behaviour is proved where a prefix already exists: `smoke-npm.ts`   │
   * │ runs `agentco update --to <this version>` on all three systems and      │
   * │ waits for the command to CLOSE. This gate only stops the shape coming   │
   * │ back between those runs.                                                │
   * └────────────────────────────────────────────────────────────────────────┘
   */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'cli', 'index.ts'), 'utf8');
  const call = /const child = spawn\(\s*process\.execPath,\s*\[\s*script,[\s\S]*?\n  \);/.exec(src);
  assert.ok(call, 'could not find the hand-off spawn in cli/index.ts');
  assert.doesNotMatch(call[0], /stdio: 'inherit'/, `the helper inherits our stdio:\n${call[0]}`);
  assert.match(call[0], /stdio: \['ignore', log, log\]/, call[0]);
  assert.match(call[0], /detached: true/, call[0]);
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

  /*
   * 🔴 NOTHING THIS HELPER STARTS MAY FLASH A CONSOLE. Found 17/09 by watching
   * an update: the helper is hidden, but a child of a process with no console
   * is exactly what Windows answers by opening a new one. The same flash cost a
   * `.vbs`, then `cmd /c start`, and now this. → SPEC-ui
   */
  const spawns = script.match(/spawn\(/g) ?? [];
  const hidden = script.match(/windowsHide: true/g) ?? [];
  assert.equal(hidden.length, spawns.length, `${spawns.length} spawns, ${hidden.length} hidden:\n${script}`);
});

test('🔴 the update targets the prefix THIS copy lives in, not npm’s default', () => {
  /*
   * Windows: <prefix>/node_modules/<scope>/<name>
   *
   * ⚠ The expectation goes through `path.resolve` too — the same rule the
   * POSIX half below already stated and this half did not follow. `C:/np` is a
   * root on Windows and a RELATIVE folder on Linux, where `globalPrefixFor`'s
   * own `path.resolve` prepends the cwd; comparing against the bare string
   * then fails for a reason that has nothing to do with stripping
   * `node_modules/<scope>/<name>`, which is the rule under test.
   * → [[agentco-absent-means-what-per-field]] (18/09/2026)
   */
  assert.equal(
    globalPrefixFor(path.join('C:', 'np', 'node_modules', '@agent-co-app', 'cli')),
    path.resolve('C:', 'np'),
  );
  /*
   * POSIX: <prefix>/lib/node_modules/<scope>/<name> — one level deeper, and the
   * difference is spotted by the NAME `lib`, never by `process.platform`.
   *
   * ⚠ Both sides go through `path.resolve`, because the function does: a
   * rooted-but-driveless path picks up the current drive on Windows, and an
   * expectation written without it fails for a reason that has nothing to do
   * with the rule under test.
   */
  const posix = path.join(path.sep, 'usr', 'local', 'lib', 'node_modules', '@a', 'cli');
  assert.equal(globalPrefixFor(posix), path.resolve(path.sep, 'usr', 'local'));
  // Unscoped is one directory shallower; counting segments would break here.
  assert.equal(
    globalPrefixFor(path.join('C:', 'np', 'node_modules', 'cli')),
    path.resolve('C:', 'np'),
  );
  // A source checkout has no prefix to speak of, and must not invent one.
  assert.equal(globalPrefixFor(path.join('C:', 'code', 'agentco')), undefined);

  // The script only passes --prefix when there is one to pass.
  assert.match(updateScript(), /if \(prefix\) args\.push\('--prefix', prefix\)/, updateScript());
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
