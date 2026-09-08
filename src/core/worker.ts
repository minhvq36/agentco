/**
 * Runs one worker: a SINGLE one-shot query, then it's done.
 *
 * → docs/SPEC-2026-08-14-agentco.md §2, §8
 *
 * An agent is a stateless function: arrives, works, writes a file, dies.
 * Memory lives in the knowledge graph, not in the context window. This is
 * why we use persistSession:false — the session only exists in RAM for the
 * duration of the call.
 */

import { query, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import type { LoadedOffice } from './config.js';
import fs from 'node:fs';
import path from 'node:path';
import { redactBrowserLogs } from './redact.js';

import { prepareArm } from './armexec.js';
import { findArm, folderRoots } from './catalog.js';
import { noteRateLimit } from './energy.js';
import { isAccountName } from './oauth.js';
import { companyPaths, guardedZone, safeJoin, type GuardedZone, type GuardMode } from './paths.js';
import { grantFor, injectSecrets, keysFor, readSecrets } from './secrets.js';
import { buildTaskMessage, buildWorkerPrompt } from './prompt.js';
import { enforceCap, parseReceipt, repairPrompt } from './receipt.js';
import { relative } from 'node:path';
import { hasShell } from './types.js';
import {
  EMPTY_USAGE,
  EXTERNAL_TOOLS,
  RunError,
  type FailureKind,
  type Landing,
  type Observed,
  type Receipt,
  type Role,
  type TaskBrief,
  type Tier,
  type Usage,
  type WorkPlace,
} from './types.js';
import { effectiveTools } from './types.js';
import { splitArmTool } from './audit.js';
import { doSpill, planSpill, spillNotice } from './spill.js';
/**
 * ⚠ `t()` here is ONLY for the half a PERSON reads — the status line and the
 * stop reasons. Everything handed to the MODEL (`JAIL_REASON`, the GitHub 404
 * hint, replacement tool results) stays a hard-coded English literal: a prompt
 * that follows the interface switch is the wire the language rule forbids.
 */
import { plural, t } from '../i18n/index.js';
import { formatUSD } from '../i18n/fmt.js';

export interface WorkerDeps {
  office: LoadedOffice;
  /** Called before firing the request; the scheduler uses this to gate cache priming. */
  acquireCacheSlot?(cacheKey: string): Promise<() => void>;
  /**
   * `place` rides along with the sentence, and it is the half a MACHINE can
   * read. → `placeOf` · docs/SPEC-office-animation.md §6c
   *
   * Optional on purpose: a turn that called no tool has no place, and callers
   * that only want the sentence (every spike script, the CLI) ignore it.
   */
  onProgress?(say: string, place?: { at: WorkPlace; arm?: string }): void;
  /**
   * ONE MCP call happened — for the audit log. → `core/audit.ts`
   *
   * ⚠ Fires for **every** call, not just the first like `onProgress`. Miss
   * one call and it stops being an audit.
   */
  onArmCall?(call: {
    server: string;
    tool: string;
    role: string;
    plan_id?: string;
    task_id?: string;
    args: unknown;
  }): void;
  /**
   * Output directory for THIS TASK — `artifacts/<plan_id>/<task_id>/`.
   *
   * ⚠ The worker can't build this itself: `TaskBrief` deliberately does NOT
   * carry `plan_id` (see `onArmCall`), so the scheduler is the one that knows
   * the plan id. Passed down instead of adding a field to the brief — same
   * reasoning already used for the log's `plan_id`.
   *
   * Missing ⇒ the output lands at the root of `artifacts/`, i.e. an ORPHAN
   * entry belonging to no plan. Acceptable (no data lost), but not the right
   * shape. → `core/spill.ts §planSpill`
   */
  outDir?: string;
  /**
   * Hand back a handle to INTERRUPT MID-RUN. The scheduler holds it, `Esc` /
   * `/stop` calls into it. → docs/SPEC-tools-approval.md §3b
   */
  onStart?(handle: WorkerHandle): void;
}

export interface WorkerHandle {
  /** Interrupt the running call immediately. Only works in streaming input mode. */
  interrupt(): Promise<void>;
}

/**
 * A stream-shaped message source — yields one message then CLOSES.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MEASURED, DON'T RETRY: both ways of interrupting through                 │
 * │ `Query.interrupt()` are broken.                                          │
 * │                                                                          │
 * │ (a) Stream closes immediately (this version): `interrupt()` calls into   │
 * │     nothing. Hit Stop and all three tasks still ran to completion —      │
 * │     measured $0.36 spent after the stop.                                 │
 * │ (b) Stream STAYS OPEN so `interrupt()` has something to grab: the worker  │
 * │     finishes writing its file and then NEVER returns a `result` — the    │
 * │     SDK sits waiting for more input. DEADLOCK, measured: past 90 seconds  │
 * │     with no event at all, had to kill the daemon.                        │
 * │                                                                          │
 * │ So the REAL stop switch is the `abortController` below, not               │
 * │ `interrupt()`. Streaming input mode is kept because it's harmless and is  │
 * │ the groundwork for whenever the SDK/CLI supports it properly.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
async function* oneMessage(text: string): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
  } as SDKUserMessage;
}

export interface WorkerInput {
  brief: TaskBrief;
  role: Role;
  hotKnowledge: string;
  coldKnowledge: string;
}

export async function runWorker(deps: WorkerDeps, input: WorkerInput): Promise<Receipt> {
  const { office } = deps;
  const { brief, role } = input;
  const started = Date.now();

  // Two directories, because the forbidden zone lives at BOTH levels: the key
  // in `company/.state/`, the role file in `offices/<id>/roles/`. → paths.ts §guardedZone
  /**
   * ⚠ `hasBrowser` is resolved **once, here**, not looked up again inside the
   * gate.
   *
   * `role.mcp` is the only source of *"who holds which arm"*, and
   * `arms[hash].catalog` is the only place that says which catalog entry that
   * hash is. Letting `guardedZone` look both tables up itself turns a pure
   * path function into something that needs the whole company built just to
   * test. → `paths.ts §guardedZone`
   */
  const jailDirs = {
    companyDir: office.companyDir,
    officeDir: office.dir,
    hasBrowser: role.mcp.some((id) => office.company.arms?.[id]?.catalog === 'browser'),
  };

  /**
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 AN ARM: THREE THINGS, ALL OR NOTHING. (measured 08/24, case          │
   * │ `P-260824-0355`)                                                       │
   * │                                                                        │
   * │ Before this fix, an arm that was plugged in AND wired still DIDN'T      │
   * │ WORK. Two holes stacked on top of each other, both silent:              │
   * │                                                                        │
   * │  ① `allowedTools` only held the 7 office tools (+shell). An MCP tool     │
   * │    name is `mcp__<server>__<tool>` ⇒ not in that list ⇒ the SDK treats  │
   * │    it as "needs asking" ⇒ no `canUseTool` ⇒ **denied**. The exact       │
   * │    measured text:                                                      │
   * │    *"Claude requested permissions to use mcp__files__list_directory_    │
   * │    with_sizes, but you haven't granted it yet."*                       │
   * │    Real receipt: 3 calls, 3 blocked, `blocked`, $0.0948.                │
   * │                                                                        │
   * │  ② The directory the user declared in the dialog was **DROPPED           │
   * │    ENTIRELY**. `server-filesystem` prefers the client's `roots` over     │
   * │    the command-line `args`, and Claude Code declares `cwd` (+           │
   * │    `additionalDirectories`) as roots. Measured: keep `args` unchanged,   │
   * │    change `cwd` → the allowed directory list changes with `cwd`. ⇒ an    │
   * │    arm pointed at `D:\Downloads\…` could in practice only open the       │
   * │    office directory — exactly what a bare `Read` already does, for      │
   * │    free.                                                                │
   * │                                                                        │
   * │ ⇒ We were paying **~2,185 tokens PER TURN** (measured 08/23) for a set  │
   * │ of tools that never worked. An arm plugged in just to be looked at.     │
   * │                                                                        │
   * │ Fixing ① and forgetting ② means the arm runs but blind. Fixing ①+②      │
   * │ and forgetting the `mcp__.*` hook (the `hooks` block below) means       │
   * │ **opening a door to write into `roles/` and read `.state/`** — the      │
   * │ same two holes just patched on 08/23, through a different door.        │
   * │ These three parts CANNOT be separated. → docs/SPEC-arms.md §5g          │
   * └────────────────────────────────────────────────────────────────────────┘
   */
  /**
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ THE `mcpServers` KEY STAYS THE HASH. (user settled 08/26, and settled   │
   * │ it right)                                                              │
   * │                                                                        │
   * │ The previous version turned the key into a slug from the label          │
   * │ (`mcp__acme__…`) so the model could tell two Notion arms apart. The     │
   * │ user proposed the opposite: **keep the hash, and let a directory line    │
   * │ point to the name**. Three reasons this is better:                     │
   * │                                                                        │
   * │  ① The directory bridge is **needed in every case regardless** — a      │
   * │    non-Latin label produces an empty slug, a duplicate label sends       │
   * │    both back to the hash. So the slug is only a PARTIAL optimization    │
   * │    layered on top of a mechanism that's ALREADY ENOUGH. Two mechanisms, │
   * │    one job.                                                            │
   * │  ② A slug creates **three conversion points** (`armGrants` ·            │
   * │    `armLabels` · the log), and the first one breaks in the direction    │
   * │    of **over-granting**: looking up `arms[]` by slug always returns     │
   * │    `tools` as `undefined` ⇒ grants the WHOLE SERVER to a "read-only"     │
   * │    arm. A display-only optimization must never be able to open a        │
   * │    privilege hole.                                                     │
   * │  ③ This codebase has been bitten repeatedly by *"two paths for one       │
   * │    job"*. A hash everywhere means `armGrants`, `describeCall` and the    │
   * │    log all speak **the same language** — no conversion left to forget.  │
   * │                                                                        │
   * │ ⇒ The model bridges the gap through the DIRECTORY LINE                  │
   * │ (`assistant.ts §armReach`), which spells out `call via mcp__<hash>__*`  │
   * │ outright once a role holds two or more arms.                           │
   * └────────────────────────────────────────────────────────────────────────┘
   */
  const mcpServers = role.mcp.length ? pickMcp(office, role) : undefined;
  /**
   * Approved by WHOLE SERVER (`mcp__<id>`), not tool by tool (user settled
   * 08/24).
   *
   * Because a wire on the canvas **IS** the act of granting permission:
   * dragging a wire from 🔌 down to a worker is the sentence "this person can
   * use this arm". Approving tool by tool makes the user answer the same
   * question again in a vocabulary they don't have (`write_file` vs.
   * `edit_file`), and 4/14 `write_external` tools would deny with EXACTLY the
   * confusing "permission denied" message that just cost an entire session to
   * trace.
   *
   * Per-tool approval is §8's job — where there's an actual PERSON clicking
   * the button.
   */
  const armGrants = mcpServers
    ? Object.keys(mcpServers).flatMap((n) => {
        /**
         * An arm with a SUBSET of jobs gets granted exactly that subset, not
         * the whole server. This is what makes *"Notion (read-only)"*
         * honest — granting `mcp__<server>` anyway would make the "read-only"
         * label a promise **backed by nothing**, exactly the kind of promise
         * §14 just spent effort tearing out in test 11 step 5.
         *
         * The list is read from `arms[hash].tools` — **already resolved at
         * plug-in time** from the server's own `annotations` (`addArm` →
         * `probeArm` → `levelOf`). No tool name lives in source code, and
         * there's no network round trip here: `pickMcp` has to stay in sync.
         * → types.ts §arms.tools
         */
        const subset = office.company.arms?.[n]?.tools;
        return subset?.length ? subset.map((t) => `mcp__${n}__${t}`) : [`mcp__${n}`];
      })
    : [];
  /**
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ `ToolSearch` IS TIED TO ARMS, NOT TO THE BASELINE. (user settled 08/25) │
   * │                                                                        │
   * │ It's what lets the SDK **defer** MCP tool schemas instead of leaving    │
   * │ them in every turn's prefix (📖 `alwaysLoad`: *"tools are deferred      │
   * │ when tool search is enabled"*). Measured 08/25: a Notion arm costs      │
   * │ **~18,365 tokens/turn** (calibrated against the real measurement in     │
   * │ §9b: filesystem 12,973 bytes = 2,185 tokens).                          │
   * │                                                                        │
   * │ ⚠ WHY IT'S NOT JUST FOLDED INTO `BUILTIN_TOOLS`: a role **with no arm**  │
   * │ has nothing to defer ⇒ **zero** upside, while the cost is paid in       │
   * │ full — one more tool in the prefix, and one more way for the model to   │
   * │ wander off. §15k already has a real case for the price of wandering:    │
   * │ **9 turns · $0.2058** before hitting the cap.                          │
   * │                                                                        │
   * │ Same condition as `armGrants` right above — doesn't invent yet another  │
   * │ switch for the user to remember.                                       │
   * │                                                                        │
   * │ ⚠ THE REAL SAVINGS ARE NOT YET MEASURED. The 18,365 figure is a          │
   * │ calibrated estimate, and it sits in the prefix so it **gets cached** ⇒  │
   * │ the money saved is much smaller than the token figure suggests. What's  │
   * │ certain is the savings in **context-window room**. Test 12 measures     │
   * │ both directions with `getContextUsage()`. → SPEC-arms §9b               │
   * └────────────────────────────────────────────────────────────────────────┘
   */
  const searchTools = armGrants.length ? ['ToolSearch'] : [];
  /**
   * ⚠ READS THE DIRECTORY FROM the **DECLARED** CONFIG, NOT the **LAUNCH**
   * CONFIG. (fixed 08/24)
   *
   * `pickMcp` runs `fastLaunch`, which turns `{command:'npx', args:['-y',
   * <package>, <directory>]}` into `{command:<node>, args:[<entry>.js,
   * <directory>]}`. But `folderRoots` only asks *"does this argument look
   * like an absolute path"* — so it happily picks up `…\dist\index.js`,
   * `statSync` reports it isn't a directory, and the user gets a **false
   * alarm** claiming their arm declares a directory that doesn't exist:
   *
   *   The arm for role "nguoi-soi-thu-muc" declares directory
   *   "C:\Users\…\server-filesystem\dist\index.js" but it wasn't found on
   *   this machine.
   *
   * Doesn't change behavior (the `.js` file gets rejected by `statSync`
   * exactly as before), but a false warning is what teaches a user to ignore
   * warnings — and then they ignore the one worth reading. Fixed at the
   * SOURCE: `fastLaunch` is an implementation detail, the directory is
   * something the user DECLARED, and the two must never get mixed together.
   */
  const declaredArms: McpServers = {};
  for (const id of role.mcp) {
    const cfg = office.company.mcpServers[id];
    if (cfg) declaredArms[id] = cfg as McpServers[string];
  }
  const armDirs = armRoots(role, role.mcp.length ? declaredArms : undefined);
  /** Hash → the name the user gave it. The log speaks names, not hashes. → `describeCall` */
  const armLabels: Record<string, string> = {};
  for (const [id, a] of Object.entries(office.company.arms)) if (a.label) armLabels[id] = a.label;

  /**
   * Hash → link to the vendor's app-install screen. → `githubDoorError`
   *
   * Derived from `catalog.scope`, i.e. **data**, so there's no `=== 'github'`
   * branch here and a second vendor with the same 404 shape gets served
   * automatically. Only built for arms THIS role has wired — same reasoning
   * as every other table in this function.
   */
  const armDoors = new Map<string, string>();
  for (const id of role.mcp) {
    const url = findArm(office.company.arms[id]?.catalog ?? '')?.scope?.url;
    if (url) armDoors.set(id, url);
  }


  const model = modelFor(office, role.model_tier);
  // model MUST go into the cacheKey: the prompt cache keys off (model, prefix).
  const built = buildWorkerPrompt(office, role, { hotKnowledge: input.hotKnowledge, model });
  const message = buildTaskMessage(brief, input.coldKnowledge, office.company.budgets.task_brief_tokens);

  const release = await deps.acquireCacheSlot?.(built.cacheKey);

  let usage: Usage = { ...EMPTY_USAGE };
  let finalText = '';
  let firstTokenSeen = false;
  /** Observed destinations from tools actually called. See `landingOf`. */
  const landed = new Map<string, Landing>();
  /** Repeated-action trail + library files touched. See `LoopWatch`. */
  const watch = newLoopWatch();

  let interrupted = false;
  // The REAL stop switch. See the comment block on `oneMessage` for why
  // `Query.interrupt()` isn't used.
  const abortController = new AbortController();

  // Interrupted / errored / done all have to return the same set of measured
  // numbers — packaged in one place so no branch accidentally returns a
  // receipt missing `looped`/`reads`.
  /** Whether an arm was called at all — decides the message when the turn cap is hit. */
  let armCalled = false;
  const observed = (): Observed => ({
    landed: [...landed.values()],
    looped: watch.looped,
    reads: [...watch.libraryReads].sort(),
  });

  try {
    const running = query({
      prompt: oneMessage(message),
      options: {
        abortController,
        systemPrompt: built.systemPrompt,
        model,
        cwd: office.dir,
        maxTurns: role.budget.max_turns,
        // `0` = the user didn't set a cap → DON'T pass the flag. Passing 0
        // down to the SDK sets the cap to zero, i.e. blocks the very first
        // turn. → `RoleBudget.max_usd`
        ...(role.budget.max_usd > 0 ? { maxBudgetUsd: role.budget.max_usd } : {}),
        // Session lives only in RAM — the worker is stateless, no leftovers on disk.
        persistSession: false,
        // Don't load the user's CLAUDE.md / settings: they vary by machine
        // and over time, and would break the prefix cache.
        settingSources: [],
        strictMcpConfig: true,
        /**
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ `tools` RESTRICTS, `allowedTools` ONLY AUTO-APPROVES. TWO DIFFERENT │
         * │ THINGS.                                                            │
         * │                                                                    │
         * │ The previous version only set `allowedTools` and assumed that was   │
         * │ a restriction. The `.d.ts` says outright: allowedTools = "auto-      │
         * │ allowed without prompting… To restrict which tools are available,   │
         * │ use the `tools` option instead."                                    │
         * │                                                                    │
         * │ MEASURED CONSEQUENCE: a `nguoi-viet` worker (declaring no tools      │
         * │ beyond the default set) hit a read-only file → tried `PowerShell`    │
         * │ FOUR TIMES. It saw that tool in context because we'd never cut it   │
         * │ out. Three costs at once:                                          │
         * │                                                                    │
         * │  1. TOKENS — every Claude Code tool's definition sits in the         │
         * │     cached prefix of EVERY worker call, permanently.                │
         * │  2. TURNS — every attempt at a rejected tool is a paid turn spent    │
         * │     receiving a rejection.                                          │
         * │  3. ARCHITECTURE — SPEC-tools-approval §5 says `Bash` has to be an   │
         * │     explicit decision in roles/<id>.yaml. That was NEVER actually    │
         * │     enforced: a role that didn't declare `Bash` could still reach    │
         * │     for the shell.                                                  │
         * └────────────────────────────────────────────────────────────────────┘
         */
        tools: [...effectiveTools(role.tools), ...searchTools],
        /**
         * ⚠ `tools` does NOT list MCP tools, and that's DELIBERATE — measured:
         * passing `tools: [7 tools]` still had the CLI grant all 21 (7 + 14
         * from MCP). `tools` filters BUILTIN tools by name; MCP tools travel a
         * different path. Stuffing `mcp__files` in there sends a string that
         * isn't any tool's name at all — falling right into the exact
         * "allowlist silently drops an unknown entry" trap as
         * `SHELL_ALIASES`, and this time it can drop the WHOLE SET.
         * `warnDroppedTools` still only watches the builtin part.
         *
         * ⚠ `ToolSearch` has to appear in BOTH lists. `tools` decides whether
         * it's GRANTED at all; `allowedTools` decides whether it can be CALLED
         * without asking. Miss the second one and it gets stopped at the
         * approval gate, and every MCP tool becomes **unreachable** — a
         * silent failure, in exactly the hardest place to guess.
         */
        allowedTools: [...effectiveTools(role.tools), ...searchTools, ...armGrants],
        // Directories an arm is allowed to touch. This is what the MCP server
        // actually reads (`roots`), not `args`. A role with no arm ⇒ empty
        // array ⇒ nothing passed: least privilege stays intact.
        ...(armDirs.length ? { additionalDirectories: armDirs } : {}),
        /**
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ RULE: OUTPUT ALWAYS LANDS INSIDE THE OFFICE DIRECTORY.              │
         * │ (user settled 08/21) — and this is the LINE OF CODE that enforces   │
         * │ it.                                                                │
         * │                                                                    │
         * │ `cwd: office.dir` is NOT a wall: `Write` accepts an absolute path,  │
         * │ and `tools`/`allowedTools` only gate *which tool gets used*, not    │
         * │ *where it writes to*. Case `P-260821-1818-yydi` went straight       │
         * │ through that gap: the user's file landed in                        │
         * │ `company/artifacts/…`, a sibling of `offices/`, a place no office   │
         * │ can see.                                                           │
         * │                                                                    │
         * │ ⚠ WHY A HOOK, NOT `canUseTool`: measured 08/19 — a tool inside      │
         * │ `allowedTools` gets auto-approved and **SKIPS `canUseTool`**        │
         * │ entirely. And `Write` sits in `allowedTools` for every role. Putting│
         * │ the rule in `canUseTool` writes a rule that never runs — exactly     │
         * │ the "PROMISE" that tier 0c debt exists to hunt down. `PreToolUse`    │
         * │ runs BEFORE the permission layer, so `allowedTools` can't shadow it. │
         * │                                                                    │
         * │ Block, DON'T silently rewrite: having `updatedInput` steer the      │
         * │ path back inside the office falls into the `silently rewritten`     │
         * │ cell — more dangerous than `refuses` because nobody sees anything.  │
         * │ `deny` with a corrective message lets the model write to the right  │
         * │ place on its own very next turn, and the log carries a trace.       │
         * └────────────────────────────────────────────────────────────────────┘
         */
        hooks: {
          PreToolUse: [
            { matcher: 'Write|Edit|NotebookEdit', hooks: [officeJail(jailDirs, 'write')] },
            // The READ branch is new (08/23). It does NOT build a general read
            // gate — `Read` still opens every file on the machine exactly as
            // before. It only locks down `.state/` itself — i.e. the
            // credential store and the job ledger. → SPEC-arms.md §5d
            { matcher: 'Read|Grep|Glob', hooks: [officeJail(jailDirs, 'read')] },
            /**
             * ┌──────────────────────────────────────────────────────────────┐
             * │ THE ARM BRANCH (08/24) — the condition that makes ① and ②     │
             * │ above safe.                                                  │
             * │                                                              │
             * │ The old `guardedZone` only matched BUILTIN tools. The comment │
             * │ in `catalog.ts §swallowsOffice` had already flagged this:      │
             * │ *"an MCP tool is named `mcp__x__read_file`, does NOT match ⇒  │
             * │ reopens the exact two holes just patched, through a different │
             * │ door"* — and noted *"nobody has measured whether that matcher │
             * │ actually matches"*.                                          │
             * │                                                              │
             * │ MEASURED 08/24 (`scripts/spike-mcp-hook.ts`):                 │
             * │   no hook             → ❌ read `roles/nguoi-viet.yaml`        │
             * │   matcher `mcp__.*`   → ✅ hook fires twice, **real deny**     │
             * │   matcher `.*`        → ✅ fires, real deny                    │
             * │                                                              │
             * │ Proof this is a MECHANISM and not "a well-behaved model": the │
             * │ log still shows the call to `mcp__files__read_text_file` —    │
             * │ the model DID call the tool, the hook blocked it.             │
             * └──────────────────────────────────────────────────────────────┘
             */
            { matcher: 'mcp__.*', hooks: [officeJail(jailDirs, 'arm')] },
            /*
              ⚠ REMOVED (08/27 afternoon): a second hook `armJail` that gated
              repo scope. Don't rebuild it — the full reasoning is in
              `SPEC-arms.md` §5h·7m. Summary: repo scope is a **GitHub
              account-level asset**, and a second fence layered on top of it
              only buys a per-arm narrowing, in exchange for one more
              mechanism + hand-typing + redo-on-replug.
            */
          ],
          /**
           * ┌────────────────────────────────────────────────────────────────┐
           * │ OVERSIZED RESULT — SPILL IT BACK TO THE OFFICE. → `core/spill.ts`│
           * │ · §9e                                                          │
           * │                                                                │
           * │ NO matcher: it applies to **every tool**. Claude Code itself     │
           * │ spills an over-long result to a file for `Bash`, `WebFetch`,     │
           * │ `Read`, and every MCP tool — so the patch has to cover all of    │
           * │ them, or it's only correct for the one vendor we just happened   │
           * │ to run into. (user 08/27: *"it should be general, not just for   │
           * │ this Notion case"*)                                             │
           * │                                                                │
           * │ ⚠ THIS HOOK MUST NEVER THROW. It runs after ONE call already    │
           * │ succeeded; breaking the whole turn over a file-copy step trades  │
           * │ a small loss for a large one — same rule as `audit.append`.      │
           * └────────────────────────────────────────────────────────────────┘
           */
          PostToolUse: [
            {
              hooks: [
                async (input: Record<string, unknown>) => {
                  try {
                    const toolName = String(input['tool_name'] ?? '');
                    /**
                     * ┌────────────────────────────────────────────────────────┐
                     * │ STRIP THE QUERY OUT OF THE BROWSER'S CONSOLE LOG.       │
                     * │ → `redact.ts` (full reasoning + limits at the top of    │
                     * │ that file)                                             │
                     * │                                                        │
                     * │ HERE, not somewhere else: this is the only point that   │
                     * │ runs **after every tool call**, i.e. right after         │
                     * │ Playwright just wrote its file. Placed at the end of     │
                     * │ the whole run, tokens would sit exposed for the entire   │
                     * │ run; placed earlier, there'd be nothing to clean yet.    │
                     * │                                                        │
                     * │ ⚠ Does NOT filter by tool name. A browser arm plugged   │
                     * │ in on its own (path B) carries no name we know ahead of  │
                     * │ time, and it still writes into that same directory.      │
                     * │ The cheapest and most correct condition is **does the    │
                     * │ directory exist at all** — `redactBrowserLogs` returns   │
                     * │ immediately when it doesn't, which is the case for       │
                     * │ almost every office.                                    │
                     * └────────────────────────────────────────────────────────┘
                     */
                    redactBrowserLogs(office.dir);
                    /**
                     * TRANSLATE A WRONG-DOOR 404 — before the spill check, because
                     * these are two independent things: a 404 message is short so
                     * it never gets spilled, and even if it did, what's worth
                     * fixing is still the message, not where it sits.
                     *
                     * ⚠ Don't return early on a non-match — the spill check below
                     * still needs to run.
                     */
                    const door = armDoors.get(splitArmTool(toolName)?.server ?? '');
                    if (door && typeof input['tool_response'] === 'string') {
                      const fixed = githubDoorError(
                        (input['tool_input'] ?? {}) as Record<string, unknown>,
                        input['tool_response'],
                        door,
                      );
                      if (fixed) {
                        return {
                          hookSpecificOutput: {
                            hookEventName: 'PostToolUse',
                            updatedToolOutput: fixed,
                          },
                        };
                      }
                    }
                    const plan = planSpill(
                      input['tool_response'],
                      toolName,
                      deps.outDir ?? office.paths.artifacts,
                      office.paths.artifacts,
                    );
                    if (!plan || !doSpill(plan)) return {};

                    /**
                     * ANNOUNCE — but **only when a spill happened**. (user
                     * settled 08/27)
                     *
                     * The threshold changes behavior turn to turn: a small page
                     * passes straight through, a big page gets spilled to a
                     * file. Changing behavior without saying so makes the user
                     * guess. But announcing it on EVERY turn is exactly the
                     * thing people learn to tune out — the same reasoning
                     * already used to drop the approval gate. It's worth
                     * mentioning **because it's rare**.
                     *
                     * And this sentence comes from the DETERMINISTIC layer, not
                     * from the model — four times in this project *"the system
                     * was right, the model told it wrong"*.
                     */
                    deps.onProgress?.(
                      // Model reads this one: it is the replacement tool result.
                      `long result — saved to ${plan.rel} (${Math.round(plan.bytes / 1024)} KB)`,
                    );
                    const arm = splitArmTool(toolName);
                    if (arm) {
                      deps.onArmCall?.({
                        server: arm.server,
                        tool: arm.tool,
                        role: role.id,
                        ...(brief.task_id ? { task_id: brief.task_id } : {}),
                        args: { '(result saved)': plan.rel, bytes: plan.bytes },
                      });
                    }
                    return {
                      hookSpecificOutput: {
                        hookEventName: 'PostToolUse',
                        updatedToolOutput: spillNotice(plan),
                      },
                    };
                  } catch {
                    // If the spill fails, leave the CLI's own message as-is: worse, not wrong.
                    return {};
                  }
                },
              ],
            },
          ],
        },
        ...(mcpServers ? { mcpServers } : {}),
      },
    });

    deps.onStart?.({
      async interrupt() {
        interrupted = true;
        abortController.abort();
        // Still call `interrupt()` afterward — harmless, and if the CLI
        // supports it, it stops more cleanly than an abort. Swallow the
        // error: the user just hit Stop, don't throw a technical error in
        // their face.
        await running.interrupt().catch(() => undefined);
      },
    });

    for await (const msg of running) {
      const m = msg as Record<string, unknown>;

      // The cache prefix is already written the moment the stream starts —
      // release other tasks with the same cacheKey waiting at the priming
      // gate, don't wait for this call to finish.
      if (!firstTokenSeen) {
        firstTokenSeen = true;
        release?.();
      }

      // The account usage limit rides along the stream, FOR FREE. Fires once
      // per query, right at the start — pick it up, don't call anything extra.
      // → `core/energy.ts`
      if (m['type'] === 'rate_limit_event') noteRateLimit(m['rate_limit_info']);

      // The CLI SELF-REPORTS which tools it was granted. Cross-check right away.
      // → `warnDroppedTools`
      if (m['type'] === 'system' && m['subtype'] === 'init') {
        warnDroppedTools(role, m['tools']);
      }

      if (m['type'] === 'assistant') {
        const calls = toolCalls(m);
        // One message can contain multiple tool_use entries. The status line
        // only shows the FIRST one (more would just flicker meaninglessly),
        // but DESTINATIONS get recorded for all of them — this is where we
        // learn where the output actually went.
        // The sentence and the place come from THE SAME call, in one read. Two
        // reads is how they would eventually disagree about the same turn.
        if (calls[0]) deps.onProgress?.(describeCall(calls[0], armLabels), placeOf(calls[0]));
        for (const call of calls) {
          const spot = landingOf(office.dir, call);
          if (spot) landed.set(`${spot.kind}:${spot.ref}`, spot);
          // Same `tool_use` stream, two more observations for free: whether
          // an action repeated, and which library documents got touched.
          observeCall(watch, call);
          /**
           * ┌────────────────────────────────────────────────────────────────┐
           * │ AUDIT LOG — **EVERY** MCP call, WITH ITS ARGUMENTS.             │
           * │                                                                │
           * │ ⚠ Sits inside the `for` loop, does NOT use `calls[0]` like the  │
           * │ status line right above. The status line only needs one thing   │
           * │ to show; an audit that misses one call **stops being an         │
           * │ audit** — that exact `calls[0]` shortcut is why the 08/26 case   │
           * │ couldn't be traced back to what it actually wrote to Notion.     │
           * │                                                                │
           * │ Recorded here, not in `canUseTool`: that gate never fires for   │
           * │ a tool already in `allowedTools` (measured 08/26) — and an arm   │
           * │ is always in there. The `tool_use` stream is the ONLY place      │
           * │ that sees every call, regardless of permission.                 │
           * └────────────────────────────────────────────────────────────────┘
           */
          const arm = splitArmTool(call.name);
          if (arm) {
            // Has it reached outside yet? The message when the turn cap is
            // hit **changes entirely** based on this flag: not yet reached
            // means just an unfinished job inside the office; already
            // reached means it may have changed something in the user's own
            // Notion/GitHub.
            armCalled = true;
            deps.onArmCall?.({
              server: arm.server,
              tool: arm.tool,
              role: role.id,
              // `brief` only carries `task_id`; `plan_id` belongs to the
              // scheduler, which attaches it at the call site. Faking it here
              // with a field that doesn't exist would be a silent failure —
              // leave it to the place that ACTUALLY KNOWS to fill in.
              ...(brief.task_id ? { task_id: brief.task_id } : {}),
              args: call.input,
            });
          }
        }
      }

      if (m['type'] === 'result') {
        usage = readUsage(m);
        finalText = typeof m['result'] === 'string' ? m['result'] : '';
        if (m['subtype'] === 'error_max_budget_usd') {
          throw new RunError(
            t('wk.hitBudget', { task: brief.task_id, ceiling: formatUSD(role.budget.max_usd) }),
            'budget',
          );
        }
        /**
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ 🔴 HITTING THE TURN CAP MUST BE SAID IN HUMAN WORDS. (user caught    │
         * │ this 08/27)                                                        │
         * │                                                                    │
         * │   *"then give me a proper sentence, why would you throw an           │
         * │    error_max_turns that nobody understands"*                        │
         * │                                                                    │
         * │ The budget branch right above has had a decent message for a long  │
         * │ time; the TURNS branch fell straight through as raw SDK error       │
         * │ code. That asymmetry has no reason behind it — nobody had written   │
         * │ it yet.                                                            │
         * │                                                                    │
         * │ ⚠⚠ AND THIS MESSAGE MUST STATE AN UNCOMFORTABLE TRUTH, not just     │
         * │ translate the error code: **the job may have gotten PARTIALLY       │
         * │ done.** This is debt recorded on 08/26 (`SESSIONS_MEMORY` §5s ⏸): a │
         * │ run that hit the cap had already managed to call                    │
         * │ `notion-update-page` before being cut off, but the closing report   │
         * │ said *"not done"* — a sentence that's **wrong about the outside     │
         * │ world**.                                                           │
         * │                                                                    │
         * │ With a file inside the office, getting it wrong is harmless. With   │
         * │ an arm, it's the user's own Notion/GitHub — and we have NO way to   │
         * │ know how far it got. So the correct sentence is *"unclear how far,  │
         * │ check the log"*, not reassurance. → [[agentco-safe-default-direction]]│
         * └────────────────────────────────────────────────────────────────────┘
         */
        if (m['subtype'] === 'error_max_turns') {
          const armTouched = armCalled;
          throw new RunError(
            t('wk.hitMaxTurns', { turns: String(role.budget.max_turns) }) +
              (armTouched ? t('wk.hitMaxTurnsWithArm') : '') +
              t('wk.hitMaxTurnsNext'),
            'max_turns',
          );
        }
      }
    }
  } catch (err) {
    // A user-requested interrupt is NOT an error. The SDK throws on interrupt,
    // and turning it into "task failed" would be a lie in the log.
    if (interrupted) return stoppedReceipt(office, brief, role, usage, started, observed());
    /**
     * ⚠ EVERY THROW PATH MUST CARRY BOTH `usage` **AND** `observed`.
     * → `RunError.usage`, `RunError.observed`
     *
     * Tokens already spent exist no matter how the run ends. The old version
     * threw bare in all three branches (`max_turns`, `budget`, everything
     * else), so money vanished from the ledger — measured in case
     * `P-260820-2219-5ltb`: 9 tool turns, ledger reads $0. The `interrupted`
     * branch right above already got this right from the start; this plugs
     * the three remaining paths into the same shape.
     *
     * `observed` was added here on 08/21 because **the exact same story
     * repeated on a different field**: a file already written also exists no
     * matter how the run ends, yet these three branches still reported
     * `landed: []`. Case `P-260821-1827-m78h` hit the cost cap NINE SECONDS
     * AFTER finishing writing a correct and complete results table, then
     * told the user *"no result yet"*.
     *
     * Packaged in ONE place rather than sprinkling `{ usage }` into every
     * throw: a new throw branch added later gets this right automatically,
     * with nobody having to remember. Last time's lesson stopped here — this
     * time it has to cover both fields, and when a third field is added it
     * goes in this exact spot too.
     */
    const fail = (message: string, kind: FailureKind): RunError =>
      new RunError(message, kind, { cause: err, usage, observed: observed() });

    /**
     * A `RunError` thrown from INSIDE the loop (e.g. `error_max_budget_usd`)
     * already knows everything it needs — rebuild it, keeping the same
     * message and `kind`.
     *
     * ⚠ The condition has to check BOTH fields. The old version wrote
     * `err.usage ? err : …`, so an error that already carried `usage` got
     * thrown straight through and **never received `observed`** — exactly
     * the gap `budget` would fall through later.
     */
    if (err instanceof RunError) {
      throw err.usage && err.observed ? err : fail(err.message, err.kind);
    }

    const kind = classifyError(err);
    if (kind === 'max_turns') {
      // Not an "error" — the worker got cut off mid-task. Say exactly where to fix it.
      throw fail(
        // Log line, so English literal — this is `process.emitWarning`.
        `"${role.display_name || role.id}" ran out of turns (${role.budget.max_turns}) on ${brief.task_id}. ` +
          `This job needs more steps: raise max_turns in roles/${role.id}.yaml, split the request up, ` +
          `or write clearer instructions so the employee gropes around less.`,
        'max_turns',
      );
    }
    throw fail(errorMessage(err), kind);
  } finally {
    release?.();
  }

  // Interrupted but the loop ended QUIETLY (no thrown error) also has to stop
  // here. Continuing on would fire another "repair the receipt" call — money
  // spent on work the user just asked to stop.
  if (interrupted) return stoppedReceipt(office, brief, role, usage, started, observed());

  // ── receipt
  let parsed = parseReceipt(finalText);
  let reasked = false;

  if (!parsed.ok) {
    // Repair call: cheapest model, minimal system prompt, NO role context attached.
    // Fixing formatting doesn't need to know anything about the role — attaching it just costs money.
    reasked = true;
    // `problem` feeds `repairPrompt`, which is English — so this fallback is too.
    const repaired = await repairReceipt(office, finalText, parsed.problem ?? 'unclear');
    usage = addUsage(usage, repaired.usage);
    parsed = parseReceipt(repaired.text);
  }

  const body = parsed.ok
    ? parsed.receipt!
    : {
        status: 'failed' as const,
        say: t('wk.receiptUnreadable'),
        answer: '',
        // No event to anchor on — the receipt itself couldn't even be read.
        // Making up a summary sentence here would hand the Assistant
        // something that sounds like a fact but isn't.
        gist: '',
        artifacts: [],
        lessons: [],
        blocked_on: t('wk.receiptInvalid', { problem: parsed.problem ?? 'unclear' }),
      };

  const capped = enforceCap(body, office.company.budgets.receipt_tokens);

  /**
   * A `file` task where the worker still sends an `answer` gets it DROPPED,
   * not forwarded.
   *
   * Not a minor discipline: `answer` flies straight into chat as the answer
   * to the user. A 300-word write-up leaking in there would show up in full
   * in the chat pane, RIGHT NEXT TO the "saved to" block — the user reads the
   * same content twice, in two shapes, with no way to tell which one is the
   * real deal.
   *
   * Enforced in code because `deliver` is something WE set, not something
   * the model guesses: it doesn't get to change the delivery shape midway on
   * its own.
   */
  if (brief.deliver !== 'reply') capped.answer = '';

  return {
    ...capped,
    task_id: brief.task_id,
    role: role.id,
    usage,
    wall_ms: Date.now() - started,
    reasked,
    ...observed(),
  };
}

