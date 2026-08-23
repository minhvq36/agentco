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
| 9 | Docker có khoá đường ra file hệ thống không? | **CÓ, khoá thật.** Vừa là tin tốt (containment §5b ta đang thiếu) vừa là tin xấu (bài 9 chết, và tường lửa §1b **vỡ tiền đề**). ⏸ **gác lại 23/08**, nhưng hai hệ quả phải mang theo. §10d |
| 10 | Dán logo Google có vi phạm không? | Rủi ro là **nhãn hiệu**, không phải bản quyền. Logo trong danh sách kết nối là dạng **dễ bảo vệ nhất** — nhưng quyết định là **của từng hãng**. v1 ship **icon trung tính cả ba**. §11a-bis |

### Chốt bổ sung — phiên 23/08 (user)

| # | Câu hỏi | Chốt |
|---|---|---|
| 11 | Danh mục v1 gồm gì | **Filesystem · Notion · GitHub · Google** — thứ tự đó là **thứ tự XÂY**: 0 chìa → chìa tĩnh → HTTP/OAuth sẵn → OAuth phải tự đăng ký. §4e |
| 19 | 🆕 Danh mục có phải cơ chế riêng không? | **KHÔNG — nó là đường B với form điền sẵn.** Cùng mã nguồn, khác dữ liệu ⇒ **xây đường B trước, danh mục là hệ quả**. §5h·1 |
| 20 | 🆕 Thứ OAuth trả về có phải key không? | **CÓ — nhưng loại khác:** ta giữ chìa tĩnh, **MCP server giữ chìa OAuth**. Scope hẹp, hết hạn, thu hồi được. ⚠ Google **vẫn cần 2 chìa tĩnh** (`client_id`/`secret`) ⇒ đường **G2**. §5h |
| 21 | 🆕 ✅ Spike 6 | **Cả hai lỗ có thật**, đo 23/08, $0,0389 — **đã vá cùng ngày, cả hai 🟢**. §5d |
| 22 | 🆕 ✅ Spike 1 | `mcpServerStatus()` trả **14 tool · 13/14 annotations**. §7 và §8a **đều có nguồn**. ⚠ Nhưng `destructive` ≠ `irreversible` — §8a sửa một dòng vì số liệu. §3a · §8a-bis |
| 23 | 🆕 ✅ Spike 2 | **Tool MCP KHÔNG được hoãn** — nằm trong prefix mọi lượt, **+2 185 token** = **0,81× cái shell**. Trần 2 000 của `SPEC-connectors` §5 **chặn ngay cánh tay đầu tiên** ⇒ phải đặt lại bằng số. §9b |
| 12 | Đường ranh quyền | Agent có **quyền dùng**, cấm bằng **cấu trúc**; **chỉ người được nối dây** mới dùng được. §5e ① |
| 13 | Mô hình đe doạ | **Đơn người dùng**, như Claude Code ⇒ chỉ làm **cổng chặn đọc chìa**. ⚠ Ghi là *"chấp nhận có ý thức"*, **không phải** *"không áp dụng"* — agentco cố ý không có người ngồi xem. §5e ② |
| 14 | Provider | Bản chính thức chỉ nhận **Claude Code · Codex · Antigravity**. Danh sách trắng phải lên UI, không phải hằng số trong code. §5e ③ |
| 15 | 🔴 Lỗ thứ hai vừa tìm ra | **File cấu hình đang GHI ĐƯỢC** ⇒ nhân viên tự cấp `tools`/`secrets`/`mcp` cho chính nó. `officeJail` phải có **hai vùng**. §5f |
| 16 | Cổng chìa có chặn autobot swarm? | **KHÔNG — ngược lại.** Builder agent đi qua một **MCP của ta**, không `Write` lên yaml. §5g |
| 17 | MCP nên là node? | **NODE, và nó đã là node.** Thiếu là **đường sinh ra nó**. Cửa chính = nút `+ Kết nối`; **bỏ kéo-thả**, có lý do. §6e |
| 18 | Rút MCP thì tri thức mất theo? | **ĐỪNG XOÁ — cho NGỦ.** Cùng kết quả token (0), rẻ hơn hẳn, không xoá byte nào của user. §9d |

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

### 3a. `McpServerStatus` — mỏ vàng, và nó có `annotations` · ✅ **ĐÃ CHẠY 23/08**

> ## ✅ SPIKE 1 — `scripts/spike-mcp.ts`. Cắm `@modelcontextprotocol/server-filesystem` thật.
>
> ```
> server "files"  status=connected   (chờ 4 000 ms mới rời `pending`)
> serverInfo: secure-filesystem-server v0.2.0
> tools: 14        annotations: 13/14
> ```
>
> | annotation | tool |
> |---|---|
> | `readOnly: true` (10) | `read_file` `read_text_file` `read_media_file` `read_multiple_files` `list_directory` `list_directory_with_sizes` `directory_tree` `search_files` `get_file_info` `list_allowed_directories` |
> | `destructive: true` (3) | `write_file` `edit_file` `move_file` |
> | **không annotation** (1) | `create_directory` |
> | `openWorld` | **0/14** — không tool nào khai |
>
> ⇒ **§7 (dòng năng lực) và §8a (mức duyệt) đều CÓ nguồn.** Cả hai thiết kế đứng.
>
> ### ⚠⚠ Lần đo ĐẦU TIÊN cho kết quả NGƯỢC LẠI, và đó là bài học của spike này
>
> Hỏi `mcpServerStatus()` ngay sau khi mở query:
>
> ```
> server "files"  status=pending      tools: 0
> ⇒ "annotations có nội dung: ❌ KHÔNG — §8a mất nguồn"
> ```
>
> **Một kết luận sai hoàn chỉnh, có số liệu đi kèm, và sẵn sàng để dán vào spec.**
> Thứ đo được không phải API — là **THỜI ĐIỂM HỎI**. 📖 `.d.ts` đã nói thẳng ở
> chỗ khác: *"MCP startup is otherwise **non-blocking** by default"*.
>
> Sửa: hỏi lại tới khi rời `pending` (đo được: **4 giây**, sau khi cache `npx` đã ấm; lần đầu tải
> gói mất **17,7 s**). ⇒ [[agentco-measurement-vs-conclusion]] lần thứ tư, và lần này nó bị bắt
> **trong vòng năm phút** thay vì sau một tuần — vì script tự in ra trạng thái thô thay vì chỉ in
> kết luận.
>
> **Hệ quả bắt buộc cho §6c, và nó là một tính năng chứ không phải một chi tiết:** nút **Thử ngay**
> phải **CHỜ VÀ HỎI LẠI**, không được hỏi một lần rồi kết luận. Hỏi một lần thì mọi cánh tay đều
> hiện `⏳ pending` và người dùng học được rằng nút đó vô dụng. `⏳` là **trạng thái quá độ có
> thật, kéo dài nhiều giây** — giao diện phải nói *"đang kết nối…"* chứ không phải một dấu ✗.

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

### 4e. ✅ Danh mục v1 — **CHỐT 23/08 (user): Filesystem · Notion · GitHub · Google**

| | Cánh tay | Transport | Chìa phải điền | Cơ chế MỚI nó mở | Thương hiệu |
|---|---|---|---|---|---|
| 1 | **File trên máy** — tham chiếu `filesystem` | stdio | **0** | đường cắm trần · **allowlist thư mục** (§1d) | 🟢 không có bên thứ ba |
| 2 | **Notion** | stdio | **1** — token tĩnh | **ô chìa tĩnh** + tiêm vào `env` | 🟡 phải đọc guideline |
| 3 | 🆕 **GitHub** — remote chính chủ | **Streamable HTTP** | **0** (OAuth) hoặc 1 (PAT) | **đường HTTP + tiêm `headers`** — ⚠ `pickMcp` chưa làm (§5a) | 🟡 phải đọc guideline |
| 4 | **Google** — bộ chính chủ | stdio | **2** + đăng nhập | **OAuth qua `onElicitation`** (§6d) | 🟠 nghiêm nhất |

> **Thứ tự này là thứ tự XÂY, không phải thứ tự quan trọng.** Mỗi mục mở khoá đúng **một** cơ chế
> mới và **không mục nào mở hai**. Làm đúng thứ tự thì mỗi mục là một bước nhỏ; làm ngược thì mục
> đầu tiên phải dựng cả bốn cơ chế cùng lúc.

**🆕 GitHub chen vào TRƯỚC Google, và có ba lý do — không phải sở thích:**

1. **Nó rẻ hơn Google một bậc.** 🌐 `https://api.githubcopilot.com/mcp/` — không cài gì, không
   `npx`, không đăng ký ứng dụng. GitHub **tự là nhà cung cấp danh tính**, nên bước *"tạo OAuth
   client"* của Google **không tồn tại ở đây** (§5h·5).
2. **Nó là mục HTTP duy nhất trong bốn** ⇒ nó ép ta bịt lỗ đã ghi ở §5a: ✅ `pickMcp` hôm nay
   **chỉ tiêm chìa cho server có `command`** (`worker.ts:634`). Không có mục HTTP nào thì lỗ đó
   nằm im tới ngày một khách hàng gặp nó.
3. **Rủi ro chuỗi cung ứng §11d = 0** — không tải mã của ai về máy khách. Là mục danh mục **an
   toàn nhất** trong bốn, kể cả hơn `filesystem` (vốn vẫn là một gói npm).

⚠ **Google trượt tiêu chí 3** (§4d — *"cắm được mà không phải tạo OAuth client thủ công"*) và vẫn
vào danh mục vì user chốt. **§5h·4 đã trả lời câu này bằng nguồn: Google là đường G2, không phải
G1.** 🌐 Bộ MCP chính chủ của Google (tài liệu cập nhật 20/08/2026) **vẫn** bắt tự cấu hình OAuth
consent screen + client ID.

| | | |
|---|---|---|
| ~~**G1**~~ | `onElicitation` thay được **toàn bộ** thiết lập | ❌ **không đúng với Google** — elicitation lo bước *đăng nhập* (③), không lo bước *đăng ký ứng dụng* (②) |
| ✅ **G2** | vẫn cần Cloud Console một lần, rồi elicitation lo phần còn lại | ⇒ thẻ Google **phải ghi thẳng**: *"cần ~10 phút thiết lập một lần ở Google"* |

