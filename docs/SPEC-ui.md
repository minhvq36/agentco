# SPEC — Giao diện

> **⚠ CHỐT 15/08/2026 — stack và bố cục đổi. Đọc §0 trước.**

## 0. Stack và bố cục — **ĐÃ CÀI ĐẶT** (Đợt 2, 15/08/2026)

| Phần | Ở đâu |
|---|---|
| Vỏ app, dải kế hoạch, toast, trạng thái rỗng | `web/src/App.tsx` |
| Canvas SVG + tương tác chuột | `web/src/canvas/` |
| State + SSE | `web/src/lib/store.ts` |
| Client API (không nuốt lỗi) | `web/src/lib/api.ts` |
| Sidebar + 6 panel | `web/src/components/` |
| Daemon phục vụ `web/dist` | `src/server/static.ts` |

Lệnh: `npm run build:all` (backend + UI) · `npm run dev:web` (Vite 5173, proxy `/api` sang 7317).

### Stack: React + Vite + Tailwind v4 + shadcn/ui

Bỏ ràng buộc "không build step" của §5. Lý do: sáu màn hình mới (sidebar đóng/mở, chuyển văn phòng, log nhiều luồng, prompt phân lớp, dialog cảnh báo, canvas) trong một chuỗi `String.raw` không có type check sẽ thành ~2 500 dòng không ai bảo trì nổi — và bốn tiêu chí chất lượng mới (`SPEC-2026-08-14-agentco.md` §1) đòi đúng những thứ shadcn/Radix cho sẵn: focus trap, aria, không nhảy layout.

```
agentco/
├─ src/                backend TS, như cũ
└─ web/                mới
   ├─ src/App.tsx
   ├─ src/canvas/      SVG VIẾT TAY, không thư viện canvas
   └─ src/components/ui/   shadcn copy vào
```

`npm run build` = `tsc` + `vite build`. Daemon phục vụ `web/dist` tĩnh.

**Ràng buộc hiệu năng, không thương lượng:** kéo node cập nhật `transform` qua `ref`, **không** `setState` mỗi frame. React lo phần vỏ; canvas tự lo vòng lặp chuột của nó. 60fps kể cả khi công ty đang chạy.

### Bố cục: sidebar trái đóng/mở

Chat, nhật ký, tổng quan công ty, tri thức chuyển hết vào **sidebar trái**. Bấm vào mục nào hiện mục đó; luôn có nút ✕ để đóng lại và trả toàn bộ màn hình cho canvas.

Thanh dưới (kế hoạch + chat) của bản v0 biến mất — nó chiếm chỗ vĩnh viễn cho thứ người dùng chỉ cần từng lúc.

Hai nút `Sắp xếp` / `Vừa khung` đổi thành **icon**, không chữ.

### Bảy tab, và BA KHO đứng liền nhau (19/08 · thêm Cài đặt 03/09)

```
Nói với Trợ lý · Nhật ký công việc · Tổng quan công ty · Tủ tài liệu · Kết quả · Kho tri thức · Cài đặt
                                                        └────────── ba kho ──────────┘
```

**Cài đặt hiện CẢ KHI CHƯA CÓ VĂN PHÒNG NÀO** — cùng ngoại lệ với Tổng quan, và cùng lý do: nó là
cấp **công ty**, không phải cấp văn phòng. Một bản cài mới tiếp đất ở màn hình rỗng, và ngôn ngữ
giao diện là thứ họ phải chọn được **trước** khi tạo văn phòng đầu tiên — bắt tạo văn phòng rồi mới
đổi được ngôn ngữ là bắt họ đọc một màn hình bằng thứ tiếng họ không dùng để làm việc đó.
→ `web/src/components/Sidebar.tsx §tabs` · `docs/CLAUDE.md §Language`

Ba kho là ba khái niệm dễ lẫn nhất trong sản phẩm, phân biệt bằng đúng một câu hỏi: **ai đặt file vào đó?**

