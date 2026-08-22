import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Maximize2,
  Minus,
  Network,
  Plus,
  UserPlus,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty, Tip, TooltipProvider } from '@/components/ui/misc';
import { Canvas, type CanvasHandle } from '@/canvas/Canvas';
import { Header } from '@/components/Header';
import { Inspector } from '@/components/Inspector';
import { Sidebar } from '@/components/Sidebar';
import {
  NewAgentDialog,
  NewOfficeDialog,
  PromptDialog,
  RenameOfficeDialog,
} from '@/components/dialogs';
import { actions, connectEvents, getState, markLocalSave, useApp } from '@/lib/store';
import type { CanvasEdge, CanvasNode } from '@/lib/types';

import '@/canvas/canvas.css';

export default function App() {
  const loading = useApp((s) => s.loading);
  const fatal = useApp((s) => s.fatal);
  const company = useApp((s) => s.company);
  const canvas = useApp((s) => s.canvas);
  const live = useApp((s) => s.live);
  const selected = useApp((s) => s.selected);

  const [newOffice, setNewOffice] = useState(false);
  const [renameOffice, setRenameOffice] = useState(false);
  const [newAgent, setNewAgent] = useState(false);
  const [promptFor, setPromptFor] = useState<string | null>(null);
  const canvasRef = useRef<CanvasHandle | null>(null);

  useEffect(() => {
    void actions.boot();
    return connectEvents();
  }, []);

  /**
   * `Esc` ngắt việc đang chạy — phản xạ của người dùng Claude Code.
   * Cùng hành vi với lệnh chữ `/stop`, để bridge Telegram dùng lại được.
   * → docs/SPEC-tools-approval.md §3b
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Đang mở dialog thì Esc thuộc về dialog — Radix tự lo, đừng cướp.
      if (document.querySelector('[role="dialog"]')) return;
      if (getState().officeState !== 'working') return;
      e.preventDefault();
      void actions.stop();
      actions.openPanel('chat');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Ghi hình dạng, gộp nhịp ~700ms. Kéo node bắn ra hàng chục sự kiện mỗi giây;
   * ghi mỗi lần là ghi đĩa vô nghĩa. Toạ độ chỉ là view state — mất một nhịp
   * không sao, nhưng phải ghi được nhịp CUỐI, nên hẹn lại chứ không bỏ qua.
   */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onCommit = useCallback((nodes: CanvasNode[], edges: CanvasEdge[], immediate?: boolean) => {
    clearTimeout(saveTimer.current);
    if (immediate) {
      // Cạnh nối: gửi NGAY và vẽ lạc quan. Người dùng vừa thả chuột xong, sợi
      // dây phải xuất hiện trước khi server kịp trả lời.
      markLocalSave();
      void actions.saveCanvas(nodes, edges, true);
      return;
    }
    saveTimer.current = setTimeout(() => {
      markLocalSave();
      void actions.saveCanvas(nodes, edges);
    }, 700);
  }, []);

  if (fatal) {
    return (
      <Shell>
        <Empty
          icon={<AlertTriangle className="h-8 w-8 text-danger" />}
          title="Mất kết nối tới công ty"
          hint={fatal}
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              Thử lại
            </Button>
          }
        />
      </Shell>
    );
  }

  if (loading && !company) {
    return (
      <Shell>
        <div className="text-[13px] text-muted">Đang mở công ty…</div>
      </Shell>
    );
  }

  const noOffices = !company || company.offices.length === 0;

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col">
        <Header onNewOffice={() => setNewOffice(true)} onRenameOffice={() => setRenameOffice(true)} />

        {noOffices ? (
          <main className="flex flex-1 items-center justify-center">
            {/* Trạng thái rỗng được THIẾT KẾ, không phải màn hình lỗi.
                → docs/SPEC-offices.md §3 */}
            <Empty
              icon={<Building2 className="h-10 w-10" />}
              title="Công ty chưa có văn phòng nào"
              hint="Mỗi văn phòng có Trợ lý riêng, nhân viên riêng và kho tri thức riêng. Tạo cái đầu tiên để bắt đầu."
              action={
                <Button variant="primary" onClick={() => setNewOffice(true)}>
                  <Plus className="h-4 w-4" />
                  Tạo văn phòng
                </Button>
              }
            />
          </main>
        ) : (
          <div className="flex min-h-0 flex-1">
            <Sidebar />

            <main className="relative min-w-0 flex-1">
              {canvas ? (
                <>
                  <Canvas
                    ref={canvasRef}
                    canvas={canvas}
                    live={live}
                    selected={selected}
                    onSelect={actions.select}
                    onCommit={onCommit}
                    onOpenStore={actions.showPanel}
                    onDropDocs={actions.dropDocs}
                  />
                  <Toolbar
                    onAddAgent={() => setNewAgent(true)}
                    onArrange={() => canvasRef.current?.autoArrange()}
                    onFit={() => canvasRef.current?.fit()}
                    onZoom={(f) => canvasRef.current?.zoomBy(f)}
                  />
                  {canvas.nodes.filter((n) => n.kind === 'agent').length === 0 && <NoAgentsHint />}
                  <PlanStrip />
                  <Hint />
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-[13px] text-muted">
                  Đang mở văn phòng…
                </div>
              )}
            </main>

            <Inspector onShowPrompt={setPromptFor} />
          </div>
        )}

        <Toast />
      </div>

      <NewOfficeDialog open={newOffice} onOpenChange={setNewOffice} />
      <RenameOfficeDialog open={renameOffice} onOpenChange={setRenameOffice} />
      <NewAgentDialog open={newAgent} onOpenChange={setNewAgent} />
      <PromptDialog who={promptFor} onClose={() => setPromptFor(null)} />
    </TooltipProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center">{children}</div>;
}

