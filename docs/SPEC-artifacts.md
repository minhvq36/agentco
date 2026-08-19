# SPEC — Kết quả: file nhân viên làm ra

> Chốt 19/08/2026. Cài đặt: `src/core/artifacts.ts` · `web/src/components/panels/ArtifactsPanel.tsx`

## 0. Một câu

**Kết quả là cột thứ ba, và ba cột khác nhau ở đúng một câu hỏi: AI ĐẶT FILE VÀO ĐÓ?**

| | ai ghi | người dùng làm được gì | có vào prefix không |
|---|---|---|---|
| **Tủ tài liệu** | NGƯỜI DÙNG | thêm · xoá | không (bảng kê tên thì có) |
| **Kết quả** | NHÂN VIÊN | xoá | **không bao giờ** |
| **Kho tri thức** | AGENT tự rút ra | sửa · xoá | **có** — trả tiền mỗi lượt |

Ba khái niệm này dễ lẫn nhau, nên chúng đứng liền nhau trên sidebar và mỗi cái tự nói mình là gì ở chân ngăn kéo. Đó là cách chống nhầm lẫn rẻ nhất: **0 token**, vì nằm hoàn toàn ở giao diện.

---

## 1. ĐÂY KHÔNG PHẢI TỦ TÀI LIỆU THỨ HAI

Đây là ràng buộc quan trọng nhất của cả tính năng, và nó do người dùng nêu ra:

> *"Không nên cho worker đọc artifact làm tăng sự phức tạp, người dùng muốn cải thiện nên tự tay handover cho này chứ đừng làm hệ thống như đống rác."*

**Thi hành:** không có `POST`. Không có nút *"gửi cái này cho nhân viên"*. Không có ô chọn artifact làm input. Muốn dùng lại một kết quả thì người dùng **tự bàn giao** — chép nội dung vào ô chat, hoặc thả file vào tủ tài liệu.

### ⚠ Phân biệt với thứ VẪN CHẠY và không đổi

Trong **một** kế hoạch nhiều bước, task sau đọc artifact của task trước qua `inputs` (`ASSISTANT_CORE` có sẵn ví dụ `artifacts/T-00/notes.md`, và kế hoạch *viết → soát* chạy đúng đường đó). Đó là **dây nối bên trong một việc**, không phải một cái kho để lấy ra.

> **Ranh giới: artifact là DÂY NỐI trong một kế hoạch, không phải KHO để nạp lại.**

Vì sao ranh giới này đáng giữ: có hai kho cùng nghĩa thì có hai luật vòng đời, hai chỗ để dọn, và người dùng phải đoán nên bỏ file vào đâu. Cái thứ hai luôn là cái không ai dọn.

---

## 2. Bố cục thư mục — và lỗi mất dữ liệu nó sửa

```
offices/<id>/artifacts/
└─ <plan_id>/            ← MỚI 19/08
   └─ <task_id>/
      └─ ket-qua.md
```

### `T-01` là số thứ tự TRONG một kế hoạch, và mọi kế hoạch đều bắt đầu từ 1

Nên `artifacts/T-01/` là thư mục **dùng chung cho mọi lần chạy**. Đo được trên máy người dùng: văn phòng `noi-dung` có **tám** kế hoạch, cả tám cùng đổ vào `artifacts/T-01/` — chín file lẫn lộn một chỗ, không có gì cho biết file nào của lần chạy nào.

Hôm nay chưa mất gì vì tên file tình cờ khác nhau. **Chạy lại một yêu cầu giống lần trước là kết quả cũ bị ghi đè, không hỏi, không báo** — đúng lớp lỗi *"mất việc của người dùng, im lặng"* ở SESSIONS_MEMORY §8.

`Scheduler.validate` chỉ chặn hai task **trong cùng một kế hoạch** ghi đè nhau; nó không biết gì về các kế hoạch trước.

### Đóng khung bằng CODE, không dặn model

