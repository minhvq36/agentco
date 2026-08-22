import { Pencil, Plus, Power, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, Tip } from '@/components/ui/misc';
import { actions, useApp } from '@/lib/store';
import { api } from '@/lib/api';

const STATE_LABEL: Record<string, string> = {
  idle: 'rảnh',
  working: 'đang làm',
  paused: 'tạm nghỉ',
  stopped: 'đã tắt',
};

const STATE_DOT: Record<string, string> = {
  idle: 'bg-ok',
  working: 'bg-accent soft-pulse',
  paused: 'bg-warn',
  stopped: 'bg-muted',
};

/**
 * Nhãn hai cửa sổ. CHỈ HAI — không tách theo model. (user chốt 22/08)
 *
 * Server có trả về `seven_day_opus` / `seven_day_sonnet` và cả một loạt rổ tên
 * mã nội bộ, nhưng hạn mức là của cả TÀI KHOẢN: người dùng có thể đã tiêu phần
 * lớn nó vào việc chẳng liên quan gì tới công ty này. Ô này trả lời đúng một
 * câu — *"tôi còn chạy được nữa không, và tới khi nào"*. Mọi con số khác là mời
 * họ đi truy nguyên một thứ họ không sửa được.
 */
const WINDOW_LABEL: Record<string, string> = {
  session: 'Phiên',
  weekly: 'Tuần',
};

const ENERGY_WORD: Record<string, string> = {
  allowed: 'còn thoải mái',
  allowed_warning: 'sắp chạm hạn mức',
  rejected: 'đã chạm hạn mức',
};

/**
 * Ba bộ màu, mỗi bộ là một GRADIENT chứ không phải một màu phẳng.
 *
 * `[dim, mid, hot]` — dùng chung cho nền thanh VÀ cho tia sét, nên hai thứ luôn
 * cùng tông. Đây là lý do bảng này là mảng màu thật chứ không phải tên class
 * Tailwind: `<linearGradient>` trong SVG cần giá trị màu, không nhận class.
 *
 * Xanh ngọc lam cho trạng thái thường: nó KHÔNG trùng với `accent` (màu hành
 * động, dùng cho nút và dây nối) nên thanh này không bị đọc nhầm thành "có gì
 * đó bấm được". Vàng và đỏ thì mượn đúng ngữ nghĩa cảnh báo đã có sẵn.
 */
const RAMP: Record<string, [string, string, string]> = {
  allowed: ['#0e7490', '#06b6d4', '#5eead4'],
  allowed_warning: ['#b45309', '#f59e0b', '#fcd34d'],
  rejected: ['#9f1239', '#e11d48', '#fb7185'],
};

/**
 * Lớp bóng phủ lên thanh. Trắng đậm ở mép trên, tắt dần, rồi hửng lại ở đáy —
 * đúng cách ánh sáng đọng trên một ống thuỷ tinh nằm ngang.
 *
 * Nằm ở lớp RIÊNG chồng lên gradient màu, không trộn vào nó: trộn thì mỗi lần
 * đổi tông màu lại phải tính lại độ sáng, còn tách ra thì một lớp bóng dùng
 * chung cho cả ba trạng thái.
 */
const GLOSS =
  'linear-gradient(180deg,rgba(255,255,255,.55) 0%,rgba(255,255,255,.12) 45%,' +
  'rgba(255,255,255,0) 70%,rgba(255,255,255,.22) 100%)';

const fill = (s: string): string => {
  const [dim, mid, hot] = RAMP[s] ?? RAMP['allowed']!;
  return `linear-gradient(90deg,${dim} 0%,${mid} 58%,${hot} 100%)`;
};

/**
 * Tia sét vẽ tay bằng SVG thay vì mượn icon.
 *
 * Lý do là một ràng buộc thật, không phải sở thích: icon của thư viện tô bằng
 * `currentColor`, tức là MỘT màu — mà thứ cần ở đây là **đúng cái gradient đang
 * chạy trên thanh**. `<linearGradient>` nội bộ cho phép tia sét và thanh dùng
 * chung một dải màu, nên khi hạn mức chuyển vàng rồi đỏ thì cả hai chuyển cùng
 * nhau, không lệch một nhịp.
 *
 * `id` phải DUY NHẤT trong cả trang: SVG gradient sống trong không gian tên
 * toàn cục của document, hai cái trùng id thì cái sau đè cái trước.
 */