| | ai ghi | người dùng làm được gì |
|---|---|---|
| Tủ tài liệu | NGƯỜI DÙNG | thêm · xoá |
| **Kết quả** | NHÂN VIÊN | xoá |
| Kho tri thức | AGENT tự rút ra | sửa · xoá |

Đứng cạnh nhau thì khác biệt đọc được bằng mắt; rải ra ba chỗ thì người dùng phải nhớ. **Kết quả đặt ở GIỮA** vì nó là cái duy nhất có cả hai đầu: nhân viên đọc tài liệu ở trên, học được gì thì thành tri thức ở dưới.

Mỗi ngăn kéo có một dòng ở chân tự nói mình LÀ GÌ và chỉ sang cái kia. **0 token** — nằm hoàn toàn ở giao diện. → `SPEC-artifacts.md`

### Sidebar KÉO RỘNG ĐƯỢC — bề rộng là nội dung, không phải trang trí

336px đủ cho một dòng chat, **không** đủ cho thứ Trợ lý thật sự trả về: danh sách lệnh, kế hoạch nhiều bước, báo cáo cuối ca. Nội dung dạng đó không co lại được — nó chỉ ngắt dòng xấu đi. Nên bề rộng phải là thứ người dùng chỉnh:

- **tay nắm kéo** ở mép phải, vùng bắt 7px, vạch chỉ hiện khi rê tới (một đường kẻ đậm suốt chiều cao màn hình là nhiễu thị giác)
- **nút mở rộng** nhảy thẳng tới bề rộng rộng (720px) và về lại
- **nhấp đúp** tay nắm → về mặc định
- nhớ trong `localStorage`; kẹp lại khi thu nhỏ cửa sổ, nếu không canvas biến mất hẳn và không có cách lấy lại

> **Ràng buộc hiệu năng, giống hệt luật của canvas:** bề rộng lúc **đang kéo** đi thẳng vào DOM qua `ref`, không qua `setState`. Một `setState` mỗi frame kéo là render lại cả cây React 60 lần/giây **trong khi SSE vẫn đang bắn sự kiện vào**. React chỉ biết bề rộng mới khi **thả chuột**.

### Tin nhắn phải giữ ký tự xuống dòng

Bong bóng chat dùng `white-space: pre-wrap`. Đây là **bắt buộc**, không phải thẩm mỹ: những câu trả lời nhiều dòng mà backend dựng sẵn bằng code — `/help`, danh sách bước của kế hoạch, báo cáo cuối ca — dùng ký tự xuống dòng thật, và HTML gộp mọi khoảng trắng thành một dấu cách. Không giữ thì `/help` hiện ra thành một khối chữ liền không đọc nổi.

Kèm `break-words`: đường dẫn file và URL dài không có khoảng trắng để ngắt; thiếu nó thì bong bóng tự nong ra và đẩy cả panel sinh thanh cuộn ngang.

Phía backend chịu ràng buộc đối ứng: `helpText()` xếp **tên lệnh một dòng, mô tả thụt vào ở dòng dưới** thay vì căn cột. Căn cột bằng khoảng trắng chỉ đúng với font đơn cách, mà bong bóng chat dùng font thường — và cùng bộ lệnh này sẽ chạy qua Telegram, nơi còn hẹp hơn.

### Bảng markdown: TRỌN BẢNG HOẶC KHÔNG GÌ CẢ (20/08)

Bộ vẽ markdown tự viết (`markdown-core.ts` + `markdown.tsx`, dùng chung ô chat và cửa sổ xem trước `.md`) nhận thêm **luật thứ năm**: bảng. Lý do là dữ liệu, không phải sở thích — bảng là dạng kết quả nhân viên sinh ra thật: bảng thuật ngữ, bảng chi tiêu, bảng so sánh giá. Hiện nguyên văn dấu `|` là bắt người dùng tự dựng cái bảng đó trong đầu, mà họ mở file `.md` ra để **duyệt trước khi gửi cho khách**.

**Nhận diện đòi BA điều kiện**, thiếu một là rơi thẳng về văn bản thường và hiện nguyên văn y như trước:

1. dòng hiện tại có `|`
2. dòng **ngay sau** là dòng phân cách (`|---|:--:|`) — và **chính nó cũng phải có `|`**
3. số cột của hai dòng đó **khớp nhau**

