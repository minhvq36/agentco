/**
 * Test cho ĐỢT SIẾT KHO TRI THỨC 19/08 — bốn luật, và mỗi luật che một ca khác.
 *
 * Đề bài của người dùng: *"cơ chế ghi lại kinh nghiệm đang tự tạo một cache, và
 * rất có thể cache này SAI khi người dùng update tài liệu."*
 *
 *   1. chỉ ghi CÁCH LÀM, không ghi KIẾN THỨC   → che ca tài liệu BỊ SỬA
 *   2. thực thể yếu (`depends_on`)             → che ca tài liệu BỊ XOÁ
 *   3. chỉ sinh khi ca có trục trặc / LẶP      → che ca "sinh ra từ hư không"
 *   4. không spam bản na ná nhau               → che ca kho phình vì lặp
 *
 * ⚠ Luật 1 và 2 KHÔNG thay thế được nhau, và đó là điểm dễ hiểu nhầm nhất:
 * weak-entity chỉ nổ khi file BIẾN MẤT. File bị SỬA (chính sách 50% → 30%) thì
 * nó im lặng — ca đó chỉ luật 1 cứu được. Bộ test này ghim cả hai nửa.
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { newPlanId, worthLearning } from '../dist/core/assistant.js';
import { quotesLibraryNumber } from '../dist/knowledge/store.js';
import { enforceCap } from '../dist/core/receipt.js';

type Receipt = Parameters<typeof worthLearning>[0][number];

const receipt = (patch: Partial<Receipt> = {}): Receipt =>
  ({
    status: 'done',
    say: 'xong',
    answer: '',
    artifacts: [],
    lessons: [],
    blocked_on: null,
    task_id: 'T-01',
    role: 'nguoi-tra-loi',
    reasked: false,
    looped: false,
    reads: [],
    wall_ms: 1000,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: 'haiku', turns: 4 },
    ...patch,
  }) as Receipt;

// ───────────────────────────────── luật 1: chốt chặn CON SỐ

/**
 * Bản văn tủ tài liệu thật của văn phòng `ho-tro-khach`, cắt gọn.
 * Con số 50 ở đây là thứ toàn bộ nhóm test này xoay quanh.
 */
const DOI_TRA =
  'doi-tra.md\n# Chính Sách Đổi Trả\n' +
  'Hỗ trợ đổi trả trong vòng 7 ngày kể từ ngày nhận được hàng.\n' +
  'Lưu ý quan trọng: Hàng giảm giá trên 50% KHÔNG áp dụng chính sách đổi trả.';

test('CON SỐ: bắt được đúng ca 19/08 mà echoesLibrary đã ĐO ĐƯỢC là lọt', () => {
  // Câu thật đã chui vào `k/shared/san-pham-giam-gia-60-…`. Chồng từ với tài
  // liệu chỉ ~0.47 — dưới ngưỡng 0.6 của `echoesLibrary`, nên lưới đó không
  // bắt được. Nhưng con số thì sống sót qua mọi cách diễn giải.
  assert.equal(
    quotesLibraryNumber('sản phẩm giảm 60% thường không được đổi trả cho khách', [DOI_TRA]),
    undefined,
    '60 KHÔNG có trong tài liệu — chốt này không được bịa ra một con số để chặn',
  );
  // …còn bản diễn giải ĐÚNG ngưỡng thì bị chặn thẳng, và đó mới là ca hay gặp.
  assert.equal(quotesLibraryNumber('hàng giảm trên 50% thì không đổi trả được', [DOI_TRA]), '50');
  assert.equal(quotesLibraryNumber('nhớ là chỉ đổi trả trong 7 ngày thôi', [DOI_TRA]), undefined,
    '7 chỉ có MỘT chữ số nên bị bỏ qua — số đếm bước đụng tài liệu quá dễ');
});