function Toolbar({
  onAddAgent,
  onArrange,
  onFit,
  onZoom,
}: {
  onAddAgent(): void;
  onArrange(): void;
  onFit(): void;
  onZoom(f: number): void;
}) {
  const officeId = useApp((s) => s.officeId);
  if (!officeId) return null;

  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5">
      <Tip label="Thêm nhân viên vào văn phòng này">
        <Button size="sm" className="shadow-sm" onClick={onAddAgent}>
          <UserPlus className="h-4 w-4" />
          Nhân viên
        </Button>
      </Tip>
      <div className="mx-1 h-5 w-px bg-line" />
      <Tip label="Sắp xếp lại sơ đồ">
        <Button size="icon" className="shadow-sm" aria-label="Sắp xếp lại" onClick={onArrange}>
          <Network className="h-4 w-4" />
        </Button>
      </Tip>
      <Tip label="Vừa khung">
        <Button size="icon" className="shadow-sm" aria-label="Vừa khung" onClick={onFit}>
          <Maximize2 className="h-4 w-4" />
        </Button>
      </Tip>
      <Tip label="Thu nhỏ">
        <Button size="icon" className="shadow-sm" aria-label="Thu nhỏ" onClick={() => onZoom(0.85)}>
          <Minus className="h-4 w-4" />
        </Button>
      </Tip>
      <Tip label="Phóng to">
        <Button size="icon" className="shadow-sm" aria-label="Phóng to" onClick={() => onZoom(1.18)}>
          <Plus className="h-4 w-4" />
        </Button>
      </Tip>
    </div>
  );
}

/**
 * Dải kế hoạch, LUÔN THẤY khi có việc đang chạy.
 *
 * Checklist chống hoang mang (`SPEC-ui.md` §6) đòi trả lời được "đang ở bước mấy"
 * mà không cần click. Nhét kế hoạch vào một panel đóng/mở là vi phạm đúng điều đó —
 * nên nó nằm đè lên canvas, mỏng, và bấm vào thì mở nhật ký của chính việc đó.
 */
