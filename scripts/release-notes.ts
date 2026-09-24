/**
 * 🔴 EVERY RELEASE SAYS WHAT CHANGED, OR IT DOES NOT SHIP. (the user's call,
 * 24/09/2026)
 *
 * Until 0.2.7 the GitHub release body was `.github/release-notes.md` alone —
 * the same introduction, requirements and checksum on every version. Nine
 * releases in ten days, and the only way to learn what 0.2.6 fixed was to read
 * commits. *"Stacking releases blind is not how it should be."*
 *
 * So `CHANGELOG.md` holds one `## <version>` section per release, and this
 * script puts that section at the top of the release body. It REFUSES when the
 * section is missing, in two places, both deterministic:
 *
 *   · `npm version` — the `version` lifecycle script runs `--check` after the
 *     number is bumped and before the commit and tag exist, so a missing
 *     section stops the release on the maintainer's machine, where it costs
 *     nothing.
 *   · `release.yml` — builds the body with it, so a tag pushed some other way
 *     still cannot publish a release that says nothing.
 *
 * ⚠ It runs on the Windows runner under the pinned node 22, as raw `.ts`
 * (`--experimental-strip-types`), like `scripts/package.ts`: no imports
 * beyond `node:*`.
 *
 * Usage:
 *   node --experimental-strip-types scripts/release-notes.ts --check
 *   node --experimental-strip-types scripts/release-notes.ts --sha256 <hex> --out notes.md
 * The version is always `package.json#version` — ONE NUMBER, docs/CLAUDE.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The body of `## <version>` — up to the next `## ` heading. Accepts
 * `## 0.2.8`, `## [0.2.8]` and a trailing date (`## 0.2.8 — 2026-09-24`).
 * `null` when absent OR empty: a heading with nothing under it says nothing,
 * which is the failure this file exists to stop.
 */
export function changelogSection(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/);
  const esc = version.replace(/\./g, '\\.');
  const head = new RegExp(`^##\\s+\\[?v?${esc}\\]?(\\s|$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  return body || null;
}

/** What changed first — that is what a returning reader came for — then the fixed text. */
export function buildNotes(template: string, section: string, version: string, sha256: string): string {
  return `## What's new in ${version}\n\n${section}\n\n---\n\n${template.replace('{{SHA256}}', sha256)}`;
}

function main(argv: string[]): number {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const version = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;
  const file = path.join(root, 'CHANGELOG.md');
  const section = fs.existsSync(file) ? changelogSection(fs.readFileSync(file, 'utf8'), version) : null;

  if (!section) {
    console.error(
      `CHANGELOG.md has no section for ${version}. Write "## ${version}" and what changed, ` +
        `in words a user reads — then release. Every release says what it changed.`,
    );
    return 1;
  }
  if (argv.includes('--check')) {
    console.log(`CHANGELOG.md has a section for ${version}.`);
    return 0;
  }

  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sha = arg('--sha256');
  const out = arg('--out');
  if (!sha || !out) {
    console.error('usage: release-notes.ts --check | --sha256 <hex> --out <file>');
    return 2;
  }
  const template = fs.readFileSync(path.join(root, '.github', 'release-notes.md'), 'utf8');
  fs.writeFileSync(out, buildNotes(template, section, version, sha), 'utf8');
  console.log(`release notes for ${version} written to ${out}`);
  return 0;
}

// Run only as a script — the test imports the two functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
