/**
 * KẾT QUẢ — file NHÂN VIÊN tạo ra. → docs/SPEC-artifacts.md
 *
 * Cột thứ ba, đứng cạnh hai cột đã có, và ba cột KHÁC NHAU ở chỗ AI GHI:
 *
 *   kho tri thức   agent tự rút ra   · vào prefix, trả tiền mỗi lượt
 *   tủ tài liệu    người dùng đưa vào · không vào prefix, tìm bằng Grep
 *   KẾT QUẢ        nhân viên làm ra   · không vào prefix, người dùng lấy về
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐÂY KHÔNG PHẢI TỦ TÀI LIỆU THỨ HAI, VÀ RANH GIỚI ĐÓ LÀ CÓ CHỦ Ý.        │
 * │                                                                          │
 * │ Không có đường nào từ giao diện đưa một kết quả trở lại làm đầu vào cho  │
 * │ nhân viên: không nút "gửi cái này cho nhân viên", không ô chọn artifact  │
 * │ làm input. Muốn dùng lại thì người dùng tự bàn giao — chép nội dung vào  │
 * │ ô chat, hoặc thả file vào tủ tài liệu.                                   │
 * │                                                                          │
 * │ Phân biệt với thứ VẪN ĐƯỢC PHÉP và không đổi: trong MỘT kế hoạch nhiều  │
 * │ bước, task sau đọc artifact của task trước qua `inputs`. Đó là dây nối   │
 * │ bên trong một việc, không phải một cái kho để lấy ra.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Không có `add()`. Không có editor. Người dùng XEM · TẢI VỀ · XOÁ.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { OfficePaths } from './paths.js';

/**
 * VIỆC DỞ DANG HIỆN RA NHƯ MỘT ĐẦU VÀO BÌNH THƯỜNG. → SPEC-artifacts.md §2.6
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO KHÔNG LÀM "TỰ NHẬN RA ĐÂY LÀ VIỆC CŨ" (user chốt 20/08 tối).      │
 * │                                                                          │
 * │ Để tự khớp một yêu cầu mới với một ca hỏng cũ, hệ thống phải đoán ba lần │
 * │ chồng nhau: *có phải cùng việc không* · *file cũ còn đúng không* · *task  │
 * │ nào ứng với task nào* (kế hoạch mới chia việc khác đi thì `task_id` không │
 * │ mang nghĩa gì qua hai lần chạy). Hai trong ba không quan sát được.        │
 * │                                                                          │
 * │ Và kiểu hỏng KHÔNG phải tốn tiền — mà là: nhân viên tách hợp đồng cũ ra   │
 * │ 12 điều khoản · người dùng thay `hd1.docx` bằng bản mới · hệ thống "thông │
 * │ minh" dùng lại 12 file cũ và trả về một checklist hoàn hảo, thuyết phục,  │
 * │ **nói về một hợp đồng đã không còn tồn tại.** Cùng gốc với luật *"kho tri │
 * │ thức không bao giờ chứa nội dung tài liệu"*: bản sao cũ THẮNG bản gốc.    │
 * │                                                                          │
 * │ ⇒ Không đoán "cùng một việc". Chỉ NÓI RA thứ đang nằm trên đĩa, kèm nhãn  │
 * │   ôi/tươi, rồi để đường lập kế hoạch bình thường quyết định — nó vốn đã   │
 * │   làm đúng việc đó mỗi ngày, và nó có trong tay câu người dùng vừa gõ.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * "Ôi" là thứ QUAN SÁT ĐƯỢC, không phải phỏng đoán: `plan.json` ghi rõ task nào
 * đọc file nào và ghi ra file nào, nên so `mtime` hai đầu là xong. Nguồn mới hơn
 * sản phẩm ⇒ sản phẩm đã ôi. 0 token, tất định.
 *
 * ⚠ So `>` chứ không `>=`: ghi xong trong cùng một giây là chuyện thường trên
 * đĩa, và đánh ôi nhầm thì mọi kết quả vừa sinh đều mang nhãn cảnh báo — người
 * dùng học cách bỏ qua nhãn đó, rồi bỏ qua luôn lần nó nói thật.
 */
export function isStale(artifactMtime: string, inputMtimes: readonly string[]): boolean {
  if (inputMtimes.length === 0) return false;
  const made = Date.parse(artifactMtime);
  if (!Number.isFinite(made)) return false;
  return inputMtimes.some((m) => {
    const src = Date.parse(m);
    return Number.isFinite(src) && src > made;
  });
}

