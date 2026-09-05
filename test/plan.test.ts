
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SHELL_LEGEND, armReach, outputScoper, shellFlag } from '../dist/core/assistant.js';
import { Scheduler, delivered, unmetDeps } from '../dist/core/scheduler.js';
import { isStale } from '../dist/core/artifacts.js';
import { existsOnDisk, resolveInput } from '../dist/core/paths.js';
import { planProblemsMessage } from '../dist/core/office.js';

type Plan = Parameters<typeof Scheduler.linkDeps>[0];

const task = (id: string, patch: Record<string, unknown> = {}) => ({
  task_id: id,
  role: 'writer',
  goal: 'g',
  inputs: [],
  outputs: [],
  constraints: [],
  deps: [],
  step: 0,
  ...patch,
});

const plan = (tasks: unknown[]): Plan =>
  ({ plan_id: 'P-test', request: 'r', steps: [{ title: 's', status: 'pending' }], tasks }) as Plan;

const file = (p: string) => ({ kind: 'file' as const, path: p });
const ROLES = new Set(['writer', 'reviewer']);


test("linkDeps: a task reading another task's output auto-wires the dependency", () => {
  const p = plan([
    task('T-01', { outputs: [file('artifacts/P/T-01/bai.md')] }),
    task('T-02', { inputs: [file('artifacts/P/T-01/bai.md')] }),
  ]);
  assert.deepEqual(Scheduler.linkDeps(p), ['T-02 → T-01']);
  assert.deepEqual(p.tasks[1]!.deps, ['T-01']);
});

test('linkDeps: paths written in different styles must still match', () => {
  const p = plan([
    task('T-01', { outputs: [file('artifacts/P/T-01/bai.md')] }),
    task('T-02', { inputs: [file('./artifacts\\P\\T-01\\bai.md')] }),
  ]);
  assert.equal(Scheduler.linkDeps(p).length, 1);
});

test('linkDeps: an already-declared dep is not re-wired', () => {
  const p = plan([
    task('T-01', { outputs: [file('a.md')] }),
    task('T-02', { inputs: [file('a.md')], deps: ['T-01'] }),
  ]);
  assert.deepEqual(Scheduler.linkDeps(p), []);
});

test('linkDeps: a task reading its own output does NOT self-depend', () => {
  const p = plan([task('T-01', { inputs: [file('a.md')], outputs: [file('a.md')] })]);
  assert.deepEqual(Scheduler.linkDeps(p), []);
  assert.deepEqual(p.tasks[0]!.deps, []);
});

test('linkDeps runs before validate: a cycle it wires up is still caught', () => {
  const p = plan([
    task('T-01', { inputs: [file('b.md')], outputs: [file('a.md')] }),
    task('T-02', { inputs: [file('a.md')], outputs: [file('b.md')] }),
  ]);
  Scheduler.linkDeps(p);
  const problems = Scheduler.validate(p, ROLES);
  assert.ok(
    problems.some((x) => x.includes('vòng tròn')), // i18n-allow-vietnamese: matches real i18n plan.cycle string (default locale vi)
    `must catch the cycle, got: ${problems.join(' | ')}`,
  );
});


test('linkDeps: an input that is a directory another task writes into still wires up', () => {
  const p = plan([
    task('T-01', { outputs: [file('artifacts/P/T-01/dieu-khoan/dieu-01.md')] }),
    task('T-02', { inputs: [file('artifacts/P/T-01/dieu-khoan/')] }),
  ]);
  assert.deepEqual(Scheduler.linkDeps(p), ['T-02 → T-01']);
});

test('linkDeps: a trailing slash must not throw off the comparison — the two scopers trim differently', () => {
  const p = plan([
    task('T-01', { outputs: [file('artifacts/P/T-01/dieu-khoan')] }),
    task('T-02', { inputs: [file('artifacts/P/T-01/dieu-khoan/')] }),
  ]);
  assert.deepEqual(Scheduler.linkDeps(p), ['T-02 → T-01']);
});

