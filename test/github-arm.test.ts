/**
 * MỤC GITHUB — dữ liệu, không phải mã. → `src/core/catalog.ts` · SPEC-arms §5h·7
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ba nhóm bất biến, và mỗi nhóm khoá một thứ đã suýt hỏng:                 │
 * │                                                                          │
 * │  ① **Nhóm việc vào cấu hình ⇒ vào BĂM.** Tick cùng ba nhóm theo hai thứ  │
 * │     tự khác nhau phải ra CÙNG một cánh tay, nếu không luật *"cùng cấu     │
 * │     hình ⇒ cùng cánh tay"* thủng ở đúng chỗ không ai nghĩ tới.            │
 * │                                                                          │
 * │  ② **Nấc `read` đổi CHÍNH CẤU HÌNH** (thêm hàng rào của server). Nên nấc  │
 * │     phải chốt TRƯỚC khi dựng cấu hình — ngược lại thì sổ ghi "chỉ đọc"     │
 * │     mà cấu hình thiếu hàng rào.                                          │
 * │                                                                          │
 * │  ③ **Không bí mật nào lọt vào danh mục.** Device flow không dùng          │
 * │     `client_secret`, và GitHub App của agentco cố ý **không có private    │
 * │     key** — hai thứ đó không được xuất hiện ở đây dù chỉ dưới dạng tên.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CATALOG, armHash, buildConfig, catalogForUi, findArm, needsOAuth } from '../dist/core/catalog.js';
import { t } from '../dist/i18n/index.js';

const gh = findArm('github')!;
const cfg = (input: Parameters<typeof buildConfig>[1]): { headers?: Record<string, string> } =>
  buildConfig(gh.spec, input) as { headers?: Record<string, string> };

// ─────────────────────────────────────────────────────── hình dạng mục

test('⭐ GitHub đăng nhập bằng MÃ THIẾT BỊ, và client_id là dữ liệu công khai', () => {
  assert.equal(gh.auth?.kind, 'device');
  assert.match(gh.auth?.clientId ?? '', /^Iv23li/, 'client_id của GitHub App');
  assert.equal(gh.price, 'login', 'người dùng không gõ chìa nào');
  assert.deepEqual(gh.secrets, [], 'chìa sinh từ luồng đăng nhập, không phải ô nhập');
});

test('🔴 KHÔNG có client secret hay private key ở bất kỳ đâu trong danh mục', () => {
  /**
   * Chốt bằng **cấu trúc**, không bằng kỷ luật. Device flow không dùng
   * `client_secret` ở bất kỳ bước nào — kể cả lúc làm mới — và GitHub App của
   * agentco cố ý không sinh private key, vì private key là đường DUY NHẤT để
   * chủ app mint installation token và với tới repo của khách. → §5h·7h
   */
  const src = readFileSync(new URL('../src/core/catalog.ts', import.meta.url), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.includes('│'))
    .join('\n');
  assert.doesNotMatch(code, /client_secret\s*:/i);
  assert.doesNotMatch(code, /private_?key/i);
  assert.doesNotMatch(code, /-----BEGIN/);
});

test('⭐ GitHub cần đăng nhập — suy từ ô ${OAUTH}, không khai tay', () => {
  assert.equal(needsOAuth(gh), true);
  assert.equal(catalogForUi().find((a) => a.id === 'github')?.needsLogin, true);
});

test('⭐ có bước HỎI DANH TÍNH — vì GitHub không trả tên trong phản hồi token', () => {
  // Không có bước này thì mọi tài khoản GitHub ra cùng một hạt giống băm ⇒ gộp
  // thành MỘT cánh tay, im lặng, tới khi người thứ hai đăng nhập. → §5h·7k
  assert.equal(gh.identity?.tool, 'get_me');
  assert.equal(gh.identity?.idField, 'id', 'phải là khoá KHÔNG đổi khi người dùng đổi tên');
  assert.equal(gh.identity?.labelField, 'login');
});

test('⭐ Notion KHÔNG có auth/identity — hai trường này là NGOẠI LỆ, không phải chuẩn', () => {
  const notion = findArm('notion')!;
  assert.equal(notion.auth, undefined, 'Notion có DCR ⇒ không cần client_id ship sẵn');
  assert.equal(notion.identity, undefined, 'Notion trả workspace_id ngay trong phản hồi token');
});

