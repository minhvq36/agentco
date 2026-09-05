/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE HARNESS PUTS THE USER'S EMAIL IN EVERY FIRST TURN, AND THE MODEL   │
 * │ ANSWERS IN THE LANGUAGE THAT EMAIL LOOKS LIKE. (measured 05/09)          │
 * │                                                                          │
 * │ Captured off the wire, with a logging proxy on `ANTHROPIC_BASE_URL`. The │
 * │ Claude Code CLI prepends a block of its own as content[0] of the FIRST    │
 * │ user message, ahead of every word we wrote:                              │
 * │                                                                          │
 * │   <system-reminder> … # userEmail                                        │
 * │   The user's email address is <the machine owner's address>. …           │
 * │                                                                          │
 * │ The string lives inside the bundled CLI binary, beside the flags          │
 * │ `user_context_started` · `has_user_email` · `claudemd_disabled`. There is │
 * │ a switch for CLAUDE.md — `settingSources: []`, which we already pass —   │
 * │ and NO switch for this one. It is not ours, and we cannot remove it.     │
 * │                                                                          │
 * │ An address carries a name, and a name carries a language. Measured on a  │
 * │ brand-new empty office, first turn of a fresh session, a request in       │
 * │ English and a prompt with ZERO non-English characters anywhere:          │
 * │ 16/19 replies came back in the language of the address. The reverse       │
 * │ direction is fine (8/8) — the email simply agrees there.                 │
 * │                                                                          │
 * │ ⚠ It lands on the FIRST user message only. So a chat session drifts on    │
 * │ its opening turn and then recovers as English turns pile up, while every  │
 * │ one-shot door — planning, the report, `/clear` — is turn 1 EVERY time     │
 * │ and never recovers. That asymmetry is exactly what the transcripts show.  │
 * │                                                                          │
 * │ ⚠ SIX WORDINGS WERE TRIED AND ALL SIX LOST: rewording the slot clause,    │
 * │ deleting it, deleting the prompt-wide language line, strengthening it,    │
 * │ pointing it at the quoted sentence, and a fence sitting directly under    │
 * │ the injected block naming exactly what it outranks. 0/5, 4/5, 4/4, 4/4,   │
 * │ 5/5, 5/5 — no movement. An identity datum sitting next to the request     │
 * │ beats every rule, however loud, however close.                           │
 * │ → [[agentco-prompt-rules-lose-to-examples]]                              │
 * │                                                                          │
 * │ ⇒ So this is CODE, not a sentence. Deterministic detection first, and    │
 * │ only a hit pays for a repair turn — the same shape as                     │
 * │ `staleArmMentions` and `worker.ts §repairReceipt`.                       │
 * │                                                                          │
 * │ ⚠ A WORKED EXAMPLE PAIR was measured too, and it is the one thing that    │
 * │ moved the number (3/5 where every rule scored 0/5). It is NOT here, on    │
 * │ purpose: an example has to be written IN some language, which pins two    │
 * │ named languages into a cached prefix and silently biases every user who   │
 * │ speaks a third. That is the exact trade docs/CLAUDE.md §Language forbids, │
 * │ and `test/no-pinned-language.test.ts` is its gate. Trading a measured,    │
 * │ bounded cost (a repair turn) for an unmeasured, silent regression in      │
 * │ every language we did not name is the wrong direction.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * ⚠ THIS IS NOT A LANGUAGE DETECTOR, AND IT MUST NEVER BECOME ONE.
 *
 * `scripts/check-language.ts` already carries the warning that
 * `hasVietnameseDiacritics` is exact ONLY because it is pointed at our own
 * source, which has exactly two possible states — point it at user text and it
 * calls Spanish, German and Arabic all "English".
 *
 * So this asks a different, answerable question: **did the reply start using a
 * writing system the human themselves never used?** That is a comparison
 * between two strings we are both holding, not a guess about either one.
 *
 * The blind spot is STATED, not hidden: two languages sharing one script
 * (English↔Spanish, English↔French) are invisible here, and nothing in this
 * file pretends otherwise. It catches the script-distinct pairs, which is
 * where the measured failure lives.
 */
const SCRIPTS: readonly (readonly [string, RegExp])[] = [
  ['han', /\p{Script=Han}/gu],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ['hangul', /\p{Script=Hangul}/gu],
  ['cyrillic', /\p{Script=Cyrillic}/gu],
  ['greek', /\p{Script=Greek}/gu],
  ['arabic', /\p{Script=Arabic}/gu],
  ['hebrew', /\p{Script=Hebrew}/gu],
  ['thai', /\p{Script=Thai}/gu],
  ['devanagari', /\p{Script=Devanagari}/gu],
];

/** Latin letters that are not plain ASCII — the bucket Vietnamese lands in. */
const MARKED_LATIN = 'latin-marked';

