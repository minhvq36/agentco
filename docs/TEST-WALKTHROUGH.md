# Bài test 10 use case — từng bước một, theo đúng thứ tự người dùng bấm

**Ngày:** 15/08/2026 · Đi kèm `USE-CASES.md` (lý do) — file này chỉ có **thao tác**.

Mỗi bài giả định bạn **luôn tạo văn phòng mới trước**. Làm xong một bài thì đóng văn phòng đó lại rồi sang bài sau; chúng độc lập hoàn toàn nên không ảnh hưởng nhau.

---

## ĐỌC TRƯỚC: hôm nay giao diện làm được tới đâu

Đây là điều quan trọng nhất trong cả file, và là lý do bài test này có giá trị.

| Việc | Bấm được trong giao diện? |
|---|---|
| Tạo văn phòng | ✅ nút **+ Văn phòng** |
| Thêm nhân viên (tên, giới thiệu, mức model) | ✅ nút **Nhân viên** |
| **Sửa hồ sơ nhân viên** (tên · giới thiệu · mức model) | ✅ **MỚI** — bảng chi tiết → *Sửa hồ sơ* |
| **Đọc/ghi file + tìm trên web** | ✅ **MỚI — bật sẵn, không phải khai gì** |
| Nối / ngắt dây, cho nghỉ, bỏ khỏi sơ đồ | ✅ kéo trên sơ đồ, **phản hồi tức thì** |
| Giao việc, xem kế hoạch, xem nhật ký, xem chi phí | ✅ |
| **Kế hoạch hiện trong khung chat** | ✅ **MỚI** — chuẩn bị cho Telegram |
| **Lệnh chữ** `/help` `/stop` `/status` | ✅ **MỚI** — 0 token, chạy được cả qua bridge |
| Xem prompt phân lớp | ✅ chỉ đọc |
| **Viết skills cho nhân viên** | ❌ **phải mở file bằng tay** — `SPEC-tools-approval.md` §4 |
| **Bật `Bash`** (chạy lệnh trên máy) | ❌ **phải sửa `roles/<id>.yaml`** — cố ý, xem dưới |
| **Cắm MCP** | ❌ **phải sửa `company.yaml`** — `SPEC-tools-approval.md` §6 |
| **Nạp chìa khoá** | ⚠ CLI (`agentco secret set`) — **cố ý**, `SPEC-offices.md` §5 |
| **Duyệt trước khi agent hành động ra ngoài** | ❌ **chưa có** — `SPEC-tools-approval.md` §8 |

> **Đổi từ 15/08:** mọi nhân viên **bật sẵn** `Read` `Write` `Edit` `Glob` `Grep` `WebSearch` `WebFetch` và **không tắt được**. Chúng là *tay* của văn phòng: bốn tool file chỉ chạm được thư mục văn phòng (`cwd` + `safeJoin`), hai tool web chỉ **đọc**. Bài 4 và 10A vì thế **hết phải mở editor**.
>
> `Bash` **cố ý** không bật sẵn — nó là thứ duy nhất ra được khỏi thư mục văn phòng, nên phải là một quyết định tường minh. Chỉ bài 9 cần nó.

**Ký hiệu trong file này:** 🖱 = bấm trong giao diện · ⌨ = gõ trong terminal · 📝 = mở file bằng editor.

---

## Chuẩn bị một lần (cho cả 10 bài)

```powershell
cd <thư-mục-agentco>
npm install
npm --prefix web install
npm run build:all
node dist/cli/index.js doctor      # phải ✓ hết, nhất là "Đăng nhập Claude Code"
node dist/cli/index.js start
```

Nếu `doctor` báo chưa đăng nhập: chạy `claude` một lần, đăng nhập, rồi thử lại.

Thư mục công ty là `./company/`. Mọi đường dẫn 📝 dưới đây tính từ đó.

---

## Bài 1 — Xưởng nội dung ✅ *không cần gõ tay gì*

Bài dễ nhất. Dùng để xác nhận hệ thống chạy trước khi làm bài khó.

