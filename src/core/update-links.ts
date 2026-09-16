/**
 * What the update banner says and where it points — COMPILED IN, never read
 * from the manifest. → docs/SPEC-packaging.md §3.6
 *
 * 🔴 The manifest contributes exactly one fact, a version number. The link and
 * the command live here, so a forged manifest can lie about a number and send
 * nobody anywhere.
 *
 * ⚠ Pure — no `node:*` — because the web UI imports it through `@core`. The
 * checker that fetches and verifies is `update-check.ts`, which the UI never
 * loads.
 */

export const MANIFEST_URL = 'https://agent-co.app/releases/stable.json';

/** Where a packaged (Windows installer) user goes for the new version. */
export const WEBSITE_URL = 'https://agent-co.app';

/**
 * The installer itself, one click from the banner.
 *
 * 🔴 OUR DOMAIN, NEVER GITHUB'S. `agent-co.app/_redirects` decides what this
 * resolves to today; baking the vendor URL into every installed copy would be a
 * promise we could not move. → SPEC-packaging §3.6
 *
 * It used to be `WEBSITE_URL`, which left the person who clicked on the home
 * page to find the download button themselves — four steps where two will do.
 * The npm door got its one command in 0.1.4; this is the nearest thing the
 * installer door has until the update button exists.
 */
export const DOWNLOAD_URL = `${WEBSITE_URL}/download`;

/**
 * What an npm user runs.
 *
 * 🔴 IT WAS `npm i -g @agent-co-app/cli@latest` UNTIL 0.1.5, which was still
 * true and no longer the answer. `agentco update` shipped in 0.1.4 — it stops
 * the daemon, hands the install to a process outside the package so npm is not
 * replacing the code that is running, and starts the company again. The banner
 * is the ONLY place that tells anyone the command exists, and it went on
 * naming the raw npm line: a feature built and then not wired to its own door.
 */
export const NPM_UPDATE_COMMAND = 'agentco update';

/**
 * `packaged` — the Windows installer's tree (`app/<version>/` beside
 * `runtime/`). `npm` — everything else: a global npm install or a source
 * checkout.
 */
export type InstallKind = 'packaged' | 'npm';

/** `GET /api/update`. */
export interface UpdateView {
  current: string;
  latest?: string;
  available: boolean;
  kind: InstallKind;
  /**
   * An update is being applied RIGHT NOW.
   *
   * 🔴 IT LIVES ON THE SERVER BECAUSE THE PAGE FORGETS. (found 17/09/2026, by
   * changing the language mid-update) The "updating…" state used to be React
   * state, so anything that remounted the component — a language switch, a
   * closed panel, a reload — brought the button back as if nothing were
   * happening. Pressing it again got a 409 and the page then said "nothing
   * changed", which was a lie told while the update was working.
   *
   * Work in progress is STATE, not a notification, and it belongs to whoever
   * can still see it after the page has forgotten. → SPEC-ui.md
   */
  applying: boolean;
}
