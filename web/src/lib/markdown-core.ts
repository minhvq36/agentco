/**
 * Minimal markdown — THE PURE HALF. No React, no DOM, no dependencies.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY IT IS SPLIT FROM `markdown.tsx`: SO IT CAN BE TESTED.                │
 * │                                                                          │
 * │ This is the only piece of the interface with real PARSING LOGIC, and the │
 * │ piece the user named outright as "the one that keeps breaking, nested    │
 * │ backticks especially". Something both easy to get wrong and quiet about  │
 * │ being wrong needs tests — and tests cannot be written while the logic is │
 * │ stirred into a JSX file.                                                 │
 * │                                                                          │
 * │ The rendering half (`markdown.tsx`) is the opposite: it maps block → tag │
 * │ with no branch worth getting wrong, and looking at it is enough.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * → `test/markdown.test.ts` · `web/src/lib/markdown.tsx`
 */

/** Column alignment, read from the delimiter row: `:---` `:--:` `---:`. */
export type Align = 'left' | 'center' | 'right';

export type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'table'; head: string[]; rows: string[][]; align: Align[] }
  /**
   * A task list — `- [ ]` / `- [x]`. → SPEC-ui.md
   *
   * It gets its OWN kind rather than being folded into `text`, because this is
   * exactly what exercise 6 produces ("fold it into a short checklist"), and
   * printing it back as literal `- [ ] …` hands the user characters instead of a
   * list they can read at a glance.
   *
   * `done` is OBSERVED from the text in the file, not state we hold: the box is
   * not clickable, and that is deliberate — the artifact is what the employee
   * wrote, and the Results panel is a READING window. Making it clickable opens a
   * second write path onto the same file, and sooner or later it disagrees with
   * what the agent just wrote.
   */
  | { kind: 'tasks'; items: { done: boolean; text: string }[] }
  | { kind: 'text'; text: string };

/** One inline piece: a code span, or ordinary text. */
export type Token = { code: boolean; text: string };

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
/**
 * `- [ ] task` · `* [x] task` · `+ [X] task`, at any indent.
 *
 * ⚠ The space after `]` is REQUIRED. Without it `- [x]abc` matches too, and in
 * technical prose that string is a reference, not a task.
 *
 * ⚠ And the content must START WITH A REAL CHARACTER (`\S`), not `.+` — `.`
 * matches whitespace, so `- [ ]` with a few trailing spaces would pass and yield
 * an EMPTY task. A test caught that on the first run, and it is a real case: a
 * model breaking the line right after `]` is ordinary.
 */
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(\S.*)$/;

/**
 * A table's delimiter row: `|---|:--:|---:|`. This is what DEFINES a table.
 *
 * A line merely containing `|` is not a table — people write "a | b" in a
 * sentence all the time. Only when the line IMMEDIATELY AFTER is a valid
 * delimiter row does the block become a table, exactly as GFM says.
 */
const DELIM_CELL = /^:?-{1,}:?$/;

/** Column ceiling. A table wider than this is almost certainly misread prose. */
const MAX_COLS = 24;
/** Row ceiling for one table. Past it, truncate — a chat bubble is not a spreadsheet. */
const MAX_ROWS = 500;

/**
 * Split one table row into cells.
 *
 * Drops exactly ONE `|` at each end (both `| a | b |` and `a | b` are legal GFM),
 * and honours `\|` — an escaped pipe is CONTENT, not a wall. Without that escape
 * rule a cell holding `a\|b` splits itself in two and the whole row falls out of
 * step with the header — which means the entire table is thrown away at the
 * column check.
 */
function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  // Drop the trailing `|`, but NOT if it was escaped (`\|`).
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);

  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (ch === '|') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Is this line a delimiter row with EXACTLY `cols` columns?
 *
 * ⚠ IT DEMANDS A `|` IN THE DELIMITER ROW ITSELF, and that is not redundant.
 * Without the rule, these two harmless lines become a one-column table:
 *
 *   pick coffee | bubble tea
 *   ---
 *
 * A bare `---` is a horizontal rule or a setext heading — two things this parser
 * DELIBERATELY does not support, so today they render verbatim and must go on
 * doing so. The rule is free: any table of two columns or more already has a `|`
 * in its delimiter row.
 */
function delimAlign(line: string, cols: number): Align[] | undefined {
  if (!line.includes('-') || !line.includes('|')) return undefined;
  const cells = splitCells(line);
  if (cells.length !== cols) return undefined;
  if (!cells.every((c) => DELIM_CELL.test(c))) return undefined;
  return cells.map((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    return l && r ? 'center' : r ? 'right' : 'left';
  });
}

