/**
 * TÊN TÀI KHOẢN OAUTH — tất định, hợp lệ làm ô trống, và **nhận dạng lại được**.
 * → `src/core/oauth.ts §accountName · §isAccountName` · docs/SPEC-arms.md §5h
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Hai bug user báo 26/08, cả hai quy về cái tên này:                       │
 * │                                                                          │
 * │ ① *"Thiếu chìa: NOTION_OAUTH_AFAFBCD6"* sau khi đăng nhập THÀNH CÔNG —   │
 * │   `resolveArm` không đọc kho chìa nên ô trống không được thay.           │
 * │ ② Câu lỗi đó bảo người dùng đi điền một thứ **không tồn tại**:           │
 * │   *"Notion làm gì có chìa nào, human đọc sẽ rất khó hiểu"*.              │
 * │                                                                          │
 * │ ② vá được nhờ NHẬN DẠNG được tên — nên phép nhận dạng phải khớp đúng      │
 * │ thứ hàm mint sinh ra, và không khớp nhầm một chìa gõ tay.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { accountName, applyToken, hasOwnSeed, isAccountName } from '../dist/core/oauth.js';

const base = { issuer: 'https://mcp.notion.com', mcp_url: 'https://mcp.notion.com/mcp' };

test('tên hợp lệ làm Ô TRỐNG — chỉ [A-Z0-9_]', () => {
  /**
   * ⚠ `PLACEHOLDER` của `secrets.ts` là `\$\{([A-Z0-9_]+)\}`. Một ký tự ngoài
   * bộ đó ⇒ ô trống **không khớp** ⇒ chìa lặng lẽ không được tiêm ⇒ 401. Đó là
   * lý do tên đi qua băm rồi mới cắt, chứ không lấy thẳng `workspace_id` (id
   * thật có dấu `-` và chữ thường).
   */
  const n = accountName('notion', { ...base, extra: { workspace_id: 'a1b2c3d4-ee55-0000-9999-abcdefabcdef' } });
  assert.match(n, /^[A-Z0-9_]+$/);
  assert.match(n, /^NOTION_OAUTH_[0-9A-F]{8}$/);
});

test('TẤT ĐỊNH — cùng workspace ⇒ cùng tên, đăng nhập lại không đẻ mục mới', () => {
  // User đã xác nhận bằng tay 26/08: *"thử OAuth 2 lần cùng 1 workspace, không
  // sinh ra trùng lặp"*. Đây là ô giữ cho điều đó đúng mãi.
  const acc = { ...base, extra: { workspace_id: 'ws-1' } };
  assert.equal(accountName('notion', acc), accountName('notion', { ...acc }));
});

test('KHÁC workspace ⇒ KHÁC tên — hai không gian không bị gộp làm một', () => {
  /**
   * Đây là ca §6i cảnh báo từ 23/08: hai workspace Notion có **cùng URL**. Tên
   * chìa đi vào `secretNames` ⇒ vào `armHash`. Cùng tên ⇒ cùng băm ⇒ hai
   * workspace thành một cánh tay, hỏng im lặng ở chỗ đắt nhất.
   */
  const a = accountName('notion', { ...base, extra: { workspace_id: 'ws-1' } });
  const b = accountName('notion', { ...base, extra: { workspace_id: 'ws-2' } });
  assert.notEqual(a, b);
});

test('KHÔNG có workspace_id ⇒ vẫn tất định, rơi về issuer + mcp_url', () => {
  // Dịch vụ không trả workspace ⇒ một tài khoản mỗi server. Vẫn phải ổn định:
  // sinh tên ngẫu nhiên là mỗi lần đăng nhập đẻ một mục mới.
  const a = accountName('linear', base);
  assert.equal(a, accountName('linear', { ...base }));
  assert.match(a, /^LINEAR_OAUTH_[0-9A-F]{8}$/);
});

test('tiền tố bị làm sạch — mục danh mục có dấu gạch vẫn ra tên hợp lệ', () => {
  const n = accountName('google-drive', base);
  assert.match(n, /^GOOGLEDRIVE_OAUTH_[0-9A-F]{8}$/);
});

// ─────────────────────────── nhận dạng lại, cho câu lỗi

test('⭐ isAccountName: nhận đúng thứ accountName sinh ra', () => {
  for (const p of ['notion', 'linear', 'google-drive']) {
    assert.ok(isAccountName(accountName(p, base)), `không nhận ra tên do chính mình sinh: ${p}`);
  }
});

