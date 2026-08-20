/**
 * Test cho bộ phân tích markdown của giao diện (20/08).
 *
 * Người dùng nêu đích danh nỗi lo: *"phần `` này hay bị lỗi, nhất là `` lồng
 * nhau, cần xử lý cho thật gọn không sẽ bị lệch format code"* — và hỏi thẳng
 * liệu có nên bỏ hẳn không.
 *
 * Câu trả lời là LÀM, với điều kiện không dùng chuỗi `.replace()` nối tiếp. File
 * này là chỗ chứng minh điều kiện đó được giữ. Ba ca hỏng kinh điển đều có mặt:
 *
 *   1. backtick lẻ → nuốt sạch phần đuôi văn bản vào một khối code
 *   2. backtick lồng nhau → cắt sai chỗ, lệch format từ đó trở đi
 *   3. `**` bên trong code → bị bôi đậm, và dấu sao biến mất khỏi code
 *
 * ⚠ Import THẲNG từ `web/src/`, không qua `dist/`: giao diện có tsconfig riêng
 * và không đi qua bản build của core. Node tự bóc kiểu cho `.ts` — đó cũng là lý
 * do phần phân tích được tách khỏi `markdown.tsx` (JSX thì không bóc được).
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { blocksOf, hasTable, spansOf, tokenize } from '../web/src/lib/markdown-core.ts';

type TableBlock = { kind: 'table'; head: string[]; rows: string[][]; align: string[] };

/** Lấy bảng đầu tiên, hoặc `undefined` nếu bộ phân tích không coi đó là bảng. */
const tableOf = (src: string): TableBlock | undefined =>
  blocksOf(src).find((b) => b.kind === 'table') as TableBlock | undefined;

/** Gọn cho dễ đọc: `code` -> `` `x` ``, đậm -> `*x*`, thường -> `x`. */
const sketch = (src: string): string =>
  spansOf(src)
    .map((s) => (s.code ? `\`${s.text}\`` : s.bold ? `*${s.text}*` : s.text))
    .join('|');

// ─────────────────────────────────────────── ca hỏng 1: backtick lẻ

test('backtick LẺ in nguyên văn, KHÔNG nuốt phần đuôi', () => {
  // Đây là ca "lệch format từ đó trở đi": bản naive coi backtick lẻ là dấu mở
  // rồi gom hết phần còn lại vào code.
  assert.equal(sketch('giá 100`000 đồng nhé'), 'giá 100`000 đồng nhé');
  assert.equal(tokenize('mở ` mà không đóng').filter((t) => t.code).length, 0);
});

test('backtick lẻ SAU một cặp hợp lệ không phá cặp đó', () => {
  assert.equal(sketch('xem `a.md` rồi ` bỏ lửng'), 'xem |`a.md`| rồi ` bỏ lửng');
});

// ─────────────────────────────────────────── ca hỏng 2: lồng nhau

test('LỒNG NHAU: hai backtick bọc ngoài, một backtick là NỘI DUNG', () => {
  // Luật CommonMark: mở N thì đóng đúng N. Không có luật riêng nào cho "lồng
  // nhau" — chính vì thế nó không có chỗ để sai.
  const t = tokenize('viết `` `x` `` để hiện backtick');
  const code = t.filter((x) => x.code);
  assert.equal(code.length, 1);
  assert.equal(code[0]!.text, '`x`', 'nội dung phải giữ nguyên cả hai backtick trong');
});

test('LỒNG NHAU: run DÀI HƠN không được tính là dấu đóng', () => {
  // `` mở, thì ``` ở giữa KHÔNG đóng nó — nếu tính nhầm thì cắt sai chỗ và mọi
  // thứ phía sau lệch một nhịp.
  const code = tokenize('``a ``` b`` c').filter((x) => x.code);
  assert.equal(code.length, 1);
  assert.equal(code[0]!.text, 'a ``` b');
});

test('LỒNG NHAU: bỏ đúng MỘT dấu cách hai đầu, không nhiều hơn', () => {
  assert.equal(tokenize('`` ` ``')[0]!.text, '`');
  assert.equal(tokenize('`  x  `')[0]!.text, ' x ', 'chỉ bóc một lớp, phần còn lại là nội dung thật');
});

// ─────────────────────────────────────────── ca hỏng 3: `**` gặp code

test('`**` BÊN TRONG code span KHÔNG bao giờ thành đậm', () => {
  assert.equal(sketch('công thức `a ** b` đó'), 'công thức |`a ** b`| đó');
});

test('đậm ÔM TRỌN code span nằm giữa', () => {
  // Ca thật trong sản phẩm: "**xem `bao-hanh.md` nhé**".
  assert.equal(sketch('**xem `bao-hanh.md` nhé**'), '*xem *|`bao-hanh.md`|* nhé*');
});