/**
 * THE BLOCK PASS — scans LINE BY LINE.
 *
 * Fences must be fully resolved BEFORE any inline rule runs. That ordering is the
 * whole problem: do it the other way round and a `**` inside a code block gets
 * bolded, which is exactly the failure class that "chain a few .replace() calls"
 * implementations always walk into.
 *
 * ⚠ DELIBERATELY no 4-space-indented code blocks, and no lists. `helpText()`
 * indents its command descriptions by exactly 4 spaces; the plan-step strip uses
 * `  1. `. Turning those two rules on converts sentences the backend assembles
 * into grey code blocks and renumbered lists — breaking exactly what works today.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TABLES: "THE WHOLE TABLE OR NOTHING" (20/08).                             │
 * │                                                                           │
 * │ Recognising a table demands THREE conditions; miss one and it falls       │
 * │ straight back to `text` and renders verbatim, exactly as it did before    │
 * │ this rule existed:                                                        │
 * │                                                                           │
 * │   1. the current line contains `|`                                        │
 * │   2. the line IMMEDIATELY AFTER is a delimiter row (`|---|:--:|`)         │
 * │   3. the two lines' column counts MATCH                                   │
 * │                                                                           │
 * │ Why so strict: a table drawn with columns out of step, a missing cell, or │
 * │ a swallowed last row is a FALSE ASSERTION about data — a reader trusts a  │
 * │ table far more than a pile of `|` characters. Verbatim is ugly but does   │
 * │ not lie, and the user sees at once that "this bit didn't render".         │
 * │                                                                           │
 * │ BODY rows are the opposite — they are forgiving: GFM allows a short row   │
 * │ (pad with empties) and a long one (truncate). The strict constraint       │
 * │ belongs at the DECISION "is this a table"; once that is settled, one      │
 * │ ragged row is not worth throwing the whole table away.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function blocksOf(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let text: string[] = [];

  const flush = (): void => {
    // A block that is ONLY whitespace is dropped here, not passed down for the
    // renderer to deal with.
    //
    // `''.split('\n')` yields `['']` — so empty text still produces a block. The
    // renderer does filter it today, but requiring EVERY caller to remember that
    // is how, one day, someone forgets and an empty chat bubble appears that
    // nobody can explain.
    const joined = text.join('\n');
    if (joined.trim()) out.push({ kind: 'text', text: joined });
    text = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);

    if (fence) {
      flush();
      const marker = fence[2]!;
      const body: string[] = [];
      i++;
      // An UNCLOSED fence swallows the rest of the text — CommonMark's behaviour,
      // and the right one here: a model cut off mid-answer, or one that leaves a
      // fence open, would otherwise have its whole tail rendered as prose.
      for (; i < lines.length; i++) {
        const close = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[i]!);
        if (close && close[1]!.length >= marker.length && close[1]![0] === marker[0]) break;
        body.push(lines[i]!);
      }
      out.push({ kind: 'code', lang: (fence[3] ?? '').toLowerCase(), text: body.join('\n') });
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      flush();
      out.push({ kind: 'heading', level: h[1]!.length, text: h[2]!.trim() });
      continue;
    }

    // TABLE — checked before the line joins the text buffer, but only when all
    // three conditions hold. If they do not, the `continue` never runs and the
    // line falls through to `text.push` exactly as before.
    if (line.includes('|')) {
      const head = splitCells(line);
      // A ONE-COLUMN table is legal and real (a list with a heading). The guard
      // against false positives lives in `delimAlign`, not in the column count.
      const align =
        head.length <= MAX_COLS ? delimAlign(lines[i + 1] ?? '', head.length) : undefined;
      if (align) {
        flush();
        const rows: string[][] = [];
        let j = i + 2;
        // Consume up to the first line WITHOUT a `|`. A blank line stops it too —
        // that is a paragraph boundary, and a table spanning one is two tables.
        for (; j < lines.length && rows.length < MAX_ROWS; j++) {
          const row = lines[j]!;
          if (!row.includes('|') || !row.trim()) break;
          const cells = splitCells(row);
          // Pad or truncate to the header's column count — see the box above.
          while (cells.length < head.length) cells.push('');
          rows.push(cells.slice(0, head.length));
        }
        out.push({ kind: 'table', head, rows, align });
        i = j - 1;
        continue;
      }
    }

    /**
     * TASK LIST — gather ADJACENT `- [ ]` / `- [x]` lines into one block.
     *
     * Checked AFTER tables and AFTER headings: a `- [x]` line contains no `|` and
     * does not start with `#`, so nothing here actually competes — but it stays
     * last so every "stronger" structure is considered first.
     *
     * Stops at the first line that is NOT a task, blank lines included: a list
     * spanning a blank line is two lists — the same rule as tables.
     */
    const firstTask = TASK.exec(line);
    if (firstTask) {
      flush();
      const items: { done: boolean; text: string }[] = [];
      let j = i;
      for (; j < lines.length && items.length < MAX_ROWS; j++) {
        const m = TASK.exec(lines[j]!);
        if (!m) break;
        items.push({ done: m[1]!.toLowerCase() === 'x', text: m[2]!.trim() });
      }
      out.push({ kind: 'tasks', items });
      i = j - 1;
      continue;
    }

    text.push(line);
  }

  flush();
  return out;
}

