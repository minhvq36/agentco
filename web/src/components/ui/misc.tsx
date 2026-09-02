import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Tooltip một dòng. Dùng cho các nút chỉ có icon — không có nó thì icon là câu đố.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `side` KHÔNG PHẢI CHUYỆN THẨM MỸ — nó quyết định nút KẾ BÊN có bấm được. │
 * │                                                                          │
 * │ Mặc định của Radix là `top`. Trong một DÃY DỌC (rail icon bên trái) thì   │
 * │ "trên" chính là chỗ nút kế tiếp đang đứng: rê vào "Kết quả" là chú thích  │
 * │ của nó phủ lên "Tủ tài liệu". Muốn bấm nút bị phủ thì phải rê chuột ra    │
 * │ chỗ khác cho tooltip tắt rồi mới quay lại — mỗi lần đổi ngăn là ba thao   │
 * │ tác thay vì một.                                                          │
 * │                                                                          │
 * │ Luật: dãy DỌC thì tooltip ra `right`, dãy NGANG thì `top`/`bottom`. Tức   │
 * │ là luôn đẩy nó ra khỏi trục mà các nút xếp hàng.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function Tip({
  label,
  side = 'top',
  children,
}: {
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          /* `collisionPadding`: sát mép trái màn hình, Radix tự lật sang phía
             đối diện khi hết chỗ — mà phía đối diện của `right` là `left`, tức
             là ra ngoài cửa sổ. Chừa lề để nó lật sớm và lật đúng. */
          collisionPadding={8}
          className="z-50 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs text-ink shadow-lg"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink',
        'placeholder:text-muted focus:border-accent focus:outline-none',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink',
      'placeholder:text-muted focus:border-accent focus:outline-none',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-9 rounded-lg border border-line bg-paper px-2.5 text-sm text-ink',
      'focus:border-accent focus:outline-none',
      className,
    )}
    {...props}
  />
));
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-xs text-muted', className)} {...props} />;
}

/** Nhãn nhỏ chữ hoa dùng làm tiêu đề khu vực. */
export function SectionTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('text-[11px] font-semibold uppercase tracking-[0.09em] text-muted', className)}
      {...props}
    />
  );
}

/**
 * Nút CHÉP THAM CHIẾU FILE — dùng chung Tủ tài liệu và ngăn Kết quả.
 * → docs/SPEC-library.md §8c
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CHÉP ĐƯỜNG DẪN ĐỦ, KHÔNG CHÉP TÊN TRẦN — và đó là cả lý do nút này tồn   │
 * │ tại.                                                                     │
 * │                                                                          │
 * │ Hai kho **được phép** có file trùng tên: tủ tài liệu có `doc-1.md`, ngăn │
 * │ Kết quả cũng có `doc-1.md`. Chép tên trần là đẩy sự mập mờ đó sang cho    │
 * │ người dùng gõ lại bằng tay, rồi sang cho model đoán. Đường dẫn đủ         │
 * │ (`library/files/…` vs `artifacts/…`) tự nó là thứ phân biệt.             │
 * │                                                                          │
 * │ Tiền tố `@` là quy ước CỦA TA, do `Office.resolveRefs()` bóc ra bằng      │
 * │ code trước khi tới model — KHÔNG phải cú pháp của SDK. Xem chú thích ở    │
 * │ `resolveRefs` để biết vì sao ta còn KHÔNG MUỐN SDK hiểu nó.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Đổi icon sau khi chép và tự trả lại sau 1.2s: clipboard là thao tác duy nhất
 * trong giao diện KHÔNG có phản hồi thị giác nào từ hệ thống, nên người dùng
 * bấm hai lần rồi dán ra hai dòng.
 */
export function CopyRef({ path }: { path: string }) {
  const [done, setDone] = React.useState(false);

  return (
    <button
      type="button"
      className="rounded p-1.5 text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink"
      aria-label={`Chép tham chiếu ${path}`}
      title={`Copy đường dẫn`}
      onClick={() => {
        // `navigator.clipboard` cần secure context. Daemon chạy ở
        // `http://127.0.0.1` — trình duyệt coi localhost là secure, nên đường
        // này chạy. Nhưng người dùng có thể mở qua IP LAN (`--host`), và ở đó
        // API biến mất hoàn toàn: `?.` chứ không phải `try` là vì nó KHÔNG
        // TỒN TẠI chứ không phải ném lỗi.
        void navigator.clipboard?.writeText(`@${path}`).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1_200);
          },
          () => {
            /* trình duyệt từ chối — người dùng vẫn đọc được đường dẫn ở tooltip */
          },
        );
      }}
    >
      {done ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

/**
 * Trạng thái rỗng. CÓ COMPONENT RIÊNG là có chủ ý: tiêu chí "Ổn định" đòi mọi
 * trạng thái rỗng phải là màn hình được thiết kế, không phải một khoảng trắng
 * mà người dùng tưởng là hỏng.
 */
export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  /** Nhận cả node để chỗ gọi xuống dòng được — không phải chuỗi thuần. */
  hint?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      {icon ? <div className="text-muted">{icon}</div> : null}
      <div className="text-sm font-medium text-ink">{title}</div>
      {hint ? <div className="max-w-sm text-[13px] leading-relaxed text-muted">{hint}</div> : null}
      {action}
    </div>
  );
}
