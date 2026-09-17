/**
 * 🔴 PROBE BEFORE COMMIT. → docs/SPEC-packaging.md §3.7.1
 *
 * A correct `sha256` proves the bytes arrived. It does not prove the thing
 * starts. So a downloaded layer is written BESIDE the running one, started on a
 * free port, and must answer `/healthz` with its own version before `current`
 * is allowed to move — and a tree that never answers is deleted, leaving the
 * pointer exactly where it was.
 *
 * That is why there is no rollback to test: a half-applied state never exists.
 * What has to be true instead is that the three refusals below leave the
 * install byte-for-byte as they found it.
 *
 * ⚠ The scenarios run in a child process (`helpers/apply-scenarios.ts`) and
 * report OBSERVATIONS only, so every judgement here is made by an assertion
 * that can fail. This file opens no socket and awaits nothing.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { findTar } from '../dist/core/archive.js';
import { readManifest } from '../dist/core/update-check.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS = path.join(HERE, 'helpers', 'apply-scenarios.ts');

interface Run {
  outcome: { ok: boolean; reason?: string; detail?: string; version?: string };
  current: string | undefined;
  treeExists: boolean;
}

function observe(): { ok: Run; bad: Run; hash: Run } {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', SCENARIOS], {
    encoding: 'utf8',
    timeout: 300_000,
  });
  const line = r.stdout.trim().split('\n').at(-1) ?? '';
  assert.ok(line.startsWith('{'), `scenarios produced no result:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(line) as { ok: Run; bad: Run; hash: Run };
}

test('🔴 a layer is committed only after it has been seen to start', () => {
  const o = observe();

  // A tree that serves /healthz with its own version may be committed.
  assert.equal(o.ok.outcome.ok, true, JSON.stringify(o.ok.outcome));
  assert.equal(o.ok.current, path.join('app', '9.9.9'), 'current did not move to the new version');
  assert.ok(o.ok.treeExists, 'the committed tree is not on disk');

  // 🔴 A tree that exits instead of serving must not be committed, and must not
  // be left behind either: a directory that looks like a version but cannot run
  // is what a later fallback would happily choose.
  assert.equal(o.bad.outcome.ok, false, JSON.stringify(o.bad.outcome));
  assert.equal(o.bad.outcome.reason, 'probe', JSON.stringify(o.bad.outcome));
  assert.equal(o.bad.current, path.join('app', '1.0.0'), 'current moved to a version that cannot start');
  assert.equal(o.bad.treeExists, false, 'the refused tree was left on disk');

  // A hash that does not match is refused BEFORE anything is unpacked — treated
  // the way a bad signature is, not as "a download we could not check".
  assert.equal(o.hash.outcome.ok, false, JSON.stringify(o.hash.outcome));
  assert.equal(o.hash.outcome.reason, 'hash', JSON.stringify(o.hash.outcome));
  assert.equal(o.hash.current, path.join('app', '1.0.0'), 'current moved on a bad hash');
  assert.equal(o.hash.treeExists, false, 'a tree was extracted despite the hash not matching');
});

test('🔴 a manifest is append-only: v1 and v2 each read on both kinds of install', () => {
  const v1 = Buffer.from(JSON.stringify({ version: '0.2.0', released_at: '2026-09-17' }));
  const v2 = Buffer.from(
    JSON.stringify({
      version: '0.2.0',
      released_at: '2026-09-17',
      layers: {
        app: { version: '0.2.0', url: 'https://example.invalid/a.tar.gz', sha256: 'a'.repeat(64), size: 10 },
      },
    }),
  );

  // v1 manifest → a version, no layers. A v2-capable reader falls back to
  // notifying rather than failing.
  assert.deepEqual(readManifest(v1), { version: '0.2.0' });

  // v2 manifest → the same version PLUS the layer. A v1 reader, which only ever
  // looks at `version`, is unaffected by the extra key existing.
  const read = readManifest(v2);
  assert.equal(read?.version, '0.2.0');
  assert.equal(read?.layers?.app?.size, 10);

  /*
   * 🔴 A MALFORMED `layers` IS NOT A MALFORMED MANIFEST. Dropping the whole
   * answer would turn "cannot update automatically" into "cannot even say a
   * version exists" — strictly worse, and for the copies least able to do
   * anything about it.
   */
  const broken = Buffer.from(JSON.stringify({ version: '0.2.0', layers: { app: { url: 5 } } }));
  assert.deepEqual(readManifest(broken), { version: '0.2.0' });

  /*
   * ⚠ HTTPS on the open network, and LOOPBACK as a deliberate exception. What
   * guards a layer is the `sha256` beside it inside a signed manifest — bytes
   * altered in flight fail the hash whatever the scheme. TLS buys
   * confidentiality, which is worth requiring on a public URL and worth
   * nothing on a socket that never leaves the machine. Refusing loopback would
   * cost the only way to exercise the apply path without publishing a release
   * to aim at. → scripts/update-rig.ts
   */
  const layerWith = (url: string): Buffer =>
    Buffer.from(
      JSON.stringify({
        version: '0.2.0',
        layers: { app: { version: '0.2.0', url, sha256: 'a'.repeat(64), size: 10 } },
      }),
    );

  assert.equal(readManifest(layerWith('http://example.com/a.tgz'))?.layers, undefined);
  assert.equal(readManifest(layerWith('http://127.0.0.1:8080/a.tgz'))?.layers?.app?.size, 10);
  assert.equal(readManifest(layerWith('http://localhost:8080/a.tgz'))?.layers?.app?.size, 10);
  // ⚠ Not a prefix match: a host that merely STARTS with the loopback name is
  // somebody else's machine.
  assert.equal(readManifest(layerWith('http://127.0.0.1.evil.test/a.tgz'))?.layers, undefined);
  assert.equal(readManifest(layerWith('http://localhost.evil.test/a.tgz'))?.layers, undefined);

  // And a manifest with no version at all is still nothing, as in v1.
  assert.equal(readManifest(Buffer.from(JSON.stringify({ released_at: 'x' }))), undefined);
});

test('tar is resolved by absolute path, never through PATH', () => {
  /*
   * 🔴 On this project's own machine `tar` on PATH is Git for Windows' GNU tar,
   * which a customer does not have. The same trap already cost `echo` and
   * `date`. → core/archive.ts
   */
  const win = findTar({ SystemRoot: 'C:\\Windows' }, 'win32', () => true);
  assert.equal(win.found, path.join('C:\\Windows', 'System32', 'tar.exe'));

  const posix = findTar({}, 'linux', (p) => p === '/usr/bin/tar');
  assert.equal(posix.found, '/usr/bin/tar');

  // Nothing found ⇒ the paths looked at are part of the answer, because "tar
  // not found" is unactionable and four paths are something a person can check.
  const none = findTar({ SystemRoot: 'C:\\Windows' }, 'win32', () => false);
  assert.equal(none.found, undefined);
  /*
   * ⚠ `path.win32.isAbsolute`, because these paths were built for `win32` —
   * the platform is a PARAMETER of `findTar`, which is what lets one machine
   * check all three. The assertion has to read them with the same platform's
   * rules the function was handed, or it is grading Windows output against
   * whatever OS happens to run the suite. (18/09/2026)
   */
  assert.ok(
    none.tried.length > 0 && none.tried.every((p) => path.win32.isAbsolute(p)),
    none.tried.join(', '),
  );

  // And it really is on the machine running this suite.
  assert.ok(findTar().found, `no system tar: ${findTar().tried.join(', ')}`);
});