test('`**` LẺ in nguyên văn', () => {
  assert.equal(sketch('2**3 là tám'), '2**3 là tám');
  assert.equal(sketch('**bị cắt giữa chừng'), '**bị cắt giữa chừng');
});

test('đậm thường, nhiều cụm trên một dòng', () => {
  assert.equal(
    sketch('**bảo hành 12 tháng** và **không** áp dụng'),
    '*bảo hành 12 tháng*| và |*không*| áp dụng',
  );
});

// ─────────────────────────────────────────── khối

test('fence: `**` bên trong khối code KHÔNG bị đụng tới', () => {
  const b = blocksOf('trước\n```python\nx = a ** b\n```\nsau');
  assert.equal(b.length, 3);
  assert.equal(b[1]!.kind, 'code');
  assert.equal((b[1] as { text: string }).text, 'x = a ** b');
  assert.equal((b[1] as { lang: string }).lang, 'python');
});

test('fence KHÔNG ĐÓNG nuốt tới hết — model bị cắt giữa chừng vẫn hiện đúng kiểu', () => {
  const b = blocksOf('```ts\nconst a = 1;\nconst b = 2;');
  assert.equal(b.length, 1);
  assert.equal(b[0]!.kind, 'code');
  assert.equal((b[0] as { text: string }).text, 'const a = 1;\nconst b = 2;');
});

test('tiêu đề: bắt được cấp, và `#` giữa dòng KHÔNG phải tiêu đề', () => {
  const b = blocksOf('# To\n## Vừa\nmã #123 không phải tiêu đề');
  assert.equal(b[0]!.kind, 'heading');
  assert.equal((b[0] as { level: number }).level, 1);
  assert.equal((b[1] as { level: number }).level, 2);
  assert.equal(b[2]!.kind, 'text');
});

// ─────────────────────── hồi quy: câu backend dựng sẵn không được đổi hình

test('/help giữ nguyên: 4 dấu cách KHÔNG được thành khối code', () => {
  // `helpText()` thụt mô tả lệnh đúng 4 dấu cách. CommonMark coi đó là khối
  // code — bật luật ấy lên là biến `/help` thành một khối xám. Đây là lý do
  // `blocksOf` cố ý không hỗ trợ khối code thụt lề.
  const help = '/stop   (hoặc /s)\n    Ngắt việc đang chạy\n\n/help\n    Xem danh sách lệnh này';
  const b = blocksOf(help);
  assert.equal(b.length, 1);
  assert.equal(b[0]!.kind, 'text');
  assert.equal((b[0] as { text: string }).text, help, 'phải giữ NGUYÊN VĂN, cả xuống dòng lẫn thụt lề');
});

test('dải bước kế hoạch giữ nguyên: "  1. " KHÔNG thành danh sách đánh số lại', () => {
  const plan = 'Mình chia thành 2 việc:\n  1. Tìm hiểu yêu cầu\n  2. Viết nội dung\nBắt đầu nhé.';
  const b = blocksOf(plan);
  assert.equal(b.length, 1);
  assert.equal((b[0] as { text: string }).text, plan);
});

test('đường dẫn có gạch dưới KHÔNG bị biến thành chữ nghiêng', () => {
  // Lý do cụ thể để bỏ hẳn `_nghiêng_`: sản phẩm này nói `plan_id`,
  // `hot_knowledge_tokens`, `max_turns` ở khắp nơi.
  const s = 'đặt hot_knowledge_tokens và max_turns trong roles/nguoi-viet.yaml';
  assert.equal(sketch(s), s);
});

test('văn bản trơn đi thẳng, không sinh khối thừa', () => {
  assert.equal(sketch('Cảm ơn quý khách đã quan tâm!'), 'Cảm ơn quý khách đã quan tâm!');
  assert.deepEqual(blocksOf(''), []);
});

// ─────────────────────────────────────────── bảng: "trọn bảng hoặc không gì cả"

test('bảng THẬT: đúng bảng người dùng đưa ra (20/08)', () => {
  // Nguyên văn kết quả một ca chạy thật — đây là dạng bảng nhân viên sinh ra
  // nhiều nhất: nhóm · nội dung · số tiền.
  const src = [
    '| Nhóm | Danh Sách Nội Dung | Tổng Tiền |',
    '|------|-------------------|----------|',
    '| Ăn Uống | (không có) | 0 VNĐ |',
    '| Đi Lại | GRAB *TRIP | 85.000 VNĐ |',
    '| Nhà Ở | TIEN NHA THANG 7 | 4.500.000 VNĐ |',
  ].join('\n');

  const t = tableOf(src);
  assert.ok(t, 'phải nhận ra là bảng');
  assert.deepEqual(t.head, ['Nhóm', 'Danh Sách Nội Dung', 'Tổng Tiền']);
  assert.equal(t.rows.length, 3);
  assert.deepEqual(t.rows[2], ['Nhà Ở', 'TIEN NHA THANG 7', '4.500.000 VNĐ']);
  // `*TRIP` KHÔNG được biến mất: một dấu sao lẻ là văn bản, không phải cú pháp.
  assert.equal(sketch(t.rows[1]![1]!), 'GRAB *TRIP');
});