// ────────────────────────────────────── hai hàng rào, hai chủ sở hữu

test('🔴 THẺ PHẢI NÓI RA điều kiện — "repo riêng tư" mà không nói phải cài app là nửa sự thật', () => {
  /**
   * Chưa cài app vào repo nào thì mọi lời gọi trả **404**, và GitHub cố ý trả
   * 404 chứ không phải 403 (để không lộ repo có tồn tại). Thẻ im lặng ⇒ người
   * dùng đi kiểm chìa thay vì đi cài app. §5h·7l ③ bắt buộc thẻ phải nói.
   */
  assert.match(t(gh.blurb), /cài agentco vào/i);
});

test('⭐ CÓ CỬA đi tới màn hình đồng ý của GitHub — không có nó thì cánh tay "chạy" mà 404 hết', () => {
  /**
   * Trước 27/08 chuỗi `installations/new` **không xuất hiện một lần nào trong
   * sản phẩm** — nó chỉ nằm trong file walkthrough. Người dùng không đọc
   * walkthrough thì không bao giờ biết phải cài app. → C-2 · F-3 bài 13
   */
  assert.match(gh.scope?.url ?? '', /^https:\/\/github\.com\/apps\/[\w-]+\/installations\/new$/);
  assert.ok(gh.scope?.say, 'nút phải có chữ');
  /*
    ⚠ Bỏ 02/09: ô cũ đòi `scope.help` khớp /GitHub giữ/. Trường `help` đã gỡ khỏi
    danh mục (user chốt — app đang toàn chữ), nên ô đó đang khoá một CÂU CHỮ chứ
    không khoá bất biến.

    Bất biến thật vẫn nguyên ở hai dòng trên: **có một cửa đi tới màn hình đồng ý
    của GitHub**. Câu *"phạm vi này ai giữ"* nay được nói ở chỗ đúng lúc hơn —
    `repoScan` (§5h·7o) và câu dịch 404 lúc chạy thật (§5h·7f-bis), cả hai đều
    có test riêng.
  */
});

test('⭐ CHỈ MỘT hàng rào repo, và nó là của GitHub — ta không dựng cái thứ hai', () => {
  /**
   * Hàng rào repo phía ta (`limitTo` + `armJail`) tồn tại đúng nửa ngày 27/08.
   * Gỡ vì phạm vi repo là tài sản **cấp tài khoản của GitHub**: chồng thêm một
   * hàng rào chỉ mua được thu-hẹp-theo-cánh-tay, đổi lấy một cơ chế nữa + gõ
   * tay + đổi-là-cắm-lại. → `SPEC-arms.md` §5h·7m · [[agentco-count-mechanisms]]
   *
   * Thứ ở lại là `reachTest` — một **phép thử**, không phải một hàng rào.
   */
  assert.equal((gh as Record<string, unknown>)['limitTo'], undefined);
  assert.ok(gh.repoScan, 'nhưng phải TRA được bản cài — dấu ✓ không chứng minh tầm với');
});

// ─────────────────────────────────────────────────────── ① nhóm việc

test('🔴 nhóm việc phải SẮP XẾP trước khi nối — cùng tick ⇒ cùng băm', () => {
  const a = cfg({ folders: [], groups: ['repos', 'context'] });
  const b = cfg({ folders: [], groups: ['context', 'repos'] });
  assert.equal(a.headers?.['X-MCP-Toolsets'], 'context,repos');
  assert.deepEqual(a, b);
  assert.equal(armHash(a, ['G'], 'read'), armHash(b, ['G'], 'read'), 'thứ tự tick không được đẻ ra cánh tay thứ hai');
});

test('⭐ nhóm khác nhau ⇒ CÁNH TAY khác nhau (nó đổi cả năng lực lẫn hoá đơn)', () => {
  const hep = armHash(cfg({ folders: [], groups: ['context'] }), ['G'], 'read');
  const rong = armHash(cfg({ folders: [], groups: ['context', 'repos'] }), ['G'], 'read');
  assert.notEqual(hep, rong);
});

test('⭐ không tick nhóm nào ⇒ KHÔNG có header — không tự ý cắm cả server', () => {
  assert.equal(cfg({ folders: [] }).headers?.['X-MCP-Toolsets'], undefined);
  assert.equal(cfg({ folders: [], groups: [] }).headers?.['X-MCP-Toolsets'], undefined);
});

