/**
 * SIGNING IN TO A SERVICE — two routes and one temporary table. → docs/SPEC-arms.md §5h
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ① THE SIGN-IN BUTTON LIVES IN THE **WEB UI**, NOT THE DAEMON. (an expensive         │
 * │ lesson, 24/08)                                                              │
 * │                                                                          │
 * │ The first spike opened the browser itself from the background process. It broke      │
 * │ at exactly the most common case, and the user hit it on the very first run: the        │
 * │ machine's default browser **wasn't signed into Notion**, while the one with            │
 * │ agentco open was. The daemon knows nothing about the user's own sign-in                 │
 * │ session; **the browser does**.                                                    │
 * │                                                                          │
 * │ ⇒ We don't open a browser. We return a URL, and the **web UI opens the tab              │
 * │ itself** inside the exact window the user is sitting at. No `spawn`, so there's         │
 * │ also no shell-quoting failure class that truncated URLs at `&` on Windows.             │
 * │                                                                          │
 * │ ② REDIRECTS BACK TO THE DAEMON ITSELF, no separate loopback port built.               │
 * │                                                                          │
 * │ The daemon is already listening on `127.0.0.1:<port>`. Reusing it removes an           │
 * │ entire temporary server lifecycle (opened before DCR because `redirect_uri` must         │
 * │ match character-for-character · closed when done · closed if the user abandons          │
 * │ it · a leaked port if closing gets forgotten). RFC 8252 permits loopback                │
 * │ redirects, and a fixed port means **registered once, used forever** instead of           │
 * │ re-running DCR on every click.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import fs from 'node:fs';
import type { ServerResponse } from 'node:http';

import type { Company } from '../core/company.js';
import { companyPaths, type CompanyPaths } from '../core/paths.js';
import { RunError } from '../core/types.js';
import { t } from '../i18n/index.js';
import { findArm } from '../core/catalog.js';
import { callTool } from '../core/mcp-http.js';
import { readClients, readOAuth, saveClient, saveOAuth } from '../core/secrets.js';
import {
  DeadGrantError,
  accountName,
  authorizeUrl,
  deviceStart,
  devicePoll,
  discover,
  exchangeCode,
  needsRefresh,
  hasOwnSeed,
  pkce,
  randomState,
  refreshAccount,
  register,
  supportsDevice,
  type AsMeta,
  type DeviceStart,
  type OAuthAccount,
} from '../core/oauth.js';

/**
 * A sign-in flow IN FLIGHT. In RAM, deliberately.
 *
 * `code_verifier` is a **one-time** secret, only meaningful for the few tens of
 * seconds between opening the tab and Notion calling back. Writing it to disk
 * would create a second secret to protect, in exchange for the ability to "restore"
 * something whose correct recovery path is simply **click the button again**.
 * Daemon dies ⇒ lost ⇒ exactly as intended.
 */
interface Pending {
  meta: AsMeta;
  clientId: string;
  verifier: string;
  mcpUrl: string;
  prefix: string;
  redirectUri: string;
  at: number;
}
const pending = new Map<string, Pending>();

/** Expired ones get swept — a `state` that lingers forever is a slot for guessing. */
const PENDING_TTL_MS = 10 * 60_000;

function sweep(): void {
  const cut = Date.now() - PENDING_TTL_MS;
  for (const [k, v] of pending) if (v.at < cut) pending.delete(k);
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `client_id` LIVES ON DISK, NOT IN RAM. (traced 27/08)                 │
 * │                                                                          │
 * │ The old version here was `new Map()`. Killing the daemon lost it ⇒ next   │
 * │ startup **registered a NEW application** with the service. A user who      │
 * │ restarts a few dozen times gets a few dozen applications, each holding the │
 * │ key to a group of accounts.                                              │
 * │                                                                          │
 * │ The measurement that led here: two dead Notion accounts sharing **the same │
 * │ old `client_id`**, the surviving account using the newest `client_id` —    │
 * │ and both clients still exist (`invalid_grant`, not `invalid_client`), so    │
 * │ what's actually lost is **the grant to the old application**, not the key   │
 * │ itself.                                                                  │
 * │                                                                          │
 * │ ⇒ Rule: **the application stays put, only the key rotates.** That's exactly│
 * │ how a web session survives a whole year — the thing users expect, in       │
 * │ exactly the words *"my Facebook, Shopee account stays logged in for a       │
 * │ year, nobody kicks it out"*.                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function clientFor(company: Company, key: string): string | undefined {
  return readClients(companyPaths(company.dir))[key];
}

