import { useEffect, useRef, useState } from 'react';
import { Home, Network, Pencil, Plus, Power, Square, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, Tip } from '@/components/ui/misc';
import { actions, useApp } from '@/lib/store';
import { plural, t, type MessageKey } from '@i18n';
import { formatDate, formatTime, formatUSD, formatWeekday } from '@i18n/fmt';
import { api } from '@/lib/api';
import { NPM_UPDATE_COMMAND, WEBSITE_URL, type UpdateView } from '@core/update-links';

/**
 * ⚠ These tables hold MESSAGE KEYS, not text. They are module-level, so a
 * resolved string would freeze at import time and the header would keep the
 * language the page loaded with. Resolved at render, below.
 */
const STATE_LABEL: Record<string, MessageKey> = {
  idle: 'header.state.idle',
  working: 'header.state.working',
  paused: 'header.state.paused',
  stopped: 'header.state.stopped',
};

const STATE_DOT: Record<string, string> = {
  idle: 'bg-ok',
  working: 'bg-accent soft-pulse',
  paused: 'bg-warn',
  stopped: 'bg-muted',
};

/**
 * Labels for the two windows. ONLY TWO — not split by model. (user, 22/08)
 *
 * The server does return `seven_day_opus` / `seven_day_sonnet` and a run of
 * internal code-name buckets, but the limit belongs to the whole ACCOUNT: the
 * user may have spent most of it on something unrelated to this company. This
 * chip answers exactly one question — *"can I still run, and until when"*. Every
 * other number invites them to chase something they cannot fix.
 */
const WINDOW_LABEL: Record<string, MessageKey> = {
  session: 'header.window.session',
  weekly: 'header.window.weekly',
};

const ENERGY_WORD: Record<string, MessageKey> = {
  allowed: 'header.energy.allowed',
  allowed_warning: 'header.energy.allowed_warning',
  rejected: 'header.energy.rejected',
};

/** Key lookup with the raw server value as the fallback — never a blank cell. */
const say = (table: Record<string, MessageKey>, code: string): string => {
  const key = table[code];
  return key ? t(key) : code;
};

/**
 * Three colour sets, each a GRADIENT rather than one flat colour.
 *
 * `[dim, mid, hot]` — shared by the bar's fill AND the bolt, so the two are
 * always in the same key. That is why this table holds real colour values and
 * not Tailwind class names: an SVG `<linearGradient>` needs colour values and
 * takes no classes.
 *
 * Teal for the normal state: it does NOT collide with `accent` (the action
 * colour, used for buttons and wires), so this bar is never misread as "there is
 * something clickable here". Amber and red borrow the warning semantics we
 * already have.
 */
const RAMP: Record<string, [string, string, string]> = {
  allowed: ['#0e7490', '#06b6d4', '#5eead4'],
  allowed_warning: ['#b45309', '#f59e0b', '#fcd34d'],
  rejected: ['#9f1239', '#e11d48', '#fb7185'],
};

/**
 * The gloss laid over the bar. Strong white at the top edge, fading out, then
 * lifting again at the bottom — the way light settles on a horizontal glass tube.
 *
 * It lives in its OWN layer above the colour gradient rather than being mixed
 * into it: mixed, every change of hue means recomputing the highlights; kept
 * separate, one gloss serves all three states.
 */
const GLOSS =
  'linear-gradient(180deg,rgba(255,255,255,.55) 0%,rgba(255,255,255,.12) 45%,' +
  'rgba(255,255,255,0) 70%,rgba(255,255,255,.22) 100%)';

const fill = (s: string): string => {
  const [dim, mid, hot] = RAMP[s] ?? RAMP['allowed']!;
  return `linear-gradient(90deg,${dim} 0%,${mid} 58%,${hot} 100%)`;
};

