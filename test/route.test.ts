
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildPlan, decideRoute, requestOf } from '../dist/core/assistant.js';
import { pickReadable, readingNote } from '../dist/core/commands.js';

type Draft = Parameters<typeof buildPlan>[0];

const draftTask = (patch: Record<string, unknown> = {}) => ({
  task_id: 'T-01',
  role: 'translator',
  goal: 'List 10 terms',
  inputs: [] as { path: string }[],
  outputs: [{ path: 'artifacts/T-01/result.md' }],
  constraints: [] as string[],
  deps: [] as string[],
  step: 0,
  ...patch,
});

const draft = (tasks: unknown[], steps = ['Work']): Draft =>
  ({ steps, tasks }) as unknown as Draft;

const fence = (o: unknown) => '```json\n' + JSON.stringify(o, null, 2) + '\n```';


test('decideRoute: the three valid doors pass straight through', () => {
  assert.deepEqual(decideRoute(fence({ intent: 'chat', say: 'Hello!' })), {
    intent: 'chat',
    say: 'Hello!',
  });
  assert.deepEqual(decideRoute(fence({ intent: 'ask', say: 'Which document should this come from?' })), {
    intent: 'ask',
    say: 'Which document should this come from?',
  });
  assert.deepEqual(decideRoute(fence({ intent: 'task', request: 'Translate doc-1' })), {
    intent: 'task',
    request: 'Translate doc-1',
    scope: 'new',
  });
});

test('decideRoute: lookup — worker hidden, has paths and a question', () => {
  const out = decideRoute(
    fence({
      intent: 'lookup',
      paths: ['library/files/doc-2.md'],
      question: 'What is the main content?',
    }),
  );
  assert.equal(out.intent, 'lookup');
  assert.ok(out.intent === 'lookup');
  assert.deepEqual(out.paths, ['library/files/doc-2.md']);
});

test('decideRoute: lookup with NO paths is still valid — that is a web-search question', () => {
  const out = decideRoute(fence({ intent: 'lookup', paths: [], question: "today's weather" }));
  assert.equal(out.intent, 'lookup');
  assert.ok(out.intent === 'lookup');
  assert.deepEqual(out.paths, []);
});

test('decideRoute: lookup MISSING the paths key entirely is also valid, and yields an empty array', () => {
  const out = decideRoute(fence({ intent: 'lookup', question: "today's news" }));
  assert.ok(out.intent === 'lookup');
  assert.deepEqual(out.paths, []);
});

test('decideRoute: lookup MISSING question still does not get through — the question is mandatory', () => {
  assert.equal(decideRoute(fence({ intent: 'lookup', paths: [] })).intent, 'garbled');
});

test('decideRoute: when the model returns a whole PLAN, pick it up — do not dump it onto chat', () => {
  const leaked = fence({
    steps: ['Pull 10 terms from the translated table'],
    tasks: [
      {
        task_id: 'T-01',
        role: 'translator',
        goal: 'Open the doc-1 glossary and list exactly 10 terms',
        inputs: [{ path: 'artifacts/P-260820-0533-mreo/T-01/vi/doc-1-glossary.md' }],
        outputs: [{ path: 'artifacts/T-01/10-terms.md' }],
        constraints: ['Keep the 3-column table format'],
        deps: [],
        step: 0,
        deliver: 'reply',
      },
    ],
  });

  const out = decideRoute(leaked);
  assert.equal(out.intent, 'plan');
  assert.ok(out.intent === 'plan');
  assert.equal(out.draft.tasks[0]!.role, 'translator');
  assert.equal('say' in out, false);
});

test('decideRoute: an {"ask"} from the planning stage is also a valid question', () => {
  assert.deepEqual(decideRoute(fence({ ask: 'Which doc do you want this from?' })), {
    intent: 'ask',
    say: 'Which doc do you want this from?',
  });
});

test('decideRoute: plain prose still gets shown', () => {
  const out = decideRoute('Hi, I am this office\'s assistant.');
  assert.deepEqual(out, { intent: 'chat', say: 'Hi, I am this office\'s assistant.' });
});

test('decideRoute: JSON matching no schema must NOT surface to the user', () => {
  const junk = fence({ intent: 'task' });
  const out = decideRoute(junk);
  assert.equal(out.intent, 'garbled');
  assert.ok(out.intent === 'garbled');
  assert.equal(/[{}]/.test(out.say), false);
  assert.ok(out.raw.includes('"intent"'));
});

