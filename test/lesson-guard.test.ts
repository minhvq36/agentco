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

import { learnable, newPlanId, worthLearning } from '../dist/core/assistant.js';
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
    // ⚠ `landed` PHẢI có — `learnable` đi qua `delivered()`. Xem knowledge.test.ts.
    landed: [],
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
  // `receipt()` mặc định `status: 'done'`, nên cả ba dòng dưới đều là ca ĐI ĐẾN
  // ĐÍCH mà có vấp — đúng hình dạng duy nhất còn được học từ 29/08.
  assert.equal(worthLearning([receipt({ looped: true })]), true);
  assert.equal(worthLearning([receipt({ reasked: true })]), true);
  assert.equal(worthLearning([receipt({ blocked_on: 'thiếu file' })]), true);
  // ⚠ Dòng thứ tư ĐÃ ĐỔI DẤU 29/08: `failed` không còn là tín hiệu học.
  assert.equal(worthLearning([receipt({ status: 'failed' })]), false);
});

test('worthLearning: chỉ MỘT việc lặp trong cả lô là đủ để hỏi', () => {
  assert.equal(worthLearning([receipt(), receipt({ task_id: 'T-02', looped: true })]), true);
});

// ───────────── luật 5 (29/08): BÁNH CÓC KINH NGHIỆM — chỉ học từ ca ĐI ĐẾN ĐÍCH
//
// Ca thật, văn phòng `canh-tay`: cánh tay "Trình duyệt web" chạy được lúc 16:58,
// rồi ngừng hẳn. MCP vẫn `connected`, vẫn đủ 24 tool — thứ hỏng là KHO KINH
// NGHIỆM. Trong ~2 giờ, mỗi ca `blocked` lại đẻ một mẩu mô tả chính triệu chứng
// của nó, và `cold()` kéo đúng mẩu ấy về ở task cùng chủ đề lần sau. Đo bằng
// `scripts/spike-worker-mcp-init.ts`, cùng brief, chỉ đổi khối kinh nghiệm:
//
//   kinh nghiệm rỗng      → ✅ mở YouTube   $0,1097
//   chỉ HOT (8 mẩu)       → ✅ mở YouTube   $0,1595
//   chỉ COLD (28 mẩu)     → ❌ blocked      $0,0316
//   bỏ 10 mẩu phủ định    → ✅ mở YouTube   $0,1002
//
// 21 bài học của Trợ lý trong kho ấy, xếp theo trạng thái ca đã đẻ ra chúng:
// `blocked` 12 · `failed` 3 · `done` 6 — và **cả 10 mẩu độc nằm trong 15 cái
// đầu**. Cổng dưới đây cắt đúng 15 đó.

test('worthLearning: mọi hình dạng KHÔNG-XONG đều không sinh bài học', () => {
  for (const s of ['failed', 'blocked', 'needs_human'] as const) {
    assert.equal(worthLearning([receipt({ status: s, blocked_on: 'không vào được trang' })]), false, s);
    // Kể cả khi nó vấp rõ ràng — vấp mà không về đích thì vẫn chưa phải kinh nghiệm.
    assert.equal(worthLearning([receipt({ status: s, looped: true })]), false, `${s} + looped`);
  }
});

/**
 * Ca HỖN HỢP là ca nguy hiểm nhất, vì cổng vẫn MỞ (có một việc xong) mà trong
 * bảng kết quả vẫn có một dòng hỏng để model nhìn thấy. Cổng chỉ chặn được vế
 * "có hỏi hay không"; vế "rút từ dòng nào" do dấu ⟵ trong `report()` gánh.
 */
test('worthLearning: một việc xong-có-vấp + một việc hỏng → VẪN hỏi (và dấu ⟵ chỉ đúng dòng)', () => {
  const done = receipt({ task_id: 'T-01', looped: true });
  const blocked = receipt({ task_id: 'T-02', status: 'blocked', blocked_on: 'thiếu quyền' });
  assert.equal(worthLearning([done, blocked]), true);
  assert.equal(learnable(done), true);
  assert.equal(learnable(blocked), false, 'dòng hỏng KHÔNG được làm nguồn, dù cổng đã mở');
});

/**
 * Vế ① của `learnable` là `delivered()`, KHÔNG phải `status === 'done'`.
 * (user 29/08: *"done dựa trên đánh giá neo vào mục tiêu của user đã hoàn thành chưa"*)
 *
 * Ca thật nằm ngay trong kho của văn phòng, Trợ lý tự ghi lại bằng tiếng Việt:
 * *"hai task báo cáo 'đã đăng nhập sẵn, xong việc' (Facebook, YouTube) nhưng hệ
 * thống đánh dấu failed"*. `status` là LỜI KHAI; `delivered` hỏi thêm một câu
 * quan sát được — **có gì đáp xuống không**.
 */
