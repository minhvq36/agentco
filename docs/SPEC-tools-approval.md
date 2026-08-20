# SPEC — Khả năng, chìa khoá, cổng duyệt, và ngắt giữa chừng

**Ngày:** 15/08/2026 · **Trạng thái:** thiết kế đã chốt, chưa cài đặt

Trả lời tám câu hỏi phát sinh khi đóng vai người dùng thường chạy `TEST-WALKTHROUGH.md`. Đọc kèm `SPEC-offices.md` (§4 Trợ lý, §5 worker + secrets) và `SPEC-connectors.md` (đặc sản).

Mọi API của SDK trong file này **đã kiểm trực tiếp trên `@anthropic-ai/claude-agent-sdk@0.3.231` đã cài**, không lấy từ tài liệu web — tài liệu web sai ở ít nhất một chỗ (`PermissionResult`).

---

## 0. Tám quyết định, một bảng

| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | Trợ lý thấy gì về nhân viên? | `pitch` **+ một dòng khả năng TỰ SINH**. Skills và tri thức vẫn ẩn. |
| 2 | Nối/ngắt dây bị trễ | Tách hai đường ghi: toạ độ debounce, **cạnh nối phản hồi ngay** |
| 3 | Kế hoạch không lên chat · ngắt giữa chừng | Kế hoạch vào chat · `Esc` và `/dừng` đều gọi `interrupt()` |
| 4 | Skills phải sửa được trong UI | Đồng ý. Bảng prompt phân lớp thành sửa được, **có nút Lưu tường minh** |
| 5 | Tool hệ thống hiện ở đâu | **Không hiện ở đâu cả** — bật sẵn hết, trừ `Bash`. Xem §5 |
| 6 | Cắm MCP trong UI | Đồng ý. Ba loại: **stdio · Streamable HTTP · connector tự sinh** |
| 7 | Chìa khoá theo chùm hay theo tool | **Theo connector/MCP**. Agent không cầm chìa, nó cầm *quyền dùng* |
| 8 | Cổng duyệt | **Hai tầng**: duyệt kế hoạch một lượt + chặn từng lần việc không hoàn tác được |

---

## 1. Trợ lý thấy gì về một nhân viên

**Đúng: `pitch` là thứ duy nhất Trợ lý thấy khi chia việc.** Đó là lý do lập kế hoạch rẻ — skills, kinh nghiệm, lịch sử đều ở lại với worker.

### Nhưng có một lỗ hổng thật: khả năng không lộ ra

Nếu `Người viết` được cắm Notion mà Trợ lý không biết, Trợ lý không thể quyết định "việc này giao cho Người viết vì nó với tới được Notion". Nó sẽ chia việc như thể không ai có tool nào.

**Sửa: thêm một dòng khả năng, TỰ SINH, không bắt người dùng viết vào `pitch`.**

```
# Employees you can assign to

- nguoi-viet (Người viết): Viết nội dung tiếng Việt… [với tới: Notion, web]
- ke-toan (Kế toán): Đọc sao kê, phân loại… [với tới: Google Sheets]
- nguoi-soat (Người soát): Đọc lại kết quả… [không làm: viết code]
```

Sinh từ đâu: tên hiển thị của connector/MCP đang nối vào agent đó, cộng `web` nếu nó có `WebSearch`/`WebFetch`. **Không** liệt kê tên tool thô, **không** liệt kê schema — Trợ lý cần biết *với tới được cái gì*, không cần biết *gọi thế nào*.

Giá: ~5–10 token mỗi nhân viên. Đổi lại là Trợ lý chia việc đúng người. Đáng.

**Bắt buộc kèm theo:** dòng này nằm trong roster → nằm trong prefix được cache của Trợ lý. Cắm thêm một MCP = ghi lại cache Trợ lý một lần. Rẻ, nhưng phải biết là có.

### Chưa có chỗ sửa giới thiệu — đúng, thiếu thật

Thêm vào bảng chi tiết: sửa được `display_name`, `avatar`, `pitch`, `not_for`, `model_tier`. Ghi thẳng vào `roles/<id>.yaml` bằng `parseDocument` để giữ chú thích.

⚠ **Sửa `pitch` là bump cacheKey của Trợ lý**, sửa `model_tier` là bump cacheKey của chính agent đó. Nút **Lưu** tường minh, không autosave — giống ràng buộc đã có với skills (`SPEC-ui.md` §2.2).

---

## 2. Nối/ngắt dây phải phản hồi ngay

**Chẩn đoán:** hôm nay cạnh nối vẽ ra từ prop `canvas.edges`, mà prop đó chỉ đổi **sau khi server trả lời**. Cộng thêm `onCommit` debounce 700ms. Nên kéo xong một sợi dây phải chờ ~700ms + một vòng mạng mới thấy nó.

**Gốc rễ:** toạ độ và cạnh nối đi chung một đường ghi, trong khi chúng khác hẳn nhau.

| | Toạ độ | Cạnh nối |
|---|---|---|
| Bản chất | liên tục, ~60 sự kiện/giây | rời rạc, một lần một |
| Debounce | **cần** — ghi mỗi frame là vô nghĩa | **có hại** — không có gì để gộp |
| Hậu quả | chỉ là bố cục | đổi roster, đổi tiền |

**Sửa:**

1. Cạnh nối đi đường riêng, **gửi ngay**, không debounce.
2. Vẽ **lạc quan**: thêm/bớt cạnh vào state ngay khi thả chuột, rồi mới gửi.
3. Server trả về bản đã lọc → đối chiếu. Nếu server bỏ cạnh đó (sai luật) thì **rút lại và hiện toast giải thích**, đừng im lặng.

Tiêu chí "Mượt" nói *thao tác phản hồi trước khi server trả lời* — đây đúng là chỗ đó.

---

## 3. Kế hoạch vào chat, và ngắt giữa chừng

### 3a. Kế hoạch phải lên chat

Hôm nay kế hoạch chỉ hiện ở dải dưới canvas và panel Nhật ký. Qua Telegram thì **không thấy gì cả** — mà bridge là mục tiêu tối thượng.

Sửa: `plan.created` sinh một tin nhắn Trợ lý trong luồng hội thoại:

```
Mình chia thành 3 việc:
  1. Tìm tư liệu về tiệm hoa
  2. Viết 3 bản nháp
  3. Soát giọng văn
Bắt đầu nhé.
```

Dựng bằng **code từ `steps` đã có** — 0 token thêm. Với cổng duyệt (§8) thì chính tin nhắn này mang nút duyệt.

### 3b. Ngắt giữa chừng — SDK hỗ trợ đầy đủ

Đã kiểm trên `sdk.d.ts`:

```ts
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<SDKControlInterruptResponse | undefined>;  // CHỈ ở streaming input mode
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  close(): void;
}
// Options còn có: abortController
```

⚠ `interrupt()` **chỉ chạy ở streaming input mode** — tức `prompt` phải là `AsyncIterable<SDKUserMessage>`, không phải chuỗi.

### ⚠⚠ ĐÃ THỬ VÀ HỎNG — `interrupt()` KHÔNG dùng được, đừng thử lại

Ba lần đo thật, mỗi lần một cách:

| Cách | Kết quả đo |
|---|---|
| `prompt` là chuỗi + `interrupt()` | không có tác dụng gì. Bấm Dừng xong **cả 3 task vẫn chạy hết**, tiêu thêm **$0.36** |
| streaming input, stream **đóng ngay** sau khi yield | `interrupt()` gọi vào chỗ trống — vẫn chạy hết, **$0.27** |
| streaming input, stream **giữ mở** để interrupt có chỗ bám | **DEADLOCK.** Worker ghi file xong rồi không bao giờ trả `result` — SDK ngồi chờ thêm đầu vào. Quá 90 giây không sự kiện nào, phải kill daemon |

