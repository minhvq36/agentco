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

## 2.6 🔴 LUẬT: KẾT QUẢ LUÔN SINH RA BÊN TRONG THƯ MỤC VĂN PHÒNG (user chốt 21/08)

> *"Cái này sao lòi ra đứng cùng cấp với office vậy, luôn phải sinh tài liệu inside office, đây là luật."*

**Ca đã xảy ra — `P-260821-1818-yydi`.** Nhân viên gọi `Write` với đường dẫn trỏ lên hai cấp. File 4236 byte rơi vào `company/artifacts/<plan_id>/T-01/`, **ngang cấp với `offices/`** — một chỗ không văn phòng nào nhìn thấy, không panel Kết quả nào liệt kê, và `office rm --delete-files` không bao giờ chạm tới.

### Vì sao `cwd` KHÔNG phải một bức tường

Ba thứ trông như đang chặn, và không thứ nào chặn:

| | Chặn cái gì | Không chặn cái gì |
|---|---|---|
| `cwd: office.dir` | chỗ đường dẫn **tương đối** neo vào | đường dẫn **tuyệt đối** — `Write` nhận thoải mái |
| `tools` / `allowedTools` | **tool nào** được dùng | ghi **vào đâu** |
| `artifactScoper` | đường dẫn trong **kế hoạch** | đường dẫn model tự gõ **lúc chạy** |

`artifactScoper` viết đúng `outputs` vào brief. Nhưng brief là *lời dặn*, và lời dặn không phải cơ chế — model vẫn tự do gõ một đường dẫn khác vào `Write`. Đúng luật 16/08: **một bất biến chỉ có thật khi có mã nguồn thi hành nó.** Luật này nằm trong spec từ đầu dưới dạng bố cục thư mục ở §2, đọc rất thuyết phục, và **chưa từng chạy**.

### Thi hành: `PreToolUse` hook, không phải `canUseTool`

```ts
hooks: { PreToolUse: [{ matcher: 'Write|Edit|NotebookEdit', hooks: [officeJail(office.dir)] }] }
```

⚠ **Đừng đặt luật này vào `canUseTool`.** Đã đo 19/08: tool nằm trong `allowedTools` thì được tự duyệt và **BỎ QUA `canUseTool`** — mà `Write` nằm trong `allowedTools` của mọi vai trò. Viết luật ở đó là viết một luật không bao giờ chạy, tức đẻ thêm đúng loại **LỜI HỨA** mà nợ 0c sinh ra để đi tìm. `PreToolUse` chạy trước tầng quyền nên `allowedTools` không che được nó.

### `deny` kèm chỉ đường, KHÔNG `updatedInput`

`updatedInput` có thể nắn đường dẫn về trong văn phòng, và đó chính xác là ô **`viết lại lặng lẽ`** ở bảng kiểu hỏng của nợ 0c — nguy hơn `từ chối` vì không ai thấy gì. Ta `deny`, và câu từ chối **nói luôn đường dẫn đúng phải dùng**: model ghi lại đúng chỗ ngay lượt sau, nhật ký có dấu vết, và ta không tốn một lượt cho một lời từ chối trống rỗng.

### Nhãn `outside`: chặn là một chuyện, KHAI RA là chuyện khác

`landingOf` trước đây `catch { return undefined }` khi `safeJoin` ném. `undefined` nghĩa là *"không có điểm đến nào"* — nhưng sự thật là *"có điểm đến, và nó nằm ngoài chỗ ta cho phép"*. Hai câu khác hẳn nhau.

Cái giá của việc trộn hai câu: Trợ lý nói *"không thấy file trên đĩa — nhắn mình làm lại việc này nhé"* trong khi kết quả nằm nguyên vẹn cách đó hai thư mục. Người dùng **trả tiền lần thứ hai cho thứ họ đã có**, và bỏ lại một file lạc không ai dọn.

`Landing.kind` giờ có `outside`, và nó được dùng ở đúng một chỗ: chọn câu nào để nói khi file đã hứa vắng mặt (`office.ts → strayFilesOf`). Nó **không bao giờ** vào `whereBlock` — *"kết quả của bạn nằm ở đây"* chỉ được nói về chỗ hệ thống quản được.

> Hook chặn ca **từ nay trở đi**; nhãn `outside` cứu ca **đã xảy ra rồi** và mọi ca lọt lưới trong tương lai. Cần cả hai — một cái là cửa, một cái là đèn.

### 🔴 NGOẠI LỆ DUY NHẤT, VÀ NÓ PHẢI ĐƯỢC KHAI RA: `Bash` (ghi 22/08)

