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

**Và phải thấy Trợ lý KHÔNG hỏi lại** *"size khách muốn đổi còn hàng không?"* — câu đó là câu mà **câu trả lời không đổi được việc phải làm**, vì chính sách đã cấm đổi từ trước. Trước 19/08 nó luôn hỏi, vì nó mù tủ tài liệu. → `SPEC-library.md` §8b

**Bài test thật nằm ở đây:** hỏi 5 câu, mỗi câu thuộc một file khác nhau. Đếm bao nhiêu câu trả đúng.

**Đo cái gì — và đây là phần mới:** 🖱 mở **Nhật ký**, nhìn nhân viên đã làm gì để tìm ra câu trả lời.

| Nó làm gì | Nghĩa là |
|---|---|
| mở thẳng đúng một file, không tìm kiếm gì | **tốt nhất** — Trợ lý đã đưa `inputs` đúng, nhân viên không phải mò |
| `Grep` một lần → `Read` đúng một file | tốt — cơ chế truy xuất chạy đúng |
| `Read` lần lượt **hết** các file | tủ nhỏ nên chưa đau, nhưng với 50 tài liệu thì đây là chỗ hoá đơn nổ. Ghi nhận |
| trả lời mà không đọc file nào | **hỏng** — nó đang bịa, và câu đúng chỉ là may |

**Bước 6 (mới 19/08).** 🖱 Mở **Kho tri thức**. **Phải TRỐNG.**

Ca này chạy trơn tru, và ca chạy trơn tru **không sinh ra bài học nào** — hệ thống không hỏi Trợ lý câu đó nữa. Nếu thấy một node kiểu *"sản phẩm giảm 60% thường không được đổi trả…"* thì chốt `worthLearning` đã hỏng: đó là **nội dung tài liệu bị chép vào prefix**, nó sẽ nói sai ngày bạn đổi chính sách. → `SESSIONS_MEMORY` §5g

**Bước 7 (mới 19/08).** 🖱 Mở **Kết quả**. Phải thấy file vừa tạo, xem trước được, tải về được, xoá được. Đường dẫn phải là `artifacts/<mã kế hoạch>/T-01/…` — chạy lại câu hỏi lần hai thì nó vào **thư mục khác**, không ghi đè lần một.

**Chi phí đo được 19/08:** cả ca **8 lượt · $0.051** (trước khi sửa: 11 lượt · $0.108).

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

## Bài 5 — Bản địa hoá ✅ *không cần gõ tay* · ⚠ **VIẾT LẠI 20/08 — bản cũ đo một thứ đã bị gỡ**

> **Vì sao viết lại.** Bản cũ đo *"sổ tay của `Người dịch` dày lên sau mỗi ca"*. Hành vi đó **không còn tồn tại**, và đó là chuyện tốt: ngày 19/08 một ca chạy trơn tru đã đẻ ra một node tri thức **diễn giải sai** chính sách của người dùng ("trên 50% không đổi trả" → "giảm 60% *thường* không được đổi trả"), rồi nằm trong prompt của mọi nhân viên cho tới khi hết hạn. Bản vá: `worthLearning()` (`assistant.ts`) chỉ hỏi bài học khi ca có **dấu vết trục trặc** — hỏng, bị chặn, receipt phải sửa, hoặc nhân viên lặp thao tác.
>
> Hệ quả: một ca dịch chạy êm sinh ra **0 bài học**, đúng thiết kế. Chạy bài cũ hôm nay thì panel Tri thức đứng im ở 0 và người test kết luận "hệ thống hỏng" — trong khi nó đang làm đúng. **Đã đo trên máy người dùng 20/08:** ba ca dịch, `knowledge/index.json` = 74 byte (rỗng).
>
> Bài mới đo thứ THAY THẾ nó: **hai đường vào tri thức còn lại**, và cả hai đều do người dùng chủ động mở.

Bài chứng minh nhất quán thuật ngữ **đếm được** — và đắt hơn hay rẻ hơn tuỳ vào việc bạn chốt luật ở đâu.

**Bước 1.** 🖱 **+ Văn phòng** → `Bản địa hoá`

**Bước 2.** 🖱 **Nhân viên**:
- Tên: `Người dịch`
- Giới thiệu: `Dịch tài liệu sang tiếng Việt, giữ nguyên thuật ngữ đã thống nhất. Đầu ra là file markdown.`
- Mức: `standard`

