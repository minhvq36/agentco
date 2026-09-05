# SPEC — Capabilities, keys, approval gates, and mid-run interrupt

**Date:** 15/08/2026 · **Status:** design locked, not yet implemented

Answers eight questions that came up while role-playing an ordinary user running `TEST-WALKTHROUGH.md`. Read alongside `SPEC-offices.md` (§4 Assistant, §5 workers + secrets) and `SPEC-connectors.md` (the specialty feature).

Every SDK API cited in this file has been **checked directly against the installed `@anthropic-ai/claude-agent-sdk@0.3.231`**, not taken from the web docs — the web docs are wrong in at least one place (`PermissionResult`).

---

## 0. Eight decisions, one table

| # | Question | Decision |
|---|---|---|
| 1 | What does the Assistant see about a worker? | `pitch` **+ one AUTO-GENERATED capability line**. Skills and knowledge stay hidden. |
| 2 | Wiring/unwiring feels laggy | Split into two write paths: coordinates debounce, **wire edges reply instantly** |
| 3 | Plan doesn't appear in chat · mid-run interrupt | Plan goes into chat · both `Esc` and `/stop` call `interrupt()` |
| 4 | Skills need to be editable in the UI | Agreed. The layered prompt table becomes editable, **with an explicit Save button** |
| 5 | Where do system tools show up | **Nowhere at all** — enabled by default, except `Bash`. See §5 |
| 6 | Wiring MCP through the UI | Agreed. Three kinds: **stdio · Streamable HTTP · self-generated connector** |
| 7 | Keys per bundle or per tool | **Per connector/MCP**. An agent doesn't hold keys, it holds *permission to use* |
| 8 | Approval gate | **Two tiers**: one-time plan approval + per-instance blocking for irreversible actions |

---

## 1. What the Assistant sees about a worker

**Correct as-is: `pitch` is the only thing the Assistant sees when dividing work.** That's why planning stays cheap — skills, experience, and history all stay with the worker.

### But there's a real gap: capabilities don't surface

If `Writer` is wired to Notion and the Assistant doesn't know it, the Assistant can't decide "this task should go to Writer because it can reach Notion." It ends up planning as if nobody had any tools at all.

**Fix: add one AUTO-GENERATED capability line, without making the user write it into `pitch`.**

```
# Employees you can assign to

- nguoi-viet (Writer): Writes Vietnamese content… [reach: Notion, web]
- ke-toan (Accountant): Reads statements, categorizes… [reach: Google Sheets]
- nguoi-soat (Reviewer): Reviews results… [does not do: write code]
```

Generated from: the display name of the connector/MCP wired into that agent, plus `web` if it has `WebSearch`/`WebFetch`. **Do not** list raw tool names, **do not** list schemas — the Assistant needs to know *what it can reach*, not *how to call it*.

Cost: ~5–10 tokens per worker. In exchange, the Assistant assigns work to the right person. Worth it.

**Mandatory corollary:** this line lives in the roster → lives in the Assistant's cached prefix. Wiring in one more MCP = one Assistant cache rewrite. Cheap, but has to be known.

### 1a. 🔴 THE SHELL FLAG MUST STATE BOTH DIRECTIONS — an assert-only-when-true version was MEASURED to be INEFFECTIVE

The 22/08 version only injected `runs commands on your machine` into the capability line **when a role had shell**, on the theory that *"rule 7 (`if nobody fits, say so plainly`) already covers the negative side."* **Rerunning test #9.3 shows it sits there doing nothing:** the Assistant still assigns work to a role whose `pitch` promises shell access but whose switch is OFF, still plans a full 2 steps, still spends $0.1380 for 0 result.

**Why:** in that office nobody has shell ⇒ the phrase `runs commands on your machine` never appears anywhere ⇒ **absence is not a signal.** An assert-only flag is only readable through CONTRAST. And rule 7 can't fire: as far as the evidence in the Assistant's hands goes, the `pitch` says SOMEONE is qualified.

**Decision: a two-way flag on every line, meaning explained once in one place.**

```
# Employees you can assign to

Every worker can OPEN files on the user's machine by full path — read
content, list filenames. "runs commands: ON" additionally means: run
arbitrary commands/scripts on the machine, and write outside the office folder.

- nguoi-kiem-ke (Inventory checker): Runs commands to get file info… [web · runs commands: OFF]
- nguoi-viet (Writer): Writes content… [Notion (shortcut to D:\Records) · web · runs commands: ON]
```

> 🔴 **TWO SENTENCES IN THE BLOCK ABOVE WERE WRONG AND HAVE BEEN FIXED — noting this so nobody copies the old version.**
>
> **① *"running commands is the ONLY way to get a file size"* — wrong per measurement (24/08).** The
> builtin `Read` prints size on its own when reading a PDF: `PDF file read: …\CV.pdf (411.7KB)`, matching
> `Get-ChildItem` down to 0.1 KB. The old sentence made the Assistant refuse a task it was able to do. The
> in-code copy (`SHELL_LEGEND`) had already dropped that clause; the block above is the synced-up version. → `SPEC-arms` §15h
>
> **② `armReach` used to write `(folder: …)` — changed to `(shortcut to …)`.** The old wording got read by
> the Assistant as a worker's **total reach** and used to justify refusing work outside it, even for
> someone who did have shell, even in a fresh `/clear` session. The truth was the opposite, and it was
> **already sitting on the very first line of this block** — but it **lost to positioning**.
> — [[agentco-prompt-rules-lose-to-examples]] → `SPEC-arms` §15j

**Why the meaning is gathered in one place (`SHELL_LEGEND`), not repeated per line:** "what shell means" is a fact about **agentco**, not a property of **one worker** — putting it on one person's line is assigning it to the wrong layer, the exact mistake (`pitch` vs `tools`) that caused this case in the first place. Measured: the legend costs **77 tokens** paid once, the flag costs **6 tokens**/role; breaks even against the repeat-per-line approach at **~4 workers**, and wins by more from there on.

⚠ **The flag reads `runs commands: OFF`, NOT `shell: 0`.** The legend sits at the top of the block while the flag sits on line 9 — the distance is real, so the flag has to read correctly standing alone. 2 tokens for something that doesn't depend on distance.

⚠⚠ **THE NEGATIVE STATEMENT HAS TO BE NARROW — a broad negative is a lie.** *"No shell"* does NOT mean *"cannot reach your machine"*: `Read`/`Glob`/`Grep` have no fence at all (§5b), so even a bare role can still open `D:\Records\contract.pdf`. Writing a broad sentence teaches the Assistant to refuse work it's fully capable of doing — a failure in the **opposite direction**, and quieter than the original case because nobody sees the refusal happen. There's a test guarding this (`plan.test.ts`).

### 1b. 🔴 CHANGING WHERE THE FIREWALL SITS — locked 22/08, **not yet built**

> **REMOVED:** a deterministic gate in `Scheduler.validate` used to block *"absolute `outputs` + a role without shell."* It was **dead code**: `buildPlan` runs `outputScoper` over the outputs of every prior task (`assistant.ts:591`) and that function always returns `artifacts/<plan>/<task>/…` ⇒ `isAbsolute` is never true. Its 9 tests stayed green because they called `validate` directly, **routing around `buildPlan`**. And it was also wrong by design, per below: writing outside the office **doesn't require shell.**

**Original insight (user, 22/08): the problem was never shell — it's that we drew the firewall in the wrong place.**

The current state is the worst combination of two choices:

| exit route | blocked? |
|---|---|
| `Write` · `Edit` · `NotebookEdit` | ✅ `officeJail` really does deny it |
| `Bash` | ❌ no hook at all |
| MCP | ❌ |
| `WebFetch` / `WebSearch` (a data-OUT path) | ❌ |

⇒ **Nothing is actually contained** (one `Bash` line gets around it), while the **one thing blocked is the easiest route to read, log, and audit.** It isn't a security fence; it's a **guardrail** — and on that particular role it did real good (it caught case `P-260821-1818-yydi`). Its flaw isn't "it only guards three tools," it's that **it never distinguished "the model wandering off" from "the user pointed at this on purpose."**

**Decision: change the boundary from *"the office folder"* to *"the office folder + wherever the user has said out loud."***