/**
 * Does this message contain a table that will actually render?
 *
 * The chat panel uses it to pick the bubble width: a table is the ONLY thing in
 * markdown whose width carries information, so a message with one gets the full
 * panel while an ordinary message stays at 92% (a full-width bubble for "Done."
 * looks wrong).
 *
 * It goes through `blocksOf` ITSELF, not a separate regex: two parallel
 * detections drift apart sooner or later — a bubble widened for a "table" the
 * renderer then decides to print verbatim. Re-parsing one chat message costs tens
 * of microseconds, far less than a class of bug.
 */
export function hasTable(src: string): boolean {
  return blocksOf(src).some((b) => b.kind === 'table');
}

/**
 * INLINE PASS 1 — lift code spans out of the text. Runs BEFORE bold.
 *
 * The CommonMark rule: a run of **N** backticks opens, and only a run of
 * **exactly N** closes it — a longer run does NOT count as a close. That single
 * rule makes the "nested" case work with no special handling at all:
 *
 *   `` `a` ``   → two backticks open, the inner `a` is TEXT, two backticks close
 *
 * ⚠ A run with no matching close prints VERBATIM and the scan carries on. This is
 * the most common failure in other hand-written versions: they treat a lone
 * backtick as an opener and swallow the whole remainder into a code block — the
 * user sees "the formatting goes wrong from there on".
 */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let buf = '';
  let i = 0;

  const flush = (): void => {
    if (buf) out.push({ code: false, text: buf });
    buf = '';
  };

  while (i < src.length) {
    if (src[i] !== '`') {
      buf += src[i];
      i++;
      continue;
    }

    let n = 0;
    while (src[i + n] === '`') n++;

    // Find a closing run of EXACTLY length n.
    let j = i + n;
    let close = -1;
    while (j < src.length) {
      if (src[j] !== '`') {
        j++;
        continue;
      }
      let m = 0;
      while (src[j + m] === '`') m++;
      if (m === n) {
        close = j;
        break;
      }
      j += m;
    }

    if (close === -1) {
      buf += '`'.repeat(n);
      i += n;
      continue;
    }

    flush();
    // CommonMark strips exactly ONE space at each end — that is how a bare
    // backtick (`` ` ``) is written without being read as an opener.
    let inner = src.slice(i + n, close);
    if (inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ')) inner = inner.slice(1, -1);
    out.push({ code: true, text: inner });
    i = close + n;
  }

  flush();
  return out;
}

/** A piece with `**` already resolved — see below: `bold` says whether it wears a `<strong>`. */
export interface Span {
  code: boolean;
  bold: boolean;
  text: string;
  /**
   * 🔴 PRESENT ⇒ THIS SPAN IS A LINK and `text` is the label the author wrote.
   * `http:`/`https:` only — see `SAFE_URL`.
   *
   * ⚠ The label and the destination are TWO DIFFERENT STRINGS, and the author
   * of both is usually the model. `[your invoice](https://evil.example)` is a
   * legal markdown link, so the renderer must put the real destination where a
   * person can see it before clicking. → `markdown.tsx §Inline`
   */
  href?: string;
}

/**
 * `[label](url)` — the ONE inline rule with an outside destination.
 *
 * ⚠ NO NESTED PARENTHESES AND NO SPACES IN THE URL, deliberately. A balanced
 * `(` scanner is a parser; this is a rule in a file whose whole argument is
 * *"the smallest surface breaks least"*. A Wikipedia-style `..._(disambiguation)`
 * link falls back to printing verbatim, which is what it does today anyway.
 */
const LINK = /\[([^\]\n]+)\]\(([^()\s]+)\)/g;

