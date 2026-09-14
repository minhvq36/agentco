# SPEC — CLI & Process model

Read alongside `SPEC-2026-08-14-agentco.md`. This file defines how the software **runs**: the process, the commands, the configuration, and the path to a container.

---

## 1. Process model

**A single daemon** owns everything. No helper process holds any state.

```
┌──────────────────── agentcod (daemon) ─────────────────────┐
│                                                            │
│  Claude Agent SDK runtime  ── master session                │
│                            └─ worker runs (parallel)         │
│  Scheduler + warmSet cache                                  │
│  Knowledge index (in-memory, watch file)                    │
│  HTTP + SSE server        :7317   ← web UI                  │
│  Control socket           local   ← CLI subcommands         │
│  Chat bridges (optional)          ← telegram long-poll      │
└────────────────────────────────────────────────────────────┘
                     ▲
                     │ read/write
              ┌──────┴───────┐
              │  company/    │  all state lives here, no DB
              └──────────────┘
```

**Why a single daemon:** `warmSet` (the map of which cache is currently warm) and the master session **have to live in memory**. Every CLI command spawning its own process is exactly the `claude -p` trap all over again — losing `warmSet`, losing the session, losing the cache.

**CLI = thin client.** Every command (except `start`/`init`) connects to the daemon over the control socket. No daemon running → the CLI asks "run `agentco start`?".

Control socket:
- Linux/macOS: unix socket `company/.state/agentco.sock`
- Windows: named pipe `\\.\pipe\agentco-<hash(companyPath)>`

Process state is written to `company/.state/daemon.json` (`pid`, `port`, `started_at`, `version`). A stale pid gets cleaned up automatically.

### 🔴 NOTHING WE SPAWN ON WINDOWS MAY SHOW A CONSOLE WINDOW (10/09)

Reported as *"start makes a terminal flash for a moment and then the browser
opens"*, and the user named the real cost: it is what somebody sees after
double-clicking an icon, and a black window appearing and vanishing **looks
like something leaked out of the app**.

Two spawns did it, both through `cmd.exe`, which is a **console** application:

| where | why cmd | the fix |
|---|---|---|
| `cli/daemonfile.ts §reveal` — opens the browser and the office folder | `cmd /c start` | drop `detached` on Windows, add `windowsHide` |
| `core/armexec.ts §run` — pre-installs an MCP package | `shell: true`, because `npm` is really `npm.cmd` | add `windowsHide` |

**Why `windowsHide` alone was not enough in the first one, and is enough in the
second.** The two options fight:

- `detached: true` → libuv passes `DETACHED_PROCESS`: the child inherits **no
  console**, so `cmd` allocates a fresh one — and an allocated console is a
  visible window.
- `windowsHide: true` → `CREATE_NO_WINDOW`: a console **with no window**. It
  describes a console the child was given; with `DETACHED_PROCESS` there is no
  such console, and the flag has nothing to act on.

⇒ passing both changes nothing, which is exactly why this reads like a flag that
does not work. `reveal` drops `detached` on Windows and keeps it on macOS and
Linux — `start` hands the URL to the shell and exits, so the browser is not our
child, and Windows kills no process group on exit the way POSIX does. `xdg-open`
can outlive the call and still needs it.

⚠ **NOT VERIFIED BY MEASUREMENT — verified by reading the flags.** Three attempts
from an agent session failed to see the window at all: counting `conhost.exe`
proves nothing (`CREATE_NO_WINDOW` still starts one, it just has no window),
`MainWindowHandle` was `0` for every variant *including* the one that shows a
window, and `FindWindow('ConsoleWindowClass', …)` returned `0` even for a
`Start-Process` that definitely opened one — a non-interactive session has no
desktop to look at. **The observation has to happen on the user's own desktop.**

⚠ **AND THIS IS ONLY THE CHILD.** If the icon points at `node dist/cli/index.js
start` or a `.bat`, the CLI's **own** console opens and stays — the daemon lives
in it. That is a launcher question, not a spawn-flag one, and it is still open.

---

## 2. Commands

### Init & lifecycle

