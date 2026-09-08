
/**
 * What the ring buffer may replay when an office is opened.
 * → `web/src/lib/replay.ts`
 *
 * The bug this exists for is invisible to `tsc` and to every other test: the
 * chat pane came up EMPTY after F5 while `chat.jsonl` was intact on disk,
 * because a `/clear` from two hours earlier was still in the buffer and got
 * obeyed a second time.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { replayable } from '../web/src/lib/replay.ts';

const STORE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'web',
  'src',
  'lib',
  'store.ts',
);

test('🔴 `office.cleared` is NEVER replayed — it is an instruction, not a state', () => {
  assert.equal(
    replayable('office.cleared'),
    false,
    'replaying it empties a chat the disk replay had just restored, on every reload',
  );
});

test('🔴 `master.message` is NEVER replayed — the disk pass already printed it', () => {
  assert.equal(replayable('master.message'), false);
});

/**
 * The positive control. A `doesNotMatch`-shaped gate is green when the thing it
 * guards never matches anything at all, so the list has to be shown REFUSING
 * two names and ACCEPTING the events the replay exists for.
 */
test('⭐ live state still replays — otherwise a tab opening late learns nothing', () => {
  for (const type of [
    'plan.created',
    'plan.step',
    'plan.finished',
    'task.started',
    'task.progress',
    'task.done',
    'task.blocked',
    'office.state',
    'office.activity',
    'cost.tick',
    'energy.tick',
    'knowledge.changed',
    'library.changed',
    'layout.changed',
  ] as const) {
    assert.equal(replayable(type), true, `${type} must still be applied on open`);
  }
});

/**
 * A correct predicate nobody calls is worth nothing, and the compiler cannot
 * see the difference — the same hole `chat-echo.test.ts` closes for the echo.
 */
test('🔴 the store really ASKS, and asks in the history loop only', () => {
  const src = fs.readFileSync(STORE, 'utf8');
  assert.match(
    src,
    /if \(!replayable\(e\.type\)\) continue;/,
    'the history replay does not consult the list — a stale /clear wipes the pane again',
  );
  assert.doesNotMatch(
    src,
    /for \(const e of detail\.history\) \{\s*if \(e\.type === 'master\.message'\) continue;/,
    'the old single-name test is back, and it lets `office.cleared` through',
  );
});
