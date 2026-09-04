# SPEC — Token economy & performance

**This is the most important file.** Every other design decision has to pass the
rules laid out here. If a feature is nice but violates §2 or §3, that feature is
out, no negotiation.

> **Verified on-machine 14/08/2026 — see `FINDINGS-sdk-2026-08-14.md`.** Three
> corrections to the original version:
> 1. The cache breakpoint **can be controlled** via
>    `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` (cross-session cache). §2 still holds.
> 2. **A hard floor of ~13,200 tokens/worker call** — `allowedTools` cannot shrink
>    the prompt below it. Added in §4.
> 3. **Do not use the `claude_code` preset for non-coding roles** — a ~6,300 token
>    gap, at 5.5× the price.

---

## 1. Where the cost comes from (ranked by danger)

| # | Token-burning source | Level | How it's blocked |
|---|---|---|---|
| 1 | **Master reads a worker's raw output** | 🔴 fatal | Receipt capped at 800 tokens, hard validation |
| 2 | **A long-lived session for a worker** | 🔴 fatal | Worker is stateless |
| 3 | **Cache miss from a changed prefix** | 🔴 fatal | Layered architecture §2 + priming gate §3 |
| 4 | **Master pastes file content into a brief** | 🟠 severe | The brief only carries a **path**, the worker reads it itself |
| 5 | **The knowledge graph bloats over time** | 🟠 severe (slow death) | Nodes ≤250 tokens, Librarian merges/archives |
| 6 | **The whole knowledge store gets loaded into every task** | 🟠 severe | `knowledge_pack` cap, scored retrieval |
| 7 | **Re-running the whole DAG to fix one step** | 🟡 moderate | Replay by subtree |
| 8 | **Using an expensive model for trivial work** | 🟡 moderate | Deterministic switch center |
| 9 | **Agents talking to each other** | 🟡 moderate | Banned outright, goes through master/artifact |

Item #3 is exactly what killed the fanpage project with `claude -p`. Most of the
rest of this file is about it.

---

## 2. Prefix cache architecture

### How Anthropic prompt caching actually works

- Cache is **server-side**, keyed on **content prefix** (byte-identical from the
  start of the prompt).
- **A new process still hits cache** if the prefix is identical and still within
  TTL. This is the crucial point — the cache doesn't die with the process.
- TTL: **5 minutes** by default; a **1-hour** option is available.
- Relative pricing: cache **read ≈ 0.1×** normal input. Cache **write ≈ 1.25×**
  (5-minute TTL) or **≈ 2×** (1-hour TTL).
- One differing byte at the start of the prompt → **everything** after it misses.

Two rules follow from this:

> **Rule A — Order by stability.** Whatever changes least goes first, whatever
> changes every turn goes last. Never insert something volatile in the middle.
>
> **Rule B — A cache write must be amortized.** Writing to cache and only reading
> it back once is a loss. Write, then read ≥3 times to come out ahead.

### Prompt layering (applies to every worker)

```
┌─ FROZEN — sits in the prefix cache ────────────────────────┐
│ L0  Harness system prompt (fixed per software version)     │
│ L1  Tool definitions (fixed per role)                      │
│ L2  Role card + skills (fixed per role.version)             │
│ L3  Company charter (pinned, ≤500 tokens)                  │
│ L4  HOT knowledge — top N most-used nodes for the role      │
└──────────────── ◄── CACHE BREAKPOINT HERE ─────────────────┘
┌─ VOLATILE — pays full price, so must stay small ───────────┐
│ L5  Cold knowledge — nodes specific to this task            │
│ L6  TaskBrief                                                │
│ L7  Conversation turns within the task                       │
└────────────────────────────────────────────────────────────┘
```

**Cache key = `hash(L0..L4)` = `(software_version, role_id, role_version, knowledge_version)`**

Important consequence: **every worker of the same role shares one cache entry.**
5 writers running in parallel = 1 cache write, 5 cache reads.

