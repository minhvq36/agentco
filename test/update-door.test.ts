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
import {
  checkSpace,
  checkWritable,
  findNpmCli,
  globalPrefixFor,
  sweepOldUpdateDirs,
  updateScript,
} from '../dist/cli/update-run.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Source with the COMMENT LINES REMOVED.
 *
 * ┌────────────────────────────────────────────────────────────────────────────
 * │ 🔴 FOUR TIMES IN ONE EVENING a gate here tripped over prose that explains
 * │ the very thing it forbids: the Dockerfile's `--omit=optional` warning,
 * │ `token-door`'s own text naming `/api/events`, the helper's paragraph about
 * │ "Nothing was replaced", and `handOffUpdate`'s box explaining why it does
 * │ NOT use `stdio: 'inherit'`.
 * │
 * │ ⚠ AND ONE OF THEM STAYED GREEN FOR THE WRONG REASON, which is the shape
 * │ worth naming: after the behaviour changed, a test went on passing because
 * │ it matched the paragraph describing the OLD behaviour. A red test gets
 * │ fixed; a green one that proves nothing is never looked at again.
 * │
 * │ The rule is the same one `scripts/check-language.ts` and
 * │ `docker-door.test.ts §code` follow: a gate that cannot tell instructions
 * │ from documentation gets switched off within the week.
 * └────────────────────────────────────────────────────────────────────────────
 */
const code = (text: string): string =>
  text
    .split('\n')
    .filter((l) => {
      const s = l.trim();
      return !s.startsWith('*') && !s.startsWith('//') && !s.startsWith('/*');
    })
    .join('\n');
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
  /*
   * ⚠ SCOPED TO `handOffUpdate`, not to the shape of the argument list. Since
   * 18/09 there are TWO spawns of the same helper — the command runs it in the
   * foreground and waits, which is safe precisely because it is not detached —
   * so a file-wide search for `stdio: 'inherit'` would now fail on the correct
   * code. The rule was never "nobody inherits"; it is "THE DETACHED ONE must
   * not". → `updateInTerminal`
   */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'cli', 'index.ts'), 'utf8');
  const fn = code(/function handOffUpdate[\s\S]*?\n\}/.exec(src)?.[0] ?? '');
  assert.ok(fn, 'could not find handOffUpdate in cli/index.ts');
  assert.doesNotMatch(fn, /stdio: 'inherit'/, `the detached helper inherits our stdio:\n${fn}`);
  assert.match(fn, /stdio: \['ignore', log, log\]/, fn);
  assert.match(fn, /detached: true/, fn);
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

  /*
   * ⚠ THIS LINE USED TO ASSERT THE OPPOSITE, and it kept passing after the
   * behaviour changed — by matching the paragraph in the helper that EXPLAINS
   * the old claim. A test green for the wrong reason is worse than a red one.
   * The rule now: npm failing must report what it LOOKED AT, never assert what
   * it cannot know. The full gate is further down this file.
   */
  assert.match(script, /existsSync\(join\(prefix/, 'the helper no longer checks whether the shim survived');

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

test('🔴 an update refuses while any office is working', () => {
  /*
   * ┌────────────────────────────────────────────────────────────────────────
   * │ Applying an update ends by killing this process. A task that dies with
   * │ it is written down by `healStale()` as `failed` on the next start — so
   * │ the record blames the WORK for what the UPDATE did, and the money spent
   * │ sits in `usage.jsonl` attached to a job labelled a failure.
   * │
   * │ Four places already refused to act on a busy office (rename, archive,
   * │ delete, browser sign-in). Updating was the fifth and the only one that
   * │ did not ask — while being the one that takes down EVERY office at once.
   * │ It checked `updating` (one click at a time) and nothing else.
   * │
   * │ ⚠ THE GATE IS ON THE SERVER, deliberately. Whatever the button does, the
   * │ POST is what ends the process. Same lesson as `sameMachine`: a
   * │ client-side check is a courtesy, the server is the fence.
   * └────────────────────────────────────────────────────────────────────────
   */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'server', 'server.ts'), 'utf8');
  /**
   * ⚠ BOUNDED BY THE NEXT ROUTE, not by a character count. This used to slice a
   * fixed 1400 characters and broke on 19/09/2026 for the most avoidable reason
   * there is: somebody wrote a comment inside the handler, the window ran out
   * before `installKind()`, and a test about ORDERING failed over prose. A test
   * that fails when a comment grows is measuring the wrong thing.
   */
  const from = src.indexOf("url.pathname === '/api/update' && method === 'POST'");
  const to = src.indexOf('── office level:', from);
  assert.ok(from > 0 && to > from, 'could not find the POST /api/update handler');
  const handler = src.slice(from, to);

  const busy = handler.indexOf('workingOffices()');
  const apply = handler.indexOf('updating = true');
  assert.ok(busy > 0, 'the update no longer asks which offices are working');
  assert.ok(
    busy < apply,
    'the busy check runs AFTER the update is already claimed — it has to refuse before anything starts',
  );
  assert.match(handler, /srv\.updateOfficeBusy/, 'the refusal does not say why');

  // It must cover BOTH doors, so it sits above the packaged/npm fork.
  assert.ok(busy < handler.indexOf("installKind() === 'packaged'"), 'the npm door slips past the check');
});

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 FOUR 409s, ONE OF WHICH MEANS "IT IS RUNNING". (user, 19/09/2026)     │
 * │                                                                          │
 * │ Real case on 0.2.4, npm door: pressed while an office was working, the    │
 * │ server refused correctly, and the screen said *"Updating — this page will │
 * │ come back on its own"*. Nothing was running and the page never came back; │
 * │ five minutes later the watcher gave up and said the update had failed.    │
 * │ Two sentences, both false, about a refusal that was right.               │
 * │                                                                          │
 * │ The bug is older than the busy fence it fired on — it arrived with the    │
 * │ npm door — so the cases below deliberately cover a refusal OUTSIDE that   │
 * │ fence too, or the fix would look like it was only about busy offices.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
