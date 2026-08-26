/**
 * OAuth 2.1 + PKCE + đăng ký động (DCR) cho cánh tay MCP. → docs/SPEC-arms.md §5h
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠⚠ FILE NÀY KHÔNG ĐƯỢC IMPORT SDK CỦA BẤT KỲ HÃNG NÀO. Đây là ĐƯỜNG LUI. │
 * │                                                                          │
 * │ User chốt 24/08: *"nhớ chừa đường lui nếu sau này tôi cho phép người dùng│
 * │ đổi hệ thống dùng codex, antigravity, groq"*. Một câu như thế chỉ có      │
 * │ thật khi có **mã nguồn thi hành nó** — và đây là mã đó: node builtin +    │
 * │ `fetch`, không gì khác. Đổi hãng chạy agent thì file này đi theo nguyên   │
 * │ vẹn, vì OAuth là chuyện giữa agentco và **hãng dịch vụ** (Notion), không  │
 * │ phải chuyện giữa agentco và hãng **mô hình**.                            │
 * │                                                                          │
 * │ Có test canh: `test/oauth-neutral.test.ts` đọc chính file này và bắt lỗi  │
 * │ nếu một dòng `import` nào trỏ ra ngoài `node:`.                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Ba bước, **không bước nào ghim tên hãng**:
 *   ① `discover`  — gõ cửa không chìa, đọc câu server trả lời (RFC 9728 → 8414)
 *   ② `register`  — xin `client_id` tại chỗ (RFC 7591). Đo 25/08: Notion trả 201
 *   ③ `exchange`/`refresh` — đổi mã lấy chìa, và làm mới trước khi hết hạn
 *
 * ⚠ Đo được 25/08 và nó quyết định hình dạng của kho chìa: **refresh token XOAY**
 * — mỗi lần làm mới trả về **cả access lẫn refresh mới**. Không ghi đè cái mới là
 * tự khoá mình ra ngoài ở lần làm mới **thứ hai**, tức hỏng sau ~8 giờ chứ không
 * hỏng ngay. Xem `applyToken`.
 */

import crypto from 'node:crypto';

/** Tên ta tự khai với server uỷ quyền. Hiện trên màn hình đồng ý của người dùng. */
export const CLIENT_NAME = 'agentco';

/** Metadata của máy chủ uỷ quyền (RFC 8414). Chỉ giữ trường ta thật sự dùng. */
export interface AsMeta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  /**
   * ⇐ TRƯỜNG QUYẾT ĐỊNH NHÁNH ĐĂNG NHẬP. → §deviceStart
   *
   * Có nó ⇒ đi được device flow ⇒ **không cần `client_secret`, không cần
   * `redirect_uri`**. Đây là thứ cứu những hãng **không mở DCR**: ta không xin
   * được `client_id` tại chỗ, nhưng `client_id` ship sẵn cộng device flow là đủ
   * để người dùng gõ **0 chìa**. → SPEC-arms §5h·7
   */
  device_authorization_endpoint?: string;
  grant_types_supported?: string[];
}

/**
 * Một tài khoản đã đăng nhập. Đây là thứ nằm trong `.state/secrets.json`.
 *
 * ⚠ `expires_at` là **mốc tuyệt đối (ms)**, không phải `expires_in`. Cất
 * `expires_in` là cất một con số vô nghĩa ngay sau khi tắt máy — nó đo từ một
 * thời điểm không ai ghi lại.
 */
export interface OAuthAccount {
  client_id: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type: string;
  scope?: string;
  /** URL MCP mà chìa này mở được — để làm mới thì biết hỏi ai. */
  mcp_url: string;
  issuer: string;
  /** Tên người dùng đọc (Notion trả `workspace_name`). Chỉ để hiện. */
  label?: string;
  /** Server trả kèm gì thì giữ nguyên — để ĐỌC, không để TIN. */
  extra?: Record<string, unknown>;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CHÌA ĐÃ CHẾT HẲN — phải ĐĂNG NHẬP LẠI, không phải thử lại.               │
   * │                                                                          │
   * │ Ba đường tới đây, và cả ba đều KHÔNG tự khỏi:                            │
   * │  · người dùng thu hồi ở phía dịch vụ                                     │
   * │  · tiến trình chết đúng khe giữa lúc dịch vụ XOAY chìa và lúc ta ghi     │
   * │    xuống đĩa — chìa mới nằm trong một phản hồi HTTP đã mất               │
   * │  · dịch vụ hết hạn chìa làm mới                                          │
   * │                                                                          │
   * │ ⚠ VÌ SAO CẦN MỘT CỜ chứ không để nó tự lộ: không có cờ thì triệu chứng   │
   * │ duy nhất là cánh tay **401 im lặng lúc một nhân viên đang làm việc** —   │
   * │ xa nguyên nhân, và câu 401 nói *"chìa sai"* chứ không nói *"chìa chết,   │
   * │ bấm Đăng nhập"*. Đúng lớp lỗi §5m, ở tầng vòng đời.                      │
   * │                                                                          │
   * │ Có cờ thì vòng làm mới **thôi thử lại mỗi 15 phút** (vô ích, và mỗi lần  │
   * │ là một lời gọi mạng), giao diện hiện được nút Đăng nhập lại, và câu lỗi  │
   * │ lúc dùng nói đúng việc phải làm.                                         │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  dead?: { at: string; why: string };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  [k: string]: unknown;
}

