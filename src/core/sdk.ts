/**
 * THE ONLY DOOR TO `query()`. → `claude-code.ts` · docs/SPEC-packaging.md §2
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ 🔴 WHY A WRAPPER AND NOT "REMEMBER TO PASS IT IN SIX PLACES".
 * │
 * │ `pathToClaudeCodeExecutable` has to reach EVERY call or the packaged build
 * │ does nothing on that path — and there were six call sites across five
 * │ modules (`worker` ×2, `probe` ×2, `assistant`, `energy`, `doctor`). Six
 * │ places to remember is six places to forget, and the seventh gets added by
 * │ somebody who never read this file.
 * │
 * │ ⚠ AND THE FORGETTING IS INVISIBLE ON A DEVELOPER MACHINE. There, the SDK
 * │ finds its own optional package in `node_modules` and the missing option
 * │ changes nothing. It only shows up on a customer's machine, as "agentco
 * │ does not answer". That is the exact shape this repository keeps paying
 * │ for, so it is closed with a mechanism instead of a convention:
 * │ `test/sdk-door.test.ts` fails the day another module imports `query`
 * │ straight from the SDK.
 * └──────────────────────────────────────────────────────────────────────────
 *
 * ⚠ It adds NOTHING else. No retries, no logging, no defaults. A wrapper that
 * starts making decisions becomes a second place where behaviour lives, and the
 * call sites stop being readable on their own.
 */

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import { resolveClaudeCode } from './claude-code.js';

type QueryInput = Parameters<typeof sdkQuery>[0];

/**
 * `query()`, with the executable filled in.
 *
 * ⚠ An explicit `pathToClaudeCodeExecutable` from the caller WINS. `probeArm`
 * and the future installer both have reasons to point somewhere specific, and a
 * wrapper that overrode its caller would be lying about what it does.
 *
 * ⚠ Not found ⇒ pass NOTHING and let the SDK raise its own error. It names the
 * two ways out (`--omit=optional`, or set the path) far better than a guess of
 * ours would, and inventing a path here would turn "not installed" into
 * "installed but broken" — a worse sentence for the person reading it.
 */
export function query(input: QueryInput): ReturnType<typeof sdkQuery> {
  const options = input.options ?? {};
  if (options.pathToClaudeCodeExecutable) return sdkQuery(input);

  const found = resolveClaudeCode();
  if (!found) return sdkQuery(input);

  return sdkQuery({
    ...input,
    options: { ...options, pathToClaudeCodeExecutable: found.path },
  });
}
