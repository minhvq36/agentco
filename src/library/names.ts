/**
 * File name and format checks — ALL PURE FUNCTIONS.
 *
 * → docs/SPEC-library.md §4
 *
 * Deliberately separated from the I/O: this is exactly the layer that
 * `SESSIONS_MEMORY.md` §4 ranks priority 0 for automated tests — it compiles
 * clean, reads plausible, and is wrong in ways that only surface on real files.
 */

import { t, type MessageKey } from '../i18n/index.js';

/** Accepted extensions and how each is handled. → SPEC-library.md §4 */
export type Handling = 'text' | 'zip' | 'pdf';

export const HANDLING: Record<string, Handling> = {
  md: 'text',
  txt: 'text',
  csv: 'text',
  json: 'text',
  yaml: 'text',
  yml: 'text',
  docx: 'zip',
  xlsx: 'zip',
  pptx: 'zip',
  pdf: 'pdf',
};

/**
 * THE PATH AN EMPLOYEE CAN ACTUALLY OPEN — pure, derived from `(ext, state)`.
 * → SPEC-library §4.4
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A REAL FAILURE PRODUCED THIS FUNCTION (20/08, `P-260820-2219-5ltb`).     │
 * │                                                                          │
 * │ The library index listed `library/files/hd1.docx` and then said *"put    │
 * │ its path in that task's inputs"*. The assistant did EXACTLY as told —    │
 * │ and the `Read` tool cannot open a binary `.docx`. A three-step job died  │
 * │ at step one, $0.25, while `library/text/hd1.docx.txt` had been sitting   │
 * │ on disk since the moment the file was dropped in.                        │
 * │                                                                          │
 * │ ⚠ THE RULE DIFFERS BY FORMAT, and the previous version spoke as though   │
 * │ it did not:                                                              │
 * │                                                                          │
 * │   text (md/txt/csv/…)   the original IS the text      → files/           │
 * │   zip  (docx/xlsx/pptx) the original OPENS IN NOTHING → text/ only       │
 * │   pdf                   the original READS by page    → text/ + files/   │
 * │                                                                          │
 * │ Only PDF fits the "text to FIND, original to READ CLOSELY" rule (§3.1).  │
 * │ Applying that rule to docx points an employee at a binary file.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * It can be PURE because `extractOne` writes a sidecar on exactly one branch:
 * `ready` and `kind !== 'text'`. `image-only`/`unindexed`/`failed` all `return`
 * before that. So "does a sidecar exist" is derivable from the state without
 * touching disk — and the two cannot drift, because there is one definition.
 */
export interface DocPaths {
  /**
   * The path an employee can open. **Missing = the document is not usable yet**
   * — and in that case the index must list NO path at all, because listing one
   * is inviting someone to walk into it.
   */
  open?: string;
  /** The original, listed ONLY when it is both readable and ADDS something (an extracted pdf). */
  original?: string;
}

export function docPaths(name: string, ext: string, state: string): DocPaths {
  const files = `library/files/${name}`;
  const text = `library/text/${name}.txt`;
  const kind = HANDLING[ext];
  // An extension we do not accept has NO path at all. Drop this branch and every
  // unknown extension falls through to the `zip` case, where we would name a
  // sidecar that was never written — a test caught exactly this on the first run.
  if (!kind) return {};

  if (kind === 'text') return { open: files };

  if (state === 'ready') {
    // pdf: name both — the `--- trang N ---` markers in the extracted text only
    // mean something if the employee can reach the original and `Read` that page.
    return kind === 'pdf' ? { open: text, original: files } : { open: text };
  }

  // Not extracted yet. A PDF original is still readable (the model sees a page as
  // an image); a docx/xlsx/pptx original has no way in at all.
  if (kind === 'pdf' && (state === 'image-only' || state === 'unindexed')) {
    return { open: files };
  }
  return {};
}

/**
 * Extensions refused ON PURPOSE, each with the sentence to say about it.
 *
 * The list exists so the refusal can say *why*, instead of one generic "format
 * not supported" that has the user trying again three times.
 *
 * ⚠ Holds catalogue KEYS, not sentences. This is a module-level constant, so a
 * resolved string would be frozen at import to whichever language the process
 * started in. `safeName()` resolves it per call instead.
 */
export const REFUSED: Record<string, MessageKey> = {
  jpg: 'lib.refuseImageText',
  jpeg: 'lib.refuseImageText',
  png: 'lib.refuseImageText',
  gif: 'lib.refuseImage',
  webp: 'lib.refuseImage',
  heic: 'lib.refuseImage',
  mp4: 'lib.refuseVideo',
  mov: 'lib.refuseVideo',
  avi: 'lib.refuseVideo',
  mp3: 'lib.refuseAudio',
  wav: 'lib.refuseAudio',
  zip: 'lib.refuseArchive',
  rar: 'lib.refuseArchive',
  '7z': 'lib.refuseArchive',
  exe: 'lib.refuseExecutable',
  dll: 'lib.refuseExecutable',
  doc: 'lib.refuseDoc',
  xls: 'lib.refuseXls',
  ppt: 'lib.refusePpt',
};

/** Device names Windows reserves. `CON.txt` breaks too, not just `CON`. */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * The NAME LENGTH ceiling is in BYTES, not characters.
 *
 * The filesystem limit is ~255 bytes. An accented Vietnamese character costs 2–3
 * bytes in UTF-8, so a 150-"letter" name can go over. Counting with `.length` is
 * right for English and wrong for exactly the users we have. The headroom pays
 * for the `.txt` suffix a sidecar appends.
 */