// ───────────────────────────────────────────────── ① khám phá

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HỎI SERVER NÓ XÁC THỰC KIỂU GÌ — ĐỪNG ĐOÁN. RFC 9728 → RFC 8414.        │
 * │                                                                          │
 * │ Bản đầu ĐOÁN metadata nằm ở `{origin}/.well-known/…`. Đo 25/08 với 7     │
 * │ server: **đúng 5, sai 2**, và hai ca sai nói ra vì sao đoán là sai về    │
 * │ NGUYÊN TẮC chứ không phải sai vì thiếu may mắn:                          │
 * │                                                                          │
 * │   GitHub      metadata ở đường CÓ PATH, và issuer ở **host khác hẳn**    │
 * │               (`https://github.com/login/oauth`). Đoán từ origin của MCP │
 * │               URL thì không đời nào ra được chuỗi đó.                    │
 * │   Cloudflare  HTTP **200** — không cần chìa. Đoán kiểu cũ báo "404,      │
 * │               hỏng"; sự thật là "không có gì để làm".                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `null` = server **không cần chìa**. Ném = không hiểu nổi, và câu ném nói ra
 * mã HTTP thật thay vì đoán hộ.
 */
export async function discover(mcpUrl: string): Promise<AsMeta | null> {
  const probe = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CLIENT_NAME, version: '1' } },
    }),
  }).catch(() => null);

  /**
   * 🔴 BA KẾT CỤC, KHÔNG PHẢI HAI. Bản trước gộp mất một cái.
   *
   * Câu cũ `if (status !== 401 && status !== 403) return null` đọc **mọi thứ
   * không phải 401** thành "không cần chìa". Đo với `gmailmcp.googleapis.com`:
   * nó trả **404**, và hàm báo 🟢 *"cắm thẳng được"*. Báo xanh giả — chiều nguy
   * nhất, vì người dùng đi tìm nguyên nhân ở chỗ khác. Cùng hình dạng với
   * `catch` nuốt tiền đề. → [[agentco-catch-hides-premises]]
   */
  /**
   * ⚠ CHIỀU RA, không phải chiều vào. Câu lỗi phải nói ra điều đó.
   *
   * Ba lời gọi của luồng OAuth (`discover` · `register` · đổi/làm mới chìa) là
   * **daemon → dịch vụ**, không phải dịch vụ → daemon. Trên một VPS công ty
   * khoá egress hoặc bắt đi qua proxy, chúng chết ở đây — trong khi mọi thứ
   * khác (giao diện, nginx, đăng nhập SSO) vẫn chạy, nên người đi tìm sẽ soi
   * chiều VÀO và không thấy gì cả.
   *
   * ⚠ Và một chi tiết dễ mất cả buổi: `fetch` của Node **KHÔNG** tự đọc
   * `HTTPS_PROXY`. Đặt biến đó rồi tưởng xong là một cái bẫy có thật.
   */
  if (!probe) {
    throw new Error(
      `Không gọi ra được tới ${mcpUrl}.\n` +
        `Đây là kết nối ĐI RA từ máy chạy agentco, không phải kết nối vào — nên tường lửa vào, ` +
        `nginx hay VPN đều không phải chỗ cần sửa.\n` +
        `Kiểm: máy này có ra internet không · công ty có bắt đi qua proxy không ` +
        `(Node không tự đọc HTTPS_PROXY, phải bật NODE_USE_ENV_PROXY=1).`,
    );
  }
  if (probe.ok) return null;
  if (probe.status !== 401 && probe.status !== 403) {
    throw new Error(
      `${mcpUrl} trả HTTP ${probe.status} — không phải cửa MCP, cũng không phải đòi chìa. ` +
        `Nhiều khả năng sai URL.`,
    );
  }

  const u = new URL(mcpUrl);
  // Server TỰ KHAI chỗ để metadata. Đây là thứ thay cho việc ta đoán.
  const declared = probe.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1];

  let issuer: string | null = null;
  for (const url of [
    declared,
    // RFC 9728: path của tài nguyên được CHÈN VÀO SAU well-known, không bỏ đi.
    `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`,
    `${u.origin}/.well-known/oauth-protected-resource`,
  ].filter(Boolean) as string[]) {
    const r = await fetch(url).catch(() => null);
    if (!r?.ok) continue;
    const j = (await r.json().catch(() => null)) as { authorization_servers?: string[] } | null;
    if (j?.authorization_servers?.[0]) {
      issuer = j.authorization_servers[0];
      break;
    }
  }
  if (!issuer) issuer = u.origin;

  // Issuer CÓ THỂ mang path (GitHub có), nên thử cả dạng chèn-path lẫn dạng gốc,
  // cộng đường OIDC. Bốn đường, không đường nào biết đó là hãng nào.
  const iss = new URL(issuer);
  const p = iss.pathname.replace(/\/$/, '');
  const tries = [
    `${iss.origin}/.well-known/oauth-authorization-server${p}`,
    `${iss.origin}${p}/.well-known/oauth-authorization-server`,
    `${iss.origin}/.well-known/openid-configuration${p}`,
    `${iss.origin}${p}/.well-known/openid-configuration`,
  ];
  for (const url of tries) {
    const r = await fetch(url).catch(() => null);
    if (r?.ok) return (await r.json()) as AsMeta;
  }
  throw new Error(`Không đọc được metadata uỷ quyền của ${issuer} (đã thử ${tries.length} đường).`);
}

