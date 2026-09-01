/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MỘT CÁNH TAY = MỘT HÌNH, VÀ CÙNG MỘT HÌNH Ở MỌI NƠI. (user chốt 27–28/08)│
 * │                                                                          │
 * │ > *"Một card cũng có icon phân biệt ở phía trước … áp dụng xuyên suốt    │
 * │ >  vào các nấc bên trong luôn"* · *"Cái node mcp server trên canvas nữa: │
 * │ >  đổi cái biểu tượng phích cắm thành … ứng với từng loại mcp"*          │
 * │                                                                          │
 * │ Vẽ ở NĂM chỗ: thẻ chọn loại · lưới dịch vụ · danh sách dùng lại · tiêu   │
 * │ đề bước 2 · **node trên sơ đồ**. Năm bản của cùng một ánh xạ là năm chỗ  │
 * │ để lệch, và khi lệch thì mất đúng thứ hình vẽ sinh ra để giữ: nhận ra    │
 * │ **nó vẫn là nó** khi đi từ màn này sang màn kia.                          │
 * │                                                                          │
 * │ 🔴 KHÔNG CÓ TÊN HÃNG NÀO TRONG FILE NÀY, và đó là thay đổi 28/08. Bản    │
 * │ đầu có bảng `{ github: '<path…>', notion: '<path…>' }` ngay tại đây —     │
 * │ tức logo của hãng sống ở thư mục web, còn lời khai thương hiệu            │
 * │ (`brand.checkedOn`, luật §11c *"chưa đọc quy tắc ⇒ không logo"*) sống ở   │
 * │ danh mục. Hai file, không ai đối chiếu ⇒ ta ship logo trong khi lời khai  │
 * │ vẫn ghi *"chưa đọc quy tắc"*, và **không có gì kêu lên**.                 │
 * │ ⇒ Đường dẫn giờ đi kèm chính hồ sơ thương hiệu: `catalog.ts §brand.mark`. │
 * │                                                                          │
 * │ ⚠ ĐƠN SẮC — `currentColor` hết, kể cả logo hãng. Emoji cũ (📁 🔌 ⚙️ 📝)   │
 * │ tự mang màu của phông chữ hệ điều hành: cùng một thẻ ra ba màu trên ba    │
 * │ máy, và không cái nào theo được nền sáng/tối của ta.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { Cog, Folder, Globe, Plug, SquareTerminal } from 'lucide-react';

/** Các loại cánh tay. Cùng trục phân loại với `ArmDialog §kindOf` và `office.ts §armKind`. */
export type ArmKind = 'files' | 'service' | 'custom' | 'browser' | 'cli';

/**
 * Hình của một cánh tay.
 *
 * `mark` = đường dẫn SVG 24×24 của hãng, đến từ danh mục. Không có ⇒ ngã về
 * hình theo LOẠI, và loại vẫn đủ để phân biệt bằng mắt.
 *
 * ⚠ `x` / `y` / `size` chỉ dùng khi vẽ **bên trong một `<svg>` khác** (sơ đồ).
 * Trong HTML thường thì bỏ trống và chỉnh bằng `className` như mọi icon khác —
 * hai đường vào một hàm, vì hai chỗ vẽ có hai hệ toạ độ.
 */
export function ArmIcon({
  mark,
  kind,
  className = 'h-3.5 w-3.5',
  x,
  y,
  size,
}: {
  mark?: string;
  kind: ArmKind;
  className?: string;
  x?: number;
  y?: number;
  size?: number;
}) {
  // Trong SVG thì vị trí phải nói bằng thuộc tính, không nói bằng class: node
  // trên sơ đồ nằm trong hệ toạ độ của chính nó, và Tailwind không với tới đó.
  const place = size !== undefined ? { x, y, width: size, height: size } : {};

  if (mark) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
        className={size === undefined ? className : undefined}
        {...place}
      >
        <path d={mark} />
      </svg>
    );
  }
  // Thư mục ⇒ thư mục; tự cắm ⇒ bánh răng; dịch vụ chưa có logo ⇒ phích cắm.
  /**
   * `browser` vẽ **quả địa cầu**, không vẽ phích cắm. Phích cắm nói *đây là một
   * kết nối* — đúng, nhưng vô nghĩa khi **mọi** mục đều là kết nối. Hình phải nói
   * mục này **làm gì**, y như thư mục cho `files`.
   */
  const Fallback =
    kind === 'files'
      ? Folder
      : kind === 'browser'
        ? Globe
        : // Dòng lệnh: hình `>_`. Người non-code không biết `argv` là gì, nhưng
          // cái dấu nhắc thì họ đã thấy trong mọi phim có máy tính.
          kind === 'cli'
          ? SquareTerminal
          : kind === 'custom'
            ? Cog
            : Plug;
  return (
    <Fallback
      aria-hidden="true"
      className={size === undefined ? className : undefined}
      {...place}
    />
  );
}
