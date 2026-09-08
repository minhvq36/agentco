
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MCP_URL = 'https://calendarmcp.googleapis.com/mcp/v1';

const ISSUER = 'https://accounts.google.com';

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

const CLIENT_NAME = 'agentco';

const STORE = path.join(HERE, '..', '.state-spike', 'google-calendar.json');
const CLIENTS = path.join(HERE, '..', '.state-spike', 'google-client.json');

interface ClientApp {
  client_id: string;
  client_secret: string;
  port?: number;
}
type ClientKind = 'desktop' | 'web';

interface Account {
  kind: ClientKind;
  tier: Tier;
  client_id: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type: string;
  scope?: string;
  sub?: string;
  email?: string;
  refreshed?: number;
  first_login_at?: string;
}


const say = (s = ''): void => {
  process.stdout.write(`${s}\n`);
};

const mask = (v?: string): string =>
  v ? `${v.slice(0, 6)}…${v.slice(-4)} (${v.length} chars)` : '—';

const b64url = (b: Buffer): string => b.toString('base64url');

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
    /* Windows: chmod is a no-op */
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
      `No key yet for (${kind} · ${tier}). Run first:\n` +
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
      `No app key of kind "${kind}" in ${CLIENTS}.\n` +
        `Run \`--setup\` to see how to create that file.`,
    );
  }
  return app;
}

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
    /* can't open it, no matter — the URL was already printed, pasting it works too */
  }
}


async function cmdDiscover(): Promise<void> {
  say('═══ Q0 · The discovery door: what `discover()` says about Google ═══\n');

  const init = await mcpRaw('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: CLIENT_NAME, version: '1' },
  });
  say(`initialize          → HTTP ${init.status}${init.status === 200 ? '  ⚠ does NOT require a key' : ''}`);

  const list = await mcpRaw('tools/list', {});
  say(`tools/list          → HTTP ${list.status}${list.status === 200 ? '  ⚠ does NOT require a key' : ''}`);

  const call = await mcpRaw('tools/call', { name: 'list_calendars', arguments: {} });
  const wa = call.headers.get('www-authenticate');
  say(`tools/call          → HTTP ${call.status}`);
  say(`WWW-Authenticate    → ${wa ?? '—'}`);

  say('');
  if (init.status === 200) {
    say('🔴 CONCLUSION: `discover()` will return `null` (the `if (probe.ok) return null` line)');
    say('   ⇒ `oauth-routes.ts:219` throws "…no login needed — connect directly."');
    say('   ⇒ FALSE GREEN. The user connects and gets 401 on EVERY call.');
    say('   ⇒ The fix has to measure with a call that has an EFFECT, not a handshake.');
  }

  say('\n─── Metadata PER TOOL (`scopes_supported`) ───');
  const tools = (await toolNames()) ?? [];
  for (const t of tools) {
    const r = await fetch(`https://calendarmcp.googleapis.com/.well-known/oauth-protected-resource/${t}`)
      .then((x) => (x.ok ? (x.json() as Promise<{ scopes_supported?: string[] }>) : null))
      .catch(() => null);
    const short = (r?.scopes_supported ?? []).map((s) => s.replace('https://www.googleapis.com/auth/', ''));
    say(`  ${t.padEnd(18)} ${short.join(' · ') || '—'}`);
  }
}


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
    /* not JSON — keep `body` as-is to print, don't guess at it */
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