> Điều kiện 2 có vế thứ hai là để hai dòng vô hại `chọn cà phê | trà sữa` + `---` không thành một bảng một cột. `---` đứng một mình là gạch ngang / tiêu đề setext — hai thứ bộ vẽ này **cố ý không hỗ trợ**, nên chúng phải tiếp tục hiện nguyên văn. Miễn phí: bảng từ hai cột trở lên thì dòng phân cách bắt buộc đã có `|`.

Vì sao khắt khe: **một bảng vẽ ra mà lệch cột hay thiếu ô là một lời khẳng định SAI về dữ liệu** — người đọc tin cái bảng hơn hẳn tin một đống dấu `|`. Hiện nguyên văn thì xấu nhưng không nói dối, và người dùng nhìn ra ngay *"chỗ này chưa dựng được"*.

Hàng **thân** thì ngược lại, được nới: thiếu ô thì đệm rỗng, thừa ô thì cắt (đúng GFM). Ràng buộc chặt đặt ở chỗ **quyết định "đây có phải bảng không"**; quyết rồi thì một hàng lệch không đáng để vứt cả bảng.

#### Hai lớp chống vỡ — và cả hai đều bắt buộc

1. **`overflow-x-auto` + `max-w-full` ở khối bọc ngoài** — cùng luật đã áp cho khối code: nội dung rộng cuộn **trong khối của nó**.
2. **Bong bóng chứa bảng phải có BỀ RỘNG XÁC ĐỊNH** (`block w-full`), không phải `inline-block` co theo nội dung. Với `inline-block`, bề rộng khối bọc lại phụ thuộc vào nội dung bên trong — `max-w-full` không còn mốc nào để bám và lớp 1 mất tác dụng.

Nhờ đó **panel thu hẹp tới `MIN_W` = 300px thì bảng vẫn chỉ cuộn ngang bên trong, không bao giờ đẩy sidebar rộng ra** — thân panel là `flex-none` với `width` tường minh và `overflow-hidden`, nên nội dung không có đường nào nong nó.

Bong bóng nới rộng **chỉ khi tin nhắn thật sự có bảng** (`hasTable()`): một bong bóng chiếm trọn bề ngang cho câu *"Đã xong."* trông như lỗi bố cục. Và `hasTable()` đi qua **đúng `blocksOf`** chứ không phải một regex riêng — hai cách nhận diện song song thì kiểu gì cũng có ngày lệch, và lúc đó bong bóng nới rộng cho một thứ tầng vẽ lại quyết định hiện nguyên văn.

### Một ô nhập, MỘT vòng focus (20/08)

Người dùng: *"viền ô chat khi được chọn bị dày, hai đường cam song song tạo cảm giác thô"*. Đúng, và nguyên nhân đáng ghi lại.

Ô nhập nhận **hai** dấu focus chồng lên nhau: `focus:border-accent` (viền 1px cam) trong `ui/misc.tsx`, cộng luật nền `:focus-visible { outline: 2px; outline-offset: 2px }` — hai đường cam cách nhau một khe 2px, mắt đọc ra thành viền dày ~5px.

> 🔥 **`misc.tsx` ĐÃ CÓ `focus:outline-none`, và nó không có tác dụng.** Không phải vì specificity mà vì **cascade layer**: Tailwind v4 đặt utility trong `@layer utilities`, còn CSS trần trong `index.css` nằm **ngoài mọi layer** — mà style không nằm trong layer **thắng mọi style nằm trong layer**, bất kể specificity. Người viết dòng đó tin rằng mình đã tắt xong.
>
> **Bài học chung:** đã `@import 'tailwindcss'` thì mọi luật CSS trần viết sau nó là luật **ưu tiên cao nhất trong ứng dụng** — phải viết như thế, và không được trông đợi một utility nào đè lại được.