**Cách chạy được: `abortController` trong `Options`.** Đo: dừng sau **14,5 giây**, tốn **$0.054** thay vì $0.27 — đúng ba receipt `blocked`.

```ts
const abortController = new AbortController();
query({ prompt, options: { abortController, /* … */ } });
// dừng:
abortController.abort();
```

Giữ streaming input mode vì nó vô hại và là nền sẵn cho lúc CLI hỗ trợ đủ (`interrupt_receipt_v1`).

**Bẫy kèm theo, mất một lần đo mới thấy:** tay cầm phải được **đăng ký thật** vào `scheduler.live`. Lần đầu phép thay thế không khớp nên `live` luôn rỗng — `interruptAll()` chạy trên tập rỗng, mọi thứ biên dịch sạch, và không ai dừng được gì. **TypeScript không bắt được loại lỗi này.**

### Hai cửa vào, vì bridge

| Cửa | Ở đâu |
|---|---|
| Phím `Esc` | giao diện, khi đang chạy |
| Lệnh chữ `/dừng` (và `/cancel`) | ô chat — **hoạt động y hệt qua Telegram** |

Mọi lệnh chữ phải đi qua `office.say()` như mọi thứ khác, và bị bắt **trước** khi tới Trợ lý — đây là lệnh điều khiển, không phải câu để hiểu. Ném nó cho model là trả tiền để được trả lời chậm hơn.

Bộ lệnh chữ tối thiểu: `/dừng` `/cancel` · `/duyệt` `/ok` · `/từ-chối` `/no` · `/trạng-thái`.

### Ngắt xong thì sao — luật ngữ cảnh

Đây là phần bạn nói "khá nhạy cảm", và đúng là nhạy cảm.

```
Đang chạy: 2/4 bước          → [Esc]
  ✓ Tìm tư liệu                    ↓
  ✓ Viết bản nháp              dừng ngay
  ⟳ Soát giọng   ← ngắt        ô nhập sáng lên
  ○ Đăng bài                   bạn gõ: "giọng trẻ hơn, đừng đăng vội"
                                     ↓
                               Trợ lý lập kế hoạch MỚI cho phần CÒN LẠI
```

**Ba luật, và luật thứ ba là luật khó:**

1. **Việc đã xong giữ nguyên.** Plan cũ đóng ở trạng thái `stopped`, giữ nguyên receipt và artifact của các task đã xong. Không làm lại.
2. **Plan mới nhận một bản tóm tắt bàn giao**, dựng bằng **code**: câu yêu cầu gốc · các bước đã xong + đường dẫn artifact · bước đang dở · lời mới của bạn. Đây là văn bản ta ghép, **không phải** một lượt gọi LLM.
3. **Trợ lý KHÔNG được kéo transcript của task đã chết sang.** Nó vốn đã không thấy transcript worker — chỉ thấy receipt (≤800 token). Bàn giao vì thế **tự nhiên đã sạch**: nó thừa hưởng *kết quả*, không thừa hưởng *quá trình*.

> Giao thức Receipt được thiết kế để tiết kiệm token, và hoá ra nó giải luôn bài toán ngữ cảnh sau khi ngắt. Cùng một cơ chế, hai vấn đề — đây là dấu hiệu ranh giới đặt đúng chỗ.

Session hội thoại của Trợ lý **giữ nguyên** (nó phải nhớ bạn vừa nói gì). Chỉ *vòng đời công việc* đóng lại.

---

## 4. Skills sửa trong UI — đồng ý, không bàn thêm

Bảng prompt phân lớp đã hiện đúng cấu trúc rồi; chỉ cần cho sửa những lớp `editable: true`:

| Lớp | |
|---|---|
| Lõi | 🔒 chỉ đọc (trừ khi `allow_core_prompt_edit`) |
| Giới thiệu văn phòng (charter) | ✏️ sửa được |
| Kỹ năng | ✏️ sửa được |
| Kinh nghiệm nạp sẵn | 🔒 chỉ đọc — sửa ở ngăn kéo Tri thức |

**Ba ràng buộc bắt buộc:**

1. **Không autosave.** Nút **Lưu** tường minh. Mỗi lần lưu là bump cacheKey → trả một lần ghi cache. Autosave theo phím = churn cache liên tục.
2. **Hiện số token ngay khi gõ**, và cảnh báo khi vượt trần (`assistant_skills_tokens` 400, `charter_tokens` 500).
3. **Nói rõ hậu quả ngay cạnh nút Lưu:** *"Lưu sẽ làm mọi nhân viên phải ghi lại bộ nhớ đệm một lần (~X token)."* Người dùng có quyền biết cái nút họ sắp bấm tốn gì.

API: `PUT /api/office/:id/prompt/:who/:layer` với `{ text }`. Ghi vào đúng `layer.file`.

---

## 5. Tool hệ thống: **bật sẵn hết, trừ một cái**

Bạn phân vân đúng chỗ, và cả hai phương án tôi đưa ra đều sai. Câu trả lời đúng là **không có giao diện nào cả**.

### Lý do

Claude Code viết `Read`/`Write`/`Glob`/`Grep`/`WebSearch`/`WebFetch` rất sạch, và **mọi agent đều cần chúng**. Bắt người dùng bật `WebSearch` cho một nhân viên tên "Người tìm tin" là hỏi một câu chỉ có một đáp án — đó không phải lựa chọn, đó là thủ tục.

Bằng chứng từ chính bài test: bài 4 và bài 10A **bắt buộc mở `roles/<id>.yaml` chỉ để thêm `WebSearch`**. Xoá cả lớp thủ tục đó thì hai bài chạy được ngay từ giao diện.

### Chốt

| Tool | Mặc định | Vì sao |
|---|---|---|
| `Read` `Write` `Glob` `Grep` | ✅ **luôn bật, không tắt được** | Đây là *tay* của văn phòng. Chúng chỉ chạm được vào thư mục văn phòng (`cwd`) và `safeJoin` đã chặn đi ra ngoài. |
| `WebSearch` `WebFetch` | ✅ **luôn bật** | Chỉ đọc. Không hỏng được gì. Là 1/4 giá trị của use case trợ lý cá nhân, và nó miễn phí. |
| `Bash` | ❌ **tắt, một công tắc trong bảng chi tiết** | Cái duy nhất chạm được ra ngoài thư mục văn phòng. Bật là mở cửa ra cả máy. Xếp mức `write_external` ở §8. |

Kết quả: **một công tắc duy nhất trong toàn hệ thống**, kèm một câu cảnh báo. Không chip, không node, không danh sách.

`roles/*.yaml` vẫn giữ khoá `tools:` cho người advanced ghi đè — nhưng người dùng thường không bao giờ chạm tới.

### ⚠ Bảng trên KHÔNG được thi hành cho tới 16/08/2026 — `tools` ≠ `allowedTools`

Ta chỉ truyền `allowedTools` và tưởng thế là giới hạn. `.d.ts` nói ngược lại:

> `allowedTools` — *"List of tool names that are **auto-allowed without prompting**… To restrict which tools are available, use the **`tools`** option instead."*
> `tools` — *"Specify the **base set** of available built-in tools."*
> `disallowedTools` — *"removed **from the model's context** and cannot be used."*

Nghĩa là **mọi nhân viên vẫn nhìn thấy toàn bộ bộ tool của Claude Code**, kể cả `Bash`. Dòng "Bash tắt, phải bật tường minh" ở bảng trên là một lời hứa chưa từng có mã nguồn đứng sau.

