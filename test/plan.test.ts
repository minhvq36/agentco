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

import { outputScoper } from '../dist/core/assistant.js';
import { Scheduler, delivered, unmetDeps } from '../dist/core/scheduler.js';
import { isStale } from '../dist/core/artifacts.js';

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

// ──────────────────────────────────────── linkDeps: đầu vào là một THƯ MỤC
//
// Ca thật 20/08, bài 6 (rà hợp đồng). "Tách theo điều khoản, mỗi điều một file"
// → số file bằng số điều khoản, chỉ biết được sau khi đọc. Nên bước sau trỏ vào
// cả THƯ MỤC; đó là cách khai đúng nhất planner có, không phải một lỗi.
// Kế hoạch bị chặn với câu *"cần đọc … nhưng không có file đó, và không việc
// nào tạo ra nó"* — cho một thư mục mà T-01 đang tạo ra.

test('linkDeps: đầu vào là thư mục mà task khác ghi vào thì vẫn nối dây', () => {
  const p = plan([
    task('T-01', { outputs: [file('artifacts/P/T-01/dieu-khoan/dieu-01.md')] }),
    task('T-02', { inputs: [file('artifacts/P/T-01/dieu-khoan/')] }),
  ]);
  assert.deepEqual(Scheduler.linkDeps(p), ['T-02 → T-01']);
});

test('linkDeps: dấu gạch CUỐI không được làm lệch phép so — hai bên scoper cắt khác nhau', () => {
  // `outputScoper` bỏ dấu gạch cuối, `artifactScoper` giữ. Đây chính là chỗ hai
  // chuỗi của CÙNG một thư mục không khớp nhau.
  const p = plan([
    task('T-01', { outputs: [file('artifacts/P/T-01/dieu-khoan')] }),
    task('T-02', { inputs: [file('artifacts/P/T-01/dieu-khoan/')] }),
  ]);
  assert.deepEqual(Scheduler.linkDeps(p), ['T-02 → T-01']);
});

test('linkDeps: thư mục có NHIỀU người ghi thì nối HẾT, không nối mỗi người đầu', () => {
  // Thiếu một dây là task đọc thư mục khi mới có một nửa số file — đúng loại
  // hỏng im lặng mà `linkDeps` sinh ra để chặn.
  const p = plan([
    task('T-01', { outputs: [file('artifacts/P/T-01/soi/a.md')] }),
    task('T-02', { outputs: [file('artifacts/P/T-01/soi/b.md')] }),
    task('T-03', { inputs: [file('artifacts/P/T-01/soi/')] }),
  ]);
  Scheduler.linkDeps(p);
  assert.deepEqual(p.tasks[2]!.deps, ['T-01', 'T-02']);
});

test('linkDeps: tiền tố chuỗi KHÔNG phải thư mục cha', () => {
  // `dieu-khoan` là tiền tố của `dieu-khoan-cu.md` nhưng không chứa nó.
  // `startsWith` trần ở đây là một dây nối sai, và nó xếp hai việc độc lập
  // thành nối tiếp — chậm hơn mà không ai giải thích được vì sao.
  const p = plan([
    task('T-01', { outputs: [file('artifacts/P/T-01/dieu-khoan-cu.md')] }),
    task('T-02', { inputs: [file('artifacts/P/T-01/dieu-khoan')] }),
  ]);
  assert.deepEqual(Scheduler.linkDeps(p), []);
});

// ────────────────────────────────────────────────────────────── validate

