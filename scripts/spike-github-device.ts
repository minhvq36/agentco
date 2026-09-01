/**
 * SPIKE — ĐƯỜNG DEVICE FLOW: hãng KHÔNG có DCR thì ta đăng nhập kiểu gì.
 * → SPEC-arms.md §5h (ba loại chìa) · §5h·5 (GitHub là G2) · §4e #3
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ FILE NÀY KHÔNG IMPORT SDK CỦA BẤT KỲ HÃNG NÀO. CỐ Ý — cùng lý do          │
 * │ `spike-notion-oauth.ts`: đường lui sang Codex/Antigravity/Groq chỉ có     │
 * │ thật khi có mã chạy được chứng minh. node builtins + `fetch`, hết.        │
 * │                                                                          │
 * │ ⚠ VÀ KHÔNG CÓ TÊN HÃNG NÀO TRONG THUẬT TOÁN. `device_authorization_      │
 * │ endpoint` đọc từ **metadata của chính server**, không ghim chuỗi          │
 * │ `github.com/login/device`. Đó là điều kiện để mục này là DỮ LIỆU chứ      │
 * │ không phải một nhánh mã cho một hãng (§5h·1). Thứ duy nhất ghim theo hãng │
 * │ là `client_id` — và nó là **dữ liệu công khai**, không phải bí mật.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ VÌ SAO DEVICE FLOW CHỨ KHÔNG PHẢI LUỒNG CỦA NOTION ═══
 *
 * 🌐 Tài liệu GitHub, web flow: `client_secret` **"Required."** — PKCE ở GitHub
 * là THÊM VÀO chứ không THAY CHO secret. ⇒ luồng public-client đang chạy cho
 * Notion (`token_endpoint_auth_method: none`) sẽ chết ở bước đổi mã, và chết
 * bằng một câu 401 nói *"chìa sai"* — đúng lớp lỗi §5m *câu lỗi chỉ sai cửa*.
 *
 * 🌐 Cùng tài liệu, device flow: đổi mã cần **client_id + device_code** — hết.
 * Và làm mới: *"Required **unless** the user access token was generated using
 * the device flow."* ⇒ **0 bí mật** trong toàn bộ vòng đời chìa.
 *
 * Hệ quả không hiển nhiên, và nó lớn: device flow **không có `redirect_uri`**
 * ⇒ toàn bộ §5h·6 (`redirectBase` · `public_url` · ba nhánh · bốn phép soi ·
 * hai chặn cứng vá 26/08) **không áp dụng cho cánh tay này**. Docker/VPS/nginx/
 * Cloudflare Access: vô can. Đây là mục danh mục DỄ TRIỂN KHAI NHẤT, không phải
 * khó nhất.
 *
 * ═══ NĂM CÂU HỎI SPIKE NÀY ĐÓNG — mỗi câu đều GIẾT ĐƯỢC mục danh mục ═══
 *
 *   Q1  Device flow chạy được với client_id trần, 0 secret?         → --login
 *   Q2  Có `refresh_token`? Làm mới không secret? Có XOAY?          → --refresh
 *   Q3  🔴 MCP có nhận token của một app LẠ (app của ta) không?     → --tools
 *       Nếu GitHub khoá danh sách client ⇒ phương án A chết, về PAT.
 *   Q4  Repo PRIVATE có với tới được không?                          → --file
 *   Q5  Bao nhiêu việc mỗi toolset, có annotations không, nặng cỡ nào? → --survey
 *
 * Chạy:
 *   npx tsx scripts/spike-github-device.ts --login
 *   npx tsx scripts/spike-github-device.ts --refresh
 *   npx tsx scripts/spike-github-device.ts --tools           (endpoint mặc định)
 *   npx tsx scripts/spike-github-device.ts --survey          (Q5 — so 5 endpoint)
 *   npx tsx scripts/spike-github-device.ts --file owner/repo [đường/dẫn]
 *   npx tsx scripts/spike-github-device.ts --discover <url>
 *   ... --client-id <id>   ghi đè client_id (để thử app của khách — đường thoát)
 *
 * Chi phí: **$0** — không gọi model một lần nào.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * ⚠ `client_id` LÀ DỮ LIỆU CÔNG KHAI, KHÔNG PHẢI BÍ MẬT.
 *
 * Device flow không dùng `client_secret` ở bất kỳ bước nào, nên chuỗi này ship
 * thẳng trong mã nguồn được — `gh` CLI, VS Code, Vercel đều làm đúng thế. Cái
 * KHÔNG bao giờ được vào đây là `client_secret` và `private key` của app.
 *
 * GitHub App `agent-co.app`, chủ sở hữu org `@agent-co-app`, tạo 26/08/2026.
 * Không có client secret. Không có private key. → SPEC-arms §5h·8
 */
const DEFAULT_CLIENT_ID = 'Iv23li95pd8QpYfTGMho';

/** Streamable HTTP, chính chủ GitHub. Không cài gì, không `npx`. */
const MCP_URL = 'https://api.githubcopilot.com/mcp/';