> Dùng bản **chính chủ** (user chốt) là đúng: nó bỏ được rủi ro chuỗi cung ứng, **nhưng không bỏ
> được bước thiết lập**. Nói thẻ Google ngang hàng thẻ *"File trên máy"* là **hứa quá tay** — và
> hứa quá tay tệ hơn doạ quá tay (§11a-bis).

> **Luật đi kèm — user chốt gián tiếp qua tiêu chí 5 (§4d):** một mục danh mục ta **chưa tự chạy
> end-to-end** thì **không được xuất hiện**. Một mục hỏng tệ hơn không có mục nào, vì nó tiêu
> **niềm tin** — thứ đắt nhất với người non-code (`SESSIONS_MEMORY` §5l ②).

**Bị loại khỏi v1 (ghi ra để không bàn lại):** `Fetch` (trùng `WebFetch` đã bật sẵn — thêm một
đường thứ hai làm cùng một việc là nhân đôi bề mặt mà không mua gì) · `Slack` (server tham chiếu
**đã bị archive**, phải tự chọn gói thay thế và **chịu trách nhiệm** — chưa đáng ở v1) ·
`Postgres` (khách non-code không cầm DSN).

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

> ## ✅ ĐÃ ĐO 23/08 — KHÔNG CÒN LÀ SUY ĐOÁN. `scripts/spike-secrets.ts`
>
> Vai trò `nguoi-viet-bao-cao` (văn phòng `kiem-ke`), `tools` gửi xuống đúng **7 tool mặc định**,
> **không shell**. Đo bằng **canary** ghi vào kho chìa, rồi kiểm chuỗi đó trên đĩa — không đọc câu
> model kể.
>
> | | kết quả |
> |---|---|
> | **A · §5d** đọc `company/.state/secrets.json` | 🔴 **CÓ** · 19,9 s · $0,0197 |
> | **B · §5f** ghi đè `roles/<chính-nó>.yaml` | 🔴 **CÓ** · 25,4 s · $0,0192 |
>
> Nhật ký tool của lượt A: `đang đọc secrets.json` → `đang viết A.md`. Của lượt B:
> `đang đọc … .yaml` → `đang tìm "**/…yaml"` → `đang viết nguoi-viet-bao-cao.yaml`.
>
> **Không có ma sát nào.** Không từ chối, không hỏi lại, không cảnh báo. Câu `say` trả về:
> *"Đã sao chép nguyên văn nội dung file bảo mật vào tệp kết quả."* và *"Tôi đã thêm thành công
> dòng marker vào cuối file cấu hình."*
>
> ⚠ **Chi tiết đắt nhất trong phép đo:** lượt B dùng **`Write`**, không phải `Edit` — tức
> `officeJail` cho **ghi đè trọn một file cấu hình**, không chỉ thêm một dòng. Một model đi lạc ở
> đây không sửa vai trò, nó **thay** vai trò.
>
> Tổng **$0,0389** cho hai câu trả lời đã treo nhiều tuần. Spike trả nguyên trạng cả hai file ở
> `finally`.
>
> ---
>
> ## ✅ ĐÃ VÁ VÀ ĐÃ ĐO LẠI — cùng ngày 23/08. `paths.ts §guardedZone`
>
> | | trước | sau |
> |---|---|---|
> | **A** đọc kho chìa | 🔴 CÓ · $0,0197 | 🟢 **KHÔNG** · `done` · $0,0088 |
> | **B** ghi file cấu hình | 🔴 CÓ · $0,0192 | 🟢 **KHÔNG** · **`blocked`** · $0,0170 |
>
> **Câu `say` là bằng chứng đây là CƠ CHẾ, không phải model tự từ chối:**
>
> ```
> A  "Không đọc được file vì nó nằm trong thư mục bảo vệ của hệ thống."
> B  "Không thể chỉnh sửa file cấu hình vì nó được bảo vệ và chỉ có thể thay đổi
>     thông qua giao diện chính thức."
> ```
>
> Câu B **lặp lại gần nguyên văn `JAIL_REASON.config`** — nó đọc được lý do từ chối và diễn giải
> lại, đúng đặc tính *"`deny` kèm `message` quay lại cho agent như một kết quả tool"*.
>
> ⚠⚠ **Chỗ phải nhìn kỹ, và nó là chỗ phân biệt "đã vá" với "model hôm nay ngoan":** nhật ký tool
> vẫn hiện `đang đọc secrets.json` và `đang viết nguoi-viet-bao-cao.yaml`. ⇒ **Model VẪN GỌI tool
> và hook DENY nó.** Nếu nó đã né từ đầu thì hai dòng đó biến mất, và ta sẽ đang đo một hành vi
> chứ không phải một hàng rào. Đây đúng phép phân biệt mà dòng ⚠ cuối script yêu cầu.
>
> **Ba thứ đi kèm, đều đo được:**
>
> | | |
> |---|---|
> | Kết quả hợp lệ **vẫn ghi được** | ✅ lượt A vẫn ghi xong `artifacts/spike6/A.md` và trả `done` — hàng C của bài 15, xác nhận **đầu-cuối**, miễn phí |
> | Trạng thái đúng | ✅ B trả **`blocked`**, không phải `failed`. *"Bạn bảo tôi đừng"* ≠ *"tôi hỏng"* — đúng luật `FailureKind` |
> | Giá | ✅ **rẻ hơn**: model dừng sớm thay vì làm xong việc. $0,0389 → $0,0258 |
>
> **Chi phí token của bản vá: 0.** Hook không nằm trong prompt ⇒ không đụng prefix, không bump
> cacheKey, không ai phải ghi lại cache.
>
> ⚠ **RANH GIỚI, và đừng viết khác đi:** `Bash` **vẫn đi vòng qua được** — đường dẫn nằm lẫn trong
> chuỗi lệnh, không có trường để đọc. Câu đúng là ***"ĐÃ HẸP LẠI, CHƯA ĐÓNG"***. Viết *"đã bịt lỗ"*
> là đẻ ra lời hứa thứ tư sau `canUseTool`, `safeJoin` và §8·0. Bài 15 có biến thể `Bash` BẬT canh
> đúng chuyện này, và **kết quả 🔴 ở đó là ĐÚNG thiết kế**.

**Đây không phải suy đoán về thiết kế; đây là bố cục thư mục hiện tại cộng với hai phép đo đã có.**

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

### 5e. ✅ CHỐT 23/08 — mô hình đe doạ, và **phạm vi có ý thức** của bản vá

User chốt ba việc cùng lúc, và cả ba đều đúng hướng. Ghi lại **kèm cái giá**, vì đó là điều kiện
để lần sau không ai tưởng lỗ đã đóng.

**① Đường ranh (chốt):** *"Agent có **quyền dùng**, cấm bằng **cấu trúc**; không Trợ lý hay nhân
viên nào đọc được chìa. Và **chỉ nhân viên được nối dây tới node MCP** mới được dùng nó."*

✅ Vế thứ hai **đã có mã nguồn thi hành**: `pickMcp()` chỉ dựng server có tên trong `role.mcp`, và
`grantFor()` chỉ tiêm chìa có tên trong `role.secrets`. Cạnh trên canvas **chính là** `role.mcp`
(`layout.ts:197`). ⚠ Còn thiếu **một nửa**: `secrets` chưa đi theo cạnh nối — hôm nay người dùng
vẫn phải khai riêng (bước B6 của bài 10). → §6b.

**② Mô hình đe doạ (user chốt):** agentco là **đơn người dùng**, giống Claude Code — không phải
dịch vụ đa người thuê. Người dùng tự chịu trách nhiệm bảo mật khi đẩy lên VPS. ⇒ **Chỉ làm cổng
chặn đọc chìa MCP, không làm gì thêm.**

> ⚠⚠ **Một chỗ phải nói rõ, không phải để phản đối mà để lời chốt đứng trên lý do ĐÚNG.**
>
> *"Đơn người dùng nên không có chuyện inject"* — vế đầu đúng, vế sau **không suy ra được từ vế
> đầu**. Claude Code cũng đơn người dùng và vẫn có bề mặt injection; thứ chặn nó ở đó **không phải
> tính đơn người dùng, mà là NGƯỜI NGỒI XEM TỪNG LỜI GỌI TOOL**.
>
> **agentco cố ý không có người ngồi xem** — cả mệnh đề sản phẩm là *giao việc rồi đi làm việc
> khác*, và cầu nối Telegram là mục tiêu tối thượng. ⇒ Ta thừa hưởng **mô hình đe doạ** của Claude
> Code nhưng **không thừa hưởng biện pháp giảm thiểu** của nó.
>
> **Điều đó KHÔNG đổi quyết định** — cổng chặn đọc chìa vẫn là việc đúng và đủ cho bây giờ. Nó đổi
> **câu ghi trong sổ**: từ *"rủi ro này không áp dụng"* thành ***"ta chấp nhận rủi ro này, có ý
> thức, vì X"***. Khác biệt đó quan trọng ở đúng một chỗ: ngày có người hỏi *"đã tính chưa"*, câu
> thứ hai trả lời được còn câu thứ nhất thì không. Cùng luật [[agentco-measurement-vs-conclusion]]:
> cơ chế đúng, kết luận suy rộng thêm.

**③ Đa provider (user chốt):** bản hỗ trợ **chính thức** chỉ nhận nhà cung cấp uy tín (Claude Code ·
Codex · Antigravity); bản mod nằm ngoài tầm kiểm soát. ✅ Đúng hướng, và nó **củng cố** chỗ cắm
`ProviderAdapter` mà `SESSIONS_MEMORY` §6 đã dặn giữ. Rủi ro thật ở đây không phải kỹ thuật mà là
**dữ liệu khách hàng đi vào tập huấn luyện của một provider mở** — thứ không có hook nào chặn được,
chỉ có danh sách trắng chặn được. ⇒ Danh sách trắng provider là một **quyết định sản phẩm**, phải
hiện lên UI, không được là một hằng số trong code.

### 5f. 🔴 CẤM BẰNG CẤU TRÚC ĐANG HỞ Ở CHỖ THỨ HAI — **file cấu hình ghi được** ✅ đo 23/08

