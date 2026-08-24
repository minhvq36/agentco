/**
 * Test cho luật **MỘT MỤC DANH MỤC LÀ DỮ LIỆU, KHÔNG PHẢI MÃ** (user chốt 25/08).
 * → docs/SPEC-arms.md §5h·1 · `src/core/catalog.ts`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Câu user hỏi 25/08, và nó là câu quyết định hình dạng của cả danh mục:   │
 * │                                                                          │
 * │   *"có thể quy về một mối dùng chung nhiều nhất có thể? Hoặc reuse chỉ   │
 * │    truyền param vào, thay vì phải viết nhiều file như notion.ts,         │
 * │    ggdrive.ts, slack.ts, github.ts, gmail.ts…"*                          │
 * │                                                                          │
 * │ Câu trả lời là CÓ, và test dưới đây là thứ giữ nó đúng. Không có nó thì  │
 * │ "danh mục là dữ liệu" chỉ là một câu trong spec — và câu trong spec thì  │
 * │ thua một hàm `build()` mà ai đó thêm vào vì "ca này đặc biệt".           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { CATALOG, buildConfig, catalogForUi, findArm, transportOf } from '../dist/core/catalog.js';

// ────────────────────────────────────────── luật: dữ liệu, không mã

/**
 * ⭐ TEST QUAN TRỌNG NHẤT FILE NÀY — và nó canh một chuyện về TƯƠNG LAI.
 *
 * Vòng `JSON.parse(JSON.stringify(x))` giữ nguyên mọi thứ là dữ liệu và **nuốt
 * im lặng** mọi thứ là hàm. Nên nếu một ngày có người thêm `build: () => …` trở
 * lại cho "một ca đặc biệt", test này đỏ **ngay hôm đó** — chứ không phải vào
 * ngày ta muốn chuyển danh mục sang JSON / tải từ xa và phát hiện nó không đi
 * được, sau khi đã có 8 mục.
 */
test('mọi mục danh mục TUẦN TỰ HOÁ ĐƯỢC — không hàm nào lọt vào', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CATALOG)), CATALOG);
});

test('catalogForUi không đánh rơi trường nào, và bù thêm `transport`', () => {
  const ui = catalogForUi();
  assert.equal(ui.length, CATALOG.length);
  for (const [i, a] of CATALOG.entries()) {
    for (const k of Object.keys(a)) assert.ok(k in ui[i]!, `giao diện thiếu trường "${k}"`);
    assert.equal(ui[i]!.transport, transportOf(a));
  }
});

test('mỗi mục có đủ thứ người dùng cần ĐỌC trước khi bấm', () => {
  for (const a of CATALOG) {
    assert.ok(a.blurb.trim(), `"${a.id}" thiếu blurb — thẻ không nói nó làm gì`);
    // Chìa nào cũng phải có câu "lấy ở đâu": thiếu nó thì người non-code kẹt,
    // và họ KHÔNG BIẾT ĐỂ HỎI AI. → SPEC-arms §5c
    for (const s of a.secrets) assert.ok(s.help.trim(), `"${a.id}/${s.name}" thiếu help`);
  }
});

// ──────────────────────────────────────────────────────── buildConfig

test('stdio: appendFolders nối thư mục vào CUỐI args', () => {
  assert.deepEqual(
    buildConfig({ kind: 'stdio', command: 'npx', args: ['-y', 'pkg'], appendFolders: true }, { folders: ['D:\\A', '/b'] }),
    { command: 'npx', args: ['-y', 'pkg', 'D:\\A', '/b'] },
  );
});

test('stdio: KHÔNG appendFolders thì thư mục bị bỏ qua, không lẫn vào args', () => {
  assert.deepEqual(
    buildConfig({ kind: 'stdio', command: 'x', args: ['-y'] }, { folders: ['D:\\A'] }),
    { command: 'x', args: ['-y'] },
  );
});

test('stdio: không sửa `args` gốc của mục danh mục', () => {
  // CATALOG là hằng dùng chung cho MỌI lần cắm. Đẩy thẳng vào `spec.args` là
  // lần cắm thứ hai mang theo thư mục của lần thứ nhất — hỏng im lặng, và
  // triệu chứng nằm ở một văn phòng khác chỗ gây ra nó.
  const spec = { kind: 'stdio' as const, command: 'npx', args: ['-y', 'pkg'], appendFolders: true };
  buildConfig(spec, { folders: ['D:\\A'] });
  assert.deepEqual(spec.args, ['-y', 'pkg']);
});

test('http: giữ nguyên ô trống ${…}, KHÔNG tự thay ở đây', () => {
  // Thay chìa là việc của `injectSecrets` lúc dựng server. Làm ở đây là ghi
  // giá trị thật vào `company.yaml` — file người dùng đọc được và commit được.
  assert.deepEqual(
    buildConfig({ kind: 'http', url: 'https://x/mcp', headers: { A: 'Bearer ${T}' } }, { folders: [] }),
    { type: 'http', url: 'https://x/mcp', headers: { A: 'Bearer ${T}' } },
  );
});

test('http: không headers thì không đẻ ra khoá rỗng', () => {
  assert.deepEqual(buildConfig({ kind: 'http', url: 'https://x/mcp' }, { folders: [] }), {
    type: 'http',
    url: 'https://x/mcp',
  });
});

// ───────────────────────────────────────────────── mục Notion cụ thể

test('Notion: HTTP hosted, chỉ đọc, và ô trống khớp ĐÚNG tên chìa đã khai', () => {
  const notion = findArm('notion');
  assert.ok(notion);
  assert.equal(transportOf(notion), 'http');
  assert.equal(notion.readOnly, true);

  /**
   * 🔴 Ô ĐO ĐẮT NHẤT: tên trong `${…}` phải khớp `secrets[].name` TỪNG KÝ TỰ.
   *
   * Lệch một ký tự ⇒ `injectSecrets` không thay được ⇒ server trả **401**, mà
   * 401 nói *"chìa sai"* chứ không nói *"chìa thiếu"* — người đi tìm sẽ kiểm
   * tài khoản, kiểm quyền, kiểm workspace. Câu lỗi **chỉ sai cửa** đắt hơn câu
   * lỗi không có. Không ai bắt được chuyện này bằng mắt. → §5m ②
   */
  const cfg = buildConfig(notion.spec, { folders: [] }) as { headers: Record<string, string> };
  const declared = new Set(notion.secrets.map((s) => s.name));
  const used = Object.values(cfg.headers).flatMap((v) => [...v.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]!));
  assert.ok(used.length, 'Notion đi HTTP mà không dùng ô trống nào — chìa sẽ không tới được server');
  for (const n of used) assert.ok(declared.has(n), `header dùng \${${n}} nhưng danh mục không khai chìa đó`);
});

test('Notion KHÔNG còn phụ thuộc gói npm nào — 0 rủi ro chuỗi cung ứng', () => {
  // Chính chủ ghi "may sunset this local MCP server repository". Ghim phiên bản
  // không cứu được ta khỏi việc đóng băng một thứ không còn ai vá. → §11d
  const notion = findArm('notion');
  assert.equal(JSON.stringify(notion?.spec).includes('npx'), false);
});