`artifactScoper(planId, taskIds)` viết lại đường dẫn sau khi model trả kế hoạch về. Model không hề biết `plan_id`. Hỏi model tự đặt đường dẫn duy nhất là trả tiền để mua lại đúng sự bất định ta vừa loại bỏ.

⚠ **Chỉ viết lại đường dẫn trỏ tới task CỦA CHÍNH KẾ HOẠCH NÀY.** Người dùng có quyền nói *"sửa lại file hôm qua"*, và lúc đó `inputs` trỏ tới artifact của một kế hoạch cũ — viết lại nó là chỉ nhân viên tới một file không tồn tại.

## 2.2 Đầu VÀO và đầu RA đi qua HAI luật khác nhau (chốt 20/08)

Trước 20/08 cả `inputs` lẫn `outputs` dùng chung `artifactScoper`. Gộp hai thứ là nguyên nhân của một ca hỏng đo được trên máy người dùng.

**Ca hỏng.** Người dùng gõ: *"Dịch doc-1.md… **Lưu vào `artifacts/vi/doc-1.md`**"*. Kết quả ra ở `artifacts/P-…/T-01/doc-1.md` — thư mục `vi/` **biến mất, không một câu nào giải thích**. Nguyên nhân là câu luật trong `CORE_PROMPT` (*"every task must write at least one file under `artifacts/<task_id>/`"*), nên planner tự bỏ phần đuôi để tuân luật. Và nhánh còn lại cũng sai: nếu planner ghi đúng `artifacts/vi/doc-1.md` thì `artifactScoper` thấy `vi` không phải task id nên **để nguyên** — file rơi ra ngoài khung theo ca, mất luôn bảo đảm §2.

**Hai câu hỏi khác nhau, nên hai hàm:**

| | câu hỏi | trả lời |
|---|---|---|
| `artifactScoper` (đầu VÀO) | *đường dẫn này trỏ tới task của chính kế hoạch này không?* | không → **để nguyên** |
| `outputScoper` (đầu RA) | *task này ghi ở đâu?* | **luôn** `artifacts/<plan_id>/<task_id>/` + phần đuôi |

```
artifacts/vi/doc-1.md   →  artifacts/<plan>/<task>/vi/doc-1.md
artifacts/T-01/x.md     →  artifacts/<plan>/T-01/x.md
bao-cao.md              →  artifacts/<plan>/<task>/bao-cao.md
```

`outputScoper` **idempotent** (gọi lại không bọc thêm lớp), bỏ `..`/`.` ở lớp đầu (`safeJoin` vẫn là chốt cuối), và `outputs` rỗng rơi về `ket-qua.md` chứ không bao giờ trả về một đường dẫn trỏ vào thư mục.

**Người dùng giữ được cấu trúc thư mục mình muốn; hệ thống giữ được bảo đảm không ghi đè.** Đây là điểm chung với §2.1: khi hai bên cùng có lý, đừng chọn một bên — tìm hình dạng chứa được cả hai.

### Và phải NÓI RA, đúng một lần

`whereBlock` in đường dẫn thật của mọi file đã ghi. Từ 20/08 nó thêm một dòng — **chỉ khi** có đường dẫn sâu hơn `artifacts/<plan>/<task>/`, tức là chỉ khi người dùng thật sự đã tự đặt thư mục:

```
(mỗi ca có thư mục riêng để lần chạy sau không đè lên lần này)
```

Đó đúng là lúc họ đang nhìn đường dẫn của mình bị bọc thêm hai lớp lạ, và cũng là lúc **duy nhất** đáng nói. Dán câu này vào mọi ca là biến một lời giải thích thành tiếng ồn. 0 token — dựng bằng code từ chính đường dẫn đang cầm.

### Prompt cũng phải đổi, và vì sao cả hai đều cần

Code bảo đảm **khung**; prompt quyết **phần đuôi** — code không thể đoán ra người dùng muốn thư mục `vi/` nếu planner không viết nó vào `outputs`. Nên `CORE_PROMPT` thêm hai câu: giữ lại đường dẫn người dùng đặt (nằm *trong* `artifacts/<task_id>/`, không thay thế nó), và *"người dùng đòi file riêng thì ghi file riêng"* — xem §2.3.

