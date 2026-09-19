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
import { classifyError, resultFailure, sayError } from '../dist/core/worker.js';

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
  assert.match(r.raw ?? '', /401/);
  // The result's own sentence, not the SDK's wrapper around it.
  assert.doesNotMatch(r.raw ?? '', /returned an error result/);
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

/**
 * 🔴 The vendor's `/login` must not reach a reader who cannot run it.
 * → core/worker.ts §sayError · cli/index.ts §signInNote
 *
 * The exact string below came off a real chat window on 19/09/2026, relayed
 * out of the packaged `claude` binary. It is a correct instruction inside an
 * interactive Claude Code session and a dead end everywhere else — and our own
 * chat box HAS slash commands, so it reads as if it would work.
 */
const VENDOR_LOGIN = 'Not logged in · Please run /login';

test('🔴 an auth failure gets OUR sentence, never the vendor "/login"', () => {
  const kind = classifyError(VENDOR_LOGIN);
  assert.equal(kind, 'auth', 'the classifier was already right — this is about using its answer');
  const said = sayError(VENDOR_LOGIN, kind);
  assert.doesNotMatch(said, /\/login/, 'a slash command the reader has no session to type it into');
  assert.match(said, /agentco login/, 'must name the command they can actually run');
});

test('…and the same holds for every kind we have a sentence for', () => {
  for (const [raw, kind] of [
    ["You've hit your limit", 'usage_limit'],
    ['HTTP 429 rate limit exceeded', 'rate_limit'],
    ['401 unauthorized', 'auth'],
  ] as const) {
    assert.equal(classifyError(raw), kind);
    assert.notEqual(sayError(raw, kind), raw, `${kind} still passed the vendor text straight through`);
  }
});

test('⚠ `other` still passes the vendor text through — this is not a translation layer', () => {
  const odd = 'the socket closed before the first message';
  assert.equal(classifyError(odd), 'other');
  assert.equal(sayError(odd, 'other'), odd);
});

test('a bare machine code is never shown as-is, even on `other`', () => {
  assert.doesNotMatch(sayError('error_during_execution', 'other'), /^error_[a-z_]+$/);
});

test('🔴 doctor keeps the vendor reason BESIDE ours — two readers, both served', async () => {
  const r = await readSignIn(
    stream([{ type: 'result', subtype: 'success', is_error: true, result: VENDOR_LOGIN }]),
    never,
  );
  assert.equal(r.ok, false);
  assert.match(r.note ?? '', /agentco login/, 'the instruction half');
  assert.equal(r.raw, VENDOR_LOGIN, 'the support-thread half');
});

test('…and `raw` is dropped when it would only repeat `note`', async () => {
  const r = await readSignIn(stream([], new Error('process exited with code 1')), never);
  assert.equal(r.note, 'process exited with code 1');
  assert.equal(r.raw, undefined, 'one sentence printed twice, in parentheses after itself');
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
