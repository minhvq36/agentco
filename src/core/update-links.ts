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

/** What an npm user runs. The package name is the one in `package.json`. */
export const NPM_UPDATE_COMMAND = 'npm i -g @agent-co-app/cli@latest';

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
}
