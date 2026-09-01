/**
 * LUẬT CỦA LƯỢT NÉN TRÍ NHỚ — `assistant.ts §Assistant.COMPACT_RULES`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO KHỐI VĂN XUÔI NÀY CẦN TEST, TRONG KHI ĐẦU RA CỦA NÓ BẤT ĐỊNH.     │
 * │                                                                          │
 * │ Mỗi luật ở đây là học phí của một ca hỏng thật, và cả năm luật trông      │
 * │ giống hệt "một đoạn prompt hơi dài" với người đọc sau. Xoá bớt cho gọn ⇒  │
 * │ **không test nào đỏ**, không build nào gãy — chỉ có một hành vi im lặng   │
 * │ quay lại sau vài tuần. Đúng lớp lỗi mà chú thích không chặn được.         │
 * │                                                                          │
 * │ Test này KHÔNG kiểm model làm gì (bất định, user chấp nhận). Nó kiểm      │
 * │ **luật có còn nằm trong prompt không** — thứ tất định.                    │
 * │ → [[agentco-detect-fix-pair-scope]] · [[agentco-tat-dinh-vs-tin-hieu]]    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { Assistant } from '../dist/core/assistant.js';

const R: string = Assistant.COMPACT_RULES;

test('đủ NĂM luật, đánh số liên tục — bỏ một luật là gãy ở đây', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    assert.ok(new RegExp(`(^|\\n)${n}\\.`, 'm').test(R), `mất luật ${n}`);
  }
  assert.match(R, /Năm luật/, 'số luật khai ở đầu không khớp với số luật thật');
});

test('luật 1–3: GIỮ là mặc định, cái mới thắng, mỗi chủ đề một dòng', () => {
  // Bug 20/08: mỗi `/clear` là một lần tóm tắt lại bản tóm tắt ⇒ quyết định của
  // người dùng bốc hơi sau ba lần dọn, im lặng.
  assert.match(R, /CHÉP LẠI mọi mục cũ còn đúng/);
  assert.match(R, /cái mới thắng/);
  assert.match(R, /Mỗi chủ đề một dòng/);
});

test('luật 4: KHÔNG ghi kết luận từ ca HỎNG, và có ví dụ ⛔/✅ đi kèm', () => {
  assert.match(R, /KHÔNG ghi kết luận rút ra từ những lần HỎNG/);
  // Luật trừu tượng thua danh sách ví dụ ⇒ ví dụ phải còn.
  // → [[agentco-prompt-rules-lose-to-examples]]
  assert.match(R, /⛔ "báo cáo done của nhân viên trình duyệt không đáng tin tuyệt đối"/);
  assert.match(R, /✅ "cứ giao việc, để nhân viên tự báo nếu thiếu quyền/);
  // Nửa còn lại: thứ NGƯỜI DÙNG chốt thì vẫn giữ, kể cả khi họ chốt "đừng làm X".
  assert.match(R, /Thứ NGƯỜI DÙNG chốt thì vẫn chép lại theo luật 1/);
});

test('🔴 luật 5: giữ CÁCH LẤY, không giữ SỐ LIỆU (user chốt 31/08)', () => {
  assert.match(R, /KHÔNG ghi SỐ LIỆU và TRẠNG THÁI lấy được từ kết nối\/file/);
  // Phép thử được chọn vì nó KHÔNG cần cơ chế mới — model tự trả lời được.
  assert.match(R, /hỏi lại chỗ cũ ngày mai mà câu trả lời có thể khác/);
});

test('🔴 luật 5 phải có CẢ HAI CHIỀU — thiếu vế ✅ thì model bỏ trắng, mất đường về', () => {
  // Một luật chỉ có vế "đừng ghi" được chấp hành bằng cách không ghi gì, và
  // phiên sau không còn biết phải đi hỏi ai. Vế ✅ là thứ giữ lại đường về.
  assert.match(R, /⛔ "hiện còn 23 hoá đơn chưa thanh toán/);
  assert.match(R, /✅ "số hoá đơn chưa thanh toán: hỏi kết nối/);
  assert.match(R, /đừng trả lời từ trí nhớ/);
});

test('luật 5 chừa đúng ngoại lệ: con số NGƯỜI DÙNG chốt vẫn được giữ', () => {
  // Không có câu này thì luật 5 nuốt luôn "ngân sách mỗi task tối đa $0,5" —
  // một quyết định, không phải số liệu đi lấy về.
  assert.match(R, /Con số NGƯỜI DÙNG tự chốt thì vẫn chép lại theo luật 1/);
});

test('khối vẫn nói rõ cách trả lời khi KHÔNG có gì đáng nhớ', () => {
  // Hai câu trong cùng một prompt không được đá nhau: luật gộp bảo "chép lại",
  // nên nhánh KHÔNG phải nêu rõ điều kiện CẢ HAI đều trống.
  assert.match(R, /Nếu KHÔNG có trí nhớ cũ và phiên này cũng không có gì đáng nhớ/);
});
