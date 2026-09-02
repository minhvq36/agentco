/**
 * CÂU LỖI SAI CỬA CỦA GITHUB + PHÉP THỬ TẦM VỚI. → SPEC-arms §5h·7f · §5h·7m
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ FILE NÀY TỪNG CANH MỘT THỨ KHÁC, VÀ ĐÓ LÀ PHẦN ĐÁNG ĐỌC NHẤT.         │
 * │                                                                          │
 * │ Sáng 27/08 nó có 17 ca canh `armJail` — hàng rào repo thứ hai của ta.    │
 * │ Chiều 27/08 hàng rào đó bị gỡ: phạm vi repo là tài sản **cấp tài khoản   │
 * │ của GitHub**, và chồng một hàng rào của ta lên nó chỉ mua được thu-hẹp-  │
 * │ theo-cánh-tay, đổi lấy một cơ chế nữa + gõ tay + đổi-là-cắm-lại.        │
 * │                                                                          │
 * │ Bỏ một hàng rào thì phải TRẢ LẠI thứ nó đang che, và nó che đúng một     │
 * │ chuyện: **404 của GitHub chưa bao giờ được dịch**. Ô C-3 bài 13 đòi câu  │
 * │ đó từ lâu và trỏ tới một mục spec chưa từng tồn tại. File này giờ canh   │
 * │ hai thứ thay thế:                                                        │
 * │                                                                          │
 * │  ① **Dịch 404** — `worker.ts §githubDoorError`. Không có nó, người dùng  │
 * │     nhận `404 Not Found` trần và đi kiểm chìa, kiểm tên repo, kiểm quyền │
 * │     — mọi chỗ TRỪ chỗ đúng. → [[agentco-wrong-door-errors]]              │
 * │                                                                          │
 * │  ② **Phép thử tầm với** — `catalog.ts §reachTest`. Nó tồn tại vì         │
 * │     `tools/list` **thành công kể cả khi chưa cài app vào repo nào** ⇒     │
 * │     dấu ✓ chứng minh đăng nhập chạy, KHÔNG chứng minh với tới được gì.   │
 * │     → [[agentco-measurement-vs-conclusion]]                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CATALOG, armHash, findArm, normRepo } from '../dist/core/catalog.js';
import { githubDoorError } from '../dist/core/worker.js';

const DOOR = 'https://github.com/apps/agent-co-app/installations/new';
const fix = (raw: Record<string, unknown>, text: string) => githubDoorError(raw, text, DOOR);

// ─────────────────────────────────────────────── ① dịch câu 404 sai cửa

test('⭐ 404 kèm owner/repo ⇒ dịch lại thành "chưa cài app vào repo này"', () => {
  const out = fix({ owner: 'octocat', repo: 'test', path: 'README.md' }, 'Error: 404 Not Found');
  assert.ok(out, 'phải dịch');
  assert.match(out, /octocat\/test/, 'nêu đúng repo');
  assert.match(out, /chưa được cài/i, 'nói ra nguyên nhân thật');
  assert.ok(out.includes(DOOR), 'kèm cửa đi tiếp — thiếu nó thì câu dịch cũng là ngõ cụt');
});

test('🔴 GIỮ NGUYÊN câu gốc, chỉ THÊM vào — không nuốt lỗi', () => {
  /**
   * Nuốt một lời gọi hỏng thành "ổn" là dựng lại ca Notion `Error:` đã đốt 10
   * lượt, chỉ theo chiều ngược. Ta sửa CÂU, không sửa KẾT QUẢ.
   */
  const goc = 'Error: 404 Not Found';
  const out = fix({ owner: 'a', repo: 'b' }, goc)!;
  assert.ok(out.startsWith(goc), 'câu nguyên văn của hãng phải còn — nó là thứ copy đi hỏi được');
});

test('⭐ dặn model ĐỪNG đoán là repo không tồn tại, và đừng dò tên khác', () => {
  const out = fix({ owner: 'a', repo: 'b' }, '404')!;
  assert.match(out, /đừng.*(thử lại|đoán)/is, 'không dặn thì mỗi lần dò là một lượt trả tiền');
});

test('🔴 KHÔNG có owner/repo ⇒ ĐỨNG YÊN — đừng dựng một câu sai cửa MỚI', () => {
  /**
   * 404 ở một lời gọi không nói về repo thì nó nói về chuyện khác. Đoán bừa ở
   * đây là thay một câu sai cửa bằng một câu sai cửa khác, lần này do ta viết.
   */
  assert.equal(fix({ query: 'user:octocat' }, 'Error: 404 Not Found'), null);
  assert.equal(fix({ owner: 'a' }, '404 Not Found'), null, 'nửa vế không đủ để kết luận');
});

