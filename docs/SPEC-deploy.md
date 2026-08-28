# SPEC — Triển khai: máy cá nhân · Docker · VPS + domain

> Tách ra 28/08/2026 khi bàn mục danh mục Google Calendar. Trước đó những điều này
> nằm rải trong `SPEC-arms.md` §5h·6 · §10d và `SESSIONS_MEMORY` §5o ⑥ · §5s — tức
> **không ai đọc chúng cùng lúc**, mà chúng chỉ hỏng khi đứng cạnh nhau.
>
> Đọc kèm `SPEC-arms.md` (cánh tay · OAuth) · `SPEC-tools-approval.md` §5b (containment).

---

## 1. Trục quyết định là MỘT câu, không phải "Docker hay không"

> **Trình duyệt và daemon có ở cùng một máy không?**

Mọi thứ khác — Docker, nginx, VPS, domain — chỉ là hệ quả của câu đó. Docker **trên máy
khách** không đổi gì; Docker **trên VPS** đổi tất cả. Đừng xếp hai ca đó chung một tên.

| Hình dạng | Cùng máy? | `redirect_uri` |
|---|---|---|
| Chạy trực tiếp trên máy khách | ✅ | `http://127.0.0.1:<cổng>/api/oauth/callback` |
| Docker trên máy khách (map cổng ra host) | ✅ | y hệt trên |
| **Docker trên VPS**, vào bằng SSH tunnel | ✅ *(giả lập)* | y hệt trên — xem §4 |
| **Docker trên VPS + domain công khai** | ❌ | `https://<domain>/api/oauth/callback` |

---

## 2. OAuth theo từng hình dạng × từng hãng

| | Cơ chế đăng ký | Máy khách / Docker cục bộ | VPS + domain |
|---|---|---|---|
| **GitHub** | device flow — **không có `redirect_uri`** | ✅ app của agentco, 0 chìa | ✅ **y hệt** — domain vô can |
| **Notion** (+ Linear · Sentry · Asana · Atlassian) | **DCR** (RFC 7591) — ta khai redirect, hãng nhận tại chỗ | ✅ app tự đăng ký, 0 chìa | ✅ về cơ chế · ⏸ **chưa chạy thật**, xem §6 |
| **Google** | **không DCR, device flow không cấp scope Calendar** | ✅ app của agentco (client **Desktop**) ⏸ *chờ Q1 spike* | ❌ **khách phải tự tạo OAuth client kiểu Web** |

**Vì sao Google là ca duy nhất bắt khách tạo app** — hai luật của Google, nguyên văn:

> *"Redirect URIs must use the HTTPS scheme, not plain HTTP. Localhost URIs (including
> localhost IP address URIs) are exempt from this rule."*
> *"Hosts cannot be raw IP addresses. Localhost IP addresses are exempted from this rule."*

Cộng: không wildcard, khớp **từng ký tự kể cả cổng**. ⇒ Ta không đăng ký trước được
domain của từng khách, và trỏ thẳng vào `http://<ip>:<cổng>` thì **hỏng hai lần** (vừa
`http`, vừa IP trần) — Cloud Console không cho lưu.

📌 **Client kiểu Desktop KHÔNG có ô redirect nào để điền** — 🌐 *"The console does not
require any additional information to create OAuth 2.0 credentials for desktop
applications."* Loopback cổng nào cũng được ⇒ **không có "chọn cổng đẹp/xấu"** ở phía
Google, và không có gì để xung đột. Cổng duy nhất có thật là **cổng daemon của ta** (§5).

---

## 3. Sơ đồ hai container (chốt 28/08 cho VPS)

```
domain ──nginx──┬── /        → container FRONTEND (file tĩnh)
                └── /api/    → container BACKEND (daemon agentco)
```

**Frontend không dính gì tới OAuth.** Điệu nhảy chỉ có: trình duyệt ↔ backend ↔ hãng.

### Ba điều kiện bắt buộc — cả ba là của TA, không phải của hãng

**① `runtime.public_url` phải khai.** Bind ra ngoài mà không khai ⇒ `redirectBase` **từ
chối**, cố ý: `Host` do client gửi nên giả được, mà `redirect_uri` là nơi **mã uỷ quyền**
bay về — thứ duy nhất không được phép đoán. Khai báo đó cũng là thứ mở `hostAllowed`
(`server.ts §hostAllowed`): **một khai báo, hai tác dụng, không có ô thứ hai để lệch.**

**② 🔴 nginx phải route `/api/oauth/callback` về BACKEND.** Chỗ chết dễ nhất của sơ đồ
hai container. Callback là **điều hướng của trình duyệt** tới một path `/api/…`; nếu
frontend đặt SPA fallback nuốt mọi path (`try_files $uri /index.html`) thì mã uỷ quyền
rơi vào `index.html`. **Triệu chứng: "bấm đăng nhập xong quay về trang chủ" — không lỗi,
không log.**

