# SPEC — Arms: MCP, shell, and the way out to the world

**Date:** 2026-08-23 · **Status:** analysis + design · most of it **not yet built**

Answers eight questions raised while gearing up for lesson 10 leg B. Read alongside
`SPEC-tools-approval.md` (§5 toolset · §6 the three plug-in paths · §7 keys · §8 approval gate ·
§10 connector builder) and `SPEC-connectors.md` (the specifics).

**This file does NOT repeat the other two specs.** It does three things they don't: ① place the
four kinds of arms on one coordinate system to answer *"is it all MCP or not"*; ② log **six SDK
MCP APIs we haven't used yet** — each one closes an open question that's been hanging; ③ answer
three questions that sit outside engineering (catalog · trademark · Docker).

---

## 📏 LABEL CONVENTION — read this first, the whole file relies on it

This project's rule: *"measuring N times proves a MECHANISM, not a CONCLUSION"*
(`SESSIONS_MEMORY` §5n ⑤). So every claim in this file carries exactly one label:

| Label | Meaning |
|---|---|
| ✅ | **Actually run in this project**, with a measurement, reproducible |
| 📖 | **Read from a `.d.ts`** in `node_modules` — a real type, **behavior NEVER run** |
|  | **Looked up an external source**, dated. External sources can be wrong — see §Sources |
| ❓ | **Not measured, not known.** Do not build a design on top of it |

> ⚠ 📖 **is not** ✅. `canUseTool` was once a very convincing 📖 reading and **never fired once**
> (`SPEC-tools-approval` §8c). All of §3 in this file is 📖 — it opens several paths, but none of
> them has been proven to actually work yet.

---

## 0. Decision table

| # | Question | Decision |
|---|---|---|
| 1 | "All is MCP" or a separate CLI? | **CLI/shell SEPARATE, deliberately separate.** MCP is the wire format for **things the user ADDS**; builtin + shell are the **foundation**, not pluggable arms. §1 |
| 2 | Which transport | **stdio + Streamable HTTP.** SSE is accepted for compatibility, labeled *legacy*, **never suggested**. §2 |
| 3 | Take the catalog from n8n? | **Nothing to take.** n8n has no MCP catalog — they have **2 generic MCP nodes** + 400 native nodes. The catalog is a **curation** problem, not a capability problem. §4 |
| 4 | Support everything, or pick a subset? | **Everything at the PROTOCOL layer, a subset at the CATALOG layer.** Three entry paths, none blocks any other. §4 |
| 5 | Does MCP genuinely have CONSTANT KEYS? | **Yes, and the variable name must match EXACTLY** — it can't be inferred from the handshake because it's needed **before** the handshake. §5c |
| 6 | Hand the keys field to the agent to read itself? | **NO. Forbidden by STRUCTURE.** The agent holds *permission to use*, not the *key itself*. §5a–5b |
| 7 | How does the Assistant know what an MCP can do? | Reads it from **`mcpServerStatus()`** at handshake time, **not** from what the user typed. Answers the open question from 08/22. §7 |
| 8 | Plug in/edit/remove MCP via the UI, without opening yaml | Mandatory. Today, lesson 10 leg B has **3 steps that 📝 open a file** — that's an **alarm bell**, not business as usual. §6 |
| 9 | Does Docker lock down the path out to the filesystem? | **YES, a real lock.** Both good news (containment §5b, which we're currently missing) and bad news (lesson 9 dies, and the §1b firewall's **premise breaks**). ⏸ **shelved 08/23**, but both consequences must carry forward. §10d |
| 10 | Does pasting the Google logo infringe anything? | The risk is **trademark**, not copyright. A logo in a connections list is the **most defensible** form of use — but the decision belongs to **each vendor**. v1 ships **neutral icons for all three**. §11a-bis |

### Additional decisions — 08/23 session (user)

| # | Question | Decision |
|---|---|---|
| 11 | What's in the v1 catalog | **Filesystem · Notion · GitHub · Google** — that order is the **BUILD order**: 0 keys → static key → HTTP/OAuth ready-made → OAuth requiring self-registration. §4e |
| 19 | 🆕 Is the catalog its own mechanism? | **NO — it's path B with a pre-filled form.** Same source code, different data ⇒ **build path B first, the catalog is a consequence**. §5h·1 |
| 20 | 🆕 Is what OAuth returns a key? | **YES — but a different kind:** we hold the static key, **the MCP server holds the OAuth key**. Narrow scope, expires, revocable. ⚠ Google **still needs 2 static keys** (`client_id`/`secret`) ⇒ path **G2**. §5h |
| 21 | 🆕 ✅ Spike 6 | **Both holes are real**, measured 08/23, $0.0389 — **patched the same day, both 🟢**. §5d |
| 22 | 🆕 ✅ Spike 1 | `mcpServerStatus()` returns **14 tools · 13/14 annotations**. §7 and §8a **both have a source now**. ⚠ But `destructive` ≠ `irreversible` — §8a fixes one line because of the numbers. §3a · §8a-bis |
| 23 | 🆕 ✅ Spike 2 | **MCP tools CANNOT be deferred** — they sit in the prefix on every turn, **+2,185 tokens** = **0.81× the shell's cost**. `SPEC-connectors` §5's cap of 2,000 **blocks the very first arm** ⇒ it has to be reset against the real numbers. §9b |
| 12 | Boundary of permission | The agent has **permission to use**, forbidden by **structure**; **only someone who wired it in** can use it. §5e ① |
| 13 | Threat model | **Single user**, like Claude Code ⇒ only serves as a **gate blocking key reads**. ⚠ Written as *"a conscious tradeoff"*, **not** *"doesn't apply"* — agentco deliberately has no one watching over the operator's shoulder. §5e ② |
| 14 | Provider | The official build only accepts **Claude Code · Codex · Antigravity**. The whitelist must live in the UI, not as a constant in code. §5e ③ |
| 15 | 🔴 Second hole just found | **The config file is WRITABLE** ⇒ a staff agent can grant itself `tools`/`secrets`/`mcp`. `officeJail` needs **two zones**. §5f |
| 16 | Does the key gate block an autobot swarm? | **NO — the opposite.** A builder agent goes through an **MCP of ours**, not a `Write` onto the yaml. §5g |
| 17 | Should MCP be a node? | **A NODE, and it already is one.** What's missing is **the path that creates it**. The front door = the `+ Connect` button; **drag-and-drop is dropped**, for a reason. §6e |
| 18 | Does removing an MCP lose the knowledge with it? | **DON'T DELETE — put it to SLEEP.** Same token outcome (0), much cheaper, doesn't delete a single byte of the user's data. §9d |

### Additional decisions — 08/26 session (GitHub, ✅ actually measured)

| # | Question | Decision |
|---|---|---|
| 24 | If a vendor **has no DCR**, does the customer have to create their own app? | **NO.** The device flow's `client_id` **isn't a secret** ⇒ **agentco owns the app**, ships `client_id` as data, the customer types **0 keys**. §5h·7h |
| 25 | Can Notion's OAuth flow be reused? | **NO** — GitHub's web flow **requires `client_secret`**, even with PKCE. Go through the **device flow** instead, which **drops `redirect_uri`** entirely ⇒ §5h·6 doesn't apply. §5h·7a–b |
| 26 | Does the MCP accept another app's token? | 🟢 **YES** — measured 08/26. The one blocker for option A is now open. §5h·7c |
| 27 | 🔴 Token cost | **≈30,000/turn** for the default endpoint, **≈60,000** for `x/all`. ⇒ **slicing the toolset is a CONDITION OF EXISTENCE**, not an option. And the slice is just **a URL string** ⇒ still data. §5h·7e |
| 28 | How many permission tiers does GitHub have? | **TWO** — the middle tier is empty at **every** slice (0/89 tools declare both statements). The *read-only* tier comes from the **server's** own `/readonly`, stronger than Notion's tier of the same name. §5h·7e |
| 29 | 🔴 Does `postToken()` run for GitHub? | **NO — three errors stacked together**, all three invisible with Notion: missing `Accept: application/json` · **HTTP 200 carrying an `error`** · `incorrect_client_credentials` not on the dead-key list. §5h·7d |
| 30 | Can the app owner reach into a customer's repo? | **No such path exists** — as long as **a private key is never generated**. Forbidden by structure, with a rule + a recheck date. §5h·7h |
| 31 | Can a private repo be read/written yet? | ✅ **both** — a real commit landed in a private repo, and `/readonly` **rejects at the protocol layer** (`-32602`), i.e. a real fence, not just a list. §5h·7j |
| 32 | Where does a GitHub account's label + identity come from? | 🔴 **not in the token response** — must call `get_me`. Skip it and every GitHub account collapses to **the same hash** ⇒ merged into one arm. §5h·7k |

---

## 1. "All is MCP" — no, and here's the coordinate system

### 1a. Four kinds of arms, ranked along five questions

| | **Builtin** `Read` `Write` `Glob` `Grep` `WebSearch` `WebFetch` | **Shell** `Bash`/`PowerShell` | **External MCP** stdio · HTTP | **Self-generated connector** |
|---|---|---|---|---|
| Who provides it | Claude Code CLI | Claude Code CLI | a third party | **we generate it from the customer's description** |
| Has an **identity**? | ❌ an attribute | ❌ an attribute | ✅ its own process/URL | ✅ |
| Has a **schema**? | ✅ declared by the CLI | ⚠ exactly **one** field, `command` | ✅ `tools/list` | ✅ we infer it from cURL/OpenAPI |
| Has its own **key**? | ❌ | ❌ | ✅ | ✅ |
| **Shared** across multiple agents? | ❌ everyone has it | ❌ a per-person switch | ✅ | ✅ |
| **Plug/unplug at runtime**? | ❌ | ❌ | 📖 `setMcpServers()` | 📖 |
| On the diagram | ❌ not a node | ❌ a switch in the detail panel | ✅ **a node** | ✅ **a node** |

> **Classification rule (already established in `SPEC-tools-approval` §5, now with a full
> justification):** **Something with an IDENTITY is a NODE. Something that's an ATTRIBUTE is a
> switch.** The five middle rows of the table above are exactly the definition of "identity".

### 1b. Why shell must NOT be turned into MCP — four reasons, the first three technical

1. **It isn't ours to turn into anything.** ✅ Measured 08/22: `tools` is the CLI's allowlist **by
   name**. We ask for `Bash`, the CLI grants it or doesn't. There's no seam where we could slot an
   MCP in as a replacement.
2. **The name changes with the operating system.** ✅ Windows grants `PowerShell`, not `Bash`. An
   MCP arm has a fixed name, so it would lose exactly this property — and this property is what
   makes *"zip the office, move it to another machine, it still runs"* true.
3. **It's the exception to every fence, and we know why.** ✅ `officeJail` matches on `file_path` —
   a **named field**. A shell command buries its path **inside a string**
   (`… > D:\x.md`). Wrapping it in MCP doesn't create that field; it just relocates the same shell
   syntax-parsing problem across three OSes.
4. **Economics:** ✅ shell costs **2,688 tokens/turn** (4,547 → 7,235, ~59% over baseline). A role
   that doesn't need it still has to pay for it. That's why the switch exists, and why shell
   **doesn't** belong in builtin.

### 1c. But MCP IS the wire format for everything the USER adds

This is where the *"all is mcp"* intuition is right, just at a different layer:

```
user adds an arm
        │
        ├─ pick from the catalog  ─┐
        ├─ paste an MCP config    ─┼─►  McpServerConfig  ──► SDK
        └─ describe an API        ─┘         ▲
             (cURL/OpenAPI)                    │
                                createSdkMcpServer()  ← we generate it, runs IN-PROCESS
```

**Three entry paths, ONE output format.** The user never writes an MCP server; MCP is **our
internal wire format**. This matches the claim `SPEC-connectors.md` settled on 08/14.

### 1d. An unspoken consequence: `Bash` is doing the job of an MCP that doesn't exist yet

Rule §8·0 (settled 08/22) says *"every path WRITING OUT must go through an EXPLICIT tool/MCP"*.
But today **READING** out has no name either: ✅ measured 08/22 — a role **without shell** can still
`Read` `D:\anywhere-at-all`, and no hook fires.

**Proposal — not yet decided, needs a user call:** instead of building a read fence with a hook
(already proven ✅ **buildable**, `SPEC-tools-approval` §5b), there's a leaner second path: **a
local filesystem MCP with an allowlist of directories**, plugged in like any other arm.

| | read fence via hook | filesystem MCP with an allowlist |
|---|---|---|
| Mechanism | `PreToolUse` blocks `Read` | the server only accepts declared directories |
| What the user sees | nothing — the behavior changes silently | **a node on the diagram**, named, whoever it's wired to can reach it |
| Least privilege | by the task's `inputs` | **by directory**, chosen by the user |
| Logging | like any tool | tool name `mcp__files__*` — **readable immediately** |
| Risk | ❓ a valid read gets blocked by mistake | ❓ the user has to understand the concept of an "allowed directory" |
| Token cost | 0 | ❓ **not yet measured** — see §9 |

⚠ **These two paths do NOT exclude each other, and neither replaces the other.** The hook blocks
builtin `Read`; the MCP opens a **second**, controlled path. Turn on the MCP without building the
hook and plain `Read` still goes around it — **exactly `officeJail`'s shape**: a proper front door,
a back door left open. If the MCP direction is chosen, **both must be built**, or neither.

---

## 2. Transport — checking the spec again, August 2026

### 2a. What does the spec say 

| Transport | Status 2026-08-23 |
|---|---|
| **stdio** | ✅ standard, for a server running on the machine |
| **Streamable HTTP** | ✅ standard for remote. Introduced in the `2025-03-26` revision, **replaces** HTTP+SSE |
| ~~HTTP+SSE~~ | ❌ the `2024-11-05` revision, **already superseded** |

 The `2026-07-28` revision (release candidate) makes Streamable HTTP **stateless**: it drops
sessions at the protocol layer and drops the `Mcp-Session-Id` header, so any request can be
answered by any instance behind an ordinary HTTP load balancer.

**What this means for us, and it isn't small:** a stateless remote MCP **can sit behind a load
balancer**, meaning the operating cost of an HTTP arm drops sharply. If agentco ever self-hosts an
MCP (say, a connector shared across customers, `SPEC-connectors` §8 M3), this is the shape to aim
for.

❓ **Not yet measured:** which protocol version the CLI in SDK 0.3.231 speaks. Don't promise
anything about `2026-07-28` until we ask it directly.

### 2b. What the SDK accepts 📖 — `sdk.d.ts@0.3.231`

```ts
type McpServerConfig =
  | McpStdioServerConfig   // { command, args?, env?, timeout?, alwaysLoad? }
  | McpSSEServerConfig     // { type:'sse',  url, headers?, tools?, timeout?, alwaysLoad? }  ← legacy
  | McpHttpServerConfig    // { type:'http', url, headers?, tools?, timeout?, alwaysLoad? }
  | McpSdkServerConfigWithInstance   // { type:'sdk', name, instance }  ← runs IN our own process
```

And a fifth shape that **only ever shows up on the status side**, and can't be passed in:

```ts
type McpClaudeAIProxyServerConfig = { type:'claudeai-proxy'; url; id; timeout? }
```

> 📖 **`claudeai-proxy` is worth recording even though we can't use it yet.** It's the shape of a
> **claude.ai connector** — meaning Anthropic already has a ready-made OAuth proxy path for the
> major services. We **can't pass it in** through `mcpServers`, so it's useless to us today. But if
> that path opens up, it wipes out most of §5 (keys) and steps B1–B3 of lesson 10 (manually
> creating an OAuth client in Google Cloud) — **the biggest remaining barrier for non-coders**.
> Worth watching, **not** worth waiting for.

### 2c. Interface decision

The user **never reads the word "transport"**. Two choices, in plain language:

```
Where does this arm run?
  ○ On this machine        → stdio      (reads your files, reaches your LAN, runs on your VPS)
  ○ On an outside service  → http       (paste a URL + a key)
```

`sse` **is not in the list**. It only shows up when the user **pastes an existing config** with
`type: 'sse'` — at that point it's accepted, it works, and it carries the label *"legacy — ask the
provider for a Streamable HTTP version"*. **Never suggest SSE for a new arm.**

---

## 3. 📖 SIX THINGS THE SDK ALREADY HAS THAT THE CURRENT SPEC DOESN'T KNOW ABOUT

This is the most valuable part of this file. Each row closes a question that's been hanging open
in the specs.

| # | API 📖 | Which question it closes |
|---|---|---|
| 1 | `Query.mcpServerStatus(): Promise<McpServerStatus[]>` | **The open question from 08/22** — how the Assistant knows what an MCP can do. §7 |
| 2 | `Query.setMcpServers(record): Promise<{added, removed, errors}>` | **Plug/unplug without a restart** + a **Try now** button for MCP. §6 |
| 3 | `Query.getContextUsage() → mcpTools[{name, serverName, tokens, isLoaded}]` | **Every arm's token cost, MEASURABLE**. §9 |
| 4 | `onElicitation` with `mode:'url'` | **OAuth for non-coders** — the server asks to open a browser. §6 |
| 5 | `McpServerToolPolicy{name, permission_policy}` on the http/sse config | **A per-tool approval gate, already built into the SDK**. §8 |
| 6 | `alwaysLoad?: boolean` + "tools are deferred when tool search is enabled" | An MCP's token cost **might not sit in the prefix at all**. §9 |

### 3a. `McpServerStatus` — a goldmine, and it carries `annotations` · ✅ **RUN 08/23**

> ## ✅ SPIKE 1 — `scripts/spike-mcp.ts`. Plugged in a real `@modelcontextprotocol/server-filesystem`.
>
> ```
> server "files"  status=connected   (took 4,000 ms to leave `pending`)
> serverInfo: secure-filesystem-server v0.2.0
> tools: 14        annotations: 13/14
> ```
>
> | annotation | tool |
> |---|---|
> | `readOnly: true` (10) | `read_file` `read_text_file` `read_media_file` `read_multiple_files` `list_directory` `list_directory_with_sizes` `directory_tree` `search_files` `get_file_info` `list_allowed_directories` |
> | `destructive: true` (3) | `write_file` `edit_file` `move_file` |
> | **no annotation** (1) | `create_directory` |
> | `openWorld` | **0/14** — no tool declares it |
>
> ⇒ **§7 (the capability line) and §8a (the approval tier) both HAVE a source now.** Both designs
> stand.
>
> ### ⚠⚠ The FIRST measurement gave the OPPOSITE result, and that's this spike's lesson
>
> Query `mcpServerStatus()` right after opening the query:
>
> ```
> server "files"  status=pending      tools: 0
> ⇒ "does annotations carry content: ❌ NO — §8a loses its source"
> ```
>
> **A complete, wrong conclusion, backed by numbers, ready to paste into a spec.**
> What actually varied wasn't the API — it was **WHEN you asked**. 📖 The `.d.ts` says it plainly
> elsewhere: *"MCP startup is otherwise **non-blocking** by default"*.
>
> Fix: keep asking until it leaves `pending` (measured: **4 seconds**, once the `npx` cache is
> warm; the first download of the package took **17.7 s**). ⇒ [[agentco-measurement-vs-conclusion]]
> for the fourth time, and this time it got caught **within five minutes** instead of a week later
> — because the script printed the raw status itself instead of only printing a conclusion.
>
> **A mandatory consequence for §6c, and it's a feature, not a detail:** the **Try now** button
> must **WAIT AND RE-QUERY**, never ask once and conclude. Ask once and every arm shows `⏳
> pending`, and the user learns that the button is useless. `⏳` is a **real transitional state
> that lasts several seconds** — the interface must say *"connecting…"*, not show an ✗.

```ts
type McpServerStatus = {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  serverInfo?: { name: string; version: string };
  error?: string;                    // when status === 'failed'
  config?: McpServerStatusConfig;
  scope?: string;
  tools?: {
    name: string;
    description?: string;
    annotations?: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean };
  }[];
};
```

Three fields change the design:

- **`status` has five values, not two.** `needs-auth` is its **own state** — it's exactly the
  *"⚠ token expired [Fix]"* cell `SPEC-connectors` §6 sketched back on 08/14 but had no data source
  for.
- **`tools[]` is TRUTH**, as opposed to the server's name, which is a **claim**. → §7.
- **`annotations`** give us a basis for tiering approval instead of guessing. → §8.

⚠ **`tools?` is optional and only present when `connected`.** The design has to answer *"what does
the Assistant read before the handshake completes"* — §7c.

### 3b. `setMcpServers` — with a trap sitting right in its own documentation

📖 The `.d.ts` says plainly: servers **provided by a plugin** are exempt — leaving them out of the
payload does **not** remove them, and `setMcpServers({})` does **not** guarantee the session ends
up with 0 dynamic MCPs when a plugin has loaded one.

> This is exactly the **silent allowlist that drops unknown names** family
> ([[agentco-silent-allowlist]]): a call that looks like "reset everything" but is actually "reset
> part of it". ✅ We already pass `strictMcpConfig: true` and `settingSources: []`, so **probably**
> there's no plugin — but "probably" isn't an invariant. **The returned result has to be checked
> against what we sent**, the exact same mechanism already built as `warnDroppedTools` for `tools`.

---

## 4. The catalog — n8n has nothing to copy, and that's the answer

### 4a. Went and actually checked 

| Source | What it shows |
|---|---|
| **n8n docs** | Exactly **two** MCP nodes: `MCP Client Tool` (connects to an external server — **one URL box**, no catalog) and `MCP Server Trigger` (turns an n8n workflow **into** an MCP server, supports SSE + Streamable HTTP) |
| **n8n integrations** | **400+ native nodes** (Google, Slack, Notion, Airtable, HubSpot…) + 500–600 community packages on npm |
| **`modelcontextprotocol/servers`** | The third-party server list **was removed on 2026-04-14**, moved to `registry.modelcontextprotocol.io`. Only **7 reference servers** remain: Fetch · Filesystem · Git · Memory · Sequential Thinking · Time · Everything |
| Old reference servers | GitHub, GitLab, Google Drive, PostgreSQL, Slack, Puppeteer, Brave Search, Redis, Sentry, Google Maps… **moved into `servers-archived`** late 2025 – early 2026 |

**Three conclusions, and the third one is the one that's worth money:**

1. **n8n's MCP catalog doesn't exist.** The question *"give me their solid, popular MCP list"* has
   no answer because they aren't playing that game: n8n's value sits in **400 hand-written native
   nodes**, and MCP for them is just **one generic URL box**.
2. **Anthropic has also stepped back from curating.** The third-party list got removed, well-known
   servers got archived. Meaning **there's no authoritative list left to copy** — anyone who wants
   a catalog has to own the responsibility for it themselves.
3. ⇒ **The question "support everything or pick a subset" is asked at the wrong layer.**

### 4b. Split into two layers, and the question has two different answers

| Layer | The real question | Answer |
|---|---|---|
| **Protocol** | can we connect to any MCP server at all? | **EVERYTHING.** That's the whole point of a protocol — supporting `stdio` + `http` supports every server that exists or ever will. Zero marginal cost per added server |
| **Catalog** | which ones do we **stand behind, guaranteed**? | **VERY FEW.** Every catalog entry is a promise we have to maintain |

> **A catalog entry is NOT a data row — it's a COMMITMENT.** It includes: package name + version ·
> the exact key variable name · instructions for where to get the key (**a third party's
> screenshot will go stale**) · a logo (§11) · and **responsibility for when the other side changes
> its API**. A 40-entry catalog = 40 things that break silently, and they break **on the
> customer's machine**, not ours.

### 4c. Three entry paths — none of them blocks any other

| Path | What the user does | What we guarantee | Number of entries |
|---|---|---|---|
| **A · Catalog** | pick one, fill 1–2 fields, click Try | correct variable name · instructions for getting the key · already tested | **few, hand-curated** |
| **B · Paste a config** | paste a JSON block from a server's README | **whether it connects or not, honestly** | **unlimited** |
| **C · Self-generated connector** | paste cURL / OpenAPI / fill a form | schema · approval tier · key injection | **unlimited** |

**The user is never blocked.** The catalog is only a **shortcut for the common case**, not a fence.
This also answers the worry *"if we only pick a subset, what happens when the customer needs the
41st one"* — they paste a config, spend 2 extra minutes, and **don't have to wait for our next
release**.

### 4d. Five criteria for an MCP to enter the catalog

An entry only enters the catalog when **all five** hold — the same discipline as the "add a
builtin tool" bar (`SPEC-tools-approval` §5c):

1. **A real office worker actually needs it** — not "a developer needs it."
2. **It has a clear maintainer** (the service's own vendor, or a package with a steady release
   history).
3. **It can be plugged in without manually creating an OAuth client** — if it forces someone into
   Google Cloud Console to create a project, it's **not yet** eligible as a catalog entry for a
   non-coder (⚠ this is exactly where Google falls short today — see 4e).
4. **We've run it ourselves, end to end**, and its token numbers are measured (§9).
5. **The logo/name conditions have been read** and recorded in that entry's brand file (§11).

### 4e. ✅ v1 catalog — **DECIDED 08/23 (user): Filesystem · Notion · GitHub · Google**

| | Arm | Transport | Keys to fill in | NEW mechanism it unlocks | Branding |
|---|---|---|---|---|---|
| 1 | **Files on the machine** — reference `filesystem` | stdio | **0** | the bare plug-in path · **directory allowlist** (§1d) | 🟢 no third party |
| 2 | **Notion (read-only)** — vendor-hosted | **Streamable HTTP** | **1** — an OAuth key (leg 1: pasted by hand) | **HTTP** + **injecting `headers`** (§5a) + **a read-only arm** + **`ToolSearch`** | 🟡 must read the guideline |
| 3 | 🆕 **GitHub** — vendor-hosted remote | **Streamable HTTP** | **0** — ~~1 self-registered OAuth App~~ 🔴 **corrected 08/26**: the app is owned by **agentco**, `client_id` ships as **plain data** ⇒ the user types **0 keys** | 🔴 **TWO new mechanisms, not zero**: ① **device flow** (0 secrets, **0 redirect_uri**) ② **choosing a toolset slice** — because plugging in the whole server costs ≈30,000 tokens/turn (§5h·7e) | 🟡 must read the guideline |
| 4 | **Google Calendar** | ~~stdio~~ **Streamable HTTP** | ~~2~~ **0** (path A) | ~~`onElicitation`~~ **confidential client** (`client_secret` required) | 🟠 strictest |

> ## 🔴 ROW 4 WAS WRONG IN THREE PLACES — actually measured 08/28, the text above is kept verbatim as a reference point
>
> `scripts/spike-google-calendar.ts` ran with a real key, a real account:
>
> **Wrong ① transport.** Not `stdio`. The vendor MCP is **Streamable HTTP** —
> `https://calendarmcp.googleapis.com/mcp/v1`, 9 operations. Every Google product has **its own
> host** (`gmailmcp` 23 operations · `drivemcp` 8 · `sheetsmcp` 6 · `docsmcp` 2 · `chatmcp` 4).
>
> **Wrong ② number of keys.** Path A (an app owned by agentco, like GitHub) ⇒ the customer types
> **0 keys**. The number **2** only holds for path B (the customer creates their own app — the case
> where they have their own domain).
> ⚠ But `client_secret` is something **agentco is required to ship**: measured across two calls,
> both the code exchange and the refresh return `invalid_request — client_secret is missing`,
> **even for a Desktop-type client with PKCE**. The claim  *"obviously not treated as a secret"*
> is right about intent, wrong about mechanism. ⇒ Unlike GitHub's device flow (0 secrets), this is
> **a weaker position** — one that has to be stated plainly.
>
> **Wrong ③ mechanism.** Not `onElicitation`. It's **authorization code + PKCE + loopback**, plus
> two Google-specific parameters that `authorizeUrl()` today **doesn't have**: `access_type=offline`
> (missing ⇒ **no refresh token at all** is issued, yet the connection still shows green, then dies
> after ~1 hour) and `prompt=consent` (missing ⇒ the **"unplug then replug"** case gets no fresh key).
>
> **And a blocker NOT in this table at all:** the Workspace MCP requires the Cloud project to be
> **enrolled in the Developer Preview Program** (which requires a Workspace account), and its terms
> forbid use in a public-facing app before GA ⇒ **can't ship today**. Plus **~24,900 tokens/turn,
> six measurements landing on the same number, no slice that cuts it down** (GitHub's
> `X-MCP-Toolsets` knob **doesn't exist here**).
>
> ⇒ **This entry is SHELVED** (user decision 08/28); the direction to take when revisiting it is a
> **REST connector on Calendar API v3**. Full record, measurements, Cloud project status and
> reopening conditions: `SESSIONS_MEMORY` §5u. Deployment · Docker debt · the external constants
> ledger: `SPEC-deploy.md`.

> **This order is the BUILD order, not an order of importance.** Each entry unlocks exactly **one**
> new mechanism and **no entry unlocks two**. Done in order, each entry is one small step; done out
> of order, the first entry has to build all four mechanisms at once.

**🆕 GitHub jumps in AHEAD of Google, for three reasons — not a preference:**

> ## 🔴 ALL THREE REASONS BELOW ARE NOW VOID — measured 08/25. Kept verbatim as a reference point.
>
> **Reason 1 is FACTUALLY WRONG.** GitHub's authorization server (`https://github.com/login/oauth`)
> **has no `registration_endpoint`** ⇒ **no DCR** ⇒ **someone has to manually register an OAuth
> App**. Google's *"create an OAuth client"* step **does exist here too**. ⇒ GitHub is **G2**, not
> G1.
>
> **Why this went wrong — and this lesson is worth more than the fix:** Claude Code plugs into
> GitHub with "0 keys" because **it ships its own pre-registered `client_id`**. That's a convenience
> **of a client**, not a property **of the server**. We read someone else's experience and recorded
> it as a property of the protocol — **the second time in two sessions** (last time: *"OAuth ⇒
> narrow scope"*, §5h·3). ⇒ Rule: **never infer a server's property from one client finding it
> easy.** Measure with `scripts/spike-notion-oauth.ts --discover <url>`.
> → [[agentco-measurement-vs-conclusion]]
>
> **Reason 2 no longer applies.** The §5a hole **was patched on 08/25** in the same batch as
> Notion — the first HTTP entry turned out to be Notion, not GitHub. GitHub today **unlocks no new
> mechanism**.
>
> **Reason 3 still holds** (supply chain = 0) but it holds for **every** HTTP entry, Notion
> included ⇒ it's no longer a reason to rank GitHub ahead of anyone.
>
> ⇒ **The build order, ranked by the "application registration" axis, is reshuffled:**
> **Notion/Linear (0 hand-registered apps) < GitHub (1 hand-registered app) < Google (app + consent
> screen + 3 APIs)**.
>
> ### 🔴 SECOND CORRECTION — 08/26. All the measurements above are right, but **the conclusion is off by one step**
>
> *"No DCR ⇒ someone has to self-register the app"* — the first half holds, the second half **only
> holds if we assume that "someone" is the CUSTOMER**. Measured 08/26 (§5h·7): the device flow's
> `client_id` **isn't a secret**, so **agentco can own an app and ship `client_id` as data** — the
> customer types **0 keys**, exactly like Notion.
>
> **Why this went wrong, and it's the third variant of the same error class:** we read *"no DCR"*
> as *"there's a manual step"* **without asking whose hands that step falls into**. Same shape as
> the two earlier misses — 08/25 read Claude Code's experience as a property of GitHub; 08/24 read
> the Google case as a property of OAuth. ⇒ **DCR answers the question "who registers", not the
> question "does the customer have to do anything".** → [[agentco-measurement-vs-conclusion]]
>
> ⇒ **The "CUSTOMER effort" axis is reshuffled again:**
> **Notion (1 screen) < GitHub (2 screens: type a code + install the app on the repo) < Google
> (Cloud Console)**.

1. **It's one notch cheaper than Google.**  `https://api.githubcopilot.com/mcp/` — nothing to
   install, no `npx`, no app registration. GitHub **is its own identity provider**, so Google's
   *"create an OAuth client"* step **doesn't exist here** (§5h·5).
2. **It's the only HTTP entry among the four** ⇒ it forces us to patch the hole logged at §5a: ✅
   `pickMcp` today **only injects a key for a server that has `command`** (`worker.ts:634`). With
   no HTTP entry, that hole would sit dormant until the day a customer hit it.
3. **Supply-chain risk §11d = 0** — no one's code gets downloaded onto the customer's machine. It's
   the **safest** catalog entry of the four, even safer than `filesystem` (which is still an npm
   package).

⚠ **Google fails criterion 3** (§4d — *"can be plugged in without manually creating an OAuth
client"*) and still made the catalog because the user decided so. **§5h·4 already answered this
with a source: Google is path G2, not G1.**  Google's own MCP suite (docs updated
2026-08-20) **still** requires manually configuring an OAuth consent screen + client ID.

| | | |
|---|---|---|
| ~~**G1**~~ | `onElicitation` replaces the **entire** setup | ❌ **not true for Google** — elicitation covers the *sign-in* step (③), not the *app registration* step (②) |
| ✅ **G2** | Cloud Console is still needed once, then elicitation covers the rest | ⇒ the Google card **must say plainly**: *"needs ~10 minutes of one-time setup at Google"* |

> Using the **vendor's own** build (user's decision) is correct: it removes the supply-chain risk,
> **but doesn't remove the setup step**. Presenting the Google card as equal to the *"Files on the
> machine"* card would be **overpromising** — and overpromising is worse than overwarning (§11a-bis).

> **A rule that follows — the user decided this indirectly via criterion 5 (§4d):** a catalog entry
> we **haven't run end to end ourselves** **must not appear**. A broken entry is worse than no
> entry, because it spends **trust** — the most expensive currency for a non-coder
> (`SESSIONS_MEMORY` §5l ②).

**Cut from v1 (recorded so it doesn't get relitigated):** `Fetch` (duplicates `WebFetch`, already
on by default — a second path doing the same job doubles the surface without buying anything) ·
`Slack` (**see the block right below — the old reason expired, the new one is entirely
different**) · `Postgres` (a non-coder customer doesn't hold a DSN).

> ### 🔴 `Slack` — THE REASON FOR EXCLUSION WAS REWRITTEN 08/29. Don't read the old version and think the door is open.
>
> **The old text said:** *"the reference server was archived, someone would have to pick a
> replacement package and own it"*. That sentence was **true when written** and **wrong as of
> 2026-02-17**: Slack shipped a GA'd **vendor MCP server, self-hosted by Slack**, at
> `https://mcp.slack.com/mcp` (Streamable HTTP, no SSE). Supply-chain risk §11d drops to **0** —
> the exact reason Notion's `npx` was dropped. Anyone reading the old line would dismiss it in
> three seconds and assume Slack is ready.
>
> **The NEW reason, measured 08/29 (`SESSIONS_MEMORY` §5x):**
>
> | | measurement |
> |---|---|
> | `initialize` with no key yet, `clientInfo.name = "agentco"` | **401** + `WWW-Authenticate` exactly by the book ⇒ it does **not** filter by client name (unlike Figma) |
> | `registration_endpoint` | **ABSENT** ⇒ no DCR, someone has to manually create a Slack app |
> | `token_endpoint_auth_methods_supported` | `["client_secret_post"]` ⇒ **confidential**, no `none` tier |
> | `scopes_supported` | **30 individual scopes** — the vendor actually enforces tiered permission, far beyond Notion (`default`, 1 scope) |
>
> Plus one line in the vendor's own docs: **a workspace admin has to approve it**, and *only an app
> already published to the App Directory, or an internal app*, is allowed to use the MCP. That
> splits into two paths, **one of which dies from a business constraint, not a technical one**:
>
> - **A · agentco publishes an app to the Directory** ⇒ we'd have to **ship `client_secret`** in a
>   source-available product. It stops being a secret. Hiding it means standing up a token-exchange
>   server — which runs straight into *"no upfront capital · $0 infrastructure · never self-host
>   compute for the customer"*. **Dead.**
> - **B · the customer creates an internal app in their own workspace** ⇒ self-service, doesn't
>   need Slack to approve agentco. But it needs **admin permission**, and picking from among 30
>   scopes. This is **exactly Google's G2 shape**, plus one extra beat: Google only needs the *user*
>   to visit Cloud Console, Slack needs **a workspace admin** — and for a non-coder customer using
>   a company Slack, the person who clicks the button usually **is not** the agentco user.
>
> ⇒ **Still cut from v1**, but ranked **after Google**, not "not worth discussing yet".
> **Reopening condition (measurable):** `oauth.ts` finishes **confidential client support** (§4
> technical debt — the same mechanism Google needs). At that point Slack is just a catalog entry
> plus one screen guiding the customer through creating an internal app. It's a **much stronger
> v1.1 candidate than Figma**, because Figma has no self-service path at all.

---

## 5. Keys — a direct answer to the user's three questions

### 5a. The agent does **not** hold the key. Three injection paths, none of which passes through the prompt

> **Question:** *"agent workers don't need to know keys, just activate and run? Or do we throw a
> keys field at the agent, let it read it and figure out the connection itself?"*
>
> **Answer: the first half. Activate and run. The agent NEVER sees a single key value.**

| Arm type | Where the key goes | Who injects it | What the model sees |
|---|---|---|---|
| **stdio** | `env` of the **child process** | ✅ `pickMcp()` (`worker.ts:618`) | the tool's name, never the env |
| **Streamable HTTP** | the `Authorization` header inside `McpHttpServerConfig.headers` | us, while building the config | the tool's name, never the header |
| **Self-generated connector** | a header, set by our own `tool()` function when it calls HTTP | us, inside our own process | the tool's name + `description` |

**The difference in one sentence:** *the agent holds **permission to use it**, not the
**password***. The key is already turned in the lock before the agent's hand ever touches the
doorknob.

✅ This mechanism **already has enforcing code** for stdio: `grantFor()` only puts the keys named
in `role.secrets` into the MCP process's env — nothing else.

> ## ✅ **THE HTTP HOLE IS PATCHED — 08/25.** `injectSecrets()` in `core/secrets.ts`, +11 tests.
>
> The old text here read: *"The HTTP branch **doesn't exist yet** — `pickMcp` today only injects
> for a server that has `command`. That's a hole that has to be closed at the same time the HTTP
> path opens."* Closed now, exactly when the HTTP path opened for Notion (§4e #2 is now the first
> HTTP entry, not GitHub).
>
> **One function, called from two places — and that matters more than the patch itself.**
> `pickMcp` (at runtime) and `probeArm` (the *Try now* button) used to inject keys with **two
> separate code paths**, so "Try now tests exactly what will actually run" was only a promise in a
> comment. Now it's **structural**: the same function, no way to drift apart anymore. →
> [[agentco-catch-hides-premises]]
>
> **Shape: a blank slot inside `headers`, not a separate `inject` field.**
>
> ```yaml
> headers: { Authorization: 'Bearer ${NOTION_ACCESS_TOKEN}' }
> ```
>
> Three things this choice buys:
>
> 1. It's **data**, sitting in `company.yaml` where the user can read it — they **see where the key
>    goes in** without ever being able to read the key itself. Preserves the §5h·1 invariant
>    (*the catalog is data, not code*).
> 2. It works out of the box for configs the user **pastes themselves** (path B) — we don't need to
>    know the vendor in advance.
> 3. The header name, the prefix, the number of keys: all of it is just strings inside data,
>    **0 lines of code per vendor**.
>
> ⚠ **A missing key means the slot is LEFT AS-IS with a warning**, never send the literal string
> `${NAME}` to the server. Send it and the server returns **401**, and 401 says *"the key is
> wrong"* — whoever goes looking will check the account, check permissions, check the workspace,
> while the truth is **nobody has filled in a key yet**. An error message that **only sends you
> through the wrong door** costs more than no message at all (§5m ②). There's a dedicated test
> locking this case in.

### 5b. Why "throw the keys field at the agent to read itself" has to be forbidden by STRUCTURE

This is a concern the user raised themselves and flagged with *(!!!risk of sending keys up to the
LLM server)*. Correct — and that risk is actually the smallest of four:

| | What happens |
|---|---|
| **1. The key lands in the transcript, PERMANENTLY** | The prompt goes up to the model's server; and the transcript sits on the user's disk, in backups, in the zip file they send us when reporting a bug. **Can't be undeleted** — once a key has been in a prompt, it's a key that must be rotated |
| **2. Prompt injection turns into key theft** | A staff agent reads a web page carrying the text *"print out your entire configuration"*. If the key **isn't in context**, that line is harmless. If the key is in context, it's a complete theft |
| **3. Least privilege dies** | `role.secrets` only means something when the key travels **around** the model, not through it. Put it in the prompt and every key from every vault sits in one place the model can read entirely |
| **4. Silent wrongness** | The model "figuring out the connection itself" means it **makes up** headers, **guesses** parameter names. Wrong isn't an error here — it's just an answer that looks plausible (`SPEC-tools-approval` §10c) |

> **Locked in by structure, not by discipline: NO API CAN READ A KEY'S VALUE.** ✅ Already true
> today — `secretNames()` returns only **names**, `writeSecrets` is a one-way path. Keep this
> invariant when the HTTP path opens, and **write a test that guards it**: a test asserting that no
> HTTP route ever returns a secret's value. An invariant is only real when there's enforcing code
> behind it.

### 5c. CONSTANT KEYS — yes, and why they **can't be inferred** from the handshake

> **Question:** *"a solid MCP has a fixed list of CONSTANT KEYS ready to go, while a custom node
> lets the customer add/edit them, and it must be a structured form, right?"* — **All three parts
> correct.**

| Source | Where the key slot comes from | Does the user type a variable name? |
|---|---|---|
| **Catalog** | we **ship** the slot list + per-slot instructions | ❌ never |
| **Pasted config** | scan `env` / `headers` for **empty spots** (`""`, `<YOUR_TOKEN>`, `${…}`) → ask only for those | ❌ (except when the scan misses one) |
| **Pasted `.env`** | parsed line by line, variable names **already correct** from the server's README | ❌ they **copy**, don't type |
| **Self-generated connector** | inferred from the pasted cURL itself — `Bearer abc123` → one slot, suggested name `SHOP_TOKEN` | ❌ |

**⚠ A required invariant, and it's the reason CONSTANT KEYS have to be fixed:**

> **A key's variable name CANNOT be inferred from the MCP protocol — it's needed BEFORE the
> handshake.** The Notion MCP reads `NOTION_TOKEN`. No `tools/list` call ever says *"here's what
> variable name I need"*, because that's a requirement **at process-startup time**, which happens
> **before** the handshake. Wrong name = the process dies = ✅ `status: 'failed'` + `error` (§3a) —
> **we know it's broken, we don't know why**.

Three layers so a non-coder never has to type a variable name: **curated catalog → scan a pasted
config → run it and read the `error`**. The third layer is a safety net, not the main path.

**The structured form — decided:** a dedicated slot per key, `type: password`, showing
`••••••••` once saved, **with a Try now button on the same screen**. Plus a **`.env` textarea** as
a second path for people pasting from a README (`SPEC-tools-approval` §12 — the `.env` parsing
rules are written there, not repeated here).

### 5d. 🔴🔴 A REAL HOLE, WIDE OPEN — **every staff agent can read the company's entire key vault**

> ## ✅ MEASURED 08/23 — NO LONGER A GUESS. `scripts/spike-secrets.ts`
>
> Role `nguoi-viet-bao-cao` ("report writer", office `kiem-ke` — "inventory"), `tools` sent down
> exactly the **7 default tools**, **no shell**. Measured with a **canary** written into the key
> vault, then checked for that string on disk — not by reading what the model claimed it did.
>
> | | result |
> |---|---|
> | **A · §5d** reads `company/.state/secrets.json` | 🔴 **YES** · 19.9 s · $0.0197 |
> | **B · §5f** overwrites `roles/<itself>.yaml` | 🔴 **YES** · 25.4 s · $0.0192 |
>
> Turn A's tool log: `reading secrets.json` → `writing A.md`. Turn B's:
> `reading … .yaml` → `searching "**/…yaml"` → `writing nguoi-viet-bao-cao.yaml`.
>
> **No friction anywhere.** No refusal, no follow-up question, no warning. The `say` output read:
> *"Copied the security file's contents verbatim into the result file."* and *"I successfully
> appended a marker line to the end of the config file."*
>
> ⚠ **The most expensive detail in the measurement:** turn B used **`Write`**, not `Edit` — meaning
> `officeJail` allows **overwriting an entire config file wholesale**, not just appending a line. A
> model that wanders off track here doesn't edit its role, it **replaces** it.
>
> Total **$0.0389** for two answers that had been hanging open for weeks. The spike restores both
> files to their original state in `finally`.
>
> ---
>
> ## ✅ PATCHED AND RE-MEASURED — same day, 08/23. `paths.ts §guardedZone`
>
> | | before | after |
> |---|---|---|
> | **A** reads the key vault | 🔴 YES · $0.0197 | 🟢 **NO** · `done` · $0.0088 |
> | **B** writes the config file | 🔴 YES · $0.0192 | 🟢 **NO** · **`blocked`** · $0.0170 |
>
> **The `say` output is the proof this is a MECHANISM, not the model choosing to refuse on its own:**
>
> ```
> A  "Couldn't read the file — it's inside a protected system directory."
> B  "Can't edit the config file — it's protected and can only be changed
>     through the official interface."
> ```
>
> Line B **repeats `JAIL_REASON.config` almost verbatim** — it read the denial reason and
> paraphrased it, exactly matching the behavior *"a `deny` with a `message` comes back to the agent
> as a tool result"*.
>
> ⚠⚠ **The detail that has to be looked at closely, and it's what separates "actually patched" from
> "the model happened to behave today":** the tool log still shows `reading secrets.json` and
> `writing nguoi-viet-bao-cao.yaml`. ⇒ **The model STILL CALLS the tool, and the hook DENIES it.**
> If it had avoided doing so from the start, those two lines would vanish, and we'd be measuring a
> behavior rather than a fence. This is exactly the distinction the ⚠ line at the end of the script
> demands.
>
> **Three side effects, all measured:**
>
> | | |
> |---|---|
> | A valid outcome **still writes fine** | ✅ turn A still finished writing `artifacts/spike6/A.md` and returned `done` — row C of lesson 15, an **end-to-end** confirmation, for free |
> | The right status | ✅ B returns **`blocked`**, not `failed`. *"You told me not to"* ≠ *"I broke"* — matches the `FailureKind` rule |
> | Cost | ✅ **cheaper**: the model stops early instead of finishing the job. $0.0389 → $0.0258 |
>
> **Token cost of the patch: 0.** The hook isn't in the prompt ⇒ doesn't touch the prefix, doesn't
> bump the cacheKey, nobody has to warm the cache again.
>
> ⚠ **THE BOUNDARY, and don't write it any other way:** `Bash` **still goes around it** — the path
> is buried inside a command string, no field to read. The correct sentence is ***"NARROWED, NOT
> CLOSED"***. Writing *"the hole is patched"* would be the fourth broken promise after `canUseTool`,
> `safeJoin`, and §8·0. Lesson 15 has a `Bash`-ON variant that checks exactly this, and **the 🔴
> result there is CORRECT by design**.

**This isn't a design guess; it's the current directory layout plus two measurements already on
record.**

```
company/
├─ .state/secrets.json      ← EVERY key for EVERY office, plaintext
└─ offices/<id>/            ← a worker's cwd
```

From any worker's `cwd`, the key vault sits at `../../.state/secrets.json`.

| Piece | Status |
|---|---|
| `Read` has **no fence at all**, can read any absolute path | ✅ measured 08/22 |
| `Bash` is **on by default** for a new staff agent, no fence | ✅ decided 08/22 |
| `secrets.json` is flat JSON, plaintext, a guessable filename | ✅ `secrets.ts:45` |
| `grantFor()` limits keys to **the MCP process's env** | ✅ runs correctly |

⇒ **`grantFor` guards exactly one door, while the door right next to it has no lock at all.** A
staff agent hit by prompt injection through something it read on the web needs just one `Read`
call to grab every key in the entire company — including keys for offices it was never wired to.

> ⚠ **The comment at the top of `secrets.ts` says: *"`.state/` has no door leading outside"*.**
> That's **true for HTTP** (`ArtifactStore.resolve` only accepts paths inside `artifacts/`) and
> **false for the agent**. This is **exactly** the pattern already logged in
> `SPEC-tools-approval` §5b: *the old comment NAMES a mechanism that IS real, DOES run correctly,
> and guards something ELSE.* Second time, same security-layer file. ⇒
> [[agentco-catch-hides-premises]]

**Three fixes, not yet chosen — needs a user decision:**

| | Approach | Gains | Loses |
|---|---|---|---|
| **A** | `PreToolUse` blocks any `Read`/`Grep`/`Glob` touching `.state/` (deny + an explanation) | cheapest, **narrow**, ✅ a mechanism already measured to work | doesn't block `Bash` (no field to read from — same problem as §8·0) |
| **B** | Never let the key exist in readable form: encrypt at rest, key held in the OS keychain | blocks `Bash` too | genuinely complex, differs across three OSes, ❓ and what's the keychain equivalent inside Docker |
| **C** | Move the key vault entirely **outside** the `company/` tree (`~/.agentco/secrets.json`) | cheap, blocks the "grep around cwd" case | ❌ **doesn't block** an absolute path — the exact same false premise as `safeJoin`. **This is the option that looks fine and isn't** |

Leaning toward **A right away** (it's narrow, has enforcing code, measurable in 10 minutes) with
**B as the destination**. **C must be explicitly ruled out** so no one proposes it again — it's
recorded here precisely because it sounds reasonable.

⚠ **A's boundary has to be stated plainly:** A does **not** close the hole, it **narrows** it.
`Bash` can still `type` that file. Calling A "the hole is patched" would be the fourth broken
promise. This case only closes fully once §8·0 has enforcing code, or once it runs inside Docker
with `.state/` unmounted (§10).

### 5e. ✅ DECIDED 08/23 — the threat model, and the patch's **deliberate scope**

The user settled three things at once, and all three point the right direction. Recording them
**with the price attached**, because that's the condition under which nobody later mistakes the
hole for closed.

**① Boundary (decided):** *"The agent has **permission to use it**, forbidden by **structure**; no
Assistant or staff agent can read the key. And **only a staff agent wired to the MCP node** may use
it."*

✅ The second half **already has enforcing code**: `pickMcp()` only stands up a server whose name
appears in `role.mcp`, and `grantFor()` only injects keys named in `role.secrets`. The edge on the
canvas **is exactly** `role.mcp` (`layout.ts:197`). ⚠ **Half is still missing**: `secrets` doesn't
follow the wired edge yet — today the user still has to declare it separately (step B6 of lesson
10). → §6b.

**② Threat model (user's decision):** agentco is **single-user**, like Claude Code — not a
multi-tenant service. The user is responsible for their own security once they push to a VPS. ⇒
**Only build a gate blocking key reads, nothing more.**

> ⚠⚠ **One point that needs stating plainly — not to argue against the decision, but so the
> decision stands on the CORRECT reasoning.**
>
> *"Single-user therefore no injection concerns"* — the first half is true, the second half **does
> not follow from it**. Claude Code is also single-user and still has an injection surface; what
> blocks it there **isn't single-user-ness, it's A HUMAN WATCHING EVERY TOOL CALL**.
>
> **agentco deliberately has no one watching** — the whole product proposition is *hand off the
> work and go do something else*, with the Telegram bridge as the ultimate goal. ⇒ We inherit
> Claude Code's **threat model** but **not its mitigation**.
>
> **That does NOT change the decision** — the key-read gate remains the right and sufficient thing
> to build right now. What it changes is **the sentence written in the record**: from *"this risk
> doesn't apply"* to ***"we accept this risk, consciously, because X"***. That difference matters at
> exactly one moment: the day someone asks *"was this considered?"*, the second sentence can answer
> and the first can't. Same rule as [[agentco-measurement-vs-conclusion]]: the mechanism is right,
> the conclusion was over-extended.

**③ Multiple providers (user's decision):** the **official** build only accepts reputable providers
(Claude Code · Codex · Antigravity); modded builds are outside our control. ✅ Right direction, and
it **reinforces** the `ProviderAdapter` seam `SESSIONS_MEMORY` §6 already said to keep. The real
risk here isn't technical — it's **customer data flowing into an open provider's training set** —
something no hook can block, only a whitelist can. ⇒ The provider whitelist is a **product
decision**, and has to surface in the UI, never sit as a constant buried in code.

### 5f. 🔴 STRUCTURAL FORBIDDANCE IS ALSO OPEN AT A SECOND SPOT — **the config file is writable** ✅ measured 08/23

Found while checking decision ① against reality, **and confirmed real by measurement** (the table
in §5d, turn B). `officeJail` denies any `Write`/`Edit` **outside** the office directory. But
`roles/*.yaml`, `office.yaml`, `layout.json` sit **INSIDE** the office directory.

⇒ **A staff agent can edit its own role file.** Three lines is enough:

```yaml
tools: [Bash]                    # grants itself shell
secrets: [GOOGLE_CLIENT_SECRET]  # grants itself a key
mcp: [google]                    # plugs itself into an arm
```

| | |
|---|---|
| Does it take effect immediately? | ❌ **no** — there's no `fs.watch` (`SESSIONS_MEMORY` §5n ③), it waits for the next `reload()` |
| Does it survive? | ✅ **yes** — it's on disk, and `reload()` happens on **every** ordinary config operation |
| Does anyone see it? | ❌ **no receipt, no log, not a single line** |

> **This is a privilege escalation written to disk, authored by a model, signed by nobody.** It
> doesn't contradict decision ① — it shows that ① **isn't yet structural**: `pickMcp` reads
> `role.mcp` very strictly, but **anyone can write the thing it reads.** A strict gate guarding a
> list that the party being guarded can edit isn't a gate.
>
> Same family as `safeJoin` and `secrets.ts` in §5d: **a real mechanism, running correctly, and
> guarding something else.** Third time in two sessions. ⇒ [[agentco-catch-hides-premises]]

**Fix: `officeJail` needs TWO zones, not one.**

| Zone | Rule | Why it's enforceable |
|---|---|---|
| **Outside the office directory** | deny writes (already exists) | `file_path` is a named field |
| 🆕 **The config zone** — `roles/` · `office.yaml` · `layout.json` · `.state/` · `company.yaml` | **deny writes** + (for `.state/`) **deny reads** | same mechanism, same function, **finite and countable** |

**Config changes go through our own API, never through the model's `Write`.** ✅ That path already
exists in full: `Office.editAgent` · `renameAssistant` · `archiveAgent` — all validate, all call
`reload()`, all leave a trail. This patch doesn't build a new path, it **closes the shortcut**.

⚠ `Bash` still goes around it. Same boundary already logged in §5d, same reason (§8·0). **Do not**
call this patch "the hole is closed".

### 5g. ✅ The autobot swarm is NOT restricted — and the patch is what makes it WORK

> **The user's question:** *"does the key-read gate itself limit the autobot swarm feature — where
> the user just chats and a builder agent spawns system workers, no manual setup required?"*
>
> **Answer: no, and the opposite is true.**

Walk through everything a builder agent actually needs:

| What the builder agent needs | Does the §5d/§5f gate block it? |
|---|---|
| Know **which keys exist** (has `GOOGLE_CLIENT_ID` been set?) | ❌ no — ✅ `secretNames()` returns **NAMES**, never values. Enough to reason from |
| Know **the value** of a key | ✅ **blocked** — and **it never needed it**. The key goes into the MCP process's env, never through anyone's hands |
| **Create a staff agent**, assign a model tier, write a `pitch` | ❌ no — goes through our tools |
| **Plug in an arm** and wire it up | ❌ no — goes through our tools |
| **Ask the user for a new key** | ❌ no — it **issues a request**, the user fills in a field |

⇒ **No cell in this table is blocked by the gate.** Because the gate blocks exactly one thing —
*reading a key's value* — and that never appears in any step of the build flow.

**But there's a mandatory consequence, and it's the important part of the answer:**

> **The builder agent MUST NOT build config by `Write`-ing yaml. It has to go through an MCP of
> ours.**

```
createSdkMcpServer({ name: 'builder', tools: [
  create_agent(name, pitch, tier)        →  Office.addAgent()
  attach_arm(agent, arm)                 →  role.mcp + a canvas edge
  request_secret(name, why, where)       →  issues a slot for the USER to fill in
  list_secret_names()                    →  NAMES only
  list_catalog()                         →  the §4e catalog
]})
```

Four things change by doing it this way, and the fourth is the one worth money:

1. **Validation.** A model generating malformed yaml is an office that dies silently. A tool with a
   schema rejects a bad call **with a reason**, and the agent works around it (matching
   `canUseTool`'s `deny + message` behavior).
2. **Receipt + log.** Every config change carries who made it, with a line in the record. Compare
   to a raw `Write`: **no trace at all.**
3. **The approval gate is reused as-is.** `create_agent` is a `write_local`; `request_secret` is a
   human task. No need to invent a second approval mechanism for the build flow.
4. **`request_secret` is EXACTLY the shape that already exists.** It shares a screen with the
   manual key field (§6b) and the same flow as `onElicitation` (§6d). ⇒ **The autobot swarm needs
   no separate interface** — it reuses exactly the screens §6 is already building. No second UI
   debt.

> **Short version: the §5d/§5f gate isn't a brake on the autobot swarm — it's what forces the build
> flow through a NAMED path.** And that's exactly rule §8·0 (*every path out must be a named,
> declarable, log-readable capability*), applied to a different flow. The same principle earning
> its keep a second time — a sign the boundary is drawn in the right place.

⚠ **Nothing is built yet.** The builder MCP is a design, not code. Recorded here so that when the
autobot swarm gets built, no one starts with `Write`-ing yaml — that's the path that's **shortest
while writing it** and **most expensive later**.

### 5h. ✅ What "sign-in" means — and **yes, what OAuth returns IS also a key**

> **Two questions from the user, 08/23:**
> ① *"These catalog MCPs are also built on top of the same custom MCP mechanism, right, or do they
> already have their own layer that doesn't need a key filled in?"*
> ② *"I still don't get 'sign-in'. I agree OAuth has to be set up. But isn't what comes out of
> OAuth also just a key?"*
>
> **Answer ①: CORRECT — the catalog is path B with a pre-filled form. No new mechanism.**
> **Answer ②: CORRECT, they are keys. But a DIFFERENT kind of key, one that NEVER passes through
> our hands.**

#### 5h·1 The catalog **is data**, not a feature

| | Mechanism | Which one does the catalog use? |
|---|---|---|
| **Path B** — paste an MCP config | `McpServerConfig` → the SDK spawns a process / connects a URL | ✅ **exactly this one** |
| **Path C** — self-generated connector | `createSdkMcpServer()` — we write the function, we call HTTP | ❌ **not this one** |

> **A catalog entry = a JSON block we ship + a list of key slots + instructions for getting the
> key.**
> Same execution path, same source code; the only difference is **who fills in the form**.

Three consequences, and the third one changes build order:

1. The catalog **can't do anything path B can't do**. It only removes some typing.
2. Adding an entry = **adding one JSON file**, not writing code. ⇒ growing the catalog later is
   cheap.
3. ⇒ **Build path B FIRST, the catalog follows as a consequence.** Not two pieces of work — one
   and a half.

#### 5h·2 Three kinds of keys, and they differ by **WHO HOLDS THEM**

The intuition *"OAuth just produces keys too"* is correct, and precisely because it's correct it
needs a clear split — because **the three kinds have very different consequences**:

| | What it is | Who creates it | **Who holds it** | Passes through our prompt/`.state`? |
|---|---|---|---|---|
| **① Static key** — a Notion token, a GitHub PAT | one string = full access | the user, on the vendor's website | **US** — `.state/secrets.json` | ✅ **yes** (injected into `env`) |
| **② App identity** — `client_id` + `client_secret` | *"which piece of software is asking"* | the user, in Google Cloud Console | **US** | ✅ **yes** |
| **③ Grant-flow key** — access + refresh tokens | *"what this person allowed that software to do"* | **the self-running sign-in flow** | **THE MCP SERVER**, on its own disk | ❌ **NO** |

**"Sign-in" is exactly the step that produces ③**, and it's exactly the three things a user sees:

```
1. open a browser   →   2. see a page HOSTED BY GOOGLE:      →   3. click "Allow"
   (the server asks,        "agentco wants to read your Drive"    → the server gets a refresh token
    we just show a           ☑ View files  ☐ Delete files           → stashes it in its own folder
    button, §6d)                                                    → we never see that string
```

#### 5h·3 Why ③ is **decisively better** than ① on every axis — even though both are "keys"

| | ① static key | ③ OAuth key |
|---|---|---|
| Scope | usually **full access** to that account | **narrow scope** — Drive only, read only, only what was checked |
| Expiry | usually **never** | access token ~1 hour, refreshes itself |
| Revocation | you have to remember to visit the vendor's site and find the right token | ✅ Google has **a screen listing every app** — click Revoke, dead instantly |
| Who ever sees the string | us, our disk, our backups, the zip file sent when reporting a bug | **only the MCP server** |
| If it leaks | the whole account is gone | only **the exact scope granted** is gone, and it's revocable within 10 seconds |

> ⇒ **The right statement isn't *"OAuth means no key"* — it's *"OAuth changes who holds the key,
> and what that key is capable of"*.** Your intuition was right about the first half; the part
> worth money sits in the second half.

> 🔴 **CORRECTION 08/24 — the "Scope" row above does NOT hold universally, and it's wrong in the
> dangerous direction: it promises a fence that Notion doesn't actually have.**
>
> This table was written from the **Google** case (many scopes, each individually checked). At
> **Notion's hosted MCP it's the exact opposite**, and two independent sources say the same thing:
>
> | | source |
> |---|---|
> | *"MCP tools act with your **full Notion permissions**"* — inherits **the entire** permission set of the signed-in user, **not** granted per page |  `notion.com/help/notion-mcp` |
> | `scopes_supported: ["default"]` — **exactly one** scope, cannot be split further |  `mcp.notion.com/.well-known/oauth-authorization-server` |
>
> Whereas **Notion's static key sees NOTHING by default** — each page has to be manually added as a
> connection (that's exactly the step in lesson 12 step 1 that keeps getting forgotten). ⇒ At
> Notion: **① is narrow, ③ is broad.** Exactly the reverse of the table.
>
> **The rule this yields, applying to every future catalog entry:** *"OAuth ⇒ narrow scope"* is an
> **assumption about a specific vendor**, not a property of the protocol. `scopes_supported` **has
> to be read from that exact server** before writing anything about scope on its card. The other
> four axes (expiry · revocation · who sees the string · what happens if it leaks) still hold.
> → [[agentco-measurement-vs-conclusion]]

#### 5h·4 ⚠ But Google does **NOT** exempt us from static keys — and that's why it's the hardest entry

Google needs **both ② and ③**:

| | who fills it in | becomes what |
|---|---|---|
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | **the user**, after creating an OAuth client in Google Cloud Console | `.state/secrets.json` → the MCP process's `env` |
| refresh token | **the sign-in flow** | the MCP server's own folder |

⇒ Steps B1–B3 of lesson 10 (*create a project, enable 3 APIs, configure the consent screen, add
yourself to Test users*) **don't disappear just because OAuth exists** — they're the step that
produces ②, and ② has to exist **before** ③ can happen at all.

 Checked 08/23: Google **does** have a vendor-hosted MCP suite for Gmail/Drive/Docs/Sheets/Slides
/Calendar/Chat/People, docs updated 2026-08-20, and it **still** requires manually configuring an
OAuth consent screen + client ID. ⇒ Using the vendor's own build (the user's decision) is correct —
it removes supply-chain risk §11d, **but doesn't remove the setup step**.

> **Conclusion for §4e: Google is path G2, not G1.** The Google card on the selection screen
> **must say plainly**: *"needs about 10 minutes of one-time setup at Google"*. Presenting it as
> equal to *"Files on the machine"* (0 keys) would be **overpromising** — and §11a-bis already
> notes: *overwarning makes a user turn off something they needed; overpromising makes them turn on
> something that doesn't exist. The latter is worse.*

⚠ One nuance worth recording, **not to be used to loosen anything**: for an installed/native app,
`client_secret` **isn't treated as a genuine secret** — it can't be kept hidden inside software
distributed to end users, and that's exactly why PKCE exists. So the risk of
`GOOGLE_CLIENT_SECRET` is lower than a Notion token. **But it still goes into
`.state/secrets.json`, so it still sits inside the exact hole just measured in §5d** — handling
doesn't change by a single word.

#### 5h·5 "They already have their own layer" — yes, and **GitHub is the cleanest example**

The second half of the user's question ① is correct, and it describes GitHub exactly:

| | GitHub remote MCP  |
|---|---|
| Where it runs | **`https://api.githubcopilot.com/mcp/`** — nothing to install, no `npx` |
| Transport | **Streamable HTTP** — matches the new standard, §2 |
| Auth | **OAuth 2.0** (recommended) **or a PAT** |
| Static keys to fill in | **0 with OAuth**, 1 with a PAT |
| Supply-chain risk §11d | **none** — no one's code gets downloaded onto the customer's machine |

⇒ **GitHub doesn't need a `client_id` at all** — GitHub is its own identity provider, so Google's
step ② **doesn't exist here**. That's the real difference between *"the vendor already built the
permission layer"* and *"the vendor makes you register an app first"*.

---

### 5i. 🔴🔴 THE ARM WIRED TO A WORKER — three pieces, all three MISSING (measured + patched 08/24)

> **Status: ✅ PATCHED.** Measured with `scripts/spike-mcp-allow.ts` · `spike-mcp-roots.ts` ·
> `spike-mcp-hook.ts` · `spike-arm-e2e.ts`. Original case: `P-260824-0355-r3qe`, office `kiem-ke`.

The `Files on the machine` arm was plugged in (08/23), wired up, the node shows on the diagram,
`company.yaml` and `roles/*.yaml` both record it correctly. The staff agent called the tool
**three times**, all three failed. `blocked · 4 turns · $0.0948 · 0 results`, and step T-02 fell
over as a dependency.

#### ① `allowedTools` doesn't contain the MCP tool's name ⇒ the SDK denies every call

The exact `tool_result` measured:

```
"Claude requested permissions to use mcp__files__list_directory_with_sizes,
 but you haven't granted it yet."
```

`worker.ts` sends `allowedTools = effectiveTools(role.tools)` = the office's 7 tools (+ shell). The
name `mcp__<server>__<tool>` isn't in that set ⇒ "needs to ask" ⇒ no `canUseTool` fires ⇒ **deny**.

| turn | `allowedTools` | tools called | denied |
|---|---|---:|---:|
| A · matches production before 08/24 | 7 tools | 5 | **4** |
| B · `+ mcp__files` (the SERVER prefix) | 8 | 2 | 0 |
| C · `+ all 14 full names` | 21 | 2 | 0 |

⇒ We were paying **~2,185 tokens EVERY TURN** (§9b) for a set of 14 tools that **could never be
used**.

#### ② 🔴🔴 The directory the user declared in the dialog box was IGNORED ENTIRELY

`@modelcontextprotocol/server-filesystem` **prioritizes the client's `roots` over its command-line
argument**, and Claude Code declares `cwd` (+ `additionalDirectories`) as the roots. Measured by
holding `args` fixed and only changing `cwd`:

```
args → …\target-dir   cwd → …\office-dir                       ⇒ Allowed: …\office-dir   ← args discarded
args → …\target-dir   cwd → …\target-dir                       ⇒ Allowed: …\target-dir
args → …\target-dir   cwd → …\office-dir  + additionalDirectories
                                           = […\target-dir]     ⇒ Allowed: BOTH           ✅
```

⇒ Before the patch, an arm pointed at `D:\Downloads\…` could actually **only ever open the office
directory** — exactly what plain `Read` already did, for free. The directory field in §6f was
**decoration**.

> **Three familiar shapes, all at once, and all three already have a name in the record:**
> · `safeJoin`/`secrets.ts` — *a real mechanism, running correctly, opening/guarding something
> ELSE*
> · the `Bash` switch that was a no-op for 6 days — *sending a list of names down to another
> system without checking back what it actually received*
> · [[agentco-measurement-vs-conclusion]] — spikes 1+2 (08/23) measured the **handshake** and
> **token cost**, then concluded the arm worked. **No measurement had yet CALLED an MCP tool.**

#### ③ The condition for ①+② to be safe: the hook has to match `mcp__*`

Turning on ①+② while forgetting ③ **opens a door that writes to `roles/` and reads
`<office>/.state/`** — the exact two holes patched on 08/23, through a different door. Already
logged in advance at §8a-ter, now measured and installed. Three zones, three rules:

| mode | who calls it | `secrets` | `config` | `outside` |
|---|---|---|---|---|
| `read` | `Read`/`Grep`/`Glob` | forbidden | allowed | allowed |
| `write` | `Write`/`Edit`/`NotebookEdit` | forbidden | forbidden | **forbidden** |
| **`arm`** | **`mcp__.*`** | forbidden | forbidden | **ALLOWED** |

**`arm` is allowed to reach outside because that's THE REASON IT EXISTS** — rule §8·0 (*every path
writing outward must go through an explicit, named tool/MCP, readable in the log*). Forbidding
`outside` for `arm` would block the exact proper path that rule just built, and the user would
just go back to `Bash` — which has no boundary at all.

⚠ `arm` forbids **even READING** config files, narrower than builtin `read`. Deliberate: at the
moment the hook runs we only have the TOOL'S NAME, no deterministic way to know whether
`mcp__x__foo` reads or writes — pattern-matching on the name would fall right back into the same
class of nondeterminism already ruled out at `SESSIONS_MEMORY` §5n ㉕. A false negative here costs
**0**: builtin `Read` still reads `roles/*.yaml` exactly as before, and a test locks that in.

#### An arm's boundary — THREE LAYERS, not "no boundary at all"

The question the user asked during review: *"once filesystem access is granted, does scope
blocking go away?"* → **no.**

| layer | who holds it | what it blocks |
|---|---|---|
| 1 · the MCP server's `roots` | **the server**, refuses on its own | every path outside `cwd` + declared directories |
| 2 · the `mcp__.*` hook, `arm` mode | agentco | `.state/` (read+write) · config files (read+write) |
| 3 · `swallowsOffice` (§6i) | agentco, at PLUG-IN time | won't allow the office/company directory itself to be used as a root |

⇒ That's exactly what makes an arm **different from `Bash`**: `Bash` has no layers at all; an arm
has three, and layer 1 is **drawn by the user** and readable on the diagram.

#### The list of 14 tools — actually measured, not recalled from memory (`scripts/spike-fs-tools.ts`)

```
👁 read  (10)  directory_tree · get_file_info · list_allowed_directories · list_directory
               list_directory_with_sizes · read_file · read_media_file · read_multiple_files
               read_text_file · search_files
✍ write (4)   create_directory · edit_file · move_file · write_file
```

> ⚠ **NO delete tool exists** — no `delete`, no `remove`, no `unlink`. `move_file` can only relocate
> within the roots. Plugging in this arm does **not** grant a staff agent the ability to delete the
> user's files.

#### Decision: approve at the WHOLE-SERVER level (user's decision, 08/24)

`allowedTools += mcp__<hash>`, not a per-tool list. Because **the wired edge on the diagram IS the
act of granting permission** (§6e) — dragging a wire from 🔌 down to a staff agent *is* the sentence
"this person may use this arm". Approving tool-by-tool forces the user to answer the same question
again in vocabulary they don't have (`write_file` vs `edit_file`), and 4/14 tools would produce
**exactly the confusing "permission denied" message** that just took a whole session to track down.
Per-tool approval tiers are §8's job — where there's **an actual person clicking the button**.

#### End-to-end verification, through the real `runWorker` (`scripts/spike-arm-e2e.ts`)

| case | result | |
|---|---|---|
| A · list a directory through the arm | ✅ `done` · 3 turns · $0.132 | the exact case that had been failing |
| B · **write outside the office** through the arm | ✅ `done` · the canary is on disk | §8·0's first real run |
| C · read `<office>/.state/` through the arm | 🟢 **blocked** | the log still shows `read text file → index.json` |
| D · write `roles/*.yaml` through the arm | 🟢 **blocked** | |

⚠ **The first measurement of case D did NOT measure what it was meant to:** the staff agent chose
builtin `Write`, so it tested the (old) `write` fence, not the (new) `mcp__.*` matcher. The tool
had to be named explicitly and the test re-run. Recorded because this trap will recur: **a test
case that goes through a different path than the one it meant to try has a 🟢 result that's about
something else entirely.**

#### A mandatory consequence: VISIBILITY opens together with PERMISSION

The 08/22 rule (`SESSIONS_MEMORY` §5n ⑦): *widening a permission requires widening the visibility
into it, **in the same edit** — split the two and there's a window between them where the
permission is already wide and the eyes are still narrow, which is exactly the shape of every
silent incident.* An arm just went from "never actually runs" to "can write a file to the user's
disk", so on the same day:

- `describeCall` now shows **the name the user gave it** + the action + the destination:
  `Programs Installation 2 · write file → ban-ke.md`, replacing `working with a385afc3ab6` (a
  **hash**). ⚠ The tool name's suffix prints **verbatim**, not through a hand-written translation
  table — that table would be correct for `filesystem` and mute for Notion/GitHub/a server the
  user plugged in themselves, i.e. it would break **exactly when the catalog grows**.
- `whereBlock` drops the line *"Wrote out through: \<hash\>"*. It **claimed more than we actually
  check**: `landingOf` records a *call*, not its outcome, and 10/14 tools are read-only. A real
  case: `r3qe` was denied all three times, not a single byte was ever written, and the report
  still said "Wrote out through". The new line: `Used connection: <label>` + a separate line
  fencing off the uncertain part.
- `warnDroppedTools` now also covers the case of **"declared `mcp:` but the CLI granted 0 `mcp__`
  tools"** — the same invariant, *"what I asked for and what I received don't match"*, without
  inventing a second mechanism that has to be kept in sync.

**+21 tests → 344** (`test/arm-wiring.test.ts` + 4 `arm` cases in `test/jail.test.ts`).

---

### 5j. ✅ TAKING `npx` OFF THE HOT PATH — the numbers decided this, not an argument (08/24)

The user hit this in real use and disproved a line in our own documentation: *"sometimes it times
out… and I've never once seen the 'fast load' case happen. It's slow every single time."* Lesson
11 promised *"22.3 s the first time · ~4 s afterward"*. **The second half had never been
measured** — it came from exactly one lucky stopwatch reading, then got copied into three places
(`probe.ts` · `api.ts` · `TEST-WALKTHROUGH`).

Measured across 10 runs (`scripts/spike-npx-cost.ts`), with the package **already sitting** in the
`_npx` cache:

| | |
|---|---:|
| `npx` starts the server (cached) | **3.8 – 4.3 s** — run 1 = run 3 |
| `node <already-cached file>` | **0.79 – 0.84 s** |
| end-to-end `probeArm` via `npx` | **7.7 – 9.2 s** |
| end-to-end `probeArm` via `node` | **4.2 – 4.5 s** |
| `npx -y --offline` | **3,878 ms** ⇒ **NOT network-related** |

⇒ **~3.2 s is npm's own resolver machinery overhead**, not package downloading, and it never gets
smaller. The real cost is bigger than the plug-in dialog suggests: every `query()` spawns a fresh
MCP process, so that cost gets paid on **EVERY task carrying that arm**, forever.

**Three misconceptions, corrected:**
- *"npx isn't global, so doesn't it need to run inside `/company` to be reused?"* → **the npx
  cache IS global** (`%LOCALAPPDATA%\npm-cache\_npx` · `~/.npm/_npx`). Reuse across offices **was
  already happening** — and that's exactly why the reuse case was still slow: the slowness was
  never about downloading.
- *"does npx have to run inside the exact target directory?"* → no, and an MCP process's `cwd`
  also doesn't decide what directory it can read (§5i ②).
- *"is it the machine's config? is it the AI?"* → neither.

**Built (`core/armexec.ts`), deliberately split into two halves:**

| | |
|---|---|
| `fastLaunch` | **SYNCHRONOUS**, pure disk reads. Used in `pickMcp` (every task) and `probeArm`. If an installed copy already exists, swaps `npx` → `node <entry>`; otherwise returns the **original config unchanged** |
| `ensureInstalled` | **ASYNCHRONOUS**, `npm install --prefix ~/.agentco/arms/<hash>`. Called from the **Try now** button (awaited) and when the daemon opens a company (`void`, not awaited) |

Split because `pickMcp` is a **synchronous** path — turning it `async` would drag an `await` into
exactly the hottest spot to pay for an install that should already have happened beforehand.

**Re-measured after the patch:** `probeArm` **7.7–9.2 s → 4.0–4.2 s**, matching the direct-`node`
baseline exactly. The very first run costs **~28 s** (one `npm install`), and it's never paid
again.

> ⚠ **A direct answer to the user's question during review — *"if a change is this much upside for
> zero cost, why wasn't it done already?"*: it is NOT zero cost.** It creates a package-management
> layer with three distinct failure cases of its own: the machine has no `npm` · the registry is
> unreachable the first time · the cache directory gets cleaned out. All three are handled by
> **ONE rule**: ***whenever in doubt, fall back to the ORIGINAL config and let `npx` run as
> before.*** This patch is only ever allowed to make things **faster**, never allowed to make them
> **broken** — because if it breaks, `company.yaml` still says `npx` exactly as before and no one
> can guess the cause.
>
> ⚠ `env` has to pass through intact: `pickMcp` injects the key into `env` BEFORE `fastLaunch` runs.
> Rewriting the config and dropping `env` along the way produces an arm that runs fast and **has no
> key** — the symptom (`401`) sits very far from the cause. There's a test guarding this.

**The package store is `~/.agentco/arms/`, and it's a CACHE** — safe to delete anytime, rebuilds
itself, shared across every company. Deliberately **not** placed inside `company/.state/`: zip a
company over to another machine and `node_modules` would come along with it, breaking exactly the
promise *"zip it and it runs"*.

**+12 tests → 369** (`test/armexec.test.ts`; over half the tests guard the **"must fall back to the
original config"** branch).

---

## 5h·6. ✅ THE REDIRECT ADDRESS when the daemon is NOT on the user's own machine (user asked 08/26)

> *"the redirect flow needs to handle the case where the customer runs Docker, a VPS, nginx → a
> domain. But I haven't tested that… option 1 is log it as backlog, option 2 is do it now, **I'm
> worried about building it and leaving it untested, that seems off**."*

A valid concern, and it splits the problem at exactly the right seam:

| | Testable today? | Decision |
|---|---|---|
| **The decision logic** — deciding what string `redirect_uri` is | ✅ a pure function, a few milliseconds | **do it now** |
| **The deployment** — nginx · TLS · compose · docs | ❌ can only be known once actually stood up | **backlog** |

⇒ What got built is **the decision logic**, not a deployment feature.
`test/redirect-base.test.ts` (+13) runs without any Docker at all.

### 🔴 Why `redirect_uri` is the ONE thing in this flow that must never be guessed

It's where **the authorization code** gets sent, and that code converts directly into a key.
Deriving it from the `Host` header — something **the client sends, and can therefore fake** — would
mean anyone able to call the daemon could also choose where the code gets delivered. That's an
account-takeover hole, not a convenience detail.

*(The same reasoning already used for `isLoopback`: only reads the **socket's** address, never
`X-Forwarded-For`.)*

### Three branches, and the third is what saves the person deploying it

| Situation | Result |
|---|---|
| `runtime.public_url` declared | use it, after careful validation |
| loopback, not declared | `http://127.0.0.1:<bound port>` — **the only case actually tested so far** |
| **bound externally, not declared** | 🔴 **REFUSED**, the error message names `AGENTCO_RUNTIME_PUBLIC_URL=…` directly |

The third branch matches the same pattern `serve()` already uses for `AGENTCO_TOKEN`: open a port
to the outside while missing something mandatory, and it **stops immediately, says so plainly**.
Without this, a daemon inside Docker would still register `127.0.0.1:7317`, and the vendor would
send the code back to **the user's own machine** — where nothing is listening, or worse, where
**something else entirely** is listening. And the symptom would surface in a browser tab, far from
the daemon, far from any log.

### Four checks, each blocking one "sent through the wrong door" error message

- **`http://` reaching outside this machine ⇒ refused.** An authorization code traveling naked
  over the network can be converted into a key by anyone standing in the middle. Most vendors also
  refuse it themselves — we **don't rely on them remembering to** refuse it on our behalf.
  `http://127.0.0.1` is fine: that's a legitimate dev/tunnel case.
- **Contains `?` or `#` ⇒ refused.** A sign that a whole URL got pasted by mistake. Ignoring it
  silently would leave `redirect_uri` mismatched **character-for-character** against what's
  registered, and the vendor returns `invalid_redirect_uri` — a message that **never states the
  real cause**. Caught while the person is still looking at the config file.
- **Path prefix is preserved**, trailing slash dropped — nginx mounting agentco under `/agentco` is
  valid.
- **An empty string means NOT DECLARED**, not "declared as empty". `new URL('')` throws a message
  about URLs, which buries the real message: *"nothing was declared"*.

### Config: NO new concept invented

`runtime.public_url` in `company.yaml`, and the env-override mechanism **that already exists**
turns it into `AGENTCO_RUNTIME_PUBLIC_URL` — no new `.env` file, no new config-reading path.

### 🔴 "Does OAuth work with a properly secured VPS?" — the user asked 08/26, and CHECKING turned up TWO hard blockers

The answer isn't "yes" or "no". Reading our own code turned up **two definite blocking spots**,
both now patched:

**① `hostAllowed` returns `false` for every domain ⇒ 403 for EVERY request.** Behind nginx, `Host`
is `agentco.cty.com`, while we bind `0.0.0.0`; the function compares those two strings and refuses.
Meaning **agentco has never once been able to run behind a domain name** — not just OAuth, the
whole site. Nobody knew because nobody had ever stood one up. Fix: a valid domain is something the
person deploying **already declared** in `public_url`. The same declaration that decides
`redirect_uri` also opens the Host gate — one source, two consumers. ⚠ **Not** loosened into
"accept any Host": this check exists to block DNS rebinding, and an unrecognized Host is still
blocked even once one has been declared.

**② The token gate blocks `/api/*`, and the callback sits inside it ⇒ 401 on the last step, every
time.** The vendor delivers the code via a **302 to the browser**, and the browser follows the
redirect as an ordinary navigation: it does **not** attach `x-agentco-token`. Stuffing the token
into `redirect_uri` doesn't work either — it must match character-for-character what's registered,
and it would end up sitting in the vendor's own logs. Fix: carve out exactly one path exception.
⚠ Not a loosening — **that path's real authentication is `state`**: 128 bits, lives ≤10 minutes,
single-use, and nothing happens if it doesn't match. Layering the daemon's own token on top adds
nothing and breaks the whole flow.

### ✅ Good news, and it's a property of the protocol, not luck

**An authenticating reverse proxy (Cloudflare Access · SSO · basic auth · VPN · mTLS) does NOT
block OAuth.** Because the callback is **the user's own browser navigating**, not a
server-to-server call from Notion. That browser just signed in to reach agentco in the first
place, so it's already carrying the domain's cookie/certificate — and it carries that along when
it follows the redirect. Notion **never once** calls into our machine.

⇒ What actually has to be opened to the internet is **the user's browser reaching your domain**,
not "reaching the daemon". That's a far easier condition, and it's already satisfied at any
company that already has SSO.

### ⚠ The spot that's ACTUALLY fragile, and it's the opposite direction: **EGRESS**

The flow's three calls (`discover` · `register` · exchanging/refreshing a key) go **daemon →
vendor**. A company VPS often locks down egress or forces it through a proxy. These calls die
right there, while **everything else keeps working** — so whoever goes looking will inspect the
INBOUND direction (nginx, firewall, VPN) and find nothing wrong.

🔴 And one detail costly enough to burn an entire session on: **Node's `fetch` does NOT
automatically read `HTTPS_PROXY`.** Setting that variable and assuming it's handled is a real trap
(`NODE_USE_ENV_PROXY=1`). `discover`'s error message now states all three of these plainly instead
of *"check your network or the URL"*.

⏸ **What's genuinely still backlog:** a Dockerfile · an nginx template · TLS · and **one real trial
run on a VPS**. Until it's actually run, the "has a domain" branch remains **unmeasured** — the two
patches above remove two *known* blockers; they don't prove a third one isn't lurking.

## 5h·7. ✅ DEVICE FLOW — a vendor with NO DCR, and this path is **easier** than Notion's

**Date:** 2026-08-26 · `scripts/spike-github-device.ts` · **$0 model cost** · GitHub App
`agent-co.app`, owned by org `@agent-co-app`, client_id `Iv23li95pd8QpYfTGMho`.

> **The whole section's takeaway:** a vendor with no DCR **does not** mean the user has to type a
> key. It only means **`client_id` has to come from data instead of from the handshake**. And if
> that vendor declares a `device_authorization_endpoint`, the rest of the flow **needs no secret at
> all**.

### 5h·7a. Why Notion's flow could NOT be reused — and this is the easiest place to guess wrong

 GitHub's docs, web flow: `client_secret` **"Required."** PKCE at GitHub is **ADDED ON TOP**, not
**A REPLACEMENT** for the secret — even though the metadata declares
`code_challenge_methods_supported: ["S256"]`.

⇒ The public-client flow already running for Notion (`token_endpoint_auth_method: 'none'`) **dies
at the code-exchange step**, and dies with a **401**. Without reading the docs first, we'd go
looking on the key side, the account side, the workspace side — exactly the §5m error class, and
this time **we'd be manufacturing it for ourselves**.

> ⚠ **Rule:** `code_challenge_methods_supported` in the metadata says *"the server accepts PKCE"*.
> It does **NOT** say *"the server accepts a public client"*. Those are two different statements,
> and RFC 8414 has no field forcing a server to declare the second one
> (`token_endpoint_auth_methods_supported` is **absent** at GitHub). Absence is not a signal.
> → [[agentco-deterministic-vs-signal]]

### 5h·7b. In exchange, the device flow drops more than it adds

| | web flow (Notion) | **device flow (GitHub)** |
|---|---|---|
| `client_secret` at code exchange | not needed (DCR grants a public client) | ✅ **not needed** |
| `client_secret` at **refresh** | not needed | ✅ **not needed** —  *"Required **unless** the user access token was generated using the device flow"* |
| `redirect_uri` | required, must match character-for-character | ❌ **DOESN'T EXIST** |
| `state` · `code_verifier` · a `pending` map | present | ❌ none |
| DCR | present | ❌ none — `client_id` comes from data |

🔴 **The biggest consequence, and it's counterintuitive: §5h·6 does NOT APPLY to this arm.**
`redirectBase()` · `public_url` · the three branches · the four checks · the two hard blockers
patched on 08/26 — **none of it is relevant**, because no authorization code is ever flying
anywhere. Docker · VPS · nginx · Cloudflare Access · a closed internal network: **all irrelevant.**
⇒ Among the four v1 catalog entries, GitHub is the **easiest to deploy**, not the hardest — the
exact reverse of the ranking §4e recorded on 08/23.

The price, stated plainly so the card doesn't overpromise: the user has to **type an 8-character
code** on GitHub's own page, and for a GitHub App there's an extra step of **installing the app on
a repo**. ⇒ **Two third-party screens**, versus Notion's one.

### 5h·7c. ✅ MEASUREMENTS — five questions, four answered

| Q | Question | Result |
|---|---|---|
| **1** | Does the device flow run with a bare `client_id`? | ✅ **YES** — 0 secrets. Completed in 200 seconds (including the time the user spent acting) |
| **2a** | Is there a `refresh_token`? | ✅ `ghu_…` (40 chars), lifetime **8.0 hours** · `ghr_…` (80 chars), lifetime **4,416 hours = 6 months** |
| **2b** | Does refresh work without a secret? Does it **rotate**? | ✅ works · 🔴 **YES, IT ROTATES**, and the old key **dies immediately** on reuse |
| **3** | 🔴 Does the MCP accept a token from a **different app**? | 🟢 **YES** — `github-mcp-server/remote-6e886500…`. **Option A survives.** The GA changelog's *"more third-party host apps coming soon"* had us worried unnecessarily: that line is about **built-in IDE integrations**, not a client whitelist |
| **4** | Can a **private** repo be reached? | ✅ **YES** — read ✅ and **write ✅**: a real commit landed in `octocat/test` (private), authored by the signed-in user themselves. See 5h·7j |
| **5** | Token cost per slice | 🔴 see 5h·7e — **this constraint dominates the whole design** |
| **6** | **Whose** key is this? | 🔴 GitHub **doesn't return an account name** in the token response ⇒ `get_me` has to be called separately. See 5h·7k |
| **7** | Multiple slices under **one** arm? | ✅ the `X-MCP-Toolsets` header works — **one node, not three**. See 5h·7e |

`scope` comes back **empty** ⇒ confirms this is a real **GitHub App** (works via permissions), not
an OAuth App (works via scope). The two types declare the same `issuer`, so **they can't be told
apart from the metadata alone** — only distinguishable **once a key is actually in hand**.

### 5h·7d. 🔴🔴 THREE BUGS IN `postToken()` — all three INVISIBLE with Notion, all three EXPLODE with GitHub

This is the most expensive part of the spike, and it wasn't even one of the spike's questions.
Inside **one function** (`core/oauth.ts §postToken`), three wrong premises, each one correct-for-
Notion:

| # | The premise hiding in the code | What GitHub actually does | How it breaks |
|---|---|---|---|
| **①** | *"the server returns JSON"* | returns **form-urlencoded** unless `Accept: application/json` is sent — and `postToken` **doesn't send** that header | `JSON.parse` throws immediately on the **very first** code exchange. Loud, easy to spot |
| **②** | *"broken means `!res.ok`"* | returns **HTTP 200** with a body of `{"error": …}` (measured) | `postToken` reads this as **success** ⇒ `applyToken` builds an account with `access_token: undefined` ⇒ `saveOAuth` **overwrites a perfectly working account with a broken one**. 🔴 **SILENTLY broken**, and it happens inside the **background refresh loop** |
| **③** | *"a dead key means `invalid_grant` \| `invalid_client`"* | returns **`incorrect_client_credentials`** | doesn't match ⇒ classified as *temporary failure* ⇒ the `dead` flag **never fires** ⇒ the refresh loop retries **every 15 minutes, forever**, and the interface **never** shows the *Sign in again* button. Meaning the `dead` mechanism is disabled **at exactly the vendor that needs it most** |

> **② is worse than ① even though ① sounds louder.** ① explodes immediately, with a stack trace,
> fixed in 5 minutes. ② **doesn't explode at all** — it writes a syntactically valid file with wrong
> content, inside a background loop nobody's watching. Exactly the shape already logged in §5s:
> *"the path most likely to actually run is the refresh loop"*.

🔴 **And ③ carries a wrong-door error message straight from GitHub itself:**
`"The client_id and/or client_secret passed are incorrect."` — while the truth is that **the
refresh token got rotated**. Showing that string verbatim to the user sends them off to check
`client_id`, which is **not wrong at all**. ⇒ We have to **rewrite it**, never forward it.
→ [[agentco-wrong-door-errors]]

**The required patch, three lines in one place** — and the rule it yields reaches further than the
patch itself:

1. Send `accept: application/json` on **every** token call.
2. Read the JSON body **first**, classify by `body.error` **first**, `res.ok` is only a secondary
   signal.
3. The dead-key list must include `invalid_grant` · `invalid_client` ·
   **`incorrect_client_credentials`** · `bad_refresh_token`, and **a 200 response missing
   `access_token` also counts as broken**, not success.

> ⚠⚠ **A rule worth more than all three patches:** *an OAuth flow that already runs correctly for
> ONE vendor has only proven the **mechanism**, not the **shape of the response**.* All three bugs
> above are places where we read Notion's habits as a property of the protocol — **the third time**
> in three sessions (earlier: *"OAuth ⇒ narrow scope"* §5h·3, *"GitHub is its own identity
> provider"* §5h·5).
> ⇒ [[agentco-measurement-vs-conclusion]] · [[agentco-catch-hides-premises]]

### 5h·7e. 🔴 TOKEN COST — the dominant constraint, bigger than everything else in this section

Measured by the raw byte size of `tools/list` (⚠ an **estimate, ÷4**, not `getContextUsage()` — use
it to **compare slices against each other**, never to promise a number to anyone; the two sources
have disagreed by 27% before, §9b ③):

| endpoint | operations | ≈tokens | three tiers |
|---|---|---|---|
| `/mcp/x/all` | **89** | **≈60,000** | 👁60 ✍0 🔴29 |
| `/mcp/` (default) | 44 | ≈30,000 | 👁27 ✍0 🔴17 |
| `/mcp/readonly` | 27 | ≈18,000 | 👁27 ✍0 🔴0 |
| `/mcp/x/repos` | 19 | ≈10,000 | 👁13 ✍0 🔴6 |
| `/mcp/x/pull_requests` | 10 | ≈8,300 | 👁3 ✍0 🔴7 |
| `/mcp/x/issues` | 9 | ≈8,000 | 👁6 ✍0 🔴3 |
| `/mcp/x/repos/readonly` | 13 | ≈7,000 | 👁13 ✍0 🔴0 |
| `/mcp/x/context` | 3 | ≈1,500 | 👁3 ✍0 🔴0 |

**Three conclusions, and the second one changes the design:**

1. **Plugging in the whole of `/mcp/` isn't something we can do.** agentco's tool-definition floor
   already sits at ~13,200 tokens (`SPEC-token-economy` §2); an arm costing ≈30,000 tokens is
   **more than double the entire baseline**, every single turn. `x/all` at ≈60,000 isn't even worth
   discussing. Compare: `filesystem` measured at **2,185**, Notion at 28 operations.
2. ⇒ **Slicing is NOT an advanced option — it's the condition for this entry to exist at all.** And
   luckily every slice is just a **URL string**: `/x/<toolset>` plus a `/readonly` suffix. **0 lines
   of code per slice**, matching the §5h·1 invariant (*the catalog is data*).
3. **`/readonly` is both a fence AND A DISCOUNT.** `x/repos` at 19 operations ≈10,000 →
   `x/repos/readonly` at 13 operations ≈7,000. The "read-only" tier here is **30% cheaper**, and
   that's the first time in the project a permission tier has a **measurable price** to display on
   the card.

🔴 **The MIDDLE tier is empty at EVERY slice** (`✍0` across the whole table): 0/89 tools declare
`readOnlyHint:false` **combined with** `destructiveHint:false`. Not a reading error — **44/44 and
19/19 all DO declare annotations**, it's just that no tool falls into tier 2's combination. ⇒ By the
rule *"an empty tier must not exist"* (§6j), **the GitHub arm has EXACTLY TWO tiers**: *Read-only*
and *Full access*.

> And GitHub's *Read-only* tier is **stronger** than Notion's tier of the same name, by nature:
> Notion cuts on **our** side (filtering `allowedTools`), GitHub cuts on **the server's side**
> (`/readonly` — 27 operations instead of 44, the server never emits a single write tool at all).
> Two shields at different layers ⇒ **use both**, neither replaces the other.

### 5h·7f. `404` is a wrong-door error message from GitHub — and we have to rewrite it

Calling `get_file_contents` on a private repo **the app isn't installed on** returns:
`failed to get repository info: GET https://api.github.com/repos/…: 404 Not Found`

GitHub deliberately returns **404, not 403**, for a private repo it has no access to (so as not to
leak the repo's existence). But to an agentco user, a 404 reads as *"the repo name was typed
wrong"* — they'll go check spelling, check the branch, check the file path. **The truth is the app
was never installed on that repo.**

⇒ Mandatory: when a GitHub tool returns 404 on `repos/{owner}/{repo}`, the interface must **not**
forward the string verbatim, but say: *"agentco isn't installed on this repo — open
`github.com/apps/<slug>/installations/new` to add it."* Matches the same pattern as §5m: **we know
a cause in advance that the server doesn't have enough context to know.**

### 5h·7g. The device-flow polling loop **has to tolerate a network drop** (a real case, 08/26)

The first measurement run died after ~95 seconds with exactly the two words `fetch failed` — a
network hiccup mid-poll, and the loop simply **gave up**.

The consequence is wildly out of proportion to the cause, and that's exactly why it belongs in the
spec: **the user, at that moment, was standing right on GitHub's page and had just clicked
Approve.** GitHub says *"access granted"*, agentco says *broken*. Two screens saying opposite
things, and the wrong screen is ours — while the key had, in fact, **really been granted**.

⇒ Apply the exact rule already settled for `refreshDue`: **two kinds of failure, two opposite
handling paths.** A network hiccup ⇒ retry silently; `access_denied` / `expired_token` ⇒ stop and
say so. The stopping point is **the code's own expiry** (15 minutes), not a retry count ⇒ no
infinite loop. And the error message must carry **a step label** (`[requesting a code]` ·
`[polling]` · `[refreshing]`) — a bare `fetch failed` says nothing about where it broke, and those
three spots are fixed by three different things.

### 5h·7h. ✅ AGENTCO OWNS THE APP (user's decision, 08/26) — and why that does **NOT** hand us a path into a customer's repo

> The user asked directly: *"that agentco account of mine now gets invited into permission on a lot
> of customer repos — doesn't that sound alarming?"*

**No — and the mismatch is in one concept:** `client_id` is **the identity of the SOFTWARE**, not
of a user account. There's no invitation, no collaborator added, the app owner's repo list doesn't
grow by a single line. The key is issued **directly to the daemon running on the customer's own
machine**, and **agentco has no server** — there's no infrastructure anywhere for the key to pass
through.

But three risks are **real**, and the third is the one worth naming plainly:

| | Risk | Handling |
|---|---|---|
| a | The app owner's name shows on every customer's consent screen; we're bound by GitHub's API ToS | ordinary business of shipping software |
| b | **A shared point of failure** — one customer abuses it ⇒ GitHub suspends the app ⇒ **every customer breaks at once** | a "use your own `client_id`" option, see below |
| c | 🔴 **The GitHub App owner can generate a private key at any time**, and a private key can mint an installation token ⇒ reach into any repo the app is installed on | **the rule below** |

> ### 🔴 RULE: AGENTCO'S GITHUB APP **NEVER HOLDS A PRIVATE KEY**
> No key ⇒ the path to mint an installation token **doesn't exist** ⇒ (c) isn't a promise, it's a
> **verifiable absence**. Same shape as the §5b invariant (*"no API can read a key's value"*):
> forbidden by **structure**, not by discipline.
> Also **no `client_secret` is generated** — the device flow never needs one at any step.
> ⚠ If GitHub blocks **installing** the app without a key existing first: generate a key → install
> → **delete the key immediately**, and log the date that work happened, right here. The end state
> must still be *no key exists at all*.
> 📌 **Recheck this every time the GitHub entry is touched.**

**The "use your own `client_id`" option** patches both (b) and (c) at once, and it's the most
honest answer to an enterprise customer asking *"why should I trust agentco"*: **"you don't have to
— this is the option that means you don't need to."**

> ### ⛔ CORRECTION 08/27 — THIS SECTION USED TO SAY THAT OPTION ALREADY EXISTED. **IT DOES NOT.**
>
> The old text read: *"is a **first-class citizen**, not a hidden mode… deleting their paste ⇒
> **0 lines of code added**."* Measured 08/27, both halves are wrong:
>
> | Check | Result |
> |---|---|
> | Does `oauthDeviceStart(catalogId)` take a client_id parameter? | ❌ **no** — reads `arm.auth.clientId` directly |
> | Does `web/src` contain the string `clientId`? | ❌ **0 occurrences** |
> | Is it actually true that "0 lines of code added"? | ❌ needed: a parameter for `oauthDeviceStart` · threading it through `devices` · somewhere to **store** the override · a field in the interface |
>
> 🔴 **This is the second time in one session** hitting the same error class (§5h·7f-bis was the
> first): a spec section describing something in detail, with reasoning, even a flat "done"
> statement — with **0 lines actually implementing it**. And this error class **has no alarm bell**:
> [[agentco-yaml-step-is-a-bell]] only catches the case with a manual step editing a file; here
> there's no step to give it away.
>
> ⇒ **Rule for catalog entries going forward:** any sentence claiming a feature *"is a first-class
> citizen"* / *"already exists"* must be paired with **the name of the enforcing function** or
> **the name of a test file**. Without one, write it in the future tense.
> → [[agentco-deterministic-vs-signal]]: *a deterministic gate can only speak about things that
> have enforcing code.*

### 5h·7j. ✅ END-TO-END ACTUALLY RAN — read, write, and **the fence is a real fence**

| Measurement | Result |
|---|---|
| Read a file in a **private** repo (`octocat/test`) | ✅ `get_file_contents` returns the content |
| **Write** a file into a private repo | ✅ commit `55c55869…`, authored by **`octocat`** — meaning it writes **under the signed-in person's name**, not under a bot's |
| The same write call, but through `/x/repos/readonly` | 🟢 **REJECTED AT THE PROTOCOL LAYER**: `-32602 unknown tool "create_or_update_file"` |

> **The third line is the one worth money.** `/readonly` doesn't just **hide** the tool from
> `tools/list` — it **rejects the call itself**. That's the difference between *a list* and *a
> fence*, and it lives **on GitHub's own server**, out of reach of anything running on the
> customer's machine. GitHub's *Read-only* tier is therefore **stronger than Notion's tier of the
> same name** (which cuts via `allowedTools` on our own side).
> ⇒ Keep **both layers**: our own filtering **and** the `/readonly` endpoint. Two shields at
> different layers.

⚠ **An operational detail, don't drop it:** the commit carries the name and email of **the
signed-in person**. Meaning every action an agentco staff agent takes on GitHub is **attributed to
the exact human who granted permission** — consistent with §6k (*"attribute statements to the
person who actually said them"*), but it also means a customer's repo history will carry commits
under their name that **they didn't personally type**. The card must state that plainly.

### 5h·7k. 🔴 IDENTITY IS NOT IN THE TOKEN RESPONSE — it has to be ASKED FOR

Notion returns `workspace_id` + `workspace_name` right inside the token response; `accountName()`
uses `workspace_id` as the hash seed and `workspace_name` as the label. **GitHub returns both
empty** — no name, no id, `scope` also empty.

⇒ `accountName()` falls back to the `issuer|mcp_url` branch, and that string is **identical for
every GitHub account** ⇒ two different accounts produce **the same key name** ⇒ **the same hash**
⇒ **merged into a single arm**. Exactly the case §6i was built to prevent, just at a different
vendor — and this time it has **no visible symptom** until a second person signs in.

**The patch: an "ask for identity" step after sign-in**, expressed as **data**, not a code branch:

```ts
identity: { tool: 'get_me', idField: 'id', labelField: 'login',
            url: 'https://api.githubcopilot.com/mcp/x/context' }
```

Measured: `get_me` returns `{"login":"octocat","id":98765432,…}` — enough for both a hash seed
(`id`, stable, doesn't change on rename) and a label (`login`). An entry that **already has**
identity in its token response (Notion) leaves this field blank; the shared flow reads it as *"ask
if `identity` is declared, skip otherwise"*.

> 🎯 **And it also patches a UX trap we just stepped in ourselves:** this session's very first
> sign-in attempt grabbed the key for **`agent-co-dev`** (the app owner's own account) instead of
> `octocat`, because the browser happened to be signed into that account. Without an identity-check
> step, the only symptom is *"the arm can't see any repos"* — a **wrong-door** message that sends
> people off to check permissions, check the installation, check the repo.
> ⇒ The post-sign-in screen **must show `@login`**, with a *"Not me — sign in again"* button right
> next to it. **The app owner ≠ the app's user**, and the browser is often signed into the wrong
> person.

### 5h·7l. 🔴 REPO SCOPE is **NOT** part of the hash — and it's an entirely different kind of scope than a directory

> User asked 08/27: *"do different repos count as different servers by hash? What about 'all
> repos' — does that count as one? But does it update in real time?"*

**Answer: not part of the hash · one arm · and YES, it updates instantly.** The reason comes down
to *where the scope is actually held*:

| | **Directory** (Files on the machine) | **Repo** (GitHub) |
|---|---|---|
| Where the scope lives | in the config's `args` — **on our side** | in the **app's installation**, on GitHub's side |
| Part of `armHash`? | ✅ **YES** | ❌ **NO** |
| Changing the scope means | **a different arm** (has to be re-plugged) | **nothing changes on our side at all** |
| Who enforces it | `mcpServers.args` at startup | GitHub, **on every single call** |
| Updates instantly | ❌ has to be re-plugged | ✅ **yes** — the very next call already sees it |

⇒ A GitHub arm = **(account + toolset + tier)**. Installing on 1 repo or on `All repositories`
both produce **exactly the same** hash; adding/removing repos on GitHub **does not** spawn a new
arm, needs no re-sign-in, needs no re-plugging — because our key is a **user token**, and GitHub
recomputes permission **on every request**.

> ### ⚠ CORRECTION: *"choosing a repo is like choosing a directory"* — WRONG, and wrong on the axis that matters most
>
> That line was written on 08/26 while laying out the UI, and it's correct about **the screen's
> shape** (a checklist). But it's **wrong about ownership**: a directory is **our own config**, a
> repo is **the vendor's live state**. Conflating the two leads to exactly one broken decision:
> **caching the repo list into `company.yaml`** — and a list like that **goes stale without anyone
> knowing**, i.e., a lie with an expiration date.

> ### ⚠⚠ SECOND CORRECTION (08/27): this section is about the **OUTER fence**, and only that one
>
> Reading §5h·7l on its own leads to the conclusion *"agentco can't limit which repos are
> reachable"*. **Wrong**, and the user pushed back immediately: *"I want to limit that specific MCP
> to only that one repo — not something GitHub can block, only something OUR fence can do."*
>
> There are **two** fences, two different owners, and this section only ever talked about the
> first:
>
> | | Who holds it | Part of the hash | Changing it | Enforced at |
> |---|---|---|---|---|
> | **Outer** — the app's installation | GitHub | ❌ | instantly, for **every** office | GitHub's server, per request |
> | **Inner** — our own restriction | agentco | ✅ | **a different arm** | `PreToolUse`, §5h·7m |
>
> The inner fence is always **narrower than or equal to** the outer one. The outer answers *"what
> can be reached at all"*; the inner answers *"what can THIS arm reach"*. The three consequences
> below still hold exactly as written — they're about the outer fence.
>
> And the door to the outer fence is **a button**, not helplessness: `catalog.ts §scope` opens
> `apps/agent-co-app/installations/new`. We don't rebuild that screen ourselves because it's **a
> consent screen** — no API lets software add repos to itself, and if one did, the whole consent
> mechanism would be meaningless. 📌 **One app serves unlimited customers**: `client_id` is the
> SOFTWARE's identity, each customer installs it into THEIR OWN account and gets their own
> installation carrying their own repo choices. The customer **creates no app**, has no 15-minute
> step — that's Google's G2 path (§5h·4). The app is already set to **public** (user confirmed
> 08/27); setting it private would mean only the owning account could install it, and a customer
> clicking the button would hit a dead end.

**Three mandatory consequences:**

1. **The GitHub arm's detail panel must NOT list repos.** The `filesystem` arm shows a directory
   because the directory sits inside the config it's actually running with (§6i, 08/24). Here
   there's nothing equivalent to show — just one line, *"Repo scope is held by GitHub"*, plus a
   link to the installation settings page. Showing a fetched-then-cached list would rebuild exactly
   the §15i case (*reading DECLARED config instead of RUNNING config*), this time drifting over
   time.
2. 🔴 **An asymmetry with the permission-tier rule, and it has to be stated:** *"changing the tier
   in this office doesn't touch other offices"* holds **because the tier is part of the hash**.
   Repo scope is the opposite — it's an **account-level** asset, so adding one repo adds it for
   **every office** using that key, all at once, with nothing on our side watching for it. Same
   shape as **a key's own value** (§PRODUCT DECISION 08/25): editing from one office silently
   changes it for every office ⇒ the only real door has to sit **outside** agentco, and here it
   sits on GitHub itself.
3. **Wanting two different repo scopes ⇒ requires two different ACCOUNTS**, not two arms. That's a
   genuine limit of the model, and the card has to state it rather than let the user discover it
   themselves.

### 5h·7f-bis. ✅ TRANSLATING 404 — the **ENFORCEMENT half** of §5h·7f (built 08/27)

> ⚠ **A correction to this very section:** the first draft claimed *"§5h·7f was never actually
> written"*. **Wrong** — it sits right above (around line ~1345) and has described this exact case
> for a while. What was missing was **the code**: not a single line in `src/` caught that case,
> from the day that section was written until now.

> The lesson worth keeping is bigger than the patch itself: **a spec section can describe things
> correctly, with an example, with a measurement — and still have 0 lines implementing it.** It
> drifted this long because the repo fence (§5h·7m) hid the symptom. Same family as
> [[agentco-yaml-step-is-a-bell]], except here the bell **doesn't ring**, because there's no manual
> edit-a-file step to give it away. → [[agentco-deterministic-vs-signal]]: *a deterministic gate can
> only speak about things that have enforcing code.*

`worker.ts §githubDoorError`, runs at `PostToolUse`. Four rules, each one locks out one direction
of breakage:

| Rule | Why |
|---|---|
| **Keep the original message, only APPEND to it** | swallowing a failed call into "fine" is the exact opposite mistake as Notion's `Error:` string that burned 10 turns. Fix the MESSAGE, not the RESULT |
| **Only when `owner`/`repo` are present** | a 404 on a call that isn't about a repo is about something else. Guessing anyway = swapping one wrong-door message for another wrong-door message, this one written by **us** |
| **Includes a link to the install screen** | without a "here's what to do next" half, a translated message is still a dead end |
| **Explicitly says *"don't assume the repo doesn't exist, don't try guessing another name"*** | without that warning, every retry is a paid call for the exact same rejection |

The URL comes from `catalog.scope.url`, i.e. **data** — 0 `=== 'github'` branches, so a second
vendor with the same style of 404 gets handled automatically.

### 5h·7m. ⛔ AGENTCO'S OWN REPO FENCE — built and REMOVED on the same day, 08/27. **Don't rebuild it.**

> Morning: *"I want to limit that specific MCP to only that one repo — not something GitHub can
> block, only something our own fence can do"* → `armJail` got built, 17 test cases, working
> correctly.
>
> Afternoon, same user: *"agentco should just always allow every repo the customer's GitHub already
> allows — that's the smoothest way (very deterministic, not a case-handling problem) ⇒ drop the
> whole agentco-allow-repo screen entirely?"*

**Removed.** Recorded in full because it's a decision that's easy to reverse using the exact
reasoning that produced it in the first place.

#### Two arguments the user raised — neither HOLDS UP, and this has to be stated plainly

| Argument | Why it doesn't hold |
|---|---|
| *"if the scope changes on GitHub's side, we can't update the hash for that"* | The semantics are an **intersection**: `reach = inner ∩ outer`. GitHub narrows ⇒ reach narrows immediately on the very next call, no hash change needed and **none should ever happen**. This works correctly, it's not a hole |
| *"agentco allows it but git doesn't — that's a very loud dead-end case"* | This case exists **identically** whether the fence is there or not — both paths lead to the exact same GitHub 404. The fence doesn't **create** it, it just can't block it |

#### The REAL argument for removing it — the user never stated it, and it's stronger than either of the above

1. **The restriction sits inside the hash ⇒ changing it means a different arm ⇒ re-plug it and
   rewire the diagram edge.** For a value the user will want to tweak frequently.
2. **It has to be typed by hand.** We **can't enumerate** installed repos — no MCP tool answers
   that question.
3. **A narrower option already exists, held by the right party, updates instantly**: the *"Only
   select repositories"* button on GitHub's own installation screen.
   → [[agentco-count-mechanisms]] · [[agentco-domain-vs-boundary]]

#### 🔴 What's LOST, recorded so it can be weighed again next time

**Per-arm narrowing disappears.** An app installation is account-level, so two offices sharing one
GitHub account **share the same reach**: a staff agent cleaning up code in office A and a release
bot in office B can both reach the exact same set of repos. The one remaining fallback is §5h·7l
③ — *two separate accounts*.

The day a real customer actually needs per-staff-agent narrowing, **this is the section to read
before rebuilding it**, and the three costs above still stand.

#### Two mandatory COMPENSATIONS — without them, removing the fence is a pure loss

| | Item | Status |
|---|---|---|
| ① | **404 translation** — §5h·7f | ✅ built 08/27 |
| ② | **Audit log records the repo** — "what did it just touch" must be answerable afterward | ✅ already exists: `audit.ts` records the raw `args`, including `owner`/`repo` |

#### 📌 The GitHub entry's hash — the user worked this out themselves, and the conclusion is CORRECT

> *"the github hash seems to only depend on which github account it is — what the account is
> actually allowed to do isn't something we control anyway"*

**Correct, and it's the right outcome, not a leftover gap.** The hash is a fingerprint of what
**agentco configures**, not of what the arm **can actually reach**. Reach is the vendor's asset,
changes outside our control, and folding it into the hash would be **promising something we can't
keep**. The hash still does the two jobs it was built to do: block duplicates, and stop one office
from silently swapping another office's arm — for everything agentco actually holds.

The remaining asymmetry (a scope change on the vendor's side changes it for every office at once)
**isn't new**: it's the same shape as **a key's own value**, already settled on 08/25 — the only
real door sits **outside** agentco.

⇒ **A GitHub arm = (account + toolset + tier).** Full stop.

### 5h·7o. 🎯 THE APP INSTALLATION CAN BE QUERIED — measured 08/27, and it overturns two of our own assumptions

> The user: *"go check it directly — can you see which repos the user's GitHub is actually
> allowing?"* — **yes, it can be done**, but not by any means anyone would have guessed, and the
> path being taken before this was wrong.

**The underlying facts, measured (control: the app installed on exactly `test` +
`ai-note-knowledge`):**

| Call | public repo, **not installed** | public repo, **installed** | private repo, **installed** |
|---|---|---|---|
| `list_branches` | ✅ | ✅ | ✅ |
| `get_file_contents` | ✅ | ✅ | ✅ |
| `list_repository_collaborators` | ❌ | ✅ | ✅ |

🔴 **The `ghu_` key is NOT restricted by the installation for PUBLIC repos.** `list_branches`
worked on **all 16 repos** even though the app was only installed on 2. The installation only
gates **private repos** — and (not yet measured) **writes**.

⇒ Two consequences, both overturning something written on this very same day:

1. **Testing reach with `get_file_contents` is meaningless for a public repo** — it succeeds
   regardless of whether the app is installed. §5h·7n was built on a false premise.
2. **The card's claim *"can only touch repos you install agentco into"* is only true for PRIVATE
   repos.** Has to be corrected.

**A way to actually query this exists, and it's a READ-ONLY tool:** `list_repository_collaborators`
requires **push** permission, which only exists on repos the app is installed on. Cleanly
distinguished 4/4 in measurement.

```
get_me → login
search_repositories "user:<login>"  → candidate list
list_repository_collaborators on each → ✅ = INSTALLED
```

⚠ **Two limitations that must be stated, not hidden:**

- **Only sees repos owned by `login` themselves.** `user:<login>` doesn't list an
  **organization's** repos. ⇒ an empty list **doesn't prove** "nothing installed at all" — it only
  proves "no personal repos installed". So there has to be an explicit escape hatch, see below.
  *(A possible future extension: `get_teams` in the `context` slice might expose organization
  names ⇒ additionally search `org:<name>`. Not yet measured.)*
- The inference is **"has push permission" ⇒ "is installed"**. Correct for OUR app because every
  installation gets the same permission set, which the app itself declares. The day we change the
  app's permissions, **re-measure this**.

### 5h·7n. ⛔ THE MANUALLY-TYPED REACH TEST — dropped, never shipped (08/27)

> Lived for a few hours. Kept here because its wrong premise is worth remembering, not the code.

The original idea was right to notice that `probeArm`'s ✓ checkmark **doesn't prove reach**
(`tools/list` succeeds even when the app isn't installed on any repo at all) — that's still true.
It was wrong about **which test was chosen**: `get_file_contents` on a public repo succeeds ✓
regardless of the installation, so it answers a different question than the one being asked. And
it forced the user to **type by hand** something they shouldn't have had to type.

⇒ Replaced by §5h·7o: an **automatic** lookup, 0 characters typed by the user.
→ [[agentco-measurement-vs-conclusion]]: *measurable ≠ conclusive.*

`probeArm` calls `tools/list`, and **`tools/list` succeeds even when the app isn't installed on any
repo at all**. So the screen would confidently report `✓ 16 operations` while every call was about
to return 404. That checkmark proves **sign-in worked**, not **that anything is actually reachable**.
→ [[agentco-measurement-vs-conclusion]]

The only thing that proves the installation actually took effect is **going through the exact same
door real work will go through**: reading a file in a real repo. `catalog.ts §reachTest` declares
that tool (`get_file_contents`, **not** `get_me` — `get_me` succeeds even with a key installed on
zero repos).

⚠ **It is NOT a fence**, and that's exactly the distinction: type it in, click Test, **throw it
away**. Never saved to `company.yaml`, never part of the hash, constrains the arm in no way at all.
`save()` filters it out before sending. This field looks identical to the just-removed restriction
field, so the help text **must** say *"not saved"* — the user has no way to tell them apart
otherwise.

⚠ `ok: false` does **not** invalidate the whole test. Sign-in still works, the arm can still be
plugged in; what isn't finished is the app installation, a step done on the vendor's own screen.
Merging those two questions into one answer field would rebuild the exact wrong-door error class
this very test was built to close.

#### Wizard order (user's decision, 08/27)

```
sign in → [same screen] GitHub-side scope + an install button → a repo field to test with
        → Test → permission tier → toolset (only at the full-access tier)
```

Installing the app **has to happen before** any step that depends on a repo — and since we can't
read the installation state, the only thing we can keep in sync is **the order of operations**:
install first, then test.

⚠ **We never show "is it installed yet" and never pick a default on the user's behalf.** The user
asked directly: *"if someone skips the install step and just continues, does it DEFAULT to All
repositories?"* — **no, and we have no way to know.** Never installed at all ⇒ **zero permissions**,
not "all of them". Drawing a state there would be making it up.

### 5h·7i. The finalized shape of the catalog entry

```ts
{
  id: 'github',
  price: 'login',
  auth: { kind: 'device', clientId: 'Iv23li95pd8QpYfTGMho' },   // ← PUBLIC data
  identity: { url: '…/mcp/x/context', tool: 'get_me',           // ← §5h·7k
              idField: 'id', labelField: 'login' },
  spec: {
    kind: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: {
      Authorization: 'Bearer ${OAUTH}',
      'X-MCP-Toolsets': '${TOOLSETS}',      // ← the user's checkboxes, ONE arm
      // the "read-only" tier adds 'X-MCP-Readonly': 'true' — measured as a real fence (§5h·7j)
    },
  },
  groups: ['context', 'repos', 'pull_requests', 'issues', 'actions'],  // 5 checkboxes
}
```

⚠ **A wrong `X-MCP-Toolsets` group name ⇒ the server returns 0 operations, WITH NO ERROR** (measured
08/26, from us mistyping it ourselves via PowerShell). A silent drop, exactly the
[[agentco-silent-allowlist]] family ⇒ **the number of groups requested must be checked against the
number actually received**, and flagged, the same mechanism already built as `warnDroppedTools` for
`tools`.

Three things stay **unchanged, not a single line**, compared to Notion: `discover` · `applyToken` ·
`refreshAccount` · `accountName` · `injectSecrets` · `armHash` · `role.secrets` · `probeArm` · the
three tiers · the audit log. Exactly two things are **new**: `deviceStart`/`devicePoll` (reading
`device_authorization_endpoint` from the metadata, **0 vendor names**) and **a toolset-selection
step** on the interface.

---

## 5m. 🔴 A MISSING KEY GETS REPORTED AS A WRONG KEY — the user caught this 08/25 with one question

> *"a wrong key on first-time setup → 401, matches the test intent. But a MISSING key (left blank
> on first-time setup) reports the exact same message? Where am I misunderstanding this?"*

**Nowhere — we're the ones reporting it wrong.** Three completely different causes land on exactly
one message:

| Case | What actually goes to the server | Server returns | Message we show |
|---|---|---|---|
| ① genuinely wrong key | `Bearer ntn_xxx` | 401 | ✅ correct |
| ② field left blank | `Bearer ${NOTION_ACCESS_TOKEN}` | 401 | ❌ **wrong door** |
| ③ "reused" in a different office (§6i-bis) | `Bearer ${NOTION_ACCESS_TOKEN}` | 401 | ❌ **wrong door** |

For ② and ③ we **know before sending** — and send it anyway, letting Notion answer a question it
**doesn't have enough information** to answer: a 401 can only ever say *"this key is wrong"*; the
server has no way of knowing that **no key was ever entered in the first place**.

`injectSecrets` already did half the job correctly — leaving the field blank and calling
`emitWarning`. But that warning goes out to **the daemon's stderr**, while the user is looking at
the screen. And then we **still send** the header carrying the literal `${…}`.

> **An error message that is ONLY WRONG-DOOR costs more than no message at all.** The user goes off
> to check the account, check permissions, check the workspace, try a different token — **every
> spot except the actual broken one**. A message saying "unclear" at least leaves them free to ask;
> a confident, wrong message actively leads them astray.

### The patch — three pieces, and the second is the one easiest to forget

**① `missingSecretRefs(config)`** — scans for leftover blank slots across **the entire config's JSON
string**, not just `headers`. A function that only looks at `headers` would be correct right up
until the exact day someone writes `url: 'https://${HOST}/mcp'`, and by then nobody remembers this
decision.

**② An empty string means MISSING, in EVERY function.** A blank field sends up `''`. The old
`grantFor` treated `''` as a valid key ⇒ `Bearer ` flew up to the server ⇒ 401 ⇒ the exact same
wrong-door message, through a different path. Fixing one function without fixing the other leaves
two spots in the same flow believing two different things.

**③ The check lives inside `probeArm`, NOT inside the HTTP route.** `probeArm` is the shared door
for the "Try now" button, for `readOnlyTools` when Done is clicked, and for every measurement.
Placing it at the route level would patch one door and leave the other three doors with the old
behavior.

⇒ With a field still blank, **stop immediately — no connection opened, no 20-second wait**:

```
Missing key: NOTION_ACCESS_TOKEN. No request has been sent — with an unfilled key, the
server can only respond "wrong key", and that message would send you looking in the
wrong place.
```

### A natural consequence: the "self-plug" path can now **accept a key**

Before this, path B had no key field at all, so any HTTP server needing a token was a **dead end**:
paste it, test it, 401, no further path. Now the field is **generated straight from the `${…}` in
the block they just pasted** — no need to know the vendor in advance, no new catalog entry added.
Same reasoning as §5h·1: *the catalog is data, not code*.

Test: `test/missing-key.test.ts` (+9). Code: `secrets.ts §missingSecretRefs` · `probe.ts`.

---

## 5n. 🔴 THE REFRESH LOOP KILLED THREE CREDENTIALS BY TRIPPING OVER ITSELF (measured 09/03, patched 09/04)

Three accounts across **three different services** were marked dead within **4 seconds** — Notion
`invalid_grant`, GitHub twice `incorrect_client_credentials`. The obvious reading (*"the tokens
expired"*) is **wrong**, and the arithmetic is what says so:

| | |
|---|---|
| Notion credential expires | 03/09 06:19:25Z |
| Marked dead | 03/09 04:06:40Z — **2h13m before** it expired |
| GitHub refresh token remaining | **180.76 of its 181 days** |

Nothing expired. All three were **refused**. And `incorrect_client_credentials` is not about
`client_id` — §5h·7d already recorded that it is GitHub's own phrase for *"that refresh token has
been rotated away"*. So the state behind all of it is one sentence: **we were holding the previous
version of a credential the service had already killed.**

### Cause: "one place in the code" was never the same as "one sweep at a time"

`setInterval(tick, 15 min)` had **no re-entrancy guard**, and the token endpoint has **no timeout**
(deliberately — see below). A sweep that stalls mid-request (a socket suspended across a laptop
sleep) is still in flight when the next tick starts a second one. Both read the same
`refresh_token`, both send it, the service rotates for whichever arrives first ⇒ the other is told
its credential is dead.

⚠ The comment at `server.ts` **described this exact hazard** and then concluded *"no lock fixes this
— only 'exactly one place does it' fixes it."* Half right, and the wrong half is the expensive one:
one place in **space** guarantees nothing about **time**.

### The patch — three pieces, and the second is the one that turns a stumble into a loss

| | |
|---|---|
| `oneSweepAtATime` | Drops an overlapping tick, **never queues it** — a queued sweep is the same collision 15 minutes later. Skipping costs nothing: credentials refresh at 50% of their life, so ~16 chances remain |
| `deadMarkStillApplies` | **Re-read the store before recording a refusal.** If it moved on, someone else rotated successfully and this is just the losing half of a race — the account is FINE. The old line `saveOAuth(…, {…acc, dead})` did two harms at once: it killed a live account (`needsRefresh` then returns `false` **forever**) *and* wrote the stale credential back over the freshly rotated one |
| `logRefresh` → `logs/oauth-refresh.jsonl` | One line per attempt (`ok` · `dead` · `refused-but-superseded` · `transient`). It exists because reconstructing 09/03 had to be done by subtracting `expires_at` from timestamps: **not one attempt had ever been recorded.** The loop only ever spoke when it gave up. NAMES only, never a credential value |

`test/oauth-refresh-race.test.ts` (+7) caught a real defect on its first run: the first version used
`.finally`, which **re-throws** ⇒ a rejected sweep became an unhandled rejection inside a timer
callback, and Node's default for that is to kill the process. A background credential sweep is the
last thing that should be able to take the whole company down. → `.then(release, release)`.

### ⛔ A timeout on the OAuth fetches — proposed, then WITHDRAWN

It reads like an obvious safety measure and it is **double-edged**: aborting at 20s while the
service has *already processed the request and rotated the credential* **manufactures** the very
state that killed these three — we hold the old token, the new one is gone. Without the timeout we
wait and receive it.

Reopen only with evidence from `oauth-refresh.jsonl` of a genuinely hung sweep, and then with a
**wide** ceiling (≥120s), never a tight one.

### ⚠ What is still open, so nobody reads this as closed

**The guard is per PROCESS.** Two daemons pointed at one `company/` folder — two installs, or a
folder inside OneDrive/Dropbox — still collide exactly as before, and no in-memory flag can see
that. Closing it needs a **lease on disk**. Not built: no real case yet.

**And no patch can undo a lost rotation.** Once the service has rotated and the response is lost in
transit, the new credential is gone and the old one is dead — a re-login is genuinely required.
These three pieces make that window **rare**, stop a single stumble from escalating into a lost
credential, and make the product say the right thing when it happens. They do **not** promise
"never sign in again".

### The recovery door has to sit where the failure is REPORTED

The store knew these credentials were dead on 03/09. On 04/09 the connection screen still said
*"nothing to fill in again"* and invited the user to press Try it, which answered with the SDK's raw
English 401. Two surfaces, neither of which offered a way back:

| Where it was reported | Door |
|---|---|
| Overview → Accounts: *"the key is dead — sign in again"* | ❌ only a **Delete** button, and it is **disabled** while any arm holds the credential |
| The reuse panel in the Connect dialog | ❌ said *"press Try it to be sure it is still alive"* |
| The workspace list inside `+ Connect` | ✅ the only place with a Sign in button |

⇒ `arms[].keyDead` now travels with the arm (same lookup as `via` — one more derived field, not a
second mechanism). The reuse row shows it in red *before* the click, and the panel **replaces**
*"nothing to fill in again"* — a sentence that becomes **false** the moment the credential dies —
with the reason plus a **Sign in again** button. The button starts no second sign-in flow: it hands
over to the catalogue path, which already owns every state involved. A hand-pasted arm has no
`catalog` ⇒ **no button**, because `oauthStart` needs a `catalogId` and promising a door that does
not exist is the wrong-door error at its worst.

### 🔴 …and the first version of that door led to a button that does not exist (user caught it same day)

The **Sign in again** button switched to the catalogue screen — where the dead account's row said
*"⚠ Expired — press **Sign in** to reconnect"* while the only button on the screen read **"Sign in
another account"** (the label flips as soon as `accounts.length > 0`). So the copy sent the user
hunting for a control that was never there, and the one they could find promised a **duplicate
account** instead of a repair. The same failure class this section is about, reintroduced by the fix
for it.

Three corrections, and the third is the one that makes the flow one click instead of two:

1. **The button sits on the dead ROW**, beside the bin, and **only** when that row is dead — a
   control that does nothing 99% of the time teaches people to stop reading the row.
2. **The red line names no button any more.** It states the fact (*"the service refused this
   sign-in"*); the button is close enough that the sentence does not have to give directions to it.
3. **The reuse panel's button starts the sign-in in the same click** rather than only navigating.
   The user had already said what they wanted; landing them in front of a list to say it a second
   time is the friction, not the sign-in. This is why `login()` now takes its catalogue entry as an
   argument: inside that handler `setPick` has not landed yet, so reading `pick` from the closure
   would find `null` and the button would silently do nothing.

Signing in again as the same user resolves to the same identity seed ⇒ the same account **name** ⇒
the record is overwritten and `dead` goes with it, so **every arm holding that credential recovers
at once**. There is no per-arm repair to build — `accountName` is what makes that true. → §5h·7k

⚠ **How many clicks it can ever be, per vendor** — this is a property of the vendor, not of our UI:
Notion and Linear use the web redirect flow ⇒ genuinely **one click** plus approving on their page.
GitHub cannot: §5h·7a records that its web flow **requires a `client_secret`** and agentco is a
public client, so the device flow is the only path and RFC 8628 requires approval on a second
surface. `DeviceCode` already prefers `verification_uri_complete` over `verification_uri`, so when a
vendor embeds the code in the link there is nothing to type — whether GitHub actually sends that
field is **not yet measured**, and the next sign-in answers it.

### 🔴 "I meant to repair A but authorised B" — the user asked, and the web flow got it wrong

> *"what if I press sign in for one account but actually authorise a different one — does it light
> up that one and still leave the un-signed-in one selected?"*

**Yes, on the web flow, exactly that.** After a sign-in the dialog picked the account **whose name
was not in its list before**. That diff is right for *"add another account"* and silently wrong for
a repair: re-authorising an account that ALREADY EXISTS adds no new name ⇒ nothing is selected ⇒ the
selection stays on the row the user pressed the button for, **which is still dead**, while a
different row's warning quietly clears. The device-code path never had the hole — its poll result
names the saved account.

⇒ The SSE event now carries `account` = **the name actually saved**, and both paths select that.
The diff stays only as a fallback for an event without the field. → `ArmDialog §loadAccounts`

⇒ And the mismatch itself is **said out loud**. The store is correct either way; the user's belief
is not. `reconnecting` records which row the Sign-in-again was pressed on — intent the store cannot
reconstruct, since from its side both outcomes are just *"an account was saved"* — and if the saved
account differs, the screen says so and names both.

⛔ **The sign-in is NOT started automatically** when arriving from the reuse panel (tried, then
withdrawn on the user's call, 09/04). Opening a vendor's authorisation window on someone's behalf
takes away the choice they may want to make on that very screen: signing in as a **different**
account. The row carries its own button; that is close enough.

Test: `test/arm-reach.test.ts` (+3) · `test/oauth-refresh-race.test.ts` (+7).
→ [[agentco-scope-of-door-vs-data]] · [[agentco-wrong-door-errors]] · [[agentco-count-mechanisms]]
→ [[agentco-deterministic-vs-signal]] — a name from the server is a fact; a list diff is an inference.

---

## 6. Plugging in through the UI — today there are **three** "open a yaml file" steps, and that's an alarm bell

### 6a. Counting the bells

Project rule (`SESSIONS_MEMORY` §5n ①): *a "open a yaml file" step in this product's own
walkthrough is **always** an alarm bell.* Lesson 10 leg B currently has:

| Step | What it tells the user to do | The missing feature |
|---|---|---|
| B3 ⌨ | run `node dist/cli/index.js secret set …` in PowerShell | **a key-entry screen** |
| B4 📝 | open `company/company.yaml` and type `mcpServers:` | **an "add an arm" screen** |
| B6 📝 | open `roles/<id>.yaml` and type `mcp:` + `secrets:` | **drag a wire on the diagram ⇒ grants the key** |
| B7 ⌨ | `stop` / `start` | 📖 `setMcpServers()` — **no restart needed** |

**Four bells in a single walkthrough.** This is §6's to-do list, not a complaint.

### 6b. Four screens, each answering exactly one question

| Screen | Which user question it answers | Data source |
|---|---|---|
| **Add an arm** | *"how does a staff agent reach Notion?"* | catalog / paste a config / connector |
| **Key field** | *"where do I get this token from?"* | the catalog entry's `secrets`, or a config scan |
| **Try now** | *"did I fill this in correctly?"* | 📖 `setMcpServers()` → `errors` + `mcpServerStatus()` |
| **Delete / disconnect button** | *"I don't want to use this anymore"* | 📖 `setMcpServers()` → `removed` |

**Dragging a wire on the diagram = granting permission to use it.** ✅ The `mcp → agent` edge already
writes into `roles/<id>.yaml` (`layout.ts:197`) — the mechanism already exists. What's still missing
is **`secrets:` following that wired edge**, instead of forcing the user to declare it separately:
matches `SPEC-tools-approval` §7a's decision exactly (*"wiring it up is enough, the key follows"*),
and it eliminates step B6.

### 6c. The **Try now** button for MCP — different from a connector in one important way

`SPEC-tools-approval` §10b already decided: *no Save allowed until Try has succeeded at least
once*. For MCP, "success" has **five** levels, not two (📖 `McpServerStatus.status`):

```
✓ connected · 8 operations                → Save allowed
⚠ needs-auth                              → shows a "Sign in" button (§6d), Save NOT yet allowed
⏳ pending                                 → still waiting, don't draw a conclusion
✗ failed · "spawn npx ENOENT"             → Save not allowed + points at the actual failure spot
○ disabled                                → the user turned it off themselves
```

> ⚠ **`failed` must show the `error` string VERBATIM.** It's the one string the user can actually
> copy elsewhere to ask for help. Same reason `planProblemsMessage` never hides its error list
> (`SESSIONS_MEMORY` §5n ㉗).

### 6d. OAuth for non-coders — 📖 `onElicitation` is a path that already exists

```ts
type ElicitationRequest = {
  serverName: string;
  message: string;
  mode?: 'form' | 'url';     // 'url' = authenticate via the browser
  url?: string;
  elicitationId?: string;
  requestedSchema?: Record<string, unknown>;   // 'form'
  title?: string; displayName?: string; description?: string;
};
```

Meaning: the MCP server **asks on its own** for the user to open a URL to sign in, and the SDK
hands that request **straight to us**. We display it inside the chat flow — **same spot, same
shape as the §8b approval gate**:

```
⏸ Google wants you to sign in once
   [Open sign-in page]   [Skip]
```

**Three constraints, and the third is a lesson already paid for:**

1. 📖 **Fail-closed.** The `.d.ts` says: return `null` by mistake and **no response is ever sent
   at all**, and the elicitation hangs until the server itself times out. It must always return an
   explicit result, even when the user dismisses it.
2. ✅ **"Open the page" opens ON THE HOST MACHINE.** Matches the 📂 button case exactly
   (`SESSIONS_MEMORY` §5n ㉑): reuse `isLoopback(req.socket.remoteAddress)`; if it's not the same
   machine, **copy the URL to the clipboard** with an explanation, instead of silently opening a
   window in Singapore.
3. **Elicitation is a time-boxed conversation happening in the middle of a running task.** ❓ Not
   yet known how it interacts with `abortController` and with cost caps. Has to be measured — §12.

---

## 6e. Node or not a node — answered, then three doors in

> **The user's question:** *"if MCP can be plugged in right from the UI, should it be a node or
> something else?"*
>
> **Answer: a NODE, and it's ALREADY a node.** ✅ `layout.ts` generates an `mcp:<server>` node for
> every key in `company.mcpServers`; `CAN_CONNECT` allows `mcp → agent | assistant`; the edge is
> saved into `roles/<id>.yaml`; `Inspector.tsx:538` already has a render branch. **What's missing
> was never the node itself — it's THE PATH THAT CREATES it.**

The node is the right call because all five questions in §1a say "yes", but there's **one** reason
stronger than all five:

> **The wired edge IS the act of granting permission.** Dragging a wire from `🔌 Notion` down to
> `Report writer` **is exactly** writing `mcp: [notion]` into `roles/nguoi-viet.yaml`. No
> description of "who has permission for what" is more compact than a visible wire. Drop the node
> and a checkbox list has to be invented somewhere else — worse on every axis, and **leaves the
> spot the user is actually looking at**.

### Three entry doors — pick two, drop one

| | Door | Gains | Loses |
|---|---|---|---|
| **A** ⭐ | A **`+ Connect`** button next to `+ Staff member` on the canvas's floating toolbar | same grammar as the one thing the user already knows how to use · cheap · **the catalog appears right on the first screen** | no "drag-and-drop" |
| **B** ❌ | A palette drawer on the rail, **dragged and dropped** onto the canvas | literally matches *"pull it out and use it right away"* | three losses, see below |
| **C** ⭐ | From **a single staff agent's** detail panel: `Arms: none yet [+ Plug in]` | **arrives exactly when the user thinks of the need** · plugging it in wires it up automatically | has to keep two doors synced into one dialog |

**Why B gets DROPPED, even though it sounds the most modern:**

1. **Drag-and-drop sells the value of "choosing where to place it", and placement here doesn't
   belong to the user.** ✅ The canvas already auto-arranges (`firstFreeSlot` · `centeredSlot`) and
   has a **Rearrange diagram** button. The user drops a node somewhere, clicks rearrange, and it
   jumps away — drag-and-drop **promises a control that the very next button takes back**.
2. **The real cost never sits in the selection step.** From *"I want Notion"* to *"a staff agent
   can use Notion"*, the selection step costs **1 second**; filling in the key + testing + deciding
   who gets it costs **everything else**. Drag-and-drop optimizes exactly the step that costs
   nothing, then drops the user in front of **the exact same form** anyway.
3. **It breaks the rail's grammar.** ✅ All six existing panels are **storage/lists**
   (`Sidebar.tsx` §TABS — *"WHERE DO FILES GET PLACED"*). A palette is an entirely different
   concept, and shoving it in there teaches the user that the rail has no consistent rule at all.

⇒ **Decision: A is the main door, C is the secondary door, both open THE SAME dialog.** *"Pull it
out and use it right away"* gets satisfied by **catalog cards displayed right on the first
screen**, not by a drag gesture.

⚠ **Button name: `Connect`, not `MCP`, and not `Arm` either.** `SPEC-connectors` §6 already chose
the word *"Connect"* back on 08/14, and non-coders correctly guess its meaning on their own.
*"Arm"* is a word for the **spec**, not a word for the **product** — keep it in the docs, never
put it on the screen.

## 6f. A three-step dialog — and step 3 is mandatory

```
STEP 1 · Choose                        STEP 2 · Key & Test       STEP 3 · Grant to whom
┌───────────────────────────────┐     ┌────────────────────┐    ┌──────────────────┐
│  Plug in a connection          │     │ 📝 Notion          │    │ Who can use it?  │
│                               │     │                    │    │                  │
│ ┌──────┐ ┌──────┐ ┌──────┐   │     │ Token  [········]  │    │ ☑ Report writer  │
│ │  📁  │ │  📝  │ │  🗂  │   │ ──► │  ↳ get it at: Notion│──► │ ☐ Reviewer       │
│ │ Files│ │Notion│ │Google│   │     │    → Settings →     │    │ ☐ Accountant     │
│ │ on the│ │      │ │      │   │     │    Connections     │    │                  │
│ │machine│ │1 key │ │ sign │   │     │                    │    │ Pick no one and  │
│ │0 keys │ │      │ │  in  │   │     │ [ Try now ]        │    │ this connection  │
│ └──────┘ └──────┘ └──────┘   │     │ ✓ 200 · 15 ops      │    │ just sits idle   │
│                               │     │                    │    │ at no cost       │
│ ── plugged in at another office ─ │ │        [ Save ] ←── │    │      [ Done ]    │
│ 🔌 shopify   (reuse)          │     │    locked until ✓   │    │                  │
│                               │     └────────────────────┘    └──────────────────┘
│ ── or ──                      │
│ ⚙ Plug in manually — paste an MCP config │
└───────────────────────────────┘
```

**Step 1 — three things on one screen, and the order has a reason:**

| Block | Content | Why it's there |
|---|---|---|
| Catalog cards | the 3 §4e entries | *"pull it out and use it right away"*. **The card's subtext states THE PRICE** (`no keys` / `1 key` / `sign in`) — the user can choose based on effort, not on a name they may not recognize |
| **Plugged in at another office** | 🔌 name · `reuse` | ✅ `mcpServers` is **company-level** (`types.ts:386`). The key's already declared ⇒ reusing it costs **0 steps**. Without this block, the user re-declares the Notion key a second time and wonders why |
| Plug in manually | paste JSON | path **B** from §4c — nobody is ever blocked |

**Step 2 — an existing rule, applied unchanged:** *no **Save** allowed until **Try** has succeeded
at least once* (`SPEC-tools-approval` §10b). For MCP, "success" has **five** levels (§6c) —
`needs-auth` **is not an error**, it's *"go ahead and click the sign-in button"*.

**Step 3 — mandatory, not optional. This is the spot easiest to skip.**

> **A node with no wire is a DEAD node.** It shows up on the diagram, looks finished, and **nobody
> can use it**. A non-coder won't guess that there's still a wire left to drag — they just clicked
> "Save" and saw a checkmark.

> This is exactly the error class *"the system lies about its own state"* (`SESSIONS_MEMORY` §5i·1).
> So step 3 **asks directly**, and the text under the field states the consequence of picking no
> one — **along with its upside** (`costs nothing`), so someone who wants to plug it in and wire it
> up later still has a path forward without feeling like they did something wrong.

## 6g. What a node shows — a live state, not a static label

Today `NodeShape.tsx:97` hardcodes `'external tool'` / `'not declared in company.yaml'`. With 📖
`mcpServerStatus()` it can tell the truth:

```
┌────────────────────────┐   ● active · 15 operations · 2 users
│ 🔌 Notion              │   ⚠ needs sign-in             ← clicking reopens step 2
│    ● 15 ops · 2 users  │   ✗ couldn't connect          ← clicking shows the raw `error`
└────────────────────────┘   ⏳ connecting…
                             ○ disabled
```

⚠ **Three constraints, all three lessons already paid for:**

1. **`✗` must expand to show the `error` string VERBATIM.** It's the one string the user can
   actually copy elsewhere to ask for help (same reason `planProblemsMessage` never hides its
   error list).
2. **A state that's fine on a node becomes something that has to be STABILIZED once it reaches the
   ASSISTANT'S ROSTER** — a flickering node is just pixels; a flickering roster is **a cacheKey
   bump every single time**. → §7c.
3. **Changing `NodeShape` must not drag the entire tree's render along with it.** ✅ There's already
   a correct precedent for this: `LibraryBody` was split out **specifically to** preserve that
   constraint (`NodeShape.tsx:9`). An MCP node has live state ⇒ **an identical `McpBody` split is
   required**, never subscribe to the store directly inside `NodeShape`.

### 🆕 An MCP node only shows in offices that are ACTUALLY USING it — **a behavior change, not yet built**

✅ Today `layout.ts:125` builds a node for **every** key in `company.mcpServers`, in **every**
office. This matched the intent *"plug it in once, every office sees it"* (`types.ts:386`) — but
that intent was written back when plugging in one MCP cost 9 steps and nobody had more than one.

**The catalog makes plugging in cheap ⇒ that premise no longer holds.** Plugging in 6 connections
means 6 unfamiliar nodes sitting inside the Accounting office's diagram, no wires, no purpose.

| | Decision |
|---|---|
| **Canvas** | only shows a node with **at least one wire in this office**, plus any node just plugged in during this session |
| **Shared pool** | still company-level — shown in the **"plugged in at another office"** block of step 1 |
| **Removing the last wire** | the node leaves the canvas, **the connection and its key both remain** — like *"letting a staff member go"*, not like *"deleting"* |

> **This is the spot where the company/office boundary finally becomes visible to the eye:** *what
> has been plugged in* belongs to the company, *who may use it* belongs to the office. The current
> build mixes both into one flat plane and forces the user to mentally separate them.

⚠ An accompanying constraint: `layout.ts` has an **orphan node** branch (`missing`) that keeps and
red-flags a node whose file has vanished. The new rule **must not swallow that branch** —
*"no longer declared in `company.yaml`"* and *"this office isn't using it"* are **two entirely
different situations**, and merging them is exactly the `catch { exists = false }` mistake
([[agentco-catch-hides-premises]]).

### 6g-bis. 🔴 THE LABEL FOLLOWS THE ACCOUNT — the "is this still auto-generated" check is only correct once (bug 08/27, fixed)

> *"Why does the MCP server node still say GitHub · octocat even though I switched the workspace
> account to hubot?"* … *"you can already pull the workspace name — did the checkbox for renaming
> just not update, or is it locked?"*

**The mechanism of the bug** — `ArmDialog` concatenates `<vendor> · <account>` into the label, with
a check *"only overwrite when the label still exactly matches the catalog entry's name"* so it
doesn't clobber a name the user typed themselves. The check's **intent is correct**; the comparison
**expires right after its first use**: once written, the label is `GitHub · octocat` ≠ `GitHub`, so
every subsequent account switch gets misclassified into the *"the user renamed it themselves"*
branch. The label freezes at the **first** account while the config points at the new one.

The diagram is where it hurts most: an MCP node only renders `label`, so **the one place a user
reads an arm's name is also the one place stating something wrong**, with nothing next to it to
cross-check.

⇒ **Remember the string we ourselves last wrote (`autoLabel`), don't re-derive it.** Still matches
⇒ auto-generated, overwrite. Different ⇒ the user's own name, leave it alone. The check still does
its job — it just stopped expiring.

> 🔴 **The error class to recognize next time:** *"is this thing still at its default state?"*
> answered by **comparing against the default value** is only correct up until the first write.
> Correct forever requires **remembering what you last wrote**. Same family as `armHash` — identity
> is something we *store*, not something we *re-derive by guessing*.

⚠ **And the label must not be the only thing to rely on.** Nodes truncate names to 14 characters
(`GitHub · minhv…`), so the subtitle line was changed from the word `connection` (which just
repeats what the plug icon already says) to **`via`** — the account name, looked up by the server
from `arms[].secrets` **on every read**, so it can never go stale even after the user has set their
own custom name.

⚠ `describeNode` used to **deliberately** avoid looking up `via`, with the reasoning written in the
code being *"the default label already includes the workspace"* — meaning it **relied on a label
that was already broken**. The concern that motivated that (reading disk on every render) is still
respected: `canvas()` reads the store **lazily, once** — an office with no OAuth arm never touches
disk at all.

⚠ Still **account only, no permission tier** in the label. → §6j

### 6g-quater. 🔴 THE SERVER'S OWN FENCE SWALLOWS THE TIER SELECTOR — the default tier locks itself out (bug 08/27)

> *"Still no way to get to this? How do I test it?"* — the user couldn't reach the full-access
> tier, and **there was no error message at all**, because every layer was doing its own job
> correctly:

```
default tier `read`  →  header X-MCP-Readonly: true   (§5h·7j — a REAL fence, protocol layer)
                     →  GitHub returns only READ operations
                     →  offeredTiers() sees all three tiers as EQUAL
                     →  the rule "only show a tier that adds ≥1 operation" (§6j) collapses to ONE tier
                     →  the tier selector never renders
                     →  stuck at `read` forever
```

**Measurements (08/27, a real key, `X-MCP-Toolsets: context,repos`):**

| Discovery test | Operations visible | Tiers offered |
|---|---|---|
| **with** the fence (old behavior) | 16 | **1** → `read:16` ⇒ nothing to click |
| **without** the fence (after the patch) | **22** | **2** → `read:16` · `full:22` |

⇒ **Rule: DISCOVERY must not carry the fence; ENFORCEMENT must.** The "Try now" button is asking
*"what's the **maximum** this arm can do"*. Mixing an enforcement mechanism into a discovery
question lets the answer silently truncate itself — and then we read the truncated version as if
it were the whole truth.

⚠ **Not a loosening of permission, not even slightly.** `level` still gets logged, the SAVED config
still gets built **with** the fence, and `scopedTools` at save time still re-queries the server at
the correct tier. The only thing that changes is the configuration **used for looking**. →
`server.ts §armConfig(discovery)` · `catalog.ts §serverFenced`

> 🔴 **THE FIRST PATCH FOR THIS SECTION CHANGED NOTHING AT ALL, and the tests still passed.**
> Recording this because this error class is cheap to make and expensive in wasted time:
>
> ```js
> armConfig({ ...body, ...(discovery ? {} : { level }) })   // ❌ deletes nothing
> ```
>
> `...body` **already carried `body.level` from the client**, so the conditional spread only ever
> *overwrites*, never *deletes*. The fence stayed up; the user reported back the exact same thing:
> *"still doesn't work, did you actually change anything?"*
>
> And the test written in that same pass **passed**, because it checked `buildConfig` — a lower
> layer that was never wrong in the first place. ⇒ **Check at the layer carrying the flag, with the
> exact data shape the real route sends.** A test at a lower layer can't stand in for a test at the
> layer where the bug actually is; it just makes the scoreboard look covered.
> ⇒ And the flag must live **right next to where the tier is actually used** (`armConfig`), not at
> the call site — so the call site has no way left to get it wrong. [[agentco-count-mechanisms]]

⚠ **A cost that has to be stated:** the token number is now measured at the *fully open* state ⇒
it's **a ceiling**, a lower tier costs less. An entry that gets cut on the server side is flagged
`serverFence`, and the interface states that plainly under the tier selector. It skews toward
**overwarning** — the less harmful direction, per §11a-bis.

> 🔴 **The error class to recognize next time:** a safety mechanism (a fence) running **before** a
> discovery mechanism (counting tiers) means the second mechanism only ever measures the shadow the
> first one casts. `offeredTiers` **isn't wrong** — it honestly reports what it was shown, and what
> it was shown had already been cut before it ever arrived.
> [[agentco-measurement-vs-conclusion]] · [[agentco-count-mechanisms]]
>
> Bell: `test/repo-scan.test.ts` locks both halves in — a discovery config must **not** carry
> `X-MCP-Readonly`, and a list made entirely of read operations **must** collapse to exactly one
> tier.

### 4e-bis. ONE VENDOR = ONE FILE — `src/core/arms/` (user's decision, 08/28)

> *"I'm doing a fair amount of custom work per provider to match each one. Can this get
> reorganized? … so future changes are easier to make. And share whatever interface can actually be
> shared."*

| Where | What |
|---|---|
| `core/arms/files.ts` · `notion.ts` · `github.ts` | **one vendor's data** — no functions, no branches |
| `core/arms/index.ts` | exactly one array, and **the order the user sees them in** |
| `core/catalog.ts` | types · `buildConfig` · `armHash` · `findArm` — **the single shared door** |
| `web/components/arm/*` | UI blocks that only appear when an entry **declares** the matching field |
| `web/components/ArmIcon.tsx` | one drawing function, used in **5** places, **0 vendor names** |

⚠ **Imports flow in one direction only.** `arms/*` uses `import type` from `catalog.ts` (the type
is erased at compile time ⇒ no runtime cycle); `catalog.ts` imports back exactly one thing: the
already-merged array. Reversing the direction would create a module cycle — something that only
ever blows up at runtime, in a file that looks completely unrelated.

⚠ **The 08/25 rule stands exactly as it was, and this is where it's easy to misread.** That day's
question (*"instead of having to write many files like notion.ts, github.ts…"*) was about **how
the data gets USED** — still one `CatalogArm`, one `buildConfig`, 0 branches keyed by vendor name.
What got split out on 08/28 is **where the data lives**. Proof, not a promise:
`catalog-data.test.ts` §*"every entry serializes correctly"* still passes after the split.

🔴 **`brand.mark` — the logo moves into the brand record, and that's the whole reason.** §11c
decided *"haven't read the vendor's rules yet ⇒ don't use their logo"*, enforced by the
`brand.checkedOn` field. On 08/27 GitHub/Notion logos were shipped inside
`web/components/ArmIcon.tsx` **while `checkedOn` was still `null`** — two files, nobody
cross-checked them, and a silent rule turned into a broken promise. Now the SVG path sits **right
next to `checkedOn`**, so anyone auditing branding sees it immediately. **The debt is still open**:
GitHub's rules (github.com/logos) and Notion's still have to be read, then `guidelineUrl` +
`checkedOn` filled in, **before this ships externally**.

⚠ `mark` is written as **one contiguous string**, never concatenated with `+`. Swallowing a space
at a join point (`3 .405` → `3.405`) is **a distortion, not an error** — nothing raises an alarm.
(Almost stepped on this exact bug the day of the split.)

### 6g-ter. An arm's icon — one function, every tier (user's decision, 08/27)

> *"A card should also have a distinguishing icon up front … apply that consistently down into the
> tiers inside it too"* · *"folder and gear should stay plain, no color. Try to keep the provider's
> icon plain too, no color"*

`web/src/components/ArmIcon.tsx` — **vendor first, type second**: if there's a vendor logo, draw
the logo; otherwise fall back to a shape by type (folder · plug · gear). Everything in
`currentColor`, no color of its own.

Why one function instead of scattering emoji at each drawing site: the dialog draws the same arm in
**four** places (a type card · the service grid · the reuse list · step 2's heading). Four copies of
the same mapping are four places to drift apart, and drifting loses exactly what the icon exists to
preserve — **recognizing it as the same thing** across different screens. The logo table is allowed
to be **incomplete**: adding a new service to the catalog is never blocked just because nobody has
drawn a logo for it yet.

The old emoji (📁 🔌 ⚙️ 📝) were dropped because they carry the OS font's own coloring: the same
card renders in three different colors on three different machines, and none of them adapt to a
light/dark background. [[agentco-three-os-always]]

**Sort order for the "plugged in at another office" list**: `orphans → TYPE (service → directory →
manual plug-in) → name`. ⚠ Sorted **at render time**, not at load time: `catalog` and `arms` come
back from two parallel calls, so sorting right after `api.arms()` resolves would sort against a
still-empty catalog ⇒ `kindOf` returns `custom` for everything, and it would
**never re-sort itself afterward**.

## 6i. ✅ A SHARED REGISTRY + HASH — identity split apart from name (user's decision, 08/23, built)

**The root cause behind four different symptoms: `id` was carrying two jobs at once** — both
identity and display name. Removing then recreating the same folder wasn't detected · the
"plugged in elsewhere" list bloated into a pile of near-duplicates · the same config under a
different name became two separate things · renaming meant **changing the key**, which meant
rewriting `mcp:` inside every office's `roles/*.yaml`.

```yaml
mcpServers:                    # the SDK's half — not a single field added
  a2bebbdc121: { command: npx, args: [-y, "…filesystem@…", "D:\\Records"] }
arms:                          # agentco's own half
  a2bebbdc121: { label: "Company Records", catalog: files, secrets: [] }
```

| Layer | What it is | Who decides |
|---|---|---|
| **Shared registry** (company-level) | hash(config + key name) → config · label · key name | machine-generated, immutable |
| **Presence** (office-level) | `role.mcp: [hash]` | the user, per office |

⇒ **Cloning stays as-is**, matching what the user already decided earlier — but cloning happens at
the *presence* layer, not at the *config-copy* layer. What used to bloat was that second thing.

### Three consequences, and the third one eliminates an entire concept

**① Duplication becomes something that CANNOT HAPPEN**, not something that has to be remembered
and checked in four places. Same config ⇒ same key. This is *forbidden by structure, not by
discipline* — the exact same rule already applied to keys.

**② Renaming becomes the cheapest operation in the system**: edit one string in the registry. No
key change, no migration, no one's cache breaks ⇒ **deliberately no warning message at all**.
Slapping a warning on a harmless action teaches the user to dismiss warnings, and then they dismiss
exactly the one worth reading.

**③ 🔴 "ARCHIVE" IS DROPPED ENTIRELY for arms.** Staff agents need two levels because they carry
something **that can't be rebuilt** — skills, a pitch, an experience log. An arm **only carries a
config**, and the registry never deletes it. So "delete" already has archiving's essential
property built in: ✅ measured — deleting an arm and re-plugging the exact same folder gives back
**the same id, and the name it was given comes right back on its own**.

> Borrowing a concept from where it earns its keep to a place where it doesn't — that's the thing
> that just got removed. It also erases the question *"where's the MCP recovery screen"* instead
> of having to go answer it.

⚠ What's lost: **the wire**. Re-plugging means re-wiring. For an arm serving 1–2 people, that's one
drag — far cheaper than maintaining an entire concept just to save that one drag.

### ⚠⚠ THE HASH DOES NOT REPLACE PATH VALIDATION — BOTH must be kept

A question the user raised themselves, and it lands exactly right:

| | What it asks | Scope |
|---|---|---|
| **hash** | *is this exact config already known* | **company-wide** — for reuse |
| **path** | *has this office already reached that folder* | **office-level** — the one-path-per-office rule |

The case that proves the second can't be dropped: **the day we bump a package version in the
catalog**, the same folder produces a **different hash** ⇒ a second arm pointing at the exact same
place can be created ⇒ the one-path rule **breaks silently**. The hash can't catch it, because to
the hash these genuinely are two different configs.

### 🔴 And it also patches a hole that had been open since the start: nobody was writing `role.secrets`

`pickMcp` builds the env from `role.secrets`, but until 08/23 **nothing in the plug-in flow ever
wrote that field**. ⇒ plugging in an arm that needs a key put the token correctly into
`.state/secrets.json`, `role.mcp` correctly too, but **the spawned MCP process got no environment
variables at all**.

Worse: `probeArm` also never injected the key ⇒ **the "Try now" button was testing something
different from what would actually run** — the exact error class this project keeps catching
over and over.

The registry is the answer to *"what keys does this arm need"*, so `grantArm` now folds that list
into `role.secrets`, and `probeArm` receives the same set. **One source, two consumers — no more
drifting apart.** ⚠ The HTTP branch (`headers`) still isn't wired — §5a, still open.

### ✅ 08/24 — the arm panel shows a FOLDER, and it's READ-ONLY for the same reason as the hash

Clicking a 🔌 node ⇒ the panel should show the folder it can reach. Before this, the only way to
read that was to **open `company.yaml`** — and an "open a yaml file" step is an alarm bell (§6,
decided 08/22).

**Read-only, and this is a statement about IDENTITY, not about permission:** the label is editable
because a label isn't identity; the folder sits **inside** the config, and identity `=
armHash(config)`. "Edit the folder" isn't an edit at all — it's **a different arm**. Allowing an
in-place edit would rebuild the exact **silent overwrite** case §6i was built to prevent: the node
stays the same, every wire stays the same, only the folder underneath silently changes. The correct
path is `+ Connect` a new one and unplug the old one.

**Three operating systems: no adaptation at all, and that's deliberate.** `folderRoots` doesn't
sniff `process.platform` — it accepts both `D:\…` and `/home/…` on every platform, because an
office zipped over from a different OS still has to read the exact string that's recorded in
`company.yaml` (same reason `SHELL_ALIASES` ships both tool names). Displayed **verbatim**, slashes
never normalized: this string exists for the user to visually cross-check against Explorer/Finder,
so it has to be exactly what they typed. Empty ⇒ **draw nothing** — Notion/GitHub have no folder,
and an empty field would falsely imply the config is missing something.

Code: `CanvasNode.folders` (`office.ts`) · `ArmFolders` (`web/src/components/Inspector.tsx`).

### ✅ 08/25 — the user settled the general case as well: **NO EDITING AN ARM. It's either there, or it's deleted.**

> *"I also think editing an MCP shouldn't be allowed — either it's there, or it's deleted. That's
> the healthiest lifecycle management. Editing the key would deform it in a way that really messes
> things up, and it affects our clone-hash algorithm."*

Correct, and it's **broader** than the 08/24 statement above: 08/24 only talked about the *folder*
field; this statement is about **every field that feeds the hash** — folder, URL, headers, and
**the key's name**. All four share the same reasoning: editing them isn't an edit, it's *a
different arm*. Allowing an in-place edit means identity stays fixed while the thing it identifies
has changed — exactly the **silent overwrite** case §6i was built to prevent.

| Field | Editable? | Why |
|---|---|---|
| `label` | ✅ | nothing references it, not part of the hash |
| folder · `url` · `headers` | ❌ | part of the hash ⇒ editing = a different arm |
| **key name** | ❌ | part of the hash — §armHash, the "two Notion workspaces" case |
| **key value** | ❌ *(from the interface)* | see right below |

**The key's value is the subtlest case, and it lands on the same side.** The value is NOT part of
the hash, so in principle it could be edited without changing identity. But editing it from the arm
panel opens a second door writing into `.state/secrets.json`, while the key is a **shared,
company-level** asset — editing from one office silently changes the arm for every other office
sharing it. The one remaining door stays: `agentco secret set <NAME>`, where the "whole company"
scope is obvious from the command itself.

⇒ An arm's lifecycle has exactly **two** verbs: **plug in** and **unplug**. There is no "edit".

## 6i-bis. 🔴 "REUSE AT ANOTHER OFFICE" WAS BROKEN FROM THE START — a bug the user caught 08/25

The symptom the user reported, verbatim:

> *"I already connected Notion at the Arms office. But when I moved over to the test and picked
> clone on that exact same MCP at the Personal Assistant office, it said `Couldn't connect —
> HTTP 401`. In theory, with a refresh token, shouldn't every office be able to share it?"*

**Right question, and the answer is YES** — the key sits in `.state/secrets.json` at the
**company** level, a single copy. The break was in the button, not the design.

### Cause: the "reuse" button **doesn't** reuse anything — it PASTES THE CONFIG into the "manual plug-in" path

```ts
setPick(null);                                    // ← throws away the catalog entry
setPaste(JSON.stringify(a.config, null, 2));      // ← goes down path B
```

But the registry's config keeps **a blank slot**, `${NOTION_ACCESS_TOKEN}` (correct by design,
§5a — a key's value never sits inside `company.yaml`). The "manual plug-in" path has no idea which
catalog entry this is ⇒ shows no key field at all ⇒ sends no key at all ⇒ the header that flies up
to Notion literally reads `Bearer ${…}` ⇒ 401.

**Why it went unnoticed until now:** the only arm that had ever existed was `filesystem` — stdio,
and it **needs no key at all**. A blank slot only exists in the `headers` branch. This hole was
born the same day the first HTTP entry appeared, and only surfaced the second time anyone clicked
the button.

### 🔴 And there's a second half, with NO visible symptom at all

`secretNames` at that point was `[]`. And **the key's name is part of the hash** (§armHash) ⇒
**a different hash** ⇒ it creates a **second** arm with the same config instead of reusing the
existing one. *"Reuse"* that actually **duplicates** — exactly what §6i was built to make
impossible, routed around through a back door. This half happens **even for a stdio arm needing no
key at all**, meaning it had already been wrong before this and nobody had noticed.

### The patch: identity travels AS A WHOLE PACKAGE, or not at all

The client sends **`armId`** — exactly one hash string. The server (`company.ts §reuseArm`) pulls
everything from the registry: config · key name · **key value** · granted operations (`tools`) ·
label. No piece ever detours through HTTP and back.

⇒ same config + same key name ⇒ **same hash** ⇒ `addArm` recognizes the existing entry ⇒
`grantArm` only adds *presence* at the new office. Exactly the meaning of "clone at the presence
layer" §6i already settled on, this time with enforcing code.

⚠ `tools` is also pulled from the registry, **never re-probed**. Re-probing would let two offices
end up holding two different lists for **the same arm** — the vendor adds one write operation
today, an office that plugs in today gets more than one that plugged in yesterday, and nobody
notices because both look "correct at time of plugging in".

Test: `test/missing-key.test.ts` — the last two cases guard exactly the "lost key name ⇒ different
hash" scenario.

## 6j. ✅ THREE PERMISSION TIERS — replacing a per-call approval gate (user's decision, 08/25)

Context: the user rejected `SPEC-tools-approval` §8c's tier 2, and rightly so — see §6k. What
replaces it is **scope granted at plug-in time**, not a runtime dialog.

### Why THREE tiers, not four READ/INSERT/UPDATE/DELETE buttons

The user originally proposed 4 buttons. Measuring both SDKs' `.d.ts`: what MCP actually declares is
**four standard booleans**, and they **cannot** distinguish UPDATE from DELETE.

```ts
// @modelcontextprotocol/sdk — ToolAnnotationsSchema (a STANDARD, not a per-vendor convention)
{ title?, readOnlyHint?, destructiveHint?, idempotentHint?, openWorldHint? }
// @anthropic-ai/claude-agent-sdk normalizes it down to three:
{ readOnly?, destructive?, openWorld? }
```

| Tier | Inferred from — **the declaration must be COMPLETE and NOT CONTRADICTORY** | Notion (28 tools) |
|---|---|---|
| **Read-only** | `readOnly === true` **and** `destructive !== true` | 14 |
| **Read + Add** | `readOnly === false` **and** `destructive === false` | +11 |
| **Full access** | every other case — including **incomplete declarations** and **contradictory ones** | +3 |

> ✅ **ACTUALLY MEASURED 08/26** (`scripts/spike-notion-annotations.ts`, asking Notion directly via
> JSON-RPC): exactly **14 · 11 · 3**, and 28/28 tools declare **both** fields. The table above is no
> longer a guess.

### 🔴🔴 BUT: **THE SDK DROPS EVERY ANNOTATION WHOSE VALUE IS `false`** — and it wipes out the middle tier entirely

The user caught this 08/26: *"why did you say Notion has 3 levels when creating one only shows
2?"*. Measured at both ends:

| | `notion-create-pages` |
|---|---|
| Notion **declares** (raw JSON-RPC) | `{readOnlyHint: false, destructiveHint: false}` |
| **What the SDK hands us** | `{}` |
| `tierOf({})` | `full` — **correct by the rule**, and impossible to know otherwise |

Through the SDK: **14 read · 0 add · 14 full** ⇒ the interface only shows two tiers. 11 tools that
were **create-only** get lumped in with edit/delete.

> ⭐ **The truth table is correct. `tierOf` is correct. The output is still wrong.** The bug lives
> in a **third thing** nobody inspected: **the data pipeline**. `test/level-one-way.test.ts` sweeps
> all 27 combinations, all pass, all correctly — it tests the function, not what actually gets fed
> into the function.

⚠ And because the one-way rule breaks in the **SAFE** direction (escalation), it's **completely
silent**: no error, no warning, just one lost tier. What's lost is **least privilege** — a user
wanting *"let the agent create pages, don't let it edit existing ones"* (something Notion supports
precisely) is forced to grant both. Meaning the data layer is **actively pushing users toward
over-granting**.

**The patch does NOT touch `tierOf`** — it goes and recovers the raw data instead: `core/mcp-http.ts`
queries the server's own `tools/list` directly for HTTP arms, gets the raw `annotations`, and only
then classifies. Re-measured through `probeArm`: **14 · 25 · 28**, all three tiers present.

- **Used ONLY for CLASSIFICATION.** Calling the tool, session lifecycle, permissions — all still
  the SDK's job. One read, at plug-in time.
- **On failure, falls back to the SDK** ⇒ matches pre-08/26 behavior exactly: worse but **never
  wrong** (escalation = safe).
- **HTTP only.** stdio has to spawn a process and speak MCP over a pipe — rebuilding an entire
  second client. Not worth it: `filesystem` is the only stdio arm, and it has no tiers.
- **0 SDK imports** — same rule as `core/oauth.ts`, the fallback path stays intact.

Test: `test/mcp-http.test.ts` (+7) freezes **both** annotation shapes as measurements, so the day
someone "cleans up" `mcp-http.ts`, that test turns red immediately.

### 🔴 ONE DIRECTION ONLY: NOT KNOWING ⇒ ESCALATE. NEVER DOWNGRADE. (user's decision, 08/25)

> *"make sure that if we know nothing, it lands at the higher tier — don't let a case where
> something's declared read-only turn out to allow adding/deleting/editing, that would be a
> disaster. Bottom line: **it must never lie**. When we don't know, saying it's full access isn't a
> lie — the same holds true for tier 2."*

Two consequences, and the second was **a live hole in the code**, patched 08/25:

**① Tier 2 requires BOTH declarations to be explicit** — *"I'm not read-only"* **and** *"I'm not
destructive"*. Missing either half means **unknown** ⇒ tier 3. This is the easiest spot to get
wrong: `destructive: false` on its own looks like a promise, but per the MCP spec,
`destructiveHint` **only means anything when `readOnlyHint` is false** — without that other half,
it doesn't tell us what we need to know.

**② 🔴 A CONTRADICTORY declaration must ESCALATE** — `{ readOnly: true, destructive: true }`.

The old `levelOf` only checked `readOnly === true` ⇒ classified it as **`read`**, meaning a tool
that **explicitly declares itself as destructive** would still be granted under a *"read-only"*
label. No server needs to lie — it just has to declare **carelessly**, and a contradictory pair of
fields is exactly the clearest sign of careless declaration.

⚠ And this isn't hypothetical: `arms[hash].tools` for a "read-only" arm is generated by that exact
function, and flows **directly into `allowedTools`** at runtime. Getting the tier wrong here
doesn't produce a bug — it produces a staff agent that can write to a real workspace, under a label
saying it can't.

Test: `test/level-one-way.test.ts` sweeps the **entire** space of `{readOnly, destructive,
openWorld} × {true, false, undefined}` and locks in the whole 3-tier truth table **before** the
interface was built — a decision without an enforcing lock is a decision that gets silently
re-derived wrong on the exact day nobody remembers why tier 2 needs two fields.

Building 4 buttons means the last two are **guesses wearing the costume of facts**: we'd have to
guess which tool names mean delete ⇒ tool names would end up back inside our own source code (the
exact thing just cleaned out 08/25), and guessing wrong **in the dangerous direction** —
`notion-update-page` sounds like an edit, but it can actually wipe content clean. For Notion, the
DELETE slot would even stay **permanently empty**: it archives, it never deletes.

**Cumulative, not independent checkboxes.** *"INSERT without READ"* means nothing for any MCP;
presenting an untickable box is presenting a fake question.

### ✅ Answering "do different servers' declarations share the same keys" (user asked 08/25)

**Shared — it's a SCHEMA, not a convention.** `ToolAnnotationsSchema` lives inside MCP's own
standard SDK, and every server speaks the same four field names. What differs between servers
**isn't the key names**, it's **whether they're filled in or not**. So `levelOf` never has to know
which vendor it's dealing with — and that's exactly what lets the whole catalog keep the rule
*"data, not code"*.

### 🔴 The genuinely more worrying real case: **a server that DECLARES NOTHING AT ALL** (user asked 08/25)

> *"a server lying isn't the important part — what I'm actually worried about is a server that says
> NOTHING AT ALL"*

Correct — and that case is far more common than lying. Declaring nothing ⇒ `levelOf` defaults to
`write_external` ⇒ **all 28 operations fall into Full access** ⇒ the first two tiers show
**"0 operations"**.

That's the **correct** direction (safe when unknown), but it's a **bad experience wearing
security's clothes**: a user who just wants to read their own data finds their only working choice
is the scariest one — meaning we're **teaching them to always click Full access**, the exact habit
we're trying to avoid.

**Three paths, and the first two have to be ruled out outright:**

| | | |
|---|---|---|
| ❌ Full access or don't use it | pure default-deny | teaches the user to click the most dangerous option, every single time |
| ❌ Infer from the tool's NAME (`list_*`, `get_*`) | guessing | correct for `filesystem`, **mute** for every other server, and wrong in the dangerous direction (`get_and_archive`). Exactly the *"hand-written translation table"* already rejected for `describeCall` |
| ✅ **Ask the user directly, per operation** | honest | we don't know ⇒ ask whoever does |

⇒ **The three tiers are a SHORTCUT over a checklist, not a separate mechanism.**

- server declares things ⇒ the checklist comes **pre-ticked** by tier, one click and done
- server declares partially ⇒ state the number plainly: *"22/28 operations declared · 6
  undeclared, classified as Full access"*
- server declares nothing ⇒ the first two tiers **gray out with a reason**, leaving only manual
  ticking

The exact same `tools: string[]` goes down to disk in all three cases — **no new mechanism added**.
And the friction lands exactly where it belongs: a server following the standard costs one click,
a server ignoring the standard costs 28 checkboxes. The user immediately sees which vendor plays
it straight, and we never have to say a single word about any specific vendor.

### 🔴 RULE: a tier only exists if it **ADDS** operations beyond the tier below it

The user's decision, 08/25: *"if a tier has 0 operations, don't offer it as a choice — don't let
something meaningless or purely noisy with no benefit exist."*

Correct, but *"0 operations"* **isn't a tight enough condition**, and the case that slips through
the net is an easy one to hit: a server that's **entirely read tools** (a documentation lookup MCP,
say) produces

```
◉ Read-only      14 operations
○ Read + Add     14 operations   ← adds nothing
○ Full access    14 operations   ← adds nothing
```

The two lower tiers **aren't empty**, so the "0 operations" rule lets them through — even though
they **promise additional permission while adding nothing**, exactly the noise the user just
banned, just wearing a nonzero number as a disguise. So the rule has to be:

> **A tier only shows up if it adds ≥1 operation over the tier right below it.** The bottom tier
> shows if it has ≥1 operation.

⚠ **And once only ONE tier is left, its DIRECTION decides what to do** — two completely opposite
cases:

| The one remaining tier | Meaning | Handling |
|---|---|---|
| **Read-only** | the server is entirely read tools | **drop the selector entirely**, state it in one line: *"This connection is read-only · 14 operations"*. A single choice isn't a question |
| **Full access** | the server **declares nothing at all** | 🔴 must **NOT** silently fall into this. That's not a choice, it's **a warning** ⇒ go straight to the manual checklist |

Merging these two cases into one is the single most expensive bug in this whole section: the same
symptom, *"only one tier left"*, where one side is harmless and the other is **granting the entire
server**. And `tools: []` actually means granting the entire server — the exact opposite direction.
`readOnlyTools` has been throwing on exactly that case since 08/25; the interface just needs to
stop presenting it as a clickable button.

⇒ When built, the check has to be **`count(tier) > count(tier below)`**, not `count(tier) > 0`.

### Attribute statements to the party that actually made them — cheaper than any disclaimer

| | Who enforces it | Depends on the server being honest? |
|---|---|---|
| **WHICH tool can be called** | the client — `allowedTools` / `McpServerToolPolicy` | ❌ **no** — deterministic |
| **WHAT each tool actually does** | the server's own `annotations` | ✅ yes — and **no client can change that** |

> ❌ *"This arm is read-only"* — a statement we **cannot** guarantee
> ✅ *"Notion declares 14 read-only operations"* — a statement **true even if Notion is lying**

One line of text, and it moves the question of "who's responsible" to exactly the right place
without a single sentence of legal boilerplate. A disclaimer **cannot fix** an interface that says
something wrong; attributing the statement to its source can.

### The permission tier belongs in the HASH — and that's a requirement, not an inconvenience

Today `tools` is **not** part of `armHash`; that's safe because it's derived deterministically from
`readOnly`, a catalog constant. Letting the user choose a tier means two arms with **the same URL,
the same key, a different tier** would collide on the hash ⇒ **a silent overwrite** ⇒ the exact
case §6i was built to prevent. ⇒ `arms[hash].level` must be part of the hash.

**Garbage has a CEILING, it doesn't pile up** (the user worked this out themselves, and correctly):
A→B→A lands back on the **exact same old hash**, and that old hash is already in the registry ⇒
`addArm` reuses it. At most **3** entries for one (config + key) pair — exactly matching the number
of tiers. The old tier becomes orphaned ⇒ sinks to the bottom of the list on its own ⇒ handled by
the §6i-bis trash mechanism. The loop closes itself, no new mechanism needed.

### 🔴 "Changing the permission tier" — ONLY AT THIS OFFICE (the user emphasized this, 08/25)

> *"Changing the tier at this office must not change it at another office — that's important."*

**The hash already gives that property for free, and this is the strongest reason the tier belongs
in the hash** — stronger even than the collision-prevention reason above. Changing the tier =
**a different arm** ⇒ another office's `role.mcp` and `office.arms` still point at the old hash ⇒
**untouched, with no code needed to guard against it at all**.

If the tier were an in-place editable field in the shared registry, the opposite would happen: one
click at office A would **silently escalate** permission for every office sharing that arm. That's
the single most expensive failure case in this whole section, and it's ruled out by **structure**,
not by discipline.

The flow, and its order is the security:

1. plug in the arm at the new tier + **rewire the exact same old wires** at this office
2. **only then** unplug the old arm — `removeArm(id, officeId)`, already scoped to this office
3. failure at step 1 ⇒ **the old one is untouched**

The button reads **"Change permission tier…"**, never *Edit* — because it **isn't** an edit
(§6i-bis: the lifecycle has two verbs). No separate Save button: still **Try now → Done**, same as
any plug-in flow, because it *is* one. The confirmation dialog has to state all three parts: the
wires get rewired · **no other office is affected** · the key never has to be re-entered.

### Labels: a badge that's DERIVED, never stuffed into the name string

The user asked, *"doesn't adding the permission to the name feel a bit off?"* — **yes, it does**.
The label belongs to the user, free to edit (§6i). Stuffing `· read-only` into the string means a
single rename could produce **"Notion (writable)" on an arm that's actually read-only** — the
label lying about a permission, exactly the "empty promise" bug just removed at lesson 11 step 5.

Also **no new `sub` field**: the tier already lives at `arms[hash].level`, the badge is derivable
⇒ 0 new fields and **impossible to drift**. The default name at creation is still *"Notion
(read-only)"* for readability — but that's just a **starting suggestion**, while the badge is the
thing that actually tells the truth. Two layers: the outer one editable, the inner one not.

## 6k. ✅ TIER 2 OF THE APPROVAL GATE IS DROPPED — user's decision, 08/25, and the reasoning holds

> *"long term, the real answer is no approval gate at all — accept that it's a game of uncertainty,
> and each MCP plugged in is itself the sandbox. At most, just an MCP log."*

Four reasons, two from the user, two more added:

**① A gate that trains people to click Yes is worse than no gate at all.** 15 dialogs for one plan
⇒ auto-accept ⇒ it **manufactures consent**: the system looks supervised while actually just
shifting responsibility onto the user.

**② It contradicts the product's own premise.** agentco is *"hand off the work and walk away"*.
`SPEC-tools-approval` §8d already wrote this: a 10-minute timeout ⇒ **deny** ⇒ every plan that runs
while the user isn't sitting there **dies on its very first write**. The gate isn't broken — it's
working exactly as designed, and the design is wrong for this.

**③ The wire on the canvas ALREADY IS the gate** (the user's own decision, 08/24: *"the wired edge
IS the act of granting permission"*). A per-call approval is asking that exact same question a
second time, under worse conditions.

**④ No customers yet.** `irreversible` = *sending something · deleting · paying · publishing
publicly*. Notion has no tool like that (archive, not delete); neither does `filesystem`. Today
**0 tools in the catalog are irreversible** ⇒ building tier 2 right now would be building a gate
nobody walks through.

**KEEP tier 1** (plan approval): one decision · before anything starts · **0 tokens** · and it isn't
a security gate at all, it's the **"Preview the plan"** button `SPEC-ui` §2.1 has demanded from the
start — the answer to *"control the scope"*, the product's original pain point. Every objection the
user raised targeted tier 2, none targeted this one.

### 🔴 But "just a log" demands a log we DON'T HAVE YET

The user asked, *"is the MCP log different from the plan log we already have?"* — **yes, and worse
in the direction that matters**. Measured `worker.ts`:

- only records **`calls[0]`** per turn ⇒ a turn calling 3 tools **loses 2 of them**
- records a **human-readable** sentence (`Notion · create page → …`), **without the parameters**

⇒ that's a **PROGRESS log**, not an **AUDIT log**. If the long-term direction is "no gate, just a
log", the log has to be upgraded: **every** call, **with** parameters, written to disk. This is a
much smaller job than the approval gate, and it's the only thing that can answer *"what did it
write into my Notion yesterday"*.

### ✅ BUILT 08/26 — `core/audit.ts`, and a real case proved it necessary

**The triggering case:** a turn hit `max_turns` midway through. The log showed it **had already
called** `notion-update-page` (a WRITE call) before being cut off, but the final report said
*"couldn't delete yet"*. For a file inside the office, that statement would be harmless; for the
**user's actual Notion**, it's **wrong about the outside world** — and there was no way to look
back at what it had actually written.

| | |
|---|---|
| Where it's recorded | `worker.ts`'s `tool_use` loop — **every** call, not just `calls[0]` |
| Why not in `canUseTool` | that gate **never fires** for a tool already inside `allowedTools` (measured 08/26), and an arm's tools are always inside it |
| Where it's stored | `.state/mcp-audit.jsonl`, **per office** — same rule as `chat.jsonl` |
| What it keeps | `ts · server · tool · role · plan_id · task_id · **args**` |
| Cap | 2,000 chars/parameter · 2,000 lines, trimmed **after each session** (trimming every line would be O(n²)) |

⚠ **`args` is the entire reason this exists.** Without the parameters, a log line only says *"called
update_page"* — exactly what we already had, and already knew wasn't enough.

⚠ **Must never throw.** `append` runs in the middle of an active session; throwing there would trade
a small loss (one log line) for a large one (the whole session, plus money already spent). And
**a corrupted line only discards that one line** — a daemon dying mid-write leaves a truncated
line, and discarding the whole file would wipe out the history of every call BEFORE it, exactly
when those calls matter most. Both have tests.

### 🎯 Where it lives in the interface — the user asked directly, 08/26

> *"where should this go so the UX feels natural? … maybe it's a kind of 'advanced' thing since
> non-coders wouldn't understand it anyway. The real question is which object on the UI it should
> belong to."*

**A single node 🔌's detail panel**, a collapsible block titled *"What has this connection done?"*.
Three reasons:

1. **The three drawers on the left are all the user's OWN CONTENT** (Results · Document cabinet ·
   Knowledge store). A log isn't content — adding a fourth drawer would force **everyone** to learn
   yet another concept, including people who will never open it.
2. **The object that owns the risk is the arm itself.** That panel already says *"what it CAN do"*
   (the permission-tier badge, operation count); the log says *"what it HAS done"*. Two halves of
   the same question ⇒ they belong side by side.
3. **It self-tiers the audience** without needing any "advanced mode" toggle: you have to click into
   a 🔌 node to even see it, and anyone who clicks into a 🔌 node has already crossed that
   threshold.

Defaults **collapsed**, only loaded on open. Each line is **who · what · when**; parameters hide
behind one more click — they're the most expensive thing **and** the longest, and showing them all
up front turns 20 calls into a wall of JSON that people stop reading, losing exactly the lines that
were worth reading.

## 6h. Recounting the number of steps — the measuring stick for all of §6

| | Today (lesson 10 leg B) | After §6 |
|---|---|---|
| **Notion** | — | **3 clicks + 1 paste** |
| **Files on the machine** | — | **3 clicks + choosing a folder**, no keys at all |
| **Google** | 9 steps · 3 files · 1 restart · 1 Google Cloud project | 3 clicks + 1 sign-in *(if spike 5 passes)* |
| Number of yaml files that need opening | **3** | **0** |
| Number of restarts | **1** | **0** |

**"Files on the machine" is the entry that proves the whole claim**: it goes from clicking to
running **with no key field at all**. If a non-coder can't finish that entry in 30 seconds, §6's
design is wrong, and knowing that **before** building the other two entries is the cheapest way to
find out.

## 6k. THE MANAGEMENT DOOR MUST SIT AT THE SAME LEVEL AS THE DATA *(bug reported by the user, 09/02)*

**Symptom:** after deleting every office, `Acme Team's Notion` can no longer be removed — then
Linear, then GitHub, the same dead end.

**A three-layer deadlock, each lock sitting behind the exact door it's blocking:**

```
workspace  ←blocked by─  arm  ←blocked by─  office
oauthForget()          forgetArm()           entry point: the canvas Toolbar
"still in use by 1      "still in use by N     0 offices ⇒ 0 canvas
 connection"             office(s)"            ⇒ 0 Toolbar ⇒ 0 door
```

Both blocking checks are **correct** and stay as-is — they exist to prevent leaving behind a
silently dead arm (`company.ts §forgetArm` · `oauth-routes.ts §oauthForget`). What's wrong is that
**the door leading to the next step sits inside the very thing that just got deleted**.

**The root cause, and it's bigger than this one case:** three things live at the COMPANY level,
while all three of their management doors sit INSIDE an office.

| Data | On disk | The old door (lost when 0 offices remain) |
|---|---|---|
| Cost ledger | `logs/usage.jsonl` | Overview → inside the Sidebar |
| Connections | `company.yaml` → `mcpServers` + `arms` | **+ Connect** → on the Toolbar |
| Workspace OAuth | `.state/secrets.json` → `$oauth` | **+ Connect**, step 2 |

### ❌ The path NOT taken: "deleting an office cleans up its connections too"

1. Breaks the exact sharing property built in §6i: deleting office A would sever office B's wire.
2. **One gesture, two meanings** — the same delete button does two different things depending on
   how many offices *happen* to remain.
3. Throws away exactly the expensive part. A cost-ledger line **is about** a now-dead office ⇒
   dying with it is correct (`SPEC-offices §3b`). An arm is only **referenced by** an office ⇒ it
   has meaning independent of any particular office.

> **The rule that separates the two cases:** delete what something *is about*; keep what it merely
> *borrows*.

### ✅ The path taken: fix the DOOR, not the OWNERSHIP

- A **"Connections" + "Linked accounts"** panel inside Overview: every arm shown with its `via` ·
  operation count · permission tier · who's using it, plus a 🗑 for orphaned entries; every
  workspace shown with a 🗑 (grayed out while still used by a connection, its tooltip **naming**
  that connection).
- **The Sidebar collapses down to exactly the Overview panel when there are 0 offices**
  (`Sidebar §noOffices`), instead of the whole workspace area being replaced by an empty screen.
- `ArmDialog` keeps its role as **plugging in something new**. Viewing-and-cleaning up is a
  different intent, and it must never depend on whether an office exists.
- Deleting an office that leaves an arm orphaned ⇒ **state it + point the way**, never block. Adding
  a condition to the delete button would block a valid action because of an asset that isn't even
  owned by it — and it still wouldn't rescue the case *"5 offices, none of them holding Notion"*.

⚠ **The settled destination:** deleting an office ⇒ the workspace **still remains**, but is **always
deletable**. Revoking an OAuth grant is an action on the user's own account at a different service;
keeping it by mistake costs one click to fix, deleting it by mistake means signing in again from
scratch on the vendor's own page.

**Locked in by:** `test/arm-reach.test.ts` — 0 offices ⇒ `orphan === true` (the flag the interface
relies on to show the 🗑) · `forgetArm` runs correctly · **the key vault untouched, byte for byte**.
The UI part has no automated test; it lives in the lesson 12 walkthrough, variant 6.

---

## 7. The Assistant must know **CAPABILITIES**, not just **NAMES**

### 7a. The open question from 08/22, answered here

> `SESSIONS_MEMORY` §4: *"The roster currently lists MCP by **NAME** (`notion`), not by
> **CAPABILITY**. The Assistant reads 'can reach Notion', not 'can write files'. When §6 gets built,
> a decision is needed: generate the capability line from the real tool list MCP declares at
> handshake, or force the user to type it by hand?"*

**Decision: read it from the handshake.** 📖 `mcpServerStatus().tools[]` is the source. Forcing the
user to type it by hand would spawn **a second declaration**, i.e. case ⑱ (`pitch` vs `tools`)
repeating one layer lower.

> **An existing rule, applied directly:** *whatever the Assistant uses to **CHOOSE A PERSON** must
> be a fact read from config/handshake, never a sentence the user typed.* Same family as
> `landingOf` (derived from the tool actually called) and `agentFault` (decided from
> `Receipt.failure`).

### 7b. But **NOT** a raw list of tool names — and this is the easiest spot to blow the token budget

A Notion MCP declares ~15 tools. Listing tool names into the roster = **15 lines × per MCP × per
staff agent**, sitting inside the Assistant's cached prefix, returned on **every single keystroke**
(`route()` resumes continuously).

**Decision: collapse it into a short cluster, generated by CODE from `annotations` + the server
name.**

```
- nguoi-don (Document tidier): Finds, reads and updates documents… [Google: read·write · shell: OFF]
- nguoi-viet (Writer): Writes Vietnamese-language content…          [Notion: read · web · shell: ON]
```

`read` / `write` / `can delete` are derived from `annotations.readOnly` / `destructive`. ❓ **The
real cost hasn't been measured yet** — estimated at ~4–8 tokens/MCP/role, but wrong estimates have
already happened twice in this project (the 2,688-token case and the 4-staff-agent breakeven
threshold). **Measure before locking in the format.**

### 7c. ⚠ Two traps already paid for once, don't step in them again

**Trap 1 — absence is not a signal** (case ㉔, [[agentco-deterministic-vs-signal]]). If the format
only ever states the positive case, then an office where **nobody** has Notion means the string
`Notion` simply never appears ⇒ the Assistant reads nothing out of that at all. ⇒ **The format must
keep the invariant already settled for `SHELL_LEGEND`: *each person's line lists EVERY place they
can reach, exhaustively*.** This holds true no matter how many capabilities get added, and there's
already a test guarding it.

**Trap 2 — what does the roster say when the handshake is broken?** 📖 `tools?` only exists when
`connected`. For `pending` / `failed` / `needs-auth`, we simply **don't know** what it can do.

> **Decision: when unknown, say UNKNOWN — never stay silent, never guess.**
> `[Google: couldn't connect]` — the Assistant reads this as *"this arm exists but is currently
> broken"*, entirely different from *"this arm doesn't exist"*. Staying silent here would
> **exactly** reproduce case 9.3: handing work to someone with no hands, and spending money to
> discover that fact.

⚠ **A related condition — caching.** The roster sits inside the Assistant's prefix. An MCP
flickering between `connected` ↔ `pending` would **bump the cacheKey every single time**. ⇒ status
entering the roster must be **stabilized** (only changes once it's held steady long enough),
matching the knowledge store's *"HOT must be STABLE"* rule.

### 7d. ✅ THE "LISTED BY NAME, NOT BY CAPABILITY" DEBT PAID OFF — the `folder` half (08/24)

§7b noted, back on 08/22: *"that line lists MCP by NAME (`notion`), not by CAPABILITY… the server's
name is a CLAIM, its tool list is the TRUTH. Unresolved."* Two days later it paid off, across three
consecutive turns:

```
— "Inside the allowed folder, find the 5 largest files…"
— "Could you give me the full path of the folder you'd like me to inspect?"
— "the music folder"
— "Could you give me the full path to that Music folder?"
— "your staff agent already knows this folder"          ← the user was RIGHT
— "I still need the full path…"
```

The Assistant **wasn't being stubborn — it genuinely didn't know**: `role.mcp` is an array of
HASHES (`a385afc3ab6`), and `reach()` dumped that array straight into the capability line.

**Fix (`assistant.ts §armReach`, a pure function, ~12 tokens/arm, 0 extra calls):**
`[Programs Installation 2 (folder: D:\Downloads\Programs Installation) · web · shell: OFF]`

⚠ **The other half, without which the first half is meaningless:** `SHELL_LEGEND` must teach it to
*use the printed folder directly, never ask again*. And that sentence must stay **narrow** — only
about the folder that's ALREADY been printed; writing it broadly as *"never ask for a path"* would
teach the Assistant to guess at a path it's never actually seen.

**Debt remaining:** the arm's **TOOLS** still aren't stated (14 of them ≈ 45 tokens/chat turn). Not
needed yet — see §7e.

### 7e. 🔴🔴 `SHELL_LEGEND` WAS LYING, AND IT HAD ALREADY WARNED ABOUT ITSELF SINCE 08/22

A user case from 08/24, the filesystem arm properly plugged in, shell **OFF**:

> *"The staff agent handling the Musics folder has shell disabled, so it can't get file sizes… Can
> you **turn on shell mode** for this staff agent?"*

**Wrong, and measurably wrong.** `spike-arm-e2e` case A ran with `role.tools = []` (shell fully
off) and still produced a complete size table: `Programs Installation 2 · list directory with
sizes` → `done`. `list_directory_with_sizes` and `get_file_info` are 2 of the arm's **14 tools**.

The old line read: *'"shell: ON" adds: **file size · modified date · file byte count**'*.

> ⚠⚠ **AND THIS IS THE EXPENSIVE PART.** The comment block sitting directly **ABOVE** that constant,
> written 08/22, had already stated exactly what would happen: *"this stops being true on the exact
> day MCP shows up… it lies in the direction that makes the Assistant REFUSE something that
> actually works"*. That day's patch **removed the word "ONLY" but left the causal clause
> unchanged**. And there was an actual test guarding the word "ONLY" — **passing the entire time,
> while the bug stayed alive**.
>
> **Fix the WORDING, not the STATEMENT.** The new test guards the statement itself: `SHELL_LEGEND`
> must not contain `file size` / `modified date` / `file byte count`.

**Decision:** only state what shell **genuinely gives exclusively** — *running arbitrary
commands/scripts · writing outside the office*. Plus a line blocking the exact broken behavior:

> *"A connection (🔌) grants its own capabilities on top, and the staff agent already knows what
> it can call when the work happens. **NEVER guess on its behalf** that a staff agent CANNOT do
> something just because "shell: OFF" — hand it the task, and it will report back if it's missing
> the right hand."*

⇒ This is also **the reason §7d doesn't need to state tools**: the Assistant doesn't need to know
what tools an arm has; it needs to know **where** a staff agent can reach (§7d) and **avoid
asserting anything it can't verify**. A staff agent knows its own toolset — the Assistant doesn't,
and that's perfectly fine.

> **The rule this yields: never list CAPABILITIES by SOURCE OF PROVISIONING.** Any statement shaped
> like *"having X is what enables Y"* is a claim about the whole world, and it stops being true the
> day the world grows — **in the direction that makes the system refuse work it can actually do**,
> i.e. a silent failure.

---

## 8. Approval gate for MCP — `annotations` is a source, but only in ONE direction

### 8a. Deriving the approval tier from annotations 📖

`SPEC-tools-approval` §8a settled four tiers and noted *"undeclared defaults to `write_external` —
safe when unknown"*. Now there's a better source than the user's own declaration:

| `annotations` | Proposed tier |
|---|---|
| `readOnly: true` | `read` |
| no annotation | **`write_external`** (safe default — kept unchanged) |
| `destructive: true` | **`irreversible`** — approved **individually, every time** |
| `openWorld: true` | a signal it reaches out to the Internet ⇒ **must never be downgraded** |

### 8a-bis. ✅ MEASURED 08/23 — the table above is **correct half the time**, and the wrong half matters

Real numbers from spike 1 (the 14 tools of `filesystem`):

| annotation | how many tools | tier §8a's table says | **correct?** |
|---|---|---|---|
| `readOnly: true` | **10** | `read` | ✅ correct, and this signal is **strong** (10/14) |
| no annotation | **1** | `write_external` | ✅ correct — and this case is **real**, not hypothetical |
| `destructive: true` | **3** | `irreversible` | 🔴 **WRONG** — see below |
| `openWorld: true` | **0** | — | ❓ **no observation at all** |

#### 🔴 `destructive` is NOT `irreversible` — two different concepts, and the data points at the difference

The three tools tagged `destructive: true` are `write_file` · `edit_file` · `move_file`. Applying
the old table would mean **every single write to a file through this arm requires asking the
user**. That's wrong: `SPEC-tools-approval` §8a defines `irreversible` as *"sending something ·
deleting · paying · **publishing publicly**"* — i.e. **leaving the user's own world**. Writing a
file to their own disk isn't that.

| | What the MCP is saying | What we're actually asking |
|---|---|---|
| `destructive` | *"this tool overwrites / deletes data"* | — |
| `openWorld` | *"this tool reaches out to the external world"* | — |
| Our own `irreversible` | — | *"once done, can it be undone?"* |

**Fix decided:** `destructive: true` ⇒ **`write_external`**, not `irreversible`. It's saying *"at
least a write"*, and that's exactly what it means.

**⇒ `irreversible` CANNOT be inferred from annotations.** It has to come from one of two places,
and both have an accountable party:

| source | example |
|---|---|
| **A catalog entry we curate** | *"this arm's `send_email` tool sends things out"* — we write it, we're accountable for it |
| **The user clicks it** | *"this tool is dangerous, ask me every time"* |

> **This is a design spot corrected by data, not by argument.** The §8a table was written before
> anyone had seen a real `annotations` object; it linked two similar-sounding words
> (`destructive` ↔ *destroy* ↔ *irreversible*) and it reads very smoothly. Fourteen lines of real
> data exposed it immediately.

⚠ **`openWorld` is a far better candidate for `irreversible`** — it asks exactly the right
question, *"does this leave this world"*. But **0/14 tools declare it**, so we have **zero
observations** at all. `filesystem` is a closed world, so that's a reasonable outcome — and it
also means this measurement **says nothing** about `openWorld`. **Must re-measure with a
network-facing arm (GitHub — spike 8)** before building §8 on top of this.

### 8a-ter. 🔴 THE `guardedZone` FENCE **DOES NOT COVER MCP TOOLS** — a hole reopened through a different door

`paths.ts §guardedZone` (patched 08/23) blocks reading `.state/` and writing config files. But the
hook matches `Read|Grep|Glob` and `Write|Edit|NotebookEdit` — **builtin names**. A tool belonging to
a filesystem MCP is named `mcp__<server>__read_file`, which **matches none of them**.

⇒ **A file arm pointed at a folder containing `company/` reopens the exact two holes patched that
same morning.**

| | status |
|---|---|
| Narrow patch — blocks a root plug-in swallowing the office/company folder | ✅ **done** — `catalog.ts §swallowsOffice`, 6 tests |
| Broad patch — extends the hook matcher to `mcp__*` | ✅ **DONE 08/24** — see §5i |

> ⚠ **Don't read the narrow patch as "already safe".** It closes **the easiest path to stumble
> into** (a user accidentally picking `D:\` as the root), not the whole class: any MCP with a
> file-reading tool, pointed anywhere containing `.state/`, still goes around it. Same rule already
> applied to `Bash`: *"narrowed, not closed"*.
>
> This is **the second reason** §8 (the approval gate) can't be shelved forever: `PreToolUse` is
> the one layer every tool call passes through, MCP included — and spike 3 hasn't run yet.

**✅ The ❓ question on the second row now has a measurement (08/24, `scripts/spike-mcp-hook.ts`):**

| | did the hook fire | outcome |
|---|---|---|
| control, no hook | — | ❌ `roles/nguoi-viet.yaml` could be read through `mcp__files__read_text_file` |
| `mcp__.*` matcher, deny | ✅ 2 times | ✅ **genuinely blocked** |
| `.*` matcher, deny | ✅ 1 time | ✅ genuinely blocked |

> Proof this is a **mechanism**, not "the model happened to behave today": the log **still** shows
> the `mcp__files__read_text_file` call ⇒ the model still calls the tool, the hook denies it. If
> that line vanished, we'd be measuring a *behavior*, not a *fence*. (The same distinguishing test
> already used for spike 6 on 08/23.)

### 8a-quater. 🔴🔴 AN ARM HAD NEVER ONCE ACTUALLY RUN — two overlapping holes, measured 08/24

See **§5i** for the full case. Summarized here because it corrects how all of §8 should be read:
every conclusion before 08/24 about "what an arm can do" was built on **handshake** measurements
(`mcpServerStatus`, `getContextUsage`) — **no measurement had yet CALLED an MCP tool**. Once
actually called, it was blocked by `allowedTools`.

### 8b. ⚠⚠ A one-way rule — annotations are **the server's own HINT**, not a guarantee

 The MCP spec calls them *hints* and states plainly that **a client must not trust them as a
safety guarantee**. A carelessly (or deliberately) written server could declare `readOnly: true`
for a tool that deletes data.

> **Decision: `annotations` may only be used to ESCALATE, never to DOWNGRADE.**
>
> - `destructive: true` ⇒ raises to `irreversible` — **trusted**, because trusting it wrongly only
>   costs one extra button click.
> - `readOnly: true` ⇒ does **NOT** automatically downgrade to `read`. Downgrading requires **the
>   user to click a button** saying *"this arm is read-only, stop asking me"* — an accountable
>   action, logged.
>
> The reason is an asymmetry: escalating wrongly costs one click; downgrading wrongly **deletes a
> customer's data with no one ever asked**. Same rule as *"when unprovable, fall to the safe
> side"* — and here the safe side runs opposite to the `canWriteOutside` case (where being
> unprovable means **letting it through**, because a false negative there silently blocks work
> that would otherwise have run fine). ⚠ **Two cases pointing in opposite directions, and that's
> correct:** over there, the consequence of a wrongful block is silence; here, the consequence of a
> wrongful pass is **lost data**.

### 8c. 📖 `McpServerToolPolicy` — the SDK already builds tier 2, but **remote only**

```ts
type McpServerToolPolicy = {
  name: string;
  permission_policy?: 'always_allow' | 'always_ask' | 'always_deny';
  org_max_permission?: 'allow' | 'ask' | 'blocked';
};
```

📖 The `.d.ts` comment: *"carried on `mcp_set_servers` **for remote servers**"*, and the `tools?`
field only exists on `McpHttpServerConfig` / `McpSSEServerConfig` — **not** on
`McpStdioServerConfig`.

| | has a `tools` policy? |
|---|---|
| Streamable HTTP · SSE | ✅ 📖 |
| **stdio** | ❌ |
| **self-generated connector** (`sdk`) | ❌ — but **doesn't need one**: we run the task ourselves, the approval gate lives inside our own function |

⇒ **Three paths, three different approval mechanisms.** This is a genuine mismatch that has to be
designed for, not pretended away as one uniform thing:

| Type | What enforces approval |
|---|---|
| HTTP/SSE | 📖 `McpServerToolPolicy.always_ask` — the SDK handles it |
| stdio | ❓ `canUseTool` or a `PreToolUse` matcher on `mcp__<server>__*` — **whether `PreToolUse` can even match an MCP tool is only "in principle" so far, NOT MEASURED** (`SPEC-tools-approval` §8·0) |
| connector | our own code, guaranteed to run |

> ⚠ **stdio is both the weakest case and the most common one** (`npx -y …` is the shape of nearly
> every MCP that exists today). If the measurement in §12 shows that neither `canUseTool` nor
> `PreToolUse` can match an MCP tool, then **the stdio approval gate doesn't exist**, and the only
> remaining option would be: wrap every stdio server in a `createSdkMcpServer` proxy of our own.
> Expensive, but it's the only path left. **Don't schedule §8 before this measurement exists.**

---

## 9. An arm's token cost — **measurable, and nobody has measured it yet**

### 9a. 📖 A precise, per-tool measurement already exists

```ts
getContextUsage() → {
  mcpTools: { name: string; serverName: string; tokens: number; isLoaded?: boolean }[];
  systemTools?: { name: string; tokens: number }[];
  categories: { name: string; tokens: number; isDeferred?: boolean }[];
  totalTokens: number; maxTokens: number; percentage: number;
}
```

This turns the *"2,000 connector tokens / role"* cap (`SPEC-connectors` §5) from an **estimated
guess** into a **runtime measurement**. And it lets the interface say the most accurate sentence it
could possibly say to the user:

```
🔌 Notion       ● active · 15 operations · ~1,240 tokens per turn
```

> This is exactly the third tier that debt item 0c said was still missing: **MEASURE**, alongside
> `block` / `don't block`.

### 9b. 🔴 THE BLOCKING QUESTION — ✅ **MEASURED 08/23: YES. MCP tools sit in the prefix, every turn.**

> ## ✅ SPIKE 2 — `scripts/spike-mcp.ts`. Two independent measurements, and **they don't agree**.
>
> **2a · `getContextUsage()`** — free, a control request:
>
> | | total | `mcpTools` |
> |---|---:|---|
> | no MCP | 5,915 | 0 |
> | + MCP files (default) | **8,690** | 14 tools · **`isLoaded: 0`** · 2,775 tokens |
> | + MCP files · `alwaysLoad` | **8,690** | 14 tools · **`isLoaded: 14`** · 2,775 tokens |
>
> **2b · the actual bill** — 2 haiku turns, **a cache-busting nonce** (`cache_read = 0` on both ⇒
> the nonce worked):
>
> | | `cache_write` |
> |---|---:|
> | 7 office tools | **4,546** |
> | + MCP files (14 tools) | **6,731** |
> | **MCP added** | **+2,185 tokens / every worker turn** |
>
> ### Four conclusions, and the third is the one nobody would have predicted
>
> **① No deferral at all. `alwaysLoad` is a NO-OP under our configuration.** The two rows of 2a
> give **the exact same number**; only `isLoaded` changes. 📖 The `.d.ts` says tools are *"deferred
> **when tool search is enabled**"* — and we pass `tools: [7 office tools]`, an allowlist that
> **doesn't contain `ToolSearch`**. The hypothesis from the old §9b holds **verbatim**, now with a
> number behind it.
>
> **② An arm costs about as much as a shell.** MCP with 14 tools = **2,185**, shell = **2,688**. ⇒
> **0.81×**. This is the single most memorable number from the whole spike: *plugging in one arm
> costs nearly as much as turning on shell*.
>
> **③ ⚠ TWO SOURCES DISAGREE BY 27%, and knowing which to use when matters.**
>
> | | MCP added |
> |---|---:|
> | `getContextUsage()` | **2,775** |
> | the actual bill (`cacheCreationInputTokens`) | **2,185** |
>
> They **don't measure the same thing**: `getContextUsage` reports **the context window**
> (which is why it also carries `Autocompact buffer 33,000` and `Free space`), while the bill
> reports **what actually got written to cache**.
> ⇒ **For money, read the bill; for the interface, read `getContextUsage`** (it breaks down by
> individual tool, the bill doesn't). Mixing the two numbers produces a 27% wrong report.
>
> **④ An old number cross-confirmed:** 2b measured `4,546` for 7 office tools — the 08/22
> measurement recorded **`4,547`**. A 1-token drift after a day, a different script, a different
> model. The measurement baseline is trustworthy. ⚠ But `getContextUsage` calls that same thing
> **`System tools 5,711`** — **don't compare it against 4,547**, they're two different reference
> frames.
>
> ### ⇒ What actually needs to be done, and it is NOT "turn on `ToolSearch`"
>
> | | |
> |---|---|
> | ✅ **DROP THE CAP** — user's decision, 08/23 | `SPEC-connectors` §5 set a cap of **2,000** tokens/role before anyone had measured anything. A single arm already costs **2,185** ⇒ it **blocks the very FIRST arm**. Drop it entirely, **don't set a new number** |
> | **Replace with: SHOW THE COST** | A hard cap blocks exactly the thing the user **intentionally** wanted, while the number itself is something they've **never once been shown**. It's the customer's money — our obligation is to make that choice **visible instead of blind**, not to decide it for them |
> | Three places the number must appear | the catalog card at selection time · the node on the diagram · a staff agent's detail panel (**summed across** all their arms). Missing any one of these is going right back to the invisibility that was just removed |
> | Plugging in 3 arms ≈ **+6,500 tokens/turn** | that's a **2.4×** multiplier on a 4,546 baseline. This is the point where `ToolSearch` (§5c) is worth reopening — but **only once it's measured that deferral is actually cheaper**, not because this number looks big |
>
> ⚠ **A boundary to note:** measured with **exactly one** 14-tool server. The relationship between
> *tool count* and *token count* is **not yet measured** — don't extrapolate linearly. Re-measure
> once a second catalog entry exists (Notion).

### 9b·old. ❓ The original hypothesis (kept here to show it was right)

📖 `alwaysLoad`'s docs say: *"Default: tools are **deferred** when tool search is enabled."*

But ✅ we pass `tools: [7 office tools + shell]` — an allowlist that **doesn't contain
`ToolSearch`**. ⇒ **Tool search is very likely OFF in our configuration**, ⇒ MCP tools **never get
deferred**, ⇒ they sit fully inside the cached prefix, **permanently, on every turn**.

> ⚠⚠ **This is a question that had to be answered BEFORE promising anything about MCP's cost.** The
> two scenarios differ **by an order of magnitude**:
>
> | | tool search ON | tool search OFF |
> |---|---|---|
> | Notion's 15 tools | deferred, returned when needed | **sits in the prefix every turn** |
> | Plugging in 3 MCPs | ~0 | ❓ could exceed even shell's 2,688 tokens **combined** |
>
> And it drags in an architectural question: `ToolSearch` **sits inside the "internal to Claude
> Code" group** that §5c deliberately **chose not to adopt**. If MCP needs it to be cheap, that
> decision has to be reopened — with a measurement, not with an argument.

### 9e. ✅ THE OVERSIZED RESULT — THE CLI ALREADY HANDLES IT, WE JUST HAD THE FILE IN THE WRONG PLACE (08/27)

> **The whole section's takeaway:** don't build a second cap. Claude Code **already** truncates an
> overly long result and spills it to a file — what we were missing was just **four places where it
> put the file somewhere wrong for us**.

**The triggering case:** `notion-fetch` returned **64,146 characters**. Once the staff agent
consumed it, it ran out of its turn budget, wandered off into `Grep`-ing the disk, and reported
*"too many steps"*.

The first reflex was to build our own cap (~16 KB) and spill it to a file ourselves. ✅ Measuring
it (`spike-spill.ts`) overturned that entirely:

| Q | Result |
|---|---|
| Does `PostToolUse` fire for an **MCP** tool? | ✅ **YES** — unlike `canUseTool`, which `allowedTools` hides it from |
| Can `updatedToolOutput` replace what the model sees? | ✅ **YES** — proven by the model opening **our exact file**, a path it had no way of guessing on its own |
| What shape is `tool_response`? | a **string**, not a `content[]` block |
| Does the original get token-counted before the hook runs? | **a self-canceling question** — the CLI already truncates first, the 64 KB never entered context at all |

⇒ **Building a second cap would just be two copies of the same rule** — something this project has
already paid for a few times (`agentSlot` vs `arrange`; `pickMcp` vs `probeArm`). Four spots
needed patching:

| | Where the CLI put things wrong | The consequence already observed |
|---|---|---|
| ① | the file sat **outside the office** | every read got labeled *"outside the office"*, the model switched to PowerShell — **10 wasted turns** |
| ② | under a **session-uuid**, changing every session | yesterday's pointer became a dead path |
| ③ | the user **never saw it** | 64 KB landed on their machine while the Results panel stayed empty |
| ④ | 🔴 the message opened with **`Error:`** | a **successful** turn got baited into looking like **a failure** ⇒ the model went into recovery mode |

④ is the cheapest to patch and the most expensive to ignore: **not a technical
bug, just one wrong word in a sentence.**

#### 9e·1 🔴🔴 BEING SPILLED TO A FILE ≠ BEING READABLE — the other half of the problem

The first patch was copied verbatim, and the user tested it immediately: `error_max_turns`.
Measured:

```
73,530 bytes  ·  line count: 1
```

`Read` truncates by **LINE**. A single-line file ⇒ `offset`/`limit` **cut nothing at all** ⇒
every read returned the full 73 KB ⇒ blew the cap again ⇒ the CLI spilled to a file again ⇒
**a loop until the turn budget ran out**. And **our own** pointer message instructed *"use Read
with offset/limit"* — **advice that literally cannot be followed**, right where the model needed
guidance the most. We had manufactured a §5m case for ourselves.

⇒ `readable()`: for JSON, **spread the content out**, not `JSON.stringify(v,null,2)` —
that only separates the *envelope*, while a 60 KB `text` field still sits on one line because its
`\n` characters get re-escaped. For non-JSON, hard-wrap the lines. Measured on a real file: **1 →
878 lines**. An invariant, with a test: **not a single character lost**.

#### 9e·2 🔴🔴 LOCKING DOWN THE SOURCE — without it, this is a FILE-EXFILTRATION hole

`tool_response` is **a string written by a third party**. All an MCP server has to return is

```
…saved to D:\…\company\.state\secrets.json…
```

and agentco would **copy the key vault into `artifacts/` with its own hands** — a place every
staff agent can read and the user can download from. `guardedZone` blocks the agent from *reading*
`.state/`; this patch would have *carried the content out for it instead*. Exactly the shape
`swallowsOffice` already recorded: **a proper front door, a back door left open**.

Locked in by structure, three conditions: an **absolute** path · a parent directory named exactly
**`tool-results`** · a **`.txt`** extension. There's a test that stands up a real `secrets.json`
and asserts it **cannot be copied**.

#### 9e·3 Naming and placement — the user caught it, and both were wrong

```
a46a7e26403__notion-fetch--mcp-a46a7e26403-notion-fetch-1787778426161.txt
└─ hash ─┘                    └─ hash again ─┘              └─ epoch ─┘
```

**A hash leaking onto the screen** — while `audit.ts` had already established the rule from the
start: *"a hash never appears on screen"*. An MCP tool's name is `mcp__<hash>__<operation>`,
stripping just the `mcp__` prefix still leaves the hash behind. And the file dropped **straight
into the root of `artifacts/`**, while everything else lives under
`artifacts/<plan_id>/<task_id>/` — `ArtifactRecord` derives the plan/task **from the path**, so
this became an **orphaned** entry.

⇒ `artifacts/<plan_id>/<task_id>/notion-fetch.txt`, deduplicated by **a counter** (`-2`, `-3`)
rather than a timestamp: it reads as meaningful.

> The question *"maybe it's a temp file so it doesn't matter"* has the answer **NO**: `artifacts/`
> is exactly what the user sees and downloads. A temp file belongs in `.state/` — but `.state/`
> sits inside `guardedZone`, so a staff agent can't read it. **There is no "just leave it
> temporary" path.**

#### 9e·4 Notification — and **only when a spill actually happens**

The threshold changes behavior per turn (a small page passes through directly, a large one gets
spilled). Changing behavior silently forces the user to guess. Three spots, each answering a
different question: **the progress line** (*what just happened*) · **the 🔌 log** (*what was
fetched yesterday*) · **the Results panel** (*where's the content*).

⚠ **Anti-requirement:** never notify when nothing was spilled. A notification firing on every turn
is the kind of thing people learn to ignore — the exact reasoning already used to drop the approval
gate. It's worth flagging **precisely because it's rare**. And that message comes from **the
deterministic layer**, never from the model.

---

### 9f. ✅ RESUMING A TRUNCATED TASK — dropping the need to guess N (user approved 08/27)

**The problem:** a task has **N parts**, where **N is only known AFTER the task has begun**, and
each part can be very large.

Today, the plan is forced to guess N **in advance**. A real case from 08/27:

```
T-01 positions 1–3   → actually did the work    5 turns  $0.16
T-02 positions 4–6   → "there's only 1 page"     3 turns  $0.04
T-03 positions 7–9   → "there's only 1 page"     3 turns  $0.04
T-04 positions 10+   → "there's only 1 page"     3 turns  $0.04
```

**Three of four tasks were meaningless from the moment they were created.** This is a property of
the **architecture**, not a one-off model lapse: the plan is laid out **before** any task actually
runs, so the Assistant can't read a file it just told someone else to create. Guessing too high ⇒
an empty task; guessing too low ⇒ hitting the turn cap. **Two ends of the same stick.**

**Decision: drop the guessing.** Just run it; hitting the turn cap while **genuine progress is
being made** just reschedules that same task, and **the next attempt reads from a file that
genuinely exists on disk**.

> ### Why the Assistant is NOT allowed to "reconsider" (the user asked directly)
> It would have to spend **one more model turn**, with **far less information** than the worker
> just had — it only sees a single `say` sentence, none of those 15 turns. A "try a different
> approach" mechanism at that layer is just **guessing**, and guessing at the planning layer
> **spawns more tasks**. The user named the exact danger: *"if the Assistant doesn't have enough
> context but forces itself to do something impossible, that's also really bad — I think that's a
> bigger risk."*
> ⇒ This mechanism is **deterministic · 0 tokens spent on the decision · evidence-based**.
> → [[agentco-deterministic-vs-signal]]

**Two fences — missing either one spawns a money-burning loop:**

| | Fence | What it blocks |
|---|---|---|
| ① | must show **a new file** (`landed` isn't empty) | a task that hasn't moved at all just getting rescheduled ⇒ another full turn cap burned every cycle |
| ② | **a cap of 1 retry** (the user's decision), and that number **is displayed** | progress can be REAL yet very slow; and **deterministic does NOT mean cheap** — every retry is a full worker turn run all the way to the cap |

> **Why 1, not 3** (the user asked directly: *"I'm worried about it dragging on without finishing —
> or does that not matter much since it's deterministic?"*): determinism only guarantees **no
> infinite loop**, it does not guarantee **cheap**. A cap of 3 means a single task could cost up to
> **4×** its budget.
>
> And nobody has yet measured how many retries a genuinely long case actually needs — picking 3
> would just be **guessing a number**, the exact shape as the 2,000-token cap that "blocked the
> very first arm" (§9b). The two failure directions are **not symmetric**: too low, and the task
> fails after 2 turns **with a message the user sees right away**, and they know to raise
> `max_turns`; too high, and money burns **silently** on a task that will never finish. ⇒ Raise it
> once there's **one measured long case**, never on a hunch.
> → [[agentco-safe-default-direction]]

And **only for `max_turns`**. Resuming a `budget`-stopped task would be **deliberately exceeding a
spending cap the user set**; `usage_limit`/`auth` means knocking on a door that's already locked;
`stopped` would mean **directly reversing a command the user just issued**. There's a test locking
in all six failure kinds.

⚠ The extra instruction line **carries no part number**. Stuffing in *"start from part 4"* would
rebuild the exact bug that was just fixed — guessing a position inside a list nobody has actually
read. And it's appended **once**, not once per cycle: three identical lines **teach the model that
line doesn't matter**. (A test catches this exact mistake.)

⚠ The truncated turn's token cost **is recorded before resuming** — `max_turns` is, by definition,
the **most expensive** kind of failure (it runs all the way to the cap).

#### 9f·1 `error_max_turns` — raw machine code leaking onto the screen, and it's at the ASSISTANT layer

> *"why did it return an `error_max_turns` — who's supposed to know what that means"* — the user,
> 08/27

⚠ **Correcting a wrong diagnosis from this very round of fixes:** the first patch was placed in
`worker.ts` — **the wrong layer**. The worker already had a human-readable message via
`classifyError`, long before this. What the user actually saw came from **`assistant.ts`**:

```ts
const why = m['result']?.trim() || m['subtype'];   // result is EMPTY ⇒ throws raw machine code
```

⚠⚠ And the patch carried its own trap: `classifyError` matches via the regex `/max_turns/`.
**Translating first, then classifying** meant the Vietnamese sentence matched nothing at all ⇒
every error fell back to `other` ⇒ the layer above mishandled it, **silently**. ⇒ Classify on **the
original code**, translate afterward. `sayError()` only translates when the SDK provides no
sentence at all (`^error_[a-z_]+$`) — when there's a real sentence, it's kept as-is, because
replacing a specific statement with a generic one **destroys information**.

#### 9f·2 ⛔ WEIGHED AND REJECTED: adding a rule to the worker's system prompt

The user considered: *"prioritize checking what MCP can do (if available) before falling back to
shell; when using shell, plan first instead of trying things randomly"*.

**Rejected, and the reason is a measurement:** the case from the morning of 08/27 had 9 `Grep` +
wandering PowerShell turns; the case from the afternoon of the same day, after §9e was patched, had
**0 shell turns at all**. The cause was **structural** (a pointer outside the office + the word
`Error:`), and it was removed.

Adding a prompt line at this point would be **buying a silent risk to treat a symptom that no
longer recurs** — and it would stay forever because nobody could ever prove it was unnecessary. The
specific risk: a task where shell genuinely is the right path (bulk renaming, running a build) where
the model hesitates would go **unnoticed** — it would just be slower and more roundabout.

Plus an already-established rule: **a rule inside a prompt loses to a list of examples**
([[agentco-prompt-rules-lose-to-examples]]) — a warning line at the top of a prompt is the weakest
form of instruction possible, and the 08/22 debt already proved the correct fix was **editing the
data on the line carrying the example**, not adding a sentence at the top of the block.

**Also rejected: a plan confirmation button.** The user: *"just add a 'confirm yes' button and be
done with it — but then it becomes… in an easy flow, I usually just type /stop. No, don't build it,
the LLM doesn't know when to ask and when to just run anyway."*

---

### 9c. ✅ Why the Assistant **never** holds MCP — already decided, repeated here because §7 makes it easy to forget

`types.ts:499`: MCP **breaks the prompt cache on `resume`** (issue #247) — losing ~**36,000
equivalent tokens EVERY conversation turn**. The Assistant `resume`s on **every message**. ⇒ MCP is
attached to **workers**, and if the Assistant needs to use an arm, it goes through **a hidden
worker**.

⚠ This collides with §7: the Assistant **must be able to read** an MCP's tool list to route work to
the right person, but **must never hold** the MCP itself. ⇒ The roster pulls its data from 📖
`mcpServerStatus()` of **a different session** (a worker, or a separate handshake turn at plug-in
time), then **writes it to disk** as an established fact. It's **never** attached to the
Assistant's own session to be queried live. This is an enforcing constraint, not a preference.

### 9d. What happens to an arm's accumulated knowledge when it's unplugged — **DON'T DELETE, put it to SLEEP**

> **The user's question:** *"unplugging an MCP means its accumulated knowledge disappears with
> it — my question is, is that too costly a tradeoff?"*
>
> **Answer: the DELETE version is expensive and dangerous; the SLEEP version is nearly free and
> achieves exactly what you actually want.**

The real goal behind "disappears with it" is **don't keep paying tokens for knowledge about
something no longer plugged in**. That's a goal about **the prefix**, not about **disk**. The two
versions are entirely different:

| | The DELETE version | The SLEEP version ⭐ |
|---|---|---|
| What it does | finds every node sourced from that MCP, deletes the files | adds `source: mcp:<name>`, and **filters it out of HOT** once the arm has no wire left |
| Token cost once unplugged | 0 | **0** — identical |
| Effort required | ⚠ needs a batch-delete path built, needs tests | **one field + one condition** inside the HOT-selection logic |
| Re-plugging | knowledge is **gone forever**, has to be relearned from scratch (every lesson learned was an LLM turn already paid for) | comes back intact |
| Risk | 🔴 falls into the `dropDependents`/`findTwin` class — ✅ *"the only TWO pieces that actually delete a user's files"*, and **debt item 0b explicitly notes they have NO TESTS YET** | 🟢 not a single byte deleted |

**Three reasons the DELETE version is wrong, and the third is the disqualifying one:**

1. **The premise "unplugged = no longer wanted" is often wrong.** People unplug things to **manage
   token spend**, to try a different server, to temporarily save cost. Deleting punishes an action
   that was actually harmless.
2. **Most of that knowledge is NOT about the tool itself.** ✅ `SPEC-tools-approval` §7b already
   drew this line: *"this tool creates a page"* belongs to the MCP; *"invoices live in the 2026
   Accounting database"*, *"the fiscal year starts in April"* is **ORGANIZATIONAL knowledge**,
   merely discovered incidentally through that arm. Unplugging Notion doesn't change the fiscal
   year.
3. **Separating those two categories is a SEMANTIC question ⇒ it can never be made
   deterministic.** An established rule: *the DETERMINISTIC gate may only ever speak about
   something with ENFORCING CODE behind it.* A deletion gate based on *"does this note talk about
   the tool, or about the company"* is exactly the thing already rejected in case ㉕ — and here **a
   false negative deletes the user's actual data**, not just blocks one task by mistake. ⇒
   [[agentco-safe-default-direction]]

**Decision: SLEEP.** The node stays intact on disk, carrying `source`, and **falls out of HOT** once
the arm has no wire left in the office — so it stops costing tokens immediately. Manual lookup
still finds it, re-plugging brings it back to life. This matches the *"soft delete"* pattern the
user has already settled on for everything else in this product.

⚠ One condition attached: `source` must be recorded at the moment the node is **created** (knowing
for certain which turn, which arm, a lesson came from), **never** guessed backward by scanning the
content for a server name string. Scanning strings substitutes **shape for provenance** — an error
class already counted **four times** in this project.

---

## 10. Docker — **yes, it genuinely locks it down**, and that's two pieces of news at once

> **The question:** *"if the app runs inside Docker, does Docker itself lock down its ability to
> reach out to files on the host system?"*
>
> **Answer: YES, and it locks it down tightly.** A container only sees its own image's filesystem
> plus whatever's been **explicitly mounted**. Without a mount, `D:\Downloads` **doesn't exist** as
> far as the process inside is concerned — not "denied", it's simply **not there**.

### 10a. What's lost, what's gained

| | Inside Docker |
|---|---|
| `Read`/`Glob`/`Grep` reaching outside `company/` | ❌ **no path there at all** — except a mounted volume |
| `Bash` touching the host filesystem | ❌ same as above |
| `WebFetch`/`WebSearch` | ✅ still works (network isn't locked down by default) |
| **stdio** MCP (`npx -y …`) | ⚠ runs **inside** the container: needs `node`/`npx` (and `python`/`uv` for a Python server) **in the image**, needs network access to npm, needs a writable cache |
| **HTTP** MCP | ✅ works best inside Docker |
| The key vault, `.state/secrets.json` | ✅ **unmounted, and the agent can't reach it** — §5d case C closes **for free** |
| Lesson 9 (inventorying `D:\Downloads`) | ❌ **dead**, unless mounted |
| The 📂 "open folder" button | ✅ already handled by `isLoopback` |

> **⇒ Docker is exactly the containment story `SPEC-tools-approval` §5b says agentco currently
> LACKS.** It isn't an infrastructure line item — it's **a security feature**, and worth selling as
> one. Three things a hook alone couldn't fully build (a read fence · blocking `Bash` from writing
> outward · hiding the key vault) — Docker delivers **all three, for free, via the kernel**.

### 10b. 🔴 But it **breaks a premise** the §1b firewall relies on — nobody has said this out loud yet

`SPEC-tools-approval` §1b decided (08/22, not yet built): a destination passes through `officeJail`
when **that exact string is present in the message the user just typed**.

Inside Docker, the user types `D:\Downloads\ban-ke.md` from a browser on their own Windows machine.
Inside the container, the real path is `/data/downloads/ban-ke.md`. **The string the user typed
never matches the string the system actually uses.**

| | on the host machine | inside Docker |
|---|---|---|
| what the user types | `D:\Downloads\x.md` | `D:\Downloads\x.md` |
| what the system sees | `D:\Downloads\x.md` ✅ matches | `/data/downloads/x.md` ❌ **doesn't match** |
| result | writes exactly where they wanted | **always** falls back to the office folder |

**Three observations, and the third is the one that actually matters:**

1. It **skews toward the safe side** — exactly as §1b was designed to. No data loss, no writing to
   the wrong place.
2. But it makes the *"write outside the office"* feature **silently nonexistent** inside Docker.
   Exactly the shape of the `Bash` switch that was a no-op for 6 days
   ([[agentco-silent-allowlist]]).
3. ⇒ **The invariant needs rewording so it holds in both environments:** *"a valid destination =
   the office **PLUS** any explicitly mounted volume, and the name the user sees must be the exact
   name they're able to type"*. Meaning Docker needs **a path-mapping table** surfaced in the UI,
   not an environment variable the deploying operator has to remember to set. ✅ An existing rule
   already applies: *an invariant that depends on memory isn't an invariant* (the 📂 button case).

> **This is the fourth time in two sessions a feature was correct on the dev machine and wrong
> somewhere else** — the shell tool's name varying by OS, non-Latin-character slugs, "open folder"
> from a remote location, and now path mapping inside a container. **The same shape every time: the
> machine doing the coding becomes an unstated premise.**

### 10c. A proposal — two modes, stated plainly, **not yet decided**

| Mode | For whom | What arms can reach |
|---|---|---|
| **On the machine** (today) | an individual user, `npx agentco` | the whole machine — fast, convenient, **no containment** |
| **Inside a box** (Docker/VPS) | a business, someone who needs an audit trail | **only mounted folders** + MCP + web |

The user picks by how they install it, not via a toggle inside the app. ✅ The five container
constraints in `SPEC-cli.md` §4 already hold correctly from the start, so this path **isn't
blocked**.

❓ **Still to be answered:** authenticating Claude inside a container (`SPEC-cli.md` §4 already
notes this as a genuine snag), and `npx` inside the image (worth considering **baking** catalog
MCPs into the image ahead of time instead of downloading them at runtime — faster and reduces
supply-chain risk §11c at the same time).

### 10d. ⏸ SHELVED — the user's decision, 08/23

**Docker for later**, the user will test it themselves and decide from there. ✅ Nothing is blocked:
the five container constraints in `SPEC-cli.md` §4 still hold, and §6 introduces no new violations.

**But two things from §10b have to carry forward, because they are NOT Docker's problem to solve:**

1. **The §1b invariant is worded wrong, starting right now.** *"The string the user just typed"*
   carries the unstated premise *"the user and the daemon see the same filesystem"* — that premise
   is already false on a **VPS** (the user themselves raised this in the 📂 button case), no need
   to wait for Docker. Fixing the invariant's wording is **immediate** work; building the actual
   path-mapping mechanism is Docker's work.
2. **The "Files on the machine" catalog entry (§4e entry 1) is the entry that ABSORBS this whole
   collision.** It asks *"which folder is allowed"* ⇒ it **already** needs an explicit list of
   folders ⇒ exactly the right place to put path mapping later. ⇒ That entry's design **must not
   assume the path the user types equals the path the daemon sees**, even though today they happen
   to be identical. That's the cheapest place to pre-pay for Docker, and **it's cheap precisely
   because it's just refraining from asserting something we don't need to assert yet**.

---

## 11. Copyright and logos — the risk is **TRADEMARK**, not copyright

> ⚠ **I'm not a lawyer, and this isn't legal advice.** What follows is common practice + each
> vendor's own published terms, checked 2026-08-23. Before going live, ask an IP lawyer **once** —
> far cheaper than fixing it after the fact.

### 11a. Three things that keep getting conflated

| Thing | Real risk |
|---|---|
| **Building an integration** with their service (calling their public API, plugging in their MCP server) | 🟢 **Low.** This is normal across the whole industry. The constraint lives in their **API terms** (rate limits, no reuse of their data), not in copyright |
| **Naming them** — *"Connect Google Drive"*, *"works with Notion"* | 🟡 **Low if done right.** This is nominative fair use: using the name to point at their actual product, using **just enough to identify it**, and **not implying their endorsement** |
| **Putting their logo in the app** | 🟠 **This is where the actual law lives.** A logo goes past "just enough to identify," and most big vendors have their **own guideline page** governing exactly this |

### 11a-bis. ✅ Straight answer: *"does putting their logo on an MCP node also count as infringement?"*

**Not automatically — and it's the most defensible form a logo use can take.** A logo sitting next
to a name, in a list of integrations, identifying **that one service** — this is exactly nominative
use, and the whole industry does it (Zapier, n8n, Make all display partner logos).

**But "most defensible" ≠ "allowed by default."** Three different things keep getting conflated:

| | Risk |
|---|---|
| A **small logo next to the name, inside a connections list**, with no implied endorsement | 🟢–🟡 low. This is where we intend to use it |
| A logo in **agentco's marketing images / landing page** | 🟠 higher — a marketing context reads more easily as "there's a partnership" |
| A logo used as **the icon of the app / of a feature** | 🔴 almost always explicitly forbidden |

**The decision isn't a general principle — it's EACH VENDOR'S OWN RULES** — and that's exactly
where the three v1 entries diverge:

| v1 entry | Third-party brand? | Status |
|---|---|---|
| **Files on the machine** | ❌ **none** — this is MCP's own reference server | 🟢 our own icon, **zero risk** |
| **Notion** | yes | 🟡 ❓ **couldn't confirm** their guideline page in one pass. That's exactly why the `checked_on` field exists |
| **Google** | yes | 🟠  **strictest, and already read**: forbids using Google's logo as the app's own logo; requires attribution; only *"for / compatible with"* phrasing is allowed |

> ⚠ **Not finding Notion's page in one pass IS data, not a failure.** A vendor's normal state is
> *"nobody has gone and read their rules yet,"* and shipping a logo on the strength of *"probably
> fine, everyone does it"* is **exactly the shape** this whole project keeps fighting: a claim that
> sounds reasonable, that nobody checks, and that survives a long time precisely because **it never
> produces a symptom** — until the day it does.

**⇒ v1 decision: ship a neutral icon for ALL THREE.** Not because the risk is high, but for three
reasons stacked together:

1. **It blocks nothing.** `brand{}` is a **data field**; turning on a real logo per vendor later
   is a one-line change, not a code change.
2. **Half-logo, half-icon is worse than either pure option.** Shipping Notion's real logo next to a
   gray icon for Google reads as an unfinished product.
3. **The cost of waiting is close to zero.** Users recognize "Notion" by **the word Notion**; the
   logo buys roughly half a second of extra recognition.

In exchange: **no legal debt sits anywhere in the first build that goes out the door.** Reading
each vendor's guidelines is an afternoon's work, doable any time, and done **once per vendor**.

### 11b. Four hard rules — violating them differs from this by degree, not by kind

 Compiled from Google's brand guidelines (which also govern the Google Workspace Marketplace):

1. ❌ **Do not** use their logo as agentco's own logo/icon, or as a feature's icon.
2. ❌ **Do not** fold their name into a product name, company name, **domain name**, or tagline.
   ✅ It's fine to say *"for Google Drive™"*, *"works with Notion"* — a **compatibility** framing,
   not an ownership one.
3. ❌ **Do not** do anything that implies a partnership / sponsorship / certification that
   **doesn't exist**.
4. ✅ **Attribute** the mark when using it — *"Google Drive™ is a trademark of Google LLC."*

### 11c. agentco's own policy — **safe by default, opens once read**

| | Decision |
|---|---|
| **Default for every catalog entry** | **Text name + one of our own NEUTRAL icons** (🔌 / a category-specific shape: document store, spreadsheet, chat…). No third-party logo |
| **When a real logo is allowed** | Only once **that vendor's own brand-guideline page has been read**, using an **official asset file** they published, at the padding/color/ratio they specify, with the link recorded in that entry's record |
| **Required field on every catalog entry** | `brand: { name, trademark_owner, guideline_url, asset_source, checked_on }` — **an empty field means no logo**. Structure, not discipline |
| **Customer-built connectors** | icon chosen/uploaded by the **customer**. The risk shifts to them, and they're using it inside their own company — a genuinely different situation |
| **Screenshots / sales video** |  Google permits **unmodified, as-is** screenshots with attribution. Read each vendor's own rules — don't infer one vendor's policy from another's |

> **A side benefit, and not a small one:** a neutral icon makes **the whole catalog read as one
> system**, instead of a wall of logos in mismatched colors and ratios. The legal question and the
> aesthetic one **line up** here — a sign that the constraint sits in the right place.

### 11d. ⚠ A second risk, bigger and rarely mentioned: **supply chain**

`npx -y @ai-do-do/mcp-server` **downloads and runs a stranger's code on the customer's machine,
with the customer's permissions, holding the customer's keys.** ✅ `TEST-WALKTHROUGH` step B already
warns about exactly this (*"you're handing a Google token to a stranger's code"*).

Once a package shows up **in our own catalog**, that warning stops being enough — **choosing it for
the customer means vouching for it on the customer's behalf.** Two mandatory constraints for every
catalog entry:

- **Pin the version** (`@x.y.z`), **not** `@latest`. `@latest` means a stranger's update runs on
  the customer's machine with nobody having reviewed it.
- **State the maintainer clearly**, right on the plug-in screen — *"published by Notion"* is very
  different from *"published by the community,"* and the user has a right to know who they're
  trusting.

---

## 12. ❗ WORK THAT MUST BE MEASURED BEFORE IT'S BUILT — §3 is still all 📖

Project rule: *never schedule work on top of a mechanism nobody has actually seen run.* Seven
spikes, ordered by **which design collapses if it turns out to be wrong**:

| # | Spike | Proves what | What collapses if it's wrong |
|---|---|---|---|
| ~~**1**~~ | ✅ **DONE 08/23** — `scripts/spike-mcp.ts` | **✅ YES.** 14 tools · **13/14 carry annotations** · `openWorld` **0/14** | §8a is a one-line fix — see §8a-bis |
| ~~**2**~~ | ✅ **DONE 08/23** — same script, `--paid` | **🔴 does NOT delay.** `alwaysLoad` is a no-op · **+2,185 tokens/turn** (0.81× shell) | §9b |
| **3** | `PreToolUse` matcher `mcp__*` on a real MCP tool call | does an approval gate exist for **stdio** | **§8c** — stdio is the most common case. If it fails, a proxy wrapper is required |
| **4** | `setMcpServers()` mid-session: add · remove · wrong key | can it plug/unplug without a restart · does `errors` say anything useful | **§6** — the Try-now button, and B7 |
| **5** | `onElicitation` `mode:'url'` with a server that needs OAuth | does OAuth work through the UI | **§6d** — and step 10 of chapter B |
| ~~**6**~~ | ✅ **DONE 08/23** — `scripts/spike-secrets.ts` | **both §5d and §5f: 🔴 YES, both.** $0.0389 | — |
| ~~**7**~~ | ⏸ Docker — **shelved 08/23** | | — |
| **8** | 🆕 Plug in the GitHub remote (http) and see whether `pickMcp` injects `headers` | is the §5a hole real (**prediction: yes** — `worker.ts:634` only accepts `command`) | catalog entry #3 |

⚠ **A measurement trap already paid for twice, and it applies to spike 2:** the second measurement
**hit the first measurement's cache** and produced a zero difference. **A nonce has to go into the
system prompt to force a cache miss both times.** [[agentco-measurement-vs-conclusion]]

⚠ **A measurement trap for spikes 1 and 4:** 📖 the `.d.ts` says control requests **only run in
streaming input mode**, and ✅ we already learned in §5n ⑤ that they **don't get answered while the
main loop is busy**. ⇒ Call `mcpServerStatus()` while the CLI is **idle** — the same formula that
saved `usage()`: open the query with a generator **that holds the stream open without sending
anything**.

---

## 13. Build order

Ordered by *how much it unlocks / how much it costs*, and **the first three are MEASURING, not
BUILDING**:

Updated 08/23 per the user's four decisions. **The first three are MEASURE**, the fourth and fifth
are **plugging two holes currently open** — all five combined are under an afternoon, and they
decide the shape of everything that follows.

| # | Task | Unlocks | Size |
|---|---|---|---|
| ~~1~~ | ✅ **Spike 6** — the two §5d + §5f holes | **both 🔴 YES.** $0.0389 · 08/23 | done |
| ~~2~~ | ✅ **Plug §5d + §5f** — `paths.ts §guardedZone` + two `officeJail` matchers | **both 🟢 NO**, re-measured same day. **+17 tests → 298.** 0 tokens | done |
| ~~3~~ | ✅ **Spike 1 + 2** — `scripts/spike-mcp.ts` | `tools[]`+`annotations` ✅ **YES** (13/14) · MCP **does NOT delay**, **+2,185 tokens/turn** · $0.025 | done |
| **4** | **Spike 4** — `setMcpServers` hot-plug | the **Try-now** button, drops the restart step | small |
| 5 | **Path B** — the 3-step `+ Connect` dialog, paste config (§6f) | **clears all 4 alarm bells** 📝 | medium |
| 6 | The **Files on the machine** entry (§4e #1) | ⭐ **the ruler for all of §6**: click → runs, **0 key fields** | small |
| 7 | Key travels with the connection (§6b) | drops step B6 | small |
| 8 | The **Notion** entry (§4e #2) | the **static key field** mechanism | small |
| 9 | Node shows live status + splitting out `McpBody` (§6g) | tells whether an arm is alive or dead | small |
| 10 | **Spike 8** → plug §5a (`headers` injection) → the **GitHub** entry (§4e #3) | the **HTTP** path, and a §5a hole nobody has touched yet | medium |
| 11 | Capability line from the handshake (§7) | the Assistant routes work to the right person | small |
| 12 | **Spike 5** → the **Google** entry via `onElicitation` (§4e #4, the **G2** path) | step 10 of chapter B | medium |
| 13 | Node shows only in the office actually using it (§6g) | keeps the diagram clean once plugging in is cheap | small |
| 14 | **Spike 3** → two-tier approval gate (§8) | step 10 of chapter C. ⚠ **don't schedule ahead of spike 3** | large |
| 15 | Knowledge `source` + putting it to sleep by arm (§9d) | closes the user's decision ⑱ | **very small** |
| 16 | MCP builder for the autobot swarm (§5g) | a build flow that's **named, logged** | medium |
| 17 | Self-built connector (path **C**) | **the differentiator** | large |
| ⏸ | Docker (§10) | shelved — user will test it themselves and decide | — |
| ⏸ | **STAR layout for staff** (user's proposal, 08/23) | the row layout runs out of room once there are many people | large |

> ### ⏸ Star layout — shelved 08/23, **and this is the thing that has to be settled before it's built**
>
> **The problem is real:** the row layout wraps at `PER_ROW = 4` — every extra row pushes both
> storage nodes down a level, and the diagram grows vertically. The cheap part was already taken
> (shrinking nodes, tightening vertical gaps), but that's a **delay**, not a **fix**.
>
> **Deliberately not built yet:** it touches `arrangeAll` · `centeredSlot` · `firstFreeSlot` ·
> `clashes` **all at once**, and all four are guarded by tests locking down cases that really broke
> before (a third person piling onto one side · a new slot landing on top of an existing person · a
> slot offset by half a column). A half-done job is worse than the row layout.
>
> **One question the user has to settle first, because the two answers produce entirely different diagrams:**
>
> | | Where's the Assistant | What it reads as |
> |---|---|---|
> | **Circle** | **center**, staff arranged around it | a **radial** relationship — everyone is a peer |
> | **Fan** | **apex**, staff fanning downward | a **top–down** relationship, preserving "work flows downward" |
>
> ⚠ The circle is prettier but it **breaks the layering**: arms and both storage nodes currently sit
> at the bottom because of the rule *"work flows down, resources push up."* Put the Assistant in the
> middle and that vertical axis is gone — placement has to be rethought for **all four** node kinds,
> not just staff.

> **Task 2 jumped to the front because spike 6 changed its status**: yesterday it was *"plugging a
> hole we suspect exists"*; today it's *"plugging a hole we've watched run, twice, in 45 seconds,
> for $0.04."*
>
> **Tasks 5 and 6 are nearly one task** — §5h·1 measured it: the catalog **is path B with a
> pre-filled form**, not a second mechanism. So "build path B, then get the catalog for free" isn't
> two phases — it's one and a half tasks.

> **Task 6 is the ruler for all of §6.** The *"Files on the machine"* entry goes from click to
> running **with zero key fields**. If a non-coder can't do it in 30 seconds, the design is wrong —
> and finding that out **before** Notion + Google get built is the cheapest place to find it out.

---

## 14. Open questions

### ✅ Settled 08/23 — not up for debate

| | Decision |
|---|---|
| ~~v1 catalog~~ | **Filesystem · Notion · Google**, and that's the build order. §4e |
| ~~The key-security hole~~ | **A, right now.** B is the target, **C explicitly excluded**. §5d · §5e ② |
| ~~Docker~~ | ⏸ **shelved**, two consequences carried forward. §10d |
| ~~Knowledge when an MCP is unplugged~~ | **SLEEPS, doesn't get deleted.** §9d |
| ~~Is MCP a node?~~ | **Node** — already is one. Entry point = the `+ Connect` button, **drag-and-drop dropped**. §6e |

### ✅ SETTLED the evening of 08/24 (user) — **AN ARM IS A SHORTCUT, NOT A FENCE**

> The question boiled down to: *"Is connecting a folder REQUIRED to reach that folder, or is it
> just a convenient shortcut?"* — **Answer: a convenient shortcut.** *"MCP is the folder that's
> plugged in, not an onlyAllows. Then let the LLM's own judgment do the choosing."*

This is the answer to **#1**, and it closes the four items below along with it. The consequences
that come with it, all four:

| | |
|---|---|
| **Vocabulary** | Stop calling it *"the allowed folder."* `armReach` becomes `(shortcut to …)` — §15j |
| **§1d loses its safety premise** | *"the MCP filesystem has an allowlist"* is still true **on its own terms**, but it **no longer** stands as a containment argument: `Read`/`Glob`/`Bash` still go around it |
| **Containment today** | Only `guardedZone` remains (the key vault + config files). **There is no read fence.** Say this plainly, so nobody reads §1d and assumes there is one |
| **Upgrade path** | If we later want *"declaring a folder ⇒ genuinely confined to it,"* there are two paths: **arms and shell become mutually exclusive**, or **Docker** (§10, currently ⏸). Both are product decisions, not engineering tasks |

### 🚫 CLOSED 08/24 — not up for debate unless #1 is overturned

| | Why it's closed |
|---|---|
| ~~A deterministic path gate~~ | Wrong premise: it would also block `Bash`/`Read` from doing things they **legitimately can**. Silently blocking a real capability is the most expensive kind of failure |
| ~~Stating *"reaches no folder at all"*~~ (old #6) | Spends tokens on the most common case (a role with no arms) to buy very little |
| ~~Blocking the artifact on task failure~~ | Could throw away work that actually succeeded. An extra file is cheaper than a lost result |
| ~~Teaching the Assistant *"shell goes around the fence"*~~ (old #8) | **Closed because it was solved a different way**: not by adding another instruction (one already exists in `SHELL_LEGEND` and already lost the placement fight), but by changing **one word at the exact spot that lost**. → §15j |

### ❓ Still open

1. ~~**A READ fence: a hook, the MCP filesystem, or both?**~~ ✅ **ALREADY SETTLED above: NOT
   built.** Keeping this item only so a later reader sees it was answered, not forgotten. Old
   context: (§1d) ⚠ This question got **heavier, not lighter**, once the catalog was decided: the
   *"Files on the machine"* entry **is** an MCP filesystem with an allowlist. So the second half was
   settled indirectly — but **that alone still leaves a bare `Read` going around it**. Still has to
   be decided whether a hook gets built alongside it, or we're selling a lock for one door while the
   wall next to it stays open.
   > **Update 08/24 — the question NARROWED, not closed.** §5i built a hook for `mcp__*` and gave
   > arms a folder allowlist that **actually has teeth**. But it only guards `.state/` + config
   > files; **a bare `Read` still reads any absolute path on the machine**, exactly as before, and
   > `test/jail.test.ts` has a test locking down that exact current state so that the day someone
   > changes it, they have to see they're changing a decision. The remaining question, unchanged:
   > *should a GENERAL read fence be built.*
2. **If spike 2 shows MCP tools sit in the prefix** — does that reopen the `ToolSearch` decision?
   (§9b) Only reopen it with a **measurement**, never with an argument.
3. **Does Google go via path G1 or G2?** (§4e) Depends on spike 5. If G2, the Google tile **has to
   say** it needs a one-time ~10-minute setup, and can't sit displayed as an equal alongside the
   other two entries.
4. **Where does the provider whitelist live in the UI?** (§5e ③) It's a product decision, not a
   constant — but no screen has claimed it yet.
5. **`+ Connect` sits next to `+ Staff` — what happens to the "Connections" drawer from
   `SPEC-connectors` §6?** Leaning toward **dropping that drawer**: the canvas is already a list, so
   a drawer re-listing the same objects is **two places showing one truth** — exactly the "three
   stores" problem `Sidebar.tsx` avoids. Needs user confirmation.
6. 🚫 **CLOSED** — see the table above. Old context: (§15e) A role with `mcp: []` today only shows
   `[web · run commands: OFF]`, and the model **still describes them as if they had a folder** —
   measured at L2 of `spike-resume-roster`, both before and after the 08/24 patch. Same failure
   class as the "empty office" case already patched in `roster()`: when silent, the model fills the
   gap with something that sounds plausible. The fix leans toward **stating it explicitly**
   (`reaches no folder at all`), but it costs tokens on **every** role without an arm — i.e. the
   most common case. Needs measuring before deciding, not deciding by argument.
7. 🆕 **The Assistant apologizes for an error that ISN'T real.** (§15f) Case 03:43:01: it refused
   three turns in a row, **all three correct**, then once the connection was wired up it said
   *"sorry, I was wrong last turn."* The user learned something false about the system — and this
   is the most expensive failure class with non-coder customers, because what gets spent is trust.
   Same family as the *"I don't have permission to view this"* case in `route()` §8: **the model
   narrating the system to itself**. Not yet clear what the fix is: a prompt instruction is a
   signal, and there's no field here to build a gate on.
8. ✅ **RESOLVED — §15j.** No added instruction; changed one word at the exact spot that lost. Old
   context: (§15g) Today, no, and the consequence is measurable: the Assistant refuses a task staff
   **can actually do**. This is the flip side of #6 and more dangerous — *"not stating what's
   true"* ⇒ silently blocking a real capability. ⚠ The fix sits exactly where `shellFlag` already
   warned *"a broad negative framing is a lie"*: getting one word wrong flips it from **wrongly
   blocking** to **wrongly scaring**, and a wrongly scared user turns off something they needed.
9. 🆕 **`SPEC-tools-approval` §1a records file metadata (size) as EXCLUSIVE to `Bash` — wrong per
   the data.** (§15h) The builtin `Read` prints size when reading a PDF: `PDF file read: …
   (411.7KB)`, matching `Get-ChildItem` to within 0.1 KB. Scope needs re-measuring: which file types
   `Read` prints a size for, and whether `Glob`/`Grep` print anything. Until that measurement is
   done, **don't** fix §1a by argument.

---

## 15. ✅ SWAPPING CONNECTIONS MID-SESSION — the config gets there, **the Assistant's old line refuses to leave**

**Measured 08/24.** The user unplugged a connection and asked **the same question** again, three
times, getting back **the identical answer, character for character** — literal string
`D:\Downloads\Programs Installation` included. The user's own suspect: *"the cache-protection
mechanism doesn't add/remove in real time."*

### 15a. ✅ The cache is INNOCENT, and the cache itself is what proves it

`company/logs/usage.jsonl`, office `canh-tay`, four consecutive `route` turns:

| turn | time | `cache_read` | `cache_write` | reads as |
|---|---|---:|---:|---|
| 1 | 02:33:58 | 0 | 4,788 | fresh session after `/clear` |
| 2 | 02:34:13 | **0** | 6,298 | **prefix CHANGED** — the disconnect got there |
| 3 | 02:34:37 | **6,298** | 1,269 | prefix **IDENTICAL** to turn 2 |
| 4 | 02:41:19 | 0 | 8,978 | prefix changed again |

Turns 1→2 are **15 seconds** apart with `cache_read = 0` ⇒ the roster was rebuilt and the arm was
dropped from the prompt **the very next turn**. A cache can't expire in 15 seconds, and turns 2→3
(`cache_read = 6298`) prove the cache stayed alive intact across that window. **The two numbers
check each other.**

Turn 3 keeping the same prefix is **exactly as designed**: `reach()` only reads `role.mcp`. The
wire was already cut at turn 2, so "remove the arm from the office entirely" only touches
`office.yaml → arms` — no staff member is holding it any more, so the roster has nothing left to
change. For turn 4, `cache_read = 0` **can't be read as conclusive** (it's 6 minutes 42 seconds
after turn 3, past the TTL) — only the prefix-size jump (6,298 → 8,978) supports the
genuinely-changed hypothesis.

> ⚠ And the answer at turn 4 is **CORRECT**: `ho-tro.yaml`, written at 02:39:30, still records
> `a385afc3ab6` = `D:\Downloads\Programs Installation`. That folder really was still reachable.
> Only **turn 2** was wrong.

### 15b. ✅ Spike `scripts/spike-resume-roster.ts` — one measurement splits two suspects apart

This run separates *"the config never arrives"* from *"history stays anchored"* by asking **the
same intent, different wording**:

| | config sent | what the Assistant says |
|---|---|---|
| L1 · 2 arms | Musics · Programs Installation | asks about **both** ✅ |
| L2 · cut wire B, **ask identically** | Musics only | still implies B has a folder 🔴 |
| L3 · same config, **different wording** | Musics only | `task` → `D:\Fake\Musics`, **clean of B** ✅ |
| L4 · plug in C too | + Hoa Don | calls `D:\Fake\Hoa Don` directly, right next turn ✅ |
| L5 · control, fresh session | same as L4 | same as L4 ✅ |

⇒ **Add/remove IS real time, in both directions, even mid-session under `resume`.** What's broken
is the model quoting **its own** words back out of history — [[agentco-prompt-rules-lose-to-examples]]
one layer deeper: an example beats a rule, and this time the example is the model's own utterance.

### 15c. Why `resume` is NOT touched

`resume` **is** the feature, not an implementation detail — dropping it means the Assistant forgets
the conversation after every single message. The user's exit door already has a name: `/clear`.
Spreading risk into already-tested territory ranks only second.

### 15d. ✅ Patch, 08/24 — **three layers, and only the first two are recorded as guaranteed**

| layer | mechanism | deterministic? |
|---|---|---|
| **permission** | `pickMcp()` builds the server from `role.mcp`, read fresh every task | ✅ **yes**, already there, untouched |
| **wording** | `staleMentions()` — scans `say`/`request`/`question` for a label/folder belonging to an arm **nobody is connected to any more**; a hit triggers **exactly one** re-ask turn | ✅ **yes** |
| **hint** | `reachDiff()` — roster changed ⇒ inserts a **diff** into the next message | ❌ **a signal**, not a gate |

The permission layer has no weakness of its own — it just **sits downstream** of where the failure
happens: `pickMcp` runs once a task has already been handed off, while the wrong statement happens
at the `route` turn, before any worker exists to catch it. That's why a second layer exists at all,
not because the first one is weak.

**The wording gate's three conditions** (each closes a false-positive case worked out before the
code was written, and all three are covered in `test/stale-arm.test.ts` — 10 tests, 0 tokens):

1. That arm isn't in `role.mcp` for anyone currently on duty.
2. The string is **not** present in the message the user just typed — if they name it themselves
   and the Assistant answers *"nobody reaches that,"* that's **correct** behavior.
3. The string is **not** a substring of an arm that's still alive — unplugging `D:\X` while
   `D:\X\child` stays connected means mentioning `D:\X` isn't a false statement.

Plus a **4-character** floor: a label like `HS` shows up inside countless ordinary sentences, and a
gate that fires on every single chat turn is worse than one that misses a hit occasionally — this
is already the second layer of defense.

The hint line deliberately does **not** embed the hash: the user never reads it, and the more
unfamiliar the string the model sees, the more readily it invents a story to explain it. It also
only fires **when there's an actual session** — a fresh session's first turn has empty history, and
warning about a "previous statement" when there wasn't one is an open invitation for the model to
make one up.

## 15f. ✅ THE APPEARING/DISAPPEARING ASYMMETRY — the most memorable thing this round turned up

Three independent cases, measured 08/24, all the same shape:

| case | how the roster changed | what the model did |
|---|---|---|
| spike L4 · L5 | `Hoa Don` **added** | calls it by name directly **the very next turn**, every run |
| **real, 03:43:01** | `Musics` **connected** | **reverses its own THREE consecutive refusals**, no `/clear` needed |
| real, 02:34:13 | Installation **disconnected** | repeats the old answer verbatim, path included, even though it had vanished from the prompt |

> The 03:43:01 case is the most expensive one, and it nearly got read backwards. The user asked
> *"look at Musics,"* the Assistant refused **three turns in a row** — and **all three refusals
> were CORRECT**: `nguoi-soi-thu-muc.yaml` + `layout.json` weren't written until 03:43:01, meaning
> before that the Musics arm was a **node with no wire** (§6f). The user believed it was already
> connected; the system was telling the truth. The very next turn after the wire genuinely
> existed, the task ran (`P-260824-1043`, 03:44:05).
>
> ⚠ But then the Assistant said *"sorry, I got it wrong last turn"* — **factually false**, and it
> teaches the user that the system makes mistakes. Exactly what the rule *"never let the model
> narrate the system to the user"* exists to forbid. → §14 open question #7.

⇒ **The asymmetry lives in the SHAPE OF THE SIGNAL, not the cache, and not update speed.**
Literally [[agentco-deterministic-vs-signal]]: *absence is not a signal.* A line that **appears**
beats history; a line that **disappears** has nothing to beat with.

**So the fix changes the AXIS, not the volume.** The first version (morning of 08/24) just said
*"the roster just changed, re-read it above"* — an instruction, betting on the exact thing just
measured to be weak. The diff version states the change directly, so what disappeared becomes
**a line that appears**:

```
⚠ The roster just changed: + Musics → nguoi-soi-thu-muc · − Notion ✗ ho-tro.
  The staff list above is the CORRECT one — disregard anything you said earlier about who reaches what.
```

### 15g. ✅ THE DIFF FIRES CORRECTLY AND STILL GETS REFUSED — and the diff is NOT the culprit

**Real case, 08/24:** turned `Bash` on for `nguoi-soi-thu-muc`, then asked the identical question
again — *"list … inside D:\Downloads."* Still refused.

Session transcript `c95144e4`, turn `11:40:19Z`, **the insert line DID fire, with correct
content**:

```
⚠ The roster just changed: + run commands → nguoi-soi-thu-muc. The staff list above is the CORRECT one — …
```

And the next turn (`11:40:46Z`, *"go ahead and use a bash command"*) the model **does emit a
`task`**, with `request` = *"Use a system command (e.g. dir/ls) to list every subfolder, file, and
size…"*. ⇒ **It knows the shell exists and knows the shell can do this.** The diff mechanism isn't
broken.

**The culprit is a CONTENT hole in the capability line:** the roster lists an arm together with its
folder, plus `web`, plus `run commands: ON`. **No line states that shell and the builtins are NOT
confined to those folders.** So the Assistant reads the arm's folder list as **the staff member's
entire reach** — and refuses a task staff can actually do.

This is the FLIP side of §14 #6, and it's more dangerous: #6 is *"not stating what's ABSENT,"*
this case is *"not stating what's PRESENT"* ⇒ **silently blocking a real capability**, exactly the
direction `SPEC-arms` §7 warns about.

> ✅ **Confirmed the evening of 08/24, and it closes the "history is at fault" theory for good:**
> the user ran `/clear` + deleted the whole knowledge store, turned `Bash` on, and asked about
> `D:\Documents` from a **completely clean** session — **still refused**. ⇒ This is **not** history
> contamination. It's **system** behavior, reproducible from a clean state, produced by the exact
> content of the capability line. Which also makes it **cheap to re-check** after any patch: one
> fresh session, one question.

⚠ Not yet patched, deliberately: the fix sits exactly where `shellFlag` already warned *"a broad
negative framing is a lie"* — getting one word wrong flips it from wrongly blocking to **wrongly
scaring**. And deeper still: teaching the Assistant *"shell goes around the fence"* builds directly
on a premise §14 #1 **is in the process of removing**. Needs the user to decide. → §14 #8

## 15h. ✅ "MEASURED WITH WHAT" — the builtin `Read`, and it prints its own answer

**Real case `P-260824-1850-7u3q`:** asked for file sizes inside `D:\Works\Ho so ca nhan` — a folder
**no arm declares**. The artifact returned `411.7 · 425 · 171.7 KB`, checked against
`Get-ChildItem`: **an exact match on all three**. Numbers correct to within 0.1 KB aren't a model
guessing.

`scripts/spike-arm-outside.ts` separates the two hypotheses, reading the **raw `tool_result`**:

| | result |
|---|---|
| **A · arm** `list_allowed_directories` | `<office folder>` + `D:\Downloads\Programs Installation` ✅ |
| **A · arm** `get_file_info` on an outside file | **`Access denied - path outside allowed directories`** ✅ |
| **B · builtin** `Glob` `D:\Works\**` | lists freely, no fence |
| **B · builtin** `Read` a PDF file | **`PDF file read: …\CV.pdf (411.7KB)`** |

⇒ **The arm's allowlist is INTACT.** The size came from the **builtin `Read`**, which prints file
size along with a PDF read. Meaning §14 #1 is **wider than we'd recorded**: `Read` doesn't just get
*content* at any path — it also gets **size metadata**, which `SPEC-tools-approval` §1a currently
records as **exclusive to `Bash`**. A line needs correcting because the data says otherwise. → §14 #9

> ⚠⚠ **Two measurements broke back to back inside this very spike, and both produced a "complete
> conclusion":** ① forgot `additionalDirectories` ⇒ the allowlist only showed `cwd` ⇒ read as *"the
> allowlist is decorative"* — when in fact that's exactly what `worker.ts` §② **already patched as
> of 08/24**. ② the folder filter called `require()` inside an ESM module ⇒ **it threw, the `catch`
> swallowed it, every folder got dropped**, `additionalDirectories` came out `[]` with not a single
> error line. The second one is [[agentco-catch-hides-premises]] **sitting inside the measurement
> tool itself**. ⇒ [[agentco-measurement-vs-conclusion]]: the measurement tool has to be doubted
> just as much as the system it's measuring.

## 15i. 🔴 A FALSE ALARM — `folderRoots` reads the RUNTIME config instead of the DECLARED one

```
Warning: The arm for role "nguoi-soi-thu-muc" declares folder
"C:\Users\…\server-filesystem\dist\index.js" but it isn't found on this machine.
```

`pickMcp` runs `fastLaunch`, turning `{npx, args:['-y', <package>, <folder>]}` into
`{node, args:[<entry>.js, <folder>]}`. `armRoots` calls `folderRoots` on that
**already-transformed** config, and `folderRoots` only asks *"does this argument look like an
absolute path"* ⇒ it scoops up `…\dist\index.js` right along with it.

The behavior isn't wrong (`statSync` rejects the `.js` file exactly as before), but **a false
warning is what teaches a user to ignore warnings** — and then they ignore the one actually worth
reading. ✅ Fixed at the source: `armDirs` now reads from `office.company.mcpServers` filtered by
`role.mcp`. `fastLaunch` is an implementation detail; the folder is what the user **declared**; the
two must never get mixed up.

## 15j. ✅ THE PATCH FOR §15g — **change ONE WORD, at the spot that lost**, add no instruction at all

§15g diagnosed *"the prompt never states that shell/builtins aren't confined."* That diagnosis is
**half wrong**, and the wrong half is the important one: `SHELL_LEGEND` **already says it**, right
on the first line of the roster —

> *"Every staff member CAN open files on the user's machine by full path — read contents, list
> file names."*

The prompt **isn't missing the fact. That fact LOSES ON PLACEMENT.** The general statement sits at
the top of the block; the string that looks-like-a-boundary (`Musics (folder: D:\Downloads\Musics)`)
sits on **that staff member's own line** — and the line wins. This is
[[agentco-prompt-rules-lose-to-examples]] for the third time, and the `run commands: OFF` case
(`assistant.ts:1310`) already learned this exact lesson: *a flag has to sit on each individual line
for that line to carry its own information.*

⇒ **The patch adds no instruction at all** — one more would just be building a second statement
next to the one that just lost. It changes **one word, at the exact spot that lost**:

```
before: Musics (folder: D:\Downloads\Musics)          ← reads as a BOUNDARY
after:  Musics (shortcut to D:\Downloads\Musics)      ← reads as a SHORTCUT
```

Same token cost · no new rule to remember · matches exactly what the user just decided (*"the
folder is plugged in, not an onlyAllows"*). `test/plan.test.ts` locks both directions: `shortcut to`
must be present, **and** `folder:` must never come back.

⚠ **This word is a statement ABOUT THE MECHANISM, so it has to change when the mechanism changes.**
The day a read fence gets built, or arms and shell become mutually exclusive, `shortcut to` becomes
a lie and has to be changed back **in the same turn** — not "later."

⚠ **Not yet re-measured after the patch.** A cheap, deterministic way to check: a clean `/clear`
session, one question pointed at a folder outside every arm, a role with `run commands: ON`. §15g
already proved this case **reproduces from a clean state**, so this is a one-question test.

## 15k. ✅ MEASURED AFTER THE §15j PATCH — new wording runs, and it exposed a REAL LIMIT

**Case 20:01–20:13, a real session.** The `shortcut to` patch **works**, measurable directly in the
Assistant's wording:

- No more flat refusal. It says *"outside that scope I can only get the file name, not the size,"*
  then **asks whether to proceed** — exactly the semantics of a shortcut.
- It reuses that same word: *"staff only have access through 2 **shortcuts**…"*.
- Turn `Bash` on ⇒ done in one turn.

**But it exposed a real limit, and it is NOT a bug:** with shell **OFF**, *"list an arbitrary folder
outside the office"* is **not reliable**. The worker flails with `Glob` — `"*"` → `"D:/Downloads/*"`
→ `"."` → `"*/*"` — then hits the `max_turns` ceiling. Two failed turns, **9 turns · $0.2058** for
one request.

| | |
|---|---|
| `Read` on a path that's ALREADY KNOWN | ✅ works, even outside the office (§15h) |
| `Glob` listing a folder outside the office | ⚠ **hit or miss** — the model doesn't reliably find a way to point outward |
| With `Bash` | ✅ one turn |

⇒ This is a **property of the tool set**, not a fence and not a config bug. Don't patch it with an
instruction telling the worker how to call `Glob`: that's a signal, a permanent token cost, and it
resolves on its own once shell is turned on. The `max_turns` ceiling is doing **exactly its job** —
stopping early, with an explanation, instead of burning turns forever.

🔴 **But the Assistant misreports the system again, for the fourth time:** *"it looks like
D:\Downloads is outside my authorized scope… so even listing just the top level couldn't be done
within the allowed number of steps"* — conflating **running out of turns** with **lacking
permission** into one wrong story. → §14 #7, still no gate built for this.

✅ **A patch that rode along:** the log recorded `searching for "D:/Downloads/*" **inside the
office**` — wrong. `roomOf` only looks at `path`, while the model had stuffed the absolute path
into `pattern` instead. It now infers from **both**, and says `outside the office`. The log is the
only window a user has into where a staff member just touched their machine — the same rule that
made `Bash` print the full command line. 3 tests lock it down.

## 15f-bis. ✅ THE SHELL SWITCH RIDES THE SAME PATH (user's decision, 08/24)

A real case, same day, same failure class, a different switch: the user **turned `Bash` on** for a
staff member, then asked the exact same old question again. The Assistant answered *"I already
tried this before and it was blocked: the system only grants access to two subfolders…"*.

`roster()` **did** update correctly when the switch flipped — `shellFlag` sits right inside the
capability line. What was missing was the **diff**: the first version only snapshotted `role.mcp`,
so turning shell on/off produced no line at all, and history won out again.

⇒ `reachMap()` now snapshots **both**: arms + the `run commands` token. They ride the same path
because they fail the same way. ⚠ But it **only snapshots what CAN change**: `web` is also in the
capability line, on by default for everyone, with no switch — including it would be a token that
never diffs, i.e. pure noise.

**Three constraints, each blocking a different way this could fail** (test:
`test/stale-arm.test.ts`, 9 tests for `reachDiff`):

1. **A DELTA, not a changelog.** It only describes what changed since the last turn, inserted
   **once**, on the exact turn it happened. Rearranging the canvas 20 times ⇒ 20 lines scattered
   through the transcript: acceptable. Sending the same 20-line block back on **every** turn after
   that is not — that's exactly the kind of permanent bloat this whole project avoids.
2. **A 4-item cap** + `and N other changes`. One batch edit to the diagram can't stuff the whole
   wall of changes into the session.
3. **Trimmed down to a LABEL.** The roster right above already has the full folder path; the diff
   only exists to **point**, not to serve as a source. Pasting the exact path that was just removed
   back in is re-injecting, with our own hands, the very string we want it to stop mentioning.

> ⚠ **The roster remains the ONE AND ONLY source of truth.** The diff isn't a second source for the
> model to reconstruct state from a change string — the insert line itself says so (*"the list above
> is the CORRECT one"*). Adding a source to fix another source is how contradictions get created,
> not how they get resolved.

### Measurement — and it's BEHAVIOR, not a fence

The spike's L2 case (unplug, then ask the **exact same** old question again) — exactly the case
that broke in real life:

| version | what L2 says | n |
|---|---|---|
| unpatched | mentions `Programs Installation` **verbatim**, path included | 1/1 contaminated |
| generic reminder line | still implies that role *"manages the install folder"* | 1/1 contaminated |
| **diff** | **never mentions the removed arm, not once** | **3/3 clean** |

⚠ **n=3 proves a more trustworthy MECHANISM, it does NOT prove a guarantee.** The deterministic gate
is still `staleMentions()`; the diff just makes the escape case rarer.

⚠ **Something to keep watching, not yet conclusive:** 2/3 of the L2–L3 turns after the patch landed
in the `lookup` door instead of `task`. `lookup` with `paths: []` is **a web search** — it can't
read a local folder — and if the diff is pushing routing toward that door, that's a real cost. But
`route`'s variance was already high across all three versions (the unpatched version also produced
some `task` turns and some `ask` turns), so **there isn't enough data yet to assign causation.** A
separate measurement is needed, apart from this one.

## 15l. 🔴 THE GATE IS MISSING ONE NEEDLE — an OAuth arm gets mentioned by **ACCOUNT NAME** (a case that slipped through, 08/28)

The user disconnected the `hubot` account, and the Assistant still asked:

> *"Is this 'focus-flow' repo under the GitHub account octocat or hubot?"*

**The gate didn't fire, and it broke no rule.** Its needle is `label` = `"GitHub · hubot"`, and the
sentence above doesn't contain that exact string.

⇒ **An asymmetry between the two kinds of arms, and §15 grew out of the other kind so it never saw
this:**

| | Label | What people actually say |
|---|---|---|
| Folder | `D:\Downloads\Programs Installation` | **the whole label, intact** ⇒ the old needle hits |
| OAuth | `GitHub · hubot` | **`hubot` standing alone** ⇒ the old needle misses |

The third needle is `via` — **not a new field**: it looks up `arms[].secrets` against the OAuth
store, and it's already running in the "reuse" list (08/26) and on the diagram node (08/27). This
is a **third place carrying the same fact**, not a second mechanism. → [[agentco-count-mechanisms]]

⚠ The OAuth store is read **conditionally**: the gate runs on every Assistant turn, so with no
candidate to check against a removal, it never touches disk.

⚠ The §15e boundary **is unchanged**: it still catches the NAME, not a WAY OF TALKING AROUND IT.

### 15e. ⚠ THE BOUNDARY — ***NARROWED, NOT CLOSED***

The gate catches a **NAME**, not a **WAY OF TALKING AROUND IT**. L2 is a real escape case, **measured
both before and after the patch**: the model drops the folder name but still says *"the folder the
install inspector is in charge of"* — no string left to match against.

> 🔴 **Has to be stated at the right strength — this is the easiest spot to fool yourself:** rerunning
> the spike with the FIRST version of the hint (one generic reminder line) **doesn't prove it
> worked** — L2 still escaped identically. The **diff** version got 3/3 clean (§15f), but that's
> still **behavior**, not a fence. The only thing proven by a **deterministic test** is the wording
> gate.
> ⇒ [[agentco-measurement-vs-conclusion]]: the mechanism is measurable; the conclusion isn't.

The remaining escape case has a fixed shape and belongs patched somewhere else: **a role with
`mcp: []` still gets described by the model as if it had a folder**. `reach()` today says nothing
about *not* having one — and when it's silent, the model fills the gap, the same failure class as
§7 and the "empty office" case in `roster()`. Recorded in §14's open questions.

**What the patch does NOT change:** the worst-case consequence of the gate being escaped is still
**not** an unauthorized MCP call — the permission layer blocks that deterministically. It's a
pointless question, or a task that falls through to a bare `Read` (§14 open question #1, already
known since 08/22 — **not a new hole from this spike**).

---

## 16. SELF-BUILT ARMS — REST and CLI under **ONE** declaration (discussed 08/30)

> **This whole section's label:** part 16a is a **08/30 code read** (verifiable by eye, **not yet
> run**) — it isn't ✅ and it isn't 📖, so it's marked plainly as *"code read."* From 16b onward it's
> **design not yet built**, and the three boxes still open for the user to decide are marked ⛔.

### 16a. Path B (paste JSON) — **already built**, and three holes **verifiable but nobody has run them**

The user's 08/30 question: *"the method where you paste an MCP server's json block in — is that
actually in practice yet?"*

**Built, never tested once.** Reading the code:

| Piece | Where | What it does |
|---|---|---|
| the **Self-plug MCP** tab | `ArmDialog.tsx:1443-1447` | step 1 → the `paste` pane |
| `parsePaste()` | `ArmDialog.tsx:1170-1186` | accepts **both** shapes: the `{"mcpServers":{…}}` block copied straight from a README, **and** a bare config. Derives the label from the server's own name |
| `pastedKeys()` | `ArmDialog.tsx:1156-1163` | scans for `${NAME}` inside the pasted block → **generates exactly those key input fields** |
| where the key name comes from | `server.ts §resolveArm` (comment at 245-248) | the key name is taken from **the blank in the config**, *not* from `Object.keys(body.secrets)` — because `secretNames` goes straight into the **HASH** |
| where it's stored | `company.yaml → mcpServers:` | ✅ 8 real entries currently exist in `company/company.yaml` |
| test coverage | **none** | `TEST-WALKTHROUGH` only mentions this path as a **side step** of walkthrough 13 (B6) and 17 (step 11). No walkthrough measures it directly |

⇒ Exactly the [[agentco-spec-says-done]] failure class: *"the spec says it's done"* isn't evidence —
but here it goes even further, **the code exists too** and still nobody has run it. Walkthrough 20
exists to close exactly that gap.

#### 🔴 Three holes, ranked by severity, and the third is a security hole

The user's question: *"if that custom MCP thing needs a key like Notion does, is that key already
inside that json?"* — **the JSON has the SLOT, not the KEY.** And in the real world that slot takes
**three** shapes, and we've only handled **one**:

> ## 🔴🔴 ACTUALLY RUN 08/31 (user, walkthrough 20 chapter B) — **case ① IS ALSO BROKEN**, and broken the worst possible way
>
> The table written 08/30 marked case ① 🟢. **Wrong.** It's only 🟢 for HTTP's `headers`.
>
> The user pasted the exact README block, the UI **generated the correct field** `MEMORY_PATH`,
> filled in `abcde` → and still got:
>
> ```
> Missing key: MEMORY_PATH. No request has been sent yet — …
> ```
>
> *"No matter how many times you retry."* — **an infinite loop, and the error message is accusing
> the exact field the user JUST FILLED IN.**
>
> ### Cause: two functions ride the same path but look at TWO DIFFERENT scopes
>
> | | Scope |
> |---|---|
> | `missingSecretRefs` — **detects** | **the whole config** (`JSON.stringify`) |
> | `injectSecrets` — **fills** | only HTTP's `headers`. The stdio branch **never replaced the blank at all** — it only **merges the key into `env` BY NAME** |
>
> ⇒ Every blank sitting **outside `headers`** gets detected forever, and never gets filled.
>
> **Why it sat unnoticed until today:** merge-by-name is correct for the **catalog** (a server that
> reads `process.env.NOTION_TOKEN` directly), and **no stdio catalog entry has an `env`** (`files`,
> `browser` — neither does). A blank inside `env` only ever shows up through **path B** — the one
> path the catalog can't shield against. ⇒ Same family as [[agentco-debt-hidden-by-model-priors]]:
> the hole is invisible until a new shape of data shows up.
>
> ⚠ And `missingSecretRefs`'s own comment **correctly predicted this exact day** — *"a function that
> only looks at `headers` will be correct right up until the day someone writes
> `url: 'https://${HOST}/mcp'`."* It only got the **location** wrong: stdio's `env` got there first.
>
> ### ✅ PATCHED 08/31 — `secrets.ts §fillRefs`
>
> One pass that replaces blanks **recursively across the whole config**, used by **both** branches;
> stdio keeps its merge-by-name half (replace first, merge after). HTTP keeps its header-string
> half unchanged.
>
> > **INVARIANT THAT MUST HOLD: the FILL function's scope = the CHECK function's scope.** Any drift
> > produces a blank nobody can fill. A test guards this.
>
> ⚠ `fillRefs` **only descends into plain objects** — a `type:'sdk'` config carrying an `instance`
> that's a live `McpServer` would get a dead clone rebuilt if recursed into.
>
> **Re-measured with the user's actual config** (a real `probeArm`, $0):
> `status=connected · 9 tools · 6,493 ms` · `missingSecretRefs` after filling = `[]`.
> Tests **731/731 green** (+4, including one test locking down the invariant above).

| # | What a real-world README writes | What we do today | |
|---|---|---|---|
| ① | `"env": {"NOTION_TOKEN": "${NOTION_TOKEN}"}` | scans for the blank → generates a field → key goes into `secrets.json` | 🟢 **after the 08/31 patch** (before: 🔴 correct only for HTTP) |
| ② | `"env": {"NOTION_TOKEN": ""}` or `"<your-token-here>"` | **doesn't match `${…}` ⇒ generates no field at all** ⇒ paste it, hit Try, 401, **dead end** | 🔴 dead end |
| ③ | `"headers": {"Authorization": "Bearer ntn_abc123"}` | the user swaps in the **real** token and hits Save ⇒ **the token goes straight into `company.yaml`** | 🔴🔴 |

#### 🔴 CORRECTION, 08/30 — the "because it's on git" reasoning is **WRONG**. The user caught it, and the user is right.

> *"a token in company.yaml is normal, no big deal, it's the customer's own data, the customer looks
> after it themselves? (exactly like a .env file)"* · *"just don't save it to browser
> state/storage — anything saved into the company's own data is fine."*

**Went and checked `.gitignore` (08/30): `/company/` IS ALREADY IGNORED.** Only
`templates/company/` gets committed. The claim *"`company/` is designed to be committed to git"* in
`SPEC-connectors §3c` **doesn't hold for this repo**. ⇒ The git-based reasoning **is removed from
the argument**. The `company/` store is the customer's own data, exactly as the user said, and
where a key sits inside it is the customer's business.

**The correct rule, restated in the user's own words, and it's considerably NARROWER:**

> **A key's value must never leave the server.** It doesn't travel over HTTP, doesn't reach the
> browser, doesn't reach a prompt. Where it lives **on the customer's own disk** is the customer's
> business.

And that rule — the **user's own** rule — is exactly what case ③ breaks. Two reasons, both
measurable in code, neither one a git question:

**① `config` TRAVELS OVER HTTP TO THE BROWSER.** `company.ts §arms()`, line 860, returns the raw
`config` inside the arm list. And right in the field sitting next to it,
`web/src/lib/types.ts:545-551` **declares the opposite invariant itself**:

```ts
config: unknown;
/** Key NAMES, never values. Values live in company-level `.state/secrets.json`
 *  and never travel over HTTP … */
secrets: string[];
```

The key is a literal inside `config` ⇒ it flies to the browser **every time the Connect dialog is
opened** — into tab memory, into the DevTools Network tab, into anything that can read that
response. Exactly what the user just said is **not allowed**. `company.ts:899-900` already declares
this same invariant correctly for `reuseArm` (*"must NEVER leak into an HTTP response"*) — it just
guards the `secrets` field, not the `config` field.

**② `config` GOES INTO THE HASH.** `catalog.ts §armHash(config, secretNames, level)` — **the key
value sits inside the hash seed**. Consequence: **rotating the key = a DIFFERENT arm**. Every
`role.mcp` still points at the old hash ⇒ **the whole wire silently snaps**, and the old arm (with a
dead key) stays sitting right there on the diagram.

With `${NAME}`: the config **stays put**, only the value in `secrets.json` changes ⇒ rotating the
key is **invisible to the diagram**. `secrets.ts:111` had already recorded exactly this case before
(*"user pasted an access token by hand into `NOTION_ACCESS_TOKEN` on…"*).

> ⇒ **It's not "keys are forbidden in the yaml." It's "a key must go through the `${…}` slot"** —
> because that slot is what keeps the key out of HTTP **and** out of the hash. One mechanism, two
> invariants. [[agentco-count-mechanisms]]
>
> `SPEC-connectors §3c` needs to be rewritten: drop the *"because `company/` gets committed to git"*
> clause, keep the *"only write the variable name"* clause, and record the real reason as the two
> bullets above.

⚠ And it **doesn't** surface on its own: paste a real token in ⇒ the arm **works fine**, ✓ green.
The failure only shows up on the day the key rotates, and by then the symptom is *"the staff member
suddenly lost their connection"* — weeks away from the cause.

And while `SPEC-connectors.md §3c` was written on 08/14 (*"the UI must refuse to save if it detects
a string that looks like a token"*), the **enforcement** for that only exists in **exactly one
place**: `oauth-routes.ts:475`, for the `client_id` field. The MCP paste path **has no check at
all**. The rule exists, the gate doesn't.
⇒ [[agentco-rule-must-see-what-it-governs]]

### 16b. Form or paste? — the user is right, but for a stronger reason than the one they gave

User: *"instead of pasting json, show a form to fill in → but that approach isn't practical, it
takes a while, and there are formats we don't control."*

The second half is the real reason, and it's bigger than the first. **A form is a snapshot of
someone else's schema.** The shape of `McpServerConfig` isn't ours: `command/args/env` for stdio,
`type/url/headers` for HTTP, and it **has already changed once** (`sse` → Streamable HTTP, §2a).
Building a form is signing exactly the **COMMITMENT** §4b warns against — every field is a thing
that silently breaks on the customer's machine the day the other side changes it.

Pasting means **fidelity doesn't decay over time**: the vendor's README is always the latest
version.

> **Settled rule: PASTE what someone else wrote · FILL IN what only we know.**
> Config = pasted (nobody but the vendor knows whether it's correct). Keys = generated fields
> (nobody but the user knows the value). **Never mix the two kinds into one field.**

And today's build **already stands exactly there** — `pastedKeys()` is precisely the second half. It
just isn't wide enough yet (holes ② and ③ above).

### 16c. The user's real question, split into two — and the two have two different answers

User: *"we're going to add another service — building a local custom MCP… but how can it match the
streamable HTTP standard for mcp?"*

Two questions collapsed into one:

| | Question | Answer |
|---|---|---|
| ① | **Who runs the process?** | we do — this is the new part, and it's correct |
| ② | **What wire protocol do they talk over?** | ❗ **not HTTP by default** |

📖 The SDK accepts **four** shapes (§2b), and the fourth is the one being overlooked here:

```ts
McpSdkServerConfigWithInstance   // { type:'sdk', name, instance }  ← runs INSIDE our own process
```

`SPEC-tools-approval §10a` had already settled on this shape back on 08/14 (*"the runtime composes
an in-process MCP using `createSdkMcpServer` + `tool()`"*). Reading the code on 08/30:
**`createSdkMcpServer` doesn't appear anywhere in `src/`** — path C has zero lines written.

**Why `sdk` beats HTTP as the default case**, and all five reasons are things already paid for
elsewhere:

| | `type:'sdk'` in-process | local HTTP shim |
|---|---|---|
| Port | 0 | must be chosen, must avoid clashes, must be remembered |
| **Who can call it** | only our own process | **any process on the machine** ⇒ requires building an entire extra key layer just for localhost |
| Customer's key | never leaves the process | travels over a socket |
| Three operating systems | identical | Windows prompts for the firewall, macOS prompts for network permission — [[agentco-three-os-always]] |
| Lifecycle | tied to the daemon | one more thing that can die on its own, and die **silently** (§bug 08/29: an MCP dying at spawn time raises no alarm) |

⚠ **The second row isn't a detail.** An HTTP MCP not keyed to `127.0.0.1` is a **back door that
routes around the entirety of §5d–§5f**: we went to the trouble of forbidding a staff member from
reading keys and writing config files, then opened a port that *any process at all* — including that
same staff member's own `Bash` — can call directly.

#### ⇒ The dividing line isn't preference. It's **where the binary lives**

| Case | Wire | Why |
|---|---|---|
| Customer's REST (cloud) | **`sdk`** | we're just an HTTP client, nothing to spawn |
| CLI **co-located** with the daemon (desktop app · VPS) | **`sdk`** + `spawn` argv | 0 ports, 0 extra keys |
| CLI **outside** the container (daemon in docker, `gh`/`psql`/a build script on the host) | **Streamable HTTP** to a shim running on the host | **the ONLY case that forces HTTP** — there is no other path |

And this is exactly what §10b already warned about: *"Docker breaks the firewall's premise from
§1b."* The third case isn't an added feature — it's a **consequence of Docker**, and it's also the
only case that has to pay for a localhost key layer.

> **Settled shape: ONE declaration, TWO ways to serve it.** Same yaml file, same command table;
> `sdk` is the default, `--serve` turns on an additional HTTP door for the docker case. Don't invent
> two concepts — same rule already used for the catalog (*"one catalog entry = path B with a
> pre-filled form"*, §5h·1).

### 16d. REST and CLI are the **same** declaration, differing by exactly one line

`company/connectors/<id>.yaml` from `SPEC-connectors §3` already has room for this. Add `run:`
alongside `method/path`:

```yaml
id: xuong-build
display_name: "Build shop"
description: "Runs build and deploy for the web project"

actions:
  # ── REST: exactly as in SPEC-connectors §3
  - id: list_invoices
    say: "view the list of invoices"
    method: GET
    path: /invoices

  # ── CLI: differs by exactly one field
  - id: deploy_staging
    say: "deploy to staging"
    run: ["pnpm", "deploy", "--env", "staging", "--tag", "{tag}"]   # ⚠ ARGV, not a string
    params:
      - { name: tag, type: string, required: true, pattern: "^[a-z0-9.-]+$" }
    cwd: "{office}/repo"          # we resolve this, the model never touches it
    read_only: false
    confirm: true
    long: true                    # → produces a TRIPLET, see 16g
    returns: "URL of the version just deployed"
```

Everything else is **reused as-is**: one action = one tool · `confirm` on by default for writes ·
`say` is a plain-language sentence · `returns` is generated from the Try step · a key is just a
**variable name** · logging goes into `audit.ts`.

### 16e. 🔴 ARGV, NOT A SHELL STRING — the load-bearing rule of this whole section

Three reasons, and the third reason **overturns a sentence from this very spec**:

1. **Parameters are model-generated.** A shell string + a model-generated value = command injection,
   not a theoretical risk. With `argv`, `; rm -rf /` is just a string of characters inside one
   element.
2. **The three OSes quote differently.** [[agentco-three-os-always]] — the sixth time. Going through
   a shell when it isn't necessary is voluntarily signing up for the exact "works on my dev machine"
   failure class.
3. ⭐ **It PRODUCES the named field** that §1b, reason 3, says a shell doesn't have.

> **§1b needs a correction, not a contradiction.** §1b wrote:
> *"A shell command mixes paths in among a string. Wrapping it in MCP doesn't produce that field."*
>
> **True for `Bash` in general. False for a DECLARED command.** The difference: with `Bash`, we
> receive back a string and have to parse the shell syntax of three OSes to find the path. In a
> declared action, **the user has already stated in advance which spot is which parameter** — that
> field isn't inferred, it's **declared**. `officeJail` can match `params.path` exactly the way it
> matches `file_path`.
>
> ⇒ **Don't wrap `Bash`. Wrap `gh pr create --title <T>`.** §1b's four reasons still stand for the
> first half; this section is only saying the second half is a different thing.

**Two sub-rules, each blocking a known failure mode:**

- **A value must never turn into a FLAG.** `tag = "--force"` concatenated into argv is the user
  handing over a flag they never declared. Default: **reject values starting with `-`**; anyone who
  wants otherwise declares `allow_dash: true` explicitly. Same shape as `confirm`'s "can be turned
  off, but only deliberately."
- **Keys go into `env`, NOT argv.** argv is readable from another process on **all three** OSes
  (`ps -ef` · Task Manager's Command line column · `/proc/<pid>/cmdline`). A `--token=ntn_…` exposes
  the key to everything running on the machine. This is a technical reason, not a slogan.

### 16f. Four things CLI DOESN'T have that MCP requires — and who declares them

| | MCP requires | Does CLI have it? | Who declares it |
|---|---|---|---|
| parameter schema | ✅ mandatory | ❌ | the user, at build time |
| **success/failure** | ✅ `isError` | ⚠ *half* | default `exit ≠ 0`, **plus `fail_when:`** |
| **permission level** | `annotations` | ❌ entirely | ⛔ see below — needs the user to decide |
| return-value size | unbounded | ❌ | 4,000-token cap, over that ⇒ an artifact |

**The second row is a trap that's already been paid for once.** `exit 0` does **not** mean success:
plenty of CLIs print an error to stdout and still return 0. Same failure class as `postToken()`
§5h·7d — ***HTTP 200 with an `error`***, three errors stacked on top of each other, all three
invisible to Notion and all three exploding against GitHub. Here it would explode in the **worse**
direction: the agent believes the command finished and **moves on**. ⇒ `fail_when:` (a string/regex
over stdout+stderr) must be present from the first version, not "added later."

**The third row is something I have to ask about, not decide myself** ⛔:

§6j's rule runs one direction: *"unknown ⇒ escalate, never de-escalate."* Applied directly to CLI,
**every CLI command lands at the full-permission tier** — even `git status`. The tier system loses
all meaning.

But that rule exists to guard against **THIRD-PARTY testimony** ([[agentco-safe-default-direction]]:
*"third-party testimony only ever escalates"*). Here the one declaring it is **the machine's owner,
declaring something about their own machine** — that's not *testimony*, it's a **decision**. Same
category as them turning on `allow_private_network` or turning off `confirm` themselves.

> **Proposal (not yet settled):** offer a `read_only: true` checkbox **set by the user**, and say so
> plainly next to the checkbox — *"You are taking responsibility for this claim yourself. If the
> command writes something, agentco will not block it."* If that feels too permissive, the other
> branch is to **drop tiers for CLI arms entirely**, showing exactly one line: *"this arm runs
> commands on your machine"* — more honest than three fake tiers.

### 16g. *"CLI is one-way, fire-and-forget"* — reframing it, because it decides what to build

The user's gut feeling is right, but *"one-way"* isn't quite it: CLI **does** have a return channel
(exit code + stdout/stderr). It's genuinely missing three things, and only **one** of the three is
something no library gives you for free:

1. **No schema** → the agent makes up flags. Fixed by 16d–16e.
2. **No identity** → can't log who ran it, can't attribute it to a role, can't revoke it. Wrapping it
   as an MCP node is the fix (§1a: *anything with an identity is a node*).
3. ⭐ **No IN-PROGRESS state.** This is the real *"fire-and-forget,"* and it's the genuinely expensive
   part.

A command that runs for 40 minutes (build · deploy · train · `docker compose up`): `Bash` either
**blocks the whole turn**, or gets cut off, and the agent has nothing to ask about. **This is exactly
where MCP beats CLI with no real counterargument** — not because it's "more standard," but because
it offers **multiple calls for the same job**.

**Shape: `long: true` produces a TRIPLET, not a single tool.**

```
start(tag)          → { job: "j-7f3" }                    returns IMMEDIATELY
status(job)         → { state: "running", last 12 lines }  agent asks when it needs to
read_result(job)     → artifact path + summary             once done
```

And the run funnels into a **job with an id + artifact** — meaning it **slots directly into the
existing `receipt` + `artifacts`**, no new concept invented. The user's line — *"so the worker stays
aware of progress instead of fire-and-forget with no accountability"* — is enforced right here.

⚠ **Its cost:** 3 tool definitions in the prefix **every turn**, even a turn that doesn't use it.
⇒ **only a command declaring `long: true`** produces the triplet; a normal command still costs
exactly 1 tool.

### 16h. Token cost is the dominant constraint — and it kills two ideas that sound very reasonable

Measurements already exist, no need to re-measure: filesystem **14 tools = 2,185 tokens/turn** (§9b)
· GitHub `full` ≈ **30,000** · Linear `full` = **19,811**. MCP tools live in the **prefix, every
turn**.

**⇒ Dead idea #1: "auto-generate an MCP from `--help`."** `docker --help` yields ~40 subcommands = an
arm carrying ~6,000 standing tokens for a role that only needs `docker ps`. On top of that: `--help`
**has no schema**, differs between versions, and a bad parse fails **silently** — the agent calls a
flag that doesn't exist and gets back an error message it can't interpret.

**⇒ Dead idea #2: "just wrap the whole CLI for convenience."** A CLI arm should be **3–8 commands**.
Same discipline that already forced GitHub to trim its toolset (§5h·7e: *"a slice is a CONDITION OF
EXISTENCE"*).

**The right path is a CLI version of "Copy as cURL":** the user **pastes one command line THEY HAVE
ALREADY RUN SUCCESSFULLY**, and we extract the argv and ask *"which part changes each time?"*. They
don't **write** anything — they **copy**, exactly why cURL is the primary path in
`SPEC-tools-approval §10a`.

### 16i. 🔴🔴 THE MOST DANGEROUS SPOT IN THE WHOLE FEATURE — said loudly, because it's invisible

**A CLI arm is a DELIBERATE hole in the shell firewall.** A role with `run commands: OFF` can still
run a binary through it. That's **exactly the intent** — but it carries a constraint that must never
be forgotten:

> **The action-declaration file MUST live in the READ-ONLY zone of `officeJail`.**
>
> §5f built two zones for exactly this reason: a staff member who **can write** the config file ⇒
> grants themselves `tools` / `secrets` / `mcp`. Here the consequence is a notch worse: writing to
> `connectors/*.yaml` ⇒ declaring their own action with `run: ["powershell","-c","{cmd}"]` ⇒
> **arbitrary shell, through a back door, for a role that had shell turned off**. Same hole, new
> door, and we've already paid for this lesson once.

Three rules that come with it:
- `cwd` is resolved **by us**, always inside the office. Never accept `cwd` from a model-generated
  parameter.
- The Try step of a CLI action **actually runs a real process** ⇒ this must be stated plainly in the
  UI before clicking, and it must never be clicked on the user's behalf.
- Every call goes into `audit.ts` along with the **resolved argv** — this is also the only thing
  that lets us answer *"which staff member just ran what"* after the fact.

### 16j. *"Is MCP the only protocol for working with agents?"* — no, and the real axis is something else

User: *"is MCP really the only protocol for working with agents? — it fixes every weakness of no
REST, no CLI."*

True at the **interface** layer, false at the **economics** layer. The deciding axis isn't *"is it
MCP or not"* but ***"does the agent need a return value RIGHT WITHIN THE TURN to decide its next
step?"***

| Task | Right door | Cost |
|---|---|---|
| needs a value to decide the next step (`check inventory` → only then know what to write) | **MCP tool** | tool definition, **every turn** |
| long-running, result is a file, agent only needs to know done/not-done | **job + artifact**, MCP is just 3 thin tools (16g) | 3 definitions |
| deterministic, agent **has nothing to decide** (run lint every morning, sync a folder) | **don't let the agent call it at all** — a scheduler/hook runs it directly | **0** |

The third door is 100% cheaper than the other two, and it's the one most easily forgotten while
excited about MCP.
⇒ [[agentco-count-mechanisms]]: every added tool is a mechanism that must be fed **every turn**, even
a turn where nobody uses it.

### 16k. Build order — and three ⛔ boxes the user needs to settle before any code gets written

| Tier | Content | Why it comes first |
|---|---|---|
| **0** | **Run test 20** — measure path B as it stands today | cheapest, and it might expose holes we don't know about yet |
| **0b** | Patch holes ② and ③ from 16a | ③ is a security hole, and the rule has existed since 08/14 |
| **1** | `createSdkMcpServer` + REST (path C, test 21) | lowest risk — nothing spawned, no port opened |
| **2** | CLI `sdk` in-process, short commands (test 22, legs A–C) | same skeleton as tier 1, plus `spawn` argv |
| **3** | `long: true` job triplet (test 22, leg D) | needs artifact + receipt, both already exist |
| **4** | HTTP shim for the docker case | **only once** a real docker case exists, and it must come with the localhost key layer |

### ✅ THREE BOXES SETTLED — user, 08/30

| # | Decision | Consequence that must be carried through |
|---|---|---|
| 1 | **DROP TIERS ENTIRELY for CLI arms. Full permission.** *"do exactly what's in the instruction sheet"* | Exactly two gates remain, and they must be **solid**: **who's allowed to wire it up** + **`confirm` on each action**. Plus `audit.ts`. No third tier to fall back on. → 16l |
| 2 | **Docker: not built yet, but the code must BE READY** — *"so bringing docker online is very light, without tearing everything down and rebuilding"* | Six architectural constraints, must be followed from the very first line of code. → 16o |
| 3 | **`fail_when:` GOES INTO THE FIRST VERSION** | Nothing else |

---

## 16l. The instruction sheet — **TWO sheets, not one**, and only one of them is nondeterministic

The user asked the sharpest question of the session:

> *"Is the instruction-sheet problem deterministic or nondeterministic (I lean toward
> nondeterministic, since MCP is nondeterministic too)"*

**The instinct is right, but "MCP is nondeterministic" is only half true — and the other half is the
half that makes it usable.** An MCP tool always has **exactly two** parts:

| Part | Kind | Who reads it | What it is in our CLI |
|---|---|---|---|
| `description` | **nondeterministic** — prose | **the model** | 📄 **the instruction sheet** — the user is right |
| `inputSchema` | **deterministic** — JSON Schema | **the runtime**, validated before the call | 📋 **the declaration** — argv · params · types · `cwd` · `timeout` · `fail_when` |

> **Drop the declaration = go back to `Bash`.** Because then the model has to build the command line
> itself out of prose again — that is, **guess**, which is exactly the weakness the user just pointed
> out. The declaration isn't bureaucracy; it's **exactly** what turns "guessing" into "filling in a
> blank."

⇒ **Settled: the instruction sheet is nondeterministic, the declaration is deterministic, and they
live in the SAME file.** After dropping tiers (box ①), the instruction sheet takes on extra work: it
becomes the **only** place that tells the model how dangerous this command is. So it must state
**consequences**, not just purpose:

```yaml
- id: deploy_staging
  say: "deploy to staging"
  # 📄 INSTRUCTION SHEET — model reads this. Nondeterministic.
  description: |
    Pushes the current branch to the staging environment. Takes 4–7 minutes.
    ⚠ Overwrites what's currently running on staging — no rollback step.
    Do not use for production.
  # 📋 DECLARATION — runtime reads this. Deterministic.
  run: ["pnpm", "deploy", "--env", "staging", "--tag", "{tag}"]
  params: [{ name: tag, type: string, required: true, pattern: "^[a-z0-9.-]+$" }]
  cwd: "{office}/repo"
  timeout: 900
  fail_when: ["ERROR", "FAILED"]
  confirm: true
```

---

## 16m. *"filesystem/Bash is already MCP too"* — true, and the user's axis is **better than the one I was using**

> *"isn't MCP filesystem/bash already a form of MCP too, the only difference being the LLM guesses on
> its own, while CLI has clear instructions?"*

**The GUESS ↔ DECLARE axis is the right one**, and it's more general than the "argv vs shell string"
pair I used in 16e — argv is just the **enforcement mechanism** of that axis. Laying all four kinds
of arm out along one axis:

| | who decides **WHAT TO DO** | who decides **WITH WHICH PARAMETERS** | how much guessing |
|---|---|---|---|
| `Bash` *(not MCP, but the same shape)* | the model | the model — **the whole command line is ONE string** | maximum |
| MCP filesystem | the model, choosing among **14 declared tools** | the model, filling params **with a schema** | moderate: *which path* |
| **Declared CLI** | **the user** — argv already fixed in place | the model, filling in **only the declared blanks** | minimal |
| REST connector | **the user** — one action, one endpoint | the model, filling in params | minimal |

⇒ The bottom three rows are **already the same category**. So the user's claim that *"reducing
everything to MCP makes it easier to control"* **isn't a simplification — it's an accurate
description of what already exists.** `Bash` is the sole exception, and it's an exception **for a
reason** (§1b's four reasons still stand).

> **Correcting §1c's statement for accuracy:** it's not *"MCP is the wire format for whatever the
> user adds"* but **"MCP is the wire format for every DECLARED capability."** `Bash` stands outside
> not because it's a builtin, but because **it deliberately declares nothing** — that's exactly its
> purpose.

---

## 16n. ⭐ *"a process runs for 6-7 minutes, streams back to the worker"* — separating out where the stream ENDS

> *"CLI is usually a single process, and it might take 6-7 minutes to finish, right? Regardless of
> what shape the arm takes, it's still the process sending a stream back to the worker"*

This constraint is real, but the phrase *"back to the worker"* conflates **two entirely different
destinations**, and MCP can only reach one of them:

| Where the stream goes | Possible? | Mechanism |
|---|---|---|
| **our own daemon** | ✅ **always possible**, and **doesn't need MCP** | we own the child process: read `stdout`/`stderr` line by line, write into the job's log, push to the UI **live** |
| **the model's context, MID a tool call** | ❌ **no mechanism exists** | `tools/call` is a request → **one** response. MCP has `notifications/progress`, but it goes to the **client**, and cannot be inserted into context. ❓ Whether the SDK even exposes it — **nobody has measured yet** |

**The consequence, and it dissolves the tension instead of dodging it:**

> **The model does NOT need to see the stream.** It can't do anything with log line #300 — and every
> turn it spends reading is a turn that costs money. What the model actually needs is exactly three
> pieces: **done or not · succeeded or failed · where's the result**.
> It's the **USER** who needs the stream, and that stream goes **straight to the UI**, never through
> the model.

⇒ The requirement that *"the worker stays aware of progress instead of fire-and-forget"* is fully
satisfied **without** the model ever reading the stream.

### Two shapes, and one measurement decides between them

| | ① **a tool that blocks until done** | ② **the triplet** `start`/`status`/`read_result` |
|---|---|---|
| Tools in the prefix | **1** | **3** |
| The model | sits and waits, costs no turns | costs a turn for each check-in |
| UI | still sees the live stream *(held by the daemon)* | same |
| Where it dies | **the time cap on a single `tools/call`** | no cap |
| Agent does other work while waiting | ❌ | ✅ |

> ❓ **THE BLOCKING MEASUREMENT, MUST BE DONE BEFORE WRITING CODE:** **how long is a single
> `tools/call` allowed to run** before the SDK/CLI cuts it off? 📖 `McpStdioServerConfig` has
> `timeout?` — but **nobody yet knows** whether it's the *server startup* timeout or a *single call*
> timeout. Reading the `.d.ts` isn't enough (📖 ≠ ✅, and `canUseTool` already taught that lesson).
>
> **Spike:** a minimal `sdk` MCP, one `sleep(n)` tool, run n = 60 · 300 · 420 · 900 seconds, see
> where it breaks and **what error message it breaks with**.
>
> - If the cap is **≥ 10 minutes** ⇒ **go with ①** for v1. It's exactly 2 tools/turn cheaper than ②,
>   and most real CLI commands finish under 7 minutes. ② only opens up for `long: true` once a real
>   case exceeds the cap.
> - If the cap is **< 7 minutes** ⇒ ② becomes mandatory, and the `long:` field is no longer optional.
>
> ⚠ **Don't build ② before measuring.** Building the triplet for a cap that may not exist is paying
> 2 tools/turn forever for a problem nobody has yet proven exists. [[agentco-measurement-vs-conclusion]]

**Whichever branch this lands on, these two things are identical either way and can be built right
now:** ① the child process spills `stdout`/`stderr` into **the job's log inside the office folder**
(an artifact, with a path) · ② the UI reads that log live. They **don't depend** on the measurement's
outcome — build them first, and they're the part the user actually sees.

---

## 16o. *"Does the customer's CLI meet the standard"* — we do NOT check, and don't need to

> *"how do we know the CLI the customer wrote meets the stdio standard well enough for the worker to
> use it conveniently?"*

**There's no way to know in advance, and that's not our job.** The way out is the same path already
settled for cURL (§10b `SPEC-tools-approval`): **the Try button runs the real thing, shows the exact
output**, and `returns` is generated from that very run. We don't *audit* the customer's CLI — we
**capture its actual behavior** once, and hand that capture to the model.

The only standard we **enforce** is what every CLI on all three OSes already has: **exit code ·
stdout · stderr**. No JSON required, no particular flags required.

### But if the customer **WRITES THEIR OWN** CLI — we owe them a minimal contract

This is a document we have to write, and it's **short**:

| Rule | Why — each rule blocks one specific failure |
|---|---|
| **1. Never prompt interactively** | A child process **has no stdin**. An `Are you sure? [y/N]` = **hangs until the timeout**, and the error message will say *"timed out"* — completely the wrong door |
| **2. Failure means `exit ≠ 0`** | This is the only **deterministic** signal there is. `fail_when:` is a safety net, not the main path |
| **3. Errors to `stderr`, results to `stdout`** | So we can separate "progress" from "result" without guessing |
| **4. Large results go to a FILE, print the path** | 4 MB of log into context is real money. Printing a path lets the model read with `Read` **only when it needs to** |
| **5. Stable across runs** | `returns` is captured once. Changing the output format is changing the contract — same as a vendor changing their API |
| **6. Accept parameters via argv, keys via `env`** | argv is readable from another process on all three OSes (§16e) |

⚠ Rule 1 is the one most often forgotten and **the most expensive to get wrong**: it doesn't fail
immediately, it **hangs**.

---

## 16p. Docker "readiness" — six constraints, followed from the VERY FIRST line of code

> *"We don't need docker right now, but our code has to be ready so that bringing docker online is
> very light, without tearing everything down and rebuilding."*

Accepted, and *"ready"* has to mean **six concrete constraints**, not a promise. Docker's real cost
isn't writing more code — it's **untangling assumptions that got mixed in everywhere**. So they need
to be forbidden from the start:

| # | Constraint | What it blocks |
|---|---|---|
| 1 | **The tool table is a PURE function:** `buildTools(decl) → handler[]`. It **doesn't know** what transport it's running under | the day HTTP is added, this part **doesn't change a single line** |
| 2 | **Transport is a thin adapter.** `sdk` today, `http` later. The process runner **must not** know which one it's sitting under | mixing the two ⇒ exactly the "tear down and rebuild" outcome |
| 3 | ⭐ **The runner receives `cwd` + `env` + `argv` EXPLICITLY.** No `process.cwd()`, no inheriting env implicitly | inside a container, **the ambient environment is a different thing entirely** — this is the deepest-mixed, hardest-to-untangle assumption |
| 4 | **Every path goes through ONE resolving function** (the `paths.ts` pattern, already exists) | a host↔container mapping can be inserted at **one** spot |
| 5 | **No assuming `localhost`/`127.0.0.1`** anywhere in the core | inside a container, `localhost` **is the container itself** |
| 6 | ⭐ **"Where the binary lives" is DATA in the declaration**, not something inferred at runtime | without that field, the day docker ships every action has to be edited, and that's exactly "tear down and rebuild" |

> ⚠ **Constraints 3 and 6 are the two that must be written FIRST.** The other four are discipline —
> if they slip, they're fixable in one spot. These two are **data shape** — get them wrong and every
> customer's declaration has to be re-run.

### 16p-bis. 🔴 MEASURED 08/31 — `resolveInput` BREAKS INSIDE A CONTAINER, and **don't patch it with a guess**

Examined `resolveInput` against edge-case input (the user asked directly: *"any other leaks… like in
a docker container case?"*). Measured:

| | `posix.isAbsolute` | `win32.isAbsolute` |
|---|---|---|
| `D:\Downloads\Musics` | **false** | true |
| `\\server\share\x` | **false** | true |
| `/home/an/anh` | true | true |

⇒ The daemon runs **Linux inside a container**, the user types a Windows path: `isAbsolute` returns
**false** ⇒ falls through to `safeJoin(officeDir, …)` ⇒ since on POSIX a `\` is a **legal filename
character**, it becomes a weirdly-named file **inside the office** ⇒ doesn't exist ⇒ and the error
that fires comes from the **relative-path** branch: *"no such file, and no task creates it"* — telling
the user to fix their **plan**, when what's actually wrong is **a path that belongs to a different
operating system**.

> ## ⛔ A TEMPTATION TO REFUSE: `isAbsolute` "checked against both operating systems"
>
> A single line, `path.win32.isAbsolute(p) || path.posix.isAbsolute(p)`, **fixes the error message**
> and **fixes nothing about the problem**. The user pointed at exactly this spot:
>
> > *"it still doesn't close on our company's design, and it doesn't even know how the user organizes
> > their folders (across 3 OSes)"* · *"the user could absolutely install the app very deep or very
> > shallow"*
>
> **Inside a container, `D:\Downloads\Musics` isn't a path with WRONG SYNTAX — it's a perfectly valid
> path, in a container namespace that has never seen it.** No syntax check can answer the question
> *"is this location reachable from where the worker is running?"*
>
> And it can't be inferred from relative position either: **install depth is up to the user**
> (`C:\agentco` or `D:\a\b\c\d\the-company`), so any trick like *"count how many levels"* or *"compare
> against the office folder"* is a guess, and a wrong guess here fails **silently**.
>
> ⇒ **What actually closes this hole is a DECLARED host↔container MAPPING, not a guess.** That's
> exactly constraint ④ in the table above (*"every path goes through ONE resolving function"*) — the
> spot where the mapping gets inserted once Docker is on. Recorded here so **nobody patches it with a
> dual-OS `isAbsolute`** and thinks it's done.

**Two holes from the SAME batch, real as of today, already patched:**

| | Before | After |
|---|---|---|
| a URL inside `inputs` | `https://github.com/x` → `D:\office\https:\github.com\x` → *"no such file"* | `isUrlInput` ⇒ not a file dependency, let it through |
| **an empty string** | `''` → **resolves to the office folder itself** → always exists ⇒ **the check gate silently passes** | `undefined` ⇒ errors normally |

⚠ The empty case is genuinely reachable: `TaskIOSchema.path` is `z.string()` **with no `.min(1)`**.
⚠ Patched at `resolveInput`, not by tightening the schema — tightening the schema would **discard the
whole plan** over one empty field.
>
> ✅ In exchange: if all six are followed, the day Docker turns on there's only **one** real thing left
> to do — build the HTTP shim + the localhost key layer (§16c). That's what *"very light"* actually
> means.

---

## 16q. Hand-pasted MCP that needs **LOGIN** — the machinery already exists, only tied to the catalog by 2 parameters

> *"what about MCP servers that need identity, given that our only input path is pasting json?"*

**Good news: the hard part is already built and it's ALREADY general-purpose.** Reading the code on
08/30:

| Piece | Where | Vendor-dependent? |
|---|---|---|
| discovering the auth server from the MCP's own URL | `oauth.ts:204` — reads the `WWW-Authenticate` header → `resource_metadata="…"` | ❌ **no** — *the server itself declares where its metadata lives* |
| dynamic client registration (DCR) | `oauth.ts §register()` | ❌ **no** |
| PKCE + web flow | `oauth-routes.ts §oauthStart` | ❌ **no** |

✅ **And there's a measurement that proves it's genuinely general-purpose**, not just reasoning: on
08/29, Linear accepted a `POST /register` whose body went out **byte-identical to `oauth.ts
§register()`, not a single word changed** → 201 (§5x). Notion did the same before that. Two vendors,
one shared piece of code, **no catalog entry involved in that part at all**.

**The part tied to the catalog sits in exactly TWO parameters**, `oauth-routes.ts:206-216`:

```ts
export async function oauthStart(company, catalogId, origin) {
  const arm = findArm(catalogId);        // ← ①
  const mcpUrl = arm.spec.url;           // ← ② the ONLY thing pulled out of the catalog
  const meta = await discover(mcpUrl);   //   from here down: fully general-purpose
```

⇒ **Changing the signature to `oauthStart(company, mcpUrl, prefix, origin)`** makes path B login
work. Not a new subsystem — just **pulling one parameter out of one function**. `prefix` (today
`catalogId`, used to name the key) gets replaced by a user-chosen label or a hash of the URL.

### Three tiers, and only tier 3 requires the user to type anything

| Tier | Server behavior | What the user types |
|---|---|---|
| **1** | has DCR *(Notion, Linear)* | **0 characters** — paste JSON, click **Log in**, done |
| **2** | stdio needs a static key in `env` | fills a field generated from `${…}` — **already works today** |
| **3** | no DCR, or device flow *(GitHub)* | **must paste `client_id`** — §5c: `client_id` is needed **BEFORE** the handshake, so it **cannot be inferred**. The `OwnClient.tsx` block already handles this correctly |

And the error message for tier 3 **already exists, at the right door** (`oauth.ts:256`):

> *"… dynamic registration isn't open — this service requires creating your own app and pasting in a
> client_id."*

> ⚠ **A check that's mandatory before opening this flow:** the moment JSON is pasted, we **already
> know** whether the server needs login — call `url` directly, read `401` + `WWW-Authenticate`. This
> is the spot to **show a Log in button** instead of letting the user click Try → get 401 →
> understand nothing. Follows rule §5m exactly: **don't send a request you already know for certain
> will fail, just so the other side answers a question they don't have enough data to answer.**
> [[agentco-wrong-door-errors]]

---

## 16r. ✅ THE SPIKE ACTUALLY RAN (08/30) — **CLI layer 9/9 green, ASSISTANT layer failed 3/3**

`scripts/spike-cli-arm.ts` — declaration → `createSdkMcpServer` → real `runWorker` → a real process.
Three parts ordered by cost: the deterministic gate ($0) → the worker ($0.066) → the full end-to-end
chain through the Assistant.

### ✅ Execution layer — 9/9, nothing left to explain away

| # | Case | Result |
|---|---|---|
| ① | argv built correctly, **as an array** | 🟢 `["python","-m","dice","--sides","6","--rolls","10"]` |
| ② | value `--force` → rejected | 🟢 blocked in `fillArgv`, before spawn |
| ③ | injecting `6; calc` and `6 && calc` | 🟢 **both are just literal characters** — `ROLL:6; calc`, no calculator ever opened |
| ④ | binary missing → the `spawn` door | 🟢 `door=spawn`, distinct from the `exit` door |
| ⑤ | our own timeout cuts the process | 🟢 `door=timeout` after **3,231 ms** (cap 3,000) |
| ⑥ | `exit 0` with `ERROR` in it → caught by `fail_when` | 🟢 code 0 but still reported as failure |
| ⑦ | `cwd` is real (changing cwd ⇒ module goes missing) | 🟢 exit code 1 |
| ⑧ | **end-to-end through `runWorker`** | 🟢 `done` · **25.2 s · 4 turns · $0.066** · file recorded `Dots: 2` |

**Arm cost: ~202 tokens/turn** for 2 commands (bytes÷4, 807 bytes) — compare: filesystem's 14
commands = 2,185. ⇒ A CLI arm of 3–8 commands lands in the **300–900 token** range, far cheaper than
any vendor arm.

### 🔴🔴 Assistant layer — THREE turns, THREE different failures, and none of them is the CLI layer's fault

| # | What the user typed | `intent` | What happened |
|---|---|---|---|
| 1 | *"roll a 6-sided die for me and tell me how many dots"* | `chat` | 🔴🔴 **The Assistant MADE IT UP:** *"You rolled a 4! 🎲 (that was a random roll)"*. No task assigned, no CLI ever called |
| 2 | *"assign a staff member using the Command Shop connection to roll…"* | `chat` | 🟡 a plan was made, the worker **called the real CLI 2 times** ⇒ **the end-to-end chain DID run**. Failed due to a bug in the script itself (see below) |
| 3 | same as turn 2, after patching the script | `chat` | 🔴 the Assistant wrote a brief saying *"roll the die **using a shell command**"* ⇒ worker burned **4 ToolSearch turns** then went `blocked` · **0 CLI calls** |

**Turn 3 is the most informative failure.** What the Assistant said at the end gives away its own cause:

> *"I couldn't run a real shell command, but **it turns out the Command Shop already has its own dice
> tool**. Would you like me to reassign the task to use that exact tool instead?"*

### 🎯 Root cause — **verified in code, not by reasoning**

`assistant.ts §armReach` builds the roster line out of exactly four pieces: **label** · `level` (if
present) · `folderRoots` · a bridge like `mcp__…__*` (only when ≥2 arms). A CLI arm has **no tier**
(user's decision, 08/30) and **no folder** ⇒ the line the Assistant receives is:

```
Command Shop
```

Exactly one name. Not one word about what it can actually do.

> ⭐ **AND THIS IS WHERE A SELF-BUILT ARM DIVERGES COMPLETELY FROM A CATALOG ARM.**
>
> With `Notion` / `GitHub`, the name **carries capability by itself** — the model already has priors
> about that vendor. With `Command Shop`, the model has **zero priors**, so it does exactly what a
> model always does when data is missing: **it fills the gap**. Turn 1 filled it with a made-up
> number; turn 3 filled it with `shell`.

> ⇒ The debt recorded at `armReach:1076` since **08/22** (*"lists MCP by NAME, not by CAPABILITY…
> unsolved"*) got **half** paid off for `level` on 08/26. The other half is **harmless for the
> catalog and fatal for path B/CLI** — and that's exactly why it stayed dormant for three weeks.

**The patch — small, and follows the exact pattern that has already won three times**
([[agentco-prompt-rules-lose-to-examples]]: the condition must sit **on the same line** as the name):

```
Command Shop — roll a die · sync data
```

That string is pulled from the **`say`** field of each action — a field that's already in the
declaration and currently **read by nobody**.
⚠ Cap of **4 items** + `and N more`, same discipline as `reachDiff` (§15f-bis constraint 2): a
20-command arm must not dump the whole wall of text into every turn.

⚠ **Not yet re-measured after the patch.** The three turns above are all from the UNPATCHED version.

### 🔴 Two bugs found *while measuring*, and both are worth keeping

**① The `spawn` door has TWO causes, the error message only names one.** Turn 2 told the user:
*"the machine running commands is missing **python**"* — while the machine actually had Python 3.13,
and Parts 1+2 had just run it successfully. What actually happened: `cwd` (the sandbox) had been
deleted. **`spawn` throws `ENOENT` for both**, and the first version attributed everything to
*"binary not found."* A confident, wrong error message that sent the user off to reinstall Python.
⇒ Patched: check `fs.existsSync(cwd)` **before spawning** — a cheap check, so there's no excuse for
guessing. [[agentco-wrong-door-errors]]

**② Gate ⑨ of the spike itself reported GREEN for a run that did nothing at all.** The first version
measured `currentState === 'idle'` — meaning it measured **still alive**, not **did any work
happen**. Turn 1 (the Assistant making up a number) went `idle` exactly as expected ⇒ 🟢.
⇒ Patched: count calls **inside the handler itself**. A gate must anchor to something that **only
exists when real work happens**. [[agentco-measurement-vs-conclusion]] — and this one nearly made it
into the spec unnoticed.

**③ ⚠ `SayOutcome.intent` CANNOT be used to control flow.** All three turns returned `"chat"`, and
**two of the three** still went on to plan and run a worker. The first version of the script did
`break` on seeing `chat` ⇒ the script concluded after 121 ms and then `finally` **deleted the
sandbox** while the worker was still running — exactly what produced bug ①.
❓ It's still unclear what `intent` is actually meant to represent; **don't build anything on top of
it** until someone goes and reads the definition properly.

---

## 16s. ✅ PATCHED AND RE-MEASURED (08/30) — **the patch fixed exactly half, and the other half turned out to be a DIFFERENT problem**

### The patch — `arms[].does`, a purely ADDITIVE field

`CatalogArm.hint` has been *"a sentence for the model, going into the roster line"* since 08/29 — but
it's **only reachable through `catalog`**. A hand-pasted arm or a CLI arm has no catalog entry ⇒
permanently zero sentences. ⇒ No new concept invented: **let `arms[<hash>]` carry its own capability**
in plain language.

```
Command Shop — roll a die · sync data
```

| | |
|---|---|
| `types.ts` | `arms[].does: string[]`, defaults to `[]`. **Not part of `armHash`** ⇒ no hash ever changes |
| `assistant.ts §armReach` | `does` gets inserted into `bits`, **after** `level`/`opts` — permission first, capability second |
| Cap | **4 items** + `and N more` — same discipline as `reachDiff` constraint 2 |
| No `does` present | **prints nothing** ⇒ every currently running arm stays **byte-for-byte identical** |
| Tests | +4 in `plan.test.ts`, one of them a **regression test** · **727/727 green** |

⚠ **Doesn't violate §7b** (*"do NOT list raw tool names"*): §7b bans pasting 15 machine tool names
into the prefix of every chat turn. This is a **human-readable sentence**, capped, only shown for a
role that has that exact arm. And for a self-built arm it also isn't a **"second declaration"**
(§7a): that exact string is what goes into the MCP tool's `description` — it **IS** the handshake.

### 🟢 The half that GOT PATCHED — same question, before/after

| | before the patch | after the patch |
|---|---|---|
| brief the Assistant writes | *"roll the die **using a shell command**"* | uses the correct arm |
| result | `blocked` · 4 ToolSearch turns · **0 CLI calls** | **`done`** · **1 CLI call** · file recorded correctly |
| answer given to the user | *"couldn't run a real shell command…"* | *"You rolled a 5! Result has been written to…"* |

⇒ The failure pattern of *"the Assistant makes up a MECHANISM for something it doesn't know how to
do"* is **now closed**.

### 🔴 The half that REMAINS — and this patch is **not** the fix for it

The natural-language question (*"roll me a 6-sided die…"*) **still makes up numbers**: 2/2 turns
after the patch (*"rolled a 2"*, *"rolled a 5"*), `0 calls` made.

**And this time the cause was RULED OUT by a $0 measurement, not by reasoning.** Adding a `--roster`
flag that prints the roster line directly, at zero model cost:

```
roster line the Assistant received:
  "Command Shop — roll a die · sync data"
```

⇒ **The data arrived complete. The Assistant read that capability and still chose to answer on its
own.** This is a **ROUTING** problem, not a **VISIBILITY** problem — two different problems, two
different fixes.

> ⚠ **I diagnosed these as one thing in §16r, and I was only half right.** The thing that saved this
> was the `--roster` flag: whenever a measurement turn fails, the first question is always *"did the
> data not arrive, or did it arrive and the model decide differently anyway"* — and telling those two
> hypotheses apart **must be free**, or someone (me) will guess. Before that flag existed I had
> already paid for **an entire turn just to read a string computable from code**.

### ⚠ And the measuring question might itself be flawed — worth saying before anyone builds anything on it

*"Roll me a die"* **reads like a throwaway joke in chat**. The Assistant answering directly on its
own might be the **correct call** for that exact phrasing, and this measurement would then be
penalizing it for something it got right.

The discriminating test: ask a question where **making it up is unambiguously wrong and the arm can
clearly answer it** — for example *"how many unpaid invoices are there?"* against an arm that reads
invoices.

- Made up ⇒ a **real routing hole**, and considerably more serious than the dice case.
- Delegated ⇒ the dice case was the Assistant **correctly judging triviality**, and this measurement
  needs to be rewritten.

**Nobody has run that test yet.** Don't touch `route()` before there are numbers — it's the busiest
crossroads in the whole product, and slapping a blanket rule onto it is exactly what the 08/27
decision already rejected.

### ⇒ Remaining

1. ~~Run the discriminating test~~ — ✅ **DONE 08/31, and it OVERTURNS the conclusion above.** See §16t.
2. ~~Who fills in `does`~~ — ✅ `company.ts §addArm` writes it, sourced from each action's `say`, cap
   4. A **hand-pasted** arm (path B) still ❓ has no source for it.
3. ~~Go read `SayOutcome.intent`~~ — ✅ **DONE, and the answer is about a MECHANISM, not behavior:**
   `office.ts:574-582` — for **every text message**, `say()` drops the message into the mailbox, calls
   `void this.pump()`, then **`return { intent: 'chat', reply: '' }` IMMEDIATELY**. Routing runs
   **afterward**, asynchronously. ⇒ `intent` isn't `route()`'s decision; it's **a function's default
   return value handed back BEFORE any decision has been made.** The only three paths where it carries
   real meaning are the paths that answer synchronously in code (a broken `@path` reference · a full
   mailbox · a `/…` command).
   Checked all three consuming layers (`server` · `cli` · `web`): **none of them branch on it** ⇒
   there's no live bug, what's real is **a field that lies inside the API contract**. ⏸ Rename it to
   `accepted` — pending user approval, since it's a shape in a public API.

---

## 16t. ✅ 08/31 — **CLI SHIPS IN THE APP**. The blocking measurement has numbers, and it overturns §16s's conclusion

> **779/779 green** (+25), typecheck + build clean. Every number below was measured by machine, not
> read from documentation.

### ① THE BLOCKING MEASUREMENT — **going with shape ①, not building the `long:` triplet**

`spike-cli-arm.ts --sleep=900`: a single `tools/call` ran for **901 seconds with NO cutoff**, the
result came back, worker went `done` — **4 turns · $0.065**.

- ⇒ Matches the threshold §16n set **before** measuring (≥10 minutes ⇒ ①). Permanently saves **2 tool
  definitions in the prefix of every turn**. The `long:` field is **not going into the first version**.
- ⭐ The strongest argument is NOT tool counting: **waiting 15 minutes costs 0 turns.** The triplet
  charges one turn for *every* *"is it done yet"* check — waiting is free, asking has a cost.
- ⚠ We proved **≥901s**, we did **not** prove "unlimited." Don't write "no cap" into the spec.
- 📌 Before this, `--sleep=` **declared a tool nothing ever called** — the instrument existed, but no
  number came from it. Rung four of the [[agentco-spec-says-done]] ladder: spec says done · code
  exists · has anyone clicked it · **does that click actually touch the thing being measured**.

### ② 🔴🔴 **NO ROUTING HOLE EXISTS** — §16s was wrong, and the thing that was broken was the measurement itself

The discriminating test (*"how many unpaid invoices are there?"*, a number **only the machine
knows**, changing every turn): **4/4 turns the Assistant delegated the task, called the real CLI, and
returned the correct number.**

The cause of the wrong conclusion: the measurement had **two separate declarations of the same arm**
— `--roster` was reading the version that had `does`, while `phase3()` re-typed a **second version
missing `does`** and fed the Assistant that one instead.

> 🔴 `--roster` was created on 08/30 specifically to separate *"the data never arrived"* from *"it
> arrived and the model decided otherwise,"* and the lesson recorded from it was *"a discriminating
> test must be FREE."* It turns out **being free doesn't stop you from looking at the wrong OBJECT.**
> ⇒ Corrected rule: **cheap isn't the same as STANDING IN THE RIGHT SPOT.**

Plus four more bugs found inside the measurement gate itself, all of which made it **lie**: it lumped
in the user's own messages ⇒ the *"ask again"* branch was always triggered · then it filtered on
`assistant` ⇒ **lost the worker's `answer` channel entirely** · `ok` only required a number to **be
present** ⇒ green even for a turn with 0 calls · `\b7546\b` didn't match **"7,546"**. Plus one design
bug: all three turns shared **the same session** (the cursor in `.state/assistant-session.json`
persists across process runs) ⇒ **1 sample, not 3**.

### ③ THE SHAPE THAT WAS BUILT

`type: 'cli'` sits inside **`company.yaml`, at the same level as every other arm** (user's decision,
08/31).

> ⭐ **Why NOT create a separate `commands/` folder:** one place, one model, no new folder — and
> everything downstream (`armHash` · `arms[hash]` · the canvas · `armGrants` · the log) reuses it as-is.
>
> 🔴 **CORRECTION 09/01.** The earlier text here said *"`company.yaml` ⇒ the fence **already exists**
> from §5f ⇒ the most dangerous part costs 0 new mechanisms"* — **WRONG**. §5f guards
> `OFFICE_CONFIG`, and that list resolves **relative to the OFFICE folder**; `company/company.yaml`
> sits one level up and **has never been guarded**. For a staff member locked inside the office it's
> harmless, but a role with a **folder arm** pointing at the location containing `company/` can reach
> it — and that's exactly the case `guardedZone` was built to block.
> The concrete consequence, discovered after 08/31: being able to write `company.yaml` ⇒ **declaring
> your own** `run: ["powershell","-c","{cmd}"]` ⇒ arbitrary shell for a role that had **shell turned
> off**. Exactly the back door §16i shouted about.
> ⇒ Added `COMPANY_CONFIG = ['company.yaml']` to `paths.ts §guardedZone`, with a test. The decision
> itself doesn't change, **but it wasn't free the way I claimed it was.**
> → [[agentco-rule-must-see-what-it-governs]]
>
> And the invariant *"`mcpServers[hash]` matches exactly the shape the SDK needs"* **doesn't forbid**
> this: its purpose is *don't stuff agentco's own metadata into `mcpServers`*. `company.yaml` itself
> already disproves any stricter reading — `${NOTION_OAUTH_…}` and `<OFFICE_STATE>/profile` prove the
> on-disk shape **has already been a mold with a hole in it** since 08/25.

| Piece | Location |
|---|---|
| declaration + `fillArgv` + `runCommand` **4 doors** + `buildCliTools` **pure** + `runs_on` | `core/cli-arm.ts` |
| filling `${…}` slots in `actions[].env` | `secrets.ts`'s third branch |
| ① fill → ② compile → ③ strip `npx` | `armexec.ts §fillArm · finishArm · prepareArm` |
| task list + `does` inferred from the declaration | `company.ts §addArm` |
| skip `scopedTools` for CLI | `server.ts` |

**The three steps are ONE function shared by `pickMcp` and `probeArm`** — previously the rule *"the
Try button must check exactly what will run"* was upheld by **discipline** (two places each hand-
assembling the same three steps); now it's upheld by **structure**.

### ④ 🔴 TWO BUGS CAUGHT ON THE VERY FIRST `probeArm` RUN

**a) `Converting circular structure to JSON`.** `probeArm` compiles **first**, then scans for empty
fields **after**, but the compiled version carries a live `McpServer`.

> ⛔ **A temptation to refuse:** make `missingSecretRefs` tolerate the circularity. It stops throwing
> — and then returns `[]` for **every** CLI arm, because after compilation the empty fields sit
> inside a **closure**. The "missing key" gate turns off **silently**, landing right back on the
> 08/25 bug. ⇒ The check must sit in the **gap between FILLING and COMPILING**. A noisy error beats
> a silently-disabled gate.

**b) CLI displays a TIER SELECTOR** — contradicting the decision that *"CLI drops tiers entirely."*
The `annotations` on a CLI tool are built **by us**, from the `read_only` field, so `offeredTiers`
dutifully offers `read`/`full`; but `addArm` never passes a `level` and `pickMcp` grants the full
list ⇒ the three tiers **enforce nothing**. Telling the user honestly *"full permission"* leaves room
for them to weigh it; three fake tiers leave them **falsely reassured**. ⇒ `hasCli` must be
remembered **before** compilation — after that it's already become `{type:'sdk'}` and can no longer
be distinguished.

### ⑤ 📌 `does` — A FIELD WITH A SCHEMA, WITH A READER, **NOBODY WRITES IT** (as of 08/31)

The 08/30 patch built `types.ts §arms.does` + had `armReach` read it, and stopped there: **no path in
the product writes this field**, only the spike wrote it by hand. No test went red because being
absent is valid (`.default([])`). The cost is measurable immediately: a bare label ⇒ the Assistant
**doesn't delegate**; with `does` present ⇒ **4/4** delegate, call for real, return the right number.

### ⑥ ✅ 08/31 (evening) — THREE DECISIONS AFTER THE USER RAN IT FOR REAL

**a) `params[].example` — an example of the SLOT, not of the COMMAND LINE.**
The user asked *"wouldn't an example that's an actual runnable command be better, since it's
zero-shot?"* — right in principle (`pattern` is a rule meant for the **runtime**, and it teaches the
model very poorly; `example: v1.2.3` teaches it in one beat), but the correct layer is the
**parameter layer**:

> **The model doesn't construct the command line.** argv is already fixed, it only fills in `{tag}`.
> Showing it the whole of `pnpm deploy --env staging --tag v1.2.3` hands it information about a layer
> it **doesn't control**, and forces it to reverse-match which word is the parameter.

Measured through the actual product path: `.describe()` → `"tag": {"type":"string","description":"e.g.
v1.2.3"}`, and a parameter with **no declaration** prints nothing ⇒ 0 change for every currently
running arm. Cap of **60 characters** (a repeat-billing item, same class as `hint`'s 320 and `does`'s
4). Only worthwhile when the action **has `params`** — the two actions from test 22 have no
parameters at all, so an `example` for them would teach **0 bits** while still being billed every
turn. 🎯 **The right source is the Try step, not typing it by hand** (same pattern as `returns`,
08/14): a hand-typed example is a **claim**; an example captured from an actual successful run is
correct **by construction**.

**b) The paste door STRICT, the load door LOOSE — two rules, deliberately.**
Measured: zod's default behavior **silently swallows** unknown keys. And the key most likely to be
mistyped **is exactly the safety-critical one** — someone pasting JSON types camelCase the first
time: `readOnly` (flips the annotation the wrong way) · `timeoutMs` (silently falls back to 120s) ·
🔴 `failWhen` (**the safety net for `exit 0` with a hidden error disappears, no signal at all** —
reopens exactly the hole from §5h·7d). The two failure directions aren't equally bad: rejecting by
mistake ⇒ the user is right there, fixes it in 3 seconds; accepting by mistake ⇒ **no symptom at
all**. ⇒ `parseCliArm` now scans for unknown keys + **suggests the closest matching key**
(normalizing away `_`/casing, no distance-threshold trick). The `company.yaml` **loading** door stays
loose: tightening it would mean every old arm becomes **orphaned** the day a new field is added.

> 🔴 **My first version made all three schemas `strictObject`, and a TEST CAUGHT IT IMMEDIATELY:**
> the schema is **one function shared by two doors**, so strictness **must not live inside the
> schema** — it has to live **at the door**. One scanning function is cheaper than two parallel
> schema sets, and two sets would sooner or later drift apart.

**c) The "Self-built MCP" tab meets a CLI declaration ⇒ REDIRECT to the Command tab.**
The user asked this from a SOLID-principles angle, and **the user was right** — I objected to
blocking based on the assumption *"the paste path is the only JSON path,"* but tab 4 has a
bidirectional JSON field, so that assumption no longer holds.

> **The correct boundary: BLOCK AT THE DOOR, NOT INSIDE THE CORE.** `prepareArm` still branches on
> `type` in the **data** — if someone hand-edits `company.yaml` to add a CLI declaration, it **still
> has to run**. Blocking inside the core would be forcing a DATA TYPE onto a SCREEN, and that's the
> actual violation. Tests lock down both directions.

⚠ `cliPasteRedirect` is written + tested, **not yet wired up** — wiring it happens together with tab
4, since blocking it beforehand means no CLI arm could ever be created at all.

---

## 16u. ✅ 09/01 — **THE COMMAND TAB BECOMES EDITABLE**. Five points from the user, and one that overturns an old decision

Context: tab 4 already existed but was still just *"type one fixed command line."* The user tried it
and raised five points.

### ① *"Should Folder and Command merge into one type?"* — **NO**, and the test is whether `cwd` can be dropped

The classification axis has to be something that **can't be dropped**. For a folder arm, the folder
**IS** the capability — drop it and the arm is empty. For a CLI arm, `cwd` is **optional**: leave it
blank ⇒ it falls back to the office folder, and the arm still runs. Folder here is an **adverb**
(where it runs), not a **noun** (what it grants).

Merging them also gets the **question order** wrong: it places the most dangerous question (opening a
hole in the shell firewall) **after** the easiest one (picking a folder), forcing everyone who just
wants to read a file to walk past it. Same rule as `groups` §6j — *a question with real consequences
belongs where people are still paying attention.*

⚠ **Two arms sharing one folder is a NORMAL case, and it's correct**: it's the only way to express
*"read the whole folder"* + *"run exactly these 3 commands inside it."* What struck the user as odd
was the **label** (two nodes that look like duplicates), not the **type** — and the fix lives in
`defaultArmLabel`: a folder arm takes its name from the folder, a CLI arm takes its name from the
binary.

⇒ The folder picker **reuses `BrowseDialog`** (one shared component for the whole tab, not one per
command), placed at the **per-command** level since `cwd` in the schema belongs to the action.
**`cwd` goes into the hash** — already decided on 08/31.

### ② Labels on every field · *"Task"* → **"Command"**

A placeholder is **not a label**: it disappears the moment someone starts typing, so anyone coming
back to edit sees an unlabeled field. Four labels: **Name · Syntax · Example · Description**, plus
*Run in folder* and the last two fields.

### ③ 🔴 *"The Read-only checkbox is too vague. What's its purpose?"* — the question exposes that the old label **didn't state its purpose**

The old label, *"Read-only, changes nothing,"* was a **description**; the user needs a **question** +
a **consequence**. New wording: *"Does this command change anything on the machine?"* → ☐ **No —
view only.** Safe to run any number of times.

⚠ And it must **state honestly what it actually does**: after tiers were dropped for CLI (08/30),
this checkbox builds `annotations` for the log + for staff members to read, **it does not lock the
command down**. Drawing it as a lock would be the UI lying about something it doesn't enforce.
Default unchecked = *"this does make changes"* — safe in the right direction. `fail_when` also gets a
label + a reason (`exit 0` ≠ success), otherwise it looks like an arbitrary text filter.

### ④ ⭐ The **EXAMPLE** field comes back — and how to reconcile two decisions that seem to contradict

- On 08/31 it was decided: the example belongs at the **PARAMETER layer** — the model doesn't
  construct the command line, it only fills in `{tag}`; and that's a **repeat-billing** item (prefix
  every turn, 60-character cap).
- On 09/01 the user pushed back: *"wouldn't an example that's an actual runnable command be better,
  since it's zero-shot?"* — right about the fact that **the user can't verify** an isolated example,
  whereas they can immediately test a full command line in their own terminal.

⇒ **It's not a choice between the two. The person types at the layer they can verify; the model
receives at the layer it controls.** `alignExample(run, toArgv(example))` matches each argv piece and
extracts the value: `… --level {level}` × `… --level 8` → `level = 8`, and **only `level=8`** goes
into the prefix.

⚠ This is a **guess**, so it follows `toArgv`'s exact rule: **show back what was extracted**. A
mismatched number of pieces, or a difference in a fixed piece, ⇒ returns `null` ⇒ the screen says
*"example doesn't match the syntax,"* **never assigns blindly**.

⚠ Consequence: **an empty slot in the Syntax field is the SOURCE OF TRUTH for `params`.** There's
nowhere else the user declares a parameter — typing `{level}` is the declaration. Declaring it in two
places would be two places that can drift apart, and the drift explodes at `fillArgv`.

### ⑤ The **"Fill in a test sample"** button — one click and it runs

`node -e "console.log('Hello, ' + process.argv[1])" {name}`, e.g. `… Minh`. Three measured
constraints: `node` is guaranteed present (the daemon itself runs on it) · **needs no file, no
folder** (`-e` carries the code with it, `cwd` stays blank) · **has one empty slot** (a sample with
no parameter teaches exactly the wrong half). The button fills the **field currently open** — form or
JSON — rather than jumping to a different screen.

### 🔴 Something caught while doing this: the form **drops the parameter fence**

An old comment claimed *"an unknown field dropping is CORRECT: the form only knows about the fields
it draws."* That statement is **only true for fields the form has never heard of**, and `params`
isn't that kind of field: the form **generates them itself** but only draws **one column** of them.
Dropping them ⇒ anyone who set `pattern`/`allow_dash` in the JSON tab and then clicked *"← Back to
form"* just had **a fence silently removed with no warning at all**. → now carries `params` through
intact, overwriting only `example`.
[[agentco-fallback-throws-away-answers]]

### Split into a separate file + locked with a test

The form ↔ declaration mapping was pulled out into `web/src/lib/cli-form.ts` (**no React, no JSX, no
`@/…`**) so that `test/cli-form.test.ts` runs directly under `node --test`. A promise of *"1-1
bidirectional"* breaks in the **quietest possible way** — no error, no warning, just one field
vanishing — so it needs to be **locked with a test, not a comment**. The most important test: **the
form must never produce something `parseCliArm` rejects**, since those two things are kept by two
different files. **14/14 green · the full suite 800/800 green.**

---

## 16v. ✅ 09/01 (round 2) — **FOLDER MOVES UP TO THE ARM LEVEL**, and `fail_when` leaves the form

The user tried out §16u and raised six points. Four are layout; two change the model.

### ① 🔴 `cwd` belongs to the **ARM**, not to each individual command

> *"pick the tab → folder picker → then every command in the list operates from that office folder
> whenever it's called/triggered"*

A CLI arm **is a project**: many commands, one folder. The folder is a question with **exactly one**
correct answer for the whole arm, and asking it per command is an invitation to answer
inconsistently — then the third command can't find a file and nobody understands why. And it has to
come **FIRST**: writing five commands and only then discovering the folder is wrong means all five
have to be re-checked.

⇒ Entering the Commands tab means entering **a folder screen** first: `[Choose folder…]` or
`[Use the office folder →]`. The second path **must stay** — `cwd` is optional in the schema, the
hello-world template needs no folder at all, and a hard-blocking screen here kills exactly the
*"one click and it runs"* property.

⚠ **The schema does NOT change**: `cwd` still lives at the action level, and the form writes the
same value into every action. The UI is allowed to be narrower than the declaration sheet; the
declaration sheet must never be narrower than real-world usage.

⚠ **A mandatory consequence:** a hand-typed declaration sheet CAN set a different `cwd` per command.
The form can't represent that shape ⇒ `declToDraft` returns `mixed: true`, the **"← Back to form"**
button locks, and the screen states why. Silently taking the first command's `cwd` would mean
**relocating where n−1 commands actually run** — for a command that writes data, that's running in
the wrong folder, not a display glitch.

⚠ The picker opens at **the currently selected folder**, deliberately **not** reading `LAST_DIR`
(the user pointed this out): that cache is the memory of the **Folder** arm — borrowing it here
opens a location with nothing to do with what's currently being edited.

### ② The default label = **THE FOLDER NAME** (`defaultArmLabel`)

> *"one CLI arm can have several commands — I think using the folder name but keeping the `>_` logo
> for the node is fine"*

The earlier version took the binary's name, and it broke on exactly the most common case: every
command in a JS project starts with `node` ⇒ three different projects produce three nodes on the
diagram all **named "node."** A name has to be distinguishing, and what distinguishes them is the
folder. The `>_` shape still follows the **kind**, so changing the label doesn't lose the "this is a
command arm" signal. No `cwd` ⇒ it falls back to the binary name as before.

### ③ Blocking CLI in the *Self-plug MCP* tab: **keep the block, move the exit door to the JSON tab**

The user was right to say *"once the folder mechanism is in, the paste-json-to-cli conversion
doesn't work reliably anymore"*: after ①, dropping a declaration sheet into the **form** could
silently collapse `cwd`. But **a flat refusal becomes a wrong-door error message** — the door still
exists, just somewhere else.
⇒ The convert button now sends its content into **the Commands tab's JSON field**: verbatim to
verbatim, no transformation applied. Getting back to the form is a deliberate click, and by then
that button is already locked if `cwd` doesn't match.

### ④ Layout: dialog **46rem** · label **on the same line** as the input · `fail_when` leaves the form

Not an aesthetic call: at 28rem, a 150px label column eats a third of the width, and the **Syntax**
field — which holds an actual command line — is narrow enough that reading back what you just typed
requires horizontal scrolling. Widen the **whole** dialog, not just the Commands tab: a modal
changing width when the tab switches is the entire panel jumping under the user's hand mid-click.

### ⑤ Checkbox: **"Read-only command"**, unchecked by default

The user settled this after my §16u draft turned it into a long question. They're right: a short
label **reads instantly** because it sits on the same line as the checkbox, in a form where every
other row is also `label — field`; a long question breaks that exact rhythm. Two things stay fixed:
default `read_only = false` (safe in the correct direction), and **being honest that it's a label,
not a lock**.

### ⑥ 🔴 *"Should `fail_when` just be dropped? Let the worker figure it out itself?"* — **not dropped, but it's standing in the wrong spot, and that's MY mistake**

The user pointed out: *"a lot of the time a sub-CLI prints warnings, errors, a traceback or
whatever, but the result actually still worked."* Correct, and the two failure directions **aren't
symmetric**:

| | No `fail_when` | `fail_when` matches wrongly |
|---|---|---|
| What happens | the agent trusts `exit 0`, moves on with a result that doesn't exist | the agent believes a command that **already succeeded** failed |
| What the agent does next | uses an empty result | **RUNS IT AGAIN** |
| For a command that writes data | one wrong step | **a second, overwriting write** |

The second direction is worse: it turns an **already-successful** command into one at risk of
running twice. But the model **can read the full output** in the tool's result, so the first
direction has a natural safety net the second one lacks.

**⇒ But the real bug isn't the `fail_when` field — it's where I placed it.** `fail_when` is a tool
for **someone who knows their own CLI** — they know `FATAL:` only prints when it's actually dead.
Someone filling out a form doesn't know that, and the placeholder I wrote (`ERROR, FAILED,
Traceback`) **invites them to type in exactly the three strings that show up most often in HEALTHY
output.** I built the trap myself and then asked whether the house should be torn down.

Decision: **keep the field + keep the hard verdict inside the core · REMOVE the checkbox from the
form · only editable in the JSON tab.** The field still **travels through the form intact** (with a
test) — the same rule as `pattern`. In practice, a person filling out the form simply **won't use
it**, which is close to what the user proposed, but the door stays open for someone who knows what
they're doing. → [[agentco-domain-vs-boundary]] · [[agentco-no-change-is-a-decision]]

> **Reopening condition (measurable, not a feeling):** run **chapter H**. If H-1 shows the model
> **on its own** concluding failure after reading `ERROR: connection lost` in the output, **without
> needing** `fail_when`, then this field loses its reason to exist and gets dropped entirely. Nobody
> has run H yet ⇒ today there's **not enough evidence to drop it**, and that's the only reason it's
> being kept. [[agentco-measurement-vs-conclusion]]

**803/803 green** (+3 tests: shared folder · `mixed` · folder-based labeling).

### ⑦ 🔴 CORRECTION, same day — the folder screen has **ONE** button, not two

The first version of ① had `[Choose folder…]` **and** `[Use the office folder →]`. The user rejected
it:

> *"There should only be exactly ONE button, Choose folder…, no 'Use office folder' button, and the
> default folder when you click it is always the office folder ⇒ the next screen should only have a
> Change button, no Clear button"*

They're right, and the reason is worth recording: **the two buttons ask the same question twice.**
The second button was just *"pick the office folder"* dressed up as a shortcut — and a shortcut for
the **default** saves nothing; it only makes someone compare two choices to realize they're nearly
identical.

⇒ One button, and the office folder is **where the picker already stands, pre-selected.** Wanting it
just means clicking Done immediately. Same number of clicks, **one fewer decision** — and `cwd` gets
**written out every time**, so `company.yaml` states exactly what will run instead of leaving behind
the *"blank means somewhere"* case. Consequence: the bar above now shows only **Change…**, the
**Clear** button is dropped — that button would only rebuild the exact state that was just removed.

⚠ The server gains a new `GET /api/browse?office=<id>`: **the client sends an id, never a path.**
An office's path is the server's own business (it varies by OS, by install location), and stitching
it together on the web side would rebuild exactly the *"two copies of one truth"* problem
`buildConfig` already worked to remove.

### ⑧ The "reuse" list: **`cli` is its own KIND**, not a shape of `custom`

> *"Drop every custom-MCP suggestion from the CLI list, only suggest CLI ones, since it's now split
> into two separate families"*

A mandatory consequence of splitting the tab: once step 1 has two cards, the reuse list has to split
along the exact same line — otherwise **the Commands tab suggests an HTTP arm that it itself refuses
to accept if pasted there.** `kindOf` asks `config.type === 'cli'` — the same question `isCliArm`/
`isCliPaste` already ask, not a third rule.

### ⑩ The **Example field always shown** — and when there's no blank yet, it **changes role**

> *"why does the Template have an Example, but the auto-filled fields don't have an Example field?"*

The earlier version hid this field until the syntax already contained a `{blank}`, reasoning *"if
there's nothing to fill in, who is the example teaching?"* That reasoning is **correct for the
model's side** and **wrong for the user's side**: a field that grows and then vanishes on its own is
something nobody can predict the rule for — and it hides itself **exactly when it's needed most**,
which is the moment before someone even knows they need a blank.

⇒ Always shown. When there's no blank yet, it diffs the example against the syntax and **points at
the spot worth turning into a blank** (`ExampleNoSlot`): *"Differs from the syntax at `8` → `9` — if
this is the part that changes every run, turn it into `{blank_name}`."* That's where this field
answers a question no other screen can: **"which part of this command line is the thing that
changes every time?"** — the user knows the answer (they just ran it twice with two different
values) but **doesn't know that we need to know it.** Forcing them to invent the concept of a
*parameter* themselves and type `{…}` means teaching them the machine's own vocabulary; comparing
two real command lines doesn't.

⚠ It **only points, never auto-fixes** — the same rule as `toArgv`: guessing is fine, but the user
has to be the one who clicks. And it stays **silent** when the two lines are identical: a fixed
command with no variation is a normal, unremarkable case.

⚠ **`example`'s layer does NOT change** (still `params[].example`, never merged into `description`).
The user pointed out *"Claude Code is smart enough to tell the difference"* — true, and that's **not
what I was objecting to**: I wasn't worried about the model confusing the example with a real
command, I was counting **the recurring bill**. For a parameter, `params[].example` already gives
the model **every value it has to fill in**; the whole command line only adds pieces that are
**fixed, that it never controls.** With no parameters, the tool takes no arguments at all — there's
nothing left to zero-shot.
> **Reopening condition, measurable:** cell **I-2** of chapter I is already the exact comparison
> needed. If a real case shows up where the model picks the wrong tool while `params[].example` was
> already sufficient, put the whole command line into `description` and re-measure the per-turn
> token cost. [[agentco-measurement-vs-conclusion]]

### ⑪ 🔴 Pasting a CLI into the MCP tab → the folder bar comes up **completely blank**, and that's a lie I just created myself

The user caught it: *"is the CLI's default folder still the office? right now it's just showing
blank so I have no idea what it is."*

Two bugs, same location, both born out of ⑦:

1. Dropped the label *"Office folder (default)"* because **the form path** never leaves `cwd` empty
   any more — but **the paste path** still can, and a declaration sheet that never declares `cwd`
   **genuinely runs in the office folder.** ⇒ **Showing a state ≠ inviting someone into that
   state.** The Clear button was an invitation (already removed, correctly); the label is a
   statement of fact (has to stay).
2. In JSON mode, `cliDecl` reads from **the JSON block**, not from `cliCwd` — so the bar above was
   drawing a value with **no effect whatsoever**, and the *Change…* button next to it edited exactly
   that inert value.
   ⇒ The bar now reads `cwd` **from the block actually being edited**; the *Change…* button
   disappears, replaced by the text *"edit inside JSON."* When `mixed`, it reads *"Differs per
   command."*

📌 The failure class, and it repeats: **removing a state through ONE entry point and assuming it
vanished from the whole system.** The question that has to be asked: *"is there another path that
also produces this state?"* → [[agentco-finish-completely]]

### ⑫ 🔴 **DUPLICATE COMMAND IDs** — the user asked, and the question landed on a hole coming from THE MAIN PATH

> *"while checking the CLI's json, I noticed the user can edit the id … what happens if the id
> collides?"*

**Measure first, conclude after (09/01):** `createSdkMcpServer` with two tools sharing a name
**THROWS** — `Tool a is already registered`. Good news: **no case gets silently swallowed**, a
"delete" command can never quietly take over the slot of a "count" command sharing its name.

But it throws inside `compileCliArm`, i.e. **at the moment the Try button is clicked**, with an
English sentence talking about a *"tool"* — while the user had just named two **commands** in
Vietnamese. Exactly the *wrong-door error* failure class: the fact is correct, the recipient is
wrong. → [[agentco-wrong-door-errors]]

**⚠ And it requires nobody to hand-edit any JSON.** The user's next question landed exactly there:
*"if someone uses the form and leaves the id blank, how does the id get generated?"* — `slugId(say)`.
So *"count invoice"* and *"count invoice!"* both produce **the exact same id**, and this hole comes
from **the main path**, not from someone poking at raw JSON.

**⚠ A spot easy to patch at the wrong layer, and the user flagged it before I got there:** a
duplicate id is only a **symptom**; the disease is **two commands the staff member can't tell
apart** (`does` lists two identical-looking lines). So the fix is **not** to silently tack on a `_2`
suffix — doing that would only hide the exact problem still sitting there on the model's side.

⇒ Three layers, and the user got all three right:
1. **Blocked at the UI's first step** — flagged at the **Name** field (the one the user can actually
   edit, since they never type the id directly), and the *Use this configuration* button dims. In
   JSON mode, it's flagged with one line right above the button.
2. **The Try button still has to block it** (the user pointed out: *"what if someone abuses a race
   condition"*) — already covered: `server.ts §resolveArm → parseCliArm` is the **SHARED** gate for
   both Try and Done, so a stale tab, a race, or a hand-written client can't slip through either
   way. This gate now returns a Vietnamese sentence naming the exact duplicate id.
3. **`id` gets validated** — `^[a-z][a-z0-9_]*$` already exists in the schema, and `slugId`
   guarantees output that matches it (with a test).

⚠ The check lives in **`parseCliArm`, NOT in the schema**: the schema is shared with the
`company.yaml` load path, and failing there means `cliToolNames` returns `[]` ⇒ `addArm` writes
`tools: []` ⇒ **grants the entire server** — exactly the §5t hole. The load path is left to let the
SDK throw on its own: deterministic, and it never widens anyone's permissions.

### ⑬ 🔴 A LEAK ON THE *Self-plug MCP* SIDE TOO — a block with several servers, we plug in one, **and say nothing**

The user asked: *"check whether the same leak exists on the custom-MCP side too."* **It does.**
`parsePaste` takes `Object.entries(mcpServers)[0]` and drops the rest **without a single word**.
Plenty of vendor READMEs list 2–3 servers in one block ⇒ the user clicks Done, sees a ✓, and **loses
an arm with no symptom at all.**

⇒ **Not blocked** — plugging in the first one is correct, useful behavior. What's missing is just
**saying so**: how many servers were in the block, which one got taken, how to plug in the rest.
→ [[agentco-silent-allowlist]]

📌 These two holes differ at exactly one point, and that point decides how each gets fixed: a
duplicate id has **no correct interpretation at all** ⇒ block it; a multi-server block **does** have
one (plug in the first) ⇒ just say so.

### ⑭ 🔴 THE **"UNFINISHED COMMAND" FILTER IS ITSELF THE BUG** — and it's worse than the button the user pointed at

> *"when I click add command without filling anything in yet, the button still lights up to
> continue … and does refusing to continue mean converting to JSON returns an EMPTY json? (not
> sure, please check)"*

**Checked (measured 09/01) — the suspicion is correct, and the consequence is worse:**

| | |
|---|---|
| form | **2 commands** (1 complete + 1 just added via *Add*) |
| → `draftToDecl` | **1 action** ← the `.filter(say && run.length)` filter |
| → `declToDraft` | **1 command** |

⇒ Clicking *View JSON* then *← Back to form* **silently loses an entire row.** And the button still
lights up because `cliCount` counts **after** filtering.

⭐ **The filter is the bug, not the button.** It **deletes the user's own data to make the output look
valid** — counterfeit: the config only looks valid because the invalid part got thrown away, not
because the user actually finished filling it in. → [[agentco-fallback-throws-away-answers]]

⇒ Export **every row**. An unfinished row becomes an **invalid** declaration entry, and that's a
good thing: `cliProblems` catches it in the UI (red at **the exact field**, not a mute dimmed
button), `parseCliArm` catches it at the gate. **A declaration sheet that honestly says it isn't
done yet leaves every downstream gate a chance to do its job; one that's already been swept clean
does not.** Re-measured after the fix: **2 → 2 → 2**.

⚠ The same pass turned up **a second fallback from the same family**: `cliDecl` falls back to
`draftToDecl(list)` whenever the JSON block is broken ⇒ the *"Use this configuration"* button **stays
lit while the JSON field is showing red**, and clicking it saves **the form's version**, not what's
actually on screen. It now returns `null` instead — *"this block is broken"* is **an answer**, not a
failure to paper over.

⚠ `id: ''` when there's no name yet, **not** `slugId('')` (which produces `viec_moi`): two blank rows
both producing `viec_moi` would make `dupIds` accuse *"duplicate name"* on two fields that haven't
been typed into at all — a correctly-triggered error message describing the wrong situation entirely.

### ⑮ 🔴 THE CLI NODE ON THE DIAGRAM STILL SHOWS **A PLUG ICON** — and a comment was lying about it

> *"Made a CLI, but the node on the canvas still shows the custom-MCP icon"*

I added `'cli'` to `ArmDialog §kindOf` and `ArmIcon §ArmKind`, then **forgot `office.ts §armKind`** —
the spot on the **server** that decides a node's icon. A CLI declaration has no `catalog` field, so
it fell through into the `custom` branch.

⚠ **The memorable part sits on the line right above the mistake**: a comment declared *"identical to
`ArmDialog §kindOf` — one classification axis, read in two places."* That sentence **became false
the moment I edited one side of it.** **A comment stating that two spots match can't guard against
the two spots drifting apart** — it only records the intent at the time it was written. No test
turned red, no build broke, the node just quietly wore the wrong icon.

⇒ Fixed in `office.ts`: it now asks `isCliArm(mcpServers[server])` — **the runtime config**, exactly
like `isCliArm` does. The `arms[]` half only carries a label/key/task and has **no field at all**
stating this is a command declaration. Placed **before** the `catalog` branch so that the day a
ready-made CLI arm exists in the catalog, it still comes out `>_` instead of silently becoming
`service`.

⇒ And locked down with `test/arm-kind.test.ts` — **reads the source code**, compares three unions
(`office.ts` · `web/types.ts` · `ArmIcon.tsx`) value by value, plus one test demanding that
`office.ts` **actually assigns** `cli` (a union with the right values but nobody assigning it still
leaves the node wrong — the third rung of the ladder: *the spec says it's done · the code exists ·
has anyone actually called it yet*). **Actually tried making it fail**: removed `'cli'` from
`ArmIcon.tsx` ⇒ **2/3 tests turned red**, then restored it.

**812/812 green** (+9).

### ⑨ The folder picker: **64rem → 46rem**, sharing one constant with the dialog that opens it

The real constraint isn't the number — it's *"the picker must never be wider than the dialog that
opened it"* — it pops out **from inside** that dialog, so a mismatch means the whole frame jumps out
and shrinks back every time it opens. And the only way to keep a constraint between two values
holding is **to not have two values** (`DIALOG_W`). The folder grid drops to 3 columns: at 46rem, 4
columns would cut names off at the tenth character, and a folder's name is exactly what people read
to decide what to click. [[agentco-count-mechanisms]]

---

### ⏸ STILL OWED

- **`fail_when` is only editable in the JSON tab** — see §16v ⑥. Reopens after **chapter H**.
- **Advanced parameters are only editable in the JSON tab** — `pattern`/`min`/`max`/`allow_dash`/
  `integer` **survive** a round trip through the form (tested) but the form never draws them. A
  deliberate choice: four more fields per parameter is the wrong trade for a non-coder. Reopens once
  a real case exists.
- **Block `curl`/`wget`/`Invoke-WebRequest` inside `run:`** — a trap born from the decision to drop
  REST. With no shell, `$TOKEN` never expands ⇒ the user is forced to paste **the literal key straight
  into argv**, and argv is readable from another process on all three OSes **and** flows into the
  hash. No symptom at all.
- **Nobody has run walkthrough 22 THROUGH THE UI yet.** Every number so far was measured outside it.
- The **"Try one action"** button (actually runs one real command, §16i: has to say so clearly
  before the click, can never be clicked on the user's behalf) — doesn't exist yet. Today's "Try"
  button only shakes hands and lists the tools, **it runs no command at all**.
- `confirm:` already exists in the declaration sheet but **isn't wired into the approval gate yet**.

---

## Sources

**Read directly inside `node_modules`, `@anthropic-ai/claude-agent-sdk@0.3.231`** (📖 — types, not
behavior): `sdk.d.ts` — `McpServerConfig` (1068) · `McpHttpServerConfig` (1035) ·
`McpServerStatus` (1075) · `McpServerToolPolicy` (1123) · `McpSetServersResult` (1135) ·
`McpClaudeAIProxyServerConfig` (1025) · `ElicitationRequest` (580) · `OnElicitation` (1310) ·
`Query.mcpServerStatus` (2500) · `Query.setMcpServers` (2627) · `Query.getContextUsage` (2507) ·
`SDKControlGetContextUsageResponse` (3228).

**In-repo** (✅ — actually run, with measurements): `worker.ts §pickMcp` · `secrets.ts` ·
`paths.ts §companyPaths` · `layout.ts` · `types.ts` §`BUILTIN_TOOLS` · `SPEC-tools-approval.md`
§5–§12 · `SESSIONS_MEMORY.md` §5n.

**External** ( — checked 2026-08-23): [MCP Transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
· [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) ·
[MCP Registry](https://registry.modelcontextprotocol.io/) ·
[n8n MCP Client Tool](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp)
· [n8n MCP Server Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger)
· [Google Workspace Marketplace branding](https://developers.google.com/workspace/marketplace/terms/branding)
· [Google Brand Resource Center](https://about.google/brand-resource-center/guidance/)
· [INTA — Fair Use of Trademarks](https://www.inta.org/fact-sheets/fair-use-of-trademarks-intended-for-a-non-legal-audience/)