Cái giá: prefix của planner đổi → **ghi lại prompt cache một lần**. Rẻ, và đã biết trước.

## 2.3 Hình dạng đầu ra phải ỔN ĐỊNH giữa các ca (chốt 20/08)

Đo được 20/08, ba ca **cùng một câu yêu cầu** (dịch tài liệu + ghi lại thuật ngữ), ba hình dạng khác nhau:

| ca | `outputs` planner khai |
|---|---|
| doc-1 | `doc-1.md` **+ `thuat-ngu.md`** |
| doc-2 | chỉ `doc-2.md`, thuật ngữ nhét vào cuối file |
| doc-3 | chỉ `doc-3.md`, thuật ngữ nhét vào cuối file |

Không có lỗi nào nổ. Nhưng người dùng dịch năm tài liệu **để so sánh chúng với nhau**, và họ vừa mất khả năng đó: ca 1 có bảng ở file riêng, ca 2–3 chôn nó trong bản dịch.

**Không sửa được bằng code** — hình dạng đầu ra là thứ planner quyết từ một câu tiếng Việt. Hai chỗ can thiệp, cả hai đều đã làm:

- `CORE_PROMPT`: *"khi người dùng đòi file riêng thì ghi file riêng… cùng một yêu cầu phải cho cùng một hình dạng mỗi lần chạy"*.
- `TEST-WALKTHROUGH.md` bài 5: câu mẫu nói thẳng *"ghi bảng thuật ngữ ra một file RIÊNG"*, và có một bước kiểm hình dạng đầu ra.

⚠ **Đây là bất định còn lại, không phải bất định đã đóng.** Muốn chắc chắn thì người dùng phải nói rõ, hoặc văn phòng phải có `charter.md` ghi luật đó.

## 2.1 `plan_id` phải ĐỌC ĐƯỢC — và tên file thì KHÔNG đụng tới (chốt 19/08)

Đề bài của người dùng: `artifacts/P-mt08w0t8-iu50/T-01/tra-loi.md` — chuỗi giữa **không nói gì với con người**. Đề xuất ban đầu: thêm tiền tố `yyMMddhhmmss` vào **tên file**, và bỏ thư mục `P-…`.

**Cả hai nhánh đó đều bác bỏ, nhưng vấn đề gốc thì có thật.**

### Bỏ thư mục `<plan_id>/`: KHÔNG

Nó gánh **bốn** thứ, không phải một: `artifactScoper` (đóng khung), `Scheduler.linkDeps` (dò trùng đường dẫn để nối `deps`), `Scheduler.validate` (chặn hai task cùng ghi), và gom nhóm ở panel. Bỏ nó là **tái tạo đúng lỗi §2** — tám kế hoạch cùng đổ vào `artifacts/T-01/`.

### Timestamp vào tên file: KHÔNG

`newPlanId()` là `P-${Date.now().toString(36)}-${rand4}`. Nghĩa là **`mt08w0t8` ĐÃ LÀ một timestamp** — base36 của `Date.now()`, chỉ là ở dạng người không đọc được.

Thêm ngày giờ vào tên file nữa thì người đọc **thấy thời gian hai lần**, và tên file **thôi mô tả nội dung** — mà đó là việc duy nhất của tên file. Chưa kể timestamp lúc *ghi* không dùng được: `outputs` của T-01 và `inputs` của T-02 do model viết ở hai chỗ trong cùng một khối JSON, chúng phải khớp nhau, nên mọi định danh **phải sinh ra ở lúc LẬP KẾ HOẠCH** — tức là đúng thứ `plan_id` đang làm.

> **Tên file giữ nguyên, đặt là gì cũng được.** Ràng buộc duy nhất vẫn như cũ: hai task **trong cùng một kế hoạch** không được ghi trùng đường dẫn (`validate` chặn). Khác kế hoạch thì thư mục `<plan_id>/` đã lo.

### Thứ ĐÚNG là vấn đề: đọc không ra. Hai bản vá, tách bạch.

