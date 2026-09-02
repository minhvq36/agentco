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
 * Hộp hỏi lại trước khi xoá MỘT FILE — và **Enter chính là nút Xoá**.
 * → docs/SPEC-ui.md §2.4
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TỰ ĐƯA TIÊU ĐIỂM VÀO NÚT NGUY HIỂM — CÓ CHỦ Ý, VÀ CÓ RANH GIỚI.          │
 * │                                                                          │
 * │ Mặc định Radix đưa tiêu điểm vào phần tử bấm được ĐẦU TIÊN, ở đây là     │
 * │ "Thôi". Nên Enter = huỷ, và dọn mười file là mười lần rời tay khỏi bàn   │
 * │ phím để bấm chuột lần thứ hai vào đúng một nút nhỏ. Đó là lý do ô này    │
 * │ tồn tại: chuột bấm 🗑, tay kia gõ Enter, không nhìn lại.                  │
 * │                                                                          │
 * │ Đặt tiêu điểm vào nút phá huỷ thường là điều CẤM, nên phải nói rõ vì sao │
 * │ ở đây thì được:                                                          │
 * │                                                                          │
 * │  1. HẬU QUẢ CÓ TRẦN. Một file trong tủ (bản gốc còn trên máy) hoặc một   │
 * │     kết quả (chạy lại được). Không phải cả văn phòng, không phải một     │
 * │     nhân viên kèm kỹ năng đã viết tay.                                    │
 * │  2. NÓI RA RẰNG ENTER ĐANG LÊN CÒ. Một phím tắt phá huỷ mà không ai      │
 * │     thông báo thì không phải tiện, mà là bẫy — dòng gợi ý ở chân hộp là  │
 * │     một phần của tính năng, không phải trang trí.                        │
 * │  3. TÊN FILE NẰM TRONG CÂU HỎI. Bấm nhanh vẫn đọc được cái gì sắp mất.   │
 * │                                                                          │
 * │ ⚠ ĐỪNG DÙNG Ô NÀY CHO "xoá văn phòng" / "xoá hẳn nhân viên". Chúng mất   │
 * │ thứ không dựng lại được, nên cú bấm thứ hai bằng CHUỘT chính là giá trị: │
 * │ nó buộc người dùng dừng lại một nhịp. Chúng giữ nguyên hộp thoại riêng.  │
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
          `preventDefault` rồi tự focus: để Radix chạy mặc định thì tiêu điểm rơi
          vào "Thôi". Đây là một dòng chứ không phải `autoFocus` trên nút, vì
          `autoFocus` bên trong FocusScope của Radix không đáng tin — nó phụ
          thuộc thứ tự mount, và một hành vi bàn phím "đôi khi đúng" thì tệ hơn
          hẳn không có.
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
