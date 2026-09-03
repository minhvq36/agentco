/**
 * The document cabinet: files the USER drops in.
 *
 * → docs/SPEC-library.md
 *
 * Differs from the knowledge store in the one place that matters most:
 * **nothing here ever enters the prefix**. The knowledge store is paid for
 * every turn, every worker, so it has a 250-token ceiling and an automatic
 * lifecycle (supersedes · hits · prune). The document cabinet sits on disk,
 * reached with `Glob`/`Grep`, and **never deletes anything on its own** —
 * because what it holds is the customer's own files, not agent-generated notes.
 *
 * ⚠ No directory in here may start with a dot: `Grep` skips hidden
 * directories while traversing (measured — SPEC-library.md §2.1). Hiding
 * `text/` inside `.state/` would silently kill the entire retrieval mechanism.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { OfficePaths } from '../core/paths.js';
import { estimateTokens } from '../core/tokens.js';
import {
  HANDLING,
  docPaths,
  formatBytes,
  formatTokens,
  safeName,
  sniffType,
  type Handling,
} from './names.js';
import {
  PdfToolMissing,
  extractDocx,
  extractPdf,
  extractPptx,
  extractText,
  extractXlsx,
  shapeEn,
  shapeSay,
  type Extracted,
  type StoredShape,
} from './extract.js';
import { t } from '../i18n/index.js';

export type DocState =
  /** just dropped in, not extracted yet */
  | 'pending'
  /** being extracted — this is the ONLY state `office.run()` has to wait on (§10) */
  | 'extracting'
  /** extracted, findable by keyword */
  | 'ready'
  /** a scan: extracts to ~0 text. NOT an error — the model can read it directly */
  | 'image-only'
  /** couldn't extract due to a missing tool, but the original is still usable */
  | 'unindexed'
  /** the file is corrupt, password-protected, or doesn't match the format its extension claims */
  | 'failed';

/**
 * Why the record is NOT `ready`, as a CODE rather than a sentence.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The same reasoning as `Shape`, and it arrived through the same failure:  │
 * │ this field is written to `catalog.json`, then read both by `INDEX.md`    │
 * │ (an employee reads it, so English) and by the document cabinet (a person │
 * │ reads it, so the interface switch). A stored sentence answers one of     │
 * │ those and freezes at extraction time besides — flip the switch and every │
 * │ file already in the cabinet keeps explaining itself in the old language, │
 * │ for good, because nothing re-extracts on a settings change.              │
 * │                                                                          │
 * │ `failed` is the one code carrying free text: the underlying error string │
 * │ comes from a library and there is no catalogue entry that could hold it. │
 * │ It is shown as-is, which is honest — a technical line the reader can     │
 * │ search for beats a translated paraphrase of it.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export type DocNote =
  | { code: 'extUnknown'; ext: string }
  | { code: 'pdfReaderMissing' }
  | { code: 'imageOnly' }
  | { code: 'passwordProtected' }
  | { code: 'tooLarge' }
  | { code: 'corruptZip'; ext: string }
  | { code: 'unreadable'; detail: string };

export interface DocRecord {
  name: string;
  ext: string;
  bytes: number;
  mtime: string;
  state: DocState;
  /**
   * The observed structure. `string` is a record written BEFORE this field
   * became a datum — keeps the old sentence as-is, doesn't re-extract (a PDF isn't a cheap read).
   */
  shape?: StoredShape;
  preview?: string;
  tokens?: number;
  pages?: number;
  /** Why the state isn't `ready`. `string` is also an old-style record. */
  note?: DocNote | string;
  extracted_at?: string;
}

/**
 * A record with the SENTENCE ALREADY BUILT, for the interface. → `docView`
 *
 * The interface never sees raw `Shape`/`DocNote`: building the sentence in
 * two places means the two places drift apart, and the drifted one will be
 * whichever gets opened least. The server builds it once, right at the exit door.
 */
export interface DocView extends Omit<DocRecord, 'shape' | 'note'> {
  shape?: string;
  note?: string;
}