Sửa bằng một luật cho riêng ô nhập: bỏ `outline`, giữ viền đổi màu, thêm quầng mềm **sát viền** (`box-shadow 0 0 0 3px`). Không khe hở thì không có hai đường. Quầng trộn từ chính `accent` bằng `color-mix` chứ không dùng `--color-accent-soft`: ở nền tối `accent-soft` là nâu sẫm đặt trên `panel`, gần như biến mất.

Nút bấm **cố ý** không nằm trong luật này — chúng là nền đặc, một vòng outline bao quanh đọc ra đúng là *"đang được chọn"*, không phải một viền dày.

### Đường dẫn kết quả trong chat BẤM ĐƯỢC — nhưng chỉ đường dẫn CODE đặt vào (20/08)

Chi tiết cơ chế ở `SPEC-artifacts.md` §2.5. Phần thuộc về giao diện:

- Tin nhắn mang `files` thì mỗi dòng khớp một đường dẫn trong đó thành **một nút cả dòng** (`w-full`) — một mục tiêu cao 8px thì người dùng bấm trượt rồi kết luận là nó không bấm được. `break-all` vì đường dẫn dài không có khoảng trắng để ngắt, và một cái nút không xuống dòng được sẽ nong rộng bong bóng.
- Dòng **không** khớp file nào đi qua `Markdown` như mọi tin khác. Không nhánh nào ở đây được phép đổi cách hiển thị hiện tại.
- ⛔ Giao diện **không bao giờ** tự dò đường dẫn trong chữ. Xem §2.5 — đó là cách cho một câu model bịa mượn uy tín của giao diện.

### Lỗi phải TRÔNG NHƯ lỗi

Toast lỗi có **nền màu** (`danger-soft`) và viền `danger`, `role="alert"`, `aria-live="assertive"`.

Bản trước dùng nền `panel` — y hệt mọi bảng khác — và chỉ đổi màu một cái icon 16px. Người dùng bấm "Thêm nhân viên", tên trùng, toast hiện lên trông như một thông báo bình thường, và họ **đứng khựng vì tưởng app đơ** chứ không đọc ra rằng vừa có lỗi.

Tiêu chí "Xử lý lỗi tốt" đòi mọi lỗi nói được *chuyện gì xảy ra + làm gì tiếp*. Bước đầu tiên của việc đó là **nhìn vào phải biết ngay đây là lỗi** — nếu không thì phần chữ viết hay đến mấy cũng không ai đọc.

### Xoá luôn có hai mức, và mức an toàn đứng trước

Văn phòng và nhân viên đều: **Lưu trữ** (cất đi, khôi phục được) · **Xoá hẳn** (mất luôn). → `SPEC-offices.md` §3.1, §5.1

- Hai **nút riêng**, không phải một nút rồi hỏi lại. Hai ý định khác nhau thật thì cho chúng hai lối đi khác nhau.
- Nút "Xoá hẳn" mang `variant="danger"`; dialog xác nhận **nói ra thứ sẽ mất**, và **chỉ đường sang mức Lưu trữ** cho người bấm nhầm.
- Danh sách "Trong lưu trữ" dùng viền **nét đứt** — nhìn là biết chưa phải trạng thái bình thường.

### Chi phí: gộp để HIỂN THỊ, không gộp DỮ LIỆU

Những dòng chi phí không còn văn phòng (đã xoá hẳn, hoặc bản ghi có trước khi tách văn phòng) gom vào **một khối đóng/mở**: *"N mục không còn · $X · bấm để xem"*.

Không gom thì sau vài tháng bảng đầy tên đã chết. Nhưng **cộng chúng thành một dòng** thì cái mã văn phòng mất — mà với văn phòng đã xoá hẳn, cái mã là manh mối **duy nhất** còn lại để biết khoản tiền đó là của việc gì. Thu gọn giữ được cả hai, và không tốn một dòng code kế toán nào — chỉ là một `<details>`.

Văn phòng **lưu trữ** thì vẫn nằm ở danh sách chính kèm nhãn *(lưu trữ)*: nó còn cứu được, và nó còn tên.

### Log đi theo CÔNG VIỆC, không theo thời gian