// ───────────────────────────────────────────────────── rule: write inside the office

/**
 * Gate that blocks writes outside the office directory. See the `hooks`
 * block in `runWorker`.
 *
 * Returns `deny` WITH THE CORRECT PATH TO USE, not just a bare "no". An empty
 * rejection makes the model probe again with another wrong path — every
 * probe is a paid turn spent receiving a rejection (§5 "`tools` vs
 * `allowedTools`", the 2nd cost). Stating the right place up front lets it
 * write correctly on the very next turn.
 */
function officeJail(dirs: JailDirs, mode: GuardMode) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const raw = (input['tool_input'] ?? {}) as Record<string, unknown>;

    // EVERY field, not just the first one found. MCP's `move_file` has TWO
    // paths (`source` + `destination`), and having just one of them touch the
    // forbidden zone is already enough to break the rule. The old version
    // used a `||` chain, so it stopped at the first one.
    for (const target of pathsIn(raw)) {
      const zone = guardedZone(dirs, target, mode);
      if (!zone) continue;
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: JAIL_REASON[zone](target),
        },
      };
    }
    return {};
  };
}

/*
  ⚠ REMOVED (08/27 afternoon): `armJail` + `repoIn` — our second repo fence.
  **DON'T REBUILD IT** without reading `SPEC-arms.md` §5h·7m first.

  It ran correctly and had tests, but the user's objection landed exactly
  right: repo scope is a **GitHub account-level asset**, and stacking a
  second fence on top of it buys exactly one thing — narrowing PER ARM — at
  three costs:
    · one more mechanism for the same noun ([[agentco-count-mechanisms]])
    · the user has to HAND-TYPE repo names (we can't enumerate installed repos)
    · the limit lives inside the hash ⇒ changing the limit = unplug + rewire

  The narrower place already exists, held by the right owner, updated
  instantly: the *"Only select repositories"* toggle on the app-install
  screen. → `catalog.ts §scope`

  What REPLACES it, and is a mandatory companion fix: `githubDoorError` right
  below (translates GitHub's wrong-door 404) + the audit log already
  recording `owner`/`repo` in `args`.
*/

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TRANSLATE GITHUB'S WRONG-DOOR ERROR. → SPEC-arms §5h·7f                  │
 * │                                                                          │
 * │ GitHub deliberately returns **404**, not 403, for a repo the app isn't    │
 * │ installed on — so it never leaks whether the repo even exists. Correct    │
 * │ from their side; from our user's side it's a **wrong-door error**: a      │
 * │ `404 Not Found` teaches someone to go check the repo name, check the      │
 * │ credential, check permissions — every place EXCEPT the right one, which   │
 * │ is *"you haven't installed agentco on this repo yet"*.                   │
 * │                                                                          │
 * │ 🔴 Before 08/27 afternoon there wasn't **a single line** in `src/`         │
 * │ catching this, even though cell C-3 of test 13 had been asking for it     │
 * │ for a while and pointed at a spec section that DIDN'T EXIST. It got away  │
 * │ with it for so long because the repo fence covered for it — now that      │
 * │ fence is gone, this is the **only** thing standing between the user and   │
 * │ a riddle.                                                                │
 * │                                                                          │
 * │ ⚠ FIX THE MESSAGE, DON'T SWALLOW THE ERROR. The call is still broken, the │
 * │ receipt still records a failure — we only append a way forward at the     │
 * │ end. Swallowing it into "success" would rebuild the Notion `Error:` case   │
 * │ that burned 10 turns (a broken turn primed into looking successful, and   │
 * │ the reverse is exactly as bad).                                          │
 * │                                                                          │
 * │ ⚠ ONLY when the call actually has `owner`/`repo` — without them the 404   │
 * │ is about something else, and guessing blindly just builds a NEW           │
 * │ wrong-door message to replace the old one.                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function githubDoorError(
  raw: Record<string, unknown>,
  text: string,
  installUrl: string,
): string | null {
  if (!/\b404\b|not found/i.test(text)) return null;
  const owner = str(raw['owner']);
  const repo = str(raw['repo']);
  if (!owner || !repo) return null;
  return (
    `${text}\n\n` +
    // ⚠ English, hard-coded: this is a TOOL RESULT handed back to the employee,
    // not something a person reads. → docs/CLAUDE.md §Language
    `↳ With GitHub, a 404 here almost always means **agentco is not installed on ` +
    `"${owner}/${repo}"** — not that the repo is missing or the key is wrong. GitHub returns 404 ` +
    `instead of 403 on purpose, so a private repo is not revealed.\n` +
    `↳ The human needs to open ${installUrl} and add this repo. Do not retry under a different ` +
    `name, and do not conclude the repo does not exist.`
  );
}

