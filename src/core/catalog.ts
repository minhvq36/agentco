import { createHash } from 'node:crypto';

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

/**
 * Cách dựng cấu hình MCP — **dữ liệu thuần**, không hàm, không tên hãng.
 *
 * Đúng hai hình dạng, vì giao thức có đúng hai (§2: stdio + Streamable HTTP;
 * SSE nhận vào để tương thích nhưng **không bao giờ đề xuất**, nên nó không có
 * chỗ ở đây — ai cần thì dán config tay qua đường B).
 */
export type ArmSpec =
  | {
      kind: 'stdio';
      command: string;
      args: string[];
      /**
       * Nối danh sách thư mục người dùng chọn vào cuối `args`.
       *
       * Đây là **toàn bộ** phần "tuỳ biến theo hãng" mà hàm `build` cũ tồn tại
       * để làm — một cờ boolean. Đáng để nhớ khi có người muốn thêm hàm trở lại.
       */
      appendFolders?: boolean;
    }
  | {
      kind: 'http';
      url: string;
      /**
       * Ô trống `${TÊN_CHÌA}` được `injectSecrets` thay lúc dựng server.
       * → `core/secrets.ts`. Chuỗi ở đây là thứ người dùng ĐỌC ĐƯỢC trong
       * `company.yaml`; giá trị thật không bao giờ nằm trong file này.
       */
      headers?: Record<string, string>;
    };

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ô TRỐNG ĐẶC BIỆT `${OAUTH}` — CHỖ CỦA "TÀI KHOẢN CỦA CHÍNH CÁNH TAY NÀY".│
 * │                                                                          │
 * │ Danh mục là **dữ liệu tĩnh**, mà tên chìa OAuth thì **sinh lúc đăng nhập**│
 * │ (`NOTION_OAUTH_<8 hex workspace_id>` — xem `oauth.ts §accountName`). Hai  │
 * │ điều đó chỉ gặp nhau ở một chỗ: mục danh mục viết một **chỗ trống có tên  │
 * │ quy ước**, và `buildConfig` điền tên tài khoản thật vào lúc cắm.          │
 * │                                                                          │
 * │ Vì sao không để danh mục ghi thẳng `${NOTION_ACCESS_TOKEN}` như trước:    │
 * │ **hai workspace Notion dùng chung một tên chìa ⇒ chung một băm ⇒ gộp làm  │
 * │ một cánh tay.** §6i cảnh báo đúng ca đó từ 23/08.                         │
 * │                                                                          │
 * │ Sau khi thay xong, chuỗi trong `company.yaml` là một ô trống BÌNH THƯỜNG  │
 * │ (`${NOTION_OAUTH_A1B2C3D4}`) — `injectSecrets` không cần biết OAuth tồn   │
 * │ tại. Một quy ước ở đúng một hàm, 0 nhánh mới ở hạ nguồn.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const OAUTH_SLOT = '${OAUTH}';

/** MỘT hàm dựng cho mọi mục. Thêm hãng = thêm dữ liệu, không thêm nhánh. */
export function buildConfig(
  spec: ArmSpec,
  input: { folders: string[]; account?: string },
): Record<string, unknown> {
  if (spec.kind === 'http') {
    let headers = spec.headers;
    if (headers && input.account) {
      const slot = `\${${input.account}}`;
      headers = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k, v.split(OAUTH_SLOT).join(slot)]),
      );
    }
    return { type: 'http', url: spec.url, ...(headers ? { headers } : {}) };
  }
  return {
    command: spec.command,
    args: spec.appendFolders ? [...spec.args, ...input.folders] : [...spec.args],
  };
}