function Bolt({ status }: { status: string }) {
  const [dim, mid, hot] = RAMP[status] ?? RAMP['allowed']!;
  const id = `energy-bolt-${status}`;
  return (
    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] flex-none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={hot} />
          <stop offset="55%" stopColor={mid} />
          <stop offset="100%" stopColor={dim} />
        </linearGradient>
      </defs>
      <path d="M13.5 2 4 13.2h6.2L10 22l9.6-11.3h-6.3z" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * HẠN MỨC TÀI KHOẢN CLAUDE. → src/core/energy.ts
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐÂY KHÔNG PHẢI HẠN MỨC CỦA CÔNG TY — VÀ CHỮ PHẢI NÓI RA ĐIỀU ĐÓ.        │
 * │                                                                          │
 * │ Nó là quota của tài khoản Claude, dùng chung với Claude Code và           │
 * │ claude.ai của chính người dùng. Một người thấy "sắp chạm hạn mức" ngay    │
 * │ cạnh con số chi phí của văn phòng sẽ đinh ninh agentco vừa tiêu hết —     │
 * │ trong khi có thể họ vừa ngồi code cả sáng ở cửa sổ khác. Tooltip nói rõ.  │
 * │                                                                          │
 * │ ⚠ KHÔNG VẼ THANH KHI KHÔNG CÓ SỐ. Đo 22/08: server gửi `status` và       │
 * │ `resetsAt` nhưng KHÔNG gửi `utilization` — mà `utilization` mới là thứ    │
 * │ vẽ được thanh. Một cái thanh rỗng, hay tệ hơn là một cái thanh 0%, là     │
 * │ nói dối về thứ ta không biết; còn "còn thoải mái · làm mới 21:30" thì     │
 * │ đúng từng chữ. Nhánh `<Bar>` dưới đây nằm sẵn và tự sống dậy đúng ngày   │
 * │ server bắt đầu gửi số — không phải sửa gì.                                │
 * │                                                                          │
 * │ Người dùng chạy bằng API key thì không có hạn mức gói, sự kiện không bao  │
 * │ giờ tới, và ô này biến mất hoàn toàn. Đó là hành vi ĐÚNG, không phải một  │
 * │ trạng thái rỗng cần lấp.                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function EnergyChip() {
  const energy = useApp((s) => s.energy);
  // Chưa lấy được số (đang hỏi, hoặc chạy bằng API key nên không có hạn mức
  // gói) → im hẳn. Một ô rỗng chờ dữ liệu tệ hơn không có ô nào.
  if (!energy || energy.windows.length === 0) return null;

  /**
   * Tia sét lấy màu của cửa sổ CĂNG NHẤT, không phải của cửa sổ đầu tiên.
   *
   * Nó là thứ duy nhất nhìn thấy được khi liếc qua mà không đọc số — nên nó
   * phải nói về cái sắp chặn bạn. Sét xanh trong khi thanh dưới đã đỏ là một
   * lời trấn an sai.
   */
  const rank: Record<string, number> = { rejected: 0, allowed_warning: 1, allowed: 2 };
  const worst = energy.windows.reduce(
    (acc, w) => ((rank[w.status] ?? 2) < (rank[acc] ?? 2) ? w.status : acc),
    'allowed' as string,
  );

  return (
    <Tip
      side="bottom"
      label={
        `Hạn mức tài khoản Claude${energy.plan ? ` (${energy.plan})` : ''} của bạn — dùng chung với ` +
        `Claude Code và claude.ai, KHÔNG phải chi phí của văn phòng này. ` +
        energy.windows
          .map(
            (w) =>
              `${w.kind === 'session' ? 'Phiên' : 'Tuần'}: ` +
              (w.utilization === null ? (ENERGY_WORD[w.status] ?? w.status) : `đã dùng ${Math.round(w.utilization)}%`) +
              (w.resetsAt ? `, làm mới ${resetLabel(w.resetsAt, true)}` : ''),
          )
          .join(' · ')
      }
    >
      {/*
        MỘT CÁI TAG, hai dòng bên trong.

        Viền + nền riêng để nó tách khỏi header thành một khối đọc được bằng một
        cú liếc — thay vì hai dòng chữ trôi nổi cạnh con số chi phí, thứ mà mắt
        sẽ gom nhầm thành cùng một nhóm. Chúng KHÔNG cùng một nhóm: một bên là
        tiền của văn phòng này, một bên là hạn mức của cả tài khoản.

        Hai thanh XẾP CHỒNG, không rút gọn còn một: "phiên gần hết nhưng tuần
        còn nhiều" là một quyết định khác hẳn "cả hai đều cạn". Giấu một cái vào
        tooltip là bắt người dùng hover mỗi lần muốn ra quyết định.
      */}
      <span className="flex items-center gap-2 rounded-lg border border-line bg-paper/60 px-2 py-1">
        <span className="flex flex-none flex-col items-center gap-0.5">
          <Bolt status={worst} />
          {energy.plan && (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">
              {energy.plan}
            </span>
          )}
        </span>

        <span className="flex flex-col gap-[3px] text-[11px] leading-none">
          {energy.windows.map((w) => (
            <span key={w.kind} className="flex items-center gap-1.5">
              {/* CĂN TRÁI: hai nhãn dài khác nhau ("Phiên"/"Tuần") căn phải thì
                  mép chữ nhảy, còn căn trái thì hai dòng có cùng một mốc bắt
                  đầu — mắt đọc xuống theo một đường thẳng. */}
              <span className="w-8 font-medium text-ink">{WINDOW_LABEL[w.kind] ?? w.kind}</span>
              {w.utilization === null ? (
                /* Chưa có % thì nói chữ. Một thanh 0% là nói dối về thứ chưa biết. */
                <span className="w-[136px] text-muted">{ENERGY_WORD[w.status] ?? w.status}</span>
              ) : (
                <>
                  {/* Máng: dài (112px) và MỎNG (4px). Dài thì 3% và 8% phân biệt
                      được bằng mắt; mỏng thì hai thanh chồng nhau vẫn thoáng. */}
                  <span className="h-1 w-28 overflow-hidden rounded-full bg-line">
                    <span
                      className="relative block h-full rounded-full"
                      style={{
                        // Tối thiểu 3% để 1% vẫn thấy một vệt — 0px trông y hệt
                        // "chưa có dữ liệu", đúng thứ vừa cố tránh ở nhánh trên.
                        width: `${Math.max(3, Math.round(w.utilization))}%`,
                        backgroundImage: `${GLOSS},${fill(w.status)}`,
                      }}
                    />
                  </span>
                  <span className="w-7 text-right tabular-nums text-ink">
                    {Math.round(w.utilization)}%
                  </span>
                </>
              )}
              {w.resetsAt && <span className="tabular-nums text-muted">{resetLabel(w.resetsAt)}</span>}
            </span>
          ))}
        </span>
      </span>
    </Tip>
  );
}

/**
 * Mốc làm mới. Hôm nay thì chỉ giờ, khác ngày thì kèm thứ.
 *
 * Người dùng đọc con số này để quyết định "chờ hay chạy tiếp", nên "21:30" trả
 * lời được câu đó còn "còn 2 giờ 47 phút" thì bắt họ tự cộng vào đồng hồ —
 * và nó còn phải tự đếm lùi, tức là một `setInterval` cho một câu không cần.
 */
function resetLabel(iso: string, long = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const hm = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const short = sameDay ? hm : `${d.toLocaleDateString('vi-VN', { weekday: 'short' })} ${hm}`;
  // Tooltip có chỗ nên nói đủ ngày; trên header thì "T4 10:59" là vừa.
  return long && !sameDay ? `${d.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })} ${hm}` : short;
}

export function Header({
  onNewOffice,
  onRenameOffice,
}: {
  onNewOffice(): void;
  onRenameOffice(): void;
}) {
  const company = useApp((s) => s.company);
  const officeId = useApp((s) => s.officeId);
  const officeState = useApp((s) => s.officeState);
  const cost = useApp((s) => s.cost);

  return (
    <header className="flex flex-none items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
      <h1 className="text-[15px] font-semibold">{company?.name ?? 'AgentCo'}</h1>

      {company && company.offices.length > 0 && (
        <Select
          aria-label="Văn phòng"
          value={officeId ?? ''}
          onChange={(e) => void actions.openOffice(e.target.value)}
          className="max-w-56"
        >
          {/* Văn phòng đã cất vào lưu trữ KHÔNG nằm ở đây — ô này là chỗ chọn
              nơi làm việc, mà chỗ đã cất đi thì không làm việc được. Chúng nằm
              ở bảng Tổng quan, kèm nút Khôi phục. Ngoại lệ: nếu đang mở đúng
              cái vừa bị cất thì vẫn phải hiện, nếu không ô chọn trống trơn. */}
          {company.offices
            .filter((o) => !o.archived || o.id === officeId)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.avatar} {o.name}
                {o.archived ? ' (lưu trữ)' : ''}
                {o.error ? ' ⚠' : ''}
              </option>
            ))}
        </Select>
      )}

      {officeId && (
        <Tip label="Đổi tên văn phòng đang mở">
          <Button size="iconSm" variant="ghost" aria-label="Đổi tên văn phòng" onClick={onRenameOffice}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </Tip>
      )}

      {officeId && (
        <span className="flex items-center gap-2 text-[13px] text-muted">
          <span className={`h-[7px] w-[7px] rounded-full ${STATE_DOT[officeState] ?? 'bg-muted'}`} />
          {STATE_LABEL[officeState] ?? officeState}
        </span>
      )}

      <div className="flex-1" />

      <EnergyChip />

      {cost && (
        <span className="text-[13px] tabular-nums text-muted">
          {cost.tasks} việc · {cost.turns} lượt · ${cost.costUSD.toFixed(4)}
        </span>
      )}

      <Tip label="Tạo văn phòng mới">
        <Button size="sm" onClick={onNewOffice}>
          <Plus className="h-4 w-4" />
          Văn phòng
        </Button>
      </Tip>

      <Tip label="Dừng việc đang chạy. Daemon vẫn sống.">
        <Button
          size="sm"
          variant="danger"
          disabled={officeState !== 'working'}
          onClick={() => void actions.stop()}
        >
          <Square className="h-3.5 w-3.5" />
          Dừng
        </Button>
      </Tip>

      <Tip label="Shutdown">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Tắt hẳn"
          onClick={() => {
            const ok = window.confirm(
              'Tắt hẳn?\n\nCông ty sẽ ngừng lại.',
            );
            if (ok) void api.shutdown().catch(() => undefined);
          }}
        >
          <Power className="h-4 w-4" />
        </Button>
      </Tip>
    </header>
  );
}