export interface ArtifactRecord {
  /** Đường dẫn tương đối với thư mục văn phòng: `artifacts/<plan_id>/<task_id>/x.md`. */
  path: string;
  name: string;
  ext: string;
  bytes: number;
  mtime: string;
  /** Kế hoạch sinh ra nó. Rỗng với file cũ nằm thẳng dưới `artifacts/T-01/`. */
  plan_id: string;
  task_id: string;
  /** Xem thẳng trong trình duyệt được không, và bằng cách nào. → `viewOf` */
  view: ArtifactView;
}

/**
 * Cách xem một kết quả. Quyết theo ĐUÔI FILE, không theo nội dung.
 *
 * `office` là quyết định sản phẩm, không phải thiếu sót kỹ thuật: `extract.ts`
 * đã bóc được `.docx/.xlsx/.pptx` với 0 phụ thuộc, nên dựng preview cho chúng
 * là rẻ. Nhưng preview bóc-text của một file Word là một LỜI NÓI DỐI — mất
 * bảng, mất bố cục, mất ảnh. Ở tủ tài liệu, văn bản bóc ra là để `Grep` TÌM và
 * không ai nhìn nó; ở đây người dùng NHÌN để duyệt trước khi gửi cho khách.
 * Cùng một kỹ thuật, một chỗ đúng và một chỗ sai.
 */
export type ArtifactView =
  /** Văn bản thuần — hiện thẳng. */
  | 'text'
  /** Markdown — hiện có định dạng. */
  | 'markdown'
  /** Bảng — hiện thành bảng. */
  | 'csv'
  /** Cấu trúc — hiện có thụt lề, tô cú pháp. */
  | 'code'
  | 'image'
  | 'pdf'
  | 'video'
  /** Không xem được trong trình duyệt: tải về, mở bằng ứng dụng gốc. */
  | 'download';

const VIEW: Record<string, ArtifactView> = {
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  csv: 'csv',
  tsv: 'csv',
  json: 'code',
  yaml: 'code',
  yml: 'code',
  html: 'code',
  xml: 'code',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  /**
   * `.svg` CỐ Ý không phải `image`.
   *
   * SVG là XML và nó chạy được JavaScript. File này do MODEL sinh ra, còn
   * daemon phục vụ nó ở cùng origin với giao diện điều khiển công ty — thứ
   * không có xác thực nào ngoài "cùng máy". Hiện nó bằng `<img>` là mời nó
   * chạy trong nhà. Server cũng ép `application/octet-stream` cho đuôi này,
   * nên đặt `image` ở đây chỉ tạo ra một ô ảnh vỡ. → server.ts `RISKY`
   */
  svg: 'download',
  pdf: 'pdf',
  mp4: 'video',
  webm: 'video',
};

export function viewOf(ext: string): ArtifactView {
  return VIEW[ext.toLowerCase()] ?? 'download';
}

/** Kiểu MIME để trình duyệt tự hiển thị đúng. */
const MIME: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  html: 'text/html; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function mimeOf(ext: string): string {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Trần cho phần XEM TRƯỚC. Vượt trần thì vẫn tải về được, chỉ không hiện.
 *
 * `readArtifact` cũ không có trần nào: một `.csv` 50MB do nhân viên sinh ra sẽ
 * được nạp trọn vào bộ nhớ daemon rồi đẩy trọn sang trình duyệt. Không ai gặp
 * hôm nay vì mọi kết quả đều là markdown vài trăm byte — đó chính là lúc rẻ
 * nhất để đặt cái trần.
 */
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

/** Không duyệt sâu quá — thư mục kết quả phẳng, sâu hơn là dấu hiệu có gì đó lạ. */
const MAX_DEPTH = 4;

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HAI CÁI TRẦN KHÁC NHAU — TRƯỚC 02/09 CHÚNG LÀ MỘT, VÀ ĐÓ LÀ CẢ CÁI BUG.  │
 * │                                                                          │
 * │ Bản cũ: `walk()` dừng hẳn ở file thứ 500, rồi `list()` mới sắp theo       │
 * │ `mtime`. Sắp SAU khi đã cắt thì không cứu được gì — thứ rơi ra không      │
 * │ phải file cũ nhất mà là **file mà `readdir` chưa kịp đọc tới**.           │
 * │                                                                          │
 * │ Và trên NTFS `readdir` trả theo thứ tự tên, mà tên thư mục ca là          │
 * │ `P-260820-0314-…` — tức là theo NGÀY, cũ trước. Nên vượt 500 file thì     │
 * │ thứ biến mất là **những kết quả mới nhất**, đúng thứ người dùng đang tìm. │
 * │ Không một câu báo nào. (ext4 băm tên nên mất một nhóm ngẫu nhiên — khác   │
 * │ kiểu, cùng mức tệ.)                                                       │
 * │                                                                          │
 * │ Tách làm hai: quét HẾT rồi mới cắt, và cắt ở đúng chỗ cần cắt.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Trần HIỂN THỊ — payload gửi cho giao diện, cắt **sau khi đã sắp theo `mtime`**.
 *
 * Chỉ ngăn Kết quả dùng trần này. Bảng kê Trợ lý tự có trần riêng (5 ca / 600
 * token), còn `readablePaths` và `removeAll` thì **không được cắt** — xem `scan`.
 */