export interface StartResult {
  authUrl: string;
  state: string;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE REDIRECT ADDRESS — THE ONE THING THAT MUST NEVER BE GUESSED. (user asked │
 * │ 26/08)                                                                   │
 * │                                                                          │
 * │   *"the redirect flow needs to handle customers running docker, vps, nginx │
 * │    → domain… either 1) log it in the backlog, or 2) do it now — I'm worried │
 * │    about building it and leaving it untested"*                            │
 * │                                                                          │
 * │ The worry is legitimate, so this is **not** an unfinished feature waiting  │
 * │ on a test — it's a **gate**, and a gate can be tested today: every branch   │
 * │ below is a pure function, no Docker needed to run it.                     │
 * │                                                                          │
 * │ 🔴 WHY WE DON'T INFER FROM THE `Host` HEADER: `redirect_uri` is where the  │
 * │ **authorization code** gets sent. `Host` is sent by the client, so it can   │
 * │ be **spoofed** — inferring the redirect from it means anyone who can call   │
 * │ the daemon can also choose where the code lands. That's an account-takeover│
 * │ hole, not a convenience detail. Same reasoning as `isLoopback` only reading │
 * │ the SOCKET address, never `X-Forwarded-For`.                              │
 * │                                                                          │
 * │ ⇒ Three branches, and the third is what saves the person deploying it:     │
 * │   ① `public_url` declared        → use it, after careful validation        │
 * │   ② running loopback, not declared → `http://127.0.0.1:<port>` (tested case)│
 * │   ③ bound externally, not declared → **REFUSE**, and say how to fix it     │
 * │                                                                          │
 * │ Branch ③ follows the same pattern `serve()` already uses for `AGENTCO_TOKEN`:│
 * │ opening a port to the outside while missing something mandatory means      │
 * │ **stop right there, say so plainly** — not limping on and failing         │
 * │ somewhere far from the cause.                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function redirectBase(opts: { host: string; port: number; publicUrl?: string }): string {
  const loopback = /^(127\.|localhost$|::1$|\[::1\]$)/i.test(opts.host);
  const raw = (opts.publicUrl ?? '').trim();

  if (!raw) {
    if (loopback) return `http://127.0.0.1:${opts.port}`;
    throw new RunError(
      t('srv.oauthLoopbackHost', {
        host: opts.host,
        hint: '  AGENTCO_RUNTIME_PUBLIC_URL=https://agentco.your-company.com',
      }),
      'other',
    );
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new RunError(t('srv.oauthPublicUrlInvalid', { raw }), 'other');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new RunError(t('srv.oauthPublicUrlScheme', { scheme: u.protocol }), 'other');
  }
  /**
   * ⚠ `http` is only allowed when the target is this machine itself. An
   * authorization code crossing a network `http` hop travels in plaintext —
   * anyone in the middle can read it, and that code trades directly for a key.
   * Most services reject this themselves too, but we don't rely on them
   * remembering to.
   */
  const targetLoopback = /^(127\.|localhost$|\[::1\]$)/i.test(u.hostname) || u.hostname === '::1';
  if (u.protocol === 'http:' && !targetLoopback) {
    throw new RunError(t('srv.oauthPublicUrlInsecure', { host: u.hostname }), 'other');
  }
  // A query/hash on an origin address is a sign some whole other URL got pasted
  // in by mistake. Ignoring it silently means `redirect_uri` mismatches the
  // registered one character-for-character, and the service returns
  // `invalid_redirect_uri` — a message that **never says why**.
  if (u.search || u.hash) {
    throw new RunError(t('srv.oauthPublicUrlQuery', { raw }), 'other');
  }
  // Keep the path prefix (nginx might mount agentco under `/agentco`), strip the trailing slash.
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TWO SIGN-IN PATHS, AND METADATA PICKS WHICH ONE — nobody types a vendor name. │
 * │                                                                          │
 * │   has DCR         → web flow + PKCE (Notion)     `oauthStart`            │
 * │   declares device  → device code (GitHub)         `oauthDeviceStart`      │
 * │                                                                          │
 * │ A catalog entry declaring `auth: {kind:'device'}` takes the second path.  │
 * │ Why declared in DATA instead of auto-detected: `client_id` must exist      │
 * │ **before** knocking on the door, and it can't be inferred from the         │
 * │ handshake — the same reason the key's variable name has to be fixed        │
 * │ (§5c).                                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function loginKind(catalogId: string): 'device' | 'web' | null {
  const arm = findArm(catalogId);
  if (!arm || arm.spec.kind !== 'http') return null;
  return arm.auth?.kind === 'device' ? 'device' : 'web';
}

/** Opens a sign-in flow. Returns a URL for the **web UI** to open, doesn't open it itself. */
export async function oauthStart(
  company: Company,
  catalogId: string,
  origin: string,
): Promise<StartResult> {
  sweep();
  const arm = findArm(catalogId);
  if (!arm || arm.spec.kind !== 'http') {
    throw new RunError(t('srv.oauthNotLoginService', { id: catalogId }), 'other');
  }
  const mcpUrl = arm.spec.url;

  const meta = await discover(mcpUrl);
  if (!meta) throw new RunError(t('srv.oauthNoLoginNeeded', { url: mcpUrl }), 'other');

  const redirectUri = `${origin}/api/oauth/callback`;
  const ck = `${meta.issuer}|${redirectUri}`;
  let clientId = clientFor(company, ck);
  if (!clientId) {
    clientId = await register(meta, redirectUri);
    // Write it NOW, before opening the tab: if the user closes the daemon mid-flow,
    // next time it reuses this exact application instead of registering yet another one.
    saveClient(companyPaths(company.dir), ck, clientId);
  }

  const { verifier, challenge } = pkce();
  const state = randomState();
  pending.set(state, { meta, clientId, verifier, mcpUrl, prefix: catalogId, redirectUri, at: Date.now() });

  return {
    // `authScope` not declared ⇒ `authorizeUrl` sends no `scope` parameter at all,
    // preserving prior behavior. → `catalog.ts §authScope`
    authUrl: authorizeUrl(meta, {
      clientId,
      redirectUri,
      state,
      challenge,
      ...(arm.spec.authScope ? { scope: arm.spec.authScope } : {}),
    }),
    state,
  };
}

/** Notion calls back here. Returns a small HTML page, and **never returns a token**. */
export async function oauthCallback(
  company: Company,
  params: URLSearchParams,
  res: ServerResponse,
): Promise<{ name: string; label?: string } | null> {
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THIS PAGE IS THE ONLY THING THE USER SEES IN THAT OTHER TAB. (rewritten   │
   * │ 30/08)                                                                   │
   * │                                                                          │
   * │ User signed off on the look: *"plain text is fine, no icon needed, slim   │
   * │ text not too big, centered on screen"* + *"a modern-looking font"*.        │
   * │                                                                          │
   * │ The old version opened with a 2.5rem ✅/❌ emoji. Dropped it, and not just │
   * │ for looks: a giant checkmark **claims more certainty than we actually       │
   * │ have** — on the failure branch it screamed before anyone could read the     │
   * │ explanation, and on the success branch it promised "all done" while what's  │
   * │ left (picking a tier, wiring it up) still lives in the agentco tab. The     │
   * │ text says exactly the part it actually knows.                              │
   * │                                                                          │
   * │ ⚠ Auto-close only runs on the SUCCESS branch. A failure branch that        │
   * │ auto-closes after 1-2 seconds **erases the error message before anyone can │
   * │ finish reading it** — exactly failure class §5m (a bell ringing where no one│
   * │ can hear it). On failure, leave it as-is; they close it themselves.       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const page = (title: string, body: string, ok: boolean) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${title}</title><style>` +
        // `system-ui` comes first so each OS picks up its own modern font
        // (Segoe UI Variable · SF Pro · Inter), with fallbacks after it.
        // WHITE background, gray text, no card — user's call on 30/08: *"no need
        // for a fancy container. Just white background + text (that's it)"*.
        // The "bit of polish" lives in two very light touches: a faint gray glow
        // fading in from the top edge, and the heading tinted with a vertical
        // gradient (dark on top, light below) — enough depth to the text without
        // any actual graphic block.
        `*{box-sizing:border-box}` +
        // ⚠ `height:100%` must climb up to `html`, not just `body`. Without it,
        // `body` is only as tall as its content, so "centered" only centers within
        // that text block — visibly shifted toward the top. `100dvh` so a mobile
        // address bar doesn't throw the centering off.
        `html,body{height:100%}` +
        `body{margin:0;min-height:100dvh;padding:1.5rem;display:flex;align-items:center;justify-content:center;` +
        `background:#fff linear-gradient(180deg,#f3f3f2 0%,#fff 34%) no-repeat;` +
        `color:#6f6c67;` +
        `font-family:system-ui,-apple-system,"Segoe UI Variable Text","Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif;` +
        `-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}` +
        `main{width:min(22rem,calc(100vw - 2.5rem));text-align:center}` +
        `.tag{margin:0 0 1.1rem;font-size:10.5px;font-weight:500;letter-spacing:.15em;text-transform:uppercase;color:#a7a39e}` +
        // `color` is set FIRST as a fallback: a browser that doesn't understand
        // `background-clip:text` still shows the text, just loses the effect.
        `h1{margin:0;font-size:1.0625rem;font-weight:550;letter-spacing:-.012em;line-height:1.4;color:#33312e;` +
        `background:linear-gradient(180deg,#33312e 12%,#7c7873 100%);` +
        `-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}` +
        `p.say{margin:.55rem 0 0;font-size:.8125rem;font-weight:400;line-height:1.7;color:#8a8681}` +
        `hr{margin:1.3rem auto 0;width:1.5rem;border:0;border-top:1px solid #e6e4e1}` +
        `</style>` +
        `<main><p class="tag">agentco</p>` +
        `<h1>${title}</h1><p class="say">${body}</p><hr></main>` +
        // Only closes when DONE, and only closable if this tab was spawned by
        // `window.open`. If it can't close, that's fine — the text above already
        // says what to do.
        (ok ? `<script>setTimeout(()=>window.close(),1400)</script>` : ''),
    );
  };

  const state = params.get('state') ?? '';
  const p = pending.get(state);
  // Delete it NOW, even if we're about to fail: a `code_verifier` is used exactly
  // once, and leaving it in place opens the door to a second call with the same
  // `state`.
  pending.delete(state);

  const err = params.get('error');
  if (err) {
    page(t('srv.oauthPageFailedTitle'), t('srv.oauthPageFailedBody', { error: escapeHtml(err) }), false);
    return null;
  }
  if (!p) {
    // `state` doesn't match ⇒ this code isn't from a flow we opened. This is the
    // CSRF gate, and it also catches a perfectly benign case: hitting F5 on the
    // callback page.
    page(t('srv.oauthPageExpiredTitle'), t('srv.oauthPageExpiredBody'), false);
    return null;
  }
  const code = params.get('code');
  if (!code) {
    page(t('srv.oauthPageNoCodeTitle'), t('srv.oauthPageNoCodeBody'), false);
    return null;
  }

  /**
   * ⚠ TWO SEPARATE `try` BLOCKS, NOT ONE. (split 30/08 — user reported a bug)
   *
   * The old version wrapped both the token exchange and the account-save step
   * in one `try`, and anything that failed inside surfaced as **"Key exchange
   * failed"**. The real case: the exchange had **already succeeded**, what
   * failed was the identity-probe step — so the error message pointed to the
   * **wrong door**, and the user went hunting for a cause that wasn't there.
   * Exactly failure class §5m, and this time we built it ourselves.
   * → [[agentco-wrong-door-errors]]
   */
  let acc: OAuthAccount;
  try {
    acc = await exchangeCode(p.meta, {
      clientId: p.clientId,
      code,
      redirectUri: p.redirectUri,
      verifier: p.verifier,
      mcpUrl: p.mcpUrl,
    });
  } catch (e) {
    page(t('srv.oauthPageExchangeTitle'), escapeHtml((e as Error).message.slice(0, 200)), false);
    return null;
  }

  try {
    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ 🔴 BEFORE 30/08 THIS DOOR PASSED `undefined` STRAIGHT THROUGH — AND THAT│
     * │ WAS A BUG.                                                          │
     * │                                                                    │
     * │ `mustHaveIdentity`'s own comment warns: *"ONE function, called at    │
     * │ BOTH save paths… gating at one door and leaving the other open is a   │
     * │ patch pattern that has burned this project before"*. The gate       │
     * │ **really is present at both doors** — but the thing that FEEDS it    │
     * │ (`probeIdentity`) only ran on the device-code path. The web flow      │
     * │ passed `undefined`, meaning "no seed" every single time.             │
     * │                                                                    │
     * │ It stayed invisible because the first two web-flow entries both      │
     * │ return their own identity: Notion has `workspace_id` in the token     │
     * │ response ⇒ `hasOwnSeed` is true ⇒ the gate passes without needing a   │
     * │ seed. Linear is the FIRST entry that both declares `identity` and     │
     * │ uses the web flow, so it's the first one to hit this — symptom:       │
     * │ *"Grant succeeded"* then failing at the save step.                   │
     * │                                                                    │
     * │ ⇒ Call `probeIdentity` exactly like the other path. An entry that     │
     * │ doesn't declare `identity` gets `{}` back immediately (0 network      │
     * │ round trips), so Notion loses nothing.                              │
     * │ → [[agentco-finish-completely]]                                    │
     * └────────────────────────────────────────────────────────────────────┘
     */
    const arm = findArm(p.prefix);
    const who = arm ? await probeIdentity(arm, acc.access_token) : {};
    if (who.label) acc.label = who.label;

    mustHaveIdentity(acc, who.seed, arm?.name ?? p.prefix);
    const name = accountName(p.prefix, acc, who.seed);
    saveOAuth(companyPaths(company.dir), name, acc);
    page(
      t('srv.oauthPageDoneTitle'),
      t('srv.oauthPageDoneBody', {
        who: escapeHtml(acc.label ?? t('srv.oauthPageDoneFallbackWho')),
      }),
      true,
    );
    return { name, ...(acc.label ? { label: acc.label } : {}) };
  } catch (e) {
    page(t('srv.oauthPageSaveFailedTitle'), escapeHtml((e as Error).message.slice(0, 200)), false);
    return null;
  }
}

