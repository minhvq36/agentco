/**
 * SPIKE — LINEAR. Answer seven questions **before** writing `arms/linear.ts`.
 * → docs/TEST-WALKTHROUGH.md test 19 · SPEC-arms §4e · SESSIONS_MEMORY §5x
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS FILE IMPORTS `src/core/oauth.ts` AND `src/core/probe.ts`. ON         │
 * │ PURPOSE — and it's the OPPOSITE of `spike-notion-oauth.ts`.              │
 * │                                                                          │
 * │ The Notion spike (08/24) was written BEFORE `oauth.ts` existed, so it    │
 * │ rolled its own everything — it's the draft `oauth.ts` was born from.     │
 * │ This spike asks a different question: **can the code THAT'S ALREADY     │
 * │ RUNNING swallow Linear without changing a single line?** Re-implementing │
 * │ the OAuth flow here would answer a different question — it would prove   │
 * │ *"some way of writing this works"*, not *"OUR way works"*. So every      │
 * │ OAuth step below calls the real function directly.                       │
 * │                                                                          │
 * │ ⇒ Wherever this spike goes RED, that's a line that needs fixing in       │
 * │ `src/`, and it points straight at which one.                             │
 * │                                                                          │
 * │ ⚠ Does NOT import `@anthropic-ai/claude-agent-sdk`. Rule §5r still       │
 * │ stands: the core doesn't marry any vendor. The MCP part below is plain   │
 * │ `fetch` + JSON-RPC.                                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Source of truth is LINEAR'S DOCS, not Claude's docs:
 *   🌐 linear.app/docs/mcp
 *
 * ── SEVEN QUESTIONS, each one able to change the design ─────────────────────
 *
 *   Q1  Does `oauth.ts` work with Linear WITHOUT MODIFICATION?  ← the priciest question
 *   Q2  How many tools, what names, how many tokens?  ← §4d criterion 5 blocks if missing
 *   Q3  What tools does `/mcp/readonly` cut out?
 *   Q4  How many tiers does `annotations` produce — 2 or 3?  ← decides the tier picker
 *   Q5  Does the `read` scope get enforced at the KEY LEVEL?  ← cell D-2 of test 19
 *   Q6  Does a refresh token come back, and does it ROTATE?
 *   Q7  Can two workspaces be logged in at once?
 *
 * ── NUMBERS ALREADY MEASURED 08/29 (plain fetch, not logged in) ─────────────
 *
 *   POST /register  client_name="agentco" auth="none"  → 201, NO client_secret
 *   POST /mcp       no key yet                          → 401 + spec-correct WWW-Authenticate
 *   token_endpoint_auth_methods_supported: [basic, post, none]   ⇒ public client OK
 *   scopes_supported: read · write
 *
 * ── RUN ───────────────────────────────────────────────────────────────────
 *
 *   npx tsx scripts/spike-linear-oauth.ts                  log in (asks for read+write)
 *   npx tsx scripts/spike-linear-oauth.ts --scope read     log in asking ONLY read   (Q5)
 *   npx tsx scripts/spike-linear-oauth.ts --as b           second account             (Q7)
 *   npx tsx scripts/spike-linear-oauth.ts --tools          tools/list only, both URLs (Q2·Q3·Q4)
 *   npx tsx scripts/spike-linear-oauth.ts --refresh        try refreshing only        (Q6)
 *   npx tsx scripts/spike-linear-oauth.ts --no-browser     print the URL, paste it yourself
 *
 * Cost: **$0** — never calls the model once.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** ⭐ Q1 lives or dies on exactly these eight names. */
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
/** ⭐ Tier levels must NOT be recomputed here — use the exact function the product uses. */
import { levelOf, offeredTiers, tierOf, TIERS, type ProbedTool } from '../src/core/probe.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Two URLs, and **this pair is the entire reason Linear is worth doing before
 * Notion**. `/mcp` exposes every tool; `/mcp/readonly` has the server itself
 * cut out the write tools.
 * → `catalog.ts` will need a `readOnlyUrl` field next to the existing `readOnlyHeaders`.
 */
