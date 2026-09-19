/**
 * `doctor`'s sign-in check, as a function a test can feed. → cli/index.ts §cmdDoctor
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 ✓ IS EARNED BY A RESULT THAT CARRIES NO ERROR, AND LOST BY ANY THROW.  │
 * │ (14/09)                                                                  │
 * │                                                                          │
 * │ The old check set "signed in" from `subtype === 'success'` the moment a  │
 * │ result arrived. A rejected sign-in arrives exactly that way — `success`  │
 * │ with `is_error: true` — and the SDK throws a moment later; the `catch`   │
 * │ then replaced the NOTE and left the verdict alone. So `doctor` printed   │
 * │                                                                          │
 * │   ✓  Claude Code sign-in   Claude Code returned an error result: … 401 … │
 * │                                                                          │
 * │ and exited 0 — on six CI machines with nobody signed in, which is how it │
 * │ was found. Two premises failed at once: that `success` meant success,    │
 * │ and that a `catch` setting the note also resets the verdict. Both are    │
 * │ structure now: `ok` is written from `resultFailure` alone, and the       │
 * │ `catch` sets it false.                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ A throw AFTER a clean result still counts as a failure. Wrong in that
 * direction, somebody signs in again for nothing; wrong in the other, `doctor`
 * vouches for a login that does not work — on the one check that exists to
 * catch exactly that. → [[agentco-safe-default-direction]]
 *
 * ⚠ A CEILING, because a bad key is not answered quickly: measured 14/09, an
 * invalid API key kept `doctor` waiting more than three minutes before the 401
 * came back. Aborting this call is harmless — it writes nothing anywhere.
 */

import { classifyError, resultFailure, sayError } from '../core/worker.js';

export const SIGN_IN_PROBE_MS = 60_000;

export interface SignIn {
  ok: boolean;
  /** The ceiling was hit — nothing is known about the login either way. */
  timedOut?: boolean;
  /** Why it is not ok, in OUR words when we have a sentence for it. → `sayError` */
  note?: string;
  /**
   * The vendor's own words, kept ALONGSIDE `note` rather than replaced by it.
   *
   * ⚠ Two readers, two needs, and that is why both strings survive. `note` is
   * for the person deciding what to do next — it must never name something
   * they cannot run. `raw` is for the person pasting an error into a support
   * thread, where the vendor's exact phrasing is the useful half. `doctor`
   * prints ours and then this one in parentheses; the chat window prints only
   * ours. → `cli/index.ts §signInNote`
   *
   * Equal to `note` whenever `sayError` passed the text straight through, and
   * the caller drops the duplicate rather than printing one sentence twice.
   */
  raw?: string;
}

/**
 * `start` is a function, not a stream, so a `query()` that throws before its
 * first message — no executable, a bad option — lands in the same `catch`.
 */
export async function readSignIn(
  start: () => AsyncIterable<unknown>,
  aborted: () => boolean,
): Promise<SignIn> {
  let ok = false;
  let note: string | undefined;
  let vendor: string | undefined;
  try {
    for await (const msg of start()) {
      const m = msg as Record<string, unknown> | null;
      if (!m || m['type'] !== 'result') continue;
      const raw = resultFailure(m);
      ok = raw === undefined;
      note = raw === undefined ? undefined : sayError(raw, classifyError(raw));
      vendor = raw;
    }
  } catch (err) {
    ok = false;
    if (aborted()) return { ok: false, timedOut: true };
    // The result's own sentence, when there was one, says it better than the
    // SDK's wrapper around it ("Claude Code returned an error result: …").
    //
    // ⚠ CLASSIFIED HERE TOO, and this is the branch that used to leak: a throw
    // carries the same "Not logged in · Please run /login" as a failed result,
    // and only the result path was being read through `sayError`. One door was
    // fixed while its twin two lines down stayed open. → `worker.ts §sayError`
    if (note === undefined) {
      const msg = err instanceof Error ? err.message : String(err);
      note = sayError(msg, classifyError(msg));
      vendor = msg;
    }
  }
  /*
   * ⚠ `includes`, not `!==`. The first version dropped `raw` only when
   * `sayError` had passed the vendor text through UNCHANGED — but the `other`
   * branch WRAPS a machine code into a sentence (`wk.stopOther`), so the two
   * strings differ while one contains the other, and `doctor` printed
   * "Claude Code stopped part-way (error_during_execution). (error_during_execution)".
   * The question is whether the reader learns anything new from the second
   * string, and a substring never does. (found by review, 19/09/2026)
   */
  const extra = vendor && note && !note.includes(vendor) ? { raw: vendor } : {};
  return { ok, ...(note ? { note } : {}), ...extra };
}
