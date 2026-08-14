# SPEC — Canvas: văn phòng dạng node

**Trạng thái:** thiết kế, chưa code. Thay thế UI dạng danh sách hiện tại (`SPEC-ui.md` §2).

Đọc kèm `SPEC-2026-08-14-agentco.md` và `SPEC-token-economy.md`.

---

## 1. Vì sao đổi sang canvas

UI hiện tại (danh sách đội ngũ + kế hoạch + log) chạy được nhưng **giấu mất kiến trúc**. Người dùng không thấy công ty của họ có hình dạng gì, không sửa được hình dạng đó, và không mang đi được.

Canvas dạng node (kiểu n8n) giải quyết ba thứ cùng lúc:

1. **Ràng buộc kiến trúc trở thành nhìn thấy được và bất khả xâm phạm.** Mô hình sao không còn là một dòng trong spec — nó là thứ bạn *không vẽ được* trên canvas.
2. **Cấu trúc phòng ban thành thứ mang đi được** — lưu, chia sẻ, làm template.
3. **Xem công ty làm việc theo thời gian thực** — node sáng lên, dây nhấp nháy. Đây là thứ quay video được.

---

## 2. Nguồn sự thật: JSON cho HÌNH DẠNG, không cho NỘI DUNG

> **Đây là quyết định quan trọng nhất trong file này. Làm sai là hỏng kiến trúc chi phí.**

```
company/
├─ layout.json          ← MÁY sở hữu. Vị trí node + cạnh nối. Đổi mỗi lần kéo chuột.
├─ company.yaml         ← NGƯỜI sở hữu. Cấu hình.
├─ roles/*.yaml         ← NGƯỜI sở hữu. Định nghĩa nhân viên. ĐI VÀO cacheKey.
├─ skills/*.md          ← NGƯỜI sở hữu.
└─ knowledge/**.md      ← cả hai cùng ghi.
```

**Vì sao không nhét tất cả vào một file JSON như n8n:**

- `cacheKey` băm **nội dung role**. Nếu toạ độ node nằm chung file với định nghĩa role thì **mỗi cú kéo chuột là một lần vứt cache** của agent đó — trả lại ~20K cache_write cho một thao tác không đổi gì về ngữ nghĩa. Tách file ra thì lỗi này **không thể xảy ra**, không cần kỷ luật gì.
- Yaml/markdown **sửa tay được**, **git diff đọc được**, mở bằng editor nào cũng được. Một cục JSON thì mất hết — mà "advanced user tự custom" là một trong hai nhóm khách đã chốt.
- `roles/*.yaml` cố ý mượn hình dạng `AgentDefinition` của Claude Agent SDK. Đổi sang JSON tự chế là vứt lợi thế đó.

`layout.json` là **view state thuần**. Xoá nó đi thì công ty vẫn chạy y nguyên, chỉ mất bố cục (canvas tự sắp lại). Đó là phép thử để biết ranh giới đã đặt đúng.

### Hình dạng `layout.json`

```json
{
  "version": 1,
  "nodes": [
    { "id": "master",  "kind": "master",    "x": 480, "y": 60 },
    { "id": "writer",  "kind": "agent",     "x": 240, "y": 280, "role": "writer" },
    { "id": "reviewer","kind": "agent",     "x": 720, "y": 280, "role": "reviewer" },
    { "id": "kb",      "kind": "knowledge", "x": 480, "y": 480 },
    { "id": "mcp_notion", "kind": "mcp",    "x": 900, "y": 180, "server": "notion" }
  ],
  "edges": [
    { "from": "master", "to": "writer" },
    { "from": "master", "to": "reviewer" },
    { "from": "mcp_notion", "to": "reviewer" }
  ]
}
```

Node `role` trỏ tới file trong `roles/`. Thiếu file → node hiện đỏ "không tìm thấy vai trò". Có file mà thiếu node → canvas tự thêm node ở chỗ trống (tự phục hồi khi người dùng thả file yaml vào tay).

---

## 3. Cạnh nối phải CÓ NGHĨA

Nếu master luôn nối tới mọi agent thì cạnh nối chỉ là trang trí. Cho nó nghĩa thật:

> **Cạnh `master → agent` = "master được phép giao việc cho người này".**

Và nó **điều khiển trực tiếp chi phí**: chỉ agent có nối mới được đưa `pitch` vào ngữ cảnh của master (`master.ts` → `roster()`). Ngắt dây = agent vẫn còn đó, vẫn giữ sổ tay kinh nghiệm riêng, nhưng master không thấy nữa.

→ **Kéo một sợi dây là một hành động có hậu quả đo được.** Đây là thứ khiến canvas hơn hẳn một danh sách có checkbox.

Trên node agent bị ngắt: làm mờ, ghi "đang nghỉ".

---

## 4. Bốn loại node

| Loại | Số lượng | Xoá được? | Nối ra được? | Nhận nối từ |
|---|---|---|---|---|
| **master** | đúng 1, tự có khi tạo | ❌ | → agent | mcp |
| **agent** | 0..n | ✅ | ❌ **không gì cả** | master, mcp |
| **knowledge** | đúng 1, tự có | ❌ | không có dây | không có dây |
| **mcp** | 0..n | ✅ | → master, → agent | — |

### master

Không xoá được: không có master thì không ai lập kế hoạch. Hiện: tier model, session hiện tại, số token ngữ cảnh (`23K / 60K`).

### agent — KHÔNG được nối sang agent khác