/**
 * The bolt is hand-drawn SVG rather than a borrowed icon.
 *
 * The reason is a real constraint, not taste: library icons paint with
 * `currentColor`, i.e. ONE colour — while what is needed here is **exactly the
 * gradient running along the bar**. An inline `<linearGradient>` lets the bolt
 * and the bar share one ramp, so when the limit turns amber and then red, both
 * turn together, never a beat apart.
 *
 * The `id` must be UNIQUE across the page: SVG gradients live in the document's
 * global namespace, and two with the same id means the later one wins.
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
 * THE CLAUDE ACCOUNT LIMIT. → src/core/energy.ts
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS NOT THE COMPANY'S LIMIT — AND THE WORDS MUST SAY SO.              │
 * │                                                                           │
 * │ It is the Claude account's quota, shared with the user's own Claude Code  │
 * │ and claude.ai. Someone who sees "close to the limit" right next to this   │
 * │ office's cost figure will be certain agentco just spent it all — when     │
 * │ they may have been coding all morning in another window. The tooltip      │
 * │ spells it out.                                                            │
 * │                                                                           │
 * │ ⚠ DO NOT DRAW A BAR WITH NO NUMBER. Measured 22/08: the server sends      │
 * │ `status` and `resetsAt` but NOT `utilization` — and `utilization` is the  │
 * │ only thing a bar can be drawn from. An empty bar, or worse a 0% bar, is   │
 * │ a lie about something we do not know; "plenty left · resets 21:30" is     │
 * │ true to the word. The `<Bar>` branch below is already in place and comes  │
 * │ alive by itself the day the server starts sending numbers — nothing to    │
 * │ change.                                                                   │
 * │                                                                           │
 * │ A user on an API key has no plan limit, the event never arrives, and      │
 * │ this chip disappears entirely. That is the RIGHT behaviour, not an empty  │
 * │ state to be filled.                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function EnergyChip() {
  const energy = useApp((s) => s.energy);
  // No number yet (still asking, or running on an API key so there is no plan
  // limit) → stay silent. An empty box waiting for data is worse than no box.
  if (!energy || energy.windows.length === 0) return null;

  /**
   * The bolt takes the colour of the TIGHTEST window, not the first one.
   *
   * It is the only thing visible at a glance without reading the numbers — so it
   * has to speak about whatever is about to block you. A green bolt above a bar
   * that has already gone red is false reassurance.
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
        (energy.plan ? t('header.energyTipPlan', { plan: energy.plan }) : t('header.energyTip')) +
        energy.windows
          .map(
            (w) =>
              `${say(WINDOW_LABEL, w.kind)}: ` +
              (w.utilization === null
                ? say(ENERGY_WORD, w.status)
                : t('header.energyUsed', { pct: Math.round(w.utilization) })) +
              (w.resetsAt ? t('header.energyResets', { when: resetLabel(w.resetsAt, true) }) : ''),
          )
          .join(' · ')
      }
    >
      {/*
        ONE TAG, two rows inside it.

        Its own border and background so it separates from the header into a
        block readable at a glance — instead of two lines of text floating next
        to the cost figure, which the eye would group with it. They are NOT one
        group: one is this office's money, the other is the whole account's limit.

        Two bars STACKED, not reduced to one: "the session is nearly gone but the
        week has plenty" is a completely different decision from "both are dry".
        Hiding one in the tooltip makes the user hover every time they need to
        decide.
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
              {/* LEFT-ALIGNED: two labels of different lengths ("Session"/"Week")
                  right-aligned would make the text edge jump, while left-aligned
                  gives both rows the same starting mark — the eye reads down a
                  straight line. */}
              <span className="w-8 font-medium text-ink">{say(WINDOW_LABEL, w.kind)}</span>
              {w.utilization === null ? (
                /* No % yet, so say it in words. A 0% bar lies about what we do not know. */
                <span className="w-[136px] text-muted">{say(ENERGY_WORD, w.status)}</span>
              ) : (
                <>
                  {/* The trough: long (112px) and THIN (4px). Long, so 3% and 8%
                      are visibly different; thin, so two stacked bars still breathe. */}
                  <span className="h-1 w-28 overflow-hidden rounded-full bg-line">
                    <span
                      className="relative block h-full rounded-full"
                      style={{
                        // A 3% floor so 1% still shows a sliver — 0px looks exactly
                        // like "no data", the very thing the branch above avoids.
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
 * The reset mark. Today, the time alone; another day, the weekday with it.
 *
 * People read this number to decide "wait or keep going", and "21:30" answers
 * that, while "2 hours 47 minutes left" makes them add it to the clock
 * themselves — and it would have to count down, i.e. a `setInterval` for a
 * sentence nobody needed.
 */
function resetLabel(iso: string, long = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const hm = formatTime(d);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const short = sameDay ? hm : `${formatWeekday(d)} ${hm}`;
  // The tooltip has room for the full date; in the header, "Wed 10:59" is enough.
  return long && !sameDay ? `${formatWeekday(d)} ${formatDate(d)} ${hm}` : short;
}

/**
 * Diagram ⇄ room. → docs/SPEC-office-animation.md §11a
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NOT RENDERED AT ALL when `ui.office_view` is off — no greyed-out button.  │
 * │ A control that exists and never works is worse than no control: somebody  │
 * │ will click it, get nothing, and conclude the app is broken rather than    │
 * │ that a feature is switched off. §11c①                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Which view is open is remembered per BROWSER, not per company — two tabs on
 * two views is legal. Whether the door exists at all is the company's call.
 */
function ViewSwitch() {
  const view = useApp((s) => s.view);
  const enabled = useApp((s) => s.company?.officeView !== false);
  if (!enabled) return null;

  return (
    <div className="flex items-center rounded-lg border border-line p-0.5" role="group" aria-label={t('office.viewRoom')}>
      {(['diagram', 'office'] as const).map((v) => {
        const on = view === v;
        const label = v === 'diagram' ? t('office.viewDiagram') : t('office.viewRoom');
        return (
          <Tip key={v} label={v === 'diagram' ? t('office.viewDiagramTip') : t('office.viewRoomTip')}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => actions.setView(v)}
              className={`flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[13px] transition-colors ${
                on ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
              }`}
            >
              {v === 'diagram' ? <Network className="h-3.5 w-3.5" /> : <Home className="h-3.5 w-3.5" />}
              {label}
            </button>
          </Tip>
        );
      })}
    </div>
  );
}

/**
 * THE COMPANY'S NAME — double-click, type, Enter. → docs/SPEC-ui.md §0
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NO PENCIL BUTTON. (user, 10/09)                                          │
 * │                                                                          │
 * │ The office picker beside this one HAS a pencil, and that is right for it: │
 * │ renaming an office can move a directory and change its id, so it is a     │
 * │ deliberate act that deserves a dialog. The company name moves not one     │
 * │ byte (`Company.updateName`), so it can be edited where it is written —    │
 * │ and a second pencil two centimetres from the first would only make        │
 * │ people wonder which of the two names they are about to change.            │
 * │                                                                          │
 * │ ⚠ DOUBLE-CLICK NEEDS A SECOND DOOR, and `title` is not it — a tooltip     │
 * │ says nothing to somebody navigating by keyboard, and a plain `<h1>` is    │
 * │ not even reachable by Tab. So the title is focusable and Enter opens the  │
 * │ editor too. That is the whole cost of not shipping a button: two          │
 * │ attributes and one key case.                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `Escape` cancels and `blur` saves — deliberately opposite, and both are the
 * common reading: Escape is the universal "forget it", while clicking away from
 * a box you have typed in means you are done with it, not that you changed your
 * mind. Losing what someone typed because they clicked the canvas is the
 * project's worst class of bug (→ `AppState.draft`).
 */
function CompanyName() {
  // ?? 'AgentCo' only covers the beat BEFORE `/api/company` lands. The server
  // never sends an empty name: it substitutes `t('company.unnamed')` itself.
  const name = useApp((s) => s.company?.name ?? 'AgentCo');
  const [editing, setEditing] = useState(false);
  /**
   * ⚠ Guards against SAVING TWICE. Enter commits and then blurs the input,
   * and `onBlur` would commit the same string a second time — one wasted PATCH,
   * and a race in which the second answer overwrites the first.
   */
  const done = useRef(false);

  if (!editing) {
    return (
      <h1
        className="cursor-text rounded px-1 text-[15px] font-semibold hover:bg-accent-soft/50"
        // Focusable, but NOT `role="button"`: it is still the page's heading,
        // and relabelling it as a button to advertise one shortcut would cost a
        // screen reader the landmark it uses to find the top of the app.
        tabIndex={0}
        title={t('header.companyRenameTip')}
        aria-label={t('header.companyRenameTip')}
        onDoubleClick={() => {
          done.current = false;
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          done.current = false;
          setEditing(true);
        }}
      >
        {name}
      </h1>
    );
  }

  const commit = (next: string): void => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    // Nothing changed ⇒ no request. Renaming to the same string is the most
    // common way this box is closed, and it should cost nothing.
    if (next.trim() === name.trim()) return;
    void actions.renameCompany(next);
  };

  return (
    <input
      autoFocus
      defaultValue={name}
      maxLength={80}
      aria-label={t('header.companyRenameTip')}
      className="h-7 w-48 rounded-lg border border-line bg-paper px-2 text-[15px] font-semibold text-ink"
      // Select the lot: the usual reason for opening this is replacing the
      // default label outright, not appending to it.
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          /**
           * ⚠ AND IT MUST NOT REACH THE WINDOW. `App` listens for Escape on
           * `window` and STOPS THE RUNNING WORK with it — deliberately, it is
           * the reflex a Claude Code user brings with them. Here Escape means
           * "forget this rename", so without this line, cancelling a typo
           * while the company is working would kill the job as well.
           */
          e.stopPropagation();
          // Mark it done BEFORE closing, or the blur that follows saves the
          // very edit this key just threw away.
          done.current = true;
          setEditing(false);
        }
      }}
      onBlur={(e) => commit(e.currentTarget.value)}
    />
  );
}

