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

#### Độc lập tới đâu — kiểm ở BỐN tầng (chốt lại 20/08)

Câu hỏi của người dùng: *"các văn phòng đã có session độc lập với nhau chưa? có dùng chung cache không?"* Trả lời: **độc lập ở cả bốn tầng, không tầng nào là do may mắn.**

| tầng | cơ chế | hệ quả |
|---|---|---|
| Đối tượng | `Company.loadOffices()` dựng một `Office` riêng cho mỗi thư mục, mỗi cái có `KnowledgeStore` · `LibraryStore` · `ArtifactStore` · `Assistant` của nó | không chia sẻ gì trong RAM |
| Con trỏ session | `.state/assistant-session.json` nằm **trong** thư mục văn phòng | mỗi văn phòng một con trỏ hội thoại |
| Bản ghi hội thoại SDK | `cwd: office.dir` — Claude Code băm `cwd` thành thư mục riêng trong `~/.claude/projects/` | mỗi văn phòng một transcript |
| Cache priming gate | `CachePrimingGate` nằm **trong** `Scheduler`, mà `Scheduler` được dựng mới **mỗi ca** | không chia sẻ giữa văn phòng, cũng không giữa hai ca của cùng một văn phòng |

Còn **prompt cache phía Anthropic**: khoá theo *nội dung prefix*, và `BuiltPrompt.cacheKey` là hash của chính nội dung tĩnh. Hai văn phòng khác roster / tri thức / bảng kê tủ tài liệu → prefix khác → entry khác. Và kể cả khi hai prefix **giống hệt** thì việc trúng chung một entry cũng không rò rỉ gì: muốn trúng thì nội dung phải giống hệt, tức là không có gì để lộ.

> ⚠ **Đánh đổi đã biết, chưa sửa:** gate bị vứt sau mỗi ca nên task đầu của ca kế tiếp luôn coi cache là nguội, dù server còn giữ ấm (TTL 5 phút). Ca một task thì vô hại; ca nhiều task song song chạy lại trong 5 phút sẽ trả thừa **một** lần `cache_write`. Ghi nhận, chưa đáng sửa.

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

**4. Nén hỏng thì KHÔNG quên — nhưng chỉ khi hỏng còn SỬA ĐƯỢC.** `compactMemory()` chỉ gọi `forget()` sau khi ghi node xong. Thà giữ một bản ghi dài còn hơn mất trắng. ⚠ Từ 20/08 luật này có ngoại lệ bắt buộc — xem ngay dưới.

#### ⚠ `/clear` KHÔNG ĐƯỢC PHÉP KẸT (bản vá 20/08)

Bản trước gộp **mọi** lỗi nén vào cùng một nhánh *"giữ nguyên cuộc trò chuyện"*. Đúng cho lỗi tạm, **sai hoàn toàn** cho lỗi vĩnh viễn.

Nén chạy `resume: <session_id>`, và bản ghi hội thoại đó nằm trong `~/.claude/projects/` — **một thư mục agentco không sở hữu**. Người dùng dọn nó, đổi tên thư mục công ty, hay bê máy khác là bản ghi biến mất. Từ giây phút đó **mọi** lần gõ `/clear` đều ném cùng một lỗi và ô chat **không bao giờ dọn được nữa** — lệnh dọn duy nhất của sản phẩm chết cứng, còn câu lỗi thì nói *"mình giữ nguyên cuộc trò chuyện"* như thể đó là một lựa chọn.

| lỗi | xử lý |
|---|---|
| tạm (mạng, hết hạn mức, rate limit) | giữ nguyên hội thoại, mời gõ lại `/clear` sau |
| **session không còn tồn tại** (`sessionGone()`) | **vẫn dọn**, và nói thật đã mất gì |

> Mất trí nhớ là chuyện **đã rồi** ở thời điểm đó — bản ghi không còn thì không ai nén được nó nữa. Giữ thêm một ô chat không xoá được chỉ là mất lần thứ hai.

`sessionGone()` **không** dùng `classifyError`: hàm đó phân loại theo *cái giá phải trả* (có nên retry không), còn đây hỏi *cái ta định đọc còn tồn tại không*. Một lỗi mạng là `other`, một session đã bị xoá cũng là `other` — gộp lại là mất đúng thông tin cần dùng. Mặc định của nó là `false`: **khớp mẫu không chắc thì coi là lỗi tạm**, vì nhận nhầm một lỗi mạng thành "session mất" là ném đi một bản nén cứu được, còn nhầm chiều ngược lại chỉ tốn của người dùng thêm một lần gõ.

**Bài học chung:** một lệnh mà người dùng dùng để *thoát khỏi trạng thái xấu* thì bản thân nó không được có trạng thái xấu nào không thoát ra được.

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

#### Ba nhịp khi dọn — chốt lại 19/08: **KHÔNG NHỊP NÀO LÀ MESSAGE**

**Bản cũ (đã bỏ):**

```
master.message   "Đang dọn cuộc trò chuyện, cất lại những gì bạn đã chốt…"
office.cleared   ← lệnh cho bên hiển thị: xoá những gì đang hiện
master.message   "Đã dọn xong. …"   ← dòng ĐẦU TIÊN của cuộc trò chuyện mới
```

**Bản chốt:**

```
office.activity  "Đang dọn cuộc trò chuyện…"
office.cleared   ← lệnh cho bên hiển thị: xoá những gì đang hiện
office.activity  "Đã cất 3 điều bạn chốt vào sổ tay"    giữ ~4 giây
office.activity  null                                    → trắng
```

**Vì sao đổi — và lý do không phải thẩm mỹ.**

Nhịp một **vốn đã là status giả dạng message**: nó bị chính `office.cleared` ngay sau đó cuốn đi, luôn luôn, không có nhánh nào nó sống sót. Một tin nhắn được thiết kế để không bao giờ tồn tại quá một nhịp thì **nó là trạng thái**, không phải tin nhắn. Gọi đúng tên nó là trung thực hơn, không phải gọn hơn.

Nhịp ba tệ hơn: nó khiến `/clear` **để lại rác cho chính thứ nó vừa dọn** — người dùng gõ lệnh xoá cuộc trò chuyện và nhận về một cuộc trò chuyện có sẵn một dòng. Dòng đó lại **không thuộc về ai**: không phải người dùng hỏi, không phải Trợ lý trả lời, mà là hệ thống tự nói về chính mình.

> Cùng khuôn với `…thinking` → trắng: quá trình thì **hiện rồi biến**, chỉ **kết quả** mới ở lại. `/clear` không có kết quả nào thuộc về ô chat.

**Nhưng nội dung của nhịp ba KHÔNG được bốc hơi.** *"Đã cất 3 điều bạn chốt vào sổ tay · bỏ 12 ghi chú cũ"* chính là thứ làm `/clear` cảm giác **an toàn** thay vì **phá hoại** — bỏ hẳn thì lệnh này trông y hệt một nút xoá. Nên nó chuyển vào cùng dòng `activity`, giữ ~4 giây rồi tắt (đã có tiền lệ `4500ms` ở `store.ts`).

Bằng chứng **bền** không nằm ở ô chat và không cần nằm ở đó: node GHI NHỚ mới hiện ngay trong ngăn Tri thức, và `knowledge.changed` đã bump sẵn từ trước. Ô chat chỉ cần **trấn an trong 4 giây**, không cần **lưu trữ**.

**Hệ quả bắt buộc:** không nhánh nào của `/clear` được phát `master.message` nữa — kể cả nhánh lỗi (*"Chưa nén được trí nhớ…"*) và nhánh tự nén (`maybeCompact`). Nhánh **lỗi** là ngoại lệ đáng cân nhắc riêng: nó báo một việc **đã không xảy ra**, và người dùng cần biết ngữ cảnh vẫn còn nguyên. Chốt: lỗi vẫn đi bằng `activity`, nhưng giữ lâu hơn (~8 giây) — vì đây là tin xấu, và tin xấu thì đọc chậm hơn.

#### Trên Telegram: cùng một luồng, hiển thị khác — và đó là đúng thiết kế

Telegram **không có** khái niệm "xoá những gì đang hiện", nên `office.cleared` bị bỏ qua (lý do thật ở khối cảnh báo bên dưới). Thứ nó có là `editMessageText`, và `activity` vốn đã được đặc tả chạy qua đường đó (§6 *"Khoảng im lặng phải được lấp"*).

Nên `/clear` trên Telegram = **một tin duy nhất, tự sửa nội dung tại chỗ**:

```
"Đang dọn cuộc trò chuyện…"   →   "Đã cất 3 điều bạn chốt vào sổ tay"
```

