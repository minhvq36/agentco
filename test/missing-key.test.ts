/**
 * Test cho bug user báo 25/08: **CHÌA THIẾU BỊ BÁO THÀNH CHÌA SAI**.
 * → `src/core/secrets.ts` · `src/core/probe.ts` · `src/core/company.ts §reuseArm`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Nguyên văn user, và nó là một câu hỏi ĐÚNG chứ không phải hiểu nhầm:     │
 * │                                                                          │
 * │   *"chìa sai khi tạo mới → 401, đúng với ý đồ test. Nhưng mà chìa THIẾU  │
 * │    (để trắng khi tạo mới) nó cũng báo câu lệnh y hệt mà? Tôi hiểu sai    │
 * │    chỗ nào"*                                                             │
 * │                                                                          │
 * │ Không sai chỗ nào — BA nguyên nhân khác hẳn nhau rơi vào cùng một câu:   │
 * │                                                                          │
 * │   ① chìa sai thật       `Bearer ntn_xxx`      → 401  ✔ câu đúng          │
 * │   ② để trắng            `Bearer ${NOTION_…}`  → 401  ✘ sai cửa           │
 * │   ③ "dùng lại" ở VP khác`Bearer ${NOTION_…}`  → 401  ✘ sai cửa           │
 * │                                                                          │
 * │ ② và ③ ta BIẾT TRƯỚC khi gửi — mà vẫn gửi, rồi để Notion trả lời hộ một  │
 * │ câu nó không đủ dữ kiện để trả lời. 401 chỉ nói được *"chìa này sai"*;   │
 * │ nó không có cách nào biết ta **chưa từng điền chìa**.                    │
 * │                                                                          │
 * │ Cái giá không phải một câu chữ xấu: người dùng đi kiểm tài khoản, kiểm   │
 * │ quyền, kiểm workspace — mọi chỗ TRỪ chỗ hỏng. Câu lỗi chỉ sai cửa đắt    │
 * │ hơn câu lỗi không có.                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { grantFor, injectSecrets, missingSecretRefs } from '../dist/core/secrets.js';
import { armHash } from '../dist/core/catalog.js';

// ────────────────────────────────────────────── ô trống nào còn sót

test('tìm ô trống ở MỌI chỗ, không riêng headers', () => {
  // Một hàm chỉ nhìn `headers` sẽ đúng cho tới đúng ngày ai đó viết
  // `url: 'https://${HOST}/mcp'` — và ngày đó không ai nhớ lại file này.
  assert.deepEqual(missingSecretRefs({ type: 'http', url: 'https://x/mcp', headers: { A: 'Bearer ${T}' } }), ['T']);
  assert.deepEqual(missingSecretRefs({ url: 'https://${HOST}/mcp' }), ['HOST']);
  assert.deepEqual(missingSecretRefs({ command: 'x', args: ['--key=${K}'] }), ['K']);
  assert.deepEqual(missingSecretRefs({ command: 'x', env: { A: '${B}' } }), ['B']);
});

test('không ô trống nào ⇒ rỗng, và cấu hình rỗng/null không làm nổ', () => {
  assert.deepEqual(missingSecretRefs({ command: 'npx', args: ['-y', 'pkg'] }), []);
  assert.deepEqual(missingSecretRefs(null), []);
  assert.deepEqual(missingSecretRefs(undefined), []);
});

test('mỗi tên chỉ kể MỘT LẦN, và đã sắp xếp — câu lỗi phải ổn định', () => {
  assert.deepEqual(missingSecretRefs({ headers: { A: '${T}', B: '${T}', C: '${S}' } }), ['S', 'T']);
});

// ─────────────────────────────────── chuỗi rỗng = THIẾU, ở MỌI hàm

test('grantFor: chuỗi rỗng tính là THIẾU, không phải "có mà rỗng"', () => {
  // Ô nhập để trắng gửi lên `''`. Coi nó là chìa hợp lệ thì `Bearer ` bay lên
  // server và quay về 401 — tức câu "chìa sai" cho việc CHƯA ĐIỀN chìa.
  const r = grantFor({ A: '', B: 'thật' }, ['A', 'B', 'C']);
  assert.deepEqual(r.env, { B: 'thật' });
  assert.deepEqual(r.missing, ['A', 'C']);
});

test('injectSecrets: chìa rỗng KHÔNG thay ô trống — nó bị giữ lại để lộ ra', () => {
  const out = injectSecrets({ type: 'http', url: 'https://x/mcp', headers: { A: 'Bearer ${T}' } }, { T: '' });
  assert.deepEqual(out, { type: 'http', url: 'https://x/mcp', headers: { A: 'Bearer ${T}' } });
});

test('injectSecrets: chìa rỗng KHÔNG đi vào env của stdio', () => {
  assert.deepEqual(injectSecrets({ command: 'x' }, { A: '' }), { command: 'x' });
});

/**
 * ⭐ ĐÂY LÀ PHÉP KIỂM THẬT — và nó là đúng phép kiểm `probeArm` chạy trước khi
 * mở kết nối. Ba ca của user, ba kết quả phải khác nhau.
 */
test('ba ca của user cho ba kết quả KHÁC NHAU, không còn gộp vào một câu 401', () => {
  const cfg = { type: 'http', url: 'https://mcp.notion.com/mcp', headers: { Authorization: 'Bearer ${NOTION_ACCESS_TOKEN}' } };

  // ① chìa sai thật — ta KHÔNG chặn, phải để server nói. Ta không biết chìa đúng.
  assert.deepEqual(missingSecretRefs(injectSecrets(cfg, { NOTION_ACCESS_TOKEN: 'sai_bét' })), []);

  // ② để trắng — chặn TRƯỚC khi gửi, nêu đúng tên chìa.
  assert.deepEqual(missingSecretRefs(injectSecrets(cfg, { NOTION_ACCESS_TOKEN: '' })), ['NOTION_ACCESS_TOKEN']);

  // ③ "dùng lại" mà không mang chìa theo — cùng triệu chứng, cùng câu trả lời.
  assert.deepEqual(missingSecretRefs(injectSecrets(cfg, {})), ['NOTION_ACCESS_TOKEN']);
});

// ─────────────────────── "dùng lại" phải RA CÙNG MỘT CÁNH TAY

/**
 * ⭐ Nửa thứ hai của bug clone, và là nửa KHÔNG có triệu chứng nhìn thấy được.
 *
 * Nút "dùng lại" cũ dán cấu hình sang đường "tự cắm" ⇒ `secretNames` thành `[]`.
 * Mà TÊN CHÌA NẰM TRONG BĂM (§armHash) ⇒ băm khác ⇒ nó **tạo một cánh tay thứ
 * hai** trùng cấu hình thay vì dùng lại cái đã có. Kể cả khi chìa có đi theo
 * (cánh tay stdio, nơi 401 không xảy ra) thì hỏng này vẫn xảy ra — im lặng.
 */
test('mất tên chìa ⇒ BĂM KHÁC ⇒ "dùng lại" âm thầm nhân bản', () => {
  const cfg = { type: 'http', url: 'https://mcp.notion.com/mcp' };
  assert.notEqual(armHash(cfg, ['NOTION_ACCESS_TOKEN']), armHash(cfg, []));
});

test('mang đủ tên chìa ⇒ CÙNG BĂM ⇒ đúng nghĩa "văn phòng nào cũng xài chung"', () => {
  const cfg = { type: 'http', url: 'https://mcp.notion.com/mcp' };
  assert.equal(armHash(cfg, ['NOTION_ACCESS_TOKEN']), armHash({ ...cfg }, ['NOTION_ACCESS_TOKEN']));
});
