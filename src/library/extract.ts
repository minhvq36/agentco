/**
 * Bóc văn bản khỏi tài liệu — MỘT LẦN, LÚC NẠP VÀO.
 *
 * → docs/SPEC-library.md §3, §4
 *
 * Bóc lúc nạp thì trả giá đúng một lần và trả bằng CPU. Bóc lúc đọc thì mỗi task
 * trả lại từ đầu và trả bằng token. Đó là toàn bộ lý do file này tồn tại.
 *
 * Không hàm nào ở đây gọi LLM. Mọi thứ trả về đều là thứ QUAN SÁT ĐƯỢC từ chính
 * file — số trang, tên sheet, tên cột, chữ đầu tiên. → SESSIONS_MEMORY §2
 */

import { createRequire } from 'node:module';
import path from 'node:path';

import { openZip } from './zip.js';

export interface Extracted {
  text: string;
  /** Mô tả cấu trúc cho INDEX.md: "34 trang", "3 sheet", "22 slide". */
  shape: string;
  /** Số trang, chỉ PDF. Dùng để phát hiện bản chụp (§3.2). */
  pages?: number;
  /** Vài chục chữ đầu, để người dùng nhận ra tài liệu mà không phải mở nó. */
  preview: string;
}

/**
 * `pdfjs-dist` không nạp được. Từ 20/08 đây là một CÀI ĐẶT HỎNG, không còn là
 * "người dùng chưa cài thêm" — nên nó vẫn có kiểu riêng, nhưng câu nói cho
 * người dùng đã đổi hẳn. Xem `extractPdf`.
 */
export class PdfToolMissing extends Error {
  constructor() {
    super('Không nạp được thư viện đọc PDF');
    this.name = 'PdfToolMissing';
  }
}

// ─────────────────────────────────────────────────────────────── text sẵn

