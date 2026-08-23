/**
 * DANH MỤC CÁNH TAY — thứ người dùng "rút ra xài được ngay".
 * → docs/SPEC-arms.md §4e · §5c · §5h·1 · §11c
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐÂY LÀ DỮ LIỆU, KHÔNG PHẢI TÍNH NĂNG.                                    │
 * │                                                                          │
 * │ Một mục danh mục = **đường B (dán cấu hình MCP) với form điền sẵn**.      │
 * │ Cùng `McpServerConfig`, cùng đường chạy, cùng `probeArm`. Khác đúng một   │
 * │ chuyện: AI ĐIỀN CÁI FORM. ⇒ danh mục không làm được gì đường B không làm  │
 * │ được, và thêm một mục là thêm một object ở dưới — không phải viết code.   │
 * │                                                                          │
 * │ ⚠ TIÊU CHÍ 5 (§4d): mục nào TA CHƯA TỰ CHẠY ĐẦU-CUỐI thì KHÔNG được xuất │
 * │ hiện. Một mục hỏng tệ hơn không có mục nào, vì nó tiêu NIỀM TIN — thứ đắt │
 * │ nhất với người non-code. Nên hôm nay đúng MỘT mục, và ba mục còn lại của  │
 * │ v1 (Notion · GitHub · Google) vào đây khi từng cái chạy được thật.       │
 * │ Người dùng KHÔNG bị chặn trong lúc chờ: đường B nhận mọi server khác.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** Câu phụ trên thẻ nói CÁI GIÁ — người dùng chọn theo công sức, không theo tên. */
export type ArmPrice = 'none' | 'keys' | 'login';

export interface ArmSecretField {
  /**
   * TÊN BIẾN CHÍNH XÁC. Người dùng không bao giờ gõ chuỗi này — ta ship sẵn.
   *
   * Nó không suy được từ giao thức: MCP không công bố "tôi cần biến nào", vì đó
   * là yêu cầu lúc KHỞI ĐỘNG TIẾN TRÌNH, xảy ra TRƯỚC khi bắt tay. Sai tên ⇒
   * `status: 'failed'` — biết là hỏng, không biết vì sao. → SPEC-arms.md §5c
   */
  name: string;
  label: string;
  /** Lấy ở đâu. Thiếu câu này thì người non-code kẹt, và họ không biết hỏi ai. */
  help: string;
}

export interface CatalogArm {
  id: string;
  name: string;
  /**
   * Icon TRUNG TÍNH của ta, không phải logo bên thứ ba. → SPEC-arms.md §11c
   *
   * Không phải vì rủi ro cao — vì `brand` là một TRƯỜNG DỮ LIỆU, bật logo cho
   * từng hãng về sau là sửa một dòng. Ship neutral cả loạt thì danh mục trông
   * như MỘT HỆ, thay vì nửa logo nửa icon xám.
   */
  icon: string;
  blurb: string;
  price: ArmPrice;
  transport: 'stdio' | 'http';
  secrets: ArmSecretField[];
  /** Cánh tay cần một danh sách thư mục được phép. Đó CHÍNH LÀ allowlist. */
  folders?: { label: string; help: string };
  /**
   * Hồ sơ thương hiệu. Ô trống ⇒ KHÔNG có logo. Cấu trúc, không kỷ luật.
   * `checkedOn` rỗng nghĩa là **chưa ai đọc quy tắc của hãng đó**.
   */
  brand: { owner: string | null; guidelineUrl: string | null; checkedOn: string | null };
  build(input: { folders: string[] }): Record<string, unknown>;
}

/**
 * ⚠ GHIM PHIÊN BẢN, KHÔNG `@latest`. → SPEC-arms.md §11d
 *
 * `npx -y <gói>` tải và chạy mã của người lạ trên máy khách, với quyền của khách,
 * kèm chìa của khách. `@latest` nghĩa là bản cập nhật của người lạ chạy trên máy
 * khách mà không ai duyệt. Xuất hiện trong DANH MỤC CỦA TA thì lời cảnh báo
 * "code người lạ" không còn đủ — **chọn hộ khách là bảo đảm hộ khách**.
 */
const FILESYSTEM_PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

