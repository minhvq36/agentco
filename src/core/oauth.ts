/**
 * OAuth 2.1 + PKCE + Dynamic Client Registration (DCR) for MCP arms. → docs/SPEC-arms.md §5h
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠⚠ THIS FILE MUST NEVER IMPORT ANY VENDOR'S SDK. This is the ESCAPE ROUTE.       │
 * │                                                                          │
 * │ The user's call, 24/08: *"remember to leave an escape route in case I later        │
 * │ let users switch the underlying system to codex, antigravity, groq"*. A            │
 * │ statement like that is only real once there's **code that enforces it** — and       │
 * │ this is that code: built-in node + `fetch`, nothing else. Swapping which agent       │
 * │ vendor runs, this file carries over intact, because OAuth is a matter between        │
 * │ agentco and the **service vendor** (Notion), not between agentco and the             │
 * │ **model vendor**.                                                             │
 * │                                                                          │
 * │ There's a test guarding this: `test/oauth-neutral.test.ts` reads this exact file    │
 * │ and fails if any `import` line points outside `node:`.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Three steps, **none of them pinning a vendor name**:
 *   ① `discover`  — knock without a key, read what the server answers (RFC 9728 → 8414)
 *   ② `register`  — request a `client_id` on the spot (RFC 7591). Measured 25/08: Notion returns 201
 *   ③ `exchange`/`refresh` — trade a code for a key, and refresh before it expires
 *
 * ⚠ Measured 25/08, and it decides the shape of the key store: **refresh
 * tokens ROTATE** — every refresh returns BOTH a new access token AND a new
 * refresh token. Not overwriting the new one locks you out on the
 * **second** refresh, meaning it breaks after ~8 hours rather than
 * immediately. See `applyToken`.
 */

import crypto from 'node:crypto';

import { t, type MessageKey } from '../i18n/index.js';

/** The name we declare to the authorization server. Shown on the user's consent screen. */
export const CLIENT_NAME = 'agentco';

/** Authorization server metadata (RFC 8414). Only keeps the fields we actually use. */
export interface AsMeta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  /**
   * ⇐ THE FIELD THAT DECIDES THE SIGN-IN BRANCH. → §deviceStart
   *
   * Present ⇒ the device flow works ⇒ **no `client_secret` needed, no
   * `redirect_uri` needed**. This is what saves vendors that **don't open
   * DCR**: we can't get a `client_id` on the spot, but a shipped-in
   * `client_id` plus the device flow is enough for the user to type **0 keys**.
   * → SPEC-arms §5h·7
   */
  device_authorization_endpoint?: string;
  grant_types_supported?: string[];
}

/**
 * One signed-in account. This is what lives inside `.state/secrets.json`.
 *
 * ⚠ `expires_at` is an **absolute timestamp (ms)**, not `expires_in`.
 * Storing `expires_in` would store a number that becomes meaningless the
 * moment the machine restarts — it's measured from a moment nobody recorded.
 */
