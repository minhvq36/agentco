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
npx agentco init            # try it out, no install
npm i -g agentco            # actually install
```

V2 for people afraid of the terminal: package it as Tauri (~5MB) wrapping this same daemon + UI. Double-click to run. **Nothing gets rewritten** — this is exactly why the UI has to be a web UI from the start.
