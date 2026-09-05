# SPEC — Document Library: user files, separated from the knowledge store

**Locked 17/08/2026.** Read alongside `SPEC-token-economy.md` (highest-priority law), `SPEC-offices.md` §2 (folder layout), appendix `SPEC-connectors.md` (search direction — this spec *enforces* it).

---

## 0. One sentence

> **The knowledge store is short sentences the system has LEARNED. The document library is files the USER PUT IN.**
> The first lives in the prefix and is paid for every turn. The second never enters the prefix and is reached with `Glob`/`Grep`.

---

## 1. Why the split happens at the STORAGE layer, even though the general rule says splitting at the display layer is cheaper

Law §5e (`SESSIONS_MEMORY`): *splitting display is cheap, splitting storage is expensive → when in doubt, split at the cheap layer*. This is an **exception**, and the reason has to be written down so nobody merges them back later:

| | Knowledge store | Document library |
|---|---|---|
| Who produces it | the agent distills it (+ the user edits/deletes) | **only the user** |
| Enters the prompt prefix? | **YES** — every turn, every worker | **NEVER** |
| Unit | a node ~250 tokens, one `.md` file | a document, measured in MB |
| Automatic lifecycle | `supersedes` · `hits` · `last_used` · 15-day prune | **none** |
| Retrieval | keyword scoring (`KnowledgeStore.hot/cold`) | `Glob`/`Grep` on disk |
| Cost of an accidental delete | one lesson the agent had distilled | **a client's file, gone** |

Sharing one storage layer means that one day `pruneStale` deletes a client's contract because it "hasn't touched any task in 15 days." The two lifecycles are not compatible.

**Office-level, not company-level.** Documents don't enter the prefix, so technically company-level would work — but it would break the invariant *"an office is self-contained, zip it up and it runs as a template on another machine"* (`SPEC-offices.md` §2).

**And this split happens exactly once.** There is no third store.

---

## 2. Folder layout

```
offices/<id>/
  library/
    files/           ← ORIGINALS the user put in. The UI shows exactly this folder, 1:1
    text/            ← extracted text:  <original name>.txt
    INDEX.md         ← routing layer, built by CODE, 0 tokens (§8)
    catalog.json     ← per-document status
  artifacts/         ← UNCHANGED: where the agent WRITES
  knowledge/         ← UNCHANGED: knowledge nodes
```

### 2.1 ⚠ Why NOT hide it under `.state/` — checked with a real command

The natural instinct is to tuck `text/` and `catalog.json` under `.state/` to keep them out of sight. **Doing that silently kills the retrieval mechanism:** `Grep` is built on ripgrep, and ripgrep **skips every directory whose name starts with a dot** when walking down.

Measured on 17/08:

```
Grep "pid|port"  path=company/         → 4 files, NO .state/daemon.json
Grep "."         path=company/.state/  → found it (because it's the search root, not something walked into)
```

Plus one piece of good news, also checked: **`.gitignore` does NOT block `Grep`**. `company/` is gitignored and `Grep` still sees every file. There's only one trap, and it's the dot.

> **Rule to carry forward: if the agent needs to `Grep` it, the folder name must NOT start with a dot.**

### 2.2 Why `library/` is separate from `artifacts/`

- Mixing them means "delete all documents" also eats results the agent was paid to produce.
- A 1:1 listing would flicker with every file the agent writes.
- `artifacts/` is **output**, `library/files/` is **input**. Mixing two data directions into one folder is where everything starts getting confused.

### 2.3 Sidecar names keep the original name

`library/text/Contract ABC.pdf.txt` — **no** hashing, **no** slugging. The `Grep` result names the document it belongs to on its own; the model doesn't have to look anything up, and the user doesn't have to guess.

---

## 3. PDFs: extracting text is NOT to replace reading — it's to read the RIGHT PLACE

This is the section most likely to be decided wrong, because the premise *"the model already reads PDFs very well"* is **true**.

But the model reads a PDF by **looking at each page as an image**, and the `Read` tool's own constraints say the rest:

> A PDF is read via the `pages` parameter (e.g. `"1-5"`), **at most 20 pages per call**, and **`pages` is required if the PDF is over 10 pages**.

Meaning for a 34-page contract, the agent **cannot** just say "read this file" — it **has to already know** which pages it needs. For a 300-page book, even less so. This isn't a question of cheap vs. expensive — it's a question of possible vs. impossible.

| | Extract text on ingest | `Read` the original directly |
|---|---|---|
| LLM cost | **0 tokens, once, forever** (pure code) | pays tokens **every task, every time** — pages come in as images so it's much more expensive than text |
| 300-page book | `Grep` pulls out exactly the 200 lines needed | 15 calls — nobody does that |
| Tables, many columns | **broken** — extracted text scrambles columns | **correct** — the model sees the layout |
| Charts, drawings | lost entirely | readable |
| **Scanned PDF** | **comes out empty** | **readable — the model OCRs it itself** |

The two columns **don't compete, they complement each other**:

> **Extracted text is for FINDING. The original is for READING CLOSELY the page you found.**

### 3.1 The mechanism that links the two: page markers

The text file for a PDF **must** carry page markers:

```
--- page 12 ---
Article 7. Party B bears all costs incurred...
```

A `Grep` hit → look up the nearest marker above it → `Read(contract.pdf, pages="12-14")`. **3 pages instead of 34.** This is "fetch a chunk instead of loading the whole file" without any manual chunking mechanism at all — and no second segmentation mechanism that has to stay in sync with the first.

### 3.2 A scanned PDF is NOT an error

The first draft of this spec marked a scanned PDF as `failed` with the message *"needs OCR — not supported yet."* **Wrong, and fixed.** The model can OCR. The correct states are:

| state | Meaning | Label shown to the user |
|---|---|---|
| `ready` | has a text layer, extracted successfully | (no label) |
| `image-only` | scan / photo, extraction yields ~0 characters | *"Scanned copy — keyword search won't find anything. A worker has to read it page by page, which costs more."* |
| `failed` | file is corrupt, password-protected, wrong format | red + how to fix it |

Detected with **code, 0 tokens**: `characters extracted / page count < 50` → `image-only`.

