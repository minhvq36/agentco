# SPEC — AgentCo (temporary codename)

**Date:** 14/08/2026
**Status:** design, no code yet
**Product:** P2 — an "agent company" running on the Claude Agent SDK
**License:** FSL (Functional Source License) — 2 years → Apache 2.0

> `agentco` is a **temporary codename**, not yet a brand name. Every mention in this spec uses it as a placeholder for the package/binary name.

Read alongside:
- `SPEC-token-economy.md` — **the most important one**, the token economics law. Every design decision has to pass through this file.
- `SPEC-cli.md` — process model, CLI, containerization capability
- `SPEC-ui.md` — interface
- `ROADMAP.md` — order of work, business model

---

## 1. What the product is (one sentence)

A **virtual company running on the user's own machine**: Claude Code acts as the director (master), coordinating a team of specialized agents running in parallel, accumulating experience into a graph-shaped knowledge store, with the user giving instructions in plain language — through a web UI or through a chat app (Telegram).

**Not** a dev framework. **Not** a cloud service. It's **software the user runs themselves, on their own Claude subscription.**

### Three unshakeable principles

1. **Own the artifact, not the prompt.** The value lives in files inside the user's company folder — knowledge, plans, output. They live independently, surviving any change to Claude Code itself.
2. **An agent is a stateless function.** It arrives, does the work, writes the result to a file, and disappears. Memory lives in the knowledge graph, not in the context window.
3. **Every token must have a reason to exist.** See `SPEC-token-economy.md`.

### Four quality criteria — added 15/08/2026

The three principles above say **what to build.** These four criteria say **to what standard**, and they're the condition for calling a feature "done." From here on, "runs on my machine" is no longer the definition of done.

| | Concrete meaning — checkable, not a slogan |
|---|---|
| **Stable** | No path leads to a blank screen. Every empty state (no offices yet, no workers yet, no jobs yet) is a designed screen, not an accident. One office crashing must not drag another office down with it. |
| **Handles errors well** | Every error shown to the user has to answer **what happened + what to do next.** A network error/rate limit/corrupt file has a recovery path, not just a notice. One agent's error doesn't kill the whole job. |
| **Performance** | Dragging a node stays 60fps even while the company is running. A long log doesn't freeze the tab. No LLM call exists purely to serve the display. |
| **Smooth** | Switching offices, opening a panel, closing a dialog — no jank, no layout jump. Drag/wire interactions respond instantly, before the server replies. |

**Cross-cutting constraint with the token economy:** none of these criteria may ever be bought with tokens. "Smooth" never means calling an extra LLM for polish; "handles errors well" never means asking the model to interpret an error for you. `SPEC-token-economy.md` remains the higher law.

---

## 2. Organizational model

```
                      ┌──────────────┐
   Human ────────────►│    MASTER    │  long session, conversational, plans work
   (UI / Telegram)    │  (Claude)    │  does NOT do the hands-on work itself
                      └──────┬───────┘
                             │ TaskBrief (DAG)
                  ┌──────────┼──────────┬──────────┐
                  ▼          ▼          ▼          ▼
              ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐
              │Worker │  │Worker │  │Worker │  │Worker │   stateless,
              │       │  │       │  │       │  │       │   parallel
              └───┬───┘  └───┬───┘  └───┬───┘  └───┬───┘
                  │ Receipt (≤800 tokens)│          │
                  └──────────┴──────────┴──────────┘
                             │
                    ┌────────▼─────────┐
                    │  KNOWLEDGE GRAPH │  markdown + frontmatter
                    │  shared / role   │  human-readable, machine-readable
                    └──────────────────┘
```

A star topology — workers **do not talk to each other directly.** Every exchange goes through the master or through an artifact/knowledge node. The reason isn't aesthetics, it's economics: agent-to-agent chat is the single biggest token sink in every multi-agent system, and it's uncontrollable.

### What the master does

- Talks with the human
- Translates a request → a **DAG plan** of tasks
- Receives receipts, decides the next step
- Writes **shared experience** (`scope: shared`) into the graph
- Handles conflicts, escalates to the human when needed

### What the master does NOT do

- Doesn't read a worker's raw transcript (only reads the receipt)
- Doesn't read large files itself (hands that to a worker)
- Doesn't write code/content itself

---

## 3. Agent roles (Role)

A role = one definition file, versioned. The user can edit it — this is the primary "modding" surface.

```yaml
# roles/researcher.yaml
id: researcher
version: 3
display_name: "Researcher"
avatar: "🔎"

# The pitch the MASTER sees — very short, lives in the master's context
pitch: "Finds and synthesizes information from the web + project files. Output: a markdown file with sources."
good_at: [web-research, doc-summary, fact-check]
not_for: [writing code, design]

# Skills — 3 levels, user-selected, or use a preset
skill_level: medium        # short | medium | formal
skills:
  short:  "skills/researcher.short.md"    # ~200 tokens
  medium: "skills/researcher.medium.md"   # ~800 tokens
  formal: "skills/researcher.formal.md"   # ~2500 tokens

tools: [Read, Glob, Grep, WebSearch, WebFetch, Write]
mcp: []                    # the user wires in more as needed

model_tier: standard       # eco | standard | deep  → see switch center
budget:
  max_tokens: 60000
  max_turns: 15
  knowledge_pack: 3000     # knowledge token cap loaded in

hot_knowledge_size: 8      # number of "hot" nodes fed into the prefix cache
```

**`pitch` is the only thing the master sees** when dividing work. The full `skills` set only loads into the worker itself when it runs. This is why the master's planning stays cheap.

### Skills split into two layers — CORE is not editable