**Phát hiện ra bằng quan sát, không phải bằng đọc code:** dựng một file chỉ-đọc rồi giao việc ghi vào đó. `nguoi-viet` — vai trò **không khai tool nào ngoài bộ mặc định** — thử `Write` hai lần rồi **với tay sang `PowerShell` bốn lần**.

Ba cái giá cùng lúc:

| | |
|---|---|
| **Token** | định nghĩa của mọi tool nằm trong prefix được cache của MỌI lời gọi worker, vĩnh viễn |
| **Lượt** | mỗi lần thử một tool bị từ chối là một lượt trả tiền để nhận một lời từ chối |
| **Kiến trúc** | vai trò không khai `Bash` vẫn với tay tới shell được — bất biến §5 chỉ tồn tại trên giấy |

**Sửa:** truyền `tools: effectiveTools(role.tools)` cùng với `allowedTools`. Đo trên cùng một vai trò, cùng 2 lượt, cache đều ấm:

| | cache_read | cache_write | $/task |
|---|---:|---:|---:|
| trước | ~34 100 | ~4 320 | $0.051 |
| **sau** | **13 607** | **1 406** | **$0.0275** |

**Prefix giảm ~60%, giá một task giảm gần một nửa.** Phần lớn "sàn ~13 200 token mỗi worker call" hoá ra là định nghĩa của những tool ta chưa bao giờ định trao.

> **Bài học đóng gói được: một bất biến chỉ có thật khi có mã nguồn thi hành nó.** Bảng này nằm trong spec từ đầu, đọc rất thuyết phục, và sai suốt. Thứ phát hiện ra nó là một thí nghiệm 5 phút với một file chỉ-đọc — không phải một lần đọc lại code.

### Còn MCP/connector thì vẫn là NODE

Vì chúng là **thực thể có danh tính**: tiến trình riêng, cấu hình riêng, chìa khoá riêng, và **được chia sẻ giữa nhiều agent**. Node + dây là mô tả đúng cho thứ như thế. Tool hệ thống thì là *thuộc tính*, và thuộc tính không đáng có node.

---

## 6. Cắm MCP trong UI — và ba loại, không phải một

Đây là chỗ nỗi lo của bạn được giải: **người dùng không bao giờ phải viết MCP server.**

### Chuyện transport, trả lời thẳng

Đặc tả MCP hiện định nghĩa **đúng hai** transport:

| Transport | Dùng khi | Trạng thái |
|---|---|---|
| **stdio** | server chạy như tiến trình con trên máy | ✅ chuẩn cho desktop/local — **phần lớn ca dùng của ta** |
| **Streamable HTTP** | server chạy như dịch vụ mạng sau một URL | ✅ chuẩn cho remote |
| ~~HTTP+SSE~~ | (bản 2024-11-05) | ❌ **đã bị thay thế, deprecated từ bản 2025-03-26** |

Nên: **SSE không còn là "ổn định nhất" — nó là bản cũ.** Đừng dựng server SSE mới. SDK vẫn còn nhận `type: 'sse'` để tương thích ngược, ta vẫn cho cắm, nhưng gắn nhãn *"kiểu cũ"* trong giao diện.

Kiểm trên `sdk.d.ts@0.3.231` — SDK nhận **bốn** dạng:

```ts
type McpServerConfig =
  | McpStdioServerConfig            // { command, args?, env?, timeout? }
  | McpSSEServerConfig              // { type:'sse',  url, headers? }   ← kiểu cũ
  | McpHttpServerConfig             // { type:'http', url, headers? }   ← Streamable HTTP
  | McpSdkServerConfigWithInstance  // ← chạy TRONG tiến trình của ta
```

### Ba đường cắm, và không đường nào bắt viết MCP server

| Đường | Người dùng làm gì | Dành cho |
|---|---|---|
| **A · Danh mục có sẵn** | chọn từ danh sách, điền chìa | Notion, Google, Slack… — thứ nổi tiếng, ta gói sẵn cấu hình |
| **B · Dán cấu hình MCP** | dán khối JSON chuẩn | ai đã có server sẵn |
| **C · Connector — ĐẶC SẢN** | **mô tả cái API bằng form / dán cURL / dán OpenAPI** | *"POST domain/{id}"* của bạn |

**Đường C là câu trả lời cho nỗi lo của bạn.** Nó khả thi vì SDK cho tạo **MCP server chạy ngay trong tiến trình của ta**:

```ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
```

Nghĩa là: người dùng mô tả một endpoint HTTP → **ta sinh ra MCP server**. MCP trở thành **định dạng dây nội bộ của ta, không phải định dạng người dùng phải viết**. Không tiến trình con, không npx, không `package.json`.

> Đây chính xác là mệnh đề `SPEC-connectors.md` đã chốt từ 14/08: **"mô tả cái API, đừng viết code gọi nó."** Giờ nó có đường cài đặt cụ thể.

### Nhưng "tool chỉ là lời văn" thì KHÔNG được

Bạn nói: *"đôi khi cái tool ấy chỉ là text miêu tả: hãy vào trang web sau, cầm secret sau là bạn đọc ghi được"*. Người non-code làm được bằng lời — đúng. Nhưng làm thế thì agent phải **tự dựng lời gọi HTTP** qua `Bash`/`WebFetch`, và ta mất sạch ba thứ:

- **schema** → model đoán tên tham số, sai lặng lẽ
- **cổng duyệt** → không phân biệt được GET với DELETE, §8 sụp
- **chìa khoá** → secret phải nằm trong prompt để agent gõ ra. **Model đọc được khoá.** Không chấp nhận được.

**Đường giữa, và nó giữ được cả hai:** người dùng vẫn mô tả bằng lời **cộng một mẫu cụ thể** — dán một lệnh cURL, hoặc điền form 4 ô (method · URL · header · ví dụ body). Ta suy ra schema từ mẫu đó. **Lời văn của họ trở thành `description` của tool** — đúng chỗ model cần nó.

Trả lời câu *"có nên strict bắt build MCP không"*: **strict ở BÊN TRONG, không bao giờ strict ở BÊN NGOÀI.** Ta không nuông chiều — ta chuyển chỗ đau từ người dùng sang mã nguồn của mình.

---

## 7. Chìa khoá theo connector — và thẩm định câu hỏi kinh điển

### 7a. Chìa gắn vào ổ khoá, không gắn vào người

Bạn thiên về "chìa giấu dưới thảm trước cửa từng nhà" thay vì "chùm chìa khoá". **Đồng ý, và đi xa hơn một bước:** chìa thuộc về **connector**, không thuộc về **agent**.

```yaml
# connectors/notion.yaml
name: Notion
transport: stdio
command: npx
args: ["-y", "@notionhq/notion-mcp-server"]
secrets:
  NOTION_TOKEN:
    label: "Notion integration token"
    help: "Notion → Settings → Connections → Develop your own integration"
```

Người dùng bấm vào node `🔌 Notion` → hiện đúng những ô cần điền, **kèm hướng dẫn lấy ở đâu**. Điền xong, giá trị vào `.state/secrets.json`; giao diện từ đó chỉ hiện `••••••••`.

**Vì sao tốt hơn `role.secrets` hiện tại:**

| | Chùm chìa theo agent (hiện tại) | Chìa theo ổ khoá (chốt) |
|---|---|---|
| Người dùng phải nghĩ | *"nhân viên này cầm những khoá nào?"* | *"Notion cần token gì?"* — câu hỏi tự nhiên |
| Nối dây | phải nhớ khai `secrets:` **riêng**, quên là hỏng lúc chạy | nối dây là xong, chìa đi theo |
| Đặc quyền tối thiểu | giữ được, nhưng bằng kỷ luật | giữ được **bằng cấu trúc**: không nối = không có chìa |
| Nhầm lẫn | một chùm cho mọi ổ | một chìa một ổ |

