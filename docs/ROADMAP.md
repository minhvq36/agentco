# ROADMAP

**Updated:** 2026-08-14
**Currently working on:** P2 (AgentCo). P1 (Claude Code visual control layer) **deferred** — will become the "Engineering room" inside P2.

---

## 0. Being honest about the 1-week milestone

The whole spec in `SPEC-2026-08-14-agentco.md` is **1–2 months** of work, not one week. If we tried to build that spec whole in 7 days, day 7 would land us with a system that's 60% working — which means **it can't go live**, which means the whole week is wasted.

So week 1 gets its own scope, cut ruthlessly, below. **Rule: whatever is or isn't done, we go live at the end of day 7.** The deadline is protected by cutting scope, not by stretching the timeline.

---

## Week 1 — the go-live-able build (M0)

Goal: **a stranger downloads it, runs it, hands it a real task, watches the agent team finish it, and can message it over Telegram.** That's it. Nothing more.

### In scope

| # | Item | Note |
|---|---|---|
| 1 | Daemon + Claude Agent SDK + master session | `SPEC-cli.md` §1 |
| 2 | TaskBrief / Receipt protocol + hard validation | 800-token ceiling — **do this on day one**, retrofitting it later is very hard |
| 3 | DAG scheduler + concurrency + **cache priming gate** | `SPEC-token-economy.md` §3 |
| 4 | Tiered prompt L0–L7 | §2 — getting this wrong wrecks the whole cost target |
| 5 | 4 roles: `researcher`, `writer`, `coder`, `reviewer` | `medium` skill level only |
| 6 | Knowledge v0: markdown + frontmatter, `index.json`, keyword search | **no Librarian yet, no two-tier HOT/COLD yet** |
| 7 | Web UI: Plan + In Progress + Chat + log drawer | `SPEC-ui.md` §2.1–2.4, rough cut |
| 8 | Telegram long-poll bridge + pairing by code | no server needed |
| 9 | `agentco cost` + `logs/usage.jsonl` | if we're not measuring it, we don't know we're burning money |
| 10 | `LICENSE.md` (FSL) + README + a 90-second video | go-live needs this too, not just code |

### Items that came up after the SDK evaluation — where do they go

| Item | Week 1? | Why |
|---|---|---|
| **Split core / user skills** | ✅ **YES** | Retrofitting prompt tiering later means rewriting it — same reasoning as Task/Receipt |
| **Handle subscription quota running out** (§9b) | ✅ **YES** | Will definitely happen to real customers. Going live without this = losing trust on the very first encounter |
| `concierge` / `quick_action` | ❌ M1 | An optimization, not a feature. Week 1, master calling a regular worker still works fine |
| `use_preset: false` for non-coding roles | ✅ **YES** | One yaml field, 5 minutes of work, saves 5.5x |

### NOT doing in week 1

Librarian · two-tier HOT knowledge · visual graph · manual document ingestion · Ed25519 license keys · Docker · `bench` · replay · tier escalation · Zalo/Messenger · adding roles via UI · Tauri · `concierge`.

### Suggested pace

| Day | Work |
|---|---|
| 1 | Daemon + SDK + master chattable over the terminal |
| 2 | Task/Receipt + one worker running end-to-end |
| 3 | DAG scheduler + parallelism + priming gate |
| 4 | Knowledge v0 + 4 roles |
| 5 | Web UI |
| 6 | Telegram + `cost` |
| 7 | README, video, license, go live |

If day 4 is running behind: drop item 6 (knowledge) entirely, ship with static roles. **Knowledge is the thing most worth sacrificing, because it can be improved later without rewriting the architecture.** Task/Receipt and prompt tiering cannot be treated that way.

---

## M1 — Efficiency & durability + Connectors (2–3 weeks after go-live)

**Self-built arms** — this is the signature feature, weighted equally with the efficiency work.
**⚠ Rewritten 08/31: REST DROPPED from v1** (reasons + reopening conditions: pinned block at the top of `SPEC-connectors.md`).
The signature feature **isn't REST**, it's *"a non-coder DECLARES a capability, we generate the MCP"* — and the
first customer of that sentence is the **CLI**, which has run end-to-end since 08/31.

- ✅ Path A: paste MCP config + Test button + assign by role — **built**
- ✅ **Path B′: wrap a CLI command** (`SPEC-arms §16`) — **built**, still owes a "Try one action" button and wiring
  `confirm` into the approval gate
- ~~Path B: hand-written form defining a REST action~~ 🔒 **dropped**
- ~~2,000-token connector cap~~ dropped as of 08/23 (killed by the measurements) · ~~blocking hosts outside `base_url`~~
  went with REST · **a token only ever holds a variable NAME** stays, and that's a rule for the whole product
- 🔴 **Block `curl`/`wget`/`Invoke-WebRequest` in `run:`** — a trap that exists precisely because REST was dropped

Efficiency & durability work:

