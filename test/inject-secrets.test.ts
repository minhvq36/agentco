/**
 * Test cho `injectSecrets` — LỖ §5a, vá 25/08.
 * → docs/SPEC-arms.md §5a · `src/core/secrets.ts`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO LỖ NÀY ĐÁNG MỘT FILE TEST RIÊNG                                   │
 * │                                                                          │
 * │ Tới 25/08, chìa **chỉ** đi vào server có `command`. Server `http` nhận   │
 * │ không gì cả — và triệu chứng của nó là thứ tệ nhất trong các triệu chứng:│
 * │ nút "Thử ngay" báo ✓, rồi cánh tay **401 lúc nhân viên đầu tiên dùng**.  │
 * │ Tức nó hỏng SAU khi giao diện đã hứa là chạy được.                       │
 * │                                                                          │
 * │ Lỗ nằm im được 2 ngày vì **chưa có mục danh mục HTTP nào**. Đó chính là  │
 * │ lý do phải có test: bản vá không được phụ thuộc vào việc còn nhớ nó.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { injectSecrets, missingSecretRefs } from '../dist/core/secrets.js';

// ─────────────────────────────────────────────────────────────── stdio (cũ)

test('stdio: chìa vào env — hành vi cũ KHÔNG được đổi', () => {
  const out = injectSecrets({ command: 'npx', args: ['-y', 'pkg'] }, { A: '1' });
  assert.deepEqual(out, { command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } });
});

test('stdio: env sẵn có được giữ, chìa mới gộp đè lên', () => {
  const out = injectSecrets({ command: 'x', env: { KEEP: 'y', A: 'cũ' } }, { A: 'mới' });
  assert.deepEqual(out, { command: 'x', env: { KEEP: 'y', A: 'mới' } });
});

// ──────────────────────────────────────────────────────────────── http (mới)

test('http: ô trống trong headers được thay bằng chìa', () => {
  const out = injectSecrets(
    { type: 'http', url: 'https://mcp.notion.com/mcp', headers: { Authorization: 'Bearer ${T}' } },
    { T: 'ntn_abc' },
  );
  assert.deepEqual(out, {
    type: 'http',
    url: 'https://mcp.notion.com/mcp',
    headers: { Authorization: 'Bearer ntn_abc' },
  });
});

test('http: nhiều ô trống, nhiều header', () => {
  const out = injectSecrets(
    { url: 'https://x/mcp', headers: { A: '${P}', B: 'v=${Q};w=${P}' } },
    { P: '1', Q: '2' },
  );
  assert.deepEqual((out as { headers: unknown }).headers, { A: '1', B: 'v=2;w=1' });
});

/**
 * 🔴 CA QUAN TRỌNG NHẤT CỦA FILE NÀY.
 *
 * Thiếu chìa thì **không được** gửi chuỗi `${T}` lên server như thể nó là token.
 * Server sẽ trả 401, và 401 nói *"chìa sai"* — nên người đi tìm sẽ đi kiểm tài
 * khoản, kiểm quyền, kiểm workspace… trong khi sự thật là **chưa ai điền chìa**.
 * Một câu lỗi chỉ sai cửa thì đắt hơn một câu lỗi không có. → §5m ②
 */
test('http: THIẾU chìa thì giữ nguyên ô trống, KHÔNG gửi rác đi', () => {
  const out = injectSecrets({ url: 'https://x/mcp', headers: { Authorization: 'Bearer ${T}' } }, {});
  assert.deepEqual((out as { headers: unknown }).headers, { Authorization: 'Bearer ${T}' });
});

test('http: chỉ thay chìa ĐƯỢC CẤP, chìa lạ không rò sang', () => {
  // `grantFor` đã lọc trước; đây là lưới thứ hai. Vai trò chỉ cầm T thì
  // ô `${KHAC}` phải nằm nguyên, kể cả khi công ty CÓ chìa tên đó.
  const out = injectSecrets(
    { url: 'https://x/mcp', headers: { A: '${T}', B: '${KHAC}' } },
    { T: 'ok' },
  );
  assert.deepEqual((out as { headers: unknown }).headers, { A: 'ok', B: '${KHAC}' });
});

test('http: không có headers thì không đụng vào', () => {
  const cfg = { type: 'http', url: 'https://x/mcp' };
  assert.deepEqual(injectSecrets(cfg, { T: '1' }), cfg);
});