**Bước 1.** 🖱 **+ Văn phòng** → tên `Nội dung` → **Tạo**

**Bước 2.** 🖱 **Nhân viên** → điền rồi **Tạo**:
- Tên hiển thị: `Người viết`
- Giới thiệu: `Viết nội dung tiếng Việt: bài đăng, email, mô tả sản phẩm. Đầu ra là file markdown.`
- Mức model: `standard`

**Bước 3.** 🖱 **Nhân viên** lần nữa:
- Tên hiển thị: `Người soát`
- Giới thiệu: `Đọc lại bài người khác viết, chỉ ra chỗ sai và chỗ chưa đạt. Đầu ra là file nhận xét ngắn.`
- Mức model: `eco`

**Bước 4.** 🖱 mở panel **Nói với Trợ lý** (icon trên cùng bên trái), gõ:

```
Viết 3 đoạn giới thiệu ngắn cho tiệm hoa Nắng Sớm, mỗi đoạn 50 từ,
ba giọng khác nhau: ấm áp, sang trọng, vui nhộn. Lưu mỗi đoạn một file.
```

**Phải thấy:** Trợ lý lập kế hoạch → **cả ba node sáng cùng lúc** (nếu nó chia 3 task song song) → dây nhấp nháy → xong.

**Đo cái gì:** 🖱 panel **Nhật ký** → mở việc vừa chạy. Nhìn `cache_write` của ba task: **task đầu lớn, hai task sau nhỏ**. Đó là cache priming gate đang hoạt động. Nếu cả ba đều lớn thì gate hỏng.

**Chi phí ước tính:** $0.15 – $0.35

---

## Bài 2 — Hỗ trợ khách hàng ⚠ *cần gõ tay: nạp tri thức*

**Bước 1.** 🖱 **+ Văn phòng** → `Hỗ trợ khách`

**Bước 2.** 🖱 **Nhân viên**:
- Tên: `Người trả lời`
- Giới thiệu: `Soạn câu trả lời cho khách dựa trên chính sách của shop. Đầu ra là file trả lời ngắn, đúng giọng shop.`
- Mức: `eco`

**Bước 3.** 📝 Nạp chính sách vào kho tri thức. Tạo `company/offices/ho-tro-khach/knowledge/shared/doi-tra.md`:

```markdown
---
id: k/shared/doi-tra
type: policy
title: "Chính sách đổi trả"
tags: [doi-tra, hoan-tien, van-chuyen]
scope: shared
author: master
confidence: 1
hits: 0
updated: 2026-08-15
---

Đổi trả trong 7 ngày kể từ khi nhận hàng, sản phẩm còn nguyên tem mác.
Hàng giảm giá trên 50% không đổi trả. Phí ship chiều đổi do khách chịu,
trừ trường hợp shop giao sai hoặc hàng lỗi.
```

Làm thêm 3–4 file nữa cho các chủ đề khác (bảng giá, thời gian giao, bảo hành). **Mỗi file một chủ đề, dưới 250 token.** Một file to nhồi hết mọi thứ sẽ làm hỏng chính bài test này.

**Bước 4.** ⌨ `node dist/cli/index.js stop` rồi `start` lại (kho tri thức quét lúc mở văn phòng).

**Bước 5.** 🖱 chat, gõ **một câu hỏi chỉ liên quan tới ĐÚNG MỘT file**:

```
Khách mua hàng sale 60% hôm kia, giờ đòi đổi size. Soạn giúp mình câu trả lời.
```

**Phải thấy:** câu trả lời nêu đúng luật "hàng giảm trên 50% không đổi trả". 🖱 mở **Nhật ký** → nếu nó trả lời đúng thì truy xuất COLD đã kéo đúng node.

**Bài test thật nằm ở đây:** hỏi 5 câu, mỗi câu thuộc một file khác nhau. Đếm bao nhiêu câu trả đúng. Dưới 4/5 nghĩa là chấm điểm từ khoá của `KnowledgeStore.cold()` chưa đủ tốt — đó là kết quả có ích, không phải thất bại.

**Chi phí:** ~$0.02/câu

---

