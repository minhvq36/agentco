/**
 * BA NẤC QUYỀN — lũy tiến, một chiều, và **nấc rỗng không được tồn tại**.
 * → `src/core/probe.ts` · `src/core/catalog.ts §armHash` · docs/SPEC-arms.md §6j
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ba luật user chốt, và file này là thứ giữ chúng đúng khi giao diện đổi:  │
 * │                                                                          │
 * │  ① *"khi không biết, nói toàn quyền là không nói dối — điều tương tự     │
 * │     cũng đúng với nấc 2"* ⇒ nấc 2 đòi ĐỦ HAI lời khai tường minh.        │
 * │  ② *"tầng nào 0 việc thì đừng cho chọn"* — và nó phải sắc hơn thế:       │
 * │     phép kiểm là **`đếm(nấc) > đếm(nấc dưới)`**, không phải `> 0`.       │
 * │  ③ *"đổi mức quyền ở văn phòng này KHÔNG đổi ở văn phòng khác"* ⇒ nấc    │
 * │     phải nằm trong `armHash`.                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { offeredTiers, tierOf, toolsAtTier } from '../dist/core/probe.js';
import { armHash } from '../dist/core/catalog.js';

const tool = (name: string, tier: 'read' | 'add' | 'full') => ({ name, tier, level: 'read' as never });

/** Notion đo 25/08: 28 việc — 14 đọc · 11 thêm · 3 sửa/xoá. */
const NOTION = [
  ...Array.from({ length: 14 }, (_, i) => tool(`r${i}`, 'read')),
  ...Array.from({ length: 11 }, (_, i) => tool(`a${i}`, 'add')),
  ...Array.from({ length: 3 }, (_, i) => tool(`f${i}`, 'full')),
];

// ───────────────────────────────────────────────────── lũy tiến

test('nấc sau BAO GỒM nấc trước — đó là nghĩa của "lũy tiến"', () => {
  assert.equal(toolsAtTier(NOTION, 'read').length, 14);
  assert.equal(toolsAtTier(NOTION, 'add').length, 25);
  assert.equal(toolsAtTier(NOTION, 'full').length, 28);
});

test('mỗi nấc là TẬP CON của nấc trên nó — không có việc nào rơi ra ngoài', () => {
  const read = new Set(toolsAtTier(NOTION, 'read'));
  const add = new Set(toolsAtTier(NOTION, 'add'));
  for (const n of read) assert.ok(add.has(n), `"${n}" có ở nấc read mà mất ở nấc add`);
});

// ────────────────────────── ② nấc rỗng / nấc không thêm gì

test('⭐ nấc KHÔNG THÊM VIỆC NÀO thì không được hiện — dù nó không rỗng', () => {
  /**
   * Ca user không nêu nhưng luật của user phải bao được: server **toàn tool
   * đọc**. Ba nấc đều 14 việc — hai nấc dưới KHÔNG rỗng nên lọt luật "0 việc",
   * trong khi chúng **hứa thêm quyền mà không đưa gì**. Đúng thứ noisy đã cấm,
   * chỉ khoác một con số khác 0.
   */
  const allRead = Array.from({ length: 14 }, (_, i) => tool(`r${i}`, 'read'));
  assert.deepEqual(offeredTiers(allRead), [{ tier: 'read', count: 14 }]);
});

test('⭐ server KHÔNG KHAI GÌ ⇒ chỉ còn nấc `full`, và nó là CẢNH BÁO chứ không phải lựa chọn', () => {
  // Mọi việc rơi vào `full` ⇒ hai nấc đầu ra 0 ⇒ không hiện. Giao diện phải đọc
  // "chỉ còn full" thành *"đi thẳng sang tick tay"*, không thành *"chọn full"*.
  const nothing = Array.from({ length: 28 }, (_, i) => tool(`x${i}`, 'full'));
  assert.deepEqual(offeredTiers(nothing), [{ tier: 'full', count: 28 }]);
});