// ─────────────────────────────────────────────────────────── device flow

/**
 * A device-code sign-in flow IN FLIGHT. In RAM, same reasoning as `pending`.
 *
 * ⚠ Differs from `pending` in one thing worth noting: here there's **no secret
 * at all**. `device_code` is only meaningful alongside a public `client_id`, and
 * it dies on its own after 15 minutes. So losing this map when the daemon
 * restarts **loses nothing** — the correct recovery is still just clicking the
 * button again.
 */
interface DevicePending {
  meta: AsMeta;
  clientId: string;
  start: DeviceStart;
  mcpUrl: string;
  prefix: string;
  catalogId: string;
  at: number;
}
const devices = new Map<string, DevicePending>();

export interface DeviceStartResult {
  state: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  intervalMs: number;
}

/** Opens a device-code sign-in flow. **No `redirect_uri`.** */
/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS COMPANY'S OWN CLIENT_ID — the customer's if they pasted one, ours if  │
 * │ not. → SPEC-arms §5h·7h · `catalog.ts §ArmAuth.clientId`                  │
 * │                                                                          │
 * │ ⚠ §5h·7h once described this field as *"a first-class citizen"* while      │
 * │ **0 lines of code** actually existed for it (caught 27/08). This is that   │
 * │ implementation.                                                          │
 * │                                                                          │
 * │ Why it's not a side feature — two risks from agentco standing in as the    │
 * │ identity:                                                               │
 * │   ① our app gets suspended by the vendor ⇒ **EVERY customer breaks at once**│
 * │   ② an enterprise customer doesn't want to route through our identity     │
 * │ One input field patches both, and it's the most honest answer to *"why    │
 * │ should I trust agentco"*: **"you don't have to."**                        │
 * │                                                                          │
 * │ Stored in `$clients` — **the same store as the DCR client**, and that's    │
 * │ the right place: both answer *"which application identity does this        │
 * │ company authenticate as"*. Different source (one minted by the vendor,     │
 * │ one pasted by the customer), same meaning. Keyed by `device|<entry>`       │
 * │ because the device path has no `redirect_uri` to use as a key like DCR.    │
 * │                                                                          │
 * │ ⚠ AND THIS IS WHERE `OAuthAccount.client_id` EARNS ITS KEEP. Until now it  │
 * │ was a redundant copy of the catalog entry (user correctly called this out).│
 * │ From now on two clients can coexist — an old key we issued, a new key      │
 * │ they issued — and refreshing **must use the exact client that issued it**. │
 * │ Reading from the catalog fails four hours in.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const DEVICE_CLIENT_KEY = (catalogId: string) => `device|${catalogId}`;

