/**
 * Keep the `│ … │` borders of the ASCII comment boxes aligned across a rewrite.
 *
 * → docs/CLAUDE.md §Comment boxes
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY A TOOL AND NOT CAREFUL EDITING.                                      │
 * │                                                                          │
 * │ There are 337 of these boxes across 42 of the 49 files in `src/`, plus   │
 * │ 59 more in `test/`, and every right-hand border is padded BY HAND. The   │
 * │ English rewrite changes the width of nearly every line inside them.      │
 * │                                                                          │
 * │ Doing it by eye fails quietly, because DISPLAY WIDTH is not              │
 * │ `string.length`: a combining mark adds a code unit and no column, an     │
 * │ emoji adds two code units and two columns. Counting characters is wrong  │
 * │ in both directions at once, so the errors do not even look systematic.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 AND WHY IT MATCHES THE BASELINE, NOT THE TOP BORDER. (measured, and   │
 * │ the first design was wrong)                                              │
 * │                                                                          │
 * │ The obvious target is the box's own top border. Measured against 154     │
 * │ real boxes: 1023 of 2495 body lines already disagree with their border,  │
 * │ and 645 still disagree with their block's own dominant width. Checking   │
 * │ whether some character is silently double-width explains none of it —    │
 * │ the deviation tracks line LENGTH, not any character.                     │
 * │                                                                          │
 * │ So the boxes are simply ragged by ±1 from years of padding by eye. There │
 * │ is no hidden rule to recover. Normalising to the border would have       │
 * │ rewritten ~40% of every box in the repository, burying the actual        │
 * │ translation diff under noise nobody could review.                        │
 * │                                                                          │
 * │ ⇒ The invariant is narrower and provable: A LINE I EDITED KEEPS THE      │
 * │   WIDTH IT HAD. Untouched raggedness stays untouched. That is checkable  │
 * │   against the pre-edit file, and it makes the diff exactly the change.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Usage:
 *   # after editing, restore the widths of the lines you changed
 *   node --experimental-strip-types scripts/fix-comment-boxes.ts --against <baseline> <file>
 *
 *   # advisory only: which body lines sit off their block's dominant width
 *   node --experimental-strip-types scripts/fix-comment-boxes.ts --check <file…>
 *
 * A baseline is the file as it was before the edit — `git show HEAD:<path> > /tmp/x`
 * or a copy taken first. Reflow is handled: if a block's body line count changed,
 * that block falls back to its baseline dominant width, and the tool says so.
 */

import fs from 'node:fs';

/** Columns a string occupies in a monospaced editor. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // Astral plane: emoji and the like render two columns wide.
    if (code > 0xffff) {
      width += 2;
      continue;
    }
    // Combining marks and variation selectors hang off the previous glyph.
    if ((code >= 0x0300 && code <= 0x036f) || (code >= 0xfe00 && code <= 0xfe0f)) continue;
    width += 1;
  }
  return width;
}

const TOP = /[┌╔][─═]*[┐╗]\s*$/; // i18n-allow-vietnamese: box-drawing, not text
const BOTTOM = /[└╚][─═]*[┘╝]\s*$/; // i18n-allow-vietnamese: box-drawing, not text
const BODY = /[│║]\s*$/; // i18n-allow-vietnamese: box-drawing, not text

interface Block {
  /** Indices into the line array, in order, of this block's body lines. */
  body: number[];
}

function blocksOf(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let open: Block | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (TOP.test(line)) {
      open = { body: [] };
      blocks.push(open);
      continue;
    }
    if (BOTTOM.test(line)) {
      open = null;
      continue;
    }
    if (open && BODY.test(line)) open.body.push(i);
  }
  return blocks;
}

/** The width most body lines in a block share — what the eye reads as the right edge. */
function dominantWidth(widths: readonly number[]): number | null {
  if (widths.length === 0) return null;
  const counts = new Map<number, number>();
  for (const w of widths) counts.set(w, (counts.get(w) ?? 0) + 1);
  let best = widths[0]!;
  let bestCount = -1;
  for (const [width, count] of counts) {
    // Ties go to the wider value: padding out is always possible, trimming is not.
    if (count > bestCount || (count === bestCount && width > best)) {
      best = width;
      bestCount = count;
    }
  }
  return best;
}

export interface BoxIssue {
  line: number;
  width: number;
  want: number;
  fixed: boolean;
  reflowed: boolean;
  text: string;
}

/** Pad or trim trailing spaces so `line` occupies `want` columns. `null` if impossible. */
function repad(line: string, want: number): string | null {
  const width = displayWidth(line);
  if (width === want) return line;
  if (width < want) return line.replace(/([│║])\s*$/, `${' '.repeat(want - width)}$1`); // i18n-allow-vietnamese
  const over = width - want;
  const room = new RegExp(`^(.*?)( {${over},})([│║])\\s*$`).exec(line); // i18n-allow-vietnamese
  if (!room) return null;
  return room[1]! + ' '.repeat(room[2]!.length - over) + room[3]!;
}