`.pdf` is the **only** format where the original stays a first-class citizen. For `.docx`/`.xlsx`/`.pptx` the agent can't read the original at all, only the text file.

---

## 4. Formats accepted and rejected

**No images, no video — and the reason isn't laziness:** the whole retrieval mechanism is grep. Anything that can't become text **has no way to be found**. Images are even worse: they go into the model as an image block, which is expensive and gets paid for again from scratch on every task.

| Group | Extensions | Handling |
|---|---|---|
| Already text | `.md` `.txt` `.csv` `.json` `.yaml` `.yml` | no conversion, `Grep` the original directly |
| Extracted on ingest (ZIP+XML, 0 dependencies) | `.docx` `.xlsx` `.pptx` | → `library/text/` |
| Extracted on ingest (`pdfjs-dist`, **shipped with the product**) | `.pdf` | → `library/text/` **with page markers**, original still readable |
| **Blocked**, with an explanation | images · video · audio · `.zip` · `.exe` · `.doc` `.xls` (old binary formats, a completely different parser) | |

`.csv` **must be supported** — walkthrough tests #3 and #7 depend on it.
`.zip` is refused outright: unzipping opens the door to recursion, zip bombs, and path traversal in entry names.

### 4.2 `pdfjs-dist` is a REAL dependency, not optional — fixed 20/08

The first draft made it an **optional**, dynamically-loaded dependency, and when it was missing, the document library would show a `not indexed` label with the line *"Install: `npm i pdfjs-dist`"*. The reasoning sounded tidy: PDFs are still readable via page-by-page `Read`, you just lose grep — so don't force anyone to download 36MB if they don't use PDFs.

**The user pushed back, correctly:** *"I thought this was supposed to be built into the app — the same will be true once this ships as a product, how are users supposed to handle it?"*

Someone running a flower shop doesn't have `npm`. For them that line isn't a suggestion — it's a **closed door**, and the feature might as well not exist. Worse: it shows up right after they've just dropped in a contract, exactly the moment they're trusting the product to handle it.

| | |
|---|---|
| The *"no new dependencies"* rule (17/08) | **still holds where it originated**: `.docx/.xlsx/.pptx` are ZIP+XML, extractable by hand in ~200 lines — adding a library there would be laziness |
| PDF | compressed content streams + CID font encoding tables — **can't be hand-rolled**, and a feature that only runs on a machine with a toolchain isn't a **finished build** |
| The cost | **~36 MB on disk**, next to the Agent SDK's 304 MB. +10% |

> **Rule to carry forward: "no new dependencies" is a rule about LAZINESS, not about DISK SIZE.** It bans adding a library for something you could have built yourself — it doesn't license pushing an install step onto someone who has no toolchain to run it.

**Three code decisions:**

1. `pdfjs-dist` goes in `dependencies`, pinned at `~5.4.624`. ⚠ The `5.7+` and `6.x` lines require **Node ≥ 22.13**, while agentco's `engines` says `>=22` — bumping the version means bumping both at once, or a user on Node 22.12 gets an `EBADENGINE` warning they won't understand.
2. **Still dynamically loaded** (`await import(spec)`), but for a different reason than before: those 36MB only enter memory when someone drops a PDF, not on every daemon startup.
3. `PdfToolMissing` **stays**, with a changed meaning: it now means a **broken install** (`npm install` didn't finish, or ran with `--omit=optional`). The fix changes accordingly — *"run `npm install` again"*, not *"go find an npm package name."*

### 4.4 🔴 ONE document, ONE path — and it has to be a path that CAN BE OPENED (20/08)

**A real failed case, `P-260820-2219-5ltb`.** The manifest listed `library/files/hd1.docx` and told the worker to *"put its path in that task's `inputs`"*. The assistant did **exactly as told**, the `Read` tool couldn't open the compressed file, and the whole three-step case died at step one — **$0.25**, while `library/text/hd1.docx.txt` had already been sitting on disk since the file was dropped in.

> ⚠ **Rule §3.1 (*"text is for FINDING, the original is for READING CLOSELY"*) ONLY HOLDS FOR PDF.** The model sees a PDF page as an image, so the original really is readable. For `.docx/.xlsx/.pptx`, the original **can't be opened by anything** — applying that rule to them just hands the worker a binary file. The earlier draft talked as if all three formats were the same.

The rule is now the **pure** function `docPaths(name, ext, state)` in `library/names.ts`:

| `HANDLING[ext]` | `open` | `original` |
|---|---|---|
| `text` (md/txt/csv/json/yaml) | `library/files/<name>` — the original IS the text | — |
| `zip` (docx/xlsx/pptx) | `library/text/<name>.txt` | **never** |
| `pdf` extracted | `library/text/<name>.txt` | `library/files/<name>` |
| `pdf` `image-only`/`unindexed` | `library/files/<name>` (read page by page) | — |
| everything else (`failed`, unknown extension) | **nothing** → the manifest **lists no path at all** | — |

**It can be pure** because `extractOne` only writes a sidecar on exactly one branch (`ready` and `kind !== 'text'`); every other branch `return`s before that point. So *"does a sidecar exist"* can be derived from the state without touching disk — and the two can never diverge, because there's only one place that defines it.

> ⚠ Listing a dead path is **worse than listing nothing**: the assistant will hand out a task guaranteed to fail, and the bill still gets charged in full. Rejected extensions have to fall into this branch too — miss that and every unrecognized extension slides into the `zip` branch and we list a sidecar that was never written. *(A test caught exactly this on the first round.)*

**Three doors, one shared rule.** `LibraryStore.manifest()` (the assistant's prefix) · `resolveFileRefs` (user-typed `@`) · `pickReadable` (the assistant's hidden `lookup` worker). The latter two receive `ReadableRef { ref, open }`:

- `ref` = the string **the user recognizes**, and the string the Copy button puts into the chat box (`library/files/hd1.docx`).
- `open` = the string **that goes to the model** (`library/text/hd1.docx.txt`).

Drop `ref` and the Copy button breaks silently; drop `open` and we're back to the failed case. Both are accepted, both expand to `open`. One document matched through **two** doors doesn't count as a name collision.

> **The user locked this in and said explicitly this does NOT break the rule *"the path the user typed is authoritative, copy it verbatim"* — it's an AMENDMENT to it.** What they pointed at was a **DOCUMENT**, not a string of bytes. Keeping the string byte-for-byte while losing the document is what actually breaks their intent.

`INDEX.md` gets a new **"Open with"** column and states the per-format rule right under the heading.

### 4.5 Re-extraction — a status is a record of the PAST, not a life sentence

`hd2.pdf` went into the library before a PDF reader existed, so it got `unindexed`. That afternoon `pdfjs-dist` became a real dependency — and the document was **still** `unindexed`, with the line *"Install: `npm i pdfjs-dist`"* still sitting in the assistant's prefix. The only way to retry was to **delete and re-drop your own file**: a scary action, and the user might not even still have the original.

| Door | |
|---|---|
| **Re-extract** button (↻ icon) in the Document Library | shown only when a document is **not yet usable**. `POST /api/office/:id/library/reextract?name=…` → `202`, the document goes to `pending`, extraction runs in the background exactly like on first drop |
| `LibraryStore.retryUnindexed()` when an `Office` is constructed | retries **once** per startup |

**No confirmation before re-extracting** — unlike `remove`, this action loses nothing (the original is untouched, only the text version is rebuilt). Asking for confirmation on a consequence-free action teaches the user to click "OK" without reading, and then they click the same way on the delete dialog.

> ⚠ **ONLY retries `unindexed`, deliberately leaves `failed` alone.** The two states say two different things: `unindexed` = *this machine didn't have the tool yet* (can change, and usually already has, right after a restart following install); `failed` = *this file is broken* (won't change). Retrying `failed` on every daemon start burns CPU for a foregone conclusion, and for a large file it slows down every startup.