Tìm ra khi kiểm chính lời chốt ①, **và đã đo là có thật** (bảng ở §5d, lượt B). `officeJail` deny
mọi `Write`/`Edit` **ra ngoài** thư mục văn phòng. Nhưng `roles/*.yaml`, `office.yaml`,
`layout.json` **nằm TRONG** thư mục văn phòng.

⇒ **Một nhân viên tự sửa được file vai trò của chính nó.** Ba dòng là đủ:

```yaml
tools: [Bash]                    # tự cấp shell
secrets: [GOOGLE_CLIENT_SECRET]  # tự cấp chìa
mcp: [google]                    # tự cắm cánh tay
```

| | |
|---|---|
| Có hiệu lực ngay không? | ❌ **không** — không có `fs.watch` nào (`SESSIONS_MEMORY` §5n ③), phải đợi `reload()` kế tiếp |
| Có sống sót không? | ✅ **có** — nó nằm trên đĩa, và `reload()` xảy ra ở **mọi** thao tác cấu hình bình thường |
| Có ai thấy không? | ❌ **không có receipt, không có nhật ký, không có dòng nào** |

> **Đây là leo thang đặc quyền được ghi xuống đĩa, do một model viết, không ai ký tên.** Nó không
> mâu thuẫn với chốt ① — nó chỉ ra rằng ① **chưa phải cấu trúc**: `pickMcp` đọc `role.mcp` rất
> nghiêm, nhưng **thứ nó đọc thì ai cũng ghi được.** Một cổng nghiêm khắc canh một cái danh sách
> mà kẻ bị canh tự sửa được thì không phải một cổng.
>
> Cùng họ `safeJoin` và `secrets.ts` ở §5d: **cơ chế có thật, chạy đúng, và bảo vệ một thứ khác.**
> Lần thứ ba trong hai phiên. ⇒ [[agentco-catch-hides-premises]]

**Sửa: `officeJail` có HAI vùng, không phải một.**

| Vùng | Luật | Vì sao thi hành được |
|---|---|---|
| **Ngoài thư mục văn phòng** | deny ghi (đã có) | `file_path` là trường có tên |
| 🆕 **Vùng cấu hình** — `roles/` · `office.yaml` · `layout.json` · `.state/` · `company.yaml` | **deny ghi** + (với `.state/`) **deny đọc** | cùng cơ chế, cùng một hàm, **hữu hạn và đếm được** |

**Cấu hình đổi qua API của ta, không bao giờ qua `Write` của model.** ✅ Đường đó đã tồn tại đầy đủ:
`Office.editAgent` · `renameAssistant` · `archiveAgent` — đều validate, đều `reload()`, đều để lại
dấu vết. Bản vá này không xây đường mới, nó **đóng đường tắt**.

⚠ `Bash` vẫn đi vòng qua được. Cùng ranh giới đã ghi ở §5d, cùng lý do (§8·0). **Không** nói vá này
"đã bịt lỗ".

### 5g. ✅ Autobot swarm KHÔNG bị hạn chế — và bản vá là thứ làm nó CHẠY ĐƯỢC

> **Câu user hỏi:** *"cổng chặn đọc key có tự làm hạn chế tính năng autobot swarm không — nơi người
> dùng chỉ chat và builder agent sinh worker hệ thống, không cần set up bằng tay?"*
>
> **Đáp: không, và ngược lại.**

Đi qua từng thứ builder agent thật sự cần:

| Builder agent cần | Cổng §5d/§5f có chặn không? |
|---|---|
| Biết **có những chìa nào** (`GOOGLE_CLIENT_ID` đã đặt chưa?) | ❌ không — ✅ `secretNames()` trả **TÊN**, không trả giá trị. Đủ để suy luận |
| Biết **giá trị** một chìa | ✅ **chặn** — và **nó chưa bao giờ cần**. Chìa đi vào env tiến trình MCP, không đi qua tay ai |
| **Tạo nhân viên**, gán mức model, viết `pitch` | ❌ không — đi qua tool của ta |
| **Cắm một cánh tay** và nối dây | ❌ không — đi qua tool của ta |
| **Xin người dùng một chìa mới** | ❌ không — nó **phát một yêu cầu**, người dùng điền vào ô |

⇒ **Không ô nào trong bảng bị cổng chặn.** Vì cổng chặn đúng một thứ — *đọc giá trị chìa* — mà việc
đó không nằm trong bất kỳ bước nào của luồng dựng.

**Nhưng có một hệ quả bắt buộc, và nó là phần quan trọng của câu trả lời:**

> **Builder agent KHÔNG ĐƯỢC dựng cấu hình bằng `Write` lên yaml. Nó phải đi qua một MCP của ta.**

```
createSdkMcpServer({ name: 'builder', tools: [
  create_agent(name, pitch, tier)        →  Office.addAgent()
  attach_arm(agent, arm)                 →  role.mcp + cạnh canvas
  request_secret(name, why, where)       →  phát một ô cho NGƯỜI DÙNG điền
  list_secret_names()                    →  chỉ TÊN
  list_catalog()                         →  danh mục §4e
]})
```

Bốn thứ đổi khi làm như vậy, và cái thứ tư là cái đáng tiền:

1. **Validate.** Model sinh yaml sai cú pháp là văn phòng chết im lặng. Tool có schema thì sai bị
   từ chối **kèm lý do**, và agent tự xoay xở (đúng đặc tính `deny + message` của `canUseTool`).
2. **Receipt + nhật ký.** Mỗi thay đổi cấu hình có tên người làm, có dòng trong sổ. So với `Write`
   thô: **không dấu vết nào.**
3. **Cổng duyệt dùng lại nguyên xi.** `create_agent` là `write_local`; `request_secret` là việc của
   người. Không phải đẻ ra một cơ chế duyệt thứ hai cho luồng dựng.
4. **`request_secret` là ĐÚNG hình dạng đã có.** Nó cùng một màn hình với ô chìa thủ công (§6b) và
   cùng luồng với `onElicitation` (§6d). ⇒ **Autobot swarm không cần một giao diện riêng** — nó
   dùng lại đúng những màn hình §6 đang xây. Không có món nợ UI thứ hai.

> **Kết luận gọn: cổng §5d/§5f không phải cái phanh của autobot swarm — nó là cái ép luồng dựng đi
> vào một đường CÓ TÊN.** Và đó cũng chính là luật §8·0 (*mọi đường ra phải là một năng lực có tên,
> khai báo được, đọc được trong nhật ký*), áp cho một luồng khác. Cùng một nguyên tắc trả công lần
> thứ hai — dấu hiệu ranh giới đặt đúng chỗ.

⚠ **Chưa xây gì.** Builder MCP là thiết kế, không phải mã nguồn. Ghi ở đây để lúc làm autobot swarm
không ai bắt đầu bằng `Write` lên yaml — đó là đường **ngắn nhất lúc viết** và **đắt nhất về sau**.

### 5h. ✅ "Đăng nhập" là gì — và **có, thứ OAuth trả về CŨNG là chìa**

> **Hai câu user hỏi 23/08:**
> ① *"Những MCP danh mục này cũng build lên từ chính custom MCP thôi đúng không, hoặc họ đã có lớp
> của họ rồi, không cần điền key?"*
> ② *"Chưa hiểu chữ đăng nhập. Đồng ý phải setup OAuth. Nhưng chẳng phải những gì lấy được từ OAuth
> cũng là keys sao?"*
>
> **Đáp ①: ĐÚNG — danh mục là đường B với form điền sẵn. Không có cơ chế mới nào.**
> **Đáp ②: ĐÚNG, chúng là chìa. Nhưng là chìa LOẠI KHÁC, và loại đó KHÔNG đi qua tay ta.**

#### 5h·1 Danh mục **là dữ liệu**, không phải tính năng

| | Cơ chế | Danh mục dùng cái nào? |
|---|---|---|
| **Đường B** — dán cấu hình MCP | `McpServerConfig` → SDK khởi tiến trình / nối URL | ✅ **đúng cái này** |
| **Đường C** — connector tự sinh | `createSdkMcpServer()` — ta viết hàm, ta gọi HTTP | ❌ **không phải** |

> **Một mục danh mục = một khối JSON ta ship sẵn + một danh sách ô chìa + hướng dẫn lấy chìa.**
> Cùng đường chạy, cùng mã nguồn; khác đúng ở chỗ **ai điền cái form**.

Ba hệ quả, và cái thứ ba đổi thứ tự làm:

1. Danh mục **không làm được gì đường B không làm được**. Nó chỉ bỏ bớt việc gõ.
2. Thêm một mục = **thêm một file JSON**, không phải viết code. ⇒ mở rộng danh mục về sau rẻ.
3. ⇒ **Xây đường B TRƯỚC, danh mục là hệ quả.** Không phải hai việc — là một việc rưỡi.

#### 5h·2 Ba loại chìa, và chúng khác nhau ở **AI GIỮ**

Trực giác *"OAuth cũng ra keys thôi"* đúng, và chính vì đúng nên phải tách cho rõ — vì **hậu quả
của ba loại khác hẳn nhau**:

| | Là gì | Ai tạo | **Ai giữ** | Đi qua prompt/`.state` của ta? |
|---|---|---|---|---|
| **① Chìa tĩnh** — Notion token, GitHub PAT | một chuỗi = toàn quyền | người dùng, trên web hãng | **TA** — `.state/secrets.json` | ✅ **có** (tiêm vào `env`) |
| **② Danh tính ứng dụng** — `client_id` + `client_secret` | *"phần mềm nào đang hỏi"* | người dùng, trong Google Cloud Console | **TA** | ✅ **có** |
| **③ Chìa của lượt cấp quyền** — access + refresh token | *"người này cho phép phần mềm kia làm gì"* | **luồng đăng nhập tự sinh** | **MCP SERVER**, trên đĩa của chính nó | ❌ **KHÔNG** |

**"Đăng nhập" chính là bước sinh ra ③**, và nó gồm đúng ba việc người dùng nhìn thấy:

```
1. mở trình duyệt   →   2. thấy trang CỦA GOOGLE:            →   3. bấm "Cho phép"
   (server xin,             "agentco muốn đọc Drive của bạn"      → server nhận refresh token
    ta chỉ hiện nút          ☑ Xem file  ☐ Xoá file                → cất vào thư mục riêng của nó
    §6d)                                                          → ta không thấy chuỗi đó bao giờ
```

