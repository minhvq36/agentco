/**
 * 🔴 `agentco --version` USED TO ANSWER "There is no command '--version'" AND
 * EXIT 2. (found 17/09/2026, by a person trying to tell 0.1.2 from 0.1.3)
 *
 * The number was never missing: `appVersion()` already wrote it into
 * `daemon.json` and compared it against the update channel. There was no door,
 * so the only way to answer "which version am I on" was to infer it from which
 * files happened to exist — and absence is not a signal. It matters most right
 * after `agentco update`, which otherwise offers no way to see whether it did
 * anything.
 *
 * ⚠ ALL FOUR SPELLINGS, because people type all four and a tool that accepts
 * one of them has not solved the problem for the person who typed another.
 *
 * ⚠ Synchronous throughout — no sockets, no awaits. The runner cancels pending
 * tests whenever the event loop drains. → `test/port.test.ts`
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { NPM_UPDATE_COMMAND } from '../dist/core/update-links.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli', 'index.js');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };

/**
 * ⚠ A COMPANY OF ITS OWN, IN ENGLISH. (flaked 24/09/2026)
 *
 * It used to only delete `AGENTCO_COMPANY_DIR`, which sends the CLI to
 * `<cwd>/company` — the developer's own dev company, whose `language` decides
 * the words this test matches. The suite went red mid-session the moment that
 * company was touched from the UI, with nothing in the change under test
 * involved. A developer with several companies lying around hits this at
 * random. So the test brings its own, and matches English on purpose.
 */
const COMPANY = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-version-'));
fs.writeFileSync(path.join(COMPANY, 'company.yaml'), 'language: en\n', 'utf8');

function run(args: string[]): { out: string; code: number | null } {
  const env = { ...process.env, AGENTCO_COMPANY_DIR: COMPANY };
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 60_000 });
  return { out: r.stdout + r.stderr, code: r.status };
}

test('🔴 every spelling of "what version are you" answers, and exits 0', () => {
  for (const spelling of ['version', '--version', '-v', '-V']) {
    const r = run([spelling]);
    assert.equal(r.code, 0, `\`agentco ${spelling}\` exited ${r.code}:\n${r.out}`);
    assert.match(r.out, new RegExp(`agentco ${PKG.version.replace(/\./g, '\\.')}`), r.out);
  }
});

test('it also says WHICH COPY — the other half of the question', () => {
  const out = run(['version']).out;

  // The door it came through: two installs of two versions on one machine is
  // the ordinary case, not the exotic one.
  assert.match(out, /installed (with npm|from the app installer)/, out);

  // And the path, because "which version" and "which copy" have different
  // answers wherever nvm, volta or a second prefix is involved.
  assert.ok(
    out.includes(path.resolve(ROOT)),
    `the package root is not in the output:\n${out}`,
  );
});

test('the help text offers the command it now has', () => {
  assert.match(run(['help']).out, /agentco version/, 'help does not mention `version`');
});

test('🔴 the update banner names the command this product ships', () => {
  /*
   * It named the raw `npm i -g …@latest` line for one release after
   * `agentco update` existed. The banner is the only place that tells anyone
   * the command is there, so a feature not named here is a feature nobody
   * finds. → core/update-links.ts
   */
  assert.equal(NPM_UPDATE_COMMAND, 'agentco update');
});
