/**
 * CREATING AN EMPLOYEE MUST NOT INVENT ITS DESCRIPTION.
 *
 * Reported 05/09: typing a name and pressing Enter produced a worker whose
 * `pitch` was our own placeholder sentence — *"What X can do, written for the
 * assistant to read"* — rendered in whatever interface language was selected at
 * that instant. Two separate costs, and both were invisible:
 *
 *  ① `pitch` is what the Assistant routes on, and that sentence says NOTHING
 *    about what the person does. The worker sat in the office and was never
 *    given work, for a reason nobody could see.
 *  ② Written through the catalogue, it froze the interface language into user
 *    data that then lives in the cached prefix of every turn — the third
 *    instance of that wire, after the charter (17/08) and `skills/assistant.md`
 *    (05/09). → docs/CLAUDE.md §Language
 *
 * It was never a deliberate allowance either: editing a worker has always
 * refused an empty description, and `RoleSchema` declares `min(1)`. The create
 * door was the one exception, and it hid the gap instead of showing it.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]): string => fs.readFileSync(path.join(HERE, '..', ...p), 'utf8');

test('🔴 the seed value is GONE from both catalogues — not merely unused', () => {
  for (const cat of ['en.ts', 'vi.ts']) {
    const src = read('src', 'i18n', cat);
    assert.doesNotMatch(
      src,
      /^\s*'seed\.rolePitchDefault'\s*:/m,
      `${cat} still declares it — a key that exists is a key someone wires back up`,
    );
  }
});

test('🔴 `roleTemplate` writes the pitch it was given, and substitutes nothing', () => {
  const src = read('src', 'core', 'office.ts');
  assert.match(src, /pitch: \$\{JSON\.stringify\(pitch\)\}/, 'the template no longer writes the pitch verbatim');
  assert.doesNotMatch(
    src,
    /JSON\.stringify\(pitch \|\|/,
    'a `||` fallback here is exactly the wire that put our sentence into user data',
  );
});

test('🔴 `addAgent` refuses an empty pitch — the SAME gate `updateRole` already had', () => {
  const src = read('src', 'core', 'office.ts');
  const from = src.indexOf('addAgent(input:');
  const body = src.slice(from, src.indexOf('this.reload();', from));
  assert.ok(from > 0, '`addAgent` is gone');
  assert.match(
    body,
    /const pitch = \(input\.pitch \?\? ''\)\.trim\(\);[\s\S]{0,120}?if \(!pitch\) \{[\s\S]{0,80}?off\.pitchEmpty/,
    'the HTTP door is a door too — an empty pitch on disk fails `min(1)` and the worker VANISHES silently',
  );
});

test('⭐ the schema still demands it, so the two gates cannot drift apart', () => {
  assert.match(
    read('src', 'core', 'types.ts'),
    /pitch: z\.string\(\)\.min\(1\)/,
    'relaxing this without relaxing both doors is how a worker disappears on the next load',
  );
});

/**
 * The advice is not lost — it moved to where advice belongs. Deleting the
 * placeholder along with the seed would be reading the lesson backwards: the
 * problem was never the sentence, it was the sentence BECOMING their data.
 */
test('🔴 the placeholder and the tip stay — that is where the advice lives now', () => {
  const en = read('src', 'i18n', 'en.ts');
  assert.match(en, /'dialog\.newAgent\.pitchPlaceholder'\s*:/);
  assert.match(en, /'dialog\.newAgent\.pitchTip'\s*:/);
  const dlg = read('web', 'src', 'components', 'dialogs.tsx');
  assert.match(dlg, /placeholder=\{t\('dialog\.newAgent\.pitchPlaceholder'\)\}/);
});

test('🔴 the Create button is WIRED to both fields, not just the name', () => {
  const dlg = read('web', 'src', 'components', 'dialogs.tsx');
  assert.match(dlg, /const ready = Boolean\(name\.trim\(\) && pitch\.trim\(\)\);/, 'no readiness check at all');
  assert.match(dlg, /disabled=\{!ready \|\| busy\}/, 'the button still lets an empty description through');
  assert.match(dlg, /if \(!ready \|\| busy\) return;/, 'Enter bypasses a disabled button — submit must check too');
});
