/**
 * SPIKE — LINEAR. Đóng bảy câu **trước** khi viết `arms/linear.ts`.
 * → docs/TEST-WALKTHROUGH.md bài 19 · SPEC-arms §4e · SESSIONS_MEMORY §5x
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ FILE NÀY IMPORT `src/core/oauth.ts` VÀ `src/core/probe.ts`. CỐ Ý — và     │
 * │ nó NGƯỢC với `spike-notion-oauth.ts`.                                    │
 * │                                                                          │
 * │ Spike Notion (24/08) viết KHI CHƯA CÓ `oauth.ts`, nên nó tự cài lấy mọi  │
 * │ thứ — nó là bản nháp mà `oauth.ts` sinh ra từ đó. Spike này hỏi một câu   │
 * │ khác hẳn: **mã ĐANG CHẠY có nuốt được Linear mà không sửa dòng nào không?**│
 * │ Chép lại luồng OAuth ở đây là trả lời câu hỏi khác — nó chứng minh *"một* │
 * │ *cách viết nào đó chạy được"*, chứ không chứng minh *"CÁCH CỦA TA chạy    │
 * │ được"*. Nên mọi bước OAuth dưới đây gọi thẳng hàm thật.                   │
 * │                                                                          │
 * │ ⇒ Spike này ĐỎ ở bước nào thì đó là một dòng phải sửa trong `src/`, và   │
 * │ nó tự chỉ ra dòng nào.                                                    │
 * │                                                                          │
 * │ ⚠ KHÔNG import `@anthropic-ai/claude-agent-sdk`. Luật §5r vẫn đứng: lõi   │
 * │ không cưới hãng nào. Phần MCP dưới đây là `fetch` trần + JSON-RPC.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Nguồn sự thật là TÀI LIỆU LINEAR, không phải tài liệu Claude:
 *   🌐 linear.app/docs/mcp
 *
 * ── BẢY CÂU, mỗi câu đều có thể đổi thiết kế ────────────────────────────────
 *
 *   Q1  `oauth.ts` chạy được với Linear KHÔNG SỬA?    ← câu đắt nhất
 *   Q2  Bao nhiêu việc, tên gì, nặng bao nhiêu token? ← §4d tiêu chí 5 chặn nếu thiếu
 *   Q3  `/mcp/readonly` cắt đi những việc nào?
 *   Q4  `annotations` cho ra MẤY NẤC — 2 hay 3?       ← quyết bộ chọn nấc
 *   Q5  scope `read` có chặn ở TẦNG CHÌA không?       ← ô D-2 của bài 19
 *   Q6  refresh token có về không, và có XOAY không?
 *   Q7  hai workspace cùng lúc được không?
 *
 * ── SỐ ĐO ĐÃ CÓ 29/08 (fetch trần, chưa đăng nhập) ──────────────────────────
 *
 *   POST /register  client_name="agentco" auth="none"  → 201, KHÔNG client_secret
 *   POST /mcp       chưa chìa                          → 401 + WWW-Authenticate đúng sách
 *   token_endpoint_auth_methods_supported: [basic, post, none]   ⇒ public client OK
 *   scopes_supported: read · write
 *
 * ── CHẠY ────────────────────────────────────────────────────────────────────
 *
 *   npx tsx scripts/spike-linear-oauth.ts                  đăng nhập (xin read+write)
 *   npx tsx scripts/spike-linear-oauth.ts --scope read     đăng nhập CHỈ xin read   (Q5)
 *   npx tsx scripts/spike-linear-oauth.ts --as b           tài khoản thứ hai        (Q7)
 *   npx tsx scripts/spike-linear-oauth.ts --tools          chỉ tools/list, cả 2 URL (Q2·Q3·Q4)
 *   npx tsx scripts/spike-linear-oauth.ts --refresh        chỉ thử làm mới          (Q6)
 *   npx tsx scripts/spike-linear-oauth.ts --no-browser     in URL ra, tự dán
 *
 * Chi phí: **$0** — không gọi model một lần nào.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** ⭐ Q1 sống hoặc chết ở đúng tám cái tên này. */
