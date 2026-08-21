/**
 * Test cho CỬA "CÓ HỎI MODEL HỌC ĐƯỢC GÌ KHÔNG" — nơi hai node rác đã lọt ra.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CA THẬT, 21/08 — hai node gần như y hệt nhau, cách nhau chín phút:       │
 * │                                                                          │
 * │   "Phan-tich-standard liên tục chạm trần chi phí … nên nới max_usd"      │
 * │   "Việc nhóm+tổng hợp CSV có thể chạm trần … cân nhắc nới max_usd"       │
 * │                                                                          │
 * │ Cả hai đều là lời khuyên gửi cho CON NGƯỜI, nằm trong prefix của MỌI     │
 * │ worker, và worker không sửa được `max_usd`. Ta trả tiền mỗi lượt, mãi     │
 * │ mãi, để nhắc lại một câu đã nói đúng cửa ở ô chat.                        │
 * │                                                                          │
 * │ Gốc: `worthLearning` bắn khi `status !== 'done'` — BẤT KỂ vì sao. Chạm   │
 * │ trần là `failed`, nên mọi lượt chạm trần đều bị hỏi "học được gì", và    │
 * │ model bị hỏi thì phải trả lời.                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Luật: **câu hỏi *"của ai"* phải được trả lời trước câu hỏi *"học được gì"*.**
 * Và nó phải trả lời bằng DỮ LIỆU (`Receipt.failure`), vì LLM đặc biệt yếu ở
 * đúng chỗ này — nó không phân biệt nổi *"tôi làm sai"* với *"môi trường chặn
 * tôi lại"*: trong ngữ cảnh của nó, cả hai đều là một lượt không xong.
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { agentFault, worthLearning } from '../dist/core/assistant.js';
import { twinScore } from '../dist/knowledge/store.js';

type Receipt = Parameters<typeof agentFault>[0];

const receipt = (patch: Partial<Receipt> = {}): Receipt =>
  ({
    status: 'done',
    say: 'xong',
    answer: '',
    artifacts: [],
    lessons: [],
    blocked_on: null,
    task_id: 'T-01',
    role: 'phan-tich-standard',
    reasked: false,
    looped: false,
    reads: [],
    landed: [],
    wall_ms: 1000,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: 'sonnet', turns: 3 },
    ...patch,
  }) as Receipt;

// ─────────────────────────────── KHÔNG phải lỗi của agent ⇒ KHÔNG hỏi bài học

/** Đúng ca `P-260821-1932-i9h2`: giao đủ hàng rồi mới chạm trần. */
test('agentFault: chạm trần chi phí NHƯNG giao đủ hàng → không phải trục trặc', () => {
  const r = receipt({ status: 'done', blocked_on: null });
  assert.equal(agentFault(r), false);
  assert.equal(worthLearning([r]), false, 'không hỏi ⇒ không có node rác nào để lọc');
});

test('agentFault: chạm trần chi phí, hàng thiếu → vẫn KHÔNG phải lỗi của agent', () => {
  // Trần là con số NGƯỜI DÙNG đặt. Nhân viên không sửa được nó, nên nó không có
  // gì để học — và bài học ấy sẽ SAI ngay hôm người dùng nới trần.
  const r = receipt({ status: 'blocked', blocked_on: 'chạm trần $0.4', failure: 'budget' });
  assert.equal(agentFault(r), false);
  assert.equal(worthLearning([r]), false);
});

test('agentFault: hết lượt cho phép cũng là trần của người dùng', () => {
  assert.equal(agentFault(receipt({ status: 'failed', blocked_on: 'hết lượt', failure: 'max_turns' })), false);
});

test('agentFault: hạ tầng và gói cước KHÔNG dạy agent được gì', () => {
  for (const kind of ['rate_limit', 'usage_limit', 'auth'] as const) {
    assert.equal(agentFault(receipt({ status: 'failed', failure: kind })), false, kind);
  }
});

/** Người dùng bấm Dừng — nhân viên không làm gì sai. → `stoppedReceipt` */
test('agentFault: người dùng bấm Dừng KHÔNG phải bài học', () => {
  const r = receipt({
    status: 'blocked',
    blocked_on: 'người dùng dừng giữa chừng',
    failure: 'stopped',
  });
  assert.equal(agentFault(r), false);
  assert.equal(worthLearning([r]), false);
});

