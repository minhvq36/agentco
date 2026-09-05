# 10 use cases — the system's measuring stick, and blanks for office templates

**Date:** 2026-08-15 · **Purpose:** to measure how far the system actually goes, not to advertise it.

Each use case is written as **an office** (`offices/<code>/`), so once it works it **already is** a template — zip the folder and you're done. That's why this file matters more than a list of ideas: it's both the exam question and the product.

Each entry has exactly four parts: **who hurts where · how it's built · what it tests · what the system is currently missing.** The fourth part is the one worth reading.

---

## Summary table

| # | Office | Tests something nothing else tests | Ready? |
|---|---|---|---|
| 1 | Content workshop | real DAG parallelism, voice accumulation | ✅ works today |
| 2 | Customer support | HOT/COLD knowledge retrieval quality | ✅ |
| 3 | Bookkeeping & invoices | input is a user's file, output numbers must be RIGHT | ⚠ missing verification |
| 4 | Competitor tracking | recurring runs, comparing against the last run | ❌ no scheduler yet |
| 5 | Localization | terminology consistency across many shifts | ✅ |
| 6 | Contract review | documents LONGER than context | ❌ no chunking yet |
| 7 | Spreadsheet workshop | does the `eco` tier actually pay off | ✅ |
| 8 | Resume screening | many inputs at once, consistent scoring | ✅ |
| 9 | Progress reports | `Bash`/`Glob` tools, reading a real repo | ✅ |
| 10 | Personal assistant | MCP + secrets + approval before acting | ⚠ missing an approval gate |

---

## 1. Content workshop

**Pain:** a solo fan-page/blog writer loses 2–3 hours per post, and by post #20 they're still re-explaining "what my voice sounds like."

**Built as:**

| Employee | tier | tools | job |
|---|---|---|---|
| `researcher` | standard | Read, Glob, Grep, WebSearch, WebFetch | finds material, writes files with sources |
| `writer` | standard | Read, Write | writes the draft |
| `reviewer` | eco | Read, Write | checks voice + errors, writes notes |

The charter holds the brand voice (≤500 tokens). After a few shifts, `knowledge/shared/` fills up on its own with things like "customers often ask X," "don't use word Y."

**Tests:** three posts running in parallel = three tasks in the same `step`, with no dependency between them → measures whether the cache priming gate actually works (the first task pays `cache_write`, the next two only pay `cache_read`). This is the only use case that naturally produces real parallelism.

**Missing:** nothing. Works today.

---

## 2. Customer support

**Pain:** a shop owner answers the same 20 questions every day, and gets their own policies wrong because they can't remember them.

**Built as:** one `responder` (eco) + one `librarian` (standard, only runs when new documents need ingesting). Return policy, price list, FAQ get loaded into `knowledge/shared/` as ≤250-token nodes.

**Tests:** this is a **knowledge retrieval** test, not a text-generation test. The question "can I exchange an item after 10 days" has to pull exactly the right policy node into COLD without pulling 20 others in with it. If `KnowledgeStore.cold()`'s keyword scoring isn't good enough, this use case exposes it immediately — use case 1 wouldn't.

**Missing:** no Librarian yet to auto-chunk long documents into nodes — currently nodes have to be hand-written.

---

## 3. Personal bookkeeping & invoices

**Pain:** at month-end, a freelancer sits down and manually sorts 200 statement lines just to find out how much they made.

**Built as:** a `bookkeeper` (eco, Read/Write/Glob) reads a bank-statement CSV from `artifacts/input/`, categorizes it, writes `monthly-report.md` + `categorized.csv`.

**Tests:** the first use case where **a wrong output is flat-out wrong**, not just "not great." It tests something text can't test: does the model make up numbers.

**Missing — and this is a real gap:** the system currently **has no way to verify a number**. The receipt says "categorization done" and we just trust it. There needs to be a `verify` mechanism that runs on **code, not an LLM** (e.g.: category totals must sum to the statement total). Not built yet, and this should exist before the system is trusted anywhere near someone's money.

