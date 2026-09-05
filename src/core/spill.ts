/**
 * A RESULT TOO BIG — MOVED INTO THE OFFICE INSTEAD OF FORCING THE MODEL TO SWALLOW IT.
 * → docs/SPEC-arms.md §9e · `scripts/spike-spill.ts`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠⚠ THIS FILE TRUNCATES NOTHING, AND THAT'S THE WHOLE POINT OF IT.         │
 * │                                                                           │
 * │ The 27/08 case: `notion-fetch` returned **64,146 characters**. The first  │
 * │ instinct is to build our own ceiling (~16 KB) and move it to a file       │
 * │ ourselves. After measuring, it turned out **Claude Code HAD ALREADY DONE  │
 * │ THAT**: the content never entered context at all — the CLI had already    │
 * │ moved it to `~/.claude/projects/<slug>/<session-uuid>/tool-results/*.txt` │
 * │ and returned a short 1,608-character notice.                              │
 * │                                                                           │
 * │ ⇒ Building a second ceiling would be **two copies of the same rule** —    │
 * │ something this project has already paid for a few times (`agentSlot` vs   │
 * │ `arrange`; `pickMcp` vs `probeArm`). So this file does NOT measure size,  │
 * │ does NOT truncate, does NOT decide whether to move a file or not. It only │
 * │ fixes **FOUR PLACES WHERE THE CLI'S PLACEMENT DOESN'T WORK FOR US**:      │
 * │                                                                           │
 * │   ① outside the office  ⇒ every read gets labeled "outside the office",   │
 * │                            and the model switches to shell (10 wasted     │
 * │                            turns, the 27/08 case)                         │
 * │   ② under session-uuid  ⇒ changes every session, yesterday's pointer      │
 * │                            becomes a dead path                            │
 * │   ③ invisible to the user ⇒ 64 KB lands on the machine while the Results  │
 * │                              panel stays empty                            │
 * │   ④ 🔴 the notice opens with "Error:" ⇒ a SUCCESSFUL turn gets primed as  │
 * │      a FAILURE, and the model reads that word before deciding what to do  │
 * │      next                                                                 │
 * │                                                                           │
 * │ ④ is the cheapest to fix and the most expensive to skip: it isn't a       │
 * │ technical bug, it's one wrong word in one sentence.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ✅ MEASURED 27/08 (`spike-spill.ts`), and all three are preconditions for this file to work:
 *   · `PostToolUse` **fires for MCP tools** — unlike `canUseTool`, which `allowedTools` shadows
 *   · `tool_response` is a **string**, not a `content[]` block
 *   · `updatedToolOutput` **genuinely replaces it** — proven by the model opening
 *     exactly our file, a path it has no way to have guessed
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * The notice the CLI returns once it has already moved the result to a file.
 *
 * ⚠ MATCHED BY THE PHRASE `saved to <path>.txt`, NOT by the word `Error:`.
 * The opening word of the sentence is the thing most likely to change between
 * two CLI versions, and matching on it would build a patch that silently
 * breaks itself at the next upgrade — silently, because "no match" looks
 * identical to "nothing to do".
 */
const NOTICE = /saved to\s+(.+?\.txt)/i;

/**
 * The ceiling when COPYING INTO THE OFFICE. Entirely separate from the
 * context ceiling (which the CLI already enforces).
 *
 * This is the **customer's disk** ceiling, not a billing ceiling: a
 * misbehaving service returning a few GB must not be allowed to fill their
 * drive. 50 MB is the number the user set, and it's ~800× wider than the
 * largest real case seen so far (64 KB) — wide enough to never cut off a
 * normal task, tight enough to have a floor.
 */
export const MAX_SPILL_BYTES = 50 * 1024 * 1024;

export interface SpillPlan {
  /** The file the CLI already moved the result to. */
  from: string;
  /** Where we copy it to, inside the office's `artifacts/`. */
  to: string;
  /** The relative path handed to the model — it works relative to the office's `cwd`. */
  rel: string;
  bytes: number;
}