test('⭐ ô trống ${OAUTH} vẫn được thay đúng, không đụng header nhóm việc', () => {
  const c = cfg({ folders: [], account: 'GITHUB_OAUTH_A1B2C3D4', groups: ['repos'] });
  assert.equal(c.headers?.['Authorization'], 'Bearer ${GITHUB_OAUTH_A1B2C3D4}');
  assert.equal(c.headers?.['X-MCP-Toolsets'], 'repos');
});

test('🔴 nhóm việc KHÔNG được mượn cú pháp ${…} của chìa', () => {
  /**
   * `${…}` trong dự án này có đúng một nghĩa: **một cái tên chìa**, và
   * `missingSecretRefs()` quét cả cấu hình để tìm ô trống còn sót. Mượn cú pháp
   * đó cho toolsets là đẻ ra câu *"Thiếu chìa: TOOLSETS"* — một câu lỗi CHỈ SAI
   * CỬA nằm ngay trong bản vá cho câu lỗi sai cửa.
   */
  const c = cfg({ folders: [], account: 'GITHUB_OAUTH_A1B2C3D4', groups: ['repos'] });
  const con = JSON.stringify(c).match(/\$\{[^}]+\}/g) ?? [];
  assert.deepEqual(con, ['${GITHUB_OAUTH_A1B2C3D4}'], 'chỉ được còn đúng ô trống của CHÌA');
});

// ─────────────────────────────────────────────────────── ② nấc quyền

test('🔴 nấc `read` thêm HÀNG RÀO CỦA SERVER vào cấu hình', () => {
  // Đo 26/08: gọi tool ghi qua cửa chỉ-đọc bị từ chối ở TẦNG GIAO THỨC
  // (`-32602 unknown tool`), không phải "tool chạy rồi trả lỗi". → §5h·7j
  assert.equal(cfg({ folders: [], groups: ['repos'], level: 'read' }).headers?.['X-MCP-Readonly'], 'true');
});

test('⭐ nấc `full` KHÔNG có header đó', () => {
  assert.equal(cfg({ folders: [], groups: ['repos'], level: 'full' }).headers?.['X-MCP-Readonly'], undefined);
});

test('⭐ đổi nấc ⇒ băm khác ⇒ văn phòng khác KHÔNG bị đổi theo', () => {
  const doc = cfg({ folders: [], groups: ['repos'], level: 'read' });
  const toan = cfg({ folders: [], groups: ['repos'], level: 'full' });
  assert.notEqual(armHash(doc, ['G'], 'read'), armHash(toan, ['G'], 'full'));
});

test('⭐ mục KHÔNG khai readOnlyHeaders thì nấc read không đổi cấu hình', () => {
  // Notion: nấc `read` vẫn chạy bằng lớp lọc `allowedTools` của ta như cũ.
  // Hai lá chắn khác tầng — hãng nào có cửa riêng thì ta chồng thêm, không thay.
  const notion = findArm('notion')!;
  const a = buildConfig(notion.spec, { folders: [], level: 'read' });
  const b = buildConfig(notion.spec, { folders: [], level: 'full' });
  assert.deepEqual(a, b);
});

// ─────────────────────────────────────────────────────── ③ danh mục vẫn là DỮ LIỆU

test('⭐ mọi mục danh mục vẫn tuần tự hoá được — không hàm nào lọt vào', () => {
  // Bất biến §5h·1: danh mục chuyển sang JSON / tải từ xa / cho người dùng tự
  // thêm một mục đều KHÔNG cần đổi một dòng mã nào.
  for (const arm of CATALOG) {
    const lai = JSON.parse(JSON.stringify(arm)) as unknown;
    assert.deepEqual(lai, arm, `mục "${arm.id}" mất dữ liệu khi qua JSON`);
  }
});

test('⭐ mục GitHub bật sẵn nhóm RẺ, không bật sẵn cả server', () => {
  const on = (gh.groups ?? []).filter((g) => g.on).map((g) => g.id);
  assert.deepEqual(on, ['context', 'repos']);
  // Cả server = 44 việc ≈30 000 token MỖI LƯỢT, trong khi sàn tool của cả hệ
  // thống mới ~13 200. Một mặc định quên tay ở đây là hoá đơn của khách. → §5h·7e
  assert.ok(on.length < (gh.groups ?? []).length, 'không được bật sẵn hết');
});
