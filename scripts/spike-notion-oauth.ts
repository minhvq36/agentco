/**
 * SPIKE — PATH B: we hold Notion's OAuth ourselves, without relying on
 * anyone's CLI.
 * → SPEC-arms.md §5h (three key types) · §5a (injecting `headers`) · §4e #2
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS FILE DOES NOT IMPORT `@anthropic-ai/claude-agent-sdk`. ON PURPOSE.  │
 * │                                                                          │
 * │ The user locked this in on 08/24: we must leave a way back for Codex ·   │
 * │ Antigravity · Groq. The only way to make THAT PROMISE REAL is to prove   │
 * │ it with running code: the entire flow below uses **node builtins +       │
 * │ fetch**, and ends with an `Authorization: Bearer …` string. Anyone can   │
 * │ consume that string.                                                    │
 * │                                                                          │
 * │ ⇒ If this file ever has to `import` some vendor's SDK, the "provider is  │
 * │ swappable" promise just broke — and it broke at that exact import line.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Source of truth is NOTION'S DOCS, not Claude's docs (user's call):
 *   🌐 developers.notion.com/guides/mcp/get-started-with-mcp
 *   🌐 notion.com/help/notion-mcp
 *
 * Four questions this spike settles — each one could have KILLED path B:
 *
 *   Q1  Does Notion gate out unfamiliar apps?     measured 08/24: NO — /register returns 201
 *   Q2  Does a refresh token come back?           ← must measure, decides the §4 architecture
 *   Q3  How many tools, and how heavy is the schema?
 *   Q4  Can multiple Notion accounts be logged in at once?
 *
 * ⚠ Notion states outright: *"We're working on support for non-interactive
 * authorization"* ⇒ TODAY OAuth **requires a browser**. There's no headless
 * path. That's a design constraint, not a gap in this spike.
 *
 * Run:
 *   npx tsx scripts/spike-notion-oauth.ts              log in a new account
 *   npx tsx scripts/spike-notion-oauth.ts --as cty-b   log in a SECOND account (Q4)
 *   npx tsx scripts/spike-notion-oauth.ts --refresh    only try refreshing the key (Q2)
 *   npx tsx scripts/spike-notion-oauth.ts --tools      only call tools/list (Q3)
 *   npx tsx scripts/spike-notion-oauth.ts --revoke     revoke, then prove it's dead
 *   npx tsx scripts/spike-notion-oauth.ts --no-browser print the URL, paste it yourself
 *
 * Cost: **$0** — never calls the model once.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * ⚠ `/mcp` (Streamable HTTP), NOT `/sse`. Notion still serves `/sse` for
 * older clients, but `SPEC-arms` §2 already settled it: SSE is **accepted**
 * for compatibility, **never proposed**. This spike measures exactly what
 * we'll ship.
 */
const MCP_URL = 'https://mcp.notion.com/mcp';

/**
 * The SPIKE's own key store — NOT the real store.
 *
 * The real store is `company/.state/secrets.json`, and §4 below explains why
 * its shape **has to change** before it can hold an OAuth token. The spike
 * deliberately writes elsewhere so a trial run never touches the real keys
 * in use.
 */
const STORE = path.join(HERE, '..', '.state-spike', 'notion-oauth.json');

/** This string shows up on Notion's consent screen — the user WILL read it. */
const CLIENT_NAME = 'agentco';

// ─────────────────────────────────────────────────────────────────────────────
// KEY STORE — keyed by ACCOUNT, not one flat spot (Q4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One logged-in Notion account.
 *
 * ⚠ `client_id` lives INSIDE each account, not outside — and that's not
 * arbitrary: DCR binds `client_id` to **exactly one `redirect_uri`**. The
 * loopback port changes every run ⇒ every login is a fresh registration.
 * Sharing one `client_id` produces `invalid_redirect_uri` on the second login.
 */
interface Account {
  client_id: string;
  access_token: string;
  refresh_token?: string;
  /** Absolute EXPIRY timestamp (ms). Storing `expires_in` stores a number that's meaningless after the process restarts. */
  expires_at?: number;
  token_type: string;
  scope?: string;
  /** Whatever else Notion returns, keep it as-is — to read, not to trust. */
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
    /* Windows: chmod is a no-op, the user-folder ACL is already sufficient */
  }
}

/** Mask a key before printing it. Without this function the spike would produce its own version of case ㉔. */
const mask = (v?: string) => (v ? `${v.slice(0, 8)}…${v.slice(-4)} (${v.length} chars)` : '—');

