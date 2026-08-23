# SPEC — Cánh tay: MCP, shell, và đường ra thế giới

**Ngày:** 23/08/2026 · **Trạng thái:** phân tích + thiết kế · phần lớn **chưa cài**

Trả lời tám câu hỏi đặt ra khi chuẩn bị làm bài 10 chặng B. Đọc kèm `SPEC-tools-approval.md`
(§5 bộ tool · §6 ba đường cắm · §7 chìa khoá · §8 cổng duyệt · §10 trình dựng connector) và
`SPEC-connectors.md` (đặc sản).

**File này KHÔNG chép lại hai spec kia.** Nó làm ba việc chúng chưa làm: ① xếp bốn loại cánh tay
vào một hệ toạ độ để trả lời *"có phải tất cả đều là MCP không"*; ② ghi lại **sáu API MCP của SDK
mà ta chưa dùng** — và mỗi cái đóng một câu hỏi mở đang treo; ③ trả lời ba câu nằm ngoài kỹ thuật
(danh mục · bản quyền · Docker).

---

## 📏 QUY ƯỚC NHÃN — đọc trước, vì cả file dùng

Luật của dự án này: *"đo N lần chứng minh một CƠ CHẾ, không chứng minh một KẾT LUẬN"*
(`SESSIONS_MEMORY` §5n ⑤). Nên mọi khẳng định trong file mang đúng một nhãn:

| Nhãn | Nghĩa |
|---|---|
| ✅ | **Đã chạy thật trong dự án này**, có số đo, tái lập được |
| 📖 | **Đọc từ `.d.ts`** trong `node_modules` — kiểu có thật, **hành vi CHƯA chạy lần nào** |
| 🌐 | **Tra nguồn ngoài**, có ngày. Nguồn ngoài sai được — xem §Nguồn |
| ❓ | **Chưa đo, chưa biết.** Không được xây thiết kế đè lên |

> ⚠ 📖 **không phải** ✅. `canUseTool` từng là 📖 đọc rất thuyết phục và **không nổ một lần nào**
> (`SPEC-tools-approval` §8c). Cả §3 file này là 📖 — nó mở ra nhiều đường, nhưng chưa đường nào
> được chứng minh là đi được.

---

## 0. Bảng chốt

| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | "All is MCP" hay CLI riêng? | **CLI/shell RIÊNG, cố ý riêng.** MCP là định dạng dây cho **thứ người dùng THÊM VÀO**; builtin + shell là **nền**, không phải cánh tay cắm được. §1 |
| 2 | Transport nào | **stdio + Streamable HTTP.** SSE nhận vào để tương thích, dán nhãn *kiểu cũ*, **không bao giờ đề xuất**. §2 |
| 3 | Danh mục lấy từ n8n? | **Không có gì để lấy.** n8n không có danh mục MCP — họ có **2 node MCP tổng quát** + 400 node native. Danh mục là bài toán **curation**, không phải bài toán năng lực. §4 |
| 4 | Support hết hay pick một phần? | **Hết ở tầng GIAO THỨC, một phần ở tầng DANH MỤC.** Ba đường vào, không đường nào chặn ai. §4 |
| 5 | MCP chắc nịch có CONSTANT KEYS? | **Có, và tên biến phải khớp CHÍNH XÁC** — không suy được từ handshake vì nó cần **trước** handshake. §5c |
| 6 | Quăng trường keys cho agent tự đọc? | **KHÔNG. Cấm bằng CẤU TRÚC.** Agent cầm *quyền dùng*, không cầm *chìa*. §5a–5b |
| 7 | Trợ lý biết MCP làm được gì bằng cách nào? | Đọc từ **`mcpServerStatus()`** lúc bắt tay, **không** từ câu người dùng gõ. Trả câu hỏi mở 22/08. §7 |
| 8 | Cắm/sửa/xoá MCP qua UI, không mở yaml | Bắt buộc. Hôm nay bài 10 chặng B có **3 bước 📝 mở file** — đó là **chuông báo**, không phải chuyện bình thường. §6 |
| 9 | Docker có khoá đường ra file hệ thống không? | **CÓ, khoá thật.** Vừa là tin tốt (containment §5b ta đang thiếu) vừa là tin xấu (bài 9 chết, và tường lửa §1b **vỡ tiền đề**). §10 |
| 10 | Dán logo Google có vi phạm không? | Rủi ro là **nhãn hiệu**, không phải bản quyền. Xây tích hợp thì bình thường; **dán logo** mới là chỗ có luật. §11 |

---

## 1. "All is MCP" — không, và đây là hệ toạ độ

### 1a. Bốn loại cánh tay, xếp theo năm câu hỏi

| | **Builtin** `Read` `Write` `Glob` `Grep` `WebSearch` `WebFetch` | **Shell** `Bash`/`PowerShell` | **MCP ngoài** stdio · HTTP | **Connector tự sinh** |
|---|---|---|---|---|
| Ai cung cấp | Claude Code CLI | Claude Code CLI | bên thứ ba | **ta sinh ra từ mô tả của khách** |
| Có **danh tính** không? | ❌ thuộc tính | ❌ thuộc tính | ✅ tiến trình/URL riêng | ✅ |
| Có **schema** không? | ✅ CLI khai | ⚠ đúng **một** trường `command` | ✅ `tools/list` | ✅ ta suy từ cURL/OpenAPI |
| Có **chìa khoá** riêng? | ❌ | ❌ | ✅ | ✅ |
| **Chia sẻ** giữa nhiều agent? | ❌ ai cũng có | ❌ công tắc từng người | ✅ | ✅ |
| **Cắm/rút lúc chạy**? | ❌ | ❌ | 📖 `setMcpServers()` | 📖 |
| Trên sơ đồ | ❌ không node | ❌ công tắc trong bảng chi tiết | ✅ **node** | ✅ **node** |

> **Luật phân loại (đã có từ `SPEC-tools-approval` §5, giờ có lý do đầy đủ):**
> **Thứ có DANH TÍNH thì là NODE. Thứ là THUỘC TÍNH thì là công tắc.**
> Năm hàng giữa của bảng trên chính là định nghĩa của "danh tính".

### 1b. Vì sao shell KHÔNG được biến thành MCP — bốn lý do, và ba cái đầu là kỹ thuật

1. **Nó không phải của ta để biến.** ✅ Đo 22/08: `tools` là allowlist **theo tên** của CLI. Ta xin
   `Bash`, CLI cấp hoặc không cấp. Không có chỗ nào để ta chen một MCP vào thay thế.
2. **Tên đổi theo hệ điều hành.** ✅ Windows cấp `PowerShell`, không có `Bash`. Một cánh tay MCP có
   tên cố định thì mất luôn tính chất này — mà tính chất này là thứ khiến *"zip văn phòng sang máy
   khác vẫn chạy"* đúng.
3. **Nó là ngoại lệ của mọi hàng rào, và ta biết vì sao.** ✅ `officeJail` khớp `file_path` — một
   **trường có tên**. Lệnh shell nhét đường dẫn **lẫn trong chuỗi** (`… > D:\x.md`). Bọc nó vào MCP
   không sinh ra cái trường đó; chỉ đổi chỗ cùng một bài toán parse cú pháp shell trên ba OS.
4. **Kinh tế:** ✅ shell tốn **2 688 token/lượt** (4 547 → 7 235, ~59% trên nền). Vai trò không cần
   thì vẫn phải trả. Đó là lý do công tắc tồn tại, và là lý do **không** đưa nó vào builtin.

### 1c. Nhưng MCP LÀ định dạng dây cho mọi thứ NGƯỜI DÙNG thêm vào

Đây là chỗ trực giác *"all is mcp"* đúng, và đúng ở một tầng khác:

```
người dùng thêm một cánh tay
        │
        ├─ chọn từ danh mục  ─┐
        ├─ dán cấu hình MCP  ─┼─►  McpServerConfig  ──► SDK
        └─ mô tả một API     ─┘         ▲
             (cURL/OpenAPI)              │
                                createSdkMcpServer()  ← ta sinh, chạy TRONG tiến trình
```

**Ba đường vào, MỘT định dạng ra.** Người dùng không bao giờ viết MCP server; MCP là **định dạng
dây nội bộ của ta**. Đúng mệnh đề `SPEC-connectors.md` chốt từ 14/08.

### 1d. Hệ quả chưa ai nói ra: `Bash` đang gánh việc của một MCP chưa tồn tại

Luật §8·0 (chốt 22/08) nói *"mọi đường GHI RA NGOÀI phải qua một tool/MCP TƯỜNG MINH"*. Nhưng hôm
nay việc **ĐỌC** ra ngoài cũng không có tên: ✅ đo 22/08 — vai trò **không có shell** vẫn `Read`
được `D:\bất-kỳ-đâu`, và không hook nào chạy.