Giữ nguyên hai bất biến đã có: giá trị vào **env của tiến trình MCP, không vào prompt**; **không có API đọc secret** — điền qua giao diện thì daemon ghi thẳng xuống đĩa, không có endpoint nào đọc ngược ra.

> `role.secrets` trở thành **cửa thoát cho người advanced**, không còn là đường chính. Không xoá, chỉ hạ cấp.

### 7b. Thẩm định: agent có cần skills nữa không, hay cắm MCP là nó tự biết?

Đây là câu kinh điển, và câu trả lời **không phải một trong hai**.

**Sự thật kỹ thuật:** MCP server công bố `tools/list` gồm **tên · mô tả · JSON schema** của từng tool. Model **thấy hết, tự động**. Nên với câu hỏi *"gọi tool này thế nào"* — skills là **thừa tuyệt đối**. Viết skills dạy cách gọi tool là chép lại thứ đã có, tốn token, và **sẽ lệch** khi server nâng cấp.

**Nhưng có một lớp mà `tools/list` không bao giờ chứa được:**

| Thứ MCP đã nói | Thứ MCP không thể biết |
|---|---|
| "tool này tạo một page trong Notion" | *cơ sở dữ liệu nào trong 40 cái là chỗ để hoá đơn* |
| "tham số `title` là chuỗi" | *tiêu đề phải bắt đầu bằng mã số hợp đồng* |
| "tool này xoá một page" | *ở công ty này không ai xoá, chỉ lưu trữ* |
| "tham số `date` định dạng ISO" | *năm tài chính bắt đầu từ tháng 4* |

Đó **không phải hướng dẫn dùng tool** — đó là **tri thức riêng của tổ chức**.

### Verdict

**Skills mặc định để TRỐNG. Cắm MCP là agent biết nó có thêm một cánh tay — không cần viết gì thêm.**

Và tri thức riêng ở bảng phải kia **thuộc về kho tri thức, không thuộc về skills**. Ba lý do, cả ba đều là lý do cấu trúc:

1. **Agent tự ghi được vào kho, không tự ghi được vào skills.** *"Hoá đơn nằm ở database Kế toán 2026"* là thứ agent phát hiện ra lúc làm việc — để nó tự ghi lại.
2. **Kho tri thức trả 0 token khi truy xuất** (HOT trong prefix cache, COLD chọn bằng từ khoá). Skills nằm trong prefix **vĩnh viễn**, dù task này có cần hay không.
3. **Kho chọn theo việc; skills thì luôn có mặt.** Ba mươi quy ước về Notion không nên nằm trong đầu agent lúc nó đang viết một bài blog.

**Vậy skills còn để làm gì?** Đúng một thứ: **cách làm việc ổn định, đúng-với-mọi-task** — giọng văn, thứ tự các bước, định dạng đầu ra. Ngắn. Nếu bạn viết được nó dưới 10 dòng thì nó là skills; dài hơn thì gần như chắc chắn nó là tri thức, viết nhầm chỗ.

**Với Trợ lý (router) thì càng đúng hơn:** nó không gọi tool nào cả. Nó chỉ cần biết **AI với tới được cái gì** — mà §1 đã lo bằng dòng khả năng tự sinh. Skills của Trợ lý chỉ nên có giọng điệu và kỷ luật hỏi lại.

---

## 8. Cổng duyệt — hai tầng

### 8a. Phân loại theo HẬU QUẢ, không theo tên tool

| Mức | Là gì | Xử lý |
|---|---|---|
| `read` | đọc file trong văn phòng, tra kho tri thức, `WebSearch`/`WebFetch` | **chạy luôn** |
| `write_local` | ghi vào `artifacts/` của chính văn phòng | **chạy luôn** |
| `write_external` | ghi ra ngoài qua connector/MCP · `Bash` | **duyệt ở KẾ HOẠCH, một lượt** |
| `irreversible` | gửi đi · xoá · trả tiền · đăng công khai | **duyệt lại TỪNG LẦN**, kể cả đã duyệt kế hoạch |

**Ai khai mức nào:** định nghĩa connector khai cho từng tool, hoặc một mức mặc định cho cả server. Không khai thì mặc định `write_external` — **an toàn khi không biết**. Với connector tự sinh (§6 đường C) thì suy từ HTTP method: `GET`/`HEAD` → `read`, `POST`/`PUT`/`PATCH` → `write_external`, `DELETE` → `irreversible`.

### 8b. Tầng 1 — duyệt kế hoạch, một lượt

Sau khi Trợ lý lập kế hoạch, nếu **có bất kỳ** task nào chạm `write_external` trở lên:

```
Mình chia thành 3 việc:
  1. Đọc bảng giá trong Drive              (chỉ đọc)
  2. Soạn email báo giá                    (ghi trong văn phòng)
  3. Gửi email cho khách  ⚠ gửi ra ngoài
[Cho làm]  [Sửa yêu cầu]  [Thôi]
```

- **0 token thêm** — kế hoạch đã có sẵn, ta chỉ hiện nó ra và chờ.
- Đây cũng chính là nút **"Xem trước kế hoạch"** mà `SPEC-ui.md` §2.1 đã đòi từ đầu, và là hiện thân của *"kiểm soát scope"* — nỗi đau gốc của sản phẩm.
- Qua Telegram: cùng một tin nhắn, trả lời `/duyệt` hoặc `/từ-chối`.

**Auto-confirm** là công tắc theo từng văn phòng, mặc định tắt. Bật thì bỏ tầng 1, **không bao giờ bỏ tầng 2**.

### 8c. Tầng 2 — chặn từng lần, dùng `canUseTool`

> ## ⚠⚠ ĐỌC TRƯỚC KHI XÂY MỤC NÀY — PHÉP ĐO 19/08 CHƯA XÁC NHẬN CƠ CHẾ
>
> Toàn bộ mục 8c dưới đây dựng trên kiểu trong `.d.ts`, **chưa từng chạy thật**. Ngày 19/08 lần đầu có người thử `canUseTool` trong dự án này, và **nó không nổ một lần nào**:
>
> | thử | kết quả |
> |---|---|
> | `canUseTool` với `allowedTools: []` | không nổ |
> | `canUseTool` + `prompt` là streaming input | không nổ |
> | hook `PreToolUse`, có và không có `matcher: '*'` | không nổ |
>
> Đo bằng cách ghi mọi lời gọi ra file: **rỗng tuyệt đối** trong khi tool vẫn chạy bình thường. Chi tiết: `SPEC-offices.md` §4.7.
>
> **⚠ Ranh giới của phép đo — đừng suy rộng hơn:** chỉ đo với `Grep`/`Glob`, tức là tool **chỉ-đọc**. Suy đoán tốt nhất là chúng được CLI tự duyệt nên không bao giờ đi qua đường phê duyệt. `Bash` và tool ghi **chưa đo**, nên thiết kế dưới đây **chưa bị bác bỏ**.
>
> **Việc bắt buộc trước khi xây:** một spike 10 phút — cho một vai trò khai `Bash`, giao nó chạy một lệnh, và kiểm `canUseTool` có nổ không. Nếu không nổ thì cả tầng 2 phải thiết kế lại (khả năng cao là bằng **tool MCP tự khai**, nơi ta tự chạy tác vụ nên không phụ thuộc cơ chế duyệt nào).
>
> Đây đúng luật *"một bất biến chỉ có thật khi có mã nguồn thi hành nó"*, áp cho một tính năng **chưa viết**: đừng lên lịch dựa trên một cơ chế chưa ai thấy chạy.