**Bước 3.** 🖱 **Tủ tài liệu** → thả 3–5 tài liệu tiếng Anh vào.

### Vòng A — đối chứng (chưa chốt gì)

**Bước 4.** 🖱 chat, dịch **file thứ nhất**. Nói rõ **hai file**, vì "ghi lại thuật ngữ" một mình là câu mà planner đọc ra hai hình dạng khác nhau:

```
Dịch doc-1.md trong tủ tài liệu sang tiếng Việt, giọng tài liệu sản phẩm.
Lưu vào artifacts/vi/doc-1.md, và ghi bảng thuật ngữ ra một file RIÊNG
artifacts/vi/thuat-ngu-doc-1.md — cột: thuật ngữ gốc, bản dịch, lý do chọn.
```

**Bước 5.** Lặp cho file 2 và 3 — **mỗi lần một ca riêng**, đừng gộp.

**Bước 6 — kiểm hình dạng đầu ra.** 🖱 Mở panel **Kết quả**. Cả ba ca phải cho **đúng hai file mỗi ca**, ở `…/T-01/vi/`.

- ✅ Ba ca ba hình dạng giống nhau → planner ổn định.
- ❌ Ca này hai file, ca kia nhét bảng vào cuối bản dịch → **ghi nhận**. Đây là lỗi đã gặp thật ngày 20/08 với câu yêu cầu mơ hồ hơn, và là lý do bước 4 phải nói "một file RIÊNG".

Đường dẫn có dạng `artifacts/<plan_id>/T-01/vi/doc-1.md`: phần `vi/` là **thư mục bạn đặt**, được giữ nguyên; hai lớp trước nó là khung theo ca để lần chạy sau không đè lên lần này (`outputScoper`, 20/08).

### Vòng B — chốt luật rồi đo lại

**Bước 7.** 🖱 chat — **không giao việc**, chỉ nói chuyện. Chốt cách dịch 5–10 thuật ngữ bạn thấy ba bản trên dịch mỗi bản một kiểu:

```
Từ giờ trong văn phòng này: workspace = không gian làm việc,
credentials = thông tin đăng nhập, toggle = công tắc gạt.
Giữ nguyên viết tắt trong ngoặc: SSO, MFA, IdP.
```

**Bước 8.** 🖱 gõ `/clear`.

**Bước 9 — kiểm.** 🖱 Mở panel **Tri thức**. Phải có **một node `GHI NHỚ` trọng số 0.9** chứa đúng những luật bạn vừa chốt.

- ✅ Có → đây là đường vào tri thức **đúng đắn** còn lại: thứ *người dùng* chốt, không phải thứ model nghe kể lại rồi tự diễn giải.
- ❌ Không có → `compactMemory` trả về `KHÔNG`, hoặc lỗi nén. Ghi nhận.

**Bước 10.** Dịch file 4 và 5, cùng câu lệnh ở bước 4.

**Bước 11 — ĐO:** chọn 10 thuật ngữ xuất hiện ở nhiều file. Đếm mỗi thuật ngữ được dịch bằng **mấy cách khác nhau**.

| So sánh | Ý nghĩa |
|---|---|
| File 4–5 nhất quán hơn file 1–3 | ✅ node `GHI NHỚ` đang vào prefix và có tác dụng thật |
| Không khá hơn | ❌ HOT không kéo node đó vào, hoặc nội dung node quá mờ. Cũng là kết quả có ích |

### Đường thứ hai — và nó rẻ hơn

Thay vì bước 7–8, viết một file `glossary.md` rồi 🖱 thả vào **Tủ tài liệu**. Khác biệt về cái giá, và đây là thứ bài test này thật sự dạy:

| | vào đâu | trả tiền khi nào |
|---|---|---|
| Node `GHI NHỚ` | **prefix** của Trợ lý | **mọi lượt trò chuyện**, mãi mãi |
| `glossary.md` trong tủ | bảng kê + `Grep` của nhân viên | chỉ lúc nhân viên thật sự mở nó |

Luật ngắn, ít, ổn định → node tri thức. Bảng 200 dòng → tủ tài liệu. Nhét bảng 200 dòng vào tri thức là trả tiền cho nó ở mỗi câu "chào bạn".

