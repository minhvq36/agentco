import { createHash } from 'node:crypto';

// Một hằng số, một chỗ khai. `secrets.ts` là nơi ô trống được ĐIỀN, nên nó cũng
// là nơi giữ chuỗi — file này chỉ dùng nhờ. Chiều import an toàn: `secrets.ts`
// không import gì từ đây (chỉ `paths` + `oauth`, đều là kiểu).
import { OFFICE_STATE } from './secrets.js';

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
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ THAM SỐ KHÁC NHAU THEO HỆ ĐIỀU HÀNH — và nó là chuyện DUNG LƯỢNG ĐĨA.│
       * │                                                                      │
       * │ Ca đẻ ra nó (đo 29/08): Playwright không khai trình duyệt thì dùng    │
       * │ **bản đóng gói** — `chromium_headless_shell` **269 MB**, bản đủ        │
       * │ **415 MB**, và **bản cũ không bao giờ tự bị dọn** (máy đo có 1 340 MB │
       * │ gồm hai bộ 04/2026 + 07/2026 nằm cạnh nhau). Khai một **channel**     │
       * │ (`msedge`/`chrome`) thì nó dùng trình duyệt **đã cài sẵn**: 0 byte.   │
       * │                                                                      │
       * │ Nhưng tên channel đúng lại khác nhau theo OS ⇒ một mảng `args` tĩnh   │
       * │ không diễn đạt được. Đây là chỗ cho nó, và nó **tổng quát** — không   │
       * │ có tên hãng nào trong kiểu này.                                       │
       * │                                                                      │
       * │ ⚠ VÀ NÓ VÀO BĂM. Bê một công ty từ Windows sang macOS ⇒ args khác ⇒   │
       * │ băm khác ⇒ **cắm lại**. Đúng luật "vòng đời có hai động từ", và cũng  │
       * │ đúng sự thật: đó là một trình duyệt khác trên một máy khác.           │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      argsByOs?: Readonly<Record<string, readonly string[]>>;
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
      /**
       * Tên header chở DANH SÁCH NHÓM VIỆC người dùng tick. → §5h·7e
       *
       * ⚠ CỐ Ý KHÔNG dùng ô trống `${TOOLSETS}`: cú pháp `${…}` trong dự án này
       * có đúng một nghĩa — **một cái tên chìa** — và `missingSecretRefs()` quét
       * cả cấu hình để tìm ô trống còn sót. Mượn cú pháp đó cho một thứ không
       * phải chìa là đẻ ra câu *"Thiếu chìa: TOOLSETS"*, tức một câu lỗi **chỉ
       * sai cửa** ngay trong bản vá cho câu lỗi sai cửa. `buildConfig` ghi thẳng
       * giá trị thật vào đây.
       */
      toolsetHeader?: string;
      /**
       * Header thêm vào ở nấc **chỉ đọc** — hàng rào do CHÍNH SERVER dựng.
       *
       * Đo 26/08 (§5h·7j): gọi `create_or_update_file` qua cửa chỉ-đọc bị từ
       * chối ở **tầng giao thức** (`-32602 unknown tool`), chứ không phải "tool
       * chạy rồi trả lỗi". Đó là khác biệt giữa **một danh sách** và **một hàng
       * rào**, và hàng rào này nằm ngoài tầm với của mọi thứ chạy trên máy khách.
       *
       * ⚠ KHÔNG thay cho việc lọc `allowedTools` phía ta — hai lá chắn khác
       * tầng, dùng cả hai. Hãng nào không có thì bỏ trống, nấc `read` vẫn chạy
       * bằng lớp của ta như cũ.
       */
      readOnlyHeaders?: Record<string, string>;
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
  input: {
    folders: string[];
    account?: string;
    groups?: string[];
    level?: string;
    /**
     * Hệ điều hành đang chạy — tham số chứ không đọc thẳng `process.platform`,
     * để test dựng được cấu hình của **cả ba OS** trên một máy. Đúng luật đã
     * dẫm năm lần: *"đúng trên máy dev, sai ở chỗ khác"*.
     */
    platform?: string;
    /**
     * Chế độ người dùng chọn — **đã giải sẵn** thành đối tượng, không phải một id.
     *
     * Giải ở chỗ gọi (nơi biết mục danh mục và biết request đến từ đâu) chứ không
     * ở đây, vì cổng `loopbackOnly` cần **địa chỉ socket** — thứ hàm dựng cấu hình
     * không được biết tới. Một hàm thuần thì phải nhận kết quả của quyết định,
     * không tự đi lấy dữ kiện để tự quyết.
     */
    options?: readonly ArmOption[];
  },
): Record<string, unknown> {
  if (spec.kind === 'http') {
    let headers = spec.headers;
    if (headers && input.account) {
      const slot = `\${${input.account}}`;
      headers = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k, v.split(OAUTH_SLOT).join(slot)]),
      );
    }
    /**
     * Nhóm việc → một header. **SẮP XẾP** trước khi nối, vì chuỗi này đi vào
     * `armHash`: tick cùng ba nhóm theo hai thứ tự khác nhau mà ra hai băm khác
     * nhau thì luật *"cùng cấu hình ⇒ cùng cánh tay"* thủng ngay. Cùng lý do
     * `armHash` sắp khoá JSON trước khi băm.
     */
    if (spec.toolsetHeader && input.groups?.length) {
      headers = { ...(headers ?? {}), [spec.toolsetHeader]: [...input.groups].sort().join(',') };
    }
    // Nấc chỉ-đọc: thêm hàng rào của server lên trên lớp lọc của ta. → §5h·7j
    if (spec.readOnlyHeaders && input.level === 'read') {
      headers = { ...(headers ?? {}), ...spec.readOnlyHeaders };
    }
    return { type: 'http', url: spec.url, ...(headers ? { headers } : {}) };
  }
  /**
   * Thứ tự nối: `args` chung → `argsByOs` → thư mục người dùng chọn.
   *
   * ⚠ Thư mục phải đứng CUỐI (nhiều CLI coi phần đuôi là tham số vị trí), và
   * `argsByOs` phải đứng TRƯỚC nó vì nó vẫn là cờ có tên.
   */
  const os = input.platform ?? process.platform;
  const extra = spec.argsByOs?.[os] ?? [];

  /**
   * Thư mục của chế độ. Thiếu `stateDir` mà chế độ lại đòi thư mục ⇒ **ném**,
   * không phải bỏ qua: bỏ qua thì `--user-data-dir` biến mất và cánh tay lặng lẽ
   * tụt về chế độ sạch — tức người dùng chọn "giữ đăng nhập" và nhận về một thứ
   * **không giữ gì**, không một câu lỗi nào. Hỏng im lặng theo chiều **thu hẹp**
   * vẫn là hỏng im lặng.
   */
  const on = input.options ?? [];
  const add: string[] = [];
  const drop = new Set<string>();
  for (const o of on) {
    add.push(...(o.args ?? []));
    for (const r of o.remove ?? []) drop.add(r);
    /**
     * 🔴 GHI **Ô TRỐNG**, KHÔNG GHI ĐƯỜNG DẪN THẬT. → `secrets.ts §OFFICE_STATE`
     *
     * Đường dẫn thật chỉ tồn tại lúc spawn. Ghi nó vào đây là ghi nó vào `args`
     * ⇒ vào băm ⇒ chỗ cất dữ liệu thành danh tính cánh tay: cùng một mục cắm ở
     * hai văn phòng ra hai băm, và đổi chỗ thư mục công ty là đổi mọi băm.
     */
    for (const d of o.dirs ?? []) add.push(d.flag, `${OFFICE_STATE}/${d.sub}`);
  }

  return {
    command: spec.command,
    // `drop` áp lên CẢ `spec.args` lẫn `argsByOs` — một cờ gỡ được ở chỗ này mà
    // không gỡ được ở chỗ kia là một cái bẫy chờ ngày có mục thứ hai dùng tới.
    args: [
      ...[...spec.args, ...extra].filter((a) => !drop.has(a)),
      ...add,
      ...(spec.appendFolders ? input.folders : []),
    ],
  };
}