**Đề xuất — chưa quyết, cần user chốt:** thay vì dựng hàng rào đọc bằng hook (đã đo là ✅ **dựng
được**, `SPEC-tools-approval` §5b), có một đường thứ hai gọn hơn: **một MCP filesystem cục bộ có
danh sách thư mục được phép**, cắm như mọi cánh tay khác.

| | hàng rào đọc bằng hook | MCP filesystem có allowlist |
|---|---|---|
| Cơ chế | `PreToolUse` chặn `Read` | server chỉ nhận thư mục đã khai |
| Người dùng thấy gì | không thấy gì — hành vi đổi âm thầm | **một node trên sơ đồ**, có tên, kéo dây cho ai thì người đó với tới |
| Đặc quyền tối thiểu | theo `inputs` của task | **theo thư mục**, người dùng tự chọn |
| Nhật ký | như mọi tool | tên tool `mcp__files__*` — **đọc được ngay** |
| Rủi ro | ❓ chặn nhầm một lượt đọc hợp lệ | ❓ người dùng phải hiểu khái niệm "thư mục được phép" |
| Chi phí token | 0 | ❓ **chưa đo** — xem §9 |

⚠ **Hai đường này KHÔNG loại trừ nhau và cũng không thay thế nhau.** Hook chặn `Read` builtin; MCP
mở một đường **thứ hai** có kiểm soát. Bật MCP mà không dựng hook thì `Read` trần vẫn đi vòng qua —
**đúng hình dạng của `officeJail`**: cấm cửa tử tế, để cửa sau mở. Nếu chọn hướng MCP thì **phải
làm cả hai**, hoặc không làm gì cả.

---

## 2. Transport — tra lại đặc tả, tháng 8/2026

### 2a. Đặc tả nói gì 🌐

| Transport | Trạng thái 23/08/2026 |
|---|---|
| **stdio** | ✅ chuẩn, cho server chạy trên máy |
| **Streamable HTTP** | ✅ chuẩn cho remote. Vào từ bản `2025-03-26`, **thay thế** HTTP+SSE |
| ~~HTTP+SSE~~ | ❌ bản `2024-11-05`, **đã bị thay** |

🌐 Bản `2026-07-28` (release candidate) làm Streamable HTTP **stateless**: bỏ session ở tầng giao
thức và bỏ header `Mcp-Session-Id`, để một request bất kỳ được trả lời bởi bất kỳ instance nào sau
hạ tầng HTTP thường.

**Ý nghĩa với ta, và nó không nhỏ:** một MCP remote stateless **cắm được sau load balancer**, tức
là chi phí vận hành của một cánh tay HTTP giảm hẳn. Nếu sau này agentco tự host một MCP (ví dụ
connector chia sẻ giữa khách hàng, `SPEC-connectors` §8 M3) thì đây là hình dạng nên nhắm.

❓ **Chưa đo:** CLI trong SDK 0.3.231 nói phiên bản giao thức nào. Đừng hứa gì về `2026-07-28` cho
tới khi hỏi thẳng nó.

### 2b. SDK nhận gì 📖 — `sdk.d.ts@0.3.231`

```ts
type McpServerConfig =
  | McpStdioServerConfig   // { command, args?, env?, timeout?, alwaysLoad? }
  | McpSSEServerConfig     // { type:'sse',  url, headers?, tools?, timeout?, alwaysLoad? }  ← kiểu cũ
  | McpHttpServerConfig    // { type:'http', url, headers?, tools?, timeout?, alwaysLoad? }
  | McpSdkServerConfigWithInstance   // { type:'sdk', name, instance }  ← chạy TRONG tiến trình ta
```

Và một dạng thứ năm **chỉ xuất hiện ở phía trạng thái**, không truyền vào được:

```ts
type McpClaudeAIProxyServerConfig = { type:'claudeai-proxy'; url; id; timeout? }
```

> 📖 **`claudeai-proxy` đáng ghi lại dù chưa dùng được.** Nó là hình dạng của **connector claude.ai**
> — tức Anthropic đã có một đường proxy có sẵn OAuth cho các dịch vụ lớn. Ta **không truyền vào
> được** qua `mcpServers`, nên hôm nay nó vô dụng với ta. Nhưng nếu đường đó mở ra, nó xoá gần hết
> §5 (chìa khoá) và cả bước B1–B3 của bài 10 (tự tạo OAuth client trong Google Cloud) — **rào chắn
> lớn nhất còn lại với người non-code**. Đáng theo dõi, **không** đáng chờ.

### 2c. Chốt giao diện

Người dùng **không bao giờ đọc chữ "transport"**. Hai lựa chọn, bằng tiếng người:

```
Cánh tay này chạy ở đâu?
  ○ Trên máy này          → stdio      (đọc file của bạn, chạm mạng LAN, chạy trên VPS của bạn)
  ○ Ở một dịch vụ ngoài   → http       (dán URL + chìa)
```

`sse` **không có trong danh sách**. Nó chỉ xuất hiện khi người dùng **dán một config đã có** `type:
'sse'` — lúc đó nhận vào, chạy được, và hiện nhãn *"kiểu cũ — nên xin bên cung cấp bản Streamable
HTTP"*. **Không bao giờ đề xuất SSE cho một cánh tay mới.**

---

## 3. 📖 SÁU THỨ SDK ĐÃ CÓ MÀ SPEC HIỆN TẠI CHƯA BIẾT

Đây là phần có giá trị nhất của file này. Mỗi dòng đóng một câu hỏi đang treo trong specs.

| # | API 📖 | Đóng câu hỏi nào |
|---|---|---|
| 1 | `Query.mcpServerStatus(): Promise<McpServerStatus[]>` | **Câu hỏi mở 22/08** — Trợ lý biết MCP làm được gì. §7 |
| 2 | `Query.setMcpServers(record): Promise<{added, removed, errors}>` | **Cắm/rút không restart** + nút **Thử ngay** cho MCP. §6 |
| 3 | `Query.getContextUsage() → mcpTools[{name, serverName, tokens, isLoaded}]` | **Giá token của từng cánh tay, ĐO ĐƯỢC**. §9 |
| 4 | `onElicitation` với `mode:'url'` | **OAuth cho người non-code** — server xin mở trình duyệt. §6 |
| 5 | `McpServerToolPolicy{name, permission_policy}` trên config http/sse | **Cổng duyệt theo từng tool, do SDK làm sẵn**. §8 |
| 6 | `alwaysLoad?: boolean` + "tools are deferred when tool search is enabled" | Token của MCP **có thể không nằm trong prefix**. §9 |

### 3a. `McpServerStatus` — mỏ vàng, và nó có `annotations`

```ts
type McpServerStatus = {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  serverInfo?: { name: string; version: string };
  error?: string;                    // khi status === 'failed'
  config?: McpServerStatusConfig;
  scope?: string;
  tools?: {
    name: string;
    description?: string;
    annotations?: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean };
  }[];
};
```

Ba trường đổi thiết kế:

- **`status` năm giá trị, không phải hai.** `needs-auth` là một **trạng thái riêng** — nó chính là ô
  *"⚠ token hết hạn [Sửa]"* mà `SPEC-connectors` §6 đã vẽ từ 14/08 nhưng chưa có nguồn dữ liệu.
- **`tools[]` là SỰ THẬT**, đối lập với tên server là **lời khai**. → §7.
- **`annotations`** cho ta cơ sở phân mức duyệt thay vì đoán. → §8.

⚠ **`tools?` là optional và chỉ có khi `connected`.** Thiết kế phải trả lời được câu *"chưa bắt tay
được thì Trợ lý đọc gì"* — §7c.

### 3b. `setMcpServers` — và một cái bẫy nằm ngay trong tài liệu của nó

📖 `.d.ts` nói thẳng: server **do plugin cung cấp** được miễn trừ — bỏ chúng khỏi payload **không**
gỡ chúng ra, và `setMcpServers({})` **không** bảo đảm phiên có 0 MCP động khi có plugin nạp.

> Đây đúng họ **allowlist im lặng bỏ tên lạ** ([[agentco-silent-allowlist]]): một lời gọi trông như
> "đặt lại toàn bộ" mà thực ra là "đặt lại một phần". ✅ Ta đã truyền `strictMcpConfig: true` và
> `settingSources: []` nên **có lẽ** không có plugin nào — nhưng "có lẽ" không phải một bất biến.
> **Phải đối chiếu kết quả trả về với thứ ta gửi**, đúng cùng cơ chế `warnDroppedTools` đã dựng cho
> `tools`.

---

