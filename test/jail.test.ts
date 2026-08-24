/**
 * Test cho VÙNG CẤM — `guardedZone`, hàm thuần đứng sau `officeJail`.
 * → docs/SPEC-arms.md §5d–§5f · docs/TEST-WALKTHROUGH.md bài 15
 *
 * Hai lỗ này KHÔNG phải suy đoán: đo được 23/08 bằng `scripts/spike-secrets.ts`
 * với một vai trò chỉ có 7 tool mặc định, không shell — nó đọc nguyên văn
 * `company/.state/secrets.json` và ghi đè `roles/<chính-nó>.yaml` bằng `Write`,
 * trong 45 giây, giá $0,0389, không một lời từ chối nào.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NỬA SAU CỦA FILE NÀY QUAN TRỌNG NGANG NỬA ĐẦU.                           │
 * │                                                                          │
 * │ Một bản vá chặn được hai lỗ mà chặn luôn `artifacts/` hay `knowledge/`    │
 * │ là hỏng NGƯỢC CHIỀU — và im lặng hơn hẳn, vì không ai đi kiểm lại một     │
 * │ việc vốn vẫn chạy. Đúng bẫy `outputScoper` từng dẫm: viết lại mọi đường   │
 * │ ra, không ai thấy, tới khi user tình cờ đi tìm một file.                  │
 * │                                                                          │
 * │ Nên `describe('KHÔNG được chặn')` không phải phần phụ — nó là nửa còn     │
 * │ lại của cùng một bất biến.                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import path from 'node:path';
import test from 'node:test';

import { guardedZone } from '../dist/core/paths.js';

const companyDir = path.resolve('/tmp/cty');
const officeDir = path.join(companyDir, 'offices', 'noi-dung');
const dirs = { companyDir, officeDir };

const write = (p: string) => guardedZone(dirs, p, 'write');
const read = (p: string) => guardedZone(dirs, p, 'read');
/** Tool của MCP — matcher `mcp__.*`. Đo được 24/08 là hook CÓ nổ cho chúng. */
const arm = (p: string) => guardedZone(dirs, p, 'arm');

// ─────────────────────────────────────────────── ① CHÌA KHOÁ — cấm cả hai chiều

test('secrets · đọc kho chìa bằng đường dẫn TUYỆT ĐỐI bị chặn — ca A của spike 6', () => {
  assert.equal(read(path.join(companyDir, '.state', 'secrets.json')), 'secrets');
});

test('secrets · đọc bằng đường dẫn TƯƠNG ĐỐI leo ra cũng bị chặn', () => {
  // Đây là hình dạng model hay chọn khi `cwd` là thư mục văn phòng.
  assert.equal(read('../../.state/secrets.json'), 'secrets');
});

test('secrets · GHI vào kho chìa cũng bị chặn, không chỉ đọc', () => {
  assert.equal(write(path.join(companyDir, '.state', 'secrets.json')), 'secrets');
});

test('secrets · cả thư mục .state, không riêng secrets.json', () => {
  assert.equal(read(path.join(companyDir, '.state', 'daemon.json')), 'secrets');
});

test('secrets · .state của VĂN PHÒNG cũng cấm — bịt luôn lỗ đã ghi ở OfficePaths.tasks', () => {
  // Chú thích ở `paths.ts` ghi: "KHÔNG phải một bức tường bảo mật — `Read` với
  // đường dẫn tường minh vẫn mở được". Ca đo 20/08 (`P-260820-2219-5ltb`):
  // `nguoi-gop` đọc được `plan.json` + `log.jsonl` = receipt của task khác.
  assert.equal(read('.state/tasks/P-260820-2219-5ltb/plan.json'), 'secrets');
  assert.equal(read(path.join(officeDir, '.state', 'tasks', 'index.json')), 'secrets');
});

// ─────────────────────────────────────────────── ② CẤU HÌNH — cấm ghi, cho đọc

test('config · ghi đè file vai trò của chính mình bị chặn — ca B của spike 6', () => {
  assert.equal(write('roles/nguoi-viet-bao-cao.yaml'), 'config');
});

test('config · office.yaml · layout.json · skills/ · connectors/ đều bị chặn', () => {
  assert.equal(write('office.yaml'), 'config');
  assert.equal(write('layout.json'), 'config');
  assert.equal(write('skills/assistant.md'), 'config');
  assert.equal(write('connectors/invoices.yaml'), 'config');
});

test('config · company.yaml bị chặn — nó là chỗ khai mcpServers', () => {
  assert.equal(write(path.join(companyDir, 'company.yaml')), 'config');
});

test('config · ĐỌC file vai trò vẫn được — ranh giới hẹp có chủ ý', () => {
  // Đọc một vai trò không leo thang được gì; chặn nó là mở rộng vùng cấm ra
  // khỏi thứ đã đo, đúng kiểu vá làm hỏng ca khác.
  assert.equal(read('roles/nguoi-viet-bao-cao.yaml'), undefined);
  assert.equal(read('office.yaml'), undefined);
});

test('config · viết HOA cũng bị chặn — trên Windows đó là cùng một file', () => {
  assert.equal(write('ROLES/x.yaml'), 'config');
  assert.equal(write('Office.YAML'), 'config');
});

// ─────────────────────────────────────────────── ③ ngoài VĂN PHÒNG — luật cũ

test('outside · ghi ra ngoài thư mục văn phòng vẫn bị chặn như trước', () => {
  assert.equal(write(path.join(companyDir, 'offices', 'khac', 'artifacts', 'x.md')), 'outside');
  assert.equal(write('../../../etc/passwd'), 'outside');
});

