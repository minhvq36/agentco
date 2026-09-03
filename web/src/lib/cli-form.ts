/**
 * THE "COMMANDS" TAB — the form ↔ CLI declaration mapping. → docs/SPEC-arms.md §16
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY IT MOVED OUT OF `ArmDialog.tsx` (01/09)                              │
 * │                                                                          │
 * │ The user's call on 31/08: JSON and the form are a **1-to-1 mapping, both │
 * │ ways**. A promise of the "round-trip and it is unchanged" kind is only a │
 * │ promise **until there is a test**, and a test cannot reach into a `.tsx` │
 * │ full of React. It can reach in here: no imports, no JSX, runs directly   │
 * │ under `node --test`.                                                     │
 * │ → test/cli-form.test.ts · [[agentco-detect-fix-pair-scope]]              │
 * │                                                                          │
 * │ ⚠ This file **must not import React or `@/…`** — losing that property    │
 * │ loses the test suite, silently.                                          │
 * │                                                                          │
 * │ ⚠ …and it cannot import `@i18n` AT RUNTIME either. Measured 03/09: node  │
 * │ loads this file as raw `.ts`, so every specifier has to resolve to a     │
 * │ real path on disk — there is no alias, and `src/i18n/index.ts` imports   │
 * │ `./en.js`, which only exists after a build.                              │
 * │                                                                          │
 * │ ⇒ the three functions holding words for a human TAKE `t` AS AN ARGUMENT  │
 * │ instead. `import type` is fine: node erases it before resolving.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { MessageKey } from '@i18n';

/**
 * The `t` of `@i18n`, handed in rather than imported — see the box above.
 *
 * Typed by `MessageKey`, not `string`, so a misspelt key still fails `tsc` at
 * the call site exactly as a direct `t()` would.
 */
export type Translate = (key: MessageKey) => string;

export interface CliDraft {
  say: string;
  description: string;
  /** THE SYNTAX — the general command line; `{slot}` is what the employee fills in. */
  line: string;
  /**
   * ⭐ ONE REAL, RUNNABLE COMMAND. (the user asked for this back on 01/09: *"I
   * meant it as one complete command underneath the syntax"* — and they were
   * right, see `alignExample`.)
   */
  example: string;
  read_only: boolean;
  /**
   * ⚠ **CARRIED THROUGH, NOT RENDERED** (user, 01/09 — see `SPEC-arms §16v`).
   *
   * `fail_when` is a tool for **someone who knows their own CLI**: it turns a
   * string into a declaration of "FAILED" even when the process exits 0. Someone
   * filling in the form does not know that — and my old placeholder (`ERROR,
   * FAILED, Traceback`) invited them to type the three strings **most likely to
   * appear in perfectly healthy output**. ⇒ editable on the JSON tab only.
   */
  fail_when: string;
  /**
   * Parameters declared from the JSON — **carried whole, not fully rendered**.
   *
   * The form only edits `example` (derived from the example line) and adds or
   * removes entries to match the slots. `pattern`/`min`/`max`/`allow_dash`/
   * `integer` are editable on the JSON tab only, but they **have to survive a
   * round-trip through the form** — otherwise clicking "Back to form" silently
   * removes a guard the user put up. → the 1-to-1 rule, the user's call 31/08
   */
  params: Record<string, unknown>[];
}

export const blankAct = (): CliDraft => ({
  say: '',
  description: '',
  line: '',
  example: '',
  read_only: false,
  fail_when: '',
  params: [],
});

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A SAMPLE THAT RUNS IMMEDIATELY — one click, no directory, nothing to     │
 * │ install. (user, 01/09: *"one click should fill it all in and just run"*) │
 * │                                                                          │
 * │ Three constraints it has to pass, all three measured:                    │
 * │  ① `node` is certainly present — the daemon is running on it.            │
 * │  ② NO file needed, NO directory needed: `-e` carries the code with it,   │
 * │     so `cwd` stays empty (falling back to the office directory, which    │
 * │     always exists).                                                      │
 * │  ③ It HAS a `{name}` slot — a sample with no parameter teaches the wrong │
 * │     half of the most important thing, and the "Example" field below it   │
 * │     would have nothing to say.                                           │
 * │                                                                          │
 * │ ⚠ `shell:false` ⇒ the quotes in the Syntax field are `toArgv`'s          │
 * │ convention, NOT shell syntax. The sample deliberately contains quotes so │
 * │ that distinction shows up on the very first try.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
/**
 * A FUNCTION, not a constant: the greeting inside it is translated, and a
 * module-level constant would freeze whichever language the page loaded with.
 * Everything outside the greeting is code and is not translated.
 */
