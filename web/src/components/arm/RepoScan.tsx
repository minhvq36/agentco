/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BẢN CÀI APP — TRA TỰ ĐỘNG. → SPEC-arms §5h·7o                            │
 * │                                                                          │
 * │ Không ô nhập nào (user 27/08: *"Không gõ chữ gì, bấm thử ngay và thử tự   │
 * │ động"*). Chọn xong tài khoản là nó tự chạy, và kết quả là **danh sách    │
 * │ repo hãng thật sự cho đụng** — thứ dấu ✓ của `tools/list` không nói được. │
 * │                                                                          │
 * │ ⚠ BA trạng thái, ba câu khác nhau. Đừng gộp `failed` với `installed: []`: │
 * │ một cái là *"không tra được"*, cái kia là *"tra được, và câu trả lời là   │
 * │ chưa cài"*. Gộp lại là hoặc chặn oan người đã cài, hoặc thả người chưa.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ArmScope, RepoScanState } from './types';

export function RepoScan({
  name,
  scope,
  scan,
  scanning,
  anyway,
  onAnyway,
  onRecheck,
}: {
  name: string;
  scope?: ArmScope;
  scan: RepoScanState;
  scanning: boolean;
  /** Ô thoát đang tick — xem khối chú thích ở cuối file. */
  anyway: boolean;
  onAnyway(v: boolean): void;
  onRecheck(): void;
}) {
  return (
    <div className="mt-3 rounded-md border border-line px-3 py-3">
      <div className="text-[13px] font-medium">Repo agentco được phép đụng</div>

      {scanning ? (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Đang hỏi {name} xem app được cài vào những repo nào…
        </div>
      ) : scan && 'failed' in scan ? (
        /*
          KHÔNG TRA ĐƯỢC ≠ CHƯA CÀI. Cho đi tiếp, nhưng nói thật là ta không
          biết — im lặng ở đây là để người dùng tự tin sai.
        */
        <p className="mt-1 text-xs leading-relaxed text-warn">
          Không hỏi được danh sách repo lúc này. Vẫn cắm được — nhưng nếu nhân viên báo không tìm
          thấy repo, hãy quay lại bấm <b>{scope?.say}</b> ở trên.
        </p>
      ) : scan && scan.installed.length > 0 ? (
        <>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Đã cài trên <b>{scan.installed.length}</b> repo của <b>@{scan.login}</b>
            {scan.seen > scan.installed.length && (
              <> — {scan.seen - scan.installed.length} repo khác thì chưa cài</>
            )}
            .
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {scan.installed.slice(0, 12).map((r) => (
              <span
                key={r}
                className="rounded bg-line/70 px-1.5 py-0.5 font-mono text-[11px] text-muted"
              >
                {r.split('/')[1]}
              </span>
            ))}
            {scan.installed.length > 12 && (
              <span className="px-1 text-[11px] text-muted">+{scan.installed.length - 12}</span>
            )}
          </div>
          {/*
            ⚠ NÓI RA GIỚI HẠN CỦA CHÍNH PHÉP ĐO. Repo công khai đọc được **bất
            kể** bản cài (đo 27/08), nên danh sách này nói về *quyền đầy đủ*,
            không phải *tất cả những gì đọc được*. Không nói ra là để người dùng
            tin nó chặt hơn thực tế.
          */}
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Repo công khai thì nhân viên vẫn đọc được dù chưa cài — danh sách trên là những repo có
            quyền <b>đầy đủ</b> (gồm repo riêng tư và quyền ghi).
          </p>
        </>
      ) : scan ? (
        <>
          <p className="mt-1 text-xs leading-relaxed text-danger">
            <b>@{scan.login}</b> chưa cài agentco vào repo nào. Nhân viên sẽ không đọc được repo
            riêng tư và không ghi được gì cả.
          </p>
          {scope && (
            <Button
              className="mt-2 w-full"
              onClick={() => window.open(scope.url, '_blank', 'noopener')}
            >
              {scope.say}
            </Button>
          )}
          <Button size="sm" className="mt-1.5 w-full" onClick={onRecheck}>
            Cài xong rồi — kiểm lại
          </Button>
          {/*
            ĐƯỜNG THOÁT BẮT BUỘC, và nó không phải sự nhân nhượng.
            `search user:<login>` **không thấy repo của tổ chức**, nên "rỗng"
            không chứng minh "chưa cài gì". Chặn cứng ở đây là giam một người đã
            làm đúng — mà giam thì không có đường ra.
          */}
          <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-muted">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={anyway}
              onChange={(e) => onAnyway(e.target.checked)}
            />
            <span>
              Đã hiểu và tiếp tục — <i>repo của tổ chức không hiện ở đây được</i>.
            </span>
          </label>
        </>
      ) : null}
    </div>
  );
}