---

## 4. Competitor tracking

**Pain:** wanting to know what a competitor changed this week — pricing, new features — but nobody's going to manually check every week.

**Built as:** a `watcher` (standard, WebSearch/WebFetch/Write) scans a list of URLs, writes `snapshot-<week>.md`; a `differ` (eco) compares it against last week's snapshot, reports only what CHANGED.

**Tests:** memory **across shifts**. Every other use case only needs to remember within a single shift; this one needs "what did it look like last time."

**Missing:** **no recurring scheduler yet.** The system is entirely passive — someone has to type the command. This is a small item (a cron inside the daemon), but without it the entire "tracking" family of use cases can't exist.

---

## 5. Localization & terminology

**Pain:** translating product docs, and the same concept gets called something different every time it's translated.

**Built as:** a `translator` (standard) + a `term-keeper` (eco). The terminology table lives in `knowledge/shared/` — one node per term. `term-keeper` runs after every shift, adding any new terms it encountered.

**Tests:** whether the knowledge store actually makes the system **get better over time**. Shift 10 should be more consistent than shift 1 — and that's **measurable** by counting how many different translations a given term received.

**Missing:** nothing. This is also the use case that most clearly demonstrates the knowledge store's value, so it's worth turning into a template early.

---

## 6. Contract review for freelancers

**Pain:** getting handed a 15-page contract, not knowing which clauses are unfavorable, and a lawyer being way too expensive for a 20-million-dong contract.

**Built as:** a `reader` (standard) splits the contract by clause, writes one file per section; a `flagger` (deep) scores the risk of each clause; a `summarizer` (eco) rolls it up into a checklist.

**Tests:** a document **longer than a single task's budget**. This is a fundamentally different problem from every use case above it.

**Missing:** the system has no way to chunk long documents yet. The Assistant has to guess "how many parts to split this into" without knowing how long the file is — it isn't allowed to read the file. This needs a size-measuring tool (`Glob`/`Bash wc`) or a cheap `survey` step run beforehand. **Doesn't exist yet, and won't emerge naturally.**

⚠ Product warning: this is territory where harm is easy to cause. If this template gets built, it must carry a very clear line stating this is **not legal advice**.

---

## 7. Spreadsheet workshop

**Pain:** having a raw CSV of data, wanting a summary table + a few key numbers, and not knowing how to pivot.

**Built as:** a `cleaner` (eco) normalizes columns, an `analyst` (standard) aggregates, a `charter` (eco) writes chart descriptions.

**Tests:** **whether the `eco` tier actually pays off.** SESSIONS_MEMORY notes that `eco` uses 2.5x the turns and 2.17x the tokens but is still 38% cheaper — for *that particular* task. Data work is highly mechanical, exactly where `eco` should win. If it loses here, the tier-selection rule needs rewriting.

**Missing:** nothing. But it should be run against `bench/tier-compare.mjs` to get real numbers instead of guessing.

---

## 8. Resume screening

**Pain:** posting a job listing, getting 80 resumes, and reading them all taking a whole day.

**Built as:** a `screener` (eco) reads each resume against a fixed rubric in the charter, writes one scored line; a `ranker` (standard) ranks them and explains the top 10.

**Tests:** **consistency across repeated runs**. 80 resumes = 80 tasks, or a few batched tasks — this is where the "fewer, larger tasks over many small ones" rule gets genuinely tested, because a ~13,200-token floor per call multiplied by 80 is a very different number than multiplied by 8.

**Missing:** nothing technical. But this use case touches **someone else's personal data** — the template has to clearly state that resumes stay on the user's machine and go nowhere outside Anthropic.

---

## 9. Project progress reports

**Pain:** a solo dev, come the weekend, can't remember what they did in order to write a changelog or update a client.

