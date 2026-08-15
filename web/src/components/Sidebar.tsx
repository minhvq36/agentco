import { BookOpen, Building2, MessageSquare, ScrollText, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/misc';
import { actions, useApp, type PanelId } from '@/lib/store';
import { ChatPanel } from './panels/ChatPanel';
import { PlansPanel } from './panels/PlansPanel';
import { OverviewPanel } from './panels/OverviewPanel';
import { KnowledgePanel } from './panels/KnowledgePanel';

const TABS: Array<{ id: PanelId; icon: LucideIcon; label: string }> = [
  { id: 'chat', icon: MessageSquare, label: 'Nói với Trợ lý' },
  { id: 'plans', icon: ScrollText, label: 'Nhật ký công việc' },
  { id: 'overview', icon: Building2, label: 'Tổng quan công ty' },
  { id: 'knowledge', icon: BookOpen, label: 'Kho tri thức' },
];

/**
 * Sidebar trái. → docs/SPEC-ui.md §0
 *
 * Bản v0 có một thanh dock dưới chiếm chỗ VĨNH VIỄN cho chat và kế hoạch —
 * thứ người dùng chỉ cần từng lúc. Ở đây: rail icon luôn thấy, panel mở ra khi
 * bấm và đóng lại được, trả toàn bộ màn hình cho canvas.
 */
export function Sidebar() {
  const panel = useApp((s) => s.panel);
  const unread = useApp((s) => s.messages.length - s.seenMessages);
  const working = useApp((s) => s.officeState === 'working');
  const active = TABS.find((t) => t.id === panel);

  return (
    <div className="flex flex-none border-r border-line bg-panel">
      <nav className="flex w-14 flex-none flex-col items-center gap-1 border-r border-line py-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = panel === t.id;
          return (
            <Tip key={t.id} label={t.label}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t.label}
                aria-pressed={on}
                className={on ? 'bg-accent-soft text-accent' : ''}
                onClick={() => actions.openPanel(t.id)}
              >
                <span className="relative">
                  <Icon className="h-[18px] w-[18px]" />
                  {t.id === 'chat' && unread > 0 && !on && (
                    <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                  {t.id === 'plans' && working && !on && (
                    <span className="soft-pulse absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                </span>
              </Button>
            </Tip>
          );
        })}
      </nav>

      {active && (
        <section className="flex w-[336px] flex-none flex-col" aria-label={active.label}>
          <div className="flex flex-none items-center gap-2 border-b border-line px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
              {active.label}
            </span>
            <div className="flex-1" />
            <Button
              size="iconSm"
              variant="ghost"
              aria-label="Đóng bảng"
              onClick={() => actions.openPanel(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {/* overflow-hidden: mỗi panel tự lo cuộn của nó. Bọc thêm một lớp
              cuộn ở đây sẽ sinh hai thanh cuộn lồng nhau. */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {panel === 'chat' && <ChatPanel />}
            {panel === 'plans' && <PlansPanel />}
            {panel === 'overview' && <OverviewPanel />}
            {panel === 'knowledge' && <KnowledgePanel />}
          </div>
        </section>
      )}
    </div>
  );
}
