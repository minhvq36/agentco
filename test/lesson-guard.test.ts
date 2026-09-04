
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { learnable, newPlanId, worthLearning } from '../dist/core/assistant.js';
import { quotesLibraryNumber } from '../dist/knowledge/store.js';
import { enforceCap } from '../dist/core/receipt.js';

type Receipt = Parameters<typeof worthLearning>[0][number];

const receipt = (patch: Partial<Receipt> = {}): Receipt =>
  ({
    status: 'done',
    say: 'done',
    answer: '',
    artifacts: [],
    lessons: [],
    blocked_on: null,
    task_id: 'T-01',
    role: 'responder',
    reasked: false,
    looped: false,
    reads: [],
    landed: [],
    wall_ms: 1000,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: 'haiku', turns: 4 },
    ...patch,
  }) as Receipt;


const DOI_TRA = // i18n-allow-vietnamese: library document fixture fed into quotesLibraryNumber's number-matching logic
  'doi-tra.md\n# Chính Sách Đổi Trả\n' + // i18n-allow-vietnamese: library document fixture
  'Hỗ trợ đổi trả trong vòng 7 ngày kể từ ngày nhận được hàng.\n' + // i18n-allow-vietnamese: library document fixture
  'Lưu ý quan trọng: Hàng giảm giá trên 50% KHÔNG áp dụng chính sách đổi trả.'; // i18n-allow-vietnamese: library document fixture

test('NUMBER: catches the 19/08 case that echoesLibrary MEASURED as a leak', () => {
  assert.equal(
    quotesLibraryNumber('sản phẩm giảm 60% thường không được đổi trả cho khách', [DOI_TRA]), // i18n-allow-vietnamese: lesson text fed into quotesLibraryNumber under test
    undefined,
    '60 is NOT in the document — this gate must not make up a number to block on',
  );
  assert.equal(quotesLibraryNumber('hàng giảm trên 50% thì không đổi trả được', [DOI_TRA]), '50'); // i18n-allow-vietnamese: lesson text fed into quotesLibraryNumber under test
  assert.equal(quotesLibraryNumber('nhớ là chỉ đổi trả trong 7 ngày thôi', [DOI_TRA]), undefined, // i18n-allow-vietnamese: lesson text fed into quotesLibraryNumber under test
    '7 has only ONE digit so it is skipped — a step counter touching the document too easily');
});

test('NUMBER: a lesson about HOW TO WORK that carries its own number must still pass', () => {
  assert.equal(
    quotesLibraryNumber('hỏi lại tối đa 2 câu rồi bắt tay vào làm, đừng hỏi vòng', [DOI_TRA]), // i18n-allow-vietnamese: lesson text fed into quotesLibraryNumber under test
    undefined,
  );
  assert.equal(
    quotesLibraryNumber('grep trong library/text/ trước khi trả lời chính sách', [DOI_TRA]), // i18n-allow-vietnamese: lesson text fed into quotesLibraryNumber under test
    undefined,
    'a HOW-TO sentence with no number at all — this is the lesson shape we WANT',
  );
});

test('NUMBER: digit boundary — 50 must not match inside 150 or 500', () => {
  const doc = 'bang-gia.md\nÁo khoác: 500.000đ. Quần: 150000đ.'; // i18n-allow-vietnamese: library document fixture fed into quotesLibraryNumber under test
  assert.equal(quotesLibraryNumber('giảm trên 50% thì thôi', [doc]), undefined); // i18n-allow-vietnamese: lesson text fed into quotesLibraryNumber under test
  assert.equal(quotesLibraryNumber('áo khoác giá 500.000đ', [doc]), '500.000'); // i18n-allow-vietnamese: lesson text fed into quotesLibraryNumber under test
});


test('worthLearning: a smooth run does NOT ask, even after 9 turns', () => {
  const nineTurns = receipt({
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: 'haiku', turns: 9 },
  });
  assert.equal(worthLearning([nineTurns]), false);
});

test('worthLearning: a REPEATED ACTION asks — this is the "looped flow" measured correctly', () => {
  assert.equal(worthLearning([receipt({ looped: true })]), true);
  assert.equal(worthLearning([receipt({ reasked: true })]), true);
  assert.equal(worthLearning([receipt({ blocked_on: 'missing file' })]), true);
  assert.equal(worthLearning([receipt({ status: 'failed' })]), false);
});

test('worthLearning: just ONE repeated task in the whole batch is enough to ask', () => {
  assert.equal(worthLearning([receipt(), receipt({ task_id: 'T-02', looped: true })]), true);
});


test('worthLearning: every NOT-DONE shape produces no lesson', () => {
  for (const s of ['failed', 'blocked', 'needs_human'] as const) {
    assert.equal(worthLearning([receipt({ status: s, blocked_on: 'could not reach the page' })]), false, s);
    assert.equal(worthLearning([receipt({ status: s, looped: true })]), false, `${s} + looped`);
  }
});

test('worthLearning: one done-with-a-stumble task + one broken task → STILL asks (and the ⟵ mark points at the right line only)', () => {
  const done = receipt({ task_id: 'T-01', looped: true });
  const blocked = receipt({ task_id: 'T-02', status: 'blocked', blocked_on: 'missing permission' });
  assert.equal(worthLearning([done, blocked]), true);
  assert.equal(learnable(done), true);
  assert.equal(learnable(blocked), false, 'the broken line must NOT be used as a source, even once the gate is open');
});

test('learnable: claiming `done` with NOTHING actually landed is not experience', () => {
  const declared = receipt({
    status: 'done',
    looped: true,
    artifacts: ['artifacts/T-01/result.md'], // claims a file exists…
    landed: [], // …but no landing point is observable
  } as Partial<Receipt>);
  assert.equal(learnable(declared), true, 'declaring artifacts still counts — `delivered` accepts either one');

  const empty = receipt({ status: 'done', artifacts: [], landed: [] } as Partial<Receipt>);
  assert.equal(learnable(empty), false, 'a perfectly clean run with no stumble is not worth saving');
});


