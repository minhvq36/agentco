# SPEC — Kinh tế token & hiệu năng

**Đây là file quan trọng nhất.** Mọi quyết định thiết kế khác phải qua được các luật ở đây. Nếu một tính năng hay ho nhưng vi phạm §2 hoặc §3, tính năng đó bị loại, không thương lượng.

> **Đã thẩm định trên máy 14/08/2026 — xem `FINDINGS-sdk-2026-08-14.md`.** Ba điều chỉnh so với bản gốc:
> 1. Cache breakpoint **điều khiển được** bằng `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` (cross-session cache). §2 đứng vững.
> 2. **Sàn cứng ~13 200 token/worker call** — `allowedTools` không làm nhỏ prompt được. Bổ sung ở §4.
> 3. **Không dùng preset `claude_code` cho role phi-code** — chênh ~6 300 token, giá gấp 5,5 lần.

---

## 1. Chi phí đến từ đâu (xếp theo mức độ nguy hiểm)

| # | Nguồn đốt token | Mức | Cách chặn |
|---|---|---|---|
| 1 | **Master đọc raw output của worker** | 🔴 chí mạng | Receipt trần 800 token, validate cứng |
| 2 | **Session dài cho worker** | 🔴 chí mạng | Worker stateless |
| 3 | **Cache miss do prefix đổi** | 🔴 chí mạng | Kiến trúc phân tầng §2 + priming gate §3 |
| 4 | **Master dán nội dung file vào brief** | 🟠 nặng | Brief chỉ chứa **đường dẫn**, worker tự đọc |
| 5 | **Đồ thị tri thức phình theo thời gian** | 🟠 nặng (chết chậm) | Node ≤250 token, Librarian gộp/archive |
| 6 | **Nạp cả kho tri thức vào mỗi task** | 🟠 nặng | Trần `knowledge_pack`, retrieval có điểm |
| 7 | **Chạy lại cả DAG khi sửa một bước** | 🟡 vừa | Replay theo nhánh con |
| 8 | **Dùng model đắt cho việc tầm thường** | 🟡 vừa | Switch center deterministic |
| 9 | **Agent nói chuyện với nhau** | 🟡 vừa | Cấm hẳn, đi qua master/artifact |

Điểm #3 chính là thứ đã giết project fanpage với `claude -p`. Phần còn lại của file này chủ yếu nói về nó.

---

## 2. Kiến trúc prefix cache

### Cơ chế thật của Anthropic prompt caching

- Cache **server-side**, đánh theo **prefix nội dung** (byte-identical từ đầu prompt).
- **Process mới vẫn hit cache** nếu prefix y hệt và còn trong TTL. Đây là điều then chốt — cache không chết theo process.
- TTL: **5 phút** mặc định; có tuỳ chọn **1 giờ**.
- Giá tương đối: cache **read ≈ 0.1×** input thường. Cache **write ≈ 1.25×** (TTL 5 phút) hoặc **≈ 2×** (TTL 1 giờ).
- Một byte khác ở đầu prompt → **toàn bộ** phía sau miss.

Suy ra hai luật:

> **Luật A — Sắp xếp theo độ ổn định.** Cái gì ít đổi nhất đặt trước, cái gì đổi mỗi lượt đặt sau. Không bao giờ chèn thứ biến động vào giữa.
>
> **Luật B — Cache write phải được khấu hao.** Ghi cache mà chỉ đọc lại 1 lần thì lỗ. Ghi rồi đọc ≥3 lần mới lãi.

### Phân tầng prompt (áp dụng cho mọi worker)

```
┌─ ĐÓNG BĂNG — nằm trong prefix cache ───────────────────────┐
│ L0  System prompt harness (cố định theo version phần mềm)  │
│ L1  Định nghĩa tool (cố định theo role)                    │
│ L2  Role card + skills (cố định theo role.version)         │
│ L3  Charter công ty (pinned, ≤500 token)                   │
│ L4  HOT knowledge — top N node hay dùng nhất của role      │
└──────────────── ◄── CACHE BREAKPOINT Ở ĐÂY ────────────────┘
┌─ BIẾN ĐỘNG — trả giá đầy đủ, nên phải nhỏ ─────────────────┐
│ L5  Cold knowledge — node riêng cho task này               │
│ L6  TaskBrief                                              │
│ L7  Các lượt hội thoại trong task                          │
└────────────────────────────────────────────────────────────┘
```

