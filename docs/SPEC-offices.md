# SPEC — Multi-office companies, and the Assistant as a first-class citizen

**Date:** 2026-08-15 · **Status:** Batch 1 in progress

Replaces the "one company = one team" model from `SPEC-2026-08-14-agentco.md` §2. Read alongside `SPEC-canvas.md` (shape) and `SPEC-token-economy.md` (the law that outranks all others).

---

## 1. Why change

v0 collapsed two concepts into one: the *company* was both the configuration unit and the working unit. The consequence: every role sat in one shared basket, one Assistant had to know about everyone's work, and its roster grew with headcount — and that roster lives in the cached prefix of **every conversation turn**.

Splitting into **company → many offices** solves exactly that: each office has its own Assistant that only knows its own people.

---

## 2. Directory layout

```
company/
├─ company.yaml            shared config: model tier, budget, token ceiling
├─ logs/usage.jsonl        COMPANY-WIDE cost, every line carries an office column
├─ .state/                 daemon.json, secrets.json  ← company level
└─ offices/
   ├─ content/
   │  ├─ office.yaml       office name + the Assistant section the user can edit
   │  ├─ layout.json       canvas shape (coordinates + edges)
   │  ├─ roles/*.yaml      staff
   │  ├─ skills/*.md       skills, including skills/assistant.md
   │  ├─ knowledge/
   │  │  ├─ shared/        Assistant writes, the whole office reads
   │  │  └─ agents/<id>/   private to each person, including agents/assistant/
   │  ├─ artifacts/        work output
   │  ├─ .state/tasks/     plan + receipt — DELIBERATELY HIDDEN, see §2e
   │  └─ .state/           master-session.json, pending.json
   └─ accounting/          identical shape, fully independent
```

### Offices are fully independent — and why there is no company-level knowledge store

A `company/knowledge/shared/` tier was considered and **rejected**. Two reasons, both economic:

1. **Company-level knowledge would sit in the prefix cache of EVERY worker in EVERY office.** Add 10 nodes × 250 tokens = +2,500 tokens to every `cache_write`, multiplied by the number of roles, multiplied by the number of offices. It grows, and the whole company gets more expensive at once, and nobody sees why.
2. **It breaks self-containment.** Today, zipping `offices/<id>/` gives you a template that runs on another machine. Add a company-level tier and copying one office elsewhere loses context — and "export a template = copy a folder" is close to the only free feature we have.

Want to share knowledge? Copy the node over, or (M2) an `agentco knowledge copy` command. Costs more once, cheaper forever.

**Offices do not hand work to each other.** That is precisely the agent-to-agent problem this architecture is built to avoid, not an extension of the canvas. Still M3+.

#### How independent — checked at FOUR layers (settled 08/20)

The user's question: *"do offices already have independent sessions from each other? do they share a cache?"* Answer: **independent at all four layers, and none of it is luck.**

| layer | mechanism | consequence |
|---|---|---|
| Object | `Company.loadOffices()` builds a separate `Office` for each folder, each with its own `KnowledgeStore` · `LibraryStore` · `ArtifactStore` · `Assistant` | nothing shared in RAM |
| Session pointer | `.state/assistant-session.json` lives **inside** the office folder | one conversation pointer per office |
| SDK conversation transcript | `cwd: office.dir` — Claude Code hashes `cwd` into its own folder under `~/.claude/projects/` | one transcript per office |
| Cache priming gate | `CachePrimingGate` lives **inside** `Scheduler`, and `Scheduler` is rebuilt **every shift** | not shared between offices, nor between two shifts of the same office |

And then there's **Anthropic's own prompt cache**: keyed on *prefix content*, and `BuiltPrompt.cacheKey` is a hash of that static content itself. Two offices with a different roster / knowledge / library manifest → different prefix → different entry. And even when two prefixes are **identical**, landing in the same entry leaks nothing: hitting it requires identical content, meaning there is nothing left to reveal.

> ⚠ **Known tradeoff, not yet fixed:** the gate is discarded after every shift, so the first task of the next shift always treats the cache as cold, even though the server still holds it warm (5-minute TTL). Harmless for a one-task shift; a shift with many parallel tasks that reruns within 5 minutes pays for **one** extra `cache_write`. Logged, not worth fixing yet.

---

## 3. A clean starting point

`agentco init` creates **exactly** `company.yaml` and an empty `offices/` folder. No sample roles, no sample office.

At that point the UI shows **exactly one button: "Create office."** This is a deliberately designed empty state, not an error screen — the "Stability" criterion demands exactly this.

Why no sample roles: v0's first-time user opened the app to find three strangers on the roster that they never named, didn't understand the reason for, and didn't dare delete. Better to start at zero and add each person deliberately — every addition is a decision they understand.

Sample templates still have value, but as **something chosen when creating an office**, not something pre-loaded.

### Renaming an office — the folder RENAMES TOO, if and only if the new name yields a real slug

> **Changed 2026-08-22.** This section used to say *"`id` stays fixed forever"*, for two reasons: *moving the folder would break the prompt cache* and *the Assistant's session would be lost*. **Measured, both turned out false** — see the table below. Exactly one victim remains, and it has a clean fix.

`PATCH /api/office/:id { name }` writes `name` into `office.yaml`, **and moves the folder too** if the new name produces a real slug. The response returns the new `id` — the client must follow it.

#### The rule, in exactly one sentence

> **Rename the folder if and only if `slugId(new name)` is non-empty and different from the current `id`.**

`slugId`, **not** `folderId` — and that is the whole difference. Renaming "Report" → "会计部" and hashing it turns `bao-cao` into `vp-ee6fd8`: a readable name becomes meaningless, in service of a number nobody looks at. `folderId` is only used at **creation**, when there is nothing yet to lose.

| old name → new name | folder |
|---|---|
| `Report` → `Audit` | `bao-cao` → `kiem-ke` ✅ |
| `Accounting` → `会计部` | `ke-toan` **stays put** — only the display side changes |
| `会计部` → `人力资源` | `vp-ee6fd8` **stays put** |
| `Report` → `Audit` when `kiem-ke` already exists | **stays put** (the name still changes — `assertNameFree` already handles the collision) |

An option considered and **rejected**: *"only rename the folder when the office is still empty."* A mechanism that sometimes runs and sometimes doesn't is unpredictable for the user — worse than not having it at all.

#### Three worries, all measured

| | measured |
|---|---|
| **Prompt cache** | ❌ untouched. `prompt.ts` contains `office.dir`/`office.id` nowhere; every path in the prefix is relative |
| **Assistant memory** | ❌ not lost. Tested for real: state a code in `bao-cao` → rename it to `kiem-ke` → `resume` with the same session id recalls the correct code. `resume` does **not** follow `cwd` |
| **Cost ledger** | ✅ **real.** `logs/usage.jsonl` is at the COMPANY level so it doesn't follow the folder, and carries `office: "<id>"` on 315/317 lines |

The ledger is fixed with an **append-only alias record**: append `{kind:'office.renamed', from, to}` to the end of the ledger; `renameChain()` builds a table of `old id → current id` (walks the whole chain, so renaming three times still jumps the first link straight to the final destination). `costByOffice()` and `usageRecords()` merge through that table. **Not a single history line is rewritten** — a ledger you can edit stops being evidence.

⚠ `readUsage` must **skip** any line with a `kind`: it is not a run (no `cost_usd`, no `turns`), and letting it into the sum makes `tasks` overcounted and the total `$` become `NaN`.

⚠ **Block renaming while the office has a job running** — Windows locks open files, and a worker writing to `artifacts/` while the folder is being moved ends up half-corrupted. Same rule as `archiveOffice`.

#### Two things that DO NOT go away

1. **Non-Latin names still come out as `vp-<hash>`**, before and after. "Folder matches name" is a guarantee **for Latin script only**. For markets using non-Latin script, what serves them is the **📂 Open folder button**, not this mechanism. The two complement each other.
2. **External references break silently** — backup scripts, sync folders, shortcuts, a `cd` open in a terminal. No source code can save that; accepted, because "rename the folder" is a concept the user understands.

#### But EMPLOYEE `id` does NOT rename — and it's the heavier case, not the lighter one

An office folder moves as one atomic unit; an employee's `id` is scattered across four places: `knowledge/agents/<id>/` (**their private experience notebook**), `layout.json` (the `agent:<id>` node **and every edge to it**), `logs/usage.jsonl` (the `role` field), `tasks/*.plan.json` (`task.role`). And there is no UX for renaming it — `roles/<id>.yaml` is **a single file**, nobody browses that folder. Renaming the display name is already available and free.

**Validity rules, enforced on the SERVER (any client can POST directly to the daemon):**

| | |
|---|---|
| collapse whitespace | `"Content  "` → `"Content"`. Two names differing only in whitespace render **identically** in the office picker |
| non-empty, ≤ 60 chars | empty in the `slugId` sense — `"😀"` is empty too |
| **no duplicate name** | the collision key is `slugId(name)`, the exact one the system uses to name folders |

Reusing `slugId` as the collision key is deliberate: there is exactly **one** definition of "duplicate." `"Content"`, `"content  "`, `"Content"` all resolve to `content`. If `createOffice` compared by slug while `rename` compared by raw string, renaming would become a **back door** to create exactly the duplicate that creation already blocks.

Duplicate checking lives in `Company`, not in `Office`: only the company can see the other offices. An office is self-contained and does not know its neighbors — that is the condition that lets `offices/<id>/` zip into a template that runs on another machine.

### 3.1 Deletion has TWO levels: **Archive** and **Delete for good**

`office.yaml → archived: true` — **a single flag.** No file moves, no code changes, `artifacts/` and the Assistant's session are untouched. Restoring returns it exactly as it was, including any conversation left mid-flow.

**Archived means FROZEN, READ-ONLY:**

| Still works | No longer works |
|---|---|
| viewing the diagram, past results, logs, prompts | messaging, receiving work |
| **still has a NAME in the cost ledger** | editing anything (name, model, skills, diagram, staff) |

Enforced by **one single gate**, `Office.assertLive()`, called at the top of every write function. One gate, one sentence, instead of scattering conditions everywhere and missing one — and the spot most likely to be missed is the spot that spends money.

> **Why NOT allow running:** "archived but still quietly spending money" is behavior nobody can predict, and money is the one thing a user cannot get back.

**Why this level exists at all:** deleting for good **loses the entire cost history** (see §3b). Wanting to keep that record means archiving — it's the only place that preserves it.

The old level — *"just close it, keep the files"* — has been dropped: archiving replaces it and is strictly better (restore right inside the app, no folder copying). `DELETE /api/office/:id` now has exactly **one** meaning, delete-for-good — two different intents shouldn't share one verb plus a query-string flag, because that flag is easy to forget and the consequence can't be undone. CLI: `office archive` · `office restore` · `office rm --yes`.

### 3b. DELETING FOR GOOD MUST ALSO CLOSE THE COST LEDGER *(bug reported by user 09/02)*

`removeOffice` now appends a **marker** to `logs/usage.jsonl` (`{kind:"office.purged", office, until}`); a ledger reader skips every line for that id with `ts ≤ until`. → `usage.ts §PurgeRecord`

**Two symptoms of the old code, one cause** — the ledger sits at the COMPANY level, so `rm -rf`'ing the folder never touches it:

| | |
|---|---|
| ① | Delete an office completely, and the cost table still shows *"14 entries with no owner"* |
| ② 🔴 | **A new office with the SAME NAME inherits the dead office's ledger.** `createOffice` derives the id from the name (`folderId`), so "Content" deleted and recreated resolves to the same `noi-dung`: the `gone` flag turns off, the name shows as the new one, and it already declares dozens of runs and a dollar amount it has never actually spent |

