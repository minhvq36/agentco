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

⚠ Bất biến này **chỉ thành thật từ 17/08**, khi charter rời khỏi `knowledge/` — xem §17. Trước đó mỗi văn phòng mới tự đẻ một node charter, tức là chính hệ thống đang vi phạm điều nó vừa tuyên bố. *Một bất biến chỉ có thật khi có mã nguồn thi hành nó.*

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

## 15b. Node **Tủ tài liệu** trên sơ đồ — hai cửa vào, MỘT đường xử lý

Người dùng hỏi thẳng: *"tức là có 2 chỗ upfile?"* — **Có hai CỬA, không có hai bản mã.**

| | |
|---|---|
| Node `🗄 Tủ tài liệu` trên canvas | **bấm một cái** → mở ngăn kéo · **thả file thẳng lên node** → mở ngăn kéo rồi tải lên |
| Ngăn kéo Tủ tài liệu ở sidebar | nút **Thêm tài liệu** · kéo thả vào ngăn kéo |

Canvas **không gọi API tải lên**. Nó đặt file vào `pendingDocs` trong store rồi mở ngăn kéo; ngăn kéo là nơi DUY NHẤT có `upload()`. Lý do không phải gọn gàng mà là hồi quy: có hai bản thì đến ngày sửa luật trùng tên, một bản được sửa và một bản bị quên — đúng lớp lỗi `skillFileFor` đã dẫm (`SESSIONS_MEMORY` §8).

**Số trên node đọc từ catalog trong bộ nhớ, không quét đĩa.** `describeNode` chạy mỗi lần vẽ lại sơ đồ (kéo node, mỗi sự kiện SSE); một `readdir` ở đó là một lần chạm đĩa cho mỗi khung hình. Quét đĩa chỉ xảy ra ở `GET /library`.

---

## 15c. Node KHO không có bảng chi tiết — bấm là MỞ THẲNG

Người dùng báo: *"bấm vào tủ tài liệu thì mở ra bên tay phải nhưng chẳng tương tác được gì, không có nút bấm ngoài dấu ✕. Mà trong sidebar cũng có tủ tài liệu rồi. Flow thế có rườm rà không?"*

**Rườm rà, và bảng rỗng là một lỗi thật** — `Inspector` không có nhánh render cho `library`, nên nó vẽ ra đúng cái khung với dấu ✕ và không có gì bên trong.

Nhưng sửa bằng cách *thêm nhánh* là sửa sai chỗ. Câu hỏi đúng: **bảng chi tiết bên phải để làm gì?**

> Để **CHỈNH một đối tượng**: đổi model, sửa hồ sơ, nối/ngắt dây, cho nghỉ, xoá.

Kho tri thức và tủ tài liệu **không có gì để chỉnh**. Chúng là **CỬA**, không phải đối tượng. Bảng của kho tri thức trước đây chỉ có 2 con số + 2 đoạn giải thích + một nút *"Mở kho tri thức"* — tức là một cái **sảnh phải đi qua** để tới nơi mình muốn tới.

### Luật, và nó tự trả lời cho mọi node thêm vào sau này

| Node | Bấm một cái |
|---|---|
| Trợ lý · nhân viên · MCP | **bảng chi tiết bên phải** — có thứ để chỉnh |
| Kho tri thức · Tủ tài liệu | **ngăn kéo bên trái, mở thẳng** — không có gì để chỉnh |

### Bốn chi tiết khiến nó chạy đúng

**1. `showPanel` không đảo trạng thái, khác `openPanel`.** Nút trên thanh tab thì bấm lại = đóng (đó là hành vi của một tab). Nhưng bấm vào node "Tủ tài liệu" thì ý định **luôn là MỞ** — dùng `openPanel` ở đây thì bấm đúp thành "mở rồi đóng ngay", trông y hệt *"bấm không ăn"*.

**2. Bấm node kho thì KHÔNG chọn nó** (`selected: null`). Chọn nó là mở kèm một cột rỗng bên phải — đúng cái vừa bỏ.

**3. Chốt đặt trong `Inspector`, không đặt ở chỗ gọi:**

```ts
if (node.kind === 'knowledge' || node.kind === 'library') return null;
```

Một dòng, và nó chặn cả **LỚP** lỗi: mỗi node kho thêm vào sau này sẽ lặp lại đúng cái bảng rỗng nếu ai đó quên viết nhánh. Giờ quên cũng không sao.

**4. Bỏ `onDoubleClick`.** Một cái bấm đã mở rồi.

### Hai đoạn giải thích không mất — chúng về đúng chỗ

Chúng là sự thật về cái **KHO**, không phải về cái node trên sơ đồ. Nên chúng chuyển vào chân của chính ngăn kéo, nơi người dùng đọc được đúng lúc đang nhìn vào kho. Và mỗi ngăn kéo **chỉ sang cái kia**:

- Kho tri thức: *"đây là thứ hệ thống tự rút ra… bạn sửa và xoá được nhưng không thêm mới — **tài liệu của bạn thì thả vào Tủ tài liệu**"* (bấm được, nhảy thẳng sang)
- Tủ tài liệu: *"đây là tài liệu **bạn đưa vào**… nó **không** nằm trong prompt"*

Trạng thái **rỗng** của kho tri thức mang nút bắc cầu đó, vì đó là màn hình duy nhất người dùng mới đọc kỹ — và câu hỏi đến ngay sau nó luôn là *"vậy tài liệu của tôi bỏ đâu?"*. Không trả lời ở đây thì họ đi tìm nút "thêm ghi chú" không tồn tại.

> **Nguyên tắc rút ra: hai khái niệm dễ lẫn thì mỗi cái phải tự nói mình LÀ GÌ và chỉ sang cái kia.** Rẻ nhất trong mọi cách chống nhầm lẫn, và tốn **0 token** vì nằm hoàn toàn ở giao diện.

### Bố cục

Hai kho đứng **cạnh nhau** ở hàng dưới cùng — **kho tri thức TRÁI, tủ tài liệu PHẢI** — và **cùng dùng viền nét đứt**.

- *Cạnh nhau:* đây là hai khái niệm dễ lẫn nhất trong sản phẩm; đặt xa nhau thì người dùng không bao giờ nhìn thấy chúng cùng lúc, và đó chính là lúc chúng nhập làm một trong đầu họ.
- *Nét đứt:* không phải trang trí. Node agent có cổng và có dây, nên viền liền đọc ra *"thứ này tham gia vào quan hệ"*. Hai kho là **môi trường** — ai cũng với tới được, không ai phải nối tới. Nét đứt nói điều đó **trước** khi người dùng kịp thử kéo một sợi dây và thất bại.

⚠ Thứ tự phải khớp ở **hai chỗ**: vị trí mặc định (`src/core/layout.ts`) và `autoArrange()` (`web/src/canvas/geometry.ts`). Văn phòng đã lưu `layout.json` giữ vị trí cũ cho tới khi bấm **Sắp xếp lại sơ đồ** — cố ý: không tự dời node người dùng đã đặt.

---

## 17. Charter rời khỏi kho tri thức — ba lỗi cùng một gốc

Người dùng báo: *"tạo văn phòng mới thì nó tự tạo một điều lệ trống trong kho tri thức, hits khá nhiều… mà tôi không thấy nó link tới giới thiệu văn phòng trong assistant. Hay là hai cái khác nhau?"*

**Là MỘT.** `charter_file` mặc định trỏ `knowledge/shared/_charter.md`, nên cùng một file vừa là lớp prompt *"Giới thiệu văn phòng"* vừa là một node trong ngăn kéo Tri thức. Hai cửa sổ, hai đường ghi, không cửa nào nhắc tới cửa kia. Ba hậu quả, tất cả đều đã xảy ra trên máy người dùng:

**1. Node ma.** Mỗi văn phòng mới đẻ ra một node người dùng không tạo, không hiểu, và ngăn kéo thì nói *"nhân viên tự ghi… không ai phải nhập tay"* — một câu sai ngay ở màn hình đầu tiên.

**2. Xoá node đó là hỏng thầm lặng.** Tái hiện được 100%:

```
PATCH /knowledge {id:"k/shared/_charter", remove:true}   → 200
PUT   /prompt/assistant/charter {text:"Chào"}            → 200
file  → "\nChào\n"          ← frontmatter biến mất, nó thôi là node tri thức
```

Ghi lại giữ frontmatter *"cũ"*, mà file vừa bị xoá nên không có gì để giữ. Prompt vẫn chạy nên **không có gì báo**. File `ho-tro-khach/knowledge/shared/_charter.md` trên máy người dùng đúng bằng `"\nChào\n"`, từng byte.

**3. Trả tiền HAI lần cho cùng một đoạn văn.** `hot()` loại node `pinned`, nhưng `cold()` thì **không** — `visible()` không lọc `pinned`. Nên charter dự thi COLD, bị tính `hits` (đo được: 6 và 3 ở hai văn phòng), và được render **thêm** vào task, trong khi thân charter **đã** nằm sẵn trong prefix qua `office.charter`. Lần thứ hai nằm sau cache breakpoint nên trả **giá đầy đủ**, mỗi task. Đây là câu trả lời cho *"hits khá nhiều"*.

### Chốt: DỜI RA, không vá tại chỗ

> **`charter.md` ở gốc văn phòng. Markdown thuần, không frontmatter, không phải node tri thức.**

Vá từng triệu chứng thì phải nhớ cả ba chỗ mãi mãi. Dời ra thì cả ba biến mất cùng lúc — và bất biến §7 (*kho tri thức chỉ agent ghi*) trở thành **thật**, có mã nguồn thi hành, chứ không phải một lời hứa trong spec.

