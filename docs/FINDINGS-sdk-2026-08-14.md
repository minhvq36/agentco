# Kết quả thẩm định Claude Agent SDK — 14/08/2026

Đo thật trên máy, không phải đọc doc. Môi trường: Node v22.12.0, npm 10.9.0, Claude Code CLI 2.1.231, `@anthropic-ai/claude-agent-sdk@0.3.231`. Xác thực bằng **subscription Claude Code trên máy, không dùng API key** — chạy được ngay.

> Số phiên bản SDK bám sát CLI (`0.3.231` ↔ `2.1.231`). Ghim version trong `package.json`.

---

## 1. Câu hỏi sống-còn: có điều khiển được cache breakpoint không? → **CÓ**

```ts
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk'

systemPrompt: [
  staticInstructions,              // ◄── cache CROSS-SESSION
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  sessionContext,                  // ◄── không cache toàn cục
]
```

Nguyên văn type definition:

> *"Marker string that splits a custom `systemPrompt` into a static prefix (**eligible for cross-session prompt caching**) and a dynamic suffix (session-specific, not globally cached). Blocks before it get **global cache scope**, blocks after do not."*

**Đây tốt hơn giả định trong spec.** "Cross-session / global cache scope" nghĩa là nhiều worker session **khác nhau** dùng chung một cache entry — đúng y hệt thiết kế `SPEC-token-economy.md` §2 (cache key theo role, mọi worker cùng role chia sẻ). Không phải tự chế, SDK hỗ trợ sẵn.

Kèm theo: `excludeDynamicSections: true` cho preset — bỏ working directory, auto-memory, git status ra khỏi system prompt và tiêm lại vào user message đầu, để prefix đứng yên. Doc comment ghi thẳng *"Cacheable prompt for multi-user fleets"*.

**→ `SPEC-token-economy.md` §2 giữ nguyên, không phải viết lại.**

---

## 2. Số đo prefix (mỗi biến thể salt riêng để ép cold)

| # | Cấu hình | Prefix | cache_write | cache_read | Giá 1 call |
|---|---|---:|---:|---:|---:|
| 1 | preset `claude_code` đầy đủ | 19 668 | 19 668 | 0 | $0.0402 |
| 2 | preset + `excludeDynamicSections` | 19 478 | 19 478 | 0 | $0.0399 |
| 3 | **custom systemPrompt ngắn** | **13 190** | 2 635 | 10 555 | **$0.0072** |
| 4 | custom + `allowedTools: []` | 13 190 | 2 635 | 10 555 | $0.0072 |
| 5 | custom + chỉ `Read`,`Write` | 13 190 | 2 635 | 10 555 | $0.0073 |
| 6 | custom + `strictMcpConfig` | 13 187 | 2 632 | 10 555 | $0.0073 |

*(model `haiku`, prompt "trả lời một từ", `maxTurns: 1`, `persistSession: false`)*

### Ba kết luận từ bảng này

**a) Không dùng preset `claude_code` cho worker phi-code.** Chênh **~6 300 token/call**, và giá thực tế chênh **5,5 lần** ($0.040 vs $0.0072). Preset chứa toàn bộ hướng dẫn code của Claude Code — `writer`, `researcher`, `analyst` không cần. → `roles/*.yaml` thêm trường `use_preset: false` mặc định, chỉ `coder`/`reviewer` bật.

**b) `allowedTools` KHÔNG làm nhỏ prompt.** Dòng 3-4-5-6 giống hệt nhau. `allowedTools` là bộ lọc **quyền**, không phải đòn bẩy **kích thước**. Định nghĩa tool luôn được gửi.
→ **Sàn cứng ~13 200 token cho mỗi worker call.** Không thương lượng được. Spec đã bỏ sót con số này.

**c) Nhưng sàn đó phần lớn được cache toàn cục.** 10 555 / 13 190 về dưới dạng `cache_read` ngay từ call đầu của một cấu hình mới — chính là cơ chế static-prefix ở §1 đang chạy tự động. Chi phí biên thật của một worker call ≈ **2 600 cache_write + 10 500 cache_read**, không phải 13 200 giá đầy đủ.

### Cache có hoạt động không? Có.

Ba call liên tiếp cùng prefix:

```
A1 (lần đầu)           cw=3666  cr=15799
A2 (prefix giống hệt)  cw=2825  cr=16641
A3 (prefix giống hệt)  cw=2824  cr=16641
```

Đổi systemPrompt → `cw=13192 cr=0` (miss sạch, đúng như dự đoán). Lặp lại → `cw=2603 cr=10590` (hit).