**③ Cổng token đã miễn đúng path đó** (`server.ts §OAUTH_CALLBACK`), vì điều hướng trình
duyệt không mang header — xác thực của callback là `state`. Đã vá 26/08, không phải lo.

> ✅ Tính chất của **giao thức**, không phải may mắn: SSO · Cloudflare Access · VPN ·
> mTLS **không cản** OAuth, vì hãng **không bao giờ gọi vào máy ta**. Chỗ dễ gãy là
> chiều **egress** — và `fetch` của Node **không tự đọc `HTTPS_PROXY`**
> (`NODE_USE_ENV_PROXY=1`).

---

## 4. Đường tunnel — giữ được "0 chìa" cho cả VPS

```
ssh -L 7317:127.0.0.1:7317  user@vps
```

Trình duyệt của người quản trị mở `http://127.0.0.1:7317` → với Google thì `redirect_uri`
**vẫn là loopback** ⇒ **app của agentco dùng được cho cả VPS**: 0 chìa, 0 domain, 0 dòng
đăng ký. Đúng cách `gh` · `gcloud` · `code tunnel` vẫn làm.

Mã hôm nay **đã chạy được đường này**: `redirectBase` kiểm `targetLoopback` trước khi
chặn `http://`, nên `runtime.public_url: http://127.0.0.1:7317` được nhận
(`test/redirect-base.test.ts` có sẵn ca `host: '0.0.0.0'` + `publicUrl` loopback).

### ⏸ Nợ: chọn redirect theo CỬA TRÌNH DUYỆT ĐI VÀO, không theo hằng số cấu hình

Trên VPS thì `public_url` **là domain**, nên đăng nhập qua tunnel vẫn sinh redirect domain
⇒ tunnel vô dụng. Sửa đúng: trình duyệt vào bằng loopback ⇒ redirect loopback; vào bằng
domain ⇒ `public_url`.

Đo bằng **`isLoopback(req.socket.remoteAddress)`** — **địa chỉ socket, không phải `Host`**
(`Host` giả được; địa chỉ socket thì không). Đây là **chỗ thứ ba của cùng một sự thật** đã
dùng cho nút 📂, **không phải cơ chế thứ hai**.

⚠ Điều kiện phải nói với người triển khai: **số cổng tunnel phải khớp** thứ daemon sinh ra
trong `redirect_uri`. Lệch ⇒ `redirect_uri_mismatch`, và câu lỗi đó **không nói ra nguyên
nhân thật** (đã dẫm với Notion 24/08).

---

## 5. 🔴 NỢ DOCKER — bốn món, cả bốn hỏng MUỘN và IM LẶNG

> Xếp theo mức im lặng, không theo mức khó. Món ① là món duy nhất phải trả **trước khi**
> ghi Docker vào tài liệu khuyến nghị cho khách.

### ① Bất biến §1b vỡ tiền đề — ánh xạ đường dẫn host ↔ container

`SPEC-tools-approval` §1b khớp **"chuỗi người dùng vừa gõ"**. User gõ `D:\Downloads\x.md`;
container thấy `/data/downloads/x.md` ⇒ **không bao giờ khớp** ⇒ chặn ghi-ra-ngoài **im
lặng không tồn tại** trong Docker. Đúng hình dạng công tắc `Bash` no-op 6 ngày.

