import { useEffect, useState } from 'react';
import { Lock, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { actions, toast, useApp } from '@/lib/store';
import type { PromptLayer } from '@/lib/types';

export function NewOfficeDialog({ open, onOpenChange }: { open: boolean; onOpenChange(v: boolean): void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const ok = await actions.createOffice(name.trim());
    setBusy(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Tạo văn phòng</DialogTitle>
            <DialogDescription>
              Mỗi văn phòng có Trợ lý riêng, nhân viên riêng và kho tri thức riêng. Chúng không nói chuyện
              với nhau — nhờ vậy một văn phòng zip lại là một template chạy được ở máy khác.
            </DialogDescription>
          </DialogHeader>

          <Label htmlFor="office-name">Tên văn phòng</Label>
          <Input
            id="office-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Nội dung, Kế toán, Hỗ trợ khách hàng"
          />

          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Thôi
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
              {busy ? 'Đang tạo…' : 'Tạo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Đổi tên văn phòng đang mở.
 *
 * MÃ văn phòng (tên thư mục) KHÔNG đổi theo, và dialog nói thẳng điều đó. Đổi mã
 * là dời `artifacts/`, `tasks/`, `.state/` và mọi đường dẫn đã ghi trong receipt
 * cũ — để đổi một cái nhãn. Người dùng đổi tên vì cái nhãn đọc sai, không phải
 * vì họ muốn dời nhà; im lặng dời cả thư mục là làm nhiều hơn thứ họ yêu cầu.
 */
export function RenameOfficeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
}) {
  const officeId = useApp((s) => s.officeId);
  const current = useApp((s) => s.company?.offices.find((o) => o.id === s.officeId)?.name ?? '');
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setName(current);
  }, [open, current]);

  const trimmed = name.replace(/\s+/g, ' ').trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || busy) return;
    if (trimmed === current) return onOpenChange(false);
    setBusy(true);
    // Trùng tên do SERVER từ chối, không phải client: một client khác POST thẳng
    // vào daemon vẫn phải bị chặn. Ở đây chỉ hiện lại câu server trả về.
    const ok = await actions.renameOffice(trimmed);
    setBusy(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Đổi tên văn phòng</DialogTitle>
            <DialogDescription>
              Chỉ đổi tên hiển thị. Mã văn phòng <code>{officeId}</code> — cũng là tên thư mục chứa
              toàn bộ kết quả và lịch sử — giữ nguyên.
            </DialogDescription>
          </DialogHeader>

          <Label htmlFor="rename-office">Tên mới</Label>
          <Input
            id="rename-office"
            autoFocus
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">
            Không được trùng tên với văn phòng khác — hai dòng y hệt nhau trong ô chọn là cách chắc
            chắn nhất để gõ nhầm chỗ.
          </p>

          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Thôi
            </Button>
            <Button type="submit" variant="primary" disabled={!trimmed || busy}>
              {busy ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange(v: boolean): void }) {
  const [name, setName] = useState('');
  const [pitch, setPitch] = useState('');
  const [tier, setTier] = useState('standard');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setPitch('');
      setTier('standard');
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const ok = await actions.addAgent({ display_name: name.trim(), pitch: pitch.trim(), tier });
    setBusy(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Thêm nhân viên</DialogTitle>
            <DialogDescription>
              Sẽ tạo một file <code>roles/&lt;mã&gt;.yaml</code> có chú thích, và nối dây từ Trợ lý.
            </DialogDescription>
          </DialogHeader>

          <Label htmlFor="agent-name">Tên hiển thị</Label>
          <Input
            id="agent-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Người dựng bảng tính"
          />

          <Label htmlFor="agent-pitch" className="mt-3">
            Giới thiệu
          </Label>
          <Textarea
            id="agent-pitch"
            rows={3}
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            placeholder="Làm được việc gì, đầu ra là gì"
          />
          <p className="mt-1 text-xs text-muted">
            Giữ ngắn: dòng này nằm trong ngữ cảnh của Trợ lý suốt cả ca làm việc.
          </p>

          <Label htmlFor="agent-tier" className="mt-3">
            Mức model
          </Label>
          <Select id="agent-tier" className="w-full" value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="standard">standard — cân bằng</option>
            <option value="eco">eco — rẻ hơn nhưng chậm gấp đôi, cần nhiều lượt hơn</option>
            <option value="deep">deep — chỉ cho việc thật khó</option>
          </Select>

          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Thôi
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
              {busy ? 'Đang tạo…' : 'Tạo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Prompt phân lớp. → docs/SPEC-offices.md §4.1
 *
 * Lớp core LUÔN XEM ĐƯỢC, mặc định khoá. Giấu nó đi thì người dùng advanced
 * đoán, và đoán sai thì họ viết skills chống lại chính hệ thống.
 */
/**
 * Một lớp prompt. Lớp `editable` sửa được TẠI CHỖ.
 *
 * KHÔNG autosave — nút Lưu tường minh. Mỗi lần lưu là bump cacheKey → trả một
 * lần ghi cache. Autosave theo phím ở đây là churn cache liên tục, đắt và chậm.
 * → docs/SPEC-ui.md §2.2, SPEC-tools-approval.md §4
 */
function LayerCard({
  layer,
  who,
  affected,
  onSaved,
}: {
  layer: PromptLayer;
  who: string;
  affected: number;
  onSaved(next: PromptLayer[]): void;
}) {
  const officeId = useApp((s) => s.officeId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(layer.text);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText(layer.text);
    setEditing(false);
  }, [layer.text, layer.id]);

  // Ước lượng cùng công thức với backend (tokens.ts) để con số không nhảy khi lưu.
  const tokens = editing ? Math.ceil(text.length / 3.2) : layer.tokens;
  const over = layer.limit !== undefined && tokens > layer.limit;
  const dirty = text !== layer.text;

  async function save() {
    if (!officeId) return;
    setBusy(true);
    try {
      const res = await api.savePromptLayer(officeId, who, layer.id, text);
      onSaved(res.layers);
      setEditing(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        {layer.editable ? (
          <Pencil className="h-3.5 w-3.5 text-ok" />
        ) : (
          <Lock className="h-3.5 w-3.5 text-muted" />
        )}
        <span className="text-[13px] font-medium text-ink">{layer.title}</span>
        <span className="text-xs text-muted">{layer.editable ? 'sửa được' : 'chỉ đọc'}</span>
        <div className="flex-1" />
        <span className={`text-xs tabular-nums ${over ? 'text-danger' : 'text-muted'}`}>
          {tokens}
          {layer.limit !== undefined ? ` / ${layer.limit}` : ''} token
        </span>
        {layer.editable && !editing && (
          <Button size="iconSm" variant="ghost" aria-label="Sửa" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </header>

      <div className="px-3 py-2">
        <p className="mb-2 text-xs leading-relaxed text-muted">{layer.note}</p>
        {layer.file && (
          <p className="mb-2 text-xs text-muted">
            File: <code className="text-ink">{layer.file}</code>
          </p>
        )}

        {editing ? (
          <>
            {/*
              Placeholder là một VÍ DỤ THẬT, không phải lời dặn "hãy viết gì đó
              vào đây". Nội dung mặc định của file đi thẳng vào prefix cache của
              mọi lượt gọi, nên một dòng hướng dẫn nằm trong đó là khoản thuế
              thu mãi mãi để nói với MODEL một câu chỉ có nghĩa với NGƯỜI.
              Chỗ đúng của lời hướng dẫn là ở đây — trên giao diện, 0 token.
            */}
            <Textarea
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="font-mono text-[11.5px] leading-relaxed"
              placeholder={
                layer.placeholder ?? 'Để trống cũng được — khối này sẽ biến mất hẳn khỏi prompt.'
              }
            />
            {over && (
              <p className="mt-1.5 text-xs text-danger">
                Vượt trần {layer.limit} token. Khối này nằm trong prefix cache nên mỗi dòng thừa là chi
                phí thu suốt ca làm việc.
              </p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Lưu sẽ làm {affected} nhân viên ghi lại bộ nhớ đệm một lần.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setText(layer.text);
                  setEditing(false);
                }}
              >
                Thôi
              </Button>
              <Button size="sm" variant="primary" disabled={!dirty || over || busy} onClick={() => void save()}>
                {busy ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </div>
          </>
        ) : layer.text ? (
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-paper p-2 text-[11.5px] leading-relaxed text-muted">
            {layer.text}
          </pre>
        ) : (
          /* Trạng thái rỗng được THIẾT KẾ, không phải chữ "(trống)". Lớp trống
             là lựa chọn hợp lệ và thường là lựa chọn ĐÚNG — nói ra điều đó, rồi
             cho xem một ví dụ thật để người dùng biết hình dạng thứ cần viết. */
          <div className="rounded border border-dashed border-line bg-paper p-2">
            <p className="text-[11.5px] text-muted">
              Đang để trống — khối này không nằm trong prompt, không tốn token nào.
            </p>
            {layer.placeholder && layer.editable && (
              <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-muted opacity-60">
                {layer.placeholder}
              </pre>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function PromptDialog({ who, onClose }: { who: string | null; onClose(): void }) {
  const officeId = useApp((s) => s.officeId);
  const allowEdit = useApp((s) => s.company?.allowCorePromptEdit ?? false);
  const agentCount = useApp((s) => s.canvas?.nodes.filter((n) => n.kind === 'agent').length ?? 0);
  const [layers, setLayers] = useState<PromptLayer[] | null>(null);
  // Charter nằm trong prefix của MỌI nhân viên; skills chỉ của một người.
  const affected = who === 'assistant' ? Math.max(1, agentCount) : 1;

  useEffect(() => {
    if (!who || !officeId) return;
    setLayers(null);
    api
      .prompt(officeId, who)
      .then((r) => setLayers(r.layers))
      .catch((err) => {
        toast(err instanceof Error ? err.message : 'Không đọc được prompt.');
        onClose();
      });
  }, [who, officeId, onClose]);

  const total = layers?.reduce((n, l) => n + l.tokens, 0) ?? 0;

  return (
    <Dialog open={!!who} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(46rem,94vw)]">
        <DialogHeader>
          <DialogTitle>Prompt của {who === 'assistant' ? 'Trợ lý' : who}</DialogTitle>
          <DialogDescription>
            Xếp theo thứ tự nạp. Toàn bộ khối này nằm trong prefix được cache — khoảng{' '}
            <b className="tabular-nums">{total}</b> token, trả gần như miễn phí khi cache ấm và trả đủ giá
            mỗi lần nội dung đổi.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[58vh] overflow-y-auto px-1">
          {layers === null ? (
            <div className="py-6 text-[13px] text-muted">Đang đọc…</div>
          ) : (
            <div className="flex flex-col gap-3">
              {layers.map((l) => (
                <LayerCard
                  key={l.id}
                  layer={l}
                  who={who!}
                  onSaved={(next) => setLayers(next)}
                  affected={affected}
                />
              ))}
            </div>
          )}
        </div>

        {!allowEdit && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Lớp <b>lõi</b> đang khoá. Nó thuộc về mã nguồn chứ không thuộc về việc vận hành doanh nghiệp —
            sửa sai là phá kiến trúc chi phí. Muốn mở: đặt{' '}
            <code className="text-ink">allow_core_prompt_edit: true</code> trong{' '}
            <code className="text-ink">company.yaml</code>.
          </p>
        )}

        <DialogFooter>
          <Button onClick={onClose}>Đóng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
