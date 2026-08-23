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

/** Bản gửi lên giao diện — bỏ `build` (hàm không serialize được). */
export function catalogForUi() {
  return CATALOG.map(({ build: _build, ...rest }) => rest);
}
