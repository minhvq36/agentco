# SPEC — AgentCo (tên mã tạm)

**Ngày:** 14/08/2026
**Trạng thái:** thiết kế, chưa code
**Sản phẩm:** P2 — "công ty agents" chạy trên Claude Agent SDK
**License:** FSL (Functional Source License) — 2 năm → Apache 2.0

> `agentco` là **tên mã tạm**, chưa phải tên thương hiệu. Mọi chỗ trong spec dùng nó như placeholder cho tên package/binary.

Đọc kèm:
- `SPEC-token-economy.md` — **quan trọng nhất**, luật kinh tế token. Mọi quyết định thiết kế phải qua được file này.
- `SPEC-cli.md` — process model, CLI, khả năng containerize
- `SPEC-ui.md` — giao diện
- `ROADMAP.md` — thứ tự làm, mô hình kinh doanh

---

## 1. Sản phẩm là gì (một câu)

Một **công ty ảo chạy trên máy của người dùng**: Claude Code làm giám đốc (master), điều phối một đội agent chuyên môn chạy song song, tích luỹ kinh nghiệm vào một kho tri thức dạng đồ thị, và người dùng ra lệnh bằng tiếng người — qua web UI hoặc qua app chat (Telegram).

**Không phải** framework cho dev. **Không phải** dịch vụ đám mây. Là **phần mềm người dùng tự chạy, bằng subscription Claude của chính họ.**

### Ba nguyên tắc bất di bất dịch

1. **Sở hữu artifact, không sở hữu prompt.** Giá trị nằm ở file trong thư mục công ty của người dùng — tri thức, kế hoạch, sản phẩm đầu ra. Chúng sống độc lập, sống sót qua mọi thay đổi của Claude Code.
2. **Agent là hàm stateless.** Đến, làm, ghi kết quả ra file, chết. Trí nhớ nằm ở đồ thị tri thức, không nằm trong context window.
3. **Mỗi token phải có lý do tồn tại.** Xem `SPEC-token-economy.md`.

### Bốn tiêu chí chất lượng — thêm 15/08/2026

Ba nguyên tắc trên nói **xây cái gì**. Bốn tiêu chí này nói **xây tới mức nào**, và chúng là điều kiện để gọi một tính năng là "xong". Từ đây trở đi, "chạy được trên máy tôi" không còn là định nghĩa của xong.

| | Nghĩa cụ thể — kiểm được, không phải khẩu hiệu |
|---|---|
| **Ổn định** | Không có đường nào dẫn tới màn hình trắng. Mọi trạng thái rỗng (chưa có văn phòng, chưa có nhân viên, chưa có việc) đều là màn hình được thiết kế, không phải tai nạn. Sập một văn phòng không được kéo theo văn phòng khác. |
| **Xử lý lỗi tốt** | Mọi lỗi hiển thị cho người dùng phải trả lời được **chuyện gì xảy ra + làm gì tiếp**. Lỗi mạng/hết hạn mức/file hỏng có đường phục hồi, không chỉ có thông báo. Lỗi của một agent không giết cả ca làm việc. |
| **Hiệu năng** | Kéo node giữ 60fps kể cả khi công ty đang chạy. Log dài không làm đơ tab. Không lượt gọi LLM nào tồn tại chỉ để phục vụ hiển thị. |
| **Mượt** | Đổi văn phòng, mở panel, đóng dialog không giật, không nhảy layout. Thao tác kéo/nối phản hồi tức thì trước khi server trả lời. |

**Ràng buộc chéo với kinh tế token:** không tiêu chí nào ở đây được phép mua bằng token. "Mượt" không bao giờ có nghĩa là gọi thêm LLM cho trơn tru; "xử lý lỗi tốt" không bao giờ có nghĩa là nhờ model diễn giải lỗi. `SPEC-token-economy.md` vẫn là luật cao hơn.

---

## 2. Mô hình tổ chức

```
                      ┌──────────────┐
   Human ────────────►│    MASTER    │  session dài, đối thoại, lập kế hoạch
   (UI / Telegram)    │  (Claude)    │  KHÔNG tự làm việc tay chân
                      └──────┬───────┘
                             │ TaskBrief (DAG)
                  ┌──────────┼──────────┬──────────┐
                  ▼          ▼          ▼          ▼
              ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐
              │Worker │  │Worker │  │Worker │  │Worker │   stateless,
              │       │  │       │  │       │  │       │   song song
              └───┬───┘  └───┬───┘  └───┬───┘  └───┬───┘
                  │ Receipt (≤800 token)│          │
                  └──────────┴──────────┴──────────┘
                             │
                    ┌────────▼─────────┐
                    │  KNOWLEDGE GRAPH │  markdown + frontmatter
                    │  shared / role   │  người đọc được, máy đọc được
                    └──────────────────┘
```

Mô hình hình sao — worker **không nói chuyện trực tiếp với nhau**. Mọi trao đổi đi qua master hoặc qua artifact/knowledge. Lý do không phải thẩm mỹ mà là kinh tế: agent-to-agent chat là nguồn đốt token lớn nhất trong mọi hệ multi-agent, và không kiểm soát được.

### Master làm gì

- Đối thoại với người
- Dịch yêu cầu → **kế hoạch DAG** các task
- Nhận receipt, quyết định bước tiếp
- Ghi **kinh nghiệm chung** (`scope: shared`) vào đồ thị
- Xử lý xung đột, escalate hỏi người khi cần

### Master KHÔNG làm gì

- Không đọc raw transcript của worker (chỉ đọc receipt)
- Không tự đọc file lớn (giao cho worker)
- Không tự viết code/nội dung

---

## 3. Vai trò agent (Role)

Một role = một file định nghĩa, versioned. Người dùng sửa được, đây là điểm "modding" chính.

```yaml
# roles/researcher.yaml
id: researcher
version: 3
display_name: "Nghiên cứu viên"
avatar: "🔎"

# Bộ giới thiệu cho MASTER biết — cực ngắn, nằm trong context master
pitch: "Tìm và tổng hợp thông tin từ web + file dự án. Đầu ra: file markdown có nguồn."
good_at: [web-research, doc-summary, fact-check]
not_for: [viết code, thiết kế]

# Kỹ năng — 3 mức, người dùng chọn, hoặc dùng mẫu có sẵn
skill_level: medium        # short | medium | formal
skills:
  short:  "skills/researcher.short.md"    # ~200 token
  medium: "skills/researcher.medium.md"   # ~800 token
  formal: "skills/researcher.formal.md"   # ~2500 token

tools: [Read, Glob, Grep, WebSearch, WebFetch, Write]
mcp: []                    # người dùng cắm thêm

model_tier: standard       # eco | standard | deep  → xem switch center
budget:
  max_tokens: 60000
  max_turns: 15
  knowledge_pack: 3000     # trần token tri thức nạp vào

hot_knowledge_size: 8      # số node "nóng" đưa vào prefix cache
```

**`pitch` là thứ duy nhất master thấy** khi lập kế hoạch. Toàn bộ `skills` chỉ nạp vào chính worker khi nó chạy. Đây là lý do kế hoạch của master rẻ.

### Skills chia hai lớp — CORE không sửa được