export interface OAuthAccount {
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THIS IS THE **ORIGIN OF THE KEY**, NOT THE SOFTWARE'S IDENTITY.                │
   * │ (the user, 27/08: *"client_id follows the software, not the user's data"*)        │
   * │                                                                          │
   * │ That principle is correct, and the code follows it in two places:               │
   * │   `catalog.ts §auth.clientId`  the client WE ship       → follows the software ✅ │
   * │   `.state $clients`            a client DCR mints itself → company data ✅         │
   * │                                                                          │
   * │ This field is a third place, and it does NOT store "which app is agentco".        │
   * │ It stores *"WHICH client issued exactly this key"* — because OAuth requires        │
   * │ that **the refresh must come from the exact client that issued it**. Reading         │
   * │ from the catalog at refresh time means a key issued by a different client            │
   * │ would break, and break at hour 4.                                              │
   * │                                                                          │
   * │ ⚠ HONEST ABOUT TODAY: there's no second client yet (the *"use your own              │
   * │ client_id"* field from §5h·7h **hasn't been built** — the spec claims it has,       │
   * │ which is wrong). So today this value **always equals** the catalog value,           │
   * │ meaning it genuinely is a redundant copy, exactly as the user said. It only         │
   * │ earns its place once the override field exists.                                 │
   * │                                                                          │
   * │ ⇒ Kept, because removing it would mean adding it back intact the moment that         │
   * │ field exists. But **never read it as the source of truth for software                │
   * │ identity** — that source is `catalog.ts`, and only that.                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  client_id: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type: string;
  scope?: string;
  /** The MCP URL this key unlocks — so a refresh knows who to ask. */
  mcp_url: string;
  issuer: string;
  /** A human-readable name (Notion returns `workspace_name`). Display only. */
  label?: string;
  /** Whatever else the server returns, kept as-is — to READ, not to TRUST. */
  extra?: Record<string, unknown>;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A KEY THAT'S FULLY DEAD — needs SIGNING IN AGAIN, not a retry.                  │
   * │                                                                          │
   * │ Three paths reach this state, and NONE of them self-heal:                      │
   * │  · the user revoked it on the service's side                                    │
   * │  · the process died in the exact gap between the service ROTATING the key         │
   * │    and us writing it to disk — the new key sits inside an HTTP response that       │
   * │    is now lost                                                                 │
   * │  · the service's refresh key itself expired                                     │
   * │                                                                          │
   * │ ⚠ WHY A FLAG IS NEEDED rather than letting it surface on its own: without one,      │
   * │ the only symptom is an arm returning a **silent 401 while a worker is mid-task**   │
   * │ — far from the cause, and a 401 says *"wrong key"* rather than *"dead key, click    │
   * │ Sign in"*. Exactly the §5m failure class, at the lifecycle layer.                 │
   * │                                                                          │
   * │ With the flag, the refresh loop **stops retrying every 15 minutes** (pointless,     │
   * │ and each attempt is a network call), the interface can show a Sign-in-again          │
   * │ button, and the error shown at use time states the correct next action.            │
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

