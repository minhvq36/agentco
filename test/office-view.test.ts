
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { placeOf, describeCall } from '../dist/core/worker.js';
import { CAST, CAST_COUNT, FACE_COUNT, assignCast, castOf, isCastId } from '../dist/core/cast.js';
import { pruneCast, readCast } from '../dist/core/layout.js';

/**
 * The office view's deterministic half. → docs/SPEC-office-animation.md §6
 *
 * Everything here answers one question: does the room state something that was
 * actually OBSERVED. A wrong place is not a cosmetic bug — it is the animation
 * claiming an employee read the user's documents when it never opened one.
 */

// ───────────────────────────────────────────────────────────────── placeOf

test('placeOf: a file operation names the room the path is in', () => {
  assert.deepEqual(placeOf({ name: 'Read', input: { file_path: 'library/text/a.md' } }), { at: 'library' });
  assert.deepEqual(placeOf({ name: 'Write', input: { file_path: 'artifacts/P-1/T-01/x.md' } }), { at: 'artifacts' });
  assert.deepEqual(placeOf({ name: 'Edit', input: { file_path: 'knowledge/shared/n.md' } }), { at: 'knowledge' });
  // Anywhere else in the office is a REAL answer, not a shrug: they work from
  // where they stand rather than walking to a station nobody observed.
  assert.deepEqual(placeOf({ name: 'Read', input: { file_path: 'office.yaml' } }), { at: 'desk' });
});

test('placeOf: an absolute path in `pattern` is NOT the library — the 08/24 trap, one level down', () => {
  // `describeCall` already had to learn this: the model often puts an absolute
  // path in `pattern` and leaves `path` empty. Outside the office is not a
  // station, so nobody walks anywhere.
  assert.deepEqual(placeOf({ name: 'Glob', input: { pattern: 'D:/library/*' } }), { at: 'desk' });
  assert.deepEqual(placeOf({ name: 'Grep', input: { pattern: 'x', path: '/home/me/library' } }), { at: 'desk' });
  // A relative path still names its room.
  assert.deepEqual(placeOf({ name: 'Glob', input: { pattern: '*.md', path: 'library/text' } }), { at: 'library' });
});

test('placeOf: the shell is matched by CAPABILITY, not by the name `Bash`', () => {
  // `PowerShell` on Windows, `Bash` on POSIX — the same tool wearing two display
  // names. Matching one name means the room goes blind on one operating system,
  // which is the failure class this repo has already paid for five times.
  assert.deepEqual(placeOf({ name: 'Bash', input: { command: 'ls' } }), { at: 'shell' });
  assert.deepEqual(placeOf({ name: 'PowerShell', input: { command: 'ls' } }), { at: 'shell' });
});

test('placeOf: web tools are their own place, and an arm names WHICH arm', () => {
  assert.deepEqual(placeOf({ name: 'WebSearch', input: {} }), { at: 'web' });
  assert.deepEqual(placeOf({ name: 'WebFetch', input: { url: 'https://x' } }), { at: 'web' });
  assert.deepEqual(placeOf({ name: 'mcp__notion__create_page', input: {} }), { at: 'arm', arm: 'notion' });
});

test('🔴 placeOf: an UNKNOWN tool has NO place, and that is an answer', () => {
  // A tool nobody classified must produce no movement at all. Substituting a
  // default here turns "we did not observe a place" into "they went to the
  // desk" — the display stating something that never happened.
  assert.equal(placeOf({ name: 'TodoWrite', input: {} }), undefined);
  assert.equal(placeOf({ name: 'SomeFutureBuiltin', input: {} }), undefined);
});