## 4. Danh mục — n8n không có gì để chép, và đó là câu trả lời

### 4a. Đi tra thật 🌐

| Nguồn | Thấy gì |
|---|---|
| **n8n docs** | Đúng **hai** node MCP: `MCP Client Tool` (nối tới server ngoài — **một ô URL**, không danh mục) và `MCP Server Trigger` (biến workflow n8n **thành** một MCP server, hỗ trợ SSE + Streamable HTTP) |
| **n8n integrations** | **400+ node native** (Google, Slack, Notion, Airtable, HubSpot…) + 500–600 gói community trên npm |
| **`modelcontextprotocol/servers`** | Danh sách server bên thứ ba **đã bị gỡ 14/04/2026**, chuyển sang `registry.modelcontextprotocol.io`. Chỉ còn **7 server tham chiếu**: Fetch · Filesystem · Git · Memory · Sequential Thinking · Time · Everything |
| Server tham chiếu cũ | GitHub, GitLab, Google Drive, PostgreSQL, Slack, Puppeteer, Brave Search, Redis, Sentry, Google Maps… **đã đưa vào `servers-archived`** cuối 2025 – đầu 2026 |

**Ba kết luận, và cái thứ ba là cái đáng tiền:**

1. **Danh mục MCP của n8n không tồn tại.** Câu hỏi *"list mcp chắc và phổ biến của họ"* không có
   đáp án vì họ không chơi ván đó: giá trị của n8n nằm ở **400 node native tự viết**, còn MCP với
   họ chỉ là **một ô URL tổng quát**.
2. **Anthropic cũng đã rút khỏi việc curate.** Danh sách bên thứ ba bị gỡ, các server danh tiếng bị
   archive. Nghĩa là **không có danh sách có thẩm quyền nào để copy** — ai muốn có danh mục thì phải
   tự chịu trách nhiệm về nó.
3. ⇒ **Câu hỏi "support hết hay pick một phần" hỏi nhầm tầng.**

### 4b. Tách hai tầng, và câu hỏi có hai đáp án khác nhau

| Tầng | Câu hỏi thật | Đáp |
|---|---|---|
| **Giao thức** | ta có nối được tới MCP server bất kỳ không? | **HẾT.** Đó là điểm của một giao thức — support `stdio` + `http` là support mọi server đã và sẽ có. Chi phí bằng 0 cho mỗi server thêm |
| **Danh mục** | ta **đứng tên bảo đảm** cho cái nào? | **RẤT ÍT.** Mỗi mục trong danh mục là một lời hứa ta phải bảo trì |

> **Một mục danh mục KHÔNG phải một dòng dữ liệu — nó là một CAM KẾT.** Nó gồm: tên gói + phiên bản
> · tên biến chìa khoá chính xác · hướng dẫn lấy chìa ở đâu (**ảnh chụp màn hình của bên thứ ba sẽ
> cũ đi**) · logo (§11) · và **trách nhiệm khi bên kia đổi API**. Danh mục 40 mục = 40 thứ hỏng âm
> thầm, và chúng hỏng **ở máy khách**, không ở máy ta.

### 4c. Ba đường vào — không đường nào chặn ai

| Đường | Người dùng làm | Ta bảo đảm gì | Số mục |
|---|---|---|---|
| **A · Danh mục** | chọn, điền 1–2 ô, bấm Thử | tên biến đúng · hướng dẫn lấy chìa · đã chạy thử | **ít, curate tay** |
| **B · Dán cấu hình** | dán khối JSON từ README của server | **kết nối được hay không, và nói thật** | **vô hạn** |
| **C · Connector tự sinh** | dán cURL / OpenAPI / điền form | schema · mức duyệt · chìa được tiêm | **vô hạn** |

**Người dùng không bao giờ bị chặn.** Danh mục chỉ là **đường tắt cho ca phổ biến**, không phải hàng
rào. Đây cũng là câu trả lời cho nỗi lo *"pick một phần thì khách cần cái thứ 41 làm sao"* — họ dán
config, mất thêm 2 phút, và **không phải chờ ta ra bản mới**.

### 4d. Năm tiêu chí để một MCP được vào danh mục

Một mục chỉ vào danh mục khi **cả năm** đúng — cùng kỷ luật với thước "thêm tool builtin"
(`SPEC-tools-approval` §5c):

1. **Người dùng văn phòng thật sự cần** — không phải lập trình viên cần.
2. **Có người bảo trì rõ ràng** (chính chủ dịch vụ, hoặc một gói có lịch sử phát hành đều).
3. **Cắm được mà không phải tạo OAuth client thủ công** — nếu bắt vào Google Cloud Console tạo
   project thì nó **chưa** đủ điều kiện làm mục danh mục cho người non-code (⚠ đây là chỗ Google
   trượt hôm nay — xem 4e).
4. **Ta đã tự chạy thử end-to-end**, và số liệu token của nó đã đo (§9).
5. **Điều kiện logo/tên đã đọc** và ghi vào hồ sơ thương hiệu của mục đó (§11).

### 4e. ⚠ Đề xuất danh mục v1 — **CHƯA CHỐT, cần user quyết**

Xếp theo *đau bao nhiêu nếu thiếu* × *dễ bao nhiêu*:

| | Cánh tay | Vì sao | Vướng |
|---|---|---|---|
| 1 | **Filesystem** (server tham chiếu chính chủ) | trả lời §1d: đường ĐỌC file người dùng **có tên, có allowlist thư mục** | ❓ token chưa đo · trùng chức năng `Read` |
| 2 | **Fetch** (chính chủ) | lấy nội dung web **có tên**, thay `WebFetch` không hàng rào | ❓ có đáng không khi `WebFetch` đã bật sẵn |
| 3 | **Google Workspace** (Drive/Sheets/Docs) | ✅ use case số 1 của khách văn phòng | ⚠ **trượt tiêu chí 3** — phải tự tạo OAuth client. Chỉ vào được nếu tìm ra đường khác |
| 4 | **Notion** | kho tri thức của rất nhiều đội nhỏ | token tĩnh, dễ |
| 5 | **Slack** | ⚠ server tham chiếu **đã bị archive** — phải chọn gói thay thế và chịu trách nhiệm | |
| 6 | **Postgres/MySQL chỉ-đọc** | "hỏi cơ sở dữ liệu của tôi" — mạnh, và **`readOnly` làm cổng duyệt thành trivial** | khách non-code có DSN không? |

**Ba câu tôi cần user trả lời trước khi viết một dòng danh mục nào:**

- **(a) Danh mục v1 có nên chỉ có 2 mục không** — Filesystem + Notion — để **danh mục ra đời cùng
  cơ chế**, rồi mở rộng theo khách thật? Ngược lại là đoán 6 mục mà chưa có khách nào hỏi.
- **(b) Google có nằm trong v1 không**, khi biết trước là nó **kéo theo cả một luồng OAuth** mà ta
  chưa dựng, và bài 10 chặng B đang mắc đúng ở đó?
- **(c) Mục danh mục nào ta CHƯA tự chạy được end-to-end thì có được xuất hiện không?** Nghiêng
  mạnh về **không** — một mục danh mục hỏng còn tệ hơn không có mục nào, vì nó tiêu **niềm tin**,
  thứ đắt nhất với người non-code (`SESSIONS_MEMORY` §5l ②).

---

## 5. Chìa khoá — trả lời thẳng ba câu của user

### 5a. Agent **không** cầm chìa. Ba đường tiêm, không đường nào đi qua prompt

> **Câu hỏi:** *"agent workers không cần biết keys, cứ kích hoạt là chạy? Hay quăng 1 trường keys
> vào agent tự đọc rồi nó tự tìm cách kết nối?"*
>
> **Đáp: vế đầu. Kích hoạt là chạy. Agent KHÔNG BAO GIỜ nhìn thấy một giá trị chìa nào.**

| Loại cánh tay | Chìa đi đâu | Ai tiêm | Model thấy gì |
|---|---|---|---|
| **stdio** | `env` của **tiến trình con** | ✅ `pickMcp()` (`worker.ts:618`) | tên tool, không thấy env |
| **Streamable HTTP** | header `Authorization` trong `McpHttpServerConfig.headers` | ta, lúc dựng config | tên tool, không thấy header |
| **Connector tự sinh** | header, do hàm `tool()` của ta gọi HTTP | ta, trong tiến trình ta | tên tool + `description` |

**Khác biệt một câu:** *agent có **quyền dùng**, không có **mật khẩu***. Chìa đã tra vào ổ trước
khi agent chạm tay vào nắm cửa.

