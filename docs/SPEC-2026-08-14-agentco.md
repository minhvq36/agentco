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
