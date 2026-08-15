# SPEC — Công ty nhiều văn phòng, và Assistant là công dân hạng nhất

**Ngày:** 15/08/2026 · **Trạng thái:** Đợt 1 đang cài đặt

Thay thế mô hình "một công ty = một đội" của `SPEC-2026-08-14-agentco.md` §2. Đọc kèm `SPEC-canvas.md` (hình dạng) và `SPEC-token-economy.md` (luật cao hơn tất cả).

---

## 1. Vì sao đổi

v0 gộp hai khái niệm làm một: *công ty* vừa là đơn vị cấu hình, vừa là đơn vị làm việc. Hệ quả là mọi vai trò nằm chung một rổ, một Assistant phải biết hết mọi việc, và roster của nó phình theo số nhân viên — mà roster nằm trong prefix được cache của **mọi lượt trò chuyện**.

Tách ra thành **công ty → nhiều văn phòng** giải quyết đúng chỗ đó: mỗi văn phòng có Assistant riêng chỉ biết người của mình.

---

## 2. Bố cục thư mục

```
company/
├─ company.yaml            cấu hình chung: model tier, ngân sách, trần token
├─ logs/usage.jsonl        chi phí TOÀN CÔNG TY, mỗi dòng có cột office
├─ .state/                 daemon.json, secrets.json  ← cấp công ty
└─ offices/
   ├─ noi-dung/
   │  ├─ office.yaml       tên văn phòng + phần Assistant người dùng sửa được
   │  ├─ layout.json       hình dạng canvas (toạ độ + cạnh nối)
   │  ├─ roles/*.yaml      nhân viên
   │  ├─ skills/*.md       kỹ năng, gồm cả skills/assistant.md
   │  ├─ knowledge/
   │  │  ├─ shared/        Assistant ghi, cả văn phòng đọc
   │  │  └─ agents/<id>/   riêng từng người, gồm agents/assistant/
   │  ├─ artifacts/        kết quả công việc
   │  ├─ tasks/            plan + receipt
   │  └─ .state/           master-session.json, pending.json
   └─ ke-toan/             y hệt, độc lập hoàn toàn
```

### Văn phòng độc lập hoàn toàn — và vì sao không có kho tri thức cấp công ty

Đã cân nhắc và **bác bỏ** tầng `company/knowledge/shared/`. Hai lý do, cả hai đều là lý do kinh tế:

1. **Tri thức cấp công ty sẽ nằm trong prefix cache của MỌI worker ở MỌI văn phòng.** Thêm 10 node × 250 token = +2 500 token vào từng `cache_write`, nhân với số vai trò, nhân với số văn phòng. Nó phình lên là cả công ty đắt lên cùng lúc, và không ai thấy vì sao.
2. **Nó phá tính tự chứa.** Hôm nay `offices/<id>/` zip lại là một template chạy được ở máy khác. Có tầng cấp công ty thì copy một văn phòng đi nơi khác là mất ngữ cảnh — và "xuất template = copy thư mục" là tính năng gần như miễn phí duy nhất ta đang có.

Muốn dùng chung tri thức thì copy node sang, hoặc (M2) một lệnh `agentco knowledge copy`. Đắt hơn một lần, rẻ hơn mãi mãi.

**Văn phòng không giao việc cho nhau.** Đó chính là bài toán agent-to-agent mà kiến trúc cố tránh, không phải một mở rộng của canvas. Vẫn ở M3+.

---

## 3. Khởi điểm sạch

`agentco init` tạo **đúng** `company.yaml` và một thư mục `offices/` rỗng. Không vai trò mẫu, không văn phòng mẫu.

Giao diện lúc đó có **một nút duy nhất: "Tạo văn phòng"**. Đây là trạng thái rỗng được thiết kế, không phải màn hình lỗi — tiêu chí "Ổn định" đòi đúng điều này.

Lý do bỏ vai trò mẫu: người dùng đầu tiên của v0 mở lên thấy ba nhân viên lạ hoắc mà họ không đặt tên, không hiểu vì sao có, và không dám xoá. Thà bắt đầu từ số không rồi tự thêm từng người — mỗi người thêm vào là một quyết định họ hiểu.