Người dùng sửa được skills và kinh nghiệm của mọi agent, kể cả master. Nhưng **không phải mọi thứ đều nên sửa được**:

| Lớp | Nội dung | Sửa? | Nằm ở đâu |
|---|---|---|---|
| **Core** | giao thức Receipt, kỷ luật ngân sách, luật "giao việc đừng tự làm", schema đầu ra | ❌ | ship cùng phần mềm, version theo `software_version` |
| **User** | tính cách, giọng điệu, kiến thức ngành, thói quen làm việc, ưu tiên role nào | ✅ | `skills/*.md` trong thư mục công ty |

Ranh giới quyết định bằng đúng một câu:

> **Thứ gì đang thi hành một bất biến trong `SPEC-token-economy.md` thì là CORE.**

Cho sửa lớp core không phải là trao tự do — là trao cái bẫy. Người dùng gỡ mất giao thức Receipt thì kiến trúc chi phí sụp, rồi họ sẽ đổ lỗi cho sản phẩm chứ không cho bản sửa của mình.

Trong prompt: core đứng trước, user layer đứng sau, **cả hai đều trước `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`**. Nghĩa là lớp user vẫn được cache — nhưng **mỗi lần lưu là bump cache key**, phải trả một lần cache write rồi mới ổn định lại.

→ **Yêu cầu UI:** ô soạn skills **không được autosave theo từng phím**. Phải có nút Lưu tường minh. (`SPEC-ui.md` §2.2)

### Bộ role mặc định (ship sẵn)

| Role | Việc | Tier |
|---|---|---|
| `researcher` | tìm & tổng hợp thông tin | standard |
| `writer` | viết nội dung | standard |
| `coder` | viết/sửa code | standard |
| `reviewer` | soát lỗi, kiểm chất lượng | standard |
| `librarian` | gộp/dọn đồ thị tri thức | **eco** |
| `analyst` | đọc số liệu, tổng hợp | standard |
| `concierge` | **việc vặt có MCP** — xem lịch, gửi tin, tra DB, lấy URL | **eco** |

### `concierge` — là TOOL, không phải nhân viên

**Master không biết `concierge` tồn tại.** Master chỉ thấy một tool:

```
quick_action(what: string) → { say: string, result: string }
```

Runtime nhận lời gọi đó và bung một query one-shot phía sau. Đây là abstraction đúng, không phải mẹo:

