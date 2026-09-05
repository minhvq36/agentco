import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ScrollText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { agentHue, agentInk, agentWash } from '@/lib/colors';
import { Markdown } from '@/lib/markdown';
import { labelFor, toast, useApp } from '@/lib/store';
import type { AgentEvent, PlanRecord, PlanStatus } from '@/lib/types';
import { plural, t, type MessageKey } from '@i18n';
import { formatTime, formatTimeOfDay, formatUSD } from '@i18n/fmt';

/**
 * Colour is fixed per status; the WORD is looked up per render.
 *
 * A module-level `label` would freeze whichever language the page loaded with,
 * so the table holds the KEY and the call site resolves it. Same reason
 * `cli-form.ts §hello` became a function.
 *
 * `warn` and not `danger` for `blocked`: nothing is broken, the system is
 * waiting on the person. Painting a question red teaches them to dread being
 * asked one.
 */
const STATUS: Record<PlanStatus, { key: MessageKey; cls: string }> = {
  planning: { key: 'plans.status.planning', cls: 'text-accent' },
  running: { key: 'plans.status.running', cls: 'text-accent' },
  done: { key: 'plans.status.done', cls: 'text-ok' },
  failed: { key: 'plans.status.failed', cls: 'text-danger' },
  blocked: { key: 'plans.status.blocked', cls: 'text-warn' },
  paused: { key: 'plans.status.paused', cls: 'text-warn' },
  stopped: { key: 'plans.status.stopped', cls: 'text-muted' },
};

/**
 * The log. → docs/SPEC-offices.md §6
 *
 * The log follows THE WORK, not the clock. v0 was one flat stream: unreadable
 * when two jobs overlap, and no answer to "what did yesterday's job actually
 * do". Here: a list of jobs → open one → the log for exactly that one.
 */