import {
  authorizeUrl,
  CLIENT_NAME,
  discover,
  exchangeCode,
  pkce,
  randomState,
  refreshAccount,
  register,
  type AsMeta,
  type OAuthAccount,
} from '../src/core/oauth.js';
/** ⭐ Nấc quyền KHÔNG được tính lại ở đây — dùng đúng hàm sản phẩm dùng. */
import { levelOf, offeredTiers, tierOf, TIERS, type ProbedTool } from '../src/core/probe.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Hai URL, và **cặp này là toàn bộ lý do Linear đáng làm hơn Notion**.
 * `/mcp` phơi mọi việc; `/mcp/readonly` server tự cắt việc ghi.
 * → `catalog.ts` sẽ cần một ô `readOnlyUrl` cạnh `readOnlyHeaders` sẵn có.
 */
const MCP_URL = 'https://mcp.linear.app/mcp';
const MCP_URL_READONLY = 'https://mcp.linear.app/mcp/readonly';

/** Kho chìa của SPIKE — KHÔNG phải `company/.state/secrets.json`. Chạy thử không đụng chìa thật. */
const STORE = path.join(HERE, '..', '.state-spike', 'linear-oauth.json');

type Store = { accounts: Record<string, OAuthAccount & { scope_asked?: string }> };

const readStore = (): Store => {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8')) as Store;
  } catch {
    return { accounts: {} };
  }
};

const writeStore = (s: Store): void => {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(s, null, 2));
};

// ─────────────────────────────────────────────────────────── MCP qua fetch trần

/**
 * Streamable HTTP trả **một trong hai** hình dạng cho cùng một lời gọi: JSON
 * thường, hoặc SSE (`event: message\ndata: {...}`). Chọn theo `content-type`
 * chứ không đoán theo ký tự đầu — thân SSE cũng bắt đầu bằng chữ cái.
 *
 * ⚠ `Mcp-Session-Id` phải vọng lại từ lời gọi thứ hai trở đi. Thiếu nó thì
 * `tools/list` trả 400 "no session", và câu lỗi đó **không** nhắc gì tới phiên.
 */
async function rpc(
  url: string,
  token: string | null,
  method: string,
  params: unknown,
  session: { id?: string },
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(session.id ? { 'mcp-session-id': session.id } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) session.id = sid;

  const text = await res.text();
  if (!text.trim()) return { status: res.status, body: null };

  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    // Lấy `data:` CUỐI CÙNG: server được phép gửi nhiều sự kiện, kết quả ở cái chốt.
    const last = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .pop();
    return { status: res.status, body: last ? JSON.parse(last.slice(5).trim()) : null };
  }
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

interface RawTool {
  name: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
  inputSchema?: unknown;
}

/** Bắt tay + `tools/list`. Trả cả tool THÔ (để đếm byte) lẫn tool đã giải nấc. */
async function listTools(
  url: string,
  token: string,
): Promise<{ raw: RawTool[]; probed: ProbedTool[]; bytes: number } | { error: string }> {
  const session: { id?: string } = {};
  const init = await rpc(
    url,
    token,
    'initialize',
    {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: CLIENT_NAME, version: '1' },
    },
    session,
  );
  if (init.status !== 200) return { error: `initialize → HTTP ${init.status} ${JSON.stringify(init.body).slice(0, 200)}` };

  // Bắt buộc theo spec MCP; bỏ qua thì một số server treo ở `tools/list`.
  await rpc(url, token, 'notifications/initialized', {}, session);

  const r = await rpc(url, token, 'tools/list', {}, session);
  if (r.status !== 200) return { error: `tools/list → HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}` };

  const raw = ((r.body as { result?: { tools?: RawTool[] } })?.result?.tools ?? []) as RawTool[];
  const probed: ProbedTool[] = raw.map((t) => {
    // ⚠ Cùng phép suy `probe.ts` dùng: `openWorldHint` → `openWorld`.
    const ann = t.annotations
      ? {
          ...(t.annotations.readOnlyHint !== undefined ? { readOnly: t.annotations.readOnlyHint } : {}),
          ...(t.annotations.destructiveHint !== undefined ? { destructive: t.annotations.destructiveHint } : {}),
          ...(t.annotations.openWorldHint !== undefined ? { openWorld: t.annotations.openWorldHint } : {}),
        }
      : undefined;
    return {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      level: levelOf(ann),
      tier: tierOf(ann),
    };
  });
  return { raw, probed, bytes: Buffer.byteLength(JSON.stringify(raw), 'utf8') };
}