Verified with a real run on 20/08 on the exact office that had been broken: `hd2.pdf` unstuck itself into `pdf, 1 page` with page markers, `hd1.docx` switched over to `library/text/hd1.docx.txt`.

### 4.3 ⚠ `standardFontDataUrl` + `cMapUrl` — SILENT failure if given `file://`

These two parameters are **not for rendering the page** — they're **character encoding tables**:

| | Without it |
|---|---|
| `standardFontDataUrl` | base-14 fonts without embedded glyphs **can't** map glyph → unicode |
| `cMapUrl` (+ `cMapPacked`) | prebuilt CMaps for **CID/CJK** — meaning **Vietnamese PDFs exported from Word**, exactly the kind of contract test #6 uses |

Both can only be pointed anywhere **because `pdfjs-dist` is now a real dependency**; back when it was optional there was no way to know where it lived.

> ⚠ **Give it a BARE DISK PATH, forward slashes, no leading `file://`.** Since the parameter name ends in `Url`, the first instinct is `pathToFileURL()`, and it **fails without erroring**: under Node, pdf.js calls `fs.readFile(url)` directly with whatever string we hand it, and `fs` doesn't understand a `file:///D:/…` string. It prints one `Warning:` line and **keeps going**, returning text missing its character mapping. This exact trap was hit while fixing this on 20/08 — caught because it was run for real against a real PDF, not by re-reading the code.

### 4.1 Two mandatory checks on file intake

**a. Check magic bytes, not just the extension.** Renaming `.exe` to `.pdf` takes 2 seconds. For text-native extensions, check the reverse: reject if a NUL byte appears in the first 8KB (a sign of a binary file wearing a `.txt` costume).

**b. Sanitize the filename — and this is where Windows will bite.**

- block `..`, `/`, `\`, NUL bytes, control characters
- block **Windows-reserved names**: `CON` `PRN` `AUX` `NUL` `COM1`–`COM9` `LPT1`–`LPT9` (even with an extension: `CON.txt`)
- block names ending in a dot or a space (Windows silently strips them → the name in the catalog no longer matches the name on disk)
- block `|` — it's `INDEX.md`'s column separator, and a row broken there means the assistant reads out a truncated path. Windows already forbids this character, so no name usable on all three OSes is lost. `renderIndex` also replaces `|`/newlines in the **name** and **description** cells (copying straight into `library/files/` by hand bypasses this door) — but **never** touches the path cell: a modified path is a dead path, far worse than an empty cell
- **NO slugifying.** The user has to recognize their own file. Vietnamese with diacritics in a filename is valid on NTFS and ext4.

---

## 5. Size limits

**Real numbers, so nobody has to guess again:**

| | Size |
|---|---|
| 300-page book, PDF with a text layer | **1–5 MB** |
| Image-heavy PDF (catalog, exported slides) | 20–100 MB |
| **Scanned** book | 50–200 MB — and extracts to 0 characters |

→ **Cap at 50 MB/file**, declared in `company.yaml`. Above that, it's almost certainly a scan.

**But the cap that should actually worry us isn't MB — it's the token count after extraction.** A 3MB PDF can turn into 800K tokens. `Grep` is fine with that; the problem is if a worker `Read`s the whole file, blows the context, and hits `max_turns`.

The handling, following the rules *"if it's observable, don't ask the model"* and *"token accounting is the outside auditor's job"*:

- write `tokens` (estimated) into `catalog.json`
- **show it to the USER** in the library: *"this document is quite long"*
- **DO NOT** stuff a warning into the prompt — that's a permanent token tax to buy an uncertain behavior
- **no manual chunking**: `Read` has `offset`/`limit` and self-truncates at 2000 lines, degrading gracefully. Page markers (§3.1) already handle locating content.

There is no total cap for the whole library in v1. Said plainly here so nobody thinks it was overlooked later.

---

## 6. Only ADD and DELETE. No editor.

**No editor** — and the reason is stronger than "haven't gotten to it yet": having an editor means owning conflict resolution · undo · **preserving formatting**. Nobody can edit a `.docx` in a `<textarea>` without breaking it. *"Want to edit it? Edit it elsewhere and drop it back in to overwrite"* is correct and free.

**Same name → ask, with a Replace button.** With one mandatory rule, because this is exactly the §8 bug class *"write one thing, read another"*:

> **Replacing a file means DELETING the old sidecar FIRST, then re-extracting.**

Leaving the old sidecar in place means `Grep` finds content from the replaced version — silently, forever, and the user sees the system quote a sentence that no longer exists in the file they're looking at. Keep the filename unchanged so anything already pointing at it stays intact.

**Delete: ONE level, permanent, with a confirmation showing the filename.** (User locked this in on 17/08.)

The general rule *"delete always has TWO levels: Archive · Permanent delete"* **deliberately does not apply here**, and the reason has to be written down so nobody "fixes it for consistency" later:

- a document is the user's **own** file, the original is still on their machine — they just uploaded it
- an "archive" level creates **a second store that also needs cleaning up**, exactly what a comment in `store.ts` already warned about
- and it drags in a question with no good answer: *is an archived file still findable by `Grep`?* (it has to be NO — meaning the sidecar has to move too, i.e. two places now have to stay in sync)

---

## 7. Knowledge store: NO adding nodes

A new invariant, and it's the other half of the split:

> **A knowledge node is something the system has LEARNED, not a place for the user to type into.**

Letting the user type nodes straight into the store turns it into a second document library, a worse one — no proper lifecycle, but sitting inside the prefix.

The user still has **three doors** to feed knowledge in, none of which is "write a node file by hand":

| Door | Goes into | confidence |
|---|---|---|
| **Charter** (editable in the UI) | `pinned` node, in every worker's prefix | 1 |
| **Talk to the Assistant** → `/clear` distills it | a MEMORY node, `knowledge/agents/assistant/` | 0.9 |
| **Document library** | not in the prefix, reached with `Grep` | — |

The `PATCH /knowledge` API stays as-is: **edit and delete, no create**. No "+ Add note" button.

⚠ This invariant only **became true starting 17/08**, when the charter moved out of `knowledge/` — see §17. Before that, every new office spawned its own charter node, meaning the system itself was violating the very thing it had just declared. *An invariant is only real once source code enforces it.*

---

## 8. `INDEX.md` — the routing layer, built by CODE, 0 tokens

The `SPEC-connectors` appendix says *"let an uploaded file spawn a summary node pointing back to the original."* **Right intent, wrong method**: an LLM-generated summary is one call per file — exactly what should be avoided.

Built by code instead. Every column below is **observable**, without asking the model anything:

```markdown
# Document Library — 12 documents

