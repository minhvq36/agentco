/**
 * SPIKE 1 + 2 — docs/SPEC-arms.md §3 · §7 · §8 · §9 · §12
 *
 * §3 of SPEC-arms is currently 📖 (read from `.d.ts`, never run once). This
 * script turns three rows of that table into ✅ or refutes them.
 *
 *   SPIKE 1 · Does `mcpServerStatus()` return `tools[]` with `annotations`?
 *             → the source for the CAPABILITY LINE (§7) and the APPROVAL TIER (§8a).
 *             Both designs collapse at once if it's empty.
 *
 *   SPIKE 2 · Are MCP tools inside the CACHED PREFIX?
 *             → the BLOCKING question for §9b. If they are, plugging in 3 MCP
 *             servers could exceed even the shell's combined 2,688 tokens, and
 *             the "don't take `ToolSearch`" decision (§5c) has to be reopened
 *             WITH A MEASUREMENT.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TWO MEASUREMENT TRAPS ALREADY PAID FOR, DON'T STEP IN THEM AGAIN         │
 * │                                                                          │
 * │ ① THE CONTROL REQUEST ONLY RUNS WHILE THE CLI IS IDLE (§5n ⑤ — it took   │
 * │   4 broken measurements in a row to understand this). So the query must  │
 * │   be opened with a generator that KEEPS THE STREAM OPEN while sending    │
 * │   NOTHING, and the stream still has to be CONSUMED for the control       │
 * │   response to be pumped out. The canonical pattern lives in              │
 * │   `core/energy.ts §refresh` — copy it exactly, don't improvise.          │
 * │                                                                          │
 * │ ② THE SECOND MEASUREMENT HITS THE FIRST ONE'S CACHE and comes out with a │
 * │   delta of 0 (§5n ⑬). A NONCE must be planted in the system prompt to    │
 * │   force a miss on both runs. Without a nonce this script will report     │
 * │   "MCP costs 0 tokens" very convincingly.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Run: npx tsx scripts/spike-mcp.ts [--paid]
 *   no flag   → SPIKE 1 + the FREE part of SPIKE 2 (`getContextUsage`) only
 *   --paid    → also run 2 real turns to reconcile against the invoice (~$0.02)
 */

import { query, type McpServerConfig, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

const PAID = process.argv.includes('--paid');

/** The 7 office tools — exactly what `effectiveTools([])` sends down for a bare role. */
const OFFICE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];

/**
 * The test arm = catalog entry #1 (`SPEC-arms.md` §4e). Chosen over some
 * arbitrary server because it's the one that WILL ship: the measurement has
 * to speak about the real thing.
 */
const FILES: McpServerConfig = {
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
};

/** The CORRECT pattern for asking the CLI while it's idle. → `core/energy.ts §refresh` */
async function probe<T>(
  label: string,
  mcpServers: Record<string, McpServerConfig> | undefined,
  ask: (q: Awaited<ReturnType<typeof query>>) => Promise<T>,
): Promise<T | undefined> {
  let release: (() => void) | undefined;
  const idle = async function* (): AsyncGenerator<never> {
    await new Promise<void>((r) => {
      release = r;
    });
  };

  const q = query({
    prompt: idle(),
    options: {
      tools: OFFICE_TOOLS,
      allowedTools: OFFICE_TOOLS,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      ...(mcpServers ? { mcpServers } : {}),
    },
  });

  // The stream MUST be consumed, or the control response never gets pumped out.
  const drain = (async () => {
    try {
      for await (const _ of q) {
        /* just needs the stream flowing */
      }
    } catch {
      /* closing mid-stream makes the SDK throw — expected */
    }
  })();

  try {
    return await Promise.race([
      ask(q),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('30s timeout')), 30_000)),
    ]);
  } catch (e) {
    console.log(`   ✗ ${label}: ${(e as Error).message}`);
    return undefined;
  } finally {
    release?.();
    await Promise.race([drain, new Promise((r) => setTimeout(r, 2_000))]);
  }
}

// ══════════════════════════════════════════════════ SPIKE 1 · mcpServerStatus

console.log('\n═══ SPIKE 1 · mcpServerStatus() — §7 and §8a both depend on it ═══\n');
console.log('   plugging in: npx -y @modelcontextprotocol/server-filesystem (downloads on first run, a bit slow)\n');

/**
 * ⚠ MUST WAIT, and the first measurement run stepped right into this trap:
 * asking immediately returns `status=pending · tools: 0`, and concluded
 * "annotations don't exist" — when all that was actually measured was WHEN
 * we asked. The `.d.ts` says it plainly: *"MCP startup is otherwise
 * non-blocking by default"*.
 *
 * ⇒ Keep asking until it leaves `pending`. A measurement taken during a
 * transient state proves nothing about the API. [[agentco-measurement-vs-conclusion]]
 */
