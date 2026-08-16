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
| **Đưa tài liệu vào cho nhân viên đọc** | ✅ **MỚI** — panel **Tủ tài liệu**, kéo thả · pdf docx xlsx pptx md txt csv json yaml |
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
>
> **Đổi từ 17/08 — TỦ TÀI LIỆU** (`SPEC-library.md`). Mọi bước 📝 *"bỏ file vào `artifacts/input/`"* trong bài 2 · 3 · 5 · 6 · 7 · 8 giờ là 🖱 **kéo thả vào panel Tủ tài liệu**. Nội dung `.pdf` `.docx` `.xlsx` `.pptx` được **bóc thành text một lần lúc thả vào** nên `Grep` tìm được ngay và không tốn token lặp lại. Đây là thay đổi lớn nhất với chỉ số *"bao nhiêu bài phải mở editor"* ở cuối file.

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

## Bài 2 — Hỗ trợ khách hàng ✅ *không cần gõ tay* — **viết lại 17/08**

> **Đổi đề, giữ nguyên mục đích.** Bản cũ bắt tự tay viết 5 file node vào `knowledge/shared/`. Nhưng chính sách của shop là **tài liệu người dùng sở hữu**, không phải bài học agent tự rút ra — nó thuộc **tủ tài liệu**. Xem `SPEC-library.md` §7.
>
> ⚠ Hệ quả phải ghi nhận: bài này giờ đo **`Grep` trên tủ tài liệu**, không còn đo chấm điểm từ khoá của `KnowledgeStore.cold()`. Sau khi đổi thì **không còn bài nào đo `cold()` trực tiếp** — nó chỉ được kiểm gián tiếp qua bài 5.

**Bước 1.** 🖱 **+ Văn phòng** → `Hỗ trợ khách`

**Bước 2.** 🖱 **Nhân viên**:
- Tên: `Người trả lời`
- Giới thiệu: `Soạn câu trả lời cho khách dựa trên chính sách của shop trong tủ tài liệu. Đầu ra là file trả lời ngắn, đúng giọng shop.`
- Mức: `eco`

**Bước 3.** 🖱 Mở panel **Tủ tài liệu** → **Thêm tài liệu** (hoặc kéo thả). Bỏ vào **4–5 file, mỗi file một chủ đề**:

| File | Nội dung |
|---|---|
| `doi-tra.md` | Đổi trả trong 7 ngày, còn nguyên tem mác. **Hàng giảm trên 50% không đổi trả.** Phí ship chiều đổi do khách chịu, trừ khi shop giao sai. |
| `bang-gia.md` | bảng giá các nhóm sản phẩm |
| `thoi-gian-giao.md` | nội thành 1–2 ngày, tỉnh 3–5 ngày |
| `bao-hanh.md` | bảo hành 12 tháng, không bảo hành lỗi do người dùng |

Cứ viết bằng Notepad rồi kéo vào — **không cần frontmatter, không cần id, không cần gì cả**. Đó chính là điểm khác nhau giữa tủ tài liệu và kho tri thức.

> Muốn thử luôn phần bóc text: xuất một trong số đó ra `.docx` hoặc `.pdf` rồi thả bản đó vào. Trong tủ nó phải hiện `sẵn sàng` sau vài giây.

**Bước 4.** *(đã bỏ)* — **không phải khởi động lại**. Tủ tài liệu quét lúc mở panel, không phải lúc mở văn phòng.

**Bước 5.** 🖱 chat, gõ **một câu hỏi chỉ liên quan tới ĐÚNG MỘT file**:

```
Khách mua hàng sale 60% hôm kia, giờ đòi đổi size. Soạn giúp mình câu trả lời.
```

**Phải thấy:** câu trả lời nêu đúng luật "hàng giảm trên 50% không đổi trả".

**Bài test thật nằm ở đây:** hỏi 5 câu, mỗi câu thuộc một file khác nhau. Đếm bao nhiêu câu trả đúng.

**Đo cái gì — và đây là phần mới:** 🖱 mở **Nhật ký**, nhìn nhân viên đã làm gì để tìm ra câu trả lời.