Đây là chỗ SDK làm sẵn cho ta, và làm tốt hơn mọi cách tự chế. Kiểm trên `sdk.d.ts@0.3.231`:

```ts
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; suggestions?: PermissionUpdate[]; /* … */ },
) => Promise<PermissionResult | null>;

type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; /* … */ }
  | { behavior: 'deny'; message: string; interrupt?: boolean; /* … */ };
```

> ⚠ Tài liệu web ghi `{ allow: true }`. **Sai.** Bản đã cài dùng `{ behavior: 'allow' }`. Luôn tin file `.d.ts` trong `node_modules`.

**Vì sao cái này giải bài toán gọn hơn hẳn:**

1. **Worker ĐỨNG CHỜ, không chết.** Promise chưa resolve thì lời gọi tool treo ở đó. Duyệt xong nó chạy tiếp **cùng một phiên, cùng một ngữ cảnh** — **0 token thêm**. Phương án "sinh task mới với payload đã duyệt" tôi từng nghĩ tới sẽ tốn thêm cả một lượt worker.
2. **Bạn thấy đúng payload thật**, không phải mô tả về payload — nội dung email, không phải chữ "gửi email".
3. **`updatedInput` cho SỬA trước khi cho qua.** Nút `[Sửa]` trên hộp thoại là thật, không phải trang trí.
4. **`deny` kèm `message`** quay lại cho agent như một kết quả tool — nó biết vì sao bị từ chối và tự xoay xở, thay vì fail cụt.

**Một thay đổi bắt buộc trong `worker.ts`:** hôm nay ta truyền `allowedTools: role.tools`, mà tool nằm trong `allowedTools` thì **được duyệt tự động và KHÔNG gọi `canUseTool`**. Nên `allowedTools` chỉ được chứa nhóm `read` + `write_local`; mọi thứ từ `write_external` trở lên phải rơi xuống `canUseTool`.

### 8d. Luồng đầy đủ

```
Agent gọi tool  ──►  canUseTool
                      │
      mức read/write_local ──► { behavior:'allow' }            (không hỏi ai)
      mức write_external   ──► kế hoạch đã duyệt? ──► allow
                                    chưa ──► deny + lý do
      mức irreversible     ──► HỎI NGƯỜI ─┬─ [Cho làm]  ──► allow
                                          ├─ [Sửa]      ──► allow + updatedInput
                                          └─ [Thôi]     ──► deny + message
                                              (hết hạn 10 phút ──► deny)
```

Sự kiện mới: `approval.requested` (kèm `toolName`, `input`, `plan_id`) và `approval.resolved`. Cả hai mang `office` + `plan_id` như mọi sự kiện khác, nên Telegram bridge dùng lại được nguyên xi.

**Hết hạn thì từ chối, không phải cho qua.** Người dùng đóng máy đi ngủ thì việc dừng lại — đó là hành vi đúng.

---

## 8e. Bộ lệnh chữ — TIẾNG ANH, và phải chặn TRƯỚC khi tới SDK

Dự án Việt Nam nhưng đi ra thế giới: **lệnh là tiếng Anh, câu trả lời theo ngôn ngữ người dùng.**

| Lệnh | Làm gì |
|---|---|
| `/stop` | ngắt việc đang chạy (= phím `Esc`) |
| `/approve` | duyệt thứ đang chờ |
| `/reject` | từ chối |
| `/status` | đang chạy gì, tốn bao nhiêu |
| `/help` | liệt kê chính bảng này |

### ⚠ Nguy cơ đụng lệnh — và cách chặn

Claude Code có bộ lệnh gạch chéo riêng (`/clear`, `/compact`, `/model`…). Chuỗi ta đưa vào `query({ prompt })` **đi tới chính CLI đó**, nên một câu bắt đầu bằng `/` **có thể bị nó hiểu là lệnh của nó**. `/clear` lọt qua là mất trắng ngữ cảnh hội thoại của Trợ lý mà không ai biết vì sao.

**Luật, không có ngoại lệ: mọi chuỗi bắt đầu bằng `/` PHẢI bị chặn ở `office.say()` và KHÔNG BAO GIỜ được chuyển nguyên xuống SDK.**

```
người dùng gõ ──► office.say()
                    │
     "/stop"        ├─► lệnh của TA      → xử lý bằng code, 0 token
     "/clear"       ├─► không phải của ta → trả lời "không có lệnh này" + /help
     "//giá"        ├─► thoát dấu        → gỡ một "/" rồi mới gửi: "/giá"
     "viết bài…"    └─► văn bản thường   → gửi cho Trợ lý
```

Ba tính chất của thiết kế này:

1. **Danh sách trắng, không phải danh sách đen.** Ta không cần biết Claude Code có những lệnh gì, hôm nay hay năm sau — cái gì không phải của ta thì không đi tiếp.
2. **Lệnh xử lý bằng code, 0 token.** Ném `/stop` cho model là trả tiền để được dừng chậm hơn.
3. **`//` là cửa thoát** cho người thật sự muốn bắt đầu câu bằng dấu gạch chéo.

Cùng một bộ lệnh dùng được ở giao diện và ở Telegram — vì cả hai đều đi qua `office.say()`.

---

## 10. Người không biết gì tự dựng được "cánh tay" — bằng đúng ba đường

Bạn hỏi đúng câu phải hỏi: *tôi tự tin thế thì chỉ ra người không biết gì họ làm thế nào.*

### 10a. Trình dựng Connector — ba đường vào, một kết quả

Cả ba đều sinh ra **cùng một file** `connectors/<tên>.yaml`, và runtime tổng hợp thành MCP chạy trong tiến trình bằng `createSdkMcpServer` + `tool()`.

| Đường | Người dùng làm | Ai dùng được |
|---|---|---|
| **A · Dán cURL** ⭐ | copy một lệnh cURL từ tài liệu API hoặc từ DevTools ("Copy as cURL") rồi dán | **gần như ai cũng làm được** — đây là đường chính |
| **B · Dán OpenAPI** | dán URL hoặc file `openapi.json` | ai có sẵn tài liệu chuẩn |
| **C · Điền form** | 4 ô: method · URL · header · ví dụ body | ai không có cURL lẫn OpenAPI |

**Vì sao cURL là đường chính:** nó là thứ **đã tồn tại sẵn** ở mọi trang tài liệu API, và mọi trình duyệt đều xuất ra được bằng một cú chuột phải. Người dùng không *viết* gì cả — họ *chép*.

```
┌─ Cánh tay mới ────────────────────────────────────────┐
│ Tên       [ Kho hàng của tôi                        ] │
│ Mô tả     ┌──────────────────────────────────────┐   │
│           │ Tra tồn kho theo mã sản phẩm. Trả về │   │
│           │ số lượng còn và giá bán.             │   │
│           └──────────────────────────────────────┘   │
│                                                       │
│ Dán cURL  ┌──────────────────────────────────────┐   │
│           │ curl -X GET \                        │   │
│           │  https://api.shop.vn/items/{id} \    │   │
│           │  -H "Authorization: Bearer abc123"   │   │
│           └──────────────────────────────────────┘   │
│                                                       │
│ Suy ra được:                                          │
│   phương thức  GET      → chỉ đọc, không cần duyệt    │
│   tham số      id       (bắt buộc, từ {id})           │
│   chìa khoá    ●●●●●●   → lưu thành SHOP_TOKEN        │
│                                                       │
│         [ Thử ngay ]   [ Lưu ]                        │
└───────────────────────────────────────────────────────┘
```