**Cache key = `hash(L0..L4)` = `(software_version, role_id, role_version, knowledge_version)`**

Hệ quả quan trọng: **mọi worker cùng role dùng chung một cache entry.** 5 writer chạy song song = 1 lần ghi cache, 5 lần đọc.

### Hot knowledge — hai tầng tri thức

Đây là chỗ dễ làm sai nhất. Nếu nhét toàn bộ tri thức truy xuất theo task vào prefix, prefix đổi mỗi task → **cache miss 100%**, tệ hơn là không cache.

Nên tách hai tầng:

| Tầng | Nội dung | Vị trí | Tính lại khi nào |
|---|---|---|---|
| **HOT** | top `hot_knowledge_size` node có `hits` cao nhất của role (mặc định 8, trần 2000 token) | trong prefix, **được cache** | chỉ khi bump `knowledge_version` — mặc định 1 lần/ngày hoặc thủ công |
| **COLD** | node truy xuất riêng cho task này | sau breakpoint, **trả giá đầy đủ** | mỗi task |

Tri thức nóng gần như miễn phí. Tri thức lạnh trả tiền — nên trần `knowledge_pack` chỉ tính cho phần COLD.

> **Không được bump `knowledge_version` mỗi lần Librarian ghi node.** Gom lại, bump theo lô. Mỗi lần bump = mọi role phải ghi lại cache.

### TTL chọn thế nào

```
Nếu công ty đang "trong ca" (UI đang mở HOẶC bridge đang bật)  → TTL 1 giờ
Ngược lại (chạy lẻ một task rồi nghỉ)                          → TTL 5 phút
```

Lý do: TTL 1 giờ đắt gấp ~1.6× lúc ghi nhưng cứu được toàn bộ khoảng nghỉ giữa các lượt người dùng gõ phím. Người dùng suy nghĩ 7 phút giữa hai câu là chuyện thường → TTL 5 phút là mất trắng.

---

### 2b. Xếp khối trong prefix: hỏi "DỰNG hay DÙNG", đừng đoán tần suất (chốt 20/08)

`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` nằm ở **cuối** mọi khối, nên toàn bộ khối nằm trong vùng được cache — và cache là **theo tiền tố**. Một khối đổi thì mọi khối **phía sau nó** bị ghi lại theo.

Bảng kê tủ tài liệu từng đứng ngay sau charter, **trên** memory · hot · roster · bảng kê kết quả, với lý do ghi thẳng trong code: *"tủ đổi hiếm hơn kéo dây trên canvas"*. **Quan sát thật bác bỏ:**

| | thao tác | tần suất thật |
|---|---|---|
| roster | kéo dây trên canvas | **DỰNG** — một lần, gần như không đụng lại |
| bảng kê tủ | thả tài liệu vào | **DÙNG** — lặp suốt đời văn phòng |
| bảng kê kết quả | sinh sau mỗi ca | **DÙNG** — mỗi ca |

Hạ bảng kê tủ xuống sát bảng kê kết quả ⇒ thêm một tài liệu ghi lại **3 khối** thay vì **6**. `PROMPT_SCHEMA_VERSION` 3 → 4.

> **Đừng đoán tần suất bằng cảm giác cái nào "nghe có vẻ hiếm hơn".** Câu hỏi cho ra tần suất thật là: *đây là thứ người ta làm lúc DỰNG hệ thống, hay thứ họ làm mỗi ngày khi DÙNG nó?*

⚠ Phân biệt với luật **"HOT phải ỔN ĐỊNH"** (§2): ở đó cái giá lặp lại **mỗi task** nên nó chết người. Ở đây cái giá là **một lần cho một thao tác của con người** — trả nó để đổi lấy một bảng kê không nói dối là đánh đổi đúng chiều.

**Một tiền đề hay nhầm, đã đo:** worker **không** dùng cache của Trợ lý. Prefix worker mở bằng `CORE_PROMPT`, prefix Trợ lý mở bằng `ASSISTANT_CORE` — hai cache entry khác nhau. Cả hai bảng kê đều gác `who === 'assistant'` nên **chưa bao giờ** vào prefix nhân viên. Thêm/xoá tài liệu không đụng một token cache nào của worker.

