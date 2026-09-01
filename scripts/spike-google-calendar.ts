/**
 * SPIKE — GOOGLE CALENDAR MCP CHÍNH CHỦ: `https://calendarmcp.googleapis.com/mcp/v1`
 * → SPEC-arms.md §4e #4 (Google là G2) · §5h (ba loại chìa) · SESSIONS_MEMORY §5t
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ FILE NÀY KHÔNG IMPORT SDK CỦA BẤT KỲ HÃNG NÀO — cùng lý do hai spike     │
 * │ trước. node builtins + `fetch`, hết. Đường lui sang Codex/Antigravity    │
 * │ chỉ có thật khi có mã chạy được chứng minh.                              │
 * │                                                                          │
 * │ ⚠ NHƯNG KHÁC HAI SPIKE TRƯỚC Ở MỘT ĐIỂM, VÀ PHẢI NÓI RA:                │
 * │ file này **có ghim chuỗi của Google** (scope, endpoint, `access_type`).   │
 * │ Đó là hợp lệ ở một spike — việc của nó là ĐO một hãng. Nhưng khi bê sang │
 * │ sản phẩm, mọi chuỗi đó phải thành **dữ liệu trong `arms/google-*.ts`**,   │
 * │ không được thành nhánh `if (id === 'google')` ở bất kỳ đâu (§5h·1).       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ VÌ SAO KHÔNG DÙNG LẠI ĐƯỢC CẢ HAI LUỒNG ĐÃ CÓ ═══
 *
 * Đo 28/08, bằng máy, không phải đọc tài liệu:
 *   · `accounts.google.com/.well-known/openid-configuration` **không có
 *     `registration_endpoint`** ⇒ không DCR ⇒ luồng Notion chết ở bước xin
 *     `client_id`.
 *   · Device flow của Google **chỉ cấp** `email·openid·profile·drive.appdata·
 *     drive.file·youtube*` ⇒ **không có scope Calendar** ⇒ luồng GitHub chết.
 *   · `token_endpoint_auth_methods_supported: ["client_secret_post",
 *     "client_secret_basic"]` — **không có `none`** ⇒ Google **bắt buộc
 *     `client_secret`**, thứ `exchangeCode`/`refreshAccount` hôm nay không gửi.
 *
 * ⇒ Cơ chế MỚI mục này mở, và nó chỉ có MỘT: **confidential client**
 * (client_secret ở token endpoint). Mọi thứ còn lại — loopback, PKCE, state,
 * kho chìa, xoay chìa — dùng lại nguyên của `oauth.ts`.
 *
 * ═══ BẢY CÂU SPIKE NÀY ĐÓNG — mỗi câu đều GIẾT ĐƯỢC mục danh mục ═══
 *
 *   Q0b 🔴 **CÓ BẮT BUỘC SHIP `client_secret` KHÔNG?** Nếu Google nhận PKCE trần
 *       cho client Desktop thì ta ship **0 bí mật** (bằng GitHub), và rủi ro
 *       "secret nằm trong repo public" biến mất.        --login --no-secret
 *   Q1  Client kiểu **Desktop** (loopback cổng ngẫu nhiên) có được Google cấp
 *       chìa cho scope Calendar không, hay bắt buộc **Web** như tài liệu MCP
 *       viết? → quyết định wizard bắt khách tạo client kiểu nào.   --login
 *   Q2  `access_type=offline` có ra `refresh_token` không · làm mới có cần
 *       `client_secret` không · Google có XOAY refresh token không · đăng nhập
 *       LẦN HAI mà thiếu `prompt=consent` thì có mất chìa làm mới không.
 *                                                              --login · --refresh
 *   Q3  🔴 `calendarmcp` có nhận chìa của một app **LẠ** (app của khách, không
 *       phải app Claude/Antigravity) không? Nếu Google khoá danh sách client
 *       thì **toàn bộ hướng này chết**, không có đường vá.            --call
 *   Q4  🔴🔴 **CẮT TOOL ĐƯỢC KHÔNG, kiểu GitHub?** `tools/list` với chìa
 *       chỉ-đọc vs chìa toàn quyền vs KHÔNG chìa — đếm việc + byte.
 *       Đây là câu quyết **~25 000 hay ~10 500 token mỗi lượt**.       --tools
 *   Q5  Tài khoản **Gmail cá nhân** gọi được không, hay bắt buộc Workspace +
 *       ghi danh Developer Preview Program?                            --call
 *   Q6  Hàng rào nấc chỉ-đọc nằm ở **scope của hãng** (như header của GitHub)
 *       hay chỉ ở danh sách của ta? Gọi `create_event` bằng chìa chỉ-đọc và
 *       đọc mã lỗi.                                    --call create_event
 *   Q7  Câu lỗi khi **chưa bật `calendarmcp.googleapis.com`** trông thế nào —
 *       để dịch sang tiếng người, đúng bài học `githubDoorError` (§5h·7f).
 *       ⇒ CHẠY `--call` MỘT LẦN **TRƯỚC KHI** BẬT API. Bỏ lỡ khoảnh khắc đó
 *       là mất một câu lỗi ta sẽ phải đoán lại về sau.
 *
 * Chạy (không cần chìa):
 *   npx tsx scripts/spike-google-calendar.ts --setup
 *   npx tsx scripts/spike-google-calendar.ts --discover
 *   npx tsx scripts/spike-google-calendar.ts --tools
 *
 * Chạy (cần chìa trong `.state-spike/google-client.json`):
 *   npx tsx scripts/spike-google-calendar.ts --login   --tier read  --client desktop
 *   npx tsx scripts/spike-google-calendar.ts --login   --tier full  --client web
 *   npx tsx scripts/spike-google-calendar.ts --tools   --tier read
 *   npx tsx scripts/spike-google-calendar.ts --refresh --tier read
 *   npx tsx scripts/spike-google-calendar.ts --call    list_calendars --tier read
 *   npx tsx scripts/spike-google-calendar.ts --call    create_event   --tier read
 *   npx tsx scripts/spike-google-calendar.ts --report
 *
 * Chi phí: **$0** — không gọi model một lần nào.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Streamable HTTP, chính chủ Google. Không cài gì, không `npx`. */
