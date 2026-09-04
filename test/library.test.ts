

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { docPaths, formatBytes, pageOfLine, safeName, sniffType } from '../dist/library/names.js';
import { openZip } from '../dist/library/zip.js';
import { extractDocx, extractText, extractXlsx, shapeEn, shapeSay } from '../dist/library/extract.js';
import { migrateCharters } from '../dist/core/migrate.js';


test('safeName: accepts a Vietnamese name with diacritics, does NOT rewrite it', () => {
  const r = safeName('Hợp đồng dịch vụ 2026.pdf'); // i18n-allow-vietnamese: fixture exercising diacritic handling
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.name, 'Hợp đồng dịch vụ 2026.pdf'); // i18n-allow-vietnamese: expected value mirrors the input fixture
    assert.equal(r.ext, 'pdf');
  }
});

test('safeName: blocks path traversal and separator characters', () => {
  for (const bad of ['../bí mật.md', 'a/b.md', 'a\\b.md', '..', '.']) { // i18n-allow-vietnamese: fixture filename fed to safeName
    assert.equal(safeName(bad).ok, false, bad);
  }
});

test('safeName: ACCEPTS spaces, commas, `&` — real document names look like this', () => {
  const r = safeName('Mix, Mingle&Meet.pptx');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.name, 'Mix, Mingle&Meet.pptx');
});

test('safeName: blocks `|` — it is the column separator character in INDEX.md', () => {
  assert.equal(safeName('bao|cao.md').ok, false);
});

test('safeName: blocks names starting with a dot — Grep will not find it', () => {
  const r = safeName('.env.txt');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /dấu chấm/); // i18n-allow-vietnamese: asserts on the vi-locale message the code under test currently returns
});

test('safeName: blocks Windows device names, EVEN with an extension', () => {
  assert.equal(safeName('CON.txt').ok, false);
  assert.equal(safeName('com1.md').ok, false);
  assert.equal(safeName('lpt9.csv').ok, false);
  assert.equal(safeName('console.md').ok, true);
});

test('safeName: blocks names ending in a dot or whitespace', () => {
  assert.equal(safeName('bao cao.md ').ok, true, 'trailing whitespace gets trimmed, still valid');
  assert.equal(safeName('bao cao.md.').ok, false);
});

test('safeName: counts length in BYTES, not characters', () => {
  const long = `${'ề'.repeat(150)}.md`; // i18n-allow-vietnamese: multi-byte diacritic char is the point of the byte-length fixture
  assert.equal(safeName(long).ok, false);
  assert.equal(safeName(`${'a'.repeat(150)}.md`).ok, true);
});

test('safeName: a blocked extension gets its own explanation, not a generic one', () => {
  const img = safeName('anh.png');
  assert.equal(img.ok, false);
  if (!img.ok) assert.match(img.reason, /Ảnh/); // i18n-allow-vietnamese: asserts on the vi-locale message the code under test currently returns

  const old = safeName('bao-cao.doc');
  assert.equal(old.ok, false);
  if (!old.ok) assert.match(old.reason, /docx/);
});


