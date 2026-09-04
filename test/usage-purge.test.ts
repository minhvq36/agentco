
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { appendPurge, appendRename, appendUsage, purgeCuts, readUsage } from '../dist/core/usage.js';
import { folderId } from '../dist/core/paths.js';

function tmpPaths(): { usageLog: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-purge-'));
  return { dir, usageLog: path.join(dir, 'logs', 'usage.jsonl') };
}

function spend(paths: { usageLog: string }, office: string, cost: number, at: Date): void {
  appendUsage(paths as never, {
    ts: at.toISOString(),
    office,
    plan_id: 'P-01',
    task_id: 'T-01',
    role: 'r',
    cache_key: '',
    model: 'm',
    in: 1,
    cache_read: 0,
    cache_write: 0,
    out: 1,
    cost_usd: cost,
    wall_ms: 0,
    turns: 3,
    status: 'done',
    reasked: false,
  } as never);
}

const T0 = new Date('2026-09-01T10:00:00.000Z');
const T1 = new Date('2026-09-01T11:00:00.000Z');
const T2 = new Date('2026-09-01T12:00:00.000Z');

function total(paths: { usageLog: string }): number {
  return readUsage(paths as never).reduce((n, r) => n + r.cost_usd, 0);
}


test('purge: rows BEFORE the cutoff vanish, rows AFTER it remain', () => {
  const p = tmpPaths();
  try {
    spend(p, 'content', 1, T0);
    appendPurge(p as never, 'content', T1);
    spend(p, 'content', 5, T2);

    const rows = readUsage(p as never);
    assert.equal(rows.length, 1, 'only the row after the cutoff is kept');
    assert.equal(rows[0]?.cost_usd, 5);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('purge: the cutoff record itself is NOT counted as a task (the ledger does not lie)', () => {
  const p = tmpPaths();
  try {
    spend(p, 'a', 2, T2);
    appendPurge(p as never, 'b', T1);
    const rows = readUsage(p as never);
    assert.equal(rows.length, 1, 'a `kind` row must not leak into the task list');
    assert.ok(Number.isFinite(total(p)), 'the total must not become NaN');
    assert.equal(total(p), 2);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('purge: a DIFFERENT office is untouched', () => {
  const p = tmpPaths();
  try {
    spend(p, 'content', 1, T0);
    spend(p, 'accounting', 7, T0);
    appendPurge(p as never, 'content', T1);
    assert.equal(total(p), 7);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('purge: a block of v0 records (empty office) can also be purged', () => {
  const p = tmpPaths();
  try {
    spend(p, '', 3, T0);
    appendPurge(p as never, '', T1);
    assert.equal(readUsage(p as never).length, 0);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});


test('🔴 purge: RENAME then delete — rows carrying the OLD id must vanish too', () => {
  const p = tmpPaths();
  try {
    spend(p, 'report', 4, T0);
    appendRename(p as never, 'report', 'inventory');
    spend(p, 'inventory', 6, T0);
    appendPurge(p as never, 'inventory', T1);

    assert.equal(readUsage(p as never).length, 0, 'both lives of the same office must be clean');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('🔴 purge: delete `a` → recreate `a` → rename `a→c`, the dead one\'s spend must NOT flow into `c`', () => {
  const p = tmpPaths();
  try {
    spend(p, 'a', 9, T0);
    appendPurge(p as never, 'a', T1);
    spend(p, 'a', 2, T2);
    appendRename(p as never, 'a', 'c');

    const rows = readUsage(p as never);
    assert.equal(rows.length, 1, 'only the second life remains in the ledger');
    assert.equal(rows[0]?.cost_usd, 2, 'must not add in the $9 from the first life');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('purge: deleting twice keeps the LATEST cutoff', () => {
  const p = tmpPaths();
  try {
    spend(p, 'a', 1, T0);
    appendPurge(p as never, 'a', T0);
    spend(p, 'a', 1, T1);
    appendPurge(p as never, 'a', T2);
    assert.equal(readUsage(p as never).length, 0);
    assert.equal(purgeCuts(p as never).get('a'), T2.getTime());
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});


test('🔴 purge: with NO cutoff at all, the ledger is unchanged (the patch does not overreach)', () => {
  const p = tmpPaths();
  try {
    spend(p, 'content', 1, T0);
    spend(p, 'accounting', 2, T1);
    spend(p, '', 3, T2);
    assert.equal(readUsage(p as never).length, 3);
    assert.equal(total(p), 6);
    assert.equal(purgeCuts(p as never).size, 0);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('purge: `--since` still works correctly once a cutoff exists', () => {
  const p = tmpPaths();
  try {
    spend(p, 'a', 1, new Date(Date.now() - 60 * 60_000));
    spend(p, 'a', 2, new Date());
    assert.equal(readUsage(p as never, 10 * 60_000).length, 1, 'a 10-minute window only sees the new row');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});


test('🔴 premise: two offices sharing the same NAME map to the same ID — so the ledger must cut by CUTOFF', () => {
  assert.equal(folderId('Nội dung'), folderId('Nội dung')); // i18n-allow-vietnamese: fixture — Vietnamese input to folderId's diacritic-stripping
  assert.equal(folderId('Nội dung'), 'noi-dung'); // i18n-allow-vietnamese: fixture — Vietnamese input to folderId's diacritic-stripping
});
