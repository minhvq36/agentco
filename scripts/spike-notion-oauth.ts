/**
 * SPIKE — ĐƯỜNG B: ta tự cầm OAuth của Notion, không nhờ CLI của ai.
 * → SPEC-arms.md §5h (ba loại chìa) · §5a (tiêm `headers`) · §4e #2
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ FILE NÀY KHÔNG IMPORT `@anthropic-ai/claude-agent-sdk`. CỐ Ý.            │
 * │                                                                          │
 * │ User chốt 24/08: phải chừa đường lui cho Codex · Antigravity · Groq.     │
 * │ Cách duy nhất để LỜI HỨA ĐÓ CÓ THẬT là chứng minh bằng mã chạy được:     │
 * │ toàn bộ luồng dưới đây dùng **node builtins + fetch**, và kết thúc bằng   │
 * │ một chuỗi `Authorization: Bearer …`. Ai tiêu chuỗi đó cũng được.         │
 * │                                                                          │
 * │ ⇒ Nếu một ngày file này phải `import` SDK của một hãng nào, thì lời hứa   │
 * │ "đổi được provider" vừa gãy — và gãy ở đúng dòng import đó.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Nguồn sự thật là TÀI LIỆU NOTION, không phải tài liệu Claude (user chốt):
 *   🌐 developers.notion.com/guides/mcp/get-started-with-mcp
 *   🌐 notion.com/help/notion-mcp
 *
 * Bốn câu hỏi spike này đóng — mỗi câu đều đã có thể GIẾT đường B:
 *
 *   Q1  Notion có rào app lạ không?          đo 24/08: KHÔNG — /register trả 201
 *   Q2  Refresh token có về không?           ← phải đo, quyết được kiến trúc §4
 *   Q3  Bao nhiêu việc, và schema nặng cỡ nào?
 *   Q4  Nhiều tài khoản Notion cùng lúc được không?
 *
 * ⚠ Notion ghi thẳng: *"We're working on support for non-interactive
 * authorization"* ⇒ HÔM NAY OAuth **bắt buộc có trình duyệt**. Không có đường
 * headless. Đó là ràng buộc thiết kế, không phải thiếu sót của spike.
 *
 * Chạy:
 *   npx tsx scripts/spike-notion-oauth.ts              đăng nhập tài khoản mới
 *   npx tsx scripts/spike-notion-oauth.ts --as cty-b   đăng nhập tài khoản THỨ HAI (Q4)
 *   npx tsx scripts/spike-notion-oauth.ts --refresh    chỉ thử làm mới chìa (Q2)
 *   npx tsx scripts/spike-notion-oauth.ts --tools      chỉ gọi tools/list (Q3)
 *   npx tsx scripts/spike-notion-oauth.ts --revoke     thu hồi rồi chứng minh đã chết
 *   npx tsx scripts/spike-notion-oauth.ts --no-browser in URL ra, tự dán
 *
 * Chi phí: **$0** — không gọi model một lần nào.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * ⚠ `/mcp` (Streamable HTTP), KHÔNG phải `/sse`. Notion còn phục vụ `/sse` cho
 * client cũ, nhưng `SPEC-arms` §2 đã chốt: SSE **nhận vào** để tương thích,
 * **không bao giờ đề xuất**. Spike đo đúng thứ ta sẽ ship.
 */
const MCP_URL = 'https://mcp.notion.com/mcp';

/**
 * Kho chìa của SPIKE — KHÔNG phải kho thật.
 *
 * Kho thật là `company/.state/secrets.json`, và §4 dưới đây ghi vì sao hình
 * dạng của nó **phải đổi** trước khi nhận được token OAuth. Spike cố tình ghi
 * ra chỗ khác để một lần chạy thử không đụng vào chìa đang dùng thật.
 */
const STORE = path.join(HERE, '..', '.state-spike', 'notion-oauth.json');

/** Chuỗi này lên màn hình đồng ý của Notion — người dùng sẽ ĐỌC nó. */
const CLIENT_NAME = 'agentco';