export function deviceClientId(company: Company, catalogId: string): { id: string; own: boolean } {
  const arm = findArm(catalogId);
  const mine = arm?.auth?.clientId ?? '';
  const theirs = clientFor(company, DEVICE_CLIENT_KEY(catalogId));
  return theirs ? { id: theirs, own: true } : { id: mine, own: false };
}

/** Pasting empty = **fall back to agentco's own client**, not save an empty string. */
export function setDeviceClientId(company: Company, catalogId: string, clientId: string): void {
  const v = clientId.trim();
  const paths = companyPaths(company.dir);
  if (!v) {
    saveClient(paths, DEVICE_CLIENT_KEY(catalogId), null);
    return;
  }
  /**
   * ⚠ REJECT STRINGS THAT LOOK LIKE A SECRET. `client_id` is public data; a long,
   * gnarly string pasted in here is almost certainly a `client_secret` or a
   * private key — and we're about to write it into a file the user can commit
   * to git. Same rule as `SPEC-connectors.md §3c`: *the UI must refuse to save
   * if it detects a string that looks like a token.*
   */
  if (v.length > 80 || /\s/.test(v) || /BEGIN|secret|ghp_|gho_|ghs_/i.test(v)) {
    throw new RunError(
      t('srv.oauthNotAClientId'),
      'other',
    );
  }
  saveClient(paths, DEVICE_CLIENT_KEY(catalogId), v);
}