/** Mục này cần đăng nhập chứ không cần gõ chìa? Suy từ `spec`, không khai lại. */
export function needsOAuth(a: CatalogArm): boolean {
  return a.spec.kind === 'http' && JSON.stringify(a.spec.headers ?? {}).includes(OAUTH_SLOT);
}

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
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CẤU HÌNH LÀ DỮ LIỆU, KHÔNG PHẢI HÀM. (user chốt 25/08)                   │
   * │                                                                          │
   * │ Bản trước: mỗi mục có `build(input) => config` — tức **một hàm cho mỗi   │
   * │ hãng**. Nó nhỏ, nhưng nó là chỗ mà "thêm provider" bắt đầu có nghĩa là   │
   * │ "viết code", và từ đó tới `notion.ts` · `slack.ts` · `gmail.ts` là một   │
   * │ con dốc không có bậc nào để dừng.                                        │
   * │                                                                          │
   * │ Nay: **một** `buildConfig()` dùng chung, mỗi hãng là một object thuần.   │
   * │ Hệ quả không hiển nhiên nhưng quan trọng: danh mục giờ **tuần tự hoá     │
   * │ được** — chuyển sang JSON, tải từ xa, hay để người dùng tự thêm một mục  │
   * │ đều KHÔNG cần đổi một dòng mã nào. Đó là §5h·1 được trả công lần thứ ba. │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  spec: ArmSpec;
  secrets: ArmSecretField[];
  /** Cánh tay cần một danh sách thư mục được phép. Đó CHÍNH LÀ allowlist. */
  folders?: { label: string; help: string };
  /**
   * Hồ sơ thương hiệu. Ô trống ⇒ KHÔNG có logo. Cấu trúc, không kỷ luật.
   * `checkedOn` rỗng nghĩa là **chưa ai đọc quy tắc của hãng đó**.
   */
  brand: { owner: string | null; guidelineUrl: string | null; checkedOn: string | null };
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CHỈ ĐỌC = MỘT CỜ, KHÔNG PHẢI MỘT DANH SÁCH TÊN TOOL. (user bắt 25/08)    │
   * │                                                                          │
   * │ 🔴 Bản đầu ghi thẳng 14 tên `notion-*` vào file này. User chỉ ra ngay:   │
   * │ *"chúng ta phải tự viết code để pick từng tool… sau này nhiều provider   │
   * │ nữa?"* — đúng, và tệ hơn thế: **tôi đã ĐO ra thứ làm nó thừa** rồi vẫn   │
   * │ gõ tay. Số đo 25/08: **28/28 tool Notion đều khai `annotations`**.       │
   * │                                                                          │
   * │ ⇒ "Chỉ đọc" là thứ **HỎI RA ĐƯỢC LÚC BẮT TAY**, không phải thứ phải      │
   * │ liệt kê. `probe.ts §levelOf` đã làm đúng phép suy đó từ 23/08 — kể cả    │
   * │ luật MẶC ĐỊNH TỪ CHỐI: không khai `readOnly` ⇒ xếp `write_external`,     │
   * │ **vắng mặt không phải tín hiệu an toàn**.                                │
   * │                                                                          │
   * │ Cờ này bật thì lúc CẮM, `addArm` chạy probe, lọc `level === 'read'`, và  │
   * │ ghi danh sách đã giải vào `arms[băm].tools` trong `company.yaml`. Ba thứ │
   * │ được cùng lúc:                                                           │
   * │   · **0 tên tool trong mã** — thêm hãng vẫn là thêm dữ liệu              │
   * │   · chạy cho **mọi** server, kể cả MCP cộng đồng ta chưa từng nghe tên   │
   * │   · danh sách nằm trong `company.yaml` ⇒ người dùng **kiểm tra được**    │
   * │                                                                          │
   * │ Vẫn giữ tính chất của bản gõ tay: danh sách là **ảnh chụp lúc cắm**, nên │
   * │ hãng thêm việc GHI về sau **không tự lọt vào**. Khác đúng một chỗ: nó là │
   * │ ảnh chụp **đo được**, không phải ảnh chụp gõ tay — nên nó cũng không lỗi │
   * │ thời theo chiều ngược (hãng đổi tên một việc ĐỌC thì bản gõ tay im lặng  │
   * │ mất việc đó, bản này thì không).                                         │
   * │                                                                          │
   * │ ⚠ KHÔNG PHÁ CHỐT "duyệt theo cả server" (user 24/08): chốt đó nói **AI** │
   * │ được dùng — vẫn là sợi dây. Cờ này nói cánh tay đó **LÀ GÌ**.            │
   * │                                                                          │
   * │ ⚠ Nó cắt QUYỀN GỌI, **không** cắt token: schema cả 28 việc vẫn do server │
   * │ trả về. Thứ cắt token là `ToolSearch` (worker.ts). Hai lá chắn khác nhau │
   * │ — đừng tưởng cái này mua được cái kia. → SPEC-arms §9b                   │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  readOnly?: boolean;
  /**
   * Cho người dùng chọn **nấc quyền** lúc cắm (Chỉ đọc / +Thêm / Toàn quyền).
   * → `probe.ts §tierOf` · docs/SPEC-arms.md §6j
   *
   * Thay `readOnly` với những mục hỗ trợ cả ba nấc. Giữ `readOnly` cho mục nào
   * ta cố ý **không** cho nâng — nhưng hôm nay không còn mục nào như thế, và một
   * mục "chỉ đọc cứng" nên là một quyết định có lý do viết ra, không phải mặc định.
   */
  tiered?: boolean;
}