// ───────────────────────────────────────────────── ② đăng ký động

/**
 * Xin `client_id` tại chỗ (RFC 7591) — không đăng ký tay, không allowlist.
 *
 * 🟢 ĐO 25/08: Notion trả **201**, `token_endpoint_auth_method: "none"`. Câu hỏi
 * *"Notion có rào app custom không?"* đã có đáp: **KHÔNG RÀO** — ta được đối xử
 * như mọi client khác. Linear · Sentry · Asana · Atlassian cũng mở DCR.
 * GitHub thì **không** có `registration_endpoint` ⇒ phải xin `client_id` tay.
 *
 * ⚠ `none` = **public client**: không có `client_secret` để giấu, nên PKCE không
 * phải tuỳ chọn — nó là thứ duy nhất chặn kẻ chen vào giữa mã trao đổi.
 */
export async function register(meta: AsMeta, redirectUri: string): Promise<string> {
  if (!meta.registration_endpoint) {
    throw new Error(
      `${meta.issuer} không mở đăng ký động — dịch vụ này bắt phải tự tạo app và dán client_id vào.`,
    );
  }
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    }),
  });
  const body = await res.text();
  if (res.status !== 200 && res.status !== 201) throw new Error(`Đăng ký hỏng: HTTP ${res.status} — ${body}`);
  const j = JSON.parse(body) as { client_id: string; client_secret?: string };
  if (j.client_secret) {
    // Không giết luồng, nhưng phải KÊU: nó đổi mô hình bảo mật và đổi cả kho chìa.
    process.emitWarning(
      `${meta.issuer} cấp client_secret — mô hình public client không còn đúng cho dịch vụ này.`,
    );
  }
  return j.client_id;
}

// ───────────────────────────────────────────────── ③ PKCE + đổi chìa

const b64url = (b: Buffer): string => b.toString('base64url');

/** S256. `plain` cố ý không có đường nào chọn được — nó không chặn được gì cả. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

export function randomState(): string {
  return b64url(crypto.randomBytes(16));
}

/** URL để mở trên trình duyệt người dùng. */
export function authorizeUrl(
  meta: AsMeta,
  p: { clientId: string; redirectUri: string; state: string; challenge: string; scope?: string },
): string {
  const u = new URL(meta.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    ...(p.scope ? { scope: p.scope } : {}),
  }).toString();
  return u.toString();
}

/**
 * Chìa đã CHẾT HẲN, hay chỉ tạm hỏng? Hai ca cần hai xử lý ngược nhau.
 *
 * `invalid_grant` là câu chuẩn của OAuth 2 cho *"chìa này không còn dùng được"*
 * — thu hồi, hết hạn, hoặc đã bị xoay mất. Thử lại **không bao giờ** khỏi.
 * Mọi thứ khác (mạng chết, 500, quá hạn) thì thử lại là đúng.
 *
 * ⚠ Đọc cả `error` trong thân JSON lẫn mã HTTP: RFC 6749 quy định `invalid_grant`
 * đi kèm **400**, nhưng có dịch vụ trả 401. Chỉ nhìn mã số là đọc sót ở một nửa.
 */
