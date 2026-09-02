/**
 * Test cho lớp hàm THUẦN của tủ tài liệu.
 *
 * → docs/SPEC-library.md §15 · SESSIONS_MEMORY.md §4
 *
 * Đây là bộ test đầu tiên của dự án, và nó cố ý bắt đầu ở đúng chỗ §4 đã chỉ ra:
 * hàm thuần, chạy dưới một giây, 0 token, 0 lượt gọi LLM. Ba lỗi tốn tiền nhất
 * của ngày 16/08 đều nằm trong hàm thuần, đều biên dịch sạch, và đều chỉ lộ ra
 * khi chạy thật.
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

/**
 * Nhập từ `dist/`, KHÔNG từ `src/`.
 *
 * Type stripping của Node không viết lại `./zip.js` thành `./zip.ts`, nên mọi
 * import nội bộ giữa các file nguồn đều đứt khi chạy thẳng trên `src/`. Chạy
 * trên bản đã biên dịch còn đúng hơn về bản chất: ta test thứ THẬT SỰ CHẠY,
 * không phải một biến thể chỉ tồn tại trong bộ test.
 */
import { docPaths, formatBytes, pageOfLine, safeName, sniffType } from '../dist/library/names.js';
import { openZip } from '../dist/library/zip.js';
import { extractDocx, extractText, extractXlsx } from '../dist/library/extract.js';
import { migrateCharters } from '../dist/core/migrate.js';

// ────────────────────────────────────────────────────────────── safeName

test('safeName: nhận tên tiếng Việt có dấu, KHÔNG viết lại', () => {
  const r = safeName('Hợp đồng dịch vụ 2026.pdf');
  assert.equal(r.ok, true);
  if (r.ok) {
    // Người dùng phải nhận ra file của mình. Slugify là làm hỏng đúng việc này.
    assert.equal(r.name, 'Hợp đồng dịch vụ 2026.pdf');
    assert.equal(r.ext, 'pdf');
  }
});

test('safeName: chặn path traversal và dấu phân cách', () => {
  for (const bad of ['../bí mật.md', 'a/b.md', 'a\\b.md', '..', '.']) {
    assert.equal(safeName(bad).ok, false, bad);
  }
});

test('safeName: NHẬN dấu cách, dấu phẩy, `&` — tên tài liệu thật trông như vậy', () => {
  // Bug 02/09: `Mix, Mingle&Meet.pptx`. Cửa vào chưa bao giờ từ chối cái tên
  // này (đúng), nên nếu ca này đỏ thì ai đó vừa "dọn dẹp" nhầm chỗ — phần phải
  // chịu được dấu cách là BỘ GIẢI `@`, không phải cái tên. → test/refs.test.ts
  const r = safeName('Mix, Mingle&Meet.pptx');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.name, 'Mix, Mingle&Meet.pptx');
});

test('safeName: chặn `|` — nó là ký tự chia cột của INDEX.md', () => {
  // Windows vốn cấm `|`, nên chặn ở đây không lấy đi cái tên nào dùng được
  // trên cả ba hệ. Đổi lại bảng kê không thể vỡ hàng, và hàng vỡ ở đó nghĩa
  // là Trợ lý đọc ra một đường dẫn cụt.
  assert.equal(safeName('bao|cao.md').ok, false);
});

test('safeName: chặn tên bắt đầu bằng dấu chấm — Grep sẽ không thấy nó', () => {
  // Lý do thật, không phải thẩm mỹ: ripgrep bỏ qua thư mục/file ẩn khi duyệt.
  // Nhận file này = nó hiện trên giao diện, bóc text thành công, và không bao
  // giờ được tìm thấy. → SPEC-library.md §2.1
  const r = safeName('.env.txt');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /dấu chấm/);
});

