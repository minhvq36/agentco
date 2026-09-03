/**
 * Test cho BA MẢNH NỐI CÁNH TAY VÀO WORKER — thứ đã KHÔNG tồn tại suốt từ lúc
 * danh mục ra đời (23/08) tới khi user chạy bài 9 và bắt được (24/08).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CA THẬT: `P-260824-0355-r3qe`, văn phòng `kiem-ke`.                       │
 * │                                                                          │
 * │ Cánh tay `File trên máy` đã cắm, đã nối dây, trỏ đúng thư mục người dùng  │
 * │ muốn. Nhân viên gọi tool BA LẦN. Cả ba lần nhận:                          │
 * │                                                                          │
 * │   "Claude requested permissions to use mcp__files__list_directory_with_   │
 * │    sizes, but you haven't granted it yet."                               │
 * │                                                                          │
 * │ `blocked` · 4 lượt · $0,0948 · 0 kết quả. Và bước T-02 đổ theo.           │
 * │                                                                          │
 * │ Hai lỗ chồng nhau, cả hai IM LẶNG, và cái thứ hai nặng hơn:               │
 * │   ① `allowedTools` không có tên tool MCP ⇒ SDK deny mọi lời gọi.          │
 * │   ② `args` của server-filesystem BỊ BỎ — nó nghe `roots` của client       │
 * │      (`cwd` + `additionalDirectories`), nên thư mục người dùng khai ở     │
 * │      hộp thoại chưa bao giờ có hiệu lực.                                  │
 * │                                                                          │
 * │ ⇒ Ta trả ~2 185 token MỖI LƯỢT cho một bộ 14 tool không dùng được.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Ba hàm thuần (một hàm đụng `fs`), 0 token, 0 lượt LLM. Phần "có nổ hook
 * không" và "allowlist có ăn không" thì không test đơn vị được — chúng sống ở
 * `scripts/spike-mcp-hook.ts` và `scripts/spike-mcp-allow.ts`, đã chạy thật.
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { armRoots, describeCall, pathsIn, warnDroppedTools } from '../dist/core/worker.js';
import { effectiveTools } from '../dist/core/types.js';

// `armRoots` kêu bằng `process.emitWarning` khi một thư mục biến mất. Gắn một
// listener rỗng để cảnh báo đó không đổ ra stderr giữa bảng kết quả test —
// listener thay hẳn bộ in mặc định của Node.
process.on('warning', () => {});

const role = { id: 'nguoi-kiem-ke' } as never;

// ──────────────────────────────────────────────────────────────────── pathsIn
//
// Sót MỘT tên trường ở đây là để hở đúng một tool, và im lặng — cùng bài học
// `SHELL_ALIASES` đã đốt sáu ngày.

test('pathsIn: ba tên trường của tool builtin', () => {
  assert.deepEqual(pathsIn({ file_path: 'a.md' }), ['a.md']);
  assert.deepEqual(pathsIn({ notebook_path: 'b.ipynb' }), ['b.ipynb']);
  assert.deepEqual(pathsIn({ path: 'c/' }), ['c/']);
});

test('pathsIn: `move_file` có HAI đường dẫn — phải trả về CẢ HAI', () => {
  // Bản trước dùng chuỗi `||` nên nó dừng ở cái đầu tiên tìm thấy. Với
  // `move_file` thì chỉ cần MỘT trong hai chạm vùng cấm là đủ hỏng, và cái
  // nguy hiểm (`destination`) lại là cái đứng sau.
  assert.deepEqual(pathsIn({ source: 'artifacts/x.md', destination: 'roles/y.yaml' }), [
    'artifacts/x.md',
    'roles/y.yaml',
  ]);
});

test('pathsIn: `read_multiple_files` khai một MẢNG', () => {
  assert.deepEqual(pathsIn({ paths: ['a.md', 'b.md'] }), ['a.md', 'b.md']);
});

test('pathsIn: chuỗi rỗng và giá trị không phải chuỗi bị bỏ, không bịa ra đường dẫn', () => {
  assert.deepEqual(pathsIn({ path: '', file_path: '   ' }), []);
  assert.deepEqual(pathsIn({ path: 42, paths: [null, 'ok.md'] }), ['ok.md']);
  assert.deepEqual(pathsIn({}), []);
});

// ─────────────────────────────────────────────────────────────────── armRoots

test('armRoots: lấy thư mục từ `args`, bỏ tên gói và cờ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'armroots-'));
  try {
    const servers = {
      files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2026.7.10', dir] },
    };
    assert.deepEqual(armRoots(role, servers as never), [dir]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('armRoots: hai cánh tay trỏ cùng một chỗ chỉ ra MỘT dòng', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'armroots-'));
  try {
    const servers = {
      a: { command: 'npx', args: ['-y', 'pkg', dir] },
      b: { command: 'npx', args: ['-y', 'pkg', dir] },
    };
    assert.deepEqual(armRoots(role, servers as never), [dir]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('armRoots: thư mục KHÔNG CÒN thì bỏ và kêu, KHÔNG ném', () => {
  // Ổ USB rút ra · thư mục bị xoá · văn phòng zip sang máy khác — cả ba có
  // thật. Hai hậu quả không cân nhau: bỏ đi thì cánh tay hẹp hơn người dùng
  // tưởng (có cảnh báo); truyền xuống thì CLI có thể từ chối CẢ LƯỢT CHẠY, và
  // mọi việc của vai trò đó chết kèm một câu lỗi không nói gì về cái ổ USB.
  const gone = path.join(os.tmpdir(), 'khong-bao-gio-ton-tai-9f3a2b');
  const servers = { a: { command: 'npx', args: ['-y', 'pkg', gone] } };
  assert.deepEqual(armRoots(role, servers as never), []);
});

test('armRoots: một FILE không phải một thư mục', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'armroots-'));
  const file = path.join(dir, 'x.txt');
  fs.writeFileSync(file, 'x');
  try {
    assert.deepEqual(armRoots(role, { a: { command: 'npx', args: ['-y', 'pkg', file] } } as never), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('armRoots: vai trò KHÔNG có cánh tay ⇒ rỗng ⇒ không truyền gì xuống SDK', () => {
  // Đặc quyền tối thiểu: `additionalDirectories` chỉ xuất hiện khi có cánh tay
  // thật sự cần nó. Một vai trò trần không được nới thêm một milimét nào.
  assert.deepEqual(armRoots(role, undefined), []);
});

test('armRoots: server HTTP không có `args` — không phải cánh tay file', () => {
  assert.deepEqual(armRoots(role, { gh: { url: 'https://api.githubcopilot.com/mcp/' } } as never), []);
});

// ──────────────────────────────────────────────────────────────── describeCall
//
// Luật 22/08: *mở rộng một quyền thì phải mở rộng cả ĐƯỜNG NHÌN vào nó, trong
// cùng một lần sửa*. Cánh tay vừa đi từ "không bao giờ chạy" sang "ghi được
// file lên đĩa của người dùng" — nhật ký phải theo kịp trong cùng ngày.

// Ca thật 24/08: nhật ký hiện `đang tìm “D:/Downloads/*” trong văn phòng` — SAI,
// lượt đó không tìm trong văn phòng chút nào. Nhật ký là cửa sổ DUY NHẤT người
// dùng có để biết nhân viên vừa chạm vào đâu trên máy họ; một dòng nói sai chỗ
// tệ hơn một dòng không nói gì.

test('describeCall: đường dẫn tuyệt đối trong `pattern` ⇒ nói ngoài văn phòng', () => {
  // `path` để trống, đường dẫn nhét thẳng vào `pattern` — đúng hình dạng ca thật.
  assert.equal(
    describeCall({ name: 'Glob', input: { pattern: 'D:/Downloads/*' } }),
    'đang tìm “D:/Downloads/*” ngoài văn phòng',
  );
});

test('describeCall: đường dẫn tuyệt đối trong `path` cũng vậy, cả hai kiểu hệ', () => {
  assert.equal(describeCall({ name: 'Grep', input: { pattern: 'x', path: 'D:\\Kho' } }), 'đang tìm “x” ngoài văn phòng');
  assert.equal(describeCall({ name: 'Grep', input: { pattern: 'x', path: '/home/a' } }), 'đang tìm “x” ngoài văn phòng');
});

test('describeCall: đường dẫn TƯƠNG ĐỐI vẫn nói đúng tên căn phòng như cũ', () => {
  assert.equal(describeCall({ name: 'Glob', input: { pattern: '*.md', path: 'library/text' } }), 'đang tìm “*.md” trong tủ tài liệu');
  assert.equal(describeCall({ name: 'Glob', input: { pattern: '*.md' } }), 'đang tìm “*.md” trong văn phòng');
});

test('describeCall: cánh tay nói TÊN người dùng đặt, không nói cái băm', () => {
  const line = describeCall(
    { name: 'mcp__a385afc3ab6__write_file', input: { path: 'D:\\Downloads\\x\\ban-ke.md' } },
    { a385afc3ab6: 'Programs Installation 2' },
  );
  assert.equal(line, 'Programs Installation 2 · write file → ban-ke.md');
});

test('describeCall: `move_file` khai ĐÍCH, không khai nguồn', () => {
  const line = describeCall(
    { name: 'mcp__files__move_file', input: { source: 'a.md', destination: 'D:\\kho\\b.md' } },
    { files: 'File trên máy' },
  );
  assert.equal(line, 'File trên máy · move file → b.md');
});

test('describeCall: chưa có nhãn thì rơi về băm — thà xấu còn hơn im', () => {
  const line = describeCall({ name: 'mcp__a385afc3ab6__list_directory', input: {} });
  assert.equal(line, 'a385afc3ab6 · list directory');
});

// ────────────────────────────────────────────────────────── warnDroppedTools
//
// Hàm này sinh ra 22/08 từ MỘT câu: "thứ tôi xin và thứ tôi nhận không khớp".
// Cánh tay vừa nện lại đúng hình dạng đó qua một cửa khác, nên nó đi vào đây
// chứ không đẻ ra một cơ chế thứ hai phải giữ đồng bộ.

test('warnDroppedTools: có khai `mcp:` mà CLI cấp 0 tool `mcp__` ⇒ KÊU', () => {
  const r = { id: 'nguoi-kiem-ke', tools: [], mcp: ['a385afc3ab6'] } as never;
  const granted = effectiveTools([]); // CLI cấp đủ 7 builtin, không cánh tay nào
  assert.deepEqual(warnDroppedTools(r, granted), ['(arms: a385afc3ab6)']);
});

test('warnDroppedTools: cánh tay lên được thì IM', () => {
  const r = { id: 'nguoi-kiem-ke', tools: [], mcp: ['a385afc3ab6'] } as never;
  const granted = [...effectiveTools([]), 'mcp__a385afc3ab6__list_directory'];
  assert.deepEqual(warnDroppedTools(r, granted), []);
});

test('warnDroppedTools: vai trò KHÔNG khai cánh tay thì không bao giờ kêu vì cánh tay', () => {
  // Báo động giả ở mọi lượt chạy là cách nhanh nhất dạy người ta bỏ qua cảnh báo.
  const r = { id: 'nguoi-viet', tools: [], mcp: [] } as never;
  assert.deepEqual(warnDroppedTools(r, effectiveTools([])), []);
});

test('describeCall: tool builtin KHÔNG đổi một chữ', () => {
  // Nửa ngược chiều: bản vá chạm đúng nhánh `default`, mọi nhánh khác phải y
  // nguyên. Không ai đi kiểm lại một dòng nhật ký vốn vẫn đúng.
  assert.equal(describeCall({ name: 'Read', input: { file_path: 'a/b.md' } }), 'đang đọc b.md');
  assert.equal(describeCall({ name: 'Write', input: { file_path: 'x.md' } }), 'đang viết x.md');
  assert.equal(describeCall({ name: 'Bash', input: { command: 'ls -la' } }), 'đang chạy: ls -la');
  assert.equal(describeCall({ name: 'WebSearch', input: {} }), 'đang tìm trên web');
});