export const CATALOG: CatalogArm[] = [
  {
    id: 'files',
    name: 'File trên máy',
    icon: '📁',
    blurb: 'Đọc file và thư mục trên chính máy này — chỉ những thư mục bạn cho phép.',
    price: 'none',
    transport: 'stdio',
    secrets: [],
    folders: {
      label: 'Thư mục được phép',
      help: 'Nhân viên chỉ với tới được những thư mục trong danh sách này. Chọn đúng thứ cần, đừng chọn cả ổ đĩa.',
    },
    // Server tham chiếu của chính MCP ⇒ KHÔNG có thương hiệu bên thứ ba nào.
    // Đây là mục duy nhất trong danh mục v1 có rủi ro nhãn hiệu bằng 0.
    brand: { owner: null, guidelineUrl: null, checkedOn: null },
    build: ({ folders }) => ({
      command: 'npx',
      args: ['-y', FILESYSTEM_PKG, ...folders],
    }),
  },
];

export function findArm(id: string): CatalogArm | undefined {
  return CATALOG.find((a) => a.id === id);
}

/**
 * Thư mục mà một cấu hình cánh tay với tới được. Rỗng = không phải cánh tay file.
 *
 * Suy từ `args`: mọi tham số trông như một ĐƯỜNG DẪN TUYỆT ĐỐI. Cố ý không dò
 * tên gói — người dùng cắm một server filesystem khác qua đường "tự cắm" thì
 * luật trùng thư mục vẫn phải áp, và tên gói của họ ta không biết trước.
 *
 * ⚠ Nhận cả hai kiểu đường dẫn ở MỌI nền tảng (`D:\…` và `/home/…`), không dò
 * `process.platform`: một văn phòng zip từ máy khác hệ vẫn phải đọc đúng chuỗi
 * đã ghi trong `company.yaml`. Cùng lý do `SHELL_ALIASES` gửi cả hai tên.
 */
export function folderRoots(config: unknown): string[] {
  const args = (config as { args?: unknown })?.args;
  if (!Array.isArray(args)) return [];
  return args.filter(
    (a): a is string => typeof a === 'string' && (/^[a-zA-Z]:[\\/]/.test(a) || a.startsWith('/')),
  );
}

/** Chuẩn hoá để so: bỏ gạch chéo cuối, thống nhất `\`→`/`, bỏ phân biệt hoa thường. */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * `next` có bị một trong `existing` PHỦ SẴN không? Trả thư mục đụng nhau.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LUẬT (user chốt 23/08): TRONG MỘT VĂN PHÒNG, một thư mục chỉ được phủ    │
 * │ bởi ĐÚNG MỘT cánh tay. Khác văn phòng thì thoải mái — clone độc lập là   │
 * │ chủ ý.                                                                   │
 * │                                                                          │
 * │ Vì sao CHẶN chứ không cảnh báo: hai cánh tay phủ cùng một thư mục thì    │
 * │ văn phòng trả **2× token** cho đúng một năng lực, và nhân viên nhìn thấy │
 * │ hai bộ tool làm y hệt nhau — vừa tốn tiền vừa mời model chọn nhầm.       │
 * │                                                                          │
 * │ Và cái giá của việc chặn bằng KHÔNG: người thứ hai cần thư mục đó thì    │
 * │ **nối dây vào chính cái node đã có**. Một cánh tay phục vụ nhiều nhân    │
 * │ viên là chuyện bình thường — đó chính là lý do nó là NODE chứ không phải │
 * │ một thuộc tính của từng người.                                           │
 * │                                                                          │
 * │ "Phủ" gồm cả NẰM TRONG: đã cho `D:/Ho so` thì `D:/Ho so/2026` không thêm │
 * │ được gì. Chiều ngược lại (cái mới RỘNG hơn) KHÔNG chặn — đó là mở rộng   │
 * │ có chủ ý, và chặn nó là cấm người dùng nới quyền.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function coveredBy(
  existing: { id: string; folders: string[] }[],
  next: string[],
): { id: string; folder: string } | undefined {
  for (const want of next.map(norm)) {
    for (const e of existing) {
      for (const have of e.folders.map(norm)) {
        if (want === have || want.startsWith(`${have}/`)) return { id: e.id, folder: want };
      }
    }
  }
  return undefined;
}

/** Bản gửi lên giao diện — bỏ `build` (hàm không serialize được). */
export function catalogForUi() {
  return CATALOG.map(({ build: _build, ...rest }) => rest);
}