// ─────────────────────────────────────────────────────────────────────────────
// KHO CHÌA — khoá theo TÀI KHOẢN, không phải một chỗ phẳng (Q4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Một tài khoản Notion đã đăng nhập.
 *
 * ⚠ `client_id` nằm TRONG từng tài khoản, không nằm ngoài — và đó không phải
 * tuỳ tiện: DCR gắn `client_id` với **đúng một `redirect_uri`**. Cổng loopback
 * đổi theo lần chạy ⇒ mỗi lần đăng nhập là một đăng ký mới. Để `client_id`
 * dùng chung là đẻ ra `invalid_redirect_uri` ở lần đăng nhập thứ hai.
 */
interface Account {
  client_id: string;
  access_token: string;
  refresh_token?: string;
  /** Mốc HẾT HẠN tuyệt đối (ms). Cất `expires_in` là cất một số vô nghĩa sau khi tắt máy. */
  expires_at?: number;
  token_type: string;
  scope?: string;
  /** Notion trả kèm gì thì giữ nguyên — để đọc, không để tin. */
  extra?: Record<string, unknown>;
}

type Store = { accounts: Record<string, Account> };

function readStore(): Store {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8')) as Store;
  } catch {
    return { accounts: {} };
  }
}

function writeStore(s: Store): void {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
  try {
    fs.chmodSync(STORE, 0o600);
  } catch {
    /* Windows: chmod là no-op, ACL thư mục người dùng đã đủ */
  }
}

/** Che chìa trước khi in. Không có hàm này thì spike tự đẻ ra ca ㉔ của chính nó. */
const mask = (v?: string) => (v ? `${v.slice(0, 8)}…${v.slice(-4)} (${v.length} ký tự)` : '—');

// ─────────────────────────────────────────────────────────────────────────────
// ① KHÁM PHÁ — hỏi server nó xác thực kiểu gì, đừng ghim vào code
// ─────────────────────────────────────────────────────────────────────────────

interface AsMeta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HỎI SERVER NÓ XÁC THỰC KIỂU GÌ — ĐỪNG ĐOÁN. RFC 9728 → RFC 8414.        │
 * │                                                                          │
 * │ 🔴 Bản đầu (24/08) ĐOÁN metadata nằm ở `{origin}/.well-known/…`. Đo      │
 * │ 25/08 với 7 server: **đúng 5, sai 2**, và hai ca sai nói ra vì sao đoán  │
 * │ là sai về nguyên tắc chứ không phải sai vì thiếu may mắn:                │
 * │                                                                          │
 * │   GitHub      metadata nằm ở đường CÓ PATH (`…/oauth-protected-resource/ │
 * │               mcp/`), và issuer ở **HOST KHÁC HẲN**:                     │
 * │               `https://github.com/login/oauth`. Đoán từ origin của MCP   │
 * │               URL thì **không đời nào** ra được chuỗi đó.                │
 * │   Cloudflare  HTTP **200** — server công khai, **không cần chìa**. Đoán  │
 * │               kiểu cũ báo "404, hỏng"; sự thật là "không có gì để làm".  │
 * │                                                                          │
 * │ ⇒ Ba kết cục, và cả ba đều KHÁM PHÁ ĐƯỢC, không cái nào cần biết trước  │
 * │ đó là hãng nào:  ① 200 ⇒ không cần chìa   ② 401 ⇒ đi theo               │
 * │ `WWW-Authenticate: … resource_metadata="…"`   ③ không hiểu ⇒ nói thẳng. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