> A destination passes through `officeJail` when **that exact string is present in the message the user just typed** (tolerant of `\` ↔ `/`). Applies to both `Write` **and** `Edit`. Everything else is treated as inside the office.

⚠⚠ **The criterion is PROVENANCE, not string shape.** "Absolute" measures the wrong thing: the model **making up** `D:\Reports\x.md` is just as absolute as the user **typing** `Downloads\x.md`. This is exactly the `pitch` vs `tools` mistake, and *"MCP name vs MCP capability"* — **shape substituted for origin**, the fourth time in one session.

| user typed | model claims | match? | result |
|---|---|---|---|
| `D:\Downloads\…\statement.md` | verbatim | ✅ | written exactly where they meant |
| *"save it to Downloads"* | `D:\Users\…\Downloads\x.md` | ❌ | stays in the office folder, **and the Assistant has to say where it actually went** |

A vague user request falls back automatically to the safe default — **no case ever needs a guess, so no case ever guesses wrong.** The more the model "helps" by expanding to a full path, the more it fails to match, and the failure leans safe.

⚠ Matched against the **real user message**, NOT `plan.request` — `request` is sometimes written by the model (`requestOf()`, `assistant.ts:619`). Matching a model-authored string is inviting back the exact same loop.

**A good side effect:** writing outside the office when run via a bare `Write` now — **logged, receipted, no shell required** — is actually tighter than the status quo, where `Bash` writes anywhere without leaving a single line in the record.

Requires: `outputScoper` has to open a lane for a matched destination (otherwise the allowlist has nothing to admit), and a **doc-only tip** — *"want to write outside the office? type the full absolute path"* — **not surfaced in the UI** (user's call: too much text hurts UX).

> **The general rule still holds: DETERMINISTIC claims can only be made about things WITH ENFORCING CODE.** `officeJail` really does deny ⇒ it really blocks. *"Does this task need shell"* is a semantic question ⇒ it can never be deterministic.

**Undecided, set aside separately:** a READ fence (`Read` + `WebFetch` is a data-out path that doesn't need `Bash` — §5b: buildable, measured, not built). If the jail is only a guardrail, then agentco currently **has no containment story at all** — that has to be a deliberate choice, not one the default makes by accident.

### There's still no place to edit the introduction — correct, and really missing

Add to the settings table: editable `display_name`, `avatar`, `pitch`, `not_for`, `model_tier`. Written straight into `roles/<id>.yaml` via `parseDocument` to preserve comments.

⚠ **Editing `pitch` bumps the Assistant's cacheKey**, editing `model_tier` bumps that specific agent's cacheKey. An explicit **Save** button, no autosave — same constraint already applied to skills (`SPEC-ui.md` §2.2).

---

## 2. Wiring/unwiring has to respond instantly

**Diagnosis:** today the wire edges render from the `canvas.edges` prop, which only changes **after the server replies.** Plus `onCommit` debounces at 700ms. So finishing a wire drag means waiting ~700ms + one network round trip before it appears.

**Root cause:** coordinates and wire edges share one write path, even though they're fundamentally different.

| | Coordinates | Wire edges |
|---|---|---|
| Nature | continuous, ~60 events/second | discrete, one at a time |
| Debounce | **needed** — writing every frame is pointless | **harmful** — nothing to coalesce |
| Consequence of a miss | just a layout hiccup | changes the roster, changes money |

**Fix:**

1. Wire edges get their own write path, **sent immediately**, no debounce.
2. Render **optimistically**: add/remove the edge to state the moment the mouse is released, then send it.
3. The server returns the filtered result → reconcile. If the server dropped that edge (rule violation), **revert it and show a toast explaining why**, never fail silently.

The "Smooth" criterion says *an interaction responds before the server replies* — this is exactly that spot.

---

## 3. Plan goes into chat, and mid-run interrupt

### 3a. The plan has to appear in chat

Today the plan only shows in the strip under the canvas and the Log panel. Over Telegram it's **completely invisible** — and the bridge is the ultimate goal.

Fix: `plan.created` generates an Assistant chat message:

```
I'm splitting this into 3 tasks:
  1. Research the flower shop
  2. Write 3 drafts
  3. Review the tone
Starting now.
```

Built with **code from the existing `steps`** — 0 extra tokens. With the approval gate (§8), this exact message also carries the approve button.

### 3b. Mid-run interrupt — the SDK supports it fully

Checked against `sdk.d.ts`:

```ts
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<SDKControlInterruptResponse | undefined>;  // streaming input mode ONLY
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  close(): void;
}
// Options also has: abortController
```

⚠ `interrupt()` **only works in streaming input mode** — meaning `prompt` has to be an `AsyncIterable<SDKUserMessage>`, not a string.

### ⚠⚠ TRIED AND FAILED — `interrupt()` DOESN'T WORK, don't try again

Three real measurements, one approach each:

| Approach | Measured result |
|---|---|
| `prompt` as a string + `interrupt()` | no effect at all. Hitting Stop and **all 3 tasks ran to completion anyway**, spending another **$0.36** |
| streaming input, stream **closed immediately** after yielding | `interrupt()` fires into an empty space — still ran to completion, **$0.27** |
| streaming input, stream **kept open** so interrupt has somewhere to attach | **DEADLOCK.** The worker finished writing files and then never returned a `result` — the SDK sat waiting for more input. No event for over 90 seconds, had to kill the daemon |

**What actually works: `abortController` in `Options`.** Measured: stopped after **14.5 seconds**, cost **$0.054** instead of $0.27 — exactly three `blocked` receipts.

```ts
const abortController = new AbortController();
query({ prompt, options: { abortController, /* … */ } });
// to stop:
abortController.abort();
```

Streaming input mode is kept because it's harmless and lays groundwork for whenever the CLI properly supports it (`interrupt_receipt_v1`).

**A trap that took one more measurement to catch:** the handle has to be **actually registered** in `scheduler.live`. On the first pass, a mismatched substitution left `live` permanently empty — `interruptAll()` ran over an empty set, everything compiled cleanly, and nothing actually stopped. **TypeScript can't catch this class of bug.**

### Two entry points, because of the bridge

| Door | Where |
|---|---|
| `Esc` key | UI, while something is running |
| `/stop` text command (and `/cancel`) | the chat box — **works identically over Telegram** |

Every text command has to go through `office.say()` like everything else, and gets caught **before** it reaches the Assistant — this is a control command, not a sentence to be understood. Handing it to the model would be paying to get a slower answer.

Minimum command set: `/stop` `/cancel` · `/approve` `/ok` · `/reject` `/no` · `/status`.

### What happens after an interrupt — a context rule

This is the part described as "kind of sensitive," and it is.

```
Running: 2/4 steps          → [Esc]
  ✓ Research                       ↓
  ✓ Write draft                stop now
  ⟳ Review tone   ← interrupted    input box lights up
  ○ Post                       you type: "make it younger, don't post yet"
                                     ↓
                               Assistant plans a NEW step set for what's LEFT
