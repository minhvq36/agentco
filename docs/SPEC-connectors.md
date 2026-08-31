# SPEC — Connector: nhân viên biết dùng hệ thống của bạn

> ## Phụ lục: tìm kiếm trong kho tài liệu người dùng tải lên (chưa xây)
>
> Chốt hướng để lần sau không bàn lại từ đầu.
>
> **1. Khoá ngoại trước, tìm kiếm sau.** Câu hỏi thật của người dùng hiếm khi là *"file nào nói về X"* — thường là *"file này ở đâu ra, ai tạo, từ việc nào"*. Đó là một JSONL phẳng `file · plan_id · task_id · role · nguồn · thời điểm`, và ta **đã có gần đủ**: `receipt.landed` chính là mảnh đó. Cái mà trực giác gọi là "graph" ở đây thực ra là một **phép join**, không phải một graph engine.
>
> **2. `Glob` + `Grep` đi xa hơn tưởng.** Đã bật sẵn cho mọi nhân viên, chạy trên đĩa của chính người dùng, **0 chi phí thường trực**. Với vài nghìn file, grep thắng vector cả về tốc độ lẫn độ chính xác — và không bao giờ trả về thứ "gần giống mà sai".
>
> **3. Tầng tóm tắt đệm CÓ giá trị — nhưng để ĐỊNH TUYẾN, không để thay thế.** Trực giác "nén tóm tắt ở giữa" đúng một nửa: nó không thay được việc đọc file gốc (kiểu gì cũng phải lấy nội dung thật), nhưng nó trả lời rất tốt câu *"file nào đáng mở"*. Và thứ đó **đã tồn tại**: `knowledge/index.json` + node tri thức chính là tầng đó. Đừng xây tầng thứ hai — hãy để file tải lên sinh ra một node tóm tắt **trỏ về** file gốc.
>
> **4. Vector để cuối cùng, và chỉ khi ĐO ĐƯỢC là cần** — khi corpus lớn tới mức grep hết đủ. Lúc đó dùng embedding **chạy local**, không qua API, đúng như `store.ts` đã ghi từ đầu.
>
> **PDF/DOCX:** `Read` của Claude Code đọc được PDF; `.docx`/`.xlsx` thì không. Hướng đúng là **bóc thành text lúc NẠP VÀO**, không phải lúc đọc: một lần, tất định, và file text nằm cạnh file gốc nên `Grep` dùng được ngay. Bóc lúc đọc thì mỗi task trả tiền lại cho cùng một việc. ⚠ Chưa kiểm bằng file thật — thử trước khi hứa với khách.

> # 🔒 CHỐT 31/08 — **REST BỊ BỎ KHỎI v1.** Đọc khối này trước phần còn lại của file.
>
> User: *"tôi đang tính tới bỏ không làm REST nữa, ai muốn xây REST thì tự xây MCP trước"* · *"Chốt bỏ REST đó."*
>
> **§3–§6 của file này KHÔNG được thi hành trong v1.** Chúng vẫn đúng về thiết kế và được giữ nguyên
> để ngày mở lại không phải nghĩ lại từ đầu — nhưng hôm nay chúng ở **0% thi hành**, và ai đọc file
> này mà tưởng có mã đứng sau là đọc sai. Nhánh **CLI** (§2 Path B′) thì **đã xây**, xem `SPEC-arms §16`.
>
> ### Lý do — và vế "REST muôn màu" KHÔNG phải lý do
>
> Sự đa dạng của endpoint chính là thứ **tờ khai** sinh ra để nuốt: `SPEC-arms §16m` xếp REST connector
> và CLI-đã-khai vào **cùng một ô** trên trục ĐOÁN↔KHAI. Nếu "muôn màu" đủ để loại REST thì nó
> **loại luôn CLI** — ghi lý do đó vào đây là để lại một quả mìn cho người đọc sau.
>
> **Lý do thật là AUTH, và nó đo được:**
>
> | | Auth |
> |---|---|
> | **MCP** | có **giao thức khám phá**: `401` → `WWW-Authenticate` → `resource_metadata` → DCR → PKCE. Đó là lý do `oauth.ts` chạy **nguyên xi cho Notion và Linear, 0 dòng sửa** |
> | **REST** | **không có gì để dò.** Không DCR, không metadata, mỗi API một bông tuyết |
>
> ⇒ Chi phí của một connector REST tăng theo **SỐ KHÁCH**, không phải trả một lần. Đó là món **duy
> nhất** trong cả v1 có tính chất đó. Và §9 ① (*"OAuth2 refresh token — M2 hay bỏ hẳn?"*) đã treo
> không lời đáp từ 14/08 — nay nó là câu trả lời.
>
> ### "Đặc sản" chuyển chỗ, KHÔNG biến mất
>
> Đặc sản không phải REST. Nó là ***"người không biết code KHAI một năng lực, ta sinh MCP"*** — và
> **CLI là khách hàng đầu tiên của đúng câu đó**, đã chạy đầu-cuối 31/08.
>
> ### Google vẫn có đường — thứ bỏ là "khách tự khai REST", không phải "ta dùng REST"
>
> Một mục danh mục Google do **TA** viết (`src/core/arms/google.ts`, luật §4e-bis *một hãng một file*),
> runtime REST-over-`sdk` MCP, **không đi qua file này một dòng nào**, chi phí trả **một lần bởi ta**.
> Khác hẳn "connector REST" ở đúng chỗ quyết định: **ai trả tiền cho mỗi API mới**.
>
> ### ⚠ Bẫy sinh ra ngay lúc bỏ REST — phải chặn trước khi nó cắn
>
> Người dùng sẽ **bọc `curl` bằng cánh tay CLI**. `run:` là **argv, không qua shell** ⇒ `$TOKEN`
> **không nở** ⇒ họ buộc phải dán **chìa literal** vào argv ⇒ chìa nằm trong `company.yaml` · **đi vào
> băm** (xoay chìa = một cánh tay khác) · và **đọc được từ tiến trình khác trên cả ba OS**. Không
> triệu chứng nào. ⇒ Phải soi `curl`/`wget`/`Invoke-WebRequest` ở `run:` kèm câu chỉ đúng cửa.
>
> ### Điều kiện mở lại (đo được, đừng mở vì cảm giác)
>
> ① **Google Workspace được chốt vào danh mục theo đường REST của KHÁCH** (không phải mục ta viết);
> **hoặc** ② một khách thật mang API nội bộ tới mà **không có dev** — hôm nay ai có REST API riêng thì
> trong công ty đó có người viết ra cái API ấy, nên câu *"tự xây MCP trước"* đứng được.

