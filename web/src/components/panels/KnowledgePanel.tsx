import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Empty, Input, Textarea } from '@/components/ui/misc';
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
  const [open, setOpen] = useState<KnowledgeEntry | null>(null);

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
            <li key={n.id} className={`border-b border-line ${n.superseded ? 'opacity-55' : ''}`}>
              <button
                className="w-full px-4 py-2.5 text-left transition-colors hover:bg-accent-soft/40"
                onClick={() => setOpen(n)}
              >
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
                  {/* Không có nhãn này thì ba bản "Ghi nhớ" trông y hệt nhau và
                      người dùng tưởng hệ thống đang nhân bản rác. */}
                  {n.superseded && <span className="text-warn">đã bị bản mới đè</span>}
                  <span className="tabular-nums">{n.tokens} token</span>
                  <span>·</span>
                  <span className="tabular-nums">dùng {n.hits} lần</span>
                </div>
              </button>
            </li>
          );
        })}
        {filtered?.length === 0 && (
          <li className="px-4 py-6 text-[13px] text-muted">Không có ghi chú nào khớp “{q}”.</li>
        )}
      </ul>

      <NodeDialog
        node={open}
        onClose={() => setOpen(null)}
        onDone={(next) => {
          setNodes(next);
          setOpen(null);
        }}
      />
    </div>
  );
}

/**
 * Xem / sửa / xoá một ghi chú. Tác động 1-1 và NGAY LẬP TỨC.
 *
 * Trước đây ngăn kéo này chỉ đọc, nên muốn sửa một câu sai trong đầu nhân viên
 * thì phải mở đúng file yaml của người đó ra — thứ người dùng non-code không
 * làm được, và cũng là thứ khiến kho tri thức trông như một cái hộp đen.
 *
 * Sửa xong: quét lại kho, dựng lại ngữ cảnh Trợ lý, và mọi worker phóng SAU đó
 * dùng bản mới. Worker đang chạy giữ nguyên bản cũ — cùng luật với đổi model.
 */
function NodeDialog({
  node,
  onClose,
  onDone,
}: {
  node: KnowledgeEntry | null;
  onClose(): void;
  onDone(nodes: KnowledgeEntry[]): void;
}) {
  const officeId = useApp((s) => s.officeId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    setText(node?.body ?? '');
    setConfirmDel(false);
  }, [node]);

  async function apply(remove: boolean) {
    if (!officeId || !node) return;
    setBusy(true);
    try {
      const r = await api.editKnowledge(officeId, node.id, remove ? { remove: true } : { body: text });
      onDone(r.nodes);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  }

  const own = node?.scope.startsWith('role:') ? node.scope.slice(5) : null;

  return (
    <Dialog open={!!node} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(40rem,94vw)]">
        <DialogHeader>
          <DialogTitle>{node?.title}</DialogTitle>
          <DialogDescription>
            {own ? (
              <>
                Sổ tay riêng của <b>{own}</b> — chỉ mình người này đọc.
              </>
            ) : (
              <>
                Kho <b>chung</b> — mọi nhân viên trong văn phòng đều đọc, ở mọi việc.
              </>
            )}{' '}
            <code>{node?.file}</code>
            {node?.superseded && (
              <>
                <br />
                <br />
                <b className="text-warn">Đã bị một bản mới đè.</b> Nó không còn đi vào prompt của ai,
                nhưng file vẫn ở đây để bạn đọc lại khi cần.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <Textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="font-mono text-[11.5px] leading-relaxed"
        />
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Sửa xong áp dụng ngay cho việc giao <b>từ giờ trở đi</b>; việc đang chạy giữ nguyên bản cũ.
          Ghi chú nằm trong bộ nhớ đệm nên mỗi lần sửa là một lần ghi lại cache.
        </p>

        <DialogFooter>
          <Button onClick={onClose}>Thôi</Button>
          {confirmDel ? (
            <Button variant="danger" disabled={busy} onClick={() => void apply(true)}>
              {busy ? 'Đang xoá…' : 'Chắc chắn xoá'}
            </Button>
          ) : (
            <Button variant="danger" disabled={busy} onClick={() => setConfirmDel(true)}>
              <Trash2 className="h-4 w-4" />
              Xoá
            </Button>
          )}
          <Button
            variant="primary"
            disabled={busy || text.trim() === (node?.body ?? '').trim()}
            onClick={() => void apply(false)}
          >
            {busy ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
