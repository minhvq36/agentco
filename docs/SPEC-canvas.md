# SPEC — Canvas: the office as a node graph

**Status: SHIPPED.** Replaces the old list-based UI (`SPEC-ui.md` §2).

| Part | Where |
|---|---|
| Read/write/validate the shape | `src/core/layout.ts` |
| Office operations (add/remove people, reload) | `src/core/office.ts` |
| Roster from wired edges | `src/core/assistant.ts` → `setAssignable()` |
| Canvas SVG | `src/server/ui.ts` |
| API | `src/server/server.ts` |

Read alongside `SPEC-2026-08-14-agentco.md` and `SPEC-token-economy.md`.

---

## 1. Why switch to a canvas

The current UI (team list + plan + log) works, but it **hides the architecture**. Users can't see the shape of their company, can't edit that shape, and can't take it with them.

A node-based canvas (n8n-style) solves three things at once:

1. **Architectural constraints become visible and unbreakable.** The star topology stops being one line in a spec — it becomes something you physically *cannot draw* on the canvas.
2. **The department's structure becomes portable** — saveable, shareable, usable as a template.
3. **Watch the company work in real time** — nodes light up, wires blink. This is footage that makes for a good video.

---

## 2. Source of truth: JSON for SHAPE, not for CONTENT

> **This is the single most important decision in this file. Getting it wrong breaks the cost architecture.**

```
company/
├─ layout.json          ← owned by the MACHINE. Node positions + edges. Changes on every drag.
├─ office.yaml          ← owned by the PERSON. Office name + the editable Assistant section.
├─ roles/*.yaml         ← owned by the PERSON. Employee definitions. FEEDS INTO cacheKey.
├─ skills/*.md          ← owned by the PERSON.
└─ knowledge/**.md      ← both write here.
```

**Why not stuff everything into one JSON file like n8n does:**

- `cacheKey` hashes **the role's content**. If a node's coordinates lived in the same file as its role definition, **every mouse drag would throw away that agent's cache** — paying back ~20K cache_write for an operation that changes nothing semantically. Split into separate files, that bug **becomes impossible**, without needing any discipline to enforce it.
- Yaml/markdown can be **hand-edited**, **git-diffed readably**, opened in any editor. A blob of JSON loses all of that — and "the advanced user who customizes things themselves" is one of the two customer segments we've committed to.
- `roles/*.yaml` deliberately borrows the shape of the Claude Agent SDK's `AgentDefinition`. Switching to a homegrown JSON format throws that advantage away.

`layout.json` is **pure view state**. Delete it and the company still runs exactly the same, it just loses its layout (the canvas re-arranges itself). That's the litmus test for whether the boundary is drawn in the right place.

### Shape of `layout.json`

```json
{
  "version": 1,
  "nodes": [
    { "id": "assistant", "kind": "assistant", "x": 480, "y": 60 },
    { "id": "writer",  "kind": "agent",     "x": 240, "y": 280, "role": "writer" },
    { "id": "reviewer","kind": "agent",     "x": 720, "y": 280, "role": "reviewer" },
    { "id": "kb",      "kind": "knowledge", "x": 480, "y": 480 },
    { "id": "mcp_notion", "kind": "mcp",    "x": 900, "y": 180, "server": "notion" }
  ],
  "edges": [
    { "from": "assistant", "to": "agent:writer" },
    { "from": "assistant", "to": "agent:reviewer" },
    { "from": "mcp:notion", "to": "assistant" }
  ]
}
```

The `role` field on a node points at a file under `roles/`. Missing file → node shows red, "role not found." File exists but no node → the canvas adds one in an open spot automatically (self-heals when a user drops a yaml file into the folder by hand).

#### ⚠ "Open spot" has to be a REAL open spot — a bug we already hit

The earlier build assigned slots with `agentSlot(i)`, where `i` was the role's **alphabetical position**, without checking whether that slot was already occupied. An existing node kept its saved coordinates; a new node got slot `i`. Adding an employee whose name sorted **before** an existing one meant it landed **exactly on top of** that existing employee.

What the user saw: *"I clicked Add Employee and nothing happened,"* then clicking **Rearrange Layout** made it appear (because `arrange()` re-lays out everything from scratch). It looked exactly like a random network glitch — **it was actually 100% deterministic**: a name sorting after all existing names → an empty slot → visible; sorting before or in the middle → overlap → invisible.

