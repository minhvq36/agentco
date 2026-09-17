/**
 * Where the suite is allowed to run. → `.github/workflows/npm-smoke.yml`
 *
 * ┌────────────────────────────────────────────────────────────────────────────
 * │ 🔴 FOR MONTHS THE FILE LOOKED COVERED AND WAS NOT. `npm-smoke.yml` installs
 * │ the package on Linux, macOS and Windows and always has — so a reader sees
 * │ three operating systems and stops reading. But that is the SMOKE job. The
 * │ job that runs the 1244-test suite sat on `windows-latest` alone, in both
 * │ workflows, and nobody noticed because the file above it said "all three".
 * │ (opened up 18/09/2026)
 * │
 * │ The two ask different questions, and the difference is the whole point:
 * │   SMOKE  — does an installed package start and answer?  (~8 commands)
 * │   SUITE  — is the logic right?                          (1244 tests)
 * │ Only the first was ever asked off Windows. `core/paths.ts:289` is the
 * │ standing example of what that hides: macOS normalises filenames to NFD
 * │ where Linux and Windows keep NFC, so one Vietnamese name is two different
 * │ byte strings — and no amount of Windows CI can say so.
 * └────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ THIS IS A COMMENT THAT CAN FAIL, which is the only reason it is a file and
 * not a paragraph. The change it guards is one word long: someone trims the
 * matrix back to `windows-latest` to save CI minutes, every test still passes,
 * and the coverage is gone with no symptom until a macOS user reports it.
 * → [[agentco-detect-fix-pair-scope]]
 *
 * ⚠ Everything is synchronous. The runner cancels pending tests whenever the
 * event loop drains. → `test/port.test.ts`
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Job {
  'runs-on'?: string;
  needs?: string[];
  uses?: string;
  strategy?: { 'fail-fast'?: boolean; matrix?: { os?: string[] } };
  steps?: Array<{ run?: string; uses?: string }>;
}
interface Workflow {
  jobs: Record<string, Job>;
}

/**
 * ⚠ Parsed, not grepped. `runs-on: windows-latest` appears in this repo's
 * workflows more than once, so a regex over the text would happily pass while
 * reading a different job. The invariant is about a named job, so the reader
 * has to be able to name it too.
 *
 * ⚠ And `on:` survives as the string `"on"` here — the `yaml` package is YAML
 * 1.2, where the 1.1 rule that turned `on` into the boolean `true` is gone.
 * Measured before relying on it, because the failure mode is a silent
 * `undefined` that makes a gate pass for the wrong reason.
 */
const workflow = (name: string): Workflow =>
  YAML.parse(fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8')) as Workflow;

const SMOKE_WF = workflow('npm-smoke.yml');
const RELEASE_WF = workflow('release.yml');

const THREE = ['linux', 'macos', 'windows'];
const family = (runner: string): string => runner.replace(/^ubuntu/, 'linux').split('-')[0]!;

test('🔴 the SUITE runs on all three operating systems, not just the one it was written on', () => {
  const job = SMOKE_WF.jobs['test'];
  assert.ok(job, 'npm-smoke.yml has no `test` job — the suite gate was renamed or removed');

  const os = job.strategy?.matrix?.os ?? (job['runs-on'] ? [job['runs-on']] : []);
  assert.deepEqual(
    [...new Set(os.map(family))].sort(),
    THREE,
    `the suite runs on ${JSON.stringify(os)} — a platform bug on the missing one cannot be seen from here`,
  );

  // It has to actually run the suite. A matrix over three machines that no
  // longer calls `npm test` is the same hole wearing the same name.
  assert.ok(
    job.steps?.some((s) => s.run === 'npm test'),
    'the `test` job no longer runs `npm test`',
  );
});

test('one red leg must not cancel the other two — the first run IS the list', () => {
  /*
   * `fail-fast` defaults to TRUE, so this is not a style preference: leave it
   * out and the first platform to fail kills its siblings mid-run. That is
   * precisely backwards for this job, whose value on any given day is the
   * COMPARISON between three legs. A single "windows passed, macos cancelled"
   * tells you less than either leg alone.
   */
  assert.equal(
    SMOKE_WF.jobs['test']?.strategy?.['fail-fast'],
    false,
    'set `fail-fast: false` — otherwise a Linux failure hides whether macOS was fine',
  );
});

test('the suite and the smoke run cover the SAME three systems — they must not drift apart', () => {
  const suite = SMOKE_WF.jobs['test']?.strategy?.matrix?.os ?? [];
  const smoke = SMOKE_WF.jobs['smoke']?.strategy?.matrix?.os ?? [];
  assert.ok(smoke.length, 'npm-smoke.yml has no `smoke` matrix');
  assert.deepEqual(
    [...new Set(suite.map(family))].sort(),
    [...new Set(smoke.map(family))].sort(),
    'one job gained or lost a platform without the other — a package that installs somewhere its logic was never checked',
  );
});

test('⭐ and it is a RELEASE GATE, not a report: nothing reaches npm without it', () => {
  /*
   * The chain, so that breaking any link fails here rather than at the one
   * moment a version number is being spent:
   *   release.yml › `npm` needs `smoke` › `smoke` is this whole workflow ›
   *   this workflow contains the three-OS `test` job asserted above.
   */
  const smokeJob = RELEASE_WF.jobs['smoke'];
  assert.equal(
    smokeJob?.uses,
    './.github/workflows/npm-smoke.yml',
    'release.yml no longer calls npm-smoke.yml, so the three-OS suite is not on the release path',
  );
  assert.ok(
    RELEASE_WF.jobs['npm']?.needs?.includes('smoke'),
    'the npm publish job no longer waits for the smoke workflow',
  );
});

test('a change to this workflow re-runs it — a gate that never fires is not a gate', () => {
  /*
   * Editing the matrix has to prove itself. Without the file in its own
   * `paths:` list, widening the matrix would land on `main` and simply not
   * run until somebody happened to touch `src/`.
   */
  const paths = (SMOKE_WF as unknown as { on?: { push?: { paths?: string[] } } }).on?.push?.paths;
  assert.ok(paths?.length, 'npm-smoke.yml has no `on.push.paths` — `on` may have parsed as a boolean');
  assert.ok(
    paths.includes('.github/workflows/npm-smoke.yml'),
    'the workflow does not watch itself',
  );
});