const MCP_URL = 'https://mcp.linear.app/mcp';
const MCP_URL_READONLY = 'https://mcp.linear.app/mcp/readonly';

/** The SPIKE's own key store — NOT `company/.state/secrets.json`. Trial runs never touch the real keys. */
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

// ─────────────────────────────────────────────────────────── MCP over plain fetch

/**
 * Streamable HTTP returns **one of two** shapes for the same call: plain
 * JSON, or SSE (`event: message\ndata: {...}`). Pick by `content-type`
 * rather than guessing from the first character — an SSE body also starts
 * with a letter.
 *
 * ⚠ `Mcp-Session-Id` must be echoed back from the second call onward. Miss
 * it and `tools/list` returns 400 "no session" — and that error message
 * **doesn't** mention the session at all.
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
    // Take the LAST `data:` line: the server may send multiple events, the result is in the final one.
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

/** Handshake + `tools/list`. Returns both the RAW tools (for byte counting) and the tier-resolved tools. */
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

  // Required by the MCP spec; skipping it makes some servers hang at `tools/list`.
  await rpc(url, token, 'notifications/initialized', {}, session);

  const r = await rpc(url, token, 'tools/list', {}, session);
  if (r.status !== 200) return { error: `tools/list → HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}` };

  const raw = ((r.body as { result?: { tools?: RawTool[] } })?.result?.tools ?? []) as RawTool[];
  const probed: ProbedTool[] = raw.map((t) => {
    // ⚠ Same inference `probe.ts` uses: `openWorldHint` → `openWorld`.
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

// ─────────────────────────────────────────────────────── login (Q1 · Q7)

/** Open the browser per OS. → [[agentco-three-os-always]] */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? // ⚠ NOT `cmd /c start`: it truncates the URL at the first `&` — bug from 08/24,
        // and an OAuth URL always has ≥4 `&` characters. `rundll32` swallows the whole string.
        (['rundll32', ['url.dll,FileProtocolHandler', url]] as const)
      : process.platform === 'darwin'
        ? (['open', [url]] as const)
        : (['xdg-open', [url]] as const);
  spawn(cmd, [...args], { detached: true, stdio: 'ignore' }).unref();
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE PORT MUST COME FROM THE VERY SOCKET THAT WILL LISTEN. (bug a user  │
 * │ hit 08/29, first round)                                                   │
 * │                                                                          │
 * │ The first draft opened a **probe** server with `listen(0)` to ask for a  │
 * │ free port, read the port number, **closed it**, built `redirect_uri`     │
 * │ from that number, then opened the real server with `listen(0)` **again** │
 * │ — and "again" means **a different port**. The browser comes back to the  │
 * │ port it registered, and nobody is listening there anymore:               │
 * │ *"127.0.0.1 refused to connect"*. Clicking again then finds `state`      │
 * │ already spent ⇒ *"invalid state"* — the second symptom hides the first   │
 * │ cause.                                                                    │
 * │                                                                          │
 * │ ⇒ Error class: **measure a resource, release it, then trust the          │
 * │ measurement is still valid.** Same family as reading `mtime` before      │
 * │ writing. No `catch` can catch it — every call succeeds, there are just   │
 * │ two numbers instead of one.                                              │
 * │                                                                          │
 * │ ⇒ Fixed by STRUCTURE, not discipline: the server listens FIRST,          │
 * │ `redirect_uri` is DERIVED FROM it. With no second socket, there's        │
 * │ nothing left to drift.                                                    │
 * │ (the product's `oauth-routes.ts` already got this right — it keeps one   │
 * │ live server.)                                                            │
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
  /** Callback arriving BEFORE `wait()` is called — rare, but losing it hangs forever. */
  let early: { code?: string; state?: string; err?: string } | undefined;

  const settle = (code?: string, got?: string, err?: string): void => {
    if (!ok || !no) {
      early = { code, state: got, err };
      return;
    }
    if (err) no(new Error(`Linear rejected: ${err}`));
    else if (!code) no(new Error('callback did not carry a `code`'));
    else if (got !== expected) no(new Error('`state` mismatch — stale round, or interleaved with another'));
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
        ? '<h2>Done. Go back to the terminal.</h2>'
        : `<h2>Failed</h2><pre>${err ?? 'callback is missing code'}</pre>`,
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
  console.log(`\n━━ Q1 · LOGGING IN "${as}"   scope requested: ${scope}\n`);

  // ① discover — the real function.
  const meta: AsMeta | null = await discover(MCP_URL);
  if (!meta) {
    throw new Error(
      '🔴 Q1 RED at step ①: `discover()` returned null ⇒ it thinks Linear "needs no login". ' +
        'This is exactly the §5u ③ error class (false green). Fix `oauth.ts:194`.',
    );
  }
  console.log('  ① discover      ✅', meta.issuer, '·', meta.registration_endpoint ? 'has DCR' : '🔴 NO DCR');

  // ⚠ The server must be LISTENING BEFORE registration: DCR binds `client_id`
  // to exactly one `redirect_uri`, so the port number must come from the very
  // socket that will receive the callback.
  // → see the comment block on `startCallback`.
  const cb = await startCallback();
  const redirectUri = `http://127.0.0.1:${cb.port}/callback`;
  console.log('  ⓪ loopback port ✅', cb.port, '— listening');

  // ② register — the real function. This is where Figma returns 403.
  const clientId = await register(meta, redirectUri);
  console.log('  ② register      ✅ client_id =', clientId);

  // ③ PKCE + URL — the real function.
  const { verifier, challenge } = pkce();
  const state = randomState();
  const url = authorizeUrl(meta, { clientId, redirectUri, state, challenge, scope });
  console.log('  ③ authorizeUrl  ✅');
  console.log(`     ⚠ EYEBALL CHECK: the URL must have client_id & state & code_challenge & scope=${scope}, all of them`);
  console.log(`     ${url}\n`);

  const waiter = cb.wait(state);
  if (noBrowser) console.log('  👉 Paste the URL above into your browser.');
  else openBrowser(url);
  console.log('  ⏳ Waiting for you to click Authorize...');

  let code: string;
  try {
    code = await waiter;
  } finally {
    // Close it whether it succeeded or failed — a port still listening after
    // this run dies is exactly what makes the NEXT run pick up this run's callback.
    cb.close();
  }

  // ④ exchangeCode — the real function.
  const acc = await exchangeCode(meta, { clientId, code, redirectUri, verifier, mcpUrl: MCP_URL });
  console.log('  ④ exchangeCode  ✅');

  const s = readStore();
  s.accounts[as] = { ...acc, scope_asked: scope };
  writeStore(s);

  console.log('\n  ┌─ Q1 · RESULT');
  console.log('  │ access_token   ', acc.access_token ? `✅ ${acc.access_token.length} chars` : '🔴 MISSING');
  console.log(
    '  │ refresh_token  ',
    acc.refresh_token ? '✅ PRESENT' : '🔴 MISSING — Q6 is dead, an expired key forces a re-login',
  );
  console.log('  │ expires_at     ', acc.expires_at ? new Date(acc.expires_at).toISOString() : '(no expiry)');
  console.log('  │ scope GRANTED  ', acc.scope ?? '(server did not say)');
  console.log('  │ label          ', acc.label ?? '(exchangeCode could not find a workspace name)');
  console.log('  └─');
  if (acc.scope && scope && acc.scope !== scope) {
    console.log(`  ⚠ ASKED "${scope}" BUT GOT "${acc.scope}" — note it down, it changes how we display tiers.`);
  }
  return acc;
}

// ─────────────────────────────────────────────── Q2 · Q3 · Q4 · Q5

function dumpTools(label: string, r: { raw: RawTool[]; probed: ProbedTool[]; bytes: number }): void {
  const tok = Math.round(r.bytes / 4);
  console.log(`\n━━ ${label}   ${r.raw.length} tools · ${r.bytes} bytes ≈ ${tok} tokens`);
  const noAnn = r.raw.filter((t) => !t.annotations).length;
  console.log(
    `   annotations: ${r.raw.length - noAnn}/${r.raw.length} present` +
      (noAnn ? `  🔴 ${noAnn} tools declare NONE ⇒ default-deny ⇒ falls to the \`full\` tier` : ''),
  );
  for (const t of r.probed) {
    console.log(`   ${t.tier.padEnd(5)} ${t.level.padEnd(15)} ${t.name}`);
  }
}

/**
 * Q4 — how the tier picker will actually appear.
 *
 * ⚠ Call the product's ACTUAL `offeredTiers`, don't count by hand: the rule
 * *"only show a tier if it adds ≥1 tool"* lives in there, and that very rule
 * is what produced the 08/27 trap.
 */
function dumpTiers(probed: ProbedTool[]): void {
  const offered = offeredTiers(probed);
  console.log(`\n━━ Q4 · TIER PICKER — the user will see ${offered.length} tiers`);
  for (const o of offered) console.log(`   ◉ ${o.tier.padEnd(5)} ${o.count} tools`);
  const missing = TIERS.filter((t) => !offered.some((o) => o.tier === t));
  if (missing.length) console.log(`   (hidden: ${missing.join(', ')} — adds no tools over the tier below)`);
  if (offered.length <= 1) {
    console.log(
      '   🔴🔴 ONLY ONE TIER ⇒ the picker DOES NOT SHOW ⇒ the user is locked to the lowest tier.\n' +
        '        If this number came from calling /mcp/readonly, that is EXACTLY the 08/27 trap:\n' +
        '        `readOnlyUrl` must flow into `serverFenced()`, not just into `buildConfig()`.',
    );
  }
}

async function tools(as: string): Promise<void> {
  const acc = readStore().accounts[as];
  if (!acc) throw new Error(`Not logged in as "${as}" — run without --tools first.`);

  const full = await listTools(MCP_URL, acc.access_token);
  if ('error' in full) throw new Error(`/mcp: ${full.error}`);
  dumpTools(`Q2 · /mcp   (key requested scope: ${acc.scope_asked ?? '?'} · granted: ${acc.scope ?? '?'})`, full);
  dumpTiers(full.probed);

  const ro = await listTools(MCP_URL_READONLY, acc.access_token);
  if ('error' in ro) {
    console.log(`\n🔴 Q3 · /mcp/readonly failed: ${ro.error}`);
    return;
  }
  dumpTools('Q3 · /mcp/readonly', ro);

  const gone = full.probed.filter((t) => !ro.probed.some((x) => x.name === t.name));
  console.log(`\n━━ Q3 · DIFFERENCE — /readonly cuts out ${gone.length} tools`);
  for (const t of gone) console.log(`   − ${t.tier.padEnd(5)} ${t.name}`);
  console.log(
    `   savings ≈ ${Math.round((full.bytes - ro.bytes) / 4)} tokens/turn` +
      (gone.length === 0
        ? '\n   🔴 CUT 0 TOOLS ⇒ the two URLs are the same ⇒ `readOnlyUrl` buys NOTHING.\n' +
          '      The whole "Linear beats Notion" reasoning collapses right here — re-read before writing any code.'
        : ''),
  );
  const leak = gone.filter((t) => t.tier === 'read');
  if (leak.length) console.log(`   ⚠ ${leak.length} READ tools were also cut: ${leak.map((t) => t.name).join(', ')}`);

  console.log(
    '\n━━ Q5 · KEY-LEVEL ENFORCEMENT — rerun with `--scope read` and compare the two /mcp tables.\n' +
      '   /mcp with a read-scope key gives FEWER TOOLS  ⇒ Linear filters by scope ⇒ TWO real tiers.\n' +
      '   gives the SAME as a write key                 ⇒ only URL-level tiering ⇒ cell D-2 of test 19 must lower expectations.',
  );

  console.log('\n📋 Copy these two numbers into test 19 cell B-6: tool count per tier, and default-tier token count.');
}

// ─────────────────────────────────────────────────────────────────── Q6

async function refresh(as: string): Promise<void> {
  const s = readStore();
  const acc = s.accounts[as];
  if (!acc) throw new Error(`Not logged in as "${as}".`);
  const meta = await discover(MCP_URL);
  if (!meta) throw new Error('discover returned null');

  const before = acc.refresh_token;
  const next = await refreshAccount(meta, acc);
  s.accounts[as] = { ...next, scope_asked: acc.scope_asked };
  writeStore(s);

  console.log('\n━━ Q6 · REFRESHING THE KEY');
  console.log('   new access_token ', next.access_token !== acc.access_token ? '✅' : '⚠ identical to the old one');
  console.log(
    '   refresh_token    ',
    next.refresh_token === before
      ? 'UNCHANGED — server does not rotate'
      : '🔴 ROTATED — the old one is dead now. `applyToken` must keep the new one, or it breaks on the SECOND call (§oauth.ts:440)',
  );
  console.log('   ⚠ The real test is on the SECOND call. Run `--refresh` one more time right now.');
}

// ─────────────────────────────────────────────────────── self-test (0 user consents)

/**
 * Tests the loopback MECHANISM WITHOUT spending a single user consent.
 *
 * Exists because of the 08/29 bug: a broken OAuth round isn't cheap —
 * `state` gets burned, `client_id` gets burned, and the user has to click
 * through again. Sending them to click a button when we don't yet know for
 * sure anyone's listening on the way back is **more expensive than not
 * sending them at all**.
 * → [[agentco-wrong-door-errors]]
 */
async function selftest(): Promise<void> {
  console.log('\n━━ SELF-TEST · loopback port (never touches Linear, needs no clicks)\n');
  const cb = await startCallback();
  const state = randomState();
  const waiter = cb.wait(state);
  const url = `http://127.0.0.1:${cb.port}/callback?code=FAKE_CODE&state=${encodeURIComponent(state)}`;
  console.log('   port listening :', cb.port);

  const res = await fetch(url);
  const code = await waiter;
  cb.close();

  const okPage = res.status === 200;
  const okCode = code === 'FAKE_CODE';
  console.log('   page returned  :', okPage ? '✅ 200' : `🔴 ${res.status}`);
  console.log('   code received  :', okCode ? '✅ FAKE_CODE' : `🔴 "${code}"`);
  console.log(
    '\n   ' +
      (okPage && okCode
        ? '✅ The port we measured and the port that is listening are ONE port. Safe to proceed.'
        : '🔴 Still mismatched — do not ask the user to click Authorize.'),
  );

  // Reverse case: a wrong `state` must be REJECTED, not let through.
  const cb2 = await startCallback();
  // ⚠ Attach `.catch` IMMEDIATELY, don't wait until after `await fetch`: if the
  // promise rejects before anyone is listening for it, Node kills the process
  // with an "unhandled rejection" — and we lose the exact cell we're measuring.
  const w2 = cb2
    .wait('state-of-this-round')
    .then(() => false)
    .catch(() => true);
  await fetch(`http://127.0.0.1:${cb2.port}/callback?code=X&state=state-of-a-different-round`);
  const rejected = await w2;
  cb2.close();
  console.log('   wrong state blocked:', rejected ? '✅' : '🔴 GOT THROUGH — the one-shot lock does nothing');
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
