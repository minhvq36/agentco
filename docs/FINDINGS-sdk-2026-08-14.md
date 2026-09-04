# Claude Agent SDK evaluation findings — 2026-08-14

Measured on-machine, not read off docs. Environment: Node v22.12.0, npm 10.9.0, Claude Code CLI 2.1.231, `@anthropic-ai/claude-agent-sdk@0.3.231`. Authenticated with **the local Claude Code subscription, no API key** — worked out of the box.

> SDK version tracks CLI closely (`0.3.231` ↔ `2.1.231`). Pin the version in `package.json`.

---

## 1. The make-or-break question: can we control the cache breakpoint? → **YES**

```ts
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk'

systemPrompt: [
  staticInstructions,              // ◄── cache CROSS-SESSION
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  sessionContext,                  // ◄── not cached globally
]
```

Straight from the type definition:

> *"Marker string that splits a custom `systemPrompt` into a static prefix (**eligible for cross-session prompt caching**) and a dynamic suffix (session-specific, not globally cached). Blocks before it get **global cache scope**, blocks after do not."*

**This is better than the assumption in the spec.** "Cross-session / global cache scope" means multiple **different** worker sessions share the same cache entry — exactly the design in `SPEC-token-economy.md` §2 (cache key by role, every worker of that role shares it). Not something we have to build ourselves — the SDK supports it natively.

Bundled with it: `excludeDynamicSections: true` for the preset — strips working directory, auto-memory, git status out of the system prompt and injects them into the first user message instead, so the prefix stays still. The doc comment says outright: *"Cacheable prompt for multi-user fleets."*

**→ `SPEC-token-economy.md` §2 stands as-is, no rewrite needed.**

---

## 2. Prefix measurements (each variant salted separately to force a cold start)

| # | Configuration | Prefix | cache_write | cache_read | Price per call |
|---|---|---:|---:|---:|---:|
| 1 | full `claude_code` preset | 19,668 | 19,668 | 0 | $0.0402 |
| 2 | preset + `excludeDynamicSections` | 19,478 | 19,478 | 0 | $0.0399 |
| 3 | **short custom systemPrompt** | **13,190** | 2,635 | 10,555 | **$0.0072** |
| 4 | custom + `allowedTools: []` | 13,190 | 2,635 | 10,555 | $0.0072 |
| 5 | custom + only `Read`, `Write` | 13,190 | 2,635 | 10,555 | $0.0073 |
| 6 | custom + `strictMcpConfig` | 13,187 | 2,632 | 10,555 | $0.0073 |

*(model `haiku`, prompt "answer in one word", `maxTurns: 1`, `persistSession: false`)*

### Three conclusions from this table

**a) Don't use the `claude_code` preset for non-coding workers.** The gap is **~6,300 tokens/call**, and the real price gap is **5.5x** ($0.040 vs $0.0072). The preset carries all of Claude Code's coding instructions — `writer`, `researcher`, `analyst` don't need any of it. → `roles/*.yaml` gets a new `use_preset: false` field, default off, only turned on for `coder`/`reviewer`.

**b) `allowedTools` does NOT shrink the prompt.** Rows 3-4-5-6 are identical. `allowedTools` is a **permission** filter, not a **size** lever. Tool definitions are always sent in full.
→ **A hard floor of ~13,200 tokens per worker call.** Not negotiable. The spec had missed this number.

**c) But that floor is mostly served from the global cache.** 10,555 of 13,190 comes back as `cache_read` starting on the very first call of a fresh configuration — the static-prefix mechanism from §1 kicking in automatically. The real marginal cost of a worker call is ≈ **2,600 cache_write + 10,500 cache_read**, not the full 13,200.

### Does the cache actually work? Yes.

Three consecutive calls with the same prefix:

```
A1 (first)              cw=3666  cr=15799
A2 (same prefix)        cw=2825  cr=16641
A3 (same prefix)        cw=2824  cr=16641
```