**Chi phí:** ~$0.10/file · vòng B thêm ~$0.02 cho lượt nén ở `/clear`

---

## Bài 5b — Làm tiếp trên kết quả cũ ✅ *không cần gõ tay* · 🆕 **MỚI 20/08**

> **Vì sao có bài này.** Đây là thao tác tự nhiên nhất của cả sản phẩm — *"làm tiếp cái vừa xong"* — và nó là thao tác **hỏng nặng nhất** khi được thử lần đầu. Ghi lại nguyên văn để bài test có mỏ neo:
>
> Người dùng gõ *"doc-2, doc-3 thiếu file thuật ngữ"*. **Bốn lượt** qua lại: Trợ lý bảo họ đi kiểm đường dẫn (bắt con người làm việc máy làm hết 1ms) → họ nói *"files chưa xuất hiện"* → một lượt lập kế hoạch **chết hẳn** vì Trợ lý hỏi *"bản dịch tiếng Việt nằm ở đường dẫn nào?"* mà câu hỏi lại không phải hình dạng hợp lệ → cuối cùng **người dùng phải tự nghĩ ra giải pháp**: *"thì bạn phải kêu người dịch tạo bổ sung đi chứ"*.
>
> Rồi ca chạy được, và **kết quả SAI**: `inputs` trỏ vào bản gốc tiếng Anh nên bảng thuật ngữ ghi `Widget → "Tiện ích (widget)"` trong khi bản dịch dùng `Widget` nguyên văn. Một tài liệu ghi lại những lựa chọn **chưa từng được thực hiện**, nhìn rất chuyên nghiệp.
>
> Ba bản vá 20/08 nhắm đúng ba chỗ đó: **bảng kê kết quả** trong prefix Trợ lý, **quyền hỏi lại** cho khâu lập kế hoạch, và **nút Chép + `@đường-dẫn`** để người dùng chỉ đích danh. Bài này đo cả ba.

Chạy **tiếp ngay sau Bài 5**, cùng văn phòng `Bản địa hoá`, không tạo văn phòng mới.

**Bước 1 — đo bằng cách KHÔNG chỉ đường.** 🖱 chat, cố tình nói mơ hồ như lần đầu:

```
doc-2 thiếu bảng thuật ngữ
```

| Quan sát | Nghĩa là |
|---|---|
| Trợ lý **tự tìm ra** bản dịch cũ và giao việc luôn | ✅ bảng kê kết quả đang hoạt động |
| Trợ lý **hỏi lại một câu rõ ràng** (*"bạn muốn đối chiếu với bản dịch nào?"*) | ✅ chấp nhận được — cửa `ask` chạy đúng, ca hiện **`đang chờ bạn trả lời`** màu vàng ở Nhật ký, **không phải `hỏng` màu đỏ** |
| Hiện *"Mình chưa chia được việc này. Thay vì một kế hoạch, Trợ lý nói: …"* | ❌ nó phá giao thức. **Ghi nhận**, và xem `.state/plan-failure.log` để biết nguyên văn |
| Bảo bạn đi kiểm một đường dẫn | ❌ luật *"đừng bắt con người làm mắt cho mình"* không ăn. **Ghi nhận** |

**Bước 2 — chỉ đích danh bằng nút Chép.**

🖱 Mở ngăn **Kết quả** → tìm bản dịch `doc-2.md` của Bài 5 → bấm nút **Chép** (icon 📋) cạnh tên file. Nó chép một chuỗi dạng:

```
@artifacts/P-260820-0314-rab5/T-01/doc-2.md
```

🖱 Về ô chat, dán vào và gõ tiếp:

```
Đối chiếu @artifacts/…/doc-2.md với bản gốc @library/files/doc-2.md,
ghi bảng thuật ngữ ĐÚNG NHƯ ĐÃ DỊCH ra artifacts/vi/doc-2-thuat-ngu.md
```

*(Dán bằng nút Chép cả hai, đừng gõ tay — cả điểm của nút đó là bạn không phải gõ.)*

**Bước 3 — kiểm ba thứ, theo thứ tự tăng dần độ khó:**

