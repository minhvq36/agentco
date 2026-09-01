/**
 * ⭐ TÊN MỘT CÁNH TAY LÀ MỘT ĐẦU VÀO HỢP LỆ. (bug user báo 26/08)
 * → `src/core/paths.ts §resolveInput` · `src/core/catalog.ts §armDirIndex`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ca thật, ba lượt liên tiếp:                                              │
 * │                                                                          │
 * │   > Liệt kê danh sách bài hát trong Musics                               │
 * │   > · Task T-01 cần đọc "Musics" nhưng không có file đó…                 │
 * │   > Bạn được cấp MCP rồi mà                                              │
 * │   > Ừ đúng rồi, Nguoi-soi-thu-muc đã có kết nối tới thư mục Musics rồi…  │
 * │   > vậy sao không làm đi                                                 │
 * │   > · Task T-01 cần đọc "Musics" nhưng không có file đó…                 │
 * │                                                                          │
 * │ Trợ lý làm ĐÚNG: `ASSISTANT_CORE` dặn *"đường dẫn người dùng gõ là chính │
 * │ xác, chép nguyên văn vào inputs"*. Nó tuân lệnh và **bị chặn vì tuân     │
 * │ lệnh** — lỗi ở TẦNG KIỂM, không ở tầng lập kế hoạch.                     │
 * │                                                                          │
 * │ ⚠ LẦN THỨ HAI cùng lớp lỗi ở cùng một hàm: 22/08 `resolveInput` mù trước │
 * │ đường dẫn tuyệt đối ngoài văn phòng; hôm nay mù trước tên cánh tay.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isUrlInput, resolveInput } from '../dist/core/paths.js';
import { armDirIndex } from '../dist/core/catalog.js';

// ───────────────── LOẠI ĐẦU VÀO THỨ TƯ: ĐỊA CHỈ WEB (bug user báo 31/08)
//
// Lần thứ BA cùng lớp lỗi ở cùng hàm: 22/08 đường dẫn tuyệt đối · 26/08 tên
// cánh tay · 31/08 URL. Cả ba lần Trợ lý bị chặn VÌ TUÂN LỆNH.

test('URL KHÔNG bị biến thành đường dẫn rác trong văn phòng', () => {
  // Trước bản vá: "D:\vp\https:\github.com\x" — rồi tầng kiểm bảo "không có file đó".
  assert.equal(resolveInput('D:\\vp', 'https://github.com/modelcontextprotocol/servers'), undefined);
  assert.equal(resolveInput('D:\\vp', 'HTTP://Example.com/a'), undefined);
});

test('⭐ CHỈ nhận khi có `http(s)://` — không đoán tên miền trần', () => {
  /**
   * User hỏi: *"đôi khi người dùng bỏ qua http, chỉ gõ domain như facebook.com"*.
   * Không đoán, vì hai cái sai KHÔNG đối xứng:
   *   URL bị coi là file  → chặn kế hoạch: ỒN ÀO, sửa được
   *   file bị coi là URL  → cổng kiểm IM LẶNG TẮT ⇒ hỏng xa nguyên nhân, tốn tiền
   * Không chắc thì chọn phía ồn ào. → [[agentco-safe-default-direction]]
   */
  assert.equal(isUrlInput('https://x.com/a'), true);
  assert.equal(isUrlInput('facebook.com'), false, 'tên miền trần KHÔNG được đoán');
  assert.equal(isUrlInput('bao-cao.md'), false);
  assert.equal(isUrlInput('data.csv'), false, 'tên file có dấu chấm không được nhầm là tên miền');
  assert.equal(isUrlInput('v1.2'), false);
});

test('🔴 CHUỖI RỖNG không được trỏ vào chính thư mục văn phòng', () => {
  // `safeJoin(office, '')` trả về đúng `office`, mà thư mục đó LUÔN tồn tại ⇒
  // cổng kiểm im lặng cho qua. `TaskIOSchema.path` không có `.min(1)` nên ca
  // này tới được thật.
  assert.equal(resolveInput('D:\\vp', ''), undefined);
  assert.equal(resolveInput('D:\\vp', '   '), undefined);
});