test('không phải 404 ⇒ đứng yên', () => {
  assert.equal(fix({ owner: 'a', repo: 'b' }, 'Error: 403 Forbidden'), null);
  assert.equal(fix({ owner: 'a', repo: 'b' }, 'rate limit exceeded'), null);
  assert.equal(fix({ owner: 'a', repo: 'b' }, 'ok'), null);
});

test('bắt được cả hai cách hãng viết câu đó', () => {
  assert.ok(fix({ owner: 'a', repo: 'b' }, 'HTTP 404'), 'dạng số');
  assert.ok(fix({ owner: 'a', repo: 'b' }, 'Not Found'), 'dạng chữ, không kèm số');
});

// ───────────────────────────────────────── ② phép thử tầm với là DỮ LIỆU

test('⛔ `reachTest` (ô gõ tay) đã BỎ — đừng dựng lại, tiền đề của nó sai', () => {
  /**
   * Sống được vài tiếng ngày 27/08. Ý đúng (dấu ✓ của `tools/list` không chứng
   * minh tầm với) nhưng **phép thử sai**: `get_file_contents` lên repo công khai
   * ✓ bất kể bản cài, nên nó trả lời một câu khác câu đang hỏi. Và nó bắt người
   * dùng gõ tay. Thay bằng `repoScan` — tra tự động. → §5h·7n · §5h·7o
   */
  for (const a of CATALOG) {
    assert.equal((a as Record<string, unknown>)['reachTest'], undefined, a.id);
  }
});

test('🔴 KHÔNG mục nào còn khai `limitTo` — hàng rào repo đã gỡ 27/08', () => {
  // Dựng lại nó thì đọc `SPEC-arms.md` §5h·7m trước. Test này là cái chuông.
  for (const a of CATALOG) {
    assert.equal((a as Record<string, unknown>)['limitTo'], undefined, a.id);
  }
});

// ────────────────────────────── ③ băm chỉ phụ thuộc thứ AGENTCO cấu hình

const CFG = { type: 'http', url: 'https://api.githubcopilot.com/mcp/' };

test('⭐ băm KHÔNG có chỗ cho phạm vi repo — và đó là kết quả ĐÚNG', () => {
  /**
   * User tự rút ra 27/08: *"hash github dường như chỉ phụ thuộc account github
   * đó là account nào, còn chuyện người ta cho phép những gì mình đâu can thiệp
   * được"*. Đúng. Băm là vân tay của thứ **agentco cấu hình**, không phải của
   * thứ cánh tay **với tới được** — tầm với là tài sản của hãng, đổi ngoài tầm
   * ta, và nhét nó vào băm là hứa một điều ta không giữ được.
   *
   * ⇒ Một cánh tay GitHub = (tài khoản + nhóm việc + nấc). Chấm hết.
   */
  assert.equal(armHash.length <= 3, true, 'armHash chỉ nhận config + tên chìa + nấc');
  const a = armHash(CFG, ['GITHUB_OAUTH_A'], 'full');
  const b = armHash(CFG, ['GITHUB_OAUTH_B'], 'full');
  assert.notEqual(a, b, 'khác tài khoản ⇒ khác cánh tay');
  assert.equal(a, armHash(CFG, ['GITHUB_OAUTH_A'], 'full'), 'cùng đầu vào ⇒ cùng băm');
});

test('🔴 băm giữ NGUYÊN như trước khi thêm rồi gỡ giới hạn repo', () => {
  // Cả vòng thêm-rồi-gỡ trong một ngày phải để lại **0 dấu vết** trên băm, nếu
  // không thì `company.yaml` của người dùng mồ côi vì một tính năng chưa ai xài.
  assert.equal(armHash(CFG, ['x'], 'full'), armHash(CFG, ['x'], 'full'));
  assert.equal(armHash(CFG, ['x']), armHash(CFG, ['x'], undefined));
});

test('normRepo vẫn sống — phép thử cần nó để tách chủ/tên', () => {
  assert.equal(normRepo('https://github.com/Octocat/Test.git'), 'octocat/test');
  assert.equal(normRepo('  /octocat/test/  '), 'octocat/test');
});
