# SPEC — Công ty nhiều văn phòng, và Assistant là công dân hạng nhất

**Ngày:** 15/08/2026 · **Trạng thái:** Đợt 1 đang cài đặt

Thay thế mô hình "một công ty = một đội" của `SPEC-2026-08-14-agentco.md` §2. Đọc kèm `SPEC-canvas.md` (hình dạng) và `SPEC-token-economy.md` (luật cao hơn tất cả).

---

## 1. Vì sao đổi

v0 gộp hai khái niệm làm một: *công ty* vừa là đơn vị cấu hình, vừa là đơn vị làm việc. Hệ quả là mọi vai trò nằm chung một rổ, một Assistant phải biết hết mọi việc, và roster của nó phình theo số nhân viên — mà roster nằm trong prefix được cache của **mọi lượt trò chuyện**.

Tách ra thành **công ty → nhiều văn phòng** giải quyết đúng chỗ đó: mỗi văn phòng có Assistant riêng chỉ biết người của mình.

---

## 2. Bố cục thư mục

```
company/
├─ company.yaml            cấu hình chung: model tier, ngân sách, trần token
├─ logs/usage.jsonl        chi phí TOÀN CÔNG TY, mỗi dòng có cột office
├─ .state/                 daemon.json, secrets.json  ← cấp công ty
└─ offices/
   ├─ noi-dung/
   │  ├─ office.yaml       tên văn phòng + phần Assistant người dùng sửa được
   │  ├─ layout.json       hình dạng canvas (toạ độ + cạnh nối)
   │  ├─ roles/*.yaml      nhân viên
   │  ├─ skills/*.md       kỹ năng, gồm cả skills/assistant.md
   │  ├─ knowledge/
   │  │  ├─ shared/        Assistant ghi, cả văn phòng đọc
   │  │  └─ agents/<id>/   riêng từng người, gồm agents/assistant/
   │  ├─ artifacts/        kết quả công việc
   │  ├─ tasks/            plan + receipt
   │  └─ .state/           master-session.json, pending.json
   └─ ke-toan/             y hệt, độc lập hoàn toàn
```

### Văn phòng độc lập hoàn toàn — và vì sao không có kho tri thức cấp công ty

Đã cân nhắc và **bác bỏ** tầng `company/knowledge/shared/`. Hai lý do, cả hai đều là lý do kinh tế:

1. **Tri thức cấp công ty sẽ nằm trong prefix cache của MỌI worker ở MỌI văn phòng.** Thêm 10 node × 250 token = +2 500 token vào từng `cache_write`, nhân với số vai trò, nhân với số văn phòng. Nó phình lên là cả công ty đắt lên cùng lúc, và không ai thấy vì sao.
2. **Nó phá tính tự chứa.** Hôm nay `offices/<id>/` zip lại là một template chạy được ở máy khác. Có tầng cấp công ty thì copy một văn phòng đi nơi khác là mất ngữ cảnh — và "xuất template = copy thư mục" là tính năng gần như miễn phí duy nhất ta đang có.

Muốn dùng chung tri thức thì copy node sang, hoặc (M2) một lệnh `agentco knowledge copy`. Đắt hơn một lần, rẻ hơn mãi mãi.

**Văn phòng không giao việc cho nhau.** Đó chính là bài toán agent-to-agent mà kiến trúc cố tránh, không phải một mở rộng của canvas. Vẫn ở M3+.

---

## 3. Khởi điểm sạch

`agentco init` tạo **đúng** `company.yaml` và một thư mục `offices/` rỗng. Không vai trò mẫu, không văn phòng mẫu.

Giao diện lúc đó có **một nút duy nhất: "Tạo văn phòng"**. Đây là trạng thái rỗng được thiết kế, không phải màn hình lỗi — tiêu chí "Ổn định" đòi đúng điều này.

Lý do bỏ vai trò mẫu: người dùng đầu tiên của v0 mở lên thấy ba nhân viên lạ hoắc mà họ không đặt tên, không hiểu vì sao có, và không dám xoá. Thà bắt đầu từ số không rồi tự thêm từng người — mỗi người thêm vào là một quyết định họ hiểu.

Template mẫu vẫn còn giá trị, nhưng ở dạng **chọn khi tạo văn phòng**, không phải bị nhét sẵn.

### Đổi tên văn phòng — tên đổi, MÃ không đổi

`PATCH /api/office/:id { name }` chỉ ghi lại `name` trong `office.yaml`. **`id` giữ nguyên vĩnh viễn.**

`id` là *tên thư mục*. Đổi nó là dời `artifacts/`, `tasks/`, `.state/`, mọi đường dẫn đã ghi trong receipt cũ, và session của Trợ lý — để đổi một cái nhãn. Người dùng đổi tên vì cái nhãn đọc sai, không phải vì họ muốn dời nhà; im lặng dời cả thư mục là làm nhiều hơn thứ họ yêu cầu.

**Luật hợp lệ, thi hành ở SERVER (client nào cũng POST thẳng vào daemon được):**

| | |
|---|---|
| gộp khoảng trắng | `"Nội  dung "` → `"Nội dung"`. Hai tên chỉ khác nhau ở khoảng trắng hiện ra **giống hệt** trong ô chọn văn phòng |
| không rỗng, ≤ 60 ký tự | rỗng theo nghĩa `slugId` — `"😀"` cũng là rỗng |
| **không trùng tên** | khoá so trùng là `slugId(name)`, đúng cái hệ thống dùng để đặt tên thư mục |

Dùng lại `slugId` làm khoá so trùng là có chủ ý: chỉ có **một** định nghĩa "trùng". `"Nội dung"`, `"nội  dung"`, `"Noi Dung"` đều ra `noi-dung`. Nếu `createOffice` so theo slug còn `rename` so theo chuỗi thô thì đổi tên trở thành **cửa sau** để tạo ra đúng cái trùng lặp mà lúc tạo mới đã bị chặn.

Kiểm trùng nằm ở `Company`, không ở `Office`: chỉ công ty mới nhìn thấy các văn phòng khác. Office tự chứa và không biết hàng xóm là ai — đó là điều kiện để zip `offices/<id>/` thành template chạy được ở máy khác.

### 3.1 Xoá có HAI mức: **Lưu trữ** và **Xoá hẳn**

`office.yaml → archived: true` — **chỉ một cờ.** Không dời file, không đổi mã, không đụng `artifacts/` hay session của Trợ lý. Khôi phục là trở lại nguyên vẹn, kể cả cuộc hội thoại đang dở.

**Lưu trữ nghĩa là ĐÓNG BĂNG, CHỈ ĐỌC:**

| Còn làm được | Không làm được |
|---|---|
| xem sơ đồ, kết quả cũ, nhật ký, prompt | nhắn tin, nhận việc |
| **vẫn có TÊN trong sổ chi phí** | sửa bất cứ thứ gì (tên, model, skills, sơ đồ, nhân viên) |