Và nó **ở lại** — đọc như một **vạch ngăn** giữa hai cuộc trò chuyện. Người dùng nhìn thấy một tin nhắn "đã xong", nhưng nó **không phải một message trong luồng hội thoại**, nó là *process status đã đông cứng lại*. Hai bên hiển thị, hai kết cục, **cùng một luồng sự kiện, 0 token thêm** — vì mọi câu đều lấy từ `say` của sự kiện đã có sẵn.

`office.cleared` tách khỏi `master.message` vì nó là một **mệnh lệnh**, không phải một câu để đọc. Mỗi bên hiển thị tự chọn cách phản ứng: giao diện web xoá sạch `messages`; bridge Telegram **bỏ qua** và chỉ đọc hai câu kia.

> ⚠ **Sửa một lý do SAI đã ghi ở đây.** Bản trước viết *"Telegram không xoá được tin đã gửi"*. **Sai về kỹ thuật** — Bot API có `deleteMessage`, và bot xoá được tin của chính nó (trong 48 giờ). Lý do thật thì **mạnh hơn**: trên Telegram, khung chat **chính là bản lưu của người dùng**, không phải một khung nhìn có thể vẽ lại. Xoá hàng loạt tin cũ của họ vì một lệnh dọn ngữ cảnh là phá dữ liệu của người dùng để phục vụ một chi tiết cài đặt bên trong.
>
> Ghi lại vì đây đúng lớp lỗi hay gặp: một quyết định **đúng** được chống đỡ bằng một tiền đề **sai**. Ngày ai đó phát hiện `deleteMessage` tồn tại, họ sẽ tưởng quyết định cũng sai theo.

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

### `deliver` — kết quả rơi xuống ĐÂU, là trục THỨ HAI (chốt 19/08)

#### Đề bài, và vì sao chẩn đoán đầu tiên sai

Người dùng hỏi văn phòng hỗ trợ: *"Sản phẩm bên shop được bảo hành trong bao lâu vậy?"* → hệ thống lập kế hoạch, nhân viên đọc tủ tài liệu, và ô chat trả về:

> *"Đã trả lời câu hỏi. Kết quả đã lưu tại: `company/offices/ho-tro-khach/artifacts/P-mt08w0t8-iu50/T-01/tra-loi.md`"*

Chẩn đoán đầu tiên — *"ranh giới chat/task quá mong manh, Trợ lý định tuyến sai"* — **sai**. Định tuyến **đúng**: Trợ lý không có tool (§4.7), nên muốn biết chính sách viết gì thì bắt buộc phải có nhân viên đọc tài liệu. Đây **là** một task.

Hỏng ở chỗ khác: **một task chỉ có đúng MỘT hình dạng giao hàng.** `ASSISTANT_CORE` ép *"every task must write at least one file"*, `CORE_PROMPT` ép *"never paste file contents back in your reply"*, `receipt.say` bó về một câu. Nên dù Trợ lý hiểu đúng tuyệt đối rằng người ta chỉ muốn **biết**, bộ máy phía dưới vẫn chỉ đẻ ra được một **file**.

> **Hai trục độc lập, đừng trộn:** `intent` quyết **AI LÀM**. `deliver` quyết **KẾT QUẢ RƠI XUỐNG ĐÂU**.
> Trước 19/08, `deliver` bị đóng đinh `file` trong prompt — nên nó vô hình, và mọi nỗ lực sửa đều đi nhầm vào trục `intent`.

| `deliver` | dùng khi | người dùng làm gì tiếp |
|---|---|---|
| `reply` | họ muốn **BIẾT** một điều | **đọc**, rồi thôi |
| `file` | họ muốn **CÓ** một thứ | mở · gửi · sửa · lưu |

Câu hỏi phân biệt, gõ được thành một dòng: *kết quả có lọt vừa một bong bóng chat và người ta chỉ đọc nó một lần không?*

#### Vì sao KHÔNG xây `/answer [câu hỏi]`

Đã cân nhắc nghiêm túc và **bác bỏ**. Ba lý do, xếp theo sức nặng:

**1. Nó không khử được phần bất định mà nó hứa khử.** `/answer` vẫn phải: chọn vai trò, viết `goal`, viết `constraints`, chỉ đúng file trong tủ. Toàn bộ khối bất định nằm ở đó và lệnh này không chạm tới. Nó ghim **mỗi** hình dạng giao hàng — trả một cái giá giao diện đầy đủ để mua một mẩu rất nhỏ.

**2. Sai đối tượng.** Sáu lệnh hiện có đều là **động từ điều khiển cỗ máy** (`stop` `approve` `reject` `status` `help` `clear`). `/answer` sẽ là lệnh đầu tiên bắt người dùng **tự phân loại câu nói của chính mình trước khi nói**. Chủ tiệm hoa không làm việc đó — và đúng cái lần họ quên, họ lại gặp cái file.

**3. Đã có sẵn một cần gạt TẤT ĐỊNH, miễn phí, mà chưa ai kéo: VĂN PHÒNG.**

`ho-tro-khach` sinh ra để đẻ **câu trả lời**. `noi-dung` sinh ra để đẻ **file**. Đó không phải chuyện của từng tin nhắn — nó là thuộc tính của văn phòng, ổn định hàng tháng.

```yaml
# office.yaml
assistant:
  default_deliver: reply      # mặc định: file
```

Từ *"đoán lại ở mỗi tin nhắn"* thành *"đi đúng mặc định, model chỉ ghi đè khi thật sự khác"*. **0 token** (một dòng nằm trong prefix vốn đã cache), 0 gánh nặng cho người dùng. Đúng luật §4.3: **đừng dặn model đừng làm — đừng cho nó cơ hội làm.**

#### Cơ chế: HAI KÊNH, không kênh nào chở lại chữ của kênh kia

Nỗi lo đã nêu: *"assistant hiểu phải trả lời nhưng worker ghi file → assistant đọc file → nội dung truyền lại hai lần"*. Kịch bản đó **đòi hỏi Trợ lý đọc được file**, mà điều đó đã bị cấm cứng ở §4.7 **có số đo**. Bỏ nhánh không thể xảy ra đó đi thì thiết kế **chỉ còn đúng một hình dạng** — đó là dấu hiệu tốt, không phải trùng hợp:

```
receipt ─┬─ answer  (≤300 từ)  ──→ master.message, role = NHÂN VIÊN
         │                          ⛔ KHÔNG BAO GIỜ vào session Trợ lý
         └─ say     (1 câu)    ──→ report() y như hôm nay
                                    ✅ đây là thứ DUY NHẤT Trợ lý thấy
```

Bất biến chi phí **nguyên vẹn**: ngữ cảnh Trợ lý vẫn chỉ nhận một câu cho mỗi task, y hệt trước. `answer` là trường **mới**, không nới trần 500 từ của `say`.

Bốn hệ quả bắt buộc:

1. **Vẫn ghi file như cũ**, kể cả với `deliver: reply`. Miễn phí, và nó là mỏ neo cho lần `refine` sau (*"sửa câu trả lời nhẹ nhàng hơn"*) cùng dấu vết kiểm lại. Chỉ **thôi rao lên**.
2. **Chặn `whereBlock` cho task `reply`.** Người ta vừa đọc xong câu trả lời; dán thêm một đường dẫn vào dưới là nói lại cùng một chuyện bằng ngôn ngữ của máy.
3. **Plan chỉ có MỘT task `reply` thì bỏ luôn `report()`.** Câu trả lời của nhân viên **chính là** báo cáo. Đây là chỗ hết "cấn": không còn hai tin nhắn nói cùng một việc. Và nó **rẻ đi một lượt Trợ lý mỗi câu hỏi** — văn phòng hỗ trợ là nơi hình dạng chi phí này lặp lại nhiều nhất.
4. Cái giá phải nói thẳng: bỏ `report()` nghĩa là **session Trợ lý không chứa câu trả lời đó**. Lần `refine` sau nó biết *yêu cầu* (nó tự định tuyến) nhưng không biết *đã trả lời gì* — nó phải giao lại cho nhân viên đọc file. Chấp nhận: đúng một lượt nhân viên, đổi lấy việc ngữ cảnh Trợ lý **không phình theo số câu hỏi khách hỏi**. Với văn phòng hỗ trợ, đó là đánh đổi đúng chiều.

> Tiện thể giải một chuyện khác: văn phòng hỗ trợ **thôi in `P-…-iu50` ra chat**. Xem `SPEC-artifacts.md` §2.1.

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
| `pending.json` | có ghi, **đọc để ĐẾM, chưa ai chạy tiếp** | ⚠ nửa vời |

