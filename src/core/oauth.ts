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
  if (!probe) throw new Error(`Không nối được tới ${mcpUrl} — kiểm mạng hoặc URL.`);
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

async function postToken(meta: AsMeta, form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Đổi chìa hỏng: HTTP ${res.status} — ${body}`);
  return JSON.parse(body) as TokenResponse;
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
  const t = await postToken(meta, {
    grant_type: 'refresh_token',
    refresh_token: acc.refresh_token,
    client_id: acc.client_id,
  });
  return applyToken(acc, t);
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
  if (!acc.expires_at) return false;
  if (!acc.refresh_token) return false;
  const left = acc.expires_at - now;
  if (left <= 0) return true;
  // Không biết tuổi thọ gốc, nên suy từ chính khoảng còn lại so với một mốc hợp
  // lý: hết hạn trong vòng `fraction` của 8 giờ là sắp hết. Server nào cấp chìa
  // ngắn hơn thì mốc này rộng hơn tỉ lệ — vẫn đúng chiều, chỉ làm mới sớm hơn.
  return left < 8 * 3600_000 * lifetimeFraction;
}
