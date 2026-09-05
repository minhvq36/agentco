# SPEC — Connectors: an employee who knows how to use your systems

> ## Appendix: search over a user-uploaded document store (not yet built)
>
> Locking in the direction so we don't re-litigate this from scratch next time.
>
> **1. Foreign key first, search second.** A user's real question is rarely *"which
> file talks about X"* — it's usually *"where did this file come from, who made it,
> from which task"*. That's a flat JSONL of `file · plan_id · task_id · role · source ·
> timestamp`, and we **already have almost all of it**: `receipt.landed` is exactly
> that piece. What intuition calls a "graph" here is actually a **join**, not a graph
> engine.
>
> **2. `Glob` + `Grep` go further than you'd think.** Already available to every
> employee, running on the user's own disk, **0 standing cost**. With a few thousand
> files, grep beats vector search on both speed and accuracy — and it never returns
> the "close but wrong" result.
>
> **3. A cushioning summary layer DOES have value — but for ROUTING, not for
> replacing.** The intuition of "compress a summary in the middle" is half right: it
> can't replace reading the original file (you always end up needing the real
> content), but it answers *"which file is worth opening"* very well. And that layer
> **already exists**: `knowledge/index.json` plus knowledge nodes are exactly that
> layer. Don't build a second one — have an uploaded file spawn a summary node that
> **points back** to the original file.
>
> **4. Vector search comes last, and only when MEASUREMENT says it's needed** — once
> the corpus gets big enough that grep can no longer cover it. At that point, use an
> embedding model that **runs locally**, not through an API, exactly as `store.ts`
> already states from the start.
>
> **PDF/DOCX:** Claude Code's `Read` can read PDF; it can't read `.docx`/`.xlsx`. The
> right move is to **extract to text at INGEST time**, not at read time: once,
> deterministically, with the text file sitting next to the original so `Grep` can use
> it immediately. Extracting at read time makes every task pay again for the same
> work. ⚠ Not yet verified against a real file — try it before promising it to a
> customer.

> # 🔒 LOCKED IN 31/08 — **REST DROPPED FROM v1.** Read this block before the rest of
> the file.
>
> User: *"I'm thinking of dropping REST entirely — whoever wants to build a REST
> connector should build the MCP themselves first"* · *"Locked in: REST is dropped."*
>
> **§3–§6 of this file are NOT implemented in v1.** They are still correct as design
> and kept in place so that reopening them one day doesn't mean rethinking from
> scratch — but today they sit at **0% implementation**, and anyone reading this file
> and assuming there's code behind it is reading it wrong. The **CLI** branch (§2 Path
> B′) **has been built** — see `SPEC-arms §16`.
>
> ### The reason — and "REST is a thousand shapes" is NOT the reason
>
> Endpoint diversity is exactly the thing the **declaration** was built to swallow:
> `SPEC-arms §16m` places REST connectors and declared-CLI in the **same cell** on the
> GUESS↔DECLARE axis. If "a thousand shapes" were enough to rule out REST, it would
> **also rule out CLI** — writing that reasoning down here is left as a landmine for
> whoever reads it next and reaches for it.
>
> **The real reason is AUTH, and it's measurable:**
>
> | | Auth |
> |---|---|
> | **MCP** | has a **discovery protocol**: `401` → `WWW-Authenticate` → `resource_metadata` → DCR → PKCE. That's why `oauth.ts` runs **unmodified for both Notion and Linear, 0 lines changed** |
> | **REST** | **nothing to probe.** No DCR, no metadata, every API is its own snowflake |
>
> ⇒ The cost of a REST connector scales with the **NUMBER OF CUSTOMERS**, not a
> one-time payment. That's the **only** item in all of v1 with that property. And §9 ①
> (*"OAuth2 refresh token — M2 or drop entirely?"*) had been hanging unanswered since
> 14/08 — now it has its answer.
>
> ### The "specialty" moved, it did NOT disappear
>
> The specialty was never REST. It's ***"someone who can't code DECLARES a
> capability, we generate the MCP"*** — and **CLI is the first customer of exactly
> that sentence**, already running end-to-end as of 31/08.
>
> ### Google still has a path — what's dropped is "customer declares their own REST",
> not "we use REST"
>
> A Google catalog entry written by **US** (`src/core/arms/google.ts`, rule §4e-bis
> *one provider, one file*), a REST-over-`sdk` MCP runtime, **doesn't touch a single
> line of this file**, cost paid **once, by us**. Completely different from a "REST
> connector" at exactly the point that matters for the decision: **who pays for each
> new API**.
>
> ### ⚠ A trap born the moment REST is dropped — must be blocked before it bites
>
> Users will **wrap `curl` inside a CLI arm**. `run:` is **argv, not shell-expanded**
> ⇒ `$TOKEN` **doesn't expand** ⇒ they're forced to paste the **literal key** into
> argv ⇒ the key ends up in `company.yaml` · **goes into the hash** (rotating the key
> = a different arm) · and is **readable from another process on all three OSes**. No
> symptom anywhere. ⇒ Must scan for `curl`/`wget`/`Invoke-WebRequest` inside `run:`
> and pair it with a message pointing to the right door.
>
> ### Conditions for reopening (measurable — don't reopen because it feels right)
>
> ① **Google Workspace gets locked into the catalog via the CUSTOMER's REST path**
> (not an entry we wrote); **or** ② a real customer brings an internal API with **no
> developer** — today, whoever has their own REST API has someone in that company who
> wrote it, so the sentence *"build the MCP yourself first"* still holds.

**This is the product's specialty.** Someone who can't code defines for themselves an
employee that knows how to CRUD against their own REST API / system.
*(⚠ The line above was written 14/08 and **has since moved** — see the 31/08 lock-in
block right above: the specialty is now the declaration, and its first customer is
CLI.)*

Read alongside `SPEC-2026-08-14-agentco.md` and `SPEC-token-economy.md`.

---

## 1. Why this is the point of difference

Existing orchestration tools (openclaw, goclaw…) target people who code: if you want
an agent to call your API, you **write an MCP server**. That's an absolute wall for
AgentCo's customers.

Our proposition is the reverse:

> **Describe the API, don't write code that calls it.** Fill in a form, click Test,
> done — your employee now knows how to use your system.

This is also where **switching cost** forms: once a customer has plugged their
invoicing system / CMS / CRM in and their agent team has grown used to it, they're not
going anywhere.

---

## 2. Two entry paths, different audiences

| | Path A — MCP | Path B — REST connector |
|---|---|---|
| For | anyone who already has an MCP server (Notion, Slack, Postgres…) | **anyone with their own API who can't code** |
| What the user does | paste config, click Test | fill in a form / paste a cURL / paste an OpenAPI link |
| What we have to do | a UI to paste config + a connection check | **all of sections 3–6 below** |
| How differentiated | not at all (anyone can do this) | **this is the specialty** |

Path A comes first because it's cheap. Path B is the thing worth selling.

> ### 🆕 30/08 — there's now a **THIRD PATH**, and it shares its declaration format
> with Path B
>
> **Path B′ — wrap a CLI COMMAND.** Same `connectors/<id>.yaml` file, exactly one
> field different: `run:` (an **argv** array) instead of `method`/`path`. Everything
> else is reused as-is — one action = one tool · `confirm` defaults on for writes ·
> `say` in plain language · `returns` generated from a Test run · the key is just a
> variable name · logged to `audit.ts`.
>
> Why it belongs in this file rather than a new spec: **it's the same problem** —
> *someone who can't code describes a capability, we generate the MCP*. The only
> difference is whether the capability's source is an HTTP endpoint or a binary on the
> machine.
>
> **Full design + 3 open cells: `SPEC-arms.md §16`. Measurement exercises:
> `TEST-WALKTHROUGH.md` exercise 21 (REST) · exercise 22 (CLI).**
>
> ⚠ And a state that has to be said plainly: a grep on 30/08 shows —
> **`createSdkMcpServer` does not appear a single time in `src/`**. All of §3–§6 of
> this file (written 14/08) currently sits at **0% implementation**.

---

## 3. Connector format

```yaml
# company/connectors/invoices.yaml
id: invoices
display_name: "Invoicing system"
description: "The company's internal invoicing API"

