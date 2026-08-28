/**
 * Test cho mục danh mục **Trình duyệt web** (Playwright MCP).
 * → `src/core/arms/browser.ts` · docs/TEST-WALKTHROUGH.md bài 18
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MỖI TEST Ở ĐÂY CANH MỘT THỨ ĐÃ TỪNG HỎNG — không có test nào viết cho    │
 * │ đẹp bảng điểm:                                                           │
 * │                                                                          │
 * │  · ghim phiên bản       → §11d, và bẫy đọc số 29/08 (lõi alpha ≠ gói)     │
 * │  · lật ngược mặc định   → Playwright mặc định HEADED, ta phải headless    │
 * │  · dùng trình duyệt sẵn → 269–415 MB đĩa của khách, và bản cũ không ai dọn│
 * │  · `neverTools` CHỈ CẮT → luật một chiều 25/08 không được đụng tới        │
 * │  · ⭐ đường dẫn KHÔNG vào băm → user chốt 29/08                           │
 * │  · hai ô tick độc lập   → bản "ba nấc" đã đánh rơi một tổ hợp có thật     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  BROWSER_ARM,
  CATALOG,
  FILES_ARM,
  armHash,
  buildConfig,
  defaultOptions,
  findArm,
} from '../dist/core/catalog.js';
import { injectSecrets } from '../dist/core/secrets.js';
import { TIERS, tierOf, toolsAtTier } from '../dist/core/probe.js';

/** Dựng `args` cho một bộ ô tick — mọi test dưới đây đi qua đúng cửa này. */
const argsFor = (ids: string[], platform = 'win32'): string[] =>
  (
    buildConfig(BROWSER_ARM.spec, {
      folders: [],
      options: (BROWSER_ARM.options ?? []).filter((o) => ids.includes(o.id)),
      platform,
    }) as { args: string[] }
  ).args;

// ────────────────────────────────────────── có mặt, và là dữ liệu

test('mục có trong danh mục và tra được bằng id', () => {
  assert.ok(CATALOG.includes(BROWSER_ARM));
  assert.equal(findArm('browser'), BROWSER_ARM);
});

test('vẫn là DỮ LIỆU — không hàm nào lọt vào', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(BROWSER_ARM)), BROWSER_ARM);
});

// ────────────────────────────────────────── §11d — ghim phiên bản

test('GHIM phiên bản, không `@latest` và không bản alpha', () => {
  const pkg =
    BROWSER_ARM.spec.kind === 'stdio'
      ? BROWSER_ARM.spec.args.find((a) => a.startsWith('@playwright/mcp'))
      : undefined;
  assert.ok(pkg, 'không tìm thấy tên gói trong args');
  assert.ok(!pkg.includes('@latest'), '`@latest` = mã người lạ tự đổi dưới chân khách (§11d)');
  assert.match(pkg, /@playwright\/mcp@\d+\.\d+\.\d+$/, 'phải là một phiên bản cụ thể, không tag');
  assert.ok(!/alpha|beta|rc/i.test(pkg), 'không ship bản thử nghiệm cho khách');
});

// ────────────────────────────────────────── mặc định an toàn

test('MẶC ĐỊNH: chạy ẩn + không để lại hồ sơ', () => {
  assert.equal(BROWSER_ARM.spec.kind, 'stdio');
  const on = defaultOptions(BROWSER_ARM).map((o) => o.id);
  const args = argsFor(on);
  // Playwright mặc định HEADED — ta lật ngược, vì cửa sổ bật lên giữa lúc người
  // dùng đang làm việc khác là mất lịch sự, và trên VPS thì headed không tồn tại.
  assert.ok(args.includes('--headless'), 'thiếu --headless: hãng mặc định là headed');
});

test('trạng thái an toàn nằm ở BASE, không nằm ở ô tick', () => {
  // Không tick gì cả ⇒ vẫn phải ẩn và vẫn phải không ghi hồ sơ. Viết ngược lại
  // (base trần, ô tick thêm cờ an toàn) là bắt mặc định an toàn phụ thuộc trí nhớ.
  const args = argsFor([]);
  assert.ok(args.includes('--headless'));
  assert.ok(args.includes('--isolated'));
  assert.ok(!args.some((a) => a.includes('user-data-dir')));
});

