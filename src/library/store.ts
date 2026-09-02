/**
 * Tủ tài liệu: file NGƯỜI DÙNG đưa vào.
 *
 * → docs/SPEC-library.md
 *
 * Khác kho tri thức ở đúng chỗ quan trọng nhất: **không có gì ở đây vào prefix**.
 * Kho tri thức trả tiền mỗi lượt, mỗi worker, nên nó có trần 250 token và một
 * vòng đời tự động (supersedes · hits · prune). Tủ tài liệu nằm trên đĩa, với
 * tới bằng `Glob`/`Grep`, và **không bao giờ tự xoá thứ gì** — vì thứ nó giữ là
 * file của khách, không phải ghi chú agent tự sinh.
 *
 * ⚠ Không thư mục nào trong đây được bắt đầu bằng dấu chấm: `Grep` bỏ qua thư
 * mục ẩn khi duyệt xuống (đã đo — SPEC-library.md §2.1). Giấu `text/` vào
 * `.state/` là làm cả cơ chế truy xuất chết im lặng.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { OfficePaths } from '../core/paths.js';
import { estimateTokens } from '../core/tokens.js';
import {
  HANDLING,
  docPaths,
  formatBytes,
  formatTokens,
  safeName,
  sniffType,
  type Handling,
} from './names.js';
import {
  PdfToolMissing,
  extractDocx,
  extractPdf,
  extractPptx,
  extractText,
  extractXlsx,
  type Extracted,
} from './extract.js';

export type DocState =
  /** vừa vào tủ, chưa bóc */
  | 'pending'
  /** đang bóc — đây là trạng thái DUY NHẤT `office.run()` phải chờ (§10) */
  | 'extracting'
  /** bóc xong, tìm được bằng từ khoá */
  | 'ready'
  /** bản chụp/scan: bóc ra ~0 chữ. KHÔNG phải lỗi — model đọc trực tiếp được */
  | 'image-only'
  /** chưa bóc được vì thiếu công cụ, nhưng bản gốc vẫn dùng được */
  | 'unindexed'
  /** file hỏng, có mật khẩu, hoặc không đúng định dạng như đuôi khai */
  | 'failed';

export interface DocRecord {
  name: string;
  ext: string;
  bytes: number;
  mtime: string;
  state: DocState;
  /** "34 trang" · "3 sheet: …" — cho INDEX.md và giao diện. */
  shape?: string;
  preview?: string;
  tokens?: number;
  pages?: number;
  /** Câu nói cho người dùng khi state không phải `ready`. Luôn kèm việc phải làm. */
  note?: string;
  extracted_at?: string;
}

/** Ngưỡng phát hiện bản chụp: dưới ngần này ký tự mỗi trang thì coi như không có lớp chữ. */
const CHARS_PER_PAGE_MIN = 50;

export class LibraryStore {
  private docs = new Map<string, DocRecord>();
  private working = false;

  constructor(
    private paths: OfficePaths,
    private onChange: () => void = () => {},
  ) {
    this.load();
  }

  rebind(paths: OfficePaths): void {
    this.paths = paths;
    this.docs.clear();
    this.load();
  }

  get size(): number {
    return this.docs.size;
  }