| | Trước | Sau |
|---|---|---|
| Đường dẫn | `knowledge/shared/_charter.md` | `charter.md` |
| Định dạng | markdown + YAML frontmatter | markdown thuần |
| Tạo lúc nào | **tự tạo** khi tạo văn phòng | **chỉ khi người dùng lưu lần đầu** |
| Trong ngăn kéo Tri thức | có (node ma) | **không** |
| Vào prompt mấy lần | 2 (prefix + COLD) | **1** (prefix) |
| Chỗ sửa | hai chỗ, không đồng bộ | **một chỗ** |

**Trả lời câu *"điều lệ này có bị xoá không?"*: nội dung KHÔNG mất.** `migrateCharters()` chạy lúc khởi động, bóc thân ra `charter.md`, xoá file cũ, và sửa dòng `charter_file:` trong `office.yaml`. Thứ duy nhất mất là frontmatter — metadata của cái kho nó vừa rời khỏi. Đã chạy thật trên cả ba văn phòng: không mất chữ nào.

### Bốn chốt của di trú
1. **Idempotent từng văn phòng**, một văn phòng hỏng không chặn phần còn lại.
2. **Không đè `charter.md` đã có nội dung** — đó là bản người dùng viết sau di trú.
3. **Charter thân rỗng thì không đẻ ra file rỗng** (ca phổ biến nhất: mọi văn phòng tạo từ UI).
4. **Gọi HAI lần** trong `migrateIfNeeded`: lượt đầu cho công ty đã ở bố cục mới, lượt sau cho công ty v0 vừa được dời `knowledge/` vào văn phòng.

### Một chỗ hở đã bịt
`PromptLayer.frontmatter` **suy ra từ đường dẫn thật**, không đóng đinh `false`:

```ts
frontmatter: office.config.charter_file.replace(/\\/g, '/').startsWith('knowledge/')
```

Di trú **có thể** hỏng (Windows khoá file, thư mục chỉ đọc, người dùng khôi phục bản sao lưu cũ). Đóng đinh `false` nghĩa là ở đúng những máy đó, lần lưu kế tiếp xoá sạch frontmatter và **tái tạo chính cái lỗi vừa sửa**.

### Còn lại: `pinned` giờ là cờ chết
Charter là node `pinned` duy nhất từng tồn tại. Sau khi dời, **không đường nào đặt `pinned: true`** — cả ba hàm `add*` ghi `false`, giao diện không có nút, chỉ sửa file bằng tay mới đặt được.

**Giữ nguyên hành vi**, chỉ sửa lại chú thích cho khỏi nói dối. Đổi ngữ nghĩa một cờ chưa ai dùng là mua rủi ro không đổi lấy gì. Nhưng ghi lại đây cho lần sau: **nếu làm nút "ghim ghi chú", ghim phải nghĩa là LUÔN nằm trong HOT — và khi đó `cold()` bắt buộc phải loại nó ra**, nếu không nó được render hai lần cho cùng một task, đúng cái bẫy charter vừa dẫm.

---

## 16. Lỗi bộ test bắt được ngay lần chạy đầu

Ghi lại vì nó là bằng chứng cho luận điểm §4 `SESSIONS_MEMORY` (*test hàm thuần là TIẾT KIỆM, không phải chi phí*), và vì nó suýt thành một lỗi loại tệ nhất: **sai mà trông vẫn hợp lý**.

**Excel không ghi ô trống ra file.** Một hàng có `A=1`, `B` trống, `C=3` chỉ có hai thẻ `<c r="A1">` và `<c r="C1">`, không có gì ở giữa. Bản đầu của `readSheetRows` đọc tuần tự theo thứ tự xuất hiện → ra `1 | 3` → **mọi cột sau ô trống dịch sang trái một bậc**.

Hậu quả không phải một bảng xấu: bài 3 và bài 7 của `TEST-WALKTHROUGH` giao đúng việc *"cộng tổng theo cột"*. Cột lệch thì con số vẫn ra, vẫn trông hợp lý, và sai — đúng lỗ hổng số 3 mà `USE-CASES` đã cảnh báo (*hệ thống không có cách kiểm chứng con số*).

Sửa: lấy vị trí từ thuộc tính `r="C1"`, không từ thứ tự duyệt. Ba test giữ nó: ô bị bỏ khỏi file · ô tự đóng `<c/>` · cột quá chữ Z (`AA` = cột 27).

**Và một câu nói sai do CHẠY THẬT mới lộ ra:** `INDEX.md` ghi *"cột: doanh thu, 1500"* — ta quan sát được nội dung dòng một, ta **không** quan sát được rằng đó là dòng tiêu đề. File xuất từ hệ thống khác hoàn toàn có thể vào thẳng dữ liệu. Đổi thành **"hàng đầu:"**. Cùng một luật với bảng token: một dòng nói sai làm hỏng niềm tin vào cả những dòng nói thật.