// ─────────────────────────────────────────────────────── đăng nhập (Q1 · Q7)

/** Mở trình duyệt theo hệ điều hành. → [[agentco-three-os-always]] */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? // ⚠ KHÔNG `cmd /c start`: nó cắt URL ở dấu `&` đầu tiên — bug 24/08,
        // và URL OAuth luôn có ≥4 dấu `&`. `rundll32` nuốt nguyên chuỗi.
        (['rundll32', ['url.dll,FileProtocolHandler', url]] as const)
      : process.platform === 'darwin'
        ? (['open', [url]] as const)
        : (['xdg-open', [url]] as const);
  spawn(cmd, [...args], { detached: true, stdio: 'ignore' }).unref();
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 CỔNG PHẢI ĐẾN TỪ CHÍNH SOCKET SẼ NGHE. (bug user gặp 29/08, lượt đầu) │
 * │                                                                          │
 * │ Bản đầu mở một server **thăm dò** với `listen(0)` để xin một cổng rảnh,   │
 * │ đọc số cổng, **đóng nó**, dựng `redirect_uri` từ số đó, rồi mở server     │
 * │ thật bằng `listen(0)` **lần nữa** — và lần nữa nghĩa là **một cổng khác**.│
 * │ Trình duyệt quay về đúng cổng đã đăng ký, chỗ đó không còn ai nghe:       │
 * │ *"127.0.0.1 refused to connect"*. Rồi bấm lại thì `state` đã tiêu ⇒       │
 * │ *"invalid state"* — triệu chứng thứ hai che mất nguyên nhân thứ nhất.     │
 * │                                                                          │
 * │ ⇒ Lớp lỗi: **đo một tài nguyên rồi thả ra, và tin rằng phép đo còn đúng.**│
 * │ Cùng họ với `mtime` đọc trước khi ghi. Không có `catch` nào bắt được nó — │
 * │ mọi lời gọi đều thành công, chỉ có hai con số không phải một.            │
 * │                                                                          │
 * │ ⇒ Sửa bằng CẤU TRÚC, không bằng kỷ luật: server nghe TRƯỚC, `redirect_uri`│
 * │ suy RA TỪ nó. Không còn hai socket thì không còn gì để lệch.             │
 * │ (`oauth-routes.ts` của sản phẩm vốn đã đúng — nó giữ một server sống.)   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
async function startCallback(): Promise<{
  port: number;
  wait: (state: string) => Promise<string>;
  close: () => void;
}> {
  let expected = '';
  let ok: ((c: string) => void) | undefined;
  let no: ((e: Error) => void) | undefined;
  /** Callback về TRƯỚC khi `wait()` được gọi — hiếm, nhưng mất nó là treo vĩnh viễn. */
  let early: { code?: string; state?: string; err?: string } | undefined;

  const settle = (code?: string, got?: string, err?: string): void => {
    if (!ok || !no) {
      early = { code, state: got, err };
      return;
    }
    if (err) no(new Error(`Linear từ chối: ${err}`));
    else if (!code) no(new Error('callback không mang `code`'));
    else if (got !== expected) no(new Error('`state` không khớp — lượt cũ, hoặc bị chen giữa'));
    else ok(code);
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!u.pathname.startsWith('/callback')) {
      res.writeHead(404).end();
      return;
    }
    const code = u.searchParams.get('code') ?? undefined;
    const got = u.searchParams.get('state') ?? undefined;
    const err = u.searchParams.get('error') ?? undefined;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      code && !err
        ? '<h2>Xong. Quay lại terminal.</h2>'
        : `<h2>Hỏng</h2><pre>${err ?? 'callback thiếu code'}</pre>`,
    );
    settle(code, got, err);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

  return {
    port: (server.address() as { port: number }).port,
    wait: (state: string) =>
      new Promise<string>((res, rej) => {
        expected = state;
        ok = res;
        no = rej;
        if (early) settle(early.code, early.state, early.err);
      }),
    close: () => server.close(),
  };
}

