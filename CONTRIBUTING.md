# Contributing to agentco

## The license, stated up front

agentco uses **[FSL-1.1-ALv2](LICENSE.md)** — the Functional Source License. It is **not** an
OSI-approved open source license, and this page says so before you spend time on code rather than
letting you discover it afterwards.

It is also not closed source, and the gap between those two is wider than it looks:

| What you may do today | |
|---|---|
| Read the entire source | ✅ |
| Run it for any purpose — personal, internal company use, commercial | ✅ |
| Modify it, fork it, publish your fork | ✅ |
| Build an internal product on top of it | ✅ |
| **Sell a product or service that COMPETES with agentco** | ❌ — for two years, then it expires |

Exactly one restriction, and it has an expiry date.

## The clause that matters most, and it runs by itself

> **Every release becomes Apache 2.0 on its own two-year anniversary.**
>
> *"We hereby irrevocably grant you an additional license to use the Software under the Apache
> License, Version 2.0 that is effective on the second anniversary of the date we make the Software
> available."* — [LICENSE.md](LICENSE.md), §Grant of Future License

Three properties worth reading carefully:

**① It cannot be revoked.** The word `irrevocably` is in the license text itself. The Project Owner
has no power to take it back — not by changing his mind, not if the project is acquired, not if he
disappears. You do not have to trust anyone; you read that line.

**② The clock runs per release, and nothing gets pushed back.** A release published on 2026-09-15
becomes Apache 2.0 on 2028-09-15, no matter how many releases follow it. Publishing more does not
delay older ones by a single day. The consequence: the project always carries a **rolling two-year
window** — everything older than that is already fully Apache 2.0.

**③ Dates are concrete, not vague.** Each GitHub Release states the exact date on which that
release converts. This is something you can look up, not something you have to ask about.

> If you only contribute to OSI-approved open source — that is a fair position and there is no
> argument here. Your contribution becomes Apache 2.0 after two years, but *today* it is not, and
> that is a legitimate reason to stay out.

## Before your first pull request: sign the CLA

One line, once, pasted into the description of your first pull request:

```
I have read the CLA at CLA.md and I hereby sign it.
Name: <your full name>   GitHub: @<your-handle>   Date: <YYYY-MM-DD>
```

**You do not lose your copyright** — see [CLA.md](CLA.md) §4. You grant a license broad enough for
the "automatically becomes Apache 2.0" promise above to be enforceable. Without it, every licensing
change would require collecting signatures again, and one unreachable contributor blocks everyone.

## Getting started

```bash
npm install
npm run build:all     # compile server + web UI
npm test              # 853 tests, ~20 seconds, 0 tokens, no LLM calls
npm run dev           # run the CLI from source
```

### Four quality criteria — they define "done"

A change is finished only when it passes all four: **stability** · **good error handling** ·
**performance** · **smoothness**. Details in `docs/SPEC-2026-08-14-agentco.md` §1.

### Three rules repeated throughout this repository, because all three were paid for

1. **An invariant is only real when there is code that enforces it.** A comment is not a mechanism,
   and a function that exists but guards something else is more dangerous than an empty promise.
2. **Measuring N failures proves a MECHANISM, not a CONCLUSION.** Before declaring a path dead, ask:
   *where is the equivalent thing working today, and how does it differ from ours?*
3. **Tokens are a design constraint, not a later optimization.** Anything placed in the prefix is
   paid on **every** turn, forever. `docs/SPEC-token-economy.md` is the highest law here.

### Source is English; the product speaks the user's language

Code, comments and log lines are English. Anything a user sees on screen goes through
`src/i18n/`. Anything the **model produces** — replies, results, lessons, memory — follows whatever
language the user is writing in, and no prompt ever names a language. `npm test` enforces the first
half; `docs/CLAUDE.md` explains the rest, including why the two must not be wired together.

### Before you open a pull request

- `npm test` is green. Add tests for **pure functions** — they run in under a second and cost zero
  tokens.
- If your change touches token cost: include **measurements**, and remember to **insert a nonce**
  to defeat the cache. Without one, the second measurement reads the first one's cache and reports
  a difference of zero.
- If you change a rule documented in `docs/`: update that document in the same pull request.
  Documentation that disagrees with the code is a bug, and the longest-lived kind, because it never
  produces a symptom.
