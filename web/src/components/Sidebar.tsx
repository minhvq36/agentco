import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Building2,
  ChevronsLeftRight,
  FileCheck2,
  FolderOpen,
  MessageSquare,
  ScrollText,
  Settings,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/misc';
import { actions, useApp, type PanelId } from '@/lib/store';
import { t, type MessageKey } from '@i18n';
import { ChatPanel } from './panels/ChatPanel';
import { PlansPanel } from './panels/PlansPanel';
import { OverviewPanel } from './panels/OverviewPanel';
import { KnowledgePanel } from './panels/KnowledgePanel';
import { LibraryPanel } from './panels/LibraryPanel';
import { ArtifactsPanel } from './panels/ArtifactsPanel';
import { SettingsPanel } from './panels/SettingsPanel';

/**
 * THE THREE STORES SIT TOGETHER, and the order is deliberate.
 *
 * They are the three most confusable concepts in the product, separated by
 * exactly one question: WHO PUT THE FILE THERE?
 *
 *   Documents   THE USER put it there    → add/delete, never edit
 *   Results     AN EMPLOYEE made it      → delete only, never add, never edit
 *   Knowledge   AN AGENT derived it      → edit/delete, never add
 *
 * Side by side that difference reads at a glance; spread across three places it
 * has to be memorised. "Results" sits in the MIDDLE because it is the only one
 * with both ends: employees read documents above it, and what they learn becomes
 * knowledge below it.
 * → docs/SPEC-library.md §1 · docs/SPEC-artifacts.md
 *
 * ⚠ `label` is a MESSAGE KEY, not a string. This table is module-level, so a
 * resolved string here would be frozen at import time and every tab would keep
 * the language the page loaded with. The key is resolved at render instead.
 */
const TABS: Array<{ id: PanelId; icon: LucideIcon; label: MessageKey }> = [
  { id: 'chat', icon: MessageSquare, label: 'sidebar.chat' },
  { id: 'plans', icon: ScrollText, label: 'sidebar.plans' },
  { id: 'overview', icon: Building2, label: 'sidebar.overview' },
  { id: 'library', icon: FolderOpen, label: 'sidebar.library' },
  { id: 'artifacts', icon: FileCheck2, label: 'sidebar.artifacts' },
  { id: 'knowledge', icon: BookOpen, label: 'sidebar.knowledge' },
  { id: 'settings', icon: Settings, label: 'sidebar.settings' },
];

const MIN_W = 300;
const WIDE_W = 720;
const STORAGE_KEY = 'agentco.panelWidth';

/** Capped by the window: the canvas needs room to show a diagram, not a slit. */
function maxWidth(): number {
  return Math.max(MIN_W, Math.min(WIDE_W + 240, window.innerWidth - 420));
}

function clampWidth(w: number): number {
  return Math.round(Math.max(MIN_W, Math.min(w, maxWidth())));
}