/** Giao diện nói "stdio hay http" bằng tiếng người — suy từ `spec`, không khai lại. */
export function transportOf(a: CatalogArm): 'stdio' | 'http' {
  return a.spec.kind;
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

/**
 * ⚠ Notion KHÔNG còn ở đây, và sự vắng mặt đó là một quyết định. (25/08)
 *
 * Bản cũ ghim `@notionhq/notion-mcp-server@2.5.1` — gói **local, chính chủ**.
 * Nhưng chính chủ đã buông nó: 🌐 *"We may sunset this local MCP server
 * repository"* + *"issues and pull requests here are not actively monitored"*.
 *
 * ⇒ Bài học đáng giữ cho mọi mục về sau: **ghim phiên bản ≠ được bảo trì.**
 * §11d ghim để mã người lạ không tự đổi dưới chân khách; nó không cứu được ta
 * khỏi việc đóng băng một thứ không còn ai vá lỗi. Notion nay đi đường HTTP
 * hosted (xem `build` bên dưới) — 0 gói, 0 rủi ro chuỗi cung ứng.
 */

export const CATALOG: CatalogArm[] = [
  {
    id: 'files',
    name: 'File trên máy',
    icon: '📁',
    blurb: 'Đọc file và thư mục trên chính máy này — chỉ những thư mục bạn cho phép.',
    price: 'none',
    spec: { kind: 'stdio', command: 'npx', args: ['-y', FILESYSTEM_PKG], appendFolders: true },
    secrets: [],
    folders: {
      label: 'Thư mục được phép',
      help: 'Nhân viên chỉ với tới được những thư mục trong danh sách này. Chọn đúng thứ cần, đừng chọn cả ổ đĩa.',
    },
    // Server tham chiếu của chính MCP ⇒ KHÔNG có thương hiệu bên thứ ba nào.
    // Đây là mục duy nhất trong danh mục v1 có rủi ro nhãn hiệu bằng 0.
    brand: { owner: null, guidelineUrl: null, checkedOn: null },
  },
  {
    id: 'notion',
    name: 'Notion',
    icon: '📝',
    /**
     * ⚠ CÂU NÀY PHẢI NÓI RA BÁN KÍNH, và nó nói ngược với trực giác. → §5h·3
     *
     * OAuth của Notion **thừa kế TOÀN BỘ quyền của người đăng nhập**: 🌐
     * *"MCP tools act with your full Notion permissions"*, và metadata khai
     * `scopes_supported: ["default"]` — **một** scope, không chia nhỏ được.
     *
     * Tức nó **RỘNG HƠN** token tĩnh, thứ mặc định không thấy gì cho tới khi
     * người dùng tự thêm connection vào từng trang. Giấu chuyện này đi là
     * **hứa quá tay**, và §11a-bis đã chốt: *doạ quá tay làm người dùng tắt
     * thứ họ cần; hứa quá tay làm họ bật để mua một thứ không tồn tại — cái
     * sau tệ hơn*. "chỉ đọc" ở đây là do TA cắt (`tools` bên dưới), không phải
     * do Notion cấp hẹp.
     */
    blurb: 'Tìm, đọc và (nếu bạn cho phép) ghi vào các trang Notion mà tài khoản của bạn xem được.',
    price: 'login',
    /**
     * MCP **hosted chính chủ**, Streamable HTTP. Ba thứ nó bỏ so với bản cũ
     * (`npx @notionhq/notion-mcp-server`): không tải mã người lạ về máy khách
     * (rủi ro chuỗi cung ứng §11d = **0**), không `npx` trên đường nóng, và
     * không phụ thuộc một gói mà chính chủ ghi *"may sunset this repository"*.
     *
     * ⚠ `${OAUTH}` là **chỗ trống có tên quy ước**, không phải tên chìa thật.
     * `buildConfig` thay nó bằng tên tài khoản người dùng vừa đăng nhập
     * (`NOTION_OAUTH_<8 hex workspace_id>`) — nhờ đó **hai workspace Notion ra
     * hai băm khác nhau** dù cùng URL. → §OAUTH_SLOT · `oauth.ts §accountName`
     *
     * Sau khi thay, `company.yaml` chứa một ô trống bình thường: người dùng ĐỌC
     * ĐƯỢC chìa đi vào đâu mà không đọc được chìa. → `secrets.ts §injectSecrets`
     */
    spec: {
      kind: 'http',
      url: 'https://mcp.notion.com/mcp',
      headers: { Authorization: 'Bearer ${OAUTH}' },
    },
    /**
     * Ba nấc, giải từ `annotations` lúc cắm. Đo 25/08: 28 việc — **14 đọc · 11
     * thêm · 3 sửa/xoá**, và 28/28 đều khai annotations.
     *
     * ⚠ Thay cho `readOnly: true` của bản 25/08. Bản đó đúng nhưng **cứng**:
     * người dùng muốn Notion ghi được thì không có đường nào ngoài sửa yaml —
     * một **chuông báo §6a**. Nấc là thứ họ chọn, và nó vào băm nên "đổi nấc"
     * là một cánh tay khác chứ không phải một lần sửa tại chỗ. → §6j
     */
    tiered: true,
    /**
     * RỖNG — và đó là toàn bộ điểm của `price: 'login'`.
     *
     * Chìa của mục này **sinh ra từ luồng đăng nhập**, không do người dùng gõ.
     * Tên nó cũng không biết trước được (nó mang `workspace_id`), nên khai ở đây
     * là khai một chuỗi sẽ sai. Bản 25/08 có một ô dán tay kèm hướng dẫn *"chạy
     * spike rồi copy access_token"* — nó tồn tại để bài 12 chạy được NGAY, và
     * đúng như đã ghi lúc đó: **không phải để ở lại**.
     */
    secrets: [],
    // ❓ `checkedOn: null` = CHƯA ai đọc quy tắc thương hiệu của Notion. Ô trống
    // nghĩa là KHÔNG dùng logo — cấu trúc, không phải kỷ luật. → SPEC-arms §11c
    brand: { owner: 'Notion Labs, Inc.', guidelineUrl: null, checkedOn: null },
  },
];

export function findArm(id: string): CatalogArm | undefined {
  return CATALOG.find((a) => a.id === id);
}

/**
 * DANH TÍNH của một cánh tay = BĂM(cấu hình + tên chìa). → docs/SPEC-arms.md §6i
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO BĂM CHỨ KHÔNG PHẢI TÊN NGƯỜI DÙNG ĐẶT (user chốt 23/08)           │
 * │                                                                          │
 * │ Bản trước lấy `id` do người dùng gõ làm khoá, tức MỘT chuỗi gánh hai vai:│
 * │ danh tính và nhãn hiển thị. Mọi triệu chứng đều từ đó — cất đi rồi tạo   │
 * │ lại cùng thư mục không bắt được · danh sách "đã cắm ở nơi khác" nở ra    │
 * │ một mớ gần giống nhau · cùng cấu hình khác tên thành hai thứ · và đổi    │
 * │ tên thì phải ĐỔI KHOÁ, kéo theo viết lại `mcp:` trong mọi roles/*.yaml.  │
 * │                                                                          │
 * │ Tách ra: **băm là danh tính** (bất biến, máy sinh), **nhãn là tên** (đổi │
 * │ tự do, không ai phụ thuộc). Cùng cấu hình ⇒ cùng băm ⇒ trùng lặp là      │
 * │ chuyện KHÔNG THỂ XẢY RA, chứ không phải chuyện phải nhớ đi kiểm.         │
 * │                                                                          │
 * │ ⚠ TÊN CHÌA PHẢI VÀO BĂM. Hai không gian Notion khác nhau có `args` y hệt │
 * │ và chỉ khác `NOTION_TOKEN` vs `NOTION_TOKEN_B`. Băm mỗi cấu hình là gộp  │
 * │ hai workspace thành một — hỏng im lặng, ở đúng chỗ đắt nhất.             │
 * │                                                                          │
 * │ ⚠⚠ BĂM KHÔNG THAY ĐƯỢC PHÉP KIỂM ĐƯỜNG DẪN, và đây là chỗ dễ tưởng nhầm:│
 * │ ngày ta bump phiên bản gói trong danh mục, CÙNG một thư mục ra băm KHÁC  │
 * │ ⇒ tạo được cánh tay thứ hai trỏ đúng chỗ cũ ⇒ luật "một đường dẫn một    │
 * │ cánh tay" thủng im lặng. Hai phép kiểm canh hai chuyện khác nhau:        │
 * │                                                                          │
 * │    băm        "cấu hình y hệt này đã biết chưa"   → phạm vi CÔNG TY      │
 * │    đường dẫn  "văn phòng này đã với tới đó chưa"  → phạm vi VĂN PHÒNG    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `JSON.stringify` với khoá đã SẮP XẾP: cùng một cấu hình viết khác thứ tự
 * khoá vẫn phải ra cùng một băm, nếu không thì "trùng lặp không thể xảy ra"
 * lại thành "trùng lặp xảy ra khi gõ khác thứ tự".
 */
export function armHash(
  config: unknown,
  secretNames: readonly string[] = [],
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠⚠ NẤC QUYỀN PHẢI VÀO BĂM — và lý do MẠNH NHẤT không phải chống đụng độ. │
   * │                                                                          │
   * │ User nhấn mạnh 25/08: *"Đổi mức quyền ở văn phòng này KHÔNG đổi ở văn     │
   * │ phòng khác, quan trọng."* Nấc nằm trong băm ⇒ đổi nấc = **một cánh tay    │
   * │ khác** ⇒ `role.mcp` và `office.arms` của văn phòng kia vẫn trỏ băm cũ ⇒   │
   * │ **không đụng tới, không cần một dòng mã nào canh chuyện đó**.             │
   * │                                                                          │
   * │ Nếu nấc là một trường sửa tại chỗ trong sổ chung thì ngược hẳn: một cú    │
   * │ bấm ở văn phòng A **âm thầm nâng quyền** cho mọi văn phòng dùng chung.    │
   * │ Bị loại bởi **cấu trúc**, không bởi kỷ luật.                              │
   * │                                                                          │
   * │ Và vế chống đụng độ vẫn đúng: cùng URL + cùng chìa + khác nấc mà chung    │
   * │ băm là **ghi đè im lặng** — đúng ca §6i sinh ra để chặn.                  │
   * │                                                                          │
   * │ ⚠ RÁC CÓ TRẦN: A→B→A rơi về **đúng băm cũ** (đã ở trong sổ ⇒ `addArm`    │
   * │ dùng lại). Tối đa **3** mục cho một (cấu hình + chìa) — bằng số nấc.      │
   * │                                                                          │
   * │ ⚠ `undefined` KHÔNG được đi vào hạt giống băm: mọi cánh tay đã tạo trước  │
   * │ 26/08 phải giữ **nguyên băm cũ**, nếu không cả `company.yaml` mồ côi sau  │
   * │ một lần nâng cấp. `JSON.stringify` bỏ khoá `undefined` — đó là hành vi ta │
   * │ đang DỰA VÀO, không phải may mắn. Có test canh.                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  level?: string,
): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, stable(val)]),
      );
    }
    return v;
  };
  const seed = JSON.stringify({ c: stable(config), s: [...secretNames].sort(), l: level });
  return `a${createHash('sha256').update(seed).digest('hex').slice(0, 10)}`;
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