### 10b. "Không lỗi" đến từ nút **Thử ngay**, không đến từ lời hứa

Đây là phần quan trọng nhất và cũng là phần rẻ nhất để làm.

Bấm **Thử ngay** → ta gọi thật một lần với chìa thật → hiện **nguyên văn phản hồi**:

```
✓ 200 OK · 180ms
{ "id": "SP-102", "name": "Áo thun", "stock": 47, "price": 250000 }
→ Đã hiểu. Cánh tay này trả về: id, name, stock, price
```

hoặc

```
✗ 401 Unauthorized
{ "error": "invalid token" }
→ Chìa khoá sai hoặc hết hạn. Sửa ở ô Authorization rồi thử lại.
```

**Không cho Lưu khi chưa Thử thành công một lần.** Người dùng non-code không cần hiểu HTTP — họ chỉ cần thấy dấu ✓. Đây là chỗ biến "hy vọng nó chạy" thành "tôi đã nhìn thấy nó chạy", và nó **loại bỏ gần hết lớp lỗi cấu hình** trước khi lỗi đó kịp gặp một agent.

Thêm: ta lưu luôn phản hồi mẫu đó làm **ví dụ đầu ra** trong `description` của tool. Model biết trước nó sẽ nhận về hình dạng gì.

### 10c. Ranh giới ngôn ngữ tự nhiên — chỗ nào được, chỗ nào không

| Phần | Dạng | Vì sao |
|---|---|---|
| **Cái này để làm gì** | ✅ ngôn ngữ tự nhiên | thành `description` của tool — đúng thứ model cần |
| **Gọi nó thế nào** | ❌ phải có mẫu (cURL/OpenAPI/form) | thiếu schema thì model đoán tên tham số và **sai lặng lẽ** |
| **Chìa khoá** | ❌ phải là ô riêng | xem §10e |

Người dùng vẫn "mô tả bằng lời" — chỉ là lời của họ đi vào đúng ô mà lời có tác dụng.

### 10d. Description: ai phải viết, và sửa thì có phải dựng lại không

| Loại | Người dùng có phải viết mô tả? | Vì sao |
|---|---|---|
| **MCP ngoài sạch sẽ** (Notion, Google…) | ❌ **không** | server đã công bố `tools/list` kèm mô tả từng tool. Ta chỉ xin **tên hiển thị** cho node trên sơ đồ. |
| **Connector tự dựng** | ✅ **có, và là ô duy nhất** | không có nguồn nào khác. Chính textarea đó thành `description` của tool. |

**Có trùng không?** Không. Với connector tự dựng, mô tả của người dùng là mô tả **duy nhất** — không có gì để trùng. Với MCP ngoài, ta **không** thêm mô tả nào vào tool cả; tên hiển thị chỉ dùng cho node và cho dòng khả năng ở §1.

**Sửa mô tả thì có phải "dựng lại node" không?**

Không có bước dựng lại nào cho người dùng — worker vốn là one-shot, lần chạy sau tự dựng server mới. **Nhưng nó không miễn phí:** mô tả tool nằm trong định nghĩa tool, mà định nghĩa tool đứng **trước** system prompt trong prefix được cache. Sửa mô tả = **đổi prefix = ghi lại cache một lần** cho mọi agent đang nối tới connector đó.

Nên áp đúng luật của skills: **nút Lưu tường minh, không autosave, và nói ra cái giá ngay cạnh nút** — *"Lưu sẽ làm 2 nhân viên ghi lại bộ nhớ đệm một lần."*

### 10e. Chìa khoá: **luôn có cấu trúc**, không bao giờ là văn bản tự do

Trả lời thẳng câu 3 của bạn: **không dùng ngôn ngữ tự nhiên kiểu `ID=... \n KEY=...`.** Ba lý do, lý do đầu là lý do chặn:

1. **Tên biến phải khớp CHÍNH XÁC.** MCP Notion đọc `NOTION_TOKEN`, không đọc `Notion token` hay `TOKEN`. Một ô văn bản tự do sẽ sinh ra hàng chục cách viết sai mà ta không đoán nổi.
2. **Phân tích văn bản tự do sẽ hỏng** ở dấu `=` trong giá trị, ở khoảng trắng, ở dấu nháy, ở khoá nhiều dòng (private key của Google là nhiều dòng).
3. **Có cấu trúc mới hướng dẫn được từng ô** — *"lấy ở Notion → Settings → Connections → Develop your own integration"*. Một ô trống không dạy được ai điều gì.

**Nhưng người dùng không phải học định dạng nào cả**, vì form được **sinh ra**:

| Nguồn | Ô hiện ra từ đâu |
|---|---|
| Danh mục có sẵn (Notion, Google, Slack) | ta ship sẵn danh sách ô + hướng dẫn từng ô |
| Dán cấu hình MCP | quét `env`/`headers` tìm chỗ trống, hỏi đúng những ô đó |
| Connector tự dựng | suy từ chính cURL đã dán — `Bearer abc123` → một ô, gợi ý tên `SHOP_TOKEN` |

Trải nghiệm vẫn là **"điền 2 ô"**, không phải "học một định dạng". Khác biệt nằm ở chỗ 2 ô đó do ta sinh ra chứ không do người dùng nghĩ ra.

### 10f. stdio vẫn ở lại — bạn đúng

Streamable HTTP cho remote, **nhưng stdio không phải hàng cũ**: nó là cách duy nhất chạy một cánh tay **trên chính phần cứng của bạn** — đọc file trên máy, gọi thiết bị trong mạng LAN, sau này là trên VPS của bạn. Đó là thứ dịch vụ đám mây không làm được, và nó hợp với nguyên tắc "kết quả nằm trong thư mục của bạn".

Chốt ba loại, không loại nào thay loại nào:

| | Dùng khi | Chìa khoá đi đâu |
|---|---|---|
| **stdio** | cánh tay chạy trên máy/VPS của bạn | `env` của tiến trình con |
| **Streamable HTTP** | dịch vụ có sẵn sau một URL | header `Authorization` |
| **Connector tự dựng** | một endpoint HTTP lẻ của bạn | header, do ta tiêm |

---

## 11. Trợ lý là MỘT NGƯỜI — hòm thư và hai trạng thái độc lập

### 11a. Đây không phải lựa chọn thiết kế, nó là bắt buộc kỹ thuật

`askSession()` chạy `resume: sessionId` rồi ghi đè `sessionId` bằng id mới. **Hai lượt gọi chồng nhau thì cả hai cùng resume một id, cả hai cùng ghi đè, và MỘT LƯỢT BỊ MẤT TRẮNG** khỏi trí nhớ hội thoại. Người dùng thấy Trợ lý "quên" câu vừa nói mà không hiểu vì sao.

Nên nguyên tắc sản phẩm *"một người chỉ làm một việc một lúc"* trùng khít với ràng buộc kỹ thuật. Ghi vào spec, và nó đúng ở cả hai tầng.

**Nhưng nhân viên thì chạy song song thoải mái** — họ là hàm stateless, mỗi người một phiên riêng. Đây là hai trạng thái **hoàn toàn độc lập**:

```
Trợ lý:    idle ─────► thinking ─────► idle
Nhân viên:      2 đang chạy ────────────► 1 ────► 0
```

Giao diện phải nói được **cả hai**, nếu không người dùng thấy im lặng và tưởng hệ thống chết. Sự kiện `office.activity { assistant, workers, queued }`.

### 11b. Hòm thư — gom, không chặn