/**
 * Filter at the DISPLAY layer, never delete at the STORAGE layer.
 * → docs/SPEC-offices.md §6
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE USER ASKED FOR A DELETE BUTTON, THEN TALKED THEMSELVES OUT OF IT —   │
 * │ and they were right to.                                                  │
 * │                                                                          │
 * │ *"things break sometimes, the zombies are an eyesore"* → *"or maybe keep │
 * │ the log, so it can be traced, money is tied up in it too"*.              │
 * │                                                                          │
 * │ The log is the ONLY thing joining a `plan_id` in the cost ledger to a    │
 * │ readable name. Delete a row and the money stays in the ledger with       │
 * │ nobody knowing what it bought. But the irritation is real: 18 jobs, 8 of │
 * │ them not `done`.                                                         │
 * │                                                                          │
 * │ This is exactly the case rule §5e names: **separating at the DISPLAY     │
 * │ layer is cheap, separating at the STORAGE layer is expensive — when in   │
 * │ doubt, cut at the cheap one first.** One filter button buys that same    │
 * │ relief, loses 0 rows of history, and shows everything again on a click.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The default is **EVERYTHING**, not "finished only". A log that opens with the
 * broken half already hidden lies by staying quiet — the user has to CHOOSE to
 * see less.
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
  // The panel unmounts on a tab switch (`{panel === 'plans' && …}`), so this
  // choice has to live outside the component — same failure class as the chat
  // draft.
  const [onlyDone, setOnlyDone] = useState(readFilter);

  const load = useCallback(async () => {
    if (!officeId) return;
    try {
      const res = await api.plans(officeId);
      setPlans(res.plans);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('plans.loadFailed'));
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
        toast(err instanceof Error ? err.message : t('plans.openFailed'));
      }
    },
    [officeId],
  );

  if (open) {
    return <PlanDetail data={open} onBack={() => setOpen(null)} onReload={() => void openPlan(open.plan.plan_id)} />;
  }

  if (plans === null) {
    return <div className="px-4 py-6 text-[13px] text-muted">{t('common.reading')}</div>;
  }

  if (plans.length === 0) {
    return (
      <Empty
        icon={<ScrollText className="h-7 w-7" />}
        title={t('plans.emptyTitle')}
        hint={t('plans.emptyHint')}
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
      /* storage blocked ⇒ the choice lives for this session only — fine */
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/*
        The filter bar only appears when there IS something to filter. A button
        that changes nothing on screen is noise — and in a new office every job
        is `done`.
      */}
      {hidden > 0 && (
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2 text-xs text-muted">
          <span className="tabular-nums">
            {plural('plans.jobCount', plans.length)} · {t('plans.unfinished', { n: hidden })}
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={toggle}>
            {onlyDone ? t('plans.showAll') : t('plans.onlyDone')}
          </Button>
        </div>
      )}
      {/*
        The empty state of a FILTER is not the empty state of the log: here the
        data is all still there, it is just being filtered out. Say exactly that,
        with the way back — otherwise the user believes the log was just lost.
      */}
      {shown.length === 0 ? (
        <div className="px-4 py-6 text-[13px] text-muted">
          {t('plans.noneDoneBefore')} {plural('plans.jobCount', plans.length)}{' '}
          {t('plans.noneDoneAfter')}{' '}
          <button className="text-accent underline underline-offset-2" onClick={toggle}>
            {t('plans.showAllInline')}
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
                    <span className={st.cls}>{t(st.key)}</span>
                    <span>·</span>
                    <span className="tabular-nums">
                      {p.tasks_done}/{plural('plans.jobCount', p.tasks_total)}
                    </span>
                    <span>·</span>
                    <span className="tabular-nums">{formatUSD(p.costUSD)}</span>
                    <span className="flex-1" />
                    <span>{formatTime(new Date(p.started_at))}</span>
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
        <Button size="iconSm" variant="ghost" onClick={onBack} aria-label={t('plans.back')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          {/*
            The request line needs a CEILING too — the same illness as the report
            block at the bottom. `request` is the assistant's rewrite "made clear,
            with enough context", so it really is long: measured at 300+
            characters, and in a narrow sidebar that runs to 6–7 lines and shoves
            everything below it down.

            ⚠ Do NOT add an "Expand" button here: this row already has "Back" on
            the left and "Reload" on the right, and a third button makes it
            crowded enough to mis-tap. Make THE TEXT ITSELF the button — it is the
            only thing in the row that already has area, and "click the truncated
            text to see all of it" is a reflex people already have. `title` makes
            it readable on hover as well.
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
            <span className={st.cls}>{t(st.key)}</span>
            <span>·</span>
            <span className="tabular-nums">
              {plural('plans.turnCount', plan.turns)} · {formatUSD(plan.costUSD)}
            </span>
          </div>
        </div>
        {live && (
          <Button size="sm" variant="ghost" onClick={onReload}>
            {t('plans.reload')}
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
        `min-h-[8rem]` is a FLOOR, not decoration.

        This block is the only thing in the column that flexes; everything else is
        `flex-none`. Without the floor, the four rigid blocks above plus the
        report below squeeze it down to a few dozen pixels, and the user sees a
        box that "won't scroll" — it DOES scroll, the viewport is just shorter
        than one line. That is precisely the symptom reported on 21/08.
      */}
      <div className="min-h-[8rem] flex-1 overflow-y-auto px-3 py-2">
        {log.length === 0 ? (
          <div className="px-1 py-4 text-[13px] text-muted">{t('plans.noEvents')}</div>
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
 * The assistant's closing summary, at the bottom of a job's detail view.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ UX BUG 21/08 — ONE `flex-none` SWALLOWED THE WHOLE LOG.                   │
 * │                                                                           │
 * │ Before: `<div className="flex-none …">{plan.report}</div>`. In a flex     │
 * │ column, `flex-none` means *"never shrink"* — so a 30-line report takes    │
 * │ 30 lines, and the log block (the ONLY thing that flexes) is squeezed to   │
 * │ almost nothing.                                                           │
 * │                                                                           │
 * │ The user reported exactly that feeling: *"no idea what the workers are    │
 * │ saying to each other, feels like the scroll wheel does nothing — it only  │
 * │ works if I drag the panel wider"*. Wider means fewer wrapped lines ⇒ a    │
 * │ shorter report ⇒ the log gets its room back. In other words the layout    │
 * │ was making the user resize a window to read content — the same class as   │
 * │ the rule *"the system's own housekeeping must never land in the user's    │
 * │ hands"*.                                                                  │
 * │                                                                           │
 * │ ⚠ A `min-h` floor on the log is NOT ENOUGH. A floor only saves you while  │
 * │ the panel is tall enough; short, and the two fight again. It has to be    │
 * │ capped at the cause: the report is NOT allowed past a fixed fraction.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Three layers, and the order is deliberate:
 *
 *  1. **Folded to 3 lines by default.** The log keeps almost the whole height
 *     the moment the view opens — that is what people open this view to read.
 *  2. **Expanded, it is capped at 40%.** 60% is left for the log even with the
 *     longest report. Scrolling happens INSIDE this block.
 *  3. The button says **"Collapse"/"Expand"**, not an arrow — the user has to
 *     know whether they are about to lose room or gain it.
 *
 * `Markdown` rather than raw text: the report is written by the assistant and it
 * has bullets, paths, sometimes a table — exactly like a chat message.
 */
function Report({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex max-h-[40%] flex-none flex-col border-t border-line">
      <div className="flex flex-none items-center gap-2 px-4 pt-2.5">
        <span className="text-xs font-medium text-muted">{t('plans.report')}</span>
        <span className="flex-1" />
        <button
          className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t('plans.collapse') : t('plans.expand')}
        </button>
      </div>
      {/*
        Folded, it uses a HEIGHT CEILING, not `line-clamp`.

        `line-clamp` runs on `-webkit-box` and is only trustworthy for ONE flow of
        text. The report goes through `Markdown`, so inside it are several block
        elements (paragraphs, task lists, sometimes a table) — and clamp then
        either cuts nothing or cuts somewhere nobody can predict. `max-h` is
        deterministic whatever the structure inside.
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
 * A job's TOKEN TABLE. → docs/SPEC-token-economy.md §5
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY IT HAS TO BE SHOWN, AND WHY THE MODEL MUST NOT BE TOLD                │
 * │                                                                           │
 * │ `SPEC-token-economy.md` §5 calls the "unexpected cache write" warning the │
 * │ PRIMARY alarm, and says it plainly: this is a bug the user will NOT spot  │
 * │ on their own without this line. Yet until now it existed nowhere in the   │
 * │ interface — the numbers were already sitting in every `task.done` event   │
 * │ and in the log file, nobody had drawn them. Showing them costs 0 tokens.  │
 * │                                                                           │
 * │ And it has to be THE CODE'S JOB, never the model's. Three reasons:        │
 * │  1. An employee can do nothing with that number — it does not change how  │
 * │     it works because it learns it just wrote 13K of cache.                │
 * │  2. Telling the model means putting the number in the prompt, i.e. paying │
 * │     on EVERY turn to tell a story that only means anything to a watcher.  │
 * │  3. `CORE_PROMPT` already bans technical jargon in `say`. Accounting is   │
 * │     the job of whoever is counting from outside, not of whoever is        │
 * │     working.                                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * How to read this table (exercise 1 of TEST-WALKTHROUGH): look at the **cache
 * write** column — the FIRST task of each role is large, the ones after it are
 * small. That is the cache priming gate working. All of them large means the gate
 * is broken and every task is paying full price for the prefix.
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

  // The same role writing cache several times within ONE run = something is
  // breaking the prefix mid-flight (a version bump, edited skills, a model
  // change). This is the primary alarm line.
  const writesByRole = new Map<string, number>();
  for (const e of rows) {
    if (e.usage.cacheWrite > 2000) writesByRole.set(e.role, (writesByRole.get(e.role) ?? 0) + 1);
  }
  const noisy = [...writesByRole.entries()].filter(([, n]) => n > 1);

  return (
    <details className="flex-none border-b border-line px-4 py-2">
      <summary className="cursor-pointer list-none text-xs text-muted marker:hidden">
        {t('plans.tokenLabel')} <span className="tabular-nums text-ink">{kilo(total.read)}</span>{' '}
        {t('plans.cacheRead')} · <span className="tabular-nums text-ink">{kilo(total.write)}</span>{' '}
        {t('plans.cacheWrite')} · <span className="tabular-nums text-ink">{total.turns}</span>{' '}
        {t('plans.turns')}
        {noisy.length > 0 && <span className="ml-1.5 text-danger">{t('plans.cacheChurnBadge')}</span>}
        <span className="float-right">{t('plans.details')}</span>
      </summary>

      <table className="mt-2 w-full text-[12px]">
        <thead>
          <tr className="text-muted">
            <th className="pb-1 text-left font-normal">{t('plans.colJob')}</th>
            <th className="pb-1 text-right font-normal">{t('plans.cacheRead')}</th>
            <th className="pb-1 text-right font-normal">{t('plans.cacheWrite')}</th>
            <th className="pb-1 text-right font-normal">{t('plans.turns')}</th>
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
                {formatUSD(e.usage.costUSD)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {noisy.length > 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-danger">
          {t('plans.churnWarn', { roles: noisy.map(([r]) => labelFor(r)).join(', ') })}
        </p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {t('plans.churnOkBefore')} <b>{t('plans.churnOkBold')}</b> {t('plans.churnOkAfter')}
        </p>
      )}
    </details>
  );
}

/**
 * Fold CONSECUTIVE identical lines into one, with a count.
 *
 * A turn with several tools running in parallel arrives from the SDK as several
 * separate messages, so four simultaneous `Grep` calls show four identical lines
 * in the same second. Four lines say nothing that one does not, and they push the
 * rest of the log off the screen.
 *
 * Only ADJACENT lines from the SAME speaker fold: folding lines far apart would
 * hide an employee repeating exactly one action at two different moments — and
 * that is the signal it is flailing, which is the thing we need to see.
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
 * One log line. The colour is hashed from the role id — the same formula as the
 * canvas nodes, so the eye joins "whose line is this" to "which node is lit".
 */
function LogLine({ event, times = 1 }: { event: AgentEvent; times?: number }) {
  // The colour is hashed from `id` (stable), the label is the name the user gave
  // (readable). The two come from different sources ON PURPOSE — renaming must
  // not change the colour, because the eye has already tied colour to person.
  const who = 'role' in event ? (event as { role: string }).role : 'assistant';
  const hue = agentHue(who);
  const time = event.ts ? formatTimeOfDay(new Date(event.ts)) : '';
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

/** Every user-facing event carries a `say` — this is where that invariant pays. */
function describe(e: AgentEvent): string {
  switch (e.type) {
    case 'plan.created':
      return plural('plans.eventPlanned', e.steps.length);
    case 'plan.step':
      return '';
    // Deliberately renders nothing: the closing sentence already went out as a
    // `master.message` immediately before. Showing it again puts two identical
    // lines next to each other.
    case 'plan.finished':
      return '';
    case 'task.started':
    case 'task.progress':
      return e.say;
    case 'task.done':
      return `${e.say}${e.artifacts.length ? ` → ${e.artifacts.join(', ')}` : ''}  ·  ${plural('plans.turnCount', e.usage.turns)} · ${formatUSD(e.usage.costUSD)}`;
    case 'task.blocked':
      return `⚠ ${e.say} (${e.reason})`;
    case 'master.message':
      return e.say;
    case 'office.state':
      return e.say;
    case 'cost.tick':
      return `${t('plans.totalPrefix')} ${plural('plans.jobCount', e.totals.tasks)} · ${plural('plans.turnCount', e.totals.turns)} · ${formatUSD(e.totals.costUSD)}`;
    default:
      return '';
  }
}
