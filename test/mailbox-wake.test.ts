
/**
 * THE ASSISTANT BECOMING FREE HAS TO WAKE THE PUMP. → `mailbox.ts §onFree`
 *
 * ┌──────────────────────────────────────────────────────────────────────
 * │ MEASURED 09/09: the header sat at "2 waiting" for the rest of the
 * │ session — *"as if it only ever works once"*.
 * │
 * │ `pump()` refuses to run while the assistant lock is held, and it had
 * │ exactly two triggers: a user message arriving, and the end of a pump
 * │ cycle. `run()` takes THAT SAME LOCK for planning and for the report, so a
 * │ message landing inside one of those windows was pushed, saw `isBusy`,
 * │ turned around — and the lock then opened with nobody watching.
 * │
 * │ ⚠ Note which counter this is. `activity.queued` ("n waiting") is the
 * │ MAILBOX; `activity.jobs` ("n queued") is the deferred cluster. Two
 * │ different queues, two different stalls, fixed on two different days —
 * │ reading the wrong counter sends the next person to the wrong file.
 * └──────────────────────────────────────────────────────────────────────
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { Mailbox, mergeUserText } from '../dist/core/mailbox.js';

// ─────────────────────────────── conflicts inside one cluster (09/09)

const user = (text: string) => ({ kind: 'user' as const, text, at: 0 });

test('one message is passed through UNTOUCHED — no scaffolding, no rule', () => {
  assert.equal(mergeUserText([user('đọc readme')]), 'đọc readme'); // i18n-allow-vietnamese: fixture — a real user message
});

test('🔴 "do A" then "do not do A": the precedence rule is stated, and stated BEFORE the list', () => {
  const out = mergeUserText([user('làm A'), user('không làm A nữa')]); // i18n-allow-vietnamese: fixture — a real user message
  assert.match(out, /LATER one wins/, 'order alone does not tell a model which of two conflicting asks wins');
  assert.ok(
    out.indexOf('LATER one wins') < out.indexOf('\n1. '),
    'a rule placed after the examples loses to them — measured 1/4 vs 4/4 in this repo',
  );
  // …and it is on the SAME line as the list intro, not a paragraph of its own.
  assert.ok(out.split('\n')[0]!.includes('LATER one wins'));
});

test('🔴 it says "where they conflict", never "the last one wins"', () => {
  // Most clusters are additions ("also do B"). A blanket last-wins would throw
  // the first two requests away.
  const out = mergeUserText([user('a'), user('b')]);
  assert.match(out, /where two of them conflict/);
  assert.doesNotMatch(out, /only the last|answer the last one/i);
});

test('the order the user sent them in is preserved and numbered', () => {
  const out = mergeUserText([user('first'), user('second'), user('third')]);
  assert.match(out, /1\. first\n2\. second\n3\. third$/);
  assert.match(out, /I sent 3 messages/);
});

test('🔴 the lock opening fires `onFree` — the exit that is NOT on the success path', async () => {
  const box = new Mailbox();
  let woke = 0;
  box.onFree = () => {
    woke++;
  };
  await box.lock(async () => {
    assert.equal(box.isBusy, true, 'premise: the lock is held while the turn runs');
    assert.equal(woke, 0, 'waking DURING the turn would re-enter the pump it is protecting');
  });
  assert.equal(woke, 1, 'the assistant went free and nothing was told — the mailbox stalls here');
  assert.equal(box.isBusy, false);
});

test('🔴 it fires even when the turn THROWS — a failed reply must not strand the queue', async () => {
  const box = new Mailbox();
  let woke = 0;
  box.onFree = () => {
    woke++;
  };
  await assert.rejects(box.lock(async () => Promise.reject(new Error('boom'))));
  assert.equal(woke, 1, 'messages queued behind a failed turn would wait forever');
});

/**
 * ⚠ `lock()` CANNOT BE NESTED — awaiting one inside another DEADLOCKS, because
 * the inner call chains onto a promise the outer one has not resolved yet. So
 * `depth` never exceeds 1 in this codebase and the `depth === 0` guard is
 * belt-and-braces, not a live case. Stated here rather than tested, because the
 * test for it is a process that hangs. Nobody nests today: `run()` is started
 * with `void` from inside a locked turn, so its own `lock()` calls queue AFTER
 * that turn instead of inside it.
 */
test('🔴 one opening, one wake — two turns in a row wake it twice, never more', async () => {
  const box = new Mailbox();
  let woke = 0;
  box.onFree = () => {
    woke++;
  };
  await box.lock(async () => 'first');
  assert.equal(woke, 1);
  await box.lock(async () => 'second');
  assert.equal(woke, 2, 'every close of the lock is a moment the queue may move');
});

test('a listener that throws does not take the lock down with it', async () => {
  const box = new Mailbox();
  box.onFree = () => {
    throw new Error('listener exploded');
  };
  await box.lock(async () => 'ok');
  assert.equal(box.isBusy, false, 'the mutex must survive a bad listener, or the office locks up');
});

test('🔴 the office really WIRES it, and wakes the pump from it', () => {
  const src = fs.readFileSync(
    path.join(url.fileURLToPath(new URL('..', import.meta.url)), 'src', 'core', 'office.ts'),
    'utf8',
  );
  // ⚠ It wakes the office's ONE door (`tick`), not the pump directly: the pump
  // is only half the answer, and a wake-up that skips the door would leave the
  // queued-work half of the question unasked. → `office.ts §tick`
  assert.match(
    src,
    /this\.mailbox\.onFree = \(\) => \{[\s\S]{0,200}?this\.tick\(\);/,
    'the hook exists and nobody listens — the stall is back, silently',
  );
});
