/**
 * ĐỊA CHỈ REDIRECT OAUTH — thứ duy nhất trong luồng **không được phép đoán**.
 * → `src/server/oauth-routes.ts §redirectBase` · docs/SPEC-arms.md §5h·6
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ User hỏi 26/08, và câu lo đi kèm là câu đúng:                            │
 * │                                                                          │
 * │   *"flow redirect cần case khách chạy docker, vps, nginx → domain. Nhưng │
 * │    tôi chưa test cái đó… 1 là ghi backlog, 2 là làm luôn, tôi sợ làm mà  │
 * │    để đó không test cũng ố dề."*                                         │
 * │                                                                          │
 * │ ⇒ Nên thứ được xây KHÔNG phải một tính năng triển khai (nginx · TLS ·    │
 * │ compose — những thứ chỉ test được bằng cách dựng thật). Nó là một **cái  │
 * │ chốt**, và chốt thì test được ngay: cả file này chạy trong vài mili       │
 * │ giây, không cần Docker nào.                                              │
 * │                                                                          │
 * │ 🔴 Vì sao không suy từ header `Host`: `redirect_uri` là nơi **mã uỷ       │
 * │ quyền** bay về. `Host` do client gửi nên giả được ⇒ ai gọi được daemon    │
 * │ cũng chỉ định được nơi nhận mã. Đó là lỗ chiếm tài khoản, không phải một │
 * │ chi tiết tiện lợi.                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { redirectBase } from '../dist/server/oauth-routes.js';
import { hostAllowed } from '../dist/server/server.js';

// ─────────────────────────────── ② ca đã test thật: chạy trên máy mình

test('loopback + không khai gì ⇒ 127.0.0.1 kèm ĐÚNG cổng đang lắng nghe', () => {
  assert.equal(redirectBase({ host: '127.0.0.1', port: 7317 }), 'http://127.0.0.1:7317');
  assert.equal(redirectBase({ host: 'localhost', port: 9999 }), 'http://127.0.0.1:9999');
  assert.equal(redirectBase({ host: '::1', port: 80 }), 'http://127.0.0.1:80');
});

test('cổng 0 (hệ tự chọn) phải là cổng ĐÃ BOUND, không phải số 0', () => {
  // Chỗ gọi truyền `boundPort` — đọc từ `server.address()` sau khi listen xong.
  // Truyền `opts.port` thì ca `--port 0` đăng ký `…:0` và dịch vụ trả
  // `invalid_redirect_uri`, một câu không hề nói ra nguyên nhân.
  assert.equal(redirectBase({ host: '127.0.0.1', port: 51234 }), 'http://127.0.0.1:51234');
});

// ─────────────── ③ ca user hỏi: bind ra ngoài mà chưa khai địa chỉ

test('⭐ bind ra ngoài + KHÔNG khai public_url ⇒ TỪ CHỐI, không đoán bừa', () => {
  /**
   * Đây là ô cứu người triển khai. Không có nó, daemon trong Docker vẫn đăng ký
   * `http://127.0.0.1:7317` và Notion trả mã về **máy của người dùng**, nơi
   * không có gì lắng nghe — hoặc tệ hơn, nơi CÓ một thứ khác đang lắng nghe.
   * Và triệu chứng lộ ra ở tab trình duyệt, xa daemon, xa log.
   */
  assert.throws(() => redirectBase({ host: '0.0.0.0', port: 7317 }), /public_url|địa chỉ thật/i);
  assert.throws(() => redirectBase({ host: '10.1.2.3', port: 7317 }), /AGENTCO_RUNTIME_PUBLIC_URL/);
});

test('câu từ chối phải NÊU CÁCH SỬA, không chỉ nêu là sai', () => {
  try {
    redirectBase({ host: '0.0.0.0', port: 7317 });
    assert.fail('phải ném');
  } catch (e) {
    const m = (e as Error).message;
    assert.ok(m.includes('AGENTCO_RUNTIME_PUBLIC_URL'), 'thiếu tên biến môi trường');
    assert.ok(m.includes('company.yaml'), 'thiếu đường thứ hai');
  }
});

// ─────────────────────────── ① khai rồi thì soi kỹ

test('https + domain ⇒ dùng nguyên, bỏ gạch chéo cuối', () => {
  assert.equal(redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'https://a.example.com' }), 'https://a.example.com');
  assert.equal(redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'https://a.example.com/' }), 'https://a.example.com');
});

test('giữ path prefix — nginx có thể gắn agentco dưới một đường con', () => {
  assert.equal(
    redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'https://x.com/agentco/' }),
    'https://x.com/agentco',
  );
});

test('cổng phi chuẩn trong public_url được giữ — daemon sau nginx vẫn có thể lộ cổng', () => {
  assert.equal(
    redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'https://x.com:8443' }),
    'https://x.com:8443',
  );
});