/**
 * Shares, not counts. A single borrowed word, or one personal name written in
 * Han, must never trip this: measured, a Vietnamese sentence runs 15-25%
 * marked letters, while an English sentence carrying a loanword sits under 2%.
 *
 * ⚠ The denominator is EVERY letter, ASCII included. Using "non-ASCII letters"
 * as the denominator would make one accented character in a hundred read as
 * 100% — the exact shape of a gate that fires on the innocent case.
 *
 * ⚠ NFC first. A decomposed string spells the same word with plain ASCII plus
 * separate combining marks, and would otherwise slip through as "no marks".
 */
function shares(text: string): Map<string, number> {
  const s = text.normalize('NFC');
  const letters = s.match(/\p{L}/gu)?.length ?? 0;
  const out = new Map<string, number>();
  if (letters === 0) return out;

  const marked = (s.match(/\p{Script=Latin}/gu) ?? []).filter((c) => !/[A-Za-z]/.test(c)).length;
  if (marked > 0) out.set(MARKED_LATIN, marked / letters);

  for (const [name, re] of SCRIPTS) {
    const hits = s.match(re)?.length ?? 0;
    if (hits > 0) out.set(name, hits / letters);
  }
  return out;
}

/** Below this, a reply is too short to carry any signal at all. */
const MIN_LETTERS = 12;
/** The reply leans on it… */
const PRESENT = 0.1;
/** …and the human never did. Not zero: one borrowed word must not count as "used". */
const ABSENT = 0.02;

/**
 * Did `produced` switch to a writing system `human` never used?
 *
 * `human` is the person's OWN most recent sentence — never our prompt text,
 * which is English by construction and would only dilute the denominator, and
 * never a document they uploaded, which they did not write.
 *
 * With no `human` sentence in hand there is no evidence, so there is no
 * finding: an empty string returns `false` rather than guessing.
 */
export function driftsFrom(human: string, produced: string): boolean {
  if (!human.trim()) return false;
  if ((produced.match(/\p{L}/gu)?.length ?? 0) < MIN_LETTERS) return false;
  const theirs = shares(human);
  for (const [name, share] of shares(produced)) {
    if (share >= PRESENT && (theirs.get(name) ?? 0) < ABSENT) return true;
  }
  return false;
}

/**
 * The second turn, fired at most ONCE per answer — looping would spend money
 * on something already known not to close completely.
 *
 * ⚠ IT ASKS, IT DOES NOT ORDER. (user settled 05/09)
 *
 * `driftsFrom` is deliberately blunt — it compares two strings and knows
 * nothing about intent. There are real cases where drifting is exactly right:
 * the human writes in one script and asks for the answer in another, or names
 * a document whose title carries the script. Forcing a rewrite there would
 * spend a turn to make a correct answer wrong, and the human would have no
 * way to see why.
 *
 * So the gate supplies the EVIDENCE and the model makes the call — and
 * repeating the previous answer unchanged is stated as a valid outcome, not a
 * failure. `undrift` then keeps the original whenever the second turn does not
 * come back visibly better, so an unchanged answer costs one turn and changes
 * nothing else.
 *
 * ⚠ It NAMES NO LANGUAGE: the office has to keep working in languages we have
 * shipped no catalogue for. → docs/CLAUDE.md §Language
 */
export function driftRepair(human: string): string {
  /**
   * ⚠ THE HUMAN'S OWN SENTENCE, QUOTED — not a description of it.
   *
   * A one-shot door (the report, the `/clear` memory) has never seen what
   * they typed: its whole prompt is built by us, out of plan steps and
   * receipts. Telling it to "look at their message" there points at nothing.
   *
   * And a concrete datum is the only thing measured to win in this file at
   * all — six abstract rules lost. So the fix hands over the same KIND of
   * evidence that beat them, on our side of the argument this time.
   */
  const quoted = human.trim().replace(/\s+/g, ' ').slice(0, 240);
  return (
    'A CHECK, NOT AN INSTRUCTION. Read the evidence, then decide for yourself — both outcomes below ' +
    'are correct answers, and nothing here overrides your own judgement of what this person needs.\n\n' +
    `What they actually wrote to you, verbatim:\n  “${quoted}”\n\n` +
    'Your reply came back in a different writing system from that. Worth knowing: an email address, ' +
    'a profile, a locale or any other machine setting you may have been shown describes the DEVICE ' +
    'this office runs on. It is not this person, and it is not evidence of how they write. ' +
    'The quoted line above is.\n\n' +
    'So, your call:\n' +
    '  · If you simply answered in the wrong writing system — say it again in theirs, same format ' +
    'as before, same content.\n' +
    '  · If your reply was already right — they asked for that writing system, or the content ' +
    'itself has to be written that way, or the quoted line is too short to tell — then send it back ' +
    'UNCHANGED. That is a correct outcome, not a failure, and it costs nothing.'
  );
}
