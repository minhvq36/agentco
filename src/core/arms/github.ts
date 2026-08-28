/**
 * MỘT MỤC DANH MỤC = MỘT FILE. → `../catalog.ts` · docs/SPEC-arms.md §5h
 *
 * Mục "custom nhiều nhất" trong danh mục — device flow, nhóm việc, hàng rào
 * server, cửa cài app, phép tra bản cài. Tất cả đều là **dữ liệu ở file này**;
 * không có nhánh `if (id === 'github')` nào ở bất kỳ đâu trong mã.
 */

import type { CatalogArm } from '../catalog.js';

export const GITHUB_ARM: CatalogArm = {
  id: 'github',
  name: 'GitHub',
  icon: '🐙',
  /**
   * ⚠ CÂU NÀY PHẢI NÓI RA BA THỨ, và cả ba đều dễ bị giấu đi cho đẹp:
   *
   * ① **Nó không phải `git`.** Không clone, không pull, không push, không bản
   *    sao trên máy — sửa file là **commit thẳng lên repo cloud**. Đó là một
   *    mô hình làm việc khác, không phải một phiên bản gọn của `git`.
   * ② **Commit mang tên người đăng nhập** (đo 26/08: tác giả là chính tài
   *    khoản cấp quyền, không phải một bot). Lịch sử repo của họ sẽ có commit
   *    mang tên họ mà **không phải họ gõ**.
   * ③ Nó với tới **repo private**, nhưng chỉ những repo họ **cài app vào**.
   *
   * ⚠ ĐÍNH CHÍNH 27/08 — câu *"chỉ chạm được repo bạn cài agentco vào"* (viết
   * sáng cùng ngày) **SAI VỚI REPO CÔNG KHAI**. Đo được: `list_branches` chạy
   * trên **cả 16** repo trong khi app chỉ cài **2**. Chìa `ghu_` đọc repo công
   * khai bất kể bản cài — bản cài chỉ gác repo **riêng tư**. Nói quá về hàng
   * rào là một kiểu nói dối tệ hơn nói thiếu.
   */
  blurb:
    'Đọc và sửa file trong repo GitHub — kể cả repo riêng tư. Sửa là commit thẳng lên GitHub, ' +
    'không tải repo về máy. Repo riêng tư chỉ với tới được nếu bạn cài agentco vào.',
  price: 'login',
  /**
   * 🔴 `auth` tồn tại vì GitHub **không mở DCR** (đo 25/08, xác nhận lại
   * 26/08). Nhưng "không DCR" **không** kéo theo "khách phải tự đăng ký app" —
   * đó là bước suy sai đã ghi ở §4e. Device flow không cần bí mật nào, nên
   * agentco đứng tên một app và ship `client_id` như dữ liệu.
   *
   * GitHub App `agent-co.app` · org `@agent-co-app` · tạo 26/08/2026.
   * 📌 **KHÔNG có client secret. KHÔNG có private key.** Luật + lý do đầy đủ:
   * SPEC-arms §5h·7h. Không có key ⇒ **không tồn tại** đường mint installation
   * token ⇒ chủ app không có cửa nào với tới repo của khách. Cấm bằng cấu
   * trúc, không bằng kỷ luật — cùng khuôn bất biến §5b.
   *
   * Khách doanh nghiệp đứng tên app của họ được: ô "dùng GitHub App của riêng
   * bạn" ghi đè `clientId` này. → `oauth-routes.ts §deviceClientId` · §5h·7h
   */
  auth: { kind: 'device', clientId: 'Iv23li95pd8QpYfTGMho' },
  /** GitHub không trả danh tính trong phản hồi token ⇒ phải hỏi. → §5h·7k */
  identity: {
    url: 'https://api.githubcopilot.com/mcp/x/context',
    tool: 'get_me',
    // `id` chứ không phải `login`: người dùng đổi tên tài khoản được, và một
    // hạt giống băm đổi được nghĩa là cánh tay tự nhân đôi sau khi đổi tên.
    idField: 'id',
    labelField: 'login',
  },
  spec: {
    kind: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: 'Bearer ${OAUTH}' },
    toolsetHeader: 'X-MCP-Toolsets',
    readOnlyHeaders: { 'X-MCP-Readonly': 'true' },
  },
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ NĂM NHÓM VIỆC — TÊN NHÓM LÀ TÊN CỦA HÃNG, KHÔNG PHẢI TÊN TA NGHĨ RA.     │
   * │ (user bắt 28/08)                                                         │
   * │                                                                          │
   * │ > *"Cái check đầu tiên: 'Biết tôi là ai, repo nào' tôi nghe không hiểu.  │
   * │ >  Thà để ngôn ngữ chuyên ngành như issue, action còn dễ hiểu hơn"*      │
   * │                                                                          │
   * │ Nhãn cũ cố dịch `context` sang tiếng người và dịch **sai bán kính**: nó   │
   * │ hứa *"biết repo nào"* trong khi `context` chỉ có `get_me` · `get_teams` · │
   * │ `get_team_members` — **không một tool nào về repo**. Vừa khó hiểu vừa    │
   * │ không đúng.                                                              │
   * │                                                                          │
   * │ ⇒ Luật cho mọi mục về sau: **giữ tên nhóm của hãng** (người dùng tra được│
   * │ nó trong tài liệu hãng), rồi **thêm một câu `help` nói VIỆC LÀM ĐƯỢC** — │
   * │ chứ không thay tên hãng bằng một câu mô tả. Tên là địa chỉ; mô tả là mô  │
   * │ tả. → [[agentco-count-mechanisms]]                                       │
   * │                                                                          │
   * │ Số token đo 26/08 (ước lượng byte÷4, dùng để SO các lát cắt — số lên     │
   * │ giao diện phải là `getContextUsage()`):                                   │
   * │   context 3 việc ≈1 500 · repos 19 ≈10 000 · pull_requests 10 ≈8 300     │
   * │   issues 9 ≈8 000 · actions ?  ·  CẢ SERVER 44 ≈30 000                   │
   * │ ⇒ mặc định `context + repos` ≈11 600, và ở nấc chỉ đọc còn ≈8 500.       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  groups: [
    {
      id: 'context',
      label: 'Tài khoản & tổ chức',
      help: 'Nhân viên biết bạn là ai trên GitHub, ở trong tổ chức và nhóm nào. Không đụng tới repo.',
      on: true,
    },
    {
      id: 'repos',
      label: 'Repo & file',
      help: 'Duyệt repo, đọc file, xem nhánh và commit. Ở nấc toàn quyền thì tạo và sửa file được.',
      on: true,
    },
    {
      id: 'pull_requests',
      label: 'Pull request',
      help: 'Xem, bình luận, tạo và gộp pull request.',
    },
    { id: 'issues', label: 'Issue', help: 'Xem, tạo, gán người và đóng issue.' },
    {
      id: 'actions',
      label: 'Actions / CI',
      help: 'Xem lượt chạy workflow, đọc log, chạy lại một lượt hỏng.',
    },
  ],
  tiered: true,
  /**
   * ⚠ `installations/new` chứ không phải trang app: với người ĐÃ cài, GitHub
   * tự chuyển hướng sang màn hình sửa lựa chọn repo. Một URL phục vụ cả hai
   * ca — cài lần đầu và đổi về sau — nên không cần nhánh "đã cài chưa", thứ
   * ta **không đọc được** từ phía này.
   *
   * 📌 App đã bật **public** (user xác nhận 27/08). Để private thì chỉ tài
   * khoản chủ cài được, và khách bấm nút này vào ngõ cụt — một kiểu hỏng
   * không có triệu chứng nào ở phía ta. Rà lại mỗi lần đụng mục GitHub.
   */
  scope: {
    say: 'Chọn repo trên GitHub',
    url: 'https://github.com/apps/agent-co-app/installations/new',
    help:
      'Phạm vi repo do GitHub giữ, không phải agentco. Thêm hoặc bớt repo ở đó là có hiệu lực ' +
      'ngay ở lời gọi kế tiếp — không phải cắm lại.',
  },
  /**
   * ⚠⚠ `gateTool` PHẢI là `list_repository_collaborators`, không phải một tool
   * đọc nào khác. Số đo 27/08, đối chứng là bản cài thật của user (2 repo):
   *
   *   list_branches                  ✅✅✅✅  ← MÙ, luôn trả lời CÓ
   *   get_file_contents              ✅✅✅✅  ← MÙ
   *   list_repository_collaborators  ❌✅✅❌  ← PHÂN BIỆT ĐÚNG 4/4
   *
   * Nó đòi quyền **push**, thứ chỉ có ở repo đã cài app. Đổi sang tool khác
   * là biến phép tra thành một cái gật đầu vô điều kiện.
   */
  repoScan: {
    meTool: 'get_me',
    loginField: 'login',
    searchTool: 'search_repositories',
    searchQuery: 'user:${login}',
    gateTool: 'list_repository_collaborators',
  },
  /** Rỗng — chìa sinh từ luồng đăng nhập, y hệt Notion. → `price: 'login'` */
  secrets: [],
  /**
   * ⚠⚠ `checkedOn: null` mà `mark` CÓ GIÁ TRỊ = **món nợ đang mở**. → §11c
   *
   * Xem khối cùng tên ở `notion.ts`. Đường dẫn là dấu Octocat đơn sắc,
   * `currentColor`, không nền, không màu hãng. GitHub **có** trang quy tắc
   * (github.com/logos) — phải đọc rồi điền `guidelineUrl` + `checkedOn` trước
   * khi phát hành ra ngoài.
   */
  brand: {
    owner: 'GitHub, Inc.',
    guidelineUrl: null,
    checkedOn: null,
    // ⚠ MỘT CHUỖI, KHÔNG NỐI. Cắt một đường dẫn SVG thành nhiều mảnh rồi nối là
    // mua một ca hỏng im lặng: nuốt đúng một dấu cách ở chỗ nối (`3 .405` thành
    // `3.405`) là hình vẽ méo, và không có test nào bắt được hình méo.
    // prettier-ignore
    mark: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
};
