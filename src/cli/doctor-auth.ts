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
  /** Why it is not ok, in the SDK's words or `sayError`'s. */
  note?: string;
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
  try {
    for await (const msg of start()) {
      const m = msg as Record<string, unknown> | null;
      if (!m || m['type'] !== 'result') continue;
      const raw = resultFailure(m);
      ok = raw === undefined;
      note = raw === undefined ? undefined : sayError(raw, classifyError(raw));
    }
  } catch (err) {
    ok = false;
    if (aborted()) return { ok: false, timedOut: true };
    // The result's own sentence, when there was one, says it better than the
    // SDK's wrapper around it ("Claude Code returned an error result: …").
    note ??= err instanceof Error ? err.message : String(err);
  }
  return { ok, ...(note ? { note } : {}) };
}