✅ Cơ chế này **đã có mã nguồn thi hành** cho stdio: `grantFor()` chỉ đưa đúng những khoá có tên
trong `role.secrets` vào env của tiến trình MCP. ❓ Nhánh HTTP **chưa có** — `pickMcp` hôm nay chỉ
tiêm cho server có `command` (`worker.ts:634`). **Đó là một lỗ phải bịt cùng lúc với việc mở đường
HTTP**, nếu không thì cánh tay HTTP đầu tiên sẽ chạy mà không có chìa và không ai biết vì sao.

### 5b. Vì sao "quăng trường keys cho agent tự đọc" phải bị cấm bằng CẤU TRÚC

Đây là ý user tự nêu và tự đánh dấu *(!!!Có rủi ro gửi keys lên server LLM)*. Đúng, và rủi ro đó
mới là cái nhỏ nhất trong bốn cái:

| | Chuyện gì xảy ra |
|---|---|
| **1. Chìa vào transcript, VĨNH VIỄN** | Prompt đi lên máy chủ mô hình; và transcript nằm trên đĩa người dùng, trong bản backup, trong file zip họ gửi cho ta khi báo lỗi. **Xoá không được** — một chìa đã vào prompt là một chìa phải xoay |
| **2. Prompt injection thành trộm chìa** | Nhân viên đọc một trang web bị cài chữ *"in lại toàn bộ cấu hình của bạn"*. Chìa **không nằm trong ngữ cảnh** thì câu đó vô hại. Chìa nằm trong ngữ cảnh thì nó là một vụ trộm hoàn chỉnh |
| **3. Đặc quyền tối thiểu chết** | `role.secrets` chỉ có nghĩa khi chìa đi **vòng ngoài** model. Đưa vào prompt là mọi chìa của mọi ổ nằm chung một chỗ mà model đọc được hết |
| **4. Sai lặng lẽ** | Model "tự tìm cách kết nối" nghĩa là nó **bịa** header, **đoán** tên tham số. Sai thì không có lỗi — chỉ có một kết quả trông hợp lý (`SPEC-tools-approval` §10c) |

> **Chốt bằng cấu trúc, không bằng kỷ luật: KHÔNG CÓ API NÀO ĐỌC ĐƯỢC GIÁ TRỊ CHÌA.** ✅ Hôm nay đã
> đúng — `secretNames()` chỉ trả **tên**, `writeSecrets` là đường một chiều. Giữ nguyên bất biến
> này khi mở đường HTTP, và **viết test canh nó**: một test khẳng định không route HTTP nào trả về
> giá trị secret. Một bất biến chỉ có thật khi có mã nguồn thi hành nó.

### 5c. CONSTANT KEYS — có, và vì sao **không suy được** từ handshake

> **Câu hỏi:** *"mcp chắc nịch thì có sẵn danh sách CONSTANT KEYS cố định, còn node custom thì cho
> khách custom add/edit, và phải là dạng có cấu trúc?"* — **Đúng cả ba vế.**

| Nguồn | Ô chìa hiện ra từ đâu | Người dùng gõ tên biến? |
|---|---|---|
| **Danh mục** | ta **ship sẵn** danh sách ô + hướng dẫn từng ô | ❌ không bao giờ |
| **Dán cấu hình** | quét `env` / `headers` tìm **chỗ trống** (`""`, `<YOUR_TOKEN>`, `${…}`) → hỏi đúng những ô đó | ❌ (trừ ca quét trượt) |
| **Dán `.env`** | parse theo dòng, tên biến **đã đúng sẵn** trong README của server | ❌ họ **chép**, không gõ |
| **Connector tự sinh** | suy từ chính cURL đã dán — `Bearer abc123` → một ô, gợi tên `SHOP_TOKEN` | ❌ |

**⚠ Bất biến bắt buộc, và nó là lý do CONSTANT KEYS phải cố định:**

> **Tên biến chìa khoá KHÔNG suy được từ giao thức MCP — nó cần TRƯỚC handshake.**
> MCP Notion đọc `NOTION_TOKEN`. Không có `tools/list` nào nói *"tôi cần biến tên gì"*, vì đó là
> yêu cầu **lúc khởi động tiến trình**, xảy ra **trước** khi bắt tay. Sai tên = tiến trình chết =
> ✅ `status: 'failed'` + `error` (§3a) — **biết là hỏng, không biết vì sao hỏng**.

Ba tầng để người non-code không bao giờ phải gõ tên biến: **danh mục curate → quét config dán vào
→ chạy thử rồi đọc `error`**. Tầng ba là lưới an toàn, không phải đường chính.

**Dạng có cấu trúc — chốt:** ô riêng cho từng khoá, `type: password`, hiện `••••••••` sau khi lưu,
**có nút Thử ngay ở cùng màn hình**. Cộng một **textarea `.env`** làm đường thứ hai cho người dán
từ README (`SPEC-tools-approval` §12 — luật parse `.env` đã viết ở đó, không chép lại).

### 5d. 🔴🔴 LỖ THẬT ĐANG MỞ — **mọi nhân viên đọc được toàn bộ chìa khoá của công ty**

Tìm ra khi soi §5 để viết mục này. **Đây không phải suy đoán về thiết kế; đây là bố cục thư mục
hiện tại cộng với hai phép đo đã có.**

```
company/
├─ .state/secrets.json      ← MỌI chìa của MỌI văn phòng, plaintext
└─ offices/<id>/            ← cwd của worker
```

Từ `cwd` của một worker, kho chìa nằm ở `../../.state/secrets.json`.

| Mảnh | Trạng thái |
|---|---|
| `Read` **không có hàng rào nào**, đọc được đường dẫn tuyệt đối bất kỳ | ✅ đo 22/08 |
| `Bash` **bật sẵn** cho nhân viên mới, không hàng rào | ✅ chốt 22/08 |
| `secrets.json` là JSON phẳng, plaintext, tên file đoán được | ✅ `secrets.ts:45` |
| `grantFor()` giới hạn chìa vào **env tiến trình MCP** | ✅ chạy đúng |

⇒ **`grantFor` bảo vệ đúng một cánh cửa, trong khi cánh cửa cạnh nó không có khoá.** Một nhân viên
bị prompt injection qua nội dung nó đọc trên web chỉ cần một lời gọi `Read` là cầm hết chìa của cả
công ty — kể cả chìa của những văn phòng nó chưa bao giờ được nối vào.

> ⚠ **Chú thích đầu `secrets.ts` nói: *"`.state/` không có cửa nào ra ngoài"*.** Câu đó **đúng về
> HTTP** (`ArtifactStore.resolve` chỉ nhận đường dẫn trong `artifacts/`) và **sai về agent**. Đây
> **chính xác** biến thể đã ghi ở `SPEC-tools-approval` §5b: *câu cũ NÊU TÊN một cơ chế CÓ THẬT,
> chạy đúng, và bảo vệ một thứ KHÁC.* Lần thứ hai, cùng một file lớp bảo mật. ⇒ [[agentco-catch-hides-premises]]

**Ba đường sửa, chưa chọn — cần user quyết:**

| | Cách | Được | Mất |
|---|---|---|---|
| **A** | `PreToolUse` chặn mọi `Read`/`Grep`/`Glob` chạm `.state/` (deny + câu giải thích) | rẻ nhất, **hẹp**, ✅ cơ chế đã đo là chạy | không chặn `Bash` (không có trường để đọc — cùng bài toán §8·0) |
| **B** | Không để chìa ở dạng đọc được: mã hoá tại chỗ, khoá ở keychain OS | chặn cả `Bash` | phức tạp thật, khác nhau ba OS, ❓ và trong Docker thì keychain là gì |
| **C** | Đưa kho chìa **ra ngoài** cây `company/` hẳn (`~/.agentco/secrets.json`) | rẻ, chặn được ca "grep quanh cwd" | ❌ **không chặn** đường dẫn tuyệt đối — cùng lỗi tiền đề với `safeJoin`. **Đây là phương án trông ổn mà không phải** |

Nghiêng về **A ngay lập tức** (nó hẹp, có mã nguồn thi hành, đo được trong 10 phút) và **B là đích
đến**. **C phải bị loại tường minh** để không ai đề xuất lại — ghi ra đây chính vì nó nghe hợp lý.

⚠ **Ranh giới của A phải nói thẳng:** A **không** đóng lỗ, nó **thu hẹp** lỗ. `Bash` vẫn `type`
được file đó. Nói A "đã bịt lỗ" là đẻ ra lời hứa thứ tư. Ca này chỉ đóng hẳn khi §8·0 có mã nguồn,
hoặc khi chạy trong Docker với `.state/` không mount (§10).

---

## 6. Cắm qua UI — hôm nay có **ba** bước "mở file yaml", và đó là chuông báo

### 6a. Đếm chuông

