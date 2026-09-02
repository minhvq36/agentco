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
in `src/`, `web/src/`, `test/`, `scripts/`, `docs/`, `README.md` and
`package.json`. Two exemptions, both narrow:

- `src/i18n/vi.ts` — the catalogue itself, values only. Its comments are English.
- A line carrying `i18n-allow-vietnamese: <reason>`, for a **fixture where
  Vietnamese is the thing under test**: diacritic-stripping in `slug.test.ts`,
  Unicode round-tripping in `markdown.test.ts`, reply scanning in
  `lesson-guard.test.ts` and `knowledge.test.ts`, and the office-document
  fixtures in `library.test.ts`.

The file also carries a `PENDING` list — trees not yet migrated. It only ever
shrinks; deleting a phase's entry *is* that phase's exit criterion.

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

Design decisions live in `┌─ … ─┐` boxes next to the code they govern. They
record the failure that was paid for, not just the conclusion.

Right-hand borders are padded by hand. Take a copy of the file **before** you
edit it, then afterwards:

```
git show HEAD:src/core/worker.ts > /tmp/base.ts     # or copy it first
node --experimental-strip-types scripts/fix-comment-boxes.ts --against /tmp/base.ts src/core/worker.ts
```

Do not align them by eye. **Display width is not `string.length`**: a combining
mark adds a code unit and no column, an emoji adds two code units and two
columns, so counting characters is wrong in both directions at once.

**The rule is "a line I edited keeps the width it had"** — not "every line
matches its border". Measured across 154 real boxes: 1023 of 2495 body lines
already disagree with their top border, and 645 still disagree with their own
block's dominant width, with the deviation tracking line length rather than any
character. The boxes are simply ragged by ±1 from years of padding by eye, and
there is no hidden rule to recover. Normalising would rewrite ~40% of every box
in the repository and bury the real diff under noise nobody can review.

A line too wide to fit is **reported, never trimmed** — trimming would silently
delete a clause from the reason a decision exists. Shorten the sentence and rerun.

`--check <file…>` reports lines sitting off their block's dominant width and
writes nothing. It is advisory; a hit is not automatically a defect.

## Writing comments

- English reads as the original, not as a translation. Keeping the metaphor is
  better than keeping the words.
- Keep the register: direct, with the real case and the real measurement.
  A comment that reads like API documentation has lost the thing it was for.
- **Never drop a clause.** Shortening is fine; dropping a condition, a date, a
  measured number, or a "but the other half is just as dangerous" is not.
- State the mechanism and the cost, not the intention.