## 3. Cache priming gate

**Vấn đề:** bung 5 task cùng role song song khi cache chưa có → cả 5 cùng miss, cả 5 cùng trả cache-write (1.25–2×). Đúng lúc song song đáng lẽ tiết kiệm thì lại đắt nhất.

**Giải:** khoá theo `cache_key`.

```
scheduler nhận N task, nhóm theo cache_key

với mỗi cache_key:
  nếu key ĐÃ ẤM (ghi nhận trong warmSet, chưa quá TTL):
      → bung toàn bộ song song ngay
  nếu key CHƯA ẤM:
      → cho 1 task chạy trước (priming run)
      → các task còn lại CHỜ
      → khi priming run nhận được token đầu tiên từ API:
            đánh dấu key ấm → thả toàn bộ phần còn lại
      → timeout 20s: thả hết bất kể (thà trả tiền còn hơn treo)
```

Chi tiết:
- Không chờ priming run **kết thúc**, chỉ chờ nó **bắt đầu stream**. Cache prefix đã được ghi ở thời điểm đó.
- `warmSet` là `Map<cache_key, expiresAt>`, tự hết hạn theo TTL đã dùng.
- Khởi động daemon: `warmSet` rỗng. **Không** chủ động warm bằng call giả — call giả cũng tốn tiền và có thể không bao giờ được dùng lại.

---

## 4. Ngân sách — con số mặc định

Ghim thành hằng số trong code, override được qua `company.yaml`.

| Hạng mục | Mặc định | Kiểu trần |
|---|---|---|
| Receipt | 800 token | **cứng** — cắt |
| Node tri thức | 250 token | **cứng** — từ chối ghi, bắt tách |
| Charter (pinned) | 500 token | **cứng** |
| Hot knowledge / role | 2000 token | **cứng** |
| Cold knowledge / task | 3000 token | **cứng** |
| TaskBrief | 1500 token | mềm — cảnh báo |
| Context master trước compaction | 60 000 token | ngưỡng kích hoạt |
| max_tokens / task | 60 000 | **cứng** — huỷ task |
| max_turns / task | 15 | **cứng** — huỷ task |
| Concurrency | 4 | cấu hình |
| **Sàn overhead / worker call** | **~13 200 token** | **không giảm được** — xem `FINDINGS` §2b |

### Chọn tier: luật quyết định, không phải trực giác

Đo thật ngày 14/08/2026 trên **cùng một việc soát lỗi** (2 file input, cùng ràng buộc, cache đã ấm):

| tier | lượt | token | thời gian | tiền |
|---|---:|---:|---:|---:|
| `eco` (Haiku) | 10 | 137 372 | 77,9s | **$0.0556** |
| `standard` (Sonnet) | 4 | 63 350 | 37,0s | $0.0893 |

Model rẻ **dò dẫm nhiều lượt hơn**, mà mỗi lượt đọc lại toàn bộ prefix. Nên "rẻ trên mỗi token" KHÔNG tự động thành "rẻ trên mỗi việc". Luật:

> **`eco` chỉ lãi khi `bội_số_token < tỉ_lệ_giá`.**
> Ở đây 2,17 < ~3,4 nên vẫn lãi. Nhưng biên mỏng hơn tỉ lệ giá gợi ý rất nhiều — và với việc phức tạp hơn, bội số token sẽ tăng cho tới lúc lỗ.

**Đo, đừng đoán:** `node bench/tier-compare.mjs` chạy đúng phép so này cho một vai trò bất kỳ.

> ⚠ **Bảng này đo ĐƯỜNG ĐI, không đo ĐẦU RA.** Nó ngầm giả định hai tier cho ra cùng một kết quả. Với việc có một đáp án đúng duy nhất thì giả định đó sai, và cả công thức trên vô nghĩa — xem cái giá thứ ba ngay dưới.

### Ba cái giá của `eco` mà bảng tiền không thể hiện

1. **Độ trễ gấp đôi.** 78s so với 37s. Người dùng ngồi chờ — với sản phẩm một người dùng thì đây thường quan trọng hơn 3 cent.
2. **Số lượt không đoán được.** Haiku: 9 rồi 10 lượt cho cùng một việc. Sonnet: 4 rồi 4. Nghĩa là **vai trò dùng `eco` cần ngân sách `max_turns` CAO HƠN HẲN** vai trò dùng `standard` — ngược với trực giác, và là lý do `reviewer` từng fail ở `max_turns` 4 rồi 6.