/**
 * 🔴 THE SCHEME ALLOWLIST — the only reason this rule is safe to add.
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ `javascript:alert(1)` IS A VALID URL IN A MARKDOWN LINK, and the text
 * │ here is MODEL-GENERATED — the same premise that made this file refuse
 * │ `dangerouslySetInnerHTML`. React strips `javascript:` hrefs today, with a
 * │ warning, but that is a library's courtesy and not our mechanism: the day
 * │ it changes, or the day this parse feeds anything other than React, the
 * │ hole is ours. So the gate is an ALLOWLIST, not a blocklist — `data:`,
 * │ `file:`, `vbscript:` and every scheme nobody has thought of yet are out
 * │ by construction rather than by enumeration.
 * │
 * │ ⚠ REFUSED MEANS PRINTED VERBATIM, never dropped. `[a](file:///etc)` still
 * │ shows every character the author wrote — a link the interface will not
 * │ open must not become a link the reader cannot see either.
 * └──────────────────────────────────────────────────────────────────────────
 */
const SAFE_URL = /^https?:\/\/[^\s]+$/i;

/**
 * Splits one span into text and link pieces. Runs AFTER `**`, so a bold link
 * keeps its bold and a link inside a code span is never touched at all.
 *
 * ⚠ A link that straddles a `**` boundary (`[a **b](url)`) is NOT joined back
 * together: bold has already cut the text there. It prints verbatim, which is
 * the same thing that happens to every other half-formed inline mark here.
 */
function withLinks(s: Span): Span[] {
  if (s.code || !s.text.includes('](')) return [s];
  const out: Span[] = [];
  let last = 0;
  for (const m of s.text.matchAll(LINK)) {
    const [whole, label, url] = m;
    // ⚠ `continue` WITHOUT moving `last`: the refused link stays inside the
    // plain-text run and comes out verbatim on the next push.
    if (!url || !label || !SAFE_URL.test(url)) continue;
    const at = m.index ?? 0;
    if (at > last) out.push({ code: false, bold: s.bold, text: s.text.slice(last, at) });
    out.push({ code: false, bold: s.bold, text: label, href: url });
    last = at + whole.length;
  }
  if (!out.length) return [s];
  if (last < s.text.length) out.push({ code: false, bold: s.bold, text: s.text.slice(last) });
  return out;
}

/**
 * INLINE PASS 2 — match `**` OVER THE TOKEN LIST, not over the characters.
 *
 * Running on tokens is what makes both cases right at once:
 *
 *   **see `warranty.md` please**  → bold wraps the code span inside it       ✅
 *   `a ** b`                      → the `**` is inside code and never gets   ✅
 *                                    here
 *
 * A lone `**` prints verbatim: someone typing "2**3", or an answer cut off
 * mid-sentence, must not wreck the rest of the message.
 *
 * Returns a flat list so the renderer only has to map 1-to-1 onto tags — every
 * decision is settled here, where it can be tested.
 */
export function spansOf(src: string): Span[] {
  const tokens = tokenize(src);
  const out: Span[] = [];
  const push = (code: boolean, bold: boolean, text: string): void => {
    if (text) out.push({ code, bold, text });
  };

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t]!;
    if (tok.code) {
      push(true, false, tok.text);
      continue;
    }

    let rest = tok.text;
    let guard = 0;
    while (guard++ < 500) {
      const open = rest.indexOf('**');
      if (open === -1) break;

      // The closer is in the SAME token — by far the common case.
      const same = rest.indexOf('**', open + 2);
      if (same !== -1) {
        push(false, false, rest.slice(0, open));
        push(false, true, rest.slice(open + 2, same));
        rest = rest.slice(same + 2);
        continue;
      }

      // Not here — look in a later TEXT token, wrapping every code span in
      // between. This is the `**see `x.md` please**` case.
      let end = -1;
      for (let u = t + 1; u < tokens.length; u++) {
        const nxt = tokens[u]!;
        if (!nxt.code && nxt.text.includes('**')) {
          end = u;
          break;
        }
      }
      if (end === -1) break; // lone `**` → left verbatim by the branch below

      push(false, false, rest.slice(0, open));
      push(false, true, rest.slice(open + 2));
      for (let u = t + 1; u < end; u++) {
        const mid = tokens[u]!;
        push(mid.code, true, mid.text);
      }
      const tail = tokens[end]!.text;
      const cut = tail.indexOf('**');
      push(false, true, tail.slice(0, cut));
      rest = tail.slice(cut + 2);
      t = end;
    }

    push(false, false, rest);
  }

  /**
   * ⚠ INLINE PASS 3 IS FOLDED IN HERE, not offered as a second export. The
   * contract this function already carries is *"returns a flat list so the
   * renderer only has to map 1-to-1 onto tags — every decision is settled
   * here"*. A second pass the caller has to remember to run is a decision that
   * escaped, and the first caller to forget it silently loses every link.
   */
  return out.flatMap(withLinks);
}