```

**Three rules, and the third one is the hard one:**

1. **Finished work stays as-is.** The old plan closes in a `stopped` state, keeping the receipts and artifacts of completed tasks. Nothing is redone.
2. **The new plan receives a handoff summary**, built with **code**: the original request · steps already done + their artifact paths · the step that was interrupted · the new instruction. This is text we assemble, **not** an LLM call.
3. **The Assistant MUST NOT pull in the transcript** of the dead task. It never saw a worker's transcript anyway — only the receipt (≤800 tokens). The handoff is therefore **naturally clean already**: it inherits the *result*, not the *process*.

> The Receipt protocol was designed to save tokens, and it turns out it also solves the context problem after an interrupt for free. One mechanism, two problems — a sign the boundary is drawn in the right place.

The Assistant's conversation session **stays intact** (it has to remember what you just said). Only the *work lifecycle* closes.

---

## 4. Skills editable in the UI — agreed, no further debate

The layered prompt table already shows the right structure; it just needs to let `editable: true` layers be edited:

| Layer | |
|---|---|
| Core | 🔒 read-only (unless `allow_core_prompt_edit`) |
| Office introduction (charter) | ✏️ editable |
| Skills | ✏️ editable |
| Preloaded experience | 🔒 read-only — edited from the Knowledge drawer |

**Three mandatory constraints:**

1. **No autosave.** An explicit **Save** button. Every save bumps a cacheKey → pays for one cache write. Autosave-on-keystroke would churn the cache constantly.
2. **Show token count live while typing**, and warn when it goes over the cap (`assistant_skills_tokens` 400, `charter_tokens` 500).
3. **State the consequence right next to Save:** *"Saving will make every worker rewrite its cache once (~X tokens)."* The user deserves to know what the button they're about to click costs.

API: `PUT /api/office/:id/prompt/:who/:layer` with `{ text }`. Writes into exactly `layer.file`.

---

## 5. System tools: **on by default, except for one**

Both of the options originally proposed here were wrong. The right answer is **no UI at all.**

### Why

Claude Code implements `Read`/`Write`/`Glob`/`Grep`/`WebSearch`/`WebFetch` very cleanly, and **every agent needs them.** Making the user turn on `WebSearch` for a worker named "Researcher" is asking a question with exactly one correct answer — that's not a choice, that's paperwork.

Evidence from the walkthrough itself: tests #4 and #10A **require opening `roles/<id>.yaml`** just to add `WebSearch`. Remove that whole layer of paperwork and both tests run straight from the UI.

### Decision

| Tool | Default | Why |
|---|---|---|
| `Read` `Write` `Glob` `Grep` | ✅ **always on, cannot be disabled** | These are the office's *hands*. ⚠ This row's "why" used to say *"can only touch `cwd`, `safeJoin` blocks the rest"* — **wrong, see §5b**. |
| `WebSearch` `WebFetch` | ✅ **always on** | Read-only **from outside in.** But `WebFetch` is also an **out** path — see §5b. |
| `Bash` | ⚠ **on by default since 22/08, toggleable via a switch in the detail panel** | The only thing that reaches outside the office folder. Rated `write_external` in §8. Default changed from ❌ to ⚠ on 22/08 — see right below. |

#### 🔴 5a-bis. THE SHELL TOOL NAME CHANGES BY OS — the switch was a NO-OP for 6 days

Before discussing the default, there's a bigger thing to fix first: **`tools: ['Bash']` grants EXACTLY 0 tools on Windows.**

Asked the CLI directly (`system/init` has a `tools` field), on a Windows machine:

| passed in | CLI actually grants |
|---|---|
| *(no `tools` passed)* | **29 tools**, including **`PowerShell`** — and **no `Bash` at all** |
| `['Bash']` | **0 tools** |
| 7 defaults + `['PowerShell']` | 8 tools ✅ |

`tools` is an allowlist **matched by name**, and a name that doesn't exist on the current platform is **silently dropped** — no error, no warning. So every role declaring `Bash` on Windows gets exactly the default set, indistinguishable from declaring nothing. The switch, its default value, and walkthrough test #9 were all describing a capability that **did not exist.**

> **The evidence was sitting right in this file for six days.** The 16/08 case below already recorded: *"`nguoi-viet` … reaches for **PowerShell** four times."* The correct name was sitting right there in the evidence for a different bug, and nobody read it that way — because at the time, everyone was looking for a different answer.
>
> **Lesson: an allowlist that silently drops unrecognized entries is a trap.** It never produces a symptom at the point where it fails — it just makes a feature quietly not exist. When passing a list of names down to another system, you have to **ask what it actually received**, never assume it received everything.

**Fix:** config keeps **one canonical name** (`Bash`) so a zipped-up office still runs on a different OS; `effectiveTools()` sends **both names** down to the SDK and lets the CLI drop the one that doesn't apply. Doesn't sniff `process.platform` — Claude Code on Windows *can* have Git Bash under a different name, and we don't control that naming table. Sending both lets the SDK answer its own question, with no premise left to be wrong about. Measured: **sending an extra name costs 0 tokens** (dropped before entering the prefix).

#### How many shell tools are there, and is there a `WebSearchMacOS`? — checked against the authoritative source

A runtime listing only describes **one** OS. The right source is `sdk-tools.d.ts`, where the SDK declares the schema for **every** tool, platform-independent:

- There is exactly **ONE** shell schema: `BashInput`. **No `PowerShellInput`.** Meaning `PowerShell` on Windows isn't a second tool — it's **the same tool wearing a different display name**, same `command` field. (Which is why `describeCall` reading `input.command` for both names is correct.)
- No other tool has a platform-specific variant: exactly one `FileReadInput`, one `FileWriteInput`, one `GlobInput`, one `GrepInput`, one `WebSearchInput`, one `WebFetchInput`. **Nothing like `WebSearchMacOS` exists.**

⇒ `Read` `Write` `Edit` `Glob` `Grep` `WebSearch` `WebFetch` are **neutral names, shared across all three OSes.** Shell is the one exception.

⚠ The limits of this evidence, don't overreach: the schema list proves there are no two *schemas*; the Windows runtime list proves the Windows *names*. A name that only exists on macOS wouldn't show up in either. That's exactly why the next lock exists.

#### 🔒 The real enforcement isn't the name table — it's the runtime cross-check

`SHELL_ALIASES` is a list **we wrote by hand**, while the name table belongs to the SDK. A fourth platform showing up with a third name would bring the old bug back, **just as silently.**

So `worker.ts` §`warnDroppedTools` cross-checks right at `system/init`: the CLI's `tools` field lists what it **actually granted.** Compare against what we sent, and warn on a mismatch. It doesn't need to know which name is correct — only that *"what I asked for and what I received don't match."* That's a far more durable invariant than any list of strings.

Shell names are counted as a **group**: we deliberately send both and **expect** one to be dropped, so it only warns when **neither** name got granted. The warning fires at the process level, once per (role × missing set) — a flower-shop operator can't act on this message, but someone setting up the system can.

#### Default changed from OFF to ON (user locked this in 22/08) — and the real cost is 2,688 tokens

⚠ **Correction.** The first draft of this section said *"`Bash` only adds **1 token**"* and concluded *"the token argument is dead."* **Wrong** — that measurement was measuring a name being silently thrown away, i.e. measuring a no-op. Re-measured after the tool was actually granted (CLI reported 8 tools):

| | prefix (cache_creation, nonce breaking cache) |
|---|---|
| 7 default tools | 4,547 |
| + shell (`PowerShell`) | 7,235 |
| **shell adds** | **2,688 tokens / every worker call** |
| + both `Bash` and `PowerShell` | 7,235 — **the extra name costs 0** |

⚠ The measurement had one more trap: the second measurement **ate the first one's cache** (`cache_read` = exactly the previous `cache_write`), producing a zero difference. A nonce had to be planted in the system prompt to force a miss both times.

**+2,688 is ~59% on top of a 4,547 baseline** — not trivial, and paid on every turn of every worker. But it's a **cache read** after the first time (~0.1× the entry price), so it's still much smaller than one wasted run because a tool was missing. The token argument **didn't die, it just didn't win.**

The remaining tradeoff belongs to the product owner: most real office work (listing a folder with sizes, converting file formats, zipping results, calling `git`) needs shell, and a non-technical user doesn't know to go turn it on themselves.

#### Does a worker actually prefer `Read` over shell? MEASURED: YES

The real question is *"does it need to be told to prefer `Read`?"*. Measured with a role given all 8 tools:

| task | tool it chose |
|---|---|
| read a file inside the office | `Glob` → `Read` |
| read an external file, absolute path | **`Read`** |
| list an external folder + sizes | **`PowerShell`** — `Get-ChildItem -Path …` |

⇒ It reaches for shell **only when the tool set has a real gap** (no tool returns file size), and it picks the right command for the OS it's running on without anyone telling it what platform it's on. **No extra instruction line is needed** — and adding one would be a permanent tax in the prefix to buy a behavior that already exists.

Comes with a condition — **say it up front, don't wait for them to discover it**: the Add Worker dialog has a line that says plainly *"this person will be able to run commands on your machine,"* and `roleTemplate` writes `tools: [Bash]` with a comment block explaining the exception. A broad, silent default isn't convenient, it's a trap: the user only finds out it exists once it's already too late.

Result: **a single switch in the whole system**, with one warning sentence. No chip, no node, no list.

`roles/*.yaml` still keeps the `tools:` key for advanced users to override — but an ordinary user never touches it.

### ✅ That switch became real on 22/08/2026 — before that it was a second line with no source code behind it

The table above locked in "one switch in the detail panel" from the start. The first implementation (16/08) delivered only half of it — `tools: effectiveTools(role.tools)` **really did cut** `Bash` from the context of a role that hadn't declared it. But the only way to **declare** it was still opening `roles/<id>.yaml` by hand.

What pointed at the gap wasn't a re-read of the code, but a line in a test document: walkthrough test #9 had a **MANDATORY** 📝 step telling the user to open the yaml file.

> **A packageable lesson, one notch different from the 16/08 lesson:** there, an invariant is only real once source code enforces it. Here — **a feature meant for non-technical people is only real once there's a UI for it.** Both times, the thing that found it lay outside the code: last time it was a 5-minute experiment, this time it was one line of documentation confessing on its own. A "go open a yaml file" step in this product's instructions is always an alarm bell, never business as usual.

Implementation:

| | |
|---|---|
| `Office.editAgent({ bash })` | keeps other tools in `tools:`, deletes the key entirely when empty, then `reload()` — so **no restart needed** |
| `CanvasNode.bash` | `role.tools.includes('Bash')` |
| `Inspector.tsx` §`BashSwitch` | the switch + a warning sentence that states the real consequence |
| cache | **no need to bump `version`**: `cacheKey` hashes `toolKey` directly (`prompt.ts`), so a changed tool set is already a changed key |

⚠ This switch is the **one exception** to the rule "results always stay inside the office" — `officeJail` matches `Write|Edit|NotebookEdit` and **cannot** match `Bash`. → `SPEC-artifacts.md` §2.6.

### The Assistant and hidden workers still get NO shell, and that's not an oversight

| | actual `tools` | why |
|---|---|---|
| **Worker** | 6 default tools + `Bash` if enabled | This is where work happens. The switch belongs here. |
| **Assistant** | `[]` — genuinely empty | It **doesn't do work, it divides work.** Giving it tools creates a second path for work to get done — one with no receipt, no plan, no per-task expense ledger, and no role limit of any kind. Also, `route()` runs `resume` on **every message**, so every added tool becomes a tax paid on every keystroke. |
| **Hidden worker** inside the Assistant (`lookup`) | `['Read','Grep','Glob']` — read-only | It exists to answer *"what's in the library"* without spinning up a real worker. That only requires reading. Giving it `Bash` would give the Assistant a back-door arm — exactly what was just refused on the line above. |

In other words: **`Bash` attaches to ONE PERSON you see on the diagram and switch on by hand.** There's no route for a command to run without a name accountable for it in the log.

### 5b. 🔴 CORRECTION 22/08 — THE READ FENCE DOES NOT EXIST, AND NEVER DID

The table above (and a comment block in `types.ts`) said: *"they can only reach the office folder (`cwd`), and `safeJoin` blocks anything outside it."*

**Wrong.** `safeJoin` is **our own** function, running in **our own code** — it has never stood between the model and the `Read` tool. `cwd` isn't a wall; it's a default working directory.

**Measured on 22/08** — a role with only the default set, **no** `Bash`, `cwd` set to the office folder:

```
NO Bash · absolute path   tool=[Read] → ✅ READS content from a folder outside the office
```

> **The old sentence read very convincingly because it NAMED a function that really exists.** It's just at the wrong layer. This is the most subtle variant yet of *"an invariant is only real once source code enforces it"* — this time the source code exists, runs correctly, and protects something else entirely.

#### The REAL boundary today

| | fence | enforced by |
|---|---|---|
| **Write** — `Write` `Edit` `NotebookEdit` | ✅ yes | `officeJail` (`PreToolUse`), measured to actually run |
| **Read** — `Read` `Glob` `Grep` | ❌ **nothing at all** | — |
| **Web** — `WebFetch` `WebSearch` | ❌ none | reads *from outside in* only, but a URL is an **out** path |
| **Commands** — `Bash` | ❌ none, and **on by default** since 22/08 | — |

⇒ **`Read` (anywhere) + `WebFetch` (any URL) is a complete data-exfiltration path, no `Bash` required.** This isn't said to scare anyone — it's the condition for having the right discussion. In a product where `SPEC-offices.md` §5 built an entire `secrets` field around least-privilege, a nonexistent read fence is exactly where that principle falls short.

#### A read fence CAN be built — measured, not yet built

On 19/08, the finding was *"the `PreToolUse` hook never fires"* for `Grep`/`Glob`, and the spec carefully added *"⚠ don't overreach the boundary of this measurement."* Re-measured on 22/08, in the **worker** context (not the Assistant):

| | hook fired | result |
|---|---|---|
| no hook (control) | — | ❌ external file readable |
| `PreToolUse` matcher `Read` | ✅ `Read` | ✅ **blocked** |
| `PreToolUse` no matcher | ✅ `Read` | ✅ **blocked** |

So the road **is buildable**, and it's the same mechanism `officeJail` already uses. Proposed shape: **an allowlist derived from the plan itself** — allow reads inside the office folder, **plus** the absolute paths already declared in that task's `inputs`, block the rest. It turns `inputs` from a claim into an **enforceable contract**, and turns the existing prompt instruction to the worker (*"Do not explore. Open exactly what your inputs list"*) from a **plea** into a **mechanism**.

**Not built yet — pending a decision**, because it changes every worker's runtime behavior and risks blocking a legitimate read by mistake.

### ⚠ The table above WAS NOT ENFORCED until 16/08/2026 — `tools` ≠ `allowedTools`

We only passed `allowedTools` and assumed that meant restriction. The `.d.ts` says the opposite:

> `allowedTools` — *"List of tool names that are **auto-allowed without prompting**… To restrict which tools are available, use the **`tools`** option instead."*
> `tools` — *"Specify the **base set** of available built-in tools."*
> `disallowedTools` — *"removed **from the model's context** and cannot be used."*

Meaning **every worker was seeing the entire Claude Code tool set**, `Bash` included. The line "Bash is off, must be turned on explicitly" in the table above was a promise that never had source code behind it.

**Found by observation, not by reading code:** a read-only file was set up and a worker was assigned to write into it. `nguoi-viet` — a role that **declared no tools beyond the default set** — tried `Write` twice and then **reached for `PowerShell` four times.**

Three costs, all at once:

| | |
|---|---|
| **Tokens** | every tool's definition sits in the cached prefix of EVERY worker call, forever |
| **Turns** | every attempt at a refused tool is a paid turn spent receiving a refusal |
| **Architecture** | a role that didn't declare `Bash` could still reach shell — the §5 invariant only existed on paper |

**Fix:** pass `tools: effectiveTools(role.tools)` alongside `allowedTools`. Measured on the same role, same 2 turns, both cache-warm:

| | cache_read | cache_write | $/task |
|---|---:|---:|---:|
| before | ~34,100 | ~4,320 | $0.051 |
| **after** | **13,607** | **1,406** | **$0.0275** |

**The prefix drops ~60%, the cost of one task drops by nearly half.** Most of the "~13,200 token floor per worker call" turned out to be definitions of tools we never intended to grant.

> **A packageable lesson: an invariant is only real once source code enforces it.** This table has been in the spec since the beginning, reads very convincingly, and was wrong the entire time. What found it was a 5-minute experiment with a read-only file — not a re-read of the code.

### 5c. GRAB 8, OR GRAB ALL 29? — measurement first, then the architectural argument (locked 22/08)

Isolated measurement of **just the tool footprint** (same tiny system prompt, nonce breaking the cache all four times):

| tool set | CLI grants | prefix | added |
|---|---:|---:|---:|
| no tools | 0 | 193 | — |
| 7 office tools | 7 | 4,547 | +4,354 |
| **7 + shell (current)** | **8** | **7,235** | +2,688 |
| **grab everything (no `tools` passed)** | **29** | **13,188** | **+5,953** |

**Grabbing everything = 1.82× the current prefix, adding 5,953 tokens to EVERY worker call, forever.**

But money is the SECOND argument. The first is architecture — sorting the remaining 21 tools into four groups makes it obvious:

| group | tools | why NOT to grab them |
|---|---|---|
| **Orchestration / sub-agents** | `Task` `TaskCreate` `TaskGet` `TaskUpdate` `TaskList` `TaskOutput` `TaskStop` `SendMessage` | agentco **already has** this layer: the Assistant + `Scheduler` + the plan + receipts. Grabbing these means **two competing orchestration layers** — a worker spawning its own workers, **off the ledger, off the log, outside every role limit.** This isn't a money question. |
| **Background agents / scheduling** | `CronCreate` `CronDelete` `CronList` `ScheduleWakeup` `RemoteTrigger` `PushNotification` | Same reason: work lifecycle belongs to agentco. A worker setting its own cron job is a recurring cost **the user never sees anywhere.** |
| **Developer tooling** | `EnterWorktree` `ExitWorktree` `NotebookEdit` `DesignSync` | A flower-shop client has no git worktree, no Jupyter. |
| **Claude Code internals** | `Skill` `ToolSearch` `ReportFindings` `Monitor` | Belongs to the Claude Code product, not to a virtual office. |

#### Why Claude Code has so many tools — and the proof is right there in the list

Because it's a **different product**: an interactive coding agent **plus** a background-running agent platform, **for a technically skilled user sitting at a terminal.** agentco is a **product for non-coders**, and it **owns its own control layer** — so wherever the two overlap in function, ours has to win.

> The strongest piece of evidence sits right in that same list: **`ToolSearch`.** It's the "deferred tool" mechanism — load names up front, load schemas only when needed. It exists **precisely because** the tool set had already gotten too big to load all at once. **Anthropic itself knows it's a lot, so they built a tool to defer other tools.** We prune at the source; they defer midstream. Same observation, different point of action.

#### The yardstick for any future "add this builtin tool" proposal

A tool only makes it into the default set when **all three** hold:

1. **No existing tool can already do the job.** (`Bash` passed this gate: nothing else returns a file size.)
2. **It doesn't duplicate a control layer agentco already owns** — orchestration, scheduling, cost, logging.
3. **A real office user actually needs it**, not a developer.

Run all 21 remaining tools through this yardstick: **none of them pass**, and most fail at (2), not at cost. Counting tokens alone would make `NotebookEdit` look "cheap" — but it still fails at (3).

⚠ One small mismatch worth noting: `officeJail` matches `Write|Edit|NotebookEdit`, but `NotebookEdit` **is not** in `BUILTIN_TOOLS`. Harmless (over-guarding beats under-guarding) but it's a promissory line guarding a door that has never existed. Kept intentionally: the day `NotebookEdit` gets added, the fence is already there waiting.

### MCP/connectors are still NODES

Because they're **entities with an identity**: their own process, their own configuration, their own key, and **shared across multiple agents.** Node + wire is the correct description for something like that. A system tool is a *property*, and a property doesn't deserve a node.

---

## 6. Wiring MCP through the UI — and three kinds, not one

This is where your worry gets resolved: **the user never has to write an MCP server.**

### On transports, answered directly

The current MCP spec defines **exactly two** transports:

| Transport | Used when | Status |
|---|---|---|
| **stdio** | the server runs as a local child process | ✅ standard for desktop/local — **most of our use cases** |
| **Streamable HTTP** | the server runs as a network service behind a URL | ✅ standard for remote |
| ~~HTTP+SSE~~ | (2024-11-05 spec) | ❌ **superseded, deprecated as of the 2025-03-26 spec** |

So: **SSE is no longer "the most stable option" — it's the old one.** Don't build new SSE servers. The SDK still accepts `type: 'sse'` for backward compatibility, we still allow wiring it, but label it *"legacy"* in the UI.

Checked against `sdk.d.ts@0.3.231` — the SDK accepts **four** shapes:

```ts
type McpServerConfig =
  | McpStdioServerConfig            // { command, args?, env?, timeout? }
  | McpSSEServerConfig              // { type:'sse',  url, headers? }   ← legacy
  | McpHttpServerConfig             // { type:'http', url, headers? }   ← Streamable HTTP
  | McpSdkServerConfigWithInstance  // ← runs INSIDE our own process
```

### Three routes in, none of them force writing an MCP server

| Route | What the user does | For |
|---|---|---|
| **A · Existing catalog** | pick from a list, fill in a key | Notion, Google, Slack… — well-known things, config already packaged |
| **B · Paste an MCP config** | paste a standard JSON block | anyone who already has a server |
| **C · Self-declared arm — the SPECIALTY** | ~~describe the API via a form / paste a cURL / paste OpenAPI~~ 🔒 **REST dropped 31/08** ⇒ **wraps a declared COMMAND** | `gh pr create --title {T}` on your machine |

**Route C is the answer to your worry.** It's possible because the SDK lets us create **an MCP server running right inside our own process**:

```ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
```

Meaning: the user describes an HTTP endpoint → **we generate an MCP server.** MCP becomes **our internal wire format, not something the user has to write.** No child process, no npx, no `package.json`.

> This is exactly the thesis `SPEC-connectors.md` locked in on 14/08: **"describe the API, don't write code that calls it."** Now it has a concrete installation path.

### But "the tool is just prose" DOES NOT work

You said: *"sometimes the tool is really just descriptive text: go to this page, grab this secret, then you can read/write."* A non-coder CAN do that with words — true. But doing it that way means the agent has to **construct the HTTP call itself** via `Bash`/`WebFetch`, and we lose three things entirely:

- **schema** → the model guesses parameter names, wrong silently
- **the approval gate** → GET can't be told apart from DELETE, §8 collapses
- **key handling** → the secret has to sit in the prompt for the agent to type out. **The model can read the key.** Not acceptable.

**The middle path, and it keeps both:** the user still describes things in words **plus one concrete sample** — pasting a cURL command, or filling in a 4-field form (method · URL · header · example body). We infer the schema from that sample. **Their prose becomes the tool's `description`** — exactly where the model needs it.

Answering *"should we force strict MCP building?"*: **strict on the INSIDE, never strict on the OUTSIDE.** We don't pamper — we move the pain from the user to our own code.

---

## 7. Keys per connector — and vetting the classic question

### 7a. A key attaches to the lock, not to the person

You lean toward "hide a key under each door's mat" over "one keyring." **Agreed, and taking it one step further:** a key belongs to the **connector**, not to the **agent**.

```yaml
# connectors/notion.yaml
name: Notion
transport: stdio
command: npx
args: ["-y", "@notionhq/notion-mcp-server"]
secrets:
  NOTION_TOKEN:
    label: "Notion integration token"
    help: "Notion → Settings → Connections → Develop your own integration"
```

The user clicks the `🔌 Notion` node → sees exactly the fields it needs, **with instructions on where to get them.** Fill them in, the value goes into `.state/secrets.json`; from then on the UI only shows `••••••••`.

**Why this beats the current `role.secrets`:**

| | Keyring per agent (current) | Key per lock (decision) |
|---|---|---|
| What the user has to think about | *"which keys does this worker hold?"* | *"what token does Notion need?"* — the natural question |
| Wiring | has to remember to declare `secrets:` **separately**, forgetting it breaks at runtime | wiring is the whole action, the key follows along |
| Least privilege | held together by discipline | held together **by structure**: no wire = no key |
| Confusion | one keyring for every lock | one key, one lock |

Two existing invariants stay: values go into the **env of the MCP process, never into the prompt**; **no API reads a secret back** — filling it in through the UI writes straight to disk, and no endpoint reads it back out.

> `role.secrets` becomes the **escape hatch for advanced users**, no longer the main path. Not removed, just demoted.

### 7b. Vetting: does the agent still need skills, or does wiring MCP make it "just know"?

This is the classic question, and the answer is **neither, exclusively.**

**The technical fact:** an MCP server publishes `tools/list`, containing **name · description · JSON schema** for each tool. The model **sees it all, automatically.** So for the question *"how do I call this tool"* — skills are **entirely redundant.** Writing skills to teach how to call a tool duplicates something that already exists, costs tokens, and **will drift** the moment the server updates.

**But there's one layer `tools/list` can never contain:**

| What MCP already says | What MCP can never know |
|---|---|
| "this tool creates a page in Notion" | *which of 40 databases is the right one for invoices* |
| "parameter `title` is a string" | *the title must start with the contract's reference number* |
| "this tool deletes a page" | *at this company, nobody deletes, only archives* |
| "parameter `date` is ISO format" | *the fiscal year starts in April* |

That is **not** tool-usage instruction — it's **the organization's own knowledge.**

### Verdict

**Skills default to EMPTY. Wiring an MCP means the agent knows it has an extra arm — nothing needs to be written for that.**

And the organization-specific knowledge in the right-hand column above **belongs to the knowledge store, not to skills.** Three reasons, all structural:

1. **An agent can write to the knowledge store on its own, but not to skills.** *"Invoices live in the Accounting 2026 database"* is something the agent discovers while working — let it write that down itself.
2. **The knowledge store costs 0 tokens on retrieval** (HOT in the prefix cache, COLD chosen by keyword). Skills sit in the prefix **permanently**, whether this task needs them or not.
3. **The knowledge store is chosen per task; skills are always present.** Thirty Notion conventions shouldn't be in the agent's head while it's writing a blog post.

**So what are skills still for?** Exactly one thing: **stable, always-applies-to-every-task working habits** — tone of voice, step order, output format. Short. If you can write it in under 10 lines, it's skills; longer than that, it's almost certainly organizational knowledge, written in the wrong place.

**This is even more true for the Assistant (router):** it never calls a tool. All it needs to know is **what it can reach** — and §1 already covers that with the auto-generated capability line. The Assistant's skills should only contain tone and its clarifying-question discipline.

---

## 8. Approval gate — two tiers

### 8·0 🔴 RULE: every path that WRITES OUTSIDE has to go through an EXPLICIT, named tool/MCP

> **Locked 22/08 (user). ⚠ POLICY — NO ENFORCING CODE YET.**
>
> This label is mandatory here. `types.ts:68` already taught this exact lesson: *"an invariant is only real once source code enforces it,"* and `worker.ts:177` records a real crash from once putting this rule inside `canUseTool` — a place that never fires. Writing this rule down without the label would be manufacturing a third broken promise.

**What the rule says:** anything leaving the office folder has to be a **NAMED capability, declared, visible in the log** — i.e. a tool or MCP the user actively wired in. It must **not** be a **side effect of flipping a general-purpose switch.**

Consequence: `Bash` **stops being "the door to the outside."** It goes back to being exactly what it uniquely does — ~~file metadata and~~ **running scripts and writing outward.**

> ⚠ **Corrected 24/08 per measurement:** metadata is **no longer** `Bash`'s exclusive territory. `Read` prints size when reading a PDF (`PDF file read: … (411.7KB)`, matching `Get-ChildItem` to 0.1 KB), and a filesystem arm has `get_file_info` for any folder it can reach. ❓ Not yet measured: what **other file types** `Read` prints size for, and whether `Glob`/`Grep` print anything. Don't over-generalize this. → `SPEC-arms` §15h · §14 #9

**Why it isn't enforced yet, said plainly:** the `PreToolUse` hook can match `Write`/`Edit`/`NotebookEdit` because the path sits in a **named field.** With `Bash` the path is **buried inside a command string** (`… > D:\x.md`), no field to read at all. So blocking `Bash` from writing outward is a genuinely hard problem, not just unfinished work.

**Where it will be enforced:** `PreToolUse` is the **only** layer every tool call passes through — including MCP tools (named `mcp__<server>__<tool>`, the matcher can hit those **in principle, not yet measured**). `outputScoper` is **not** this layer and never has been: it edits *what the plan claims*, it doesn't block *what an action does*.

| layer | edits/blocks what | who passes through it |
|---|---|---|
| `outputScoper` | bookkeeping on the PLAN | only the strings the model declares in `outputs` |
| `officeJail` (`PreToolUse`) | enforcement on the ACTION | `Write` · `Edit` · `NotebookEdit` |
| `Bash` · MCP · CLI | — | **passes through none of it** |

### 8a. Classified by CONSEQUENCE, not by tool name

| Level | What it is | Handling |
|---|---|---|
| `read` | reading a file inside the office, querying the knowledge store, `WebSearch`/`WebFetch` | **runs immediately** |
| `write_local` | writing to the office's own `artifacts/` | **runs immediately** |
| `write_external` | writing outward via a connector/MCP · `Bash` | **approved at the PLAN stage, once** |
| `irreversible` | sending · deleting · paying · publishing publicly | **approved EVERY TIME**, even after the plan was approved |

**Who declares which level:** a connector's definition declares it per tool, or a single default for the whole server. Undeclared defaults to `write_external` — **safe when unknown.** For a self-declared connector (§6, route C), it's inferred from the HTTP method: `GET`/`HEAD` → `read`, `POST`/`PUT`/`PATCH` → `write_external`, `DELETE` → `irreversible`.

### 8b. Tier 1 — one-time plan approval

After the Assistant builds a plan, if **any** task touches `write_external` or above:

```
I'm splitting this into 3 tasks:
  1. Read the price list in Drive              (read-only)
  2. Draft the quote email                     (writes inside the office)
  3. Send the email to the client  ⚠ sends outward
[Go ahead]  [Change the request]  [Cancel]
```

- **0 extra tokens** — the plan already exists, we're just showing it and waiting.
- This is also exactly the **"Preview the plan"** button `SPEC-ui.md` §2.1 has been asking for from the start, and the embodiment of *"scope control"* — the product's core pain point.
- Over Telegram: the same message, reply with `/approve` or `/reject`.

**Auto-confirm** is a per-office switch, default off. Turning it on skips tier 1, **never tier 2.**

### 8c. Tier 2 — blocking per instance, using `canUseTool`

> ## ✅✅ MEASURED 25/08 — **THE MECHANISM WORKS.** The warning block below has been RESOLVED, kept for the record
>
> `scripts/spike-canusetool.ts` — 5 cases, one variable each. This is exactly the *"10-minute spike"*
> this section has been demanding since 19/08 and nobody had run yet.
>
> | Case | did `canUseTool` fire | file on disk |
> |---|---|---|
> | A · mcp **inside** `allowedTools`, no callback | ❌ | written |
> | B · mcp **inside** `allowedTools`, **with** callback | ❌ | written |
> | **C · mcp OUTSIDE `allowedTools`, `allow` callback** | ✅ | written |
> | **D · builtin `Write` OUTSIDE `allowedTools`, `allow` callback** | ✅ | written |
> | **E · mcp OUTSIDE `allowedTools`, `deny` callback** | ✅ | **UNCHANGED** |
>
> **⭐ The 19/08 mystery has a solution, and it's not "the SDK is broken": `allowedTools` SHADOWS `canUseTool`.**
> The 19/08 measurement called `Grep`/`Glob` — two tools already sitting in `allowedTools` — so the
> callback never had a chance to run. The real variable was never *"is the tool a read or a write"* but
> **"is it inside `allowedTools` or not."** A whole spec section hung for 6 days over misreading the variable.
>
> The installed SDK **says this itself** — a new warning, worth quoting verbatim:
>
> ```
> [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] canUseTool will not be invoked for: Read, Glob, Grep,
> mcp__files. Bare allowedTools entries auto-approve the whole tool before the callback is
> consulted. … remove the bare names from allowedTools so they fall through to canUseTool.
> ```
>
> **Case E confirms the other half** — the *[Cancel]* button is real: `deny` **actually blocks the write**
> (the file on disk is unchanged), and the `message` goes right back to the agent **verbatim** as a tool
> result. The promise made in item 4 below (*"it knows why it was refused and improvises"*) now has code
> behind it.
>
> ⚠ One case measured wrong then re-measured, recorded because it's a repeatable lesson: case D's first
> run **still had MCP wired in**, so the model ignored `Write` in favor of `mcp__files__write_file` ⇒
> D's first run accidentally re-measured C, and the table looked like it had answered a question nobody
> had asked. Same bug class as the `--no-browser` incident on 24/08: **the test routed around the exact
> branch it was built to check.**
>
> <details><summary>Original 19/08 warning block — kept to show where it went wrong</summary>
>
> Everything in section 8c below is built on types from `.d.ts`, **never run for real.** On 19/08, this was the first time anyone in this project actually tried `canUseTool`, and **it did not fire a single time**:
>
> | tried | result |
> |---|---|
> | `canUseTool` with `allowedTools: []` | didn't fire |
> | `canUseTool` + `prompt` as streaming input | didn't fire |
> | `PreToolUse` hook, with and without `matcher: '*'` | didn't fire |
>
> Measured by logging every call to a file: **completely empty**, while the tool still ran normally. Details: `SPEC-offices.md` §4.7.
>
> **⚠ The boundary of this measurement — don't overreach:** only measured with `Grep`/`Glob`, i.e. **read-only** tools. Best guess: they're auto-approved by the CLI itself, so they never even go through the approval path. `Bash` and write tools **haven't been measured**, so the design below **hasn't been disproven.**
>
> **Mandatory before building this:** a 10-minute spike — give a role `Bash`, have it run one command, and check whether `canUseTool` fires. If it doesn't, all of tier 2 has to be redesigned (most likely with a **self-declared MCP tool**, where we run the task ourselves and aren't dependent on any approval mechanism.)
>
> This is exactly the rule *"an invariant is only real once source code enforces it,"* applied to a **not-yet-written** feature: don't schedule work on top of a mechanism nobody has ever seen run.
>
> </details>

This is a place the SDK already handles for us, and better than anything homemade. Checked against `sdk.d.ts@0.3.231`:

```ts
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; suggestions?: PermissionUpdate[]; /* … */ },
) => Promise<PermissionResult | null>;