export const hello = (t: Translate): string =>
  `node -e "console.log('${t('cliForm.helloGreeting')}' + process.argv[1])"`;
export const sampleAct = (t: Translate): CliDraft => ({
  say: t('cliForm.helloSay'),
  description: t('cliForm.helloDescription'),
  // The slot NAME is an identifier, so it stays English like `plan_id` and
  // `max_turns` — only the greeting inside the command is translated.
  line: `${hello(t)} {name}`,
  example: `${hello(t)} Alex`,
  read_only: true,
  fail_when: '',
  params: [],
});

/**
 * Is the pasted string a CLI declaration?
 *
 * ⚠ It asks only `type === 'cli'` — **the same question** `core/cli-arm.ts
 * §isCliArm` asks, not a second rule. Recognised by `type`, never inferred from
 * *"there is no `command` and no `url`"*: absence is not a signal, and a block
 * with a typo must not be silently read as CLI and kicked to another tab.
 */
export function isCliPaste(s: string): boolean {
  return safeJson(s)?.['type'] === 'cli';
}

/** `JSON.parse` that does not throw — a broken JSON box dims the button, it does not explode. */
export function safeJson(s: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * A machine name derived from a human sentence — the user **never types an `id`**.
 *
 * The schema demands `^[a-z][a-z0-9_]*$`, and asking a non-coder to invent a
 * string in that shape is asking them to learn a rule that belongs to THE
 * MACHINE. They type *"đếm hoá đơn"*, we produce `dem_hoa_don`. // i18n-allow-vietnamese: the diacritics are the example
 *
 * ⚠ Diacritics come off with `\p{M}` after `NFD`, never with a hand-written
 * table: typing a combining mark straight into a `[]` makes it attach to the
 * bracket — it looks identical and behaves wrongly. That lesson was paid for once
 * already on a Vietnamese regex.
 */
export function slugId(say: string): string {
  const s = say
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd') // i18n-allow-vietnamese: `đ` survives NFD, so it needs its own rule
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(s) ? s : `viec_${s || 'moi'}`;
}

/**
 * One command line → argv.
 *
 * ⚠ THIS IS NOT A SHELL, and it must never be allowed to grow into one. It splits
 * on whitespace and honours `"…"` and `'…'` — just enough to accept a line the
 * user **copied from where they already ran it**. No `|`, no `&&`, no variables,
 * no `$(…)`: those are **shell syntax**, and §16e forbids going through a shell.
 *
 * ⭐ And because the split can guess wrong, **the interface shows every argv piece
 * back** right underneath. The user SEES what will run ⇒ a wrong guess gets
 * corrected, and nothing breaks silently. That is the only way a guess is allowed
 * to exist here.
 */
export function toArgv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
      continue;
    }
    cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

/**
 * argv → a line `toArgv` can read back. It is the inverse, so the quote has to be
 * chosen correctly: wrap in `"` unless the piece contains a `"` (then use `'`).
 * `toArgv` understands no escapes, so `JSON.stringify` is WRONG here — it emits
 * `\"`.
 */
