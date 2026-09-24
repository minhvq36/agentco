
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
  exampleFits,
  isCliPaste,
  joinArgv,
  sampleAct,
  slots,
  slotFromExample,
  slugId,
  suggestSlots,
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

// ── suggestSlots — the Syntax line read the way a person wrote it (21/09) ──

test('the line from 21/09 becomes ONE blank, and the saved argv has one slot', () => {
  const line = 'python get_information.py --arg <nội dung thông tin>'; // i18n-allow-vietnamese: the user's own line, the case under test
  // What shipped: four fixed pieces, no slot — argparse exits 2 on the extra three.
  assert.equal(toArgv(line).length, 7);
  assert.deepEqual(slots(toArgv(line)), []);

  const fix = suggestSlots(line);
  assert.ok(fix, 'the case that cost a support thread went unrecognised');
  assert.equal(fix.line, 'python get_information.py --arg {noi_dung_thong_tin}');
  assert.deepEqual(toArgv(fix.line), ['python', 'get_information.py', '--arg', '{noi_dung_thong_tin}']);
  assert.deepEqual(slots(toArgv(fix.line)), ['noi_dung_thong_tin']);
});

test('recognised by how it OPENS: a forgotten `>` is still one blank', () => {
  const fix = suggestSlots('python get_information.py --arg <nội dung thông tin'); // i18n-allow-vietnamese: fixture
  assert.equal(fix?.line, 'python get_information.py --arg {noi_dung_thong_tin}');
});

test('a quoted `<…>` takes its quotes with it — they were only there for the spaces', () => {
  const fix = suggestSlots('python x.py --arg "<nội dung thông tin>"'); // i18n-allow-vietnamese: fixture
  assert.equal(fix?.line, 'python x.py --arg {noi_dung_thong_tin}');
  assert.equal(fix?.fixes[0]?.from, '"<nội dung thông tin>"'); // i18n-allow-vietnamese: fixture
});

test('`{…}` with a name the machine cannot use is renamed, not left as a fixed piece', () => {
  // `{nội dung}` today: toArgv cuts it in two, fillArgv matches neither half. // i18n-allow-vietnamese: fixture
  assert.deepEqual(slots(toArgv('x --arg {nội dung}')), []); // i18n-allow-vietnamese: fixture
  assert.equal(suggestSlots('x --arg {nội dung}')?.line, 'x --arg {noi_dung}'); // i18n-allow-vietnamese: fixture
  assert.equal(suggestSlots('x --arg {my arg}')?.line, 'x --arg {my_arg}');
});

test('`--arg=<value>` and repeated `<arg> <arg>` both come out usable', () => {
  assert.equal(suggestSlots('x --arg=<value>')?.line, 'x --arg={value}');
  assert.equal(suggestSlots('cp <arg> <arg>')?.line, 'cp {arg} {arg_2}');
  // A name already used by a real slot is not reused.
  assert.equal(suggestSlots('cp {arg} <arg>')?.line, 'cp {arg} {arg_2}');
});

test('what already MEANS something is never touched', () => {
  for (const line of [
    'python x.py --arg {noi_dung}', // already a slot
    'date --format "%Y-%m-%d"', // quoting keeps a piece together
    'python x.py --arg "some fixed text"', // a quoted literal is a literal
    'tool [--verbose] (a|b)', // "optional" / "pick one" in docs
    'find . -exec rm {} ;', // `{}` is passed to find literally
    'curl -d {"a":1} http://x?y=1', // JSON on the command line
    'sort < input.txt', // a redirect, standing alone
    'a -> b', // an arrow is not a blank
  ]) {
    assert.equal(suggestSlots(line), null, `touched: ${line}`);
  }
});

// ── an example that is not the syntax filled in blocks saving (24/09) ──

const EX = 'python get_information.py --arg "Xin chao tu AgentCo"';
const row = (line: string, example: string): CliDraft => ({ ...blankAct(), say: 'run it', line, example });