Template mẫu vẫn còn giá trị, nhưng ở dạng **chọn khi tạo văn phòng**, không phải bị nhét sẵn.

---

## 4. Assistant — công dân hạng nhất của văn phòng

Mỗi văn phòng tạo ra sẽ có **đúng một Assistant, không xoá được**. Không có Assistant thì không ai chia việc.

### 4.1 Hai lớp prompt, ranh giới rõ ràng

| Lớp | Nội dung | Sửa? | Xem? |
|---|---|---|---|
| **Core** (mã nguồn) | giao thức nói chuyện với agent, giao thức Receipt, luật "giao việc đừng tự làm", cách với tới kho tri thức và tool | ❌ | ✅ **luôn xem được** |
| **Skills** (`skills/assistant.md`) | tính cách, giọng điệu, kiến thức ngành, thói quen, ưu tiên | ✅ | ✅ |

**Core xem được là bắt buộc, không phải tuỳ chọn.** Người dùng advanced cần *thấy* mới tin; giấu đi thì họ đoán, và đoán sai thì họ viết skills chống lại chính hệ thống.

Ranh giới đặt ở đâu: **thứ gì đang thi hành một bất biến trong `SPEC-token-economy.md` thì là core.** Nói cách khác, core là phần thuộc về *mã nguồn*, không thuộc về *việc vận hành doanh nghiệp`. Người dùng điều hành công ty của họ; họ không sửa giao thức mạng.

Có một cửa thoát: mở khoá sửa core được, sau một dialog cảnh báo, **mặc định tắt**. Ai bật là biết mình đang làm gì và tự chịu.

### 4.2 Assistant có skills ngoài — quyết định giữ

Đã cân nhắc bỏ hẳn skills của Assistant cho gọn. **Giữ**, vì đúng lý do bạn nêu: skills ngoài là chỗ người dùng biến công cụ thành thứ của riêng họ, và một trong hai nhóm khách đã chốt là người thích tự custom.

Bản mặc định ship kèm phải **rất ngắn** — vài dòng về giọng điệu và ngôn ngữ, không hơn. Nó nằm trong prefix cache của mọi lượt trò chuyện, nên mỗi dòng thừa là một khoản thuế thu suốt ca làm việc. Để trắng cũng là lựa chọn hợp lệ.

### 4.3 Assistant có sổ tay riêng, và ghi được kho chung

- **Sổ tay riêng** — `knowledge/agents/assistant/`. Cùng cơ chế với mọi agent khác, không sinh thêm máy móc gì. Đây là chỗ nó nhớ "văn phòng này hay yêu cầu kiểu X", "chia việc kiểu Y thì hỏng".
- **Kho chung** — `knowledge/shared/`. Assistant là bên **duy nhất** được ghi vào đây; worker chỉ ghi vào sổ tay của chính mình. Lý do: kho chung nằm trong prefix của cả văn phòng, cho ai cũng ghi được thì nó phình theo cấp số nhân và không ai chịu trách nhiệm.

Bài học của Assistant thu tại bước tổng kết đã có sẵn (`master.report()`), **không tốn thêm lượt gọi nào**.

### 4.4 MCP/API của Assistant thực chất là của worker ẩn

Giữ nguyên thiết kế `concierge`: Assistant thấy một tool `quick_action`, runtime bung một query one-shot phía sau. Master không bao giờ tự cầm MCP — nó resume liên tục, mà MCP phá prompt cache khi resume ([#247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247)), mất ~36 000 token quy đổi **mỗi lượt trò chuyện**.

Người dùng không cần biết cơ chế. Trên canvas, cắm MCP vào Assistant là một thao tác hợp lệ và mô tả "Assistant dùng được tool này" là **đúng**.

---

## 5. Worker — cũng hai lớp

Không có gì mới về cơ chế, chỉ là nói rõ ra và cho xem được:

| Lớp | Nội dung | Sửa? | Xem? |
|---|---|---|---|
| **Core** (mã nguồn) | giao thức Receipt, kỷ luật số lượt, luật ghi file thay vì dán nội dung, cách nhận tri thức | ❌ | ✅ |
| **Skills** (`skills/<role>.md`) | cách làm việc của vai trò này | ✅ | ✅ |
| **Sổ tay riêng** (`knowledge/agents/<role>/`) | agent tự ghi khi rút ra bài học. Mới tạo thì **trắng** | ✅ | ✅ |

### `secrets` — chìa khoá tool, cấp theo từng người

Vai trò khai **TÊN** chìa; giá trị nằm ở `company/.state/secrets.json` (gitignore, và `readArtifact` chặn mọi đường dẫn có segment bắt đầu bằng dấu chấm nên API không đọc ra được).

```yaml
# roles/inbox.yaml
mcp: [gmail]
secrets: [GMAIL_TOKEN]     # CHỈ chìa này được đưa vào môi trường tiến trình MCP
```

Ba tính chất, mỗi cái giải một vấn đề khác nhau:

| | |
|---|---|
| **Đặc quyền tối thiểu theo người** | nhân viên viết bài không cầm chìa vào cổng thanh toán, dù chung một văn phòng. Một agent bị prompt injection qua nội dung nó đọc chỉ cầm được đúng những chìa ta đã trao — cái giá của sai sót là hữu hạn. |
| **Giá trị KHÔNG vào prompt** | chìa là biến môi trường của tiến trình MCP. Model **dùng được tool**, nhưng **không đọc được khoá**. Đó là khác biệt giữa "agent có quyền" và "agent biết mật khẩu". |
| **Không có API** | `agentco secret set/list/rm` chỉ ở CLI. Bí mật không đi qua HTTP kể cả tới localhost — một endpoint đọc được chúng là một endpoint bị lừa gọi được. `set` nhận giá trị qua biến `VALUE`, không qua tham số dòng lệnh (tham số nằm trong lịch sử shell và danh sách tiến trình). |

**Trợ lý không có trường này.** Nó không tự cầm tool; việc cần tool đi qua worker ẩn, và worker đó là một vai trò có `secrets` riêng.

### Worker KHÔNG "mò vào" kho tri thức — điểm hay bị hiểu nhầm

Câu hỏi tự nhiên là: worker tự tìm trong kho, hay Assistant đọc hộ rồi giao? **Không bên nào**, và đó là chỗ kiến trúc này thắng cả hai phương án:

| | Ai làm | Giá |
|---|---|---|
| **HOT** — node hay dùng của vai trò | `KnowledgeStore.hot()` nhồi sẵn vào prefix được cache | ~0 khi cache ấm |
| **COLD** — node hợp với task này | `KnowledgeStore.cold()` chấm điểm từ khoá của brief | **0 token**, nằm sau cache breakpoint |

Cả hai đều chạy bằng **code, không gọi LLM**. Worker mở mắt ra là tri thức đã nằm sẵn trong prompt.

- Nếu worker tự tìm: mỗi lần tìm là một **lượt**, mà `chi phí ≈ số lượt × prefix × 0.1`. Đắt nhất trong ba phương án.
- Nếu Assistant đọc hộ rồi dán vào brief: nội dung đó nằm trong context Assistant **vĩnh viễn**, và đọc hai lần đúng như bạn lo.

→ Giữ nguyên. Đa văn phòng chỉ cần mỗi văn phòng một `KnowledgeStore` riêng.

---

## 6. Vòng đời công việc — Plan là đơn vị, không phải dòng chat

Log của v0 là một dòng chảy phẳng. Không đọc được khi hai việc chạy chồng nhau, và không trả lời được "việc hôm qua đã làm những gì".

### Luật phân biệt

Assistant định tuyến mỗi câu người dùng gõ thành một trong bốn:

| intent | nghĩa | hệ quả |
|---|---|---|
| `chat` | chào hỏi, hỏi về việc đã làm | trả lời, hết. **0 token worker** |
| `ask` | có vẻ là việc nhưng thiếu thông tin | hỏi lại một câu, chờ |
| `task` + `new` | việc mới, không liên quan việc đang chạy | **sinh Plan mới, độc lập** |
| `task` + `refine` | bổ sung/sửa cho việc vừa nói | **gắn vào Plan hiện tại** |

Phân biệt `new` với `refine` do Assistant quyết trên session của nó (nó có cả lịch sử hội thoại), không suy ra bằng heuristic ở client. Sai lệch về phía `new` — hai plan độc lập chỉ tốn thêm một lần lập kế hoạch, còn gắn nhầm vào plan cũ thì làm hỏng cả việc đang chạy.

### Mọi sự kiện đều mang `plan_id` và `office`

Đây là điều kiện để log đọc được, và cũng là điều kiện để UI đa văn phòng không hiển thị nhầm. Sự kiện không thuộc plan nào (`master.message` lúc chat) mang `plan_id: null` và về luồng hội thoại.

### Khoảng im lặng phải được lấp — và lấp bằng 0 token

Từ lúc người dùng bấm Gửi tới lúc Trợ lý trả lời là 5–15 giây. Không nói gì trong khoảng đó là chỗ người ta bấm Gửi lần thứ hai.

Nên có một trường `activity` chạy suốt: `đang đọc yêu cầu…` → `Trợ lý đang lập kế hoạch...` → `Người viết: đang viết bai_1.md` → hết. Mọi câu đều lấy từ `say` của sự kiện **đã có sẵn**; không lượt gọi LLM nào tồn tại chỉ để hiển thị — đó là ràng buộc chéo của bốn tiêu chí.

**Với Telegram (sau này):** làm được, và tối thiểu là đủ. `sendChatAction: 'typing'` làm chấm "…" của Telegram, làm mới mỗi ~4 giây trong lúc còn `activity`. Nếu muốn hơn thì gửi một tin rồi `editMessageText` mỗi khi `activity` đổi — vẫn 0 token, vì `say` đã có sẵn trong sự kiện.

### Bước không có task nào thì KHÔNG PHẢI một bước

Model rất hay viết một bước kiểu *"Lưu kết quả vào file"* rồi không giao task nào cho nó — vì việc đó đã nằm trong task trước. Bước như thế không ai tick được: nó đứng nguyên ở "chưa làm" kể cả khi mọi việc đã xong, và người dùng nhìn vào tưởng hệ thống bỏ sót.

Lọc bằng **code** lúc dựng kế hoạch (bỏ bước rỗng, đánh lại chỉ số), không bằng cách bắt model lập lại — rẻ hơn một lượt gọi và deterministic. Prompt cũng dặn thêm, nhưng dặn là gợi ý còn lọc là bảo đảm.

Kèm theo: một bước có **nhiều task** chỉ done khi **mọi task** của nó đã kết thúc — đếm theo task đã xong, đừng hỏi "bước này done chưa" (câu hỏi tự tham chiếu chính nó, và bước nhiều task sẽ kẹt mãi ở "đang làm").

### Câu báo cáo phát ĐÚNG MỘT LẦN

`master.message` mang câu báo cáo. `plan.finished` là sự kiện **cấu trúc** (trạng thái + tiền) và **cố ý không có `say`** — ngoại lệ duy nhất của bất biến "mọi sự kiện hướng người dùng phải có say", vì nó không hướng người dùng. `office.state` khi kết thúc chỉ nói trạng thái (`Xong việc.`), không lặp lại báo cáo.

Ba chỗ cùng mang một câu thì nhật ký hiện ba dòng y hệt nhau nằm cạnh nhau.

### Prompt mặc định không được chứa lời nhắn gửi NGƯỜI DÙNG

Bản đầu tiên của `skills/assistant.md` mở bằng *"Đây là phần BẠN viết, xoá sạch cũng được"* — một câu nói với người, nằm trong prompt gửi cho model, trong prefix cache của **mọi lượt trò chuyện**. Model không sửa được file, nên câu đó là nhiễu có phí thu mãi mãi.

Cùng lỗi ở charter mặc định. Giờ charter mặc định có frontmatter đầy đủ và **thân rỗng** → khối charter biến mất hẳn khỏi prompt. Lời giải thích "bạn sửa được cái này" nằm ở bảng prompt phân lớp trên giao diện, nơi người dùng thật sự đọc nó và nơi nó tốn 0 token.

Kèm theo: charter là một **node tri thức**, nên nó có YAML frontmatter. Đọc nguyên file là nhét ~40 token metadata (`id`, `type`, `confidence`…) vào prefix của mọi nhân viên. Chỉ lấy phần thân.

### Màu theo agent

Mỗi agent — **kể cả Assistant** — được gán một màu ổn định, băm từ id vai trò. Băm chứ không lưu: thêm/bớt người không làm đổi màu người khác, và không cần một file cấu hình nữa để lệch.

---

## 7. Di trú từ v0

Công ty v0 có `roles/` ngay dưới `company/`. Khi mở, daemon tự dời vào `offices/mac-dinh/` và giữ nguyên mọi thứ bên trong, **một lần, tự động, có in ra thông báo**.

Không hỏi người dùng. Đây là thay đổi hình dạng thư mục do ta gây ra, không phải quyết định của họ.

---

## 8. API

Mọi endpoint làm việc trên một văn phòng đều mang `officeId` trên đường dẫn. Endpoint cấp công ty thì không.

```
GET    /api/company                    tên, danh sách văn phòng, trạng thái từng cái
POST   /api/office                     { name, template? }  → tạo, kèm Assistant
DELETE /api/office/:id                 xoá (hỏi xác nhận ở UI)