**Còn một khoản `cache_write` ~2 600 token lặp lại ở MỌI call.** Đây là phần dynamic suffix bị ghi lại mỗi lần. Chưa rõ có ép xuống được không → **việc của M1**, không phải tuần 1.

### systemPrompt dạng mảng KHÔNG tự tạo breakpoint

Mảng 3 phần tử cho kết quả y hệt string nối lại (`cw=2651 cr=10555`). Mảng chỉ là cách viết; **phải chèn `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` một cách tường minh** thì mới có tác dụng.

---

## 3. Những thứ SDK cho sẵn mà spec đang định tự làm

| Spec định tự làm | SDK có sẵn |
|---|---|
| Trần ngân sách theo task | **`maxBudgetUsd`** → trả về `error_max_budget_usd`. Native, không cần tự đếm. |
| Worker không ghi đĩa | **`persistSession: false`** — session chỉ trong RAM. Đúng thiết kế agent stateless. |
| `max_turns` | `maxTurns` |
| Định nghĩa subagent | **`agents?: Record<string, AgentDefinition>`** — mỗi agent có `model`, `tools`, `mcpServers`, `maxTurns` riêng. Chính là `roles/*.yaml` của ta. |
| Sự kiện cho UI | **28 hook events**, có `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `PreCompact`, `PostCompact`, `MessageDisplay` |
| Kế toán chi phí | `result.usage` + `result.modelUsage` có đủ `cache_creation_input_tokens`, `cache_read_input_tokens`, `costUSD`, `contextWindow` theo từng model |
| Quản lý session | `listSessions`, `getSessionMessages`, `getSubagentMessages`, `forkSession`, `renameSession`, `tagSession`, `deleteSession` |
| Chạy trên VPS/container | **`sessionStore`** adapter (alpha) — mirror transcript sang backend riêng, resume được ở máy khác |

`modelUsage` mẫu:

```json
{ "claude-haiku-4-5-20251001": {
  "inputTokens": 541, "outputTokens": 90,
  "cacheReadInputTokens": 15799, "cacheCreationInputTokens": 3666,
  "costUSD": 0.0099029, "contextWindow": 200000,
  "canonicalModel": "claude-haiku-4-5", "provider": "firstParty" } }
