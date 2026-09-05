/**
 * TEST-HANDSHAKE AN ARM — the source behind the "Try it" button, the
 * capability list, and the token count shown on the node. → docs/SPEC-arms.md §3a · §6c · §7 · §9b
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THREE THINGS MEASURED 23/08 (`scripts/spike-mcp.ts`) THAT THIS FILE IS BUILT ON. │
 * │                                                                          │
 * │ ① A CONTROL REQUEST ONLY RUNS WHILE THE CLI IS IDLE. The query has to be    │
 * │   opened with a generator that KEEPS THE STREAM OPEN while sending no          │
 * │   message, and the stream STILL has to be consumed for control responses to    │
 * │   get pumped out. Original pattern: `core/energy.ts §refresh`. Measured           │
 * │   broken 4/4 times before anyone understood why (§5n ⑤).                       │
 * │                                                                          │
 * │ ② `pending` IS A REAL STATE THAT LASTS SEVERAL SECONDS.                          │
 * │                                                                          │
 * │   ⚠ CORRECTED 24/08 (`scripts/spike-npx-cost.ts`, 10 runs): the old copy         │
 * │   said *"4s once the npx cache is warm, 17.7s the first time"*. The real           │
 * │   number with an ALREADY-cached package is **7.7–9.2s, and the first run is        │
 * │   the same as the third** — "faster next time" was a claim nobody had ever          │
 * │   measured, born from EXACTLY ONE lucky-timing run that then got copied into        │
 * │   three places. ~3.2s is `npx`'s own overhead: running `node <cached file>`         │
 * │   directly costs only 0.8s.                                                  │
 * │                                                                          │
 * │   Asking ONCE and drawing a conclusion measures THE MOMENT ASKED, not the         │
 * │   server itself — the spike's very first measurement gave "0 tools, no             │
 * │   annotations" for exactly that reason.                                          │
 * │                                                                          │
 * │ ③ `getContextUsage()` and the BILL DIFFER BY 27%, and don't measure the same       │
 * │   thing. This file returns `getContextUsage`'s number because it breaks           │
 * │   down PER TOOL — exactly what the interface needs. Don't use this number           │
 * │   to compute a bill.                                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Costs no tokens: no message is sent, no reasoning turn runs. Its cost is
 * DISK and TIME.
 */

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

import { ensureInstalled, fillArm, finishArm } from './armexec.js';
import { missingSecretRefs } from './secrets.js';
import { isCliArm } from './cli-arm.js';
import { isAccountName } from './oauth.js';
import { httpTarget, rawAnnotations } from './mcp-http.js';
import { t } from '../i18n/index.js';

/** Exactly `effectiveTools([])` for a bare role — so the token count stays comparable. */
const BASE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];

/** The first time `npx` has to download a package: measured at 17.7s. The ceiling has to be well above that. */
const CONNECT_TIMEOUT_MS = 45_000;
const POLL_MS = 500;

export interface ProbedTool {
  name: string;
  description?: string;
  /**
   * The approval level inferred from `annotations`. → SPEC-arms.md §8a-bis
   *
   * ⚠ ONE-WAY: only ESCALATES, never DOWNGRADES. `annotations` are the
   * **server's own claim**, not a guarantee — a carelessly (or deliberately)
   * written server can declare `readOnly: true` for a tool that deletes data.
   */
  level: 'read' | 'write_external';
  /** The minimum permission tier for this tool to be granted. → `tierOf` */
  tier: Tier;
}