- Librarian + `_inbox` queue + dedup + archive
- Two-tier HOT/COLD knowledge + `knowledge_version`
- `agentco bench` + 5 golden scenarios + pinned thresholds
- Invariant test suite (`SPEC-2026-08-14-agentco.md` §10)
- Replay by sub-branch
- Master compaction that preserves the prefix
- Tier escalation on failure
- Add roles via UI, hot reload

This is the phase that turns a working product into one that **doesn't get more expensive over time**.

---

## M2 — Sellable

- Ed25519 offline-signed license keys (already designed in `product-decisions-2026-08-03.md` §5 — reused as-is)
- Gumroad/Polar for payments, no in-house backend
- ~~**Connector: paste cURL, paste OpenAPI/Swagger**~~ 🔒 **DROPPED 08/31** along with REST. What replaces it:
  **the CLI version of "Copy as cURL"** — the user pastes a command line **they've already run successfully**, we
  parse the argv and ask *"which part changes each time?"* They **copy**, they don't **write**. (`SPEC-arms §16h`)
- Library of sample roles by industry (content, ecommerce, freelance dev)
- Manual document ingestion → auto-split into nodes
- Knowledge graph browser
- Docker + VPS guide
- Cloudflare Tunnel + Zalo/Messenger bridge

---

## M3 — P1 comes back

"Engineering room": `coder` + `reviewer` + `architect` roles plus a dedicated view for software projects — spec/plan/progress/file map. This is P1, but living inside P2 instead of being a separate product.

Reason for deferring: the two products share ~70–75% of their infrastructure, and P2 sells to people outside the software industry too.

---

## License

**FSL 1.1 → Apache 2.0 after 2 years.** Personal, educational, internal, evaluation use: free. PRs and personal forks: allowed. Prohibited: offering a directly competing product.

The correct name for this is **source-available**, not open source.

Full details: `LICENSE.md`.

---

## Technical risks

| Risk | Level | Response |
|---|---|---|
| **High token costs make for a bad experience** | high | The whole of `SPEC-token-economy.md` exists because of this |
| **Claude auth trouble inside a container/VPS** | medium | Try it early in M2; `agentco doctor` must diagnose it clearly |
| **Agent SDK breaking change** | medium | `ProviderAdapter` already isolates it; pin the version, read the changelog |
| **Issue #247 (MCP breaks the cache) stays unfixed** | medium | `concierge` already routes around it; `master.mcp` stays a setting |
| **`sessionStore` is still alpha** | low | Not dependent on session resume — everything of value lives in the artifact |

---

## SDK verification — ✅ DONE 2026-08-14

Full results: **`FINDINGS-sdk-2026-08-14.md`**.

| Question | Result |
|---|---|
| Does the SDK exist and actually work? | ✅ `@anthropic-ai/claude-agent-sdk@0.3.231`, works out of the box |
| Subscription-based, or is an API key required? | ✅ **Local Claude Code subscription**, no API key needed |
| Can the cache breakpoint be controlled? | ✅ **`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`** — cross-session cache. Better than assumed. |
| Is token accounting detailed enough? | ✅ `usage` + `modelUsage` carry `cache_read`/`cache_creation`/`costUSD` per model |
| Real-world parallelism ceiling | ❌ **not yet measured** — moved to the list below |

### Still to check — before day 3 of week 1

1. **Does `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` with ~2K of HOT knowledge placed before the marker hit cross-process?** This is the direct proof needed for `SPEC-token-economy.md` §2.
2. ~~`agents` (SDK subagent) vs. hand-running `query()`~~ → **DECIDED, no test needed.** Hand-write it. Veto reason: subagent output flows straight into the parent's context, breaking the Receipt protocol. The cache is still shared, because the cache is a property of the prefix on the server, not of how the agent was spawned (evidence: probe2, 4 independent calls all `cr=10,555`). Borrow `AgentDefinition`'s shape as the role file format.
3. How many concurrent `query()` calls before hitting a 429 → sets the default `concurrency`.
3b. **Is `jsonSchema` in `SDKControlInitializeRequest` structured output?** If so, the Receipt schema is enforced by the SDK **for free**, instead of us validating and re-asking (which costs a turn). This is the cheapest possible win to find — check it on day 2.
4. **Re-measure overhead on a MULTI-TURN task.** The probe used `maxTurns: 1`, the worst case; the ~2,600 `cache_write` amortizes over subsequent turns. Need the real number to price this correctly.
5. Can the recurring ~2,600/call `cache_write` be pushed down? (for M1)
6. Is the `sessionStore` (alpha) usable for VPS mode? (for M2)

### Three spec adjustments that came out of the measurements

- **Non-coding roles don't use the `claude_code` preset** — a ~6,300-token gap, 5.5x the price. Add `use_preset: false` as the default in `roles/*.yaml`; only `coder`/`reviewer` turn it on.
- **A ~13,200-token/worker-call floor that can't be reduced** (`allowedTools` isn't a size lever) → new rule: **fewer, larger tasks over many small ones**.
- **Master doesn't attach MCP.** [Issue #247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247): MCP breaks prompt cache on resume. MCP only attaches to workers (one-shot, never resumed). This actually **reinforces** the stateless design.
