import { useEffect, useState } from 'react';
import { Building2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/misc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { actions, useApp } from '@/lib/store';

/** Tổng quan cả CÔNG TY: các văn phòng, và tiền — thứ duy nhất dùng chung. */
export function OverviewPanel() {
  const company = useApp((s) => s.company);
  const officeId = useApp((s) => s.officeId);
  const [cost, setCost] = useState<
    Array<{ office: string; name: string; tasks: number; costUSD: number; turns: number }> | null
  >(null);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    api
      .cost()
      .then((c) => setCost(c.byOffice))
      .catch(() => setCost([]));
  }, [officeId]);

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-4 py-4">
      <section>
        <SectionTitle className="mb-2">Văn phòng</SectionTitle>
        <ul className="flex flex-col gap-1">
          {company?.offices.map((o) => (
            <li
              key={o.id}
              className={`group flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[13px] ${
                o.id === officeId ? 'border-accent bg-accent-soft/40' : 'border-line'
              }`}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => void actions.openOffice(o.id)}
              >
                <span>{o.avatar}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{o.name}</span>
                  <span className="block text-xs text-muted">
                    {o.error ? (
                      <span className="text-danger">{o.error}</span>
                    ) : (
                      `${o.onDuty}/${o.agents} người trực · ${o.knowledge} ghi chú`
                    )}
                  </span>
                </span>
              </button>
              <Button
                size="iconSm"
                variant="ghost"
                aria-label={`Xoá văn phòng ${o.name}`}
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => setConfirm({ id: o.id, name: o.name })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
        {company?.offices.length === 0 && (
          <div className="flex items-center gap-2 py-2 text-[13px] text-muted">
            <Building2 className="h-4 w-4" /> chưa có văn phòng nào
          </div>
        )}
      </section>

      <section>
        <SectionTitle className="mb-2">Chi phí cả công ty</SectionTitle>
        {cost === null ? (
          <div className="text-[13px] text-muted">Đang đọc…</div>
        ) : cost.length === 0 ? (
          <div className="text-[13px] text-muted">Chưa có việc nào được ghi nhận.</div>
        ) : (
          <table className="w-full text-[13px]">
            <tbody>
              {cost.map((c) => (
                <tr key={c.office} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-2 text-ink">{c.name}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted">{c.tasks} việc</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums text-muted">{c.turns} lượt</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums text-ink">${c.costUSD.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Số <b>lượt</b> mới là đòn bẩy chi phí lớn nhất — mỗi lượt đọc lại toàn bộ prefix. Việc nhiều lượt
          đắt hơn việc nhiều token.
        </p>
      </section>

      <RemoveOfficeDialog target={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function RemoveOfficeDialog({
  target,
  onClose,
}: {
  target: { id: string; name: string } | null;
  onClose(): void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xoá văn phòng “{target?.name}”?</DialogTitle>
          <DialogDescription>
            Bạn có thể chỉ <b>đóng</b> nó — file vẫn nằm nguyên trong <code>offices/{target?.id}/</code> và mở
            lại được bằng cách chép thư mục về chỗ cũ. Hoặc xoá hẳn cả thư mục, gồm nhân viên, kỹ năng và
            toàn bộ kho tri thức của văn phòng đó.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>Thôi</Button>
          <Button
            onClick={() => {
              if (target) void actions.removeOffice(target.id, false);
              onClose();
            }}
          >
            Chỉ đóng, giữ file
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (target) void actions.removeOffice(target.id, true);
              onClose();
            }}
          >
            Xoá hẳn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
