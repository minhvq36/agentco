/**
 * Test cho hai chốt chạy TRƯỚC khi phóng worker đầu tiên (19/08 vòng hai).
 *
 * Cả hai đều thi hành cùng một câu hỏi: *sạn trong kế hoạch có QUAN SÁT ĐƯỢC
 * không?* Nếu có thì đừng nhờ model nhìn hộ — và nhất là đừng đợi tới lúc chạy
 * xong mới phát hiện, vì lúc đó tiền đã tiêu rồi.
 *
 *  · `linkDeps`    — task đọc kết quả task khác mà quên `deps` → SỬA
 *  · `validate`    — đầu vào trỏ vào hư không → CHẶN
 *  · `withinRoots` — Trợ lý chỉ được tìm ở nơi nó có quyền
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Scheduler } from '../dist/core/scheduler.js';

type Plan = Parameters<typeof Scheduler.linkDeps>[0];

const task = (id: string, patch: Record<string, unknown> = {}) => ({
  task_id: id,
  role: 'writer',
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

const file = (p: string) => ({ kind: 'file' as const, path: p });
const ROLES = new Set(['writer', 'reviewer']);

// ────────────────────────────────────────────────────────────── linkDeps

/**
 * ĐÂY LÀ RACE CONDITION IM LẶNG.
 *
 * `deps: []` nghĩa là "chạy song song được", nên T-02 được phóng cùng lúc T-01
 * rồi đọc một file T-01 chưa kịp ghi. Nhân viên không báo lỗi — nó tự xoay sở
 * và trả về thứ trông vẫn hợp lý.
 */
test('linkDeps: task đọc output của task khác thì tự nối dây', () => {
  const p = plan([
    task('T-01', { outputs: [file('artifacts/P/T-01/bai.md')] }),
    task('T-02', { inputs: [file('artifacts/P/T-01/bai.md')] }),
  ]);
  assert.deepEqual(Scheduler.linkDeps(p), ['T-02 → T-01']);
  assert.deepEqual(p.tasks[1]!.deps, ['T-01']);
});

test('linkDeps: đường dẫn viết khác kiểu vẫn phải khớp', () => {
  // Model viết `outputs` và `inputs` ở hai chỗ khác nhau trong cùng khối JSON,
  // nên `./` thừa hay dấu gạch ngược là chuyện thường. So chuỗi thô thì cơ chế
  // này im lặng không chạy — đúng loại hỏng khó thấy nhất.
  const p = plan([
    task('T-01', { outputs: [file('artifacts/P/T-01/bai.md')] }),
    task('T-02', { inputs: [file('./artifacts\\P\\T-01\\bai.md')] }),
  ]);
  assert.equal(Scheduler.linkDeps(p).length, 1);
});

test('linkDeps: đã khai deps rồi thì không nối lại', () => {
  const p = plan([
    task('T-01', { outputs: [file('a.md')] }),
    task('T-02', { inputs: [file('a.md')], deps: ['T-01'] }),
  ]);
  assert.deepEqual(Scheduler.linkDeps(p), []);
});

test('linkDeps: task đọc chính output của mình thì KHÔNG tự phụ thuộc chính nó', () => {
  // Ca thật: "sửa lại file X" — task vừa đọc vừa ghi cùng một đường dẫn.
  const p = plan([task('T-01', { inputs: [file('a.md')], outputs: [file('a.md')] })]);
  assert.deepEqual(Scheduler.linkDeps(p), []);
  assert.deepEqual(p.tasks[0]!.deps, []);
});

/**
 * Nối dây CÓ THỂ đẻ ra chu trình (hai task đọc kết quả của nhau). Đó là lý do
 * `linkDeps` phải chạy TRƯỚC `validate`, không phải sau — `validate` là chỗ bắt.
 */
test('linkDeps chạy trước validate: chu trình do nối dây sinh ra vẫn bị bắt', () => {
  const p = plan([
    task('T-01', { inputs: [file('b.md')], outputs: [file('a.md')] }),
    task('T-02', { inputs: [file('a.md')], outputs: [file('b.md')] }),
  ]);
  Scheduler.linkDeps(p);
  const problems = Scheduler.validate(p, ROLES);
  assert.ok(
    problems.some((x) => x.includes('vòng tròn')),
    `phải bắt được chu trình, nhận: ${problems.join(' | ')}`,
  );
});

// ────────────────────────────────────────────────────────────── validate

test('validate: đầu vào KHÔNG có trên đĩa và không việc nào tạo ra thì chặn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    const p = plan([task('T-01', { inputs: [file('library/files/khong-co.md')] })]);
    const problems = Scheduler.validate(p, ROLES, dir);
    assert.equal(problems.length, 1);
    // Câu lỗi phải nêu ĐÚNG tên file — không nêu thì người dùng không sửa được.
    assert.ok(problems[0]!.includes('library/files/khong-co.md'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate: đầu vào CÓ trên đĩa thì cho qua', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    fs.mkdirSync(path.join(dir, 'library', 'files'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'library', 'files', 'doi-tra.md'), 'x');
    const p = plan([task('T-01', { inputs: [file('library/files/doi-tra.md')] })]);
    assert.deepEqual(Scheduler.validate(p, ROLES, dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate: đầu vào do task KHÁC sinh ra thì không đòi phải có sẵn trên đĩa', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    const p = plan([
      task('T-01', { outputs: [file('artifacts/P/T-01/bai.md')] }),
      task('T-02', { inputs: [file('artifacts/P/T-01/bai.md')], deps: ['T-01'] }),
    ]);
    assert.deepEqual(Scheduler.validate(p, ROLES, dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate: không truyền officeDir thì bỏ qua kiểm đĩa, các kiểm khác vẫn chạy', () => {
  const p = plan([task('T-01', { role: 'khong-co-ai' })]);
  assert.equal(Scheduler.validate(p, ROLES).length, 1);
});

/*
 * Test cho `withinRoots` đã BỎ cùng với chính hàm đó (19/08).
 *
 * Nó canh cổng cho `Grep`/`Glob` của Trợ lý — mà ba cơ chế chặn của SDK đều
 * không nổ, nên khả năng đó bị thu lại và hàm thành mã chết. Giữ test cho mã
 * chết còn tệ hơn không có test: nó báo một vùng an toàn không tồn tại.
 * → SPEC-offices.md §4.7
 */