`matcher: 'Write|Edit|NotebookEdit'` **không khớp `Bash`**. Và nó không thể khớp: `officeJail` chặn được vì nó đọc `tool_input.file_path` — một **trường có tên**. Lệnh shell không có trường đó; đường dẫn nằm lẫn trong chuỗi lệnh, cạnh biến, cạnh pipe, cạnh `$()`. Muốn chặn thì phải **phân tích cú pháp shell** để tìm mọi chỗ có thể ghi, trên ba hệ điều hành, và bất kỳ chỗ nào bỏ sót cũng là một luật vẫn nói mình đang chạy.

⇒ Câu đúng của luật §2.6 là:

> **Kết quả luôn sinh ra bên trong thư mục văn phòng — TRỪ khi vai trò được bật `Bash`.**

Ba hệ quả, và cả ba đã được thi hành:

| | |
|---|---|
| `Bash` phải **hiện ra được và tắt được**, không bao giờ ngầm | `BUILTIN_TOOLS` không chứa nó (nên nó là một dòng THẤY ĐƯỢC trong `roles/<id>.yaml`); công tắc riêng ở bảng chi tiết (`Inspector.tsx` §`BashSwitch`) |
| Chỗ bật nó phải nói ra **đúng hậu quả**, không phải một câu "hãy cân nhắc" | *"đọc và ghi được bất cứ đâu trên máy bạn"* + *"ngoại lệ duy nhất của luật…"* |
| Ta vẫn **khai** rằng đã có lệnh chạy, dù không biết nó ghi đi đâu | `landingOf` → `{ kind: 'command' }`; `describeCall` → *"đang chạy lệnh"* |

> Không ghi ngoại lệ này ra thì §2.6 đọc như một bất biến tuyệt đối trong khi nó là một bất biến **có điều kiện** — và người tin vào nó sẽ tin sai đúng ở ca duy nhất mà hậu quả là cả cái máy. Cùng một họ với bài học `tools` ≠ `allowedTools`: một luật viết đúng, đọc thuyết phục, và sai ở một khe không ai nhìn.
>
> 🔴 **Và từ 22/08 điều kiện đó là MẶC ĐỊNH BẬT** (user chốt — `SPEC-tools-approval.md` §5). Nghĩa là câu đúng của §2.6 hôm nay là: *"kết quả nằm trong văn phòng với những nhân viên bạn đã tắt `Bash`"*. Đó là một luật yếu hơn hẳn luật hôm 21/08, và **phải đọc đúng độ yếu của nó** — đừng dẫn §2.6 như một bảo đảm nữa. Bù lại: `tools: [Bash]` là một dòng THẤY ĐƯỢC trong file vai trò, công tắc nằm ngay bảng chi tiết, và hộp thoại tạo nhân viên nói thẳng ra. Ngoại lệ được **khai báo**, không phải được **giấu**.
>
> **Chưa trả:** cổng duyệt `write_external` (`SPEC-tools-approval.md` §8) là tầng chặn thứ hai đã thiết kế nhưng **chưa cài**. Tới khi có nó, công tắc `Bash` là thứ duy nhất đứng giữa người dùng và cái máy của họ.

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

## 2.4 BẺ luật "artifact vô hình" — bảng kê cho Trợ lý (chốt 20/08)

> Đây là lần **đảo một quyết định đã ghi trong §1**. Ghi lại đầy đủ vì lý do đảo quan trọng hơn kết luận.

### Ca hỏng buộc phải xem lại

Người dùng: *"doc-2, doc-3 thiếu file thuật ngữ"*. Bốn lượt qua lại:

1. Trợ lý bảo họ **đi kiểm đường dẫn** — bắt người dùng làm việc mà máy làm hết 1ms, và diễn đạt như thể họ có thể là người nhầm
2. Người dùng: *"files chưa xuất hiện"*
3. Khâu lập kế hoạch **chết hẳn** — nó hỏi *"bản dịch tiếng Việt đang nằm ở đường dẫn nào?"*, mà câu hỏi lại không phải hình dạng hợp lệ nên hiện ra thành lỗi (xem `SPEC-offices.md` §6)
4. Người dùng phải **tự nghĩ ra giải pháp kiến trúc**: *"thì bạn phải kêu người dịch tạo bổ sung đi chứ"*

Rồi ca chạy được — và **kết quả của nó SAI**:

| `Widget` | |
|---|---|
| bản dịch `doc-2.md` thật sự dùng | `Widget` — giữ nguyên |
| bảng thuật ngữ mới sinh ra ghi | **`Tiện ích (widget)`** |
| số lần chuỗi `"Tiện ích"` xuất hiện trong bản dịch | **0** |