const MCP_URL = 'https://calendarmcp.googleapis.com/mcp/v1';

/**
 * Google **không** để metadata ở chỗ MCP URL chỉ tới (đo: `/.well-known/
 * oauth-protected-resource` → 404). Nó nằm ở `accounts.google.com`, và mục
 * danh mục sẽ phải **khai** chuỗi này thay vì khám phá ra — xem `--discover`.
 */
const ISSUER = 'https://accounts.google.com';

/**
 * ═══ BẢN ĐỒ SCOPE — LẤY TỪ MÁY, KHÔNG ĐOÁN ═══
 *
 * Google khai metadata **theo TỪNG TOOL** (chưa hãng nào làm thế):
 *   `/.well-known/oauth-protected-resource/<tên tool>` → `scopes_supported`
 *
 * Đọc cả 9 tool ngày 28/08 rồi rút gọn thành hai bộ nhỏ nhất phủ đủ:
 *
 *   ĐỌC (5 việc)  list_calendars · list_events · get_event · search_events ·
 *                 suggest_time
 *   GHI (+4)      create_event · update_event · delete_event · respond_to_event
 *
 * ⚠ `calendar.events` KHÔNG phủ `list_calendars` (tool đó đòi họ
 * `calendar.calendarlist*` hoặc `calendar[.readonly]`) ⇒ nấc toàn quyền phải
 * mang **hai** scope. Thiếu vế hai thì 8/9 việc chạy và **đúng một việc** 403 —
 * kiểu hỏng khó truy nhất.
 *
 * ⚠ `openid email` KHÔNG phải scope thừa: nó là thứ làm phản hồi token mang
 * `id_token`, tức **danh tính đọc được mà không tốn một lời gọi mạng nào**.
 * Đây chính là bản vá cho bug lượt-lạnh 28/08 (`probeIdentity` gọi `get_me`
 * bằng chìa vừa đúc, vượt trần 10 giây, đẻ ra `accountName` rỗng). Notion
 * thoát bug đó vì nó trả `workspace_id` ngay trong phản hồi token — `id_token`
 * cho ta đúng tính chất ấy. Cả hai đều **không nhạy cảm**, không cần duyệt.
 */
const SCOPES = {
  read: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
    'https://www.googleapis.com/auth/calendar.events.freebusy',
  ],
  full: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ],
} as const;

type Tier = keyof typeof SCOPES;

/** Chuỗi này lên màn hình đồng ý của Google — người dùng sẽ ĐỌC nó. */
const CLIENT_NAME = 'agentco';

/** Kho của SPIKE, KHÔNG phải kho thật (`company/.state/secrets.json`). */
const STORE = path.join(HERE, '..', '.state-spike', 'google-calendar.json');
/** Chìa app do NGƯỜI DÙNG tự tạo và tự điền — không bao giờ đi qua khung chat. */
const CLIENTS = path.join(HERE, '..', '.state-spike', 'google-client.json');

interface ClientApp {
  client_id: string;
  client_secret: string;
  /** Chỉ client kiểu **Web** mới cần: Google khớp `redirect_uri` từng ký tự, kể cả cổng. */
  port?: number;
}
type ClientKind = 'desktop' | 'web';

interface Account {
  kind: ClientKind;
  tier: Tier;
  client_id: string;
  access_token: string;
  refresh_token?: string;
  /** Mốc tuyệt đối (ms). Cất `expires_in` là cất một số vô nghĩa sau khi tắt máy. */
  expires_at?: number;
  token_type: string;
  scope?: string;
  /** Danh tính bóc từ `id_token` — `sub` là hạt giống băm, `email` là nhãn. */
  sub?: string;
  email?: string;
  /** Số lần đã làm mới — để thấy Google có XOAY refresh token không. */
  refreshed?: number;
  first_login_at?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⓪ Tiện ích chung
// ─────────────────────────────────────────────────────────────────────────────

const say = (s = ''): void => {
  process.stdout.write(`${s}\n`);
};

/** Che chìa trước khi in — không có hàm này thì spike tự đẻ ra lỗ của chính nó. */
const mask = (v?: string): string =>
  v ? `${v.slice(0, 6)}…${v.slice(-4)} (${v.length} ký tự)` : '—';

const b64url = (b: Buffer): string => b.toString('base64url');

/**
 * Ước token từ byte. ⚠ **CHỈ để SO các lát cắt với nhau**, không phải số lên
 * giao diện: số đó phải là `getContextUsage()` của chính SDK (§9b — hai nguồn
 * lệch 27% và **không đo cùng một thứ**).
 */
const estTokens = (bytes: number): number => Math.round(bytes / 4);

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(p: string, v: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* Windows: chmod là no-op */
  }
}

const readStore = (): Record<string, Account> => readJson<Record<string, Account>>(STORE) ?? {};
const storeKey = (kind: ClientKind, tier: Tier): string => `${kind}|${tier}`;

function saveAccount(acc: Account): void {
  const s = readStore();
  s[storeKey(acc.kind, acc.tier)] = acc;
  writeJson(STORE, s);
}

function loadAccount(kind: ClientKind, tier: Tier): Account {
  const acc = readStore()[storeKey(kind, tier)];
  if (!acc) {
    throw new Error(
      `Chưa có chìa cho (${kind} · ${tier}). Chạy trước:\n` +
        `  npx tsx scripts/spike-google-calendar.ts --login --client ${kind} --tier ${tier}`,
    );
  }
  return acc;
}