// ───────────────────────────────────────────────── ① discovery

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ASK THE SERVER HOW IT AUTHENTICATES — DON'T GUESS. RFC 9728 → RFC 8414.       │
 * │                                                                          │
 * │ The first version GUESSED metadata lived at `{origin}/.well-known/…`.           │
 * │ Measured 25/08 against 7 servers: **5 correct, 2 wrong**, and the two wrong        │
 * │ cases show WHY guessing is wrong on PRINCIPLE, not just from bad luck:              │
 * │                                                                          │
 * │   GitHub      metadata sits at a path WITH A SUB-PATH, and the issuer is at an       │
 * │               **entirely different host** (`https://github.com/login/oauth`).       │
 * │               Guessing from the MCP URL's origin could never produce that string.    │
 * │   Cloudflare  HTTP **200** — no key needed at all. The old guessing logic            │
 * │               reported "404, broken"; the truth was "nothing to do".               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `null` = the server **needs no key**. Throws = couldn't make sense of it,
 * and the thrown message states the real HTTP code rather than guessing on its behalf.
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
   * 🔴 THREE OUTCOMES, NOT TWO. The earlier version conflated one away.
   *
   * The old line `if (status !== 401 && status !== 403) return null` read
   * **anything that isn't 401** as "no key needed". Measured against
   * `gmailmcp.googleapis.com`: it returns **404**, and the function reported
   * 🟢 *"connects directly"*. A false green — the most dangerous direction,
   * since the user goes looking for the cause somewhere else. The same
   * shape as a `catch` swallowing a premise. → [[agentco-catch-hides-premises]]
   */
  /**
   * ⚠ THE OUTBOUND direction, not inbound. The error message has to state that.
   *
   * All three OAuth flow calls (`discover` · `register` · exchange/refresh
   * a key) go **daemon → service**, not service → daemon. On a corporate
   * VPS with egress locked down or forced through a proxy, they die right
   * here — while everything else (the interface, nginx, SSO login) keeps
   * working, so whoever's debugging checks the INBOUND direction and finds nothing.
   *
   * ⚠ And a detail that can burn a whole afternoon: Node's `fetch` does
   * **NOT** automatically read `HTTPS_PROXY`. Setting that variable and
   * assuming it's handled is a real trap.
   */
  if (!probe) {
    throw new Error(t('oauth.noEgress', { url: mcpUrl }));
  }
  if (probe.ok) return null;
  if (probe.status !== 401 && probe.status !== 403) {
    throw new Error(t('oauth.notMcpDoor', { url: mcpUrl, status: String(probe.status) }));
  }

  const u = new URL(mcpUrl);
  // The server STATES where its metadata lives on its own. This replaces us guessing.
  const declared = probe.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1];

  let issuer: string | null = null;
  for (const url of [
    declared,
    // RFC 9728: the resource's path is INSERTED AFTER well-known, never dropped.
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

  // The issuer CAN carry a path (GitHub's does), so both the path-inserted
  // and bare forms are tried, plus the OIDC path. Four paths, none of which know which vendor this is.
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
  throw new Error(t('oauth.noMetadata', { issuer, tried: String(tries.length) }));
}

// ───────────────────────────────────────────────── ② dynamic registration

/**
 * Requests a `client_id` on the spot (RFC 7591) — no manual registration, no allowlist.
 *
 * 🟢 MEASURED 25/08: Notion returns **201**, `token_endpoint_auth_method:
 * "none"`. The question *"does Notion fence off custom apps?"* has an
 * answer: **NO FENCE** — we're treated the same as any other client.
 * Linear · Sentry · Asana · Atlassian also have DCR open.
 * GitHub does **not** have a `registration_endpoint` ⇒ its `client_id` must be requested by hand.
 *
 * ⚠ `none` = **a public client**: no `client_secret` to hide, so PKCE isn't
 * optional — it's the only thing blocking someone from intercepting the code exchange.
 */
export async function register(meta: AsMeta, redirectUri: string): Promise<string> {
  if (!meta.registration_endpoint) {
    throw new Error(t('oauth.noDcr', { issuer: meta.issuer }));
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
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(t('oauth.registerFailed', { status: String(res.status), body }));
  }
  const j = JSON.parse(body) as { client_id: string; client_secret?: string };
  if (j.client_secret) {
    // Doesn't kill the flow, but it must MAKE NOISE: it changes the security model AND the key store's shape.
    // Log line, so English literal — we read this, not the person using the app.
    process.emitWarning(
      `${meta.issuer} issued a client_secret — the public-client model no longer holds for this service.`,
    );
  }
  return j.client_id;
}

// ───────────────────────────────────────────────── ③ PKCE + code exchange

const b64url = (b: Buffer): string => b.toString('base64url');

/** S256. `plain` is deliberately unreachable — it protects against nothing at all. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

export function randomState(): string {
  return b64url(crypto.randomBytes(16));
}

/** The URL to open in the user's browser. */
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
 * Is the key FULLY DEAD, or just temporarily broken? Two cases needing two opposite handlings.
 *
 * `invalid_grant` is OAuth 2's standard phrase for *"this key can no longer
 * be used"* — revoked, expired, or already rotated away. Retrying **never**
 * fixes it. Everything else (dead network, 500, a timeout) is correctly
 * handled by retrying.
 *
 * ⚠ Reads both the `error` inside the JSON body and the HTTP status: RFC
 * 6749 specifies `invalid_grant` comes with **400**, but some services
 * return 401. Looking only at the status code misses half the cases.
 */
export class DeadGrantError extends Error {}

/**
 * TEMPORARILY broken — dead network, DNS, a proxy, 5xx. Retrying is correct.
 *
 * Separated from every other error because these two kinds need **opposite
 * handling**: temporary means retry silently, fully dead means stop and
 * tell the user to sign in again. Conflating them gets both wrong
 * (`oauth-routes.ts §refreshDue` already states this rule).
 */
export class TransientError extends Error {}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴🔴 THREE WRONG PREMISES WERE LIVING INSIDE THIS FUNCTION — measured 26/08     │
 * │ when connecting GitHub.                                                    │
 * │                                                                          │
 * │ All three were TRUE for Notion, so they stayed invisible ever since 25/08. This    │
 * │ is why the rule *"one working vendor proves the MECHANISM, not the RESPONSE          │
 * │ SHAPE"* was written. → SPEC-arms §5h·7d                                       │
 * │                                                                          │
 * │ ① *"the server returns JSON"* — GitHub returns **form-urlencoded** unless we         │
 * │    send `Accept: application/json`. The old function didn't send it ⇒                │
 * │    `JSON.parse` threw on the VERY FIRST code exchange.                             │
 * │                                                                          │
 * │ ② *"broken means `!res.ok`"* — GitHub returns **HTTP 200** with a body of            │
 * │    `{"error":"…"}`. The old function read that as SUCCESS ⇒ `applyToken` built an     │
 * │    account with `access_token: undefined` ⇒ `saveOAuth` **overwrote a perfectly       │
 * │    healthy account with a broken one**. No throw, no log, and it happened inside      │
 * │    the **background refresh loop** — where nobody is watching.                     │
 * │    ⇒ ② is worse than ① even though ① sounds louder: ① fails immediately with a         │
 * │    stack trace.                                                                 │
 * │                                                                          │
 * │ ③ *"a dead key = `invalid_grant`"* — GitHub returns                              │
 * │    **`incorrect_client_credentials`**. No match ⇒ classified as *temporarily          │
 * │    broken* ⇒ the `dead` flag NEVER fires ⇒ the refresh loop retries every 15           │
 * │    minutes forever, and the interface never shows the *Sign in again* button.          │
 * │    Meaning the `dead` mechanism gets disabled at exactly the vendor that needs it       │
 * │    most.                                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ `step` feeds into every error message: exchange · refresh · poll. Those
 * three spots are fixed with three different actions, and a bare `fetch
 * failed` can't say which one — exactly the §5m *"wrong door"* failure class.
 *
 * A CODE, not a word: the label a person reads follows the interface switch, so
 * it is looked up per throw rather than passed in already-translated.
 */
type TokenStep = 'exchange' | 'refresh' | 'poll' | 'deviceStart';

const STEP_KEY: Record<TokenStep, MessageKey> = {
  exchange: 'oauth.stepExchange',
  refresh: 'oauth.stepRefresh',
  poll: 'oauth.stepPoll',
  deviceStart: 'oauth.stepDeviceStart',
};

async function postToken(
  meta: AsMeta,
  form: Record<string, string>,
  stepCode: TokenStep = 'exchange',
): Promise<TokenResponse> {
  const step = t(STEP_KEY[stepCode]);
  let res: Response;
  try {
    res = await fetch(meta.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // ① Without this line, GitHub returns form-urlencoded and `JSON.parse` throws.
        accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
    });
  } catch (e) {
    throw new TransientError(
      t('oauth.stepNoReach', { step, url: meta.token_endpoint, reason: (e as Error).message }),
    );
  }

  const body = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    /* the body isn't JSON — falls back to the HTTP code below, and that's worth flagging */
  }

  // ② CLASSIFY BY THE BODY FIRST, `res.ok` is only a secondary signal.
  const code = typeof json?.['error'] === 'string' ? (json['error'] as string) : '';
  const desc = typeof json?.['error_description'] === 'string' ? (json['error_description'] as string) : '';

  if (code) {
    /**
     * ③ The dead-key list. `incorrect_client_credentials` is GitHub's own
     * phrase for *"this refresh token has been rotated/revoked"* — and it's
     * **the wrong door on the vendor's own part**: the wording talks about
     * `client_id`/`client_secret`, which are completely fine. ⇒ We
     * **rewrite it**, never pass the raw wording through.
     */
    if (
      code === 'invalid_grant' ||
      code === 'invalid_client' ||
      code === 'incorrect_client_credentials' ||
      code === 'bad_refresh_token' ||
      code === 'unauthorized_client'
    ) {
      throw new DeadGrantError(t('oauth.grantDead', { code }));
    }
    // A 5xx with an error code is still a temporary failure: the server is
    // having trouble, not the key being dead.
    if (res.status >= 500) throw new TransientError(t('oauth.stepServiceDown', { step, code }));
    throw new Error(t('oauth.stepFailed', { step, code, desc: desc ? ` — ${desc}` : '' }));
  }

  if (res.status >= 500) throw new TransientError(t('oauth.stepHttp5xx', { step, status: String(res.status) }));
  if (!json) {
    throw new Error(
      t('oauth.stepUnreadable', { step, status: String(res.status), body: body.slice(0, 200) }),
    );
  }

  /**
   * ⚠ A MISSING `access_token` INSIDE A 200 RESPONSE IS ALSO BROKEN.
   *
   * Without this line, case ② returns through a different door: a valid
   * JSON body, no `error` field, and no key either — and downstream would
   * save an empty account right on top of the one currently working. The
   * invariant has to live HERE, the one place every key-exchange path passes through.
   */
  if (typeof json['access_token'] !== 'string' || !json['access_token']) {
    throw new Error(t('oauth.stepNoAccessToken', { step, status: String(res.status) }));
  }
  return json as unknown as TokenResponse;
}

