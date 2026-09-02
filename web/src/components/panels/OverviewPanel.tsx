import { useEffect, useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, Building2, ChevronDown, FolderOpen, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input, Label, SectionTitle, Select, Tip } from '@/components/ui/misc';
import type { ArchivedAgent, InstalledArm, OAuthAccount } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { actions, toast, useApp } from '@/lib/store';
import { plural, t } from '@i18n';
import { formatUSD } from '@i18n/fmt';

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

  const loadCost = () =>
    api
      .cost()
      .then((c) => setCost(c.byOffice))
      .catch(() => setCost([]));

  useEffect(() => {
    void loadCost();
  }, [officeId]);

  const live = company?.offices.filter((o) => !o.archived) ?? [];
  const archived = company?.offices.filter((o) => o.archived) ?? [];

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-4 py-4">
      <section>
        <SectionTitle className="mb-2">{t('overview.offices')}</SectionTitle>
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
                      `${o.onDuty}/${plural('overview.onDutyCount', o.agents)} · ${plural('knowledge.noteCount', o.knowledge)}`
                    )}
                  </span>
                </span>
              </button>
              {/*
                MỞ THƯ MỤC — lối thoát cho "mã văn phòng không đổi theo tên".
                → src/cli/daemonfile.ts §openFolder

                `id` là tên thư mục và cố ý không đổi khi đổi tên hiển thị, nên
                người đổi "Báo cáo" thành "Kiểm kê" sẽ đi tìm `kiem-ke/` không
                có. Với tên phi-Latin còn tệ hơn: thư mục tên `vp-ee6fd8`.
                Nút này bỏ hẳn nhu cầu biết thư mục tên gì.
              */}
              <Tip label={t('overview.folderTip', { id: o.id })}>
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label={t('overview.folderAria', { name: o.name })}
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={async () => {
                    const r = await api.revealOffice(o.id).catch(() => null);
                    if (!r) return;
                    /*
                      Truy cập từ xa (VPS, Docker) thì server CỐ Ý không mở gì —
                      cửa sổ đó sẽ bật trên máy chủ, không phải máy bạn đang
                      nhìn. Chép đường dẫn vào clipboard là thứ thật sự dùng
                      được ở đó, và câu thông báo phải nói ra vì sao.
                    */
                    if (r.opened) return toast(t('overview.opened', { dir: r.dir }));
                    void navigator.clipboard?.writeText(r.dir).catch(() => undefined);
                    toast(t('overview.remoteCopied', { dir: r.dir }));
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </Tip>
              <Tip label={t('overview.archiveTip')}>
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label={t('overview.archiveAria', { name: o.name })}
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => void actions.archiveOffice(o.id, true)}
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              </Tip>
              <Tip label={t('overview.deleteTip')}>
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label={t('overview.deleteOfficeAria', { name: o.name })}
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
            <Building2 className="h-4 w-4" /> {t('overview.noOffices')}
          </div>
        )}
      </section>

      {archived.length > 0 && (
        <section>
          <SectionTitle className="mb-2">{t('overview.archived')}</SectionTitle>
          <ul className="flex flex-col gap-1">
            {archived.map((o) => (
              <li
                key={o.id}
                className="flex items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-2 text-[13px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-muted">{o.name}</span>
                  <span className="block text-xs text-muted">
                    {plural('overview.employeeCount', o.agents)} ·{' '}
                    {plural('knowledge.noteCount', o.knowledge)} · {t('overview.readOnly')}
                  </span>
                </span>
                <Button size="sm" onClick={() => void actions.archiveOffice(o.id, false)}>
                  <ArchiveRestore className="h-3.5 w-3.5" />
                  {t('overview.restore')}
                </Button>
                {/* Xoá hẳn phải với tới được TỪ TRONG lưu trữ. Không có nút này
                    thì muốn dọn sạch phải khôi phục ra rồi mới xoá được — hai
                    bước cho một ý định, và bước giữa là đưa lại vào danh sách
                    đang làm việc đúng cái mình vừa muốn bỏ đi. */}
                <Tip label={t('overview.deleteTip')}>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    aria-label={t('overview.deleteOfficeAria', { name: o.name })}
                    onClick={() => setConfirm({ id: o.id, name: o.name })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </Tip>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ArchivedAgentsSection />

      <section>
        <SectionTitle className="mb-2">{t('overview.costTitle')}</SectionTitle>
        {cost === null ? (
          <div className="text-[13px] text-muted">{t('common.reading')}</div>
        ) : cost.length === 0 ? (
          <div className="text-[13px] text-muted">{t('overview.noCost')}</div>
        ) : (
          <CostTable rows={cost} onPurged={() => void loadCost()} />
        )}
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {t('overview.turnsNoteBefore')} <b>{t('overview.turnsNoteBold')}</b>{' '}
          {t('overview.turnsNoteAfter')}
        </p>
      </section>

      {/* Dưới Chi phí, và gập lại (user chốt 02/09): đây là hai mục để DỌN khi
          cần, không phải thứ đọc mỗi ngày. Mở sẵn thì chúng đẩy đúng thứ người
          ta vào đây để xem — tiền — xuống dưới màn hình. */}
      <ConnectionsSection />

      <ModelsSection />

      <RemoveOfficeDialog target={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/**
 * KẾT NỐI + TÀI KHOẢN ĐÃ NỐI — cửa quản lý ở đúng cấp mà dữ liệu đang nằm.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUG USER BÁO 02/09: *"kết nối Acme Team's Notion không xoá được"*        │
 * │ (rồi Linear, rồi GitHub — cùng một thế kẹt).                             │
 * │                                                                          │
 * │ Xoá theo dây chuyền, mà mỗi khoá lại nằm sau đúng cánh cửa nó đang khoá: │
 * │                                                                          │
 * │   workspace ←chặn bởi─ cánh tay ←chặn bởi─ văn phòng                     │
 * │   `oauthForget`        `forgetArm`         cửa vào: Toolbar của canvas   │
 * │                                                                          │
 * │ Hai chốt chặn kia ĐÚNG — chúng ngăn để lại một cánh tay chết im. Cái sai │
 * │ là **cửa đi tới bước tiếp theo nằm bên trong thứ vừa bị xoá**: 0 văn      │
 * │ phòng ⇒ 0 canvas ⇒ 0 Toolbar ⇒ không còn đường nào tới sổ chung, dù dữ   │
 * │ liệu đó là của CÔNG TY chứ không của văn phòng nào.                      │
 * │                                                                          │
 * │ Bản vá KHÔNG phải "xoá văn phòng thì dọn luôn kết nối" — làm thế là phá  │
 * │ đúng tính chất dùng chung (xoá văn phòng A đứt dây văn phòng B), và biến │
 * │ một nút xoá thành hai hành vi tuỳ số văn phòng còn lại tình cờ là mấy.   │
 * │ Dữ liệu ở nguyên chỗ; thứ được sửa là CỬA. → SPEC-arms.md §6k            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `ArmDialog` vẫn là chỗ **cắm mới**. Ngăn này là chỗ **nhìn và dọn** — hai ý
 * định khác nhau, và cái thứ hai không được phụ thuộc vào việc có văn phòng.
 */
/**
 * Access level → the word for it.
 *
 * The same three words were spelled out in three places before this
 * (`ArmDialog`, here, and a ternary in `Inspector`), so a fourth level or a
 * reworded one would have had to be found in three files. One catalogue region
 * now owns them: `inspector.level.*`.
 */
function levelSay(level: string): string {
  if (level === 'read') return t('inspector.level.read');
  if (level === 'add') return t('inspector.level.add');
  if (level === 'full') return t('inspector.level.full');
  return level;
}

function ConnectionsSection() {
  const company = useApp((s) => s.company);
  const [arms, setArms] = useState<InstalledArm[] | null>(null);
  const [accounts, setAccounts] = useState<OAuthAccount[] | null>(null);
  /** Đang chờ xác nhận xoá — mức duy nhất không hoàn tác được, nên phải hỏi. */
  const [dropArm, setDropArm] = useState<InstalledArm | null>(null);
  const [dropAcc, setDropAcc] = useState<OAuthAccount | null>(null);

  /*
    Nạp lại theo `company`: xoá một văn phòng làm cánh tay thành mồ côi, và cờ
    `orphan` là thứ quyết định nút 🗑 có hiện hay không. Không nghe theo nó thì
    người dùng vừa xoá văn phòng xong vẫn thấy "đang dùng" cho tới lần F5.
  */
  useEffect(() => {
    void api.arms().then((r) => setArms(r.arms)).catch(() => setArms([]));
    void api.oauthAccounts().then((r) => setAccounts(r.accounts)).catch(() => setAccounts([]));
  }, [company]);

  async function forgetArm(a: InstalledArm) {
    if (await actions.forgetArm(a.id)) {
      toast(t('overview.armForgotten', { label: a.label }));
      const r = await api.arms().catch(() => null);
      if (r) setArms(r.arms);
    }
  }

  async function forgetAccount(acc: OAuthAccount) {
    const name = acc.label ?? acc.name;
    if (await actions.forgetAccount(acc.name)) {
      toast(t('overview.accountForgotten', { name }));
      const [a, b] = await Promise.all([
        api.arms().catch(() => null),
        api.oauthAccounts().catch(() => null),
      ]);
      if (a) setArms(a.arms);
      if (b) setAccounts(b.accounts);
    }
  }

  const officeName = (id: string) => company?.offices.find((o) => o.id === id)?.name ?? id;

  if (arms !== null && arms.length === 0 && accounts !== null && accounts.length === 0) return null;

  return (
    <>
      {arms !== null && arms.length > 0 && (
        <Fold title={t('overview.connections')} count={arms.length}>
          <ul className="flex flex-col gap-1">
            {arms.map((a) => {
              // Hai nghĩa của "đang dùng", đúng như `armHolders` ở server: có sợi
              // dây, HOẶC có mặt trên sơ đồ mà chưa nối. Gộp làm một là hiện nút
              // xoá cho một node đang nằm trên sơ đồ của ai đó.
              const wired = [...new Set(a.usedBy.map((u) => officeName(u.office)))];
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[13px]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{a.label}</span>
                    <span className="block truncate text-xs text-muted">
                      {a.via ? `${a.via} · ` : ''}
                      {plural('inspector.toolCount', a.toolCount)}
                      {a.level ? ` · ${levelSay(a.level)}` : ''}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {wired.length
                        ? t('overview.usedBy', { who: wired.join(', ') })
                        : a.orphan
                          ? t('overview.unused')
                          : t('overview.onCanvasNotWired')}
                    </span>
                  </span>
                  {a.orphan && (
                    <Tip label={t('overview.dropArmTip')}>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        aria-label={t('overview.dropArmAria', { label: a.label })}
                        onClick={() => setDropArm(a)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </Tip>
                  )}
                </li>
              );
            })}
          </ul>
        </Fold>
      )}

      {accounts !== null && accounts.length > 0 && (
        <Fold title={t('overview.accounts')} count={accounts.length}>
          <ul className="flex flex-col gap-1">
            {accounts.map((acc) => (
              <li
                key={acc.name}
                className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[13px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{acc.label ?? acc.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {acc.dead ? (
                      <span className="text-danger">{t('overview.keyDead')}</span>
                    ) : acc.usedBy.length ? (
                      t('overview.usedBy', { who: acc.usedBy.join(', ') })
                    ) : (
                      t('overview.accountUnused')
                    )}
                  </span>
                </span>
                {/*
                  Mờ chứ không ẩn, và tooltip NÊU TÊN kết nối đang giữ nó: đây là
                  đúng chỗ người dùng bị kẹt hôm 02/09, nên câu giải thích phải
                  chỉ được bước tiếp theo chứ không chỉ nói "không được".
                */}
                <Tip
                  label={
                    acc.usedBy.length
                      ? t('overview.accountBlockedTip', {
                          n: acc.usedBy.length,
                          who: acc.usedBy.join(', '),
                        })
                      : t('overview.accountDropTip')
                  }
                >
                  <span>
                    <Button
                      size="iconSm"
                      variant="ghost"
                      disabled={acc.usedBy.length > 0}
                      aria-label={t('overview.accountDropAria', { label: acc.label ?? acc.name })}
                      onClick={() => setDropAcc(acc)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </Tip>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {/*
        Hỏi bằng MODAL của app, không `window.confirm`. (user chốt 02/09)

        Hộp thoại của trình duyệt khoá cả tab, không mang được định dạng, và trông
        không giống phần còn lại của sản phẩm — trong khi hộp thoại lúc TẠO thì
        đã là modal. Hỏi và tạo là hai đầu của cùng một thao tác, đi hai kiểu là
        người dùng phải học hai lần.

        Vế **"CHÌA VẪN ĐƯỢC GIỮ"** in đậm chứ không phải một dòng phụ: nó là thứ
        làm quyết định này rẻ, và không nói ra thì người dùng tưởng mình sắp mất
        token nên không ai dám bấm — có nút mà như không.
      */}
      <Dialog open={!!dropArm} onOpenChange={(o) => !o && setDropArm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('overview.dropArmTitle', { label: dropArm?.label ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t('overview.dropArmBody1')} <b>{t('overview.dropArmBodyBold')}</b>{' '}
              {t('overview.dropArmBody2')}
              <br />
              <b>{t('overview.dropArmKeepBold')}</b> {t('overview.dropArmKeepAfter')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDropArm(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (dropArm) void forgetArm(dropArm);
                setDropArm(null);
              }}
            >
              {t('inspector.deleteForGood')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dropAcc} onOpenChange={(o) => !o && setDropAcc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('overview.dropAccTitle', { label: dropAcc?.label ?? dropAcc?.name ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t('overview.dropAccBody1')} <b>{t('overview.dropAccBodyBold')}</b>{' '}
              {t('overview.dropAccBody2')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDropAcc(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (dropAcc) void forgetAccount(dropAcc);
                setDropAcc(null);
              }}
            >
              {t('overview.drop')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Mục GẬP LẠI ĐƯỢC cho ngăn Tổng quan. (user chốt 02/09)
 *
 * Cùng khuôn `<details>` với khối "N mục không còn" của bảng chi phí, nên hai
 * chỗ gập trong cùng một ngăn mở ra bằng một cử chỉ. Con số nằm ngay ở tiêu đề:
 * đóng lại rồi thì nó là thứ duy nhất còn nói được là bên trong có gì.
 *
 * Mặc định ĐÓNG — đây là ngăn để dọn khi cần, không phải thứ đọc mỗi ngày, và
 * ba mục kết nối mở sẵn thì đẩy phần Chi phí xuống dưới màn hình.
 */
function Fold({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="group">
      <summary className="mb-2 flex cursor-pointer list-none items-center gap-1.5 marker:hidden">
        <ChevronDown className="h-3.5 w-3.5 text-muted transition-transform group-open:rotate-180" />
        <SectionTitle>
          {title} <span className="tabular-nums">({count})</span>
        </SectionTitle>
      </summary>
      {children}
    </details>
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
 *
 * Từ 02/09 khối này còn có một cái CHỔI. `removeOffice` giờ tự đóng sổ, nên
 * khối chỉ còn đọng lại rác từ trước bản vá — nhưng rác cũ thì cũng phải có
 * đường dọn, và đường đó không được là "mở `usage.jsonl` sửa tay".
 */
function CostTable({ rows, onPurged }: { rows: CostRow[]; onPurged: () => void }) {
  const live = rows.filter((r) => !r.gone);
  const gone = rows.filter((r) => r.gone);
  const goneTotal = gone.reduce((n, r) => n + r.costUSD, 0);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);

  async function purge() {
    setBusy(true);
    try {
      const r = await api.purgeGoneCost();
      toast(t('overview.purged', { n: r.offices, cost: formatUSD(r.costUSD) }));
      onPurged();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('overview.purgeFailed'));
    } finally {
      setBusy(false);
    }
  }

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
            <span className="tabular-nums">{gone.length}</span> {t('overview.goneEntries')}{' '}
            <span className="tabular-nums">{formatUSD(goneTotal)}</span>
            <span className="float-right text-xs">{t('overview.tapToSee')}</span>
          </summary>
          <table className="mt-1.5 w-full text-[13px]">
            <tbody>
              {gone.map((c) => (
                <CostRowView key={c.office} row={c} />
              ))}
            </tbody>
          </table>
          {/* Nút nằm ở ĐÁY khối đã bung ra, cố ý: muốn bấm thì phải mở khối lên,
              tức là đã nhìn thấy đúng những dòng sắp mất. Cùng luật với nút "Xoá
              tất cả" ở ngăn Kết quả — biết mình sắp mất gì TRƯỚC khi bấm. */}
          <div className="mt-2 flex items-center justify-end">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsk(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              {busy ? t('overview.purging') : t('overview.purgeAll')}
            </Button>
          </div>
        </details>
      )}

      <Dialog open={ask} onOpenChange={setAsk}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('overview.purgeTitle', { n: gone.length })}</DialogTitle>
            <DialogDescription>
              {plural('plans.jobCount', gone.reduce((n, r) => n + r.tasks, 0))} ·{' '}
              {formatUSD(goneTotal)} {t('overview.purgeBodyMid')}{' '}
              <b>{t('overview.purgeBodyBold')}</b>.
              <br />
              {t('overview.purgeUntouchedBefore')} <b>{t('overview.purgeUntouchedBold')}</b>{' '}
              {t('overview.purgeUntouchedAfter')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAsk(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setAsk(false);
                void purge();
              }}
            >
              {t('overview.purgeAll')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CostRowView({ row }: { row: CostRow }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-1.5 pr-2 text-ink">
        {row.name}
        {row.archived && (
          <span className="ml-1.5 text-xs text-muted">{t('overview.archivedSuffix')}</span>
        )}
      </td>
      <td className="py-1.5 text-right tabular-nums text-muted">
        {plural('plans.jobCount', row.tasks)}
      </td>
      <td className="py-1.5 pl-2 text-right tabular-nums text-muted">
        {plural('plans.turnCount', row.turns)}
      </td>
      <td className="py-1.5 pl-2 text-right tabular-nums text-ink">{formatUSD(row.costUSD)}</td>
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
        <SectionTitle>{t('overview.archivedAgents')}</SectionTitle>
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
                {a.notes > 0 ? plural('overview.lessonNotesKept', a.notes) : a.pitch}
              </span>
            </span>
            <Tip
              label={
                office
                  ? t('overview.restoreTipOffice', { name: office.name })
                  : t('overview.restoreTip')
              }
            >
              <Button size="sm" onClick={() => void actions.archiveAgent(a.role, false)}>
                <ArchiveRestore className="h-3.5 w-3.5" />
                {t('overview.bringBack')}
              </Button>
            </Tip>
            <Tip label={t('overview.deleteRoleTip')}>
              <Button
                size="iconSm"
                variant="ghost"
                aria-label={t('overview.deleteAgentAria', { label: a.label })}
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
        {t('overview.bringBackNoteBefore')} <b>{office?.name ?? t('overview.thisOffice')}</b>{' '}
        {t('overview.bringBackNoteMid')} <b>{t('overview.bringBackNoteBold')}</b>{' '}
        {t('overview.bringBackNoteAfter')}
      </p>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('inspector.confirmDeleteAgentTitle', { label: confirm?.label ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t('inspector.agentDeleteBefore')} <code>roles/{confirm?.role}.yaml</code>{' '}
              {t('inspector.agentDeleteMid')} <b>{t('inspector.agentDeleteBold')}</b>
              <br />
              <br />
              {confirm && confirm.notes > 0 ? (
                <>
                  <b>{plural('overview.lessonNotes', confirm.notes)}</b> {t('overview.atPath')}{' '}
                  <code>knowledge/agents/{confirm.role}/</code> {t('inspector.agentNotesAfter')}
                </>
              ) : (
                <>
                  {t('inspector.agentNotesBefore')}{' '}
                  <code>knowledge/agents/{confirm?.role}/</code> {t('overview.notesKeptShort')}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm) void actions.removeAgent(confirm.role).then(() => setAgents((a) => a.filter((x) => x.role !== confirm.role)));
                setConfirm(null);
              }}
            >
              {t('inspector.deleteForGood')}
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
      <SectionTitle className="mb-2">{t('overview.modelsTitle')}</SectionTitle>

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
          <button
            className="mt-2 text-[13px] text-accent hover:underline"
            onClick={() => setOpen(true)}
          >
            {t('inspector.changeModel')}
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

          <Label htmlFor="m-master">{t('overview.masterTier')}</Label>
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

          <Label htmlFor="m-planner">{t('overview.plannerTier')}</Label>
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
            {t('overview.modelNamesBefore')}
            <code>claude-sonnet-5</code>, <code>claude-haiku-4-5-20251001</code>
            {t('overview.modelNamesAfter')}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {t('overview.modelsWideBefore')} <b>{t('overview.modelsWideBold')}</b>
            {t('overview.modelsWideAfter')}
          </p>

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setDraft({ ...models });
                setOpen(false);
              }}
            >
              {t('common.cancel')}
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
              {busy ? t('common.saving') : t('common.save')}
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
          <DialogTitle>{t('overview.removeOfficeTitle', { name: target?.name ?? '' })}</DialogTitle>
          <DialogDescription>
            {t('overview.removeOfficeBefore')} <code>offices/{target?.id}/</code>
            {t('overview.removeOfficeAfter')} <b>{t('inspector.agentDeleteBold')}</b>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (target) void actions.removeOffice(target.id);
              onClose();
            }}
          >
            {t('inspector.deleteForGood')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