test('KHÔNG có dòng phân cách → KHÔNG phải bảng, giữ nguyên văn', () => {
  // Người dùng gõ "a | b" trong một câu bình thường là chuyện xảy ra hằng ngày.
  const src = 'chọn giữa cà phê | trà sữa | nước ép nhé';
  const b = blocksOf(src);
  assert.equal(b.length, 1);
  assert.equal(b[0]!.kind, 'text');
  assert.equal((b[0] as { text: string }).text, src);
});

test('LỆCH SỐ CỘT giữa tiêu đề và dòng phân cách → vứt cả bảng, hiện nguyên văn', () => {
  // Luật "trọn bảng hoặc không gì cả". Một bảng thiếu cột là lời khẳng định SAI
  // về dữ liệu, và người đọc tin cái bảng hơn tin đống dấu `|`.
  const src = '| A | B | C |\n|---|---|\n| 1 | 2 | 3 |';
  assert.equal(tableOf(src), undefined);
  assert.equal(blocksOf(src)[0]!.kind, 'text');
});

test('dòng phân cách hỏng (có chữ) → KHÔNG phải bảng', () => {
  assert.equal(tableOf('| A | B |\n|--- | xx |\n| 1 | 2 |'), undefined);
});

test('canh cột đọc từ dấu hai chấm', () => {
  const t = tableOf('| A | B | C |\n|:---|:---:|---:|\n| 1 | 2 | 3 |');
  assert.deepEqual(t!.align, ['left', 'center', 'right']);
});

test('không có `|` hai đầu vẫn là bảng hợp lệ (GFM)', () => {
  const t = tableOf('A | B\n--- | ---\n1 | 2');
  assert.deepEqual(t!.head, ['A', 'B']);
  assert.deepEqual(t!.rows, [['1', '2']]);
});

test('`\\|` là NỘI DUNG ô, không phải vách ngăn', () => {
  // Thiếu luật thoát thì ô này tự tách làm đôi, hàng lệch cột so với tiêu đề,
  // và cả bảng bị vứt ở khâu kiểm — người dùng chỉ thấy "bảng không hiện".
  const t = tableOf('| Ký hiệu | Nghĩa |\n|---|---|\n| a \\| b | hoặc |');
  assert.deepEqual(t!.rows, [['a | b', 'hoặc']]);
});

test('hàng THÂN thiếu/thừa ô thì đệm hoặc cắt, KHÔNG vứt bảng', () => {
  // Ràng buộc chặt chỉ đặt ở chỗ quyết định "đây có phải bảng không". Quyết rồi
  // thì một hàng lệch không đáng để vứt cả bảng.
  const t = tableOf('| A | B | C |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |');
  assert.deepEqual(t!.rows, [
    ['1', '', ''],
    ['1', '2', '3'],
  ]);
});

test('bảng DỪNG ở dòng trắng, văn bản sau đó là khối riêng', () => {
  const b = blocksOf('| A |\n|---|\n| 1 |\n\nCâu sau bảng.');
  assert.equal(b.length, 2);
  assert.equal(b[0]!.kind, 'table');
  assert.equal((b[1] as { text: string }).text.trim(), 'Câu sau bảng.');
});

test('văn bản TRƯỚC bảng không bị nuốt vào bảng', () => {
  const b = blocksOf('Bảng chi tiêu:\n| A |\n|---|\n| 1 |');
  assert.equal(b.length, 2);
  assert.equal((b[0] as { text: string }).text, 'Bảng chi tiêu:');
  assert.equal(b[1]!.kind, 'table');
});

test('bảng bên TRONG khối code KHÔNG bị dựng thành bảng', () => {
  // Thứ tự bất biến của `blocksOf`: fence xong hẳn trước mọi luật khác.
  const b = blocksOf('```\n| A |\n|---|\n| 1 |\n```');
  assert.equal(b.length, 1);
  assert.equal(b[0]!.kind, 'code');
});

test('`**` và `` ` `` bên trong ô vẫn chạy', () => {
  const t = tableOf('| Tên | Ghi chú |\n|---|---|\n| **quan trọng** | xem `a.md` |');
  assert.equal(sketch(t!.rows[0]![0]!), '*quan trọng*');
  assert.equal(sketch(t!.rows[0]![1]!), 'xem |`a.md`');
});

