import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Cable,
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
import { ArmDialog } from '@/components/ArmDialog';
import {
  NewAgentDialog,
  NewOfficeDialog,
  PromptDialog,
  RenameOfficeDialog,
} from '@/components/dialogs';
import { actions, connectEvents, getState, markLocalSave, useApp } from '@/lib/store';
import type { CanvasEdge, CanvasNode } from '@/lib/types';
import { t } from '@i18n';

import '@/canvas/canvas.css';

/**
 * THE ROOM IS A SEPARATE CHUNK, AND THAT IS WHAT "OFF" MEANS.
 * → docs/SPEC-office-animation.md §11c②
 *
 * With `ui.office_view: false` the switch never renders, so this `import()`
 * never runs and the bytes never reach the browser. For a local web app that is
 * what "not installed" is — anything less would be a hidden button rather than
 * an off switch, and leg G-10 of test 23 measures exactly that.
 */
const Office = lazy(() => import('@/office/Office'));

export default function App() {
  /**
   * `key={locale}` REMOUNTS THE TREE when the interface language changes.
   *
   * Blunt on purpose. `t()` reads a module-level locale, not React state, so a
   * language change is invisible to React: a memoised component, or a label
   * pulled from a module-level table, keeps whatever it rendered first. Chasing
   * that by threading the locale into every component is a lot of wiring to buy
   * a guarantee this one line already gives.
   *
   * The cost is losing local state — an open dialog, a scroll position. That is
   * acceptable HERE and nowhere else, because this is the one setting a person
   * changes deliberately, roughly once, and then never again. The chat draft
   * survives regardless: it lives in the store, not in a component.
   */
  const locale = useApp((s) => s.locale);
  const loading = useApp((s) => s.loading);
  const poweredOff = useApp((s) => s.poweredOff);
  const fatal = useApp((s) => s.fatal);
  const company = useApp((s) => s.company);
  const canvas = useApp((s) => s.canvas);
  const live = useApp((s) => s.live);
  const selected = useApp((s) => s.selected);
  /**
   * Two conditions, and both are needed: the company allows the room at all,
   * and this browser is currently looking at it. The first is a door that may
   * not exist; the second is which door this tab walked through.
   */
  const room = useApp((s) => s.view === 'office' && s.company?.officeView !== false);

  const [newOffice, setNewOffice] = useState(false);
  const [renameOffice, setRenameOffice] = useState(false);
  const [newAgent, setNewAgent] = useState(false);
  const [newArm, setNewArm] = useState(false);
  const [promptFor, setPromptFor] = useState<string | null>(null);
  const canvasRef = useRef<CanvasHandle | null>(null);

  useEffect(() => {
    void actions.boot();
    return connectEvents();
  }, []);

  /**
   * `Esc` stops the running work — the reflex of a Claude Code user. Same
   * behaviour as the `/stop` text command, so the Telegram bridge reuses it.
   * → docs/SPEC-tools-approval.md §3b
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // With a dialog open, Esc belongs to the dialog — Radix handles it; do not steal it.
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
   * Save the layout, debounced at ~700ms. Dragging a node fires dozens of events
   * per second; writing on each is pointless disk traffic. Coordinates are only
   * view state — losing one beat is fine, but the LAST beat has to land, so this
   * reschedules rather than skips.
   */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onCommit = useCallback((nodes: CanvasNode[], edges: CanvasEdge[], immediate?: boolean) => {
    clearTimeout(saveTimer.current);
    if (immediate) {
      // An edge: send IMMEDIATELY and draw optimistically. They just released the
      // mouse; the wire has to appear before the server can answer.
      markLocalSave();
      void actions.saveCanvas(nodes, edges, true);
      return;
    }
    saveTimer.current = setTimeout(() => {
      markLocalSave();
      void actions.saveCanvas(nodes, edges);
    }, 700);
  }, []);

  /**
   * THE COMPANY IS OFF. → `store.ts §AppState.poweredOff`
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ IT IS TESTED BEFORE `fatal`, AND THAT ORDER IS THE FEATURE.            │
   * │                                                                          │
   * │ Shutting down kills the SSE stream a beat later, so `fatal` fills in with │
   * │ "lost connection to the company" — an alarm with a Retry button, for      │
   * │ something the user deliberately asked for. Swap these two blocks and the  │
   * │ last thing anybody sees when they close agentco is an error screen.       │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ONE QUIET LINE, and nothing else — no icon, no button, no border. There is
   * no daemon left to serve a Retry, so every control that could be drawn here
   * would be a control that does not work. (user, 10/09)
   */
  if (poweredOff) {
    return (
      <div className="flex h-full items-center justify-center bg-paper px-6 text-center">
        <p className="text-[13px] text-muted">{t('app.poweredOff')}</p>
      </div>
    );
  }

  if (fatal) {
    return (
      <Shell>
        <Empty
          icon={<AlertTriangle className="h-8 w-8 text-danger" />}
          title={t('app.fatalTitle')}
          hint={fatal}
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              {t('common.retry')}
            </Button>
          }
        />
      </Shell>
    );
  }

  if (loading && !company) {
    return (
      <Shell>
        <div className="text-[13px] text-muted">{t('app.openingCompany')}</div>
      </Shell>
    );
  }

  const noOffices = !company || company.offices.length === 0;

  return (
    <TooltipProvider key={locale} delayDuration={400}>
      <div className="flex h-full flex-col">
        <Header onNewOffice={() => setNewOffice(true)} onRenameOffice={() => setRenameOffice(true)} />

        {noOffices ? (
          /*
            The sidebar stays. It collapses to exactly one "Company overview"
            drawer (→ `Sidebar §noOffices`), because spending · connections ·
            workspaces are COMPANY-level data and they outlive the last office.
            The previous version replaced the whole working area with an empty
            screen ⇒ all three lost their management door, and the user was stuck
            unable to unplug a connection nobody used. → bug 02/09, SPEC-arms §6k
          */
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="flex flex-1 items-center justify-center">
              {/* A DESIGNED empty state, not an error screen.
                  → docs/SPEC-offices.md §3 */}
              <Empty
                icon={<Building2 className="h-10 w-10" />}
                title={t('app.noOfficesTitle')}
                hint={t('app.noOfficesHint')}
                action={
                  <Button variant="primary" onClick={() => setNewOffice(true)}>
                    <Plus className="h-4 w-4" />
                    {t('app.newOffice')}
                  </Button>
                }
              />
            </main>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <Sidebar />

            <main className="relative min-w-0 flex-1">
              {canvas ? (
                /*
                  Only the SCENE swaps. Header, sidebar, plan strip, inspector,
                  toasts and the current selection all survive the switch — a
                  view is a different way of looking at one office, not a
                  different application. → docs/SPEC-office-animation.md §11a
                */
                room ? (
                  <>
                    <Suspense fallback={<Loading />}>
                      <Office />
                    </Suspense>
                    {/*
                      The toolbar is deliberately absent here: every button on it
                      edits or navigates the SHAPE, and the room does not have
                      one (§10).

                      🔴 AND SO IS THE PLAN STRIP, WHICH REVERSES §11a. It sits
                      at `bottom-3`, which on the canvas is empty space and in the
                      room is the FRONT ROW — it covered the people the view
                      exists to show. The room answers "who is working right now"
                      by drawing it, and the same question is still one click away
                      in the chat frame's activity line and in the Plans panel, so
                      what is lost here is a shortcut, not the only copy of a
                      fact (§13). → docs/SPEC-office-animation.md §11a
                    */}
                    {canvas.nodes.filter((n) => n.kind === 'agent').length === 0 && <RoomHint />}
                  </>
                ) : (
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
                      onAddArm={() => setNewArm(true)}
                      onAddAgent={() => setNewAgent(true)}
                      onArrange={() => canvasRef.current?.autoArrange()}
                      onFit={() => canvasRef.current?.fit()}
                      onZoom={(f) => canvasRef.current?.zoomBy(f)}
                    />
                    {canvas.nodes.filter((n) => n.kind === 'agent').length === 0 && <NoAgentsHint />}
                    <PlanStrip />
                    <Hint />
                  </>
                )
              ) : (
                <div className="flex h-full items-center justify-center text-[13px] text-muted">
                  {t('app.openingOffice')}
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
      <ArmDialog open={newArm} onOpenChange={setNewArm} />
      <PromptDialog who={promptFor} onClose={() => setPromptFor(null)} />
    </TooltipProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center">{children}</div>;
}

function Toolbar({
  onAddAgent,
  onAddArm,
  onArrange,
  onFit,
  onZoom,
}: {
  onAddAgent(): void;
  onAddArm(): void;
  onArrange(): void;
  onFit(): void;
  onZoom(f: number): void;
}) {
  const officeId = useApp((s) => s.officeId);
  if (!officeId) return null;

  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5">
      <Tip label={t('toolbar.agentTip')}>
        <Button size="sm" className="shadow-sm" onClick={onAddAgent}>
          <UserPlus className="h-4 w-4" />
          {t('toolbar.agent')}
        </Button>
      </Tip>
      {/*
        The MAIN door for plugging in an arm — next to "Employee", the same
        grammar as the one thing the user already knows how to do. Deliberately
        NOT a drag-and-drop palette: the canvas auto-arranges and has a
        "Rearrange" button, so drag-and-drop would promise a control the button
        beside it takes back. → docs/SPEC-arms.md §6e
      */}
      <Tip label={t('toolbar.armTip')}>
        <Button size="sm" className="shadow-sm" onClick={onAddArm}>
          <Cable className="h-4 w-4" />
          {t('toolbar.arm')}
        </Button>
      </Tip>
      <div className="mx-1 h-5 w-px bg-line" />
      <Tip label={t('toolbar.arrangeTip')}>
        <Button size="icon" className="shadow-sm" aria-label={t('toolbar.arrange')} onClick={onArrange}>
          <Network className="h-4 w-4" />
        </Button>
      </Tip>
      <Tip label={t('toolbar.fit')}>
        <Button size="icon" className="shadow-sm" aria-label={t('toolbar.fit')} onClick={onFit}>
          <Maximize2 className="h-4 w-4" />
        </Button>
      </Tip>
      <Tip label={t('toolbar.zoomOut')}>
        <Button size="icon" className="shadow-sm" aria-label={t('toolbar.zoomOut')} onClick={() => onZoom(0.85)}>
          <Minus className="h-4 w-4" />
        </Button>
      </Tip>
      <Tip label={t('toolbar.zoomIn')}>
        <Button size="icon" className="shadow-sm" aria-label={t('toolbar.zoomIn')} onClick={() => onZoom(1.18)}>
          <Plus className="h-4 w-4" />
        </Button>
      </Tip>
    </div>
  );
}

/**
 * The plan strip — ALWAYS VISIBLE while work is running.
 *
 * The anti-bewilderment checklist (`SPEC-ui.md` §6) requires "which step am I
 * on" to be answerable without a click. Putting the plan inside a collapsible
 * panel breaks exactly that — so it sits over the canvas, thin, and clicking it
 * opens that job's own log.
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
          (officeState === 'working' ? t('app.planRunning') : plan.request)}
      </span>
    </button>
  );
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-muted">
      {t('app.openingOffice')}
    </div>
  );
}

/**
 * The room with nobody hired yet is NOT an empty state screen — the room is
 * already there, with the assistant standing in it. This is a hint sitting on
 * top of it, pointing at the view that can actually hire somebody.
 * → docs/SPEC-office-animation.md §5a′
 */
function RoomHint() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
      <div className="rounded-lg border border-line bg-panel/90 px-3 py-2 text-[13px] text-muted shadow-sm backdrop-blur">
        {t('office.hireHint')}
      </div>
    </div>
  );
}

function NoAgentsHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto max-w-sm rounded-xl border border-line bg-panel/95 px-5 py-4 text-center shadow-lg backdrop-blur">
        <div className="text-sm font-medium text-ink">{t('app.noAgentsTitle')}</div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {t('app.noAgentsHintBefore')} <b>{t('toolbar.agent')}</b> {t('app.noAgentsHintAfter')}
        </p>
      </div>
    </div>
  );
}

