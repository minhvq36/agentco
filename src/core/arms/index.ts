/**
 * DANH MỤC = MỘT DANH SÁCH, KHÔNG PHẢI MỘT FILE KHỔNG LỒ. (user chốt 28/08)
 *
 * > *"những provider này tôi đang custom khá nhiều để khớp với từng provider đó.
 * >  Hãy sắp xếp lại? … để sau này có thay đổi gì còn sửa cho dễ"*
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ FILE NÀY PHẢI Ở YÊN — nó chỉ được phép là một mảng và không gì khác.   │
 * │                                                                          │
 * │ Cám dỗ sắp tới là nhét *"logic chung của mấy hãng"* vào đây: một hàm nhỏ  │
 * │ dựng header, một bảng mặc định, một nhánh `if`. Đừng. Thứ dùng chung ở    │
 * │ **kiểu và hàm dựng** (`catalog.ts`); thứ riêng của một hãng ở **file của  │
 * │ hãng đó**. Còn đúng một chỗ ở giữa thì không có ai canh nó, và nó lớn dần │
 * │ cho tới ngày lại thành file 900 dòng vừa tách ra.                         │
 * │                                                                          │
 * │ ⚠ THỨ TỰ Ở ĐÂY LÀ THỨ TỰ NGƯỜI DÙNG NHÌN THẤY ở lưới "Dịch vụ có sẵn".   │
 * │ Nó cũng là **thứ tự XÂY** đã chốt §4e: 0 chìa → HTTP/OAuth sẵn → OAuth    │
 * │ phải tự đăng ký app.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { CatalogArm } from '../catalog.js';

import { BROWSER_ARM } from './browser.js';
import { FILES_ARM } from './files.js';
import { GITHUB_ARM } from './github.js';
import { LINEAR_ARM } from './linear.js';
import { NOTION_ARM } from './notion.js';

/**
 * ⚠ `browser` đứng **thứ hai**, không đứng cuối — thứ tự này là thứ tự XÂY (§4e:
 * 0 chìa → chìa tĩnh → OAuth sẵn → OAuth tự đăng ký), và mục này gõ **0 chìa**
 * đúng bằng `files`. Xếp nó sau `github` là xếp theo ngày viết, không theo luật.
 */
/**
 * ⚠ `linear` đứng **cạnh `notion`**, trước `github` — theo đúng thứ tự XÂY §4e
 * chứ không theo ngày viết. Đo 29/08: Linear mở DCR và nhận `auth_method: none`
 * y như Notion ⇒ **cùng bậc "0 tay"**. GitHub tốn một lần tự tạo app nên nó
 * đứng sau, dù ra đời trước.
 */
export const CATALOG: CatalogArm[] = [FILES_ARM, BROWSER_ARM, NOTION_ARM, LINEAR_ARM, GITHUB_ARM];
