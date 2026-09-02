/**
 * CHẠY TIẾP MỘT VIỆC BỊ CẮT GIỮA CHỪNG. → `core/scheduler.ts` · SPEC-arms §9f
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CA SINH RA NÓ (27/08, user chạy thật):                                   │
 * │                                                                          │
 * │   T-01  đọc trang ở vị trí 1–3       → làm thật         5 lượt  $0.16    │
 * │   T-02  đọc trang ở vị trí 4–6       → "chỉ có 1 trang"  3 lượt  $0.04    │
 * │   T-03  đọc trang ở vị trí 7–9       → "chỉ có 1 trang"  3 lượt  $0.04    │
 * │   T-04  đọc trang từ vị trí 10 trở đi → "chỉ có 1 trang" 3 lượt  $0.04    │
 * │                                                                          │
 * │ Ba trong bốn việc **chắc chắn vô nghĩa ngay từ lúc sinh ra** — danh sách  │
 * │ chỉ có MỘT trang. Trợ lý chia theo *vị trí* trong khi nó **không có cách  │
 * │ nào biết danh sách dài bao nhiêu**: kế hoạch lập TRƯỚC khi bất kỳ việc    │
 * │ nào chạy, nên nó không đọc được file mà chính nó vừa bảo người khác tạo.  │
 * │                                                                          │
 * │ Đó là một tính chất của KIẾN TRÚC, không phải một lần model ngơ: *chia    │
 * │ nhỏ theo kích thước của một thứ chưa tồn tại*. Đoán thừa ⇒ việc rỗng;     │
 * │ đoán thiếu ⇒ cháy trần. **Hai đầu của cùng một cây gậy.**                 │
 * │                                                                          │
 * │ ⇒ Bỏ việc đoán: cứ chạy, cắt giữa chừng thì **chạy tiếp**, và chỗ tiếp    │
 * │ đọc từ **file có thật trên đĩa** chứ không từ một con số đếm.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ PHẠM VI CỦA FILE NÀY: nó khoá **QUYẾT ĐỊNH**, không khoá đường dây. Việc
 * nối `run()` → `shouldContinue` → `remaining` chỉ chạy thật khi có văn phòng
 * thật, và **chưa có test đầu-cuối cho nó**. Đừng đọc màu xanh ở đây thành
 * *"đã chạy được"*.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { continueBrief, shouldContinue } from '../dist/core/scheduler.js';

const brief = {
  task_id: 'T-01',
  role: 'nguoi-soi-thu-muc',
  goal: 'Tóm tắt từng trang con',
  inputs: [],
  outputs: [],
  constraints: ['Viết bằng tiếng Việt.'],
  knowledge_refs: [],
  deps: [],
  step: 0,
  deliver: 'file' as const,
};

// ─────────────────────────────────────────── hàng rào ① : phải CÓ TIẾN TRIỂN

test('🔴 KHÔNG có file mới ⇒ KHÔNG chạy tiếp (nếu không là lặp vô tận)', () => {
  // Việc không nhúc nhích mà vẫn xếp lại thì mỗi vòng là một trần lượt nữa —
  // đúng kiểu đốt tiền mà người dùng chỉ thấy khi đọc hoá đơn.
  assert.equal(shouldContinue({ kind: 'max_turns', tried: 0, landed: 0 }), false);
});

test('⭐ CÓ file mới ⇒ chạy tiếp', () => {
  assert.equal(shouldContinue({ kind: 'max_turns', tried: 0, landed: 1 }), true);
});

// ─────────────────────────────────────────── hàng rào ② : trần 3 lần

test('🔴 tiến triển THẬT nhưng rất chậm vẫn phải có ĐÁY', () => {
  /**
   * Mỗi lượt ghi thêm một dòng cũng là "có tiến triển". Và **tất định không có
   * nghĩa là rẻ**: mỗi lần chạy tiếp là một lượt worker ĐẦY ĐỦ, chạy tới tận
   * trần lượt của nó.
   *
   * Trần hiện tại là **1** (user chốt 27/08). Chưa ai đo một ca dài thật cần
   * mấy vòng, nên khi chưa biết thì hướng an toàn là THẤP: hỏng sớm thì người
   * dùng **thấy** và nới `max_turns`; hỏng muộn thì tiền cháy **âm thầm**.
   */
  assert.equal(shouldContinue({ kind: 'max_turns', tried: 0, landed: 5 }), true);
  assert.equal(shouldContinue({ kind: 'max_turns', tried: 1, landed: 5 }), false);
  assert.equal(shouldContinue({ kind: 'max_turns', tried: 9, landed: 5 }), false);
});

