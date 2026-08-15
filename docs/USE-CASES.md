# 10 use case — thước đo hệ thống, và phôi cho template văn phòng

**Ngày:** 15/08/2026 · **Mục đích:** đo xem hệ thống phục vụ được tới đâu, không phải để quảng cáo.

Mỗi use case viết ở dạng **một văn phòng** (`offices/<mã>/`), nên khi nó chạy được thì nó **đã là** một template — zip thư mục lại là xong. Đó là lý do file này quan trọng hơn một danh sách ý tưởng: nó vừa là đề bài kiểm tra, vừa là sản phẩm.

Mỗi mục có đúng bốn phần: **ai đau ở đâu · dựng thế nào · nó kiểm thứ gì · hệ thống hiện thiếu gì.** Phần thứ tư mới là phần đáng đọc.

---

## Bảng tổng

| # | Văn phòng | Kiểm điều gì mà cái khác không kiểm | Sẵn sàng? |
|---|---|---|---|
| 1 | Xưởng nội dung | DAG song song thật, tích luỹ giọng văn | ✅ chạy được hôm nay |
| 2 | Hỗ trợ khách hàng | chất lượng truy xuất tri thức HOT/COLD | ✅ |
| 3 | Sổ sách & hoá đơn | đầu vào là file người dùng, đầu ra phải ĐÚNG số | ⚠ thiếu kiểm chứng |
| 4 | Theo dõi đối thủ | chạy định kỳ, so sánh với lần trước | ❌ chưa có lịch |
| 5 | Bản địa hoá | nhất quán thuật ngữ xuyên nhiều ca | ✅ |
| 6 | Rà hợp đồng | tài liệu DÀI hơn context | ❌ chưa có chia nhỏ |
| 7 | Xưởng bảng tính | tier `eco` có thật sự lãi không | ✅ |
| 8 | Sàng lọc hồ sơ | nhiều đầu vào cùng lúc, chấm điểm nhất quán | ✅ |
| 9 | Báo cáo tiến độ | tool `Bash`/`Glob`, đọc repo thật | ✅ |
| 10 | Trợ lý cá nhân | MCP + secrets + duyệt trước khi hành động | ⚠ thiếu cổng duyệt |

---

## 1. Xưởng nội dung

**Đau:** người làm fanpage/blog một mình mất 2–3 tiếng mỗi bài, và bài thứ 20 vẫn phải nhắc lại "giọng văn của tôi là gì".

**Dựng:**

| Nhân viên | tier | tools | việc |
|---|---|---|---|
| `researcher` | standard | Read, Glob, Grep, WebSearch, WebFetch | tìm tư liệu, ghi file có nguồn |
| `writer` | standard | Read, Write | viết bản nháp |
| `reviewer` | eco | Read, Write | soát giọng + lỗi, ghi nhận xét |

Charter giữ giọng thương hiệu (≤500 token). Sau vài ca, `knowledge/shared/` tự có "khách hay hỏi X", "đừng dùng từ Y".

**Kiểm:** ba bài viết song song = ba task cùng `step`, không phụ thuộc nhau → đo được cache priming gate có hoạt động không (task đầu trả `cache_write`, hai task sau chỉ `cache_read`). Đây là use case duy nhất tạo được song song thật một cách tự nhiên.

**Thiếu:** không có. Chạy được hôm nay.

---

## 2. Hỗ trợ khách hàng

**Đau:** chủ shop trả lời cùng 20 câu hỏi mỗi ngày, và trả lời sai chính sách của chính mình vì không nhớ.

**Dựng:** một `responder` (eco) + một `librarian` (standard, chỉ chạy khi cần nạp tài liệu mới). Chính sách đổi trả, bảng giá, FAQ nạp vào `knowledge/shared/` dạng node ≤250 token.

**Kiểm:** đây là bài kiểm **truy xuất tri thức**, không phải bài kiểm sinh văn. Câu hỏi "đổi hàng sau 10 ngày được không" phải kéo đúng node chính sách vào COLD mà không kéo 20 node khác. Nếu `KnowledgeStore.cold()` chấm điểm từ khoá không đủ tốt thì use case này lộ ra ngay, còn use case 1 thì không.

