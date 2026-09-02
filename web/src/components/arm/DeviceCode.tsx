/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MÃ THIẾT BỊ — ba bước ĐÁNH SỐ, vì đây là luồng duy nhất bắt người dùng   │
 * │ làm việc ở MỘT MÀN HÌNH KHÁC. → SPEC-arms §5h·7b                         │
 * │                                                                          │
 * │ Web flow chỉ cần "bấm nút, tab tự lo". Ở đây họ phải cầm một mã đi sang  │
 * │ chỗ khác gõ vào — và giữa hai màn hình đó không có gì nối lại ngoài cái   │
 * │ mã. Nên nó phải TO, chép được, và có đồng hồ: một mã im lặng chết là     │
 * │ người dùng gõ vào chỗ vô ích rồi đi tìm lỗi ở phía họ.                    │
 * │                                                                          │
 * │ ⚠ KHÔNG tự `window.open`: ca device flow sinh ra để phục vụ chính là     │
 * │ *người dùng duyệt ở máy/điện thoại khác*. Mở giúp thì được, giả định thì  │
 * │ không.                                                                   │
 * │                                                                          │
 * │ ⚠ Ở ĐÂY KHÔNG CÓ BÍ MẬT NÀO. `userCode` là thứ người dùng phải ĐỌC ĐƯỢC  │
 * │ và gõ đi; `state` chỉ trỏ tới một phiên nằm ở daemon. Khác hẳn            │
 * │ `code_verifier` của web flow, thứ chưa bao giờ rời khỏi daemon.           │
 * │                                                                          │
 * │ `copied` sống TRONG đây (tách khỏi `ArmDialog` 28/08): nó không ai ngoài  │
 * │ khối này quan tâm, và một state cục bộ nằm ở component cha là một dòng    │
 * │ render lại cả hộp thoại cho một dấu tích.                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DeviceLogin } from './types';
import { t } from '@i18n';

export function DeviceCode({
  name,
  device,
  now,
}: {
  /** Tên hãng — câu lệnh phải gọi đúng tên màn hình họ sắp mở. */
  name: string;
  device: DeviceLogin;
  /** Đồng hồ của cha: nó cũng là thứ dọn mã hết hạn, nên không nhân bản ở đây. */
  now: number;
}) {
  const [copied, setCopied] = useState(false);
  const left = Math.max(0, device.expiresAt - now);

  return (
    <div className="mt-3 rounded-md border border-accent/40 bg-accent-soft/30 px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-medium">{t('arm.deviceTitle', { name })}</div>
        {/* Đồng hồ: mã chết THẬT sau 15 phút, và họ phải thấy nó chết. */}
        <div className="shrink-0 font-mono text-[11px] text-muted">
          {t('arm.deviceLeft', {
            mm: Math.floor(left / 60000),
            ss: String(Math.floor((left % 60000) / 1000)).padStart(2, '0'),
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 select-all rounded border border-line bg-bg px-3 py-2 text-center font-mono text-lg tracking-[0.2em]">
          {device.userCode}
        </code>
        <Button
          aria-label={t('arm.copyCode')}
          title={t('arm.copyCode')}
          onClick={() => {
            void navigator.clipboard?.writeText(device.userCode).then(
              () => setCopied(true),
              // Clipboard bị chặn (http, quyền) ⇒ KHÔNG báo đã chép. Mã vẫn
              // `select-all` nên họ bôi đen chép tay được — một dấu ✓ sai còn
              // tệ hơn không có dấu nào.
              () => setCopied(false),
            );
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>

      <ol className="mt-2.5 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted">
        <li>
          {t('arm.deviceStep1Before')}{' '}
          <a
            className="underline decoration-dotted hover:text-fg"
            href={device.verificationUriComplete ?? device.verificationUri}
            target="_blank"
            rel="noreferrer noopener"
          >
            {device.verificationUri.replace(/^https?:\/\//, '')}
          </a>{' '}
          {t('arm.deviceStep1After')}
        </li>
        <li>{t('arm.deviceStep2')}</li>
        <li>{t('arm.deviceStep3')}</li>
      </ol>

      {/*
        ⚠ CÂU NÀY PHẢI CÓ, và nó đến từ một ca thật ta tự dẫm khi đo: trình duyệt
        đang đăng nhập MỘT TÀI KHOẢN KHÁC thì chìa lấy về là của người đó, và
        triệu chứng duy nhất sẽ là *"cánh tay không thấy gì cả"* — một câu sai
        cửa dẫn người ta đi kiểm quyền, kiểm cài đặt, kiểm repo. → §5h·7k
      */}
      <p className="mt-2 text-xs leading-relaxed text-muted">
        {t('arm.deviceAccountBefore')} <b>{t('arm.deviceAccountBold')}</b>
        {t('arm.deviceAccountAfter')}
      </p>
    </div>
  );
}