| Name | Type | Size | ~Tokens | Opening / structure |
|---|---|---|---|---|
| Contract ABC.pdf | pdf, 34 pages | 1.2 MB | 41K | "SERVICE CONTRACT No. 07/2026…" |
| Revenue Q3.xlsx | 3 sheets | 240 KB | 8K | Sheets: July, August, Total · columns: date, code, revenue |
| HR Handbook.docx | docx, 18 sections | 90 KB | 12K | "Chapter 1. General provisions…" |
```

Page count · sheet names · column names · section titles · first 40 characters — code reads all of it out during text extraction.

**Three things it solves at once:**
1. The assistant `Read`s **one small file** instead of `Glob`-ing the whole library.
2. **It closes gap #4** (`USE-CASES` — test #6, "a document longer than one task"). An earlier note said we needed *"a cheap `survey` step measuring file size before planning."* `INDEX.md` **is that step** — 0 tokens, deterministic. The assistant knows a contract is 34 pages **before** breaking work into tasks.
3. It answers *"which file is worth opening"*, which appendix §3 already identified as the right question.

`INDEX.md` **does not enter the prefix**. It's a file on disk that the agent actively reads when it needs to.

---

## 8b. ⚠ CORRECTION 19/08 — point 2 above WAS NEVER TRUE

> *"The assistant knows a contract is 34 pages **before** breaking work into tasks."*

**That sentence was false the entire time, from 17/08 to 19/08.** `INDEX.md` was being built cleanly, written to disk cleanly, and then **nobody ever handed it to the assistant.** Checked with one command:

```
grep "INDEX.md" src/core/     → 0 results
assistant.ts                   → allowedTools: []
```

The assistant has no tools, so it **has no way at all** to read that file. Second occurrence of the same §5d lesson: *an invariant is only real once source code enforces it.*

### The cost, measured on a user's machine (test #2, 19/08)

| | before | after |
|---|---|---|
| Assistant asks a clarifying question before starting | **yes** — *"is the size the customer wants to exchange still in stock?"* | no |
| Task `inputs` | `[]` | `["library/files/return-exchange.md"]` |
| Constraints the assistant wrote | 7, of which **4 were dead on arrival** once the worker read the document, and one was an **IF branch** left for the model to resolve on its own | 5, all usable |
| worker | **9 turns · $0.0582** — 4 turns of `Grep` fishing + reading the same file twice | **6 turns · $0.0296** |
| whole case | **11 turns · $0.1082** | **8 turns · $0.0511** |

The question *"is the size in stock"* is exactly a question whose **answer can't change what has to be done** — policy already forbade the exchange. But the assistant **had no way of knowing that**. This isn't the model being overly cautious, and **it can't be fixed with a prompt**: it's a data gap.

> **Measurement promoted to a rule:** *a clarifying question is only worth asking if the answer CHANGES what has to be done.*

### The fix: DATA, not INSTRUCTIONS

`LibraryStore.manifest()` — a small block that goes into the assistant's **cached** prefix:

```markdown
# Documents the human put in this office's library

- doi-tra.md — 15 lines
- bang-gia.md — 17 lines