function loadClient(kind: ClientKind): ClientApp {
  const all = readJson<Record<string, ClientApp>>(CLIENTS);
  const app = all?.[kind];
  if (!app?.client_id || !app?.client_secret) {
    throw new Error(
      `Chưa có chìa app kiểu "${kind}" trong ${CLIENTS}.\n` +
        `Chạy \`--setup\` để xem cách tạo file đó.`,
    );
  }
  return app;
}

/**
 * ⚠ Lần thứ SÁU của lớp lỗi *"đúng trên máy dev, sai ở chỗ khác"*. Ba nhánh,
 * không phải một — và tuyệt đối không đi qua shell (dấu `&` trong URL OAuth
 * làm hỏng **100% số lần** trên Windows, đã dẫm 24/08).
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

// ─────────────────────────────────────────────────────────────────────────────
// ① KHÁM PHÁ — và ở đây nó HỎNG. Đo cho ra cái hỏng, đừng đi vòng qua nó.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 CÂU HỎI THẬT CỦA HÀM NÀY: `oauth.ts §discover` nói gì về Google?
 *
 * Đo 28/08: `initialize` **KHÔNG cần chìa** → HTTP **200**. Mà `discover` có
 * dòng `if (probe.ok) return null`, và `null` nghĩa là *"server không cần
 * chìa"* ⇒ `oauth-routes.ts:219` ném đúng câu **"cắm thẳng được"**.
 *
 * Rồi cắm thẳng xong thì **mọi `tools/call` trả 401**. Đây là **xanh giả** —
 * chiều nguy nhất, vì người dùng mang câu "cắm thẳng được" đi tìm nguyên nhân
 * ở chỗ khác. Cùng lớp lỗi với ca `gmailmcp` 404 mà chính comment ở
 * `oauth.ts:164-172` đã ghi, nhưng **chiều ngược**: 404 thì bị bắt, 200 thì lọt.
 *
 * 📌 Và comment đó nay đã **lỗi thời**: `gmailmcp` hôm nay trả **200 · 23 việc**.
 * Cả 7 host MCP của Google đều 200 ⇒ lỗ này phủ **toàn bộ** Google, không riêng
 * Calendar.
 *
 * Tín hiệu thật chỉ xuất hiện ở `tools/call`, và nó **tự khai chỗ metadata**:
 *   `WWW-Authenticate: Bearer resource_metadata="…/oauth-protected-resource/<tool>"`
 */