// ─────────────────────────────────────────────────────────────────────────────
// ① DISCOVERY — ask the server how it authenticates, don't hard-code it
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
 * │ ASK THE SERVER HOW IT AUTHENTICATES — DON'T GUESS. RFC 9728 → RFC 8414.  │
 * │                                                                          │
 * │ 🔴 The first draft (08/24) GUESSED the metadata lived at                 │
 * │ `{origin}/.well-known/…`. Measured 08/25 against 7 servers: **5 right,   │
 * │ 2 wrong**, and the two wrong cases show WHY guessing is wrong in         │
 * │ principle, not just unlucky:                                            │
 * │                                                                          │
 * │   GitHub      metadata sits at a PATH-BEARING URL (`…/oauth-protected-   │
 * │               resource/mcp/`), and the issuer is on a **COMPLETELY       │
 * │               DIFFERENT HOST**: `https://github.com/login/oauth`.        │
 * │               Guessing from the MCP URL's origin could **never** produce │
 * │               that string.                                              │
 * │   Cloudflare  HTTP **200** — a public server, **no key needed**. The old │
 * │               guessing approach would report "404, broken"; the truth   │
 * │               is "nothing to do here".                                  │
 * │                                                                          │
 * │ ⇒ Three outcomes, and all three are DISCOVERABLE, none require knowing   │
 * │ ahead of time which vendor it is:  ① 200 ⇒ no key needed   ② 401 ⇒       │
 * │ follow `WWW-Authenticate: … resource_metadata="…"`   ③ unrecognized ⇒    │
 * │ say so plainly.                                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
async function discover(mcpUrl: string): Promise<AsMeta | null> {
  // ① Knock WITHOUT a key. The server's answer is the documentation.
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
   * │ 🔴 THREE OUTCOMES, NOT TWO. The earlier draft collapsed two into one. │
   * │ (fixed 08/25)                                                         │
   * │                                                                      │
   * │ The old check: `if (status !== 401 && status !== 403) return null` — │
   * │ meaning **anything other than 401 counts as "no key needed"**.       │
   * │ Measured against `gmailmcp.googleapis.com/mcp`: it returns **404**   │
   * │ (the endpoint doesn't exist at that path), and this function         │
   * │ reported 🟢 *"connect right away"*.                                  │
   * │                                                                      │
   * │ That's a **false green**, the most dangerous direction: the user     │
   * │ plugs in something dead and goes hunting for the cause elsewhere.    │
   * │ Same shape as a `catch` swallowing its premise — "not the error I    │
   * │ expected" gets read as "no error". → [[agentco-catch-hides-premises]] │
   * └──────────────────────────────────────────────────────────────────────┘
   */
  if (!probe) throw new Error(`Could not connect to ${mcpUrl} — check the network or the URL.`);
  if (probe.ok) return null; // 2xx, and ONLY 2xx, means "no key needed"
  if (probe.status !== 401 && probe.status !== 403) {
    throw new Error(
      `${mcpUrl} returned HTTP ${probe.status} — not an MCP endpoint, and not asking for a key. ` +
        `Likely a wrong URL.`,
    );
  }

  // ② The server declares where its own metadata is. This replaces guessing.
  const u = new URL(mcpUrl);
  const declared = probe?.headers
    .get('www-authenticate')
    ?.match(/resource_metadata="([^"]+)"/)?.[1];

  const prmTries = [
    declared,
    // RFC 9728: the resource's path gets INSERTED AFTER well-known, not dropped.
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

  // ③ The authorization server's own metadata. The issuer CAN have a path
  //    (GitHub does), so both the path-inserted and root forms must be
  //    tried, plus the OIDC path.
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
  throw new Error(`Could not read the authorization metadata for ${issuer} (tried ${asTries.length} paths)`);
}

/** `discover` returns `null` when the server needs no key — every place that needs OAuth must check this. */
async function needAuth(mcpUrl: string): Promise<AsMeta> {
  const m = await discover(mcpUrl);
  if (!m) throw new Error(`${mcpUrl} does not require authentication — nothing to log into.`);
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// ② DYNAMIC CLIENT REGISTRATION (DCR, RFC 7591) — the answer to Q1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🟢 MEASURED 08/24: `POST /register` returns **201** for
 * `client_name: "agentco"`, `token_endpoint_auth_method: "none"`, loopback
 * redirect. **No approval, no allowlist, no `client_secret`.**
 *
 * ⇒ The question *"does Notion gate out custom apps, or does it treat all
 * clients the same"* (asked 08/24) is answered: **NO GATE.** We're treated
 * the same as Claude Code.
 *
 * ⚠ `none` means **public client** — no `client_secret` to hide, so PKCE
 * **isn't optional**, it's the only thing stopping someone from intercepting
 * the code exchange.
 */
async function register(meta: AsMeta, redirectUri: string): Promise<string> {
  if (!meta.registration_endpoint) throw new Error('Server does not expose DCR — client_id must be requested manually.');
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
    throw new Error(`DCR failed: HTTP ${res.status} — ${body}`);
  }
  const j = JSON.parse(body) as { client_id: string; client_secret?: string };
  if (j.client_secret) {
    // Don't kill the spike over this, but it must be FLAGGED: it changes the security model and the store's shape.
    console.warn('⚠ Server issued a client_secret — the public-client model no longer applies, re-read §5h·2.');
  }
  return j.client_id;
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ PKCE + LOOPBACK — login
// ─────────────────────────────────────────────────────────────────────────────

const b64url = (b: Buffer) => b.toString('base64url');

function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * 🔴 DO NOT USE `cmd /c start` ON WINDOWS. (bug from 08/24, a user caught it on the very first run)
 *
 * `cmd.exe` treats `&` as a **command-chaining character**, so it truncates
 * the URL at the first `&`:
 *
 *   sent      …/authorize?response_type=code&client_id=…&state=…&code_challenge=…
 *   arrives   …/authorize?response_type=code
 *   Notion    {"error":"invalid_request","error_description":"Missing client_id"}
 *
 * And an OAuth URL **always** has `&` in it — meaning this path fails 100%
 * of the time, not occasionally. `rundll32 url.dll,FileProtocolHandler`
 * receives the URL as **one intact argument**, never touching a shell, so
 * there's nothing to truncate.
 *
 * ⚠ The FIFTH instance of the *"works on the dev machine, breaks elsewhere"*
 * error class (shell names per OS · non-Latin slugs · the remote 📂 button ·
 * Docker path mapping · and now shell quoting). The previous four are
 * logged in `SESSIONS_MEMORY` §5o ⑥.
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
    /* couldn't open it — no big deal, the URL is already printed, pasting it manually still works */
  }
}