const status = await probe('mcpServerStatus', { files: FILES }, async (q) => {
  for (let i = 0; i < 40; i++) {
    const s = await q.mcpServerStatus();
    if (s.length && s.every((x) => x.status !== 'pending')) {
      if (i) console.log(`   (waited ${i * 500}ms before leaving pending)`);
      return s;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('   ⚠ still pending after 20s');
  return q.mcpServerStatus();
});

let annotated = 0;
let toolCount = 0;

if (!status || status.length === 0) {
  console.log('   ✗ NO server was returned. §7 and §8a both lose their source.');
} else {
  for (const s of status) {
    console.log(`   server "${s.name}"  status=${s.status}`);
    if (s.serverInfo) console.log(`      serverInfo: ${s.serverInfo.name} v${s.serverInfo.version}`);
    if (s.error) console.log(`      error: ${s.error}`);
    const tools = s.tools ?? [];
    toolCount = tools.length;
    console.log(`      tools: ${tools.length}`);
    for (const t of tools) {
      const a = t.annotations;
      if (a && (a.readOnly !== undefined || a.destructive !== undefined || a.openWorld !== undefined)) {
        annotated++;
      }
      const flags = a
        ? `readOnly=${a.readOnly ?? '—'} destructive=${a.destructive ?? '—'} openWorld=${a.openWorld ?? '—'}`
        : '(NO annotations)';
      console.log(`        · ${t.name.padEnd(28)} ${flags}`);
    }
  }
}

// ══════════════════════════════════════════════════ SPIKE 2a · getContextUsage

console.log('\n═══ SPIKE 2a · getContextUsage() — FREE, and it answers the §9b BLOCKING question ═══\n');

interface Ctx {
  categories: { name: string; tokens: number; isDeferred?: boolean }[];
  mcpTools: { name: string; serverName: string; tokens: number; isLoaded?: boolean }[];
  systemTools?: { name: string; tokens: number }[];
  totalTokens: number;
}

async function ctx(label: string, servers?: Record<string, McpServerConfig>) {
  const r = (await probe(label, servers, async (q) => {
    // Same reason as SPIKE 1: asking before the server finishes its handshake
    // returns an empty `mcpTools`, and "empty" here CANNOT tell apart three
    // very different situations — *not connected yet* · *deferred* ·
    // *costs nothing*. Wait out the first one.
    if (servers) {
      for (let i = 0; i < 40; i++) {
        const s = await q.mcpServerStatus();
        if (s.length && s.every((x) => x.status !== 'pending')) break;
        await new Promise((r2) => setTimeout(r2, 500));
      }
    }
    return q.getContextUsage();
  })) as Ctx | undefined;
  if (!r) return undefined;
  const mcpTokens = r.mcpTools.reduce((n, t) => n + t.tokens, 0);
  const loaded = r.mcpTools.filter((t) => t.isLoaded !== false).length;
  console.log(`   [${label}]  total=${r.totalTokens}  mcpTools=${r.mcpTools.length} (loaded ${loaded}) = ${mcpTokens} tokens`);
  for (const c of r.categories) {
    if (c.tokens > 0) console.log(`      ${c.name.padEnd(24)} ${String(c.tokens).padStart(7)}${c.isDeferred ? '   (DEFERRED)' : ''}`);
  }
  return { total: r.totalTokens, mcpTokens, count: r.mcpTools.length, loaded };
}

const bare = await ctx('no MCP');
console.log('');
const withMcp = await ctx('with MCP files', { files: FILES });
console.log('');
/**
 * The THIRD condition, and it's the only one that can tell apart the two
 * explanations for a 0: *"the tool is DEFERRED"* vs *"the tool wasn't
 * loaded"*. 📖 `.d.ts`: `alwaysLoad` = *"never deferred behind tool search"*,
 * and it **blocks startup until the server finishes connecting** — which
 * also rules out the "asked too early" case.
 */
const forced = await ctx('with MCP files · alwaysLoad', { files: { ...FILES, alwaysLoad: true } });

// ══════════════════════════════════════════════════ SPIKE 2b · real invoice

let paidDelta: number | undefined;

if (PAID) {
  console.log('\n═══ SPIKE 2b · REAL INVOICE — 2 turns, nonce breaks the cache ═══\n');

  async function billed(label: string, servers?: Record<string, McpServerConfig>) {
    // ⚠ NONCE in the system prompt. Without it the second run hits the first
    // run's cache and the delta comes out to 0 — the exact trap that once
    // produced the wrong "Bash only adds 1 token" number.
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const msg = {
      type: 'user',
      message: { role: 'user', content: 'Reply with exactly one word: done' },
      parent_tool_use_id: null,
      session_id: '',
    } as SDKUserMessage;

    const q = query({
      prompt: (async function* () {
        yield msg;
      })(),
      options: {
        systemPrompt: `You are a test assistant. [nonce ${nonce}]`,
        model: 'claude-haiku-4-5-20251001',
        tools: OFFICE_TOOLS,
        allowedTools: OFFICE_TOOLS,
        maxTurns: 1,
        persistSession: false,
        settingSources: [],
        strictMcpConfig: true,
        ...(servers ? { mcpServers: servers } : {}),
      },
    });

    let write = 0;
    let read = 0;
    let cost = 0;
    for await (const m of q as AsyncGenerator<Record<string, unknown>>) {
      if (m['type'] !== 'result') continue;
      const mu = (m['modelUsage'] ?? {}) as Record<string, Record<string, number>>;
      for (const v of Object.values(mu)) {
        write += v['cacheCreationInputTokens'] ?? 0;
        read += v['cacheReadInputTokens'] ?? 0;
      }
      cost = typeof m['total_cost_usd'] === 'number' ? m['total_cost_usd'] : 0;
    }
    console.log(`   [${label}]  cache_write=${write}  cache_read=${read}  $${cost.toFixed(5)}`);
    if (read > 0) console.log('      ⚠ cache_read > 0 ⇒ THE NONCE DID NOT BREAK THE CACHE. The number below is meaningless.');
    return write;
  }

  /**
   * ⚠ `alwaysLoad: true` HERE isn't for measuring the deferral mechanism (2a
   * already measured that: there's no deferral). It's here to **rule out a
   * race**: 📖 the `.d.ts` says MCP startup is NOT blocking by default, so
   * turn-1 could get built BEFORE the server finishes connecting ⇒ we'd
   * measure a prefix with no tools and conclude "MCP is free".
   *
   * `alwaysLoad` blocks startup until the connection finishes, *"since the
   * tools must be present when the turn-1 prompt is built"*. 2a already
   * proved it doesn't change the number, so using it here rules out noise
   * rather than changing what's being measured.
   */
  const w0 = await billed('no MCP');
  const w1 = await billed('with MCP files', { files: { ...FILES, alwaysLoad: true } });
  paidDelta = w1 - w0;
}

// ══════════════════════════════════════════════════ CONCLUSION

console.log('\n─── CONCLUSION ───\n');

console.log(`SPIKE 1 · tools[] has content          ${toolCount > 0 ? `✅ YES — ${toolCount} tools` : '❌ NO'}`);
console.log(
  `SPIKE 1 · annotations has content      ${
    annotated > 0 ? `✅ YES — ${annotated}/${toolCount} tools` : '❌ NO — §8a loses its source, must default everything to write_external'
  }`,
);

if (bare && withMcp && forced) {
  const d1 = withMcp.total - bare.total;
  const d2 = forced.total - bare.total;
  console.log(`\nSPIKE 2a · prefix without MCP          ${bare.total}`);
  console.log(`SPIKE 2a · prefix with MCP (default)   ${withMcp.total}   (${d1 >= 0 ? '+' : ''}${d1})`);
  console.log(`SPIKE 2a · prefix with MCP · alwaysLoad ${forced.total}   (${d2 >= 0 ? '+' : ''}${d2})`);
  console.log(
    `\nSPIKE 2a · Is tool loading DEFERRED by default?\n` +
      `   ${
        d1 === 0 && d2 > 0
          ? '✅ YES, DEFERRED — 0 tokens by default, alwaysLoad is what starts billing ⇒ §9b is CLOSED as a blocker'
          : d1 > 0
            ? '🔴 NOT DEFERRED — MCP tools sit in the prefix on EVERY turn ⇒ §9b is a real blocker'
            : '❓ BOTH are 0 — cannot yet tell "deferred" apart from "not loaded". Measure again.'
      }`,
  );
}

if (paidDelta !== undefined) {
  console.log(`\nSPIKE 2b · invoice: MCP adds           ${paidDelta >= 0 ? '+' : ''}${paidDelta} tokens/turn`);
}

console.log(
  `\n⚠ Boundary: measured with EXACTLY ONE server (${toolCount} tools). A 40-tool server would give\n` +
    `  a different number, and the relationship between the two numbers is NOT measured. Don't extrapolate\n` +
    `  linearly — remeasure once there's a second catalog entry.`,
);

process.exit(0);