  list(): DocRecord[] {
    return [...this.docs.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  /**
   * Đồng bộ catalog với thư mục thật, rồi khởi động việc bóc còn thiếu.
   *
   * CỐ Ý gọi ở mỗi `GET /library` thay vì dùng file watcher. Watcher bắn sự kiện
   * GIỮA LÚC một file lớn đang được copy vào → bóc ra text cụt → catalog ghi
   * `ready` → không ai biết. Quét lúc đọc là `readdir` + `stat`, vài ms, và
   * không bao giờ nhìn thấy file dở. → SPEC-library.md §9.1
   */
  scan(): DocRecord[] {
    fs.mkdirSync(this.filesDir, { recursive: true });
    fs.mkdirSync(this.textDir, { recursive: true });

    /**
     * ⚠ CÓ ĐỔI THẬT KHÔNG — `scan()` chạy ở MỖI `GET /library`, nên nó tuyệt
     * đối không được báo "đã đổi" khi không có gì đổi. Xem khối chú thích ở
     * `pump()`: một lần báo thừa ở đây là một vòng lặp vô hạn ở giao diện.
     */
    let dirty = false;
    const onDisk = new Map<string, fs.Stats>();
    for (const entry of fs.readdirSync(this.filesDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      try {
        onDisk.set(entry.name, fs.statSync(path.join(this.filesDir, entry.name)));
      } catch {
        /* file biến mất giữa readdir và stat — coi như không có */
      }
    }

    // Biến khỏi đĩa → biến khỏi catalog, và sidecar đi cùng. Bỏ sót bước dọn
    // sidecar là để `Grep` tìm thấy nội dung của một tài liệu đã bị xoá.
    for (const name of [...this.docs.keys()]) {
      if (!onDisk.has(name)) {
        this.docs.delete(name);
        this.dropSidecar(name);
        dirty = true;
      }
    }

    for (const [name, stat] of onDisk) {
      const mtime = stat.mtime.toISOString();
      const known = this.docs.get(name);
      if (known && known.bytes === stat.size && known.mtime === mtime) continue;

      // File mới, hoặc đã bị thay bằng bản khác ngay trên đĩa. Cả hai đều phải
      // bóc lại từ đầu — và sidecar cũ phải chết TRƯỚC.
      this.dropSidecar(name);
      const checked = safeName(name);
      this.docs.set(name, {
        name,
        ext: checked.ok ? checked.ext : path.extname(name).slice(1).toLowerCase(),
        bytes: stat.size,
        mtime,
        ...(checked.ok
          ? { state: 'pending' as const }
          : { state: 'failed' as const, note: checked.reason }),
      });
      dirty = true;
    }

    this.save();
    /**
     * Chỉ dựng lại INDEX và báo khi CATALOG THẬT SỰ ĐỔI.
     *
     * Ca phải giữ: file bị xoá ngoài app ⇒ không có gì để bóc ⇒ `pump()` không
     * làm gì ⇒ nếu ở đây cũng im thì `INDEX.md` giữ tên một tài liệu đã chết.
     */
    if (dirty) {
      this.renderIndex();
      this.onChange();
    }
    void this.pump();
    return this.list();
  }

  /**
   * Nhận một tài liệu mới.
   *
   * Ném lỗi có CÂU ĐỌC ĐƯỢC cho mọi đường từ chối — người dùng thả nhầm file thì
   * phải biết ngay vì sao, không phải thử lại ba lần.
   */
  add(rawName: string, data: Buffer, opts: { replace?: boolean; maxBytes: number }): DocRecord {
    const checked = safeName(rawName);
    if (!checked.ok) throw new LibraryError(checked.reason);

    if (data.length === 0) throw new LibraryError('File rỗng.');
    if (data.length > opts.maxBytes) {
      throw new LibraryError(
        `File nặng ${formatBytes(data.length)}, vượt trần ${formatBytes(opts.maxBytes)}. ` +
          'Nếu là bản chụp/scan thì nén lại hoặc tách nhỏ trước khi thả vào.',
      );
    }

    const sniffed = sniffType(data.subarray(0, 8192), checked.ext);
    if (!sniffed.ok) throw new LibraryError(sniffed.reason);

    const dest = path.join(this.filesDir, checked.name);
    if (fs.existsSync(dest) && !opts.replace) {
      throw new LibraryError(`Đã có tài liệu tên "${checked.name}" trong tủ.`, 'duplicate');
    }

    /**
     * XOÁ SIDECAR TRƯỚC KHI GHI ĐÈ — không phải sau.
     *
     * Đây đúng lớp bug "ghi một đằng đọc một nẻo" (SESSIONS_MEMORY §8). Nếu ghi
     * file mới xong mới dọn, và bước dọn hỏng, thì `Grep` tìm thấy nội dung của
     * bản ĐÃ BỊ THAY — im lặng, mãi mãi, và nhân viên trích dẫn một câu không
     * còn tồn tại trong file người dùng đang mở.
     */
    this.dropSidecar(checked.name);

    fs.mkdirSync(this.filesDir, { recursive: true });
    fs.writeFileSync(dest, data);
    const stat = fs.statSync(dest);

    const rec: DocRecord = {
      name: checked.name,
      ext: checked.ext,
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
      state: 'pending',
    };
    this.docs.set(rec.name, rec);
    this.save();
    void this.pump();
    return rec;
  }

  /**
   * BÓC LẠI một tài liệu chưa dùng được. → SPEC-library.md §4.5
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MỘT TÀI LIỆU HỎNG VÌ LÝ DO ĐÃ ĐƯỢC SỬA THÌ HỎNG MÃI MÃI — CHO TỚI 20/08. │
   * │                                                                          │
   * │ `hd2.pdf` vào tủ lúc chưa có bộ đọc PDF nên nhận `unindexed`. Chiều hôm   │
   * │ đó `pdfjs-dist` thành phụ thuộc thật — và tài liệu vẫn `unindexed`, kèm   │
   * │ nguyên câu *"Cài: npm i pdfjs-dist"* nằm trong prefix Trợ lý. Không có    │
   * │ đường nào bóc lại: người dùng phải XOÁ rồi thả lại chính file của mình.   │
   * │                                                                          │
   * │ Trạng thái `state` là một BẢN GHI VỀ QUÁ KHỨ, không phải một sự thật      │
   * │ vĩnh viễn — mà nguyên nhân của nó thì thay đổi được (cài thêm công cụ,    │
   * │ nâng phiên bản, sửa bug). Thiếu đường quay lại thì bản ghi đó hoá thành   │
   * │ một lời tuyên án.                                                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Trả `false` khi không có tài liệu đó hoặc bản gốc đã biến mất khỏi đĩa.
   */
  reextract(rawName: string): boolean {
    const rec = this.docs.get(rawName);
    if (!rec) return false;
    if (!fs.existsSync(path.join(this.filesDir, rec.name))) return false;
    // Dọn sidecar cũ TRƯỚC: bóc lại mà thất bại thì thà không có bản text còn
    // hơn giữ một bản cũ mà `state` mới nói là chưa bóc được.
    this.dropSidecar(rec.name);
    delete rec.note;
    rec.state = 'pending';
    this.save();
    void this.pump();
    return true;
  }

  /**
   * Thử lại MỘT LẦN lúc khởi động cho tài liệu thiếu công cụ. → `reextract`
   *
   * ⚠ CHỈ `unindexed`, cố ý không đụng `failed`. Hai trạng thái nói hai chuyện
   * khác hẳn: `unindexed` = *máy này chưa có công cụ* (đổi được, và thường đã
   * đổi đúng vào lúc khởi động lại sau khi cài); `failed` = *file này hỏng*
   * (không đổi). Thử lại `failed` mỗi lần bật daemon là đốt CPU cho một kết
   * quả biết trước, và với file lớn thì nó làm chậm mọi lần khởi động.
   */
  retryUnindexed(): number {
    const stuck = [...this.docs.values()].filter((d) => d.state === 'unindexed');
    for (const d of stuck) this.reextract(d.name);
    return stuck.length;
  }

  /** Xoá hẳn: bản gốc + văn bản đã bóc. Một mức, không có "lưu trữ". → §6 */
  remove(rawName: string): boolean {
    const rec = this.docs.get(rawName);
    if (!rec) return false;
    fs.rmSync(path.join(this.filesDir, rec.name), { force: true });
    this.dropSidecar(rec.name);
    this.docs.delete(rec.name);
    this.save();
    this.renderIndex();
    this.onChange();
    return true;
  }

  /** Đường dẫn tuyệt đối của bản gốc, để tải về. `undefined` nếu không có. */
  originalPath(rawName: string): string | undefined {
    const rec = this.docs.get(rawName);
    if (!rec) return undefined;
    const abs = path.join(this.filesDir, rec.name);
    return fs.existsSync(abs) ? abs : undefined;
  }

  /**
   * Chờ những tài liệu ĐANG BÓC — và chỉ chúng.
   *
   * Đây là điểm chờ DUY NHẤT của cả tính năng (§10). Không có nó thì có một ca
   * hỏng thật và im lặng: người dùng thả PDF xong hỏi ngay, `Grep` chạy trước
   * khi text kịp tồn tại, nhân viên trả lời "không tìm thấy gì" một cách rất
   * thuyết phục. Có nó thì đổi lại vài giây chờ, và câu trả lời đúng.
   *
   * Timeout là bắt buộc: một file hỏng theo cách ta chưa lường được không được
   * phép treo cả văn phòng.
   */
  async settled(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.busyCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  busyCount(): number {
    let n = 0;
    for (const d of this.docs.values()) if (d.state === 'pending' || d.state === 'extracting') n++;
    return n;
  }

  /**
   * BẢNG KÊ CHO TRỢ LÝ — khối dữ liệu nhỏ đi vào prefix được cache. → §8b
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO PHẢI CÓ: TRỢ LÝ ĐANG MÙ, VÀ NÓ TỐN TIỀN THẬT.                     │
   * │                                                                          │
   * │ `INDEX.md` được dựng ra từ 17/08 với đúng mục đích "Trợ lý biết tủ có gì │
   * │ TRƯỚC khi chia việc" — rồi không ai đưa nó cho Trợ lý. Trợ lý chạy       │
   * │ `allowedTools: []`, nên nó không có đường nào biết trong tủ có gì.        │
   * │                                                                          │
   * │ Hậu quả đo được trên máy người dùng (bài 2, 19/08):                       │
   * │  · hỏi lại một câu mà câu trả lời KHÔNG đổi được việc phải làm           │
   * │    ("size còn hàng không" — trong khi chính sách đã cấm đổi từ trước)     │
   * │  · lập kế hoạch với `inputs: []` → nhân viên phải mò: 4 lượt Grep +      │
   * │    2 lượt Read cùng một file → 9 lượt, $0.0582 cho một câu trả lời khách │
   * │  · viết 7 ràng buộc trong đó 4 cái chết ngay khi nhân viên đọc tài liệu, │
   * │    và một cái là nhánh IF giao cho model tự rẽ                            │
   * │                                                                          │
   * │ Sửa bằng DỮ LIỆU, không phải bằng lời dặn: bảng kê này quan sát được     │
   * │ hoàn toàn từ chính các file, dựng bằng code, 0 lượt gọi LLM.             │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Hai ràng buộc giữ cho nó KHÔNG phá prompt cache:
   *
   * 1. **Chỉ tên + hình dạng, KHÔNG có `preview`.** Preview làm khối vừa to
   *    (mỗi file thêm ~40 chữ) vừa hay đổi. Trợ lý cần biết *có gì trong tủ* để
   *    chỉ đúng đường cho nhân viên, không cần biết *nội dung nói gì* — nó
   *    không phải người đọc tài liệu.
   * 2. **Bỏ qua tài liệu đang bóc.** `pending`/`extracting` là trạng thái thoáng
   *    qua vài giây; đưa vào là mỗi lần thả một file thì prefix đổi BA lần thay
   *    vì hai. Tài liệu chỉ xuất hiện khi nó đã thật sự dùng được.
   */
  manifest(): string {
    const usable = this.list().filter((d) => d.state !== 'pending' && d.state !== 'extracting');
    if (usable.length === 0) return '';

    const lines = usable.map((d) => {
      /**
       * ĐƯỜNG DẪN NÊU RA PHẢI LÀ ĐƯỜNG NHÂN VIÊN MỞ ĐƯỢC. → `docPaths`, §4.4
       *
       * Bản trước luôn nêu `library/files/<tên>` rồi dặn "nhét đường dẫn đó vào
       * `inputs`". Với `.docx` đó là một file nhị phân — cả một ca ba bước chết
       * ở bước một (20/08) trong khi bản `.txt` đã nằm sẵn cạnh nó.
       *
       * Ba thứ vẫn phải khớp nhau từng ký tự: chuỗi ở đây, chuỗi nút Chép, và
       * chuỗi planner ghi vào `inputs`. Nút Chép đưa đường dẫn NGƯỜI DÙNG nhận
       * ra (`library/files/…`) và `readablePaths` dịch nó sang đường mở được —
       * nên hai bên vẫn gặp nhau, chỉ khác lớp.
       */
      const { open, original } = docPaths(d.name, d.ext, d.state);
      const shape = d.shape ?? d.ext;

      // Không có đường nào mở được thì ĐỪNG NÊU ĐƯỜNG DẪN. Nêu ra là mời Trợ lý
      // giao một task chắc chắn hỏng — đúng chuyện vừa xảy ra.
      if (!open) return `- ${d.name} — ${shape} (chưa bóc được, chưa dùng được)`;

      // Nhãn chỉ cho trạng thái BỀN, và chỉ nói ràng buộc thật: cái nào tìm
      // được bằng từ khoá, cái nào không.
      const flag =
        d.state === 'image-only'
          ? ' (bản chụp — đọc từng trang, KHÔNG tìm được bằng từ khoá)'
          : d.state === 'unindexed'
            ? ' (chưa bóc — đọc theo trang, KHÔNG tìm được bằng từ khoá)'
            : '';
      const alt = original ? ` (original for exact pages: ${original})` : '';
      return `- ${open} — ${shape}${flag}${alt}`;
    });

    return [
      `# Documents the human put in this office's library`,
      '',
      ...lines,
      '',
      'Each path above is one an employee can open directly — put it in that task\'s `inputs`',
      'instead of making them search. Where a `.pdf` original is listed too, give BOTH: the text',
      'to find the passage, the original to read those exact pages.',
    ].join('\n');
  }

  /**
   * Văn bản của mọi tài liệu, mỗi bản mở đầu bằng TÊN FILE trên dòng một.
   *
   * Chỉ dùng cho một việc: kiểm một bài học sắp ghi vào kho tri thức có phải chỉ
   * là chép lại tài liệu không (`echoesLibrary`). Tên file đi kèm để câu cảnh
   * báo nói được ĐÚNG file nào — "trùng với tài liệu nào đó" thì người dùng
   * không kiểm được, mà không kiểm được thì cảnh báo vô dụng.
   *
   * KHÔNG BAO GIỜ đi vào prompt của ai. Nó ở lại trong tiến trình, sống vài mili
   * giây, rồi bị thu hồi — trần dưới đây tồn tại để một tài liệu 40MB không làm
   * daemon nghẹn ở một việc chỉ là kiểm tra.
   */
  texts(maxCharsPerDoc = 200_000): string[] {
    const out: string[] = [];
    for (const doc of this.docs.values()) {
      if (doc.state !== 'ready') continue;
      // Định dạng text sẵn không có sidecar — bản gốc CHÍNH LÀ văn bản (§3.1).
      const file = fs.existsSync(this.sidecarFor(doc.name))
        ? this.sidecarFor(doc.name)
        : path.join(this.filesDir, doc.name);
      try {
        out.push(`${doc.name}\n${fs.readFileSync(file, 'utf8').slice(0, maxCharsPerDoc)}`);
      } catch {
        /* file vừa bị xoá dưới chân ta — bỏ qua, đây chỉ là bước kiểm */
      }
    }
    return out;
  }

  /** Tên tài liệu đang bóc — để dòng trạng thái nói đúng tên chứ không nói "đang xử lý". */
  busyNames(): string[] {
    return [...this.docs.values()]
      .filter((d) => d.state === 'pending' || d.state === 'extracting')
      .map((d) => d.name);
  }

  // ── nội bộ

  private get filesDir(): string {
    return path.join(this.paths.library, 'files');
  }
  private get textDir(): string {
    return path.join(this.paths.library, 'text');
  }
  private get catalogFile(): string {
    return path.join(this.paths.library, 'catalog.json');
  }
  private get indexFile(): string {
    return path.join(this.paths.library, 'INDEX.md');
  }

  private sidecarFor(name: string): string {
    return path.join(this.textDir, `${name}.txt`);
  }

  private dropSidecar(name: string): void {
    fs.rmSync(this.sidecarFor(name), { force: true });
  }

  /**
   * Bóc lần lượt, MỘT file một lúc.
   *
   * Không chạy song song có chủ ý: giải nén và bóc XML là việc CPU đồng bộ, chạy
   * bốn cái cùng lúc trong một tiến trình Node không nhanh hơn mà chỉ giữ vòng
   * lặp sự kiện lâu hơn — mà chính vòng lặp đó đang phục vụ giao diện và SSE.
   */
  private async pump(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      let did = false;
      for (;;) {
        const next = [...this.docs.values()].find((d) => d.state === 'pending');
        if (!next) break;
        did = true;
        next.state = 'extracting';
        this.save();
        this.onChange();
        await this.extractOne(next);
        this.save();
        this.onChange();
      }
      /**
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ 🔴 CHỈ BÁO KHI CÓ LÀM GÌ ĐÓ — bug user báo 02/09.                  │
       * │                                                                    │
       * │ Bản cũ gọi `renderIndex() + onChange()` **vô điều kiện**, kể cả khi │
       * │ vòng lặp không bóc file nào. Mà `pump()` chạy ở MỖI `GET /library`  │
       * │ (qua `scan()`), nên một lượt ĐỌC lại phát ra sự kiện GHI. Vòng lặp: │
       * │                                                                    │
       * │   GET /library → scan → pump → `library.changed`                   │
       * │     → store: libraryVersion+1 **và** refreshCanvas()               │
       * │     → LibraryPanel `useEffect(reload, [reload, libraryVersion])`   │
       * │     → GET /library → …                                             │
       * │                                                                    │
       * │ Chạy mãi khi ngăn Tủ tài liệu đang mở, và **không có triệu chứng**  │
       * │ nào ngoài quạt máy — cho tới khi có một thứ khác đọc `canvas`, lúc  │
       * │ đó nó mới lộ ra (hộp thoại prompt nháy liên tục). → SPEC-library §10│
       * │                                                                    │
       * │ 📌 Luật rút ra: **một lượt ĐỌC không được phát sự kiện ĐỔI.** Chỗ    │
       * │ duy nhất được phát là chỗ thật sự ghi.                              │
       * └────────────────────────────────────────────────────────────────────┘
       */
      if (did) {
        this.renderIndex();
        this.onChange();
      }
    } finally {
      this.working = false;
    }
  }

  private async extractOne(rec: DocRecord): Promise<void> {
    const abs = path.join(this.filesDir, rec.name);
    const kind: Handling | undefined = HANDLING[rec.ext];
    if (!kind) {
      rec.state = 'failed';
      rec.note = `Chưa nhận đuôi .${rec.ext}.`;
      return;
    }

    let out: Extracted;
    try {
      const buf = fs.readFileSync(abs);
      out =
        kind === 'text'
          ? extractText(buf, rec.ext)
          : kind === 'pdf'
            ? await extractPdf(buf)
            : rec.ext === 'docx'
              ? extractDocx(buf)
              : rec.ext === 'xlsx'
                ? extractXlsx(buf)
                : extractPptx(buf);
    } catch (err) {
      if (err instanceof PdfToolMissing) {
        /**
         * Tài liệu vẫn dùng được — nhân viên `Read` thẳng bản gốc theo trang,
         * chỉ mất khả năng tìm bằng từ khoá. Nói đúng điều đó, kèm việc phải làm.
         *
         * ⚠ Câu này ĐÃ TỪNG bảo người dùng gõ `npm i pdfjs-dist` (sửa 20/08).
         * Đọc PDF là một phần của sản phẩm, không phải một tiện ích người dùng
         * tự lắp thêm — giờ `pdfjs-dist` nằm trong `dependencies`, nên tới được
         * nhánh này nghĩa là CÀI ĐẶT HỎNG, và việc phải làm là chạy lại
         * `npm install`, không phải đi tìm tên một gói npm.
         */
        rec.state = 'unindexed';
        rec.note =
          'Bộ đọc PDF chưa nạp được nên chưa tìm được bằng từ khoá — nhiều khả năng bản cài thiếu file. ' +
          'Nhân viên vẫn đọc được nếu bạn nói rõ trang. Chạy lại `npm install` trong thư mục agentco rồi thả lại file.';
        rec.shape = 'pdf';
        return;
      }
      rec.state = 'failed';
      rec.note = friendlyError(err, rec.ext);
      return;
    }

    rec.shape = out.shape;
    rec.preview = out.preview;
    rec.tokens = estimateTokens(out.text);
    if (out.pages !== undefined) rec.pages = out.pages;
    rec.extracted_at = new Date().toISOString();

    /**
     * Bản chụp: bóc ra gần như không có chữ. KHÔNG đánh là lỗi — model nhìn
     * trang PDF như một tấm ảnh nên nó ĐỌC ĐƯỢC, chỉ đắt hơn và không grep
     * được. Bản nháp đầu của spec gọi đây là "cần OCR, chưa hỗ trợ", và đó là
     * một câu sai đã đuổi người dùng khỏi một thứ vốn chạy được. → §3.2
     */
    if (rec.pages && out.text.replace(/--- trang \d+ ---/g, '').trim().length < rec.pages * CHARS_PER_PAGE_MIN) {
      rec.state = 'image-only';
      rec.note =
        'Bản chụp, không có lớp chữ — tìm bằng từ khoá sẽ không ra. ' +
        'Nhân viên phải đọc từng trang nên tốn hơn bình thường.';
      return;
    }

    // Định dạng text sẵn KHÔNG cần bản sao: bản gốc đã là văn bản và `Grep` đọc
    // thẳng được. Sinh sidecar cho nó chỉ tạo ra hai bản của cùng một thứ, rồi
    // một ngày nào đó chúng lệch nhau.
    if (kind !== 'text') {
      fs.mkdirSync(this.textDir, { recursive: true });
      fs.writeFileSync(this.sidecarFor(rec.name), out.text, 'utf8');
    }
    rec.state = 'ready';
    delete rec.note;
  }

  /**
   * `INDEX.md` — tầng định tuyến, dựng bằng CODE, 0 token. → §8
   *
   * Mọi cột đều QUAN SÁT ĐƯỢC từ chính file. Không có lượt gọi LLM nào ở đây, và
   * đó là điểm khác biệt với ý "sinh một node tóm tắt cho mỗi file" — ý đó đúng
   * mục tiêu nhưng trả bằng một lượt gọi cho mỗi tài liệu.
   *
   * File này KHÔNG vào prefix. Trợ lý chủ động đọc nó khi cần biết "tủ có gì" —
   * một file nhỏ, thay cho việc `Glob` mò cả thư mục.
   */
  renderIndex(): void {
    const docs = this.list();
    fs.mkdirSync(this.paths.library, { recursive: true });

    if (docs.length === 0) {
      fs.writeFileSync(
        this.indexFile,
        '# Tủ tài liệu\n\nChưa có tài liệu nào. Người dùng thả file vào qua giao diện.\n',
        'utf8',
      );
      return;
    }

    const rows = docs.map((d) => {
      const note =
        d.state === 'ready'
          ? (d.preview ?? '')
          : `**${stateLabel(d.state)}** — ${d.note ?? ''} ${d.preview ?? ''}`.trim();
      // Cột "Mở bằng" là cột QUAN TRỌNG NHẤT của bảng này, và trước 20/08 nó
      // không tồn tại — ai đọc INDEX.md phải tự suy ra đường nào mở được, và
      // Trợ lý suy sai. → `docPaths`
      const { open, original } = docPaths(d.name, d.ext, d.state);
      /**
       * ⚠ MỘT DẤU `|` TRONG TÊN FILE LÀ MỘT HÀNG BẢNG VỠ ĐÔI.
       *
       * `|` hợp lệ trên ext4/APFS (chỉ Windows cấm), và `scan()` nhận cả file
       * người ta chép tay thẳng vào `library/files/` — không đi qua `safeName`.
       * Một cái tên như vậy tách hàng thành hai cột lệch, và cột lệch nhất
       * chính là cột "Mở bằng": Trợ lý đọc ra một đường dẫn cụt.
       *
       * Nên tên và mô tả bị THAY ký tự (chúng chỉ để nhìn), còn đường dẫn thì
       * KHÔNG — một đường dẫn sửa đổi là đường dẫn chết, và đường dẫn chết đắt
       * hơn hẳn một ô trống. Tên có `|` ⇒ nói thẳng là chưa dùng được.
       */
      const cell = (s: string): string => s.replace(/\|/g, '/').replace(/\r?\n/g, ' ');
      const openCell = d.name.includes('|')
        ? '— tên file có dấu `|`, đổi tên rồi thả lại'
        : open
          ? original
            ? `\`${open}\` + \`${original}\` (đọc kỹ theo trang)`
            : `\`${open}\``
          : '— chưa dùng được';
      return `| ${cell(d.name)} | ${cell(d.shape ?? d.ext)} | ${formatBytes(d.bytes)} | ${
        d.tokens ? formatTokens(d.tokens) : '—'
      } | ${openCell} | ${cell(note)} |`;
    });

    const lines = [
      `# Tủ tài liệu — ${docs.length} tài liệu`,
      '',
      '**Dùng đúng đường ở cột "Mở bằng".** Luật khác nhau theo định dạng:',
      '',
      '- `.md .txt .csv .json .yaml` — bản gốc CHÍNH LÀ văn bản, đọc thẳng `library/files/`.',
      '- `.docx .xlsx .pptx` — bản gốc là file nén, **không tool nào mở trực tiếp được**.',
      '  Chỉ dùng bản đã bóc ở `library/text/<tên>.txt`.',
      '- `.pdf` — dùng CẢ HAI: `Grep` bản text để tìm, thấy dòng nào thì xem mốc',
      '  `--- trang N ---` gần nhất phía trên, rồi `Read` bản gốc đúng trang đó.',
      '',
      '| Tên | Loại | Cỡ | ~Token | Mở bằng | Mở đầu / cấu trúc |',
      '|---|---|---|---|---|---|',
      ...rows,
      '',
      `_Cập nhật ${new Date().toISOString().slice(0, 16).replace('T', ' ')} — dựng bằng code, không qua model._`,
      '',
    ];
    fs.writeFileSync(this.indexFile, lines.join('\n'), 'utf8');
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.catalogFile, 'utf8')) as { docs?: DocRecord[] };
      for (const d of raw.docs ?? []) {
        // Daemon tắt giữa lúc đang bóc thì trạng thái đó vô nghĩa khi bật lại.
        // Đưa về `pending` để nó được bóc lại, thay vì kẹt `extracting` vĩnh
        // viễn và làm `settled()` chờ đủ timeout ở MỌI ca chạy sau đó.
        this.docs.set(d.name, d.state === 'extracting' ? { ...d, state: 'pending' } : d);
      }
    } catch {
      /* chưa có catalog, hoặc hỏng — quét lại là dựng được hết */
    }
  }