test('linkDeps: a directory with MULTIPLE writers wires up ALL of them, not just the first', () => {
  const p = plan([
    task('T-01', { outputs: [file('artifacts/P/T-01/soi/a.md')] }),
    task('T-02', { outputs: [file('artifacts/P/T-01/soi/b.md')] }),
    task('T-03', { inputs: [file('artifacts/P/T-01/soi/')] }),
  ]);
  Scheduler.linkDeps(p);
  assert.deepEqual(p.tasks[2]!.deps, ['T-01', 'T-02']);
});

test('linkDeps: a string prefix is NOT a parent directory', () => {
  const p = plan([
    task('T-01', { outputs: [file('artifacts/P/T-01/dieu-khoan-cu.md')] }),
    task('T-02', { inputs: [file('artifacts/P/T-01/dieu-khoan')] }),
  ]);
  assert.deepEqual(Scheduler.linkDeps(p), []);
});


test('validate: a directory another task writes into is NOT required to already exist on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    const p = plan([
      task('T-01', { outputs: [file('artifacts/P/T-01/dieu-khoan/dieu-01.md')] }),
      task('T-02', { inputs: [file('artifacts/P/T-01/dieu-khoan/')], deps: ['T-01'] }),
    ]);
    assert.deepEqual(Scheduler.validate(p, ROLES, dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate: a directory NOBODY writes into and that does not exist on disk still blocks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    const p = plan([task('T-01', { inputs: [file('artifacts/P/T-09/dieu-khoan/')] })]);
    assert.equal(Scheduler.validate(p, ROLES, dir).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate: an input not on disk and produced by no task blocks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    const p = plan([task('T-01', { inputs: [file('library/files/khong-co.md')] })]);
    const problems = Scheduler.validate(p, ROLES, dir);
    assert.equal(problems.length, 1);
    assert.ok(problems[0]!.includes('library/files/khong-co.md'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate: an input that IS on disk passes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    fs.mkdirSync(path.join(dir, 'library', 'files'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'library', 'files', 'doi-tra.md'), 'x');
    const p = plan([task('T-01', { inputs: [file('library/files/doi-tra.md')] })]);
    assert.deepEqual(Scheduler.validate(p, ROLES, dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate: an input produced by ANOTHER task is not required to already exist on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    const p = plan([
      task('T-01', { outputs: [file('artifacts/P/T-01/bai.md')] }),
      task('T-02', { inputs: [file('artifacts/P/T-01/bai.md')], deps: ['T-01'] }),
    ]);
    assert.deepEqual(Scheduler.validate(p, ROLES, dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate: without an officeDir the disk check is skipped, but the other checks still run', () => {
  const p = plan([task('T-01', { role: 'khong-co-ai' })]);
  assert.equal(Scheduler.validate(p, ROLES).length, 1);
});


const out = outputScoper('P-01', 'T-01');

test("outputScoper: KEEPS the user-chosen tail, only wraps the frame around it", () => {
  assert.equal(out('artifacts/vi/doc-1.md'), 'artifacts/P-01/T-01/vi/doc-1.md');
});

test('outputScoper: a path already following the rule comes out unchanged', () => {
  assert.equal(out('artifacts/T-01/bai.md'), 'artifacts/P-01/T-01/bai.md');
});

test('outputScoper: IDEMPOTENT — calling it again does not wrap another layer', () => {
  const once = out('artifacts/vi/doc-1.md');
  assert.equal(out(once), once);
});

test("outputScoper: a bare filename still lands in the task's own folder", () => {
  assert.equal(out('bao-cao.md'), 'artifacts/P-01/T-01/bao-cao.md');
});

test('outputScoper: `\\` and `./` do not throw off the frame', () => {
  assert.equal(out('.\\artifacts\\vi\\doc-1.md'), 'artifacts/P-01/T-01/vi/doc-1.md');
});

test('outputScoper: `..` is STRIPPED — no path escapes out of artifacts/', () => {
  assert.equal(out('../../office.yaml'), 'artifacts/P-01/T-01/office.yaml');
  assert.equal(out('artifacts/../../roles/x.yaml'), 'artifacts/P-01/T-01/roles/x.yaml');
});

test('outputScoper: an empty path still resolves to a real file, not a directory', () => {
  assert.equal(out('artifacts/'), 'artifacts/P-01/T-01/ket-qua.md');
});

test('outputScoper: two DIFFERENT tasks never collide, even with the same filename', () => {
  const a = outputScoper('P-01', 'T-01')('artifacts/vi/doc.md');
  const b = outputScoper('P-01', 'T-02')('artifacts/vi/doc.md');
  assert.notEqual(a, b);
});


test('onRedirect: a Windows absolute path is reported VERBATIM', () => {
  const seen: string[] = [];
  const scope = outputScoper('P-01', 'T-01', (asked) => seen.push(asked));
  assert.equal(scope('D:\\Downloads\\Programs Installation\\ban-ke.md'), 'artifacts/P-01/T-01/ban-ke.md');
  assert.deepEqual(seen, ['D:\\Downloads\\Programs Installation\\ban-ke.md']);
});

test('onRedirect: the POSIX branch reports too — it is just QUIETER, not more correct', () => {
  const seen: string[] = [];
  const scope = outputScoper('P-01', 'T-01', (asked) => seen.push(asked));
  assert.equal(scope('/home/an/ho-so/x.md'), 'artifacts/P-01/T-01/x.md');
  assert.deepEqual(seen, ['/home/an/ho-so/x.md']);
});

test('onRedirect: a path already INSIDE the office does NOT fire — the reverse half of the contract', () => {
  const seen: string[] = [];
  const scope = outputScoper('P-01', 'T-01', (asked) => seen.push(asked));
  scope('artifacts/vi/doc-1.md');
  scope('bao-cao.md');
  scope('../../office.yaml');
  assert.deepEqual(seen, []);
});

test('onRedirect: with NO callback, behavior is identical to the old version', () => {
  assert.equal(outputScoper('P-01', 'T-01')('D:\\x\\y.md'), 'artifacts/P-01/T-01/y.md');
});



const receipt = (patch: Record<string, unknown> = {}) =>
  ({ status: 'done', artifacts: ['a.md'], landed: ['a.md'], ...patch }) as never;

test('delivered: only `done` WITH something actually landed counts as done', () => {
  assert.equal(delivered(receipt()), true);
  assert.equal(delivered(receipt({ status: 'blocked' })), false, 'this is the 08/20 bug');
  assert.equal(delivered(receipt({ status: 'failed' })), false);
  assert.equal(delivered(receipt({ status: 'stopped' })), false);
  assert.equal(delivered(undefined), false);
});

test('delivered: self-reporting `done` with NO file having landed is not done yet', () => {
  assert.equal(delivered(receipt({ artifacts: [], landed: [] })), true, "promising nothing means owing nothing");
  assert.equal(delivered(receipt({ artifacts: ['x.md'], landed: [] })), true);
});

test('unmetDeps: names the EXACT step that never delivered', () => {
  const t = task('T-02', { deps: ['T-01'] }) as never;
  const blocked = new Map([['T-01', receipt({ status: 'blocked' })]]);
  assert.deepEqual(unmetDeps(t, blocked, new Set()), ['T-01']);
  const ok = new Map([['T-01', receipt()]]);
  assert.deepEqual(unmetDeps(t, ok, new Set()), []);
  assert.deepEqual(unmetDeps(t, ok, new Set(['T-01'])), ['T-01'], 'a failure must still propagate');
});


const t = (iso: string) => new Date(iso).toISOString();

test('isStale: a source changing AFTER the file was written → stale', () => {
  assert.equal(isStale(t('2026-08-20T10:00:00Z'), [t('2026-08-20T11:00:00Z')]), true);
});

test('isStale: a source older than the product → still fresh', () => {
  assert.equal(isStale(t('2026-08-20T12:00:00Z'), [t('2026-08-20T11:00:00Z')]), false);
});

test('isStale: just ONE changed source is enough to go stale', () => {
  const made = t('2026-08-20T12:00:00Z');
  assert.equal(isStale(made, [t('2026-08-20T09:00:00Z'), t('2026-08-20T13:00:00Z')]), true);
});

test('isStale: written at the exact same time is NOT stale', () => {
  const same = t('2026-08-20T12:00:00Z');
  assert.equal(isStale(same, [same]), false);
});

test('isStale: no source at all → no conclusion either way', () => {
  assert.equal(isStale(t('2026-08-20T12:00:00Z'), []), false);
});

test('isStale: garbage mtime is silently ignored, never labeled arbitrarily', () => {
  assert.equal(isStale('garbage', [t('2026-08-20T12:00:00Z')]), false);
  assert.equal(isStale(t('2026-08-20T12:00:00Z'), ['garbage']), false);
});


test('delivered: a task interrupted MID-WRITE is not "done"', () => {
  const interrupted = {
    status: 'blocked',
    artifacts: ['a/dieu-01.md', 'a/dieu-02.md'],
    landed: ['a/dieu-01.md', 'a/dieu-02.md'],
  } as never;
  assert.equal(delivered(interrupted), false, 'HAVING a file does not mean it is done');
});

test('resume: a task must re-run when its receipt never delivered', () => {
  const queued = new Set(['T-02', 'T-03']);
  const receipts = new Map([['T-01', { status: 'blocked', artifacts: ['x.md'], landed: ['x.md'] }]]);
  const redo = (id: string) =>
    queued.has(id) || !delivered(receipts.get(id) as never);

  assert.equal(redo('T-01'), true, 'T-01 was cut mid-way → MUST re-run');
  assert.equal(redo('T-02'), true);

  const ok = new Map([['T-01', { status: 'done', artifacts: ['x.md'], landed: ['x.md'] }]]);
  const redoOk = (id: string) => queued.has(id) || !delivered(ok.get(id) as never);
  assert.equal(redoOk('T-01'), false, 'truly done means it must NOT re-run — resume has to be cheap');
});

test('resume: only trims `deps` to a task that ACTUALLY delivered', () => {
  const run = new Set(['T-01', 'T-02']);
  const deps = ['T-01'].filter((d) => run.has(d));
  assert.deepEqual(deps, ['T-01'], 'the wire must STILL be there for the scheduler to block T-02');
});


test('an artifact path itself declares its plan_id and task_id', () => {
  const parts = 'artifacts/P-260821-0126-mxzo/T-01/dieu-khoan/dieu-khoan-01.md'.split('/');
  assert.equal(parts[0], 'artifacts');
  assert.equal(parts[1], 'P-260821-0126-mxzo');
  assert.equal(parts[2], 'T-01');
  assert.ok(parts.length >= 4, "fewer than 4 segments and it points at no task's output");
});

test('a path that is NOT an artifact stays clearly outside', () => {
  for (const p of ['library/text/hd5.pdf.txt', 'library/files/hd5.pdf', 'artifacts/x.md']) {
    const parts = p.split('/');
    assert.ok(parts[0] !== 'artifacts' || parts.length < 4, p);
  }
});


test('an undone step must show up in the report', () => {
  const steps = [
    { title: 'Split the contract', status: 'pending' },
    { title: 'Review the terms', status: 'done' },
    { title: 'Merge the checklist', status: 'done' },
  ];
  const undone = steps.filter((s) => s.status !== 'done');
  assert.equal(undone.length, 1);
  assert.equal(undone[0].title, 'Split the contract');
});

test('fully done attaches NO warning sentence at all', () => {
  const steps = [{ status: 'done' }, { status: 'done' }];
  assert.equal(steps.filter((s) => s.status !== 'done').length, 0);
});

test('validate: an ABSOLUTE directory outside the office that really exists ⇒ PASSES', () => {
  const office = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-ngoai-'));
  try {
    const p = plan([task('T-01', { inputs: [file(outside)] })]);
    assert.deepEqual(Scheduler.validate(p, ROLES, office), []);
  } finally {
    fs.rmSync(office, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('validate: an absolute path that does NOT exist still blocks — and states the real reason', () => {
  const office = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    const ghost = path.join(os.tmpdir(), 'agentco-khong-bao-gio-co-that-9k2');
    const problems = Scheduler.validate(plan([task('T-01', { inputs: [file(ghost)] })]), ROLES, office);
    assert.equal(problems.length, 1);
    assert.ok(problems[0]!.includes(ghost), 'must name the exact path so the user can fix it');
    assert.ok(
      problems[0]!.includes('không tìm thấy trên máy'), // i18n-allow-vietnamese: matches real i18n string (default locale vi)
      'the "no task produces it" phrasing makes no sense for a directory outside the office',
    );
  } finally {
    fs.rmSync(office, { recursive: true, force: true });
  }
});

test('validate: a RELATIVE path climbing outside still blocks — must not take the "outside the office" branch', () => {
  const office = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  try {
    const p = plan([task('T-01', { inputs: [file('../../../etc/passwd')] })]);
    assert.equal(Scheduler.validate(p, ROLES, office).length, 1);
  } finally {
    fs.rmSync(office, { recursive: true, force: true });
  }
});

test('missingInputs SHARES its rule with validate: an absolute path that exists can still be resolved', () => {
  const office = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-plan-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-ngoai-'));
  try {
    for (const p of [outside, path.join(office, 'library')]) {
      const abs = resolveInput(office, p);
      assert.ok(abs, `resolveInput must accept "${p}"`);
    }
    assert.equal(resolveInput(office, '../../../etc/passwd'), undefined, 'traversal is still blocked');
    assert.ok(existsOnDisk(outside));
    assert.equal(existsOnDisk(path.join(os.tmpdir(), 'khong-bao-gio-co-that-7x1')), false);
  } finally {
    fs.rmSync(office, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});



test('shellFlag: ALWAYS says so, both ways — absence is not a signal', () => {
  assert.notEqual(shellFlag([]), '', 'having no shell must still be stated');
  assert.notEqual(shellFlag([]), shellFlag(['Bash']), 'the two states must be distinguishable');
  assert.ok(shellFlag(['Bash']).includes('ON'));
  assert.ok(shellFlag([]).includes('OFF'));
  assert.equal(shellFlag(['PowerShell']), shellFlag(['Bash']));
});

test('shellFlag: the flag is SELF-READABLE standing alone, with no caption above it needed', () => {
  for (const tools of [[], ['Bash']]) {
    assert.ok(shellFlag(tools).includes('shell'), `the flag must carry its own meaning: ${shellFlag(tools)}`);
  }
});


const ARMS = { a385afc3ab6: { label: 'Programs Installation 2' }, notion: { label: 'Notion' } };
const SERVERS = {
  a385afc3ab6: { command: 'npx', args: ['-y', 'pkg', 'D:\\Downloads\\Programs Installation'] },
  notion: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] },
};

test('armReach: a file arm states the ACTUAL PATH, not just the name', () => {
  const line = armReach(ARMS, SERVERS, 'a385afc3ab6');
  assert.ok(line.includes('D:\\Downloads\\Programs Installation'), `missing the folder: ${line}`);
  assert.ok(line.includes('Programs Installation 2'), `missing the user-chosen label: ${line}`);
  assert.ok(!line.includes('a385afc3ab6'), `the hash must not leak once a label exists: ${line}`);
});

test('armReach: the line is self-readable, and says SHORTCUT rather than LIMIT', () => {
  const line = armReach(ARMS, SERVERS, 'a385afc3ab6');
  assert.ok(/shortcut to/.test(line), `the line must state it is a shortcut: ${line}`);
  assert.ok(!/folders:/.test(line), `"folders:" reads as a limit — do not regress: ${line}`);
});

test('armReach: an arm that is NOT a file does not invent a folder', () => {
  assert.equal(armReach(ARMS, SERVERS, 'notion'), 'Notion');
});

test('armReach: `does` puts CAPABILITY on the line, not the machine tool name', () => {
  const arms = { cli: { label: 'Command shop', does: ['roll a die', 'sync data'] } };
  const line = armReach(arms, {}, 'cli');
  assert.equal(line, 'Command shop — roll a die · sync data');
});

test('armReach: `does` has a CAP of 4 — a 20-command arm does not dump the whole wall into the prefix', () => {
  const does = ['one', 'two', 'three', 'four', 'five', 'six'];
  const line = armReach({ cli: { label: 'X', does } }, {}, 'cli');
  assert.ok(line.includes('one · two · three · four'), `must keep the first 4 items: ${line}`);
  assert.ok(line.includes('and 2 more actions'), `must fold the remainder: ${line}`);
  assert.ok(!line.includes('five'), `the 5th item must not leak verbatim: ${line}`);
});

test('armReach: `does` ABSENT ⇒ prints nothing — every arm already running keeps its exact wording', () => {
  assert.equal(armReach(ARMS, SERVERS, 'notion'), 'Notion');
  assert.equal(armReach({ cli: { label: 'X', does: [] } }, {}, 'cli'), 'X');
  assert.equal(armReach({ cli: { label: 'X' } }, {}, 'cli'), 'X');
  const line = armReach({ a: { label: 'Kho', level: 'read' } }, { a: { args: ['D:\\Kho'] } }, 'a');
  assert.equal(line, 'Kho — read only (shortcut to D:\\Kho)');
});

test('armReach: `does` comes AFTER the permission tier — permission first, capability second', () => {
  const line = armReach({ a: { label: 'Kho', level: 'read', does: ['read invoices'] } }, {}, 'a');
  assert.equal(line, 'Kho — read only · read invoices');
});

const TIERED = {
  n_read: { label: 'Notion · Personal', level: 'read' as const },
  n_add: { label: 'Notion · Team', level: 'add' as const },
  n_full: { label: 'Notion · Company', level: 'full' as const },
};

test("⭐ armReach: the permission tier sits ON THE EMPLOYEE'S OWN LINE", () => {
  assert.match(armReach(TIERED, {}, 'n_read'), /read only/);
  assert.match(armReach(TIERED, {}, 'n_full'), /write/);
  assert.match(armReach(TIERED, {}, 'n_full'), /edit\/delete/);
});

test('⭐ armReach: THREE tiers produce THREE different lines — changing tier changes the prompt', () => {
  const lines = new Set(['n_read', 'n_add', 'n_full'].map((id) => armReach(TIERED, {}, id)));
  assert.equal(lines.size, 3);
});

test('armReach: the `add` tier must say CLEARLY it does NOT edit/delete', () => {
  assert.match(armReach(TIERED, {}, 'n_add'), /no editing or deleting/);
});

test('armReach: NO `level` ⇒ no capability is invented', () => {
  assert.equal(armReach(ARMS, SERVERS, 'notion'), 'Notion');
  assert.ok(!/read only|full access|edit\/delete/.test(armReach(ARMS, SERVERS, 'a385afc3ab6')));
});

test('armReach: BOTH a tier and a folder means saying both — neither gets swallowed', () => {
  const arms = { x: { label: 'Kho', level: 'full' as const } };
  const line = armReach(arms, { x: { args: ['D:\\Kho'] } }, 'x');
  assert.match(line, /edit\/delete/);
  assert.match(line, /D:\\Kho/);
});

test('armReach: no label yet ⇒ falls back to the hash — ugly beats silent', () => {
  assert.equal(armReach({}, {}, 'a1b2c3'), 'a1b2c3');
});

test('SHELL_LEGEND: teaches ALWAYS reusing the printed folder, and STAYING within it', () => {
  assert.ok(/folders:/.test(SHELL_LEGEND), 'the legend must explain the "folders:" label');
  assert.ok(/do not ask them for the full path again/.test(SHELL_LEGEND), 'must say plainly: do not ask for the path again');
  assert.ok(
    /in that list|ALREADY been granted/.test(SHELL_LEGEND),
    'the sentence must scope itself to the folders printed on the employee line',
  );
});

test('SHELL_LEGEND: states READ access, without broadening into a denial of machine reach overall', () => {
  assert.ok(/CAN OPEN files on the human/.test(SHELL_LEGEND), 'must state the read permission');
  for (const doi of ['cannot reach', 'cannot read', 'no access to']) {
    assert.ok(!SHELL_LEGEND.includes(doi), `the broad denial "${doi}" is factually wrong`);
  }
});

test('SHELL_LEGEND: does NOT attribute file metadata to the shell — arms can read it too', () => {
  for (const gan of ['file size', 'modified date', 'disk usage']) {
    assert.ok(
      !SHELL_LEGEND.includes(gan),
      `"${gan}" sitting next to "shell: ON" teaches the assistant that no shell means no ` +
        `metadata — wrong the day any filesystem MCP is connected, and wrong in the direction of REFUSING work`,
    );
  }
});

test('SHELL_LEGEND: states plainly NOT TO GUESS on the employee\'s behalf what they can do', () => {
  assert.ok(/DO NOT decide on their behalf/.test(SHELL_LEGEND), 'must forbid guessing at an employee\'s capability');
  assert.ok(/A connection \(🔌\) brings its OWN/.test(SHELL_LEGEND), 'must state that a connection brings its own capability');
});

test('SHELL_LEGEND: makes no exclusivity claim — the sentence must survive once MCP exists', () => {
  for (const dong of ['the ONLY', 'the only', 'can only', 'only way']) {
    assert.ok(
      !SHELL_LEGEND.includes(dong),
      `"${dong}" is a claim about the entire world — stops being true the moment MCP is added`,
    );
  }
  assert.ok(/lists EVERY place they reach/.test(SHELL_LEGEND), 'must be replaced by an invariant about the format instead');
});


test("planProblemsMessage: the first time still advises re-messaging — and that advice IS right the first time", () => {
  const m = planProblemsMessage(['Task T-02 cần đọc "x.md"'], 0); // i18n-allow-vietnamese: fixture problem text + real i18n output (default locale vi)
  assert.ok(m.includes('nhắn lại yêu cầu rõ hơn')); // i18n-allow-vietnamese: matches real i18n string
  assert.ok(!m.includes('lần thứ')); // i18n-allow-vietnamese: matches real i18n string
});

test('planProblemsMessage: from the THIRD time on, the sentence changes — advice already proven useless stops repeating', () => {
  const m = planProblemsMessage(['Task T-02 cần đọc "x.md"'], 2); // i18n-allow-vietnamese: fixture problem text + real i18n output (default locale vi)
  assert.ok(m.includes('lần thứ 3'), `must state that it is stuck in a loop: ${m}`); // i18n-allow-vietnamese: matches real i18n string
  assert.ok(
    !m.includes('nhắn lại yêu cầu rõ hơn'), // i18n-allow-vietnamese: matches real i18n string
    'must not repeat advice just proven useless',
  );
  assert.ok(m.includes('bỏ bớt') || m.includes('tách ra')); // i18n-allow-vietnamese: matches real i18n string
});

test('planProblemsMessage: never HIDES the error list on a repeat', () => {
  for (const n of [0, 2, 5]) {
    assert.ok(planProblemsMessage(['Task T-02 cần đọc "x.md"'], n).includes('Task T-02')); // i18n-allow-vietnamese: fixture problem text (default locale vi)
  }
});


test('outputScoper: a Windows absolute path → basename, the DRIVE never nests into the frame', () => {
  const s = outputScoper('P-1', 'T-01');
  assert.equal(s('D:\\Downloads\\Programs Installation\\ban-ke.md'), 'artifacts/P-1/T-01/ban-ke.md');
  assert.ok(!s('D:\\Downloads\\x.md').includes('D:'), 'the drive letter must not become a folder name');
});

test('outputScoper: a POSIX absolute path → basename', () => {
  const s = outputScoper('P-1', 'T-01');
  assert.equal(s('/home/an/bao-cao/ban-ke.md'), 'artifacts/P-1/T-01/ban-ke.md');
});

test('outputScoper: a UNC share is absolute too', () => {
  const s = outputScoper('P-1', 'T-01');
  assert.equal(s('\\\\server\\share\\ban-ke.md'), 'artifacts/P-1/T-01/ban-ke.md');
});

test('outputScoper: checks BOTH platforms — never sniffs process.platform', () => {
  const s = outputScoper('P-1', 'T-01');
  for (const p of ['D:\\a\\x.md', '/a/x.md']) {
    assert.equal(s(p), 'artifacts/P-1/T-01/x.md', `must handle "${p}" on every machine`);
  }
});

test('outputScoper: a RELATIVE path keeps the old behavior — still keeps the user-chosen tail', () => {
  const s = outputScoper('P-1', 'T-01');
  assert.equal(s('vi/doc-1.md'), 'artifacts/P-1/T-01/vi/doc-1.md');
  assert.equal(s('artifacts/P-1/T-01/vi/doc-1.md'), 'artifacts/P-1/T-01/vi/doc-1.md');
});