type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; /* … */ }
  | { behavior: 'deny'; message: string; interrupt?: boolean; /* … */ };
```

> ⚠ The web docs say `{ allow: true }`. **Wrong.** The installed version uses `{ behavior: 'allow' }`. Always trust the `.d.ts` file in `node_modules`.

**Why this solves the problem far more neatly:**

1. **The worker WAITS, it doesn't die.** An unresolved promise leaves the tool call suspended right there. Once approved, it continues **in the same session, same context** — **0 extra tokens.** An approach I once considered — "spawn a new task with the pre-approved payload" — would have cost an entire extra worker turn.
2. **You see the actual real payload**, not a description of it — the email body, not the words "send an email."
3. **`updatedInput` lets you EDIT before letting it through.** The `[Edit]` button on the dialog is real, not decoration.
4. **`deny` carries a `message`** that returns to the agent as a tool result — it knows why it was refused and can improvise, instead of failing dead.

**One mandatory change in `worker.ts`:** today we pass `allowedTools: role.tools`, and a tool inside `allowedTools` gets **auto-approved and never calls `canUseTool`.** So `allowedTools` may only contain the `read` + `write_local` groups; everything from `write_external` up has to fall through to `canUseTool`.

> ✅ **MEASURED 25/08, CONFIRMS THIS WORD FOR WORD** (case B vs. case C above). This sentence was
> written from reading the `.d.ts`, and it turns out to be the exact answer to the 19/08 mystery — it
> had been sitting in the spec for 6 days without anyone connecting the two.
>
> 🔴 **And this is the line that blocks "Notion can write."** `worker.ts` today pushes `mcp__<server>`
> (or `mcp__<server>__<tool>` for a read-only arm) straight into `allowedTools` ⇒ **auto-approved, no
> one asked.** Enabling writes for Notion on top of that means the agent edits the user's real workspace
> with no dialog whatsoever — while 3 of Notion's 28 tools are marked `destructive`. The mandatory order
> is **approval gate FIRST, write-capable arm SECOND**, and it can't be reversed.
>
> ⚠ Changing `allowedTools` changes the behavior of **every currently running arm**, including the
> `filesystem` arm from test #11. That's the right change, but not a silent one — test #11 has to be
> rerun afterward.

### 8d. The full flow

```
Agent calls a tool  ──►  canUseTool
                      │
      read/write_local level ──► { behavior:'allow' }            (nobody asked)
      write_external level   ──► plan already approved? ──► allow
                                    no ──► deny + reason
      irreversible level     ──► ASK THE USER ─┬─ [Go ahead]  ──► allow
                                          ├─ [Edit]      ──► allow + updatedInput
                                          └─ [Cancel]    ──► deny + message
                                              (expires 10 min ──► deny)
