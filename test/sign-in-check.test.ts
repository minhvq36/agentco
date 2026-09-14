/**
 * `doctor`'s sign-in verdict, fed the sequences the SDK really produces.
 * → cli/doctor-auth.ts · core/worker.ts §resultFailure
 *
 * 🔴 The first test replays what was measured on 14/09 with an invalid API
 * key: a `result` with `subtype: 'success'` AND `is_error: true`, then a throw.
 * The old check printed ✓ for exactly that — on six CI machines nobody was
 * signed in on.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { readSignIn } from '../dist/cli/doctor-auth.js';
import { resultFailure } from '../dist/core/worker.js';

const REJECTED = {
  type: 'result',
  subtype: 'success',
  is_error: true,
  result: 'Failed to authenticate. API Error: 401 API key is invalid',
};
const CLEAN = { type: 'result', subtype: 'success', is_error: false, result: 'ok' };

function stream(messages: unknown[], thenThrow?: Error): () => AsyncIterable<unknown> {
  return async function* () {
    yield { type: 'system', subtype: 'init' };
    for (const m of messages) yield m;
    if (thenThrow) throw thenThrow;
  };
}

const never = (): boolean => false;

test('🔴 the 14/09 sequence — success + is_error, then a throw — is NOT signed in', async () => {
  const r = await readSignIn(
    stream([REJECTED], new Error('Claude Code returned an error result: Failed to authenticate. API Error: 401')),
    never,
  );
  assert.equal(r.ok, false);
  assert.match(r.note ?? '', /401/);
  // The result's own sentence, not the SDK's wrapper around it.
  assert.doesNotMatch(r.note ?? '', /returned an error result/);
});

test('…and the same result with no throw after it is still not signed in', async () => {
  const r = await readSignIn(stream([REJECTED]), never);
  assert.equal(r.ok, false);
});

test('a clean result is signed in — so the checks above cannot pass by answering "no" always', async () => {
  assert.deepEqual(await readSignIn(stream([CLEAN]), never), { ok: true });
});

test('a throw after a clean result is a failure: doctor must not vouch for an unfinished call', async () => {
  const r = await readSignIn(stream([CLEAN], new Error('process exited with code 1')), never);
  assert.equal(r.ok, false);
  assert.equal(r.note, 'process exited with code 1');
});

test('an error_* result is translated, never shown as a machine code', async () => {
  const r = await readSignIn(stream([{ type: 'result', subtype: 'error_during_execution', is_error: true, result: '' }]), never);
  assert.equal(r.ok, false);
  assert.ok(r.note);
  assert.doesNotMatch(r.note, /^error_[a-z_]+$/);
});

test('a query() that throws before any message lands in the same verdict', async () => {
  const r = await readSignIn(() => {
    throw new Error('Claude Code executable not found');
  }, never);
  assert.deepEqual(r, { ok: false, note: 'Claude Code executable not found' });
});

test('hitting the ceiling says so, rather than reporting the abort as a login problem', async () => {
  const r = await readSignIn(stream([], new Error('The operation was aborted')), () => true);
  assert.deepEqual(r, { ok: false, timedOut: true });
});

test('no result at all is not signed in, with no invented reason', async () => {
  assert.deepEqual(await readSignIn(stream([]), never), { ok: false });
});

test('resultFailure: both shapes of failure, and never the word "success" as the reason', () => {
  assert.equal(resultFailure(CLEAN), undefined);
  assert.equal(resultFailure({ type: 'result', subtype: 'success' }), undefined);
  assert.equal(resultFailure(REJECTED), REJECTED.result);
  assert.equal(resultFailure({ type: 'result', subtype: 'error_max_turns', result: '' }), 'error_max_turns');
  assert.equal(
    resultFailure({ type: 'result', subtype: 'success', is_error: true, result: '  ' }),
    'unknown error from Claude Code',
  );
});