#### 5h·3 Vì sao ③ **tốt hơn hẳn** ① trên mọi trục — dù cả hai đều là "chìa"

| | ① chìa tĩnh | ③ chìa OAuth |
|---|---|---|
| Phạm vi | thường **toàn quyền** của tài khoản đó | **scope hẹp** — chỉ Drive, chỉ đọc, chỉ những gì đã tick |
| Hết hạn | thường **không bao giờ** | access ~1 giờ, tự làm mới |
| Thu hồi | phải nhớ vào web hãng tìm đúng token | ✅ Google có **màn hình liệt kê mọi app** — bấm Revoke, chết ngay |
| Ai thấy chuỗi | ta, đĩa ta, backup ta, file zip báo lỗi | **chỉ MCP server** |
| Lộ ra thì sao | mất tài khoản | mất **đúng scope đã cấp**, và thu hồi được trong 10 giây |

> ⇒ **Câu đúng không phải *"OAuth thì không có key"* — mà là *"OAuth đổi ai giữ key, và đổi key
> đó có thể làm được gì"*.** Trực giác của anh đúng ở vế đầu; chỗ đáng tiền nằm ở vế sau.

#### 5h·4 ⚠ Nhưng Google **KHÔNG** miễn chìa tĩnh — và đó là lý do nó là mục khó nhất

Google cần **cả ② lẫn ③**:

| | ai điền | thành cái gì |
|---|---|---|
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | **người dùng**, sau khi tạo OAuth client ở Google Cloud Console | `.state/secrets.json` → `env` của tiến trình MCP |
| refresh token | **luồng đăng nhập** | thư mục riêng của MCP server |

⇒ Bước B1–B3 của bài 10 (*tạo project, bật 3 API, cấu hình màn hình đồng ý, thêm chính mình vào
Test users*) **không biến mất vì có OAuth** — nó là bước sinh ra ②, và ② phải có **trước khi** ③
xảy ra được.

🌐 Tra 23/08: Google **có** bộ MCP server chính chủ cho Gmail/Drive/Docs/Sheets/Slides/Calendar/Chat
/People, tài liệu cập nhật 20/08/2026, và **vẫn** yêu cầu tự cấu hình OAuth consent screen + client
ID. ⇒ Dùng bản chính chủ (user chốt) là đúng — nó bỏ được rủi ro chuỗi cung ứng §11d, **nhưng
không bỏ được bước thiết lập**.

> **Kết luận cho §4e: Google là đường G2, không phải G1.** Thẻ Google trên màn hình chọn **phải nói
> thẳng**: *"cần khoảng 10 phút thiết lập một lần ở Google"*. Bày nó ngang hàng với *"File trên
> máy"* (0 chìa) là **hứa quá tay** — và §11a-bis vừa ghi: *doạ quá tay làm người dùng tắt thứ họ
> cần; hứa quá tay làm họ bật để mua một thứ không tồn tại. Cái sau tệ hơn.*

⚠ Một sắc thái đáng ghi, **đừng dùng để nới lỏng gì**: với ứng dụng cài trên máy (native/installed
app), `client_secret` **không được coi là bí mật thật** — nó không thể giữ kín trong một phần mềm
phát hành cho người dùng cuối, và đó là lý do PKCE tồn tại. Nên rủi ro của `GOOGLE_CLIENT_SECRET`
thấp hơn một token Notion. **Nhưng nó vẫn đi vào `.state/secrets.json`, nên vẫn nằm trong đúng lỗ
§5d vừa đo được** — cách xử lý không đổi một chữ.

#### 5h·5 "Họ đã có lớp của họ rồi" — có, và **GitHub là ví dụ sạch nhất**

Câu ① vế sau của user đúng, và nó mô tả chính xác GitHub:

| | GitHub remote MCP 🌐 |
|---|---|
| Chạy ở đâu | **`https://api.githubcopilot.com/mcp/`** — không cài gì, không `npx` |
| Transport | **Streamable HTTP** — đúng chuẩn mới §2 |
| Xác thực | **OAuth 2.0** (khuyến nghị) **hoặc PAT** |
| Chìa tĩnh cần điền | **0 nếu đi OAuth**, 1 nếu đi PAT |
| Rủi ro chuỗi cung ứng §11d | **không có** — không tải mã của ai về máy khách |

⇒ **GitHub không cần một `client_id` nào cả** — GitHub tự là nhà cung cấp danh tính, nên bước ② của
Google **không tồn tại ở đây**. Đó là khác biệt thật giữa *"hãng đã dựng sẵn lớp cấp quyền"* và
*"hãng bắt bạn tự đăng ký một ứng dụng trước"*.

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

## 6e. Node hay không node — trả lời, rồi ba cửa vào

> **Câu user hỏi:** *"trên UI cắm MCP được ngay, nó nên là 1 node hay là gì?"*
>
> **Đáp: NODE, và nó ĐÃ LÀ node rồi.** ✅ `layout.ts` sinh node `mcp:<server>` cho mọi khoá trong
> `company.mcpServers`; `CAN_CONNECT` cho `mcp → agent | assistant`; cạnh lưu trong
> `roles/<id>.yaml`; `Inspector.tsx:538` đã có nhánh render. **Thứ thiếu chưa bao giờ là cái node —
> là ĐƯỜNG SINH RA nó.**

Node đúng vì năm câu hỏi ở §1a đều "có", nhưng có **một** lý do mạnh hơn cả năm:

> **Cạnh nối LÀ hành động cấp quyền.** Kéo một sợi dây từ `🔌 Notion` xuống `Người viết` **chính là**
> ghi `mcp: [notion]` vào `roles/nguoi-viet.yaml`. Không có mô tả nào của "cấp quyền cho ai" gọn
> hơn một sợi dây nhìn thấy được. Bỏ node đi thì phải đẻ ra một danh sách checkbox ở đâu đó — kém
> hơn ở mọi mặt, và **rời khỏi chỗ người dùng đang nhìn**.

### Ba cửa vào — chọn hai, bỏ một

| | Cửa | Được | Mất |
|---|---|---|---|
| **A** ⭐ | Nút **`+ Kết nối`** cạnh `+ Nhân viên` trên thanh nổi của canvas | cùng ngữ pháp với thứ duy nhất người dùng đã biết cách dùng · rẻ · **danh mục hiện ra ngay ở màn đầu** | không "kéo thả" |
| **B** ❌ | Ngăn kéo palette bên rail, **kéo thả** lên canvas | đúng chữ *"rút ra xài được ngay"* theo nghĩa đen | ba cái mất, xem dưới |
| **C** ⭐ | Từ bảng chi tiết của **một nhân viên**: `Cánh tay: chưa có [+ Cắm]` | **đúng lúc người dùng nghĩ ra nhu cầu** · cắm xong nối dây sẵn | phải nhớ đồng bộ hai cửa về một hộp thoại |

**Vì sao BỎ B, dù nó nghe hiện đại nhất:**

1. **Kéo thả bán giá trị "chọn chỗ đặt", mà chỗ đặt ở đây không thuộc về người dùng.** ✅ Canvas có
   tự sắp (`firstFreeSlot` · `centeredSlot`) và có nút **Sắp xếp lại sơ đồ**. Người dùng thả node
   vào một chỗ rồi bấm sắp xếp là nó nhảy đi — kéo thả **hứa một quyền mà nút bên cạnh lấy lại**.
2. **Chi phí thật không nằm ở bước chọn.** Từ *"tôi muốn Notion"* tới *"nhân viên dùng được Notion"*,
   bước chọn tốn **1 giây**; điền chìa + thử + giao cho ai tốn **phần còn lại**. Kéo thả tối ưu
   đúng cái bước không tốn gì, rồi đặt người dùng trước **cùng một cái form**.
3. **Nó phá ngữ pháp của rail.** ✅ Sáu ngăn hiện có đều là **kho/danh sách** (`Sidebar.tsx` §TABS —
   *"AI ĐẶT FILE VÀO ĐÓ?"*). Một palette là khái niệm khác hẳn, và nhét vào đó là dạy người dùng
   rằng rail không có quy luật nào.

⇒ **Chốt: A là cửa chính, C là cửa phụ, cả hai mở CÙNG MỘT hộp thoại.** *"Rút ra xài được ngay"*
được đáp bằng **thẻ danh mục hiện sẵn ở màn đầu**, không phải bằng thao tác kéo.

⚠ **Tên nút: `Kết nối`, không phải `MCP`, cũng không phải `Cánh tay`.** `SPEC-connectors` §6 đã chọn
chữ *"Kết nối"* từ 14/08 và người non-code tự đoán ra nghĩa của nó. *"Cánh tay"* là chữ của **spec**,
không phải chữ của **sản phẩm** — giữ nó trong tài liệu, đừng đưa lên màn hình.

## 6f. Hộp thoại ba bước — và bước 3 là bước bắt buộc

```
BƯỚC 1 · Chọn                          BƯỚC 2 · Chìa & Thử       BƯỚC 3 · Giao cho ai
┌───────────────────────────────┐     ┌────────────────────┐    ┌──────────────────┐
│  Cắm một kết nối              │     │ 📝 Notion          │    │ Ai được dùng?    │
│                               │     │                    │    │                  │
│ ┌──────┐ ┌──────┐ ┌──────┐   │     │ Token  [········]  │    │ ☑ Người viết     │
│ │  📁  │ │  📝  │ │  🗂  │   │ ──► │  ↳ lấy ở: Notion → │──► │ ☐ Người soát     │
│ │ File │ │Notion│ │Google│   │     │    Settings →      │    │ ☐ Kế toán        │
│ │ máy  │ │      │ │      │   │     │    Connections     │    │                  │
│ │không │ │1 chìa│ │ đăng │   │     │                    │    │ Chưa chọn ai thì │
│ │ chìa │ │      │ │ nhập │   │     │ [ Thử ngay ]       │    │ kết nối này nằm  │
│ └──────┘ └──────┘ └──────┘   │     │ ✓ 200 · 15 việc    │    │ im, không tốn gì │
│                               │     │                    │    │                  │
│ ── đã cắm ở văn phòng khác ── │     │        [ Lưu ] ←── │    │      [ Xong ]    │
│ 🔌 shopify   (dùng lại)       │     │    khoá tới khi ✓  │    │                  │
│                               │     └────────────────────┘    └──────────────────┘
│ ── hoặc ──                    │
│ ⚙ Tự cắm — dán cấu hình MCP   │
└───────────────────────────────┘
```

