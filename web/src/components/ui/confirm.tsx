import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { t } from '@i18n';

/**
 * The confirm box before deleting ONE FILE — where **Enter IS the Delete button**.
 * → docs/SPEC-ui.md §2.4
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ FOCUSING THE DANGEROUS BUTTON — DELIBERATE, AND BOUNDED.                 │
 * │                                                                          │
 * │ Radix focuses the FIRST focusable element by default, which here is      │
 * │ "Cancel". So Enter means cancel, and clearing ten files means ten trips  │
 * │ away from the keyboard to click a second small button. That is why this  │
 * │ component exists: click 🗑 with the mouse, hit Enter with the other      │
 * │ hand, never look back.                                                   │
 * │                                                                          │
 * │ Focusing a destructive button is normally FORBIDDEN, so the reason it is │
 * │ allowed here has to be spelled out:                                      │
 * │                                                                          │
 * │  1. THE CONSEQUENCE HAS A CEILING. One file in the cabinet (the original │
 * │     is still on their machine) or one result (which can be rerun). Not   │
 * │     a whole office, not an employee with hand-written skills.            │
 * │  2. IT SAYS THAT ENTER IS COCKED. A destructive shortcut nobody          │
 * │     announces is not convenience, it is a trap — the hint line along the │
 * │     footer is part of the feature, not decoration.                       │
 * │  3. THE FILE NAME IS IN THE QUESTION. Even clicking fast, you read what  │
 * │     is about to go.                                                      │
 * │                                                                          │
 * │ ⚠ DO NOT USE THIS FOR "delete office" / "delete employee for good".      │
 * │ Those lose something unrebuildable, so the second click WITH THE MOUSE   │
 * │ is the point: it forces a pause. They keep their own dialogs.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function ConfirmDelete({
  open,
  title,
  confirmLabel,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel?: string;
  onConfirm(): void;
  onCancel(): void;
  children: React.ReactNode;
}) {
  const danger = React.useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        className="w-[min(30rem,94vw)]"
        /*
          `preventDefault` then focus by hand: leaving Radix to its default puts
          focus on "Cancel". This is a line here rather than `autoFocus` on the
          button because `autoFocus` inside Radix's FocusScope is not reliable —
          it depends on mount order, and a keyboard behaviour that is "right
          sometimes" is worse than none at all.
        */
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          danger.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{children}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-muted">
            <b>Enter</b> {t('confirm.toDelete')} · <b>Esc</b> {t('confirm.toCancel')}
          </span>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button ref={danger} variant="danger" onClick={onConfirm}>
            {confirmLabel ?? t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