## Bài 3 — Sổ sách & hoá đơn ⚠ *cần gõ tay: chuẩn bị dữ liệu*

**Bước 1.** 🖱 **+ Văn phòng** → `Sổ sách`

**Bước 2.** 🖱 **Nhân viên**:
- Tên: `Kế toán`
- Giới thiệu: `Đọc file CSV sao kê, phân loại từng dòng vào nhóm chi tiêu, ghi ra bảng tổng hợp và file CSV đã gắn nhãn.`
- Mức: `eco`

**Bước 3.** 📝 Chuẩn bị dữ liệu. Tạo `company/offices/so-sach/artifacts/input/sao-ke.csv`:

```csv
ngay,noi_dung,so_tien
2026-07-02,GRAB *TRIP,85000
2026-07-03,CIRCLE K,42000
2026-07-05,TIEN NHA THANG 7,4500000
2026-07-08,SHOPEE MUA HANG,320000
```

Làm khoảng 30–40 dòng cho có ý nghĩa.

**Bước 4.** 🖱 chat:

```
Đọc file artifacts/input/sao-ke.csv, phân loại từng dòng vào các nhóm:
ăn uống, đi lại, nhà ở, mua sắm, khác. Ghi ra artifacts/bao-cao-thang-7.md
gồm tổng từng nhóm và tổng chung.
```

**Bước 5 — QUAN TRỌNG NHẤT, và phải làm bằng tay:** 📝 mở file kết quả, **tự cộng lại tổng** và so với tổng trong file CSV gốc.

**Vì sao bước này tồn tại:** hệ thống hiện **không có cách kiểm chứng con số**. Receipt nói "đã phân loại xong" và nó được tin. Nếu tổng lệch, bạn vừa tìm ra lỗ hổng số 3 trong `USE-CASES.md` — và đó là lý do đừng đem hệ thống đụng vào tiền của người khác cho tới khi có cơ chế `verify` chạy bằng code.

**Chi phí:** ~$0.05 – $0.15

---

## Bài 4 — Theo dõi đối thủ ✅ *không cần gõ tay* · ❌ *chặn ở phần "định kỳ"*

Làm được **một lần chạy tay**, không làm được phần "định kỳ" — đó chính là kết quả cần ghi nhận.

**Bước 1.** 🖱 **+ Văn phòng** → `Theo dõi`

**Bước 2.** 🖱 **Nhân viên**: tên `Người quét`, giới thiệu `Mở các trang web được giao, ghi lại nội dung chính vào file snapshot có ngày tháng.`, mức `standard`

**Bước 3.** *(đã bỏ)* — `WebSearch`/`WebFetch` giờ **bật sẵn**. Không phải mở file, không phải khởi động lại.

**Bước 4.** 🖱 chat:

```
Mở 3 trang này và ghi lại giá + tính năng chính của từng bên vào
artifacts/snapshot-2026-08-15.md:
https://ví-dụ-1.com/pricing
https://ví-dụ-2.com/pricing
https://ví-dụ-3.com/pricing
```

**Bước 5 — chỗ bài test dừng lại:** tuần sau bạn phải **tự nhớ vào gõ lại**. Không có lịch, không có nhắc. Ghi nhận: *lỗ hổng số 2*.

**Chi phí:** ~$0.10 – $0.30 (tuỳ trang nặng nhẹ)

---

## Bài 5 — Bản địa hoá ✅ *không cần gõ tay*

Bài chứng minh kho tri thức có giá trị thật — và giá trị đó **đếm được**.

**Bước 1.** 🖱 **+ Văn phòng** → `Bản địa hoá`

**Bước 2.** 🖱 **Nhân viên**:
- Tên: `Người dịch`
- Giới thiệu: `Dịch tài liệu sang tiếng Việt, giữ nguyên thuật ngữ đã thống nhất. Đầu ra là file markdown.`
- Mức: `standard`

**Bước 3.** 📝 Bỏ 3–5 tài liệu tiếng Anh vào `company/offices/ban-dia-hoa/artifacts/input/`.