> ⚠ **`pending.json` — trạng thái thật, đừng gọi là "mã chết" nữa.** `Office.savePending()` ghi, `Office.readPending()` đọc, và `GET /api/company` **có** trả `pending: <số>` cho mỗi văn phòng (`server.ts`). Tức là con số đã lên được tới giao diện.
>
> Thứ **chưa** có là bên TIÊU THỤ: không có lệnh `agentco resume` nào cầm danh sách đó chạy tiếp. Hết hạn mức giữa chừng thì người dùng phải **nhắn lại bằng lời**, và Trợ lý làm lại từ kế hoạch mới. Đây là hai lỗ hổng khác nhau và chỉ một cái đã bịt — ghi rõ ra để lần sau không ai tưởng còn phải làm cả hai.

**Lỗi đã sửa: model nhớ, màn hình quên.** Ô chat đọc từ một vòng đệm 300 sự kiện *trong bộ nhớ*, nên tắt daemon rồi mở lại là **trắng trơn** — trong khi Trợ lý vẫn trả lời tiếp được câu hỏi dở dang như chưa hề mất gì. Người dùng gặp đúng cảnh này và mô tả là *"ảo quá"*: không còn tin được cái nào nói thật.

Sự kiện thuộc một công việc vốn đã ghi ở `<plan_id>.log.jsonl`. Chỗ hổng đúng là **hội thoại** (`plan_id: null`) — thứ không thuộc việc nào nên không file nào nhận. Giờ có `.state/chat.jsonl`.

> ⚠ Khi hỏi, model **không biết** trí nhớ của nó nằm ở đâu. Được hỏi thẳng *"tại sao bạn nhớ được, tôi vừa tắt daemon rồi?"*, Trợ lý trả lời *"Mình chỉ nhớ trong phạm vi cuộc trò chuyện đang mở này thôi, không phải nhờ daemon nào cả"* — nghe hợp lý và **sai hoàn toàn**. Đừng bao giờ để model tự giải thích kiến trúc của chính nó cho người dùng.

### Câu chat thuộc về công việc nào — không có mã liên kết, và đó là lựa chọn

Người dùng hỏi *"nếu ngày mai tôi mới gõ `200 từ, hài hước` thì sao?"* → vẫn đúng, không giới hạn thời gian.

Cơ chế: `route()` chạy **trên session Trợ lý**, tức là có toàn bộ bản ghi hội thoại, rồi trả `intent` + `scope: new | refine`. Không có correlation id, không có bảng "câu hỏi đang chờ ↔ công việc". Model đọc ngữ cảnh và tự nối.

Đánh đổi, nói thẳng: rẻ và tự nhiên (0 cấu trúc thừa), nhưng **liên kết đó chỉ tồn tại trong bản ghi hội thoại**. Mất session = mất liên kết, không có đường lui.

> ✅ **Cập nhật 19/08 — đoạn này từng ghi sai.** Bản trước viết *"bản ghi đó đang phình vô hạn: `budgets.master_compact_at` được khai trong schema nhưng chưa ai dùng"*. Đã dùng: `Office.maybeCompact()` đọc đúng ngưỡng đó, so với `assistant.contextTokens` (= `cache_read` thật của lượt gần nhất), và chỉ nén ở ranh giới **một việc vừa xong, không còn việc xếp hàng** — xem §4.6. Bản ghi **không** phình vô hạn nữa.
>
> Nhưng hệ quả tiếp theo thì có thật và vẫn chưa giải: **nén là mất liên kết.** Bản nén giữ *quyết định* của người dùng, không giữ *"câu này thuộc việc nào"*. Nên `refine` nói về một việc chạy trước lần nén gần nhất sẽ trượt về `new`. Chấp nhận được — sai về phía `new` đúng là hướng sai đã chọn ở §6 — nhưng phải biết là nó tồn tại, đừng ngạc nhiên khi gặp.

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

### Bốn chốt bằng CODE quanh một kế hoạch — đã chạy từ lâu, chưa từng viết ra

Cả bốn đều đã có trong mã nguồn và không có chốt nào được đặc tả ở đây. Bổ sung 19/08, vì đây là loại thứ **im lặng khi đúng** — nghĩa là không ai nhớ nó tồn tại cho tới hôm có người gỡ nhầm.

Xếp theo **thời điểm nổ**, và thứ tự đó là cả điểm của thiết kế: sửa được thì sửa, không sửa được thì chặn, chặn không được thì soi lại sau khi chạy.

| # | Chốt | Ở đâu | Lúc nào | Làm gì |
|---|---|---|---|---|
| 1 | `Scheduler.linkDeps` | `scheduler.ts` | **sau** lập kế hoạch, **trước** worker đầu | **SỬA** |
| 2 | `Scheduler.validate` | `scheduler.ts` | cùng nhịp, ngay sau (1) | **CHẶN** |
| 3 | `Office.missingOutputs` | `office.ts` | sau khi DAG chạy xong | **HẠ TRẠNG THÁI** |
| 4 | `worthLearning` | `assistant.ts` | trước khi hỏi Trợ lý tổng kết | **KHÔNG HỎI** |

**1 — `linkDeps`: task đọc kết quả của task khác mà quên khai `deps` thì NỐI THẲNG.** Quan hệ đó suy ra được từ hai đường dẫn ta đang cầm (một bên khai `outputs`, một bên khai `inputs`). Bắt model lập lại kế hoạch cho đúng là một lượt gọi nữa để đổi lấy một kết quả **vẫn có thể sai**. Nối xong thì **nói ra** — người dùng nhìn dải kế hoạch thấy hai việc chạy nối tiếp thay vì song song thì phải có một dòng giải thích, sửa lén là hành vi hệ thống không đoán được.

#### 1b. Đầu vào là một THƯ MỤC — bổ sung 20/08, sau một ca hỏng thật

Bài 6 (`rà hợp đồng`) là ca đầu tiên một task **không biết trước nó đẻ ra bao nhiêu file**: *"tách theo điều khoản, mỗi điều một file"* → số file bằng số điều khoản, chỉ biết sau khi đọc. Nên planner khai `inputs` của bước sau trỏ vào cả **thư mục** — đó là cách khai **đúng nhất nó có**, không phải một lỗi. Kế hoạch bị chặn thẳng:

```
· Task T-02 cần đọc "artifacts/P-260820-2044-ki6b/T-01/dieu-khoan/"
  nhưng không có file đó, và không việc nào tạo ra nó
```

**Hai nguyên nhân, và cái thứ hai chỉ lộ ra sau khi sửa cái thứ nhất** — đúng luật *"một triệu chứng tái phát hầu như luôn có nguyên nhân thứ hai"*:

| | Nguyên nhân | Sửa |
|---|---|---|
| a | **Dấu gạch cuối.** `outputScoper` cắt nó (nó tách chuỗi rồi bỏ mảnh rỗng), `artifactScoper` giữ. Hai chuỗi của **cùng một thư mục** bước vào `norm` khác nhau | `norm` bỏ gạch cuối |
| b | Thư mục **không bao giờ** `===` một file trong nó, nên kể cả khi T-01 khai `…/dieu-khoan/dieu-01.md` thì phép so vẫn trượt | `contains(dir, file)` — tiền tố **+ `/`** |

> ⚠ Tiền tố phải kèm `/`. `startsWith` trần thì `dieu-khoan` khớp `dieu-khoan-cu.md` — một dây nối **sai**, và nó xếp hai việc độc lập thành nối tiếp, chậm hơn mà không ai giải thích được vì sao.

Thư mục có **nhiều người ghi** thì nối **hết**: thiếu một dây là task đọc thư mục khi mới có một nửa số file — đúng loại hỏng im lặng mà `linkDeps` sinh ra để chặn.

Và `CORE_PROMPT` phải thôi tự mâu thuẫn: câu *"Do not list directories"* cấm đúng thứ task này buộc phải làm. Nay là *"an input path ending in `/` IS a folder and is meant to be read: list it once, read what is in it, and stop there"* — vẫn cấm đi lang thang, chỉ bỏ mệnh lệnh tuyệt đối.

**2 — `validate`: từ chối DAG hỏng NGAY, chưa phóng worker nào.** Bốn thứ bị chặn: vai trò không tồn tại (đối chiếu với **vai trò đang trực**, không phải mọi file trong `roles/` — nếu không thì cắt dây trên canvas chỉ là trang trí), `deps` trỏ vào task không có, hai task cùng ghi một đường dẫn, và phụ thuộc vòng tròn.

> Thứ tư đáng nói riêng: **`inputs` trỏ vào hư không.** Chỉ báo khi đường dẫn vừa **không có trên đĩa** vừa **không task nào sinh ra nó**. Trợ lý gõ nhầm một chữ trong tên tài liệu là nhân viên nhận một đường dẫn chết — và nó **không báo lỗi**: nó đi TÌM, tốn lượt, rồi hoặc trả `blocked`, hoặc **tệ hơn nhiều là trả lời bằng thứ nó đoán ra**. Cái giá là cả một task, và ca tệ nhất thì không ai biết là sai.