Thi hành bằng **một chốt duy nhất** `Office.assertLive()`, gọi ở đầu mọi hàm ghi. Một chốt một câu, thay vì rải điều kiện khắp nơi rồi sót một chỗ — mà chỗ sót nguy hiểm nhất là chỗ tiêu tiền.

> **Vì sao KHÔNG cho chạy:** "đã xoá nhưng vẫn âm thầm tiêu tiền" là hành vi không ai đoán được, và tiền là thứ duy nhất người dùng không lấy lại được.

**Vì sao có mức này:** một văn phòng xoá hẳn để lại những dòng tiền trong `usage.jsonl` mà **không ai giải thích được nữa** — chỉ còn cái mã trần. Lưu trữ giữ được cái tên.

Mức cũ *"chỉ đóng, giữ file"* đã bị bỏ: lưu trữ thay nó và tốt hơn hẳn (khôi phục ngay trong app, không phải đi chép thư mục). `DELETE /api/office/:id` giờ chỉ còn **một** nghĩa là xoá hẳn — hai ý định khác nhau thì không đi chung một động từ với một cờ trên query string, vì cờ đó rất dễ quên và hậu quả không lấy lại được. CLI: `office archive` · `office restore` · `office rm --yes`.

---

## 4. Assistant — công dân hạng nhất của văn phòng

Mỗi văn phòng tạo ra sẽ có **đúng một Assistant, không xoá được**. Không có Assistant thì không ai chia việc.

### 4.1 Hai lớp prompt, ranh giới rõ ràng

| Lớp | Nội dung | Sửa? | Xem? |
|---|---|---|---|
| **Core** (mã nguồn) | giao thức nói chuyện với agent, giao thức Receipt, luật "giao việc đừng tự làm", cách với tới kho tri thức và tool | ❌ | ✅ **luôn xem được** |
| **Skills** (`skills/assistant.md`) | tính cách, giọng điệu, kiến thức ngành, thói quen, ưu tiên | ✅ | ✅ |

**Core xem được là bắt buộc, không phải tuỳ chọn.** Người dùng advanced cần *thấy* mới tin; giấu đi thì họ đoán, và đoán sai thì họ viết skills chống lại chính hệ thống.