| # | Kiểm | Đạt khi |
|---|---|---|
| 1 | Nhật ký công việc → mở ca vừa chạy → xem `inputs` | có **cả hai** đường dẫn bạn dán, **không** có đường dẫn nào khác |
| 2 | Mở file thuật ngữ mới sinh | mỗi dòng khớp với **bản dịch thật**, không phải một cách dịch nghe hợp lý |
| 3 | Tìm `Widget` trong cả hai file | bảng ghi đúng thứ bản dịch dùng. Lệch = **lỗi gốc chưa chết**, ghi nhận |

**Bước 4 — thử hai cách gõ sai. Cả hai phải bị chặn bằng CODE, 0 token, trả lời tức thì:**

| Gõ | Phải nhận |
|---|---|
| `@doc-2.md` (tên trần, trùng ở hai kho) | *"Có 2 file tên doc-2.md, mình không đoán bạn muốn cái nào:"* + liệt kê đủ hai đường dẫn |
| `@library/files/doc-9.md` (không có thật) | *"Mình không tìm thấy … trong tủ tài liệu hay ngăn Kết quả"* |

> ⚠ **Hai câu trên** phải hiện **ngay lập tức** (dưới 100ms) và tốn **$0**. Nếu có độ trễ vài giây thì chúng đã đi qua model — sai chỗ, và đang tốn tiền cho một việc chỉ là tra danh sách.

**Bước 4b — phép thử NGƯỢC LẠI: `@` mà KHÔNG phải tham chiếu file.**

🖱 chat: `gửi cho ke-toan@congty.vn`

| Quan sát | Nghĩa là |
|---|---|
| **Không** có câu nào kiểu *"mình không tìm thấy `congty.vn`"* | ✅ tầng tham chiếu đứng yên đúng lúc phải đứng yên |
| Trợ lý trả lời như một tin nhắn bình thường (*"mình không gửi email được, bạn tải file rồi tự gửi nhé"*) | ✅ **đúng, và nó ĐƯỢC PHÉP tốn vài giây + một lượt tiền** |

> ⚠ **Đừng đo dòng này bằng 100ms/0 token** — bảng trên từng gộp nó vào chung với hai ca kia, và đó là một kỳ vọng sai đã ghi vào tài liệu (sửa 20/08).
>
> Hai ca kia là tầng tham chiếu **NÓI**: có một câu trả lời dựng bằng code, nên nó phải tức thì. Ca này là tầng tham chiếu **IM**: một địa chỉ email không phải đường dẫn, nên không có gì để chặn cả — và câu còn lại là một tin nhắn người dùng gửi cho Trợ lý, y như mọi tin nhắn khác. Bắt nó rẻ và tức thì nghĩa là bắt Trợ lý **đừng trả lời**, mà im lặng thì mới là hỏng.
>
> Thứ duy nhất bài này đo được là **tầng tham chiếu không nhận nhầm**. Nó có test tự động rồi (`test/refs.test.ts`, ca *"email KHÔNG bị coi là tham chiếu file"*), nên ở đây chỉ cần liếc xem có câu lỗi lạ nào chen vào không.

**Bước 5 — đường dẫn trong câu báo kết quả phải BẤM ĐƯỢC.** 🖱 Bấm vào một dòng trong khối *"Kết quả đã lưu tại:"* → panel Kết quả mở ra kèm cửa sổ xem trước đúng file đó. Không phải mò vào thư mục trên máy.

**Chi phí:** ~$0.05 – $0.10 · bước 4 tốn **$0** · bước 4b là một lượt trò chuyện bình thường (~$0.005)

---

## Bài 5c — Trí nhớ qua `/clear` ✅ *không cần gõ tay* · 🆕 **MỚI 20/08**