Luật của dự án (`SESSIONS_MEMORY` §5n ①): *một bước "mở file yaml" trong hướng dẫn của sản phẩm
này **luôn** là chuông báo.* Bài 10 chặng B hiện có:

| Bước | Bảo người dùng làm gì | Tính năng còn thiếu |
|---|---|---|
| B3 ⌨ | chạy `node dist/cli/index.js secret set …` trong PowerShell | **màn hình nhập chìa** |
| B4 📝 | mở `company/company.yaml` gõ `mcpServers:` | **màn hình thêm cánh tay** |
| B6 📝 | mở `roles/<id>.yaml` gõ `mcp:` + `secrets:` | **kéo dây trên sơ đồ ⇒ cấp chìa** |
| B7 ⌨ | `stop` / `start` | 📖 `setMcpServers()` — **không cần restart** |

**Bốn chuông trong một bài test.** Đây là danh sách việc của §6, không phải một lời phàn nàn.

### 6b. Bốn màn hình, mỗi màn trả lời đúng một câu

| Màn hình | Trả lời câu nào của người dùng | Nguồn dữ liệu |
|---|---|---|
| **Thêm cánh tay** | *"làm sao để nhân viên với tới Notion?"* | danh mục / dán config / connector |
| **Ô chìa** | *"lấy token này ở đâu?"* | `secrets` của mục danh mục, hoặc quét config |
| **Thử ngay** | *"tôi điền đúng chưa?"* | 📖 `setMcpServers()` → `errors` + `mcpServerStatus()` |
| **Nút xoá / ngắt** | *"tôi thôi không dùng nữa"* | 📖 `setMcpServers()` → `removed` |

**Kéo dây trên sơ đồ = cấp quyền dùng.** ✅ Cạnh `mcp → agent` đã ghi vào `roles/<id>.yaml`
(`layout.ts:197`) — cơ chế có sẵn. Thứ còn thiếu là **`secrets:` phải đi theo cạnh nối**, thay vì
bắt người dùng khai riêng: đúng chốt §7a của `SPEC-tools-approval` (*"nối dây là xong, chìa đi theo"*),
và nó xoá bước B6.

### 6c. Nút **Thử ngay** cho MCP — khác connector ở một chỗ quan trọng

`SPEC-tools-approval` §10b đã chốt: *không cho Lưu khi chưa Thử thành công một lần*. Với MCP,
"thành công" có **năm** mức chứ không phải hai (📖 `McpServerStatus.status`):

```
✓ connected · 8 việc                      → cho Lưu
⚠ needs-auth                              → hiện nút "Đăng nhập" (§6d), CHƯA cho Lưu
⏳ pending                                 → còn chờ, đừng kết luận
✗ failed · "spawn npx ENOENT"             → không cho Lưu + chỉ đúng chỗ sai
○ disabled                                → người dùng tự tắt
```

> ⚠ **`failed` phải hiện NGUYÊN VĂN `error`.** Nó là chuỗi duy nhất người dùng copy đi hỏi chỗ khác
> được. Cùng lý do `planProblemsMessage` không giấu danh sách lỗi (`SESSIONS_MEMORY` §5n ㉗).

### 6d. OAuth cho người non-code — 📖 `onElicitation` là đường đã có sẵn

```ts
type ElicitationRequest = {
  serverName: string;
  message: string;
  mode?: 'form' | 'url';     // 'url' = xác thực qua trình duyệt
  url?: string;
  elicitationId?: string;
  requestedSchema?: Record<string, unknown>;   // 'form'
  title?: string; displayName?: string; description?: string;
};
```

Nghĩa là: MCP server **tự xin** người dùng mở một URL để đăng nhập, và SDK đưa yêu cầu đó **ra tay
ta**. Ta hiện nó trong luồng chat — **cùng chỗ, cùng hình dạng với cổng duyệt §8b**:

```
⏸ Google muốn bạn đăng nhập một lần
   [Mở trang đăng nhập]   [Thôi]
```

**Ba ràng buộc, và cái thứ ba là bài học đã trả tiền:**

1. 📖 **Fail-closed.** `.d.ts` nói: trả `null` nhầm thì **không có phản hồi nào được gửi** và
   elicitation treo tới khi server tự hết giờ. Phải luôn trả một kết quả tường minh, kể cả khi
   người dùng bỏ qua.
2. ✅ **"Mở trang" mở trên MÁY CHỦ.** Đúng ca nút 📂 (`SESSIONS_MEMORY` §5n ㉑): dùng lại
   `isLoopback(req.socket.remoteAddress)`; không cùng máy thì **chép URL vào clipboard** kèm câu
   giải thích, không im lặng mở một cửa sổ ở Singapore.
3. **Elicitation là một cuộc hội thoại có hạn giờ trong lúc một task đang chạy.** ❓ Chưa biết nó
   tương tác thế nào với `abortController` và với trần chi phí. Phải đo — §12.

---

## 7. Trợ lý phải biết **NĂNG LỰC**, không phải **TÊN**

### 7a. Câu hỏi mở 22/08, trả ở đây

> `SESSIONS_MEMORY` §4: *"Danh bạ hiện liệt kê MCP bằng **TÊN** (`notion`), không bằng **NĂNG LỰC**.
> Trợ lý đọc được 'với tới Notion', không đọc được 'ghi được file'. Khi làm §6 phải quyết: sinh
> dòng năng lực từ danh sách tool thật MCP khai lúc handshake, hay bắt người dùng gõ tay?"*

**Chốt: đọc từ handshake.** 📖 `mcpServerStatus().tools[]` là nguồn. Bắt người dùng gõ tay là đẻ ra
**lời khai thứ hai**, tức là ca ⑱ (`pitch` vs `tools`) lặp lại thấp hơn một tầng.

> **Luật đã có, áp thẳng:** *cái gì Trợ lý dùng để **CHỌN NGƯỜI** thì phải là sự thật đọc từ
> config/handshake, không phải câu người dùng gõ.* Cùng họ `landingOf` (suy từ tool đã gọi) và
> `agentFault` (quyết từ `Receipt.failure`).

### 7b. Nhưng **KHÔNG** liệt kê tên tool thô — và đây là chỗ dễ làm hỏng token

Một MCP Notion khai ~15 tool. Liệt kê tên tool vào danh bạ = **15 dòng × mỗi MCP × mỗi nhân viên**,
nằm trong prefix được cache của Trợ lý, trả ở **mọi lượt gõ phím** (`route()` resume liên tục).

**Chốt: gom thành một cụm ngắn, sinh bằng CODE từ `annotations` + tên server.**

```
- nguoi-don (Người dọn tài liệu): Tìm, đọc và cập nhật tài liệu… [Google: đọc·ghi · chạy lệnh: TẮT]
- nguoi-viet (Người viết): Viết nội dung tiếng Việt…             [Notion: đọc · web · chạy lệnh: BẬT]
```

`đọc` / `ghi` / `xoá được` suy từ `annotations.readOnly` / `destructive`. ❓ **Chưa đo giá thật** —
ước ~4–8 token/MCP/vai trò, nhưng ước sai đã xảy ra hai lần trong dự án này (2 688 token và ngưỡng
hoà vốn 4 nhân viên). **Đo trước khi chốt định dạng.**

### 7c. ⚠ Hai cái bẫy đã trả tiền một lần, đừng dẫm lại

**Bẫy 1 — vắng mặt không phải tín hiệu** (ca ㉔, [[agentco-deterministic-vs-signal]]). Nếu định dạng
chỉ nêu mặt khẳng định thì văn phòng **không ai** có Notion ⇒ chuỗi `Notion` không xuất hiện ⇒ Trợ
lý không đọc ra được gì. ⇒ **Định dạng phải giữ bất biến đã chốt cho `SHELL_LEGEND`: *dòng của mỗi
người liệt kê ĐỦ nơi họ với tới*.** Câu này tự đúng dù thêm bao nhiêu năng lực, và đã có test canh.

**Bẫy 2 — handshake hỏng thì danh bạ nói gì?** 📖 `tools?` chỉ có khi `connected`. `pending` /
`failed` / `needs-auth` thì ta **không biết** nó làm được gì.

> **Chốt: không biết thì nói KHÔNG BIẾT, không im lặng và không đoán.**
> `[Google: chưa kết nối được]` — Trợ lý đọc ra là *"có cánh tay này nhưng đang hỏng"*, khác hẳn
> *"không có cánh tay này"*. Im lặng ở đây tái tạo **chính xác** ca 9.3: giao việc cho người không
> có tay, tiêu tiền để phát hiện ra điều đó.