test('decideRoute: when the model returns nothing, correctly report it as a transport failure', () => {
  const out = decideRoute('   ');
  assert.equal(out.intent, 'garbled');
  assert.ok(out.intent === 'garbled');
  assert.ok(out.say.includes('đường truyền')); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
  assert.equal(out.raw, '');
});


test('buildPlan: drops steps with no task, and renumbers what remains', () => {
  const p = buildPlan(
    draft([draftTask({ step: 2 })], ['Prepare', 'Save the result', 'Write the article']),
    'r',
    'P-x',
    'file',
  );
  assert.deepEqual(
    p.steps.map((s) => s.title),
    ['Write the article'],
  );
  assert.equal(p.tasks[0]!.step, 0);
});

test('buildPlan: a missing `deliver` falls back to the OFFICE default, not the schema default', () => {
  const withDefault = buildPlan(draft([draftTask()]), 'r', 'P-x', 'reply');
  assert.equal(withDefault.tasks[0]!.deliver, 'reply');

  const explicit = buildPlan(draft([draftTask({ deliver: 'file' })]), 'r', 'P-x', 'reply');
  assert.equal(explicit.tasks[0]!.deliver, 'file');
});

test('buildPlan: an input pointing at a DIFFERENT plan is left as-is, outputs are always rewritten', () => {
  const p = buildPlan(
    draft([
      draftTask({
        inputs: [{ path: 'artifacts/P-old/T-01/vi/glossary.md' }],
        outputs: [{ path: 'artifacts/vi/10-terms.md' }],
      }),
    ]),
    'r',
    'P-new',
    'file',
  );
  assert.equal(p.tasks[0]!.inputs[0]!.path, 'artifacts/P-old/T-01/vi/glossary.md');
  assert.equal(p.tasks[0]!.outputs[0]!.path, 'artifacts/P-new/T-01/vi/10-terms.md');
});

test('buildPlan: a path pointing at a task WITHIN this same plan gets rewritten', () => {
  const p = buildPlan(
    draft([
      draftTask({ task_id: 'T-01' }),
      draftTask({ task_id: 'T-02', inputs: [{ path: 'artifacts/T-01/result.md' }] }),
    ]),
    'r',
    'P-new',
    'file',
  );
  assert.equal(p.tasks[1]!.inputs[0]!.path, 'artifacts/P-new/T-01/result.md');
});


const pair = (p: string) => ({ ref: p, open: p });
const KNOWN = [
  pair('library/files/doc-1.md'),
  pair('library/files/doc-2.md'),
  pair('artifacts/P-01/T-01/vi/doc-1.md'),
  { ref: 'library/files/hd1.docx', open: 'library/text/hd1.docx.txt' },
];

test('pickReadable: the worker-hidden `lookup` also gets the OPENABLE path, not the original', () => {
  assert.deepEqual(pickReadable(['library/files/hd1.docx'], KNOWN), {
    ok: ['library/text/hd1.docx.txt'],
    missing: [],
  });
  assert.deepEqual(pickReadable(['hd1.docx'], KNOWN), {
    ok: ['library/text/hd1.docx.txt'],
    missing: [],
  });
});

test('pickReadable: a full path is accepted, and a unique bare name is too', () => {
  assert.deepEqual(pickReadable(['library/files/doc-2.md'], KNOWN), {
    ok: ['library/files/doc-2.md'],
    missing: [],
  });
  assert.deepEqual(pickReadable(['doc-2.md'], KNOWN), {
    ok: ['library/files/doc-2.md'],
    missing: [],
  });
});

test('pickReadable: a bare name that collides across two locations is NOT guessed', () => {
  assert.deepEqual(pickReadable(['doc-1.md'], KNOWN), { ok: [], missing: ['doc-1.md'] });
});

test('pickReadable: a made-up file is dropped, a real one still goes through', () => {
  assert.deepEqual(pickReadable(['library/files/doc-2.md', 'library/files/does-not-exist.md'], KNOWN), {
    ok: ['library/files/doc-2.md'],
    missing: ['library/files/does-not-exist.md'],
  });
});

