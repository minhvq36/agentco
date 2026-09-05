
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CLIENT_ID = 'Iv23li95pd8QpYfTGMho';

const MCP_URL = 'https://api.githubcopilot.com/mcp/';

const CLIENT_NAME = 'agentco';

const STORE = path.join(HERE, '..', '.state-spike', 'github-device.json');

interface Account {
  client_id: string;
  access_token: string;
  refresh_token?: string;
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
    /* Windows: chmod is a no-op */
  }
}

const mask = (v?: string): string =>
  v ? `${v.slice(0, 8)}…${v.slice(-4)} (${v.length} chars)` : '—';

const hours = (ms: number): string => `${(ms / 3600_000).toFixed(1)} hours`;


interface AsMeta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
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

  if (!probe) throw new Error(`Could not reach ${mcpUrl} (outbound direction — check proxy/egress).`);
  if (probe.ok) return null;
  if (probe.status !== 401 && probe.status !== 403) {
    throw new Error(`${mcpUrl} returned HTTP ${probe.status} — not an MCP endpoint, and not asking for a key either.`);
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
  throw new Error(`Could not read authorization metadata for ${issuer}.`);
}

async function needAuth(mcpUrl: string): Promise<AsMeta> {
  const m = await discover(mcpUrl);
  if (!m) throw new Error(`${mcpUrl} needs no key — connects directly.`);
  return m;
}


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

class NetError extends Error {}