**Bước 4.** 🖱 chat, dịch **file thứ nhất**:

```
Dịch artifacts/input/doc-1.md sang tiếng Việt, giọng tài liệu sản phẩm.
Lưu vào artifacts/vi/doc-1.md. Sau khi dịch xong, ghi lại các thuật ngữ
quan trọng và cách bạn đã chọn dịch chúng.
```

**Bước 5.** Lặp cho file 2, 3, 4, 5 — **mỗi lần một ca riêng**, đừng gộp.

**Bước 6 — đo:** chọn 10 thuật ngữ xuất hiện ở nhiều file. Đếm mỗi thuật ngữ được dịch bằng **mấy cách khác nhau**.

- File 1→5 mà số cách dịch **giảm dần** → kho tri thức đang hoạt động.
- Không giảm → `addLesson` không ghi được gì hữu ích, hoặc HOT không kéo nó vào. Cũng là kết quả có ích.

🖱 Mở panel **Tri thức** sau mỗi ca để nhìn sổ tay của `Người dịch` dày lên.

**Chi phí:** ~$0.10/file

---

## Bài 6 — Rà hợp đồng ❌ *chặn: tài liệu dài hơn một task*

⚠ **Không phải tư vấn pháp lý.** Đây là bài test kỹ thuật, đừng dùng kết quả để ký gì.

**Bước 1.** 🖱 **+ Văn phòng** → `Rà hợp đồng`

**Bước 2.** 🖱 **Nhân viên** (ba người):

| Tên | Giới thiệu | Mức |
|---|---|---|
| `Người đọc` | `Đọc hợp đồng, tách thành từng điều khoản, ghi mỗi điều khoản một file.` | standard |
| `Người soi` | `Đọc một điều khoản, chỉ ra chỗ bất lợi cho bên nhận việc và giải thích vì sao.` | deep |
| `Người gộp` | `Gộp các nhận xét thành một checklist ngắn cho người không rành luật.` | eco |

**Bước 3.** 📝 Bỏ một hợp đồng **dài** (10+ trang, dạng `.md` hoặc `.txt`) vào `artifacts/input/hop-dong.md`.

**Bước 4.** 🖱 chat:

```
Đọc artifacts/input/hop-dong.md, tách theo điều khoản, soi từng điều
xem có gì bất lợi cho bên nhận việc, rồi gộp thành một checklist ngắn.
```

**Phải thấy — và đây là bài test:** Trợ lý **không đọc được file** nên nó phải đoán hợp đồng dài bao nhiêu để chia việc. Nhiều khả năng nó giao một task duy nhất "đọc và tách", rồi task đó chạm `max_turns` hoặc trả về kết quả cắt cụt.

**Ghi nhận:** *lỗ hổng số 4*. Cần một bước `survey` rẻ (đo kích thước file) chạy trước khi lập kế hoạch. Chưa có, và không tự nhiên có.

**Chi phí:** $0.30 – $1.50, và có khả năng cao là **tiền mất mà kết quả cụt** — đó là dữ liệu, không phải tai nạn.

---

## Bài 7 — Xưởng bảng tính ✅ *không cần gõ tay*

Bài này để **đo tier**, không phải để lấy kết quả.

**Bước 1.** 🖱 **+ Văn phòng** → `Bảng tính`

**Bước 2.** 🖱 tạo **hai nhân viên giống hệt nhau, chỉ khác mức model**:

| Tên | Giới thiệu | Mức |
|---|---|---|
| `Phân tích eco` | `Đọc CSV, tính tổng hợp theo nhóm, ghi bảng kết quả ra markdown.` | eco |
| `Phân tích standard` | `Đọc CSV, tính tổng hợp theo nhóm, ghi bảng kết quả ra markdown.` | standard |

**Bước 3.** 📝 Bỏ một CSV ~200 dòng vào `artifacts/input/du-lieu.csv`.

**Bước 4.** 🖱 chat **hai lần, cùng một câu**, mỗi lần chỉ định một người:

```
Nhờ Phân tích eco đọc artifacts/input/du-lieu.csv, tính tổng theo từng
nhóm và ghi ra artifacts/ket-qua-eco.md
```