test('gạch ngang `---` KHÔNG biến một câu có dấu `|` thành bảng một cột', () => {
  // Ca giả nguy hiểm nhất của bảng một cột. `---` đứng một mình là gạch ngang /
  // tiêu đề setext — hai thứ bộ phân tích này cố ý không hỗ trợ.
  const src = 'chọn cà phê | trà sữa\n---\nnói mình biết nhé';
  assert.equal(tableOf(src), undefined);
  assert.equal(blocksOf(src)[0]!.kind, 'text');
});

test('bảng MỘT CỘT hợp lệ vẫn dựng được', () => {
  const t = tableOf('| Việc cần làm |\n|---|\n| Gọi cho khách |');
  assert.deepEqual(t!.head, ['Việc cần làm']);
  assert.deepEqual(t!.rows, [['Gọi cho khách']]);
});

test('hasTable khớp ĐÚNG với blocksOf — hai cách nhận diện không được lệch nhau', () => {
  // Ô chat dùng `hasTable` để chọn bề rộng bong bóng. Lệch nhau nghĩa là bong
  // bóng nới rộng cho một thứ tầng vẽ lại quyết định hiện nguyên văn.
  const yes = '| A |\n|---|\n| 1 |';
  const no = 'a | b | c';
  assert.equal(hasTable(yes), true);
  assert.equal(hasTable(no), false);
  assert.equal(hasTable('```\n| A |\n|---|\n```'), false);
  assert.equal(hasTable('Đã xong.'), false);
});

test('hồi quy: /help và dải bước kế hoạch vẫn KHÔNG chạm luật bảng', () => {
  // Cả hai đều không có `|`, nhưng chốt lại vì luật bảng là luật mới nhất trong
  // `blocksOf` và nó chạy trước `text.push`.
  const help = '/stop   (hoặc /s)\n    Ngắt việc đang chạy';
  assert.equal(blocksOf(help)[0]!.kind, 'text');
  assert.equal((blocksOf(help)[0] as { text: string }).text, help);
});

// ───────────────────────────────── danh sách việc `- [ ]` / `- [x]` (21/08)
//
// Bài 6 sinh ra đúng thứ này ("gộp thành một checklist ngắn"). In nguyên văn
// thì người dùng nhận về ký tự thay vì một danh sách đọc được bằng mắt.

test('tasks: gom các dòng liền nhau thành MỘT khối, đọc đúng trạng thái', () => {
  const b = blocksOf('- [ ] chưa làm\n- [x] đã làm\n* [X] hoa thị, chữ X hoa');
  assert.equal(b.length, 1);
  assert.equal(b[0].kind, 'tasks');
  assert.deepEqual(b[0].items, [
    { done: false, text: 'chưa làm' },
    { done: true, text: 'đã làm' },
    { done: true, text: 'hoa thị, chữ X hoa' },
  ]);
});

test('tasks: dòng trắng CẮT danh sách thành hai — cùng luật với bảng', () => {
  const b = blocksOf('- [ ] a\n\n- [ ] b');
  assert.deepEqual(b.map((x) => x.kind), ['tasks', 'tasks']);
});

test('tasks: gạch đầu dòng THƯỜNG không bị nuốt vào danh sách việc', () => {
  const b = blocksOf('- [ ] việc\n- chỉ là gạch đầu dòng');
  assert.equal(b[0].kind, 'tasks');
  assert.equal(b[0].items.length, 1, 'chỉ MỘT việc');
  assert.equal(b[1].kind, 'text');
});

test('tasks: thiếu khoảng trắng sau `]` thì KHÔNG phải việc cần làm', () => {
  // `- [x]abc` trong văn xuôi kỹ thuật là một tham chiếu, không phải checkbox.
  assert.equal(blocksOf('- [x]abc')[0].kind, 'text');
});

test('tasks: ô trống rỗng không nội dung vẫn là gạch đầu dòng thường', () => {
  assert.equal(blocksOf('- [ ]')[0].kind, 'text');
  assert.equal(blocksOf('- [ ]   ')[0].kind, 'text');
});

test('tasks: nằm trong khối code thì KHÔNG bị bóc — fence thắng', () => {
  const b = blocksOf('```md\n- [ ] đây là ví dụ\n```');
  assert.equal(b.length, 1);
  assert.equal(b[0].kind, 'code');
});

test('tasks: giữ được định dạng inline trong nội dung việc', () => {
  const b = blocksOf('- [x] xem `file.md` và **sửa**');
  assert.equal(b[0].items[0].text, 'xem `file.md` và **sửa**');
});
