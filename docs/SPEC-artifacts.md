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

`artifactScoper(planId, taskIds)` viết lại đường dẫn sau khi model trả kế hoạch về. Model không hề biết `plan_id` — nó được sinh ra ở chính hàm đó. Hỏi model tự đặt đường dẫn duy nhất là trả tiền để mua lại đúng sự bất định ta vừa loại bỏ.

⚠ **Chỉ viết lại đường dẫn trỏ tới task CỦA CHÍNH KẾ HOẠCH NÀY.** Người dùng có quyền nói *"sửa lại file hôm qua"*, và lúc đó `inputs` trỏ tới artifact của một kế hoạch cũ — viết lại nó là chỉ nhân viên tới một file không tồn tại.

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