async function login(as: string, scope: string, noBrowser: boolean): Promise<OAuthAccount> {
  console.log(`\n━━ Q1 · ĐĂNG NHẬP "${as}"   scope xin: ${scope}\n`);

  // ① discover — hàm thật.
  const meta: AsMeta | null = await discover(MCP_URL);
  if (!meta) {
    throw new Error(
      '🔴 Q1 ĐỎ ở bước ①: `discover()` trả null ⇒ nó tưởng Linear "không cần đăng nhập". ' +
        'Đây đúng lớp lỗi §5u ③ (xanh giả). Sửa `oauth.ts:194`.',
    );
  }
  console.log('  ① discover      ✅', meta.issuer, '·', meta.registration_endpoint ? 'có DCR' : '🔴 KHÔNG DCR');

  // ⚠ Server phải NGHE TRƯỚC khi đăng ký: DCR gắn `client_id` với đúng một
  // `redirect_uri`, nên số cổng phải đến từ chính socket sẽ nhận callback.
  // → khối chú thích ở `startCallback`.
  const cb = await startCallback();
  const redirectUri = `http://127.0.0.1:${cb.port}/callback`;
  console.log('  ⓪ cổng loopback ✅', cb.port, '— đang nghe');

  // ② register — hàm thật. Đây là chỗ Figma trả 403.
  const clientId = await register(meta, redirectUri);
  console.log('  ② register      ✅ client_id =', clientId);

  // ③ PKCE + URL — hàm thật.
  const { verifier, challenge } = pkce();
  const state = randomState();
  const url = authorizeUrl(meta, { clientId, redirectUri, state, challenge, scope });
  console.log('  ③ authorizeUrl  ✅');
  console.log(`     ⚠ KIỂM BẰNG MẮT: URL phải có ĐỦ client_id & state & code_challenge & scope=${scope}`);
  console.log(`     ${url}\n`);

  const waiter = cb.wait(state);
  if (noBrowser) console.log('  👉 Dán URL trên vào trình duyệt.');
  else openBrowser(url);
  console.log('  ⏳ Đang chờ bạn bấm Authorize...');

  let code: string;
  try {
    code = await waiter;
  } finally {
    // Đóng dù thành công hay hỏng — một cổng còn nghe sau khi luồng chết là
    // thứ làm lần chạy SAU nhận nhầm callback của lần này.
    cb.close();
  }

  // ④ exchangeCode — hàm thật.
  const acc = await exchangeCode(meta, { clientId, code, redirectUri, verifier, mcpUrl: MCP_URL });
  console.log('  ④ exchangeCode  ✅');

  const s = readStore();
  s.accounts[as] = { ...acc, scope_asked: scope };
  writeStore(s);

  console.log('\n  ┌─ Q1 · KẾT QUẢ');
  console.log('  │ access_token   ', acc.access_token ? `✅ ${acc.access_token.length} ký tự` : '🔴 KHÔNG CÓ');
  console.log(
    '  │ refresh_token  ',
    acc.refresh_token ? '✅ CÓ' : '🔴 KHÔNG — Q6 chết, chìa hết hạn là bắt đăng nhập lại',
  );
  console.log('  │ expires_at     ', acc.expires_at ? new Date(acc.expires_at).toISOString() : '(không hết hạn)');
  console.log('  │ scope ĐƯỢC CẤP ', acc.scope ?? '(server không nói)');
  console.log('  │ label          ', acc.label ?? '(exchangeCode không tìm ra tên workspace)');
  console.log('  └─');
  if (acc.scope && scope && acc.scope !== scope) {
    console.log(`  ⚠ XIN "${scope}" NHƯNG ĐƯỢC "${acc.scope}" — ghi lại, nó đổi cách ta hiện nấc.`);
  }
  return acc;
}

// ─────────────────────────────────────────────── Q2 · Q3 · Q4 · Q5

function dumpTools(label: string, r: { raw: RawTool[]; probed: ProbedTool[]; bytes: number }): void {
  const tok = Math.round(r.bytes / 4);
  console.log(`\n━━ ${label}   ${r.raw.length} việc · ${r.bytes} byte ≈ ${tok} token`);
  const noAnn = r.raw.filter((t) => !t.annotations).length;
  console.log(
    `   annotations: ${r.raw.length - noAnn}/${r.raw.length} có` +
      (noAnn ? `  🔴 ${noAnn} việc KHÔNG khai ⇒ mặc định từ chối ⇒ rơi xuống nấc \`full\`` : ''),
  );
  for (const t of r.probed) {
    console.log(`   ${t.tier.padEnd(5)} ${t.level.padEnd(15)} ${t.name}`);
  }
}