export const MAX_PANEL_FILES = 500;

/**
 * Trần QUÉT — việc duy nhất của nó là không để một thư mục bệnh hoạn treo daemon.
 *
 * Cao hơn hẳn trần hiển thị vì nó **không phải** thứ quyết định hiện gì: quét
 * 20 000 rồi cắt còn 500 mới-nhất là đúng; quét 500 rồi cắt là ca hỏng ở trên.
 * Chạm trần này thì `scan()` NÓI RA (`capped`), không im.
 */
const MAX_SCAN = 20_000;

export class ArtifactStore {
  constructor(private paths: OfficePaths) {}

  rebind(paths: OfficePaths): void {
    this.paths = paths;
  }

  /**
   * Quét thư mục thật mỗi lần đọc — không catalog, không watcher.
   *
   * Cùng lý do với tủ tài liệu (SPEC-library §9.1) và mạnh hơn ở đây: file này
   * do NHÂN VIÊN ghi trong lúc chạy, nên bất kỳ bản catalog nào cũng lỗi thời
   * ngay giữa một ca. `readdir` + `stat` vài mili giây thì luôn đúng.
   *
   * Mới nhất lên đầu: người dùng mở panel này ngay sau khi một việc vừa xong,
   * và thứ họ tìm gần như luôn là thứ vừa được tạo ra.
   *
   * KHÔNG cắt ở đây. Ba chỗ gọi cần cả danh sách — `readablePaths` (một đường
   * dẫn cũ người dùng dán vào vẫn phải tra được), `artifactManifest` (con số
   * tổng phải đúng), `removeAll` (xoá là xoá hết). Chỗ duy nhất cần cắt là
   * payload gửi giao diện, và nó cắt bằng `MAX_PANEL_FILES` sau khi đã sắp.
   */
  list(): ArtifactRecord[] {
    return this.scan().items;
  }

  /**
   * Một lượt quét, kèm SỰ THẬT VỀ CHÍNH LƯỢT QUÉT ĐÓ.
   *
   * ⚠ Sắp bằng so sánh chuỗi trần, không `localeCompare`: `mtime` là ISO-8601
   * UTC nên thứ tự byte CHÍNH LÀ thứ tự thời gian, và `localeCompare` (đối chiếu
   * theo locale) đắt hơn hàng chục lần trên vài nghìn bản ghi. Chỉ giữ
   * `localeCompare` cho nhánh hoà — nó hiếm, và nó cần ổn định giữa các lần chạy.
   *
   * Hoà `mtime` là ca THẬT: một ca ghi ba file trong cùng một mili giây. Không
   * có nhánh phụ thì thứ tự phụ thuộc vào `readdir`, tức là đổi theo hệ điều
   * hành — và một danh sách nhảy chỗ giữa hai lần mở là một danh sách người ta
   * không tin được nữa.
   */
  /**
   * CHỈ đường dẫn — không `stat`, không sắp xếp. → `walk`
   *
   * Cho hai chỗ không cần biết file to bao nhiêu hay sửa lúc nào:
   * `Office.readablePaths()` (chạy ở **mỗi tin nhắn**) và `removeAll()`.
   * Rẻ hơn `scan()` khoảng một bậc — xem số đo ở `walk`.
   */
  filePaths(): { items: string[]; capped: boolean } {
    const rels: string[] = [];
    walk(this.paths.artifacts, '', 0, rels);
    return { items: rels.map((r) => `artifacts/${r}`), capped: rels.length >= MAX_SCAN };
  }