export class DeadGrantError extends Error {}

/**
 * Hỏng TẠM — mạng chết, DNS, proxy, 5xx. Thử lại là đúng.
 *
 * Tách khỏi mọi lỗi khác vì hai loại này cần **hai xử lý ngược nhau**: tạm thì
 * im lặng thử lại, chết hẳn thì dừng và bảo người dùng đăng nhập lại. Gộp chúng
 * là chọn sai ở cả hai (`oauth-routes.ts §refreshDue` đã ghi luật này).
 */
export class TransientError extends Error {}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴🔴 BA TIỀN ĐỀ SAI ĐÃ SỐNG TRONG HÀM NÀY — đo 26/08 khi cắm GitHub.     │
 * │                                                                          │
 * │ Cả ba đều ĐÚNG với Notion, nên chúng vô hình suốt từ 25/08. Đây là lý do │
 * │ luật *"một hãng chạy được chứng minh CƠ CHẾ, không chứng minh HÌNH DẠNG   │
 * │ PHẢN HỒI"* được viết ra. → SPEC-arms §5h·7d                              │
 * │                                                                          │
 * │ ① *"server trả JSON"* — GitHub trả **form-urlencoded** trừ khi ta gửi     │
 * │    `Accept: application/json`. Hàm cũ không gửi ⇒ `JSON.parse` ném ngay   │
 * │    ở lần đổi mã ĐẦU TIÊN.                                                │
 * │                                                                          │
 * │ ② *"hỏng thì `!res.ok`"* — GitHub trả **HTTP 200** kèm thân               │
 * │    `{"error":"…"}`. Hàm cũ đọc thành THÀNH CÔNG ⇒ `applyToken` dựng một   │
 * │    account có `access_token: undefined` ⇒ `saveOAuth` **ghi đè một tài    │
 * │    khoản đang chạy tốt bằng một tài khoản hỏng**. Không ném, không log,   │
 * │    và nó xảy ra trong **vòng làm mới chạy ngầm** — nơi không ai nhìn.     │
 * │    ⇒ ② tệ hơn ① dù ① nghe to hơn: ① nổ ngay và có stack trace.           │
 * │                                                                          │
 * │ ③ *"chìa chết = `invalid_grant`"* — GitHub trả                            │
 * │    **`incorrect_client_credentials`**. Không khớp ⇒ xếp thành *hỏng tạm*  │
 * │    ⇒ cờ `dead` KHÔNG BAO GIỜ bật ⇒ vòng làm mới thử lại mỗi 15 phút vĩnh  │
 * │    viễn, và giao diện không bao giờ hiện nút *Đăng nhập lại*. Tức cơ chế  │
 * │    `dead` bị vô hiệu đúng ở hãng cần nó nhất.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ `step` đi vào mọi câu lỗi: `[đổi mã]` · `[làm mới]` · `[hỏi thăm]`. Ba chỗ
 * đó sửa bằng ba việc khác nhau, mà một câu `fetch failed` trần thì không nói
 * được là chỗ nào — đúng lớp lỗi §5m *"chỉ sai cửa"*.
 */
