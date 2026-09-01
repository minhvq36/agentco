/**
 * Test cho **cắt query khỏi log console của trình duyệt** — `src/core/redact.ts`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ca thật, đọc được trên đĩa 29/08 trong `.playwright-mcp/console-*.log`:  │
 * │   …/ajax/bnzai?…&fb_dtsg=NAfzqk…&__user=100005161517189&…                │
 * │ Chìa phiên đăng nhập dưới dạng chữ, trong thư mục nhân viên đọc được —    │
 * │ trong khi **cookie thì đã được gác** ở `.state/browser/profile`.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cutQuery, redactBrowserLogs, resetRedactMarks } from '../dist/core/redact.js';
import { guardedZone } from '../dist/core/paths.js';

// ────────────────────────────────────────── hàm thuần

test('⭐ cắt query — đúng ca thật đã đọc được trên đĩa', () => {
  const truoc =
    '[ERROR] Failed to load resource @ https://www.facebook.com/ajax/bnzai?__a=1&fb_dtsg=NAfzqk5dbDDn84&__user=100005161517189';
  const sau = cutQuery(truoc);
  assert.ok(!sau.includes('fb_dtsg'), 'còn token trong log');
  assert.ok(!sau.includes('100005161517189'), 'còn id người dùng trong log');
  // Giữ đủ để gỡ lỗi: biết trang nào, endpoint nào.
  assert.ok(sau.includes('https://www.facebook.com/ajax/bnzai'));
});

/**
 * ⭐ Token OAuth kiểu implicit nằm sau `#`, không sau `?`. Một luật chỉ nhìn `?`
 * sẽ bỏ sót **đúng loại nguy nhất** — và bỏ sót im lặng.
 */
test('⭐ cắt cả FRAGMENT, không chỉ query', () => {
  const sau = cutQuery('mở https://x.test/cb#access_token=abc123&expires_in=3600 xong');
  assert.ok(!sau.includes('access_token'));
  assert.ok(sau.includes('https://x.test/cb'));
});

test('cắt ở dấu đến TRƯỚC khi có cả hai', () => {
  assert.equal(cutQuery('https://a.test/p?q=1#f=2'), 'https://a.test/p');
  assert.equal(cutQuery('https://a.test/p#f=2?q=1'), 'https://a.test/p');
});

test('URL sạch KHÔNG bị đụng, và chữ quanh nó cũng vậy', () => {
  const s = 'xem https://a.test/duong/dan roi thoi';
  assert.equal(cutQuery(s), s);
});

/**
 * ⭐ BẤT BIẾN: LUỸ ĐẲNG. Hook quét lại cùng một file là chuyện bình thường; một
 * hàm dọn không luỹ đẳng sẽ gặm dần nội dung qua mỗi lượt cho tới ngày file rỗng
 * mà không ai nối được nguyên nhân với triệu chứng.
 */
test('⭐ chạy hai lần ra đúng một kết quả', () => {
  const s = '[ERROR] https://a.test/x?tok=1 và https://b.test/y#z=2';
  assert.equal(cutQuery(cutQuery(s)), cutQuery(s));
});

test('không có URL nào ⇒ trả nguyên văn', () => {
  const s = '[LOG] chi la mot dong chu binh thuong';
  assert.equal(cutQuery(s), s);
});

// ────────────────────────────────────────── quét thư mục