/**
 * Every path declared in `tool_input` for ONE call.
 *
 * Six field names, because tools declare paths in six different spots:
 *
 *   `file_path`      Read · Write · Edit
 *   `notebook_path`  NotebookEdit
 *   `path`           Grep · Glob · and nearly EVERY server-filesystem tool
 *   `source`         move_file
 *   `destination`    move_file
 *   `paths[]`        read_multiple_files
 *
 * ⚠ This is once again a HAND-WRITTEN NAME LIST, exactly the thing that burned
 * six days at `SHELL_ALIASES`. The difference is worth stating: there, a
 * missing name silently made a feature not exist; here, a missing name
 * **leaves a door open**. So it has to be re-checked every time the catalog
 * adds a new server — `spike-fs-tools.ts` prints the real tool list to
 * cross-check against.
 */
export function pathsIn(raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ['file_path', 'notebook_path', 'path', 'source', 'destination']) {
    const v = str(raw[key]);
    if (v) out.push(v);
  }
  const many = raw['paths'];
  if (Array.isArray(many)) {
    for (const p of many) {
      const v = str(p);
      if (v) out.push(v);
    }
  }
  return out;
}

/**
 * Directories this role's arm is allowed to touch — what goes into
 * `additionalDirectories`, i.e. what the MCP server ACTUALLY reads as
 * `roots`.
 *
 * Derived straight from the `args` already recorded in `company.yaml`
 * (`folderRoots`), so it doesn't invent a second config field that has to be
 * kept in sync with the first.
 *
 * ⚠ A MISSING DIRECTORY GETS DROPPED, AND FLAGGED. A USB drive unplugged, a
 * folder deleted, an office zipped over to another machine — all three
 * happen for real. Two consequences, and they're not equally bad: dropping
 * it ⇒ the arm is narrower than the user expects, with a warning line;
 * passing it through anyway ⇒ the CLI can refuse the whole run, and every job
 * for that role dies with an error message that says nothing about the USB
 * drive. → [[agentco-safe-default-direction]]
 */