Changing systemPrompt → `cw=13192 cr=0` (clean miss, as expected). Repeating it → `cw=2603 cr=10590` (hit).

**There's still a recurring `cache_write` of ~2,600 tokens on EVERY call.** This is the dynamic suffix getting rewritten each time. Whether it can be pushed down further is unclear → **M1's job**, not week 1.

### An array-shaped systemPrompt does NOT create a breakpoint by itself

A 3-element array gives the exact same result as the concatenated string (`cw=2651 cr=10555`). The array is just a way of writing it; **`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` has to be inserted explicitly** for it to have any effect.

---

## 3. Things the SDK already gives us that the spec was planning to build itself

| Spec was planning to build | SDK already has it |
|---|---|
| Per-task budget ceiling | **`maxBudgetUsd`** → returns `error_max_budget_usd`. Native, no manual counting needed. |
| Worker not writing to disk | **`persistSession: false`** — session lives in RAM only. Matches the stateless-agent design exactly. |
| `max_turns` | `maxTurns` |
| Subagent definitions | **`agents?: Record<string, AgentDefinition>`** — each agent gets its own `model`, `tools`, `mcpServers`, `maxTurns`. This is exactly our `roles/*.yaml`. |
| Events for the UI | **28 hook events**, including `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `PreCompact`, `PostCompact`, `MessageDisplay` |
| Cost accounting | `result.usage` + `result.modelUsage` carry `cache_creation_input_tokens`, `cache_read_input_tokens`, `costUSD`, `contextWindow` per model |
| Session management | `listSessions`, `getSessionMessages`, `getSubagentMessages`, `forkSession`, `renameSession`, `tagSession`, `deleteSession` |
| Running on a VPS/container | **`sessionStore`** adapter (alpha) — mirrors the transcript to a separate backend, resumable from a different machine |

Sample `modelUsage`:

```json
{ "claude-haiku-4-5-20251001": {
  "inputTokens": 541, "outputTokens": 90,
  "cacheReadInputTokens": 15799, "cacheCreationInputTokens": 3666,
  "costUSD": 0.0099029, "contextWindow": 200000,
  "canonicalModel": "claude-haiku-4-5", "provider": "firstParty" } }