// ─────────────────────────────────────────── chỉ đúng MỘT kiểu hỏng

test('🔴 CHỈ `max_turns` — mọi kiểu hỏng khác KHÔNG được chạy tiếp', () => {
  /**
   * Đây là chỗ dễ nới tay nhất và nguy nhất. `budget` chạy tiếp là **cố tình
   * vượt trần tiền người dùng đặt**. `usage_limit`/`auth` chạy tiếp là gõ cửa
   * một cánh cửa đã khoá. `stopped` chạy tiếp là **làm ngược lệnh người dùng
   * vừa bấm**.
   */
  for (const kind of ['budget', 'usage_limit', 'auth', 'rate_limit', 'stopped', 'other'] as const) {
    assert.equal(
      shouldContinue({ kind, tried: 0, landed: 5 }),
      false,
      `${kind} không được phép chạy tiếp`,
    );
  }
});

// ─────────────────────────────────────────── việc chạy tiếp

test('🔴 câu dặn KHÔNG mang số thứ tự — chỗ tiếp đọc từ ĐĨA', () => {
  /**
   * Nhét *"bắt đầu từ phần 4"* là dựng lại đúng cái lỗi vừa đi sửa: đoán vị trí
   * trong một danh sách chưa ai đọc. Ta **không biết** nó đã làm tới đâu, và
   * thứ duy nhất biết là chính worker khi nó mở thư mục kết quả của mình.
   */
  const tiep = continueBrief(brief);
  const them = tiep.constraints.at(-1)!;
  assert.match(them, /output folder/);
  assert.match(them, /do not start again from scratch/i);
  assert.doesNotMatch(them, /\b(position|part|section|page)\s*\d/i, 'không được đoán chỗ tiếp bằng con số');
});

test('⭐ chạy tiếp là CÙNG một việc — không đổi mục tiêu, không đổi id', () => {
  // Đổi `task_id` là đẻ ra một việc thứ hai trên giao diện cho cùng một thứ,
  // và bộ đếm `continued` mất dấu ⇒ trần 3 lần thành vô hạn.
  const tiep = continueBrief(brief);
  assert.equal(tiep.task_id, brief.task_id);
  assert.equal(tiep.goal, brief.goal);
  assert.equal(tiep.role, brief.role);
  assert.deepEqual(tiep.outputs, brief.outputs);
});

test('⭐ giữ nguyên mọi ràng buộc cũ, chỉ THÊM một dòng', () => {
  const tiep = continueBrief(brief);
  assert.equal(tiep.constraints.length, brief.constraints.length + 1);
  assert.equal(tiep.constraints[0], 'Viết bằng tiếng Việt.');
});

test('⭐ chạy tiếp hai lần KHÔNG chồng câu dặn lên nhau', () => {
  // Mỗi vòng cộng thêm một dòng y hệt là bơm prefix của worker lên vô ích, và
  // ba dòng giống nhau còn dạy model rằng dòng đó không quan trọng.
  const hai = continueBrief(continueBrief(brief));
  const them = hai.constraints.filter((c) => /output folder/.test(c));
  assert.equal(them.length, 1, 'câu dặn bị nhân bản');
});
