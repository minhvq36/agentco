/**
 * ⭐ VÌ SAO TA PHẢI TỰ HỎI SERVER VỀ `annotations` — bằng mã, không bằng lời.
 * → `src/core/mcp-http.ts` · `src/core/probe.ts` · docs/SPEC-arms.md §6j
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BẢNG CHÂN TRỊ ĐÚNG. `tierOf` ĐÚNG. ĐẦU RA VẪN SAI.                       │
 * │ (user 26/08: *"ủa, bảng chân trị đúng mà code sai, ảo thế"*)             │
 * │                                                                          │
 * │ Thật ra **code cũng không sai**. `tierOf` làm đúng y hệt thứ nó phải làm │
 * │ với dữ kiện nó nhận được — và `test/level-one-way.test.ts` quét cả 27 tổ │
 * │ hợp, xanh hết, đúng hết. Lỗi nằm ở chỗ **thứ ba** mà không ai soi: **con  │
 * │ đường dữ liệu** giữa server và bộ phân loại.                             │
 * │                                                                          │
 * │   Notion khai   `{readOnlyHint:false, destructiveHint:false}`            │
 * │   SDK đưa ta    `{}`                    ← mọi giá trị `false` bị vứt      │
 * │   `tierOf({})`  → `full`                ← ĐÚNG LUẬT, và vô phương biết   │
 * │                                                                          │
 * │ ⚠ Luật một chiều làm nó hỏng theo chiều **AN TOÀN** (leo thang), nên nó   │
 * │ **im lặng**: không lỗi, không cảnh báo, chỉ mất một nấc. Cái mất là **đặc │
 * │ quyền tối thiểu** — 11 tool chỉ-tạo-mới bị đẩy vào ô sửa/xoá, và người   │
 * │ dùng muốn "cho tạo trang, đừng cho sửa" buộc phải cấp cả hai.            │
 * │                                                                          │
 * │ File test này tồn tại để `mcp-http.ts` không bị ai "dọn cho gọn" về sau.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { httpTarget } from '../dist/core/mcp-http.js';
import { tierOf } from '../dist/core/probe.js';

// ───────────────────────── ⭐ số đo 26/08, đóng băng thành test

test('⭐ SDK làm mất `false` ⇒ nấc giữa RỖNG. Đây là lý do mcp-http tồn tại.', () => {
  // Hình dạng SDK thật sự trả về, chép từ `spike-sdk-annotations.ts`:
  const fromSdk = [
    {}, // notion-create-pages  — server khai {readOnly:false, destructive:false}
    {}, // notion-create-database
    { openWorld: true }, // notion-create-attachment
    { destructive: true }, // notion-update-page
    { readOnly: true }, // notion-fetch
  ];
  const tiers = fromSdk.map((a) => tierOf(a));
  assert.deepEqual(tiers, ['full', 'full', 'full', 'full', 'read']);
  assert.equal(tiers.filter((t) => t === 'add').length, 0, 'qua SDK, nấc giữa không bao giờ có ai');
});

test('⭐ cùng những tool đó, đọc THÔ từ server ⇒ nấc giữa có người', () => {
  // Hình dạng server thật sự khai, chép từ `spike-notion-annotations.ts`, đã
  // ánh xạ `*Hint` → tên SDK đúng như `probe.ts` làm.
  const fromRaw = [
    { readOnly: false, destructive: false }, // notion-create-pages
    { readOnly: false, destructive: false }, // notion-create-database
    { readOnly: false, destructive: false, openWorld: true }, // notion-create-attachment
    { readOnly: false, destructive: true }, // notion-update-page
    { readOnly: true, destructive: false }, // notion-fetch
  ];
  assert.deepEqual(fromRaw.map((a) => tierOf(a)), ['add', 'add', 'add', 'full', 'read']);
});

test('bảng chân trị KHÔNG đổi — chỉ dữ liệu vào nó đổi', () => {
  /**
   * Ô này canh một chuyện dễ bị hiểu nhầm thành "nới lỏng luật": bản vá **không
   * đụng** `tierOf`. Cùng một hàm, cùng luật một chiều, chỉ khác đầu vào.
   * Ai sửa `tierOf` để "cho nấc giữa dễ vào hơn" sẽ làm ô này đỏ.
   */
  assert.equal(tierOf({}), 'full');
  assert.equal(tierOf({ readOnly: false }), 'full');
  assert.equal(tierOf({ destructive: false }), 'full');
  assert.equal(tierOf({ readOnly: false, destructive: false }), 'add');
  assert.equal(tierOf({ readOnly: true, destructive: true }), 'full');
});

// ───────────────────────────────────────────────── httpTarget

test('httpTarget: chỉ nhận cấu hình HTTP, kèm headers đã tiêm chìa', () => {
  assert.deepEqual(
    httpTarget({ type: 'http', url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } }),
    { url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } },
  );
});

test('httpTarget: stdio ⇒ undefined — không hỏi thẳng được qua fetch', () => {
  // Cánh tay stdio phải spawn tiến trình và nói MCP qua đường ống, tức dựng lại
  // nguyên một client thứ hai. Không đáng: `filesystem` là cánh tay stdio duy
  // nhất hôm nay, và nó không có nấc.
  assert.equal(httpTarget({ command: 'npx', args: ['-y', 'pkg'] }), undefined);
  assert.equal(httpTarget(null), undefined);
  assert.equal(httpTarget(undefined), undefined);
});

test('httpTarget: header không phải chuỗi bị BỎ, không ép kiểu', () => {
  // Nhét một object vào header là gửi `[object Object]` lên server — một chuỗi
  // rác đi qua mạng dưới danh nghĩa xác thực.
  assert.deepEqual(httpTarget({ url: 'https://x', headers: { A: 1, B: 'ok' } }), {
    url: 'https://x',
    headers: { B: 'ok' },
  });
});

test('httpTarget: không headers ⇒ object rỗng, không phải undefined', () => {
  // Chỗ gọi spread thẳng vào `fetch`, nên `undefined` ở đây là một nhánh phải
  // nhớ xử lý ở nơi khác. Trả rỗng là bỏ luôn cái nhánh đó.
  assert.deepEqual(httpTarget({ url: 'https://x' }), { url: 'https://x', headers: {} });
});