Câu báo cho người dùng phải nói được **việc phải làm**, không in nguyên văn danh sách kỹ thuật. Bản trước đưa *"Task T-02: phụ thuộc T-05 không tồn tại"* cho một người mở tiệm hoa đọc.

> ### ⚠ VÀ NÓ KHÔNG ĐƯỢC NÓI *"CHƯA TỐN TIỀN"* — sửa 20/08, user bắt được
>
> Bản trước ghi: *"Mình chia việc bị lỗi nên chưa chạy được — **chưa tốn tiền cho việc nào cả**."* Người dùng mở sổ chi phí ngay sau đó và thấy **có tiền**, rồi nhắn đúng ba chữ: *"Lỗi rồi, check usage vẫn còn"*.
>
> Câu đó sai vì lượt `route()` và lượt `plan()` vừa chạy xong **đều đã ghi vào sổ**. Nó là một câu an ủi, và nó nói dối đúng ở chỗ người dùng **kiểm được dễ nhất**.
>
> | | |
> |---|---|
> | Ta **biết chắc** | không nhân viên nào chạy — mà nhân viên mới là phần đắt (sàn ~13 200 token/lượt worker) |
> | Ta **không nên in ra số** | ở nhánh cửa cứu hộ, `usage` tại điểm này bằng **0** trong khi `route()` đã tính tiền → in số là đẻ ra một câu nói dối **thứ hai** |
>
> Câu đúng: *"Chưa nhân viên nào bắt tay vào — phần tốn tiền nhất chưa mất gì (lượt chia việc vừa rồi vẫn nằm trong sổ chi phí)."* Nói đúng phần biết chắc, chỉ thẳng sang sổ cho phần còn lại.
>
> → `SESSIONS_MEMORY` §2 *"Sổ chi phí không được nói sai câu nào"*. Luật đó viết cho sổ chi phí; ca này cho thấy nó áp cho **mọi câu nói về tiền**, ở bất cứ đâu trên màn hình.

**3 — `missingOutputs`: nhân viên báo `done` mà file đã hứa không có trên đĩa → hạ xuống `failed` và nói ra.** Đây là ca nói dối tệ nhất: người dùng đọc *"xong rồi"*, đi mở file, và không có gì. Khối *"Kết quả đã lưu tại"* (`whereBlock`) liệt kê thứ **có thật**, nên nó **im lặng đúng lúc cần nói to nhất** — chốt này lấp đúng chỗ đó. Chỉ soi task **tự nhận là xong**: việc bị chặn hoặc bị dừng giữa chừng không có file là chuyện bình thường và nó đã tự nói ra rồi.

Nhánh bị NGẮT đã được `stoppedReceipt` xử lý từ trước; nhánh **chạy hết bình thường** thì trước 19/08 không ai kiểm.

**4 — `worthLearning`: chỉ hỏi bài học khi ca có DẤU VẾT trục trặc.** Xem §4.3 để biết vì sao chốt này phải là code chứ không phải một câu dặn trong prompt.

### MỘT ca = MỘT `plan_id`, sinh ở ĐÚNG MỘT CHỖ (bản vá 20/08)

`Office.run()` gọi `newPlanId()` cho bản ghi công việc; `Assistant.plan()` **cũng** gọi `newPlanId()` cho riêng nó. Hai id cho một ca. `office.ts` ghi đè `plan.plan_id` bằng id của bản ghi — nhưng lúc đó `artifactScoper` **đã đóng khung xong** mọi đường dẫn bằng id kia.

Đo được trên máy người dùng 20/08: `artifacts/P-260820-0302-ov9e/` tồn tại trên đĩa, `tasks/index.json` chỉ biết `P-260820-0301-aajq`. Thư mục kết quả mang một **id mồ côi** — không kế hoạch nào, không file log nào tên đó. Người dùng còn nhìn thấy **cả hai id trong cùng một tin nhắn báo kết quả**.

Sửa: `Assistant.plan(request, planId)` **nhận** id, không tự sinh. Không có `newPlanId()` nào ngoài `Office.run()`.

> **Bài học:** ghi đè một định danh **sau** khi nó đã được dùng để dựng thứ khác là một cách rất êm để tạo ra hai sự thật. Một id phải sinh ở một chỗ rồi **chảy xuống**, không phải sinh hai lần rồi hoà giải.

### Tên file bản ghi phải mang `plan_id` — RÀ HẾT, không chỉ chỗ bị kêu

`saveReceipt` đặt tên `${task_id}.receipt.json`. `T-01` là số thứ tự trong một kế hoạch và mọi kế hoạch đều bắt đầu từ 1 → **mọi ca ghi đè lên cùng một file**. Đo được 20/08: văn phòng `ban-dia-hoa` chạy ba ca, `tasks/` còn đúng một `T-01.receipt.json` của ca cuối. Token, số lượt, `reads`, `looped`, `lessons` của hai ca đầu **mất trắng**.

Đây **chính xác** là lỗi đã sửa cho `artifacts/` ngày 19/08 (`SPEC-artifacts.md` §2) — cùng nguyên nhân, cùng lớp hậu quả, chỉ khác thư mục. Lần đó `tasks/` bị bỏ quên, dù `savePlan` ngay cạnh đã dùng `plan_id` từ đầu.

Sửa: `${plan_id}.${task_id}.receipt.json`. Không di trú — không đoạn code nào đọc biên nhận trở lại, nó là bản ghi pháp y để người dùng mở ra xem.

> **Bài học:** khi sửa một lỗi *"id không duy nhất"*, phải rà **hết** mọi chỗ lấy id đó làm tên file — không chỉ chỗ người dùng vừa kêu. Bản vá một nửa trông y hệt bản vá đủ cho tới ngày có người đi đếm file.

### Khâu LẬP KẾ HOẠCH được quyền HỎI LẠI (chốt 20/08)

Trước 20/08, `plan()` có **đúng một cửa ra**: một kế hoạch hoàn chỉnh. Trong khi `route()` ngay cạnh nó thì có `intent: 'ask'` — Trợ lý **được phép** hỏi lại khi trò chuyện, nhưng không được phép hỏi khi chia việc.

Nên khi planner thật sự cần một thông tin, nó **không có cách hợp lệ để nói ra**: nó rơi khỏi giao thức, trả về văn xuôi, và hệ thống gọi cái rơi đó là *"lỗi parse"* rồi đổ cho cách người dùng diễn đạt.

Nguyên văn đo được, `.state/plan-failure.log`:

> *"Bạn cho mình biết bản dịch tiếng Việt đã có trước đó của doc-2.md và doc-3.md đang nằm ở đường dẫn nào không? Mình không thấy file đó trong tủ tài liệu hay trong danh sách artifacts đã có."*

Một câu hỏi hoàn toàn hợp lý, bị hệ thống biến thành một lỗi. *(Chú ý *"hay trong danh sách artifacts đã có"* — **không hề có danh sách đó**. Model diễn theo bản đồ thư mục trong prompt, đúng bẫy §4.7.)*

**Sửa:** `PlanOutputSchema` thành `union([{ask}, {steps,tasks}])`.

- `union` chứ không `discriminatedUnion`: hai nhánh không có khoá chung, và bắt model điền một trường `kind` là thêm một chỗ để nó quên. Nhánh kế hoạch đòi `tasks` tối thiểu 1 phần tử nên hai nhánh không thể cùng khớp.
- Câu hỏi đi thẳng lên ô chat với vai `assistant`, y như một lượt `intent: 'ask'` — với người dùng đây **là** cùng một chuyện, họ không cần biết nó đến từ khâu nào. **0 token nhân viên.**
- Ca kết thúc ở `status: 'blocked'`, **không** `failed`. `failed` = đã thử và hỏng; `blocked` = chưa thử. Nhật ký phải phân biệt được *"hệ thống làm sai"* với *"hệ thống đang chờ mình"*. Panel tô `warn`, không tô `danger`: tô đỏ một ca chỉ vì Trợ lý hỏi lại là **dạy người dùng sợ câu hỏi**.

Hai luật kèm theo trong prompt, và luật thứ nhất là thứ chữa đúng cái làm người dùng bực:

> **Đừng bao giờ bảo con người đi kiểm một file nằm trong văn phòng.** Không nhìn thấy thì nói là không nhìn thấy — họ không phải là mắt của bạn.

