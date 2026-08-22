/**
 * Test cho SỔ HẠN MỨC TÀI KHOẢN — hai cửa sổ, hai con số %, hai mốc reset.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ PHÉP ĐO 22/08 — và một kết luận SAI đã suýt bị đóng đinh vào code.       │
 * │                                                                          │
 * │ `usage()` hỏng 4/4 khi gọi lúc CLI đang xử lý prompt (kể cả trên query   │
 * │ sống 32 giây: chờ 27 476 ms rồi chết cùng query). Kết luận rút ra lúc đó │
 * │ là *"không lấy được %"* — và nó SAI.                                     │
 * │                                                                          │
 * │ Câu hỏi bỏ sót: vì sao `/usage` gõ tay lại chạy? Vì lúc đó CLI RẢNH.     │
 * │ Probe 5 dựng lại đúng trạng thái ấy (streaming-input, chưa gửi tin nào)  │
 * │ → ✅ 3 342 ms, đủ `five_hour` 58% + `seven_day` 65%, `session cost = 0`. │
 * │                                                                          │
 * │ **"Đo bốn lần đều hỏng" chứng minh một CƠ CHẾ, không chứng minh một       │
 * │ KẾT LUẬN.** Trước khi tuyên bố một đường là chết, phải hỏi: thứ tương    │
 * │ đương đang chạy được ở đâu đó, và nó khác ta ở chỗ nào?                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Test ở đây bảo vệ những chỗ sai mà KHÔNG có triệu chứng:
 *
 *  1. HAI đơn vị thời gian từ HAI nguồn — sự kiện trả **giây** Unix, `usage()`
 *     trả chuỗi ISO. Nhân nhầm 1000 thì mốc rơi vào năm 58600 và giao diện
 *     hiện một câu hoàn toàn nghiêm túc về nó.
 *  2. Sự kiện KHÔNG được xoá `utilization` — nó không mang % (server không
 *     gửi), nên ghi đè bằng `null` làm thanh biến mất giữa chừng.
 *  3. Chỉ nhận `five_hour` + `seven_day`. Rổ theo model và các rổ tên mã nội
 *     bộ (`nimbus_quill`, `iguana_necktie`…) phải bị bỏ, không lọt lên UI.
 *  4. Tin không đổi thì không bump version — `Office.emit` so version ở MỌI sự
 *     kiện, bump thừa là một trận rác trên SSE suốt lượt chạy.
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { apply, energySnapshot, energyVersion, noteRateLimit, resetEnergy } from '../dist/core/energy.js';

/** Payload sự kiện THẬT, chép nguyên từ probe 22/08. Đừng "dọn cho gọn". */
const EVENT = {
  status: 'allowed',
  resetsAt: 1787367000,
  rateLimitType: 'five_hour',
  overageStatus: 'rejected',
  isUsingOverage: false,
};

/** Phản hồi `usage()` THẬT, rút gọn nhưng giữ nguyên hình dạng — kể cả rổ tên mã. */
const USAGE = {
  subscription_type: 'pro',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 58, resets_at: '2026-08-22T02:49:59.770958+00:00' },
    seven_day: { utilization: 65, resets_at: '2026-08-26T03:59:59.770990+00:00' },
    seven_day_opus: null,
    seven_day_sonnet: null,
    nimbus_quill: { utilization: 0, resets_at: null },
    iguana_necktie: null,
    extra_usage: { is_enabled: false },
  },
};

test('chưa lấy được gì thì KHÔNG có snapshot — header phải im, không hiện ô rỗng', () => {
  resetEnergy();
  assert.equal(energySnapshot(), undefined);
  assert.equal(energyVersion(), 0);
});

test('usage(): đọc đúng HAI cửa sổ, đúng % và đúng mốc reset', () => {
  resetEnergy();
  apply(USAGE);
  const snap = energySnapshot();
  assert.ok(snap);
  assert.equal(snap.plan, 'pro');
  assert.deepEqual(
    snap.windows.map((w) => [w.kind, w.utilization]),
    [
      ['session', 58],
      ['weekly', 65],
    ],
    'thứ tự CỐ ĐỊNH phiên→tuần, và cả hai đều có %',
  );
  assert.equal(snap.windows[0]!.resetsAt, new Date('2026-08-22T02:49:59.770958+00:00').toISOString());
  assert.equal(snap.windows[1]!.resetsAt, new Date('2026-08-26T03:59:59.770990+00:00').toISOString());
});

