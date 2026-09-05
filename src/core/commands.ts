/**
 * Text commands in the chat box. → docs/SPEC-tools-approval.md §8e
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS HAS TO BE BLOCKED HERE, NOT IN THE UI
 * │
 * │ The string we hand to `query({ prompt })` goes straight to the Claude Code
 * │ CLI itself, and that CLI HAS its own set of slash commands (`/clear`,
 * │ `/compact`, `/model`…). A sentence starting with `/` could get interpreted
 * │ as one of ITS commands — a `/clear` slipping through wipes out the
 * │ Assistant's entire conversation context with nobody knowing why.
 * │
 * │ So: an ALLOWLIST. Anything that isn't one of our own commands doesn't go
 * │ any further. We don't need to know what commands Claude Code has, today or next year.
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Commands are written in ENGLISH regardless of who the user is — the project
 * goes global, and a command set is a programming interface, not a sentence.
 * The REPLY still follows the user's own language.
 *
 * This same command set runs both in the interface and on Telegram, since
 * both go through `office.say()`.
 */

import { plural, t, type MessageKey } from '../i18n/index.js';

export type CommandName = 'stop' | 'approve' | 'reject' | 'status' | 'help' | 'clear' | 'resume';

export interface CommandSpec {
  name: CommandName;
  /** Typable forms, including abbreviations. All in English. */
  aliases: readonly string[];
  /**
   * A CATALOGUE KEY, not a sentence.
   *
   * `COMMANDS` is a module-level constant, so a resolved string here would be
   * frozen at import to whichever language the process started in and would
   * never follow the switch afterwards. Holding the key defers the lookup to
   * `helpText()`, which runs per request. → docs/CLAUDE.md §Language
   */
  help: MessageKey;
}

export const COMMANDS: readonly CommandSpec[] = [
  { name: 'stop', aliases: ['stop', 'cancel', 's'], help: 'cmd.stop' },
  { name: 'approve', aliases: ['approve', 'ok', 'y'], help: 'cmd.approve' },
  { name: 'reject', aliases: ['reject', 'no', 'n'], help: 'cmd.reject' },
  { name: 'status', aliases: ['status', 'st'], help: 'cmd.status' },
  /**
   * Resumes an INTERRUPTED run — no replanning, no model turn spent.
   *
   * A COMMAND rather than a button, because it has to work through Telegram
   * too (the bridge is the ultimate target, and no canvas exists there). And
   * it must be an EXPLICIT user action: auto-resuming when the daemon starts
   * up would mean a silent crash quietly spending their money. → SPEC-offices.md §6b
   */
  { name: 'resume', aliases: ['resume'], help: 'cmd.resume' },
  /**
   * Sharing its NAME with Claude Code's `/clear` is deliberate: the user
   * already has that reflex, and the meaning matches here. But it NEVER
   * reaches the CLI — the allowlist in `parseInput` blocks every slash
   * string, and we handle it ourselves in code.
   *
   * Differs from Claude Code's `/clear` in one important way: we COMPRESS
   * BEFORE FORGETTING. The compressed summary goes into the Assistant's own
   * notebook, readable again from the Knowledge panel.
   */
  { name: 'clear', aliases: ['clear'], help: 'cmd.clear' },
  { name: 'help', aliases: ['help', 'h', '?'], help: 'cmd.help' },
];

export type ParsedInput =
  /** One of our own commands — handled in code, does NOT call the model, 0 tokens. */
  | { kind: 'command'; name: CommandName; arg: string }
  /** Starts with "/" but isn't one of ours — BLOCKED, never passed down to the SDK. */
  | { kind: 'unknown'; typed: string }
  /** Plain text (with the "//" escape stripped, if present). */
  | { kind: 'text'; text: string };

/**
 * Classifies one line the user typed. Called at the VERY START of
 * `office.say()`, before anything else.
 *
 * Three branches, and `unknown` is the safety branch: anything starting with
 * "/" that we don't recognize stops right here.
 */
