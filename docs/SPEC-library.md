# SPEC — Tủ tài liệu: file của người dùng, tách khỏi kho tri thức

**Chốt 17/08/2026.** Đọc kèm `SPEC-token-economy.md` (luật cao nhất), `SPEC-offices.md` §2 (bố cục thư mục), phụ lục `SPEC-connectors.md` (hướng tìm kiếm — spec này *thi hành* nó).

---

## 0. Một câu

> **Kho tri thức là những câu ngắn hệ thống ĐÃ HỌC. Tủ tài liệu là file NGƯỜI DÙNG ĐƯA VÀO.**
> Cái thứ nhất nằm trong prefix và trả tiền mỗi lượt. Cái thứ hai không bao giờ vào prefix và với tới bằng `Glob`/`Grep`.

---

## 1. Vì sao tách ở tầng LƯU TRỮ, dù luật chung nói tách ở tầng hiển thị rẻ hơn

Luật §5e (`SESSIONS_MEMORY`): *tách hiển thị rẻ, tách lưu trữ đắt → nghi ngờ thì tách chỗ rẻ*. Đây là **ngoại lệ**, và lý do phải ghi ra để lần sau không ai gộp lại:

| | Kho tri thức | Tủ tài liệu |
|---|---|---|
| Ai sinh ra | agent tự rút ra (+ người dùng sửa/xoá) | **chỉ người dùng** |
| Vào prompt prefix? | **CÓ** — mỗi lượt, mỗi worker | **KHÔNG BAO GIỜ** |
| Đơn vị | node ~250 token, một file `.md` | tài liệu, tính bằng MB |
| Vòng đời tự động | `supersedes` · `hits` · `last_used` · prune 15 ngày | **không có** |
| Truy xuất | chấm điểm từ khoá (`KnowledgeStore.hot/cold`) | `Glob`/`Grep` trên đĩa |
| Xoá nhầm thì sao | mất một bài học agent tự rút ra | **mất file của khách** |

Dùng chung tầng lưu trữ nghĩa là một ngày nào đó `pruneStale` xoá hợp đồng của khách vì nó "15 ngày không dính việc nào". Hai vòng đời không tương thích được.

**Cấp VĂN PHÒNG, không phải cấp công ty.** Tài liệu không vào prefix nên về kỹ thuật cấp công ty làm được — nhưng nó phá bất biến *"văn phòng tự chứa, zip lại là một template chạy được ở máy khác"* (`SPEC-offices.md` §2).

**Và chỉ tách MỘT lần này.** Không có kho thứ ba.

---

## 2. Bố cục thư mục

```
offices/<mã>/
  library/
    files/           ← BẢN GỐC người dùng đưa vào. Giao diện hiện đúng thư mục này, 1:1
    text/            ← văn bản đã bóc:  <tên gốc>.txt
    INDEX.md         ← tầng định tuyến, dựng bằng CODE, 0 token (§8)
    catalog.json     ← trạng thái từng tài liệu
  artifacts/         ← KHÔNG ĐỔI: nơi agent GHI RA
  knowledge/         ← KHÔNG ĐỔI: node tri thức
```

### 2.1 ⚠ Vì sao KHÔNG giấu vào `.state/` — đã kiểm bằng lệnh thật

Ý định tự nhiên là nhét `text/` và `catalog.json` vào `.state/` cho khuất mắt. **Làm thế là cơ chế truy xuất chết im lặng:** `Grep` dựng trên ripgrep, và ripgrep **bỏ qua mọi thư mục bắt đầu bằng dấu chấm** khi duyệt xuống.

Đo ngày 17/08:

```
Grep "pid|port"  path=company/         → 4 file, KHÔNG có .state/daemon.json
Grep "."         path=company/.state/  → tìm thấy (vì là gốc tìm kiếm, không phải duyệt xuống)
```

Kèm một tin tốt cũng đã kiểm: **`.gitignore` KHÔNG chặn `Grep`**. `company/` bị gitignore mà `Grep` vẫn thấy đủ file. Chỉ có một cái bẫy, và nó nằm ở dấu chấm.

> **Luật rút ra: thứ gì agent phải `Grep` thấy thì tên thư mục KHÔNG được bắt đầu bằng dấu chấm.**

