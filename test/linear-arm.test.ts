/**
 * MỤC LINEAR — và chốt cho **cơ chế cắt-ở-server thứ hai**. → `src/core/arms/linear.ts`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO FILE NÀY TỒN TẠI, dù `github-arm.test.ts` đã khoá nấc `read`:     │
 * │                                                                          │
 * │ GitHub cắt bằng **header**, Linear cắt bằng **URL**. Hai cơ chế, và mã    │
 * │ đọc chúng ở **hai chỗ khác nhau**: `buildConfig` (giữa file) và           │
 * │ `serverFenced` (cuối file). Thêm cơ chế mà chỉ sửa chỗ đầu là bug 27/08   │
 * │ sống lại — bộ chọn nấc biến mất, người dùng khoá cứng ở nấc thấp nhất,    │
 * │ **không câu lỗi nào**. Test ⑤ dưới đây là chốt cho đúng chỗ hở đó.        │
 * │                                                                          │
 * │ Mọi con số ở đây **đo 29/08 bằng chìa thật** (`spike-linear-oauth.ts`).   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { armHash, buildConfig, findArm, needsOAuth, serverFenced } from '../dist/core/catalog.js';
import { t } from '../dist/i18n/index.js';

const li = findArm('linear')!;
const cfg = (input: Parameters<typeof buildConfig>[1]): { url?: string; headers?: Record<string, string> } =>
  buildConfig(li.spec, input) as { url?: string; headers?: Record<string, string> };

// ─────────────────────────────────────────────── ① hình dạng mục

test('⭐ Linear đăng nhập bằng OAuth, 0 ô chìa', () => {
  assert.equal(li.price, 'login');
  assert.deepEqual(li.secrets, [], 'chìa sinh từ luồng đăng nhập, không phải ô nhập');
  assert.equal(needsOAuth(li), true);
  assert.equal(li.auth, undefined, 'DCR mở ⇒ không cần client_id ship sẵn như GitHub');
});

test('🔴 KHÔNG chuỗi bí mật nào trong danh mục — chỉ ô trống có tên quy ước', () => {
  const s = JSON.stringify(li);
  assert.ok(s.includes('${OAUTH}'), 'header phải là ô trống, không phải chìa thật');
  assert.doesNotMatch(s, /client_secret|private[_-]?key|lin_(api|oauth)_/i);
});

// ─────────────────────────────────────────────── ② nấc read đổi ĐỊA CHỈ

test('⭐ nấc `read` bắn vào /mcp/readonly — hàng rào của CHÍNH HÃNG', () => {
  assert.equal(cfg({ folders: [], level: 'read' }).url, 'https://mcp.linear.app/mcp/readonly');
});

test('⭐ nấc `add` và `full` bắn vào /mcp đầy đủ', () => {
  // `readOnlyUrl` chỉ phục vụ nấc THẤP NHẤT. Nấc `add` không có URL riêng ở
  // phía Linear, nên nó vẫn phải đi cửa đầy đủ + lớp `allowedTools` của ta.
  assert.equal(cfg({ folders: [], level: 'add' }).url, 'https://mcp.linear.app/mcp');
  assert.equal(cfg({ folders: [], level: 'full' }).url, 'https://mcp.linear.app/mcp');
});

test('⭐ đổi nấc ⇒ băm khác ⇒ hai nấc là hai cánh tay', () => {
  const doc = cfg({ folders: [], level: 'read' });
  const toan = cfg({ folders: [], level: 'full' });
  assert.notEqual(armHash(doc, ['L'], 'read'), armHash(toan, ['L'], 'full'));
});

test('📌 URL nằm trong băm — nấc đọc/ghi tách nhau kể cả khi bỏ tham số `level`', () => {
  /**
   * Đây là **quà kèm theo** của cơ chế URL, không phải chủ ý: bản cắt-bằng-header
   * phải nhờ `level` mới tách được băm, còn ở đây chính cấu hình đã khác nhau.
   * Test này khoá tính chất đó lại — mất nó thì hai nấc đè nhau im lặng.
   */
  assert.notEqual(armHash(cfg({ folders: [], level: 'read' }), ['L']), armHash(cfg({ folders: [], level: 'full' }), ['L']));
});

// ─────────────────────────────── ②b scope xin lúc Đồng ý

test('🔴 phải xin `read write` — xin hẹp là tự khoá bộ chọn nấc', () => {
  /**
   * Đo 29/08: đăng nhập với `scope=read` ⇒ `/mcp` đầy đủ cũng chỉ trả 35 việc
   * ⇒ `offeredTiers` thu về **một nấc** ⇒ không còn đường lên toàn quyền.
   * Scope chốt lúc bấm Đồng ý, **trước** khi người dùng thấy bộ chọn nấc.
   */
  const spec = li.spec as { authScope?: string };
  assert.equal(spec.authScope, 'read write');
});

