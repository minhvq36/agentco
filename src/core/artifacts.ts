/**
 * RESULTS — files the WORKER creates. → docs/SPEC-artifacts.md
 *
 * The third column, standing next to the two that already exist, and all
 * three columns differ in WHO WRITES:
 *
 *   knowledge store  the agent extracts it   · enters the prefix, paid every turn
 *   document cabinet the user drops it in    · never enters the prefix, found via Grep
 *   RESULTS          the worker produces it  · never enters the prefix, the user picks it up
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS NOT A SECOND DOCUMENT CABINET, AND THAT LINE IS DELIBERATE.       │
 * │                                                                          │
 * │ There is no path from the interface that feeds a result back in as a       │
 * │ worker's input: no "send this to a worker" button, no field for picking an  │
 * │ artifact as input. Reusing one means the user hands it over themselves —      │
 * │ pasting the content into the chat box, or dropping the file into the           │
 * │ document cabinet.                                                        │
 * │                                                                          │
 * │ Distinct from what's STILL ALLOWED and unchanged: within ONE multi-step        │
 * │ plan, a later task reads an earlier task's artifact through `inputs`. That's    │
 * │ a wire internal to one job, not a store to pull from.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * No `add()`. No editor. The user VIEWS · DOWNLOADS · DELETES.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { OfficePaths } from './paths.js';

/**
 * UNFINISHED WORK SHOWS UP AS A NORMAL INPUT. → SPEC-artifacts.md §2.6
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS DOESN'T "AUTO-RECOGNIZE THIS AS OLD WORK" (the user's call, the      │
 * │ evening of 20/08).                                                        │
 * │                                                                          │
 * │ To automatically match a new request against an old failed run, the system    │
 * │ would have to guess three stacked things at once: *is this the same task* ·     │
 * │ *is the old file still correct* · *which task corresponds to which* (a new       │
 * │ plan that splits work differently means `task_id` carries no meaning across       │
 * │ two runs). Two of the three aren't observable at all.                          │
 * │                                                                          │
 * │ And the failure mode isn't about wasted money — it's this: a worker breaks       │
 * │ an old contract into 12 clauses · the user replaces `contract1.docx` with a       │
 * │ new version · a "smart" system reuses the 12 old files and returns a perfect,      │
 * │ convincing checklist **about a contract that no longer exists.** Same root as       │
 * │ the rule *"the knowledge store never holds document content"*: a stale copy         │
 * │ WINS over the original.                                                    │
 * │                                                                          │
 * │ ⇒ Don't guess "this is the same task". Just STATE what's sitting on disk,        │
 * │   with a stale/fresh label, and let the normal planning path decide — it        │
 * │   already does exactly that job every day, and it has the user's freshly-typed    │
 * │   request in hand.                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * "Stale" is something OBSERVED, not guessed: `plan.json` records exactly which
 * task reads which file and writes which file, so comparing `mtime` on both
 * ends settles it. Source newer than the product ⇒ the product is stale.
 * 0 tokens, deterministic.
 *
 * ⚠ Compared with `>`, not `>=`: writing both within the same second is normal
 * on disk, and marking things stale by mistake would tag every freshly
 * produced result with a warning label — the user learns to ignore that
 * label, and then ignores it the one time it's telling the truth.
 */
export function isStale(artifactMtime: string, inputMtimes: readonly string[]): boolean {
  if (inputMtimes.length === 0) return false;
  const made = Date.parse(artifactMtime);
  if (!Number.isFinite(made)) return false;
  return inputMtimes.some((m) => {
    const src = Date.parse(m);
    return Number.isFinite(src) && src > made;
  });
}

export interface ArtifactRecord {
  /** Path relative to the office directory: `artifacts/<plan_id>/<task_id>/x.md`. */
  path: string;
  name: string;
  ext: string;
  bytes: number;
  mtime: string;
  /** The plan that produced it. Empty for old files sitting directly under `artifacts/T-01/`. */
  plan_id: string;
  task_id: string;
  /** Can it be viewed directly in the browser, and how. → `viewOf` */
  view: ArtifactView;
}

/**
 * How to view a result. Decided by FILE EXTENSION, not content.
 *
 * `office` is a product decision, not a technical gap: `extract.ts` already
 * extracts `.docx/.xlsx/.pptx` at 0 dependency cost, so building a preview for
 * them is cheap. But an extracted-text preview of a Word file is a LIE — it
 * loses tables, loses layout, loses images. In the document cabinet, extracted
 * text exists for `Grep` to FIND and nobody ever looks at it directly; here
 * the user LOOKS at it to review before sending it to a customer. Same
 * technique, right in one place and wrong in the other.
 */