→ `SPEC-offices.md` §6. Mỗi agent (kể cả Trợ lý) có một màu ổn định băm từ id. Log lọc theo `plan_id`; hội thoại là một luồng riêng (`plan_id: null`).

### Ngoại lệ có chủ ý: dải kế hoạch KHÔNG nằm trong sidebar

Checklist §6 đòi trả lời được *"đang ở bước mấy"* **không cần click**. Nhét kế hoạch vào một panel đóng/mở là vi phạm đúng điều đó.

Nên kế hoạch nằm ở một **dải mỏng đè lên canvas**, chỉ hiện khi có việc đang chạy, và bấm vào thì mở nhật ký của chính việc đó. Dòng gợi ý cho người mới tự ẩn đi khi dải này xuất hiện — hai thứ tranh cùng một chỗ thì thứ đang chạy thắng.

---

> **⚠ §1–§2 ĐÃ BỊ THAY THẾ bởi [`SPEC-canvas.md`](SPEC-canvas.md).**
> Bố cục danh sách mô tả dưới đây là bản v0 đang chạy. Bản kế tiếp là **canvas dạng node**
> (kiểu n8n) — công ty thành một sơ đồ kéo thả được, và ràng buộc kiến trúc
> (mô hình sao, agent không nối agent) trở thành thứ *không vẽ được* thay vì
> một dòng trong tài liệu.
>
> Các phần vẫn còn nguyên giá trị: §3 ngăn kéo nhật ký · §4 ngăn kéo tri thức ·
> §5 kỹ thuật & sự kiện SSE · §6 checklist chống hoang mang.

Đọc kèm `SPEC-2026-08-14-agentco.md`.

**Nguyên lý chủ đạo:** người dùng nhìn thấy **một công ty đang làm việc**, không phải một terminal đang cuộn log. Nhưng log advanced luôn cách một cú click — không giấu, chỉ không phô ra.

Đây cũng là nỗi đau gốc đã tìm ra ở phiên 03/08: *"người ngoại đạo hoang mang không biết bị dắt đi đâu và scope AI làm đến đâu"*. Toàn bộ UI này tồn tại để trả lời bốn câu: **đang ở đâu, ai đang làm, còn bao xa, có đúng hướng không.**

---

## 1. Bố cục

```
┌──────────────────────────────────────────────────────────────────────┐
│  Xưởng Nội Dung          ● 3 đang làm   ⏱ 4p12s   💰 62K token   ⚙  │
├──────────────┬───────────────────────────────────────────────────────┤
│              │                                                       │
│  ĐỘI NGŨ     │   ┌─ KẾ HOẠCH ────────────────────────────────────┐  │
│              │   │ "viết 3 bài fanpage về sản phẩm X"            │  │
│  🔎 Nghiên   │   │                                               │  │
│     ● đang   │   │ ✓ 1. Tìm hiểu sản phẩm và khách hàng          │  │
│     T-01     │   │ ⟳ 2. Nghiên cứu bài viết đối thủ    ← đang    │  │
│              │   │ ○ 3. Viết 3 bản nháp                          │  │
│  ✍ Viết      │   │ ○ 4. Soát và chỉnh giọng                      │  │
│     ○ rảnh   │   └───────────────────────────────────────────────┘  │
│              │                                                       │
│  🔍 Soát     │   ┌─ ĐANG DIỄN RA ────────────────────────────────┐  │
│     ○ rảnh   │   │ 🔎 Nghiên cứu viên                            │  │
│              │   │    Đang đọc 4 fanpage cùng ngành...           │  │
│  📚 Thủ thư  │   │                                               │  │
│     ○ rảnh   │   │ ✍ Người viết                                  │  │
│              │   │    Chờ kết quả nghiên cứu                     │  │
│  + Thêm      │   └───────────────────────────────────────────────┘  │
│              │                                                       │
│              │   ┌─ NÓI VỚI GIÁM ĐỐC ────────────────────────────┐  │
│              │   │ > _                                           │  │
│              │   └───────────────────────────────────────────────┘  │
├──────────────┴───────────────────────────────────────────────────────┤
│  ▸ Nhật ký chi tiết (12)                             ▸ Tri thức (48) │
└──────────────────────────────────────────────────────────────────────┘
```