async function cmdDiscover(): Promise<void> {
  say('═══ Q0 · Cửa khám phá: `discover()` nói gì về Google ═══\n');

  const init = await mcpRaw('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: CLIENT_NAME, version: '1' },
  });
  say(`initialize          → HTTP ${init.status}${init.status === 200 ? '  ⚠ KHÔNG đòi chìa' : ''}`);

  const list = await mcpRaw('tools/list', {});
  say(`tools/list          → HTTP ${list.status}${list.status === 200 ? '  ⚠ KHÔNG đòi chìa' : ''}`);

  const call = await mcpRaw('tools/call', { name: 'list_calendars', arguments: {} });
  const wa = call.headers.get('www-authenticate');
  say(`tools/call          → HTTP ${call.status}`);
  say(`WWW-Authenticate    → ${wa ?? '—'}`);

  say('');
  if (init.status === 200) {
    say('🔴 KẾT LUẬN: `discover()` sẽ trả `null` (dòng `if (probe.ok) return null`)');
    say('   ⇒ `oauth-routes.ts:219` ném "…không cần đăng nhập — cắm thẳng được."');
    say('   ⇒ XANH GIẢ. Người dùng cắm xong và 401 ở MỌI lời gọi.');
    say('   ⇒ Bản vá phải đo bằng một lời gọi CÓ TÁC DỤNG, không phải bắt tay.');
  }

  // Bản đồ scope theo từng tool — đây là thứ mục danh mục sẽ khai lại thành dữ liệu.
  say('\n─── Metadata theo TỪNG TOOL (`scopes_supported`) ───');
  const tools = (await toolNames()) ?? [];
  for (const t of tools) {
    const r = await fetch(`https://calendarmcp.googleapis.com/.well-known/oauth-protected-resource/${t}`)
      .then((x) => (x.ok ? (x.json() as Promise<{ scopes_supported?: string[] }>) : null))
      .catch(() => null);
    const short = (r?.scopes_supported ?? []).map((s) => s.replace('https://www.googleapis.com/auth/', ''));
    say(`  ${t.padEnd(18)} ${short.join(' · ') || '—'}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ② MCP — một hàm gọi, dùng cho cả ba ca (không chìa · chìa đọc · chìa ghi)
// ─────────────────────────────────────────────────────────────────────────────

interface RawResult {
  status: number;
  headers: Headers;
  body: string;
  json: Record<string, unknown> | null;
}

async function mcpRaw(
  method: string,
  params: unknown,
  opts: { token?: string; headers?: Record<string, string> } = {},
): Promise<RawResult> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    /* không phải JSON — giữ nguyên `body` để in ra, đừng đoán hộ */
  }
  return { status: res.status, headers: res.headers, body, json };
}

interface ToolDef {
  name: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  [k: string]: unknown;
}

async function listTools(opts: { token?: string; headers?: Record<string, string> } = {}): Promise<{
  tools: ToolDef[];
  bytes: number;
  status: number;
} | null> {
  const r = await mcpRaw('tools/list', {}, opts);
  const tools = ((r.json?.['result'] as { tools?: ToolDef[] } | undefined)?.tools ?? []) as ToolDef[];
  if (!tools.length) return { tools: [], bytes: r.body.length, status: r.status };
  return { tools, bytes: r.body.length, status: r.status };
}

const toolNames = async (): Promise<string[] | null> => (await listTools())?.tools.map((t) => t.name) ?? null;

// ─────────────────────────────────────────────────────────────────────────────
// ③ Q4 — CẮT TOOL ĐƯỢC KHÔNG? Câu đắt nhất của cả spike.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GitHub cắt bằng **header** (`X-MCP-Toolsets` · `X-MCP-Readonly`) và nhờ đó
 * mục đó tồn tại được: cả server ≈30 000 token/lượt, cắt xong còn ≈11 600.
 *
 * Đo 28/08 khi CHƯA có chìa: ba header kiểu GitHub đều **không đổi gì** — vẫn
 * 9 việc, vẫn 99 591 byte. Nhưng đó **chưa phải câu trả lời**: còn một đường
 * cắt nữa mà chỉ chìa thật mới đo được — **server tự giấu tool theo scope**.
 *
 *   · Nếu chìa chỉ-đọc thấy **5 việc** ⇒ nấc quyền vừa là hàng rào **vừa là
 *     cái van token** — mục này sống khoẻ (~10 500 token).
 *   · Nếu vẫn thấy **9 việc** ⇒ giá là **~25 000 token MỖI LƯỢT ở MỌI NẤC**,
 *     và câu hỏi sản phẩm đổi hẳn: có đáng cắm không, hay đi đường
 *     Path B connector (SPEC-connectors) để tự quyết giá.
 *
 * ⚠ Đây là đo `tools/list`, tức **thứ server chịu khai**. Số token thật lên
 * giao diện vẫn phải là `probeArm` → `getContextUsage()`.
 */
async function cmdTools(tier: Tier | null, kind: ClientKind): Promise<void> {
  say('═══ Q4 · CẮT TOOL ĐƯỢC KHÔNG ═══\n');

  const rows: { nhãn: string; việc: number; byte: number; token: number }[] = [];

  const anon = await listTools();
  if (anon) {
    rows.push({ nhãn: 'KHÔNG chìa', việc: anon.tools.length, byte: anon.bytes, token: estTokens(anon.bytes) });
    say('─── Không chìa: khai gì ───');
    for (const t of anon.tools) {
      const a = t.annotations ?? {};
      say(
        `  ${t.name.padEnd(18)} readOnly=${String(a.readOnlyHint ?? '—').padEnd(5)} ` +
          `destructive=${String(a.destructiveHint ?? '—').padEnd(5)} ` +
          `${estTokens(JSON.stringify(t).length)} token`,
      );
    }
    say('');
  }

  // Thử lại các header kiểu GitHub — lần này CÓ chìa, phòng khi server chỉ
  // nghe header sau khi đã nhận ra ai gọi.
  if (tier) {
    const acc = await freshToken(kind, tier);
    const withKey = await listTools({ token: acc.access_token });
    if (withKey) {
      rows.push({
        nhãn: `chìa ${tier}`,
        việc: withKey.tools.length,
        byte: withKey.bytes,
        token: estTokens(withKey.bytes),
      });
    }
    const thửHeader: Record<string, string>[] = [
      { 'X-MCP-Readonly': 'true' },
      { 'X-MCP-Toolsets': 'events' },
      { 'X-Goog-MCP-Toolsets': 'events' },
      { 'X-Goog-Api-Client': 'agentco' },
    ];
    for (const h of thửHeader) {
      const r = await listTools({ token: acc.access_token, headers: h });
      if (r) {
        rows.push({
          nhãn: `chìa ${tier} + ${Object.keys(h)[0]}`,
          việc: r.tools.length,
          byte: r.bytes,
          token: estTokens(r.bytes),
        });
      }
    }
  }

  say('─── Bảng so ───');
  for (const r of rows) {
    say(`  ${r.nhãn.padEnd(38)} ${String(r.việc).padStart(2)} việc  ${String(r.byte).padStart(7)} byte  ≈${r.token} token`);
  }

  const base = rows[0];
  const cut = rows.find((r) => base && r.việc < base.việc);
  say('');
  if (cut) {
    say(`🟢 CẮT ĐƯỢC: "${cut.nhãn}" còn ${cut.việc} việc ≈${cut.token} token — nấc quyền vừa là hàng rào vừa là van token.`);
  } else if (rows.length > 1) {
    say('🔴 KHÔNG CẮT ĐƯỢC: mọi đường đều ra cùng số việc.');
    say(`   ⇒ Giá cố định ≈${base?.token ?? '?'} token MỖI LƯỢT ở MỌI NẤC.`);
    say('   ⇒ Đây là dữ kiện để cân lại: cắm MCP chính chủ, hay tự tả bằng Path B connector.');
  } else {
    say('⚠ Mới đo được ca KHÔNG chìa. Chạy lại kèm `--tier read` sau khi đã đăng nhập.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ OAuth — luồng mã uỷ quyền + loopback, **thêm `client_secret`**
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cổng loopback nhận `?code=`.
 *
 * ⚠ HAI KIỂU CLIENT, HAI LUẬT VỀ CỔNG — và đây chính là Q1:
 *   · **Desktop**: 🌐 *"The console does not require any additional information
 *     to create OAuth 2.0 credentials for desktop applications"* ⇒ **không có ô
 *     redirect nào để đăng ký**, và cổng không bị khớp ⇒ `listen(0)` chạy được
 *     ⇒ **khách không dán gì, không chọn cổng nào**. Trong sản phẩm thì còn rẻ
 *     hơn nữa: dùng thẳng cổng daemon đang nghe qua `redirectBase()`, y như
 *     luồng Notion — 0 listener mới, 0 cổng mới để xung đột.
 *   · **Web**: khớp **từng ký tự, kể cả cổng** ⇒ phải dán một URL vào Cloud
 *     Console. Đây là ca của **VPS/domain**, không phải ca của máy cá nhân.
 *
 * Tài liệu MCP của Google chỉ nói kiểu **Web** vì client của họ là Claude.ai —
 * một dịch vụ web, callback là URL công khai. agentco chạy **trên máy khách**
 * nên Desktop mới là kiểu đúng. Nhưng *"đúng về lý"* không phải bằng chứng:
 * câu chưa ai trả lời là **`calendarmcp` có nhận chìa đúc từ client Desktop
 * không**. Đó là Q1, và nếu nó đỏ thì mới cần tới nhánh Web.
 */
function loopback(fixedPort?: number): Promise<{
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
      const err = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });

      if (err) {
        res.end(`<p>Google từ chối: <b>${err}</b>. Quay lại terminal.</p>`);
        fail?.(new Error(`Google trả error=${err}`));
        return;
      }
      /**
       * ⚠ Kiểm `state` là chống CSRF, không phải thủ tục cho đẹp: thiếu nó thì
       * bất kỳ trang web nào cũng dắt được trình duyệt của người dùng nhét một
       * mã uỷ quyền của kẻ khác vào đây.
       */
      if (!state || state !== expectState) {
        res.end('<p>state không khớp — bỏ qua.</p>');
        fail?.(new Error('state không khớp'));
        return;
      }
      if (!code) {
        res.end('<p>Không có mã.</p>');
        fail?.(new Error('callback không có code'));
        return;
      }
      res.end('<p>✅ Xong. Đóng tab này và quay lại terminal.</p>');
      settle?.(code);
    });

    server.listen(fixedPort ?? 0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        // ⚠ `localhost` chứ không phải `127.0.0.1` cho client Web: Cloud Console
        // nhận `http://localhost:<cổng>` nhưng TỪ CHỐI `http://127.0.0.1:<cổng>`
        // ở một số cấu hình. Loopback của client Desktop thì nhận cả hai.
        redirectUri: `http://localhost:${port}/callback`,
        wait: (state) =>
          new Promise<string>((ok, no) => {
            expectState = state;
            settle = ok;
            fail = no;
          }),
        close: () => server.close(),
      });
    });
  });
}