Ranh giới đặt ở đâu: **thứ gì đang thi hành một bất biến trong `SPEC-token-economy.md` thì là core.** Nói cách khác, core là phần thuộc về *mã nguồn*, không thuộc về *việc vận hành doanh nghiệp`. Người dùng điều hành công ty của họ; họ không sửa giao thức mạng.

Có một cửa thoát: mở khoá sửa core được, sau một dialog cảnh báo, **mặc định tắt**. Ai bật là biết mình đang làm gì và tự chịu.

### 4.2 Assistant có skills ngoài — quyết định giữ

Đã cân nhắc bỏ hẳn skills của Assistant cho gọn. **Giữ**, vì đúng lý do bạn nêu: skills ngoài là chỗ người dùng biến công cụ thành thứ của riêng họ, và một trong hai nhóm khách đã chốt là người thích tự custom.

Bản mặc định ship kèm phải **rất ngắn** — vài dòng về giọng điệu và ngôn ngữ, không hơn. Nó nằm trong prefix cache của mọi lượt trò chuyện, nên mỗi dòng thừa là một khoản thuế thu suốt ca làm việc. Để trắng cũng là lựa chọn hợp lệ.

### 4.3 Assistant có sổ tay riêng, và ghi được kho chung

- **Sổ tay riêng** — `knowledge/agents/assistant/`. Cùng cơ chế với mọi agent khác, không sinh thêm máy móc gì. Đây là chỗ nó nhớ "văn phòng này hay yêu cầu kiểu X", "chia việc kiểu Y thì hỏng".
- **Kho chung** — `knowledge/shared/`. Assistant là bên **duy nhất** được ghi vào đây; worker chỉ ghi vào sổ tay của chính mình. Lý do: kho chung nằm trong prefix của cả văn phòng, cho ai cũng ghi được thì nó phình theo cấp số nhân và không ai chịu trách nhiệm.

Bài học của Assistant thu tại bước tổng kết đã có sẵn (`master.report()`), **không tốn thêm lượt gọi nào**.

### 4.4 MCP/API của Assistant thực chất là của worker ẩn

Giữ nguyên thiết kế `concierge`: Assistant thấy một tool `quick_action`, runtime bung một query one-shot phía sau. Master không bao giờ tự cầm MCP — nó resume liên tục, mà MCP phá prompt cache khi resume ([#247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247)), mất ~36 000 token quy đổi **mỗi lượt trò chuyện**.

Người dùng không cần biết cơ chế. Trên canvas, cắm MCP vào Assistant là một thao tác hợp lệ và mô tả "Assistant dùng được tool này" là **đúng**.

### 4.6 `/clear` — nén trí nhớ vào sổ tay riêng, rồi bắt đầu mới

**Vì sao chủ động nén thay vì để CLI tự nén.** Claude Code CÓ auto-compact — SDK phơi ra hook `PreCompact`/`PostCompact` với `trigger: 'manual' | 'auto'`. Nén **sẽ** xảy ra dù ta muốn hay không.

Rủi ro không phải tràn bộ nhớ, mà là: nén tự động **là mất mát**, xảy ra ở ngưỡng ta không thấy, giữ lại thứ ta không chọn, vào một kho ta không đọc được. Trợ lý sẽ quên một quyết định nào đó, lúc nào đó, và không ai biết.

> **Nén sẽ xảy ra dù thế nào. Thà nó xảy ra ở thời điểm BẠN chọn, vào một kho BẠN đọc được.**

#### Bốn ràng buộc, mỗi cái giải một bài toán riêng

**1. Bộ khung SỰ THẬT do code dựng, chỉ hỏi model phần nó độc quyền biết.**
Việc đã chạy / kết quả ở đâu / tốn bao nhiêu đều nằm trong `tasks/index.json`. Bắt model kể lại là trả tiền để nhận một bản sao có thể sai. Ta đưa sự thật **vào** prompt và chỉ hỏi: *người dùng thích gì, đã chốt gì, đang dở gì.* Cùng luật với khối đường dẫn (§6).

**2. Ghi vào `knowledge/agents/assistant/`, KHÔNG vào kho chung.**
Kho chung nằm trong prefix của **mọi nhân viên**. Ký ức hội thoại của Trợ lý (*"khách chốt giọng vui nhộn"*) là thứ người viết bài không cần biết — đưa vào đó là bắt cả văn phòng trả tiền để đọc nhật ký của một người. `visible()` chỉ cho `shared` + `role:<chính nó>`, nên chốt này là **cấu trúc**, không phải kỷ luật.

**3. `supersedes` trỏ về bản nén trước.** Không có nó thì sau ba tháng kho đầy quyết định mâu thuẫn — trạng thái **tệ hơn** cả không nén. Xem §5 của `SPEC-2026-08-14-agentco.md`.

**4. Nén hỏng thì KHÔNG quên.** `compactMemory()` chỉ gọi `forget()` sau khi ghi node xong. Thà giữ một bản ghi dài còn hơn mất trắng.

#### Khi nào tự nén

| | |
|---|---|
| **Ngưỡng** | `budgets.master_compact_at` (mặc định 60 000), đo bằng `cache_read` **thật** của lượt gần nhất — không phải phép đếm tay |
| **Thời điểm** | ranh giới **một công việc vừa xong**, và chỉ khi không còn việc xếp hàng |

Cửa sổ là 200K nên 60K còn rất nhiều dư địa: mục tiêu là chặn **trước** auto-compact, không phải chạy đua với nó. Và vì `chi phí ≈ lượt × prefix × 0.1`, ngữ cảnh nhỏ là rẻ ở **mọi** lượt, không chỉ ở lượt nén.

Thời điểm quan trọng ngang ngưỡng: nén giữa lúc người dùng đang hỏi dở là cắt đúng chỗ mạch chuyện đang liền. Một việc xong là một **đường may tự nhiên**.

> ⚠ **Token của NHÂN VIÊN không tính vào đây.** Worker chạy `persistSession: false` ở `query()` riêng, khâu lập kế hoạch (`askOneShot`) cũng vậy. Chỉ `route()` (mỗi tin nhắn) và `report()` (mỗi ca) làm bản ghi Trợ lý phình. Nên nó lớn **rất chậm**.

#### Vì sao lưu trong kho tri thức chứ không phải một khối riêng cạnh Skills

Câu hỏi đúng, và câu trả lời là: **cùng một kho, hai cách NHÌN.**

Lưu chung `knowledge/agents/assistant/` để dùng lại **miễn phí** những thứ đã có: `supersedes`, lão hoá theo `hits`/`updated`, ngân sách `hot_knowledge_tokens`, và Librarian gộp trùng sau này. Một khối riêng ở tầng lưu trữ sẽ phải tự làm lại cả bốn thứ đó, làm lại tệ hơn, và sinh ra một cơ chế truy xuất thứ hai phải đồng bộ với cơ chế thứ nhất.

Nhưng ở tầng **hiển thị** thì phải tách, vì với người dùng đây là hai thứ khác hẳn:

| | Ai sinh ra | confidence | Lớp prompt |
|---|---|---|---|
| **Kinh nghiệm** | agent tự rút ra sau khi làm | 0.6 | `Kinh nghiệm nạp sẵn` |
| **Ghi nhớ** | **chính người dùng đã chốt** | 0.9 | `Ghi nhớ từ trò chuyện` |

Người dùng phải trả lời được *"hệ thống đang nhớ gì về tôi"* mà không phải lục kho. Gộp chung một dòng thì thứ nặng ký hơn bị lẫn mất.

**Nhân viên không có lớp này và không được có** — `describePrompt` chỉ thêm nó khi `who === 'assistant'`, và `visible()` đã chặn ở tầng dưới. Hai chốt, hai tầng, cùng một kết luận.

> ⚠ **Lỗi đã dẫm khi tách: node GHI NHỚ phải bị loại khỏi `hot()`.**
> Bản đầu chỉ tách ở tầng hiển thị mà quên loại nó khỏi bảng xếp hạng, nên nó nằm trong **cả hai** khối — bảng prompt phân lớp đếm 194 + 285 token trong khi 285 đã chứa trọn 194. Người dùng nhìn thấy chính xác điều đó và hỏi *"có phải nó đang nhắc chồng chéo không"*.
> Prompt thật lúc đó vẫn chỉ có một khối (chỉ `hot` được gửi đi) nên model không đọc hai lần — nhưng **bảng xem đã nói dối**, mà cả điểm của bảng đó là để tin được.
> Sửa: `hot()` loại node GHI NHỚ; `buildAssistantPrompt` nhận nó thành **khối riêng**, đặt **trước** khối kinh nghiệm với tiêu đề *"What the human has decided — follow these"*. Đo lại: **168 + 84**, không còn chữ nào lặp.
>
> Và việc loại khỏi `hot()` còn giải một chuyện quan trọng hơn: thứ **người dùng đã chốt** không được phép cạnh tranh chỗ với **bài học agent tự rút ra** trong top-N, rồi tụt hạng và biến mất âm thầm khi kho lớn dần.

#### Ba nhịp khi dọn — và vì sao phải đúng thứ tự

```
master.message   "Đang dọn cuộc trò chuyện, cất lại những gì bạn đã chốt…"
office.cleared   ← lệnh cho bên hiển thị: xoá những gì đang hiện
master.message   "Đã dọn xong. …"   ← dòng ĐẦU TIÊN của cuộc trò chuyện mới
```

Nhịp một tồn tại vì nén mất vài giây: không có nó thì người dùng gõ `/clear` xong nhìn vào ô chat im lặng và không biết lệnh đã ăn chưa.

`office.cleared` tách khỏi `master.message` vì nó là một **mệnh lệnh**, không phải một câu để đọc. Bridge như Telegram không xoá được tin đã gửi nên nó **bỏ qua** sự kiện này và chỉ đọc hai câu kia — cùng một luồng, mỗi bên hiển thị tự chọn cách phản ứng.

⚠ Thứ tự bắt buộc: `office.cleared` **trước**, câu báo kết quả **sau**. Ngược lại thì câu vừa hiện ra bị chính lệnh xoá cuốn đi.

#### Đã kiểm chạy thật

Người dùng chốt *"từ giờ dùng giọng vui nhộn"* → `/clear` → node ghi ra:

```
- Từ giờ mọi bài viết cho tiệm hoa Nắng Sớm phải dùng giọng vui nhộn…
- Không dùng đường dẫn lưu file tùy chỉnh kiểu artifacts/khoa/… — từng gây lỗi
- File artifacts/T-01/gioi-thieu-nang-som.md hiện chứa bản giọng sang trọng…
```

Session mới, hỏi lại → *"Có chứ, mình nhớ: giọng vui nhộn, không sang trọng/trang trọng nữa."*
`/clear` lần hai → node hai khai `supersedes` node một; prefix chỉ còn **một** khối "Ghi nhớ", **cả hai file vẫn trên đĩa**.

### 4.5 Đổi model — cho phép, và đây là cái giá

**Ranh giới:** CÔNG TY quyết *mỗi mức là model nào* (đó là **tiền** → `company.yaml → models`). VĂN PHÒNG quyết *Trợ lý của nó chạy ở mức nào* (đó là **công việc** → `office.yaml → assistant.model_tier`, bỏ trống = theo `models.master`). Nhân viên đã có sẵn `role.model_tier` — hình dạng y hệt, không đẻ thêm khái niệm.

#### Trí nhớ KHÔNG mất. Đã kiểm bằng thí nghiệm, không phải suy luận.

`resume: <sessionId>` nạp bản ghi hội thoại từ `~/.claude/projects/`. Bản ghi đó là **văn bản trên đĩa, độc lập với model**; `model` là một tuỳ chọn riêng của mỗi lời gọi `query()`.

> **Thí nghiệm (16/08/2026).** Lượt 1 trên `standard`: *"Nhớ giúp mình con số 4271"* → *"Ok, mình ghi nhớ số 4271 nhé."*
> Đổi sang `eco`. Lượt 2: *"Con số mình vừa nhờ bạn nhớ là số nào?"* → **"Số 4271 đó bạn."**

Đây là câu trả lời cho lo lắng *"đổi model có mất bộ nhớ ngoài không"*: **không**.

#### Cái mất là prompt cache — và nó RẺ HƠN DỰ ĐOÁN

Đo trên một hội thoại ~17 000 token ngữ cảnh, cùng văn phòng, cùng ngày:

| lượt | model | cache_read | cache_write | $ |
|---|---|---:|---:|---:|
| ổn định | haiku (eco) | 15 526 | 520 | 0,0040 |
| **đổi eco → standard** | sonnet | 19 033 | **1 894** | **0,0176** |
| ổn định | sonnet | 20 927 | 463 | 0,0098 |
| **đổi standard → eco** | haiku | 16 046 | **1 498** | **0,0051** |
| ổn định | haiku | 17 544 | 482 | 0,0033 |

**Lượt đổi tốn thêm ~1 000–1 400 token ghi cache, tức khoảng +60–80% của MỘT lượt. Một lần, rồi thôi.**

Dự đoán ban đầu là phải ghi lại toàn bộ ~17 000 token (≈ $0,22 ở mức sonnet). Số đo bác bỏ điều đó: `cache_read` vẫn cao ngay ở lượt đổi. ⚠ **Cơ chế vì sao thì chưa giải thích được** — đừng xây quyết định lên phần chưa hiểu, hãy đo lại nếu ngữ cảnh dài hơn nhiều.

#### Bất biến: đổi model KHÔNG được chạm vào việc đang chạy

`Office.applyCompanyConfig` dựng một `LoadedOffice` **MỚI**, không bao giờ sửa `this.loaded` tại chỗ. `Scheduler` của ca đang chạy giữ tham chiếu tới đúng object nó nhận lúc `run()`, nên **cả ca chạy hết bằng model cũ**.

Sửa tại chỗ (`this.loaded.company = next`) sẽ làm những task **chưa phóng** của cùng một kế hoạch chạy model khác các task đã phóng — và hoá đơn không còn giải thích được nữa. Cùng lý do với việc không giết worker đang chạy: *đổi luật giữa ván thì không ván nào đọc được*.

Trợ lý thì mỗi lúc chỉ làm một việc (hòm thư khoá), nên không có lượt nào bị đổi model giữa chừng. Mức mới áp dụng **từ lượt kế tiếp**.

#### Phương châm rút ra — áp dụng cho cả skills, model và mọi cấu hình

> **Ra bản nháp để SỬA còn hơn viết mới từ đầu.**
> Đã có ở chỗ bàn giao việc xếp hàng (§11f của `SPEC-tools-approval.md`) và ở chỗ không giết worker đang chạy. Đổi model là ca thứ ba: thứ đang chạy chạy nốt, thứ mới áp dụng cho luồng mới. Không có ngoại lệ nào cần "dừng tất cả để áp dụng cấu hình".

### 4.7 Trợ lý KHÔNG có tool — đã thử trao `Grep`, đo, rồi thu lại (19/08)

Người dùng nêu đúng một câu hỏi: *"Trợ lý phải là người biết rõ tủ tài liệu nhất, sao không cho nó quyền truy cập?"* Không có lý do nguyên tắc nào chống lại — `allowedTools: []` được chọn vì *"Trợ lý không tự làm việc tay chân"*, mà đọc mục lục thì không phải làm việc tay chân.

Nên đã thử: `tools: ['Grep','Glob']`, kèm một cổng chặn theo thư mục để nó **không** đọc được sổ tay riêng của nhân viên đã bị ngắt dây. Vùng cho phép suy thẳng từ `assignableRoles()` — cùng hàm `roster()` dùng, nên chỉ có MỘT nguồn sự thật và cắt dây thì cả hai đổi cùng lúc.

**Cổng đó không bao giờ chạy. Ba cơ chế, không cơ chế nào nổ một lần nào:**

| thử | kết quả |
|---|---|
| `canUseTool` (với `allowedTools: []`) | không nổ |
| `canUseTool` + đổi `prompt` sang streaming input | không nổ |
| hook `PreToolUse`, có và không có `matcher: '*'` | không nổ |

Đo bằng cách ghi **mọi** quyết định của cổng ra `.state/gate.log`: file **rỗng tuyệt đối** trong khi `Grep` vẫn chạy và vẫn đọc được đúng file lẽ ra bị cấm.

⚠ **Ranh giới của phép đo, đừng suy rộng hơn:** đã đo với `Grep`/`Glob` — tool **chỉ-đọc**. Suy đoán tốt nhất là chúng được CLI tự duyệt nên không đi qua đường phê duyệt nào. **Chưa đo** `Bash` hay tool ghi, nên §8 (cổng duyệt) **chưa bị bác bỏ** — nhưng phải đo lại trước khi xây, đừng tin vào tài liệu.

#### 🔥 Vì sao phải BỎ HẲN chứ không "tạm chấp nhận không có cổng"

Khi bị hỏi về một file ngoài vùng cho phép, Trợ lý trả lời:

> *"Mình không có quyền xem file cấu hình hệ thống như office.yaml đâu, chỉ đọc được trong library, knowledge và artifacts thôi."*

**Nó có toàn quyền.** Nó đang diễn theo bản đồ thư mục ta viết trong prompt. Không có hàng rào thì người dùng còn biết là không có; một hàng rào **giả** được model thuật lại đầy tự tin thì tệ hơn hẳn — và đó đúng là luật *"đừng bao giờ để model tự giải thích hệ thống cho người dùng"* (§5d): nó không có quyền truy cập nội quan, nó bịa một câu nghe hợp lý, rồi người dùng tin.

#### Đường ra có tồn tại, và vì sao vẫn không đi

Tự khai một tool MCP của mình (`createSdkMcpServer` + `tool()`) với tham số `where` là **ENUM** dựng từ `assignableRoles()` thì thao tác sai **không diễn đạt được** — chặn bằng cấu trúc, mạnh hơn mọi cổng kiểm. Nhưng *"Trợ lý KHÔNG gắn MCP"* là luật cứng: MCP phá prompt cache khi resume (~36 000 token quy đổi mỗi lượt), mà `route()` resume ở **mọi tin nhắn**. Đổi 36K token/lượt lấy một tiện ích là lỗ nặng.

#### Cái giá của việc bỏ: đo được là BẰNG KHÔNG

Cả hai lần chạy lại bài 2 (có tool và không tool), Trợ lý **không gọi tool nào**. Bảng kê tủ tài liệu trong prefix (`SPEC-library.md` §8b) đã đủ để nó lập kế hoạch đúng và đưa `inputs` trỏ đúng file. Thứ giải được bài toán là **dữ liệu trong prefix**, không phải khả năng đi tìm.

> **Bài học: một khả năng không chặn được thì đừng trao.** Và nếu đã trao rồi mới biết không chặn được, thu lại — đừng vá bằng một câu dặn trong prompt, vì model sẽ diễn câu dặn đó thành một lời bảo đảm sai.

---

## 5. Worker — cũng hai lớp

Không có gì mới về cơ chế, chỉ là nói rõ ra và cho xem được:

| Lớp | Nội dung | Sửa? | Xem? |
|---|---|---|---|
| **Core** (mã nguồn) | giao thức Receipt, kỷ luật số lượt, luật ghi file thay vì dán nội dung, cách nhận tri thức | ❌ | ✅ |
| **Skills** (`skills/<role>.md`) | cách làm việc của vai trò này | ✅ | ✅ |
| **Sổ tay riêng** (`knowledge/agents/<role>/`) | agent tự ghi khi rút ra bài học. Mới tạo thì **trắng** | ✅ | ✅ |

### 5.1 Nhân viên cũng có hai mức: **Lưu trữ** và **Xoá hẳn**

`roles/<id>.yaml → archived: true`. Vai trò lưu trữ biến khỏi canvas **và** khỏi roster của Trợ lý — tức là `pitch` của nó rời khỏi prefix cache. Cất một người đi là **tiết kiệm token thật**, giống ngắt dây nhưng dứt khoát hơn.

Khôi phục thì họ trở lại đúng văn phòng cũ, vì **họ chưa bao giờ rời đi**: file không di chuyển, chỉ một cờ được gỡ.

> ⚠ **Vì sao phải có cờ, "bỏ khỏi sơ đồ" là không đủ.**
> Bản trước xoá node khỏi `layout.json` rồi giữ file yaml. Nghe thì đúng — nhưng `layout.read()` **tái tạo node từ `office.roles`** ở lần đọc kế tiếp. Nhân viên "đã bỏ" quay lại canvas ở một ô lưới khác, chỉ mất sợi dây. Tức là thao tác đó **chưa bao giờ thật sự bỏ được cái gì**.
> Cờ trong yaml là nguồn sự thật DUY NHẤT: canvas, roster và scheduler đều đọc nó. Không có đường nào để một nhân viên đã cất nhận được việc.

Ba chỗ dễ quên khi thêm cờ này, cả ba đều đã dẫm:
1. **Vòng quét node mồ côi** phải bỏ qua vai trò lưu trữ — nếu không, cất xong nó hiện lại **màu đỏ**, tệ hơn cả không cho cất.
2. **`LayoutStore.save()`** phải bỏ qua vai trò lưu trữ khi đồng bộ `mcp:` — nó không có node nên không có cạnh nào trỏ tới, và mỗi lần ghi sơ đồ sẽ **xoá sạch danh sách tool** của nó.
3. **`assignableRoles()`** phải lọc ở tầng vai trò, không dựa vào cạnh nối: chưa có `layout.json` thì `assignable` là `undefined` = "tất cả", và "tất cả" phải không gồm người đã cất.

Xoá hẳn thì mất `roles/<id>.yaml` và skills. Nhưng **sổ tay kinh nghiệm ở `knowledge/agents/<id>/` CỐ Ý được giữ** — đó là thứ văn phòng đã học được, không phải tài sản riêng của một cái tên. Xoá người mà xoá luôn bài học là mất thứ đắt nhất trong cả thư mục.

> **BẤT BIẾN: đọc và ghi file skills phải đi qua ĐÚNG MỘT hàm giải đường dẫn** (`skillFileFor`).
>
> Lỗi đã xảy ra: giao diện **ghi** vào `skills/<id>.md` (đường dự phòng của `describePrompt`) còn `loadSkill` chỉ **đọc** những gì khai trong `role.skills`. Nhân viên tạo từ giao diện có `skills: {}`, nên người dùng bấm Lưu → server ghi file thật → đọc lại vẫn ra rỗng. Nội dung họ vừa viết biến mất, **kể cả sau khi tải lại trang**, mà không có một câu lỗi nào.
>
> Thứ tự giải: khai trong yaml → `skills/<id>.<mức>.md` đã có trên đĩa (quy ước của v0) → `skills/<id>.md`. Hai đường dẫn khác nhau cho cùng một thứ là cách âm thầm nhất để làm mất việc của người dùng — cùng họ với `cheap`→`eco` không có alias.

### `secrets` — chìa khoá tool, cấp theo từng người

Vai trò khai **TÊN** chìa; giá trị nằm ở `company/.state/secrets.json` (gitignore, và API đọc file duy nhất — `ArtifactStore.resolve` — chỉ nhận đường dẫn nằm trong `artifacts/`, nên `.state/` không có cửa nào ra HTTP).

```yaml
# roles/inbox.yaml
mcp: [gmail]
secrets: [GMAIL_TOKEN]     # CHỈ chìa này được đưa vào môi trường tiến trình MCP
```

Ba tính chất, mỗi cái giải một vấn đề khác nhau:

| | |
|---|---|
| **Đặc quyền tối thiểu theo người** | nhân viên viết bài không cầm chìa vào cổng thanh toán, dù chung một văn phòng. Một agent bị prompt injection qua nội dung nó đọc chỉ cầm được đúng những chìa ta đã trao — cái giá của sai sót là hữu hạn. |
| **Giá trị KHÔNG vào prompt** | chìa là biến môi trường của tiến trình MCP. Model **dùng được tool**, nhưng **không đọc được khoá**. Đó là khác biệt giữa "agent có quyền" và "agent biết mật khẩu". |
| **Không có API** | `agentco secret set/list/rm` chỉ ở CLI. Bí mật không đi qua HTTP kể cả tới localhost — một endpoint đọc được chúng là một endpoint bị lừa gọi được. `set` nhận giá trị qua biến `VALUE`, không qua tham số dòng lệnh (tham số nằm trong lịch sử shell và danh sách tiến trình). |

**Trợ lý không có trường này.** Nó không tự cầm tool; việc cần tool đi qua worker ẩn, và worker đó là một vai trò có `secrets` riêng.

### Worker KHÔNG "mò vào" kho tri thức — điểm hay bị hiểu nhầm

Câu hỏi tự nhiên là: worker tự tìm trong kho, hay Assistant đọc hộ rồi giao? **Không bên nào**, và đó là chỗ kiến trúc này thắng cả hai phương án:

| | Ai làm | Giá |
|---|---|---|
| **HOT** — node hay dùng của vai trò | `KnowledgeStore.hot()` nhồi sẵn vào prefix được cache | ~0 khi cache ấm |
| **COLD** — node hợp với task này | `KnowledgeStore.cold()` chấm điểm từ khoá của brief | **0 token**, nằm sau cache breakpoint |

Cả hai đều chạy bằng **code, không gọi LLM**. Worker mở mắt ra là tri thức đã nằm sẵn trong prompt.

- Nếu worker tự tìm: mỗi lần tìm là một **lượt**, mà `chi phí ≈ số lượt × prefix × 0.1`. Đắt nhất trong ba phương án.
- Nếu Assistant đọc hộ rồi dán vào brief: nội dung đó nằm trong context Assistant **vĩnh viễn**, và đọc hai lần đúng như bạn lo.

→ Giữ nguyên. Đa văn phòng chỉ cần mỗi văn phòng một `KnowledgeStore` riêng.

---

## 6. Vòng đời công việc — Plan là đơn vị, không phải dòng chat

Log của v0 là một dòng chảy phẳng. Không đọc được khi hai việc chạy chồng nhau, và không trả lời được "việc hôm qua đã làm những gì".

### Luật phân biệt

Assistant định tuyến mỗi câu người dùng gõ thành một trong bốn:

| intent | nghĩa | hệ quả |
|---|---|---|
| `chat` | chào hỏi, hỏi về việc đã làm | trả lời, hết. **0 token worker** |
| `ask` | có vẻ là việc nhưng thiếu thông tin | hỏi lại một câu, chờ |
| `task` + `new` | việc mới, không liên quan việc đang chạy | **sinh Plan mới, độc lập** |
| `task` + `refine` | bổ sung/sửa cho việc vừa nói | **gắn vào Plan hiện tại** |

Phân biệt `new` với `refine` do Assistant quyết trên session của nó (nó có cả lịch sử hội thoại), không suy ra bằng heuristic ở client. Sai lệch về phía `new` — hai plan độc lập chỉ tốn thêm một lần lập kế hoạch, còn gắn nhầm vào plan cũ thì làm hỏng cả việc đang chạy.

### `say` KHÔNG BAO GIỜ chứa tên người nói

Sự kiện đã mang `role`; **bên hiển thị** tự tra tên từ đó. Ghép sẵn tên vào `say` thì người dùng đọc được *"Người viết: Người viết: Viết 3 đoạn…"* — tên hiện hai lần, ở cả nhật ký lẫn dòng trạng thái, vì cả hai đều gọi `labelFor(e.role)`.

Đây là luật GIAO THỨC, không phải thẩm mỹ: bridge Telegram cũng là một bên hiển thị và nó cần tự quyết cách gắn tên (in đậm, emoji, hay bỏ hẳn). Nướng sẵn tên vào chuỗi là tước quyền đó của mọi client tương lai.

### Dòng "đang làm gì" KHÔNG ĐƯỢC ĐỨT MẠCH

Từ lúc người dùng bấm Gửi tới lúc có kết quả, luôn phải có một câu mô tả việc đang diễn ra.

Bản trước đứt đúng một nhịp — giữa lúc Trợ lý đọc xong yêu cầu và lúc kế hoạch hiện ra. Nguyên nhân: `handleUserBatch` gọi `run()` **không await** rồi trả về, nên hòm thư mở khoá ngay và `pump()` phát một `office.activity` toàn số 0, đúng lúc `run()` mới bắt đầu lập kế hoạch. Người dùng thấy *"Trợ lý đang nghĩ…"* → **im bặt 15 giây** → kế hoạch. Khoảng im bặt đó chính là chỗ họ tưởng hệ thống chết và bấm Gửi lần nữa.

Hai lớp bảo vệ, cố ý chồng nhau:
1. `office.activity.assistant` có trạng thái thứ ba **`planning`**, đọc từ `currentRecord.status` — tức là từ **bản ghi công việc**, thứ tồn tại từ trước khi lập kế hoạch. Không suy ra từ hòm thư, vì hòm thư chính là chỗ đã sai.
2. Bên hiển thị: còn `plan_id` mà không có "bit" nào bật thì hiện *"Đang chạy…"*. Bắt trọn mọi nhịp ngắn còn lại (vừa lập kế hoạch xong, chưa phóng task đầu).

### Cái gì sống sót qua tắt daemon — và màn hình phải nói đúng cái đó

| | Ở đâu | Sống sót? |
|---|---|---|
| Hội thoại của Trợ lý | `~/.claude/projects/<hash-cwd>/<session>.jsonl` (CLI giữ) + con trỏ `.state/assistant-session.json` | ✅ |
| **Luồng chat trên màn hình** | `.state/chat.jsonl` | ✅ *(từ 16/08; trước đó ❌)* |
| Nhật ký công việc, báo cáo | `tasks/index.json`, `<plan_id>.log.jsonl` | ✅ |
| Tri thức, artifact, skills | file | ✅ |
| Việc đang xếp hàng (`jobs`) | **chỉ trong bộ nhớ** | ❌ |
| Hòm thư Trợ lý | **chỉ trong bộ nhớ** | ❌ |
| Kế hoạch đang chạy | bộ nhớ; bản ghi kẹt ở `status: running` vĩnh viễn | ❌ |
| `pending.json` | có ghi, **chưa ai đọc** | ❌ (mã chết) |

**Lỗi đã sửa: model nhớ, màn hình quên.** Ô chat đọc từ một vòng đệm 300 sự kiện *trong bộ nhớ*, nên tắt daemon rồi mở lại là **trắng trơn** — trong khi Trợ lý vẫn trả lời tiếp được câu hỏi dở dang như chưa hề mất gì. Người dùng gặp đúng cảnh này và mô tả là *"ảo quá"*: không còn tin được cái nào nói thật.

Sự kiện thuộc một công việc vốn đã ghi ở `<plan_id>.log.jsonl`. Chỗ hổng đúng là **hội thoại** (`plan_id: null`) — thứ không thuộc việc nào nên không file nào nhận. Giờ có `.state/chat.jsonl`.

> ⚠ Khi hỏi, model **không biết** trí nhớ của nó nằm ở đâu. Được hỏi thẳng *"tại sao bạn nhớ được, tôi vừa tắt daemon rồi?"*, Trợ lý trả lời *"Mình chỉ nhớ trong phạm vi cuộc trò chuyện đang mở này thôi, không phải nhờ daemon nào cả"* — nghe hợp lý và **sai hoàn toàn**. Đừng bao giờ để model tự giải thích kiến trúc của chính nó cho người dùng.

### Câu chat thuộc về công việc nào — không có mã liên kết, và đó là lựa chọn

Người dùng hỏi *"nếu ngày mai tôi mới gõ `200 từ, hài hước` thì sao?"* → vẫn đúng, không giới hạn thời gian.

Cơ chế: `route()` chạy **trên session Trợ lý**, tức là có toàn bộ bản ghi hội thoại, rồi trả `intent` + `scope: new | refine`. Không có correlation id, không có bảng "câu hỏi đang chờ ↔ công việc". Model đọc ngữ cảnh và tự nối.

Đánh đổi, nói thẳng: rẻ và tự nhiên (0 cấu trúc thừa), nhưng **liên kết đó chỉ tồn tại trong bản ghi hội thoại**. Mất session = mất liên kết, không có đường lui. Và bản ghi đó **đang phình vô hạn**: `budgets.master_compact_at` được khai trong schema nhưng **chưa ai dùng**. Đó mới là trần thật của "chạy trọn đời", không phải daemon.

### Mọi sự kiện đều mang `plan_id` và `office`

Đây là điều kiện để log đọc được, và cũng là điều kiện để UI đa văn phòng không hiển thị nhầm. Sự kiện không thuộc plan nào (`master.message` lúc chat) mang `plan_id: null` và về luồng hội thoại.

### Khoảng im lặng phải được lấp — và lấp bằng 0 token

Từ lúc người dùng bấm Gửi tới lúc Trợ lý trả lời là 5–15 giây. Không nói gì trong khoảng đó là chỗ người ta bấm Gửi lần thứ hai.

Nên có một trường `activity` chạy suốt: `đang đọc yêu cầu…` → `Trợ lý đang lập kế hoạch...` → `Người viết: đang viết bai_1.md` → hết. Mọi câu đều lấy từ `say` của sự kiện **đã có sẵn**; không lượt gọi LLM nào tồn tại chỉ để hiển thị — đó là ràng buộc chéo của bốn tiêu chí.

**Với Telegram (sau này):** làm được, và tối thiểu là đủ. `sendChatAction: 'typing'` làm chấm "…" của Telegram, làm mới mỗi ~4 giây trong lúc còn `activity`. Nếu muốn hơn thì gửi một tin rồi `editMessageText` mỗi khi `activity` đổi — vẫn 0 token, vì `say` đã có sẵn trong sự kiện.

### Bước không có task nào thì KHÔNG PHẢI một bước

Model rất hay viết một bước kiểu *"Lưu kết quả vào file"* rồi không giao task nào cho nó — vì việc đó đã nằm trong task trước. Bước như thế không ai tick được: nó đứng nguyên ở "chưa làm" kể cả khi mọi việc đã xong, và người dùng nhìn vào tưởng hệ thống bỏ sót.

Lọc bằng **code** lúc dựng kế hoạch (bỏ bước rỗng, đánh lại chỉ số), không bằng cách bắt model lập lại — rẻ hơn một lượt gọi và deterministic. Prompt cũng dặn thêm, nhưng dặn là gợi ý còn lọc là bảo đảm.

Kèm theo: một bước có **nhiều task** chỉ done khi **mọi task** của nó đã kết thúc — đếm theo task đã xong, đừng hỏi "bước này done chưa" (câu hỏi tự tham chiếu chính nó, và bước nhiều task sẽ kẹt mãi ở "đang làm").

### Kết quả nằm ở đâu — suy từ TOOL ĐÃ GỌI, không từ lời model kể

Câu tổng kết của Trợ lý kết thúc bằng một khối ghép sẵn bằng code:

```
Kết quả đã lưu tại:
  company/offices/noi-dung/artifacts/T-01/gioi-thieu-am-ap.md