export function extractText(buf: Buffer, ext: string): Extracted {
  const text = buf.toString('utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  let shape = `${lines.length} dòng`;
  if (ext === 'csv') {
    /**
     * Gọi là "hàng đầu", KHÔNG gọi là "cột".
     *
     * Ta quan sát được nội dung dòng thứ nhất; ta KHÔNG quan sát được rằng đó
     * là dòng tiêu đề. File xuất từ hệ thống khác hoàn toàn có thể vào thẳng dữ
     * liệu, và lúc đó nhãn "cột: 2026-07-02, GRAB, 85000" là một câu nói dối —
     * đúng loại nói dối mà bảng token đã dạy ta rằng nó phá luôn niềm tin vào
     * cả những dòng nói thật.
     */
    const first = (lines[0] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    shape = `csv, ${lines.length - 1} dòng · hàng đầu: ${first.slice(0, 8).join(', ')}`;
  }
  return { text, shape, preview: previewOf(text) };
}

// ─────────────────────────────────────────────────────────────── docx

export function extractDocx(buf: Buffer): Extracted {
  const zip = openZip(buf);
  const xml = zip.read('word/document.xml');
  if (!xml) throw new Error('File .docx thiếu phần nội dung — có thể đã hỏng.');
  const s = xml.toString('utf8');

  /**
   * ⚠ Ô bảng bị tách thành nhiều DÒNG chứ không giữ nguyên hàng ngang.
   *
   * Bên trong một ô là `<w:tc><w:p>…</w:p></w:tc>`, nên không có cách rẻ nào
   * để `</w:p>` xuống dòng ở đoạn văn mà không xuống dòng trong ô. Chọn xuống
   * dòng: mỗi ô thành một dòng greppable. Bảng đọc bằng mắt thì xấu, nhưng file
   * này sinh ra để `Grep`, không để đọc.
   */
  const text = stripTags(
    s
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\s*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tr>/g, '\n'),
  );

  const headings = (s.match(/w:val="Heading/g) ?? []).length;
  const paras = (s.match(/<\/w:p>/g) ?? []).length;
  return {
    text,
    shape: headings > 0 ? `docx, ${headings} mục` : `docx, ${paras} đoạn`,
    preview: previewOf(text),
  };
}

// ─────────────────────────────────────────────────────────────── xlsx

export function extractXlsx(buf: Buffer): Extracted {
  const zip = openZip(buf);

  const shared: string[] = [];
  const ss = zip.read('xl/sharedStrings.xml');
  if (ss) {
    // Một <si> có thể chứa NHIỀU <t> (khi ô có nhiều đoạn định dạng khác nhau).
    // Nối chúng lại, nếu không thì "Doanh thu **Q3**" thành hai chuỗi rời.
    for (const m of ss.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const parts = [...(m[1] ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1] ?? ''));
      shared.push(parts.join(''));
    }
  }

  /**
   * Nối tên sheet với FILE sheet qua r:id, không đoán theo thứ tự `sheet1.xml`,
   * `sheet2.xml`. Thứ tự file trong gói không bắt buộc trùng thứ tự sheet trong
   * workbook — và nếu lệch thì mọi tên sheet trong INDEX.md sai hết, im lặng.
   */
  const rels = new Map<string, string>();
  const relXml = zip.read('xl/_rels/workbook.xml.rels');
  if (relXml) {
    for (const m of relXml.toString('utf8').matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(m[0])?.[1];
      const target = /Target="([^"]+)"/.exec(m[0])?.[1];
      if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, ''));
    }
  }

  const sheets: Array<{ name: string; path: string }> = [];
  const wb = zip.read('xl/workbook.xml');
  if (wb) {
    for (const m of wb.toString('utf8').matchAll(/<sheet\b[^>]*>/g)) {
      const name = decodeXml(/name="([^"]*)"/.exec(m[0])?.[1] ?? '');
      const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? '';
      const target = rels.get(rid);
      if (name && target) sheets.push({ name, path: `xl/${target}` });
    }
  }
  if (sheets.length === 0) {
    // Không đọc được workbook.xml thì vẫn còn đường: lấy thẳng các file sheet.
    for (const n of zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()) {
      sheets.push({ name: n.replace(/^.*\//, '').replace(/\.xml$/, ''), path: n });
    }
  }

  const blocks: string[] = [];
  // Hàng đầu của sheet ĐẦU TIÊN. Gọi đúng tên nó là "hàng đầu", không gọi là
  // "cột": ta thấy nội dung dòng một, ta không thấy rằng nó là dòng tiêu đề.
  const firstRow: string[] = [];
  for (const sheet of sheets) {
    const raw = zip.read(sheet.path);
    if (!raw) continue;
    const rows = readSheetRows(raw.toString('utf8'), shared);
    if (firstRow.length === 0 && rows[0]) firstRow.push(...rows[0].filter(Boolean).slice(0, 8));
    blocks.push(`## Sheet: ${sheet.name}\n${rows.map((r) => r.join(' | ')).join('\n')}`);
  }

  const text = blocks.join('\n\n');
  const names = sheets.map((s) => s.name).join(', ');
  const shape =
    firstRow.length > 0
      ? `${sheets.length} sheet: ${names} · hàng đầu: ${firstRow.join(', ')}`
      : `${sheets.length} sheet: ${names}`;
  return { text, shape, preview: previewOf(text) };
}

/**
 * Đọc các hàng của một sheet.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ô RỖNG KHÔNG NẰM TRONG FILE — VÀ ĐÓ LÀ CHỖ LÀM LỆCH CỘT.                 │
 * │                                                                          │
 * │ Excel bỏ hẳn ô trống khỏi XML. Một hàng có A=1, B trống, C=3 được ghi là │
 * │ hai thẻ `<c r="A1">` và `<c r="C1">`, không có gì ở giữa. Đọc tuần tự    │
 * │ theo thứ tự xuất hiện thì ra `1 | 3` — mọi cột sau ô trống DỊCH SANG     │
 * │ TRÁI một bậc, im lặng.                                                   │
 * │                                                                          │
 * │ Hậu quả không phải là một bảng xấu: bài 3 và bài 7 của TEST-WALKTHROUGH  │
 * │ giao cho nhân viên đúng việc "cộng tổng theo cột". Cột lệch thì con số   │
 * │ vẫn ra, vẫn trông hợp lý, và sai.                                        │
 * │                                                                          │
 * │ Nên vị trí phải lấy từ thuộc tính `r` ("C1" → cột thứ 3), không lấy từ   │
 * │ thứ tự duyệt. Bộ test bắt được đúng chỗ này.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function readSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    // Bắt CẢ hai dạng: `<c .../>` tự đóng và `<c ...>…</c>`. Chỉ bắt dạng thứ
    // hai là bỏ rơi mọi ô có định dạng nhưng không có giá trị.
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const inner = cellMatch[2] ?? '';

      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (ref) {
        const col = columnIndex(ref);
        while (cells.length < col) cells.push('');
      }

      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      if (type === 's') {
        const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '-1');
        cells.push(shared[idx] ?? '');
      } else if (type === 'inlineStr') {
        cells.push(decodeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? ''));
      } else {
        cells.push(decodeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''));
      }
    }
    // Ô rỗng ở CUỐI hàng thì bỏ — chúng không mang thông tin và chỉ đẻ ra một
    // hàng dấu | thừa. Ô rỗng ở GIỮA thì phải giữ, xem khối trên.
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/** "A" → 0 · "B" → 1 · "AA" → 26. Cột trong Excel đánh theo cơ số 26 không có số 0. */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ─────────────────────────────────────────────────────────────── pptx

export function extractPptx(buf: Buffer): Extracted {
  const zip = openZip(buf);
  const slides = zip.names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNo(a) - slideNo(b));

  const blocks: string[] = [];
  for (const name of slides) {
    const raw = zip.read(name);
    if (!raw) continue;
    const runs = [...raw.toString('utf8').matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1] ?? ''));
    blocks.push(`## Slide ${slideNo(name)}\n${runs.join('\n')}`);
  }
  const text = blocks.join('\n\n');
  return { text, shape: `${slides.length} slide`, preview: previewOf(text) };
}

