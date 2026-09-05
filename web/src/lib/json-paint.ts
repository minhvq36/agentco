/**
 * COLOURING + REPRINTING A PASTED JSON BLOCK. → `ArmDialog.tsx §pane 'paste'`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS FILE EXISTS, AND WHY IT IS CHEAP                                │
 * │                                                                          │
 * │ Route B is *"paste the JSON block from the README"*, and today the paste  │
 * │ box is a bare textarea: a slab of 12px black text, no wrapping, no        │
 * │ indentation. Someone who does not code cannot tell **a name** from **a    │
 * │ value** in there, and a missing brace has nothing pointing at it.         │
 * │                                                                          │
 * │ JSON is the smallest thing still worth calling a language: a tokeniser    │
 * │ good enough for it is **one regular expression**. No library, no AST,     │
 * │ running over a few hundred bytes. This is not where performance goes.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * ⚠⚠ COLOUR CANNOT POINT AT THE ERROR — and this is easy to believe wrongly.
 *
 * The user asked: *"if you paste a string that isn't json, does the parse
 * colouring let the customer spot the error straight away?"* — **No.** Colouring
 * is a **per-token guess**; it will happily paint a syntactically broken string,
 * because it knows nothing about structure.
 *
 * The thing that KNOWS where the error is, is `JSON.parse`: it throws with a
 * **position**. So split the roles:
 *   · colour → easier to read (name/value/number/string look different)
 *   · `fault`→ **points at the actual break**, by line/column and a human sentence
 * Leaning on colour to report errors is exactly the *"error at the wrong door"* class.
 */

import { t } from '@i18n';

export interface JsonFault {
  /** Character index, 0-based. `-1` = could not be determined. */
  at: number;
  line: number;
  col: number;
  say: string;
}

/** `null` = it parses. Otherwise: where it broke, said in human words. */
export function fault(text: string): JsonFault | null {
  const s = text.trim();
  if (!s) return null;
  try {
    JSON.parse(s);
    return null;
  } catch (e) {
    const msg = (e as Error).message;
    /**
     * V8 prints the position two ways depending on the version (`at position N`
     * and `at line L column C`). Catch both, and **answer even when there is
     * neither** — `at: -1` tells the caller we cannot point, rather than
     * silently swallowing the case.
     */
    const pos = Number(/position (\d+)/.exec(msg)?.[1] ?? -1);
    const at = Number.isFinite(pos) && pos >= 0 ? Math.min(pos, s.length) : -1;
    const before = at >= 0 ? s.slice(0, at) : '';
    const line = at >= 0 ? before.split('\n').length : 0;
    const col = at >= 0 ? at - before.lastIndexOf('\n') : 0;
    return { at, line, col, say: humanise(msg, s, at) };
  }
}

/**
 * Turn the machine's error into a sentence the user can act on.
 *
 * ⚠ Do not try to translate every message: only the cases **that actually come
 * up when pasting from a README**, and anything uncertain gets a neutral
 * sentence plus a position. Guessing a cause and stating it confidently is worse
 * than saying *"right here"*.
 */
function humanise(msg: string, s: string, at: number): string {
  /**
   * ⚠⚠ THE ORDER HERE IS THE ENTIRE QUALITY OF THIS FUNCTION. (fixed 31/08 after
   * measuring.)
   *
   * The first version read V8's prose first, and was **wrong in 3 of 5 trials**:
   * modern V8 folds a great many different errors into the same sentence,
   * *"Expected property name or '}'"* — a block cut off midway, a trailing
   * comma, and an unquoted field name all come out as that one sentence. The
   * `/property name/` branch swallowed all three.
   *
   * ⇒ Ask the **facts we can count ourselves** first, V8's prose last. Counting
   * braces is ours, deterministic, and does not shift with the Node version.
   */
  const open = count(s, '{') - count(s, '}');
  const brk = count(s, '[') - count(s, ']');

  // ① Not JSON from the very first character — say so; do not talk about braces.
  if (!/^[[{]/.test(s)) return t('jsonHint.notJson');

  // ② Unbalanced braces ⇒ an incomplete paste. Caught WITHOUT V8 saying anything.
  if (open > 0) return t('jsonHint.missingBrace', { n: open });
  if (brk > 0) return t('jsonHint.missingBracket', { n: brk });
  if (open < 0) return t('jsonHint.extraBrace', { n: -open });
  if (brk < 0) return t('jsonHint.extraBracket', { n: -brk });
  if (count(s, '"') % 2 === 1) return t('jsonHint.unclosedQuote');

  // ③ Look straight at the character at the break, and the meaningful one before it.
  const here = at >= 0 ? (s[at] ?? '') : '';
  const before = at >= 0 ? s.slice(0, at).trimEnd().slice(-1) : '';
  if (here === "'" || before === "'") {
    return t('jsonHint.singleQuote');
  }
  if (before === ',' && (here === '}' || here === ']')) {
    return t('jsonHint.trailingComma');
  }

  // ④ Only now V8's prose, and by this point it is no longer ambiguous.
  if (/property name/.test(msg)) return t('jsonHint.propName');
  if (/after property name|Expected ':'/.test(msg)) return t('jsonHint.missingColon');
  if (/Expected ',' /.test(msg)) return t('jsonHint.missingComma');
  return here ? t('jsonHint.badChar', { char: here }) : t('jsonHint.unreadable');
}

const count = (s: string, ch: string): number => s.split(ch).length - 1;

/** Reprint it readably. `null` = not valid yet, so **do not touch their text**. */
export function pretty(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  try {
    const out = JSON.stringify(JSON.parse(s), null, 2);
    return out === text ? null : out;
  } catch {
    // ⚠ A syntactically broken block CANNOT be reprinted — there is no tree to
    // walk. Return `null` so the caller keeps what the user typed VERBATIM.
    // "Fixing" a broken block for them is the surest way to lose their place.
    return null;
  }
}

export type Tok = { t: 'key' | 'str' | 'num' | 'lit' | 'punc' | 'ws'; v: string };

/**
 * Tokenise for colouring. Deliberately does **NOT** check syntax — it has to run
 * on a half-typed string, or the colours flicker on every keystroke.
 *
 * `key` = a string sitting immediately before a `:` — that is the whole trick,
 * and it is correct enough for real JSON, where only a string can be a field name.
 */
export function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],:])|(\s+)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ t: 'punc', v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: 'str', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'num', v: m[2] });
    else if (m[3] !== undefined) out.push({ t: 'lit', v: m[3] });
    else if (m[4] !== undefined) out.push({ t: 'punc', v: m[4] });
    else out.push({ t: 'ws', v: m[5]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'punc', v: text.slice(last) });

  // Second pass: any string standing before a `:` is a FIELD NAME.
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.t !== 'str') continue;
    let j = i + 1;
    while (j < out.length && out[j]!.t === 'ws') j++;
    if (out[j]?.v === ':') out[i]!.t = 'key';
  }
  return out;
}
