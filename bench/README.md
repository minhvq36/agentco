# bench — measuring token cost

Three scripts that measure how the Claude Agent SDK really behaves around the prompt cache. This is
the **seed of `agentco bench`** (`docs/SPEC-token-economy.md` §6), kept because every number in
`docs/FINDINGS-sdk-2026-08-14.md` came from here and has to stay reproducible.

## Run

```bash
cd bench
npm install
node probe-cache.mjs     # cache behaviour across calls with the same / a different prefix
node probe-prefix.mjs    # how big the prefix is, per configuration
node tier-compare.mjs    # is the `eco` tier actually cheaper for work that USES TOOLS?
```

You need to be signed in to Claude Code on this machine — `agentco login` once is enough, you do not
have to install Claude Code separately. **No API key.**

`tier-compare.mjs` is different from the other two: it runs the real `runWorker` out of `dist/`, so
build first (`npm run build:all` in the repo root).

## Reading the results

- **Every run costs real money.** `model: "haiku"` and `maxTurns: 1` keep it to a few cents.
- `probe-prefix.mjs` uses a **timestamp salt** to force a cache miss on purpose, so that
  `cache_creation_input_tokens` reports the true size of the prefix.
- `maxTurns: 1` is the **worst case** for the repeated `cache_write` charge. A multi-turn task
  amortises it, so the figures here are an upper bound.
- Results depend on the SDK/CLI version. Record it when comparing — upgrading the SDK changes the
  prefix and forces a one-off cache write.

⚠ **The probe prompts were English-ised on 19/09/2026.** They used to be Vietnamese. Vietnamese
tokenises considerably worse than English, so the absolute `prefix≈` figures for variants 3–6 of
`probe-prefix.mjs` are now smaller than the ones recorded in FINDINGS. The comparison between
variants is unaffected — all four share the same custom prompt and moved together — and variants 1–2
never depended on it, because their prefix is the `claude_code` preset. If anything the numbers are
more honest now: variants 1–2 were always measuring an English preset, so a Vietnamese custom prompt
in 3–6 was comparing two things that differed in more than the one variable under test.

⚠ `tier-compare.mjs` deliberately keeps its **Vietnamese workload**, and that is not an oversight —
see the note at the top of the file. Language is the independent variable there, not the prose.

## Still to measure

- Multi-turn tasks (`maxTurns: 10+`), for a real amortised figure
- `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` with a ~2K HOT knowledge block placed before the marker, run from
  two separate processes — the direct check for `docs/SPEC-token-economy.md` §2
- Where the 429 threshold sits under parallel load
