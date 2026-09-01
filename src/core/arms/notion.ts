/**
 * MỘT MỤC DANH MỤC = MỘT FILE. → `../catalog.ts` · docs/SPEC-arms.md §4e
 *
 * ⚠ Notion KHÔNG còn đi qua `npx` nữa, và sự vắng mặt đó là một quyết định (25/08).
 *
 * Bản cũ ghim `@notionhq/notion-mcp-server@2.5.1` — gói **local, chính chủ**.
 * Nhưng chính chủ đã buông nó: 🌐 *"We may sunset this local MCP server
 * repository"* + *"issues and pull requests here are not actively monitored"*.
 *
 * ⇒ Bài học đáng giữ cho mọi mục về sau: **ghim phiên bản ≠ được bảo trì.**
 * §11d ghim để mã người lạ không tự đổi dưới chân khách; nó không cứu được ta
 * khỏi việc đóng băng một thứ không còn ai vá lỗi.
 */

import type { CatalogArm } from '../catalog.js';

export const NOTION_ARM: CatalogArm = {
  id: 'notion',
  name: 'Notion',
  icon: '📝',
  /**
   * ⚠ CÂU NÀY PHẢI NÓI RA BÁN KÍNH, và nó nói ngược với trực giác. → §5h·3
   *
   * OAuth của Notion **thừa kế TOÀN BỘ quyền của người đăng nhập**: 🌐
   * *"MCP tools act with your full Notion permissions"*, và metadata khai
   * `scopes_supported: ["default"]` — **một** scope, không chia nhỏ được.
   *
   * Tức nó **RỘNG HƠN** token tĩnh, thứ mặc định không thấy gì cho tới khi
   * người dùng tự thêm connection vào từng trang. Giấu chuyện này đi là
   * **hứa quá tay**, và §11a-bis đã chốt: *doạ quá tay làm người dùng tắt
   * thứ họ cần; hứa quá tay làm họ bật để mua một thứ không tồn tại — cái
   * sau tệ hơn*. "chỉ đọc" ở đây là do TA cắt (nấc quyền), không phải do
   * Notion cấp hẹp.
   */
  blurb: 'Tìm, đọc và (nếu bạn cho phép) ghi vào các trang Notion mà tài khoản của bạn xem được.',
  price: 'login',
  /**
   * MCP **hosted chính chủ**, Streamable HTTP. Ba thứ nó bỏ so với bản cũ:
   * không tải mã người lạ về máy khách (rủi ro chuỗi cung ứng §11d = **0**),
   * không `npx` trên đường nóng, và không phụ thuộc một gói đã bị buông.
   *
   * ⚠ `${OAUTH}` là **chỗ trống có tên quy ước**, không phải tên chìa thật.
   * `buildConfig` thay nó bằng tên tài khoản người dùng vừa đăng nhập
   * (`NOTION_OAUTH_<8 hex workspace_id>`) — nhờ đó **hai workspace Notion ra
   * hai băm khác nhau** dù cùng URL. → §OAUTH_SLOT · `oauth.ts §accountName`
   *
   * Sau khi thay, `company.yaml` chứa một ô trống bình thường: người dùng ĐỌC
   * ĐƯỢC chìa đi vào đâu mà không đọc được chìa. → `secrets.ts §injectSecrets`
   */
  spec: {
    kind: 'http',
    url: 'https://mcp.notion.com/mcp',
    headers: { Authorization: 'Bearer ${OAUTH}' },
  },
  /**
   * Ba nấc, giải từ `annotations` lúc cắm. Đo 25/08: 28 việc — **14 đọc · 11
   * thêm · 3 sửa/xoá**, và 28/28 đều khai annotations.
   *
   * ⚠ Thay cho `readOnly: true` của bản 25/08. Bản đó đúng nhưng **cứng**:
   * người dùng muốn Notion ghi được thì không có đường nào ngoài sửa yaml —
   * một **chuông báo §6a**. Nấc là thứ họ chọn, và nó vào băm nên "đổi nấc"
   * là một cánh tay khác chứ không phải một lần sửa tại chỗ. → §6j
   *
   * 📌 KHÔNG có `readOnlyHeaders`: Notion không cắt việc theo header, nên nấc
   * `read` được thi hành bằng lớp `allowedTools` của ta. Đó cũng là lý do mục
   * này **không dính** cái bẫy §6g-quater (hàng rào ăn mất bộ chọn nấc).
   */
  tiered: true,
  /**
   * RỖNG — và đó là toàn bộ điểm của `price: 'login'`.
   *
   * Chìa của mục này **sinh ra từ luồng đăng nhập**, không do người dùng gõ.
   * Tên nó cũng không biết trước được (nó mang `workspace_id`), nên khai ở đây
   * là khai một chuỗi sẽ sai.
   */
  secrets: [],
  /**
   * ⚠⚠ `checkedOn: null` mà `mark` CÓ GIÁ TRỊ = **món nợ đang mở**. → §11c
   *
   * §11c chốt: chưa đọc quy tắc thương hiệu thì không dùng logo. User yêu cầu
   * logo hãng ngày 27/08 (*"cố gắng chọn icon của provider"*) và ta đã ship —
   * nên món nợ phải **nằm ngay cạnh thứ nó nói về**, chứ không nằm trong một
   * bảng ánh xạ ở thư mục web nơi không ai đi qua khi rà thương hiệu.
   *
   * Đường dẫn là dấu chữ N đơn sắc, `currentColor`, không nền, không màu hãng.
   * Phải điền `guidelineUrl` + `checkedOn` trước khi phát hành ra ngoài.
   */
  brand: {
    owner: 'Notion Labs, Inc.',
    guidelineUrl: null,
    checkedOn: null,
    // ⚠ MỘT CHUỖI, KHÔNG NỐI — xem lý do ở `github.ts §brand.mark`.
    // prettier-ignore
    mark: 'M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.727l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z',
  },
};