> **Luật:** vai trò `eco` đặt `max_turns` ≥ 1,5× số lượt đo được. Vai trò `standard` đặt ≈ 2× là đủ.

3. 🔴 **CÁI GIÁ THỨ BA, ĐO ĐƯỢC 21/08 VÀ NẶNG HƠN HAI CÁI TRÊN CỘNG LẠI: KẾT QUẢ SAI.**

Bảng so ở §4 trên đo **lượt · token · giây**, tức ngầm giả định *hai tier cho ra cùng một kết quả, chỉ khác đường đi*. Ca `bang-tinh` 21/08 bác bỏ giả định đó. Cùng một việc (gộp CSV 200 dòng theo `Phòng_Ban`×`Thành_Phố`, tổng + trung bình lương và tuổi), cùng một đầu vào, chạy ba lượt:

| lượt | tier | tiền (worker) | **số học** |
|---|---|---:|---|
| `P-260821-1805-d6v9` | `eco` (Haiku) | $0.157 | **sai 45/51 nhóm**, thiếu hẳn 5 nhóm, thừa 1 nhóm không tồn tại |
| `P-260821-1818-yydi` | `eco` (Haiku) | $0.179 | sai 3/56 nhóm |
| `P-260821-1827-m78h` | `standard` (Sonnet) | $0.425 | **đúng 56/56 — không sai một con số** |

**`eco` ở bài này tiết kiệm ÂM:** $0.336 tiêu cho hai kết quả không dùng được, rồi vẫn phải trả $0.425 để có một kết quả đúng. Tổng $0.761 thay vì $0.425.

Ba điều rút ra, xếp theo mức đáng nhớ:

- **Sai số KHÔNG ổn định giữa hai lượt cùng tier.** Cùng haiku, cùng đầu vào, hai đáp án sai *khác nhau* (45/51 rồi 3/56). Nên đây không phải một khiếm khuyết đo được một lần rồi trừ hao — nó là **xổ số**, và xổ số thì không có con số nào để đưa vào công thức `bội_số_token < tỉ_lệ_giá`.
- **Không phải "LLM không biết tính".** Sonnet đúng tuyệt đối **mà không dùng một tool nào**. Vế "chịu thôi, model ngôn ngữ vốn dốt số" bị chính số đo bác bỏ.
- **Không chốt nào đang có nhìn thấy chuyện này.** `missingOutputs` kiểm file tồn tại; `looped` kiểm lặp thao tác; cả hai đều xanh cho lượt sai 45/51 nhóm. Xem `SESSIONS_MEMORY` §5l ④.

> **Luật:** công thức chọn tier ở §4 chỉ áp dụng cho việc mà **mọi tier đều cho ra kết quả đúng** — soạn thảo, tóm tắt, phân loại, định dạng lại. Với việc có **một đáp án đúng duy nhất** (số học, đối chiếu, trích xuất chính xác), bảng token không nói được gì cả và `eco` phải được **đo trên đầu ra**, không đo trên hoá đơn.

⚠ **Đây KHÔNG phải lý do để agentco tự nâng tier.** Tier là tiền của người dùng và là quyết định của họ (`role.model_tier` trong `roles/<id>.yaml`). Ta không có quyền bỏ phiếu — ta chỉ có nghĩa vụ làm cho lựa chọn đó **sáng mắt thay vì mù**, và mục này tồn tại để được đọc trước khi ai đó gõ `model_tier: eco` cho một vai trò làm việc có đáp án đúng duy nhất. Con đường đúng cho *chất lượng* chuyên môn vẫn là **khách cắm tool/MCP** (`SPEC-connectors.md`), không phải ta vá trong lõi.

> **Luật bổ sung sau khi đo (spec gốc thiếu):**
> **Ưu tiên ít task lớn hơn nhiều task nhỏ.** Mỗi task gánh ~13K token overhead bất kể việc to hay nhỏ. Chỉ chẻ task khi có **song song thật** hoặc **cần role khác** — không chẻ để nhìn cho gọn. Đây là ràng buộc ngược với §7 `SPEC-2026-08-14-agentco.md` (scheduler); scheduler phải từ chối DAG có task tầm thường và gộp chúng lại.