base_url: https://api.my-company.com/v1

auth:
  type: bearer                    # none | bearer | header | basic
  token_env: INVOICES_TOKEN       # ⚠ ONLY the environment variable name, NEVER the value

actions:
  - id: list_invoices
    say: "view the list of invoices"        # shown in the UI, plain language
    method: GET
    path: /invoices
    query:
      - { name: status, type: string, enum: [draft, sent, paid] }
      - { name: limit,  type: integer, default: 20, max: 100 }
    returns: "Array of invoices: id, customer, amount, status, created date"

  - id: create_invoice
    say: "create a new invoice"
    method: POST
    path: /invoices
    body:
      - { name: customer, type: string, required: true }
      - { name: amount,   type: number, required: true }
      - { name: note,     type: string }
    returns: "The invoice just created, with its id"
    confirm: true                        # ← writes default to REQUIRED confirmation

  - id: delete_invoice
    say: "delete an invoice"
    method: DELETE
    path: /invoices/{id}
    params:
      - { name: id, type: string, required: true }
    confirm: true
    danger: true                         # ← one extra layer of confirmation
```

### Four design rules, each with a concrete reason

**a) Each action is ONE dedicated tool. There is no all-purpose `http_request` tool.**

An all-purpose tool forces the agent to make up the URL itself, guess the parameters
itself, guess the body format itself → lots of mistakes, no control, and **no way to
auto-generate a confirmation step** (because we don't know what it's about to do).
Explicit actions get a tight schema — the agent just fills the blanks.

**b) Writes default to `confirm: true`.**

`POST` / `PUT` / `PATCH` / `DELETE` automatically turn `confirm` on when the connector
is created. A non-coder will hand off *"clean up the old invoices for me"* and the
agent will **actually delete them**. That must never happen silently. It can be turned
off, but only deliberately.

**c) A token records only its VARIABLE NAME, never the value.**

⚠ **The old reasoning was WRONG, fixed 31/08.** The claim *"because `company/` is
designed to be committed to git"* doesn't hold for this repo — `.gitignore` **does
have `/company/`** in it; only `templates/company/` gets committed. The user pushed
back correctly: *"putting a token in company.yaml is normal… exactly like a `.env`.
Just don't save it into browser state/storage."*

**The actual rule, much narrower:** *the key's value must never LEAVE THE SERVER* — no
HTTP, no browser, no prompt. Where it lives **on the customer's own disk** is the
customer's business. And there are two mechanical reasons (readable in the code, not
just told as a story):

1. `company.ts §arms()` returns the **whole `config`** over HTTP to the browser — while
   `types.ts` itself declares the opposite invariant on the neighboring field (*"the
   key's NAME, never its value"*); both places guard the `secrets` field, **not the
   `config` field**.
2. `config` **goes into the hash** (`catalog.ts §armHash`) ⇒ rotating a key = **a
   DIFFERENT arm** ⇒ every `role.mcp` still points at the old hash, and the
   key-is-dead arm still shows a checkmark on the diagram.

> 🔴 The failure class behind the earlier wrong write-up: I had **two** mechanical
> reasons already sitting in the code, and reached instead for a **third, easier to
> tell, and wrong** one. The easy-to-tell reason beats the true one because it doesn't
> require reading the code — and it sends the fix to the wrong place (hiding the yaml,
> instead of blocking `config` from HTTP + separating the key from the hash).
> → [[agentco-easy-reason-beats-true-reason]]

The UI must refuse to save if it detects a string that looks like a token. ⚠ Grep on
30/08: the **enforcement** of this rule exists in **exactly one place**
(`oauth-routes.ts`, GitHub's `client_id` field) — the MCP-paste path **has no scanning
at all yet**.

**d) Block hosts outside `base_url`.**

An agent reading web content and getting steered into calling an internal endpoint is
a real scenario. The runtime only allows calls to `base_url`'s host. Calling
`localhost` / an internal IP requires explicitly turning on
`allow_private_network: true`, with a warning shown in the UI.

---

## 4. How a non-coder fills this in

Three input paths, ordered by user effort:

| Path | What the user does | What we do |
|---|---|---|
| **Paste OpenAPI / Swagger** | paste a URL or file | parse → pre-generate all actions → they tick which ones they want |
| **Paste cURL** | copy from Postman / DevTools / API docs | parse method, URL, headers, body → produces one action |
| **Fill in the form** | fill in each field by hand | validate, suggest |

**The `Test` button is mandatory, not optional.** Click Test → makes a real call →
shows the raw response plus a plain-language interpretation. A non-coder has no other
way to know whether they filled it in correctly. Without this button, the whole
feature is useless.

After a successful Test, the system **automatically proposes** a `returns` value by
reading the sample response — the user can edit it if they want.

---

## 5. Who it's assigned to — and the price, in tokens

Connectors are **not loaded for the whole company**. They're assigned per role:

```yaml
# roles/accountant.yaml
connectors: [invoices, banking]
```

The reason is economic, not access control. **Each action is a tool definition living
inside that role's prefix.** `SPEC-token-economy.md` §2 already measured this: the
tool-definition floor is already ~13,200 tokens; each connector adds on top of that.

Mandatory constraints:

| Item | Cap | Kind |
|---|---|---|
| ~~Total connector tokens / role~~ | ~~**2,000** hard cap~~ | 🔴 **DROPPED 23/08** — see block below |
| Actions / connector | 20 | soft — warns |
| One action's description | 120 tokens | hard |

> ### 🔴 THE 2,000 CAP IS DROPPED — measurement killed it, locked in by the user, 23/08
>
> The number 2,000 was written on 14/08, **before anyone had measured a single arm**.
> Measured 23/08 (`scripts/spike-mcp.ts`, `SPEC-arms.md` §9b): **one** `filesystem` MCP
> with 14 tools costs **2,185 tokens/turn**. ⇒ that cap **blocks the very FIRST arm**,
> before the user has plugged anything in.
>
> **Replaced with: SHOW THE PRICE, don't block.**
>
> ```
> 🔌 Files on this machine   ● active · 14 actions · ~2,200 tokens per turn
> ```
>
> **Three reasons, and the third one is the deciding one:**
>
> 1. **A hard cap here blocks exactly what the user DELIBERATELY wants.** They just
>    went through three steps to plug this in.
> 2. **They've never even seen the number.** Blocking something invisible and then
>    reporting *"cap exceeded"* is an error message with nowhere to go — exactly the
>    same failure class as *"raise `max_usd` in `roles/…yaml`"* (§5m ②): it's not a
>    lie, but it **sends you through the wrong door**.
> 3. **It's the customer's money.** Our job is to make that choice **visible instead
>    of blind**, not to decide it for them. Same rule already locked in for
>    `model_tier` (`SESSIONS_MEMORY` §5l ④): *this number is never used for agentco to
>    raise/lower anything on its own — that's the customer's call*.
>
> ⚠ **"Dropping the cap" does NOT mean "stop measuring."** The number must show up in
> **three places**, and missing any one of them puts us right back at the same
> invisibility we just removed: on the **catalog card** at selection time · on the
> **node** in the diagram · in the **detail table** of whichever employee it's wired
> into (summed across all of that employee's arms).
>
> Source of the number: `getContextUsage().mcpTools` — it breaks down to the
> individual tool. ⚠ **Do not** use the billing number here: the two sources differ by
> 27% and **do not measure the same thing** (`SPEC-arms.md` §9b ③).

**Good news:** connectors sit in the **static prefix**, so they get cached. Pay one
cache-write, then it's essentially free after that. But because of that:

> **Editing a connector = bumps the cache key of every role that uses it.** The
> connector UI does **not** autosave — it needs an explicit Save button, the same
> discipline as the skills editor (`SPEC-ui.md` §2.2).

`concierge` receives actions marked `quick: true` — quick chores handled in one shot.

---

## 6. Interface

A **Connections** panel (peer to Team / Knowledge):

```
┌─ CONNECTIONS ────────────────────────────────────────┐
│                                                      │
│  🧾 Invoicing system        ● active      6 actions │
│     api.my-company.com              used by: Accounting│
│                                                      │
│  📝 Notion (MCP)            ● active      4 actions │
│                                     used by: Writing │
│                                                      │
│  🏦 Banking                 ⚠ token expired          │
│                                     [Edit]           │
│                                                      │
│  + Add connection                                    │
└──────────────────────────────────────────────────────┘
```

Add-new flow: `Paste OpenAPI` / `Paste cURL` / `Fill in by hand` → select actions →
**Test** → assign to which employee → Save.

Each action shows as a plain-language sentence (`say`), not method/path — unless
Advanced is opened.

**The confirmation step for a write** shows right inside the chat flow, not a browser
dialog:

```
⏸ Accounting wants to create a new invoice
   Customer: ABC Corp · Amount: $12,000
   [Approve]  [Edit]  [Skip]