/**
 * ⚠⚠ HAI THAM SỐ QUYẾT ĐỊNH TOÀN BỘ CÂU "KHÁCH CÓ BỊ ĐÁ RA KHÔNG":
 *
 *   `access_type=offline`  Google **chỉ** cấp `refresh_token` khi có dòng này.
 *                          Đây là phương ngữ riêng của Google — RFC 6749 không
 *                          có nó, nên `authorizeUrl()` của ta (viết cho Notion
 *                          và GitHub, hai hãng trả refresh mặc định) không có.
 *                          Thiếu ⇒ chìa chết sau ~1 giờ, và **cắm xong vẫn xanh**.
 *
 *   `prompt=consent`       Google chỉ trả `refresh_token` ở lần đồng ý ĐẦU TIÊN
 *                          của cặp (client, user). Thiếu ⇒ ca **"gỡ rồi cắm
 *                          lại"** nhận về một tài khoản KHÔNG có chìa làm mới,
 *                          trong khi lần cắm đầu thì tốt. Hỏng ở lần thứ hai,
 *                          không hỏng ở lần đầu — không ai nối được nguyên nhân.
 *
 * `include_granted_scopes=true` là thứ **thứ ba**, cho tương lai: nó cho phép
 * cắm thêm Drive/Gmail sau này mà **cộng dồn** quyền vào cùng một chìa thay vì
 * thay thế. Bật sẵn ở spike để đo xem Google có nuốt tham số này không.
 */
function authorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scope: string;
}): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    scope: p.scope,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  }).toString();
  return u.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * `postToken` — bản của spike, khác bản sản phẩm **đúng một dòng**:
 * `client_secret`. Giữ nguyên ba bài học đã trả giá ở `oauth.ts §postToken`:
 *   ① `accept: application/json` (GitHub trả form-urlencoded nếu thiếu)
 *   ② phân loại theo **thân** trước, `res.ok` chỉ là tín hiệu phụ
 *   ③ 200 mà không có `access_token` **cũng là hỏng** — nếu không thì hạ nguồn
 *      cất một tài khoản rỗng đè lên tài khoản đang chạy tốt, im lặng.
 */
async function postToken(form: Record<string, string>, step: string): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  const body = await res.text();
  let json: TokenResponse | null = null;
  try {
    json = JSON.parse(body) as TokenResponse;
  } catch {
    /* thân không phải JSON */
  }
  if (json?.error) {
    throw new Error(`[${step}] ${json.error}${json.error_description ? ` — ${json.error_description}` : ''}`);
  }
  if (!json?.access_token) {
    throw new Error(`[${step}] HTTP ${res.status}, không có access_token: ${body.slice(0, 300)}`);
  }
  return json;
}

/**
 * Bóc `id_token` **không kiểm chữ ký** — và đó là quyết định, không phải cẩu thả.
 *
 * Token này về thẳng từ `oauth2.googleapis.com` qua TLS trong cùng lời gọi ta
 * vừa gửi (OIDC Core §3.1.3.7 miễn kiểm chữ ký đúng ca này). Ta chỉ dùng nó để
 * lấy **hạt giống định danh** cho tên chìa, không dùng để cấp quyền cho ai.
 *
 * 📌 Vì sao đáng làm: nó xoá bug lượt-lạnh 28/08 (`probeIdentity` gọi `get_me`
 * bằng chìa vừa đúc, vượt trần 10 giây ⇒ `accountName` rỗng ⇒ tài khoản thứ hai
 * ghi đè tài khoản thứ nhất, im lặng). Không có lời gọi mạng thì không có trần
 * để vượt.
 */