> Chỉ hỏi khi câu trả lời **đổi được kế hoạch**. Chọn được một mặc định hợp lý và nói ra trong `constraints` thì làm thế — một vòng hỏi-đáp tốn của con người nhiều hơn một mặc định hơi lệch.

> **Bài học:** bảng kê kết quả (`SPEC-artifacts.md` §2.4) chữa đúng **một ca**. Cửa này chữa **cả lớp** — sẽ luôn có lúc planner cần hỏi, và ta không đoán trước được là lúc nào. Khi một giao thức chỉ cho phép **một** hình dạng trả lời, mọi thứ nằm ngoài hình dạng đó sẽ hiện ra thành lỗi hệ thống, kể cả khi nó là hành vi đúng.

### `/clear` phải GỘP, không phải VIẾT LẠI — và luật gộp có hai chiều (bản vá 20/08)

`compactMemory()` → `addAssistantMemory(…, assistantMemoryIds())` cho bản mới `supersedes` **toàn bộ** bản ghi nhớ đang sống, rồi `dropSuperseded()` **xoá hẳn** chúng. Nhưng prompt nén chỉ bảo *"viết lại những thứ bạn cần nhớ"* và **không nhắc gì** tới khối GHI NHỚ đang nằm sẵn trong ngữ cảnh.

> ⇒ Mỗi `/clear` là một lần **tóm tắt lại bản tóm tắt**. Thứ gì phiên vừa rồi không nhắc thì model không viết lại, và nó **biến mất vĩnh viễn, im lặng**. Đây là `supersedes` bị dùng ngược: nó sinh ra để thay **một bản đã cũ**, không phải để thay **cả trí nhớ bằng lát cắt mới nhất**.

Model **đã nhìn thấy** khối GHI NHỚ — thứ thiếu duy nhất là một câu bảo nó giữ lại. Nhưng *"giữ lại"* một mình là **nửa luật**, và nửa còn lại nguy hiểm ngang nửa đầu: một quyết định cũ đã sai, được chép lại vì nó nằm trong trí nhớ cũ, làm kho có **hai dòng nói ngược nhau** mà không ai biết dòng nào thắng — đúng thứ `supersedes` chặn ở tầng node, tái diễn ở tầng dòng.

**Ba luật, có thứ tự:**

1. **Chép lại** mọi mục cũ còn đúng. Bỏ vì *"phiên này không nhắc tới"* là làm mất một quyết định người dùng đã chốt.
2. Mục bị phiên vừa rồi **sửa hoặc huỷ** → viết **đúng một dòng theo ý mới**, bỏ hẳn ý cũ. Cái mới thắng, cái cũ biến mất.
3. **Mỗi chủ đề một dòng.** Phải viết *"trước đây X, giờ Y"* thì chỉ giữ Y.

> **Một luật giữ-lại không có luật ghi-đè đi kèm thì chỉ đổi kiểu hỏng:** mất trí nhớ → mâu thuẫn trí nhớ. Cái sau khó thấy hơn và tệ hơn — nó không im lặng biến mất, nó **im lặng nói dối**.

### Bảng kê trả lời "GIAO ĐƯỢC VIỆC GÌ", không trả lời "CÓ BAO NHIÊU" (chốt 20/08)

Câu hỏi đặt ra: *"người dùng hỏi có bao nhiêu file thì dùng worker ẩn `cwd` thay bảng kê (vốn có thể sai)?"* — **Không.** Ba lý do:

1. **Đó là câu hỏi của CODE.** `office.readablePaths()` trả về danh sách thật, đọc từ đĩa, không cắt. Tiêu một lượt LLM để đếm file là trả tiền mua sự bất định — luật *"thứ gì ta quan sát được thì đừng hỏi model"*.
2. **Nó không chữa đúng nỗi lo.** Bảng kê sai thì phải làm nó hết sai, không phải thêm một đường thứ hai đôi khi bất đồng với nó. **Hai nguồn sự thật cãi nhau tệ hơn một nguồn thiếu.**
3. **Giá của một luật định tuyến là vĩnh viễn, cái lợi là ca hiếm.** Thêm *"hỏi về file thì dùng lookup"* là thêm một ranh giới model phải đoán đúng ở mọi tin nhắn, mãi mãi, cho một câu thỉnh thoảng mới có.

**Đo lại thì bảng kê không sai như tưởng:** tủ tài liệu **không cắt** (`library.manifest()` liệt kê đủ) ⇒ *"có bao nhiêu tài liệu"* vốn đã đúng. Chỉ **bảng kê kết quả** bị cắt (`MANIFEST_PLANS = 5` + trần token) ⇒ đó mới là chỗ đếm sai. Vá bằng **code, không bằng lời dặn**: một dòng `Total: N file(s) across M job(s) — these numbers are exact`, đặt ngay sau tiêu đề và **không bao giờ bị trần token cắt** (vòng lặp cắt chỉ bỏ bớt danh sách ca). ~27 token.

**Vẫn cần bảng kê.** Việc của nó không phải trả lời *"bao nhiêu"* mà là để **planner ghi được `inputs` không cần một vòng hỏi lại** — đúng lỗ hổng 19/08. `lookup` không thay được: planner cần đường dẫn **trong lúc lập kế hoạch**, còn `lookup` chạy **thay cho** lập kế hoạch.

### Nhật ký KHÔNG xoá được — lọc ở tầng hiển thị (chốt 20/08)

User đòi một nút xoá (*"nhiều khi hỏng, bị zombie thấy ngứa mắt"*) rồi **tự chặn lại**: *"hay là giữ lại log nhỉ, để trace được, liên quan cả tiền nong các thứ"*. Câu chặn đó đúng, và đây là lý do:

> Nhật ký công việc là bên **DUY NHẤT** nối `plan_id` trong `logs/usage.jsonl` với một cái **tên đọc được**. Xoá một bản ghi thì tiền vẫn nằm trong sổ mà không ai biết nó của việc gì — và **"(không rõ)" trong sổ chi phí từ đó mang HAI nghĩa** (bản ghi v0, hoặc người dùng đã xoá), tức là không còn giải thích được. Luật *"sổ chi phí không được nói sai câu nào"* mất hiệu lực ngay hôm có nút xoá.

Nên **không có `DELETE /plans`**, và đó là một quyết định chứ không phải thiếu sót.

Nhưng nỗi khó chịu là có thật — đo trên máy user: `ban-dia-hoa` có **18 việc, 8 trong đó không `done`** (4 `failed` · 3 `stopped` · 1 `blocked`). Hai bản vá, mỗi cái chữa một nửa khác nhau:

**1. Ca ZOMBIE → chữa, không xoá.** Bản ghi kẹt ở `planning`/`running` sau khi daemon chết là **nhật ký nói dối**: nó bảo "đang chạy" cho một việc không ai làm. `PlanStore.healStale()` chạy một lần lúc dựng `Office` — lúc đó tiến trình vừa khởi động nên chắc chắn chưa có ca nào chạy — hạ chúng xuống `failed` kèm một câu nói rõ *chuyện gì xảy ra + làm gì tiếp*. Trả một phần **nợ kỹ thuật #2**.

- ⚠ Giữ NGUYÊN thứ tự trong index: **không dùng `upsert`**, vì nó đẩy bản ghi lên đầu. Chữa ba con zombie bằng `upsert` là xáo tung lịch sử theo thời gian — đúng thứ nhật ký sinh ra để giữ. Có test.
- ⚠ Idempotent: daemon khởi động lại nhiều lần không nối thêm câu giải thích thứ hai. Có test.

**2. Ca HỎNG THẬT → lọc, không giấu.** Một dòng `failed` là **lịch sử đúng** — nó là thứ trả lời được *"cái này có hay hỏng không"*. Nên nó ở lại trên đĩa, và người dùng được một nút **"Chỉ việc xong"**.

> Đây đúng là ca luật §5e nói tới: **tách ở tầng HIỂN THỊ rẻ, tách ở tầng LƯU TRỮ đắt — nghi ngờ thì tách chỗ rẻ trước.** Bộ lọc cho đúng sự nhẹ nhõm mà nút Xoá hứa, với 0 dòng lịch sử bị mất.

Ba chốt của bộ lọc: mặc định là **TẤT CẢ** (mở nhật ký ra mà đã giấu sẵn phần hỏng là nói dối bằng cách im lặng — người dùng phải CHỌN mới được nhìn ít đi) · thanh lọc **chỉ hiện khi có gì để lọc** · trạng thái rỗng của bộ lọc nói rõ *"dữ liệu vẫn còn, đang bị lọc"* kèm đường quay lại, khác hẳn trạng thái rỗng của cả nhật ký.

### `lookup` — WORKER ẨN: cửa thứ tư của `route()` (chốt 20/08)

