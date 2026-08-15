# SPEC — Canvas: văn phòng dạng node

**Trạng thái: ĐÃ CÀI ĐẶT.** Thay thế UI dạng danh sách cũ (`SPEC-ui.md` §2).

| Phần | Ở đâu |
|---|---|
| Đọc/ghi/kiểm tra hình dạng | `src/core/layout.ts` |
| Thao tác văn phòng (thêm/bớt người, nạp lại) | `src/core/office.ts` |
| Roster theo cạnh nối | `src/core/assistant.ts` → `setAssignable()` |
| Canvas SVG | `src/server/ui.ts` |
| API | `src/server/server.ts` |

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
├─ office.yaml          ← NGƯỜI sở hữu. Tên VP + phần Trợ lý sửa được.
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
    { "id": "assistant", "kind": "assistant", "x": 480, "y": 60 },
    { "id": "writer",  "kind": "agent",     "x": 240, "y": 280, "role": "writer" },
    { "id": "reviewer","kind": "agent",     "x": 720, "y": 280, "role": "reviewer" },
    { "id": "kb",      "kind": "knowledge", "x": 480, "y": 480 },
    { "id": "mcp_notion", "kind": "mcp",    "x": 900, "y": 180, "server": "notion" }
  ],
  "edges": [
    { "from": "assistant", "to": "agent:writer" },
    { "from": "assistant", "to": "agent:reviewer" },
    { "from": "mcp:notion", "to": "assistant" }
  ]
}
```

Node `role` trỏ tới file trong `roles/`. Thiếu file → node hiện đỏ "không tìm thấy vai trò". Có file mà thiếu node → canvas tự thêm node ở chỗ trống (tự phục hồi khi người dùng thả file yaml vào tay).

### Sửa lúc cài đặt: cạnh `mcp → agent` KHÔNG nằm trong layout.json

Bản thiết kế ban đầu để nó ở đây. Sai — vì chính lập luận của §2: "agent này dùng được tool nào" là **NỘI DUNG**, không phải hình dạng. Nó đã có nhà rồi: `mcp:` trong `roles/<id>.yaml`.

Để ở cả hai nơi = hai nguồn sự thật = sớm muộn cũng lệch. Nên:

- **đọc**: `GET /api/office/:id/canvas` dựng lại cạnh `mcp→agent` từ `roles/*.yaml` để canvas vẽ đúng
- **ghi**: kéo/ngắt dây đó ghi thẳng vào `roles/<id>.yaml` (dùng `parseDocument` để **giữ nguyên chú thích** người dùng viết; diff đúng hai dòng)
- `writeRaw()` là chốt chặn duy nhất ghi ra đĩa và nó **lọc bỏ** loại cạnh này, nên không có đường nào để nó lọt vào layout.json dù caller quên

Cạnh `mcp → assistant` thì vẫn ở office.yaml (`assistant.mcp`) — cùng lý do — vì chưa có `concierge`, nó chưa tương ứng với nội dung nào cả.

### Sửa lúc cài đặt: `tools`/`mcp` phải đi vào `cacheKey`

Phát sinh trực tiếp từ việc cho cắm MCP bằng chuột. Định nghĩa tool **không** nằm trong systemPrompt, nhưng nó đứng **trước** system prompt trong prefix mà Anthropic đánh cache → đổi tool là đổi prefix.

Đây đúng là con bug đã sửa cho `model` ở phiên trước: thiếu nó thì cache priming gate tưởng cache ấm trong khi chưa, rồi ta trả `cache_write` mà cứ nghĩ đang tiết kiệm. Đã thêm vào `prompt.ts`.

---

## 3. Cạnh nối phải CÓ NGHĨA

Nếu Trợ lý luôn nối tới mọi agent thì cạnh nối chỉ là trang trí. Cho nó nghĩa thật:

> **Cạnh `assistant → agent` = "Trợ lý được phép giao việc cho người này".**

Và nó **điều khiển trực tiếp chi phí**: chỉ agent có nối mới được đưa `pitch` vào ngữ cảnh của Trợ lý (`assistant.ts` → `roster()`). Ngắt dây = agent vẫn còn đó, vẫn giữ sổ tay kinh nghiệm riêng, nhưng Trợ lý không thấy nữa.

→ **Kéo một sợi dây là một hành động có hậu quả đo được.** Đây là thứ khiến canvas hơn hẳn một danh sách có checkbox.

Trên node agent bị ngắt: làm mờ, ghi "đang nghỉ".

---

## 4. Bốn loại node

| Loại | Số lượng | Xoá được? | Nối ra được? | Nhận nối từ |
|---|---|---|---|---|
| **assistant** | đúng 1, tự có khi tạo văn phòng | ❌ | → agent | mcp |
| **agent** | 0..n | ✅ | ❌ **không gì cả** | assistant, mcp |
| **knowledge** | đúng 1, tự có | ❌ | không có dây | không có dây |
| **mcp** | 0..n | ✅ | → assistant, → agent | — |

### assistant

Không xoá được: không có Trợ lý thì không ai lập kế hoạch. Hiện: tên, tier model, số người đang trực, và `📒 n` = sổ tay riêng của chính Trợ lý.

Click vào nó mở được **prompt phân lớp** — lớp core chỉ đọc nhưng luôn xem được, skills sửa được. → `SPEC-offices.md` §4.1

### agent — KHÔNG được nối sang agent khác

Canvas phải làm cho việc này **bất khả thi về mặt vật lý**, không phải báo lỗi sau khi vẽ xong. Kéo từ agent ra thì không có cổng ra nào để bám vào.

Lý do là kinh tế, không phải thẩm mỹ: agent nói chuyện trực tiếp với nhau là **nguồn đốt token lớn nhất** trong mọi hệ multi-agent và không kiểm soát được. Mọi trao đổi đi qua Trợ lý hoặc qua artifact.

Trên node agent hiện: avatar, tên, tier, và **`📒 n`** = số ghi chú trong sổ tay riêng của nó.

### knowledge — không có dây, cố ý

Kho chung ở giữa canvas. **Không vẽ dây tới ai cả** — nó là môi trường, không phải quan hệ. Ai cũng tới được, giống cái kệ tài liệu giữa văn phòng.

Nhưng phải thể hiện được **hai loại tri thức** mà hệ thống đã có:

- **node knowledge ở giữa** = `knowledge/shared/` — Trợ lý ghi, cả văn phòng đọc
- **`📒 n` trên từng node agent** = `knowledge/agents/<role>/` — chính agent đó ghi khi làm sai hoặc tìm ra cách đúng, **chỉ nó đọc**

Click node knowledge → mở ngăn kéo tri thức (đã có ở `SPEC-ui.md` §4).

### mcp

Nối vào **agent** → agent đó được dùng MCP đó.

Nối vào **Trợ lý** → thực chất gắn cho `concierge` (worker one-shot chạy ngầm), **không** gắn thẳng vào session Trợ lý. Trợ lý resume liên tục, mà MCP phá prompt cache khi resume ([#247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247)) → mất ~36 000 token quy đổi **mỗi lượt trò chuyện**.

Từ góc nhìn người dùng, "Trợ lý dùng được tool này" là **đúng** — nên không cần giải thích cơ chế trên UI. Chỉ cần một dòng tooltip: *"việc vặt Trợ lý tự xử lý"*.

---

## 5. Canvas cũng là màn hình chạy

Đây là chỗ canvas thắng hẳn danh sách. Khi công ty làm việc:

- **Node agent sáng lên** khi nó nhận task, kèm câu `say` ngay dưới tên (*"đang đọc gioi_thieu.md"*)
- **Dây Trợ lý→agent nhấp nháy** trong lúc task chạy
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
- Tự sắp xếp lần đầu: Trợ lý trên cùng, agent dàn hàng ngang bên dưới, knowledge ở giữa dưới cùng.
- Canvas **không tự sinh** thứ gì ngoài `layout.json`. Thêm agent trên canvas → ghi `roles/<id>.yaml` từ template; xoá agent → hỏi có xoá luôn file yaml không (mặc định **giữ lại**, chỉ bỏ khỏi layout).

### API mới

```
GET  /api/layout          → hình dạng + metadata để vẽ (KHÔNG tự ghi file)
PUT  /api/layout          → ghi đè (debounced 800ms từ client)
POST /api/agent           → tạo roles/<id>.yaml + nối dây từ Trợ lý
DELETE /api/agent/:id     → ?keepFile=true|false (mặc định GIỮ file)
GET  /api/knowledge       → duyệt kho cho ngăn kéo tri thức (0 token)
```

### Luật nối dây thi hành ở SERVER, không chỉ ở canvas

Canvas làm cho agent→agent **bất khả thi về mặt vật lý** (node agent không có cổng ra — đã kiểm: `out: 0`). Nhưng UI là client, ai cũng `PUT` thẳng được. Luật kinh tế phải nằm ở `sanitizeEdges()` mới thật sự là luật. Đã kiểm bằng `PUT` trực tiếp: cạnh agent→agent, agent→assistant, assistant→knowledge đều bị loại âm thầm, chỉ cạnh hợp lệ được ghi.

`POST /api/agent` nhận tên do người dùng gõ và dùng nó làm **tên file** → id phải qua `slugRoleId` + `isSafeRoleId` (`^[a-z0-9][a-z0-9_-]{0,39}$`).

### Ba chốt chặn phải có vì canvas thêm endpoint ghi

Daemon bind `127.0.0.1` **không** có nghĩa là chỉ mình bạn gọi được nó: mọi trang web bạn đang mở đều `POST` được vào `localhost`.

| Chốt | Chặn gì |
|---|---|
| `Sec-Fetch-Site` / `Origin` trên mọi method ghi | trang lạ giao việc đốt token, xoá nhân viên, ngắt sạch dây |
| `Host` phải là localhost/host đã bind | DNS rebinding (tên miền của kẻ tấn công trỏ về 127.0.0.1) |
| `readArtifact` chặn mọi segment bắt đầu bằng `.` | `?path=.state/assistant-session.json` — `safeJoin` cho qua vì `.state/` nằm **bên trong** thư mục công ty |

CLI và Telegram bridge không gửi `Origin`/`Sec-Fetch-Site` nên không bị ảnh hưởng — đã kiểm bằng `agentco stop`.

---

## 8. Ngoài phạm vi

- **Liên văn phòng** (Trợ lý nói chuyện với Trợ lý). Đây là quay lại đúng bài toán agent-to-agent mà kiến trúc cố tránh — cần thiết kế riêng, không phải mở rộng canvas. Ghi vào roadmap M3+.
- Nhiều Trợ lý trong một văn phòng
- Vẽ nhân vật / hoạt hoạ nhân vật — **cố ý không làm**. Node là đủ, và rẻ hơn nhiều.
- Sửa nội dung tri thức bằng kéo thả node