async function discover(mcpUrl: string): Promise<AsMeta | null> {
  // ① Gõ cửa KHÔNG chìa. Câu trả lời của server chính là tài liệu.
  const probe = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: CLIENT_NAME, version: '0.0.1' },
      },
    }),
  }).catch(() => null);

  /**
   * ┌──────────────────────────────────────────────────────────────────────┐
   * │ 🔴 BA KẾT CỤC, KHÔNG PHẢI HAI. Bản trước gộp mất một cái. (vá 25/08) │
   * │                                                                      │
   * │ Câu cũ: `if (status !== 401 && status !== 403) return null` — tức     │
   * │ **mọi thứ không phải 401 đều là "không cần chìa"**. Đo với            │
   * │ `gmailmcp.googleapis.com/mcp`: nó trả **404** (endpoint không tồn     │
   * │ tại ở đường đó), và hàm này báo 🟢 *"cắm thẳng được"*.                │
   * │                                                                      │
   * │ Đó là **báo xanh giả**, chiều nguy nhất: người dùng cắm một thứ chết  │
   * │ rồi đi tìm nguyên nhân ở chỗ khác. Cùng hình dạng với `catch` nuốt    │
   * │ tiền đề — "không phải lỗi tôi ngờ" bị đọc thành "không có lỗi".       │
   * │ → [[agentco-catch-hides-premises]]                                    │
   * └──────────────────────────────────────────────────────────────────────┘
   */
  if (!probe) throw new Error(`Không nối được tới ${mcpUrl} — kiểm mạng hoặc URL.`);
  if (probe.ok) return null; // 2xx và CHỈ 2xx mới là "không cần chìa"
  if (probe.status !== 401 && probe.status !== 403) {
    throw new Error(
      `${mcpUrl} trả HTTP ${probe.status} — không phải cửa MCP, cũng không phải đòi chìa. ` +
        `Nhiều khả năng sai URL.`,
    );
  }

  // ② Server tự khai chỗ để metadata. Đây là chỗ thay cho việc ta đoán.
  const u = new URL(mcpUrl);
  const declared = probe?.headers
    .get('www-authenticate')
    ?.match(/resource_metadata="([^"]+)"/)?.[1];

  const prmTries = [
    declared,
    // RFC 9728: path của tài nguyên được CHÈN VÀO SAU well-known, không bỏ đi.
    `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`,
    `${u.origin}/.well-known/oauth-protected-resource`,
  ].filter(Boolean) as string[];

  let issuer: string | null = null;
  for (const url of prmTries) {
    const r = await fetch(url).catch(() => null);
    if (!r?.ok) continue;
    const j = (await r.json()) as { authorization_servers?: string[] };
    if (j.authorization_servers?.[0]) {
      issuer = j.authorization_servers[0];
      break;
    }
  }
  if (!issuer) issuer = u.origin;

  // ③ Metadata của máy chủ uỷ quyền. Issuer CÓ THỂ có path (GitHub có), nên
  //    phải thử cả dạng chèn-path lẫn dạng gốc, cộng đường OIDC.
  const iss = new URL(issuer);
  const p = iss.pathname.replace(/\/$/, '');
  const asTries = [
    `${iss.origin}/.well-known/oauth-authorization-server${p}`,
    `${iss.origin}${p}/.well-known/oauth-authorization-server`,
    `${iss.origin}/.well-known/openid-configuration${p}`,
    `${iss.origin}${p}/.well-known/openid-configuration`,
  ];
  for (const url of asTries) {
    const r = await fetch(url).catch(() => null);
    if (r?.ok) return (await r.json()) as AsMeta;
  }
  throw new Error(`Không đọc được metadata uỷ quyền của ${issuer} (đã thử ${asTries.length} đường)`);
}