/**
 * Restore the widths of the box lines that changed since `baseline`.
 *
 * ⚠ A line too wide to fit is REPORTED, never trimmed. Trimming would silently
 * delete a word from a comment whose whole job is recording why a decision was
 * made — far worse than a border one column out. Shorten the sentence and rerun.
 */
export function alignAgainst(source: string, baseline: string): { text: string; issues: BoxIssue[] } {
  const lines = source.split(/\r?\n/);
  const base = baseline.split(/\r?\n/);
  const issues: BoxIssue[] = [];

  const nowBlocks = blocksOf(lines);
  const baseBlocks = blocksOf(base);

  for (let b = 0; b < nowBlocks.length; b++) {
    const now = nowBlocks[b]!;
    const was = baseBlocks[b];
    if (!was) continue; // a brand-new box: nothing to preserve, leave it alone

    const baseWidths = was.body.map((i) => displayWidth(base[i]!));
    const aligned = now.body.length === was.body.length;
    const fallback = dominantWidth(baseWidths);

    for (let k = 0; k < now.body.length; k++) {
      const index = now.body[k]!;
      const line = lines[index]!;
      const want = aligned ? displayWidth(base[was.body[k]!]!) : fallback;
      if (want === null) continue;

      // Untouched line ⇒ leave it, ragged or not. Its width is not ours to change.
      if (aligned && line === base[was.body[k]!]) continue;

      const width = displayWidth(line);
      if (width === want) continue;

      const fixed = repad(line, want);
      if (fixed === null) {
        issues.push({ line: index + 1, width, want, fixed: false, reflowed: !aligned, text: line.trim().slice(0, 90) });
        continue;
      }
      lines[index] = fixed;
      issues.push({ line: index + 1, width, want, fixed: true, reflowed: !aligned, text: fixed.trim().slice(0, 90) });
    }
  }

  return { text: lines.join(source.includes('\r\n') ? '\r\n' : '\n'), issues };
}

/** Advisory: body lines sitting off their block's dominant width. Never writes. */
export function checkOnly(source: string): BoxIssue[] {
  const lines = source.split(/\r?\n/);
  const issues: BoxIssue[] = [];
  for (const block of blocksOf(lines)) {
    const widths = block.body.map((i) => displayWidth(lines[i]!));
    const want = dominantWidth(widths);
    if (want === null) continue;
    block.body.forEach((index, k) => {
      const width = widths[k]!;
      if (width === want) return;
      issues.push({ line: index + 1, width, want, fixed: false, reflowed: false, text: lines[index]!.trim().slice(0, 90) });
    });
  }
  return issues;
}

// ─────────────────────────────────────────────────────────────────────── cli

function read(file: string): { text: string; bom: boolean } {
  const raw = fs.readFileSync(file);
  const bom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  return { text: raw.toString('utf8').slice(bom ? 1 : 0), bom };
}

const argv = process.argv.slice(2);
const againstAt = argv.indexOf('--against');
const baselinePath = againstAt >= 0 ? argv[againstAt + 1] : undefined;
const files = argv.filter((a, i) => a !== '--against' && a !== '--check' && i !== againstAt + 1);

if (files.length === 0 || (againstAt >= 0 && !baselinePath)) {
  console.error('usage: fix-comment-boxes.ts --against <baseline> <file>');
  console.error('       fix-comment-boxes.ts --check <file…>');
  process.exit(2);
}

if (againstAt >= 0) {
  if (files.length !== 1) {
    console.error('--against takes exactly one file (the baseline is that file before your edit)');
    process.exit(2);
  }
  const target = files[0]!;
  const current = read(target);
  const { text, issues } = alignAgainst(current.text, read(baselinePath!).text);

  const stuck = issues.filter((i) => !i.fixed);
  const reflowed = issues.filter((i) => i.reflowed).length;
  for (const issue of stuck) {
    console.error(`  TOO WIDE  ${target}:${issue.line}  ${issue.width} > ${issue.want}  ${issue.text}`);
  }
  if (text !== current.text) fs.writeFileSync(target, (current.bom ? '﻿' : '') + text, 'utf8');

  console.log(
    `boxes: ${issues.length - stuck.length} line(s) re-padded to their pre-edit width` +
      (reflowed ? ` · ${reflowed} in reflowed blocks, matched to the block width instead` : '') +
      (stuck.length ? ` · ${stuck.length} too wide to fit — shorten the text, they were NOT trimmed` : ''),
  );
  process.exit(stuck.length > 0 ? 1 : 0);
}

let ragged = 0;
for (const file of files) {
  for (const issue of checkOnly(read(file).text)) {
    ragged++;
    console.log(`  ${file}:${issue.line}  ${issue.width} ≠ ${issue.want}  ${issue.text}`);
  }
}
console.log(`boxes: ${ragged} body line(s) off their block's dominant width (advisory — nothing written)`);