### 2.2 Vì sao `library/` tách khỏi `artifacts/`

- Lẫn vào nhau thì "xoá hết tài liệu" ăn luôn kết quả agent đã trả tiền để làm ra.
- Danh sách 1:1 sẽ nhấp nháy theo mỗi lần agent ghi file.
- `artifacts/` là **đầu ra**, `library/files/` là **đầu vào**. Trộn hai chiều dữ liệu vào một thư mục là chỗ mọi thứ bắt đầu rối.

### 2.3 Tên sidecar giữ nguyên tên gốc

`library/text/Hợp đồng ABC.pdf.txt` — **không** băm, **không** slug. Kết quả `Grep` tự nói ra nó thuộc tài liệu nào; model không phải tra bảng, người dùng không phải đoán.

---

## 3. PDF: bóc text KHÔNG phải để thay việc đọc — để đọc ĐÚNG CHỖ

Đây là mục dễ quyết sai nhất, vì tiền đề *"model đọc PDF rất tốt rồi"* **đúng**.

Nhưng model đọc PDF bằng cách **nhìn từng trang như một tấm ảnh**, và ràng buộc của tool `Read` nói hết:

> PDF đọc qua tham số `pages` (vd `"1-5"`), **tối đa 20 trang mỗi lần**, và **bắt buộc khai `pages` nếu PDF trên 10 trang**.

Tức là với hợp đồng 34 trang, agent **không thể** gõ "đọc file này" — nó **buộc phải biết trước cần trang nào**. Với sách 300 trang thì càng không. Đây không phải chuyện rẻ hay đắt, mà là chuyện làm được hay không.

| | Bóc text lúc nạp | `Read` thẳng bản gốc |
|---|---|---|
| Chi phí LLM | **0 token, một lần, mãi mãi** (code thuần) | trả token **mỗi task, mỗi lần** — trang vào dạng ảnh nên đắt hơn text nhiều |
| Sách 300 trang | `Grep` ra đúng 200 dòng cần | 15 lần gọi — không ai làm |
| Bảng biểu, nhiều cột | **hỏng** — text bóc ra lộn cột | **đúng** — model thấy bố cục |
| Biểu đồ, hình vẽ | mất sạch | đọc được |
| **PDF scan** | **ra rỗng** | **đọc được — model tự OCR** |

Hai cột **không đối nhau, chúng bù nhau**:

> **Text đã bóc dùng để TÌM. Bản gốc dùng để ĐỌC KỸ trang đã tìm ra.**

### 3.1 Cơ chế nối hai thứ: mốc trang

File text của PDF **phải** cắm mốc trang:

```
--- trang 12 ---
Điều 7. Bên B chịu mọi chi phí phát sinh...
```

Grep trúng dòng → tra mốc gần nhất phía trên → `Read(hop-dong.pdf, pages="12-14")`. **3 trang thay vì 34.** Đây là "lấy chunk thay vì tải cả file" mà không cần chunk thủ công gì cả — và không cần một cơ chế chia đoạn thứ hai phải đồng bộ với cơ chế thứ nhất.

### 3.2 PDF scan KHÔNG phải lỗi

Bản nháp đầu của spec này ghi PDF scan là `failed` kèm câu *"cần OCR — chưa hỗ trợ"*. **Sai, đã sửa.** Model OCR được. Trạng thái đúng:

| state | Nghĩa | Nhãn cho người dùng |
|---|---|---|
| `ready` | có lớp chữ, bóc xong | (không nhãn) |
| `image-only` | scan / ảnh chụp, bóc ra ~0 chữ | *"Bản chụp — tìm bằng từ khoá không ra. Nhân viên phải đọc từng trang nên tốn hơn."* |
| `failed` | file hỏng, có mật khẩu, sai định dạng | đỏ + cách xử lý |

Phát hiện bằng **code, 0 token**: `số ký tự bóc được / số trang < 50` → `image-only`.

`.pdf` là định dạng **duy nhất** mà bản gốc vẫn là công dân hạng nhất. `.docx`/`.xlsx`/`.pptx` thì agent không đọc nổi bản gốc, chỉ còn file text.

---

## 4. Định dạng nhận và không nhận

