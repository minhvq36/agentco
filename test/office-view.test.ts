
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { placeOf, describeCall } from '../dist/core/worker.js';
import { CAST, CAST_COUNT, castOf, isCastId } from '../dist/core/cast.js';
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