/**
 * Merges a token response into an account. Used for **both** the first
 * sign-in and every subsequent refresh.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `refresh_token ?? old` — THIS `??` IS AN ENTIRE FAILURE CLASS BY ITSELF.       │
 * │                                                                          │
 * │ Measured 25/08: Notion **ROTATES** the refresh token — every refresh returns       │
 * │ BOTH a new access AND a new refresh token, and the old one dies immediately.       │
 * │ So:                                                                        │
 * │   · not overwriting the new one ⇒ locks yourself out on the **SECOND**            │
 * │     refresh, meaning it breaks after ~8 hours rather than immediately ⇒ nobody     │
 * │     can connect the cause to the symptom                                       │
 * │   · but a DIFFERENT server might **not** return a new refresh token ⇒            │
 * │     overwriting with `undefined` would throw away the one that still works        │
 * │ ⇒ Only replaced when the server **actually sends one**. One `??`, two failure       │
 * │ directions.                                                                     │
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
  const tok = await postToken(meta, {
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: p.clientId,
    code_verifier: p.verifier,
  });
  const acc = applyToken({ client_id: p.clientId, mcp_url: p.mcpUrl, issuer: meta.issuer }, tok);
  // The workspace name the server returns — used as the arm's label.
  // `String()` because this is third-party data: it could be a number, null, or absent.
  const name = acc.extra?.['workspace_name'];
  if (typeof name === 'string' && name.trim()) acc.label = name.trim();
  return acc;
}

export async function refreshAccount(meta: AsMeta, acc: OAuthAccount): Promise<OAuthAccount> {
  if (!acc.refresh_token) throw new Error(t('oauth.noRefreshToken'));
  const tok = await postToken(
    meta,
    {
      grant_type: 'refresh_token',
      refresh_token: acc.refresh_token,
      client_id: acc.client_id,
    },
    'refresh',
  );
  return applyToken(acc, tok);
}

// ───────────────────────────────────────────────── ④ device flow (RFC 8628)

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A SECOND SIGN-IN PATH — for vendors that DON'T open DCR. → SPEC-arms §5h·7        │
 * │                                                                          │
 * │ Why Notion's flow can't be reused:  GitHub's web flow REQUIRES a               │
 * │ `client_secret` — **PKCE is an ADDITION, not a REPLACEMENT**. A public client        │
 * │ going down that path dies at the exchange step, with a 401 saying *"wrong key"*.     │
 * │                                                                          │
 * │ The device flow, in exchange, **removes more than it adds**:                      │
 * │   · 0 `client_secret` — even at REFRESH time ( *"Required unless the user           │
 * │     access token was generated using the device flow"*)                          │
 * │   · **0 `redirect_uri`** ⇒ all of §5h·6 (`redirectBase` · `public_url` · nginx ·      │
 * │     Docker · VPS) DOES NOT APPLY to an arm taking this path                        │
 * │   · 0 `state`, 0 `code_verifier`, 0 `pending` map — no authorization code ever        │
 * │     flies anywhere                                                             │
 * │                                                                          │
 * │ The cost: the user has to **type a code** on the vendor's own page. One manual        │
 * │ step in exchange for removing an entire implementation layer.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function supportsDevice(meta: AsMeta): boolean {
  // Read from metadata, NEVER by matching a vendor name. This is the
  // condition that keeps a catalog entry DATA (§5h·1): adding a non-DCR vendor later = adding one object.
  return Boolean(meta.device_authorization_endpoint);
}

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  /** Some vendors return a URL with the code already embedded — when usable, it saves the user a typing step. */
  verification_uri_complete?: string;
  expires_at: number;
  interval_ms: number;
}