Hai thanh dưới cùng là **ngăn kéo**, mặc định đóng.

---

## 2. Bốn khu vực

### 2.1 Kế hoạch — trái tim của UI

Đúng như hình dung: **kế hoạch ngắn gọn 1. 2. 3. 4., đi qua những đâu.**

- Master sinh ra kế hoạch với **tối đa 6 bước**, mỗi bước **≤10 từ tiếng Việt**. Đây là ràng buộc trong prompt của master, không phải gợi ý.
- Trạng thái: `○ chưa làm` · `⟳ đang làm` · `✓ xong` · `⚠ có vấn đề` · `⏸ chờ bạn`
- Bước có nhiều task con chạy song song → hiện `⟳ 2/3`
- Click một bước → mở chi tiết: task nào, ai làm, file gì ra, tốn bao nhiêu

**Nút `Xem trước kế hoạch` (`--plan-only`):** master lập kế hoạch xong thì **dừng, chờ duyệt**, chưa tiêu token thực thi. Người dùng sửa/xoá bước rồi bấm Chạy. Bật/tắt được trong cài đặt; **mặc định BẬT** cho người mới — đây chính là "kiểm soát scope", lý do tồn tại của sản phẩm.

### 2.2 Đội ngũ

Danh sách role như danh sách nhân viên. Mỗi người: avatar, tên, trạng thái, task hiện tại.

Click vào một người → thẻ nhân viên:
- **Giới thiệu** (`pitch` từ role yaml)
- **Kỹ năng** — chọn mức `ngắn / trung bình / formal`, đổi tại chỗ
- **Kinh nghiệm riêng** — các node `k/agents/<role>/`, đọc và sửa được
- **Lịch sử** — 20 task gần nhất, chi phí trung bình
- **Nâng cao** — tier model, budget, tool, MCP

Đây là mặt "modding" chính cho người advanced, nhưng trình bày như hồ sơ nhân sự chứ không như file cấu hình.

**Hai ràng buộc bắt buộc khi soạn kỹ năng:**

1. **KHÔNG autosave theo từng phím.** Phải có nút **Lưu** tường minh. Mỗi lần lưu là bump cache key → trả một lần cache write. Autosave = churn cache liên tục, đắt và chậm.
2. **Lớp core hiện ở chế độ chỉ đọc**, có nhãn rõ "phần này đảm bảo hệ thống chạy đúng chi phí — không sửa được". Đừng giấu nó đi: người advanced cần **thấy** để tin, chỉ là không được sửa. Xem `SPEC-2026-08-14-agentco.md` §3.

`concierge` **không xuất hiện** trong danh sách này — nó là tool của master, không phải nhân viên.

### 2.3 Đang diễn ra

Stream trạng thái sống của các worker. **Mỗi dòng là trường `say` trong receipt/progress event — do chính worker sinh ra, không tốn thêm call LLM nào để "dịch cho thân thiện".**

Quy tắc hiển thị:
- Một agent chỉ giữ **một dòng hiện tại**, cập nhật tại chỗ, không cuộn vô hạn
- Không hiện tên tool, không hiện JSON, không hiện đường dẫn dài
- Agent chờ dependency → hiện rõ "Chờ kết quả nghiên cứu", không để trống
- `⏸ chờ bạn` → nổi lên trên cùng, có nút trả lời ngay

### 2.4 Nói với giám đốc

Ô chat với master. Chính là kênh Telegram nhưng ở dạng web. Một session, một ca làm việc.

Hiện ở góc: `ngữ cảnh 23K / 60K` — khi gần chạm sẽ báo "sắp gộp ký ức", để người dùng không bị bất ngờ khi master quên chi tiết cũ.

---

## 3. Ngăn kéo Nhật ký chi tiết

Mở ra là log advanced đầy đủ. Ba mức, chọn bằng tab:

| Mức | Nội dung |
|---|---|
| **Sự kiện** | task bắt đầu/kết thúc, quyết định của master, lỗi — dạng bảng thời gian |
| **Hội thoại** | transcript thô của từng worker, chọn theo task |
| **Chi phí** | bảng `agentco cost` dạng web: token vào/ra/cache theo task, cảnh báo cache write bất thường |

Tab **Chi phí** phải dễ tìm và dễ đọc — đây là thứ giữ cho sản phẩm không âm thầm đắt lên, và là thứ khách hàng advanced đánh giá cao nhất.

### 3.1 🔴 KHỐI KHÔNG CO ĐƯỢC THÌ NÓ ĂN HẾT CHỖ CỦA KHỐI CO ĐƯỢC (bug 21/08)

Bảng chi tiết một ca là một cột flex với **năm** khối, và bốn trong số đó là `flex-none`: tiêu đề · dải bước · bảng token · **câu tổng kết của Trợ lý**. Chỉ nhật ký sự kiện là `flex-1`.

Hậu quả người dùng gặp: báo cáo dài 30 dòng chiếm 30 dòng, nhật ký bị ép xuống gần bằng không.

> *"Nếu câu kết quả này dài, nó chiếm hết diện tích bên trên khiến tôi thực sự không biết các worker trao đổi với nhau cái gì (cảm giác như không kéo xuống hoặc lăn chuột được). Tôi chỉ làm được khi kéo khung rộng ra."*

Kéo khung rộng ra thì chữ xuống dòng ít hơn ⇒ báo cáo thấp xuống ⇒ nhật ký có lại chỗ. Tức là **bố cục đang bắt người dùng chỉnh cửa sổ để đọc được nội dung** — cùng lớp với luật *"thao tác dọn dẹp của hệ thống không được nằm ở tay người dùng"* (§SPEC-canvas).

**Ba tầng, và cần cả ba:**

| | Vì sao không bỏ được |
|---|---|
| Báo cáo **mặc định gấp lại** (`max-h-[4.5rem]`) + nút *Xem đầy đủ* | nhật ký giữ gần như toàn bộ chiều cao ngay khi mở — đó là thứ người ta mở bảng này để xem |
| Báo cáo **trần 40%** kể cả khi mở, cuộn nằm bên trong | vẫn còn 60% cho nhật ký với báo cáo dài nhất |
| Nhật ký có **sàn** `min-h-[8rem]` | trần một mình chưa đủ: khung thấp thì hai bên lại tranh nhau |

> ⚠ **Lúc gấp lại dùng `max-h`, KHÔNG dùng `line-clamp`.** `line-clamp` chạy trên `-webkit-box` và chỉ đáng tin với một dòng chảy văn bản; báo cáo đi qua `Markdown` nên bên trong là nhiều khối block — clamp lúc đó hoặc không cắt gì, hoặc cắt ở chỗ không ai đoán được.

> **LUẬT RÚT RA: trong một cột flex, mỗi khối `flex-none` là một lời hứa rằng nội dung của nó KHÔNG BAO GIỜ dài.** Với nội dung do model sinh thì lời hứa đó luôn sai. Nội dung độ dài không đoán được ⇒ phải có trần + đường cuộn riêng, và khối co giãn phải có sàn.

Báo cáo cũng render qua `Markdown` chứ không in chuỗi trần — nó là chữ Trợ lý viết, có gạch đầu dòng, đường dẫn, đôi khi cả bảng, hệt như trong ô chat.

### 3.2 Danh sách việc `- [ ]` trong markdown (21/08)

Bài 6 sinh ra đúng thứ này (*"gộp thành một checklist ngắn"*), và in nguyên văn thì người dùng nhận về ký tự thay vì một danh sách đọc được bằng mắt. Có ở **cả** ô chat lẫn cửa sổ xem trước file kết quả — dùng chung một `Markdown`.