/**
 * THE FILE NAME — deterministic, human-readable, **no hash**.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE FIRST VERSION PRODUCED THIS, and the user caught it immediately:  │
 * │                                                                          │
 * │   a46a7e26403__notion-fetch--mcp-a46a7e26403-notion-fetch-1787778426161  │
 * │                                                                          │
 * │ Three mistakes in one name:                                              │
 * │  ① **A HASH LEAKING ONTO THE SCREEN** — and `audit.ts` stated the rule   │
 * │     from the start: *"a hash never reaches the screen, the interface     │
 * │     looks up the label"*. A file name inside the Results panel **IS**    │
 * │     the screen. A hash is an ADDRESS, not a NAME — exactly the rule      │
 * │     *"the name is the house, the hash is the street address"*.           │
 * │  ② the same thing repeated twice, since the CLI's own name already       │
 * │     carries the tool name                                                │
 * │  ③ an epoch-style timestamp — readable by a machine, not by a person     │
 * │                                                                          │
 * │ ⚠ And the question *"is it just a temp file, so who cares"* has the      │
 * │ answer **NO**: it lives inside `artifacts/`, which the user **sees and   │
 * │ can download**. A temp file belongs in `.state/` — and `.state/` sits    │
 * │ inside `guardedZone`, so a worker can't read it. ⇒ There is no "just a   │
 * │ temp file" path here: it's a result.                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Deduplicated by COUNTING, not by timestamp: within one task's directory,
 * calls run sequentially, so `-2`, `-3` is enough, and it reads as meaningful
 * (*"the second call"*) instead of a 13-digit string that says nothing.
 */
export function spillName(toolName: string, dir: string): string {
  // `mcp__<hash>__<name>` → `<name>`. Strip the ENTIRE hash, not just the `mcp__` prefix.
  const raw = toolName.replace(/^mcp__/, '');
  const cut = raw.indexOf('__');
  const taskName = (cut >= 0 ? raw.slice(cut + 2) : raw).replace(/[^a-zA-Z0-9_-]/g, '-') || 'result';

  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? `${taskName}.txt` : `${taskName}-${i}.txt`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
  // Calling the same tool 1000 times in one task shouldn't happen; if it does,
  // overwriting the last one is better than throwing mid-run.
  return `${taskName}-999.txt`;
}

/**
 * Reads the CLI's notice ⇒ a copy plan. `undefined` = nothing to do.
 *
 * ⚠ Does NOT throw when the file doesn't exist or is too big. This runs in the
 * middle of an active task: a failure here must break **exactly the
 * decoration**, not the whole turn. The caller receives `undefined` and
 * leaves the CLI's own notice as-is — worse, not wrong.
 */
/**
 * @param outDir The results directory **FOR THIS TASK** (`artifacts/<plan>/<task>/`).
 *
 * ⚠ NOT the `artifacts/` root. Every other file in the office lives under
 * `artifacts/<plan_id>/<task_id>/`, and `ArtifactRecord` **derives
 * `plan_id`/`task_id` FROM THE PATH**. Dropping a flat file at the root
 * creates an entry that belongs to no plan and no task — the Results panel
 * shows it orphaned, and it doesn't get cleaned up with the rest of its plan.
 * @param rootDir The `artifacts/` root — used only to compute the relative path for the model.
 */