/** Requests a device code. `client_id` comes from **catalog data**, never from the handshake. */
export async function deviceStart(
  meta: AsMeta,
  clientId: string,
  scope?: string,
): Promise<DeviceStart> {
  const url = meta.device_authorization_endpoint;
  if (!url) throw new Error(t('oauth.noDeviceFlow', { issuer: meta.issuer }));

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: clientId, ...(scope ? { scope } : {}) }).toString(),
    });
  } catch (e) {
    throw new TransientError(
      t('oauth.stepNoReach', {
        step: t('oauth.stepDeviceStart'),
        url: new URL(url).host,
        reason: (e as Error).message,
      }),
    );
  }

  const body = await res.text();
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error(
      t('oauth.stepUnreadable', {
        step: t('oauth.stepDeviceStart'),
        status: String(res.status),
        body: body.slice(0, 200),
      }),
    );
  }
  if (typeof j['device_code'] !== 'string') {
    /**
     * ⚠ THE MOST COMMON CASE, and the error message must state it plainly:
     * GitHub returns **400** for an app that **hasn't checked "Enable
     * Device Flow"**. Without saying so, whoever's deploying it checks
     * `client_id`, checks the network, checks the URL — everywhere except the actual broken spot.
     */
    throw new Error(
      t('oauth.deviceStartFailed', {
        status: String(res.status),
        detail: String(j['error'] ?? body.slice(0, 120)),
      }),
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

/** The result of one poll. `pending` is a NORMAL state, not an error. */
export type DevicePoll =
  | { state: 'pending'; interval_ms: number }
  | { state: 'done'; account: OAuthAccount };

/**
 * One poll. **Does not loop by itself** — looping belongs to the caller.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Why the poll is split from the loop: the caller is the daemon, and it has to        │
 * │ answer the interface *"still waiting, 12 minutes left"* while it waits. A            │
 * │ self-looping function could only return at the very end, and every state in           │
 * │ between would **disappear**.                                                   │
 * │                                                                          │
 * │ 🔴 AND A DROPPED NETWORK CONNECTION MUST NOT KILL THE SIGN-IN ATTEMPT (a real       │
 * │ case, 26/08): the first measured run died after ~95 seconds from a network             │
 * │ hiccup — right after the user had just clicked Approve. GitHub reports *"access         │
 * │ granted"*, we report *broken*: two screens saying opposite things, and the wrong        │
 * │ screen is ours. ⇒ `TransientError` returns `pending`, never throws. The                │
 * │ stopping point is **the code's own expiration**, not a retry count ⇒ no infinite        │
 * │ loop. → SPEC-arms §5h·7g                                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export async function devicePoll(
  meta: AsMeta,
  p: { clientId: string; start: DeviceStart; mcpUrl: string },
): Promise<DevicePoll> {
  if (Date.now() > p.start.expires_at) {
    throw new Error(t('oauth.deviceCodeExpired'));
  }
  try {
    const tok = await postToken(
      meta,
      {
        client_id: p.clientId,
        device_code: p.start.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
      'poll',
    );
    return {
      state: 'done',
      account: applyToken({ client_id: p.clientId, mcp_url: p.mcpUrl, issuer: meta.issuer }, tok),
    };
  } catch (e) {
    if (e instanceof TransientError) return { state: 'pending', interval_ms: p.start.interval_ms };
    const msg = (e as Error).message;
    /**
     * THE THREE "NOT DONE YET" CASES OF RFC 8628, and they are NOT errors:
     *   authorization_pending  the user hasn't clicked yet — keep waiting
     *   slow_down              we're asking too fast — **add 5 seconds**, don't retry immediately
     *   expired_token          genuinely expired — this one really is an error
     * ⚠ `postToken` has already rewritten the error code into a human-readable
     * sentence, so this matches against the original code string embedded
     * inside it. Keeping the original code inside that sentence is the condition for this to work.
     */
    if (msg.includes('authorization_pending')) return { state: 'pending', interval_ms: p.start.interval_ms };
    if (msg.includes('slow_down')) return { state: 'pending', interval_ms: p.start.interval_ms + 5000 };
    if (msg.includes('access_denied')) throw new Error(t('oauth.accessDenied'));
    throw e;
  }
}