**Không ảnh, không video — và lý do không phải là lười:** cả cơ chế truy xuất là grep. Thứ không thành text được thì **không có đường nào tìm thấy**. Ảnh còn tệ hơn: nó vào model dạng image block, đắt, và trả tiền lại từ đầu ở mỗi task.

| Nhóm | Đuôi | Xử lý |
|---|---|---|
| Text sẵn | `.md` `.txt` `.csv` `.json` `.yaml` `.yml` | không convert, `Grep` thẳng bản gốc |
| Bóc lúc nạp (ZIP+XML, 0 phụ thuộc) | `.docx` `.xlsx` `.pptx` | → `library/text/` |
| Bóc lúc nạp (cần thư viện) | `.pdf` | → `library/text/` **có mốc trang**, bản gốc vẫn đọc được |
| **Chặn**, kèm câu giải thích | ảnh · video · audio · `.zip` · `.exe` · `.doc` `.xls` (nhị phân cũ, parser khác hẳn) | |

`.csv` **bắt buộc có** — bài 3 và bài 7 của `TEST-WALKTHROUGH` sống bằng nó.
`.zip` nói không thẳng: giải nén đẻ ra đệ quy, zip bomb, và path traversal trong tên mục.

### 4.1 Hai chốt bắt buộc khi nhận file

**a. Kiểm magic bytes, không chỉ đuôi.** Đổi tên `.exe` thành `.pdf` mất 2 giây. Với đuôi text-native thì kiểm ngược lại: chặn nếu có byte NUL trong 8KB đầu (dấu hiệu file nhị phân đội lốt `.txt`).

**b. Làm sạch tên file — và đây là chỗ Windows sẽ cắn.**