rồi

```
Nhờ Phân tích standard làm y hệt, ghi ra artifacts/ket-qua-standard.md
```

**Bước 5 — đo:** ⌨ `node dist/cli/index.js cost` và 🖱 panel **Nhật ký**. So **số lượt** và **$/việc** của hai người.

Bảng tham chiếu (SESSIONS_MEMORY, đo tháng 8): `eco` dùng 2,5× lượt, 2,17× token, chậm 2,11× — **nhưng vẫn rẻ hơn 38%**. Nếu ở bài này `eco` **đắt hơn**, luật chọn tier phải viết lại. Đó là lý do bài test này tồn tại.

**Bước 6.** Kiểm kết quả có **giống nhau** không. Rẻ mà sai thì không rẻ.

**Chi phí:** ~$0.10 cho cả hai lần

---

## Bài 8 — Sàng lọc hồ sơ ✅ *không cần gõ tay*

⚠ CV là dữ liệu cá nhân của người khác. Chúng nằm trên máy bạn và chỉ đi tới Anthropic — nhưng vẫn nên dùng CV giả để test.

**Bước 1.** 🖱 **+ Văn phòng** → `Tuyển dụng`

**Bước 2.** 🖱 **Nhân viên**: tên `Người sàng`, giới thiệu `Đọc CV theo một bộ tiêu chí cố định, chấm điểm từng mục và ghi một dòng kết luận cho mỗi hồ sơ.`, mức `eco`

**Bước 3.** 📝 Viết tiêu chí vào charter — `company/offices/tuyen-dung/knowledge/shared/_charter.md`, **thêm vào sau khối `---`**:

```markdown
Tuyển: Nhân viên nội dung, 1–3 năm kinh nghiệm.
Chấm 4 mục, mỗi mục 0–5: kinh nghiệm viết · sản phẩm đã làm · tiếng Anh · độ phù hợp văn hoá.
Loại thẳng nếu không có sản phẩm nào kèm theo.
```

Giữ dưới 500 token — khối này nằm trong prefix của mọi nhân viên.

**Bước 4.** 📝 Bỏ 20 CV giả vào `artifacts/input/cv/`.

**Bước 5.** ⌨ `stop` / `start` (charter đọc lúc mở văn phòng).

**Bước 6.** 🖱 chat:

```
Đọc hết CV trong artifacts/input/cv/, chấm theo tiêu chí trong charter,
ghi bảng xếp hạng vào artifacts/xep-hang.md
```

**Đo cái gì:** Trợ lý chia **mấy task**? Nhớ sàn ~13 200 token mỗi lần gọi worker — 20 task riêng lẻ tốn gấp nhiều lần 3 task gộp. 🖱 **Nhật ký** cho biết nó chọn thế nào. Đây là chỗ luật "ít task lớn hơn nhiều task nhỏ" bị thử thách bằng số thật.

**Chi phí:** $0.15 – $0.60 tuỳ nó chia thế nào — **và chênh lệch đó chính là kết quả bài test**.

---

## Bài 9 — Báo cáo tiến độ ⚠ *cần gõ tay: thêm tool `Bash`*

Bài dễ đánh giá nhất, vì bạn biết tuần rồi mình làm gì.

**Bước 1.** 🖱 **+ Văn phòng** → `Báo cáo`

**Bước 2.** 🖱 **Nhân viên**:
- Tên: `Người ghi sử`
- Giới thiệu: `Đọc lịch sử git và các file đã đổi, tóm tắt những gì đã làm. Đầu ra là file tóm tắt kỹ thuật.`
- Mức: `eco`

**Bước 3.** 📝 **BẮT BUỘC** — mở `company/offices/bao-cao/roles/nguoi-ghi-su.yaml`:

```yaml
tools: [Read, Glob, Grep, Bash, Write]
use_preset: true      # đổi từ false -> true
```

`use_preset: true` bật system prompt của Claude Code (đắt thêm ~6 300 token mỗi lần gọi). **Đây là vai trò duy nhất trong 10 bài đáng bật nó** — nó đọc code.

