
/**
 * WHAT A MEMORY-COMPACTION TURN IS ALLOWED TO SEE. → `office.ts §workSkeleton`
 *
 * The recursion is `memory(n) = compact( session(n) + memory(n-1) )`. The old
 * code handed it `plans.list().slice(0, 12)` instead of `session(n)`, which
 * made the work log a second, staler copy of memory — and that copy won.
 * Measured 05/09: the user deleted their memory, held an entirely English
 * conversation, and `/clear` rebuilt the deleted content, in the language of
 * two runs from the day before.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { planStatusOf, workSkeleton } from '../dist/core/office.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core');
const office = (): string => fs.readFileSync(path.join(SRC, 'office.ts'), 'utf8');

const job = (request: string, ended_at?: string, extra: Record<string, unknown> = {}) => ({
  status: 'done',
  request,
  ...(ended_at ? { ended_at } : {}),
  ...extra,
});

test('🔴 a job already squashed into memory is NOT handed over again', () => {
  const out = workSkeleton(
    [job('new job', '2026-09-05T10:00:00Z'), job('old job', '2026-09-04T10:00:00Z')],
    '2026-09-05T00:00:00Z',
  );
  assert.match(out, /new job/);
  assert.doesNotMatch(
    out,
    /old job/,
    'this is the resurrection: content the user deleted from memory comes back from the log',
  );
});

test('🔴 with no marker yet, everything is handed over — a new office behaves as before', () => {
  const out = workSkeleton([job('a', '2026-09-04T10:00:00Z'), job('b')], undefined);
  assert.match(out, /- \[done\] a/);
  assert.match(out, /- \[done\] b/);
});

test('🔴 an UNFINISHED job keeps being carried, marker or not', () => {
  // No `ended_at` — it has not finished, so no compaction can have covered it.
  // Work still in progress is exactly what a memory is for.
  const out = workSkeleton([job('still running')], '2099-01-01T00:00:00Z');
  assert.match(out, /still running/);
});

test('⭐ everything already covered ⇒ says so, rather than sending an empty listing', () => {
  const out = workSkeleton([job('old', '2026-09-01T00:00:00Z')], '2026-09-05T00:00:00Z');
  assert.match(out, /no jobs have run since/);
});

test('⭐ the report line is the FIRST line only, and the status is stated', () => {
  const out = workSkeleton([job('x', '2026-09-05T10:00:00Z', { report: 'line one\nline two' })], undefined);
  assert.match(out, /- \[done\] x\n {2}→ line one/);
  assert.doesNotMatch(out, /line two/);
});

test('🔴 an over-long window is CUT, and the cut is STATED — never silently dropped', () => {
  // Each request is padded so the token ceiling is genuinely reached.
  const many = Array.from({ length: 400 }, (_, i) =>
    job(`job ${i} ${'padding '.repeat(20)}`, '2026-09-05T10:00:00Z'),
  );
  const out = workSkeleton(many, undefined);
  const listed = out.split('\n').filter((l) => l.startsWith('- [')).length;
  assert.ok(listed < many.length, 'the ceiling never engaged — this test proves nothing');
  assert.match(
    out,
    new RegExp(`\\(\\+${many.length - listed} older job\\(s\\)`),
    'the dropped jobs are invisible — exactly the silent loss that made job #13 vanish forever',
  );
});

test('🔴 one job larger than the whole ceiling is still listed, not dropped to nothing', () => {
  const out = workSkeleton([job('x '.repeat(20_000), '2026-09-05T10:00:00Z')], undefined);
  assert.match(out, /- \[done\] x/, 'an empty skeleton would tell the model nothing ran at all');
});

/**
 * The marker is worthless if it does not survive the two things that happen
 * around it — and neither is visible to `tsc`.
 */
test('🔴 the marker outlives BOTH `/clear` and a daemon restart', () => {
  const src = office();
  assert.match(src, /compacted_through\?: string;/, 'not read back from disk ⇒ lost on restart');
  assert.match(src, /this\.compactedThrough = saved\.compactedThrough;/, 'read but never loaded');
  assert.match(
    src,
    /fs\.rmSync\(this\.sessionFile\(\), \{ force: true \}\);[\s\S]{0,900}?this\.saveSessionId\(\);/,
    '`finishClear` deletes the session file — it must rewrite the marker, or a second /clear wipes it',
  );
});

test('🔴 the marker advances on a SUCCESSFUL turn, not only when a node was written', () => {
  const src = office();
  // `NOTHING` is a valid answer that writes no node. Tying the marker to
  // `saved` would let a repeated NOTHING grow the window without bound.
  assert.match(src, /this\.compactedThrough = upTo;/);
  assert.doesNotMatch(
    src,
    /if \(saved\) \{?\s*this\.compactedThrough/,
    'gating on `saved` folds NOTHING in with a crash — they are opposite cases',
  );
  const advance = src.indexOf('this.compactedThrough = upTo;');
  const tempFail = src.indexOf('off.compactFailed');
  assert.ok(advance > tempFail, 'the advance must sit AFTER the catch, so a thrown error never reaches it');
});

/**
 * The log has to be TRUE before it is worth scoping. A wrongly-scoped input is
 * noise; a FALSE input is read as fact by every later turn and then squashed
 * into memory, where it never expires. → `office.ts §planStatusOf`
 */
test('🔴 a `blocked` task must NEVER make the run read as done — the abc.txt case', () => {
  // P-260905-0237-oq34, verbatim: one task, came back blocked, was logged done,
  // and the assistant then told the user the file already existed.
  assert.equal(planStatusOf([{ status: 'blocked' }]), 'blocked');
  assert.equal(planStatusOf([{ status: 'needs_human' }]), 'blocked');
});

test('🔴 one blocked task among finished ones still blocks the run', () => {
  assert.equal(
    planStatusOf([{ status: 'done' }, { status: 'blocked' }]),
    'blocked',
    'a run that did not reach its goal must not be filed next to the ones that did',
  );
});

test('⭐ `failed` still outranks `blocked`, and an all-done run is still done', () => {
  assert.equal(planStatusOf([{ status: 'blocked' }, { status: 'failed' }]), 'failed');
  assert.equal(planStatusOf([{ status: 'done' }, { status: 'done' }]), 'done');
  assert.equal(planStatusOf([]), 'done', 'no receipts is the caller’s problem, not a status to invent');
});

test('🔴 the call site really uses it — the old expression is gone', () => {
  const src = office();
  assert.match(src, /status = planStatusOf\(receipts\);/, 'the run still computes its own status inline');
  assert.doesNotMatch(
    src,
    /receipts\.some\(\(r\) => r\.status === 'failed'\) \? 'failed' : 'done'/,
    'this is the expression that logged a blocked run as done',
  );
});

test('🔴 the skeleton ceiling is its own constant, not shared with worker knowledge', () => {
  const src = office();
  assert.match(src, /const SKELETON_TOKENS = /, 'no named ceiling at all');
  assert.doesNotMatch(
    src,
    /knowledge_pack[\s\S]{0,80}SKELETON_TOKENS/,
    'one constant serving two budgets is how a number ends up wrong for both',
  );
});