- chặn `..`, `/`, `\`, byte NUL, ký tự điều khiển
- chặn **tên cấm của Windows**: `CON` `PRN` `AUX` `NUL` `COM1`–`COM9` `LPT1`–`LPT9` (kể cả khi có đuôi: `CON.txt`)
- chặn tên kết thúc bằng dấu chấm hoặc khoảng trắng (Windows lặng lẽ cắt đi → tên trong catalog khác tên trên đĩa)
- **KHÔNG slugify.** Người dùng phải nhận ra file của mình. Tiếng Việt có dấu trong tên file là hợp lệ trên NTFS và ext4.

---

## 5. Giới hạn kích thước

**Số thật, để không phải đoán lại:**

| | Dung lượng |
|---|---|
| Sách 300 trang, PDF có lớp chữ | **1–5 MB** |
| PDF nhiều hình (catalogue, slide xuất ra) | 20–100 MB |
| Sách **scan** | 50–200 MB — và bóc ra 0 chữ |

→ **Trần 50 MB/file**, khai trong `company.yaml`. Trên mức đó gần như chắc chắn là bản scan.

**Nhưng trần đáng lo không phải MB — là số token sau khi bóc.** PDF 3MB có thể ra 800K token. `Grep` không sao; vấn đề là nếu nhân viên `Read` cả file thì nổ ngữ cảnh và chạm `max_turns`.

Cách xử lý, theo đúng luật *"thứ gì quan sát được thì đừng hỏi model"* và *"kế toán token là việc của người đứng ngoài đếm"*:

- ghi `tokens` (ước lượng) vào `catalog.json`
- **hiện cho NGƯỜI DÙNG** trong tủ: *"tài liệu này rất dài"*
- **KHÔNG** nhét lời dặn vào prompt — đó là token thu phí vĩnh viễn để mua một hành vi bất định
- **không chunk thủ công**: `Read` có `offset`/`limit` và tự cắt ở 2000 dòng, nó thoái hoá êm. Mốc trang (§3.1) đã lo phần định vị.

Không có trần tổng cho cả tủ ở v1. Nói thẳng ra đây để lần sau không ai tưởng là sót.

---

## 6. Chỉ THÊM và XOÁ. Không có editor.

**Không editor** — và lý do mạnh hơn "chưa làm kịp": có editor là ôm luôn câu chuyện xung đột · undo · **giữ định dạng**. Không ai sửa được `.docx` trong một `<textarea>` mà không phá nó. *"Muốn sửa thì sửa ngoài rồi thả lại đè lên"* là đúng và miễn phí.

**Trùng tên → hỏi lại, có nút Thay thế.** Kèm một chốt bắt buộc, vì đây đúng lớp bug §8 *"ghi một đằng đọc một nẻo"*:

> **Thay file thì phải XOÁ sidecar cũ TRƯỚC, rồi mới bóc lại.**

Sidecar cũ còn nằm đó là `Grep` tìm thấy nội dung của bản đã bị thay — im lặng, mãi mãi, và người dùng thấy hệ thống trích dẫn một câu không còn tồn tại trong file họ đang mở. Giữ nguyên tên file để mọi thứ đang trỏ tới nó không đứt.

**Xoá: MỘT mức, xoá hẳn, có hỏi lại kèm tên file.** (Người dùng chốt 17/08.)

Luật chung *"Xoá luôn có HAI mức: Lưu trữ · Xoá hẳn"* **cố ý không áp dụng ở đây**, và phải ghi lý do ra để lần sau không ai "sửa cho nhất quán":

- tài liệu là file của **chính người dùng**, bản gốc còn trên máy họ — họ vừa tải nó lên
- mức "lưu trữ" đẻ ra **một kho thứ hai cũng cần dọn**, đúng thứ comment trong `store.ts` đã cảnh báo
- và nó kéo theo một câu hỏi không có câu trả lời tốt: *file đã cất thì còn `Grep` thấy không?* (phải là KHÔNG — nghĩa là phải di chuyển cả sidecar, tức là hai chỗ phải đồng bộ)

---

## 7. Kho tri thức: KHÔNG cho thêm node

Bất biến mới, và nó là nửa còn lại của việc tách:

> **Node tri thức là điều hệ thống ĐÃ HỌC, không phải chỗ người dùng gõ vào.**

Cho người dùng gõ node thẳng vào kho là biến kho tri thức thành một tủ tài liệu thứ hai, tệ hơn — không có vòng đời phù hợp, mà lại nằm trong prefix.

Người dùng vẫn có **ba cửa** để đưa kiến thức vào, không cửa nào là "tự viết file node":

| Cửa | Đi vào đâu | confidence |
|---|---|---|
| **Charter** (sửa được trên UI) | node `pinned`, trong prefix mọi nhân viên | 1 |
| **Nói với Trợ lý** → `/clear` cô lại | node GHI NHỚ, `knowledge/agents/assistant/` | 0.9 |
| **Tủ tài liệu** | không vào prefix, với tới bằng `Grep` | — |

API `PATCH /knowledge` giữ nguyên: **sửa và xoá, không tạo**. Không có nút "+ Ghi chú".

---

## 8. `INDEX.md` — tầng định tuyến dựng bằng CODE, 0 token

Phụ lục `SPEC-connectors` nói *"để file tải lên sinh ra một node tóm tắt trỏ về file gốc"*. **Đúng ý, sai cách**: tóm tắt bằng LLM là một lượt gọi cho mỗi file — đúng thứ phải tránh.

Dựng bằng code. Mọi cột dưới đây đều **quan sát được**, không hỏi model câu nào:

```markdown
# Tủ tài liệu — 12 tài liệu

