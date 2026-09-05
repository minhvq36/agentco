
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { worthLearning } from '../dist/core/assistant.js';
import { echoesLibrary } from '../dist/knowledge/store.js';

type Receipt = Parameters<typeof worthLearning>[0][number];

const receipt = (patch: Partial<Receipt> = {}): Receipt =>
  ({
    status: 'done',
    say: 'done',
    artifacts: [],
    lessons: [],
    blocked_on: null,
    task_id: 'T-01',
    role: 'responder',
    reasked: false,
    landed: [],
    wall_ms: 1000,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: 'haiku', turns: 4 },
    ...patch,
  }) as Receipt;


test('worthLearning: a smooth run does NOT get asked for a lesson', () => {
  assert.equal(worthLearning([receipt()]), false);
});

test('worthLearning: many turns is NOT a signal — that is a property of the model', () => {
  assert.equal(worthLearning([receipt({ usage: { ...receipt().usage, turns: 9 } })]), false);
  assert.equal(worthLearning([receipt({ usage: { ...receipt().usage, turns: 30 } })]), false);
});

test('worthLearning: a task that FAILED OUTRIGHT does NOT ask — a broken run does not prove "cannot be done"', () => {
  assert.equal(worthLearning([receipt(), receipt({ status: 'failed' })]), false);
});

test('worthLearning: blocked does NOT ask — this is exactly where the ratchet would grow', () => {
  assert.equal(worthLearning([receipt({ status: 'blocked', blocked_on: 'missing file' })]), false);
});

test('worthLearning: REACHING THE GOAL despite a stumble still asks', () => {
  assert.equal(worthLearning([receipt({ status: 'done', blocked_on: 'missing glossary file' })]), true);
});

test('worthLearning: having to redo the receipt means something went wrong', () => {
  assert.equal(worthLearning([receipt({ reasked: true })]), true);
});

test('worthLearning: an empty plan produces no lesson', () => {
  assert.equal(worthLearning([]), false);
});


const DOI_TRA = [
  'doi-tra.md',
  '# Chính Sách Đổi Trả', // i18n-allow-vietnamese: library document fixture fed into echoesLibrary's near-verbatim matching under test
  'Hỗ trợ đổi trả trong vòng 7 ngày kể từ ngày nhận được hàng.', // i18n-allow-vietnamese: library document fixture
  'Sản phẩm còn nguyên tem mác, hộp đựng, chưa qua sử dụng.', // i18n-allow-vietnamese: library document fixture
  'Lưu ý quan trọng: Hàng giảm giá trên 50% KHÔNG áp dụng chính sách đổi trả.', // i18n-allow-vietnamese: library document fixture
  'Phí ship chiều gửi đổi hàng do khách hàng tự chi trả.', // i18n-allow-vietnamese: library document fixture
].join('\n');

test('echoesLibrary: blocks a near-verbatim copy of one sentence in the document', () => {
  const lesson = 'Hàng giảm giá trên 50% không áp dụng chính sách đổi trả.'; // i18n-allow-vietnamese: lesson text fed into echoesLibrary under test
  assert.equal(echoesLibrary(lesson, [DOI_TRA]), 'doi-tra.md');
});

test('echoesLibrary: a LOOSE paraphrase passes through — that is a choice, not a bug', () => {
  const lesson = // i18n-allow-vietnamese: lesson text fed into echoesLibrary under test
    'Sản phẩm giảm giá 60% thường không được đổi trả theo chính sách shop ' + // i18n-allow-vietnamese: lesson text fed into echoesLibrary under test
    '- cần kiểm tra trước khi soạn câu trả lời đổi/trả.'; // i18n-allow-vietnamese: lesson text fed into echoesLibrary under test
  assert.equal(echoesLibrary(lesson, [DOI_TRA]), undefined);
});

test('echoesLibrary: a lesson about HOW TO WORK passes through', () => {
  const lesson = 'Khách hỏi gấp thì trả lời trước bằng bản nháp ngắn, hoàn thiện sau.'; // i18n-allow-vietnamese: lesson text fed into echoesLibrary under test
  assert.equal(echoesLibrary(lesson, [DOI_TRA]), undefined);
});

test('echoesLibrary: a lesson on the same topic as the document must still pass', () => {
  const lesson = 'Khi khách hỏi đổi trả, luôn hỏi mã đơn hàng trước khi trả lời.'; // i18n-allow-vietnamese: lesson text fed into echoesLibrary under test
  assert.equal(echoesLibrary(lesson, [DOI_TRA]), undefined);
});

test('echoesLibrary: an empty cabinet blocks nothing', () => {
  assert.equal(echoesLibrary('Hàng giảm giá trên 50% không áp dụng đổi trả.', []), undefined); // i18n-allow-vietnamese: lesson text fed into echoesLibrary under test
});

test('echoesLibrary: a sentence that is too short is not scored', () => {
  assert.equal(echoesLibrary('đổi trả', [DOI_TRA]), undefined); // i18n-allow-vietnamese: lesson text fed into echoesLibrary under test
});

test('echoesLibrary: just one matching document is enough, no need to match them all', () => {
  const other = 'bang-gia.md\nÁo thun 200k, quần jean 450k, váy 380k.'; // i18n-allow-vietnamese: library document fixture fed into echoesLibrary under test
  const lesson = 'Hàng giảm giá trên 50% không áp dụng chính sách đổi trả theo quy định shop.'; // i18n-allow-vietnamese: lesson text fed into echoesLibrary under test
  assert.equal(echoesLibrary(lesson, [other, DOI_TRA]), 'doi-tra.md');
});

test('echoesLibrary: names the EXACT file so the user can verify it', () => {
  const lesson = 'Phí ship chiều gửi đổi hàng do khách hàng tự chi trả theo chính sách.'; // i18n-allow-vietnamese: lesson text fed into echoesLibrary under test
  assert.equal(echoesLibrary(lesson, [DOI_TRA]), 'doi-tra.md');
});