/** `discover` trả `null` khi server không cần chìa — mọi chỗ cần OAuth phải nói ra. */
async function needAuth(mcpUrl: string): Promise<AsMeta> {
  const m = await discover(mcpUrl);
  if (!m) throw new Error(`${mcpUrl} không yêu cầu xác thực — không có gì để đăng nhập.`);
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// ② ĐĂNG KÝ ĐỘNG (DCR, RFC 7591) — câu trả lời cho Q1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🟢 ĐO 24/08: `POST /register` trả **201** cho `client_name: "agentco"`,
 * `token_endpoint_auth_method: "none"`, redirect loopback. **Không duyệt,
 * không allowlist, không `client_secret`.**
 *
 * ⇒ Câu hỏi *"Notion có rào app custom không, hay chỉ chiều client thực dụng?"*
 * (user hỏi 24/08) đã có đáp: **KHÔNG RÀO.** Ta được đối xử như Claude Code.
 *
 * ⚠ `none` nghĩa là **public client** — không có `client_secret` để giấu, nên
 * PKCE **không phải tuỳ chọn**, nó là thứ duy nhất chặn kẻ chen mã trao đổi.
 */
async function register(meta: AsMeta, redirectUri: string): Promise<string> {
  if (!meta.registration_endpoint) throw new Error('Server không mở DCR — phải xin client_id tay.');
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
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`DCR hỏng: HTTP ${res.status} — ${body}`);
  }
  const j = JSON.parse(body) as { client_id: string; client_secret?: string };
  if (j.client_secret) {
    // Không giết spike, nhưng phải KÊU: nó đổi mô hình bảo mật và đổi cả kho chìa.
    console.warn('⚠ Server cấp client_secret — mô hình public client không còn đúng, đọc lại §5h·2.');
  }
  return j.client_id;
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ PKCE + LOOPBACK — đăng nhập
// ─────────────────────────────────────────────────────────────────────────────

const b64url = (b: Buffer) => b.toString('base64url');

function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * 🔴 KHÔNG DÙNG `cmd /c start` TRÊN WINDOWS. (bug 24/08, user bắt được ngay lượt đầu)
 *
 * `cmd.exe` coi `&` là **ký tự nối lệnh**, nên nó cắt URL ở dấu `&` đầu tiên:
 *
 *   gửi đi   …/authorize?response_type=code&client_id=…&state=…&code_challenge=…
 *   tới nơi  …/authorize?response_type=code
 *   Notion   {"error":"invalid_request","error_description":"Missing client_id"}
 *
 * Mà URL của OAuth thì **luôn** có `&` — tức đường này hỏng 100% số lần, không
 * phải thỉnh thoảng. `rundll32 url.dll,FileProtocolHandler` nhận URL làm **một
 * tham số nguyên vẹn**, không qua shell nào, nên không có gì để cắt.
 *
 * ⚠ Lần thứ NĂM của lớp lỗi *"đúng trên máy dev, sai ở chỗ khác"* (tên shell
 * theo OS · slug phi-Latin · nút 📂 từ xa · ánh xạ đường dẫn Docker · và giờ là
 * shell quoting). Bốn lần trước đã ghi ở `SESSIONS_MEMORY` §5o ⑥.
 */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* mở không được thì thôi — URL đã in ra màn hình rồi, tự dán vẫn xong */
  }
}

/**
 * Cổng loopback nhận `?code=`.
 *
 * ⚠ Cổng phải mở **TRƯỚC** khi DCR, vì `redirect_uri` phải khớp **từng ký tự**
 * với thứ đã đăng ký, mà số cổng thì chỉ biết sau khi `listen(0)`. Làm ngược
 * thứ tự là đăng ký một cổng rồi nghe ở cổng khác — Notion trả
 * `invalid_redirect_uri` và thông báo đó **không nói ra nguyên nhân thật**.
 */
function loopback(): Promise<{
  redirectUri: string;
  wait: (state: string) => Promise<string>;
  close: () => void;
}> {
  return new Promise((resolve) => {
    let settle: ((code: string) => void) | null = null;
    let fail: ((e: Error) => void) | null = null;
    let expectState = '';

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith('/callback')) {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const err = url.searchParams.get('error');

      const say = (msg: string) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<meta charset="utf-8"><body style="font:16px system-ui;padding:3rem">${msg}</body>`);
      };

      if (err) {
        say(`❌ Notion từ chối: ${err}`);
        fail?.(new Error(`Notion trả error=${err}`));
        return;
      }
      // Chống CSRF: `state` không khớp thì mã này không phải của lượt ta mở.
      if (!code || state !== expectState) {
        say('❌ state không khớp — bỏ qua.');
        fail?.(new Error('state không khớp'));
        return;
      }
      say('✅ Xong. Đóng tab này và quay lại terminal.');
      settle?.(code);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        redirectUri: `http://127.0.0.1:${port}/callback`,
        wait: (state) =>
          new Promise<string>((ok, no) => {
            expectState = state;
            settle = ok;
            fail = no;
            // 15 phút, không phải 5: người dùng có thể phải ĐĂNG NHẬP NOTION trước
            // rồi mới tới được màn hình cấp quyền. Đặt hẹn giờ theo ca nhanh nhất
            // là bắt luồng chết đúng lúc người dùng đang làm đúng việc.
            setTimeout(() => no(new Error('Hết 15 phút chờ đăng nhập.')), 900_000).unref();
          }),
        close: () => server.close(),
      });
    });
  });
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  [k: string]: unknown;
}