test('Notion khai đủ ⇒ hiện cả ba nấc, đúng số việc', () => {
  assert.deepEqual(offeredTiers(NOTION), [
    { tier: 'read', count: 14 },
    { tier: 'add', count: 25 },
    { tier: 'full', count: 28 },
  ]);
});

test('không có việc nào ⇒ không nấc nào — đừng vẽ một bộ chọn rỗng', () => {
  assert.deepEqual(offeredTiers([]), []);
});

// ────────────────── ① một chiều: không biết thì LEO THANG

test('nấc 2 đòi ĐỦ HAI lời khai; thiếu một vế là lên nấc 3', () => {
  assert.equal(tierOf({ readOnly: true }), 'read');
  assert.equal(tierOf({ readOnly: false, destructive: false }), 'add');
  assert.equal(tierOf({ readOnly: false }), 'full', 'thiếu destructive ⇒ không biết');
  assert.equal(tierOf({ destructive: false }), 'full', 'thiếu readOnly ⇒ không biết');
  assert.equal(tierOf({}), 'full');
  assert.equal(tierOf(undefined), 'full');
  assert.equal(tierOf({ readOnly: true, destructive: true }), 'full', 'mâu thuẫn ⇒ leo thang');
});

// ──────────────── ③ nấc vào băm, và băm cũ KHÔNG được đổi

test('⭐ khác nấc ⇒ KHÁC BĂM — nếu không, hai mức đè nhau im lặng', () => {
  const cfg = { type: 'http', url: 'https://mcp.notion.com/mcp' };
  const s = ['NOTION_OAUTH_A1B2C3D4'];
  const hashes = new Set([armHash(cfg, s, 'read'), armHash(cfg, s, 'add'), armHash(cfg, s, 'full')]);
  assert.equal(hashes.size, 3);
});

test('⭐ CÙNG nấc ⇒ CÙNG BĂM — A→B→A không đẻ mục thứ ba', () => {
  // Đây là thứ làm cho "rác có trần": tối đa 3 mục cho một (cấu hình + chìa),
  // bằng đúng số nấc. Quay lại mức cũ là rơi về đúng cái đã có trong sổ.
  const cfg = { type: 'http', url: 'https://mcp.notion.com/mcp' };
  assert.equal(armHash(cfg, ['X'], 'read'), armHash({ ...cfg }, ['X'], 'read'));
});

test('🔴 KHÔNG nấc ⇒ băm y hệt bản trước 26/08 — không di trú, không mồ côi', () => {
  /**
   * Bất biến tương thích ngược, và nó **im lặng khi hỏng**: mọi cánh tay đã tồn
   * tại phải giữ nguyên mã. Lệch một chút là `company.yaml` của người dùng mồ
   * côi sau một lần nâng cấp — `role.mcp` trỏ vào những băm không còn ai sinh ra.
   *
   * Nó đúng nhờ `JSON.stringify` bỏ khoá `undefined`. Đó là hành vi ta đang
   * DỰA VÀO, nên nó phải có test chứ không phải một lời chú thích.
   */
  const cfg = { command: 'npx', args: ['-y', 'pkg', 'D:\\Ho so'] };
  // Băm của một cánh tay `filesystem` tạo trước 26/08. Chuỗi này được chốt cứng
  // CỐ Ý: nó là bản ghi lịch sử, không phải một giá trị tính lại được — nếu ai
  // đó đổi công thức băm thì ô này đỏ, và đó chính là điều ta muốn nghe.
  assert.equal(armHash(cfg, []), 'a38672f9bfb');
  assert.equal(armHash(cfg, [], undefined), armHash(cfg, []));
  assert.equal(armHash(cfg, ['A'], undefined), armHash(cfg, ['A']));
  assert.notEqual(armHash(cfg, ['A']), armHash(cfg, ['A'], 'read'));
});