### 🔴 `max_usd`: TRẦN LÀ CÁI PHANH CỦA NGƯỜI DÙNG, KHÔNG PHẢI CÁI THƯỚC CỦA TA (user chốt 21/08)

> *"Nếu task nào khó thì phải cho nó có trần cao để nó còn hoàn thành job của nó chứ."*

**`0` = không giới hạn, và đó là mặc định của schema.** `newRoleYaml` ghi sẵn một số **rộng** theo tier (`eco: 1.0` · `standard: 2.0`) để người dùng nhìn thấy và tự siết xuống khi đã biết việc của mình tốn bao nhiêu.

Vì sao đổi: mặc định cũ là $0.4 ở template và $0.5 ở schema, trong khi đo được cùng ngày, đúng việc mà `pitch` của vai trò quảng cáo (*"đọc CSV, tính tổng hợp theo nhóm"*) tốn **$0.425 · $0.448 · $0.516** trên `standard`. Mặc định của TA nằm **dưới giá của công việc mà vai trò đó tồn tại để làm** — nó bắn trên đường hạnh phúc, mọi lần.

Và một con số cho cả hai tier cũng sai: cùng việc, `eco` tiêu $0.157–0.179 còn `standard` $0.425–0.516 (**~2,7×**). Một trần chung thì vừa quá lỏng cho tier này vừa quá chặt cho tier kia.

**Bất đối xứng quyết định hướng lệch:** chặn giữa chừng là **mất trắng** số tiền đã tiêu mà chưa có kết quả; còn đặt trần rộng thì việc nào tiêu ít vẫn chỉ tính tiền phần nó dùng. Lệch về phía rộng là lệch đúng hướng.

⚠ `maxBudgetUsd` **không được truyền xuống SDK khi giá trị là 0** — truyền 0 là đặt trần bằng không, tức chặn ngay lượt đầu.

**Sửa được trên giao diện**, cùng ô với mức model (`Inspector → Đổi model & giới hạn`): người dùng đổi tier là lúc duy nhất họ nghĩ về cái giá, và cùng một việc trên `deep` đắt gấp mấy lần trên `eco`. Tách ra hai màn hình là bắt họ nhớ quay lại sửa lần hai. Trước 21/08 hai con số này **không có mặt ở bất kỳ màn hình nào** — trong khi câu báo lỗi vẫn bảo người dùng *"nới max_usd trong roles/…yaml"*. Không phải nói dối, nhưng là **chỉ sai cửa**: số đó có sửa được, chỉ là không sửa được ở nơi người dùng đang đứng.

Khi chạm trần cứng mà **chưa** giao đủ hàng: task chuyển `blocked`, hiện lên UI, hỏi người dùng có nới không. **Không bao giờ tự nới.** Chạm trần mà **đã** giao đủ hàng thì task là `done` — xem `SPEC-offices.md` §6.

### Đổi model giữa chừng — cho phép, và đắt ít hơn dự đoán

Chi tiết + bảng số: `SPEC-offices.md` §4.5. Ba điều cần nhớ ở đây:

1. **Nhân viên là hàm không trạng thái** → đổi `model_tier` không mất gì. Chỉ ghi cache một lần cho cặp (model mới, prefix).
2. **Trợ lý chạy `resume`** → trí nhớ hội thoại **không mất** (bản ghi nằm trên đĩa, độc lập với model). Đo được: lượt đổi tốn thêm ~1 000–1 400 token ghi cache, tức **+60–80% của một lượt, một lần**.
3. **Việc đang chạy giữ nguyên model cũ.** Ép bởi kiến trúc, không bởi kỷ luật: `applyCompanyConfig` dựng `LoadedOffice` mới, Scheduler đang chạy giữ bản cũ.

> ⚠ **Bẫy đã dẫm: đổi tên KHOÁ trong schema cũng phải có alias, không chỉ đổi GIÁ TRỊ.**
> `TIER_ALIASES` lo `model_tier: cheap` trong `roles/*.yaml`. Nhưng `company.yaml` viết `models.cheap: <model>` thì zod bỏ qua khoá lạ, `eco` rơi về mặc định, và người dùng chạy suốt một model **khác** cái họ đã ghi ra — không lỗi, không cảnh báo, chỉ có hoá đơn không khớp. Im lặng hơn hẳn nửa kia của cùng một bài học.

