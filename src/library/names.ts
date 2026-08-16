/**
 * Kiểm tên file và định dạng — TOÀN HÀM THUẦN.
 *
 * → docs/SPEC-library.md §4
 *
 * Tách khỏi phần I/O có chủ ý: đây đúng là lớp hàm mà `SESSIONS_MEMORY.md` §4
 * xếp ưu tiên 0 cho test tự động — biên dịch sạch, đọc thấy hợp lý, và sai theo
 * những cách chỉ lộ ra khi gặp file thật.
 */

/** Đuôi nhận vào và cách xử lý. → SPEC-library.md §4 */
export type Handling = 'text' | 'zip' | 'pdf';

export const HANDLING: Record<string, Handling> = {
  md: 'text',
  txt: 'text',
  csv: 'text',
  json: 'text',
  yaml: 'text',
  yml: 'text',
  docx: 'zip',
  xlsx: 'zip',
  pptx: 'zip',
  pdf: 'pdf',
};

/**
 * Đuôi bị chặn CÓ CHỦ Ý, kèm câu nói cho người dùng.
 *
 * Danh sách này tồn tại để câu từ chối nói được *vì sao*, thay vì một câu
 * "định dạng không hỗ trợ" chung chung khiến người dùng thử lại ba lần.
 */
export const REFUSED: Record<string, string> = {
  jpg: 'Ảnh thì nhân viên không tìm bằng từ khoá được. Nếu ảnh có chữ, hãy xuất ra PDF rồi thả lại.',
  jpeg: 'Ảnh thì nhân viên không tìm bằng từ khoá được. Nếu ảnh có chữ, hãy xuất ra PDF rồi thả lại.',
  png: 'Ảnh thì nhân viên không tìm bằng từ khoá được. Nếu ảnh có chữ, hãy xuất ra PDF rồi thả lại.',
  gif: 'Ảnh thì nhân viên không tìm bằng từ khoá được.',
  webp: 'Ảnh thì nhân viên không tìm bằng từ khoá được.',
  heic: 'Ảnh thì nhân viên không tìm bằng từ khoá được.',
  mp4: 'Video chưa nằm trong phạm vi tủ tài liệu.',
  mov: 'Video chưa nằm trong phạm vi tủ tài liệu.',
  avi: 'Video chưa nằm trong phạm vi tủ tài liệu.',
  mp3: 'Âm thanh chưa nằm trong phạm vi tủ tài liệu.',
  wav: 'Âm thanh chưa nằm trong phạm vi tủ tài liệu.',
  zip: 'File nén chưa nhận. Giải nén ra rồi thả từng file vào.',
  rar: 'File nén chưa nhận. Giải nén ra rồi thả từng file vào.',
  '7z': 'File nén chưa nhận. Giải nén ra rồi thả từng file vào.',
  exe: 'Không nhận file chạy được.',
  dll: 'Không nhận file chạy được.',
  doc: 'Định dạng Word cũ (.doc) khác hẳn .docx bên trong. Mở bằng Word rồi "Lưu thành" .docx.',
  xls: 'Định dạng Excel cũ (.xls) khác hẳn .xlsx bên trong. Mở bằng Excel rồi "Lưu thành" .xlsx.',
  ppt: 'Định dạng PowerPoint cũ (.ppt). Mở rồi "Lưu thành" .pptx.',
};

/** Tên thiết bị Windows chiếm dụng. `CON.txt` cũng hỏng, không chỉ `CON`. */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Trần ĐỘ DÀI TÊN tính bằng BYTE, không phải ký tự.
 *
 * Giới hạn của hệ thống file là ~255 byte. Tiếng Việt có dấu chiếm 2–3 byte mỗi
 * ký tự trong UTF-8, nên một tên 150 "chữ" hoàn toàn có thể vượt trần. Đếm bằng
 * `.length` là đúng với tiếng Anh và sai với đúng nhóm người dùng của ta.
 * Trừ hao cho hậu tố `.txt` mà sidecar sẽ nối thêm.
 */
const MAX_NAME_BYTES = 200;

export type NameCheck = { ok: true; name: string; ext: string } | { ok: false; reason: string };

/**
 * Làm sạch và kiểm tên file người dùng đưa lên.
 *
 * CỐ Ý KHÔNG slugify: người dùng phải nhận ra file của mình trong tủ. Dấu tiếng
 * Việt trong tên file là hợp lệ trên cả NTFS lẫn ext4. Ta chỉ TỪ CHỐI cái nguy
 * hiểm, không viết lại cái hợp lệ.
 */
