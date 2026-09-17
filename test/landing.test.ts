

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { filesOnDisk, landingOf, straysOnDisk, readUsage, warnDroppedTools } from '../dist/core/worker.js';
import { BUILTIN_TOOLS, effectiveTools, hasShell } from '../dist/core/types.js';

const OFFICE = path.resolve('/co/offices/spreadsheet');


test('landingOf: writing inside the office → `file` destination, relative path', () => {
  const spot = landingOf(OFFICE, {
    name: 'Write',
    input: { file_path: 'artifacts/P-01/T-01/result.md' },
  });
  assert.deepEqual(spot, { kind: 'file', ref: 'artifacts/P-01/T-01/result.md' });
});

test('landingOf: an absolute path INSIDE the office still normalizes to relative', () => {
  const abs = path.join(OFFICE, 'artifacts', 'P-01', 'T-01', 'result.md');
  const spot = landingOf(OFFICE, { name: 'Write', input: { file_path: abs } });
  assert.deepEqual(spot, { kind: 'file', ref: 'artifacts/P-01/T-01/result.md' });
});

test('landingOf: writing OUTSIDE the office → `outside`, NOT undefined', () => {
  const spot = landingOf(OFFICE, {
    name: 'Write',
    input: { file_path: '../../artifacts/P-260821-1818-yydi/T-01/result-eco.md' },
  });
  assert.equal(spot?.kind, 'outside', 'outside the office is still a real destination');
  assert.match(String(spot?.ref), /result-eco\.md$/);
});

test('landingOf: `outside` keeps the raw path so it can still point the user to it', () => {
  /*
   * ⚠ Host-absolute, built with `path.sep`. `C:\tmp\stray.md` only leaves the
   * office on Windows; on Linux it is a relative filename that lands INSIDE,
   * and `kind: 'file'` is the correct answer there — so the old literal was
   * asking for the wrong verdict, not catching a wrong one.
   */
  const away = path.resolve(path.sep, 'tmp', 'stray.md');
  const spot = landingOf(OFFICE, { name: 'Write', input: { file_path: away } });
  assert.deepEqual(spot, { kind: 'outside', ref: away.replace(/\\/g, '/') });
});

test('landingOf: Edit and NotebookEdit go through the same door as Write', () => {
  assert.equal(landingOf(OFFICE, { name: 'Edit', input: { file_path: '../outside.md' } })?.kind, 'outside');
  assert.equal(
    landingOf(OFFICE, { name: 'NotebookEdit', input: { notebook_path: '../outside.ipynb' } })?.kind,
    'outside',
  );
});

test('landingOf: no path given ⇒ NO destination is invented', () => {
  assert.equal(landingOf(OFFICE, { name: 'Write', input: {} }), undefined);
  assert.equal(landingOf(OFFICE, { name: 'Write', input: { file_path: '' } }), undefined);
});

test('landingOf: Bash declares "a command ran" and nothing more than that', () => {
  assert.deepEqual(landingOf(OFFICE, { name: 'Bash', input: { command: 'curl x' } }), {
    kind: 'command',
    ref: '',
  });
});

test('landingOf: an MCP tool declares the server name', () => {
  assert.deepEqual(landingOf(OFFICE, { name: 'mcp__notion__create_page', input: {} }), {
    kind: 'external',
    ref: 'notion',
  });
});

test('landingOf: Read is not a destination', () => {
  assert.equal(landingOf(OFFICE, { name: 'Read', input: { file_path: 'library/files/a.csv' } }), undefined);
});


test('readUsage: tokens come from `modelUsage` (cumulative), NOT from `usage` (single turn)', () => {
  const u = readUsage({
    usage: { input_tokens: 2, output_tokens: 59, cache_read_input_tokens: 0, cache_creation_input_tokens: 7699 },
    modelUsage: {
      'claude-sonnet-5': {
        inputTokens: 40,
        outputTokens: 27_800,
        cacheReadInputTokens: 21_400,
        cacheCreationInputTokens: 7_699,
        costUSD: 0.42,
      },
    },
    total_cost_usd: 0.4248467,
    num_turns: 2,
  });

  assert.equal(u.output, 27_800, 'must not pick up the 59 from the last turn');
  assert.equal(u.cacheRead, 21_400, 'must not pick up the 0 from the last turn');
  assert.equal(u.cacheWrite, 7_699);
  assert.equal(u.costUSD, 0.4248467, 'cost still comes from `total_cost_usd` — the same currency as maxBudgetUsd');
  assert.equal(u.turns, 2);
});

