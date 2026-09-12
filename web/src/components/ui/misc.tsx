import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';
import { t } from '@i18n';

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * A one-line tooltip, for icon-only buttons — without one, an icon is a riddle.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `side` IS NOT COSMETIC — it decides whether the NEXT button is clickable.│
 * │                                                                          │
 * │ Radix defaults to `top`. In a VERTICAL strip (the left icon rail), "top"  │
 * │ is exactly where the next button sits: hovering "Results" covers          │
 * │ "Documents" with its own tooltip. Clicking the covered button then means  │
 * │ moving the pointer away to dismiss the tooltip and coming back — three    │
 * │ actions per drawer change instead of one.                                 │
 * │                                                                          │
 * │ Rule: a VERTICAL strip puts tooltips `right`, a HORIZONTAL one puts them  │
 * │ `top`/`bottom`. Always push it off the axis the buttons line up on.       │
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
      <TooltipPrimitive.Trigger
        asChild
        /*
         * ┌──────────────────────────────────────────────────────────────────────┐
         * │ 🔴 A TOOLTIP THAT APPEARED ON ITS OWN AND WOULD NOT LEAVE.           │
         * │ → SPEC-office-animation.md §17j                                      │
         * │                                                                      │
         * │ Reported as *"it gets stuck, like dragging the mouse out of the      │
         * │ window fast"*, and then corrected by the user's own better           │
         * │ observation: *"it is not stuck — every time I come back into the     │
         * │ browser it appears and sits there."* That second sentence is the     │
         * │ whole diagnosis.                                                     │
         * │                                                                      │
         * │ Radix opens on FOCUS (`react-tooltip` Trigger: `onFocus → if         │
         * │ (!isPointerDownRef.current) onOpen()`). Returning to the window      │
         * │ re-focuses whatever was focused when it left — normally the view     │
         * │ switch, because that is what was last clicked. So a tooltip opens    │
         * │ with the pointer nowhere near it, and nothing dismisses it: the      │
         * │ pointer never entered, so it can never leave.                        │
         * │                                                                      │
         * │ ⚠ THE FIX IS NOT A TIMEOUT. A "hide after 10 s" would leave the      │
         * │ tooltip up for ten seconds every single time and call that solved.   │
         * │ Focus-to-open exists for KEYBOARD users; `:focus-visible` is the     │
         * │ browser's own answer to *was this focus a keyboard focus*, and       │
         * │ restored window focus on a mouse-clicked button is not one.          │
         * │                                                                      │
         * │ ⚠ `preventDefault()` is the mechanism, not a nudge: Radix composes   │
         * │ our handler ahead of its own with `checkForDefaultPrevented`, so a   │
         * │ prevented focus event never reaches `onOpen`.                        │
         * └──────────────────────────────────────────────────────────────────────┘
         */
        onFocus={(e) => {
          if (!e.currentTarget.matches(':focus-visible')) e.preventDefault();
        }}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          /* `collisionPadding`: hard against the left edge, Radix flips to the
             opposite side when it runs out of room — and the opposite of `right`
             is `left`, i.e. off-screen. Leave margin so it flips early and correctly. */
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

/** A small upper-case label used as a section heading. */
export function SectionTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('text-[11px] font-semibold uppercase tracking-[0.09em] text-muted', className)}
      {...props}
    />
  );
}

/**
 * The COPY FILE REFERENCE button — shared by Documents and Results.
 * → docs/SPEC-library.md §8c
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ COPY THE FULL PATH, NEVER THE BARE NAME — that is the whole reason this  │
 * │ button exists.                                                           │
 * │                                                                          │
 * │ The two stores are ALLOWED to hold files with the same name: Documents   │
 * │ has `doc-1.md` and Results has `doc-1.md`. Copying the bare name hands   │
 * │ that ambiguity to the user to retype by hand, and then to the model to   │
 * │ guess at. The full path (`library/files/…` vs `artifacts/…`) is itself   │
 * │ the thing that distinguishes them.                                       │
 * │                                                                          │
 * │ The `@` prefix is OUR convention, unwrapped in code by                   │
 * │ `Office.resolveRefs()` before anything reaches the model — it is NOT SDK │
 * │ syntax. See the note on `resolveRefs` for why we actively do NOT want    │
 * │ the SDK to understand it.                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The icon changes on copy and reverts after 1.2s: the clipboard is the one
 * action in this interface with NO visual feedback from the system, so without
 * it people press twice and paste two lines.
 */
export function CopyRef({ path }: { path: string }) {
  const [done, setDone] = React.useState(false);

  return (
    <button
      type="button"
      className="rounded p-1.5 text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink"
      aria-label={t('common.copyRef', { path })}
      title={t('common.copyPath')}
      onClick={() => {
        // `navigator.clipboard` needs a secure context. The daemon runs on
        // `http://127.0.0.1` and browsers treat localhost as secure, so this
        // path works. But someone may open it over a LAN IP (`--host`), where
        // the API disappears entirely: `?.` rather than `try` because it DOES
        // NOT EXIST, it does not throw.
        void navigator.clipboard?.writeText(`@${path}`).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1_200);
          },
          () => {
            /* the browser refused — the path is still readable in the tooltip */
          },
        );
      }}
    >
      {done ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

/**
 * The empty state. HAVING ITS OWN COMPONENT is deliberate: the "stable"
 * criterion requires every empty state to be a designed screen, not a blank area
 * that reads as breakage.
 */
export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  /** Takes a node so the call site can break lines — not a plain string. */
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