---

## 5. Đo lường — bắt buộc có từ ngày đầu

Không có số đo thì không tối ưu được, và không phát hiện được chết chậm.

Mỗi task ghi một dòng vào `logs/usage.jsonl`:

```json
{"ts":"...","task_id":"T-0007","role":"writer","role_version":3,
 "cache_key":"a1b2c3","tier":"standard",
 "in":1200,"cache_read":9800,"cache_write":0,"out":650,
 "wall_ms":8400,"status":"done"}
```

CLI `agentco cost` in ra:

```
Ca làm việc hôm nay          42 task
Tổng token                   in 61K · cache_read 780K · cache_write 24K · out 38K
Tỉ lệ cache hit (prefix)     0.91   ✓ (ngưỡng 0.70)
Token / task (p50 / p95)     19.8K / 44.1K
Tốn nhất                     T-0031 researcher 44.1K
Cache write bất thường       role=coder 3 lần   ← có ai bump version giữa ca?
```

### Sổ phải ghi CẢ lượt của Trợ lý, không chỉ receipt của nhân viên

Bản trước chỉ ghi một dòng cho mỗi receipt worker. Hệ quả: `route()` — chạy **mỗi lượt người dùng nhắn** — có `usage` bị vứt thẳng đi, còn `plan()`/`report()` chỉ được cộng vào `cost.tick` trong bộ nhớ. Với văn phòng dùng chủ yếu để trò chuyện, đó là **phần lớn hoá đơn**, và nó vô hình với `agentco cost`.

Giờ mỗi lượt Trợ lý ghi một dòng với `role: "assistant"` và `task_id` = tên **khâu**: `route` · `plan` · `report`. Tách khâu chứ không gộp, vì ba khâu có hình dạng chi phí khác hẳn nhau — `route` chạy mỗi lượt nên phải rẻ; `plan` chạy một lần một ca ở query riêng. Gộp lại thì không thấy khâu nào đang phình.

Đây cũng là điều kiện để đánh giá được việc đổi model: **không đo được thì không cân nhắc được cái giá.** Và nó là một nửa của việc `agentco cost` phải trả lời được *"còn bao nhiêu"*, không chỉ *"đã tiêu"* (`USE-CASES.md` §10).

### 🔴 Token lấy từ `modelUsage`, KHÔNG lấy từ `usage` (chốt 21/08, sổ đã lệch 14×)

Đây là một bất biến của **sổ chi phí**, không phải chi tiết cài đặt của SDK — nên nó nằm ở đây, ở luật cao nhất.

`.d.ts` của `@anthropic-ai/claude-agent-sdk` nói thẳng (`sdk.d.ts:4453`, nguyên văn):

> `usage`: **MAIN AGENT LOOP ONLY** — excludes Task subagent, sidechain, and auxiliary model calls, and is **per-turn in streaming-input sessions**. **Prefer `modelUsage` for token/cost accounting.**
>
> `total_cost_usd`: *"Cumulative … each result carries the running total so far, so read the latest result rather than summing across results."*

`worker.ts` chạy **streaming-input mode** (`oneMessage()`), nên vế *"per-turn"* áp dụng cho ta. Bản trước lấy **token từ `usage`** (một lượt) và **tiền từ `total_cost_usd`** (tích luỹ) — hai đơn vị khác nhau trong cùng một dòng sổ.

**Đo được, ca `P-260821-1827-m78h`:** sổ ghi `out 59 · cache_read 0` nằm cạnh `$0.4248`. Với sonnet thì 59 token đầu ra là khoảng $0.001 — **sổ lệch 14×**, và lệch theo hướng làm mọi phép tính `$/lượt` trở thành rác.

Ba hệ quả, và cái thứ ba là cái đau:

1. Số token trên giao diện sai ở mọi ca nhiều lượt.
2. `cost.tick` cộng dồn những con số không cùng đơn vị.
3. **Nó lệch to nhất đúng ở ca `budget` và `max_turns`** — tức ca ĐẮT NHẤT, và cũng là ca người dùng cần con số nhất. Ca chạy êm thì lượt cuối tình cờ là lượt lớn nên nhìn "gần đúng"; ca hỏng thì lượt cuối là một câu báo lỗi 59 token.