The user can edit skills and experience for every agent, including the master. But **not everything should be editable**:

| Layer | Content | Editable? | Lives where |
|---|---|---|---|
| **Core** | the Receipt protocol, budget discipline, the "delegate, don't do it yourself" rule, output schema | ❌ | ships with the software, versioned by `software_version` |
| **User** | personality, tone, industry knowledge, work habits, which roles to favor | ✅ | `skills/*.md` in the company folder |

The boundary is decided by exactly one sentence:

> **Whatever enforces an invariant from `SPEC-token-economy.md` is CORE.**

Letting the user edit the core layer isn't granting freedom — it's handing them a trap. Strip out the Receipt protocol and the cost architecture collapses, and then they'll blame the product, not their own edit.

In the prompt: core comes first, the user layer comes after, **both before `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`.** Meaning the user layer still gets cached — but **every save bumps the cache key**, paying for one cache write before it stabilizes again.

→ **UI requirement:** the skills editing box **must not autosave on every keystroke.** There has to be an explicit Save button. (`SPEC-ui.md` §2.2)

### The default role set (shipped)

| Role | Job | Tier |
|---|---|---|
| `researcher` | find & synthesize information | standard |
| `writer` | write content | standard |
| `coder` | write/fix code | standard |
| `reviewer` | review, quality check | standard |
| `librarian` | merge/tidy the knowledge graph | **eco** |
| `analyst` | read data, summarize | standard |
| `concierge` | **small MCP-backed errands** — check a calendar, send a message, query a DB, fetch a URL | **eco** |

### `concierge` — is a TOOL, not a worker

**The master doesn't know `concierge` exists.** The master only sees one tool:

```
quick_action(what: string) → { say: string, result: string }
```

The runtime receives that call and fires off a one-shot query behind the scenes. This is a correct abstraction, not a trick:

- A user editing the master's skills **cannot** break it — the master's prompt never mentions `concierge` at all
- The UI hides it naturally, no special-case code needed: it's a tool, not a task, by nature
- Doesn't show up in the worker list, because it isn't a worker
- Once [#247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247) is fixed: swap the implementation behind that exact tool name, nothing else changes

> **Note:** the Agent SDK **bundles no MCP server at all.** What's always available with no key required is the **native tools** (`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `WebSearch`, `WebFetch`) — they aren't MCP. Since `WebSearch`/`WebFetch`/`Bash` cover most errands already, **`concierge` usually runs without any MCP at all.** MCP only comes into play when the user wires one in themselves (Notion, Calendar, their own DB).

### Why MCP isn't wired straight into the master

The master is a long session, resuming continuously. Attaching MCP directly to the master → [issue #247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247) → breaks the master's cache, costing **~36,000 token-equivalents on every conversational turn.** A one-shot `concierge` with MCP costs only **~4,350** on Haiku — nearly an order of magnitude cheaper.

**Important — this is a UI decision, not an architectural one:** in the interface, `concierge` **never appears as a task**, has no step in the plan, no agent card. It shows up as **the master itself working.** The user still sees "the boss handled the small stuff themselves," exactly as expected; only the layer beneath is different.

`master.mcp: false` is a **setting** in `company.yaml`, not hard-coded — when Anthropic fixes #89/#247, flip it on and the master holds MCP directly.

Users add roles by dropping a yaml file into `roles/`. No restart needed (hot reload includes a version check).

---

## 4. The Task ↔ Receipt protocol

This is the **core contract.** It's both a token optimization and a UX feature ("simple by default, advanced logs when you need them") — one mechanism serving both.

### TaskBrief (master → worker) — target ≤1500 tokens

```json
{
  "task_id": "T-0007",
  "role": "writer",
  "goal": "Write a fan-page caption introducing product X",
  "inputs":  [{"kind":"file","path":"artifacts/T-0003/research.md"}],
  "outputs": [{"kind":"file","path":"artifacts/T-0007/caption.md"}],
  "constraints": ["≤200 words", "friendly tone", "has a CTA"],
  "knowledge_refs": ["k/shared/brand-voice"],
  "budget": {"max_tokens": 40000, "max_turns": 12, "tier": "standard"},
  "deps": ["T-0003"]
}
```

The master **does not** paste file content into the brief — only the **path.** The worker reads it itself. If the master pastes content, that content sits in the master's context forever → this is failure mode #1 for token burn in multi-agent systems.

### Receipt (worker → master) — **hard cap of 800 tokens**

```json
{
  "task_id": "T-0007",
  "status": "done",
  "say": "Caption done, 180 words, on-brand voice, CTA at the end.",
  "artifacts": ["artifacts/T-0007/caption.md"],
  "lessons": [
    {"kind":"pitfall","text":"An opening hook over 12 words tanks reach; keep it ≤12."}
  ],
  "blocked_on": null,
  "usage": {"in":1200,"cache_read":9800,"out":650,"tier":"standard"}
}
```

- `status`: `done | failed | blocked | needs_human`
- `say`: a **plain-language sentence**, shown directly in the UI. Costs no extra call to "translate it into something friendly" — the worker generates it as-is.
- The runtime **validates the schema and hard-truncates.** Worker returns prose instead → rejected, asked once more with the schema attached, wrong a second time → marked `failed`.

**Invariant:** not one byte of a worker's raw transcript ever enters the master's context. A test guarantees this.

---

## 5. The knowledge graph

### ⚠ A knowledge node ≠ a document the user uploaded

A question people commonly get wrong: *"so does the whole library get loaded into the input?"* — no, and the boundary needs to be stated clearly.

| | Knowledge node | Uploaded document |
|---|---|---|
| Size | capped at **250 tokens/node**, warns if exceeded | unlimited, can be MBs |
| Enters the prompt | **HOT** into the prefix (cap `hot_knowledge_tokens: 2000`) · **COLD** selected per task | **never** |
| How it's reached | code picks it, 0 tokens | the agent `Glob`s/`Grep`s/`Read`s it as needed |
| Who produces it | the agent distills it after working, or the user confirms it | the client puts it in |

In other words: **the knowledge store is short, already-distilled sentences, not a place to hold files.** A client's files live in `artifacts/` and are reached with a foreign key + `Grep` — see appendix `SPEC-connectors.md`. The 250 token/node cap exists precisely so this boundary doesn't blur over time.

Why HOT exists at all, instead of "just look it up when needed": something sitting in the cached prefix costs **~0.1×** after the first write; something fetched per task costs **full price every time**, and stuffing it into the prefix means the prefix changes every task → 100% cache miss, worse than no cache at all. Two tiers exist to get both.

### 🔴 5·0. `KnowledgeNode` has NO language field — a decision from 03/09, and it's a decision NOT to do something

During multilingual work, a proposal came up to attach `lang?: 'vi'|'en'` to a node, inferred from a Vietnamese-diacritic detector.
**Rejected.** Not because "not needed yet" but because it's "the wrong kind of thing":

1. **That detector is binary.** A note in German, Spanish, or Arabic carries no Vietnamese diacritics either ⇒ it would
   silently mark it `en`. That's a **signal wearing a deterministic gate's clothes**, and it writes a guess **to
   disk, into user data** — where no later read can tell that value was a guess.
2. **Nobody consumes it.** `hot()` already decided it does **not** filter by language: filtering trades a
   *visible* nuisance (a prefix mixing two languages) for a *silent* one (the office quietly forgetting
   what it learned, with no one told). This repository picks the visible failure, every time.

`hasVietnameseDiacritics` lives only in `scripts/check-language.ts`, and it's **100% exact only there** because
it's pointed at **our own source code** — which has exactly two possible states. Pointing that same function at
user text turns it into a guess.

**Conditions to reopen — measurable, and the mechanism is only built when one of these two happens:**

1. a real office genuinely accumulates notes in **≥2 languages**, **plus** a wrong output traceable
   to the mix (not just "looks off");
2. a real user asks for filtering.

And even then the right mechanism is **not** a detector: it's the **model declaring** the language it just wrote,
as a free-form BCP-47 tag (`vi` · `en` · `zh-Hans` · `ar` · `de`…), written **only for nodes created from that
point forward.** Old nodes stay **blank, and blank means UNKNOWN** — never inferred.

`test/knowledge-untouched.test.ts` locks all three parts down: no language field on a node, `hot()` takes no
language parameter, and no diacritic detector anywhere in `knowledge/`. It goes red the day someone adds one "for
convenience," and forces them to read this section before going any further.

### 5a. FOUR LAWS OF LESSON GENERATION — locked 19/08/2026

A premise raised by the user, and it's a correct diagnosis of a whole failure class, not a single bug:

> *"The lesson-writing mechanism is building its own CACHE, and there's a good chance this cache goes STALE the moment the user edits a document."*

Correct. The table in §5 above declared *"a knowledge node ≠ a document"* back on 14/08, but what actually breaks that boundary isn't size — it's **content type.** A node that copies a document's *content* is a second copy of the same fact, and **the copy wins**: it's already sitting in every worker's prefix, while the document has to be searched for.

| # | law | which case it covers | enforced where |
|---|---|---|---|
| 1 | only write **HOW TO DO IT**, never **FACTS** | the document gets **EDITED** | `LessonSchema` (dropped `'fact'`) · `quotesLibraryNumber` · `echoesLibrary` |
| 2 | **weak entity** — file gone means node gone | the document gets **DELETED / renamed** | `KnowledgeNode.depends_on` · `dropDependents` |
| 3 | only generate on **trouble or a REPEAT** | a case invented out of nowhere | `worthLearning` |
| 4 | no spamming **near-duplicates** | the store bloats from repetition | `findTwin` · `twinScore` |
| **5** | **only record what ONE AGENT CAN FIX** | infrastructure / config / user error | `agentFault` · `Receipt.failure` |

#### 🔴 Law 5 — THE QUESTION *"WHOSE FAULT"* MUST BE ANSWERED BEFORE *"WHAT WAS LEARNED"* (user locked this in 21/08)

A real case: two nearly identical nodes, both `scope: shared`, nine minutes apart.

```
"phan-tich-standard keeps hitting the cost cap … consider raising max_usd"
"Grouping+summarizing a CSV can hit the cap … consider raising max_usd"
```

Three things broke at once, and the second is the expensive one:

1. **WRONG READER.** The lesson lives in the prefix of **every worker.** A worker can't change `max_usd` — it has no hands to do that. That advice is addressed to a **human**, and a human doesn't read the knowledge store; they read the chat, where that exact sentence **has already been said.** We pay forever to repeat a sentence that already reached the right door.
2. **SELF-INFLICTED.** A node in the prefix → a longer prefix → every turn more expensive → **cap gets hit more easily.** A lesson warning about hitting the cap, whose very mechanism of existing raises the cost. It produces exactly the problem it warns about.
3. **WILL BECOME WRONG.** The day the user raises the cap, the node still says *"tends to hit the cap"* — and the node **wins**, because it's already sitting in every worker's head. The exact failure class law 1 exists to block, only this time the knowledge being copied is **the system's own configuration**, not a document's content.

**Why NOT filter this via the prompt.** The prompt **already** forbids it, in two separate lines (*"Don't record numbers, thresholds, prices, or dates"* and *"Lessons record HOW TO WORK"*), and the model still wrote out two nodes about a cost threshold anyway. A rule that lives only in the prompt is a **PROMISE.**

> ⚠ **And this is exactly where the LLM is weakest, so don't ask it.** The model can't tell *"I got it wrong"* apart from *"my environment blocked me"* — from inside its own context, both look identical: **one turn didn't finish.** It has no vantage point to see that boundary. We do, and we know it **from data.**

`FailureKind` partitions cleanly by *who can fix it*:

| kind | caused by | can the agent do anything |
|---|---|---|
| `budget` · `max_turns` | a cap the USER set | no — it can't change config |
| `rate_limit` · `usage_limit` | infrastructure / subscription tier | no |
| `auth` | machine configuration | no |
| `stopped` | the user pressed Stop | no, and this isn't trouble at all |
| `other` | could be its own fault | yes |

⚠ **The half most easily lost:** `blocked_on` **self-reported by a worker** (*"missing the glossary file"*) is the most valuable lesson in the whole store; `blocked_on` **written by the system** (*"hit the $0.4 cap"*) is noise. Both live in the same field, and `Receipt.failure` is the **only** thing that tells them apart. The first patch dropped `blocked_on` from the signal entirely and lost a real case — the test suite caught it immediately.

⚠ So `stoppedReceipt` **must** declare `failure: 'stopped'`. Without that line, `agentFault` reads `blocked_on: "user stopped mid-run"` as if the worker itself confessed it, then goes asking the model *"what did you learn"* for a job the user had just told it to abandon.

#### Law 4 — the threshold was MEASURED, and the old premise was just a promise

`TWIN_RATIO` moved from **0.75 → 0.6.** The genuine duplicate pair above measured **0.654** — under the old threshold, so both nodes survived. The gap sat almost entirely in filler words (*constantly* ↔ *may*, *should* ↔ *consider*, *this kind* ↔ *similar*): the same sentence, two voices.

The old comment justified 0.75 with *"if we miss a duplicate, it's just one wasted node the Librarian (M1) can merge later."* **The Librarian doesn't exist.** So the real cost of a miss isn't "one node waiting to be merged" — it's **tokens in every worker's prefix, every turn, forever** — the two sides aren't symmetric the way the assumption pretended:

```
false block → one real lesson is lost, the old node's hits +1, still leaves a trace
missed dup  → pays tokens forever for a copy nobody ever cleans up
```

> **Right decision + wrong premise = a time bomb.** It just went off.

`twinScore` was **pulled out of `findTwin`** so the threshold can be tested without standing up a `KnowledgeStore` on disk — paying off half the debt from 0b, in line with the rule *"when an important rule lives inside an untestable function, the real debt IS the shape of the code."*

#### ⚠ Laws 1 and 2 do NOT replace each other — this is the easiest place to misread

The instinct says *"link the node to the file and you're done."* You're not:

```
doi-tra.md  gets DELETED  → depends_on fires   → node disappears     ✅ law 2
doi-tra.md  gets EDITED   → file STILL EXISTS  → depends_on is SILENT ⛔
                                                → the old node lives on, still wrong
```

And the **edited** case is exactly the one the user was worried about (*"update a document"*), and also the **more frequent** one — people edit a policy far more often than they delete it.

What covers that case is **law 1**: a sentence about *how to do it* stays true regardless of how the file's content changes.

```
✅ "the return policy lives at library/files/doi-tra.md — grep it before answering"
⛔ "items over 50% off can't be returned"
```

→ **Which means law 1 has to be enforced by CODE, not by a line of prompt advice.** If it's only advice, law 2 has to carry a weight it was never built for.

#### Law 1 — three layers, hard rules first, soft ones after

1. **Drop `'fact'` from `LessonSchema.kind`.** That was exactly the slot people used to copy in facts. As long as the slot exists, the model will use it — removing the slot is cheaper and more reliable than any amount of instruction. (`NodeType` keeps `'fact'`: the Assistant's MEMORY nodes use it, and something the **user** explicitly confirms genuinely is a fact.)
2. **`quotesLibraryNumber` — the number-blocking gate.** A lesson containing a number with ≥2 digits, where that number **also appears in the source document**, gets rejected.
3. **`echoesLibrary`** — the pre-existing overlapping-words net, now the third net rather than the main one.

> **Why layer 2 exists, and exactly which hole it patches.** On 19/08, node `k/shared/product-60-off-…` wrote *"a 60% discount **usually** can't be returned"* while the document actually said *"OVER 50% is NOT eligible."* Word overlap **measured 0.47** — under the 0.6 threshold, **slipped through the net.**

> The underlying pattern: **the further a paraphrase drifts from the original, the weaker the word-overlap net gets — but a wrong paraphrase is exactly the dangerous kind**, because it's both wrong and untraceable back to its source. Numbers are the opposite: they **survive any paraphrase.** And a sentence about *how to do something* almost never needs a threshold, a price, or a date anyway.

> Only blocks when the number **already appears in the document**: the lesson *"ask at most 2 clarifying questions, then get to work"* contains the number 2, but that's a number about **process**, and it has to pass through. Single-digit numbers are ignored because they collide with normal text too easily.

#### Law 2 — `depends_on` comes from OBSERVATION, not from what's claimed

The source is `receipt.reads`: files in `library/` that the worker **actually `Read`** during the case, extracted from the `tool_use` stream. Same rule as `landed` (§6 SPEC-offices): *if it's observable, don't ask the model.*

Deleted on an **ANY** basis (any one missing file kills the node), not ALL — deliberately conservative: **a half-right piece of advice is more dangerous than no advice at all**, since nobody knows which half broke.

Cascade runs in **`Office.removeDocument`**, right when the user clicks delete — **not** in a periodic scan job. A scan job means there's a window of time where an orphaned node still sits in every worker's prefix and still gets followed, and nobody can verify how long that window is.

#### Law 3 — `looped`, and why it's NOT a turn count

The user said *"only generate a lesson when the flow LOOPS."* Right intent, but the right thing has to be measured — details in `SPEC-offices.md` §6 and `types.ts`. Summary:

| | model-independent? | |
|---|---|---|
| `turns >= N` | ❌ | haiku takes 10 turns vs. sonnet 4 turns for the **same job.** The 19/08 case ran exactly **9 turns** → `turns >= 8` would have let through the exact case it was built to catch |
| **repeated actions** | ✅ | re-reading a file already read · re-reading a file just written · calling the same tool with identical arguments twice. All three are **violations of a rule already spelled out in `CORE_PROMPT`** |

#### Law 4 — a duplicate means ADD A VOTE, don't throw it away

Jaccard over the word set, **same scope**, threshold `TWIN_RATIO = 0.75`. A duplicate calls `recordHits` on the surviving node instead of writing a new one.

A duplicate is **evidence** that the lesson is real, not garbage — and `hits` is exactly the ranking signal for HOT. So turn it into a vote that both blocks spam and **pushes the correct node up**, while (through `last_used`) making it **younger again**, so the expiry window doesn't sweep away a lesson that's still correct.

Only compares **within the same scope**: a lesson from `nguoi-viet` and one from the shared store saying similar things are **not** a duplicate — they enter the prefix of two different audiences.

> ⚠ `0.75` **was never measured** against a real store; it was a conservative starting point. Erring toward **missing duplicates** is erring the right direction: a false block loses a real lesson outright, while a missed duplicate can be merged later by the Librarian (M1).

#### The consequence has to be said plainly: this store now writes almost NOTHING

Stack all four laws and the number of agent-distilled lessons converges toward **almost zero.** That is the **intended outcome**, not a side effect — but it needs to be written down so nobody thinks the mechanism is broken later.

The healthy path was never this one anyway: talk to the Assistant, then `/clear` → a **MEMORY** node, `confidence 0.9`, confirmed by the **user themselves.** Compared to the `0.6` confidence of an agent's own distilled lesson, the confidence scale already says which one deserves more trust.

### Selection mechanism: HOT ranks, COLD keyword-matches

Both are **deterministic, run in code, 0 tokens.** No model call anywhere to "decide what to remember."

| | HOT | COLD |
|---|---|---|
| Input | just `roleId` | `roleId` **+ the task's content** (`goal` + `constraints`) |
| Selection | rank by `hits` → `confidence` → `id` (deterministic tiebreak), take the top `hot_knowledge_size` | score by **keyword overlap** between task words and node words; `tags` count double; normalized by √(node length) so a long node doesn't automatically win; multiplied by `(0.5 + confidence)`; plus `0.1·log(1+hits)` |
| Lives where | **inside** the prefix cache | **after** the cache breakpoint |
| Changes per task? | **NO** — changing it would break the cache | yes |
| Cap | `hot_knowledge_tokens` 2000 | `cold_knowledge_tokens` 3000 |

**A task doesn't "know" which node has the information it needs** — it doesn't choose anything. `cold()` scores every node *it can see* based on the task's own wording, then ranks them. Not a disk grep: it's an in-memory pass over a prebuilt `index.json`.

> ⚠ **A limitation worth stating plainly: this is a WORD match, not a MEANING match.** A task says *"Facebook post"*, a node says *"social media content"* → overlap of **zero** → the node never gets picked. This is exactly the one place embeddings would help, and the only one. Not built yet because it hasn't been measured as necessary.

#### COLD climbing into HOT — real, and it's a self-correcting loop

`recordHits` adds points, `hot()` ranks by `hits`. A node COLD keeps picking will climb into HOT. Not risky, because the signal is **"this has already matched a REAL task,"** not a guess.

> ⚠ **Bug fixed — a closed loop that couldn't self-correct.**
> The earlier version: `recordHits([...hot.ids, ...cold.ids])`. A HOT node got +1 on **every** task simply for already being in HOT; `hot()` then ranked using that same `hits`; and `cold()` **excluded** HOT nodes from competing at all (`excludeIds: hot.ids`).
> ⇒ Getting into HOT once meant staying there **forever.** Real numbers: three HOT nodes had `hits` of 6/3/2, and **every** other node sat at zero.
> Worse: `hits` had lost its meaning entirely — it measured *"how long have you been in HOT"*, not *"are you actually useful."* And so `pruneStale`'s `hits === 0` condition became meaningless too.
> **Fix: only count `cold.ids`.** Now `hits` carries exactly one meaning: *how many times the keyword selector saw this node match a real task.* The loop self-corrects: COLD climbs → squeezes into HOT → the weakest HOT node falls out → gets to compete in COLD again.

### Fighting bloat: `supersedes` — squashed at WRITE time, not at READ time

> **This is the decision that determines why this store doesn't need a vector DB.**
>
> RAG pushes the problem to **read time**: the store grows forever, then top-k retrieval happens over a pile of chaos — which *forces* it to need embeddings. Compressing **at write time** keeps the store permanently small, and reading is allowed to stay dumb: chosen by code, deterministic, **0 tokens.** That's exactly what `hot()` does, and why it's cheap.

`hits` and `updated` only make an unused node **fall in ranking.** They can't answer the most important question: *"has this decision already been overturned?"* — a **wrong** node that still gets read often will stay at the top forever.

`supersedes: [id…]` is the missing piece. Four properties, all deliberate:

| | |
|---|---|
| A superseded node is **not deleted** | the file stays intact, still readable to see why the old thinking existed. It only drops out of what gets loaded into the prompt — same spirit as Archive |
| The relationship belongs to the **NEW** node | delete the new node and the relationship disappears with it, and the old node comes back to life — no cleanup step needed |
| Filtered at **`visible()`** | one single gate, excluded from both HOT and COLD at once |
| **One field, not a graph** | the only relationship this store actually needs is "supersedes." Building a graph engine for one relationship is buying complexity before there's a problem for it |

Four anti-bloat mechanisms, in the order they should be reached for: **`supersedes`** (correcting) → **`pruneStale`** (cleanup) → **`pinned`** (never demoted) → **Librarian** periodic merge (`librarian.every_n_tasks`).

#### TWO metrics, two jobs — deliberately kept separate

| | Used for | Nature |
|---|---|---|
| `hits` | **ranking** into HOT | cumulative, only ever increases, rewards long-term usefulness |
| `last_used` + a `prune_after_days` (15) window | **expiry**, even when `hits > 0` | **stateless**, computed at read time |

A node with 50 hits from last year, untouched for 15 days → **dead.** A node with 3 hits, touched yesterday → alive, modestly ranked.

**Why a window, not decay:** decay needs a **running schedule** — decay when? every task? every day? what if the daemon is off for two weeks? That schedule would drift. A window only needs to know *when was it last used*, compared against today **at read time** — works correctly no matter how long the daemon was off, no background job needed.

> Same law as `supersedes`, just inverted: **squashing is decided at WRITE time, decay is computed at READ time.** Small data gets computed at read time; large data gets compressed at write time.

An old node with no `last_used` yet falls back to `updated` → gets grace for the full window. No alias table needed.

> ⚠ **`matched` ≠ `ids` — a trap that was hit and measured.**
> `cold()` excludes HOT nodes from the **rendered** set (they're already in the prefix). If `last_used` gets written based on the rendered list, then **a node inside HOT can never get `last_used` written at all.**
> Real consequence: a 5-node store with `hot_knowledge_size: 8` → HOT takes everything → COLD renders nothing → no node ever gets a `last_used` → **15 days later the entire store dies**, including nodes being fed into every single call.
> Fix: `cold()` scores **everything** it can see, returns `matched` (relevant to the task) separately from `ids` (actually rendered). `recordHits(cold.matched)`.
> Re-measured: `HOT takes 2 → COLD renders 0 → matched 2 → both get last_used written.` And a HOT node that has **never** matched anything still correctly dies on schedule — it's been sitting in every single call's prefix contributing nothing.

#### `pruneStale` — and the limits of `hits`, stated plainly

Every memory compaction (`/clear` or automatic), delete a node meeting **ALL** of: older than `librarian.prune_after_days` (default 12) **AND** `hits === 0` **AND** not `pinned` **AND** not a MEMORY node.

> ⚠ **`hits` is only trustworthy once the store is BIGGER than `hot_knowledge_size`.** Below that threshold, `hot()` takes *every* node each time, so `hits` accumulates almost evenly — it isn't ranking anything, and filtering by it is filtering by noise.
>
> That's exactly why the condition is **AND**, not **OR**: it has to be both **old** and **never used.** In a small store, `hits === 0` almost never happens for a node that's still alive, so this rule **stays silent automatically** — which is correct behavior, not a defect.

`supersedes` only handles the case *"a decision got reversed."* Most junk isn't reversed — it just **stops being relevant**, and nobody ever declares that out loud. The two mechanisms complement each other, they don't substitute for each other.

**A superseded node is deleted immediately, no age requirement.** It's already been replaced by a node CONTAINING the merged content; keeping it "for reference" is just keeping trash, and the user opens the drawer to see three nearly identical entries and has to guess which one is current. Safe, because `superseded` is only set when the superseding node **still exists** — it gets rebuilt on every `scan()` from the surviving node's own `supersedes` field.

⚠ Cleanup has to run **on the early-exit path too** (no conversation yet to compact). The old version `return`ed immediately, so hitting `/clear` a second time did nothing — exactly the moment the user is trying to clean up, the cleanup command does nothing at all.

### Editing/deleting notes from the UI — 1-1 effect, immediate

`PATCH /api/office/:id/knowledge { id, body? , remove? }`. After editing: rescan the store, rebuild the Assistant's context, and **every worker spawned AFTER that uses the new version.** A running worker keeps the old version — same rule as changing the model.

This drawer used to be **read-only**, so fixing one wrong sentence in a worker's head meant opening that person's exact yaml file by hand. A non-coder couldn't do that, and it's also what made the knowledge store feel like a black box.

A superseded node still **shows in the drawer, labeled "superseded by a newer version."** Hiding it means opening the folder shows a file the UI never mentions; showing it without a label makes it look like the system is duplicating garbage.



### Folder structure (inside the user's company folder)

```
company/
├─ company.yaml            # charter: what this company does, tone, constraints
├─ roles/                  # role definitions
├─ skills/                 # 3-level skill descriptions
├─ knowledge/
│  ├─ index.json           # runtime-generated — a 0-token lookup index
│  ├─ shared/              # ← written by the MASTER. Read by the whole company.
│  │  ├─ brand-voice.md
│  │  └─ audience-profile.md
│  └─ agents/
│     ├─ writer/           # ← written by writer itself. Read only by writer.
│     │  └─ hook-patterns.md
│     └─ coder/
├─ artifacts/              # per-task output
│  └─ T-0007/
├─ tasks/                  # saved brief + receipt → replayable
└─ logs/                   # advanced logs
```

### A knowledge node

```markdown
---
id: k/shared/brand-voice
type: policy          # policy | pitfall | playbook | fact | reference
title: Brand voice
tags: [content, writing, brand]
links: [k/shared/audience-profile, k/agents/writer/hook-patterns]
scope: shared         # shared | role:writer
author: master        # master | role:writer
confidence: 0.9
hits: 42
pinned: false
tokens: 180           # runtime-measured — used by the scheduler for budgeting
updated: 2026-08-14
source: T-0003
---

Refer to yourself as "we", address the customer as "you". No flowery
language. At most one emoji per post. Never promise a guaranteed result.
```

**Hard rule: one node ≤ 250 tokens.** Longer → must be split. This is what makes the knowledge budget something calculable rather than guessed, and why the prefix cache doesn't bloat.

**`[[id]]` wikilinks in the body** — proper wiki-style, natural for humans to read, parseable for machines. The graph = `links` frontmatter + wikilinks in the body.

### Two write streams — exactly as intended

| | Who writes | Who reads | When |
|---|---|---|---|
| **shared** | master | everyone | the master distills a company-level lesson (policy, an insight about a client, coordination habits) |
| **agents/`<role>`** | that role itself | only that role | a worker got something wrong / found the right flow → writes to the receipt's `lessons[]` |

### Why lessons go through the Librarian, not written straight

If every receipt wrote a node directly, after 200 tasks you'd have 200 duplicate nodes, the graph bloats, retrieval degrades, the prefix cache grows → **cost rises with usage.** That's death by a thousand cuts.

So: `lessons[]` go into a **queue** (`knowledge/_inbox/`). Every K tasks (default 20) or whenever idle, the **Librarian** runs one pass on the cheapest model tier:
- merges duplicates, raises `confidence` on repeats
- splits any node over 250 tokens
- lowers `confidence` on nodes long unused, archives below 0.3
- updates `links` and `index.json`

This is a cheap batch job, off the user's critical path.

### Retrieval — **0 tokens**

No embeddings in v1 (extra API, extra cost, extra complexity). Uses `index.json` + a deterministic algorithm:

1. Candidate set = `scope: shared` + `scope: role:<current role>`
2. Score = keyword overlap (title/tags/keywords) + 0.3 × link proximity to a node used by the parent task + 0.1 × log(hits)
3. Always includes any `pinned: true` node (the company charter, ≤500 tokens)
4. Greedy fill until hitting the `budget.knowledge_pack` cap

Local (non-API) embeddings are a v2 option if keyword matching is measured to be insufficient.

---

## 6. Switch center — model routing

A pure-code table, 0 tokens, no LLM involved.

| Tier | Used for | Model |
|---|---|---|
| `eco` | classification, extraction, formatting, dedup, short summaries, librarian | Haiku |
| `standard` | writing, code, research, analysis, review | Sonnet |
| `deep` | complex planning, conflict arbitration, postmortems | Opus |

**Master defaults to `standard`**, only jumping to `deep` for exactly two step types: `plan` (the initial plan) and `arbitrate` (when two receipts conflict).

**Escalation rule:** a task `failed` due to quality → retried **once** at a higher tier. Max 1 escalation per task. Beyond that, `needs_human`.

Overridable by the user in `roles/*.yaml` and `company.yaml`.

### ProviderAdapter (future plug point, not implemented in v1)

```ts
interface ProviderAdapter {
  id: string                    // "claude-agent-sdk" | "openrouter" | ...
  run(brief: TaskBrief, ctx: RunContext): AsyncIterable<AgentEvent>
  supportsPrefixCache: boolean  // false → scheduler turns off cache priming
}
```

v1 only has `claude-agent-sdk`. No OpenRouter implementation, just the interface reserved.

---

## 7. Scheduler — running in parallel

The master emits a DAG. The scheduler runs it.

```
plan = [
  T-01 researcher  deps:[]
  T-02 researcher  deps:[]          ← T-01, T-02 run in parallel
  T-03 writer      deps:[T-01,T-02]
  T-04 coder       deps:[]          ← also parallel with T-01/T-02
  T-05 reviewer    deps:[T-03,T-04]
]
```

Rules:

- **Concurrency cap** defaults to 4, configurable. Separate cap per tier.
- **Cache priming gate** — see `SPEC-token-economy.md` §3. The first task of each `(role, version)` runs alone to write the cache; the rest wait, then run in parallel. Without this gate, N parallel tasks = N cache-write payments.
- **Write lock per artifact path.** Two tasks may not write the same file. The scheduler rejects a violating DAG right at planning time, not at runtime.
- **Rate limit → AIMD.** On 429: exponential backoff + halve concurrency; after 10 clean tasks, increase by 1.
- **Replay.** Every brief+receipt is saved under `tasks/`. Editing one task in the middle → only its downstream branch reruns, not the whole DAG. This is the single biggest money-saving tool for a user who iterates repeatedly.

---

## 8. Session lifecycle

| | Session | Compaction |
|---|---|---|
| **Master** | long, one session per "work session" | at >60K tokens: freeze the prefix as-is, roll old receipts into a summary, write the trimmed-out part to a `logs/` file |
| **Worker** | short, dies after each task | none |

The master's compaction **must absolutely never touch the prefix** (system + tools + charter + role pitches). Touching it invalidates the entire cache behind it — exactly the intuition of "clear the fresh cache, keep the deep-frozen one" reversed.

Exit/restart: the master's session id is stored in `company/.state`. On restart, resume works, or start a new session — the user's choice.

---

## 9. Chat bridge (the ultimate goal)

```
Telegram ──long polling──► agentco daemon (home machine / VPS) ──► Master
```

**Telegram uses `getUpdates` long-polling → no public IP needed, no port forwarding, no domain, no VPS.** Runs straight from a home machine. This is the v1 version.

| Channel | Requires | Phase |
|---|---|---|
| Telegram | just a bot token | **v1** |
| Web UI | localhost | **v1** |
| Zalo OA / Messenger / WhatsApp | webhook + public HTTPS + app review | v2, paid tier |
| Any channel via a tunnel | Cloudflare Tunnel (free) | v2 |

The bridge is a thin adapter:

```ts
interface ChatBridge {
  id: string
  start(onMessage: (m: InboundMsg) => void): Promise<void>
  send(chatId: string, text: string, opts?): Promise<void>
}
```

Bridge security rule: `chat_id` whitelisting is mandatory. Without a whitelist, the bot stays silent. A stranger messaging the bot = potential ability to run commands on your machine — must be blocked by default.

---

## 9b. Running out of subscription usage — a scenario that WILL happen

The first draft of this spec missed this one. Clients run on a Claude Code subscription, so **they will run out of usage mid-run** — it's not "if," it's "when." For a non-coder, this is the moment the product is most likely to lose trust: a company that was running suddenly goes silent for no visible reason.

**Two kinds of error need distinguishing, and handled oppositely:**

| | Rate limit (429) | Subscription usage exhausted |
|---|---|---|
| Nature | temporary, measured in seconds | until the next reset, measured in **hours** |
| Handling | exponential backoff + AIMD reducing concurrency | **stop the work session**, no retry |
| Tell the user | not necessary | **mandatory**, with the reset time if known |

The SDK provides `USAGE_LIMIT_ERROR_PREFIXES` and `USAGE_WARNING_PREFIXES` for detection — use them, don't guess with a regex.

**Required behavior when usage runs out:**

1. Running task: let it finish, don't kill it.
2. Not-yet-started task: **keep it in the DAG**, don't mark it `failed`.
3. Write the entire DAG state to `tasks/` → **`agentco resume` can continue**, no starting over.
4. UI + Telegram announce it in plain language: *"Out of Claude usage. The company is taking a break, 3 jobs left undone. Type `continue` once usage is back."*
5. **No automatic retry loop.** Blindly retrying while out of usage just makes the user think the software is broken.

Catch `USAGE_WARNING_PREFIXES` to warn **before** running out: *"Running low — 2 more jobs and you'll hit the limit."* For a non-coder, an early warning is worth more than a beautifully handled error.

---

## 10. Testing — answering the worry "TDD has a blind spot both sides share"

You're right: unit tests for this system don't catch the most dangerous failure class. The danger here **isn't logic bugs — it's cost leaks**, and tests usually don't look there.

So the most important test category is **invariant / budget tests**, run against a fixed sample task set:

```
✓ receipt_tokens ≤ 800                        (every receipt, no exceptions)
✓ knowledge_pack_tokens ≤ role.budget         (every task)
✓ knowledge node tokens ≤ 250                 (every node)
✓ cache_read / (cache_read+in) ≥ 0.7          (after each role's 2nd task)
✓ master_context_tokens < 60_000              (before compaction)
✓ no worker transcript ever appears in the master's messages
✓ cost_per_scenario ≤ a locked threshold      (a set of 5 sample scenarios)
✓ a DAG with a write conflict → rejected at planning time, not at runtime
```

This is a real safety net for someone who can't do systems analysis: **you don't need to understand why cost went up, you just need the test to go red when it does.** Lock the thresholds with real numbers from the first run, and every regression after that gets caught.

Additionally: any role/prompt change must rerun the 5 sample scenarios and print a before/after cost comparison table.

---

## 11. Source structure

```
agentco/
├─ packages/
│  ├─ core/           # scheduler, task/receipt, budget, session
│  ├─ knowledge/      # graph, index, retrieval, librarian
│  ├─ providers/      # claude-agent-sdk adapter (+ interface)
│  ├─ bridges/        # telegram (v1)
│  ├─ server/         # daemon: HTTP + WS/SSE, local socket
│  ├─ ui/             # web UI
│  └─ cli/            # binary `agentco`
├─ templates/         # sample company.yaml, roles, skills
└─ LICENSE.md         # FSL 1.1, change license Apache-2.0, change date +2 years
```

Language: **TypeScript / Node.** No heavy native module dependencies (to keep containerization straightforward later).

---

## 12. Things REJECTED (don't reopen without a new reason)

| Idea | Why rejected |
|---|---|
| A long session per worker | every turn returns the entire context; 8 agents × 190K = ~1.5M tokens/round |
| Agents talking directly to each other | the single biggest token sink, uncontrollable |
| OpenRouter in v1 | loses the prefix cache, adds a third party, breaks the "runs on the client's own subscription" model |
| An LLM deciding routing | spending one call to save one call |
| Embeddings via API for retrieval | adds a standing cost; keyword + graph is enough for v1 |
| Hosting compute ourselves for clients | no money for it, **and almost certainly a violation of Anthropic's ToS** |
| Electron/Tauri native from day one | would need a full rewrite once a server mode ships |
| An LLM call to "translate the log into something friendly" | the worker already generates a `say` field, for free |
| Attaching MCP directly to the master session | issue #247 breaks the master's cache, ~36K extra token-equivalents per turn. `concierge` is used instead. |
| Using the SDK's subagents (`agents`) as workers | a subagent's output flows straight into the parent's context → breaks the Receipt protocol. The cache stays shared anyway if we write it ourselves, so nothing is lost. Still **borrows the `AgentDefinition` shape** as the role file format. |
