import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ScrollText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { agentHue, agentInk, agentWash } from '@/lib/colors';
import { Markdown } from '@/lib/markdown';
import { labelFor, toast, useApp } from '@/lib/store';
import type { AgentEvent, PlanRecord, PlanStatus } from '@/lib/types';

const STATUS: Record<PlanStatus, { label: string; cls: string }> = {
  planning: { label: 'đang lập kế hoạch', cls: 'text-accent' },
  running: { label: 'đang chạy', cls: 'text-accent' },
  done: { label: 'xong', cls: 'text-ok' },
  failed: { label: 'hỏng', cls: 'text-danger' },
  // `warn` chứ không phải `danger`: chưa có gì hỏng, hệ thống đang chờ NGƯỜI
  // DÙNG. Tô đỏ một ca chỉ vì Trợ lý hỏi lại là dạy người dùng sợ câu hỏi.
  blocked: { label: 'đang chờ bạn trả lời', cls: 'text-warn' },
  paused: { label: 'tạm nghỉ', cls: 'text-warn' },
  stopped: { label: 'đã dừng', cls: 'text-muted' },
};

/**
 * Nhật ký. → docs/SPEC-offices.md §6
 *
 * Log ĐI THEO CÔNG VIỆC, không theo thời gian. Bản v0 là một dòng chảy phẳng:
 * không đọc được khi hai việc chạy chồng nhau, và không trả lời được "việc hôm
 * qua đã làm những gì". Ở đây: danh sách việc → mở một việc → log của đúng nó.
 */
/**
 * Lọc ở tầng HIỂN THỊ, không xoá ở tầng LƯU TRỮ. → docs/SPEC-offices.md §6
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ USER ĐÒI NÚT XOÁ, RỒI TỰ CHẶN LẠI — và câu chặn đó đúng.                │
 * │                                                                          │
 * │ *"nhiều khi hỏng, bị zombie thấy ngứa mắt"* → *"hay là giữ lại log nhỉ,  │
 * │ để trace được, liên quan cả tiền nong các thứ"*.                         │
 * │                                                                          │
 * │ Nhật ký là bên DUY NHẤT nối `plan_id` trong sổ chi phí với một cái tên    │
 * │ đọc được. Xoá một dòng thì tiền vẫn nằm trong sổ mà không ai biết nó của  │
 * │ việc gì. Nhưng nỗi khó chịu thì có thật: 18 việc, 8 trong đó không `done`.│
 * │                                                                          │
 * │ Đây đúng là ca luật §5e nói tới: **tách ở tầng HIỂN THỊ rẻ, tách ở tầng   │
 * │ LƯU TRỮ đắt — nghi ngờ thì tách chỗ rẻ trước.** Một cái nút lọc cho đúng │
 * │ sự nhẹ nhõm ấy, 0 dòng lịch sử bị mất, và bấm lại là thấy hết.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Mặc định là **TẤT CẢ**, không phải "chỉ việc xong". Nhật ký mở ra mà đã giấu
 * sẵn phần hỏng là nói dối bằng cách im lặng — người dùng phải CHỌN mới được
 * nhìn ít đi.
 */
const FILTER_KEY = 'agentco.plansFilter';

function readFilter(): boolean {
  try {
    return localStorage.getItem(FILTER_KEY) === 'done';
  } catch {
    return false;
  }
}

