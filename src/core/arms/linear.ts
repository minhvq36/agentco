/**
 * MỘT MỤC DANH MỤC = MỘT FILE. → `../catalog.ts` · docs/SPEC-arms.md §4e
 *
 * Mọi con số dưới đây **đo 29/08 bằng chìa thật, tài khoản thật**
 * (`scripts/spike-linear-oauth.ts`), không đọc từ tài liệu.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MỤC ĐẦU TIÊN KỂ TỪ NOTION KHÔNG ĐẺ RA MÓN NỢ NÀO Ở `oauth.ts`.          │
 * │                                                                          │
 * │   POST /register  client_name="agentco" auth="none"  → 201, 0 secret     │
 * │   token_endpoint_auth_methods_supported: [basic, post, **none**]         │
 * │   ⇒ public client + PKCE, đúng đường Notion đã đi. Cả bốn bước           │
 * │     `discover → register → authorizeUrl → exchangeCode` chạy bằng hàm     │
 * │     thật, **0 dòng sửa**.                                                │
 * │                                                                          │
 * │ Đối chiếu để nhớ vì sao đó là tin tốt: Figma **403 thân rỗng** cho        │
 * │ `client_name="agentco"` (lọc theo tên client); Slack + Google **không có │
 * │ `none`** ⇒ đòi confidential client, thứ ta chưa có (§4 nợ 0d).           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { CatalogArm } from '../catalog.js';

/**
 * ⚠ Hai URL, và cặp này là **toàn bộ lý do Linear đáng làm hơn Notion**.
 * Tách ra hằng số vì `identity` phải hỏi ở **URL đầy đủ** — hỏi danh tính là
 * việc ĐỌC, nhưng nó chạy trước khi biết nấc, nên không được đi qua `/readonly`.
 */
const MCP_URL = 'https://mcp.linear.app/mcp';

