/**
 * MỘT MỤC DANH MỤC = MỘT FILE. → `../catalog.ts` · docs/SPEC-arms.md §4e
 *
 * File này là **dữ liệu**, không phải mã: không hàm, không nhánh, không import
 * gì ngoài kiểu. Sửa mục này thì chỉ mở file này — đó là toàn bộ lý do tách ra
 * (user 27/08: *"custom khá nhiều để khớp với từng provider… sắp xếp lại"*).
 */

import type { CatalogArm } from '../catalog.js';

/**
 * ⚠ GHIM PHIÊN BẢN, KHÔNG `@latest`. → SPEC-arms.md §11d
 *
 * `npx -y <gói>` tải và chạy mã của người lạ trên máy khách, với quyền của khách,
 * kèm chìa của khách. `@latest` nghĩa là bản cập nhật của người lạ chạy trên máy
 * khách mà không ai duyệt. Xuất hiện trong DANH MỤC CỦA TA thì lời cảnh báo
 * "code người lạ" không còn đủ — **chọn hộ khách là bảo đảm hộ khách**.
 *
 * Hằng số này ở ĐÂY chứ không ở `catalog.ts`: nó chỉ thuộc về mục này, và một
 * hằng số chung mà chỉ một chỗ dùng là một lời mời chỗ thứ hai dùng nhờ.
 */
const FILESYSTEM_PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

export const FILES_ARM: CatalogArm = {
  id: 'files',
  name: 'File trên máy',
  icon: '📁',
  blurb: 'Đọc file và thư mục trên chính máy này — chỉ những thư mục bạn cho phép.',
  price: 'none',
  spec: { kind: 'stdio', command: 'npx', args: ['-y', FILESYSTEM_PKG], appendFolders: true },
  secrets: [],
  folders: {
    label: 'Thư mục được phép',
    help: 'Nhân viên chỉ với tới được những thư mục trong danh sách này. Chọn đúng thứ cần, đừng chọn cả ổ đĩa.',
  },
  // Server tham chiếu của chính MCP ⇒ KHÔNG có thương hiệu bên thứ ba nào.
  // Đây là mục duy nhất trong danh mục v1 có rủi ro nhãn hiệu bằng 0.
  //
  // `mark` bỏ trống ⇒ giao diện vẽ hình theo LOẠI (thư mục). Đúng ý nghĩa: mục
  // này không có hãng nào để vẽ logo. → `ArmIcon.tsx`
  brand: { owner: null, guidelineUrl: null, checkedOn: null },
};