Đã ghi ra ngoài qua: notion
Có chạy lệnh trên máy — kết quả có thể nằm ngoài thư mục văn phòng.
```

**Ba đời, và vì sao hai đời đầu chưa đủ:**

| | Nguồn | Hỏng ở đâu |
|---|---|---|
| 1 | model tự nhắc trong câu tổng kết | **ngẫu nhiên** — không ai bảo đảm, nên nó mất |
| 2 | `receipt.artifacts` | vẫn là lời model **KỂ** (bịa được), và **chỉ mô tả được FILE** |
| 3 | `receipt.landed` — suy từ `tool_use` quan sát trong luồng | ✅ |

Đời 2 hỏng ở một chỗ tinh vi: không phải kết quả nào cũng là file. Kết quả có thể nằm ở Notion, Google Sheets, một database. Với những ca đó `artifacts` rỗng, khối này **im lặng**, và ta lại quay về phụ thuộc câu chữ của model — đúng thứ vừa bỏ đi.

Lối ra **không phải** sửa prompt. `worker.ts` đã đọc từng khối `tool_use` để dựng dòng *"đang làm gì"*, chỉ là vứt đi sau khi ghép câu. **Tool đã gọi là sự việc quan sát được, không phải lời kể.** Giữ lại là xong — 0 token, không đụng một chữ prompt nào.

Ba loại điểm đến, và **cách nói phản ánh đúng mức chắc chắn**:

| `kind` | Biết được gì | Nói thế nào |
|---|---|---|
| `file` | kiểm `existsSync` → chắc chắn | *"Kết quả đã lưu tại"* + đường dẫn đầy đủ |
| `external` | biết chắc đã gọi server nào, không kiểm được nó lưu ra sao | *"Đã ghi ra ngoài qua: notion"* |
| `command` | **không biết dữ liệu đi đâu** | nói thẳng là không biết |

`command` là phần bất định còn lại. Nó được **khoanh vùng và dán nhãn**, không bị giấu — chi tiết còn lại nằm ở câu `say` của chính nhân viên, và đó đúng là việc của `say`, không phải dặn thêm gì mới có.

Hai chi tiết bắt buộc:
- **Đường dẫn ra ngoài thư mục văn phòng bị loại** (`safeJoin` ném) — ta không khai một file ngoài kia là "kết quả của bạn".
- **Đường dẫn tính từ thư mục làm việc**, không từ thư mục văn phòng. `artifacts/T-01/x.md` đứng một mình thì đúng về kỹ thuật mà vô dụng với người lần đầu đi tìm.

> Mẫu chung đáng nhân rộng: **thứ gì ta QUAN SÁT ĐƯỢC thì đừng hỏi model.** Hỏi model là trả tiền để đổi lấy sự bất định — kể cả khi nó trả lời đúng chín lần trên mười.

### Câu báo cáo phát ĐÚNG MỘT LẦN

`master.message` mang câu báo cáo. `plan.finished` là sự kiện **cấu trúc** (trạng thái + tiền) và **cố ý không có `say`** — ngoại lệ duy nhất của bất biến "mọi sự kiện hướng người dùng phải có say", vì nó không hướng người dùng. `office.state` khi kết thúc chỉ nói trạng thái (`Xong việc.`), không lặp lại báo cáo.

Ba chỗ cùng mang một câu thì nhật ký hiện ba dòng y hệt nhau nằm cạnh nhau.

### Prompt mặc định không được chứa lời nhắn gửi NGƯỜI DÙNG

Bản đầu tiên của `skills/assistant.md` mở bằng *"Đây là phần BẠN viết, xoá sạch cũng được"* — một câu nói với người, nằm trong prompt gửi cho model, trong prefix cache của **mọi lượt trò chuyện**. Model không sửa được file, nên câu đó là nhiễu có phí thu mãi mãi.

Cùng lỗi ở charter mặc định. Giờ charter mặc định có frontmatter đầy đủ và **thân rỗng** → khối charter biến mất hẳn khỏi prompt. Lời giải thích "bạn sửa được cái này" nằm ở bảng prompt phân lớp trên giao diện, nơi người dùng thật sự đọc nó và nơi nó tốn 0 token.

Kèm theo: charter là một **node tri thức**, nên nó có YAML frontmatter. Đọc nguyên file là nhét ~40 token metadata (`id`, `type`, `confidence`…) vào prefix của mọi nhân viên. Chỉ lấy phần thân.

#### Nhưng "rỗng" không được hiện ra là chữ `(trống)`

Bỏ lời hướng dẫn ra khỏi *file* là đúng; để lại một ô trắng cho người dùng tự đoán thì lại vi phạm tiêu chí "Ổn định" (mọi trạng thái rỗng phải là màn hình **được thiết kế**). Ba chỗ, ba vai trò khác nhau — đừng trộn:

| | Ở đâu | Token |
|---|---|---|
| **nội dung mặc định** | trong file → đi vào prompt | tính tiền **mãi mãi** → chỉ chứa **nội dung thật**, hoặc rỗng |
| **ghi chú** (`note`) | trên giao diện, luôn hiện | 0 — nói *khối này là gì, ai đọc nó* |
| **ví dụ mờ** (`placeholder`) | trên giao diện, chỉ khi trống | 0 — một **ví dụ thật**, không bao giờ được lưu |

Luật: *nội dung mặc định là nội dung thật, không phải lời dặn. Lời dặn ở `note`, ví dụ ở `placeholder`.*

Vì thế charter mặc định vẫn **rỗng** — ta không biết văn phòng của người dùng làm gì, và bịa ra một câu giới thiệu là nói dối bằng chi phí của họ. Còn skills mặc định của Trợ lý thì **có nội dung thật** (giọng điệu, luật hỏi lại), vì thứ đó đúng với mọi văn phòng.

### Màu theo agent

Mỗi agent — **kể cả Assistant** — được gán một màu ổn định, băm từ id vai trò. Băm chứ không lưu: thêm/bớt người không làm đổi màu người khác, và không cần một file cấu hình nữa để lệch.

---

## 7. Di trú từ v0

Công ty v0 có `roles/` ngay dưới `company/`. Khi mở, daemon tự dời vào `offices/mac-dinh/` và giữ nguyên mọi thứ bên trong, **một lần, tự động, có in ra thông báo**.

Không hỏi người dùng. Đây là thay đổi hình dạng thư mục do ta gây ra, không phải quyết định của họ.

---

## 8. API

Mọi endpoint làm việc trên một văn phòng đều mang `officeId` trên đường dẫn. Endpoint cấp công ty thì không.

```
GET    /api/company                    tên, danh sách văn phòng, models (mức → model)
PATCH  /api/company                    { models }  → đổi model cấp CÔNG TY  (§4.5)
POST   /api/office                     { name, template? }  → tạo, kèm Assistant
DELETE /api/office/:id                 XOÁ HẲN cả thư mục — không lấy lại được (§3.1)