function idClaims(idToken?: string): { sub?: string; email?: string } {
  if (!idToken) return {};
  const mid = idToken.split('.')[1];
  if (!mid) return {};
  try {
    const j = JSON.parse(Buffer.from(mid, 'base64url').toString('utf8')) as {
      sub?: string;
      email?: string;
    };
    return { sub: j.sub, email: j.email };
  } catch {
    return {};
  }
}

async function cmdLogin(kind: ClientKind, tier: Tier, noSecret = false): Promise<void> {
  const app = loadClient(kind);
  say(`═══ Q1+Q2 · Đăng nhập · client=${kind} · nấc=${tier}${noSecret ? ' · KHÔNG gửi secret' : ''} ═══\n`);

  const lb = await loopback(kind === 'web' ? (app.port ?? 8765) : undefined);
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const scope = SCOPES[tier].join(' ');

  const url = authorizeUrl({ clientId: app.client_id, redirectUri: lb.redirectUri, state, challenge, scope });
  say(`redirect_uri : ${lb.redirectUri}`);
  if (kind === 'web') {
    say('⚠ Client Web: chuỗi trên PHẢI có sẵn trong "Authorized redirect URIs" của Cloud Console,');
    say('  khớp từng ký tự. Sai một ký tự ⇒ `redirect_uri_mismatch`.');
  }
  say(`scope        : ${SCOPES[tier].map((s) => s.replace('https://www.googleapis.com/auth/', '')).join(' · ')}`);
  say('\nMở trình duyệt… (nếu không tự mở, dán URL dưới đây)\n');
  say(url);
  openBrowser(url);

  const code = await lb.wait(state);
  lb.close();

  const t = await postToken(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: lb.redirectUri,
      client_id: app.client_id,
      /**
       * 🔴 DÒNG DUY NHẤT `oauth.ts` KHÔNG CÓ. Cả mục Google tồn tại hay không nằm ở đây.
       *
       * `--no-secret` đo một câu đắt hơn nó trông: **có BẮT BUỘC phải ship secret không?**
       * `token_endpoint_auth_methods_supported` của Google không khai `none`, nhưng đó là
       * lời khai cho client **confidential**; client kiểu Desktop là **installed app**, và
       * 🌐 chính Google viết *"the client secret is obviously not treated as a secret"*.
       * Nếu Google nhận PKCE mà không cần secret ⇒ ta ship **0 bí mật**, đúng thế đứng của
       * GitHub device flow, và toàn bộ rủi ro "secret nằm trong repo public" biến mất.
       *
       * ⚠ Chạy riêng một lượt `--login --no-secret`, ĐỪNG thử-rồi-lặp trong cùng một lượt:
       * mã uỷ quyền dùng một lần, một lượt hỏng có thể đốt nó ⇒ lượt sau trả `invalid_grant`
       * và ta đọc nhầm thành *"bắt buộc phải có secret"*. Một phép đo sai còn tệ hơn không đo.
       */
      ...(noSecret ? {} : { client_secret: app.client_secret }),
      code_verifier: verifier,
    },
    noSecret ? 'đổi mã (KHÔNG secret)' : 'đổi mã',
  );

  const who = idClaims(t.id_token);
  const acc: Account = {
    kind,
    tier,
    client_id: app.client_id,
    access_token: t.access_token as string,
    refresh_token: t.refresh_token,
    expires_at: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
    token_type: t.token_type ?? 'Bearer',
    scope: t.scope,
    sub: who.sub,
    email: who.email,
    refreshed: 0,
    first_login_at: new Date().toISOString(),
  };
  saveAccount(acc);

  say('\n─── Kết quả ───');
  say(`access_token   : ${mask(acc.access_token)}`);
  say(`refresh_token  : ${acc.refresh_token ? mask(acc.refresh_token) : '🔴 KHÔNG CÓ'}`);
  say(`hết hạn sau    : ${acc.expires_at ? `${Math.round((acc.expires_at - Date.now()) / 60000)} phút` : '—'}`);
  say(`scope Google cấp: ${(acc.scope ?? '—').replace(/https:\/\/www\.googleapis\.com\/auth\//g, '')}`);
  say(`id_token → sub : ${acc.sub ?? '🔴 không có'}   email: ${acc.email ?? '—'}`);
  say('');
  if (!acc.refresh_token) {
    say('🔴 Q2 HỎNG: không có refresh_token dù đã gửi `access_type=offline`.');
    say('   Nghi phạm số 1: tài khoản này đã đồng ý cho app trước đó và `prompt=consent` bị nuốt.');
  } else {
    say('🟢 Q2 (nửa đầu): có refresh_token. Chạy `--refresh` để đo tuổi thọ và xem nó có XOAY không.');
  }
  if (!acc.sub) {
    say('⚠ Không bóc được `id_token` ⇒ danh tính phải lấy bằng một lời gọi mạng, và bug lượt-lạnh 28/08 quay lại.');
  } else {
    say('🟢 Danh tính lấy được **không tốn lời gọi mạng nào** — vá sẵn bug lượt-lạnh 28/08.');
  }
}

/**
 * Q2 (nửa sau) — ba câu trong một lệnh:
 *   ① làm mới có bắt buộc `client_secret` không (thử KHÔNG gửi trước)
 *   ② Google có **XOAY** refresh token không (Notion có, GitHub không — và dấu
 *      `??` ở `applyToken` sinh ra từ đúng khác biệt đó)
 *   ③ chìa mới sống bao lâu
 */