⚠ **Kèm theo — điều kiện cache:** danh bạ nằm trong prefix của Trợ lý. Một MCP nhấp nháy
`connected` ↔ `pending` sẽ **bump cacheKey mỗi lần**. ⇒ Trạng thái vào danh bạ phải **ổn định hoá**
(chỉ đổi khi đứng yên đủ lâu), đúng luật *"HOT phải ỔN ĐỊNH"* của kho tri thức.

---

## 8. Cổng duyệt cho MCP — `annotations` là nguồn, nhưng chỉ theo MỘT chiều

### 8a. Suy mức duyệt từ annotations 📖

`SPEC-tools-approval` §8a chốt bốn mức và ghi *"không khai thì mặc định `write_external` — an toàn
khi không biết"*. Giờ có nguồn tốt hơn một lời khai của người dùng:

| `annotations` | Mức đề xuất |
|---|---|
| `readOnly: true` | `read` |
| không có annotation | **`write_external`** (mặc định an toàn — giữ nguyên) |
| `destructive: true` | **`irreversible`** — duyệt lại **từng lần** |
| `openWorld: true` | dấu hiệu chạm ra Internet ⇒ **không được hạ mức** |

### 8b. ⚠⚠ Luật một chiều — annotations là **GỢI Ý của server**, không phải bảo đảm

🌐 Đặc tả MCP gọi chúng là *hints* và nói rõ **client không được tin chúng như bảo đảm an toàn**.
Một server viết ẩu (hoặc cố ý) khai `readOnly: true` cho một tool xoá dữ liệu.

> **Chốt: `annotations` chỉ được dùng để LEO THANG, không bao giờ để HẠ CẤP.**
>
> - `destructive: true` ⇒ nâng lên `irreversible` — **tin**, vì tin nhầm chỉ tốn một lần bấm nút.
> - `readOnly: true` ⇒ **KHÔNG** tự động hạ xuống `read`. Muốn hạ thì phải có **người dùng bấm**
>   *"cánh tay này chỉ đọc, đừng hỏi tôi nữa"* — một hành động có chủ thể, ghi được vào nhật ký.
>
> Lý do là bất đối xứng: leo thang sai tốn một cú click; hạ cấp sai **xoá dữ liệu của khách hàng
> mà không ai được hỏi**. Cùng luật *"không chứng minh được thì rơi về phía an toàn"* — và ở đây
> phía an toàn ngược chiều với ca `canWriteOutside` (nơi không chứng minh được thì **cho qua**, vì
> phủ định sai chặn im lặng một việc vốn chạy được). ⚠ **Hai ca ngược chiều nhau, và đó là đúng:**
> ở kia hậu quả của chặn nhầm là im lặng; ở đây hậu quả của cho qua nhầm là **mất dữ liệu**.

### 8c. 📖 `McpServerToolPolicy` — SDK làm sẵn tầng 2, nhưng **chỉ cho remote**

```ts
type McpServerToolPolicy = {
  name: string;
  permission_policy?: 'always_allow' | 'always_ask' | 'always_deny';
  org_max_permission?: 'allow' | 'ask' | 'blocked';
};
```

📖 Chú thích `.d.ts`: *"carried on `mcp_set_servers` **for remote servers**"*, và trường `tools?`
chỉ có trên `McpHttpServerConfig` / `McpSSEServerConfig` — **không** trên `McpStdioServerConfig`.

| | có `tools` policy? |
|---|---|
| Streamable HTTP · SSE | ✅ 📖 |
| **stdio** | ❌ |
| **connector tự sinh** (`sdk`) | ❌ — nhưng **không cần**: ta tự chạy tác vụ, cổng duyệt nằm trong hàm của chính ta |

⇒ **Ba đường, ba cơ chế duyệt khác nhau.** Đây là một chỗ lệch có thật, phải thiết kế cho nó chứ
đừng giả vờ là một:

| Loại | Cổng duyệt bằng gì |
|---|---|
| HTTP/SSE | 📖 `McpServerToolPolicy.always_ask` — SDK lo |
| stdio | ❓ `canUseTool` hoặc `PreToolUse` matcher `mcp__<server>__*` — **`PreToolUse` khớp được tool MCP mới chỉ là "về nguyên tắc", CHƯA ĐO** (`SPEC-tools-approval` §8·0) |
| connector | code của ta, chắc chắn chạy |

> ⚠ **stdio là ca yếu nhất và cũng là ca phổ biến nhất** (`npx -y …` là hình dạng của gần như mọi
> MCP hôm nay). Nếu phép đo ở §12 cho thấy cả `canUseTool` lẫn `PreToolUse` đều không khớp tool
> MCP, thì **cổng duyệt cho stdio không tồn tại**, và lựa chọn còn lại là: bọc mọi stdio server
> vào một proxy `createSdkMcpServer` của ta. Đắt, nhưng nó là đường duy nhất còn lại. **Đừng lên
> lịch cho §8 trước khi có phép đo này.**

---

## 9. Giá token của một cánh tay — **đo được, và chưa ai đo**

### 9a. 📖 Có sẵn một phép đo chính xác tới từng tool

```ts
getContextUsage() → {
  mcpTools: { name: string; serverName: string; tokens: number; isLoaded?: boolean }[];
  systemTools?: { name: string; tokens: number }[];
  categories: { name: string; tokens: number; isDeferred?: boolean }[];
  totalTokens: number; maxTokens: number; percentage: number;
}
```

Điều này biến trần *"2 000 token connector / role"* (`SPEC-connectors` §5) từ một **con số ước** thành
một **phép đo lúc chạy**. Và nó cho phép giao diện nói câu đúng nhất có thể nói với người dùng:

```
🔌 Notion       ● hoạt động · 15 việc · ~1 240 token mỗi lượt
```

> Đây đúng nấc thứ ba mà nợ 0c nói là còn thiếu: **`ĐO`**, bên cạnh `chặn` / `không chặn`.

### 9b. ❓ CÂU HỎI CHẶN — tool của MCP có nằm trong prefix không?

📖 `alwaysLoad` ghi: *"Default: tools are **deferred** when tool search is enabled."*

Nhưng ✅ ta truyền `tools: [7 tool văn phòng + shell]` — một allowlist **không chứa `ToolSearch`**.
⇒ **Nhiều khả năng tool search TẮT trong cấu hình của ta**, ⇒ tool MCP **không được hoãn**, ⇒ chúng
nằm trọn trong prefix được cache, **vĩnh viễn, mọi lượt**.

> ⚠⚠ **Đây là câu hỏi phải trả lời TRƯỚC khi hứa bất cứ điều gì về chi phí MCP.** Hai kịch bản
> khác nhau **một bậc độ lớn**:
>
> | | tool search BẬT | tool search TẮT |
> |---|---|---|
> | 15 tool Notion | hoãn, trả khi cần | **nằm trong prefix mọi lượt** |
> | Cắm 3 MCP | ~0 | ❓ có thể vượt cả 2 688 token của shell **cộng lại** |
>
> Và nó kéo theo một câu hỏi kiến trúc: `ToolSearch` **nằm trong nhóm "nội bộ Claude Code"** mà
> §5c đã cố ý **không lấy**. Nếu MCP cần nó để rẻ, thì quyết định đó phải được mở lại — với số đo,
> không phải với lập luận.

### 9c. ✅ Vì sao Trợ lý **không bao giờ** cầm MCP — đã chốt, nhắc lại vì §7 dễ làm người ta quên