**Thiếu:** chưa có Librarian tự chia tài liệu dài thành node — hiện phải tự viết node bằng tay.

---

## 3. Sổ sách & hoá đơn cá nhân

**Đau:** freelancer cuối tháng ngồi phân loại 200 dòng sao kê để biết mình lãi bao nhiêu.

**Dựng:** `bookkeeper` (eco, Read/Write/Glob) đọc CSV sao kê trong `artifacts/input/`, phân loại, ghi `bao-cao-thang.md` + `phan-loai.csv`.

**Kiểm:** use case đầu tiên mà **đầu ra sai là sai hẳn**, không phải "chưa hay". Nó kiểm được điều mà văn bản không kiểm được: model có bịa số không.

**Thiếu — và đây là lỗ hổng thật:** hệ thống hiện **không có cách kiểm chứng con số**. Receipt nói "đã phân loại xong" và ta tin. Cần một cơ chế `verify` chạy bằng **code, không phải LLM** (ví dụ: tổng các nhóm phải bằng tổng sao kê). Chưa có, và đây là thứ nên có trước khi đem hệ thống đụng vào tiền của ai.

---

## 4. Theo dõi đối thủ

**Đau:** muốn biết tuần này đối thủ đổi giá gì, ra tính năng gì — nhưng không ai ngồi kiểm thủ công mỗi tuần.

**Dựng:** `watcher` (standard, WebSearch/WebFetch/Write) quét một danh sách URL, ghi `snapshot-<tuần>.md`; `differ` (eco) so với snapshot tuần trước, chỉ báo cái ĐỔI.

**Kiểm:** trí nhớ **xuyên ca**. Mọi use case khác chỉ cần nhớ trong một ca; cái này cần "lần trước thế nào".

**Thiếu:** **chưa có lịch chạy định kỳ.** Hệ thống hoàn toàn thụ động — phải có người gõ. Đây là hạng mục nhỏ (một cron trong daemon) nhưng thiếu nó thì cả nhóm use case "theo dõi" không tồn tại được.

---

## 5. Bản địa hoá & thuật ngữ

**Đau:** dịch tài liệu sản phẩm, mỗi lần dịch lại gọi cùng một khái niệm bằng một từ khác.

**Dựng:** `translator` (standard) + `term-keeper` (eco). Bảng thuật ngữ sống trong `knowledge/shared/` — mỗi thuật ngữ một node. `term-keeper` chạy sau mỗi ca, bổ sung thuật ngữ mới gặp.

**Kiểm:** kho tri thức có thật sự làm hệ thống **tốt lên theo thời gian** không. Ca thứ 10 phải nhất quán hơn ca thứ nhất — và điều đó **đo được** bằng cách đếm số thuật ngữ dịch khác nhau.

**Thiếu:** không có. Đây cũng là use case chứng minh giá trị của kho tri thức rõ nhất, nên đáng làm template sớm.

---

## 6. Rà hợp đồng cho freelancer

**Đau:** nhận hợp đồng 15 trang, không biết điều khoản nào bất lợi, thuê luật sư thì quá đắt cho hợp đồng 20 triệu.

**Dựng:** `reader` (standard) chia hợp đồng theo điều khoản, ghi mỗi phần một file; `flagger` (deep) chấm rủi ro từng điều khoản; `summarizer` (eco) gộp thành checklist.

**Kiểm:** tài liệu **dài hơn ngân sách một task**. Đây là bài toán khác hẳn mọi use case trên.

**Thiếu:** hệ thống chưa có cách chia tài liệu dài. Trợ lý phải tự đoán "chia làm mấy phần" mà không biết file dài bao nhiêu — nó không được đọc file. Cần một tool đo kích thước (`Glob`/`Bash wc`) hoặc một bước `survey` rẻ chạy trước. **Chưa có, và không tự nhiên có.**

