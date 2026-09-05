/**
 * ASK AN HTTP MCP SERVER `tools/list` DIRECTLY — purely to get RAW `annotations`.
 * → docs/SPEC-arms.md §6j · `core/probe.ts`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 WHY THIS FILE EXISTS: THE SDK DROPS EVERY ANNOTATION WHOSE VALUE IS   │
 * │ `false`. (measured 26/08, `scripts/spike-sdk-annotations.ts` — decisive) │
 * │                                                                          │
 * │   Notion declares  `{readOnlyHint: false, destructiveHint: false}`       │
 * │   the SDK hands us `{}`                                                  │
 * │   Notion declares  `{readOnlyHint: false, destructiveHint: true}`        │
 * │   the SDK hands us `{destructive: true}`                                 │
 * │                                                                          │
 * │ ⇒ `destructive: false` IS NOT REPRESENTABLE through the SDK. And the     │
 * │ middle tier ("read + create new, no editing or deleting") is defined     │
 * │ PRECISELY BY the pair `readOnly:false + destructive:false` — so it is    │
 * │ permanently empty, and 11 of Notion's 28 tools that only CREATE get      │
 * │ pushed into the FULL-ACCESS bucket.                                      │
 * │                                                                          │
 * │ ⚠⚠ THIS IS NOT ABOUT COUNTING TIERS. It is a LEAST-PRIVILEGE REGRESSION: │
 * │ the user wants *"let the agent create pages, do not let it edit old      │
 * │ ones"* — exactly what Notion supports — and the system forces them to    │
 * │ grant editing and deleting too. The rule "when unknown, escalate" is NOT │
 * │ wrong; it is acting on a fact that was lost in transit.                  │
 * │                                                                          │
 * │ ⚠ Used for CLASSIFICATION ONLY; it replaces the SDK nowhere else. Tool   │
 * │ calls, session lifecycle, permissions — all still the SDK's. This is one │
 * │ read, once, at plug-in time. On failure it falls back to the SDK's       │
 * │ annotations: WORSE, BUT NOT WRONG (falling back to a higher tier is the  │
 * │ safe direction when we do not know).                                     │
 * │                                                                          │
 * │ ⚠ And it imports NO vendor SDK — the same rule as `core/oauth.ts`. Swap  │
 * │ the agent runtime and this file travels intact.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** Exactly MCP's four standard fields. → `@modelcontextprotocol/sdk §ToolAnnotationsSchema` */
export interface RawAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

const PROTOCOL = '2025-06-18';

/**
 * Streamable HTTP returns SSE, not bare JSON: an `event:`/`data:` block. Take the
 * first `data:` line. If there is none, try reading the whole body as JSON —
 * some servers answer with plain JSON when the client does not ask for
 * `text/event-stream`.
 */
function parseBody(text: string): { result?: unknown; error?: unknown } | null {
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  try {
    return JSON.parse(line ? line.slice(5).trim() : text) as { result?: unknown; error?: unknown };
  } catch {
    return null;
  }
}

/**
 * RAW `annotations` keyed by tool name. Throwing or empty ⇒ the caller falls back
 * to the SDK itself.
 *
 * ⚠ Three steps, in protocol order, and SKIPPING STEP TWO BREAKS HALF THE
 * SERVERS: many implementations refuse `tools/list` until they have received
 * `notifications/initialized`.
 */
type Post = (body: unknown) => Promise<{ result?: unknown; error?: unknown } | null>;

/**
 * Complete the handshake, then hand back a `post` that still holds the session.
 *
 * ⚠ It exists because TWO callers need exactly these three steps
 * (`rawAnnotations` and `callTool`), and a second copy of a protocol dance
 * drifts on the day somebody fixes one of them. Same reason `injectSecrets`
 * merges `pickMcp` with `probeArm`.
 */
async function withSession<T>(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  fallback: T,
  fn: (post: Post) => Promise<T>,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let session = '';
    const post: Post = async (body) => {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': PROTOCOL,
          ...headers,
          ...(session ? { 'mcp-session-id': session } : {}),
        },
        body: JSON.stringify(body),
      });
      const sid = res.headers.get('mcp-session-id');
      if (sid) session = sid;
      if (!res.ok) return null;
      return parseBody(await res.text());
    };

    const init = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'agentco', version: '1' },
      },
    });
    if (!init?.result) return fallback;

    // A notification, not a request — no `id`, no response to read.
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return await fn(post);
  } catch {
    // Network down · server does not speak streamable HTTP · timeout — fall back.
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

export async function rawAnnotations(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10_000,
): Promise<Map<string, RawAnnotations>> {
  const out = new Map<string, RawAnnotations>();
  return withSession(url, headers, timeoutMs, out, async (post) => {
    const listed = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = (listed?.result as { tools?: { name?: string; annotations?: RawAnnotations }[] })?.tools;
    for (const t of tools ?? []) {
      if (typeof t?.name === 'string' && t.annotations) out.set(t.name, t.annotations);
    }
    return out;
  });
}

/**
 * The toolset names the server ACTUALLY emits — to compare against what we asked for.
 *
 * ⚠ Measured 26/08: a misspelt toolset name in `X-MCP-Toolsets` makes the server
 * return ZERO TOOLS AND NO ERROR. Silently dropping an unknown name, the same
 * family as [[agentco-silent-allowlist]] — the same class as the `tools` case
 * that `warnDroppedTools` was built to watch. An arm that is "plugged in with 0
 * actions" and nobody complaining is an arm that failed silently.
 */
export async function toolCount(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10_000,
): Promise<number> {
  return withSession(url, headers, timeoutMs, -1, async (post) => {
    const listed = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = (listed?.result as { tools?: unknown[] })?.tools;
    return Array.isArray(tools) ? tools.length : -1;
  });
}

/**
 * Call ONE tool and return its text. `null` = the call could not be made.
 *
 * Used for the IDENTITY QUESTION (§5h·7k): when a vendor does not return an
 * account name in its token response, we ask it over the protocol we already
 * have. Not a new route — still MCP, still the same session, still no vendor SDK.
 */
export async function callTool(
  url: string,
  headers: Record<string, string>,
  name: string,
  args: Record<string, unknown> = {},
  timeoutMs = 10_000,
): Promise<string | null> {
  return withSession(url, headers, timeoutMs, null as string | null, async (post) => {
    const r = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } });
    // `error` = the tool does not exist at this door (a fence). `isError` = the
    // tool ran and failed. Neither is data, so both return `null`.
    if (!r || r.error) return null;
    const res = r.result as { isError?: boolean; content?: { type?: string; text?: string }[] };
    if (res?.isError) return null;
    const text = (res?.content ?? [])
      .map((c) => (typeof c?.text === 'string' ? c.text : ''))
      .join('\n')
      .trim();
    return text || null;
  });
}

/**
 * Can this config be asked directly? HTTP only — stdio would mean spawning a
 * process and speaking MCP down a pipe, i.e. rebuilding an entire second client.
 * Not worth it: the only stdio arm today is `filesystem`, and it has no tiers.
 */
export function httpTarget(
  config: unknown,
): { url: string; headers: Record<string, string> } | undefined {
  const c = config as { url?: unknown; headers?: unknown } | null;
  if (!c || typeof c.url !== 'string') return undefined;
  const headers: Record<string, string> = {};
  if (c.headers && typeof c.headers === 'object') {
    for (const [k, v] of Object.entries(c.headers as Record<string, unknown>)) {
      if (typeof v === 'string') headers[k] = v;
    }
  }
  return { url: c.url, headers };
}