> **Vì sao có bài này.** `/clear` là lệnh **ghi đè**, không phải append: bản nén mới `supersedes` toàn bộ bản ghi nhớ đang sống, và bản cũ **bị xoá hẳn khỏi đĩa** (quyết định có chủ ý — giữ lại thì ngăn kéo Tri thức đầy bản trùng và người dùng hoang mang). Nghĩa là **không có lưới an toàn nào**: thứ gì bản nén mới không viết lại thì mất vĩnh viễn.
>
> Khối GHI NHỚ cũng **cố ý đứng ngoài cả ba cơ chế** của kho tri thức — không xếp hạng HOT, không khớp COLD, không lão hoá 15 ngày. Với kinh nghiệm agent tự sinh thì hai node mâu thuẫn được `hits` + cửa sổ 15 ngày phân xử dần; với GHI NHỚ thì **không có tầng phân xử nào cả**. Chữ trong khối đó *là* sự thật, nguyên văn, cho tới lần `/clear` sau.
>
> Nên toàn bộ trách nhiệm nằm ở **ba luật trong prompt nén**, và bài này đo đúng ba luật đó. Nó rẻ (chỉ lượt Trợ lý, không đụng nhân viên nào) nhưng là bài đo thứ **đắt nhất khi hỏng** — mất một quyết định đã chốt thì không token nào mua lại được.

Chạy ở bất kỳ văn phòng nào **đang rảnh** (`/clear` bị chặn khi có việc chạy dở). Dùng `Bản địa hoá` cho tiện.

**Xem kết quả ở đâu:** 🖱 bảng chi tiết Trợ lý → **prompt phân lớp** → lớp **"Ghi nhớ từ trò chuyện"**. Đó là **nguyên văn** thứ đi vào prefix — chính xác hơn ngăn kéo Tri thức, vì nó là chuỗi model thật sự đọc.

### Vòng A — chốt điều thứ nhất

🖱 chat:
```
Từ giờ mọi bản dịch giữ NGUYÊN tên sản phẩm tiếng Anh, đừng Việt hoá.
```
🖱 chat: `/clear`

| Quan sát | Nghĩa là |
|---|---|
| Dòng trạng thái *"Đang dọn cuộc trò chuyện…"* hiện **suốt** lượt nén | ✅ nó là TRẠNG THÁI, không phải câu có hẹn giờ |
| Lớp *"Ghi nhớ từ trò chuyện"* có một dòng về tên sản phẩm | ✅ nén chạy |
| Ô chat **trắng, không còn tin nhắn nào** — kể cả "đã dọn xong" | ✅ đúng §4.6 |

### Vòng B — chốt điều thứ hai, **KHÔNG nhắc lại điều thứ nhất** → đo **luật ①**

🖱 chat:
```
Báo cáo cho mình thì viết ngắn thôi, tối đa 5 dòng.
```
🖱 chat: `/clear`

| Quan sát | Nghĩa là |
|---|---|
| Khối GHI NHỚ có **CẢ HAI** dòng | ✅ **luật ① chạy** — chép lại mục cũ còn đúng |
| Chỉ còn dòng về báo cáo ngắn, dòng tên sản phẩm **biến mất** | ❌ **luật ① hỏng** — đây đúng là bug 20/08 tái phát. Ghi nhận, dán lại nguyên văn khối GHI NHỚ vào ghi chú phiên |

> ⚠ Đây là bước quan trọng nhất của cả bài. Cái hỏng ở đây **im lặng**: không lỗi, không cảnh báo, chỉ là một quyết định của bạn lặng lẽ không còn.

### Vòng C — **ĐẢO NGƯỢC** điều thứ nhất → đo **luật ②** và **luật ③**

🖱 chat:
```
À thôi đổi ý: tên sản phẩm thì Việt hoá hết, kèm tiếng Anh trong ngoặc.
```
🖱 chat: `/clear`

| # | Kiểm trong khối GHI NHỚ | Đạt khi |
|---|---|---|
| 1 | Đếm số dòng nói về **tên sản phẩm** | **đúng 1** dòng ← luật ② |
| 2 | Dòng đó nói theo ý **nào** | ý **MỚI** (Việt hoá kèm ngoặc). Còn giữ ý cũ = luật ② hỏng |
| 3 | Có dòng nào dạng *"trước đây giữ nguyên, giờ Việt hoá"* không | **không có** ← luật ③. Có = model đang lưu cả lịch sử thay đổi, khối này sẽ phình mãi |
| 4 | Dòng **báo cáo ngắn** còn không | **còn** ← luật ① lần thứ hai, ở một phiên khác |

> ❌ **Ca hỏng tệ nhất** là hai dòng cùng tồn tại: *"giữ nguyên tên tiếng Anh"* **và** *"Việt hoá kèm ngoặc"*. Không có tầng nào phân xử, nên từ đó mọi ca dịch đều là tung đồng xu — và nhật ký sẽ không giải thích được vì sao hai ca giống nhau ra hai kiểu.

