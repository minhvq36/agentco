/**
 * MỘT MỤC DANH MỤC = MỘT FILE. → `../catalog.ts` · docs/TEST-WALKTHROUGH.md bài 18
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MỤC DUY NHẤT KHÔNG CẦN BÊN KIA HỢP TÁC.                                  │
 * │                                                                          │
 * │ Mọi mục khác đòi hãng kia có API và chịu cấp chìa. Mục này chạy với **bất │
 * │ kỳ hệ thống nào có giao diện web** — kể cả phần mềm nội bộ 15 năm tuổi    │
 * │ không có API, thứ `SPEC-connectors` không với tới được vì nó cần một API  │
 * │ để mô tả. Đây là câu trả lời cho câu khách hỏi nhiều nhất: *"hệ thống của │
 * │ tôi không có API thì sao?"*                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { CatalogArm } from '../catalog.js';

/**
 * ⚠ GHIM PHIÊN BẢN, KHÔNG `@latest`. → SPEC-arms.md §11d
 *
 * 🔴 VÀ ĐÂY LÀ MỘT CÁI BẪY ĐỌC SỐ, ghi lại để lần sau không ai dẫm:
 * lúc bắt tay, server tự khai `version: "1.63.0-alpha-2026-08-05"` và tôi suýt
 * kết luận *"`@latest` trả về bản alpha"*. **Sai.** `dist-tags.latest` của gói là
 * **`0.0.79`, bản ổn định**; chuỗi `1.63.0-alpha` là phiên bản **lõi Playwright**
 * mà gói đó nhúng. Hai con số khác nhau hiện ở cùng một chỗ.
 *
 * 📌 Thứ đáng mang theo: **gói ổn định đang nhúng một lõi alpha.** Không phải lỗi,
 * nhưng phải biết trước khi hứa với khách chữ "ổn định".
 */
const PLAYWRIGHT_MCP_PKG = '@playwright/mcp@0.0.79';