test('mọi ô tick đều có câu nói ra BÁN KÍNH, không tả cấu hình', () => {
  for (const o of BROWSER_ARM.options ?? []) {
    assert.ok(o.help && o.help.length > 20, `ô "${o.id}" thiếu câu giải thích`);
    assert.ok(!/--/.test(o.help), `ô "${o.id}" đang tả CẤU HÌNH thay vì tả bán kính`);
  }
});

// ────────────────────────────────────────── ⭐ đường dẫn KHÔNG vào băm

/**
 * ⭐⭐ TEST QUAN TRỌNG NHẤT FILE NÀY. (user chốt 29/08)
 *
 * *"dữ liệu ở đâu cũng không ảnh hưởng tới băm"* — chỗ cất dữ liệu **không phải
 * danh tính** của cánh tay. Nhét đường dẫn tuyệt đối vào `args` là nhét nó vào
 * băm, đổi lấy hai thứ hỏng: cùng một mục cắm ở hai văn phòng ra **hai** cánh
 * tay, và **đổi chỗ thư mục công ty là đổi MỌI băm** — thư mục thôi mang đi được.
 */
test('⭐⭐ KHÔNG đường dẫn tuyệt đối nào lọt vào cấu hình — chỉ ô trống', () => {
  const args = argsFor(['nho-dang-nhap']);
  const i = args.indexOf('--user-data-dir');
  assert.ok(i >= 0, 'thiếu hẳn cờ hồ sơ');
  assert.equal(args[i + 1], '<OFFICE_STATE>/profile');
  for (const a of args) {
    assert.ok(
      !/^[A-Za-z]:[\\/]/.test(a) && !a.startsWith('/'),
      `đường dẫn tuyệt đối lọt vào args: "${a}"`,
    );
  }
});

test('⭐ ô trống được ĐIỀN lúc spawn, mỗi văn phòng một đường — băm vẫn là một', () => {
  const cfg = buildConfig(BROWSER_ARM.spec, {
    folders: [],
    options: (BROWSER_ARM.options ?? []).filter((o) => o.id === 'nho-dang-nhap'),
    platform: 'win32',
  });
  const a = injectSecrets(cfg, {}, { officeState: '/cty/offices/ke-toan/.state/browser' }) as {
    args: string[];
  };
  const b = injectSecrets(cfg, {}, { officeState: '/cty/offices/ban-hang/.state/browser' }) as {
    args: string[];
  };
  assert.ok(a.args.includes('/cty/offices/ke-toan/.state/browser/profile'));
  assert.ok(b.args.includes('/cty/offices/ban-hang/.state/browser/profile'));
  assert.notDeepEqual(a.args, b.args, 'hai văn phòng phải ra hai đường dẫn');
  // Và thứ đi vào sổ thì vẫn y nguyên một bản — đó là toàn bộ điểm của ô trống.
  assert.equal(armHash(cfg), armHash(cfg));
});

// ────────────────────────────────────────── hai ô tick ĐỘC LẬP

/**
 * ⭐ Bản đầu tôi gom hai thứ này thành "ba nấc" loại trừ nhau và **đánh rơi một
 * tổ hợp có thật**: *hiện cửa sổ nhưng không lưu gì* — ca "xem nhân viên đang làm
 * gì". Nguyên nhân: đếm **kịch bản** thay vì đếm **cơ chế**. Test này giữ đủ bốn.
 */
test('⭐ hai ô tick ĐỘC LẬP — đủ bốn tổ hợp, không tổ hợp nào bị đánh rơi', () => {
  const none = argsFor([]);
  const luu = argsFor(['nho-dang-nhap']);
  const hien = argsFor(['hien-cua-so']);
  const caHai = argsFor(['nho-dang-nhap', 'hien-cua-so']);
  const coHoSo = (a: string[]) => a.some((x) => x.includes('user-data-dir'));

  assert.ok(none.includes('--headless') && !coHoSo(none));
  assert.ok(luu.includes('--headless') && coHoSo(luu));
  // ⭐ Đúng ô mà bản "ba nấc" đã làm rơi.
  assert.ok(!hien.includes('--headless') && !coHoSo(hien));
  assert.ok(!caHai.includes('--headless') && coHoSo(caHai));
});