async function cmdRefresh(kind: ClientKind, tier: Tier): Promise<void> {
  const app = loadClient(kind);
  const acc = loadAccount(kind, tier);
  if (!acc.refresh_token) throw new Error('Tài khoản này không có refresh_token — chạy `--login` lại.');

  say(`═══ Q2 · Làm mới · client=${kind} · nấc=${tier} ═══\n`);

  // ① Thử KHÔNG secret — để biết câu lỗi trông thế nào, thay vì đoán.
  try {
    await postToken(
      { grant_type: 'refresh_token', refresh_token: acc.refresh_token, client_id: app.client_id },
      'làm mới KHÔNG secret',
    );
    say('🟢 Làm mới KHÔNG cần client_secret — bất ngờ, và nó nới rộng đường đi của ta.');
  } catch (e) {
    say(`⛔ Làm mới không secret → ${(e as Error).message}`);
    say('   ⇒ đúng dự đoán: `refreshAccount` của sản phẩm phải mang secret.');
  }

  const t = await postToken(
    {
      grant_type: 'refresh_token',
      refresh_token: acc.refresh_token,
      client_id: app.client_id,
      client_secret: app.client_secret,
    },
    'làm mới',
  );

  const xoay = Boolean(t.refresh_token && t.refresh_token !== acc.refresh_token);
  acc.access_token = t.access_token as string;
  if (t.refresh_token) acc.refresh_token = t.refresh_token;
  acc.expires_at = t.expires_in ? Date.now() + t.expires_in * 1000 : undefined;
  acc.refreshed = (acc.refreshed ?? 0) + 1;
  saveAccount(acc);

  say('\n─── Kết quả ───');
  say(`access_token mới : ${mask(acc.access_token)}`);
  say(`Google trả refresh mới? ${t.refresh_token ? (xoay ? '🔄 CÓ, và KHÁC cái cũ (xoay)' : 'có, y hệt cũ') : 'không'}`);
  say(`sống thêm        : ${acc.expires_at ? `${Math.round((acc.expires_at - Date.now()) / 60000)} phút` : '—'}`);
  say(`đã làm mới       : ${acc.refreshed} lần`);
  say('');
  say('📌 Đo tuổi thọ THẬT của refresh token cần THỜI GIAN, không cần mã:');
  say(`   chạy lại lệnh này sau 8 ngày. App ở publishing status "Testing" + External`);
  say(`   sẽ chết đúng ngày thứ 7 với \`invalid_grant\` — đó là ca ta PHẢI chặn bằng wizard.`);
}