test('both failures of 21/09 now stop at the form, on the example field', () => {
  const first = 'python get_information.py --arg <nội dung thông tin>'; // i18n-allow-vietnamese: the user's own line
  const second = 'python get_information.py --arg "nội dung thông tin"'; // i18n-allow-vietnamese: the user's own line
  for (const line of [first, second]) {
    assert.equal(exampleFits(line, EX), false, `saved and failed at run time: ${line}`);
    assert.deepEqual(cliProblems([row(line, EX)], t).map((p) => p.field), ['example']);
  }
});

test('the one-click rewrite is what makes the same example fit', () => {
  const fixed = suggestSlots('python get_information.py --arg <nội dung thông tin>')!.line; // i18n-allow-vietnamese: fixture
  assert.equal(exampleFits(fixed, EX), true);
  assert.deepEqual(cliProblems([row(fixed, EX)], t), []);
});

test('what still saves: no example, and a fixed command whose example is itself', () => {
  assert.equal(exampleFits('python x.py --flag', ''), true);
  assert.equal(exampleFits('python x.py --flag', '   '), true);
  assert.equal(exampleFits('python x.py --flag', 'python x.py --flag'), true);
  assert.equal(exampleFits('python x.py --flag', 'python x.py --other'), false);
  // The sample the form offers must keep passing its own gate.
  assert.equal(exampleFits(sampleAct(t).line, sampleAct(t).example), true);
});

// ── slotFromExample — the way out of the block when there is no shape to see ──

test('the second failure of 21/09 gets a one-click way out, named after the flag', () => {
  const line = 'python get_information.py --arg "fixed text"';
  const example = 'python get_information.py --arg "Hello there"';
  assert.equal(exampleFits(line, example), false);
  assert.equal(suggestSlots(line), null, 'no shape to recognise — only the difference can tell');

  const out = slotFromExample(line, example);
  assert.ok(out);
  assert.deepEqual(out.fix, { from: 'fixed text', to: '{arg}' });
  assert.equal(out.line, 'python get_information.py --arg {arg}');
  // One click and the block lifts: the same example now fits and yields the value.
  assert.equal(exampleFits(out.line, example), true);
  assert.deepEqual(alignExample(toArgv(out.line), toArgv(example)), { arg: 'Hello there' });
});

test('`--month=8` keeps its flag; no flag before it means `{value}`', () => {
  assert.equal(slotFromExample('node c.js --month=8', 'node c.js --month=9')?.line, 'node c.js --month={month}');
  assert.equal(slotFromExample('node c.js 8', 'node c.js 9')?.line, 'node c.js {value}');
  assert.equal(slotFromExample('node c.js --dry-run 8', 'node c.js --dry-run 9')?.fix.to, '{dry_run}');
});

test('a name already taken by a real blank is not reused', () => {
  assert.equal(slotFromExample('x {arg} --arg 1', 'x {arg} --arg 2')?.fix.to, '{arg_2}');
});

test('no button where a guess would go wrong', () => {
  assert.equal(slotFromExample('x --a 1 --b 2', 'x --a 3 --b 4'), null, 'two differences: one blank or two?');
  assert.equal(slotFromExample('x --a 1', 'x --a 1 2'), null, 'different piece counts are a different command');
  assert.equal(slotFromExample('x --a 1', 'x --a 1'), null, 'nothing differs');
  assert.equal(slotFromExample('x --a 1', ''), null, 'no example, nothing to compare');
});

test('isCliPaste asks the SAME question isCliArm asks — by `type`, not by absence', () => {
  assert.equal(isCliPaste('{"type":"cli","actions":[]}'), true);
  assert.equal(isCliPaste('{"command":"npx","args":[]}'), false);
  assert.equal(isCliPaste('{}'), false);
  assert.equal(isCliPaste('not json'), false);
});