Originals are in `library/files/`. Extracted text for keyword search is in `library/text/`.
When a task needs one of these, put its path in that task's `inputs`.
```

Measured for real: **103 tokens for 5 documents**, paid at ~0.1× per turn because it lives in cache.

**Two constraints keep it from breaking the cache:**

1. **Names and shape only, NO `preview`.** A preview would make the block both bigger and volatile. The assistant needs to know *what's in the library* to route to it, not *what it says* — it isn't the one reading the document.
2. **Skip documents still being extracted.** `pending`/`extracting` is a transient state lasting a few seconds; including it would mean the prefix changes **three** times per file drop instead of two.

`emitLibrary()` calls `refreshAssistantContext()` — ask a question right after dropping a document and the assistant has already seen it.

### The assistant still has NO tools — `Grep` was tried and pulled back

The manifest only says *what files exist*, so the natural next thought is giving the assistant `Grep` to reach the content. **Tried on 19/08 and abandoned.** Details in `SPEC-offices.md` §4.7; summary: no SDK mechanism scopes `Grep` to a directory, so the assistant would end up reading a worker's private notebook after it had been unwired — and worse, it would **tell the user it was blocked** when it wasn't blocked at all.

**The measured cost of dropping it: zero.** Across both reruns of test #2, the assistant **called no tool at all** — the prefix manifest alone was enough for it to plan correctly and hand out the right `inputs`.

⚠ **But a second, real leak was found here and has been patched:** `assistant.ts` only set `allowedTools: []` and **did not set `tools`**. That is exactly the same leak that was patched for the worker on 16/08 — `allowedTools` does not cut a tool out of the context, so **the definitions of Claude Code's entire tool set were still sitting in the prefix of `route()`**, which runs on **every message the user types**. The worker was fixed on 16/08; the assistant was forgotten for three days. Now `tools: []` is passed explicitly.

The *"notes ≠ documents"* boundary still lives in `ASSISTANT_CORE`, but shorter and **truthful**: the assistant has no tools, doesn't open files itself, and **a document wins when it contradicts a note**.

---

## 8c. `@path` — the user pointing directly at a file (locked 20/08)

The two stores (`library/files/` and `artifacts/`) **are allowed to have files with the same name**, and that isn't an oversight: they belong to two different owners (the user brings files in / a worker produces them) and have different lifecycles. So **a bare name is never an identifier**.

### The Copy button copies the FULL PATH, not the name

| store | string copied |
|---|---|
| Document library | `@library/files/doc-1.md` |
| Result | `@artifacts/P-260820-0314-rab5/T-01/doc-2.md` |

The full path **is itself the disambiguator**. Copying a bare name pushes the ambiguity onto the user retyping it by hand, and then onto the model guessing.

> ⚠ Two frames of reference, two different audiences — don't mix them. `company/offices/<id>/artifacts/…` is for someone **opening a file explorer** (it only appears in the result-report sentence). `artifacts/…`, measured from the office folder, is the **canonical** form everything in the system consumes: `inputs`, the API, the manifest, and the Copy button.

### `@` is OUR convention, not SDK syntax

The Claude Code CLI has `@file` when typed by hand. Whether it works in the SDK **has never been measured** — `FINDINGS-sdk` has zero lines on it, and this project has already paid once for building on unmeasured SDK behavior (`canUseTool`, `SPEC-offices.md` §4.7).

> 🔥 **A much stronger reason: if the SDK DID understand it, that would be a BAD thing.** Expanding `@` means injecting **file content** into a call — and the assistant runs on a persisted session, so everything it reads sits in the context of **every** subsequent turn: *read once, pay forever.* The whole architecture is built on the rule *"the assistant doesn't read files, only workers do."*

So `resolveFileRefs()` **strips `@` entirely** before the string reaches the model. We don't depend on any SDK behavior here — measured or not, it makes no difference.

### Four shapes

```
@artifacts/P-…/T-01/vi/doc-2.md      full path → match, then use
@library/files/doc-1.md               full path → match, then use
@doc-1.md                             bare name  → look up, and BLOCK if ambiguous
@library/files/Mix, Mingle&Meet.pptx  HAS A SPACE → longest-string match
```

The third shape is why this function exists; **the fourth shape is why it can't be cut at whitespace** (fixed 02/09).

Every reference is **matched against a real list of paths** read from disk. Three branches respond in **code, 0 tokens, instantly**:

| case | response |
|---|---|
| ambiguous name | list every matching path in full, tell them to use the Copy button |
| doesn't exist | echo back exactly what they typed |
| one broken reference in a sentence with several | **block the whole sentence**, keep the original wording |

The last branch deserves its own note: resolving half the sentence means the model gets one real path plus one stray `@…` string — it will **improvise**, and we lose control at the exact moment it matters most.

#### A reference's boundary is `known`, not whitespace (fixed 02/09)

The 20/08 version cut on whitespace (`@([^\s@]+)`), citing exactly one reason spelled out in a comment: *"a name with a space needs the full path, and the Copy button always gives the full path anyway."* **That premise was wrong** — the full path contains that very space. So with `Mix, Mingle&Meet.pptx`, the Copy button — the escape hatch the error message itself invites the user to click — produced a string the resolver couldn't read, and the answer was *"couldn't find `library/files/Mix"*.

The fix is **not** inventing a quoting convention (`@"…"`) and making users learn it, and **not** forcing filenames to be clean (the document is theirs). We're already **holding** the real list of paths read from disk, so there's no need to guess the boundary:

- match the **longest string** in `known` that the text after `@` starts with — longest before shortest, because `report.md` is a prefix of `report.md.bak`;
- with a **boundary guard**: the character right after has to be end-of-string, whitespace, or punctuation. Without it, a document named `anh` would turn `@anh-khong-co.md` into a match;
- if nothing matches ⇒ fall back to the old cut-on-whitespace behavior, so the error message still echoes exactly what was typed.

The sentence is rebuilt using **indices**, not `String.replace` — `replace` only hits the first occurrence in the whole sentence, so `@a.md then @a.md again` would fix the same spot twice.

> ⚠ This door runs on text **the user typed**, unlike the ban on path-guessing inside `say` (`SPEC-artifacts.md` §2.5). There, the risk is the **model making things up**; here, the user is responsible for what they typed, and the result still has to pass through the matching door.
>
> And we're only allowed to **strip `@`**, never to **edit**: the first version swallowed a trailing comma stuck to the reference (`fix @a/b.md, keep the rest…`), which is editing the user's own words without saying so. A small thing, but a bad habit.

### The document library manifest also has to list full paths

