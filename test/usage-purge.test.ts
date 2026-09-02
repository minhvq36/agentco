/**
 * Test cho ĐÓNG SỔ KHI XOÁ VĂN PHÒNG. → `usage.ts §PurgeRecord` · `company.ts §removeOffice`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUG USER BÁO 02/09 — HAI TRIỆU CHỨNG, MỘT NGUYÊN NHÂN.                   │
 * │                                                                          │
 * │  ① *"Tôi xoá hết văn phòng, nó vẫn lưu số $ orphan (14 mục không còn)"*   │
 * │  ② *"Xoá văn phòng Nội dung rồi lập lại Nội dung khác, nó VẪN NHỚ số      │
 * │     lượt, $ token"* ← nặng hơn hẳn, và im lặng hoàn toàn                  │
 * │                                                                          │
 * │ Nguyên nhân: `removeOffice` chỉ `rm -rf` thư mục, `logs/usage.jsonl` nằm │
 * │ ở cấp CÔNG TY nên không đi theo. Cộng với `createOffice` suy id từ TÊN   │
 * │ (`folderId`) ⇒ văn phòng mới trùng tên = trùng id = thừa kế sổ.          │
 * │                                                                          │
 * │ Chỗ sai thì SỐ TIỀN trên màn hình sai, nên nó có test trước giao diện.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

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

/** Một lượt chạy, ghi vào sổ tại đúng mốc `at`. */
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

// ────────────────────────────────────────────────────────── mốc cắt

test('purge: dòng TRƯỚC mốc biến mất, dòng SAU mốc còn nguyên', () => {
  const p = tmpPaths();
  try {
    spend(p, 'noi-dung', 1, T0);
    appendPurge(p as never, 'noi-dung', T1);
    spend(p, 'noi-dung', 5, T2);

    const rows = readUsage(p as never);
    assert.equal(rows.length, 1, 'chỉ dòng sau mốc được giữ');
    assert.equal(rows[0]?.cost_usd, 5);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('purge: bản ghi mốc KHÔNG bị đếm thành một việc (sổ không nói dối)', () => {
  const p = tmpPaths();
  try {
    spend(p, 'a', 2, T2);
    appendPurge(p as never, 'b', T1);
    const rows = readUsage(p as never);
    assert.equal(rows.length, 1, 'dòng `kind` không được lọt vào danh sách việc');
    assert.ok(Number.isFinite(total(p)), 'tổng tiền không được thành NaN');
    assert.equal(total(p), 2);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('purge: văn phòng KHÁC không bị đụng', () => {
  const p = tmpPaths();
  try {
    spend(p, 'noi-dung', 1, T0);
    spend(p, 'ke-toan', 7, T0);
    appendPurge(p as never, 'noi-dung', T1);
    assert.equal(total(p), 7);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('purge: khối bản ghi v0 (office rỗng) cũng dọn được', () => {
  // Nó nằm chung khối "không còn" trên màn hình, nên "Dọn hết" phải với tới.
  const p = tmpPaths();
  try {
    spend(p, '', 3, T0);
    appendPurge(p as never, '', T1);
    assert.equal(readUsage(p as never).length, 0);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────── hai danh tính, hai chiều hở

test('🔴 purge: ĐỔI TÊN rồi xoá — dòng mang id CŨ cũng phải biến', () => {
  // `a→b` rồi xoá `b`: dòng trong sổ mang `a`, mốc ghi ở `b`. Chỉ so id thô là
  // tiền của thời `a` ở lại, và nó ở lại dưới một cái tên không còn ai nhận.
  const p = tmpPaths();
  try {
    spend(p, 'bao-cao', 4, T0);
    appendRename(p as never, 'bao-cao', 'kiem-ke');
    spend(p, 'kiem-ke', 6, T0);
    appendPurge(p as never, 'kiem-ke', T1);

    assert.equal(readUsage(p as never).length, 0, 'cả hai đời của cùng một văn phòng phải sạch');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('🔴 purge: xoá `a` → lập lại `a` → đổi tên `a→c`, tiền người chết KHÔNG chảy sang `c`', () => {
  /*
    Ca ngược của ca trên, và nó chỉ hở khi ta "sửa cho gọn" bằng cách chỉ so id
    ĐÃ GIẢI: dòng đời trước mang `a`, chuỗi đổi tên nay trỏ `a → c`, nên nếu chỉ
    tra mốc ở `c` thì không thấy gì và dòng cũ sống lại trong sổ của `c`.
    Sửa một chiều mà quên chiều kia là đổi lỗi này lấy lỗi kia.
  */
  const p = tmpPaths();
  try {
    spend(p, 'a', 9, T0); // đời thứ nhất
    appendPurge(p as never, 'a', T1); // xoá
    spend(p, 'a', 2, T2); // đời thứ hai, cùng id vì cùng tên
    appendRename(p as never, 'a', 'c'); // rồi đổi tên

    const rows = readUsage(p as never);
    assert.equal(rows.length, 1, 'chỉ đời thứ hai còn trong sổ');
    assert.equal(rows[0]?.cost_usd, 2, 'không được cộng $9 của đời trước');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('purge: xoá hai lần thì lấy mốc MUỘN NHẤT', () => {
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

// ─────────────────────────────────────────────── ngược chiều: đừng ăn quá phần

test('🔴 purge: KHÔNG có mốc nào thì sổ y hệt như trước (bản vá không ăn quá phần)', () => {
  // Nửa còn lại của bất biến: một bản vá dọn được rác mà cũng dọn luôn dữ liệu
  // sống thì hỏng im lặng hơn hẳn cái nó vừa sửa.
  const p = tmpPaths();
  try {
    spend(p, 'noi-dung', 1, T0);
    spend(p, 'ke-toan', 2, T1);
    spend(p, '', 3, T2);
    assert.equal(readUsage(p as never).length, 3);
    assert.equal(total(p), 6);
    assert.equal(purgeCuts(p as never).size, 0);
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

test('purge: `--since` vẫn chạy đúng sau khi có mốc cắt', () => {
  const p = tmpPaths();
  try {
    spend(p, 'a', 1, new Date(Date.now() - 60 * 60_000)); // một giờ trước
    spend(p, 'a', 2, new Date()); // vừa xong
    assert.equal(readUsage(p as never, 10 * 60_000).length, 1, 'cửa sổ 10 phút chỉ thấy dòng mới');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────── tiền đề của cả bug: id suy từ TÊN

test('🔴 tiền đề: hai văn phòng cùng TÊN cho cùng một MÃ — nên sổ phải cắt theo MỐC', () => {
  /*
    Đây là thứ làm triệu chứng ② tồn tại. Nếu ngày nào đó `createOffice` đổi
    sang mã ngẫu nhiên thì test này đỏ, và đó là lúc phải đọc lại cả cơ chế cắt
    — không phải lúc sửa con số cho nó xanh lại.
  */
  assert.equal(folderId('Nội dung'), folderId('Nội dung'));
  assert.equal(folderId('Nội dung'), 'noi-dung');
});