| Chốt | Vì sao |
|---|---|
| Ô vuông vẽ bằng **CSS**, không phải `<input type="checkbox">` | `<input>` mặc định không nghe bảng màu (hiện xanh hệ điều hành); `disabled` thì hiện xám như một ô đang hỏng |
| **KHÔNG bấm được**, và đó là chủ ý | ngăn Kết quả là cửa sổ **ĐỌC**. Cho bấm là mở một đường ghi thứ hai vào cùng một file, sớm muộn lệch với thứ agent vừa ghi. Cùng lý do tủ tài liệu không có editor |
| `sr-only` nói *"đã xong / chưa xong"* | người khiếm thị phải **nghe** được trạng thái, không chỉ thấy dấu ✓ |
| Việc đã xong **gạch ngang, không làm mờ** | vẫn phải đọc lại được thứ mình đã làm |

⚠ Hai bẫy trong regex, cả hai đã dẫm: bắt buộc **khoảng trắng sau `]`** (thiếu thì `- [x]abc` — một tham chiếu trong văn xuôi kỹ thuật — cũng khớp), và nội dung phải mở đầu bằng **`\S`** chứ không `.` (`.` khớp cả khoảng trắng, nên `- [ ]` kèm vài dấu cách thừa đẻ ra một việc RỖNG; test bắt ca này ở vòng đầu).

---

## 4. Ngăn kéo Tri thức

Trình duyệt đồ thị tri thức. Hai chế độ:

**Danh sách** (mặc định) — bảng: tiêu đề, loại, phạm vi, độ tin, lượt dùng, cập nhật. Lọc theo `shared` / từng role. Tìm kiếm dùng index, 0 token.

**Đồ thị** — node + liên kết, `shared` một màu, mỗi role một màu. Kích thước node theo `hits`. Chỉ hiển thị, không phải công cụ chỉnh sửa.

Node mở ra: markdown render, sửa được tại chỗ, nút `Ghim` (đưa vào charter) và `Bỏ`.

**Nạp tài liệu tay:** kéo-thả file vào ngăn này → chạy một task `librarian` chia nhỏ tài liệu thành các node ≤250 token và gắn tag. Có màn xem trước trước khi ghi — người dùng thấy tài liệu 20 trang biến thành 34 node và duyệt.

---

## 5. Kỹ thuật

- **Web app chạy local**, phục vụ bởi chính daemon tại `:7317`
- **SSE** cho stream sự kiện một chiều (đơn giản hơn WS, đủ dùng; WS chỉ khi cần input hai chiều tần suất cao — hiện không cần)
- Stack: nhẹ nhất có thể. Không SSR, không router phức tạp. **UI không được là thứ ngốn thời gian tuần đầu.**
- **Không có build step phức tạp cho v1.** Ưu tiên bundle một lần, phục vụ tĩnh.
- Không auth ở v1 (bind `127.0.0.1`). Bind `0.0.0.0` (chế độ VPS) → **bắt buộc bật token đăng nhập**, daemon từ chối chạy nếu không.

### Sự kiện SSE

```
plan.created     { plan_id, steps[] }
plan.step        { step_idx, status }
task.started     { task_id, role, say }
task.progress    { task_id, say }
task.done        { task_id, status, say, artifacts[], usage }
task.blocked     { task_id, reason, question? }
master.message   { text }
knowledge.changed{ count, version }
cost.tick        { session_totals }
```

**`say` là trường bắt buộc ở mọi sự kiện hướng người dùng.** Không có `say` → UI không hiện gì. Ràng buộc này ép mọi thứ hiển thị đều đã ở dạng tiếng người ngay từ nguồn.

---

## 6. Chống hoang mang — checklist

Mỗi màn hình phải trả lời được, không cần click:

- [ ] Đang ở bước mấy trên mấy?
- [ ] Ai đang làm gì lúc này?
- [ ] Đã tốn bao nhiêu?
- [ ] Có gì đang chờ tôi không?
- [ ] Muốn dừng thì bấm đâu? → **nút Dừng phải luôn thấy được, không nằm trong menu.**

---

## 7. Ngoài phạm vi v1

- Đa ca làm việc song song (v1: một ca một lúc)
- Nhiều người dùng / phân quyền (đó là hướng doanh nghiệp, xem `ROADMAP.md`)
- Sửa đồ thị bằng kéo-thả node
- Giao diện di động riêng — **Telegram chính là bản di động**
- Theme tuỳ biến
