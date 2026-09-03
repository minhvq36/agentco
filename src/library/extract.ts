/**
 * Extract text from a document — ONCE, AT UPLOAD TIME.
 *
 * → docs/SPEC-library.md §3, §4
 *
 * Extracting at upload pays the cost exactly once, and pays it in CPU.
 * Extracting at read time pays it again for every task, in tokens. That's the
 * entire reason this file exists.
 *
 * No function here calls an LLM. Everything returned is something OBSERVED
 * from the file itself — page count, sheet names, column names, the opening
 * text. → SESSIONS_MEMORY §2
 */

import { createRequire } from 'node:module';
import path from 'node:path';

import { openZip } from './zip.js';
import { plural, t } from '../i18n/index.js';

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT WAS OBSERVED, NOT A SENTENCE ABOUT IT.                              │
 * │                                                                          │
 * │ This used to be one `shape: string` — "csv, 12 rows · first row: …" — and│
 * │ that single field was read by two worlds with opposite rules. It goes    │
 * │ into `INDEX.md`, which an EMPLOYEE reads, so it has to be English like   │
 * │ every other piece of prompt scaffolding; and it is drawn in the document │
 * │ cabinet, where it has to follow the interface switch. A stored sentence  │
 * │ can satisfy exactly one of those, and it is also written to disk, so the │
 * │ language of a file's description would freeze at whichever moment it was │
 * │ extracted and never move again.                                          │
 * │                                                                          │
 * │ Holding the FACTS instead lets `shapeEn()` build the English line for    │
 * │ the prompt and `shapeSay()` build the displayed one through `t()`, from  │
 * │ the same datum, every time either is asked for.                          │
 * │                                                                          │
 * │ ⚠ Nothing here comes from a model. Pages, sheet names, the first row —   │
 * │ all of it is observed in the file itself. → SESSIONS_MEMORY §2           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export type Shape =
  | { kind: 'text'; lines: number }
  | { kind: 'csv'; rows: number; firstRow: string[] }
  | { kind: 'docx'; headings: number; paras: number }
  | { kind: 'xlsx'; sheets: string[]; firstRow: string[] }
  | { kind: 'pptx'; slides: number }
  | { kind: 'pdf'; pages?: number };

export interface Extracted {
  text: string;
  /** The observed structure, turned into a sentence by `shapeEn` / `shapeSay`. */
  shape: Shape;
  /** Page count, PDF only. Used to detect a scanned copy (§3.2). */
  pages?: number;
  /** The first few dozen words, so the user recognizes the document without opening it. */
  preview: string;
}

/** A record written before `Shape` existed still holds the old sentence. */
export type StoredShape = Shape | string;

/**
 * The line an EMPLOYEE reads in `INDEX.md`. English, hard-coded, never `t()`.
 *
 * This is prompt scaffolding: naming a language here would be the wire the
 * language rule forbids, and it would also make the document cabinet read in
 * two languages at once for anyone who ever flipped the switch.
 * → docs/CLAUDE.md §Language
 */
export function shapeEn(shape: StoredShape | undefined, fallback: string): string {
  if (shape === undefined) return fallback;
  // Pre-`Shape` record: the stored sentence is all we have. Show it as it is
  // rather than re-extracting the file, which for a PDF is not a cheap read.
  if (typeof shape === 'string') return shape;
  switch (shape.kind) {
    case 'text':
      return `${shape.lines} lines`;
    case 'csv':
      return shape.firstRow.length
        ? `csv, ${shape.rows} rows · first row: ${shape.firstRow.join(', ')}`
        : `csv, ${shape.rows} rows`;
    case 'docx':
      return shape.headings > 0 ? `docx, ${shape.headings} headings` : `docx, ${shape.paras} paragraphs`;
    case 'xlsx': {
      const head = `${shape.sheets.length} sheets: ${shape.sheets.join(', ')}`;
      return shape.firstRow.length ? `${head} · first row: ${shape.firstRow.join(', ')}` : head;
    }
    case 'pptx':
      return `${shape.slides} slides`;
    case 'pdf':
      return shape.pages === undefined ? 'pdf' : `pdf, ${shape.pages} pages`;
  }
}