> **Luật chung rút ra:** *một trường tên là `usage` không tự động có nghĩa là "tất cả usage".* Trước khi cắm một con số của SDK vào sổ, đọc chú thích của chính trường đó — chi phí nửa phút, và nó chặn đúng loại lỗi **không bao giờ tự lộ ra** vì sổ vẫn in ra một con số trông hợp lý.

`total_cost_usd` **giữ nguyên** làm nguồn TIỀN: nó bao cả lượt phụ trợ mà `modelUsage` có thể không kê hết, và `maxBudgetUsd` của SDK đo theo chính con số đó — sổ của ta phải nói cùng thứ tiếng với cái phanh.

→ `worker.ts → readUsage`, test ở `test/landing.test.ts`.

### Số liệu token phải HIỆN ĐƯỢC trên giao diện — và model không bao giờ thấy nó

`agentco cost` là công cụ của người biết gõ lệnh. Người dùng chính của ta thì không, nên bảng này phải có mặt trong **Nhật ký công việc**: một khối đóng/mở với `đọc lại · ghi cache · lượt · $` cho từng task.

Số liệu **đã nằm sẵn** trong mỗi sự kiện `task.done` và trong file log — vẽ nó ra tốn **0 token**. Không có nó thì bài 1 của `TEST-WALKTHROUGH.md` (*"nhìn `cache_write`: task đầu lớn, hai task sau nhỏ"*) là một bài **không làm được**, vì chữ `cache_write` không xuất hiện ở đâu trên màn hình.

> **Kế toán là việc của người đứng ngoài đếm, không phải của người đang làm.** Nhân viên và Trợ lý KHÔNG BAO GIỜ được biết những con số này. Ba lý do, mỗi lý do tự nó đã đủ:
> 1. Nhân viên **không làm gì được** với con số đó — nó không tự đổi cách làm việc vì biết mình vừa ghi 13K cache. Đã đo: prompt "kỷ luật số lượt" gần như không ăn thua (§4).
> 2. Nói cho model biết nghĩa là **nhét con số vào prompt**, tức là trả tiền ở MỌI lượt để kể một chuyện chỉ có nghĩa với người quan sát.
> 3. `CORE_PROMPT` đã cấm thuật ngữ kỹ thuật trong `say`. Đưa token vào đó là tự mâu thuẫn.

**Dòng "cache write bất thường" là hệ thống báo động chính.** Cache write lặp lại nhiều lần cho cùng một role trong một ca = có gì đó đang phá prefix. Đó chính xác là lỗi đã xảy ra với `claude -p`, và là lỗi bạn sẽ không tự nhìn ra nếu không có dòng này.

---

## 6. Bộ kịch bản chuẩn (golden scenarios)

5 kịch bản cố định, chạy được lặp lại, dùng làm thước đo mọi thay đổi:

| # | Kịch bản | Kiểm cái gì |
|---|---|---|
| S1 | 1 task đơn, 1 role | chi phí sàn, cache write lần đầu |
| S2 | 3 task cùng role song song | priming gate có ăn không |
| S3 | DAG 5 task, 3 role, có phụ thuộc | scheduler + song song hỗn hợp |
| S4 | Hội thoại 10 lượt với master | tăng trưởng context master, compaction |
| S5 | Chạy lại S3 sau khi sửa 1 task giữa | replay có cắt đúng nhánh không |

Quy trình bắt buộc trước mỗi lần merge thay đổi role/prompt/kiến trúc:

```
agentco bench --baseline    # đo trước
<thay đổi>
agentco bench --compare     # in bảng chênh lệch
```

Xấu đi >10% ở bất kỳ kịch bản nào mà không giải thích được → không merge.

---

## 7. Checklist review — dán vào PR template

Mỗi thay đổi phải tự trả lời:

- [ ] Có làm đổi nội dung L0–L4 không? Nếu có, đã bump `knowledge_version`/`role.version` đúng chưa?
- [ ] Có thêm gì vào context của master không? Nếu có, vì sao không để worker gánh?
- [ ] Có chỗ nào master đọc nội dung file thay vì đường dẫn không?
- [ ] Có thêm call LLM nào cho việc mà code thuần làm được không?
- [ ] Node tri thức mới có ≤250 token không?
- [ ] Đã chạy `agentco bench --compare` chưa? Kết quả?