test('🔴 only the "already running" 409 is tagged — the other three are refusals', () => {
  const src = readSrc('src/server/server.ts');
  const from = src.indexOf("url.pathname === '/api/update' && method === 'POST'");
  const to = src.indexOf('── office level:', from);
  const handler = src.slice(from, to);

  const tagged = [...handler.matchAll(/reason: 'in-flight'/g)];
  assert.equal(tagged.length, 1, 'every 409 carries the tag, so the client cannot tell them apart');

  // …and it is the one guarded by `updating`, not any of the others.
  const line = handler.slice(0, handler.indexOf("reason: 'in-flight'"));
  assert.match(line.slice(-200), /if \(updating\) return json\(res, 409/, 'the tag landed on the wrong refusal');

  for (const other of ['srv.updateOfficeBusy', 'srv.updateNoNpm']) {
    const at = handler.indexOf(other);
    assert.ok(at > 0, `${other} is gone`);
    assert.doesNotMatch(
      handler.slice(at - 120, at + 120),
      /reason: 'in-flight'/,
      `${other} claims work is in flight when nothing will happen`,
    );
  }
});

test('🔴 the button stands back up on a refusal, and only keeps waiting for `in-flight`', () => {
  const panel = readSrc('web/src/components/panels/SettingsPanel.tsx');
  const click = panel.slice(panel.indexOf('onClick={() => {'), panel.indexOf('{t(\'settings.updateTo\''));

  assert.doesNotMatch(click, /\.catch\(\(\) =>/, 'the empty catch is back — every refusal is swallowed again');
  assert.match(click, /reason === 'in-flight'/, 'nothing distinguishes the one 409 that means it is running');
  assert.match(click, /setPhase\(\{ at: 'idle' \}\)/, 'a refusal leaves the watcher mounted to invent a failure');
  assert.match(click, /report\(err\)/, "the server's sentence never reaches the screen");

  // The ORDER is the part that was right all along and must stay right: the
  // watcher has to start even when this click loses a race.
  assert.ok(
    click.indexOf("setPhase({ at: 'working' })") < click.indexOf('api.applyUpdate()'),
    'the phase now waits for the response — a click that loses the race draws nothing',
  );
});

test('the client reads `reason` off the wire, or the branch above can never fire', () => {
  const api = readSrc('web/src/lib/api.ts');
  assert.match(api, /readonly reason\?: string/, 'ApiError cannot carry it');
  assert.match(api, /fields\.reason === 'string'/, 'the body is parsed without it');
});

test('🔴 a lost daemon is NOT reported as a refusal — the panel goes through `guard`', () => {
  /*
   * §4.2 row 10: both callers of `/api/update` used to carry a private silent
   * catch, so the ONE flow whose purpose is to kill the daemon was also the one
   * flow that refused to notice it had died. Switching tabs after pressing
   * Update made the footer simply vanish, with no sentence anywhere.
   */
  const panel = readSrc('web/src/components/panels/SettingsPanel.tsx');
  assert.doesNotMatch(panel, /no answer, no line/, 'the silent catch is back in VersionFooter');
  assert.match(panel, /guard\(\(\) => api\.update\(\)\)/, 'the footer is not going through guard');

  const store = readSrc('web/src/lib/store.ts');
  assert.match(store, /export function report/, 'the shared rule is gone');
  assert.match(store, /err\.status === 0\) set\(\{ fatal: msg \}\)/, 'a lost daemon no longer blocks the screen');
});

test('🔴 permission to write is checked BEFORE anything stops, beside the space check', () => {
  /*
   * A `sudo` install leaves the prefix owned by root while the daemon runs as
   * the user, so `npm install --global --prefix <here>` fails with EACCES —
   * AFTER the daemon has been handed off and is on its way out, where no
   * sentence can reach the screen. Both this and `checkSpace` are knowable a
   * second early; asking late is what costs the running company.
   */
  const cli = code(readSrc('src/cli/index.ts'));
  const refusal = cli.slice(cli.indexOf('function updateRefusal'), cli.indexOf('function prepareHelper'));
  assert.match(refusal, /checkWritable\(/, 'nothing checks whether npm can write');
  assert.match(refusal, /cli\.updateNoPermission/, 'the refusal has no sentence');
  assert.ok(
    refusal.indexOf('checkWritable(') < refusal.lastIndexOf('return undefined'),
    'the check runs after the function has already said yes',
  );

  /*
   * ⚠ THE RECIPE HAS TO END IN AN INSTALL. (user walked it, 19/09/2026)
   *
   * The first version listed three lines — set the prefix, extend PATH, reload
   * the shell — under a sentence that said "then install again" in prose. All
   * three ran cleanly, and the refusal came back identical, because none of
   * them moves the copy that is ALREADY installed: `packageRoot()` still
   * pointed into root's tree. A repair that stops one step short reads as a
   * repair that does not work, and the reader has no way to tell which.
   *
   * ⚠ And the package name is a PARAMETER. Typed into the catalogue it would
   * be typed twice, and wrong on the day the package is renamed — in the one
   * message nobody reads until they are already stuck.
   */
  for (const f of ['src/i18n/en.ts', 'src/i18n/vi.ts']) {
    const msg = readSrc(f);
    const line = /'cli\.updateNoPermission':\s*\n?\s*"([^"]*)"/.exec(msg)?.[1] ?? '';
    assert.ok(line, `${f} has no sentence for it`);
    assert.match(line, /npm config set prefix/, `${f} says no without saying what to do`);
    assert.match(line, /npm i -g \{pkg\}/, `${f} never tells them to install, so the refusal repeats`);
    assert.ok(
      line.indexOf('npm config set prefix') < line.indexOf('npm i -g {pkg}'),
      `${f} installs before pointing npm somewhere writable — the same refusal, one step later`,
    );
    /*
     * ⚠ AND IT MUST NOT END WITH `source`. (user walked it a second time,
     * 19/09/2026 — the install had worked and the refusal came back identical)
     *
     * bash caches where it found a command. Reloading the shell file changes
     * PATH and leaves that cache alone, so `agentco` went on resolving to the
     * old copy. The detail that makes this certain rather than unlucky:
     * everyone who reads this sentence read it BY RUNNING `agentco update` in
     * that shell — so the cache is stale for the entire audience of the
     * message, every time. A recipe cannot end in the one step that cannot
     * work for the person reading it.
     *
     * A new terminal fixes it, needs no command, and is the same instruction
     * on bash and zsh. → [[agentco-daemon-premise-in-cli]]
     */
    assert.doesNotMatch(line, /source ~\//, `${f} tells them to reload the shell, which leaves the old path cached`);
    assert.match(line, /TERMINAL|terminal/, `${f} never says to open a new shell`);
  }
});

test('checkWritable: refuses on EACCES, and an absent answer is never a refusal', () => {
  assert.equal(checkWritable(os.tmpdir()).ok, true, 'a writable directory was refused');
  // ⚠ Not an error: a path that does not exist yet answers nothing, and nothing
  // must not block an update. Same discipline as `checkSpace`.
  assert.equal(checkWritable(path.join(os.tmpdir(), 'agentco-no-such-dir-' + Date.now())).ok, true);
});

test('the refusal NAMES the offices, in both languages', () => {
  // "Something is busy" sends somebody opening offices one by one. A name is a
  // sentence they can act on — the rule `officeJail` follows by denying WITH
  // the path to use.
  for (const file of ['src/i18n/en.ts', 'src/i18n/vi.ts']) {
    const cat = readSrc(file);
    const msg = /'srv\.updateOfficeBusy':\s*\n?\s*'([^']*)'/.exec(cat)?.[1] ?? '';
    assert.ok(msg, `${file} has no srv.updateOfficeBusy`);
    assert.ok(msg.includes('{offices}'), `${file} does not name the offices`);
  }
});