/**
 * The same datum, for the DOCUMENT CABINET. Follows the interface switch.
 *
 * Kept next to `shapeEn` on purpose: two readers of one union drift apart the
 * moment a `kind` is added and only one of them is updated. Side by side, the
 * compiler's exhaustiveness check fires for both in the same edit.
 */
export function shapeSay(shape: StoredShape | undefined, fallback: string): string {
  if (shape === undefined) return fallback;
  if (typeof shape === 'string') return shape;
  switch (shape.kind) {
    case 'text':
      return plural('lib.shapeLines', shape.lines);
    case 'csv':
      return shape.firstRow.length
        ? `${plural('lib.shapeCsv', shape.rows)} · ${t('lib.shapeFirstRow', { cells: shape.firstRow.join(', ') })}`
        : plural('lib.shapeCsv', shape.rows);
    case 'docx':
      return shape.headings > 0
        ? plural('lib.shapeDocxHeadings', shape.headings)
        : plural('lib.shapeDocxParas', shape.paras);
    case 'xlsx': {
      const head = `${plural('lib.shapeSheets', shape.sheets.length)}: ${shape.sheets.join(', ')}`;
      return shape.firstRow.length
        ? `${head} · ${t('lib.shapeFirstRow', { cells: shape.firstRow.join(', ') })}`
        : head;
    }
    case 'pptx':
      return plural('lib.shapeSlides', shape.slides);
    case 'pdf':
      return shape.pages === undefined ? 'pdf' : plural('lib.shapePdfPages', shape.pages);
  }
}

/**
 * `pdfjs-dist` failed to load. As of 20/08 this means a BROKEN INSTALL, no
 * longer "the user hasn't installed the extra piece" — so it still has its own
 * type, but the message shown to the user has changed completely. See
 * `extractPdf`.
 */
export class PdfToolMissing extends Error {
  constructor() {
    super('could not load the PDF reader');
    this.name = 'PdfToolMissing';
  }
}

// ─────────────────────────────────────────────────────────────── plain text

