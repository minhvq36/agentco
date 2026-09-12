# SPEC — Interface

> **⚠ LOCKED IN 15/08/2026 — the stack and layout changed. Read §0 first.**

## 0. Stack and layout — **ALREADY IMPLEMENTED** (Batch 2, 15/08/2026)

| Part | Where |
|---|---|
| App shell, plan strip, toasts, empty states | `web/src/App.tsx` |
| SVG canvas + mouse interaction | `web/src/canvas/` |
| State + SSE | `web/src/lib/store.ts` |
| API client (doesn't swallow errors) | `web/src/lib/api.ts` |
| Sidebar + 6 panels | `web/src/components/` |
| Daemon serving `web/dist` | `src/server/static.ts` |

Commands: `npm run build:all` (backend + UI) · `npm run dev:web` (Vite 5173, proxying `/api` to 7317).

### Stack: React + Vite + Tailwind v4 + shadcn/ui

Drops the "no build step" constraint from §5. Reason: six new screens (collapsible
sidebar, switching offices, multi-stream logs, the layered prompt view, warning
dialogs, canvas) inside one type-checkless `String.raw` template would come out to
~2,500 lines nobody could maintain — and the four new quality criteria
(`SPEC-2026-08-14-agentco.md` §1) demand exactly what shadcn/Radix give you for
free: focus traps, aria, no layout jumping.

```
agentco/
├─ src/                backend TS, as before
└─ web/                new
   ├─ src/App.tsx
   ├─ src/canvas/      HAND-WRITTEN SVG, no canvas library
   └─ src/components/ui/   shadcn copied in
```

`npm run build` = `tsc` + `vite build`. The daemon serves `web/dist` statically.

**Non-negotiable performance constraint:** dragging a node updates `transform`
through a `ref`, **never** `setState` on every frame. React owns the shell; the
canvas owns its own mouse loop. 60fps even while the company is running.

### Layout: collapsible left sidebar

Chat, log, company overview, and knowledge all move into the **left sidebar**.
Clicking an entry shows it; there's always a ✕ button to close it and give the
whole screen back to the canvas.

The bottom bar (plan + chat) from v0 disappears — it permanently claimed space for
something the user only needs occasionally.

The two buttons `Arrange` / `Fit to frame` become **icons**, no text.

### Seven tabs, and THREE STORES sitting side by side (19/08 · Settings added 03/09)

```
Talk to the Assistant · Work log · Company overview · Document library · Results · Knowledge base · Settings
                                                       └────────── three stores ──────────┘
```

**Settings shows up EVEN WHEN THERE IS NO OFFICE YET** — the same exception as
Overview, and for the same reason: it belongs to the **company** level, not the
office level. A fresh install lands on an empty screen, and interface language is
something the user needs to pick **before** creating their first office — forcing
them to create an office before they can change the language forces them to read a
screen in a language they didn't come there to use.
→ `web/src/components/Sidebar.tsx §tabs` · `docs/CLAUDE.md §Language`

#### Settings holds TWO switches, and they are kept in two different places (10/09)

| | what it changes | where it is kept | who else sees it |
|---|---|---|---|
| **Interface language** | the words on screen | `company.yaml → language` | every browser on this company |
| **Appearance** — dark · light | the colours on screen | `localStorage: agentco.theme` | this browser only |

That split is not an oversight, it is the same rule `agentco:view` and
`agentco:office` already follow: **a choice about a MACHINE lives on the
machine.** Two people opening one company from two laptops, one in a dark room
and one by a window, are not in disagreement — and putting the theme in
`company.yaml` would have one of them switching the other's lights off. It
touches no daemon state, no `company.yaml`, no prompt and no user data.

##### 🔴 DARK IS THE DEFAULT, AND THE MACHINE DOES NOT GET A VOTE

Two rows, dark first. There is deliberately **no "follow the system"**, and
`web/src/index.css` carries **no `prefers-color-scheme` at all** — `test/
theme-tokens.test.ts` fails the day one reappears, in the stylesheet *or* in the
server's "not built yet" page.

The first cut did follow the machine when nothing was stored, and it was wrong
within a day of testing:

> *"My machine is on the light theme, but I want the app to default to dark.
> Why does Ctrl+Shift+N still come up light?"*

A private window has no storage and no extensions, so the app fell straight
through to whatever the browser reported. **"I cleared everything" has to mean
"back to what agentco looks like", not "back to what Windows thinks."** Those
are two different questions and only one of them is ours to answer.

⇒ **`@theme` holds the DARK palette** — it is the base, so every path that ends
in "no attribute on `<html>`" (blocked site data, a private window, the inline
script never running, someone opening the file by hand) still lands on the
product's own colours. Light is one override block and is the only deviation.

⚠ That also deleted a trap the three-state version had to carry: a media query
cannot be a member of a selector list, so "system dark" and "chosen dark" needed
the same 15 declarations written **twice**, plus a load-bearing rule about which
block came first. One base and one override needs neither.
→ `web/src/lib/theme.ts` · `web/src/index.css` · `test/theme-tokens.test.ts`

⚠ **NEITHER SWITCH CARRIES A SCOPE SENTENCE** (user, 10/09 — pruned as screen
clutter). Both were true and both still are; what they were for is recorded in
`SettingsPanel.tsx` rather than lost with them, because the boundary itself is
load-bearing: someone who flips the language, sends a message and gets a reply
in the other language has found a bug as far as they are concerned, and
`docs/CLAUDE.md §Language` is why that is the correct behaviour. The sentence is
the cheap answer to that support case on the day it actually arrives.

⚠ **The room does not follow any of this.** `.office-root` pins every app colour
token to its light value, because an office is a lit place (→ `office.css`). The
theme switch reaches the canvas, the panels and the chrome; it does not reach the
room, and that is the user's call, not an oversight.

The three stores are the three most easily confused concepts in the product,
distinguished by exactly one question: **who puts the file there?**

| | who writes | what the user can do |
|---|---|---|
| Document library | THE USER | add · delete |
| **Results** | THE EMPLOYEE | delete |
| Knowledge base | the AGENT extracts it itself | edit · delete |

Standing next to each other, the difference reads at a glance; scattered across
three places, the user has to remember it. **Results sits in the MIDDLE** because
it's the only one with both ends: the employee reads documents above, and
whatever gets learned becomes knowledge below.

Each drawer has a line at the bottom stating what it IS and pointing to the
others. **0 tokens** — lives entirely in the UI. → `SPEC-artifacts.md`

### The company's name is edited WHERE IT IS WRITTEN — no pencil (10/09)

Double-click the title top-left, type, **Enter**. `Escape` cancels, clicking away
saves. There is deliberately **no pencil button beside it**, and the office
picker two centimetres away deliberately still has one:

| | renaming an OFFICE | renaming the COMPANY |
|---|---|---|
| what moves | the directory, and with it the `id` | nothing |
| who else has to be told | every tab (`refreshCompany`), old receipts keep the old id | the title, and only the title |
| door | pencil → dialog | edit in place |

A dialog is the right weight for an act with consequences. For a label that
moves not one byte it is three clicks for a rename, and a **second** pencil
beside the first would only make people wonder which of the two names they are
about to change. → `Header.tsx §CompanyName` · `Company.updateName`

**Empty is a legal value and means "unnamed"** — the title goes back to
`t('company.unnamed')`, a label that follows the interface switch. That is how
somebody who typed a name by accident gets back to the default, so `PATCH
/api/company` tests `name !== undefined` and never `if (name)`.

⚠ **Escape must not escape.** `App` listens for Escape on `window` and stops the
running work with it — the reflex a Claude Code user brings with them. The rename
box calls `stopPropagation`, or cancelling a typo would kill the job as well.

### Shutting down ends on a SCREEN, not on an error (10/09)

Confirm → the daemon exits → **one quiet line, and nothing else**: no icon, no
border, no Retry. There is no daemon left to serve a Retry, so any control drawn
here would be a control that does not work.

⚠ **`poweredOff` is tested BEFORE `fatal`, and the flag is raised BEFORE the
request.** Shutting down kills the SSE stream a beat later, so `es.onerror`
fills `fatal` in with *"lost connection to the company"* — an alarm, for
something the user just asked for on purpose. Get either order wrong and the
last thing anybody sees when they close agentco is an error screen.
→ `store.ts §AppState.poweredOff` · `App.tsx`

### The sidebar is RESIZABLE — width is content, not decoration

336px is enough for one line of chat, **not** enough for what the Assistant
actually returns: a list of commands, a multi-step plan, an end-of-run report.
That kind of content doesn't shrink gracefully — it just wraps ugly. So width has
to be something the user controls:

- a **drag handle** on the right edge, a 7px hit zone, the line only shows on
  hover (a bold line running the full height of the screen at all times is visual
  noise)
- an **expand button** jumps straight to the wide width (720px) and back
- **double-click** the handle → back to default
- remembered in `localStorage`; clamped when the window shrinks, otherwise the
  canvas disappears entirely with no way to get it back

> **Performance constraint, identical to the canvas rule:** width **while
> dragging** goes straight into the DOM through a `ref`, not through `setState`.
> A `setState` on every drag frame re-renders the entire React tree 60 times a
> second **while SSE is still firing events in**. React only learns the new width
> when the **mouse is released**.

### Messages must preserve line breaks

Chat bubbles use `white-space: pre-wrap`. This is **mandatory**, not aesthetic:
multi-line responses the backend builds in code — `/help`, a plan's step list, an
end-of-run report — use real newline characters, and HTML collapses all
whitespace into a single space. Without this, `/help` renders as one unreadable
run-on block of text.

Paired with `break-words`: long file paths and URLs have no spaces to break on;
without it, the bubble stretches out and pushes the whole panel into a horizontal
scrollbar.

The backend carries a matching constraint: `helpText()` lays out **the command
name on its own line, with the description indented on the line below** instead
of column-aligning them. Column-aligning with spaces only works with a monospace
font, and the chat bubble uses a regular font — and this same command set also
runs through Telegram, which is even narrower.

### Markdown links: `[label](https://…)` — a SIXTH rule, and the only one that leaves the machine (08/09)

The same renderer, both surfaces (chat and the `.md` preview). The reason is the
same shape argument tables were added on: a worker with web access produces a
comparison and puts its sources under it, and printed raw the reader has to pick
a URL out of the middle of a sentence while the `[…](…)` brackets read as noise.

**Two mechanisms, and neither is optional:**

| | |
|---|---|
| `http`/`https` **allowlist**, at PARSE time | The text is model-generated — the premise that already forbids `dangerouslySetInnerHTML` here. `javascript:` is a valid URL in a markdown link; React strips it today, with a warning, but that is a library's courtesy, not our gate. A blocklist would need `data:`, `file:`, `vbscript:` and whatever is invented next; an allowlist needs nothing. ⚠ **Refused = printed verbatim**, never dropped: a link the interface will not open must not become one the reader cannot see |
| the destination is **readable before the click** (`title`) | `[your invoice](https://evil.example)` is legal markdown, and the label and the address are two different strings the model wrote. Plus `rel="noopener noreferrer"` — without `noopener` the opened page can navigate this one, and this console drives the whole company with no authentication beyond "same machine" |

⚠ **This does NOT reverse *"only a path CODE placed there is clickable"*.** That
rule protects an assertion about the **user's own files** — underlining a path
says *"this result exists, here"*. An external link asserts only *"the author
wrote this address"*, and it is shown as one. Result paths keep their own,
separate mechanism (`master.message.files`).

⛔ Still not supported, on purpose: reference links (`[a][1]`), bare autolinking
of a naked URL, images, and a URL containing brackets or spaces. A balanced-paren
scanner is a parser; this is a rule in a file whose whole argument is *"the
smallest surface breaks least"*.

### Markdown tables: THE WHOLE TABLE OR NOTHING (20/08)

The hand-written markdown renderer (`markdown-core.ts` + `markdown.tsx`, shared by
the chat box and the `.md` preview window) gains a **fifth rule**: tables. The
reason is data, not preference — tables are a real shape of what employees
actually produce: terminology tables, expense tables, price-comparison tables.
Showing the raw `|` characters forces the user to mentally build the table
themselves, right when they've opened the `.md` file specifically to **review it
before sending it to a client**.

**Detection requires THREE conditions**, and missing any one falls straight back
to plain text, shown verbatim as before:

1. the current line has `|`
2. the line **immediately after** is a separator line (`|---|:--:|`) — and **it
   too must have `|`**
3. the two lines' column counts **match**

> The second half of condition 2 exists so two harmless lines like
> `pick coffee | milk tea` + `---` don't turn into a one-column table. A lone
> `---` is a horizontal rule / setext heading — two things this renderer
> **deliberately doesn't support**, so they must keep rendering as plain text.
> Free bonus: for a table of two or more columns, the mandatory separator line
> already has a `|`.

Why this is strict: **a table rendered with misaligned columns or missing cells
is a FALSE claim about the data** — a reader trusts a rendered table far more than
they'd trust a pile of `|` characters. Showing it as raw text is ugly but honest,
and the user immediately sees *"this part didn't render."*

**Body** rows go the other way, and are lenient: a missing cell gets padded
empty, an extra cell gets truncated (matching GFM). The strictness sits at the
point of **deciding "is this a table at all"**; once that's decided, one uneven
row isn't worth throwing away the whole table.

#### Two anti-breakage layers — and both are required

1. **`overflow-x-auto` + `max-w-full` on the outer wrapper** — the same rule
   already applied to code blocks: wide content scrolls **inside its own block**.
2. **A bubble containing a table must have a FIXED WIDTH** (`block w-full`), not
   `inline-block` shrinking to content. With `inline-block`, the wrapper's width
   depends on what's inside it — `max-w-full` has nothing to anchor to, and layer
   1 stops working.

Thanks to that, **a panel shrunk down to `MIN_W` = 300px still only scrolls the
table horizontally inside itself, and never pushes the sidebar wider** — the
panel body is `flex-none` with an explicit `width` and `overflow-hidden`, so
nothing inside it has any way to stretch it.

The bubble only widens **when the message actually has a table** (`hasTable()`):
a bubble taking the full width for the sentence *"Done."* would look like a
layout bug. And `hasTable()` goes through the **exact same `blocksOf`**, not a
separate regex — two parallel detection methods will eventually drift apart, and
that's exactly when the bubble would widen for something the rendering layer
decided to show as plain text.

### One input, ONE focus ring (20/08)

The user: *"the chat box border looks thick when focused, two parallel orange
lines feel crude."* Correct, and the cause is worth recording.

The input field was getting **two** focus indicators stacked on top of each
other: `focus:border-accent` (a 1px orange border) in `ui/misc.tsx`, plus a
baseline rule `:focus-visible { outline: 2px; outline-offset: 2px }` — two orange
lines 2px apart, which the eye reads as one ~5px thick border.

> 🔥 **`misc.tsx` ALREADY HAD `focus:outline-none`, and it had no effect.** Not a
> specificity issue but a **cascade layer** one: Tailwind v4 puts utilities inside
> `@layer utilities`, while plain CSS in `index.css` sits **outside every layer**
> — and a style outside any layer **beats every style inside a layer**, regardless
> of specificity. Whoever wrote that line genuinely believed it had turned the
> outline off.
>
> **General lesson:** once `@import 'tailwindcss'` is in effect, any plain CSS
> rule written after it is the **highest-priority rule in the whole app** — it
> has to be treated that way, and no utility class should be expected to override
> it.

Fixed with one rule scoped to the input field: drop `outline`, keep the color-
changing border, add a soft glow **hugging the border** (`box-shadow 0 0 0 3px`).
No gap, no second line. The glow is mixed from `accent` itself via `color-mix`
rather than using `--color-accent-soft`: on the dark theme, `accent-soft` is a
dark brown sitting on `panel`, and nearly disappears.

Buttons are **deliberately** excluded from this rule — they're solid fills, and
an outline ring around one reads correctly as *"currently selected,"* not as a
thick border.

### Result paths in chat are CLICKABLE — but only paths CODE placed there (20/08)

Mechanism details in `SPEC-artifacts.md` §2.5. The UI-facing part:

- A message carrying `files` turns each matching line into **a full-width
  button** (`w-full`) — an 8px-tall target means the user misses the click and
  concludes it isn't clickable at all. `break-all` because long paths have no
  spaces to break on, and a button that can't wrap would stretch the bubble wider.
- A line that **doesn't** match any file goes through `Markdown` like any other
  message. No branch here is allowed to change today's rendering.
- ⛔ The UI **never** scans text for paths on its own. See §2.5 — that's exactly
  how a sentence the model made up borrows the UI's credibility.

### Errors must LOOK like errors

Error toasts have a **colored background** (`danger-soft`) and a `danger` border,
`role="alert"`, `aria-live="assertive"`.

The earlier version used the `panel` background — identical to every other
toast — and only changed the color of a 16px icon. A user clicks "Add employee,"
the name already exists, the toast pops up looking like an ordinary
notification, and they **freeze thinking the app hung** instead of reading that
an error just happened.

The "good error handling" criterion demands every error state *what happened +
what to do next*. The first step of that is **being able to tell it's an error at
a glance** — otherwise no matter how well-written the text is, no one reads it.

### Deletion always has two levels, and the safe one comes first

For both offices and employees: **Archive** (put away, recoverable) · **Delete
for good** (gone permanently). → `SPEC-offices.md` §3.1, §5.1

- Two **separate buttons**, not one button followed by a prompt. Two genuinely
  different intents deserve two different paths.
- The "Delete for good" button carries `variant="danger"`; the confirmation
  dialog **states what will be lost**, and **points toward the Archive option**
  for anyone who clicked it by mistake.
- The "In archive" list uses a **dashed** border — visibly not a normal state at
  a glance.

### Cost: merged for DISPLAY, not merged in DATA

Cost line items with no office left (deleted for good, or a record predating
office splitting) get collected into **one collapsible block**: *"N items with no
office · $X · click to view"*.

Without grouping, the table fills up with dead names after a few months. But
**adding them into one line** loses the office code — and for a deleted office,
that code is the **only remaining clue** to what job that money was for.
Collapsing keeps both, at zero accounting-code cost — it's just a `<details>`.

**Archived** offices still show in the main list with a *(archived)* label:
they're still recoverable, and still have a name.

### The log follows the WORK, not the timeline

→ `SPEC-offices.md` §6. Every agent (including the Assistant) gets a stable color
hashed from its id. The log filters by `plan_id`; the conversation is its own
stream (`plan_id: null`).

### Deliberate exception: the plan strip does NOT live in the sidebar

The §6 checklist demands answering *"which step am I on"* **with no click
required**. Stuffing the plan into a collapsible panel violates exactly that.

So the plan lives in a **thin strip overlaying the canvas**, only showing while a
job is running, and clicking it opens that job's own log. The hint line for new
users hides itself automatically once this strip appears — when two things
compete for the same space, whatever is actively running wins.

---

> **⚠ §1–§2 HAVE BEEN REPLACED by [`SPEC-canvas.md`](SPEC-canvas.md).**
> The list-based layout described below is the v0 version currently running. The
> next version is a **node-based canvas** (n8n-style) — the company becomes a
> drag-and-drop diagram, and the architectural constraint (star topology, agents
> never wire to agents) becomes something *impossible to draw* instead of a line
> in a document.
>
> The following sections are still valid: §3 log drawer · §4 knowledge drawer ·
> §5 technical & SSE events · §6 anti-confusion checklist.

Read alongside `SPEC-2026-08-14-agentco.md`.

**Guiding principle:** the user sees **a company at work**, not a terminal
scrolling logs. But the advanced log is always one click away — not hidden, just
not thrust forward.

This is also the root pain point found in the 03/08 session: *"a non-technical
person gets confused, not knowing where they're being led or how far the AI's
scope reaches."* This entire UI exists to answer four questions: **where am I,
who's working, how much further, is this the right direction.**

---

## 1. Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Content Studio          ● 3 running   ⏱ 4m12s   💰 62K tokens  ⚙  │
├──────────────┬───────────────────────────────────────────────────────┤
│              │                                                       │
│  TEAM        │   ┌─ PLAN ──────────────────────────────────────┐  │
│              │   │ "write 3 fanpage posts about product X"       │  │
│  🔎 Research │   │                                               │  │
│     ● busy   │   │ ✓ 1. Research the product and customers       │  │
│     T-01     │   │ ⟳ 2. Research competitor posts     ← running  │  │
│              │   │ ○ 3. Write 3 drafts                            │  │
│  ✍ Writer    │   │ ○ 4. Review and adjust tone                    │  │
│     ○ idle   │   └───────────────────────────────────────────────┘  │
│              │                                                       │
│  🔍 Reviewer │   ┌─ IN PROGRESS ──────────────────────────────────┐  │
│     ○ idle   │   │ 🔎 Researcher                                  │  │
│              │   │    Reading 4 pages in the same industry...     │  │
│  📚 Librarian│   │                                               │  │
│     ○ idle   │   │ ✍ Writer                                       │  │
│              │   │    Waiting on research results                 │  │
│  + Add       │   └───────────────────────────────────────────────┘  │
│              │                                                       │
│              │   ┌─ TALK TO THE MANAGER ──────────────────────────┐  │
│              │   │ > _                                            │  │
│              │   └───────────────────────────────────────────────┘  │
├──────────────┴───────────────────────────────────────────────────────┤
│  ▸ Detailed log (12)                                  ▸ Knowledge (48)│
└──────────────────────────────────────────────────────────────────────┘
```

The two bottom bars are **drawers**, collapsed by default.

---

## 2. Four areas

### 2.1 Plan — the heart of the UI

Exactly as envisioned: **a short 1. 2. 3. 4. plan, showing where it's headed.**

- The Master generates a plan with **at most 6 steps**, each **≤10 words**. This
  is a constraint in the Master's prompt, not a suggestion.
- Status: `○ not started` · `⟳ running` · `✓ done` · `⚠ has an issue` ·
  `⏸ waiting on you`
- A step with multiple sub-tasks running in parallel → shows `⟳ 2/3`
- Clicking a step → opens details: which task, who's doing it, what file comes
  out, how much it cost

**"Preview plan" button (`--plan-only`):** once the Master finishes planning, it
**stops and waits for approval**, without spending any execution tokens yet. The
user edits/removes steps, then clicks Run. Toggleable in settings; **ON by
default** for new users — this is exactly "scope control," the reason the product
exists.

### 2.2 Team

A list of roles, like a staff roster. Each person: avatar, name, status, current
task.

Clicking a person → their employee card:
- **Pitch** (`pitch` from the role yaml)
- **Skills** — pick a level, `short / medium / formal`, changed in place
- **Personal experience** — the `k/agents/<role>/` nodes, readable and editable
- **History** — the 20 most recent tasks, average cost
- **Advanced** — model tier, budget, tools, MCP

This is the main "modding" surface for advanced users, but presented as an HR
profile, not a config file.

**Two mandatory constraints when editing skills:**

1. **NO autosave on every keystroke.** There must be an explicit **Save** button.
   Every save bumps the cache key → pays one cache write. Autosave would mean
   constant cache churn — expensive and slow.
2. **The core layer shows in read-only mode**, clearly labeled "this part
   guarantees the system runs at the right cost — not editable." Don't hide it:
   advanced users need to **see** it to trust it, they just can't edit it. See
   `SPEC-2026-08-14-agentco.md` §3.

`concierge` **does not appear** in this list — it's a tool of the Master, not an
employee.

### 2.3 In progress

A live stream of worker status. **Each line is the `say` field from a
receipt/progress event — generated by the worker itself, with no extra LLM call
spent "translating it into something friendlier."**

Display rules:
- An agent only ever keeps **one current line**, updated in place, never scrolls
  endlessly
- No tool names shown, no JSON shown, no long paths shown
- An agent waiting on a dependency → shows explicitly "Waiting on research
  results," never left blank
- `⏸ waiting on you` → floats to the top, with an immediate reply button

### 2.4 Talk to the manager

A chat box with the Master. This is the same channel as Telegram, just in web
form. One session, one run.

Shows in the corner: `context 23K / 60K` — as it nears the limit it warns "memory
compaction coming up," so the user isn't caught off guard when the Master
forgets older details.

---

## 3. Detailed log drawer

Opens into the full advanced log. Three levels, chosen via tabs:

| Level | Contents |
|---|---|
| **Events** | task start/end, Master decisions, errors — a timeline table |
| **Conversation** | the raw transcript of each worker, selectable by task |
| **Cost** | the `agentco cost` table, in web form: token in/out/cache by task, warnings for abnormal cache writes |

The **Cost** tab must be easy to find and easy to read — this is what keeps the
product from silently getting more expensive, and it's what advanced customers
value most.

### 3.1 🔴 A NON-SHRINKING BLOCK EATS ALL THE SPACE OF THE ONE THAT CAN SHRINK (bug 21/08)

A run's detail panel is a flex column with **five** blocks, and four of them are
`flex-none`: header · step strip · token table · **the Assistant's summary
sentence**. Only the event log is `flex-1`.

The result the user hit: a 30-line report takes up 30 lines, and the log gets
squeezed down to almost nothing.

> *"If this result sentence is long, it takes up all the space above so I really
> can't tell what the workers are saying to each other (it feels like I can't
> scroll or use the wheel). I can only manage by dragging the window wider."*

Widening the window means fewer text wraps ⇒ the report gets shorter ⇒ the log
gets its space back. In other words, **the layout was making the user resize the
window just to read the content** — the same failure class as the rule *"a
cleanup action the system owns must never fall on the user's hands"*
(§SPEC-canvas).

**Three layers, and all three are needed:**

| | Why it can't be dropped |
|---|---|
| Report **collapses by default** (`max-h-[4.5rem]`) + a *View full* button | the log keeps nearly the full height right when it opens — which is what people open this panel to see |
| Report **caps at 40%** even when expanded, scrolling internally | still leaves 60% for the log even with the longest report |
| Log has a **floor** of `min-h-[8rem]` | a ceiling alone isn't enough: at a short window height, the two sides fight over space again |

> ⚠ **Use `max-h` when collapsing, NOT `line-clamp`.** `line-clamp` runs on
> `-webkit-box` and is only reliable with one continuous flow of text; the report
> goes through `Markdown`, so it's made of multiple block-level elements —
> clamping there either cuts nothing or cuts at an unpredictable point.

> **LESSON: inside a flex column, every `flex-none` block is a promise that its
> content will NEVER be long.** For model-generated content, that promise is
> always false. Content of unpredictable length ⇒ needs a cap plus its own scroll
> track, and the flexible block needs a floor.

The report also renders through `Markdown` rather than printing a raw string —
it's text the Assistant wrote, with bullet points, paths, sometimes even a
table, exactly like the chat box.

### 3.2 `- [ ]` task lists in markdown (21/08)

Exercise 6 produces exactly this (*"collapse it into a short checklist"*), and
printed verbatim the user gets back raw characters instead of a list readable at
a glance. Present in **both** the chat box and the results-file preview window —
they share one `Markdown` renderer.

| Decision | Why |
|---|---|
| The checkbox is drawn with **CSS**, not `<input type="checkbox">` | `<input>` doesn't respect the color palette by default (shows the OS's blue), and `disabled` renders as gray as if something's broken |
| **NOT clickable**, deliberately | the Results drawer is a **READ-ONLY** window. Making it clickable opens a second write path into the same file, and it will sooner or later drift from what the agent actually wrote. Same reason the document library has no editor |
| `sr-only` states *"done / not done"* | a screen-reader user needs to **hear** the status, not just see a ✓ mark |
| A finished item gets **strikethrough, not faded** | it still has to be readable — this is what you just did |

⚠ Two regex traps, both already stepped on: requiring a **space after `]`**
(without it, `- [x]abc` — a reference inside technical prose — would also match),
and content must start with **`\S`**, not `.` (`.` also matches whitespace, so
`- [ ]` followed by a few stray spaces would create an EMPTY task; a test caught
this on the first pass).

---

## 4. Knowledge drawer

A knowledge-graph browser. Two modes:

**List** (default) — a table: title, type, scope, confidence, times used,
updated. Filterable by `shared` / by role. Search uses an index, 0 tokens.

**Graph** — nodes + links, `shared` in one color, each role its own color. Node
size scales with `hits`. View-only, not an editing tool.

Opening a node: markdown rendered, editable in place, with `Pin` (adds it to the
charter) and `Discard` buttons.

**Manual document ingestion:** drag-and-drop a file into this drawer → runs a
`librarian` task that splits the document into ≤250-token nodes and tags them.
There's a preview screen before it commits — the user sees a 20-page document
turn into 34 nodes and reviews it.

---

## 5. Technical

- **Web app runs locally**, served by the daemon itself on `:7317`
- **SSE** for one-way event streaming (simpler than WS, sufficient; WS only if
  high-frequency two-way input is ever needed — not currently needed)
- Stack: as light as possible. No SSR, no complex router. **The UI must not be
  something that eats up the first week.**
- **No complex build step for v1.** Prefer bundling once, serving statically.
- No auth in v1 (binds `127.0.0.1`). Binding `0.0.0.0` (VPS mode) →
  **mandatory login token**, the daemon refuses to run without it.

### SSE events

```
plan.created     { plan_id, steps[] }
plan.step        { step_idx, status }
task.started     { task_id, role, say }
task.progress    { task_id, say }
task.done        { task_id, status, say, artifacts[], usage }
task.blocked     { task_id, reason, question? }
master.message   { text }
knowledge.changed{ count, version }
cost.tick        { session_totals }
```

**`say` is a mandatory field on every user-facing event.** No `say` → the UI
shows nothing. This constraint forces everything displayed to already be in
plain language right at the source.

---

## 6. Anti-confusion checklist

Every screen must answer these, with no click required:

- [ ] Which step, out of how many, am I on?
- [ ] Who's doing what right now?
- [ ] How much has this cost so far?
- [ ] Is anything waiting on me?
- [ ] Where do I click to stop? → **the Stop button must always be visible, never
      buried in a menu.**

---

## 7. Out of scope for v1

- Multiple runs in parallel (v1: one run at a time)
- Multiple users / access control (that's the enterprise direction, see
  `ROADMAP.md`)
- Editing the graph via drag-and-drop nodes
- A dedicated mobile interface — **Telegram is the mobile version**
- Custom themes
