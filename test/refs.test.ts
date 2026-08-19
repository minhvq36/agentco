/**
 * Test cho `@đường-dẫn` trong ô chat (20/08).
 *
 * Đây là mảnh duy nhất trong sản phẩm dò một khuôn mẫu trong chữ NGƯỜI DÙNG GÕ,
 * và nó quyết định một chuyện đắt: đường dẫn nào đi vào `inputs` của nhân viên.
 * Sai ở đây là nhân viên mở nhầm file, hoặc mở một file không tồn tại rồi tự
 * xoay sở — cả hai đều không báo lỗi.
 *
 * Ba ca phải giữ bằng mọi giá:
 *
 *   1. tên trần TRÙNG giữa hai kho → DỪNG và hỏi, tuyệt đối không đoán
 *   2. đường dẫn không có thật     → DỪNG, không để nó tới model
 *   3. `@` KHÔNG phải tham chiếu   → không đụng vào (email, giá tiền, tên riêng)
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { resolveFileRefs } from '../dist/core/commands.js';

/** Hai kho, và CÓ MỘT TÊN TRÙNG NHAU — đó là cả điểm của bộ test này. */
const KNOWN = [
  'library/files/doc-1.md',
  'library/files/doc-2.md',
  'library/files/bao-gia.xlsx',
  'artifacts/P-260820-0302-ov9e/T-01/doc-1.md',
  'artifacts/P-260820-0440-9a3q/T-01/vi/doc-2-thuat-ngu.md',
];

// ───────────────────────────────────────── ca 1: trùng tên giữa hai kho

test('tên trần TRÙNG hai kho → DỪNG và liệt kê, không đoán', () => {
  // `doc-1.md` có ở CẢ tủ tài liệu lẫn ngăn Kết quả. Đoán bừa một bên là làm
  // sai việc của người dùng một cách im lặng — lớp lỗi tệ nhất trong sản phẩm.
  const r = resolveFileRefs('dịch lại @doc-1.md giúp mình', KNOWN);
  assert.ok(r.problem, 'phải dừng lại và hỏi');
  assert.ok(r.problem.includes('library/files/doc-1.md'));
  assert.ok(r.problem.includes('artifacts/P-260820-0302-ov9e/T-01/doc-1.md'));
  assert.equal(r.text, 'dịch lại @doc-1.md giúp mình', 'chữ gốc giữ NGUYÊN khi có vấn đề');
});

test('tên trần DUY NHẤT thì nở ra thành đường dẫn đủ', () => {
  const r = resolveFileRefs('xem @bao-gia.xlsx', KNOWN);
  assert.equal(r.problem, undefined);
  assert.equal(r.text, 'xem library/files/bao-gia.xlsx');
});

// ───────────────────────────────────────── ca 2: không có thật

test('đường dẫn KHÔNG có thật → DỪNG, không tới model', () => {
  const r = resolveFileRefs('đọc @artifacts/khong-ton-tai.md nhé', KNOWN);
  assert.ok(r.problem);
  assert.ok(r.problem.includes('artifacts/khong-ton-tai.md'), 'phải nêu ĐÚNG chuỗi họ gõ');
});

test('gõ sai một chữ trong đường dẫn đủ cũng bị chặn — KHÔNG tự "sửa hộ"', () => {
  // Đoán ý người dùng ở đây là mở nhầm file mà vẫn báo thành công.
  const r = resolveFileRefs('@library/files/doc-9.md', KNOWN);
  assert.ok(r.problem);
});

// ───────────────────────────────────────── ca 3: `@` KHÔNG phải tham chiếu

test('email KHÔNG bị coi là tham chiếu file', () => {
  const s = 'gửi cho ke-toan@congty.vn nhé';
  assert.deepEqual(resolveFileRefs(s, KNOWN), { text: s });
});

test('văn bản không có `@` đi thẳng, không tốn công gì', () => {
  const s = 'Dịch doc-1.md trong tủ tài liệu sang tiếng Việt.';
  assert.deepEqual(resolveFileRefs(s, KNOWN), { text: s });
});

// ───────────────────────────────────────── đường dẫn đủ + nhiều tham chiếu

test('đường dẫn đủ khớp chính xác thì chỉ bỏ dấu `@`', () => {
  const r = resolveFileRefs('so @library/files/doc-2.md với bản dịch', KNOWN);
  assert.equal(r.text, 'so library/files/doc-2.md với bản dịch');
});

test('NHIỀU tham chiếu trong một câu — đúng ca người dùng thật sự gõ', () => {
  const r = resolveFileRefs(
    'đối chiếu @library/files/doc-2.md với @artifacts/P-260820-0440-9a3q/T-01/vi/doc-2-thuat-ngu.md',
    KNOWN,
  );
  assert.equal(r.problem, undefined);
  assert.equal(
    r.text,
    'đối chiếu library/files/doc-2.md với artifacts/P-260820-0440-9a3q/T-01/vi/doc-2-thuat-ngu.md',
  );
});

test('MỘT tham chiếu hỏng thì cả câu bị chặn, không giải một nửa', () => {
  // Giải một nửa nghĩa là model nhận một câu có một đường dẫn thật và một chuỗi
  // `@…` lạ — nó sẽ tự xoay sở, và ta mất quyền kiểm soát đúng lúc cần nhất.
  const r = resolveFileRefs('so @library/files/doc-2.md với @khong-co.md', KNOWN);
  assert.ok(r.problem);
  assert.ok(r.text.includes('@library/files/doc-2.md'), 'chữ gốc giữ nguyên hoàn toàn');
});

// ───────────────────────────────────────── chi tiết dễ quên

test('dấu câu dính đuôi KHÔNG làm hỏng tham chiếu', () => {
  // "sửa @a/b.md, giữ nguyên phần đầu" — dấu phẩy là của câu văn, không của tên file.
  const r = resolveFileRefs('sửa @library/files/doc-1.md, giữ nguyên phần đầu', KNOWN);
  assert.equal(r.problem, undefined);
  assert.equal(r.text, 'sửa library/files/doc-1.md, giữ nguyên phần đầu');
});

test('`\\` đổi thành `/` — người dùng Windows chép từ file explorer', () => {
  const r = resolveFileRefs('@library\\files\\doc-2.md', KNOWN);
  assert.equal(r.problem, undefined);
  assert.equal(r.text, 'library/files/doc-2.md');
});

test('tham chiếu đứng ĐẦU câu vẫn nhận', () => {
  const r = resolveFileRefs('@library/files/doc-1.md dịch giúp mình', KNOWN);
  assert.equal(r.text, 'library/files/doc-1.md dịch giúp mình');
});

test('kho RỖNG thì mọi tham chiếu đều bị chặn, không nổ', () => {
  const r = resolveFileRefs('@doc-1.md', []);
  assert.ok(r.problem);
});