```

→ `agentco cost` and `logs/usage.jsonl` can be built exactly as designed in `SPEC-token-economy.md` §5.

---

## 4. Three traps to avoid

### 🔴 MCP breaks prompt cache on resume

[Issue #247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247) (closed, dup of #89): `createSdkMcpServer()` creates an instance that **doesn't serialize**; if MCP is present in a resumed query → **cache miss every time it resumes**. HTTP-style MCP is affected too.

**Direct impact on us:** master is a long-lived session, resumed constantly. Attaching MCP to master = killing master's own cache.

**Response:**
- **Master: no MCP.** Master only plans and reads receipts, neither of which needs MCP.
- **MCP only attaches to workers**, and workers are one-shot `query()` calls that never resume → immune to the bug.
- This actually **reinforces** the stateless design rather than undermining it.

### 🟠 The V2 `createSession()` API was REMOVED as of 0.3.142

A lot of blog posts/tutorials online still teach `createSession()` with a `send`/`stream` pattern. **It's dead.** Use `query()` + `continue`/`resume`/`forkSession`. Don't trust an undated tutorial.

### 🟠 Session files are tied to the machine

Stored at `~/.claude/projects/<encoded-cwd>/*.jsonl`. Running on a VPS/container requires the `sessionStore` adapter (still **alpha**) or moving the files by hand. The docs say it plainly: *"Don't rely on session resume — capture the results you need as application state."*

**→ This matches the "own the artifact, not the prompt" principle we already settled on.** Master losing its session loses nothing that matters, because everything of value already lives in files.

---

## 5. The number to remember when pricing this out

A **minimal** worker call (Haiku, one word, no tool runs):

| | claude_code preset | Custom systemPrompt |
|---|---:|---:|
| Price | ~$0.040 | ~$0.0072 |

### 13,200 is NOT what we pay — we pay ~4,350

Once the cache is warm, the real effective cost of a worker call:

```
10,555 cache_read  × 0.1x  =  1,056
 2,635 cache_write × 1.25x =  3,294   ← this line costs 3x more than the cache-read line
                     total ≈  4,350 effective tokens
```

Two takeaways:

1. **Real overhead is ≈ 1/3 of the 13,200 figure.** Don't price anything off 13,200.
2. **The most expensive part is the recurring write, not the cache read.** Optimization should target that — M1's job.

**Important measurement caveat:** the probe used `maxTurns: 1` — the **worst case**. The 2,635-token write is a breakpoint placed at the end of a turn for the next turn to read; on a 1-turn task the cost is paid in full, on a 10-turn task it amortizes over the following 9 turns. Real work is meaningfully cheaper. This needs re-measuring on multi-turn tasks for real numbers.

### When you pay the 1.25x — and when you DON'T

The cache lives **on Anthropic's servers**, not in our process.

| You pay 1.25x | You do NOT pay 1.25x |
|---|---|
| First time that prefix appears | Killing the process / restarting the daemon |
| TTL expired (every hit **extends** the TTL) | A new session |
| Editing a role, bumping `knowledge_version` | A different worker, same role |
| Upgrading the SDK/CLI | Running multiple workers in parallel with the same prefix |

The 200K context ceiling is **unrelated** to caching — two separate things.

### A new design rule (not in the original spec)

> **Prefer fewer, larger tasks over many small ones.** Every task carries a fixed overhead regardless of how big or small the work is. Splitting a DAG too finely just to look tidy in parallel is burning money.

Split a task when there's **real parallelism** or a **different role is needed**. Don't split it just to make the diagram look nicer.

---

## 5b. Two architectural decisions locked in by the measurements

### Master wants MCP → use the `concierge` role, don't hang MCP off the master session

The problem: master is a long-lived session, resumed constantly. Attaching MCP → issue #247 → cache breaks.

Quantified: master's context is ~40K, cache breaking means every turn is paid at 40K at 1.0x instead of 0.1x = **~36,000 extra effective tokens per master turn**. A one-shot worker with MCP costs only **~4,350** on Haiku. **Almost an order of magnitude cheaper.**

→ Add a **`concierge`** role: one-shot, tier `eco`, has MCP, used for small errands (check a calendar, send a message, query a DB, fetch a URL). Master calls it instead of holding MCP itself.

**"Calling in staff" is a UI concern, not an architectural one.** In the interface, `concierge` **doesn't show up as a task** — it appears as master doing the work itself. This keeps the feel of "master can handle small errands on its own," but cheaper and without breaking the cache.

Keep `master.mcp: false` as a **setting** in `company.yaml`, not hardcoded — flip it on once #89/#247 are fixed.

### Hand-write the worker, do NOT use the SDK subagent — but borrow its format

**A hand-written worker still shares the cache.** Direct evidence from probe2: four **independent** `query()` calls, **four different** system prompts, all four came back `cr=10,555` identically — sharing the same globally-cached static prefix. The cache is a property of the **prefix on the server**, not of how the agent was spawned.

So the decision has to rest on other grounds, and all three point toward hand-writing:

1. **An SDK subagent's output flows straight into the parent's context** — exactly what the Receipt protocol was built to block. **Veto-level.**
2. [Issue #89](https://github.com/anthropics/claude-agent-sdk-typescript/issues/89) (opened 12/2025, still untouched) says outright: *"Subagents struggle to fully use the cache."*
3. Calling `query()` directly is the only way to set `maxBudgetUsd`, `persistSession: false`, and a per-worker `maxTurns`, and to enforce the receipt schema.

**But we do use `AgentDefinition`'s exact shape as the role file format.** Anyone used to Claude Code recognizes it instantly, it's portable, and if we later want to switch to real subagents we won't have to change the files. The SDK's format, our own execution.

→ **Item #2 under "needs measuring" in `ROADMAP.md` counts as decided — no test needed.**

---

## 5c. Turn count is the real cost lever — not task count

Measured on a real running system, not a synthetic probe.

**Real-world cost formula:**

```
cost ≈ TURN COUNT × prefix × 0.1  +  cache-write × 1.25  +  output
```

`cache_read` **scales with turn count**, because every tool-calling turn re-reads the entire prefix. This **corrects §5** above: a multi-turn task does amortize the `cache_write` cost, but it simultaneously **multiplies** the `cache_read` cost — and the multiplication outweighs the amortization.

→ The SDK returns `num_turns` in the result message. The system logs it to `logs/usage.jsonl`, and `agentco cost` prints **turns per task by role**. This is the number to watch when optimizing, not total tokens.

### A "turn discipline" prompt barely moves the needle

We added a whole section to the system prompt (read each file once, don't re-read a file you just wrote, no probing around, batch your reads). Before/after: writer stayed flat (34,650 → 35,693 cache_read), reviewer actually went up.

**Honest conclusion: you cannot optimize turn count by telling the model not to use many turns.** Turn count is a property of the model plus task difficulty, not of instructions. The real levers are: model choice, and giving a brief clear enough that the agent doesn't have to go hunting.

### Comparing tiers on the same task (cache warm)

| tier | turns | tokens | time | cost |
|---|---:|---:|---:|---:|
| `eco` (Haiku) | 10 | 137,372 | 77.9s | **$0.0556** |
| `standard` (Sonnet) | 4 | 63,350 | 37.0s | $0.0893 |

Haiku takes **2.5x the turns**, 2.17x the tokens, is 2.11x slower — **yet is still 38% cheaper**, because it's ~3.4x cheaper per token.

> **Rule: `eco` only wins when `token_multiplier < price_ratio`.** The margin is thinner than the price ratio suggests. The more complex the task, the higher the multiplier climbs, until it flips into a loss.

Two costs that don't show up in the pricing table:
- **Double the latency** — for a product where a single user is sitting and waiting, this usually matters more than 3 cents
- **Unpredictable turn count** — Haiku: 9 then 10 for the same task; Sonnet: 4 then 4. So, counterintuitively, **the `eco` role needs a higher `max_turns` than the `standard` role**.

Reproduce: `node bench/tier-compare.mjs`

---

## 5d. Cache priming gate — measured on a real system

Two `writer` runs in parallel, same cacheKey:

| | cache_write | cost |
|---|---:|---:|
| first task (primer, ran alone) | 20,103 | $0.136 |
| second task (waited at the gate, then ran) | **4,239** | **$0.048** |

Same role, same kind of work, **2.8x cheaper**. Without the gate, both would have paid ~20K cache_write.

---

## 6. Still to check (not yet done)

1. Does `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` with **~2K tokens of HOT knowledge** placed before the marker actually hit cross-session between two different processes? This is the direct proof needed for §2.
2. Can the recurring ~2,600/call `cache_write` be pushed down?
3. Real parallelism ceiling: how many concurrent `query()` calls before hitting a 429? → sets the default `concurrency`.
4. `agents` (SDK subagents) vs. hand-running multiple `query()` calls: which is cheaper? A subagent shares its parent's prefix and might be noticeably cheaper.
5. Whether the `sessionStore` alpha is usable for VPS mode.

Items 1 and 4 should be done **before day 3** of week 1 — they could change the scheduler's structure.

---

## Appendix — measurement scripts (reproducible)

Two scripts live under `bench/` in this repo:

- `bench/probe-cache.mjs` — cache behavior across multiple calls with the same/different prefix
- `bench/probe-prefix.mjs` — prefix size for each systemPrompt/tools configuration

Run: `cd bench && npm i && node probe-cache.mjs`. Requires an active local Claude Code login. This is the seed for `agentco bench` (`SPEC-token-economy.md` §6).