**Ca đo được:** *"nội dung chính của doc-2.md là gì"* → một lượt lập kế hoạch + một worker đủ prefix (**sàn ~13 200 token**) để đọc một file rồi thuật lại. User gọi đúng tên: *"Trợ lý khá ngơ… và flow này có thể không tối ưu chi phí."*

Ba đường, và **chỉ đường thứ ba rẻ ở cả hai cột**:

| | tốn NGAY | tốn MÃI |
|---|---|---|
| DAG (plan + worker) | plan + **sàn 13 200 token** | 0 |
| Trợ lý tự `Grep` | ~0 | **nội dung file × MỌI lượt sau đó** |
| **`lookup`** | 1 one-shot, prefix tí xíu | **0** |

Cột thứ hai là câu trả lời cuối cùng cho *"tại sao Trợ lý không được grep"*, hỏi tới lần thứ ba (§4.7).

> ⚠ **Đính chính một lập luận cũ đã bị bác đúng.** Trước đây lý do nêu ra là *"Trợ lý sẽ nhớ nội dung cũ và nó thắng tài liệu"*. User phản biện: kho tri thức **đã** có chốt (chỉ ghi cách làm), còn session chat thì **vốn đã** chứa chi tiết Trợ lý tiện tay nói ra — nên grep không tạo ra một lớp lỗi MỚI. **Đúng.** Lập luận đó là chuyện mức độ, không phải một luật, và đã bị trình bày quá tay.
>
> Luận điểm còn đứng được thì khác và mạnh hơn: **ngữ cảnh Trợ lý là thứ DUY NHẤT không bao giờ bị vứt đi.** Worker đọc một lần rồi chết; Trợ lý đọc một lần rồi trả tiền `cache_read` ở **mọi lượt** cho tới `/clear`. Một PDF 34 trang bóc ra text là 10–20K token nằm lại vĩnh viễn. Trần Receipt 800 token sinh ra đúng vì chuyện này.

**Không làm nó thành MCP tool** như bản phác thảo `concierge` ban đầu: MCP phá prompt cache khi resume (~36K/lượt) mà `route()` resume ở **mọi** tin nhắn. Là một **intent** thì cùng ý tưởng, 0 đồng cache.

#### Ba tính chất, cả ba do CODE giữ

| | cơ chế | thật hay hứa |
|---|---|---|
| Đọc xong là quên | `persistSession: false` | **thật** — cả lý do nó tồn tại |
| Không ghi được file | `tools: ['Read','Grep','Glob']` | **thật** — `tools` GIỚI HẠN (§5d) |
| Đọc trong phạm vi nào | không có cổng nào | **hứa** — §4.7, ba cơ chế đều không nổ |

Dòng thứ ba nói thẳng vì luật *"đừng dựng hàng rào giả"*: nó không tệ hơn một nhân viên bình thường (họ cũng chạy `cwd` = thư mục văn phòng), và khác Trợ lý ở chỗ quyết định — thứ nó đọc **chết cùng lượt gọi**. Phần siết được thì đã siết bằng cơ chế: `paths` do model đề nghị phải qua `pickReadable`, đối chiếu với tủ tài liệu + ngăn Kết quả **đọc từ đĩa ngay lúc đó**.

#### `paths` bắt buộc ≥ 1 — không có ca "thả agent đi mò"

Trợ lý đã cầm sẵn bảng kê tủ tài liệu và bảng kê Kết quả trong prefix; đó **chính là việc của hai bảng đó**. Không nêu được tên file thì đường đúng là `ask`. Schema chặn, nên một `lookup` thiếu `paths` rơi xuống `garbled` và người dùng không thấy khối JSON nào.

Model đề nghị ba file mà hai file có thật thì **đọc hai file đó** và **nói ra** phần thiếu — khác `resolveFileRefs`, nơi một đường dẫn hỏng là lỗi người dùng nên phải dừng cả câu. Ở đây model đoán sai; bắt người dùng gõ lại vì thế là phạt nhầm người.

#### KHÔNG kinh nghiệm, KHÔNG charter, KHÔNG skills, KHÔNG roster

Không phải cắt cho rẻ — **ba lý do độc lập cùng chỉ một hướng**:

1. **Kinh nghiệm chỉ ghi CÁCH LÀM.** Agent này có đúng một cách làm và nó không bao giờ đổi. Thứ duy nhất nó *có thể* học là **nội dung tài liệu** — đúng loại node đã bị cấm (`fact` bị bỏ khỏi enum 19/08). Cho nó kho tri thức là dựng một cái máy chuyên sản xuất hàng cấm.
2. `worthLearning` vốn đã trả `false` cho ca chạy sạch, và một lượt lookup **luôn sạch theo cấu trúc**: không file để hỏng, không dep để kẹt.
3. Kho tri thức ẩn của một agent người dùng không nhìn thấy là **một lỗ hổng không debug được** — đúng nỗi lo user nêu. **Không có gì ẩn ở đây, vì không có gì cả.**

#### Luật phân cửa: *"người khác làm thì kết quả có khác không?"*

Câu hỏi **không** phải *"ai làm được việc này"* — người dịch hoàn toàn đọc và tóm tắt được một tài liệu, và user đã chứng minh điều đó trên máy thật.

| | | |
|---|---|---|
| Dịch · viết · soát · tư vấn | **có khác** — phụ thuộc thuật ngữ, giọng, charter, tức là phụ thuộc `role` | `task` |
| Thuật lại xem tài liệu nói gì | **không khác** — ai đọc cũng ra chừng ấy | `lookup` |
| Cần ra một FILE để giữ | — | `task`, luôn luôn |

Và đây cũng là câu trả lời cho ca *"người dùng tự tạo một nhân viên chỉ-đọc rồi thấy Trợ lý tự làm hết"*: nhân viên đó tồn tại vì họ mang một **góc nhìn** (soát hợp đồng, kiểm số liệu), nên mọi câu hỏi cần góc nhìn ấy vẫn về tay họ theo đúng luật trên. `lookup` chỉ lấy phần mà vai trò **không thêm được gì** — phần đó vốn không phải việc của ai cả.

#### Mức model: của chính Trợ lý, không phải `models.planner`

Với người dùng thì đây **là** Trợ lý đang trả lời; nó chỉ không giữ tài liệu lại trong đầu. Knob quyết chất lượng đó đã có sẵn (`assistant.model_tier`), và **không đẻ knob thứ ba**. `models.planner` thì sai trục: người ta đặt nó `deep` để khâu chia việc nghĩ kỹ, dùng ở đây thì mỗi câu *"file này nói gì"* chạy Opus.

#### Không sinh Plan — và dòng trạng thái là nửa sự thật còn lại

`lookup` **không** sinh `PlanRecord`, không có tin *"Mình chia thành 1 việc"*, không có bước nào trên sơ đồ. Câu trả lời phát với `role: 'assistant'`.

Một tin *"mình chia thành 1 việc để đọc file"* cho một câu hỏi tra cứu tốn **hai tin nhắn chỉ để báo rằng sắp trả lời** — đúng cái "ngơ" mà cửa này sinh ra để bỏ. Nhưng trả lời mà không nói gì thêm thì người dùng tưởng Trợ lý tự biết, trong khi vừa có một lượt đọc file thật sự chạy. User gọi đúng tên: **một nửa sự thật**.

Nửa còn lại giá **0 token**: một dòng trạng thái `Đang đọc doc-2.md…` trong lúc worker ẩn chạy. Người dùng thấy *có việc đọc đang diễn ra* và *đọc file nào* — hết. Không plan, không bước, không tin thừa nằm lại trong luồng chat; dòng đó tự biến khi câu trả lời tới.

Thi hành bằng **cờ trạng thái** (`Office.reading`), cùng khuôn `clearing` và cùng lý do: *việc đang chạy là TRẠNG THÁI, không phải thông báo*. Cố ý **không** `hold_ms` — đặt hẹn giờ cho nó là tái tạo đúng bug `/clear` nháy rồi khựng. Đặt trong `try/finally` để không kẹt trên màn hình khi lượt đọc ném lỗi hoặc bị `/stop` cắt.

#### Ba lỗ đo được ở lần chạy thật đầu tiên (20/08) — cả ba là "nửa vá"

**1. `ASSISTANT_CORE` không biết gì về worker ẩn.** Cửa `lookup` được thêm vào prompt của `route()` (khối theo lượt) nhưng `ASSISTANT_CORE` (khối system, được cache) vẫn viết *"You never read or write project files yourself"* / *"**You have no tools**"*. Hai khối mâu thuẫn, và model theo khối to hơn — nó trả lời *"Mình không tự mở được file để kiểm tra"*. Nó **không sai**, nó tuân lệnh.

