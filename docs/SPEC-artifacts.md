# SPEC — Results: the files an employee produces

> Locked in 19/08/2026. Implementation: `src/core/artifacts.ts` · `web/src/components/panels/ArtifactsPanel.tsx`

## 0. One sentence

**Results are the third column, and the three columns differ at exactly one
question: WHO PUTS THE FILE THERE?**

| | who writes | what the user can do | does it enter the prefix |
|---|---|---|---|
| **Document library** | THE USER | add · delete | no (though the file listing does) |
| **Results** | THE EMPLOYEE | delete | **never** |
| **Knowledge base** | the AGENT extracts it itself | edit · delete | **yes** — paid every turn |

These three concepts are easy to confuse, so they sit right next to each other in
the sidebar and each one states what it is at the bottom of its drawer. That's the
cheapest way to prevent confusion: **0 tokens**, because it lives entirely in the UI.

---

## 1. THIS IS NOT A SECOND DOCUMENT LIBRARY

This is the single most important constraint of the whole feature, and it came
from the user:

> *"We shouldn't let a worker read an artifact — that adds complexity. If a user
> wants to improve on it, they should hand it over themselves, don't turn the
> system into a junk pile."*

**Enforcement:** there is no `POST`. There is no *"send this to an employee"*
button. There is no field for picking an artifact as input. If someone wants to
reuse a result, they **hand it over themselves** — paste the content into the chat
box, or drop the file into the document library.

### ⚠ Distinguishing this from what STILL RUNS and is unchanged

Within **one** multi-step plan, a later task reads an earlier task's artifact via
`inputs` (`ASSISTANT_CORE` already has an example, `artifacts/T-00/notes.md`, and a
*write → review* plan runs down exactly that path). That's a **wire inside one
job**, not a store you pull things out of.

> **The line: an artifact is a WIRE inside a plan, not a STORE to load back from.**

Why this line is worth holding: two stores with the same meaning means two
lifecycle rules, two places to clean up, and a user forced to guess where a file
should go. The second one is always the one nobody cleans up.

---

## 2. Directory layout — and the data-loss bug it fixes

```
offices/<id>/artifacts/
└─ <plan_id>/            ← NEW 19/08
   └─ <task_id>/
      └─ result.md
```

### `T-01` is a sequence number WITHIN one plan, and every plan starts at 1

So `artifacts/T-01/` is a directory **shared across every run**. Measured on a
user's machine: the `content` office had **eight** plans, all eight landing in
`artifacts/T-01/` — nine files jumbled into one place, nothing telling you which
file belongs to which run.

Nothing had been lost so far only because the filenames happened to differ.
**Re-running a request identical to a previous one silently overwrites the old
result — no prompt, no notice** — exactly the *"loses the user's work, silently"*
failure class in SESSIONS_MEMORY §8.

`Scheduler.validate` only blocks two tasks **within the same plan** from
overwriting each other; it knows nothing about earlier plans.

### Framed by CODE, not by instructing the model

`artifactScoper(planId, taskIds)` rewrites the path after the model returns the
plan. The model never even knows the `plan_id`. Asking the model to invent a
unique path itself would mean paying to buy back exactly the indeterminacy we
just removed.

⚠ **Only rewrite paths pointing at a task WITHIN THIS SAME PLAN.** The user is
allowed to say *"fix yesterday's file"*, and in that case `inputs` points at an
artifact from an old plan — rewriting it would just point the employee at a file
that doesn't exist.

## 2.6 🔴 RULE: RESULTS ALWAYS LAND INSIDE THE OFFICE DIRECTORY (locked in by the user, 21/08)

> *"Why did this end up sitting at the same level as the office — files always have
> to be generated INSIDE the office, this is a rule."*

**A real case triggered this — `P-260821-1818-yydi`.** An employee called `Write`
with a path pointing two levels up. A 4,236-byte file landed in
`company/artifacts/<plan_id>/T-01/`, **at the same level as `offices/`** — a spot no
office can see, no Results panel lists, and `office rm --delete-files` never
touches.

### Why `cwd` is NOT a wall

Three things look like they're blocking this, and none of them are:

| | Blocks what | Doesn't block what |
|---|---|---|
| `cwd: office.dir` | where **relative** paths anchor | **absolute** paths — `Write` accepts them freely |
| `tools` / `allowedTools` | **which tool** can be used | **where** it writes |
| `artifactScoper` | paths inside the **plan** | a path the model types itself **at runtime** |