export function planSpill(
  toolResponse: unknown,
  toolName: string,
  outDir: string,
  rootDir?: string,
): SpillPlan | undefined {
  if (typeof toolResponse !== 'string') return undefined;
  const from = NOTICE.exec(toolResponse)?.[1]?.trim();
  if (!from) return undefined;

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴🔴 VERIFY THE SOURCE — WITHOUT THIS LINE, THIS IS A FILE-EXFILTRATION   │
   * │ HOLE.                                                                     │
   * │                                                                           │
   * │ `toolResponse` is **a string written by a third party**: an MCP server    │
   * │ can return whatever it wants. Without verifying the source, a server      │
   * │ only has to return exactly the sentence                                   │
   * │                                                                           │
   * │     "…saved to D:\…\company\.state\secrets.json…"                         │
   * │                                                                           │
   * │ and we would **copy the key store into `artifacts/` with our own hands**  │
   * │ — a place every worker can read and the user can download. The            │
   * │ `guardedZone` fence blocks an agent from READING `.state/`, and this      │
   * │ patch would carry that content back out on its behalf.                    │
   * │                                                                           │
   * │ Same shape of hole recorded at `catalog.ts §swallowsOffice`: *"lock the   │
   * │ front door properly, leave the back door open"*. And the same class as    │
   * │ the `Musics` case — **trusting a string handed in by a model/vendor and   │
   * │ then using it to open a file**.                                           │
   * │                                                                           │
   * │ Verified by STRUCTURE, three conditions, none of them relying on good     │
   * │ faith:                                                                    │
   * │   ① the path must be **absolute** — a relative one gets resolved by       │
   * │      `statSync` against the daemon's cwd, i.e. it points somewhere        │
   * │      completely different from what we'd expect                           │
   * │   ② the parent directory must be named exactly **`tool-results`** — that's│
   * │      the CLI's own convention, and no customer data directory carries     │
   * │      that name                                                            │
   * │   ③ must be `.txt` — same convention                                      │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  if (!path.isAbsolute(from)) return undefined;
  if (path.basename(path.dirname(from)) !== 'tool-results') return undefined;
  if (path.extname(from).toLowerCase() !== '.txt') return undefined;

  let bytes: number;
  try {
    bytes = fs.statSync(from).size;
  } catch {
    return undefined;
  }
  if (bytes > MAX_SPILL_BYTES) return undefined;

  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch {
    return undefined;
  }
  const name = spillName(toolName, outDir);
  const to = path.join(outDir, name);
  /**
   * The relative path is computed from the OFFICE DIRECTORY, since that's the
   * worker's `cwd` — its `Read`/`Grep` accept paths relative to that root. An
   * absolute path would also work, but it's long, exposes the customer's own
   * directory tree, and doesn't resemble any other line the model has ever
   * seen in this office.
   */
  const root = rootDir ?? outDir;
  const rel = `artifacts/${path.relative(root, to).replace(/\\/g, '/')}`;
  return { from, to, rel, bytes };
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 BEING MOVED ≠ BEING READABLE. A real case, 27/08, caught by the user. │
 * │                                                                          │
 * │ The moved file: **73,530 bytes on EXACTLY ONE LINE.** `Read` slices by   │
 * │ LINE, so `offset`/`limit` cut nothing at all: every read returns the     │
 * │ full 73 KB ⇒ blows the ceiling again ⇒ the CLI moves it to a file again  │
 * │ ⇒ hands back another pointer again ⇒ **repeats until turns run out**     │
 * │ (`error_max_turns`).                                                     │
 * │                                                                          │
 * │ And our own pointer notice told it *"use Read with offset/limit"* — an   │
 * │ instruction that's IMPOSSIBLE TO FOLLOW on a one-line file. We produced  │
 * │ our own wrong-door error message at exactly the point where the model    │
 * │ needs the clearest direction. → §5m                                      │
 * │                                                                          │
 * │ ⇒ Moving the file without adding line breaks only does **half the job**, │
 * │ and the other half is the half the user actually sees.                   │
 * │                                                                          │
 * │ ⚠ THIS IS A READING COPY, NOT THE ORIGINAL — state that rather than hide │
 * │ it. The verbatim original still sits exactly where the CLI put it (we    │
 * │ COPY, we do not MOVE it).                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const LINE_MAX = 2_000;
const WRAP_AT = 800;

/** The longest line — the sole measure deciding whether the file can be read piece by piece. */
function longestLine(s: string): number {
  let max = 0;
  let start = 0;
  for (;;) {
    const i = s.indexOf('\n', start);
    if (i < 0) return Math.max(max, s.length - start);
    max = Math.max(max, i - start);
    start = i + 1;
  }
}

/**
 * JSON → readable text. **No vendor names anywhere in this function.**
 *
 * Why not just `JSON.stringify(v, null, 2)` and be done: it separates the
 * *envelope* but **does not separate the content** — a 60 KB `text` field
 * still sits on one line, because `\n` gets escaped back into `\\n`. And the
 * content is exactly what needs to be readable. `JSON.parse` already turned
 * `\n` into a real line break; our job is to **keep it that way** rather than
 * escape it again.
 */
function renderJson(v: unknown, keyPath: string[] = [], out: string[] = []): string[] {
  if (typeof v === 'string') {
    // A long string = content ⇒ print it raw, keep real line breaks.
    out.push(`── ${keyPath.join('.') || '(content)'} ──`, v, '');
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => renderJson(x, [...keyPath, String(i)], out));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) renderJson(x, [...keyPath, k], out);
  } else {
    out.push(`${keyPath.join('.')}: ${String(v)}`);
  }
  return out;
}