**a. Đổi FORMAT của `plan_id` — không đổi cơ chế.**

```
cũ   P-mt08w0t8-iu50
mới  P-260819-1430-iu50
```

Giữ nguyên mọi bảo đảm: sắp xếp từ điển vẫn đúng thứ tự thời gian, `logFile` regex (`^[A-Za-z0-9_-]{1,64}$`) nhận bình thường, xác suất đụng độ trong cùng một phút là `1/36⁴ ≈ 1/1.680.000`.

**Không cần di trú, và lý do là cấu trúc chứ không phải may mắn: `plan_id` KHÔNG BỊ PARSE Ở ĐÂU CẢ.** Nó chỉ là khoá và là một đoạn đường dẫn. Kế hoạch cũ giữ tên cũ, kế hoạch mới nhận tên mới, hai loại sống chung vô thời hạn.

**b. Panel hiện TÊN VIỆC THẬT.**

Đây mới là bản vá ăn tiền, và nó **không đụng gì tới `plan_id`**. Panel vốn đã cố ý **không bao giờ hiện mã kế hoạch** — nhưng thứ nó hiện thay vào là một bản dự phòng mà chú thích trong `ArtifactsPanel.tsx` đã tự thú: *"Chưa có tên việc thì nói ngày giờ"*. Tên việc **có sẵn** ở `tasks/index.json` (`PlanRecord.request`), chỉ là chưa ai nối dây.

| | trước | sau |
|---|---|---|
| tiêu đề nhóm | `Việc chạy 19/08 15:10` | `Trả lời khách hỏi chính sách bảo hành…` |
| nguồn | `mtime` mới nhất trong nhóm | `PlanStore.get(plan_id).request` |

Hai chi tiết bắt buộc:

- **`request` là câu Trợ lý VIẾT LẠI** (`route()` trả *"viết lại yêu cầu thành một câu rõ ràng, đủ ngữ cảnh"*), nên nó **dài** được. Cắt một dòng, giữ bản đầy đủ ở `title` tooltip. Nhóm không tra được `request` (kế hoạch đã rơi khỏi `index.json` — trần 200 bản ghi) thì **rơi về nhãn ngày giờ cũ**, đừng hiện chuỗi rỗng.
- **Thời gian vẫn hiện, ở dạng ĐẦY ĐỦ CÓ GIÂY** (`19/08/2026 15:10:42`), căn phải, `tabular-nums`. Tiêu đề nhóm là mỏ neo phân biệt *"lần chạy nào"* — chạy lại **cùng một yêu cầu** trong một ngày thì **giây là thứ duy nhất tách được hai nhóm**. Dòng file bên trong giữ `when()` rút gọn như hiện tại: nó đã nằm sẵn trong một nhóm đã biết, không cần lặp lại ngày.

Lấy `mtime` **mới nhất trong nhóm**, không lấy `PlanRecord.ended_at`: đó là **sự việc quan sát được trên đĩa** (đúng luật *"thứ gì QUAN SÁT ĐƯỢC thì đừng hỏi, đừng suy"* — `SPEC-offices.md` §6), và nó sống sót cả khi `index.json` mất.

### Không di trú

Dữ liệu cũ là demo, người dùng chốt xoá. Đó là quyết định của người dùng và nó cắt bỏ phần khó nhất của thay đổi này. Panel vẫn **đọc được** file nằm thẳng dưới `artifacts/<task_id>/` và gom chúng vào một nhóm *"Kết quả cũ"* — không ai bị mất màn hình vì một bố cục cũ.

---

## 3. Xem trước: ba nhóm, và ranh giới là quyết định sản phẩm

| nhóm | đuôi | cách hiện |
|---|---|---|
| **văn bản** | `md` `txt` `csv` `tsv` `json` `yaml` `yml` `html` `xml` `log` | `fetch` rồi tự vẽ. md/txt hiện thẳng, csv thành **bảng**, còn lại `<pre>` |
| **trình duyệt tự lo** | `png` `jpg` `jpeg` `gif` `webp` · `pdf` · `mp4` `webm` | thẻ `<img>` `<object>` `<video>` |
| **KHÔNG xem trước** | `docx` `xlsx` `pptx` · `svg` · mọi đuôi khác | chỉ tải về, kèm câu giải thích |