/** `DocRecord` (facts, on disk) → `DocView` (a sentence, following the interface switch). */
export function docView(d: DocRecord): DocView {
  const { shape, note, ...rest } = d;
  const said = shapeSay(shape, d.ext);
  const noted = noteSay(note);
  return { ...rest, ...(said ? { shape: said } : {}), ...(noted ? { note: noted } : {}) };
}

/** Scan-detection threshold: fewer characters per page than this counts as having no text layer. */
const CHARS_PER_PAGE_MIN = 50;

export class LibraryStore {
  private docs = new Map<string, DocRecord>();
  private working = false;

  constructor(
    private paths: OfficePaths,
    private onChange: () => void = () => {},
  ) {
    this.load();
  }

  rebind(paths: OfficePaths): void {
    this.paths = paths;
    this.docs.clear();
    this.load();
  }

  get size(): number {
    return this.docs.size;
  }

  list(): DocRecord[] {
    return [...this.docs.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  /**
   * Syncs the catalog against the real directory, then kicks off any missing extraction.
   *
   * DELIBERATELY called on every `GET /library` instead of using a file
   * watcher. A watcher fires an event MID-COPY while a large file is still
   * being written in → extracts truncated text → the catalog records
   * `ready` → nobody notices. Scanning at read time is `readdir` + `stat`, a
   * few milliseconds, and it never sees a half-written file. → SPEC-library.md §9.1
   */
  scan(): DocRecord[] {
    fs.mkdirSync(this.filesDir, { recursive: true });
    fs.mkdirSync(this.textDir, { recursive: true });

    /**
     * ⚠ DID SOMETHING ACTUALLY CHANGE — `scan()` runs on EVERY `GET
     * /library`, so it absolutely must not report "changed" when nothing
     * changed. See the comment block at `pump()`: one spurious report here
     * is an infinite loop in the interface.
     */
    let dirty = false;
    const onDisk = new Map<string, fs.Stats>();
    for (const entry of fs.readdirSync(this.filesDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      try {
        onDisk.set(entry.name, fs.statSync(path.join(this.filesDir, entry.name)));
      } catch {
        /* the file disappeared between readdir and stat — treat as absent */
      }
    }

    // Gone from disk → gone from the catalog, and its sidecar goes with it.
    // Skipping the sidecar cleanup would let `Grep` find the content of a document that's been deleted.
    for (const name of [...this.docs.keys()]) {
      if (!onDisk.has(name)) {
        this.docs.delete(name);
        this.dropSidecar(name);
        dirty = true;
      }
    }

    for (const [name, stat] of onDisk) {
      const mtime = stat.mtime.toISOString();
      const known = this.docs.get(name);
      if (known && known.bytes === stat.size && known.mtime === mtime) continue;

      // A new file, or one already replaced by a different file right on
      // disk. Both cases need re-extraction from scratch — and the old sidecar has to die FIRST.
      this.dropSidecar(name);
      const checked = safeName(name);
      this.docs.set(name, {
        name,
        ext: checked.ok ? checked.ext : path.extname(name).slice(1).toLowerCase(),
        bytes: stat.size,
        mtime,
        ...(checked.ok
          ? { state: 'pending' as const }
          : { state: 'failed' as const, note: checked.reason }),
      });
      dirty = true;
    }

    this.save();
    /**
     * Only rebuilds the INDEX and reports a change when the CATALOG ACTUALLY CHANGED.
     *
     * The case that has to keep working: a file deleted outside the app ⇒
     * nothing to extract ⇒ `pump()` does nothing ⇒ if this stays silent too,
     * `INDEX.md` keeps the name of a document that's already gone.
     */
    if (dirty) {
      this.renderIndex();
      this.onChange();
    }
    void this.pump();
    return this.list();
  }

  /**
   * Accepts a new document.
   *
   * Throws with a READABLE SENTENCE for every rejection path — a user who
   * dropped in the wrong file needs to know why immediately, not retry three times.
   */
  add(rawName: string, data: Buffer, opts: { replace?: boolean; maxBytes: number }): DocRecord {
    const checked = safeName(rawName);
    if (!checked.ok) throw new LibraryError(checked.reason);

    if (data.length === 0) throw new LibraryError(t('lib.fileEmpty'));
    if (data.length > opts.maxBytes) {
      throw new LibraryError(
        t('lib.fileTooBig', { size: formatBytes(data.length), ceiling: formatBytes(opts.maxBytes) }),
      );
    }

    const sniffed = sniffType(data.subarray(0, 8192), checked.ext);
    if (!sniffed.ok) throw new LibraryError(sniffed.reason);

    const dest = path.join(this.filesDir, checked.name);
    if (fs.existsSync(dest) && !opts.replace) {
      throw new LibraryError(t('lib.duplicate', { name: checked.name }), 'duplicate');
    }

    /**
     * DELETE THE SIDECAR BEFORE OVERWRITING — not after.
     *
     * This is exactly the "write one way, read another" bug class
     * (SESSIONS_MEMORY §8). If the new file gets written first and cleanup
     * happens after, and that cleanup fails, `Grep` finds the content of the
     * version that's ALREADY BEEN REPLACED — silently, forever, with a
     * worker quoting a sentence that no longer exists in the file the user has open.
     */
    this.dropSidecar(checked.name);

    fs.mkdirSync(this.filesDir, { recursive: true });
    fs.writeFileSync(dest, data);
    const stat = fs.statSync(dest);

    const rec: DocRecord = {
      name: checked.name,
      ext: checked.ext,
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
      state: 'pending',
    };
    this.docs.set(rec.name, rec);
    this.save();
    void this.pump();
    return rec;
  }

  /**
   * RE-EXTRACTS a document that isn't usable yet. → SPEC-library.md §4.5
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A DOCUMENT BROKEN FOR A REASON THAT'S SINCE BEEN FIXED STAYED BROKEN            │
   * │ FOREVER — UNTIL 20/08.                                                    │
   * │                                                                          │
   * │ `contract2.pdf` was dropped into the cabinet before a PDF reader existed,       │
   * │ so it received `unindexed`. That same afternoon `pdfjs-dist` became a real       │
   * │ dependency — and the document stayed `unindexed`, with the literal sentence       │
   * │ *"Install: npm i pdfjs-dist"* sitting in the Assistant's own prefix. No way        │
   * │ to re-extract it: the user had to DELETE it and drop their own file back in         │
   * │ again.                                                                     │
   * │                                                                          │
   * │ `state` is a RECORD OF THE PAST, not a permanent fact — and its underlying         │
   * │ cause is one that can change (a tool got installed, a version got upgraded, a       │
   * │ bug got fixed). Without a way back, that record turns into a life sentence.         │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Returns `false` when the document doesn't exist or the original has disappeared from disk.
   */
  reextract(rawName: string): boolean {
    const rec = this.docs.get(rawName);
    if (!rec) return false;
    if (!fs.existsSync(path.join(this.filesDir, rec.name))) return false;
    // Clears the old sidecar FIRST: if re-extraction fails, better to have no
    // text copy at all than to keep an old one while `state` now says it hasn't been extracted.
    this.dropSidecar(rec.name);
    delete rec.note;
    rec.state = 'pending';
    this.save();
    void this.pump();
    return true;
  }

  /**
   * Retries ONCE at startup for documents missing a tool. → `reextract`
   *
   * ⚠ ONLY `unindexed`, deliberately leaves `failed` alone. The two states
   * say entirely different things: `unindexed` = *this machine doesn't have
   * the tool yet* (fixable, and usually already fixed right at the next
   * restart after installing); `failed` = *this file itself is broken*
   * (doesn't change). Retrying `failed` on every daemon startup burns CPU on
   * a known outcome, and for a large file it slows down every single startup.
   */
  retryUnindexed(): number {
    const stuck = [...this.docs.values()].filter((d) => d.state === 'unindexed');
    for (const d of stuck) this.reextract(d.name);
    return stuck.length;
  }

  /** Permanently deletes: the original + its extracted text. One tier, no "archive". → §6 */
  remove(rawName: string): boolean {
    const rec = this.docs.get(rawName);
    if (!rec) return false;
    fs.rmSync(path.join(this.filesDir, rec.name), { force: true });
    this.dropSidecar(rec.name);
    this.docs.delete(rec.name);
    this.save();
    this.renderIndex();
    this.onChange();
    return true;
  }

  /** The original's absolute path, for downloading. `undefined` if it doesn't exist. */
  originalPath(rawName: string): string | undefined {
    const rec = this.docs.get(rawName);
    if (!rec) return undefined;
    const abs = path.join(this.filesDir, rec.name);
    return fs.existsSync(abs) ? abs : undefined;
  }

  /**
   * Waits for documents CURRENTLY BEING EXTRACTED — and only those.
   *
   * This is the ONE wait point in the whole feature (§10). Without it,
   * there's a real, silent failure mode: the user drops a PDF and asks about
   * it immediately, `Grep` runs before the text even exists, and a worker
   * answers "found nothing" very convincingly. With it, the cost is a few
   * seconds' wait, in exchange for the correct answer.
   *
   * A timeout is mandatory: a file broken in some way we haven't anticipated
   * must never be allowed to hang the entire office.
   */
  async settled(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.busyCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  busyCount(): number {
    let n = 0;
    for (const d of this.docs.values()) if (d.state === 'pending' || d.state === 'extracting') n++;
    return n;
  }

  /**
   * THE LISTING FOR THE ASSISTANT — a small block of data that goes into the cached prefix. → §8b
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY THIS HAS TO EXIST: THE ASSISTANT WAS BLIND, AND IT COST REAL MONEY.         │
   * │                                                                          │
   * │ `INDEX.md` was built on 17/08 with the exact purpose "the Assistant knows           │
   * │ what's in the cabinet BEFORE delegating work" — and then nobody ever handed         │
   * │ it to the Assistant. The Assistant runs with `allowedTools: []`, so it had           │
   * │ no way to find out what was in the cabinet at all.                                 │
   * │                                                                          │
   * │ Consequences measured on the user's own machine (test 2, 19/08):                    │
   * │  · asking the same question again whose answer CANNOT change what needs to           │
   * │    be done ("is there stock left" — even though policy had already forbidden          │
   * │    changing it)                                                                     │
   * │  · planning with `inputs: []` → the worker has to grope around: 4 Grep runs +          │
   * │    2 Read runs on the same file → 9 turns, $0.0582 for one customer-facing            │
   * │    answer                                                                          │
   * │  · writing 7 constraints where 4 die the moment the worker reads the document,        │
   * │    and one is an IF-branch handed to the model to resolve on its own                 │
   * │                                                                          │
   * │ Fixed with DATA, not with instructions: this listing is entirely observable          │
   * │ from the files themselves, built in code, 0 LLM calls.                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Two constraints keep this from breaking the prompt cache:
   *
   * 1. **Only name + shape, NO `preview`.** A preview makes the block both
   *    LARGER (~40 words extra per file) and CHANGE OFTEN. The Assistant
   *    needs to know *what's in the cabinet* to point a worker in the right
   *    direction, not *what the content says* — it isn't the one reading the document.
   * 2. **Skips documents still being extracted.** `pending`/`extracting` is a
   *    fleeting few-second state; including it means dropping in one file
   *    changes the prefix THREE times instead of two. A document only
   *    appears once it's genuinely usable.
   */
  manifest(): string {
    const usable = this.list().filter((d) => d.state !== 'pending' && d.state !== 'extracting');
    if (usable.length === 0) return '';

    const lines = usable.map((d) => {
      /**
       * THE STATED PATH MUST BE A PATH A WORKER CAN OPEN. → `docPaths`, §4.4
       *
       * The earlier version always stated `library/files/<name>` and
       * instructed "put that path into `inputs`". For a `.docx` that's a
       * binary file — an entire three-step task died at step one (20/08)
       * while the `.txt` copy was sitting right next to it.
       *
       * Three things still have to match character-for-character: the string
       * here, the Copy button's string, and the string the planner writes
       * into `inputs`. The Copy button hands over the path the USER
       * recognizes (`library/files/…`), and `readablePaths` translates it
       * into an openable path — so the two sides still meet, just at different layers.
       */
      const { open, original } = docPaths(d.name, d.ext, d.state);
      // English, always: an employee reads this block. → `shapeEn`
      const shape = shapeEn(d.shape, d.ext);

      // With no openable path at all, DO NOT STATE A PATH. Stating one would
      // invite the Assistant to hand out a task guaranteed to fail — exactly what just happened.
      if (!open) return `- ${d.name} — ${shape} (not extracted, not usable yet)`;

      // The flag is only for PERSISTENT states, and only states a real
      // constraint: whether keyword search finds it or not.
      const flag =
        d.state === 'image-only'
          ? ' (a scan — read it page by page, keyword search will NOT find it)'
          : d.state === 'unindexed'
            ? ' (not extracted — read it by page, keyword search will NOT find it)'
            : '';
      const alt = original ? ` (original for exact pages: ${original})` : '';
      return `- ${open} — ${shape}${flag}${alt}`;
    });

    return [
      `# Documents the human put in this office's library`,
      '',
      ...lines,
      '',
      'Each path above is one an employee can open directly — put it in that task\'s `inputs`',
      'instead of making them search. Where a `.pdf` original is listed too, give BOTH: the text',
      'to find the passage, the original to read those exact pages.',
    ].join('\n');
  }

  /**
   * The text of every document, each one opening with its FILE NAME on line one.
   *
   * Used for exactly one job: checking whether a lesson about to be written
   * to the knowledge store is just a copy of a document (`echoesLibrary`).
   * The file name is included so the warning can name EXACTLY which file —
   * "matches some document or other" is something the user can't verify, and
   * a warning nobody can verify is useless.
   *
   * NEVER enters anyone's prompt. It lives in-process, for a few
   * milliseconds, then gets released — the ceiling below exists so a 40MB
   * document doesn't choke the daemon over what's only a sanity check.
   */
  texts(maxCharsPerDoc = 200_000): string[] {
    const out: string[] = [];
    for (const doc of this.docs.values()) {
      if (doc.state !== 'ready') continue;
      // Text-native formats have no sidecar — the original IS the text (§3.1).
      const file = fs.existsSync(this.sidecarFor(doc.name))
        ? this.sidecarFor(doc.name)
        : path.join(this.filesDir, doc.name);
      try {
        out.push(`${doc.name}\n${fs.readFileSync(file, 'utf8').slice(0, maxCharsPerDoc)}`);
      } catch {
        /* the file just got deleted out from under us — skip it, this is only a sanity check */
      }
    }
    return out;
  }

  /** Names of documents currently being extracted — so the status line names them instead of saying "processing". */
  busyNames(): string[] {
    return [...this.docs.values()]
      .filter((d) => d.state === 'pending' || d.state === 'extracting')
      .map((d) => d.name);
  }

  // ── internal

  private get filesDir(): string {
    return path.join(this.paths.library, 'files');
  }
  private get textDir(): string {
    return path.join(this.paths.library, 'text');
  }
  private get catalogFile(): string {
    return path.join(this.paths.library, 'catalog.json');
  }
  private get indexFile(): string {
    return path.join(this.paths.library, 'INDEX.md');
  }

  private sidecarFor(name: string): string {
    return path.join(this.textDir, `${name}.txt`);
  }

  private dropSidecar(name: string): void {
    fs.rmSync(this.sidecarFor(name), { force: true });
  }

  /**
   * Extracts one at a time, ONE file at a time.
   *
   * Deliberately not parallel: unzipping and parsing XML is synchronous CPU
   * work, and running four at once in a single Node process isn't faster —
   * it just holds the event loop longer, and that same event loop is what's serving the interface and SSE.
   */
  private async pump(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      let did = false;
      for (;;) {
        const next = [...this.docs.values()].find((d) => d.state === 'pending');
        if (!next) break;
        did = true;
        next.state = 'extracting';
        this.save();
        this.onChange();
        await this.extractOne(next);
        this.save();
        this.onChange();
      }
      /**
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ 🔴 ONLY REPORT WHEN SOMETHING ACTUALLY HAPPENED — bug the user            │
       * │ reported, 02/09.                                                       │
       * │                                                                    │
       * │ The old version called `renderIndex() + onChange()` **unconditionally**,      │
       * │ even when the loop extracted no files at all. And `pump()` runs on EVERY       │
       * │ `GET /library` (through `scan()`), so a READ turn was firing a WRITE            │
       * │ event. The loop:                                                         │
       * │                                                                    │
       * │   GET /library → scan → pump → `library.changed`                          │
       * │     → store: libraryVersion+1 **and** refreshCanvas()                      │
       * │     → LibraryPanel `useEffect(reload, [reload, libraryVersion])`               │
       * │     → GET /library → …                                                    │
       * │                                                                    │
       * │ Runs forever while the Document cabinet panel is open, and has **no             │
       * │ symptom** beyond the fan spinning up — until something else reads              │
       * │ `canvas`, at which point it surfaces (a prompt dialog flickering                 │
       * │ continuously). → SPEC-library §10                                            │
       * │                                                                    │
       * │ 📌 The rule this yields: **a READ must never emit a CHANGE event.**            │
       * │ The only place allowed to emit one is the place that actually writes.           │
       * └────────────────────────────────────────────────────────────────────┘
       */
      if (did) {
        this.renderIndex();
        this.onChange();
      }
    } finally {
      this.working = false;
    }
  }

  private async extractOne(rec: DocRecord): Promise<void> {
    const abs = path.join(this.filesDir, rec.name);
    const kind: Handling | undefined = HANDLING[rec.ext];
    if (!kind) {
      rec.state = 'failed';
      rec.note = { code: 'extUnknown', ext: rec.ext };
      return;
    }

    let out: Extracted;
    try {
      const buf = fs.readFileSync(abs);
      out =
        kind === 'text'
          ? extractText(buf, rec.ext)
          : kind === 'pdf'
            ? await extractPdf(buf)
            : rec.ext === 'docx'
              ? extractDocx(buf)
              : rec.ext === 'xlsx'
                ? extractXlsx(buf)
                : extractPptx(buf);
    } catch (err) {
      if (err instanceof PdfToolMissing) {
        /**
         * The document is still usable — a worker can `Read` the original
         * directly by page, only losing the ability to keyword search. State exactly that, with the action to take.
         *
         * ⚠ This sentence USED TO tell the user to type `npm i pdfjs-dist`
         * (fixed 20/08). Reading PDFs is part of the product, not an extra
         * the user installs themselves — `pdfjs-dist` is now in
         * `dependencies`, so reaching this branch means a BROKEN INSTALL, and
         * the action is re-running `npm install`, not going looking for an npm package name.
         */
        rec.state = 'unindexed';
        rec.note = { code: 'pdfReaderMissing' };
        rec.shape = { kind: 'pdf' };
        return;
      }
      rec.state = 'failed';
      rec.note = noteForError(err, rec.ext);
      return;
    }

    rec.shape = out.shape;
    rec.preview = out.preview;
    rec.tokens = estimateTokens(out.text);
    if (out.pages !== undefined) rec.pages = out.pages;
    rec.extracted_at = new Date().toISOString();

    /**
     * A scan: extracts to almost no text at all. NOT flagged as an error —
     * the model sees a PDF page as an image, so it CAN read it, just more
     * expensively and without grep. The spec's first draft called this
     * "needs OCR, not yet supported", and that was a wrong sentence that
     * chased users away from something that actually already worked. → §3.2
     */
    if (rec.pages && out.text.replace(/--- page \d+ ---/g, '').trim().length < rec.pages * CHARS_PER_PAGE_MIN) {
      rec.state = 'image-only';
      rec.note = { code: 'imageOnly' };
      return;
    }

    // Text-native formats need NO copy: the original is already text and
    // `Grep` reads it directly. Generating a sidecar for it would only
    // create two copies of the same thing, and someday they'd drift apart.
    if (kind !== 'text') {
      fs.mkdirSync(this.textDir, { recursive: true });
      fs.writeFileSync(this.sidecarFor(rec.name), out.text, 'utf8');
    }
    rec.state = 'ready';
    delete rec.note;
  }

  /**
   * `INDEX.md` — the routing layer, built in CODE, 0 tokens. → §8
   *
   * Every column is OBSERVABLE from the file itself. No LLM call happens
   * here, and that's exactly what sets it apart from the idea "generate a
   * summary node for every file" — that idea hits the same goal but pays for
   * one call per document.
   *
   * This file does NOT enter the prefix. The Assistant proactively reads it
   * when it needs to know "what's in the cabinet" — one small file, instead of `Glob`-ing the whole directory.
   */
  renderIndex(): void {
    const docs = this.list();
    fs.mkdirSync(this.paths.library, { recursive: true });

    if (docs.length === 0) {
      fs.writeFileSync(
        this.indexFile,
        '# Document cabinet\n\nNo documents yet. The user drops files in through the interface.\n',
        'utf8',
      );
      return;
    }

    const rows = docs.map((d) => {
      const note =
        d.state === 'ready'
          ? (d.preview ?? '')
          : `**${stateEn(d.state)}** — ${noteEn(d.note)} ${d.preview ?? ''}`.trim();
      // The "Open with" column is the MOST IMPORTANT column in this table,
      // and before 20/08 it didn't exist — anyone reading INDEX.md had to
      // guess which path was openable, and the Assistant guessed wrong. → `docPaths`
      const { open, original } = docPaths(d.name, d.ext, d.state);
      /**
       * ⚠ A `|` IN A FILE NAME SPLITS A TABLE ROW IN HALF.
       *
       * `|` is valid on ext4/APFS (only Windows forbids it), and `scan()`
       * accepts even files someone copies by hand straight into
       * `library/files/` — bypassing `safeName` entirely. A name like that
       * splits the row into misaligned columns, and the column that drifts
       * the worst is exactly "Open with": the Assistant reads out a truncated path.
       *
       * So the name and description get characters SUBSTITUTED (they're only
       * for display), while the path is NOT — a modified path is a dead
       * path, and a dead path costs far more than a blank cell. A name with
       * `|` ⇒ state plainly that it isn't usable yet.
       */
      const cell = (s: string): string => s.replace(/\|/g, '/').replace(/\r?\n/g, ' ');
      const openCell = d.name.includes('|')
        ? '— the file name contains `|`; rename it and drop it again'
        : open
          ? original
            ? `\`${open}\` + \`${original}\` (read those exact pages)`
            : `\`${open}\``
          : '— not usable yet';
      return `| ${cell(d.name)} | ${cell(shapeEn(d.shape, d.ext))} | ${formatBytes(d.bytes)} | ${
        d.tokens ? formatTokens(d.tokens) : '—'
      } | ${openCell} | ${cell(note)} |`;
    });

    /**
     * ⚠ ENGLISH, and not through `t()` — an EMPLOYEE reads this file, so it is
     * prompt scaffolding like every other block that reaches a model.
     * → docs/CLAUDE.md §Language
     */
    const lines = [
      `# Document cabinet — ${docs.length} documents`,
      '',
      '**Use the exact path in the "Open with" column.** The rules differ by format:',
      '',
      '- `.md .txt .csv .json .yaml` — the original IS the text; read `library/files/` directly.',
      '- `.docx .xlsx .pptx` — the original is a zip archive, **no tool opens it directly**.',
      '  Use only the extracted copy at `library/text/<name>.txt`.',
      '- `.pdf` — use BOTH: `Grep` the text copy to find the passage, then look up to the nearest',
      '  `--- page N ---` marker above the hit and `Read` that exact page of the original.',
      '',
      '| Name | Type | Size | ~Tokens | Open with | Opening / structure |',
      '|---|---|---|---|---|---|',
      ...rows,
      '',
      `_Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} — built in code, no model involved._`,
      '',
    ];
    fs.writeFileSync(this.indexFile, lines.join('\n'), 'utf8');
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.catalogFile, 'utf8')) as { docs?: DocRecord[] };
      for (const d of raw.docs ?? []) {
        // If the daemon shuts down mid-extraction, that state is meaningless
        // on restart. Reset it to `pending` so it gets extracted again,
        // instead of staying stuck at `extracting` forever and making
        // `settled()` wait out the full timeout on EVERY run afterward.
        this.docs.set(d.name, d.state === 'extracting' ? { ...d, state: 'pending' } : d);
      }
    } catch {
      /* no catalog yet, or it's corrupt — a rescan rebuilds everything */
    }
  }