> **Thêm một khả năng thì phải rà HẾT mọi khối prompt mô tả khả năng.** Cùng hình dạng với `planFailed`/`route` và `tools`/`allowedTools` — ba lần trong một tuần.

**2. "Không có trong bảng kê" bị hiểu thành "không tồn tại".** `MANIFEST_PLANS = 5` nên ca cũ cố ý không liệt kê. Nhưng `pickReadable` đối chiếu với **toàn bộ** `artifacts.list()`, và `resolveFileRefs` đã xác minh đường dẫn người dùng gõ **trước khi** nó tới model — ca này vốn đã chạy được, chỉ có prompt cấm nó thử. Luật *"A path the human typed is exact"* có sẵn nhưng nằm trong mục **Planning output** nên không phủ `lookup`. Đã nâng thành mục gốc **"Paths you may use"**, và dòng chân bảng kê nói rõ ca cũ **vẫn còn sống**.

**3. Bảng kê thiu — hai trong bốn cửa không nạp lại prefix.** Thêm tài liệu và xoá kết quả gọi thẳng vào store từ tầng `server/`, bỏ qua `Office`. Ca tệ nhất: **tải tài liệu lên rồi hỏi ngay** và Trợ lý nói không thấy file nào tên đó. Vá bằng cách **đóng cửa tắt** (`Office.addDocument` · `Office.removeArtifact`), không phải bằng cách thêm hai lời gọi rải rác.

> **Một luật chỉ đúng ở tầng nó được viết ra.** *"Ghi/đọc phải dùng chung một hàm"* đúng tuyệt đối trong `core/`, và tầng `server/` reach thẳng qua nó lúc nào không ai để ý.

#### Cái giá, nói trước

- ~120 token vĩnh viễn trong prefix `route` (mô tả cửa + luật phân cửa).
- Câu trả lời `lookup` **không vào session Trợ lý** — hỏi lại *"sao bạn nói doc-2 về dashboard"* thì nó không nhớ. Đây đúng là đánh đổi đã chấp nhận cho `deliver: reply`, và là chỗ cần đo lại nếu mục tiêu nghiêng về **second brain**.
- Rủi ro định tuyến sai còn đó. Chặn cứng thì chỉ có một: `lookup` **không ghi được file**, nên ca sai tệ nhất là một câu trả lời thay vì một tài liệu — hồi được bằng một câu nhắn, đúng cùng hình dạng với luật phá hoà của `deliver` ngay dưới đây.

### Luật phá hoà của `deliver`: gần nhau thì chọn `reply` (chốt 20/08)

`default_deliver` khử được bất định của ca **thường gặp** trong một văn phòng. Nó **không** khử được ca còn lại, và ca còn lại là ca có thật:

> Cùng văn phòng **Bản địa hoá**: *"dịch doc-4"* là `file`, *"nêu cho tôi 10 thuật ngữ"* là `reply`. **Không con mặc định nào đúng cho cả hai.**

Đo được trên máy người dùng: họ hỏi 10 thuật ngữ, nhận về một **đường dẫn file** cho mười dòng chữ, và phải gõ lại *"5 thuật ngữ, chỉ trả lời, không ghi file"* mới đọc được câu trả lời trong chat. **Hai lần chạy đầy đủ cho một câu hỏi.**

Nên phân loại vẫn phải xảy ra từng lần, và chốt nằm ở **luật phá hoà**, không ở mặc định:

> **Sai về `reply` thì hồi được, sai về `file` thì không.** Task `reply` **vẫn ghi file** — sai kiểu đó tốn vài dòng thừa trong chat, hết. Task `file` mà người ta muốn được trả lời thì tốn của họ **một lượt yêu cầu nữa**: hỏi lại đúng thứ vừa làm xong, và trả tiền cho cả ca lần thứ hai.

Cùng khuôn *"xoá luôn có hai mức, mức an toàn đứng trước"*: **lựa chọn hồi được đứng làm mặc định.** Giá của luật này là ~35 token trong prefix vĩnh viễn; nó tự trả tiền ngay lần đầu tiên nó chặn được một ca chạy đôi.

**Hai hệ quả về cơ chế:**

- `officeTemplate` **ghi thẳng `default_deliver: file`** kèm chú thích. Trước 20/08 không template nào, không route API nào, không màn hình nào ghi trường này ⇒ mọi văn phòng đều rơi về `'file'` của schema. **Một cái nút không ai vặn được thì không phải một cái nút** — đúng lớp lỗi *"trục bị hard-code nên vô hình"* mà chính `deliver` sinh ra để chữa. Chú thích YAML là **0 token** (không bao giờ tới model) nên chỗ giải thích đúng là ở đó.
- **KHÔNG đẻ thêm một nút trên giao diện cho `default_deliver`.** Một cái nút chỉ đúng một nửa số lượt là bắt người dùng làm việc của bộ phân loại, và họ sẽ gạt qua gạt lại mãi. Đây là chỗ luật *"bất định lặp lại mỗi lượt thì đừng khử bằng giao diện"* áp vào **chính cái mặc định** sinh ra từ nó.

### `decideRoute` — VĂN BẢN THÔ CỦA MODEL KHÔNG BAO GIỜ ĐI THẲNG LÊN Ô CHAT (bản vá 20/08)

Nhánh dự phòng của `route()` từng là một dòng:

```ts
const value = parsed ?? { intent: 'chat', say: text.trim() };   // ← thô
```

**Ca đo được trên máy người dùng.** Họ hỏi *"nêu cho tôi 10 thuật ngữ tiếng anh?"* → Trợ lý hỏi lại *"lấy từ tài liệu nào?"* → họ đáp *"uhm, bất kỳ, random cũng đc"* → **ô chat nhả ra nguyên một khối `json`** với `steps`/`tasks`/`deps`/`deliver`.

Ba chuyện xảy ra cùng lúc, và chỉ chuyện thứ nhất là dễ thấy:

1. Người mở tiệm hoa nhìn thấy một đoạn mã.
2. `RouteSchema` không khớp ⇒ `intent` là `chat` ⇒ **`run()` không bao giờ được gọi**. Không ai làm việc vừa giao. Không có dòng lỗi nào.
3. Kế hoạch đó **đúng** — giao `nguoi-dich`, `inputs` trỏ đúng file bảng thuật ngữ của ca cũ, `deliver: reply`. Nó bị **vứt vào thùng rác sau khi đã trả tiền**.

**Vì sao model làm thế — và vì sao đó KHÔNG phải lỗi của nó.** `ASSISTANT_CORE` mang mục *"Planning output"* trong prefix của **mọi** lượt: `route()` và `plan()` cố ý dùng chung một prefix để chung một cache entry (§4.5). Ngay sau một câu `ask`, *"bất kỳ cũng được"* đọc lên giống hệt tín hiệu *"chia việc đi"*. Đây là **hệ quả của một đánh đổi đã chốt**, không phải một model tồi — nên chữa bằng **cơ chế**, không bằng lời dặn thêm: dặn thì tốn token vĩnh viễn, chỉ là gợi ý, và luật 19/08 đã nói *đừng dặn model đừng làm*.

Ta không ngăn được nó viết ra một kế hoạch. Nhưng ta **đang cầm** một kế hoạch hợp lệ đã trả tiền — nên việc đúng là **DÙNG NÓ**.

`decideRoute(text)` — **hàm thuần, có test**, thử bốn cửa theo thứ tự:

| | khớp gì | kết cục |
|---|---|---|
| 1 | `RouteSchema` | cửa chính, ca thường |
| 2 | `PlanTasksSchema` | **nhặt về** → `Office.run(request, draft)`, **bỏ luôn lượt `plan()`** |
| 3 | `PlanAskSchema` | `{"ask":…}` là câu hỏi hợp lệ của khâu lập kế hoạch → `intent: 'ask'` |
| 4 | còn lại | **có JSON hay không** mới là câu hỏi quyết định |

**Luật ở bước 4 hẹp có chủ ý: văn xuôi vẫn hiện như cũ.** Model lỡ quên bọc JSON mà vẫn nói một câu tiếng Việt cho người đọc thì hiện câu đó đúng hơn là nuốt đi. Thứ bị chặn **chỉ là JSON** — một khối JSON không bao giờ là câu nói cho người dùng, nó là tin nhắn giao thức đi lạc cửa. Phân biệt bằng `JSON.parse`, tức là bằng **sự việc**, không bằng dò chữ.

Ca bước 4 nhận một câu do **CODE** viết (*"Mình trả lời sai định dạng nên câu vừa rồi chưa dùng được — lỗi của mình, không phải cách bạn nói"*) và nguyên văn đi vào `.state/route-failure.log`. **Cố ý KHÔNG trích lời model**, khác `planFailed`: ở đó thứ nó nói là văn xuôi — đọc được, và chính nó là thông tin. Ở đây nó là JSON.