const MAX_NAME_BYTES = 200;

export type NameCheck = { ok: true; name: string; ext: string } | { ok: false; reason: string };

/**
 * Clean and check a file name the user uploaded.
 *
 * DELIBERATELY NOT slugified: the user has to recognise their own file in the
 * library. Vietnamese diacritics in a file name are legal on both NTFS and ext4.
 * We REFUSE what is dangerous; we do not rewrite what is legal.
 */
export function safeName(input: string): NameCheck {
  const name = input.trim();
  if (!name) return { ok: false, reason: t('lib.nameEmpty') };

  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) {
    return { ok: false, reason: t('lib.nameTooLong') };
  }

  // Path traversal and directory separators. `safeJoin` blocks these too, but
  // blocking here yields an EXPLANATION instead of a generic exception.
  if (name.includes('/') || name.includes('\\')) {
    return { ok: false, reason: t('lib.nameHasSlash') };
  }
  if (name === '.' || name === '..') return { ok: false, reason: t('lib.nameInvalid') };

  /**
   * `|` — blocked AT THE DOOR, because it is the column separator of `INDEX.md`.
   *
   * Windows forbids this character anyway, so blocking it here takes away no name
   * that works on all three systems. In exchange, a row of the library index
   * cannot break — and a broken row there means the assistant reads out a dead
   * path. → `renderIndex`
   */
  if (name.includes('|')) {
    return { ok: false, reason: t('lib.namePipe') };
  }

  // Control characters and NUL. A name containing \0 gets truncated at the OS
  // layer: the check sees "a.txt.exe", the disk gets "a.txt".
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) < 0x20) return { ok: false, reason: t('lib.nameControlChar') };
  }

  /**
   * A leading dot — REFUSED, and this is not about looks.
   *
   * `Grep` skips everything starting with a dot when it walks a directory
   * (measured, see SPEC-library.md §2.1). A `.env.txt` in the library shows up in
   * the interface, extracts fine, and is NEVER found. Silently.
   */
  if (name.startsWith('.')) {
    return { ok: false, reason: t('lib.nameLeadingDot') };
  }

  /**
   * A trailing dot or space: Windows silently STRIPS it when creating the file.
   * The name in the catalogue then differs from the name on disk, and every later
   * delete or replace misses.
   */
  if (/[. ]$/.test(name)) {
    return { ok: false, reason: t('lib.nameTrailingDot') };
  }

  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return { ok: false, reason: t('lib.nameNoExtension') };
  }
  const ext = name.slice(dot + 1).toLowerCase();
  const stem = name.slice(0, dot);

  if (WINDOWS_RESERVED.has(stem.toLowerCase())) {
    return { ok: false, reason: t('lib.nameWindowsDevice', { stem }) };
  }

  const refused = REFUSED[ext];
  if (refused) return { ok: false, reason: t(refused) };
  if (!HANDLING[ext]) {
    return { ok: false, reason: t('lib.extNotAccepted', { ext, list: Object.keys(HANDLING).join(', ') }) };
  }

  return { ok: true, name, ext };
}

export type SniffResult = { ok: true } | { ok: false; reason: string };

/**
 * Check that the CONTENT matches the extension.
 *
 * Renaming `virus.exe` to `report.pdf` takes two seconds. For an office running
 * on a VPS the upload route is a real door, so an extension is not evidence.
 * Check the first few bytes — cheap, deterministic, no dependency.
 */
export function sniffType(head: Buffer, ext: string): SniffResult {
  const kind = HANDLING[ext];
  if (!kind) return { ok: false, reason: t('lib.extUnknown', { ext }) };

  if (kind === 'pdf') {
    // The PDF spec allows junk before the header, and plenty of real files carry
    // real junk. Scan the first 1KB instead of comparing at offset 0.
    const idx = head.subarray(0, 1024).indexOf('%PDF-');
    if (idx < 0) {
      return { ok: false, reason: t('lib.notRealPdf') };
    }
    return { ok: true };
  }

  if (kind === 'zip') {
    // docx/xlsx/pptx are all ZIPs. `PK\x03\x04` = local file header.
    if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) {
      return { ok: false, reason: t('lib.notRealZip', { ext }) };
    }
    return { ok: true };
  }

  /**
   * Text: there are no magic bytes to compare, so check the OTHER WAY ROUND — a
   * binary file wearing a `.txt` almost always has a NUL byte near the start, and
   * valid UTF-8 text never does.
   */
  if (head.subarray(0, 8192).includes(0)) {
    return { ok: false, reason: t('lib.notText', { ext }) };
  }
  return { ok: true };
}

/**
 * The page holding line `line` of the text extracted from a PDF.
 *
 * This is the piece that joins "Grep found the line" to "Read the right page"
 * (§3.1). Returns `undefined` when the file has no page markers — every format
 * that is not a PDF.
 */
export function pageOfLine(text: string, line: number): number | undefined {
  const lines = text.split('\n');
  let page: number | undefined;
  for (let i = 0; i < Math.min(line, lines.length); i++) {
    const m = /^--- trang (\d+) ---$/.exec(lines[i] ?? '');
    if (m) page = Number(m[1]);
  }
  return page;
}

/** "1.2 MB" — shared by INDEX.md and the interface so the two cannot drift. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** "41K" — an estimated token count, short enough for a table cell. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${Math.round(n / 1000)}K`;
}