The replacement rule, and **both halves are mandatory**:

1. **Check collisions with an actual rectangle** (padded), not "are the coordinates equal" — users drag nodes anywhere they like, and two nodes 10px apart still look overlapped to the eye. Check against **every** node type, including the knowledge store.
2. **TWO PASSES.** Place every node that **already has coordinates** first, then assign slots to new nodes. This is the half that's easy to get wrong: iterate alphabetically in a single pass and a new node named `ai-do` gets its slot **before** `nguoi-viet` has even made it onto the list, so the collision check runs against a still-empty list — the fix looks applied but the overlap happens exactly as before. *(We walked into this exact trap once.)*

Also: `addAgent` must **persist the position to disk**. The old code called `connectAssistant`, which `return`s early when the edge already exists — and the edge **always** exists when there's no `layout.json` yet (in that case, `read()` auto-generates an edge for every role). Result: the coordinates just computed were never saved.

#### ⚠⚠ "An open slot" isn't enough — it also has to be the RIGHT slot (08/20)

Once that bug was fixed, new nodes stopped overlapping anyone. But a second symptom came back from the user:

> *"Employee #3 drifts to the right of the assistant (3 employees clustered on one side) instead of balancing evenly around it — I have to click Rearrange to get it centered."*

**Same class of bug, one level deeper:** a new node gets assigned a slot **without looking at what the layout currently looks like**. Last time, the thing being ignored was *"is this slot already occupied?"*; this time it's *"what is this row currently balanced around?"*

The root cause: two functions answer two different questions, and we were using the wrong one:

| | |
|---|---|
| `arrangeAll` | *"what should the whole layout look like?"* — centers the Assistant based on the **TOTAL COUNT** of employees. Only runs on **Rearrange** or when the office has no `layout.json` yet |
| `firstFreeSlot` | *"where does the new person sit?"* — and it counts **left to right**, so the third person lands in the third slot |

The Assistant node **doesn't move** while people are being added. The row of employees grows to the right while the axis stays put ⇒ the layout drifts increasingly off-center, and only clicking Rearrange fixes it.

> **A cleanup step the system knows how to do shouldn't be left to the user's hand.** If there's a button that fixes everything when pressed, then whatever that button does is what should have happened automatically in the first place.

**The replacement rule — `centeredSlot(i, centerX)`:** new slots grow **outward from both sides** of an axis, and that axis is **wherever the Assistant node's center actually sits right now**, not wherever `arrangeAll` thinks it should be.

| Person | Column offset | Why |
|---|---|---|
| 1 | `0` | directly below the Assistant |
| 2 | `+1` | an even count can't be perfectly centered — this is a forced choice, and the user also called it reasonable |
| 3 | `−1` | the row of three re-centers around the Assistant |
| 4 | `+2` | then **wraps to a new row**, still `PER_ROW` columns per row so the layout doesn't grow horizontally forever |

> ⚠ **This still has to STAY ON THE SAME GRID as `agentSlot`** — `centerX` gets rounded to a column index before the offset is added. Skip that, and on shifts with an **even** number of employees (where the axis falls between two columns) every new slot ends up **half a column** off and half-overlaps the previous person. That's the 08/16 bug coming back through a different door — and **noticeably worse** than the rightward drift we were fixing.

The two functions use **the same grid**, so mixing them (some nodes placed by `arrangeAll`, later ones by `centeredSlot`) doesn't produce misaligned nodes either. `firstFreeSlot` remains the single entry point, just takes an extra `centerX` parameter; without an axis it falls back to counting left-to-right as before.

### Fixed during implementation: the `mcp → agent` edge does NOT live in layout.json

The original design put it here. Wrong — by §2's own argument: "which tools can this agent use" is **CONTENT**, not shape. It already has a home: `mcp:` in `roles/<id>.yaml`.

Living in both places = two sources of truth = eventually drifting apart. So:

- **read**: `GET /api/office/:id/canvas` reconstructs the `mcp→agent` edge from `roles/*.yaml` so the canvas draws it correctly
- **write**: dragging/removing that wire writes straight to `roles/<id>.yaml` (using `parseDocument` to **preserve the user's comments**; a clean two-line diff)
- `writeRaw()` is the single choke point that writes to disk, and it **filters out** this edge type, so there's no path for it to leak into layout.json even if a caller forgets

The `mcp → assistant` edge still lives in office.yaml (`assistant.mcp`) — same reasoning — because without `concierge` yet, it doesn't correspond to any content at all.

### Fixed during implementation: `tools`/`mcp` have to feed into `cacheKey`

A direct consequence of letting people wire up MCP with the mouse. The tool definition is **not** part of the systemPrompt, but it sits **before** the system prompt in the prefix that Anthropic caches → changing a tool changes the prefix.

This is exactly the bug already fixed for `model` in the prior session: without this, the cache priming gate thinks the cache is warm when it isn't, and we pay `cache_write` while believing we're saving money. Added to `prompt.ts`.

---

## 3. Edges have to MEAN something

If the Assistant is always wired to every agent, the edge is just decoration. Give it real meaning:

> **The `assistant → agent` edge = "the Assistant is allowed to hand this person work."**

And it **directly controls cost**: only an agent that's wired in gets its `pitch` included in the Assistant's context (`assistant.ts` → `roster()`). Cutting the wire = the agent still exists, still keeps its own notebook of experience, but the Assistant no longer sees it.

→ **Dragging a wire is an action with a measurable consequence.** This is what makes the canvas more than a checkbox list.

On a disconnected agent node: dim it, label it "resting."

---

## 4. Four node types

| Type | Count | Deletable? | Can connect out to? | Accepts connections from |
|---|---|---|---|---|
| **assistant** | exactly 1, auto-created with the office | ❌ | → agent | mcp |
| **agent** | 0..n | ✅ | ❌ **nothing at all** | assistant, mcp |
| **knowledge** | exactly 1, auto-created | ❌ | no wires | no wires |
| **mcp** | 0..n | ✅ | → assistant, → agent | — |

### assistant

Cannot be deleted: without an Assistant, nobody plans anything. Displays: name, model tier, number of people currently on duty, and `📒 n` = the Assistant's own private notebook.

Clicking it opens the **tiered prompt** — the core layer is read-only but always viewable, skills are editable. → `SPEC-offices.md` §4.1

### agent — CANNOT connect to another agent

The canvas has to make this **physically impossible**, not flag an error after the fact. Drag from an agent, and there's no output port to grab onto.

The reason is economic, not aesthetic: agents talking directly to each other is **the single biggest token drain** in every multi-agent system, and it's uncontrollable. Every exchange has to route through the Assistant or through an artifact.

An agent node displays: avatar, name, tier, and **`📒 n`** = the number of notes in its own private notebook.

### knowledge — no wires, deliberately

The shared store sits in the middle of the canvas. **No wire is drawn to anyone** — it's an environment, not a relationship. Everyone can reach it, like a shelf of documents in the middle of the office.

But it has to represent the **two kinds of knowledge** the system already has:

- **the knowledge node in the middle** = `knowledge/shared/` — the Assistant writes, the whole office reads
- **`📒 n` on each agent node** = `knowledge/agents/<role>/` — that agent writes it when it makes a mistake or figures out the right approach, **only it reads it**

Clicking the knowledge node → opens the knowledge drawer (already built, `SPEC-ui.md` §4).

### mcp

Connecting to an **agent** → that agent can use that MCP.

Connecting to the **Assistant** → actually attaches to `concierge` (a one-shot worker running in the background), **not** directly to the Assistant's session. The Assistant resumes constantly, and MCP breaks prompt cache on resume ([#247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247)) → losing ~36,000 effective tokens **per turn of conversation**.

From the user's point of view, "the Assistant can use this tool" is **correct** — so there's no need to explain the mechanism in the UI. Just a one-line tooltip: *"the Assistant handles small errands itself."*

---

## 5. The canvas doubles as the live-run screen

This is where the canvas clearly beats a list. While the company is working:

- **The agent node lights up** when it receives a task, with the `say` line right under its name (*"reading gioi_thieu.md"*)
- **The Assistant→agent wire blinks** while the task is running
- **The node grays out** when finished, briefly flashing a ✓
- An errored node → red border + a `say` line explaining it

No new SSE events needed — reuses the existing set (`task.started` / `task.progress` / `task.done` / `task.blocked`), just changes where it's displayed.

**The bottom bar keeps everything the current UI already does well:** plan steps, the chat box with the director, cost, the log drawer. Nothing is lost.

---

## 6. Templates and sharing — already there, just needs to surface

`company/` is **already** a fully self-contained department. Which means these three features cost almost nothing to build:

| Feature | How |
|---|---|
| Save the structure | it's just that directory, nothing to build |
| Templates | `agentco init --template <name>` = copy the directory |
| Sharing / reversing | send the directory, or push it to git |

The one thing to be careful about when exporting a template: **don't include `.state/`** (session, secrets) and **don't include `artifacts/`** (someone else's specific results). Do include: `company.yaml`, `layout.json`, `roles/`, `skills/`, `knowledge/shared/`.

Should `knowledge/agents/` be included? **Yes, it should be** — that's exactly the "hard-won experience" that makes a template worth more than an empty folder, and it's where switching-cost value forms.

---

## 7. Implementation

- **SVG + vanilla JS**, no canvas library. Keeps the "no build step" constraint from `SPEC-ui.md` §5. Roughly 400–600 lines.
- Dragging a node: update the coordinates in memory, **debounce ~800ms**, then `PUT /api/layout`. Don't write on every frame.
- Wires: a Bezier curve from the source node's bottom port to the destination node's top port.
- First-time auto-layout: Assistant on top, agents arranged in a row below, knowledge centered at the bottom.
- The canvas **auto-generates nothing** other than `layout.json`. Adding an agent on the canvas → writes `roles/<id>.yaml` from a template; deleting an agent → asks whether to also delete the yaml file (default is to **keep it**, only removing it from the layout).

### New API

```
GET  /api/layout          → shape + metadata to draw with (does NOT write a file)
PUT  /api/layout          → overwrite (debounced 800ms client-side)
POST /api/agent           → creates roles/<id>.yaml + wires it from the Assistant
DELETE /api/agent/:id     → ?keepFile=true|false (defaults to KEEPING the file)
GET  /api/knowledge       → browse the store for the knowledge drawer (0 tokens)
```

### The wiring rule is enforced on the SERVER, not just on the canvas

The canvas makes agent→agent **physically impossible** (an agent node has no output port — verified: `out: 0`). But the UI is a client, and anyone can `PUT` directly. For the economic rule to actually be a rule, it has to live in `sanitizeEdges()`. Verified with a direct `PUT`: agent→agent, agent→assistant, assistant→knowledge edges all get silently dropped, only valid edges get written.

`POST /api/agent` takes a user-typed name and uses it as a **filename** → the id has to pass through `slugRoleId` + `isSafeRoleId` (`^[a-z0-9][a-z0-9_-]{0,39}$`).

### Three safeguards are mandatory because the canvas adds write endpoints

The daemon binding to `127.0.0.1` does **not** mean only you can call it: any web page open in your browser can `POST` to `localhost`.

| Safeguard | Blocks what |
|---|---|
| `Sec-Fetch-Site` / `Origin` on every write method | a rogue page assigning tasks that burn tokens, deleting employees, cutting every wire |
| `Host` must be localhost/the bound host | DNS rebinding (an attacker's domain resolving to 127.0.0.1) |
| `ArtifactStore.resolve` is jailed to `artifacts/`, blocks segments starting with `.`, and compares against the RESOLVED path | `?path=.state/assistant-session.json` — `safeJoin` let this through because `.state/` sits **inside** the company directory; and `?path=office.yaml`, `roles/*.yaml` — the old `readArtifact` let all of these through because it only blocked leading dots. → `SPEC-artifacts.md` §6 |

The CLI and the Telegram bridge don't send `Origin`/`Sec-Fetch-Site`, so they're unaffected — verified with `agentco stop`.

---

## 8. Out of scope

- **Cross-office** (Assistant talking to Assistant). This is exactly the agent-to-agent problem the architecture is designed to avoid — it needs its own design, not a canvas extension. Logged in the roadmap for M3+.
- Multiple Assistants in one office
- Drawing characters / character animation — **deliberately not doing this**. Nodes are enough, and far cheaper.
- Editing knowledge content by dragging nodes