GET    /api/office/:id                 trạng thái + plan đang chạy
PATCH  /api/office/:id                 { name?, assistant_tier?, archived? }
                                       đổi tên (§3) · mức model Trợ lý (§4.5) · lưu trữ (§3.1)
PATCH  /api/office/:id/agent/:role     { archived }  → cất/khôi phục nhân viên (§5.1)
DELETE /api/office/:id/agent/:role     XOÁ HẲN file yaml (sổ tay kinh nghiệm vẫn giữ)
GET    /api/office/:id/archived        nhân viên đang trong lưu trữ
GET    /api/office/:id/canvas          hình dạng + metadata để vẽ
PUT    /api/office/:id/canvas          ghi hình dạng
POST   /api/office/:id/agent           thêm nhân viên
DELETE /api/office/:id/agent/:role     bỏ khỏi sơ đồ (mặc định GIỮ file)
POST   /api/office/:id/say             cửa vào DUY NHẤT cho mọi thứ người dùng gõ
POST   /api/office/:id/stop
GET    /api/office/:id/knowledge       duyệt kho, 0 token
GET    /api/office/:id/plans           lịch sử công việc
GET    /api/office/:id/plans/:planId   log của đúng một công việc
GET    /api/office/:id/prompt/:who     prompt phân lớp — who = assistant | <role>