/**
 * The loopback port that receives `?code=`.
 *
 * ⚠ The port must open **BEFORE** DCR, because `redirect_uri` must match
 * **character-for-character** what was registered, and the port number is
 * only known after `listen(0)`. Doing it in the reverse order registers one
 * port and listens on another — Notion returns `invalid_redirect_uri` and
 * that error message **does not say what actually caused it**.
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
        say(`❌ Notion refused: ${err}`);
        fail?.(new Error(`Notion returned error=${err}`));
        return;
      }
      // CSRF protection: if `state` doesn't match, this code isn't from the run we started.
      if (!code || state !== expectState) {
        say('❌ state mismatch — ignoring.');
        fail?.(new Error('state mismatch'));
        return;
      }
      say('✅ Done. Close this tab and go back to the terminal.');
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
            // 15 minutes, not 5: the user may need to LOG INTO NOTION first
            // before reaching the consent screen. Setting the fastest-possible
            // timeout would kill the flow right while the user is doing exactly
            // the right thing.
            setTimeout(() => no(new Error('15-minute login wait expired.')), 900_000).unref();
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
  console.log(`\n━━ LOG IN · account "${id}"`);

  const meta = await needAuth(MCP_URL);
  console.log(`   issuer            ${meta.issuer}`);
  console.log(`   scopes_supported  ${JSON.stringify(meta.scopes_supported)}`);
  if (meta.scopes_supported?.length === 1) {
    console.log(
      '   🔴 EXACTLY ONE SCOPE ⇒ permissions cannot be split up. The UI card must say\n' +
        '      so, and the §5h·3 "Scope" row does NOT apply to Notion. (correction 08/24)',
    );
  }

  const lo = await loopback();
  console.log(`   redirect_uri      ${lo.redirectUri}`);

  const client_id = await register(meta, lo.redirectUri);
  console.log(`   ✅ Q1 · DCR       client_id=${client_id}  ⇒ Notion does NOT gate out unfamiliar apps`);

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
   * ⚠ PRINT THE URL **ALWAYS**, even when the browser opened successfully. (user, 08/24)
   *
   * The machine's DEFAULT browser is often **not** where the user is logged
   * into Notion — and in that case the flow dies on an unfamiliar login
   * screen nobody understands. Having the URL available to paste into the
   * right browser/profile is the **cheapest** escape hatch, and it also
   * covers the popup-blocked case.
   *
   * ⇒ A consequence for the PRODUCT, not just this spike: the "Log in"
   * button must live in **agentco's own web UI** (which is ALREADY open in
   * the user's browser, i.e. their actual logged-in session), **not** in the
   * daemon. A daemon that opens a browser is a daemon guessing on the
   * user's behalf where they're logged in.
   */
  console.log(`\n   Authorization link (paste into whichever browser you're ALREADY logged into Notion with):\n`);
  console.log(`   ${auth}\n`);
  if (!noBrowser) {
    console.log('   → Attempting to open the default browser. Pick a workspace and click allow…');
    console.log("     (not logged into Notion there? paste the link above into a Chrome/Edge session that is.)\n");
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
    `   ✅ Q2 · refresh   ${acc.refresh_token ? mask(acc.refresh_token) : '🔴 MISSING — see §4 below'}`,
  );
  console.log(
    `   expires           ${acc.expires_at ? new Date(acc.expires_at).toLocaleString() : '— (never expires?)'}`,
  );
  if (acc.extra) console.log(`   Notion also sent  ${JSON.stringify(acc.extra)}`);
  console.log(`   💾 ${STORE}`);
  return acc;
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ REFRESHING THE KEY (Q2) — and this is where it COLLIDES WITH TODAY'S ARCHITECTURE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `pickMcp` (worker.ts:831) is SYNCHRONOUS — ON PURPOSE (armexec.ts     │
 * │ §split-in-two). Refreshing a key is ASYNCHRONOUS. These two can't live    │
 * │ in the same function.                                                    │
 * │                                                                          │
 * │ Two paths, and one must be picked BEFORE writing the real code:          │
 * │                                                                          │
 * │  ⓐ refresh PROACTIVELY in the background — daemon tick, same pattern as │
 * │     `ensureInstalled`. `pickMcp` stays synchronous, just reads whatever  │
 * │     string already exists. **Recommended.**                             │
 * │     Cost: the key could expire right at the moment of use ⇒ needs one    │
 * │     retry.                                                               │
 * │                                                                          │
 * │  ⓑ refresh ON DEMAND        — `pickMcp` becomes async.                   │
 * │     Cost: pulls an `await` right into the hot path that `fastLaunch`     │
 * │     just cleaned up (measured: ~4 seconds/task). Give back what was just │
 * │     bought.                                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