export function parseInput(raw: string): ParsedInput {
  const text = raw.trim();

  // "//" is the escape hatch for someone who genuinely wants to start a sentence with a slash.
  if (text.startsWith('//')) return { kind: 'text', text: text.slice(1) };
  if (!text.startsWith('/')) return { kind: 'text', text };

  const body = text.slice(1);
  const space = body.search(/\s/);
  const word = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  const arg = space === -1 ? '' : body.slice(space + 1).trim();

  for (const c of COMMANDS) {
    if (c.aliases.includes(word)) return { kind: 'command', name: c.name, arg };
  }
  return { kind: 'unknown', typed: word };
}

/**
 * The reply to `/help` and to an unrecognized command. 0 tokens — built in code.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY LINE BREAKS INSTEAD OF COLUMN ALIGNMENT
 * │
 * │ The earlier version laid out `/command — description` on ONE line. The
 * │ chat pane is ~330px wide, and this same command set will run over Telegram
 * │ too — both are narrow. A long line wraps automatically at a random point,
 * │ and the description falls into line with the next command name: the reader
 * │ can no longer tell which line is a command.
 * │
 * │ Aligning columns with spaces doesn't save it either — that only works with
 * │ a monospace font, and chat bubbles use a regular one.
 * │
 * │ So: command name on its own line, description indented on the line below.
 * │ Readable at any width, including on a phone.
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ This string contains real newline characters. The display side MUST
 * preserve them (`white-space: pre-wrap`), or the HTML collapses everything into one line.
 */
export function helpText(unknown?: string): string {
  const blocks = COMMANDS.map((c) => {
    // An abbreviation is something the user only needs to learn ONCE, so it
    // rides on the same line as the command name instead of taking its own line.
    const short = c.aliases.slice(1).filter((a) => a.length <= 2);
    const alias = short.length
      ? `   ${t('cmd.orAlias', { list: short.map((a) => `/${a}`).join(', ') })}`
      : '';
    return `/${c.aliases[0]}${alias}\n    ${t(c.help)}`;
  });

  const head = unknown ? t('cmd.noSuch', { typed: unknown }) : t('cmd.available');

  return `${head}\n\n${blocks.join('\n\n')}\n\n${t('cmd.escapeHint')}`;
}

/**
 * `@path` in the chat box → a VERIFIED path. → docs/SPEC-library.md §8c
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY NOT RELY ON THE SDK UNDERSTANDING `@` — AND WHY WE DON'T WANT IT TO.  │
 * │                                                                          │
 * │ The Claude Code CLI has `@file` syntax when typed by hand. Whether it        │
 * │ actually works through the SDK **has never been measured** — `FINDINGS-sdk`     │
 * │ has not one line about it, and this project already paid once for building on   │
 * │ an unmeasured SDK behavior (`canUseTool` never fired once, SPEC-offices §4.7).   │
 * │                                                                          │
 * │ 🔥 But the real reason is much stronger: **if the SDK does understand it,       │
 * │ that would be a BAD thing.** Expanding `@` means injecting the file's           │
 * │ CONTENT into the turn — and the Assistant runs on a persisted session, so         │
 * │ anything it reads sits in the context of EVERY turn after that: *read once,       │
 * │ pay forever*. The entire architecture is built on the rule "the Assistant does     │
 * │ not read files, only a worker does".                                             │
 * │                                                                          │
 * │ So `@` is STRIPPED OUT ENTIRELY here, before the string reaches the model. We     │
 * │ depend on no SDK behavior whatsoever — measured or not.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ This gate runs on text the USER TYPED, not text the model generated —
 * entirely different from the rule banning path-guessing inside `say`
 * (SPEC-artifacts §2.5). There the risk is the model inventing a
 * plausible-sounding path; here the user is responsible for what they type,
 * AND every reference still has to match `known` — the list of real paths
 * read from disk — before it's accepted.
 *
 * Four accepted forms:
 *
 *   @artifacts/P-…/T-01/vi/doc-2.md      full path → matched then used
 *   @library/files/doc-1.md               full path → matched then used
 *   @doc-1.md                             bare name → looked up, BLOCKED if ambiguous
 *   @library/files/Mix, Mingle&Meet.pptx  HAS SPACES → matched by longest string
 *
 * The third form is why this function has to exist; the fourth is why it
 * can't be cut at whitespace. → `typables`
 *
 * Colliding bare names are a REAL case, and the two stores are allowed to
 * collide: the document cabinet has `doc-1.md`, and the Results panel also
 * has `doc-1.md`. Guessing one side silently means doing the wrong thing with
 * the user's work — so it asks instead, in code, at 0 tokens.
 */