**Built as:** a `historian` (eco, tools `Bash`, `Glob`, `Grep`, `Read`) reads `git log` and changed files; a `writer` (standard) writes an update for **someone who isn't a developer**.

**Tests:** a real system tool (`Bash`) in an agent's hands, and `use_preset: true` for a code-reading role — the only use case where the `claude_code` preset's 6,300 tokens are actually worth paying for.

**Missing:** nothing. This is also the easiest use case to dogfood — we're the users ourselves.

---

## 10. Personal assistant — the part of openclaw that's actually worth having

> **Source:** read from openclaw's README, community discussion, and news coverage of Anthropic's policy — checked 2026-08-15. Source list at the end of this section.

### What OpenClaw actually is

Launched 2025-11-24 (formerly named Warelay → Moltbot → Clawdbot), renamed to OpenClaw at the end of January 2026, **over 380,000 GitHub stars**. This isn't a small project — it's *the reference competitor*, and it's also proof the market is bigger than we assumed.

Shape: a **self-hosted personal assistant whose primary interface is a messaging app** — WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Google Chat, and a dozen other channels. Architecture consists of a **Gateway** (a local control plane for sessions, tools, events, channel connections) + Control UI/CLI/TUI + a companion app for voice, camera, screen capture. Extended via its own **plugin SDK** and a **ClawHub** marketplace, plus an MCP registry — meaning our earlier note ("forces you to write an MCP server") **wasn't quite right**: it has its own plugin SDK, which is even harder.

Designed for **a single operator**. Its own docs warn: *"Tools run on the host machine for the primary session unless you configure a sandbox yourself."*

### What the community actually uses it for — and what makes them quit

**Things people keep using it for** (from Ask HN: Who is using OpenClaw?):

- Personal memory hooked to Obsidian, queried over WhatsApp — the praised point: *memory lives under version control, is readable and editable, and isn't locked to one vendor*
- Someone set it up in a family Telegram group to collect stories from 50+ relatives, queryable with context, saved as a multi-generational archive
- A gardener wired up MCP + Xero, turning site photos into 14–32-page PDF quote proposals
- A student auto-generates flashcards from Obsidian notes every night

**Reasons people quit:**

| | |
|---|---|
| **Money** | one person reported **$100/month** in API cost just for a morning briefing — that only actually ran "once or twice a week" |
| **Reliability** | scheduled work *"breaks every other day,"* needs constant fixing, and the system even claims to have self-repaired when it hasn't |
| **Setup** | one person burned *"$40–50 in one week just troubleshooting"* a Raspberry Pi install before giving up |
| **Security** | handing the agent *"full, unrestricted API-key privileges"* — some worried it would delete a repo, delete system files |
| **Burning tokens** | the sharpest criticism: **work that's scheduled and deterministic belongs in a script, not in an LLM loop.** Regenerating the same solution every time is wasted tokens |
| **Overall verdict** | *"a worse, slower, less capable version of Claude Code"*; after months of use, some concluded it's **an orchestration UI layer over pre-existing automations**, not a new way of working |

**What the SUCCESSFUL cases have in common:** all of them **keep a human in the loop**, all **accept non-deterministic output**, and all solve a problem **no app currently solves** (archiving family stories, photo-based quotes). Every failure case was an attempt to replace cron — exactly where reliability is what matters.

> These three points read almost like a mirror image of where we should stand.

### Keep — four jobs that account for most of the value

| Job | Employee | secrets | Why it's worth it |
|---|---|---|---|
| **Triage inbox & draft replies** | `inbox` (eco) | `GMAIL_TOKEN` | daily frequency, clear pain, immediately testable |
| **Summarize calendar + prep for meetings** | `scheduler` (eco) | `GCAL_TOKEN` | cheap, runs in 30 seconds, value visible instantly |
| **Notes → action items** | `notetaker` (standard) | `NOTION_TOKEN` | somewhere people have already been pouring data in |
| **Search & summarize the web on request** | `scout` (standard) | — | **needs no MCP at all** — `WebSearch`/`WebFetch` are native tools |

