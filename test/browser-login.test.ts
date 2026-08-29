/**
 * Test cho **cửa đăng nhập bằng tay** — `src/core/browser-login.ts`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ca sinh ra tính năng này (user, 29/08, sau bốn lần thử):                 │
 * │   *"Kìa, tui đang đăng nhập dở bằng sđt mà, chờ xíu đi"*                 │
 * │   *"tôi đến được bước setup địa chỉ, đang định skip thì nó lại tắt"*     │
 * │                                                                          │
 * │ Vòng đời trình duyệt của nhân viên = vòng đời một LƯỢT VIỆC. Không có chỗ │
 * │ nào trong đó để một con người thao tác.                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import path from 'node:path';
import test from 'node:test';

import {
  BROWSER_CANDIDATES,
  LoginError,
  findBrowser,
  loginOpen,
  profileDir,
  startLogin,
} from '../dist/core/browser-login.js';
import { BROWSER_ARM, buildConfig } from '../dist/core/catalog.js';
import { injectSecrets } from '../dist/core/secrets.js';

// ────────────────────────────────────────── ba hệ điều hành

test('⭐ có ứng viên trình duyệt cho CẢ BA hệ điều hành', () => {
  for (const os of ['win32', 'darwin', 'linux']) {
    assert.ok(BROWSER_CANDIDATES[os]?.length, `thiếu danh sách cho ${os}`);
  }
});

/**
 * ⭐ HAI FILE PHẢI NHÌN NHAU. Mục danh mục bảo Playwright dùng channel nào
 * (`arms/browser.ts §argsByOs`) thì cửa đăng nhập phải mở **đúng trình duyệt ấy**.
 *
 * Lệch nhau ⇒ đăng nhập vào hồ sơ bằng Edge rồi chạy việc bằng Chrome: hai trình
 * duyệt, một thư mục hồ sơ — Chromium từ chối, hoặc tệ hơn là làm hỏng hồ sơ. Và
 * triệu chứng sẽ là *"đăng nhập rồi mà vẫn chưa đăng nhập"*, đúng thứ khó truy nhất.
 */
test('⭐ channel của cánh tay và trình duyệt của cửa đăng nhập KHỚP nhau', () => {
  const chanOf = (platform: string): string | undefined => {
    const args = (buildConfig(BROWSER_ARM.spec, { folders: [], platform }) as { args: string[] }).args;
    const i = args.indexOf('--browser');
    return i >= 0 ? args[i + 1] : undefined;
  };
  // win32 → msedge, và ứng viên đầu tiên của win32 phải là Edge.
  assert.equal(chanOf('win32'), 'msedge');
  assert.match(BROWSER_CANDIDATES['win32']![0]!, /msedge\.exe$/i);
  // darwin → chrome, ứng viên đầu tiên phải là Chrome.
  assert.equal(chanOf('darwin'), 'chrome');
  assert.match(BROWSER_CANDIDATES['darwin']![0]!, /Google Chrome$/);
});

test('linux trả TÊN LỆNH, không phải đường dẫn đoán mò', () => {
  const first = findBrowser('linux');
  assert.equal(first, 'google-chrome');
  assert.ok(!first!.includes('/'), 'đoán một đường dẫn tuyệt đối trên Linux là đoán sai');
});

test('hệ điều hành lạ ⇒ không có ứng viên nào, và nói ra bằng `undefined`', () => {
  assert.equal(findBrowser('sunos'), undefined);
});

// ────────────────────────────────────────── hồ sơ: MỘT chỗ tính

/**
 * ⭐ Cửa đăng nhập và cánh tay phải trỏ vào **cùng một thư mục**. Hai phép tính
 * cho cùng một đường dẫn là hai chỗ để lệch, và khi lệch thì người dùng đăng nhập
 * vào một hồ sơ còn nhân viên đọc một hồ sơ khác — **không câu lỗi nào**.
 */
test('⭐ hồ sơ của cửa đăng nhập TRÙNG hồ sơ cánh tay dùng lúc chạy', () => {
  const stateDir = path.join('C:', 'cty', 'offices', 'ke-toan', '.state', 'browser');
  const cfg = buildConfig(BROWSER_ARM.spec, {
    folders: [],
    options: (BROWSER_ARM.options ?? []).filter((o) => o.id === 'nho-dang-nhap'),
    platform: 'win32',
  });
  const { args } = injectSecrets(cfg, {}, { officeState: stateDir }) as { args: string[] };
  const cua = profileDir(stateDir);
  const canhTay = args[args.indexOf('--user-data-dir') + 1];
  assert.equal(cua, canhTay);
});

// ────────────────────────────────────────── cổng từ chối

test('đang chạy việc ⇒ TỪ CHỐI, và câu nói ra việc phải làm', () => {
  assert.throws(
    () =>
      startLogin({
        office: 'vp-test-working',
        officeStateDir: path.join('C:', 'tmp', 'x'),
        url: 'https://youtube.com',
        working: true,
      }),
    (e: Error) => e instanceof LoginError && /đang chạy việc/i.test(e.message),
  );
  assert.equal(loginOpen('vp-test-working'), false, 'từ chối rồi mà vẫn ghi khoá');
});

test('URL không phải http/https ⇒ TỪ CHỐI', () => {
  for (const bad of ['file:///C:/', 'javascript:alert(1)', 'khong-phai-url']) {
    assert.throws(
      () =>
        startLogin({
          office: 'vp-test-url',
          officeStateDir: path.join('C:', 'tmp', 'x'),
          url: bad,
          working: false,
        }),
      LoginError,
      `"${bad}" lọt qua`,
    );
  }
  // `file://` là mở đĩa của MÁY CHỦ bằng một cửa sổ có toàn quyền hồ sơ —
  // không phải thứ nút này sinh ra để làm.
  assert.equal(loginOpen('vp-test-url'), false);
});

test('hệ điều hành không có trình duyệt ⇒ câu lỗi nói TÊN thứ cần cài', () => {
  assert.throws(
    () =>
      startLogin({
        office: 'vp-test-nobrowser',
        officeStateDir: path.join('C:', 'tmp', 'x'),
        url: 'https://youtube.com',
        working: false,
        platform: 'sunos',
      }),
    (e: Error) => e instanceof LoginError && /Edge|Chrome/.test(e.message),
  );
});
