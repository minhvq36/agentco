import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Building2,
  ChevronsLeftRight,
  FileCheck2,
  FolderOpen,
  MessageSquare,
  ScrollText,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/misc';
import { actions, useApp, type PanelId } from '@/lib/store';
import { ChatPanel } from './panels/ChatPanel';
import { PlansPanel } from './panels/PlansPanel';
import { OverviewPanel } from './panels/OverviewPanel';
import { KnowledgePanel } from './panels/KnowledgePanel';
import { LibraryPanel } from './panels/LibraryPanel';
import { ArtifactsPanel } from './panels/ArtifactsPanel';

/**
 * BA KHO ĐỨNG LIỀN NHAU, và thứ tự đó có chủ ý.
 *
 * Chúng là ba khái niệm dễ lẫn nhất trong cả sản phẩm, phân biệt bằng đúng một
 * câu hỏi: **AI ĐẶT FILE VÀO ĐÓ?**
 *
 *   Tủ tài liệu   NGƯỜI DÙNG đưa vào   → thêm/xoá được, không sửa
 *   Kết quả       NHÂN VIÊN làm ra     → xoá được, không thêm, không sửa
 *   Kho tri thức  AGENT tự rút ra      → sửa/xoá được, không thêm
 *
 * Đứng cạnh nhau thì khác biệt đó đọc được bằng mắt; rải ra ba chỗ thì người
 * dùng phải nhớ. Đặt "Kết quả" ở GIỮA vì nó là cái duy nhất có cả hai đầu:
 * nhân viên đọc tài liệu ở trên, và học được gì thì thành tri thức ở dưới.
 * → docs/SPEC-library.md §1 · docs/SPEC-artifacts.md
 */
const TABS: Array<{ id: PanelId; icon: LucideIcon; label: string }> = [
  { id: 'chat', icon: MessageSquare, label: 'Nói với Trợ lý' },
  { id: 'plans', icon: ScrollText, label: 'Nhật ký công việc' },
  { id: 'overview', icon: Building2, label: 'Tổng quan công ty' },
  { id: 'library', icon: FolderOpen, label: 'Tủ tài liệu' },
  { id: 'artifacts', icon: FileCheck2, label: 'Kết quả' },
  { id: 'knowledge', icon: BookOpen, label: 'Kho tri thức' },
];

const MIN_W = 300;
const WIDE_W = 720;
const STORAGE_KEY = 'agentco.panelWidth';

/** Trần theo cửa sổ: canvas phải còn chỗ để nhìn thấy sơ đồ, không chỉ một khe. */
function maxWidth(): number {
  return Math.max(MIN_W, Math.min(WIDE_W + 240, window.innerWidth - 420));
}

function clampWidth(w: number): number {
  return Math.round(Math.max(MIN_W, Math.min(w, maxWidth())));
}

/**
 * Sidebar trái. → docs/SPEC-ui.md §0
 *
 * Bản v0 có một thanh dock dưới chiếm chỗ VĨNH VIỄN cho chat và kế hoạch —
 * thứ người dùng chỉ cần từng lúc. Ở đây: rail icon luôn thấy, panel mở ra khi
 * bấm và đóng lại được, trả toàn bộ màn hình cho canvas.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO PANEL KÉO ĐƯỢC                                                    │
 * │                                                                          │
 * │ 336px là đủ cho một dòng chat, không đủ cho thứ Trợ lý thật sự trả về:   │
 * │ danh sách lệnh, kế hoạch nhiều bước, báo cáo. Nội dung không co lại được │
 * │ — nó chỉ ngắt dòng xấu đi. Nên bề rộng phải là thứ người dùng chỉnh.     │
 * │                                                                          │
 * │ Bề rộng lúc ĐANG KÉO đi thẳng vào DOM qua ref, y hệt toạ độ node trên    │
 * │ canvas. Một `setState` mỗi frame kéo là render lại cả cây React 60       │
 * │ lần/giây trong khi SSE vẫn đang bắn sự kiện vào — đúng thứ tiêu chí      │
 * │ "Hiệu năng" cấm. React chỉ biết bề rộng mới khi THẢ CHUỘT.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function Sidebar() {
  const panel = useApp((s) => s.panel);
  const unread = useApp((s) => s.messages.length - s.seenMessages);
  const working = useApp((s) => s.officeState === 'working');
  const active = TABS.find((t) => t.id === panel);

  const paneRef = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : 336;
  });

  // Thu nhỏ cửa sổ có thể làm panel rộng hơn cả màn hình. Kẹp lại, nếu không
  // canvas biến mất hoàn toàn và không có cách nào lấy lại ngoài xoá localStorage.
  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pane = paneRef.current;
    if (!pane) return;

    const startX = e.clientX;
    const startW = pane.getBoundingClientRect().width;
    let next = startW;

    // `setPointerCapture` trên chính tay nắm: chuột đi nhanh ra ngoài phần tử
    // vẫn không tuột, và không cần bắt sự kiện ở tận `window`.
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      next = clampWidth(startW + (ev.clientX - startX));
      pane.style.width = `${next}px`;
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setWidth(next);
      localStorage.setItem(STORAGE_KEY, String(next));
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, []);

  function applyWidth(w: number): void {
    const next = clampWidth(w);
    setWidth(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  }

  const wide = width >= Math.min(WIDE_W, maxWidth()) - 1;

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
        <section
          ref={paneRef}
          className="relative flex flex-none flex-col"
          style={{ width }}
          aria-label={active.label}
        >
          <div className="flex flex-none items-center gap-2 border-b border-line px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
              {active.label}
            </span>
            <div className="flex-1" />
            <Tip label={wide ? 'Thu về bề rộng thường' : 'Mở rộng bảng'}>
              <Button
                size="iconSm"
                variant="ghost"
                aria-label={wide ? 'Thu hẹp bảng' : 'Mở rộng bảng'}
                onClick={() => applyWidth(wide ? 336 : WIDE_W)}
              >
                <ChevronsLeftRight className="h-4 w-4" />
              </Button>
            </Tip>
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
            {panel === 'library' && <LibraryPanel />}
            {panel === 'artifacts' && <ArtifactsPanel />}
            {panel === 'knowledge' && <KnowledgePanel />}
          </div>

          {/* Tay nắm kéo. Vùng bắt rộng 7px nhưng vạch chỉ hiện khi rê tới —
              một đường kẻ đậm nằm suốt chiều cao màn hình là nhiễu thị giác. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Kéo để đổi bề rộng bảng"
            title="Kéo để đổi bề rộng · nhấp đúp để về mặc định"
            onPointerDown={startResize}
            onDoubleClick={() => applyWidth(336)}
            className="absolute -right-[3px] top-0 z-20 h-full w-[7px] cursor-col-resize touch-none
                       after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-transparent
                       hover:after:bg-accent"
          />
        </section>
      )}
    </div>
  );
}