GET    /api/events                     SSE toàn công ty, mỗi sự kiện có office
GET    /api/cost                       chi phí, tách theo văn phòng
```

`GET /api/office/:id/prompt/:who` là hiện thân của "core xem được": trả về từng lớp kèm cờ `editable`, để UI hiện lớp core ở chế độ chỉ đọc chứ không giấu.

---

## 9. Giao diện — xem `SPEC-ui.md`

Chốt ngày 15/08: **React + Vite + Tailwind v4 + shadcn/ui**, daemon phục vụ `web/dist` tĩnh. Canvas vẫn là SVG viết tay, kéo node cập nhật bằng `ref` chứ không `setState` mỗi frame — tiêu chí "Hiệu năng" đòi 60fps kể cả lúc công ty đang chạy.

Chat, nhật ký, tổng quan chuyển hết vào sidebar trái đóng/mở được.

---

## 10. Ba đợt

| Đợt | Nội dung | Xong khi |
|---|---|---|
| **1 — nền** | `offices/`, di trú tự động, khởi điểm sạch, Assistant hai lớp prompt, vòng đời Plan, API mới | công ty chạy được đầu-cuối, UI cũ vẫn dùng tạm |
| **2 — giao diện** | React/Vite/Tailwind/shadcn, sidebar, canvas mới, log theo plan + màu, icon | thao tác được hết bằng giao diện mới |
| **3 — sản phẩm** | ranh giới lỗi, đường phục hồi, trạng thái rỗng, 60fps, log ảo hoá | bốn tiêu chí §1 thành checklist kiểm được |