export function extractText(buf: Buffer, ext: string): Extracted {
  const text = buf.toString('utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  let shape: Shape = { kind: 'text', lines: lines.length };
  if (ext === 'csv') {
    /**
     * Called "first row", NOT "column headers".
     *
     * We observe the content of line one; we do NOT observe that it's a
     * header line. A file exported from a different system could easily start
     * straight with data, and in that case the label "columns:
     * 2026-07-02, GRAB, 85000" would be a lie — exactly the kind of lie the
     * token table taught us breaks trust in every other line that IS true.
     */
    const first = (lines[0] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    shape = { kind: 'csv', rows: lines.length - 1, firstRow: first.slice(0, 8) };
  }
  return { text, shape, preview: previewOf(text) };
}

// ─────────────────────────────────────────────────────────────── docx

export function extractDocx(buf: Buffer): Extracted {
  const zip = openZip(buf);
  const xml = zip.read('word/document.xml');
  if (!xml) throw new Error('this .docx has no content part — it may be corrupt');
  const s = xml.toString('utf8');

  /**
   * ⚠ Table cells are split into multiple LINES rather than kept as a row.
   *
   * Inside a cell is `<w:tc><w:p>…</w:p></w:tc>`, so there's no cheap way to
   * make `</w:p>` break a line in a paragraph without also breaking it inside
   * a cell. We chose to break: each cell becomes one greppable line. Ugly to
   * read by eye, but this file exists to be `Grep`ped, not read.
   */
  const text = stripTags(
    s
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\s*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tr>/g, '\n'),
  );

  const headings = (s.match(/w:val="Heading/g) ?? []).length;
  const paras = (s.match(/<\/w:p>/g) ?? []).length;
  return {
    text,
    shape: { kind: 'docx', headings, paras },
    preview: previewOf(text),
  };
}

// ─────────────────────────────────────────────────────────────── xlsx

export function extractXlsx(buf: Buffer): Extracted {
  const zip = openZip(buf);

  const shared: string[] = [];
  const ss = zip.read('xl/sharedStrings.xml');
  if (ss) {
    // One <si> can contain MULTIPLE <t> (when a cell has several differently
    // formatted runs). Join them, otherwise "Revenue **Q3**" becomes two separate strings.
    for (const m of ss.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const parts = [...(m[1] ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1] ?? ''));
      shared.push(parts.join(''));
    }
  }

  /**
   * Link the sheet name to its FILE via r:id, don't guess by the order of
   * `sheet1.xml`, `sheet2.xml`. File order inside the package isn't guaranteed
   * to match sheet order in the workbook — and if they diverge, every sheet
   * name in INDEX.md ends up wrong, silently.
   */
  const rels = new Map<string, string>();
  const relXml = zip.read('xl/_rels/workbook.xml.rels');
  if (relXml) {
    for (const m of relXml.toString('utf8').matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(m[0])?.[1];
      const target = /Target="([^"]+)"/.exec(m[0])?.[1];
      if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, ''));
    }
  }

  const sheets: Array<{ name: string; path: string }> = [];
  const wb = zip.read('xl/workbook.xml');
  if (wb) {
    for (const m of wb.toString('utf8').matchAll(/<sheet\b[^>]*>/g)) {
      const name = decodeXml(/name="([^"]*)"/.exec(m[0])?.[1] ?? '');
      const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? '';
      const target = rels.get(rid);
      if (name && target) sheets.push({ name, path: `xl/${target}` });
    }
  }
  if (sheets.length === 0) {
    // If workbook.xml can't be read there's still a fallback: take the sheet files directly.
    for (const n of zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()) {
      sheets.push({ name: n.replace(/^.*\//, '').replace(/\.xml$/, ''), path: n });
    }
  }

  const blocks: string[] = [];
  // The first row of the FIRST sheet. Correctly called "first row", not
  // "columns": we see the content of line one, we don't see that it's a header line.
  const firstRow: string[] = [];
  for (const sheet of sheets) {
    const raw = zip.read(sheet.path);
    if (!raw) continue;
    const rows = readSheetRows(raw.toString('utf8'), shared);
    if (firstRow.length === 0 && rows[0]) firstRow.push(...rows[0].filter(Boolean).slice(0, 8));
    blocks.push(`## Sheet: ${sheet.name}\n${rows.map((r) => r.join(' | ')).join('\n')}`);
  }

  const text = blocks.join('\n\n');
  const shape: Shape = { kind: 'xlsx', sheets: sheets.map((s) => s.name), firstRow };
  return { text, shape, preview: previewOf(text) };
}

/**
 * Reads the rows of one sheet.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ AN EMPTY CELL ISN'T IN THE FILE — AND THAT'S WHAT SHIFTS COLUMNS.        │
 * │                                                                          │
 * │ Excel drops empty cells from the XML entirely. A row with A=1, B empty,  │
 * │ C=3 is written as two tags, `<c r="A1">` and `<c r="C1">`, with nothing  │
 * │ in between. Reading sequentially by appearance order gives `1 | 3` —     │
 * │ every column after the empty one SHIFTS LEFT by one, silently.           │
 * │                                                                          │
 * │ The consequence isn't just an ugly table: TEST-WALKTHROUGH tests 3 and 7 │
 * │ hand a worker the exact task "sum this column". Shift the columns and the│
 * │ number still comes out, still looks plausible, and is wrong.             │
 * │                                                                          │
 * │ So position has to come from the `r` attribute ("C1" → 3rd column), not  │
 * │ from traversal order. The test suite caught exactly this.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function readSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    // Match BOTH forms: the self-closing `<c .../>` and `<c ...>…</c>`.
    // Matching only the second form would drop every cell that's formatted but has no value.
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const inner = cellMatch[2] ?? '';

      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (ref) {
        const col = columnIndex(ref);
        while (cells.length < col) cells.push('');
      }

      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      if (type === 's') {
        const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '-1');
        cells.push(shared[idx] ?? '');
      } else if (type === 'inlineStr') {
        cells.push(decodeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? ''));
      } else {
        cells.push(decodeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''));
      }
    }
    // Drop empty cells at the END of a row — they carry no information and
    // just produce a trailing extra `|`. Empty cells in the MIDDLE must stay, see the block above.
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/** "A" → 0 · "B" → 1 · "AA" → 26. Excel numbers columns in a base-26 system with no zero digit. */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ─────────────────────────────────────────────────────────────── pptx

export function extractPptx(buf: Buffer): Extracted {
  const zip = openZip(buf);
  const slides = zip.names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNo(a) - slideNo(b));

  const blocks: string[] = [];
  for (const name of slides) {
    const raw = zip.read(name);
    if (!raw) continue;
    const runs = [...raw.toString('utf8').matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1] ?? ''));
    blocks.push(`## Slide ${slideNo(name)}\n${runs.join('\n')}`);
  }
  const text = blocks.join('\n\n');
  return { text, shape: { kind: 'pptx', slides: slides.length }, preview: previewOf(text) };
}

