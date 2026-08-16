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

**Đây là đặc sản của sản phẩm.** Người không biết code tự định nghĩa một nhân viên biết CRUD vào REST API / hệ thống của chính họ.

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

**c) Token không bao giờ nằm trong yaml.**

`company/` được thiết kế để commit lên git. Chỉ ghi **tên biến môi trường**; giá trị nằm ở env hoặc `company/.state/secrets.json` (đã có trong `.gitignore`). UI phải từ chối lưu nếu phát hiện chuỗi trông giống token.

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
| Tổng token connector / role | **2 000** | cứng — từ chối gán thêm |
| Số action / connector | 20 | mềm — cảnh báo |
| Mô tả một action | 120 token | cứng |

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
| Tuần 1 | **không làm gì** — chưa có gì để CRUD vào |
| **M1** | Path A (dán MCP config + Test) · Path B bản form tay + nút Test · confirm khi ghi · gán theo role |
| **M2** | Dán cURL · dán OpenAPI/Swagger · quản lý token trong UI · `quick: true` cho concierge |
| M3 | Thư viện connector dựng sẵn theo ngành · chia sẻ connector giữa người dùng |

---

## 9. Câu chưa trả lời

1. Auth OAuth2 (refresh token) — nhiều SaaS bắt buộc. Phức tạp hơn hẳn bearer tĩnh. **M2 hay bỏ hẳn?**
2. Endpoint phân trang — để agent tự lặp, hay runtime gom giùm? (Để agent lặp thì tốn lượt; runtime gom thì phải đoán quy ước phân trang.)
3. Response lớn: cắt cứng, hay lưu ra file rồi đưa agent đường dẫn? *(Nghiêng phương án 2 — đúng nguyên tắc "sở hữu artifact".)*
