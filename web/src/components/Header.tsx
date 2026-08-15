import { Plus, Power, Square } from 'lucide-react';

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

export function Header({ onNewOffice }: { onNewOffice(): void }) {
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
          {company.offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.avatar} {o.name}
              {o.error ? ' ⚠' : ''}
            </option>
          ))}
        </Select>
      )}

      {officeId && (
        <span className="flex items-center gap-2 text-[13px] text-muted">
          <span className={`h-[7px] w-[7px] rounded-full ${STATE_DOT[officeState] ?? 'bg-muted'}`} />
          {STATE_LABEL[officeState] ?? officeState}
        </span>
      )}

      <div className="flex-1" />

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

      <Tip label="Tắt hẳn daemon — phải chạy `agentco start` để bật lại">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Tắt hẳn"
          onClick={() => {
            const ok = window.confirm(
              'Tắt hẳn daemon?\n\nCông ty sẽ ngừng chạy. Muốn bật lại phải chạy lệnh:\n\n  agentco start',
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