function slideNo(name: string): number {
  return Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? '0');
}

/**
 * pdf.js's resource directory, in exactly the shape it demands.
 *
 * ⚠ A BARE DISK PATH, NOT `file://`. The parameter name is `...Url`, so the
 * first instinct is to build a URL — and that fails SILENTLY: under Node,
 * pdf.js calls `fs.readFile(url)` directly with the string we hand it, and
 * `fs` doesn't understand a `file:///D:/…` string. It just logs one
 * `Warning:` line, keeps going, and returns text missing its glyph mapping.
 *
 * FORWARD slashes even on Windows: pdf.js concatenates `url + filename`
 * rather than `path.join`, and it specifically requires a trailing slash.
 */
function assetDir(home: string, name: string): string {
  return `${home.replace(/\\/g, '/')}/${name}/`;
}

// ─────────────────────────────────────────────────────────────── pdf

/**
 * Extract PDF — the ONLY format that needs an external library.
 *
 * Compressed content streams + CID font encodings aren't something you write
 * yourself in a few hundred lines, unlike Office's ZIP+XML. So `pdfjs-dist`
 * is a REAL dependency.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BEFORE 20/08 IT WAS AN OPTIONAL DEPENDENCY, AND THAT WAS THE WRONG CALL.  │
 * │                                                                           │
 * │ A user drops in a PDF contract and gets back:                             │
 * │   *"PDF reader not installed yet … Install: npm i pdfjs-dist"*            │
 * │                                                                           │
 * │ They asked exactly the right question: *"once this ships as a product,    │
 * │ how is the user supposed to handle that?"* Someone running a flower shop  │
 * │ has no `npm`. To them that isn't a suggestion — it's a closed door, and   │
 * │ the feature might as well not exist.                                      │
 * │                                                                           │
 * │ The document cabinet's *"0 new dependencies"* rule (17/08) is still right │
 * │ for the case it was written for: docx/xlsx/pptx are ZIP+XML, extractable  │
 * │ in a couple hundred lines by hand. PDF isn't, and a feature that only     │
 * │ works on a machine with the right toolchain isn't actually finished.      │
 * │ 36MB on disk is the price, and it sits right next to the SDK's 304MB.     │
 * │                                                                           │
 * │ Still loaded DYNAMICALLY, but for an entirely different reason now: those │
 * │ 36MB only load into memory once someone actually drops in a PDF, not on   │
 * │ every daemon startup.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `PdfToolMissing` still exists, now meaning a **broken install**
 * (`npm install` ran partway, or someone installed with `--omit=optional`).
 * Still its own type because the fix is completely different from "this file
 * is broken": one means fixing the install, the other means changing the file.
 */
