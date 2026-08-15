import { useEffect, useState } from 'react';
import { FileCode2, Pencil, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input, Label, SectionTitle, Select, Textarea } from '@/components/ui/misc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { actions, useApp } from '@/lib/store';
import type { CanvasNode } from '@/lib/types';

/**
 * Sửa hồ sơ nhân viên tại chỗ. → docs/SPEC-tools-approval.md §1
 *
 * KHÔNG autosave. Sửa `pitch` bump cacheKey của Trợ lý (pitch nằm trong roster
 * của nó); sửa mức model bump cacheKey của chính agent này. Nút Lưu tường minh
 * và nói ra cái giá — cùng luật với skills.
 */
function AgentProfile({ node }: { node: CanvasNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(node.label);
  const [pitch, setPitch] = useState(node.pitch ?? '');
  const [tier, setTier] = useState(node.tier ?? 'standard');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(node.label);
    setPitch(node.pitch ?? '');
    setTier(node.tier ?? 'standard');
    setOpen(false);
  }, [node.id, node.label, node.pitch, node.tier]);

  const dirty = name !== node.label || pitch !== (node.pitch ?? '') || tier !== node.tier;

  if (!open) {
    return (
      <>
        {node.pitch && <Note>{node.pitch}</Note>}
        <Row k="Model" v={node.tier} />
        <button
          className="mt-2 flex items-center gap-1.5 text-[13px] text-accent hover:underline"
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
          Sửa hồ sơ
        </button>
      </>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-line p-3">
      <Label htmlFor="ag-name">Tên hiển thị</Label>
      <Input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} />

      <Label htmlFor="ag-pitch" className="mt-3">
        Giới thiệu — thứ DUY NHẤT Trợ lý thấy khi chia việc
      </Label>
      <Textarea id="ag-pitch" rows={3} value={pitch} onChange={(e) => setPitch(e.target.value)} />

      <Label htmlFor="ag-tier" className="mt-3">
        Mức model
      </Label>
      <Select id="ag-tier" className="w-full" value={tier} onChange={(e) => setTier(e.target.value)}>
        <option value="standard">standard — cân bằng</option>
        <option value="eco">eco — rẻ hơn, chậm hơn, cần nhiều lượt hơn</option>
        <option value="deep">deep — chỉ cho việc thật khó</option>
      </Select>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        Lưu sẽ làm Trợ lý ghi lại bộ nhớ đệm một lần — giới thiệu nằm trong ngữ cảnh của nó ở mọi lượt
        trò chuyện.
      </p>

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setOpen(false)}>
          Thôi
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty || !pitch.trim() || busy}
          onClick={async () => {
            setBusy(true);
            const ok = await actions.editAgent(node.role!, {
              display_name: name.trim(),
              pitch: pitch.trim(),
              model_tier: tier,
            });
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          {busy ? 'Đang lưu…' : 'Lưu'}
        </Button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1.5 text-[13px] last:border-0">
      <span className="text-ink">{k}</span>
      <span className="text-right text-muted">{v}</span>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="my-3 text-xs leading-relaxed text-muted">{children}</p>;
}

/** Bảng chi tiết bên phải. Mở khi chọn một node; ✕ để đóng. */
export function Inspector({ onShowPrompt }: { onShowPrompt(who: string): void }) {
  const canvas = useApp((s) => s.canvas);
  const selected = useApp((s) => s.selected);
  const [confirmRemove, setConfirmRemove] = useState<CanvasNode | null>(null);

  const node = canvas?.nodes.find((n) => n.id === selected);
  if (!canvas || !node) return null;

  const onDuty = canvas.nodes.filter((n) => n.kind === 'agent' && n.connected);
  const off = canvas.nodes.filter((n) => n.kind === 'agent' && !n.connected);

  function toggleDuty(n: CanvasNode) {
    const edges = n.connected
      ? canvas!.edges.filter((e) => !(e.from === 'assistant' && e.to === n.id))
      : [...canvas!.edges, { from: 'assistant', to: n.id }];
    void actions.saveCanvas(canvas!.nodes, edges);
  }

  return (
    <aside className="flex w-[304px] flex-none flex-col border-l border-line bg-panel">
      <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="truncate text-[15px] font-semibold">
          {node.avatar ? `${node.avatar} ` : ''}
          {node.label}
        </span>
        <div className="flex-1" />
        <Button size="iconSm" variant="ghost" aria-label="Đóng" onClick={() => actions.select(null)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {node.kind === 'assistant' && (
          <>
            <Note>
              Trợ lý không tự làm việc. Nó chia việc, và chỉ nhìn thấy giới thiệu của những người{' '}
              <b>có dây nối</b> tới đây.
            </Note>
            <Row k="Model" v={node.tier} />
            <Row k="Đang trực" v={`${onDuty.length} người`} />
            <Row k="Đang nghỉ" v={`${off.length} người`} />
            <Row k="Sổ tay riêng" v={`${node.count ?? 0} ghi chú`} />
            {node.mcp && node.mcp.length > 0 && <Row k="Tool ngoài" v={node.mcp.join(', ')} />}
            <Note>
              Mỗi người đang trực chiếm một dòng giới thiệu trong ngữ cảnh của Trợ lý, ở <b>mọi</b> lượt trò
              chuyện. Ngắt dây người không dùng đến là tiết kiệm thật, không phải dọn cho gọn.
            </Note>
            <Button className="w-full" onClick={() => onShowPrompt('assistant')}>
              <FileCode2 className="h-4 w-4" />
              Xem prompt phân lớp
            </Button>
          </>
        )}

        {node.kind === 'knowledge' && (
          <>
            <Row k="Tổng số ghi chú" v={node.count ?? 0} />
            <Row k="Kho chung" v={canvas.knowledge.shared} />
            <Note>
              Kho chung: Trợ lý ghi, cả văn phòng đọc. Node này cố ý <b>không có dây</b> — nó là môi trường,
              không phải quan hệ. Ai cũng với tới được.
            </Note>
            <Note>
              Kinh nghiệm riêng của từng người nằm ở 📒 trên node của họ, và chỉ mình họ đọc.
            </Note>
            <Button className="w-full" onClick={() => actions.openPanel('knowledge')}>
              Mở kho tri thức
            </Button>
          </>
        )}

        {node.kind === 'mcp' && (
          <>
            <Row k="Loại" v="MCP server" />
            <Row
              k="Đang dùng"
              v={
                canvas.edges
                  .filter((e) => e.from === node.id)
                  .map((e) => canvas.nodes.find((n) => n.id === e.to)?.label ?? e.to)
                  .join(', ') || 'chưa ai'
              }
            />
            {node.missing && (
              <Note>
                <span className="text-danger">Không còn khai trong company.yaml.</span>
              </Note>
            )}
            <Note>
              Nối vào một nhân viên = ghi <code>mcp:</code> vào <code>roles/&lt;id&gt;.yaml</code> của người đó.
            </Note>
            <Note>
              Nối vào Trợ lý = việc vặt Trợ lý tự xử lý. Dây này hiện mới được <b>ghi nhận</b>: nó cần{' '}
              <code>concierge</code> (M1) mới chạy được — Trợ lý không tự cầm MCP, vì MCP phá prompt cache ở
              mỗi lượt trò chuyện.
            </Note>
          </>
        )}

        {node.kind === 'agent' && (
          <>
            <AgentProfile node={node} />
            <Row k="Mã vai trò" v={node.role} />
            <Row k="Sổ tay riêng" v={`${node.count ?? 0} ghi chú`} />
            <Row k="Trạng thái" v={node.connected ? 'đang trực' : 'đang nghỉ'} />
            {node.mcp && node.mcp.length > 0 && <Row k="Tool ngoài" v={node.mcp.join(', ')} />}
            {node.missing && (
              <Note>
                <span className="text-danger">Không tìm thấy roles/{node.role}.yaml</span>
              </Note>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <Button onClick={() => onShowPrompt(node.role!)}>
                <FileCode2 className="h-4 w-4" />
                Xem prompt phân lớp
              </Button>
              <Button onClick={() => toggleDuty(node)}>
                {node.connected ? 'Cho nghỉ' : 'Cho trực lại'}
              </Button>
              <Button variant="danger" onClick={() => setConfirmRemove(node)}>
                Bỏ khỏi sơ đồ
              </Button>
            </div>

            <Note>
              Mọi nhân viên đã có sẵn: đọc/ghi file trong văn phòng, và tìm trên web. Không cần bật gì.
            </Note>
          </>
        )}
      </div>

      <SectionTitle className="flex-none border-t border-line px-4 py-2">{node.kind}</SectionTitle>

      <Dialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bỏ “{confirmRemove?.label}” khỏi sơ đồ?</DialogTitle>
            <DialogDescription>
              Mặc định vẫn <b>giữ nguyên</b> file <code>roles/{confirmRemove?.role}.yaml</code> và toàn bộ sổ
              tay kinh nghiệm của người này — chỉ là Trợ lý không thấy nữa. Xoá node và xoá công sức viết
              kỹ năng là hai ý định khác nhau.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmRemove(null)}>Thôi</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (confirmRemove?.role) void actions.removeAgent(confirmRemove.role, true);
                setConfirmRemove(null);
              }}
            >
              Bỏ, giữ file
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmRemove?.role) void actions.removeAgent(confirmRemove.role, false);
                setConfirmRemove(null);
              }}
            >
              Xoá cả file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