### Vì sao bỏ docx/xlsx/pptx — và lý do "nặng codebase" KHÔNG phải lý do

`src/library/extract.ts` đã bóc được cả ba với **0 phụ thuộc mới**. Copy sang đây là gần như miễn phí. Lý do thật mạnh hơn:

> **Preview bóc-text của một file Word là một LỜI NÓI DỐI.** Mất bảng, mất bố cục, mất ảnh.

Ở tủ tài liệu, văn bản bóc ra là để `Grep` **TÌM** và không ai nhìn nó. Ở đây người dùng **NHÌN** để quyết có gửi cho khách hay không. Cùng một kỹ thuật, một chỗ đúng và một chỗ sai.

→ Không preview vỡ. Một câu nói thẳng: *"tải về rồi mở bằng ứng dụng thật"*.

### Vì sao `.svg` nằm ở nhóm cấm

SVG là XML và **nó chạy được JavaScript**. File này do MODEL sinh ra, còn daemon phục vụ nó ở **cùng origin** với giao diện điều khiển công ty — thứ không có xác thực nào ngoài *"cùng máy"*. Server ép `application/octet-stream` cho `svg` `html` `htm` `xhtml`.

### Thứ tự ưu tiên đến từ dữ liệu thật

Kiểm ngày 19/08: **14/14 artifact trên máy người dùng đều là `.md`**. Đúng về kiến trúc — nhân viên chỉ có `Write`/`Edit` nên **chỉ ghi được văn bản**; không tool nào sinh ra `.jpg`, `.mp4` hay `.pdf` (trừ vai trò khai `Bash`, là ngoại lệ hiếm).

→ Nhóm văn bản là **100% ca thật**. Nhóm ảnh/pdf/video làm luôn vì nó là vài dòng thẻ native, không phải vì có ai đang cần.

---

## 4. Xoá: MỘT mức — nhưng câu hỏi lại KHÁC tủ tài liệu

Cùng luật với tủ tài liệu (SPEC-library §6): một mức, xoá hẳn, hỏi lại **kèm tên file**. Mức "lưu trữ" đẻ ra một cái kho thứ hai cũng cần dọn.

**Nhưng câu hỏi lại phải khác, và khác biệt là thật:**

| | tủ tài liệu | kết quả |
|---|---|---|
| bản gốc | còn trên máy người dùng | **KHÔNG có bản nào khác** |
| câu hỏi | *"Bản gốc trên máy bạn không bị ảnh hưởng."* | *"Đây là **bản duy nhất** — nhân viên phải chạy lại từ đầu."* |

Dùng lại nguyên câu của tủ tài liệu ở đây là nói dối về mức độ nghiêm trọng.

Xoá xong thì **dọn luôn thư mục rỗng còn lại** — `artifacts/<plan_id>/T-01/` trống trơn nằm lại chỉ để người dùng mở file explorer ra và tự hỏi nó là gì.

---

## 5. Không có editor

Cùng lý do với tủ tài liệu, và mạnh hơn: một editor ở đây là **cửa ghi thứ hai** vào cùng một file mà nhân viên đang ghi. Đó đúng là lớp lỗi charter (SPEC-library §17) — hai giao diện ghi cùng một file, không cửa nào biết cửa kia.

Muốn đổi nội dung thì nhắn Trợ lý làm lại. *"Ra bản nháp để sửa còn hơn viết mới từ đầu"* nói rằng sửa rẻ hơn — nhưng sửa bằng **nhân viên**, không phải bằng một textarea.

---

## 6. API

| | |
|---|---|
| `GET /api/office/:id/artifacts` | quét đĩa, trả danh sách. **Không catalog** |
| `GET /api/office/:id/artifacts/file?path=…[&download=1]` | stream. `download=1` → `octet-stream` + `content-disposition` |
| `DELETE /api/office/:id/artifacts?path=…` | xoá hẳn, dọn thư mục rỗng |