| Tình huống | Xử lý |
|---|---|
| Trợ lý **bận**, người dùng nhắn | vào hòm thư. Nhiều tin liên tiếp → **gom làm MỘT lượt** |
| Trợ lý **rảnh**, nhân viên đang chạy | trả lời ngay. Đây là "tận dụng khoảng trống thời gian" |
| Người dùng giao **việc mới** khi đang chạy việc cũ | ghi nhận, xếp vào `deferred`, làm nốt sau khi ca hiện tại xong |
| Hòm thư đầy (>12 tin) | từ chối lịch sự: *"Bạn nhắn nhanh quá — mình còn N tin chưa đọc"* |
| Lệnh chữ (`/stop`…) | **vượt hàng đợi**, xử lý bằng code, 0 token |

**Gom là tiết kiệm thật, không chỉ cho gọn.** Đo được: bắn 4 tin cùng lúc → **2 lượt gọi thay vì 4**. Và nó *đúng hơn*: ba câu gõ liền nhau là một ý, trả lời câu 1 khi đã có ngữ cảnh câu 3 là trả lời sai.

Câu gộp dựng bằng **code**, không phải một lượt LLM để "tóm tắt" — chuyện đó đúng là mua sự mượt mà bằng token, thứ bốn tiêu chí cấm.

### 11c. Khoá phải là MUTEX THẬT, không phải một lá cờ

Bản đầu dùng `busy = true/false`. Không đủ: `run()` gọi `plan()` rồi `report()` từ một nhánh khác với vòng bơm, hai bên cùng đặt cờ, bên nào xong trước cũng gỡ cờ của bên kia — **đúng lại cái lỗi mà cả cơ chế này sinh ra để tránh**. Phải xếp hàng bằng chuỗi promise, và đếm độ sâu để lồng nhau không gỡ khoá sớm.

Ba chỗ phải qua khoá: `route()` · `plan()` · `report()`. Giai đoạn DAG chạy thì **không** giữ khoá — đó chính là khoảng Trợ lý rảnh để nói chuyện.

### 11d. Bảng quản lý của Trợ lý — do CODE giữ, không do Trợ lý giữ

Ý tưởng "Trợ lý cần một cái bảng, có cờ cái nào cũ cái nào chưa xử lý" là đúng — nhưng **cái bảng đó phải nằm trong mã nguồn, không nằm trong prompt**.

Trợ lý mà phải suy luận trên một danh sách việc tồn đọng thì danh sách đó nằm trong ngữ cảnh **mọi lượt**, và nó dài ra theo thời gian. Thay vào đó: hàng đợi là một cấu trúc dữ liệu thật, code loại tin cũ, và **Trợ lý chỉ bao giờ nhìn thấy đúng lô hiện tại**.

### 11e. `/stop` dừng CẢ HỆ THỐNG — **BỐN** thứ, không phải ba

Ngắt nhân viên đang chạy **+** **ngắt lượt của chính Trợ lý** **+** xoá hòm thư **+** bỏ việc đang hoãn. Giữ lại bất cứ thứ gì trong bốn thứ đó nghĩa là người dùng bấm Dừng xong vẫn thấy hệ thống tự làm tiếp — đúng thứ họ vừa bảo đừng. Câu trả lời nói rõ đã cắt gì và bỏ bao nhiêu việc.

> ⚠ **Thứ thứ hai bị bỏ quên tới 20/08, và bảng này là bằng chứng.** Ba thứ kia có mã nguồn thi hành từ đầu; lượt Trợ lý thì `Assistant.run()` **không có `AbortController` nào** — không tồn tại tay cầm để ngắt. Đúng luật *một bất biến chỉ có thật khi có mã nguồn thi hành nó*: câu "dừng CẢ HỆ THỐNG" đọc rất thuyết phục và sai suốt.

**Ba biến, phải hỏi cả ba trước khi kết luận "đang rảnh":**

| | biến | ý nghĩa |
|---|---|---|
| Plan đang chạy | `office.state === 'working'` | có DAG trên sơ đồ |
| Trợ lý đang trong một lượt | `mailbox.isBusy` · `clearing` | **không** suy được từ hàng đợi |
| Còn việc xếp hàng | `mailbox.size` · `deferred.length` | |

Bug đã sửa 20/08: phép kiểm cũ chỉ hỏi `state` + `size` + `deferred`. Lúc Trợ lý đang nghĩ, lô tin đã được `take()` ra khỏi hàng đợi nên `size === 0`, và `state` vẫn `idle` vì chưa có Plan nào ⇒ `/stop` trả *"Hiện không có việc nào đang chạy."* rồi câu trả lời hiện ra ngay sau. **Hệ thống nói dối về trạng thái của chính nó**, ngay thao tác đầu tiên của phiên.

**Ngắt lượt Trợ lý KHÔNG mâu thuẫn với §11f** (*"mặc định để chạy nốt, không giết"*). Luật đó bảo vệ **bản nháp đã trả tiền** của nhân viên: giết ở 80% là mất trắng 80% tiền đã tiêu. Một lượt `route()` không đẻ ra bản nháp nào — ngắt nó chỉ mất một câu trả lời, đúng cái người dùng vừa bảo đừng nói.

**Ba hệ quả phải làm cùng lúc, thiếu một là hở:**

1. `FailureKind` có thêm `'stopped'` — ngắt **không phải lỗi**. Không có nhãn này thì ca đóng ở `failed` và nhật ký ghi *"hệ thống làm sai"* cho một việc người dùng tự bảo đừng làm. Cùng lý do `blocked` đã tách khỏi `failed` (SPEC-offices §6): nhật ký phải phân biệt *ta hỏng* · *ta đang chờ bạn* · *bạn bảo dừng*.
2. **Đúng MỘT câu báo.** `/stop` đã trả lời rồi, nên `pump()` và `Office.run()` **không** phát thêm tin cho `kind === 'stopped'`.
3. **Con trỏ session trả về chỗ cũ.** `sessionId` được ghi từ tin `init`, tức là ngay đầu lượt — giữ con trỏ mới sau khi ngắt nghĩa là lượt sau `resume` vào một bản ghi **viết dở**, và cái giá là toàn bộ trí nhớ hội thoại. Bản ghi cũ vẫn nằm nguyên trên đĩa (append-only) nên trả về là an toàn, và ngữ nghĩa cũng đúng: lượt bị dừng thì **không xảy ra**.

⚠ Cơ chế là `abortController`, **không** phải `Query.interrupt()` — bài học đã trả tiền một lần ở §8, đừng thử lại.

---

## 11f. Nhân viên đang chạy mà người dùng đổi ý — ba tầng, ba câu trả lời khác nhau

### Tầng 1 — "nhồi input mới vào worker đang chạy": KHÔNG LÀM ĐƯỢC, và đó là tin tốt

Worker là một lượt `query()` one-shot. Nó **không có hòm thư**. Không có API nào đưa thêm lời vào giữa chừng — chỉ có **giết** hoặc **để chạy xong**.

Nghe như hạn chế, nhưng nó xoá luôn một câu hỏi khó: *"worker đang bận mà lại cần đúng worker đó thì sao?"* — **không bao giờ xảy ra**. Worker stateless nên một vai trò chạy được nhiều task cùng lúc; không có tranh chấp trên *người*, chỉ có trần concurrency. Quyết định "agent là hàm stateless" từ phiên đầu trả công lần nữa ở đây.

### Tầng 2 — giết hay để chạy nốt: kinh tế học quyết định, không phải cảm tính

`chi phí ≈ số lượt × prefix × 0.1` nghĩa là **worker đã chạy 80% thì đã tiêu 80% tiền của nó**.

| | Giết ngay | Để chạy nốt rồi sửa |
|---|---|---|
| Tiền đã tiêu | **mất trắng** | giữ được |
| Tiền phải tiêu thêm | làm lại **từ đầu** | 20% còn lại + một task sửa |
| Đầu vào của bước sau | không có gì | **có bản nháp để SỬA, không phải viết lại** |

