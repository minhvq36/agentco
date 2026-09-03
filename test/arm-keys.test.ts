/**
 * ⭐ MODEL PHẢI PHÂN BIỆT ĐƯỢC HAI CÁNH TAY CÙNG LOẠI. (bug user bắt 26/08)
 * → `src/core/assistant.ts §armReach`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ca thật: một nhân viên cầm hai cánh tay Notion (workspace *Acme* và      │
 * │ *Notion2*). User bảo *"tạo trang ở Acme và ở Notion2"*, model nhìn thấy: │
 * │                                                                          │
 * │     mcp__ad95f16558d__notion-create-pages                               │
 * │     mcp__a46a7e26403__notion-create-pages                               │
 * │                                                                          │
 * │ **Hai cái băm.** Nó chọn bừa và **ghi nhầm workspace** — hậu quả nằm     │
 * │ NGOÀI hệ thống, không hoàn tác được.                                    │
 * │                                                                          │
 * │ ⚠ BẢN VÁ KHÔNG ĐỔI KHOÁ. Bản đầu đổi khoá `mcpServers` sang slug của     │
 * │ nhãn; user bác và bác đúng — cầu nối ở dòng danh bạ vẫn cần trong MỌI ca │
 * │ (nhãn phi-Latin ⇒ slug rỗng · nhãn trùng ⇒ cả hai về băm), nên slug chỉ  │
 * │ là tối ưu một phần chồng lên một cơ chế đã đủ, đổi lấy ba điểm quy đổi   │
 * │ mà một trong số đó hỏng theo chiều **cấp thừa quyền**.                   │
 * │                                                                          │
 * │ > *"tên là cái nhà, băm là địa chỉ nhà"* — user. Cuốn danh bạ nối hai    │
 * │ > thứ đó lại, và nó không cần đổi địa chỉ để làm việc ấy.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { armReach } from '../dist/core/assistant.js';

const SRV = { a1: { type: 'http', url: 'https://x' }, a2: { type: 'http', url: 'https://y' } };

test('⭐ HAI cánh tay ⇒ mỗi dòng nói ra cách gọi, và hai dòng KHÁC nhau', () => {
  const arms = { a1: { label: 'Acme' }, a2: { label: 'Notion2' } };
  const l1 = armReach(arms, SRV, 'a1', 'a1');
  const l2 = armReach(arms, SRV, 'a2', 'a2');
  assert.match(l1, /Acme/);
  assert.match(l1, /mcp__a1__/);
  assert.match(l2, /mcp__a2__/);
  assert.notEqual(l1, l2, 'hai dòng giống hệt nhau thì reachDiff cũng không thấy gì');
});

test('⭐ nhãn PHI-LATIN vẫn bắc được cầu — cái tên không mang được thì đặt cạnh nó', () => {
  // Đây là ca user hỏi: *"phi-latin mà tên không ảnh hưởng tới băm ⇒ hết cách"*.
  // Không hết: cầu nối không đi qua cái tên.
  const arms = { a1: { label: '文档', level: 'read' as const }, a2: { label: '회계' } };
  const line = armReach(arms, SRV, 'a1', 'a1');
  assert.match(line, /文档/, 'phải giữ nguyên tên người dùng đặt');
  assert.match(line, /mcp__a1__/);
  assert.match(line, /read only/, 'mức quyền không được bị cầu nối nuốt mất');
});

test('⭐ TRÙNG NHÃN vẫn phân biệt được — cầu nối đi qua BĂM, không qua tên', () => {
  // Ca user hỏi: *"bạn đã tính tới case đặt tên trùng chưa"*. Hai cánh tay cùng
  // tên "Notion" vẫn ra hai dòng khác nhau, vì địa chỉ thì không trùng được.
  const arms = { a1: { label: 'Notion' }, a2: { label: 'Notion' } };
  const l1 = armReach(arms, SRV, 'a1', 'a1');
  const l2 = armReach(arms, SRV, 'a2', 'a2');
  assert.notEqual(l1, l2);
  assert.match(l1, /mcp__a1__/);
  assert.match(l2, /mcp__a2__/);
});

test('MỘT cánh tay ⇒ KHÔNG dán cầu nối', () => {
  // Không có gì để nhầm. Dán chuỗi kỹ thuật vào mọi dòng là trả token cho thứ
  // vô ích, và dạy model rằng những chuỗi đó là nhiễu — rồi nó bỏ qua đúng lúc
  // chuỗi đó có nghĩa.
  assert.equal(armReach({ a1: { label: 'Musics' } }, SRV, 'a1'), 'Musics');
});

test('cầu nối KHÔNG phá dòng có mức quyền VÀ thư mục', () => {
  const arms = { a1: { label: 'Kho', level: 'full' as const } };
  const line = armReach(arms, { a1: { args: ['D:\\Kho'] } }, 'a1', 'a1');
  assert.match(line, /edit\/delete/);
  assert.match(line, /D:\\Kho/);
  assert.match(line, /mcp__a1__/);
});

test('cầu nối dùng ĐÚNG chuỗi model nhìn thấy trong tên tool', () => {
  /**
   * Tên tool thật là `mcp__<băm>__<việc>`. Cầu nối phải in đúng tiền tố đó —
   * lệch một ký tự thì model không ghép được, và nó lại chọn bừa. Ô này canh
   * hình dạng chuỗi, thứ không ai kiểm bằng mắt.
   */
  const line = armReach({ a1: { label: 'X' } }, SRV, 'ad95f16558d', 'ad95f16558d');
  assert.ok(line.includes('mcp__ad95f16558d__'), line);
});