Three strings need to match **character for character**: the string in the manifest, the string the Copy button puts in the chat box, and the string the planner writes into `inputs`. The pre-20/08 manifest listed bare names (`- doc-1.md`) plus a note saying *"originals are in `library/files/"`, which forced the planner to **prepend the prefix itself** — a small extra step, and one more place to get it wrong.

Plus a rule in `CORE_PROMPT`: *"a path the user typed is authoritative — copy it straight into `inputs`, don't go looking for it, don't 'fix' it, and don't ask whether it exists."* It **has already** been matched before it reaches the model.

---

## 9. Getting files in: one main path, two free side doors

**Main path: HTTP upload, even on the same machine.**

*"It's the same laptop, just copy the file, it's faster"* sounds cheaper but isn't: the browser **does not hand JS a real path**, only bytes. Copy-by-path would require a native file dialog, i.e. Electron/Tauri. Meanwhile uploading 50MB over localhost is instant. **One code path, one set of bugs, running identically on a VPS/docker** — and it satisfies `SPEC-cli` §4's container constraint (mounting exactly one volume).

Two side doors cost **nothing extra**, since we already need scan-on-read anyway:

| Door | Who uses it |
|---|---|
| Drop files straight into `library/files/` via Explorer / `scp` | local machine, or a VPS that's already mounted |
| `agentco doc add <path>` | a VPS with only ssh |

### 9.1 NO file watcher

A real trap: copying a 200MB PDF triggers a watcher event **mid-write** → text extraction runs on a truncated file → nobody notices, and the catalog says `ready`.

Instead, **rescan on `GET /library`**: `readdir` + compare `mtime`/`size` against the catalog, a few ms. Plus an immediate refresh right after upload. That's "realtime" enough in every sense that matters, without ever catching a half-written file.

---

## 10. Indexing/converting: BACKGROUND, per-file — and exactly ONE, very narrow wait point

**Never freeze the whole system waiting for indexing.** That would break the "smooth" quality criterion, break *"one office crashing shouldn't drag another one down,"* and break the biggest rule of all: *no exception is ever worth stopping everything to apply a config change.*

But there's a real failure case: the user drops a PDF and asks about it right away → extraction isn't done yet → the agent greps and finds nothing → **it answers wrong and nobody knows**. That's the worst possible outcome.

Solved with a per-file state machine:

```
pending → extracting → ready | image-only | failed | unsupported
```

and **exactly one wait point**:

> `office.run()` waits **only for documents currently `extracting`** (with a timeout), waits for nothing else, touches no other office.

Status line: *"Reading document Contract ABC.pdf…"*. A few lines of code, and it wipes out the whole silent-wrong-answer failure mode.

### 10.1 An error has to LOOK LIKE an error

Following the rule locked in after the toast incident: shown on **that exact file's row** in the library, `danger-soft` background, and the wording has to say *what happened + what to do next*:

- *"File is password-protected — remove the password and drop it in again."*
- *"File is corrupt, or isn't actually a PDF despite the .pdf extension."*
- *"Scanned copy, no text layer."* ← `image-only`, **not an error**, gray label

A failed file **still stays in the library** (it's the user's own file) but is labeled as not searchable. Hiding it repeats exactly the node-got-overwritten bug fixed on 16/08.

---

## 11. Foreign keys / graph: NO. Just one JOIN.

The user asked the right question and had the right doubt themselves. Decision: **no graph, and the assistant never gets to write document IDs into the knowledge store on its own.**

The reason is stronger than "calling an LLM would be slow":

> **A knowledge node pointing at a document ID becomes a dead reference the instant the user deletes that document** — and the freedom to delete freely is exactly the design chosen in §6.

At that point, the prefix of **every worker** contains a pointer to a file that no longer exists, and the model will go looking for it: burning a turn, every task, silently. Fixing it would mean scanning the entire knowledge store on every file deletion → a second mechanism that has to stay in sync with the first, forever.

**The thing worth building is cheap and nearly done already.** Appendix §1 has it right: what intuitively gets called a "graph" here is actually a **join** — `file · plan_id · task_id · role · timestamp`, one JSONL line appended when a receipt lands. `receipt.landed` **is already that piece.** 0 LLM calls.

It answers the question the user is actually asking — *"where did this file come from, who created it, from which task"* — not *"which file talks about X,"* a question `Grep` answers better than anything we could build.

---

## 12. Configuration

```yaml
# company.yaml
library:
  max_file_mb: 50
  # Accepted extensions. Removing one here blocks it immediately, no rebuild needed.
  allow: [md, txt, csv, json, yaml, yml, pdf, docx, xlsx, pptx]
  # How long to wait at the §10 wait point before continuing without text.
  extract_timeout_ms: 30000
