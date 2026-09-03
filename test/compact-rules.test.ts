/**
 * LUẬT CỦA LƯỢT NÉN TRÍ NHỚ — `assistant.ts §Assistant.COMPACT_RULES`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO KHỐI VĂN XUÔI NÀY CẦN TEST, TRONG KHI ĐẦU RA CỦA NÓ BẤT ĐỊNH.     │
 * │                                                                          │
 * │ Mỗi luật ở đây là học phí của một ca hỏng thật, và cả năm luật trông      │
 * │ giống hệt "một đoạn prompt hơi dài" với người đọc sau. Xoá bớt cho gọn ⇒  │
 * │ **không test nào đỏ**, không build nào gãy — chỉ có một hành vi im lặng   │
 * │ quay lại sau vài tuần. Đúng lớp lỗi mà chú thích không chặn được.         │
 * │                                                                          │
 * │ Test này KHÔNG kiểm model làm gì (bất định, user chấp nhận). Nó kiểm      │
 * │ **luật có còn nằm trong prompt không** — thứ tất định.                    │
 * │ → [[agentco-detect-fix-pair-scope]] · [[agentco-tat-dinh-vs-tin-hieu]]    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { Assistant } from '../dist/core/assistant.js';

const R: string = Assistant.COMPACT_RULES;

test('đủ NĂM luật, đánh số liên tục — bỏ một luật là gãy ở đây', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    assert.ok(new RegExp(`(^|\\n)${n}\\.`, 'm').test(R), `mất luật ${n}`);
  }
  assert.match(R, /Five rules/, 'số luật khai ở đầu không khớp với số luật thật');
});

test('luật 1–3: GIỮ là mặc định, cái mới thắng, mỗi chủ đề một dòng', () => {
  // Bug 20/08: mỗi `/clear` là một lần tóm tắt lại bản tóm tắt ⇒ quyết định của
  // người dùng bốc hơi sau ba lần dọn, im lặng.
  assert.match(R, /CARRY OVER every old entry that still holds/);
  assert.match(R, /the newer one wins/);
  assert.match(R, /One line per topic/);
});

test('luật 4: KHÔNG ghi kết luận từ ca HỎNG, và có ví dụ ⛔/✅ đi kèm', () => {
  assert.match(R, /never record a conclusion drawn from a FAILURE/i);
  // Luật trừu tượng thua danh sách ví dụ ⇒ ví dụ phải còn.
  // → [[agentco-prompt-rules-lose-to-examples]]
  assert.match(R, /⛔ "a done report from the browser employee cannot be fully trusted"/);
  assert.match(R, /✅ "hand the work over anyway; let the employee report a missing permission/);
  // Nửa còn lại: thứ NGƯỜI DÙNG chốt thì vẫn giữ, kể cả khi họ chốt "đừng làm X".
  assert.match(R, /What the HUMAN settled still gets carried over under rule 1/);
});

test('🔴 luật 4 phủ cả ca CHƯA CÓ / CHƯA THỬ, không chỉ ca HỎNG (user báo 02/09)', () => {
  /*
    Ca thật: hỏi "gửi cho ke-toan@congty.vn", Trợ lý trả lời đúng, rồi `/clear`
    ghi lại "văn phòng không có kết nối gửi email". Không có lần nào hỏng cả —
    nên bản luật cũ (chỉ nói về "những lần HỎNG") không chạm tới.

    Mà danh sách cánh tay được dựng lại vào prefix ở MỌI lượt, nên câu đó không
    thêm một bit nào; nó chỉ đông lạnh một sự thật vốn tươi, và sai ngay hôm
    người dùng cắm một cánh tay Gmail.
  */
  assert.match(R, /NOT PRESENT \/ NOT TRIED/);
  assert.match(R, /⛔ "this office has no email connection/);
  // Điều kiện phải nằm TRÊN CHÍNH DÒNG có ví dụ, không ở một câu khác.
  // → [[agentco-prompt-rules-lose-to-examples]]
  assert.match(R, /the list of connections is rebuilt into your context on EVERY turn/);
});

test('🔴 luật 5: giữ CÁCH LẤY, không giữ SỐ LIỆU (user chốt 31/08)', () => {
  assert.match(R, /never record FIGURES or STATE fetched from a connection or a file/i);
  // Phép thử được chọn vì nó KHÔNG cần cơ chế mới — model tự trả lời được.
  assert.match(R, /asking the same place again tomorrow could give a different answer/);
});

test('🔴 luật 5 phải có CẢ HAI CHIỀU — thiếu vế ✅ thì model bỏ trắng, mất đường về', () => {
  // Một luật chỉ có vế "đừng ghi" được chấp hành bằng cách không ghi gì, và
  // phiên sau không còn biết phải đi hỏi ai. Vế ✅ là thứ giữ lại đường về.
  assert.match(R, /⛔ "there are currently 23 unpaid invoices/);
  assert.match(R, /✅ "number of unpaid invoices: ask the/);
  assert.match(R, /do not answer from memory/);
});

test('luật 5 chừa đúng ngoại lệ: con số NGƯỜI DÙNG chốt vẫn được giữ', () => {
  // Không có câu này thì luật 5 nuốt luôn "ngân sách mỗi task tối đa $0,5" —
  // một quyết định, không phải số liệu đi lấy về.
  assert.match(R, /A figure the HUMAN themselves settled still gets carried over under rule 1/);
});

test('khối vẫn nói rõ cách trả lời khi KHÔNG có gì đáng nhớ', () => {
  // Hai câu trong cùng một prompt không được đá nhau: luật gộp bảo "chép lại",
  // nên nhánh KHÔNG phải nêu rõ điều kiện CẢ HAI đều trống.
  assert.match(R, /If there is NO earlier memory and nothing in this session is worth keeping/);
});

/**
 * 🔴 KHÔNG ĐƯỢC GHIM TÊN MỘT NGÔN NGỮ NÀO VÀO KHỐI NÀY.
 *
 * Bản trước dặn *"viết gạch đầu dòng tiếng Việt"* — ghim cứng trong mã, giữa
 * chính khối trí nhớ của người dùng đọc lại cho họ. Người Anh nhận trí nhớ tiếng
 * Việt; người Đức thì không có đường nào ra tiếng Đức cả.
 *
 * `NOTHING` là ngoại lệ và nó KHÔNG phải văn xuôi: `office.ts` khớp
 * `/^NOTHING\.?$/i` để bỏ qua nhánh "không có gì đáng nhớ". Nó là token giao
 * thức, cùng loại với tên trường JSON.
 */
test('🔴 khối luật KHÔNG nêu tên một ngôn ngữ cụ thể nào', () => {
  for (const name of ['Vietnamese', 'tiếng Việt', 'English', 'Chinese', 'tiếng Anh']) {
    assert.equal(R.includes(name), false, `khối luật ghim ngôn ngữ "${name}"`);
  }
  // Và nó vẫn phải NÓI về ngôn ngữ — bỏ hẳn câu này thì model không có gì bám.
  assert.match(R, /in the language of the conversation/);
});

test('⭐ sentinel "NOTHING" phải khớp đúng thứ `office.ts` kiểm', () => {
  // Cặp phát hiện ↔ sửa phải cùng phạm vi: prompt xin một chữ, code khớp một
  // chữ. Lệch nhau thì nhánh "không có gì đáng nhớ" ghi một node rỗng vào kho,
  // im lặng. → [[agentco-detect-fix-pair-scope]]
  assert.match(R, /one word: NOTHING/);
  assert.match('NOTHING', /^NOTHING\.?$/i);
  assert.match('Nothing.', /^NOTHING\.?$/i);
});