test('migrateCharters: moves charter body into charter.md, strips frontmatter, updates office.yaml', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-charter-'));
  const office = path.join(dir, 'offices', 'vp');
  fs.mkdirSync(path.join(office, 'knowledge', 'shared'), { recursive: true });
  fs.writeFileSync(
    path.join(office, 'knowledge', 'shared', '_charter.md'),
    '---\nid: k/shared/_charter\npinned: true\n---\n\nVăn phòng làm nội dung.\n', // i18n-allow-vietnamese: charter body fixture
    'utf8',
  );
  fs.writeFileSync(
    path.join(office, 'office.yaml'),
    'id: vp\nname: "VP"\ncharter_file: knowledge/shared/_charter.md\n',
    'utf8',
  );

  migrateCharters(path.join(dir, 'offices'));

  assert.equal(fs.readFileSync(path.join(office, 'charter.md'), 'utf8').trim(), 'Văn phòng làm nội dung.'); // i18n-allow-vietnamese: expected value mirrors the fixture
  assert.equal(fs.existsSync(path.join(office, 'knowledge', 'shared', '_charter.md')), false);
  assert.match(fs.readFileSync(path.join(office, 'office.yaml'), 'utf8'), /^charter_file: charter\.md$/m);

  migrateCharters(path.join(dir, 'offices'));
  assert.equal(fs.readFileSync(path.join(office, 'charter.md'), 'utf8').trim(), 'Văn phòng làm nội dung.'); // i18n-allow-vietnamese: expected value mirrors the fixture

  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrateCharters: does NOT overwrite a charter.md the user already wrote', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-charter-'));
  const office = path.join(dir, 'offices', 'vp');
  fs.mkdirSync(path.join(office, 'knowledge', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(office, 'knowledge', 'shared', '_charter.md'), '---\nid: x\n---\n\nBẢN CŨ\n', 'utf8'); // i18n-allow-vietnamese: charter body fixture
  fs.writeFileSync(path.join(office, 'charter.md'), 'BẢN MỚI\n', 'utf8'); // i18n-allow-vietnamese: charter body fixture

  migrateCharters(path.join(dir, 'offices'));

  assert.equal(fs.readFileSync(path.join(office, 'charter.md'), 'utf8').trim(), 'BẢN MỚI'); // i18n-allow-vietnamese: expected value mirrors the fixture
  assert.equal(fs.existsSync(path.join(office, 'knowledge', 'shared', '_charter.md')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrateCharters: an empty charter does not spawn an empty file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-charter-'));
  const office = path.join(dir, 'offices', 'vp');
  fs.mkdirSync(path.join(office, 'knowledge', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(office, 'knowledge', 'shared', '_charter.md'), '---\nid: x\npinned: true\n---\n', 'utf8');

  migrateCharters(path.join(dir, 'offices'));

  assert.equal(fs.existsSync(path.join(office, 'charter.md')), false);
  assert.equal(fs.existsSync(path.join(office, 'knowledge', 'shared', '_charter.md')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});


test('sniffType: a genuine PDF passes, a renamed .exe is blocked', () => {
  assert.equal(sniffType(Buffer.from('%PDF-1.7\n…'), 'pdf').ok, true);
  assert.equal(sniffType(Buffer.from('MZ\x90\x00'), 'pdf').ok, false);
});

test('sniffType: a PDF with junk before the header still passes', () => {
  const buf = Buffer.concat([Buffer.alloc(300, 0x20), Buffer.from('%PDF-1.4')]);
  assert.equal(sniffType(buf, 'pdf').ok, true);
});

test('sniffType: a docx must be a ZIP package', () => {
  assert.equal(sniffType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]), 'docx').ok, true);
  assert.equal(sniffType(Buffer.from('not a zip'), 'docx').ok, false);
});

test('sniffType: a binary file masquerading as .txt is blocked by a NUL byte', () => {
  assert.equal(sniffType(Buffer.from('hello there\ntwo lines'), 'txt').ok, true);
  assert.equal(sniffType(Buffer.from([0x41, 0x00, 0x42]), 'txt').ok, false);
});


test('pageOfLine: connects "Grep finds a line" with "Read the right page"', () => {
  const text = ['--- page 1 ---', 'the start', '--- page 2 ---', 'article 7 says that', 'continued'].join('\n');
  assert.equal(pageOfLine(text, 2), 1);
  assert.equal(pageOfLine(text, 4), 2);
  assert.equal(pageOfLine(text, 5), 2);
  assert.equal(pageOfLine('one line\ntwo lines', 2), undefined);
});

test('formatBytes: unit-conversion thresholds', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
});


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
    local.writeUInt16LE(8, 8);
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

test('openZip: lists and extracts entries correctly', () => {
  const zip = openZip(makeZip([
    { name: 'a.xml', body: '<a>hello</a>' },
    { name: 'b/c.xml', body: '<b>two</b>' },
  ]));
  assert.deepEqual(zip.names, ['a.xml', 'b/c.xml']);
  assert.equal(zip.read('a.xml')?.toString('utf8'), '<a>hello</a>');
  assert.equal(zip.read('b/c.xml')?.toString('utf8'), '<b>two</b>');
  assert.equal(zip.read('does-not-exist.xml'), undefined);
});


test('extractText: CSV says "first row", NOT "column"', () => {
  const out = extractText(Buffer.from('ngay,noi_dung,so_tien\n2026-07-02,GRAB,85000\n'), 'csv');
  assert.deepEqual(out.shape, { kind: 'csv', rows: 2, firstRow: ['ngay', 'noi_dung', 'so_tien'] });
  assert.match(shapeEn(out.shape, 'csv'), /first row: ngay, noi_dung, so_tien/);
  assert.doesNotMatch(shapeEn(out.shape, 'csv'), /column/i);
  assert.match(shapeSay(out.shape, 'csv'), /hàng đầu: ngay, noi_dung, so_tien/); // i18n-allow-vietnamese: the vi catalogue is what this asserts on
  assert.doesNotMatch(shapeSay(out.shape, 'csv'), /cột/); // i18n-allow-vietnamese: the word that must NOT appear
});

test('extractDocx: extracts text, strips tags, decodes entities', () => {
  const doc = makeZip([
    {
      name: 'word/document.xml',
      body:
        '<w:document><w:body>' +
        '<w:p><w:r><w:t>Chương 1 &amp; mở đầu</w:t></w:r></w:p>' + // i18n-allow-vietnamese: real Vietnamese docx content is the point of this fixture
        '<w:p><w:r><w:t>Điều 7. Bên B chịu phí.</w:t></w:r></w:p>' + // i18n-allow-vietnamese: real Vietnamese docx content is the point of this fixture
        '</w:body></w:document>',
    },
  ]);
  const out = extractDocx(doc);
  assert.match(out.text, /Chương 1 & mở đầu/); // i18n-allow-vietnamese: expected value mirrors the fixture
  assert.match(out.text, /Điều 7\. Bên B chịu phí\./); // i18n-allow-vietnamese: expected value mirrors the fixture
  assert.doesNotMatch(out.text, /<w:/);
  assert.deepEqual(out.shape, { kind: 'docx', headings: 0, paras: 2 });
  assert.equal(shapeEn(out.shape, 'docx'), 'docx, 2 paragraphs');
});

