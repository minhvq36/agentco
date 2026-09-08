
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

import { Mailbox } from '../dist/core/mailbox.js';

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
  assert.match(
    src,
    /this\.mailbox\.onFree = \(\) => \{[\s\S]{0,200}?this\.pump\(\)/,
    'the hook exists and nobody listens — the stall is back, silently',
  );
});