**Đây là đặc sản của sản phẩm.** Người không biết code tự định nghĩa một nhân viên biết CRUD vào REST API / hệ thống của chính họ.
*(⚠ Câu trên viết 14/08 và **đã chuyển chỗ** — xem khối chốt 31/08 ngay trên: đặc sản nay là tờ khai,
mà khách hàng đầu tiên của nó là CLI.)*

Đọc kèm `SPEC-2026-08-14-agentco.md` và `SPEC-token-economy.md`.

---

## 1. Vì sao đây là chỗ khác biệt

Các công cụ orchestration hiện có (openclaw, goclaw…) nhắm dân code: muốn agent gọi API của bạn thì bạn **viết một MCP server**. Đó là rào chắn tuyệt đối với khách hàng của AgentCo.

Mệnh đề của chúng ta ngược lại:

> **Mô tả cái API, đừng viết code gọi nó.** Điền một form, bấm Test, xong — nhân viên của bạn biết dùng hệ thống của bạn.

Đây cũng là chỗ **chi phí chuyển đổi** hình thành: khi khách đã cắm hệ thống hoá đơn / CMS / CRM của họ vào và đội agent đã quen dùng, họ không đi đâu nữa.

---

## 2. Hai đường vào, khác đối tượng

| | Path A — MCP | Path B — REST connector |
|---|---|---|
| Dành cho | ai đã có sẵn MCP server (Notion, Slack, Postgres…) | **ai có API riêng và không biết code** |
| Người dùng làm gì | dán config, bấm Test | điền form / dán cURL / dán link OpenAPI |
| Ta phải làm gì | UI dán config + kiểm tra kết nối | **toàn bộ mục 3–6 dưới đây** |
| Độ khác biệt | không (ai cũng làm được) | **đây là đặc sản** |

Path A làm trước vì rẻ. Path B là thứ đáng bán.

> ### 🆕 30/08 — CÓ **ĐƯỜNG THỨ BA**, và nó dùng chung khai báo với Path B
>
> **Path B′ — bọc một LỆNH CLI.** Cùng file `connectors/<id>.yaml`, khác đúng một trường: `run:`
> (một mảng **argv**) thay cho `method`/`path`. Mọi thứ còn lại dùng lại nguyên — một action = một
> tool · `confirm` mặc định bật cho việc ghi · `say` tiếng người · `returns` sinh từ lượt Thử ·
> chìa chỉ là tên biến · log vào `audit.ts`.
>
> Lý do nó thuộc về file này chứ không phải một spec mới: **cùng một bài toán** — *người không biết
> code mô tả một năng lực, ta sinh MCP*. Chỉ khác nguồn năng lực là một endpoint HTTP hay một binary
> trên máy.
>
> **Thiết kế đầy đủ + 3 ô chưa chốt: `SPEC-arms.md §16`. Bài đo: `TEST-WALKTHROUGH.md` bài 21 (REST)
> · bài 22 (CLI).**
>
> ⚠ Và một trạng thái phải nói thẳng: grep 30/08 — **`createSdkMcpServer` không xuất hiện một lần
> nào trong `src/`**. Toàn bộ §3–§6 của file này (viết 14/08) đang ở **0% thi hành**.

