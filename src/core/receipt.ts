/**
 * The receipt protocol — the core contract between a worker and the assistant.
 *
 * → docs/SPEC-2026-08-14-agentco.md §4
 *
 * INVARIANT: not one byte of a worker's raw transcript enters the assistant's
 * context. The assistant sees exactly this object, capped at 800 tokens.
 *
 * One mechanism serving BOTH goals: saving tokens, and the "simple by default,
 * advanced on demand" experience — because `say` is produced by the worker
 * itself, costing no extra LLM call to make it friendly.
 */

import { ReceiptSchema, type ReceiptBody } from './types.js';
import { estimateJsonTokens, truncateToTokens } from './tokens.js';

export interface ParseResult {
  ok: boolean;
  receipt?: ReceiptBody;
  /** Why parsing failed, used as the repair prompt. */
  problem?: string;
}

/**
 * Pull the receipt JSON out of a worker's final text.
 * Several strategies before giving up — each surrender costs a paid repair call.
 */
export function parseReceipt(text: string): ParseResult {
  const candidates: string[] = [];

  // 1. a ```json … ``` block — take the LAST one (models often show an example first)
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n?```/g)];
  for (const m of fenced.reverse()) if (m[1]) candidates.push(m[1]);

  // 2. the last brace-balanced JSON object in the text
  const braced = lastBalancedObject(text);
  if (braced) candidates.push(braced);

  // 3. the whole text
  candidates.push(text);

  for (const raw of candidates) {
    let value: unknown;
    try {
      value = JSON.parse(raw.trim());
    } catch {
      continue;
    }
    const parsed = ReceiptSchema.safeParse(value);
    if (parsed.success) return { ok: true, receipt: normalize(parsed.data) };
    // Valid JSON but wrong schema — keep the reason; this is repairable
    return {
      ok: false,
      problem: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    };
  }

  return { ok: false, problem: 'no JSON object found in the final answer' };
}

/**
 * The ceiling for `answer` — COUNTED SEPARATELY, outside `receipt_tokens`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY A SEPARATE CEILING RATHER THAN RAISING THE OLD ONE.                  │
 * │                                                                          │
 * │ `receipt_tokens` (default 800) exists to protect THE ASSISTANT'S         │
 * │ CONTEXT. And `answer` NEVER enters it — it goes straight out to the chat │
 * │ for the human (`office.ts`). Raising the old ceiling to fit it would be  │
 * │ loosening the very guard on something that needs no guarding, and would  │
 * │ simultaneously let `say` (which DOES enter the assistant's context) grow │
 * │ with it. Two different lifetimes get two different ceilings.             │
 * │                                                                          │
 * │ ⚠ THE CONVERSION DEPENDS ON THE LANGUAGE, and `answer` follows whatever  │
 * │ language the human is writing in. Measured 03/09: ~3.98 chars/token in   │
 * │ English against ~2.6 in Vietnamese, so ~450 tokens is roughly 300        │
 * │ English words or 200 Vietnamese ones. Either way it fits a chat bubble   │
 * │ and a Telegram message, and is long enough for a policy answer that      │
 * │ cites its conditions. → docs/SPEC-token-economy.md                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const ANSWER_TOKENS = 450;

/**
 * The ceiling for `gist` — INSIDE `receipt_tokens`, the opposite of `ANSWER_TOKENS`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Every ceiling in this file answers one question: DOES THIS ENTER THE      │
 * │ ASSISTANT'S CONTEXT? `answer` does NOT ⇒ its own ceiling. `gist` DOES ⇒   │
 * │ it competes for room with `say` and `lessons`, with no exemption.         │
 * │                                                                           │
 * │ ⚠ And it enters that context ON EVERY REPORT, then passes through memory  │
 * │ compaction — so it is a RECURRING bill, the same class as `hint`. Settled │
 * │ 30/08: *"the prefix is accepted, but do not let the gist get so big that  │
 * │ both worker and assistant get worn out"*. 120 tokens is roughly 80        │
 * │ English words or 55 Vietnamese ones: enough for three sentences or four   │
 * │ bullets, and NOT enough to quietly become a full answer.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const GIST_TOKENS = 120;

/** Enforce the ceilings HARD. Over the line means trimmed, no negotiation. */
export function enforceCap(receipt: ReceiptBody, maxTokens: number): ReceiptBody {
  const out: ReceiptBody = { ...receipt };

  // `say` is what the human reads — favoured, but it still needs a ceiling
  out.say = truncateToTokens(out.say.replace(/\s+/g, ' ').trim(), Math.floor(maxTokens * 0.25));

  /**
   * ⚠ Do NOT collapse whitespace — same reason as `answer`: bullets are part of
   * the content, and the user said outright *"sometimes it is one bullet per
   * point"*.
   */
  out.gist = truncateToTokens(out.gist.trim(), GIST_TOKENS);

  /**
   * `answer` is trimmed FIRST, then EXCLUDED from the `estimateJsonTokens`
   * measurement.
   *
   * Leaving it inside the measurement means a long answer pushes `lessons` and
   * `say` over the ceiling — the customer's answer stealing the receipt's room,
   * when the two travel completely different routes.
   *
   * ⚠ Do NOT collapse whitespace the way `say` does: this is prose a person
   * reads, where line breaks and bullets are part of the content. `say` can be
   * collapsed because it is a single sentence running in a status line.
   */
  const answer = truncateToTokens(out.answer.trim(), ANSWER_TOKENS);

  // `lessons` bloats most easily: models like to write at length
  out.lessons = out.lessons.slice(0, 2).map((l) => ({
    kind: l.kind,
    text: truncateToTokens(l.text.replace(/\s+/g, ' ').trim(), 60),
  }));

  out.artifacts = out.artifacts.slice(0, 20);
  if (out.blocked_on) out.blocked_on = truncateToTokens(out.blocked_on, 80);

  // Measure what ENTERS THE ASSISTANT'S CONTEXT. `answer` does not; `gist` does.
  const measured = { ...out, answer: '' };
  /**
   * Sacrifice order — ask *"what is lost by losing this"*, not which is largest:
   *
   *   ① lessons — first to go, because a lesson only pays off on a LATER turn,
   *      while the two below are what the human reads right now.
   *   ② gist    — trimmed, never dropped: a shorter summary is still usable,
   *      while an empty one strips the assistant of every fact and sends it
   *      back to saying "open the file".
   *   ③ say     — touched last. It is the status line; losing it means a mute screen.
   */
  if (estimateJsonTokens(measured) > maxTokens) measured.lessons = out.lessons = [];
  if (estimateJsonTokens(measured) > maxTokens) {
    measured.gist = out.gist = truncateToTokens(out.gist, Math.floor(GIST_TOKENS / 2));
  }
  if (estimateJsonTokens(measured) > maxTokens) {
    out.say = truncateToTokens(out.say, Math.floor(maxTokens * 0.5));
  }

  out.answer = answer;
  return out;
}

/** The repair prompt when a worker returns the wrong shape. Deliberately carries NO role context — only the format matters. */
export function repairPrompt(badText: string, problem: string): string {
  const excerpt = truncateToTokens(badText, 1_500);
  return `The text below was supposed to be a task receipt in JSON, but it is malformed (${problem}).

Convert it into exactly one valid JSON object and output nothing else — no explanation, no code fence:

{"status":"done"|"failed"|"blocked"|"needs_human","say":"<one short sentence>","gist":"<key facts, or empty>","artifacts":[],"lessons":[],"blocked_on":null}

If the text shows the work failed, use status "failed" and say so honestly. Do not invent artifact paths.

--- TEXT ---
${excerpt}`;
}

// ─────────────────────────────────────────────────────────── helpers

function normalize(r: ReceiptBody): ReceiptBody {
  return {
    ...r,
    say: r.say.trim(),
    answer: r.answer.trim(),
    gist: r.gist.trim(),
    // paths from the LLM: normalise separators, drop a leading ./, deduplicate
    artifacts: [...new Set(r.artifacts.map((a) => a.trim().replace(/\\/g, '/').replace(/^\.\//, '')))].filter(Boolean),
  };
}

function lastBalancedObject(text: string): string | undefined {
  const end = text.lastIndexOf('}');
  if (end === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = end; i >= 0; i--) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '}') depth++;
    else if (ch === '{') {
      depth--;
      if (depth === 0) return text.slice(i, end + 1);
    }
  }
  return undefined;
}