test('⚠ `agentco update` the COMMAND is deliberately not gated the same way', () => {
  /*
   * Not an oversight, and written down so nobody "fixes" it in a hurry: the
   * command is somebody typing a deliberate instruction in a terminal that
   * then tells them what it stopped. The BUTTON is a casual click inside a
   * running company, and it is the one that becomes automatic later — which is
   * why the gate lives on the request, where a scheduler will pass through it
   * too. If the command ever grows the same check, it belongs in the same
   * place: `Company.workingOffices()`.
   */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'core', 'company.ts'), 'utf8');
  assert.match(src, /workingOffices\(\): string\[\]/, 'the shared helper is gone');
});

test('🔴 the restart asks AGAIN, because the first check was a minute ago', () => {
  /*
   * ┌────────────────────────────────────────────────────────────────────────
   * │ The gate on POST proves nobody was working WHEN THE BUTTON WAS PRESSED.
   * │ Downloading and probing do not stop the daemon, so it keeps serving for
   * │ a minute or more — and a task handed out in that window is killed by
   * │ the restart and written down by `healStale()` as `failed`.
   * │
   * │ Skipping the restart costs nothing: `applyLayer` ends with
   * │ `writeCurrent()`, so the layer is probed, on disk, and already pointed
   * │ at. Only this process is stale.
   * └────────────────────────────────────────────────────────────────────────
   */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'server', 'server.ts'), 'utf8');
  const body = /async function runUpdate\(\)[\s\S]*?\n  \}/.exec(src)?.[0] ?? '';
  assert.ok(body, 'could not find runUpdate');

  const asks = body.indexOf('workingOffices()');
  const restarts = body.indexOf('opts.onRestart');
  assert.ok(asks > 0, 'runUpdate restarts without asking who is working');
  assert.ok(asks < restarts, 'it asks AFTER restarting, which is too late to matter');
  assert.match(body, /pendingRestart = outcome\.version/, 'a skipped restart is not recorded anywhere');
});

