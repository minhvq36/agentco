# ROADMAP

**Cập nhật:** 14/08/2026
**Đang làm:** P2 (AgentCo). P1 (lớp điều khiển trực quan Claude Code) **hoãn** — sẽ trở thành "phòng Kỹ thuật" bên trong P2.

---

## 0. Nói thẳng về mốc 1 tuần

Toàn bộ spec trong `SPEC-2026-08-14-agentco.md` là **1–2 tháng**, không phải 1 tuần. Nếu cầm nguyên spec đó mà làm trong 7 ngày thì ngày thứ 7 sẽ có một hệ thống chạy được 60% — tức là **không golive được**, tức là mất trắng tuần đó.

Nên tuần 1 có một phạm vi riêng, cắt tàn nhẫn, ở dưới. **Luật: hết ngày 7 là golive dù còn thiếu gì.** Cơ chế bảo vệ deadline là cắt phạm vi, không phải kéo dài thời gian.

---

## Tuần 1 — bản golive được (M0)

Mục tiêu: **một người lạ tải về, chạy, giao một việc thật, nhìn thấy đội agent làm xong, và nhắn tin cho nó qua Telegram.** Chỉ vậy. Không hơn.

### Làm

| # | Hạng mục | Ghi chú |
|---|---|---|
| 1 | Daemon + Claude Agent SDK + master session | `SPEC-cli.md` §1 |
| 2 | Giao thức TaskBrief / Receipt + validate cứng | trần 800 token — **làm ngay ngày đầu**, gắn sau rất khó |
| 3 | Scheduler DAG + concurrency + **cache priming gate** | `SPEC-token-economy.md` §3 |
| 4 | Prompt phân tầng L0–L7 | §2 — sai ở đây là hỏng toàn bộ mục tiêu chi phí |
| 5 | 4 role: `researcher`, `writer`, `coder`, `reviewer` | mức skill `medium` thôi |
| 6 | Tri thức v0: markdown + frontmatter, `index.json`, tìm theo từ khoá | **chưa có Librarian, chưa có HOT/COLD hai tầng** |
| 7 | Web UI: Kế hoạch + Đang diễn ra + Chat + ngăn kéo log | `SPEC-ui.md` §2.1–2.4, bản thô |
| 8 | Bridge Telegram long-poll + ghép đôi bằng mã | không cần server |
| 9 | `agentco cost` + `logs/usage.jsonl` | không đo thì không biết mình đang cháy tiền |
| 10 | `LICENSE.md` (FSL) + README + 1 video 90 giây | golive cần cái này, không phải code |

### Phát sinh sau khi thẩm định SDK — xếp vào đâu

| Hạng mục | Tuần 1? | Vì sao |
|---|---|---|
| **Tách skills core / user** | ✅ **CÓ** | Phân tầng prompt sau này mới gắn thì phải viết lại — cùng lý do với Task/Receipt |
| **Xử lý hết hạn mức subscription** (§9b) | ✅ **CÓ** | Chắc chắn xảy ra với khách thật. Golive mà không có = mất niềm tin ngay lần đầu |
| `concierge` / `quick_action` | ❌ M1 | Là tối ưu, không phải chức năng. Tuần 1 master gọi worker bình thường cũng chạy được |
| `use_preset: false` cho role phi-code | ✅ **CÓ** | Một trường trong yaml, tốn 5 phút, tiết kiệm 5,5 lần |

### KHÔNG làm tuần 1

Librarian · HOT knowledge hai tầng · đồ thị trực quan · nạp tài liệu tay · license key Ed25519 · Docker · `bench` · replay · leo thang tier · Zalo/Messenger · thêm role qua UI · Tauri · `concierge`.

### Nhịp gợi ý

| Ngày | Việc |
|---|---|
| 1 | Daemon + SDK + master chat được qua terminal |
| 2 | Task/Receipt + 1 worker chạy được end-to-end |
| 3 | Scheduler DAG + song song + priming gate |
| 4 | Tri thức v0 + 4 role |
| 5 | Web UI |
| 6 | Telegram + `cost` |
| 7 | README, video, license, golive |

Nếu ngày 4 thấy trễ: bỏ luôn hạng mục 6 (tri thức), ship với role tĩnh. **Tri thức là thứ đáng hy sinh nhất vì nó cải tiến được sau mà không phải viết lại kiến trúc.** Task/Receipt và phân tầng prompt thì không.

---

## M1 — Tiết kiệm & bền + Connector (2–3 tuần sau golive)

**Connector** (`SPEC-connectors.md`) — đây là đặc sản, ưu tiên ngang với phần tiết kiệm:

- Path A: dán MCP config + nút Test + gán theo role
- Path B: form tay định nghĩa REST action + nút Test + `confirm` khi ghi dữ liệu
- Trần token connector theo role (2 000), chặn host ngoài `base_url`, token chỉ ở env

Phần tiết kiệm & bền:

- Librarian + hàng đợi `_inbox` + gộp trùng + archive
- HOT/COLD hai tầng tri thức + `knowledge_version`
- `agentco bench` + 5 golden scenario + ghim ngưỡng
- Bộ invariant test (`SPEC-2026-08-14-agentco.md` §10)
- Replay theo nhánh con
- Compaction master giữ prefix
- Leo thang tier khi fail
- Thêm role qua UI, hot reload

Đây là giai đoạn biến sản phẩm chạy được thành sản phẩm **không đắt lên theo thời gian**.

---

## M2 — Bán được