/**
 * The KEY NAME for an account — machine-generated, deterministic, and **`[A-Z0-9_]+`**.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Why the name must carry ACCOUNT IDENTITY, not just the vendor name:              │
 * │                                                                          │
 * │ A key's name feeds into `secretNames` ⇒ feeds into **`armHash`**. Two Notion       │
 * │ workspaces share the **SAME URL** `https://mcp.notion.com/mcp` — if both used       │
 * │ the name `NOTION_TOKEN`, they'd produce the **same hash**, meaning two different      │
 * │ workspaces get merged into one arm. §6i already warned about exactly this case         │
 * │ back on 23/08, and this is where it's resolved.                                  │
 * │                                                                          │
 * │ The identifying key is `workspace_id` (Notion returns it with the token). Without      │
 * │ one, it falls back to `issuer + mcp_url` — still deterministic, just one account       │
 * │ per server.                                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Hashed and then truncated, NEVER taking `workspace_id` directly: real
 * ids contain `-` and lowercase letters, while `PLACEHOLDER` only accepts
 * `[A-Z0-9_]`. Taking it directly would make the `${...}` placeholder
 * **not match**, and the key would silently fail to be injected — exactly the §5m case.
 */
/**
 * Is this name a SIGNED-IN ACCOUNT (rather than a hand-typed key)?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Why this is needed: the error *"Missing key: NOTION_OAUTH_AFAFBCD6"* tells         │
 * │ the user to go fill in something that **doesn't exist** — Notion has no key           │
 * │ to type at all, and the user said it plainly, 26/08: *"a human reading that            │
 * │ would find it really confusing"*.                                                │
 * │                                                                          │
 * │ Placed RIGHT NEXT TO `accountName` rather than at a display site: this is the        │
 * │ function that mints the name, so it's the one place that knows the name's             │
 * │ shape. Putting the recognition logic in a different file would build a second          │
 * │ copy of one convention — and a second copy drifts apart the exact day someone          │
 * │ changes the prefix.                                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function isAccountName(name: string): boolean {
  return /_OAUTH_[0-9A-F]{8}$/.test(name);
}

/**
 * ⚠⚠ `seed` IS WHAT SAVES VENDORS THAT RETURN NO IDENTITY — measured 26/08 with GitHub.
 *
 * Notion returns `workspace_id` right inside the token response. **GitHub
 * returns nothing**: no name, no id, `scope` empty too. Without `seed`,
 * every GitHub account falls back to `issuer|mcp_url` — a string
 * **identical for everyone** ⇒ the same key name ⇒ **the same hash** ⇒ two
 * different accounts get merged into ONE arm. Exactly the §6i case, and it
 * has **no visible symptom** until a second person signs in.
 *
 * ⇒ For a vendor like this, the caller queries identity (`get_me`) and
 * passes the `id` in here. → `catalog.ts §CatalogArm.identity` · SPEC-arms §5h·7k
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
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 WAS THIS NAME MINTED FROM ITS OWN IDENTITY? (added 28/08)                    │
 * │                                                                          │
 * │ `accountName`'s fallback branch, `issuer|mcp_url`, is **identical for every        │
 * │ account of the same service** — it isn't an identity, it's an address.             │
 * │ Falling into that branch means the second account **overwrites** the first,          │
 * │ silently, with no symptom until data ends up in the wrong place.                   │
 * │                                                                          │
 * │ A real case, 28/08 (GitHub): `get_me` timed out on a cold run ⇒ no seed ⇒          │
 * │ fell into this branch. The user only saw *"the account name is an uppercase           │
 * │ OAUTH_…"*.                                                                       │
 * │                                                                          │
 * │ ⚠ Placed RIGHT NEXT TO `accountName`, the same rule already used for                │
 * │ `isAccountName`: this is the function that mints the name, so it's the one           │
 * │ place that knows where the seed came from. Putting the check in a different            │
 * │ file would build a second copy of one convention.                                  │
 * │                                                                          │
 * │ **The safe direction chosen, with both consequences written out:**                 │
 * │  · Rejecting ⇒ a single-account-only service can't connect. **Immediately             │
 * │    visible** symptom, the user reports it, we add `identity` for that entry.          │
 * │  · Allowing it ⇒ two accounts merge into one. **No symptom at all.**                 │
 * │ A visible failure beats a silent one. → [[agentco-safe-default-direction]]           │
 * │                                                                          │
 * │ Today NO entry is blocked: GitHub declares `identity`, Notion returns                │
 * │ `workspace_id` (verified: two workspaces in the store produce two different            │
 * │ names).                                                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
/**
 * ⚠⚠ ONLY ANSWERABLE AT MINT TIME, NOT FOR AN ALREADY-SAVED ACCOUNT.
 *
 * `applyToken` only keeps `extra` when the token response HAS an unknown
 * field. Notion's **refresh** response doesn't carry `workspace_id`, so
 * after the first refresh `extra` **disappears from the record**. Verified
 * against the real store, 28/08: both Notion accounts had lost `extra`,
 * while their names (`AFAFBCD6` ≠ `084F6A58`) prove `workspace_id` WAS
 * present at mint time.
 *
 * ⇒ Calling this function on an already-saved account returns **false for a
 * perfectly healthy account**. I nearly misread exactly this while
 * measuring. It's a gate for the path CURRENTLY BEING SAVED, not a
 * diagnostic tool.
 * → [[agentco-measurement-vs-conclusion]]
 */
