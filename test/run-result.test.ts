/**
 * A worker's `result` message → the work, or an error in words.
 * → core/worker.ts §runResultText · §resultFailure
 *
 * 🔴 The case this file exists for (14/09): a rejected sign-in arrives as
 * `subtype: 'success'` with `is_error: true`, its `result` reading "Failed to
 * authenticate…". Read as the work, that sentence reaches the receipt parser
 * and fails as malformed JSON — reported as the worker's mistake, when the
 * truth is that nobody is signed in.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { runResultText } from '../dist/core/worker.js';

const CTX = { taskId: 't-1', maxUsd: 0.5, maxTurns: 12, armCalled: false };

function thrown(fn: () => unknown): { kind?: string; message: string } {
  try {
    fn();
  } catch (err) {
    return err as { kind?: string; message: string };
  }
  assert.fail('expected a throw');
}

test('a clean result is the work', () => {
  assert.equal(runResultText({ type: 'result', subtype: 'success', result: 'the receipt' }, CTX), 'the receipt');
});

test('🔴 success + is_error is a failure of kind auth, never the text of the work', () => {
  const work = 'Failed to authenticate. API Error: 401 API key is invalid';
  const err = thrown(() =>
    runResultText({ type: 'result', subtype: 'success', is_error: true, result: work }, CTX),
  );
  assert.equal(err.kind, 'auth');
  /*
   * ⚠ CHANGED 19/09/2026: this used to assert the message still contained
   * "401", i.e. that the vendor's own text survived. It does not any more, and
   * that is the fix rather than a regression — `sayError` now uses the
   * classification instead of computing it and passing the raw text through.
   * The vendor string on this path was *"Not logged in · Please run /login"*,
   * naming a command that exists only inside an interactive `claude` session.
   *
   * What the test was really guarding — "never the text of the work" — is
   * unchanged and asserted below; only the substitute sentence is new.
   */
  assert.notEqual(err.message, work, 'the work text is being shown as the failure');
  assert.match(err.message, /agentco login/, 'the reader is left with nothing to do');
});

test('the budget ceiling keeps its own kind and sentence', () => {
  const err = thrown(() => runResultText({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, result: '' }, CTX));
  assert.equal(err.kind, 'budget');
  assert.doesNotMatch(err.message, /error_max_budget_usd/);
});

test('the turn cap says more once an arm was called — the outside world may have changed', () => {
  const m = { type: 'result', subtype: 'error_max_turns', is_error: true, result: '' };
  const inside = thrown(() => runResultText(m, CTX));
  const outside = thrown(() => runResultText(m, { ...CTX, armCalled: true }));
  assert.equal(inside.kind, 'max_turns');
  assert.equal(outside.kind, 'max_turns');
  assert.ok(outside.message.length > inside.message.length, 'the arm sentence is added');
  assert.doesNotMatch(inside.message, /error_max_turns/);
});

test('any other error result throws instead of passing an empty text on as a finished run', () => {
  const err = thrown(() => runResultText({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '' }, CTX));
  assert.equal(err.kind, 'other');
});