  scan(): { items: ArtifactRecord[]; capped: boolean } {
    const rels: string[] = [];
    walk(this.paths.artifacts, '', 0, rels);
    const out: ArtifactRecord[] = [];
    for (const rel of rels) {
      const r = record(this.paths.artifacts, rel);
      if (r) out.push(r);
    }
    out.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : a.path.localeCompare(b.path)));
    // `>=` chứ không `>`: quét dừng ĐÚNG lúc chạm trần nên ta không biết còn
    // file nào nữa không. Câu chữ phía trên vì thế phải nói "từ 20 000 trở lên".
    //
    // Đếm trên `rels` chứ không trên `out`: một file biến mất giữa `readdir` và
    // `stat` làm `out` ngắn đi, mà đó không phải chuyện "chạm trần".
    return { items: out, capped: rels.length >= MAX_SCAN };
  }

  /** Đường dẫn tuyệt đối, hoặc `undefined` nếu không có / nằm ngoài thư mục kết quả. */
  resolve(rel: string): string | undefined {
    const norm = rel.replace(/\\/g, '/').replace(/^\.\//, '');
    // Chỉ nhận đường dẫn NẰM TRONG artifacts/. `safeJoin` chặn đi ra ngoài văn
    // phòng, nhưng bên trong văn phòng còn `roles/`, `office.yaml`, `charter.md`
    // — không có lý do gì một panel tên "Kết quả" đọc được chúng.
    if (!norm.startsWith('artifacts/') || norm.includes('..')) return undefined;
    // Thư mục ẩn: cùng lý do với `readArtifact` cũ — `.state/` nằm BÊN TRONG
    // văn phòng và nó giữ session id.
    if (norm.split('/').some((seg) => seg.startsWith('.'))) return undefined;

    const abs = path.join(this.paths.root, norm);
    // Chốt cuối bằng đường dẫn ĐÃ GIẢI: symlink có thể trỏ ra ngoài, và kiểm
    // chuỗi ở trên không nhìn thấy điều đó.
    const root = path.resolve(this.paths.artifacts);
    const real = path.resolve(abs);
    if (real !== root && !real.startsWith(root + path.sep)) return undefined;
    if (!fs.existsSync(real) || !fs.statSync(real).isFile()) return undefined;
    return real;
  }

  /**
   * Xoá hẳn một kết quả. MỘT mức, không có "lưu trữ".
   *
   * Cùng lý do với tủ tài liệu (SPEC-library §6): mức lưu trữ đẻ ra một cái kho
   * thứ hai cũng cần dọn. Khác một điểm quan trọng và giao diện phải nói ra:
   * tài liệu thì bản gốc còn trên máy người dùng, còn kết quả thì **đây là bản
   * duy nhất** — xoá là mất thứ đã trả tiền để làm ra.
   *
   * Dọn luôn thư mục rỗng còn lại: `artifacts/<plan_id>/T-01/` trống trơn nằm
   * lại chỉ để người dùng mở file explorer ra và tự hỏi nó là gì.
   */
  remove(rel: string): boolean {
    const abs = this.resolve(rel);
    if (!abs) return false;
    fs.rmSync(abs, { force: true });

    const root = path.resolve(this.paths.artifacts);
    let dir = path.dirname(abs);
    while (dir !== root && dir.startsWith(root + path.sep)) {
      try {
        if (fs.readdirSync(dir).length > 0) break;
        fs.rmdirSync(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
    return true;
  }

  /**
   * DỌN SẠCH ngăn Kết quả. Trả về SỐ FILE đã xoá.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ Vì sao có nút này, và vì sao CHỈ ở đây (user chốt 25/08):                │
   * │   *"chỉ áp dụng cho artifacts kết quả, không áp dụng cho tài liệu hay     │
   * │    kho tri thức"*                                                        │
   * │                                                                          │
   * │ Ranh giới là **DỰNG LẠI ĐƯỢC HAY KHÔNG**, đúng thước đã dùng cho nút xoá │
   * │ lẻ ngay trên:                                                            │
   * │   · kết quả    → chạy lại là ra. Mất TIỀN, không mất thứ không thay được.│
   * │   · tài liệu   → bản gốc trên máy người dùng, nhưng xoá hàng loạt kéo    │
   * │                  theo kinh nghiệm sống nhờ nó (`depends_on`) — một cú     │
   * │                  bấm phá hai kho.                                        │
   * │   · tri thức   → **không dựng lại được bằng tiền**. Không có nút nào.    │
   * │                                                                          │
   * │ Và kết quả mới là chỗ file dồn thành hàng chục sau vài ngày, tức chỗ duy │
   * │ nhất mà xoá-từng-cái là một việc vặt thật sự.                            │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ Xoá qua `remove()` từng file chứ không `rm -rf` cả thư mục: `resolve()` là
   * chỗ duy nhất biết luật "chỉ trong `artifacts/`, không thư mục ẩn, không đi
   * theo symlink ra ngoài". Một đường tắt ở đây là bản thứ hai của luật đó, và
   * bản thứ hai luôn là bản quên mất một điều kiện.
   */
  /**
   * ⚠ QUÉT LẠI CHO TỚI KHI SẠCH — không phải một lượt.
   *
   * Bản cũ chạy đúng một lượt `list()`, mà `list()` hồi đó cắt ở 500. Một ngăn
   * Kết quả 700 file thì *"dọn sạch"* xoá 500, trả về `500`, và giao diện báo
   * thành công trong khi 200 file vẫn nằm đó. Cùng lớp lỗi với cuốn sổ chi phí
   * hôm qua: **xoá là phải xoá hết, hoặc nói ra là chưa hết.**
   *
   * Trần vòng lặp để một file không xoá nổi (đang bị khoá, quyền sai) không
   * biến hàm này thành vòng lặp vô tận — hết vòng mà vẫn còn thì trả về số đã
   * xoá được, và lượt quét sau vẫn thấy phần còn lại.
   */
  removeAll(): number {
    let n = 0;
    for (let round = 0; round < 10; round++) {
      // `filePaths()` chứ không `scan()`: xoá thì không cần biết file to bao nhiêu.
      const items = this.filePaths().items;
      if (items.length === 0) break;
      let removed = 0;
      for (const p of items) if (this.remove(p)) removed++;
      n += removed;
      if (removed === 0) break; // không xoá nổi cái nào nữa — dừng, đừng quay vòng
    }
    return n;
  }
}

/**
 * MỘT bộ duyệt duy nhất, và nó KHÔNG `stat`. → `ArtifactStore.paths` · `§scan`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `stat` LÀ TOÀN BỘ CHI PHÍ, VÀ PHẦN LỚN CHỖ GỌI KHÔNG CẦN NÓ.             │
 * │                                                                          │
 * │ Đo trên máy user (Windows, 02/09) — `readdir` + `stat` từng file:        │
 * │     500 file →  51 ms  ·  2 000 → 230 ms  ·  5 000 → 493 ms              │
 * │ tức ~0,1 ms mỗi file, gần như toàn bộ nằm ở `statSync`.                   │
 * │                                                                          │
 * │ Nhưng `readablePaths()` — chạy ở MỖI tin nhắn người dùng gõ — chỉ cần     │
 * │ chuỗi đường dẫn. `removeAll()` cũng vậy. Bắt hai chỗ đó trả tiền `stat`   │
 * │ cho `bytes`/`mtime` mà chúng vứt đi ngay là mua một cái nút cổ chai ở     │
 * │ đúng đường đi nóng nhất.                                                 │
 * │                                                                          │
 * │ Nên: duyệt (rẻ) tách khỏi `stat` (đắt). Một bộ luật đi đường — độ sâu,    │
 * │ bỏ thư mục ẩn, trần quét — nằm đúng một chỗ, không có bản thứ hai để      │
 * │ quên mất một điều kiện.                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function walk(root: string, rel: string, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH || out.length >= MAX_SCAN) return;
  const dir = rel ? path.join(root, rel) : root;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // chưa có thư mục artifacts/ — văn phòng chưa chạy việc nào
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(root, childRel, depth + 1, out);
      continue;
    }
    if (!entry.isFile() || out.length >= MAX_SCAN) continue;
    out.push(childRel);
  }
}

/** `stat` đúng một file, gắn vào phần suy được từ chính đường dẫn. */
function record(root: string, childRel: string): ArtifactRecord | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(path.join(root, childRel));
  } catch {
    return undefined; // biến mất giữa readdir và stat
  }
  const parts = childRel.split('/');
  const name = parts[parts.length - 1] ?? childRel;
  const ext = path.extname(name).slice(1).toLowerCase();
  return {
    path: `artifacts/${childRel}`,
    name,
    ext,
    bytes: stat.size,
    mtime: stat.mtime.toISOString(),
    // `artifacts/<plan_id>/<task_id>/x.md` từ 19/08. File cũ nằm ở
    // `artifacts/<task_id>/x.md` — vẫn liệt kê được, chỉ không biết kế hoạch nào.
    plan_id: parts.length >= 3 ? (parts[0] ?? '') : '',
    task_id: parts.length >= 3 ? (parts[1] ?? '') : (parts[0] ?? ''),
    view: viewOf(ext),
  };
}