### Vòng D — kiểm cơ chế dọn (0 token)

🖱 Mở ngăn kéo **Tri thức** → lọc các node có nhãn `bo-nho`.

| Quan sát | Nghĩa là |
|---|---|
| **Đúng MỘT** node GHI NHỚ | ✅ `supersedes` + `dropSuperseded` chạy đúng — bản cũ đã bị dọn |
| Ba node GHI NHỚ chồng nhau | ❌ quét muộn hoặc chặn nhầm cửa (bug §5e). Ghi nhận |

**Chi phí:** ~$0.03 – $0.06 · vòng D tốn **$0** · **không tiêu một token nhân viên nào**

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

> 🖱 **Nhìn sơ đồ sau MỖI người, đừng bấm "Sắp xếp lại".** Đây là ba người thêm liên tiếp, tức là đúng ca đã đẻ ra bug 20/08.
>
> | Người | Phải nằm ở đâu |
> |---|---|
> | 1 | thẳng dọc **dưới Trợ lý** |
> | 2 | bên **phải** người 1 (số chẵn thì không cân được — đây là lựa chọn bắt buộc) |
> | 3 | bên **TRÁI** người 1, hàng ba người cân lại quanh Trợ lý |
>
> Cả ba dồn về **một phía** = ❌ lỗi 20/08 sống lại (`centeredSlot` không được gọi). Hai người **chồng lên nhau** = ❌ lỗi 16/08 sống lại. Phải bấm "Sắp xếp lại sơ đồ" thì mới đều = ❌ vẫn tính là hỏng — thao tác dọn dẹp đó là việc của hệ thống, không phải của người dùng.

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
| Tài liệu PDF hiện **`sẵn sàng`** kèm số trang, không phải `chưa lập chỉ mục` | ✅ bộ đọc PDF nằm sẵn trong sản phẩm (sửa 20/08 — trước đó nó bảo người dùng tự `npm i pdfjs-dist`) |
| Trợ lý đọc `INDEX.md`, thấy "34 trang", rồi chia **nhiều task theo khoảng** | ✅ lỗ hổng số 4 đã đóng |
| Trợ lý vẫn giao **một task duy nhất** rồi cụt | ❌ tầng định tuyến có mà nó không dùng → cần dặn ở prompt lập kế hoạch. Ghi nhận |
| Nhân viên `Grep` `library/text/` rồi `Read` bản gốc **đúng vài trang** | ✅ mốc trang đang hoạt động (`SPEC-library.md` §3.1) |
| Nhân viên `Read` cả PDF một lần | ❌ với PDF trên 10 trang thì tool **bắt buộc** khai `pages`, nên nhiều khả năng nó sẽ vấp — và đó là kết quả cần ghi |

**Bước 5 — ca hỏng đã sửa 20/08, kiểm lại xem nó có sống lại không.**

Bài này là bài đầu tiên mà một task **không biết trước nó sẽ đẻ ra bao nhiêu file** ("mỗi điều khoản một file" — số file bằng số điều khoản, chỉ biết sau khi đọc). Nên bước sau khai đầu vào là cả một **THƯ MỤC**, và kế hoạch từng bị chặn thẳng:

```
Mình chia việc bị lỗi nên chưa chạy được …
  · Task T-02 cần đọc "artifacts/P-…/T-01/dieu-khoan/" nhưng không có
    file đó, và không việc nào tạo ra nó
```

| Quan sát | Nghĩa là |
|---|---|
| Ca chạy thẳng, Nhật ký hiện *"Đã nối … việc phải chạy nối tiếp"* | ✅ thư mục được hiểu là "sẽ có", `linkDeps` nối T-02 → T-01 |
| Vẫn hiện câu *"không việc nào tạo ra nó"* cho một thư mục | ❌ **ghi nhận** — lỗi 20/08 sống lại |
| Câu báo lỗi (nếu có) nói *"chưa tốn tiền cho việc nào cả"* | ❌ **ghi nhận, đây là câu nói dối** — lượt chia việc đã vào sổ chi phí. Câu đúng là *"chưa nhân viên nào bắt tay vào"* |

---

### 🔴 Bước 6 — DỪNG SỚM: bước đầu hỏng thì các bước sau **không được chạy**