test('safeName: chặn tên thiết bị Windows, KỂ CẢ khi có đuôi', () => {
  assert.equal(safeName('CON.txt').ok, false);
  assert.equal(safeName('com1.md').ok, false);
  assert.equal(safeName('lpt9.csv').ok, false);
  // Nhưng "console.md" thì hoàn toàn bình thường — so khớp phải là toàn phần.
  assert.equal(safeName('console.md').ok, true);
});

test('safeName: chặn tên kết thúc bằng dấu chấm hoặc khoảng trắng', () => {
  // Windows lặng lẽ cắt đi → tên trong catalog khác tên trên đĩa → mọi thao tác
  // xoá và thay thế sau đó trượt.
  assert.equal(safeName('bao cao.md ').ok, true, 'khoảng trắng đuôi được trim, vẫn hợp lệ');
  assert.equal(safeName('bao cao.md.').ok, false);
});

test('safeName: đếm độ dài bằng BYTE, không phải ký tự', () => {
  // 150 chữ tiếng Việt có dấu vượt 200 byte UTF-8 dù `.length` mới có 150.
  const long = `${'ề'.repeat(150)}.md`;
  assert.equal(safeName(long).ok, false);
  assert.equal(safeName(`${'a'.repeat(150)}.md`).ok, true);
});

test('safeName: đuôi bị chặn có câu giải thích riêng, không phải câu chung', () => {
  const img = safeName('anh.png');
  assert.equal(img.ok, false);
  if (!img.ok) assert.match(img.reason, /Ảnh/);

  const old = safeName('bao-cao.doc');
  assert.equal(old.ok, false);
  if (!old.ok) assert.match(old.reason, /docx/);
});

// ─────────────────────────────────────────────────── charter rời kho tri thức