/**
 * One document, seen from TWO sides. → SPEC-library.md §4.4
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE USER TYPES THE NAME THEY SEE; THE MODEL NEEDS A PATH IT CAN OPEN.     │
 * │                                                                          │
 * │ The Copy button in the Document cabinet panel gives `library/files/hd1.docx` │
 * │ — exactly what they see on screen. But `.docx` is a compressed file no tool     │
 * │ opens directly; the openable path is `library/text/hd1.docx.txt`. Before        │
 * │ 20/08 these two were ONE string, so either use was wrong on one side or the      │
 * │ other.                                                                    │
 * │                                                                          │
 * │ ⚠ The user's call, stated explicitly, is that this is NOT breaking the rule      │
 * │ *"the path the user typed is exact, copy it verbatim"* but rather **FIXING**       │
 * │ that rule: what they're pointing at is a DOCUMENT, not a byte string. Keeping      │
 * │ the string exact while losing the document is what would actually betray their    │
 * │ intent.                                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface ReadableRef {
  /** The string the user (or model) is allowed to type — what shows in the interface. */
  ref: string;
  /** The string that reaches the model. Equal to `ref` for anything already openable as-is. */
  open: string;
}

/** File name, with the directory stripped off. */
function base(p: string): string {
  return p.split('/').pop() ?? p;
}

/**
 * EVERY STRING SOMEONE IS ALLOWED TO TYPE AFTER `@`, LONGEST FIRST.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUG THE USER REPORTED 02/09 — `@library/files/Mix, Mingle&Meet.pptx`         │
 * │ reported *"library/files/Mix not found"*.                                  │
 * │                                                                          │
 * │ The old version cut the reference at WHITESPACE (`@([^\s@]+)`), based on a       │
 * │ premise written right in the comment: *"a name with spaces needs the full         │
 * │ path, and the Copy button always gives the full path anyway"*. That premise        │
 * │ was WRONG: the full path also contains that exact same space. So the Copy          │
 * │ button — the escape hatch the error message itself invited the user to click        │
 * │ — produced a string the parser couldn't read.                                       │
 * │                                                                          │
 * │ The fix is NOT inventing a quoting convention (`@"…"`) and forcing the user         │
 * │ to learn it, and it's NOT forcing file names to be "clean" either — the             │
 * │ document belongs to them, `Mix, Mingle&Meet.pptx` is a valid name. We're            │
 * │ HOLDING the list of real paths read from disk, so there's no need to guess           │
 * │ a boundary: match the longest string in `known` that the text after `@` starts       │
 * │ with. Spaces, commas, `&`, accented characters — none of them count as a             │
 * │ boundary anymore.                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Longest first because one name can be a prefix of another: with both
 * `report.md` and `report.md.bak` present, `@report.md.bak` has to resolve to the second one.
 */
function typables(known: readonly ReadableRef[]): string[] {
  const set = new Set<string>();
  for (const k of known) {
    set.add(k.ref);
    set.add(k.open);
    set.add(base(k.ref));
    set.add(base(k.open));
  }
  set.delete('');
  return [...set].sort((a, b) => b.length - a.length);
}

/**
 * The character sitting right after a fully matched reference.
 *
 * ⚠ Without this fence, prefix-matching would swallow ordinary words: a
 * document named `a` would make `@a friendly reminder` match as `a`. End of
 * string, whitespace, or punctuation — anything else is the person's own
 * words, not a file name.
 */