  private save(): void {
    fs.mkdirSync(this.paths.library, { recursive: true });
    fs.writeFileSync(
      this.catalogFile,
      JSON.stringify({ generated: new Date().toISOString(), docs: this.list() }, null, 2),
      'utf8',
    );
  }
}

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'duplicate' = 'invalid',
  ) {
    super(message);
    this.name = 'LibraryError';
  }
}

/** Status label for the USER — follows the interface switch. */
export function stateLabel(s: DocState): string {
  switch (s) {
    case 'pending':
      return t('lib.statePending');
    case 'extracting':
      return t('lib.stateExtracting');
    case 'ready':
      return t('lib.stateReady');
    case 'image-only':
      return t('lib.stateImageOnly');
    case 'unindexed':
      return t('lib.stateUnindexed');
    case 'failed':
      return t('lib.stateFailed');
  }
}

/** The same label, for `INDEX.md` — an employee reads it, so hard-coded English. */
function stateEn(s: DocState): string {
  switch (s) {
    case 'pending':
      return 'waiting';
    case 'extracting':
      return 'reading';
    case 'ready':
      return 'ready';
    case 'image-only':
      return 'a scan';
    case 'unindexed':
      return 'not indexed';
    case 'failed':
      return 'failed';
  }
}

/**
 * Turns a technical error into a CODE that states the next action.
 *
 * The "good error handling" criterion says: every error has to state *what
 * happened + what to do next*. A bare "Invalid PDF structure" line only
 * satisfies the first half.
 *
 * ⚠ Returns a code rather than a sentence, since the result goes straight
 * into `catalog.json` — see the comment block at `DocNote`. `unreadable` is
 * the only case carrying free text, and that text is the underlying
 * library's own verbatim message: it's searchable, a translation of it wouldn't be.
 */
