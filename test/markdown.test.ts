
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { blocksOf, hasTable, spansOf, tokenize } from '../web/src/lib/markdown-core.ts';

type TableBlock = { kind: 'table'; head: string[]; rows: string[][]; align: string[] };

const tableOf = (src: string): TableBlock | undefined =>
  blocksOf(src).find((b) => b.kind === 'table') as TableBlock | undefined;

const sketch = (src: string): string =>
  spansOf(src)
    .map((s) => (s.code ? `\`${s.text}\`` : s.bold ? `*${s.text}*` : s.text))
    .join('|');


// ───────────────────────────────────────────────────────── links (08/09)

const link = (src: string) => spansOf(src).find((s) => s.href);

test('🔴 `[label](https://…)` becomes ONE span carrying the destination', () => {
  const out = spansOf('xem [Notion pricing](https://www.eesel.ai/blog/notion-pricing) nhé'); // i18n-allow-vietnamese: fixture — Vietnamese markdown input
  assert.deepEqual(
    out.map((s) => s.text),
    ['xem ', 'Notion pricing', ' nhé'], // i18n-allow-vietnamese: fixture — Vietnamese markdown input
    'the text around the link must survive exactly as written',
  );
  assert.equal(out[1]!.href, 'https://www.eesel.ai/blog/notion-pricing');
  assert.equal(out[0]!.href, undefined, 'only the label carries a destination');
});

test('🔴 ONLY http/https — every other scheme prints VERBATIM, never as a link', () => {
  // The text is model-generated, so the gate is an allowlist: `data:`,
  // `file:`, `vbscript:` and whatever comes next are out by construction.
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox',
    '/relative/path',
    'ftp://host/x',
  ]) {
    const src = `see [click me](${url}) now`;
    assert.equal(link(src), undefined, `${url} must not become a link`);
    // …and refused is not the same as swallowed: every character still shows.
    assert.equal(spansOf(src).map((s) => s.text).join(''), src, `${url} lost characters`);
  }
});

test('🔴 a link inside a CODE span is not a link — the code rule wins', () => {
  const out = spansOf('gõ `[a](https://x.test)` vào'); // i18n-allow-vietnamese: fixture — Vietnamese markdown input
  assert.equal(out.some((s) => s.href), false);
  assert.equal(out.find((s) => s.code)?.text, '[a](https://x.test)');
});

test('a bold link keeps BOTH — bold is resolved first and travels with the label', () => {
  const out = spansOf('**[docs](https://x.test)**');
  assert.equal(out.length, 1);
  assert.equal(out[0]!.bold, true);
  assert.equal(out[0]!.href, 'https://x.test');
  assert.equal(out[0]!.text, 'docs');
});

test('two links in one line each keep their own destination', () => {
  const out = spansOf('[a](https://one.test) and [b](https://two.test)').filter((s) => s.href);
  assert.deepEqual(out.map((s) => s.href), ['https://one.test', 'https://two.test']);
  assert.deepEqual(out.map((s) => s.text), ['a', 'b']);
});

test('half a link is not a link, and nothing is lost', () => {
  for (const src of ['[label](', '[label] (https://x.test)', 'a ] b ( c', '[](https://x.test)']) {
    assert.equal(link(src), undefined, `"${src}" should print verbatim`);
    assert.equal(spansOf(src).map((s) => s.text).join(''), src);
  }
});

test('⭐ the LABEL may lie about the destination — the parse keeps them separate', () => {
  // The renderer is what puts the real address in front of the reader
  // (`title`); this asserts the two strings never get merged on the way there.
  const out = link('[your invoice](https://evil.test/phish)')!;
  assert.equal(out.text, 'your invoice');
  assert.equal(out.href, 'https://evil.test/phish');
});

test('lone backtick prints verbatim, does NOT swallow the trailing part', () => {
  assert.equal(sketch('giá 100`000 đồng nhé'), 'giá 100`000 đồng nhé'); // i18n-allow-vietnamese: fixture — Vietnamese markdown input
  assert.equal(tokenize('mở ` mà không đóng').filter((t) => t.code).length, 0); // i18n-allow-vietnamese: fixture — Vietnamese markdown input
});

test('a lone backtick AFTER a valid pair does not break that pair', () => {
  assert.equal(sketch('xem `a.md` rồi ` bỏ lửng'), 'xem |`a.md`| rồi ` bỏ lửng'); // i18n-allow-vietnamese: fixture — Vietnamese markdown input
});


test('NESTED: two backticks wrap the outside, one backtick is CONTENT', () => {
  const t = tokenize('viết `` `x` `` để hiện backtick'); // i18n-allow-vietnamese: fixture — Vietnamese markdown input
  const code = t.filter((x) => x.code);
  assert.equal(code.length, 1);
  assert.equal(code[0]!.text, '`x`', 'content must keep both inner backticks intact');
});