**Bước 4.** 🖱 **Nhân viên** thứ hai: tên `Người viết báo cáo`, giới thiệu `Viết bản cập nhật cho người KHÔNG phải dev, dựa trên tóm tắt kỹ thuật có sẵn.`, mức `standard`. Người này **giữ nguyên tools mặc định**.

**Bước 5.** ⌨ `stop` / `start`.

**Bước 6.** 🖱 chat:

```
Đọc git log 7 ngày gần nhất của repo ở <đường-dẫn-repo>, tóm tắt đã làm gì,
rồi viết một bản cập nhật cho khách hàng không rành kỹ thuật.
Lưu vào artifacts/cap-nhat-tuan.md
```

⚠ Agent chạy với `cwd` là **thư mục văn phòng**, không phải repo của bạn. Đưa đường dẫn tuyệt đối, hoặc copy repo vào `artifacts/input/`.

**Chi phí:** ~$0.10 – $0.25

---

## Bài 10 — Trợ lý cá nhân · chặng A ✅ *không cần gõ tay* · chặng B ⚠⚠ *OAuth + MCP*

Bài duy nhất cần cắm dịch vụ ngoài. Làm theo **ba chặng**, đừng nhảy thẳng vào chặng 3.

### Chặng A — bản không cần cắm gì (làm trước, 2 phút)

**Bước A1.** 🖱 **+ Văn phòng** → `Trợ lý cá nhân`

**Bước A2.** 🖱 **Nhân viên**: tên `Người tìm tin`, giới thiệu `Tìm và tóm tắt thông tin trên web theo yêu cầu, ghi ra file có kèm nguồn.`, mức `standard`

**Bước A3.** 🖱 chat: `Tìm giúp mình 5 quán cà phê làm việc được ở quận 1, ghi giờ mở cửa và giá đồ uống vào file.`

**Chỉ ba bước, không mở file nào.** Đây là 1/4 giá trị của cả use case và nó chạy trong 2 phút — trong khi openclaw đòi cài Gateway, nối kênh chat, và với nhiều người là vài chục đô tiền gỡ rối. Nếu chặng A đã đủ dùng thì dừng lại ở đây.

### Chặng B — cắm Google (Drive / Sheets / Docs)

Không có MCP server chính thức nào của Anthropic cho Google. Có **hai đường**:

| Đường | Ai làm | Ghi chú |
|---|---|---|
| MCP chính thức của **Google** cho Drive/Sheets | Google | mới, cần bật API trong Google Cloud |
| MCP **cộng đồng** (`@dguido/google-workspace-mcp`, `@isaacphi/mcp-gdrive`, `@a-bonus/google-docs-mcp`…) | bên thứ ba | dễ cài hơn, nhưng **bạn đang trao token Google cho code người lạ** |

⚠ **Đọc kỹ trước khi làm:** dù chọn đường nào, bạn cũng phải tự tạo OAuth client trong Google Cloud Console. Đây là rào chắn thật với người non-code, và là lý do `SPEC-connectors.md` tồn tại.