async function postToken(meta: AsMeta, form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`token endpoint: HTTP ${res.status} — ${body}`);
  return JSON.parse(body) as TokenResponse;
}

function toAccount(client_id: string, t: TokenResponse): Account {
  const { access_token, refresh_token, expires_in, token_type, scope, ...extra } = t;
  return {
    client_id,
    access_token,
    refresh_token,
    expires_at: expires_in ? Date.now() + expires_in * 1000 : undefined,
    token_type: token_type ?? 'Bearer',
    scope,
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

async function login(id: string, noBrowser: boolean): Promise<Account> {
  console.log(`\n━━ ĐĂNG NHẬP · tài khoản "${id}"`);

  const meta = await needAuth(MCP_URL);
  console.log(`   issuer            ${meta.issuer}`);
  console.log(`   scopes_supported  ${JSON.stringify(meta.scopes_supported)}`);
  if (meta.scopes_supported?.length === 1) {
    console.log(
      '   🔴 ĐÚNG MỘT SCOPE ⇒ không chia nhỏ quyền được. Thẻ trên UI phải nói ra,\n' +
        '      và §5h·3 dòng "Phạm vi" KHÔNG áp dụng cho Notion. (đính chính 24/08)',
    );
  }

  const lo = await loopback();
  console.log(`   redirect_uri      ${lo.redirectUri}`);

  const client_id = await register(meta, lo.redirectUri);
  console.log(`   ✅ Q1 · DCR       client_id=${client_id}  ⇒ Notion KHÔNG rào app lạ`);

  const { verifier, challenge } = pkce();
  const state = b64url(crypto.randomBytes(16));
  const auth = new URL(meta.authorization_endpoint);
  auth.search = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: lo.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(meta.scopes_supported?.length ? { scope: meta.scopes_supported.join(' ') } : {}),
  }).toString();

  /**
   * ⚠ IN URL RA **LUÔN**, kể cả khi đã mở được trình duyệt. (user 24/08)
   *
   * Trình duyệt MẶC ĐỊNH của máy thường **không phải** chỗ người dùng đang đăng
   * nhập Notion — và khi đó luồng chết ở một màn hình đăng nhập lạ, không ai
   * hiểu vì sao. Có sẵn URL để dán sang đúng trình duyệt/profile là đường thoát
   * **rẻ nhất**, và nó cũng cứu luôn ca chặn popup.
   *
   * ⇒ Hệ quả cho SẢN PHẨM, không chỉ cho spike: nút "Đăng nhập" phải nằm ở
   * **giao diện web của agentco** (vốn ĐANG mở trong trình duyệt của người
   * dùng, tức đúng phiên đăng nhập của họ), **không** ở daemon. Daemon mở
   * trình duyệt là daemon đoán hộ người dùng họ đang đăng nhập ở đâu.
   */
  console.log(`\n   Link cấp quyền (dán sang trình duyệt bạn ĐANG đăng nhập Notion nếu cần):\n`);
  console.log(`   ${auth}\n`);
  if (!noBrowser) {
    console.log('   → Đang thử mở trình duyệt mặc định. Chọn workspace rồi bấm cho phép…');
    console.log('     (chưa đăng nhập Notion ở đó? dán link trên sang Chrome/Edge có sẵn phiên.)\n');
    openBrowser(auth.toString());
  }

  const code = await lo.wait(state);
  lo.close();

  const tok = await postToken(meta, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: lo.redirectUri,
    client_id,
    code_verifier: verifier,
  });

  const acc = toAccount(client_id, tok);
  const store = readStore();
  store.accounts[id] = acc;
  writeStore(store);

  console.log(`   access_token      ${mask(acc.access_token)}`);
  console.log(
    `   ✅ Q2 · refresh   ${acc.refresh_token ? mask(acc.refresh_token) : '🔴 KHÔNG CÓ — đọc §4 bên dưới'}`,
  );
  console.log(
    `   hết hạn           ${acc.expires_at ? new Date(acc.expires_at).toLocaleString() : '— (không hết hạn?)'}`,
  );
  if (acc.extra) console.log(`   Notion trả kèm    ${JSON.stringify(acc.extra)}`);
  console.log(`   💾 ${STORE}`);
  return acc;
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ LÀM MỚI CHÌA (Q2) — và đây là chỗ VA CHẠM VỚI KIẾN TRÚC HÔM NAY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `pickMcp` (worker.ts:831) là ĐỒNG BỘ — CỐ Ý (armexec.ts §tách hai nửa)│
 * │ Làm mới chìa là BẤT ĐỒNG BỘ. Hai thứ này không ở chung một hàm được.      │
 * │                                                                          │
 * │ Hai lối, và phải chọn TRƯỚC khi viết mã thật:                            │
 * │                                                                          │
 * │  ⓐ làm mới CHỦ ĐỘNG ở nền  — daemon tick, cùng khuôn `ensureInstalled`.  │
 * │     `pickMcp` vẫn đồng bộ, chỉ đọc chuỗi đã có. **Đề xuất.**             │
 * │     Giá: chìa có thể vừa hết hạn đúng lúc dùng ⇒ cần một lần thử lại.    │
 * │                                                                          │
 * │  ⓑ làm mới LÚC CẦN         — `pickMcp` thành async.                      │
 * │     Giá: kéo `await` vào đúng đường nóng mà `fastLaunch` vừa dọn sạch    │
 * │     (đã đo: ~4 giây/task). Trả lại thứ vừa mua.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
