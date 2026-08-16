/**
 * Đọc ZIP — vừa đủ để bóc `.docx` / `.xlsx` / `.pptx`.
 *
 * → docs/SPEC-library.md §4
 *
 * VÌ SAO TỰ VIẾT thay vì thêm một thư viện: ba định dạng Office đều là ZIP chứa
 * XML, và phần ZIP ta cần chỉ có "tìm mục theo tên, giải nén mục đó". `node:zlib`
 * đã có sẵn `inflateRawSync`. Đổi lại là ~150 dòng đọc được, test được bằng
 * `node --test`, và **không thêm một phụ thuộc nào** vào một dự án hiện chỉ có ba.
 *
 * (`.pdf` thì ngược lại — content stream nén + CID font là thứ không tự viết
 * được, và spec §15 đã ghi rõ nó bắt buộc phải có thư viện thật.)
 *
 * CỐ Ý chỉ giải nén mục được HỎI TÊN. Một file .docx 90KB có thể chứa hàng chục
 * ảnh nhúng; giải nén hết để rồi vứt đi là trả tiền cho việc không ai cần.
 */

import zlib from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/**
 * Trần giải nén MỘT mục. Chốt chống zip bomb: tỉ lệ nén của XML rất cao (một
 * mục 50KB nén ra 10MB là bình thường), nên không thể chặn bằng tỉ lệ — phải
 * chặn bằng con số tuyệt đối. 200MB là quá đủ cho `word/document.xml` của bất
 * kỳ tài liệu nào người ta thật sự viết bằng tay.
 */
const MAX_ENTRY_BYTES = 200 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface ZipFile {
  names: string[];
  /** Giải nén một mục. `undefined` nếu không có mục đó. Ném lỗi nếu mục hỏng. */
  read(name: string): Buffer | undefined;
}

export function openZip(buf: Buffer): ZipFile {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('Không đọc được cấu trúc ZIP (thiếu bản ghi kết thúc).');

  const centralOffset = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);

  /**
   * ZIP64: khi file > 4GB hoặc > 65535 mục, hai trường trên bị đặt thành toàn
   * 1 và số thật nằm ở một bản ghi khác. Ta không đọc ZIP64 — nhưng phải NÓI RA
   * thay vì đọc bừa một offset vô nghĩa rồi ném một lỗi không ai hiểu.
   */
  if (centralOffset === 0xffffffff || count === 0xffff) {
    throw new Error('File nén dạng ZIP64 — quá lớn để đọc.');
  }
  if (centralOffset >= buf.length) throw new Error('Cấu trúc ZIP hỏng.');

  const entries = new Map<string, ZipEntry>();
  let p = centralOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return {
    names: [...entries.keys()],
    read(name: string): Buffer | undefined {
      const e = entries.get(name);
      if (!e) return undefined;
      if (e.uncompressedSize > MAX_ENTRY_BYTES) {
        throw new Error(`Mục "${name}" trong file quá lớn.`);
      }

      /**
       * Kích thước tên và extra của LOCAL header có thể KHÁC central directory —
       * đây là chỗ hay bị viết sai nhất khi tự đọc ZIP. Phải đọc lại từ local
       * header, không được tái dùng `nameLen`/`extraLen` ở trên.
       */
      const lo = e.localOffset;
      if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== SIG_LOCAL) {
        throw new Error(`Mục "${name}" trong file hỏng.`);
      }
      const nameLen = buf.readUInt16LE(lo + 26);
      const extraLen = buf.readUInt16LE(lo + 28);
      const start = lo + 30 + nameLen + extraLen;
      const raw = buf.subarray(start, start + e.compressedSize);

      if (e.method === 0) return Buffer.from(raw);
      if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
      throw new Error(`Mục "${name}" dùng kiểu nén chưa hỗ trợ (${e.method}).`);
    },
  };
}

/**
 * Tìm bản ghi kết thúc, quét NGƯỢC từ cuối file.
 *
 * Không thể nhảy thẳng tới `length - 22`: ZIP cho phép một chú thích dài tới
 * 65535 byte nằm sau bản ghi đó. Nhiều công cụ ghi chú thích thật.
 */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}