**Hai chốt của cửa cứu hộ:**

- **KHÔNG hạ xuống `intent: 'task'` với chính câu người dùng vừa gõ**, dù nghe gọn hơn nhiều: `plan()` chạy ở query **one-shot, không có trí nhớ hội thoại**. *"Bất kỳ, random cũng đc"* đứng một mình thì planner không chia được việc gì — ta sẽ trả tiền thêm một lượt để nhận về một ca hỏng. **Phải tái dùng, không gọi lại.**
- `PlanRecord.request` suy từ `goal` của các task (`requestOf`), không từ câu người dùng gõ: câu đó đúng nhưng vô nghĩa khi đọc lại trong nhật ký ba ngày sau. `goal` vốn đã được yêu cầu đúng hình dạng *"một câu rõ ràng, tiếng của người dùng"*.

`buildPlan` được **tách khỏi `Assistant.plan()`** vì nó có hai người gọi. Bốn luật nó đang giữ (đóng khung đầu vào · đóng khung đầu ra · bỏ bước không ai làm · mặc định `deliver` của văn phòng) đều đã từng có bug, và nằm trong một method `async` gọi model thì **không bộ test nào chạm tới được**. Hai bản mã cho cùng một phép biến đổi thì sẽ lệch — và một dòng chú thích *"⚠ phải khớp bên kia"* không phải một cơ chế.

> **Bài học chung:** một nhánh dự phòng `?? { say: text }` là **một cái cửa hậu để văn bản thô của model đi ra mặt người dùng**. Ở đây nó tồn tại từ đầu, đọc rất vô hại, và chỉ lộ ra khi model lạc cửa đúng một lần. Chỗ nào code lấy chuỗi model trả về làm câu nói cho người, chỗ đó phải trả lời được: *nếu nó trả về thứ khác hình dạng đã hẹn thì người dùng nhìn thấy gì?*

### `worthLearning` — đừng dặn model đừng làm, đừng cho nó cơ hội làm

Bản trước LUÔN kèm trường `lessons` vào mọi báo cáo, kèm câu dặn *"Việc chạy trơn tru không phải bài học"*. Hỏi một model *"bạn học được gì?"* thì nó gần như luôn nặn ra một câu, và **lời dặn không cản được**.

**Ca thật, 19/08.** Một ca chạy trơn tru hoàn toàn (1 việc, `done`, không blocked, receipt không phải hỏi lại) đẻ ra node `k/shared/san-pham-giam-gia-60-…`. Nội dung của nó là bản diễn giải **LỆCH** của một câu trong tài liệu người dùng: chính sách viết *"trên 50% không đổi trả"*, node ghi *"giảm 60% **thường** không được đổi trả"*. Sai ngưỡng, thêm chữ *"thường"* mà chính sách không có — và nằm trong prefix của mọi nhân viên cho tới khi hết hạn.

Trợ lý viết được câu đó mà **chưa từng đọc tài liệu nào**: nó chỉ nhìn thấy MỘT dòng `say` của nhân viên. Đó là **nghe kể lại**, không phải bài học.

Ngưỡng: chỉ hỏi khi có thứ **quan sát được**, không phải thứ suy đoán — `status !== 'done'`, hoặc `blocked_on`, hoặc receipt phải hỏi lại (`reasked`).

> ⚠ **CỐ Ý KHÔNG dùng SỐ LƯỢT làm dấu hiệu, dù rất cám dỗ.**
>
> Bản nháp đầu có thêm `usage.turns >= 8`, và bộ test bác bỏ nó ngay: ca 19/08 chạy đúng **9 lượt** — tức là điều kiện đó **cho qua đúng cái ca nó sinh ra để chặn**.
>
> Lý do sâu hơn: *số lượt là thuộc tính của MODEL và độ khó việc*, đo được là haiku 10 lượt vs sonnet 4 lượt cho **cùng một việc**. Lấy nó làm tín hiệu "có trục trặc" nghĩa là mọi văn phòng chạy `eco` đều bị coi là đang trục trặc, còn `deep` thì **không bao giờ**.

Đánh đổi đã biết và chấp nhận: **kho tri thức lớn chậm hẳn lại.** Kinh nghiệm thật của người dùng vẫn có đường vào kho, và là đường **tốt hơn**: nói với Trợ lý rồi `/clear` → node GHI NHỚ, confidence 0.9 (§4.6).

Chốt cuối nằm ở code chứ không ở prompt: không hỏi thì **không nhận**, kể cả khi model tự ý gửi kèm `lessons`.

#### Tín hiệu thứ NĂM: ma sát của CON NGƯỜI (chốt 20/08)

Bốn tín hiệu trên đều đọc từ `receipts` — tức là chúng đo **độ khó của cỗ máy**. Có một hạng ca mà cả bốn đều im lặng: **cỗ máy chạy hoàn hảo, còn con người thì vật lộn.**

**Ca thật, 20/08.** Người dùng mất **bốn lượt** mới giao được việc (§2.4 của `SPEC-artifacts.md` kể chi tiết), và phải tự nghĩ ra giải pháp kiến trúc. Ca chạy sau đó: 2 task, cả hai `done`, receipt sạch bong → **0 bài học**.

Văn phòng vừa học được một điều rất giá trị — *"ở đây, muốn làm tiếp trên một kết quả cũ thì phải nói thẳng là giao cho ai làm lại"* — và **vứt nó đi**, vì nó không nằm trong bất kỳ biên nhận nào.

`friction` = **số lượt lập kế hoạch không ra được kế hoạch chạy được**, kể từ ca chạy được gần nhất. Tăng ở ba chỗ: planner hỏi lại, planner ném lỗi, `validate` chặn. Về 0 ngay khi một ca thật sự khởi động.

- Vẫn là **sự việc quan sát được**, đếm bằng code, 0 token, không phụ thuộc model — đúng cùng luật đã bác bỏ `usage.turns`.
- ⚠ **KHÔNG đếm số tin nhắn người dùng gõ**, dù nghe tự nhiên hơn: người ta nhắn nhiều vì nhiều lý do — nghĩ thêm ý, đổi ý, hay chỉ gõ thành hai dòng. Chỉ **lượt lập kế hoạch không ra được kế hoạch** mới là bằng chứng chắc chắn rằng hệ thống đã bắt người dùng nói lại.
- Ở **RAM**, không trên đĩa: nó chỉ có nghĩa trong một mạch hội thoại liền. Tắt daemon rồi mở lại nghĩa là người dùng đã bỏ đi và quay lại — ma sát của phiên trước không dạy được gì về phiên này.
- ⚠ **KHÔNG** tăng ở `catch` cuối `run()`: chỗ đó còn nhận cả *"chưa có nhân viên nào trực"* và *"văn phòng đang bận"* — chuyện **cấu hình**, không phải chuyện hai bên chưa hiểu nhau.

Câu hỏi đặt cho Trợ lý ở ca ma sát **khác hẳn**, và khác là cả điểm của nó. Ca trục trặc kỹ thuật hỏi *"cái bẫy đã vấp là gì"*; ca ma sát thì cỗ máy chạy sạch nên hỏi câu đó sẽ nhận về *"không có gì"* — đúng, và vô dụng. Thứ đáng học nằm ở phía con người:

> *"Người dùng đã phải nói lại N lần mới giao được việc này. Câu nào của họ cuối cùng làm việc chạy được, và lần sau gặp yêu cầu tương tự thì nên hỏi thẳng điều gì ngay từ đầu?"*

Đây là một **lớp bài học mới**: kinh nghiệm về **cách giao việc trong văn phòng này**, không phải về nội dung công việc. Nó là lớp duy nhất học được từ chính người dùng mà **không phải hỏi họ một câu nào**.

> **Bài học:** khi một cơ chế "im lặng đúng lúc cần nói", hãy kiểm xem nó đang **đo ở đâu**. `worthLearning` không hỏng — nó chỉ chưa bao giờ nhìn về phía con người.

### Mã chết đã biết: `Assistant.chat()`

`assistant.ts` có `chat(message)` — không nơi nào gọi. Đường đi thật là `route()` trả luôn `say` cho cả `chat` lẫn `ask`, và `handleUserBatch` phát thẳng câu đó.

**Và đó là thiết kế đúng, không phải thiếu sót:** gọi `chat()` sau `route()` là **hai lượt model cho một câu chào**, trên đúng đường đông người qua lại nhất của sản phẩm. Ghi ra đây để lần sau không ai "nối lại cho đủ" — hàm này nên **xoá**, đừng nối.

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