Vì `inputs` trỏ vào `library/files/doc-2.md` — **bản gốc tiếng Anh**. Người dịch chưa bao giờ nhìn thấy bản dịch, nên khi được bảo *"ghi lại các thuật ngữ và cách ĐÃ CHỌN dịch chúng"* nó **chọn lại từ đầu**. Một tài liệu ghi lại những lựa chọn chưa từng được thực hiện, nhìn rất chuyên nghiệp. Tệ hơn nữa: `doc-2.md` **đã có sẵn** một mục `## Ghi chú thuật ngữ` ở cuối, nên giờ có **hai bảng mâu thuẫn** — và không ai trong cuộc hội thoại biết, vì không ai nhìn được vào ngăn Kết quả.

### Quyết định cũ ĐÚNG về rủi ro, SAI về phạm vi

§1 canh đúng thứ đáng canh: đừng biến ngăn Kết quả thành một cái kho thứ hai người dùng phải quản, và đừng để kết quả cũ trôi vào ngữ cảnh việc mới. Nhưng nó chọn cách canh **thô nhất — vô hình hoàn toàn** — và cái giá là chặn luôn thao tác tự nhiên nhất của cả sản phẩm: *"làm tiếp cái vừa xong"*.

**Mấu chốt khiến bản vá rẻ hơn nhiều so với vẻ ngoài của nó:**

> **Nhân viên ĐÃ đọc được artifact rồi.** Worker có `Read`/`Grep`/`Glob` với `cwd` là thư mục văn phòng — chỉ cần kế hoạch ghi đường dẫn vào `inputs` là nó mở được, ngay hôm nay.

Nên thứ thiếu **không phải quyền đọc**, mà đúng một thứ: **planner không biết đường dẫn để mà ghi vào `inputs`.** Đây là lỗ hổng **thông tin ở thời điểm lập kế hoạch**, không phải lỗ hổng quyền hạn — nên bản vá cũng chỉ vá đúng chỗ đó.

### Năm chốt chống tiếng ồn

| # | Chốt | Vì sao |
|---|---|---|
| 1 | Chỉ **tên file**, không nội dung | Nội dung đã có `Read` lo, và chỉ khi `inputs` gọi tên |
| 2 | Gom theo **CA**, kèm một dòng `request` (cắt còn **30 token**) | `P-260820-0314-rab5/T-01/doc-2.md` không nói gì với model; *"ca: dịch doc-2 sang tiếng Việt"* nói tất cả. `briefText` (200 token) là trần của **nhật ký**, không phải của prefix — đo thật: một `request` đầy đủ ăn hơn nửa ngân sách cả bảng |
| 3 | Chỉ **5 ca** gần nhất + một dòng đếm phần còn lại | Không phải 1: ca người dùng nhắc lại không phải lúc nào cũng là ca vừa xong — ca thật 20/08 cần một kết quả của **25 phút và hai ca trước** |
| 4 | Trần cứng `budgets.artifacts_manifest_tokens` = **600**, cắt từ ca **cũ nhất** | Cắt nguyên khối bằng `truncateToTokens` sẽ để lại một đường dẫn cụt — mà đường dẫn cụt **tệ hơn không có**: model vẫn điền nó vào `inputs` |
| 5 | 🔒 **CHỈ Trợ lý. Không bao giờ vào prefix nhân viên.** | Nhân viên nhận đường dẫn qua `inputs`. Nhét bảng kê vào prefix của họ là trả tiền ở **mọi** lượt của **mọi** người để mua một thứ họ không dùng |

Đo trên dữ liệu thật (4 ca, 6 file): **192 token**.

### Cái giá, nói thẳng

Khối này đổi sau **mỗi ca** → prefix Trợ lý bị ghi lại mỗi ca. Giảm thiểu bằng **vị trí**: đặt **cuối cùng** trong chuỗi khối của `buildAssistantPrompt`. Prompt cache là cache theo **tiền tố**, nên mọi khối phía trên vẫn trúng cache và chỉ cái đuôi bị viết lại. Ước ~$0.002/ca — **là số ước, chưa đo.**

Đồng bộ (`refreshAssistantContext`) chạy **ngoài** cổng `status === 'done'`: ca `failed`/`stopped` vẫn có thể đã ghi xong vài file trước lúc hỏng, và đó chính là những file người dùng sẽ nhắc ở câu tiếp theo (*"làm nốt phần còn lại"*).

⚠ **Artifact sinh trước bản vá `plan_id` đôi (20/08) mang id mồ côi nên KHÔNG tra được tên ca** — bảng kê hiện *"(một việc cũ, không còn tên trong sổ)"*. Suy giảm êm, không sửa được, và chỉ ảnh hưởng dữ liệu cũ.

### Phải thêm vào `describePrompt` trong CÙNG một lần sửa