export function hasOwnSeed(acc: Pick<OAuthAccount, 'extra'>, seedOverride?: string): boolean {
  if (seedOverride && seedOverride.trim()) return true;
  const ws = acc.extra?.['workspace_id'];
  return typeof ws === 'string' && ws.trim().length > 0;
}

/**
 * Is it close to expiring? Refreshed at **50% of its lifetime**, not with 1 minute left.
 *
 * A Notion key lives 8 hours ⇒ the threshold is 4 hours. Why so wide: a
 * long-running task could start with 3 minutes left on the key and finish
 * after it dies — refreshing right at the edge only moves the failure
 * rather than removing it. And refreshing early **costs nothing**: the old
 * key is still valid at the moment the new one is requested.
 *
 * No `expires_at` ⇒ **false**: a key with no stated expiration gives no
 * basis to claim it's about to die, and refreshing blindly would throw away a key that's working fine.
 */
export function needsRefresh(acc: OAuthAccount, now = Date.now(), lifetimeFraction = 0.5): boolean {
  // Already fully dead ⇒ stop trying. A guaranteed-to-fail network call
  // every 15 minutes burns battery, burns logs, and buries the real
  // failures worth reading. → `OAuthAccount.dead`
  if (acc.dead) return false;
  if (!acc.expires_at) return false;
  if (!acc.refresh_token) return false;
  const left = acc.expires_at - now;
  if (left <= 0) return true;
  // The original lifetime is unknown, so it's inferred from the remaining
  // time against a reasonable reference: expiring within `fraction` of 8
  // hours counts as close. A server issuing shorter-lived keys makes this
  // threshold proportionally wider — still the correct direction, just refreshing earlier.
  return left < 8 * 3600_000 * lifetimeFraction;
}