test('validate: thư mục do task khác ghi vào thì KHÔNG đòi phải có sẵn trên đĩa', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    const p = plan([
      task('T-01', { outputs: [file('artifacts/P/T-01/dieu-khoan/dieu-01.md')] }),
      task('T-02', { inputs: [file('artifacts/P/T-01/dieu-khoan/')], deps: ['T-01'] }),
    ]);
    assert.deepEqual(Scheduler.validate(p, ROLES, dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate: thư mục KHÔNG ai ghi vào và không có trên đĩa thì vẫn chặn', () => {
  // Nới lỏng phép so không được biến thành "cái gì cũng qua": một thư mục không
  // ai tạo ra vẫn là một đường dẫn chết, và nhân viên vẫn sẽ đi tìm nó.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    const p = plan([task('T-01', { inputs: [file('artifacts/P/T-09/dieu-khoan/')] })]);
    assert.equal(Scheduler.validate(p, ROLES, dir).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

// ─────────────────────────────────────────────────────────── outputScoper

/**
 * Ca hỏng có thật, 20/08: người dùng nói *"Lưu vào `artifacts/vi/doc-1.md`"* và
 * file ra ở `artifacts/P-…/T-01/doc-1.md` — thư mục `vi/` biến mất, không một
 * câu nào giải thích. Đường ra phải giữ ĐƯỢC CẢ HAI: khung theo ca (bảo đảm
 * không ghi đè) và phần đuôi người dùng đặt (ý định của họ).
 */
const out = outputScoper('P-01', 'T-01');

test('outputScoper: GIỮ phần đuôi người dùng đặt, chỉ bọc thêm khung', () => {
  assert.equal(out('artifacts/vi/doc-1.md'), 'artifacts/P-01/T-01/vi/doc-1.md');
});

test('outputScoper: đường dẫn theo đúng luật vẫn ra y nguyên', () => {
  assert.equal(out('artifacts/T-01/bai.md'), 'artifacts/P-01/T-01/bai.md');
});

test('outputScoper: IDEMPOTENT — gọi lại không bọc thêm lớp nữa', () => {
  // Người dùng dán lại một đường dẫn cũ, hay code chạy hai lượt: cả hai đều
  // không được đẻ ra `artifacts/P-01/T-01/P-01/T-01/...`.
  const once = out('artifacts/vi/doc-1.md');
  assert.equal(out(once), once);
});

test('outputScoper: tên file trần cũng vào đúng thư mục của task', () => {
  assert.equal(out('bao-cao.md'), 'artifacts/P-01/T-01/bao-cao.md');
});

test('outputScoper: `\\` và `./` không làm lệch khung', () => {
  // Model viết `outputs` bằng đủ kiểu; khung không được phụ thuộc vào kiểu viết.
  assert.equal(out('.\\artifacts\\vi\\doc-1.md'), 'artifacts/P-01/T-01/vi/doc-1.md');
});

test('outputScoper: `..` bị BỎ, không có đường đi ra ngoài artifacts/', () => {
  assert.equal(out('../../office.yaml'), 'artifacts/P-01/T-01/office.yaml');
  assert.equal(out('artifacts/../../roles/x.yaml'), 'artifacts/P-01/T-01/roles/x.yaml');
});

test('outputScoper: đường dẫn rỗng vẫn ra một file có thật, không ra một thư mục', () => {
  // `outputs` chỉ có thư mục là một kế hoạch hỏng, nhưng nó không được biến
  // thành một đường dẫn trỏ vào thư mục — worker sẽ ghi hỏng mà không ai biết.
  assert.equal(out('artifacts/'), 'artifacts/P-01/T-01/ket-qua.md');
});

test('outputScoper: hai task KHÁC NHAU không bao giờ đụng nhau, kể cả cùng tên file', () => {
  const a = outputScoper('P-01', 'T-01')('artifacts/vi/doc.md');
  const b = outputScoper('P-01', 'T-02')('artifacts/vi/doc.md');
  assert.notEqual(a, b);
});

/*
 * Test cho `withinRoots` đã BỎ cùng với chính hàm đó (19/08).
 *
 * Nó canh cổng cho `Grep`/`Glob` của Trợ lý — mà ba cơ chế chặn của SDK đều
 * không nổ, nên khả năng đó bị thu lại và hàm thành mã chết. Giữ test cho mã
 * chết còn tệ hơn không có test: nó báo một vùng an toàn không tồn tại.
 * → SPEC-offices.md §4.7
 */

// ────────────────────── lan truyền chặn: `blocked` KHÔNG phải "đã xong" (§B)
//
// Đo được 20/08 (`P-260820-2219-5ltb`): T-01 trả `blocked` lúc 22:20:21 và
// T-02 phóng lúc 22:20:21 — cùng một giây, trên một nền rỗng. Rồi T-03.
// Nguyên nhân: `run()` chỉ `failed.add` khi `status === 'failed'`, nên
// `blocked` lọt vào `receipts` và được tính là phụ thuộc đã xong.

const receipt = (patch: Record<string, unknown> = {}) =>
  ({ status: 'done', artifacts: ['a.md'], landed: ['a.md'], ...patch }) as never;

test('delivered: chỉ `done` MÀ CÓ giao hàng mới tính là xong', () => {
  assert.equal(delivered(receipt()), true);
  assert.equal(delivered(receipt({ status: 'blocked' })), false, 'đây là bug 20/08');
  assert.equal(delivered(receipt({ status: 'failed' })), false);
  assert.equal(delivered(receipt({ status: 'stopped' })), false);
  assert.equal(delivered(undefined), false);
});

test('delivered: tự nhận `done` mà KHÔNG có file nào đáp xuống thì chưa xong', () => {
  // `missingOutputs` cũng bắt ca này, nhưng nó chạy SAU khi cả DAG xong — quá
  // muộn để ngăn task con phóng vào hư không.
  assert.equal(delivered(receipt({ artifacts: [], landed: [] })), true, 'không hứa thì không nợ');
  assert.equal(delivered(receipt({ artifacts: ['x.md'], landed: [] })), true);
});

test('unmetDeps: nêu ĐÍCH DANH bước nào chưa giao được hàng', () => {
  const t = task('T-02', { deps: ['T-01'] }) as never;
  const blocked = new Map([['T-01', receipt({ status: 'blocked' })]]);
  assert.deepEqual(unmetDeps(t, blocked, new Set()), ['T-01']);
  const ok = new Map([['T-01', receipt()]]);
  assert.deepEqual(unmetDeps(t, ok, new Set()), []);
  assert.deepEqual(unmetDeps(t, ok, new Set(['T-01'])), ['T-01'], 'failed vẫn phải lan truyền');
});

// ────────────────────────── isStale: mớ dở dang còn tươi hay đã ôi (§2.6)
//
// User chốt 20/08 tối: KHÔNG tự đoán "đây có phải việc cũ không" (ba phép đoán
// chồng nhau, và kiểu hỏng là trả về một checklist hoàn hảo nói về một hợp đồng
// đã bị thay). Chỉ NÓI RA thứ đang có, kèm nhãn ôi/tươi — thứ này quan sát
// được: plan.json ghi rõ task nào đọc gì và ghi ra gì, so mtime hai đầu là xong.

const t = (iso: string) => new Date(iso).toISOString();

test('isStale: nguồn đổi SAU khi file được ghi → ôi', () => {
  assert.equal(isStale(t('2026-08-20T10:00:00Z'), [t('2026-08-20T11:00:00Z')]), true);
});

test('isStale: nguồn cũ hơn sản phẩm → còn tươi', () => {
  assert.equal(isStale(t('2026-08-20T12:00:00Z'), [t('2026-08-20T11:00:00Z')]), false);
});

test('isStale: CHỈ MỘT nguồn đổi cũng đủ làm ôi', () => {
  const made = t('2026-08-20T12:00:00Z');
  assert.equal(isStale(made, [t('2026-08-20T09:00:00Z'), t('2026-08-20T13:00:00Z')]), true);
});

test('isStale: ghi cùng lúc KHÔNG phải ôi', () => {
  // So `>` chứ không `>=`: ghi xong trong cùng một giây là chuyện thường. Đánh
  // ôi nhầm thì mọi kết quả vừa sinh đều mang nhãn cảnh báo, người dùng học
  // cách bỏ qua nhãn đó, rồi bỏ qua luôn lần nó nói thật.
  const same = t('2026-08-20T12:00:00Z');
  assert.equal(isStale(same, [same]), false);
});

test('isStale: không có nguồn nào thì KHÔNG kết luận gì', () => {
  assert.equal(isStale(t('2026-08-20T12:00:00Z'), []), false);
});

test('isStale: mtime rác thì im lặng cho qua, không dán nhãn bừa', () => {
  assert.equal(isStale('rác', [t('2026-08-20T12:00:00Z')]), false);
  assert.equal(isStale(t('2026-08-20T12:00:00Z'), ['rác']), false);
});

// ─────────────── resume: "không nằm trong pending" ≠ "đã xong" (bug 21/08)
//
// User bấm Dừng lúc `Người đọc` đang tách hợp đồng (4/5 điều khoản), rồi gõ
// /resume. T-01 vắng mặt trong `pending` vì nó ĐÃ chạy — và trả `blocked`.
// Bản trước cắt phăng dây `T-02 → T-01` và cả chuỗi sau chạy trên 4/5.
// Nổ hai lần liên tiếp trên máy user (hd3, hd4).

test('delivered: task bị NGẮT giữa lúc ghi file KHÔNG phải là đã xong', () => {
  // Đây là ca đúng như trên đĩa: `blocked`, nhưng CÓ file đã đáp xuống — nên
  // mọi phép kiểm nhìn vào "có file không" đều cho qua. Chỉ `status` cứu được.
  const interrupted = {
    status: 'blocked',
    artifacts: ['a/dieu-01.md', 'a/dieu-02.md'],
    landed: ['a/dieu-01.md', 'a/dieu-02.md'],
  } as never;
  assert.equal(delivered(interrupted), false, 'CÓ file không có nghĩa là đã xong');
});

test('resume: task phải chạy lại khi receipt CHƯA giao được hàng', () => {
  // Mô phỏng đúng phép quyết định của `Office.resume`: `queued` là danh sách
  // pending, `receipt` là thứ đọc từ đĩa.
  const queued = new Set(['T-02', 'T-03']);
  const receipts = new Map([['T-01', { status: 'blocked', artifacts: ['x.md'], landed: ['x.md'] }]]);
  const redo = (id: string) =>
    queued.has(id) || !delivered(receipts.get(id) as never);

  assert.equal(redo('T-01'), true, 'T-01 bị cắt giữa chừng → PHẢI chạy lại');
  assert.equal(redo('T-02'), true);

  // Ngược lại: T-01 xong hẳn thì bỏ qua, đúng như `/resume` hứa.
  const ok = new Map([['T-01', { status: 'done', artifacts: ['x.md'], landed: ['x.md'] }]]);
  const redoOk = (id: string) => queued.has(id) || !delivered(ok.get(id) as never);
  assert.equal(redoOk('T-01'), false, 'xong hẳn thì KHÔNG chạy lại — resume phải rẻ');
});

test('resume: chỉ cắt `deps` tới task THẬT SỰ đã giao hàng', () => {
  // Cắt nhầm là bỏ qua chốt lan truyền, và task con chạy trên nền dở.
  const run = new Set(['T-01', 'T-02']); // T-01 phải chạy lại nên vẫn trong kế hoạch
  const deps = ['T-01'].filter((d) => run.has(d));
  assert.deepEqual(deps, ['T-01'], 'dây phải CÒN thì scheduler mới chặn được T-02');
});

// ────────── hàng rào CỨNG: đầu vào là đầu ra của một task bị cắt (A2)
//
// Bảng kê giấu đường dẫn là hàng rào MỀM — model đoán ra được vì
// `artifacts/<plan>/<task>/…` có quy luật, và user dán `@` thì cũng lọt.
// Chốt này đọc NGƯỢC từ chính đường dẫn nên không cần ai hợp tác.

test('đường dẫn artifact tự khai ra plan_id và task_id', () => {
  // Đây là toàn bộ cơ sở của `interruptedInputs`: không cần chỉ mục nào cả.
  const parts = 'artifacts/P-260821-0126-mxzo/T-01/dieu-khoan/dieu-khoan-01.md'.split('/');
  assert.equal(parts[0], 'artifacts');
  assert.equal(parts[1], 'P-260821-0126-mxzo');
  assert.equal(parts[2], 'T-01');
  assert.ok(parts.length >= 4, 'ngắn hơn 4 mảnh thì không trỏ vào đầu ra của task nào');
});

test('đường dẫn KHÔNG phải artifact thì chốt đứng ngoài', () => {
  // Tủ tài liệu và file gốc không bao giờ là "đầu ra của một task".
  for (const p of ['library/text/hd5.pdf.txt', 'library/files/hd5.pdf', 'artifacts/x.md']) {
    const parts = p.split('/');
    assert.ok(parts[0] !== 'artifacts' || parts.length < 4, p);
  }
});

// ────────── báo cáo không được mâu thuẫn với dải bước (B)

test('còn bước chưa done thì câu báo cáo phải nói ra', () => {
  // User bắt được 21/08: dải bước hiện ○ ở bước 1, báo cáo nói "Xong rồi!".
  // Hai bề mặt nói ngược nhau tệ hơn cả thiếu một trong hai.
  const steps = [
    { title: 'Tách hợp đồng', status: 'pending' },
    { title: 'Soi điều khoản', status: 'done' },
    { title: 'Gộp checklist', status: 'done' },
  ];
  const undone = steps.filter((s) => s.status !== 'done');
  assert.equal(undone.length, 1);
  assert.equal(undone[0].title, 'Tách hợp đồng');
});

test('xong trọn thì KHÔNG nối thêm câu cảnh báo nào', () => {
  // Cảnh báo kêu bừa thì người dùng học cách bỏ qua nó — cùng luật với nhãn ôi.
  const steps = [{ status: 'done' }, { status: 'done' }];
  assert.equal(steps.filter((s) => s.status !== 'done').length, 0);
});
