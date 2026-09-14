/**
 * 🔴 THE CLI SPEAKS THE COMPANY'S LANGUAGE ON EVERY COMMAND, NOT ONLY ON `start`.
 *
 * Measured 14/09 on a packed npm install: `language: en` in company.yaml,
 * `start` in English, `status`/`stop`/`doctor` in Vietnamese — because the
 * locale was only set while loading the config, and those commands never load
 * it. → `core/config.ts §adoptInterfaceLocale`
 *
 * The first test asks the CHILD what it printed rather than calling the
 * function: the bug was never in the function, it was in which commands
 * reached it.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { adoptInterfaceLocale } from '../dist/core/config.js';
import { getLocale, setLocale } from '../dist/i18n/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli', 'index.js');

const ENV_KEYS = ['AGENTCO_LANGUAGE', 'LC_ALL', 'LC_MESSAGES', 'LANG', 'AGENTCO_COMPANY_DIR'] as const;

function company(yaml: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-locale-'));
  if (yaml !== null) fs.writeFileSync(path.join(dir, 'company.yaml'), yaml, 'utf8');
  return dir;
}

function status(dir: string): string {
  const env = { ...process.env };
  for (const k of ENV_KEYS) delete env[k];
  const r = spawnSync(process.execPath, [CLI, 'status', '--dir', dir], { env, encoding: 'utf8' });
  return r.stdout + r.stderr;
}

/** Run with a clean set of language variables, and put everything back. */
function withEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void): void {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const locale = getLocale();
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, vars);
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    setLocale(locale);
  }
}

test('🔴 `status` — which never loads the config — answers in the language company.yaml names', () => {
  const out = status(company('language: en\n'));
  assert.match(out, /The company is not running\./);
});

test('…and the other way round, so the test cannot pass by printing English always', () => {
  const out = status(company('language: vi\n'));
  assert.match(out, /Công ty không chạy\./); // i18n-allow-vietnamese: the Vietnamese catalogue is the thing under test
});

test('a company.yaml with no `language` stays Vietnamese — existing installs are not re-languaged', () => {
  withEnv({ LC_ALL: 'en_US.UTF-8' }, () => {
    adoptInterfaceLocale(company('name: Old\n'));
    assert.equal(getLocale(), 'vi');
  });
});

test('no company yet (`doctor` before `init`) follows the OS, like `init` does', () => {
  withEnv({ LC_ALL: 'en_US.UTF-8' }, () => {
    adoptInterfaceLocale(company(null));
    assert.equal(getLocale(), 'en');
  });
  withEnv({ LC_ALL: 'vi_VN.UTF-8' }, () => {
    adoptInterfaceLocale(company(null));
    assert.equal(getLocale(), 'vi');
  });
});

test('AGENTCO_LANGUAGE outranks the file, as every other AGENTCO_ variable does', () => {
  withEnv({ AGENTCO_LANGUAGE: 'en' }, () => {
    adoptInterfaceLocale(company('language: vi\n'));
    assert.equal(getLocale(), 'en');
  });
});

test('a company.yaml that does not parse does not throw from here — the loading command reports it', () => {
  withEnv({}, () => {
    assert.doesNotThrow(() => adoptInterfaceLocale(company('language: [unclosed\n')));
    assert.equal(getLocale(), 'vi');
  });
});