export function joinArgv(parts: readonly string[]): string {
  return parts
    .map((s) => {
      if (s !== '' && !/[\s'"]/.test(s)) return s;
      return s.includes('"') && !s.includes("'") ? `'${s}'` : `"${s}"`;
    })
    .join(' ');
}

/** The slot names in an argv, in order of appearance, without repeats. */
export function slots(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (const el of argv) {
    for (const m of el.matchAll(/\{([a-z0-9_]+)\}/gi)) if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⭐ THE EXAMPLE: THE USER TYPES **A WHOLE COMMAND**, THE MACHINE EXTRACTS │
 * │ **EACH SLOT**. (the user asked for this field back on 01/09, and this is │
 * │ where the two earlier decisions are reconciled)                          │
 * │                                                                          │
 * │ The two decisions look contradictory:                                    │
 * │  · 31/08 — the example belongs at the **PARAMETER level**: the model does│
 * │    not assemble a command line, it only fills `{tag}`. Showing it a whole│
 * │    command line makes it match backwards. And that is a RECURRING bill:  │
 * │    it sits in the prefix on every turn, capped at 60 characters.         │
 * │  · 01/09 — *"one real runnable command and it is zero-shot"*: the user   │
 * │    **cannot verify** a detached example, but they can paste a command    │
 * │    line into their own terminal right now.                               │
 * │                                                                          │
 * │ ⇒ It is not either/or. **The human types at the level they can verify;   │
 * │ the model receives at the level it controls.** We align `run` with the   │
 * │ example line piece by argv piece and pull the values out:                │
 * │ `… --month {month}` ⨯ `… --month 8` → `month=8`.                         │
 * │                                                                          │
 * │ ⚠ And this IS A GUESS, so it follows `toArgv`'s rule: **the interface    │
 * │ shows what was extracted**. No match ⇒ return `null` ⇒ the screen says   │
 * │ plainly "the example does not match the syntax", rather than quietly     │
 * │ assigning something.                                                     │
 * │                                                                          │
 * │ ⚠ The piece counts must be EQUAL. A mismatch means the example belongs to│
 * │ a different syntax (or they edited the syntax and forgot the example) —  │
 * │ that is signal, not noise.                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function alignExample(tmpl: readonly string[], ex: readonly string[]): Record<string, string> | null {
  if (!tmpl.length || tmpl.length !== ex.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < tmpl.length; i++) {
    const t = tmpl[i]!;
    const e = ex[i]!;
    const found = [...t.matchAll(/\{([a-z0-9_]+)\}/gi)];
    // A fixed piece must be identical. Different ⇒ the example is not this syntax.
    if (!found.length) {
      if (t !== e) return null;
      continue;
    }
    // Two slots in the SAME piece (`{a}-{b}`) are separable but ambiguous — skip
    // them rather than guess. A slot that cannot be extracted simply has no
    // example.
    if (found.length > 1) continue;
    const at = t.indexOf('{');
    const head = t.slice(0, at);
    const tail = t.slice(t.indexOf('}') + 1);
    if (!e.startsWith(head) || !e.endsWith(tail) || e.length < head.length + tail.length) return null;
    const v = e.slice(head.length, e.length - tail.length);
    if (v) out[found[0]![1]!] = v;
  }
  return out;
}

/**
 * The parameters that WILL BE SAVED for one command — the argv slots are THE
 * SOURCE OF TRUTH.
 *
 * The user declares parameters nowhere: they type `{month}` into the syntax and
 * that is it. Declaring in two places (a parameter list plus an argv) is two
 * places that drift — and the drift explodes at run time, in `fillArgv`, with
 * *"the argv has a slot but the declaration has no such parameter"*.
 */
export function paramsFor(a: CliDraft): Record<string, unknown>[] {
  const argv = toArgv(a.line);
  const names = slots(argv);
  if (!names.length) return [];
  const vals = a.example.trim() ? alignExample(argv, toArgv(a.example)) : null;
  return names.map((n) => {
    const kept = a.params.find((p) => p['name'] === n) ?? { name: n, type: 'string', required: true };
    const ex = vals?.[n];
    return ex ? { ...kept, example: ex.slice(0, 60) } : kept;
  });
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `cwd` BELONGS TO **THE ARM**, NOT TO EACH COMMAND. (the user's call      │
 * │ 01/09)                                                                   │
 * │                                                                          │
 * │   *"pick the tab → the folder picker → after that every command in the   │
 * │    list operates from that office when it is called"*                    │
 * │                                                                          │
 * │ The schema still keeps `cwd` at the action level (correct — it has to be │
 * │ more permissive than the interface), and we write **the same value into  │
 * │ every action**. Why that is right rather than lazy: a CLI arm **is a     │
 * │ project** — several commands over one directory. Asking for the folder   │
 * │ again per command asks one question n times when it has one answer, and  │
 * │ that is exactly where a user types them differently and then cannot see  │
 * │ why the third command finds no file.                                     │
 * │                                                                          │
 * │ ⚠ The consequence has to be respected: a hand-written declaration CAN set│
 * │ a different `cwd` per command. The form **cannot hold** that shape ⇒ it  │
 * │ must **refuse to read it back** (`declToDraft` returns `mixed: true`)    │
 * │ rather than quietly taking the first one.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 DO NOT FILTER OUT UNFINISHED COMMANDS. (bug the user caught 01/09,     │
 * │ and MEASURED)                                                             │
 * │                                                                           │
 * │ The previous version had `.filter(a => a.say.trim() &&                    │
 * │ toArgv(a.line).length)` to keep the output "clean". Its price, measured:  │
 * │ a form with **2 commands** → JSON with **1 action** → read back into a    │
 * │ form with **1 command**. Pressing *View JSON* then *← Back to form*       │
 * │ **loses a whole row, silently** — and the *Use this config* button stayed │
 * │ lit, because `cliCount` counted after the filter.                         │
 * │                                                                           │
 * │ ⭐ The filter IS the bug: it **deletes the user's data so the output      │
 * │ validates**. That is a forgery — the config looks valid because whatever  │
 * │ was invalid got thrown away, not because the user finished filling it in. │
 * │ → [[agentco-fallback-throws-away-answers]]                                │
 * │                                                                           │
 * │ ⇒ Emit **every row**, unfinished ones included. An unfinished row makes   │
 * │ an INVALID declaration, and that is a good thing: `cliProblems` catches   │
 * │ it in the interface, `parseCliArm` catches it at the door. A declaration  │
 * │ that admits it is not finished leaves every gate behind it able to do its │
 * │ job; one that has been tidied up does not.                                │
 * │                                                                           │
 * │ ⚠ `id: ''` while there is no name — NOT `slugId('')` (which yields        │
 * │ `viec_moi`). Two empty rows both yielding `viec_moi` would have `dupIds`  │
 * │ shouting *"duplicate name"* over two fields nobody has typed in yet — an  │
 * │ error that follows the rule and describes the wrong thing.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function draftToDecl(
  list: readonly CliDraft[],
  cwd = '',
): { type: 'cli'; actions: Record<string, unknown>[] } {
  const dir = cwd.trim();
  return {
    type: 'cli',
    actions: list.map((a) => {
      const params = paramsFor(a);
      return {
        id: a.say.trim() ? slugId(a.say) : '',
        say: a.say.trim(),
        description: a.description.trim() || a.say.trim(),
        run: toArgv(a.line),
        ...(params.length ? { params } : {}),
        ...(dir ? { cwd: dir } : {}),
        ...(a.read_only ? { read_only: true } : {}),
        ...(a.fail_when.trim()
          ? { fail_when: a.fail_when.split(',').map((s) => s.trim()).filter(Boolean) }
          : {}),
      };
    }),
  };
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY COMMAND HAS TO BE COMPLETE BEFORE ANYTHING MOVES ON. (the user's    │
 * │ call 01/09)                                                               │
 * │                                                                           │
 * │   *"I click add command, fill in nothing, and the button is still lit"*   │
 * │                                                                           │
 * │ It returns **per index**, not one shared `boolean`: a dimmed button with  │
 * │ nothing marked red leaves the user hunting field by field. Same rule as   │
 * │ `dupIds` — report at **the field they can fix**, not at the foot of the   │
 * │ screen.                                                                   │
 * │                                                                           │
 * │ ⚠ This is the FIRST of two fences. The real rule still lives in           │
 * │ `parseCliArm` (`server.ts §resolveArm`, the SHARED door behind both Test  │
 * │ and Done) — so neither a race nor a hand-written client gets past it.     │
 * │ This one exists only to be **seen before the click**, and it is           │
 * │ deliberately narrower than the schema: it asks about the two fields THE   │
 * │ FORM draws.                                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface CliProblem {
  at: number;
  field: 'say' | 'line';
  say: string;
}

export function cliProblems(list: readonly CliDraft[], t: Translate): CliProblem[] {
  const out: CliProblem[] = [];
  list.forEach((a, at) => {
    if (!a.say.trim()) out.push({ at, field: 'say', say: t('cliForm.noName') });
    if (!toArgv(a.line).length) out.push({ at, field: 'line', say: t('cliForm.noLine') });
  });
  return out;
}

/**
 * What WILL BE SAVED — used for **both** the button's lit/dim state and the click.
 *
 * ⚠ One function, not two similar-looking expressions: dimming by one computation
 * while saving by another is the "the button was lit and clicking did nothing"
 * case (or, worse, the reverse: dimmed while the config is valid).
 *
 * ⚠ `null` = **there is nothing to save yet**, and that is an answer, not an
 * error. The previous version fell back to `draftToDecl(list)` when the JSON block
 * was broken — so *"Use this config"* **stayed lit** while the JSON box was red,
 * and clicking it saved **the form's version**, not what was on the screen. A
 * fallback that threw away the one answer that needed hearing (*"this block is
 * broken"*). → [[agentco-fallback-throws-away-answers]]
 */
export function cliDecl(
  list: readonly CliDraft[],
  cwd: string,
  json: string | null,
): Record<string, unknown> | null {
  return json === null ? draftToDecl(list, cwd) : safeJson(json);
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DUPLICATE COMMAND IDS — returns the ids that appear more than once.       │
 * │ (the user asked on 01/09: *"what happens if two ids collide?"*)           │
 * │                                                                           │
 * │ MEASURED: the SDK **throws** `Tool a is already registered` ⇒ there is no │
 * │ silent-swallow case. But it throws inside `compileCliArm`, i.e. **when    │
 * │ Test is pressed**, in English, about a "tool" — while the user has just   │
 * │ named two *commands* in their own language.                               │
 * │                                                                           │
 * │ 🔴 AND IT IS REACHABLE FROM THE FORM: the user **never types an `id`**,   │
 * │ `slugId(say)` generates it ⇒ *"count invoices"* and *"count invoices!"*   │
 * │ produce **the same** id. This is not a rare case for someone poking at    │
 * │ JSON.                                                                     │
 * │                                                                           │
 * │ ⚠ AND THIS IS EASY TO FIX AT THE WRONG LAYER (the user pointed it out):   │
 * │ a duplicate id is only a **symptom**; the illness is **two commands the   │
 * │ employee cannot tell apart**. So do not quietly append a `_2` suffix —    │
 * │ that hides a problem that is still fully present on the model's side:     │
 * │ `does` lists two identical lines and it has to guess.                     │
 * │ ⇒ **Block, and report on the NAME field** — where the user can fix it.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function dupIds(decl: Record<string, unknown> | null): string[] {
  const acts = decl && Array.isArray(decl['actions']) ? (decl['actions'] as Record<string, unknown>[]) : [];
  const seen = new Set<string>();
  const bad = new Set<string>();
  for (const a of acts) {
    const id = String(a?.['id'] ?? '');
    if (!id) continue;
    if (seen.has(id)) bad.add(id);
    seen.add(id);
  }
  return [...bad];
}

export function cliCount(decl: Record<string, unknown> | null): number {
  return decl && Array.isArray(decl['actions']) ? (decl['actions'] as unknown[]).length : 0;
}

/**
 * Declaration → draft, for the JSON → form direction.
 *
 * ⚠ CORRECTION 01/09 — the previous text said *"dropping unknown fields is
 * CORRECT"*, and that is only true of fields **the form does not know about**. It
 * is NOT true of `params`: the form does know `params` (it generates them from
 * `{slots}`), it just renders **one field** of them. Dropping
 * `pattern`/`min`/`max`/`allow_dash` here means one click on "Back to form"
 * silently **removes a guard the user put up** — exactly
 * [[agentco-fallback-throws-away-answers]]. ⇒ Carry them whole and overwrite only
 * `example`.
 *
 * ⚠ `mixed: true` = the declaration sets **a different directory per command**, a
 * shape the form cannot hold (see `draftToDecl`). It returns a flag rather than
 * choosing for the user: the call site has to **lock the "← Back to form"
 * button**. Quietly taking the first command's `cwd` moves where the other n−1
 * commands run with nobody told — and for a command that writes data that is
 * running in the wrong directory, not a display bug.
 */
export function declToDraft(
  decl: unknown,
): { acts: CliDraft[]; cwd: string; mixed: boolean } | null {
  const acts = (decl as { actions?: unknown })?.actions;
  if (!Array.isArray(acts) || !acts.length) return null;
  const dirs = new Set(
    acts.map((a) => {
      const c = (a as Record<string, unknown>)?.['cwd'];
      return typeof c === 'string' ? c : '';
    }),
  );
  const drafts = acts.map((a) => {
    const o = a as Record<string, unknown>;
    const run = Array.isArray(o['run']) ? (o['run'] as unknown[]).map(String) : [];
    const params = Array.isArray(o['params'])
      ? (o['params'] as unknown[]).filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      : [];
    /**
     * Rebuild THE EXAMPLE LINE by replacing each slot with its `example` — the
     * inverse of `alignExample`. One slot missing ⇒ **leave the whole line
     * empty**: an example still carrying a `{month}` in the middle is not an
     * example, it is the syntax a second time.
     */
    const byName = new Map(params.map((p) => [String(p['name']), p['example']]));
    const need = slots(run);
    const full = need.length > 0 && need.every((n) => typeof byName.get(n) === 'string' && byName.get(n) !== '');
    return {
      say: String(o['say'] ?? ''),
      description: String(o['description'] ?? ''),
      line: joinArgv(run),
      example: full ? joinArgv(run.map((s) => s.replace(/\{([a-z0-9_]+)\}/gi, (_, n: string) => String(byName.get(n))))) : '',
      read_only: o['read_only'] === true,
      fail_when: Array.isArray(o['fail_when']) ? (o['fail_when'] as unknown[]).join(', ') : '',
      params,
    };
  });
  return { acts: drafts, cwd: dirs.size === 1 ? [...dirs][0]! : '', mixed: dirs.size > 1 };
}