### 🔴 The language switch is NOT part of the cache key — and that's a deliberate decision (03/09)

`company.yaml → language` changes the **interface**, not a single byte of the
prompt. No prompt-builder function accepts a locale, no string in a prompt names
a language.

⇒ **Flipping the switch costs 0 `cache_write`.** If the two were wired together,
every time a user changed their interface language it would mean rewriting the
prefix for **every role in every office** — a UI toggle that looks harmless would
become the most expensive line item in this table. `test/settings-language.test.ts`
locks in that claim by building the prompt in both locales and comparing
`cacheKey`; `test/no-pinned-language.test.ts` locks the static side.

### Measured 03/09 — the static prompt moved to English

Every conversion sentence of the form *"~450 tokens ≈ 300 Vietnamese words"*
anywhere in this repo **has become inaccurate** as of this change: the static
prompt is now English, and the char/token ratio is completely different.

| Block | Characters | Tokens | char/token |
|---|---|---|---|
| `COMPACT_RULES` | 3,826 | 961 | **3.98** |
| `SHELL_LEGEND` | 827 | 208 | **3.98** |

Controlled on **the same sentence**, in two languages: `vi` 167 characters → **49
tokens**; `en` 164 characters → **42 tokens**. So the English version is **~14%**
cheaper for the same content, and the 3.98 char/token ratio matches the ~4 figure
`prompt.ts:48-50` already stated from the start (Vietnamese ~2.6).

⇒ The token caps (`receipt_tokens: 800` · `charter_tokens: 500` ·
`assistant_skills_tokens: 400`) **remain safe and are now effectively looser than
they need to be**: the same cap now holds more actual content. No loosening, no
tightening — just stop reading those numbers through a "Vietnamese words" formula.

### Hot knowledge — two knowledge tiers

This is the easiest place to get wrong. If all task-retrieved knowledge gets
stuffed into the prefix, the prefix changes on every task → **100% cache miss**,
worse than having no cache at all.

So it splits into two tiers:

| Tier | Contents | Position | Recomputed when |
|---|---|---|---|
| **HOT** | the top `hot_knowledge_size` nodes with the highest `hits` for the role (default 8, 2,000-token cap) | in the prefix, **cached** | only when `knowledge_version` bumps — default once/day or manually |
| **COLD** | nodes retrieved specifically for this task | after the breakpoint, **pays full price** | every task |

Hot knowledge is nearly free. Cold knowledge is paid for — so the
`knowledge_pack` cap only counts the COLD portion.

> **Do not bump `knowledge_version` on every node the Librarian writes.** Batch
> them, bump per batch. Every bump = every role has to rewrite its cache.

### How to choose the TTL

```
If the company is "in a run" (UI open OR bridge is active)  → 1-hour TTL
Otherwise (a one-off task then idle)                          → 5-minute TTL
```

Reason: a 1-hour TTL costs ~1.6× more to write, but it saves every idle gap
between the user's keystrokes. A user pausing 7 minutes between two messages is
normal → a 5-minute TTL means that write is wasted.

---

### 2b. Ordering blocks in the prefix: ask "BUILT or USED", don't guess frequency (locked in 20/08)

`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` sits at the **end** of every block, so the whole
block lives in the cached region — and caching is **prefix-based**. If one block
changes, every block **after it** gets rewritten along with it.

The document-library manifest used to sit right after the charter, **above**
memory · hot · roster · the results manifest, for a reason written straight into
the code: *"the library changes less often than wiring on the canvas."*
**Real observation refutes it:**

| | action | actual frequency |
|---|---|---|
| roster | wiring on the canvas | **BUILT** — once, almost never touched again |
| library manifest | dropping a document in | **USED** — repeats for the office's whole life |
| results manifest | generated after every run | **USED** — every run |

Moving the library manifest down next to the results manifest ⇒ adding one
document now rewrites **3 blocks** instead of **6**. `PROMPT_SCHEMA_VERSION` 3 → 4.