```

New events: `approval.requested` (carrying `toolName`, `input`, `plan_id`) and `approval.resolved`. Both carry `office` + `plan_id` like every other event, so the Telegram bridge reuses them as-is.

**On expiry, deny — never let it through by default.** If the user closes the laptop and goes to sleep, the work stops — that's the correct behavior.

---

## 8e. The text command set — ENGLISH, and it must be intercepted BEFORE it reaches the SDK

Vietnamese project, but going global: **commands are in English, replies follow the user's language.**

| Command | Does |
|---|---|
| `/stop` | interrupt the running work (= the `Esc` key) |
| `/approve` | approve whatever is pending |
| `/reject` | reject it |
| `/status` | what's running, how much it's cost |
| `/help` | list this exact table |

### ⚠ Risk of colliding with real commands — and how it's blocked

Claude Code has its own set of slash commands (`/clear`, `/compact`, `/model`…). The string we pass into `query({ prompt })` **goes straight to that same CLI**, so a sentence starting with `/` **could get interpreted as one of its own commands.** `/clear` slipping through wipes the Assistant's conversation context with no explanation to anyone.

**Rule, no exceptions: any string starting with `/` MUST be intercepted at `office.say()` and MUST NEVER be passed down to the SDK unmodified.**

```
user types ──► office.say()
                    │
     "/stop"        ├─► OUR command      → handled in code, 0 tokens
     "/clear"       ├─► not ours          → reply "no such command" + /help
     "//price"      ├─► escaped slash     → strip one "/" then send: "/price"
     "write a post…" └─► ordinary text    → forwarded to the Assistant
