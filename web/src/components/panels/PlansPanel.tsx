import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ScrollText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { agentHue, agentInk, agentWash } from '@/lib/colors';
import { labelFor, toast, useApp } from '@/lib/store';
import type { AgentEvent, PlanRecord, PlanStatus } from '@/lib/types';

const STATUS: Record<PlanStatus, { label: string; cls: string }> = {
  planning: { label: 'đang lập kế hoạch', cls: 'text-accent' },
  running: { label: 'đang chạy', cls: 'text-accent' },
  done: { label: 'xong', cls: 'text-ok' },
  failed: { label: 'hỏng', cls: 'text-danger' },
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
export function PlansPanel() {
  const officeId = useApp((s) => s.officeId);
  const currentPlanId = useApp((s) => s.plan?.plan_id ?? null);
  const [plans, setPlans] = useState<PlanRecord[] | null>(null);
  const [open, setOpen] = useState<{ plan: PlanRecord; log: AgentEvent[] } | null>(null);

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

  return (
    <ul className="flex h-full flex-col overflow-y-auto">
      {plans.map((p) => {
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
                <span>{new Date(p.started_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-start gap-2 border-b border-line px-3 py-3">
        <Button size="iconSm" variant="ghost" onClick={onBack} aria-label="Quay lại danh sách">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] leading-snug text-ink">{plan.request}</div>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {log.length === 0 ? (
          <div className="px-1 py-4 text-[13px] text-muted">Việc này chưa ghi được sự kiện nào.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {log.map((e, i) => (
              <LogLine key={i} event={e} />
            ))}
          </ul>
        )}
      </div>

      {plan.report && (
        <div className="flex-none border-t border-line px-4 py-3 text-[13px] text-ink">{plan.report}</div>
      )}
    </div>
  );
}

function stepIcon(s: string): string {
  return { pending: '○', running: '⟳', done: '✓', problem: '⚠', waiting_human: '⏸' }[s] ?? '○';
}

/**
 * Một dòng log. Màu lấy từ id vai trò (băm) — cùng công thức với node trên
 * canvas, nên mắt nối được "dòng này của ai" với "node nào đang sáng".
 */
function LogLine({ event }: { event: AgentEvent }) {
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
      <span className="min-w-0 flex-1 break-words text-ink">{text}</span>
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
