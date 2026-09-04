
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  alignExample,
  blankAct,
  cliCount,
  cliDecl,
  cliProblems,
  declToDraft,
  draftToDecl,
  dupIds,
  isCliPaste,
  joinArgv,
  sampleAct,
  slots,
  slugId,
  toArgv,
  type CliDraft,
} from '../web/src/lib/cli-form.ts';
import { parseCliArm } from '../dist/core/cli-arm.js';
import { defaultArmLabel } from '../dist/core/armexec.js';
import { t } from '../dist/i18n/index.js';


test('toArgv respects quotes, does NOT understand shell syntax', () => {
  assert.deepEqual(toArgv('node -e "console.log(1)"'), ['node', '-e', 'console.log(1)']);
  assert.deepEqual(toArgv('ls | rm -rf /'), ['ls', '|', 'rm', '-rf', '/']);
  assert.deepEqual(toArgv('a "" b'), ['a', '', 'b']);
});

test('joinArgv is the INVERSE of toArgv, even when parts contain quotes', () => {
  for (const argv of [
    ['node', '-e', "console.log('Hello, ' + process.argv[1])"],
    ['git', 'commit', '-m', 'fix garbled text bug'],
    ['x', ''],
    ['echo', 'say "this" already'],
    ['C:\\Program Files\\x\\y.exe', '--in', 'D:\\Hồ sơ\\2026'], // i18n-allow-vietnamese: fixture — non-ASCII path round-trip
  ]) {
    assert.deepEqual(toArgv(joinArgv(argv)), argv, `broke on: ${JSON.stringify(argv)}`);
  }
});

test('slots picks up placeholders in order, without duplicates', () => {
  assert.deepEqual(slots(['a', '{x}', '--f={y}', '{x}']), ['x', 'y']);
  assert.deepEqual(slots(['a', 'b']), []);
});

test('slugId turns a Vietnamese sentence into a schema-valid id', () => {
  const ok = /^[a-z][a-z0-9_]*$/;
  for (const say of ['đếm hoá đơn chưa thanh toán', 'Đồng bộ!!!', '123 việc', 'nói xin chào']) { // i18n-allow-vietnamese: fixture — Vietnamese input to slugId
    assert.match(slugId(say), ok, `wrong id shape for "${say}"`);
  }
  assert.equal(slugId('đếm hoá đơn'), 'dem_hoa_don'); // i18n-allow-vietnamese: fixture — Vietnamese input to slugId

  assert.equal(slugId('123 việc'), 'job_123_viec'); // i18n-allow-vietnamese: fixture — Vietnamese input to slugId
  assert.equal(slugId('会计部'), 'job_new');
});


test('alignExample extracts values from a real command line', () => {
  assert.deepEqual(alignExample(['node', 'd.js', '--thang', '{thang}'], ['node', 'd.js', '--thang', '8']), {
    thang: '8',
  });
  assert.deepEqual(alignExample(['x', '--t={t}'], ['x', '--t=8']), { t: '8' });
});

test('an example that does NOT match the syntax returns null — no wild guessing', () => {
  assert.equal(alignExample(['a', '{x}'], ['a', 'b', 'c']), null);
  assert.equal(alignExample(['node', 'd.js', '{x}'], ['node', 'khac.js', '5']), null);
  assert.equal(alignExample([], []), null);
});


const DIR = 'D:\\Hồ sơ\\2026'; // i18n-allow-vietnamese: fixture — non-ASCII path

const full = (): CliDraft => ({
  say: 'đếm hoá đơn chưa thanh toán', // i18n-allow-vietnamese: fixture — Vietnamese input to slugId
  description: 'Count unpaid invoices for the month. Read-only, changes nothing.',
  line: 'node dem.js --thang {thang}',
  example: 'node dem.js --thang 8',
  read_only: true,
  fail_when: 'FATAL:',
  params: [],
});

test('form -> JSON -> form -> JSON changes not a single character', () => {
  const once = draftToDecl([full()], DIR);
  const back = declToDraft(once);
  assert.ok(back, 'reading it back came out empty');
  assert.equal(back.mixed, false);
  const twice = draftToDecl(back.acts, back.cwd);
  assert.deepEqual(twice, once);
  assert.deepEqual(declToDraft(twice), back);
});