`artifactScoper` writes the right `outputs` into the brief. But a brief is an
*instruction*, and an instruction is not a mechanism — the model is still free to
type a different path into `Write`. Exactly the 16/08 rule: **an invariant is only
real once source code enforces it.** This rule had been in the spec from the
start, as the directory layout in §2, reading very convincingly, and it had
**never once run**.

### Enforcement: a `PreToolUse` hook, not `canUseTool`

```ts
hooks: { PreToolUse: [{ matcher: 'Write|Edit|NotebookEdit', hooks: [officeJail(office.dir)] }] }
```

⚠ **Do not put this rule in `canUseTool`.** Measured 19/08: a tool listed in
`allowedTools` is auto-approved and **SKIPS `canUseTool` entirely** — and `Write`
sits in every role's `allowedTools`. Writing the rule there is writing a rule that
never runs, i.e. spawning exactly the kind of **PROMISE** that debt item 0c exists
to go hunt down. `PreToolUse` runs before the permission layer, so `allowedTools`
can't shield it.

### `deny` with directions, NOT `updatedInput`

`updatedInput` could bend the path back into the office, and that's exactly the
**"silently rewrite"** cell in debt item 0c's failure-mode table — more dangerous
than an outright refusal because nobody sees anything happen. We `deny`, and the
refusal message **states the correct path to use**: the model writes to the right
place on the very next turn, the log carries a trace, and we don't burn a turn on
an empty refusal.

### The `outside` label: blocking is one thing, DECLARING it is another

`landingOf` used to `catch { return undefined }` when `safeJoin` threw.
`undefined` means *"no destination at all"* — but the truth was *"there IS a
destination, and it's outside what we allow"*. Two entirely different statements.

The cost of blending those two: the assistant would say *"I don't see the file on
disk — tell me to redo this"* while the result sat intact two directories away.
The user **pays twice for something they already had**, and a stray file gets left
behind that nobody cleans up.

`Landing.kind` now has `outside`, and it's used in exactly one place: deciding
which sentence to say when a promised file is missing (`office.ts →
strayFilesOf`). It **never** goes into `whereBlock` — *"your result is here"* is
only ever said about a location the system can actually manage.

> The hook blocks the case **from now on**; the `outside` label rescues the case
> that **already happened**, plus every future case that slips through the net.
> Both are needed — one is the door, the other is the light.

### 🔴 THE ONE EXCEPTION, AND IT MUST BE DECLARED: `Bash` (written 22/08)

`matcher: 'Write|Edit|NotebookEdit'` **doesn't match `Bash`**. And it can't: the
`officeJail` hook works because it reads `tool_input.file_path` — a **named
field**. A shell command has no such field; the path is buried inside a command
string, next to variables, next to pipes, next to `$()`. Blocking it would require
**parsing shell syntax** to find every place that could write, across three
operating systems, and any spot missed is still a rule that claims to be running.

⇒ The correct statement of the §2.6 rule is:

> **Results always land inside the office directory — EXCEPT when a role has `Bash`
> turned on.**

Three consequences, and all three have been implemented:

| | |
|---|---|
| `Bash` must be **visible and switchable**, never implicit | `BUILTIN_TOOLS` doesn't include it (so it's a VISIBLE line in `roles/<id>.yaml`); its own switch sits in the detail panel (`Inspector.tsx` §`BashSwitch`) |
| Wherever it gets turned on must state the **actual consequence**, not a soft "please consider" | *"can read and write anywhere on your machine"* + *"the one exception to the rule…"* |
| We still **declare** that a command ran, even without knowing where it wrote | `landingOf` → `{ kind: 'command' }`; `describeCall` → *"running a command"* |

> If this exception isn't written down, §2.6 reads like an absolute invariant when
> it's actually a **conditional** one — and whoever trusts it will trust it wrong
> at exactly the one case where the consequence is the whole machine. Same family
> as the `tools` ≠ `allowedTools` lesson: a rule that's correctly written, reads
> convincingly, and is wrong in a gap nobody looks at.
>
> 🔴 **And as of 22/08 that condition is ON BY DEFAULT** (locked in by the user —
> `SPEC-tools-approval.md` §5). So the accurate statement of §2.6 today is:
> *"results stay in the office, for whichever employees you've turned `Bash` off
> for."* That's a much weaker rule than the one from 21/08, and **its weakness
> must be read correctly** — stop citing §2.6 as a guarantee. In exchange:
> `tools: [Bash]` is a VISIBLE line in the role file, its switch sits right in the
> detail panel, and the employee-creation dialog states it outright. The exception
> is **declared**, not **hidden**.
>
> **Still unpaid:** the `write_external` approval gate (`SPEC-tools-approval.md`
> §8) is a second blocking layer that's been designed but **not built**. Until it
> exists, the `Bash` switch is the only thing standing between the user and their
> own machine.

