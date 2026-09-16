# AgentCo

**A virtual company of AI employees that runs on your own machine.** You give orders in plain
language; a director plans the work, specialists run it in parallel, and everything they produce
lands in a folder you own. `agentco` is a working codename.

---

## You have already felt this

You hand an AI agent something real. It runs for twenty minutes.

And for those twenty minutes you have no idea **where it is, what it is doing, how much it has
cost you, or whether it has been heading the wrong way since minute three.** You find out at the
end, when it hands you the wrong thing — and the only record of how it got there is a wall of
transcript nobody wants to read.

Then you try to make it useful on *your* work, and hit the second wall: before an agent can touch
your CRM, your invoicing system, your internal API, **somebody has to write an MCP server first.**
So the tool is for developers, and you are not one, or you are one and you have better things to
do.

## Why this is worth the next two minutes

- **It runs on your Claude Code subscription.** Not an API key, not per-token billing, and no
  server of ours anywhere in the path. The daemon on your machine talks to Anthropic directly.
- **Your company is a folder.** `company.yaml`, markdown, JSON. No database — the entire storage
  layer is four runtime dependencies. You can open any of it in Notepad, diff it in git, and back
  it up by copying it.
- **The numbers are measured, not claimed.** [`bench/`](bench/) reproduces every figure in
  [`docs/FINDINGS-sdk-2026-08-14.md`](docs/FINDINGS-sdk-2026-08-14.md), and every PR has to answer
  a token-cost checklist before it merges.
- **1,200+ tests**, and the ones that matter are named after the failure that paid for them.
- **Source-available, and each release becomes Apache 2.0 on its own two years later** — with the
  word *irrevocably* in the licence, so it does not depend on me still being here.

## What it actually is

A director that plans and delegates but does no hands-on work, and workers that arrive, do one
thing, write a file, and vanish:

```
   You ──► DIRECTOR (long-lived, plans, delegates, never does the work itself)
                │ TaskBrief (a DAG)
      ┌─────────┼─────────┬─────────┐
      ▼         ▼         ▼         ▼
   Worker    Worker    Worker    Worker      stateless, parallel
      │ Receipt (≤800 tokens, with a human-readable `say` field)
      └─────────┴─────────┴─────────┘
                │
        KNOWLEDGE GRAPH (markdown + frontmatter — readable, greppable, yours)
```

Workers never talk to each other. Every exchange goes through the director or through an
artifact, and that is an economic decision rather than an aesthetic one: agent-to-agent chatter is
the largest and least controllable source of token burn in every multi-agent system.

You watch it happen as a plan in four understandable steps. The raw transcript and the
per-token cost table are one click away, for the day you want them.

**And it can use your own systems without anyone writing a server.** Paste an OpenAPI link, paste
a cURL command, or fill in a form — then press Test. →
[`docs/SPEC-connectors.md`](docs/SPEC-connectors.md)

---

## Run it

**Requirements:** Node.js ≥ 22, and the Claude Code CLI signed in (`claude` runs). No API key.

```sh
npm i -g @agent-co-app/cli
```

Then, **in the folder where you want the company to live**:

```sh
agentco init
agentco start
```

`init` creates `./company` right there and `start` opens the interface. `npm i -g` installs into
npm's global prefix, so the folder you are standing in stays empty until `init` — that is `init`'s
whole job.

<details>
<summary>Updating, removing, and the Windows installer</summary>

```sh
agentco update              # newest version, then starts the company again
agentco update --to 0.1.3   # or back to a named one, if a release goes wrong
agentco version
agentco doctor              # checks Node, the company folder, Claude Code, sign-in, the daemon
npm uninstall -g @agent-co-app/cli
```

Removing the package leaves the company folder alone. It is your data, not the program — delete it
yourself if you mean to.