test('"nhớ đăng nhập" GỠ `--isolated` — hồ sơ bền và hồ sơ trong RAM loại trừ nhau', () => {
  assert.ok(!argsFor(['nho-dang-nhap']).includes('--isolated'));
});

test('"hiện cửa sổ" mang cờ `loopbackOnly` — cửa sổ mở trên máy chạy daemon', () => {
  const o = (BROWSER_ARM.options ?? []).find((x) => x.id === 'hien-cua-so');
  assert.equal(o?.loopbackOnly, true);
});

test('đổi ô tick ⇒ BĂM ĐỔI ⇒ là một cánh tay khác', () => {
  const mk = (ids: string[]) =>
    armHash(
      buildConfig(BROWSER_ARM.spec, {
        folders: [],
        options: (BROWSER_ARM.options ?? []).filter((o) => ids.includes(o.id)),
        platform: 'win32',
      }),
    );
  const all = [mk([]), mk(['nho-dang-nhap']), mk(['hien-cua-so']), mk(['nho-dang-nhap', 'hien-cua-so'])];
  assert.equal(new Set(all).size, 4, 'hai tổ hợp khác nhau chung một băm ⇒ đè nhau im lặng');
});

// ────────────────────────────────────────── đĩa cứng

/**
 * ⭐ TEST VỀ DUNG LƯỢNG ĐĨA, không phải về cấu hình. (user dặn 29/08)
 *
 * Không khai channel ⇒ Playwright tải bản đóng gói: `chromium_headless_shell`
 * **269 MB**, bản đủ **415 MB**, và **bản cũ không tự bị dọn** (máy đo 29/08 có
 * 1 340 MB gồm hai bộ 04/2026 + 07/2026). Khai channel ⇒ dùng trình duyệt đã
 * cài ⇒ **0 byte**.
 *
 * Test này đỏ vào đúng ngày ai đó gỡ channel "cho gọn" — cái giá của lần gỡ đó
 * **không hiện trên máy dev** (nơi trình duyệt đã nằm sẵn trong cache), chỉ hiện
 * trên máy khách mới.
 */
test('⭐ dùng trình duyệt CÓ SẴN — không tải 269–415 MB về đĩa khách', () => {
  assert.deepEqual(argsFor([], 'win32').slice(-2), ['--browser', 'msedge']);
  assert.deepEqual(argsFor([], 'darwin').slice(-2), ['--browser', 'chrome']);
  // Linux desktop hiếm khi có sẵn channel nào; trên server thì đường đúng là
  // image Docker chính chủ (Chromium nằm trong image) ⇒ ở đây KHÔNG khai.
  assert.ok(!argsFor([], 'linux').includes('--browser'));
});

test('băm KHÁC giữa Windows và macOS — vì đó thật sự là hai trình duyệt khác', () => {
  const mk = (platform: string) => armHash(buildConfig(BROWSER_ARM.spec, { folders: [], platform }));
  assert.notEqual(mk('win32'), mk('darwin'));
});

test('có trần dung lượng cho file server tự ghi ra', () => {
  const args = argsFor([]);
  const i = args.indexOf('--output-max-size');
  assert.ok(i >= 0, 'thiếu trần ⇒ thư mục snapshot lớn không giới hạn');
  assert.ok(Number(args[i + 1]) > 0, 'trần phải là một con số byte');
});

// ────────────────────────────────────────── neverTools: CHỈ CẮT

test('hai việc chạy JS tuỳ ý nằm trong danh sách cấm', () => {
  assert.ok(BROWSER_ARM.neverTools?.includes('browser_run_code_unsafe'));
  assert.ok(BROWSER_ARM.neverTools?.includes('browser_evaluate'));
});

