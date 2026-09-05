# AgentCo

A **virtual company that runs on your machine**. Claude acts as director, orchestrating a team of specialist agents that run in parallel and accumulate experience into a graph-shaped knowledge store. You give orders in plain language — through the web UI or through Telegram. `agentco` is a **working codename**.

Runs on **your own Claude Code subscription**. There is no server of ours in the middle. No data ever leaves your machine.

---

## Why this exists

AI agents have solved "how to do the work." What nobody has solved yet: **where am I, who is doing what, how much is left, and are we headed the right way.**

Existing orchestration tools all target developers. AgentCo targets people who **don't code but want to be able to go deep**: by default you see a company at work, with a plan that reads as four understandable steps; the raw transcript and the per-token cost table are one click away when you want them.

And the biggest difference: **employees know how to use your own systems.** Other tools make you write an MCP server before an agent can call your API. Here you **describe the API** — paste an OpenAPI link, paste a cURL command, or fill in a form — then hit Test. See [`docs/SPEC-connectors.md`](docs/SPEC-connectors.md).

## Design principles

1. **Own the artifact, not the prompt.** The value lives in the files inside your company's folder. They survive independently of anything Claude Code changes.
2. **An agent is a stateless function.** It arrives, does the work, writes a file, and disappears. Memory lives in the knowledge graph, not in the context window.
3. **Every token must justify its own existence.** Efficiency and cost are the primary goal here, not a side feature.

## Documentation

| File | Contents |
|---|---|
| [`docs/SPEC-2026-08-14-agentco.md`](docs/SPEC-2026-08-14-agentco.md) | System spec — org structure, roles, the Task/Receipt protocol, the knowledge graph, the scheduler |
| [`docs/SPEC-token-economy.md`](docs/SPEC-token-economy.md) | **Read this first if you only read one file.** Token-cost rules, prefix-cache architecture |
| [`docs/SPEC-cli.md`](docs/SPEC-cli.md) | Process model, command set, configuration, the path to a container |
| [`docs/SPEC-connectors.md`](docs/SPEC-connectors.md) | **The signature feature** — employees that can CRUD your own REST API / MCP server |
| [`docs/SPEC-canvas.md`](docs/SPEC-canvas.md) | Node-based canvas — a drag-and-drop office (the next UI generation) |
| [`docs/SPEC-ui.md`](docs/SPEC-ui.md) | The shipped UI, SSE events |
| [`docs/FINDINGS-sdk-2026-08-14.md`](docs/FINDINGS-sdk-2026-08-14.md) | Real measurements against the Claude Agent SDK — numbers, traps, and the decisions they led to |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Development milestones |
| [`bench/`](bench/) | Measurement scripts — every number in FINDINGS is reproducible |

## Architecture, in one picture

```
   Human ──► MASTER (long-lived session, plans, does not do the hands-on work)
                │ TaskBrief (DAG)
      ┌─────────┼─────────┬─────────┐
      ▼         ▼         ▼         ▼
   Worker    Worker    Worker    Worker      stateless, run in parallel
      │ Receipt (≤800 tokens, carries a human-readable `say` field)
      └─────────┴─────────┴─────────┘
                │
        KNOWLEDGE GRAPH (markdown + frontmatter, human-readable)
```

Workers never talk to each other directly — every exchange goes through the master or through an artifact. That's an economic choice, not an aesthetic one: agent-to-agent chat is the single largest and hardest-to-control source of token burn in every multi-agent system.

## Requirements

- Node.js ≥ 22
- The Claude Code CLI, logged in (`claude` runs). **No API key needed.**

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