GET    /api/office/:id                 trạng thái + plan đang chạy
GET    /api/office/:id/canvas          hình dạng + metadata để vẽ
PUT    /api/office/:id/canvas          ghi hình dạng
POST   /api/office/:id/agent           thêm nhân viên
DELETE /api/office/:id/agent/:role     bỏ khỏi sơ đồ (mặc định GIỮ file)
POST   /api/office/:id/say             cửa vào DUY NHẤT cho mọi thứ người dùng gõ
POST   /api/office/:id/stop
GET    /api/office/:id/knowledge       duyệt kho, 0 token
GET    /api/office/:id/plans           lịch sử công việc
GET    /api/office/:id/plans/:planId   log của đúng một công việc
GET    /api/office/:id/prompt/:who     prompt phân lớp — who = assistant | <role>

GET    /api/events                     SSE toàn công ty, mỗi sự kiện có office
GET    /api/cost                       chi phí, tách theo văn phòng
```

`GET /api/office/:id/prompt/:who` là hiện thân của "core xem được": trả về từng lớp kèm cờ `editable`, để UI hiện lớp core ở chế độ chỉ đọc chứ không giấu.

---

## 9. Giao diện — xem `SPEC-ui.md`

Chốt ngày 15/08: **React + Vite + Tailwind v4 + shadcn/ui**, daemon phục vụ `web/dist` tĩnh. Canvas vẫn là SVG viết tay, kéo node cập nhật bằng `ref` chứ không `setState` mỗi frame — tiêu chí "Hiệu năng" đòi 60fps kể cả lúc công ty đang chạy.

Chat, nhật ký, tổng quan chuyển hết vào sidebar trái đóng/mở được.

---

## 10. Ba đợt

| Đợt | Nội dung | Xong khi |
|---|---|---|
| **1 — nền** | `offices/`, di trú tự động, khởi điểm sạch, Assistant hai lớp prompt, vòng đời Plan, API mới | công ty chạy được đầu-cuối, UI cũ vẫn dùng tạm |
| **2 — giao diện** | React/Vite/Tailwind/shadcn, sidebar, canvas mới, log theo plan + màu, icon | thao tác được hết bằng giao diện mới |
| **3 — sản phẩm** | ranh giới lỗi, đường phục hồi, trạng thái rỗng, 60fps, log ảo hoá | bốn tiêu chí §1 thành checklist kiểm được |
