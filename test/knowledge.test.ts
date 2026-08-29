/**
 * Test cho hai chốt giữ kho tri thức không nhiễm nội dung tài liệu (19/08).
 *
 * Cả hai đều là hàm thuần, và cả hai đều thi hành một bất biến trước đây chỉ
 * tồn tại trên giấy:
 *
 *  · `worthLearning`  — "ca chạy trơn tru không sinh ra bài học"
 *  · `echoesLibrary`  — "node tri thức ≠ file người dùng tải lên" (SPEC-library §1)
 *
 * Ca thật đã đẻ ra bug: một ca 1 việc, `done`, không trục trặc gì, vẫn ghi vào
 * kho chung một câu diễn giải LỆCH chính sách của shop ("giảm 60% thường không
 * được đổi trả" — trong khi tài liệu viết "trên 50% không đổi trả").
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { worthLearning } from '../dist/core/assistant.js';
import { echoesLibrary } from '../dist/knowledge/store.js';

type Receipt = Parameters<typeof worthLearning>[0][number];

const receipt = (patch: Partial<Receipt> = {}): Receipt =>
  ({
    status: 'done',
    say: 'xong',
    artifacts: [],
    lessons: [],
    blocked_on: null,
    task_id: 'T-01',
    role: 'nguoi-tra-loi',
    reasked: false,
    // ⚠ `landed` PHẢI có: `learnable` đi qua `delivered()`, và `delivered` hỏi
    // "có gì đáp xuống không" chứ không tin `status`. Fixture thiếu trường này
    // thì test nổ ở chỗ chẳng liên quan gì tới thứ nó đang kiểm.
    landed: [],
    wall_ms: 1000,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: 'haiku', turns: 4 },
    ...patch,
  }) as Receipt;

// ─────────────────────────────────────────────────────── worthLearning

/** ĐÂY LÀ TEST CHO ĐÚNG CA 19/08 đã đẻ ra node rác. */
test('worthLearning: ca chạy trơn tru KHÔNG được hỏi bài học', () => {
  assert.equal(worthLearning([receipt()]), false);
});

/**
 * Ca 19/08 nguyên bản: `done`, không reask, không blocked — nhưng **9 lượt**.
 *
 * Bản nháp đầu của `worthLearning` có thêm điều kiện `turns >= 8`, và test này
 * là thứ bác bỏ nó: điều kiện đó cho qua đúng cái ca nó sinh ra để chặn. Số
 * lượt là thuộc tính của MODEL (haiku 10 vs sonnet 4 cho cùng một việc — §7),
 * không phải dấu hiệu trục trặc.
 */
test('worthLearning: nhiều lượt KHÔNG phải dấu hiệu — đó là thuộc tính của model', () => {
  assert.equal(worthLearning([receipt({ usage: { ...receipt().usage, turns: 9 } })]), false);
  assert.equal(worthLearning([receipt({ usage: { ...receipt().usage, turns: 30 } })]), false);
});

/**
 * ⚠ HAI TEST NÀY ĐÃ BỊ LẬT NGƯỢC 29/08 — trước đó chúng khẳng định điều ngược
 * lại (*"có việc hỏng thì hỏi"* · *"bị chặn thì hỏi"*). Giữ lại lịch sử ấy ngay
 * đây, vì cái sai cũ nghe rất hợp lý: ca hỏng đúng là lúc có nhiều chuyện xảy
 * ra nhất. Thứ nó bỏ qua là **bài học sẽ được đọc lại lúc nào**.
 * Lý do đầy đủ + số đo: `assistant.ts §learnable`.
 */
test('worthLearning: việc HỎNG HẲN thì KHÔNG hỏi — ca hỏng không chứng minh "không làm được"', () => {
  assert.equal(worthLearning([receipt(), receipt({ status: 'failed' })]), false);
});

test('worthLearning: bị chặn thì KHÔNG hỏi — đây đúng là chỗ bánh cóc mọc ra', () => {
  assert.equal(worthLearning([receipt({ status: 'blocked', blocked_on: 'thiếu file' })]), false);
});

/** Vế còn lại: đi đến đích NHƯNG có vấp — đó mới là bài học. */
test('worthLearning: ĐI ĐẾN ĐÍCH dù có vấp thì vẫn hỏi', () => {
  assert.equal(worthLearning([receipt({ status: 'done', blocked_on: 'thiếu file thuật ngữ' })]), true);
});

test('worthLearning: phải sửa lại receipt nghĩa là có trục trặc', () => {
  assert.equal(worthLearning([receipt({ reasked: true })]), true);
});

test('worthLearning: kế hoạch rỗng không sinh bài học', () => {
  assert.equal(worthLearning([]), false);
});