test('the example line rebuilds from JSON — the user sees back exactly what they typed', () => {
  const back = declToDraft(draftToDecl([full()], DIR))!;
  assert.equal(back.acts[0]!.example, 'node dem.js --thang 8');
  assert.equal(back.acts[0]!.read_only, true);
  assert.equal(back.cwd, DIR, 'the shared directory did not read back correctly');
  assert.equal(back.acts[0]!.fail_when, 'FATAL:');
});

test('the directory belongs to the WHOLE ARM — every command gets the same `cwd`', () => {
  const decl = draftToDecl([full(), { ...full(), say: 'second task' }], DIR);
  assert.deepEqual(decl.actions.map((a) => a['cwd']), [DIR, DIR]);
  assert.equal(draftToDecl([full()], '').actions[0]!['cwd'], undefined);
});

test('`cwd` differs between commands => `mixed`, does NOT silently pick one', () => {
  const decl = {
    type: 'cli',
    actions: [
      { id: 'a', say: 'a', description: 'a', run: ['node', 'a.js'], cwd: 'D:\\mot' },
      { id: 'b', say: 'b', description: 'b', run: ['node', 'b.js'], cwd: 'D:\\hai' },
    ],
  };
  const back = declToDraft(decl)!;
  assert.equal(back.mixed, true);
  assert.equal(back.cwd, '', 'must not pick one of the two on the user\'s behalf');
});

test('parameter guardrails SURVIVE a round trip through the form', () => {
  const decl = {
    type: 'cli',
    actions: [
      {
        id: 'trien_khai',
        say: 'deploy',
        description: 'Push the new build. Overwrites the running build.',
        run: ['pnpm', 'deploy', '--tag', '{tag}'],
        params: [
          { name: 'tag', type: 'string', required: true, pattern: '^v[0-9.]+$', allow_dash: false, example: 'v1.2.3' },
        ],
      },
    ],
  };
  const back = declToDraft(decl)!;
  const round = draftToDecl(back.acts, back.cwd);
  const p = (round.actions[0]!['params'] as Record<string, unknown>[])[0]!;
  assert.equal(p['pattern'], '^v[0-9.]+$', 'pattern was dropped');
  assert.equal(p['allow_dash'], false, 'allow_dash was dropped');
  assert.equal(p['example'], 'v1.2.3');
});

test('editing the example line updates the parameter\'s example along with it', () => {
  const d = full();
  d.example = 'node dem.js --thang 12';
  const params = draftToDecl([d]).actions[0]!['params'] as Record<string, unknown>[];
  assert.equal(params[0]!['example'], '12');
});

test('the placeholders in the syntax are the SOURCE OF TRUTH for the parameter list', () => {
  const d = full();
  d.line = 'node dem.js --thang {thang} --nam {nam}';
  d.example = '';
  const params = draftToDecl([d]).actions[0]!['params'] as Record<string, unknown>[];
  assert.deepEqual(params.map((p) => p['name']), ['thang', 'nam']);
  d.line = 'node dem.js';
  assert.equal(draftToDecl([d]).actions[0]!['params'], undefined);
});


test('the form must NOT produce anything the paste gate rejects', () => {
  for (const draft of [full(), sampleAct(t)]) {
    const r = parseCliArm(draftToDecl([draft]));
    assert.equal(r.ok, true, `paste gate rejected: ${r.ok ? '' : r.error}`);
  }
});

test('the "try it" sample is complete and self-identifies', () => {
  const s = sampleAct(t);
  const decl = draftToDecl([s]);
  assert.equal(decl.actions.length, 1, 'the sample must pass the "still-blank task" filter');
  assert.equal(isCliPaste(JSON.stringify(decl)), true);
  const params = decl.actions[0]!['params'] as Record<string, unknown>[];
  assert.equal(params.length, 1);
  assert.equal(params[0]!['example'], toArgv(s.example).at(-1), 'could not extract the example from the sample');
  assert.ok(params[0]!['example'], 'the sample must have an extractable example');
  assert.equal(decl.actions[0]!['cwd'], undefined);
});

