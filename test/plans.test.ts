
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PlanStore } from '../dist/core/plans.js';

type Paths = ConstructorParameters<typeof PlanStore>[0];

function tempStore(): { store: PlanStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plans-'));
  const tasks = path.join(dir, 'tasks');
  fs.mkdirSync(tasks, { recursive: true });
  const paths = { tasks, planIndex: path.join(tasks, 'index.json') } as Paths;
  return { store: new PlanStore(paths), dir };
}

const rec = (id: string, status: string, patch: Record<string, unknown> = {}) =>
  ({
    plan_id: id,
    office: 'o',
    request: `task ${id}`,
    status,
    started_at: '2026-08-20T00:00:00.000Z',
    steps: [],
    tasks_done: 0,
    tasks_total: 0,
    costUSD: 0,
    turns: 0,
    ...patch,
  }) as never;

test('healStale: plans stuck in planning/running become failed, closed plans are untouched', () => {
  const { store } = tempStore();
  store.upsert(rec('P-done', 'done'));
  store.upsert(rec('P-run', 'running'));
  store.upsert(rec('P-plan', 'planning'));
  store.upsert(rec('P-stop', 'stopped'));

  assert.equal(store.healStale('interrupted'), 2);

  const byId = new Map(store.list().map((p) => [p.plan_id, p]));
  assert.equal(byId.get('P-run')!.status, 'failed');
  assert.equal(byId.get('P-plan')!.status, 'failed');
  assert.equal(byId.get('P-done')!.status, 'done');
  assert.equal(byId.get('P-stop')!.status, 'stopped');
  assert.ok(byId.get('P-run')!.report?.includes('interrupted'));
  assert.ok(byId.get('P-run')!.ended_at);
});

test('healStale: KEEPS the index order unchanged', () => {
  const { store } = tempStore();
  for (const id of ['P-03', 'P-02', 'P-01']) store.upsert(rec(id, 'running'));
  const before = store.list().map((p) => p.plan_id);

  store.healStale('x');
  assert.deepEqual(store.list().map((p) => p.plan_id), before);
});

test('healStale: writes nothing and returns 0 when there are no zombies', () => {
  const { store } = tempStore();
  store.upsert(rec('P-01', 'done'));
  assert.equal(store.healStale('x'), 0);
  assert.equal(store.list()[0]!.status, 'done');
});

test('healStale: idempotent across multiple startups', () => {
  const { store } = tempStore();
  store.upsert(rec('P-01', 'running'));
  store.healStale('interrupted');
  const first = store.list()[0]!.report;
  assert.equal(store.healStale('interrupted'), 0);
  assert.equal(store.list()[0]!.report, first);
});

test('healStale: does not blow up when the index does not exist yet', () => {
  const { store } = tempStore();
  assert.equal(store.healStale('x'), 0);
});