test('⭐ KHÔNG xin `openid`/`email` — chúng trả danh tính NGƯỜI, ta cần WORKSPACE', () => {
  // Một người có N workspace ⇒ cùng `sub` ⇒ vẫn đè nhau. Xin thêm hai scope đó
  // là mở rộng bán kính mà không mua được thứ ta cần.
  const spec = li.spec as { authScope?: string };
  assert.doesNotMatch(spec.authScope ?? '', /openid|email/);
});

test('⭐ mọi mục KHÁC không khai `authScope` — URL đăng nhập không đổi một byte', () => {
  for (const id of ['notion', 'github']) {
    const s = findArm(id)!.spec as { authScope?: string };
    assert.equal(s.authScope, undefined, `${id} phải giữ hành vi cũ (không gửi tham số scope)`);
  }
});

// ─────────────────────────────────────────────── ③ danh tính BẮT BUỘC

test('🔴 phải khai `identity` — Linear KHÔNG trả danh tính trong phản hồi token', () => {
  /**
   * Đo 29/08: sau ba lần đăng nhập, `extra` của cả ba tài khoản **rỗng hoàn
   * toàn**. Không seed thì `accountName` rơi về nhánh dự phòng `issuer|mcp_url`
   * — giống hệt nhau cho mọi người dùng ⇒ hai workspace GỘP làm một cánh tay,
   * và **không có triệu chứng** cho tới khi ai đó nối workspace thứ hai.
   * Số đo: không seed → cả 3 chìa ra `LINEAR_OAUTH_AA1F1EAD`;
   *        seed = workspace id → `…52BA79B8` ≠ `…5C5D1429`.
   */
  assert.equal(li.identity?.tool, 'get_workspace');
  assert.equal(li.identity?.idField, 'id', 'đổi tên workspace KHÔNG được đổi băm');
  assert.equal(li.identity?.labelField, 'name');
});

test('📌 hỏi danh tính ở URL ĐẦY ĐỦ, không ở /readonly', () => {
  // Lúc hỏi danh tính thì chưa ai chọn nấc. `get_workspace` tình cờ là việc đọc
  // nên hai URL đều trả được — nhưng dựa vào một sự trùng hợp là dựng một cái
  // bẫy cho hãng tiếp theo không trùng hợp như thế.
  assert.equal(li.identity?.url, 'https://mcp.linear.app/mcp');
  assert.notEqual(li.identity?.url, li.spec.kind === 'http' ? li.spec.readOnlyUrl : undefined);
});

// ─────────────────────────────── ③b câu giải thích nấc `add` không được nói dối

test('🔴 nấc `add` phải có câu RIÊNG — câu mặc định hứa "tạo được", Linear thì không', () => {
  /**
   * Linear không có `create_issue`; `save_issue` là upsert khai
   * `destructiveHint: true` ⇒ mở issue rơi xuống `full`. Nấc `add` thêm đúng 4
   * việc (3 đính kèm + `create_issue_label`). Câu mặc định của ta là *"Tạo được
   * trang/mục mới, nhưng không đụng tới thứ đã có sẵn"* — đọc xong người dùng
   * chọn `add` rồi bảo nhân viên mở việc mới, và bị chặn.
   */
  const say = li.tierSay?.add ? t(li.tierSay.add) : '';
  assert.ok(say.length > 0, 'phải ghi đè');
  assert.match(say, /KHÔNG mở được issue/, 'phải nói ra thứ KHÔNG làm được');
  assert.match(say, /Toàn quyền/, 'và chỉ đường lên nấc làm được');
});

test('⭐ ghi đè chỉ chạm nấc cần chạm — `read`/`full` vẫn dùng câu chung', () => {
  assert.equal(li.tierSay?.read, undefined);
  assert.equal(li.tierSay?.full, undefined);
});

test('⭐ mọi mục KHÁC không khai `tierSay` — đường mặc định không đổi', () => {
  // Chốt cho câu "đừng làm hỏng notion, github, playwright". Mục nào im lặng thì
  // giao diện rơi về `TIER_SAY` y như trước, không một nhánh mới nào.
  for (const id of ['notion', 'github', 'files', 'browser']) {
    assert.equal(findArm(id)!.tierSay, undefined, `${id} phải giữ câu mặc định`);
  }
});

// ─────────── ③c câu dặn model: nhãn là WORKSPACE, không phải project