---

## 3. Định dạng connector

```yaml
# company/connectors/invoices.yaml
id: invoices
display_name: "Hệ thống hoá đơn"
description: "API hoá đơn nội bộ của công ty"

base_url: https://api.congty-cua-toi.com/v1

auth:
  type: bearer                    # none | bearer | header | basic
  token_env: INVOICES_TOKEN       # ⚠ CHỈ tên biến môi trường, KHÔNG BAO GIỜ giá trị

actions:
  - id: list_invoices
    say: "xem danh sách hoá đơn"        # hiển thị lên UI, tiếng người
    method: GET
    path: /invoices
    query:
      - { name: status, type: string, enum: [draft, sent, paid] }
      - { name: limit,  type: integer, default: 20, max: 100 }
    returns: "Mảng hoá đơn: id, khách hàng, số tiền, trạng thái, ngày tạo"

  - id: create_invoice
    say: "tạo hoá đơn mới"
    method: POST
    path: /invoices
    body:
      - { name: customer, type: string, required: true }
      - { name: amount,   type: number, required: true }
      - { name: note,     type: string }
    returns: "Hoá đơn vừa tạo, có id"
    confirm: true                        # ← ghi dữ liệu thì mặc định BẮT BUỘC

  - id: delete_invoice
    say: "xoá hoá đơn"
    method: DELETE
    path: /invoices/{id}
    params:
      - { name: id, type: string, required: true }
    confirm: true
    danger: true                         # ← thêm một lớp xác nhận nữa
```

### Bốn luật thiết kế, mỗi luật có lý do cụ thể

**a) Mỗi action là MỘT tool riêng. Không có tool `http_request` vạn năng.**

Tool vạn năng buộc agent tự bịa URL, tự đoán tham số, tự đoán định dạng body → sai nhiều, không kiểm soát được, và **không tự sinh được bước xác nhận** (vì ta không biết nó sắp làm gì). Action tường minh thì schema chặt, agent chỉ điền tham số vào chỗ trống.

**b) Ghi dữ liệu thì mặc định `confirm: true`.**

`POST` / `PUT` / `PATCH` / `DELETE` tự động bật `confirm` khi tạo connector. Người dùng non-code sẽ giao *"dọn dẹp hoá đơn cũ giùm"* và agent sẽ **xoá thật**. Không được để chuyện đó xảy ra âm thầm. Tắt được, nhưng phải tắt có ý thức.

**c) Token chỉ ghi TÊN BIẾN, không ghi giá trị.**

⚠ **Lý do cũ SAI, đã sửa 31/08.** Câu *"vì `company/` được thiết kế để commit lên git"* không đúng với
repo này — `.gitignore` **có `/company/`**, chỉ `templates/company/` được commit. User bác đúng:
*"token vào company.yaml là bình thường… y hệt một cái `.env`. Không lưu vào state/storage trình duyệt
thôi."*

**Luật đúng, hẹp hơn hẳn:** *giá trị chìa không được RỜI MÁY CHỦ* — không qua HTTP, không vào trình
duyệt, không vào prompt. Nằm ở đâu **trên đĩa của khách** là chuyện của khách. Và hai lý do cơ chế
(đọc được trong mã, không phải kể chuyện):

1. `company.ts §arms()` trả **nguyên `config`** qua HTTP tới trình duyệt — trong khi `types.ts` tự khai
   bất biến ngược lại ở trường bên cạnh (*"TÊN chìa, không bao giờ giá trị"*); cả hai chỗ canh trường
   `secrets`, **không canh trường `config`**.
2. `config` **đi vào băm** (`catalog.ts §armHash`) ⇒ xoay chìa = **một cánh tay KHÁC** ⇒ mọi `role.mcp`
   vẫn trỏ băm cũ, và cánh tay chìa-đã-chết còn nguyên ✓ trên sơ đồ.