/** Force-wraps lines that are still too long. A last-resort safety net, not the primary path. */
function wrapLong(s: string): string {
  return s
    .split('\n')
    .flatMap((line) => (line.length <= LINE_MAX ? [line] : (line.match(new RegExp(`.{1,${WRAP_AT}}`, 'g')) ?? [line])))
    .join('\n');
}

/**
 * Makes content READABLE PIECE BY PIECE. Returns `changed` so the pointer
 * notice tells the truth.
 *
 * Two steps, and the first covers nearly every real case: JSON gets expanded;
 * non-JSON gets wrapped. Both are deterministic — **no LLM involved here**.
 */
export function readable(raw: string): { text: string; changed: boolean } {
  if (longestLine(raw) <= LINE_MAX) return { text: raw, changed: false };
  try {
    const text = wrapLong(renderJson(JSON.parse(raw)).join('\n'));
    return { text, changed: true };
  } catch {
    return { text: wrapLong(raw), changed: true };
  }
}

/** KB formatted for a person to read, not a machine. */
function kb(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The replacement notice. **Contains no word "Error"**, and states the next step.
 *
 * ⚠ The condition has to sit right on the line with the example, not as a
 * rule stated once at the top of the prompt — a lesson already paid for on
 * 26/08 (`armReach` printing the tier directly on the worker's own line). So
 * this sentence carries both the path AND the names of the two tools that can read it.
 *
 * ⚠⚠ ENGLISH, AND NOT THROUGH `t()`. A worker model reads this, not a person —
 * so it is prompt text, and the interface switch never reaches a prompt.
 * The ban on the word "error" survives the translation and is the sharpest
 * trap in the whole sweep: `test/spill.test.ts` is the code that enforces it.
 */
export function spillNotice(p: SpillPlan): string {
  return (
    `Fetched. The content is ${kb(p.bytes)}, so it was saved into the working directory:\n` +
    `${p.rel}\n` +
    `Read it with Read (using offset/limit) or Grep — the file is already broken into lines so it ` +
    `can be read piece by piece. This did NOT fail: the data came back in full.`
  );
}

/**
 * Actually copies the file. Returns `true` on success.
 *
 * ⚠ Copies, does NOT move: the original file belongs to the CLI, and it may
 * still reference it within the same session. Deleting someone else's file
 * just to tidy up would trade one piece of clutter for a whole class of bugs.
 */
export function doSpill(p: SpillPlan): boolean {
  try {
    fs.mkdirSync(path.dirname(p.to), { recursive: true });
    /**
     * READ → SPLIT INTO LINES → WRITE, rather than `copyFileSync`.
     *
     * The first version copied it verbatim, and for a 73 KB file that's
     * **one line**, that meant moving over something **unreadable piece by
     * piece** — every `Read` blows the ceiling again, gets moved to a file
     * again, repeating until `error_max_turns`. → §readable
     *
     * ⚠ The original is NOT lost: we copy from where the CLI put it and never touch it.
     */
    const { text } = readable(fs.readFileSync(p.from, 'utf8'));
    fs.writeFileSync(p.to, text, 'utf8');
    return true;
  } catch {
    return false;
  }
}
