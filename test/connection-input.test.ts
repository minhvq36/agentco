/**
 * SOMETHING THAT LIVES INSIDE A CONNECTION IS NOT A FILE.
 * → `types.ts §TaskIOSchema` for the wire capture of the failure.
 *
 * Reported 05/09: *"read the agentco page on Notion"*, to a worker holding a
 * read-only Notion arm. The Assistant planned it correctly and wrote the page
 * into `inputs` — the only slot for "what this task needs" — and the plan was
 * rejected: not on disk, no task produces it. **The Assistant got blocked for
 * doing the right thing**, and the advice it gave back ("say which document you
 * mean") could not work, because nothing the human retyped was the problem.
 *
 * The FOURTH time one failure class hit `resolveInput`, and `paths.ts` had
 * written down that a fourth was coming. The 08/26 fix was deterministic and
 * still blind here: `armDirs` maps an arm to a DIRECTORY, and Notion, Linear
 * and GitHub have none. → [[agentco-rule-must-see-what-it-governs]]
 *
 * ⚠ Test 12 in the walkthrough passed all along because its request —
 * *"SEARCH Notion for pages about planning"* — names nothing, so the planner
 * had nothing to declare. Only the "named resource" shape reaches this.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Scheduler } from '../dist/core/scheduler.js';
import { TaskIOSchema } from '../dist/core/types.js';
import { buildTaskMessage } from '../dist/core/prompt.js';

type Plan = Parameters<typeof Scheduler.linkDeps>[0];

const task = (id: string, patch: Record<string, unknown> = {}) => ({
  task_id: id,
  role: 'scout',
  goal: 'g',
  inputs: [],
  outputs: [],
  constraints: [],
  deps: [],
  step: 0,
  ...patch,
});
const plan = (tasks: unknown[]): Plan =>
  ({ plan_id: 'P-test', request: 'r', steps: [{ title: 's', status: 'pending' }], tasks }) as Plan;

const conn = (p: string) => ({ kind: 'connection' as const, path: p });
const file = (p: string) => ({ kind: 'file' as const, path: p });

const ROLES = new Set(['scout', 'rewriter']);
/** Only `scout` is wired to anything — `rewriter` deliberately is not. */
const WIRED = new Set(['scout']);

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-conn-'));

test('🔴 the reported case: a named page on a connection no longer blocks the plan', () => {
  const dir = tmp();
  try {
    const p = plan([task('T-01', { inputs: [conn('Notion: agentco')], outputs: [file('artifacts/T-01/r.md')] })]);
    assert.deepEqual(Scheduler.validate(p, ROLES, dir, {}, WIRED), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The load-bearing half. Without it, `kind: "connection"` is a one-word way to
 * switch the file gate off for a mistyped path — the direction `isUrlInput`
 * refused to guess in. A worker holding no connection cannot have meant one,
 * and that is checkable without asking anybody.
 */
test('🔴 a connection input handed to a worker wired to NOTHING is still blocked', () => {
  const dir = tmp();
  try {
    const p = plan([task('T-01', { role: 'rewriter', inputs: [conn('Notion: agentco')] })]);
    const problems = Scheduler.validate(p, ROLES, dir, {}, WIRED);
    assert.equal(problems.length, 1, `expected exactly one problem, got: ${problems.join(' | ')}`);
    assert.match(problems[0]!, /rewriter/, 'the message must name the employee — that is what gets fixed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 the FILE gate is not loosened one bit — a missing path still blocks', () => {
  const dir = tmp();
  try {
    const p = plan([task('T-01', { inputs: [file('library/files/khong-co.md')] })]);
    assert.equal(
      Scheduler.validate(p, ROLES, dir, {}, WIRED).length,
      1,
      'widening `kind` must not weaken the check it was widened around',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('⭐ both kinds in one task: the file is checked, the connection is not', () => {
  const dir = tmp();
  try {
    const p = plan([task('T-01', { inputs: [conn('Notion: agentco'), file('nope.md')] })]);
    const problems = Scheduler.validate(p, ROLES, dir, {}, WIRED);
    assert.equal(problems.length, 1, `only the file may be reported, got: ${problems.join(' | ')}`);
    assert.match(problems[0]!, /nope\.md/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * `validate` runs on every plan, including one written before today and picked
 * up again by `/resume`. A plan with no `kind` at all has to keep meaning
 * exactly what it meant yesterday.
 */
test('🔴 a plan written before `kind` existed still parses as a FILE', () => {
  assert.equal(TaskIOSchema.parse({ path: 'library/files/a.md' }).kind, 'file');
  assert.equal(TaskIOSchema.parse({ kind: 'file', path: 'a.md' }).kind, 'file');
});

test('⭐ no roster of wired workers passed ⇒ the connection check stays silent', () => {
  const dir = tmp();
  try {
    // Callers that never had this argument (tests, older code paths) must not
    // start rejecting plans they used to accept.
    const p = plan([task('T-01', { role: 'rewriter', inputs: [conn('anything')] })]);
    assert.deepEqual(Scheduler.validate(p, ROLES, dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The worker is told to STOP on the first input that will not open. Listing a
 * connection under "read these files yourself" would make it return `blocked`
 * on exactly the thing it was hired to fetch.
 */
test('🔴 the brief keeps the two kinds APART, so the worker does not try to open a page', () => {
  const msg = buildTaskMessage(
    {
      task_id: 'T-01',
      role: 'scout',
      goal: 'read it',
      inputs: [conn('Notion: agentco'), file('library/files/a.md')],
      outputs: [file('artifacts/T-01/r.md')],
      constraints: [],
      knowledge_refs: [],
      deps: [],
      step: 0,
      deliver: 'file',
    } as never,
    '',
    4_000,
  );
  const readList = msg.slice(msg.indexOf('read these files yourself'), msg.indexOf('Fetch these through'));
  assert.ok(msg.includes('Fetch these through your connections'), 'no separate section for connections');
  assert.ok(readList.includes('library/files/a.md'), 'the real file left the read list');
  assert.ok(!readList.includes('Notion: agentco'), 'a connection listed as a file makes the worker return blocked');
});