function noteForError(err: unknown, ext: string): DocNote {
  const msg = err instanceof Error ? err.message : String(err);
  if (/password|encrypt/i.test(msg)) return { code: 'passwordProtected' };
  if (/ZIP64/i.test(msg)) return { code: 'tooLarge' };
  // Every throw in `zip.ts` names ZIP, and `zlib` says "inflate". Matching on
  // those two words is what keeps a corrupt archive out of the `unreadable`
  // bucket, where the reader would be handed a library string and no next step.
  if (/zip|inflate/i.test(msg)) return { code: 'corruptZip', ext };
  return { code: 'unreadable', detail: msg };
}

/**
 * `DocNote` → a sentence for the USER. Follows the interface switch.
 *
 * An old-style record carries a raw string: hand it back verbatim, never
 * guess a code from the wording — that would be exactly the detector wearing
 * a deterministic gate's clothes that `docs/CLAUDE.md` forbids.
 */
export function noteSay(note: DocNote | string | undefined): string | undefined {
  if (note === undefined) return undefined;
  if (typeof note === 'string') return note;
  switch (note.code) {
    case 'extUnknown':
      return t('lib.extUnknown', { ext: note.ext });
    case 'pdfReaderMissing':
      return t('lib.notePdfReaderMissing');
    case 'imageOnly':
      return t('lib.noteImageOnly');
    case 'passwordProtected':
      return t('lib.notePassword');
    case 'tooLarge':
      return t('lib.noteTooLarge');
    case 'corruptZip':
      return t('lib.noteCorruptZip', { ext: note.ext });
    case 'unreadable':
      return t('lib.noteUnreadable', { detail: note.detail });
  }
}

/** The same `DocNote`, but for `INDEX.md` — an employee reads it, so hard-coded English. */
export function noteEn(note: DocNote | string | undefined): string {
  if (note === undefined) return '';
  if (typeof note === 'string') return note;
  switch (note.code) {
    case 'extUnknown':
      return `.${note.ext} is not accepted yet.`;
    case 'pdfReaderMissing':
      return 'The PDF reader did not load, so keyword search will not find this. Read it by page instead.';
    case 'imageOnly':
      return 'A scan with no text layer — keyword search will not find it. Read it page by page.';
    case 'passwordProtected':
      return 'The file is password-protected.';
    case 'tooLarge':
      return 'The file is too large to read.';
    case 'corruptZip':
      return `This .${note.ext} is corrupt or not in the format its extension claims.`;
    case 'unreadable':
      return `Could not read the contents: ${note.detail}`;
  }
}
