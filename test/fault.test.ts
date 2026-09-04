
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { agentFault, worthLearning } from '../dist/core/assistant.js';
import { twinScore } from '../dist/knowledge/store.js';

type Receipt = Parameters<typeof agentFault>[0];

const receipt = (patch: Partial<Receipt> = {}): Receipt =>
  ({
    status: 'done',
    say: 'xong',
    answer: '',
    artifacts: [],
    lessons: [],
    blocked_on: null,
    task_id: 'T-01',
    role: 'phan-tich-standard',
    reasked: false,
    looped: false,
    reads: [],
    landed: [],
    wall_ms: 1000,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: 'sonnet', turns: 3 },
    ...patch,
  }) as Receipt;


test('agentFault: hit the cost ceiling BUT delivered the full output => not a fault', () => {
  const r = receipt({ status: 'done', blocked_on: null });
  assert.equal(agentFault(r), false);
  assert.equal(worthLearning([r]), false, 'nothing asked => no junk node to filter out');
});

test('agentFault: hit the cost ceiling, output is missing => still NOT the agent\'s fault', () => {
  const r = receipt({ status: 'blocked', blocked_on: 'hit the $0.4 ceiling', failure: 'budget' });
  assert.equal(agentFault(r), false);
  assert.equal(worthLearning([r]), false);
});

test('agentFault: running out of allowed turns is also a user-set ceiling', () => {
  assert.equal(agentFault(receipt({ status: 'failed', blocked_on: 'out of turns', failure: 'max_turns' })), false);
});

test('agentFault: infrastructure and plan limits teach the agent NOTHING', () => {
  for (const kind of ['rate_limit', 'usage_limit', 'auth'] as const) {
    assert.equal(agentFault(receipt({ status: 'failed', failure: kind })), false, kind);
  }
});

test('agentFault: the user pressing Stop is NOT a lesson', () => {
  const r = receipt({
    status: 'blocked',
    blocked_on: 'user stopped it mid-run',
    failure: 'stopped',
  });
  assert.equal(agentFault(r), false);
  assert.equal(worthLearning([r]), false);
});


test('agentFault: an unfamiliar failure not yet ruled out for the agent => still asks', () => {
  assert.equal(agentFault(receipt({ status: 'failed', failure: 'other' })), true);
});

test('agentFault: repeating an action is always its own doing', () => {
  assert.equal(agentFault(receipt({ looped: true, failure: 'budget' })), true);
  assert.equal(agentFault(receipt({ reasked: true, failure: 'rate_limit' })), true);
});

test('agentFault: a `blocked_on` the employee self-reported is STILL a lesson', () => {
  assert.equal(agentFault(receipt({ status: 'done', blocked_on: 'missing terminology file' })), true);
  assert.equal(agentFault(receipt({ status: 'blocked', blocked_on: 'missing file' })), true);
});

test('agentFault: an employee self-reporting failed (with no failure kind) => is a lesson', () => {
  assert.equal(agentFault(receipt({ status: 'failed' })), true);
});

test('agentFault: a clean run stays quiet', () => {
  assert.equal(agentFault(receipt()), false);
});

test('agentFault: many turns is NOT a signal', () => {
  const r = receipt({ usage: { ...receipt().usage, turns: 30 } });
  assert.equal(agentFault(r), false);
});


const A = 'Phan-tich-standard liên tục chạm trần chi phí khi làm việc nhóm+tổng hợp CSV — nên nới max_usd trước khi giao việc dạng này.'; // i18n-allow-vietnamese: fixture — near-duplicate score is tuned to this exact Vietnamese sentence's length/structure
const B = 'Việc nhóm+tổng hợp CSV có thể chạm trần chi phí ở phan-tich-standard — cân nhắc nới max_usd trước khi giao việc tương tự.'; // i18n-allow-vietnamese: fixture — near-duplicate score is tuned to this exact Vietnamese sentence's length/structure

test('twinScore: a pair that slipped through the net must land ABOVE the new threshold, BELOW the old one', () => {
  const s = twinScore(A, B);
  assert.ok(s > 0.6, `must be blocked at the 0.6 threshold, measured ${s.toFixed(3)}`);
  assert.ok(s < 0.75, `and must explain why the old threshold let it through: ${s.toFixed(3)}`);
});

test('twinScore: symmetric — swapping the order does not change the result', () => {
  assert.equal(twinScore(A, B), twinScore(B, A));
});

test('twinScore: two lessons about DIFFERENT things must score far apart', () => {
  const khac = 'Chính sách đổi trả nằm ở library/files/doi-tra.md — grep ở đó trước khi trả lời khách.'; // i18n-allow-vietnamese: fixture — near-duplicate score is tuned to this exact Vietnamese sentence's length/structure
  assert.ok(twinScore(A, khac) < 0.6, 'lowering the threshold to 0.6 must not pull two unrelated things together');
});

test('twinScore: an empty string is never a near-duplicate', () => {
  assert.equal(twinScore(A, ''), 0);
  assert.equal(twinScore('', ''), 0);
});
