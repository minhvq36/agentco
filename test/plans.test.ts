/**
 * Test cho `PlanStore.healStale` — ca ZOMBIE sau khi daemon chết.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NỢ KỸ THUẬT #2, và nó xếp hạng "nhật ký nói dối vĩnh viễn".              │
 * │                                                                          │
 * │ Daemon chết giữa một ca ⇒ bản ghi kẹt ở `running` mãi mãi. Người dùng     │
 * │ nhìn nhật ký thấy "đang chạy" cho một việc không ai làm, và ngồi chờ một  │
 * │ thứ đã chết từ lâu. User gọi nó là *"zombie thấy ngứa mắt"* và đòi một    │
 * │ nút Xoá — rồi tự chặn lại: *"hay là giữ lại log, để trace được, liên      │
 * │ quan cả tiền nong"*. Đúng. Chữa lời nói dối, đừng đốt bằng chứng.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

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
    request: `việc ${id}`,
    status,
    started_at: '2026-08-20T00:00:00.000Z',
    steps: [],
    tasks_done: 0,
    tasks_total: 0,
    costUSD: 0,
    turns: 0,
    ...patch,
  }) as never;

test('healStale: ca kẹt planning/running thành failed, ca đã đóng thì không đụng', () => {
  const { store } = tempStore();
  store.upsert(rec('P-done', 'done'));
  store.upsert(rec('P-run', 'running'));
  store.upsert(rec('P-plan', 'planning'));
  store.upsert(rec('P-stop', 'stopped'));

  assert.equal(store.healStale('bị ngắt'), 2);

  const byId = new Map(store.list().map((p) => [p.plan_id, p]));
  assert.equal(byId.get('P-run')!.status, 'failed');
  assert.equal(byId.get('P-plan')!.status, 'failed');
  // Ca đã đóng phải nguyên vẹn — chữa zombie không được viết lại lịch sử thật.
  assert.equal(byId.get('P-done')!.status, 'done');
  assert.equal(byId.get('P-stop')!.status, 'stopped');
  assert.ok(byId.get('P-run')!.report?.includes('bị ngắt'));
  assert.ok(byId.get('P-run')!.ended_at);
});

/**
 * `upsert` đẩy bản ghi lên ĐẦU danh sách. Dùng nó để chữa ba con zombie là xáo
 * tung thứ tự thời gian — đúng thứ nhật ký sinh ra để giữ.
 */
test('healStale: GIỮ NGUYÊN thứ tự trong index', () => {
  const { store } = tempStore();
  // `upsert` unshift, nên ghi ngược lại để danh sách ra đúng thứ tự mong muốn.
  for (const id of ['P-03', 'P-02', 'P-01']) store.upsert(rec(id, 'running'));
  const before = store.list().map((p) => p.plan_id);

  store.healStale('x');
  assert.deepEqual(store.list().map((p) => p.plan_id), before);
});

test('healStale: không có zombie thì không ghi gì, trả 0', () => {
  const { store } = tempStore();
  store.upsert(rec('P-01', 'done'));
  assert.equal(store.healStale('x'), 0);
  assert.equal(store.list()[0]!.status, 'done');
});

/**
 * Chạy hai lần liên tiếp — daemon khởi động lại nhiều lần là chuyện thường, và
 * lần thứ hai không được nối thêm một câu giải thích thứ hai vào cùng một ca.
 */
test('healStale: idempotent qua nhiều lần khởi động', () => {
  const { store } = tempStore();
  store.upsert(rec('P-01', 'running'));
  store.healStale('bị ngắt');
  const first = store.list()[0]!.report;
  assert.equal(store.healStale('bị ngắt'), 0);
  assert.equal(store.list()[0]!.report, first);
});

test('healStale: index chưa tồn tại thì không nổ', () => {
  const { store } = tempStore();
  assert.equal(store.healStale('x'), 0);
});