test('NESTED: a LONGER run must not be counted as the closing delimiter', () => {
  const code = tokenize('``a ``` b`` c').filter((x) => x.code);
  assert.equal(code.length, 1);
  assert.equal(code[0]!.text, 'a ``` b');
});

test('NESTED: strips exactly ONE space from each end, no more', () => {
  assert.equal(tokenize('`` ` ``')[0]!.text, '`');
  assert.equal(tokenize('`  x  `')[0]!.text, ' x ', 'only one layer is stripped, the rest is real content');
});


test('`**` INSIDE a code span never becomes bold', () => {
  assert.equal(sketch('công thức `a ** b` đó'), 'công thức |`a ** b`| đó'); // i18n-allow-vietnamese: fixture — Vietnamese markdown input
});

test('bold WRAPS AROUND a code span in the middle', () => {
  assert.equal(sketch('**xem `bao-hanh.md` nhé**'), '*xem *|`bao-hanh.md`|* nhé*'); // i18n-allow-vietnamese: fixture — Vietnamese markdown input
});

test('a LONE `**` prints verbatim', () => {
  assert.equal(sketch('2**3 là tám'), '2**3 là tám'); // i18n-allow-vietnamese: fixture — Vietnamese markdown input
  assert.equal(sketch('**bị cắt giữa chừng'), '**bị cắt giữa chừng'); // i18n-allow-vietnamese: fixture — Vietnamese markdown input
});

test('regular bold, multiple runs on one line', () => {
  assert.equal(
    sketch('**bảo hành 12 tháng** và **không** áp dụng'), // i18n-allow-vietnamese: fixture — Vietnamese markdown input
    '*bảo hành 12 tháng*| và |*không*| áp dụng', // i18n-allow-vietnamese: fixture — Vietnamese markdown input
  );
});


test('fence: `**` inside a code block is NOT touched', () => {
  const b = blocksOf('trước\n```python\nx = a ** b\n```\nsau'); // i18n-allow-vietnamese: fixture — Vietnamese markdown input
  assert.equal(b.length, 3);
  assert.equal(b[1]!.kind, 'code');
  assert.equal((b[1] as { text: string }).text, 'x = a ** b');
  assert.equal((b[1] as { lang: string }).lang, 'python');
});

test('an UNCLOSED fence does not swallow to the end — a model cut off mid-stream still renders the right kind', () => {
  const b = blocksOf('```ts\nconst a = 1;\nconst b = 2;');
  assert.equal(b.length, 1);
  assert.equal(b[0]!.kind, 'code');
  assert.equal((b[0] as { text: string }).text, 'const a = 1;\nconst b = 2;');
});

test('heading: level is detected, and a mid-line `#` is NOT a heading', () => {
  const b = blocksOf('# To\n## Vừa\nmã #123 không phải tiêu đề'); // i18n-allow-vietnamese: fixture — Vietnamese markdown input
  assert.equal(b[0]!.kind, 'heading');
  assert.equal((b[0] as { level: number }).level, 1);
  assert.equal((b[1] as { level: number }).level, 2);
  assert.equal(b[2]!.kind, 'text');
});


test('/help preserved verbatim: 4 spaces do NOT become a code block', () => {
  const help = '/stop   (hoặc /s)\n    Ngắt việc đang chạy\n\n/help\n    Xem danh sách lệnh này'; // i18n-allow-vietnamese: fixture — Vietnamese CLI help text
  const b = blocksOf(help);
  assert.equal(b.length, 1);
  assert.equal(b[0]!.kind, 'text');
  assert.equal((b[0] as { text: string }).text, help, 'must be preserved VERBATIM, both line breaks and indentation');
});

test('a plan step list is preserved verbatim: "  1. " does NOT get renumbered as a list', () => {
  const plan = 'Mình chia thành 2 việc:\n  1. Tìm hiểu yêu cầu\n  2. Viết nội dung\nBắt đầu nhé.'; // i18n-allow-vietnamese: fixture — Vietnamese plan text
  const b = blocksOf(plan);
  assert.equal(b.length, 1);
  assert.equal((b[0] as { text: string }).text, plan);
});

test('a path containing an underscore is NOT turned into italics', () => {
  const s = 'đặt hot_knowledge_tokens và max_turns trong roles/nguoi-viet.yaml'; // i18n-allow-vietnamese: fixture — Vietnamese sentence with a path
  assert.equal(sketch(s), s);
});

test('plain text passes straight through, no extra block is generated', () => {
  assert.equal(sketch('Cảm ơn quý khách đã quan tâm!'), 'Cảm ơn quý khách đã quan tâm!'); // i18n-allow-vietnamese: fixture — Vietnamese sentence
  assert.deepEqual(blocksOf(''), []);
});