| Nó làm gì | Nghĩa là |
|---|---|
| `Grep` một lần → `Read` đúng một file | **tốt nhất** — cơ chế chạy đúng như thiết kế |
| `Read` `library/INDEX.md` trước rồi mới mở file | cũng tốt — tầng định tuyến đang có tác dụng |
| `Read` lần lượt **hết** các file | tủ nhỏ nên chưa đau, nhưng với 50 tài liệu thì đây là chỗ hoá đơn nổ. Ghi nhận |
| trả lời mà không đọc file nào | **hỏng** — nó đang bịa, và câu đúng chỉ là may |

**Chi phí:** ~$0.02/câu

---

## Bài 3 — Sổ sách & hoá đơn ✅ *không cần gõ tay* (từ 17/08)

**Bước 1.** 🖱 **+ Văn phòng** → `Sổ sách`

**Bước 2.** 🖱 **Nhân viên**:
- Tên: `Kế toán`
- Giới thiệu: `Đọc file CSV sao kê, phân loại từng dòng vào nhóm chi tiêu, ghi ra bảng tổng hợp và file CSV đã gắn nhãn.`
- Mức: `eco`

**Bước 3.** 🖱 **Tủ tài liệu** → thả vào một file `sao-ke.csv`:

```csv
ngay,noi_dung,so_tien
2026-07-02,GRAB *TRIP,85000
2026-07-03,CIRCLE K,42000
2026-07-05,TIEN NHA THANG 7,4500000
2026-07-08,SHOPEE MUA HANG,320000
```

Làm khoảng 30–40 dòng cho có ý nghĩa. **Cố ý chừa vài ô trống ở GIỮA hàng** — đó là ca đã làm lệch cột trong bản đầu của bộ bóc, và bạn muốn biết nó còn lệch không.

**Bước 4.** 🖱 chat:

```
Đọc file sao-ke.csv trong tủ tài liệu, phân loại từng dòng vào các nhóm:
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

**Bước 3.** 🖱 **Tủ tài liệu** → thả 3–5 tài liệu tiếng Anh vào.

**Bước 4.** 🖱 chat, dịch **file thứ nhất**:

```
Dịch doc-1.md trong tủ tài liệu sang tiếng Việt, giọng tài liệu sản phẩm.
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

## Bài 6 — Rà hợp đồng ⚠ *bài đã ĐỔI BẢN CHẤT từ 17/08 — đọc kỹ*

⚠ **Không phải tư vấn pháp lý.** Đây là bài test kỹ thuật, đừng dùng kết quả để ký gì.

**Bước 1.** 🖱 **+ Văn phòng** → `Rà hợp đồng`

**Bước 2.** 🖱 **Nhân viên** (ba người):

| Tên | Giới thiệu | Mức |
|---|---|---|
| `Người đọc` | `Đọc hợp đồng, tách thành từng điều khoản, ghi mỗi điều khoản một file.` | standard |
| `Người soi` | `Đọc một điều khoản, chỉ ra chỗ bất lợi cho bên nhận việc và giải thích vì sao.` | deep |
| `Người gộp` | `Gộp các nhận xét thành một checklist ngắn cho người không rành luật.` | eco |

**Bước 3.** 🖱 **Tủ tài liệu** → thả một hợp đồng **dài** (10+ trang). **Dùng `.pdf` hoặc `.docx` thật**, đừng dùng `.md` — cả điểm của bài này giờ nằm ở đó.

**Bước 4.** 🖱 chat:

```
Đọc hợp đồng trong tủ tài liệu, tách theo điều khoản, soi từng điều
xem có gì bất lợi cho bên nhận việc, rồi gộp thành một checklist ngắn.
```

**Bài test cũ (giữ lại để đối chiếu):** Trợ lý **không đọc được file** nên phải đoán hợp đồng dài bao nhiêu để chia việc. Nó giao một task duy nhất "đọc và tách", rồi task đó chạm `max_turns` hoặc trả kết quả cắt cụt. Đó là *lỗ hổng số 4*, và nó cần một bước `survey` rẻ chạy trước khi lập kế hoạch.

**Bài test mới — `library/INDEX.md` CHÍNH LÀ bước `survey` đó**, và nó tốn 0 token vì dựng bằng code. Câu hỏi bây giờ là:

| Quan sát trong **Nhật ký** | Nghĩa là |
|---|---|
| Trợ lý đọc `INDEX.md`, thấy "34 trang", rồi chia **nhiều task theo khoảng** | ✅ lỗ hổng số 4 đã đóng |
| Trợ lý vẫn giao **một task duy nhất** rồi cụt | ❌ tầng định tuyến có mà nó không dùng → cần dặn ở prompt lập kế hoạch. Ghi nhận |
| Nhân viên `Grep` `library/text/` rồi `Read` bản gốc **đúng vài trang** | ✅ mốc trang đang hoạt động (`SPEC-library.md` §3.1) |
| Nhân viên `Read` cả PDF một lần | ❌ với PDF trên 10 trang thì tool **bắt buộc** khai `pages`, nên nhiều khả năng nó sẽ vấp — và đó là kết quả cần ghi |

**Chi phí:** $0.30 – $1.50. Nếu sau khi có tủ tài liệu mà con số này **giảm rõ**, đó là số đo đáng ghi vào `SESSIONS_MEMORY` §7.

---

## Bài 7 — Xưởng bảng tính ✅ *không cần gõ tay*

Bài này để **đo tier**, không phải để lấy kết quả.

**Bước 1.** 🖱 **+ Văn phòng** → `Bảng tính`

**Bước 2.** 🖱 tạo **hai nhân viên giống hệt nhau, chỉ khác mức model**:

| Tên | Giới thiệu | Mức |
|---|---|---|
| `Phân tích eco` | `Đọc CSV, tính tổng hợp theo nhóm, ghi bảng kết quả ra markdown.` | eco |
| `Phân tích standard` | `Đọc CSV, tính tổng hợp theo nhóm, ghi bảng kết quả ra markdown.` | standard |

**Bước 3.** 🖱 **Tủ tài liệu** → thả một CSV ~200 dòng tên `du-lieu.csv`. (Thả thêm bản `.xlsx` của cùng dữ liệu thì đo được luôn chi phí bóc xlsx so với csv.)

**Bước 4.** 🖱 chat **hai lần, cùng một câu**, mỗi lần chỉ định một người:

```
Nhờ Phân tích eco đọc du-lieu.csv trong tủ tài liệu, tính tổng theo từng
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

**Bước 4.** 🖱 **Tủ tài liệu** → thả 20 CV giả vào (thả cả lô một lần được).

**Bước 5.** ⌨ `stop` / `start` (charter đọc lúc mở văn phòng — **tủ tài liệu thì không cần**).

**Bước 6.** 🖱 chat:

```
Đọc hết CV trong tủ tài liệu, chấm theo tiêu chí trong charter,
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
| 2 Hỗ trợ khách | | | | | mấy/5 câu trả đúng? **Grep hay Read hết?** |
| 3 Sổ sách | | | | | **tổng có khớp không?** ô trống có làm lệch cột không? |
| 4 Theo dõi | | | | | dừng ở "không có lịch" |
| 5 Bản địa hoá | | | | | số cách dịch có giảm không? |
| 6 Rà hợp đồng | | | | | Trợ lý có đọc `INDEX.md` trước khi chia việc không? |
| 7 Bảng tính | | | | | eco rẻ hơn hay đắt hơn? |
| 8 Sàng lọc | | | | | chia mấy task? |
| 9 Báo cáo | | | | | |
| 10A Tìm tin | | | | | |
| 10B Google | | | | | OAuth mất bao lâu? |

**Ba con số đáng quan tâm nhất sau khi chạy hết:**

1. **Bao nhiêu bài phải mở editor?** Mỗi lần mở là một chỗ người dùng non-code rơi rụng.
   *Mốc 17/08: tủ tài liệu vừa bỏ bước 📝 khỏi bài 2 · 3 · 5 · 6 · 7 · 8. Còn lại đúng ba chỗ, và cả ba đều CỐ Ý — skills (bài chưa có), `Bash` (bài 9), MCP (bài 10B).*
2. **Tổng chi phí cả 10 bài.** Ước tính $1.5 – $4. Nếu vượt $8 thì có gì đó đang rò rỉ — chạy `agentco cost` và nhìn cột `ghi-cache bất thường`.
3. **Bài nào bạn thật sự muốn dùng lại tuần sau?** Đó mới là danh sách template nên làm, không phải bảng ở trên.