> **Don't guess frequency by which one "sounds rarer."** The question that yields
> the real frequency is: *is this something people do while SETTING UP the
> system, or something they do every day while USING it?*

⚠ Distinguish this from the **"HOT must be STABLE"** rule (§2): there, the cost
repeats **every task**, which is what makes it fatal. Here the cost is **once per
human action** — paying it to get a manifest that doesn't lie is a trade in the
right direction.

**A premise easy to get wrong, already measured:** a worker does **not** use the
Assistant's cache. The worker's prefix opens with `CORE_PROMPT`, the Assistant's
prefix opens with `ASSISTANT_CORE` — two different cache entries. Both manifests
already gate on `who === 'assistant'`, so they've **never** entered an employee's
prefix. Adding/removing a document doesn't touch a single cache token of any
worker's.

## 3. Cache priming gate

**Problem:** launching 5 same-role tasks in parallel before the cache exists →
all 5 miss together, all 5 pay a cache-write together (1.25–2×). Right when
parallelism should be saving money, it becomes the most expensive moment.

**Fix:** lock by `cache_key`.

```
scheduler receives N tasks, groups them by cache_key

for each cache_key:
  if the key is ALREADY WARM (recorded in warmSet, still within TTL):
      → launch all of them in parallel immediately
  if the key is NOT WARM:
      → let 1 task run first (priming run)
      → the remaining tasks WAIT
      → once the priming run receives its first token from the API:
            mark the key warm → release the rest
      → 20s timeout: release everyone regardless (better to pay than to hang)
```

Details:
- Don't wait for the priming run to **finish**, only for it to **start
  streaming**. The cache prefix has already been written by that point.
- `warmSet` is a `Map<cache_key, expiresAt>`, expiring on its own per the TTL
  already in use.
- On daemon startup, `warmSet` starts empty. **Do not** proactively warm it with
  a dummy call — a dummy call still costs money and might never get reused.

---

## 4. Budgets — default numbers

Pinned as constants in code, overridable via `company.yaml`.

| Item | Default | Cap type |
|---|---|---|
| Receipt | 800 tokens | **hard** — truncated |
| Knowledge node | 250 tokens | **hard** — write rejected, must split |
| Charter (pinned) | 500 tokens | **hard** |
| Hot knowledge / role | 2,000 tokens | **hard** |
| Cold knowledge / task | 3,000 tokens | **hard** |
| TaskBrief | 1,500 tokens | soft — warns |
| Master's context before compaction | 60,000 tokens | trigger threshold |
| max_tokens / task | 60,000 | **hard** — task cancelled |
| max_turns / task | 15 | **hard** — task cancelled |
| Concurrency | 4 | configurable |
| **Overhead floor / worker call** | **~13,200 tokens** | **cannot be reduced** — see `FINDINGS` §2b |

### Choosing a tier: a rule decides, not intuition

Measured for real on 14/08/2026, on **the same proofreading job** (2 input files,
same constraints, cache already warm):

| tier | turns | tokens | time | cost |
|---|---:|---:|---:|---:|
| `eco` (Haiku) | 10 | 137,372 | 77.9s | **$0.0556** |
| `standard` (Sonnet) | 4 | 63,350 | 37.0s | $0.0893 |

The cheaper model **fumbles through more turns**, and each turn re-reads the
whole prefix. So "cheap per token" does NOT automatically become "cheap per job."
The rule:

> **`eco` only pays off when `token_multiplier < price_ratio`.**
> Here 2.17 < ~3.4, so it still pays off. But the margin is much thinner than the
> price ratio suggests — and for a more complex job, the token multiplier will
> keep rising until it loses money.

**Measure, don't guess:** `node bench/tier-compare.mjs` runs exactly this
comparison for any given role.

> ⚠ **This table measures the PATH TAKEN, not the OUTPUT.** It implicitly assumes
> the two tiers produce the same result. For work with a single correct answer,
> that assumption is false, and the whole formula above is meaningless — see the
> third cost right below.