async function cmdTools(tier: Tier | null, kind: ClientKind): Promise<void> {
  say('═══ Q4 · CAN THE TOOL LIST BE TRIMMED ═══\n');

  const rows: { label: string; count: number; bytes: number; tokens: number }[] = [];

  const anon = await listTools();
  if (anon) {
    rows.push({ label: 'NO key', count: anon.tools.length, bytes: anon.bytes, tokens: estTokens(anon.bytes) });
    say('─── No key: what it declares ───');
    for (const t of anon.tools) {
      const a = t.annotations ?? {};
      say(
        `  ${t.name.padEnd(18)} readOnly=${String(a.readOnlyHint ?? '—').padEnd(5)} ` +
          `destructive=${String(a.destructiveHint ?? '—').padEnd(5)} ` +
          `${estTokens(JSON.stringify(t).length)} tokens`,
      );
    }
    say('');
  }

  if (tier) {
    const acc = await freshToken(kind, tier);
    const withKey = await listTools({ token: acc.access_token });
    if (withKey) {
      rows.push({
        label: `key ${tier}`,
        count: withKey.tools.length,
        bytes: withKey.bytes,
        tokens: estTokens(withKey.bytes),
      });
    }
    const tryHeader: Record<string, string>[] = [
      { 'X-MCP-Readonly': 'true' },
      { 'X-MCP-Toolsets': 'events' },
      { 'X-Goog-MCP-Toolsets': 'events' },
      { 'X-Goog-Api-Client': 'agentco' },
    ];
    for (const h of tryHeader) {
      const r = await listTools({ token: acc.access_token, headers: h });
      if (r) {
        rows.push({
          label: `key ${tier} + ${Object.keys(h)[0]}`,
          count: r.tools.length,
          bytes: r.bytes,
          tokens: estTokens(r.bytes),
        });
      }
    }
  }

  say('─── Comparison table ───');
  for (const r of rows) {
    say(`  ${r.label.padEnd(38)} ${String(r.count).padStart(2)} tools  ${String(r.bytes).padStart(7)} bytes  ≈${r.tokens} tokens`);
  }

  const base = rows[0];
  const cut = rows.find((r) => base && r.count < base.count);
  say('');
  if (cut) {
    say(`🟢 CAN BE TRIMMED: "${cut.label}" leaves ${cut.count} tools ≈${cut.tokens} tokens — the permission tier is both a fence and a token valve.`);
  } else if (rows.length > 1) {
    say('🔴 CANNOT BE TRIMMED: every path gives the same tool count.');
    say(`   ⇒ A fixed cost of ≈${base?.tokens ?? '?'} tokens EVERY TURN at EVERY TIER.`);
    say('   ⇒ This is the input for weighing the tradeoff: connect the vendor MCP as-is, or describe it ourselves via a Path B connector.');
  } else {
    say('⚠ Only measured the NO-key case so far. Re-run with `--tier read` after logging in.');
  }
}


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
        res.end(`<p>Google refused: <b>${err}</b>. Go back to the terminal.</p>`);
        fail?.(new Error(`Google returned error=${err}`));
        return;
      }
      if (!state || state !== expectState) {
        res.end('<p>state does not match — ignoring.</p>');
        fail?.(new Error('state mismatch'));
        return;
      }
      if (!code) {
        res.end('<p>No code.</p>');
        fail?.(new Error('callback had no code'));
        return;
      }
      res.end('<p>✅ Done. Close this tab and go back to the terminal.</p>');
      settle?.(code);
    });

    server.listen(fixedPort ?? 0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
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
    /* body is not JSON */
  }
  if (json?.error) {
    throw new Error(`[${step}] ${json.error}${json.error_description ? ` — ${json.error_description}` : ''}`);
  }
  if (!json?.access_token) {
    throw new Error(`[${step}] HTTP ${res.status}, no access_token: ${body.slice(0, 300)}`);
  }
  return json;
}

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
  say(`═══ Q1+Q2 · Login · client=${kind} · tier=${tier}${noSecret ? ' · NO secret sent' : ''} ═══\n`);

  const lb = await loopback(kind === 'web' ? (app.port ?? 8765) : undefined);
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const scope = SCOPES[tier].join(' ');

  const url = authorizeUrl({ clientId: app.client_id, redirectUri: lb.redirectUri, state, challenge, scope });
  say(`redirect_uri : ${lb.redirectUri}`);
  if (kind === 'web') {
    say('⚠ Web client: the string above MUST already be in "Authorized redirect URIs" in Cloud Console,');
    say('  matching character-for-character. One character off ⇒ `redirect_uri_mismatch`.');
  }
  say(`scope        : ${SCOPES[tier].map((s) => s.replace('https://www.googleapis.com/auth/', '')).join(' · ')}`);
  say('\nOpening the browser… (if it does not open on its own, paste the URL below)\n');
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
      ...(noSecret ? {} : { client_secret: app.client_secret }),
      code_verifier: verifier,
    },
    noSecret ? 'exchange code (NO secret)' : 'exchange code',
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

  say('\n─── Result ───');
  say(`access_token   : ${mask(acc.access_token)}`);
  say(`refresh_token  : ${acc.refresh_token ? mask(acc.refresh_token) : '🔴 NONE'}`);
  say(`expires in     : ${acc.expires_at ? `${Math.round((acc.expires_at - Date.now()) / 60000)} min` : '—'}`);
  say(`scope Google granted: ${(acc.scope ?? '—').replace(/https:\/\/www\.googleapis\.com\/auth\//g, '')}`);
  say(`id_token → sub : ${acc.sub ?? '🔴 none'}   email: ${acc.email ?? '—'}`);
  say('');
  if (!acc.refresh_token) {
    say('🔴 Q2 FAILED: no refresh_token even though `access_type=offline` was sent.');
    say('   Prime suspect: this account already granted the app before and `prompt=consent` got swallowed.');
  } else {
    say('🟢 Q2 (first half): has a refresh_token. Run `--refresh` to measure lifetime and see if it ROTATES.');
  }
  if (!acc.sub) {
    say('⚠ Could not decode `id_token` ⇒ identity must be fetched with a network call, and the 08/28 cold-turn bug is back.');
  } else {
    say('🟢 Identity was obtained **with zero network calls** — already fixes the 08/28 cold-turn bug.');
  }
}