export function armRoots(role: Role, servers: McpServers | undefined): string[] {
  if (!servers) return [];
  const out = new Set<string>();
  for (const cfg of Object.values(servers)) {
    for (const dir of folderRoots(cfg)) {
      let there = false;
      try {
        there = fs.statSync(dir).isDirectory();
      } catch {
        there = false;
      }
      if (there) out.add(dir);
      else if (!warned.has(`dir:${dir}`)) {
        warned.add(`dir:${dir}`);
        process.emitWarning(
          // Log line, so English literal.
          `The arm on role "${role.id}" declares folder "${dir}", which is not on this machine. ` +
            `The employee will NOT reach that folder — check the path under "+ Connection".`,
        );
      }
    }
  }
  return [...out];
}

interface JailDirs {
  companyDir: string;
  officeDir: string;
}

/**
 * A rejection sentence, one per zone — and all three POINT THE WAY, not just
 * say "no".
 *
 * An empty rejection makes the model probe again with another wrong path,
 * and every probe is a paid turn spent receiving a rejection (§5 "`tools` vs
 * `allowedTools`", the 2nd cost).
 *
 * ⚠ `config` deliberately states *the right way to do this* instead of just
 * forbidding it: a request to "change the config" almost always comes from a
 * LEGITIMATE job the user just handed over. Forbidding without pointing the
 * way makes the worker report `blocked` and leaves the user not understanding
 * why — when all they needed was to flip a switch in the interface.
 */