function slideNo(name: string): number {
  return Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? '0');
}

/**
 * Thư mục tài nguyên của pdf.js, đúng hình dạng nó đòi.
 *
 * ⚠ ĐƯỜNG DẪN ĐĨA TRẦN, KHÔNG PHẢI `file://`. Tên tham số là `...Url` nên phản
 * xạ đầu tiên là dựng một URL — và nó hỏng IM LẶNG: dưới Node, pdf.js gọi thẳng
 * `fs.readFile(url)` với chuỗi ta đưa, mà `fs` không hiểu chuỗi `file:///D:/…`.
 * Nó chỉ kêu một dòng `Warning:` rồi chạy tiếp và trả về chữ thiếu bảng mã.
 *
 * Gạch chéo XUÔI kể cả trên Windows: pdf.js nối chuỗi `url + tên-file` chứ
 * không `path.join`, và chính nó bắt buộc phải có gạch ở cuối.
 */
function assetDir(home: string, name: string): string {
  return `${home.replace(/\\/g, '/')}/${name}/`;
}

// ─────────────────────────────────────────────────────────────── pdf

/**
 * Bóc PDF — định dạng DUY NHẤT cần một thư viện ngoài.
 *
 * Content stream nén + bảng mã CID font là thứ không tự viết được trong vài trăm
 * dòng, khác hẳn ZIP+XML của Office. Nên `pdfjs-dist` là một phụ thuộc THẬT.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TRƯỚC 20/08 NÓ LÀ PHỤ THUỘC TUỲ CHỌN, VÀ ĐÓ LÀ MỘT QUYẾT ĐỊNH SAI.       │
 * │                                                                          │
 * │ Người dùng thả một hợp đồng PDF vào và nhận:                              │
 * │   *"Chưa cài công cụ đọc PDF … Cài: npm i pdfjs-dist"*                    │
 * │                                                                          │
 * │ Họ hỏi đúng câu phải hỏi: *"sau này ra product cũng thế, bắt người dùng   │
 * │ handle sao?"* Một người mở tiệm hoa không có `npm`. Với họ đó không phải  │
 * │ một gợi ý — đó là một cánh cửa đóng, và tính năng coi như không tồn tại.  │
 * │                                                                          │
 * │ Luật *"0 phụ thuộc mới"* của tủ tài liệu (17/08) vẫn đúng ở chỗ nó sinh   │
 * │ ra: docx/xlsx/pptx là ZIP+XML, tự bóc được trong hai trăm dòng. PDF thì   │
 * │ không, và một tính năng chỉ chạy trên máy có toolchain thì nó chưa được   │
 * │ xây xong. 36MB trên đĩa là cái giá, và nó nằm cạnh 304MB của SDK.         │
 * │                                                                          │
 * │ Nạp ĐỘNG thì vẫn giữ, nhưng vì lý do khác hẳn: 36MB đó chỉ vào bộ nhớ     │
 * │ khi có người thả PDF vào, không phải mỗi lần khởi động daemon.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `PdfToolMissing` vẫn còn, nay mang nghĩa **cài đặt hỏng** (`npm install`
 * chạy dở, hoặc ai đó cài với `--omit=optional`). Vẫn là kiểu riêng vì việc
 * phải làm khác hẳn "file này hỏng": một bên sửa cài đặt, một bên đổi file.
 */