Task *sửa một bản nháp* rẻ hơn hẳn task *viết mới*. Nên **mặc định: để chạy nốt.** Trùng với đời thực — bảo người viết "giọng trẻ hơn" thì họ chỉnh bản nháp, không xé đi viết lại.

**Giết chỉ dành cho `/stop`** — người dùng nói thẳng "sai hướng rồi", đúng lúc mà việc phí tiền đã tiêu là đúng. Không tự động giết vì bất kỳ suy đoán nào.

### Tầng 2b — "mớ bầy nhầy" sau khi giết: NÓI RA, đừng xoá

Worker bị giết có thể đã ghi được một phần các file nó được giao. Bản đầu trả `artifacts: []` — tức là **nói dối rằng đĩa sạch**, rồi lần chạy sau ghi đè mà không ai biết.

Giờ: `stoppedReceipt` quét `brief.outputs`, liệt kê file **thật sự tồn tại**, và nói *"có N file đã ghi dở, xem lại trước khi dùng"*.

**Không xoá.** File dở vẫn có thể dùng được, và xoá thứ người dùng chưa kịp nhìn là quyết định của họ chứ không phải của ta.

*(Đỡ hơn ta tưởng: `CORE_PROMPT` đã dặn "ghi output trong MỘT lời gọi Write". Nên mớ dở thường là "2 trong 3 file", không phải "nửa file".)*

### Tầng 3 — hai việc độc lập: hàng đợi, một plan một lúc mỗi văn phòng

Trực giác "để command vào job queue rồi bỏ đi" (kiểu channel của goroutine) là đúng. Nhưng hàng đợi phải **nhìn thấy được**, không phải một mảng riêng tư — nên `office.activity` mang thêm `jobs`, và giao diện hiện *"1 việc xếp hàng"*.

**Vì sao KHÔNG chạy hai plan song song trong một văn phòng:**

1. **Trợ lý là một quản lý.** Hai plan chạy cùng lúc thì hai bản tổng kết đan vào nhau, và người dùng không biết câu báo cáo nào thuộc việc nào.
2. **Đụng file.** `Scheduler.validate` chặn hai task cùng ghi một đường dẫn — nhưng **chỉ trong cùng một plan**. Hai plan song song có thể ghi đè lẫn nhau và ta không phát hiện được.
3. **Ngân sách concurrency là của cả công ty.** Hai plan cạnh tranh nhau, và cái người dùng đang chờ có thể bị cái chạy nền bỏ đói.

**Muốn song song thì dùng NHIỀU VĂN PHÒNG** — đó chính là lý do văn phòng tồn tại.

> **Luật: song song GIỮA các văn phòng, tuần tự TRONG một văn phòng.**

### Tầng 3b — bàn giao khi tới lượt việc xếp hàng

Việc xếp hàng thường là phần tiếp của việc vừa xong (*"giọng trẻ hơn nữa"*). Không nói cho nó biết kết quả vừa rồi nằm ở đâu thì nó **viết lại từ đầu** thay vì sửa — đắt hơn nhiều và vứt luôn bản đã trả tiền.

Nên khi lôi việc ra khỏi hàng đợi, ghép thêm một câu **dựng bằng code, 0 token**:

```
(Việc trước vừa xong, kết quả đã có sẵn ở: artifacts/T-01/bai.md.
 Nếu yêu cầu này là chỉnh sửa cho việc đó thì SỬA file có sẵn, đừng làm lại từ đầu.)
```

Cùng một cơ chế với bàn giao sau khi ngắt (§3b), và cùng một lý do nó rẻ: Trợ lý vốn chỉ thấy **receipt**, nên "kết quả nằm ở đâu" là thông tin ta đã có sẵn trong tay.

---

## 12. Bí mật: `.env` là đường chính — đính chính §10e

§10e viết rằng bí mật "không bao giờ là văn bản tự do". **Nói quá tay.** `.env` **không phải** văn bản tự do — nó là định dạng theo dòng, có parser đã được kiểm nghiệm rộng rãi. Lập luận "phân tích sẽ hỏng" không áp dụng ở đây.

Nên có **hai đường vào, cùng một kho**:

| Đường | Cho ai |
|---|---|
| **Textarea `.env`** ⭐ | người dán từ README của MCP — tên biến đã đúng sẵn |
| **Form sinh sẵn** | người chọn từ danh mục (Notion, Google…) — không phải gõ tên biến nào |

### Luật đọc `.env` — phải làm đúng, đây là chỗ dễ sai

```
KEY=value            → "value"
KEY="value"          → "value"          nháy KÉP bị bóc, \n được nội suy
KEY='value'          → "value"          nháy ĐƠN bị bóc, KHÔNG nội suy
export KEY=value     → "value"          bỏ tiền tố export
KEY=value # ghi chú  → "value"          # ngoài nháy là comment
KEY="a # b"          → "a # b"          # trong nháy là ký tự thường
# cả dòng            → bỏ qua
(dòng trống)         → bỏ qua
```

**Không có chuẩn nào cấm dấu nháy.** Ngược lại: **bắt buộc phải có nháy** khi giá trị chứa khoảng trắng, `#`, hoặc xuống dòng — private key của Google là ví dụ kinh điển. Thói quen dùng `""` an toàn hơn.

Cái §10e nói đúng và vẫn giữ: **tên biến phải khớp chính xác**, và ta không suy ra được tên đó từ MCP (giao thức không công bố "tôi cần biến nào" — đó là yêu cầu lúc khởi động tiến trình, xảy ra trước khi bắt tay). Ba tầng giúp người non-code không phải gõ tên biến nào: danh mục curate sẵn → quét config dán vào tìm ô trống → chạy thử rồi đọc stderr.

---

## 9. Thứ tự làm

Xếp theo *mở khoá được bao nhiêu bài test* trên mỗi đơn vị công sức:

| # | Việc | Mở khoá | Cỡ |
|---|---|---|---|
| 1 | Tool hệ thống bật sẵn (§5) | bài 4, 9, 10A hết phải mở editor | **rất nhỏ** |
| 2 | Cạnh nối phản hồi ngay (§2) | cảm giác dùng | **rất nhỏ** |
| 3 | Kế hoạch vào chat (§3a) | chuẩn bị cho bridge | **rất nhỏ** |
| 4 | Sửa giới thiệu + skills trong UI (§1, §4) | bài 1, 2, 5, 8 | vừa |
| 5 | Dòng khả năng tự sinh (§1) | Trợ lý chia việc đúng người | nhỏ |
| 6 | Ngắt giữa chừng + lệnh chữ (§3b) | phản xạ Claude Code | vừa |
| 7 | Cổng duyệt hai tầng (§8) | **bài 10 chặng C**, và mọi việc chạm ra ngoài | lớn |
| 8 | Cắm MCP trong UI, đường A + B (§6) | bài 10 chặng B | vừa |
| 9 | Chìa theo connector (§7a) | đi kèm số 8 | nhỏ |
| 10 | Connector tự sinh, đường C (§6) | **đặc sản** — API riêng của người dùng | lớn |

Ba việc đầu cộng lại nhỏ hơn một buổi và xoá được phần lớn chữ ❌ trong `TEST-WALKTHROUGH.md`. Làm trước.

---

## Nguồn

API của SDK: đọc trực tiếp `node_modules/@anthropic-ai/claude-agent-sdk/{sdk,agentSdkTypes}.d.ts` phiên bản `0.3.231`.

Transport MCP: [Transports — Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) · [Claude Agent SDK — TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript)