/**
 * The left sidebar. → docs/SPEC-ui.md §0
 *
 * v0 had a bottom dock that PERMANENTLY held space for chat and the plan —
 * things people need only now and then. Here: the icon rail is always visible,
 * the panel opens on click and closes again, giving the whole screen to the
 * canvas.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THE PANEL IS RESIZABLE                                               │
 * │                                                                          │
 * │ 336px is enough for a line of chat and not enough for what the assistant │
 * │ actually returns: command lists, multi-step plans, reports. That content │
 * │ does not shrink — it only wraps worse. So the width has to be theirs.    │
 * │                                                                          │
 * │ The width WHILE DRAGGING goes straight into the DOM through a ref, the   │
 * │ same as node coordinates on the canvas. One `setState` per drag frame is │
 * │ re-rendering the whole React tree 60 times a second while SSE is still   │
 * │ firing events into it — precisely what the "performance" criterion       │
 * │ forbids. React only learns the new width ON MOUSE RELEASE.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function Sidebar() {
  const panel = useApp((s) => s.panel);
  const unread = useApp((s) => s.messages.length - s.seenMessages);
  const working = useApp((s) => s.officeState === 'working');
  /**
   * A newer version exists and nobody has looked yet.
   *
   * ⚠ IT FOLLOWS THE `chat` DOT, NOT THE `plans` ONE, and the two differ in
   * what they are: `working` is a live fact that returns the moment it is true
   * again; `unread` is something you can have SEEN. A waiting version is the
   * second kind — opening Settings settles it for this session, closing the
   * panel does not un-settle it, and a reload brings it back because the
   * version is still waiting. → `store.ts §seenUpdate`
   */
  const newVersion = useApp((s) => s.updateAvailable && !s.seenUpdate);
  /**
   * NO OFFICES ⇒ only the COMPANY-level drawer remains. (bug 02/09)
   *
   * The other five drawers describe an open office, so they are meaningless
   * here. But "Company overview" describes the company — spending, connections
   * and workspaces are all company-level data, and THEY OUTLIVE THE LAST OFFICE.
   * Hiding this drawer too locks people out of their own shared ledger: delete
   * every office and the Notion/Linear/GitHub connections have no door left to
   * clean them up through.
   */
  const noOffices = useApp((s) => (s.company?.offices.length ?? 0) === 0);
  /**
   * Settings survives the no-offices state alongside Overview, and for the same
   * reason: it is COMPANY-level. A fresh install lands here with nothing built
   * yet, and the language of the interface is exactly the thing someone wants
   * to fix before they start naming their first office in it.
   */
  const tabs = noOffices ? TABS.filter((tab) => tab.id === 'overview' || tab.id === 'settings') : TABS;
  const active = tabs.find((tab) => tab.id === panel);

  const paneRef = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : 336;
  });

  // Shrinking the window can leave the panel wider than the screen. Clamp it, or
  // the canvas disappears entirely with no way back except clearing localStorage.
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

    // `setPointerCapture` on the handle itself: a fast pointer leaving the
    // element does not break the drag, and no `window`-level listener is needed.
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      next = clampWidth(startW + (ev.clientX - startX));
      pane.style.width = `${next}px`;
      // The room's pan follows the handle, through the DOM. Routing this through
      // `setState` is the one thing this whole drag path exists to avoid.
      if (document.documentElement.style.getPropertyValue('--sidebar-w') !== '0px') {
        document.documentElement.style.setProperty('--sidebar-w', `${next}px`);
      }
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

  /**
   * IN THE OFFICE VIEW THE PANEL OVERLAYS INSTEAD OF PUSHING.
   * → docs/SPEC-office-animation.md §11b
   *
   * On the diagram, pushing is right: it is a workspace you arrange, and a panel
   * covering the node you are dragging is worse than a narrower canvas. The room
   * is a fixed-aspect scene fitted to its frame, so narrowing it RE-FITS THE
   * WHOLE ROOM — every person and every piece of furniture slides and shrinks
   * because a panel opened. That is the same failure class as a layout that
   * makes people resize the window to read it (SPEC-ui §3.1).
   *
   * No scrim: a scrim says "modal", and the room has to stay watchable while
   * somebody reads the chat beside it.
   */
  const overlay = useApp((s) => s.view === 'office' && !!s.officeId);

  /**
   * The scene reads this to PAN rather than re-fit — one transform on the
   * compositor, nothing re-laid-out. Written to the DOM rather than passed
   * through React because the drag handle changes it 60 times a second, and the
   * width during a drag is exactly what must not go through `setState`.
   */
  useEffect(() => {
    const px = overlay && active ? `${width}px` : '0px';
    document.documentElement.style.setProperty('--sidebar-w', px);
    return () => document.documentElement.style.setProperty('--sidebar-w', '0px');
  }, [overlay, active, width]);

  return (
    <div className={`flex flex-none border-r border-line bg-panel ${overlay ? 'relative z-30' : ''}`}>
      <nav
        className={`flex w-14 flex-none flex-col items-center gap-1 border-r border-line py-2 ${
          overlay ? 'bg-panel' : ''
        }`}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const on = panel === tab.id;
          const label = t(tab.label);
          return (
            /* `side="right"`: this rail is VERTICAL, so the default tooltip
               (`top`) lands right on the button above. → the note on `Tip` */
            <Tip key={tab.id} label={label} side="right">
              <Button
                size="icon"
                variant="ghost"
                aria-label={label}
                aria-pressed={on}
                className={on ? 'bg-accent-soft text-accent' : ''}
                onClick={() => actions.openPanel(tab.id)}
              >
                <span className="relative">
                  <Icon className="h-[18px] w-[18px]" />
                  {tab.id === 'chat' && unread > 0 && !on && (
                    <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                  {tab.id === 'plans' && working && !on && (
                    <span className="soft-pulse absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                  {/*
                    ⚠ NOT `soft-pulse`. Pulsing is what `plans` uses to say
                    "happening right now"; a version sitting on a server is a
                    standing fact, and borrowing the urgent animation for it
                    teaches people to read both of them wrong.
                  */}
                  {tab.id === 'settings' && newVersion && !on && (
                    <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-accent" />
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
          className={
            overlay
              ? 'absolute left-14 top-0 z-30 flex h-full flex-col border-r border-line bg-panel shadow-2xl'
              : 'relative flex flex-none flex-col'
          }
          style={{ width }}
          aria-label={t(active.label)}
        >
          <div className="flex flex-none items-center gap-2 border-b border-line px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
              {t(active.label)}
            </span>
            <div className="flex-1" />
            <Tip label={wide ? t('sidebar.narrowHint') : t('sidebar.widenHint')}>
              <Button
                size="iconSm"
                variant="ghost"
                aria-label={wide ? t('sidebar.narrow') : t('sidebar.widen')}
                onClick={() => applyWidth(wide ? 336 : WIDE_W)}
              >
                <ChevronsLeftRight className="h-4 w-4" />
              </Button>
            </Tip>
            <Button
              size="iconSm"
              variant="ghost"
              aria-label={t('sidebar.closePanel')}
              onClick={() => actions.openPanel(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {/* overflow-hidden: each panel handles its own scrolling. Wrapping
              another scroll layer here produces two nested scrollbars. */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {panel === 'chat' && <ChatPanel />}
            {panel === 'plans' && <PlansPanel />}
            {panel === 'overview' && <OverviewPanel />}
            {panel === 'library' && <LibraryPanel />}
            {panel === 'artifacts' && <ArtifactsPanel />}
            {panel === 'knowledge' && <KnowledgePanel />}
            {panel === 'settings' && <SettingsPanel />}
          </div>

          {/* The drag handle. A 7px hit area, but the line only shows on hover —
              a solid rule running the full height of the screen is visual noise. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('sidebar.resizeHandle')}
            title={t('sidebar.resizeHint')}
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