function PlanStrip() {
  const plan = useApp((s) => s.plan);
  const officeState = useApp((s) => s.officeState);
  if (!plan) return null;

  const done = plan.steps.filter((s) => s.status === 'done').length;

  return (
    <button
      className="absolute bottom-3 left-1/2 z-10 flex max-w-[min(46rem,90%)] -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-panel/95 px-3.5 py-2 text-left shadow-lg backdrop-blur transition-colors hover:border-accent"
      onClick={() => actions.openPanel('plans')}
    >
      <span className="text-xs tabular-nums text-muted">
        {done}/{plan.steps.length}
      </span>
      <span className="flex items-center gap-1.5">
        {plan.steps.map((s, i) => (
          <span
            key={i}
            title={s.title}
            className={`h-1.5 w-6 rounded-full ${
              s.status === 'done'
                ? 'bg-ok'
                : s.status === 'running'
                  ? 'bg-accent soft-pulse'
                  : s.status === 'problem'
                    ? 'bg-danger'
                    : 'bg-line'
            }`}
          />
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
        {plan.steps.find((s) => s.status === 'running')?.title ??
          (officeState === 'working' ? 'đang chạy…' : plan.request)}
      </span>
    </button>
  );
}

function NoAgentsHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto max-w-sm rounded-xl border border-line bg-panel/95 px-5 py-4 text-center shadow-lg backdrop-blur">
        <div className="text-sm font-medium text-ink">Văn phòng này chưa có nhân viên</div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Trợ lý không tự làm việc — nó chia việc cho người khác. Thêm người đầu tiên bằng nút{' '}
          <b>Nhân viên</b> ở góc trên bên trái.
        </p>
      </div>
    </div>
  );
}

function Hint() {
  const canvas = useApp((s) => s.canvas);
  const plan = useApp((s) => s.plan);
  const hasAgents = (canvas?.nodes.filter((n) => n.kind === 'agent').length ?? 0) > 0;
  // Dải kế hoạch chiếm đúng chỗ này và quan trọng hơn nhiều. Gợi ý dành cho
  // người mới, không dành cho lúc đang có việc chạy.
  if (!hasAgents || plan) return null;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg border border-line bg-panel/90 px-2.5 py-1.5 text-xs text-muted backdrop-blur">
      Kéo node để sắp xếp · Kết nối Trợ lý và nhân viên để giao quyền
    </div>
  );
}

/**
 * Lỗi thoáng qua. Không chặn gì, tự tắt — nhưng không bao giờ im lặng nuốt lỗi.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LỖI PHẢI TRÔNG NHƯ LỖI.                                                  │
 * │                                                                          │
 * │ Bản trước dùng nền `bg-panel` — y hệt mọi bảng khác — và chỉ đổi màu một │
 * │ cái icon 16px. Người dùng bấm "Thêm nhân viên", tên trùng, toast hiện    │
 * │ lên trông như một thông báo bình thường, và họ đứng khựng vì tưởng app   │
 * │ đơ chứ không đọc ra rằng vừa có lỗi.                                     │
 * │                                                                          │
 * │ Tiêu chí "Xử lý lỗi tốt" đòi mọi lỗi nói được CHUYỆN GÌ XẢY RA — mà      │
 * │ bước đầu tiên của việc đó là nhìn vào phải biết ngay đây là lỗi.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function Toast() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;
  const bad = toast.kind === 'error';
  return (
    <div
      role={bad ? 'alert' : 'status'}
      aria-live={bad ? 'assertive' : 'polite'}
      className={`fixed bottom-4 right-4 z-50 flex max-w-md items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-xl ${
        bad ? 'border-danger bg-danger-soft' : 'border-line bg-panel'
      }`}
    >
      <AlertTriangle className={`mt-0.5 h-4 w-4 flex-none ${bad ? 'text-danger' : 'text-muted'}`} />
      <span className="text-[13px] leading-snug text-ink">{toast.text}</span>
      <button
        className="mt-0.5 flex-none text-muted hover:text-ink"
        aria-label="Đóng thông báo"
        onClick={actions.dismissToast}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
