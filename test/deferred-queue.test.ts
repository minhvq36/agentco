
/**
 * WORK THE USER HANDED OVER WHILE THE OFFICE WAS BUSY. → `office.ts §finish`
 *
 * ┌──────────────────────────────────────────────────────────────────────
 * │ MEASURED 09/09: THIS QUEUE HAD NEVER RUN A SINGLE ITEM.
 * │
 * │ `run()` refuses to start while the office is `working`. `finish()` drained
 * │ the queue and called `run()` TWELVE LINES BEFORE it set the state back to
 * │ idle — so every queued job threw `officeBusyWait` into a `.catch(() => {})`
 * │ and disappeared. The user saw *"I'll do that next"*, then nothing, and a
 * │ header that kept saying "1 waiting" for the rest of the session.
 * │
 * │ Nothing was red, because nothing asked. `tsc` cannot see a promise thrown
 * │ into an empty catch, and no test had ever exercised the queue.
 * │
 * │ ⚠ THE FIRST FIX MADE IT WORSE — a `state !== 'working'` guard inside the
 * │ drain, asked at the one moment the state is always `working`, turned a
 * │ silent drop into a permanent stall. So what is asserted here is the
 * │ ORDER, which is the thing that was actually wrong both times.
 * └──────────────────────────────────────────────────────────────────────
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

const SRC = fs.readFileSync(
  path.join(url.fileURLToPath(new URL('..', import.meta.url)), 'src', 'core', 'office.ts'),
  'utf8',
);

/** The body of `finish()` — from its declaration to the next method. */
function finishBody(): string {
  const at = SRC.indexOf('private finish(');
  assert.ok(at > 0, 'premise: `finish` is no longer declared the way this test finds it');
  const end = SRC.indexOf('\n  canvas(): CanvasState', at);
  assert.ok(end > at, 'premise: `finish` is no longer followed by `canvas()`');
  return SRC.slice(at, end);
}

test('🔴 the office state is closed BEFORE the queue is opened', () => {
  const body = finishBody();
  const closes = body.indexOf('this.setState(');
  const opens = body.indexOf('this.tick()');
  assert.ok(closes > 0, 'premise: `finish` no longer closes the state');
  assert.ok(opens > 0, 'premise: `finish` no longer opens the door');
  assert.ok(
    closes < opens,
    'the queued job starts while the office still says `working`, so `run()` throws it away',
  );
});

/**
 * 🔴 ONE DOOR. → `office.ts §tick` (user settled 09/09)
 *
 * Three stalls in three days were all the same shape — a waiting state whose
 * only exit ran on the success path — and there were FIVE places that had to
 * remember to nudge one of the two queues. Now every transition asks one
 * function, so there is exactly one place that can be wrong.
 */
test('🔴 queued work has exactly ONE starter, and every transition goes through the door', () => {
  assert.equal(
    SRC.split('this.drainDeferred()').length - 1,
    1,
    'a second drain site is a second set of preconditions to keep in step',
  );
  const starter = SRC.indexOf('private startQueued()');
  const drain = SRC.indexOf('this.drainDeferred()');
  assert.ok(starter > 0 && drain > starter, 'the only drain must live inside `startQueued`');
  // The collection points, all of them, all through `tick()`.
  assert.equal(
    SRC.split('this.tick();').length - 1,
    6,
    'a transition stopped calling the door, or a new one was added without it',
  );
});

test('🔴 `run()` still refuses to start on a busy office — that is WHY the order matters', () => {
  // If this guard is ever removed, the ordering test above stops protecting
  // anything, and the two would drift apart without a word.
  assert.match(
    SRC,
    /if \(this\.state === 'working'\) \{\s*throw new RunError\(t\('off\.officeBusyWait'\)/,
    'the premise of the ordering rule is gone — re-check `finish` before deleting this',
  );
});

test('🔴 the queue has a SECOND exit, for the item that arrives after the drain', () => {
  // `route()` is an LLM turn: a message typed while busy can be pushed onto
  // the queue seconds AFTER the job that was running has already finished and
  // drained. Without this call the item waits for a job that may never come.
  const pushes = SRC.split('this.queueWork(').slice(1);
  assert.equal(pushes.length, 2, 'premise: there are exactly two places that queue work (plan, task)');
  for (const [i, after] of pushes.entries()) {
    assert.ok(
      after.slice(0, 600).includes('this.tick();'),
      `push site ${i + 1} has no exit beside it — the queue stalls exactly as it did on 08/09`,
    );
  }
});

test('the drain still refuses while a job is running, and while stopping', () => {
  assert.match(
    SRC,
    /private drainDeferred\(\)[\s\S]{0,260}?if \(this\.stopRequested \|\| this\.state === 'working' \|\| !this\.deferred\) return undefined;/,
    'Stop must empty the queue, and a running office must not start a second job',
  );
});

/**
 * 🔴 ONE CLUSTER, NOT A QUEUE OF JOBS. (user settled 09/09)
 *
 * Everything typed during one job becomes ONE new plan, so the office runs
 * ask → work → straight on, and the header can only ever say "1 waiting".
 */
test('🔴 the texts are merged ONCE, at the drain — never as they arrive', () => {
  // Merging on arrival would nest `mergeUserText`'s own scaffolding sentence
  // inside itself and hand that to the planner as the user's own words.
  assert.match(
    SRC,
    /private deferred: \{ texts: string\[\]; at: number \} \| null = null;/,
    'the cluster is no longer one slot holding raw texts — re-check where the merge happens',
  );
  assert.match(
    SRC,
    /private drainDeferred\(\)[\s\S]{0,900}?mergeUserText\(texts\.map/,
    'the merge has moved out of the drain, which is the one place it can run exactly once',
  );
  assert.equal(
    SRC.split('mergeUserText(').length - 1,
    2,
    'exactly two callers: the mailbox pump and the deferred drain — a third is a second policy',
  );
});

test('🔴 the cluster has the SAME ceiling as the mailbox — one question, one number', () => {
  assert.match(
    SRC,
    /if \(this\.deferred\.texts\.length >= MAX_QUEUED\) return false;/,
    'an unbounded cluster is one planning turn carrying an unbounded request',
  );
  // …and a refused text must not be answered with "I'll pick it up next".
  assert.match(
    SRC,
    /took \? t\('off\.busyWillFollow'\) : t\('off\.mailboxFlooded'/,
    'the sentence must describe what actually happened to the message',
  );
});