async function form(
  url: string,
  body: Record<string, string>,
  step = 'call',
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
    throw new NetError(`[${step}] could not reach ${new URL(url).host}: ${(e as Error).message}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`[${step}] response is not JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
}

function toAccount(clientId: string, t: TokenResponse, prev?: Account): Account {
  if (!t.access_token) {
    throw new Error(`No access_token: ${t.error ?? '?'} — ${t.error_description ?? ''}`);
  }
  const { access_token, refresh_token, expires_in, refresh_token_expires_in, token_type, scope, ...extra } = t;
  return {
    client_id: clientId,
    access_token,
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

  console.log(`\n━━ DISCOVERY · ${MCP_URL}`);
  console.log(`   issuer            ${meta.issuer}`);
  console.log(`   DCR               ${meta.registration_endpoint ? '✅ yes' : '🔴 NO (the G2 case)'}`);
  console.log(`   device endpoint   ${meta.device_authorization_endpoint ?? '— NONE'}`);
  console.log(`   grant types       ${JSON.stringify(meta.grant_types_supported ?? [])}`);

  const dev = meta.device_authorization_endpoint;
  if (!dev) {
    throw new Error(
      'This server does not declare `device_authorization_endpoint` ⇒ device flow is not possible.\n' +
        'That is a FACT ABOUT THE SERVER, not a bug here — this vendor needs a different path.',
    );
  }

  const start = (await form(dev, { client_id: clientId })) as unknown as DeviceCode & TokenResponse;
  if (start.error || !start.device_code) {
    throw new Error(
      `Requesting a device code failed: ${start.error ?? '?'} — ${start.error_description ?? ''}\n` +
        `⚠ Most common cause: the app has NOT checked "Enable Device Flow" ⇒ GitHub returns 400.`,
    );
  }

  console.log(`\n━━ Q1 · LOGIN (device flow — 0 secret, 0 callback)`);
  console.log(`\n   ① Open:       ${start.verification_uri}`);
  console.log(`   ② Enter code: ${start.user_code}`);
  console.log(`   ③ Click Authorize. The code is valid for ${Math.round(start.expires_in / 60)} minutes.\n`);

  let interval = (start.interval ?? 5) * 1000;
  const deadline = Date.now() + start.expires_in * 1000;
  const t0 = Date.now();

  for (;;) {
    if (Date.now() > deadline) throw new Error('Code expired — run this command again.');
    await new Promise((r) => setTimeout(r, interval));

    let t: TokenResponse;
    try {
      t = await form(
        meta.token_endpoint,
        {
          client_id: clientId,
          device_code: start.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        },
        'poll',
      );
    } catch (e) {
      if (e instanceof NetError) {
        process.stdout.write(`   ⚠ network hiccup, retrying… (${e.message.slice(0, 60)})\r`);
        continue;
      }
      throw e;
    }

    if (t.error === 'authorization_pending') {
      process.stdout.write('   ⏳ waiting…\r');
      continue;
    }
    if (t.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    if (t.error === 'expired_token') throw new Error('Code expired — run this command again.');
    if (t.error === 'access_denied') throw new Error('You clicked Deny on GitHub.');
    if (t.error) throw new Error(`${t.error} — ${t.error_description ?? ''}`);

    const acc = toAccount(clientId, t);
    const store = readStore();
    store[id] = acc;
    writeStore(store);

    console.log(`   ✅ Q1 · done after  ${Math.round((Date.now() - t0) / 1000)} seconds`);
    console.log(`   access            ${mask(acc.access_token)}`);
    console.log(
      `   refresh           ${acc.refresh_token ? mask(acc.refresh_token) : '🔴 NONE'}`,
    );
    console.log(
      `   ✅ Q2a · expires  ${acc.expires_at ? hours(acc.expires_at - Date.now()) : '🔴 NOT DECLARED (a permanent key?)'}`,
    );
    console.log(
      `   refresh expires   ${acc.refresh_expires_at ? hours(acc.refresh_expires_at - Date.now()) : '—'}`,
    );
    console.log(`   scope             ${acc.scope || '(empty — GitHub App uses permissions, not scope)'}`);
    if (!acc.refresh_token) {
      console.log(
        '\n   🔴 NO refresh_token ⇒ either the app has NOT enabled "Expire user authorization\n' +
          '      tokens", or this is an OAuth App (a permanent key). The auto-refresh mechanism\n' +
          '      does NOT exist for this configuration — the catalog card must say so plainly.',
      );
    }
    return acc;
  }
}


async function refresh(id: string): Promise<void> {
  const store = readStore();
  const acc = store[id];
  if (!acc) throw new Error(`No account "${id}" yet — run --login first.`);
  if (!acc.refresh_token) throw new Error('This account has no refresh_token.');

  const meta = await needAuth(MCP_URL);
  const before = acc.refresh_token;

  console.log(`\n━━ Q2 · REFRESH (sending ONLY client_id + refresh_token, NO secret)`);
  const t = await form(meta.token_endpoint, {
    client_id: acc.client_id,
    grant_type: 'refresh_token',
    refresh_token: before,
  });
  if (t.error) {
    throw new Error(
      `${t.error} — ${t.error_description ?? ''}\n` +
        `⚠ "invalid_client" here means GitHub REQUIRES a client_secret for the refresh flow ⇒\n` +
        `  the "zero secrets for the whole lifecycle" premise BREAKS, and must be recorded in the spec right away.`,
    );
  }

  const next = toAccount(acc.client_id, t, acc);
  store[id] = next;
  writeStore(store);

  const rotated = next.refresh_token !== before;
  console.log(`   ✅ refreshed     with NO secret — it works`);
  console.log(`   new access       ${mask(next.access_token)}`);
  console.log(`   refresh ROTATED  ${rotated ? '🔴 YES — must overwrite, exactly the `??` trap' : '⚪ no'}`);

  if (rotated) {
    const dead = await form(meta.token_endpoint, {
      client_id: acc.client_id,
      grant_type: 'refresh_token',
      refresh_token: before,
    });
    console.log(
      `   reusing the OLD refresh  ${dead.error ? `✅ already dead (${dead.error})` : '🔴 STILL ALIVE — unexpected, re-check'}`,
    );
  }
}


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

function tierOf(t: McpTool): 'read' | 'add' | 'full' {
  const a = t.annotations;
  if (a?.readOnlyHint === true && a.destructiveHint !== true) return 'read';
  if (a?.readOnlyHint === false && a.destructiveHint === false) return 'add';
  return 'full';
}

async function showTools(id: string, url: string, verbose: boolean): Promise<void> {
  const acc = readStore()[id];
  if (!acc) throw new Error(`No account "${id}" yet — run --login first.`);

  const { tools, server } = await handshake(url, acc.access_token);
  const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
  const t = { read: 0, add: 0, full: 0 };
  const noAnn = tools.filter((x) => !x.annotations).length;
  for (const x of tools) t[tierOf(x)] += 1;

  console.log(`\n━━ Q3 · HANDSHAKE · ${url}`);
  console.log(`   ✅ MCP ACCEPTS our app's token — Q3 answered`);
  console.log(`   server            ${server}`);
  console.log(`   tool count        ${tools.length}`);
  console.log(
    `   raw schema        ${bytes.toLocaleString('vi-VN')} bytes  (≈ ${Math.round(bytes / 4).toLocaleString('vi-VN')} tokens — ESTIMATE)`,
  );
  console.log(`   no annotations    ${noAnn}/${tools.length}`);
  console.log(`   three tiers       👁 ${t.read} read · ✍ +${t.add} add · 🔴 +${t.full} edit/delete`);
  if (verbose) for (const x of tools) console.log(`     ${tierOf(x).padEnd(5)} ${x.name}`);

  if (noAnn > 0) {
    console.log(
      '   ⚠ Some tools do NOT declare annotations ⇒ the three-tier split, inferred from what is\n' +
        '     declared, does not cover everything. Absence ≠ safe ⇒ they fall into "full access"\n' +
        '     (the correct one-way rule). ⇒ GitHub\'s "read only" tier should come from the server\'s\n' +
        '     `/readonly` variant instead.',
    );
  }
}

async function survey(id: string): Promise<void> {
  const acc = readStore()[id];
  if (!acc) throw new Error(`No account "${id}" yet — run --login first.`);

  const targets = [
    ['default', 'https://api.githubcopilot.com/mcp/'],
    ['default · readonly', 'https://api.githubcopilot.com/mcp/readonly'],
    ['x/repos', 'https://api.githubcopilot.com/mcp/x/repos'],
    ['x/repos · readonly', 'https://api.githubcopilot.com/mcp/x/repos/readonly'],
    ['x/pull_requests', 'https://api.githubcopilot.com/mcp/x/pull_requests'],
    ['x/issues', 'https://api.githubcopilot.com/mcp/x/issues'],
    ['x/context', 'https://api.githubcopilot.com/mcp/x/context'],
    ['x/all', 'https://api.githubcopilot.com/mcp/x/all'],
  ] as const;

  console.log(`\n━━ Q5 · COST OF EACH SLICE`);
  console.log(`   ${'endpoint'.padEnd(22)} ${'tools'.padStart(5)} ${'bytes'.padStart(9)} ${'≈tokens'.padStart(7)}  three tiers`);
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
    '\n   ⚠ Bytes are for COMPARING slices against each other, not for promising a price. The\n' +
      '     number shown in the UI must come from `getContextUsage().mcpTools` — the two sources\n' +
      '     have diverged by 27% before (§9b ③).',
  );
}

async function whoAmI(id: string): Promise<void> {
  const acc = readStore()[id];
  if (!acc) throw new Error(`No account "${id}" yet — run --login first.`);
  const url = 'https://api.githubcopilot.com/mcp/x/context';
  const { tools, sid } = await handshake(url, acc.access_token);
  const tool = tools.find((t) => /get_me|get_authenticated/.test(t.name))?.name;
  if (!tool) throw new Error(`No identity tool found. Available: ${tools.map((t) => t.name).join(', ')}`);

  console.log(`\n━━ Q6 · WHOSE KEY IS THIS  (tool: ${tool})`);
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

async function toolsetHeader(id: string, csv: string): Promise<void> {
  const acc = readStore()[id];
  if (!acc) throw new Error(`No account "${id}" yet — run --login first.`);

  console.log(`\n━━ Q7 · MERGING SLICES WITH A HEADER · X-MCP-Toolsets: ${csv}`);
  const { tools } = await handshake(MCP_URL, acc.access_token, { 'X-MCP-Toolsets': csv });
  const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
  const t = { read: 0, add: 0, full: 0 };
  for (const x of tools) t[tierOf(x)] += 1;
  console.log(
    `   ${String(tools.length).padStart(3)} tools · ${bytes.toLocaleString('vi-VN')} bytes ` +
      `(≈${Math.round(bytes / 4).toLocaleString('vi-VN')} tokens) · 👁${t.read} ✍${t.add} 🔴${t.full}`,
  );

  const base = await handshake(MCP_URL, acc.access_token);
  console.log(
    `   vs. default        ${base.tools.length} tools ⇒ ` +
      (tools.length === base.tools.length
        ? '🔴 EQUAL — the header was SILENTLY IGNORED, do not trust it'
        : '✅ the header HAS an effect'),
  );
  const readonly = await handshake(MCP_URL, acc.access_token, {
    'X-MCP-Toolsets': csv,
    'X-MCP-Readonly': 'true',
  });
  console.log(
    `   + X-MCP-Readonly    ${readonly.tools.length} tools ⇒ ` +
      (readonly.tools.length < tools.length ? '✅ has an effect' : '🔴 IGNORED'),
  );
}

async function callTool(id: string, url: string, name: string, argsJson: string): Promise<void> {
  const acc = readStore()[id];
  if (!acc) throw new Error(`No account "${id}" yet — run --login first.`);
  const raw = argsJson.startsWith('@') ? fs.readFileSync(argsJson.slice(1), 'utf8') : argsJson;
  const { sid } = await handshake(url, acc.access_token);
  console.log(`\n━━ CALL · ${name}  ${raw.slice(0, 200)}`);
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
  const rpcErr = r.json?.['error'] as { code?: number; message?: string } | undefined;
  if (rpcErr) {
    console.log(`   🔴 REJECTED AT THE PROTOCOL LEVEL — code ${rpcErr.code}: ${rpcErr.message}`);
    console.log('      ⇒ the tool does NOT exist at this endpoint. This is a FENCE, not a failed call.');
    return;
  }
  const result = r.json?.['result'] as { isError?: boolean; content?: { text?: string }[] };
  const text = result?.content?.map((c) => c.text ?? '').join('\n') ?? JSON.stringify(r.json);
  console.log(`   ${result?.isError ? '🔴 TOOL RETURNED AN ERROR' : '✅ OK'} (${text.length} chars)`);
  console.log(text.slice(0, 1200));
}

async function readFile(id: string, repo: string, filePath: string): Promise<void> {
  const acc = readStore()[id];
  if (!acc) throw new Error(`No account "${id}" yet — run --login first.`);
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error('Format: --file owner/repo [path]');

  const url = 'https://api.githubcopilot.com/mcp/x/repos';
  const { tools, sid } = await handshake(url, acc.access_token);
  const tool = tools.find((t) => /get_file_contents/.test(t.name))?.name;
  if (!tool) throw new Error(`No file-reading tool found. Available: ${tools.map((t) => t.name).join(', ')}`);

  console.log(`\n━━ Q4 · PRIVATE REPO · ${repo}  (tool: ${tool})`);
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
      ? `   🔴 CANNOT REACH IT:\n${text.slice(0, 600)}`
      : `   ✅ READABLE (${text.length} chars):\n${text.slice(0, 400)}`,
  );
  console.log(
    '\n   ⚠ If this fails, the MOST COMMON CAUSE is not the key: the GitHub App can only\n' +
      '     reach repos it has been INSTALLED on. Check: github.com/apps/agent-co-app/installations/new',
  );
}


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
    console.log(`\n━━ DISCOVERY · ${url}`);
    if (!m) {
      console.log('   ⇒ 🟢 no key needed — connects directly.');
      return;
    }
    console.log(`   issuer            ${m.issuer}`);
    console.log(`   login at          ${m.authorization_endpoint}`);
    console.log(`   DCR               ${m.registration_endpoint ? '✅ yes' : '🔴 NO (the G2 case)'}`);
    console.log(`   device flow       ${m.device_authorization_endpoint ?? '— not declared'}`);
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
