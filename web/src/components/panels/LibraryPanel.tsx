import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, RefreshCw, Trash2, Upload } from 'lucide-react';

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
import { api, ApiError } from '@/lib/api';
import { actions, toast, useApp } from '@/lib/store';
import type { DocState, LibraryDoc } from '@/lib/types';
import { plural, t } from '@i18n';
import { formatBytes } from '@i18n/fmt';

/**
 * The library — files THE USER puts in. → docs/SPEC-library.md
 *
 * It differs from the Knowledge drawer at the point that matters most, and the
 * interface has to be able to say it: knowledge is what the system HAS LEARNED
 * (editable/deletable, not addable); the library is what the user HAS BROUGHT IN
 * (addable/deletable, not editable).
 *
 * No editor, and that is a decision rather than an omission — editing a .docx in
 * a textarea destroys it. To edit, edit outside and drop it back over the top.
 */
export function LibraryPanel() {
  const officeId = useApp((s) => s.officeId);
  // Text extraction runs IN THE BACKGROUND and takes seconds on a thick PDF.
  // Without following this number, the "reading…" line sits frozen until the user
  // reopens the drawer themselves — the screen goes quiet exactly when they most
  // need to know.
  const libraryVersion = useApp((s) => s.libraryVersion);
  // How many documents are being extracted. This is the RIGHT home for the number
  // — it is state of the drawer, not of the conversation. See `AppState.libraryBusy`.
  const libraryBusy = useApp((s) => s.libraryBusy);
  // Files just dropped on the Library node in the canvas. The canvas only hands
  // them over — the whole upload flow lives here, in exactly ONE copy.
  const pendingDocs = useApp((s) => s.pendingDocs);
  const [docs, setDocs] = useState<LibraryDoc[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmDel, setConfirmDel] = useState<LibraryDoc | null>(null);
  const [askReplace, setAskReplace] = useState<File[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    if (!officeId) return;
    api
      .library(officeId)
      .then((r) => setDocs(r.docs))
      .catch((err) => {
        toast(err instanceof Error ? err.message : t('library.loadFailed'));
        setDocs([]);
      });
  }, [officeId]);

  useEffect(reload, [reload, libraryVersion]);

  useEffect(() => {
    if (!pendingDocs || !officeId) return;
    void upload(actions.takeDroppedDocs());
    // `upload` is rebuilt on every render but only reads `officeId`; putting it in
    // the deps would re-run the effect on every render and upload in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDocs, officeId]);

  async function upload(files: File[], replace = false) {
    if (!officeId || files.length === 0) return;
    setBusy(true);
    const clash: File[] = [];
    try {
      for (const file of files) {
        try {
          const r = await api.uploadDoc(officeId, file, replace);
          setDocs(r.docs);
        } catch (err) {
          // 409 = name clash. This is a QUESTION, not an error — collect them and
          // ask once for the whole batch, rather than firing five dialogs in a row.
          if (err instanceof ApiError && err.status === 409) clash.push(file);
          else toast(`${file.name}: ${err instanceof Error ? err.message : t('library.uploadFailed')}`);
        }
      }
    } finally {
      setBusy(false);
      if (clash.length > 0) setAskReplace(clash);
    }
  }

  async function remove(doc: LibraryDoc) {
    if (!officeId) return;
    try {
      const r = await api.removeDoc(officeId, doc.name);
      setDocs(r.docs);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('library.deleteFailed'));
    } finally {
      setConfirmDel(null);
    }
  }

  /**
   * Re-extract a document that is not usable yet. → SPEC-library.md §4.5
   *
   * NO confirmation: unlike `remove`, this loses nothing — the original is
   * untouched, only the text copy is rebuilt. Confirming an action with no
   * consequence teaches the user to click "OK" without reading, and then they
   * click exactly the same way on the delete dialog.
   */
  async function reextract(doc: LibraryDoc) {
    if (!officeId) return;
    setBusy(true);
    try {
      const r = await api.libraryReextract(officeId, doc.name);
      setDocs(r.docs);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('library.reextractFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (docs === null) return <div className="px-4 py-6 text-[13px] text-muted">{t('common.reading')}</div>;

  return (
    <div
      className={`flex h-full flex-col ${dragging ? 'bg-accent-soft/40' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload([...e.dataTransfer.files]);
      }}
    >
      <div className="flex-none border-b border-line p-3">
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <Button variant="primary" className="w-full" disabled={busy} onClick={() => fileInput.current?.click()}>
          <Upload className="h-4 w-4" />
          {busy ? t('library.uploading') : t('library.add')}
        </Button>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {t('library.dropHint1')} <b>pdf · md · txt · csv · json · yaml</b>
          {t('library.dropHint2')} <b>docx · xlsx · pptx</b> {t('library.dropHint3')}
        </p>
        {/*
          Extraction runs in the background. This line sits AT THE TOP OF THE
          DRAWER, not in the chat box: what is happening to documents belongs
          next to the documents. And it disappears when `libraryBusy` hits 0 —
          the previous version shared the chat status line and then had no way
          to switch itself off.
        */}
        {libraryBusy > 0 && (
          <p className="mt-2 rounded bg-accent-soft px-2 py-1.5 text-xs leading-relaxed text-accent">
            {plural('library.extracting', libraryBusy)}
          </p>
        )}
      </div>

      {docs.length === 0 ? (
        <Empty
          icon={<FolderOpen className="h-7 w-7" />}
          title={t('library.emptyTitle')}
          hint={t('library.emptyHint')}
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {docs.map((d) => (
            <li key={d.name} className="border-b border-line px-4 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] leading-snug text-ink" title={d.name}>
                    {d.name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <StateChip state={d.state} />
                    <span>{d.shape ?? d.ext}</span>
                    <span>·</span>
                    <span className="tabular-nums">{formatBytes(d.bytes)}</span>
                    {d.tokens ? (
                      <>
                        <span>·</span>
                        {/* This number is for THE USER, to see how long the
                            document is; it never enters a model's prompt. Token
                            accounting is done by whoever is counting from outside. */}
                        <span className="tabular-nums">
                          {t('library.tokensApprox', { n: formatTokens(d.tokens) })}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-none gap-1">
                  {/* The FULL path, not `d.name`: the library and the Artifacts
                      drawer are allowed to hold files of the same name.
                      → ui/misc.tsx `CopyRef` */}
                  <CopyRef path={`library/files/${d.name}`} />
                  {/*
                    RE-EXTRACT — shown only while a document is NOT usable.
                    The state is a record of the past, while the cause is fixable
                    (install another reader, bump a version). Without this button
                    the only way to retry is to delete and drop your own file back
                    in — a frightening move, and the user may no longer have the
                    original. → SPEC-library.md §4.5
                  */}
                  {d.state !== 'ready' && d.state !== 'pending' && d.state !== 'extracting' && (
                    <button
                      className="rounded p-1.5 text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink disabled:opacity-40"
                      disabled={busy}
                      onClick={() => void reextract(d)}
                      aria-label={t('library.reextract', { name: d.name })}
                      title={t('library.reextractTip')}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  )}
                  <a
                    href={officeId ? api.docUrl(officeId, d.name) : '#'}
                    download={d.name}
                    className="rounded p-1.5 text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink"
                    aria-label={t('library.download', { name: d.name })}
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  <button
                    className="rounded p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                    onClick={() => setConfirmDel(d)}
                    aria-label={t('library.delete', { name: d.name })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/*
                The explanation shown when a document is NOT ready.
                The danger-soft background is for real errors only: "scanned" and
                "not indexed" are information, not breakage — painting them red
                teaches the user to ignore red.
              */}
              {d.note && (
                <p
                  className={`mt-1.5 rounded px-2 py-1.5 text-xs leading-relaxed ${
                    d.state === 'failed' ? 'bg-danger-soft text-danger' : 'bg-line/50 text-muted'
                  }`}
                  role={d.state === 'failed' ? 'alert' : undefined}
                >
                  {d.note}
                </p>
              )}
              {d.state === 'ready' && d.preview && (
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{d.preview}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {/*
        The mirror of the footer in the Knowledge drawer. Each drawer says WHAT
        IT IS and points at the other — the cheapest way to keep the two concepts
        from merging, and it costs 0 tokens because it lives entirely in the UI.
      */}
      {docs.length > 0 && (
        <div className="flex-none border-t border-line px-4 py-2.5 text-xs leading-relaxed text-muted">
          {t('library.footerBefore')} <b>{t('library.footerBold')}</b>
          {t('library.footerAfter')}
        </div>
      )}

      {/* The file name lives INSIDE the question, not somewhere behind the dialog:
          for a permanent delete, the user must be able to read exactly what is
          about to disappear. Enter = Delete — see the note on `ConfirmDelete`. */}
      <ConfirmDelete
        open={!!confirmDel}
        title={t('library.confirmDeleteTitle')}
        onCancel={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && void remove(confirmDel)}
      >
        <b>{confirmDel?.name}</b> {t('library.confirmDeleteBody')}
      </ConfirmDelete>

      <Dialog open={!!askReplace} onOpenChange={(o) => !o && setAskReplace(null)}>
        <DialogContent className="w-[min(30rem,94vw)]">
          <DialogHeader>
            <DialogTitle>{t('library.clashTitle')}</DialogTitle>
            <DialogDescription>
              {t('library.clashBody', { names: askReplace?.map((f) => f.name).join(', ') ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAskReplace(null)}>{t('library.keepOld')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const files = askReplace ?? [];
                setAskReplace(null);
                void upload(files, true);
              }}
            >
              {t('library.replace')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The state chip. `ready` gets NO chip — the normal state needs no announcement. */
function StateChip({ state }: { state: DocState }) {
  if (state === 'ready') return null;
  const map: Record<Exclude<DocState, 'ready'>, { text: string; cls: string }> = {
    pending: { text: t('library.state.pending'), cls: 'bg-line/70 text-ink' },
    extracting: { text: t('library.state.extracting'), cls: 'bg-accent-soft text-accent' },
    'image-only': { text: t('library.state.imageOnly'), cls: 'bg-warn-soft text-warn' },
    unindexed: { text: t('library.state.unindexed'), cls: 'bg-warn-soft text-warn' },
    failed: { text: t('library.state.failed'), cls: 'bg-danger-soft text-danger' },
  };
  const s = map[state];
  return <span className={`rounded px-1.5 font-medium ${s.cls}`}>{s.text}</span>;
}

/**
 * Rounded to `12K` past a thousand, and NOT localised.
 *
 * This is a rough scale for a human — "is this document long?" — not an amount
 * anyone adds up, so digit grouping would only make it look more precise than
 * it is. Exact counts go through `formatNumber`.
 */
function formatTokens(n: number): string {
  return n < 1000 ? String(n) : `${Math.round(n / 1000)}K`;
}