/**
 * Q4 — bộ chọn nấc sẽ hiện ra như thế nào.
 *
 * ⚠ Gọi ĐÚNG `offeredTiers` của sản phẩm, không đếm tay: luật *"chỉ hiện nấc
 * nào thêm ≥1 việc"* nằm trong đó, và chính luật ấy là thứ đẻ ra bẫy 27/08.
 */
function dumpTiers(probed: ProbedTool[]): void {
  const offered = offeredTiers(probed);
  console.log(`\n━━ Q4 · BỘ CHỌN NẤC — người dùng sẽ thấy ${offered.length} nấc`);
  for (const o of offered) console.log(`   ◉ ${o.tier.padEnd(5)} ${o.count} việc`);
  const missing = TIERS.filter((t) => !offered.some((o) => o.tier === t));
  if (missing.length) console.log(`   (ẩn: ${missing.join(', ')} — không thêm việc nào so với nấc dưới)`);
  if (offered.length <= 1) {
    console.log(
      '   🔴🔴 CHỈ MỘT NẤC ⇒ bộ chọn KHÔNG HIỆN ⇒ người dùng bị khoá ở nấc thấp nhất.\n' +
        '        Nếu con số này đến từ lượt gọi vào /mcp/readonly thì đó ĐÚNG bẫy 27/08:\n' +
        '        `readOnlyUrl` phải vào `serverFenced()`, không chỉ vào `buildConfig()`.',
    );
  }
}

async function tools(as: string): Promise<void> {
  const acc = readStore().accounts[as];
  if (!acc) throw new Error(`Chưa đăng nhập "${as}" — chạy không có --tools trước.`);

  const full = await listTools(MCP_URL, acc.access_token);
  if ('error' in full) throw new Error(`/mcp: ${full.error}`);
  dumpTools(`Q2 · /mcp   (chìa xin scope: ${acc.scope_asked ?? '?'} · được cấp: ${acc.scope ?? '?'})`, full);
  dumpTiers(full.probed);

  const ro = await listTools(MCP_URL_READONLY, acc.access_token);
  if ('error' in ro) {
    console.log(`\n🔴 Q3 · /mcp/readonly hỏng: ${ro.error}`);
    return;
  }
  dumpTools('Q3 · /mcp/readonly', ro);

  const gone = full.probed.filter((t) => !ro.probed.some((x) => x.name === t.name));
  console.log(`\n━━ Q3 · CHÊNH LỆCH — /readonly cắt đi ${gone.length} việc`);
  for (const t of gone) console.log(`   − ${t.tier.padEnd(5)} ${t.name}`);
  console.log(
    `   tiết kiệm ≈ ${Math.round((full.bytes - ro.bytes) / 4)} token/lượt` +
      (gone.length === 0
        ? '\n   🔴 CẮT 0 VIỆC ⇒ hai URL như nhau ⇒ `readOnlyUrl` KHÔNG mua gì.\n' +
          '      Cả lý do "Linear hơn Notion" sụp ở đây — đọc lại trước khi viết mã.'
        : ''),
  );
  const leak = gone.filter((t) => t.tier === 'read');
  if (leak.length) console.log(`   ⚠ ${leak.length} việc ĐỌC cũng bị cắt: ${leak.map((t) => t.name).join(', ')}`);

  console.log(
    '\n━━ Q5 · TẦNG CHÌA — chạy lại với `--scope read` rồi so bảng /mcp của hai lần.\n' +
      '   /mcp với chìa read-scope RA ÍT VIỆC HƠN  ⇒ Linear lọc theo scope ⇒ HAI tầng thật.\n' +
      '   RA ĐỦ như chìa write                     ⇒ chỉ có tầng URL ⇒ ô D-2 bài 19 phải hạ kỳ vọng.',
  );

  console.log('\n📋 Chép hai con số này vào bài 19 ô B-6: số việc mỗi nấc, và token của nấc mặc định.');
}