| Tên | Loại | Cỡ | ~Token | Mở đầu / cấu trúc |
|---|---|---|---|---|
| Hợp đồng ABC.pdf | pdf, 34 trang | 1.2 MB | 41K | "HỢP ĐỒNG DỊCH VỤ số 07/2026…" |
| Doanh thu Q3.xlsx | 3 sheet | 240 KB | 8K | Sheet: Tháng 7, Tháng 8, Tổng · cột: ngày, mã, doanh thu |
| Sổ tay nhân sự.docx | docx, 18 mục | 90 KB | 12K | "Chương 1. Quy định chung…" |
```

Số trang · tên sheet · tên cột · tiêu đề mục · 40 chữ đầu — code đọc ra hết trong lúc bóc text.

**Ba thứ nó giải cùng lúc:**
1. Trợ lý `Read` **một file nhỏ** thay vì `Glob` mò cả tủ.
2. **Đóng lỗ hổng số 4** (`USE-CASES` — bài 6 "tài liệu dài hơn một task"). Ghi chú cũ nói cần *"một bước `survey` rẻ đo kích thước file trước khi lập kế hoạch"*. `INDEX.md` **chính là bước đó** — 0 token, tất định. Trợ lý biết hợp đồng 34 trang **trước khi** chia việc.
3. Trả lời câu *"file nào đáng mở"* mà phụ lục §3 đã chỉ ra là câu đúng cần trả lời.

`INDEX.md` **không vào prefix**. Nó là một file trên đĩa, agent chủ động đọc khi cần.

---

## 9. Nạp file vào: một đường chính, hai cửa phụ miễn phí

**Đường chính: upload HTTP, kể cả khi cùng một máy.**

*"Cùng laptop thì copy file cho nhanh"* nghe rẻ hơn nhưng không rẻ: trình duyệt **không đưa đường dẫn thật** cho JS, chỉ đưa bytes. Muốn copy-theo-đường-dẫn phải có hộp thoại native, tức Electron/Tauri. Trong khi upload 50MB qua localhost là tức thì. **Một code path, một tập bug, chạy giống hệt trên VPS/docker** — và thoả ràng buộc container của `SPEC-cli` §4 (mount đúng một volume).

Hai cửa phụ **không tốn thêm gì**, vì ta cần quét-lúc-đọc sẵn rồi:

| Cửa | Ai dùng |
|---|---|
| Thả file thẳng vào `library/files/` bằng Explorer / `scp` | máy local, hoặc VPS đã mount |
| `agentco doc add <đường-dẫn>` | VPS chỉ có ssh |

### 9.1 KHÔNG dùng file watcher

Bẫy thật: copy một PDF 200MB thì watcher bắn sự kiện **giữa lúc file đang ghi dở** → bóc ra text cụt → không ai biết, và catalog ghi `ready`.

Thay bằng **quét lại lúc `GET /library`**: `readdir` + so `mtime`/`size` với catalog, vài ms. Cộng cập nhật ngay sau upload. "Realtime" đủ đúng nghĩa 1:1 mà không có ca file dở.

---

## 10. Index/convert: NGẦM, per-file — và đúng MỘT điểm chờ, rất hẹp

**Không bao giờ dừng hệ thống để đợi index.** Nó phá tiêu chí "mượt", phá *"sập một VP không kéo VP khác"*, và phá luật lớn nhất: *không có ngoại lệ nào cần dừng tất cả để áp dụng cấu hình*.

Nhưng có một ca hỏng thật: người dùng thả PDF xong hỏi ngay → chưa bóc xong → agent grep không thấy gì → **trả lời sai mà không ai biết**. Đó là kết cục tệ nhất trong mọi kết cục.

Giải bằng một máy trạng thái per-file:

```
pending → extracting → ready | image-only | failed | unsupported
```

và **đúng một điểm chờ**:

> `office.run()` chờ **chỉ những tài liệu đang `extracting`** (có timeout), không chờ gì khác, không đụng văn phòng khác.

Dòng trạng thái: *"Đang đọc tài liệu Hợp đồng ABC.pdf…"*. Vài dòng code, và nó xoá hẳn ca trả-lời-sai-im-lặng.

### 10.1 Lỗi phải TRÔNG NHƯ lỗi

Theo luật đã chốt sau vụ toast: hiện trên **chính dòng file đó** trong tủ, nền `danger-soft`, và câu chữ phải nói *chuyện gì xảy ra + làm gì tiếp*:

- *"File có mật khẩu — bỏ mật khẩu rồi thả lại."*
- *"File hỏng, hoặc không phải PDF thật dù có đuôi .pdf."*
- *"Bản chụp, không có lớp chữ."* ← `image-only`, **không phải lỗi**, nhãn xám

File lỗi **vẫn nằm trong tủ** (nó là file của người dùng) nhưng dán nhãn không tìm được. Giấu đi là lặp lại đúng lỗi node-bị-đè đã sửa ngày 16/08.

---

## 11. Khoá ngoại / graph: KHÔNG. Chỉ một phép JOIN.

Người dùng tự đặt câu hỏi và tự nghi ngờ đúng chỗ. Chốt: **không xây graph, không để Trợ lý tự ghi id tài liệu vào kho tri thức.**

Lý do mạnh hơn "gọi LLM thì chậm":

> **Node tri thức trỏ tới id tài liệu sẽ thành tham chiếu chết ngay khi người dùng xoá tài liệu** — mà quyền xoá tự do chính là thiết kế ở §6.

Lúc đó prefix của **mọi worker** chứa một con trỏ tới file không tồn tại, và model sẽ đi tìm nó: tốn lượt, mỗi task, im lặng. Muốn chữa thì phải quét cả kho tri thức mỗi lần xoá một file → cơ chế thứ hai phải đồng bộ với cơ chế thứ nhất, mãi mãi.

**Thứ đáng làm thì rẻ và đã gần xong.** Phụ lục §1 nói đúng: cái trực giác gọi là "graph" ở đây thực ra là một **phép join** — `file · plan_id · task_id · role · thời điểm`, một dòng JSONL append lúc receipt về. `receipt.landed` **đã là mảnh đó rồi**. 0 lượt LLM.

Nó trả lời câu người dùng thật sự hỏi — *"file này ở đâu ra, ai tạo, từ việc nào"* — chứ không phải *"file nào nói về X"*, câu mà `Grep` trả lời tốt hơn bất cứ thứ gì ta xây được.

---

## 12. Cấu hình

```yaml
# company.yaml
library:
  max_file_mb: 50
  # Đuôi nhận vào. Bỏ một đuôi khỏi đây là chặn ngay, không cần build lại.
  allow: [md, txt, csv, json, yaml, yml, pdf, docx, xlsx, pptx]
  # Chờ tối đa bao lâu ở điểm chờ §10 trước khi chạy tiếp mà không có text.
  extract_timeout_ms: 30000
