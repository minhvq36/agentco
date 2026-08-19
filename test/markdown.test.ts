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

import { blocksOf, spansOf, tokenize } from '../web/src/lib/markdown-core.ts';

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
