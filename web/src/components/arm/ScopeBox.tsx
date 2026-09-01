/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 PHẠM VI BÊN HÃNG — NGAY SAU ĐĂNG NHẬP, cùng một màn.                  │
 * │ (user chốt thứ tự 27/08)                                                 │
 * │                                                                          │
 * │ Hai lý do, và cái thứ hai là cái quan trọng:                              │
 * │  ① Cài app **phải xảy ra trước** mọi bước phụ thuộc repo.                 │
 * │  ② *"kịp thời update cái người dùng vừa allow trên github"* — ta không     │
 * │     đọc được bản cài, nên thứ duy nhất đồng bộ được là **thứ tự thao      │
 * │     tác**: cài xong rồi mới thử.                                          │
 * │                                                                          │
 * │ Không có khối này thì chuỗi `installations/new` **không xuất hiện một lần │
 * │ nào trong sản phẩm** (trước 27/08 nó chỉ nằm trong walkthrough). Người    │
 * │ dùng cắm xong, thấy ✓ kèm số việc, rồi nhận 404 ở mọi lời gọi — và GitHub │
 * │ cố ý trả 404 chứ không 403, nên câu lỗi dẫn họ đi kiểm chìa. → C-2 · F-3  │
 * │                                                                          │
 * │ ⚠ Ta KHÔNG hiển thị "bạn đã cài chưa" ở đây và KHÔNG đặt mặc định hộ.     │
 * │ (user hỏi thẳng 27/08: *"không chọn install mà tiếp luôn thì nó có        │
 * │ DEFAULT All repositories không?"*) — **không, và ta không biết được**.    │
 * │ Chưa cài lần nào ⇒ **không có quyền gì cả**, không phải "tất cả".         │
 * │ Không tool MCP nào trả lời thẳng câu đó, nên khối này không vẽ trạng       │
 * │ thái. `RepoScan` suy ra nó bằng đường khác và là chỗ DUY NHẤT được phép   │
 * │ nói "đã cài / chưa cài". → §5h·7o                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { Button } from '@/components/ui/button';
import type { ArmScope } from './types';

export function ScopeBox({ name, scope }: { name: string; scope: ArmScope }) {
  return (
    <div className="mt-3 rounded-md border border-line px-3 py-3">
      <div className="text-[13px] font-medium">Phạm vi bên {name}</div>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">{scope.help}</p>
      <Button className="mt-2 w-full" onClick={() => window.open(scope.url, '_blank', 'noopener')}>
        {scope.say}
      </Button>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Chưa cài lần nào thì nhân viên <b>không đọc được repo riêng tư và không ghi được gì</b>. Cài
        xong quay lại đây — khối ngay bên dưới tự kiểm lại, không phải gõ gì.
      </p>
    </div>
  );
}