⚠ Cảnh báo sản phẩm: đây là lãnh địa dễ gây hại. Nếu làm template này thì phải kèm một câu rất rõ rằng đây **không phải tư vấn pháp lý**.

---

## 7. Xưởng bảng tính

**Đau:** có CSV dữ liệu thô, muốn ra bảng tổng hợp + vài con số, không biết pivot.

**Dựng:** `cleaner` (eco) chuẩn hoá cột, `analyst` (standard) tổng hợp, `charter` (eco) viết mô tả biểu đồ.

**Kiểm:** **tier `eco` có thật sự lãi không.** SESSIONS_MEMORY ghi rằng `eco` dùng 2,5× lượt và 2,17× token nhưng vẫn rẻ hơn 38% — với việc *này*. Việc dữ liệu có tính máy móc cao, đúng chỗ `eco` nên thắng. Nếu nó thua ở đây thì luật chọn tier phải viết lại.

**Thiếu:** không có. Nhưng nên chạy kèm `bench/tier-compare.mjs` để có số, đừng đoán.

---

## 8. Sàng lọc hồ sơ

**Đau:** đăng một tin tuyển, nhận 80 CV, đọc hết mất một ngày.

**Dựng:** `screener` (eco) đọc từng CV theo một rubric cố định trong charter, ghi một dòng chấm điểm; `ranker` (standard) xếp hạng và giải thích top 10.

**Kiểm:** **nhất quán khi lặp lại nhiều lần**. 80 CV = 80 task hoặc vài task gộp — đây là chỗ luật "ít task lớn hơn nhiều task nhỏ" bị thử thách thật, vì sàn ~13 200 token mỗi call nhân với 80 là con số rất khác nhân với 8.

**Thiếu:** không có về mặt kỹ thuật. Nhưng đây là use case đụng **dữ liệu cá nhân của người khác** — template phải nói rõ CV nằm trên máy người dùng, không đi đâu ngoài Anthropic.

---

## 9. Báo cáo tiến độ dự án

**Đau:** dev một mình, cuối tuần không nhớ mình đã làm gì để viết changelog hay báo cho khách.

**Dựng:** `historian` (eco, tools `Bash`, `Glob`, `Grep`, `Read`) đọc `git log` và các file đã đổi; `writer` (standard) viết bản cập nhật cho **người không phải dev**.

**Kiểm:** tool hệ thống thật (`Bash`) trong tay agent, và `use_preset: true` cho vai trò đọc code — use case duy nhất mà preset `claude_code` đáng giá 6 300 token của nó.

**Thiếu:** không có. Đây cũng là use case dễ tự dùng nhất — chính chúng ta là người dùng.

---

## 10. Trợ lý cá nhân — phần đáng giá của openclaw

> **Nguồn:** đọc README của openclaw, thảo luận cộng đồng, và các bản tin về chính sách Anthropic — tra ngày 15/08/2026. Danh sách nguồn ở cuối mục.

### OpenClaw thật ra là gì

Ra mắt 24/11/2025 (tên cũ Warelay → Moltbot → Clawdbot), đổi tên thành OpenClaw cuối tháng 1/2026, **hơn 380 000 sao GitHub**. Đây không phải một dự án nhỏ — nó là *đối thủ tham chiếu*, và cũng là bằng chứng thị trường lớn hơn ta tưởng.

Hình dạng: **trợ lý cá nhân tự host, giao diện chính là app nhắn tin** — WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Google Chat và hơn chục kênh khác. Kiến trúc gồm một **Gateway** (mặt phẳng điều khiển cục bộ cho session, tool, sự kiện, kết nối kênh) + Control UI/CLI/TUI + companion app cho giọng nói, camera, chụp màn hình. Mở rộng bằng **plugin SDK** riêng và chợ **ClawHub**, có thêm MCP registry — tức là ghi chú cũ của ta ("bắt viết MCP server") **chưa chính xác**: nó có SDK plugin riêng, còn khó hơn.

