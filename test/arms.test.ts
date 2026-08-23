/**
 * Test cho luật MỘT THƯ MỤC, MỘT CÁNH TAY (user chốt 23/08).
 * → docs/SPEC-arms.md §6 · `src/core/catalog.ts`
 *
 * Đây là mảnh QUYẾT ĐỊNH CHẶN HAY KHÔNG khi người dùng cắm một cánh tay file,
 * nên sai ở đây có hai chiều và cả hai đều đắt:
 *
 *   chặn nhầm  → người dùng không cắm được thứ họ có quyền cắm, và câu lỗi nói
 *                về một kết nối chẳng liên quan
 *   lọt nhầm   → văn phòng trả 2× token cho cùng một năng lực, và nhân viên
 *                nhìn thấy hai bộ tool y hệt nhau
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { coveredBy, folderRoots, swallowsOffice } from '../dist/core/catalog.js';

// ───────────────────────────────────────────────────────────── folderRoots

test('folderRoots: nhặt đúng đường dẫn tuyệt đối trong args', () => {
  assert.deepEqual(
    folderRoots({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@1', 'D:\\Ho so'] }),
    ['D:\\Ho so'],
  );
});

test('folderRoots: nhận CẢ HAI kiểu đường dẫn, không dò nền tảng', () => {
  // Một văn phòng zip từ máy khác hệ vẫn phải đọc đúng chuỗi trong company.yaml.
  assert.deepEqual(folderRoots({ args: ['/home/an/tai-lieu'] }), ['/home/an/tai-lieu']);
  assert.deepEqual(folderRoots({ args: ['C:/Users/An'] }), ['C:/Users/An']);
});

test('folderRoots: cờ và tên gói KHÔNG phải thư mục', () => {
  assert.deepEqual(folderRoots({ args: ['-y', '@scope/pkg@2026.7.10', '--readonly'] }), []);
});

test('folderRoots: cấu hình không phải stdio thì rỗng, không ném', () => {
  assert.deepEqual(folderRoots({ type: 'http', url: 'https://x' }), []);
  assert.deepEqual(folderRoots(undefined), []);
  assert.deepEqual(folderRoots({ args: 'khong-phai-mang' }), []);
});

// ───────────────────────────────────────────────────────────── coveredBy

const have = (id: string, ...folders: string[]) => ({ id, folders });

test('coveredBy: trùng KHÍT thì chặn, và nêu tên kết nối đang giữ nó', () => {
  const hit = coveredBy([have('files', 'D:\\Ho so')], ['D:\\Ho so']);
  assert.equal(hit?.id, 'files');
});

test('coveredBy: khác dấu gạch chéo và khác hoa thường VẪN là một thư mục', () => {
  // Trên Windows `D:\Ho So` và `d:/ho so/` là cùng một chỗ. So chuỗi thô ở đây
  // là để lọt đúng ca người dùng dễ tạo ra nhất: gõ lại tay thay vì bấm chọn.
  assert.ok(coveredBy([have('files', 'D:\\Ho So')], ['d:/ho so/']));
});

/**
 * ⚠ CHỒNG LẤN KHÔNG BỊ CHẶN — cả hai chiều. Bản đầu chặn "thư mục con", user
 * bác, và bác đúng: một cánh tay hẹp hơn là **đặc quyền tối thiểu** (nhân viên A
 * chỉ với tới `2026`, B với tới cả kho), và luật cũ **bất đối xứng theo thứ tự
 * tạo** — cùng một cấu hình cuối cùng, chặn hay không tuỳ ai cắm trước.
 *
 * Chồng lấn vẫn tốn token thật, nhưng đó là cái giá NGƯỜI DÙNG CHỌN ⇒ *hiện giá,
 * đừng chặn* (cùng luật đã bỏ trần 2 000). Hai test này khoá chiều đó lại.
 */
test('coveredBy: thư mục CON thì CHO — đó là đặc quyền tối thiểu, không phải trùng lặp', () => {
  assert.equal(coveredBy([have('files', 'D:\\Ho so')], ['D:\\Ho so\\2026']), undefined);
});

test('coveredBy: cái mới RỘNG HƠN cũng CHO — nới quyền có chủ ý', () => {
  assert.equal(coveredBy([have('files', 'D:\\Ho so\\2026')], ['D:\\Ho so']), undefined);
});

test('coveredBy: trùng tiền tố tên thì KHÔNG phải trùng thư mục', () => {
  assert.equal(coveredBy([have('files', 'D:\\Ho so')], ['D:\\Ho so-cu']), undefined);
});

// ───────────────────────────────────────────────────────── swallowsOffice

const OFFICE = 'D:\\cty\\offices\\noi-dung';
const COMPANY = 'D:\\cty';

test('swallowsOffice: chính thư mục văn phòng thì chặn', () => {
  assert.ok(swallowsOffice(OFFICE, OFFICE, COMPANY));
});

test('swallowsOffice: thư mục CHA của văn phòng cũng chặn — nó nuốt cả `.state/`', () => {
  // Đây là nửa nguy hiểm: tool MCP mang tên `mcp__x__read_file`, KHÔNG khớp
  // matcher của `guardedZone` ⇒ nó đi vòng qua hàng rào kho chìa.
  assert.ok(swallowsOffice('D:\\', OFFICE, COMPANY));
  assert.ok(swallowsOffice(COMPANY, OFFICE, COMPANY));
});

test('swallowsOffice: thư mục CON bên trong văn phòng thì CHO', () => {
  // Không nuốt `.state/`, và người dùng có thể thật sự muốn phạm vi hẹp đó.
  assert.equal(swallowsOffice(`${OFFICE}\\artifacts`, OFFICE, COMPANY), false);
});

test('swallowsOffice: thư mục chẳng liên quan thì cho', () => {
  assert.equal(swallowsOffice('D:\\Downloads', OFFICE, COMPANY), false);
});

test('swallowsOffice: khác dấu gạch chéo và hoa thường vẫn bắt được', () => {
  assert.ok(swallowsOffice('d:/cty', OFFICE, COMPANY));
});

test('coveredBy: thư mục khác hẳn thì cho qua', () => {
  assert.equal(coveredBy([have('files', 'D:\\Ho so')], ['D:\\Anh']), undefined);
});

test('coveredBy: chưa có cánh tay nào thì luôn cho qua', () => {
  assert.equal(coveredBy([], ['D:\\Ho so']), undefined);
});

test('coveredBy: cánh tay nhiều gốc — đụng gốc NÀO cũng chặn', () => {
  assert.ok(coveredBy([have('files', 'D:\\Anh', 'D:\\Ho so')], ['D:\\Ho so']));
});

test('coveredBy: cắm nhiều thư mục — chỉ cần MỘT cái đụng là chặn cả lượt', () => {
  const hit = coveredBy([have('files', 'D:\\Ho so')], ['D:\\Moi', 'D:\\Ho so']);
  assert.equal(hit?.id, 'files');
});