test('⭐ chỉ đụng `console-*.log`, KHÔNG đụng snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-redact-'));
  const out = path.join(dir, '.playwright-mcp');
  fs.mkdirSync(out, { recursive: true });

  const log = path.join(out, 'console-2026-08-29T09-58-07-520Z.log');
  const snap = path.join(out, 'page-2026-08-29T09-58-26-993Z.yml');
  fs.writeFileSync(log, '[ERROR] https://x.test/a?fb_dtsg=SECRET');
  // Snapshot có thể chứa URL — nhưng worker PHẢI đọc nó nguyên vẹn, vì đó là
  // toàn bộ giá trị của cơ chế spill. Sửa nó là làm nhân viên đọc trang ra sai.
  const snapNoiDung = 'link "Trang chủ" /url: https://x.test/a?ref=home';
  fs.writeFileSync(snap, snapNoiDung);

  resetRedactMarks();
  const n = redactBrowserLogs(dir);
  assert.equal(n, 1, 'phải sửa đúng một file');
  assert.ok(!fs.readFileSync(log, 'utf8').includes('SECRET'));
  assert.equal(fs.readFileSync(snap, 'utf8'), snapNoiDung, 'snapshot bị sửa — worker sẽ đọc sai');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('không có thư mục ⇒ về ngay, 0 file — ca của gần hết văn phòng', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-redact-'));
  resetRedactMarks();
  assert.equal(redactBrowserLogs(dir), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Hàm này chạy sau **mỗi lời gọi tool**, kể cả lượt chẳng liên quan trình duyệt.
 * Quét lại file đã dọn ở mọi lượt là trả tiền cho một việc đã xong.
 */
test('⭐ file đã dọn KHÔNG bị đọc lại ở lượt sau', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-redact-'));
  const out = path.join(dir, '.playwright-mcp');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'console-a.log'), '[ERROR] https://x.test/a?tok=1');

  resetRedactMarks();
  assert.equal(redactBrowserLogs(dir), 1);
  assert.equal(redactBrowserLogs(dir), 0, 'quét lại file cũ ⇒ tốn I/O mỗi lời gọi tool');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ────────────────────────────────────────── hàng rào của hồ sơ

/**
 * ⭐ USER HỎI 29/08: *"đừng cho worker vào đọc browser, rất nặng, tốn token
 * (thực ra đã guard ở `.state` thư mục cha rồi nên không lo?)"* — ĐÚNG.
 *
 * Hồ sơ trình duyệt nằm ở `<văn phòng>/.state/browser/profile`, và `guardedZone`
 * kiểm **cả** `.state` của công ty **lẫn** của văn phòng. Đo 29/08: một hồ sơ
 * phình lên **555 MB** sau một buổi — thứ một lần `Grep` đi lạc vào là cháy trần.
 *
 * Test này ghim tính chất đó, vì nó vỡ **im lặng** vào ngày ai đó dời hồ sơ ra
 * một chỗ "tiện hơn".
 */
test('⭐ hồ sơ trình duyệt NẰM SAU guardedZone — nhân viên không đọc được', () => {
  const dirs = { companyDir: path.join('C:', 'cty'), officeDir: path.join('C:', 'cty', 'offices', 'kt') };
  for (const target of [
    path.join('.state', 'browser', 'profile'),
    path.join('.state', 'browser', 'profile', 'Default', 'Network', 'Cookies'),
    path.join(dirs.officeDir, '.state', 'browser', 'profile'),
  ]) {
    assert.equal(guardedZone(dirs, target, 'read'), 'secrets', `"${target}" lọt qua hàng rào`);
  }
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `.playwright-mcp` — SIẾT LẠI 30/08, HAI ĐIỀU KIỆN. (user hỏi đúng chỗ)   │
   * │                                                                          │
   * │ Bản trước một dòng: *"thư mục snapshot KHÔNG bị gác — worker phải đọc     │
   * │ được"*. Câu đó bỏ sót hai chuyện, cả hai đo được trên đĩa 30/08:          │
   * │                                                                          │
   * │  ① Thư mục có **20 `console-*.log`** cạnh 21 `page-*.yml`, và log giữ     │
   * │     chìa phiên dạng chữ — chính ca đẻ ra file `redact.ts` này. Kể cả      │
   * │     người CẦM cánh tay cũng không cần đọc chúng.                         │
   * │  ② Ảnh chụp trang có **PII thật** (email tự-điền trong form đăng nhập     │
   * │     Facebook). Nhân viên KHÔNG có cánh tay trình duyệt không có việc gì   │
   * │     với nó.                                                              │
   * │                                                                          │
   * │ ⇒ Mặc định từ chối trong thư mục đó, chừa đúng một lối ra: `page-*.yml`,  │
   * │   và chỉ cho người cầm cánh tay. Kiểu file mới thêm sau này (trace, har,  │
   * │   video) **tự động** bị chặn — allowlist, không phải denylist.            │
   * │   → [[agentco-silent-allowlist]]                                         │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const withArm = { ...dirs, hasBrowser: true };

  // ① CÓ cánh tay: đọc được ảnh chụp — thứ nó cần để làm việc.
  assert.equal(guardedZone(withArm, path.join('.playwright-mcp', 'page-1.yml'), 'read'), undefined);

  // ② CÓ cánh tay nhưng log console vẫn CHẶN — chìa phiên dạng chữ.
  assert.equal(guardedZone(withArm, path.join('.playwright-mcp', 'console-1.log'), 'read'), 'browser');

  // ③ KHÔNG cánh tay: chặn cả ảnh chụp. Đầu ra của một cánh tay thuộc về người cầm nó.
  assert.equal(guardedZone(dirs, path.join('.playwright-mcp', 'page-1.yml'), 'read'), 'browser');

  // ④ Không khai `hasBrowser` ⇒ coi như KHÔNG có. Vắng mặt không phải tín hiệu an toàn.
  assert.equal(guardedZone(dirs, path.join('.playwright-mcp', 'x.trace.zip'), 'read'), 'browser');

  // ⑤ Kiểu file lạ, dù CÓ cánh tay ⇒ vẫn chặn (allowlist, không phải denylist).
  assert.equal(guardedZone(withArm, path.join('.playwright-mcp', 'x.har'), 'read'), 'browser');

  // ⑥ Ngoài thư mục đó, `page-*.yml` không có đặc quyền gì — tên file không phải hộ chiếu.
  assert.equal(guardedZone(withArm, path.join('artifacts', 'page-1.yml'), 'read'), undefined);
});