// ─────────────────────────────────────────────────────── echoesLibrary

const DOI_TRA = [
  'doi-tra.md',
  '# Chính Sách Đổi Trả',
  'Hỗ trợ đổi trả trong vòng 7 ngày kể từ ngày nhận được hàng.',
  'Sản phẩm còn nguyên tem mác, hộp đựng, chưa qua sử dụng.',
  'Lưu ý quan trọng: Hàng giảm giá trên 50% KHÔNG áp dụng chính sách đổi trả.',
  'Phí ship chiều gửi đổi hàng do khách hàng tự chi trả.',
].join('\n');

test('echoesLibrary: chặn bản chép gần nguyên văn một câu trong tài liệu', () => {
  const lesson = 'Hàng giảm giá trên 50% không áp dụng chính sách đổi trả.';
  assert.equal(echoesLibrary(lesson, [DOI_TRA]), 'doi-tra.md');
});

/**
 * ⚠ GIỚI HẠN ĐÃ BIẾT, ghi lại để đừng ai tưởng hàm này là hàng rào.
 *
 * Đây là câu THẬT Trợ lý ghi vào kho chung ngày 19/08. Nó diễn giải khá xa bản
 * gốc (đổi "trên 50%" thành "60%", thêm chữ "thường") nên chồng từ chỉ ~0.47 —
 * LỌT qua lưới này. Hàng rào thật cho ca đó là `worthLearning`: ca chạy sạch
 * nên lẽ ra không bao giờ được hỏi bài học.
 *
 * Nếu ngày nào đó hàm này bắt được câu dưới đây, hãy kiểm ngay xem ngưỡng có bị
 * hạ xuống quá không — cái giá của việc bắt được nó là chặn nhầm bài học thật.
 */
test('echoesLibrary: bản diễn giải LỎNG thì lọt — và đó là lựa chọn, không phải lỗi', () => {
  const lesson =
    'Sản phẩm giảm giá 60% thường không được đổi trả theo chính sách shop ' +
    '- cần kiểm tra trước khi soạn câu trả lời đổi/trả.';
  assert.equal(echoesLibrary(lesson, [DOI_TRA]), undefined);
});

test('echoesLibrary: bài học về CÁCH LÀM VIỆC thì cho qua', () => {
  const lesson = 'Khách hỏi gấp thì trả lời trước bằng bản nháp ngắn, hoàn thiện sau.';
  assert.equal(echoesLibrary(lesson, [DOI_TRA]), undefined);
});

/**
 * Guard chống báo nhầm — quan trọng hơn cả việc bắt được nhiều.
 *
 * Bài học này nói cùng CHỦ ĐỀ với tài liệu (đổi trả, khách, hàng) nên nó chạm
 * ~0.4 số từ. Nếu ai đó hạ ngưỡng xuống cho vừa ca 19/08 thì câu này chết theo,
 * và ta mất đúng loại bài học mà kho tri thức sinh ra để giữ.
 */
test('echoesLibrary: bài học cùng chủ đề với tài liệu vẫn phải qua được', () => {
  const lesson = 'Khi khách hỏi đổi trả, luôn hỏi mã đơn hàng trước khi trả lời.';
  assert.equal(echoesLibrary(lesson, [DOI_TRA]), undefined);
});

test('echoesLibrary: tủ rỗng thì không chặn gì', () => {
  assert.equal(echoesLibrary('Hàng giảm giá trên 50% không áp dụng đổi trả.', []), undefined);
});

/**
 * Bài học rất ngắn có quá ít từ để so — ép nó qua ngưỡng tỉ lệ sẽ toàn báo
 * nhầm. Thà lọt một câu ngắn còn hơn chặn nhầm một bài học thật.
 */
test('echoesLibrary: câu quá ngắn thì không chấm', () => {
  assert.equal(echoesLibrary('đổi trả', [DOI_TRA]), undefined);
});

test('echoesLibrary: chỉ một tài liệu trùng là đủ, không cần trùng hết', () => {
  const other = 'bang-gia.md\nÁo thun 200k, quần jean 450k, váy 380k.';
  const lesson = 'Hàng giảm giá trên 50% không áp dụng chính sách đổi trả theo quy định shop.';
  assert.equal(echoesLibrary(lesson, [other, DOI_TRA]), 'doi-tra.md');
});

test('echoesLibrary: nêu ĐÚNG TÊN file để người dùng kiểm được', () => {
  const lesson = 'Phí ship chiều gửi đổi hàng do khách hàng tự chi trả theo chính sách.';
  assert.equal(echoesLibrary(lesson, [DOI_TRA]), 'doi-tra.md');
});
