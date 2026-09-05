/**
 * STRIPPING QUERY STRINGS FROM URLS IN THE BROWSER'S CONSOLE LOG.
 * → `arms/browser.ts` · docs/TEST-WALKTHROUGH.md walkthrough 18
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A REAL CASE, READ OFF DISK 29/08 — `.playwright-mcp/console-*.log`:      │
 * │                                                                          │
 * │   …/ajax/bnzai?…&fb_dtsg=AbCdEfGhIjKlMn_…&__user=100000000000001&…       │
 * │                                                                          │
 * │ That is A SESSION KEY IN PLAIN TEXT, sitting inside the office folder —   │
 * │ where an employee can `Read` it. Meanwhile THE COOKIES ARE GUARDED        │
 * │ (`<office>/.state/browser/profile`, inside `guardedZone`).                │
 * │                                                                          │
 * │ ⇒ The class of bug to recognise: SOMETHING DERIVED FROM A SENSITIVE       │
 * │ ASSET DOES NOT INHERIT ITS PROTECTION. The key store is guarded; the      │
 * │ record ABOUT the keys is not.                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 CUT BY SHAPE, NEVER FILTER BY NAME. (settled 29/08)                    │
 * │                                                                           │
 * │ A list of names (`fb_dtsg` · `access_token` · `sig` · `sessionid`…) is a  │
 * │ DENYLIST: it SILENTLY misses every name nobody thought of, and the        │
 * │ eleventh vendor will have one. The [[agentco-silent-allowlist]] family.   │
 * │                                                                           │
 * │ *"Keep scheme + host + path, throw the rest away"* is correct for EVERY   │
 * │ vendor, with no need to know which parameter is a secret. And for         │
 * │ debugging value, `…/ajax/bnzai` already says enough — that 400-character  │
 * │ query never helped anyone read a log.                                     │
 * │                                                                           │
 * │ ⚠ Cut at `?` OR `#`, whichever comes first: implicit-flow OAuth tokens    │
 * │ live after `#`, and a rule that only watches `?` misses the most          │
 * │ dangerous kind.                                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠⚠ THIS IS MITIGATION, NOT A SEAL — and that sentence has to stay in the code:
 * a token inside the BODY of a message (`[LOG] token=abc…`) is caught by no
 * shape rule at all. Sealing it would mean deleting the whole file, at the cost
 * of being able to debug a page. Do not read this function as a promise it never
 * made.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * URLs in a console log. Stops at whitespace and at a few common wrapping
 * characters (`"` `'` `<` `>` `)`), because a log is free text, not JSON.
 */
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

/**
 * Cut the query/fragment off every URL in a block of text.
 *
 * ⚠ INVARIANT: IDEMPOTENT. Running it twice must give the same result — the hook
 * can rescan the same file, and a cleaning function that is not idempotent eats
 * further into the content on each pass until the file is empty and nobody can
 * say why.
 */
export function cutQuery(text: string): string {
  return text.replace(URL_RE, (u) => {
    const i = Math.min(
      ...[u.indexOf('?'), u.indexOf('#')].filter((n) => n >= 0).concat([u.length]),
    );
    return u.slice(0, i);
  });
}

/** Console logs only. Snapshots (`page-*.yml`) MUST NOT be touched — workers read them. */
const isConsoleLog = (name: string): boolean => name.startsWith('console-') && name.endsWith('.log');

/**
 * Per-directory scan watermark — so the hook does not re-read old files on every
 * single tool call.
 *
 * In RAM: lost on daemon restart, and the first scan afterwards costs one extra
 * pass over the old files — far cheaper than a watermark file on disk that would
 * need its own cleanup mechanism.
 */
const seen = new Map<string, number>();

/** Per-file read ceiling. A console log larger than this is no longer a log anyone reads. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Clean the browser output folder of ONE office.
 *
 * ⚠ CHEAP IS A REQUIREMENT, not a preference: this runs after EVERY TOOL CALL,
 * including the many that have nothing to do with a browser. Four gates, cheapest
 * first:
 *   ① the directory does not exist ⇒ return immediately (true of almost every office)
 *   ② `console-*.log` only
 *   ③ only files whose `mtime` is NEWER than the last scan
 *   ④ only write back when the content ACTUALLY changed
 *
 * Returns how many files were edited — so tests can count, and so the hook has
 * something to log.
 */
export function redactBrowserLogs(officeDir: string, now = Date.now()): number {
  const dir = path.join(officeDir, '.playwright-mcp');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0; // ① no directory — the common case, and the cheapest
  }

  const since = seen.get(dir) ?? 0;
  let changed = 0;
  for (const name of names) {
    if (!isConsoleLog(name)) continue; // ②
    const file = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (st.mtimeMs <= since || st.size > MAX_BYTES) continue; // ③
    try {
      const before = fs.readFileSync(file, 'utf8');
      const after = cutQuery(before);
      if (after !== before) {
        // ④ overwrite in place: this is our own log, nobody is mid-read on it,
        // so it does not need the atomic write path the key store uses.
        fs.writeFileSync(file, after, 'utf8');
        changed++;
      }
    } catch {
      /* file locked or just deleted — skip it; the next scan picks it up */
    }
  }
  seen.set(dir, now);
  return changed;
}

/** For tests: forget the scan watermarks. */
export function resetRedactMarks(): void {
  seen.clear();
}