test('REAL table: matches exactly the table the user provided (Aug 20)', () => {
  const src = [
    '| Nhóm | Danh Sách Nội Dung | Tổng Tiền |', // i18n-allow-vietnamese: fixture — Vietnamese table content
    '|------|-------------------|----------|',
    '| Ăn Uống | (không có) | 0 VNĐ |', // i18n-allow-vietnamese: fixture — Vietnamese table content
    '| Đi Lại | GRAB *TRIP | 85.000 VNĐ |', // i18n-allow-vietnamese: fixture — Vietnamese table content
    '| Nhà Ở | TIEN NHA THANG 7 | 4.500.000 VNĐ |', // i18n-allow-vietnamese: fixture — Vietnamese table content
  ].join('\n');

  const t = tableOf(src);
  assert.ok(t, 'must be recognized as a table');
  assert.deepEqual(t.head, ['Nhóm', 'Danh Sách Nội Dung', 'Tổng Tiền']); // i18n-allow-vietnamese: fixture — expected Vietnamese table header
  assert.equal(t.rows.length, 3);
  assert.deepEqual(t.rows[2], ['Nhà Ở', 'TIEN NHA THANG 7', '4.500.000 VNĐ']); // i18n-allow-vietnamese: fixture — expected Vietnamese table row
  assert.equal(sketch(t.rows[1]![1]!), 'GRAB *TRIP');
});

test('NO separator row → NOT a table, kept as plain text', () => {
  const src = 'chọn giữa cà phê | trà sữa | nước ép nhé'; // i18n-allow-vietnamese: fixture — Vietnamese sentence
  const b = blocksOf(src);
  assert.equal(b.length, 1);
  assert.equal(b[0]!.kind, 'text');
  assert.equal((b[0] as { text: string }).text, src);
});

test('MISMATCHED COLUMN COUNT between header and separator row → discard the whole table, show as plain text', () => {
  const src = '| A | B | C |\n|---|---|\n| 1 | 2 | 3 |';
  assert.equal(tableOf(src), undefined);
  assert.equal(blocksOf(src)[0]!.kind, 'text');
});

test('a broken separator row (contains letters) → NOT a table', () => {
  assert.equal(tableOf('| A | B |\n|--- | xx |\n| 1 | 2 |'), undefined);
});

test('column alignment is read from the colon', () => {
  const t = tableOf('| A | B | C |\n|:---|:---:|---:|\n| 1 | 2 | 3 |');
  assert.deepEqual(t!.align, ['left', 'center', 'right']);
});

test('no leading/trailing `|` is still a valid table (GFM)', () => {
  const t = tableOf('A | B\n--- | ---\n1 | 2');
  assert.deepEqual(t!.head, ['A', 'B']);
  assert.deepEqual(t!.rows, [['1', '2']]);
});

test('`\\|` is CELL CONTENT, not a separator', () => {
  const t = tableOf('| Ký hiệu | Nghĩa |\n|---|---|\n| a \\| b | hoặc |'); // i18n-allow-vietnamese: fixture — Vietnamese table header/cell
  assert.deepEqual(t!.rows, [['a | b', 'hoặc']]); // i18n-allow-vietnamese: fixture — expected Vietnamese cell value
});

test('a BODY row with too few/too many cells is padded or truncated, NOT discarded', () => {
  const t = tableOf('| A | B | C |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |');
  assert.deepEqual(t!.rows, [
    ['1', '', ''],
    ['1', '2', '3'],
  ]);
});

test('a table STOPS at a blank line, the text after it becomes a separate block', () => {
  const b = blocksOf('| A |\n|---|\n| 1 |\n\nCâu sau bảng.'); // i18n-allow-vietnamese: fixture — Vietnamese text
  assert.equal(b.length, 2);
  assert.equal(b[0]!.kind, 'table');
  assert.equal((b[1] as { text: string }).text.trim(), 'Câu sau bảng.'); // i18n-allow-vietnamese: fixture — expected Vietnamese text
});

test('text BEFORE a table is not swallowed into the table', () => {
  const b = blocksOf('Bảng chi tiêu:\n| A |\n|---|\n| 1 |'); // i18n-allow-vietnamese: fixture — Vietnamese text
  assert.equal(b.length, 2);
  assert.equal((b[0] as { text: string }).text, 'Bảng chi tiêu:'); // i18n-allow-vietnamese: fixture — expected Vietnamese text
  assert.equal(b[1]!.kind, 'table');
});

test('a table INSIDE a code block is NOT built as a table', () => {
  const b = blocksOf('```\n| A |\n|---|\n| 1 |\n```');
  assert.equal(b.length, 1);
  assert.equal(b[0]!.kind, 'code');
});

