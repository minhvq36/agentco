/**
 * TRA BẢN CÀI APP + Ô CLIENT_ID CỦA KHÁCH. → SPEC-arms §5h·7o · §5h·7h
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 BÀI CANH ĐẮT NHẤT Ở ĐÂY LÀ `gateTool`, và lý do nó tồn tại là một số  │
 * │ đo PHẢN TRỰC GIÁC (27/08, đối chứng bản cài thật của user — 2 repo):     │
 * │                                                                          │
 * │   list_branches                  ✅✅✅✅   ← MÙ, luôn trả lời CÓ         │
 * │   get_file_contents              ✅✅✅✅   ← MÙ                          │
 * │   list_repository_collaborators  ❌✅✅❌   ← PHÂN BIỆT ĐÚNG 4/4          │
 * │                                                                          │
 * │ Chìa `ghu_` **đọc được repo CÔNG KHAI bất kể app có được cài hay không**. │
 * │ Nên đổi `gateTool` sang một tool đọc "bình thường" là biến cả phép tra    │
 * │ thành một cái gật đầu vô điều kiện — hỏng **im lặng**, và hỏng theo chiều │
 * │ nói dối người dùng rằng họ đã cài xong.                                   │
 * │                                                                          │
 * │ Test này không gọi mạng. Nó canh **lời khai trong danh mục**, vì đó là    │
 * │ chỗ duy nhất một lần sửa vô ý có thể giết cơ chế mà mọi test khác vẫn xanh│
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CATALOG, buildConfig, findArm, serverFenced } from '../dist/core/catalog.js';
import { t } from '../dist/i18n/index.js';
import { offeredTiers, tierOf } from '../dist/core/probe.js';
import { armConfig } from '../dist/server/server.js';

const gh = findArm('github')!;

// ─────────────────────────────────────────── phép tra bản cài

test('🔴 gateTool phải là tool ĐÒI QUYỀN PUSH — không phải một tool đọc bất kỳ', () => {
  assert.equal(gh.repoScan?.gateTool, 'list_repository_collaborators');
});

test('🔴 gateTool KHÔNG được là một trong các tool đã đo là MÙ', () => {
  /**
   * Danh sách này là **số đo**, không phải ý kiến: cả hai đều ✅ trên repo công
   * khai chưa cài app. Ai đó đổi `gateTool` sang chúng vì thấy "cũng là tool đọc
   * repo mà" thì test này nổ, kèm lý do.
   */
  for (const mu of ['list_branches', 'get_file_contents', 'get_commit', 'list_tags']) {
    assert.notEqual(
      gh.repoScan?.gateTool,
      mu,
      `${mu} chạy được trên repo công khai CHƯA cài app ⇒ phép tra sẽ luôn trả lời CÓ`,
    );
  }
});

test('⭐ câu tìm kiếm có ô trống ${login}, và nó là ô DUY NHẤT', () => {
  const q = gh.repoScan?.searchQuery ?? '';
  assert.match(q, /\$\{login\}/, 'thiếu ô trống ⇒ tra repo của người khác');
  assert.equal(q.match(/\$\{[^}]+\}/g)?.length, 1, 'chỉ một ô trống — thêm là thêm chỗ để lệch');
});

test('⭐ meTool khớp với bước hỏi danh tính — cùng một câu hỏi, đừng hỏi hai kiểu', () => {
  assert.equal(gh.repoScan?.meTool, gh.identity?.tool);
  assert.equal(gh.repoScan?.loginField, gh.identity?.labelField);
});

test('🔴 mục nào KHÔNG có `scope` thì không được khai `repoScan`', () => {
  // Không có bản cài bên hãng thì không có gì để tra, và một phép tra không có
  // đối tượng sẽ trả về rỗng rồi CHẶN người dùng vì một chuyện không tồn tại.
  for (const a of CATALOG) {
    if (a.scope) continue;
    assert.equal(a.repoScan, undefined, a.id);
  }
});

// ───────────────────── hàng rào SERVER vs bộ chọn nấc: cái bẫy vòng

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 NẤC MẶC ĐỊNH TỰ KHOÁ CHÍNH NÓ. (bug user bắt 27/08)                   │
 * │                                                                          │
 * │ *"Vẫn không cách nào ra cái này? Làm sao để test?"* — bộ chọn nấc không   │
 * │ hiện, và không có câu lỗi nào vì **mọi tầng đều làm đúng phần của mình**: │
 * │                                                                          │
 * │   nấc `read` → header `X-MCP-Readonly` → server chỉ trả việc ĐỌC          │
 * │   → `offeredTiers` thấy ba nấc bằng nhau → luật "chỉ hiện nấc thêm ≥1     │
 * │     việc" thu về MỘT nấc → không có gì để bấm → kẹt ở `read` vĩnh viễn.   │
 * │                                                                          │
 * │ Hai ca dưới khoá hai nửa của bản vá. Bỏ ca nào cũng dựng lại được bẫy.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
test('🔴 KHÁM PHÁ không mang hàng rào — nếu không, bộ chọn nấc tự biến mất', () => {
  const withFence = buildConfig(gh.spec, { folders: [], level: 'read' }) as {
    headers: Record<string, string>;
  };
  const discovery = buildConfig(gh.spec, { folders: [] }) as { headers: Record<string, string> };

  assert.equal(withFence.headers['X-MCP-Readonly'], 'true', 'bản LƯU ở nấc read phải có hàng rào');
  assert.equal(
    discovery.headers['X-MCP-Readonly'],
    undefined,
    'bản KHÁM PHÁ (nút Thử) không được mang hàng rào — mang là tự cắt cụt câu trả lời',
  );
});