/**
 * Lựa chọn bật sẵn của một mục — dùng khi người dùng chưa tick gì.
 *
 * ⚠ Trả **mảng**, kể cả rỗng: mặc định là một quyết định phải viết ra bằng `on`,
 * không phải một thứ suy từ thứ tự khai — thứ đổi im lặng vào ngày ai đó sắp lại
 * danh sách.
 */
export function defaultOptions(arm: CatalogArm): readonly ArmOption[] {
  return (arm.options ?? []).filter((o) => o.on);
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 HÃNG NÀY CẮT VIỆC NGAY Ở SERVER THEO NẤC — và đó là một cái BẪY VÒNG. │
 * │ (bug user bắt 27/08)                                                     │
 * │                                                                          │
 * │ Với mục vừa `tiered` vừa có `readOnlyHeaders`, phép thử ở nấc `read` gửi  │
 * │ hàng rào lên ⇒ server **chỉ trả về việc đọc** ⇒ `offeredTiers` thấy ba    │
 * │ nấc bằng nhau ⇒ luật *"chỉ hiện nấc nào thêm ≥1 việc"* thu về **một nấc** │
 * │ ⇒ bộ chọn nấc KHÔNG HIỆN ⇒ người dùng **không có đường nào lên toàn       │
 * │ quyền**. Nấc mặc định tự khoá chính nó.                                   │
 * │                                                                          │
 * │ Triệu chứng đúng như user tả: *"16 việc chỉ đọc · 0 việc có ghi"* rồi     │
 * │ *"vẫn không cách nào ra cái này? Làm sao để test?"*. Không có câu lỗi nào │
 * │ — mọi tầng đều làm đúng phần của mình.                                    │
 * │                                                                          │
 * │ ⇒ Luật: **KHÁM PHÁ thì không mang hàng rào; THI HÀNH thì mang.** Nút Thử  │
 * │ hỏi *"cánh tay này làm được TỐI ĐA những gì"* — trộn phép cưỡng chế vào   │
 * │ một câu hỏi khám phá là để câu trả lời tự cắt cụt chính nó.                │
 * │ (Bản lưu vẫn dựng có hàng rào, và `scopedTools` lúc lưu vẫn hỏi lại server│
 * │ theo đúng nấc — nên danh sách việc được cấp KHÔNG rộng ra tí nào.)        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function serverFenced(a: CatalogArm): boolean {
  return a.spec.kind === 'http' && Boolean(a.spec.readOnlyHeaders);
}

/** Mục này cần đăng nhập chứ không cần gõ chìa? Suy từ `spec`, không khai lại. */
export function needsOAuth(a: CatalogArm): boolean {
  return a.spec.kind === 'http' && JSON.stringify(a.spec.headers ?? {}).includes(OAUTH_SLOT);
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CÁCH ĐĂNG NHẬP — cho hãng **KHÔNG mở đăng ký động (DCR)**. → §5h·7       │
 * │                                                                          │
 * │ Notion cho ta xin `client_id` tại chỗ, nên nó **không cần trường này**.   │
 * │ GitHub thì không: phải có sẵn một `client_id`. Và vì device flow **không  │
 * │ dùng `client_secret` ở bất kỳ bước nào** (kể cả lúc làm mới), `client_id` │
 * │ là **DỮ LIỆU CÔNG KHAI** — ship thẳng trong mã như `gh` CLI, VS Code,     │
 * │ Vercel vẫn làm. Nhờ vậy khách gõ **0 chìa**, đúng bằng Notion.            │
 * │                                                                          │
 * │ ⚠ `clientId` ở đây **ghi đè được từ giao diện** và đó là chủ ý, không     │
 * │ phải tính năng thừa: nó là đường thoát cho hai rủi ro của việc agentco    │
 * │ đứng tên (§5h·7h) — ① app của ta bị hãng treo thì MỌI khách gãy cùng lúc; │
 * │ ② khách doanh nghiệp không muốn đi qua danh tính của ta. Cùng một trường  │
 * │ dữ liệu, **0 dòng mã thêm**, và nó là câu trả lời tử tế nhất cho câu       │
 * │ *"sao tôi phải tin agentco"*: **"anh không phải tin."**                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface ArmAuth {
  kind: 'device';
  clientId: string;
  /** Vài hãng đòi scope ngay ở bước xin mã. GitHub App thì không (đo: rỗng). */
  scope?: string;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HỎI XEM CHÌA NÀY LÀ CỦA AI — cho hãng KHÔNG trả danh tính. → §5h·7k      │
 * │                                                                          │
 * │ Notion trả kèm `workspace_id` + `workspace_name` ngay trong phản hồi      │
 * │ token. **GitHub trả rỗng cả hai.** Không có trường này thì `accountName()`│
 * │ rơi về `issuer|mcp_url` — một chuỗi **giống hệt nhau cho mọi tài khoản**  │
 * │ ⇒ cùng tên chìa ⇒ **cùng băm** ⇒ hai tài khoản GitHub khác nhau bị gộp    │
 * │ thành MỘT cánh tay. Đúng ca §6i, và nó không có triệu chứng nhìn thấy     │
 * │ được cho tới khi người thứ hai đăng nhập.                                 │
 * │                                                                          │
 * │ ⇒ Ta đi hỏi, bằng chính giao thức đã có (`mcp-http.ts §callTool`).        │
 * │ `idField` làm hạt giống băm (chọn thứ **không đổi khi đổi tên**),         │
 * │ `labelField` làm nhãn hiển thị.                                          │
 * │                                                                          │
 * │ 🎯 Và nó vá luôn một cái bẫy UX ta tự dẫm khi đo: lượt đăng nhập đầu lấy  │
 * │ nhầm chìa của **tài khoản chủ app** vì trình duyệt đang đăng nhập tài     │
 * │ khoản đó. Không hiện `@login` ra thì triệu chứng duy nhất là *"cánh tay   │
 * │ không thấy repo nào"* — một câu sai cửa dẫn người ta đi kiểm quyền.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface ArmIdentity {
  /** Cửa để hỏi. Thường là lát cắt rẻ nhất, không phải endpoint đầy đủ. */
  url: string;
  tool: string;
  /** Khoá làm HẠT GIỐNG BĂM — phải ổn định qua việc đổi tên. */
  idField: string;
  /** Khoá làm NHÃN người đọc. */
  labelField: string;
}

/**
 * Một nhóm việc người dùng tick. Nhóm là **của hãng**, không phải của ta.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `label` GIỮ TÊN CỦA HÃNG · `help` NÓI VIỆC LÀM ĐƯỢC. (user chốt 28/08)   │
 * │                                                                          │
 * │ > *"Cái check đầu tiên: 'Biết tôi là ai, repo nào' tôi nghe không hiểu.  │
 * │ >  Thà để ngôn ngữ chuyên ngành như issue, action còn dễ hiểu hơn"*      │
 * │                                                                          │
 * │ Nhãn cũ dịch `context` thành một câu tiếng người — và dịch **sai bán      │
 * │ kính**: nó hứa *"biết repo nào"* trong khi `context` chỉ có ba tool về    │
 * │ tài khoản và tổ chức. Vừa khó hiểu vừa không đúng.                        │
 * │                                                                          │
 * │ ⇒ Tên là **địa chỉ** (người dùng tra được nó trong tài liệu của hãng),    │
 * │ `help` là **mô tả**. Thay địa chỉ bằng mô tả thì mất cả hai: không tra    │
 * │ được, mà cũng không hiểu thêm. [[agentco-count-mechanisms]]               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface ArmGroup {
  id: string;
  label: string;
  /** Một câu nói nhóm này CHO LÀM GÌ. Thiếu thì người non-code phải đoán. */
  help?: string;
  /** Bật sẵn khi mở hộp thoại. Ít thôi — mỗi nhóm là token mỗi lượt. */
  on?: boolean;
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
  /** Không khai ⇒ đăng ký động (DCR) + web flow, đúng như Notion. → §5h·7 */
  auth?: ArmAuth;
  /** Không khai ⇒ danh tính đọc từ phản hồi token (Notion). → §5h·7k */
  identity?: ArmIdentity;
  /**
   * Nhóm việc cho người dùng tick. Không khai ⇒ cắm cả server.
   *
   * 🔴 Với GitHub đây **không phải tuỳ chọn nâng cao, nó là điều kiện tồn tại**:
   * cắm nguyên endpoint mặc định là **≈30 000 token MỖI LƯỢT** (89 việc ở
   * `x/all` thì ≈60 000), trong khi sàn tool của cả hệ thống mới ~13 200 và một
   * cánh tay `filesystem` đo được 2 185. → §5h·7e
   */
  groups?: ArmGroup[];
  secrets: ArmSecretField[];
  /** Cánh tay cần một danh sách thư mục được phép. Đó CHÍNH LÀ allowlist. */
  folders?: { label: string; help: string };
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ HÀNG RÀO NGOÀI — do HÃNG giữ, ta chỉ MỞ CỬA cho người dùng đi tới.       │
   * │ (user 27/08: *"Tức là ta không thể làm gì?"*)                            │
   * │                                                                          │
   * │ Với GitHub, "app được chạm repo nào" nằm trong **bản cài đặt**, và bản    │
   * │ cài đặt chỉ sửa được trên **màn hình đồng ý của GitHub**. Không API nào   │
   * │ cho phép phần mềm tự thêm repo cho chính nó — nếu có thì cả cơ chế đồng   │
   * │ ý vô nghĩa. Nên thứ duy nhất ta làm được, và PHẢI làm, là một cái nút.    │
   * │                                                                          │
   * │ 🔴 Không có trường này thì chuỗi đó **không xuất hiện một lần nào trong   │
   * │ sản phẩm** — nó chỉ nằm trong file walkthrough. Người dùng không đọc      │
   * │ walkthrough sẽ cắm xong, thấy `✓ 16 việc`, rồi nhận 404 ở mọi lời gọi:    │
   * │ một cánh tay "chạy" mà không làm được gì, và câu lỗi dẫn họ đi kiểm chìa. │
   * │ Đúng lớp *sai cửa* mà §5h·7f sinh ra để đóng. → C-2 · F-3 bài 13          │
   * │                                                                          │
   * │ ⚠ Một app của ta phục vụ **vô hạn khách**: `client_id` là danh tính PHẦN  │
   * │ MỀM, mỗi khách cài nó vào tài khoản HỌ và có bản cài riêng mang lựa chọn  │
   * │ repo riêng. Khách **không tạo app**, không có bước 15 phút nào — đó là     │
   * │ đường G2 của Google (§5h·4), và GitHub cố ý không phải đường đó.          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  scope?: {
    /** Nút mở ra. Nói HÀNH ĐỘNG, không nói "cấu hình". */
    say: string;
    url: string;
    /** Một câu nói phạm vi này ai giữ — thiếu nó thì cái nút là một câu đố. */
    help: string;
  };
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ TRA BẢN CÀI APP — tự động, 0 ký tự người dùng gõ. → SPEC-arms §5h·7o     │
   * │                                                                          │
   * │ Vì sao cần: `probeArm` gọi `tools/list`, mà `tools/list` **thành công kể  │
   * │ cả khi chưa cài app vào repo nào** ⇒ dấu ✓ chứng minh *đăng nhập chạy*,   │
   * │ KHÔNG chứng minh *với tới được gì*. → [[agentco-measurement-vs-conclusion]]│
   * │                                                                          │
   * │ 🔴 VÀ ĐÂY LÀ CHỖ TIỀN ĐỀ HIỂN NHIÊN BỊ SỐ ĐO GIẾT (27/08):               │
   * │ chìa `ghu_` **KHÔNG bị bản cài giới hạn với repo CÔNG KHAI** — đo được:   │
   * │ `list_branches` chạy trên **cả 16** repo trong khi app chỉ cài **2**.     │
   * │ ⇒ mọi phép thử kiểu "đọc thử một file" đều ✓ bất kể bản cài, tức nó trả   │
   * │ lời một câu KHÁC với câu đang hỏi.                                        │
   * │                                                                          │
   * │ Thứ phân biệt được là `gateTool`: một tool **CHỈ ĐỌC nhưng đòi quyền      │
   * │ push**, thứ chỉ tồn tại ở repo đã cài app. Đo 4/4 đúng.                   │
   * │                                                                          │
   * │ ⚠ `search` chỉ thấy repo do chính `login` SỞ HỮU — repo của tổ chức không │
   * │ vào. Nên danh sách rỗng **không chứng minh** "chưa cài gì cả", và giao    │
   * │ diện phải chừa đường thoát tường minh thay vì chặn cứng.                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  repoScan?: {
    /** Hỏi "tôi là ai" để dựng câu tìm kiếm. Thường trùng `identity.tool`. */
    meTool: string;
    loginField: string;
    searchTool: string;
    /** `${login}` được thay bằng tên tài khoản. */
    searchQuery: string;
    /**
     * 🔴 Tool CHỈ ĐỌC mà đòi quyền GHI — đó là toàn bộ cơ chế.
     * Chọn nhầm một tool đọc thường (`list_branches`) là dựng một phép tra
     * **luôn trả lời CÓ**, tức tệ hơn không tra.
     */
    gateTool: string;
  };
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ HỒ SƠ THƯƠNG HIỆU — VÀ LOGO SỐNG NGAY TRONG ĐÓ. (dời về đây 28/08)       │
   * │                                                                          │
   * │ `checkedOn` rỗng nghĩa là **chưa ai đọc quy tắc của hãng đó**.            │
   * │                                                                          │
   * │ ⚠ `mark` (đường dẫn SVG đơn sắc) đặt ở ĐÂY chứ không ở một bảng ánh xạ   │
   * │ trong thư mục web, và đó là cả điểm của việc dời:                        │
   * │                                                                          │
   * │  ① §11c là luật *"chưa đọc quy tắc ⇒ không logo"*. Luật đó chỉ thi hành  │
   * │    được nếu **logo và lời khai thương hiệu nhìn thấy nhau**. Ngày 27/08  │
   * │    ta ship logo GitHub/Notion trong `ArmIcon.tsx` trong khi `checkedOn`   │
   * │    vẫn `null` ở đây — hai file, không ai đối chiếu, luật thành lời hứa.   │
   * │  ② Giao diện hết cần biết tên hãng nào: nó vẽ `brand.mark`, chấm hết.    │
   * │    **0 tên hãng trong mã web** — cùng kỷ luật đã dùng cho `repoScan`.    │
   * │                                                                          │
   * │ Rỗng ⇒ vẽ hình theo LOẠI (thư mục · phích cắm · bánh răng), không vẽ bừa.│
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  brand: {
    owner: string | null;
    guidelineUrl: string | null;
    checkedOn: string | null;
    /** Đường dẫn SVG trong khung 24×24, tô bằng `currentColor`. Không màu, không nền. */
    mark?: string;
  };
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
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VIỆC KHÔNG BAO GIỜ ĐƯỢC CẤP — kể cả ở nấc toàn quyền. (29/08)            │
   * │                                                                          │
   * │ ⚠ CHỈ CẮT, KHÔNG BAO GIỜ THÊM — nên nó **không đụng** luật một chiều đã   │
   * │ chốt 25/08 (*"không biết ⇒ leo thang, không bao giờ hạ cấp"*). Hạ cấp là  │
   * │ nói một việc nguy hiểm thành an toàn; cái này nói một việc **không được   │
   * │ dùng**. Hai chiều ngược nhau, và chỉ chiều này là an toàn khi ta sai.     │
   * │                                                                          │
   * │ Vì sao cần: `browser_run_code_unsafe` và `browser_evaluate` chạy **JS     │
   * │ tuỳ ý** trong trang. Annotations của chúng đúng (`destructive: true`) nên │
   * │ `tierOf` xếp vào `full` — hoàn toàn hợp lệ, và hoàn toàn không đủ. Nấc    │
   * │ toàn quyền nghĩa là *"được ghi"*, không nghĩa là *"được chạy mã tuỳ ý     │
   * │ dưới phiên đăng nhập của bạn"*.                                          │
   * │                                                                          │
   * │ ⚠ Đây là danh sách của TA, nằm trong danh mục ⇒ nó là **DỮ LIỆU**, và nó  │
   * │ là **ảnh chụp lúc cắm** giống `tools`. Hãng thêm một tool nguy hiểm mới   │
   * │ thì danh sách này **không tự biết** — cùng giới hạn đã ghi ở `readOnly`.  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  neverTools?: readonly string[];
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CHẾ ĐỘ — một lựa chọn LOẠI TRỪ NHAU, khác `groups` (tick nhiều).         │
   * │                                                                          │
   * │ Sinh ra vì mục trình duyệt có hai bán kính **khác hẳn nhau**, và người    │
   * │ dùng phải **thấy mình đang chọn cái nào**: một trình duyệt sạch mỗi lượt, │
   * │ hay một trình duyệt **nhớ đăng nhập của bạn**. Giấu cái thứ hai vào một ô │
   * │ tick trong Nâng cao là bán một bán kính rộng bằng một cú bấm vô thức.     │
   * │                                                                          │
   * │ ⚠ `args` của chế độ đi vào cấu hình ⇒ **vào băm** ⇒ đổi chế độ là **một   │
   * │ cánh tay khác**, không phải một lần sửa. Đúng luật "cắm và rút".          │
   * │                                                                          │
   * │ `loopbackOnly` — chế độ chỉ chọn được khi trình duyệt và daemon **cùng    │
   * │ máy**. Cửa sổ trình duyệt mở trên máy chạy daemon, nên bấm ở Hà Nội mà    │
   * │ cửa sổ bật trên server Singapore là đúng con bug nút 📂. Cổng phải đo bằng│
   * │ `isLoopback(req.socket.remoteAddress)` — **địa chỉ socket**, không phải   │
   * │ `Host` (client giả được).                                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  options?: readonly ArmOption[];
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 ĐÂY LÀ HAI Ô TICK ĐỘC LẬP, KHÔNG PHẢI MỘT DANH SÁCH BA NẤC.           │
 * │ (user bắt 29/08, và user đúng)                                           │
 * │                                                                          │
 * │ Bản đầu tôi gom "hiện cửa sổ" và "nhớ đăng nhập" thành ba lựa chọn loại   │
 * │ trừ nhau. Sai: chúng là **hai cờ độc lập của Playwright**, đủ bốn tổ hợp, │
 * │ và bản đó **đánh rơi mất một tổ hợp có thật**: *hiện cửa sổ nhưng không   │
 * │ lưu gì* — tức ca "xem nhân viên đang làm gì", thứ user hỏi từ đầu.        │
 * │                                                                          │
 * │ Nguyên nhân: tôi đếm **kịch bản** thay vì đếm **cơ chế**. Danh sách curate│
 * │ theo kịch bản luôn thiếu đúng cái kịch bản chưa ai kể.                    │
 * │ → [[agentco-count-mechanisms]]                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface ArmOption {
  id: string;
  /** Tiếng người, hiện thẳng lên ô tick. */
  label: string;
  /** Một câu nói ra **BÁN KÍNH**, không phải nói ra cấu hình. */
  help: string;
  /** Bật sẵn khi người dùng chưa chọn gì. Nhiều ô cùng bật sẵn được. */
  on?: boolean;
  /** Cờ thêm vào `args` khi ô này được tick. */
  args?: readonly string[];
  /**
   * Cờ **gỡ khỏi** `args` khi ô này được tick.
   *
   * Có nó vì một số lựa chọn là **sự vắng mặt** của một cờ: "hiện cửa sổ" chính
   * là *không* `--headless`. Không có đường gỡ thì phải để `--headless` xuống
   * từng tổ hợp, và mỗi tổ hợp mới là một chỗ để quên.
   */
  remove?: readonly string[];
  /**
   * Thư mục runtime cần chở vào `args`: `<flag> <stateDir>/<sub>`.
   *
   * ⚠ CỐ Ý KHÔNG dùng cú pháp `${…}` — trong dự án này chuỗi đó có **đúng một
   * nghĩa: tên một cái chìa**, và `missingSecretRefs()` quét cả cấu hình để tìm
   * ô trống còn sót. Mượn nó cho một đường dẫn là tự đẻ ra câu *"Thiếu chìa:
   * OFFICE"* — một câu lỗi chỉ sai cửa, đúng thứ §5m sinh ra để tránh.
   */
  dirs?: readonly { flag: string; sub: string }[];
  /** Chỉ hiện/nhận khi trình duyệt và daemon cùng máy. */
  loopbackOnly?: boolean;
}

/** Giao diện nói "stdio hay http" bằng tiếng người — suy từ `spec`, không khai lại. */
export function transportOf(a: CatalogArm): 'stdio' | 'http' {
  return a.spec.kind;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DỮ LIỆU CỦA TỪNG HÃNG NẰM Ở `arms/`, MỘT FILE MỘT HÃNG. (user 28/08)     │
 * │                                                                          │
 * │ File này giữ **kiểu + hàm dựng + phép băm** — thứ dùng chung cho mọi mục.│
 * │ Thêm một hãng = thêm một file trong `arms/` và một dòng ở `arms/index.ts`│
 * │ — không đụng gì ở đây.                                                   │
 * │                                                                          │
 * │ ⚠ Chiều import chỉ đi MỘT hướng: `arms/*` `import type` từ file này (kiểu │
 * │ bị xoá lúc dịch ⇒ không có vòng lặp lúc chạy), còn file này import NGƯỢC  │
 * │ lại đúng một thứ: mảng đã ghép sẵn. Đảo chiều là tạo vòng lặp module —    │
 * │ thứ chỉ nổ lúc chạy, ở một file không liên quan.                          │
 * │                                                                          │
 * │ `catalog.ts` vẫn là **cửa chung duy nhất**: mọi nơi khác trong dự án cứ   │
 * │ `import { CATALOG, findArm } from './catalog.js'` như cũ.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export { CATALOG } from './arms/index.js';
export { FILES_ARM } from './arms/files.js';
export { BROWSER_ARM } from './arms/browser.js';
export { NOTION_ARM } from './arms/notion.js';
export { GITHUB_ARM } from './arms/github.js';

import { CATALOG as ALL } from './arms/index.js';

export function findArm(id: string): CatalogArm | undefined {
  return ALL.find((a) => a.id === id);
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
/**
 * `chủ/tên` ở dạng CHUẨN — chữ thường, không đuôi, không tiền tố.
 *
 * Người dùng gõ ô này bằng tay, và họ sẽ dán đủ kiểu: `github.com/a/b`,
 * `https://github.com/a/b.git`, `A/B`, `/a/b/`. Cả bốn là **cùng một repo**, và
 * GitHub không phân biệt hoa thường ở cả `owner` lẫn `repo`.
 *
 * ⚠ Hàm này đứng ở HAI chỗ trên cùng một trục và **phải là một hàm**: nó chuẩn
 * hoá thứ đi vào BĂM, và chuẩn hoá thứ hàng rào đem ra SO. Hai bản của cùng một
 * phép chuẩn hoá lệch nhau nghĩa là một cánh tay tự chặn chính repo nó được
 * giao — mà triệu chứng chỉ là "404 sao lại 404". → [[agentco-catch-hides-premises]]
 */
export function normRepo(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '');
}

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
  /**
   * ⚠ ĐÃ BỎ tham số thứ tư `repos` (27/08 chiều) — cùng lúc bỏ hàng rào repo.
   *
   * 📌 Và đây là câu đáng nhớ nhất về băm của mục GitHub, user tự rút ra:
   * *"hash github dường như chỉ phụ thuộc account github đó là account nào, còn
   * chuyện người ta cho phép những gì mình đâu can thiệp được"* — **đúng, và đó
   * là kết quả đúng.** Băm là vân tay của thứ **agentco cấu hình**, không phải
   * của thứ cánh tay **với tới được**. Tầm với là tài sản của hãng, thay đổi
   * ngoài tầm ta, và nhét nó vào băm là hứa một điều ta không giữ được.
   * ⇒ Một cánh tay GitHub = (tài khoản + nhóm việc + nấc). → §5h·7l
   */
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
export function catalogForUi(): (CatalogArm & {
  transport: 'stdio' | 'http';
  needsLogin: boolean;
  deviceLogin: boolean;
  serverFence: boolean;
})[] {
  // `needsLogin` suy từ `spec` chứ không khai tay: một mục dùng ô `${OAUTH}` thì
  // nó CẦN đăng nhập, và không có cách nào để hai trường đó nói khác nhau.
  //
  // `deviceLogin` suy từ `auth` — giao diện cần biết vì HAI luồng khác nhau ở
  // thứ người dùng nhìn thấy: web flow mở một tab rồi chờ tab đó xong; mã thiết
  // bị thì **hiện một mã ngay tại đây** và tự hỏi thăm. Bày nhầm luồng là bảo
  // người ta chờ một tab sẽ không bao giờ báo về.
  // `serverFence` để giao diện nói được một câu THẬT về con số token: phép thử
  // chạy KHÔNG hàng rào (xem `serverFenced`), nên với mục này số đo là **trần**,
  // và nấc dưới sẽ tốn ít hơn thế. Im lặng ở đây là để người dùng đọc một con số
  // đúng cho một cấu hình họ không chọn.
  return ALL.map((a) => ({
    ...a,
    transport: transportOf(a),
    needsLogin: needsOAuth(a),
    deviceLogin: a.auth?.kind === 'device',
    serverFence: serverFenced(a),
  }));
}