```

→ `agentco cost` và `logs/usage.jsonl` xây được nguyên vẹn như `SPEC-token-economy.md` §5.

---

## 4. Ba cái bẫy phải né

### 🔴 MCP phá prompt cache khi resume

[Issue #247](https://github.com/anthropics/claude-agent-sdk-typescript/issues/247) (đóng, dup của #89): `createSdkMcpServer()` tạo instance **không serialize được**; có MCP trong query resume → **cache miss mỗi lần resume**. Cả MCP dạng HTTP cũng dính.

**Ảnh hưởng trực tiếp:** master là session dài, resume liên tục. Gắn MCP vào master = giết cache của chính master.

**Đối sách:**
- **Master: không MCP.** Master chỉ lập kế hoạch và đọc receipt, vốn không cần MCP.
- **MCP chỉ gắn cho worker**, mà worker là one-shot `query()` không resume → không dính bug.
- Đây hoá ra lại **củng cố** thiết kế stateless, không phải phá nó.

### 🟠 API V2 `createSession()` đã bị GỠ ở 0.3.142

Nhiều bài blog/tutorial trên mạng vẫn dạy `createSession()` với pattern `send`/`stream`. **Đã chết.** Dùng `query()` + `continue`/`resume`/`forkSession`. Đừng tin tutorial không ghi ngày.

### 🟠 Session file gắn với máy

Lưu ở `~/.claude/projects/<encoded-cwd>/*.jsonl`. Chạy VPS/container phải dùng `sessionStore` adapter (còn **alpha**) hoặc bê file đi. Doc khuyên thẳng: *"Don't rely on session resume — capture the results you need as application state."*

**→ Đúng nguyên tắc "sở hữu artifact, không sở hữu prompt" đã chốt.** Master có mất session cũng không mất gì quan trọng, vì mọi thứ giá trị đã nằm ở file.

---

## 5. Con số cần nhớ khi tính tiền

Một call worker **tối thiểu** (Haiku, một từ, không tool nào chạy):

| | Preset claude_code | Custom systemPrompt |
|---|---:|---:|
| Giá | ~$0.040 | ~$0.0072 |

### 13 200 KHÔNG phải cái ta trả — ta trả ~4 350

Ở trạng thái cache đã ấm, chi phí quy đổi thật của một worker call:

```
10 555 cache_read  × 0.1x  =  1 056
 2 635 cache_write × 1.25x =  3 294   ← khoản này đắt hơn phần đọc cache 3 lần
                     tổng  ≈  4 350 token quy đổi
```

Hai điều rút ra:

1. **Overhead thật ≈ 1/3 con số 13 200.** Đừng dùng 13 200 để tính tiền.
2. **Phần đắt nhất là khoản write lặp lại**, không phải phần đọc cache. Tối ưu nên nhắm vào đó — việc của M1.

**Lưu ý quan trọng về phép đo:** probe dùng `maxTurns: 1` — **trường hợp xấu nhất**. Khoản 2 635 write là breakpoint đặt cuối lượt để lượt sau đọc; task 1 lượt thì phí sạch, task 10 lượt thì khấu hao qua 9 lượt sau. Việc thật rẻ hơn đáng kể. Cần đo lại với task nhiều lượt để có số thật.

### Khi nào trả 1.25x — và khi nào KHÔNG

Cache nằm **trên server Anthropic**, không nằm trong process của ta.

| Trả 1.25x | KHÔNG trả 1.25x |
|---|---|
| Lần đầu có prefix đó | Kill process / khởi động lại daemon |
| TTL hết hạn (mỗi lần hit **gia hạn** TTL) | Session mới |
| Sửa role, bump `knowledge_version` | Worker khác, cùng role |
| Nâng cấp SDK/CLI | Chạy song song nhiều worker cùng prefix |

Trần context 200K **không liên quan** tới cache — hai thứ khác nhau.

### Luật thiết kế mới (spec gốc chưa có)

> **Ưu tiên ít task lớn hơn nhiều task nhỏ.** Mỗi task gánh overhead cố định bất kể việc to hay nhỏ. Chẻ DAG quá mịn để "song song cho đẹp" là đốt tiền.

Chẻ task khi có **song song thật** hoặc **cần role khác**. Không chẻ chỉ để nhìn cho gọn.

---

## 5b. Hai quyết định kiến trúc chốt từ kết quả đo

### Master muốn có MCP → dùng role `concierge`, không treo MCP vào session master

Vấn đề: master là session dài, resume liên tục. Gắn MCP → issue #247 → cache vỡ.

Định lượng: master context ~40K, cache vỡ → mỗi lượt trả 40K ở 1.0x thay vì 0.1x = **dư ~36 000 token quy đổi mỗi lượt master nói chuyện**. Một worker one-shot có MCP chỉ tốn **~4 350** trên Haiku. **Rẻ hơn gần một bậc độ lớn.**

→ Thêm role **`concierge`**: one-shot, tier `cheap`, có MCP, dùng cho việc vặt (xem lịch, gửi tin, tra DB, lấy URL). Master gọi nó thay vì tự cầm MCP.

**"Gọi nhân viên" là chuyện UI, không phải chuyện kiến trúc.** Trên giao diện, `concierge` **không hiện ra như một task** — hiện như chính master đang làm. Giữ nguyên cảm giác "master tự làm được việc vặt", nhưng rẻ hơn và không phá cache.

Giữ `master.mcp: false` là **setting** trong `company.yaml`, không hard-code — khi #89/#247 được sửa thì bật lên.

### Tự viết worker, KHÔNG dùng SDK subagent — nhưng mượn định dạng của nó

**Tự viết vẫn chung cache.** Bằng chứng trực tiếp từ probe2: bốn lời gọi `query()` **độc lập**, **bốn system prompt khác nhau**, cả bốn đều `cr=10 555` y hệt — chia sẻ cùng static prefix đã cache toàn cục. Cache là thuộc tính của **prefix trên server**, không phải của cách sinh agent.

Nên quyết định bằng lý do khác, và cả ba đều nghiêng về tự viết:

1. **Output của SDK subagent đi thẳng vào context của cha** — chính xác là thứ giao thức Receipt sinh ra để chặn. **Điểm phủ quyết.**
2. [Issue #89](https://github.com/anthropics/claude-agent-sdk-typescript/issues/89) (mở từ 12/2025, chưa ai đụng) ghi thẳng: *"Subagents struggle to fully use the cache"*.
3. Tự gọi `query()` mới đặt được `maxBudgetUsd`, `persistSession: false`, `maxTurns` riêng từng worker và ép được schema receipt.

**Nhưng dùng đúng shape của `AgentDefinition` làm định dạng file role.** Người dùng quen Claude Code là hiểu ngay, portable, và nếu sau này muốn đổi sang subagent thật thì không phải đổi file. Định dạng của SDK, execution của mình.

→ **Mục cần đo số 2 trong `ROADMAP.md` coi như đã quyết, không cần test.**

---

## 5c. Số lượt là đòn bẩy chi phí thật — không phải số task

Đo trên hệ thống chạy thật, không phải probe tổng hợp.

**Công thức chi phí thực tế:**

```
chi phí ≈ SỐ LƯỢT × prefix × 0.1  +  ghi-cache × 1.25  +  output
```

`cache_read` **nhân theo số lượt**, vì mỗi lượt gọi tool là một lần đọc lại toàn bộ prefix. Điều này **sửa lại §5** ở trên: task nhiều lượt có khấu hao khoản `cache_write`, nhưng đồng thời **nhân** khoản `cache_read` lên — và phần nhân lớn hơn phần khấu hao.

→ SDK trả `num_turns` trong result message. Hệ thống ghi nó vào `logs/usage.jsonl` và `agentco cost` in **lượt/việc theo vai trò**. Đây là số cần nhìn khi tối ưu, không phải tổng token.

### Prompt "kỷ luật số lượt" gần như KHÔNG ăn thua

Đã thêm hẳn một mục vào system prompt (đọc mỗi file một lần, không đọc lại file vừa ghi, không thăm dò, gộp các lần đọc). Đo trước/sau: writer đứng yên (34 650 → 35 693 cache_read), reviewer còn tăng.

**Kết luận trung thực: không tối ưu được số lượt bằng cách bảo model đừng dùng nhiều lượt.** Số lượt là thuộc tính của model + độ khó việc, không phải của lời dặn. Đòn bẩy thật nằm ở: chọn model, và cho brief đủ rõ để agent không phải đi tìm.

### So sánh tier trên cùng một việc (cache đã ấm)

| tier | lượt | token | thời gian | tiền |
|---|---:|---:|---:|---:|
| `cheap` (Haiku) | 10 | 137 372 | 77,9s | **$0.0556** |
| `standard` (Sonnet) | 4 | 63 350 | 37,0s | $0.0893 |

Haiku dùng **2,5× số lượt**, 2,17× token, chậm 2,11× — **nhưng vẫn rẻ hơn 38%**, vì nó rẻ hơn ~3,4× trên mỗi token.

> **Luật: `cheap` chỉ lãi khi `bội_số_token < tỉ_lệ_giá`.** Biên mỏng hơn tỉ lệ giá gợi ý nhiều. Việc càng phức tạp, bội số càng tăng, tới lúc lỗ.

Hai cái giá không nằm trong bảng tiền:
- **Độ trễ gấp đôi** — với sản phẩm một người dùng ngồi chờ, thường quan trọng hơn 3 cent
- **Số lượt không đoán được** — Haiku: 9 rồi 10 cho cùng một việc; Sonnet: 4 rồi 4. Nên **vai trò `cheap` cần `max_turns` cao hơn vai trò `standard`**, ngược trực giác.

Tái lập: `node bench/tier-compare.mjs`

---

## 5d. Cache priming gate — đo được trên hệ thống thật

Hai `writer` chạy song song, cùng cacheKey:

| | cache_write | tiền |
|---|---:|---:|
| task đầu (primer, chạy một mình) | 20 103 | $0.136 |
| task sau (chờ ở gate rồi mới bung) | **4 239** | **$0.048** |

Cùng vai trò, cùng loại việc, **rẻ hơn 2,8×**. Không có gate thì cả hai cùng trả ~20K cache_write.

---

## 6. Còn phải kiểm (chưa làm)

1. `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` với **tri thức HOT ~2K token** đặt trước marker — có thật sự hit cross-session giữa hai process khác nhau không? Đây là bài kiểm chứng trực tiếp cho §2.
2. Khoản `cache_write` ~2 600/call — ép xuống được không?
3. Giới hạn song song thật: bao nhiêu `query()` đồng thời thì dính 429? → đặt mặc định `concurrency`.
4. `agents` (subagent trong SDK) so với tự chạy nhiều `query()`: cái nào rẻ hơn? Subagent chia sẻ prefix của cha, có thể rẻ hơn đáng kể.
5. `sessionStore` alpha có dùng được cho chế độ VPS không.

Mục 1 và 4 nên làm **trước ngày 3** của tuần 1 — chúng có thể đổi cấu trúc scheduler.

---

## Phụ lục — script đo (chạy lại được)

Hai script nằm ở `bench/` trong repo này:

- `bench/probe-cache.mjs` — hành vi cache qua nhiều call cùng/khác prefix
- `bench/probe-prefix.mjs` — kích thước prefix theo từng cấu hình systemPrompt/tools

Chạy: `cd bench && npm i && node probe-cache.mjs`. Cần đã đăng nhập Claude Code trên máy. Đây là hạt giống của `agentco bench` (`SPEC-token-economy.md` §6).