// ─────────────────────────────────────────────────────────────────── Q6

async function refresh(as: string): Promise<void> {
  const s = readStore();
  const acc = s.accounts[as];
  if (!acc) throw new Error(`Chưa đăng nhập "${as}".`);
  const meta = await discover(MCP_URL);
  if (!meta) throw new Error('discover trả null');

  const before = acc.refresh_token;
  const next = await refreshAccount(meta, acc);
  s.accounts[as] = { ...next, scope_asked: acc.scope_asked };
  writeStore(s);

  console.log('\n━━ Q6 · LÀM MỚI CHÌA');
  console.log('   access_token mới ', next.access_token !== acc.access_token ? '✅' : '⚠ y hệt cái cũ');
  console.log(
    '   refresh_token    ',
    next.refresh_token === before
      ? 'GIỮ NGUYÊN — server không xoay'
      : '🔴 ĐÃ XOAY — cái cũ chết. `applyToken` phải giữ cái mới, nếu không hỏng ở lần THỨ HAI (§oauth.ts:440)',
  );
  console.log('   ⚠ Ô đo thật nằm ở LẦN THỨ HAI. Chạy `--refresh` thêm một lần nữa ngay bây giờ.');
}

// ─────────────────────────────────────────────────────── tự kiểm (0 lượt đồng ý)

/**
 * Kiểm CƠ CHẾ loopback mà **không tiêu một lượt đồng ý của người dùng**.
 *
 * Có mặt vì bug 29/08: một lượt OAuth hỏng không rẻ — `state` cháy, `client_id`
 * cháy, và người dùng phải bấm lại. Gửi họ đi bấm một cái nút mà mình chưa biết
 * chắc đường về có ai nghe không thì **đắt hơn là không gửi**.
 * → [[agentco-wrong-door-errors]]
 */
async function selftest(): Promise<void> {
  console.log('\n━━ TỰ KIỂM · cổng loopback (không đụng Linear, không cần ai bấm)\n');
  const cb = await startCallback();
  const state = randomState();
  const waiter = cb.wait(state);
  const url = `http://127.0.0.1:${cb.port}/callback?code=GIA_LAP&state=${encodeURIComponent(state)}`;
  console.log('   cổng đang nghe :', cb.port);

  const res = await fetch(url);
  const code = await waiter;
  cb.close();

  const okPage = res.status === 200;
  const okCode = code === 'GIA_LAP';
  console.log('   trang trả về   :', okPage ? '✅ 200' : `🔴 ${res.status}`);
  console.log('   nhận được code :', okCode ? '✅ GIA_LAP' : `🔴 "${code}"`);
  console.log(
    '\n   ' +
      (okPage && okCode
        ? '✅ Cổng đo được VÀ cổng đang nghe là MỘT. Đi tiếp được.'
        : '🔴 Vẫn lệch — đừng gọi người dùng bấm Authorize.'),
  );

  // Ca ngược: `state` sai phải BỊ TỪ CHỐI, không được lọt.
  const cb2 = await startCallback();
  // ⚠ Gắn `.catch` NGAY, không đợi sau `await fetch`: promise reject trước khi
  // có người đỡ thì Node giết tiến trình vì "unhandled rejection" — và ta mất
  // đúng cái ô đang đo.
  const w2 = cb2
    .wait('state-that-cua-lan-nay')
    .then(() => false)
    .catch(() => true);
  await fetch(`http://127.0.0.1:${cb2.port}/callback?code=X&state=state-cua-lan-khac`);
  const rejected = await w2;
  cb2.close();
  console.log('   state sai bị chặn:', rejected ? '✅' : '🔴 LỌT — chốt một-lần không có tác dụng');
}

// ─────────────────────────────────────────────────────────────────── main

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (n: string): boolean => argv.includes(n);
  const val = (n: string, d: string): string => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
  };
  const as = val('--as', 'a');

  if (flag('--selftest')) return selftest();
  if (flag('--tools')) return tools(as);
  if (flag('--refresh')) return refresh(as);

  await login(as, val('--scope', 'read write'), flag('--no-browser'));
  await tools(as);
}

main().catch((e: unknown) => {
  console.error('\n🔴', (e as Error).message);
  process.exit(1);
});