async function postToken(
  meta: AsMeta,
  form: Record<string, string>,
  step = 'đổi chìa',
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(meta.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // ① Thiếu dòng này thì GitHub trả form-urlencoded và `JSON.parse` ném.
        accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
    });
  } catch (e) {
    throw new TransientError(`[${step}] không gọi ra được ${meta.token_endpoint}: ${(e as Error).message}`);
  }

  const body = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    /* thân không phải JSON — dưới đây rơi về mã HTTP, và đó là ca đáng kêu */
  }

  // ② PHÂN LOẠI THEO THÂN TRƯỚC, `res.ok` chỉ là tín hiệu phụ.
  const code = typeof json?.['error'] === 'string' ? (json['error'] as string) : '';
  const desc = typeof json?.['error_description'] === 'string' ? (json['error_description'] as string) : '';

  if (code) {
    /**
     * ③ Danh sách chìa-đã-chết. `incorrect_client_credentials` là câu của
     * GitHub cho *"refresh token này đã bị xoay/thu hồi"* — và nó **sai cửa
     * ngay từ phía hãng**: chữ nghĩa nói về `client_id`/`client_secret`, thứ
     * hoàn toàn không sai. ⇒ Ta **dịch lại**, không chuyển tiếp nguyên văn.
     */
    if (
      code === 'invalid_grant' ||
      code === 'invalid_client' ||
      code === 'incorrect_client_credentials' ||
      code === 'bad_refresh_token' ||
      code === 'unauthorized_client'
    ) {
      throw new DeadGrantError(`Chìa không còn hiệu lực — cần đăng nhập lại. (${code})`);
    }
    // 5xx kèm mã lỗi vẫn là hỏng tạm: server đang trục trặc, không phải chìa chết.
    if (res.status >= 500) throw new TransientError(`[${step}] dịch vụ đang lỗi (${code}).`);
    throw new Error(`[${step}] hỏng: ${code}${desc ? ` — ${desc}` : ''}`);
  }

  if (res.status >= 500) throw new TransientError(`[${step}] dịch vụ trả HTTP ${res.status}.`);
  if (!json) throw new Error(`[${step}] phản hồi không đọc được (HTTP ${res.status}): ${body.slice(0, 200)}`);

  /**
   * ⚠ THIẾU `access_token` TRONG MỘT PHẢN HỒI 200 CŨNG LÀ HỎNG.
   *
   * Không có dòng này thì ca ② quay lại qua cửa khác: một thân JSON hợp lệ,
   * không có trường `error`, cũng không có chìa — và hạ nguồn sẽ cất một tài
   * khoản rỗng đè lên tài khoản đang dùng. Bất biến phải nằm ở ĐÂY, chỗ duy
   * nhất mọi đường đổi chìa đi qua.
   */
  if (typeof json['access_token'] !== 'string' || !json['access_token']) {
    throw new Error(`[${step}] phản hồi không có access_token (HTTP ${res.status}).`);
  }
  return json as unknown as TokenResponse;
}

/**
 * Gộp phản hồi token vào một tài khoản. Dùng cho **cả** lần đầu lẫn lần làm mới.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `refresh_token ?? cũ` — DẤU `??` NÀY LÀ CẢ MỘT LỚP LỖI.               │
 * │                                                                          │
 * │ Đo 25/08: Notion **XOAY** refresh token — mỗi lần làm mới trả về cả       │
 * │ access LẪN refresh mới, và cái cũ chết ngay. Nên:                        │
 * │   · không ghi đè cái mới ⇒ tự khoá mình ra ngoài ở lần làm mới **THỨ     │
 * │     HAI**, tức hỏng sau ~8 giờ, không hỏng ngay ⇒ không ai nối được       │
 * │     nguyên nhân với triệu chứng                                          │
 * │   · nhưng server KHÁC có thể **không** trả refresh mới ⇒ ghi đè bằng      │
 * │     `undefined` là vứt mất cái đang dùng được                            │
 * │ ⇒ Chỉ thay khi server **có gửi**. Một dấu `??`, hai chiều hỏng.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function applyToken(prev: Partial<OAuthAccount>, t: TokenResponse): OAuthAccount {
  const { access_token, refresh_token, expires_in, token_type, scope, ...extra } = t;
  return {
    client_id: prev.client_id ?? '',
    mcp_url: prev.mcp_url ?? '',
    issuer: prev.issuer ?? '',
    access_token,
    refresh_token: refresh_token ?? prev.refresh_token,
    expires_at: expires_in ? Date.now() + expires_in * 1000 : undefined,
    token_type: token_type ?? prev.token_type ?? 'Bearer',
    scope: scope ?? prev.scope,
    ...(prev.label ? { label: prev.label } : {}),
    ...(Object.keys(extra).length ? { extra } : {}),
  };
}

export async function exchangeCode(
  meta: AsMeta,
  p: { clientId: string; code: string; redirectUri: string; verifier: string; mcpUrl: string },
): Promise<OAuthAccount> {
  const t = await postToken(meta, {
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: p.clientId,
    code_verifier: p.verifier,
  });
  const acc = applyToken({ client_id: p.clientId, mcp_url: p.mcpUrl, issuer: meta.issuer }, t);
  // Tên workspace do server trả — dùng làm nhãn cánh tay. `String()` vì đây là
  // dữ liệu của bên thứ ba: nó có thể là số, null, hoặc không có.
  const name = acc.extra?.['workspace_name'];
  if (typeof name === 'string' && name.trim()) acc.label = name.trim();
  return acc;
}

export async function refreshAccount(meta: AsMeta, acc: OAuthAccount): Promise<OAuthAccount> {
  if (!acc.refresh_token) throw new Error('Tài khoản này không có chìa làm mới — phải đăng nhập lại.');
  const t = await postToken(
    meta,
    {
      grant_type: 'refresh_token',
      refresh_token: acc.refresh_token,
      client_id: acc.client_id,
    },
    'làm mới',
  );
  return applyToken(acc, t);
}

// ───────────────────────────────────────────────── ④ device flow (RFC 8628)

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐƯỜNG THỨ HAI ĐỂ ĐĂNG NHẬP — cho hãng KHÔNG mở DCR. → SPEC-arms §5h·7    │
 * │                                                                          │
 * │ Vì sao không dùng lại được luồng của Notion: 🌐 web flow của GitHub bắt   │
 * │ buộc `client_secret` — **PKCE là thứ THÊM VÀO, không phải thứ THAY CHO**. │
 * │ Một public client đi đường đó chết ở bước đổi mã, bằng một câu 401 nói    │
 * │ *"chìa sai"*.                                                            │
 * │                                                                          │
 * │ Device flow đổi lại **bỏ được nhiều hơn nó thêm**:                       │
 * │   · 0 `client_secret` — kể cả lúc LÀM MỚI (🌐 *"Required unless the user  │
 * │     access token was generated using the device flow"*)                  │
 * │   · **0 `redirect_uri`** ⇒ toàn bộ §5h·6 (`redirectBase` · `public_url` · │
 * │     nginx · Docker · VPS) KHÔNG áp dụng cho cánh tay đi đường này         │
 * │   · 0 `state`, 0 `code_verifier`, 0 map `pending` — không có mã uỷ quyền  │
 * │     nào bay về đâu cả                                                    │
 * │                                                                          │
 * │ Cái giá: người dùng phải **gõ một mã** trên trang của hãng. Một bước tay  │
 * │ đổi lấy việc xoá cả một lớp triển khai.                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function supportsDevice(meta: AsMeta): boolean {
  // Đọc từ metadata, KHÔNG dò tên hãng. Đây là điều kiện để mục danh mục vẫn là
  // DỮ LIỆU (§5h·1): thêm một hãng không-DCR về sau = thêm một object.
  return Boolean(meta.device_authorization_endpoint);
}

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  /** Một số hãng trả kèm URL đã nhúng sẵn mã — dùng được thì đỡ cho người dùng một bước gõ. */
  verification_uri_complete?: string;
  expires_at: number;
  interval_ms: number;
}