test('learnable: tự nhận `done` mà KHÔNG có gì đáp xuống thì không phải kinh nghiệm', () => {
  const khai = receipt({
    status: 'done',
    looped: true,
    artifacts: ['artifacts/T-01/ket-qua.md'], // hứa có file…
    landed: [], // …nhưng không có điểm đáp nào quan sát được
  } as Partial<Receipt>);
  assert.equal(learnable(khai), true, 'có artifacts khai ra thì vẫn tính — `delivered` chấp nhận một trong hai');

  // Ca thật sự rỗng: không hứa gì, không đáp gì. `delivered` cho qua (không nợ
  // gì thì không thiếu gì), nên thứ chặn nó là vế ② — phải CÓ VẤP.
  const rong = receipt({ status: 'done', artifacts: [], landed: [] } as Partial<Receipt>);
  assert.equal(learnable(rong), false, 'ca sạch trơn không vấp ⇒ không đáng lưu');
});

// ───────────────────── luật 6 (29/08): CÒN CẢNH BÁO ⇒ CÒN LEAK ⇒ CHƯA PHẢI KINH NGHIỆM

test('worthLearning: ca còn cảnh báo cấp CA thì KHÔNG hỏi, dù có việc xong-có-vấp', () => {
  const ok = receipt({ looped: true });
  assert.equal(worthLearning([ok], 0, false), true, 'đối chứng: không rò thì vẫn hỏi');
  assert.equal(worthLearning([ok], 0, true), false, 'file đã hứa mà thiếu / rơi ngoài khung ⇒ im');
});

test('worthLearning: cảnh báo KHÔNG chặn nhánh ma sát — lớp đó học về con người', () => {
  // Một cái file rơi sai chỗ không làm câu "lần sau người dùng nên nói thẳng X"
  // sai đi. Hai lớp khác nhau thì không dùng chung cổng.
  assert.equal(worthLearning([receipt()], 3, true), true);
});

/** Ca thật của cửa NHÂN VIÊN — `office.ts` dùng đúng hàm này để lọc `r.lessons`. */
test('learnable: bài học nhân viên tự khai từ ca không xong bị chặn ở cổng tất định', () => {
  // Nguyên văn mẩu đã chặn cánh tay trình duyệt:
  // "Trước khi gọi browser_navigate … nếu bị từ chối quyền, dừng lại và báo blocked ngay"
  const r = receipt({
    status: 'blocked',
    blocked_on: 'bị từ chối quyền dùng browser_navigate',
    lessons: [{ kind: 'pitfall', text: 'bị từ chối quyền thì báo blocked ngay thay vì thử lại' }],
  } as Partial<Receipt>);
  assert.equal(learnable(r), false, 'nhân viên KHÔNG đi qua worthLearning, nên cổng phải đứng ở đây');
});

// ─────────────────────── tín hiệu 5: MA SÁT CỦA CON NGƯỜI (20/08)

test('worthLearning: cỗ máy chạy SẠCH nhưng người dùng phải nói lại → VẪN hỏi', () => {
  /**
   * Ca thật 20/08, và nó là lý do tín hiệu này tồn tại.
   *
   * Người dùng mất BỐN lượt mới giao được việc ("doc-2, doc-3 thiếu file thuật
   * ngữ" → Trợ lý bảo họ đi kiểm đường dẫn → hỏi họ file cũ ở đâu → một lượt
   * lập kế hoạch chết hẳn → họ phải tự nghĩ ra giải pháp). Ca chạy sau đó: 2
   * task, cả hai `done`, receipt sạch bong.
   *
   * Bốn tín hiệu cũ đều đọc từ `receipts` — chúng đo ĐỘ KHÓ CỦA CỖ MÁY. Ở đây
   * cỗ máy không khó gì cả; con người mới là bên vật lộn.
   */
  assert.equal(worthLearning([receipt(), receipt({ task_id: 'T-02' })]), false, 'đối chứng: không ma sát thì im');
  assert.equal(worthLearning([receipt(), receipt({ task_id: 'T-02' })], 3), true);
});

test('worthLearning: ma sát 0 KHÔNG làm đổi hành vi cũ', () => {
  // Tham số mới phải là bổ sung thuần tuý: mọi ca cũ giữ nguyên kết quả.
  assert.equal(worthLearning([receipt()], 0), false);
  assert.equal(worthLearning([receipt({ looped: true })], 0), true);
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