// ⚠ ENGLISH, hard-coded, all four. These are refusals handed to the MODEL, not
// sentences a person reads — the human sees the employee's own `say`, written in
// their language, further downstream. → docs/CLAUDE.md §Language
const JAIL_REASON: Record<GuardedZone, (t: string) => string> = {
  secrets: (t) =>
    `"${t}" is inside the internal state folder (.state). That is where the KEYS and the system's ` +
    `own work log live — no employee reads or writes there, even when asked to. You do not need a ` +
    `key to use a tool that is already plugged in: just call its tool.`,
  /**
   * ⚠ THIS SENTENCE HAS TO POINT THE RIGHT WAY, not just forbid — same
   * reasoning as `config`.
   *
   * A worker hits this almost always for a LEGITIMATE reason: *"what does
   * that page show"*. The right answer is **reload the page and snapshot
   * it**, not dig through the previous turn's log. A bare rejection makes it
   * report `blocked` for a job that was actually doable, and the user gets an
   * error about a directory instead of about the job they handed over.
   */
  browser: (t) =>
    `"${t}" is the browser's internal log folder — it holds traces of the human's own sign-in ` +
    `session, so no employee reads there. To find out what a page is showing, OPEN that page again ` +
    `with the browser arm and take a snapshot; do not read the previous turn's log.`,
  config: (t) =>
    `"${t}" is one of this office's CONFIG files (roles, skills, the diagram, connections). It is ` +
    `only changed through the interface, so every change has someone accountable for it and leaves ` +
    `a trace in the log. If this job needs a permission you do not have, STOP and say what is missing.`,
  outside: (t) =>
    `The path "${t}" is outside the office folder. Every result has to be written INSIDE the ` +
    `current working folder — use a relative path such as "artifacts/<...>" and do not climb up ` +
    `with "..".`,
};

// ─────────────────────────────────────────── repeated actions & touched documents

/**
 * Two things inferred from the SAME `tool_use` stream we already unpack to
 * build the "what's happening" line. Adds no extra call, touches no prompt
 * text.
 */
interface LoopWatch {
  /** `tool+args` signatures already seen — seeing one twice means an exact repeat */
  signatures: Set<string>;
  /** files already READ — reading one a second time violates "read each file at most once" */
  read: Set<string>;
  /** files already WRITTEN — reading one back violates "never read back a file you just wrote" */
  written: Set<string>;
  /** files under `library/` touched → the source of `depends_on` */
  libraryReads: Set<string>;
  looped: boolean;
}

function newLoopWatch(): LoopWatch {
  return {
    signatures: new Set(),
    read: new Set(),
    written: new Set(),
    libraryReads: new Set(),
    looped: false,
  };
}

/**
 * DID THIS RUN REPEAT ITSELF — measured by ACTIONS, NOT by turn count.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Three signals, and all three are VIOLATIONS OF A RULE `CORE_PROMPT`      │
 * │ ALREADY STATES OUTRIGHT.                                                 │
 * │                                                                          │
 * │   calling the same tool with the same args again  →  no rule permits it  │
 * │   reading a file already read                     →  "Read each file at  │
 * │                                                       most once"         │
 * │   reading a file just written                     →  "Never read back a  │
 * │                                                       file you just      │
 * │                                                       wrote. It saved."  │
 * │                                                                          │
 * │ So this is NOT a new heuristic — it just measures whether the discipline │
 * │ we already stated is being followed. And it's MODEL-INDEPENDENT: haiku   │
 * │ or sonnet, reading something twice is still reading it twice.            │
 * │                                                                          │
 * │ ⚠ DON'T replace it with `turns >= N`. Tried, and rejected by the test     │
 * │ suite: turn count is a property of the MODEL (haiku 10 vs. sonnet 4 for   │
 * │ the same job), so it flags every `eco` office and misses every `deep`     │
 * │ one. → types.ts                                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `Grep`/`Glob` are DELIBERATELY excluded from "reading": searching multiple
 * times with different keywords is the CORRECT way to work, not fumbling
 * around. Only an EXACT repeat gets caught, and that case already lives in
 * `signatures`.
 */
function observeCall(w: LoopWatch, call: ToolCall): void {
  const sig = `${call.name}|${stableJson(call.input)}`;
  if (w.signatures.has(sig)) w.looped = true;
  w.signatures.add(sig);

  const file = normalizeRel(str(call.input['file_path']) || str(call.input['notebook_path']));

  if (call.name === 'Write' || call.name === 'Edit' || call.name === 'NotebookEdit') {
    if (file) w.written.add(file);
    return;
  }

  if (call.name === 'Read' && file) {
    if (w.read.has(file) || w.written.has(file)) w.looped = true;
    w.read.add(file);
    // Only the library creates a dependency: a lesson drawn from an artifact
    // of this same run has nothing to depend on — that artifact is the run's
    // OUTPUT, not a source of truth the user is holding onto.
    if (/^library\//.test(file)) w.libraryReads.add(file);
  }
}

/** Stable key: the model reordering JSON keys must not count as a different action. */
function stableJson(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, Object.keys(input).sort());
  } catch {
    return '';
  }
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

// ─────────────────────────────────────────────────────────── internal

/**
 * A user-requested interrupt is NOT an error — don't record "failed" in the
 * log.
 *
 * BUT it has to say "this is unfinished work": a worker killed mid-run may
 * have already written some of the files it was assigned. The old version
 * returned `artifacts: []` — i.e. lying that there was nothing on disk, and
 * the next run would overwrite it with nobody the wiser.
 *
 * We do NOT delete them: a half-finished file can still be useful, and
 * deleting something the user hasn't even seen yet is their call, not ours.
 * Just list it.
 */
function stoppedReceipt(
  office: LoadedOffice,
  brief: TaskBrief,
  role: Role,
  usage: Usage,
  started: number,
  observed: Observed,
): Receipt {
  const written = filesOnDisk(office.dir, brief.outputs.map((o) => o.path), observed.landed);

  return {
    status: 'blocked',
    say: written.length
      ? plural('wk.stoppedPartial', written.length)
      : t('wk.stoppedClean'),
    // The user just hit Stop. Pushing a half-finished answer into chat as if
    // it were a complete result is exactly the kind of lie `stoppedReceipt`
    // exists to avoid.
    answer: '',
    // Interrupted mid-run ⇒ nobody has read the result to summarize it yet. → `types.ts §gist`
    gist: '',
    artifacts: written,
    lessons: [],
    blocked_on: t('wk.stoppedByUser'),
    // The user pressing Stop is NOT a lesson — the worker didn't do anything
    // wrong and there's nothing to learn from. Without this line,
    // `agentFault` would read the `blocked_on` above as the worker's own
    // account and go ask the model "what did you learn" for something the
    // user themself just said to stop. → `agentFault`
    failure: 'stopped',
    task_id: brief.task_id,
    role: role.id,
    usage,
    wall_ms: Date.now() - started,
    reasked: false,
    ...observed,
  };
}

