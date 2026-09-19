/**
 * The folder picker's target. → core/paths.ts §browseDirs
 *
 * 🔴 Real case, 19/09/2026: one Windows browser drove two daemons in turn — the
 * desktop build and a WSL one — on the same default port, so the same origin,
 * so ONE `localStorage`. It replayed `D:\Temp` at the Linux daemon, where
 * `path.resolve` does not recognise that shape as absolute and joined it to the
 * process's cwd: `/home/<user>/D:\Temp`. A path nobody asked for, that does not
 * exist, and that `ArmDialog` would happily accept as an arm's root.
 *
 * ⚠ The assertions are written against THE CURRENT PLATFORM, because the bug is
 * "a path shaped for the other platform" and which one that is depends on where
 * the test runs. CI runs all three.
 */

import { strict as assert } from 'node:assert';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { browseDirs } from '../dist/core/paths.js';

const WIN = process.platform === 'win32';

/**
 * A path absolute on the OTHER platform, and therefore not here.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE FIRST VERSION OF THIS FILE SKIPPED THE WINDOWS CASE, and that is   │
 * │ where the remaining bug was. (found by review, 19/09/2026)               │
 * │                                                                          │
 * │ It said "no POSIX-only shape exists on Windows" — which is exactly        │
 * │ wrong, and the reason is `path.isAbsolute('/home/u/x')` answering `true`  │
 * │ on win32, where Node reads a leading slash as the current drive's root.   │
 * │ So a stored Linux path resolved to `D:\home\u\x`: invented, empty, and    │
 * │ selectable as an arm's root. A skip written as a fact about the world,    │
 * │ rather than about the test, hid the mirror image of the bug being fixed. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const FOREIGN = WIN ? '/home/minhvq36/project' : 'D:\\Temp';

test('🔴 a foreign-shaped path is refused, never joined to a local root', () => {
  const r = browseDirs(FOREIGN);
  assert.notEqual(r.path, path.resolve(FOREIGN), 'the foreign path was resolved instead of refused');
  if (WIN) assert.doesNotMatch(r.path, /home/i, `invented a local path: ${r.path}`);
  else assert.doesNotMatch(r.path, /D:/, `the Windows path survived into the answer: ${r.path}`);
});

test('…and it lands exactly where NO target lands — one rule, no third behaviour', () => {
  assert.deepEqual(browseDirs(FOREIGN), browseDirs());
});

/**
 * ⚠ THE OTHER DIRECTION, and it is the one that pays for the guard: refusing
 * everything would also pass both tests above. A drive-lettered path on
 * Windows, and a `/` path on POSIX, are what the picker itself hands back, so
 * they have to keep working or the dialog cannot browse at all.
 */
test('a NATIVE absolute path is still accepted — the guard did not just refuse everything', () => {
  const native = WIN ? path.parse(process.cwd()).root : '/';
  assert.equal(browseDirs(native).path, path.resolve(native));
});

test('an empty target is the no-target case, not an error', () => {
  assert.deepEqual(browseDirs(''), browseDirs());
});

test('a relative path is refused too — the picker deals in absolute paths only', () => {
  assert.deepEqual(browseDirs('some/relative/dir'), browseDirs());
});

test('a real absolute directory still lists normally — the guard did not close the door', () => {
  // ⚠ `fileURLToPath`, never `url.pathname`: the latter hands back
  // `/D:/…` with forward slashes on Windows, which is a different string from
  // the one `browseDirs` answers with and would fail for the wrong reason.
  const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const r = browseDirs(here);
  assert.equal(r.path, here);
  assert.ok(r.dirs.some((d) => d.name === 'src'), `expected src/ under ${here}, got ${r.dirs.map((d) => d.name).join(', ')}`);
});

test('every listed entry carries a path that can be browsed straight back in', () => {
  const root = browseDirs();
  for (const d of root.dirs.slice(0, 3)) {
    assert.ok(path.isAbsolute(d.path), `${d.path} would be refused by the very next call`);
  }
});
