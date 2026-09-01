/**
 * ⭐ LUẬT MỘT CHIỀU: **KHÔNG BIẾT ⇒ LEO THANG. KHÔNG BAO GIỜ HẠ CẤP.**
 * → `src/core/probe.ts §levelOf` · docs/SPEC-arms.md §6j · §8b
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ User chốt 25/08, và câu này là toàn bộ nội dung của file test:           │
 * │                                                                          │
 * │   *"đảm bảo nếu 0 biết gì thì nó ở nấc cao hơn, đừng kiểu khai chỉ đọc   │
 * │    mà đến lúc nó thêm, xóa/sửa được là chết dở. Nói tóm lại KHÔNG ĐƯỢC   │
 * │    NÓI DỐI. Khi chúng ta không biết, chúng ta nói toàn quyền là không    │
 * │    nói dối — điều tương tự cũng đúng với nấc 2."*                        │
 * │                                                                          │
 * │ Vì sao nó đáng một file riêng: `levelOf` là hàm sinh ra `arms[băm].tools`│
 * │ của một cánh tay "chỉ đọc", và danh sách đó đi **thẳng vào              │
 * │ `allowedTools`** lúc chạy. Sai một nấc ở đây không ra lỗi — nó ra một    │
 * │ nhân viên ghi được vào workspace thật dưới một cái nhãn nói rằng không.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { levelOf } from '../dist/core/probe.js';

// ───────────────────────────────── hai nấc đang chạy hôm nay

test('khai rõ ràng chỉ đọc ⇒ read', () => {
  assert.equal(levelOf({ readOnly: true }), 'read');
  assert.equal(levelOf({ readOnly: true, destructive: false }), 'read');
});

test('KHÔNG KHAI GÌ ⇒ write_external — ca này CÓ THẬT', () => {
  // `create_directory` của `filesystem` không mang annotation nào (đo 23/08).
  assert.equal(levelOf(undefined), 'write_external');
  assert.equal(levelOf({}), 'write_external');
});

test('khai một nửa vẫn là KHÔNG BIẾT ⇒ write_external', () => {
  // `destructive: false` một mình KHÔNG nói rằng tool này chỉ đọc. Theo spec MCP,
  // `destructiveHint` chỉ có nghĩa khi `readOnlyHint` là false — thiếu vế kia thì
  // lời khai này không nói được điều ta cần biết.
  assert.equal(levelOf({ destructive: false }), 'write_external');
  assert.equal(levelOf({ openWorld: false }), 'write_external');
});

test('khai rõ là ghi ⇒ write_external', () => {
  assert.equal(levelOf({ readOnly: false }), 'write_external');
  assert.equal(levelOf({ readOnly: false, destructive: true }), 'write_external');
});

/**
 * 🔴 Ô ĐẮT NHẤT FILE NÀY — và là lỗ vừa vá 25/08.
 *
 * Bản cũ chỉ hỏi `readOnly === true`, nên một tool tự khai **phá huỷ được** vẫn
 * rơi vào `read` và được cấp dưới nhãn *"chỉ đọc"*. Không cần server nói dối:
 * chỉ cần nó khai **ẩu**, mà một cặp trường mâu thuẫn chính là dấu hiệu rõ nhất
 * của khai ẩu. Lời khai mâu thuẫn phải được đọc theo nghĩa **nặng hơn**.
 */
test('⭐ KHAI MÂU THUẪN (readOnly + destructive) ⇒ LEO THANG, không tin vế nhẹ', () => {
  assert.equal(levelOf({ readOnly: true, destructive: true }), 'write_external');
});

test('mọi tổ hợp: chỉ ĐÚNG MỘT hình dạng được xuống `read`', () => {
  // Quét toàn bộ không gian 3 trường × {true,false,undefined}. Bất biến: `read`
  // chỉ ra khi readOnly===true VÀ destructive!==true. Mọi ô còn lại phải leo.
  const vals = [true, false, undefined];
  let readCount = 0;
  for (const readOnly of vals) {
    for (const destructive of vals) {
      for (const openWorld of vals) {
        const got = levelOf({ readOnly, destructive, openWorld });
        const want = readOnly === true && destructive !== true ? 'read' : 'write_external';
        assert.equal(got, want, `{readOnly:${readOnly}, destructive:${destructive}} → ${got}`);
        if (got === 'read') readCount++;
      }
    }
  }
  // readOnly=true × destructive∈{false,undefined} × openWorld∈{3} = 6
  assert.equal(readCount, 6, 'số tổ hợp được xuống `read` đã đổi — kiểm lại luật một chiều');
});

/**
 * BẢNG CHÂN TRỊ CHO 3 NẤC (§6j) — khoá lại **trước khi** xây giao diện.
 *
 * `levelOf` hôm nay trả hai nấc. Nấc giữa ("Đọc + Thêm") chưa có mã, nhưng luật
 * của nó thì đã chốt, và chốt rồi mà không khoá là để nó bị suy lại sai vào ngày
 * xây UI — lúc không ai còn nhớ vì sao nấc 2 đòi **cả hai** trường.
 *
 * ⚠ Nấc 2 đòi HAI lời khai tường minh: *"tôi không chỉ đọc"* VÀ *"tôi không phá
 * huỷ"*. Thiếu một vế là **không biết**, mà không biết thì leo lên nấc 3 — đúng
 * câu user nói: *"điều tương tự cũng đúng với nấc 2"*.
 */
const tierOf = (a: { readOnly?: boolean; destructive?: boolean }): 1 | 2 | 3 =>
  levelOf(a) === 'read' ? 1 : a.readOnly === false && a.destructive === false ? 2 : 3;

test('3 nấc: nấc 2 đòi ĐỦ HAI lời khai, thiếu một vế là lên nấc 3', () => {
  assert.equal(tierOf({ readOnly: true }), 1, 'chỉ đọc');
  assert.equal(tierOf({ readOnly: false, destructive: false }), 2, 'thêm — khai đủ hai');
  assert.equal(tierOf({ readOnly: false }), 3, 'thiếu destructive ⇒ không biết ⇒ nấc 3');
  assert.equal(tierOf({ destructive: false }), 3, 'thiếu readOnly ⇒ không biết ⇒ nấc 3');
  assert.equal(tierOf({}), 3, 'không khai gì ⇒ nấc 3');
  assert.equal(tierOf({ readOnly: false, destructive: true }), 3, 'khai rõ phá huỷ');
  assert.equal(tierOf({ readOnly: true, destructive: true }), 3, 'mâu thuẫn ⇒ leo thang');
});

test('3 nấc: KHÔNG tổ hợp nào tụt xuống thấp hơn `levelOf` cho phép', () => {
  // Bất biến nối hai hàm: cái gì `levelOf` gọi là ghi thì không được thành nấc 1.
  const vals = [true, false, undefined];
  for (const readOnly of vals) {
    for (const destructive of vals) {
      const t = tierOf({ readOnly, destructive });
      if (levelOf({ readOnly, destructive }) === 'write_external') {
        assert.ok(t >= 2, `{readOnly:${readOnly}, destructive:${destructive}} tụt xuống nấc ${t}`);
      }
    }
  }
});