/**
 * WORK THAT REALLY EXISTS ON DISK, UNFINISHED — shared by EVERY exit path.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Exported and imported everywhere, NOT copy-pasted into `scheduler.ts`.    │
 * │                                                                          │
 * │ Rule from 08/19: *"a ⚠ comment saying 'the other side has to match this'  │
 * │ is NOT a mechanism — two copies of the same computation will drift,       │
 * │ import one shared function instead."* The computation here is *"what did  │
 * │ the worker leave on disk"*, and it needs answering in four places        │
 * │ (finished · interrupted · hit the cap · odd error). Four copies means     │
 * │ four chances for one branch to fall out of sync.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Merges two sources: files it WAS ASSIGNED to write (`brief.outputs`) and
 * files we SAW it write (`landed`). The second source catches side files it
 * created on its own — something the brief has no way of knowing ahead of
 * time, and also the thing most likely to get left behind on disk unnoticed.
 */
export function filesOnDisk(officeDir: string, promised: readonly string[], landed: readonly Landing[]): string[] {
  const candidates = [...promised, ...landed.filter((l) => l.kind === 'file').map((l) => l.ref)];
  return [...new Set(candidates)].filter((p) => {
    try {
      return fs.existsSync(safeJoin(officeDir, p));
    } catch {
      return false;
    }
  });
}

/**
 * Files a worker wrote OUTSIDE the office, and that really exist on disk.
 *
 * Checks `existsSync` rather than trusting `landed` alone: `landed` only
 * proves the model CALLED `Write`, not that the write succeeded. We only tell
 * the user about a file we can actually touch.
 */
export function straysOnDisk(landed: readonly Landing[]): string[] {
  const out = landed.filter((l) => l.kind === 'outside').map((l) => l.ref);
  return [...new Set(out)].filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

async function repairReceipt(
  office: LoadedOffice,
  badText: string,
  problem: string,
): Promise<{ text: string; usage: Usage }> {
  let usage: Usage = { ...EMPTY_USAGE };
  let text = '';
  try {
    for await (const msg of query({
      prompt: repairPrompt(badText, problem),
      options: {
        systemPrompt: 'You convert malformed text into strict JSON. You output JSON only.',
        model: office.company.models.eco,
        maxTurns: 1,
        persistSession: false,
        settingSources: [],
        allowedTools: [],
      },
    })) {
      const m = msg as Record<string, unknown>;
      if (m['type'] === 'result') {
        usage = readUsage(m);
        text = typeof m['result'] === 'string' ? m['result'] : '';
      }
    }
  } catch {
    // If the repair itself fails, leave it — the caller will mark it failed.
    // Don't let an error in the error-fixer bring down the task.
  }
  return { text, usage };
}

export function modelFor(office: LoadedOffice, tier: Tier): string {
  return office.company.models[tier];
}

type McpServers = NonNullable<Options['mcpServers']>;

/**
 * A role's MCP servers, injected with EXACTLY the credentials that role
 * holds.
 *
 * Secret values go into the MCP process's environment variables, NOT into
 * the prompt — the model can't read them, it can only use tools that are
 * already unlocked. That's the difference between "an agent with permission"
 * and "an agent that knows the password".
 */
function pickMcp(office: LoadedOffice, role: Role): McpServers {
  const store = readSecrets(companyPaths(office.companyDir));
  /**
   * 🔴 THE WIRE IS THE GRANT — READ AT THE POINT OF USE, NOT AT THE POINT OF
   * WRITING. → docs/SPEC-arms.md §7a · SPEC-tools-approval §7a
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MEASURED 08/09: NOTION, GITHUB AND LINEAR ALL ANSWERED 401 AT ONCE.      │
   * │                                                                          │
   * │ `roles/<id>.yaml` had `mcp:` with the arm wired, the ledger named the    │
   * │ credential (`arms[id].secrets`), the store HELD it — and the worker      │
   * │ still launched with an unfilled `${…}` placeholder, so every OAuth arm   │
   * │ answered 401 and the SDK registered none of their tools. The model then  │
   * │ told the user *"there is no Notion tool"* — a false statement about      │
   * │ CAPABILITY, produced by a broken WIRE. Across all 20 roles in the        │
   * │ user's company, not one declared `secrets:`.                             │
   * │                                                                          │
   * │ 🔴 WHY IT WAS EMPTY: there are TWO DOORS that create the same wire, and  │
   * │ only one carried the credential.                                         │
   * │   the Connections dialog → `Office.grantArm` → writes `role.mcp` AND     │
   * │                            `role.secrets`                                │
   * │   dragging the wire      → `LayoutStore.save` → writes `role.mcp` ONLY   │
   * │                            (`layout.ts` does not contain the word        │
   * │                            "secrets" anywhere)                           │
   * │ And the Try button stayed green throughout: it builds its own grant from │
   * │ the config's own placeholders, so it tests a set-up the worker never     │
   * │ gets — the exact drift `armexec.ts` warns about in as many words.        │
   * │                                                                          │
   * │ ⇒ FIXED HERE, at the READER, because a third door can be added tomorrow  │
   * │ and this cannot be bypassed: an arm's own credential follows the wire,   │
   * │ every time, whoever drew it. `role.secrets` still works and still means  │
   * │ what it meant — keys granted to the PERSON rather than to a connection.  │
   * │                                                                          │
   * │ ⚠ PER ARM, NOT ONE POOLED ENV — and this is STRICTER than before. The    │
   * │ stdio branch of `injectSecrets` merges the whole key map into a server's │
   * │ environment, so one pooled grant hands the filesystem server the Notion  │
   * │ token. Each arm now sees its own credential and the role's own keys, and │
   * │ nothing else. → `secrets.ts §injectSecrets`                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const { missing } = grantFor(store, keysFor(office.company.arms, role));
  if (missing.length) {
    process.emitWarning(
      /**
       * ⚠ TWO SENTENCES, because two genuinely different actions are needed.
       * (user pasted this exact wording 08/28)
       *
       * `agentco secret set` **doesn't work for a signed-in account** — there's
       * no string to type, the credential comes from an OAuth flow. Telling
       * someone to run that command is telling them to fill in something that
       * doesn't exist, the same failure class §5m already fixed at its own
       * gate. `isAccountName` lives next to `accountName` exactly so this
       * distinction can be made at EVERY gate, not just one.
       *
       * The most common case (user: *"I usually hit this right after updating
       * the code"*): they disconnect an account in the UI, but
       * `roles/<id>.yaml` still declares the old credential name.
       */
      (() => {
        const accs = missing.filter((n) => isAccountName(n));
        const keys = missing.filter((n) => !isAccountName(n));
        // Log lines, so English literals — the whole block is `emitWarning`.
        const parts = [`Role "${role.id}" is missing keys. Tools that need them will fail.`];
        if (accs.length) {
          parts.push(
            `${accs.join(', ')}: these are SIGNED-IN ACCOUNTS, not keys typed by hand — ` +
              `reconnect them in the Connection dialog, or drop the name from roles/${role.id}.yaml.`,
          );
        }
        if (keys.length) parts.push(`${keys.join(', ')}: add with \`agentco secret set <NAME>\`.`);
        return parts.join(' ');
      })(),
    );
  }

  const out: Record<string, unknown> = {};
  for (const n of role.mcp) {
    const cfg = office.company.mcpServers[n];
    if (!cfg) {
      process.emitWarning(`MCP server "${n}" is not declared in company.yaml`);
      continue;
    }
    /**
     * ⚠ ONE SHARED FUNCTION WITH `probeArm` — see `secrets.ts §injectSecrets`.
     *
     * The old version here only injected for a server with a `command`, and
     * stated the reason outright as *"an http/sse server authenticates a
     * different way"*. That sentence was true, but it describes a **hole**
     * (§5a), not a decision — and the hole stayed quiet because there was no
     * HTTP catalog entry yet. Now there's Notion.
     */
    /**
     * ⚠ `dirs` here is where the `<OFFICE_STATE>` placeholder gets filled in —
     * **for the office currently running**. Filling it in at this point,
     * rather than earlier, is exactly why the path never has to live in a
     * ledger, and why a catalog entry plugged into two offices stays a
     * **single hash**. → `secrets.ts §OFFICE_STATE`
     */
    // ⚠ Built PER SERVER: this arm's own credential plus the role's own keys.
    // → the box on `keysFor` for why it is not one pooled `env`.
    const { env } = grantFor(store, keysFor(office.company.arms, role, n));
    const withEnv = prepareArm(n, cfg, env, {
      officeState: path.join(office.paths.state, 'browser'),
      officeDir: office.dir,
    });
    /**
     * Take `npx` off the hot path — measured **~4 seconds PER task with an
     * arm**, because every `query()` spawns a new MCP process. Synchronous,
     * installs nothing, and returns the original config unchanged when there's
     * no cached install. → `core/armexec.ts`
     */
    out[n] = withEnv;
  }
  // Shape declared by the user in company.yaml — the SDK validates it itself at startup.
  return out as McpServers;
}

/**
 * TOKEN COUNTS COME FROM `modelUsage`, NOT FROM `usage`. → SPEC-token-economy.md §5
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ READ STRAIGHT FROM THE SDK's `.d.ts`, NOT A GUESS (sdk.d.ts:4453):       │
 * │                                                                          │
 * │   usage: "MAIN AGENT LOOP ONLY — excludes Task subagent, sidechain, and  │
 * │           auxiliary model calls, and is PER-TURN in streaming-input      │
 * │           sessions. Prefer modelUsage for token/cost accounting."        │
 * │   total_cost_usd: "Cumulative … each result carries the running total"   │
 * │                                                                          │
 * │ We RUN in streaming-input mode (`oneMessage()`), so the "per-turn" clause │
 * │ applies to us. The old version took tokens from `usage` (ONE TURN) and   │
 * │ money from `total_cost_usd` (CUMULATIVE) — two different units on the     │
 * │ same ledger line.                                                       │
 * │                                                                          │
 * │ Measured in case `P-260821-1827-m78h`: the ledger recorded `out 59,       │
 * │ cacheRead 0` next to `$0.4248`. On sonnet, 59 output tokens is about       │
 * │ $0.001 — the ledger was off by 14×. The mismatch is biggest exactly on    │
 * │ `budget`/`max_turns` cases, i.e. the MOST EXPENSIVE cases and also the    │
 * │ ones where the user needs the number the most.                          │
 * │                                                                          │
 * │ `modelUsage` accumulates PER MODEL AND already includes `costUSD` — it   │
 * │ was already in our hands, just being used only to pull a model name in    │
 * │ `dominantModel`.                                                        │
 * │                                                                          │
 * │ ⚠ Keep `total_cost_usd` as the source for MONEY: it covers auxiliary      │
 * │ calls `modelUsage` might not fully list, and the SDK's `maxBudgetUsd` cap │
 * │ is measured against this exact number — our ledger has to speak the same │
 * │ language as the brake.                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function readUsage(result: Record<string, unknown>): Usage {
  const mu =(result['modelUsage'] ?? {}) as Record<string, Record<string, number>>;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let summed = 0;
  for (const m of Object.values(mu)) {
    input += m['inputTokens'] ?? 0;
    output += m['outputTokens'] ?? 0;
    cacheRead += m['cacheReadInputTokens'] ?? 0;
    cacheWrite += m['cacheCreationInputTokens'] ?? 0;
    summed += m['costUSD'] ?? 0;
  }

  // An older SDK / an early-crash case can leave `modelUsage` unset. Falling
  // back to `usage` beats recording zero — but only when there's genuinely
  // nothing there, not as a default.
  const u = (result['usage'] ?? {}) as Record<string, number>;
  const empty = Object.keys(mu).length === 0;

  return {
    input: empty ? (u['input_tokens'] ?? 0) : input,
    output: empty ? (u['output_tokens'] ?? 0) : output,
    cacheRead: empty ? (u['cache_read_input_tokens'] ?? 0) : cacheRead,
    cacheWrite: empty ? (u['cache_creation_input_tokens'] ?? 0) : cacheWrite,
    costUSD: typeof result['total_cost_usd'] === 'number' ? result['total_cost_usd'] : summed,
    model: dominantModel(result['modelUsage']),
    turns: typeof result['num_turns'] === 'number' ? result['num_turns'] : 0,
  };
}

/**
 * A task usually touches MULTIPLE models: the one we asked for, plus Haiku,
 * which Claude Code uses for internal auxiliary work. Taking
 * `Object.keys(...)[0]` is wrong — it often returns the auxiliary model and
 * makes the cost report mislead itself. Take the model that consumed the
 * most tokens instead.
 */
