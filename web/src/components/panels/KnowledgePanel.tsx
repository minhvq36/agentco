import { useEffect, useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';

import { Empty, Input } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { agentInk, agentWash, agentHue } from '@/lib/colors';
import { toast, useApp } from '@/lib/store';
import type { KnowledgeEntry } from '@/lib/types';

/**
 * Ngăn kéo tri thức. Tìm kiếm dùng index đã có trên client — **0 token**.
 *
 * Hai phạm vi hiện khác nhau có chủ ý: `shared` là kho chung cả văn phòng đọc,
 * `role:<id>` là sổ tay riêng chỉ chính agent đó đọc. Trộn chúng vào một danh
 * sách phẳng là xoá mất phân biệt quan trọng nhất của kho.
 */
export function KnowledgePanel() {
  const officeId = useApp((s) => s.officeId);
  const knowledgeVersion = useApp((s) => s.canvas?.knowledge.total ?? 0);
  const [nodes, setNodes] = useState<KnowledgeEntry[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!officeId) return;
    let alive = true;
    api
      .knowledge(officeId)
      .then((r) => alive && setNodes(r.nodes))
      .catch((err) => {
        toast(err instanceof Error ? err.message : 'Không đọc được kho tri thức.');
        if (alive) setNodes([]);
      });
    return () => {
      alive = false;
    };
  }, [officeId, knowledgeVersion]);

  const filtered = useMemo(() => {
    if (!nodes) return null;
    const term = q.trim().toLowerCase();
    if (!term) return nodes;
    return nodes.filter(
      (n) => n.title.toLowerCase().includes(term) || n.tags.some((t) => t.toLowerCase().includes(term)),
    );
  }, [nodes, q]);

  if (nodes === null) return <div className="px-4 py-6 text-[13px] text-muted">Đang đọc…</div>;

  if (nodes.length === 0) {
    return (
      <Empty
        icon={<BookOpen className="h-7 w-7" />}
        title="Kho tri thức còn trống"
        hint="Nhân viên tự ghi vào sổ tay riêng khi rút ra bài học; Trợ lý ghi vào kho chung sau mỗi ca. Không ai phải nhập tay."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b border-line p-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trong kho…" aria-label="Tìm" />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {filtered?.map((n) => {
          const own = n.scope.startsWith('role:') ? n.scope.slice(5) : null;
          const hue = own ? agentHue(own) : null;
          return (
            <li key={n.id} className="border-b border-line px-4 py-2.5">
              <div className="text-[13.5px] leading-snug text-ink">{n.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                {own ? (
                  <span
                    className="rounded px-1.5 font-medium"
                    style={{ color: agentInk(hue!), background: agentWash(hue!) }}
                  >
                    📒 {own}
                  </span>
                ) : (
                  <span className="rounded bg-line/70 px-1.5 font-medium text-ink">chung</span>
                )}
                {n.pinned && <span className="text-warn">ghim</span>}
                <span className="tabular-nums">{n.tokens} token</span>
                <span>·</span>
                <span className="tabular-nums">dùng {n.hits} lần</span>
              </div>
            </li>
          );
        })}
        {filtered?.length === 0 && (
          <li className="px-4 py-6 text-[13px] text-muted">Không có ghi chú nào khớp “{q}”.</li>
        )}
      </ul>
    </div>
  );
}