test('rổ theo model và rổ tên mã nội bộ KHÔNG được lọt lên UI', () => {
  resetEnergy();
  apply(USAGE);
  const kinds = energySnapshot()!.windows.map((w) => w.kind);
  assert.deepEqual(kinds, ['session', 'weekly']);
});

test('màu suy từ %: <80 thoải mái · >=80 cảnh báo · >=100 đã chặn', () => {
  resetEnergy();
  apply({ ...USAGE, rate_limits: { five_hour: { utilization: 79, resets_at: null } } });
  assert.equal(energySnapshot()!.windows[0]!.status, 'allowed');
  apply({ ...USAGE, rate_limits: { five_hour: { utilization: 80, resets_at: null } } });
  assert.equal(energySnapshot()!.windows[0]!.status, 'allowed_warning');
  apply({ ...USAGE, rate_limits: { five_hour: { utilization: 100, resets_at: null } } });
  assert.equal(energySnapshot()!.windows[0]!.status, 'rejected');
});

test('chạy bằng API key (rate_limits_available=false) ⇒ không có gì cả', () => {
  resetEnergy();
  apply({ subscription_type: null, rate_limits_available: false, rate_limits: null });
  assert.equal(energySnapshot(), undefined);
});

test('sự kiện: resetsAt là GIÂY Unix, không phải mili-giây', () => {
  resetEnergy();
  noteRateLimit(EVENT);
  const w = energySnapshot()!.windows[0]!;
  assert.equal(w.resetsAt, new Date(1787367000 * 1000).toISOString());
  // Chốt chặn thật: nhân nhầm 1000 thì năm sẽ là 58600.
  assert.ok(new Date(w.resetsAt!).getFullYear() < 2100);
});

test('🔴 sự kiện chỉ sửa status — KHÔNG đụng % và KHÔNG đụng mốc reset', () => {
  resetEnergy();
  apply(USAGE);
  const before = energySnapshot()!.windows[0]!.resetsAt;
  noteRateLimit({ ...EVENT, status: 'allowed_warning' });
  const w = energySnapshot()!.windows[0]!;
  assert.equal(w.status, 'allowed_warning', 'trạng thái thì cập nhật NGAY, giữa lượt chạy');
  assert.equal(w.utilization, 58, 'sự kiện không mang %, nên phải giữ số cũ');
  assert.equal(
    w.resetsAt,
    before,
    'hai nguồn lệch 0,23 giây: cho sự kiện ghi đè là đẻ ra một energy.tick rác ở MỌI query',
  );
});

test('sự kiện của rổ theo model bị bỏ qua, không đẻ ra cửa sổ thứ ba', () => {
  resetEnergy();
  apply(USAGE);
  const v = energyVersion();
  noteRateLimit({ ...EVENT, rateLimitType: 'seven_day_opus', status: 'rejected' });
  assert.equal(energyVersion(), v);
  assert.equal(energySnapshot()!.windows.length, 2);
});

test('tin y hệt tin cũ KHÔNG bump version — nếu không SSE ngập sự kiện rác', () => {
  resetEnergy();
  apply(USAGE);
  const v = energyVersion();
  apply(USAGE);
  noteRateLimit(EVENT);
  noteRateLimit(EVENT);
  assert.equal(energyVersion(), v);
});

test('rác vào thì bỏ qua, KHÔNG ném — đây là API thí nghiệm ta không kiểm soát', () => {
  resetEnergy();
  for (const junk of [undefined, null, 42, 'x', {}, { rate_limits: 'nope' }]) {
    apply(junk as never);
    noteRateLimit(junk);
  }
  // status lạ (SDK thêm mức mới) cũng phải bị chặn.
  noteRateLimit({ ...EVENT, status: 'something_new' });
  assert.equal(energySnapshot(), undefined);
  assert.equal(energyVersion(), 0);
});

test('% vô lý bị kẹp về 0–100, mốc reset hỏng thì thành null', () => {
  resetEnergy();
  apply({ ...USAGE, rate_limits: { five_hour: { utilization: 140, resets_at: 'không phải ngày' } } });
  const w = energySnapshot()!.windows[0]!;
  assert.equal(w.utilization, 100);
  assert.equal(w.resetsAt, null);
});