/** Chuỗi này lên màn hình đồng ý — người dùng sẽ ĐỌC nó. */
const CLIENT_NAME = 'agentco';

/** Kho của SPIKE, KHÔNG phải kho thật (`company/.state/secrets.json`). */
const STORE = path.join(HERE, '..', '.state-spike', 'github-device.json');

interface Account {
  client_id: string;
  access_token: string;
  refresh_token?: string;
  /** Mốc tuyệt đối (ms). Cất `expires_in` là cất một số vô nghĩa sau khi tắt máy. */
  expires_at?: number;
  refresh_expires_at?: number;
  token_type: string;
  scope?: string;
  extra?: Record<string, unknown>;
}

function readStore(): Record<string, Account> {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8')) as Record<string, Account>;
  } catch {
    return {};
  }
}

function writeStore(s: Record<string, Account>): void {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
  try {
    fs.chmodSync(STORE, 0o600);
  } catch {
    /* Windows: chmod là no-op */
  }
}

/** Che chìa trước khi in — không có hàm này thì spike tự đẻ ra lỗ của chính nó. */
const mask = (v?: string): string =>
  v ? `${v.slice(0, 8)}…${v.slice(-4)} (${v.length} ký tự)` : '—';

const hours = (ms: number): string => `${(ms / 3600_000).toFixed(1)} giờ`;

// ─────────────────────────────────────────────────────────────────────────────
// ① KHÁM PHÁ — y hệt `oauth.ts §discover`, thêm hai trường device flow đọc tới
// ─────────────────────────────────────────────────────────────────────────────

interface AsMeta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  /** ⇐ THỨ QUYẾT ĐỊNH NHÁNH. Có nó ⇒ đi device flow được. */
  device_authorization_endpoint?: string;
  grant_types_supported?: string[];
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