test('outside · ĐỌC ra ngoài KHÔNG bị chặn — hàng rào đọc tổng quát chưa dựng', () => {
  // ⚠ Đây là hiện trạng có chủ ý, không phải thiếu sót. Bản vá này khoá `.state/`,
  // nó KHÔNG dựng hàng rào đọc. Câu còn mở số 1 ở SPEC-arms §14. Test này tồn
  // tại để ngày ai đó dựng hàng rào đó, họ phải sửa DÒNG NÀY — tức là phải
  // nhìn thấy mình đang đổi một quyết định, không đổi nhầm.
  assert.equal(read('/etc/passwd'), undefined);
  assert.equal(read(path.join(companyDir, 'offices', 'khac', 'artifacts', 'x.md')), undefined);
});

// ─────────────────────────────────────────────── ④ KHÔNG ĐƯỢC CHẶN — nửa còn lại

test('KHÔNG chặn · artifacts/ — đây là chỗ nhân viên GIAO HÀNG', () => {
  assert.equal(write('artifacts/T-01/ban-ke.md'), undefined);
  assert.equal(read('artifacts/T-01/ban-ke.md'), undefined);
});

test('KHÔNG chặn · knowledge/ — chặn nó là giết cơ chế HỌC', () => {
  assert.equal(write('knowledge/shared/bai-hoc.md'), undefined);
  assert.equal(write('knowledge/agents/nguoi-viet/x.md'), undefined);
  assert.equal(read('knowledge/index.json'), undefined);
});

test('KHÔNG chặn · library/ — tủ tài liệu người dùng đưa vào', () => {
  assert.equal(read('library/text/hop-dong.txt'), undefined);
  assert.equal(read('library/INDEX.md'), undefined);
});

test('KHÔNG chặn · tool không khai đường dẫn nào', () => {
  // `Glob` có `path` tuỳ chọn; thiếu nó nghĩa là "từ cwd". Chuỗi rỗng phải cho
  // qua, không được resolve thành chính thư mục văn phòng rồi tự bắt mình.
  assert.equal(read(''), undefined);
  assert.equal(write(''), undefined);
});

test('KHÔNG chặn · file có chữ "roles" trong tên nhưng không phải thư mục roles', () => {
  // Khớp theo ĐOẠN ĐƯỜNG DẪN, không theo chuỗi con. `roles-cu.md` không phải
  // `roles/`, và một phép dò chuỗi ngây thơ sẽ nuốt nhầm nó.
  assert.equal(write('artifacts/roles-cu.md'), undefined);
  assert.equal(write('artifacts/danh-sach-roles/x.md'), undefined);
});

// ───────────────────────────────────── ⑤ CÁNH TAY (mode `arm`, 24/08)
//
// Cánh tay là đường GHI RA ngoài ĐƯỢC PHÉP — luật §8·0: *"mọi đường ra phải
// qua một tool/MCP TƯỜNG MINH"*. Nên bộ ba luật của nó lệch hẳn `write`, và
// cả hai chiều đều phải có test: chặn cái phải chặn, VÀ cho qua cái phải cho.

test('arm · RA ngoài văn phòng KHÔNG bị chặn — đó là lý do cánh tay tồn tại', () => {
  // Đây là dòng khác biệt duy nhất giữa `arm` và `write`, và là cả điểm của
  // bản vá 24/08. Ngày ai đổi nó, họ phải đọc §8·0 trước.
  assert.equal(arm('D:\\Downloads\\Programs Installation\\ban-ke.md'), undefined);
  assert.equal(arm('/home/an/ho-so/x.md'), undefined);
  assert.equal(arm(path.join(companyDir, 'offices', 'khac', 'artifacts', 'x.md')), undefined);
});

test('arm · kho chìa vẫn cấm — MCP không được là cửa sau vào `.state/`', () => {
  assert.equal(arm(path.join(companyDir, '.state', 'secrets.json')), 'secrets');
  assert.equal(arm('../../.state/secrets.json'), 'secrets');
  assert.equal(arm('.state/tasks/P-1.plan.json'), 'secrets');
});

test('arm · file cấu hình vẫn cấm — kể cả ĐỌC, khác `read` builtin', () => {
  // Cố ý HẸP HƠN `read`: lúc hook chạy ta chỉ có TÊN TOOL, không có cách tất
  // định nào biết `mcp__x__foo` là đọc hay ghi. Dò chuỗi tên là quay lại đúng
  // class bất định đã loại ở §5n ㉕. Phủ định sai ở đây tốn 0: `Read` builtin
  // vẫn đọc `roles/*.yaml` được như cũ (test ngay dưới khoá chuyện đó).
  assert.equal(arm('roles/nguoi-kiem-ke.yaml'), 'config');
  assert.equal(arm('office.yaml'), 'config');
  assert.equal(arm(path.join(companyDir, 'company.yaml')), 'config');
  assert.equal(read('roles/nguoi-kiem-ke.yaml'), undefined);
});

test('arm · artifacts/ và library/ vẫn mở — nửa NGƯỢC CHIỀU của cùng bất biến', () => {
  assert.equal(arm('artifacts/P-1/T-01/ban-ke.md'), undefined);
  assert.equal(arm('library/text/hop-dong.txt'), undefined);
  assert.equal(arm('knowledge/shared/bai-hoc.md'), undefined);
  assert.equal(arm(''), undefined);
});
