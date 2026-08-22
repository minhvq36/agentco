/**
 * Test cho ĐỔI TÊN VĂN PHÒNG KÉO THEO THƯ MỤC. → docs/SPEC-offices.md §3
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HAI NỖI LO LỚN NHẤT ĐỀU ĐÃ ĐO VÀ ĐỀU KHÔNG CÓ THẬT (22/08):             │
 * │                                                                          │
 * │  · **Prompt cache** — `prompt.ts` không chứa `office.dir`/`office.id` ở   │
 * │    đâu cả; mọi đường dẫn trong prefix đều tương đối. Dời thư mục ⇒ 0 lần  │
 * │    ghi lại cache.                                                        │
 * │  · **Trí nhớ Trợ lý** — thử thật: nói một mã ở thư mục `bao-cao`, đổi tên │
 * │    thành `kiem-ke`, rồi `resume` cùng session id → đọc lại đúng mã.       │
 * │    `resume` KHÔNG bám theo cwd.                                          │
 * │                                                                          │
 * │ Nạn nhân DUY NHẤT là `logs/usage.jsonl`: nó nằm ở cấp CÔNG TY nên không   │
 * │ đi theo thư mục, và mang `office: "<id>"` ở 315/317 dòng. Giải bằng bản   │
 * │ ghi ALIAS nối vào cuối sổ — append-only giữ nguyên, không viết lại một    │
 * │ dòng lịch sử nào.                                                        │
 * │                                                                          │
 * │ Đây là chỗ sai thì **mất tiền của người dùng trong sổ**, nên nó có test   │
 * │ trước cả giao diện.                                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

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

// ─────────────────────────────────────────────────────── luật đổi thư mục

/**
 * `Company.renameTarget` dùng `slugId`, KHÔNG dùng `folderId` — và đó là cả sự
 * khác biệt. Test ở đây khoá chính cái tính chất đó qua `slugId`, vì
 * `renameTarget` là private và điều kiện thật của nó chỉ có một câu:
 * **đổi thư mục khi và chỉ khi tên mới cho ra một slug thật.**
 */
test('luật đổi thư mục: tên mới phi-Latin ⇒ KHÔNG có slug ⇒ id đứng yên', () => {
  for (const n of ['会计部', '経理部', '회계팀', 'Бухгалтерия']) {
    assert.equal(slugId(n), '', `${n} phải cho slug rỗng ⇒ renameTarget trả undefined`);
  }
});

test('luật đổi thư mục: Latin → phi-Latin cũng giữ nguyên id (user hỏi thẳng)', () => {
  // "Kế toán" (ke-toan) đổi thành "会计部": slug mới rỗng nên thư mục ĐỨNG YÊN.
  // Nếu đem băm thì `ke-toan` thành `vp-ee6fd8` — một cái tên đọc được đổi
  // thành vô nghĩa, để phục vụ đúng con số không ai nhìn.
  assert.equal(slugId('Kế toán'), 'ke-toan');
  assert.equal(slugId('会计部'), '');
});

test('luật đổi thư mục: Latin → Latin thì id đổi theo', () => {
  assert.equal(slugId('Báo cáo'), 'bao-cao');
  assert.equal(slugId('Kiểm kê'), 'kiem-ke');
  assert.notEqual(slugId('Báo cáo'), slugId('Kiểm kê'));
});

// ─────────────────────────────────────────────────────── sổ chi phí

test('renameChain: sổ chưa có lần đổi tên nào thì bảng rỗng', () => {
  const p = tmpPaths();
  try {
    spend(p, 'bao-cao', 1);
    assert.equal(renameChain(p as never).size, 0);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('renameChain: một lần đổi tên ⇒ id cũ trỏ tới id mới', () => {
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

test('🔴 renameChain: đổi tên HAI LẦN liên tiếp ⇒ mọi mắt xích cũ trỏ về đích CUỐI', () => {
  // Chỗ dễ sai nhất: chỉ nối `b→c` mà quên trỏ lại `a`, thì tiền của thời `a`
  // rơi vào một mục mồ côi và người dùng thấy một văn phòng "đã xoá" mà họ
  // chưa bao giờ xoá.
  const p = tmpPaths();
  try {
    appendRename(p as never, 'a', 'b');
    appendRename(p as never, 'b', 'c');
    const chain = renameChain(p as never);
    assert.equal(chain.get('a'), 'c', 'mắt xích ĐẦU phải nhảy thẳng tới đích cuối');
    assert.equal(chain.get('b'), 'c');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('renameChain: ba lần đổi tên vẫn gộp về một đích', () => {
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

test('🔴 readUsage: BỎ QUA dòng đổi tên — nếu không tổng tiền thành NaN', () => {
  // Sổ giờ chứa HAI loại dòng. Bản ghi đổi tên không có `cost_usd`, nên lọt vào
  // phép cộng là `tasks` đếm dư và tổng tiền hỏng — một cuốn sổ nói dối.
  const p = tmpPaths();
  try {
    spend(p, 'bao-cao', 0.5);
    appendRename(p as never, 'bao-cao', 'kiem-ke');
    spend(p, 'kiem-ke', 0.25);

    const recs = readUsage(p as never);
    assert.equal(recs.length, 2, 'chỉ đếm hai lượt chạy thật');
    const total = recs.reduce((n, r) => n + r.cost_usd, 0);
    assert.ok(Number.isFinite(total), 'tổng phải là số, không được NaN');
    assert.equal(Math.round(total * 100) / 100, 0.75);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('gộp qua alias: tiền TRƯỚC và SAU khi đổi tên về cùng một mục', () => {
  const p = tmpPaths();
  try {
    spend(p, 'bao-cao', 0.5);
    spend(p, 'bao-cao', 0.25);
    appendRename(p as never, 'bao-cao', 'kiem-ke');
    spend(p, 'kiem-ke', 0.25);

    // Đúng phép gộp mà `Company.costByOffice` làm.
    const chain = renameChain(p as never);
    const byOffice = new Map<string, number>();
    for (const r of readUsage(p as never)) {
      const key = (r.office && (chain.get(r.office) ?? r.office)) || '';
      byOffice.set(key, (byOffice.get(key) ?? 0) + r.cost_usd);
    }

    assert.equal(byOffice.size, 1, 'KHÔNG được tách thành hai mục');
    assert.equal(Math.round((byOffice.get('kiem-ke') ?? 0) * 100) / 100, 1);
    assert.equal(byOffice.has('bao-cao'), false, 'id cũ không được hiện thành văn phòng "đã xoá"');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('renameChain: dòng hỏng trong sổ không làm sập gì cả', () => {
  const p = tmpPaths();
  try {
    spend(p, 'bao-cao', 1);
    fs.appendFileSync(p.usageLog, '{"kind":"office.renamed"  KHONG PHAI JSON\n', 'utf8');
    fs.appendFileSync(p.usageLog, '{"kind":"office.renamed","from":"x"}\n', 'utf8'); // thiếu `to`
    appendRename(p as never, 'bao-cao', 'kiem-ke');
    const chain = renameChain(p as never);
    assert.equal(chain.get('bao-cao'), 'kiem-ke');
    assert.equal(chain.has('x'), false, 'bản ghi thiếu trường thì bỏ, không đoán');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});