Bất biến phải viết lại: *văn phòng + volume đã mount, và tên user nhìn thấy phải là tên
họ gõ được.* → `SESSIONS_MEMORY` §5o ⑥ (lần thứ tư của lớp lỗi *"đúng trên máy dev, sai ở
chỗ khác"*).

### ② Volume `company/.state/` không persist ⇒ đăng ký app MỚI mỗi lần deploy

`$clients` khoá theo `${issuer}|${redirectUri}`, nằm trên đĩa. Container không mount ⇒ mỗi
lần deploy lại là **một app Notion mới** ⇒ chìa cũ thành `invalid_grant`. Đúng bug 26/08
(`$clients` nằm trong RAM ⇒ hai tài khoản chết), lần này đi vào **qua cửa Docker**.

⚠ **Triệu chứng đến vài giờ sau khi deploy**, nên sẽ không ai nối nó với lần deploy.

### ③ `pending` (state ↔ verifier) nằm trong RAM — `oauth-routes.ts §pending`

Hai ràng buộc **phải viết vào tài liệu triển khai**, không để người ta tự khám phá:
- **đúng 1 replica backend** — 2 replica sau load balancer ⇒ callback rơi vào bản không
  giữ `state` ⇒ hỏng ngẫu nhiên, tỉ lệ hỏng **đúng bằng tỉ lệ chia tải**;
- **đừng restart lúc có người đang đăng nhập** (cửa sổ vài chục giây).

Chấp nhận được vì đăng nhập là việc hiếm và ngắn. Nhưng phải **nói ra**.

### ④ Cánh tay stdio trong image

`npx @modelcontextprotocol/server-filesystem` cần **node/python trong image** + đường ra
npm. Mục *"File trên máy"* chỉ thấy **volume đã mount**. `TEST-WALKTHROUGH` bài 9 **chết**
nếu không mount. → `SPEC-arms.md` §10d

### ✅ Đổi lại, Docker cho không thứ ta đang thiếu

Container chỉ thấy volume đã mount ⇒ ba thứ **chưa dựng nổi bằng hook** (hàng rào đọc ·
chặn `Bash` ghi ra ngoài · che kho chìa) được cấp **bằng kernel**. Đó đúng là containment
mà `SPEC-tools-approval` §5b ghi là ta đang **không** có.

> 📌 *"Khó mò ra project khác"* **không phải điểm yếu — đó là tính năng.** `mount` là
> phiên bản Docker của *"khai thư mục"*, và nó là **hàng rào**, không phải danh sách.

---

## 6. Sổ đăng ký hằng số ĐỐI NGOẠI

> Những chuỗi đã đăng ký **ở phía hãng**, mà ta **không đổi được một mình**. Đổi một dòng
> ở đây mà quên phía kia = hỏng ở chỗ không có log.
>
> Lý do sổ này tồn tại: *URL của hãng chỉ sống trong tài liệu test là một chuông báo* —
> đã dẫm với cửa cài GitHub App (`installations/new` nằm trong walkthrough suốt nhiều
> ngày trong khi sản phẩm **không có cái nút nào**).

| Hằng số | Giá trị | Khai ở đâu trong mã | Ai giữ bản kia |
|---|---|---|---|
| Cổng daemon (mặc định) | **7317** | `types.ts §runtime.port` · mẫu `cli/index.ts` | — (đổi tự do khi chạy loopback) |
| Proxy dev của web | `/api` · `/healthz` → `127.0.0.1:7317` | `web/vite.config.ts` | — |
| Path callback | `/api/oauth/callback` | `server.ts §OAUTH_CALLBACK` | **nginx** của người triển khai |
| GitHub App | `agent-co.app` · org `@agent-co-app` · tạo 26/08/2026 | `arms/github.ts §auth.clientId` | GitHub — **public**, không secret, không private key |
| GitHub `client_id` | `Iv23li95pd8QpYfTGMho` | `arms/github.ts` | GitHub |
| GitHub cửa cài | `github.com/apps/agent-co-app/installations/new` | `arms/github.ts §scope.url` | GitHub |
| GitHub App *Callback URL* | ❓ **chưa ghi lại** | — | GitHub |
| Google OAuth client (agentco) | ⏸ **chưa tạo** | *(sẽ là `arms/google-calendar.ts`)* | Google |
| Google redirect (ca domain) | `https://<domain>/api/oauth/callback` | sinh từ `public_url` | **khách tự dán** vào Cloud Console |

⚠ **Ô "GitHub App *Callback URL*"**: GitHub bắt điền ô này lúc tạo app, nhưng **device
flow không dùng tới nó**. Ghi lại giá trị đã điền để lần sau khỏi tưởng nó có tác dụng —
một ô có giá trị mà không ai đọc là chỗ để hiểu nhầm sinh sôi.

---

## 7. Câu lỗi viết cho NGƯỜI DÙNG, không cho nhà phát triển (user chốt 28/08)

Câu lỗi đo được ở Q7 spike, **nguyên văn** — và nó là mẫu vật tốt vì nó *tử tế với nhà
phát triển*, tức **sai đối tượng** với người dùng của ta:

```
Calendar MCP API has not been used in project 963492906835 before or it is disabled.
Enable it by visiting https://console.developers.google.com/apis/api/calendarmcp.googleapis.com/overview?project=963492906835
then retry. If you enabled this API recently, wait a few minutes for the action to propagate.
```

Tiếng Anh · số hiệu project · `console.developers.google.com`. Người không code đọc xong
**không biết mình phải làm gì**, và tệ hơn: một nửa số người đọc nó **không có quyền** làm
điều nó bảo.

### 🔴 CÙNG MỘT MÃ 403, HAI CÂU KHÁC NHAU — chia theo **chìa đến từ đâu**

| Chìa đúc từ | Project là của | Câu đúng | Câu SAI |
|---|---|---|---|
| **app của agentco** (loopback) | **của ta** | *"Kết nối Google Calendar đang trục trặc ở phía agentco, không phải do bạn. Thử lại sau ít phút."* | mọi câu có chữ *"bật API"* hoặc link Cloud Console — **họ không có quyền vào project đó** |
| **app của khách** (ca domain) | **của họ** | *"Dự án Google của bạn chưa bật Calendar MCP API."* + **một cái nút** mở đúng URL Google đưa | câu chung chung *"lỗi hệ thống"* — họ **có** quyền sửa, giấu là bắt họ mò |

⇒ Nhánh không nằm ở tên hãng mà ở **xuất xứ của `client_id`** (`OAuthAccount.client_id` so
với chìa mặc định trong danh mục) — thứ ta **đã cất từ 27/08** đúng lúc `$clients` cho phép
hai client cùng tồn tại. Không cần cơ chế mới.

⚠ Đây đúng lớp lỗi §5m — *một câu lỗi chỉ sai cửa còn đắt hơn không có câu nào*: nó đọc như
một hướng dẫn, nên người ta **làm theo**, và tiêu thời gian ở một nơi không có gì để sửa.

### Luật chung, áp cho mọi mục danh mục

1. **Không có chuỗi máy nào lọt ra màn hình** — `invalid_grant` · `redirect_uri_mismatch` ·
   `SERVICE_DISABLED` · `-32602` đều phải có bản dịch. Nhánh `other` của `sayError` hôm nay
   vẫn để lọt `error_xyz` — món nợ đã biết.
2. **Tên chìa `GOOGLE_OAUTH_<hex>` là chuỗi nội bộ**, không phải câu cho người dùng. `isAccountName`
   đã tách được hai loại (vá 28/08 cho `pickMcp` + `injectSecrets`); mục Google phải dùng lại,
   đừng để nó khuyên `agentco secret set` cho một tài khoản đăng nhập.
3. **Câu lỗi neo vào MỤC TIÊU của người dùng, không neo vào cái hỏng** (luật 28/08): họ muốn
   *xem lịch tuần này*, không muốn biết endpoint nào 403.
4. **URL lấy từ dữ liệu của mục danh mục**, không ghim trong mã thi hành — cùng khuôn
   `catalog.scope.url` của GitHub ⇒ 0 nhánh tên hãng.

---

## 8. ⏸ CÒN NỢ — kiểm lại từ đây

| | Món | Vì sao chưa đóng |
|---|---|---|
| 🔴 | **§5 ①** ánh xạ đường dẫn Docker | phải trả **trước khi** khuyên khách dùng Docker |
| 🔴 | **§4** chọn redirect theo `isLoopback(socket)` | thiếu nó thì đường tunnel vô dụng trên VPS |
| 🔴 | **Chưa ai chạy thật sau một domain** | 26/08 đi kiểm thì lòi ra **hai chặn cứng của chính ta** (`hostAllowed` từ chối mọi tên miền ⇒ 403 mọi request; cổng token chặn `/api/*` ⇒ 401 ở bước cuối). Cả hai đã vá — **bằng suy luận + test đơn vị**. Thứ chưa được kiểm **không phải Notion**, mà là **cả tầng HTTP của ta**; Notion chỉ là hành khách ⇒ chạy thật một lần là Google hưởng luôn |
| ✅ | ~~Google: Q1 spike~~ | **đã đo 28/08** — Desktop + loopback ✅ · `client_secret` **bắt buộc** ✅ · refresh token ✅ (Google **không xoay**) · danh tính từ `id_token`, 0 lời gọi mạng ✅ |
| 🔒 | **Mục Google GÁC LẠI** (user chốt 28/08) — MCP đòi ghi danh Developer Preview + ~24 900 token/lượt không cắt được | quay lại bằng **connector REST** trên Calendar API v3. Hồ sơ đầy đủ: `SESSIONS_MEMORY` §5u · `SPEC-arms` §4e |
| ⏰ | **Phép đo đang chạy sẵn, đừng bỏ lỡ**: app ở `Testing` ⇒ refresh token phải chết **~04/09/2026** | chạy `--refresh` sau ngày đó để **xác nhận mốc 7 ngày bằng số đo của ta**, trước khi Publish |
| ⏸ | Hồ sơ verification (đường A): trang chủ + **privacy policy cùng domain** + video demo + xác minh domain trong Search Console | trùng khít món *golive* — làm gần cuối, nhưng **bắt đầu sớm vì tốn thời gian CHỜ** |
| ⏸ | Điền ô *GitHub App Callback URL* vào §6 | |
| ⏸ | Dockerfile + compose mẫu (2 container + volume `.state` + route `/api`) | chưa viết dòng nào |
