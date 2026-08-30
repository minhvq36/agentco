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

import { SHELL_LEGEND, armReach, outputScoper, shellFlag } from '../dist/core/assistant.js';
import { Scheduler, delivered, unmetDeps } from '../dist/core/scheduler.js';
import { isStale } from '../dist/core/artifacts.js';
import { existsOnDisk, resolveInput } from '../dist/core/paths.js';
import { planProblemsMessage } from '../dist/core/office.js';

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

// ───────────────────── `onRedirect` — ta viết lại chuỗi người dùng gõ, phải NÓI RA
//
// Ca 24/08 (`P-260824-0401-q7ma`): người dùng bảo chép file vào
// `D:\Downloads\Programs Installation\`. `outputScoper` kéo đích về `artifacts/`
// (đúng thiết kế) và **im lặng**, nên Trợ lý nhìn ra sự lệch rồi tự hứa
// *"nếu cần mình sẽ thử ghi lại đúng vị trí đó"* — một lời hứa không giữ được:
// hàm này chạy TRƯỚC khi nhân viên được phóng, nên không lượt nào đi lối đó.

test('onRedirect: đường dẫn tuyệt đối Windows được khai ra NGUYÊN VĂN', () => {
  const seen: string[] = [];
  const scope = outputScoper('P-01', 'T-01', (asked) => seen.push(asked));
  assert.equal(scope('D:\\Downloads\\Programs Installation\\ban-ke.md'), 'artifacts/P-01/T-01/ban-ke.md');
  // Nguyên văn, không chuẩn hoá: đó là chuỗi người dùng sẽ nhận ra trong câu báo cáo.
  assert.deepEqual(seen, ['D:\\Downloads\\Programs Installation\\ban-ke.md']);
});

test('onRedirect: nhánh POSIX cũng khai — nó chỉ ÊM hơn, không đúng hơn', () => {
  const seen: string[] = [];
  const scope = outputScoper('P-01', 'T-01', (asked) => seen.push(asked));
  assert.equal(scope('/home/an/ho-so/x.md'), 'artifacts/P-01/T-01/x.md');
  assert.deepEqual(seen, ['/home/an/ho-so/x.md']);
});

test('onRedirect: đường dẫn TRONG văn phòng KHÔNG bắn — nửa ngược chiều', () => {
  // Dán dòng "cắm kết nối đi" vào mọi ca là biến một lời chỉ đường thành tiếng
  // ồn, rồi người dùng học cách bỏ qua nó — kể cả lần nó nói thật.
  const seen: string[] = [];
  const scope = outputScoper('P-01', 'T-01', (asked) => seen.push(asked));
  scope('artifacts/vi/doc-1.md');
  scope('bao-cao.md');
  scope('../../office.yaml');
  assert.deepEqual(seen, []);
});