/** Xin một mã thiết bị. `client_id` đến từ **dữ liệu danh mục**, không từ handshake. */
export async function deviceStart(
  meta: AsMeta,
  clientId: string,
  scope?: string,
): Promise<DeviceStart> {
  const url = meta.device_authorization_endpoint;
  if (!url) throw new Error(`${meta.issuer} không hỗ trợ đăng nhập bằng mã thiết bị.`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: clientId, ...(scope ? { scope } : {}) }).toString(),
    });
  } catch (e) {
    throw new TransientError(`[xin mã] không gọi ra được ${new URL(url).host}: ${(e as Error).message}`);
  }

  const body = await res.text();
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error(`[xin mã] phản hồi không đọc được (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  if (typeof j['device_code'] !== 'string') {
    /**
     * ⚠ CA THƯỜNG GẶP NHẤT, và câu lỗi phải nói thẳng ra nó: GitHub trả **400**
     * cho app **chưa tick "Enable Device Flow"**. Không nói ra thì người triển
     * khai đi kiểm `client_id`, kiểm mạng, kiểm URL — mọi chỗ trừ chỗ hỏng.
     */
    throw new Error(
      `[xin mã] hỏng (HTTP ${res.status}): ${String(j['error'] ?? body.slice(0, 120))}\n` +
        `Kiểm trước tiên: ứng dụng đã bật "đăng nhập bằng mã thiết bị" ở phía dịch vụ chưa.`,
    );
  }

  const expiresIn = typeof j['expires_in'] === 'number' ? j['expires_in'] : 900;
  const interval = typeof j['interval'] === 'number' ? j['interval'] : 5;
  return {
    device_code: j['device_code'],
    user_code: String(j['user_code'] ?? ''),
    verification_uri: String(j['verification_uri'] ?? ''),
    ...(typeof j['verification_uri_complete'] === 'string'
      ? { verification_uri_complete: j['verification_uri_complete'] }
      : {}),
    expires_at: Date.now() + expiresIn * 1000,
    interval_ms: interval * 1000,
    };
}

/** Kết quả một nhịp hỏi thăm. `pending` là trạng thái BÌNH THƯỜNG, không phải lỗi. */
export type DevicePoll =
  | { state: 'pending'; interval_ms: number }
  | { state: 'done'; account: OAuthAccount };

/**
 * Một nhịp hỏi thăm. **Không tự lặp** — vòng lặp thuộc về người gọi.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Vì sao tách nhịp ra khỏi vòng: người gọi là daemon, và nó phải trả lời    │
 * │ giao diện *"đang chờ, còn 12 phút"* trong lúc chờ. Một hàm tự lặp thì chỉ │
 * │ trả về được ở phút cuối, và mọi trạng thái ở giữa **biến mất**.           │
 * │                                                                          │
 * │ 🔴 VÀ RỚT MẠNG KHÔNG ĐƯỢC GIẾT LƯỢT ĐĂNG NHẬP (ca thật 26/08): lượt đo   │
 * │ đầu chết sau ~95 giây vì một cú nấc mạng — trong khi người dùng vừa bấm   │
 * │ Đồng ý xong. GitHub báo *"đã cấp quyền"*, ta báo *hỏng*: hai màn hình nói │
 * │ ngược nhau, và màn hình sai là của ta. ⇒ `TransientError` trả về          │
 * │ `pending`, không ném. Mốc dừng là **hạn của chính cái mã**, không phải số │
 * │ lần thử ⇒ không có vòng lặp vô hạn. → SPEC-arms §5h·7g                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export async function devicePoll(
  meta: AsMeta,
  p: { clientId: string; start: DeviceStart; mcpUrl: string },
): Promise<DevicePoll> {
  if (Date.now() > p.start.expires_at) {
    throw new Error('Mã đăng nhập đã hết hạn — bấm Đăng nhập lại để lấy mã mới.');
  }
  try {
    const t = await postToken(
      meta,
      {
        client_id: p.clientId,
        device_code: p.start.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
      'hỏi thăm',
    );
    return { state: 'done', account: applyToken({ client_id: p.clientId, mcp_url: p.mcpUrl, issuer: meta.issuer }, t) };
  } catch (e) {
    if (e instanceof TransientError) return { state: 'pending', interval_ms: p.start.interval_ms };
    const msg = (e as Error).message;
    /**
     * BA CA "CHƯA XONG" CỦA RFC 8628, và chúng KHÔNG phải lỗi:
     *   authorization_pending  người dùng chưa bấm — chờ tiếp
     *   slow_down              ta hỏi quá nhanh — **cộng 5 giây**, không phải thử ngay
     *   expired_token          hết hạn thật — ca này mới là lỗi
     * ⚠ `postToken` đã dịch mã lỗi thành câu người đọc, nên khớp theo chuỗi mã
     * gốc mà nó nhúng vào. Giữ mã gốc trong câu là điều kiện để đoạn này chạy.
     */
    if (msg.includes('authorization_pending')) return { state: 'pending', interval_ms: p.start.interval_ms };
    if (msg.includes('slow_down')) return { state: 'pending', interval_ms: p.start.interval_ms + 5000 };
    if (msg.includes('access_denied')) throw new Error('Bạn đã từ chối cấp quyền ở trang của dịch vụ.');
    throw e;
  }
}

/**
 * TÊN CHÌA của một tài khoản — máy sinh, tất định, và **`[A-Z0-9_]+`**.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Vì sao tên phải mang DANH TÍNH TÀI KHOẢN chứ không phải chỉ tên hãng:    │
 * │                                                                          │
 * │ Tên chìa đi vào `secretNames` ⇒ đi vào **`armHash`**. Hai workspace       │
 * │ Notion có **cùng URL** `https://mcp.notion.com/mcp` — nếu cả hai cùng    │
 * │ dùng tên `NOTION_TOKEN` thì chúng ra **cùng một băm**, tức hai không gian│
 * │ làm việc khác nhau bị gộp thành một cánh tay. §6i đã cảnh báo đúng ca     │
 * │ này từ 23/08, và đây là chỗ nó được giải.                                 │
 * │                                                                          │
 * │ Khoá định danh là `workspace_id` (Notion trả kèm token). Không có thì rơi │
 * │ về `issuer + mcp_url` — vẫn tất định, chỉ là một tài khoản mỗi server.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Băm rồi mới cắt, KHÔNG lấy thẳng `workspace_id`: id thật chứa dấu `-` và
 * chữ thường, mà `PLACEHOLDER` chỉ nhận `[A-Z0-9_]`. Lấy thẳng thì ô trống
 * `${...}` **không khớp** và chìa lặng lẽ không được tiêm — đúng ca §5m.
 */
/**
 * Tên này có phải một TÀI KHOẢN ĐĂNG NHẬP không (thay vì một chìa gõ tay)?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Vì sao cần: câu lỗi *"Thiếu chìa: NOTION_OAUTH_AFAFBCD6"* bảo người dùng │
 * │ đi điền một thứ **không tồn tại** — Notion không có chìa nào để gõ, và    │
 * │ user nói thẳng 26/08: *"bản thân human đọc sẽ rất là khó hiểu"*.          │
 * │                                                                          │
 * │ Đặt CẠNH `accountName` chứ không ở nơi hiển thị: đây là hàm mint ra cái   │
 * │ tên, nên nó là chỗ duy nhất biết hình dạng của tên. Để phép nhận dạng ở   │
 * │ một file khác là dựng bản thứ hai của một quy ước — và bản thứ hai sẽ     │
 * │ lệch vào đúng ngày ai đó đổi tiền tố.                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function isAccountName(name: string): boolean {
  return /_OAUTH_[0-9A-F]{8}$/.test(name);
}

/**
 * ⚠⚠ `seed` LÀ THỨ CỨU NHỮNG HÃNG KHÔNG TRẢ DANH TÍNH — đo 26/08 với GitHub.
 *
 * Notion trả kèm `workspace_id` ngay trong phản hồi token. **GitHub trả rỗng**:
 * không tên, không id, `scope` cũng rỗng. Không có `seed` thì mọi tài khoản
 * GitHub rơi về nhánh dự phòng `issuer|mcp_url` — một chuỗi **giống hệt nhau
 * cho mọi người** ⇒ cùng tên chìa ⇒ **cùng băm** ⇒ hai tài khoản khác nhau bị
 * gộp thành MỘT cánh tay. Đúng ca §6i, và nó **không có triệu chứng nhìn thấy
 * được** cho tới khi người thứ hai đăng nhập.
 *
 * ⇒ Với hãng như thế, người gọi đi hỏi danh tính (`get_me`) rồi truyền `id` vào
 * đây. → `catalog.ts §CatalogArm.identity` · SPEC-arms §5h·7k
 */
export function accountName(
  prefix: string,
  acc: Pick<OAuthAccount, 'issuer' | 'mcp_url' | 'extra'>,
  seedOverride?: string,
): string {
  const ws = acc.extra?.['workspace_id'];
  const seed = seedOverride || (typeof ws === 'string' && ws ? ws : `${acc.issuer}|${acc.mcp_url}`);
  const id = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8).toUpperCase();
  return `${prefix.toUpperCase().replace(/[^A-Z0-9]/g, '')}_OAUTH_${id}`;
}