test('🔴🔴 `discovery` phải THẮNG `level` có sẵn trong body — bản vá hỏng 27/08', () => {
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CA NÀY LÀ CẢ BÀI HỌC. Ca ngay trên đã XANH trong khi sản phẩm vẫn hỏng.  │
   * │                                                                          │
   * │ Nó canh `buildConfig` — tầng dưới, vốn chưa bao giờ sai. Chỗ sai là chỗ   │
   * │ GỌI: `armConfig({ ...body, ...(discovery ? {} : { level }) })`. `...body` │
   * │ **đã mang `body.level` vào rồi**, nên spread có điều kiện chỉ thôi *ghi   │
   * │ đè* chứ không *xoá*. Hàng rào vẫn lên, user báo lại y nguyên: *"vẫn không │
   * │ được nè, bạn đã đổi chưa"*.                                              │
   * │                                                                          │
   * │ ⇒ Canh ở TẦNG CÓ CỜ, và truyền `level` vào cùng lúc — đúng hình dạng mà   │
   * │ route thật gửi. Test tầng dưới không thay được test tầng có lỗi.          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const thi_hanh = armConfig({ catalogId: 'github', level: 'read' }) as {
    headers: Record<string, string>;
  };
  const kham_pha = armConfig({ catalogId: 'github', level: 'read', discovery: true }) as {
    headers: Record<string, string>;
  };

  assert.equal(thi_hanh.headers['X-MCP-Readonly'], 'true');
  assert.equal(
    kham_pha.headers['X-MCP-Readonly'],
    undefined,
    'có `level` mà `discovery: true` thì nấc PHẢI bị bỏ — đây đúng là thứ route /test gửi',
  );
  // Mọi thứ khác giữ nguyên: cờ này chỉ được đụng tới hàng rào, không đụng nhóm việc.
  assert.equal(kham_pha.headers['X-MCP-Toolsets'], thi_hanh.headers['X-MCP-Toolsets']);
});

test('⭐ mô phỏng đúng cái bẫy: danh sách toàn việc đọc ⇒ CHỈ CÒN MỘT nấc', () => {
  /**
   * Đây là lý do bản vá không nằm ở `offeredTiers`: hàm đó **đúng**. Nó nói thật
   * về thứ nó được cho xem — và thứ nó được cho xem đã bị cắt trước khi tới tay.
   */
  const chiDoc = [1, 2, 3].map((i) => ({
    name: `doc_${i}`,
    level: 'read' as const,
    tier: tierOf({ readOnly: true, destructive: false }),
  }));
  assert.equal(offeredTiers(chiDoc).length, 1, 'ba nấc bằng nhau ⇒ một nấc ⇒ không có gì để bấm');

  const coGhi = [...chiDoc, { name: 'ghi', level: 'write_external' as const, tier: 'full' as const }];
  assert.equal(offeredTiers(coGhi).length, 2, 'thấy được việc ghi thì mới có nấc để chọn');
});

test('🔴 mục vừa `tiered` vừa có hàng rào server PHẢI được đánh dấu cho giao diện', () => {
  // `serverFence` là thứ giao diện dùng để nói ra rằng con số token là **trần**
  // (phép thử chạy mở hết). Bỏ cờ này ⇒ giao diện im lặng đưa một con số đúng
  // cho một cấu hình người dùng không chọn.
  assert.equal(serverFenced(gh), true, 'GitHub cắt việc ở server theo nấc');
  for (const a of CATALOG) {
    if (!serverFenced(a)) continue;
    assert.equal(a.tiered, true, `${a.id}: có hàng rào theo nấc mà không cho chọn nấc thì rào ai?`);
  }
});

// ─────────────────────────────────────── thẻ nói đúng về hàng rào

test('🔴 thẻ KHÔNG được nói quá: repo công khai đọc được dù chưa cài app', () => {
  /**
   * Câu cũ *"chỉ chạm được những repo bạn cài agentco vào"* SAI với repo công
   * khai (đo 27/08: `list_branches` ✅ trên cả 16 repo, app chỉ cài 2). Nói quá
   * về hàng rào tệ hơn nói thiếu — người dùng dựa vào đó để quyết định cho nhân
   * viên đụng cái gì.
   */
  // Read it the way the UI does: entries hold catalogue KEYS now, and the
  // sentence only exists after 	(). → catalog.ts §localise
  assert.doesNotMatch(t(gh.blurb), /chỉ chạm được những repo/i);
  assert.match(t(gh.blurb), /riêng tư/i, 'phải nói rõ điều kiện áp cho repo RIÊNG TƯ');
});

// ──────────────────────────────── ô client_id của khách (§5h·7h)

test('⭐ danh mục ship client_id của agentco, và nó là DỮ LIỆU công khai', () => {
  assert.match(gh.auth?.clientId ?? '', /^Iv23li/);
  assert.equal(gh.auth?.kind, 'device');
});

test('🔴 KHÔNG có secret nào trong danh mục — device flow không dùng tới', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/core/catalog.ts', import.meta.url), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.includes('│'))
    .join('\n');
  assert.doesNotMatch(code, /client_secret\s*:/i);
  assert.doesNotMatch(code, /private_?key/i);
});