> 🔴 Lớp lỗi của lần viết sai: tôi có **hai** lý do cơ chế nằm sẵn trong mã và đi mượn một lý do **thứ
> ba, dễ kể hơn, và sai**. Lý do dễ kể thắng lý do đúng vì nó không cần đọc mã — và nó dẫn bản vá đi
> sai chỗ (giấu yaml, thay vì chặn `config` ra HTTP + tách chìa khỏi băm).
> → [[agentco-easy-reason-beats-true-reason]]

UI phải từ chối lưu nếu phát hiện chuỗi trông giống token. ⚠ Grep 30/08: chỗ **thi hành** luật này tồn
tại ở **đúng một nơi** (`oauth-routes.ts`, ô `client_id` của GitHub) — đường dán MCP **chưa có phép soi
nào**.

**d) Chặn host ngoài `base_url`.**

Agent đọc nội dung web rồi bị dắt gọi vào endpoint nội bộ là kịch bản thật. Runtime chỉ cho gọi host của `base_url`. Muốn gọi `localhost` / IP nội bộ phải bật `allow_private_network: true` một cách tường minh, kèm cảnh báo trên UI.

---

## 4. Người non-code điền cái này bằng cách nào

Ba đường nhập, xếp theo công sức của người dùng:

| Đường | Người dùng làm gì | Ta làm gì |
|---|---|---|
| **Dán OpenAPI / Swagger** | dán URL hoặc file | parse → sinh sẵn toàn bộ actions → họ tick chọn cái cần |
| **Dán cURL** | copy từ Postman / DevTools / tài liệu API | parse method, URL, header, body → ra một action |
| **Điền form** | điền tay từng ô | validate, gợi ý |

**Nút `Test` là bắt buộc, không phải tuỳ chọn.** Bấm Test → gọi thật → hiện response thô + bản diễn giải tiếng người. Người non-code không có cách nào khác để biết mình điền đúng chưa. Không có nút này thì cả tính năng vô dụng.

Sau khi Test thành công, hệ thống **tự đề xuất** `returns` bằng cách đọc response mẫu — người dùng sửa lại nếu muốn.

---

## 5. Gán cho ai — và cái giá bằng token

Connector **không nạp cho cả công ty**. Gán theo role:

```yaml
# roles/accountant.yaml
connectors: [invoices, banking]
```

Lý do là kinh tế, không phải phân quyền. **Mỗi action là một tool definition nằm trong prefix của role.** `SPEC-token-economy.md` §2 đã đo: sàn tool definition đã ~13 200 token; mỗi connector cộng thêm vào đó.

Ràng buộc bắt buộc:

| Hạng mục | Trần | Kiểu |
|---|---|---|
| ~~Tổng token connector / role~~ | ~~**2 000** cứng~~ | 🔴 **ĐÃ BỎ 23/08** — xem khối dưới |
| Số action / connector | 20 | mềm — cảnh báo |
| Mô tả một action | 120 token | cứng |

> ### 🔴 TRẦN 2 000 ĐÃ BỎ — số đo giết nó, user chốt 23/08
>
> Con số 2 000 viết ngày 14/08, **khi chưa ai đo một cánh tay nào**. Đo 23/08
> (`scripts/spike-mcp.ts`, `SPEC-arms.md` §9b): **một** MCP `filesystem` 14 tool tốn
> **2 185 token/lượt**. ⇒ trần đó **chặn ngay cánh tay ĐẦU TIÊN**, trước khi người dùng cắm được
> thứ gì.
>
> **Thay bằng: HIỆN GIÁ, không chặn.**
>
> ```
> 🔌 File trên máy      ● hoạt động · 14 việc · ~2 200 token mỗi lượt
> ```
>
> **Ba lý do, và lý do thứ ba là lý do chốt:**
>
> 1. **Trần cứng ở đây chặn đúng thứ người dùng CỐ Ý muốn.** Họ vừa đi qua ba bước để cắm nó.
> 2. **Con số thì họ chưa bao giờ được thấy.** Chặn một thứ vô hình rồi báo *"vượt trần"* là câu
>    lỗi không có đường đi tiếp — đúng lớp lỗi *"nới `max_usd` trong `roles/…yaml`"* (§5m ②): không
>    nói dối, nhưng **chỉ sai cửa**.
> 3. **Tiền là của khách.** Nghĩa vụ của ta là làm lựa chọn đó **sáng mắt thay vì mù**, không phải
>    quyết hộ. Cùng luật đã chốt cho `model_tier` (`SESSIONS_MEMORY` §5l ④): *không dùng số này để
>    agentco tự nâng/hạ — đó là quyết định của khách*.
>
> ⚠ **"Bỏ trần" KHÔNG có nghĩa "thôi đo".** Số phải hiện ở **ba chỗ**, và thiếu chỗ nào là quay lại
> đúng cái vô hình vừa bỏ: trên **thẻ danh mục** lúc chọn · trên **node** trên sơ đồ · trong **bảng
> chi tiết** của nhân viên được nối vào (cộng dồn cả các cánh tay của người đó).
>
> Nguồn của số: `getContextUsage().mcpTools` — nó phân rã tới từng tool. ⚠ **Không** dùng số của
> hoá đơn ở đây: hai nguồn lệch 27% và **không đo cùng một thứ** (`SPEC-arms.md` §9b ③).