async function cmdRefresh(kind: ClientKind, tier: Tier): Promise<void> {
  const app = loadClient(kind);
  const acc = loadAccount(kind, tier);
  if (!acc.refresh_token) throw new Error('This account has no refresh_token — run `--login` again.');

  say(`═══ Q2 · Refresh · client=${kind} · tier=${tier} ═══\n`);

  try {
    await postToken(
      { grant_type: 'refresh_token', refresh_token: acc.refresh_token, client_id: app.client_id },
      'refresh WITHOUT secret',
    );
    say('🟢 Refreshed WITHOUT needing client_secret — unexpected, and it widens our path.');
  } catch (e) {
    say(`⛔ Refresh without secret → ${(e as Error).message}`);
    say('   ⇒ as predicted: the product\'s `refreshAccount` must carry the secret.');
  }

  const t = await postToken(
    {
      grant_type: 'refresh_token',
      refresh_token: acc.refresh_token,
      client_id: app.client_id,
      client_secret: app.client_secret,
    },
    'refresh',
  );

  const rotated = Boolean(t.refresh_token && t.refresh_token !== acc.refresh_token);
  acc.access_token = t.access_token as string;
  if (t.refresh_token) acc.refresh_token = t.refresh_token;
  acc.expires_at = t.expires_in ? Date.now() + t.expires_in * 1000 : undefined;
  acc.refreshed = (acc.refreshed ?? 0) + 1;
  saveAccount(acc);

  say('\n─── Result ───');
  say(`new access_token : ${mask(acc.access_token)}`);
  say(`did Google return a new refresh? ${t.refresh_token ? (rotated ? '🔄 YES, and DIFFERENT from the old one (rotated)' : 'yes, identical to the old one') : 'no'}`);
  say(`extended lifetime: ${acc.expires_at ? `${Math.round((acc.expires_at - Date.now()) / 60000)} min` : '—'}`);
  say(`times refreshed  : ${acc.refreshed}`);
  say('');
  say('📌 Measuring the refresh token\'s REAL lifetime needs TIME, not code:');
  say(`   re-run this command after 8 days. An app with publishing status "Testing" + External`);
  say(`   dies right on day 7 with \`invalid_grant\` — that is the case the wizard MUST catch.`);
}

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
    'refresh (automatic)',
  );
  acc.access_token = t.access_token as string;
  if (t.refresh_token) acc.refresh_token = t.refresh_token;
  acc.expires_at = t.expires_in ? Date.now() + t.expires_in * 1000 : undefined;
  saveAccount(acc);
  return acc;
}


async function cmdCall(tool: string, kind: ClientKind, tier: Tier): Promise<void> {
  const acc = await freshToken(kind, tier);
  say(`═══ Real call · ${tool} · client=${kind} · tier=${tier} ═══\n`);
  say(`account: ${acc.email ?? acc.sub ?? '—'}`);

  const args: Record<string, Record<string, unknown>> = {
    list_calendars: {},
    list_events: { pageSize: 3 },
    create_event: {
      summary: 'agentco spike — safe to delete',
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 90_000_000).toISOString(),
    },
  };

  const r = await mcpRaw('tools/call', { name: tool, arguments: args[tool] ?? {} }, { token: acc.access_token });
  say(`\nHTTP ${r.status}`);
  const wa = r.headers.get('www-authenticate');
  if (wa) say(`WWW-Authenticate: ${wa}`);
  say('\n─── Body, VERBATIM (cut at 1,500 chars) ───');
  say(r.body.slice(0, 1500));

  say('\n─── Reading the result ───');
  if (r.status === 200 && !JSON.stringify(r.json).includes('"isError":true')) {
    say('🟢 IT RAN. ⇒ Q3 closed: `calendarmcp` ACCEPTS a key from an app the customer registered themselves.');
    if (tier === 'read' && tool === 'create_event') {
      say('🔴🔴 BUT THIS IS THE BAD CASE: a read-only key was able to WRITE ⇒ scope is NOT a fence.');
    }
  } else if (tier === 'read' && tool === 'create_event') {
    say('🟢 Q6 closed: the read-only key was DENIED ⇒ the fence lives in **Google\'s own scope**,');
    say('   i.e. beyond anything running on the client — stronger than our own `allowedTools`.');
  } else {
    say('⚠ Failed. Read the body above to sort into Q3 (unknown app) / Q5 (account type) / Q7 (API not enabled yet).');
  }
}