`types.ts:499`: MCP **phá prompt cache khi `resume`** (issue #247) — mất ~**36 000 token quy đổi
MỖI LƯỢT** trò chuyện. Trợ lý `resume` ở **mọi tin nhắn**. ⇒ MCP gắn cho **worker**, và nếu Trợ lý
cần một cánh tay thì đi qua **worker ẩn**.

⚠ Điều này va vào §7: Trợ lý **phải đọc được** danh sách tool của MCP để chia việc đúng người,
nhưng **không được cầm** MCP. ⇒ Danh bạ lấy dữ liệu từ 📖 `mcpServerStatus()` của **một phiên
khác** (worker, hoặc một lượt bắt tay riêng lúc cắm), rồi **ghi xuống đĩa** như một sự thật đã
biết. **Không** gắn MCP vào phiên Trợ lý để hỏi nó. Đây là ràng buộc thi hành, không phải sở thích.

---

## 10. Docker — **có, nó khoá thật**, và đó là hai tin cùng lúc

> **Câu hỏi:** *"Nếu app chạy trong docker thì tự docker có khoá khả năng vươn dài tới files hệ
> thống không?"*
>
> **Đáp: CÓ, và khoá rất chặt.** Container chỉ thấy filesystem của image nó cộng những gì được
> **mount tường minh**. Không mount thì `D:\Downloads` **không tồn tại** với tiến trình bên trong —
> không phải "bị từ chối", mà là **không có**.

### 10a. Cái gì mất, cái gì được

| | Trong Docker |
|---|---|
| `Read`/`Glob`/`Grep` ra ngoài `company/` | ❌ **không còn đường** — trừ volume đã mount |
| `Bash` chạm file hệ thống | ❌ như trên |
| `WebFetch`/`WebSearch` | ✅ vẫn chạy (mạng không bị khoá theo mặc định) |
| MCP **stdio** (`npx -y …`) | ⚠ chạy **bên trong** container: cần `node`/`npx` (và `python`/`uv` cho server Python) **trong image**, cần mạng ra npm, cần cache ghi được |
| MCP **HTTP** | ✅ chạy tốt nhất trong Docker |
| Kho chìa `.state/secrets.json` | ✅ **không mount thì agent không với tới** — §5d ca C đóng được **miễn phí** |
| Bài 9 (kiểm kê `D:\Downloads`) | ❌ **chết**, trừ khi mount |
| Nút 📂 "mở thư mục" | ✅ đã bịt sẵn bằng `isLoopback` |

> **⇒ Docker là câu chuyện containment mà `SPEC-tools-approval` §5b nói agentco đang KHÔNG có.**
> Nó không phải một mục hạ tầng — nó là **một tính năng bảo mật**, và đáng bán như thế. Ba thứ
> chưa dựng nổi bằng hook (hàng rào đọc · chặn `Bash` ghi ra ngoài · che kho chìa) thì Docker cho
> **cả ba, miễn phí, bằng kernel**.

### 10b. 🔴 Nhưng nó **vỡ tiền đề** của tường lửa §1b — chưa ai nói ra

`SPEC-tools-approval` §1b chốt (22/08, chưa cài): *một đích đi qua `officeJail` khi **đúng chuỗi đó
có mặt trong tin nhắn người dùng vừa gõ***.

Trong Docker, người dùng gõ `D:\Downloads\ban-ke.md` từ trình duyệt trên máy Windows của họ. Bên
trong container, đường dẫn thật là `/data/downloads/ban-ke.md`. **Chuỗi người dùng gõ không bao giờ
khớp chuỗi hệ thống dùng.**

| | trên máy | trong Docker |
|---|---|---|
| người dùng gõ | `D:\Downloads\x.md` | `D:\Downloads\x.md` |
| hệ thống thấy | `D:\Downloads\x.md` ✅ khớp | `/data/downloads/x.md` ❌ **không khớp** |
| kết quả | ghi đúng chỗ họ muốn | **luôn** rơi về thư mục văn phòng |

**Ba nhận xét, và cái thứ ba mới quan trọng:**

1. Nó **lệch về phía an toàn** — đúng như §1b thiết kế. Không mất dữ liệu, không ghi nhầm chỗ.
2. Nhưng nó làm tính năng *"ghi ra ngoài văn phòng"* **im lặng không tồn tại** trong Docker. Đúng
   hình dạng của công tắc `Bash` no-op suốt 6 ngày ([[agentco-silent-allowlist]]).
3. ⇒ **Bất biến phải viết lại cho đúng cả hai môi trường:** *"đích hợp lệ = văn phòng **+** những
   volume đã mount tường minh, và tên mà người dùng nhìn thấy phải là tên họ gõ được"*. Nghĩa là
   Docker cần một **bảng ánh xạ đường dẫn** hiện lên UI, không phải một biến môi trường người triển
   khai phải nhớ đặt. ✅ Luật đã có: *một bất biến dựa vào trí nhớ không phải bất biến* (ca nút 📂).

> **Đây là lần thứ tư trong hai phiên một tính năng đúng trên máy dev, sai ở chỗ khác** — tên tool
> shell theo OS, slug chữ phi-Latin, "mở thư mục" từ xa, và giờ là ánh xạ đường dẫn trong container.
> **Cùng một hình dạng: cái máy đang code trở thành tiền đề ngầm.**

### 10c. Đề xuất — hai chế độ, nói thẳng, **chưa chốt**

| Chế độ | Cho ai | Cánh tay với tới |
|---|---|---|
| **Trên máy** (hôm nay) | người dùng cá nhân, `npx agentco` | cả máy — nhanh, tiện, **không có containment** |
| **Trong hộp** (Docker/VPS) | doanh nghiệp, người cần nhật ký kiểm toán | **chỉ những thư mục đã mount** + MCP + web |

Người dùng chọn bằng cách họ cài, không phải bằng một công tắc trong app. ✅ Năm ràng buộc container
của `SPEC-cli.md` §4 đã giữ đúng từ đầu, nên đường này **không bị chặn**.

❓ **Còn phải trả lời:** xác thực Claude trong container (`SPEC-cli.md` §4 đã ghi nhận là chỗ vướng
thật), và `npx` trong image (cân nhắc **gỡ sẵn** các MCP danh mục vào image thay vì tải lúc chạy —
vừa nhanh vừa giảm rủi ro chuỗi cung ứng §11c).

---

## 11. Bản quyền và logo — rủi ro là **NHÃN HIỆU**, không phải bản quyền

> ⚠ **Tôi không phải luật sư và đây không phải tư vấn pháp lý.** Dưới đây là thực tiễn phổ biến +
> điều khoản công bố của chính các bên, tra ngày 23/08/2026. Trước khi golive nên hỏi một luật sư
> sở hữu trí tuệ **một lần** — rẻ hơn nhiều so với sửa sau.

### 11a. Tách ba chuyện hay bị gộp

| Chuyện | Rủi ro thật |
|---|---|
| **Xây một tích hợp** với dịch vụ của họ (gọi API công khai, cắm MCP server của họ) | 🟢 **Thấp.** Đây là chuyện bình thường của cả ngành. Ràng buộc nằm ở **điều khoản API** của họ (giới hạn tần suất, cấm dùng lại dữ liệu), không ở bản quyền |
| **Gọi tên họ** — *"Kết nối Google Drive"*, *"hoạt động với Notion"* | 🟡 **Thấp nếu làm đúng.** Đây là *nominative fair use*: dùng tên để chỉ đúng sản phẩm của họ, chỉ dùng **vừa đủ để nhận ra**, và **không gợi ý là được họ bảo trợ** |
| **Dán logo của họ trong app** | 🟠 **Đây là chỗ có luật.** Logo vượt quá "vừa đủ để nhận ra", và phần lớn hãng lớn có **trang quy tắc riêng** ràng buộc chuyện này |

### 11b. Bốn luật cứng — vi phạm là chuyện khác hẳn về mức độ

🌐 Gom từ quy tắc thương hiệu của Google (áp cho cả Google Workspace Marketplace):

1. ❌ **Không** dùng logo của họ làm logo/icon **của agentco** hoặc của một tính năng.
2. ❌ **Không** ghép tên họ vào tên sản phẩm, tên công ty, **tên miền**, hay khẩu hiệu.
   ✅ Được nói *"for Google Drive™"*, *"hoạt động với Notion"* — dạng **tương thích**, không dạng
   sở hữu.
3. ❌ **Không** làm bất cứ điều gì gợi ý có quan hệ hợp tác / bảo trợ / chứng nhận khi **không có**.
4. ✅ **Ghi công** khi dùng nhãn hiệu — *"Google Drive™ là nhãn hiệu của Google LLC"*.

### 11c. Chốt chính sách cho agentco — **an toàn theo mặc định, mở khi đã đọc**

| | Chốt |
|---|---|
| **Mặc định của mọi mục danh mục** | **Tên chữ + một icon TRUNG TÍNH của ta** (🔌 / hình dạng riêng theo loại: kho tài liệu, bảng tính, chat…). Không logo bên thứ ba |
| **Khi nào được dùng logo thật** | Chỉ khi **đã đọc trang brand guideline của chính hãng đó**, dùng **file chính chủ** họ phát hành, đúng vùng đệm/màu/tỉ lệ họ quy định, và ghi lại link vào hồ sơ mục đó |
| **Trường bắt buộc trong mỗi mục danh mục** | `brand: { name, trademark_owner, guideline_url, asset_source, checked_on }` — **ô trống thì không có logo**. Cấu trúc, không kỷ luật |
| **Connector do khách tự dựng** | icon do **khách** chọn/tải lên. Rủi ro chuyển sang họ, và họ đang dùng trong nội bộ công ty mình — hoàn cảnh khác hẳn |
| **Ảnh chụp màn hình / video bán hàng** | 🌐 Google cho phép ảnh chụp **nguyên trạng, không sửa** kèm ghi công. Đọc quy tắc từng hãng, đừng suy từ hãng này sang hãng khác |

> **Lợi ích phụ, và nó không nhỏ:** icon trung tính làm **cả danh mục trông như một hệ**, thay vì
> một bức tường logo lệch màu lệch tỉ lệ. Chuyện pháp lý và chuyện thẩm mỹ **trùng nhau** ở đây —
> dấu hiệu của một ràng buộc đặt đúng chỗ.

### 11d. ⚠ Rủi ro thứ hai, lớn hơn và ít ai nói: **chuỗi cung ứng**

`npx -y @ai-do-do/mcp-server` **tải và chạy mã của người lạ trên máy khách hàng, với quyền của
khách hàng, kèm chìa khoá của khách hàng.** ✅ `TEST-WALKTHROUGH` bước B đã tự cảnh báo đúng chuyện
này (*"bạn đang trao token Google cho code người lạ"*).

Xuất hiện một mục trong **danh mục của ta** thì lời cảnh báo đó không còn đủ — **chọn hộ khách là
bảo đảm hộ khách**. Hai ràng buộc bắt buộc cho mọi mục danh mục:

- **Ghim phiên bản** (`@x.y.z`), **không** `@latest`. `@latest` nghĩa là bản cập nhật của người lạ
  chạy trên máy khách mà không ai duyệt.
- **Ghi rõ ai bảo trì** ngay trên màn hình cắm — *"do Notion phát hành"* rất khác *"do cộng đồng
  phát hành"*, và người dùng có quyền biết mình đang tin ai.

---

## 12. ❗ VIỆC PHẢI ĐO TRƯỚC KHI XÂY — cả §3 đang là 📖

Luật của dự án: *đừng lên lịch dựa trên một cơ chế chưa ai thấy chạy.* Bảy spike, xếp theo **thiết
kế nào sụp nếu nó hỏng**:

| # | Spike | Chứng minh gì | Sụp cái gì nếu hỏng |
|---|---|---|---|
| **1** | Cắm một MCP stdio thật (`filesystem`), gọi `mcpServerStatus()` | `tools[]` + `annotations` có thật không | **§7 và §8a cùng lúc** — mất nguồn duy nhất của cả năng lực lẫn mức duyệt |
| **2** | `getContextUsage()` với/không MCP, **cắm nonce phá cache** | tool MCP có nằm trong prefix không | **§9** — và có thể mở lại quyết định `ToolSearch` (§5c) |
| **3** | `PreToolUse` matcher `mcp__*` trên một lời gọi tool MCP thật | cổng duyệt cho **stdio** có tồn tại không | **§8c** — stdio là ca phổ biến nhất. Hỏng thì phải bọc proxy |
| **4** | `setMcpServers()` giữa phiên: thêm · bớt · sai chìa | cắm/rút không restart · `errors` có nói được gì hữu ích không | **§6** — nút Thử ngay và cả B7 |
| **5** | `onElicitation` `mode:'url'` với một server cần OAuth | OAuth qua UI có đi được không | **§6d** — và bài 10 chặng B |
| **6** | Vai trò không có `Bash`, giao việc `Read` `company/.state/secrets.json` | lỗ §5d có thật không (**dự đoán: có**) | nếu **không** đọc được thì có một hàng rào ta chưa biết là mình có — quan trọng ngang việc nó có |
| **7** | Chạy toàn bộ trong `node:slim` + mount đúng `company/` | Docker khoá thật tới đâu · stdio `npx` sống được không | **§10** |

⚠ **Bẫy đo đã trả tiền hai lần, áp cho spike 2:** lần đo thứ hai **ăn cache của lần một** và cho ra
chênh lệch 0. **Phải cắm nonce vào system prompt để ép miss cả hai lần.** [[agentco-measurement-vs-conclusion]]

⚠ **Bẫy đo cho spike 1 và 4:** 📖 `.d.ts` nói control request **chỉ chạy ở streaming input mode**,
và ✅ ta đã học ở §5n ⑤ rằng chúng **không được trả lời khi vòng lặp chính đang bận**. ⇒ Gọi
`mcpServerStatus()` lúc CLI **rảnh** — đúng công thức đã cứu `usage()`: mở query với generator
**giữ stream mở mà chưa gửi tin nào**.

---

## 13. Thứ tự làm

Xếp theo *mở khoá bao nhiêu / công sức*, và **ba việc đầu là ĐO chứ không phải XÂY**:

| # | Việc | Mở khoá | Cỡ |
|---|---|---|---|
| 1 | Spike 6 — lỗ chìa khoá §5d | biết mình đang hở tới đâu | **10 phút** |
| 2 | Spike 1 + 2 — `mcpServerStatus` + token | **§7, §8, §9 cùng lúc** | nhỏ |
| 3 | Spike 3 + 4 — cổng duyệt stdio + hot-plug | §6, §8c | nhỏ |
| 4 | Bịt §5d bằng phương án **A** | lỗ đang mở | **rất nhỏ** |
| 5 | Màn hình Thêm/Sửa/Thử cánh tay (đường **B** dán config) | **xoá 3 chuông 📝** ở bài 10 | vừa |
| 6 | Chìa đi theo cạnh nối (§6b) | xoá bước B6 | nhỏ |
| 7 | Dòng năng lực từ handshake (§7) | Trợ lý chia việc đúng người | nhỏ |
| 8 | Cổng duyệt hai tầng (§8) — **chỉ sau spike 3** | bài 10 chặng C | lớn |
| 9 | Danh mục 2 mục (đường **A**) | trải nghiệm "chọn là chạy" | vừa |
| 10 | `onElicitation` OAuth (§6d) | bài 10 chặng B **hết cần Google Cloud Console** | vừa |
| 11 | Connector tự sinh (đường **C**) | **đặc sản** | lớn |
| 12 | Docker (§10) | containment · doanh nghiệp | lớn |

**Bốn việc đầu cộng lại chưa tới một buổi**, và chúng quyết định hình dạng của tám việc còn lại.

---

## 14. Câu chưa trả lời — cần user chốt

1. **Danh mục v1 gồm mấy mục, và Google có trong đó không?** (§4e — ba câu a/b/c)
2. **Lỗ chìa khoá §5d sửa bằng A ngay, hay chờ B?** Nghiêng A ngay, B là đích, **C bị loại tường minh**.
3. **Hàng rào đọc: hook, MCP filesystem, hay cả hai?** (§1d) — ⚠ chỉ một trong hai thì cửa còn lại vẫn mở.
4. **Nếu spike 2 cho thấy tool MCP nằm trong prefix**, có mở lại quyết định `ToolSearch` không? (§9b)
5. **Docker: v2 hay xa hơn?** Nó là câu chuyện containment ta đang thiếu (§10), nhưng nó cũng làm
   **bài 9 chết** và bắt phải viết lại bất biến §1b.
6. **Kho tri thức riêng cho mỗi cánh tay** — *"database nào là chỗ để hoá đơn"* thuộc về kho tri
   thức (`SPEC-tools-approval` §7b đã chốt). Nhưng khi cắm/rút MCP thì tri thức về nó **đi theo hay
   ở lại**? Chưa có ai nghĩ tới.

---

## Nguồn

**Đọc trực tiếp trong `node_modules`, `@anthropic-ai/claude-agent-sdk@0.3.231`** (📖 — kiểu, không
phải hành vi): `sdk.d.ts` — `McpServerConfig` (1068) · `McpHttpServerConfig` (1035) ·
`McpServerStatus` (1075) · `McpServerToolPolicy` (1123) · `McpSetServersResult` (1135) ·
`McpClaudeAIProxyServerConfig` (1025) · `ElicitationRequest` (580) · `OnElicitation` (1310) ·
`Query.mcpServerStatus` (2500) · `Query.setMcpServers` (2627) · `Query.getContextUsage` (2507) ·
`SDKControlGetContextUsageResponse` (3228).

**Trong repo** (✅ — đã chạy, có số đo): `worker.ts §pickMcp` · `secrets.ts` · `paths.ts §companyPaths`
· `layout.ts` · `types.ts` §`BUILTIN_TOOLS` · `SPEC-tools-approval.md` §5–§12 · `SESSIONS_MEMORY.md` §5n.

**Ngoài** (🌐 — tra 23/08/2026): [MCP Transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
· [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) ·
[MCP Registry](https://registry.modelcontextprotocol.io/) ·
[n8n MCP Client Tool](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp)
· [n8n MCP Server Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger)
· [Google Workspace Marketplace branding](https://developers.google.com/workspace/marketplace/terms/branding)
· [Google Brand Resource Center](https://about.google/brand-resource-center/guidance/)
· [INTA — Fair Use of Trademarks](https://www.inta.org/fact-sheets/fair-use-of-trademarks-intended-for-a-non-legal-audience/)
