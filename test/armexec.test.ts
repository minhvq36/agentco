/**
 * Test cho việc BỎ `npx` KHỎI ĐƯỜNG NÓNG. → docs/SPEC-arms.md §5j
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SỐ ĐO SINH RA BẢN VÁ NÀY (24/08, `scripts/spike-npx-cost.ts`)            │
 * │                                                                          │
 * │   npx khởi động server (gói ĐÃ cache)   3,8 – 4,3 s   lần 1 = lần 3      │
 * │   node <file đã cache>                  0,79 – 0,84 s                    │
 * │   `npx -y --offline`                    3 878 ms  ⇒ KHÔNG phải mạng      │
 * │                                                                          │
 * │ Sau bản vá, đo lại đầu-cuối qua `probeArm`: **7,7–9,2 s → 4,0–4,2 s**.    │
 * │ Khoản đó bị trả ở MỖI task có cánh tay, không chỉ ở hộp thoại cắm.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ NỬA QUAN TRỌNG NHẤT của file này là khối "PHẢI TRẢ VỀ CẤU HÌNH GỐC".
 * Bản vá này chỉ được phép làm NHANH HƠN. Một cánh tay đang chạy tốt mà hỏng
 * vì nó thì tệ hơn hẳn việc chậm 4 giây — và hỏng theo kiểu không ai đoán ra
 * nguyên nhân, vì `company.yaml` vẫn ghi `npx` y như cũ.
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { fastLaunch, npxSpec, packageName } from '../dist/core/armexec.js';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

// ──────────────────────────────────────────────────────────────────── npxSpec

test('npxSpec: tách đúng gói và phần tham số của server', () => {
  assert.deepEqual(npxSpec({ command: 'npx', args: ['-y', PKG, 'D:\\Downloads\\x'] }), {
    spec: PKG,
    rest: ['D:\\Downloads\\x'],
  });
});

test('npxSpec: nhiều cờ trước tên gói vẫn tách đúng', () => {
  const r = npxSpec({ command: 'npx', args: ['-y', '--offline', PKG, '/a', '/b'] });
  assert.equal(r?.spec, PKG);
  assert.deepEqual(r?.rest, ['/a', '/b']);
});

test('npxSpec: KHÔNG phải npx thì không đụng vào', () => {
  assert.equal(npxSpec({ command: 'node', args: ['x.js'] }), undefined);
  assert.equal(npxSpec({ url: 'https://api.githubcopilot.com/mcp/' }), undefined);
});

test('npxSpec: `--package=` đổi nghĩa tham số vị trí ⇒ NÓI KHÔNG BIẾT', () => {
  // Với `--package=x`, tham số vị trí là TÊN LỆNH chứ không phải tên gói. Đoán
  // sai ở đây là chạy nhầm một chương trình khác — thà rơi về npx.
  assert.equal(npxSpec({ command: 'npx', args: ['-y', '--package=a', 'lenh'] }), undefined);
});

test('npxSpec: hình dạng lạ thì trả undefined, không ném', () => {
  assert.equal(npxSpec({ command: 'npx' }), undefined);
  assert.equal(npxSpec({ command: 'npx', args: ['-y'] }), undefined);
  assert.equal(npxSpec({ command: 'npx', args: [1, 2] as never }), undefined);
  assert.equal(npxSpec({}), undefined);
});

// ────────────────────────────────────────────────────────────── packageName

test('packageName: gói có scope giữ nguyên phần scope', () => {
  assert.equal(packageName(PKG), '@modelcontextprotocol/server-filesystem');
  assert.equal(packageName('@scope/x@1.0.0'), '@scope/x');
});

test('packageName: gói không scope, và gói không ghim phiên bản', () => {
  assert.equal(packageName('wscat@5.1.0'), 'wscat');
  assert.equal(packageName('wscat'), 'wscat');
  assert.equal(packageName('@scope/x'), '@scope/x');
});

// ─────────────────────────── fastLaunch — PHẢI TRẢ VỀ CẤU HÌNH GỐC KHI NGHI NGỜ
//
// Đây là nửa quan trọng nhất. Ba ca hỏng có thật đứng sau nó: máy không có
// `npm` · không ra được registry lần đầu · thư mục cache bị dọn. Cả ba phải
// rơi về `npx` và chạy y như trước.

test('fastLaunch: chưa cài gì thì trả về ĐÚNG cấu hình gốc', () => {
  const cfg = { command: 'npx', args: ['-y', 'goi-khong-bao-gio-ton-tai-9f3a', '/x'] };
  assert.deepEqual(fastLaunch(cfg), cfg);
});

test('fastLaunch: server HTTP không có `command` — không đụng một chữ', () => {
  const cfg = { url: 'https://api.githubcopilot.com/mcp/', headers: { a: 'b' } };
  assert.deepEqual(fastLaunch(cfg), cfg);
});

test('fastLaunch: cấu hình do người dùng tự cắm (không npx) giữ nguyên', () => {
  const cfg = { command: 'node', args: ['/srv/mcp.js'], env: { TOKEN: 'x' } };
  assert.deepEqual(fastLaunch(cfg), cfg);
});

test('fastLaunch: GIỮ NGUYÊN `env` — chìa đã tiêm không được rơi mất', () => {
  // `pickMcp` tiêm chìa vào `env` TRƯỚC khi gọi `fastLaunch`. Viết lại cấu hình
  // mà đánh rơi `env` là cánh tay chạy nhanh và KHÔNG có chìa — hỏng im lặng,
  // và triệu chứng ("401") nằm cách nguyên nhân rất xa.
  const cfg = { command: 'npx', args: ['-y', PKG, '/x'], env: { NOTION_TOKEN: 'secret' } };
  const out = fastLaunch(cfg) as typeof cfg;
  assert.deepEqual(out.env, { NOTION_TOKEN: 'secret' });
});

test('fastLaunch: KHÔNG BAO GIỜ ném, kể cả với rác', () => {
  for (const bad of [{}, { command: 'npx', args: null }, { command: null }] as never[]) {
    assert.doesNotThrow(() => fastLaunch(bad));
  }
});