### The three costs of `eco` that the price table doesn't show

1. **Double the latency.** 78s versus 37s. The user is sitting there waiting —
   for a single-user product, this usually matters more than 3 cents.
2. **The turn count is unpredictable.** Haiku: 9, then 10 turns for the same job.
   Sonnet: 4, then 4. Meaning **an `eco` role needs a MUCH HIGHER** `max_turns`
   budget than a `standard` role — counter to intuition, and the reason
   `reviewer` once failed at `max_turns` 4, then again at 6.

> **Rule:** an `eco` role should set `max_turns` ≥ 1.5× the measured turn count.
> A `standard` role can get by with ≈ 2×.

3. 🔴 **THE THIRD COST, MEASURED 21/08 AND HEAVIER THAN THE OTHER TWO COMBINED:
   WRONG ANSWERS.**

The comparison table in §4 above measures **turns · tokens · seconds**, which
implicitly assumes *both tiers produce the same result, just by a different
path*. The `spreadsheet` case from 21/08 refutes that assumption. Same job
(aggregate a 200-row CSV by `Department`×`City`, sum + average of salary and
age), same input, run three times:

| run | tier | cost (worker) | **arithmetic** |
|---|---|---:|---|
| `P-260821-1805-d6v9` | `eco` (Haiku) | $0.157 | **wrong on 45/51 groups**, 5 groups missing entirely, 1 group that doesn't exist |
| `P-260821-1818-yydi` | `eco` (Haiku) | $0.179 | wrong on 3/56 groups |
| `P-260821-1827-m78h` | `standard` (Sonnet) | $0.425 | **correct 56/56 — not one number wrong** |

**`eco` was a NEGATIVE saving on this job:** $0.336 spent on two unusable
results, and then still paying $0.425 to get a correct one. $0.761 total instead
of $0.425.

Three takeaways, ranked by how much they matter:

- **The error rate is NOT stable between two runs of the same tier.** Same
  Haiku, same input, two *different* wrong answers (45/51, then 3/56). So this
  isn't a defect you can measure once and discount for — it's a **lottery**, and
  a lottery has no number to plug into the `token_multiplier < price_ratio`
  formula.
- **This is not "an LLM just can't do arithmetic."** Sonnet was perfectly correct
  **without using a single tool**. The "well, language models are just bad at
  numbers" excuse is refuted by the measurement itself.
- **No existing gate sees this happening.** `missingOutputs` checks that files
  exist; `looped` checks for repeated actions; both stayed green on the run that
  was wrong on 45/51 groups. See `SESSIONS_MEMORY` §5l ④.

> **Rule:** the tier-selection formula in §4 only applies to work where **every
> tier produces a correct result** — drafting, summarizing, classifying,
> reformatting. For work with **a single correct answer** (arithmetic,
> reconciliation, precise extraction), the token table says nothing useful, and
> `eco` must be **measured on output**, not on the bill.

⚠ **This is NOT a reason for agentco to auto-raise the tier.** Tier is the user's
money and the user's decision (`role.model_tier` in `roles/<id>.yaml`). We don't
get a vote — our only obligation is making that choice **visible instead of
blind**, and this section exists to be read before anyone types
`model_tier: eco` for a role doing work with a single correct answer. The right
path for professional-grade *quality* is still **the customer plugging in a
tool/MCP** (`SPEC-connectors.md`), not us patching the core.

> **Additional rule found after measuring (missing from the original spec):**
> **Prefer fewer, larger tasks over many small ones.** Every task carries ~13K
> tokens of overhead regardless of whether the work is big or small. Only split a
> task when there's **real parallelism** or a **different role is needed** — not
> to make it look tidy. This constraint runs counter to §7 of
> `SPEC-2026-08-14-agentco.md` (scheduler); the scheduler must reject a DAG with
> trivial tasks and merge them instead.

### 🔴 `max_usd`: THE CAP IS THE USER'S BRAKE, NOT OUR RULER (locked in by the user, 21/08)