test('⭐ a skipped restart REACHES THE PAGE, or it reads as "nothing changed"', () => {
  /*
   * `/healthz` keeps reporting the old number — correctly, the old process is
   * still running — so the watcher's ceiling expires and the page concludes
   * nothing happened. It did happen. This is the same lie `applying` was added
   * to stop, told at a different moment, so it takes the same shape: state on
   * the server, because the page cannot know.
   */
  const links = readSrc('src/core/update-links.ts');
  assert.match(links, /pendingRestart\?: string/, 'UpdateView dropped the field');

  const server = readSrc('src/server/server.ts');
  assert.match(server, /pendingRestart \? \{ pendingRestart \} : \{\}/, 'GET /api/update no longer reports it');

  const panel = readSrc('web/src/components/panels/SettingsPanel.tsx');
  assert.match(panel, /view\.pendingRestart/, 'the panel ignores it');
  // It has to win over `failed`, which is exactly what the watcher will have concluded.
  assert.ok(
    panel.indexOf('view.pendingRestart') < panel.indexOf("phase.at === 'failed'"),
    'the "nothing changed" branch runs first and the honest sentence never shows',
  );

  for (const f of ['src/i18n/en.ts', 'src/i18n/vi.ts']) {
    assert.match(readSrc(f), /'settings\.updatePending'/, `${f} has no sentence for it`);
  }
});