test('⭐ isAccountName: KHÔNG nhận nhầm một chìa gõ tay', () => {
  /**
   * Nhận nhầm thì câu lỗi bảo người dùng *"bấm Đăng nhập"* cho một chìa họ phải
   * **gõ** — tức lại đúng cái lỗi §5m mà phép tách này sinh ra để chữa, chỉ đảo
   * chiều. Hai câu phải ra đúng hai ca.
   */
  for (const n of ['NOTION_ACCESS_TOKEN', 'GITHUB_TOKEN', 'MY_OAUTH_KEY', 'OAUTH', 'X_OAUTH_ABCDEFG']) {
    assert.equal(isAccountName(n), false, `nhận nhầm "${n}" là tài khoản`);
  }
});

// ═══════ DANH TÍNH HỎNG ⇒ KHÔNG ĐƯỢC MINT TÊN CHUNG (bug user bắt 28/08) ═══════

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ User: *"Lần đầu tiên tôi chọn 1 account mới, nó ra tên tài khoản là       │
 * │ OAUTH_… viết hoa… Tôi gỡ đi và làm lại, vẫn account đó, nó ra chính xác   │
 * │ tên"*.                                                                    │
 * │                                                                          │
 * │ Cái tên xấu chỉ là TRIỆU CHỨNG. Bệnh: `probeIdentity` hỏng ⇒ không có     │
 * │ `seed` ⇒ `accountName` rơi về `issuer|mcp_url` — chuỗi **giống hệt nhau   │
 * │ cho mọi tài khoản GitHub** ⇒ tài khoản thứ hai GHI ĐÈ tài khoản thứ nhất, │
 * │ im lặng. Ca test này khoá đúng chỗ đó.                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
test('🔴🔴 KHÔNG có seed ⇒ MỌI tài khoản GitHub ra CÙNG một tên', () => {
  const gh = (extra: Record<string, unknown> = {}) => ({
    issuer: 'https://github.com',
    mcp_url: 'https://api.githubcopilot.com/mcp/',
    extra,
  });
  // Hai người khác nhau, hai lượt cấp quyền khác nhau — nhưng không ai có seed.
  assert.equal(
    accountName('github', gh()),
    accountName('github', gh()),
    'ĐÂY là lý do `oauthDevicePoll` phải từ chối lưu khi mục có `identity` mà thiếu seed',
  );
  // Có seed ⇒ tách sạch. Đó là cả điểm của `identity.idField`.
  assert.notEqual(accountName('github', gh(), '111'), accountName('github', gh(), '222'));
});

test('⭐ seed tách được hai tài khoản dù mọi thứ khác giống hệt', () => {
  const a = { issuer: 'https://github.com', mcp_url: 'https://x/mcp/', extra: {} };
  assert.notEqual(accountName('github', a, 'minhvq36-id'), accountName('github', a, 'other-id'));
  // Cùng seed ⇒ cùng tên: đăng nhập lại KHÔNG được đẻ ra một tài khoản thứ hai.
  assert.equal(accountName('github', a, 'minhvq36-id'), accountName('github', a, 'minhvq36-id'));
});

// ═══════ CHỐT DANH TÍNH RIÊNG — `hasOwnSeed` (thêm 28/08) ═══════

test('🔴 KHÔNG workspace_id, KHÔNG seed ⇒ hasOwnSeed FALSE (nhánh gộp tài khoản)', () => {
  assert.equal(hasOwnSeed({ extra: {} }), false);
  assert.equal(hasOwnSeed({}), false);
  // Chuỗi rỗng / toàn khoảng trắng KHÔNG phải một danh tính — nó chỉ trông giống.
  assert.equal(hasOwnSeed({ extra: { workspace_id: '' } }), false);
  assert.equal(hasOwnSeed({ extra: {} }, '   '), false);
});

test('⭐ HAI đường lấy danh tính, cả hai đều hợp lệ', () => {
  // Notion: hãng trả `workspace_id` ngay trong phản hồi token.
  assert.equal(hasOwnSeed({ extra: { workspace_id: 'ws-1' } }), true);
  // GitHub: hãng trả rỗng, ta đi hỏi `get_me` rồi truyền `id` vào. → §5h·7k
  assert.equal(hasOwnSeed({ extra: {} }, '12345'), true);
});

test('🔴 workspace_id KHÔNG phải chuỗi ⇒ không tin (dữ liệu của bên thứ ba)', () => {
  assert.equal(hasOwnSeed({ extra: { workspace_id: 123 as unknown as string } }), false);
  assert.equal(hasOwnSeed({ extra: { workspace_id: null as unknown as string } }), false);
});

