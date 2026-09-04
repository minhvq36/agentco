
/**
 * THE "SAVED TO" BLOCK — the only thing allowed to make a path clickable.
 *
 * Both halves of the 05/09 incident (`P-260905-0100-zquw`) are locked here.
 * The run wrote TWO real files and the chat offered ZERO buttons:
 *
 *   T-01  deliver: file   built its report with a PowerShell one-liner
 *                         ⇒ `landed` = [external, command], no `file` at all
 *   T-02  deliver: reply  wrote through `Write`, landed a real `file`
 *                         ⇒ discarded, because the gate dropped the whole
 *                           RECEIPT of any task carrying an `answer`
 *
 * Two independent causes, and either one alone would have left one file
 * listed — which is why neither was noticed until they fired together.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { filesOnDisk } from '../dist/core/worker.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core');
const office = (): string => fs.readFileSync(path.join(SRC, 'office.ts'), 'utf8');

function withTempOffice(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-report-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('🔴 a file written through the SHELL is still recoverable — from the promised output', () => {
  withTempOffice((dir) => {
    const rel = 'artifacts/P-260905-0100-zquw/T-01/inventory.md';
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), '# table');

    // Exactly what T-01's receipt carried: an arm was used, a command ran,
    // and NOTHING says a file was written.
    const got = filesOnDisk(dir, [rel], [
      { kind: 'external', ref: 'a4fbabd0360' },
      { kind: 'command', ref: '' },
    ]);
    assert.deepEqual(got, [rel], 'the declared output is the second source, and it is the only one left');
  });
});

test('🔴 a promised output that was never actually written stays OUT', () => {
  withTempOffice((dir) => {
    const got = filesOnDisk(dir, ['artifacts/T-01/never-written.md'], [{ kind: 'command', ref: '' }]);
    assert.deepEqual(got, [], 'a promise is not evidence — `existsSync` is the gate');
  });
});

test('🔴 both tasks of the incident, listed together, each exactly once', () => {
  withTempOffice((dir) => {
    const t1 = 'artifacts/P-260905-0100-zquw/T-01/inventory.md';
    const t2 = 'artifacts/P-260905-0100-zquw/T-02/summary.md';
    for (const rel of [t1, t2]) {
      fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), 'x');
    }
    const got = filesOnDisk(dir, [t1, t2], [
      { kind: 'external', ref: 'a4fbabd0360' },
      { kind: 'command', ref: '' },
      { kind: 'file', ref: t2 }, // T-02 shows up in BOTH sources
    ]);
    assert.deepEqual(got.sort(), [t1, t2].sort());
  });
});

test('🔴 the reply gate asks about the SOLO run, never about a receipt having an `answer`', () => {
  const src = office();
  assert.doesNotMatch(
    src,
    /receipts\.filter\(\(r\) => !r\.answer\.trim\(\)\)/,
    'this is the filter that threw away T-02 — a mixed run must keep every receipt',
  );
  assert.match(
    src,
    /const quiet = status === 'stopped' \|\| soloReply;/,
    'the block is silenced by the shape of the run, not by one task having answered',
  );
});

test('🔴 the verified outputs actually REACH `whereBlock` — a field nobody passes is a field that lies', () => {
  const src = office();
  // outputStatus must answer both halves from one walk.
  assert.match(src, /private outputStatus\([\s\S]{0,200}\): \{ gone: string\[\]; landed: string\[\] \}/);
  assert.match(src, /const \{ gone, landed: wrote \} = this\.outputStatus\(plan, receipts\)/);
  // …and the value has to travel run() → finish() → whereBlock().
  assert.match(src, /quiet \? \[\] : wrote,/, 'finish() never receives it');
  assert.match(src, /this\.whereBlock\(receipts, wrote\)/, 'finish() receives it and drops it');
});

test('🔴 `whereBlock` does NOT grow its own copy of the merge', () => {
  const src = office();
  assert.match(
    src,
    /const files = new Set\(filesOnDisk\(this\.loaded\.dir, wrote, landed\)\)/,
    'the promised/observed merge lives in worker.ts and is exported so there is only ever one of it',
  );
});