test('🔴 npm failing no longer CLAIMS nothing was replaced — it looks', () => {
  /*
   * Measured 18/09/2026: the disk filled mid-install, npm had already swapped
   * the tree and never wrote the shims, and the old line told somebody to run
   * a command that no longer existed. This is the last moment anything of ours
   * is alive to say anything at all.
   */
  const script = updateScript();
  // ⚠ Comments stripped: the helper spends a paragraph explaining what the old
  // line claimed. → the note on `code` at the top of this file.
  const body = code(script);
  assert.doesNotMatch(body, /Nothing was replaced/, 'the claim it cannot verify is back');
  // Both shim shapes: `<prefix>/agentco.cmd` on Windows, `<prefix>/bin/agentco` on POSIX.
  assert.match(body, /agentco\.cmd/, 'it does not look for the Windows shim');
  assert.match(script, /'bin', 'agentco'/, 'it does not look for the POSIX shim');
  // And when it is gone, it says the one thing that repairs it.
  assert.match(script, /npm i -g/, 'a broken install gets no repair command');
});

test('🔴 `agentco update` runs in front of you and WAITS — no job, no log file to hunt', () => {
  /*
   * ┌────────────────────────────────────────────────────────────────────────
   * │ The user, 18/09/2026, after watching the command return instantly and
   * │ print a path into TEMP: *"it is a perfectly healthy command, it should
   * │ not be making a job — let it finish and end, healthy or not."*
   * │
   * │ Detaching exists so the helper OUTLIVES a process whose files npm is
   * │ replacing. That reason belongs to the BUTTON, where the daemon is dying
   * │ and nobody is watching. Typed in a terminal the person IS the log — and
   * │ news written to a file in TEMP is news nobody reads, which is how a full
   * │ disk spent an evening looking like a hang.
   * │
   * │ ⚠ The CI hang cannot return here: `stdio:'inherit'` was poison on a
   * │ DETACHED child, whose open handles meant `'close'` never fired. A child
   * │ we wait for has no such gap.
   * └────────────────────────────────────────────────────────────────────────
   */
  const src = readSrc('src/cli/index.ts');

  const fg = /async function updateInTerminal[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
  assert.ok(fg, 'updateInTerminal is gone — the command is a job again');
  assert.match(fg, /stdio: 'inherit'/, 'the command hides npm output again');
  assert.doesNotMatch(fg, /detached/, 'the command detaches again, so it cannot wait');
  assert.match(fg, /child\.on\('exit'/, 'it does not wait for the helper to finish');

  // The BUTTON keeps the old shape, and must: nobody is attached to read it.
  const bg = /function handOffUpdate[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
  assert.match(bg, /detached: true/, bg);
  assert.match(bg, /stdio: \['ignore', log, log\]/, bg);

  // And the command reports the helper's own exit code, so a script can fail.
  const cmd = src.slice(src.indexOf('async function cmdUpdate'));
  assert.match(cmd.slice(0, 3000), /await updateInTerminal\(/, 'cmdUpdate no longer waits');
  assert.match(cmd.slice(0, 3000), /ran\.code === 0 \? EXIT\.ok : EXIT\.general/, 'it always exits 0');
});

test('🔴 the Settings dot follows `chat`, and its "seen" NEVER reaches the disk', () => {
  /*
   * In memory it means "quiet for now"; on disk it would mean "silenced until
   * somebody clears their browser data" — which is how a person ends up
   * running an old version believing they are current. The top-of-screen
   * banner was deleted outright partly to stop keeping a dismissible
   * notification alive; persisting this would rebuild it in a smaller box.
   */
  const store = readSrc('web/src/lib/store.ts');
  assert.match(store, /seenUpdate: boolean/, 'the flag is gone');
  assert.match(store, /next === 'settings' \? \{ seenUpdate: true \}/, 'opening Settings no longer settles it');
  assert.match(store, /updateAvailable: v\.available/, 'the store never learns whether a version is waiting');

  // THE GATE: no persistence, by any route.
  for (const m of store.matchAll(/(localStorage|sessionStorage)\.[a-zA-Z]+\(([^)]*)\)/g)) {
    assert.doesNotMatch(m[0], /seenUpdate|updateAvailable/, `the update dot is being persisted: ${m[0]}`);
  }

  const bar = readSrc('web/src/components/Sidebar.tsx');
  assert.match(bar, /id: 'settings'/, 'the tab id changed and the dot now matches nothing');
  assert.match(bar, /s\.updateAvailable && !s\.seenUpdate/, 'the dot no longer reads both halves');
  assert.match(bar, /tab\.id === 'settings' && newVersion && !on/, 'the dot ignores whether the panel is open');

  /*
   * ⚠ NOT `soft-pulse`. Pulsing is `plans` saying "happening right now"; a
   * version sitting on a server is a standing fact. Borrowing the urgent
   * animation for it teaches people to read both of them wrong.
   */
  const dot = /tab\.id === 'settings' && newVersion && !on[\s\S]{0,220}/.exec(bar)?.[0] ?? '';
  assert.doesNotMatch(dot, /soft-pulse/, dot);
});

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE DOT HAD ONE WRITER AND IT RAN ONCE PER PAGE LOAD. (user,          │
 * │ 19/09/2026)                                                              │
 * │                                                                          │
 * │ `updateAvailable` was set only inside `actions.boot()`. Leave the app     │
 * │ open, let the daemon learn about a release at 3am, and there is still no  │
 * │ dot in the morning; on a fresh machine `boot()` reads the cache before    │
 * │ the first check writes it at 30 s, so the earliest a dot could ever       │
 * │ appear was the SECOND time the app was opened.                           │
 * │                                                                          │
 * │ It survived eleven releases because the manual script said "press F5" —   │
 * │ the workaround was sitting inside the procedure meant to find the bug.    │
 * │ Which is why the test below asks for the WRITER, not for a screenshot.    │
 * │ → [[agentco-checking-erases-evidence]]                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
test('🔴 something writes the dot a SECOND time — it is not as old as the page', () => {
  const server = code(readSrc('src/server/server.ts'));
  const tick = server.slice(server.indexOf('const checkUpdates'), server.indexOf('firstUpdateCheck'));
  assert.match(tick, /company\.emit\(\{/, 'the six-hourly check still tells nobody');
  assert.match(tick, /type: 'update\.available'/, tick);

  /*
   * ⚠ "off means off" HAS TO SURVIVE THE FETCH. (found by review, 19/09/2026)
   * The first version passed a literal `enabled: true` to `updateStatus`, having
   * captured the config before a fetch that can run for its whole timeout. Turn
   * checking off in that window and the tick still broadcast a dot — and it
   * sticks, because every later tick returns early and nothing is left to
   * correct it. The config is re-read at each tick precisely so that switching
   * it off takes effect with no request in between.
   */
  assert.doesNotMatch(tick, /enabled: true/, 'the tick answers from a flag captured before the fetch');
  assert.match(tick, /company\.config\.updates\.check/, 'the tick never re-reads the config');

  // ⚠ NOT from the read door: a GET that announces a change closes a loop with
  // whatever reloads on the announcement. → [[agentco-read-must-not-emit-change]]
  const get = server.slice(
    server.indexOf("url.pathname === '/api/update' && method === 'GET'"),
    server.indexOf("url.pathname === '/api/shutdown'"),
  );
  assert.doesNotMatch(get, /emit\(/, 'the read door emits — a read that announces a change');

  // ⚠ NOT from core either: `checkForUpdate` is shared with `agentco update`,
  // where there is no emitter and nobody listening.
  assert.doesNotMatch(readSrc('src/core/update-check.ts'), /emit\(/, 'an emitter reached the core');

  // Both copies of the union, or the client cannot name what it receives.
  for (const f of ['src/core/types.ts', 'web/src/lib/types.ts']) {
    assert.match(readSrc(f), /type: 'update\.available'/, `${f} does not declare the event`);
  }

  const store = readSrc('web/src/lib/store.ts');
  assert.match(store, /case 'update\.available':/, 'the store receives it and does nothing');
  const branch = store.slice(store.indexOf("case 'update.available':"), store.indexOf("case 'plan.finished':"));
  assert.match(branch, /set\(\{ updateAvailable: e\.available \}\)/, branch);
  // ⚠ The tick repeats itself four times a day. Touching `seenUpdate` here
  // would put a dismissed dot back on screen every six hours.
  assert.doesNotMatch(branch, /seenUpdate/, 'a re-announcement reopens a dot the user already dismissed');
});