> **Vì sao có bước này.** Đo thật 20/08 tối, ca `P-260820-2219-5ltb`: T-01 trả `blocked` lúc **22:20:21**, và T-02 được phóng lúc **22:20:21** — cùng một giây. Rồi T-03. Cả hai đi tìm những file mà hệ thống đã biết chắc là không tồn tại.
>
> T-02 còn tự chẩn đoán đúng, **bằng tiền của bạn**: *"Thư mục artifacts/…/T-01/dieu-khoan/ không tồn tại và toàn bộ thư mục artifacts đều trống."* Hệ thống đã biết điều đó 0 giây trước, miễn phí.

Ca này dựng được **cố ý và rẻ**: cho bước đầu một đầu vào chắc chắn hỏng.

🖱 Thả một file `.docx` vào tủ, rồi chat:

```
Đọc hd1.docx, tách theo điều khoản, soi từng điều rồi gộp thành checklist
```

*(hoặc bất kỳ chuỗi 3 bước nào mà bước đầu sẽ `blocked`)*

| Quan sát trong **Nhật ký** | Nghĩa là |
|---|---|
| T-01 hỏng → T-02 và T-03 hiện **`không làm được vì bước trước chưa xong`**, **0 lượt, $0** | ✅ lan truyền chặn chạy đúng |
| T-02 khởi động **cùng giây** T-01 báo hỏng | ❌ **lỗi 20/08 tối**: `blocked` đang bị tính là "phụ thuộc đã xong". `Scheduler.run` lan truyền theo `failed`, mà `blocked` không vào `failed` |
| T-02/T-03 chạy rồi tự nói *"chưa có file nào từ bước trước"* | ❌ cùng lỗi trên — và đây là bản đắt tiền của nó |
| Có task nào chạm `max_turns` khi chỉ đi tìm file không có | ❌ nhân viên thiếu input phải trả `blocked` **ngay lần đọc hỏng đầu tiên**, không dò tới hết lượt |

> ⚠ **Kiểm luôn SỔ CHI PHÍ ở bước này** — 🖱 Tổng quan → chi phí ca vừa chạy. Ca đo được có một task chạy 9 lượt tool trong 29 giây mà sổ ghi **$0**: nhánh `max_turns` ở `worker.ts` ném lỗi và **vứt mất biến `usage`** đã cộng dồn (nhánh bị ngắt ngay bên trên thì truyền đúng). Task nào có lượt tool trong log mà $0 trong sổ = ❌ **ghi nhận, tiền đang biến mất**.

> ⚠⚠ **Và đọc kỹ câu cuối Trợ lý nói với bạn.** Ca đo được trả về: *"cần bạn xuất/chuyển hợp đồng này sang PDF hoặc file văn bản rồi gửi lại"* — trong khi `library/text/hd1.docx.txt` **đã nằm sẵn trên đĩa từ lúc thả file**. Bất kỳ câu nào bảo bạn làm bằng tay một việc hệ thống đã làm xong = ❌ ghi nhận.

---

### 🔴 Bước 7 — CHẠY LẠI: việc đã xong có được tận dụng không?

