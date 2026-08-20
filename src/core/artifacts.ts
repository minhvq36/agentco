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
const MAX_FILES = 500;

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
   */
  list(): ArtifactRecord[] {
    const out: ArtifactRecord[] = [];
    walk(this.paths.artifacts, '', 0, out);
    return out.sort((a, b) => b.mtime.localeCompare(a.mtime) || a.path.localeCompare(b.path));
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
}

function walk(root: string, rel: string, depth: number, out: ArtifactRecord[]): void {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
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
    if (!entry.isFile() || out.length >= MAX_FILES) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(root, childRel));
    } catch {
      continue; // biến mất giữa readdir và stat
    }
    const parts = childRel.split('/');
    const ext = path.extname(entry.name).slice(1).toLowerCase();
    out.push({
      path: `artifacts/${childRel}`,
      name: entry.name,
      ext,
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
      // `artifacts/<plan_id>/<task_id>/x.md` từ 19/08. File cũ nằm ở
      // `artifacts/<task_id>/x.md` — vẫn liệt kê được, chỉ không biết kế hoạch nào.
      plan_id: parts.length >= 3 ? (parts[0] ?? '') : '',
      task_id: parts.length >= 3 ? (parts[1] ?? '') : (parts[0] ?? ''),
      view: viewOf(ext),
    });
  }
}