test('⭐ http:// ra NGOÀI máy này ⇒ TỪ CHỐI — mã uỷ quyền không được đi trần', () => {
  // Mã đó đổi thẳng ra chìa. Ai đứng giữa cũng đọc được. Phần lớn dịch vụ cũng
  // tự từ chối, nhưng ta không dựa vào việc họ nhớ từ chối hộ.
  assert.throws(
    () => redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'http://a.example.com' }),
    /https/i,
  );
});

test('http:// trỏ về chính máy này thì ĐƯỢC — đó là ca dev/tunnel hợp lệ', () => {
  assert.equal(
    redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'http://127.0.0.1:7317' }),
    'http://127.0.0.1:7317',
  );
  assert.equal(
    redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'http://localhost:7317' }),
    'http://localhost:7317',
  );
});

test('URL rác ⇒ ném kèm chuỗi đã nhận, để người sửa thấy mình gõ gì', () => {
  assert.throws(() => redirectBase({ host: '0.0.0.0', port: 1, publicUrl: 'a.example.com' }), /không phải URL/);
  assert.throws(() => redirectBase({ host: '0.0.0.0', port: 1, publicUrl: 'ftp://x.com' }), /http/);
});

test('có "?" hoặc "#" ⇒ ném — dấu hiệu dán nhầm cả một URL nào đó', () => {
  /**
   * Bỏ qua im lặng thì `redirect_uri` lệch **từng ký tự** với thứ đã đăng ký, và
   * dịch vụ trả `invalid_redirect_uri` — câu lỗi **không hề nói ra nguyên nhân
   * thật**. Bắt ở đây, lúc người ta còn đang nhìn file cấu hình.
   */
  assert.throws(() => redirectBase({ host: '0.0.0.0', port: 1, publicUrl: 'https://x.com/?a=1' }), /\?/);
  assert.throws(() => redirectBase({ host: '0.0.0.0', port: 1, publicUrl: 'https://x.com/#z' }), /#/);
});

test('khoảng trắng thừa hai đầu không làm hỏng — người ta copy-paste', () => {
  assert.equal(
    redirectBase({ host: '0.0.0.0', port: 1, publicUrl: '  https://x.com  ' }),
    'https://x.com',
  );
});

// ───────────── hai chốt KHÁC trong server cũng phải nới theo public_url

test('⭐ Host của tên miền thật phải ĐI QUA — nếu không, 403 cho MỌI request', () => {
  /**
   * 🔴 Chặn cứng tìm ra 26/08. Sau nginx thì `Host` là tên miền công ty, còn ta
   * bind `0.0.0.0` — bản cũ so hai chuỗi đó rồi trả `false` ⇒ **403 cho mọi
   * request**, không riêng OAuth. Tức agentco hôm qua **không chạy được sau một
   * tên miền** chút nào, và không ai biết vì chưa ai dựng thật.
   *
   * ⚠ Bản vá không được là "cho qua mọi Host" — chốt này chặn DNS rebinding.
   * Tên miền hợp lệ là thứ người triển khai KHAI RA, và họ đã khai rồi.
   */
  assert.equal(hostAllowed('agentco.cty.com', '0.0.0.0'), false, 'chưa khai thì vẫn phải chặn');
  assert.equal(hostAllowed('agentco.cty.com', '0.0.0.0', 'agentco.cty.com'), true);
  assert.equal(hostAllowed('agentco.cty.com:443', '0.0.0.0', 'agentco.cty.com'), true, 'có cổng vẫn khớp');
  assert.equal(hostAllowed('AGENTCO.CTY.COM', '0.0.0.0', 'agentco.cty.com'), true, 'hoa thường');
});

test('Host lạ vẫn bị chặn dù ĐÃ khai public_url — không nới thành cho qua tất', () => {
  assert.equal(hostAllowed('ke-tan-cong.com', '0.0.0.0', 'agentco.cty.com'), false);
});

test('localhost luôn đi qua — hành vi cũ không được đổi một ký tự', () => {
  assert.equal(hostAllowed('localhost:7317', '127.0.0.1'), true);
  assert.equal(hostAllowed('127.0.0.1:7317', '127.0.0.1'), true);
  assert.equal(hostAllowed(undefined, '127.0.0.1'), true, 'client không phải trình duyệt');
});

test('public_url rỗng = KHÔNG KHAI, không phải "khai chuỗi rỗng"', () => {
  // `runtime.public_url` mặc định là `''`. Coi nó là một giá trị hợp lệ thì
  // `new URL('')` ném ra một câu về URL, che mất câu thật là "chưa khai".
  assert.equal(redirectBase({ host: '127.0.0.1', port: 7317, publicUrl: '' }), 'http://127.0.0.1:7317');
  assert.equal(redirectBase({ host: '127.0.0.1', port: 7317, publicUrl: '   ' }), 'http://127.0.0.1:7317');
});