test('readUsage: sums up EVERY model, including internal auxiliary turns', () => {
  const u = readUsage({
    modelUsage: {
      'claude-sonnet-5': { inputTokens: 10, outputTokens: 1000, cacheReadInputTokens: 500, cacheCreationInputTokens: 200, costUSD: 0.02 },
      'claude-haiku-4-5-20251001': { inputTokens: 5, outputTokens: 40, cacheReadInputTokens: 100, cacheCreationInputTokens: 0, costUSD: 0.001 },
    },
    total_cost_usd: 0.021,
    num_turns: 3,
  });
  assert.equal(u.input, 15);
  assert.equal(u.output, 1040);
  assert.equal(u.cacheRead, 600);
  assert.equal(u.cacheWrite, 200);
});

test('readUsage: the model reported is the one that BURNED THE MOST TOKENS, not the first key', () => {
  const u = readUsage({
    modelUsage: {
      'claude-haiku-4-5-20251001': { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 0, costUSD: 0 },
      'claude-sonnet-5': { inputTokens: 100, outputTokens: 900, cacheReadInputTokens: 8000, cacheCreationInputTokens: 0, costUSD: 0.1 },
    },
    total_cost_usd: 0.1,
    num_turns: 1,
  });
  assert.equal(u.model, 'claude-sonnet-5');
});

test('readUsage: an empty `modelUsage` falls back to `usage` instead of recording 0', () => {
  const u = readUsage({
    usage: { input_tokens: 7, output_tokens: 300, cache_read_input_tokens: 20, cache_creation_input_tokens: 1 },
    modelUsage: {},
    total_cost_usd: 0.05,
    num_turns: 1,
  });
  assert.equal(u.output, 300);
  assert.equal(u.costUSD, 0.05);
});

test('readUsage: with nothing at all it returns 0, and does not throw', () => {
  const u = readUsage({});
  assert.equal(u.output, 0);
  assert.equal(u.costUSD, 0);
  assert.equal(u.turns, 0);
});


function withTempOffice(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-landing-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('filesOnDisk: only reports files that are ACTUALLY THERE, not ones the model merely claimed', () => {
  withTempOffice((dir) => {
    fs.mkdirSync(path.join(dir, 'artifacts', 'T-01'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'artifacts', 'T-01', 'real.md'), '# real');

    const got = filesOnDisk(
      dir,
      ['artifacts/T-01/real.md', 'artifacts/T-01/missing.md'],
      [],
    );
    assert.deepEqual(got, ['artifacts/T-01/real.md']);
  });
});

test('filesOnDisk: merges both delivered files and files observed being written', () => {
  withTempOffice((dir) => {
    fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'artifacts', 'main.md'), 'x');
    fs.writeFileSync(path.join(dir, 'artifacts', 'side.csv'), 'y');

    const got = filesOnDisk(dir, ['artifacts/main.md'], [
      { kind: 'file', ref: 'artifacts/side.csv' },
      { kind: 'command', ref: '' },
      { kind: 'external', ref: 'notion' },
    ]);
    assert.deepEqual(got.sort(), ['artifacts/main.md', 'artifacts/side.csv']);
  });
});

test('filesOnDisk: a file appearing in both sources shows up only once', () => {
  withTempOffice((dir) => {
    fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'artifacts', 'a.md'), 'x');
    const got = filesOnDisk(dir, ['artifacts/a.md'], [{ kind: 'file', ref: 'artifacts/a.md' }]);
    assert.deepEqual(got, ['artifacts/a.md']);
  });
});