async function discover(mcpUrl: string): Promise<AsMeta | null> {
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
        clientInfo: { name: CLIENT_NAME, version: '1' },
      },
    }),
  }).catch(() => null);

  if (!probe) throw new Error(`Không gọi ra được tới ${mcpUrl} (chiều RA — kiểm proxy/egress).`);
  if (probe.ok) return null;
  if (probe.status !== 401 && probe.status !== 403) {
    throw new Error(`${mcpUrl} trả HTTP ${probe.status} — không phải cửa MCP, cũng không đòi chìa.`);
  }

  const u = new URL(mcpUrl);
  const declared = probe.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1];

  let issuer: string | null = null;
  for (const url of [
    declared,
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

  // Issuer CÓ THỂ mang path — GitHub là `https://github.com/login/oauth`, tức
  // host khác hẳn host của MCP. Đoán từ origin thì không đời nào ra chuỗi đó.
  const iss = new URL(issuer);
  const p = iss.pathname.replace(/\/$/, '');
  for (const url of [
    `${iss.origin}/.well-known/oauth-authorization-server${p}`,
    `${iss.origin}${p}/.well-known/oauth-authorization-server`,
    `${iss.origin}/.well-known/openid-configuration${p}`,
    `${iss.origin}${p}/.well-known/openid-configuration`,
  ]) {
    const r = await fetch(url).catch(() => null);
    if (r?.ok) return (await r.json()) as AsMeta;
  }
  throw new Error(`Không đọc được metadata uỷ quyền của ${issuer}.`);
}

async function needAuth(mcpUrl: string): Promise<AsMeta> {
  const m = await discover(mcpUrl);
  if (!m) throw new Error(`${mcpUrl} không cần chìa — cắm thẳng được.`);
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// ② DEVICE FLOW (Q1) — 0 secret, 0 redirect_uri, 0 cổng loopback
// ─────────────────────────────────────────────────────────────────────────────

interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  [k: string]: unknown;
}

/**
 * ⚠ `Accept: application/json` là BẮT BUỘC.
 *
 * Mặc định GitHub trả **form-urlencoded** (`access_token=x&scope=…`) chứ không
 * trả JSON, và `JSON.parse` sẽ ném một câu lỗi nói về cú pháp — tức một câu lỗi
 * **chỉ sai cửa**: người đi tìm sẽ nghi chìa, nghi mạng, trong khi sự thật là
 * ta quên một dòng header. Đúng lớp lỗi §5m.
 */
/**
 * ⚠ `step` KHÔNG phải trang trí. Đo 26/08: một lượt chờ chết với đúng hai chữ
 * **"fetch failed"** — không nói ra là gãy ở *xin mã*, ở *hỏi thăm*, hay ở *làm
 * mới*. Ba chỗ đó sửa bằng ba việc khác nhau. Câu lỗi không có cửa nào để đi
 * tiếp là câu lỗi §5m.
 */
class NetError extends Error {}

async function form(
  url: string,
  body: Record<string, string>,
  step = 'gọi',
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams(body).toString(),
    });
  } catch (e) {
    // Lớp MẠNG, không phải lớp giao thức — người gọi phải phân biệt được để
    // quyết định thử lại hay dừng. Gộp hai lớp là chọn sai ở cả hai.
    throw new NetError(`[${step}] không gọi ra được ${new URL(url).host}: ${(e as Error).message}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`[${step}] phản hồi không phải JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
}

function toAccount(clientId: string, t: TokenResponse, prev?: Account): Account {
  if (!t.access_token) {
    throw new Error(`Không có access_token: ${t.error ?? '?'} — ${t.error_description ?? ''}`);
  }
  const { access_token, refresh_token, expires_in, refresh_token_expires_in, token_type, scope, ...extra } = t;
  return {
    client_id: clientId,
    access_token,
    /**
     * 🔴 `refresh_token ?? cũ` — CHÍNH LÀ DẤU `??` ĐÃ TRẢ TIỀN Ở NOTION.
     * GitHub cũng XOAY (🌐 *"that refresh token and the old user access token
     * will no longer work"*). Không ghi đè cái mới ⇒ tự khoá mình ở lần làm mới
     * THỨ HAI, tức hỏng sau ~8 giờ. Ghi đè bằng `undefined` ⇒ vứt cái đang dùng.
     */
    refresh_token: refresh_token ?? prev?.refresh_token,
    ...(expires_in ? { expires_at: Date.now() + expires_in * 1000 } : {}),
    ...(refresh_token_expires_in
      ? { refresh_expires_at: Date.now() + refresh_token_expires_in * 1000 }
      : {}),
    token_type: token_type ?? prev?.token_type ?? 'bearer',
    ...(scope !== undefined ? { scope } : prev?.scope !== undefined ? { scope: prev.scope } : {}),
    ...(Object.keys(extra).length ? { extra: extra as Record<string, unknown> } : {}),
  };
}

async function login(id: string, clientId: string): Promise<Account> {
  const meta = await needAuth(MCP_URL);

  console.log(`\n━━ KHÁM PHÁ · ${MCP_URL}`);
  console.log(`   issuer            ${meta.issuer}`);
  console.log(`   DCR               ${meta.registration_endpoint ? '✅ có' : '🔴 KHÔNG (ca G2)'}`);
  console.log(`   device endpoint   ${meta.device_authorization_endpoint ?? '— KHÔNG CÓ'}`);
  console.log(`   grant types       ${JSON.stringify(meta.grant_types_supported ?? [])}`);

  const dev = meta.device_authorization_endpoint;
  if (!dev) {
    throw new Error(
      'Server này không khai `device_authorization_endpoint` ⇒ không đi device flow được.\n' +
        'Đó là một SỰ THẬT VỀ SERVER, không phải lỗi ở đây — hãng này cần đường khác.',
    );
  }

  // ⚠ KHÔNG gửi `client_secret`. Nếu một ngày phải gửi thì cả tiền đề của mục
  // danh mục này gãy, và nó phải gãy TO chứ không được vá lặng lẽ.
  const start = (await form(dev, { client_id: clientId })) as unknown as DeviceCode & TokenResponse;
  if (start.error || !start.device_code) {
    throw new Error(
      `Xin mã thiết bị hỏng: ${start.error ?? '?'} — ${start.error_description ?? ''}\n` +
        `⚠ Ca thường gặp nhất: app CHƯA TICK "Enable Device Flow" ⇒ GitHub trả 400.`,
    );
  }

  console.log(`\n━━ Q1 · ĐĂNG NHẬP (device flow — 0 secret, 0 callback)`);
  console.log(`\n   ① Mở:        ${start.verification_uri}`);
  console.log(`   ② Gõ mã:     ${start.user_code}`);
  console.log(`   ③ Bấm Đồng ý. Mã sống ${Math.round(start.expires_in / 60)} phút.\n`);

  let interval = (start.interval ?? 5) * 1000;
  const deadline = Date.now() + start.expires_in * 1000;
  const t0 = Date.now();

  for (;;) {
    if (Date.now() > deadline) throw new Error('Hết hạn mã — chạy lại lệnh này.');
    await new Promise((r) => setTimeout(r, interval));

    /**
     * ┌────────────────────────────────────────────────────────────────────────┐
     * │ 🔴 RỚT MẠNG KHÔNG ĐƯỢC GIẾT LƯỢT ĐĂNG NHẬP. Đo 26/08, ca thật.        │
     * │                                                                        │
     * │ Lượt đầu chết sau ~95 giây chờ với đúng hai chữ "fetch failed" — một    │
     * │ cú nấc mạng trong lúc hỏi thăm. Hậu quả không cân xứng chút nào:        │
     * │ người dùng ĐANG đứng trước trang GitHub, gõ mã xong, bấm Đồng ý — và    │
     * │ phía ta đã bỏ cuộc. Họ sẽ thấy GitHub báo "đã cấp quyền" trong khi      │
     * │ agentco báo hỏng. **Hai màn hình nói ngược nhau**, và màn hình sai lại  │
     * │ là màn hình của ta.                                                     │
     * │                                                                        │
     * │ Đây đúng luật đã chốt cho vòng làm mới (`oauth-routes.ts §refreshDue`): │
     * │ **hai loại hỏng, hai xử lý ngược nhau** — hỏng TẠM thì im lặng thử      │
     * │ lại, hỏng HẲN thì dừng và nói. Vòng chờ này trước đó chỉ có một xử lý.  │
     * │                                                                        │
     * │ ⚠ Mốc dừng vẫn là `deadline` của CHÍNH MÃ, không phải số lần thử: mã    │
     * │ chết sau 15 phút dù mạng có tốt tới đâu, nên không có vòng lặp vô hạn.  │
     * └────────────────────────────────────────────────────────────────────────┘
     */
    let t: TokenResponse;
    try {
      t = await form(
        meta.token_endpoint,
        {
          client_id: clientId,
          device_code: start.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        },
        'hỏi thăm',
      );
    } catch (e) {
      if (e instanceof NetError) {
        process.stdout.write(`   ⚠ mạng nấc, thử lại… (${e.message.slice(0, 60)})\r`);
        continue;
      }
      throw e;
    }

    /**
     * BỐN CA HỎNG, BỐN CÂU KHÁC NHAU — gộp chúng là làm người dùng đi sai cửa.
     * Ba ca đầu là trạng thái quá độ hoặc lỗi của luồng; ca thứ tư là ta gõ sai.
     */
    if (t.error === 'authorization_pending') {
      process.stdout.write('   ⏳ đang chờ…\r');
      continue;
    }
    if (t.error === 'slow_down') {
      interval += 5000; // RFC 8628: cộng thêm 5 giây, KHÔNG phải thử lại ngay
      continue;
    }
    if (t.error === 'expired_token') throw new Error('Mã hết hạn — chạy lại lệnh này.');
    if (t.error === 'access_denied') throw new Error('Bạn đã bấm Từ chối trên GitHub.');
    if (t.error) throw new Error(`${t.error} — ${t.error_description ?? ''}`);

    const acc = toAccount(clientId, t);
    const store = readStore();
    store[id] = acc;
    writeStore(store);

    console.log(`   ✅ Q1 · xong sau  ${Math.round((Date.now() - t0) / 1000)} giây`);
    console.log(`   access            ${mask(acc.access_token)}`);
    console.log(
      `   refresh           ${acc.refresh_token ? mask(acc.refresh_token) : '🔴 KHÔNG CÓ'}`,
    );
    console.log(
      `   ✅ Q2a · hết hạn  ${acc.expires_at ? hours(acc.expires_at - Date.now()) : '🔴 KHÔNG KHAI (chìa vĩnh viễn?)'}`,
    );
    console.log(
      `   refresh hết hạn   ${acc.refresh_expires_at ? hours(acc.refresh_expires_at - Date.now()) : '—'}`,
    );
    console.log(`   scope             ${acc.scope || '(rỗng — GitHub App dùng permissions, không dùng scope)'}`);
    if (!acc.refresh_token) {
      console.log(
        '\n   🔴 KHÔNG CÓ refresh_token ⇒ app CHƯA bật "Expire user authorization\n' +
          '      tokens", hoặc đây là OAuth App (chìa vĩnh viễn). Cơ chế tự làm mới\n' +
          '      KHÔNG tồn tại ở cấu hình này — thẻ danh mục phải nói thẳng.',
      );
    }
    return acc;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ LÀM MỚI (Q2) — client_id trần, và phải chứng minh chìa CŨ ĐÃ CHẾT
// ─────────────────────────────────────────────────────────────────────────────

async function refresh(id: string): Promise<void> {
  const store = readStore();
  const acc = store[id];
  if (!acc) throw new Error(`Chưa có tài khoản "${id}" — chạy --login trước.`);
  if (!acc.refresh_token) throw new Error('Tài khoản này không có refresh_token.');

  const meta = await needAuth(MCP_URL);
  const before = acc.refresh_token;

  console.log(`\n━━ Q2 · LÀM MỚI (gửi ĐÚNG client_id + refresh_token, KHÔNG secret)`);
  const t = await form(meta.token_endpoint, {
    client_id: acc.client_id,
    grant_type: 'refresh_token',
    refresh_token: before,
  });
  if (t.error) {
    throw new Error(
      `${t.error} — ${t.error_description ?? ''}\n` +
        `⚠ "invalid_client" ở đây nghĩa là GitHub ĐÒI client_secret cho luồng làm mới ⇒\n` +
        `  tiền đề "0 bí mật trọn vòng đời" GÃY, và phải ghi lại vào spec ngay.`,
    );
  }

  const next = toAccount(acc.client_id, t, acc);
  store[id] = next;
  writeStore(store);

  const rotated = next.refresh_token !== before;
  console.log(`   ✅ làm mới       KHÔNG secret — chạy được`);
  console.log(`   access mới       ${mask(next.access_token)}`);
  console.log(`   refresh có XOAY  ${rotated ? '🔴 CÓ — phải ghi đè, đúng bẫy `??`' : '⚪ không'}`);

  /**
   * ⚠ PHÉP KIỂM ĐẮT NHẤT CỦA CẢ SPIKE: gửi lại refresh CŨ.
   *
   * "Có xoay" mà không chứng minh cái cũ đã chết thì mới đo được MỘT NỬA — và
   * nửa còn lại đúng là nửa gây hỏng sau 8 giờ. Ta phải thấy nó bị từ chối.
   */
  if (rotated) {
    const dead = await form(meta.token_endpoint, {
      client_id: acc.client_id,
      grant_type: 'refresh_token',
      refresh_token: before,
    });
    console.log(
      `   refresh CŨ dùng lại  ${dead.error ? `✅ đã chết (${dead.error})` : '🔴 VẪN SỐNG — bất ngờ, đọc lại'}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ BẮT TAY MCP (Q3 · Q5) — câu hỏi CHẶN nằm ở đây
// ─────────────────────────────────────────────────────────────────────────────

async function rpc(
  url: string,
  token: string,
  body: unknown,
  sessionId?: string,
  extraHeaders?: Record<string, string>,
): Promise<{ json: Record<string, unknown> | null; sessionId?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...extraHeaders,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const sid = res.headers.get('mcp-session-id') ?? sessionId;
  if (res.status === 202) return { json: null, sessionId: sid };
  const text = await res.text();
  if (!res.ok) {
    /**
     * 🔴 401/403 Ở ĐÂY LÀ CÂU TRẢ LỜI CHO Q3, KHÔNG PHẢI MỘT LỖI VẶT.
     * Nó nghĩa là GitHub chỉ nhận client đã duyệt ⇒ phương án A (agentco đứng
     * tên) chết, và ta về đường PAT. Phải in ra nguyên văn, đừng nuốt.
     */
    throw new Error(`MCP HTTP ${res.status} — ${text.slice(0, 500)}`);
  }
  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    const last = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .pop();
    return { json: last ? (JSON.parse(last) as Record<string, unknown>) : null, sessionId: sid };
  }
  return { json: JSON.parse(text) as Record<string, unknown>, sessionId: sid };
}

interface McpTool {
  name: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    title?: string;
  };
}

/**
 * ⚠ `extraHeaders` tồn tại để đo MỘT câu hỏi cụ thể: nhiều lát cắt trong **một**
 * cánh tay được không?
 *
 * Nếu chỉ có đường URL (`/x/<toolset>`) thì "chọn 3 nhóm việc" = **ba cánh tay**
 * = ba node trên sơ đồ = ba lần nối dây cho cùng một tài khoản. Nếu header
 * `X-MCP-Toolsets` chạy thì nó là **một** cánh tay, và ô tick trên giao diện quy
 * thẳng ra một chuỗi trong `headers` — thứ `armHash` đã băm sẵn từ đầu.
 */
async function handshake(
  url: string,
  token: string,
  extraHeaders?: Record<string, string>,
): Promise<{ tools: McpTool[]; server: string; sid?: string }> {
  const init = await rpc(
    url,
    token,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: CLIENT_NAME, version: '0.0.1' },
      },
    },
    undefined,
    extraHeaders,
  );
  const sid = init.sessionId;
  const info = (init.json?.['result'] as { serverInfo?: { name: string; version: string } })
    ?.serverInfo;
  await rpc(url, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, sid, extraHeaders);
  const list = await rpc(url, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid, extraHeaders);
  const tools = ((list.json?.['result'] as { tools?: McpTool[] })?.tools ?? []) as McpTool[];
  return { tools, server: `${info?.name ?? '?'} ${info?.version ?? ''}`.trim(), ...(sid ? { sid } : {}) };
}

/**
 * BA NẤC — dùng ĐÚNG hàm suy của sản phẩm (`probe.ts §tierOf`), chép luật chứ
 * không chép mã, vì spike không được import từ `src/` (nó phải chạy độc lập).
 *
 * ⚠ MỘT CHIỀU: không biết ⇒ LEO THANG. Nấc 2 đòi ĐỦ HAI lời khai; khai mâu
 * thuẫn (`readOnly:true` + `destructive:true`) phải rơi xuống toàn quyền.
 */
function tierOf(t: McpTool): 'read' | 'add' | 'full' {
  const a = t.annotations;
  if (a?.readOnlyHint === true && a.destructiveHint !== true) return 'read';
  if (a?.readOnlyHint === false && a.destructiveHint === false) return 'add';
  return 'full';
}

async function showTools(id: string, url: string, verbose: boolean): Promise<void> {
  const acc = readStore()[id];
  if (!acc) throw new Error(`Chưa có tài khoản "${id}" — chạy --login trước.`);

  const { tools, server } = await handshake(url, acc.access_token);
  const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
  const t = { read: 0, add: 0, full: 0 };
  const noAnn = tools.filter((x) => !x.annotations).length;
  for (const x of tools) t[tierOf(x)] += 1;

  console.log(`\n━━ Q3 · BẮT TAY · ${url}`);
  console.log(`   ✅ MCP NHẬN token của app ta — Q3 trả lời XONG`);
  console.log(`   server            ${server}`);
  console.log(`   số việc           ${tools.length}`);
  console.log(
    `   schema thô        ${bytes.toLocaleString('vi-VN')} byte  (≈ ${Math.round(bytes / 4).toLocaleString('vi-VN')} token — ƯỚC LƯỢNG)`,
  );
  console.log(`   không khai ann.   ${noAnn}/${tools.length}`);
  console.log(`   ba nấc            👁 ${t.read} đọc · ✍ +${t.add} thêm · 🔴 +${t.full} sửa/xoá`);
  if (verbose) for (const x of tools) console.log(`     ${tierOf(x).padEnd(5)} ${x.name}`);

  /**
   * ⚠ BYTE ≠ TOKEN, và khoảng cách đó có thật (§9b: filesystem đo được +2 185
   * token/lượt). Byte chỉ để **so các endpoint với nhau** — rẻ và đủ để chọn
   * toolset. Con số đem lên giao diện phải là `getContextUsage().mcpTools`.
   */
  if (noAnn > 0) {
    console.log(
      '   ⚠ Có tool KHÔNG khai annotations ⇒ ba nấc suy từ lời khai KHÔNG phủ hết.\n' +
        '     Vắng mặt ≠ an toàn ⇒ chúng rơi vào "toàn quyền" (đúng luật một chiều).\n' +
        '     ⇒ Nấc "chỉ đọc" của GitHub nên lấy từ biến thể `/readonly` của SERVER.',
    );
  }
}

/** Q5 — so nhiều endpoint để chọn toolset mặc định cho thẻ danh mục. */
async function survey(id: string): Promise<void> {
  const acc = readStore()[id];
  if (!acc) throw new Error(`Chưa có tài khoản "${id}" — chạy --login trước.`);

  const targets = [
    ['mặc định', 'https://api.githubcopilot.com/mcp/'],
    ['mặc định · readonly', 'https://api.githubcopilot.com/mcp/readonly'],
    ['x/repos', 'https://api.githubcopilot.com/mcp/x/repos'],
    ['x/repos · readonly', 'https://api.githubcopilot.com/mcp/x/repos/readonly'],
    ['x/pull_requests', 'https://api.githubcopilot.com/mcp/x/pull_requests'],
    ['x/issues', 'https://api.githubcopilot.com/mcp/x/issues'],
    ['x/context', 'https://api.githubcopilot.com/mcp/x/context'],
    ['x/all', 'https://api.githubcopilot.com/mcp/x/all'],
  ] as const;

  console.log(`\n━━ Q5 · GIÁ CỦA TỪNG LÁT CẮT`);
  console.log(`   ${'endpoint'.padEnd(22)} ${'việc'.padStart(5)} ${'byte'.padStart(9)} ${'≈token'.padStart(7)}  ba nấc`);
  for (const [label, url] of targets) {
    try {
      const { tools } = await handshake(url, acc.access_token);
      const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
      const t = { read: 0, add: 0, full: 0 };
      for (const x of tools) t[tierOf(x)] += 1;
      console.log(
        `   ${label.padEnd(22)} ${String(tools.length).padStart(5)} ${bytes.toLocaleString('vi-VN').padStart(9)} ${Math.round(bytes / 4).toLocaleString('vi-VN').padStart(7)}  👁${t.read} ✍${t.add} 🔴${t.full}`,
      );
    } catch (e) {
      console.log(`   ${label.padEnd(22)} 🔴 ${(e as Error).message.slice(0, 60)}`);
    }
  }
  console.log(
    '\n   ⚠ Byte để SO CÁC LÁT CẮT với nhau, không để hứa tiền. Số lên giao diện\n' +
      '     phải là `getContextUsage().mcpTools` — hai nguồn từng lệch 27% (§9b ③).',
  );
}

/**
 * Q6 — CHÌA NÀY LÀ CỦA AI, và nó là một lỗ hổng THIẾT KẾ chứ không phải tò mò.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Nhãn mặc định của một cánh tay Notion lấy từ `workspace_name` — Notion    │
 * │ **trả kèm** nó trong phản hồi token. GitHub **không trả gì cả**: `scope`  │
 * │ rỗng, không tên, không id. ⇒ `accountName()` sẽ rơi về `issuer|mcp_url`   │
 * │ cho MỌI tài khoản GitHub ⇒ **hai tài khoản GitHub khác nhau ra CÙNG một   │
 * │ tên chìa ⇒ CÙNG một băm ⇒ gộp thành một cánh tay.** Đúng ca §6i sinh ra   │
 * │ để chặn, chỉ khác hãng.                                                   │
 * │                                                                          │
 * │ ⇒ Danh tính phải đi HỎI, và chỗ hỏi là `get_me`. Đo xem nó trả gì.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
async function whoAmI(id: string): Promise<void> {
  const acc = readStore()[id];
  if (!acc) throw new Error(`Chưa có tài khoản "${id}" — chạy --login trước.`);
  const url = 'https://api.githubcopilot.com/mcp/x/context';
  const { tools, sid } = await handshake(url, acc.access_token);
  const tool = tools.find((t) => /get_me|get_authenticated/.test(t.name))?.name;
  if (!tool) throw new Error(`Không thấy tool danh tính. Có: ${tools.map((t) => t.name).join(', ')}`);

  console.log(`\n━━ Q6 · CHÌA NÀY LÀ CỦA AI  (tool: ${tool})`);
  const r = await rpc(
    url,
    acc.access_token,
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: tool, arguments: {} } },
    sid,
  );
  const result = r.json?.['result'] as { isError?: boolean; content?: { text?: string }[] };
  const text = result?.content?.map((c) => c.text ?? '').join('\n') ?? JSON.stringify(r.json);
  console.log(text.slice(0, 900));
}

/** Q7 — nhiều lát cắt trong MỘT cánh tay: header hay phải đẻ ba node? */
async function toolsetHeader(id: string, csv: string): Promise<void> {
  const acc = readStore()[id];
  if (!acc) throw new Error(`Chưa có tài khoản "${id}" — chạy --login trước.`);

  console.log(`\n━━ Q7 · GỘP LÁT CẮT BẰNG HEADER · X-MCP-Toolsets: ${csv}`);
  const { tools } = await handshake(MCP_URL, acc.access_token, { 'X-MCP-Toolsets': csv });
  const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
  const t = { read: 0, add: 0, full: 0 };
  for (const x of tools) t[tierOf(x)] += 1;
  console.log(
    `   ${String(tools.length).padStart(3)} việc · ${bytes.toLocaleString('vi-VN')} byte ` +
      `(≈${Math.round(bytes / 4).toLocaleString('vi-VN')} token) · 👁${t.read} ✍${t.add} 🔴${t.full}`,
  );

  // ⚠ Header có thể bị NGƯỜI TA BỎ QUA IM LẶNG. Đối chiếu với endpoint mặc định
  // (44 việc): bằng nhau ⇒ header KHÔNG có tác dụng, và ta suýt tin là có.
  // Cùng cơ chế `warnDroppedTools` đã dựng cho `tools`. → [[agentco-silent-allowlist]]
  const base = await handshake(MCP_URL, acc.access_token);
  console.log(
    `   đối chiếu mặc định  ${base.tools.length} việc ⇒ ` +
      (tools.length === base.tools.length
        ? '🔴 BẰNG NHAU — header bị BỎ QUA IM LẶNG, đừng tin nó'
        : '✅ header CÓ tác dụng'),
  );
  const readonly = await handshake(MCP_URL, acc.access_token, {
    'X-MCP-Toolsets': csv,
    'X-MCP-Readonly': 'true',
  });
  console.log(
    `   + X-MCP-Readonly    ${readonly.tools.length} việc ⇒ ` +
      (readonly.tools.length < tools.length ? '✅ có tác dụng' : '🔴 BỊ BỎ QUA'),
  );
}

/**
 * Cửa tổng quát: gọi MỘT tool bất kỳ với tham số JSON.
 *
 * Có nó thì mọi câu hỏi "server này làm được X không" đo được ngay mà không phải
 * thêm một cờ vào script — và một script mà mỗi câu hỏi là một cờ sẽ mọc thành
 * chính thứ `catalog.ts` đã cấm: một nhánh mã cho mỗi hãng.
 */
async function callTool(id: string, url: string, name: string, argsJson: string): Promise<void> {
  const acc = readStore()[id];
  if (!acc) throw new Error(`Chưa có tài khoản "${id}" — chạy --login trước.`);
  /**
   * ⚠ `@file` KHÔNG phải tiện nghi — nó là đường vòng qua một lớp lỗi có thật.
   *
   * PowerShell **nuốt dấu nháy kép** khi truyền cho tiến trình native, và `\n`
   * trong chuỗi cũng bị diễn giải lại. Cùng một lệnh chạy đúng trên bash, hỏng
   * trên PowerShell — đúng lớp *"đúng trên máy dev"* đã dẫm nhiều lần.
   * ⇒ Dữ liệu có cấu trúc thì đi qua **file**, không đi qua dòng lệnh.
   * → [[agentco-three-os-always]]
   */
  const raw = argsJson.startsWith('@') ? fs.readFileSync(argsJson.slice(1), 'utf8') : argsJson;
  const { sid } = await handshake(url, acc.access_token);
  console.log(`\n━━ GỌI · ${name}  ${raw.slice(0, 200)}`);
  const r = await rpc(
    url,
    acc.access_token,
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name, arguments: JSON.parse(raw) as Record<string, unknown> },
    },
    sid,
  );
  /**
   * ⚠ HAI TẦNG HỎNG, VÀ BẢN ĐẦU CHỈ ĐỌC MỘT — nên nó in "✅ OK" cho một lời từ
   * chối. Đúng họ bug *"hệ thống nói dối về trạng thái của nó"* (§BUG UI 26/08),
   * lần này do chính spike đẻ ra trong lúc đi đo hàng rào.
   *
   *   `json.error`          → JSON-RPC từ chối: tool KHÔNG TỒN TẠI ở endpoint này
   *   `result.isError`      → tool có thật, chạy, và trả về thất bại
   *
   * Phân biệt được hai tầng này là điều kiện để đọc đúng phép đo `/readonly`:
   * ta cần thấy **tầng một**, vì tầng một mới là *hàng rào*; tầng hai chỉ là
   * *một lượt gọi hỏng*.
   */
  const rpcErr = r.json?.['error'] as { code?: number; message?: string } | undefined;
  if (rpcErr) {
    console.log(`   🔴 BỊ TỪ CHỐI Ở TẦNG GIAO THỨC — code ${rpcErr.code}: ${rpcErr.message}`);
    console.log('      ⇒ tool KHÔNG có ở endpoint này. Đây là HÀNG RÀO, không phải lượt gọi hỏng.');
    return;
  }
  const result = r.json?.['result'] as { isError?: boolean; content?: { text?: string }[] };
  const text = result?.content?.map((c) => c.text ?? '').join('\n') ?? JSON.stringify(r.json);
  console.log(`   ${result?.isError ? '🔴 TOOL TRẢ LỖI' : '✅ OK'} (${text.length} ký tự)`);
  console.log(text.slice(0, 1200));
}

/** Q4 — repo PRIVATE có với tới được không. Gọi một tool thật, không suy luận. */
async function readFile(id: string, repo: string, filePath: string): Promise<void> {
  const acc = readStore()[id];
  if (!acc) throw new Error(`Chưa có tài khoản "${id}" — chạy --login trước.`);
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error('Dạng: --file owner/repo [đường/dẫn]');

  const url = 'https://api.githubcopilot.com/mcp/x/repos';
  const { tools, sid } = await handshake(url, acc.access_token);
  const tool = tools.find((t) => /get_file_contents/.test(t.name))?.name;
  if (!tool) throw new Error(`Không thấy tool đọc file. Có: ${tools.map((t) => t.name).join(', ')}`);

  console.log(`\n━━ Q4 · REPO PRIVATE · ${repo}  (tool: ${tool})`);
  const r = await rpc(
    url,
    acc.access_token,
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: tool, arguments: { owner, repo: name, path: filePath } },
    },
    sid,
  );
  const result = r.json?.['result'] as { isError?: boolean; content?: { text?: string }[] };
  const text = result?.content?.map((c) => c.text ?? '').join('\n') ?? JSON.stringify(r.json);
  console.log(
    result?.isError
      ? `   🔴 KHÔNG với tới được:\n${text.slice(0, 600)}`
      : `   ✅ ĐỌC ĐƯỢC (${text.length} ký tự):\n${text.slice(0, 400)}`,
  );
  console.log(
    '\n   ⚠ Hỏng ở đây thì NGUYÊN NHÂN THƯỜNG GẶP NHẤT không phải chìa: GitHub App\n' +
      '     chỉ với tới repo ĐÃ ĐƯỢC CÀI. Kiểm: github.com/apps/agent-co-app/installations/new',
  );
}

// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (n: string): boolean => argv.includes(n);
  const val = (n: string, d?: string): string | undefined =>
    argv.includes(n) ? (argv[argv.indexOf(n) + 1] ?? d) : d;

  const id = val('--as', 'mac-dinh')!;
  const clientId = val('--client-id', DEFAULT_CLIENT_ID)!;

  if (flag('--discover')) {
    const url = val('--discover', MCP_URL)!;
    const m = await discover(url);
    console.log(`\n━━ KHÁM PHÁ · ${url}`);
    if (!m) {
      console.log('   ⇒ 🟢 không cần chìa — cắm thẳng được.');
      return;
    }
    console.log(`   issuer            ${m.issuer}`);
    console.log(`   đăng nhập tại     ${m.authorization_endpoint}`);
    console.log(`   DCR               ${m.registration_endpoint ? '✅ có' : '🔴 KHÔNG (ca G2)'}`);
    console.log(`   device flow       ${m.device_authorization_endpoint ?? '— không khai'}`);
    console.log(`   PKCE              ${JSON.stringify(m.code_challenge_methods_supported ?? [])}`);
    console.log(`   scopes            ${JSON.stringify(m.scopes_supported ?? [])}`);
    return;
  }
  if (flag('--refresh')) return refresh(id);
  if (flag('--survey')) return survey(id);
  if (flag('--me')) return whoAmI(id);
  if (flag('--call')) {
    const i = argv.indexOf('--call');
    return callTool(
      id,
      val('--url', 'https://api.githubcopilot.com/mcp/x/repos')!,
      argv[i + 1]!,
      argv[i + 2] ?? '{}',
    );
  }
  if (flag('--toolsets')) return toolsetHeader(id, val('--toolsets', 'context,repos')!);
  if (flag('--file')) {
    return readFile(id, val('--file')!, argv[argv.indexOf('--file') + 2] ?? 'README.md');
  }
  if (flag('--tools')) {
    return showTools(id, val('--url', MCP_URL)!, flag('--verbose'));
  }
  await login(id, clientId);
}

main().catch((e) => {
  console.error(`\n🔴 ${(e as Error).message}\n`);
  process.exit(1);
});