export const BROWSER_ARM: CatalogArm = {
  id: 'browser',
  /**
   * ⚠ TÊN ĐẶT THEO VIỆC, KHÔNG THEO HÃNG — đúng cách "File trên máy" đang làm.
   *
   * Hai lý do, và lý do thứ hai là lý do chốt:
   * ① người không biết code **không biết Playwright là gì**, nên tên hãng vừa vô
   *    nghĩa với họ vừa làm thẻ khó đọc;
   * ② nợ nhãn hiệu §11c **biến mất**: ta không dùng tên lẫn logo của Microsoft ở
   *    mặt trước, nên không có gì phải xin phép. Tên gói chỉ nằm trong Nâng cao.
   */
  name: 'Trình duyệt web',
  icon: '🌐',
  /** Giao diện vẽ quả địa cầu thay vì phích cắm. → ArmIcon.tsx */
  shape: 'browser',
  /**
   * Hai câu, hai việc khác nhau, và cả hai đều sinh ra từ tiền thật:
   *
   * ① *"không chờ được thao tác tay"* — bất khả thi về **cấu trúc** (vòng đời
   *    trình duyệt = vòng đời một lượt việc), nên phải nói ra **trước khi** lập
   *    kế hoạch. Đo 29/08: một lượt như thế tốn **$0,0473** rồi báo không làm được.
   * ② *"trang công khai thì dùng WebFetch/WebSearch"* — user chốt 29/08:
   *    *"cái nào xài webSearch/webFetch được thì xài, để người dùng đỡ tưởng cắm
   *    trình duyệt thì xịn hơn"*. Số đo đứng về phía đó: một `snapshot` trang tin
   *    ≈47 000 token, còn WebFetch rẻ hơn nhiều lần.
   */
  /**
   * ⚠ VẾ THỨ BA THÊM 30/08 — ca thật, và nó là chỗ rò DUY NHẤT không hàng rào
   * nào bịt được.
   *
   * Nhân viên mở `facebook.com`, hồ sơ Chrome **tự điền sẵn** email thật của
   * người dùng vào ô đăng nhập, và nhân viên chép nguyên vào artifact:
   * *"Ô 'Email address or mobile number' đã có sẵn giá trị điền trước: …"*.
   * Từ đó nó đi tiếp vào ngữ cảnh Trợ lý, rồi thành một brief tra cứu Linear
   * theo đúng email đó — một câu trả lời gần đúng, tự tin, và sai.
   *
   * 🔴 Vì sao KHÔNG vá được bằng `redact.ts` hay `guardedZone`: dữ liệu này đi
   * vào nhân viên qua **kết quả tool inline** của `browser_snapshot`, không qua
   * file. Không có file nào để cắt, không có đường dẫn nào để chặn. Chỗ duy
   * nhất còn đứng được là **câu dặn ngay trên dòng của cánh tay**.
   * ⇒ Giảm thiểu, không bịt kín — đúng như `redact.ts` đã tự khai về chính nó.
   */
  hint:
    'trang công khai dùng WebFetch/WebSearch cho rẻ; trình duyệt để dành cho trang cần ' +
    'đăng nhập hoặc phải bấm/điền. Không chờ được người dùng thao tác giữa lượt — muốn đăng ' +
    'nhập tay thì bảo họ bấm "Đăng nhập vào một trang". Giá trị tự-điền sẵn trong ô form là ' +
    'của trình duyệt, không phải nội dung trang: đừng chép vào file.',
  /**
   * ⚠ CÂU NÀY PHẢI NÓI RA BA THỨ, và cả ba đều dễ bị giấu đi cho gọn:
   *
   * ① Nó **mở trang trên máy chạy agentco**, không phải trên máy người đang xem.
   * ② Mặc định phiên **không được giữ** — mỗi lượt là một trình duyệt sạch, nên
   *    trang cần đăng nhập sẽ **không** vào được cho tới khi bật chế độ giữ phiên.
   * ③ Nội dung web là **chữ của người lạ**. Nhân viên đọc rồi hành động, nên một
   *    trang có thể cố dắt nó đi chỗ khác — thứ không cắt bằng cấu hình được.
   */
  blurb:
    'Mở và đọc trang web như một người dùng thật — kể cả hệ thống nội bộ không có API. ' +
    'Mặc định dùng trình duyệt sạch, không giữ đăng nhập, và chạy ẩn (không hiện cửa sổ).',
  price: 'none',
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ HAI CỜ NÀY LÀ **LẬT NGƯỢC MẶC ĐỊNH CỦA HÃNG**, cố ý.                     │
   * │                                                                          │
   * │ `--headless`  Playwright mặc định **headed**. Nhân viên chạy nền mà cửa   │
   * │               sổ bật lên giữa lúc người ta đang làm việc khác là một sản  │
   * │               phẩm mất lịch sự. Và trên VPS thì headed **không tồn tại**. │
   * │               ⚠ Ô "hiện cửa sổ" chỉ được phép hiện khi trình duyệt và     │
   * │               daemon **cùng máy** — đo bằng `isLoopback(socket)`, KHÔNG   │
   * │               bằng `Host` (giả được). Cùng cổng đã dùng cho nút 📂. Bấm ở │
   * │               Hà Nội mà cửa sổ bật trên server Singapore là bug đã dẫm.   │
   * │                                                                          │
   * │ `--isolated`  profile nằm trong RAM, không chạm đĩa ⇒ không để lại phiên  │
   * │               đăng nhập của khách. Muốn giữ phiên thì phải khai           │
   * │               `--user-data-dir` **một cách tường minh**, và lúc đó bán     │
   * │               kính rộng bằng mọi trang đã đăng nhập trong profile đó.     │
   * │                                                                          │
   * │ Cả hai nằm trong `args` ⇒ **vào băm** ⇒ đổi là **một cánh tay khác**, và  │
   * │ model không nhìn thấy chúng, không đổi được giữa chừng.                   │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 `--browser` LÀ MỘT QUYẾT ĐỊNH VỀ DUNG LƯỢNG ĐĨA, không phải khẩu vị.  │
   * │ (user dặn 29/08: *"hạn chế tải về làm đầy bộ cứng"*)                     │
   * │                                                                          │
   * │ Không khai ⇒ Playwright dùng **bản đóng gói của nó** và **tải về**:       │
   * │   `chromium_headless_shell` **269 MB** · bản đủ **415 MB**               │
   * │ và **bản cũ không bao giờ tự bị dọn** — máy đo 29/08 có **1 340 MB** với  │
   * │ hai bộ (04/2026 và 07/2026) nằm cạnh nhau.                                │
   * │                                                                          │
   * │ Khai một **channel** ⇒ dùng trình duyệt **đã cài sẵn** ⇒ **0 byte**.      │
   * │   win32  `msedge` — Windows 10+ nào cũng có, không phải cài gì            │
   * │   darwin `chrome` — không có sẵn theo máy, nhưng là thứ gần chắc nhất     │
   * │   linux  **không khai** — desktop Linux hiếm khi có sẵn cái nào; còn trên │
   * │          server thì đường đúng là **image Docker chính chủ**, nơi         │
   * │          Chromium đã nằm trong image (→ `SPEC-deploy.md` §2)              │
   * │                                                                          │
   * │ ⚠ Đổi lại: máy **không có** channel đó thì hỏng — nhưng hỏng **nhìn thấy  │
   * │ được** (câu lỗi nói tên trình duyệt thiếu), thắng kiểu hỏng im lặng là    │
   * │ ngốn 400 MB đĩa của khách mà không ai hỏi họ một câu.                     │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * `--output-max-size`: mỗi lần `browser_navigate` **tự ghi snapshot ra file**
   * (đo 29/08 — đó là lý do navigate chỉ ~118 token thay vì ~47 000). Rất tốt cho
   * ngữ cảnh, nhưng nó **lớn dần mãi**. Trần này là thứ biến một cái cache thành
   * một cái cache **có đáy** — đúng chỗ user chốt: *"cache không tệ nếu một trang
   * ra vào thường xuyên"*, miễn là nó không nuốt đĩa.
   * ✅ ĐÍNH CHÍNH 29/08 — **món nợ `--output-dir` KHÔNG TỒN TẠI.** Worker chạy với
   * `cwd` = thư mục văn phòng, nên Playwright đẻ `.playwright-mcp/` **ngay trong
   * văn phòng**: tự đúng chỗ, tự tách theo văn phòng, **0 dòng mã**.
   * Bằng chứng: `company/offices/canh-tay/.playwright-mcp/` — 26 file, 0,25 MB.
   * Lần trước tôi thấy nó nằm trong repo là vì **spike chạy từ gốc repo**, tức tôi
   * đọc `cwd` của phép đo thành `cwd` của sản phẩm.
   * → [[agentco-measurement-vs-conclusion]]
   *
   * 🔴 NHƯNG THƯ MỤC ẤY CHỨA `console-*.log`, VÀ LOG CONSOLE CÓ TOKEN PHIÊN.
   * Đọc thật một file: URL của Facebook trong đó mang `fb_dtsg=…` và
   * `__user=100005161517189`. Đó là **chìa phiên đăng nhập nằm dưới dạng chữ**,
   * trong thư mục văn phòng — nơi nhân viên đọc được. Chưa vá.
   *
   * 🔴 HỆ QUẢ PHẢI BỊT: `tools/list` trả đủ 24 việc **mà chưa khởi động trình
   * duyệt nào** (đo 29/08). Nên một probe chỉ-liệt-kê sẽ báo ✓ **xanh giả** trên
   * máy không có trình duyệt dùng được, và người dùng chỉ biết khi giao việc thật.
   * ⇒ Probe của mục này **phải gọi một tool có mở trình duyệt**. → bài 18 ô A-4
   */
  spec: {
    kind: 'stdio',
    command: 'npx',
    /**
     * ⚠ `--headless` và `--isolated` nằm ở ĐÂY, còn hai ô tick thì **GỠ** chúng ra
     * (`ArmOption.remove`). Viết ngược lại — base trần, ô tick thêm vào — thì
     * trạng thái an toàn phải do người dùng **nhớ bật**, mà mặc định an toàn thì
     * không được phụ thuộc vào trí nhớ của ai.
     */
    args: ['-y', PLAYWRIGHT_MCP_PKG, '--headless', '--isolated', '--output-max-size', '52428800'],
    argsByOs: {
      win32: ['--browser', 'msedge'],
      darwin: ['--browser', 'chrome'],
    },
  },
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BA CHẾ ĐỘ, VÀ NGƯỜI DÙNG PHẢI THẤY MÌNH CHỌN CÁI NÀO. (user chốt 29/08)  │
   * │                                                                          │
   * │ Hai chế độ sau mở đúng thứ mà **cả OAuth lẫn connector đều không chạm     │
   * │ tới**: hệ thống nội bộ không có API, không có OAuth, chỉ có một ô đăng    │
   * │ nhập. Khách tự tay đăng nhập **một lần** trong cửa sổ thật, phiên nằm     │
   * │ trong hồ sơ của **văn phòng đó**, rồi nhân viên dùng lại — và từ lần sau  │
   * │ chạy ẩn được.                                                            │
   * │                                                                          │
   * │ ⚠ Đổi lại, bán kính rộng bằng **mọi trang đã đăng nhập trong hồ sơ đó**.  │
   * │ Nên `help` của hai chế độ sau phải nói ra điều đó bằng tiếng người, chứ   │
   * │ không tả cấu hình.                                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  options: [
    {
      id: 'nho-dang-nhap',
      label: 'Nhớ đăng nhập',
      /**
       * ⚠ BẬT SẴN, và đó là một quyết định ngược trực giác "mặc định phải hẹp".
       *
       * Hồ sơ này là hồ sơ **riêng của agentco, sinh ra RỖNG** — không phải trình
       * duyệt cá nhân của người dùng. Nên bật sẵn **không mở rộng bán kính ngay**:
       * nó chỉ lớn lên đúng bằng những lần **chính người dùng tự đăng nhập** vào
       * đó. Còn tắt đi thì mỗi lượt vứt sạch cả cache — tốn mạng, tốn thời gian,
       * và trang cần đăng nhập thì vĩnh viễn không vào được.
       */
      on: true,
      /**
       * 🔴 CÂU CŨ HỨA QUÁ TAY, user bắt được 29/08: *"cookie của trình duyệt chính
       * khó mà truyền sang đấy, chưa kể người dùng dùng cả edge và chrome"*.
       *
       * Đúng. `--user-data-dir` mở một **hồ sơ RIÊNG, trống trơn** — nó KHÔNG thừa
       * kế đăng nhập sẵn có trong Chrome/Edge của người dùng (và không có cách nào
       * thừa kế: hồ sơ đang mở bị khoá, cookie thì mã hoá theo hồ sơ). Câu cũ
       * *"giữ lại những trang bạn đã đăng nhập"* đọc thành *"dùng lại đăng nhập
       * của tôi"* — hứa một thứ không tồn tại, đúng lớp lỗi §11a-bis: **hứa quá
       * tay tệ hơn doạ quá tay**.
       */
      help:
        'Mở một hồ sơ riêng của agentco (trống lúc đầu, KHÔNG dùng lại đăng nhập ' +
        'sẵn có trong Chrome/Edge của bạn). Bật kèm "hiện cửa sổ" để tự đăng nhập ' +
        'một lần, từ đó nhân viên vào thẳng.',
      /** Hồ sơ bền và "profile nằm trong RAM" loại trừ nhau — gỡ cái kia ra. */
      remove: ['--isolated'],
      dirs: [{ flag: '--user-data-dir', sub: 'profile' }],
    },
    {
      id: 'hien-cua-so',
      label: 'Hiện cửa sổ trình duyệt',
      help:
        'Mở cửa sổ thật để bạn nhìn thấy nhân viên đang làm gì — và để tự đăng nhập lần đầu ' +
        'vào những trang cần tài khoản.',
      /** "Hiện cửa sổ" chính là **sự vắng mặt** của `--headless`. → `ArmOption.remove` */
      remove: ['--headless'],
      /**
       * Cửa sổ mở trên **máy chạy daemon**. Xem giao diện từ máy khác mà tick ô
       * này thì cửa sổ bật ở nơi không ai nhìn — đúng con bug nút 📂 (*"bấm ở Hà
       * Nội, cửa sổ bật trên server Singapore"*). Cùng cổng, chỗ thứ tư.
       */
      loopbackOnly: true,
    },
  ],
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 KHÔNG CHIA NẤC — và đây là kết luận của một phép đo, không phải lười.  │
   * │ (user chạy thật 29/08, đúng ô C-1 bài 18 đã dự đoán)                     │
   * │                                                                          │
   * │ `browser_navigate` khai `destructive: true` (cùng `click`, `type`), nên  │
   * │ `tierOf` xếp nó vào `full`. Hệ quả ở nấc mặc định `read`: `scopedTools`  │
   * │ cấp đúng 7 việc — `snapshot · find · screenshot · network · console ·    │
   * │ wait` — **không có việc nào mở được trang**. Triệu chứng user gặp:       │
   * │                                                                          │
   * │   *"Claude requested permissions to use mcp__…__browser_navigate,        │
   * │    but you haven't granted it yet"*                                     │
   * │                                                                          │
   * │ ⇒ Một trình duyệt không đi tới đâu được **không phải nấc thấp, nó là đồ  │
   * │ hỏng**. Và không sửa được bằng cách hạ `navigate` xuống `read`: luật một │
   * │ chiều (25/08) cấm hạ cấp, và cấm đúng — mở một URL **có** tác dụng phụ.  │
   * │                                                                          │
   * │ 📌 Cái MẤT, ghi để cân lại được: không có bản "chỉ xem". Thứ thay thế là │
   * │ `neverTools` (cắt hai việc chạy JS tuỳ ý) — hàng rào theo **việc**, không│
   * │ theo **nấc**. Muốn nấc thật thì phải khai nhóm việc bằng dữ liệu như     │
   * │ GitHub, và đó là việc của bản sau.                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  tiered: false,
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ HAI VIỆC KHÔNG BAO GIỜ ĐƯỢC CẤP — kể cả nấc toàn quyền. → `catalog.ts`   │
   * │                                                                          │
   * │ Cả hai chạy **JavaScript tuỳ ý** trong trang. Annotations của chúng khai  │
   * │ đúng (`destructive: true`) nên `tierOf` xếp vào `full` — hợp lệ, và không │
   * │ đủ: *"toàn quyền"* nghĩa là **được ghi**, không nghĩa là **được chạy mã   │
   * │ tuỳ ý dưới phiên đăng nhập của bạn**. Một trang độc dắt được nhân viên     │
   * │ gọi `browser_evaluate` là dắt được nó làm mọi thứ trang đó làm được.      │
   * │                                                                          │
   * │ ⚠ Danh sách này CHỈ CẮT ⇒ không đụng luật một chiều (25/08). Và nó là     │
   * │ **ảnh chụp lúc cắm**: hãng thêm một tool nguy hiểm mới thì nó không tự     │
   * │ biết — cùng giới hạn đã ghi cho `readOnly`.                               │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  neverTools: ['browser_run_code_unsafe', 'browser_evaluate'],
  /** Rỗng — mục này không có chìa nào. Đó là toàn bộ điểm của `price: 'none'`. */
  secrets: [],
  /**
   * ⚠ `mark` BỎ TRỐNG, và đó là một quyết định chứ không phải một ô chưa điền.
   *
   * §11c chốt: chưa đọc quy tắc thương hiệu thì không dùng logo. Ở đây ta **không
   * cần** logo — tên mục đã đặt theo việc, nên không có bề mặt nào dùng tới nhãn
   * hiệu của Microsoft. Giao diện vẽ hình theo LOẠI, y như "File trên máy".
   * ⇒ Mục này ra mắt với **nợ thương hiệu bằng 0**, không phải nợ hoãn lại.
   */
  brand: { owner: 'Microsoft Corporation', guidelineUrl: null, checkedOn: null },
};