export async function extractPdf(buf: Buffer): Promise<Extracted> {
  let pdfjs: any;
  let home: string;
  try {
    /**
     * The path lives in a VARIABLE: the `legacy` build ships no type
     * declarations, and an `import()` with a literal string makes TypeScript
     * demand types at compile time.
     *
     * Use the `legacy` build rather than `build/pdf.mjs`: the regular build
     * assumes very recent browser/Node APIs, while legacy has its syntax
     * lowered — this is the build that runs across the widest range of Node
     * versions, and we don't control the user's machine.
     */
    const spec = 'pdfjs-dist/legacy/build/pdf.mjs';
    pdfjs = await import(spec);
    home = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  } catch {
    throw new PdfToolMissing();
  }

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    // PDF pages are never rendered, only their text is extracted — disable
    // everything that needs a browser environment, or it goes looking for a canvas and throws a confusing error.
    disableFontFace: true,
    isEvalSupported: false,
    /**
     * ⚠ THESE TWO DIRECTORIES AREN'T FOR RENDERING — THEY'RE GLYPH ENCODING
     * TABLES.
     *
     * Without `standardFontDataUrl`, pdf.js warns on the very first run; text
     * still comes out for a simple PDF, so it's easy to assume this is
     * harmless. But for base-14 fonts that are NOT embedded, the encoding
     * table lives inside exactly these files — without it, `getTextContent`
     * returns glyphs that can't be translated back to Unicode.
     *
     * `cMapUrl` is the CID → Unicode map for the prebuilt CMaps. This is the
     * Vietnamese/CJK-in-a-PDF-exported-from-Word case — exactly the kind of
     * contract test 6 drops in. Skip it and the extracted text is a pile of
     * garbage characters, `Grep` matches nothing, and there isn't a single
     * error line to explain why.
     *
     * Both can only be pointed at because `pdfjs-dist` is now a REAL
     * dependency — back when it was optional, there was no path that knew
     * where it lived.
     */
    standardFontDataUrl: assetDir(home, 'standard_fonts'),
    cMapUrl: assetDir(home, 'cmaps'),
    cMapPacked: true,
  }).promise;

  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((it: any) => (typeof it.str === 'string' ? it.str : '')).join(' ');
    /**
     * PAGE MARKER — the piece linking "Grep finds the line" to "Read the
     * right page" (§3.1). Drop it and a worker can find a sentence but has no
     * way to know which page to open, and falls back to reading the whole
     * document. The format must match `pageOfLine`.
     */
    parts.push(`--- page ${i} ---\n${line.replace(/\s+/g, ' ').trim()}`);
  }
  await doc.destroy?.();

  const text = parts.join('\n\n');
  return {
    text,
    shape: { kind: 'pdf', pages: doc.numPages },
    pages: doc.numPages,
    preview: previewOf(text),
  };
}

// ─────────────────────────────────────────────────────────────── shared

/** Strips every XML tag then cleans up extra whitespace. */
function stripTags(s: string): string {
  return decodeXml(s.replace(/<[^>]*>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // `&amp;` goes LAST: reverse the order and `&amp;lt;` gets decoded twice into `<`.
    .replace(/&amp;/g, '&');
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** The first ~40 words of actual content. Enough to recognize the document, short enough to fit a table cell. */
function previewOf(text: string): string {
  const flat = text
    .split('\n')
    .filter((l) => !l.startsWith('--- page ') && l.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = flat.split(' ').slice(0, 40).join(' ');
  return words.length < flat.length ? `${words}…` : words;
}
