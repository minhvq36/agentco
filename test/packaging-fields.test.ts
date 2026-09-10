import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { appVersion } from '../dist/core/version.js';
import { CompanyConfigSchema } from '../dist/core/types.js';

/**
 * THE TWO FIELDS THAT CANNOT BE ADDED LATER. → docs/SPEC-packaging.md §1 · §5.1
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ Everything else in the packaging plan can be built when it is needed.
 * │ These two cannot, and they fail in opposite ways:
 * │
 * │  · `appVersion()` — the update channel's entire job is comparing this
 * │    number, and it used to exist TWICE (a hand-typed `'0.0.1'` in the CLI
 * │    beside a real one in the server). Nothing broke, because nothing read
 * │    the wrong copy yet. The day something does, it is the updater.
 * │
 * │  · `installed_at` — a future release cannot go back in time to learn who
 * │    arrived first. Ship v0 without it and that policy is gone for good.
 * │
 * │ ⚠ Both are guarded by reading what is ACTUALLY WRITTEN, not by trusting
 * │ that the source says the right thing: the template is rendered and parsed,
 * │ and the version is compared against `package.json` itself.
 * └──────────────────────────────────────────────────────────────────────────
 */

const ROOT = url.fileURLToPath(new URL('..', import.meta.url));

test('🔴 appVersion() IS package.json — not a literal that drifts beside it', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  assert.equal(appVersion(), pkg.version);
  // The fallback must sort BELOW every real release, so a broken install offers
  // an upgrade rather than claiming to be current.
  assert.notEqual(pkg.version, '0.0.0', 'premise: the real version is not the failure value');
});

test('🔴 no hand-typed version survives anywhere near the daemon file', () => {
  /**
   * Reading the source, because the failure mode is a SECOND copy appearing —
   * and a second copy is invisible to any test that only checks the first one.
   * `daemon.json` is what an updater reads to learn what is installed.
   */
  const cli = fs.readFileSync(path.join(ROOT, 'src', 'cli', 'index.ts'), 'utf8');
  const block = /writeDaemonFile\(pp, \{[\s\S]*?\}\);/.exec(cli);
  assert.ok(block, 'premise: writeDaemonFile is no longer called the way this test looks for it');
  assert.ok(
    /version: appVersion\(\)/.test(block[0]),
    'daemon.json must take the version from package.json, never from a literal',
  );
  assert.ok(
    !/version:\s*'[\d.]+'/.test(block[0]),
    'a hand-typed version is back in writeDaemonFile',
  );
});

test('🔴 `agentco init` writes installed_at, and it parses back as a date', async () => {
  /**
   * ⚠ Rendered and PARSED, not grepped. The template is a template literal with
   * interpolation in it; a field that renders as `installed_at: undefined` would
   * satisfy a grep for the key name and mean nothing.
   */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-init-'));
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, [path.join(ROOT, 'dist', 'cli', 'index.js'), 'init', '--dir', dir], {
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, AGENTCO_HEADLESS: '1' },
    });

    const yaml = fs.readFileSync(path.join(dir, 'company.yaml'), 'utf8');
    const m = /^installed_at:\s*(\S+)\s*$/m.exec(yaml);
    assert.ok(m, `a fresh company.yaml has no installed_at:\n${yaml.slice(0, 400)}`);
    assert.match(m[1]!, /^\d{4}-\d{2}-\d{2}$/, 'a DATE, not a timestamp — cohorts are decided by day');
    assert.ok(!Number.isNaN(Date.parse(m[1]!)), `"${m[1]}" is not a date`);

    // …and the schema can actually read it back. A field written but not declared
    // is a field nothing can ever use.
    const parsed = CompanyConfigSchema.parse({ installed_at: m[1] });
    assert.equal(parsed.installed_at, m[1]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 an ABSENT installed_at parses, and stays absent', () => {
  /**
   * A company created before the field existed is OLDER than every company that
   * has one — that is the correct reading, and it is why nothing backfills. A
   * default here would invent a date and write a guess into user data, which is
   * the failure `KnowledgeNode` avoids by carrying no `lang`.
   */
  const parsed = CompanyConfigSchema.parse({});
  assert.equal(parsed.installed_at, undefined, 'a default would date an install that has no date');
});