export interface ProbeResult {
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  serverName?: string;
  serverVersion?: string;
  /** The server's error message, VERBATIM. The only string the user can actually copy and go ask about. */
  error?: string;
  tools: ProbedTool[];
  /**
   * The tiers WORTH showing, with their tool count. Computed HERE, not in the interface.
   *
   * ⚠ The rule *"only show if it adds ≥1 tool over the tier below"* is a
   * product decision with a subtle edge case (an all-read-tool server ⇒ all
   * three tiers come out equal ⇒ the two lower tiers are noise). Letting the
   * interface infer this itself means building a second copy of that rule,
   * and a second copy always forgets a condition. → `offeredTiers`
   */
  tiers?: { tier: Tier; count: number }[];
  /** Tokens this arm adds to the prefix every turn. `undefined` = not yet measured. */
  tokens?: number;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CONNECTED BUT 0 TOOLS — broken, and broken with NO error message at all.       │
   * │ → §5h·7e                                                                  │
   * │                                                                          │
   * │ Measured 26/08: a mistyped group name in `X-MCP-Toolsets` ⇒ GitHub returns       │
   * │ **0 tools and reports no error whatsoever**. Handshake ✓, `status:                │
   * │ 'connected'` ✓, and the arm is completely useless. Same family as                 │
   * │ [[agentco-silent-allowlist]]: an allowlist silently dropping an unrecognized       │
   * │ name — here, it's the VENDOR's own allowlist.                                     │
   * │                                                                          │
   * │ ⚠ DELIBERATELY DOES NOT ask *"which group got dropped"*. The server doesn't        │
   * │ echo back the list it received, so that question can't be answered — and a          │
   * │ mechanism that only works if the vendor agrees to echo something back is a           │
   * │ mechanism that doesn't work. The symptom, though, is DETERMINISTIC and needs         │
   * │ no vendor name at all: **connected with zero tools**. A cheaper question,            │
   * │ correct for every server, with no vendor name anywhere in the code.                  │
   * │ → [[agentco-count-mechanisms]] · [[agentco-deterministic-vs-signal]]              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  warn?: string;
  /** Milliseconds from opening the query to leaving `pending`. Lets the interface know how long to wait. */
  connectMs: number;
}

/**
 * ⚠ `destructive: true` ⇒ `write_external`, NOT `irreversible`.
 *
 * Measured 23/08: `filesystem` attaches `destructive` to
 * `write_file`/`edit_file`/`move_file`. Mapping those to `irreversible` would
 * mean EVERY file write has to ask the user — while `irreversible` is defined
 * as *"send it out · delete · spend money · publish publicly"*, meaning it
 * LEAVES the user's own world. Writing a file to their own disk isn't that.
 *
 * ⇒ `irreversible` CANNOT be inferred from annotations. It has to come from a
 * catalog entry we curate or from the user clicking something — both have an
 * accountable party behind them.
 * → SPEC-arms.md §8a-bis
 */
export function levelOf(a: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } | undefined) {
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ONE-WAY: UNKNOWN ⇒ ESCALATE. NEVER DOWNGRADE. (user, 25/08)                   │
   * │                                                                          │
   * │   *"make sure that if we know 0, it sits at the higher tier — don't have         │
   * │    it declared read-only and then have it turn out it can add/delete/edit          │
   * │    and everything falls apart. In short, DO NOT LIE — when we don't know,           │
   * │    saying full access is not a lie."*                                            │
   * │                                                                          │
   * │ Declaring nothing at all ⇒ `write_external`. This case is REAL:                   │
   * │ `filesystem`'s `create_directory` carries no annotation at all.                    │
   * │                                                                          │
   * │ 🔴 AND THIS IS A HOLE JUST PATCHED 25/08 — the **CONTRADICTORY DECLARATION**       │
   * │ case:                                                                     │
   * │                                                                          │
   * │      { readOnly: true, destructive: true }                               │
   * │                                                                          │
   * │ The old version only checked `readOnly === true` ⇒ sorted it into                 │
   * │ **`read`**, meaning a tool that self-declares as destructive gets granted          │
   * │ under the label *"read-only"*. The server doesn't even have to lie: it only         │
   * │ has to declare **carelessly**, and a contradictory field is the clearest             │
   * │ possible sign of carelessness. We read that declaration under its **more            │
   * │ severe** meaning, always.                                                      │
   * │                                                                          │
   * │ Not hypothetical: a "read-only" arm's `arms[hash].tools` is produced by             │
   * │ exactly this function, and that's what feeds `allowedTools` at runtime.            │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ `destructive: true` ⇒ `write_external`, NOT `irreversible`.
   *
   * Measured 23/08: `filesystem` attaches `destructive` to
   * `write_file`/`edit_file`/`move_file`. Mapping those to `irreversible`
   * would mean EVERY file write has to ask the user — while `irreversible` is
   * defined as *"send it out · delete · spend money · publish publicly"*,
   * meaning it LEAVES the user's own world. Writing a file to their own disk isn't that.
   *
   * ⇒ `irreversible` CANNOT be inferred from annotations. It has to come from
   * a catalog entry we curate or from the user clicking something — both
   * have an accountable party behind them.
   * → SPEC-arms.md §8a-bis · §6j
   */
  const readable = a?.readOnly === true && a?.destructive !== true;
  return readable ? ('read' as const) : ('write_external' as const);
}

