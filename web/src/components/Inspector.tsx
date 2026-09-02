import { useEffect, useState } from 'react';
import { Archive, FileCode2, Globe, Pencil, ScrollText, Trash2, X } from 'lucide-react';

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
import { api } from '@/lib/api';
import { actions, useApp } from '@/lib/store';
import type { ArmCall, CanvasNode } from '@/lib/types';
import { plural, t, type MessageKey } from '@i18n';
import { formatDateTime } from '@i18n/fmt';

/**
 * Sửa hồ sơ nhân viên tại chỗ. → docs/SPEC-tools-approval.md §1
 *
 * KHÔNG autosave. Sửa `pitch` bump cacheKey của Trợ lý (pitch nằm trong roster
 * của nó). Nút Lưu tường minh và nói ra cái giá — cùng luật với skills.
 *
 * Mức model CỐ Ý không nằm trong form này nữa: nó có ô riêng (`ModelPicker`),
 * đúng một chỗ, dùng chung với Trợ lý. Cùng một thứ sửa được ở hai nơi là kiểu
 * gì rồi cũng có một nơi bị quên khi luật đổi.
 */
function AgentProfile({ node }: { node: CanvasNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(node.label);
  const [pitch, setPitch] = useState(node.pitch ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(node.label);
    setPitch(node.pitch ?? '');
    setOpen(false);
  }, [node.id, node.label, node.pitch]);

  const dirty = name !== node.label || pitch !== (node.pitch ?? '');

  if (!open) {
    return (
      <>
        {node.pitch && <Note>{node.pitch}</Note>}
        <button
          className="mb-3 flex items-center gap-1.5 text-[13px] text-accent hover:underline"
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
          {t('inspector.editProfile')}
        </button>
      </>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-line p-3">
      <Label htmlFor="ag-name">{t('inspector.displayName')}</Label>
      <Input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} />

      <Label htmlFor="ag-pitch" className="mt-3">
        {t('inspector.pitch')}
      </Label>
      <Textarea id="ag-pitch" rows={3} value={pitch} onChange={(e) => setPitch(e.target.value)} />

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setOpen(false)}>
          {t('common.cancel')}
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
            });
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Đổi tên Trợ lý.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ô NÀY CỐ Ý *KHÔNG* CÓ CÂU CẢNH BÁO VỀ CACHE — và đó là thông tin.        │
 * │                                                                          │
 * │ Nó nằm ngay trên `ModelPicker`, thứ có nguyên một đoạn giải thích về bộ  │
 * │ nhớ đệm. Hai nút giống hệt nhau về hình dạng mà khác hẳn nhau về giá:    │
 * │ `display_name` **không nằm trong prompt của ai cả** (roster chỉ liệt kê  │
 * │ NHÂN VIÊN), nên đổi nó không ghi lại cache, không mất trí nhớ, không     │
 * │ đụng session.                                                            │
 * │                                                                          │
 * │ Dán một câu cảnh báo chung lên cả hai là dạy người dùng bỏ qua cảnh báo  │
 * │ — rồi họ bỏ qua đúng cái đáng đọc. Im lặng ở đây là một lựa chọn.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function AssistantName({ node }: { node: CanvasNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(node.label);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(node.label);
    setOpen(false);
  }, [node.id, node.label]);

  const trimmed = name.replace(/\s+/g, ' ').trim();

  if (!open) {
    return (
      <button
        className="mb-3 flex items-center gap-1.5 text-[13px] text-accent hover:underline"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-3.5 w-3.5" />
        {t('inspector.renameAssistant')}
      </button>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-line p-3">
      <Label htmlFor="as-name">{t('inspector.displayName')}</Label>
      <Input
        id="as-name"
        autoFocus
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('inspector.assistantNamePlaceholder')}
      />
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        {t('inspector.assistantNameNoteBefore')} <b>{t('inspector.assistantNameNoteBold')}</b>{' '}
        {t('inspector.assistantNameNoteAfter')}
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!trimmed || trimmed === node.label || busy}
          onClick={async () => {
            setBusy(true);
            const ok = await actions.renameAssistant(trimmed);
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CỬA ĐĂNG NHẬP BẰNG TAY — mở một cửa sổ trình duyệt THƯỜNG vào đúng hồ sơ │
 * │ mà nhân viên dùng. → `core/browser-login.ts`                             │
 * │                                                                          │
 * │ Ca sinh ra nó (user 29/08, bốn lần thử): *"tui đang đăng nhập dở bằng    │
 * │ sđt mà, chờ xíu đi"* · *"đến bước setup địa chỉ thì nó lại tắt của tôi"*. │
 * │ Vòng đời trình duyệt của nhân viên = vòng đời một LƯỢT VIỆC, nên không có │
 * │ chỗ nào trong đó để một con người thao tác.                              │
 * │                                                                          │
 * │ ⚠ Nút này KHÔNG nhận mật khẩu và không bao giờ được nhận: nhận là agentco │
 * │ thành nơi giữ mật khẩu. Nó chỉ mở đúng một cửa sổ tới đúng một địa chỉ.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function BrowserLogin() {
  const officeId = useApp((s) => s.officeId);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);

  if (!officeId) return null;
  return (
    <div className="mb-3 rounded-lg border border-line p-3">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 shrink-0 text-muted" />
        <span className="text-[13px] font-medium">{t('inspector.browserLoginTitle')}</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        {opened ? (
          <>
            {t('inspector.browserOpenedBefore')} <b>{t('inspector.browserOpenedBold')}</b>{' '}
            {t('inspector.browserOpenedAfter')}
          </>
        ) : (
          <>
            {t('inspector.browserIdleBefore')} <b>{t('inspector.browserIdleBold')}</b>{' '}
            {t('inspector.browserIdleAfter')}
          </>
        )}
      </p>
      {err && <p className="mt-1.5 text-xs text-danger">{err}</p>}
      <Button
        size="sm"
        variant="primary"
        className="mt-3"
        disabled={busy}
        onClick={() => void go()}
      >
        {busy
          ? t('inspector.browserOpening')
          : opened
            ? t('inspector.browserReopen')
            : t('inspector.browserOpen')}
      </Button>
    </div>
  );

  async function go() {
    setBusy(true);
    setErr('');
    try {
      // Không gửi `url`: mở trình duyệt của văn phòng là đủ, người dùng tự gõ
      // địa chỉ trong cửa sổ. Bắt gõ trước là thêm một bước cho cùng kết quả.
      await api.browserLogin(officeId!);
      setOpened(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NHẬT KÝ KIỂM TOÁN — VÀ VÌ SAO NÓ NẰM Ở ĐÂY, không ở một ngăn kéo riêng.  │
 * │ (user hỏi 26/08: *"nó nên thuộc object nào trên UI?"*)                   │
 * │                                                                          │
 * │ Ba ngăn kéo bên trái (Kết quả · Tủ tài liệu · Kho tri thức) đều là **nội  │
 * │ dung của người dùng**. Một cuốn nhật ký không phải nội dung — thêm ngăn   │
 * │ thứ tư là bắt MỌI người học một khái niệm nữa, kể cả người sẽ không bao   │
 * │ giờ mở nó. Đúng thứ user cảnh báo: *"người nocode vào cũng đâu hiểu gì"*. │
 * │                                                                          │
 * │ Chỗ đúng là **object sở hữu rủi ro**: cánh tay. Bảng này đã nói *"nó LÀM  │
 * │ ĐƯỢC gì"* (huy hiệu mức quyền, số việc); nhật ký nói *"nó ĐÃ LÀM gì"*.    │
 * │ Hai vế của cùng một câu hỏi, nên chúng đứng cạnh nhau.                    │
 * │                                                                          │
 * │ Và nó **tự phân tầng người dùng** mà không cần một chế độ "nâng cao" nào: │
 * │ phải bấm vào một node 🔌 mới thấy, và ai bấm vào node 🔌 thì đã đi qua    │
 * │ ngưỡng đó rồi.                                                           │
 * │                                                                          │
 * │ ⚠ Mặc định ĐÓNG. Nó có thể dài hàng trăm dòng, và bảng chi tiết là chỗ    │
 * │ người ta vào để đổi tên hoặc rút dây — không phải để đọc log.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function ArmLog({ server }: { server: string }) {
  const officeId = useApp((s) => s.officeId);
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState<ArmCall[] | null>(null);

  // Chỉ nạp khi MỞ: một cánh tay chạy lâu có hàng trăm dòng, và nạp sẵn cho mỗi
  // lần bấm vào node là trả giá cho một thứ hầu như không ai xem.
  useEffect(() => {
    if (!open || !officeId) return;
    setCalls(null);
    api
      .armLog(officeId, server)
      .then((r) => setCalls(r.calls))
      .catch(() => setCalls([]));
  }, [open, officeId, server]);

  return (
    <div className="mt-4 border-t border-line pt-3">
      <button
        className="flex w-full items-center gap-1.5 text-[13px] text-accent hover:underline"
        onClick={() => setOpen((v) => !v)}
      >
        <ScrollText className="h-3.5 w-3.5" />
        {open ? t('inspector.hideLog') : t('inspector.showLog')}
      </button>

      {open && (
        <div className="mt-2">
          {calls === null && <p className="text-xs text-muted">{t('common.reading')}</p>}
          {calls?.length === 0 && (
            <p className="text-xs leading-relaxed text-muted">
              {t('inspector.noCallsBefore')} <b>{t('inspector.noCallsBold')}</b>{' '}
              {t('inspector.noCallsAfter')}
            </p>
          )}
          {calls?.map((c, i) => (
            <ArmLogRow key={`${c.ts}-${i}`} call={c} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Một dòng: **AI · LÀM GÌ · LÚC NÀO**, tham số giấu sau một cú bấm.
 *
 * Tham số là thứ đắt nhất của cuốn nhật ký (nó trả lời *"nó đã ghi GÌ vào
 * Notion"*) và cũng là thứ dài nhất. Bày hết ra thì 20 lời gọi thành một bức
 * tường JSON và người ta thôi đọc — tức mất luôn cả những dòng đáng đọc.
 */
function ArmLogRow({ call }: { call: ArmCall }) {
  const [show, setShow] = useState(false);
  const when = new Date(call.ts);
  const stamp = Number.isNaN(when.getTime()) ? call.ts : formatDateTime(when);

  return (
    <div className="border-b border-line/60 py-1.5 last:border-0">
      <button className="w-full text-left" onClick={() => setShow((v) => !v)}>
        <div className="flex items-baseline gap-1.5 text-[12.5px]">
          {/* Tên việc NGUYÊN VĂN, không qua bảng dịch viết tay: bảng đó đúng cho
              một hãng và câm cho mọi hãng khác — cùng lý lẽ `describeCall`. */}
          <span className="min-w-0 flex-1 truncate font-medium">{call.tool.replace(/_/g, ' ')}</span>
          <span className="flex-none tabular-nums text-[11px] text-muted">{stamp}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted">
          {call.role}
          {call.task_id ? ` · ${call.task_id}` : ''}
        </div>
      </button>
      {show && (
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-line/40 p-2 text-[11px] leading-relaxed text-ink">
          {pretty(call.args)}
          {call.truncated ? t('inspector.argsTruncated') : ''}
        </pre>
      )}
    </div>
  );
}

/** JSON cho dễ đọc; hỏng thì hiện nguyên văn — đừng nuốt thứ duy nhất còn lại. */
function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Keys, not sentences — a module-level string would freeze the load-time locale. */
const TIER_HINT: Record<string, MessageKey> = {
  eco: 'inspector.tier.eco',
  standard: 'inspector.tier.standard',
  deep: 'inspector.tier.deep',
};

/**
 * Ô đổi model. MỘT component cho cả Trợ lý và nhân viên.
 * → docs/SPEC-offices.md §4.5
 *
 * Hai bên khác nhau đúng hai điểm, và cả hai đều là SỰ THẬT về cái giá phải trả:
 *
 *  - Trợ lý có tuỳ chọn "theo mặc định công ty", và đổi nó làm mất prompt cache
 *    một lượt (nó chạy `resume`, nên lượt đó gửi lại cả bản ghi hội thoại).
 *    Trí nhớ KHÔNG mất — bản ghi nằm trên đĩa, độc lập với model.
 *  - Nhân viên là hàm không trạng thái: đổi model không mất gì cả.
 *
 * Nói ra khác nhau đó thay vì một câu cảnh báo chung, vì một câu chung thì hoặc
 * doạ người dùng ở chỗ không đáng, hoặc trấn an ở chỗ đáng lo.
 */
function ModelPicker({ node }: { node: CanvasNode }) {
  const isAssistant = node.kind === 'assistant';
  const companyDefault = useApp((s) => s.company?.models.master ?? 'standard');
  const models = useApp((s) => s.company?.models);
  const [open, setOpen] = useState(false);
  const current = isAssistant && node.tierInherited ? '' : (node.tier ?? 'standard');
  const [tier, setTier] = useState(current);
  const [busy, setBusy] = useState(false);
  // Giữ dạng CHUỖI trong lúc gõ: number state biến "" thành 0 giữa chừng, và 0
  // ở đây mang nghĩa "không giới hạn" — người dùng xoá ô để sửa sẽ vô tình bỏ trần.
  const [usd, setUsd] = useState(String(node.maxUsd ?? 0));
  const [turns, setTurns] = useState(String(node.maxTurns ?? 6));

  useEffect(() => {
    setTier(isAssistant && node.tierInherited ? '' : (node.tier ?? 'standard'));
    setUsd(String(node.maxUsd ?? 0));
    setTurns(String(node.maxTurns ?? 6));
    setOpen(false);
  }, [node.id, node.tier, node.tierInherited, node.maxUsd, node.maxTurns, isAssistant]);

  const usdNum = Number(usd);
  const turnsNum = Number(turns);
  const limitsOk =
    Number.isFinite(usdNum) && usdNum >= 0 && Number.isInteger(turnsNum) && turnsNum >= 1;
  const limitsDirty = !isAssistant && (usdNum !== (node.maxUsd ?? 0) || turnsNum !== (node.maxTurns ?? 6));

  const effective = tier || companyDefault;

  if (!open) {
    return (
      <>
        <Row
          k={t('inspector.modelTier')}
          v={
            <>
              {node.tier}
            </>
          }
        />
        <Row
          k={t('inspector.model')}
          v={<span className="font-mono text-[11.5px]">{node.model}</span>}
        />
        {!isAssistant && (
          <Row
            k={t('inspector.perJobLimit')}
            v={
              <>
                {node.maxUsd
                  ? t('inspector.maxUsd', { n: node.maxUsd })
                  : t('inspector.noMoneyLimit')}
                {` · ${plural('inspector.stepCount', node.maxTurns ?? 6)}`}
              </>
            }
          />
        )}
        <button
          className="mt-2 flex items-center gap-1.5 text-[13px] text-accent hover:underline"
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
          {isAssistant ? t('inspector.changeModel') : t('inspector.changeModelLimits')}
        </button>
      </>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-line p-3">
      <Label htmlFor="tier-pick">{t('inspector.modelTier')}</Label>
      <Select
        id="tier-pick"
        className="w-full"
        value={tier}
        onChange={(e) => setTier(e.target.value)}
      >
        {isAssistant && (
          <option value="">{t('inspector.companyDefault', { default: companyDefault })}</option>
        )}
        <option value="eco">{t(TIER_HINT['eco']!)}</option>
        <option value="standard">{t(TIER_HINT['standard']!)}</option>
        <option value="deep">{t(TIER_HINT['deep']!)}</option>
      </Select>
      {models && (
        <p className="mt-1.5 font-mono text-[11.5px] text-muted">
          {models[effective as 'eco' | 'standard' | 'deep']}
        </p>
      )}

      {/*
        Giới hạn nằm CHUNG ô với mức model, không tách màn hình riêng: người dùng
        đổi tier là lúc duy nhất họ nghĩ về cái giá, và cùng một việc trên `deep`
        đắt gấp mấy lần trên `eco`. Tách ra là bắt họ nhớ quay lại sửa lần hai.
      */}
      {!isAssistant && (
        <div className="mt-4 border-t border-line pt-3">
          <Label htmlFor="lim-usd">{t('inspector.limitOneJob')}</Label>
          <div className="mt-1.5 flex gap-2">
            <div className="flex-1">
              <Input
                id="lim-usd"
                type="number"
                min="0"
                step="0.5"
                value={usd}
                onChange={(e) => setUsd(e.target.value)}
              />
              <p className="mt-1 text-[11.5px] text-muted">{t('inspector.maxSpendHint')}</p>
            </div>
            <div className="flex-1">
              <Input
                id="lim-turns"
                type="number"
                min="1"
                step="1"
                value={turns}
                onChange={(e) => setTurns(e.target.value)}
              />
              <p className="mt-1 text-[11.5px] text-muted">{t('inspector.maxStepsHint')}</p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !limitsOk || (tier === current && !limitsDirty)}
          onClick={async () => {
            setBusy(true);
            const ok = isAssistant
              ? await actions.setAssistantTier(tier || null)
              : await actions.editAgent(node.role!, {
                  model_tier: tier,
                  max_usd: usdNum,
                  max_turns: turnsNum,
                });
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}


/**
 * Công tắc `Bash`. → docs/SPEC-tools-approval.md §5
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CÔNG TẮC DUY NHẤT VỀ KHẢ NĂNG TRONG CẢ SẢN PHẨM — và đó là chủ ý.        │
 * │                                                                          │
 * │ Sáu tool còn lại bật sẵn, không tắt được, vì chúng chỉ chạm tới thư mục  │
 * │ văn phòng hoặc chỉ đọc web. Hỏi người dùng bật `WebSearch` cho một nhân  │
 * │ viên tên "Người tìm tin" là hỏi một câu chỉ có một đáp án.                │
 * │                                                                          │
 * │ `Bash` khác HẲN về loại, không khác về mức: nó là thứ duy nhất ra được   │
 * │ khỏi văn phòng. Cụ thể — và câu này phải nói thẳng ra ở giao diện, không  │
 * │ chỉ nằm trong spec:                                                      │
 * │                                                                          │
 * │  · LUẬT "kết quả luôn sinh ra trong văn phòng" được thi hành bằng hook   │
 * │    `PreToolUse` khớp `Write|Edit|NotebookEdit` (worker.ts §officeJail).  │
 * │    `Bash` KHÔNG nằm trong matcher đó, và không thể nằm: đường dẫn của    │
 * │    một lệnh shell nằm trong chuỗi lệnh, không nằm ở một trường có tên.   │
 * │    Bật công tắc này là tự tay mở một cửa mà cái hook kia không canh.      │
 * │  · Cổng duyệt `write_external` ở SPEC §8 CHƯA được cài. Nên hôm nay      │
 * │    không có tầng chặn nào phía sau công tắc này cả.                      │
 * │                                                                          │
 * │ ⇒ Câu cảnh báo ở đây không phải thủ tục. Nó là tầng bảo vệ DUY NHẤT, nên │
 * │   nó nói ĐÚNG hậu quả ("đọc và ghi bất cứ đâu trên máy bạn") thay vì một │
 * │   câu chung chung kiểu "hãy cân nhắc".                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function BashSwitch({ node }: { node: CanvasNode }) {
  const on = !!node.bash;
  const [busy, setBusy] = useState(false);

  return (
    <div className={`mt-4 rounded-lg border p-3 ${on ? 'border-warn' : 'border-line'}`}>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 flex-none accent-accent"
          checked={on}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            await actions.editAgent(node.role!, { bash: e.target.checked });
            setBusy(false);
          }}
        />
        {/*
          Chỉ còn cái nhãn. Câu tả năng lực đã bỏ 02/09 (app đang toàn chữ) —
          thứ ở lại là câu CẢNH BÁO ngay dưới, và nó chỉ hiện khi công tắc BẬT.
          Một câu nói về hậu quả, đúng lúc có hậu quả, đáng hơn ba câu tả tính
          năng đọc trước khi người ta kịp quyết.
        */}
        <span className="min-w-0">
          <span className="block text-[13px] text-ink">{t('inspector.bashLabel')}</span>
        </span>
      </label>

      {/*
        ┌────────────────────────────────────────────────────────────────────┐
        │ ⚠ VIẾT LẠI 22/08 — CÂU CŨ VỪA DOẠ QUÁ TAY VỪA HỨA QUÁ TAY.        │
        │                                                                    │
        │ Cũ: *"đọc và ghi được bất cứ đâu trên máy bạn"* + *"ngoại lệ duy   │
        │ nhất của luật kết quả luôn nằm trong văn phòng"*.                   │
        │                                                                    │
        │ Sai ở hai đầu:                                                     │
        │  · KHÔNG phải ngoại lệ duy nhất về ĐỌC — `Read`/`Glob`/`Grep`      │
        │    cũng không có hàng rào nào (types.ts §BUILTIN_TOOLS).            │
        │  · "Ghi bất cứ đâu" thì đúng về mặt kỹ thuật nhưng SAI về mặt sản  │
        │    phẩm: `outputScoper` luôn kéo đầu ra về `artifacts/`, nên kế     │
        │    hoạch chưa bao giờ trỏ `Bash` ra ngoài. Ca 22/08 22:06 thử lối   │
        │    đó: 7 lượt · $0,3158 · blocked, không ra file nào.               │
        │                                                                    │
        │ Doạ quá tay làm người dùng tắt một thứ họ cần; hứa quá tay làm họ   │
        │ bật để mua một thứ không tồn tại. Cái sau tệ hơn.                   │
        │                                                                    │
        │ Câu mới giữ đúng MỘT cảnh báo, và nó có thật: lệnh chạy bằng quyền  │
        │ của chính người dùng. Chính sách "ghi ra ngoài phải qua tool/MCP    │
        │ tường minh" → SPEC-tools-approval.md §1b, §8.                       │
        └────────────────────────────────────────────────────────────────────┘
      */}
      {on && (
        <p className="mt-2.5 rounded bg-warn-soft px-2 py-1.5 text-xs leading-relaxed text-warn">
          {t('inspector.bashWarnBefore')} <b>{t('inspector.bashWarnBold')}</b>{' '}
          {t('inspector.bashWarnAfter')}
        </p>
      )}
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

/**
 * CÁNH TAY MỘT NGƯỜI ĐANG CẦM — hiện NHÃN, không hiện BĂM.
 *
 * Bản trước in thẳng `node.mcp.join(', ')`, ra `a385afc3ab6, a4fbabd0360`. Đó là
 * **cùng một con bug** đã vá ở nhật ký công việc 24/08, chỉ khác chỗ nó nằm: băm
 * là DANH TÍNH, không phải thứ để đọc. Người dùng đặt tên "Musics" thì mọi chỗ
 * phải nói "Musics" — bảng chi tiết cũng là một chỗ.
 *
 * Nhãn tra qua chính node 🔌 trên sơ đồ nên không cần dữ liệu mới. Rơi về băm khi
 * cánh tay đã biến khỏi `company.yaml`: lúc đó băm là thứ DUY NHẤT còn thật, và
 * nó khớp với dòng `Không còn khai trong company.yaml` ở panel của node kia.
 *
 * Nhãn ô cũ là *"Tool ngoài"* — từ vựng của người viết code. Người dùng kéo dây
 * từ một node tên **Kết nối**, nên ô này nói cùng thứ tiếng đó.
 */
function ArmList({ ids, nodes }: { ids?: string[]; nodes: CanvasNode[] }) {
  if (!ids?.length) return null;
  const name = (id: string) => nodes.find((n) => n.kind === 'mcp' && n.server === id)?.label ?? id;
  return <Row k={t('inspector.armsInUse')} v={ids.map(name).join(', ')} />;
}

/**
 * THƯ MỤC CÁNH TAY — chỉ đọc, và "chỉ đọc" ở đây là một câu về DANH TÍNH.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO KHÔNG PHẢI MỘT Ô NHẬP.                                            │
 * │                                                                          │
 * │ Nhãn sửa được vì nhãn không phải danh tính. Thư mục thì NẰM TRONG cấu     │
 * │ hình, mà danh tính = `armHash(cấu hình)` — nên "sửa thư mục" không phải   │
 * │ một phép sửa, nó là **một cánh tay khác**. Cho sửa tại chỗ là dựng lại    │
 * │ đúng ca GHI ĐÈ IM LẶNG mà §6i sinh ra để chặn: node y nguyên, mọi sợi     │
 * │ dây y nguyên, chỉ thư mục bên dưới đổi — **không có triệu chứng ở chỗ nó  │
 * │ nằm**. Đường đi đúng là `+ Kết nối` một cái mới rồi rút cái cũ.           │
 * │                                                                          │
 * │ Nhưng PHẢI HIỆN: đây là thứ trả lời câu *"nhân viên này với tới đâu"* —   │
 * │ hôm nay người dùng chỉ đọc được nó bằng cách mở `company.yaml`, mà một    │
 * │ bước "mở file yaml" là một chuông báo (§6, chốt 22/08).                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Hiện NGUYÊN VĂN, không chuẩn hoá dấu gạch và không dò hệ điều hành. Chuỗi
 * này để người dùng đối chiếu bằng mắt với Explorer/Finder, nên nó phải là thứ
 * họ đã nhập — `D:\…` trên Windows, `/home/…` trên Linux/macOS, và một văn phòng
 * zip từ máy khác hệ vẫn hiện đúng thứ đã ghi. `folderRoots` cố ý nhận cả hai
 * kiểu ở mọi nền tảng, cùng lý do `SHELL_ALIASES` gửi cả hai tên tool.
 *
 * Rỗng ⇒ KHÔNG vẽ gì: cánh tay Notion/GitHub không có thư mục nào, và một ô
 * trống nói dối rằng cấu hình bị thiếu.
 */
function ArmFolders({ folders }: { folders?: string[] }) {
  if (!folders?.length) return null;
  return (
    <div className="border-b border-line py-1.5 text-[13px] last:border-0">
      <div className="text-ink">{t('inspector.reachableFolders')}</div>
      <ul className="mt-1 space-y-0.5">
        {folders.map((f) => (
          // `break-all`: đường dẫn Windows có khoảng trắng lẫn dấu gạch ngược,
          // không ngắt dòng được ở chỗ tử tế nào. Thà xuống dòng giữa chừng còn
          // hơn tràn ngang cả panel.
          <li key={f} className="select-all break-all font-mono text-xs text-muted">
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * ĐỔI TÊN KẾT NỐI — và nó CỐ Ý không có câu cảnh báo nào.
 *
 * Nhãn không phải danh tính (danh tính là băm cấu hình), nên đổi nó không đụng
 * khoá, không viết lại `roles/*.yaml`, không phá cache của ai. Dán một câu
 * cảnh báo lên đây là dạy người dùng bỏ qua cảnh báo — rồi họ bỏ qua đúng cái
 * đáng đọc, y như lý do `renameAssistant` không có cảnh báo.
 */
function ArmName({ node }: { node: CanvasNode }) {
  const [text, setText] = useState(node.label);
  useEffect(() => setText(node.label), [node.label]);
  const dirty = text.trim() !== node.label && text.trim().length > 0;

  return (
    <div className="mt-3">
      {/*
        ┌──────────────────────────────────────────────────────────────────────┐
        │ HUY HIỆU MỨC QUYỀN — **SUY TỪ `level`, KHÔNG ĐỌC CHUỖI TÊN**.        │
        │                                                                      │
        │ User hỏi 25/08 *"thêm quyền vào tên có hơi lủng không"* — có. Nhãn là │
        │ của người dùng, đổi tự do (§6i). Nhét `· chỉ đọc` vào chuỗi thì một   │
        │ cú đổi tên tạo ra được **"Notion (ghi được)" trên một cánh tay chỉ    │
        │ đọc** — nhãn nói dối về ĐẶC QUYỀN, đúng con bug "lời hứa rỗng" đã gỡ  │
        │ ở bài 11 bước 5.                                                     │
        │                                                                      │
        │ Nên: hai lớp. Lớp ngoài (tên) đổi được; lớp trong (huy hiệu) thì      │
        │ không — nó đọc `arms[băm].level`, thứ nằm trong chính cái băm. Ô nhập │
        │ ngay dưới **không** với tới được nó, và đó là toàn bộ điểm.           │
        └──────────────────────────────────────────────────────────────────────┘
      */}
      {(node.level || node.via || node.optionLabels?.length) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {/*
            CÁCH CHẠY — *"nhìn vào panel là biết đang cấu hình thế nào"* (user 29/08).

            Suy từ **cấu hình đã lưu** (`catalog.ts §activeOptions`), không từ một
            danh sách id cất riêng: hai nguồn cho cùng một sự thật thì nguồn sai sẽ
            là nguồn HIỂN THỊ — người dùng đọc một cấu hình không phải cấu hình
            đang chạy, và đó là kiểu nói dối khó phát hiện nhất.
          */}
          {node.optionLabels?.map((t) => (
            <span key={t} className="rounded bg-line/70 px-1.5 py-0.5 text-[11px] text-muted">
              {t}
            </span>
          ))}
          {/* Workspace NÀO — user 26/08. Tra từ tên chìa, không đọc chuỗi tên. */}
          {node.via && (
            <span className="rounded bg-line/70 px-1.5 py-0.5 text-[11px] text-muted">{node.via}</span>
          )}
          {node.level && (
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                node.level === 'full' ? 'bg-danger-soft text-danger' : 'bg-line/70 text-muted'
              }`}
            >
              {node.level === 'read'
                ? t('inspector.level.read')
                : node.level === 'add'
                  ? t('inspector.level.add')
                  : t('inspector.level.full')}
            </span>
          )}
          {node.toolCount ? (
            <span className="text-[11px] tabular-nums text-muted">
              {plural('inspector.toolCount', node.toolCount)}
            </span>
          ) : null}
        </div>
      )}
      {/*
        ⚠ ĐỨNG RIÊNG, KHÔNG NẰM CHUNG HÀNG CHIP. (user chốt 29/08)

        Chip là **trạng thái** — thứ để đọc. Nút này là **hành động**, và là hành
        động duy nhất trong bảng này mở một cửa sổ ra ngoài agentco. Trộn hai loại
        vào một hàng thì mắt lướt qua nó như lướt qua một cái nhãn.
      */}
      {node.canLogin && <BrowserLogin />}
      <label className="text-[11px] uppercase tracking-wide text-muted">
        {t('inspector.displayName')}
      </label>
      <div className="mt-1 flex gap-1.5">
        <Input value={text} onChange={(e) => setText(e.target.value)} />
        <Button
          disabled={!dirty}
          onClick={() => void actions.renameArm(node.server!, text.trim())}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

/** Bảng chi tiết bên phải. Mở khi chọn một node; ✕ để đóng. */
export function Inspector({ onShowPrompt }: { onShowPrompt(who: string): void }) {
  const canvas = useApp((s) => s.canvas);
  const selected = useApp((s) => s.selected);
  const [confirmRemove, setConfirmRemove] = useState<CanvasNode | null>(null);

  const node = canvas?.nodes.find((n) => n.id === selected);
  if (!canvas || !node) return null;

  /**
   * Node KHO không bao giờ có bảng chi tiết.
   *
   * Bảng này để CHỈNH một đối tượng. Kho tri thức và tủ tài liệu không có gì để
   * chỉnh — chúng là cửa dẫn tới một ngăn kéo, và bấm vào chúng mở thẳng ngăn
   * kéo đó (xem `onOpenStore` trong Canvas.tsx).
   *
   * Chốt đặt ở ĐÂY chứ không phải ở chỗ gọi, vì nó chặn cả LỚP lỗi: bản trước
   * tủ tài liệu chưa có nhánh render nên bấm vào nó mở ra một bảng rỗng chỉ có
   * dấu ✕ — và mỗi node kho thêm vào sau này sẽ lặp lại đúng như thế nếu ai đó
   * quên viết nhánh. Giờ quên cũng không sao.
   */
  if (node.kind === 'knowledge' || node.kind === 'library') return null;

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
        <Button
          size="iconSm"
          variant="ghost"
          aria-label={t('common.close')}
          onClick={() => actions.select(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {node.kind === 'assistant' && (
          <>
            <AssistantName node={node} />
            <ModelPicker node={node} />
            <Row k={t('inspector.onDuty')} v={plural('inspector.peopleCount', onDuty.length)} />
            <Row k={t('inspector.offDuty')} v={plural('inspector.peopleCount', off.length)} />
            <Row
              k={t('inspector.ownNotebook')}
              v={plural('knowledge.noteCount', node.count ?? 0)}
            />
            <ArmList ids={node.mcp} nodes={canvas.nodes} />
            <Note>
              {t('inspector.rosterNoteBefore')} <b>{t('inspector.rosterNoteBold')}</b>{' '}
              {t('inspector.rosterNoteAfter')}
            </Note>
            <Button className="w-full" onClick={() => onShowPrompt('assistant')}>
              <FileCode2 className="h-4 w-4" />
              {t('inspector.viewPrompt')}
            </Button>
          </>
        )}

        {/*
          Nhánh `knowledge` đã BỎ (17/08). Hai đoạn giải thích của nó không mất
          — chúng chuyển vào chính ngăn kéo Tri thức, nơi chúng vốn thuộc về:
          đó là sự thật về cái KHO, không phải về cái node trên sơ đồ.
        */}

        {node.kind === 'mcp' && (
          <>
            <Row k={t('inspector.type')} v="MCP server" />
            <Row
              k={t('inspector.inUseBy')}
              v={
                canvas.edges
                  .filter((e) => e.from === node.id)
                  .map((e) => canvas.nodes.find((n) => n.id === e.to)?.label ?? e.to)
                  .join(', ') || t('inspector.nobody')
              }
            />
            <ArmFolders folders={node.folders} />
            {node.missing && (
              <Note>
                <span className="text-danger">{t('inspector.missingArm')}</span>
              </Note>
            )}
            {/*
              ĐÃ BỎ: *"Nối vào một nhân viên = ghi `mcp:` vào `roles/<id>.yaml`"*.

              Nó mô tả **cách ta lưu**, không mô tả thứ người dùng làm — họ kéo
              một sợi dây, và cái file yaml là chuyện của ta. Cùng luật với hai
              khối bên dưới: một dòng chỉ đáng ở lại nếu nó đổi được việc người
              dùng sắp làm.
            */}

            {/*
              HAI MỨC, đúng như nhân viên có "Cho nghỉ" và "Cất đi" — ranh giới
              là *dựng lại được hay không*:

                Gỡ khỏi văn phòng  cắt mọi sợi dây ở ĐÂY. Cấu hình và chìa còn
                                   nguyên ở cấp công ty, nên nó quay lại qua
                                   "đã cắm ở văn phòng khác" trong `+ Kết nối`.
                Xoá hẳn            bỏ khỏi company.yaml. ⚠ CHÌA VẪN GIỮ — rút
                                   dây ≠ vứt chìa: người ta hay rút để xoay
                                   token, bắt đi lấy lại là phạt một thao tác
                                   vốn vô hại.
            */}
            <ArmName node={node} />

            {/*
              MỘT MỨC, KHÔNG HAI. (user chốt 23/08)

              Nhân viên có "Cất đi" và "Xoá hẳn" vì họ mang thứ dựng lại KHÔNG
              ĐƯỢC — kỹ năng, giới thiệu, sổ kinh nghiệm. Cánh tay chỉ mang cấu
              hình, mà cấu hình sống trong SỔ CHUNG và không ai xoá nó. Nên "xoá"
              ở đây đã có sẵn tính chất của "cất đi": cắm lại đúng thư mục ⇒ cùng
              băm ⇒ tìm thấy nguyên vẹn, không phải nhập lại gì.

              Mượn một khái niệm từ chỗ nó xứng đáng sang chỗ nó không, là thứ
              vừa được gỡ ra. → SPEC-arms.md §6i
            */}
            {/*
              ┌──────────────────────────────────────────────────────────────────┐
              │ HAI KHỐI `Note` ĐÃ BỎ. (user 26/08: *"prune giúp tôi block này,  │
              │ tôi không ngại nếu prune chúng ở tất cả"*)                       │
              │                                                                  │
              │ ① *"Cấu hình và chìa khoá vẫn được giữ…"* — nó lặp lại y hệt câu │
              │   trong hộp xác nhận, thứ hiện ra **đúng lúc người dùng cần**.   │
              │   Nói trước một chuyện sẽ được nói lại là bắt họ đọc hai lần.    │
              │                                                                  │
              │ ② *"Nối vào Trợ lý = việc vặt… concierge (M1)… phá prompt cache"*│
              │   — đây là ghi chú cho **người viết code**, không phải cho người │
              │   dùng: `concierge`, `M1`, `prompt cache` đều là từ vựng của ta. │
              │                                                                  │
              │ ⚠ Luật rút ra, áp cho mọi `Note` về sau: một dòng chỉ đáng ở lại │
              │ nếu nó **đổi được việc người dùng sắp làm**. Chữ nói đúng nhưng  │
              │ không đổi hành vi là thứ dạy người ta lướt qua mọi chữ khác —    │
              │ rồi họ lướt qua đúng cái đáng đọc. Cùng lý lẽ đã dùng để KHÔNG   │
              │ dán cảnh báo lên nút đổi tên (§AssistantName).                   │
              └──────────────────────────────────────────────────────────────────┘
            */}
            <ArmLog server={node.server!} />

            <Button variant="danger" className="mt-4 w-full" onClick={() => setConfirmRemove(node)}>
              {t('inspector.removeFromOffice')}
            </Button>
          </>
        )}

        {node.kind === 'agent' && (
          <>
            <AgentProfile node={node} />
            <ModelPicker node={node} />
            <Row k={t('inspector.roleId')} v={node.role} />
            <Row
              k={t('inspector.ownNotebook')}
              v={plural('knowledge.noteCount', node.count ?? 0)}
            />
            <Row
              k={t('inspector.status')}
              v={node.connected ? t('inspector.statusOnDuty') : t('inspector.statusOffDuty')}
            />
            <ArmList ids={node.mcp} nodes={canvas.nodes} />
            {node.missing && (
              <Note>
                <span className="text-danger">
                  {t('inspector.missingRole', { role: node.role ?? '' })}
                </span>
              </Note>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <Button onClick={() => onShowPrompt(node.role!)}>
                <FileCode2 className="h-4 w-4" />
                {t('inspector.viewPrompt')}
              </Button>
              <Button onClick={() => toggleDuty(node)}>
                {node.connected ? t('inspector.rest') : t('inspector.backOnDuty')}
              </Button>
              {/* "Cho nghỉ" = còn trên sơ đồ, chỉ mất dây → tạm thời.
                  "Cất đi"  = biến khỏi sơ đồ, file còn nguyên → lâu dài.
                  Hai mức khác nhau thật, nên là hai nút, không phải một nút hỏi lại. */}
              <Button onClick={() => void actions.archiveAgent(node.role!, true)}>
                <Archive className="h-4 w-4" />
                {t('inspector.archive')}
              </Button>
              <Button variant="danger" onClick={() => setConfirmRemove(node)}>
                <Trash2 className="h-4 w-4" />
                {t('inspector.deleteForGood')}
              </Button>
            </div>

            <Note>{t('inspector.builtinNote')}</Note>
            <BashSwitch node={node} />
          </>
        )}
      </div>

      <SectionTitle className="flex-none border-t border-line px-4 py-2">{node.kind}</SectionTitle>

      <Dialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmRemove?.kind === 'mcp'
                ? t('inspector.confirmRemoveArmTitle', { label: confirmRemove.label })
                : t('inspector.confirmDeleteAgentTitle', { label: confirmRemove?.label ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {confirmRemove?.kind === 'mcp' ? (
                <>
                  {t('inspector.armRemoveBody1')} <b>{t('inspector.armRemoveBold')}</b>{' '}
                  {t('inspector.armRemoveBody2')}
                  <br />
                  <br />
                  {/* Không doạ, vì không có gì đáng doạ: sổ chung giữ cấu hình và
                      chìa, nên đây là thao tác HOÀN TÁC ĐƯỢC. Nói đúng mức độ
                      của nó là cách giữ cho những cảnh báo THẬT còn sức nặng. */}
                  {t('inspector.armRemoveKeep1')} <b>{t('inspector.armRemoveKeepBold')}</b>
                  {t('inspector.armRemoveKeep2')}
                </>
              ) : (
                <>
                  {t('inspector.agentDeleteBefore')} <code>roles/{confirmRemove?.role}.yaml</code>{' '}
                  {t('inspector.agentDeleteMid')} <b>{t('inspector.agentDeleteBold')}</b>
                  <br />
                  <br />
                  {t('inspector.agentNotesBefore')}{' '}
                  <code>knowledge/agents/{confirmRemove?.role}/</code>{' '}
                  {t('inspector.agentNotesAfter')}
                  <br />
                  <br />
                  {t('inspector.archiveHintBefore')} <b>{t('common.cancel')}</b>{' '}
                  {t('inspector.archiveHintMid')} <b>{t('inspector.archive')}</b>{' '}
                  {t('inspector.archiveHintAfter')}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmRemove(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmRemove?.kind === 'mcp' && confirmRemove.server) {
                  void actions.removeArm(confirmRemove.server);
                } else if (confirmRemove?.role) {
                  void actions.removeAgent(confirmRemove.role);
                }
                setConfirmRemove(null);
              }}
            >
              {confirmRemove?.kind === 'mcp'
                ? t('inspector.removeFromOfficeShort')
                : t('inspector.deleteForGood')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