- Người dùng sửa skills của master **không thể** làm hỏng — prompt master không hề nhắc `concierge`
- UI ẩn tự nhiên, không cần case đặc biệt: nó vốn là tool, không phải task
- Không xuất hiện trong danh sách nhân viên, vì nó không phải nhân viên
- Khi [#247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247) được sửa: đổi implementation sau đúng tên tool đó, không đụng gì khác

> **Lưu ý:** Agent SDK **không bundle MCP server nào**. Thứ luôn có sẵn không cần key là **native tools** (`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `WebSearch`, `WebFetch`) — chúng không phải MCP. Vì `WebSearch`/`WebFetch`/`Bash` phủ phần lớn việc vặt, **`concierge` thường chạy không cần MCP nào**. MCP chỉ vào cuộc khi người dùng tự cắm (Notion, Calendar, DB của họ).

### Vì sao không treo MCP thẳng vào master

Master là session dài, resume liên tục. Gắn MCP thẳng vào master → [issue #247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247) → cache master vỡ, tốn **~36 000 token quy đổi mỗi lượt nói chuyện**. Một `concierge` one-shot có MCP chỉ tốn **~4 350** trên Haiku — rẻ hơn gần một bậc độ lớn.

**Quan trọng — đây là quyết định UI, không phải quyết định kiến trúc:** trên giao diện, `concierge` **không hiện ra như một task**, không có bước trong kế hoạch, không có thẻ agent. Nó hiện như **chính master đang làm**. Người dùng vẫn thấy "sếp tự xử lý việc nhỏ", đúng như kỳ vọng; chỉ tầng dưới là khác.

`master.mcp: false` là **setting** trong `company.yaml`, không hard-code — khi Anthropic sửa #89/#247 thì bật lên là master cầm MCP trực tiếp được.

Người dùng thêm role bằng cách thả file yaml vào `roles/`. Không cần restart (hot reload có kiểm tra version).

---

## 4. Giao thức Task ↔ Receipt

Đây là **hợp đồng cốt lõi**. Nó vừa là tối ưu token, vừa là tính năng UX ("đơn giản mặc định, log advanced khi cần") — cùng một cơ chế phục vụ cả hai.

### TaskBrief (master → worker) — mục tiêu ≤1500 token

```json
{
  "task_id": "T-0007",
  "role": "writer",
  "goal": "Viết caption fanpage giới thiệu sản phẩm X",
  "inputs":  [{"kind":"file","path":"artifacts/T-0003/research.md"}],
  "outputs": [{"kind":"file","path":"artifacts/T-0007/caption.md"}],
  "constraints": ["≤200 từ", "giọng thân thiện", "có CTA"],
  "knowledge_refs": ["k/shared/brand-voice"],
  "budget": {"max_tokens": 40000, "max_turns": 12, "tier": "standard"},
  "deps": ["T-0003"]
}
```

Master **không** dán nội dung file vào brief — chỉ đưa **đường dẫn**. Worker tự đọc. Nếu master dán nội dung, nội dung đó nằm luôn trong context master mãi mãi → đây là lỗi đốt token số 1 trong các hệ multi-agent.

### Receipt (worker → master) — **trần cứng 800 token**

```json
{
  "task_id": "T-0007",
  "status": "done",
  "say": "Xong caption, 180 từ, bám brand voice, có CTA cuối bài.",
  "artifacts": ["artifacts/T-0007/caption.md"],
  "lessons": [
    {"kind":"pitfall","text":"Hook mở bài quá dài thì reach giảm; giữ ≤12 từ."}
  ],
  "blocked_on": null,
  "usage": {"in":1200,"cache_read":9800,"out":650,"tier":"standard"}
}
```

- `status`: `done | failed | blocked | needs_human`
- `say`: **câu tiếng người**, hiển thị thẳng lên UI. Không tốn thêm call nào để "dịch cho thân thiện" — worker sinh sẵn.
- Runtime **validate schema và cắt cứng**. Worker trả văn xuôi → từ chối, hỏi lại đúng 1 lần kèm schema, lần 2 vẫn sai thì đánh `failed`.

**Bất biến:** không một byte transcript thô nào của worker được đi vào context của master. Có test đảm bảo điều này.

---

## 5. Đồ thị tri thức

### ⚠ Node tri thức ≠ tài liệu người dùng tải lên

Câu hỏi hay bị hiểu nhầm: *"nạp cả kho vào input à?"* — không, và ranh giới phải nói rõ.

| | Node tri thức | Tài liệu tải lên |
|---|---|---|
| Kích thước | trần **250 token/node**, cảnh báo khi vượt | tuỳ ý, hàng MB |
| Vào prompt | **HOT** vào prefix (trần `hot_knowledge_tokens: 2000`) · **COLD** chọn theo task | **không bao giờ** |
| Cách với tới | code chọn sẵn, 0 token | agent tự `Glob`/`Grep`/`Read` khi cần |
| Ai sinh ra | agent rút ra sau khi làm, hoặc người dùng chốt | khách bỏ vào |

Nói cách khác: **kho tri thức là những câu ngắn đã chắt ra, không phải nơi chứa file.** File của khách nằm trong `artifacts/` và được với tới bằng khoá ngoại + `Grep` — xem phụ lục `SPEC-connectors.md`. Trần 250 token/node tồn tại chính là để ranh giới này không bị xoá nhoà theo thời gian.

Vì sao HOT tồn tại chứ không "khi nào cần mới mò vào": thứ nằm trong prefix được cache trả **~0.1×** sau lần ghi đầu; thứ lấy theo từng task trả **nguyên giá mỗi lần**, và nếu nhét vào prefix thì prefix đổi mỗi task → cache miss 100%, tệ hơn không cache. Hai tầng là để có cả hai.

### 🔴 5·0. `KnowledgeNode` KHÔNG có trường ngôn ngữ — quyết định 03/09, và nó là một quyết định KHÔNG LÀM

Đợt đa ngôn ngữ có đề xuất gắn `lang?: 'vi'|'en'` cho node, suy ra bằng bộ dò dấu tiếng Việt.
**Đã bỏ.** Lý do không phải "chưa cần" mà là "sai về loại":

1. **Bộ dò đó nhị phân.** Ghi chú tiếng Đức, Tây Ban Nha, Ả Rập đều không mang dấu tiếng Việt ⇒ nó
   lặng lẽ ghi `en`. Đó là một **tín hiệu đội lốt cổng tất định**, và nó ghi phán đoán **xuống đĩa,
   vào dữ liệu người dùng** — nơi không lần đọc nào sau đó biết giá trị ấy là đoán.
2. **Không ai tiêu thụ nó.** `hot()` đã chốt là **không lọc theo ngôn ngữ**: lọc là đổi một phiền
   toái *nhìn thấy được* (prefix lẫn hai thứ tiếng) lấy một phiền toái *im lặng* (văn phòng quên mất
   thứ nó đã học, không ai báo). Repo này chọn cái nhìn thấy được, mọi lần.

`hasVietnameseDiacritics` chỉ sống ở `scripts/check-language.ts`, và nó **tất định 100% chỉ ở đó** vì
nó soi **mã nguồn của chính ta** — thứ có đúng hai khả năng. Chĩa cùng hàm ấy vào văn bản người dùng
là biến nó thành một phép đoán.

**Điều kiện mở lại — đo được, và chỉ dựng cơ chế khi có một trong hai:**

1. một văn phòng thật tích được ghi chú ở **≥2 ngôn ngữ**, **kèm** một đầu ra sai truy được về chuyện
   lẫn (không phải "trông kỳ kỳ");
2. có người thật xin lọc.

Và khi đó cơ chế đúng **không phải bộ dò**: là **model tự khai** ngôn ngữ nó vừa viết, dưới dạng một
thẻ BCP-47 tự do (`vi` · `en` · `zh-Hans` · `ar` · `de`…), ghi **chỉ cho node sinh ra từ thời điểm đó
trở đi**. Node cũ **để trống, và trống nghĩa là KHÔNG BIẾT** — không suy diễn.

`test/knowledge-untouched.test.ts` khoá cả ba vế: không trường ngôn ngữ trên node, `hot()` không nhận
tham số ngôn ngữ, và không bộ dò dấu nào trong `knowledge/`. Nó đỏ vào ngày ai đó thêm một bộ dò "cho
tiện", và bắt họ đọc mục này trước khi đi tiếp.

### 5a. BỐN LUẬT SINH KINH NGHIỆM — chốt 19/08/2026

Đề bài do người dùng nêu, và nó là chẩn đoán đúng về một lớp lỗi chứ không phải một bug:

> *"Cơ chế ghi lại kinh nghiệm đang tự tạo một CACHE, và rất có thể cache này **sai khi người dùng update tài liệu**."*

Đúng. Bảng ở §5 trên tuyên bố *"node tri thức ≠ tài liệu"* từ 14/08, nhưng cái làm ranh giới đó vỡ không phải kích thước — mà là **thể loại nội dung**. Một node chép lại *nội dung* tài liệu là một bản sao thứ hai của cùng một sự thật, và **bản sao đó thắng**: nó nằm sẵn trong prefix của mọi nhân viên, còn tài liệu thì phải đi tìm.

| # | luật | che ca nào | thi hành ở đâu |
|---|---|---|---|
| 1 | chỉ ghi **CÁCH LÀM**, không ghi **KIẾN THỨC** | tài liệu **bị SỬA** | `LessonSchema` (bỏ `'fact'`) · `quotesLibraryNumber` · `echoesLibrary` |
| 2 | **thực thể yếu** — file mất thì node mất | tài liệu **bị XOÁ / đổi tên** | `KnowledgeNode.depends_on` · `dropDependents` |
| 3 | chỉ sinh khi ca có **trục trặc hoặc LẶP** | ca sinh ra từ hư không | `worthLearning` |
| 4 | không spam bản **na ná nhau** | kho phình vì lặp lại | `findTwin` · `twinScore` |
| **5** | **chỉ ghi thứ MỘT AGENT SỬA ĐƯỢC** | lỗi của hạ tầng / cấu hình / người dùng | `agentFault` · `Receipt.failure` |

#### 🔴 Luật 5 — CÂU HỎI *"CỦA AI"* PHẢI ĐƯỢC TRẢ LỜI TRƯỚC CÂU HỎI *"HỌC ĐƯỢC GÌ"* (user chốt 21/08)

Ca thật: hai node gần như y hệt nhau, cùng `scope: shared`, cách nhau chín phút.

```
"Phan-tich-standard liên tục chạm trần chi phí … nên nới max_usd"
"Việc nhóm+tổng hợp CSV có thể chạm trần … cân nhắc nới max_usd"
```

Ba thứ hỏng cùng lúc, và cái thứ hai là cái đắt:

1. **SAI NGƯỜI ĐỌC.** Kinh nghiệm nằm trong prefix của **mọi worker**. Worker không sửa được `max_usd` — nó không có tay để làm việc đó. Lời khuyên ấy gửi cho **con người**, mà con người không đọc kho tri thức; họ đọc ô chat, nơi câu đó **đã được nói rồi**. Ta trả tiền vĩnh viễn để nhắc lại một câu đã giao đúng cửa.
2. **TỰ CHUỐC LẤY.** Node vào prefix → prefix dài ra → mỗi lượt đắt lên → **chạm trần dễ hơn**. Một bài học cảnh báo về chạm trần, mà cơ chế tồn tại của nó là làm tăng chi phí. Nó sản xuất ra chính vấn đề nó cảnh báo.
3. **SẼ SAI.** Ngày người dùng nới trần, node vẫn nói *"hay chạm trần"* — và node **thắng**, vì nó nằm sẵn trong đầu mọi nhân viên. Đúng lớp lỗi luật 1 sinh ra để chặn, chỉ khác là kiến thức bị chép ở đây là **cấu hình của chính hệ thống**, không phải nội dung tài liệu.

**Vì sao KHÔNG lọc bằng prompt.** Prompt **đã** cấm, bằng hai dòng riêng biệt (*"Không ghi con số, ngưỡng, giá, ngày tháng"* và *"Bài học ghi CÁCH LÀM"*), và model vẫn ghi ra hai node về ngưỡng chi phí. Một luật chỉ sống trong prompt là một **LỜI HỨA**.

> ⚠ **Và đây là chỗ LLM yếu nhất, nên đừng hỏi nó.** Model không phân biệt nổi *"tôi làm sai"* với *"môi trường quanh tôi chặn tôi lại"* — trong ngữ cảnh của nó, cả hai đều hiện ra y hệt nhau: **một lượt không xong**. Nó không có chỗ đứng để nhìn ra ranh giới đó. Ta thì có, và ta biết chắc **bằng dữ liệu**.

`FailureKind` phân hoạch sạch theo *ai sửa được*:

| kiểu | ai gây ra | agent làm gì được |
|---|---|---|
| `budget` · `max_turns` | trần NGƯỜI DÙNG đặt | không — nó không sửa cấu hình |
| `rate_limit` · `usage_limit` | hạ tầng / gói cước | không |
| `auth` | cấu hình máy | không |
| `stopped` | người dùng bấm Dừng | không, và đó không phải trục trặc |
| `other` | có thể là chính nó | có |

⚠ **Nửa dễ làm mất nhất:** `blocked_on` do **nhân viên tự khai** (*"thiếu file thuật ngữ"*) là bài học đắt nhất trong kho; `blocked_on` do **hệ thống ghi** (*"chạm trần $0.4"*) là rác. Hai câu nằm cùng một trường, và `Receipt.failure` là thứ **duy nhất** phân biệt được chúng. Bản vá đầu bỏ luôn `blocked_on` khỏi tín hiệu và làm mất một ca có thật — bộ test bắt được ngay.

⚠ Vì thế `stoppedReceipt` **phải** khai `failure: 'stopped'`. Thiếu dòng đó thì `agentFault` đọc `blocked_on: "người dùng dừng giữa chừng"` như lời khai của nhân viên, rồi đi hỏi model *"học được gì"* cho một việc chính người dùng vừa bảo đừng làm.

#### Luật 4 — ngưỡng đã ĐO, và tiền đề cũ là một lời hứa

`TWIN_RATIO` từ **0.75 → 0.6**. Cặp trùng thật ở trên đo được **0.654** — trượt ngưỡng cũ, hai node cùng sống. Phần lệch nằm gần như trọn vẹn ở từ đệm (*liên tục* ↔ *có thể*, *nên* ↔ *cân nhắc*, *dạng này* ↔ *tương tự*): cùng một câu, hai giọng.

Chú thích cũ biện minh cho 0.75 bằng câu *"bỏ sót thì chỉ tốn một node mà Librarian (M1) gộp lại được sau"*. **Librarian chưa tồn tại.** Nên cái giá thật của bỏ sót không phải "một node chờ gộp" mà là **token trong prefix của mọi worker, mọi lượt, vĩnh viễn** — hai phía không đối xứng như giả định:

```
chặn nhầm → mất một bài học, hits của bản cũ +1, còn dấu vết
bỏ sót    → trả token mãi mãi cho một bản sao không ai dọn
```

> **Quyết định đúng + tiền đề sai = bom hẹn giờ.** Nó vừa nổ.

`twinScore` được **tách ra khỏi `findTwin`** để ngưỡng kiểm được bằng test mà không phải dựng `KnowledgeStore` trên đĩa — trả một nửa nợ 0b, đúng luật *"khi một luật quan trọng nằm trong hàm không test được thì món nợ thật là hình dạng của code"*.

#### ⚠ Luật 1 và luật 2 KHÔNG thay thế nhau — đây là chỗ dễ hiểu nhầm nhất

Trực giác nói *"gắn node vào file là xong"*. Không xong:

```
doi-tra.md  bị XOÁ   → depends_on nổ  → node biến mất        ✅ luật 2
doi-tra.md  bị SỬA   → file VẪN CÒN   → depends_on IM LẶNG   ⛔
                                       → node cũ vẫn sống, vẫn sai
```

Mà ca **bị sửa** mới đúng là ca người dùng lo (*"update tài liệu"*), và nó cũng là ca **thường xuyên hơn** — người ta sửa chính sách nhiều hơn là xoá nó.

Thứ che ca đó là **luật 1**: một câu về *cách làm* vẫn đúng bất kể nội dung file đổi thế nào.

```
✅ "chính sách đổi trả nằm ở library/files/doi-tra.md — grep ở đó trước khi trả lời"
⛔ "hàng giảm trên 50% không được đổi trả"
```

→ **Vì thế luật 1 phải thi hành bằng CODE, không phải bằng một câu dặn trong prompt.** Nếu nó chỉ là lời khuyên thì luật 2 phải gánh phần nó không gánh nổi.

#### Luật 1 — ba lớp, cứng trước mềm sau

1. **Bỏ `'fact'` khỏi `LessonSchema.kind`.** Chính nó là cái ô để chép kiến thức vào. Còn ô thì model sẽ dùng — bỏ ô đi rẻ hơn và chắc hơn mọi câu dặn. (`NodeType` vẫn giữ `'fact'`: bản GHI NHỚ của Trợ lý dùng nó, và thứ **người dùng** tự chốt thì đúng là fact.)
2. **`quotesLibraryNumber` — chốt chặn CON SỐ.** Kinh nghiệm chứa số ≥2 chữ số mà con số đó **có mặt trong tài liệu** thì từ chối.
3. **`echoesLibrary`** — lưới chồng-từ đã có từ trước, giờ là lưới thứ ba chứ không phải lưới chính.

> **Vì sao lớp 2 tồn tại, và nó vá đúng lỗ nào.** Node `k/shared/san-pham-giam-gia-60-…` ngày 19/08 ghi *"giảm 60% **thường** không được đổi trả"* trong khi tài liệu viết *"trên 50% KHÔNG áp dụng"*. Chồng từ **đo được 0.47** — dưới ngưỡng 0.6, **lọt lưới**.
>
> Quy luật đằng sau: **diễn giải càng xa bản gốc thì lưới chồng-từ càng yếu — mà diễn giải sai mới là thứ nguy hiểm**, vì nó vừa sai vừa không truy được về nguồn. Con số thì ngược lại: nó **sống sót qua mọi cách diễn đạt**. Và một câu về cách làm gần như không bao giờ cần tới ngưỡng, giá hay ngày tháng.
>
> Chỉ chặn khi con số **nằm sẵn trong tài liệu**: bài học *"hỏi lại tối đa 2 câu rồi bắt tay vào làm"* mang số 2 nhưng đó là số của **cách làm**, phải qua được. Bỏ qua số 1 chữ số vì chúng đụng ngẫu nhiên quá dễ.

#### Luật 2 — `depends_on` đến từ QUAN SÁT, không từ lời khai

Nguồn là `receipt.reads`: file trong `library/` mà nhân viên **thật sự `Read`** trong ca, bóc từ luồng `tool_use`. Cùng luật với `landed` (§6 SPEC-offices): *thứ gì quan sát được thì đừng hỏi model*.

Xoá theo kiểu **BẤT KỲ** (một file mất là node mất), không phải TẤT CẢ — bảo thủ có chủ ý: **một lời khuyên đúng một nửa nguy hiểm hơn không có lời khuyên nào**, vì không ai biết nửa nào đã hỏng.

Cascade chạy ở **`Office.removeDocument`**, ngay lúc người dùng bấm xoá — **không** ở một job quét định kỳ. Job quét nghĩa là có một cửa sổ thời gian mà node mồ côi vẫn nằm trong prefix của mọi nhân viên và vẫn được nghe theo, mà độ dài cửa sổ đó không ai kiểm được.

#### Luật 3 — `looped`, và vì sao KHÔNG phải số lượt

Người dùng nói *"chỉ sinh kinh nghiệm khi flow bị **loop**"*. Đúng ý, nhưng phải đo đúng thứ — chi tiết ở `SPEC-offices.md` §6 và `types.ts`. Tóm tắt:

| | model-independent? | |
|---|---|---|
| `turns >= N` | ❌ | haiku 10 lượt vs sonnet 4 lượt cho **cùng một việc**. Ca 19/08 chạy đúng **9 lượt** → `turns >= 8` cho qua đúng cái ca nó sinh ra để chặn |
| **lặp thao tác** | ✅ | đọc lại file đã đọc · đọc lại file vừa ghi · gọi lại y nguyên một tool. Cả ba đều là **vi phạm một luật `CORE_PROMPT` đã viết thành lời** |

#### Luật 4 — trùng thì CỘNG PHIẾU, đừng vứt

Jaccard trên tập từ, **cùng scope**, ngưỡng `TWIN_RATIO = 0.75`. Trùng thì `recordHits` cho node đang sống thay vì ghi node mới.

Bản trùng là **bằng chứng** bài học có thật, không phải rác — mà `hits` chính là thang xếp hạng vào HOT. Nên biến nó thành một lá phiếu vừa chặn spam vừa **đẩy node đúng lên trên**, và (qua `last_used`) làm nó **trẻ lại** để cửa sổ khai tử không dọn mất một bài học vẫn còn đúng.

Chỉ so **trong cùng scope**: một bài học của `nguoi-viet` và một của kho chung nói giống nhau **không phải** trùng — chúng vào prefix của hai tập người khác nhau.

> ⚠ `0.75` **chưa được đo** trên kho thật; nó là điểm khởi đầu bảo thủ. Lệch về phía **bỏ sót** là lệch đúng hướng: chặn nhầm mất hẳn một bài học thật, còn bỏ sót thì Librarian (M1) gộp lại được sau.

#### Hệ quả phải nói thẳng: kho này gần như KHÔNG GHI nữa

Chồng đủ bốn luật thì số kinh nghiệm agent tự sinh tiến về **gần bằng không**. Đó là **kết quả mong muốn**, không phải tác dụng phụ — nhưng phải ghi ra để lần sau không ai tưởng cơ chế hỏng.

Đường lành mạnh vốn không phải đường này: nói với Trợ lý rồi `/clear` → node **GHI NHỚ**, `confidence 0.9`, do **chính người dùng chốt**. So với `0.6` của kinh nghiệm agent tự rút, thang confidence đã nói sẵn cái gì đáng tin hơn.

### Cơ chế chọn: HOT xếp hạng, COLD khớp từ khoá

Cả hai đều **tất định, chạy bằng code, 0 token**. Không có lời gọi model nào để "quyết xem nên nhớ gì".

| | HOT | COLD |
|---|---|---|
| Đầu vào | chỉ `roleId` | `roleId` **+ nội dung task** (`goal` + `constraints`) |
| Chọn thế nào | xếp hạng theo `hits` → `confidence` → `id` (phá hoà tất định), lấy top `hot_knowledge_size` | chấm điểm **trùng từ khoá** giữa từ trong task và từ trong node; `tags` nhân đôi; chuẩn hoá theo √(độ dài node) để node dài không tự thắng; nhân `(0.5 + confidence)`; cộng `0.1·log(1+hits)` |
| Nằm ở đâu | **trong** prefix cache | **sau** cache breakpoint |
| Đổi theo task? | **KHÔNG** — đổi là vỡ cache | có |
| Trần | `hot_knowledge_tokens` 2000 | `cold_knowledge_tokens` 3000 |

**Task không "biết" node nào có thông tin nó cần** — nó không chọn gì cả. `cold()` chấm điểm mọi node *nhìn thấy được* dựa trên từ ngữ của chính task, rồi xếp hạng. Không phải grep trên đĩa: là một vòng quét trong bộ nhớ trên `index.json` đã dựng sẵn.

> ⚠ **Giới hạn phải nói thẳng: đây là khớp TỪ NGỮ, không phải khớp Ý NGHĨA.** Task viết *"bài đăng Facebook"*, node viết *"nội dung mạng xã hội"* → trùng nhau **bằng 0** → node không được chọn. Đây chính là chỗ embedding sẽ có ích, và là chỗ duy nhất. Chưa làm vì chưa đo được là cần.

#### COLD leo lên thành HOT — có, và đó là vòng tự sửa

`recordHits` cộng điểm, `hot()` xếp hạng theo `hits`. Node cứ được COLD chọn nhiều lần sẽ leo vào HOT. Không phiêu lưu, vì tín hiệu là **"đã hợp với một việc CÓ THẬT"**, không phải phỏng đoán.

> ⚠ **Bug đã sửa — vòng lặp khép kín không tự sửa được.**
> Bản trước: `recordHits([...hot.ids, ...cold.ids])`. Node HOT được +1 ở **mọi** task chỉ vì nó đang ở trong HOT; `hot()` lại xếp hạng bằng chính `hits`; và `cold()` **loại** node HOT khỏi cuộc thi (`excludeIds: hot.ids`).
> ⇒ Vào được HOT một lần là ở đó **vĩnh viễn**. Số liệu thật: ba node HOT có `hits` 6/3/2, **mọi** node còn lại đúng bằng 0.
> Tệ hơn: `hits` mất hết ý nghĩa — nó đo *"anh ở trong HOT bao lâu"*, không đo *"anh có ích không"*. Và vì thế điều kiện `hits === 0` của `pruneStale` cũng vô nghĩa theo.
> **Sửa: chỉ đếm `cold.ids`.** Giờ `hits` mang đúng một nghĩa: *bộ chọn từ khoá đã thấy node này hợp với một việc có thật bao nhiêu lần*. Vòng tự sửa: COLD leo → chen vào HOT → HOT yếu nhất rơi ra → lại được dự thi COLD.

### Chống phình: `supersedes` — squash lúc GHI, không phải lúc ĐỌC

> **Đây là luật quyết định vì sao kho này không cần vector DB.**
>
> RAG đẩy vấn đề sang **lúc đọc**: kho phình mãi, rồi retrieve top-k từ một đống hỗn độn — nên nó *buộc* phải có embedding. Nén **lúc ghi** thì kho luôn nhỏ, và việc đọc được phép ngu: chọn bằng code, tất định, **0 token**. Đó đúng là thứ `hot()` đang làm và là lý do nó rẻ.

`hits` và `updated` chỉ làm node ít dùng **tụt hạng**. Chúng không trả lời được câu quan trọng nhất: *"quyết định này đã bị đảo ngược chưa?"* — một node **sai** mà hay được đọc sẽ đứng đầu bảng mãi mãi.

`supersedes: [id…]` là mảnh còn thiếu. Bốn tính chất, cả bốn đều có chủ ý:

| | |
|---|---|
| Node bị đè **không bị xoá** | file còn nguyên, đọc lại được để biết vì sao ngày xưa nghĩ thế. Nó chỉ rời khỏi phần nạp vào prompt — cùng tinh thần với Lưu trữ |
| Quan hệ thuộc về node **MỚI** | xoá node mới đi thì quan hệ tự biến mất và node cũ sống lại; không cần bước dọn dẹp nào |
| Lọc ở **`visible()`** | một chốt duy nhất, loại khỏi cả HOT lẫn COLD cùng lúc |
| **Một trường, không phải một đồ thị** | quan hệ duy nhất kho này thật sự dùng là "đè lên". Dựng graph engine cho một quan hệ là mua độ phức tạp trước khi có bài toán |

Bốn cơ chế chống phình, xếp theo thứ tự nên dùng: **`supersedes`** (đúng lên) → **`pruneStale`** (dọn rác) → **`pinned`** (không bao giờ tụt) → **Librarian** gộp trùng định kỳ (`librarian.every_n_tasks`).

#### HAI chỉ số, hai việc — cố ý không trộn

| | Dùng để | Tính chất |
|---|---|---|
| `hits` | **xếp hạng** vào HOT | cộng dồn, chỉ tăng, thưởng cho ích lâu dài |
| `last_used` + cửa sổ `prune_after_days` (15) | **khai tử**, kể cả khi `hits > 0` | **không trạng thái**, tính lúc đọc |

Node 50 hit từ năm ngoái, 15 ngày không ai đụng → **chết**. Node 3 hit, hôm qua vừa dùng → sống, xếp hạng khiêm tốn.

**Vì sao cửa sổ chứ không phải decay:** decay cần một **lịch chạy** — decay lúc nào? mỗi task? mỗi ngày? daemon tắt hai tuần thì sao? Cái lịch đó sẽ trôi. Cửa sổ chỉ cần biết *lần cuối là bao giờ* rồi so với hôm nay **lúc đọc** — daemon tắt bao lâu cũng đúng, không job nền.

> Cùng một luật với `supersedes`, chỉ là lật ngược: **squash quyết lúc GHI, decay tính lúc ĐỌC.** Dữ liệu nào bé thì tính lúc đọc; dữ liệu nào lớn thì nén lúc ghi.

Node cũ chưa có `last_used` rơi về `updated` → được ân hạn trọn cửa sổ. Không cần bảng alias.

> ⚠ **`matched` ≠ `ids` — bẫy đã dẫm và đo được.**
> `cold()` loại node HOT khỏi phần **render** (chúng đã nằm trong prefix rồi). Nếu ghi `last_used` theo danh sách render thì **node trong HOT không bao giờ ghi được gì**.
> Hậu quả thật: kho 5 node với `hot_knowledge_size: 8` → HOT lấy sạch → COLD render rỗng → không node nào có `last_used` → **15 ngày sau cả kho chết**, kể cả những node đang được nạp vào mọi lượt gọi.
> Sửa: `cold()` chấm điểm **toàn bộ** node nhìn thấy được, trả về `matched` (hợp việc) tách khỏi `ids` (thật sự render). `recordHits(cold.matched)`.
> Đo lại: `HOT lấy 2 → COLD render 0 → matched 2 → cả hai ghi được last_used`. Và node HOT **chưa bao giờ** hợp việc nào thì vẫn chết đúng lúc — nó đang ngồi trong prefix của mọi lời gọi mà không đóng góp gì.

#### `pruneStale` — và giới hạn của `hits` phải nói thẳng

Mỗi lần nén trí nhớ (`/clear` hoặc tự động), xoá node thoả **TẤT CẢ**: cũ hơn `librarian.prune_after_days` (mặc định 12) **VÀ** `hits === 0` **VÀ** không `pinned` **VÀ** không phải node GHI NHỚ.

> ⚠ **`hits` chỉ đáng tin khi kho ĐÃ LỚN HƠN `hot_knowledge_size`.** Dưới ngưỡng đó, `hot()` lấy *toàn bộ* node mỗi lượt nên `hits` gần như đồng đều — nó không xếp hạng được gì, và lọc theo nó là lọc theo nhiễu.
>
> Đó chính là lý do điều kiện là **VÀ** chứ không phải **HOẶC**: phải vừa **cũ** vừa **chưa từng được dùng**. Ở kho nhỏ, `hits === 0` gần như không bao giờ xảy ra với node còn sống, nên luật này **tự động im lặng** — và đó là hành vi đúng, không phải một khiếm khuyết.

`supersedes` chỉ xử lý được ca *"quyết định bị đảo ngược"*. Phần lớn rác không bị đảo ngược — nó chỉ **hết liên quan**, và không ai đi tuyên bố điều đó. Hai cơ chế bù cho nhau, không thay nhau.

**Node đã bị đè thì xoá thẳng, không cần chờ đủ tuổi.** Nó đã được thay bằng một node CHỨA nội dung gộp lại; giữ để "tham khảo" chỉ là giữ rác, và người dùng mở ngăn kéo thấy ba bản trông hệt nhau rồi phải tự đoán bản nào còn hiệu lực. An toàn vì `superseded` chỉ được đặt khi node đè **vẫn tồn tại** — nó dựng lại ở mỗi `scan()` từ chính trường `supersedes` của node còn sống.

⚠ Việc dọn phải chạy **cả ở đường thoát sớm** (chưa có hội thoại nào để nén). Bản trước `return` thẳng, nên gõ `/clear` lần thứ hai thì không có gì xảy ra — đúng lúc người dùng đang cố dọn thì lệnh dọn im lặng.

### Sửa / xoá ghi chú từ giao diện — tác động 1-1, ngay lập tức

`PATCH /api/office/:id/knowledge { id, body? , remove? }`. Sửa xong: quét lại kho, dựng lại ngữ cảnh Trợ lý, và **mọi worker phóng SAU đó dùng bản mới**. Worker đang chạy giữ nguyên bản cũ — cùng luật với đổi model.

Trước đây ngăn kéo này **chỉ đọc**, nên muốn sửa một câu sai trong đầu nhân viên thì phải mở đúng file yaml của người đó ra. Người non-code không làm được, và đó cũng là thứ khiến kho tri thức trông như một hộp đen.

Node đã bị đè vẫn **hiện trong ngăn kéo, kèm nhãn "đã bị bản mới đè"**. Giấu đi thì người dùng mở thư mục thấy file không có trên giao diện; hiện mà không dán nhãn thì họ thấy ba bản giống hệt nhau và tưởng hệ thống nhân bản rác.



### Cấu trúc thư mục (nằm trong thư mục công ty của người dùng)

```
company/
├─ company.yaml            # charter: công ty này làm gì, tông giọng, ràng buộc
├─ roles/                  # định nghĩa vai trò
├─ skills/                 # 3 mức mô tả kỹ năng
├─ knowledge/
│  ├─ index.json           # runtime tự sinh — index tra cứu 0 token
│  ├─ shared/              # ← MASTER ghi. Cả công ty đọc.
│  │  ├─ brand-voice.md
│  │  └─ audience-profile.md
│  └─ agents/
│     ├─ writer/           # ← chính writer ghi. Chỉ writer đọc.
│     │  └─ hook-patterns.md
│     └─ coder/
├─ artifacts/              # đầu ra theo task
│  └─ T-0007/
├─ tasks/                  # brief + receipt lưu lại → replay được
└─ logs/                   # log advanced
```

### Node tri thức

```markdown
---
id: k/shared/brand-voice
type: policy          # policy | pitfall | playbook | fact | reference
title: Giọng thương hiệu
tags: [content, writing, brand]
links: [k/shared/audience-profile, k/agents/writer/hook-patterns]
scope: shared         # shared | role:writer
author: master        # master | role:writer
confidence: 0.9
hits: 42
pinned: false
tokens: 180           # runtime đo sẵn — để scheduler tính ngân sách
updated: 2026-08-14
source: T-0003
---

Xưng "mình", gọi khách là "bạn". Không dùng từ hoa mỹ. Mỗi bài
tối đa một emoji. Không hứa kết quả tuyệt đối.
```

**Luật cứng: một node ≤ 250 token.** Dài hơn → phải tách. Đây là thứ khiến ngân sách tri thức tính được chính xác thay vì đoán mò, và là lý do prefix cache không phình.

**Liên kết `[[id]]` trong nội dung** — đúng kiểu wiki, người đọc thấy tự nhiên, máy parse được. Đồ thị = `links` frontmatter + wikilink trong body.

### Hai luồng ghi — đúng như bạn muốn

| | Ai ghi | Ai đọc | Khi nào |
|---|---|---|---|
| **shared** | master | tất cả | master rút ra bài học ở tầng công ty (chính sách, hiểu biết về khách, cách phối hợp) |
| **agents/`<role>`** | chính role đó | chỉ role đó | worker làm sai / tìm ra flow đúng → ghi vào `lessons[]` của receipt |

### Vì sao lessons phải qua Librarian, không ghi thẳng

Nếu mỗi receipt ghi thẳng một node, sau 200 task bạn có 200 node trùng lặp, đồ thị phình, retrieval kém, prefix cache to ra → **chi phí tăng theo thời gian dùng**. Đó là chết chậm.

Nên: `lessons[]` vào **hàng đợi** (`knowledge/_inbox/`). Cứ mỗi K task (mặc định 20) hoặc khi rảnh, **Librarian** chạy một lượt bằng model rẻ nhất:
- gộp trùng, nâng `confidence` nếu lặp lại
- tách node >250 token
- hạ `confidence` node lâu không `hits`, archive khi <0.3
- cập nhật `links` và `index.json`

Đây là một batch job rẻ, không nằm trên đường tới hạn của người dùng.

### Truy xuất — **0 token**

Không dùng embedding ở v1 (thêm API, thêm tiền, thêm phức tạp). Dùng `index.json` + thuật toán deterministic:

1. Tập ứng viên = `scope: shared` + `scope: role:<role hiện tại>`
2. Điểm = trùng khớp từ khoá (title/tags/keywords) + 0.3 × độ gần liên kết với node đã dùng ở task cha + 0.1 × log(hits)
3. Luôn kèm node `pinned: true` (charter công ty, ≤500 token)
4. Nhồi tham lam đến khi chạm trần `budget.knowledge_pack`

Embedding local (không qua API) là lựa chọn v2 nếu đo được là keyword không đủ.

---

## 6. Switch center — định tuyến model

Bảng thuần code, 0 token, không LLM tham gia.

| Tier | Dùng cho | Model |
|---|---|---|
| `eco` | phân loại, trích xuất, format, gộp trùng, tóm tắt ngắn, librarian | Haiku |
| `standard` | viết, code, nghiên cứu, phân tích, review | Sonnet |
| `deep` | lập kế hoạch phức tạp, phân xử xung đột, postmortem | Opus |

**Master mặc định `standard`**, chỉ nhảy `deep` ở đúng hai loại bước: `plan` (kế hoạch đầu) và `arbitrate` (khi hai receipt mâu thuẫn).

**Luật leo thang:** task `failed` do chất lượng → chạy lại **một lần** ở tier cao hơn. Tối đa 1 lần leo thang / task. Vượt thì `needs_human`.

Người dùng override được trong `roles/*.yaml` và `company.yaml`.

### ProviderAdapter (chỗ cắm tương lai, v1 không implement)

```ts
interface ProviderAdapter {
  id: string                    // "claude-agent-sdk" | "openrouter" | ...
  run(brief: TaskBrief, ctx: RunContext): AsyncIterable<AgentEvent>
  supportsPrefixCache: boolean  // false → scheduler tắt cache priming
}
```

v1 chỉ có `claude-agent-sdk`. Không viết OpenRouter, chỉ chừa interface.

---

## 7. Scheduler — song song

Master phát ra DAG. Scheduler chạy nó.

```
plan = [
  T-01 researcher  deps:[]
  T-02 researcher  deps:[]          ← T-01, T-02 chạy song song
  T-03 writer      deps:[T-01,T-02]
  T-04 coder       deps:[]          ← song song luôn với T-01/T-02
  T-05 reviewer    deps:[T-03,T-04]
]
```

Quy tắc:

- **Concurrency cap** mặc định 4, cấu hình được. Có cap riêng cho mỗi tier.
- **Cache priming gate** — xem `SPEC-token-economy.md` §3. Task đầu tiên của mỗi `(role, version)` chạy một mình để ghi cache; phần còn lại chờ rồi mới bung song song. Không có gate này, N task song song = N lần trả cache-write.
- **Write lock theo đường dẫn artifact.** Hai task không được cùng ghi một file. Scheduler từ chối DAG vi phạm ngay lúc lập kế hoạch, không đợi runtime nổ.
- **Rate limit → AIMD.** Gặp 429: backoff mũ + giảm concurrency một nửa; chạy trơn 10 task thì tăng lại 1.
- **Replay.** Mọi brief+receipt lưu ở `tasks/`. Sửa một task ở giữa → chỉ chạy lại nhánh con của nó, không chạy lại cả DAG. Đây là công cụ tiết kiệm tiền lớn nhất khi người dùng lặp đi lặp lại.

---

## 8. Vòng đời session

| | Session | Compaction |
|---|---|---|
| **Master** | dài, một session cho một "ca làm việc" | khi >60K token: giữ nguyên prefix đóng băng, cuộn các receipt cũ thành một bản tóm tắt, ghi phần bị bỏ ra file `logs/` |
| **Worker** | ngắn, chết sau mỗi task | không có |

Compaction của master **tuyệt đối không được chạm vào prefix** (system + tools + charter + pitch các role). Chạm vào là invalidate toàn bộ cache phía sau — đúng trực giác "xoá cache mới, giữ cache thuỷ sinh".

Thoát/khởi động lại: master session id lưu ở `company/.state`. Khởi động lại resume được, hoặc bắt đầu ca mới tuỳ người dùng.

---

## 9. Cầu nối chat (mục tiêu tối thượng)

```
Telegram ──long polling──► agentco daemon (máy nhà / VPS) ──► Master
```

**Telegram dùng `getUpdates` long-polling → không cần IP public, không cần port forward, không cần domain, không cần VPS.** Chạy được ngay từ máy ở nhà. Đây là bản v1.

| Kênh | Cần gì | Giai đoạn |
|---|---|---|
| Telegram | chỉ bot token | **v1** |
| Web UI | localhost | **v1** |
| Zalo OA / Messenger / WhatsApp | webhook + HTTPS public + duyệt app | v2, gói trả phí |
| Bất kỳ kênh nào qua tunnel | Cloudflare Tunnel (free) | v2 |

Bridge là adapter mỏng:

```ts
interface ChatBridge {
  id: string
  start(onMessage: (m: InboundMsg) => void): Promise<void>
  send(chatId: string, text: string, opts?): Promise<void>
}
```

Quy tắc bảo mật bridge: whitelist `chat_id` bắt buộc. Không whitelist thì bot im lặng. Người lạ nhắn bot = có thể chạy lệnh trên máy bạn — phải chặn mặc định.

---

## 9b. Hết hạn mức subscription — kịch bản CHẮC CHẮN xảy ra

Spec bản đầu bỏ sót cái này. Khách chạy bằng subscription Claude Code, nên **họ sẽ hết hạn mức giữa chừng** — không phải "nếu", là "khi nào". Với người non-code, đây là lúc sản phẩm dễ mất niềm tin nhất: một công ty đang chạy bỗng đứng im không rõ lý do.

**Phải phân biệt hai loại lỗi, xử lý ngược nhau:**

| | Rate limit (429) | Hết hạn mức subscription |
|---|---|---|
| Bản chất | tạm thời, tính bằng giây | đến kỳ reset, tính bằng **giờ** |
| Xử lý | backoff mũ + AIMD giảm concurrency | **dừng ca làm việc**, không retry |
| Nói với người dùng | không cần | **bắt buộc**, kèm thời điểm reset nếu biết |

SDK có sẵn `USAGE_LIMIT_ERROR_PREFIXES` và `USAGE_WARNING_PREFIXES` để nhận diện — dùng chúng, đừng tự đoán bằng regex.

**Hành vi bắt buộc khi hết hạn mức:**

1. Task đang chạy: để chạy nốt, không giết.
2. Task chưa bắt đầu: **giữ nguyên trong DAG**, không đánh `failed`.
3. Ghi toàn bộ trạng thái DAG ra `tasks/` → **`agentco resume` chạy tiếp được**, không làm lại từ đầu.
4. UI + Telegram báo bằng tiếng người: *"Hết lượt dùng Claude. Công ty tạm nghỉ, còn 3 việc chưa làm. Gõ `tiếp tục` khi có lượt lại."*
5. **Không tự động retry vòng lặp.** Retry mù khi hết hạn mức chỉ làm người dùng tưởng phần mềm hỏng.

Bắt `USAGE_WARNING_PREFIXES` để cảnh báo **trước** khi hết: *"Sắp hết lượt — còn 2 việc nữa là chạm."* Với người non-code, cảnh báo sớm đáng giá hơn xử lý lỗi đẹp.

---

## 10. Kiểm thử — trả lời nỗi lo "TDD có lỗ hổng cả hai không biết"

Bạn nói đúng: unit test cho hệ này không bắt được lớp lỗi nguy hiểm nhất. Lỗi nguy hiểm ở đây **không phải sai logic — là rò rỉ chi phí**, mà rò rỉ chi phí thì test thường không nhìn.

Nên loại test quan trọng nhất là **invariant / budget test**, chạy trên một bộ task mẫu cố định:

```
✓ receipt_tokens ≤ 800                        (mọi receipt, không ngoại lệ)
✓ knowledge_pack_tokens ≤ role.budget         (mọi task)
✓ knowledge node tokens ≤ 250                 (mọi node)
✓ cache_read / (cache_read+in) ≥ 0.7          (sau task thứ 2 của mỗi role)
✓ master_context_tokens < 60_000              (trước compaction)
✓ không transcript worker nào xuất hiện trong messages của master
✓ cost_per_scenario ≤ ngưỡng đã chốt          (bộ 5 kịch bản mẫu)
✓ DAG có write-conflict → bị từ chối lúc lập kế hoạch, không lúc chạy
```

Đây là lưới an toàn thật cho người không phân tích hệ thống được: **bạn không cần hiểu vì sao chi phí tăng, chỉ cần test đỏ khi nó tăng.** Ghim ngưỡng bằng số đo thật ở lần chạy đầu, sau đó mọi thay đổi làm xấu đi sẽ bị chặn.

Bổ sung: mọi thay đổi role/prompt phải chạy lại bộ 5 kịch bản mẫu và in bảng so sánh chi phí trước/sau.

---

## 11. Cấu trúc mã nguồn

```
agentco/
├─ packages/
│  ├─ core/           # scheduler, task/receipt, budget, session
│  ├─ knowledge/      # graph, index, retrieval, librarian
│  ├─ providers/      # claude-agent-sdk adapter (+ interface)
│  ├─ bridges/        # telegram (v1)
│  ├─ server/         # daemon: HTTP + WS/SSE, local socket
│  ├─ ui/             # web UI
│  └─ cli/            # binary `agentco`
├─ templates/         # company.yaml, roles, skills mẫu
└─ LICENSE.md         # FSL 1.1, change license Apache-2.0, change date +2 năm
```

Ngôn ngữ: **TypeScript / Node**. Không lệ thuộc native module nặng (để containerize sau dễ).

---

## 12. Điều đã LOẠI (không mở lại nếu không có lý do mới)

| Ý | Vì sao loại |
|---|---|
| Session dài cho mỗi worker | mỗi lượt trả lại toàn bộ context; 8 agent × 190K = ~1.5M token/vòng |
| Agent nói chuyện trực tiếp với nhau | nguồn đốt token lớn nhất, không kiểm soát được |
| OpenRouter ở v1 | mất prefix cache, thêm bên thứ ba, phá mô hình "chạy bằng sub của khách" |
| LLM quyết định routing | tốn một call để tiết kiệm một call |
| Embedding qua API cho retrieval | thêm chi phí thường trực; keyword + graph đủ ở v1 |
| Bạn tự host compute cho khách | không có tiền, **và gần như chắc chắn vi phạm ToS Anthropic** |
| Electron/Tauri native ngay từ đầu | phải viết lại toàn bộ khi làm server mode |
| Một call LLM để "dịch log cho thân thiện" | worker sinh sẵn trường `say`, miễn phí |
| Gắn MCP thẳng vào session master | issue #247 phá cache master, ~36K token quy đổi dư mỗi lượt. Dùng `concierge` thay thế. |
| Dùng SDK subagent (`agents`) làm worker | output subagent đi thẳng vào context cha → phá giao thức Receipt. Cache vẫn chung nếu tự viết, nên không mất gì. Vẫn **mượn shape `AgentDefinition`** làm định dạng file role. |