### Không catalog, không watcher

Quét `readdir`+`stat` mỗi lần đọc. Cùng lý do với tủ tài liệu (SPEC-library §9.1) và **mạnh hơn ở đây**: file này do nhân viên ghi **trong lúc đang chạy**, nên bất kỳ bản catalog nào cũng lỗi thời ngay giữa một ca.

### Ba chốt an toàn — và cái thứ nhất sửa một lỗ hổng có thật

1. **Nhốt trong `artifacts/`.** Hàm cũ `Office.readArtifact` đọc được **bất kỳ file nào trong văn phòng**: `roles/*.yaml`, `charter.md`, `office.yaml`. Nó chặn segment bắt đầu bằng dấu chấm (nên `.state/` an toàn) nhưng phần còn lại thì mở. Tên hàm nghe như chỉ đọc artifact, và không ai kiểm lại.
2. **Giải đường dẫn thật rồi mới so.** Kiểm chuỗi không nhìn thấy symlink.
3. **Trần xem trước 2MB.** Hàm cũ **không có trần nào** — một `.csv` 50MB nhân viên sinh ra sẽ được nạp trọn vào bộ nhớ daemon rồi đẩy trọn sang trình duyệt. Chưa ai gặp vì mọi kết quả đều là markdown vài trăm byte; đó chính là lúc rẻ nhất để đặt cái trần.

⚠ Hàm cũ cũng luôn `readFileSync(abs, 'utf8')` và luôn trả `text/plain` — **làm hỏng mọi file nhị phân**. Không ai gặp vì chưa có file nhị phân nào.

---

## 7. Cập nhật giao diện: bám SỰ KIỆN, không bám SỐ ĐẾM

`artifactsVersion` tăng khi có `task.done` mang artifact. **Không thêm sự kiện server mới**: kết quả chỉ sinh ra khi một việc chạy xong, mà `task.done` đã bay tới rồi. Thêm một sự kiện nữa để nói lại cùng một chuyện là thêm một chỗ có thể lệch nhau.

> **Bài học chung, sửa luôn cho kho tri thức:** `KnowledgePanel` trước đây bám vào `canvas.knowledge.total` — tức là **số đếm**. Nó chỉ nạp lại khi số node thay đổi, nên mọi thay đổi giữ nguyên số lượng đều vô hình cho tới khi người dùng bấm F5: sửa nội dung một ghi chú, một node bị đè, dọn một node rồi thêm một node.
>
> **Đếm không phải là biết đã đổi.**

---

## 8. Tên tiếng Việt: "Kết quả"

Không phải *"Artifacts"*, không phải *"Sản phẩm"*, không phải *"Bàn giao"*.

Lý do: Trợ lý **đã** nói câu này sau mọi lần chạy —

> *"Kết quả đã lưu tại: company/offices/…/tra-loi.md"*

Sản phẩm đã dạy người dùng từ đó rồi. Đặt tên thứ hai cho cùng một thứ là tự tạo ra khái niệm dễ lẫn **thứ ba**, trong khi đã có sẵn hai cái.

---

## 9. Việc phải KIỂM trước khi hứa với khách

- [x] Đường dẫn mới `artifacts/<plan_id>/<task_id>/` — kiểm bằng ca chạy thật 19/08
- [x] Thoát thư mục (`..`, `office.yaml`, `.state/`) đều trả 404
- [x] `svg` bị ép `octet-stream`
- [x] Xoá file cuối cùng thì thư mục cha rỗng tự biến mất, thư mục còn file thì không
- [x] `csv` nhận `view: csv`, `md` nhận `markdown`, đuôi lạ nhận `download`
- [ ] **Xem bằng trình duyệt thật** — bảng CSV, ảnh, pdf. Chưa kiểm được (extension Chrome không kết nối)
- [ ] Kết quả > 2MB: kiểm câu 413 hiện đúng chứ không phải một khối JSON thô