```

---

## 13. API

Every route under `/api/office/:id/library` goes through the existing set of gates (token · CSRF `Sec-Fetch-Site` · DNS rebinding · `assertLive`).

| | |
|---|---|
| `GET /library` | rescan + return `{ docs: [...] }`. This is where §9.1 scans, no watcher involved |
| `POST /library` | `multipart/form-data`. `409` on a name collision without `?replace=1` |
| `DELETE /library?name=<name>` | permanently delete the original + sidecar. One level (§6) |
| `GET /library/file?name=<name>` | download the original |

`POST` is **the first route in the system that receives binary data.** The `max_file_mb` cap has to be enforced **streaming, while receiving**, not after it's all been buffered into RAM — otherwise a 2GB file crashes the daemon before it ever reaches the check.

---

## 14. Effect on `TEST-WALKTHROUGH.md`

This is **metric #1** in the results table: *"how many tests require opening an editor?"*

| Test | Before | After |
|---|---|---|
| 2 Customer support | 📝 hand-write 5 node files into `knowledge/shared/` | 🖱 drop 5 policy files into the library |
| 3 Bookkeeping | 📝 create `artifacts/input/statement.csv` | 🖱 drop the CSV into the library |
| 5 Localization | 📝 put 3–5 documents into `artifacts/input/` | 🖱 drop into the library |
| 6 Contract review | 📝 + **cut short because length couldn't be measured** | 🖱 drop it · `INDEX.md` tells the assistant it's 34 pages before dividing the work |
| 7 Spreadsheets | 📝 200-row CSV | 🖱 drop into the library |
| 8 Screening | 📝 20 resumes into `artifacts/input/cv/` | 🖱 drop 20 files into the library |

**Test #2 changed premise, not purpose** (user locked this in 17/08): the new premise is *"the customer adds policy files to the document library."* It shifts from measuring `KnowledgeStore.cold()` to measuring `Grep` — and that's the more correct thing to measure, since a shop's policies are **documents the user owns**, not lessons the agent distilled on its own.

⚠ A consequence worth noting: after the change, **no test measures `cold()`'s keyword scoring anymore.** We need either a dedicated test #2b, or to accept that `cold()` is only checked indirectly through test #5.

---

## 15. Things that must be CHECKED before promising them to a client

Following the rule *"an invariant is only real once source code enforces it"*:

| Item | Status |
|---|---|
| **Pure function tests** (`node --test`) | ✅ **21 tests, run in 0.4s, 0 tokens.** The project's first test suite. It caught a real bug on the very first run — see §16 |
| **Does `Grep` see `library/text/`** | ✅ **checked with real files**: `Grep "sick leave"` on the office folder returns `library/text/HR Handbook.docx.txt`. Content inside a `.docx` is now keyword-searchable |
| **Rejection paths** | ✅ ran all seven for real: image · `../` · a name starting with a dot · `CON.txt` · `.exe` disguised as `.pdf` · a non-ZIP file disguised as `.docx` · duplicate name (409) |
| **Dependency recount** | ✅ `.docx`/`.xlsx`/`.pptx` read via `node:zlib`, **0 new dependencies**. `.pdf` → `pdfjs-dist`, a **real dependency shipped with the product** as of 20/08 (§4.2). The project now has 4: `sdk` `yaml` `zod` `pdfjs-dist` |
| **Real PDF spike**: 1 book with a text layer · 1 scan | 🟡 **HALF DONE** — on 20/08, a real 2-page PDF with a text layer was tested end to end: correct text extraction, **correct page markers**, no more `Warning` lines after fixing `standardFontDataUrl`/`cMapUrl` (§4.3). Still owed: a **genuinely long book** and a **scan** (the `image-only` case) |
| **Does extracting large files block the event loop** | ⏳ not yet measured. `inflateRawSync` is synchronous; a 40MB `.xlsx` could stall the UI for a few hundred ms. If measurement shows real pain, switch to `worker_threads` — a change that touches nothing outside `pump()` |

---

## 15b. The **Document Library** node on the diagram — two doors in, ONE processing path

The user asked directly: *"so there are 2 places to upload a file?"* — **There are two DOORS, not two code paths.**

| | |
|---|---|
| `🗄 Document Library` node on the canvas | **one click** → opens the drawer · **drop a file directly on the node** → opens the drawer and uploads |
| Document Library drawer in the sidebar | **Add document** button · drag-and-drop into the drawer |

The canvas **never calls the upload API itself.** It puts the file into `pendingDocs` in the store and opens the drawer; the drawer is the ONLY place with `upload()`. The reason isn't tidiness, it's regression: two copies means that the day someone fixes the duplicate-name rule, one copy gets fixed and the other gets forgotten — exactly the bug class `skillFileFor` already hit (`SESSIONS_MEMORY` §8).

**The number on the node reads from the in-memory catalog, not a disk scan.** `describeNode` runs on every re-render of the diagram (dragging a node, every SSE event); a `readdir` there would be a disk touch per frame. Disk scanning only happens at `GET /library`.

---

## 15c. The knowledge/document nodes have no detail panel — a click OPENS DIRECTLY

The user reported: *"clicking the document library opens something on the right but nothing in it is interactive, there's no button except the ✕. And there's already a document library in the sidebar too. Isn't that flow redundant?"*

**Redundant, and the empty panel is a real bug** — `Inspector` has no render branch for `library`, so it draws exactly that frame with a ✕ and nothing inside.

But fixing it by *adding a branch* would be fixing it in the wrong place. The right question: **what is the right-hand detail panel FOR?**

> To **EDIT an object**: change its model, edit its profile, wire/unwire connections, pause it, delete it.

The knowledge store and the document library have **nothing to edit**. They're **DOORS**, not objects. The knowledge store panel used to be just 2 numbers + 2 paragraphs of explanation + an *"Open knowledge store"* button — i.e. a **lobby you have to walk through** to get where you actually wanted to go.

### The rule, and it answers the question for every node added later too

| Node | One click |
|---|---|
| Assistant · worker · MCP | **the right-hand detail panel** — there's something to edit |
| Knowledge store · Document library | **the left-hand drawer, opens directly** — nothing to edit |

### Four details that make it work correctly

**1. `showPanel` doesn't toggle, unlike `openPanel`.** The button on the tab bar toggles closed on a second click (that's normal tab behavior). But clicking the "Document Library" node means the intent is **always to OPEN** — using `openPanel` here would make a double-click "open then immediately close," which looks exactly like "the click didn't register."

**2. Clicking a store node does NOT select it** (`selected: null`). Selecting it would open an empty column on the right — exactly what was just removed.

**3. The gate lives in `Inspector`, not at the call site:**

```ts
if (node.kind === 'knowledge' || node.kind === 'library') return null;
```

One line, and it blocks a whole **class** of bugs: every store node added later would repeat this exact empty-panel bug if someone forgot to write a branch for it. Now forgetting doesn't matter.

**4. Drop `onDoubleClick`.** A single click already opens it.

### The two explanatory paragraphs aren't lost — they move to the right place

They're facts about the **STORE**, not about the node on the diagram. So they move to the footer of the drawer itself, where the user reads them exactly while looking at the store. And each drawer **only points to the other one**:

- Knowledge store: *"this is what the system distilled on its own… you can edit and delete but not add new — put YOUR documents in the Document Library instead"* (clickable, jumps straight over)
- Document Library: *"these are documents YOU brought in… they are NOT in the prompt"*

The knowledge store's **empty** state carries that bridging button, because it's the one screen a new user actually reads closely — and the question right after is always *"so where does my document go?"*. Not answering it there sends them looking for a nonexistent "add note" button.

> **Principle to carry forward: two easily-confused concepts each have to state what they ARE and point to the other one.** The cheapest anti-confusion trick there is, and it costs **0 tokens** since it's purely in the UI.

### Layout

The two stores sit **side by side** in the bottom row — **knowledge store LEFT, document library RIGHT** — and **both use a dashed border**.

- *Side by side:* these are the two most easily-confused concepts in the product; placing them far apart means the user never sees them together, which is exactly when they merge into one thing in the user's head.
- *Dashed border:* not decoration. Agent nodes have ports and wires, so a solid border reads as *"this participates in relationships."* The two stores are **environments** — anyone can reach them, nobody wires up to them. The dashed border says that **before** the user even tries dragging a wire and fails.

⚠ The order has to match in **two places**: the default position (`src/core/layout.ts`) and `autoArrange()` (`web/src/canvas/geometry.ts`). A saved office keeps `layout.json`'s old positions until **Rearrange diagram** is clicked — deliberately: never move a node the user has already placed.

---

## 17. The charter moves out of the knowledge store — three bugs, one root cause

The user reported: *"creating a new office auto-creates an empty charter in the knowledge store, with a fairly high hit count… but I don't see it linked to the office intro in the assistant panel. Are these two different things?"*

**They're ONE thing.** `charter_file` defaults to `knowledge/shared/_charter.md`, so the same file is simultaneously the *"Office introduction"* prompt layer AND a node in the Knowledge drawer. Two windows, two write paths, neither mentions the other. Three consequences, all of which have already happened on a real user's machine:

**1. A ghost node.** Every new office spawns a node the user didn't create, doesn't understand, and the drawer says *"agents write these themselves… nobody has to type them in by hand"* — a false statement right on the first screen.

**2. Deleting that node breaks things silently.** 100% reproducible:

```
PATCH /knowledge {id:"k/shared/_charter", remove:true}   → 200
PUT   /prompt/assistant/charter {text:"Hello"}            → 200
file  → "\nHello\n"          ← frontmatter is gone, it's no longer a knowledge node
```

Saving retains the "old" frontmatter, but the file was just deleted, so there's nothing to retain. The prompt still runs, so **nothing reports it.** The file `customer-support/knowledge/shared/_charter.md` on the user's machine literally equals `"\nHello\n"`, byte for byte.

**3. Paying TWICE for the same paragraph.** `hot()` excludes `pinned` nodes, but `cold()` does **not** — `visible()` doesn't filter `pinned`. So the charter competes in COLD, gets `hits` counted (measured: 6 and 3 across two offices), and gets rendered **additionally** into a task, while the charter's body **already** sits in the prefix via `office.charter`. The second copy sits past the cache breakpoint, so it's paid **at full price, every task.** This is the answer to *"fairly high hit count."*

### Decision: MOVE IT OUT, don't patch it in place

> **`charter.md` lives at the office root. Plain markdown, no frontmatter, not a knowledge node.**

Patching each symptom means remembering all three spots forever. Moving it out makes all three disappear at once — and the §7 invariant (*the knowledge store is only ever written by the agent*) becomes **true**, enforced by source code, instead of a promise in a spec.

| | Before | After |
|---|---|---|
| Path | `knowledge/shared/_charter.md` | `charter.md` |
| Format | markdown + YAML frontmatter | plain markdown |
| Created when | **automatically** on office creation | **only** when the user saves it for the first time |
| In the Knowledge drawer | yes (ghost node) | **no** |
| Enters the prompt how many times | 2 (prefix + COLD) | **1** (prefix) |
| Where to edit | two places, out of sync | **one place** |

**Answering *"will this delete my charter?"*: the content is NOT lost.** `migrateCharters()` runs at startup, extracts the body into `charter.md`, deletes the old file, and updates the `charter_file:` line in `office.yaml`. The only thing lost is frontmatter — metadata belonging to the store it just left. Already run for real across all three offices: not a single character lost.

### Four migration guarantees
1. **Idempotent per office**, one broken office doesn't block the rest.
2. **Never overwrite an existing `charter.md`** — that would be content the user wrote after migration.
3. **A charter with an empty body doesn't spawn an empty file** (the most common case: every office created from the UI).
4. **Called TWICE** in `migrateIfNeeded`: once for a company already on the new layout, once for a v0 company whose `knowledge/` just got moved into the office.

### One gap that's now closed
`PromptLayer.frontmatter` **is derived from the real path**, not hardcoded to `false`:

```ts
frontmatter: office.config.charter_file.replace(/\\/g, '/').startsWith('knowledge/')
```

Migration **can** fail (a locked file on Windows, a read-only folder, a user restoring an old backup). Hardcoding `false` would mean that on exactly those machines, the next save wipes frontmatter clean and **recreates the very bug just fixed.**

### One remaining loose end: `pinned` is now a dead flag
The charter was the only `pinned` node that ever existed. After the move, **nothing sets `pinned: true`** — all three `add*` functions write `false`, the UI has no button for it, only hand-editing a file can set it.

**Behavior kept as-is**, only the comment was corrected so it stops lying. Changing the meaning of a flag nobody uses yet buys risk for nothing in return. But noting it here for next time: **if a "pin this note" button gets built, pinned has to mean it's ALWAYS in HOT — and `cold()` would then have to exclude it**, or it would get rendered twice for the same task, exactly the trap the charter just fell into.

---

## 16. A bug the test suite caught on its very first run

Noting this because it's proof of `SESSIONS_MEMORY` §4's thesis (*testing pure functions SAVES money, it isn't a cost*), and because it very nearly became the worst kind of bug: **wrong, but plausible-looking.**

**Excel doesn't write empty cells to the file.** A row with `A=1`, `B` empty, `C=3` only has two `<c r="A1">` tags, nothing in between. The first version of `readSheetRows` read cells in appearance order → produced `1 | 3` → **every column after an empty cell shifted one position to the left.**

The consequence wasn't just an ugly table: walkthrough tests #3 and #7 assign exactly the task *"sum a column."* A shifted column still produces a number, still looks plausible, and is wrong — precisely gap #3 that `USE-CASES` warned about (*the system has no way to verify a number*).

Fix: derive position from the `r="C1"` attribute, not from traversal order. Three tests lock this in: a cell dropped from the file · a self-closing `<c/>` cell · a column past Z (`AA` = column 27).

**And one line that turned out wrong only because it was actually run against real data:** `INDEX.md` said *"columns: revenue, 1500"* — we can observe the content of the first row, we **can't** observe whether that row is a header. A file exported from a different system could easily put real data in row one. Changed to **"first row:"**. Same rule as the token table: one false line damages trust in every true line next to it.
