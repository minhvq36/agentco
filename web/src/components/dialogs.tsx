import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Lock, Pencil } from 'lucide-react';

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
import { plural, t } from '@i18n';

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
            <DialogTitle>{t('dialog.newOffice.title')}</DialogTitle>
          </DialogHeader>

          <Label htmlFor="office-name">{t('dialog.newOffice.name')}</Label>
          <Input
            id="office-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('dialog.newOffice.placeholder')}
          />

          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
              {busy ? t('common.creating') : t('common.create')}
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
            <DialogTitle>{t('dialog.renameOffice.title')}</DialogTitle>
            <DialogDescription>
              {t('dialog.renameOffice.descBefore')} <code>{officeId}</code>{' '}
              {t('dialog.renameOffice.descAfter')}
            </DialogDescription>
          </DialogHeader>

          <Label htmlFor="rename-office">{t('dialog.renameOffice.newName')}</Label>
          <Input
            id="rename-office"
            autoFocus
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">{t('dialog.renameOffice.unique')}</p>

          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!trimmed || busy}>
              {busy ? t('common.saving') : t('common.save')}
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
            <DialogTitle>{t('dialog.newAgent.title')}</DialogTitle>
          </DialogHeader>

          <Label htmlFor="agent-name">{t('dialog.newAgent.name')}</Label>
          <Input
            id="agent-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('dialog.newAgent.namePlaceholder')}
          />

          <Label htmlFor="agent-pitch" className="mt-3">
            {t('dialog.newAgent.pitch')}
          </Label>
          <Textarea
            id="agent-pitch"
            rows={3}
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            placeholder={t('dialog.newAgent.pitchPlaceholder')}
          />
          <p className="mt-1 text-xs text-muted">{t('dialog.newAgent.pitchTip')}</p>

          <Label htmlFor="agent-tier" className="mt-3">
            {t('dialog.newAgent.tier')}
          </Label>
          <Select id="agent-tier" className="w-full" value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="standard">{t('dialog.newAgent.tierStandard')}</option>
            <option value="eco">{t('dialog.newAgent.tierEco')}</option>
            <option value="deep">{t('dialog.newAgent.tierDeep')}</option>
          </Select>

          {/*
            KHÔNG giải thích `Bash` ở đây nữa (user chốt 02/09 — app đang toàn
            chữ). Công tắc *Cho chạy lệnh trên máy* ở bảng chi tiết vẫn là chỗ
            nói ra năng lực đó, và nó nằm ngay cạnh cái công tắc thật.
            → SPEC-tools-approval.md §1b, §8
          */}
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
              {busy ? t('common.creating') : t('common.create')}
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
  /**
   * GẬP SẴN, chỉ hiện tiêu đề. (user chốt 02/09)
   *
   * Bung cả năm lớp cùng lúc thì hộp thoại thành một bức tường chữ và người
   * dùng cuộn qua nó chứ không đọc. Tiêu đề + số token đã đủ để chọn lớp cần
   * xem; phần thân là thứ chỉ có nghĩa sau khi đã chọn.
   *
   * `editing` KÉO THEO mở: sửa một khối đang gập là không nhìn thấy thứ mình gõ.
   */
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(layer.text);
  const [busy, setBusy] = useState(false);
  const show = open || editing;

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
      toast(err instanceof Error ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line">
      {/*
        Cả thanh là vùng bấm. Dùng `div` + `role="button"` chứ không phải `<button>`:
        nút bút chì nằm BÊN TRONG nó, và một nút lồng trong một nút là HTML không
        hợp lệ — trình duyệt tự gỡ lồng, rồi cú bấm rơi vào chỗ không ai đoán được.
      */}
      <header
        role="button"
        tabIndex={0}
        aria-expanded={show}
        className={`flex cursor-pointer select-none items-center gap-2 px-3 py-2 ${show ? 'border-b border-line' : ''}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${show ? '' : '-rotate-90'}`}
        />
        {layer.editable ? (
          <Pencil className="h-3.5 w-3.5 shrink-0 text-ok" />
        ) : (
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted" />
        )}
        <span className="text-[13px] font-medium text-ink">{layer.title}</span>
        <span className="text-xs text-muted">
          {layer.editable ? t('promptLayer.editable') : t('promptLayer.readOnly')}
        </span>
        <div className="flex-1" />
        <span className={`text-xs tabular-nums ${over ? 'text-danger' : 'text-muted'}`}>
          {layer.limit !== undefined
            ? plural('promptLayer.tokensOfLimit', tokens, { limit: layer.limit })
            : plural('promptLayer.tokens', tokens)}
        </span>
        {layer.editable && !editing && (
          <Button
            size="iconSm"
            variant="ghost"
            aria-label={t('promptLayer.edit', { title: layer.title })}
            // Bút chì = MỞ RA VÀ SỬA LUÔN, một cú bấm. `stopPropagation` để nó
            // không chạm vào cái toggle của thanh rồi tự gập lại ngay.
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </header>

      <div className={`px-3 py-2 ${show ? '' : 'hidden'}`}>
        <p className="mb-2 text-xs leading-relaxed text-muted">{layer.note}</p>
        {layer.file && (
          <p className="mb-2 text-xs text-muted">
            {t('promptLayer.fileLabel')} <code className="text-ink">{layer.file}</code>
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
              placeholder={layer.placeholder ?? t('promptLayer.emptyPlaceholder')}
            />
            {over && (
              <p className="mt-1.5 text-xs text-danger">
                {t('promptLayer.overLimit', { limit: layer.limit ?? 0 })}
              </p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {plural('promptLayer.affected', affected)}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setText(layer.text);
                  setEditing(false);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button size="sm" variant="primary" disabled={!dirty || over || busy} onClick={() => void save()}>
                {busy ? t('common.saving') : t('common.save')}
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
  /*
    KHÔNG đọc `allowCorePromptEdit` ở đây. `layer.editable` do server tính và
    ĐÃ gồm cờ đó (`prompt.ts §PromptLayer.editable`), còn `PUT` thì tự từ chối
    lớp lõi. Giữ một bản sao ở client là hai chỗ nói về cùng một quyền — kiểu
    gì cũng có một chỗ bị quên khi luật đổi.
  */
  const agentCount = useApp((s) => s.canvas?.nodes.filter((n) => n.kind === 'agent').length ?? 0);
  const [layers, setLayers] = useState<PromptLayer[] | null>(null);
  // Charter nằm trong prefix của MỌI nhân viên; skills chỉ của một người.
  const affected = who === 'assistant' ? Math.max(1, agentCount) : 1;

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 `onClose` KHÔNG được nằm trong deps — bug user báo 02/09.             │
   * │                                                                          │
   * │ Chỗ gọi truyền một arrow dựng lại mỗi lần render (`onClose={() =>        │
   * │ setPromptFor(null)}`), nên **mỗi lần App vẽ lại** là deps đổi ⇒ effect   │
   * │ chạy lại ⇒ `setLayers(null)` ⇒ hộp thoại nháy về "Đang đọc…" rồi tải     │
   * │ lại. Người dùng đang sửa dở một lớp thì mất luôn phần vừa gõ.            │
   * │                                                                          │
   * │ Triệu chứng thấy được cần MỘT thứ vẽ App liên tục, và 02/09 có thật:     │
   * │ vòng lặp `GET /library` (xem `library/store.ts §pump`). Nhưng bản vá bên  │
   * │ đó chỉ dập cái máy phát — ô này vẫn phải đúng, vì `canvas` đổi là chuyện  │
   * │ bình thường (nhân viên bắt đầu chạy, kéo một node…) và không lần nào      │
   * │ trong số đó được phép xoá thứ người dùng đang gõ.                        │
   * │                                                                          │
   * │ ⇒ Effect chỉ phụ thuộc **thứ nó thật sự đọc**: đang xem prompt của AI,   │
   * │ ở văn phòng nào. `onClose` đi qua ref — nó là đường THOÁT, không phải     │
   * │ đầu vào của phép tải.                                                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!who || !officeId) return;
    setLayers(null);
    api
      .prompt(officeId, who)
      .then((r) => setLayers(r.layers))
      .catch((err) => {
        toast(err instanceof Error ? err.message : t('promptLayer.loadFailed'));
        closeRef.current();
      });
  }, [who, officeId]);

  // const total = layers?.reduce((n, l) => n + l.tokens, 0) ?? 0;

  return (
    <Dialog open={!!who} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(46rem,94vw)]">
        <DialogHeader>
          <DialogTitle>
            {t('promptLayer.title', { who: who === 'assistant' ? t('chat.assistant') : (who ?? '') })}
          </DialogTitle>
        </DialogHeader>

        <div className="-mx-1 max-h-[58vh] overflow-y-auto px-1">
          {layers === null ? (
            <div className="py-6 text-[13px] text-muted">{t('common.reading')}</div>
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

        <DialogFooter>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