/** The three permission tiers the user picks at connect time. → docs/SPEC-arms.md §6j */
export type Tier = 'read' | 'add' | 'full';

/** Progressive order. A later tier **includes** the earlier one — that's what "progressive" means. */
export const TIERS: readonly Tier[] = ['read', 'add', 'full'];

/**
 * Which tier a tool belongs to — **the same one-way rule as `levelOf`, in the same file**.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TIER 2 REQUIRES **BOTH** DECLARATIONS EXPLICITLY. (the user's call, 25/08)     │
 * │                                                                          │
 * │   *"when we don't know something, saying full access is not lying — the         │
 * │    same thing applies to tier 2"*                                           │
 * │                                                                          │
 * │ The easiest place to get wrong: `destructive: false` sitting ALONE looks         │
 * │ like a promise. But per the MCP spec, `destructiveHint` **only has meaning        │
 * │ when `readOnlyHint` is false** — missing that other half means it can't tell        │
 * │ us what we need to know ⇒ **unknown** ⇒ tier 3.                                 │
 * │                                                                          │
 * │ Placed right next to `levelOf` rather than in another file: the two functions       │
 * │ answer the exact same question at two resolutions, and keeping them apart is         │
 * │ what lets them drift out of sync.                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function tierOf(a: { readOnly?: boolean; destructive?: boolean } | undefined): Tier {
  if (levelOf(a) === 'read') return 'read';
  return a?.readOnly === false && a?.destructive === false ? 'add' : 'full';
}

/** Tools granted at a tier — PROGRESSIVE: `add` includes `read`, `full` includes everything. */
export function toolsAtTier(tools: readonly ProbedTool[], tier: Tier): string[] {
  const max = TIERS.indexOf(tier);
  return tools.filter((t) => TIERS.indexOf(t.tier) <= max).map((t) => t.name);
}

/**
 * Which tiers are WORTH showing — the user's call, 25/08: *"if a tier has 0
 * tools, don't offer it as a choice — don't let something meaningless or
 * purely noisy exist with no upside"*.
 *
 * ⚠ The check is **`count(tier) > count(tier below)`**, NOT `> 0`. An
 * all-read-tool server produces three tiers that are **all 14 tools** — the
 * two lower tiers aren't empty, so they'd slip past the "0 tools" rule, even
 * though they **promise more permission while granting nothing extra**.
 */
export function offeredTiers(tools: readonly ProbedTool[]): { tier: Tier; count: number }[] {
  const out: { tier: Tier; count: number }[] = [];
  let prev = 0;
  for (const tier of TIERS) {
    const count = toolsAtTier(tools, tier).length;
    if (count > prev) out.push({ tier, count });
    prev = count;
  }
  return out;
}

/**
 * Opens an EMPTY session just to handshake with `servers`, then closes it. Sends no message.
 *
 * `baseline` = the result of a probe run WITHOUT any MCP; passing it makes
 * `tokens` the DIFFERENCE (what this arm genuinely adds on top). Without it,
 * `tokens` is the full context window total — a correct number that answers a different question.
 */
