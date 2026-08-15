import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;

/** Tooltip một dòng. Dùng cho các nút chỉ có icon — không có nó thì icon là câu đố. */
export function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
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
  hint?: string;
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