test('🔴 HỒI QUY 30/08 — `hint` phải nói nhãn là WORKSPACE, không phải project', () => {
  /**
   * Ca thật: hỏi *"bao nhiêu việc In Progress"*, Trợ lý viết *"trong Linear
   * **project** Agent-co-test-2"*, nhân viên gọi `list_issues` (được 9 việc)
   * rồi đi tìm project — `list_projects` trả `[]` — và **báo thất bại trong khi
   * đã cầm sẵn câu trả lời**. 6 lượt, $0,1409, sai.
   */
  const h = li.hint ?? '';
  assert.match(h, /WORKSPACE/, 'phải nói ra nhãn là loại gì');
  assert.match(h, /not a project/i);
  assert.match(h, /list_issues/, 'và phải CHỈ ĐƯỜNG ĐI TIẾP, không chỉ cấm');
});

test('⭐ `hint` phải NGẮN — nó vào prefix MỌI lượt của vai trò có cánh tay này', () => {
  // Một câu dài ở đây là một hoá đơn dài, lặp lại mãi mãi. Mốc: `browser` là
  // mục có `hint` dài nhất hôm nay; đừng vượt nó nhiều.
  assert.ok((li.hint ?? '').length < 260, `hint dài ${li.hint?.length} ký tự`);
});

// ─────────────────────────────────────────────── ④ thương hiệu

test('⭐ có logo VÀ có lời khai đã đọc quy tắc — §11c đòi ĐỦ CẢ HAI', () => {
  /**
   * Ship `mark` mà `checkedOn: null` là **nợ mù** — đúng chỗ Notion và GitHub
   * đang đứng. Mục này đọc 🌐 linear.app/brand ngày 30/08 rồi mới dán, nên hai
   * ô đi cùng nhau. Test khoá cặp đó lại: ai thêm `mark` cho mục mới mà quên
   * `checkedOn` sẽ hỏng ở đây, không hỏng lúc luật sư gọi điện.
   */
  assert.ok(li.brand.mark, 'phải có đường dẫn SVG');
  assert.ok(li.brand.guidelineUrl, 'phải nêu quy tắc đã đọc ở đâu');
  assert.match(li.brand.checkedOn ?? '', /^\d{4}-\d{2}-\d{2}$/, 'phải có NGÀY đọc');
});

test('🔴 logo là hình ĐƠN SẮC 24×24, không màu hãng, không nền', () => {
  /**
   * Quy tắc Linear: *"Do not alter these files in any way"* và **ưu tiên đơn
   * sắc**. `ArmIcon.tsx` tô bằng `currentColor`, nên mọi mã màu lọt vào đây là
   * vừa sai quy tắc vừa phá luật "0 tên hãng / 0 màu hãng trong mã web".
   */
  const m = li.brand.mark ?? '';
  assert.doesNotMatch(m, /#[0-9a-f]{3,8}\b|rgb|fill=|<svg|<path/i, 'chỉ đường dẫn, không phải cả thẻ SVG');
  assert.match(m, /^M/, 'bắt đầu bằng lệnh moveto');
});

// ─────────────────────────────────────────── ⑤ ⭐ CHỐT CHO BẪY 27/08

test('🔴🔴 `serverFenced` PHẢI thấy `readOnlyUrl` — quên là bộ chọn nấc biến mất', () => {
  /**
   * Ô đắt nhất file này. `serverFenced` từng chỉ đọc `readOnlyHeaders`; thêm
   * `readOnlyUrl` mà không sửa nó thì phép thử ở nấc `read` bắn vào
   * `/mcp/readonly` ⇒ server trả 35 việc ⇒ ba nấc bằng nhau ⇒ luật *"chỉ hiện
   * nấc nào thêm ≥1 việc"* thu về MỘT nấc ⇒ **không có đường lên toàn quyền**.
   * Đo thật 29/08 đã dựng lại đúng triệu chứng đó:
   *   `━━ Q4 · BỘ CHỌN NẤC — người dùng sẽ thấy 1 nấc`
   */
  assert.equal(serverFenced(li), true);
});

test('⭐ đối chứng: mục không cắt-ở-server thì `serverFenced` phải là false', () => {
  // Notion — nấc `read` thi hành bằng lớp `allowedTools` của ta, không có cửa
  // riêng ở phía hãng. Nếu ô này thành `true` thì phép khám phá của Notion bị
  // cắt cụt vô cớ.
  assert.equal(serverFenced(findArm('notion')!), false);
  assert.equal(serverFenced(findArm('github')!), true, 'GitHub cắt bằng header');
});

test('⭐ mục KHÔNG khai readOnlyUrl thì nấc read không đổi ĐỊA CHỈ', () => {
  const notion = findArm('notion')!;
  assert.deepEqual(
    buildConfig(notion.spec, { folders: [], level: 'read' }),
    buildConfig(notion.spec, { folders: [], level: 'full' }),
  );
});