test('worthLearning: a run with a CASE-level warning does NOT ask, even with a done-with-a-stumble task', () => {
  const ok = receipt({ looped: true });
  assert.equal(worthLearning([ok], 0, false), true, 'control: no leak still asks');
  assert.equal(worthLearning([ok], 0, true), false, 'a promised file missing / out of scope ⇒ stay quiet');
});

test('worthLearning: a warning does NOT block the friction branch — that layer learns about people', () => {
  assert.equal(worthLearning([receipt()], 3, true), true);
});

test('learnable: a lesson the worker self-reported from an unfinished run is blocked at the deterministic gate', () => {
  const r = receipt({
    status: 'blocked',
    blocked_on: 'permission denied for browser_navigate',
    lessons: [{ kind: 'pitfall', text: 'when permission is denied, report blocked right away instead of retrying' }],
  } as Partial<Receipt>);
  assert.equal(learnable(r), false, 'a worker never goes through worthLearning, so the gate must stand here');
});


test('worthLearning: the machine runs CLEAN but the user has to repeat themselves → STILL asks', () => {
  assert.equal(worthLearning([receipt(), receipt({ task_id: 'T-02' })]), false, 'control: no friction stays quiet');
  assert.equal(worthLearning([receipt(), receipt({ task_id: 'T-02' })], 3), true);
});

test('worthLearning: friction of 0 does NOT change the old behavior', () => {
  assert.equal(worthLearning([receipt()], 0), false);
  assert.equal(worthLearning([receipt({ looped: true })], 0), true);
});


test('enforceCap: answer does NOT eat into the receipt cap', () => {
  const long = 'Chính sách bảo hành của shop là 12 tháng. '.repeat(40); // i18n-allow-vietnamese: arbitrary long filler content for cap-truncation testing
  const out = enforceCap(
    {
      status: 'done',
      say: 'Replied to the customer about the warranty policy.',
      answer: long,
      gist: '',
      artifacts: ['artifacts/P-260819-1430-ab12/T-01/reply.md'],
      lessons: [{ kind: 'pitfall', text: 'grep in library/text/ before replying' }],
      blocked_on: null,
    },
    200,
  );
  assert.equal(out.lessons.length, 1, 'lessons must survive: answer must not count toward the cap');
  assert.ok(out.say.length > 0);
  assert.ok(out.answer.length > 0);
  assert.ok(out.answer.length < long.length, 'answer still has its OWN cap');
});


const capFixture = (patch: Record<string, unknown> = {}) => ({
  status: 'done' as const,
  say: 'Finished looking up the task list.',
  answer: '',
  gist: '',
  artifacts: ['artifacts/P-1/T-01/out.md'],
  lessons: [] as { kind: 'pitfall'; text: string }[],
  blocked_on: null,
  ...patch,
});

test('enforceCap: `gist` HAS its own cap — no matter how long, it gets truncated', () => {
  const long = 'Việc AGE-1 đang chạy, việc AGE-2 chờ duyệt. '.repeat(40); // i18n-allow-vietnamese: arbitrary long filler content for cap-truncation testing
  const out = enforceCap(capFixture({ gist: long }), 800);
  assert.ok(out.gist.length > 0, 'must not be dropped entirely — the Assistant needs events to anchor on');
  assert.ok(out.gist.length < long.length, 'but it must be truncated');
});

test('🔴 enforceCap: `gist` COUNTS toward the receipt cap — the opposite of `answer`', () => {
  const long = 'Việc AGE-1 đang chạy, việc AGE-2 chờ duyệt. '.repeat(40); // i18n-allow-vietnamese: arbitrary long filler content for cap-truncation testing
  const out = enforceCap(capFixture({ gist: long, say: 'x'.repeat(400) }), 120);
  assert.ok(out.gist.length < long.length);
  assert.ok(out.say.length < 400, 'the cap is really enforced, not just trimming gist alone');
});

test('⭐ enforceCap: sacrifice ladder — `lessons` dies BEFORE `gist`', () => {
  const out = enforceCap(
    capFixture({
      gist: 'Ba việc In Progress: AGE-3, AGE-7, AGE-9.', // i18n-allow-vietnamese: arbitrary filler content for cap-truncation testing
      lessons: [{ kind: 'pitfall' as const, text: 'x'.repeat(300) }],
      say: 'y'.repeat(200),
    }),
    90,
  );
  assert.equal(out.lessons.length, 0, 'lessons is sacrificed first');
  assert.ok(out.gist.length > 0, 'gist still has something left');
});

test('⭐ enforceCap: an empty `gist` stays empty, never fabricated', () => {
  assert.equal(enforceCap(capFixture(), 800).gist, '');
});

test('📌 enforceCap: `gist` keeps line breaks — bullet points are part of the content', () => {
  const out = enforceCap(capFixture({ gist: '- AGE-3 chậm\n- AGE-7 lỗi đăng nhập' }), 800); // i18n-allow-vietnamese: arbitrary filler content for cap-truncation testing
  assert.ok(out.gist.includes('\n'), 'must not be collapsed onto a single line');
});


test('newPlanId: a readable shape, and lexicographic sort still matches time order', () => {
  const id = newPlanId();
  assert.match(id, /^P-\d{6}-\d{4}-[a-z0-9]{4}$/, `unexpected shape: ${id}`);
  assert.ok('P-260819-1430-aaaa' < 'P-260819-1431-aaaa');
  assert.ok('P-260819-2359-zzzz' < 'P-260820-0000-aaaa');
});