async function refresh(id: string): Promise<Account> {
  const store = readStore();
  const acc = store.accounts[id];
  if (!acc) throw new Error(`No account "${id}" yet — log in first.`);
  if (!acc.refresh_token) throw new Error('This account has NO refresh_token — Q2 answers NO.');

  const meta = await needAuth(MCP_URL);
  const before = acc.access_token;
  const tok = await postToken(meta, {
    grant_type: 'refresh_token',
    refresh_token: acc.refresh_token,
    client_id: acc.client_id,
  });

  const next = toAccount(acc.client_id, tok);
  // ⚠ Refresh tokens ROTATE at many providers: not keeping the new one locks
  // us out on the second refresh — breaking a WEEK later, exactly the
  // expensive kind of bug.
  if (!next.refresh_token) next.refresh_token = acc.refresh_token;
  store.accounts[id] = next;
  writeStore(store);

  console.log(`\n━━ REFRESH · "${id}"`);
  console.log(`   old key           ${mask(before)}`);
  console.log(`   new key           ${mask(next.access_token)}`);
  console.log(`   string changed?   ${before === next.access_token ? '❌ NO' : '✅ YES'}`);
  console.log(
    `   refresh rotates?  ${acc.refresh_token === next.refresh_token ? 'no (reused)' : '✅ YES — must be overwritten'}`,
  );
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ HAND-ROLLED MCP HANDSHAKE (Q3) — borrowing no one's SDK
// ─────────────────────────────────────────────────────────────────────────────

/** Streamable HTTP returns `application/json` OR `text/event-stream`. Accept both. */
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
  if (res.status === 202) return { json: null, sessionId: sid }; // notification, no body
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP HTTP ${res.status} — ${text.slice(0, 400)}`);

  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    // Take the last `data:` line — enough for a one-question-one-answer call.
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
  if (!acc) throw new Error(`No account "${id}" yet.`);

  console.log(`\n━━ MCP HANDSHAKE · "${id}"  (0 lines importing any vendor SDK)`);

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
   * ⚠ THIS IS A BYTE COUNT, NOT A TOKEN COUNT — and that gap is real.
   * The real token number can only be obtained from `getContextUsage()` once
   * plugged into a session with a model. Byte count is recorded here as a
   * CHEAP reference point; don't quote bytes as money. §9b already measured
   * filesystem at **+2,185 tokens/turn** — that's the actual comparable unit.
   */
  const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
  console.log(`   ✅ Q3 · tool count   ${tools.length}`);
  console.log(
    `   raw schema        ${bytes.toLocaleString('en-US')} bytes  (≈ ${Math.round(bytes / 4).toLocaleString('en-US')} tokens — an ESTIMATE, must be remeasured with getContextUsage)`,
  );

  /**
   * ⚠ READ OR WRITE MUST BE ASKED VIA `annotations`, NEVER GUESSED FROM THE NAME. → §8a
   *
   * `notion-fetch` sounds like a read; `notion-convert-page-to-skill` could
   * sound like anything. A tool's name is what the vendor chose for a human
   * reader, **not** a declaration of what it does. Spike 1 already measured
   * the filesystem case: **13/14** tools have annotations — so the right
   * question here is *"does Notion declare it"*, and **absence is not a
   * safety signal**: a missing `readOnlyHint` does NOT mean read-only.
   */
  let ro = 0;
  let write = 0;
  let unknown = 0;
  for (const t of tools) {
    const a = t.annotations;
    const tag =
      a?.readOnlyHint === true
        ? ((ro += 1), '👁  read-only')
        : a?.readOnlyHint === false
          ? ((write += 1), a.destructiveHint ? '🔴 WRITE · destructive' : '✍  WRITE')
          : ((unknown += 1), '❓ NOT DECLARED');
    console.log(`     ${tag.padEnd(16)} ${t.name}`);
  }
  console.log(
    `\n   breakdown         👁 ${ro} read-only · ✍ ${write} write · ❓ ${unknown} undeclared`,
  );
  if (unknown > 0) {
    console.log(
      '   ⚠ Some tools do NOT declare annotations ⇒ the effect-based approval gate\n' +
        '     (§8a) does NOT cover them all. Absence ≠ safe. [[agentco-deterministic-vs-signal]]',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ REVOCATION — "letting go" must kill the real key, not just delete our file
// ─────────────────────────────────────────────────────────────────────────────

async function revoke(id: string): Promise<void> {
  const store = readStore();
  const acc = store.accounts[id];
  if (!acc) throw new Error(`No account "${id}" yet.`);
  const meta = await needAuth(MCP_URL);
  if (!meta.revocation_endpoint) {
    console.log('   ⚠ The server does not publish a revocation_endpoint — only our own copy can be deleted.');
  } else {
    const res = await fetch(meta.revocation_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: acc.access_token, client_id: acc.client_id }).toString(),
    });
    console.log(`\n━━ REVOKE · "${id}" → HTTP ${res.status}`);
  }
  // Proof, not a promise: call it again and expect it to FAIL.
  try {
    await listTools(id);
    console.log('   🔴 STILL WORKS — revocation has NO immediate effect. Never promise "10 seconds".');
  } catch (e) {
    console.log(`   ✅ confirmed dead: ${(e as Error).message.slice(0, 120)}`);
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
   * `--discover <url>` — PROVES "one shared shape" actually runs.
   *
   * The user asked on 08/25: *"do we need custom code per shape, or does
   * every worker read one shared shape?"* The answer shouldn't be an
   * argument — it should be a command anyone can rerun against any URL,
   * including some community MCP server we've never heard of. No vendor
   * name may be hard-coded into this piece of code.
   */
  if (flag('--discover')) {
    const url = argv[argv.indexOf('--discover') + 1] ?? MCP_URL;
    const m = await discover(url);
    console.log(`\n━━ DISCOVERY · ${url}`);
    if (!m) {
      console.log('   🟢 NO KEY NEEDED — connect directly, no login step at all.');
      return;
    }
    console.log(`   issuer            ${m.issuer}`);
    console.log(`   login at          ${m.authorization_endpoint}`);
    console.log(`   DCR               ${m.registration_endpoint ?? '🔴 NONE — client_id must be requested manually (case G2)'}`);
    console.log(`   PKCE              ${JSON.stringify(m.code_challenge_methods_supported ?? null)}`);
    console.log(`   revocation        ${m.revocation_endpoint ?? '— (only our own copy can be deleted)'}`);
    console.log(`   scopes            ${JSON.stringify(m.scopes_supported ?? null)}`);
    console.log(
      `\n   ⇒ ${m.registration_endpoint ? '🟢 PLUGS IN, 0 lines of vendor-specific code' : '🟡 needs one manual step — this is the actual case that needs custom code'}`,
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
    console.log(`\n   ✅ Q4 · accounts held: ${ids.length} — ${ids.join(', ')}`);
    if (ids.length < 2) {
      console.log('      (rerun with `--as cty-b` using a DIFFERENT Notion account to close out Q4)');
    }
  }
}

main().catch((e: unknown) => {
  console.error(`\n🔴 ${(e as Error).message}`);
  process.exit(1);
});