/**
 * "Version X is available". → docs/SPEC-packaging.md §3.6 · core/update-check.ts
 *
 * 🔴 THE LINK AND THE COMMAND COME FROM `@core/update-links`, compiled in —
 * `/api/update` contributes a version number and nothing else. A forged
 * manifest can therefore make this line show a wrong number; it cannot make it
 * point anywhere.
 *
 * ⚠ Dismissal is PER VERSION: hiding 0.1.3 does not hide 0.1.4. Stored in the
 * browser, wrapped, because a private window throws on `localStorage`.
 *
 * ⚠ TWO STATES, ONE FETCH (16/09/2026). With something newer to announce this
 * is a banner; otherwise it is a quiet `v0.1.2` chip, because the interface
 * used to name every version except the one you were running. Silent only when
 * the daemon did not answer at all — this line is a courtesy, never an error
 * state.
 */
const UPDATE_DISMISSED_KEY = 'agentco:update-dismissed';

function UpdateNotice() {
  const [view, setView] = useState<UpdateView | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(UPDATE_DISMISSED_KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let alive = true;
    const load = (): void => {
      api
        .update()
        .then((v) => {
          if (alive) setView(v);
        })
        .catch(() => {
          /* no answer is no banner */
        });
    };
    load();
    // The daemon refreshes its cache on its own schedule; this only re-reads it.
    const timer = setInterval(load, 60 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // No answer from the daemon ⇒ say nothing. An empty space is honest here; a
  // "version unknown" chip would be a second thing to explain to support.
  if (!view) return null;

  /**
   * ⚠ DISMISSING THE BANNER FALLS BACK TO THE CHIP, it does not clear the line.
   * Hiding "0.1.4 is available" is a statement about the nagging, not about
   * wanting to stop knowing which version is running — and the version is the
   * half that gets asked for later.
   */
  if (!view.available || !view.latest || dismissed === view.latest) {
    return (
      <Tip
        label={t(view.kind === 'packaged' ? 'header.versionPackaged' : 'header.versionNpm', {
          version: view.current,
        })}
      >
        {/* `text-muted`, the dimmest token this palette HAS — there is no
            `faint` here, and a class Tailwind does not know is silently
            nothing rather than an error. → docs/SPEC-ui.md */}
        <span className="cursor-default text-[12.5px] tabular-nums text-muted">
          {t('header.versionChip', { version: view.current })}
        </span>
      </Tip>
    );
  }

  const latest = view.latest;

  return (
    <span className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-[12.5px]">
      <span>{t('header.update.available', { version: latest })}</span>
      {view.kind === 'packaged' ? (
        <a href={WEBSITE_URL} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
          {t('header.update.download')}
        </a>
      ) : (
        <code className="select-all rounded bg-black/20 px-1.5 font-mono text-[12px]">{NPM_UPDATE_COMMAND}</code>
      )}
      <Tip label={t('header.update.dismiss')}>
        <button
          type="button"
          aria-label={t('header.update.dismiss')}
          className="text-muted hover:text-ink"
          onClick={() => {
            try {
              localStorage.setItem(UPDATE_DISMISSED_KEY, latest);
            } catch {
              /* storage blocked — it stays hidden for this page only */
            }
            setDismissed(latest);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </Tip>
    </span>
  );
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
      <CompanyName />

      {company && company.offices.length > 0 && (
        <Select
          aria-label={t('header.office')}
          value={officeId ?? ''}
          onChange={(e) => void actions.openOffice(e.target.value)}
          className="max-w-56"
        >
          {/* Archived offices do NOT belong here — this control picks where to
              work, and an archived place cannot be worked in. They live in the
              Overview panel with a Restore button. The exception: if the one
              currently open is the one just archived, it still has to show, or
              the select goes blank. */}
          {company.offices
            .filter((o) => !o.archived || o.id === officeId)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.avatar} {o.name}
                {o.archived ? t('header.archivedSuffix') : ''}
                {o.error ? ' ⚠' : ''}
              </option>
            ))}
        </Select>
      )}

      {officeId && (
        <Tip label={t('header.renameTip')}>
          <Button size="iconSm" variant="ghost" aria-label={t('header.rename')} onClick={onRenameOffice}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </Tip>
      )}

      {officeId && <ViewSwitch />}

      {officeId && (
        <span className="flex items-center gap-2 text-[13px] text-muted">
          <span className={`h-[7px] w-[7px] rounded-full ${STATE_DOT[officeState] ?? 'bg-muted'}`} />
          {say(STATE_LABEL, officeState)}
        </span>
      )}

      <div className="flex-1" />

      <UpdateNotice />

      <EnergyChip />

      {cost && (
        <span className="text-[13px] tabular-nums text-muted">
          {plural('header.taskCount', cost.tasks)} · {plural('header.turnCount', cost.turns)} ·{' '}
          {formatUSD(cost.costUSD)}
        </span>
      )}

      <Tip label={t('header.newOfficeTip')}>
        <Button size="sm" onClick={onNewOffice}>
          <Plus className="h-4 w-4" />
          {t('header.newOffice')}
        </Button>
      </Tip>

      <Tip label={t('header.stopTip')}>
        <Button
          size="sm"
          variant="danger"
          disabled={officeState !== 'working'}
          onClick={() => void actions.stop()}
        >
          <Square className="h-3.5 w-3.5" />
          {t('header.stop')}
        </Button>
      </Tip>

      <Tip label={t('header.shutdown')}>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('header.shutdown')}
          onClick={() => {
            // The confirm stays a NATIVE dialog: it is the one action on this
            // screen that ends the session, and the browser's own box cannot be
            // missed, cannot be styled away and cannot fail to render.
            const ok = window.confirm(t('header.shutdownConfirm'));
            // Through `actions`, not straight to `api`: the store has to raise
            // `poweredOff` BEFORE the request, or the dying SSE stream paints an
            // error screen over the shutdown the user just asked for.
            // → `actions.shutdown`
            if (ok) void actions.shutdown();
          }}
        >
          <Power className="h-4 w-4" />
        </Button>
      </Tip>
    </header>
  );
}