export async function probeArm(
  servers: Record<string, McpServerConfig>,
  baseline?: number,
  /**
   * The keys injected into the MCP process — MUST be the exact set `pickMcp`
   * will inject at real runtime. Without it, the "Try it" button tests a
   * config WITH NO KEYS and reports ✓, and the arm breaks the first time a worker actually uses it.
   */
  env?: Record<string, string>,
  /**
   * The target for the `<OFFICE_STATE>` placeholder. Must be passed, for the
   * same reason `env` must be passed: a "Try it" click without filling in the
   * placeholder tests a **different** config from what will actually run —
   * and here that difference is very specific: the browser would spawn a
   * folder literally named `<OFFICE_STATE>` right inside the daemon's own working directory.
   */
  dirs?: { officeState: string; officeDir: string },
): Promise<ProbeResult> {
  /**
   * ⚠ THE EXACT SAME `pickMcp` FUNCTION IS USED — `armexec.ts §prepareArm`.
   * This is an invariant, not a convenience: the "Try it" button must test
   * **the exact config that will run**. The earlier version here skipped HTTP
   * servers (hole §5a) ⇒ an HTTP arm needing a key would report ✓ here and
   * then 401 the first time a worker used it.
   *
   * 🔴 ONE PASS, NOT TWO. The earlier version called `injectSecrets` **twice**
   * — once for `dirs`, once for `env` — so the config went through two
   * different paths depending on which field was passed. For a CLI
   * declaration that's a deadly trap: the compile step must run **after**
   * everything has been filled in, and "everything" can't be determined if
   * there's still another fill pass coming afterward.
   */
  /**
   * ⚠ ONLY STEP ① HAPPENS HERE. Step ② (compiling) sits AFTER the blank-field
   * check below — see the comment block at `armexec.ts §fillArm`: a compiled
   * config carries a live `McpServer`, and `missingSecretRefs` inspects things via `JSON.stringify`.
   */
  const filled: Record<string, unknown> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    filled[name] = fillArm(cfg, env ?? {}, dirs);
    servers[name] = filled[name] as McpServerConfig;
  }
  /**
   * Remembered **BEFORE COMPILING** whether this is a CLI declaration: after
   * step ② it has already become `{type:'sdk'}` and can no longer be told
   * apart from an ordinary MCP. The answer only exists here — asking later means asking a different object.
   */
  const hasCli = Object.values(filled).some((c) => isCliArm(c));
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A BLANK FIELD REMAINS ⇒ STOP HERE. No handshake, no 20-second wait, no 401.    │
   * │                                                                          │
   * │ Bug the user reported, 25/08: *"a missing key (left blank) reports the exact       │
   * │ same message [as a wrong key]? Where did I get confused"*. Nowhere — both           │
   * │ cases land on the same server 401, and a 401 can only say *"this key is             │
   * │ wrong"*. The server has no way of knowing we **never filled in a key at              │
   * │ all**; we do know.                                                                │
   * │                                                                          │
   * │ Placed HERE, not in the HTTP route: `probeArm` is the SHARED door for the           │
   * │ "Try it" button, for `readOnlyTools` at click-Done time, and for every                 │
   * │ measurement. Placing it in a route would patch one door while the other three          │
   * │ keep their old behavior — exactly the "two copies of the same rule" class of           │
   * │ bug that has burned this project repeatedly.                                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const missing = missingSecretRefs(servers);
  if (missing.length) {
    /**
     * ⚠ TWO ENTIRELY DIFFERENT SENTENCES, because the user's two required
     * actions are entirely different. (the user caught this, 26/08: *"Notion
     * doesn't even have keys, a human reading that will find it very confusing"*)
     *
     *   a hand-typed key → "fill in that field"
     *   an account       → "click Sign in" — **there's no field to fill in at all**
     *
     * The old copy merged both into *"Missing key:
     * NOTION_OAUTH_AFAFBCD6"*, telling someone to go find something that
     * doesn't exist. Exactly the §5m failure class this very sentence exists to fix — just at a different door.
     */
    const accounts = missing.filter((n) => isAccountName(n));
    const keys = missing.filter((n) => !isAccountName(n));
    const parts: string[] = [];
    if (accounts.length) {
      parts.push(
        t('probe.noAccount'),
      );
    }
    if (keys.length) {
      parts.push(t('probe.missingKeys', { keys: keys.join(', ') }));
    }
    return {
      status: 'failed',
      tools: [],
      connectMs: 0,
      error:
        t('probe.notSentBecause', { parts: parts.join(' ') }),
    };
  }
  /**
   * INSTALLED RIGHT HERE, and this is the CORRECT place to wait for it.
   *
   * The "Try it" button is the ONE moment the user is still standing there
   * and knows they're waiting on a new arm. Pushing the install to the first
   * real run moves that wait into the middle of a task already running, once
   * they've walked away — the exact reasoning used to KEEP this test in the
   * first place (§6c). So pay it here, once, and every run after that stays fast.
   *
   * Fails? Keep going: `fastLaunch` falls back to `npx` as before, and the test is still correct.
   */
  for (const cfg of Object.values(servers)) {
    await ensureInstalled(cfg as Record<string, unknown>);
  }
  /**
   * STEPS ②+③ — compile a CLI declaration, then strip `npx`. Placed here,
   * **after** the blank-field check above, because a compiled config can't be `JSON.stringify`d.
   * → `armexec.ts §fillArm`
   */
  for (const [name, cfg] of Object.entries(servers)) {
    servers[name] = finishArm(name, cfg, env ?? {}, dirs) as McpServerConfig;
  }

  const t0 = Date.now();
  let release: (() => void) | undefined;

  // A generator that NEVER yields — this is exactly what keeps the CLI in
  // the "waiting for input" state, i.e. IDLE. Turning it into a generator that sends a message breaks the whole mechanism.
  const idle = async function* (): AsyncGenerator<never> {
    await new Promise<void>((r) => {
      release = r;
    });
  };

  const q = query({
    prompt: idle(),
    options: {
      tools: BASE_TOOLS,
      allowedTools: BASE_TOOLS,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: servers,
    },
  });

  // Must CONSUME the stream, or control responses never get pumped out.
  const drain = (async () => {
    try {
      for await (const _ of q) {
        /* just need the stream to keep flowing */
      }
    } catch {
      /* closing mid-way makes the SDK throw — expected */
    }
  })();

  const out: ProbeResult = { status: 'pending', tools: [], connectMs: 0 };

  try {
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    let last;
    while (Date.now() < deadline) {
      last = await q.mcpServerStatus();
      if (last.length && last.every((s) => s.status !== 'pending')) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    out.connectMs = Date.now() - t0;

    const s = last?.[0];
    if (s) {
      out.status = s.status;
      out.serverName = s.serverInfo?.name;
      out.serverVersion = s.serverInfo?.version;
      if (s.error) out.error = s.error;
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ 🔴 ASK THE SERVER DIRECTLY FOR `annotations` — THE SDK DROPS EVERY      │
       * │ `false` VALUE (measured 26/08, `spike-sdk-annotations.ts`)             │
       * │                                                                      │
       * │   Notion declares `{readOnlyHint:false, destructiveHint:false}`          │
       * │   The SDK hands us `{}` ⇒ `tierOf` sees "unknown" ⇒ escalates             │
       * │                                                                      │
       * │ Consequence: 11/28 Notion tools that only **create new items** get sorted     │
       * │ into *full access*, the middle tier is permanently empty, and a user who        │
       * │ wants *"allow creating pages, but not editing existing ones"* is forced to       │
       * │ grant editing and deleting too. That's a **least-privilege regression**,        │
       * │ not a tier-counting quirk.                                                   │
       * │                                                                      │
       * │ ⚠ The one-way rule is NOT wrong — it's correctly processing a fact that got     │
       * │ lost along the way. So the fix doesn't touch `tierOf`; it goes and recovers      │
       * │ the fact instead.                                                          │
       * │                                                                      │
       * │ Fails ⇒ `raw` comes back empty ⇒ falls back to the SDK's own annotations,       │
       * │ i.e. exactly the pre-26/08 behavior: worse, but **not wrong** (escalating =      │
       * │ safe).                                                                       │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      const target = out.status === 'connected' ? httpTarget(Object.values(servers)[0]) : undefined;
      const raw = target ? await rawAnnotations(target.url, target.headers) : new Map();

      out.tools = (s.tools ?? []).map((t) => {
        // Raw data overrides the SDK when available — it's the MORE COMPLETE
        // version of the same thing. Without it, use the SDK's own copy;
        // never mix the two halfway (mixing would produce a set of annotations no server ever declared).
        const a = raw.get(t.name);
        const ann = a
          ? { readOnly: a.readOnlyHint, destructive: a.destructiveHint, openWorld: a.openWorldHint }
          : t.annotations;
        return {
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
          level: levelOf(ann),
          tier: tierOf(ann),
        };
      });
      /**
       * ⚠ A CLI ARM HAS NO TIERS — the user's call, 30/08, and this has to be
       * ENFORCED here, not just written in the spec.
       *
       * A CLI tool's `annotations` are built by OURSELVES from the
       * `read_only` checkbox, so `offeredTiers` would obediently offer up
       * `read`/`full`. Showing the tier picker would promise a fence **with
       * nothing behind it enforcing it**: `addArm` for CLI never passes a
       * `level`, and `pickMcp` grants the entire tool list in the
       * declaration. Exactly the kind of promise §14 already went to the
       * trouble of removing once, in test 11.
       *
       * ⇒ CLI's real gates are two different things: **who gets wired to it**
       * + `confirm` on each individual action. Stating honestly that it's
       * "full access" lets the user actually weigh it; offering three fake
       * tiers gives them false reassurance.
       */
      if (out.tools.length && !hasCli) out.tiers = offeredTiers(out.tools);
    }

    // Only measure tokens once connected: asking while `pending` measures a
    // prefix with no tools in it — a very convincing, completely meaningless zero.
    if (out.status === 'connected' && baseline !== undefined) {
      const ctx = (await q.getContextUsage()) as { totalTokens: number };
      out.tokens = Math.max(0, ctx.totalTokens - baseline);
    }

    // Connected but empty — see the comment block at `ProbeResult.warn`.
    // Placed last so it sees `out.tools` in its final state, not mid-way through.
    if (out.status === 'connected' && out.tools.length === 0) {
      out.warn = t('probe.zeroTools');
    }
  } catch (e) {
    out.status = 'failed';
    out.error = (e as Error).message;
    out.connectMs = Date.now() - t0;
  } finally {
    release?.();
    await Promise.race([drain, new Promise((r) => setTimeout(r, 2_000))]);
  }

  return out;
}