  private save(): void {
    fs.mkdirSync(this.paths.library, { recursive: true });
    fs.writeFileSync(
      this.catalogFile,
      JSON.stringify({ generated: new Date().toISOString(), docs: this.list() }, null, 2),
      'utf8',
    );
  }
}

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'duplicate' = 'invalid',
  ) {
    super(message);
    this.name = 'LibraryError';
  }
}

export function stateLabel(s: DocState): string {
  switch (s) {
    case 'pending':
      return 'đang chờ';
    case 'extracting':
      return 'đang đọc';
    case 'ready':
      return 'sẵn sàng';
    case 'image-only':
      return 'bản chụp';
    case 'unindexed':
      return 'chưa lập chỉ mục';
    case 'failed':
      return 'lỗi';
  }
}

/**
 * Đổi lỗi kỹ thuật thành câu nói được việc phải làm.
 *
 * Tiêu chí "Xử lý lỗi tốt" nói: mọi lỗi phải nói *chuyện gì xảy ra + làm gì
 * tiếp*. Một dòng "Invalid PDF structure" thoả đúng nửa đầu.
 */
function friendlyError(err: unknown, ext: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/password|encrypt/i.test(msg)) return 'File có mật khẩu — bỏ mật khẩu rồi thả lại.';
  if (/ZIP64/i.test(msg)) return 'File quá lớn để đọc. Tách nhỏ rồi thả lại.';
  if (/zip|inflate|nén/i.test(msg)) {
    return `File .${ext} hỏng hoặc không đúng định dạng. Mở bằng ứng dụng gốc rồi "Lưu thành" một bản mới.`;
  }
  return `Không đọc được nội dung: ${msg}`;
}
