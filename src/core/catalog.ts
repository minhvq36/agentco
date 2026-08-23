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
/** Chính chủ Notion phát hành — khác hẳn một gói cộng đồng, và UI phải nói ra. */
const NOTION_PKG = '@notionhq/notion-mcp-server@2.5.1';

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
  {
    id: 'notion',
    name: 'Notion',
    icon: '📝',
    blurb: 'Tìm, đọc và cập nhật trang trong không gian Notion của bạn.',
    price: 'keys',
    transport: 'stdio',
    secrets: [
      {
        // ⚠ TÊN NÀY PHẢI KHỚP CHÍNH XÁC, và nó KHÔNG suy được từ giao thức: MCP
        // không công bố "tôi cần biến nào" vì đó là yêu cầu lúc KHỞI ĐỘNG TIẾN
        // TRÌNH, xảy ra TRƯỚC khi bắt tay. Sai tên ⇒ `status: 'failed'` — biết
        // là hỏng, không biết vì sao. Đó là lý do danh mục ship sẵn nó.
        name: 'NOTION_TOKEN',
        label: 'Token tích hợp Notion',
        help:
          'Notion → Settings → Connections → Develop your own integration → tạo mới → copy "Internal Integration Secret". ' +
          'Rồi MỞ TRANG bạn muốn cho đọc → menu ··· → Connections → thêm tích hợp vừa tạo.',
      },
    ],
    // ❓ `checkedOn: null` = CHƯA ai đọc quy tắc thương hiệu của Notion. Ô trống
    // nghĩa là KHÔNG dùng logo — cấu trúc, không phải kỷ luật. → SPEC-arms §11c
    brand: { owner: 'Notion Labs, Inc.', guidelineUrl: null, checkedOn: null },
    build: () => ({ command: 'npx', args: ['-y', NOTION_PKG] }),
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
 * `next` có TRÙNG KHÍT thư mục nào trong `existing` không?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LUẬT (user chốt 23/08): TRONG MỘT VĂN PHÒNG, hai cánh tay không được trỏ │
 * │ vào **ĐÚNG CÙNG MỘT** thư mục. Khác văn phòng thì thoải mái — clone độc  │
 * │ lập là chủ ý.                                                            │
 * │                                                                          │
 * │ Vì sao chặn ca trùng khít: nó là **nhân đôi thuần** — hai bộ tool y hệt  │
 * │ nhau, văn phòng trả 2× token cho đúng một năng lực, và model có hai       │
 * │ đường làm cùng một việc. Không có lý do nào để muốn nó.                   │
 * │                                                                          │
 * │ Cách đi tiếp thì miễn phí: người thứ hai cần thư mục đó thì **nối dây     │
 * │ vào chính node đã có**. Một cánh tay phục vụ nhiều nhân viên là chuyện    │
 * │ bình thường — đó chính là lý do nó là NODE chứ không phải thuộc tính.     │
 * │                                                                          │
 * │ ⚠ BẢN ĐẦU CÒN CHẶN "THƯ MỤC CON", VÀ ĐÃ GỠ (user bác, và bác đúng).      │
 * │                                                                          │
 * │ Lý lẽ cũ: *"`D:/Ho so/2026` nằm trong `D:/Ho so` nên không thêm gì"*.     │
 * │ Sai hai lần:                                                             │
 * │                                                                          │
 * │  1. Nó THÊM THẬT — một cánh tay hẹp là **đặc quyền tối thiểu**: nhân      │
 * │     viên A chỉ với tới `2026`, nhân viên B với tới cả kho. Và nó giúp     │
 * │     model đỡ mò trong một cây thư mục to.                                │
 * │  2. Nó BẤT ĐỐI XỨNG THEO THỨ TỰ TẠO. Cấu hình cuối cùng y hệt nhau, chỉ  │
 * │     khác ai được cắm trước — mà thứ tự thao tác không phải một tính chất  │
 * │     của thiết kế.                                                        │
 * │                                                                          │
 * │ Chồng lấn VẪN tốn token thật. Nhưng đó là **cái giá người dùng chọn**,   │
 * │ và luật đã chốt cho đúng loại câu hỏi này là *hiện giá, đừng chặn*        │
 * │ (§9b — bỏ trần 2 000). Áp lần thứ hai, cùng một lý do.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function coveredBy(
  existing: { id: string; folders: string[] }[],
  next: string[],
): { id: string; folder: string } | undefined {
  for (const want of next.map(norm)) {
    for (const e of existing) {
      for (const have of e.folders.map(norm)) {
        if (want === have) return { id: e.id, folder: want };
      }
    }
  }
  return undefined;
}

/**
 * Gốc này có nuốt trọn thư mục VĂN PHÒNG (hoặc CÔNG TY) không?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CHẶN, và lý do thứ hai NẶNG HƠN lý do thứ nhất.                          │
 * │                                                                          │
 * │ 1. THỪA: `Read`/`Write`/`Glob`/`Grep` đã đọc-ghi tự do trong thư mục văn │
 * │    phòng (đó là `cwd`). Cắm một cánh tay lên chính chỗ đó là trả ~2 200  │
 * │    token MỖI LƯỢT để mua một năng lực đang có sẵn, miễn phí.             │
 * │                                                                          │
 * │ 2. 🔴 NÓ ĐI VÒNG QUA HÀNG RÀO `.state/`. `paths.ts §guardedZone` chặn    │
 * │    đọc kho chìa và ghi file cấu hình — nhưng hook chỉ khớp tool BUILTIN  │
 * │    (`Read|Grep|Glob|Write|Edit`). Tool của MCP mang tên `mcp__x__read_   │
 * │    file`, KHÔNG khớp. ⇒ một cánh tay trỏ vào thư mục văn phòng mở lại    │
 * │    đúng hai cái lỗ vừa vá sáng nay, qua một cửa khác.                    │
 * │                                                                          │
 * │ Đây là bản vá HẸP cho một lỗ RỘNG hơn: mọi MCP filesystem trỏ vào bất kỳ │
 * │ đâu chứa `.state/` đều đi vòng qua được. Lỗ rộng phải vá bằng cách mở    │
 * │ matcher của hook sang `mcp__*` — đã ghi vào SPEC-arms §5f, CHƯA làm, và  │
 * │ chưa ai đo là matcher đó có khớp không. Đừng đọc chốt này thành "đã an   │
 * │ toàn": nó đóng con đường DỄ ĐI NHẤT, không đóng cả lớp.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function swallowsOffice(root: string, officeDir: string, companyDir: string): boolean {
  const r = norm(root);
  return [officeDir, companyDir].some((d) => {
    const n = norm(d);
    return n === r || n.startsWith(`${r}/`);
  });
}

/** Bản gửi lên giao diện — bỏ `build` (hàm không serialize được). */
export function catalogForUi() {
  return CATALOG.map(({ build: _build, ...rest }) => rest);
}
