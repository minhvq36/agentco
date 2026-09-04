/**
 * ONE-TIME TOOL — P4 decision: comments in test/ and scripts/ carry no product
 * meaning (the narrative lives in agentco-notes/SESSIONS_MEMORY.md instead), so
 * instead of translating thousands of lines of Vietnamese comment prose, delete
 * them wholesale and translate only what the language gate still sees afterward:
 * test titles, assert messages, and any other string literal.
 *
 * A comment carrying the i18n-allow-vietnamese pragma is left untouched — it
 * marks a fixture line the gate must keep exempting.
 *
 * Uses the real TypeScript parser (not a regex) so `//` inside a string, a
 * template literal, or a regex literal is never mistaken for a comment.
 *
 * Run: node --experimental-strip-types scripts/strip-comments.ts <dir-or-file...>
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const SELF = path.resolve(import.meta.filename);

/** Already-migrated, deliberately-documented infrastructure — not narrative debt. */
const EXCLUDE = new Set(
  ['scripts/check-language.ts', 'scripts/fix-comment-boxes.ts', 'scripts/strip-comments.ts'].map((f) =>
    path.resolve(ROOT, f),
  ),
);

function listFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
}

/**
 * Every comment stripped (pragma-marked ones included) and remaining whitespace
 * collapsed. Built off the real parser's comment ranges, not a standalone
 * scanner — a standalone scanner cannot resolve regex-vs-division ambiguity
 * the way a parser does, so it would garble itself on any file with a regex
 * literal and produce false mismatches.
 */
function codeOnly(source: string): string {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  const found = new Map<string, { pos: number; end: number }>();
  function collect(node: ts.Node): void {
    for (const r of [
      ...(ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(source, node.getEnd()) ?? []),
    ]) {
      found.set(`${r.pos}-${r.end}`, r);
    }
  }
  function visit(node: ts.Node): void {
    collect(node);
    node.forEachChild(visit);
  }
  visit(sf);
  collect(sf.endOfFileToken);
  const sorted = [...found.values()].sort((a, b) => b.pos - a.pos);
  let s = source;
  for (const r of sorted) s = s.slice(0, r.pos) + s.slice(r.end);
  return s.replace(/\s+/g, ' ').trim();
}

function stripFile(file: string): boolean {
  const text = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const ranges = new Map<string, { pos: number; end: number }>();

  function collect(node: ts.Node): void {
    const leading = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
    const trailing = ts.getTrailingCommentRanges(text, node.getEnd()) ?? [];
    for (const r of [...leading, ...trailing]) {
      const comment = text.slice(r.pos, r.end);
      if (comment.includes('i18n-allow-vietnamese')) continue;
      ranges.set(`${r.pos}-${r.end}`, { pos: r.pos, end: r.end });
    }
  }

  function visit(node: ts.Node): void {
    collect(node);
    node.forEachChild(visit);
  }
  visit(sourceFile);
  collect(sourceFile.endOfFileToken);

  if (ranges.size === 0) return false;

  // Remove each comment surgically, touching only its own line — never the
  // rest of the file — so a trailing space that is meaningful inside some
  // unrelated multi-line string literal elsewhere is never at risk.
  const sorted = [...ranges.values()].sort((a, b) => b.pos - a.pos);
  let out = text;
  for (const r of sorted) {
    let delStart = r.pos;
    let delEnd = r.end;
    const lineStart = out.lastIndexOf('\n', delStart - 1) + 1;
    const beforeOnLine = out.slice(lineStart, delStart);
    const wholeLineIsComment = /^[ \t]*$/.test(beforeOnLine);

    let afterEnd = delEnd;
    while (afterEnd < out.length && (out[afterEnd] === ' ' || out[afterEnd] === '\t')) afterEnd++;
    const nextIsNewline = out[afterEnd] === '\n' || (out[afterEnd] === '\r' && out[afterEnd + 1] === '\n');
    const isEndOfLine = afterEnd >= out.length || nextIsNewline;

    if (wholeLineIsComment && isEndOfLine) {
      delStart = lineStart;
      delEnd = afterEnd;
      if (out[delEnd] === '\r' && out[delEnd + 1] === '\n') delEnd += 2;
      else if (out[delEnd] === '\n') delEnd += 1;
    } else {
      let p = delStart;
      while (p > lineStart && (out[p - 1] === ' ' || out[p - 1] === '\t')) p--;
      delStart = p;
      delEnd = afterEnd;
    }
    out = out.slice(0, delStart) + out.slice(delEnd);
  }

  const before = codeOnly(text);
  const after = codeOnly(out);
  if (before !== after) {
    console.error(`SKIPPED (code content mismatch — refusing to risk eating code): ${file}`);
    let i = 0;
    while (i < before.length && i < after.length && before[i] === after[i]) i++;
    console.error(`  first diff near: ...${before.slice(Math.max(0, i - 40), i + 40)}...`);
    console.error(`                vs ...${after.slice(Math.max(0, i - 40), i + 40)}...`);
    return false;
  }

  fs.writeFileSync(file, out, 'utf8');
  return true;
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('usage: node --experimental-strip-types scripts/strip-comments.ts <dir-or-file...>');
  process.exit(1);
}

let changed = 0;
for (const t of targets) {
  const abs = path.isAbsolute(t) ? t : path.join(ROOT, t);
  const files: string[] = [];
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) listFiles(abs, files);
  else files.push(abs);
  for (const f of files) {
    const resolved = path.resolve(f);
    if (resolved === SELF || EXCLUDE.has(resolved)) continue;
    if (stripFile(f)) changed++;
  }
}
console.log(`strip-comments: rewrote ${changed} file(s)`);