// ─────────────────────────────────────────── LÀ lỗi của agent ⇒ vẫn phải hỏi

test('agentFault: lỗi lạ chưa loại trừ được agent → vẫn hỏi', () => {
  assert.equal(agentFault(receipt({ status: 'failed', failure: 'other' })), true);
});

test('agentFault: lặp thao tác luôn là việc của chính nó', () => {
  // Quan sát được trong luồng `tool_use`, model-independent. Đứng TRƯỚC mọi
  // nhánh khác vì nó chắc chắn nhất — kể cả khi vòng lặp bị cắt từ bên ngoài.
  assert.equal(agentFault(receipt({ looped: true, failure: 'budget' })), true);
  assert.equal(agentFault(receipt({ reasked: true, failure: 'rate_limit' })), true);
});

/**
 * Nửa dễ làm mất nhất, và bản vá đầu của tôi ĐÃ làm mất nó.
 *
 * `blocked_on` do NHÂN VIÊN tự khai (*"thiếu file thuật ngữ"*) là bài học đắt
 * nhất trong kho. `blocked_on` do HỆ THỐNG ghi (*"chạm trần $0.4"*) là rác.
 * Hai câu nằm cùng một trường; `failure` là thứ duy nhất phân biệt được chúng.
 */
test('agentFault: `blocked_on` do nhân viên tự khai VẪN là bài học', () => {
  assert.equal(agentFault(receipt({ status: 'done', blocked_on: 'thiếu file thuật ngữ' })), true);
  assert.equal(agentFault(receipt({ status: 'blocked', blocked_on: 'thiếu file' })), true);
});

test('agentFault: nhân viên tự khai failed (không có kiểu hỏng) → là bài học', () => {
  assert.equal(agentFault(receipt({ status: 'failed' })), true);
});

test('agentFault: ca chạy sạch thì im', () => {
  assert.equal(agentFault(receipt()), false);
});

/** Số lượt là thuộc tính của MODEL, không phải dấu hiệu trục trặc. → §5 */
test('agentFault: nhiều lượt KHÔNG phải tín hiệu', () => {
  const r = receipt({ usage: { ...receipt().usage, turns: 30 } });
  assert.equal(agentFault(r), false);
});

// ───────────────────────────────────── lưới thứ hai: chống trùng (`twinScore`)

const A = 'Phan-tich-standard liên tục chạm trần chi phí khi làm việc nhóm+tổng hợp CSV — nên nới max_usd trước khi giao việc dạng này.';
const B = 'Việc nhóm+tổng hợp CSV có thể chạm trần chi phí ở phan-tich-standard — cân nhắc nới max_usd trước khi giao việc tương tự.';

/**
 * CẶP TRÙNG THẬT đã lọt lưới 21/08. Ngưỡng cũ 0.75; đo được **0.654**.
 *
 * Phần lệch nằm gần như trọn vẹn ở từ đệm — *liên tục* ↔ *có thể*, *nên* ↔
 * *cân nhắc*, *dạng này* ↔ *tương tự*. Cùng một câu, hai giọng.
 */
test('twinScore: cặp đã lọt lưới phải nằm TRÊN ngưỡng mới, DƯỚI ngưỡng cũ', () => {
  const s = twinScore(A, B);
  assert.ok(s > 0.6, `phải bị chặn ở ngưỡng 0.6, đo được ${s.toFixed(3)}`);
  assert.ok(s < 0.75, `và phải giải thích được vì sao ngưỡng cũ cho lọt: ${s.toFixed(3)}`);
});

test('twinScore: đối xứng — đổi thứ tự không đổi kết quả', () => {
  assert.equal(twinScore(A, B), twinScore(B, A));
});

test('twinScore: hai bài học KHÁC CHUYỆN phải ở xa nhau', () => {
  const khac = 'Chính sách đổi trả nằm ở library/files/doi-tra.md — grep ở đó trước khi trả lời khách.';
  assert.ok(twinScore(A, khac) < 0.6, 'hạ ngưỡng xuống 0.6 không được kéo hai chuyện khác nhau dính vào nhau');
});

test('twinScore: câu rỗng không bao giờ là bản trùng', () => {
  assert.equal(twinScore(A, ''), 0);
  assert.equal(twinScore('', ''), 0);
});
