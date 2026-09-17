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
import { checkSpace, findNpmCli, globalPrefixFor, sweepOldUpdateDirs, updateScript } from '../dist/cli/update-run.js';

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

/*
 * ┌────────────────────────────────────────────────────────────────────────────
 * │ 🔴 A FULL DISK TOOK THE COMMAND AWAY. (measured on a real machine, 18/09/2026)
 * │
 * │   npm warn tar TAR_ENTRY_ERROR ENOSPC: no space left on device, write
 * │   D:\> agentco start
 * │   'agentco' is not recognized as an internal or external command
 * │
 * │ npm had removed the old tree and its shims, then ran out of room before
 * │ writing the new ones. The package sat there at the new version with no way
 * │ to start it, and nothing could offer a repair because the thing that would
 * │ offer it was what vanished.
 * │
 * │ `npm install -g` is not a transaction, so there is no "all". These gates
 * │ protect the other half: NOTHING, decided while everything still works.
 * └────────────────────────────────────────────────────────────────────────────
 */
const readSrc = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const INDEX = readSrc('src/cli/index.ts');

test('🔴 space is checked BEFORE the company is stopped, not after', () => {
  /*
   * The whole value is in the order. `cli/update-run.ts` opens with the rule —
   * "everything that can fail is resolved before the daemon is stopped" — and
   * the first version of this very patch broke it, putting the check inside
   * `handOffUpdate`, which runs after the shutdown. A refusal that arrives
   * after the company is down is not a refusal, it is an outage.
   */
  const body = INDEX.slice(INDEX.indexOf('async function cmdUpdate'));
  const refusal = body.indexOf('updateRefusal(');
  const stop = body.indexOf('liveDaemon(');
  assert.ok(refusal > 0, 'cmdUpdate no longer asks updateRefusal');
  assert.ok(stop > 0, 'cmdUpdate no longer looks for a running daemon');
  assert.ok(
    refusal < stop,
    'the refusal is decided AFTER the daemon is found and stopped — that is an outage, not a refusal',
  );
});

test('one set of rules, asked by both doors', () => {
  // The command and the button must refuse for the same reasons. Two copies
  // drift, and the one that drifts is the one nobody runs by hand.
  assert.ok(INDEX.includes('function updateRefusal('), 'updateRefusal is gone');
  const handoff = INDEX.slice(INDEX.indexOf('function handOffUpdate('));
  assert.match(handoff.slice(0, 400), /updateRefusal\(/, 'handOffUpdate stopped asking');
});

test('checkSpace: a threshold nothing can satisfy is refused, and the free figure is real', () => {
  const v = checkSpace(os.tmpdir(), Number.MAX_SAFE_INTEGER);
  assert.equal(v.ok, false);
  assert.equal(typeof v.free, 'number');
  assert.ok((v.free ?? -1) >= 0, 'free space came back negative');
  assert.equal(v.dir, os.tmpdir());
});

test('checkSpace: a threshold of zero always passes', () => {
  assert.equal(checkSpace(os.tmpdir(), 0).ok, true);
});

test('⭐ checkSpace: a path it cannot read does NOT block the update', () => {
  /*
   * `statfs` fails on a network share, an exotic filesystem, or a path that is
   * not there yet. A check that cannot read the disk must not become a check
   * that blocks everyone — absence of an answer is not an answer.
   */
  const v = checkSpace(path.join(os.tmpdir(), 'agentco-no-such-dir-' + Date.now()));
  assert.equal(v.ok, true);
  assert.equal(v.free, undefined);
});

test('the sentence carries BOTH numbers and the path, in both languages', () => {
  // "not enough space" sends somebody to look at a disk without telling them
  // how much they are looking for.
  for (const file of ['src/i18n/en.ts', 'src/i18n/vi.ts']) {
    const line = readSrc(file);
    assert.match(line, /'cli\.updateNoSpace'/, file);
    const msg = /'cli\.updateNoSpace':\s*\n?\s*'([^']*)'/.exec(line)?.[1] ?? '';
    for (const token of ['{need}', '{free}', '{dir}']) {
      assert.ok(msg.includes(token), `${file} drops ${token}`);
    }
  }
});

test('🔴 an update sweeps the directories earlier updates left behind', () => {
  /*
   * Counted on a real machine, 18/09/2026: 421 of them, oldest three days old.
   * The helper cannot remove its own — it RUNS from there and outlives the
   * process that made it — so the next run does it. The only process that can
   * safely delete one is a process not using it.
   */
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-sweepbox-'));
  try {
    const made: string[] = [];
    for (let i = 0; i < 8; i++) {
      const d = path.join(box, `agentco-update-${i}`);
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, 'update.log'), 'x');
      // Staggered so "newest" is a fact and not the order readdir happens to give.
      fs.utimesSync(d, new Date(1_000_000 + i * 60_000), new Date(1_000_000 + i * 60_000));
      made.push(d);
    }
    // Something that is not ours must survive untouched.
    const notOurs = path.join(box, 'something-else');
    fs.mkdirSync(notOurs);

    sweepOldUpdateDirs(box, 3);

    const left = fs.readdirSync(box).filter((n) => n.startsWith('agentco-update-'));
    assert.equal(left.length, 3, `swept to ${left.length}, expected 3`);
    // The NEWEST three, because a failed update's only record is the log inside.
    assert.deepEqual(left.sort(), ['agentco-update-5', 'agentco-update-6', 'agentco-update-7']);
    assert.ok(fs.existsSync(notOurs), 'it removed a directory that was not ours');
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});

test('the sweep never throws, whatever it is pointed at', () => {
  /*
   * Housekeeping must not be able to stop an update. A directory a running
   * helper still holds refuses to be removed on Windows, and a temp directory
   * that cannot be read is not a reason to refuse to install anything.
   */
  assert.doesNotThrow(() => sweepOldUpdateDirs(path.join(os.tmpdir(), 'agentco-nope-' + Date.now())));
  assert.doesNotThrow(() => sweepOldUpdateDirs(os.tmpdir(), Number.MAX_SAFE_INTEGER));
});

test('⭐ the shipped code leaves nothing else behind', () => {
  /*
   * The standard, in the user's words: an app that keeps making files it never
   * removes is not meaningfully different from a virus. So every temp directory
   * the PRODUCT creates must be cleaned by somebody — `update-apply.ts` does it
   * in a `finally`, and the update helper's is swept by the next run.
   *
   * ⚠ This gate reads `src/`, never `test/`: the suite makes thousands of temp
   * directories on a developer's machine and none of them ship.
   */
  const shipped = ['src/cli/index.ts', 'src/core/update-apply.ts', 'src/cli/update-run.ts'];
  const makers: string[] = [];
  for (const rel of shipped) {
    const body = readSrc(rel);
    for (const m of body.matchAll(/mkdtempSync\(path\.join\(os\.tmpdir\(\), '([^']+)'/g)) {
      makers.push(`${rel}:${m[1]}`);
    }
  }
  // If a fourth one appears, decide who cleans it before this test is edited.
  assert.deepEqual(
    makers.sort(),
    [
      'src/cli/index.ts:agentco-update-',
      'src/core/update-apply.ts:agentco-layer-',
      'src/core/update-apply.ts:agentco-probe-',
    ],
    `a temp directory with no owner to clean it:\n${makers.join('\n')}`,
  );
  // And the two in update-apply are removed on every path out.
  const apply = readSrc('src/core/update-apply.ts');
  assert.equal((apply.match(/finally \{[\s\S]{0,200}?rmSync/g) ?? []).length, 2, apply.slice(0, 0) || 'both must clean up in a finally');
});
