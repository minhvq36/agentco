/**
 * THE APP'S VERSION — one source of truth, and it is `package.json`.
 * → docs/SPEC-packaging.md §1
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ 🔴 IT USED TO LIVE IN TWO PLACES, AND THE UPDATER'S WHOLE JOB IS TO
 * │ COMPARE THIS NUMBER. (found 10/09, while specifying packaging)
 * │
 * │   src/server/server.ts §pkgVersion()   read package.json     ← the truth
 * │   src/cli/index.ts:155  version: '0.0.1'                     ← hand-typed
 * │
 * │ So `daemon.json` carried a version nobody ever updated, while `/healthz`
 * │ carried the real one. Nothing broke, because nothing read `daemon.json`'s
 * │ copy yet — and that is exactly the shape this repository keeps paying for:
 * │ a second copy of one fact, sitting quietly correct-looking, waiting for
 * │ the day something starts trusting it. That day is the update channel.
 * │
 * │ ⚠ Two copies of a table drift. There is no version of "be careful" that
 * │ fixes it; there is only having one copy. → `CONTRIBUTING.md`
 * └──────────────────────────────────────────────────────────────────────────
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Read once and remember. The file cannot change while the process runs, and a
 * version string is asked for on every `/healthz` — which is polled.
 */
let cached: { version: string; name: string } | undefined;

function manifest(): { version: string; name: string } {
  if (cached !== undefined) return cached;
  try {
    // `dist/core/version.js` → the package root is two levels up. Same depth as
    // `dist/server/`, which is where this function used to live.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../../package.json'), 'utf8')) as {
      version?: string;
      name?: string;
    };
    cached = { version: pkg.version ?? '0.0.0', name: pkg.name ?? '' };
  } catch {
    cached = { version: '0.0.0', name: '' };
  }
  return cached;
}

/**
 * What npm knows this package as. Same file, same read, same reason: `agentco
 * update` has to name the package, and a name typed a second time in the CLI is
 * a name that survives a rename of the first one.
 */
export function packageName(): string {
  return manifest().name;
}

/**
 * ⚠ `'0.0.0'` on failure, NOT a throw and not the real version.
 *
 * The only way this fails is a broken install (no `package.json` beside `dist/`),
 * and at that point refusing to start would replace a working daemon with a stack
 * trace over a cosmetic string. `0.0.0` sorts below every real release, so an
 * update check on a broken install offers an upgrade rather than claiming to be
 * current — the safe direction of the two.
 */
export function appVersion(): string {
  return manifest().version;
}