test('`**` and `` ` `` inside a cell still work', () => {
  const t = tableOf('| Tên | Ghi chú |\n|---|---|\n| **quan trọng** | xem `a.md` |'); // i18n-allow-vietnamese: fixture — Vietnamese table header/cell
  assert.equal(sketch(t!.rows[0]![0]!), '*quan trọng*'); // i18n-allow-vietnamese: fixture — expected Vietnamese cell value
  assert.equal(sketch(t!.rows[0]![1]!), 'xem |`a.md`');
});

test('a `---` dash does NOT turn a sentence containing `|` into a one-column table', () => {
  const src = 'chọn cà phê | trà sữa\n---\nnói mình biết nhé'; // i18n-allow-vietnamese: fixture — Vietnamese sentence
  assert.equal(tableOf(src), undefined);
  assert.equal(blocksOf(src)[0]!.kind, 'text');
});

test('a valid SINGLE-COLUMN table still builds correctly', () => {
  const t = tableOf('| Việc cần làm |\n|---|\n| Gọi cho khách |'); // i18n-allow-vietnamese: fixture — Vietnamese table header/cell
  assert.deepEqual(t!.head, ['Việc cần làm']); // i18n-allow-vietnamese: fixture — expected Vietnamese header
  assert.deepEqual(t!.rows, [['Gọi cho khách']]); // i18n-allow-vietnamese: fixture — expected Vietnamese cell value
});

test('hasTable matches blocksOf EXACTLY — the two detection paths must not diverge', () => {
  const yes = '| A |\n|---|\n| 1 |';
  const no = 'a | b | c';
  assert.equal(hasTable(yes), true);
  assert.equal(hasTable(no), false);
  assert.equal(hasTable('```\n| A |\n|---|\n```'), false);
  assert.equal(hasTable('Đã xong.'), false); // i18n-allow-vietnamese: fixture — Vietnamese text
});

test('regression: /help and the plan step list still do NOT trip the table rule', () => {
  const help = '/stop   (hoặc /s)\n    Ngắt việc đang chạy'; // i18n-allow-vietnamese: fixture — Vietnamese CLI help text
  assert.equal(blocksOf(help)[0]!.kind, 'text');
  assert.equal((blocksOf(help)[0] as { text: string }).text, help);
});


test('tasks: groups consecutive lines into ONE block, reads status correctly', () => {
  const b = blocksOf('- [ ] chưa làm\n- [x] đã làm\n* [X] hoa thị, chữ X hoa'); // i18n-allow-vietnamese: fixture — Vietnamese task list
  assert.equal(b.length, 1);
  assert.equal(b[0].kind, 'tasks');
  assert.deepEqual(b[0].items, [
    { done: false, text: 'chưa làm' }, // i18n-allow-vietnamese: fixture — expected Vietnamese task text
    { done: true, text: 'đã làm' }, // i18n-allow-vietnamese: fixture — expected Vietnamese task text
    { done: true, text: 'hoa thị, chữ X hoa' }, // i18n-allow-vietnamese: fixture — expected Vietnamese task text
  ]);
});

test('tasks: a blank line SPLITS the list into two — same rule as tables', () => {
  const b = blocksOf('- [ ] a\n\n- [ ] b');
  assert.deepEqual(b.map((x) => x.kind), ['tasks', 'tasks']);
});

test('tasks: a PLAIN bullet dash is not swallowed into the task list', () => {
  const b = blocksOf('- [ ] việc\n- chỉ là gạch đầu dòng'); // i18n-allow-vietnamese: fixture — Vietnamese task list
  assert.equal(b[0].kind, 'tasks');
  assert.equal(b[0].items.length, 1, 'only ONE task');
  assert.equal(b[1].kind, 'text');
});

test('tasks: missing whitespace after `]` means it is NOT a task item', () => {
  assert.equal(blocksOf('- [x]abc')[0].kind, 'text');
});

test('tasks: an empty checkbox with no content is still a plain bullet', () => {
  assert.equal(blocksOf('- [ ]')[0].kind, 'text');
  assert.equal(blocksOf('- [ ]   ')[0].kind, 'text');
});

test('tasks: inside a code block it is NOT parsed as a task — fence wins', () => {
  const b = blocksOf('```md\n- [ ] đây là ví dụ\n```'); // i18n-allow-vietnamese: fixture — Vietnamese task list
  assert.equal(b.length, 1);
  assert.equal(b[0].kind, 'code');
});

test('tasks: preserves inline formatting inside task content', () => {
  const b = blocksOf('- [x] xem `file.md` và **sửa**'); // i18n-allow-vietnamese: fixture — Vietnamese task list
  assert.equal(b[0].items[0].text, 'xem `file.md` và **sửa**'); // i18n-allow-vietnamese: fixture — expected Vietnamese task text
});