/**
 * Sắp hết hạn chưa? Làm mới ở **50% tuổi thọ**, không phải lúc còn 1 phút.
 *
 * Chìa Notion sống 8 giờ ⇒ mốc là 4 giờ. Vì sao rộng thế: một task chạy dài có
 * thể bắt đầu lúc chìa còn 3 phút và kết thúc sau khi nó chết — làm mới sát nút
 * chỉ dời chỗ hỏng chứ không xoá nó. Và làm mới sớm **không tốn gì**: chìa cũ
 * vẫn còn hạn lúc ta xin cái mới.
 *
 * Không có `expires_at` ⇒ **false**: chìa không khai hạn thì ta không có cơ sở
 * nào để nói nó sắp chết, và làm mới bừa là vứt một chìa đang chạy tốt.
 */
export function needsRefresh(acc: OAuthAccount, now = Date.now(), lifetimeFraction = 0.5): boolean {
  // Đã chết hẳn ⇒ thôi thử. Mỗi 15 phút một lời gọi mạng chắc chắn hỏng là đốt
  // pin, đốt log, và che mất những lần hỏng THẬT đáng đọc. → `OAuthAccount.dead`
  if (acc.dead) return false;
  if (!acc.expires_at) return false;
  if (!acc.refresh_token) return false;
  const left = acc.expires_at - now;
  if (left <= 0) return true;
  // Không biết tuổi thọ gốc, nên suy từ chính khoảng còn lại so với một mốc hợp
  // lý: hết hạn trong vòng `fraction` của 8 giờ là sắp hết. Server nào cấp chìa
  // ngắn hơn thì mốc này rộng hơn tỉ lệ — vẫn đúng chiều, chỉ làm mới sớm hơn.
  return left < 8 * 3600_000 * lifetimeFraction;
}