Canvas phải làm cho việc này **bất khả thi về mặt vật lý**, không phải báo lỗi sau khi vẽ xong. Kéo từ agent ra thì không có cổng ra nào để bám vào.

Lý do là kinh tế, không phải thẩm mỹ: agent nói chuyện trực tiếp với nhau là **nguồn đốt token lớn nhất** trong mọi hệ multi-agent và không kiểm soát được. Mọi trao đổi đi qua master hoặc qua artifact.

Trên node agent hiện: avatar, tên, tier, và **`📒 n`** = số ghi chú trong sổ tay riêng của nó.

### knowledge — không có dây, cố ý

Kho chung ở giữa canvas. **Không vẽ dây tới ai cả** — nó là môi trường, không phải quan hệ. Ai cũng tới được, giống cái kệ tài liệu giữa văn phòng.

Nhưng phải thể hiện được **hai loại tri thức** mà hệ thống đã có:

- **node knowledge ở giữa** = `knowledge/shared/` — master ghi, cả công ty đọc
- **`📒 n` trên từng node agent** = `knowledge/agents/<role>/` — chính agent đó ghi khi làm sai hoặc tìm ra cách đúng, **chỉ nó đọc**

Click node knowledge → mở ngăn kéo tri thức (đã có ở `SPEC-ui.md` §4).

### mcp

Nối vào **agent** → agent đó được dùng MCP đó.

Nối vào **master** → thực chất gắn cho `concierge` (worker one-shot chạy ngầm), **không** gắn thẳng vào session master. Master resume liên tục, mà MCP phá prompt cache khi resume ([#247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247)) → mất ~36 000 token quy đổi **mỗi lượt trò chuyện**.

Từ góc nhìn người dùng, "master dùng được tool này" là **đúng** — nên không cần giải thích cơ chế trên UI. Chỉ cần một dòng tooltip: *"việc vặt master tự xử lý"*.

---

## 5. Canvas cũng là màn hình chạy

Đây là chỗ canvas thắng hẳn danh sách. Khi công ty làm việc:

- **Node agent sáng lên** khi nó nhận task, kèm câu `say` ngay dưới tên (*"đang đọc gioi_thieu.md"*)
- **Dây master→agent nhấp nháy** trong lúc task chạy
- **Node xám lại** khi xong, hiện dấu ✓ thoáng qua
- Node lỗi → viền đỏ + câu `say` giải thích

Không cần sự kiện SSE mới — dùng đúng bộ đã có (`task.started` / `task.progress` / `task.done` / `task.blocked`), chỉ đổi chỗ hiển thị.

**Thanh dưới giữ nguyên những gì UI hiện tại đang làm tốt:** các bước kế hoạch, ô chat với giám đốc, chi phí, ngăn kéo nhật ký. Không mất gì.

---

## 6. Template và chia sẻ — đã có sẵn, chỉ cần lộ ra

`company/` **vốn đã** là một phòng ban tự chứa đầy đủ. Nghĩa là ba tính năng này gần như không tốn gì để làm:

| Việc | Cách làm |
|---|---|
| Lưu cấu trúc | chính là thư mục đó, không cần làm gì |
| Template | `agentco init --template <tên>` = copy thư mục |
| Chia sẻ / reverse | gửi thư mục, hoặc push lên git |

Cái duy nhất phải cẩn thận khi xuất template: **không mang theo `.state/`** (session, secrets) và **không mang theo `artifacts/`** (kết quả cụ thể của người khác). Mang theo: `company.yaml`, `layout.json`, `roles/`, `skills/`, `knowledge/shared/`.

Có mang theo `knowledge/agents/` không? **Có, nên mang** — đó chính là phần "kinh nghiệm đã tôi luyện" khiến một template đáng giá hơn một thư mục rỗng, và là chỗ chi phí chuyển đổi hình thành.

---

## 7. Kỹ thuật

- **SVG + vanilla JS**, không thư viện canvas. Giữ ràng buộc "không build step" của `SPEC-ui.md` §5. Ước chừng 400–600 dòng.
- Kéo node: cập nhật toạ độ trong bộ nhớ, **debounce ~800ms** rồi mới `PUT /api/layout`. Đừng ghi mỗi frame.
- Dây: đường Bézier từ cổng dưới của node nguồn tới cổng trên node đích.
- Tự sắp xếp lần đầu: master trên cùng, agent dàn hàng ngang bên dưới, knowledge ở giữa dưới cùng.
- Canvas **không tự sinh** thứ gì ngoài `layout.json`. Thêm agent trên canvas → ghi `roles/<id>.yaml` từ template; xoá agent → hỏi có xoá luôn file yaml không (mặc định **giữ lại**, chỉ bỏ khỏi layout).

### API mới

```
GET  /api/layout          → layout.json (tự sinh nếu chưa có)
PUT  /api/layout          → ghi đè (debounced từ client)
POST /api/agent           → { template } tạo roles/<id>.yaml + node mới
DELETE /api/agent/:id     → { keepFile?: boolean }
```

---

## 8. Ngoài phạm vi

- **Liên phòng ban** (master nói chuyện với master). Đây là quay lại đúng bài toán agent-to-agent mà kiến trúc cố tránh — cần thiết kế riêng, không phải mở rộng canvas. Ghi vào roadmap M3+.
- Nhiều master trong một công ty
- Vẽ nhân vật / hoạt hoạ nhân vật — **cố ý không làm**. Node là đủ, và rẻ hơn nhiều.
- Sửa nội dung tri thức bằng kéo thả node
