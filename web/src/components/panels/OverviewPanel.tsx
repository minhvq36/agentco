import { useEffect, useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, Building2, ChevronDown, FolderOpen, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input, Label, SectionTitle, Select, Tip } from '@/components/ui/misc';
import type { ArchivedAgent, InstalledArm, OAuthAccount } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { actions, toast, useApp } from '@/lib/store';
import { plural, t } from '@i18n';
import { formatUSD } from '@i18n/fmt';

interface CostRow {
  office: string;
  name: string;
  tasks: number;
  costUSD: number;
  turns: number;
  archived: boolean;
  gone: boolean;
}

/** The whole COMPANY at a glance: the offices, and the money — the one thing shared. */
export function OverviewPanel() {
  const company = useApp((s) => s.company);
  const officeId = useApp((s) => s.officeId);
  const [cost, setCost] = useState<CostRow[] | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);

  const loadCost = () =>
    api
      .cost()
      .then((c) => setCost(c.byOffice))
      .catch(() => setCost([]));

  useEffect(() => {
    void loadCost();
  }, [officeId]);

  const live = company?.offices.filter((o) => !o.archived) ?? [];
  const archived = company?.offices.filter((o) => o.archived) ?? [];

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-4 py-4">
      <section>
        <SectionTitle className="mb-2">{t('overview.offices')}</SectionTitle>
        <ul className="flex flex-col gap-1">
          {live.map((o) => (
            <li
              key={o.id}
              className={`group flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[13px] ${
                o.id === officeId ? 'border-accent bg-accent-soft/40' : 'border-line'
              }`}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => void actions.openOffice(o.id)}
              >
                <span>{o.avatar}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{o.name}</span>
                  <span className="block text-xs text-muted">
                    {o.error ? (
                      <span className="text-danger">{o.error}</span>
                    ) : (
                      `${o.onDuty}/${plural('overview.onDutyCount', o.agents)} · ${plural('knowledge.noteCount', o.knowledge)}`
                    )}
                  </span>
                </span>
              </button>
              {/*
                OPEN FOLDER — the way out of "an office id does not follow its
                name". → src/cli/daemonfile.ts §openFolder

                `id` is the directory name and deliberately does not change when
                the display name does, so someone who renames "Reports" to
                "Inventory" goes looking for an `inventory/` that is not there.
                With a non-Latin name it is worse: the directory is called
                `vp-ee6fd8`. This button removes the need to know the name at all.
              */}
              <Tip label={t('overview.folderTip', { id: o.id })}>
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label={t('overview.folderAria', { name: o.name })}
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={async () => {
                    const r = await api.revealOffice(o.id).catch(() => null);
                    if (!r) return;
                    /*
                      Over a remote connection (VPS, Docker) the server opens
                      nothing ON PURPOSE — that window would pop up on the host,
                      not on the machine you are looking at. Copying the path to
                      the clipboard is the thing that actually helps there, and
                      the message has to say why.
                    */
                    if (r.opened) return toast(t('overview.opened', { dir: r.dir }));
                    void navigator.clipboard?.writeText(r.dir).catch(() => undefined);
                    toast(t('overview.remoteCopied', { dir: r.dir }));
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </Tip>
              <Tip label={t('overview.archiveTip')}>
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label={t('overview.archiveAria', { name: o.name })}
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => void actions.archiveOffice(o.id, true)}
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              </Tip>
              <Tip label={t('overview.deleteTip')}>
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label={t('overview.deleteOfficeAria', { name: o.name })}
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => setConfirm({ id: o.id, name: o.name })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </Tip>
            </li>
          ))}
        </ul>
        {live.length === 0 && (
          <div className="flex items-center gap-2 py-2 text-[13px] text-muted">
            <Building2 className="h-4 w-4" /> {t('overview.noOffices')}
          </div>
        )}
      </section>

      {archived.length > 0 && (
        <section>
          <SectionTitle className="mb-2">{t('overview.archived')}</SectionTitle>
          <ul className="flex flex-col gap-1">
            {archived.map((o) => (
              <li
                key={o.id}
                className="flex items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-2 text-[13px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-muted">{o.name}</span>
                  <span className="block text-xs text-muted">
                    {plural('overview.employeeCount', o.agents)} ·{' '}
                    {plural('knowledge.noteCount', o.knowledge)} · {t('overview.readOnly')}
                  </span>
                </span>
                <Button size="sm" onClick={() => void actions.archiveOffice(o.id, false)}>
                  <ArchiveRestore className="h-3.5 w-3.5" />
                  {t('overview.restore')}
                </Button>
                {/* Deleting for good has to be reachable FROM INSIDE the
                    archive. Without this button, clearing one out means
                    restoring it first — two steps for one intent, and the middle
                    step puts the very thing you want gone back into the working
                    list. */}
                <Tip label={t('overview.deleteTip')}>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    aria-label={t('overview.deleteOfficeAria', { name: o.name })}
                    onClick={() => setConfirm({ id: o.id, name: o.name })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </Tip>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ArchivedAgentsSection />

      <section>
        <SectionTitle className="mb-2">{t('overview.costTitle')}</SectionTitle>
        {cost === null ? (
          <div className="text-[13px] text-muted">{t('common.reading')}</div>
        ) : cost.length === 0 ? (
          <div className="text-[13px] text-muted">{t('overview.noCost')}</div>
        ) : (
          <CostTable rows={cost} onPurged={() => void loadCost()} />
        )}
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {t('overview.turnsNoteBefore')} <b>{t('overview.turnsNoteBold')}</b>{' '}
          {t('overview.turnsNoteAfter')}
        </p>
      </section>

      {/* Below Cost, and folded away (the user's call, 02/09): these are two
          sections for TIDYING UP when needed, not something read every day. Left
          open they push the very thing people come here for — the money — off
          the bottom of the screen. */}
      <ConnectionsSection />

      <ModelsSection />

      <RemoveOfficeDialog target={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/**
 * CONNECTIONS + LINKED ACCOUNTS — the management door at the level the data
 * actually lives at.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUG THE USER REPORTED 02/09: *"the Acme Team's Notion connection cannot  │
 * │ be removed"* (then Linear, then GitHub — the same trap each time).       │
 * │                                                                          │
 * │ Deletion runs down a chain, and each lock sits behind the very door it   │
 * │ is locking:                                                              │
 * │                                                                          │
 * │   workspace ←blocked by─ arm ←blocked by─ office                         │
 * │   `oauthForget`          `forgetArm`      way in: the canvas Toolbar     │
 * │                                                                          │
 * │ Those two guards are RIGHT — they stop you leaving a silently dead arm.  │
 * │ What was wrong is that **the door to the next step lived inside the      │
 * │ thing just deleted**: 0 offices ⇒ 0 canvas ⇒ 0 Toolbar ⇒ no route left   │
 * │ to the shared ledger, even though that data belongs to the COMPANY and   │
 * │ to no office.                                                            │
 * │                                                                          │
 * │ The fix is NOT "deleting an office also clears its connections" — that   │
 * │ breaks the very sharing that makes them useful (delete office A, cut     │
 * │ office B's wire) and turns one delete button into two behaviours         │
 * │ depending on how many offices happen to be left. The data stays where it │
 * │ is; what was fixed is the DOOR. → SPEC-arms.md §6k                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `ArmDialog` is still where you **plug something in**. This section is where
 * you **look and tidy** — two different intents, and the second must not depend
 * on there being an office.
 */
/**
 * Access level → the word for it.
 *
 * The same three words were spelled out in three places before this
 * (`ArmDialog`, here, and a ternary in `Inspector`), so a fourth level or a
 * reworded one would have had to be found in three files. One catalogue region
 * now owns them: `inspector.level.*`.
 */
function levelSay(level: string): string {
  if (level === 'read') return t('inspector.level.read');
  if (level === 'add') return t('inspector.level.add');
  if (level === 'full') return t('inspector.level.full');
  return level;
}

function ConnectionsSection() {
  const company = useApp((s) => s.company);
  const [arms, setArms] = useState<InstalledArm[] | null>(null);
  const [accounts, setAccounts] = useState<OAuthAccount[] | null>(null);
  /** Waiting on a delete confirmation — the one step with no undo, so it asks. */
  const [dropArm, setDropArm] = useState<InstalledArm | null>(null);
  const [dropAcc, setDropAcc] = useState<OAuthAccount | null>(null);

  /*
    Reload on `company`: deleting an office orphans arms, and the `orphan` flag
    is what decides whether the 🗑 button appears at all. Not listening to it
    means the user deletes an office and still reads "in use" until they hit F5.
  */
  useEffect(() => {
    void api.arms().then((r) => setArms(r.arms)).catch(() => setArms([]));
    void api.oauthAccounts().then((r) => setAccounts(r.accounts)).catch(() => setAccounts([]));
  }, [company]);

  async function forgetArm(a: InstalledArm) {
    if (await actions.forgetArm(a.id)) {
      toast(t('overview.armForgotten', { label: a.label }));
      const r = await api.arms().catch(() => null);
      if (r) setArms(r.arms);
    }
  }

  async function forgetAccount(acc: OAuthAccount) {
    const name = acc.label ?? acc.name;
    if (await actions.forgetAccount(acc.name)) {
      toast(t('overview.accountForgotten', { name }));
      const [a, b] = await Promise.all([
        api.arms().catch(() => null),
        api.oauthAccounts().catch(() => null),
      ]);
      if (a) setArms(a.arms);
      if (b) setAccounts(b.accounts);
    }
  }

  const officeName = (id: string) => company?.offices.find((o) => o.id === id)?.name ?? id;

  if (arms !== null && arms.length === 0 && accounts !== null && accounts.length === 0) return null;

  return (
    <>
      {arms !== null && arms.length > 0 && (
        <Fold title={t('overview.connections')} count={arms.length}>
          <ul className="flex flex-col gap-1">
            {arms.map((a) => {
              // "In use" has two meanings, exactly as `armHolders` on the server
              // has them: there is a wire, OR it sits on a diagram unwired.
              // Collapsing the two shows a delete button for a node that is on
              // somebody's diagram right now.
              const wired = [...new Set(a.usedBy.map((u) => officeName(u.office)))];
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[13px]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{a.label}</span>
                    <span className="block truncate text-xs text-muted">
                      {a.via ? `${a.via} · ` : ''}
                      {plural('inspector.toolCount', a.toolCount)}
                      {a.level ? ` · ${levelSay(a.level)}` : ''}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {wired.length
                        ? t('overview.usedBy', { who: wired.join(', ') })
                        : a.orphan
                          ? t('overview.unused')
                          : t('overview.onCanvasNotWired')}
                    </span>
                  </span>
                  {a.orphan && (
                    <Tip label={t('overview.dropArmTip')}>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        aria-label={t('overview.dropArmAria', { label: a.label })}
                        onClick={() => setDropArm(a)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </Tip>
                  )}
                </li>
              );
            })}
          </ul>
        </Fold>
      )}

      {accounts !== null && accounts.length > 0 && (
        <Fold title={t('overview.accounts')} count={accounts.length}>
          <ul className="flex flex-col gap-1">
            {accounts.map((acc) => (
              <li
                key={acc.name}
                className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[13px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{acc.label ?? acc.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {acc.dead ? (
                      <span className="text-danger">{t('overview.keyDead')}</span>
                    ) : acc.usedBy.length ? (
                      t('overview.usedBy', { who: acc.usedBy.join(', ') })
                    ) : (
                      t('overview.accountUnused')
                    )}
                  </span>
                </span>
                {/*
                  Dimmed, not hidden, and the tooltip NAMES the connection
                  holding it: this is the exact spot the user got stuck on 02/09,
                  so the explanation has to point at the next step instead of
                  only saying "no".
                */}
                <Tip
                  label={
                    acc.usedBy.length
                      ? t('overview.accountBlockedTip', {
                          n: acc.usedBy.length,
                          who: acc.usedBy.join(', '),
                        })
                      : t('overview.accountDropTip')
                  }
                >
                  <span>
                    <Button
                      size="iconSm"
                      variant="ghost"
                      disabled={acc.usedBy.length > 0}
                      aria-label={t('overview.accountDropAria', { label: acc.label ?? acc.name })}
                      onClick={() => setDropAcc(acc)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </Tip>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {/*
        Ask with the app's own MODAL, not `window.confirm`. (the user's call,
        02/09)

        The browser dialog locks the whole tab, carries no formatting, and looks
        nothing like the rest of the product — while the CREATE dialog is already
        a modal. Asking and creating are two ends of the same action; two
        different shapes means the user learns it twice.

        The **"THE KEY IS KEPT"** clause is bold rather than a footnote: it is
        what makes this decision cheap, and unsaid it leaves the user believing
        they are about to lose a token, so nobody dares press the button — a
        button that might as well not exist.
      */}
      <Dialog open={!!dropArm} onOpenChange={(o) => !o && setDropArm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('overview.dropArmTitle', { label: dropArm?.label ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t('overview.dropArmBody1')} <b>{t('overview.dropArmBodyBold')}</b>{' '}
              {t('overview.dropArmBody2')}
              <br />
              <b>{t('overview.dropArmKeepBold')}</b> {t('overview.dropArmKeepAfter')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDropArm(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (dropArm) void forgetArm(dropArm);
                setDropArm(null);
              }}
            >
              {t('inspector.deleteForGood')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dropAcc} onOpenChange={(o) => !o && setDropAcc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('overview.dropAccTitle', { label: dropAcc?.label ?? dropAcc?.name ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t('overview.dropAccBody1')} <b>{t('overview.dropAccBodyBold')}</b>{' '}
              {t('overview.dropAccBody2')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDropAcc(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (dropAcc) void forgetAccount(dropAcc);
                setDropAcc(null);
              }}
            >
              {t('overview.drop')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A FOLDABLE section for the Overview panel. (the user's call, 02/09)
 *
 * Same `<details>` shape as the "N entries gone" block in the cost table, so the
 * two foldables in one panel open with one gesture. The count sits in the title:
 * once closed, it is the only thing still saying what is inside.
 *
 * CLOSED by default — this is a panel for tidying when needed, not something
 * read every day, and three connection entries left open push Cost off the
 * bottom of the screen.
 */
function Fold({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="group">
      <summary className="mb-2 flex cursor-pointer list-none items-center gap-1.5 marker:hidden">
        <ChevronDown className="h-3.5 w-3.5 text-muted transition-transform group-open:rotate-180" />
        <SectionTitle>
          {title} <span className="tabular-nums">({count})</span>
        </SectionTitle>
      </summary>
      {children}
    </details>
  );
}

/**
 * The cost table. Offices that NO LONGER EXIST are gathered into one foldable
 * block.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ COLLAPSE THE DISPLAY, NEVER THE DATA.                                    │
 * │                                                                          │
 * │ Without the fold, a few months in the table is full of dead names. But   │
 * │ adding them into ONE "deleted · $X" row loses the office id — and for an │
 * │ office that is gone for good, that id is the ONLY clue left about what   │
 * │ the money was spent on.                                                  │
 * │                                                                          │
 * │ So: fold to a single total row, click to expand the real rows, unchanged.│
 * │ The list stops growing, nothing becomes less transparent, and it takes   │
 * │ no accounting code at all — it is a `<details>`.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Since 02/09 this block also carries a BROOM. `removeOffice` now closes the
 * ledger itself, so the block only collects debris from before that fix — but
 * old debris still needs a way out, and that way must not be "open
 * `usage.jsonl` and edit it by hand".
 */
function CostTable({ rows, onPurged }: { rows: CostRow[]; onPurged: () => void }) {
  const live = rows.filter((r) => !r.gone);
  const gone = rows.filter((r) => r.gone);
  const goneTotal = gone.reduce((n, r) => n + r.costUSD, 0);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);

  async function purge() {
    setBusy(true);
    try {
      const r = await api.purgeGoneCost();
      toast(t('overview.purged', { n: r.offices, cost: formatUSD(r.costUSD) }));
      onPurged();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('overview.purgeFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <table className="w-full text-[13px]">
        <tbody>
          {live.map((c) => (
            <CostRowView key={c.office} row={c} />
          ))}
        </tbody>
      </table>

      {gone.length > 0 && (
        <details className="mt-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5">
          {/* "entries", not "offices": this block holds both offices deleted for
              good AND records from before offices were a concept. Calling the
              lot "deleted offices" is right for most rows and wrong for the
              rest — and a cost ledger is not allowed one wrong sentence. */}
          <summary className="cursor-pointer list-none text-[13px] text-muted marker:hidden">
            <span className="tabular-nums">{gone.length}</span> {t('overview.goneEntries')}{' '}
            <span className="tabular-nums">{formatUSD(goneTotal)}</span>
            <span className="float-right text-xs">{t('overview.tapToSee')}</span>
          </summary>
          <table className="mt-1.5 w-full text-[13px]">
            <tbody>
              {gone.map((c) => (
                <CostRowView key={c.office} row={c} />
              ))}
            </tbody>
          </table>
          {/* The button sits at the BOTTOM of the expanded block on purpose: to
              press it you have to open the block, which means you have already
              seen the exact rows about to go. Same rule as "Delete all" in the
              Artifacts panel — know what you are losing BEFORE you press. */}
          <div className="mt-2 flex items-center justify-end">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsk(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              {busy ? t('overview.purging') : t('overview.purgeAll')}
            </Button>
          </div>
        </details>
      )}

      <Dialog open={ask} onOpenChange={setAsk}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('overview.purgeTitle', { n: gone.length })}</DialogTitle>
            <DialogDescription>
              {plural('plans.jobCount', gone.reduce((n, r) => n + r.tasks, 0))} ·{' '}
              {formatUSD(goneTotal)} {t('overview.purgeBodyMid')}{' '}
              <b>{t('overview.purgeBodyBold')}</b>.
              <br />
              {t('overview.purgeUntouchedBefore')} <b>{t('overview.purgeUntouchedBold')}</b>{' '}
              {t('overview.purgeUntouchedAfter')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAsk(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setAsk(false);
                void purge();
              }}
            >
              {t('overview.purgeAll')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CostRowView({ row }: { row: CostRow }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-1.5 pr-2 text-ink">
        {row.name}
        {row.archived && (
          <span className="ml-1.5 text-xs text-muted">{t('overview.archivedSuffix')}</span>
        )}
      </td>
      <td className="py-1.5 text-right tabular-nums text-muted">
        {plural('plans.jobCount', row.tasks)}
      </td>
      <td className="py-1.5 pl-2 text-right tabular-nums text-muted">
        {plural('plans.turnCount', row.turns)}
      </td>
      <td className="py-1.5 pl-2 text-right tabular-nums text-ink">{formatUSD(row.costUSD)}</td>
    </tr>
  );
}

/**
 * Employees in the archive of the office CURRENTLY OPEN.
 *
 * Restore one and they come back to the same office — because they never left.
 * `roles/<id>.yaml` does not move at all; an `archived` flag is removed.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE OFFICE NAME HAS TO BE VISIBLE, EVEN THOUGH EVERY ROW IS ONE OFFICE.  │
 * │                                                                          │
 * │ This block lives in the **company Overview** — a screen where everything │
 * │ else speaks about the WHOLE company (the office list, the cost ledger,   │
 * │ the shared models). An "Archived employees" section dropped in there     │
 * │ reads as company-wide, and the user presses "Bring back" and then goes   │
 * │ hunting for that person across a pile of offices.                        │
 * │                                                                          │
 * │ The label is not there to tell rows apart — they are all the same        │
 * │ office. It answers the question the user is actually asking: **"if I     │
 * │ press this, where does that person show up?"** So it belongs in the      │
 * │ section TITLE, read before the click, not sprinkled over every row.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function ArchivedAgentsSection() {
  const officeId = useApp((s) => s.officeId);
  const canvas = useApp((s) => s.canvas);
  const office = useApp((s) => s.company?.offices.find((o) => o.id === s.officeId));
  const [agents, setAgents] = useState<ArchivedAgent[]>([]);
  const [confirm, setConfirm] = useState<ArchivedAgent | null>(null);

  // Re-read whenever the canvas changes: archiving or restoring someone changes
  // the canvas, so this list can never drift from the diagram.
  useEffect(() => {
    if (!officeId) return setAgents([]);
    api
      .archivedAgents(officeId)
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]));
  }, [officeId, canvas]);

  if (agents.length === 0) return null;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <SectionTitle>{t('overview.archivedAgents')}</SectionTitle>
        {office && (
          <span className="flex min-w-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
            <span className="flex-none">{office.avatar}</span>
            <span className="truncate">{office.name}</span>
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {agents.map((a) => (
          <li
            key={a.role}
            className="flex items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-2 text-[13px]"
          >
            <span>{a.avatar}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-muted">{a.label}</span>
              <span className="block truncate text-xs text-muted">
                {a.notes > 0 ? plural('overview.lessonNotesKept', a.notes) : a.pitch}
              </span>
            </span>
            <Tip
              label={
                office
                  ? t('overview.restoreTipOffice', { name: office.name })
                  : t('overview.restoreTip')
              }
            >
              <Button size="sm" onClick={() => void actions.archiveAgent(a.role, false)}>
                <ArchiveRestore className="h-3.5 w-3.5" />
                {t('overview.bringBack')}
              </Button>
            </Tip>
            <Tip label={t('overview.deleteRoleTip')}>
              <Button
                size="iconSm"
                variant="ghost"
                aria-label={t('overview.deleteAgentAria', { label: a.label })}
                onClick={() => setConfirm(a)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </Tip>
          </li>
        ))}
      </ul>

      {/*
        This sentence is about the SEAT, because that is the real worry behind
        "Bring back": the user is afraid the person reappears somewhere they
        cannot find. Archiving REMOVES the node from the layout
        (`layout.dropAgent`), so on the way back it gets the first free slot like
        a new hire — even if somebody has taken the old seat.
        → test/layout.test.ts "archive then bring back"
      */}
      <p className="mt-2 text-xs leading-relaxed text-muted">
        {t('overview.bringBackNoteBefore')} <b>{office?.name ?? t('overview.thisOffice')}</b>{' '}
        {t('overview.bringBackNoteMid')} <b>{t('overview.bringBackNoteBold')}</b>{' '}
        {t('overview.bringBackNoteAfter')}
      </p>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('inspector.confirmDeleteAgentTitle', { label: confirm?.label ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t('inspector.agentDeleteBefore')} <code>roles/{confirm?.role}.yaml</code>{' '}
              {t('inspector.agentDeleteMid')} <b>{t('inspector.agentDeleteBold')}</b>
              <br />
              <br />
              {confirm && confirm.notes > 0 ? (
                <>
                  <b>{plural('overview.lessonNotes', confirm.notes)}</b> {t('overview.atPath')}{' '}
                  <code>knowledge/agents/{confirm.role}/</code> {t('inspector.agentNotesAfter')}
                </>
              ) : (
                <>
                  {t('inspector.agentNotesBefore')}{' '}
                  <code>knowledge/agents/{confirm?.role}/</code> {t('overview.notesKeptShort')}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm) void actions.removeAgent(confirm.role).then(() => setAgents((a) => a.filter((x) => x.role !== confirm.role)));
                setConfirm(null);
              }}
            >
              {t('inspector.deleteForGood')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * Which tier runs which model — COMPANY-level configuration.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY HERE AND NOT INSIDE EACH OFFICE                                      │
 * │                                                                          │
 * │ This is the question "what does a standard-tier job cost" — that is      │
 * │ MONEY, and money has one Claude bill and one place to tighten it. "Which │
 * │ tier does this office's assistant run at" is a question about WORK, so   │
 * │ it lives per office (the right-hand panel, select the assistant node).   │
 * │ Two different questions, two different places.                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function ModelsSection() {
  const models = useApp((s) => s.company?.models);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (models) setDraft({ ...models });
  }, [models]);

  if (!models) return null;

  const dirty = (['eco', 'standard', 'deep', 'master', 'planner'] as const).some(
    (k) => draft[k] !== undefined && draft[k] !== models[k],
  );

  return (
    <section>
      <SectionTitle className="mb-2">{t('overview.modelsTitle')}</SectionTitle>

      {!open ? (
        <>
          <table className="w-full text-[13px]">
            <tbody>
              {(['eco', 'standard', 'deep'] as const).map((tier) => (
                <tr key={tier} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-2 text-ink">{tier}</td>
                  <td className="py-1.5 text-right font-mono text-[11.5px] text-muted">
                    {models[tier]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="mt-2 text-[13px] text-accent hover:underline"
            onClick={() => setOpen(true)}
          >
            {t('inspector.changeModel')}
          </button>
        </>
      ) : (
        <div className="rounded-lg border border-line p-3">
          {(['eco', 'standard', 'deep'] as const).map((tier) => (
            <div key={tier} className="mb-3">
              <Label htmlFor={`m-${tier}`}>{tier}</Label>
              <Input
                id={`m-${tier}`}
                className="font-mono text-[12px]"
                value={draft[tier] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [tier]: e.target.value }))}
              />
            </div>
          ))}

          <Label htmlFor="m-master">{t('overview.masterTier')}</Label>
          <Select
            id="m-master"
            className="mb-3 w-full"
            value={draft.master ?? models.master}
            onChange={(e) => setDraft((d) => ({ ...d, master: e.target.value }))}
          >
            <option value="eco">eco</option>
            <option value="standard">standard</option>
            <option value="deep">deep</option>
          </Select>

          <Label htmlFor="m-planner">{t('overview.plannerTier')}</Label>
          <Select
            id="m-planner"
            className="w-full"
            value={draft.planner ?? models.planner}
            onChange={(e) => setDraft((d) => ({ ...d, planner: e.target.value }))}
          >
            <option value="eco">eco</option>
            <option value="standard">standard</option>
            <option value="deep">deep</option>
          </Select>

          <p className="mt-3 text-xs leading-relaxed text-muted">
            {t('overview.modelNamesBefore')}
            <code>claude-sonnet-5</code>, <code>claude-haiku-4-5-20251001</code>
            {t('overview.modelNamesAfter')}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {t('overview.modelsWideBefore')} <b>{t('overview.modelsWideBold')}</b>
            {t('overview.modelsWideAfter')}
          </p>

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setDraft({ ...models });
                setOpen(false);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!dirty || busy}
              onClick={async () => {
                setBusy(true);
                const ok = await actions.updateModels(draft);
                setBusy(false);
                if (ok) setOpen(false);
              }}
            >
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function RemoveOfficeDialog({
  target,
  onClose,
}: {
  target: { id: string; name: string } | null;
  onClose(): void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('overview.removeOfficeTitle', { name: target?.name ?? '' })}</DialogTitle>
          <DialogDescription>
            {t('overview.removeOfficeBefore')} <code>offices/{target?.id}/</code>
            {t('overview.removeOfficeAfter')} <b>{t('inspector.agentDeleteBold')}</b>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (target) void actions.removeOffice(target.id);
              onClose();
            }}
          >
            {t('inspector.deleteForGood')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