test('⭐ `hasOwnSeed` FALSE khớp ĐÚNG nhánh làm hai tài khoản trùng tên', () => {
  /**
   * Ràng buộc thật giữa hai hàm: hễ `hasOwnSeed` nói false thì `accountName`
   * ra một chuỗi **không phụ thuộc tài khoản** — tức mọi người dùng chung tên.
   * Đây là chỗ nối hai hàm lại, và nếu ai đó đổi nhánh dự phòng của
   * `accountName` mà quên `hasOwnSeed` thì ca này đỏ.
   */
  const a = { issuer: 'https://x', mcp_url: 'https://x/mcp', extra: {} };
  const b = { issuer: 'https://x', mcp_url: 'https://x/mcp', extra: { other: 'khác hẳn' } };
  assert.equal(hasOwnSeed(a), false);
  assert.equal(hasOwnSeed(b), false);
  assert.equal(accountName('p', a), accountName('p', b), 'hai tài khoản khác nhau, MỘT cái tên');
});

// ═══ CHỐT MỚI CÓ CHẶN NHẦM NOTION KHÔNG? — kiểm bằng chính hàm dựng tài khoản ═══

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 CA NÀY SINH RA TỪ MỘT LẦN SUÝT SAI, và nó đáng giữ hơn cả bản vá.     │
 * │                                                                          │
 * │ Thêm chốt `hasOwnSeed` xong, tôi đo kho thật để "xác nhận" — và cả ba tài │
 * │ khoản đều ra `false`, kể cả hai tài khoản Notion **đang chạy tốt**. Đọc   │
 * │ theo nghĩa đen thì chốt mới sẽ chặn mọi lượt đăng nhập Notion.            │
 * │                                                                          │
 * │ Sự thật: `applyToken` chỉ giữ `extra` khi phản hồi có trường lạ, mà phản  │
 * │ hồi **làm mới** của Notion không mang `workspace_id` ⇒ sau lần refresh    │
 * │ đầu, `extra` biến mất khỏi bản ghi. Bằng chứng lúc mint vẫn còn nguyên:   │
 * │ hai tài khoản Notion có **tên khác nhau** (`AFAFBCD6` ≠ `084F6A58`), mà   │
 * │ tên chỉ khác được nếu lúc đó có `workspace_id`.                           │
 * │                                                                          │
 * │ ⇒ Đo đúng chỗ: hỏi hàm **dựng tài khoản lúc mint**, đừng hỏi bản đã lưu.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
test('🔴 lượt MINT của Notion CÓ danh tính ⇒ chốt mới không chặn nhầm', () => {
  // Hình dạng phản hồi token của Notion, nguyên văn các trường đang dựa vào.
  const acc = applyToken(
    { client_id: 'c', mcp_url: 'https://mcp.notion.com/mcp', issuer: 'https://mcp.notion.com' },
    {
      access_token: 'at',
      refresh_token: 'rt',
      token_type: 'Bearer',
      expires_in: 28800,
      workspace_id: 'ws-abc',
      workspace_name: "Minh Vu Quoc's Notion",
    } as never,
  );
  assert.equal(acc.extra?.['workspace_id'], 'ws-abc', 'trường lạ phải rơi vào `extra`');
  assert.equal(hasOwnSeed(acc), true, 'chặn ở đây là chặn một lượt đăng nhập LÀNH');
});

test('🔴 lượt LÀM MỚI đánh rơi `extra` — nên ĐỪNG hỏi chốt trên bản đã lưu', () => {
  /**
   * Ca này khoá đúng cái bẫy đã suýt lừa tôi. Nó KHÔNG đòi sửa hành vi: tên tài
   * khoản đã chốt lúc mint, nên mất `extra` sau đó không hỏng gì. Nó chỉ ghi lại
   * rằng `hasOwnSeed(bản đã lưu)` là một phép đo TRẢ LỜI SAI CÂU HỎI.
   */
  const minted = applyToken(
    { client_id: 'c', mcp_url: 'u', issuer: 'i' },
    { access_token: 'at', token_type: 'Bearer', workspace_id: 'ws-abc' } as never,
  );
  const refreshed = applyToken(minted, {
    access_token: 'at2',
    refresh_token: 'rt2',
    token_type: 'Bearer',
    expires_in: 28800,
  } as never);
  assert.equal(hasOwnSeed(minted), true);
  assert.equal(hasOwnSeed(refreshed), false, 'đây là ca đọc nhầm, không phải ca hỏng');
  // Nhãn thì PHẢI sống sót — nó là thứ người dùng nhìn thấy ở mọi màn hình.
  const named = applyToken({ ...minted, label: 'FPT Soft-ware' }, {
    access_token: 'at3',
    token_type: 'Bearer',
  } as never);
  assert.equal(named.label, 'FPT Soft-ware');
});
