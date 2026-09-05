/**
 * "{n} connections are now unused" — the word is **now**, so the number has to
 * be what THIS delete just did, not a standing total.
 *
 * Measured 05/09 on a real company: 19 connections, most never wired to anyone.
 * Deleting any office announced *"17 connections are now unused"*, including
 * when that office had orphaned exactly zero. → `web/src/lib/store.ts`
 *
 * ⚠ Source assertions, not a call: `store.ts` imports through the `@i18n`
 * alias, which `node --test` cannot resolve — the same reason `chat-echo.ts`
 * was split out. And a delta is invisible to `tsc` either way: counting the
 * wrong set compiles perfectly.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const store = (): string =>
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src', 'lib', 'store.ts'),
    'utf8',
  );

const removeOffice = (): string => {
  const src = store();
  const from = src.indexOf('async removeOffice(');
  assert.ok(from > 0, '`removeOffice` is gone — this whole file is measuring nothing');
  return src.slice(from, src.indexOf('\n  },', from));
};

test('🔴 the count is a DELTA — the starting point is read BEFORE the delete', () => {
  const fn = removeOffice();
  const snapshot = fn.indexOf('const wasOrphan = new Set(');
  const deleted = fn.indexOf('api.removeOffice(id)');
  assert.ok(snapshot > 0, 'nothing records which connections were ALREADY unused');
  assert.ok(
    snapshot < deleted,
    'the before-reading must precede the delete — afterwards that fact no longer exists anywhere',
  );
});

test('🔴 the toast counts only connections this delete orphaned', () => {
  const fn = removeOffice();
  assert.match(
    fn,
    /a\.orphan && !wasOrphan\.has\(a\.id\)/,
    'counting every orphan fires on every delete, and teaches the user to ignore the one time it matters',
  );
});

test('⭐ an unknown starting point says NOTHING rather than a number it cannot stand behind', () => {
  const fn = removeOffice();
  assert.match(
    fn,
    /if \(before\) \{/,
    'with the before-read failed, every orphan looks new — exactly the wrong count this test exists for',
  );
});