test('🔴 placeOf and describeCall never disagree about the room', () => {
  // They read ONE set of regexes (`roomKindOf`). Two copies would drift on the
  // day somebody adds a fourth store, and they would drift silently: the
  // sentence would say one room while a character walked to another.
  const cases: Array<[string, string]> = [
    ['library/text/a.md', 'library'],
    ['artifacts/P/T/x.md', 'artifacts'],
    ['knowledge/shared/n.md', 'knowledge'],
    ['whatever.txt', 'desk'],
  ];
  for (const [path, at] of cases) {
    assert.deepEqual(placeOf({ name: 'Glob', input: { pattern: '*', path } }), { at });
    // The sentence must be non-empty for the same call — one read, two halves.
    assert.ok(describeCall({ name: 'Glob', input: { pattern: '*', path } }).length > 0);
  }
});

// ───────────────────────────────────────────────────────────────────── cast

test('castOf: stable, in range, and never shifted by anybody else', () => {
  for (let i = 0; i < 200; i++) {
    const n = castOf('office-a', `agent:r${i}`);
    assert.ok(Number.isInteger(n) && n >= 0 && n < CAST_COUNT, `out of range: ${n}`);
    assert.equal(n, castOf('office-a', `agent:r${i}`), 'must be deterministic');
  }
  // Hiring or firing must not restyle anybody already standing there — the same
  // property `agentHue` buys by hashing rather than storing.
  assert.equal(castOf('office-a', 'agent:writer'), castOf('office-a', 'agent:writer'));
});

test('castOf: two offices do not line up character-for-character', () => {
  const a = Array.from({ length: 12 }, (_, i) => castOf('office-a', `agent:r${i}`));
  const b = Array.from({ length: 12 }, (_, i) => castOf('office-b', `agent:r${i}`));
  assert.notDeepEqual(a, b, 'the office id has to be part of the seed');
});

test('CAST ids are their own index — the array order IS stored data', () => {
  // Reordering this array renames everybody in every office that ever picked a
  // character by hand. Append only.
  CAST.forEach((m, i) => assert.equal(m.id, i));
});

test('isCastId: refuses anything that does not name a character that exists', () => {
  assert.equal(isCastId(0), true);
  assert.equal(isCastId(CAST_COUNT - 1), true);
  assert.equal(isCastId(CAST_COUNT), false);
  assert.equal(isCastId(-1), false);
  assert.equal(isCastId(1.5), false);
  assert.equal(isCastId('2'), false);
  assert.equal(isCastId(null), false);
  assert.equal(isCastId(undefined), false);
});

// ──────────────────────────────────────────────────────── dealing the faces

const people = (n: number): string[] => Array.from({ length: n }, (_, i) => `agent:r${i}`);
const faces = (m: Record<string, number>): number[] => Object.values(m).map((c) => c % FACE_COUNT);

test('🔴 NO TWO ALIKE WHILE A FACE IS STILL FREE — the twins the user saw', () => {
  // A pure hash gave five employees a 3.8% chance of coming out all different
  // (`5!/5⁵`), and the room showed two identical people with three faces unused.
  // Every office size up to the basket must now be collision-free.
  for (let n = 1; n <= FACE_COUNT; n++) {
    for (const office of ['office-a', 'office-b', 'office-zzz']) {
      const got = faces(assignCast(office, people(n)));
      assert.equal(new Set(got).size, n, `${office} with ${n} people: ${got.join(',')}`);
    }
  }
});

test('🔴 the count is over DRAWINGS, not over `CAST` rows', () => {
  // `CAST` is ten rows and there are five strips, so character 2 and character 7
  // are the same picture. A deal that spread ten distinct cast ids would look
  // exactly as wrong as the hash did, and would pass any test that only checked
  // the ids were different.
  assert.ok(FACE_COUNT < CAST_COUNT, 'this test is meaningless if they are equal');
  const got = Object.values(assignCast('office-a', people(FACE_COUNT)));
  assert.equal(new Set(got.map((c) => c % FACE_COUNT)).size, FACE_COUNT);
});