test('pickReadable: duplicates and backslashes do not produce two reads', () => {
  assert.deepEqual(pickReadable(['doc-2.md', 'library\\files\\doc-2.md', ' '], KNOWN), {
    ok: ['library/files/doc-2.md'],
    missing: [],
  });
});

// readingNote runs through the app's i18n catalog (default locale vi), so these assertions match
// real Vietnamese product output, not stray untranslated source text.
test('readingNote: names the files, cuts off at 2, counts the rest', () => {
  assert.equal(readingNote(['library/files/doc-2.md']), 'Đang đọc doc-2.md…'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
  assert.equal(
    readingNote(['library/files/doc-1.md', 'artifacts/P-01/T-01/vi/doc-1.md']),
    'Đang đọc doc-1.md, doc-1.md…', // i18n-allow-vietnamese: matches real i18n string (default locale vi)
  );
  assert.equal(
    readingNote(['a/1.md', 'b/2.md', 'c/3.md', 'd/4.md']),
    'Đang đọc 1.md, 2.md và 2 file nữa…', // i18n-allow-vietnamese: matches real i18n string (default locale vi)
  );
});


test('requestOf: the task name is derived from goal, multiple tasks get joined', () => {
  assert.equal(requestOf(draft([draftTask({ goal: 'List 10 terms' })])), 'List 10 terms');
  assert.equal(
    requestOf(draft([draftTask({ goal: 'Translate doc-1' }), draftTask({ goal: 'Proofread the translation' })])),
    'Translate doc-1 · Proofread the translation',
  );
});


const REAL_CASE =
  '```json\n{"say":"The GitHub connection no longer exists, so I cannot read the README of the ' +
  'toeic-learning repo right now. You need to reconnect GitHub for this office before I can continue."}\n```';

test('🔴 `{"say"}` missing `intent` ⇒ SALVAGE it, do not discard — and keep the model\'s wording VERBATIM', () => {
  const r = decideRoute(REAL_CASE);
  assert.equal(r.intent, 'chat', 'must go through the chat door, not garbled');
  assert.match((r as { say: string }).say, /The GitHub connection no longer exists/);
  assert.doesNotMatch((r as { say: string }).say, /format/, 'must not be replaced with OUR sentence');
});

test('⭐ a salvage case must DECLARE ITSELF — a silent salvage door is a comfortable trap', () => {
  assert.equal((decideRoute(REAL_CASE) as { salvaged?: true }).salvaged, true);
  assert.equal(
    (decideRoute('{"intent":"chat","say":"hello"}') as { salvaged?: true }).salvaged,
    undefined,
    'the MAIN door does not get flagged — otherwise the log fills with noise',
  );
});

test('⭐ a made-up unknown `intent` name is still salvaged', () => {
  const r = decideRoute('{"intent":"answer","say":"I have not read that repo yet."}');
  assert.equal(r.intent, 'chat');
  assert.equal((r as { say: string }).say, 'I have not read that repo yet.');
});

test('🔴 DOOR 4 MUST NOT SWALLOW A PLAN — the try order is an invariant', () => {
  assert.equal(decideRoute(JSON.stringify(draft([draftTask()]))).intent, 'plan');
});

test('🔴 the final fallback message must NOT tell the user to "resend the exact same message"', () => {
  const r = decideRoute('{"tasks": "not shaped like anything we recognize"}');
  assert.equal(r.intent, 'garbled');
  const say = (r as { say: string }).say;
  assert.doesNotMatch(say, /y nguyên/i); // i18n-allow-vietnamese: checks real i18n string (default locale vi) does not say "resend the exact same message"
  assert.doesNotMatch(say, /lỗi của bạn/i, 'must not guess at a cause — we do not know it'); // i18n-allow-vietnamese: checks real i18n string (default locale vi)
  assert.match(say, /theo cách khác|chia nhỏ/i, 'must leave a path forward DIFFERENT from what was just tried'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
});

test('🔴 broken JSON must still NOT leak verbatim to the user-facing side', () => {
  const r = decideRoute('{"tasks": "not shaped like anything we recognize"}');
  assert.doesNotMatch((r as { say: string }).say, /tasks/);
});

test('ordinary prose still goes through the chat door as before', () => {
  const r = decideRoute('Hi there! What can I help with?');
  assert.equal(r.intent, 'chat');
  assert.equal((r as { salvaged?: true }).salvaged, undefined);
});