/**
 * ⚠ `armKeys` ĐÃ BỎ (26/08) — đừng dựng lại. Nó đổi khoá `mcpServers` từ băm
 * sang slug của nhãn, để model phân biệt được hai cánh tay cùng loại.
 *
 * User bác, và bác đúng: cầu nối ở **dòng danh bạ** (`assistant.ts §armReach`)
 * vẫn cần trong MỌI trường hợp (nhãn phi-Latin ra slug rỗng · nhãn trùng thì cả
 * hai phải về băm), nên slug chỉ là tối ưu **một phần** chồng lên một cơ chế đã
 * đủ. Đổi lại nó đẻ ra ba điểm quy đổi, và cái đầu (`armGrants`) hỏng theo chiều
 * **cấp thừa quyền**. Chi tiết: `worker.ts` chỗ dựng `mcpServers`.
 *
 * > *"tên là cái nhà, băm là địa chỉ nhà"* — user, 26/08. Địa chỉ là thứ để
 * > định tuyến; cái tên là thứ để gọi. Cuốn danh bạ nối hai thứ đó lại, và nó
 * > không cần đổi địa chỉ để làm việc ấy.
 */

/**
 * TÊN NGƯỜI DÙNG GÕ → THƯ MỤC THẬT của một cánh tay. → `paths.ts §resolveInput`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ca sinh ra nó (26/08): user gõ *"liệt kê bài hát trong Musics"*, Trợ lý   │
 * │ chép `"Musics"` vào `inputs`, và kế hoạch bị chặn vì không có file tên    │
 * │ đó — trong khi cánh tay **Musics** trỏ thẳng vào `D:\…\Musics`.           │
 * │                                                                          │
 * │ HAI khoá cho mỗi cánh tay, vì người dùng gọi nó bằng cả hai kiểu:         │
 * │   · **nhãn** — thứ họ thấy trên sơ đồ (`Musics`)                          │
 * │   · **tên lá của thư mục** — thứ họ thấy trong Explorer                   │
 * │ Chúng thường trùng nhau, nhưng nhãn đổi tự do được, nên không phải luôn.  │
 * │                                                                          │
 * │ ⚠ Cánh tay KHÔNG có thư mục (Notion, GitHub) không vào bảng này: chúng    │
 * │ không phải một chỗ trên đĩa, và ánh xạ `"Notion" → một đường dẫn` là bịa. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function armDirIndex(
  arms: Record<string, { label?: string }>,
  servers: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, cfg] of Object.entries(servers)) {
    const root = folderRoots(cfg)[0];
    if (!root) continue;
    const leaf = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
    const label = arms[id]?.label?.trim() ?? '';
    // Nhãn đứng SAU tên lá: nhãn là thứ người dùng đặt, nên khi hai cánh tay
    // đụng khoá thì cái mang nhãn thắng — nó là thứ họ vừa gõ ra.
    if (leaf) out[leaf.toLowerCase()] = root;
    if (label) out[label.toLowerCase()] = root;
  }
  return out;
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
/**
 * Danh mục cho giao diện. Nay là `CATALOG` **nguyên vẹn** cộng một trường suy ra.
 *
 * Bản trước phải lọc `build` ra vì nó là **hàm** — không tuần tự hoá được, và
 * `JSON.stringify` nuốt nó im lặng. Bỏ `build` đi thì cái lọc đó biến mất theo:
 * mọi trường của một mục giờ đều là dữ liệu, nên **không còn gì để quên lọc**.
 */
export function catalogForUi(): (CatalogArm & { transport: 'stdio' | 'http'; needsLogin: boolean })[] {
  // `needsLogin` suy từ `spec` chứ không khai tay: một mục dùng ô `${OAUTH}` thì
  // nó CẦN đăng nhập, và không có cách nào để hai trường đó nói khác nhau.
  return CATALOG.map((a) => ({ ...a, transport: transportOf(a), needsLogin: needsOAuth(a) }));
}