```bash
agentco init [dir]              # scaffold company/ from a template, ask a few questions about the company
agentco start [--port 7317] [--no-ui] [--daemon]
agentco stop
agentco status                  # daemon, running agents, current shift, warm cache
agentco doctor                  # checks: node version, Claude auth, write permissions, port, bridges
```

`agentco start` defaults to **foreground + auto-opens the browser**. `--daemon` runs it in the background (for VPS use).

### Assigning work

```bash
agentco run "write 3 fan-page posts about product X"
agentco run --file brief.md
agentco run --plan-only        # print the plan only, don't execute — preview then approve
agentco tasks                  # this shift's task list + status
agentco task T-0007            # brief + receipt + artifact
agentco task T-0007 --log      # advanced log (raw transcript)
agentco replay T-0007          # re-run T-0007 and the whole sub-branch that depends on it
agentco cancel T-0007
```

`agentco run` with no arguments → enters **conversation mode** with master right in the terminal (chat-like, for people comfortable with the CLI).

### Team

```bash
agentco agents                 # role table: id, pitch, skill level, tier, tasks completed
agentco agents add <template>  # copy a sample role into roles/ for editing
agentco agents test <role>     # run that role against a sample task, print the cost
```

### Knowledge

```bash
agentco knowledge              # stats: node count, total tokens, by scope
agentco knowledge search "..." # search via the index, 0 tokens
agentco knowledge show <id>
agentco knowledge tidy         # run the Librarian right now (instead of waiting for a full batch)
agentco knowledge bump         # bump knowledge_version → recompute the HOT set
```

### Cost — used often

```bash
agentco cost                   # current shift's table (see SPEC-token-economy §5)
agentco cost --since 7d
agentco bench --baseline       # run the 5 golden scenarios, record a baseline
agentco bench --compare        # re-run, print the delta against the baseline
```

### Chat bridge

```bash
agentco bridge telegram setup  # enter the bot token, print the pairing code
agentco bridge list
agentco bridge allow <chat_id>
agentco bridge off telegram
```

**Pairing is mandatory:** after `setup`, the bot prints a 6-digit code. The user sends that code to the bot from their own account → their `chat_id` gets added to the whitelist. Before pairing, the bot stays **completely silent** to everyone. The code expires after 10 minutes.

---

## 3. Configuration

Priority order: **command-line flag > environment variable > `company.yaml` > default**.

```yaml
# company/company.yaml
name: "Content Workshop"
charter_file: charter.md                     # plain markdown, ≤500 tokens → SPEC-library.md §17

runtime:
  port: 7317
  concurrency: 4
  concurrency_by_tier: { eco: 6, standard: 4, deep: 1 }
  cache_ttl: auto            # auto | 5m | 1h

budgets:                     # override SPEC-token-economy §4
  receipt_tokens: 800
  cold_knowledge_tokens: 3000
  master_compact_at: 60000

models:
  eco:    claude-haiku-4-5-20251001
  standard: claude-sonnet-5
  deep:     claude-opus-5
  master:   standard
  master_deep_steps: [plan, arbitrate]

librarian:
  every_n_tasks: 20
  auto_bump_knowledge: daily

bridges:
  telegram:
    enabled: false
    token_env: AGENTCO_TELEGRAM_TOKEN
    allow: []
```