```

---

## 13. API

Mọi route dưới `/api/office/:id/library`, đi qua đúng các chốt sẵn có (token · CSRF `Sec-Fetch-Site` · DNS rebinding · `assertLive`).

| | |
|---|---|
| `GET /library` | quét lại + trả `{ docs: [...] }`. Đây là chỗ §9.1 quét, không có watcher |
| `POST /library` | `multipart/form-data`. `409` nếu trùng tên và không có `?replace=1` |
| `DELETE /library?name=<tên>` | xoá hẳn bản gốc + sidecar. Một mức (§6) |
| `GET /library/file?name=<tên>` | tải bản gốc về |

`POST` là **route đầu tiên của hệ thống nhận dữ liệu nhị phân**. Trần `max_file_mb` phải chặn **theo dòng khi đang nhận**, không phải sau khi đã đệm đủ vào RAM — nếu không thì một file 2GB làm sập daemon trước khi tới được câu kiểm tra.

---

## 14. Ảnh hưởng tới `TEST-WALKTHROUGH.md`

Đây là **chỉ số #1** trong bảng ghi kết quả: *"bao nhiêu bài phải mở editor?"*

| Bài | Trước | Sau |
|---|---|---|
| 2 Hỗ trợ khách | 📝 tự viết 5 file node vào `knowledge/shared/` | 🖱 thả 5 file chính sách vào tủ |
| 3 Sổ sách | 📝 tạo `artifacts/input/sao-ke.csv` | 🖱 thả CSV vào tủ |
| 5 Bản địa hoá | 📝 bỏ 3–5 tài liệu vào `artifacts/input/` | 🖱 thả vào tủ |
| 6 Rà hợp đồng | 📝 + **cụt vì không đo được độ dài** | 🖱 thả · `INDEX.md` cho Trợ lý biết 34 trang trước khi chia việc |
| 7 Bảng tính | 📝 CSV 200 dòng | 🖱 thả vào tủ |
| 8 Sàng lọc | 📝 20 CV vào `artifacts/input/cv/` | 🖱 thả 20 file vào tủ |

**Bài 2 đổi đề, không đổi mục đích** (người dùng chốt 17/08): đề bài mới là *"khách hàng thêm file chính sách vào tủ tài liệu"*. Nó chuyển từ đo `KnowledgeStore.cold()` sang đo `Grep` — và đó là thứ đúng hơn cần đo, vì chính sách shop là **tài liệu người dùng sở hữu**, không phải bài học agent tự rút ra.

⚠ Hệ quả phải ghi nhận: sau khi đổi, **không còn bài nào đo chấm điểm từ khoá của `cold()`**. Cần một bài 2b riêng, hoặc chấp nhận rằng `cold()` chỉ được kiểm gián tiếp qua bài 5.

---

## 15. Việc phải KIỂM trước khi hứa với khách

Theo luật *"một bất biến chỉ có thật khi có mã nguồn thi hành nó"*:

| Việc | Trạng thái |
|---|---|
| **Test hàm thuần** (`node --test`) | ✅ **21 test, chạy 0,4s, 0 token.** Bộ test đầu tiên của dự án. Nó bắt được một lỗi thật ngay lần chạy đầu — xem §16 |
| **`Grep` có thấy `library/text/` không** | ✅ **đã kiểm với file thật**: `Grep "nghỉ phép"` trên thư mục văn phòng trả về `library/text/Sổ tay nhân sự.docx.txt`. Nội dung bên trong một `.docx` giờ tìm được bằng từ khoá |
| **Đường từ chối** | ✅ đã kiểm chạy thật cả bảy: ảnh · `../` · tên bắt đầu bằng dấu chấm · `CON.txt` · `.exe` đội lốt `.pdf` · file không phải ZIP đội lốt `.docx` · trùng tên (409) |
| **Đếm lại phụ thuộc** | ✅ `.docx`/`.xlsx`/`.pptx` đọc bằng `node:zlib`, **0 phụ thuộc mới** (dự án vẫn đúng 3: `sdk` `yaml` `zod`). `.pdf` là phụ thuộc **tuỳ chọn** nạp động: chưa cài thì mọi thứ khác vẫn chạy, PDF về trạng thái `unindexed` |
| **Spike PDF thật**: 1 sách có lớp chữ · 1 bản scan | ⏳ **CHƯA LÀM** — cần `npm i pdfjs-dist` rồi thử. Đây là mảnh duy nhất còn nằm trên giấy, và phụ lục `SPEC-connectors` đã tự ghi *"chưa kiểm bằng file thật"* từ trước |
| **Bóc file lớn giữ vòng lặp sự kiện** | ⏳ chưa đo. `inflateRawSync` là đồng bộ; một `.xlsx` 40MB có thể làm giao diện khựng vài trăm ms. Nếu đo thấy đau thì chuyển sang `worker_threads` — đổi được mà không đụng gì ngoài `pump()` |

---

## 16. Lỗi bộ test bắt được ngay lần chạy đầu

Ghi lại vì nó là bằng chứng cho luận điểm §4 `SESSIONS_MEMORY` (*test hàm thuần là TIẾT KIỆM, không phải chi phí*), và vì nó suýt thành một lỗi loại tệ nhất: **sai mà trông vẫn hợp lý**.

**Excel không ghi ô trống ra file.** Một hàng có `A=1`, `B` trống, `C=3` chỉ có hai thẻ `<c r="A1">` và `<c r="C1">`, không có gì ở giữa. Bản đầu của `readSheetRows` đọc tuần tự theo thứ tự xuất hiện → ra `1 | 3` → **mọi cột sau ô trống dịch sang trái một bậc**.

Hậu quả không phải một bảng xấu: bài 3 và bài 7 của `TEST-WALKTHROUGH` giao đúng việc *"cộng tổng theo cột"*. Cột lệch thì con số vẫn ra, vẫn trông hợp lý, và sai — đúng lỗ hổng số 3 mà `USE-CASES` đã cảnh báo (*hệ thống không có cách kiểm chứng con số*).

Sửa: lấy vị trí từ thuộc tính `r="C1"`, không từ thứ tự duyệt. Ba test giữ nó: ô bị bỏ khỏi file · ô tự đóng `<c/>` · cột quá chữ Z (`AA` = cột 27).

**Và một câu nói sai do CHẠY THẬT mới lộ ra:** `INDEX.md` ghi *"cột: doanh thu, 1500"* — ta quan sát được nội dung dòng một, ta **không** quan sát được rằng đó là dòng tiêu đề. File xuất từ hệ thống khác hoàn toàn có thể vào thẳng dữ liệu. Đổi thành **"hàng đầu:"**. Cùng một luật với bảng token: một dòng nói sai làm hỏng niềm tin vào cả những dòng nói thật.