export type ArtifactView =
  /** Plain text — shown as-is. */
  | 'text'
  /** Markdown — shown formatted. */
  | 'markdown'
  /** Table — shown as a table. */
  | 'csv'
  /** Structured — shown indented, syntax-highlighted. */
  | 'code'
  | 'image'
  | 'pdf'
  | 'video'
  /** Not viewable in the browser: download it, open with the native app. */
  | 'download';

const VIEW: Record<string, ArtifactView> = {
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  csv: 'csv',
  tsv: 'csv',
  json: 'code',
  yaml: 'code',
  yml: 'code',
  html: 'code',
  xml: 'code',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  /**
   * `.svg` is DELIBERATELY NOT `image`.
   *
   * SVG is XML and it can run JavaScript. This file is generated by a MODEL,
   * and the daemon serves it from the same origin as the company's control
   * interface — which has no authentication beyond "same machine". Rendering
   * it through `<img>` would invite it to run in the house. The server also
   * forces `application/octet-stream` for this extension, so setting `image`
   * here would only produce a broken image icon. → server.ts `RISKY`
   */
  svg: 'download',
  pdf: 'pdf',
  mp4: 'video',
  webm: 'video',
};

export function viewOf(ext: string): ArtifactView {
  return VIEW[ext.toLowerCase()] ?? 'download';
}

/** MIME type so the browser renders it correctly on its own. */
const MIME: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  html: 'text/html; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function mimeOf(ext: string): string {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Ceiling for the PREVIEW portion. Past this ceiling it's still downloadable, just not rendered.
 *
 * The old `readArtifact` had no ceiling at all: a 50MB `.csv` generated by a
 * worker would be loaded entirely into the daemon's memory and pushed
 * entirely to the browser. Nobody hits this today since every result is a
 * markdown file a few hundred bytes — which is exactly the cheapest moment to put a ceiling in place.
 */
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

/** Don't traverse too deep — the results directory is flat, deeper than this is a sign something odd is going on. */
const MAX_DEPTH = 4;

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TWO DIFFERENT CEILINGS — BEFORE 02/09 THEY WERE ONE, AND THAT WAS THE ENTIRE BUG. │
 * │                                                                          │
 * │ The old version: `walk()` stopped outright at the 500th file, and only      │
 * │ THEN did `list()` sort by `mtime`. Sorting AFTER truncating saves nothing —   │
 * │ what falls out isn't the oldest file, it's **whatever `readdir` hadn't gotten  │
 * │ to yet**.                                                                 │
 * │                                                                          │
 * │ And on NTFS, `readdir` returns entries in NAME order, and this project's       │
 * │ directory names are `P-260820-0314-…` — meaning ordered by DATE, oldest         │
 * │ first. So past 500 files, what disappears is **the newest results**, exactly    │
 * │ what the user is looking for. No error message at all. (ext4 hashes names,     │
 * │ so it loses a random cluster instead — different mechanism, equally bad.)       │
 * │                                                                          │
 * │ Split into two: scan EVERYTHING first, then truncate, and truncate at the       │
 * │ spot that actually needs it.                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * The DISPLAY ceiling — the payload sent to the interface, truncated
 * **after already sorting by `mtime`**.
 *
 * Only the Results panel uses this ceiling. The Assistant's own listing has
 * its own separate ceiling (5 items / 600 tokens), while `readablePaths` and
 * `removeAll` are **never truncated** — see `scan`.
 */
export const MAX_PANEL_FILES = 500;

/**
 * The SCAN ceiling — its only job is keeping a pathological directory from hanging the daemon.
 *
 * Set far higher than the display ceiling because it is **not** what decides
 * what's shown: scanning 20,000 and then keeping the 500 newest is correct;
 * scanning only 500 and then truncating is the bug described above. Hitting
 * this ceiling makes `scan()` SAY SO (`capped`), never silently.
 */
const MAX_SCAN = 20_000;

export class ArtifactStore {
  constructor(private paths: OfficePaths) {}

  rebind(paths: OfficePaths): void {
    this.paths = paths;
  }

  /**
   * Scans the real directory on every read — no catalog, no watcher.
   *
   * Same reasoning as the document cabinet (SPEC-library §9.1), and stronger
   * here: this file is written by a WORKER while it runs, so any catalog
   * would already be stale mid-task. A few milliseconds of `readdir` + `stat` is always correct.
   *
   * Newest first: the user opens this panel right after a task just
   * finished, and what they're looking for is almost always whatever was just created.
   *
   * NOT truncated here. Three call sites need the full list — `readablePaths`
   * (an old path the user pasted in still has to resolve), `artifactManifest`
   * (the total count has to be accurate), `removeAll` (deleting means deleting
   * everything). The only place that needs truncation is the payload sent to
   * the interface, and that's truncated with `MAX_PANEL_FILES` after sorting.
   */
  list(): ArtifactRecord[] {
    return this.scan().items;
  }