/**
 * The prefix of a BARE role, no arms at all. The reference point for subtracting out the MCP portion.
 *
 * Cached in-process: it doesn't change between two asks within the same
 * daemon session, and each ask costs a few hundred milliseconds.
 */
let baselineCache: number | undefined;

export async function baselineTokens(): Promise<number | undefined> {
  if (baselineCache !== undefined) return baselineCache;

  let release: (() => void) | undefined;
  const idle = async function* (): AsyncGenerator<never> {
    await new Promise<void>((r) => {
      release = r;
    });
  };
  const q = query({
    prompt: idle(),
    options: {
      tools: BASE_TOOLS,
      allowedTools: BASE_TOOLS,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
    },
  });
  const drain = (async () => {
    try {
      for await (const _ of q) {
        /* */
      }
    } catch {
      /* */
    }
  })();

  try {
    const ctx = (await Promise.race([
      q.getContextUsage(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), 20_000)),
    ])) as { totalTokens: number };
    baselineCache = ctx.totalTokens;
  } catch {
    // Couldn't get it — fine, `tokens` will be `undefined` and the interface
    // has to handle that. An honest blank beats a made-up number.
  } finally {
    release?.();
    await Promise.race([drain, new Promise((r) => setTimeout(r, 2_000))]);
  }
  return baselineCache;
}