test('http: header không phải chuỗi cũng không làm sập', () => {
  const out = injectSecrets({ url: 'https://x/mcp', headers: { N: 5 } }, { T: '1' });
  assert.deepEqual((out as { headers: unknown }).headers, { N: '5' });
});

// ───────────────────────────────────────────────────────────────── biên

test('không command, không url ⇒ trả nguyên vẹn', () => {
  const cfg = { type: 'sdk', name: 'x' };
  assert.equal(injectSecrets(cfg, { A: '1' }), cfg);
});

test('null/không phải object ⇒ không ném', () => {
  assert.equal(injectSecrets(null, { A: '1' }), null);
  assert.equal(injectSecrets('chuỗi', { A: '1' }), 'chuỗi');
});

// ───────────────────── ô trống NGOÀI `headers` — bug user bắt 31/08, bài 20 B
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ Ca thật: dán khối README có `env: { MEMORY_FILE_PATH: "${MEMORY_PATH}" }`,│
// │ UI sinh đúng ô nhập, người dùng điền `abcde` → vẫn *"Thiếu chìa:          │
// │ MEMORY_PATH"*, điền lại bao nhiêu lần cũng thế.                          │
// │                                                                          │
// │ Nguyên nhân: `missingSecretRefs` quét CẢ cấu hình, `injectSecrets` chỉ    │
// │ thay trong `headers` của HTTP. Ô trống ngoài `headers` bị **phát hiện     │
// │ mãi mãi, không bao giờ được điền** ⇒ vòng lặp vô tận, và câu lỗi chỉ vào  │
// │ đúng cái ô người dùng VỪA ĐIỀN.                                          │
// │                                                                          │
// │ ⇒ BẤT BIẾN: phạm vi hàm ĐIỀN = phạm vi hàm KIỂM. Bốn test dưới canh nó.   │
// └──────────────────────────────────────────────────────────────────────────┘

test('⭐ stdio: ô trống trong `env` ĐƯỢC THAY — ca đường B, bug 31/08', () => {
  const out = injectSecrets(
    { command: 'npx', args: ['-y', 'server-memory'], env: { MEMORY_FILE_PATH: '${MEMORY_PATH}' } },
    { MEMORY_PATH: 'D:\\so-tay.json' },
  ) as { env: Record<string, string> };
  assert.equal(out.env['MEMORY_FILE_PATH'], 'D:\\so-tay.json');
  // và chìa vẫn có mặt dưới tên gốc — vế "gộp theo tên" của danh mục không mất
  assert.equal(out.env['MEMORY_PATH'], 'D:\\so-tay.json');
});

test('⭐ stdio: điền xong thì `missingSecretRefs` phải SẠCH — không còn vòng lặp', () => {
  const cfg = { command: 'x', env: { P: '${A}' } };
  assert.deepEqual(missingSecretRefs(injectSecrets(cfg, { A: 'v' })), []);
  // và thiếu thật thì vẫn phải bắt được
  assert.deepEqual(missingSecretRefs(injectSecrets(cfg, {})), ['A']);
});

test('stdio: ô trống trong `args` cũng được thay', () => {
  const out = injectSecrets({ command: 'x', args: ['--token', '${T}'] }, { T: 'abc' }) as {
    args: string[];
  };
  assert.deepEqual(out.args, ['--token', 'abc']);
});

test('http: ô trống trong `url` cũng được thay — chỗ chú thích cũ đã tiên đoán', () => {
  const out = injectSecrets({ url: 'https://${HOST}/mcp', headers: {} }, { HOST: 'a.com' }) as {
    url: string;
  };
  assert.equal(out.url, 'https://a.com/mcp');
});

test('không sửa tại chỗ — cấu hình gốc phải nguyên vẹn', () => {
  // `pickMcp` chạy MỖI task trên cùng object đọc từ company.yaml. Sửa tại chỗ
  // là ghi chìa thật vào cấu hình dùng chung, rồi task sau của một vai trò
  // KHÁC đọc lại đúng object đó — chìa rò qua ranh giới vai trò, im lặng.
  const cfg = { url: 'https://x/mcp', headers: { A: '${T}' } };
  injectSecrets(cfg, { T: 'bí-mật' });
  assert.deepEqual(cfg.headers, { A: '${T}' });
});