  /**
   * One scan, along with THE TRUTH ABOUT THAT SCAN ITSELF.
   *
   * ⚠ Sorted with a raw string comparison, not `localeCompare`: `mtime` is
   * ISO-8601 UTC, so byte order IS chronological order, and `localeCompare`
   * (locale-aware comparison) is tens of times more expensive across a few
   * thousand records. `localeCompare` is only kept for the tie-break branch —
   * rare, and it needs to be stable across runs.
   */
  /**
   * A `mtime` tie is a REAL case: one run writing three files within the same
   * millisecond. Without a fallback branch, order would depend on `readdir`,
   * which varies by operating system — and a list that jumps around between
   * two openings is a list nobody trusts anymore.
   */
  /**
   * ONLY paths — no `stat`, no sorting. → `walk`
   *
   * For the two call sites that don't need to know file size or modification
   * time: `Office.readablePaths()` (runs on **every message**) and `removeAll()`.
   * Roughly an order of magnitude cheaper than `scan()` — see the measurement at `walk`.
   */
  filePaths(): { items: string[]; capped: boolean } {
    const rels: string[] = [];
    walk(this.paths.artifacts, '', 0, rels);
    return { items: rels.map((r) => `artifacts/${r}`), capped: rels.length >= MAX_SCAN };
  }