test('migrateCharters: dời thân charter ra charter.md, bỏ frontmatter, sửa office.yaml', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-charter-'));
  const office = path.join(dir, 'offices', 'vp');
  fs.mkdirSync(path.join(office, 'knowledge', 'shared'), { recursive: true });
  fs.writeFileSync(
    path.join(office, 'knowledge', 'shared', '_charter.md'),
    '---\nid: k/shared/_charter\npinned: true\n---\n\nVăn phòng làm nội dung.\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(office, 'office.yaml'),
    'id: vp\nname: "VP"\ncharter_file: knowledge/shared/_charter.md\n',
    'utf8',
  );

  migrateCharters(path.join(dir, 'offices'));

  assert.equal(fs.readFileSync(path.join(office, 'charter.md'), 'utf8').trim(), 'Văn phòng làm nội dung.');
  // File cũ phải BIẾN MẤT — còn nó là kho tri thức vẫn quét ra node ma.
  assert.equal(fs.existsSync(path.join(office, 'knowledge', 'shared', '_charter.md')), false);
  assert.match(fs.readFileSync(path.join(office, 'office.yaml'), 'utf8'), /^charter_file: charter\.md$/m);

  // Idempotent: chạy lại không hỏng gì, không mất gì.
  migrateCharters(path.join(dir, 'offices'));
  assert.equal(fs.readFileSync(path.join(office, 'charter.md'), 'utf8').trim(), 'Văn phòng làm nội dung.');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrateCharters: KHÔNG đè bản charter.md người dùng đã viết', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-charter-'));
  const office = path.join(dir, 'offices', 'vp');
  fs.mkdirSync(path.join(office, 'knowledge', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(office, 'knowledge', 'shared', '_charter.md'), '---\nid: x\n---\n\nBẢN CŨ\n', 'utf8');
  fs.writeFileSync(path.join(office, 'charter.md'), 'BẢN MỚI\n', 'utf8');

  migrateCharters(path.join(dir, 'offices'));

  assert.equal(fs.readFileSync(path.join(office, 'charter.md'), 'utf8').trim(), 'BẢN MỚI');
  assert.equal(fs.existsSync(path.join(office, 'knowledge', 'shared', '_charter.md')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrateCharters: charter rỗng thì không đẻ ra file rỗng', () => {
  // Đây là ca PHỔ BIẾN NHẤT: mọi văn phòng tạo từ giao diện đều có charter thân
  // rỗng. Ghi ra một `charter.md` trống là thay một file rác bằng một file rác.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-charter-'));
  const office = path.join(dir, 'offices', 'vp');
  fs.mkdirSync(path.join(office, 'knowledge', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(office, 'knowledge', 'shared', '_charter.md'), '---\nid: x\npinned: true\n---\n', 'utf8');

  migrateCharters(path.join(dir, 'offices'));

  assert.equal(fs.existsSync(path.join(office, 'charter.md')), false);
  assert.equal(fs.existsSync(path.join(office, 'knowledge', 'shared', '_charter.md')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────────── sniffType

test('sniffType: PDF thật qua, .exe đổi tên bị chặn', () => {
  assert.equal(sniffType(Buffer.from('%PDF-1.7\n…'), 'pdf').ok, true);
  assert.equal(sniffType(Buffer.from('MZ\x90\x00'), 'pdf').ok, false);
});

test('sniffType: PDF có rác trước header vẫn qua', () => {
  // Chuẩn PDF cho phép, và nhiều file thật có thật.
  const buf = Buffer.concat([Buffer.alloc(300, 0x20), Buffer.from('%PDF-1.4')]);
  assert.equal(sniffType(buf, 'pdf').ok, true);
});

test('sniffType: docx phải là gói ZIP', () => {
  assert.equal(sniffType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]), 'docx').ok, true);
  assert.equal(sniffType(Buffer.from('không phải zip'), 'docx').ok, false);
});

test('sniffType: file nhị phân đội lốt .txt bị chặn bằng byte NUL', () => {
  assert.equal(sniffType(Buffer.from('chào bạn\nhai dòng'), 'txt').ok, true);
  assert.equal(sniffType(Buffer.from([0x41, 0x00, 0x42]), 'txt').ok, false);
});

// ────────────────────────────────────────────────────────────── pageOfLine

test('pageOfLine: nối "Grep ra dòng" với "Read đúng trang"', () => {
  const text = ['--- trang 1 ---', 'mở đầu', '--- trang 2 ---', 'điều 7 nói rằng', 'tiếp'].join('\n');
  assert.equal(pageOfLine(text, 2), 1);
  assert.equal(pageOfLine(text, 4), 2);
  assert.equal(pageOfLine(text, 5), 2);
  // File không có mốc trang (mọi định dạng không phải PDF) → không đoán bừa.
  assert.equal(pageOfLine('một dòng\nhai dòng', 2), undefined);
});

test('formatBytes: mốc chuyển đơn vị', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
});

// ────────────────────────────────────────────────────────────── zip

/** Dựng một file ZIP tối thiểu trong bộ nhớ — không cần file mẫu trên đĩa. */
function makeZip(entries: Array<{ name: string; body: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = Buffer.from(e.body, 'utf8');
    const deflated = zlib.deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8); // method = deflate
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + deflated.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([Buffer.concat(locals), centralBuf, eocd]);
}

test('openZip: liệt kê và giải nén đúng mục', () => {
  const zip = openZip(makeZip([
    { name: 'a.xml', body: '<a>xin chào</a>' },
    { name: 'b/c.xml', body: '<b>hai</b>' },
  ]));
  assert.deepEqual(zip.names, ['a.xml', 'b/c.xml']);
  assert.equal(zip.read('a.xml')?.toString('utf8'), '<a>xin chào</a>');
  assert.equal(zip.read('b/c.xml')?.toString('utf8'), '<b>hai</b>');
  assert.equal(zip.read('không-có.xml'), undefined);
});

// ────────────────────────────────────────────────────────────── extract

test('extractText: CSV nói "hàng đầu", KHÔNG nói "cột"', () => {
  // Ta quan sát được nội dung dòng một; ta không quan sát được rằng đó là dòng
  // tiêu đề. Gọi nó là "cột" là một câu nói dối khi file vào thẳng dữ liệu.
  const out = extractText(Buffer.from('ngay,noi_dung,so_tien\n2026-07-02,GRAB,85000\n'), 'csv');
  assert.match(out.shape, /hàng đầu: ngay, noi_dung, so_tien/);
  assert.doesNotMatch(out.shape, /cột/);
});

test('extractDocx: lấy chữ, bỏ thẻ, giải mã thực thể', () => {
  const doc = makeZip([
    {
      name: 'word/document.xml',
      body:
        '<w:document><w:body>' +
        '<w:p><w:r><w:t>Chương 1 &amp; mở đầu</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Điều 7. Bên B chịu phí.</w:t></w:r></w:p>' +
        '</w:body></w:document>',
    },
  ]);
  const out = extractDocx(doc);
  assert.match(out.text, /Chương 1 & mở đầu/);
  assert.match(out.text, /Điều 7\. Bên B chịu phí\./);
  assert.doesNotMatch(out.text, /<w:/);
  assert.equal(out.shape, 'docx, 2 đoạn');
});

test('extractXlsx: nối tên sheet với file sheet qua r:id, không đoán theo thứ tự', () => {
  // Cái bẫy: sheet ĐẦU TIÊN của workbook trỏ tới sheet2.xml. Nếu code ghép theo
  // thứ tự tên file thì mọi tên sheet trong INDEX.md sai hết — im lặng.
  const book = makeZip([
    {
      name: 'xl/workbook.xml',
      body:
        '<workbook><sheets>' +
        '<sheet name="Tháng 7" sheetId="1" r:id="rId9"/>' +
        '<sheet name="Tổng" sheetId="2" r:id="rId1"/>' +
        '</sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      body:
        '<Relationships>' +
        '<Relationship Id="rId9" Target="worksheets/sheet2.xml"/>' +
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    },
    { name: 'xl/sharedStrings.xml', body: '<sst><si><t>doanh thu</t></si></sst>' },
    {
      name: 'xl/worksheets/sheet2.xml',
      body: '<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>1500</v></c></row></sheetData></worksheet>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      body: '<worksheet><sheetData><row><c><v>99</v></c></row></sheetData></worksheet>',
    },
  ]);

  const out = extractXlsx(book);
  assert.match(out.shape, /^2 sheet: Tháng 7, Tổng/);
  // "Tháng 7" phải chứa dữ liệu của sheet2.xml, không phải sheet1.xml.
  const thang7 = out.text.split('## Sheet: ')[1] ?? '';
  assert.match(thang7, /doanh thu \| 1500/);
});

test('extractXlsx: <si> nhiều <t> phải nối lại thành MỘT chuỗi', () => {
  // Ô có chữ in đậm giữa câu bị Excel tách thành nhiều run. Không nối lại thì
  // "Doanh thu Q3" thành hai chuỗi rời và mọi chỉ số shared string sau đó lệch.
  const book = makeZip([
    { name: 'xl/sharedStrings.xml', body: '<sst><si><t>Doanh thu </t><t>Q3</t></si><si><t>sau</t></si></sst>' },
    {
      name: 'xl/worksheets/sheet1.xml',
      body: '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row></sheetData></worksheet>',
    },
  ]);
  assert.match(extractXlsx(book).text, /Doanh thu Q3 \| sau/);
});

test('extractXlsx: ô trống BỊ BỎ KHỎI FILE vẫn không được làm lệch cột', () => {
  // Ca thật và nguy hiểm nhất: Excel không ghi ô trống ra XML chút nào. A=1,
  // B trống, C=3 chỉ có hai thẻ. Đọc theo thứ tự duyệt thì ra "1 | 3" và mọi
  // cột sau đó dịch trái — nhân viên kế toán vẫn cộng ra một con số trông hợp
  // lý, và sai. Vị trí phải lấy từ thuộc tính r.
  const book = makeZip([
    {
      name: 'xl/worksheets/sheet1.xml',
      body:
        '<worksheet><sheetData><row r="1">' +
        '<c r="A1"><v>1</v></c><c r="C1"><v>3</v></c>' +
        '</row></sheetData></worksheet>',
    },
  ]);
  assert.match(extractXlsx(book).text, /^1 \|  \| 3$/m);
});

test('extractXlsx: ô tự đóng <c/> và ô rỗng ở CUỐI hàng', () => {
  const book = makeZip([
    {
      name: 'xl/worksheets/sheet1.xml',
      body:
        '<worksheet><sheetData><row>' +
        '<c r="A1"><v>1</v></c><c r="B1"/><c r="C1"><v>3</v></c><c r="D1"/>' +
        '</row></sheetData></worksheet>',
    },
  ]);
  // Giữ ô giữa thì cột không lệch; bỏ ô cuối thì bảng không đầy dấu | thừa.
  assert.match(extractXlsx(book).text, /^1 \|  \| 3$/m);
});

test('extractXlsx: cột quá chữ Z (AA, AB) tính đúng vị trí', () => {
  const book = makeZip([
    {
      name: 'xl/worksheets/sheet1.xml',
      body: '<worksheet><sheetData><row><c r="AA1"><v>27</v></c></row></sheetData></worksheet>',
    },
  ]);
  // AA là cột thứ 27 → 26 ô rỗng đứng trước.
  const row = extractXlsx(book).text.split('\n').find((l) => l.includes('27')) ?? '';
  assert.equal(row.split('|').length, 27);
});

// ───────────────────────────────── docPaths: đường nhân viên MỞ ĐƯỢC (§4.4)
//
// Ca hỏng 20/08 (`P-260820-2219-5ltb`): bảng kê nêu `library/files/hd1.docx`,
// Trợ lý chép đúng chuỗi đó vào `inputs`, và `Read` không mở được file nén.
// Cả ca ba bước chết ở bước một, $0.25 — trong khi bản `.txt` nằm ngay cạnh.

test('docPaths: docx/xlsx/pptx chỉ nêu bản ĐÃ BÓC, không bao giờ nêu bản gốc', () => {
  for (const ext of ['docx', 'xlsx', 'pptx']) {
    const p = docPaths(`hd1.${ext}`, ext, 'ready');
    assert.equal(p.open, `library/text/hd1.${ext}.txt`);
    assert.equal(p.original, undefined, 'bản gốc nén KHÔNG mở được — nêu ra là bẫy');
  }
});

test('docPaths: text-native thì bản gốc CHÍNH LÀ văn bản', () => {
  for (const ext of ['md', 'txt', 'csv', 'json', 'yaml']) {
    assert.equal(docPaths(`a.${ext}`, ext, 'ready').open, `library/files/a.${ext}`);
  }
});

test('docPaths: pdf nêu CẢ HAI — text để tìm, bản gốc để đọc đúng trang', () => {
  const p = docPaths('hd2.pdf', 'pdf', 'ready');
  assert.equal(p.open, 'library/text/hd2.pdf.txt');
  assert.equal(p.original, 'library/files/hd2.pdf');
});

test('docPaths: pdf CHƯA bóc vẫn dùng được — model nhìn trang như ảnh', () => {
  for (const state of ['image-only', 'unindexed']) {
    const p = docPaths('hd2.pdf', 'pdf', state);
    assert.equal(p.open, 'library/files/hd2.pdf', `state ${state}`);
    assert.equal(p.original, undefined, 'không nêu hai lần cùng một file');
  }
});

test('docPaths: KHÔNG mở được thì không trả đường dẫn nào', () => {
  // Nêu một đường dẫn chết còn tệ hơn không nêu gì: Trợ lý sẽ giao một task
  // chắc chắn hỏng, và hoá đơn vẫn tính đủ.
  assert.deepEqual(docPaths('hd1.docx', 'docx', 'failed'), {});
  assert.deepEqual(docPaths('hd1.docx', 'docx', 'unindexed'), {});
  assert.deepEqual(docPaths('la.zip', 'zip', 'ready'), {});
});