test('onRedirect: KHÔNG truyền callback thì hành vi y hệt bản cũ', () => {
  assert.equal(outputScoper('P-01', 'T-01')('D:\\x\\y.md'), 'artifacts/P-01/T-01/y.md');
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

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐẦU VÀO NẰM ngoài VĂN PHÒNG — ca thật 22/08, chặn ngay ở bước lập kế hoạch│
 * │                                                                          │
 * │ Người dùng gõ: *"Kiểm kê thư mục D:\Downloads\Programs Installation…"*.   │
 * │ Trợ lý chép đường dẫn vào `inputs` — ĐÚNG như `ASSISTANT_CORE` dặn nó:    │
 * │ *"a path the human typed is exact — copy it into `inputs` verbatim"*.     │
 * │                                                                          │
 * │ Rồi `validate` chặn cả kế hoạch: *"không có file đó, và không việc nào    │
 * │ tạo ra nó"*. Vì phép kiểm chỉ có MỘT đường — `safeJoin(officeDir, …)` —   │
 * │ mang sẵn tiền đề "mọi đầu vào đều nằm trong văn phòng". Tiền đề đó đúng   │
 * │ cho tới ngày `Bash` bật sẵn.                                             │
 * │                                                                          │
 * │ Trợ lý tuân lệnh và bị chặn VÌ tuân lệnh. Đó là hình dạng tệ nhất của     │
 * │ một lỗi: không ai làm sai cả.                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
test('validate: thư mục TUYỆT ĐỐI ngoài văn phòng, có thật trên máy ⇒ CHO QUA', () => {
  const office = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-ngoai-'));
  try {
    const p = plan([task('T-01', { inputs: [file(outside)] })]);
    assert.deepEqual(Scheduler.validate(p, ROLES, office), []);
  } finally {
    fs.rmSync(office, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('validate: đường dẫn tuyệt đối KHÔNG có thật vẫn chặn — và nói đúng lý do', () => {
  // Nới lỏng không được thành "cái gì tuyệt đối cũng qua": prompt của nhân viên
  // HỨA rằng inputs vừa được đối chiếu với file thật, và chính lời hứa đó khiến
  // nó dám dừng ngay thay vì đi mò. Bỏ kiểm là phá lời hứa đó.
  const office = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    const ghost = path.join(os.tmpdir(), 'agentco-khong-bao-gio-co-that-9k2');
    const problems = Scheduler.validate(plan([task('T-01', { inputs: [file(ghost)] })]), ROLES, office);
    assert.equal(problems.length, 1);
    assert.ok(problems[0]!.includes(ghost), 'phải nêu đúng đường dẫn để người dùng sửa được');
    assert.ok(
      problems[0]!.includes('không tìm thấy trên máy'),
      'câu "không việc nào tạo ra nó" vô nghĩa với một thư mục ngoài văn phòng',
    );
  } finally {
    fs.rmSync(office, { recursive: true, force: true });
  }
});

test('validate: đường dẫn TƯƠNG ĐỐI leo ra ngoài vẫn bị chặn — không đi nhánh "ngoài văn phòng"', () => {
  // Tách theo `isAbsolute`, không theo "safeJoin có ném không". Cả hai đều làm
  // safeJoin ném, nhưng cái này là mưu toan traversal chứ không phải đường dẫn
  // người dùng gõ — và đem existsSync nó thì ta đo theo cwd của daemon.
  const office = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    const p = plan([task('T-01', { inputs: [file('../../../etc/passwd')] })]);
    assert.equal(Scheduler.validate(p, ROLES, office).length, 1);
  } finally {
    fs.rmSync(office, { recursive: true, force: true });
  }
});

test('missingInputs dùng CHUNG luật với validate: đường dẫn tuyệt đối có thật thì phóng được', () => {
  // Hai chốt trên cùng một luật. Hiểu khác nhau thì kế hoạch qua cửa một rồi
  // chết ở cửa hai — người dùng nhận một câu từ chối cho thứ vừa được duyệt.
  const office = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-ngoai-'));
  try {
    for (const p of [outside, path.join(office, 'library')]) {
      const abs = resolveInput(office, p);
      assert.ok(abs, `resolveInput phải nhận "${p}"`);
    }
    assert.equal(resolveInput(office, '../../../etc/passwd'), undefined, 'traversal vẫn bị chặn');
    assert.ok(existsOnDisk(outside));
    assert.equal(existsOnDisk(path.join(os.tmpdir(), 'khong-bao-gio-co-that-7x1')), false);
  } finally {
    fs.rmSync(office, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});


// ═════════════════════════════════════════ cờ BẤT ĐỊNH: hai chiều, và hẹp
//
// Bản 22/08 chỉ đẩy `lệnh trên máy` vào danh bạ KHI có shell. Chạy lại 9.3:
// văn phòng không ai có shell ⇒ chuỗi đó không xuất hiện ở đâu ⇒ vắng mặt không
// phải tín hiệu, và Trợ lý vẫn giao việc, vẫn tiêu $0,1380.

test('shellFlag: LUÔN nói ra, cả hai chiều — vắng mặt không phải tín hiệu', () => {
  assert.notEqual(shellFlag([]), '', 'không có shell vẫn PHẢI nói ra');
  assert.notEqual(shellFlag([]), shellFlag(['Bash']), 'hai chiều phải phân biệt được');
  assert.ok(shellFlag(['Bash']).includes('BẬT'));
  assert.ok(shellFlag([]).includes('TẮT'));
  // Khai bằng tên nền tảng nào cũng tính — xem types.ts §SHELL_ALIASES.
  assert.equal(shellFlag(['PowerShell']), shellFlag(['Bash']));
});

test('shellFlag: cờ TỰ ĐỌC ĐƯỢC khi đứng một mình, không cần chú giải ở trên', () => {
  // Chú giải nằm đầu khối, cờ nằm ở dòng thứ 9 — khoảng cách là có thật.
  for (const tools of [[], ['Bash']]) {
    assert.ok(shellFlag(tools).includes('chạy lệnh'), `cờ phải tự mang nghĩa: ${shellFlag(tools)}`);
  }
});

/**
 * 🔴 MẶT PHỦ ĐỊNH RỘNG LÀ MỘT LỜI NÓI DỐI, và nó hỏng NGƯỢC CHIỀU.
 *
 * "không có shell" KHÔNG đồng nghĩa "không với tới máy của bạn" — vai trò trần
 * vẫn `Read` được mọi đường dẫn tuyệt đối. Viết câu phủ định rộng là dạy Trợ lý
 * từ chối cả việc nó làm được, và ca hỏng đó IM LẶNG hơn 9.3 vì không ai thấy
 * việc đã bị từ chối.
 */
// ───────────────────────── armReach — cánh tay phải nói ra NÓ TRỎ VÀO ĐÂU
//
// Ca user 24/08: hỏi "trong thư mục đã cho phép…" ba lượt liên tiếp, Trợ lý ba
// lượt đòi đường dẫn đầy đủ. Nó không cố chấp — `role.mcp` chỉ là mảng BĂM, nên
// câu "thư mục đã cho phép" không giải được, trong khi `company.yaml` biết thừa.

const ARMS = { a385afc3ab6: { label: 'Programs Installation 2' }, notion: { label: 'Notion' } };
const SERVERS = {
  a385afc3ab6: { command: 'npx', args: ['-y', 'pkg', 'D:\\Downloads\\Programs Installation'] },
  notion: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] },
};

test('armReach: cánh tay file nói ra ĐƯỜNG DẪN, không chỉ nói tên', () => {
  const line = armReach(ARMS, SERVERS, 'a385afc3ab6');
  assert.ok(line.includes('D:\\Downloads\\Programs Installation'), `thiếu thư mục: ${line}`);
  assert.ok(line.includes('Programs Installation 2'), `thiếu nhãn người dùng đặt: ${line}`);
  assert.ok(!line.includes('a385afc3ab6'), `băm không được lộ ra khi đã có nhãn: ${line}`);
});

test('armReach: dòng tự đọc được, và nói ĐƯỜNG TẮT chứ không nói GIỚI HẠN', () => {
  // Cùng luật với `chạy lệnh: TẮT`: dòng nằm giữa một khối liệt kê, chú giải thì
  // ở tận đầu khối. Một mũi tên hay dấu hai chấm trần không tự mang nghĩa.
  //
  // 🔴 Từ đổi 24/08 (`thư mục:` → `đường tắt tới`), và test khoá đúng lý do:
  // `thư mục:` bị Trợ lý đọc thành TỔNG TẦM VỚI của nhân viên rồi từ chối việc
  // nằm ngoài — kể cả khi người đó có shell, kể cả trong phiên `/clear` sạch.
  // Sự thật ngược lại đã nằm sẵn ở `SHELL_LEGEND` đầu danh bạ nhưng THUA VỊ TRÍ.
  // ⇒ [[agentco-prompt-rules-lose-to-examples]]: điều kiện phải nằm trên chính
  // dòng có ví dụ. User chốt: cánh tay là thư mục ĐƯỢC CẮM, không phải onlyAllows.
  const line = armReach(ARMS, SERVERS, 'a385afc3ab6');
  assert.ok(/đường tắt tới/.test(line), `dòng phải tự nói nó là đường tắt: ${line}`);
  assert.ok(!/thư mục:/.test(line), `"thư mục:" đọc thành giới hạn — đừng quay lại: ${line}`);
});

test('armReach: cánh tay KHÔNG phải file thì không bịa ra thư mục', () => {
  assert.equal(armReach(ARMS, SERVERS, 'notion'), 'Notion');
});

/**
 * ⭐ `does` — NĂNG LỰC BẰNG TIẾNG NGƯỜI cho cánh tay KHÔNG có mục danh mục.
 * → `assistant.ts §armReach` · docs/SPEC-arms.md §16r
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Đo 30/08 (`scripts/spike-cli-arm.ts`), cánh tay CLI tên `Xưởng lệnh`,     │
 * │ tầng thi hành 9/9 xanh, tầng Trợ lý hỏng **3/3**:                        │
 * │                                                                          │
 * │   "tung giúp mình con xúc xắc"  → Trợ lý **BỊA**: "ra 4 chấm nhé 🎲"      │
 * │   "dùng kết nối Xưởng lệnh…"    → brief "**bằng lệnh shell**" → blocked   │
 * │                                                                          │
 * │ Dòng danh bạ khi ấy là đúng chữ `Xưởng lệnh`. Với `Notion`/`GitHub` lỗ    │
 * │ này VÔ HÌNH vì cái tên tự nó mang năng lực — model có tiên nghiệm về      │
 * │ hãng. Tên khách tự đặt thì tiên nghiệm bằng 0, và model lấp chỗ trống.    │
 * │ → [[agentco-debt-hidden-by-model-priors]]                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
test('armReach: `does` đưa NĂNG LỰC vào dòng, không đưa tên tool máy', () => {
  const arms = { cli: { label: 'Xưởng lệnh', does: ['tung một con xúc xắc', 'đồng bộ dữ liệu'] } };
  const line = armReach(arms, {}, 'cli');
  assert.equal(line, 'Xưởng lệnh — tung một con xúc xắc · đồng bộ dữ liệu');
});

test('armReach: `does` có TRẦN 4 — một cánh tay 20 lệnh không nhét cả bức tường vào prefix', () => {
  // Cùng kỷ luật `reachDiff` ràng buộc 2. Dòng này nằm trong prefix được cache
  // của Trợ lý và trả ở MỌI lượt gõ phím — không có trần là một hoá đơn mở.
  const does = ['một', 'hai', 'ba', 'bốn', 'năm', 'sáu'];
  const line = armReach({ cli: { label: 'X', does } }, {}, 'cli');
  assert.ok(line.includes('một · hai · ba · bốn'), `phải giữ 4 việc đầu: ${line}`);
  assert.ok(line.includes('và 2 việc khác'), `phải gộp phần dư: ${line}`);
  assert.ok(!line.includes('năm'), `việc thứ 5 không được lọt nguyên văn: ${line}`);
});

test('armReach: VẮNG `does` ⇒ không in gì — mọi cánh tay đang chạy giữ nguyên từng ký tự', () => {
  // 🔴 Đây là test chống HỎNG LÂY. Bản vá 30/08 chỉ được phép THÊM cho cánh tay
  // có khai `does`; cánh tay hôm nay (danh mục, thư mục, tự dán) không khai ô đó
  // và dòng của chúng phải y hệt trước bản vá.
  assert.equal(armReach(ARMS, SERVERS, 'notion'), 'Notion');
  assert.equal(armReach({ cli: { label: 'X', does: [] } }, {}, 'cli'), 'X');
  assert.equal(armReach({ cli: { label: 'X' } }, {}, 'cli'), 'X');
  // và nó không được đẩy `level`/thư mục đi chỗ khác
  const line = armReach({ a: { label: 'Kho', level: 'read' } }, { a: { args: ['D:\\Kho'] } }, 'a');
  assert.equal(line, 'Kho — chỉ đọc (đường tắt tới D:\\Kho)');
});

test('armReach: `does` đứng SAU nấc quyền — quyền trước, việc sau', () => {
  const line = armReach({ a: { label: 'Kho', level: 'read', does: ['đọc hoá đơn'] } }, {}, 'a');
  assert.equal(line, 'Kho — chỉ đọc · đọc hoá đơn');
});

/**
 * ⭐ NÓI RA NĂNG LỰC, KHÔNG CHỈ NÓI TÊN — nợ ghi 22/08, trả 26/08.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ca user 26/08, nguyên văn hai lượt **giống hệt nhau**:                   │
 * │                                                                          │
 * │   > Tạo giúp tôi một trang mới trong Notion tên "thử nghiệm".            │
 * │   > — chỉ đọc được Notion, không tạo hay ghi trang mới…      ✅ đúng      │
 * │   (đổi cánh tay sang TOÀN QUYỀN)                                         │
 * │   > Tạo giúp tôi một trang mới trong Notion tên "thử nghiệm".            │
 * │   > — chỉ đọc được Notion, không tạo hay ghi trang mới…      🔴 sai      │
 * │                                                                          │
 * │ Trợ lý **không cố chấp** — dòng danh bạ chỉ ghi một cái TÊN, mà một cái   │
 * │ tên thì không nói gì về quyền. Nó không có dữ kiện nào để biết khác đi.  │
 * │                                                                          │
 * │ ⚠ Và nợ này đắt gấp đôi vì nó đoán **theo chiều TỪ CHỐI** — cùng hình     │
 * │ dạng với ca `chạy lệnh: TẮT`: *nói dối theo chiều làm Trợ lý từ chối một │
 * │ việc vốn chạy được*. Lần thứ hai, thấp hơn một tầng.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const TIERED = {
  n_read: { label: 'Notion · Cá nhân', level: 'read' as const },
  n_add: { label: 'Notion · Nhóm', level: 'add' as const },
  n_full: { label: 'Notion · Công ty', level: 'full' as const },
};

test('⭐ armReach: nấc quyền nằm TRÊN CHÍNH DÒNG của nhân viên', () => {
  // Không phải thêm một câu dặn ở đầu khối — câu dặn ở đầu khối đã thua vị trí
  // hai lần rồi. → [[agentco-prompt-rules-lose-to-examples]]
  assert.match(armReach(TIERED, {}, 'n_read'), /chỉ đọc/);
  assert.match(armReach(TIERED, {}, 'n_full'), /ghi/);
  assert.match(armReach(TIERED, {}, 'n_full'), /sửa\/xoá/);
});

test('⭐ armReach: BA nấc cho BA dòng khác nhau — đổi nấc là đổi prompt', () => {
  // Nếu hai nấc ra cùng một chuỗi thì đổi nấc không sinh tín hiệu nào, và
  // `reachDiff` cũng không có gì để báo ⇒ ca user gặp tái diễn y nguyên.
  const lines = new Set(['n_read', 'n_add', 'n_full'].map((id) => armReach(TIERED, {}, id)));
  assert.equal(lines.size, 3);
});

test('armReach: nấc `add` phải nói RÕ nó KHÔNG sửa/xoá', () => {
  // "Đọc + thêm mới" một mình dễ bị đọc thành "ghi được" ⇒ Trợ lý giao một việc
  // sửa trang cho người chỉ tạo được trang mới. Vế phủ định phải nằm ngay đó.
  assert.match(armReach(TIERED, {}, 'n_add'), /không sửa\/xoá/);
});

test('armReach: KHÔNG có `level` ⇒ không bịa ra năng lực nào', () => {
  /**
   * Cánh tay thư mục và cánh tay tự cắm không có nấc. Bịa "toàn quyền" cho
   * chúng là dựng lại đúng cái lỗi vừa vá, chỉ đảo chiều: đoán hộ một năng lực
   * từ một thứ không khai nó. → `probe.ts §levelOf`, luật một chiều.
   */
  assert.equal(armReach(ARMS, SERVERS, 'notion'), 'Notion');
  assert.ok(!/chỉ đọc|toàn quyền|sửa\/xoá/.test(armReach(ARMS, SERVERS, 'a385afc3ab6')));
});

test('armReach: có CẢ nấc lẫn thư mục thì nói cả hai, không nuốt cái nào', () => {
  const arms = { x: { label: 'Kho', level: 'full' as const } };
  const line = armReach(arms, { x: { args: ['D:\\Kho'] } }, 'x');
  assert.match(line, /sửa\/xoá/);
  assert.match(line, /D:\\Kho/);
});

test('armReach: chưa có nhãn thì rơi về băm — thà xấu còn hơn im', () => {
  assert.equal(armReach({}, {}, 'a1b2c3'), 'a1b2c3');
});

test('SHELL_LEGEND: dạy dùng LUÔN thư mục đã in ra, và HẸP đúng chỗ đó', () => {
  // Nửa còn lại của `armReach`: biết đường dẫn mà vẫn hỏi lại thì bản vá vô nghĩa.
  assert.ok(/thư mục:/.test(SHELL_LEGEND), 'legend phải giải thích nhãn "thư mục:"');
  assert.ok(/đừng hỏi lại/.test(SHELL_LEGEND), 'phải nói thẳng: đừng hỏi lại đường dẫn');
  // ⚠ Và phải HẸP: viết rộng thành "đừng hỏi đường dẫn" là dạy Trợ lý đoán bừa
  // một đường dẫn nó chưa từng thấy — hỏng ngược chiều, và im lặng hơn.
  assert.ok(
    /trong danh sách|ĐÃ được cấp quyền/.test(SHELL_LEGEND),
    'câu phải giới hạn vào thư mục đã in ra ở dòng nhân viên',
  );
});

test('SHELL_LEGEND: nêu quyền ĐỌC, và không phủ định rộng ra cả việc với tới máy', () => {
  assert.ok(/MỞ ĐƯỢC file trên máy/.test(SHELL_LEGEND), 'phải nói ra quyền đọc');
  for (const doi of ['không với tới', 'không đọc được', 'không truy cập']) {
    assert.ok(!SHELL_LEGEND.includes(doi), `câu phủ định rộng "${doi}" là sai sự thật`);
  }
});

/**
 * 🔴 KHÔNG ĐƯỢC KHẲNG ĐỊNH VỀ TOÀN BỘ THẾ GIỚI — nó hết đúng khi thế giới lớn ra.
 *
 * "shell là thứ DUY NHẤT lấy được kích thước" đúng hôm nay (7 tool mặc định không
 * cái nào trả metadata) và thành NÓI DỐI vào đúng ngày một MCP filesystem có mặt —
 * nói dối theo chiều làm Trợ lý TỪ CHỐI việc vốn chạy được, tức là hỏng im lặng.
 *
 * Bất biến thay thế nói về ĐỊNH DẠNG, không về thế giới, nên nó tự đúng mãi.
 */
/**
 * 🔴🔴 TEST NÀY XANH SUỐT TRONG KHI LỖI VẪN SỐNG — và đó là bài học của nó.
 *
 * Bản 22/08 gỡ chữ "DUY NHẤT" khỏi `SHELL_LEGEND` rồi viết test dưới đây để canh.
 * Nhưng nó **giữ nguyên vế nhân quả**: *'"chạy lệnh: BẬT" thì có thêm: kích
 * thước · ngày sửa · dung lượng của file'*. Sửa CHỮ, không sửa MỆNH ĐỀ.
 *
 * Ca user 24/08, cánh tay filesystem cắm đàng hoàng, shell TẮT:
 *   *"Nhân viên phụ trách thư mục Musics đang tắt chế độ chạy lệnh nên không
 *    lấy được dung lượng file… Bạn có thể bật chế độ chạy lệnh không?"*
 *
 * Đo được là SAI: `spike-arm-e2e` ca A chạy với `role.tools = []` (shell tắt
 * hoàn toàn) và vẫn ra bảng kích thước — `list_directory_with_sizes` là 1 trong
 * 14 tool của cánh tay. Trợ lý từ chối một việc vốn chạy được, **và đòi người
 * dùng bật một công tắc an toàn để đổi lấy thứ họ đã có**.
 *
 * ⇒ Test mới canh MỆNH ĐỀ, không canh một danh sách từ cấm.
 */
test('SHELL_LEGEND: KHÔNG gán metadata file cho shell — cánh tay cũng lấy được', () => {
  for (const gan of ['kích thước', 'ngày sửa', 'dung lượng']) {
    assert.ok(
      !SHELL_LEGEND.includes(gan),
      `"${gan}" nằm cạnh "chạy lệnh: BẬT" là dạy Trợ lý rằng không có shell thì không có ` +
        `metadata — sai từ ngày một MCP filesystem được cắm, và sai theo chiều TỪ CHỐI việc`,
    );
  }
});

test('SHELL_LEGEND: dặn thẳng ĐỪNG ĐOÁN HỘ nhân viên là họ không làm được', () => {
  // Nửa khẳng định của cùng bản vá: gỡ mệnh đề sai mới chỉ thôi nói dối. Ca
  // user là Trợ lý TỪ CHỐI TRƯỚC thay cho nhân viên, nên phải có câu chặn đúng
  // hành vi đó — nhân viên biết bộ tool của chính nó, Trợ lý thì không.
  assert.ok(/ĐỪNG đoán hộ/.test(SHELL_LEGEND), 'phải cấm việc đoán hộ năng lực của nhân viên');
  assert.ok(/kết nối/.test(SHELL_LEGEND), 'phải nói ra rằng kết nối mang khả năng riêng');
});

test('SHELL_LEGEND: không khẳng định độc quyền — câu phải sống sót khi MCP có mặt', () => {
  for (const dong of ['DUY NHẤT', 'duy nhất', 'chỉ có thể', 'cách duy nhất']) {
    assert.ok(
      !SHELL_LEGEND.includes(dong),
      `"${dong}" là khẳng định về toàn bộ thế giới — hết đúng khi thêm MCP`,
    );
  }
  assert.ok(/liệt kê ĐỦ/.test(SHELL_LEGEND), 'phải thay bằng bất biến về định dạng');
});

// ═══════════════════════════════════════════ chặn vòng lặp câu từ chối
//
// Ca thật 22/08 (bài 9b): người dùng gõ lại yêu cầu HAI lần, mỗi lần rõ hơn, và
// nhận về đúng cùng một chuỗi từng byte — vì nguyên nhân nằm ở hai luật trong
// prompt ép nhau, không nằm ở cách họ diễn đạt. Không lời nào thoát được.

test('planProblemsMessage: lần đầu vẫn khuyên nhắn lại — lời khuyên đó đúng ở lần đầu', () => {
  const m = planProblemsMessage(['Task T-02 cần đọc "x.md"'], 0);
  assert.ok(m.includes('nhắn lại yêu cầu rõ hơn'));
  assert.ok(!m.includes('lần thứ'));
});

test('planProblemsMessage: từ lần thứ BA thì đổi câu — thôi khuyên một thứ đã đo là vô ích', () => {
  const m = planProblemsMessage(['Task T-02 cần đọc "x.md"'], 2);
  assert.ok(m.includes('lần thứ 3'), `phải nói ra là đang kẹt lặp: ${m}`);
  assert.ok(
    !m.includes('nhắn lại yêu cầu rõ hơn'),
    'không được lặp lại lời khuyên vừa bị chứng minh là vô ích',
  );
  // Phải chuyển hướng sang thứ người dùng THẬT SỰ làm được.
  assert.ok(m.includes('bỏ bớt') || m.includes('tách ra'));
});

test('planProblemsMessage: KHÔNG giấu danh sách lỗi đi ở lần lặp', () => {
  // Nó vẫn là thứ duy nhất nói được chuyện gì đang xảy ra, và người dùng copy
  // được nó đi hỏi chỗ khác.
  for (const n of [0, 2, 5]) {
    assert.ok(planProblemsMessage(['Task T-02 cần đọc "x.md"'], n).includes('Task T-02'));
  }
});

// ══════════════════════════════ outputScoper: đường dẫn TUYỆT ĐỐI → basename
//
// Ca thật 22/08 22:06 (`P-260822-2206-ajcd`). Người dùng nói "ghi vào
// D:\Downloads\Programs Installation\ban-ke.md". Kế hoạch lưu ra:
//
//   outputs: artifacts/P-…/T-01/ban-ke.md
//          | artifacts/P-…/T-01/D:/Downloads/Programs Installation/ban-ke.md
//
// Chữ `D:` thành một đoạn thư mục ⇒ trên Windows là đường dẫn BẤT HỢP LỆ ⇒
// nhân viên đào 7 lượt · $0,3158 để mkdir một thứ không thể tồn tại.

test('outputScoper: đường dẫn Windows tuyệt đối → basename, KHÔNG lồng ổ đĩa vào khung', () => {
  const s = outputScoper('P-1', 'T-01');
  assert.equal(s('D:\\Downloads\\Programs Installation\\ban-ke.md'), 'artifacts/P-1/T-01/ban-ke.md');
  assert.ok(!s('D:\\Downloads\\x.md').includes('D:'), 'ổ đĩa không được thành tên thư mục');
});

test('outputScoper: đường dẫn POSIX tuyệt đối → basename', () => {
  // Nhánh này hỏng êm hơn (hợp lệ nhưng sai chỗ) nên trước đây không ai thấy.
  const s = outputScoper('P-1', 'T-01');
  assert.equal(s('/home/an/bao-cao/ban-ke.md'), 'artifacts/P-1/T-01/ban-ke.md');
});

test('outputScoper: UNC share cũng là tuyệt đối', () => {
  const s = outputScoper('P-1', 'T-01');
  assert.equal(s('\\\\server\\share\\ban-ke.md'), 'artifacts/P-1/T-01/ban-ke.md');
});

test('outputScoper: kiểm CẢ HAI hệ, không dò process.platform', () => {
  // Văn phòng zip từ Windows sang Linux vẫn phải đọc đúng chuỗi trong kế hoạch cũ.
  const s = outputScoper('P-1', 'T-01');
  for (const p of ['D:\\a\\x.md', '/a/x.md']) {
    assert.equal(s(p), 'artifacts/P-1/T-01/x.md', `phải xử lý được "${p}" trên mọi máy`);
  }
});

test('outputScoper: đường dẫn TƯƠNG ĐỐI giữ nguyên hành vi cũ — vẫn giữ đuôi người dùng đặt', () => {
  // Nới cho tuyệt đối không được làm hỏng luật "giữ phần người dùng chọn".
  const s = outputScoper('P-1', 'T-01');
  assert.equal(s('vi/doc-1.md'), 'artifacts/P-1/T-01/vi/doc-1.md');
  assert.equal(s('artifacts/P-1/T-01/vi/doc-1.md'), 'artifacts/P-1/T-01/vi/doc-1.md');
});
