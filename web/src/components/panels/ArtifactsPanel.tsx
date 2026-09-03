import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileCheck2, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmDelete } from '@/components/ui/confirm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CopyRef, Empty } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { Markdown } from '@/lib/markdown';
import { actions, toast, useApp } from '@/lib/store';
import type { ArtifactRecord, ArtifactView } from '@/lib/types';
import { plural, t } from '@i18n';
import { formatBytes, formatDate, formatStamp, formatTime } from '@i18n/fmt';

/**
 * The files EMPLOYEES produce. → docs/SPEC-artifacts.md
 *
 * The tab is labelled "Results" in both languages (`sidebar.artifacts`), never
 * "Artifacts" or "Deliverables", for a concrete reason: the assistant ALREADY
 * says *"Results saved at: …"* after every run (`off.resultsSavedAt`), so that is
 * the word the product has taught. Coining a second name for the same thing
 * invents a third confusable concept — there are already two (the knowledge store
 * and the library).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VIEW · DOWNLOAD · DELETE. NO EDITING, AND NO "SEND TO AN EMPLOYEE".      │
 * │                                                                          │
 * │ No editing: the same reason as the library — an editor here would be a   │
 * │ second write door onto the very file an employee is writing.             │
 * │                                                                          │
 * │ No way back in: if this panel could feed an artifact back as an input it │
 * │ becomes a second library — two stores meaning the same thing, two        │
 * │ lifecycle rules, and a user guessing which one a file belongs in. To     │
 * │ reuse something, hand it over by hand: paste the content into the chat,  │
 * │ or drop it into the library.                                             │
 * │                                                                          │
 * │ ⚠ Not to be confused with what STILL WORKS and is unchanged: inside ONE  │
 * │ multi-step plan, a later task reads an earlier task's artifact through   │
 * │ `inputs`. That is a wire inside one job, not a store to fetch from.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function ArtifactsPanel() {
  const officeId = useApp((s) => s.officeId);
  const artifactsVersion = useApp((s) => s.artifactsVersion);
  // Read to KNOW a new request arrived; the value itself comes from
  // `takeRevealArtifact()`. Clicking the same path twice still has to reopen it,
  // and the value does not change — so the effect depends on this cell itself
  // rather than on its contents.
  const revealRequest = useApp((s) => s.revealArtifact);
  const [items, setItems] = useState<ArtifactRecord[] | null>(null);
  /**
   * THE REAL TOTAL, kept separate from `items.length`. → `api.artifacts`
   *
   * The server only sends the newest 500 files. If the number at the top of the
   * panel came from `items.length` it would say "500" while the button beside it
   * deletes 712 — and the entire reason that number is there is to tell the user
   * how much they are about to lose.
   */
  const [total, setTotal] = useState(0);
  const [confirmDel, setConfirmDel] = useState<ArtifactRecord | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [open, setOpen] = useState<ArtifactRecord | null>(null);

  const reload = useCallback(() => {
    if (!officeId) return;
    api
      .artifacts(officeId)
      .then((r) => {
        setItems(r.artifacts);
        setTotal(r.total);
      })
      .catch((err) => {
        toast(err instanceof Error ? err.message : t('artifacts.loadFailed'));
        setItems([]);
        setTotal(0);
      });
  }, [officeId]);

  useEffect(reload, [reload, artifactsVersion]);

  /**
   * Open an artifact directly because the user just clicked its path in the chat.
   * → docs/SPEC-artifacts.md §2.5
   *
   * Wait for `items` to load before acting: the request arrives at the same
   * moment the panel opens, when the list is still `null` — acting immediately
   * always means "not found".
   *
   * ⚠ NOT finding it has to be SAID. The file may have been deleted after the
   * message was sent, and that is normal — but a click that causes nothing at all
   * tells the user only that it is "broken", and they click again. This sentence
   * separates "deleted" from "the app is frozen".
   */
  useEffect(() => {
    if (items === null) return;
    const want = actions.takeRevealArtifact();
    if (!want) return;
    const found = items.find((a) => a.path === want);
    if (found) setOpen(found);
    else toast(t('artifacts.gone', { name: want.split('/').pop() ?? want }));
  }, [items, revealRequest]);

  /**
   * Group by PLAN, not by `task_id`.
   *
   * `T-01` is a position within one plan and every plan starts at 1, so grouping
   * on it tips eight different runs into one basket — exactly what is sitting on
   * disk in offices that ran before 19/08.
   */
  const groups = useMemo(() => {
    if (!items) return null;
    const out = new Map<string, ArtifactRecord[]>();
    for (const a of items) {
      const key = a.plan_id || LEGACY;
      const list = out.get(key) ?? [];
      list.push(a);
      out.set(key, list);
    }
    return [...out.entries()];
  }, [items]);

  async function remove(a: ArtifactRecord) {
    if (!officeId) return;
    try {
      const r = await api.removeArtifact(officeId, a.path);
      setItems(r.artifacts);
      setTotal(r.total);
      if (open?.path === a.path) setOpen(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('artifacts.deleteFailed'));
    } finally {
      setConfirmDel(null);
    }
  }

  async function removeAll() {
    if (!officeId) return;
    try {
      const r = await api.clearArtifacts(officeId);
      setItems(r.artifacts);
      setTotal(r.total);
      setOpen(null);
      // If anything is left, SAY SO. `removeAll` sweeps until clean, but a file
      // that is locked (Word has it open) stays — staying quiet here leaves the
      // user believing the panel is empty when it is not.
      toast(
        r.total > 0
          ? plural('artifacts.removedWithLeft', r.removed, { total: r.total })
          : plural('artifacts.removed', r.removed),
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : t('artifacts.deleteFailed'));
    } finally {
      setConfirmAll(false);
    }
  }

  if (items === null || groups === null) {
    return <div className="px-4 py-6 text-[13px] text-muted">{t('common.reading')}</div>;
  }

  if (items.length === 0) {
    return (
      <Empty
        icon={<FileCheck2 className="h-7 w-7" />}
        title={t('artifacts.emptyTitle')}
        hint={t('artifacts.emptyHint')}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/*
        ┌──────────────────────────────────────────────────────────────────────┐
        │ DELETE ALL — a DANGEROUS button, so it must LOOK dangerous and be     │
        │ COUNTABLE.                                                            │
        │                                                                       │
        │ The number sits on the bar itself ("12 artifacts"), not only in the   │
        │ confirmation: the user needs to know how much they are about to lose  │
        │ BEFORE the click, not after. A confirmation read with the hand        │
        │ already committed mostly gets an Enter.                               │
        │                                                                       │
        │ No `variant="primary"`: a panel's primary button should be the thing  │
        │ the user does every day, and here that is READING an artifact.        │
        └──────────────────────────────────────────────────────────────────────┘
      */}
      <div className="flex flex-none items-center justify-between gap-2 border-b border-line px-4 py-2">
        {/*
          Over the cap, swap the whole sentence — do NOT bolt a fragment onto the
          old one: the total size of 500 files printed next to the number 712 is a
          wrong number standing beside a right one. Better to say less.
        */}
        <span className="text-xs text-muted">
          {total > items.length
            ? plural('artifacts.countCapped', total, { shown: items.length })
            : plural('artifacts.countBytes', items.length, {
                size: formatBytes(items.reduce((n, a) => n + a.bytes, 0)),
              })}
        </span>
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-muted transition-colors hover:border-danger/50 hover:bg-danger-soft hover:text-danger"
          onClick={() => setConfirmAll(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('artifacts.deleteAll')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map(([planId, list]) => (
          <section key={planId}>
            <div className="sticky top-0 z-10 flex items-baseline gap-3 border-b border-line bg-panel px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              {/*
                The job title is TRUNCATED TO ONE LINE, with the full text in the
                tooltip. `request` is the assistant's REWRITE ("restate the
                request as one clear sentence with enough context"), so it can run
                long — let it wrap and the `sticky` header eats half the panel.
              */}
              <span className="min-w-0 flex-1 truncate normal-case" title={planTitle(planId, list)}>
                {planTitle(planId, list)}
              </span>
              {/*
                A FULL timestamp WITH SECONDS, only on the group header.

                The header is the anchor for "which run was this" — re-run the
                SAME request within a day and the seconds are the ONLY thing that
                tells the two groups apart. The file rows inside keep the short
                `when()`: they already sit under a known group, and repeating the
                date there is noise.
              */}
              {planId !== LEGACY && (
                <span className="flex-none tabular-nums font-normal">{stamp(newestOf(list).mtime)}</span>
              )}
            </div>
            <ul>
              {list.map((a) => (
                <li key={a.path} className="border-b border-line px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setOpen(a)}
                      title={a.path}
                    >
                      <div className="truncate text-[13.5px] leading-snug text-ink hover:text-accent">
                        {a.name}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span>{a.task_id}</span>
                        <span>·</span>
                        <span className="tabular-nums">{formatBytes(a.bytes)}</span>
                        <span>·</span>
                        <span className="tabular-nums">{when(a.mtime)}</span>
                        {a.view === 'download' && (
                          <>
                            <span>·</span>
                            {/* Say it BEFORE they click. Finding out "no preview"
                                only after clicking is a wasted click and a second
                                of confusion. */}
                            <span className="rounded bg-line/70 px-1.5">
                              {t('artifacts.downloadOnly')}
                            </span>
                          </>
                        )}
                      </div>
                    </button>
                    <div className="flex flex-none gap-1">
                      {/* `a.path` is already the full path relative to the office
                          directory — exactly the string the planner has to write
                          into `inputs`. */}
                      <CopyRef path={a.path} />
                      <a
                        href={officeId ? api.artifactUrl(officeId, a.path, true) : '#'}
                        download={a.name}
                        className="rounded p-1.5 text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink"
                        aria-label={t('artifacts.downloadFile', { name: a.name })}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                      <button
                        className="rounded p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                        onClick={() => setConfirmDel(a)}
                        aria-label={t('artifacts.delete', { name: a.name })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/*
        The mirror of the footers in the other two panels. Three stores are easy
        to confuse, so each one has to say WHAT IT IS — the cheapest defence
        against that confusion, and 0 tokens because it lives entirely in the UI.
      */}
      <div className="flex-none border-t border-line px-4 py-2.5 text-xs leading-relaxed text-muted">
        {t('artifacts.footerBefore')} <b>{t('artifacts.footerBold1')}</b>
        {t('artifacts.footerMid')} <b>{t('artifacts.footerBold2')}</b>.
      </div>

      <ViewerDialog item={open} officeId={officeId} onClose={() => setOpen(null)} />

      {/*
        Deliberately different wording from the library, and the difference has to
        be said out loud: a library document still has its original on the user's
        machine, but for an artifact THIS IS THE ONLY COPY — deleting it loses
        something that was paid for.

        Still `ConfirmDelete` (Enter = delete) even though the loss is heavier than
        in the library: the consequence still has a CEILING — run it again and it
        comes back, it only costs money — and this is the panel where files pile up
        into dozens within days, i.e. the one that most needs fast tidying. The
        line is drawn at "can it be rebuilt", not at "would it hurt".
      */}
      <ConfirmDelete
        open={!!confirmDel}
        title={t('artifacts.confirmDeleteTitle')}
        onCancel={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && void remove(confirmDel)}
      >
        <b>{confirmDel?.name}</b> {t('artifacts.confirmDeleteBody1')} <b>{t('artifacts.onlyCopy')}</b>{' '}
        {t('artifacts.confirmDeleteBody2')}
      </ConfirmDelete>

      {/*
        This one names a NUMBER, not "all". "All" is a word the reader fills in
        with a quantity they are guessing at; "37 files" cannot be guessed at.

        Say plainly that the OTHER two stores are untouched — that is the first
        question in a user's head when they read "delete all" in an app with three
        stores.
      */}
      <ConfirmDelete
        open={confirmAll}
        title={plural('artifacts.confirmAllTitle', total)}
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => void removeAll()}
      >
        {t('artifacts.confirmAllBefore')} <b>{plural('artifacts.fileCount', total)}</b>{' '}
        {t('artifacts.confirmAllMid')} <b>{t('artifacts.onlyCopy')}</b>{' '}
        {t('artifacts.confirmAllAfter')}
        <br />
        <span className="text-muted">
          {t('artifacts.untouchedBefore')} <b>{t('artifacts.untouchedBold')}</b>{' '}
          {t('artifacts.untouchedAfter')}
        </span>
      </ConfirmDelete>
    </div>
  );
}

const LEGACY = '__legacy__';

function newestOf(list: readonly ArtifactRecord[]): ArtifactRecord {
  return list.reduce((a, b) => (a.mtime > b.mtime ? a : b));
}

/**
 * The group label — THE REAL JOB NAME. Never the plan id.
 * → docs/SPEC-artifacts.md §2.1
 *
 * `plan_title` is looked up by the server from `tasks/index.json`. Empty falls
 * back to the old date-and-time label: a plan dropping off the ledger (a 200-row
 * cap) is normal in a long-running office, and an empty title is worse than a
 * vague one.
 */
function planTitle(planId: string, list: readonly ArtifactRecord[]): string {
  if (planId === LEGACY) return t('artifacts.legacyGroup');
  const named = list.find((a) => a.plan_title.trim());
  return named ? named.plan_title.trim() : t('artifacts.runAt', { when: when(newestOf(list).mtime) });
}

/** A FULL date and time with seconds — for group headers; see the note at the call site. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatStamp(d);
}

// ──────────────────────────────────────────────────────────────── preview

/**
 * The preview dialog.
 *
 * Three groups, and the line between them is a product decision:
 *
 *  · text (md · txt · csv · json · yaml · html) — `fetch` and render it
 *    ourselves. This is 100% of real artifacts today: employees only have
 *    `Write`/`Edit`, so text is all they can produce.
 *  · handled by the browser (images · pdf · video) — a few lines of native tags.
 *    No employee can produce these yet, but it is nearly free, so it is here.
 *  · office (docx · xlsx · pptx) — NO preview. `extract.ts` can unpack them with
 *    0 dependencies, so this is not about codebase weight: a text-extracted
 *    preview of a Word file is a LIE — the tables, the layout and the images are
 *    all gone — and the user is looking at it to decide whether to send it to a
 *    client.
 */
function ViewerDialog({
  item,
  officeId,
  onClose,
}: {
  item: ArtifactRecord | null;
  officeId: string | null;
  onClose(): void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsText = item ? TEXTY.has(item.view) : false;
  const url = item && officeId ? api.artifactUrl(officeId, item.path) : '';

  useEffect(() => {
    setText(null);
    setError(null);
    if (!item || !officeId || !needsText) return;
    let alive = true;
    fetch(url)
      .then(async (r) => {
        const body = await r.text();
        if (!alive) return;
        // The server answers 413 with an explanation when a file is too large to
        // preview — show that sentence rather than a slab of raw JSON.
        if (!r.ok) throw new Error(safeError(body) ?? t('artifacts.readFailedStatus', { status: r.status }));
        setText(body);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : t('artifacts.readFailed')));
    return () => {
      alive = false;
    };
  }, [item, officeId, needsText, url]);

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(56rem,95vw)]">
        <DialogHeader>
          <DialogTitle className="break-all">{item?.name}</DialogTitle>
          <DialogDescription>
            {item?.task_id} · {item ? formatBytes(item.bytes) : ''} · {item ? when(item.mtime) : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[64vh] min-h-[8rem] overflow-auto px-1">
          {error ? (
            <p className="rounded bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
              {error}
            </p>
          ) : !item ? null : item.view === 'download' ? (
            <Empty
              icon={<Download className="h-7 w-7" />}
              title={t('artifacts.nativeOnlyTitle')}
              hint={t('artifacts.nativeOnlyHint')}
            />
          ) : item.view === 'image' ? (
            <img src={url} alt={item.name} className="mx-auto max-h-[60vh] max-w-full object-contain" />
          ) : item.view === 'video' ? (
            <video src={url} controls className="mx-auto max-h-[60vh] max-w-full" />
          ) : item.view === 'pdf' ? (
            <object data={url} type="application/pdf" className="h-[60vh] w-full">
              <p className="p-3 text-[13px] text-muted">{t('artifacts.pdfFallback')}</p>
            </object>
          ) : text === null ? (
            <div className="py-6 text-[13px] text-muted">{t('common.reading')}</div>
          ) : item.view === 'csv' ? (
            <CsvTable text={text} sep={item.ext === 'tsv' ? '\t' : ','} />
          ) : item.view === 'markdown' ? (
            /*
              `.md` is 100% of real artifacts today (SPEC-artifacts §3: 14/14), so
              this is the screen the user looks at most before deciding whether to
              send something to a client. Rendering `**bold**` as two literal
              asterisks makes them translate markdown in their head to guess what
              the client will see.

              `variant="preview"` steps the heading sizes up once: this dialog is
              56rem wide, not a 330px chat bubble.
            */
            <div className="text-[13.5px] leading-relaxed text-ink">
              <Markdown text={text} variant="preview" />
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-ink">
              {text}
            </pre>
          )}
        </div>

        <DialogFooter>
          {item && officeId && (
            <a
              href={api.artifactUrl(officeId, item.path, true)}
              download={item.name}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-ink hover:bg-accent-soft/60"
            >
              <Download className="h-4 w-4" />
              {t('artifacts.downloadButton')}
            </a>
          )}
          <Button onClick={onClose}>
            <X className="h-4 w-4" />
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TEXTY = new Set<ArtifactView>(['text', 'markdown', 'csv', 'code']);

/**
 * A CSV table — a good-enough parser that does handle double quotes.
 *
 * No library for this: the table is only there to be LOOKED AT — no sorting, no
 * filtering, no editing. The one case this parser gets wrong is a newline inside
 * a quoted cell — rare, and the consequence is one ugly row, not one wrong
 * number.
 */
function CsvTable({ text, sep }: { text: string; sep: string }) {
  const rows = useMemo(() => {
    return text
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
      .slice(0, 500)
      .map((line) => splitRow(line, sep));
  }, [text, sep]);

  if (rows.length === 0) return <div className="py-6 text-[13px] text-muted">{t('artifacts.emptyFile')}</div>;
  const [head, ...body] = rows;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {/*
              ⚠ Call it "the first row", do NOT assert that it is a header. We can
              SEE what line one contains; we cannot see that it IS a header line.
              The same trap already stepped on in the library's INDEX.md.
            */}
            {(head ?? []).map((c, i) => (
              <th
                key={i}
                className="sticky top-0 border-b border-line bg-panel px-2 py-1.5 text-left font-semibold text-ink"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="even:bg-line/25">
              {r.map((c, j) => (
                <td key={j} className="border-b border-line/60 px-2 py-1 align-top text-ink">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length >= 500 && (
        <p className="px-2 py-2 text-xs text-muted">{t('artifacts.csvCapped')}</p>
      )}
    </div>
  );
}

function splitRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// ───────────────────────────────────────────────────────────── formatting

/** Today shows only the time — people open this panel right after a job finishes. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay ? formatTime(d) : formatDate(d);
}

function safeError(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}