> *"If a task is hard, it needs a high enough cap to actually finish its job."*

**`0` = unlimited, and that's the schema default.** `newRoleYaml` writes in a
**generous** number by tier (`eco: 1.0` · `standard: 2.0`) so the user can see it
and tighten it down themselves once they know what their own work costs.

Why this changed: the old defaults were $0.4 in the template and $0.5 in the
schema, while a measurement taken the same day, on the exact job the role's own
advertised `pitch` (*"read a CSV, compute grouped aggregates"*) promises, cost
**$0.425 · $0.448 · $0.516** on `standard`. OUR default sat **below the price of
the very job that role exists to do** — it fires on the happy path, every time.

And one number for both tiers is also wrong: for the same job, `eco` spends
$0.157–0.179 while `standard` spends $0.425–0.516 (**~2.7×**). One shared cap
would be simultaneously too loose for one tier and too tight for the other.

**The asymmetry decides which direction to lean:** blocking mid-way is a **total
loss** of whatever money was already spent with nothing to show for it; a
generous cap just means a cheap job still only gets billed for what it uses.
Leaning wide is leaning the right way.

⚠ `maxBudgetUsd` **must not be passed to the SDK when the value is 0** — passing
0 sets the cap to zero, blocking on the very first turn.

**Editable from the UI**, in the same field as the model tier (`Inspector →
Change model & limits`): switching tiers is the one moment the user is actually
thinking about price, and the same job costs several times more on `deep` than on
`eco`. Splitting these across two screens forces them to remember to come back
and fix it a second time. Before 21/08, these two numbers **didn't appear on any
screen at all** — while the error message still told users to *"raise max_usd in
roles/…yaml"*. Not a lie, but **the wrong door**: the number really is editable,
just not from where the user was standing.

When the hard cap is hit and the goods have **not** been delivered yet: the task
moves to `blocked`, shows on the UI, and asks the user whether to raise it.
**Never auto-raised.** Hitting the cap after the goods **have** been delivered
means the task is `done` — see `SPEC-offices.md` §6.

### Changing models mid-run — allowed, and cheaper than you'd guess

Details + a numbers table: `SPEC-offices.md` §4.5. Three things to remember here:

1. **An employee is a stateless function** → changing `model_tier` loses nothing.
   Just one cache write for the (new model, prefix) pair.
2. **The Assistant runs `resume`** → conversation memory is **not lost** (the
   record lives on disk, independent of the model). Measured: the turn where the
   change happens costs an extra ~1,000–1,400 tokens of cache write, i.e.
   **+60–80% of one turn, once**.
3. **A run already in progress keeps the old model.** Forced by architecture, not
   by discipline: `applyCompanyConfig` builds a new `LoadedOffice`; a Scheduler
   already running keeps the old one.

> ⚠ **A trap already stepped on: renaming a KEY in the schema also needs an
> alias, not just a changed VALUE.**
> `TIER_ALIASES` handles `model_tier: cheap` in `roles/*.yaml`. But if
> `company.yaml` writes `models.cheap: <model>`, zod silently ignores the unknown
> key, `eco` falls back to its default, and the user runs an entire session on a
> **different** model than the one they wrote down — no error, no warning, just a
> bill that doesn't match. Far more silent than the other half of the same
> lesson.

---

## 5. Measurement — mandatory from day one

Without measurement there's no optimizing, and no catching a slow death.

Every task writes one line to `logs/usage.jsonl`:

```json
{"ts":"...","task_id":"T-0007","role":"writer","role_version":3,
 "cache_key":"a1b2c3","tier":"standard",
 "in":1200,"cache_read":9800,"cache_write":0,"out":650,
 "wall_ms":8400,"status":"done"}
```

The `agentco cost` CLI prints:

```
Today's run                   42 tasks
Total tokens                  in 61K · cache_read 780K · cache_write 24K · out 38K
Cache hit ratio (prefix)      0.91   ✓ (threshold 0.70)
Tokens / task (p50 / p95)     19.8K / 44.1K
Most expensive                T-0031 researcher 44.1K
Abnormal cache write          role=coder 3 times   ← did someone bump a version mid-run?
```

### The log must also record the Assistant's turns, not just an employee's receipt

The earlier version only wrote one line per worker receipt. Consequence:
`route()` — which runs **on every user message** — had its `usage` thrown away,
while `plan()`/`report()` only got added into `cost.tick` in memory. For an
office used mostly for conversation, that's **most of the bill**, and it was
invisible to `agentco cost`.

Now every Assistant turn writes a line with `role: "assistant"` and `task_id` =
the **stage** name: `route` · `plan` · `report`. Kept separate rather than
merged, because the three stages have completely different cost shapes — `route`
runs every turn so it has to stay cheap; `plan` runs once per run, in its own
query. Merged together, no one can see which stage is actually bloating.

This is also a precondition for evaluating a model switch: **you can't weigh a
cost you can't measure.** And it's half of what `agentco cost` needs to answer
*"how much is left,"* not just *"how much has been spent"* (`USE-CASES.md` §10).

### 🔴 Tokens come from `modelUsage`, NOT from `usage` (locked in 21/08, the log was off by 14×)

This is an invariant of the **cost log**, not an SDK implementation detail — so it
belongs here, at the highest-authority level.

The `.d.ts` for `@anthropic-ai/claude-agent-sdk` states this outright
(`sdk.d.ts:4453`, verbatim):

> `usage`: **MAIN AGENT LOOP ONLY** — excludes Task subagent, sidechain, and
> auxiliary model calls, and is **per-turn in streaming-input sessions**.
> **Prefer `modelUsage` for token/cost accounting.**
>
> `total_cost_usd`: *"Cumulative … each result carries the running total so far,
> so read the latest result rather than summing across results."*

`worker.ts` runs in **streaming-input mode** (`oneMessage()`), so the *"per-turn"*
clause applies to us. The earlier version took **tokens from `usage`** (one turn)
and **the dollar amount from `total_cost_usd`** (cumulative) — two different
units in the same log line.

**Measured, run `P-260821-1827-m78h`:** the log recorded `out 59 · cache_read 0`
right next to `$0.4248`. For Sonnet, 59 output tokens is roughly $0.001 — **the
log was off by 14×**, and off in the direction that turns every `$/turn`
calculation into garbage.

Three consequences, and the third one is the painful one:

1. The token count shown in the UI is wrong on every multi-turn run.
2. `cost.tick` was accumulating numbers that weren't even the same unit.
3. **It's most wrong exactly on `budget`- and `max_turns`-limited runs** — i.e.
   the MOST EXPENSIVE runs, and the exact runs where the user needs the number
   most. On a run that finishes smoothly, the last turn happens to be a large one
   so it looks "close enough"; on a failed run, the last turn is a 59-token error
   message.

> **General lesson from this:** *a field named `usage` doesn't automatically mean
> "all usage."* Before wiring an SDK number into a log, read that field's own
> doc comment — it costs half a minute, and it blocks exactly the kind of bug
> that **never reveals itself**, because the log still prints a number that looks
> reasonable.

`total_cost_usd` **stays** as the source for DOLLARS: it covers auxiliary calls
that `modelUsage` might not fully itemize, and the SDK's own `maxBudgetUsd` is
measured against that exact number — our log has to speak the same language as
the brake pedal.

→ `worker.ts → readUsage`, tested in `test/landing.test.ts`.

### Token figures must be VISIBLE in the UI — and the model must never see them

`agentco cost` is a tool for someone who knows how to type a command. Our
primary user doesn't, so this table has to live inside the **Work log**: a
collapsible block with `read · cache write · turns · $` for each task.

