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

/** A path that is absolute on the OTHER platform, and therefore not here. */
const FOREIGN = WIN ? '' : 'D:\\Temp';

test('🔴 a foreign-shaped path is refused, never joined to the cwd', { skip: WIN && 'no POSIX-only shape exists on Windows' }, () => {
  const r = browseDirs(FOREIGN);
  assert.doesNotMatch(r.path, /D:/, 'the Windows path survived into the answer');
  assert.ok(!r.path.startsWith(process.cwd()) || r.path === path.parse(process.cwd()).root,
    'the picker landed wherever `agentco start` was typed');
});

test('…and it lands exactly where NO target lands — one rule, no third behaviour', { skip: WIN && 'see above' }, () => {
  assert.deepEqual(browseDirs(FOREIGN), browseDirs());
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