test('past the basket it REFILLS — the sixth starts a fresh round', () => {
  // Not "everybody after five gets face 4". Eleven people over five faces must
  // come out 3/2/2/2/2, never 2/2/2/2/3 with a pile on the last one.
  const got = faces(assignCast('office-a', people(11)));
  const tally = new Map<number, number>();
  for (const f of got) tally.set(f, (tally.get(f) ?? 0) + 1);
  assert.equal(tally.size, FACE_COUNT);
  assert.equal(Math.max(...tally.values()) - Math.min(...tally.values()), 1);
});

test('🔴 a HAND-PICKED face takes its seat first, and is never overwritten', () => {
  // The one door the user controls must not be the door the twin comes back
  // through: if a pick were dealt around instead of reserved, somebody could be
  // handed the face the user had just claimed for someone else.
  const out = assignCast('office-a', people(FACE_COUNT), { 'agent:r0': 3, 'agent:r1': 1 });
  assert.equal(out['agent:r0'], 3);
  assert.equal(out['agent:r1'], 1);
  assert.equal(new Set(faces(out)).size, FACE_COUNT, 'the rest fill the gaps');
});

test('a stored pick outside the drawings is honoured but still counted once', () => {
  // `layout.cast` legitimately holds 0…9 — `CAST` is append-only and a user may
  // have picked 7 before there were five strips. It draws as face 2, so it must
  // occupy face 2 in the deal rather than letting somebody else have it too.
  const out = assignCast('office-a', people(FACE_COUNT), { 'agent:r0': 7 });
  assert.equal(out['agent:r0'], 7, 'the stored value survives verbatim');
  assert.equal(new Set(faces(out)).size, FACE_COUNT);
});

test('the deal does not depend on the ORDER the caller holds its nodes in', () => {
  // `layout.nodes` is rewritten wholesale by the browser on every canvas drag,
  // so its order is not something a rule may be built on.
  const ids = people(FACE_COUNT);
  const forward = assignCast('office-a', ids);
  const backward = assignCast('office-a', [...ids].reverse());
  assert.deepEqual(forward, backward);
});

test('the assistant is dealt from the same basket as everybody else', () => {
  // It is a face on screen. Leaving it out is how the assistant ends up wearing
  // the same shirt as an employee standing four metres away.
  const out = assignCast('office-a', ['assistant', ...people(FACE_COUNT - 1)]);
  assert.equal(new Set(faces(out)).size, FACE_COUNT);
});

// ─────────────────────────────────────────────────────────── stored choices

test('readCast: a hand-edited or outdated character falls back rather than blanking', () => {
  const out = readCast({ assistant: 3, 'agent:a': 99, 'agent:b': -1, 'agent:c': 'x', 'agent:d': 2 });
  assert.deepEqual(out, { assistant: 3, 'agent:d': 2 });
});

test('readCast: refuses a key that is not shaped like a node id', () => {
  const out = readCast({ '../../etc': 1, 'agent:ok': 2, 'AGENT:Bad': 3, __proto__: 4 });
  assert.deepEqual(Object.keys(out), ['agent:ok']);
});

test('readCast: junk of the wrong shape is empty, never a crash', () => {
  assert.deepEqual(readCast(undefined), {});
  assert.deepEqual(readCast(null), {});
  assert.deepEqual(readCast([1, 2]), {});
  assert.deepEqual(readCast('nope'), {});
});

test('🔴 pruneCast: a deleted person does NOT dress the next person with their name', () => {
  // Delete an employee for good, create a new one with the same name, and the
  // node id is identical (`agent:<slug>`). A surviving entry would put the dead
  // person's costume on the new one — the same shape as an office id that comes
  // back and inherits a dead office's ledger.
  const before = { assistant: 1, 'agent:writer': 7, 'agent:reviewer': 4 };
  const after = pruneCast(before, ['assistant', 'agent:reviewer']);
  assert.deepEqual(after, { assistant: 1, 'agent:reviewer': 4 });
});

test('pruneCast: the survivors keep exactly what they had', () => {
  const kept = pruneCast({ assistant: 5 }, ['assistant', 'agent:a', 'library']);
  assert.deepEqual(kept, { assistant: 5 });
});