- License key Ed25519 ký offline (đã thiết kế xong ở `product-decisions-2026-08-03.md` §5 — dùng lại nguyên)
- Gumroad/Polar cho thanh toán, không tự làm backend
- **Connector: dán cURL, dán OpenAPI/Swagger, quản lý token trong UI** — đây là thứ biến "đặc sản" thành thứ người non-code dùng được thật
- Thư viện role mẫu theo ngành (nội dung, ecommerce, freelance dev)
- Nạp tài liệu tay → tự chia node
- Trình duyệt đồ thị tri thức
- Docker + hướng dẫn VPS
- Cloudflare Tunnel + Zalo/Messenger bridge

---

## M3 — P1 quay lại

"Phòng Kỹ thuật": role `coder` + `reviewer` + `architect` cộng với một view riêng cho dự án phần mềm — spec/plan/tiến độ/bản đồ file. Chính là P1, nhưng nằm trong P2 thay vì là sản phẩm riêng.

Lý do hoãn: hai sản phẩm trùng nhau ~70–75% hạ tầng, và P2 bán được cho cả người ngoài ngành phần mềm.

---

## License

**FSL 1.1 → Apache 2.0 sau 2 năm.** Cá nhân, học tập, nội bộ, thử nghiệm: miễn phí. PR và fork cá nhân: được. Cấm: cung cấp sản phẩm cạnh tranh trực tiếp.

Gọi đúng tên là **source-available**, không phải open source.

Chi tiết đầy đủ: `LICENSE.md`.

---

## Rủi ro kỹ thuật

| Rủi ro | Mức | Ứng phó |
|---|---|---|
| **Chi phí token cao khiến trải nghiệm tệ** | cao | Toàn bộ `SPEC-token-economy.md` tồn tại vì cái này |
| **Auth Claude trong container/VPS vướng** | trung bình | Thử sớm ở M2; `agentco doctor` phải chẩn đoán rõ |
| **Agent SDK breaking change** | trung bình | `ProviderAdapter` đã tách; ghim version, đọc changelog |
| **Issue #247 (MCP phá cache) không được sửa** | trung bình | `concierge` đã né được; `master.mcp` để dạng setting |
| **`sessionStore` còn alpha** | thấp | Không phụ thuộc session resume — mọi giá trị nằm ở artifact |

---

## Xác minh SDK — ✅ ĐÃ LÀM XONG 14/08/2026

Kết quả đầy đủ: **`FINDINGS-sdk-2026-08-14.md`**.

| Câu hỏi | Kết quả |
|---|---|
| SDK có tồn tại, dùng được? | ✅ `@anthropic-ai/claude-agent-sdk@0.3.231`, chạy được ngay |
| Dùng subscription hay bắt buộc API key? | ✅ **Subscription Claude Code trên máy**, không cần API key |
| Điều khiển được cache breakpoint? | ✅ **`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`** — cross-session cache. Tốt hơn giả định. |
| Kế toán token có đủ chi tiết? | ✅ `usage` + `modelUsage` có `cache_read`/`cache_creation`/`costUSD` theo model |
| Giới hạn song song thực tế | ❌ **chưa đo** — chuyển xuống danh sách dưới |

### Còn phải kiểm — làm trước ngày 3 của tuần 1

1. **`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` với tri thức HOT ~2K đặt trước marker có hit cross-process không?** Đây là bài kiểm chứng trực tiếp cho `SPEC-token-economy.md` §2.
2. ~~`agents` (subagent SDK) vs tự chạy `query()`~~ → **ĐÃ QUYẾT, không cần test.** Tự viết. Lý do phủ quyết: output subagent đi thẳng vào context cha, phá giao thức Receipt. Cache vẫn chung vì cache là thuộc tính của prefix trên server, không phải của cách sinh agent (bằng chứng: probe2, 4 call độc lập đều `cr=10 555`). Mượn shape `AgentDefinition` làm định dạng file role.
3. Bao nhiêu `query()` đồng thời thì dính 429 → đặt mặc định `concurrency`.
3b. **`jsonSchema` trong `SDKControlInitializeRequest` có phải structured output không?** Nếu có, Receipt được SDK ép schema **miễn phí** thay vì ta validate rồi hỏi lại (tốn một lượt). Đây là thứ rẻ nhất có thể tìm được — kiểm ngay ngày 2.
4. **Đo lại overhead với task NHIỀU LƯỢT.** Probe dùng `maxTurns: 1` là trường hợp xấu nhất; khoản `cache_write` ~2 600 khấu hao qua các lượt sau. Cần số thật để tính tiền đúng.
5. Khoản `cache_write` ~2 600/call lặp lại — ép xuống được không? (để M1)
6. `sessionStore` (alpha) có dùng được cho chế độ VPS không. (để M2)

### Ba điều chỉnh spec phát sinh từ kết quả đo

- **Role phi-code không dùng preset `claude_code`** — chênh ~6 300 token, giá gấp 5,5 lần. Thêm `use_preset: false` mặc định vào `roles/*.yaml`; chỉ `coder`/`reviewer` bật.
- **Sàn ~13 200 token/worker call, không giảm được** (`allowedTools` không phải đòn bẩy kích thước) → luật mới: **ít task lớn hơn nhiều task nhỏ**.
- **Master không gắn MCP.** [Issue #247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247): MCP phá prompt cache khi resume. MCP chỉ gắn cho worker (one-shot, không resume). Điều này **củng cố** thiết kế stateless.