export const LINEAR_ARM: CatalogArm = {
  id: 'linear',
  name: 'Linear',
  icon: '📐',
  /**
   * ⚠ CÂU NÀY PHẢI NÓI RA BÁN KÍNH — và ở đây bán kính **hẹp hơn** Notion, nên
   * nói đủ mới là công bằng chứ không phải khiêm tốn.
   *
   * Notion khai đúng **một** scope `default`, thừa kế TOÀN BỘ quyền người đăng
   * nhập (`notion.ts §blurb`); nấc "chỉ đọc" ở đó là hàng rào của TA. Linear
   * cấp `read` và `write` riêng, và **buộc chìa vào đúng MỘT workspace** người
   * dùng chọn trên màn Đồng ý (đo: ba lần đăng nhập ra hai workspace id khác
   * nhau). Nên "chỉ đọc" ở mục này là **chìa thật sự không ghi được**.
   */
  blurb:
    'Đọc và (nếu bạn cho phép) ghi vào một workspace Linear — issue, project, tài liệu. ' +
    'Bạn chọn workspace nào ngay lúc đăng nhập.',
  price: 'login',
  /**
   * MCP **hosted chính chủ**, Streamable HTTP. Rủi ro chuỗi cung ứng §11d = **0**:
   * không tải mã người lạ, không `npx` trên đường nóng.
   *
   * `${OAUTH}` là **chỗ trống có tên quy ước** — `buildConfig` thay bằng tên tài
   * khoản thật (`LINEAR_OAUTH_<8 hex>`). → §OAUTH_SLOT · `oauth.ts §accountName`
   *
   * ⚠⚠ `readOnlyUrl` LÀ CƠ CHẾ MỚI, và nó kéo theo một dòng ở **cuối
   * `catalog.ts`**: `serverFenced()` phải nhìn thấy nó. Quên là dựng lại nguyên
   * vẹn bug 27/08 — bộ chọn nấc biến mất, người dùng khoá cứng ở nấc thấp nhất,
   * **không câu lỗi nào**. Số đo của cặp URL này:
   *
   *   /mcp           57 việc · 79 243 byte ≈ **19 811 token**
   *   /mcp/readonly  35 việc · 34 174 byte ≈  **8 544 token**
   *   ⇒ cắt đúng 22 việc GHI, **không mất một việc đọc nào**, rẻ đi ≈11 267/lượt
   *
   * (Mốc so: `filesystem` 2 185 · GitHub mặc định ~30 000 · Google Calendar 24 900.)
   */
  spec: {
    kind: 'http',
    url: MCP_URL,
    headers: { Authorization: 'Bearer ${OAUTH}' },
    readOnlyUrl: 'https://mcp.linear.app/mcp/readonly',
    /**
     * ⚠ XIN RỘNG, cố ý. Linear khai bốn scope (`read` · `write` · `openid` ·
     * `email`); ta xin hai cái đầu và **không** xin `openid`/`email` — chúng
     * trả danh tính **NGƯỜI DÙNG** (`sub`), mà một người có N workspace ⇒ cùng
     * `sub` ⇒ vẫn đè nhau. Đơn vị của ta là **workspace**, và nó chỉ hỏi ra
     * được bằng `identity.get_workspace` bên dưới.
     *
     * Xin `read write` chứ không xin `read`: scope chốt lúc bấm Đồng ý, trước
     * khi người dùng thấy bộ chọn nấc. Đo 29/08: đăng nhập với `scope=read` ⇒
     * `/mcp` chỉ trả 35 việc ⇒ `offeredTiers` thu về **một nấc** ⇒ không còn
     * đường lên toàn quyền. → `catalog.ts §authScope`
     */
    authScope: 'read write',
  },
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BA NẤC — VÀ NẤC GIỮA GẦN NHƯ RỖNG. Ghi ra để đừng ai tưởng là bug.       │
   * │                                                                          │
   * │ Đo: **57/57 việc đều khai `annotations`** (không việc nào rơi vào nhánh   │
   * │ "mặc định từ chối"). `offeredTiers` ra ba nấc:                            │
   * │                                                                          │
   * │     read 35  ·  add 39  ·  full 57                                       │
   * │                                                                          │
   * │ 🔴 Nấc `add` chỉ thêm **4 việc**, và **KHÔNG có việc tạo issue**. Linear  │
   * │ không có `create_issue` — nó dùng `save_issue` (upsert), mà upsert khai   │
   * │ `destructiveHint: true` nên rơi xuống `full`. Bốn việc của nấc `add` là:  │
   * │ ba việc đính kèm + `create_issue_label`.                                 │
   * │                                                                          │
   * │ ⇒ User chốt 29/08: **cứ theo bảng chân trị**, không vá riêng cho hãng nào │
   * │   (*"tôi đâu biết có gì trong đó đâu"*). Đúng — giấu nấc này ở mục Linear │
   * │   là nhét một ca đặc thù vào lõi, thứ §domain-vs-boundary đã cấm.         │
   * │                                                                          │
   * │ ⚠ NHƯNG CÒN MỘT NỬA CHƯA TRẢ: câu `help` của nấc `add` trong             │
   * │ `ArmDialog.tsx` viết *"Tạo được trang/mục mới, nhưng không đụng tới thứ   │
   * │ đã có sẵn"* — câu đó **sai với Linear**. Nó là chuỗi CỦA TA, không phải   │
   * │ của hãng, nên nó không được luật "theo bảng chân trị" che. Hứa quá tay    │
   * │ tệ hơn doạ quá tay (§11a-bis). → món nợ, ghi ở SESSIONS_MEMORY §5x.       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  tiered: true,
  /**
   * ⚠ CHỈ GHI ĐÈ NẤC `add` — hai nấc kia câu mặc định vẫn đúng.
   *
   * User bắt 30/08: *"cái issue với linear hình như quan trọng đấy"*. Đúng, và
   * đó là lý do câu mặc định (*"Tạo được trang/mục mới…"*) không dùng được ở
   * đây: issue **là** đối tượng chính của Linear, mà nấc này không tạo được nó.
   *
   * 📌 Câu dưới nói **việc làm được**, rồi nói **việc KHÔNG làm được kèm lý do
   * của hãng** — chứ không nói trống *"hạn chế"*. Người dùng phải quyết được
   * *"tôi có cần nhân viên mở việc mới không"*, và với Linear câu trả lời đó
   * dẫn thẳng lên nấc Toàn quyền.
   */
  tierSay: {
    add:
      'Đính kèm tệp và tạo nhãn mới. ⚠ KHÔNG mở được issue mới — Linear gộp việc tạo và ' +
      'việc sửa issue vào chung một lệnh, nên mở issue nằm ở nấc Toàn quyền.',
  },
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 CA THẬT, LƯỢT CHẠY ĐẦU TIÊN QUA UI (user báo 30/08).                  │
   * │                                                                          │
   * │ Hỏi: *"Có bao nhiêu việc đang In Progress trong Linear?"*                 │
   * │ Trợ lý chia việc: *"Tra cứu trong Linear **project Agent-co-test-2**…"*   │
   * │ Nhân viên: `list_issues` (được 9 việc) → `list_projects` ×2 → bỏ cuộc:    │
   * │ *"Không tìm thấy project Agent-co-test-2"*. **6 lượt · $0,1409 · sai.**   │
   * │                                                                          │
   * │ Không ai bịa cả: `Agent-co-test-2` là `label` của cánh tay, mà label lấy  │
   * │ từ `identity.labelField` = tên **WORKSPACE**. Dòng danh bạ đưa cho model  │
   * │ một chuỗi trần, không nói nó là loại gì ⇒ model đọc thành tên project ⇒   │
   * │ đi tìm thứ không tồn tại (`list_projects` trả `[]` — workspace này không  │
   * │ có project nào) ⇒ **báo thất bại trong khi đã cầm sẵn 9 việc**.           │
   * │                                                                          │
   * │ ⇒ Câu này nằm **trên chính dòng của cánh tay**, không phải một luật chung │
   * │ dán lên mọi lượt — đúng khuôn đã thắng ở `chạy lệnh: TẮT`.                │
   * │ → [[agentco-prompt-rules-lose-to-examples]]                              │
   * │                                                                          │
   * │ Vế hai đo được: `list_issues` **đã trả sẵn `status`** ("Todo"/"In         │
   * │ Progress"/…) ngay trong mỗi việc. Nên câu trả lời nằm trong MỘT lời gọi,  │
   * │ và câu dặn phải **chỉ đường đi tiếp** chứ không chỉ nói "đừng làm X".     │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  hint:
    'Nhãn cánh tay Linear là tên WORKSPACE, không phải project — nhiều workspace không có ' +
    'project nào. Việc nằm thẳng trong team, và list_issues đã trả sẵn status, lọc luôn trên đó.',
  /** RỖNG — chìa sinh ra từ luồng đăng nhập, không do người dùng gõ. → `price: 'login'` */
  secrets: [],
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 BẮT BUỘC, KHÔNG PHẢI TÔ ĐIỂM — thiếu nó thì HAI WORKSPACE GỘP LÀM MỘT.│
   * │                                                                          │
   * │ Notion trả `workspace_id` ngay trong phản hồi token. **Linear trả rỗng**: │
   * │ đo kho chìa sau ba lần đăng nhập, `extra` **không có gì cả**. Không seed  │
   * │ thì `accountName` rơi về nhánh dự phòng `issuer|mcp_url` — một chuỗi      │
   * │ **giống hệt nhau cho mọi người dùng Linear**. Số đo:                     │
   * │                                                                          │
   * │   không seed        cả 3 chìa → LINEAR_OAUTH_AA1F1EAD   ⇒ GỘP           │
   * │   seed = ws.id      Agent-co-test  → …52BA79B8                          │
   * │                     Agent-co-test-2→ …5C5D1429          ⇒ TÁCH ĐÚNG     │
   * │                                                                          │
   * │ Đúng ca GitHub 26/08 (§5h·7k), và nó **không có triệu chứng** cho tới     │
   * │ khi người dùng nối workspace thứ hai.                                    │
   * │                                                                          │
   * │ ⚠ `idField: 'id'` chứ không phải `'name'`: người dùng đổi tên workspace   │
   * │ được, và một hạt giống băm đổi được nghĩa là cánh tay **tự nhân đôi** sau │
   * │ khi đổi tên. Cùng lý lẽ `github.ts` chọn `id` thay vì `login`.           │
   * │                                                                          │
   * │ 📌 Hỏi ở `MCP_URL` đầy đủ, KHÔNG ở `/readonly`: lúc hỏi danh tính thì     │
   * │ chưa ai chọn nấc. (`get_workspace` vốn là việc đọc nên hai URL đều trả    │
   * │ được — nhưng phụ thuộc vào điều đó là phụ thuộc vào một sự trùng hợp.)   │
   * │                                                                          │
   * │ Trả về: {"id":"87a0dce5-…","name":"Agent-co-test","url":"https://…"}    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  identity: {
    url: MCP_URL,
    tool: 'get_workspace',
    idField: 'id',
    labelField: 'name',
  },
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MỤC ĐẦU TIÊN CÓ `checkedOn` THẬT — quy tắc đã ĐỌC, không phải bỏ trống.  │
   * │                                                                          │
   * │ User chốt 30/08: *"sửa logo thành logo của linear luôn, cả ở node canvas  │
   * │ và modal UI"*. Trước khi dán, đọc 🌐 linear.app/brand. Ghi lại nguyên     │
   * │ những gì nó nói, vì đây là **dữ kiện**, không phải cảm nhận:              │
   * │                                                                          │
   * │  · *"Do not alter these files in any way"*                                │
   * │  · Cấm ghép logo Linear vào tên/sản phẩm của mình, và cấm **kết hợp với   │
   * │    hình khác** — *"without written consent from Linear"*                  │
   * │  · **Đơn sắc được ƯU TIÊN** hơn bản màu ⇒ đúng thứ ta đang dùng           │
   * │  · Bên thứ ba muốn dùng thì hỏi 🌐 hello@linear.app                       │
   * │                                                                          │
   * │ ⚠⚠ MÓN NỢ CÓ THẬT, ghi ra chứ không giấu: quy tắc **có đòi văn bản cho    │
   * │ phép** cho ca bên thứ ba. Ta ship trước, theo quyết định của user, và với │
   * │ lý lẽ §11a-bis đã chốt (logo trong **danh sách kết nối** là dạng dễ bảo   │
   * │ vệ nhất — nó **chỉ danh** dịch vụ được nối tới, không gợi ý hợp tác).     │
   * │ Ta cũng không sửa hình, không tô màu hãng, không ghép với hình khác.      │
   * │                                                                          │
   * │ 📌 KHÁC Notion/GitHub ở một chỗ đáng giá: hai mục đó `checkedOn: null` —  │
   * │ **nợ mù**, không ai biết rủi ro cỡ nào. Mục này nợ **có ngày, có nguyên   │
   * │ văn, có địa chỉ để xin phép**. Trước khi phát hành ra ngoài: gửi thư cho  │
   * │ cả ba hãng, rồi cập nhật ô này.                                          │
   * │                                                                          │
   * │ Đường dẫn: một `path` duy nhất trong khung 24×24, `currentColor`, không   │
   * │ nền, không màu hãng. → `ArmIcon.tsx` (0 tên hãng trong mã web)            │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  brand: {
    owner: 'Linear Orbit, Inc.',
    guidelineUrl: 'https://linear.app/brand',
    checkedOn: '2026-08-30',
    // ⚠ MỘT CHUỖI, KHÔNG NỐI — xem lý do ở `github.ts §brand.mark`.
    // prettier-ignore
    mark: 'M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z',
  },
};