test('extractXlsx: matches sheet name to sheet file via r:id, does not guess by order', () => {
  const book = makeZip([
    {
      name: 'xl/workbook.xml',
      body:
        '<workbook><sheets>' +
        '<sheet name="Tháng 7" sheetId="1" r:id="rId9"/>' + // i18n-allow-vietnamese: sheet name is the fixture's data
        '<sheet name="Tổng" sheetId="2" r:id="rId1"/>' + // i18n-allow-vietnamese: sheet name is the fixture's data
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
  assert.deepEqual(out.shape, {
    kind: 'xlsx',
    sheets: ['Tháng 7', 'Tổng'], // i18n-allow-vietnamese: sheet names are the fixture's data
    firstRow: ['doanh thu', '1500'],
  });
  assert.match(shapeEn(out.shape, 'xlsx'), /^2 sheets: Tháng 7, Tổng/); // i18n-allow-vietnamese: same fixture names, echoed back
  const thang7 = out.text.split('## Sheet: ')[1] ?? '';
  assert.match(thang7, /doanh thu \| 1500/);
});

test('extractXlsx: <si> with multiple <t> must be joined into ONE string', () => {
  const book = makeZip([
    { name: 'xl/sharedStrings.xml', body: '<sst><si><t>Doanh thu </t><t>Q3</t></si><si><t>sau</t></si></sst>' },
    {
      name: 'xl/worksheets/sheet1.xml',
      body: '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row></sheetData></worksheet>',
    },
  ]);
  assert.match(extractXlsx(book).text, /Doanh thu Q3 \| sau/);
});

test('extractXlsx: a cell OMITTED FROM THE FILE must still not shift columns', () => {
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

test('extractXlsx: self-closing <c/> and empty cells at the END of a row', () => {
  const book = makeZip([
    {
      name: 'xl/worksheets/sheet1.xml',
      body:
        '<worksheet><sheetData><row>' +
        '<c r="A1"><v>1</v></c><c r="B1"/><c r="C1"><v>3</v></c><c r="D1"/>' +
        '</row></sheetData></worksheet>',
    },
  ]);
  assert.match(extractXlsx(book).text, /^1 \|  \| 3$/m);
});

test('extractXlsx: columns past Z (AA, AB) compute the correct position', () => {
  const book = makeZip([
    {
      name: 'xl/worksheets/sheet1.xml',
      body: '<worksheet><sheetData><row><c r="AA1"><v>27</v></c></row></sheetData></worksheet>',
    },
  ]);
  const row = extractXlsx(book).text.split('\n').find((l) => l.includes('27')) ?? '';
  assert.equal(row.split('|').length, 27);
});


test('docPaths: docx/xlsx/pptx only names the EXTRACTED version, never the original', () => {
  for (const ext of ['docx', 'xlsx', 'pptx']) {
    const p = docPaths(`hd1.${ext}`, ext, 'ready');
    assert.equal(p.open, `library/text/hd1.${ext}.txt`);
    assert.equal(p.original, undefined, 'the compressed original CANNOT be opened — naming it would be a trap');
  }
});

test('docPaths: for text-native files, the original IS THE text itself', () => {
  for (const ext of ['md', 'txt', 'csv', 'json', 'yaml']) {
    assert.equal(docPaths(`a.${ext}`, ext, 'ready').open, `library/files/a.${ext}`);
  }
});

test('docPaths: pdf names BOTH — text for searching, original for reading the correct page', () => {
  const p = docPaths('hd2.pdf', 'pdf', 'ready');
  assert.equal(p.open, 'library/text/hd2.pdf.txt');
  assert.equal(p.original, 'library/files/hd2.pdf');
});

test('docPaths: an UNEXTRACTED pdf is still usable — the model views the page as an image', () => {
  for (const state of ['image-only', 'unindexed']) {
    const p = docPaths('hd2.pdf', 'pdf', state);
    assert.equal(p.open, 'library/files/hd2.pdf', `state ${state}`);
    assert.equal(p.original, undefined, 'must not name the same file twice');
  }
});

test("docPaths: when it CAN'T be opened, no path is returned at all", () => {
  assert.deepEqual(docPaths('hd1.docx', 'docx', 'failed'), {});
  assert.deepEqual(docPaths('hd1.docx', 'docx', 'unindexed'), {});
  assert.deepEqual(docPaths('la.zip', 'zip', 'ready'), {});
});