export function safeName(input: string): NameCheck {
  const name = input.trim();
  if (!name) return { ok: false, reason: 'Tên file rỗng.' };

  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) {
    return { ok: false, reason: 'Tên file quá dài. Đổi tên ngắn lại rồi thả lại.' };
  }

  // Path traversal + phân cách thư mục. `safeJoin` cũng chặn, nhưng chặn ở đây
  // cho ra CÂU GIẢI THÍCH thay vì một exception chung.
  if (name.includes('/') || name.includes('\\')) {
    return { ok: false, reason: 'Tên file không được chứa dấu / hoặc \\.' };
  }
  if (name === '.' || name === '..') return { ok: false, reason: 'Tên file không hợp lệ.' };

  // Ký tự điều khiển + NUL. Một tên có \0 cắt đứt chuỗi ở tầng hệ điều hành:
  // kiểm tra thấy "a.txt.exe", ghi ra đĩa thành "a.txt".
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) < 0x20) return { ok: false, reason: 'Tên file chứa ký tự không hợp lệ.' };
  }

  /**
   * Tên bắt đầu bằng dấu chấm — CHẶN, và đây không phải chuyện thẩm mỹ.
   *
   * `Grep` bỏ qua mọi thứ bắt đầu bằng dấu chấm khi duyệt thư mục (đã đo, xem
   * SPEC-library.md §2.1). Một file `.env.txt` nằm trong tủ sẽ hiện trên giao
   * diện, bóc text thành công, và KHÔNG BAO GIỜ được tìm thấy. Im lặng.
   */
  if (name.startsWith('.')) {
    return { ok: false, reason: 'Tên file không được bắt đầu bằng dấu chấm — nhân viên sẽ không tìm thấy nó.' };
  }

  /**
   * Kết thúc bằng dấu chấm hoặc khoảng trắng: Windows lặng lẽ CẮT ĐI khi tạo
   * file. Hậu quả là tên trong catalog khác tên trên đĩa, rồi mọi thao tác xoá
   * và thay thế sau đó trượt.
   */
  if (/[. ]$/.test(name)) {
    return { ok: false, reason: 'Tên file không được kết thúc bằng dấu chấm hoặc khoảng trắng.' };
  }

  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return { ok: false, reason: 'File phải có phần đuôi (ví dụ .pdf, .docx).' };
  }
  const ext = name.slice(dot + 1).toLowerCase();
  const stem = name.slice(0, dot);

  if (WINDOWS_RESERVED.has(stem.toLowerCase())) {
    return { ok: false, reason: `"${stem}" là tên thiết bị Windows chiếm dụng. Đổi tên khác.` };
  }

  if (REFUSED[ext]) return { ok: false, reason: REFUSED[ext] };
  if (!HANDLING[ext]) {
    return { ok: false, reason: `Chưa nhận đuôi .${ext}. Nhận: ${Object.keys(HANDLING).join(', ')}.` };
  }

  return { ok: true, name, ext };
}

export type SniffResult = { ok: true } | { ok: false; reason: string };

/**
 * Kiểm NỘI DUNG có khớp đuôi không.
 *
 * Đổi tên `virus.exe` thành `bao-cao.pdf` mất hai giây. Với văn phòng chạy trên
 * VPS thì route upload là một cửa thật, nên đuôi file không đủ làm bằng chứng.
 * Kiểm bằng vài byte đầu — rẻ, tất định, không phụ thuộc gì.
 */
export function sniffType(head: Buffer, ext: string): SniffResult {
  const kind = HANDLING[ext];
  if (!kind) return { ok: false, reason: `Chưa nhận đuôi .${ext}.` };

  if (kind === 'pdf') {
    // Chuẩn PDF cho phép rác trước header, và nhiều file thật có rác thật.
    // Quét 1KB đầu thay vì so đúng offset 0.
    const idx = head.subarray(0, 1024).indexOf('%PDF-');
    if (idx < 0) {
      return { ok: false, reason: 'File này không phải PDF thật, dù có đuôi .pdf.' };
    }
    return { ok: true };
  }

  if (kind === 'zip') {
    // docx/xlsx/pptx đều là ZIP. `PK\x03\x04` = local file header.
    if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) {
      return { ok: false, reason: `File này không phải .${ext} thật (bên trong phải là gói ZIP).` };
    }
    return { ok: true };
  }

  /**
   * Text: không có magic bytes để so, nên kiểm NGƯỢC — file nhị phân đội lốt
   * `.txt` gần như luôn có byte NUL trong phần đầu, còn văn bản UTF-8 hợp lệ
   * thì không bao giờ có.
   */
  if (head.subarray(0, 8192).includes(0)) {
    return { ok: false, reason: `File này là dữ liệu nhị phân, không phải văn bản .${ext}.` };
  }
  return { ok: true };
}

/**
 * Trang chứa dòng thứ `line` của file text đã bóc từ PDF.
 *
 * Đây là mảnh nối "Grep tìm ra dòng" với "Read đúng trang" (§3.1). Trả về
 * `undefined` khi file không có mốc trang (mọi định dạng không phải PDF).
 */
export function pageOfLine(text: string, line: number): number | undefined {
  const lines = text.split('\n');
  let page: number | undefined;
  for (let i = 0; i < Math.min(line, lines.length); i++) {
    const m = /^--- trang (\d+) ---$/.exec(lines[i] ?? '');
    if (m) page = Number(m[1]);
  }
  return page;
}

/** "1.2 MB" — dùng chung giữa INDEX.md và giao diện, để hai chỗ không lệch nhau. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** "41K" — số token ước lượng, gọn cho bảng. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${Math.round(n / 1000)}K`;
}