export async function oauthDeviceStart(
  company: Company,
  catalogId: string,
): Promise<DeviceStartResult> {
  for (const [k, v] of devices) if (v.at < Date.now() - PENDING_TTL_MS) devices.delete(k);

  const arm = findArm(catalogId);
  if (!arm || arm.spec.kind !== 'http' || arm.auth?.kind !== 'device') {
    throw new RunError(t('srv.oauthNoDeviceLogin', { id: catalogId }), 'other');
  }
  const mcpUrl = arm.spec.url;
  const meta = await discover(mcpUrl);
  if (!meta) throw new RunError(t('srv.oauthNoLoginNeeded', { url: mcpUrl }), 'other');
  if (!supportsDevice(meta)) {
    /**
     * The catalog says one thing, the service says another. To be blunt, this is
     * **our declaration being wrong**, not the user's fault: they didn't choose
     * this, we shipped it.
     */
    throw new RunError(
      t('srv.oauthDeviceGone', { issuer: meta.issuer }),
      'other',
    );
  }

  // This company's own client — the customer's if they've already pasted one, ours if not.
  const { id: clientId } = deviceClientId(company, catalogId);
  const start = await deviceStart(meta, clientId, arm.auth.scope);
  const state = randomState();
  devices.set(state, {
    meta,
    clientId,
    start,
    mcpUrl,
    prefix: catalogId,
    catalogId,
    at: Date.now(),
  });

  return {
    state,
    userCode: start.user_code,
    verificationUri: start.verification_uri,
    ...(start.verification_uri_complete ? { verificationUriComplete: start.verification_uri_complete } : {}),
    expiresAt: start.expires_at,
    intervalMs: start.interval_ms,
  };
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ASKS WHO THIS KEY BELONGS TO. → `catalog.ts §ArmIdentity` · SPEC §5h·7k    │
 * │                                                                          │
 * │ On failure this **must NOT kill the sign-in flow** — the key was already   │
 * │ genuinely issued, and throwing it away over a failed side-call would force  │
 * │ the user to redo the whole thing over something that only affects the       │
 * │ LABEL. Falls back to the default seed, same as before.                    │
 * │                                                                          │
 * │ ⚠ But it must LOG: falling back to the default means a second account of    │
 * │ the same vendor will collide on the hash. Silence here is saving up an      │
 * │ arm-merging bug for another day.                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 NO OWN IDENTITY ⇒ DON'T SAVE. Better to force a re-login.              │
 * │ → `oauth.ts §hasOwnSeed` (full reasoning + two weighed consequences)       │
 * │                                                                          │
 * │ Summary: without its own seed, `accountName` falls back to `issuer|mcp_url`,│
 * │ **identical for every account** ⇒ the second account silently overwrites   │
 * │ the first. A bad name is merely annoying; this loses data.                │
 * │                                                                          │
 * │ Why throwing away a freshly-minted key is CORRECT: it hasn't been saved     │
 * │ anywhere yet, so nothing is left half-broken. The user clicks the flow      │
 * │ again — and the next attempt is almost certain to succeed because the MCP   │
 * │ session is now warm (exactly what the user observed on 28/08: *"removed it  │
 * │ and redid it… got the exact right name"*).                                │
 * │                                                                          │
 * │ ⚠ ONE function, called at BOTH save paths (web flow + device code). Gating │
 * │ at one door and leaving the other open is a patch pattern that has burned   │
 * │ this project before.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function mustHaveIdentity(acc: OAuthAccount, seed: string | undefined, who: string): void {
  if (hasOwnSeed(acc, seed)) return;
  throw new RunError(t('srv.oauthNoIdentityYet', { who }), 'other');
}

async function probeIdentity(
  arm: NonNullable<ReturnType<typeof findArm>>,
  token: string,
): Promise<{ seed?: string; label?: string }> {
  const id = arm.identity;
  if (!id) return {};
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 TWO ATTEMPTS, THE SECOND WITH A WIDER DEADLINE. (bug the user caught    │
   * │ 28/08)                                                                   │
   * │                                                                          │
   * │ > *"First time: I chose a new account, it produced an account name of      │
   * │ >  OAUTH_… uppercase… I removed it and redid it, same account, it            │
   * │ >  produced the exact right name"*                                        │
   * │                                                                          │
   * │ This probe is the FIRST call to the vendor's MCP using the freshly-minted   │
   * │ key, so it has to pay for the session handshake too. `callTool`'s 10-second │
   * │ deadline is a deadline for a **warm** call; a cold call blows past it, and  │
   * │ the second attempt (now warm) is fast — exactly what the user observed.     │
   * │                                                                          │
   * │ ⚠⚠ AND THE FAILURE HERE ISN'T JUST A BAD NAME. For GitHub, without `seed`  │
   * │ `accountName` falls back to `issuer|mcp_url` — a string **identical for      │
   * │ every account** ⇒ same key name ⇒ **same hash** ⇒ two accounts merge into   │
   * │ ONE arm. Exactly the case §6i that `accountName`'s own comment warned         │
   * │ about, and it has **no symptom** until a second person signs in.            │
   * │                                                                          │
   * │ Hence two attempts, and the caller MUST handle the case where it still      │
   * │ fails — see `oauthDevicePoll`.                                           │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const auth = { Authorization: `Bearer ${token}` };
  const text =
    (await callTool(id.url, auth, id.tool)) ?? (await callTool(id.url, auth, id.tool, {}, 25_000));
  if (!text) {
    process.emitWarning(
      t('srv.oauthNoIdentityTwice', { name: t(arm.name) }),
    );
    return {};
  }
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const seed = j[id.idField];
    const label = j[id.labelField];
    return {
      // `String()` because this is third-party data: `id` might be a number.
      ...(seed !== undefined && seed !== null ? { seed: String(seed) } : {}),
      ...(typeof label === 'string' && label.trim() ? { label: label.trim() } : {}),
    };
  } catch {
    // The tool returned plain text instead of JSON — still not a reason to throw the key away.
    return {};
  }
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CHECKING THE APP INSTALL — which repos the vendor actually lets this arm    │
 * │ touch. → `catalog.ts §repoScan` · SPEC-arms §5h·7o                        │
 * │                                                                          │
 * │ 🔴 THIS WHOLE FUNCTION RESTS ON ONE MEASUREMENT, AND THE MEASUREMENT IS     │
 * │ COUNTERINTUITIVE: a `ghu_` key **can read PUBLIC repos regardless of        │
 * │ whether the app is installed or not** (`list_branches` ✅ on all 16 repos    │
 * │ while the app is only installed on 2). So any test shaped like *"try         │
 * │ reading a file and see if it works"* always answers YES, and a check that    │
 * │ always answers YES is worse than not checking at all.                       │
 * │                                                                          │
 * │ What actually discriminates is `gateTool` — a tool that's **read-only but    │
 * │ requires push permission**. Measured 4/4 correct against a real install.     │
 * │ Swapping in a different tool kills the mechanism — see the comment at        │
 * │ `catalog.ts §repoScan.gateTool`.                                          │
 * │                                                                          │
 * │ ⚠ ON FAILURE, RETURN `null`, DON'T THROW. This is a SIDE call: a network     │
 * │ hiccup or the vendor renaming a tool isn't a reason to block the user from   │
 * │ connecting the arm. The UI distinguishes "checked and came back empty"       │
 * │ (block) from "couldn't check" (allow through, with an honest message) —      │
 * │ two different situations, two different handlings.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface RepoScan {
  login: string;
  /** Repos the app is ACTUALLY installed on — what an employee can fully touch. */
  installed: string[];
  /** Total repos found for the account. `installed` is a subset. */
  seen: number;
}

export async function scanRepos(
  company: Company,
  catalogId: string,
  account: string,
): Promise<RepoScan | null> {
  const arm = findArm(catalogId);
  const s = arm?.repoScan;
  if (!arm || !s || arm.spec.kind !== 'http') return null;

  const token = readOAuth(companyPaths(company.dir))[account]?.access_token;
  if (!token) return null;
  const url = arm.spec.url;
  const H = { Authorization: `Bearer ${token}` };

  try {
    const me = await callTool(url, H, s.meTool, {});
    if (!me) return null;
    const login = String((JSON.parse(me) as Record<string, unknown>)[s.loginField] ?? '').trim();
    if (!login) return null;

    const raw = await callTool(url, H, s.searchTool, {
      query: s.searchQuery.replace('${login}', login),
      perPage: SCAN_MAX,
    });
    if (!raw) return { login, installed: [], seen: 0 };

    /**
     * The response shape belongs to the VENDOR, and it can change. We accept the
     * three shapes we've actually seen and stop there — guessing more would mean
     * building a parser for something we don't control. If it can't be read
     * ⇒ `seen: 0`, and the UI says "couldn't check".
     */
    const j = JSON.parse(raw) as Record<string, unknown>;
    const items = (j['items'] ?? j['repositories'] ?? j) as unknown;
    const names = (Array.isArray(items) ? items : [])
      .map((r) => {
        const o = r as Record<string, unknown>;
        return String(o['full_name'] ?? o['fullName'] ?? '').trim();
      })
      .filter((n) => n.includes('/'))
      .slice(0, SCAN_MAX);

    /**
     * PARALLEL, but capped. Sequentially, 16 repos take ~15 seconds — and the user
     * is sitting there watching. The cap keeps us from firing 100 calls at the
     * vendor at once and eating a 429.
     */
    const installed: string[] = [];
    for (let i = 0; i < names.length; i += SCAN_LANES) {
      const lot = names.slice(i, i + SCAN_LANES);
      const got = await Promise.all(
        lot.map(async (full) => {
          const [owner, repo] = full.split('/');
          if (!owner || !repo) return null;
          const r = await callTool(url, H, s.gateTool, { owner, repo }, SCAN_TIMEOUT_MS);
          return r === null ? null : full;
        }),
      );
      for (const g of got) if (g) installed.push(g);
    }
    return { login, installed, seen: names.length };
  } catch {
    // See the comment block above: a failed side call must not block the connect flow.
    return null;
  }
}

/** Cap on repos checked — someone with 300 repos shouldn't have to wait for 300 calls. */
const SCAN_MAX = 40;
const SCAN_LANES = 8;
const SCAN_TIMEOUT_MS = 8_000;

export type DevicePollResult =
  | { state: 'pending'; intervalMs: number; expiresAt: number }
  | { state: 'done'; name: string; label?: string };

/** One poll tick. The UI calls this in a loop; **the daemon holds the session**, not the browser. */
export async function oauthDevicePoll(company: Company, state: string): Promise<DevicePollResult> {
  const p = devices.get(state);
  if (!p) throw new RunError(t('srv.oauthSessionExpired'), 'other');

  const r = await devicePoll(p.meta, { clientId: p.clientId, start: p.start, mcpUrl: p.mcpUrl });
  if (r.state === 'pending') {
    return { state: 'pending', intervalMs: r.interval_ms, expiresAt: p.start.expires_at };
  }

  // Done ⇒ delete it NOW, even if the step below fails: a `device_code` that has
  // already been exchanged for a key makes a second poll meaningless.
  devices.delete(state);

  const arm = findArm(p.catalogId);
  const acc = r.account;
  const who = arm ? await probeIdentity(arm, acc.access_token) : {};
  if (who.label) acc.label = who.label;

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 NO IDENTITY ⇒ DON'T SAVE. Better to force a re-login.                  │
   * │                                                                          │
   * │ An entry that DECLARES `identity` is one where the vendor **doesn't**       │
   * │ return an identity in the token response (GitHub). Missing `seed` ⇒         │
   * │ `accountName` falls back to `issuer|mcp_url`, identical for every account  │
   * │ ⇒ the second account **silently overwrites** the first. A bad name is just  │
   * │ annoying; this loses data.                                               │
   * │                                                                          │
   * │ Why throwing away a freshly-minted key is CORRECT: it hasn't been saved     │
   * │ anywhere yet, so nothing is left half-broken. The user clicks the device     │
   * │ flow again — and the next attempt is almost certain to succeed, because the │
   * │ MCP session is now warm (exactly what the user observed: *"removed it and    │
   * │ redid it… got the exact right name"*).                                    │
   * │                                                                          │
   * │ ⚠ Only blocks when the entry DOES declare `identity`. Notion returns its own│
   * │ identity, so `who` being empty there is normal — blocking it would block a   │
   * │ perfectly healthy case.                                                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  mustHaveIdentity(acc, who.seed, arm?.name ?? p.prefix);

  const name = accountName(p.prefix, acc, who.seed);
  saveOAuth(companyPaths(company.dir), name, acc);
  return { state: 'done', name, ...(acc.label ? { label: acc.label } : {}) };
}

/** A connected workspace — **NAME and LABEL, never a token**. */
export function oauthAccounts(company: Company, prefix?: string): {
  name: string;
  label?: string;
  expiresAt?: number;
  /**
   * Which arms currently use this key. Empty ⇒ removable.
   *
   * ⚠ Computed on the SERVER and sent along, rather than letting the UI find out
   * it's rejected only after clicking: the rule *"don't present a choice that's
   * certain to be rejected"* (§6e) — and here it also buys something extra, see
   * `Optimistic UI` at the call site. Same pattern as `listArms`'s `orphan` flag.
   */
  usedBy: string[];
  /**
   * The key has died — needs a RE-LOGIN, not a wait. → `OAuthAccount.dead`
   *
   * Has to be surfaced here, because otherwise the only symptom is an arm
   * silently 401ing while an employee is mid-task — far from the cause.
   */
  dead?: string;
}[] {
  const all = readOAuth(companyPaths(company.dir));
  return Object.entries(all)
    .filter(([name]) => !prefix || name.startsWith(`${prefix.toUpperCase()}_OAUTH_`))
    .map(([name, a]) => ({
      name,
      ...(a.label ? { label: a.label } : {}),
      ...(a.expires_at ? { expiresAt: a.expires_at } : {}),
      ...(a.dead ? { dead: a.dead.why } : {}),
      usedBy: Object.values(company.config.arms)
        .filter((arm) => arm.secrets.includes(name))
        .map((arm) => arm.label || t('srv.oauthUnnamed')),
    }));
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE REFRESH LOOP — **ONE PLACE ONLY**, and that place is the daemon.       │
 * │                                                                          │
 * │ `pickMcp` is **deliberately synchronous** (`armexec.ts` just cleared ~4      │
 * │ seconds/task off the hot path). Refreshing is asynchronous. Two options       │
 * │ weighed on 25/08:                                                        │
 * │   ⓐ refresh in the BACKGROUND, `pickMcp` only reads what's already on disk  │
 * │     ← chose this                                                         │
 * │   ⓑ make `pickMcp` async — return exactly what was just fetched            │
 * │                                                                          │
 * │ ⚠ WHY IT MUST BE ONE PLACE: `refresh_token` **ROTATES** (measured 25/08 —   │
 * │ every refresh returns both a new key and a new refresh token, the old one    │
 * │ dies immediately). Two processes refreshing at once means the slower one      │
 * │ submits an **already-dead** refresh token ⇒ failure, and it overwrites a      │
 * │ good copy with a broken one. No lock saves you from that except **only one     │
 * │ worker doing it**.                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Returns the number of accounts refreshed. One failing must NOT break the others.
 */
export async function refreshDue(company: Company): Promise<number> {
  const paths = companyPaths(company.dir);
  let n = 0;
  for (const [name, acc] of Object.entries(readOAuth(paths))) {
    if (!needsRefresh(acc)) continue;
    try {
      const meta = await discover(acc.mcp_url);
      if (!meta) continue;
      const next = await refreshAccount(meta, acc);
      /**
       * ⚠ WRITE IMMEDIATELY, and `saveOAuth` writes ATOMICALLY (temp + rename) —
       * see `secrets.ts §writeRaw`. Because the service already ROTATED the key
       * the moment it answered, `next.refresh_token` is the only thing still
       * usable: one truncated write loses this account, and before 26/08 it
       * could lose **the whole store**.
       */
      saveOAuth(paths, name, next);
      logRefresh(paths, { name, outcome: 'ok', ...(next.expires_at ? { expiresAt: next.expires_at } : {}) });
      n++;
    } catch (e) {
      /**
       * ⚠ TWO KINDS OF FAILURE, TWO OPPOSITE HANDLINGS — conflating them gets
       * both wrong.
       *
       *  · transient (network down, 500) → **stay silent, retry next tick**.
       *    Warning every 15 minutes for a passing network blip teaches people to
       *    ignore the log.
       *  · truly dead (`invalid_grant`) → **mark it**, stop retrying, and let the
       *    UI say *"sign in again"*. Without marking it, the only symptom is an
       *    arm silently 401ing while an employee is mid-task — far from the
       *    cause, and 401 says "wrong key" rather than "dead key".
       */
      if (e instanceof DeadGrantError) {
        /**
         * ⚠ RE-READ BEFORE WRITING. `acc` is the copy this sweep started with,
         * and a refusal is the one moment it is most likely to be out of date:
         * the most common way to be refused is that someone else already
         * rotated the credential successfully. → `deadMarkStillApplies`
         */
        const onDisk = readOAuth(paths)[name];
        if (!onDisk || !deadMarkStillApplies(acc, onDisk)) {
          logRefresh(paths, { name, outcome: 'refused-but-superseded' });
          continue;
        }
        saveOAuth(paths, name, { ...onDisk, dead: { at: new Date().toISOString(), why: e.message } });
        logRefresh(paths, { name, outcome: 'dead', detail: e.message });
        process.emitWarning(
          t('srv.oauthKeyDead', { label: acc.label ?? name, detail: e.message }),
        );
      } else {
        // Transient failure: must NOT stop the loop, and no need to warn — a
        // warning every 15 minutes for a passing blip teaches people to ignore
        // the log. It IS written to the refresh log, which nobody reads until
        // something breaks and then it is the only witness there is.
        logRefresh(paths, {
          name,
          outcome: 'transient',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  return n;
}

/**
 * FORGETS A WORKSPACE — deletes the key locally, and **tells the service** if it accepts.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Why bother revoking on the service side instead of just deleting the file:  │
 * │ the user clicking "Forget" means *"agentco should stop reaching into this    │
 * │ workspace"*. Deleting only our own copy while the key stays alive on Notion  │
 * │ does HALF the job correctly, and the other half is the half they care about. │
 * │                                                                          │
 * │ ⚠ But if revocation fails, **still delete**. The reverse traps the user:      │
 * │ network down, the service not exposing a `revocation_endpoint`, the key       │
 * │ already expired — none of those three is a reason to keep an entry they        │
 * │ just told us to remove.                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export async function oauthForget(company: Company, name: string): Promise<void> {
  const paths = companyPaths(company.dir);
  const acc = readOAuth(paths)[name];
  if (!acc) throw new RunError(t('srv.oauthNoAccount', { name }), 'other');

  /**
   * ⚠ BLOCKS WHILE ANY ARM STILL USES IT — same pattern as `Company.forgetArm`.
   *
   * Removing a workspace that's still wired in leaves that arm silently dead:
   * the config still points at `${NAME}`, but the key is gone. The symptom
   * surfaces the next time an employee uses it — far from the cause, with
   * nothing on screen connecting the two.
   */
  const users = Object.entries(company.config.arms)
    .filter(([, a]) => a.secrets.includes(name))
    .map(([, a]) => a.label || t('srv.oauthUnnamed'));
  if (users.length) {
    throw new RunError(
      t('srv.oauthAccountInUse', {
        label: acc.label ?? name,
        n: users.length,
        who: users.join(', '),
      }),
      'other',
    );
  }

  // Revocation is BEST EFFORT, not a precondition.
  try {
    const meta = await discover(acc.mcp_url);
    if (meta?.revocation_endpoint) {
      await fetch(meta.revocation_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: acc.refresh_token ?? acc.access_token,
          token_type_hint: acc.refresh_token ? 'refresh_token' : 'access_token',
          client_id: acc.client_id,
        }).toString(),
      });
    }
  } catch {
    process.emitWarning(`could not revoke key "${name}" on the service side — deleting locally anyway`);
  }

  saveOAuth(paths, name, null);
}

/** Sweep interval. A Notion key lives 8 hours, the refresh threshold is 4 — 15 minutes is plenty. */
export const REFRESH_TICK_MS = 15 * 60_000;

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE SWEEP AT A TIME — and "one place in the code" was NOT enough.           │
 * │                                                                          │
 * │ `refreshDue` already lived at exactly one call site, and the comment there   │
 * │ concluded *"no lock fixes this — only one worker doing it does"*. Half        │
 * │ right: one place in SPACE, but `setInterval` gives no guarantee at all in     │
 * │ TIME. A sweep that outlives its own 15-minute interval (a socket stalled      │
 * │ across a laptop sleep — the token endpoint has no timeout, deliberately)      │
 * │ is still running when the next tick starts a second one. Both read the        │
 * │ same `refresh_token`, both send it, and the service rotates for the first     │
 * │ ⇒ the second is told the credential is dead. Which is exactly what the        │
 * │ loop was built to prevent.                                                │
 * │                                                                          │
 * │ Measured 09/03: three accounts across THREE different services marked         │
 * │ dead inside 4 seconds — Notion `invalid_grant`, GitHub twice                  │
 * │ `incorrect_client_credentials` — while the credentials still had 2h13m        │
 * │ of life and the refresh token had 180 of its 181 days left. Nothing had       │
 * │ expired. They were refused.                                                │
 * │                                                                          │
 * │ ⚠ DROP the overlapping tick, never queue it. A queued sweep runs against     │
 * │ a store that has already moved on, which is the same collision one tick      │
 * │ later. Skipping costs nothing: the credential is refreshed at 50% of its      │
 * │ life, so there are ~16 more chances before anything is at risk.              │
 * │                                                                          │
 * │ ⚠ This guard is per PROCESS. Two daemons on one `company/` folder still      │
 * │ collide, and no in-process flag can see that. → SESSIONS_MEMORY §8j          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function oneSweepAtATime(sweep: () => Promise<unknown>): () => void {
  let running = false;
  const release = (): void => {
    running = false;
  };
  return () => {
    if (running) return;
    running = true;
    /**
     * ⚠ `then(release, release)`, NOT `finally` — and the difference is the
     * daemon staying alive.
     *
     * `finally` re-throws, so a sweep that rejects becomes an UNHANDLED
     * REJECTION inside a timer callback, and Node's default for that is to
     * kill the process. A background credential sweep is the last thing that
     * should be able to take the whole company down. Caught by
     * `test/oauth-refresh-race.test.ts` on the first run.
     *
     * Swallowing is right *here* and nowhere near here: this function schedules,
     * it does not decide error policy — the caller already catches and reports
     * (`server.ts §tick`). What it must guarantee is only that the flag is
     * released on BOTH paths, including a synchronous throw, or it latches ON
     * and refreshing goes silent for the life of the daemon — a failure that
     * looks exactly like *"credentials just quietly stopped renewing"*.
     */
    try {
      void sweep().then(release, release);
    } catch {
      release();
    }
  };
}

/**
 * A refresh was REFUSED — is it safe to record that on this account?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NO, when the store no longer holds what we set out with. That means          │
 * │ someone else refreshed successfully while this attempt was in flight, and     │
 * │ the refusal is just the losing half of a race — the account is FINE, and      │
 * │ the credential now on disk is the good one.                                 │
 * │                                                                          │
 * │ Writing `{ ...acc, dead }` in that state does two separate harms with one    │
 * │ line: it marks a working account dead (`needsRefresh` then returns false      │
 * │ FOREVER, so nothing retries), and `...acc` is the copy read at the start      │
 * │ of the losing sweep, so the write ALSO overwrites the freshly rotated        │
 * │ credential with the stale one. A recoverable stumble becomes a credential     │
 * │ that only a human can bring back.                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
/**
 * One line per refresh attempt. Append-only, and **never throws**.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Why it exists at all: on 09/03 three credentials died within 4 seconds,     │
 * │ and answering *"why"* a day later had to be done by subtracting `expires_at` │
 * │ from timestamps, because not one attempt had ever been written down. The     │
 * │ loop only ever spoke when it gave up. Everything before that — the sweeps    │
 * │ that worked, the ones that stalled, the one that lost a race — left no        │
 * │ trace at all.                                                             │
 * │                                                                          │
 * │ ⚠ NAMES ONLY, NEVER A CREDENTIAL VALUE. This file is plain text a user can   │
 * │ paste into a bug report. The account name (`NOTION_OAUTH_AFAFBCD6`) is an     │
 * │ identifier; the token is a key. → `secrets.ts`, same rule everywhere.        │
 * │                                                                          │
 * │ ⚠ A BROKEN LOG MUST NOT BREAK REFRESHING. A full disk, a read-only folder,   │
 * │ a locked file — none of those are a reason to stop keeping credentials       │
 * │ alive, and swallowing here is the one place a bare `catch` is right: the      │
 * │ caller's job does not depend on the answer.                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function logRefresh(
  paths: CompanyPaths,
  entry: {
    name: string;
    /**
     * `ok` refreshed · `dead` the service refused and we recorded it ·
     * `refused-but-superseded` refused, but the store had already moved on ⇒ a
     * lost race, NOT a dead credential · `transient` network or 5xx, retried
     * next sweep.
     */
    outcome: 'ok' | 'dead' | 'refused-but-superseded' | 'transient';
    detail?: string;
    expiresAt?: number;
  },
): void {
  try {
    fs.mkdirSync(paths.logs, { recursive: true });
    fs.appendFileSync(
      paths.refreshLog,
      `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`,
      'utf8',
    );
  } catch {
    // Deliberately silent — see the box above.
  }
}

export function deadMarkStillApplies(
  readAt: Pick<OAuthAccount, 'access_token' | 'refresh_token'>,
  onDisk: Pick<OAuthAccount, 'access_token' | 'refresh_token'> | undefined,
): boolean {
  // Deleted while we were away ⇒ nothing to mark, and re-creating it would
  // resurrect an account the user just removed.
  if (!onDisk) return false;
  return onDisk.access_token === readAt.access_token && onDisk.refresh_token === readAt.refresh_token;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export type { OAuthAccount };