function endsRef(next: string | undefined): boolean {
  return next === undefined || /[\s.,;:)\]}]/.test(next);
}

/** Resolves a typed string to exactly one document. Colliding bare names → `undefined`. */
function lookupRef(
  raw: string,
  known: readonly ReadableRef[],
): { hit?: ReadableRef; clash?: ReadableRef[] } {
  // Exact match first, on both sides: they might paste the displayed path
  // (Copy button) OR the openable path (the Assistant's own prefix listing names this one).
  const exact = known.find((k) => k.ref === raw || k.open === raw);
  if (exact) return { hit: exact };

  const matches = known.filter((k) => base(k.ref) === raw || base(k.open) === raw);
  // The same document matched through two doors is NOT a collision.
  const distinct = [...new Map(matches.map((k) => [k.open, k])).values()];
  if (distinct.length > 1) return { clash: distinct };
  return distinct[0] ? { hit: distinct[0] } : {};
}

export function resolveFileRefs(
  text: string,
  known: readonly ReadableRef[],
): { text: string; problem?: string } {
  // `@` must sit at the start of the string or after whitespace —
  // `name@mail.com` is not a file reference.
  if (!/(^|\s)@/.test(text)) return { text };

  const names = typables(known);

  // Rebuilt using INDICES, not `String.replace`. `replace` only touches the
  // FIRST occurrence in the whole sentence, so "@a.md then @a.md again" used
  // to fix the same spot twice and miss the second one.
  let out = '';
  let cursor = 0; // how far we've written out — also the "this span was already consumed" marker
  const re = /(^|\s)@/g;

  for (let m = re.exec(text); m; m = re.exec(text)) {
    const at = m.index + m[1]!.length; // position of the `@` character itself
    if (at < cursor) continue; // this `@` sits inside a reference already consumed
    // `\` → `/` right away: pasting from Explorer is a common case on
    // Windows. A one-for-one swap keeps every index below still pointing correctly into `text`.
    const rest = text.slice(at + 1).replace(/\\/g, '/');

    // EXACT MATCH FIRST: the longest string in `known` that `rest` starts
    // with. This is the only path that accepts names containing spaces. → `typables`
    let raw = names.find((n) => rest.startsWith(n) && endsRef(rest[n.length]));
    let tail = '';

    if (!raw) {
      // Nothing matched ⇒ cut at whitespace as before, so the error message
      // still names exactly what they typed when they genuinely typed something wrong.
      const typed = /^[^\s@]+/.exec(rest)?.[0] ?? '';
      if (!typed) continue; // a bare `@`, or `@@` — not a reference
      // Strip trailing punctuation stuck to it: someone typed "fix @a/b.md, keep the start as-is".
      //
      // ⚠ The stripped part must be PUT BACK into the sentence. The first
      // version replaced the whole span with a clean path, and the comma
      // vanished from the user's own sentence — silently editing what they
      // wrote is a small thing here but a bad habit: we are only allowed to
      // strip `@`, never to edit.
      tail = /[.,;:)\]}]+$/.exec(typed)?.[0] ?? '';
      raw = tail ? typed.slice(0, -tail.length) : typed;
      if (!raw) continue;
    }

    const { hit, clash } = lookupRef(raw, known);
    if (clash) {
      return {
        text,
        problem: t('cmd.refClash', {
          n: String(clash.length),
          name: raw,
          list: clash.map((k) => `  ${k.ref}`).join('\n'),
        }),
      };
    }
    if (!hit) {
      return {
        text,
        problem: t('cmd.refMissing', { name: raw }),
      };
    }

    // Strips `@`, replaced with the path a WORKER CAN OPEN — not necessarily
    // the string they just typed. `@hd1.docx` becomes
    // `library/text/hd1.docx.txt`, since no tool can open the raw `.docx`,
    // and a dead path is the most expensive possible way to honor the
    // literal text. → `ReadableRef`
    out += text.slice(cursor, at) + hit.open + tail;
    cursor = at + 1 + raw.length + tail.length;
  }

  if (cursor === 0) return { text };
  return { text: out + text.slice(cursor) };
}