export async function extractPdf(buf: Buffer): Promise<Extracted> {
  let pdfjs: any;
  let home: string;
  try {
    /**
     * Đường dẫn để trong BIẾN: bản `legacy` không kèm khai báo kiểu, và một
     * `import()` với chuỗi hằng làm TypeScript đòi kiểu lúc biên dịch.
     *
     * Dùng bản `legacy` chứ không phải `build/pdf.mjs`: bản thường giả định các
     * API rất mới của trình duyệt/Node, còn bản legacy đã hạ cú pháp xuống —
     * đây là bản chạy được trên dải Node rộng nhất, và ta không kiểm soát được
     * máy người dùng.
     */
    const spec = 'pdfjs-dist/legacy/build/pdf.mjs';
    pdfjs = await import(spec);
    home = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  } catch {
    throw new PdfToolMissing();
  }

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    // Trang PDF không được vẽ ra, chỉ lấy chữ — tắt hết phần cần môi trường
    // trình duyệt, nếu không nó đi tìm canvas và ném lỗi khó hiểu.
    disableFontFace: true,
    isEvalSupported: false,
    /**
     * ⚠ HAI THƯ MỤC NÀY KHÔNG PHẢI ĐỂ VẼ — CHÚNG LÀ BẢNG MÃ CHỮ.
     *
     * Thiếu `standardFontDataUrl`, pdf.js kêu ngay ở lượt đầu; ta vẫn ra chữ
     * với PDF đơn giản nên rất dễ tưởng là vô hại. Nhưng với font base-14
     * KHÔNG NHÚNG, bảng mã nằm trong chính mấy file này — không có nó thì
     * `getTextContent` trả ra glyph không dịch ngược được sang unicode.
     *
     * `cMapUrl` là bản đồ CID → unicode cho các CMap dựng sẵn. Đây là ca
     * TIẾNG VIỆT/CJK trong PDF xuất từ Word — tức là đúng loại hợp đồng bài 6
     * đang thả vào. Bỏ qua thì văn bản bóc ra là một mớ ký tự, `Grep` không
     * trúng gì, và không có dòng lỗi nào cả.
     *
     * Cả hai chỉ trỏ được vì `pdfjs-dist` giờ là phụ thuộc THẬT — hồi nó còn
     * tuỳ chọn thì không có đường nào biết nó nằm ở đâu.
     */
    standardFontDataUrl: assetDir(home, 'standard_fonts'),
    cMapUrl: assetDir(home, 'cmaps'),
    cMapPacked: true,
  }).promise;

  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((it: any) => (typeof it.str === 'string' ? it.str : '')).join(' ');
    /**
     * MỐC TRANG — mảnh nối "Grep tìm ra dòng" với "Read đúng trang" (§3.1).
     * Bỏ nó đi thì nhân viên tìm được câu nhưng không biết mở trang nào, và
     * quay lại phải đọc cả tài liệu. Định dạng phải khớp `pageOfLine`.
     */
    parts.push(`--- trang ${i} ---\n${line.replace(/\s+/g, ' ').trim()}`);
  }
  await doc.destroy?.();

  const text = parts.join('\n\n');
  return { text, shape: `pdf, ${doc.numPages} trang`, pages: doc.numPages, preview: previewOf(text) };
}

// ─────────────────────────────────────────────────────────────── dùng chung

/** Bỏ mọi thẻ XML rồi dọn khoảng trắng thừa. */
function stripTags(s: string): string {
  return decodeXml(s.replace(/<[^>]*>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // `&amp;` đi CUỐI CÙNG: đảo lại thì `&amp;lt;` bị giải hai lần thành `<`.
    .replace(/&amp;/g, '&');
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** ~40 chữ đầu có nội dung. Đủ để nhận ra tài liệu, đủ ngắn để nằm vừa một ô bảng. */
function previewOf(text: string): string {
  const flat = text
    .split('\n')
    .filter((l) => !l.startsWith('--- trang ') && l.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = flat.split(' ').slice(0, 40).join(' ');
  return words.length < flat.length ? `${words}…` : words;
}