> **Vì sao có bước này.** Hôm nay câu trả lời là **KHÔNG**, và bài test tồn tại để đo lúc nào nó thành **có**. Mỗi lần chạy sinh `plan_id` mới → `artifacts/<plan-mới>/T-01/` rỗng → mọi bước làm lại từ đầu, trả tiền lại. Việc đã xong nằm **mồ côi** trong thư mục của ca cũ. `agentco resume` chưa tồn tại (§4 nợ #2).

**Bước 7a — dựng ca "xong một nửa".** Cho hai bước đầu chạy được, bước ba hỏng. Cách rẻ nhất: hạ `max_turns` của `Người gộp` xuống `2` trong `roles/nguoi-gop.yaml`, rồi chạy bài 6 với một `.md` hoặc `.txt` đọc được.

🖱 Xác nhận trạng thái mong muốn: T-01 ✅ · T-02 ✅ · T-03 ❌. Ghi lại **chi phí ca** và **đường dẫn `artifacts/<plan_id>/`**.

**Bước 7b — trả `max_turns` về cũ, rồi gõ LẠI đúng câu vừa rồi.**

| Quan sát | Nghĩa là |
|---|---|
| Bảng kê Trợ lý ghi ca đó là **`UNFINISHED (2/3 steps)`** | ✅ việc dở hiện ra như một đầu vào bình thường (§6b ①) |
| Trợ lý **dùng lại** 2 file cũ, chỉ giao lại bước 3 | ✅ đúng mục tiêu — và nó **tự quyết**, không có nút nào cả |
| **Cả ba** chạy lại từ đầu, `plan_id` mới, thư mục kết quả mới | 🟡 ghi lại con số: bao nhiêu $ trả lại cho việc đã nằm trên đĩa |
| Kết quả cũ bị **ghi đè** hoặc biến mất | ❌ nghiêm trọng — khung `artifacts/<plan_id>/` sinh ra chính để chặn cái này |

**Bước 7c — nhãn ÔI phải bật lên khi nguồn đổi.** 🖱 Thả đè một bản `.docx` mới cùng tên vào tủ (hoặc sửa file gốc), rồi mở lại bảng chi tiết Trợ lý → lớp bảng kê kết quả.

| Quan sát | Nghĩa là |
|---|---|
| File cũ mang nhãn **`(STALE — its source changed…)`** | ✅ so `mtime` chạy đúng |
| Không có nhãn nào | ❌ ghi nhận — đây là chốt DUY NHẤT ngăn một checklist nói về hợp đồng đã bị thay |
| Nhãn ôi bật lên cho **cả file vừa mới sinh** | ❌ so `>=` thay vì `>`. Nhãn kêu bừa thì người dùng học cách bỏ qua nó |

**Bước 7d — `/resume` cho ca bị NGẮT (đường thứ hai, khác hẳn 7a–7b).** 🖱 Chạy một ca 3 bước, gõ `/stop` giữa chừng. Rồi gõ `/status`.

| Quan sát | Nghĩa là |
|---|---|
| `/status` nói *"còn N việc dở… gõ /resume"* | ✅ ca dở là **trạng thái**, không phải một thông báo đã trôi qua |
| Mở lại tab / bật lại daemon → có một dòng **mời** chạy tiếp trong chat | ✅ phát ở `bindBus`, và `chat.jsonl` giữ lại |
| Ca tự chạy tiếp mà không hỏi | ❌ **nghiêm trọng** — bạn vừa gõ `/stop`, tự chạy tiếp là ghi đè quyết định đó |
| `/resume` → **0 lượt lập kế hoạch**, kết quả rơi vào ĐÚNG thư mục `artifacts/<plan_id>/` cũ | ✅ cả hai chốt của §6b ② |

> ⚠ **Đừng trông chờ 7a–7b dựng được ca "xong một nửa" dễ dàng.** Tính tới 21/08 **chưa từng quan sát được** một ca chạy được vài bước rồi hỏng ở bước sau — mọi ca hỏng đều chết ở bước một. Con số "% hoá đơn trả lại" vẫn là **phỏng đoán**, và bài này tồn tại để biến nó thành số đo.

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

**Bước 3.** 🖱 Viết tiêu chí vào **Giới thiệu văn phòng** — bấm đúp node Trợ lý → bảng prompt phân lớp → lớp *Giới thiệu văn phòng* → sửa tại chỗ. *(Từ 17/08 nó là `charter.md` ở gốc văn phòng, markdown thuần, và không còn là node trong kho tri thức — `SPEC-library.md` §17.)*

```markdown
Tuyển: Nhân viên nội dung, 1–3 năm kinh nghiệm.
Chấm 4 mục, mỗi mục 0–5: kinh nghiệm viết · sản phẩm đã làm · tiếng Anh · độ phù hợp văn hoá.
Loại thẳng nếu không có sản phẩm nào kèm theo.
```

Giữ dưới 500 token — khối này nằm trong prefix của mọi nhân viên.

Bài này giờ **không cần mở editor nữa**: cả tiêu chí lẫn 20 CV đều vào bằng giao diện.

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
| 5b Làm tiếp kết quả cũ | | | | | `inputs` có đúng hai đường dẫn đã dán không? |
| 5c Trí nhớ qua `/clear` | | | | | **luật ① mục cũ còn không · ② một dòng theo ý MỚI · ③ không có "trước đây X giờ Y"** |
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