```

Three properties of this design:

1. **An allowlist, not a blocklist.** We don't need to know what commands Claude Code has today, or will have next year — anything that isn't ours doesn't get forwarded.
2. **Commands are handled in code, 0 tokens.** Throwing `/stop` at the model is paying to be stopped more slowly.
3. **`//` is the escape hatch** for someone who genuinely wants a sentence to start with a slash.

The same command set works identically in the UI and on Telegram — because both go through `office.say()`.

---

## 10. A total beginner building an "arm" on their own — through exactly three routes

You asked the right question: *if you're this confident, walk me through exactly what a total beginner does.*

### 10a. The Connector Builder — three entry routes, one output

All three produce **the same file**, `connectors/<name>.yaml`, and the runtime assembles it into an in-process MCP via `createSdkMcpServer` + `tool()`.

| Route | What the user does | Who it's for |
|---|---|---|
| **A · Paste a cURL** ⭐ | copy a cURL command from API docs or DevTools ("Copy as cURL") and paste it | **almost anyone can do this** — the main route |
| **B · Paste OpenAPI** | paste a URL or an `openapi.json` file | anyone with existing formal docs |
| **C · Fill in a form** | 4 fields: method · URL · header · example body | anyone with neither cURL nor OpenAPI |

**Why cURL is the main route:** it's something that **already exists** on almost every API docs page, and every browser can export it with a single right-click. The user isn't *writing* anything — they're *copying.*