Thiết kế **một người vận hành**. Tài liệu của chính nó cảnh báo: *"Tool chạy trên máy host cho session chính trừ khi bạn tự cấu hình sandbox."*

### Cộng đồng thật sự dùng nó vào việc gì — và bỏ vì cái gì

**Việc còn dùng được** (từ Ask HN: Who is using OpenClaw?):

- Trí nhớ cá nhân gắn Obsidian, hỏi qua WhatsApp — điểm được khen: *trí nhớ nằm trong version control, đọc và sửa được, không bị khoá vào một hãng*
- Một người dựng trong nhóm Telegram gia đình để thu thập chuyện kể của hơn 50 người họ hàng, hỏi lại có ngữ cảnh, lưu thành kho tư liệu nhiều thế hệ
- Một người làm vườn nối MCP + Xero, biến ảnh chụp hiện trường thành đề xuất báo giá PDF 14–32 trang
- Sinh viên tự sinh thẻ ghi nhớ từ ghi chú Obsidian mỗi đêm

**Lý do bỏ:**

| | |
|---|---|
| **Tiền** | một người báo **$100/tháng** tiền API chỉ để có bản tin buổi sáng — mà nó chỉ chạy đúng "một hai lần mỗi tuần" |
| **Độ tin cậy** | việc chạy theo lịch *"hỏng cách ngày"*, phải sửa liên tục, và hệ thống còn tự nhận đã tự sửa xong trong khi không |
| **Cài đặt** | một người cài trên Raspberry Pi tiêu *"$40–50 trong một tuần chỉ để gỡ rối"* rồi bỏ cuộc |
| **Bảo mật** | trao cho agent *"toàn quyền API key không giới hạn"* — có người sợ nó xoá repo, xoá file hệ thống |
| **Đốt token** | phê bình sắc nhất: **việc chạy theo lịch và có tính tất định thì thuộc về script, không thuộc về vòng lặp LLM.** Sinh lại lời giải mỗi lần là đốt token vô ích |
| **Đánh giá chung** | *"một bản Claude Code tệ hơn, chậm hơn, kém năng lực hơn"*; sau vài tháng dùng, có người kết luận nó là **một lớp giao diện điều phối các tự động hoá sẵn có**, không phải một cách làm việc mới |

**Điểm chung của những ca THÀNH CÔNG:** đều **có người trong vòng lặp**, đều **chấp nhận đầu ra không tất định**, và đều giải bài toán **chưa có app nào làm** (lưu trữ chuyện gia đình, báo giá theo ảnh). Ca thất bại đều là ca cố thay thế cron — chỗ mà độ tin cậy mới là thứ quan trọng.

> Ba điều này gần như là một bản mô tả ngược của chỗ ta nên đứng.

### Giữ — bốn việc chiếm phần lớn giá trị

| Việc | Nhân viên | secrets | Vì sao đáng |
|---|---|---|---|
| **Lọc hộp thư & soạn nháp trả lời** | `inbox` (eco) | `GMAIL_TOKEN` | tần suất hằng ngày, đau rõ, kiểm được ngay |
| **Tóm tắt lịch + chuẩn bị họp** | `scheduler` (eco) | `GCAL_TOKEN` | rẻ, chạy 30 giây, giá trị thấy liền |
| **Ghi chú → việc phải làm** | `notetaker` (standard) | `NOTION_TOKEN` | chỗ người ta đã đổ dữ liệu vào sẵn |
| **Tìm & tóm tắt trên web theo yêu cầu** | `scout` (standard) | — | **không cần MCP nào** — `WebSearch`/`WebFetch` là native tool |

Việc thứ tư đáng chú ý: nó **không cần cắm gì cả**. Trong bốn thứ giá trị nhất, một thứ chạy ngay từ phút đầu — trong khi openclaw đòi cài Gateway, nối kênh chat, và với nhiều người là vài chục đô tiền gỡ rối.

### Bỏ — làm được nhưng thực tế không đáng