The fourth job is worth noting: it **needs nothing plugged in at all**. Of the four highest-value jobs, one works from minute one — while openclaw requires installing a Gateway, wiring up a chat channel, and for many people, tens of dollars spent troubleshooting.

### Drop — technically possible but not actually worth it

This list now has evidence behind it, not just guesses:

- **Integration breadth (50+ channels, ClawHub).** Looks great on the homepage. Every real use case the community reported centered on 2–3 things: a notes archive, one messaging app, one business service. Maintenance cost scales linearly, value flattens to near-zero after the third integration.
- **Scheduled work run by an LLM.** This is where openclaw fails hardest — breaking every other day, burning $100/month for a morning briefing. **Lesson for us:** when we build recurring scheduling (gap #2 below), the **deterministic part has to be code**, with the LLM only touching the part that genuinely needs judgment.
- **Automation with no human approval.** Every success story kept a human in the loop; every failure story didn't.
- **Companion app: voice, camera, screen capture.** A large surface area that never once showed up in any real use case people actually reported.
- **An always-on assistant listening to everything.** Constant token spend traded for a feeling. This architecture deliberately does the opposite: an agent arrives, works, and terminates.
- **Chains of agents calling agents.** The single biggest source of burned tokens — and on our canvas, it **can't even be drawn**.
- **Forcing users to write plugins/MCP.** An absolute wall for our core customer segment. This is exactly where `SPEC-connectors.md` steps in: *describe the API, don't write code that calls it.*

### ⚠ Policy risk — read carefully, it touches the project's economic argument directly

**What actually happened:** on 2026-04-04 Anthropic **cut off** Claude subscription usage for third-party harnesses like OpenClaw. Stated reason: ToS violations, and **causing abnormal load because they route around Claude Code's prompt-cache optimization — calling the model fresh every time**.

Anthropic then announced a separate **"Agent SDK credit"** allotment for paid subscribers (Pro $20 · Max 5x $100 · Max 20x $200 per month), planned to take effect 2026-06-15 — then **POSTPONED**. The official help page currently states the change *"is no longer in effect as of 06/15"* and **nothing has changed from the prior policy**.

**agentco's position — different from openclaw at exactly two make-or-break points:**

| | OpenClaw | agentco |
|---|---|---|
| How it gets access | **reverse-engineers** Claude Code's auth flow | uses Anthropic's **official Claude Agent SDK** |
| Prompt cache | routes around it — the exact reason it got cut off | **the whole architecture is built around preserving it** |

The announced policy (even while postponed) explicitly states that credit allotment covers *"third-party apps authenticating with your subscription via the Agent SDK"* — which is **exactly agentco's shape, and permitted**.

**But this is still a risk to keep watching, not a settled matter:**

1. If the credit split gets turned back on, Pro users get only **$20/month** for agentco — against a measured cost of $0.05–0.20 per task, that's roughly **100–400 tasks/month**. Enough for a solo user, **tight** for anyone running multiple offices.
2. Running out of credit either falls back to standard API pricing (if usage-based credit is enabled) or **stops completely until next month**.
3. Credit is **per-person, not pooled** — this affects any plan to build a team edition.

**Three things worth doing because of this finding:**

- **`agentco cost` has to be able to say "how much is left."** Today it only reports what's been spent. If the credit has a ceiling, knowing what remains is a feature, not decoration.
- **The sales pitch should state the prompt-cache story directly.** Anthropic has publicly said the cutoff reason was harnesses breaking the cache. This is the best possible moment to say "we're built around preserving it" — and we have measurements to prove it, not just a claim.
- **`ProviderAdapter` still has to be kept as-is.** No need to implement a second provider yet, but don't lose the socket for it.

**Sources:** [openclaw/openclaw](https://github.com/openclaw/openclaw) · [Ask HN: Who is using OpenClaw?](https://news.ycombinator.com/item?id=47783940) · [Anthropic closes door on subscription use of OpenClaw — The Register](https://www.theregister.com/2026/04/06/anthropic_closes_door_on_subscription/) · [Claude Code subscribers will need to pay extra — TechCrunch](https://techcrunch.com/2026/04/04/anthropic-says-claude-code-subscribers-will-need-to-pay-extra-for-openclaw-support/) · [Anthropic reinstates third-party agent usage — VentureBeat](https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch) · [Use the Claude Agent SDK with your Claude plan — Anthropic Help Center](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) · [OpenClaw — Wikipedia](https://en.wikipedia.org/wiki/OpenClaw)

**Thesis:** what people actually want from a tool-connected personal assistant is **four** jobs, not forty.

### Where the real economic gap actually sits — now with evidence

It's not "connect more tools" — openclaw already has 50+ channels and people still quit. It sits in three places, and all three are **exactly where openclaw hurts most**:

| Gap | Evidence from openclaw's side | What we already have |
|---|---|---|
| **Controllable cost** | *$100/month for a morning briefing that runs 1–2 times a week*; Anthropic cut them off because harnesses *break prompt cache* | the whole architecture is built around the prefix cache; `$0.09 · 4 turns` shown right on screen |
| **Running on a legitimate subscription** | openclaw got cut off for reverse-engineering the auth flow | uses the **official Agent SDK** — exactly the permitted path |
| **Results are the user's own files** | openclaw's own users cite this as the thing they praise most: *"memory lives under version control, readable and editable"* | markdown + yaml in their own folder, from day one |

The third point is worth noting: it's something **the openclaw community itself named as the reason they stayed**, not a hypothesis of ours. It confirms that the "own the artifact, not the prompt" principle is a sellable argument, not just an engineering decision.

**And where NOT to stand:** don't compete on "does more things." Openclaw has 380,000 stars and still gets called *"a worse, slower version of Claude Code."* Breadth isn't a moat.

**Missing — the most serious gap across all 10 use cases:** there's still no **approval gate**. The `needs_human` state already exists in the receipt schema but **there's no screen to approve it from**. Without it, the four jobs above stop at "drafted," never getting permission to actually hit send. This item should be built before the Telegram bridge.

---

## Summary: these 10 use cases expose 5 gaps

Ordered by build priority, not by use-case number:

| # | What's missing | Blocks which use case | Size |
|---|---|---|---|
| 1 | **Approval gate** (`needs_human` has a schema, no screen) | 10, and anything with an outward-facing consequence | medium |
| 2 | **Recurring scheduler** | 4, and the whole "tracking" family | small |
| 3 | **Code-based verification, not LLM-based** | 3, 7 — anything where an error is a flat-out error | medium |
| 4 | **Long-document chunking** (Librarian) | 2, 6 | medium |
| 5 | ~~**`agentco resume`**~~ ✅ **already exists** — the `/resume` slash command (`commands.ts`), measured in session 6 step 7d | any long-running use case that hits its quota | small |

Three of the five are **small or medium**. None require an architecture change — that's good news, and also evidence the foundation was laid in the right place.

## Four use cases to build into templates FIRST

Chosen by payoff-to-effort ratio, not by how appealing they sound:

1. **#9 Progress reports** — we're the users ourselves, instant feedback, nothing missing.
2. **#1 Content workshop** — already works, and it's the best video-recording scenario (parallelism you can actually see).
3. **#5 Localization** — proves the knowledge store's value with a countable number.
4. **#10 Personal assistant, `scout` only** — the version that needs nothing plugged in, works from minute one.

Three use cases still lacking infrastructure (3, 4, 6) are for later — building them early would ship a template that promises more than it can deliver.
