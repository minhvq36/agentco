import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Building2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input, Label, SectionTitle, Select, Tip } from '@/components/ui/misc';
import type { ArchivedAgent } from '@/lib/types';
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

interface CostRow {
  office: string;
  name: string;
  tasks: number;
  costUSD: number;
  turns: number;
  archived: boolean;
  gone: boolean;
}

/** Tổng quan cả CÔNG TY: các văn phòng, và tiền — thứ duy nhất dùng chung. */
export function OverviewPanel() {
  const company = useApp((s) => s.company);
  const officeId = useApp((s) => s.officeId);
  const [cost, setCost] = useState<CostRow[] | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    api
      .cost()
      .then((c) => setCost(c.byOffice))
      .catch(() => setCost([]));
  }, [officeId]);

  const live = company?.offices.filter((o) => !o.archived) ?? [];
  const archived = company?.offices.filter((o) => o.archived) ?? [];

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-4 py-4">
      <section>
        <SectionTitle className="mb-2">Văn phòng</SectionTitle>
        <ul className="flex flex-col gap-1">
          {live.map((o) => (
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
              <Tip label="Cất vào lưu trữ — khôi phục được">
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label={`Cất văn phòng ${o.name} vào lưu trữ`}
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => void actions.archiveOffice(o.id, true)}
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              </Tip>
              <Tip label="Xoá hẳn cả thư mục — không lấy lại được">
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label={`Xoá hẳn văn phòng ${o.name}`}
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => setConfirm({ id: o.id, name: o.name })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </Tip>
            </li>
          ))}
        </ul>
        {live.length === 0 && (
          <div className="flex items-center gap-2 py-2 text-[13px] text-muted">
            <Building2 className="h-4 w-4" /> chưa có văn phòng nào đang mở
          </div>
        )}
      </section>

      {archived.length > 0 && (
        <section>
          <SectionTitle className="mb-2">Trong lưu trữ</SectionTitle>
          <ul className="flex flex-col gap-1">
            {archived.map((o) => (
              <li
                key={o.id}
                className="flex items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-2 text-[13px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-muted">{o.name}</span>
                  <span className="block text-xs text-muted">
                    {o.agents} nhân viên · {o.knowledge} ghi chú · chỉ đọc
                  </span>
                </span>
                <Button size="sm" onClick={() => void actions.archiveOffice(o.id, false)}>
                  <ArchiveRestore className="h-3.5 w-3.5" />
                  Khôi phục
                </Button>
                {/* Xoá hẳn phải với tới được TỪ TRONG lưu trữ. Không có nút này
                    thì muốn dọn sạch phải khôi phục ra rồi mới xoá được — hai
                    bước cho một ý định, và bước giữa là đưa lại vào danh sách
                    đang làm việc đúng cái mình vừa muốn bỏ đi. */}
                <Tip label="Xoá hẳn cả thư mục — không lấy lại được">
                  <Button
                    size="iconSm"
                    variant="ghost"
                    aria-label={`Xoá hẳn văn phòng ${o.name}`}
                    onClick={() => setConfirm({ id: o.id, name: o.name })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </Tip>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            File còn nguyên chỗ cũ, không đi đâu cả. Văn phòng trong lưu trữ không nhận việc và không
            trả lời — khôi phục là trở lại nguyên vẹn, kể cả cuộc trò chuyện đang dở.
          </p>
        </section>
      )}

      <ArchivedAgentsSection />

      <section>
        <SectionTitle className="mb-2">Chi phí cả công ty</SectionTitle>
        {cost === null ? (
          <div className="text-[13px] text-muted">Đang đọc…</div>
        ) : cost.length === 0 ? (
          <div className="text-[13px] text-muted">Chưa có việc nào được ghi nhận.</div>
        ) : (
          <CostTable rows={cost} />
        )}
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Số <b>lượt</b> mới là đòn bẩy chi phí lớn nhất — mỗi lượt đọc lại toàn bộ prefix. Việc nhiều lượt
          đắt hơn việc nhiều token.
        </p>
      </section>

      <ModelsSection />

      <RemoveOfficeDialog target={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/**
 * Bảng chi phí. Văn phòng KHÔNG CÒN TỒN TẠI được gom vào một khối đóng/mở.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ GỘP ĐỂ HIỂN THỊ, KHÔNG GỘP DỮ LIỆU.                                      │
 * │                                                                          │
 * │ Không gom thì sau vài tháng bảng đầy những cái tên đã chết. Nhưng cộng   │
 * │ chúng thành MỘT dòng "đã xoá · $X" thì cái mã văn phòng mất — mà với một │
 * │ văn phòng đã xoá hẳn, cái mã là manh mối DUY NHẤT còn lại để biết khoản  │
 * │ tiền đó là của việc gì.                                                  │
 * │                                                                          │
 * │ Nên: thu gọn thành một dòng tổng, bấm vào bung ra đúng từng dòng thật.   │
 * │ Danh sách không dài ra, không mất minh bạch, và không cần một dòng code  │
 * │ kế toán nào — chỉ là một cái `<details>`.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function CostTable({ rows }: { rows: CostRow[] }) {
  const live = rows.filter((r) => !r.gone);
  const gone = rows.filter((r) => r.gone);
  const goneTotal = gone.reduce((n, r) => n + r.costUSD, 0);

  return (
    <>
      <table className="w-full text-[13px]">
        <tbody>
          {live.map((c) => (
            <CostRowView key={c.office} row={c} />
          ))}
        </tbody>
      </table>

      {gone.length > 0 && (
        <details className="mt-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5">
          {/* "mục" chứ không phải "văn phòng": khối này chứa cả văn phòng đã xoá
              hẳn LẪN bản ghi có từ trước khi có khái niệm văn phòng. Gọi chung
              là "văn phòng đã xoá" thì đúng với đa số dòng và sai với phần còn
              lại — mà sổ chi phí thì không được nói sai câu nào. */}
          <summary className="cursor-pointer list-none text-[13px] text-muted marker:hidden">
            <span className="tabular-nums">{gone.length}</span> mục không còn ·{' '}
            <span className="tabular-nums">${goneTotal.toFixed(4)}</span>
            <span className="float-right text-xs">bấm để xem</span>
          </summary>
          <table className="mt-1.5 w-full text-[13px]">
            <tbody>
              {gone.map((c) => (
                <CostRowView key={c.office} row={c} />
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}

function CostRowView({ row }: { row: CostRow }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-1.5 pr-2 text-ink">
        {row.name}
        {row.archived && <span className="ml-1.5 text-xs text-muted">(lưu trữ)</span>}
      </td>
      <td className="py-1.5 text-right tabular-nums text-muted">{row.tasks} việc</td>
      <td className="py-1.5 pl-2 text-right tabular-nums text-muted">{row.turns} lượt</td>
      <td className="py-1.5 pl-2 text-right tabular-nums text-ink">${row.costUSD.toFixed(4)}</td>
    </tr>
  );
}

/**
 * Nhân viên đang trong lưu trữ của văn phòng ĐANG MỞ.
 *
 * Khôi phục thì họ trở lại đúng văn phòng cũ — vì họ chưa bao giờ rời đi.
 * `roles/<id>.yaml` không hề di chuyển, chỉ có một cờ `archived` được gỡ.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TÊN VĂN PHÒNG PHẢI HIỆN RA, DÙ DANH SÁCH NÀY CHỈ CÓ MỘT VĂN PHÒNG.       │
 * │                                                                          │
 * │ Khối này nằm trong bảng **Tổng quan công ty** — một màn hình mà mọi thứ  │
 * │ khác đều nói về CẢ công ty (danh sách văn phòng, sổ chi phí, model dùng  │
 * │ chung). Một mục "Nhân viên trong lưu trữ" đặt giữa đó thì đọc như là     │
 * │ toàn công ty, và người dùng bấm "Đưa trở lại" xong đi tìm người đó trong │
 * │ một mớ văn phòng.                                                        │
 * │                                                                          │
 * │ Nhãn ở đây không phải để phân biệt các dòng với nhau — chúng cùng một    │
 * │ văn phòng cả. Nó trả lời câu người dùng thật sự đang hỏi: **"bấm nút này │
 * │ thì người đó xuất hiện ở đâu?"** Nên nhãn nằm ở TIÊU ĐỀ khối, chỗ đọc    │
 * │ trước khi bấm, chứ không rắc vào từng dòng.                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function ArchivedAgentsSection() {
  const officeId = useApp((s) => s.officeId);
  const canvas = useApp((s) => s.canvas);
  const office = useApp((s) => s.company?.offices.find((o) => o.id === s.officeId));
  const [agents, setAgents] = useState<ArchivedAgent[]>([]);
  const [confirm, setConfirm] = useState<ArchivedAgent | null>(null);

  // Đọc lại mỗi khi canvas đổi: cất hoặc khôi phục một người đều làm canvas đổi,
  // nên danh sách này không bao giờ lệch với sơ đồ.
  useEffect(() => {
    if (!officeId) return setAgents([]);
    api
      .archivedAgents(officeId)
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]));
  }, [officeId, canvas]);

  if (agents.length === 0) return null;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <SectionTitle>Nhân viên trong lưu trữ</SectionTitle>
        {office && (
          <span className="flex min-w-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
            <span className="flex-none">{office.avatar}</span>
            <span className="truncate">{office.name}</span>
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {agents.map((a) => (
          <li
            key={a.role}
            className="flex items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-2 text-[13px]"
          >
            <span>{a.avatar}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-muted">{a.label}</span>
              <span className="block truncate text-xs text-muted">
                {a.notes > 0 ? `${a.notes} ghi chú kinh nghiệm còn giữ` : a.pitch}
              </span>
            </span>
            <Tip
              label={
                office
                  ? `Trở lại sơ đồ của "${office.name}", đứng ở một chỗ trống — không đè lên ai. Vẫn ở trạng thái NGHỈ cho tới khi bạn nối dây.`
                  : 'Trở lại sơ đồ, đứng ở một chỗ trống, vẫn ở trạng thái nghỉ.'
              }
            >
              <Button size="sm" onClick={() => void actions.archiveAgent(a.role, false)}>
                <ArchiveRestore className="h-3.5 w-3.5" />
                Đưa trở lại
              </Button>
            </Tip>
            <Tip label="Xoá hẳn file vai trò — không lấy lại được">
              <Button
                size="iconSm"
                variant="ghost"
                aria-label={`Xoá hẳn ${a.label}`}
                onClick={() => setConfirm(a)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </Tip>
          </li>
        ))}
      </ul>

      {/*
        Câu này nói về CHỖ NGỒI, vì đó mới là nỗi lo thật khi bấm "Đưa trở lại":
        người dùng sợ họ hiện ra ở một chỗ không tìm thấy. Cất đi là node bị XOÁ
        khỏi layout (`layout.dropAgent`), nên lúc quay lại nó được cấp ô trống
        đầu tiên như một người mới — kể cả khi ai đó đã ngồi vào chỗ cũ.
        → test/layout.test.ts "cất đi rồi đưa trở lại"
      */}
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Đưa trở lại là họ xuất hiện trên sơ đồ của <b>{office?.name ?? 'văn phòng này'}</b> ở một chỗ
        trống — không bao giờ nằm đè lên người khác, kể cả khi đã có ai ngồi vào chỗ cũ của họ. Trạng
        thái vẫn là <b>đang nghỉ</b> cho tới khi bạn nối dây từ Trợ lý.
      </p>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xoá hẳn “{confirm?.label}”?</DialogTitle>
            <DialogDescription>
              Mất file <code>roles/{confirm?.role}.yaml</code> và toàn bộ kỹ năng đã viết cho người
              này. <b>Không lấy lại được.</b>
              <br />
              <br />
              {confirm && confirm.notes > 0 ? (
                <>
                  <b>{confirm.notes} ghi chú kinh nghiệm</b> ở{' '}
                  <code>knowledge/agents/{confirm.role}/</code> vẫn được giữ — đó là thứ văn phòng đã
                  học được, không phải tài sản riêng của một cái tên.
                </>
              ) : (
                <>
                  Sổ tay kinh nghiệm ở <code>knowledge/agents/{confirm?.role}/</code> vẫn được giữ.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirm(null)}>Thôi</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm) void actions.removeAgent(confirm.role).then(() => setAgents((a) => a.filter((x) => x.role !== confirm.role)));
                setConfirm(null);
              }}
            >
              Xoá hẳn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * Mức nào chạy model nào — cấu hình cấp CÔNG TY.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO Ở ĐÂY CHỨ KHÔNG PHẢI TRONG TỪNG VĂN PHÒNG                         │
 * │                                                                          │
 * │ Đây là câu hỏi "một việc mức standard tốn bao nhiêu" — tức là TIỀN, mà   │
 * │ tiền thì chỉ có một hoá đơn Claude và một chỗ để siết. Còn "Trợ lý văn   │
 * │ phòng này chạy mức nào" là câu hỏi CÔNG VIỆC, nên nó nằm ở từng văn      │
 * │ phòng (bảng bên phải, chọn node Trợ lý). Hai câu hỏi khác nhau, hai chỗ. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function ModelsSection() {
  const models = useApp((s) => s.company?.models);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (models) setDraft({ ...models });
  }, [models]);

  if (!models) return null;

  const dirty = (['eco', 'standard', 'deep', 'master', 'planner'] as const).some(
    (k) => draft[k] !== undefined && draft[k] !== models[k],
  );

  return (
    <section>
      <SectionTitle className="mb-2">Model của công ty</SectionTitle>

      {!open ? (
        <>
          <table className="w-full text-[13px]">
            <tbody>
              {(['eco', 'standard', 'deep'] as const).map((tier) => (
                <tr key={tier} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-2 text-ink">{tier}</td>
                  <td className="py-1.5 text-right font-mono text-[11.5px] text-muted">
                    {models[tier]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Trợ lý mặc định chạy mức <b>{models.master}</b>, khâu lập kế hoạch chạy mức{' '}
            <b>{models.planner}</b>. Lập kế hoạch chạy ở lượt gọi riêng, nên đặt nó lên{' '}
            <code>deep</code> <b>không</b> phá bộ nhớ đệm của Trợ lý.
          </p>
          <button
            className="mt-2 text-[13px] text-accent hover:underline"
            onClick={() => setOpen(true)}
          >
            Đổi model
          </button>
        </>
      ) : (
        <div className="rounded-lg border border-line p-3">
          {(['eco', 'standard', 'deep'] as const).map((tier) => (
            <div key={tier} className="mb-3">
              <Label htmlFor={`m-${tier}`}>{tier}</Label>
              <Input
                id={`m-${tier}`}
                className="font-mono text-[12px]"
                value={draft[tier] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [tier]: e.target.value }))}
              />
            </div>
          ))}

          <Label htmlFor="m-master">Trợ lý chạy mức</Label>
          <Select
            id="m-master"
            className="mb-3 w-full"
            value={draft.master ?? models.master}
            onChange={(e) => setDraft((d) => ({ ...d, master: e.target.value }))}
          >
            <option value="eco">eco</option>
            <option value="standard">standard</option>
            <option value="deep">deep</option>
          </Select>

          <Label htmlFor="m-planner">Lập kế hoạch chạy mức</Label>
          <Select
            id="m-planner"
            className="w-full"
            value={draft.planner ?? models.planner}
            onChange={(e) => setDraft((d) => ({ ...d, planner: e.target.value }))}
          >
            <option value="eco">eco</option>
            <option value="standard">standard</option>
            <option value="deep">deep</option>
          </Select>

          <p className="mt-3 text-xs leading-relaxed text-muted">
            Tên model phải đúng như Anthropic đặt (<code>claude-sonnet-5</code>,{' '}
            <code>claude-haiku-4-5-20251001</code>…). Gõ sai thì việc đầu tiên chạy sau đó sẽ báo lỗi
            model không tồn tại — không có gì hỏng vĩnh viễn, sửa lại là chạy tiếp.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Đổi ở đây đụng tới <b>mọi văn phòng</b>. Việc đang chạy giữ nguyên model cũ cho tới khi
            xong; mọi thứ sau đó dùng model mới và phải ghi lại bộ nhớ đệm một lần.
          </p>

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setDraft({ ...models });
                setOpen(false);
              }}
            >
              Thôi
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!dirty || busy}
              onClick={async () => {
                setBusy(true);
                const ok = await actions.updateModels(draft);
                setBusy(false);
                if (ok) setOpen(false);
              }}
            >
              {busy ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </div>
        </div>
      )}
    </section>
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
          <DialogTitle>Xoá hẳn văn phòng “{target?.name}”?</DialogTitle>
          <DialogDescription>
            Xoá cả thư mục <code>offices/{target?.id}/</code>: nhân viên, kỹ năng, kho tri thức và mọi
            kết quả đã làm. <b>Không lấy lại được.</b>
            <br />
            <br />
            Sau đó những khoản tiền văn phòng này đã tiêu vẫn nằm trong sổ chi phí, nhưng chỉ còn lại
            cái mã <code>{target?.id}</code> để bạn lần ra — tên và nội dung thì mất.
            <br />
            <br />
            Chỉ muốn cất đi cho gọn? Bấm <b>Thôi</b> rồi dùng nút <b>Lưu trữ</b> — khôi phục được bất cứ
            lúc nào, và văn phòng vẫn giữ tên trong sổ.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>Thôi</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (target) void actions.removeOffice(target.id);
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