test('the default label of a CLI arm is the DIRECTORY NAME, not the binary name', () => {
  const withDir = draftToDecl([full()], 'D:\\Works\\ke-toan');
  assert.equal(defaultArmLabel(withDir), 'ke-toan');
  assert.equal(defaultArmLabel(draftToDecl([full()], 'D:\\Works\\ke-toan\\')), 'ke-toan');
  assert.equal(defaultArmLabel(draftToDecl([full()], '')), 'node');
});


test('an unfinished command is NOT thrown away — measurable: 2 commands in, 2 actions out, 2 commands back', () => {
  const form = [sampleAct(t), blankAct()];
  const decl = draftToDecl(form, DIR);
  assert.equal(decl.actions.length, 2, 'the unfinished command got thrown away');
  assert.equal(declToDraft(decl)!.acts.length, 2, 'a JSON round trip lost a row');
});

test('an unfinished command GREYS OUT the button — and only the right row, the right field', () => {
  assert.deepEqual(cliProblems([sampleAct(t)], t), [], 'a complete command still complained');
  const bad = cliProblems([sampleAct(t), blankAct()], t);
  assert.deepEqual(
    bad.map((p) => [p.at, p.field]),
    [[1, 'say'], [1, 'line']],
    'must point at exactly row 2, exactly the two blank fields',
  );
  assert.deepEqual(cliProblems([{ ...sampleAct(t), line: '' }], t).map((p) => p.field), ['line']);
  assert.deepEqual(cliProblems([{ ...sampleAct(t), say: '  ' }], t).map((p) => p.field), ['say']);
});

test('a broken JSON block => does NOT fall back to the form version', () => {
  assert.equal(cliDecl([sampleAct(t)], DIR, '{ broken'), null);
  assert.equal(cliCount(null), 0, 'null must count as 0 so the button greys out');
  assert.equal(cliCount(cliDecl([sampleAct(t)], DIR, null)), 1);
  assert.equal(cliCount(cliDecl([], DIR, '{"type":"cli","actions":[{"id":"a"}]}')), 1);
});


test('the paste gate REJECTS two commands with the same id, and says so in plain language', () => {
  const decl = {
    type: 'cli',
    actions: [
      { id: 'a', say: 'one', description: 'count, read-only', run: ['node', '-e', '1'] },
      { id: 'a', say: 'two', description: '⚠ wipes everything', run: ['node', '-e', '2'] },
    ],
  };
  const r = parseCliArm(decl);
  assert.equal(r.ok, false, 'slipped through the paste gate');
  if (!r.ok) {
    assert.match(r.error, /"a"/, 'the error message does not name the duplicate id');
    assert.match(r.error, /mã riêng/, 'the error message does not say what to do'); // i18n-allow-vietnamese: matches real i18n error string (default locale vi)
  }
  decl.actions[1]!.id = 'b';
  assert.equal(parseCliArm(decl).ok, true);
});

test('the FORM can itself generate a duplicate id — two near-identical names, one id', () => {
  assert.equal(slugId('đếm hoá đơn'), slugId('đếm hoá đơn!')); // i18n-allow-vietnamese: fixture — Vietnamese input to slugId
  const decl = draftToDecl(
    [
      { ...full(), say: 'đếm hoá đơn' }, // i18n-allow-vietnamese: fixture — Vietnamese input to slugId
      { ...full(), say: 'đếm hoá đơn!' }, // i18n-allow-vietnamese: fixture — Vietnamese input to slugId
    ],
    DIR,
  );
  assert.deepEqual(dupIds(decl), ['dem_hoa_don'], 'the UI failed to see the duplicate id');
  assert.equal(parseCliArm(decl).ok, false, 'the paste gate must block exactly what the form just generated');
});

test('dupIds stays quiet when nothing collides', () => {
  assert.deepEqual(dupIds(draftToDecl([full(), { ...full(), say: 'second task' }], DIR)), []);
  assert.deepEqual(dupIds({}), []);
});

test('isCliPaste asks the SAME question isCliArm asks — by `type`, not by absence', () => {
  assert.equal(isCliPaste('{"type":"cli","actions":[]}'), true);
  assert.equal(isCliPaste('{"command":"npx","args":[]}'), false);
  assert.equal(isCliPaste('{}'), false);
  assert.equal(isCliPaste('not json'), false);
});