export function PlansPanel() {
  const officeId = useApp((s) => s.officeId);
  const currentPlanId = useApp((s) => s.plan?.plan_id ?? null);
  const [plans, setPlans] = useState<PlanRecord[] | null>(null);
  const [open, setOpen] = useState<{ plan: PlanRecord; log: AgentEvent[] } | null>(null);
  // Panel bị unmount khi đổi tab (`{panel === 'plans' && …}`), nên lựa chọn này
  // phải sống ngoài component — cùng lớp lỗi với bản nháp ô chat.
  const [onlyDone, setOnlyDone] = useState(readFilter);

  const load = useCallback(async () => {
    if (!officeId) return;
    try {
      const res = await api.plans(officeId);
      setPlans(res.plans);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không đọc được lịch sử công việc.');
      setPlans([]);
    }
  }, [officeId]);

  useEffect(() => {
    void load();
  }, [load, currentPlanId]);

  const openPlan = useCallback(
    async (planId: string) => {
      if (!officeId) return;
      try {
        setOpen(await api.plan(officeId, planId));
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Không mở được công việc này.');
      }
    },
    [officeId],
  );

  if (open) {
    return <PlanDetail data={open} onBack={() => setOpen(null)} onReload={() => void openPlan(open.plan.plan_id)} />;
  }

  if (plans === null) {
    return <div className="px-4 py-6 text-[13px] text-muted">Đang đọc…</div>;
  }

  if (plans.length === 0) {
    return (
      <Empty
        icon={<ScrollText className="h-7 w-7" />}
        title="Chưa có công việc nào"
        hint="Mỗi việc bạn giao sinh ra một bản ghi riêng, có kế hoạch và nhật ký của chính nó."
      />
    );
  }

  const hidden = plans.filter((p) => p.status !== 'done').length;
  const shown = onlyDone ? plans.filter((p) => p.status === 'done') : plans;

  const toggle = (): void => {
    const next = !onlyDone;
    setOnlyDone(next);
    try {
      localStorage.setItem(FILTER_KEY, next ? 'done' : 'all');
    } catch {
      /* bị chặn storage thì lựa chọn chỉ sống trong phiên — không sao */
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/*
        Thanh lọc chỉ hiện khi CÓ gì để lọc. Một cái nút không đổi được gì trên
        màn hình là nhiễu — và ở văn phòng mới, mọi việc đều `done`.
      */}
      {hidden > 0 && (
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2 text-xs text-muted">
          <span className="tabular-nums">
            {plans.length} việc · {hidden} chưa xong
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={toggle}>
            {onlyDone ? 'Hiện tất cả' : 'Chỉ việc xong'}
          </Button>
        </div>
      )}
      {/*
        Trạng thái rỗng của một BỘ LỌC khác trạng thái rỗng của cả nhật ký: ở đây
        dữ liệu vẫn còn nguyên, chỉ là đang bị lọc đi. Nói đúng chuyện đó, kèm
        đường quay lại — nếu không thì người dùng tưởng nhật ký vừa bị mất.
      */}
      {shown.length === 0 ? (
        <div className="px-4 py-6 text-[13px] text-muted">
          Chưa có việc nào xong. {plans.length} việc còn lại đang bị bộ lọc ẩn đi —{' '}
          <button className="text-accent underline underline-offset-2" onClick={toggle}>
            hiện tất cả
          </button>
          .
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {shown.map((p) => {
            const st = STATUS[p.status];
            return (
              <li key={p.plan_id}>
                <button
                  className="w-full border-b border-line px-4 py-3 text-left transition-colors hover:bg-line/40"
                  onClick={() => void openPlan(p.plan_id)}
                >
                  <div className="line-clamp-2 text-[13.5px] text-ink">{p.request}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <span className={st.cls}>{st.label}</span>
                    <span>·</span>
                    <span className="tabular-nums">
                      {p.tasks_done}/{p.tasks_total} việc
                    </span>
                    <span>·</span>
                    <span className="tabular-nums">${p.costUSD.toFixed(4)}</span>
                    <span className="flex-1" />
                    <span>
                      {new Date(p.started_at).toLocaleTimeString('vi-VN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PlanDetail({
  data,
  onBack,
  onReload,
}: {
  data: { plan: PlanRecord; log: AgentEvent[] };
  onBack(): void;
  onReload(): void;
}) {
  const { plan, log } = data;
  const st = STATUS[plan.status];
  const live = useApp((s) => s.plan?.plan_id === plan.plan_id);
  const [openRequest, setOpenRequest] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-start gap-2 border-b border-line px-3 py-3">
        <Button size="iconSm" variant="ghost" onClick={onBack} aria-label="Quay lại danh sách">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          {/*
            Câu yêu cầu cũng phải có TRẦN — cùng bệnh với khối báo cáo ở đáy.
            `request` là câu Trợ lý viết lại "cho rõ, đủ ngữ cảnh" nên nó dài
            thật: đo được 300+ ký tự, và trong một sidebar hẹp thì nó xuống 6–7
            dòng rồi đẩy tất cả những thứ bên dưới xuống.

            ⚠ KHÔNG thêm nút "Xem đầy đủ" ở đây: hàng này đã có nút "Quay lại"
            bên trái và "Tải lại" bên phải, nhét nút thứ ba vào là chen chúc và
            người dùng dễ bấm nhầm. Cho CHÍNH ĐOẠN CHỮ làm nút — nó là thứ duy
            nhất trong hàng có sẵn diện tích, và "bấm vào chữ bị cắt để xem đủ"
            là phản xạ người ta đã có. `title` để rê chuột cũng đọc được.
          */}
          <button
            className={`w-full cursor-pointer text-left text-[13.5px] leading-snug text-ink ${
              openRequest ? '' : 'line-clamp-2'
            }`}
            title={plan.request}
            aria-expanded={openRequest}
            onClick={() => setOpenRequest((v) => !v)}
          >
            {plan.request}
          </button>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span className={st.cls}>{st.label}</span>
            <span>·</span>
            <span className="tabular-nums">
              {plan.turns} lượt · ${plan.costUSD.toFixed(4)}
            </span>
          </div>
        </div>
        {live && (
          <Button size="sm" variant="ghost" onClick={onReload}>
            Tải lại
          </Button>
        )}
      </div>

      {plan.steps.length > 0 && (
        <ol className="flex-none border-b border-line px-4 py-2.5">
          {plan.steps.map((s, i) => (
            <li key={i} className="flex gap-2 py-0.5 text-[13px]">
              <span className="w-4 text-center text-muted">{stepIcon(s.status)}</span>
              <span className={s.status === 'done' ? 'text-muted' : 'text-ink'}>{s.title}</span>
            </li>
          ))}
        </ol>
      )}

      <TokenPanel log={log} />

      {/*
        `min-h-[8rem]` là SÀN, không phải trang trí.

        Khối này là thứ duy nhất co giãn trong cột; mọi khối khác đều `flex-none`.
        Không có sàn thì bốn khối cứng bên trên + báo cáo bên dưới ép nó xuống
        vài chục pixel, và người dùng thấy một ô "không cuộn được" — nó CÓ cuộn,
        chỉ là cửa sổ nhỏ hơn một dòng. Đây đúng triệu chứng user báo 21/08.
      */}
      <div className="min-h-[8rem] flex-1 overflow-y-auto px-3 py-2">
        {log.length === 0 ? (
          <div className="px-1 py-4 text-[13px] text-muted">Việc này chưa ghi được sự kiện nào.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {collapse(log).map((row, i) => (
              <LogLine key={i} event={row.event} times={row.times} />
            ))}
          </ul>
        )}
      </div>

      {plan.report && <Report text={plan.report} />}
    </div>
  );
}

/**
 * Câu tổng kết của Trợ lý, ở đáy bảng chi tiết một ca.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUG UX 21/08 — MỘT CHỮ `flex-none` NUỐT CẢ NHẬT KÝ.                      │
 * │                                                                          │
 * │ Bản trước: `<div className="flex-none …">{plan.report}</div>`. Trong một  │
 * │ cột flex, `flex-none` nghĩa là *"không bao giờ co lại"* — nên một báo cáo │
 * │ dài 30 dòng chiếm 30 dòng, và khối nhật ký (thứ DUY NHẤT co giãn) bị ép   │
 * │ xuống gần bằng không.                                                     │
 * │                                                                          │
 * │ Người dùng báo đúng cảm giác đó: *"không biết các worker trao đổi cái gì, │
 * │ cảm giác như không lăn chuột được — chỉ làm được khi kéo khung rộng ra"*. │
 * │ Kéo rộng ra thì chữ xuống dòng ít hơn ⇒ báo cáo thấp xuống ⇒ nhật ký có   │
 * │ lại chỗ. Tức là bố cục đang bắt người dùng chỉnh cửa sổ để đọc được nội   │
 * │ dung — cùng lớp với luật *"thao tác dọn dẹp của hệ thống không được nằm   │
 * │ ở tay người dùng"*.                                                       │
 * │                                                                          │
 * │ ⚠ Sàn `min-h` cho nhật ký là CHƯA ĐỦ. Sàn chỉ cứu khi khung đủ cao; khung │
 * │ thấp thì hai bên lại tranh nhau. Phải chặn từ phía gây ra: báo cáo KHÔNG  │
 * │ được phép cao hơn một tỉ lệ cố định.                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Ba tầng, và thứ tự có chủ ý:
 *
 *  1. **Mặc định gấp lại 3 dòng.** Nhật ký giữ gần như toàn bộ chiều cao ngay
 *     khi mở ra — đó là thứ người ta mở bảng này để xem.
 *  2. **Mở ra thì trần 40%.** Vẫn còn 60% cho nhật ký kể cả với báo cáo dài
 *     nhất. Cuộn nằm TRONG khối này.
 *  3. Nút bấm nói **"Thu gọn"/"Xem đầy đủ"**, không phải một mũi tên — người
 *     dùng phải biết mình sắp mất chỗ hay được thêm chỗ.
 *
 * Dùng `Markdown` chứ không in chuỗi trần: báo cáo là chữ Trợ lý viết ra và nó
 * có gạch đầu dòng, đường dẫn, đôi khi cả bảng — hệt như trong ô chat.
 */
function Report({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex max-h-[40%] flex-none flex-col border-t border-line">
      <div className="flex flex-none items-center gap-2 px-4 pt-2.5">
        <span className="text-xs font-medium text-muted">Kết quả</span>
        <span className="flex-1" />
        <button
          className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Thu gọn' : 'Xem đầy đủ'}
        </button>
      </div>
      {/*
        Lúc gấp lại dùng TRẦN CHIỀU CAO, không dùng `line-clamp`.

        `line-clamp` chạy trên `-webkit-box` và chỉ đáng tin với MỘT dòng chảy
        văn bản. Báo cáo đi qua `Markdown` nên bên trong là nhiều khối block
        (đoạn văn, danh sách việc, đôi khi cả bảng) — clamp lúc đó hoặc không
        cắt gì, hoặc cắt ở chỗ không ai đoán được. `max-h` thì tất định bất kể
        bên trong có cấu trúc gì.
      */}
      <div
        className={`min-h-0 px-4 pb-3 pt-1 text-[13px] text-ink ${
          open ? 'overflow-y-auto' : 'max-h-[4.5rem] overflow-hidden'
        }`}
      >
        <Markdown text={text} />
      </div>
    </div>
  );
}

function stepIcon(s: string): string {
  return { pending: '○', running: '⟳', done: '✓', problem: '⚠', waiting_human: '⏸' }[s] ?? '○';
}

function kilo(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

/**
 * BẢNG TOKEN của một công việc. → docs/SPEC-token-economy.md §5
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO PHẢI HIỆN, VÀ VÌ SAO MODEL KHÔNG ĐƯỢC BIẾT                        │
 * │                                                                          │
 * │ `SPEC-token-economy.md` §5 gọi cảnh báo "cache write bất thường" là hệ    │
 * │ thống báo động CHÍNH, và nói thẳng: đây là lỗi người dùng sẽ KHÔNG tự     │
 * │ nhìn ra nếu không có dòng này. Nhưng cho tới giờ nó không tồn tại ở đâu   │
 * │ trên giao diện — số liệu vẫn nằm sẵn trong mỗi sự kiện `task.done` và     │
 * │ trong file log, chỉ là chưa ai vẽ ra. Hiện nó lên tốn 0 token.            │
 * │                                                                          │
 * │ Và nó phải là VIỆC CỦA CODE, không bao giờ của model. Ba lý do:           │
 * │  1. Nhân viên không làm gì được với con số đó — nó không tự đổi cách làm  │
 * │     việc vì biết mình vừa ghi 13K cache.                                  │
 * │  2. Nói cho model biết nghĩa là nhét con số vào prompt, tức là trả tiền   │
 * │     ở MỌI lượt để kể một chuyện chỉ có nghĩa với người quan sát.          │
 * │  3. `CORE_PROMPT` đã cấm thuật ngữ kỹ thuật trong `say`. Kế toán là việc  │
 * │     của người đứng ngoài đếm, không phải của người đang làm.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Đọc bảng này thế nào (bài 1 của TEST-WALKTHROUGH): nhìn cột **ghi cache** —
 * task ĐẦU của mỗi vai trò lớn, các task sau nhỏ. Đó là cache priming gate đang
 * chạy đúng. Cả loạt đều lớn = gate hỏng, và mỗi task đang trả nguyên giá prefix.
 */
function TokenPanel({ log }: { log: AgentEvent[] }) {
  const rows = log.filter(
    (e): e is Extract<AgentEvent, { type: 'task.done' }> => e.type === 'task.done',
  );
  if (rows.length === 0) return null;

  const total = rows.reduce(
    (a, e) => ({
      read: a.read + e.usage.cacheRead,
      write: a.write + e.usage.cacheWrite,
      out: a.out + e.usage.output,
      turns: a.turns + e.usage.turns,
      cost: a.cost + e.usage.costUSD,
    }),
    { read: 0, write: 0, out: 0, turns: 0, cost: 0 },
  );

  // Cùng một vai trò ghi cache nhiều lần trong MỘT ca = có gì đó đang phá prefix
  // giữa chừng (bump version, sửa skills, đổi model). Đây là dòng báo động chính.
  const writesByRole = new Map<string, number>();
  for (const e of rows) {
    if (e.usage.cacheWrite > 2000) writesByRole.set(e.role, (writesByRole.get(e.role) ?? 0) + 1);
  }
  const noisy = [...writesByRole.entries()].filter(([, n]) => n > 1);

  return (
    <details className="flex-none border-b border-line px-4 py-2">
      <summary className="cursor-pointer list-none text-xs text-muted marker:hidden">
        Token: <span className="tabular-nums text-ink">{kilo(total.read)}</span> đọc lại ·{' '}
        <span className="tabular-nums text-ink">{kilo(total.write)}</span> ghi cache ·{' '}
        <span className="tabular-nums text-ink">{total.turns}</span> lượt
        {noisy.length > 0 && <span className="ml-1.5 text-danger">⚠ ghi cache lặp</span>}
        <span className="float-right">chi tiết</span>
      </summary>

      <table className="mt-2 w-full text-[12px]">
        <thead>
          <tr className="text-muted">
            <th className="pb-1 text-left font-normal">việc</th>
            <th className="pb-1 text-right font-normal">đọc lại</th>
            <th className="pb-1 text-right font-normal">ghi cache</th>
            <th className="pb-1 text-right font-normal">lượt</th>
            <th className="pb-1 text-right font-normal">$</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={i} className="border-t border-line">
              <td className="py-1 pr-2 text-ink">{labelFor(e.role)}</td>
              <td className="py-1 text-right tabular-nums text-muted">{kilo(e.usage.cacheRead)}</td>
              <td className="py-1 pl-2 text-right tabular-nums text-ink">{kilo(e.usage.cacheWrite)}</td>
              <td className="py-1 pl-2 text-right tabular-nums text-muted">{e.usage.turns}</td>
              <td className="py-1 pl-2 text-right tabular-nums text-muted">
                ${e.usage.costUSD.toFixed(4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {noisy.length > 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-danger">
          ⚠ {noisy.map(([r]) => labelFor(r)).join(', ')} ghi cache nhiều lần trong một ca. Có thứ gì
          đang phá prefix giữa chừng — sửa skills, đổi model, hoặc bump version lúc đang chạy.
        </p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Task đầu của mỗi vai trò <b>ghi cache</b> lớn, các task sau nhỏ — đó là cache priming gate
          chạy đúng. Cả loạt đều lớn nghĩa là gate hỏng.
        </p>
      )}
    </details>
  );
}

/**
 * Gộp những dòng LIÊN TIẾP giống hệt nhau thành một, kèm số lần.
 *
 * Một lượt gọi có nhiều tool chạy song song đến qua SDK thành nhiều tin nhắn
 * riêng, nên bốn lần `Grep` cùng lúc hiện ra bốn dòng y hệt trong cùng một
 * giây. Bốn dòng không nói được gì hơn một dòng, mà chúng đẩy phần còn lại của
 * nhật ký ra khỏi màn hình.
 *
 * Chỉ gộp dòng LIỀN KỀ và CÙNG một người: gộp cả những dòng cách xa nhau sẽ
 * giấu mất việc nhân viên lặp lại đúng một thao tác ở hai thời điểm — mà đó
 * chính là dấu hiệu nó đang dò dẫm, thứ ta cần nhìn thấy.
 */
function collapse(log: readonly AgentEvent[]): Array<{ event: AgentEvent; times: number }> {
  const out: Array<{ event: AgentEvent; times: number }> = [];
  for (const event of log) {
    const prev = out[out.length - 1];
    if (prev && sameLine(prev.event, event)) prev.times++;
    else out.push({ event, times: 1 });
  }
  return out;
}

function sameLine(a: AgentEvent, b: AgentEvent): boolean {
  if (a.type !== b.type) return false;
  if (a.type !== 'task.progress' || b.type !== 'task.progress') return false;
  return a.role === b.role && a.say === b.say;
}

/**
 * Một dòng log. Màu lấy từ id vai trò (băm) — cùng công thức với node trên
 * canvas, nên mắt nối được "dòng này của ai" với "node nào đang sáng".
 */
function LogLine({ event, times = 1 }: { event: AgentEvent; times?: number }) {
  // Màu băm từ `id` (ổn định), nhãn lấy tên người dùng đặt (dễ đọc). Hai thứ
  // này CỐ Ý lấy từ hai nguồn khác nhau — đổi tên hiển thị không được làm đổi
  // màu, vì mắt đã quen nối màu với người.
  const who = 'role' in event ? (event as { role: string }).role : 'assistant';
  const hue = agentHue(who);
  const time = event.ts ? new Date(event.ts).toLocaleTimeString('vi-VN', { hour12: false }) : '';
  const text = describe(event);
  if (!text) return null;

  return (
    <li className="flex gap-2 text-[12.5px] leading-snug">
      <span className="w-14 flex-none tabular-nums text-muted">{time}</span>
      <span
        className="flex-none rounded px-1.5 font-medium"
        style={{ color: agentInk(hue), background: agentWash(hue) }}
        title={who}
      >
        {labelFor(who)}
      </span>
      <span className="min-w-0 flex-1 break-words text-ink">
        {text}
        {times > 1 && <span className="ml-1 tabular-nums text-muted">×{times}</span>}
      </span>
    </li>
  );
}

/** Mọi sự kiện hướng người dùng đều có `say` — đây là chỗ bất biến đó trả công. */
function describe(e: AgentEvent): string {
  switch (e.type) {
    case 'plan.created':
      return `lập kế hoạch ${e.steps.length} bước`;
    case 'plan.step':
      return '';
    // CỐ Ý không hiện gì: câu báo cáo đã đi bằng `master.message` ngay trước đó.
    // Hiện lại ở đây là hai dòng y hệt nhau nằm cạnh nhau.
    case 'plan.finished':
      return '';
    case 'task.started':
    case 'task.progress':
      return e.say;
    case 'task.done':
      return `${e.say}${e.artifacts.length ? ` → ${e.artifacts.join(', ')}` : ''}  ·  ${e.usage.turns} lượt · $${e.usage.costUSD.toFixed(4)}`;
    case 'task.blocked':
      return `⚠ ${e.say} (${e.reason})`;
    case 'master.message':
      return e.say;
    case 'office.state':
      return e.say;
    case 'cost.tick':
      return `tổng ${e.totals.tasks} việc · ${e.totals.turns} lượt · $${e.totals.costUSD.toFixed(4)}`;
    default:
      return '';
  }
}
