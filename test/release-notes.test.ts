/**
 * Every release says what it changed, or it does not ship. → scripts/release-notes.ts
 *
 * ⚠ The last test runs the REAL command `npm version` runs, against the REAL
 * CHANGELOG.md and package.json: the gate that stops a release is only a gate
 * if the version being released right now passes it.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildNotes, changelogSection } from '../scripts/release-notes.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LOG = [
  '# Changelog',
  '',
  '## 0.2.9',
  '',
  '### Fixed',
  '- the thing',
  '',
  '## 0.2.8 — 2026-09-24',
  '',
  '- older thing',
  '',
  '## 0.2.7',
  '',
].join('\n');

test('the section runs from its heading to the next one, and nowhere else', () => {
  assert.equal(changelogSection(LOG, '0.2.9'), '### Fixed\n- the thing');
  assert.equal(changelogSection(LOG, '0.2.8'), '- older thing');
});

test('a version that is absent, or a heading with nothing under it, says nothing — null', () => {
  assert.equal(changelogSection(LOG, '0.3.0'), null);
  assert.equal(changelogSection(LOG, '0.2.7'), null, 'an empty heading is not a changelog');
});

test('0.2.8 does not match 0.2.80, and `[0.2.8]` / `v0.2.8` headings are accepted', () => {
  assert.equal(changelogSection('## 0.2.80\n- no', '0.2.8'), null);
  assert.equal(changelogSection('## [0.2.8]\n- yes', '0.2.8'), '- yes');
  assert.equal(changelogSection('## v0.2.8\n- yes', '0.2.8'), '- yes');
  assert.equal(changelogSection('## 0.2.8\r\n- crlf\r\n', '0.2.8'), '- crlf');
});

test('what changed comes first, then the fixed text with the checksum filled in', () => {
  const body = buildNotes('intro\n{{SHA256}}\n', '- the thing', '0.2.9', 'abc123');
  assert.ok(body.startsWith("## What's new in 0.2.9\n\n- the thing"));
  assert.ok(body.includes('intro\nabc123'));
  assert.ok(!body.includes('{{SHA256}}'));
});

test('🔴 the version in package.json right now passes the gate `npm version` runs', () => {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/release-notes.ts', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