Danh sách này giờ có bằng chứng, không chỉ là phỏng đoán:

- **Bề rộng tích hợp (50+ kênh, ClawHub).** Đẹp trên trang chủ. Ca dùng thật mà cộng đồng kể ra đều xoay quanh 2–3 thứ: kho ghi chú, một app nhắn tin, một dịch vụ nghiệp vụ. Chi phí bảo trì tuyến tính, giá trị gần bằng 0 sau cái thứ ba.
- **Việc chạy theo lịch bằng LLM.** Đây là chỗ openclaw hỏng nặng nhất — hỏng cách ngày, và đốt $100/tháng cho một bản tin sáng. **Bài học cho ta:** khi làm lịch chạy định kỳ (lỗ hổng số 2), phần **tất định phải là code**, LLM chỉ chạm vào phần cần phán đoán.
- **Tự động hoá không có người duyệt.** Ca thành công đều có người trong vòng lặp; ca thất bại đều không.
- **Companion app: giọng nói, camera, chụp màn hình.** Bề mặt lớn, không xuất hiện lần nào trong các ca dùng thật được kể lại.
- **Trợ lý thường trú nghe mọi thứ.** Tốn token thường trực đổi lấy một cảm giác. Kiến trúc ở đây cố ý ngược lại: agent đến, làm, chết.
- **Chuỗi agent tự gọi agent.** Nguồn đốt token lớn nhất — và trên canvas của ta nó **không vẽ ra được**.
- **Bắt người dùng viết plugin/MCP.** Rào chắn tuyệt đối với nhóm khách chính. Đây đúng là chỗ `SPEC-connectors.md` chen vào: *mô tả cái API, đừng viết code gọi nó.*

### ⚠ Rủi ro chính sách — đọc kỹ, nó chạm vào luận điểm kinh tế của dự án

**Chuyện đã xảy ra:** 04/04/2026 Anthropic **cắt** quyền dùng subscription Claude cho các harness bên thứ ba như OpenClaw. Lý do nêu ra: vi phạm ToS, và **gây tải bất thường vì chúng đi vòng qua tối ưu prompt cache của Claude Code — gọi model mới tinh mỗi lần**.

Sau đó Anthropic công bố một hạng mục **"Agent SDK credit"** riêng cho thuê bao trả phí (Pro $20 · Max 5x $100 · Max 20x $200 mỗi tháng), dự kiến áp dụng 15/06/2026 — rồi **TẠM HOÃN**. Trang trợ giúp chính thức hiện ghi rõ thay đổi *"không còn áp dụng từ 15/06"* và **chưa có gì đổi so với chính sách cũ**.

**Vị thế của agentco — khác hẳn openclaw ở đúng hai điểm sống còn:**

| | OpenClaw | agentco |
|---|---|---|
| Cách lấy quyền | **dịch ngược luồng xác thực** của Claude Code | **Claude Agent SDK chính thức** của Anthropic |
| Prompt cache | đi vòng qua — chính là lý do bị cắt | **toàn bộ kiến trúc xây quanh việc giữ nó** |

Chính sách được công bố (dù đang hoãn) nói rõ credit đó bao gồm *"app bên thứ ba xác thực bằng subscription của bạn thông qua Agent SDK"* — tức là **đúng hình dạng của agentco, và được phép**.

**Nhưng đây vẫn là rủi ro phải theo dõi, không phải chuyện đã xong:**

1. Nếu bản tách credit được bật lại, người dùng Pro chỉ có **$20/tháng** cho agentco — với chi phí đo được ($0.05–0.20 mỗi việc) là khoảng **100–400 việc/tháng**. Đủ cho người dùng cá nhân, **chật** cho ai chạy nhiều văn phòng.
2. Hết credit thì hoặc rơi về giá API tiêu chuẩn (nếu bật usage credit), hoặc **dừng hẳn tới tháng sau**.
3. Credit **theo từng người, không gộp chung** — ảnh hưởng tới mọi ý định làm bản đội nhóm.