Windows has a second door: a packaged installer at [agent-co.app](https://agent-co.app) that brings
its own Node and adds a Start-menu icon. It updates by installing over itself rather than through
`agentco update`, and the app tells you which door you came in through at the bottom of the
Settings panel.

</details>

## Run it in Docker

Three steps, and only the second involves typing anything unusual.

**1. Mint a token** — anywhere you already have Claude Code, including your own laptop. It does not
have to be the server:

```sh
claude setup-token
```

It prints the token **once** and stores nothing. Copy it.

**2. Fill in `.env`:**

```sh
cp .env.example .env        # copy .env.example .env   on Windows
```

```ini
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
AGENTCO_PORT=7317
```

**3. Launch:**

```sh
docker compose up -d
```

Open `http://127.0.0.1:7317`. That is the whole thing — one container, your data in a named volume,
and the port published to loopback only, including when the machine is a VPS.

Details, the tunnel route, and what to know before exposing it to a network:
[`docker/README.md`](docker/README.md).

---

## Design principles

1. **Own the artifact, not the prompt.** The value lives in the files inside your company's folder.
   They survive independently of anything Claude Code changes.
2. **An agent is a stateless function.** It arrives, does the work, writes a file, and disappears.
   Memory lives in the knowledge graph, not in the context window.
3. **Every token must justify its own existence.** Cost is the primary design constraint, not a
   feature bullet.

## What leaves your machine, precisely

Your files, your company folder and your knowledge graph stay where they are; nothing is uploaded
and there is no account with us to have one. What does go out is what any Claude Code session sends
— the prompts and the file contents an agent actually reads — straight from your machine to
Anthropic, on your own subscription. Said plainly because "no data ever leaves your machine" would
be a nicer sentence and a false one.

## Documentation

| File | Contents |
|---|---|
| [`docs/SPEC-token-economy.md`](docs/SPEC-token-economy.md) | **Read this first if you only read one.** Token-cost rules, prefix-cache architecture |
| [`docs/SPEC-connectors.md`](docs/SPEC-connectors.md) | **The signature feature** — employees that can CRUD your own REST API / MCP server |
| [`docs/SPEC-2026-08-14-agentco.md`](docs/SPEC-2026-08-14-agentco.md) | System spec — org structure, roles, the Task/Receipt protocol, the knowledge graph, the scheduler |
| [`docs/SPEC-cli.md`](docs/SPEC-cli.md) | Process model, command set, configuration |
| [`docs/SPEC-deploy.md`](docs/SPEC-deploy.md) | Personal machine · Docker · VPS + domain, and what changes between them |
| [`docs/SPEC-packaging.md`](docs/SPEC-packaging.md) | The installer, the signed update channel, the release sequence |
| [`docs/SPEC-canvas.md`](docs/SPEC-canvas.md) | Node-based canvas — a drag-and-drop office (the next UI generation) |
| [`docs/SPEC-ui.md`](docs/SPEC-ui.md) | The shipped UI, SSE events |
| [`docs/FINDINGS-sdk-2026-08-14.md`](docs/FINDINGS-sdk-2026-08-14.md) | Real measurements against the Claude Agent SDK — numbers, traps, and the decisions they led to |
| [`docs/TEST-WALKTHROUGH.md`](docs/TEST-WALKTHROUGH.md) | Walk the product by hand, including the Docker door |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Development milestones |
| [`bench/`](bench/) | Measurement scripts — every number in FINDINGS is reproducible |

## License

[**FSL-1.1-ALv2**](LICENSE.md) — source-available. This is **not** open source under the OSI
definition, and I don't call it that.

**You may do, today:** read all of the code · run it for any purpose, including commercial use
and internal company use · modify it · fork it · publish your modifications · build an internal
product on top of it.

**Exactly one thing is forbidden:** selling a product or service that **competes with agentco**.
And that restriction has an expiry date — see below.

### Every release turns into Apache 2.0 on its own, exactly 2 years later

> *"We hereby **irrevocably** grant you an additional license … under the Apache License, Version
> 2.0 … effective on the **second anniversary of the date we make the Software available**."*

- **It cannot be revoked.** The word `irrevocably` is in the license itself. I have no power to
  take it back — not if I change my mind, not if the project is acquired, not if I disappear.
- **The clock runs per release.** Publishing a new release does **not** push the older one's
  clock back by a single day.
- **Result:** a sliding two-year window — anything older than that **is already fully Apache
  2.0**, with no button for anyone to press.

📅 Every GitHub release states the **exact date** it becomes Apache 2.0 — spelled out, not left
vague. Vagueness doesn't stop someone determined to copy the code (they can work it out from the
license themselves); it only costs the trust of someone on the fence about the project.

## Contributing

PRs are welcome — read [**CONTRIBUTING.md**](CONTRIBUTING.md) first.

Your first PR needs the [CLA](CLA.md) signed with **one line** pasted into the PR description. You
**keep the copyright** on what you write; the license you grant is exactly what makes the
"turns into Apache 2.0 on its own" promise above enforceable.

Every PR must answer the checklist at the end of
[`docs/SPEC-token-economy.md`](docs/SPEC-token-economy.md) — a change that makes any golden
scenario's cost worse by more than 10% will not be merged.
