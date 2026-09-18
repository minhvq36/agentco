# Conventions

Rules that apply to every change in this repository. `CONTRIBUTING.md` holds the
four quality criteria and the three rules that define "done" — this file does not
repeat them, it assumes them.

---

## Language

The repository has **two worlds**, and there is deliberately **no wire between
them**. Almost every mistake in this area comes from connecting them.

| | The **APP** | The **PRODUCT** |
|---|---|---|
| What | comments, identifiers, log lines, the rules and field names inside prompts · interface chrome, labels, server error sentences, seed YAML comments | `say` · `answer` · `gist` · `lessons` · the memory written on `/clear` · the contents of result files · plan steps |
| Written by | **us** | the **model**, and the user then reads, adds to and edits it |
| Language | source = **English, always** · anything displayed = **the `language` setting**, via `src/i18n/` | **whatever language the user is actually writing in** |
| Mechanism | the i18n catalogue | **none at all** — the model observes it |

### 🔴 The switch never reaches a prompt

`company.yaml → language` answers *"what do I want to see"*. It cannot answer
*"what language is this person speaking"*. **A Vietnamese user may genuinely
prefer an English interface** — that is a normal case, not an odd one. Wiring the
two together forces English answers on someone who only wanted English menus.

So no prompt builder takes a locale. `LOOKUP_PROMPT` has had this right from the
start and is the model to copy:

> Answer in the language the question was asked in.

Not naming a language is also what makes the product work in languages we have
never shipped a catalogue for: a Chinese user gets Chinese lessons and Chinese
artifacts because **nothing anywhere names a language**. Adding "reply in X"
would break that, permanently, for every language except X.

`test/no-pinned-language.test.ts` is the gate. It fails the day someone passes a
locale into a prompt builder, or pins a language name inside prompt text.

### 🔴 …and it can reach one WITHOUT any source string naming a language

Measured 05/09 (`P-260905-0100-zquw`): an English request produced a plan in
another language. Nothing in the source named one. The road was a **file we
wrote on the user's behalf**: `newOffice` seeded `skills/assistant.md` from
`t('seed.assistantSkills.body')` — the switch, at the instant of creation — and
that file then sat in the **cached prefix of every chat turn** for the life of
the office. The gate above reads source code, so it could not see it.

Two rules follow, and the second is the general one:

1. **Seeding a file that later lands in a prompt goes through no catalogue.**
   *"It becomes the user's own datum"* and *"it never reaches a prompt"* are two
   different tests. A company name passes both; a skills block passes only the
   first. Advice worth giving belongs in the editor's **placeholder** — the user
   reads it, adopts it deliberately, and it costs zero tokens until they do.
   `newOffice` now seeds neither the charter nor the skills.
2. **A rule about language must sit on the line it governs, and say what it
   outranks.** `route()` and `report()` carry the clause inside the very field
   slot; `plan()` carried nothing and lost to a three-line style instruction in
   the office's own skills. An abstract rule in a cached prefix loses to a
   concrete example — restating it louder does not help, saying *"the request
   outranks every other text in this prompt on the question of language"* does.

⚠ Existing offices keep their seeded file. It is their text now; rewriting it to
fix our seed would be editing the user's data behind their back.

### 🔴 …and the third road is not ours at all — the harness names the person

Measured 05/09 with a logging proxy on `ANTHROPIC_BASE_URL`, reading the actual
request body. The Claude Code CLI prepends its own block as **content[0] of the
first user message**, ahead of every word we wrote:

> `<system-reminder> … # userEmail`
> `The user's email address is <the machine owner's address>. …`

An address carries a name and a name carries a language. On a brand-new empty
office, first turn of a fresh session, an English request, and a prompt holding
**zero non-English characters anywhere**: 16/19 replies came back in the
language of the address. The reverse direction is fine — the email agrees there.

Three things follow, and the third is the general one:

1. **`settingSources: []` does not cover this.** That switch turns off CLAUDE.md
   (`claudemd_disabled` in the CLI's own flags, right beside `has_user_email`).
   There is no switch for the email. It is not ours and we cannot remove it.
2. **It lands on the FIRST user message only.** So chat drifts on its opening
   turn and recovers as turns pile up, while every one-shot door — planning,
   the report, the `/clear` memory — is turn 1 *every time* and never recovers.
3. **Six wordings lost, so it is not a wording problem.** Rewording the slot
   clause, deleting it, deleting the prompt-wide language line, strengthening
   it, pointing it at the quoted sentence, and a fence sitting directly under
   the injected block naming exactly what it outranks: 0/5, 4/5, 4/4, 4/4, 5/5,
   5/5. An identity datum next to the request beats every rule, however loud,
   however close. The answer is **code**, and it is
   `core/language-drift.ts` — a script-share comparison between two strings we
   already hold, plus one second turn that ASKS rather than orders. 5/5 both
   directions, and $0 on the direction that was never broken.

⚠ A worked example pair *did* move the number (3/5 where every rule scored 0/5)
and is deliberately **not** shipped: an example has to be written in some
language, which pins two named languages into the prefix and silently biases
every user who speaks a third. That is the trade this section forbids.

⚠ `test/no-pinned-language.test.ts` reads source code, and `newOffice` taught us
it cannot see a file we wrote. This road it cannot see either — the text is not
in our repository at all. **A prompt gate that reads only what we authored can
never be complete.** The way to know what the model receives is to capture the
request, not to grep the source.

### Adding a user-visible string

1. Add the key to `src/i18n/en.ts` — **English is the source of truth**.
2. Add the same key to `src/i18n/vi.ts`. `vi` is declared `: Catalog`, so `tsc`
   tells you what is missing. Catalogue completeness is a **compile-time** fact
   here; there is no runtime "missing key" path and no fallback that would turn a
   loud failure into a quiet one.
3. Call `t('your.key', { param })`. Counted strings use `plural('your.key', n)` —
   English needs two forms where Vietnamese needs one, so a count glued onto a
   noun is correct in exactly one of the two languages.
4. Dates, numbers, byte sizes and money go through `src/i18n/fmt.ts`. Never write
   a locale tag such as `'vi-VN'` at a call site.

`src/i18n/` is imported by the web build through the `@i18n` alias, the same way
`layout-geometry.ts` is imported through `@core`, and for the same recorded
reason: two copies of one table drift. **It must therefore stay pure** — no
`node:*`, no disk, no `process`. Environment and OS hints are read by the caller
and passed in as plain strings.

### Vietnamese in source

`scripts/check-language.ts` runs inside `npm test` and fails on Vietnamese text
in `src/`, `web/src/`, `test/`, `scripts/`, `docs/`, `bench/`, `README.md` and
`package.json`, across `.ts .tsx .mjs .js .md .json .yaml .yml .css .html`. Two
exemptions, both narrow:

- `src/i18n/vi.ts` — the catalogue itself, values only. Its comments are English.
- A line carrying `i18n-allow-vietnamese: <reason>`, for a **fixture where
  Vietnamese is the thing under test**: diacritic-stripping in `slug.test.ts`,
  Unicode round-tripping in `markdown.test.ts`, reply scanning in
  `lesson-guard.test.ts` and `knowledge.test.ts`, the office-document fixtures
  in `library.test.ts`, and the workload in `bench/tier-compare.mjs` — where
  translating the fixture would change the measurement, because Vietnamese
  tokenises considerably worse than English and that script exists to compare
  model tiers on one workload.

⚠ `bench/` and `.mjs` joined on 19/09/2026. `bench/README.md` had been
Vietnamese the whole time, in a directory the front page of the repository links
to by name. The gate was never wrong about what it read — `SCOPE` simply did not
contain it. Widening `SCOPE` without widening the extension list would have been
worse: the directory would have joined and four of its five files would still
have gone unread, under a summary line saying "clean".
→ [[agentco-rule-must-see-what-it-governs]]

⚠ `hasVietnameseDiacritics` inside that script is exact **only because it is
pointed at our own source**, which has exactly two possible states. Point it at
user text and it becomes a guess: it finds no Vietnamese marks in Spanish, German
or Arabic and would label all three "English". Never reuse it on user data.

### The knowledge store carries no language field — on purpose

`KnowledgeNode` has no `lang`, and `hot()` does not filter by language.

A detector would be a **signal wearing a deterministic gate's clothes**, and it
would write its guess **to disk, into user data**, where no later read can tell
that it was a guess. And filtering would trade a *visible* nuisance (a prefix
mixing two languages) for a *silent* one (the office quietly forgetting what it
learned). This repository picks the visible failure every time.

Reopen this only with evidence, not with tidiness: a real office holding notes in
≥2 languages **plus a wrong output traceable to the mix**, or a real user asking.
The mechanism then is the **model declaring** the language it just wrote, as a
free-form BCP-47 tag, on new nodes only. Old nodes stay blank, and blank means
*unknown* — never inferred.

---

## Comment boxes

Design decisions live next to the code they govern. They record the failure that
was paid for, not just the conclusion. **That part is the point and it stays.**

### 🔴 The RIGHT-HAND BORDER is optional as of 08/09 — user's call

A new block **does not need a `│` on the right**, and nobody should spend a pass
putting one there. Write it open:

```
/**
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ WHAT WAS MEASURED, AND WHAT IT COST.
 * │
 * │ …
 * └──────────────────────────────────────────────────────────────────────────
 */
```

Or with no box at all — a `🔴` heading line and prose underneath reads the same.

**Why the closing border went:** it is padded by hand, display width is not
`string.length` (a combining mark adds a code unit and no column, an emoji adds
two of each), and every edit to a line inside a block re-opens the arithmetic.
Measured across 154 real boxes: **1023 of 2495 body lines already disagree with
their own top border** — so the alignment was never actually holding, and the
time was being spent to keep a thing that was already ragged looking almost
aligned. The reason a box exists is the paragraph inside it; the border is
decoration that charges rent on every edit.

**What this does NOT change:**

- ⛔ **Do not reflow existing boxes.** Normalising would rewrite ~40% of every
  box in the repository and bury the real diff under noise nobody can review.
  A closed box you edit keeps its borders — leave the line width alone and
  accept the ±1; nothing reads it.
- ⛔ **Never trim a sentence to make a line fit.** That was always the rule and
  it is now the only rule about width: shorten by rewriting the thought, never
  by dropping a condition, a date, a measured number, or a "but the other half
  is just as dangerous".
- `scripts/fix-comment-boxes.ts` stays for the boxes that are already closed.
  It is **advisory** and it is no longer part of finishing a change.

### The tool, for the closed boxes that remain

`--check <file…>` reports lines sitting off their block's dominant width and
writes nothing. `--against <baseline>` limits the fix to lines you actually
edited — and ⚠ it still widens neighbouring blocks you never touched (measured:
`19 in reflowed blocks`), so anything it writes has to be read back and the
untouched blocks restored. Both are optional now; neither is a step in
finishing a change.

**If you do open one, do not align by eye.** Display width is not
`string.length`: a combining mark adds a code unit and no column, an emoji adds
two of each, so counting characters is wrong in both directions at once.

## Versions and releasing

### 🔴 ONE NUMBER. `package.json#version` IS IT.

Yes — the version of the code *is* the version of the `.exe`. There is no
second number to keep in step, because a second number is a number that drifts:

| Where it shows up | How it gets there |
|---|---|
| the running app, `daemon.json`, `/healthz` | `core/version.ts §appVersion()` **reads `package.json`** |
| the packaged tree, `app/<version>/` | `scripts/package.ts` |
| the installer, `VIProductVersion` + the Apps & features entry | `makensis /DVER=<same>` |
| the git tag | `v<same>` |

⛔ **Never write the number as a literal.** `cli/index.ts` once carried
`version: '0.0.1'` by hand while `/healthz` reported the real one — two sources
of truth for the exact number the update channel compares. That is the bug this
table exists to prevent, and `test/packaging-fields.test.ts` guards it.

⛔ **The installer FILENAME carries no version** (`AgentCo-win-x64-setup.exe`).
GitHub's `releases/latest/download/<name>` alias resolves by exact filename, so
the website's download button is a constant; a version in the name breaks that
link on every release. → `agentco-web/SPEC.md §2`

⚠ **The runtime layer keeps its own version** (`runtime/node-v22.12.0`) and is
not this number: it moves about twice a year against the app's weekly cadence,
which is the whole point of §3.5's per-layer manifest.

### Pre-1.0, what a bump means

`0.MINOR.PATCH`. MINOR when a user would notice (a feature, a changed flow, a
migration); PATCH for fixes. 1.0.0 waits for the thing §4 of `SPEC-packaging`
calls a licence — not for a feeling of completeness.

### The release sequence — a tag, then three things only a person can do

CI does everything a machine can check. → `.github/workflows/release.yml` ·
`SPEC-cli.md §6`

```powershell
npm version 0.1.2 -m "Release v%s"   # package.json + lock, a commit, tag v0.1.2 (clean tree required)
git push origin main v0.1.2          # the tag starts release.yml
```

**What the tag does with no hands:** `npm test` → build → packaged tree → NSIS
installer → GitHub Release marked `--latest`, SHA-256 in the notes → the
website's download URL checked to serve those exact bytes. In parallel the npm
package is installed and run on Ubuntu, macOS and Windows × Node 22/24; only if
that AND the Windows job pass is it staged (`npm stage publish`).

**What a person does, every release:**

| | Where | What |
|---|---|---|
| 1 | npmjs.com → `@agent-co-app/cli` → **Staged Packages** | **Approve** with the passkey. Nothing is on npm until then; `npm-approved` waits ≤ 6 h, then `npm-verify` installs the live version on all three systems. Stage-only is deliberate — `SPEC-cli §6`. |
| 2 | this machine → `agentco-web` | `node --experimental-strip-types scripts/release-web.ts` — refuses unless GitHub's `latest` release AND npm's `latest` are this version; then writes `RELEASE_INFO` and a `public/releases/stable.json` signed with `~/.agentco-release/working.key`, verified against the keys compiled into the app. Commit and push `agentco-web` → Cloudflare Pages redeploys. Forgetting breaks no download, but the page shows an old number and **installed copies are never told** a new version exists. → `SPEC-packaging §3.6` |
| 3 | a real Windows desktop | Download from agent-co.app, install **over** the previous version, click the Start-menu icon. The one path no runner walks: SmartScreen, the NSIS pages, a desktop session. |

⚠ **Changed `release.yml` itself?** Run it by hand first — Actions → Release →
*Run workflow* on `main`. It builds and tests everything and publishes nothing
(npm does `--dry-run`). A tag is the wrong place to find a typo: the Release is
already public by the time a later job fails.

⚠ **Do NOT tick "Set as a pre-release"** if you ever edit a release on GitHub by
hand. `releases/latest` skips pre-releases entirely, so the website's download
button would 404 while the release page looks perfectly fine.

## Writing comments

- English reads as the original, not as a translation. Keeping the metaphor is
  better than keeping the words.
- Keep the register: direct, with the real case and the real measurement.
  A comment that reads like API documentation has lost the thing it was for.
- **Never drop a clause.** Shortening is fine; dropping a condition, a date, a
  measured number, or a "but the other half is just as dangerous" is not.
- State the mechanism and the cost, not the intention.