function dominantModel(raw: unknown): string {
  const mu = (raw ?? {}) as Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number }>;
  let best = '';
  let bestTokens = -1;
  for (const [name, m] of Object.entries(mu)) {
    const t = (m.inputTokens ?? 0) + (m.outputTokens ?? 0) + (m.cacheReadInputTokens ?? 0);
    if (t > bestTokens) {
      bestTokens = t;
      best = name;
    }
  }
  return best;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUSD: a.costUSD + b.costUSD,
    model: a.model || b.model,
    turns: a.turns + b.turns,
  };
}

/** Exported so it's testable — this is the function that decides "where did the output go". */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

/** Unpacks every `tool_use` block in one model message. Costs no tokens. */
function toolCalls(m: Record<string, unknown>): ToolCall[] {
  const content = ((m['message'] as Record<string, unknown> | undefined)?.['content'] ?? []) as Array<
    Record<string, unknown>
  >;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b['type'] === 'tool_use')
    .map((b) => ({
      name: String(b['name'] ?? ''),
      input: (b['input'] ?? {}) as Record<string, unknown>,
    }));
}

/**
 * Turns an agent's activity into a human sentence for the UI. Costs no
 * tokens.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SAY WHAT WE'RE ALREADY HOLDING.                                          │
 * │                                                                          │
 * │ The old version returned "searching the project" for BOTH `Grep` and     │
 * │ `Glob`, with no keyword, no location. A single turn searching 4 places   │
 * │ in parallel showed 4 identical lines in the same second — the user reads │
 * │ the log and has no idea what the worker is doing, only that it's busy.   │
 * │                                                                          │
 * │ The keyword and the path are already sitting in `call.input`. We're      │
 * │ ALREADY HOLDING them, so staying silent is willful blindness — same rule │
 * │ as the "where did the result go" block: whatever's observable shouldn't  │
 * │ be left for the user to guess.                                          │
 * │                                                                          │
 * │ And "project" is a programmer's word. Our user runs a flower shop.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function describeCall(call: ToolCall, arms?: Record<string, string>): string {
  const file = typeof call.input['file_path'] === 'string' ? basename(call.input['file_path']) : '';
  switch (call.name) {
    case 'Read':
      return file ? t('wk.doingReadFile', { file }) : t('wk.doingRead');
    case 'Write':
    case 'Edit':
      return file ? t('wk.doingWriteFile', { file }) : t('wk.doingWrite');
    case 'Grep':
    case 'Glob': {
      const what = str(call.input['pattern']);
      /**
       * ⚠ THE SEARCH LOCATION IS INFERRED FROM BOTH `path` AND `pattern`, and
       * the default must NOT be "the office". Real case 08/24, the log
       * literally showed:
       *
       *   searching "D:/Downloads/*" in the office
       *
       * A **wrong** sentence: that turn wasn't searching inside the office at
       * all. `roomOf` only accepts `path`, and the model often stuffs an
       * absolute path straight into `pattern` while leaving `path` empty ⇒
       * `roomOf('')` falls back to the default.
       *
       * The log is the **only window** the user has into where a worker just
       * touched on their machine — same reason the `Bash` block below prints
       * the whole command. A log line that names the wrong place is worse
       * than one that says nothing at all: it convinces the user everything
       * is happening inside the office.
       */
      const where = str(call.input['path']) || what;
      const term = what && what.length <= 40 ? ` “${what}”` : '';
      // A COMPLETELY different sentence, not just a swapped room name: a log
      // line that reads awkwardly gets skipped, and the "inside vs. outside
      // the office" merge would have read exactly that way.
      if (isAbsolutePath(where)) return t('wk.doingSearchOutside', { term });
      return t('wk.doingSearchIn', { term, room: roomOf(str(call.input['path'])) });
    }
    case 'WebSearch':
      return t('wk.doingWebSearch');
    case 'WebFetch':
      return t('wk.doingWebFetch');
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ SAY THE COMMAND, NOT JUST "A COMMAND RAN".                           │
     * │                                                                      │
     * │ The old version returned the fixed string 'running a command' for      │
     * │ every command — while `call.input['command']` was sitting right       │
     * │ there. That's willful blindness, the same bug `landingOf` once had     │
     * │ swallowing a path written outside.                                    │
     * │                                                                      │
     * │ And it got a lot heavier from 08/22, when `Bash` became ON BY          │
     * │ DEFAULT: it's the only tool that can leave the office directory,       │
     * │ `officeJail` doesn't match it, and the `write_external` gate isn't      │
     * │ built yet. This line is the **only window** the user has into what     │
     * │ a worker just did to their own machine.                               │
     * │                                                                      │
     * │ Cut at 60 characters: the status line is a single line, and a command  │
     * │ with a long pipe running a few hundred characters would push           │
     * │ everything else off screen. The front of the command is the part       │
     * │ that states intent (`git log …`, `ls …`, `curl …`). Newlines get        │
     * │ collapsed to spaces — a multi-line command would break the layout.      │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    // Both names: `Bash` on POSIX, `PowerShell` on Windows. → types.ts
    case 'Bash':
    case 'PowerShell': {
      const cmd = str(call.input['command']).replace(/\s+/g, ' ');
      if (!cmd) return t('wk.doingRunCommand');
      return t('wk.doingRunning', { cmd: cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd });
    }
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ AN ARM MUST HAVE A NAME AND A DESTINATION — a MANDATORY consequence   │
     * │ of the 08/24 fix, not a separate nice-to-have.                       │
     * │                                                                      │
     * │ Rule written down 08/22 when `Bash` became on by default: *"widening  │
     * │ a permission means widening the VISIBILITY into it, IN THE SAME        │
     * │ CHANGE. Split the two and there's a window where the permission is    │
     * │ wide but the view stays narrow — and that's the exact shape of every   │
     * │ silent incident."* Today an arm goes from "never runs" to "can write   │
     * │ a file onto the user's own disk". Same change, not tomorrow's.        │
     * │                                                                      │
     * │ The old version printed `working with a385afc3ab6` — a HASH. The      │
     * │ user named it "Programs Installation 2" in the dialog and would never  │
     * │ see that name again. The label already sits at                        │
     * │ `company.arms[id].label`.                                             │
     * │                                                                      │
     * │ ⚠ The tool-name suffix prints VERBATIM (`write_file` → `write file`),  │
     * │ NOT through a hand-written translation table. That table would be      │
     * │ correct for `filesystem` and mute for Notion, GitHub, and every         │
     * │ server a user plugs in themselves — i.e. it breaks EXACTLY as the       │
     * │ catalog grows. A slightly uglier raw name is right forever.            │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    default: {
      const server = mcpServerOf(call.name);
      if (!server) return t('wk.doingUsingTool', { tool: call.name });
      const who = arms?.[server] || server;
      const what = call.name.split('__').slice(2).join('__').replace(/_/g, ' ');
      const where = basename(str(call.input['path']) || str(call.input['destination']) || '');
      return `${who} · ${what || t('wk.doingWorking')}${where ? ` → ${where}` : ''}`;
    }
  }
}

/**
 * A search path → the room name the user knows.
 *
 * The user doesn't know what `library/text/` is, but they know "the
 * library" because they just dropped a file into it. Maps directory → UI
 * name, defaulting to "the office" rather than "the project".
 */
/**
 * An ABSOLUTE path on any OS — `D:\…`, `D:/…`, `/home/…`.
 *
 * Same rule as `folderRoots` (`catalog.ts`): accepts both shapes on every
 * platform, does NOT check `process.platform`. An office zipped over from a
 * different OS still has to read the exact string it wrote, and the log has
 * to read the exact string the model sent too.
 */
function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/');
}

/**
 * The SAME question `roomOf` answers, one step earlier: which room, as a value
 * rather than as a sentence.
 *
 * ⚠ There is exactly ONE set of these regexes, and both callers go through it.
 * Two copies would drift on the day someone adds a fourth store, and they would
 * drift SILENTLY — the sentence would say one room while the display walked a
 * character to another.
 */
function roomKindOf(searchPath: string): 'library' | 'artifacts' | 'knowledge' | 'desk' {
  const p = searchPath.replace(/\\/g, '/');
  if (/(^|\/)library(\/|$)/.test(p)) return 'library';
  if (/(^|\/)artifacts(\/|$)/.test(p)) return 'artifacts';
  if (/(^|\/)knowledge(\/|$)/.test(p)) return 'knowledge';
  return 'desk';
}

function roomOf(searchPath: string): string {
  switch (roomKindOf(searchPath)) {
    case 'library':
      return t('wk.roomLibrary');
    case 'artifacts':
      return t('wk.roomArtifacts');
    case 'knowledge':
      return t('wk.roomKnowledge');
    default:
      return t('wk.roomOffice');
  }
}