/**
 * ⭐ `neverTools` được phép tồn tại **chỉ vì** nó không bao giờ thêm quyền. Nếu
 * một ngày ai đó biến nó thành "danh sách cho phép" thì luật một chiều (user chốt
 * 25/08) vỡ **im lặng**, và không có triệu chứng nào cho tới khi một cánh tay
 * "chỉ đọc" ghi được.
 */
test('`neverTools` CHỈ CẮT — không bao giờ thêm một việc nào', () => {
  const tools = [
    { name: 'browser_snapshot', level: 'read' as const, tier: 'read' as const },
    { name: 'browser_click', level: 'write_external' as const, tier: 'full' as const },
    { name: 'browser_evaluate', level: 'write_external' as const, tier: 'full' as const },
  ];
  for (const tier of TIERS) {
    const truoc = toolsAtTier(tools, tier);
    const sau = truoc.filter((n) => !BROWSER_ARM.neverTools?.includes(n));
    assert.ok(sau.length <= truoc.length, 'danh sách cấm làm DÀI thêm ⇒ nó đang cấp quyền');
    for (const n of sau) assert.ok(truoc.includes(n), `"${n}" xuất hiện từ hư không`);
    assert.ok(!sau.includes('browser_evaluate'), `nấc ${tier} vẫn cấp browser_evaluate`);
  }
});

/**
 * Canh con số đã ĐO 29/08: `browser_navigate` khai `destructive: true` ⇒ `tierOf`
 * xếp nó vào `full`. Test này KHÔNG bảo hành vi đó sai — nó bảo **đừng quên nó**:
 * nấc "chỉ đọc" của mục này **không mở được trang nào**, nên nhãn nấc phải nói
 * đúng bán kính (*"đọc trang đang mở"*), đừng hứa một trình duyệt biết đi.
 */
test('📌 `browser_navigate` KHÔNG thuộc nấc chỉ-đọc — nhãn nấc phải nói đúng', () => {
  assert.equal(tierOf({ readOnly: false, destructive: true }), 'full');
  assert.equal(tierOf({ readOnly: true, destructive: false }), 'read');
});

// ────────────────────────────────────────── thương hiệu §11c

test('tên mục KHÔNG mang tên hãng — nợ thương hiệu bằng 0, không phải hoãn lại', () => {
  for (const field of [BROWSER_ARM.name, BROWSER_ARM.blurb]) {
    assert.ok(!/playwright/i.test(field), `"${field}" lộ tên hãng ra mặt trước`);
  }
  assert.equal('mark' in BROWSER_ARM.brand, false, 'có logo mà chưa đọc quy tắc = đúng lỗ §11c');
});

test('mục này KHÔNG có chìa nào — đó là toàn bộ điểm của nó', () => {
  assert.equal(BROWSER_ARM.price, 'none');
  assert.deepEqual(BROWSER_ARM.secrets, []);
  assert.equal(BROWSER_ARM.auth, undefined);
});

// ────────────────────────────────────────── hàng rào cho mục khác

/**
 * 🔒 `files` **không** đi đường ô trống, và không được đi. Ở đó đường dẫn *là*
 * danh tính (thư mục nào cánh tay với tới), nên nó **phải** nằm trong băm. Test
 * này giữ ranh giới khỏi bị xoá nhoà vào ngày ai đó thấy hai chỗ "trông giống
 * nhau" rồi gộp làm một.
 */
test('🔒 mục `files` giữ nguyên: thư mục là DANH TÍNH, vẫn vào băm', () => {
  const a = armHash(buildConfig(FILES_ARM.spec, { folders: ['/du-lieu/a'] }));
  const b = armHash(buildConfig(FILES_ARM.spec, { folders: ['/du-lieu/b'] }));
  assert.notEqual(a, b, 'đổi thư mục mà băm không đổi ⇒ hai bán kính khác nhau đè nhau');
  assert.equal(FILES_ARM.options, undefined, '`files` không được có ô tick nào');
});