  scan(): { items: ArtifactRecord[]; capped: boolean } {
    const rels: string[] = [];
    walk(this.paths.artifacts, '', 0, rels);
    const out: ArtifactRecord[] = [];
    for (const rel of rels) {
      const r = record(this.paths.artifacts, rel);
      if (r) out.push(r);
    }
    out.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : a.path.localeCompare(b.path)));
    // `>=`, not `>`: the scan stops EXACTLY when it hits the ceiling, so we
    // don't know whether more files exist beyond it. The copy above therefore has to say "20,000 or more".
    //
    // Counted on `rels`, not on `out`: a file disappearing between `readdir`
    // and `stat` makes `out` shorter, and that's not the same thing as "hit the ceiling".
    return { items: out, capped: rels.length >= MAX_SCAN };
  }

  /** Absolute path, or `undefined` if it doesn't exist / sits outside the results directory. */
  resolve(rel: string): string | undefined {
    const norm = rel.replace(/\\/g, '/').replace(/^\.\//, '');
    // Only accept paths INSIDE artifacts/. `safeJoin` blocks escaping the
    // office, but inside the office there's also `roles/`, `office.yaml`,
    // `charter.md` — no reason a panel called "Results" should be able to read those.
    if (!norm.startsWith('artifacts/') || norm.includes('..')) return undefined;
    // Hidden directories: same reasoning as the old `readArtifact` —
    // `.state/` sits INSIDE the office and holds session ids.
    if (norm.split('/').some((seg) => seg.startsWith('.'))) return undefined;

    const abs = path.join(this.paths.root, norm);
    // Final check on the RESOLVED path: a symlink could point outside, and
    // the string checks above can't see that.
    const root = path.resolve(this.paths.artifacts);
    const real = path.resolve(abs);
    if (real !== root && !real.startsWith(root + path.sep)) return undefined;
    if (!fs.existsSync(real) || !fs.statSync(real).isFile()) return undefined;
    return real;
  }

  /**
   * Permanently deletes one result. ONE tier, no "archive" step.
   *
   * Same reasoning as the document cabinet (SPEC-library §6): an archive tier
   * would create a second store that also needs cleaning up. Differs in one
   * important way the interface has to state: for a document, the original
   * still sits on the user's own machine, while for a result, **this is the
   * only copy** — deleting it loses something that was already paid for to produce.
   *
   * Also cleans up any resulting empty directory: an empty
   * `artifacts/<plan_id>/T-01/` left behind only exists for the user to open
   * a file explorer and wonder what it is.
   */
  remove(rel: string): boolean {
    const abs = this.resolve(rel);
    if (!abs) return false;
    fs.rmSync(abs, { force: true });

    const root = path.resolve(this.paths.artifacts);
    let dir = path.dirname(abs);
    while (dir !== root && dir.startsWith(root + path.sep)) {
      try {
        if (fs.readdirSync(dir).length > 0) break;
        fs.rmdirSync(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
    return true;
  }

  /**
   * WIPES the entire Results panel. Returns the NUMBER of files deleted.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ Why this button exists, and why ONLY here (the user's call, 25/08):        │
   * │   *"applies only to result artifacts, not to documents or the knowledge         │
   * │    store"*                                                                │
   * │                                                                          │
   * │ The line is **CAN IT BE REBUILT OR NOT**, the exact measure already used       │
   * │ for the single-file delete button right above:                                 │
   * │   · results        → rerunning produces them again. Costs MONEY, doesn't          │
   * │                       lose anything irreplaceable.                                │
   * │   · documents       → the original sits on the user's own machine, but a           │
   * │                       bulk delete drags along lessons that depend on it            │
   * │                       (`depends_on`) — one click breaking two stores.              │
   * │   · knowledge        → **cannot be rebuilt with money**. No button exists           │
   * │                        for it at all.                                             │
   * │                                                                          │
   * │ And results are exactly where files pile up into the dozens after a few         │
   * │ days — the only place where deleting one-by-one is a genuine chore.             │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ Deletes through `remove()` file by file rather than `rm -rf`-ing the
   * whole directory: `resolve()` is the only place that knows the rule "only
   * inside `artifacts/`, no hidden directories, never follow a symlink out".
   * A shortcut here would be a second copy of that rule, and a second copy
   * always forgets a condition.
   */
  /**
   * ⚠ RE-SCANS UNTIL CLEAN — not a single pass.
   *
   * The old version ran exactly one pass of `list()`, and back then `list()`
   * truncated at 500. A Results panel with 700 files meant *"wipe"* deleted
   * 500, returned `500`, and the interface reported success while 200 files
   * still sat there. Same class of bug as yesterday's expense ledger: **a
   * delete must delete everything, or state that it didn't.**
   *
   * The loop ceiling exists so a file that can't be deleted (locked, wrong
   * permissions) doesn't turn this into an infinite loop — if it's still
   * stuck after the ceiling, it returns how many it managed to delete, and
   * the next scan will still see what's left.
   */
  removeAll(): number {
    let n = 0;
    for (let round = 0; round < 10; round++) {
      // `filePaths()`, not `scan()`: deleting doesn't need to know file size.
      const items = this.filePaths().items;
      if (items.length === 0) break;
      let removed = 0;
      for (const p of items) if (this.remove(p)) removed++;
      n += removed;
      if (removed === 0) break; // nothing left could be deleted — stop, don't spin
    }
    return n;
  }
}

/**
 * A SINGLE traversal function, and it does NOT `stat`. → `ArtifactStore.paths` · `§scan`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `stat` IS THE ENTIRE COST, AND MOST CALL SITES DON'T NEED IT.               │
 * │                                                                          │
 * │ Measured on the user's machine (Windows, 02/09) — `readdir` + `stat` per       │
 * │ file:                                                                     │
 * │     500 files →  51 ms  ·  2,000 → 230 ms  ·  5,000 → 493 ms                  │
 * │ i.e. ~0.1 ms per file, nearly all of it inside `statSync`.                      │
 * │                                                                          │
 * │ But `readablePaths()` — which runs on EVERY message the user types — only        │
 * │ needs path strings. So does `removeAll()`. Forcing those two call sites to        │
 * │ pay for `stat`'s `bytes`/`mtime`, which they immediately discard, would buy a       │
 * │ bottleneck right on the single hottest path.                                   │
 * │                                                                          │
 * │ So: traversal (cheap) is split from `stat` (expensive). One set of rules for        │
 * │ the walk — depth, skipping hidden directories, the scan ceiling — lives in           │
 * │ exactly one place, with no second copy to forget a condition in.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function walk(root: string, rel: string, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH || out.length >= MAX_SCAN) return;
  const dir = rel ? path.join(root, rel) : root;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // no artifacts/ directory yet — the office hasn't run any task
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(root, childRel, depth + 1, out);
      continue;
    }
    if (!entry.isFile() || out.length >= MAX_SCAN) continue;
    out.push(childRel);
  }
}

/** `stat`s exactly one file, attaching it to what can be inferred from the path itself. */
function record(root: string, childRel: string): ArtifactRecord | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(path.join(root, childRel));
  } catch {
    return undefined; // disappeared between readdir and stat
  }
  const parts = childRel.split('/');
  const name = parts[parts.length - 1] ?? childRel;
  const ext = path.extname(name).slice(1).toLowerCase();
  return {
    path: `artifacts/${childRel}`,
    name,
    ext,
    bytes: stat.size,
    mtime: stat.mtime.toISOString(),
    // `artifacts/<plan_id>/<task_id>/x.md` since 19/08. Old files sit at
    // `artifacts/<task_id>/x.md` — still listable, just with no known plan.
    plan_id: parts.length >= 3 ? (parts[0] ?? '') : '',
    task_id: parts.length >= 3 ? (parts[1] ?? '') : (parts[0] ?? ''),
    view: viewOf(ext),
  };
}
