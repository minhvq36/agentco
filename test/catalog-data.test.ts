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

import {
  CATALOG,
  FILES_ARM,
  GITHUB_ARM,
  NOTION_ARM,
  buildConfig,
  catalogForUi,
  findArm,
  transportOf,
} from '../dist/core/catalog.js';

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

test('Notion: HTTP hosted, ĐĂNG NHẬP, và có đủ ba nấc quyền', () => {
  const notion = findArm('notion');
  assert.ok(notion);
  assert.equal(transportOf(notion), 'http');
  assert.equal(notion.price, 'login');
  assert.equal(notion.tiered, true);
  // Không ô chìa nào: tên chìa OAuth mang `workspace_id`, sinh lúc đăng nhập —
  // khai trước ở đây là khai một chuỗi chắc chắn sai.
  assert.deepEqual(notion.secrets, []);
});

test('⭐ Notion: ô `${OAUTH}` được thay bằng ĐÚNG tên tài khoản, không sót', () => {
  /**
   * 🔴 Ô ĐO ĐẮT NHẤT CỦA CẢ LUỒNG OAUTH.
   *
   * `${OAUTH}` là **chỗ trống có tên quy ước**, không phải tên chìa. `buildConfig`
   * phải thay nó bằng tên tài khoản thật; sót lại một cái là header bay lên
   * Notion mang nguyên chữ `${OAUTH}` ⇒ **401** ⇒ và 401 nói *"chìa sai"* chứ
   * không nói *"chìa thiếu"*, tức dắt người đi tìm sang nhầm cửa. → §5m ②
   *
   * (`probeArm` có lưới thứ hai — `missingSecretRefs` chặn trước khi gửi — nhưng
   * lưới đó bắt *triệu chứng*. Test này canh *nguyên nhân*.)
   */
  const notion = findArm('notion');
  assert.ok(notion);
  const cfg = buildConfig(notion.spec, { folders: [], account: 'NOTION_OAUTH_A1B2C3D4' }) as {
    headers: Record<string, string>;
  };
  const used = Object.values(cfg.headers).flatMap((v) =>
    [...v.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]!),
  );
  assert.deepEqual(used, ['NOTION_OAUTH_A1B2C3D4']);
  assert.equal(JSON.stringify(cfg).includes('${OAUTH}'), false, 'còn sót ô trống chưa thay');
});

test('Notion: CHƯA chọn tài khoản thì ô trống GIỮ NGUYÊN, không tự bịa tên', () => {
  // Giữ nguyên `${OAUTH}` là đúng: `missingSecretRefs` sẽ thấy và chặn trước khi
  // gửi. Tự thay bằng một tên đoán mò là biến "chưa chọn" thành "chọn sai".
  const notion = findArm('notion');
  const cfg = buildConfig(notion!.spec, { folders: [] });
  assert.ok(JSON.stringify(cfg).includes('${OAUTH}'));
});

test('Notion KHÔNG còn phụ thuộc gói npm nào — 0 rủi ro chuỗi cung ứng', () => {
  // Chính chủ ghi "may sunset this local MCP server repository". Ghim phiên bản
  // không cứu được ta khỏi việc đóng băng một thứ không còn ai vá. → §11d
  const notion = findArm('notion');
  assert.equal(JSON.stringify(notion?.spec).includes('npx'), false);
});

// ═════════════════════════════ MỘT HÃNG = MỘT FILE (tách 28/08) ═════════════

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ngày 25/08 user hỏi *"thay vì phải viết nhiều file như notion.ts,        │
 * │ github.ts…"* — và câu trả lời lúc đó (một mảng, không hàm dựng riêng)     │
 * │ VẪN ĐÚNG. Cái tách ra 28/08 là **chỗ ĐỂ dữ liệu**, không phải cách dùng   │
 * │ nó: vẫn một `CatalogArm`, vẫn một `buildConfig`, vẫn 0 nhánh theo tên     │
 * │ hãng. Test ngay trên (`tuần tự hoá được`) là thứ canh điều đó, và nó vẫn  │
 * │ xanh sau khi tách — đó là bằng chứng, không phải lời hứa.                 │
 * │                                                                          │
 * │ Ca dưới canh chuyện khác: `arms/index.ts` **đánh rơi một mục** thì im     │
 * │ lặng — mục biến khỏi giao diện, không lỗi, không test nào khác đỏ.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
test('🔴 `arms/index.ts` phải gom ĐỦ mọi mục — rơi một cái là im lặng', () => {
  for (const arm of [FILES_ARM, NOTION_ARM, GITHUB_ARM]) {
    assert.ok(
      CATALOG.includes(arm),
      `${arm.id} có file riêng nhưng KHÔNG có trong CATALOG — nó vừa biến khỏi giao diện`,
    );
  }
  assert.equal(CATALOG.length, new Set(CATALOG.map((a) => a.id)).size, 'id phải là duy nhất');
});

// ───────────────────────────────── nhóm việc: tên của hãng + câu giải thích

test('🔴 mọi nhóm việc phải có `help` — tên nhóm một mình thì người non-code đoán', () => {
  /**
   * User 28/08: *"Cái check đầu tiên: 'Biết tôi là ai, repo nào' tôi nghe không
   * hiểu"*. Cách chữa SAI là dịch tên nhóm thành một câu — nhãn cũ làm thế và
   * còn hứa sai bán kính (`context` không có tool nào về repo). Cách chữa đúng:
   * **giữ tên của hãng**, thêm một câu nói việc làm được. Test này giữ vế thứ
   * hai, vì vế thứ nhất không ai quên còn vế này thì quên rất dễ.
   */
  for (const a of CATALOG) {
    for (const g of a.groups ?? []) {
      assert.ok(g.help && g.help.trim().length > 10, `${a.id}/${g.id} thiếu câu giải thích`);
    }
  }
});

// ─────────────────────────────────────────── logo hãng sống trong `brand`

test('🔴 `brand.mark` là ĐƯỜNG DẪN SVG, không phải markup', () => {
  /**
   * Đường dẫn bị hỏng thì hình **méo chứ không lỗi** — không có gì kêu lên.
   * (Đã suýt dẫm 28/08: cắt chuỗi path thành nhiều mảnh rồi nối, nuốt mất một
   * dấu cách ở chỗ nối.) Ca này bắt lớp hỏng thô: mất chữ `M` mở đầu, lọt thẻ
   * markup, hoặc ai đó dán nguyên `<svg>` vào.
   */
  for (const a of CATALOG) {
    const m = a.brand.mark;
    if (!m) continue;
    assert.match(m, /^[Mm]/, `${a.id}: path phải bắt đầu bằng lệnh moveto`);
    assert.doesNotMatch(m, /[<>]/, `${a.id}: đây là thuộc tính "d", không phải markup`);
    assert.ok(m.length > 40, `${a.id}: path ngắn bất thường — nhiều khả năng bị cắt cụt`);
  }
});

test('⭐ `catalogForUi` chở `brand.mark` sang giao diện', () => {
  // Rơi trường này thì logo biến mất **im lặng** ở cả hộp thoại lẫn sơ đồ, và
  // giao diện ngã về icon theo loại — trông như một quyết định thiết kế.
  const gh = catalogForUi().find((a) => a.id === 'github');
  assert.ok(gh?.brand.mark, 'thiếu ⇒ node GitHub trên sơ đồ tụt về hình phích cắm');
});