**Secrets never live in yaml.** Bridge tokens, API keys → environment variables or `company/.state/secrets.json` (chmod 600, listed in the template's `.gitignore`). `company/` is designed to be committable to git — except `.state/`.

Environment variables: every key maps to `AGENTCO_<PATH_UPPER>`, e.g. `AGENTCO_RUNTIME_CONCURRENCY=8`.

---

## 4. Container-readiness (not built yet, but the path must not be blocked)

Docker isn't needed for v1. But **these five constraints must hold from day one**, because violating them and fixing it later is expensive:

1. **No absolute paths.** Everything is relative to `COMPANY_DIR`, read from env, defaulting to `./company`.
2. **No assumption of a display.** `start` must run with `--no-ui` and must not auto-open a browser when `AGENTCO_HEADLESS=1`.
3. **All state lives in exactly one directory** (`company/`) → mounting a single volume is enough.
4. **No mandatory native module.** If one is needed (e.g. better-sqlite3), there must be a pure-JS fallback.
5. **A `/healthz` endpoint** returning `{ok, version, master_session, tasks_running}`.

Also: log to stdout as JSON lines when `AGENTCO_LOG_FORMAT=json`, and trap `SIGTERM` to close the session cleanly (write state, don't lose an in-flight task).

When Docker (v2) gets built, the Dockerfile will just be node-slim + `COPY` + `VOLUME /company` + `EXPOSE 7317`. Nothing needs to be redesigned.

**Auth inside a container:** this is a real sticking point that has to be flagged early — Claude Code auth is tied to the machine. Running in a container/VPS requires getting credentials in somehow (mounting the auth directory, or using an API key). `agentco doctor` has to diagnose this and spell it out for the user, not leave them guessing.

---

## 5. Exit codes & errors

```
0   ok
1   general error
2   bad configuration / missing argument
3   no daemon running
4   Claude not authenticated
5   task failed
6   hit the budget ceiling (blocked, not an error)
7   rate limited after exhausting backoff
```

Error message principle: every error prints **what happened + what to do next**, one sentence each. The customer is not a coder — stack traces are hidden by default, shown with `--verbose`.

---

## 6. Installation

```bash
npm i -g @agent-co-app/cli    # the command it installs is still `agentco`
agentco init                  # creates ./company where you are standing
agentco start

npx @agent-co-app/cli init    # try it without installing
```

> ⚠ **Corrected 14/09/2026 — the earlier `npx agentco` / `npm i -g agentco` never
> existed.** The unscoped name `agentco` belongs to an unrelated npm account
> (`npm view agentco` → another maintainer, 0.0.1). Any doc telling people to run
> `npx agentco` would have run a stranger's package. `agent-co` is not an option
> either: npm refuses a new name that equals an existing one once `-` `.` `_` are
> removed. The scope `@agent-co-app` matches the GitHub organisation and the
> domain, so there is one name to hold instead of two — a free `@agent-co-app`
> beside a package published as `@agent-co` would read as MORE official than
> ours. The command stays `agentco`, because it comes from `bin`, not from the
> package name.
>
> **The package does not exist until the first `npm publish`.** Creating the org
> reserves the namespace and nothing else; until then both `npm i -g` and `npx`
> answer 404. The website must not show the command before that — the same rule
> as `RELEASE_LIVE`.

**Measured 14/09 on Windows**, packed and installed into an isolated prefix:
`npm i -g` took **27.6 s** and **~406 MB** — almost all of it the Claude Code
binary npm pulls in as the SDK's optional dependency (fine under decision ③ of
`SPEC-packaging §2`: the customer's own npm fetches it from Anthropic's
registry, we redistribute nothing). `doctor` found it and a test call went
through; `init` → `start` → `/healthz` `0.1.0` → `stop` → port closed.

⚠ `prepack` deletes `dist/` and rebuilds. `tsc` never removes output for a
source that was deleted, and the working tree held two such files
(`core/master.js`, `server/ui.js`) — a publish from that tree would have
shipped them.

### 🔴 The company follows the directory the command is typed in (settled 14/09)

`resolveCompanyDir` = `--dir` › `AGENTCO_COMPANY_DIR` › `./company`. The
maintainer's call: *"a CLI normally follows the path"*. Kept as it was — the
alternative, a fixed `~/AgentCo`, was weighed and not taken.

⚠ **The cost, stated:** `agentco start` typed in a different folder does not
find yesterday's company. A terminal opens in the home directory by default, so
the common case works; the `.desktop` shortcut below records the absolute
folder, so the GUI case does too. The Windows installer is unaffected — its
`agentco.cmd` sets `AGENTCO_COMPANY_DIR` (`SPEC-packaging §7.5`).

### 6.2 `agentco shortcut` — a menu icon on Linux (14/09)

The npm door leaves a GUI user on Ubuntu opening a terminal every day to start
an app whose whole interface is a browser tab. `agentco shortcut` writes
`~/.local/share/applications/agentco-<hash of the folder>.desktop`.

- 🔴 **Absolute paths only** — `process.execPath` and the CLI's real file. A
  menu entry does not read `~/.bashrc`, so an nvm Node is not on its `PATH` and
  `Exec=agentco start` would silently do nothing. `TryExec` hides the entry once
  that Node is gone; running the command again rewrites it.
- **One file per company**, because companies live wherever `init` was typed.
- **Two escaping layers** in `Exec` (quoting, then the string rule): a `\` in a
  path becomes four. Tested by reading the file back with a reader written from
  the spec, not against a hand-written expected string.
- 🔴 **A launcher with no terminal must still fail out loud** (`SPEC-packaging
  §7.4b`). The entry sets `AGENTCO_LAUNCHER=desktop`; `fail()` then also raises a
  desktop notification through `notify-send`, best-effort.
- ⛔ **Not macOS.** Finder ignores `.desktop`; a Mac launcher is an `.app`
  bundle, a separate mechanism, unmeasured. Not Windows either — the installer
  already adds a Start-menu shortcut.

V2 for people afraid of the terminal: package it as Tauri (~5MB) wrapping this same daemon + UI. Double-click to run. **Nothing gets rewritten** — this is exactly why the UI has to be a web UI from the start.

### 6.1 🔴 THE DESKTOP BUILD SHIPS ITS OWN NODE, BESIDE THE CUSTOMER'S (settled 10/09)

> ⚠ The line above says *"Tauri (~5MB) wrapping this same daemon"*, and taken
> alone it is **not buildable**. Tauri is Rust + the OS webview; it carries no JS
> runtime. The daemon **is** JS. So either the customer installs Node themselves
> — and *"double-click to run"* is then untrue — or the app brings one. This
> section is the missing half, not a change of direction.

**Measured 10/09 on Windows:** `node.exe` **79.0 MB**, the whole `nodejs`
directory (with `npm` and `npx` in it) **91.5 MB**.

#### Three shapes, and only one of them is safe

| | install Node into the SYSTEM | **our own Node inside the app** | ship no Node |
|---|---|---|---|
| customer already has Node | 💀 overwrite · version conflict | **not one byte touched** | fine |
| customer has none | fine | fine | 💀 "double-click to run" is a lie |
| `node` for the CLI sample | ✓ | ✓ | ✗ |
| `npx` for the arm catalogue, **cold path** | ✓ | ✓ | ✗ |
| disk | +0 | +91.5 MB | +0 |
| what it touches on the machine | system PATH, registry, a dirty uninstall | **nothing** | nothing |

The user's call, in their words: *"I don't want to overwrite — customers would
curse me to death."* A developer with `nvm` is exactly the customer who would.

#### The mechanism was already built, for a different reason

`cli-arm.ts §runCommand` spawns with an **explicit `env` that we construct**
(`{...ctx.env, ...a.env}`) — the *"NO implicit env inheritance"* rule written
for the Docker constraint §16p ③. That rule turns out to be the hook: the daemon
hands its children whatever `PATH` it likes, so the bundled runtime is reachable
**only inside processes agentco spawns.** The customer's terminal, their `PATH`
and their `nvm` never learn that any of this happened.

**Ours goes FIRST in that PATH** (user's call). The arm catalogue then never
breaks because the machine happens to carry an old Node — a failure that would
read as *"agentco cannot connect this arm"* and land on our support queue. The
price, stated: a customer whose own CLI arm needs *their* Node gets ours instead.
`agentco doctor` already prints the running Node version and is where that is
made visible, not a comment.

⛔ **"Any Node will do, as long as one exists"** was considered and dropped: it
makes the support surface *every* Node a customer might have, while still not
delivering double-click-to-run. We pin ONE version and own it.

#### Frequent updates decide the FOLDER LAYOUT, not just the runtime

The user's constraint: *"it has to stay convenient and stable for shipping app
updates often."* Two facts follow, and both are about **lifetimes that differ by
two orders of magnitude** — the runtime moves maybe twice a year, the app moves
weekly:

```
<install>/
  runtime/node-v22.12.0/     ← pinned, named BY VERSION, rarely replaced
  app/2026.09.10/            ← daemon + web/dist, replaced constantly
  current  →  app/2026.09.10 ← a pointer, flipped last
```

1. **An update replaces `app/` only.** Put the runtime inside the folder that
   gets replaced and every weekly update re-ships ~90 MB of a Node that did not
   change.
2. **Never overwrite in place — write a new folder and flip the pointer.** On
   Windows a file held by a running process cannot be replaced, and `node.exe`
   is held for as long as the daemon lives. Versioned folders also mean a failed
   update rolls back by flipping the pointer the other way.
3. **Install per-user (`%LOCALAPPDATA%`), not into `Program Files`** — the
   latter asks for UAC on *every* update, which is precisely what "update often"
   cannot afford.
4. **The updater already has its shutdown door**: `liveDaemon()` → `POST
   /api/shutdown` → wait for the process to exit → flip. The UI's power button
   and the "the company is off" screen use that same door (§SPEC-ui).

#### 🔴 TWO DOORS IN, AND THE DAEMON MUST NOT KNOW WHICH ONE IT CAME THROUGH

`npm i -g agentco` does not go away — it stays the path for a VPS, for Docker
and for anybody who lives in a terminal. The desktop installer is a **second
door onto the same daemon**, never a replacement. Which means:

⛔ **Nothing under `src/core/` may hard-code the bundled runtime's location.**
A path like `<install>/runtime/node-v22.12.0/` is true for exactly one of the
two doors, and the code that reads it cannot tell which door it is behind.
`process.execPath` is true for both, always, and is already what
`armexec.ts §fastLaunch` uses — for this same reason, written down before this
section existed:

> `process.execPath`, **not the literal string `'node'`**: the daemon may be
> running on a node build that isn't on PATH.

⇒ the bundled runtime reaches the daemon as **configuration handed in by the
launcher** (an env var it prepends to `PATH`), not as knowledge the core holds.
On the npm door nothing is handed in, and everything still works because the
customer's own Node is what launched us in the first place.

#### 🔴 `PATH` CROSSES INTO A CLI COMMAND. NOTHING ELSE DOES. (fixed 10/09)

This was written up as a separate open item — *"`runCommand` passes no `PATH`;
measure on POSIX before patching, the fix differs by answer."* **Both halves of
that were wrong, and both corrections matter:**

1. **It is not separate.** The launcher puts the bundled Node first in the
   DAEMON's `PATH`; wiping the environment for children throws our own sidecar
   away along with the customer's Node. The shape above **cannot work at all**
   without this. One thing, not two.
2. **The measurement was never a gate.** Both branches want the same patch — if
   POSIX already resolved, passing `PATH` explicitly changes nothing; if it did
   not, this fixes it. Measuring only tells us whether we repaired a live bug or
   prevented one, which changes the release note, not the code.

The mechanism, for the record: libuv replaces `environ` and calls `execvp`,
which reads `PATH` out of the environ it was just handed; absent, glibc falls
back to `/bin:/usr/bin` — so a Node from `nvm`, or a customer tool under `/opt`,
does not resolve. ⚠ **Windows hid it completely**: measured 10/09, all four env
shapes (`{}` included) still resolve a bare `node`, because `CreateProcess`
searches the *calling* process's PATH. A bug that exists only on the platforms
we do not develop on. → [[agentco-three-os-always]]

⛔ **`{ ...process.env, ...declared }` IS NOT THE PATCH**, however much shorter
it reads. The daemon's environment holds `ANTHROPIC_API_KEY`, `AGENTCO_TOKEN`
and OAuth material, and whoever declares a CLI command is not necessarily
whoever owns those keys — a spread hands every key to every command the office
can run, silently, with nothing on screen and nothing in the audit log.
`cli-arm.ts §childEnv` is therefore **an allowlist of one**, and a declared
`PATH` still wins over the ambient one. `test/cli-arm-env.test.ts` asks the CHILD
what it received rather than reading the source — the widening edit looks
harmless as source and is a key leak on the wire. Verified by making it red:
swapping in the spread fails exactly that test and nothing else.
