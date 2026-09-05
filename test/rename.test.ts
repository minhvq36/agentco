
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { appendRename, appendUsage, readUsage, renameChain } from '../dist/core/usage.js';
import { slugId } from '../dist/core/paths.js';

function tmpPaths(): { usageLog: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-rename-'));
  return { dir, usageLog: path.join(dir, 'logs', 'usage.jsonl') };
}

function spend(paths: { usageLog: string }, office: string, cost: number): void {
  appendUsage(paths as never, {
    ts: new Date().toISOString(),
    office,
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
    turns: 1,
    status: 'done',
    reasked: false,
  } as never);
}


test('rename rule: non-Latin new name ⇒ NO slug ⇒ id stays put', () => {
  for (const n of ['会计部', '経理部', '회계팀', 'Бухгалтерия']) {
    assert.equal(slugId(n), '', `${n} must yield an empty slug ⇒ renameTarget returns undefined`);
  }
});

test('rename rule: Latin → non-Latin also keeps the id unchanged (user asked directly)', () => {
  assert.equal(slugId('Kế toán'), 'ke-toan'); // i18n-allow-vietnamese: Vietnamese display name is the slug-generation input under test
  assert.equal(slugId('会计部'), '');
});

test('rename rule: Latin → Latin means the id changes accordingly', () => {
  assert.equal(slugId('Báo cáo'), 'bao-cao'); // i18n-allow-vietnamese: Vietnamese display name is the slug-generation input under test
  assert.equal(slugId('Kiểm kê'), 'kiem-ke'); // i18n-allow-vietnamese: Vietnamese display name is the slug-generation input under test
  assert.notEqual(slugId('Báo cáo'), slugId('Kiểm kê')); // i18n-allow-vietnamese: Vietnamese display name is the slug-generation input under test
});


test('renameChain: log with no renames yet ⇒ empty table', () => {
  const p = tmpPaths();
  try {
    spend(p, 'bao-cao', 1);
    assert.equal(renameChain(p as never).size, 0);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('renameChain: one rename ⇒ old id points to new id', () => {
  const p = tmpPaths();
  try {
    spend(p, 'bao-cao', 1);
    appendRename(p as never, 'bao-cao', 'kiem-ke');
    const chain = renameChain(p as never);
    assert.equal(chain.get('bao-cao'), 'kiem-ke');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('🔴 renameChain: TWO consecutive renames ⇒ every old link points to the FINAL target', () => {
  const p = tmpPaths();
  try {
    appendRename(p as never, 'a', 'b');
    appendRename(p as never, 'b', 'c');
    const chain = renameChain(p as never);
    assert.equal(chain.get('a'), 'c', 'the FIRST link must jump straight to the final target');
    assert.equal(chain.get('b'), 'c');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('renameChain: three renames still collapse to one target', () => {
  const p = tmpPaths();
  try {
    appendRename(p as never, 'a', 'b');
    appendRename(p as never, 'b', 'c');
    appendRename(p as never, 'c', 'd');
    const chain = renameChain(p as never);
    for (const old of ['a', 'b', 'c']) assert.equal(chain.get(old), 'd', old);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('🔴 readUsage: SKIP rename lines — otherwise the total becomes NaN', () => {
  const p = tmpPaths();
  try {
    spend(p, 'bao-cao', 0.5);
    appendRename(p as never, 'bao-cao', 'kiem-ke');
    spend(p, 'kiem-ke', 0.25);

    const recs = readUsage(p as never);
    assert.equal(recs.length, 2, 'only the two real runs should be counted');
    const total = recs.reduce((n, r) => n + r.cost_usd, 0);
    assert.ok(Number.isFinite(total), 'total must be a number, not NaN');
    assert.equal(Math.round(total * 100) / 100, 0.75);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('merge via alias: money BEFORE and AFTER a rename rolls into the same entry', () => {
  const p = tmpPaths();
  try {
    spend(p, 'bao-cao', 0.5);
    spend(p, 'bao-cao', 0.25);
    appendRename(p as never, 'bao-cao', 'kiem-ke');
    spend(p, 'kiem-ke', 0.25);

    const chain = renameChain(p as never);
    const byOffice = new Map<string, number>();
    for (const r of readUsage(p as never)) {
      const key = (r.office && (chain.get(r.office) ?? r.office)) || '';
      byOffice.set(key, (byOffice.get(key) ?? 0) + r.cost_usd);
    }

    assert.equal(byOffice.size, 1, 'must NOT split into two entries');
    assert.equal(Math.round((byOffice.get('kiem-ke') ?? 0) * 100) / 100, 1);
    assert.equal(byOffice.has('bao-cao'), false, 'the old id must not show up as a "deleted" office');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('renameChain: a broken line in the log does not crash anything', () => {
  const p = tmpPaths();
  try {
    spend(p, 'bao-cao', 1);
    fs.appendFileSync(p.usageLog, '{"kind":"office.renamed"  NOT JSON\n', 'utf8');
    fs.appendFileSync(p.usageLog, '{"kind":"office.renamed","from":"x"}\n', 'utf8');
    appendRename(p as never, 'bao-cao', 'kiem-ke');
    const chain = renameChain(p as never);
    assert.equal(chain.get('bao-cao'), 'kiem-ke');
    assert.equal(chain.has('x'), false, 'a record missing a field is dropped, not guessed');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});
