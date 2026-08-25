/**
 * TÊN TÀI KHOẢN OAUTH — tất định, hợp lệ làm ô trống, và **nhận dạng lại được**.
 * → `src/core/oauth.ts §accountName · §isAccountName` · docs/SPEC-arms.md §5h
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Hai bug user báo 26/08, cả hai quy về cái tên này:                       │
 * │                                                                          │
 * │ ① *"Thiếu chìa: NOTION_OAUTH_AFAFBCD6"* sau khi đăng nhập THÀNH CÔNG —   │
 * │   `resolveArm` không đọc kho chìa nên ô trống không được thay.           │
 * │ ② Câu lỗi đó bảo người dùng đi điền một thứ **không tồn tại**:           │
 * │   *"Notion làm gì có chìa nào, human đọc sẽ rất khó hiểu"*.              │
 * │                                                                          │
 * │ ② vá được nhờ NHẬN DẠNG được tên — nên phép nhận dạng phải khớp đúng      │
 * │ thứ hàm mint sinh ra, và không khớp nhầm một chìa gõ tay.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { accountName, isAccountName } from '../dist/core/oauth.js';

const base = { issuer: 'https://mcp.notion.com', mcp_url: 'https://mcp.notion.com/mcp' };

test('tên hợp lệ làm Ô TRỐNG — chỉ [A-Z0-9_]', () => {
  /**
   * ⚠ `PLACEHOLDER` của `secrets.ts` là `\$\{([A-Z0-9_]+)\}`. Một ký tự ngoài
   * bộ đó ⇒ ô trống **không khớp** ⇒ chìa lặng lẽ không được tiêm ⇒ 401. Đó là
   * lý do tên đi qua băm rồi mới cắt, chứ không lấy thẳng `workspace_id` (id
   * thật có dấu `-` và chữ thường).
   */
  const n = accountName('notion', { ...base, extra: { workspace_id: 'a1b2c3d4-ee55-0000-9999-abcdefabcdef' } });
  assert.match(n, /^[A-Z0-9_]+$/);
  assert.match(n, /^NOTION_OAUTH_[0-9A-F]{8}$/);
});

test('TẤT ĐỊNH — cùng workspace ⇒ cùng tên, đăng nhập lại không đẻ mục mới', () => {
  // User đã xác nhận bằng tay 26/08: *"thử OAuth 2 lần cùng 1 workspace, không
  // sinh ra trùng lặp"*. Đây là ô giữ cho điều đó đúng mãi.
  const acc = { ...base, extra: { workspace_id: 'ws-1' } };
  assert.equal(accountName('notion', acc), accountName('notion', { ...acc }));
});

test('KHÁC workspace ⇒ KHÁC tên — hai không gian không bị gộp làm một', () => {
  /**
   * Đây là ca §6i cảnh báo từ 23/08: hai workspace Notion có **cùng URL**. Tên
   * chìa đi vào `secretNames` ⇒ vào `armHash`. Cùng tên ⇒ cùng băm ⇒ hai
   * workspace thành một cánh tay, hỏng im lặng ở chỗ đắt nhất.
   */
  const a = accountName('notion', { ...base, extra: { workspace_id: 'ws-1' } });
  const b = accountName('notion', { ...base, extra: { workspace_id: 'ws-2' } });
  assert.notEqual(a, b);
});

test('KHÔNG có workspace_id ⇒ vẫn tất định, rơi về issuer + mcp_url', () => {
  // Dịch vụ không trả workspace ⇒ một tài khoản mỗi server. Vẫn phải ổn định:
  // sinh tên ngẫu nhiên là mỗi lần đăng nhập đẻ một mục mới.
  const a = accountName('linear', base);
  assert.equal(a, accountName('linear', { ...base }));
  assert.match(a, /^LINEAR_OAUTH_[0-9A-F]{8}$/);
});

test('tiền tố bị làm sạch — mục danh mục có dấu gạch vẫn ra tên hợp lệ', () => {
  const n = accountName('google-drive', base);
  assert.match(n, /^GOOGLEDRIVE_OAUTH_[0-9A-F]{8}$/);
});

// ─────────────────────────── nhận dạng lại, cho câu lỗi

test('⭐ isAccountName: nhận đúng thứ accountName sinh ra', () => {
  for (const p of ['notion', 'linear', 'google-drive']) {
    assert.ok(isAccountName(accountName(p, base)), `không nhận ra tên do chính mình sinh: ${p}`);
  }
});

test('⭐ isAccountName: KHÔNG nhận nhầm một chìa gõ tay', () => {
  /**
   * Nhận nhầm thì câu lỗi bảo người dùng *"bấm Đăng nhập"* cho một chìa họ phải
   * **gõ** — tức lại đúng cái lỗi §5m mà phép tách này sinh ra để chữa, chỉ đảo
   * chiều. Hai câu phải ra đúng hai ca.
   */
  for (const n of ['NOTION_ACCESS_TOKEN', 'GITHUB_TOKEN', 'MY_OAUTH_KEY', 'OAUTH', 'X_OAUTH_ABCDEFG']) {
    assert.equal(isAccountName(n), false, `nhận nhầm "${n}" là tài khoản`);
  }
});