```
┌─ New arm ─────────────────────────────────────────────┐
│ Name       [ My inventory                            ] │
│ Description ┌──────────────────────────────────────┐   │
│           │ Look up stock by product code. Returns  │   │
│           │ quantity in stock and price.             │   │
│           └──────────────────────────────────────┘   │
│                                                       │
│ Paste cURL  ┌──────────────────────────────────────┐   │
│           │ curl -X GET \                        │   │
│           │  https://api.shop.vn/items/{id} \    │   │
│           │  -H "Authorization: Bearer abc123"   │   │
│           └──────────────────────────────────────┘   │
│                                                       │
│ Inferred:                                             │
│   method       GET      → read-only, no approval needed │
│   parameter    id       (required, from {id})           │
│   key          ●●●●●●   → saved as SHOP_TOKEN            │
│                                                       │
│         [ Try it ]   [ Save ]                        │
└───────────────────────────────────────────────────────┘
```

### 10b. "No errors" comes from the **Try it** button, not from a promise

This is the most important part, and also the cheapest to build.

Click **Try it** → we make one real call with the real key → show the **verbatim response**:

```
✓ 200 OK · 180ms
{ "id": "SP-102", "name": "T-shirt", "stock": 47, "price": 250000 }
→ Understood. This arm returns: id, name, stock, price
```

or

```
✗ 401 Unauthorized
{ "error": "invalid token" }
→ Wrong or expired key. Fix the Authorization field and try again.
```

**No Save allowed until Try succeeds once.** A non-technical user doesn't need to understand HTTP — they just need to see a ✓. This is the point where "hoping it works" becomes "I watched it work," and it **eliminates almost the entire class of configuration errors** before any of them ever reach an agent.

Additionally: we save that sample response as the **example output** in the tool's `description`. The model knows in advance what shape it will get back.

### 10c. Where natural language works, and where it doesn't

| Part | Form | Why |
|---|---|---|
| **What this does** | ✅ natural language | becomes the tool's `description` — exactly what the model needs |
| **How to call it** | ❌ requires a concrete sample (cURL/OpenAPI/form) | without a schema the model guesses parameter names and **fails silently** |
| **The key** | ❌ has to be its own field | see §10e |

The user still "describes it in words" — just that their words land in exactly the field where words are effective.

### 10d. Description: who has to write it, and does editing require a rebuild?

| Kind | Does the user have to write a description? | Why |
|---|---|---|
| **A clean external MCP** (Notion, Google…) | ❌ **no** | the server already publishes `tools/list` with a description per tool. We only ask for a **display name** for the diagram node. |
| **A self-built connector** | ✅ **yes, and it's the only field** | there's no other source. That exact textarea becomes the tool's `description`. |

**Do they overlap?** No. For a self-built connector, the user's description is the **only** description — nothing to duplicate. For an external MCP, we **don't** add any description of our own to the tool; the display name is only used for the node and for the §1 capability line.

**Does editing the description mean "rebuilding" the node?**

There's no "rebuild" step for the user — a worker is already one-shot, the next run just constructs the server fresh. **But it isn't free:** the tool's description lives inside the tool's definition, which sits **before** the system prompt in the cached prefix. Editing the description = **changing the prefix = one cache rewrite** for every agent wired to that connector.

So the same rule as skills applies: **an explicit Save button, no autosave, and state the cost right next to the button** — *"Saving will make 2 workers rewrite their cache once."*

### 10e. Keys: **always structured**, never free-form text

Answering your third question directly: **do not use natural-language input like `ID=... \n KEY=...`.** Three reasons, the first one is the deal-breaker:

1. **The variable name has to match EXACTLY.** Notion's MCP reads `NOTION_TOKEN`, not `Notion token` or `TOKEN`. A free-text box would generate dozens of misspellings we can't predict.
2. **Parsing free text is fragile** at `=` inside a value, at whitespace, at quotes, at a multi-line key (Google's private key is multiple lines).
3. **Structure is what makes per-field instructions possible** — *"get this from Notion → Settings → Connections → Develop your own integration."* An empty text box teaches nobody anything.

**But the user never has to learn any format**, because the form is **generated**:

| Source | Where the fields come from |
|---|---|
| Existing catalog (Notion, Google, Slack) | we ship a fixed list of fields + per-field instructions |
| Pasted MCP config | scan `env`/`headers` for empty slots, ask only for those |
| Self-built connector | inferred from the cURL that was pasted — `Bearer abc123` → one field, suggested name `SHOP_TOKEN` |

The experience is always **"fill in 2 fields"**, never "learn a format." The difference is those 2 fields are generated by us, not invented by the user.

### 10f. stdio stays — you're right

Streamable HTTP is for remote, **but stdio isn't legacy**: it's the only way to run an arm **on your own hardware** — reading a file on your machine, calling a device on your LAN, later on your own VPS. That's something no cloud service can do, and it fits the principle "results live inside your own folder."

Three kinds locked in, no one replacing another:

| | Used when | Where the key goes |
|---|---|---|
| **stdio** | an arm running on your machine/VPS | the `env` of the child process |
| **Streamable HTTP** | a service already sitting behind a URL | `Authorization` header |
| **Self-built connector** | your own single HTTP endpoint | header, injected by us |

---

## 11. The Assistant is ONE PERSON — a mailbox and two independent states

### 11a. This isn't a design choice, it's a technical requirement

`askSession()` runs `resume: sessionId` then overwrites `sessionId` with the new id. **Two overlapping calls both resume the same id, both overwrite it, and ONE TURN IS LOST OUTRIGHT** from the conversation memory. The user sees the Assistant "forget" what they just said and has no idea why.

So the product principle *"one person does one thing at a time"* lines up exactly with a technical constraint. Written into the spec, and it's correct on both levels.

**But workers run in parallel freely** — they're stateless functions, each with its own session. These are two **entirely independent** states:

```
Assistant: idle ─────► thinking ─────► idle
Workers:      2 running ────────────► 1 ────► 0
```

The UI has to communicate **both**, or the user sees silence and assumes the system is dead. Event: `office.activity { assistant, workers, queued }`.

### 11b. Mailbox — batches, doesn't block

| Situation | Handling |
|---|---|
| Assistant is **busy**, user sends a message | goes into the mailbox. Several in a row → **batched into ONE turn** |
| Assistant is **idle**, workers are running | replied to immediately. This is "using the dead time productively" |
| User assigns **new work** while old work is running | recorded, put into `deferred`, done after the current job finishes |
| Mailbox full (>12 messages) | politely refused: *"You're sending messages faster than I can read — I still have N unread"* |
| Text commands (`/stop`…) | **jump the queue**, handled in code, 0 tokens |

**Batching is a real saving, not just tidiness.** Measured: firing 4 messages at once → **2 calls instead of 4.** And it's *more correct*: three messages typed in quick succession are one thought — answering message 1 once message 3's context already exists means answering wrong.

The merged message is built with **code**, not an LLM call to "summarize" — that would be buying smoothness with tokens, forbidden by criterion four.

### 11c. The lock has to be a REAL MUTEX, not a flag

The first version used `busy = true/false`. Not enough: `run()` calls `plan()` then `report()` from a different pumped branch, both set the flag, whichever finishes first clears the other one's flag — **the exact bug this whole mechanism exists to prevent.** It has to queue with a promise chain, and count depth so nesting doesn't release the lock early.

Three places have to go through the lock: `route()` · `plan()` · `report()`. During the DAG-running stage the lock is **not** held — that's exactly the window where the Assistant is free to talk.

### 11d. The Assistant's tracking table is held by CODE, not by the Assistant

The idea "the Assistant needs a table, with flags for what's stale and what's unprocessed" is right — but **that table has to live in source code, not in the prompt.**

An Assistant forced to reason over a backlog list carries that list in the context of **every turn**, and it grows over time. Instead: the queue is a real data structure, code drops stale entries, and **the Assistant only ever sees the current batch.**

### 11e. `/stop` stops the WHOLE system — **FOUR** things, not three

Interrupts running workers **+** **interrupts the Assistant's own turn** **+** clears the mailbox **+** drops deferred work. Leaving any one of the four in place means the user hits Stop and still sees the system keep going — exactly what they just said not to do. The reply states exactly what was cut and how much work was dropped.

> ⚠ **The second item was overlooked until 20/08, and this table is the evidence.** The other three had enforcing code from the start; the Assistant's turn had **no `AbortController`** in `Assistant.run()` at all — no handle existed to interrupt it. Exactly the rule *an invariant is only real once source code enforces it*: the sentence "stops the WHOLE system" read very convincingly and was wrong the entire time.

**Three variables, all three have to be checked before concluding "it's idle":**

| | variable | meaning |
|---|---|---|
| A plan is running | `office.state === 'working'` | there's a DAG on the diagram |
| The Assistant is mid-turn | `mailbox.isBusy` · `clearing` | **cannot** be derived from the queue |
| Work still queued | `mailbox.size` · `deferred.length` | |

Bug fixed 20/08: the old check only asked `state` + `size` + `deferred`. While the Assistant was thinking, the batch had already been `take()`n out of the queue so `size === 0`, and `state` was still `idle` since no Plan existed yet ⇒ `/stop` replied *"Nothing is currently running."* right before the actual answer appeared. **The system lied about its own state**, on the very first action of the session.

**`/stop` interrupting the Assistant's turn does NOT contradict §11f** (*"default to letting it finish, don't kill it"*). That rule protects a worker's **already-paid-for draft**: killing it at 80% loses 80% of the money already spent. A `route()` turn produces no draft at all — interrupting it only loses one reply, exactly what the user just asked for.

**Three consequences that must happen together, missing one leaves a gap:**

1. `FailureKind` gets a new `'stopped'` value — an interrupt is **not an error.** Without this label, the case closes as `failed` and the log records *"the system got it wrong"* for something the user explicitly asked to stop. Same reasoning that split `blocked` from `failed` (SPEC-offices §6): the log has to distinguish *we messed up* · *we're waiting on you* · *you said stop.*
2. **Exactly ONE reply.** `/stop` has already replied, so `pump()` and `Office.run()` **must not** send another message for `kind === 'stopped'`.
3. **The session pointer rolls back.** `sessionId` gets written from the `init` message, i.e. right at the start of a turn — keeping the new pointer after an interrupt means the next turn's `resume` lands on a **half-written** record, and the cost is the entire conversation memory. The old record is still intact on disk (append-only), so rolling back is safe, and it's semantically correct too: an interrupted turn **never happened.**

⚠ The mechanism is `abortController`, **not** `Query.interrupt()` — a lesson already paid for once in §8, don't try it again.

---

## 11f. A worker is running and the user changes their mind — three tiers, three different answers

### Tier 1 — "inject new input into a running worker": NOT POSSIBLE, and that's good news

A worker is a one-shot `query()`. It has **no mailbox.** There's no API to feed it another instruction mid-run — only **kill it** or **let it finish.**

Sounds limiting, but it erases a hard question entirely: *"the worker is busy but the exact same worker is needed again — now what?"* — **never happens.** A worker is stateless, so one role can run multiple tasks at once; there's no contention over a *person*, only a concurrency cap. The "agent is a stateless function" decision from the first session pays off again here.

### Tier 2 — kill it, or let it finish: economics decides, not gut feeling

`cost ≈ turns × prefix × 0.1` means **a worker already 80% through has already spent 80% of its money.**

| | Kill it now | Let it finish, then fix it |
|---|---|---|
| Money already spent | **lost entirely** | kept |
| Money still to spend | starts **from zero** again | the remaining 20% + one fix-up task |
| Input for the next step | nothing | **a draft to EDIT, not write from scratch** |

Fixing a draft is far cheaper than writing a new one. So **default: let it finish.** Matches real life — telling a writer "make it younger" gets you an edit to the draft, not a torn-up page and a fresh start.

**Killing is reserved for `/stop`** — the user explicitly saying "this is going the wrong way," exactly the moment when wasting the money already spent is correct. Never auto-killed based on any guess.

### Tier 2b — the "mess" left behind after a kill: SAY SO, don't erase it

A killed worker may have already written some of the files it was assigned. The first version returned `artifacts: []` — i.e. **lying that the disk is clean**, and the next run would overwrite silently.

Now: `stoppedReceipt` scans `brief.outputs`, lists files that **actually exist**, and says *"N files were partially written, review before using."*

**Not deleted.** A partial file can still be useful, and deleting something the user hasn't even looked at yet is their call to make, not ours.

*(Better than it sounds: `CORE_PROMPT` already says "write output in ONE `Write` call." So the mess is usually "2 of 3 files done," not "half a file.")*

### Tier 3 — two independent things: a queue, one plan at a time per office

The instinct "put the command in a job queue and walk away" (like a goroutine channel) is correct. But the queue has to be **visible**, not a private array — so `office.activity` carries an added `jobs` field, and the UI shows *"1 job queued."*

**Why NOT run two plans in parallel within one office:**

1. **The Assistant is one manager.** Two plans running at once means two summaries interleaving, and the user can't tell which report belongs to which job.
2. **File collisions.** `Scheduler.validate` blocks two tasks from writing the same path — but **only within the same plan.** Two parallel plans could overwrite each other with no detection.
3. **Concurrency budget belongs to the whole company.** Two plans compete with each other, and the one the user is actually waiting on could get starved by one running in the background.

**Want parallelism? Use MULTIPLE OFFICES** — that's exactly why offices exist.

> **Rule: parallel BETWEEN offices, sequential WITHIN one office.**

### Tier 3b — handoff when a queued job's turn comes

Queued work is usually a continuation of what just finished (*"make it younger again"*). Not telling it where the previous result landed means it **rewrites from scratch** instead of editing — much more expensive, and it throws away a draft already paid for.

So when pulling a job out of the queue, append one sentence **built with code, 0 tokens**:

```
(The previous job just finished, its result is already at: artifacts/T-01/post.md.
 If this request is a revision of that job, EDIT the existing file, don't start over.)
```

Same mechanism as the post-interrupt handoff (§3b), and it's cheap for the same reason: the Assistant only ever sees the **receipt** anyway, so "where did the result land" is information we already have in hand.

---

## 12. Secrets: `.env` is the main path — correcting §10e

§10e said secrets are "never free-form text." **Overstated.** `.env` is **not** free-form text — it's a line-based format with a well-tested parser. The "parsing will break" argument doesn't apply here.

So there are **two entry paths, one shared store**:

| Path | For whom |
|---|---|
| **`.env` textarea** ⭐ | someone pasting from an MCP's README — variable names already correct |
| **Generated form** | someone picking from the catalog (Notion, Google…) — never has to type a variable name |

### Rules for reading `.env` — worth getting exactly right, easy to get wrong

```
KEY=value            → "value"
KEY="value"          → "value"          DOUBLE quotes stripped, \n interpolated
KEY='value'          → "value"          SINGLE quotes stripped, NOT interpolated
export KEY=value     → "value"          strip the export prefix
KEY=value # comment  → "value"          # outside quotes is a comment
KEY="a # b"          → "a # b"          # inside quotes is a literal character
# whole line         → skipped
(blank line)         → skipped
```

**No standard forbids quotes.** The opposite, actually: **quotes are required** when a value contains whitespace, `#`, or a newline — Google's private key is the textbook example. Using `""` as a habit is safer.

What §10e got right and still holds: **the variable name has to match exactly**, and we can't infer that name from the MCP itself (the protocol doesn't publish "what variables I need" — that's a startup requirement of the child process, happening before the handshake even occurs). Three layers help a non-coder avoid ever typing a variable name: a curated catalog → scanning a pasted config for empty slots → running a test call and reading stderr.

---

## 9. Order of work

Sorted by *how many walkthrough tests unlock* per unit of effort:

| # | Item | Unlocks | Size |
|---|---|---|---|
| 1 | System tools on by default (§5) | tests 4, 9, 10A no longer need an editor | **very small** |
| 2 | Wire edges respond instantly (§2) | feel of using the product | **very small** |
| 3 | Plan goes into chat (§3a) | groundwork for the bridge | **very small** |
| 4 | Edit intro + skills in the UI (§1, §4) | tests 1, 2, 5, 8 | medium |
| 5 | Auto-generated capability line (§1) | the Assistant assigns work correctly | small |
| 6 | Mid-run interrupt + text commands (§3b) | Claude Code muscle memory | medium |
| 7 | Two-tier approval gate (§8) | **test 10, stage C**, and everything that touches the outside | large |
| 8 | Wiring MCP in the UI, routes A + B (§6) | test 10, stage B | medium |
| 9 | Keys per connector (§7a) | ships alongside #8 | small |
| 10 | Self-declared arm, route C (§6) | **the specialty feature** — ✅ **built 31/08 as a CLI** (`SPEC-arms §16t`); REST branch 🔒 dropped | large |

The first three items combined are less than a single afternoon and clear out most of the ❌ marks in `TEST-WALKTHROUGH.md`. Do these first.

---

## Sources

SDK API: read directly from `node_modules/@anthropic-ai/claude-agent-sdk/{sdk,agentSdkTypes}.d.ts` version `0.3.231`.

MCP transport: [Transports — Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) · [Claude Agent SDK — TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript)