const ARMS = { a1: { label: 'Musics' }, a2: { label: 'Hồ sơ công ty' }, http: { label: 'Notion' } };
const SERVERS = {
  a1: { command: 'npx', args: ['-y', 'pkg', 'D:\\Downloads\\Musics'] },
  a2: { command: 'npx', args: ['-y', 'pkg', 'D:\\Ho so'] },
  http: { type: 'http', url: 'https://mcp.notion.com/mcp' },
};

// ─────────────────────────────────────────── armDirIndex

test('lập bảng theo CẢ nhãn lẫn tên lá thư mục', () => {
  // Người dùng gọi nó bằng cả hai kiểu: nhãn là thứ họ thấy trên sơ đồ, tên lá
  // là thứ họ thấy trong Explorer. Chúng thường trùng, nhưng nhãn đổi tự do được.
  const idx = armDirIndex(ARMS, SERVERS);
  assert.equal(idx['musics'], 'D:\\Downloads\\Musics');
  assert.equal(idx['hồ sơ công ty'], 'D:\\Ho so');
  assert.equal(idx['ho so'], 'D:\\Ho so', 'thiếu tên lá thì user gõ theo Explorer sẽ trượt');
});

test('cánh tay KHÔNG có thư mục thì KHÔNG vào bảng', () => {
  // Ánh xạ `"Notion" → một đường dẫn` là bịa: nó không phải một chỗ trên đĩa.
  assert.equal('notion' in armDirIndex(ARMS, SERVERS), false);
});

// ─────────────────────────────────────────── resolveInput

test('⭐ tên cánh tay giải ra THƯ MỤC THẬT — đây là ca user gặp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-vp-'));
  const idx = armDirIndex(ARMS, SERVERS);
  assert.equal(resolveInput(dir, 'Musics', idx), 'D:\\Downloads\\Musics');
  assert.equal(resolveInput(dir, 'musics', idx), 'D:\\Downloads\\Musics', 'hoa thường');
  assert.equal(resolveInput(dir, 'Musics/', idx), 'D:\\Downloads\\Musics', 'gạch chéo cuối');
});

test('⭐ FILE TRONG VĂN PHÒNG THẮNG tên cánh tay', () => {
  /**
   * Ngược lại thì một cánh tay tên `bao-cao` nuốt mất `bao-cao/` có thật trong
   * văn phòng — im lặng, và ở đúng chỗ người dùng tin nhất.
   */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-vp-'));
  fs.mkdirSync(path.join(dir, 'Musics'));
  const got = resolveInput(dir, 'Musics', armDirIndex(ARMS, SERVERS));
  assert.equal(got, path.join(dir, 'Musics'), 'file trong văn phòng phải thắng');
});

test('không khớp cánh tay nào ⇒ vẫn trả đường TRONG VĂN PHÒNG', () => {
  // Câu lỗi phải nói về chỗ người dùng nghĩ tới, không về một thư mục lạ.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-vp-'));
  assert.equal(resolveInput(dir, 'khong-co', armDirIndex(ARMS, SERVERS)), path.join(dir, 'khong-co'));
});

test('hành vi CŨ không đổi một ly khi không truyền bảng', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-vp-'));
  assert.equal(resolveInput(dir, 'artifacts/x.md'), path.join(dir, 'artifacts', 'x.md'));
  assert.equal(resolveInput(dir, 'D:\\Downloads\\x'), 'D:\\Downloads\\x');
});

test('🔴 traversal vẫn CHẾT, không được rơi xuống nhánh cánh tay', () => {
  /**
   * `../../etc/passwd` làm `safeJoin` ném. Nó là mưu toan traversal, nên phải
   * trả `undefined` — KHÔNG được đi tiếp rồi tìm thấy một thứ khác trong bảng
   * cánh tay. Chốt này có từ 22/08 và bản vá hôm nay không được nới nó.
   */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-vp-'));
  const idx = armDirIndex({ ...ARMS, evil: { label: '../../etc/passwd' } }, SERVERS);
  assert.equal(resolveInput(dir, '../../etc/passwd', idx), undefined);
});

test('đường dẫn TUYỆT ĐỐI vẫn đi thẳng, không hỏi bảng', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-vp-'));
  assert.equal(resolveInput(dir, '/home/an/x', armDirIndex(ARMS, SERVERS)), '/home/an/x');
});