**Why cut by MARKER, not by id:** an id can come back (it's derived from the name), so a flag saying *"this id is dead"* either kills the new office too or kills nothing at all. A marker splits it cleanly: before the marker is the previous life, after it is this one.

⚠ **The marker must be checked against BOTH identities** — the id written on the line, and the id after walking the whole rename chain. Checking only one leaks, and it leaks silently in two opposite directions: comparing only the raw id ⇒ *rename `a→b` then delete `b`* leaves `a`'s money uncaught; comparing only the resolved id ⇒ *delete `a`, recreate `a`, rename `a→c`* lets the dead person's money flow into `c`. Each direction has its own test and **both were made to fail on purpose first** (`test/usage-purge.test.ts`).

**Append, never delete a line**, same reasoning as `appendRename`: a ledger you can edit stops being evidence. What the user wants gone is the number on screen and the balance carried into the next office — not the JSON lines they never read. ⇒ this is **not** a data-deletion mechanism for privacy; a real purge would mean compacting the file, and that's a different mechanism, not built yet.

**Cleaning old junk:** a **Clean up** button at the bottom of the *"N entries with no owner"* block (Overview), or `agentco cost --purge`. It only touches entries whose id belongs to **no living office** — open offices and archived offices are untouched.

---

## 4. Assistant — the office's first-class citizen

Every office created gets **exactly one Assistant, which cannot be deleted**. No Assistant, no one to hand work out.

### 4.1 Two prompt layers, a clean boundary

| Layer | Content | Editable? | Viewable? |
|---|---|---|---|
| **Core** (source code) | protocol for talking to agents, the Receipt protocol, the "hand off work, don't do it yourself" rule, how to reach the knowledge store and tools | ❌ | ✅ **always viewable** |
| **Skills** (`skills/assistant.md`) | personality, tone, domain knowledge, habits, priorities | ✅ | ✅ |

**Core being viewable is mandatory, not optional.** Advanced users need to *see* it to trust it; hide it and they guess, and a wrong guess makes them write skills that fight the system itself.

Where the boundary sits: **whatever enforces an invariant in `SPEC-token-economy.md` is core.** In other words, core is part of the *source code*, not part of *running a business*. Users run their company; they don't edit the network protocol.

There is one escape hatch: unlock core editing after a warning dialog, **off by default**. Whoever turns it on knows what they're doing and owns the consequences.

### 4.2 The Assistant has its own skills — a decision to keep

Dropping the Assistant's skills entirely for simplicity was considered. **Kept**, for exactly the reason raised: custom skills are where a user turns the tool into something of their own, and one of the two customer segments already settled on is the type that likes to customize.

The shipped default must be **very short** — a few lines about tone and language, nothing more. It lives in the prefix cache of every conversation turn, so every extra line is a tax collected for the entire shift. Leaving it blank is also a valid choice.

### 4.3 The Assistant has its own notebook, and can write to the shared store

- **Private notebook** — `knowledge/agents/assistant/`. The same mechanism as every other agent, no extra machinery invented. This is where it remembers "this office tends to ask for X," "delegating Y this way breaks."
- **Shared store** — `knowledge/shared/`. The Assistant is the **only** one allowed to write here; workers only write to their own notebook. Reason: the shared store sits in the whole office's prefix — let anyone write to it and it grows exponentially with no single owner accountable.

The Assistant's lessons are already collected at the wrap-up step (`master.report()`), **at no extra call cost**.

### 4.4 The Assistant's MCP/API is really a hidden worker in disguise

Keeping the `concierge` design as-is: the Assistant sees a `quick_action` tool, and the runtime fires off a one-shot query behind the scenes. The master never holds an MCP itself — it keeps resuming, and MCP breaks the prompt cache on resume ([#247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247)), costing the equivalent of ~36,000 tokens **on every single conversation turn**.

The user doesn't need to know the mechanism. On the canvas, plugging an MCP into the Assistant is a valid action, and describing it as "the Assistant can use this tool" is **correct**.

### 4.6 `/clear` — compact memory into the private notebook, then start fresh

**Why compact proactively instead of letting the CLI auto-compact.** Claude Code DOES have auto-compact — the SDK exposes `PreCompact`/`PostCompact` hooks with `trigger: 'manual' | 'auto'`. Compaction **will** happen whether we want it to or not.

The risk isn't running out of memory — it's that automatic compaction **is loss**, happening at a threshold we don't see, keeping what we didn't choose, into a store we can't read. The Assistant will forget some decision at some point, and nobody will know.

> **Compaction will happen regardless. Better it happens at a moment YOU choose, into a store YOU can read.**

#### Four constraints, each solving its own problem

**1. The FACTS scaffold is built by code; the model is only asked for the part it alone knows.**
What ran / where the results are / how much it cost all live in `tasks/index.json`. Asking the model to recite it back is paying to receive a copy that might be wrong. We put the facts **into** the prompt and only ask: *what does the user like, what has been settled, what's still open.* Same rule as the paths block (§6).

**2. Write to `knowledge/agents/assistant/`, NOT to the shared store.**
The shared store is in **every employee's** prefix. The Assistant's conversational memory (*"the client settled on a playful tone"*) is something a copywriter doesn't need to know — putting it there makes the whole office pay to read one person's diary. `visible()` only allows `shared` + `role:<self>`, so this is enforced **structurally**, not by discipline.

**3. `supersedes` points at the previous compaction.** Without it, three months in, the store fills with contradictory decisions — a state **worse** than never compacting. See §5 of `SPEC-2026-08-14-agentco.md`.

**4. A failed compaction must NOT forget — but only while the failure is still RECOVERABLE.** `compactMemory()` only calls `forget()` after the node has finished writing. Keeping one overlong record beats losing everything. ⚠ Since 08/20 this rule has a mandatory exception — see right below.

#### What gets written — five rules, living in `Assistant.COMPACT_RULES`

The full text lives in code (`assistant.ts §COMPACT_RULES`), locked down by `test/compact-rules.test.ts`. Summary: **1** copy forward old entries still correct · **2** the new one wins on conflict · **3** one line per topic · **4** never record a conclusion from a **failed** run, or from something **not yet done / not yet tried** · **5** keep **the method**, not **the figures**.

Rules 4 and 5 share one shape, and it's a shape worth remembering: **never freeze into memory something the system already recomputes fresh on every turn.**

| written to memory | what's already fresh | wrong by when |
|---|---|---|
| ⛔ *"still 23 unpaid invoices"* | a connection query gives you this | the very next day |
| ⛔ *"office has no email-sending connection"* | the arm list is rebuilt from `company.yaml` **every turn** | the instant the user plugs in an arm |

The second case is the 09/02 extension (user-reported): the Assistant answered **correctly** to *"send it to accounting@company.com"*, then `/clear` recorded the **absence** of a capability. The old rule text only spoke of *"FAILED runs"*, so it didn't catch this — and here nothing failed at all. The consequence was identical to the browser-arm case of 08/29: that sentence sits in the prefix of **every** `route()` turn (killing the job right at the door), and `supersedes` **renews it at every compaction**, so it never expires on its own.

> ⚠ Exactly one carve-out: what the **user** has settled still has to be copied forward under Rule 1, even when it's *"don't send email, I'll send it myself."* Rule 4 targets the **Assistant's inference about capabilities**, not something the user told it.

Fixed with **one added example pair** in the existing ⛔/✅ list, **no sixth rule** — six rules dilutes every rule, and an abstract rule loses to a list of examples anyway, so the condition has to sit **on the very line with the example**. Post-English-translation cost (09/03): `COMPACT_RULES` = **961 tokens** (3,826 characters, 3.98 char/token), and it only enters the `/clear` turn — it is **not** in the standing prefix.

#### 🔴 The RULES block is written in English; the MEMORY block it produces is NOT (09/03)

These are two different worlds, and there is deliberately no wire between them — see `docs/CLAUDE.md §Language`.

| | The **RULES** block (`COMPACT_RULES`) | The **MEMORY** block (the output) |
|---|---|---|
| Who writes it | us | the model |
| Who reads it | the model | **the user**, in the Knowledge panel |
| Language | **English, always** | **whatever language the conversation itself is in** |
| Mechanism | a literal string typed in code | **no mechanism at all** — the model observes the conversation sitting right there in context |

The earlier version instructed *"write bullet points in **Vietnamese**"* — hard-pinned in code, inside the very block that is the user's own memory read back to them. An English speaker got Vietnamese memory; a German speaker had **no path at all** to get it in German. The new sentence names no language, so it covers even languages we've never cataloged.

> ⚠ **`NOTHING` is the exception, and it is not prose.** The *"nothing worth remembering"* branch is
> matched by `office.ts` with `/^NOTHING\.?$/i`. That is a **protocol token**, the same kind of thing
> as a JSON field name: translating it via the switch silently breaks exactly that branch, and the
> consequence is an empty node landing in the HOT part of every subsequent turn.
> `test/compact-rules.test.ts` locks this prompt-code pair together.

#### ⚠ `/clear` MUST NEVER GET STUCK (fix from 08/20)

The earlier version lumped **every** compaction failure into the same branch, *"keep the conversation as-is."* Correct for a transient failure, **entirely wrong** for a permanent one.

Compaction runs `resume: <session_id>`, and that conversation record lives under `~/.claude/projects/` — **a folder agentco does not own.** A user clearing it, renaming the company folder, or moving to another machine and it's gone. From that moment **every** `/clear` throws the same error and the chat box **can never be cleared again** — the product's one and only "clear" command is permanently jammed, and the error message says *"we're keeping the conversation intact"* as if that were a choice.

| error | handling |
|---|---|
| transient (network, over quota, rate limit) | keep the conversation, invite the user to type `/clear` again |
| **session no longer exists** (`sessionGone()`) | **still clear**, and say honestly what was lost |

> Losing the memory is **already a done deal** at that point — with the record gone, nobody can compact it anymore. Keeping around a chat box that can't be cleared is just losing it a second time.

`sessionGone()` **does not** use `classifyError`: that function classifies by *the cost of the mistake* (should we retry), while this one asks *does what we're trying to read still exist*. A network error is `other`, and a deleted session is also `other` — lumping them together loses exactly the information needed here. Its default is `false`: **an uncertain match is treated as transient**, because mistaking a network error for "session gone" throws away a compaction that could have been salvaged, while erring the other way only costs the user one more keystroke.

**General lesson:** a command a user reaches for to *escape a bad state* must never itself have a bad state with no way out.

#### When it auto-compacts

| | |
|---|---|
| **Threshold** | `budgets.master_compact_at` (default 60,000), measured against the **real** `cache_read` of the most recent turn — not a hand count |
| **Timing** | the boundary right after **a job just finished**, and only when nothing else is queued |

The window is 200K, so 60K still leaves plenty of room: the goal is to beat auto-compact **before** it fires, not race it. And since `cost ≈ turns × prefix × 0.1`, a small context is cheap on **every** turn, not just the compaction turn.

Timing matters as much as the threshold: compacting mid-question cuts right through a live thread. A finished job is a **natural seam**.

> ⚠ **WORKER tokens don't count toward this.** Workers run `persistSession: false` in their own `query()`, and the planning step (`askOneShot`) does too. Only `route()` (every message) and `report()` (every shift) grow the Assistant's record. So it grows **very slowly**.

#### Why it lives in the knowledge store rather than a separate block next to Skills

The right question, and the answer is: **the same store, two different VIEWS.**

Storing it in the shared `knowledge/agents/assistant/` reuses, **for free**, everything already built: `supersedes`, aging by `hits`/`updated`, the `hot_knowledge_tokens` budget, and future Librarian dedup. A separate block at the storage layer would have to rebuild all four, worse, and spawn a second retrieval mechanism that must stay in sync with the first.

But at the **display** layer they must be split, because to a user these are two very different things:

| | Produced by | confidence | Prompt layer |
|---|---|---|---|
| **Experience** | the agent inferring it after doing work | 0.6 | `Pre-loaded experience` |
| **Memory** | **the user having explicitly settled it** | 0.9 | `Memory from the conversation` |

A user has to be able to answer *"what does the system remember about me"* without digging through the store. Mix it into one stream and the heavier thing gets lost in the noise.

**Employees don't have this layer and must not have it** — `describePrompt` only adds it `when who === 'assistant'`, and `visible()` already blocks it at the layer below. Two gates, two layers, the same conclusion.

> ⚠ **A mistake made while splitting this apart.** The first version split it only at the display layer and forgot to drop it from the ranking — so it landed in **both** blocks at once. The layered prompt table showed 194 + 285 tokens while the 285 fully contained the 194. The user saw exactly that and asked *"is this repeating itself?"*
> The actual prompt at that time still had only one block (only `hot` was ever sent) so the model wasn't reading it twice — but **the display table was lying**, and the whole point of that table is to be trustworthy.
> Fix: `hot()` excludes MEMORY nodes; `buildAssistantPrompt` receives it as a **separate block**, placed **before** the experience block under the heading *"What the human has decided — follow these."* Remeasured: **168 + 84**, no more repeated words.
>
> And excluding it from `hot()` also solves something more important: something the **user** has settled must never compete for a slot with **lessons the agent inferred on its own** in the top-N — and then quietly lose that competition and vanish as the store grows.

#### Three beats when clearing — settled 08/19: **NOT ONE OF THEM IS A MESSAGE**

**Old version (dropped):**

```
master.message   "Compacting the conversation, saving what you've decided…"
office.cleared   ← command to the display side: clear what's currently shown
master.message   "Done. …"   ← the FIRST line of the new conversation
```

**Settled version:**

```
office.activity  "Compacting the conversation…"
office.cleared   ← command to the display side: clear what's currently shown
office.activity  "Saved 3 things you decided to the notebook"    held ~4 seconds
office.activity  null                                            → blank
```

**Why change it — and the reason isn't aesthetics.**

The first beat **was always status masquerading as a message**: it's swept away immediately by `office.cleared` right after it, always, no branch survives it. A message designed to never outlive one beat **is state**, not a message. Calling it by its real name is more honest, not just tidier.

The third beat is worse: it makes `/clear` **leave behind trash from the very cleanup it just did** — the user types the clear-conversation command and gets back a conversation that already has one line in it. And that line **belongs to nobody**: not something the user asked, not something the Assistant answered, but the system talking about itself.

> Same shape as `…thinking` → blank: the process **appears and vanishes**, only the **result** stays. `/clear` has no result that belongs in the chat box.

**But the content of the third beat must NOT evaporate.** *"Saved 3 things you decided to the notebook · dropped 12 stale notes"* is exactly what makes `/clear` feel **safe** instead of **destructive** — drop it entirely and this command looks identical to a delete button. So it moves into the same `activity` line, held for ~4 seconds then cleared (precedent already exists: `4500ms` in `store.ts`).

**Persistent** evidence doesn't live in the chat box and doesn't need to: the new MEMORY node shows up right in the Knowledge panel, and `knowledge.changed` has already bumped. The chat box only needs to **reassure for 4 seconds**, not **archive**.

**Mandatory consequence:** no branch of `/clear` emits `master.message` anymore — including the error branch (*"Couldn't compact memory…"*) and the auto-compact branch (`maybeCompact`). The **error** branch deserves separate thought: it reports something that **did not happen**, and the user needs to know the context is still intact. Settled: errors still go out as `activity`, but held longer (~8 seconds) — because it's bad news, and bad news reads slower.

#### On Telegram: same flow, different display — and that's the correct design

Telegram **has no concept** of "clear what's currently shown," so `office.cleared` is ignored there (the real reason is in the warning block below). What it does have is `editMessageText`, and `activity` was already specced to run through that channel (§6, *"The silence must be filled"*).

So `/clear` on Telegram = **a single message that edits itself in place**:

```
"Compacting the conversation…"   →   "Saved 3 things you decided to the notebook"
```

And it **stays**, reading as a **divider** between two conversations. The user sees a message that says "done," but it is **not a message in the conversation stream**, it's *process status frozen in place*. Two display sides, two outcomes, **the same single event stream, 0 extra tokens** — because every sentence comes from the `say` of an event that already existed.

`office.cleared` is separated from `master.message` because it's a **command**, not a sentence to read. Each display side chooses its own response: the web UI clears `messages` outright; the Telegram bridge **ignores it** and only reads the other two lines.

> ⚠ **Correcting a WRONG reason written here before.** The earlier version said *"Telegram can't delete a sent message."* **Technically false** — the Bot API has `deleteMessage`, and a bot can delete its own messages (within 48 hours). The real reason is **stronger**: on Telegram, the chat window **is the user's own record**, not a redrawable view. Bulk-deleting their old messages because of an internal context-clearing command is destroying the user's data to serve an internal implementation detail.
>
> Recorded here because this is exactly the recurring failure class: a **correct** decision propped up by a **wrong** premise. The day someone discovers `deleteMessage` exists, they'll assume the decision was wrong too.

⚠ Mandatory order: `office.cleared` **first**, the result sentence **after**. Reversed, and the sentence that just appeared gets swept away by the very clear command.

#### Verified with a real run

User settled: *"from now on use a playful tone"* → `/clear` → the node writes out:

```
- From now on all copy for Nang Som Flower Shop must be in a playful tone…
- Don't use custom save paths like artifacts/khoa/… — caused errors before
- File artifacts/T-01/gioi-thieu-nang-som.md currently holds the elegant-tone draft…
```

New session, asked again → *"Sure, I remember: playful tone, no more elegant/formal."*
`/clear` a second time → the second node declares `supersedes` on the first; the prefix now holds only **one** "Memory" block, and **both files stay on disk**.

### 4.5 Changing model — allowed, and here's the cost

**Boundary:** the COMPANY decides *which model each tier is* (that's **money** → `company.yaml → models`). The OFFICE decides *which tier its Assistant runs at* (that's **work** → `office.yaml → assistant.model_tier`, blank = follow `models.master`). Employees already had `role.model_tier` — the exact same shape, no new concept invented.

#### Memory does NOT get lost. Verified by experiment, not by inference.

`resume: <sessionId>` loads a conversation record from `~/.claude/projects/`. That record is **text on disk, independent of the model**; `model` is just a per-call option to `query()`.

> **Experiment (2026-08-16).** Turn 1 on `standard`: *"Remember the number 4271 for me"* → *"Ok, I've noted the number 4271."*
> Switch to `eco`. Turn 2: *"What was that number you just remembered for me?"* → **"That's 4271."**

That's the answer to the worry *"does switching models lose external memory"*: **no.**

#### What's lost is the prompt cache — and it's CHEAPER THAN EXPECTED

Measured on a ~17,000-token-context conversation, same office, same day:

| turn | model | cache_read | cache_write | $ |
|---|---|---:|---:|---:|
| steady state | haiku (eco) | 15,526 | 520 | 0.0040 |
| **switch eco → standard** | sonnet | 19,033 | **1,894** | **0.0176** |
| steady state | sonnet | 20,927 | 463 | 0.0098 |
| **switch standard → eco** | haiku | 16,046 | **1,498** | **0.0051** |
| steady state | haiku | 17,544 | 482 | 0.0033 |

**The switch turn costs an extra ~1,000–1,400 cache-write tokens, roughly +60–80% of ONE turn. One time, then done.**

The initial prediction was that the whole ~17,000 tokens would need to be rewritten (≈ $0.22 at sonnet rates). The measurement disproves that: `cache_read` stays high right on the switch turn. ⚠ **Why the mechanism works this way is not yet understood** — don't build decisions on top of the unexplained part; re-measure if context gets a lot longer.

#### Invariant: switching models must NOT touch work already running

`Office.applyCompanyConfig` builds a **NEW** `LoadedOffice`, never mutating `this.loaded` in place. The `Scheduler` of a shift already running keeps the reference to the exact object it received at `run()`, so **the whole shift finishes on the old model.**

Mutating in place (`this.loaded.company = next`) would make tasks **not yet launched** from the same plan run on a different model than the ones already launched — and the bill stops being explainable. Same reasoning as not killing a worker mid-run: *changing the rules mid-game means no game can be read back afterward.*

The Assistant only ever handles one thing at a time (mailbox locked), so no turn of theirs ever gets its model swapped mid-flight. The new tier applies **starting next turn**.

#### The maxim this all boils down to — applies to skills, model, and every config

> **Ship a draft you can EDIT rather than write from scratch.**
> Already true at the queued-work handoff (§11f of `SPEC-tools-approval.md`) and at not killing a running worker. Changing model is the third case: what's already running finishes running, what's new applies to the new flow. No exception needs "stop everything to apply configuration."

### 4.7 The Assistant has NO tools — tried giving it `Grep`, measured, took it back (08/19)

The user asked exactly the right question: *"the Assistant should be the one who knows the library best — why not give it access?"* No principled reason argued against it — `allowedTools: []` was chosen because *"the Assistant doesn't do hands-on work itself,"* and reading a table of contents isn't hands-on work.

So it was tried: `tools: ['Grep','Glob']`, with a gate blocking by folder so it **cannot** read the private notebooks of employees it has been disconnected from. The allowed zone was derived straight from `assignableRoles()` — the same function `roster()` uses, so there is only ONE source of truth, and cutting the wire updates both at once.

**That gate never once fired. Three mechanisms tried, not one of them ever went off:**

| tried | result |
|---|---|
| `canUseTool` (with `allowedTools: []`) | never fired |
| `canUseTool` + switching `prompt` to streaming input | never fired |
| `PreToolUse` hook, with and without `matcher: '*'` | never fired |

Measured by logging **every** gate decision to `.state/gate.log`: the file was **completely empty** while `Grep` still ran and still read exactly the file it should have been forbidden to.

⚠ **Boundary of this measurement, don't generalize beyond it:** measured with `Grep`/`Glob` — **read-only** tools. Best guess is that the CLI auto-approves them, so they never go through any approval path at all. `Bash` or a write tool **have not been measured**, so §8 (the approval gate) **isn't disproven** — but it must be re-measured before building on it; don't trust the docs.

#### 🔥 Why it had to be DROPPED ENTIRELY, not "temporarily accepted without a gate"

When asked about a file outside its allowed zone, the Assistant answered:

> *"I don't have access to system config files like office.yaml — I can only read library, knowledge, and artifacts."*

**It had full access.** It was acting out the folder map we wrote into its prompt. With no fence at all, the user at least knows there's no fence; a **fake** fence, narrated by the model with total confidence, is far worse — and that is exactly the rule *"never let the model explain the system to the user itself"* (§5d): it has no introspective access, it makes up a plausible-sounding sentence, and the user believes it.

#### A real exit exists, and here's why we still didn't take it

Declaring your own MCP tool (`createSdkMcpServer` + `tool()`) with a `where` parameter as an **ENUM** built from `assignableRoles()` makes an invalid operation **inexpressible** — a structural block, stronger than any runtime gate. But *"the Assistant does NOT attach MCP"* is a hard law: MCP breaks the prompt cache on resume (~36,000 equivalent tokens per turn), and `route()` resumes on **every** message. Trading 36K tokens/turn for one convenience is a heavy loss.

#### The cost of dropping it: measured at ZERO

Across both runs of test 2 (with and without tools), the Assistant **never called a tool once**. The library manifest already in the prefix (`SPEC-library.md` §8b) was enough for it to plan correctly and point `inputs` at the right file. What solved the problem was **data already in the prefix**, not the ability to go look.

> **Lesson: a capability you can't gate, don't grant.** And if it's already granted and you find out you can't gate it, take it back — don't patch it with a warning in the prompt, because the model will narrate that warning as a false guarantee.

---

## 5. Worker — also two layers

Nothing new mechanically, just spelling it out and making it viewable:

| Layer | Content | Editable? | Viewable? |
|---|---|---|---|
| **Core** (source code) | Receipt protocol, turn-count discipline, "write to a file instead of pasting content" rule, how it receives knowledge | ❌ | ✅ |
| **Skills** (`skills/<role>.md`) | how this role does its work | ✅ | ✅ |
| **Private notebook** (`knowledge/agents/<role>/`) | the agent writes as it draws lessons. **Blank** on creation | ✅ | ✅ |

### 5.1 Employees also have two levels: **Archive** and **Delete for good**

`roles/<id>.yaml → archived: true`. An archived role disappears from the canvas **and** from the Assistant's roster — i.e. its `pitch` leaves the prefix cache. Putting someone away is **a real token saving**, like cutting the wire but more decisive.

On restore they return to exactly the same office, because **they never really left**: no file moved, only a flag was lifted.

> ⚠ **Why a flag is needed — "remove it from the diagram" isn't enough.**
> The earlier version removed the node from `layout.json` and kept the yaml file. Sounds right — but `layout.read()` **reconstructs the node from `office.roles`** on the next read. The "removed" employee reappears on the canvas at a different grid cell, having lost only its edge. That operation **never actually removed anything.**
> The flag in yaml is the ONE source of truth: canvas, roster, and scheduler all read it. There is no path for an archived employee to receive work.

Three easy-to-forget spots when adding this flag, all three already tripped over:
1. **The orphan-node scan** must skip archived roles — otherwise, putting someone away makes them reappear on the canvas **in red**, worse than not being able to put them away at all.
2. **`LayoutStore.save()`** must skip archived roles when syncing `mcp:` — it has no node, so no edge points to it, and every diagram save would **wipe out its tool list**.
3. **`assignableRoles()`** must filter at the role layer, not off of edges: before `layout.json` exists, `assignable` is `undefined`, meaning "everyone" — and "everyone" must exclude anyone already archived.

Deleting for good removes `roles/<id>.yaml` and its skills. But the **experience notebook at `knowledge/agents/<id>/` is DELIBERATELY kept** — that's what the office has learned, not a name's private property. Delete the person and delete the lesson too, and you've lost the most expensive thing in the whole folder.

> **INVARIANT: reading and writing skill files must go through EXACTLY ONE path-resolving function** (`skillFileFor`).
>
> A bug that actually happened: the UI **wrote** to `skills/<id>.md` (the fallback path from `describePrompt`), while `loadSkill` only **read** whatever was declared in `role.skills`. An employee created from the UI has `skills: {}`, so the user hits Save → server writes the real file → reading it back returns empty. The content they just wrote vanishes, **even after reloading the page**, with no error at all.
>
> Resolution order: declared in yaml → `skills/<id>.<tier>.md` already on disk (v0's convention) → `skills/<id>.md`. Two different paths for the same thing is the quietest way to lose a user's work — same family as `cheap`→`eco` with no alias.

### `secrets` — tool keys, granted per person

A role declares the **NAME** of the key; the value lives in `company/.state/secrets.json` (gitignored, and the one API that reads files — `ArtifactStore.resolve` — only accepts paths inside `artifacts/`, so `.state/` has no route out over HTTP).

```yaml
# roles/inbox.yaml
mcp: [gmail]
secrets: [GMAIL_TOKEN]     # ONLY this key is placed in the MCP process's environment
```

Three properties, each solving a different problem:

| | |
|---|---|
| **Least privilege, per person** | the copywriter doesn't hold a key to the payment gateway, even in the same office. An agent hit by prompt injection through content it reads only holds the keys we actually granted it — the blast radius of a mistake is bounded. |
| **The value NEVER enters the prompt** | the key is an environment variable of the MCP process. The model **can use the tool**, but **cannot read the key**. That's the difference between "the agent has permission" and "the agent knows the password." |
| **No API** | `agentco secret set/list/rm` is CLI-only. Secrets never go over HTTP, not even to localhost — an endpoint that can read them is an endpoint that can be tricked into being called. `set` takes its value via the `VALUE` env var, not a command-line argument (arguments end up in shell history and the process list). |

**The Assistant has no such field.** It never holds a tool itself; anything needing a tool goes through a hidden worker, and that worker is a role with its own `secrets`.

### Workers do NOT "go digging" through the knowledge store — a point often misunderstood

The natural question: does the worker search the store itself, or does the Assistant read it for them and hand it over? **Neither**, and that's where this architecture beats both options:

| | Who does it | Cost |
|---|---|---|
| **HOT** — nodes commonly used by the role | `KnowledgeStore.hot()` stuffs them into the cached prefix up front | ~0 when the cache is warm |
| **COLD** — nodes matching this task | `KnowledgeStore.cold()` scores by keywords from the brief | **0 tokens**, sits after the cache breakpoint |

Both run on **code, no LLM call**. The worker opens its eyes to find the knowledge already sitting in the prompt.

- If the worker searched itself: every search is a **turn**, and `cost ≈ number of turns × prefix × 0.1`. The most expensive of the three options.
- If the Assistant read it and pasted it into the brief: that content sits in the Assistant's context **forever**, and gets read twice, exactly as you feared.

→ Keep as-is. Multi-office only needs one `KnowledgeStore` per office.

---

## 6. Job lifecycle — the Plan is the unit, not a chat line

v0's log was one flat stream. Unreadable when two jobs overlap, and it can't answer "what did yesterday's job actually do."

### The classification rule

The Assistant routes every user message into one of four:

| intent | meaning | consequence |
|---|---|---|
| `chat` | greeting, asking about past work | answer, done. **0 worker tokens** |
| `ask` | looks like work but is missing information | ask one question back, wait |
| `task` + `new` | new work, unrelated to what's running | **spawns a new, independent Plan** |
| `task` + `refine` | adds to / edits what was just discussed | **attaches to the current Plan** |

`new` vs. `refine` is decided by the Assistant on its own session (it has the full conversation history), not inferred by a client-side heuristic. It errs toward `new` — two independent plans only cost one extra planning pass, while attaching to the wrong plan corrupts a job already running.

The fifth door is `lookup` (hidden worker) — see §6c right below.

### 6c. `lookup` — hidden worker, and **it can search the web too** (extended 08/24, user-approved)

`lookup` is the *"answer a question, don't hand anything off"* lane: a one-shot `query()`, a tiny prompt,
no Plan spawned, no artifact spawned, `persistSession: false`.

**Old rule:** `paths` required ≥ 1 — *"if you can't name a file, ask instead of letting the agent go wander."*
Right, back when an office's world was only the document library.

**It broke on the very first contact.** A brand-new office, and the user asks *"what's the weather today,"*
*"restaurant recommendations,"* *"news"* → no `paths` to name → *"this office doesn't have anyone covering that yet."*
The user pushed back with an unanswerable line: *"is a non-technical flower-shop owner going to walk in and
build a professional employee, or are they going to ask random stuff like restaurants, weather, news?"* — and
the notebook had already flagged this order of concern: the real risk is **no users at all (~90%)**, not an
unclean architecture (~1%).

**Settled:** `paths` becomes **optional**. Empty = a general lookup question → the hidden worker searches the web.
The hidden worker gets `['Read','Grep','Glob','WebSearch','WebFetch']`.

| | |
|---|---:|
| hidden-worker prefix before | 2,828 |
| after adding the two web tools | 3,820 |
| **web adds** | **+992 tokens**, only paid when lookup actually RUNS |
| one real web question (sonnet) | 29.8 s · **$0.0827** |
| the same job through plan→worker | $0.13–0.14 · 30–40 s |

**Why NOT invent a fifth intent:** `route()` runs on EVERY message ⇒ every intent is permanent token cost in
the conversation prefix. `lookup` was already this lane; letting it search the web is **extending an existing
lane**.

⚠ **BOUNDARY, and this is the real risk of the extension:** ***`lookup` ANSWERS, it does NOT HAND OFF.*** Anything
the user wants to keep (a file, a report, a table) is always `task` + an employee. That is preserved through
**CAPABILITY, not instruction**: all 5 tools are read-only, so the hidden worker cannot write a file even if
the Assistant routes wrong.

⚠ **The part that can't be gated — said out loud:** `WebFetch` is an OUTGOING data channel, and now it's reachable
from a **0-employee, 0-config** office. Every employee already had it, so the marginal risk is small — but it
shifts from *"you have to build an office first"* to *"just open the app."*

#### The PRIORITY rule — and an example list that almost neutralized it

User settled: *"allow both lookup and employees, let the Assistant route on its own, but **prefer the employee**
if the employee is a professional and does exactly that job."* The old axis stays (*"would a different person get
a different result"*); this rule breaks a **tie**. The asymmetry: picking `task` wrongly costs extra money and
time; picking `lookup` wrongly means the user **loses a deliberately-built professional viewpoint** — and nobody
notices the loss, because the answer still comes back smoothly.

> 🔴 **The first version of this rule DID NOT WORK, and the reason is worth remembering.** The `lookup` description
> line listed straight out *"restaurants, weather, news,"* while the priority rule sat four lines away. Measured
> on an office WITH `nguoi-tim-tin` (*"browses the web, cross-checks multiple sources, cites sources"*): **1/4
> correct door** — the model matched the example list and stopped, never reading the rule.
> **⇒ An example list beats an abstract rule. The condition must sit ON THE SAME LINE as the example.**

After moving the condition onto the example line (`scripts/spike-route-ambiguous.ts`):

| office | "5 coffee shops in District 1" | "tech news" | "what day is today" | "aggregate prices … write to a file" |
|---|---|---|---|---|
| has `nguoi-tim-tin` | `task` ✅ | `task` ✅ | `chat` ✅ | `task` ✅ |
| **empty, nobody staffed** | `lookup` ✅ | `lookup` ✅ | — | — |
| **only has `nguoi-dich`** | `lookup` ✅ | `lookup` ✅ | — | — |

**8/8.** The bottom half of the table matters as much as the top half: pull the priority rule too hard and an
office with no researcher pushes every random question to `task`, and the very non-technical user who triggered
this whole patch gets back the exact *"no one covers that yet"* line that started it.

⚠ This is **model BEHAVIOR, not a hard fence**. A clean table only says the new lane doesn't swallow the old one
in the most visible cases.

### `deliver` — where the result LANDS is the SECOND axis (settled 08/19)

#### The problem, and why the first diagnosis was wrong

A user asked their support office: *"how long is the warranty on shop products?"* → the system planned it out,
an employee read the library, and the chat box returned:

> *"Answered your question. The result is saved at: `company/offices/customer-support/artifacts/P-mt08w0t8-iu50/T-01/answer.md`"*

The first diagnosis — *"the chat/task boundary is too thin, the Assistant misrouted"* — was **wrong**. The
routing was **correct**: the Assistant has no tools (§4.7), so knowing what the policy actually says requires
an employee to read the document. This **is** a task.

The real break was elsewhere: **a task has exactly ONE delivery shape.** `ASSISTANT_CORE` forces *"every task
must write at least one file,"* `CORE_PROMPT` forces *"never paste file contents back in your reply,"* `receipt.say`
is capped to one sentence. So even though the Assistant understood perfectly well that the person only wanted
to **know**, the machinery underneath could only ever produce a **file**.

> **Two independent axes, don't mix them:** `intent` decides **WHO DOES IT**. `deliver` decides **WHERE THE
> RESULT LANDS**.
> Before 08/19, `deliver` was hardcoded to `file` in the prompt — so it was invisible, and every attempt to fix
> it wandered into the `intent` axis by mistake.

| `deliver` | use when | what the user does next |
|---|---|---|
| `reply` | they want to **KNOW** something | **read it**, then done |
| `file` | they want to **HAVE** something | open it · send it · edit it · save it |

The distinguishing question, small enough to code as one line: *does the result fit inside one chat bubble, and
will the person only ever read it once?*

#### Why NOT build `/answer [question]`

Considered seriously and **rejected**. Three reasons, ranked by weight:

**1. It doesn't remove the uncertainty it promises to remove.** `/answer` still has to: pick a role, write a
`goal`, write `constraints`, point at the right file in the library. All the uncertainty stays right there, and
this command doesn't touch it. It pins **only** the delivery shape — a full UI cost to buy a very small piece.

**2. Wrong target.** The six existing commands are all **verbs that control the machine** (`stop` `approve`
`reject` `status` `help` `clear`). `/answer` would be the first command that makes the user **classify their
own sentence before saying it.** The flower-shop owner doesn't do that — and precisely the time they forget,
they hit the file again.

**3. There is already a free, DETERMINISTIC lever, nobody's pulled it yet: the OFFICE.**

`customer-support` exists to produce **answers**. `content` exists to produce **files**. That isn't a per-message
thing — it's a property of the office, stable for months.

```yaml
# office.yaml
assistant:
  default_deliver: reply      # default: file
```

From *"guess again on every message"* to *"follow the correct default, the model only overrides when it's genuinely
different."* **0 tokens** (one line inside a prefix already cached), 0 burden on the user. Follows §4.3's rule:
**don't tell the model not to do something — don't give it the chance to.**

#### Mechanism: TWO CHANNELS, neither one carries the other's words

The concern raised: *"the assistant understands it should reply, but the worker writes a file → the assistant
reads the file → the content gets relayed twice."* That scenario **requires the Assistant to be able to read a
file**, which is already hard-banned in §4.7, **with measurements**. Drop the impossible branch and the design
**collapses to exactly one shape** — that's a good sign, not a coincidence:

```
receipt ─┬─ answer  (≤300 words)  ──→ master.message, role = THE EMPLOYEE
         │                            ⛔ NEVER enters the Assistant's session
         └─ say     (1 sentence)  ──→ report() exactly as today
                                      ✅ this is the ONLY thing the Assistant sees
```

The cost invariant stays **intact**: the Assistant's context still receives exactly one sentence per task, same
as before. `answer` is a **new** field, not an extension of `say`'s 500-word ceiling.

Four mandatory consequences:

1. **Still writes a file as before**, even with `deliver: reply`. It's free, and it anchors a later `refine`
   (*"soften the tone of that answer"*) along with an audit trail. Only **stops announcing it**.
2. **Suppress the `whereBlock` for a run that is ONLY a reply.** The person just finished reading the answer;
   pasting a path underneath is repeating the same thing in machine language.

   > 🔴 **Corrected 05/09.** This was implemented as *"drop the receipt of any task carrying an `answer`"*, which
   > is a different rule and a wrong one. In a MIXED run (`P-260905-0100-zquw`: one `file` task, one `reply` task)
   > it threw away the reply task's **verified file landing**, so the run reported zero outputs while two files
   > sat on disk — and the chat had no clickable path at all. The condition is the **shape of the run**
   > (`soloReply`), not the presence of an `answer` on one receipt. → `office.ts`, the box above `const quiet`
3. **A Plan with only ONE `reply` task drops `report()` entirely.** The employee's answer **is** the report. This
   is where the "friction" disappears: no more two messages saying the same thing. And it's **one Assistant turn
   cheaper per question** — the support office is exactly where this cost shape repeats the most.
4. The cost must be said plainly: dropping `report()` means **the Assistant's session doesn't contain that
   answer.** The next `refine` knows the *request* (it routes itself), but not *what was answered* — it has to
   hand it back to the employee to read the file. Accepted: one extra employee turn, in exchange for the Assistant's
   context **not growing with every question a customer asks.** For a support office, that's the right tradeoff.

> This also incidentally fixes something else: the support office **stops printing `P-…-iu50` into chat.** See
> `SPEC-artifacts.md` §2.1.

### `say` NEVER contains the speaker's name

The event already carries `role`; **the display side** looks up the name from that. Baking the name into `say`
gives the user *"Writer: Writer: Write 3 paragraphs…"* — the name shows up twice, in both the log and the status
line, because both call `labelFor(e.role)`.

This is a PROTOCOL rule, not aesthetics: the Telegram bridge is also a display side, and it needs to decide for
itself how to attach a name (bold, an emoji, or nothing at all). Baking the name into the string strips that
choice from every future client.

### The "what's happening" line MUST NOT GO SILENT

From the moment the user hits Send to the moment there's a result, there must always be a sentence describing
what's happening.

The earlier version dropped exactly one beat — between the Assistant finishing reading the request and the plan
showing up. Cause: `handleUserBatch` called `run()` **without awaiting** and returned, so the mailbox unlocked
immediately and `pump()` fired an `office.activity` full of zeros, right as `run()` had just started planning.
The user saw *"Assistant is thinking…"* → **dead silence for 15 seconds** → the plan. That silence is exactly
where they'd hit Send a second time.

Two layers of protection, deliberately overlapping:
1. `office.activity.assistant` has a third status, **`planning`**, read from `currentRecord.status` — i.e. from
   the **job record**, which exists even before planning starts. Not inferred from the mailbox, because the
   mailbox is exactly where it went wrong.
2. Display side: if there's a `plan_id` but no "bit" is set yet, show *"Running…"*. Catches every remaining
   short gap (just finished planning, hasn't launched the first task yet).

### What survives a daemon restart — and the screen must say exactly that

| | Where | Survives? |
|---|---|---|
| Assistant's conversation | `~/.claude/projects/<hash-cwd>/<session>.jsonl` (CLI-held) + pointer `.state/assistant-session.json` | ✅ |
| **The on-screen chat stream** | `.state/chat.jsonl` | ✅ *(since 08/16; before that ❌)* |
| Job log, reports | `tasks/index.json`, `<plan_id>.log.jsonl` | ✅ |
| Knowledge, artifacts, skills | files | ✅ |
| Queued jobs (`jobs`) | **memory only** | ❌ |
| Assistant's mailbox | **memory only** | ❌ |
| A plan currently running | memory; its record gets stuck at `status: running` forever | ❌ |
| `pending.json` | it **is** written, **read to COUNT, but nothing yet resumes it** | ⚠ half-done |

> ⚠ **`pending.json` — real state, stop calling it "dead code."** `Office.savePending()` writes it,
> `Office.readPending()` reads it, and `GET /api/company` **does** return `pending: <number>` for each office
> (`server.ts`). The number does reach the UI.
>
> What's **still missing** is the CONSUMER side: no `agentco resume` command picks that list up and carries it
> forward. Running out of quota mid-way means the user has to **type it again by hand**, and the Assistant
> replans from scratch. These are two different gaps and only one is closed — writing this down so next time
> nobody thinks both still need doing.

**Fixed bug: the model remembers, the screen forgets.** The chat box reads from a 300-event ring buffer *in
memory*, so restarting the daemon makes it **completely blank** — while the Assistant can still keep answering
the unfinished question as if nothing was lost. A user hit exactly this and described it as *"this feels off"*:
no signal could be trusted anymore.

Events belonging to a job are already logged to `<plan_id>.log.jsonl`. The real gap was the **conversation**
(`plan_id: null`) — belonging to no job, so no file claimed it. Now there's `.state/chat.jsonl`.

> ⚠ When asked, the model **doesn't know** where its memory lives. Asked directly *"how do you remember, I just
> restarted the daemon?"*, the Assistant answered *"I only remember within this open conversation, nothing to
> do with any daemon"* — plausible-sounding and **completely wrong.** Never let the model explain its own
> architecture to the user.

### Which job a chat line belongs to — no link id, and that's a choice

User asks: *"what if I don't type `200 words, funny` until tomorrow?"* → still works, no time limit.

Mechanism: `route()` runs **on the Assistant's session**, meaning it has the whole conversation record, and
returns `intent` + `scope: new | refine`. No correlation id, no "pending question ↔ job" table. The model reads
the context and connects it itself.

The tradeoff, stated plainly: cheap and natural (0 extra structure), but **that link only exists inside the
conversation record.** Lose the session, lose the link — no way back.

> ✅ **Update 08/19 — this section used to say something wrong.** The earlier version said *"that record grows
> unbounded: `budgets.master_compact_at` is declared in the schema but nothing uses it yet."* It's used now:
> `Office.maybeCompact()` reads exactly that threshold, compares it against `assistant.contextTokens` (= real
> `cache_read` of the most recent turn), and only compacts at the boundary of **a job that just finished, with
> nothing else queued** — see §4.6. The record **no longer** grows unbounded.
>
> But the next consequence is real and still unsolved: **compaction loses the link.** The compacted version keeps
> the user's *decisions*, not *"which job this line belonged to."* So a `refine` about a job that ran before the
> most recent compaction will slide into `new`. Acceptable — erring toward `new` is exactly the direction chosen
> in §6 — but it needs to be known to exist, not a surprise when someone hits it.

### Every event carries `plan_id` and `office`

This is the condition for the log to be readable, and the condition for the multi-office UI to not display
things under the wrong office. An event belonging to no plan (`master.message` during chat) carries `plan_id: null`
and goes to the conversation stream.

### The silence must be filled — and filled at 0 tokens

From the moment the user hits Send to the moment the Assistant answers is 5–15 seconds. Saying nothing during
that gap is exactly where they hit Send a second time.

Hence a running `activity` field: `reading the request…` → `Assistant is planning...` → `Writer: writing bai_1.md`
→ done. Every sentence comes from the `say` of an event that **already exists**; no LLM call exists purely to
power a display — that's the cross-cutting constraint from the four quality criteria.

**For Telegram (later):** doable, and the minimum is enough. `sendChatAction: 'typing'` produces Telegram's "…"
indicator, refreshed every ~4 seconds while `activity` is set. For more, send a message and `editMessageText`
every time `activity` changes — still 0 tokens, since `say` already exists in the event.

### A step with no task in it is NOT a step

The model very often writes a step like *"Save the result to a file"* and then hands no task to it — because
that work already lives in the previous task. A step like that is un-tickable: it stays stuck at "not done" even
when everything is actually finished, and the user looks at it and thinks the system dropped something.

Filter it with **code** while building the plan (drop empty steps, renumber), not by asking the model to redo
its plan — cheaper than another call round and deterministic. The prompt also warns about it, but a warning is
a suggestion while filtering is a guarantee.

Alongside: a step with **multiple tasks** is only done when **every** task in it has finished — count by tasks
completed, don't ask "is this step done" (a self-referential question, and a multi-task step would get stuck
forever at "in progress").

### Four CODE-enforced gates around a plan — already running for a while, never written down before

All four are already in the source code and none of them was ever specced here. Added 08/19, because this is
exactly the kind of thing that's **silent when correct** — meaning nobody remembers it exists until the day
someone accidentally rips it out.

Ordered by **when it fires**, and that order is itself the point of the design: fix it if you can, block it if
you can't fix it, review it after the fact if you can't even block it.

| # | Gate | Where | When | Does |
|---|---|---|---|---|
| 1 | `Scheduler.linkDeps` | `scheduler.ts` | **after** planning, **before** the first worker | **FIXES** |
| 2 | `Scheduler.validate` | `scheduler.ts` | same beat, right after (1) | **BLOCKS** |
| 3 | `Office.missingOutputs` | `office.ts` | after the DAG has finished running | **DOWNGRADES STATUS** |
| 4 | `worthLearning` | `assistant.ts` | before asking the Assistant to wrap up | **DOESN'T ASK** |

**1 — `linkDeps`: a task reading another task's output that forgot to declare `deps` gets WIRED DIRECTLY.**
That relationship is derivable from the two paths we already hold (one side declares `outputs`, the other declares
`inputs`). Making the model replan to get it right is one more call round in exchange for a result that **can
still be wrong**. Once wired, **say so** — a user looking at the plan strip and seeing two jobs run sequentially
instead of in parallel needs an explanation line; silently patching it is unpredictable system behavior.

#### 1b. An input that's a FOLDER — added 08/20, after a real broken run

Test 6 (*"review a contract"*) was the first case where a task **doesn't know in advance how many files it'll
produce**: *"split by clause, one file per clause"* → the file count equals the clause count, only knowable after
reading it. So the planner declared the next step's `inputs` pointing at an entire **folder** — that is the
**most correct way** it had to declare it, not a mistake. The plan got flatly blocked:

```
· Task T-02 needs to read "artifacts/P-260820-2044-ki6b/T-01/dieu-khoan/"
  but that file doesn't exist, and no task creates it
```

**Two causes, and the second only surfaced after fixing the first** — exactly the rule *"a recurring symptom
almost always has a second cause"*:

| | Cause | Fix |
|---|---|---|
| a | **Trailing slash.** `outputScoper` strips it (it splits the string and drops empty fragments), `artifactScoper` keeps it. Two strings for **the same folder** entering `norm` differently | `norm` strips the trailing slash |
| b | A folder **never** `===` a file inside it, so even when T-01 declares `…/dieu-khoan/dieu-01.md`, the comparison still misses | `contains(dir, file)` — prefix **+ `/`** |

> ⚠ The prefix must include the `/`. A bare `startsWith` matches `dieu-khoan` against `dieu-khoan-cu.md` — a
> **wrong** wire, and it chains two independent jobs into a sequential one, slower with no one able to explain
> why.

A folder with **multiple writers** gets wired to **all of them**: missing one wire means the reading task starts
while only half the files exist — exactly the silent breakage `linkDeps` exists to block.

And `CORE_PROMPT` had to stop contradicting itself: the line *"Do not list directories"* banned exactly what this
task had to do. Now it reads *"an input path ending in `/` IS a folder and is meant to be read: list it once,
read what is in it, and stop there"* — still bans wandering around, just drops the absolute mandate.

**2 — `validate`: reject a broken DAG IMMEDIATELY, before any worker is launched.** Four things get blocked: a
role that doesn't exist (checked against **roles currently on duty**, not every file under `roles/` — otherwise
cutting a wire on the canvas is pure decoration), `deps` pointing at a task that doesn't exist, two tasks writing
the same path, and circular dependencies.

> The fourth deserves separate mention: **`inputs` pointing into thin air.** Only flagged when the path is
> **both missing on disk and produced by no task.** The Assistant mistyping a document's name means the employee
> gets handed a dead path — and it **doesn't error**: it goes SEARCHING, burns a turn, then either returns
> `blocked` or, **far worse, answers with something it made up.** The cost is a whole task, and in the worst case
> nobody knows it's wrong.

The message shown to the user must state **the action to take**, not print the raw technical list verbatim. The
earlier version handed a flower-shop owner *"Task T-02: dependency T-05 doesn't exist."*

> ### ⚠ AND IT MUST NEVER SAY *"NOTHING SPENT YET"* — fixed 08/20, user caught it
>
> The earlier version said: *"My work breakdown had an error, so nothing ran — **no money spent on anything.**"*
> The user opened the cost ledger right after and saw **charges**, and replied with exactly three words:
> *"It's broken, and usage still shows charges."*
>
> That sentence was wrong because the `route()` and `plan()` turns that had just run **had already been logged.**
> It was a comforting sentence, and it lied precisely where the user could check it most easily.
>
> | | |
> |---|---|
> | What we **know for sure** | no employee ran — and the employee is the expensive part (floor ~13,200 tokens/worker-turn) |
> | What we **should not print a number for** | on this rescue branch, `usage` is **0** at this point while `route()` already charged something → printing a number here is a **second** lie |
>
> The correct sentence: *"No employee has started work yet — "* State the part we know for certain, point at the
> ledger for the rest.
>
> → `SESSIONS_MEMORY` §2 *"The cost ledger must never say anything wrong."* That rule was written for the ledger;
> this case shows it applies to **every sentence about money**, anywhere on screen.

### 6b. RESUMING UNFINISHED WORK — two paths, and a deliberately UNBUILT third (08/20)

The user framed it right: *"what I need is to pick up from that failed run, say it already produced 2 files.
**Be smart about it**, not just a resume button."*

Answer: **it should be automatic, not guess-based** — and the cut doesn't sit at "button or no button."

#### ⛔ What's NOT being built: auto-matching "this new request is that old job"

To recognize that on its own, the system would have to guess **three** overlapping things at once: *is this
really the same job* · *are the old files still valid* · *which task maps to which task* (a new plan splitting
the work differently makes `task_id` meaningless across two runs). Two of the three **aren't observable**.

> And the failure mode isn't wasted money. An employee splits an old contract into 12 clauses · the user swaps
> in a revised `hd1.docx` · a "smart" system reuses the 12 old files and returns a checklist that's **perfect,
> convincing, and about a contract that no longer exists.** Same root as the rule *"the knowledge store never
> holds document content"*: **the stale copy WINS over the original**, because it's within reach while the original
> has to be gone and looked for.
>
> **Lost money can be recovered. A wrong result already handed off cannot.**

#### ① Unfinished work SHOWS UP as an ordinary input — deterministic, automatic, 0 tokens

The Assistant **already has** the results manifest in its prefix (§SPEC-artifacts 2.4). Exactly two pieces of
data were missing, and both are observable:

| Piece | Derived from |
|---|---|
| This job is **unfinished**, stopped at which step | `PlanRecord.status !== 'done'` + counting `steps` |
| This file is **stale or fresh** | `plan.json` records exactly which task reads what / writes what → compare `mtime` on both ends |

The manifest now prints `## <job name> — ⚠ UNFINISHED (2/3 steps)` and tags `(STALE — its source changed after
this was written)` on every stale file.

Then **let the normal planning path decide.** It doesn't "match old work to new work" — it does exactly what it
does every day: *see a file that already exists and decide whether to use it*, with the full context of the
sentence the user just typed. **No button, no guessing, no second mechanism to keep in sync.**

> ⚠ Compare `mtime` with `>`, not `>=`. Writing something in the same second is common on disk; falsely flagging
> it stale means **every** freshly-produced result carries a warning label, the user learns to ignore the label,
> and then ignores it the one time it's telling the truth.

#### ② `/resume` — an INTERRUPTED job, not a job typed again

This is the one and only resume case that requires **no guessing at all**: `/stop` · out of quota · daemon crash.
The job was never replanned ⇒ **still the same `plan_id`, still the same task list**, the receipt is on disk.
Nothing to match, so nothing to guess wrong.

| Gate | |
|---|---|
| `pending.json` carries **`plan_id`** | without it, there's no way to know where to write results; `artifacts/<plan_id>/` is the per-job frame, and a new id would orphan the whole unfinished batch |
| Goes through the **exact `Office.run()`** (third argument `resumePlan`) | not a stripped-down copy. `linkDeps`, `validate`, `missingInputs`, the cost ledger, `finish` all run identically — two code paths for the same operation will drift, and the rarer path drifts first |
| **0 model turns** | the plan already exists and was already paid for. That's the entire point: the expensive part of a broken job is the turns already spent |
| `deps` pointing at an ALREADY-DONE task gets trimmed | without trimming, `validate` reports *"dependency doesn't exist"* and blocks the exact job being rescued. Whatever it produced is still on disk, so `missingInputs` still checks it for real at launch time |

> ⚠ **NEVER auto-run when the daemon starts.** Same rule already settled for Assistant memory: attaching meaning
> to a daemon turning off/on means a silent crash silently spends the user's money. And unfinished work usually
> comes from `/stop` — meaning they **just said stop**; auto-resuming overwrites that decision.
>
> Instead it's **OFFERED**: a chat-box line when the office connects to the bus, stating all three things needed
> to decide — *how much work is left*, *from which job*, and *resuming costs no additional planning turns*. The
> user types `/resume`. That's a **conversation**, not state management.

⚠ **A trap already stepped in:** putting the invite in the `constructor` runs it **before** `PlanStore` is even
built (`resumable()` throws) **and before** there's a bus (the invite falls into a void). One mistake, two
symptoms, and the second one is silent. Must fire from `bindBus()`.

#### ⚠⚠ `"not in pending"` ≠ `"done"` — a time bomb, exploding a day later

The first version of `resume()` trimmed any `deps` pointing at a task absent from `pending`, with the comment
*"safe to drop because 'done' means exactly that."* **Wrong premise.** `pending` is *tasks that HAVEN'T RUN AT
ALL*; being absent from it could mean done ✓ · failed ✗ · blocked ✗ · **cut off mid-write ✗**.

Measured on the user's machine twice in a row (hd3 3/5, hd4 4/5): they hit Stop while `Reader` was mid-way
through splitting a contract, then typed `/resume`. T-01 was absent from `pending` because it HAD run — and
returned `blocked`. The wire `T-02 → T-01` was cut, `missingInputs` saw a folder with files and let it through,
and the whole chain after it ran on a contract missing 20–40% of its content, returning a review that **looked
flawless**.

> 🔥 `delivered()` (§2c) exists **precisely to answer this question**, and `resume()` bypassed it by filtering
> off a **LIST** instead of asking the **RECEIPT**. → the rule *"a correct decision + a wrong premise = a time
> bomb."*

**Rule:** a task is only skipped when its **receipt says it actually delivered.** Everything else gets **RUN AGAIN**
— even if it already ran once and left a half-finished file. Rerunning overwrites its own exact
`artifacts/<plan>/<task>/` ⇒ **no orphan-cleanup mechanism needed**, since the per-task folder is already atomic.

⚠ And `run()` must suppress **four** branches meant only for a real planning pass, whenever `resumePlan` is
present: the *"planning now"* line · `savePlan` (**overwrites the original plan, destroying the forensic
record**) · `plan.created` · the *"Splitting this into N jobs"* sentence. Letting these four leak out is four
symptoms that would have the very developer reading the log misdiagnose it as "an unexplained anomaly."

#### Two fences for the REMAINING door: the user typing again instead of `/resume`

Closing `/resume` only shuts one door. The type-it-again path goes `route → plan()` → the planner reads the results
manifest → picks up the stale file as `inputs`. `validate` lets it through (the file exists on disk), `missingInputs`
lets it through (the folder exists).

| | |
|---|---|
| **The invite** | *"Type **/resume** and I'll finish it up"* instead of *"Keep messaging…"*. One sentence, and it substantially shifts which door the user falls through — cheaper than every technical fence behind it |
| **The manifest** | **hides the PATH, keeps the NUMBER** — the planner has no string to copy into `inputs`, but can still answer *"how far did the last job get?"* |
| **The hard gate** | `Scheduler.interruptedInputs` — read BACKWARD from the path (`artifacts/<plan>/<task>/…` already declares both ids) → look up the receipt → not yet `delivered` → block at launch |

> **RULE: A LABEL IS A REQUEST FOR THE MODEL TO COMPLY; DROP IT AND THERE'S NOTHING LEFT TO COMPLY WITH.** The
> `INCOMPLETE` label pasted onto each file it read was very convincing, and the hd4 run still broke identically.
> Removed.
>
> ⚠ Hiding the path alone is NOT enough — the model can **guess** it, since paths follow a pattern, and a user
> pasting `@` slips through too. A hard gate is the only thing that doesn't need anyone's cooperation.

#### A report must not contradict the step strip right next to it

`finish` appends one **code-built** line whenever a job self-reports `done` while `record.steps` still has an
unfinished step. A user caught the job *"1. ○ Split the contract"* sitting right next to *"Contract 4 is done!"*
— information that was ALREADY on screen, but **two surfaces contradicting each other is worse than either one
being missing**, and the wrong one is the one written in plain language, which is easier to trust.

Only appended on a `done` job: `stopped`/`failed` already speak for themselves, adding more there is just noise
right when the user is already frustrated.

> Same family as *"nothing spent yet"* (§2, fix 2) and *"exported to PDF for you"* (§SPEC-library 4.2): **the
> model asserts something that data ALREADY IN OUR HANDS disproves. Three times in two days ⇒ a failure CLASS,
> not three bad rolls** — and that class is only blocked by code cross-checking, never by a prompt reminder.

#### 2e. 🔴 `tasks/` MOVED INTO `.state/` — blocked by STRUCTURE, not by discipline (08/20)

A worker's `cwd` is the **entire office folder**. Measured at `P-260820-2219-5ltb`: `nguoi-gop` wandered off,
Globbed the entire directory tree, and **READ** `P-…plan.json` and `P-…log.jsonl`. The log file contains **other
tasks' receipts** ⇒ a back door around the protocol *"Receipt has an 800-token ceiling — the Assistant never
reads a worker transcript."* It could also read the whole DAG.

The fix reuses a fact already measured (§SPEC-library 2.1): **`Grep`/`Glob` do not descend into folders starting
with a dot.** This is the **inverse** of an existing rule:

| | |
|---|---|
| `library/`, `artifacts/`, `knowledge/` | agents **MUST** find these → must **not** be hidden |
| `.state/tasks/` (plan · log · receipt) | agents **MUST NOT** wander into these → **must** be hidden |

No `canUseTool` needed (already measured 08/19: never fires for read-only tools), no denylist, nothing anyone
has to remember.

> ⚠ **NOT a security wall** — `Read` with an explicit path still opens it. It blocks exactly the real path in:
> **wandering off and stumbling onto it.**

Includes a migration `migrateTasksIntoState()`, run for **every** office in every company, idempotent, called
twice inside `migrateIfNeeded` (the second pass catches an office whose `tasks/` had just been migrated to v0's
old layout). Skip the migration and the fix only applies to offices created after today — while old offices are
exactly where real plans and logs exist to wander into.

#### 2b. 🔴 The FIFTH gate — `inputs` must actually exist RIGHT BEFORE LAUNCH (08/20)

`validate` runs at **planning time**, when the previous step's file hasn't been produced yet, so it's forced to
let every "will exist" path through. By launch time every earlier step has finished, and the question can finally
be answered. The same check, at the **right moment** — `Scheduler.missingInputs`, 0 tokens.

Measured at `P-260820-2219-5ltb`: without this gate, an employee gets handed a dead path and **GOES LOOKING** —
`nguoi-soi` 6 turns (5 Glob calls), `nguoi-gop` 9 tool turns before hitting `max_turns`. Both arrived at exactly
what the system already knew for free.

Comes with a `CORE_PROMPT` rule: *a failed first read → return `blocked` IMMEDIATELY*, because `inputs` was
verified a moment earlier ⇒ a broken path here is a system error, not a misfiled document, and going hunting for
a substitute burns the whole budget for nothing.

#### 2c. 🔴 BLOCKING PROPAGATES BY *"WAS IT DELIVERED"*, NOT BY `failed` (08/20)

`Scheduler.run` only does `failed.add` when `receipt.status === 'failed'`. A task returning **`blocked`** goes
into `receipts` and **not** into `failed` ⇒ it counts as *"dependency already done."*

> Measured: T-01 returned `blocked` at **22:20:21** (couldn't read the `.docx`, produced no file) and T-02
> launched at **22:20:21 — the same second.** Then T-03. Both went looking for files the system already knew for
> certain didn't exist. T-02 even correctly self-diagnosed it, **at the user's expense**: *"the whole artifacts
> folder is empty."*

⚠ Keeping `blocked` ≠ `failed` is **CORRECT and must stay** — the log has to distinguish *"the system broke"* from
*"waiting on you."* The mistake was using `failed` as the **propagation signal**. The correct, observable signal
is: **did it actually deliver.**

`delivered(receipt)` + `unmetDeps(task, receipts, failed)` — two **pure** functions, deliberately: this is the
most expensive rule in `run()`, and `run()` calls `runWorker` directly, so no test suite could ever reach it if
left inline. The explanation splits two ideas apart (*"the previous step hasn't finished running"* ≠ *"the previous
step produced no file"*) because the two cases call for very different actions.

#### 2d. 🔴 EVERY THROW PATH MUST CARRY `usage` (08/20)

`RunError` gains a `usage` field. Without it, **money vanishes from the ledger**: measured `nguoi-gop` making 9
tool calls over 29 seconds before hitting `max_turns`, and `usage.jsonl` recording **0 turns, $0.**

`worker.ts` threw bare-handed on all three branches (`max_turns` · `error_max_budget_usd` · everything else)
while the branch for being **interrupted** right above it already did this correctly (`stoppedReceipt(…, usage, …)`).
Now wrapped in **one place** inside `catch` — a future new throw branch is automatically correct, nobody has to
remember.

| Path | Before | After |
|---|---|---|
| `max_turns` · `budget` · `other` | receipt hardcoded `0` | `errorReceipt` uses `err.usage` |
| `rate_limit` (returns the task to the queue, reruns **from scratch**) | thrown away entirely | added into `RunResult.wasted` |

> This hits exactly the sorest spot: **`max_turns` is, by definition, the MOST EXPENSIVE failure mode** — it runs
> all the way to the turn ceiling. And `rate_limit` is the case that **charges twice for one task**, precisely
> the case the user most needs to see the number for.

**3 — `missingOutputs`: an employee reports `done` but a promised file isn't on disk → downgrade to `failed` and
say so.** This is the worst kind of lie: the user reads *"done,"* opens the file, and there's nothing there. The
*"Results saved at"* block (`whereBlock`) only lists what's **real**, so it **goes silent exactly when it most
needs to speak up** — this gate fills exactly that gap. Only checked for tasks that **self-report done**: work
that's blocked or interrupted midway having no file is normal and already self-explained.

The INTERRUPTED branch was already handled by `stoppedReceipt`; the branch that **runs to completion normally**
had no check at all before 08/19.

**4 — `worthLearning`: only ask for a lesson when a job has a TRACE of trouble.** See §4.3 for why this gate has
to be code, not a prompt instruction.

### ONE job = ONE `plan_id`, generated at EXACTLY ONE PLACE (fix 08/20)

`Office.run()` calls `newPlanId()` for the job record; `Assistant.plan()` **also** calls `newPlanId()` for its
own. Two ids for one job. `office.ts` overwrote `plan.plan_id` with the record's id — but by then `artifactScoper`
had **already framed** every path using the other id.

Measured on the user's machine 08/20: `artifacts/P-260820-0302-ov9e/` existed on disk while `tasks/index.json`
only knew about `P-260820-0301-aajq`. The results folder carried an **orphaned** id — no plan, no log file with
that name. The user even saw **both ids in the same result message.**

Fix: `Assistant.plan(request, planId)` **receives** the id, doesn't generate its own. No `newPlanId()` outside
`Office.run()`.

> **Lesson:** overwriting an identifier **after** it's already been used to build something else is a very quiet
> way to create two truths. An id must be generated in one place and **flow downward** — not generated twice and
> reconciled afterward.

### Receipt filenames must carry `plan_id` — CHECKED EVERYWHERE, not just where reported

`saveReceipt` names files `${task_id}.receipt.json`. `T-01` is a sequence number within a plan and every plan
starts at 1 → **every job overwrites the same file.** Measured 08/20: office `ban-dia-hoa` ran three jobs,
`tasks/` was left with exactly one `T-01.receipt.json` from the last job. Tokens, turn counts, `reads`, `looped`,
`lessons` from the first two jobs **were gone entirely.**

This is **exactly** the bug already fixed for `artifacts/` on 08/19 (`SPEC-artifacts.md` §2) — same cause, same
consequence class, only a different folder. That time, `tasks/` was overlooked, even though `savePlan` right
next to it had already been using `plan_id` from the start.

Fix: `${plan_id}.${task_id}.receipt.json`. No migration — no code reads a receipt back, it's a forensic record
for the user to open and inspect.

> **Lesson:** when fixing an *"id isn't unique"* bug, check **every** place that uses that id as a filename —
> not just the spot the user just complained about. A half-fix looks identical to a full fix until the day
> someone counts the files.

### The PLANNING step is allowed to ASK BACK (settled 08/20)

Before 08/20, `plan()` had **exactly one exit**: a complete plan. Right next to it, `route()` has `intent: 'ask'`
— the Assistant **is allowed** to ask back during conversation, but not allowed to ask while planning.

So when the planner genuinely needed a piece of information, it **had no valid way to say so**: it fell out of
the protocol, returned prose, and the system called that fallout *"a parse error"* and blamed how the user phrased
things.

Verbatim, measured, from `.state/plan-failure.log`:

> *"Could you tell me where the existing Vietnamese translation of doc-2.md and doc-3.md is located? I don't see
> that file in the library or in the list of existing artifacts."*

A completely reasonable question, turned by the system into an error. *(Note *"or in the list of existing
artifacts"* — **no such list exists.** The model was acting out the folder map in the prompt, the exact trap from
§4.7.)*

**Fix:** `PlanOutputSchema` becomes `union([{ask}, {steps,tasks}])`.

- `union`, not `discriminatedUnion`: the two branches share no key, and forcing the model to fill in a `kind`
  field is one more place for it to forget. The plan branch requires at least 1 element in `tasks`, so the two
  branches can never both match.
- The question goes straight to the chat box with role `assistant`, exactly like an `intent: 'ask'` turn — to the
  user this **is** the same kind of thing, they don't need to know which step it came from. **0 employee tokens.**
- The job ends at `status: 'blocked'`, **not** `failed`. `failed` = tried and broke; `blocked` = never tried. The
  log must distinguish *"the system did something wrong"* from *"the system is waiting on me."* The panel colors
  it `warn`, not `danger` — coloring a job red just because the Assistant asked a question **teaches the user to
  fear questions.**

Two accompanying prompt rules, the first of which fixes exactly what frustrated the user:

> **Never tell a human to go check a file that's inside the office.** If you can't see it, say you can't see it
> — they are not your eyes.

> Only ask when the answer **would change the plan.** If a reasonable default exists, pick it and state it in
> `constraints` — a round-trip question costs a human more than a slightly-off default.

> **Lesson:** the results manifest (`SPEC-artifacts.md` §2.4) fixes exactly **one case**. This door fixes **the
> whole class** — there will always be a time the planner needs to ask, and we can't predict when. When a protocol
> allows only **one** shape of answer, everything outside that shape surfaces as a system error, even when it's
> correct behavior.

### `/clear` must MERGE, not REWRITE — and merging has two directions (fix 08/20)

`compactMemory()` → `addAssistantMemory(…, assistantMemoryIds())` makes the new record `supersedes` **the entire**
set of currently-live memory records, then `dropSuperseded()` **deletes them outright.** But the compaction prompt
only says *"write down what you need to remember"* and **says nothing** about the MEMORY block already sitting in
context.

> ⇒ Every `/clear` becomes a **summary of the summary.** Whatever the most recent session didn't mention, the
> model doesn't rewrite, and it **vanishes forever, silently.** This is `supersedes` used backwards: it was built
> to replace **one stale entry**, not to replace **the entire memory with the newest slice.**

The model **has already seen** the MEMORY block — the only thing missing is a sentence telling it to keep it. But
*"keep it"* alone is **half the rule**, and the other half is exactly as dangerous as the first: an old decision
that was later reversed gets copied forward just because it's sitting in old memory, leaving the store with **two
contradicting lines** and no way to know which one wins — exactly what `supersedes` blocks at the node layer,
recurring at the line layer.

**Three rules, in order:**

1. **Copy forward** every old entry still correct. Dropping something because *"this session didn't mention it"*
   loses a decision the user already settled.
2. An entry the latest session **changed or reversed** → write **exactly one line** with the new decision, drop
   the old one entirely. New wins, old disappears.
3. **One line per topic.** If it would read *"previously X, now Y,"* keep only Y.

> **A keep-forward rule with no overwrite rule paired to it just trades one failure for another:** lost memory →
> contradictory memory. The second is harder to spot and worse — it doesn't silently vanish, it **silently lies.**

### The manifest answers "WHAT CAN BE DELIVERED," not "HOW MANY" (settled 08/20)

The question raised: *"if the user asks how many files there are, should the hidden worker's `cwd` be used instead
of the manifest (which could be wrong)?"* — **No.** Three reasons:

1. **That's a question for CODE.** `office.readablePaths()` returns the real list, read from disk, uncapped.
   Spending an LLM turn to count files is paying money to buy uncertainty — the rule *"if we can observe it,
   don't ask the model."*
2. **It doesn't fix the actual worry.** If the manifest is wrong, fix the manifest — don't add a second path that
   sometimes disagrees with it. **Two sources of truth disagreeing is worse than one source that's incomplete.**
3. **A routing rule's cost is permanent, its benefit is a rare case.** Adding *"asking about files → use lookup"*
   adds one more boundary the model must get right on every single message, forever, for a question that only
   comes up occasionally.

**Re-measured, the manifest wasn't as wrong as assumed:** the document library is **never truncated**
(`library.manifest()` lists everything) ⇒ *"how many documents are there"* was already correct. Only the **results
manifest** is capped (`MANIFEST_PLANS = 5` plus a token ceiling) ⇒ that's the only place counting was wrong. Fixed
with **code, not a prompt instruction**: a line `Total: N file(s) across M job(s) — these numbers are exact`,
placed right after the heading and **never truncated by the token ceiling** (the truncation loop only trims the
job list). ~27 tokens.

**Still needed, the manifest.** Its job isn't answering *"how many"* — it's letting the **planner write `inputs`
without a round-trip question**, exactly the 08/19 gap. `lookup` can't replace it: the planner needs the path
**while planning**, while `lookup` runs **instead of** planning.

### The log CANNOT be deleted — filter at the display layer (settled 08/20)

The user asked for a delete button (*"sometimes stuff's broken, zombies get on my nerves"*) and then **blocked
themselves**: *"actually, keep the log — I want to be able to trace things, cost and all that."* That self-block
was correct, and here's why:

> The job log is the **ONLY** thing linking a `plan_id` in `logs/usage.jsonl` to a **readable name.** Delete a
> record and the money still sits in the ledger with no one knowing whose job it was — and **"(unknown)" in the
> cost ledger now carries TWO meanings** (a v0-era record, or one the user deleted), meaning it's no longer
> explainable. The rule *"the cost ledger must never say anything wrong"* stops holding the moment a delete button
> exists.

So there's no `DELETE /plans`, and that's a decision, not an oversight.

But the annoyance is real — measured on the user's machine: `ban-dia-hoa` has **18 jobs, 8 of them not `done`**
(4 `failed` · 3 `stopped` · 1 `blocked`). Two fixes, each addressing a different half:

**1. ZOMBIE jobs → fix them, don't delete them.** A record stuck at `planning`/`running` after the daemon died is
a **lying log**: it claims "still running" for a job nobody is doing anything with. `PlanStore.healStale()` runs
once when `Office` is constructed — at that point the process has just started, so no job can genuinely be
running — and downgrades them to `failed` with a sentence stating *what happened + what to do next.* Pays down
part of **technical debt item #2**.

- ⚠ Preserve the index's ORDER: **don't use `upsert`**, since it bumps a record to the top. Healing three zombies
  with `upsert` would scramble the timeline — exactly what the log exists to preserve. Has a test.
- ⚠ Idempotent: restarting the daemon repeatedly doesn't append a second explanation. Has a test.

**2. GENUINELY FAILED jobs → filter, don't hide.** A `failed` line is **accurate history** — it's what answers
*"did this work or not."* So it stays on disk, and the user gets a **"Completed only"** toggle.

> This is exactly the case §5e's rule addresses: **splitting at the DISPLAY layer is cheap, splitting at the
> STORAGE layer is expensive — when unsure, split at the cheap layer first.** The filter delivers exactly the
> relief a Delete button promised, with 0 lines of history lost.

Three gates on the filter: default is **ALL** (opening the log with the broken parts pre-hidden is lying by
omission — the user must CHOOSE to see less) · the filter bar **only appears when there's something to filter** ·
the filter's empty state says clearly *"data still exists, it's just filtered"* with a way back, distinct from
the log's own empty state.

### `lookup` — HIDDEN WORKER: `route()`'s fourth door (settled 08/20)

**A measured case:** *"what's the gist of doc-2.md"* → one planning turn + one full-prefix worker (**floor
~13,200 tokens**) just to read a file and recite it back. The user named it exactly: *"the Assistant seems kind
of dumb here… and this flow probably isn't cost-optimal."*

Three paths, and **only the third is cheap on both axes**:

| | costs IMMEDIATELY | costs FOREVER |
|---|---|---|
| DAG (plan + worker) | plan + **floor 13,200 tokens** | 0 |
| Assistant grepping itself | ~0 | **file content × EVERY turn after** |
| **`lookup`** | 1 one-shot, tiny prefix | **0** |

The second column is the final answer to *"why can't the Assistant grep,"* asked for the third time now (§4.7).

> ⚠ **Correcting an earlier argument that was rightly rejected.** The earlier reasoning was *"the Assistant will
> remember stale content and it'll win over the document."* The user pushed back: the knowledge store **already**
> has a gate (only records methods), and the chat session **already** contains whatever detail the Assistant
> happens to mention — so grep doesn't create a NEW failure class. **Correct.** That argument was one of degree,
> not a law, and it was overstated.
>
> The argument that still holds is different and stronger: **the Assistant's context is the ONE thing that never
> gets thrown away.** A worker reads once, then dies; the Assistant reads once, then pays `cache_read` on **every**
> turn until `/clear`. A 34-page PDF stripped to text is 10–20K tokens sitting there forever. The 800-token Receipt
> ceiling exists precisely because of this.

**Not made an MCP tool** as the original `concierge` sketch proposed: MCP breaks the prompt cache on resume
(~36K/turn) while `route()` resumes on **every** message. As an **intent**, same idea, 0 cache cost.

#### Three properties, all three enforced by CODE

| | mechanism | fact or promise |
|---|---|---|
| Forgets after reading | `persistSession: false` | **fact** — the whole reason it exists |
| Can't write a file | `tools: ['Read','Grep','Glob']` | **fact** — `tools` is a HARD LIMIT (§5d) |
| Scope of what it can read | no gate exists | **promise** — §4.7, none of three mechanisms ever fired |

The third row is stated plainly because of the rule *"never build a fake fence"*: it's no worse than an ordinary
employee (they also run with `cwd` = the office folder), and differs from the Assistant in one respect — what it
reads **dies with the same call.** What could be enforced by mechanism already is: `paths` proposed by the model
must go through `pickReadable`, checked against the library + the Results panel, **read live from disk right at
that moment.**

#### `paths` requires ≥ 1 — no "let the agent go wander" case

The Assistant already holds the library manifest and the results manifest in its prefix; that **is** exactly what
those two manifests are for. Unable to name a file → the right door is `ask`. The schema blocks it, so a `lookup`
missing `paths` falls to `garbled` and the user sees no JSON block at all.

If the model proposes three files and two of them are real, **read those two** and **say** what's missing —
different from `resolveFileRefs`, where a broken path is a user error and the whole message has to stop. Here the
model guessed wrong; making the user retype for that would punish the wrong party.

#### NO experience, NO charter, NO skills, NO roster

Not cut for cheapness — **three independent reasons pointing the same direction**:

1. **Experience only records METHOD.** This agent has exactly one method and it never changes. The only thing it
   *could* learn is **document content** — exactly the node type already banned (`fact` was removed from the enum
   08/19). Giving it a knowledge store builds a machine dedicated to producing banned goods.
2. `worthLearning` already returns `false` for a clean run, and a lookup turn is **always structurally clean**: no
   file to break, no dependency to get stuck on.
3. A hidden agent's hidden knowledge store the user can't see is **an undebuggable hole** — exactly the concern
   the user raised. **There's nothing hidden here, because there's nothing at all.**

#### The door-splitting rule: *"would someone else's work produce a different result?"*

The question is **not** *"who's capable of doing this"* — a translator is fully capable of reading and summarizing
a document, and the user proved this on a real machine.

| | | |
|---|---|---|
| Translate · write · review · advise | **would differ** — depends on terminology, tone, charter, i.e. depends on `role` | `task` |
| Recite what a document says | **wouldn't differ** — anyone reading it gets the same thing | `lookup` |
| Needs to become a FILE to keep | — | `task`, always |

And this also answers the case *"a user creates a read-only employee and then watches the Assistant do everything
itself"*: that employee exists because they bring a **point of view** (contract review, figure-checking), so any
question needing that viewpoint still goes to them under the rule above. `lookup` only takes the part where a role
**adds nothing** — a part that never belonged to anyone in the first place.

#### Model tier: the Assistant's own, not `models.planner`

To the user this **is** the Assistant answering; it just doesn't keep the document in its head. The knob that
already controls that quality exists (`assistant.model_tier`), and **no third knob gets invented.** `models.planner`
is the wrong axis: it's set to `deep` so the work-breakdown step thinks carefully, and using it here would run
Opus for every *"what does this file say"* question.

#### No Plan spawned — and the status line is the other half of the truth

`lookup` **doesn't** spawn a `PlanRecord`, no *"Splitting this into 1 job"* message, no step on the diagram. The
answer is emitted with `role: 'assistant'`.

A message saying *"splitting this into 1 job to read the file"* for a lookup question costs **two messages just to
announce that an answer is coming** — exactly the "dumb" feeling this door exists to remove. But answering with no
further context makes the user think the Assistant just knew, when a real file-reading turn actually ran. The
user named it exactly: **half the truth.**

The other half costs **0 tokens**: a status line, `Reading doc-2.md…`, while the hidden worker runs. The user sees
*that a read is happening* and *which file* — that's it. No plan, no step, no leftover message sitting in the chat
stream; the line disappears on its own once the answer arrives.

Enforced with a **status flag** (`Office.reading`), same shape as `clearing` and the same reasoning: *work in
progress is STATE, not a notification.* Deliberately **no** `hold_ms` — putting a timer on it would recreate the
exact `/clear` flicker-then-freeze bug. Wrapped in `try/finally` so it never gets stuck on screen if the read turn
throws or gets cut by `/stop`.

#### Three gaps measured on the first real run (08/20) — all three "half-fixes"

**1. `ASSISTANT_CORE` doesn't know the hidden worker exists.** The `lookup` door was added to `route()`'s prompt
(the per-turn block), but `ASSISTANT_CORE` (the cached system block) still said *"You never read or write project
files yourself"* / *"**You have no tools**."* Two blocks contradicting each other, and the model followed the
bigger one — it answered *"I can't open a file myself to check."* It **wasn't wrong**, it was obeying.

> **Add a capability, and every prompt block describing capabilities must be checked.** Same shape as
> `planFailed`/`route` and `tools`/`allowedTools` — three times in one week.

**2. "Not in the manifest" got read as "doesn't exist."** `MANIFEST_PLANS = 5`, so an older job is intentionally
left off the list. But `pickReadable` checks against **the entire** `artifacts.list()`, and `resolveFileRefs`
already verifies a path the user typed **before** it reaches the model — this case would have already worked, the
prompt just forbade trying. The rule *"a path the human typed is exact"* already existed but sat under **Planning
output**, so it never covered `lookup`. Promoted to a top-level heading, **"Paths you may use,"** and the manifest's
footer line now says clearly that older entries **still exist.**

**3. Stale manifest — two of four doors don't refresh the prefix.** Adding a document and deleting a result call
straight into the store from the `server/` layer, bypassing `Office`. Worst case: **upload a document and ask
about it right away**, and the Assistant says it sees no such file. Fixed by **closing off the side doors**
(`Office.addDocument` · `Office.removeArtifact`), not by adding two scattered extra calls.

> **A rule only holds at the layer it was written for.** *"Reads and writes must share one function"* is absolutely
> true within `core/`, and the `server/` layer reached straight past it without anyone noticing.

#### The cost, stated upfront

- ~120 permanent tokens in the `route` prefix (door description + the door-splitting rule).
- A `lookup` answer **doesn't enter the Assistant's session** — ask afterward *"why did you say doc-2 was about a
  dashboard"* and it won't remember. This is exactly the tradeoff already accepted for `deliver: reply`, and worth
  revisiting if the goal leans more toward being a **second brain**.
- Misrouting risk remains. Exactly one hard block exists: `lookup` **can't write a file**, so the worst wrong route
  produces an answer instead of a document — recoverable with one more message, the same shape as `deliver`'s
  tie-breaking rule right below.

### `deliver`'s tie-breaking rule: when in doubt, choose `reply` (settled 08/20)

`default_deliver` removes the uncertainty of the **common** case in a given office. It does **not** remove the
remaining case, and the remaining case is real:

> Same office, **Localization**: *"translate doc-4"* is `file`, *"give me 10 terms"* is `reply`. **No single
> default is right for both.**

Measured on the user's machine: they asked for 10 terms, got back a **file path** for ten lines of text, and had
to retype *"5 terms, just answer, no file"* to read the answer in chat. **Two full runs for one question.**

So classification still has to happen every time, and the fix lives in a **tie-breaking rule**, not the default:

> **Wrong about `reply` is recoverable, wrong about `file` is not.** A `reply` task **still writes a file** — a
> wrong call there costs a few extra lines in chat, that's all. A `file` task when the person wanted an answer
> costs them **one more request**: asking again for the exact thing just finished, and paying for the whole job a
> second time.

Same shape as "deletion always has two levels, the safe one comes first": **the recoverable choice is the
default.** This rule costs ~35 permanent prefix tokens; it pays for itself the first time it blocks a
double-run.

**Two mechanical consequences:**

- `officeTemplate` **writes `default_deliver: file` explicitly**, with a comment. Before 08/20, no template, no
  route API, no screen wrote this field at all ⇒ every office silently fell back to the schema's `'file'`. **A knob
  nobody can turn isn't a knob** — exactly the *"axis got hardcoded so it became invisible"* failure class that
  `deliver` was invented to fix. The YAML comment is **0 tokens** (never reaches the model), so that's the right
  place to explain it.
- **NO new UI toggle for `default_deliver`.** A toggle that's only right half the time makes the user do the
  classifier's job, and they'll flip it back and forth forever. This is exactly where the rule *"if uncertainty
  repeats on every turn, don't resolve it with a UI toggle"* applies to **the very default born from that rule.**

### `decideRoute` — RAW MODEL TEXT NEVER GOES STRAIGHT TO THE CHAT BOX (fix 08/20)

The fallback branch of `route()` used to be one line:

```ts
const value = parsed ?? { intent: 'chat', say: text.trim() };   // ← raw
```

**Measured on the user's machine.** They asked *"give me 10 English terms?"* → the Assistant asked back *"from
which document?"* → they replied *"uhh, any, random is fine"* → **the chat box spat out an entire `json` block**
with `steps`/`tasks`/`deps`/`deliver`.

Three things happened at once, and only the first is easy to notice:

1. The flower-shop owner saw a chunk of code.
2. `RouteSchema` didn't match ⇒ `intent` became `chat` ⇒ **`run()` was never called.** Nobody did the work they
   just asked for. No error line anywhere.
3. That plan was **correct** — assigned to `nguoi-dich`, `inputs` pointed at the right glossary file from the old
   job, `deliver: reply`. It was **thrown in the trash after already being paid for.**

**Why the model did this — and why it's NOT the model's fault.** `ASSISTANT_CORE` carries a *"Planning output"*
section in the prefix of **every** turn: `route()` and `plan()` deliberately share one prefix to share one cache
entry (§4.5). Right after an `ask` turn, *"anything's fine"* reads exactly like the signal *"go ahead and plan
it."* This is the **consequence of an already-settled tradeoff**, not a bad model — so fix it with **mechanism**,
not one more prompt instruction: instructions cost tokens permanently, are only suggestions, and the 08/19 rule
already says *don't tell the model not to do something.*

We can't stop it from writing out a plan. But we're **already holding** a valid, already-paid-for plan — so the
right move is to **USE IT.**

`decideRoute(text)` — a **pure, tested function**, tries four doors in order:

| | matches | outcome |
|---|---|---|
| 1 | `RouteSchema` | the main door, the ordinary case |
| 2 | `PlanTasksSchema` | **salvage it** → `Office.run(request, draft)`, **skip the `plan()` call entirely** |
| 3 | `PlanAskSchema` | `{"ask":…}` is a valid planning-stage question → `intent: 'ask'` |
| 4 | anything else | **whether there's JSON at all** is the deciding question |

**Step 4's rule is deliberately narrow: plain prose still displays as before.** If the model forgets to wrap JSON
but still says a readable sentence to a human, show that sentence rather than swallowing it. What gets blocked is
**JSON specifically** — a JSON block is never a sentence meant for a user, it's a protocol message that wandered
through the wrong door. Distinguished with `JSON.parse`, i.e. by **fact**, not by pattern-matching text.

Step 4's case gets a sentence written by **CODE** (*"I answered in the wrong format so that last reply couldn't be
used — that's on me, not how you phrased it"*), and the raw text goes verbatim into `.state/route-failure.log`.
**Deliberately does NOT quote the model**, unlike `planFailed`: there, what it said was prose — readable, and
informative in itself. Here, it's JSON.

**Two gates on the rescue door:**

- **Does NOT fall back to `intent: 'task'` using the user's exact last message**, tempting as that sounds simpler:
  `plan()` runs as a one-shot query **with no conversational memory.** *"Anything, random is fine"* on its own
  gives the planner nothing to split into work — we'd pay for another turn to get back a broken job. **Must
  salvage, not re-call.**
- `PlanRecord.request` is derived from the tasks' `goal` (`requestOf`), not from what the user typed: that
  sentence is correct in the moment but meaningless read back in the log three days later. `goal` was already
  required in exactly the right shape — *"one clear sentence, in the user's own words."*

`buildPlan` was **split out of `Assistant.plan()`** because it now has two callers. The four rules it holds
(framing the input · framing the output · dropping unassigned steps · applying the office's `deliver` default) have
each already had a bug, and living inside an `async` method that calls the model meant **no test suite could ever
reach them.** Two code copies of the same transformation will drift — and a comment saying *"⚠ must match the other
one"* is not a mechanism.

> **General lesson:** a fallback branch like `?? { say: text }` is **a back door letting the model's raw text out
> to the user's face.** Here it existed from day one, looked completely harmless, and only surfaced the one time
> the model wandered through the wrong door. Anywhere code takes the model's returned string and treats it as a
> sentence for a human, that code must be able to answer: *if it returns something in a different shape than
> promised, what does the user actually see?*

### `worthLearning` — don't tell the model not to do it, don't give it the chance to

The earlier version **always** included a `lessons` field on every report, with an instruction: *"a smooth run
isn't a lesson."* Ask a model *"what did you learn?"* and it will almost always produce a sentence anyway — **the
instruction doesn't stop it.**

**A real case, 08/19.** A job that ran completely smoothly (1 task, `done`, nothing blocked, a receipt that never
asked back) produced the node `k/shared/60-percent-discount-product-…`. Its content was a **DISTORTED** paraphrase
of a line in the user's own document: the policy said *"over 50%, no returns,"* the node recorded *"a 60% discount
is **usually** non-returnable"* — wrong threshold, plus the word "usually" that the policy never had — and it sat
in every employee's prefix until it expired.

The Assistant wrote that sentence having **never read the document at all**: it only saw ONE `say` line from an
employee. That's **hearsay**, not a lesson.

Threshold: only ask when something **observable** happened, not something inferred — `status !== 'done'`, or
`blocked_on`, or a receipt that had to ask back (`reasked`).

> ⚠ **DELIBERATELY NOT using TURN COUNT as a signal, tempting as it is.**
>
> The first draft added `usage.turns >= 8`, and the test suite disproved it immediately: the 08/19 case ran in
> exactly **9 turns** — meaning that condition **let through exactly the case it was meant to block.**
>
> The deeper reason: *turn count is a property of the MODEL and the task's difficulty*, measured as haiku taking
> 10 turns vs. sonnet taking 4 turns for **the identical job**. Using it as a "something went wrong" signal means
> every office running `eco` is treated as perpetually struggling, and `deep` is **never** treated as struggling
> at all.

An accepted, known tradeoff: **the knowledge store grows noticeably slower.** The user's real experience still has
a path into the store, and it's a **better** one: tell the Assistant, then `/clear` → a MEMORY node, confidence 0.9
(§4.6).

The final gate lives in code, not the prompt: not asked means **not accepted**, even if the model volunteers
`lessons` on its own.

#### The FIFTH signal: HUMAN friction (settled 08/20)

The four signals above all read from `receipts` — meaning they measure **how hard it was for the machine.** There's
a whole class of case where all four stay silent: **the machine ran perfectly, while the human struggled.**

**A real case, 08/20.** The user needed **four turns** to get the work handed off successfully (§2.4 of
`SPEC-artifacts.md` tells the full story), and had to invent the architectural fix themselves. The job that
followed: 2 tasks, both `done`, clean receipts → **0 lessons.**

The office had just learned something genuinely valuable — *"here, if you want to build on an old result, you have
to say explicitly who it's being handed to for rework"* — and **threw it away**, because it lived in no receipt at
all.

`friction` = **the number of planning attempts that failed to produce a runnable plan**, since the last successful
job. Increments in three places: the planner asks back, the planner throws, `validate` blocks it. Resets to 0 the
moment a real job actually starts.

- Still an **observable fact**, counted by code, 0 tokens, model-independent — the same rule that already ruled out
  `usage.turns`.
- ⚠ **Does NOT count the number of messages the user typed**, tempting as that sounds: people send multiple messages
  for lots of reasons — adding a thought, changing their mind, or just splitting it across two lines. Only **a
  planning attempt that failed to produce a plan** is solid evidence the system made the user repeat themselves.
- Lives in **RAM**, not on disk: it only means something within one continuous conversational thread. Restarting
  the daemon means the user left and came back — the previous session's friction teaches nothing about this one.
- ⚠ **Does NOT** increment in the final `catch` of `run()`: that spot also catches *"no employee is on duty yet"*
  and *"the office is busy"* — **configuration** issues, not a case of the two sides failing to understand each
  other.

The question asked of the Assistant in a friction case is **entirely different**, and that difference is the whole
point. A technical-trouble case asks *"what trap got tripped"*; a friction case has a clean machine run, so asking
that question returns *"nothing"* — true, and useless. What's worth learning here is on the human side:

> *"The user had to rephrase this N times before the work could be handed off. Which of their sentences finally
> made it work, and next time a similar request comes in, what should be asked upfront?"*

This is a **new class of lesson**: experience about **how to hand off work in this particular office**, not about
the content of the work itself. It's the only class learnable directly from the user, **without asking them a
single question.**

> **Lesson:** when a mechanism "goes silent exactly when it should speak up," check where it's **measuring from.**
> `worthLearning` wasn't broken — it just never once looked toward the human side.

### Known dead code: `Assistant.chat()`

`assistant.ts` has `chat(message)` — called from nowhere. The real path is `route()` already returning `say` for
both `chat` and `ask`, and `handleUserBatch` emitting that sentence directly.

**And that's correct design, not an oversight:** calling `chat()` after `route()` would be **two model turns for a
single greeting**, on the busiest path in the whole product. Written down here so nobody "reconnects it to be
thorough" later — this function should be **deleted**, not wired back in.

### Where the result lives — derived from TOOLS ACTUALLY CALLED, not from what the model says

The Assistant's wrap-up sentence ends with a block assembled by code:

```
Result saved at:
  company/offices/content/artifacts/T-01/warm-intro.md
Also delivered externally via: notion
A command ran on this machine — the result may live outside the office folder.
```

**Three generations, and why the first two weren't enough:**

| | Source | Broke where |
|---|---|---|
| 1 | the model mentioning it in its own wrap-up sentence | **random** — nothing guarantees it, so it gets dropped |
| 2 | `receipt.artifacts` | still the model **TELLING** it (can be made up), and can **only describe FILES** |
| 3 | `receipt.landed` — derived from `tool_use` observed in the stream | ✅ |

Generation 2 broke in a subtle spot: not every result is a file. A result could land in Notion, Google Sheets, a
database. For those cases `artifacts` is empty, this block goes **silent**, and we're back to depending on the
model's own wording — the exact thing just removed.

The fix is **not** a prompt edit. `worker.ts` already reads every `tool_use` block to build the *"what's happening
now"* line, then throws it away after assembling the sentence. **A tool call is an observed fact, not something
told to us.** Keeping it is the whole fix — 0 tokens, not one prompt word touched.

Three destination types, and **the confidence of the wording matches the confidence of the knowledge**:

| `kind` | What's known | How it's said |
|---|---|---|
| `file` | checked with `existsSync` → certain | *"Result saved at"* + the full path |
| `external` | know for certain which server was called, can't verify how it stored it | *"Also delivered externally via: notion"* |
| `command` | **destination of the data is unknown** | say plainly that it's unknown |

`command` is the remaining uncertain part. It's **fenced off and labeled**, not hidden — the rest of the detail
lives in the employee's own `say`, and that is exactly `say`'s job, not something requiring a new instruction.

Two mandatory details:
- **A path outside the office folder must not be declared as a result** — but it **still has to be RECORDED**
  under an `outside` label. See the block right below: the earlier version dropped it outright, and that was a gap.
- **The path is relative to the working directory**, not the office folder. `artifacts/T-01/x.md` alone is
  technically correct and useless to someone looking for it for the first time.

> A pattern worth generalizing: **whatever we can OBSERVE, don't ask the model.** Asking the model is paying money
> to trade for uncertainty — even when it's right nine times out of ten.

### 🔴 A FAILED TURN DOES NOT DELETE WHAT IT ALREADY MANAGED TO WRITE (fix 08/21)

**Case `P-260821-1827-m78h`:** a worker finished writing a 4,474-byte results table at 18:30:01 — right location,
all 56/56 groups, **not a single number wrong.** Nine seconds later, `error_max_budget_usd` fired. The user read:

> *"This job was blocked for hitting the maximum cost for analysis-standard, **with no result produced.** Want me
> to retry with analysis-eco, or raise the cost cap?"*

Both options meant paying twice for something already sitting on disk. And this is the **most expensive** kind of
break for a non-technical user: they trust the system 100%, so **nobody double-checks a sentence they believe.**
A technical user might open the folder to look; the flower-shop owner just hits "retry."

**Root cause:** `worker.ts` throws, `observed()` gets left behind inside the function, `scheduler.errorReceipt`
hardcodes `landed: []`.

**The bitterest part:** `stoppedReceipt` had already correctly described this exact bug before — *"the earlier
version returned `artifacts: []` — i.e. lying that nothing was on disk"* — and fixed it for **exactly one of
four** throw branches. Right next to it, `usage` had been wrapped into a `fail()` helper with a note to self,
*"a future new throw branch will then automatically be correct."* Two fields, the same `catch` block, the same
reasoning — one field made it to all four branches, the other made it to one.

> **A FIX AT ONE LAYER MUST WALK EVERY PATH OF THAT LAYER.** Fix one branch, and the next question is always:
> *"which other branch has this same shape?"* Here there were four: finished · interrupted · hit the ceiling ·
> unknown error.

Three gates after the fix:

1. `RunError.observed` — a twin to `RunError.usage`, wrapped in **the same `fail()`** function so a future new
   throw branch is automatically correct.
2. `filesOnDisk()` / `straysOnDisk()` are **exported and imported shared**, never copy-pasted into `scheduler.ts`.
   Four copies is four chances for one to be forgotten (the 08/19 rule).
3. **"What was actually written" comes BEFORE "why it broke."** Burying *"but the file's there"* at the end of a
   sentence that opens with *"blocked"* means the user has already hit retry before reading that far. Sentence
   ordering here is a **product decision**, not presentation.

⚠ **The cost ceiling is NOT what needs fixing in this case.** It fired at exactly the right time on exactly the
right job. Raising `max_usd` to infinity removes the exact brake that just worked, to fix a symptom that actually
lives in the **report.** When an error message makes a user want to disable a safety mechanism, suspect the error
message first.

### 🔴 DELIVERED IN FULL ⇒ NOT `failed` (user-settled 08/21)

The fix above only corrected **the wording**; the status label still read `failed`. Three consecutive runs after
that (`m78h` · `i9h2` · `yap2`) all wrote complete files — `i9h2` **exactly 56/56 groups, not one number wrong**
— and all three still showed the word **broken** on screen.

Counted across the whole day of 08/21: **five runs, five complete files on disk, exactly one ✅ label** — and that
one ✅ landed on `d6v9`, the run that actually got 45/51 groups wrong.

> The real cost isn't an ugly label. The system **cried wolf four times and stayed silent the one time it should
> have cried.** A four-out-of-five wrong alarm teaches the user to tune it out — and then the real fire goes
> unheard. For a non-technical user trusting the system completely, that's the product's entire reserve of trust,
> and trust is what decides whether the user base can grow.

**Rule, derived from disk, not from how the loop happened to die:**

| Promised (`brief.outputs`) | On disk | Status |
|---|---|---|
| n files | **all n present** | **`done`** + one soft note about the cost ceiling |
| n files | m < n | `blocked` — partial, needs a human decision |
| n files | 0 | `failed` |

Applied across **all four** exit paths (`budget` · `max_turns` · `stopped` · unknown error).

**Three accompanying gates, missing any one leaves a hole:**

1. **`blocked_on` must be CLEARED when delivery was complete**, not just the `status`. `worthLearning` reads
   `!!blocked_on` as an independent signal — changing only `status` still fires the ask-for-a-lesson gate and
   produces junk nodes again. The other half of the same fix.
2. **The message is a NOTE, not a warning.** The job already has a result, the user doesn't need to do anything:
   *"Done, written to X. One small note: this cost more than your budget cap for <role>, so if similar work comes
   up again, consider raising the cap a bit."* Doesn't go through the knowledge store — this is a human matter,
   and humans read the chat box.
3. **We do NOT claim the content is correct.** Still only declares what `existsSync` actually knows, exactly like
   the success path. The risk of a file getting cut mid-write is real, but it's **identical** to today's success
   path — not one new lie added.

### The report line fires EXACTLY ONCE

`master.message` carries the report sentence. `plan.finished` is a **structural** event (status + cost) and
**deliberately has no `say`** — the sole exception to the invariant "every user-facing event has a say," because
it isn't user-facing. `office.state` on completion only states status (`Done.`), it doesn't repeat the report.

Three spots carrying the same sentence would make the log show three identical lines sitting next to each other.

### The default prompt must not carry a message addressed to the USER

The first version of `skills/assistant.md` opened with *"This is the part YOU write, feel free to clear it"* — a
sentence addressed to a person, sitting inside the prompt sent to the model, in the cache prefix of **every
conversation turn.** The model can't edit the file, so that sentence is noise, taxed forever.

Same bug in the default charter. Now the default charter has full frontmatter and an **empty body** → the charter
block disappears from the prompt entirely. The explanation "you can edit this" lives in the layered-prompt table
on the UI, where the user actually reads it and where it costs 0 tokens.

Also: the charter is a **knowledge node**, so it carries YAML frontmatter. Reading the raw file would stuff ~40
tokens of metadata (`id`, `type`, `confidence`…) into every employee's prefix. Only the body is taken.

#### But "empty" must not render as the literal string `(empty)`

Taking the instructions out of the *file* was right; leaving a blank box for the user to guess at violates the
"Stability" criterion (every empty state must be a **deliberately designed** screen). Three spots, three different
roles — don't mix them up:

| | Where | Tokens |
|---|---|---|
| **default content** | in the file → enters the prompt | costs money **forever** → only ever holds **real content**, or is empty |
| **the note** | on the UI, always shown | 0 — states *what this block is, who reads it* |
| **placeholder text** | on the UI, only when empty | 0 — a **real example**, never actually saved |

Rule: *default content is real content, not an instruction. Instructions go in the `note`, examples go in the
`placeholder`.*

Which is why the default charter stays **empty** — we don't know what the user's office actually does, and making
up an intro sentence would be lying at their expense. The Assistant's default skills, by contrast, **have real
content** (tone, the ask-back rule), because that content is true of every office.

### Color by agent

Every agent — **including the Assistant** — gets a stable color, hashed from the role id. Hashed, not stored:
adding or removing someone doesn't change anyone else's color, and there's no config file to fall out of sync.

---

## 7. Migration from v0

A v0 company has `roles/` directly under `company/`. On open, the daemon auto-migrates it into `offices/default/`
and keeps everything inside intact, **once, automatically, with a printed notice.**

No prompting the user. This is a folder-shape change we caused, not their decision to make.

---

## 8. API

Every endpoint operating on an office carries `officeId` in the path. Company-level endpoints do not.

```
GET    /api/company                    name, office list, models (tier → model)
PATCH  /api/company                    { models }  → change model at the COMPANY level  (§4.5)
POST   /api/office                     { name, template? }  → create, including its Assistant
DELETE /api/office/:id                 DELETE the whole folder FOR GOOD — unrecoverable (§3.1)

GET    /api/office/:id                 status + currently running plan
PATCH  /api/office/:id                 { name?, assistant_tier?, archived? }
                                       rename (§3) · Assistant model tier (§4.5) · archive (§3.1)
PATCH  /api/office/:id/agent/:role     { archived }  → archive/restore an employee (§5.1)
DELETE /api/office/:id/agent/:role     DELETE the yaml file FOR GOOD (experience notebook is kept)
GET    /api/office/:id/archived        employees currently archived
GET    /api/office/:id/canvas          shape + metadata for drawing
PUT    /api/office/:id/canvas          write the shape
POST   /api/office/:id/agent           add an employee
DELETE /api/office/:id/agent/:role     remove from the diagram (KEEPS the file by default)
POST   /api/office/:id/say             the ONE entry point for everything the user types
POST   /api/office/:id/stop
GET    /api/office/:id/knowledge       browse the store, 0 tokens
GET    /api/office/:id/plans           job history
GET    /api/office/:id/plans/:planId   log for exactly one job
GET    /api/office/:id/prompt/:who     layered prompt — who = assistant | <role>

GET    /api/events                     company-wide SSE, every event carries an office
GET    /api/cost                       cost, split by office
```

`GET /api/office/:id/prompt/:who` is the embodiment of "core is viewable": returns each layer with an `editable`
flag, so the UI can show the core layer read-only rather than hiding it.

---

## 9. UI — see `SPEC-ui.md`

Settled 08/15: **React + Vite + Tailwind v4 + shadcn/ui**, the daemon serves `web/dist` statically. The canvas is
still hand-written SVG, dragging a node updates via `ref` rather than `setState` every frame — the "Performance"
criterion demands 60fps even while the company is running.

Chat, log, and overview all move into a collapsible left sidebar.

---

## 10. Three batches

| Batch | Content | Done when |
|---|---|---|
| **1 — foundation** | `offices/`, auto-migration, clean starting point, two-layer Assistant prompt, Plan lifecycle, new API | the company runs end-to-end, old UI still usable |
| **2 — interface** | React/Vite/Tailwind/shadcn, sidebar, new canvas, per-plan log + color, icons | everything doable through the new UI |
| **3 — product** | error boundaries, recovery paths, empty states, 60fps, virtualized log | the four criteria in §1 become a checkable list |
