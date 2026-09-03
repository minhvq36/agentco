import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Empty, Input, Textarea } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { agentInk, agentWash, agentHue } from '@/lib/colors';
import { actions, toast, useApp } from '@/lib/store';
import type { KnowledgeEntry } from '@/lib/types';
import { plural, t } from '@i18n';

/**
 * The knowledge drawer. Search runs on the index already on the client — 0 tokens.
 *
 * The two scopes render differently on purpose: `shared` is the store the whole
 * office reads, `role:<id>` is a private notebook only that agent reads. Mixing
 * them into one flat list erases the most important distinction in the store.
 */
export function KnowledgePanel() {
  const officeId = useApp((s) => s.officeId);
  // Follow the EVENT, not a count: editing a note does not change the number of
  // nodes, so the previous version sat still until someone pressed F5.
  const knowledgeVersion = useApp((s) => s.knowledgeVersion);
  const [nodes, setNodes] = useState<KnowledgeEntry[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<KnowledgeEntry | null>(null);

  useEffect(() => {
    if (!officeId) return;
    let alive = true;
    api
      .knowledge(officeId)
      .then((r) => alive && setNodes(r.nodes))
      .catch((err) => {
        toast(err instanceof Error ? err.message : t('knowledge.loadFailed'));
        if (alive) setNodes([]);
      });
    return () => {
      alive = false;
    };
  }, [officeId, knowledgeVersion]);

  const filtered = useMemo(() => {
    if (!nodes) return null;
    const term = q.trim().toLowerCase();
    if (!term) return nodes;
    return nodes.filter(
      (n) => n.title.toLowerCase().includes(term) || n.tags.some((t) => t.toLowerCase().includes(term)),
    );
  }, [nodes, q]);

  if (nodes === null) return <div className="px-4 py-6 text-[13px] text-muted">{t('common.reading')}</div>;

  if (nodes.length === 0) {
    return (
      // The empty state of the knowledge store is the ONE place a new user reads
      // carefully, so it has to answer the question that comes straight after:
      // "then where do my documents go?". Leave it unanswered and they go
      // hunting for an "add note" button that does not exist.
      <Empty
        icon={<BookOpen className="h-7 w-7" />}
        title={t('knowledge.emptyTitle')}
        hint={t('knowledge.emptyHint')}
        action={
          <Button onClick={() => actions.showPanel('library')}>{t('knowledge.toLibrary')}</Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b border-line p-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('knowledge.search')}
          aria-label={t('knowledge.searchLabel')}
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {filtered?.map((n) => {
          const own = n.scope.startsWith('role:') ? n.scope.slice(5) : null;
          const hue = own ? agentHue(own) : null;
          return (
            <li key={n.id} className={`border-b border-line ${n.superseded ? 'opacity-55' : ''}`}>
              <button
                className="w-full px-4 py-2.5 text-left transition-colors hover:bg-accent-soft/40"
                onClick={() => setOpen(n)}
              >
                <div className="text-[13.5px] leading-snug text-ink">{n.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {own ? (
                    <span
                      className="rounded px-1.5 font-medium"
                      style={{ color: agentInk(hue!), background: agentWash(hue!) }}
                    >
                      📒 {own}
                    </span>
                  ) : (
                    <span className="rounded bg-line/70 px-1.5 font-medium text-ink">
                      {t('knowledge.shared')}
                    </span>
                  )}
                  {n.pinned && <span className="text-warn">{t('knowledge.pinned')}</span>}
                  {/* Without this label three "Memory" notes look identical and
                      it reads as the system duplicating rubbish. */}
                  {n.superseded && <span className="text-warn">{t('knowledge.superseded')}</span>}
                  <span className="tabular-nums">{plural('knowledge.tokens', n.tokens)}</span>
                  <span>·</span>
                  <span className="tabular-nums">{plural('knowledge.hits', n.hits)}</span>
                </div>
              </button>
            </li>
          );
        })}
        {filtered?.length === 0 && (
          <li className="px-4 py-6 text-[13px] text-muted">{t('knowledge.noMatch', { q })}</li>
        )}
      </ul>

      {/*
        These two sentences moved here from the right-hand detail panel (17/08).
        They are facts about the STORE, not about a node on the diagram — and
        here they get read at the moment someone is looking at the store.

        The second one matters most: it separates the knowledge store from the
        document cabinet. Without it the two concepts merge, and people go
        looking for an "add note" button that does not exist.
      */}
      <div className="flex-none border-t border-line px-4 py-2.5 text-xs leading-relaxed text-muted">
        {t('knowledge.footerBefore')} <b>{t('knowledge.footerBold')}</b>
        {t('knowledge.footerAfter')}{' '}
        <button className="underline hover:text-ink" onClick={() => actions.showPanel('library')}>
          {t('knowledge.toLibraryInline')}
        </button>
        .
      </div>

      <NodeDialog
        node={open}
        onClose={() => setOpen(null)}
        onDone={(next) => {
          setNodes(next);
          setOpen(null);
        }}
      />
    </div>
  );
}

/**
 * View / edit / delete one note. One-to-one, and IMMEDIATE.
 *
 * This drawer used to be read-only, so correcting a wrong sentence inside an
 * employee's head meant opening that person's yaml file — something a
 * non-technical user cannot do, and the thing that made the knowledge store
 * look like a black box.
 *
 * After an edit: rescan the store, rebuild the assistant's context, and every
 * worker launched AFTERWARDS uses the new version. Workers already running keep
 * the old one — the same rule as changing a model.
 */
function NodeDialog({
  node,
  onClose,
  onDone,
}: {
  node: KnowledgeEntry | null;
  onClose(): void;
  onDone(nodes: KnowledgeEntry[]): void;
}) {
  const officeId = useApp((s) => s.officeId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    setText(node?.body ?? '');
    setConfirmDel(false);
  }, [node]);

  async function apply(remove: boolean) {
    if (!officeId || !node) return;
    setBusy(true);
    try {
      const r = await api.editKnowledge(officeId, node.id, remove ? { remove: true } : { body: text });
      onDone(r.nodes);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const own = node?.scope.startsWith('role:') ? node.scope.slice(5) : null;

  return (
    <Dialog open={!!node} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(40rem,94vw)]">
        <DialogHeader>
          <DialogTitle>{node?.title}</DialogTitle>
          <DialogDescription>
            {own ? (
              <>
                {t('knowledge.ownBefore')} <b>{own}</b> {t('knowledge.ownAfter')}
              </>
            ) : (
              <>
                {t('knowledge.sharedBefore')} <b>{t('knowledge.shared')}</b>{' '}
                {t('knowledge.sharedAfter')}
              </>
            )}{' '}
            <code>{node?.file}</code>
            {/*
              A superseded note is now DELETED OUTRIGHT the moment its
              replacement is written (`KnowledgeStore.dropSuperseded`), so this
              branch almost never runs — it survives as a net for files a user
              edited by hand.

              The old sentence here advertised *"the file is still around for you
              to read back"*. Removed: end users do NOT read old compactions
              back. What they got instead was a drawer full of duplicates plus a
              paragraph about an internal mechanism they never needed — charging
              them attention for a feature only a developer uses.
            */}
            {node?.superseded && (
              <>
                <br />
                <br />
                <b className="text-warn">{t('knowledge.supersededTitle')}</b>{' '}
                {t('knowledge.supersededBody')}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <Textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="font-mono text-[11.5px] leading-relaxed"
        />
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {t('knowledge.editNoteBefore')} <b>{t('knowledge.editNoteBold')}</b>
          {t('knowledge.editNoteAfter')}
        </p>

        <DialogFooter>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          {confirmDel ? (
            <Button variant="danger" disabled={busy} onClick={() => void apply(true)}>
              {busy ? t('common.deleting') : t('knowledge.confirmDelete')}
            </Button>
          ) : (
            <Button variant="danger" disabled={busy} onClick={() => setConfirmDel(true)}>
              <Trash2 className="h-4 w-4" />
              {t('knowledge.delete')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={busy || text.trim() === (node?.body ?? '').trim()}
            onClick={() => void apply(false)}
          >
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