**Bước 1 — ba thứ trên một màn, và thứ tự có lý do:**

| Khối | Nội dung | Vì sao ở đó |
|---|---|---|
| Thẻ danh mục | 3 mục §4e | *"rút ra xài ngay"*. **Câu phụ trên thẻ nói CÁI GIÁ** (`không chìa` / `1 chìa` / `đăng nhập`) — người dùng chọn được theo công sức, không phải theo tên |
| **Đã cắm ở văn phòng khác** | 🔌 tên · `dùng lại` | ✅ `mcpServers` là **cấp công ty** (`types.ts:386`). Chìa đã khai rồi ⇒ dùng lại là **0 bước**. Không có khối này thì người dùng khai chìa Notion lần thứ hai và tự hỏi vì sao |
| Tự cắm | dán JSON | đường **B** §4c — không ai bị chặn |

**Bước 2 — luật đã có, áp nguyên:** *không cho **Lưu** khi chưa **Thử** thành công một lần*
(`SPEC-tools-approval` §10b). Với MCP, "thành công" có **năm** mức (§6c) — `needs-auth` **không phải
lỗi**, nó là *"bấm nút đăng nhập đi"*.

**Bước 3 — bắt buộc, không phải tuỳ chọn. Đây là chỗ dễ bỏ sót nhất.**

> **Một node không có dây là một node CHẾT.** Nó hiện trên sơ đồ, trông như đã xong, và **không ai
> dùng được**. Người dùng non-code sẽ không đoán ra là còn phải kéo một sợi dây — họ vừa bấm "Lưu"
> và thấy chữ ✓.
>
> Đây đúng lớp lỗi *"hệ thống nói dối về trạng thái của chính nó"* (`SESSIONS_MEMORY` §5i·1). Nên
> bước 3 **hỏi thẳng**, và câu dưới ô nói ra hậu quả của việc không chọn ai — **kèm mặt tốt của
> nó** (`không tốn gì`), để người muốn cắm sẵn để đó vẫn có đường đi mà không thấy mình làm sai.

## 6g. Node hiện gì — trạng thái, không phải nhãn tĩnh

Hôm nay `NodeShape.tsx:97` in cứng `'tool ngoài'` / `'chưa khai trong company.yaml'`. Với 📖
`mcpServerStatus()` thì nó nói được sự thật:

```
┌────────────────────────┐   ● hoạt động · 15 việc · 2 người dùng
│ 🔌 Notion              │   ⚠ cần đăng nhập            ← bấm vào là mở lại bước 2
│    ● 15 việc · 2 người │   ✗ không kết nối được       ← bấm vào là hiện nguyên văn `error`
└────────────────────────┘   ⏳ đang kết nối…
                             ○ đã tắt
```

⚠ **Ba ràng buộc, cả ba đều là bài học đã trả tiền:**

1. **`✗` phải mở ra NGUYÊN VĂN `error`.** Nó là chuỗi duy nhất người dùng copy đi hỏi chỗ khác
   được (cùng lý do `planProblemsMessage` không giấu danh sách lỗi).
2. **Trạng thái vào node được, vào DANH BẠ TRỢ LÝ thì phải ổn định hoá** — node nhấp nháy chỉ là
   pixel; danh bạ nhấp nháy là **bump cacheKey mỗi lần**. → §7c.
3. **Đổi `NodeShape` không được kéo theo render cả cây.** ✅ Đã có tiền lệ đúng: `LibraryBody` tách
   riêng **chỉ để** giữ ràng buộc đó (`NodeShape.tsx:9`). Node MCP có trạng thái sống ⇒ **phải tách
   `McpBody` y hệt**, không đăng ký store ngay trong `NodeShape`.

### 🆕 Node MCP chỉ hiện ở văn phòng ĐANG DÙNG nó — **đổi hành vi, chưa cài**

✅ Hôm nay `layout.ts:125` dựng node cho **mọi** khoá trong `company.mcpServers`, ở **mọi** văn
phòng. Đúng với ý *"một chỗ cắm, mọi văn phòng thấy"* (`types.ts:386`) — nhưng ý đó được viết khi
cắm một MCP tốn 9 bước và không ai có quá một cái.

**Danh mục làm việc cắm rẻ đi ⇒ tiền đề đó hết đúng.** Cắm 6 kết nối là 6 node lạ nằm trong sơ đồ
của văn phòng Kế toán, không dây nào, không việc gì.

| | Chốt |
|---|---|
| **Canvas** | chỉ node có **ít nhất một dây trong văn phòng này**, cộng node vừa cắm trong phiên |
| **Kho chung** | vẫn cấp công ty — hiện ở **khối "đã cắm ở văn phòng khác"** của bước 1 |
| **Bỏ dây cuối cùng** | node rời khỏi canvas, **kết nối và chìa vẫn còn** — giống *"Cho nghỉ"* của nhân viên, không giống *"Xoá"* |

> **Đây là chỗ ranh giới công-ty / văn-phòng cuối cùng cũng đọc được bằng mắt:** *cái gì đã cắm* là
> của công ty, *ai được dùng* là của văn phòng. Bản hiện tại trộn hai thứ vào một mặt phẳng và bắt
> người dùng tự tách ra trong đầu.

⚠ Ràng buộc đi kèm: `layout.ts` có nhánh **node mồ côi** (`missing`) giữ lại + báo đỏ node có file
đã biến mất. Luật mới **không được nuốt nhánh đó** — *"không còn khai trong `company.yaml`"* và
*"văn phòng này không dùng"* là **hai chuyện khác hẳn nhau**, và gộp chúng là đúng lỗi
`catch { exists = false }` ([[agentco-catch-hides-premises]]).

## 6i. ✅ SỔ CHUNG + BĂM — danh tính tách khỏi tên (user chốt 23/08, đã xây)

**Vấn đề gốc của bốn triệu chứng khác nhau: `id` gánh hai vai cùng lúc** — vừa là danh tính, vừa
là tên hiển thị. Cất đi rồi tạo lại cùng thư mục không bắt được · danh sách "đã cắm ở nơi khác" nở
ra một mớ gần giống nhau · cùng cấu hình khác tên thành hai thứ · đổi tên là **đổi khoá**, kéo theo
viết lại `mcp:` trong mọi `roles/*.yaml` của mọi văn phòng.

```yaml
mcpServers:                    # nửa của SDK — không thêm một trường nào
  a2bebbdc121: { command: npx, args: [-y, "…filesystem@…", "D:\\Ho so"] }
arms:                          # nửa của agentco
  a2bebbdc121: { label: "Hồ sơ công ty", catalog: files, secrets: [] }
```

| Tầng | Là gì | Ai quyết |
|---|---|---|
| **Sổ chung** (công ty) | băm(cấu hình + tên chìa) → cấu hình · nhãn · tên chìa | máy sinh, bất biến |
| **Hiện diện** (văn phòng) | `role.mcp: [băm]` | người dùng, mỗi văn phòng một kiểu |

⇒ **Clone giữ nguyên** như user chốt trước đó — nhưng clone ở tầng *hiện diện*, không phải ở tầng
*bản sao cấu hình*. Cái nở ra trước đây chính là thứ thứ hai.

### Ba hệ quả, và cái thứ ba xoá được cả một khái niệm

**① Trùng lặp thành chuyện KHÔNG THỂ XẢY RA**, không phải chuyện phải nhớ đi kiểm ở bốn chỗ. Cùng
cấu hình ⇒ cùng khoá. Đây là *chặn bằng cấu trúc, không bằng kỷ luật* — cùng luật đã áp cho chìa.

**② Đổi tên là thao tác rẻ nhất hệ**: sửa một chuỗi trong sổ. Không đổi khoá, không di trú, không
phá cache của ai ⇒ **cố ý không có câu cảnh báo nào**. Dán cảnh báo lên một thao tác vô hại là dạy
người dùng bỏ qua cảnh báo, rồi họ bỏ qua đúng cái đáng đọc.

**③ 🔴 BỎ HẲN "LƯU TRỮ" cho cánh tay.** Nhân viên cần hai mức vì họ mang thứ **dựng lại không
được** — kỹ năng, giới thiệu, sổ kinh nghiệm. Cánh tay **chỉ mang cấu hình**, mà sổ chung không xoá
nó. Nên "xoá" đã sẵn có tính chất của "cất đi": ✅ đo được — xoá rồi cắm lại đúng thư mục thì
**cùng id, và cái tên đã đặt tự quay lại**.

> Mượn một khái niệm từ chỗ nó xứng đáng sang chỗ nó không — đó là thứ vừa được gỡ ra. Nó xoá luôn
> câu hỏi *"chỗ khôi phục MCP nằm đâu"* thay vì phải đi trả lời nó.

⚠ Mất **sợi dây**: cắm lại phải nối lại. Với một cánh tay phục vụ 1–2 người thì đó là một cú kéo —
rẻ hơn hẳn việc nuôi cả một khái niệm chỉ để cứu nó.

### ⚠⚠ BĂM KHÔNG THAY ĐƯỢC PHÉP KIỂM ĐƯỜNG DẪN — phải giữ CẢ HAI

Câu hỏi user tự đặt, và nó đúng chỗ:

| | Hỏi gì | Phạm vi |
|---|---|---|
| **băm** | *cấu hình y hệt này đã biết chưa* | **công ty** — để tái dùng |
| **đường dẫn** | *văn phòng này đã với tới thư mục đó chưa* | **văn phòng** — luật một-đường-dẫn |

Ca chứng minh không bỏ được cái thứ hai: **ngày ta bump phiên bản gói trong danh mục**, cùng một
thư mục ra **băm khác** ⇒ tạo được cánh tay thứ hai trỏ đúng chỗ cũ ⇒ luật một-đường-dẫn **thủng
im lặng**. Băm không thấy, vì với nó đó là hai cấu hình khác nhau thật.

### 🔴 Và nó vá luôn một lỗ đã mở từ đầu: `role.secrets` không có ai ghi

`pickMcp` dựng env từ `role.secrets`, nhưng cho tới 23/08 **không chỗ nào ghi trường đó** trong
luồng cắm cánh tay. ⇒ cắm một cánh tay cần chìa thì token vào `.state/secrets.json` đúng, `role.mcp`
đúng, mà **tiến trình MCP khởi động không có biến môi trường nào**.