**Tin tốt:** connector nằm trong **static prefix** nên được cache. Trả một lần cache write, sau đó gần như miễn phí. Nhưng vì thế:

> **Sửa connector = bump cache key của mọi role dùng nó.** UI connector **không autosave**, phải có nút Lưu tường minh — cùng kỷ luật với ô soạn skills (`SPEC-ui.md` §2.2).

`concierge` nhận các action đánh dấu `quick: true` — việc vặt một phát ăn ngay.

---

## 6. Giao diện

Ngăn **Kết nối** (ngang hàng với Đội ngũ / Tri thức):

```
┌─ KẾT NỐI ────────────────────────────────────────────┐
│                                                      │
│  🧾 Hệ thống hoá đơn        ● hoạt động   6 việc     │
│     api.congty-cua-toi.com          dùng bởi: Kế toán│
│                                                      │
│  📝 Notion (MCP)            ● hoạt động   4 việc     │
│                                     dùng bởi: Viết   │
│                                                      │
│  🏦 Ngân hàng               ⚠ token hết hạn          │
│                                     [Sửa]            │
│                                                      │
│  + Thêm kết nối                                      │
└──────────────────────────────────────────────────────┘
```

Luồng thêm mới: `Dán OpenAPI` / `Dán cURL` / `Điền tay` → chọn actions → **Test** → gán cho nhân viên nào → Lưu.

Mỗi action hiện dưới dạng câu tiếng người (`say`), không hiện method/path — trừ khi mở Nâng cao.

**Bước xác nhận khi ghi dữ liệu** hiện ngay trong luồng chat, không phải dialog trình duyệt:

```
⏸ Kế toán muốn tạo hoá đơn mới
   Khách: Công ty ABC · Số tiền: 12.000.000đ
   [Đồng ý]  [Sửa]  [Bỏ qua]
```

---

## 7. Bảo mật — bắt buộc

- Token chỉ ở env / `.state/secrets.json`, **không bao giờ** trong `company/` phần commit được
- Token **không bao giờ** vào prompt. Runtime tự chèn lúc gọi HTTP, agent không nhìn thấy.
- Chặn host ngoài `base_url`; private network phải bật tường minh
- Mọi lời gọi ghi dữ liệu vào `logs/` — ai, task nào, tham số gì, kết quả gì. Đây cũng là nền của tính năng **nhật ký kiểm toán** cho khách doanh nghiệp.
- Response bị cắt trần trước khi vào context agent (mặc định 4 000 token), tránh một endpoint trả 2MB JSON làm nổ ngân sách

---

## 8. Lộ trình

| Giai đoạn | Nội dung |
|---|---|
**Viết lại 31/08 theo chốt bỏ REST.**

| Giai đoạn | Nội dung |
|---|---|
| **v1** | Path A (dán MCP config + Test) ✅ đã xây · **Path B′ CLI** ✅ đã xây → `SPEC-arms §16` · `confirm` từng action · gán theo role |
| ~~M1/M2 REST~~ | 🔒 **BỎ** — xem khối chốt đầu file. Form tay · dán cURL · dán OpenAPI · tầng `auth:` · chặn host · phân trang: **không làm** |
| v1.x | Chặn `curl`/`wget`/`Invoke-WebRequest` ở `run:` (bẫy sinh ra từ chính chốt này) · mục danh mục Google chạy REST **do TA viết**, không qua file này |
| sau | Mở lại REST **chỉ khi** một trong hai điều kiện ở khối chốt thành hiện thực |

---

## 9. Câu chưa trả lời

1. Auth OAuth2 (refresh token) — nhiều SaaS bắt buộc. Phức tạp hơn hẳn bearer tĩnh. **M2 hay bỏ hẳn?**
2. Endpoint phân trang — để agent tự lặp, hay runtime gom giùm? (Để agent lặp thì tốn lượt; runtime gom thì phải đoán quy ước phân trang.)
3. Response lớn: cắt cứng, hay lưu ra file rồi đưa agent đường dẫn? *(Nghiêng phương án 2 — đúng nguyên tắc "sở hữu artifact".)*