**Bước B1.** Trong [Google Cloud Console](https://console.cloud.google.com): tạo project → bật **Google Drive API** + **Google Sheets API** + **Google Docs API** → **APIs & Services → Credentials** → tạo **OAuth client ID** loại *Desktop app* → cấu hình **OAuth consent screen**, thêm chính email của bạn vào *Test users*.

**Bước B2.** Ghi lại `Client ID` và `Client secret`.

**Bước B3.** ⌨ nạp chìa (giá trị đi qua biến môi trường để **không lọt vào lịch sử shell**):

```powershell
$env:VALUE="<client-id-của-bạn>";     node dist/cli/index.js secret set GOOGLE_CLIENT_ID
$env:VALUE="<client-secret-của-bạn>"; node dist/cli/index.js secret set GOOGLE_CLIENT_SECRET
node dist/cli/index.js secret list     # chỉ hiện TÊN, không hiện giá trị
```

**Bước B4.** 📝 mở `company/company.yaml`, đổi `mcpServers: {}` thành:

```yaml
mcpServers:
  google:
    command: npx
    args: ["-y", "@dguido/google-workspace-mcp"]
```

**Bước B5.** 🖱 **Nhân viên**: tên `Người dọn tài liệu`, giới thiệu `Tìm, đọc và cập nhật file trên Google Drive/Docs/Sheets theo yêu cầu.`, mức `standard`

**Bước B6.** 📝 `roles/nguoi-don-tai-lieu.yaml` — thêm hai dòng:

```yaml
mcp: [google]
secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET]
```

**Chỉ người này cầm chìa Google.** `Người tìm tin` ở chặng A không có `secrets:` nên không đụng được vào Drive của bạn — kể cả khi nó bị lừa bởi nội dung nó đọc trên web. Đây là toàn bộ lý do trường `secrets` tồn tại.

**Bước B7.** ⌨ `stop` / `start`. Lần chạy đầu, MCP server sẽ mở trình duyệt xin quyền Google. Duyệt một lần, token lưu lại.

**Bước B8.** 🖱 mở sơ đồ — phải thấy node `🔌 google`. Kéo dây từ nó xuống `Người dọn tài liệu` (nếu chưa có sẵn).

**Bước B9.** 🖱 chat: `Tìm trong Drive file bảng kê chi phí tháng 7, đọc rồi tóm tắt 5 khoản lớn nhất.`

### Chặng C — hộp thư & lịch: **DỪNG LẠI**

Đây là chỗ bài test kết thúc, và kết thúc bằng một kết luận chứ không phải một lỗi.

Lọc hộp thư và soạn nháp trả lời thì làm được. Nhưng **hệ thống hiện không có màn hình duyệt**: trạng thái `needs_human` có trong giao thức receipt nhưng không có chỗ nào để bạn bấm "đồng ý, gửi đi".

Nên hôm nay chỉ có hai lựa chọn, và cả hai đều không ổn:

1. Cho agent quyền gửi → nó gửi mà bạn không kịp xem. **Đây đúng là tính năng ai cũng tắt sau lần đầu nó gửi nhầm.**
2. Không cho quyền gửi → agent chỉ soạn nháp ra file, bạn tự copy đi gửi.

**Chọn số 2.** Và ghi nhận: *lỗ hổng số 1, nghiêm trọng nhất, nên làm trước Telegram bridge.*

**Chi phí chặng A:** ~$0.05 · **chặng B:** ~$0.10/lần hỏi

---

## Bảng ghi kết quả

In ra hoặc copy vào một file, điền trong lúc chạy:

| Bài | Chạy được? | Chi phí thật | Số lượt | Chỗ vấp | Ghi chú |
|---|---|---|---|---|---|
| 1 Xưởng nội dung | | | | | cache priming có hoạt động? |
| 2 Hỗ trợ khách | | | | | mấy/5 câu trả đúng? |
| 3 Sổ sách | | | | | **tổng có khớp không?** |
| 4 Theo dõi | | | | | dừng ở "không có lịch" |
| 5 Bản địa hoá | | | | | số cách dịch có giảm không? |
| 6 Rà hợp đồng | | | | | có bị cụt không? |
| 7 Bảng tính | | | | | eco rẻ hơn hay đắt hơn? |
| 8 Sàng lọc | | | | | chia mấy task? |
| 9 Báo cáo | | | | | |
| 10A Tìm tin | | | | | |
| 10B Google | | | | | OAuth mất bao lâu? |

**Ba con số đáng quan tâm nhất sau khi chạy hết:**

1. **Bao nhiêu bài phải mở editor?** Mỗi lần mở là một chỗ người dùng non-code rơi rụng.
2. **Tổng chi phí cả 10 bài.** Ước tính $1.5 – $4. Nếu vượt $8 thì có gì đó đang rò rỉ — chạy `agentco cost` và nhìn cột `ghi-cache bất thường`.
3. **Bài nào bạn thật sự muốn dùng lại tuần sau?** Đó mới là danh sách template nên làm, không phải bảng ở trên.
