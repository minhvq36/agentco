/**
 * 🔴 A FLAG'S VALUE MUST NOT COME BACK AS TEXT. (found 25/09/2026, while measuring)
 *
 * `run` and `office new` rebuilt their text by dropping every `--word` and
 * keeping the rest — but the word AFTER a flag had already been taken as its
 * value, and the filter put it back. `agentco run "task" --office sales` sent
 * "task sales" to the model; `--dir` sent a folder path. → cli/index.ts §splitArgs
 *
 * `office new` is the $0 witness: the name is written to disk, readable
 * without a model.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli', 'index.js');

function cli(args: string[]) {
  const env = { ...process.env };
  delete env['AGENTCO_COMPANY_DIR'];
  return spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 60_000 });
}

test('`office new "Sales" --dir <path>` names the office "Sales", not "Sales <path>"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-args-'));
  const init = cli(['init', '--dir', dir, '--lang', 'en']);
  assert.equal(init.status, 0, init.stdout + init.stderr);

  const made = cli(['office', 'new', 'Sales', '--dir', dir]);
  assert.equal(made.status, 0, made.stdout + made.stderr);

  const listed = cli(['office', 'list', '--dir', dir]).stdout;
  assert.match(listed, /\bSales\b/, listed);
  assert.ok(!listed.includes(dir), `the --dir value leaked into the office name:\n${listed}`);
});