```

---

## 7. Security — mandatory

- Tokens live only in env / `.state/secrets.json`, **never** in the committable part
  of `company/`
- Tokens **never** go into a prompt. The runtime injects them at HTTP-call time; the
  agent never sees them.
- Hosts outside `base_url` are blocked; private network access must be turned on
  explicitly
- Every write call is logged to `logs/` — who, which task, what parameters, what
  result. This also underlies the **audit log** feature for business customers.
- Responses are capped before entering the agent's context (4,000 tokens by default),
  so one endpoint returning 2MB of JSON can't blow the budget

---

## 8. Roadmap

**Rewritten 31/08 per the decision to drop REST.**

| Stage | Contents |
|---|---|
| **v1** | Path A (paste MCP config + Test) ✅ built · **Path B′ CLI** ✅ built → `SPEC-arms §16` · per-action `confirm` · assignment per role |
| ~~M1/M2 REST~~ | 🔒 **DROPPED** — see the lock-in block at the top of the file. Manual form · paste cURL · paste OpenAPI · the `auth:` layer · host blocking · pagination: **not being built** |
| v1.x | Block `curl`/`wget`/`Invoke-WebRequest` inside `run:` (the trap this very decision creates) · Google catalog entry runs REST **written by US**, not through this file |
| later | Reopen REST **only when** one of the two conditions in the lock-in block becomes real |

---

## 9. Open questions

1. OAuth2 auth (refresh tokens) — many SaaS APIs require it. A lot more complex than a
   static bearer token. **M2, or drop it entirely?**
2. Paginated endpoints — let the agent loop itself, or have the runtime collect pages
   for it? (Letting the agent loop costs turns; runtime collection means guessing at
   pagination conventions.)
3. Large responses: hard-truncate, or save to a file and hand the agent a path?
   *(Leaning toward option 2 — matches the "artifacts own their storage" principle.)*