/** Chìa còn hạn thì dùng, hết hạn thì tự làm mới — để mọi lệnh khác khỏi lặp lại. */
async function freshToken(kind: ClientKind, tier: Tier): Promise<Account> {
  const acc = loadAccount(kind, tier);
  if (acc.expires_at && acc.expires_at - Date.now() > 60_000) return acc;
  if (!acc.refresh_token) return acc;
  const app = loadClient(kind);
  const t = await postToken(
    {
      grant_type: 'refresh_token',
      refresh_token: acc.refresh_token,
      client_id: app.client_id,
      client_secret: app.client_secret,
    },
    'làm mới (tự động)',
  );
  acc.access_token = t.access_token as string;
  if (t.refresh_token) acc.refresh_token = t.refresh_token;
  acc.expires_at = t.expires_in ? Date.now() + t.expires_in * 1000 : undefined;
  saveAccount(acc);
  return acc;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ Q3 · Q5 · Q6 · Q7 — gọi thật một tool
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bốn câu cùng đi qua một lời gọi, và **mã lỗi phân biệt được cả bốn**:
 *
 *   Q3 app lạ bị khoá     → `PERMISSION_DENIED` nói về client/consumer
 *   Q5 Gmail cá nhân      → lỗi nói về Workspace / Developer Preview
 *   Q6 hàng rào scope     → `create_event` bằng chìa đọc phải bị TỪ CHỐI
 *   Q7 chưa bật API       → 403 `SERVICE_DISABLED`, kèm link bật
 *
 * ⇒ In **NGUYÊN VĂN** thân lỗi. Đây là lần duy nhất rẻ để thu thập chúng, và
 * chính chúng là nguyên liệu cho câu dịch tiếng Việt sau này (§5h·7f — bài học
 * `githubDoorError`: một câu lỗi sai cửa đắt hơn không có câu nào).
 */
async function cmdCall(tool: string, kind: ClientKind, tier: Tier): Promise<void> {
  const acc = await freshToken(kind, tier);
  say(`═══ Gọi thật · ${tool} · client=${kind} · nấc=${tier} ═══\n`);
  say(`tài khoản: ${acc.email ?? acc.sub ?? '—'}`);

  const args: Record<string, Record<string, unknown>> = {
    list_calendars: {},
    list_events: { pageSize: 3 },
    create_event: {
      // ⚠ Cố ý là một sự kiện VÔ HẠI trong quá khứ gần, và nói rõ trong tiêu đề
      // rằng nó do spike tạo — nếu nó lọt qua thì người dùng nhận ra ngay.
      summary: 'agentco spike — xoá được',
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 90_000_000).toISOString(),
    },
  };

  const r = await mcpRaw('tools/call', { name: tool, arguments: args[tool] ?? {} }, { token: acc.access_token });
  say(`\nHTTP ${r.status}`);
  const wa = r.headers.get('www-authenticate');
  if (wa) say(`WWW-Authenticate: ${wa}`);
  say('\n─── Thân, NGUYÊN VĂN (cắt 1 500 ký tự) ───');
  say(r.body.slice(0, 1500));

  say('\n─── Đọc kết quả ───');
  if (r.status === 200 && !JSON.stringify(r.json).includes('"isError":true')) {
    say('🟢 CHẠY. ⇒ Q3 đóng: `calendarmcp` NHẬN chìa của app do khách tự đăng ký.');
    if (tier === 'read' && tool === 'create_event') {
      say('🔴🔴 NHƯNG ĐÂY LÀ CA XẤU: chìa chỉ-đọc GHI ĐƯỢC ⇒ scope KHÔNG phải hàng rào.');
    }
  } else if (tier === 'read' && tool === 'create_event') {
    say('🟢 Q6 đóng: chìa chỉ-đọc bị TỪ CHỐI ⇒ hàng rào nằm ở **scope của Google**,');
    say('   tức ngoài tầm với của mọi thứ chạy trên máy khách — mạnh hơn `allowedTools` của ta.');
  } else {
    say('⚠ Hỏng. Đọc thân ở trên để xếp vào Q3 (app lạ) / Q5 (loại tài khoản) / Q7 (chưa bật API).');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ --setup và --report
// ─────────────────────────────────────────────────────────────────────────────

function cmdSetup(): void {
  say('═══ Cần bạn làm gì trước khi spike chạy được ═══\n');
  say('① console.cloud.google.com → tạo project mới (ví dụ `agentco-spike`).');
  say('');
  say('② "APIs & Services" → bật **Google Calendar API** (`calendar-json.googleapis.com`).');
  say('   ⛔ KHOAN bật **Calendar MCP API** (`calendarmcp.googleapis.com`).');
  say('      Lý do: Q7 cần đo câu lỗi "chưa bật API" TRƯỚC. Bỏ lỡ khoảnh khắc đó là');
  say('      mất một câu lỗi ta sẽ phải đoán lại khi viết bản dịch tiếng Việt.');
  say('');
  say('③ "OAuth consent screen":');
  say('   · Workspace org  → chọn **Internal** (không verification, không hạn 7 ngày)');
  say('   · Gmail cá nhân  → chọn **External**, thêm CHÍNH BẠN vào Test users');
  say('     ⚠ Để nguyên "Testing" lúc này — ta đang muốn đo cả ca 7 ngày.');
  say('');
  say('④ "Credentials" → tạo client **Desktop app**. Hết. Không có ô redirect nào để điền —');
  say('   🌐 *"The console does not require any additional information to create OAuth 2.0');
  say('   credentials for desktop applications."* Loopback muốn cổng nào cũng được, và');
  say('   🌐 luồng này *"will continue to be supported on desktop apps"* (chỉ iOS/Android/');
  say('   Chrome bị khai tử).');
  say('   ⚠ CHỈ tạo thêm **Web application** (redirect `http://localhost:8765/callback`)');
  say('     NẾU Desktop hỏng ở Q1 — đó là đối chứng, không phải bước bắt buộc.');
  say('');
  say(`⑤ Điền chìa vào ${CLIENTS} — ⚠ **ĐỪNG DÁN VÀO KHUNG CHAT**:`);
  say('   thư mục `.state-spike/` đã nằm trong `.gitignore`, còn khung chat thì nằm');
  say('   trong transcript vĩnh viễn (bài học 28/08: mật khẩu database lọt transcript');
  say('   ⇒ phải xoay). Dán vào file, tôi chỉ đọc sự tồn tại của nó.');
  say('');
  say(JSON.stringify(
    {
      desktop: { client_id: '….apps.googleusercontent.com', client_secret: 'GOCSPX-…' },
      web: { client_id: '….apps.googleusercontent.com', client_secret: 'GOCSPX-…', port: 8765 },
    },
    null,
    2,
  ));
  say('');
  const have = readJson<Record<string, ClientApp>>(CLIENTS);
  say(`Trạng thái file: ${have ? `✅ đọc được — có khoá: ${Object.keys(have).join(', ')}` : '❌ chưa có'}`);
}

function cmdReport(): void {
  const s = readStore();
  say('═══ Đã đo được gì ═══\n');
  if (!Object.keys(s).length) {
    say('Chưa có tài khoản nào. Chạy `--setup` trước.');
    return;
  }
  for (const [k, a] of Object.entries(s)) {
    say(`─── ${k} ───`);
    say(`  tài khoản      : ${a.email ?? a.sub ?? '—'}`);
    say(`  refresh_token  : ${a.refresh_token ? '✅' : '🔴 không có'}`);
    say(`  đã làm mới     : ${a.refreshed ?? 0} lần`);
    say(`  đăng nhập lần đầu: ${a.first_login_at ?? '—'}`);
    if (a.first_login_at) {
      const ngày = (Date.now() - Date.parse(a.first_login_at)) / 86_400_000;
      say(`  tuổi chìa      : ${ngày.toFixed(1)} ngày${ngày > 7 ? '  ← đã qua mốc 7 ngày' : ''}`);
    }
    say(`  scope          : ${(a.scope ?? '—').replace(/https:\/\/www\.googleapis\.com\/auth\//g, '')}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (n: string): string | undefined => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (n: string): boolean => argv.includes(n);

  const tier = (flag('--tier') as Tier | undefined) ?? 'read';
  const kind = (flag('--client') as ClientKind | undefined) ?? 'desktop';
  if (tier !== 'read' && tier !== 'full') throw new Error('--tier phải là `read` hoặc `full`');
  if (kind !== 'desktop' && kind !== 'web') throw new Error('--client phải là `desktop` hoặc `web`');

  if (has('--setup')) return cmdSetup();
  if (has('--report')) return cmdReport();
  if (has('--discover')) return cmdDiscover();
  if (has('--tools')) return cmdTools(has('--tier') ? tier : null, kind);
  if (has('--login')) return cmdLogin(kind, tier, has('--no-secret'));
  if (has('--refresh')) return cmdRefresh(kind, tier);
  if (has('--call')) {
    const tool = flag('--call');
    if (!tool) throw new Error('--call cần tên tool, ví dụ: --call list_calendars');
    return cmdCall(tool, kind, tier);
  }

  say('Xem khối chú thích đầu file để biết bảy câu spike này đóng.');
  say('Bắt đầu ở: npx tsx scripts/spike-google-calendar.ts --setup');
}

main().catch((e: unknown) => {
  say(`\n⛔ ${(e as Error).message}`);
  process.exitCode = 1;
});