## 2.2 IN and OUT go through TWO DIFFERENT rules (locked in 20/08)

Before 20/08, both `inputs` and `outputs` shared `artifactScoper`. Merging the two
caused a bug measured on a user's machine.

**The bug.** The user typed: *"Translate doc-1.md… **Save it to
`artifacts/vi/doc-1.md`**"*. The result landed at `artifacts/P-…/T-01/doc-1.md` —
the `vi/` directory **vanished, with no explanation at all**. The cause was a rule
sentence in `CORE_PROMPT` (*"every task must write at least one file under
`artifacts/<task_id>/`"*), so the planner dropped the tail on its own to comply.
And the other branch was also wrong: if the planner *did* write
`artifacts/vi/doc-1.md` exactly, `artifactScoper` would see that `vi` isn't a task
id and **leave it untouched** — the file falls outside the frame case by case,
losing the §2 guarantee entirely.

**Two different questions, so two functions:**

| | question | answer |
|---|---|---|
| `artifactScoper` (INPUT) | *does this path point at a task in this very plan?* | no → **leave it alone** |
| `outputScoper` (OUTPUT) | *where does this task write?* | **always** `artifacts/<plan_id>/<task_id>/` + the tail |

```
artifacts/vi/doc-1.md   →  artifacts/<plan>/<task>/vi/doc-1.md
artifacts/T-01/x.md     →  artifacts/<plan>/T-01/x.md
report.md                →  artifacts/<plan>/<task>/report.md
```

`outputScoper` is **idempotent** (calling it again doesn't wrap another layer on),
strips `..`/`.` at the first layer (`safeJoin` is still the final gate), and an
empty `outputs` falls back to `result.md` rather than ever returning a path that
points at a directory.

**The user keeps the directory structure they wanted; the system keeps the
no-overwrite guarantee.** This mirrors §2.1: when both sides have a point, don't
pick a side — find a shape that holds both.

### And it has to be STATED, exactly once

`whereBlock` prints the real path of every file written. As of 20/08 it adds one
line — **only when** the path goes deeper than `artifacts/<plan>/<task>/`, i.e.
only when the user actually set their own directory:

```
(each run gets its own directory so the next run doesn't overwrite this one)
```

That's exactly the moment they're looking at their own path getting wrapped in two
extra layers, and it's the **only** moment worth saying anything. Pasting this
line onto every case turns an explanation into noise. 0 tokens — built by code
straight from the path already in hand.

### The prompt has to change too, and why both are needed

Code guarantees the **frame**; the prompt decides the **tail** — code can't guess
that the user wants a `vi/` subdirectory if the planner never writes it into
`outputs`. So `CORE_PROMPT` gains two sentences: preserve any directory the user
set (*inside* `artifacts/<task_id>/`, not replacing it), and *"if the user asks
for a separate file, write a separate file"* — see §2.3.

The cost: the planner's prefix changes → **the prompt cache gets rewritten once.**
Cheap, and already anticipated.

## 2.3 Output shape has to be STABLE across runs (locked in 20/08)

Measured 20/08: three runs of **the exact same request** (translate a document +
record the terminology), three different shapes:

| run | `outputs` the planner declared |
|---|---|
| doc-1 | `doc-1.md` **+ `terminology.md`** |
| doc-2 | just `doc-2.md`, terminology stuffed at the end of the file |
| doc-3 | just `doc-3.md`, terminology stuffed at the end of the file |

No error fired. But the user was translating five documents **precisely to
compare them against each other**, and they'd just lost that ability: run 1 has
the table in its own file, runs 2–3 bury it inside the translation.

**Can't be fixed with code** — output shape is something the planner decides from
a natural-language sentence. Two places to intervene, both already done:

- `CORE_PROMPT`: *"when the user asks for a separate file, write a separate
  file… the same request must produce the same shape every time it runs"*.
- `TEST-WALKTHROUGH.md` exercise 5: the sample sentence states outright *"write
  the terminology table to a SEPARATE file"*, with a step checking output shape.

⚠ **This is remaining indeterminacy, not closed indeterminacy.** To be certain,
either the user has to spell it out, or the office needs a `charter.md` that
states the rule.

## 2.4 BREAKING the "artifacts are invisible" rule — a manifest for the Assistant (locked in 20/08)

> This is a case of **reversing a decision already recorded in §1**. Recorded in
> full because the reason for reversing matters more than the conclusion.

### The bug that forced a second look

The user: *"doc-2, doc-3 are missing the terminology file"*. Four back-and-forths:

1. The assistant told them to **go check the path** — making the user do work the
   machine could finish in 1ms, and phrasing it as if they might be the one
   mistaken
2. User: *"the files haven't shown up"*
3. The planning stage **flat-out died** — it asked *"where's the Vietnamese
   translation file located?"*, and that question wasn't a valid response shape
   so it surfaced as an error (see `SPEC-offices.md` §6)
4. The user had to **invent the architectural fix themselves**: *"then you have to
   tell the translator to go create it, don't you?"*

Then the case ran — and **its result was WRONG**:

| `Widget` | |
|---|---|
| the word `doc-2.md`'s translation actually used | `Widget` — kept as-is |
| what the newly-generated terminology table recorded | **`Widget` translated as a brand-new Vietnamese word for "utility"** |
| number of times that new Vietnamese word appears in the translation | **0** |

Because `inputs` pointed at `library/files/doc-2.md` — **the original English
source**. The translator had never seen the translation, so when told to *"record
the terminology and how it WAS translated"* it just **chose all over again**. A
document faithfully recording choices that were never actually made, and looking
very professional while doing it. Worse still: `doc-2.md` **already had** a
`## Terminology notes` section at the end, so now there were **two contradicting
tables** — and no one in the conversation knew, because no one could see into the
Results drawer.

### The old decision was RIGHT about the risk, WRONG about the scope

§1 guarded exactly the thing worth guarding: don't turn the Results drawer into a
second store the user has to manage, and don't let old results drift into a new
job's context. But it picked the **crudest** guard available — **total
invisibility** — and the price was blocking the single most natural action in the
whole product: *"keep going on what you just finished."*

**The thing that makes the fix much cheaper than it looks:**

> **The employee CAN already read an artifact.** A worker already has
> `Read`/`Grep`/`Glob` with `cwd` set to the office directory — the moment a plan
> writes the path into `inputs`, it can open it, right now, today.

So what's missing **isn't read access** — it's exactly one thing: **the planner
doesn't know the path to write into `inputs`.** This is a gap in **information at
planning time**, not a gap in permissions — so the fix only needs to patch that
one spot.

### Five decisions against noise

| # | Decision | Why |
|---|---|---|
| 1 | **Filename only**, no content | `Read` already handles content, and only when `inputs` names it |
| 2 | Group by **RUN**, with one `request` line (trimmed to just **30 tokens**) | `P-260820-0314-rab5/T-01/doc-2.md` tells the model nothing; *"run: translate doc-2 into Vietnamese"* tells it everything. `briefText`'s 200-token cap belongs to the **log**, not the prefix — measured for real: one full `request` eats up more than half the whole table's budget |
| 3 | Only the **5** most recent runs + one line counting the rest | Not 1: a run the user refers back to isn't always the most recent one — a real 20/08 case needed a result from **25 minutes and two runs earlier** |
| 4 | A hard cap `budgets.artifacts_manifest_tokens` = **600**, trimmed from the **oldest** run | Truncating the raw block with `truncateToTokens` would leave a chopped-off path — and a chopped-off path is **worse than none at all**: the model will still plug it into `inputs` |
| 5 | 🔒 **Assistant ONLY. Never enters an employee's prefix.** | Employees get paths via `inputs`. Stuffing the manifest into their prefix would mean paying on **every** turn for **every** employee to buy something they don't use |

Measured on real data (4 runs, 6 files): **192 tokens**.

### The cost, stated plainly

This block changes after **every run** → the assistant's prefix gets rewritten
every run. Minimized by **placement**: put it **last** in the chain of blocks in
`buildAssistantPrompt`. Prompt caching is a **prefix** cache, so every block above
it still hits cache and only the tail gets rewritten. Estimated ~$0.002/run —
**an estimate, not yet measured.**

Syncing (`refreshAssistantContext`) runs **outside** the `status === 'done'` gate:
a `failed`/`stopped` run may still have written several files before it broke, and
those are exactly the files the user will bring up next (*"finish the rest of
it"*).

---

## 2.8 `ArtifactStore`'s two caps — and why they have to differ (fixed 02/09)

The user's question: *"the results list keeps growing — should it auto-prune after
15 days?"* The answer is **no**, and the reason is that the manifest fed into the
prefix **doesn't actually grow** in the first place (§2.4: 5 runs, 600 tokens).
But looking into it turned up a real bug.

### The bug: sorting AFTER truncating

```ts
walk(...)                      // stops dead at file #500
return out.sort(by mtime)      // sorts AFTER truncating → too late to save it
```

What falls off isn't the oldest file — it's **whatever `readdir` hadn't reached
yet**. Run directories are named `P-260820-0314-…` — **date first, oldest
first** — so on NTFS (where `readdir` walks in name order) what disappears is
exactly the **most recent results**, precisely what the user just made and is
looking for. On ext4 (hashed names) it's a random cluster. No error message
anywhere.

This dragged down two other spots that also call `list()`:

| spot | consequence |
|---|---|
| `removeAll()` | *"clear everything"* deletes 500, reports `500`, the UI says success — 200 files are still sitting there |
| `readablePaths()` | `@path` to an old file returns *"not found"*, right after the manifest just told the model *"a path from an older job is valid"* |

### The fix: split apart three things that had been merged into one

| | cap | used where |
|---|---|---|
| `MAX_SCAN` | **20,000** — purely so a pathological directory can't hang the daemon; hitting it sets `capped: true`, **never silent** | every scan |
| `MAX_PANEL_FILES` | **500** — truncated **after sorting by `mtime`**, returned along with the real `total` | payload sent to the UI |
| *(no cap)* | | `readablePaths` · `artifactManifest` · `removeAll` |

The sort key is **`mtime`**, not creation date — locked in by the user, and not
just for semantic reasons: `birthtime` on Linux exists or doesn't depending on the
filesystem (Node fills it in with `ctime` or the 1970 epoch), so a cap built on it
would behave differently across the three operating systems. Ties on `mtime` (one
run writes three files within the same millisecond) are broken by path, so the
order doesn't shift depending on `readdir`.

`removeAll()` re-scans **until clean** (a 10-round cap), and the UI reports
whatever's left over instead of claiming success.

### Scanning (cheap) split from `stat` (expensive)

Measured on the user's machine, Windows, 02/09:

| file count | `scan()` (with `stat`) | `filePaths()` (`readdir` only) |
|---|---|---|
| 500 | 54 ms | 7 ms |
| 2,000 | 142 ms | 8 ms |
| 5,000 | 415 ms | 17 ms |
| 20,000 | 1,425 ms | 23 ms |

Almost all the cost sits in `statSync`, and `bytes`/`mtime` are exactly what the
**two hottest call sites don't use**: `readablePaths()` runs on **every message**,
`removeAll()` only needs paths. So they now go through `filePaths()`. `scan()`
(with `stat`) only runs on **events** — `refreshAssistantContext` and opening the
panel — where 142 ms sits next to a model call measured in seconds.

⇒ The hottest path drops from ~51 ms to ~7 ms **and** stops being wrong, in the
same fix.

⚠ **Artifacts created before the dual-`plan_id` fix (20/08) carry orphaned ids and
so CANNOT be looked up by run name** — the manifest shows *"(an old job, no longer
named in the record)"*. A graceful degradation, unfixable, and only touches old
data.

### Has to be added to `describePrompt` in the SAME fix

The §5e lesson (`SPEC-offices.md`): a correct prompt paired with a wrong "View
layered prompt" table makes that table useless, because its entire point is being
trustworthy. **Every new block in `buildAssistantPrompt` needs a matching entry in
`describePrompt`.**

## 2.5 CLICKABLE paths in the chat box — and the guard against the model making things up (locked in 20/08)

The user: *"`company/offices/business-localization/artifacts/P-…/T-01/vi/doc-2-terminology.md`
— this makes the user go dig through folders on their machine, kind of
inconvenient"*. Fair: the product had just gone to the trouble of building a
preview window, only to send the user back out to a file explorer.

Alongside a **legitimately placed** worry: *"it would be pretty disastrous if this
turned out to be the worker making things up"*.

### Why this case is SAFE — and it was safe before this fix, not because of it

The path inside the *"Result saved to"* block was **never the model's own
words**. It already passes through **three gates**:

| gate | where | blocks what |
|---|---|---|
| derived from the tool **THAT WAS ACTUALLY CALLED** (`receipt.landed`) | `worker.ts → landingOf` | doesn't use `receipt.artifacts` — that field is something the model **declares**, and it can make it up |
| `safeJoin` | `landingOf` | a path escaping the office directory |
| `existsSync` | `whereBlock` | the model claiming to have written a file that doesn't actually exist |

### The second source: the task's own declared `outputs` (05/09)

`landingOf` recognises `Write` · `Edit` · `NotebookEdit` and nothing else. A worker that builds its file with a
shell one-liner lands `kind: 'command'`, and one that writes through an arm lands `kind: 'external'` — in both
cases the file is **real and completely invisible to the interface**. Measured: `P-260905-0100-zquw` T-01 built a
109-row table with PowerShell; the run reported no output at all.

So `whereBlock` takes a second source — the paths in `plan.tasks[].outputs` **that exist on disk** (`outputStatus`,
the same walk that computes `missingOutputs`; one loop, two lists, so the two answers cannot drift). This does not
weaken the doctrine: those paths are built by `outputScoper`, **not** written by the model in prose, and they pass
the same `safeJoin` + `existsSync` gates. The rule is unchanged — *only a path the code itself put there is
clickable* — it just now has two code-owned sources instead of one.

Both are merged by `worker.ts → filesOnDisk`, which already answered exactly this question on four scheduler exit
paths. It is imported, never re-implemented.

### Mechanism: data, NOT regex on text

`master.message` gains `files?: string[]` — paths computed from the office
directory, **only ever** filled in by `whereBlock`.

> ⛔ **NEVER scan for paths inside `say` with a regex.** Part of that chat message
> is written by the model (an employee's `answer` on a `deliver: reply` task).
> Scanning it with regex would mean: an employee makes up a very plausible-looking
> path, the UI turns it into a clickable link, the user clicks it trusting it.
> That's **lending the UI's credibility to a sentence the model guessed at**, and
> the user has no way to tell the difference.
>
> Rule, in short: **only a path CODE ITSELF placed there gets to be clickable.**

Text and data are joined by **matching string suffixes**, not regex: `say` prints
the path with a `company/offices/<id>/` prefix (for anyone opening a file
explorer), `files` carries the path computed from the office directory. Two
different reference frames for two different audiences — but both ends are built
by **the same function**, so they can't drift apart. `whereBlock` returns exactly
`shown` (the array already printed as text), not `files` itself: any mismatch
would mean a clickable entry in the UI with no matching line, or an unclickable
line sitting next to a clickable one.

### The bridge (Telegram) doesn't change a single character

`files` is **accompanying metadata**, not a replacement for the text. A surface
that doesn't read it just sees `say` exactly as it reads today — the path is
still there, just not clickable. Same event, two outcomes, following the same
rule as *"each surface picks its own way to react"* (like `hold_ms` in
`SPEC-offices.md` §4.6).

### The click flow

`actions.revealArtifact(path)` → `panel: 'artifacts'` + sets the `revealArtifact`
field → `ArtifactsPanel` receives it, looks it up in the **already-loaded**
listing, opens the preview window.

- Runs through the store, on the same pattern as `pendingDocs`: the whole preview
  flow (loading content, three format groups, the 2MB cap, the download button)
  lives in **exactly one place**.
- `showPanel`, not `openPanel`: clicking a second path while the panel is closed
  would be a trap.
- The effect keys off the **request field**, not its value — clicking the same
  path twice still has to reopen it.
- Not found (the file was deleted after the message was sent) is **announced with
  a toast**. A click that produces nothing tells the user only that "it's
  broken," and they click again.
- The request field clears **immediately** even on a mismatch: leaving it set
  means the next time the Results panel opens for an unrelated reason, it pops
  open a window nobody asked for.

## 2.1 `plan_id` must be READABLE — and filenames stay UNTOUCHED (locked in 19/08)

The user's example: `artifacts/P-mt08w0t8-iu50/T-01/answer.md` — the middle
string **says nothing to a human**. The original proposal: prepend a
`yyMMddhhmmss` prefix to the **filename**, and drop the `P-…` directory.

**Both of those branches were rejected, but the underlying problem is real.**

### Drop the `<plan_id>/` directory: NO

It carries **four** jobs, not one: `artifactScoper` (framing),
`Scheduler.linkDeps` (detecting duplicate paths to wire up `deps`),
`Scheduler.validate` (blocking two tasks from writing to the same place), and
grouping in the panel. Dropping it would **recreate exactly the §2 bug** — eight
plans all landing in `artifacts/T-01/`.

### Timestamp into the filename: NO

`newPlanId()` is `P-${Date.now().toString(36)}-${rand4}`. Meaning
**`mt08w0t8` ALREADY IS a timestamp** — base36 of `Date.now()`, just in a form a
human can't read.

Adding a date/time to the filename too means the reader **sees the time twice**,
and the filename **stops describing the content** — which is the one job a
filename actually has. And beyond that, a timestamp taken at *write* time doesn't
even work: T-01's `outputs` and T-02's `inputs` are written by the model in two
separate spots inside the same JSON block, and they need to match each other, so
every identifier **has to be generated at PLANNING time** — which is exactly what
`plan_id` already does.

> **Filenames stay as they are, named however.** The only constraint stays the
> same as before: two tasks **within the same plan** may not write the same path
> (`validate` blocks it). Across plans, the `<plan_id>/` directory already handles
> it.

### The actual problem: it's unreadable. Two fixes, kept separate.

**a. Change the FORMAT of `plan_id` — not the mechanism.**

```
old   P-mt08w0t8-iu50
new   P-260819-1430-iu50
```

Every guarantee is preserved: lexical sort order still matches time order, the
`logFile` regex (`^[A-Za-z0-9_-]{1,64}$`) accepts it fine, and the collision
probability within the same minute is `1/36⁴ ≈ 1/1,680,000`.

**No migration needed, and the reason is structural, not luck: `plan_id` IS NOT
PARSED ANYWHERE.** It's only a key and a path segment. Old plans keep their old
names, new plans get new names, and both kinds coexist indefinitely.

**b. Have the panel show the REAL job name.**

This is the fix that actually matters, and it **touches nothing about
`plan_id`**. The panel had already deliberately chosen **never to show the plan
code** — but what it showed instead was a fallback the comment in
`ArtifactsPanel.tsx` had already confessed to: *"No job name yet, so say the date
and time."* The job name **already exists**, in `tasks/index.json`
(`PlanRecord.request`) — nobody had wired it up yet.

| | before | after |
|---|---|---|
| group title | `Run on 19/08 15:10` | `Answer the customer's warranty policy question…` |
| source | most recent `mtime` in the group | `PlanStore.get(plan_id).request` |

Two mandatory details:

- **`request` is a sentence the Assistant REWRITES** (`route()` returns *"rewrite
  the request into one clear sentence, with enough context"*), so it can run
  **long**. Truncate to one line, keep the full text in a `title` tooltip. If a
  group's `request` can't be looked up (the plan fell out of `index.json` — a
  200-record cap), it **falls back to the old date/time label** rather than
  showing an empty string.
- **The time still shows, in FULL FORM WITH SECONDS** (`08/19/2026 15:10:42`),
  right-aligned, `tabular-nums`. The group title is the anchor that tells apart
  *"which run"* — re-running **the exact same request** within one day means the
  **seconds are the only thing** that can tell the two groups apart. The
  individual file line inside keeps today's shortened `when()` format: it's
  already sitting inside a known group, no need to repeat the date.

Use the **most recent `mtime` in the group**, not `PlanRecord.ended_at`: that's an
**observable fact on disk** (following the rule *"if it's OBSERVABLE, don't ask,
don't infer"* — `SPEC-offices.md` §6), and it survives even if `index.json` is
lost.

### No migration

Old data is demo data, and the user decided to just delete it. That decision cuts
out the hardest part of this change. The panel can still **read** files sitting
directly under `artifacts/<task_id>/` and groups them into an *"Older results"*
bucket — no one loses their screen over an old layout.

---

## 3. Preview: three groups, and the line is a product decision

| group | extensions | how it's shown |
|---|---|---|
| **text** | `md` `txt` `csv` `tsv` `json` `yaml` `yml` `html` `xml` `log` | `fetch`, then rendered ourselves. md/txt shown directly, csv becomes a **table**, everything else in `<pre>` |
| **the browser handles it** | `png` `jpg` `jpeg` `gif` `webp` · `pdf` · `mp4` `webm` | `<img>` `<object>` `<video>` tags |
| **NO preview** | `docx` `xlsx` `pptx` · `svg` · every other extension | download only, with an explanation |

### Why docx/xlsx/pptx are excluded — and "it bloats the codebase" is NOT the reason

`src/library/extract.ts` already extracts all three with **0 new dependencies**.
Copying that here would be nearly free. The real reason is stronger:

> **A text-extracted preview of a Word file is a LIE.** It loses the tables, the
> layout, the images.

In the document library, extracted text exists so `Grep` can **FIND** it, and no
one ever looks at it directly. Here, the user **LOOKS** at it to decide whether to
send it to a client. Same technique, right in one place and wrong in the other.

→ No broken preview. One plain sentence: *"download it and open it in the real
app."*

### Why `.svg` sits in the forbidden group

SVG is XML **and it can run JavaScript**. This file is generated by the MODEL, and
the daemon serves it at the **same origin** as the company control-panel UI — a
surface with no authentication beyond *"same machine"*. The server forces
`application/octet-stream` for `svg` `html` `htm` `xhtml`.

### Priority order comes from real data

Checked on 19/08: **14/14 artifacts on a user's machine were all `.md`**.
Architecturally correct — employees only have `Write`/`Edit`, so they can **only
write text**; no tool produces a `.jpg`, `.mp4`, or `.pdf` (except a role with
`Bash` declared, a rare exception).

→ The text group is **100% of real cases**. The image/pdf/video group was built
anyway because it's a few lines of native tags, not because anyone was asking for
it.

---

## 4. Delete: ONE level — but the question is DIFFERENT from the document library

Same rule as the document library (SPEC-library §6): one level, gone for good,
confirm with the **filename included**. An "archive" tier would just spawn a
second store that also needs cleaning up.

**But the confirmation question has to differ, and the difference is real:**

| | document library | results |
|---|---|---|
| original | still on the user's machine | **there is NO other copy** |
| the question | *"The original on your machine is unaffected."* | *"This is the **only copy** — the employee would have to redo it from scratch."* |

Reusing the document library's exact wording here would be lying about how
serious this is.

Once deleted, **also clean up the now-empty directory** — an empty
`artifacts/<plan_id>/T-01/` left behind just sits there for the user to open a
file explorer and wonder what it is.

---

## 5. No editor

Same reasoning as the document library, and stronger here: an editor here would be
a **second write door** into a file the employee is already writing to. That's
exactly the charter failure class (SPEC-library §17) — two interfaces writing the
same file, neither aware of the other.

To change the content, tell the Assistant to redo it. *"A draft to edit beats
writing from scratch"* is true — but the editing is done by an **employee**, not a
textarea.

---

## 6. API

| | |
|---|---|
| `GET /api/office/:id/artifacts` | scan the disk, return the list. **No catalog** |
| `GET /api/office/:id/artifacts/file?path=…[&download=1]` | stream. `download=1` → `octet-stream` + `content-disposition` |
| `DELETE /api/office/:id/artifacts?path=…` | delete for good, clean up empty directories |

### No catalog, no watcher

Scans `readdir`+`stat` on every read. Same reasoning as the document library
(SPEC-library §9.1) and **stronger here**: these files are written by the
employee **while a run is still in progress**, so any catalog would go stale
mid-run.

### Three safety gates — and the first one fixes a real hole

1. **Locked inside `artifacts/`.** The old `Office.readArtifact` function could
   read **any file in the office**: `roles/*.yaml`, `charter.md`, `office.yaml`.
   It blocked segments starting with a dot (so `.state/` was safe) but left
   everything else open. The function name sounded like it only read artifacts,
   and no one had double-checked.
2. **Resolve the real path before comparing.** A string check can't see through a
   symlink.
3. **A 2MB preview cap.** The old function had **no cap at all** — a 50MB `.csv`
   an employee generated would get loaded entirely into the daemon's memory and
   then pushed whole to the browser. Nobody had hit this yet because every result
   was a markdown file a few hundred bytes long; that's exactly the cheapest time
   to put the cap in.

⚠ The old function also always did `readFileSync(abs, 'utf8')` and always
returned `text/plain` — **corrupting every binary file**. Nobody had hit this
because no binary file had existed yet.

---

## 7. UI updates: keyed on the EVENT, not on a COUNT

`artifactsVersion` increments whenever a `task.done` carries an artifact. **No new
server event added**: results only ever come from a job finishing, and
`task.done` already fires for that. Adding another event to say the same thing
twice is one more place for the two to drift apart.

> **General lesson, fixed for the knowledge base at the same time:**
> `KnowledgePanel` used to key off `canvas.knowledge.total` — i.e. a **count**. It
> only reloaded when the node count changed, so any change that kept the count the
> same stayed invisible until the user hit F5: editing a note's content, one node
> overwriting another, deleting one node and adding another.
>
> **A count isn't the same as knowing something changed.**

---

## 8. The name: "Result"

Not *"Artifacts"*, not *"Product"*, not *"Handover"*.

Reason: the Assistant **already** says this exact sentence after every run —

> *"Result saved to: company/offices/…/answer.md"*

The product had already taught the user that word. Giving the same thing a second
name would just create a **third** concept to confuse it with, when there were
already two.

---

## 9. Things to VERIFY before promising this to customers

- [x] The new `artifacts/<plan_id>/<task_id>/` path — verified with a real 19/08
      run
- [x] Escaping the directory (`..`, `office.yaml`, `.state/`) all return 404
- [x] `svg` is forced to `octet-stream`
- [x] Deleting the last file makes the empty parent directory vanish on its own;
      a directory with files left doesn't
- [x] `csv` gets `view: csv`, `md` gets `markdown`, unknown extensions get
      `download`
- [ ] **Viewed in a real browser** — CSV table, image, pdf. Not yet verified
      (the Chrome extension won't connect)
- [ ] A result > 2MB: verify the 413 message displays correctly, not a raw JSON
      blob