/**
 * Paths the Assistant PROPOSES reading → paths that ACTUALLY EXIST. → SPEC-offices.md §6 `lookup`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS THE SPOT WHERE "HIDDEN WORKER" BECOMES A MECHANISM RATHER THAN A       │
 * │ PROMISE.                                                                  │
 * │                                                                          │
 * │ The incoming strings are MODEL-generated, so it can make things up — and the      │
 * │ SPEC-artifacts §2.5 rule forbids letting a model-guessed path borrow the           │
 * │ system's own credibility. Here every path must match `known` (read fresh from       │
 * │ disk right at that moment) to proceed; anything that doesn't match is NOT           │
 * │ guessed on its behalf, it gets STATED.                                             │
 * │                                                                          │
 * │ Differs from `resolveFileRefs` in one important way: there, a broken path is        │
 * │ the user's own mistake, so it has to stop the whole sentence. Here, if the           │
 * │ model proposes three files and two of them are real, **those two get read** —        │
 * │ it only guessed wrong on one, and making the user retype everything because of        │
 * │ that would be punishing the wrong party.                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Also accepts bare names (`doc-1.md`) like `resolveFileRefs`, and also
 * BLOCKS on a collision — the document cabinet and the Results panel are
 * allowed to share the same file name.
 */
export function pickReadable(
  paths: readonly string[],
  known: readonly ReadableRef[],
): { ok: string[]; missing: string[] } {
  const ok: string[] = [];
  const missing: string[] = [];

  for (const raw of paths) {
    const p = raw.replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (!p) continue;
    // A bare name is only accepted with EXACTLY ONE candidate — two files
    // sharing a name across two stores means guessing wrong reads the wrong
    // document and gives a very convincing wrong answer, the worst outcome
    // of all. `lookupRef` enforces that rule for both doors.
    const { hit } = lookupRef(p, known);
    // The OPENABLE path, same as the `@` gate: the hidden `lookup` worker
    // only has `Read`/`Grep` too, so handing it a `.docx` hands it a file it can't open.
    if (hit) {
      if (!ok.includes(hit.open)) ok.push(hit.open);
      continue;
    }
    if (!missing.includes(p)) missing.push(p);
  }

  return { ok, missing };
}

/**
 * The status line for one `lookup` run. → SPEC-offices.md §6 `lookup`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE OTHER HALF OF THE TRUTH, AT 0 TOKENS.                                 │
 * │                                                                          │
 * │ The hidden worker deliberately does NOT produce a Plan: a message saying          │
 * │ *"splitting this into 1 task to read the file"* for a lookup question would         │
 * │ cost two messages just to announce that an answer is coming — exactly the           │
 * │ "clunkiness" this path exists to remove. But replying under the `assistant`          │
 * │ role with nothing further said makes the user think the Assistant just knew,         │
 * │ while a real file-reading turn just ran.                                            │
 * │                                                                          │
 * │ A status line naming WHICH FILE was read is enough: the user sees that a           │
 * │ read is happening and what it read. No plan, no steps, no extra messages           │
 * │ cluttering the chat stream.                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * States only the FILE NAME, not the path: `library/files/doc-2.md` on a
 * status line is machine language. Truncated at 2 names since this line gets
 * `truncate`d in the interface — the same way `office.run()` says "Reading
 * documents X, Y…".
 */
export function readingNote(paths: readonly string[]): string {
  // No files at all = a general lookup question (24/08). The status line
  // must state EXACTLY what's running: "Reading …" for a web lookup would be
  // lying about something observable, and the user would go looking for a
  // file that doesn't exist.
  if (paths.length === 0) return t('cmd.lookingUpWeb');
  const names = paths.map((p) => p.split('/').pop() ?? p);
  const head = names.slice(0, 2).join(', ');
  const rest = names.length - 2;
  return rest > 0
    ? plural('cmd.readingMore', rest, { names: head })
    : t('cmd.reading', { names: head });
}