The figures are **already sitting there** in every `task.done` event and in the
log file — displaying them costs **0 tokens**. Without it, exercise 1 of
`TEST-WALKTHROUGH.md` (*"look at `cache_write`: the first task is big, the next
two are small"*) is an exercise you **cannot complete**, because the word
`cache_write` doesn't appear anywhere on the screen.

> **Accounting is a job for the outside observer, not for the one doing the
> work.** The employee and the Assistant must NEVER know these numbers. Three
> reasons, and any one of them is enough on its own:
> 1. The employee **can't do anything** with that number — knowing it just wrote
>    13K of cache doesn't change how it works. Already measured: a "turn
>    discipline" prompt barely moved the needle (§4).
> 2. Telling the model means **putting the number in the prompt**, i.e. paying on
>    EVERY turn to narrate a fact that only means something to an outside
>    observer.
> 3. `CORE_PROMPT` already bans technical jargon inside `say`. Putting token
>    counts there would directly contradict that.

**The "abnormal cache write" line is the main alarm system.** A cache write
repeating multiple times for the same role within one run = something is
breaking the prefix. That's exactly the bug that happened with `claude -p`, and
it's a bug you will not spot on your own without this line.

### 5e. ACCOUNT limits — something more expensive than money, and we got it for free (22/08)

`$` is something measured after it's spent. But the thing that **actually stops**
the user cold isn't money — it's the **Claude plan's usage limit**: a 5-hour
window and a 7-day window, shared with the user's own Claude Code and claude.ai
usage. Once the limit is hit, work stops, and no amount of money buys it back
before the next reset.

#### 🔴 THE CONDITION IS **THE CLI MUST BE IDLE** — and this nearly got nailed to a wrong conclusion

The source for the two `%` figures is
`Query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`, i.e. what
sits behind Claude Code's `/usage` command. Six measurements:

| probe | called when | result |
|---|---|---|
| 1 | after the loop | `ProcessTransport is not ready` |
| 2 | on the first message | `Query closed…` after 601 ms |
| 3 | on `init`, query alive ~3s | `Query closed…` after 3,043 ms |
| 4 | on `init`, **query alive for 32 SECONDS** | `Query closed…` after **27,476 ms** |
| **5** | **CLI IDLE** (streaming-input open, no message sent yet) | ✅ **3,342 ms**, real numbers |

The first four all called it **while the CLI was busy processing a prompt**.
Probe 4 refutes the most comfortable hypothesis ("failing because our query was
too short") — it waited almost the query's entire lifetime and still died with
it. The conclusion drawn at the time — *"a control request goes unanswered while
the main loop is busy"* — was **correct**. The conclusion that came with it —
*"so we can't get the %"* — was **wrong**.

The missed question: **why does a manually-typed `/usage` work at all?** Because
when someone types it, the CLI is **idle**. And streaming-input can recreate
exactly that state: open a query with a generator that **keeps the stream open
without sending a message yet**.

```
✅ USAGE OK — 3342ms          subscription_type: pro
   five_hour : 58%  reset 2026-08-22T02:49:59Z
   seven_day : 65%  reset 2026-08-26T03:59:59Z
   session cost: 0                    ← no message, no tokens
```

**Cost: 0 tokens.** No message sent, no inference turn run. What it costs is
~3.3 seconds and a live CLI process for that moment. (`behaviors` in the response
= *"a scan of local transcripts on this machine"* — expensive in **disk and
time**, not tokens. That's also why there's a 60-second throttle.)

> **⚠ A lesson more expensive than this feature itself: "measured four times, all
> failed" proves a MECHANISM, not a CONCLUSION.** Those four measurements said
> exactly one thing — *"it doesn't work while busy"* — and *"so give up on it"* was
> an inference tacked on afterward. Before declaring a path dead, ask: **is the
> equivalent thing running successfully somewhere else, and how does it differ
> from us?** Here that thing was a manually-typed `/usage`, and the difference
> was one word: *idle*.
>
> Same family as `tools` ≠ `allowedTools`: reasoning that reads very convincingly,
> and is wrong on one condition nobody thought to check.

#### What's left of `rate_limit_event` — narrow, clear, and free

It does **not carry `utilization`** (measured 22/08: the server doesn't send
it), so it isn't a source of the number. But it's a member of the `SDKMessage`
union — already sitting in the `for await` loop of `worker.ts`/`assistant.ts`,
**0 tokens, 0 requests** — and it arrives **right at the start of every query**.
Its role: **announce a status change MID-RUN**. A user blocked at 14:03 needs to
see that at 14:03, not wait for the next refresh.

⚠ Because of that, it's **only allowed to touch `status`**. Two traps already
sealed off with tests:

| field | why the event can't touch it |
|---|---|
| `utilization` | the event doesn't carry a % → overwriting with `null` would make the bar disappear mid-run |
| `resetsAt` | **the two sources are 0.23 seconds apart**: the event returns `1787367000` (rounded seconds), `usage()` returns `…T02:49:59.770958Z`. Allowing an overwrite means every query would flip it back and forth → `bump` sees "something changed" → a **garbage `energy.tick`** fires onto SSE on every single worker call |

#### Refresh cadence: keyed on an EVENT, not a clock

Opening an office (`bindBus`, `force`) and **every time a plan finishes**
(`finish`, next to `cost.tick`) — those are the ONLY moments the real number
actually moves. A 60-second throttle, single-flight, a 20-second timeout,
swallowing every error. A periodic timer would mean spinning up a CLI process
every minute just to hear the same answer.

#### Only TWO windows: session and week (locked in by the user, 22/08)

The server returns more buckets than that — `seven_day_opus`, `seven_day_sonnet`,
and a batch of code-names that are clearly internal feature flags
(`nimbus_quill`, `iguana_necktie`, `tangelo`…). On the account measured (`pro`),
every model-specific bucket came back `null`.

They're dropped not because they're empty, but because **they aren't agentco's
business**: the limit belongs to the whole account, and the user may have spent
most of it on something with nothing to do with this company. This field answers
exactly one question — *"can I still run, and until when"*. Every other number
just invites them to go trace down something they can't fix anyway.

#### Path to the UI: RIDES ALONG, no dedicated bus

`Office.emit()` is already the single choke point every event passes through,
and it's dense during a run. `emit` compares `energyVersion()` against the
previous fire, and inserts an `energy.tick` when it changes. **No listener has to
manage anything** — `energy.ts` is module-level state (the limit belongs to the
ACCOUNT) while `Office` instances come and go with user actions, so pub/sub here
would only create lifecycle problems and a stray listener firing into a closed
SSE connection.

⚠ `energy` **is not cleared when switching offices**, unlike `cost`. Clearing it
would delete a fact that's still true.

---

## 6. Golden scenarios

5 fixed scenarios, repeatable, used as the measuring stick for every change:

| # | Scenario | What it checks |
|---|---|---|
| S1 | 1 single task, 1 role | floor cost, first cache write |
| S2 | 3 same-role tasks in parallel | does the priming gate actually work |
| S3 | 5-task DAG, 3 roles, with dependencies | scheduler + mixed parallelism |
| S4 | 10-turn conversation with the master | master's context growth, compaction |
| S5 | Re-running S3 after fixing 1 task mid-way | does replay cut the right subtree |

Mandatory workflow before merging any role/prompt/architecture change:

```
agentco bench --baseline    # measure before
<change>
agentco bench --compare     # print the delta table
```

A regression >10% on any scenario that can't be explained → do not merge.

---

## 7. Review checklist — paste into the PR template

Every change must answer for itself:

- [ ] Does this change the content of L0–L4? If so, was `knowledge_version`/
      `role.version` bumped correctly?
- [ ] Does this add anything to the master's context? If so, why can't a worker
      carry it instead?
- [ ] Is there anywhere the master reads file content instead of a path?
- [ ] Does this add an LLM call for something plain code could do?
- [ ] Is the new knowledge node ≤250 tokens?
- [ ] Has `agentco bench --compare` been run? What was the result?