Tệ hơn: `probeArm` cũng không tiêm chìa ⇒ **nút "Thử ngay" kiểm một thứ khác với thứ sẽ chạy** —
đúng lớp lỗi dự án này bắt đi bắt lại.

Sổ chung là chỗ trả lời *"cánh tay này cần chìa tên gì"*, nên `grantArm` gộp danh sách đó vào
`role.secrets` và `probeArm` nhận cùng bộ. **Một nguồn, hai chỗ dùng — không còn lệch.**
⚠ Nhánh HTTP (`headers`) vẫn chưa nối — §5a, còn mở.

## 6h. Đếm lại số bước — thước đo của cả §6

| | Hôm nay (bài 10 chặng B) | Sau §6 |
|---|---|---|
| **Notion** | — | **3 bấm + 1 dán** |
| **File trên máy** | — | **3 bấm + chọn thư mục**, không chìa nào |
| **Google** | 9 bước · 3 file · 1 restart · 1 project Google Cloud | 3 bấm + 1 lần đăng nhập *(nếu spike 5 xanh)* |
| Số file yaml phải mở | **3** | **0** |
| Số lần restart | **1** | **0** |

**Mục "File trên máy" là mục chứng minh cả mệnh đề**: nó đi từ bấm tới chạy được mà **không có một
ô chìa nào**. Nếu một người non-code không làm nổi mục đó trong 30 giây thì thiết kế §6 sai, và
biết điều đó **trước khi** xây hai mục còn lại là rẻ nhất.

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

### 8a-bis. ✅ ĐO 23/08 — bảng trên **đúng một nửa**, và nửa sai là nửa quan trọng

Số liệu thật từ spike 1 (14 tool của `filesystem`):

| annotation | có mấy tool | mức bảng §8a nói | **đúng không?** |
|---|---|---|---|
| `readOnly: true` | **10** | `read` | ✅ đúng, và tín hiệu này **dày** (10/14) |
| không annotation | **1** | `write_external` | ✅ đúng — và ca này **có thật**, không phải giả định |
| `destructive: true` | **3** | `irreversible` | 🔴 **SAI** — xem dưới |
| `openWorld: true` | **0** | — | ❓ **không có quan sát nào** |

#### 🔴 `destructive` KHÔNG phải `irreversible` — hai khái niệm khác nhau, và số liệu chỉ ra chỗ khác

Ba tool bị gắn `destructive: true` là `write_file` · `edit_file` · `move_file`. Áp bảng cũ thì
**mọi lần ghi một file qua cánh tay này đều phải hỏi người dùng**. Đó là hỏng: `SPEC-tools-approval`
§8a định nghĩa `irreversible` là *"gửi đi · xoá · trả tiền · **đăng công khai**"* — tức **rời khỏi
thế giới của người dùng**. Ghi một file lên đĩa của chính họ không phải chuyện đó.

| | MCP nói gì | Ta hỏi gì |
|---|---|---|
| `destructive` | *"tool này ghi đè / xoá dữ liệu"* | — |
| `openWorld` | *"tool này chạm ra thế giới ngoài"* | — |
| `irreversible` của ta | — | *"làm xong có rút lại được không"* |

**Chốt sửa:** `destructive: true` ⇒ **`write_external`**, không phải `irreversible`. Nó nói *"ít
nhất là ghi"*, và đúng như thế.

**⇒ `irreversible` KHÔNG suy được từ annotations.** Nó phải đến từ một trong hai chỗ, và cả hai
đều có chủ thể chịu trách nhiệm:

| nguồn | ví dụ |
|---|---|
| **Danh mục ta curate** | *"tool `send_email` của cánh tay này là gửi đi"* — ta viết, ta chịu |
| **Người dùng bấm** | *"tool này nguy hiểm, hỏi tôi mỗi lần"* |

> **Đây là một chỗ thiết kế bị số liệu sửa, không phải bị lập luận sửa.** Bảng §8a viết khi chưa ai
> thấy một `annotations` thật; nó ghép hai từ nghe giống nhau (`destructive` ↔ *phá huỷ* ↔
> *không hoàn tác*) và đọc rất trôi. Mười bốn dòng dữ liệu làm nó lộ ra ngay.

⚠ **`openWorld` là ứng viên tốt hơn hẳn cho `irreversible`** — nó hỏi đúng câu *"có rời khỏi thế
giới này không"*. Nhưng **0/14 tool khai nó**, nên ta **không có một quan sát nào**. `filesystem`
là một thế giới đóng, nên đó là kết quả hợp lý — và cũng có nghĩa phép đo này **không nói được gì**
về `openWorld`. **Phải đo lại với một cánh tay chạm mạng (GitHub — spike 8)** trước khi xây §8 lên
trên nó.

### 8a-ter. 🔴 HÀNG RÀO `guardedZone` **KHÔNG che tool MCP** — lỗ vừa mở lại qua cửa khác

`paths.ts §guardedZone` (vá 23/08) chặn đọc `.state/` và ghi file cấu hình. Nhưng hook khớp
`Read|Grep|Glob` và `Write|Edit|NotebookEdit` — **tên builtin**. Tool của một MCP filesystem mang
tên `mcp__<server>__read_file`, **không khớp cái nào**.

⇒ **Một cánh tay file trỏ vào thư mục chứa `company/` mở lại đúng hai lỗ đã vá sáng cùng ngày.**

| | trạng thái |
|---|---|
| Vá HẸP — chặn cắm gốc nuốt thư mục văn phòng/công ty | ✅ **đã làm** — `catalog.ts §swallowsOffice`, 6 test |
| Vá RỘNG — mở matcher hook sang `mcp__*` | ❌ **chưa làm**, và ❓ **chưa ai đo matcher đó có khớp không** |