function cmdSetup(): void {
  say('═══ What you need to do before this spike can run ═══\n');
  say('① console.cloud.google.com → create a new project (e.g. `agentco-spike`).');
  say('');
  say('② "APIs & Services" → enable **Google Calendar API** (`calendar-json.googleapis.com`).');
  say('   ⛔ do NOT enable **Calendar MCP API** (`calendarmcp.googleapis.com`) yet.');
  say('      Why: Q7 needs to measure the "API not enabled" error FIRST. Missing that moment');
  say('      loses an error message we would otherwise have to guess at when writing the English copy.');
  say('');
  say('③ "OAuth consent screen":');
  say('   · Workspace org  → pick **Internal** (no verification, no 7-day limit)');
  say('   · Personal Gmail → pick **External**, add YOURSELF to Test users');
  say('     ⚠ Leave it on "Testing" for now — we specifically want to measure the 7-day case too.');
  say('');
  say('④ "Credentials" → create a **Desktop app** client. That\'s it. No redirect field to fill in —');
  say('    *"The console does not require any additional information to create OAuth 2.0');
  say('   credentials for desktop applications."* Loopback accepts any port, and');
  say('    this flow *"will continue to be supported on desktop apps"* (only iOS/Android/');
  say('   Chrome are being retired).');
  say('   ⚠ ONLY create an extra **Web application** client (redirect `http://localhost:8765/callback`)');
  say('     IF Desktop fails at Q1 — that is a control, not a required step.');
  say('');
  say(`⑤ Fill the key into ${CLIENTS} — ⚠ **DO NOT PASTE IT INTO THE CHAT**:`);
  say('   the `.state-spike/` folder is already in `.gitignore`, while the chat window ends up');
  say('   in the transcript forever (08/28 lesson: a database password leaked into a transcript');
  say('   ⇒ had to be rotated). Paste it into the file — I only read whether it exists.');
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
  say(`File status: ${have ? `✅ readable — has keys: ${Object.keys(have).join(', ')}` : '❌ not created yet'}`);
}

function cmdReport(): void {
  const s = readStore();
  say('═══ What has been measured so far ═══\n');
  if (!Object.keys(s).length) {
    say('No accounts yet. Run `--setup` first.');
    return;
  }
  for (const [k, a] of Object.entries(s)) {
    say(`─── ${k} ───`);
    say(`  account        : ${a.email ?? a.sub ?? '—'}`);
    say(`  refresh_token  : ${a.refresh_token ? '✅' : '🔴 none'}`);
    say(`  times refreshed: ${a.refreshed ?? 0}`);
    say(`  first login    : ${a.first_login_at ?? '—'}`);
    if (a.first_login_at) {
      const days = (Date.now() - Date.parse(a.first_login_at)) / 86_400_000;
      say(`  key age        : ${days.toFixed(1)} days${days > 7 ? '  ← past the 7-day mark' : ''}`);
    }
    say(`  scope          : ${(a.scope ?? '—').replace(/https:\/\/www\.googleapis\.com\/auth\//g, '')}`);
  }
}


async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (n: string): string | undefined => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (n: string): boolean => argv.includes(n);

  const tier = (flag('--tier') as Tier | undefined) ?? 'read';
  const kind = (flag('--client') as ClientKind | undefined) ?? 'desktop';
  if (tier !== 'read' && tier !== 'full') throw new Error('--tier must be `read` or `full`');
  if (kind !== 'desktop' && kind !== 'web') throw new Error('--client must be `desktop` or `web`');

  if (has('--setup')) return cmdSetup();
  if (has('--report')) return cmdReport();
  if (has('--discover')) return cmdDiscover();
  if (has('--tools')) return cmdTools(has('--tier') ? tier : null, kind);
  if (has('--login')) return cmdLogin(kind, tier, has('--no-secret'));
  if (has('--refresh')) return cmdRefresh(kind, tier);
  if (has('--call')) {
    const tool = flag('--call');
    if (!tool) throw new Error('--call needs a tool name, e.g.: --call list_calendars');
    return cmdCall(tool, kind, tier);
  }

  say('See the file header for which seven spike questions this closes.');
  say('Start with: npx tsx scripts/spike-google-calendar.ts --setup');
}

main().catch((e: unknown) => {
  say(`\n⛔ ${(e as Error).message}`);
  process.exitCode = 1;
});
