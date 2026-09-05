
import assert from 'node:assert/strict';
import test from 'node:test';

import { continueBrief, shouldContinue } from '../dist/core/scheduler.js';

const brief = {
  task_id: 'T-01',
  role: 'nguoi-soi-thu-muc',
  goal: 'Summarize each sub-page',
  inputs: [],
  outputs: [],
  constraints: ['Write in Vietnamese.'],
  knowledge_refs: [],
  deps: [],
  step: 0,
  deliver: 'file' as const,
};


test('NO new file => does NOT continue (otherwise it loops forever)', () => {
  assert.equal(shouldContinue({ kind: 'max_turns', tried: 0, landed: 0 }), false);
});

test('a new file DID land => continues', () => {
  assert.equal(shouldContinue({ kind: 'max_turns', tried: 0, landed: 1 }), true);
});


test('REAL but very slow progress still needs a FLOOR', () => {
  assert.equal(shouldContinue({ kind: 'max_turns', tried: 0, landed: 5 }), true);
  assert.equal(shouldContinue({ kind: 'max_turns', tried: 1, landed: 5 }), false);
  assert.equal(shouldContinue({ kind: 'max_turns', tried: 9, landed: 5 }), false);
});


test('ONLY `max_turns` — every other failure kind must NOT continue', () => {
  for (const kind of ['budget', 'usage_limit', 'auth', 'rate_limit', 'stopped', 'other'] as const) {
    assert.equal(
      shouldContinue({ kind, tried: 0, landed: 5 }),
      false,
      `${kind} is not allowed to continue`,
    );
  }
});


test('the continuation note carries NO ordinal number — the next run reads from DISK', () => {
  const tiep = continueBrief(brief);
  const them = tiep.constraints.at(-1)!;
  assert.match(them, /output folder/);
  assert.match(them, /do not start again from scratch/i);
  assert.doesNotMatch(them, /\b(position|part|section|page)\s*\d/i, 'must not guess where to continue using a number');
});

test('continuing is the SAME task — the goal does not change, the id does not change', () => {
  const tiep = continueBrief(brief);
  assert.equal(tiep.task_id, brief.task_id);
  assert.equal(tiep.goal, brief.goal);
  assert.equal(tiep.role, brief.role);
  assert.deepEqual(tiep.outputs, brief.outputs);
});

test('keeps every old constraint as-is, only APPENDS one line', () => {
  const tiep = continueBrief(brief);
  assert.equal(tiep.constraints.length, brief.constraints.length + 1);
  assert.equal(tiep.constraints[0], 'Write in Vietnamese.');
});

test('continuing twice does NOT stack the continuation note on top of itself', () => {
  const hai = continueBrief(continueBrief(brief));
  const them = hai.constraints.filter((c) => /output folder/.test(c));
  assert.equal(them.length, 1, 'the continuation note got duplicated');
});