**Ba việc nên làm vì phát hiện này:**

- **`agentco cost` phải nói được "còn bao nhiêu".** Hôm nay nó chỉ nói đã tiêu bao nhiêu. Nếu credit có trần, biết còn lại bao nhiêu là tính năng chứ không phải trang trí.
- **Luận điểm bán hàng phải nêu thẳng chuyện prompt cache.** Anthropic vừa công khai nói lý do cắt là các harness phá cache. Đây là lúc tốt nhất để nói "chúng tôi được xây quanh việc giữ nó" — và ta có số đo để chứng minh, không phải chỉ có lời.
- **`ProviderAdapter` vẫn phải giữ nguyên.** Chưa cần triển khai provider thứ hai, nhưng đừng để mất chỗ cắm.

**Nguồn:** [openclaw/openclaw](https://github.com/openclaw/openclaw) · [Ask HN: Who is using OpenClaw?](https://news.ycombinator.com/item?id=47783940) · [Anthropic closes door on subscription use of OpenClaw — The Register](https://www.theregister.com/2026/04/06/anthropic_closes_door_on_subscription/) · [Claude Code subscribers will need to pay extra — TechCrunch](https://techcrunch.com/2026/04/04/anthropic-says-claude-code-subscribers-will-need-to-pay-extra-for-openclaw-support/) · [Anthropic reinstates third-party agent usage — VentureBeat](https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch) · [Use the Claude Agent SDK with your Claude plan — Anthropic Help Center](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) · [OpenClaw — Wikipedia](https://en.wikipedia.org/wiki/OpenClaw)

**Mệnh đề:** thứ người ta thật sự muốn từ một trợ lý cá nhân gắn tool là **bốn** việc, không phải bốn mươi.

### Giữ — bốn việc chiếm phần lớn giá trị

| Việc | Nhân viên | secrets | Vì sao đáng |
|---|---|---|---|
| **Lọc hộp thư & soạn nháp trả lời** | `inbox` (eco) | `GMAIL_TOKEN` | tần suất hằng ngày, đau rõ, kết quả kiểm được ngay |
| **Tóm tắt lịch + chuẩn bị họp** | `scheduler` (eco) | `GCAL_TOKEN` | rẻ, chạy 30 giây, giá trị thấy liền |
| **Ghi chú → việc phải làm** | `notetaker` (standard) | `NOTION_TOKEN` | chỗ người ta đã đổ dữ liệu vào sẵn |
| **Tìm & tóm tắt trên web theo yêu cầu** | `scout` (standard) | — | **không cần MCP nào** — `WebSearch`/`WebFetch` là native tool |

Việc thứ tư đáng chú ý: nó **không cần cắm gì cả**. Trong bốn thứ giá trị nhất, một thứ chạy ngay từ phút đầu.

### Bỏ — làm được nhưng gần như không ai dùng thật

- **Cắm được mọi API trên đời.** Bề rộng tích hợp là thứ đẹp trên trang chủ và chết trong thực tế: người dùng cắm 2–3 thứ rồi dừng. Chi phí bảo trì tuyến tính, giá trị gần như bằng không sau cái thứ ba.
- **Tự động hoá nhiều bước không có người duyệt.** "Agent tự gửi email cho khách" là tính năng ai cũng tắt sau lần đầu nó gửi nhầm.
- **Bắt người dùng viết MCP server.** Rào chắn tuyệt đối với nhóm khách chính. Đây đúng là chỗ `SPEC-connectors.md` định chen vào: *mô tả cái API, đừng viết code gọi nó.*
- **Trợ lý luôn thường trú, nghe mọi thứ.** Tốn token thường trực để đổi lấy một cảm giác. Kiến trúc ở đây cố ý ngược lại: agent đến, làm, chết.
- **Chuỗi agent tự gọi agent.** Nguồn đốt token lớn nhất, không kiểm soát được — và trên canvas của ta nó **không vẽ ra được**.

### Khoảng trống kinh tế thật nằm ở đâu — giờ có bằng chứng

Không nằm ở "gắn được nhiều tool hơn" — openclaw đã có 50+ kênh và người ta vẫn bỏ. Nó nằm ở ba chỗ, và cả ba đều **đúng chỗ openclaw đau nhất**:

| Chỗ trống | Bằng chứng từ phía openclaw | Ta đã có sẵn gì |
|---|---|---|
| **Chi phí kiểm soát được** | *$100/tháng cho một bản tin sáng chạy 1–2 lần/tuần*; Anthropic cắt vì các harness *phá prompt cache* | toàn bộ kiến trúc xây quanh prefix cache; `$0.09 · 4 lượt` hiện ngay trên màn hình |
| **Chạy trên subscription hợp lệ** | openclaw bị cắt vì dịch ngược luồng xác thực | dùng **Agent SDK chính thức** — đúng con đường được cho phép |
| **Kết quả là file của người dùng** | chính người dùng openclaw khen điểm này nhất: *"trí nhớ nằm trong version control, đọc và sửa được"* | markdown + yaml trong thư mục của họ, từ ngày đầu |

Điểm thứ ba đáng chú ý: đó là thứ **cộng đồng openclaw tự nêu ra là lý do họ ở lại**, chứ không phải một giả thuyết của ta. Nó xác nhận nguyên tắc *"sở hữu artifact, không sở hữu prompt"* là một luận điểm bán được, không chỉ là một quyết định kỹ thuật.

**Và chỗ KHÔNG nên đứng:** đừng cạnh tranh ở "làm được nhiều thứ hơn". Openclaw có 380 000 sao và vẫn bị gọi là *"một bản Claude Code tệ hơn, chậm hơn"*. Bề rộng không phải hào nước.

**Thiếu — nghiêm trọng nhất trong cả 10 use case:** chưa có **cổng duyệt**. Trạng thái `needs_human` đã có trong schema receipt nhưng **không có màn hình nào để duyệt**. Không có nó thì bốn việc ở trên chỉ dừng ở mức "soạn nháp", không bao giờ được phép bấm gửi. Đây là hạng mục nên làm trước Telegram bridge.

---

## Tổng kết: 10 use case này lộ ra 5 lỗ hổng

Xếp theo thứ tự nên làm, không theo thứ tự use case:

| # | Thiếu gì | Chặn use case | Kích cỡ |
|---|---|---|---|
| 1 | **Cổng duyệt** (`needs_human` có schema, không có màn hình) | 10, và mọi việc có hậu quả ra ngoài | vừa |
| 2 | **Lịch chạy định kỳ** | 4, và cả nhóm "theo dõi" | nhỏ |
| 3 | **Kiểm chứng bằng code, không bằng LLM** | 3, 7 — mọi việc mà sai số là sai hẳn | vừa |
| 4 | **Chia tài liệu dài** (Librarian) | 2, 6 | vừa |
| 5 | **`agentco resume`** (`pending.json` đã ghi, chưa ai đọc) | mọi use case dài gặp hết hạn mức | nhỏ |

Ba trong năm cái là **nhỏ hoặc vừa**. Không cái nào đòi đổi kiến trúc — đó là tin tốt, và cũng là bằng chứng rằng nền đã đặt đúng chỗ.

## Bốn use case nên dựng thành template TRƯỚC

Chọn theo P/công sức, không theo độ hấp dẫn:

1. **#9 Báo cáo tiến độ** — chúng ta là người dùng, phản hồi tức thì, không thiếu gì.
2. **#1 Xưởng nội dung** — đã chạy, và là kịch bản quay video tốt nhất (song song nhìn thấy được).
3. **#5 Bản địa hoá** — chứng minh giá trị kho tri thức bằng số đếm được.
4. **#10 Trợ lý cá nhân, chỉ với `scout`** — bản không cần cắm gì, chạy được từ phút đầu.

Ba use case còn thiếu hạ tầng (3, 4, 6) để sau — làm sớm chỉ ra một template hứa nhiều hơn nó làm được.