function Hint() {
  const canvas = useApp((s) => s.canvas);
  const plan = useApp((s) => s.plan);
  const hasAgents = (canvas?.nodes.filter((n) => n.kind === 'agent').length ?? 0) > 0;
  // The plan strip occupies this exact spot and matters far more. The hint is
  // for newcomers, not for while work is running.
  if (!hasAgents || plan) return null;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg border border-line bg-panel/90 px-2.5 py-1.5 text-xs text-muted backdrop-blur">
      {t('app.canvasHint')}
    </div>
  );
}

/**
 * A transient error. Blocks nothing, dismisses itself — but never swallows.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ AN ERROR HAS TO LOOK LIKE AN ERROR.                                      │
 * │                                                                          │
 * │ The previous version used `bg-panel` — identical to every other panel —  │
 * │ and recoloured a single 16px icon. Someone pressed "Add employee", hit a │
 * │ duplicate name, and the toast that appeared read as an ordinary notice;  │
 * │ they froze, assuming the app had hung rather than reading that an error  │
 * │ had just occurred.                                                       │
 * │                                                                          │
 * │ The "good error handling" criterion requires every error to say WHAT     │
 * │ HAPPENED — and the first step of that is being recognisable as an error  │
 * │ at a glance.                                                             │
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
      {/*
        ⚠ `whitespace-pre-wrap`, and it is a CORRECTNESS fix rather than a
        layout one (19/09/2026). Server sentences carry real newlines — the
        no-space and no-permission refusals both end in a short list of
        commands to type — and HTML collapses those into spaces. The list
        arrived as ONE run-on line, which somebody would reasonably select and
        paste into a shell, where it is not the three commands we wrote but a
        fourth thing nobody tested. A message that cannot be copied correctly
        is worse than one that says less.

        ⚠ `break-words` because a shell line is long and has no spaces to break
        at; without it `max-w-md` is overflowed rather than wrapped.
      */}
      <span className="whitespace-pre-wrap break-words text-[13px] leading-snug text-ink">{toast.text}</span>
      <button
        className="mt-0.5 flex-none text-muted hover:text-ink"
        aria-label={t('common.dismissNotice')}
        onClick={actions.dismissToast}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

