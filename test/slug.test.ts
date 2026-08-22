/**
 * Test cho TÊN THƯ MỤC — và một bức tường chặn cả một thị trường.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ca 22/08, user hỏi: *"hàm slug tên mà tôi phục vụ cho người Trung Quốc   │
 * │ có bị gì không"*. Đo ra: `slugId` trả **chuỗi rỗng** cho MỌI chữ viết     │
 * │ không phải Latin — `NFD` không phân rã chữ Hán/Kana/Hangul/Thái/Kirin/    │
 * │ Ả Rập/Hy Lạp thành ASCII được.                                           │
 * │                                                                          │
 * │ Dữ liệu KHÔNG hỏng: `isSafeId('')` false nên `createOffice` ném ra một    │
 * │ lỗi tử tế. Nhưng câu lỗi là *"Tên văn phòng cần có ít nhất một chữ cái    │
 * │ hoặc số"* — vô nghĩa với người vừa gõ đúng chữ của họ, và **không có      │
 * │ đường đi tiếp nào**. Người dùng Trung Quốc dừng lại ở màn hình đầu tiên.  │
 * │                                                                          │
 * │ Bug thứ hai, im lặng hơn: `nameKey` cũng đi qua `slugId`, nên mọi tên     │
 * │ phi-Latin cùng khoá `""` và `assertNameFree` coi 会计部 với 人力资源 là    │
 * │ **trùng tên**.                                                           │
 * │                                                                          │
 * │ Bài học: một hàm chuẩn hoá viết cho tiếng Việt trông như viết cho "mọi    │
 * │ ngôn ngữ" — nó xử lý dấu rất tinh vi, nên dễ tin là nó đã lo hết. Phép    │
 * │ thử rẻ nhất là **đưa vào một chữ viết khác hệ**.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { folderId, isSafeId, nameKey, slugId } from '../dist/core/paths.js';
import { isLoopback } from '../dist/server/server.js';

const PHI_LATIN = ['会计部', '人力资源', '経理部', '회계팀', 'แผนกบัญชี', 'Бухгалтерия', 'Λογιστήριο'];

test('slugId: giữ nguyên hành vi với tiếng Việt', () => {
  assert.equal(slugId('Kế toán'), 'ke-toan');
  assert.equal(slugId('Đội ngũ'), 'doi-ngu');
  assert.equal(slugId('Bảng  tính'), 'bang-tinh');
});

test('slugId: chữ viết phi-Latin cho slug RỖNG — tiền đề của cả ca lỗi', () => {
  for (const n of PHI_LATIN) assert.equal(slugId(n), '', n);
});

test('folderId: mọi tên phi-Latin đều ra một id HỢP LỆ', () => {
  for (const n of PHI_LATIN) {
    const id = folderId(n);
    assert.notEqual(id, '', n);
    assert.ok(isSafeId(id), `${n} -> ${id} phải qua được isSafeId`);
  }
});

test('folderId: ỔN ĐỊNH — cùng tên thì cùng thư mục, kể cả sau khi xoá đi tạo lại', () => {
  for (const n of PHI_LATIN) assert.equal(folderId(n), folderId(n));
  assert.equal(folderId('会计部'), folderId(' 会计部 '), 'khoảng trắng thừa không đẻ thư mục thứ hai');
});

test('folderId: hai tên KHÁC NHAU không bao giờ dùng chung một thư mục', () => {
  const ids = new Set(PHI_LATIN.map((n) => folderId(n)));
  assert.equal(ids.size, PHI_LATIN.length);
});

test('folderId: tên Latin vẫn dùng slug ĐỌC ĐƯỢC — không băm vô cớ', () => {
  assert.equal(folderId('Kế toán'), 'ke-toan');
  assert.equal(folderId('会计 Accounting'), 'accounting', 'còn chữ Latin thì vẫn ưu tiên slug');
});

test('folderId: tên RỖNG vẫn ra rỗng — để tầng trên từ chối, đừng tự bịa id', () => {
  assert.equal(folderId('   '), '');
  assert.equal(folderId(''), '');
});

test('folderId: tiền tố tách được nhân viên khỏi văn phòng', () => {
  assert.ok(folderId('会计部', 'nv').startsWith('nv-'));
  assert.notEqual(folderId('会计部', 'nv'), folderId('会计部'));
});

test('nameKey: hai tên phi-Latin khác nhau KHÔNG được coi là trùng', () => {
  assert.notEqual(nameKey('会计部'), nameKey('人力资源'));
  const keys = new Set(PHI_LATIN.map((n) => nameKey(n)));
  assert.equal(keys.size, PHI_LATIN.length);
});

test('nameKey: vẫn bắt trùng như cũ với tiếng Việt', () => {
  assert.equal(nameKey('Nội dung'), nameKey('noi  dung'));
  assert.equal(nameKey('Nội dung'), nameKey('NOI DUNG'));
});

// ─────────────────────── "mở thư mục" chỉ đúng khi trình duyệt ở cùng máy

/**
 * Ca user nêu 22/08: *"sau này tôi sẽ support vps (truy cập UI qua internet)
 * hoặc docker"*. Nút "mở thư mục" mở trên MÁY CHỦ — bấm ở Hà Nội thì cửa sổ
 * bật ra trên con server ở Singapore. Tốt nhất là không có gì xảy ra; tệ hơn
 * là một tiến trình mồ côi mỗi lần bấm.
 *
 * `AGENTCO_HEADLESS=1` chặn được ca Docker dựng đúng, nhưng nó là thứ người
 * triển khai phải NHỚ ĐẶT — một bất biến dựa vào trí nhớ thì không phải bất
 * biến. Chốt thật là hỏi chính cái socket.
 */
test('isLoopback: chi nhan dia chi cua CHINH may nay', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.1.1']) {
    assert.equal(isLoopback(a), true, a);
  }
});

test('isLoopback: LAN va internet deu bi tu choi', () => {
  for (const a of ['192.168.1.10', '10.0.0.4', '172.17.0.1', '::ffff:192.168.1.10', '203.0.113.7', '2001:db8::1']) {
    assert.equal(isLoopback(a), false, a);
  }
});

test('isLoopback: thieu dia chi thi KHONG mo — fail closed', () => {
  assert.equal(isLoopback(undefined), false);
  assert.equal(isLoopback(''), false);
});