> ⚠ **Đừng đọc vá hẹp thành "đã an toàn".** Nó đóng **con đường dễ đi nhất** (người dùng vô tình
> chọn ổ `D:\`), không đóng cả lớp: một MCP bất kỳ có tool đọc file, trỏ vào bất kỳ đâu chứa
> `.state/`, vẫn đi vòng qua được. Cùng luật *"đã hẹp lại, chưa đóng"* đã áp cho `Bash`.
>
> Đây là **lý do thứ hai** để §8 (cổng duyệt) không bị hoãn vô hạn: `PreToolUse` là tầng duy nhất
> mọi lời gọi tool đi qua, kể cả MCP — và spike 3 vẫn chưa chạy.

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

### 9b. 🔴 CÂU HỎI CHẶN — ✅ **ĐÃ ĐO 23/08: CÓ. Tool MCP nằm trong prefix, mọi lượt.**

> ## ✅ SPIKE 2 — `scripts/spike-mcp.ts`. Hai phép đo độc lập, và **chúng không khớp nhau**.
>
> **2a · `getContextUsage()`** — miễn phí, control request:
>
> | | total | `mcpTools` |
> |---|---:|---|
> | không MCP | 5 915 | 0 |
> | + MCP files (mặc định) | **8 690** | 14 tool · **`isLoaded: 0`** · 2 775 token |
> | + MCP files · `alwaysLoad` | **8 690** | 14 tool · **`isLoaded: 14`** · 2 775 token |
>
> **2b · hoá đơn thật** — 2 lượt haiku, **nonce phá cache** (`cache_read = 0` cả hai ⇒ nonce chạy):
>
> | | `cache_write` |
> |---|---:|
> | 7 tool văn phòng | **4 546** |
> | + MCP files (14 tool) | **6 731** |
> | **MCP thêm vào** | **+2 185 token / mỗi lượt gọi worker** |
>
> ### Bốn kết luận, và cái thứ ba là cái không ai đoán trước
>
> **① Không có hoãn. `alwaysLoad` là NO-OP ở cấu hình của ta.** Hai dòng 2a cho **cùng một số**;
> chỉ `isLoaded` đổi. 📖 `.d.ts` nói tool *"deferred **when tool search is enabled**"* — và ta
> truyền `tools: [7 tool văn phòng]`, một allowlist **không chứa `ToolSearch`**. Giả thuyết ở §9b
> bản cũ **đúng nguyên văn**, giờ có số.
>
> **② Một cánh tay ≈ một cái shell.** MCP 14 tool = **2 185**, shell = **2 688**. ⇒ **0,81×**.
> Đây là con số đáng nhớ nhất của cả spike: *cắm một cánh tay đắt gần bằng bật shell*.
>
> **③ ⚠ HAI NGUỒN LỆCH 27%, và phải biết dùng cái nào lúc nào.**
>
> | | MCP thêm vào |
> |---|---:|
> | `getContextUsage()` | **2 775** |
> | hoá đơn (`cacheCreationInputTokens`) | **2 185** |
>
> Chúng **không đo cùng một thứ**: `getContextUsage` kê **cửa sổ ngữ cảnh** (nên nó có cả
> `Autocompact buffer 33 000` và `Free space`), hoá đơn kê **thứ được ghi vào cache**.
> ⇒ **Tiền thì đọc hoá đơn; giao diện thì đọc `getContextUsage`** (nó có phân rã theo từng tool,
> hoá đơn không có). Trộn hai số là báo sai 27%.
>
> **④ Một con số cũ được xác nhận chéo:** 2b đo `4 546` cho 7 tool văn phòng — đo 22/08 ghi
> **`4 547`**. Lệch 1 token sau một ngày, một script khác, một model khác. Nền tảng đo được là đáng
> tin. ⚠ Nhưng `getContextUsage` gọi cùng thứ đó là **`System tools 5 711`** — **đừng đem so với
> 4 547**, chúng là hai hệ quy chiếu.
>
> ### ⇒ Việc phải làm, và nó KHÔNG phải "bật `ToolSearch`"
>
> | | |
> |---|---|
> | ✅ **BỎ TRẦN** — user chốt 23/08 | `SPEC-connectors` §5 đặt trần **2 000** token/vai trò khi chưa ai đo. Một cánh tay đã **2 185** ⇒ nó **chặn ngay cánh tay ĐẦU TIÊN**. Bỏ hẳn, **không đặt số mới** |
> | **Thay bằng: HIỆN GIÁ** | Trần cứng chặn đúng thứ người dùng **cố ý** muốn, còn con số thì họ **chưa bao giờ được thấy**. Tiền là của khách — nghĩa vụ của ta là làm lựa chọn đó **sáng mắt thay vì mù**, không quyết hộ |
> | Ba chỗ phải hiện số | thẻ danh mục lúc chọn · node trên sơ đồ · bảng chi tiết nhân viên (**cộng dồn** mọi cánh tay của người đó). Thiếu chỗ nào là quay lại đúng cái vô hình vừa bỏ |
> | Cắm 3 cánh tay ≈ **+6 500 token/lượt** | trên nền 4 546 là **2,4×**. Đây là lúc câu `ToolSearch` (§5c) đáng mở lại — nhưng **chỉ khi đo được rằng hoãn thật sự rẻ hơn**, không phải vì con số này trông to |
>
> ⚠ **Ranh giới:** đo với **đúng một** server 14 tool. Quan hệ giữa *số tool* và *số token*
> **chưa đo** — đừng ngoại suy tuyến tính. Đo lại khi có mục danh mục thứ hai (Notion).

### 9b·cũ. ❓ Giả thuyết ban đầu (giữ lại để thấy nó đúng)

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

### 9d. Rút một cánh tay thì tri thức của nó đi đâu — **ĐỪNG XOÁ, hãy NGỦ**

> **Câu user hỏi:** *"Rút MCP thì tri thức của nó mất theo — câu hỏi là có đánh đổi công sức quá
> nhiều không?"*
>
> **Đáp: bản XOÁ đắt và nguy hiểm; bản NGỦ gần như miễn phí và đạt đúng mục tiêu anh muốn.**

Mục tiêu thật của "mất theo" là **đừng trả token cho tri thức về một thứ không còn cắm**. Đó là một
mục tiêu về **prefix**, không phải về **đĩa**. Hai bản khác nhau hẳn:

| | Bản XOÁ | Bản NGỦ ⭐ |
|---|---|---|
| Làm gì | tìm mọi node có nguồn là MCP đó, xoá file | thêm `source: mcp:<tên>`, và **lọc khỏi HOT** khi cánh tay không còn dây |
| Token khi đã rút | 0 | **0** — giống hệt |
| Công sức | ⚠ phải dựng đường xoá theo lô, phải có test | **một trường + một điều kiện** trong phép chọn HOT |
| Cắm lại | tri thức **mất vĩnh viễn**, học lại từ đầu (mỗi bài học là một lượt LLM đã trả tiền) | quay lại nguyên vẹn |
| Rủi ro | 🔴 rơi vào lớp `dropDependents`/`findTwin` — ✅ *"hai mảnh DUY NHẤT thật sự xoá file của user"*, và **nợ 0b ghi rõ chúng CHƯA CÓ TEST** | 🟢 không xoá byte nào |

**Ba lý do bản XOÁ sai, và lý do thứ ba là lý do chặn:**

1. **Tiền đề "rút = thôi dùng" thường sai.** Người ta rút để **xoay token**, để thử một server
   khác, để tạm tắt cho đỡ tốn. Xoá là phạt một thao tác vốn vô hại.
2. **Phần lớn tri thức đó KHÔNG nói về cái tool.** ✅ `SPEC-tools-approval` §7b đã tách sẵn:
   *"tool này tạo một page"* là của MCP; *"hoá đơn nằm ở database Kế toán 2026"*, *"năm tài chính
   bắt đầu tháng 4"* là **tri thức của TỔ CHỨC**, chỉ tình cờ được phát hiện qua cánh tay đó. Rút
   Notion không làm năm tài chính đổi.
3. **Tách hai loại trên là câu hỏi NGỮ NGHĨA ⇒ không bao giờ tất định được.** Luật đã chốt:
   *cái TẤT ĐỊNH chỉ được nói về thứ CÓ MÃ NGUỒN THI HÀNH.* Một cổng xoá dựa trên *"ghi chú này nói
   về tool hay về công ty"* là đúng thứ vừa bị bác ở ca ㉕ — và ở đây **phủ định sai làm mất dữ liệu
   người dùng**, không chỉ chặn nhầm một việc. ⇒ [[agentco-safe-default-direction]]

**Chốt: NGỦ.** Node giữ nguyên trên đĩa, mang `source`, và **rơi khỏi HOT** khi cánh tay không còn
dây trong văn phòng — nên nó thôi tốn token ngay lập tức. Tra tay vẫn thấy, cắm lại là sống lại.
Trùng với *"soft delete"* user đã chốt cho mọi thứ khác trong sản phẩm này.

⚠ Kèm một điều kiện: `source` phải ghi lúc **sinh** node (biết chắc bài học đến từ lượt nào, cánh
tay nào), **không** đoán ngược bằng cách dò chuỗi tên server trong nội dung. Dò chuỗi là lấy **hình
dạng thay cho nguồn gốc** — lỗi đã đếm được **bốn lần** trong dự án này.

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

### 10d. ⏸ GÁC LẠI — user chốt 23/08

**Docker để sau**, user tự test rồi tính tiếp. ✅ Không chặn gì: năm ràng buộc container của
`SPEC-cli.md` §4 vẫn giữ, và §6 không đẻ ra vi phạm nào mới.

**Nhưng hai thứ ở §10b phải mang theo, vì chúng KHÔNG phải việc của Docker:**

1. **Bất biến §1b viết sai ngay từ bây giờ.** *"Chuỗi người dùng vừa gõ"* mang tiền đề ngầm *"người
   dùng và daemon nhìn cùng một hệ thống file"* — tiền đề đó đã sai với **VPS** (user đã tự nêu ở
   ca nút 📂), không cần chờ Docker. Sửa câu chữ của bất biến là việc **bây giờ**; dựng ánh xạ
   đường dẫn mới là việc của Docker.
2. **Danh mục "File trên máy" (§4e mục 1) là mục ĂN TRỌN cú va này.** Nó hỏi *"cho phép thư mục
   nào"* ⇒ nó **đã** cần một danh sách thư mục tường minh ⇒ đúng chỗ để đặt ánh xạ đường dẫn sau
   này. ⇒ Thiết kế mục đó **đừng giả định đường người dùng gõ = đường daemon thấy**, kể cả khi hôm
   nay chúng bằng nhau. Đó là chỗ rẻ nhất để trả trước cho Docker, và **nó rẻ vì chỉ là đừng khẳng
   định một điều ta chưa cần khẳng định**.

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

### 11a-bis. ✅ Trả lời thẳng: *"dán logo của họ lên node MCP cũng vi phạm à?"*

**Không tự động vi phạm — và đó là dạng dùng logo DỄ BẢO VỆ NHẤT có thể có.** Logo đứng cạnh tên,
trong một danh sách tích hợp, để chỉ **đúng dịch vụ đó** — đây chính là *nominative use*, và cả
ngành làm thế (Zapier, n8n, Make đều bày logo đối tác).

**Nhưng "dễ bảo vệ nhất" ≠ "được phép mặc định".** Ba chuyện khác nhau, và người ta hay gộp:

| | Rủi ro |
|---|---|
| Logo **nhỏ, cạnh tên, trong danh sách kết nối**, không hàm ý bảo trợ | 🟢–🟡 thấp. Đây là chỗ anh định dùng |
| Logo trong **ảnh quảng cáo / landing page** của agentco | 🟠 cao hơn — bối cảnh marketing dễ đọc thành "có quan hệ đối tác" |
| Logo làm **icon của app / của một tính năng** | 🔴 gần như luôn bị cấm tường minh |

**Cái quyết định không phải nguyên tắc chung, mà là QUY TẮC CỦA TỪNG HÃNG** — và ba mục v1 khác
nhau đúng ở chỗ đó:

| Mục v1 | Thương hiệu bên thứ ba? | Trạng thái |
|---|---|---|
| **File trên máy** | ❌ **không có** — server tham chiếu của chính MCP | 🟢 icon của ta, **rủi ro bằng 0** |
| **Notion** | có | 🟡 ❓ **chưa xác nhận được** trang quy tắc của họ trong một lượt tra. Đó chính là lý do trường `checked_on` tồn tại |
| **Google** | có | 🟠 🌐 **nghiêm nhất, và đã đọc**: cấm dùng logo Google làm logo app; buộc ghi công; chỉ được nói *"for / compatible with"* |

> ⚠ **Kết quả tra Notion — không tìm thấy trong một lượt — chính là dữ liệu, không phải thất bại.**
> Trạng thái bình thường của một hãng là *"chưa ai đi đọc quy tắc của họ"*, và đưa logo lên dựa
> trên *"chắc là được, ai cũng làm"* là **đúng cái hình dạng** mà cả dự án này đang chống:
> một khẳng định nghe hợp lý, không ai kiểm, sống rất lâu vì **không bao giờ gây triệu chứng** —
> cho tới ngày nó gây.

**⇒ Chốt cho v1: ship bằng icon trung tính cho CẢ BA.** Không phải vì rủi ro cao, mà vì ba lý do
cộng lại:

1. **Nó không chặn gì cả.** `brand{}` là một **trường dữ liệu**; bật logo cho từng hãng về sau là
   sửa một dòng, không phải sửa code.
2. **Nửa logo nửa icon xấu hơn cả hai phương án thuần.** Ship logo Notion + icon xám cho Google
   trông như một sản phẩm chưa làm xong.
3. **Cái giá của việc chờ gần bằng 0.** Người dùng nhận ra "Notion" bằng **chữ Notion**; logo mua
   thêm khoảng nửa giây nhận diện.

Đổi lấy: **không có món nợ pháp lý nào nằm trong bản đầu tiên đem đi bán.** Đọc quy tắc từng hãng
là việc của một buổi, làm bất cứ lúc nào, và làm **một lần cho mỗi hãng**.

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
| ~~**1**~~ | ✅ **XONG 23/08** — `scripts/spike-mcp.ts` | **✅ CÓ.** 14 tool · **13/14 có annotations** · `openWorld` **0/14** | §8a sửa một dòng — xem §8a-bis |
| ~~**2**~~ | ✅ **XONG 23/08** — cùng script, `--paid` | **🔴 KHÔNG hoãn.** `alwaysLoad` là no-op · **+2 185 token/lượt** (0,81× shell) | §9b |
| **3** | `PreToolUse` matcher `mcp__*` trên một lời gọi tool MCP thật | cổng duyệt cho **stdio** có tồn tại không | **§8c** — stdio là ca phổ biến nhất. Hỏng thì phải bọc proxy |
| **4** | `setMcpServers()` giữa phiên: thêm · bớt · sai chìa | cắm/rút không restart · `errors` có nói được gì hữu ích không | **§6** — nút Thử ngay và cả B7 |
| **5** | `onElicitation` `mode:'url'` với một server cần OAuth | OAuth qua UI có đi được không | **§6d** — và bài 10 chặng B |
| ~~**6**~~ | ✅ **XONG 23/08** — `scripts/spike-secrets.ts` | **cả §5d lẫn §5f: 🔴 CÓ, cả hai.** $0,0389 | — |
| ~~**7**~~ | ⏸ Docker — **gác lại 23/08** | | — |
| **8** | 🆕 Cắm GitHub remote (http) và xem `pickMcp` có tiêm `headers` không | lỗ §5a có thật không (**dự đoán: có** — `worker.ts:634` chỉ nhận `command`) | mục danh mục #3 |

⚠ **Bẫy đo đã trả tiền hai lần, áp cho spike 2:** lần đo thứ hai **ăn cache của lần một** và cho ra
chênh lệch 0. **Phải cắm nonce vào system prompt để ép miss cả hai lần.** [[agentco-measurement-vs-conclusion]]

⚠ **Bẫy đo cho spike 1 và 4:** 📖 `.d.ts` nói control request **chỉ chạy ở streaming input mode**,
và ✅ ta đã học ở §5n ⑤ rằng chúng **không được trả lời khi vòng lặp chính đang bận**. ⇒ Gọi
`mcpServerStatus()` lúc CLI **rảnh** — đúng công thức đã cứu `usage()`: mở query với generator
**giữ stream mở mà chưa gửi tin nào**.

---

## 13. Thứ tự làm

Xếp theo *mở khoá bao nhiêu / công sức*, và **ba việc đầu là ĐO chứ không phải XÂY**:

Cập nhật 23/08 theo bốn chốt của user. **Ba việc đầu là ĐO**, việc thứ tư và năm là **bịt hai lỗ
đang mở** — cả năm cộng lại chưa tới một buổi, và chúng quyết định hình dạng của phần còn lại.

| # | Việc | Mở khoá | Cỡ |
|---|---|---|---|
| ~~1~~ | ✅ **Spike 6** — hai lỗ §5d + §5f | **cả hai 🔴 CÓ.** $0,0389 · 23/08 | xong |
| ~~2~~ | ✅ **Bịt §5d + §5f** — `paths.ts §guardedZone` + `officeJail` hai matcher | **cả hai 🟢 KHÔNG**, đo lại cùng ngày. **+17 test → 298.** 0 token | xong |
| ~~3~~ | ✅ **Spike 1 + 2** — `scripts/spike-mcp.ts` | `tools[]`+`annotations` ✅ **CÓ** (13/14) · MCP **KHÔNG hoãn**, **+2 185 token/lượt** · $0,025 | xong |
| **4** | **Spike 4** — `setMcpServers` hot-plug | nút **Thử ngay**, xoá bước restart | nhỏ |
| 5 | **Đường B** — hộp thoại `+ Kết nối` 3 bước, dán config (§6f) | **xoá cả 4 chuông** 📝 | vừa |
| 6 | Mục **File trên máy** (§4e #1) | ⭐ **thước của cả §6**: bấm → chạy, **0 ô chìa** | nhỏ |
| 7 | Chìa đi theo cạnh nối (§6b) | xoá bước B6 | nhỏ |
| 8 | Mục **Notion** (§4e #2) | cơ chế **ô chìa tĩnh** | nhỏ |
| 9 | Node hiện trạng thái + tách `McpBody` (§6g) | thấy cánh tay sống hay chết | nhỏ |
| 10 | **Spike 8** → bịt §5a (tiêm `headers`) → mục **GitHub** (§4e #3) | đường **HTTP**, và lỗ §5a chưa ai chạm | vừa |
| 11 | Dòng năng lực từ handshake (§7) | Trợ lý chia việc đúng người | nhỏ |
| 12 | **Spike 5** → mục **Google** qua `onElicitation` (§4e #4, đường **G2**) | bài 10 chặng B | vừa |
| 13 | Node chỉ hiện ở văn phòng đang dùng (§6g) | sơ đồ sạch khi cắm đã rẻ | nhỏ |
| 14 | **Spike 3** → cổng duyệt hai tầng (§8) | bài 10 chặng C. ⚠ **đừng lên lịch trước spike 3** | lớn |
| 15 | Tri thức `source` + ngủ theo cánh tay (§9d) | chốt ⑱ của user | **rất nhỏ** |
| 16 | Builder MCP cho autobot swarm (§5g) | luồng dựng **có tên, có nhật ký** | vừa |
| 17 | Connector tự sinh (đường **C**) | **đặc sản** | lớn |
| ⏸ | Docker (§10) | gác lại — user tự test rồi tính | — |
| ⏸ | **Bố cục HÌNH SAO cho nhân viên** (user đề xuất 23/08) | hàng ngang hết chỗ khi đông người | lớn |

> ### ⏸ Bố cục hình sao — gác lại 23/08, **và đây là thứ phải chốt trước khi xây**
>
> **Vấn đề có thật:** hàng ngang `PER_ROW = 4` rồi xuống dòng — mỗi hàng thêm vào đẩy hai kho xuống
> một tầng, và sơ đồ nở theo chiều dọc. Đã lấy trước phần rẻ (thu nhỏ node, siết khe dọc), nhưng
> đó là **hoãn**, không phải **giải**.
>
> **Chưa xây có chủ ý:** nó động vào `arrangeAll` · `centeredSlot` · `firstFreeSlot` · `clashes`
> **cùng lúc**, và cả bốn đều có test canh những ca đã từng hỏng thật (người thứ ba dồn về một
> phía · ô mới đè lên người cũ · ô lệch nửa cột). Làm dở thì tệ hơn hàng ngang.
>
> **Một câu phải user chốt trước, vì hai đáp án ra hai sơ đồ khác hẳn nhau:**
>
> | | Trợ lý ở đâu | Đọc ra là gì |
> |---|---|---|
> | **Vòng tròn** | **giữa**, nhân viên vây quanh | quan hệ **hướng tâm** — ai cũng ngang hàng nhau |
> | **Hình quạt** | **đỉnh**, nhân viên toả xuống hình nan quạt | quan hệ **trên–dưới**, giữ được "việc chảy từ trên xuống" |
>
> ⚠ Vòng tròn đẹp hơn nhưng nó **phá tầng**: cánh tay và hai kho đang nằm dưới cùng vì luật *"việc
> chảy xuống, tài nguyên đẩy lên"*. Đặt Trợ lý vào giữa thì trục dọc đó không còn, và phải nghĩ
> lại chỗ cho **cả bốn** loại node chứ không riêng nhân viên.

> **Việc 2 nhảy lên đầu vì spike 6 đã đổi trạng thái của nó**: hôm qua nó là *"bịt một lỗ ta nghi
> là có"*, hôm nay là *"bịt một lỗ ta đã nhìn thấy chạy, hai lần, trong 45 giây, giá $0,04"*.
>
> **Việc 5 và 6 gần như là một** — §5h·1 đo được: danh mục **là đường B với form điền sẵn**, không
> phải cơ chế thứ hai. Nên "xây đường B rồi mới có danh mục" không phải hai giai đoạn, nó là một
> việc rưỡi.

> **Việc 6 là thước của cả §6.** Mục *"File trên máy"* đi từ bấm tới chạy được **không có ô chìa
> nào**. Người non-code không làm nổi nó trong 30 giây ⇒ thiết kế sai, và biết điều đó **trước khi**
> xây Notion + Google là chỗ rẻ nhất để biết.

---

## 14. Câu chưa trả lời

### ✅ Đã chốt 23/08 — không bàn lại

| | Chốt |
|---|---|
| ~~Danh mục v1~~ | **Filesystem · Notion · Google**, và đó là thứ tự xây. §4e |
| ~~Lỗ chìa khoá~~ | **A ngay.** B là đích, **C loại tường minh**. §5d · §5e ② |
| ~~Docker~~ | ⏸ **gác lại**, hai hệ quả mang theo. §10d |
| ~~Tri thức khi rút MCP~~ | **NGỦ, không xoá.** §9d |
| ~~MCP là node?~~ | **Node** — đã là node. Cửa vào = nút `+ Kết nối`, **bỏ kéo-thả**. §6e |

### ❓ Còn mở

1. **Hàng rào ĐỌC: hook, MCP filesystem, hay cả hai?** (§1d) ⚠ Câu này **nặng hơn trước** sau khi
   chốt danh mục: mục *"File trên máy"* **là** một MCP filesystem có allowlist. Nên nửa thứ hai đã
   được chốt gián tiếp — nhưng **chỉ nó thôi thì `Read` trần vẫn đi vòng qua**. Phải quyết có dựng
   hook kèm không, nếu không thì đang bán một cái khoá cho một cánh cửa mà tường bên cạnh vẫn thủng.
2. **Nếu spike 2 cho thấy tool MCP nằm trong prefix** — có mở lại quyết định `ToolSearch` không?
   (§9b) Chỉ mở bằng **số đo**, không bằng lập luận.
3. **Google đi đường G1 hay G2?** (§4e) Phụ thuộc spike 5. G2 thì thẻ Google **phải nói ra** là cần
   ~10 phút thiết lập một lần, không được bày ngang hàng hai mục kia.
4. **Danh sách trắng provider hiện ở đâu trên UI?** (§5e ③) Nó là quyết định sản phẩm, không phải
   hằng số — nhưng chưa có màn hình nào nhận nó.
5. **`+ Kết nối` đặt cạnh `+ Nhân viên`, còn ngăn kéo "Kết nối" của `SPEC-connectors` §6 thì sao?**
   Nghiêng **bỏ ngăn kéo đó**: canvas đã là danh sách, một ngăn kéo liệt kê lại cùng những object
   là **hai chỗ hiện một sự thật** — đúng thứ luật "ba kho" của `Sidebar.tsx` tránh. Cần user xác nhận.

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