/**
 * WHERE this call landed, as a value. The machine-readable half of
 * `describeCall`. → docs/SPEC-office-animation.md §6c①
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NOTHING HERE IS INFERRED. Every branch reads a classifier that already    │
 * │ ran for another reason: `roomKindOf` for the status sentence,             │
 * │ `EXTERNAL_TOOLS` for `landingOf`, `mcpServerOf` for the audit log. This   │
 * │ function only stops the answer being thrown away.                        │
 * │                                                                          │
 * │ ⚠ `undefined` IS AN ANSWER, and it means *"no place"* — a tool we do not  │
 * │ classify (a todo list, a future builtin) must produce no movement at all. │
 * │ Guessing a place for it would be the display stating something nobody     │
 * │ observed, which is the one thing this whole field exists to avoid.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function placeOf(call: ToolCall): { at: WorkPlace; arm?: string } | undefined {
  // `EXTERNAL_TOOLS`, not `=== 'Bash'`: the shell tool carries a different name
  // per OS, exactly as `landingOf` already has to deal with.
  if (EXTERNAL_TOOLS.has(call.name)) return { at: 'shell' };
  switch (call.name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return { at: roomKindOf(str(call.input['file_path']) || str(call.input['notebook_path'])) };
    case 'Grep':
    case 'Glob': {
      /**
       * ⚠ Reads BOTH fields, the same trap `describeCall` records above: the
       * model often puts an absolute path in `pattern` and leaves `path` empty.
       *
       * Outside the office resolves to `desk` — *"working, from where they
       * stand"*. There is no station for the user's own disk, and inventing one
       * would teach a symbol that means nothing anywhere else in the product.
       */
      const where = str(call.input['path']) || str(call.input['pattern']);
      return { at: isAbsolutePath(where) ? 'desk' : roomKindOf(str(call.input['path'])) };
    }
    case 'WebSearch':
    case 'WebFetch':
      return { at: 'web' };
    default: {
      const server = mcpServerOf(call.name);
      return server ? { at: 'arm', arm: server } : undefined;
    }
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** `mcp__notion__create_page` → `notion`. The SDK's own tool-naming convention. */
export function mcpServerOf(name: string): string | undefined {
  const parts = name.split('__');
  return parts[0] === 'mcp' && parts[1] ? parts[1] : undefined;
}

/**
 * WHERE THE OUTPUT ACTUALLY WENT — inferred from TOOLS ACTUALLY CALLED, not
 * from what the model says.
 *
 * → docs/SPEC-offices.md §6 "Where the output lands"
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY NOT USE `receipt.artifacts`, AND WHY NOT FIX THE PROMPT              │
 * │                                                                          │
 * │ `artifacts` is something the model SELF-REPORTS. It can make up a path    │
 * │ it never wrote, and it can only describe FILES — while output can live    │
 * │ in Notion, Google Sheets, a database. Adding a prompt instruction "state  │
 * │ clearly where the output is" just buys back the exact uncertainty just    │
 * │ removed, at a permanent token cost.                                     │
 * │                                                                          │
 * │ But we ALREADY READ every `tool_use` block in the stream to build the     │
 * │ "what's happening" line — just throwing it away after composing the       │
 * │ sentence. A tool that got called is an OBSERVED FACT, not a claim.        │
 * │ Keeping it is done, 0 tokens, no prompt touched.                        │
 * │                                                                          │
 * │ The limit has to be stated outright: `Bash` can push data anywhere and    │
 * │ we do NOT know where. In that case we only report "a command ran" —       │
 * │ stating exactly what we know, leaving the rest for the worker's own       │
 * │ `say` to tell. The remaining uncertainty is BOXED IN AND LABELED, not      │
 * │ hidden away.                                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function landingOf(officeDir: string, call: ToolCall): Landing | undefined {
  if (call.name === 'Write' || call.name === 'Edit' || call.name === 'NotebookEdit') {
    const raw = call.input['file_path'] ?? call.input['notebook_path'];
    if (typeof raw !== 'string' || !raw) return undefined;
    try {
      // Locked inside the office directory: `safeJoin` throws if it leaves.
      const abs = safeJoin(officeDir, raw);
      const rel = relative(officeDir, abs).replace(/\\/g, '/');
      return rel ? { kind: 'file', ref: rel } : undefined;
    } catch {
      /**
       * OUTSIDE the OFFICE IS STILL A DESTINATION — report it by its real name.
       *
       * The old version returned `undefined`, i.e. said "there is no
       * destination". Wrong: we know FOR CERTAIN it just wrote, and know FOR
       * CERTAIN where. What we don't have is the AUTHORITY to call that a
       * legitimate user output — and that's a separate question.
       *
       * The `outside` label keeps both halves honest: the fact gets reported,
       * the legitimacy doesn't. `whereBlock` still never lists it under
       * "saved to"; `missingOutputs` uses it to say *"the file is at X"*
       * instead of *"nothing here, please redo it"* — the latter charges the
       * user a second time.
       */
      return { kind: 'outside', ref: raw.replace(/\\/g, '/') };
    }
  }
  // `EXTERNAL_TOOLS`, not `=== 'Bash'`: the shell tool carries a different
  // name per OS, and a missed destination is a HIDDEN destination.
  if (EXTERNAL_TOOLS.has(call.name)) return { kind: 'command', ref: '' };
  const server = mcpServerOf(call.name);
  return server ? { kind: 'external', ref: server } : undefined;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ASK THE CLI BACK WHAT IT ACTUALLY RECEIVED — instead of trusting it got    │
 * │ everything.                                                              │
 * │                                                                          │
 * │ This line of code came out of the 08/22 case: the shell tool is named     │
 * │ `PowerShell` on Windows, `Bash` on POSIX, and `Options.tools` is an        │
 * │ allowlist BY NAME that **silently drops** a name that doesn't exist. A     │
 * │ role declaring `Bash` on Windows got exactly the default set — the "allow │
 * │ commands" switch was a no-op for SIX DAYS, with no symptom at all.        │
 * │                                                                          │
 * │ `effectiveTools` plugged that hole by sending every name. But that fix    │
 * │ relies on a name table **we wrote by hand**, when the name table belongs   │
 * │ to the SDK. A fourth platform shows up with a third name and the old      │
 * │ bug comes right back, exactly as silent.                                 │
 * │                                                                          │
 * │ So the real block isn't the name table — it's **this cross-check**:       │
 * │ `system/init` has a `tools` field listing what the CLI actually granted.  │
 * │ Compare it against what we sent, and flag any difference. It doesn't      │
 * │ need to know which name is correct; it only needs to know "what I asked    │
 * │ for and what I got don't match". That's a far more durable invariant       │
 * │ than a list of strings.                                                  │
 * │                                                                          │
 * │ A PROCESS-level warning, not a user-level one: the person running a        │
 * │ flower shop can't do anything with this sentence, but the person setting  │
 * │ up the system can. Once per (role × missing tool set) — a worker runs      │
 * │ continuously, and flagging it every turn would turn a real signal into     │
 * │ noise everyone learns to ignore.                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const warned = new Set<string>();

export function warnDroppedTools(role: Role, granted: unknown): string[] {
  if (!Array.isArray(granted)) return [];
  const got = new Set(granted.filter((t): t is string => typeof t === 'string'));

  /**
   * Shell names are counted as a GROUP, not individually. We deliberately
   * send both `Bash` and `PowerShell` and **expect** one to be dropped —
   * flag it only when the pair itself would create a false alarm on every
   * run, on every OS.
   */
  const asked = effectiveTools(role.tools);
  const dropped = asked.filter((t) => !got.has(t) && !EXTERNAL_TOOLS.has(t));
  if (hasShell(role.tools) && !asked.some((t) => EXTERNAL_TOOLS.has(t) && got.has(t))) {
    dropped.push('(the shell tool)');
  }
  /**
   * ARMS GO THROUGH THE SAME INVARIANT — added 08/24.
   *
   * This function was born 08/22 out of one exact sentence: *"what I asked
   * for and what I got don't match"*. An arm just hit that same shape through
   * a different door — wired up, paying 2,185 tokens/turn, and **not a
   * single tool granted** because the server died at startup (`npx` failed
   * to fetch the package · wrong package name · this machine has no
   * node). No error, no warning, just a worker saying "I couldn't do it" and
   * a bill.
   *
   * This is a check at the RIGHT LAYER: it doesn't need to know the arm's
   * name or how many tools it has — only that the role declares `mcp:` while
   * the CLI granted 0 tools carrying the `mcp__` prefix.
   */
  if (role.mcp.length && ![...got].some((t) => t.startsWith('mcp__'))) {
    dropped.push(`(arms: ${role.mcp.join(', ')})`);
  }
  if (dropped.length === 0) return [];

  const key = `${role.id}:${dropped.join(',')}`;
  if (!warned.has(key)) {
    warned.add(key);
    process.emitWarning(
      // Log line, so English literal.
      `Role "${role.id}" asked for ${dropped.length} tools Claude Code did not grant: ${dropped.join(', ')}. ` +
        `The CLI silently drops tool names it does not know, so this feature is NOT running. ` +
        `Check the name table at src/core/types.ts §SHELL_ALIASES.`,
    );
  }
  return dropped;
}

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Classifies an error. Rate limiting and running out of subscription usage
 * are TWO different things, handled in opposite ways →
 * docs/SPEC-2026-08-14-agentco.md §9b
 */
/**
 * SDK error code → a SENTENCE for a person to read. → `assistant.ts` at
 * `is_error`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Why this is a function and not a string written on the spot: the same     │
 * │ error code shows up on **two paths** (the Assistant and a worker), and     │
 * │ two different translations of the same incident is something this         │
 * │ project has paid for more than once.                                     │
 * │                                                                          │
 * │ ⚠ Translate ONLY when the SDK does **not** give a real sentence. When      │
 * │ there's a real one, keep it as-is — replacing a specific sentence with a   │
 * │ generic one throws away information.                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function sayError(raw: string, kind: FailureKind): string {
  // The SDK already said something meaningful (not a machine code) ⇒ keep it as-is.
  if (!/^error_[a-z_]+$/.test(raw.trim())) return raw;
  if (kind === 'max_turns') {
    return (
      t('wk.stopMaxTurns')
    );
  }
  if (kind === 'budget') return t('wk.stopBudget');
  if (kind === 'usage_limit') return t('wk.stopUsageLimit');
  if (kind === 'rate_limit') return t('wk.stopRateLimit');
  if (kind === 'auth') return t('wk.stopAuth');
  return t('wk.stopOther', { raw });
}

export function classifyError(err: unknown): FailureKind {
  const msg = errorMessage(err);

  for (const prefix of USAGE_LIMIT_PREFIXES) {
    if (msg.includes(prefix)) return 'usage_limit';
  }
  if (/maximum number of turns|max_turns/i.test(msg)) return 'max_turns';
  if (/\b429\b|rate.?limit|too many requests/i.test(msg)) return 'rate_limit';
  if (/not logged in|unauthor|authentic|invalid api key|no credentials/i.test(msg)) return 'auth';
  return 'other';
}

/**
 * Taken from the SDK when available; a fallback list is kept so a single SDK
 * update doesn't make the system mistake "out of usage" for "an odd error"
 * and retry pointlessly.
 */
const USAGE_LIMIT_PREFIXES: readonly string[] = [
  "You've hit your",
  "You've reached your",
  "You're out of usage credits",
  'Your org is out of usage',
  "Your seat type doesn't include usage",
  'Your usage allocation has been disabled',
  "You're out of extra usage",
];