async function refresh(id: string): Promise<Account> {
  const store = readStore();
  const acc = store.accounts[id];
  if (!acc) throw new Error(`Chưa có tài khoản "${id}" — đăng nhập trước.`);
  if (!acc.refresh_token) throw new Error('Tài khoản này KHÔNG có refresh_token — Q2 trả lời NO.');

  const meta = await needAuth(MCP_URL);
  const before = acc.access_token;
  const tok = await postToken(meta, {
    grant_type: 'refresh_token',
    refresh_token: acc.refresh_token,
    client_id: acc.client_id,
  });

  const next = toAccount(acc.client_id, tok);
  // ⚠ Refresh token XOAY ở nhiều nhà cung cấp: không giữ cái mới là tự khoá
  // mình ra ngoài ở lần làm mới thứ hai — hỏng SAU một tuần, đúng loại lỗi đắt.
  if (!next.refresh_token) next.refresh_token = acc.refresh_token;
  store.accounts[id] = next;
  writeStore(store);

  console.log(`\n━━ LÀM MỚI · "${id}"`);
  console.log(`   chìa cũ           ${mask(before)}`);
  console.log(`   chìa mới          ${mask(next.access_token)}`);
  console.log(`   đổi chuỗi?        ${before === next.access_token ? '❌ KHÔNG' : '✅ CÓ'}`);
  console.log(
    `   refresh có xoay?  ${acc.refresh_token === next.refresh_token ? 'không (dùng lại)' : '✅ CÓ — bắt buộc phải ghi đè'}`,
  );
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ BẮT TAY MCP BẰNG TAY (Q3) — không mượn SDK của ai
// ─────────────────────────────────────────────────────────────────────────────

/** Streamable HTTP trả `application/json` HOẶC `text/event-stream`. Nhận cả hai. */
async function rpc(
  token: string,
  body: unknown,
  sessionId?: string,
): Promise<{ json: Record<string, unknown> | null; sessionId?: string }> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });

  const sid = res.headers.get('mcp-session-id') ?? sessionId;
  if (res.status === 202) return { json: null, sessionId: sid }; // notification, không có thân
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP HTTP ${res.status} — ${text.slice(0, 400)}`);

  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    // Nhặt `data:` cuối cùng — đủ cho lời gọi một-hỏi-một-đáp.
    const last = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .pop();
    return { json: last ? (JSON.parse(last) as Record<string, unknown>) : null, sessionId: sid };
  }
  return { json: JSON.parse(text) as Record<string, unknown>, sessionId: sid };
}

async function listTools(id: string): Promise<void> {
  const acc = readStore().accounts[id];
  if (!acc) throw new Error(`Chưa có tài khoản "${id}".`);

  console.log(`\n━━ BẮT TAY MCP · "${id}"  (0 dòng import SDK hãng nào)`);

  const init = await rpc(acc.access_token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: CLIENT_NAME, version: '0.0.1' },
    },
  });
  const sid = init.sessionId;
  const info = (init.json?.['result'] as { serverInfo?: { name: string; version: string } })
    ?.serverInfo;
  console.log(`   server            ${info?.name ?? '?'} ${info?.version ?? ''}`);

  await rpc(acc.access_token, { jsonrpc: '2.0', method: 'notifications/initialized' }, sid);

  const list = await rpc(acc.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid);
  const tools = ((list.json?.['result'] as { tools?: unknown[] })?.tools ?? []) as {
    name: string;
    description?: string;
    inputSchema?: unknown;
    annotations?: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
      title?: string;
    };
  }[];

  /**
   * ⚠ ĐÂY LÀ SỐ BYTE, KHÔNG PHẢI SỐ TOKEN — và khoảng cách đó có thật.
   * Con số token thật chỉ lấy được bằng `getContextUsage()` lúc cắm vào một
   * phiên có model. Ghi byte để có mốc so sánh RẺ; đừng đem byte đi hứa tiền.
   * §9b đã đo filesystem = **+2 185 token/lượt** — đó mới là đơn vị so được.
   */
  const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
  console.log(`   ✅ Q3 · số việc   ${tools.length}`);
  console.log(
    `   schema thô        ${bytes.toLocaleString('vi-VN')} byte  (≈ ${Math.round(bytes / 4).toLocaleString('vi-VN')} token — ƯỚC LƯỢNG, phải đo lại bằng getContextUsage)`,
  );

  /**
   * ⚠ ĐỌC HAY GHI PHẢI HỎI `annotations`, KHÔNG ĐƯỢC ĐOÁN TỪ TÊN. → §8a
   *
   * `notion-fetch` nghe như đọc; `notion-convert-page-to-skill` nghe như gì cũng
   * được. Tên tool là thứ hãng đặt cho người đọc, **không** phải lời khai về
   * tác dụng. Spike 1 đã đo filesystem: **13/14** tool có annotations — nên câu
   * hỏi đúng ở đây là *"Notion có khai không"*, và **vắng mặt không phải tín
   * hiệu an toàn**: thiếu `readOnlyHint` KHÔNG có nghĩa là chỉ đọc.
   */
  let ro = 0;
  let write = 0;
  let unknown = 0;
  for (const t of tools) {
    const a = t.annotations;
    const tag =
      a?.readOnlyHint === true
        ? ((ro += 1), '👁  chỉ đọc')
        : a?.readOnlyHint === false
          ? ((write += 1), a.destructiveHint ? '🔴 GHI · phá huỷ' : '✍  GHI')
          : ((unknown += 1), '❓ KHÔNG KHAI');
    console.log(`     ${tag.padEnd(16)} ${t.name}`);
  }
  console.log(
    `\n   phân loại         👁 ${ro} chỉ đọc · ✍ ${write} có ghi · ❓ ${unknown} không khai`,
  );
  if (unknown > 0) {
    console.log(
      '   ⚠ Có tool KHÔNG khai annotations ⇒ cổng duyệt theo tác dụng (§8a) KHÔNG\n' +
        '     phủ hết. Vắng mặt ≠ an toàn. [[agentco-deterministic-vs-signal]]',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ THU HỒI — "Cho nghỉ" phải giết chìa thật, không chỉ xoá file của ta
// ─────────────────────────────────────────────────────────────────────────────

async function revoke(id: string): Promise<void> {
  const store = readStore();
  const acc = store.accounts[id];
  if (!acc) throw new Error(`Chưa có tài khoản "${id}".`);
  const meta = await needAuth(MCP_URL);
  if (!meta.revocation_endpoint) {
    console.log('   ⚠ Server không công bố revocation_endpoint — chỉ xoá được phía ta.');
  } else {
    const res = await fetch(meta.revocation_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: acc.access_token, client_id: acc.client_id }).toString(),
    });
    console.log(`\n━━ THU HỒI · "${id}" → HTTP ${res.status}`);
  }
  // Bằng chứng, không phải lời hứa: gọi lại và mong nó HỎNG.
  try {
    await listTools(id);
    console.log('   🔴 VẪN GỌI ĐƯỢC — thu hồi KHÔNG có tác dụng tức thì. Đừng hứa "10 giây".');
  } catch (e) {
    console.log(`   ✅ đã chết: ${(e as Error).message.slice(0, 120)}`);
  }
  delete store.accounts[id];
  writeStore(store);
}

// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (n: string) => argv.includes(n);
  const id = argv.includes('--as') ? (argv[argv.indexOf('--as') + 1] ?? 'mac-dinh') : 'mac-dinh';

  /**
   * `--discover <url>` — CHỨNG MINH "MỘT HÌNH DẠNG CHUNG", chạy được.
   *
   * User hỏi 25/08: *"phải tự custom code cho từng hình dạng à, hay tất cả
   * worker đọc một hình dạng chung?"* Câu trả lời không nên là lý lẽ — nó phải
   * là một lệnh ai cũng chạy lại được với URL bất kỳ, kể cả MCP của cộng đồng
   * mà ta chưa từng nghe tên. Không hãng nào được ghim tên vào đoạn mã này.
   */
  if (flag('--discover')) {
    const url = argv[argv.indexOf('--discover') + 1] ?? MCP_URL;
    const m = await discover(url);
    console.log(`\n━━ KHÁM PHÁ · ${url}`);
    if (!m) {
      console.log('   🟢 KHÔNG CẦN CHÌA — cắm thẳng, không có bước đăng nhập nào.');
      return;
    }
    console.log(`   issuer            ${m.issuer}`);
    console.log(`   đăng nhập tại     ${m.authorization_endpoint}`);
    console.log(`   DCR               ${m.registration_endpoint ?? '🔴 KHÔNG — phải xin client_id tay (ca G2)'}`);
    console.log(`   PKCE              ${JSON.stringify(m.code_challenge_methods_supported ?? null)}`);
    console.log(`   thu hồi           ${m.revocation_endpoint ?? '— (chỉ xoá được phía ta)'}`);
    console.log(`   scopes            ${JSON.stringify(m.scopes_supported ?? null)}`);
    console.log(
      `\n   ⇒ ${m.registration_endpoint ? '🟢 CẮM ĐƯỢC, 0 dòng code riêng cho hãng này' : '🟡 cần một bước tay — đây mới là ca phải viết riêng'}`,
    );
    return;
  }

  if (flag('--refresh')) {
    await refresh(id);
    await listTools(id);
  } else if (flag('--tools')) {
    await listTools(id);
  } else if (flag('--revoke')) {
    await revoke(id);
  } else {
    await login(id, flag('--no-browser'));
    await listTools(id);
    const ids = Object.keys(readStore().accounts);
    console.log(`\n   ✅ Q4 · tài khoản đang giữ: ${ids.length} — ${ids.join(', ')}`);
    if (ids.length < 2) {
      console.log('      (chạy lại với `--as cty-b` bằng một tài khoản Notion KHÁC để đóng Q4)');
    }
  }
}

main().catch((e: unknown) => {
  console.error(`\n🔴 ${(e as Error).message}`);
  process.exit(1);
});