test('CON SỐ: bài học về CÁCH LÀM mang số riêng của nó thì PHẢI qua được', () => {
  // Đây là ca chặn nhầm đắt nhất: một bài học thật về cách làm việc bị vứt chỉ
  // vì nó có chữ số. Ngưỡng "phải nằm sẵn trong tài liệu" tồn tại vì ca này.
  assert.equal(
    quotesLibraryNumber('hỏi lại tối đa 2 câu rồi bắt tay vào làm, đừng hỏi vòng', [DOI_TRA]),
    undefined,
  );
  assert.equal(
    quotesLibraryNumber('grep trong library/text/ trước khi trả lời chính sách', [DOI_TRA]),
    undefined,
    'câu CÁCH LÀM không có số nào — đây là hình dạng bài học ta MUỐN',
  );
});

test('CON SỐ: ranh giới chữ số — 50 không được khớp vào 150 hay 500', () => {
  const doc = 'bang-gia.md\nÁo khoác: 500.000đ. Quần: 150000đ.';
  assert.equal(quotesLibraryNumber('giảm trên 50% thì thôi', [doc]), undefined);
  assert.equal(quotesLibraryNumber('áo khoác giá 500.000đ', [doc]), '500.000');
});

// ───────────────────────────────── luật 3: `looped`, KHÔNG phải số lượt

test('worthLearning: ca êm KHÔNG hỏi, dù chạy 9 lượt', () => {
  // Ca 19/08 chạy đúng 9 lượt. Bản nháp `turns >= 8` sẽ CHO QUA đúng cái ca nó
  // sinh ra để chặn — đó là lý do số lượt bị loại khỏi tín hiệu, vĩnh viễn.
  const nineTurns = receipt({
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: 'haiku', turns: 9 },
  });
  assert.equal(worthLearning([nineTurns]), false);
});

test('worthLearning: LẶP THAO TÁC thì hỏi — đây là "flow bị loop" đo đúng cách', () => {
  assert.equal(worthLearning([receipt({ looped: true })]), true);
  // Vẫn giữ nguyên ba tín hiệu cũ, không cái nào bị `looped` thay thế.
  assert.equal(worthLearning([receipt({ status: 'failed' })]), true);
  assert.equal(worthLearning([receipt({ reasked: true })]), true);
  assert.equal(worthLearning([receipt({ blocked_on: 'thiếu file' })]), true);
});

test('worthLearning: chỉ MỘT việc lặp trong cả lô là đủ để hỏi', () => {
  assert.equal(worthLearning([receipt(), receipt({ task_id: 'T-02', looped: true })]), true);
});

// ───────────────────────────────── `deliver`: hai kênh, hai cái trần

test('enforceCap: answer KHÔNG ăn vào trần của receipt', () => {
  const long = 'Chính sách bảo hành của shop là 12 tháng. '.repeat(40);
  const out = enforceCap(
    {
      status: 'done',
      say: 'Đã trả lời khách về chính sách bảo hành.',
      answer: long,
      artifacts: ['artifacts/P-260819-1430-ab12/T-01/tra-loi.md'],
      lessons: [{ kind: 'pitfall', text: 'grep trong library/text/ trước khi trả lời' }],
      blocked_on: null,
    },
    // Trần CHẶT có chủ ý: nếu `answer` nằm trong phép đo thì nó sẽ đẩy `lessons`
    // và `say` ra ngoài — tức câu trả lời cho khách đi ăn cắp chỗ của receipt,
    // trong khi hai thứ đó chạy trên hai đường hoàn toàn khác nhau.
    200,
  );
  assert.equal(out.lessons.length, 1, 'lessons phải sống sót: answer không được tính vào trần');
  assert.ok(out.say.length > 0);
  assert.ok(out.answer.length > 0);
  assert.ok(out.answer.length < long.length, 'answer vẫn có trần RIÊNG của nó');
});

// ───────────────────────────────── plan_id đọc được

test('newPlanId: dạng đọc được, và sắp xếp từ điển vẫn đúng thứ tự thời gian', () => {
  const id = newPlanId();
  assert.match(id, /^P-\d{6}-\d{4}-[a-z0-9]{4}$/, `dạng lạ: ${id}`);
  // Sắp xếp từ điển phải trùng thứ tự thời gian — đây là thứ `PlanStore` và
  // `walk()` của artifacts đều dựa vào mà không ai khai ra thành lời.
  assert.ok('P-260819-1430-aaaa' < 'P-260819-1431-aaaa');
  assert.ok('P-260819-2359-zzzz' < 'P-260820-0000-aaaa');
});