Bài học §5e (`SPEC-offices.md`): prompt đúng mà bảng "Xem prompt phân lớp" sai thì bảng đó vô dụng, vì cả điểm của nó là để tin được. **Mỗi khối mới trong `buildAssistantPrompt` phải có một mục tương ứng ở `describePrompt`.**

## 2.5 Đường dẫn trong ô chat BẤM ĐƯỢC — và chốt chống model bịa (chốt 20/08)

Người dùng: *"`company/offices/ban-dia-hoa/artifacts/P-…/T-01/vi/doc-2-thuat-ngu.md` — cách này bắt người dùng mò vào folder trong máy, hơi bất tiện"*. Đúng: sản phẩm vừa mất công dựng một cửa sổ xem trước, rồi lại đưa người dùng ra file explorer.

Kèm theo một nỗi lo **đúng chỗ**: *"trường hợp nghe worker bịa thì khá thảm hoạ"*.

### Vì sao ca này AN TOÀN — và nó an toàn từ trước, không phải nhờ bản vá này

Đường dẫn trong khối *"Kết quả đã lưu tại"* **chưa bao giờ là chữ của model**. Nó đã qua **ba cửa**:

| cửa | ở đâu | chặn gì |
|---|---|---|
| suy từ **tool ĐÃ GỌI** (`receipt.landed`) | `worker.ts → landingOf` | không dùng `receipt.artifacts` — trường đó là thứ model **khai**, và nó bịa được |
| `safeJoin` | `landingOf` | đường dẫn đi ra ngoài thư mục văn phòng |
| `existsSync` | `whereBlock` | file model nói đã ghi mà thật ra không có |

### Cơ chế: dữ liệu, KHÔNG phải regex trên chữ

`master.message` nhận thêm `files?: string[]` — đường dẫn tính từ thư mục văn phòng, **chỉ** được điền bởi `whereBlock`.

> ⛔ **KHÔNG BAO GIỜ dò đường dẫn trong `say` bằng regex.** Một phần tin nhắn trong luồng do model viết (`answer` của nhân viên ở task `deliver: reply`). Dò bằng regex nghĩa là: nhân viên bịa một đường dẫn nghe rất thật, giao diện biến nó thành nút bấm được, người dùng tin tưởng bấm vào. Đó là **cho một câu model đoán mượn uy tín của giao diện**, và người dùng không có cách nào phân biệt.
>
> Luật gọn: **chỉ đường dẫn do CHÍNH CODE đặt vào mới bấm được.**

Ghép chữ ↔ dữ liệu bằng **so đuôi chuỗi**, không regex: `say` in đường dẫn có tiền tố `company/offices/<id>/` (cho người mở file explorer), `files` mang đường dẫn tính từ thư mục văn phòng. Hai hệ quy chiếu vì hai người dùng khác nhau — nhưng cả hai đầu do **cùng một hàm** dựng ra nên chúng không thể lệch. `whereBlock` trả đúng `shown` (mảng đã in ra chữ), không trả cả `files`: lệch một cái là giao diện có mục bấm được không ứng với dòng nào, hoặc một dòng không bấm được nằm cạnh dòng bấm được.

### Bridge (Telegram) không đổi một chữ

`files` là **metadata đi kèm**, không thay thế phần chữ. Bên hiển thị không đọc nó thì thấy `say` nguyên văn y như hôm nay — đường dẫn vẫn đủ, chỉ là không bấm được. Cùng một sự kiện, hai kết cục, đúng luật *"mỗi bên hiển thị tự chọn cách phản ứng"* (giống `hold_ms` ở `SPEC-offices.md` §4.6).

### Luồng bấm

`actions.revealArtifact(path)` → `panel: 'artifacts'` + đặt ô `revealArtifact` → `ArtifactsPanel` nhận, tra trong danh sách **đã nạp**, mở cửa sổ xem trước.

- Băng chuyền qua store, cùng khuôn `pendingDocs`: cả luồng xem trước (nạp nội dung, ba nhóm định dạng, trần 2MB, nút tải về) sống ở **đúng một chỗ**.
- `showPanel` chứ không `openPanel`: bấm đường dẫn thứ hai mà panel đóng lại là một cái bẫy.
- Hiệu ứng bám vào **ô yêu cầu**, không vào giá trị của nó — bấm cùng một đường dẫn hai lần vẫn phải mở lại được.
- Không tìm thấy (file đã bị xoá sau khi tin nhắn gửi) thì **nói ra bằng toast**. Một cú bấm không gây ra chuyện gì cả thì người dùng chỉ biết là "hỏng", và họ bấm lại.
- Ô yêu cầu dọn **ngay** kể cả khi không khớp: giữ lại thì lần sau mở panel Kết quả vì việc khác cũng bị bật lên một cửa sổ họ không yêu cầu.

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