test('filesOnDisk: a path outside the office must NOT be reported as a result', () => {
  withTempOffice((dir) => {
    const got = filesOnDisk(dir, ['../../outside.md'], []);
    assert.deepEqual(got, [], 'safeJoin throws → excluded, not crashed');
  });
});

test('straysOnDisk: reports strays that ACTUALLY EXIST, drops strays that were only claimed but never written', () => {
  withTempOffice((dir) => {
    const that = path.join(dir, 'real-stray.md');
    fs.writeFileSync(that, '# stray');

    const got = straysOnDisk([
      { kind: 'outside', ref: that },
      { kind: 'outside', ref: path.join(dir, 'never-written.md') },
      { kind: 'file', ref: 'artifacts/a.md' },
    ]);
    assert.deepEqual(got, [that]);
  });
});

test('straysOnDisk: no strays at all ⇒ empty — silence when silence is correct', () => {
  assert.deepEqual(straysOnDisk([{ kind: 'file', ref: 'artifacts/a.md' }]), []);
  assert.deepEqual(straysOnDisk([]), []);
});


test('effectiveTools: declaring shell with ONE name still yields EVERY platform name', () => {
  const out = effectiveTools(['Bash']);
  assert.ok(out.includes('Bash'), 'keeps the POSIX name');
  assert.ok(out.includes('PowerShell'), 'missing the Windows name = the toggle is a no-op on Windows');
  for (const t of BUILTIN_TOOLS) assert.ok(out.includes(t));
});

test('effectiveTools: declaring with the Windows name also yields both', () => {
  const out = effectiveTools(['PowerShell']);
  assert.ok(out.includes('Bash') && out.includes('PowerShell'));
});

test('effectiveTools: NOT declaring shell means no shell name sneaks in', () => {
  const out = effectiveTools([]);
  assert.equal(out.includes('Bash'), false);
  assert.equal(out.includes('PowerShell'), false);
  assert.deepEqual(out, [...BUILTIN_TOOLS]);
});

test('hasShell: recognizes a role has shell regardless of which name it was declared with', () => {
  assert.equal(hasShell([]), false);
  assert.equal(hasShell(['Read']), false);
  assert.equal(hasShell(['Bash']), true);
  assert.equal(hasShell(['PowerShell']), true);
});

test('landingOf: both Bash and PowerShell report a "command" destination', () => {
  for (const name of ['Bash', 'PowerShell']) {
    assert.deepEqual(landingOf('/vp', { name, input: { command: 'ls' } }), { kind: 'command', ref: '' });
  }
});



const roleWith = (tools) => ({ id: 'r1', tools, budget: {}, mcp: [] });
const GRANTED_POSIX = [...BUILTIN_TOOLS, 'Bash'];
const GRANTED_WIN = [...BUILTIN_TOOLS, 'PowerShell'];

test('warnDroppedTools: POSIX grants Bash, Windows grants PowerShell -> both stay SILENT', () => {
  assert.deepEqual(warnDroppedTools(roleWith(['Bash']), GRANTED_POSIX), []);
  assert.deepEqual(warnDroppedTools(roleWith(['Bash']), GRANTED_WIN), []);
});

test('warnDroppedTools: asking for shell but granted with NEITHER name -> WARNS', () => {
  const dropped = warnDroppedTools(roleWith(['Bash']), [...BUILTIN_TOOLS]);
  assert.ok(dropped.length > 0, 'this is exactly the no-op that went unnoticed for 6 days — it must make noise');
});

test('warnDroppedTools: NOT asking for shell never warns about shell', () => {
  assert.deepEqual(warnDroppedTools(roleWith([]), [...BUILTIN_TOOLS]), []);
});

test('warnDroppedTools: an ordinary dropped tool must warn too', () => {
  const dropped = warnDroppedTools(roleWith([]), BUILTIN_TOOLS.filter((t) => t !== 'WebSearch'));
  assert.deepEqual(dropped, ['WebSearch']);
});

test('warnDroppedTools: granted is not an array -> silent, does not throw', () => {
  assert.deepEqual(warnDroppedTools(roleWith(['Bash']), undefined), []);
  assert.deepEqual(warnDroppedTools(roleWith(['Bash']), 'nope'), []);
});

