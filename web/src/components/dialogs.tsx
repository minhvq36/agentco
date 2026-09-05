import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Lock, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { actions, toast, useApp } from '@/lib/store';
import type { PromptLayer } from '@/lib/types';
import { plural, t } from '@i18n';

export function NewOfficeDialog({ open, onOpenChange }: { open: boolean; onOpenChange(v: boolean): void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const ok = await actions.createOffice(name.trim());
    setBusy(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t('dialog.newOffice.title')}</DialogTitle>
          </DialogHeader>

          <Label htmlFor="office-name">{t('dialog.newOffice.name')}</Label>
          <Input
            id="office-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('dialog.newOffice.placeholder')}
          />

          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
              {busy ? t('common.creating') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rename the open office.
 *
 * The office ID (the folder name) does NOT follow, and the dialog says so
 * outright. Changing the ID means moving `artifacts/`, `tasks/`, `.state/` and
 * every path already written into old receipts — to change one label. People
 * rename because the label reads wrong, not because they want to move house;
 * silently moving the whole folder is doing more than they asked for.
 */
export function RenameOfficeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
}) {
  const officeId = useApp((s) => s.officeId);
  const current = useApp((s) => s.company?.offices.find((o) => o.id === s.officeId)?.name ?? '');
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setName(current);
  }, [open, current]);

  const trimmed = name.replace(/\s+/g, ' ').trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || busy) return;
    if (trimmed === current) return onOpenChange(false);
    setBusy(true);
    // A name clash is refused by the SERVER, not the client: another client
    // POSTing straight at the daemon must still be blocked. All we do here is
    // show the sentence the server sent back.
    const ok = await actions.renameOffice(trimmed);
    setBusy(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t('dialog.renameOffice.title')}</DialogTitle>
            <DialogDescription>
              {t('dialog.renameOffice.descBefore')} <code>{officeId}</code>{' '}
              {t('dialog.renameOffice.descAfter')}
            </DialogDescription>
          </DialogHeader>

          <Label htmlFor="rename-office">{t('dialog.renameOffice.newName')}</Label>
          <Input
            id="rename-office"
            autoFocus
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">{t('dialog.renameOffice.unique')}</p>

          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!trimmed || busy}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange(v: boolean): void }) {
  const [name, setName] = useState('');
  const [pitch, setPitch] = useState('');
  const [tier, setTier] = useState('standard');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setPitch('');
      setTier('standard');
    }
  }, [open]);

  /**
   * ┌──────────────────────────────────────────────────────────────────────┐
   * │ BOTH FIELDS, NOT JUST THE NAME. (user 05/09)                         │
   * │                                                                      │
   * │ Typing a name and pressing Enter used to create a worker whose        │
   * │ description was our own placeholder sentence, written in whatever     │
   * │ interface language was selected at that instant. Two costs: the       │
   * │ Assistant routes on `pitch`, and that sentence says nothing about     │
   * │ what the person does — so they were never given work, invisibly; and  │
   * │ our text became their data inside every cached prompt.                │
   * │                                                                      │
   * │ ⚠ NOT a new restriction — the detail panel has always refused an      │
   * │ empty description (`updateRole` → `off.pitchEmpty`), and              │
   * │ `RoleSchema` declares `min(1)`. This door was the one exception, and  │
   * │ it papered over the gap instead of showing it.                       │
   * │                                                                      │
   * │ ⚠ The placeholder and the tip below stay exactly as they were: that   │
   * │ is where advice belongs — read, adopted deliberately, zero tokens     │
   * │ until it is. What changes is only that it never becomes their data    │
   * │ on its own. → `office.ts §addAgent`                                   │
   * └──────────────────────────────────────────────────────────────────────┘
   */
  const ready = Boolean(name.trim() && pitch.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const ok = await actions.addAgent({ display_name: name.trim(), pitch: pitch.trim(), tier });
    setBusy(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t('dialog.newAgent.title')}</DialogTitle>
          </DialogHeader>

          <Label htmlFor="agent-name">{t('dialog.newAgent.name')}</Label>
          <Input
            id="agent-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('dialog.newAgent.namePlaceholder')}
          />

          <Label htmlFor="agent-pitch" className="mt-3">
            {t('dialog.newAgent.pitch')}
          </Label>
          <Textarea
            id="agent-pitch"
            rows={3}
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            placeholder={t('dialog.newAgent.pitchPlaceholder')}
          />
          <p className="mt-1 text-xs text-muted">{t('dialog.newAgent.pitchTip')}</p>

          <Label htmlFor="agent-tier" className="mt-3">
            {t('dialog.newAgent.tier')}
          </Label>
          <Select id="agent-tier" className="w-full" value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="standard">{t('dialog.newAgent.tierStandard')}</option>
            <option value="eco">{t('dialog.newAgent.tierEco')}</option>
            <option value="deep">{t('dialog.newAgent.tierDeep')}</option>
          </Select>

          {/*
            NO explanation of `Bash` here any more (user, 02/09 — the app is all
            text as it is). The *Allow commands on this machine* switch in the
            detail panel is still where that capability is spelled out, and it
            sits right next to the actual switch.
            → SPEC-tools-approval.md §1b, §8
          */}
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!ready || busy}>
              {busy ? t('common.creating') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One prompt layer. An `editable` layer can be edited IN PLACE.
 * → docs/SPEC-offices.md §4.1
 *
 * The core layer is ALWAYS VISIBLE, locked by default. Hide it and advanced
 * users guess, and when they guess wrong they write skills that fight the system.
 *
 * NO autosave — an explicit Save button. Every save bumps the cacheKey → pays for
 * one cache write. Autosaving per keystroke here is continuous cache churn:
 * expensive and slow. → docs/SPEC-ui.md §2.2, SPEC-tools-approval.md §4
 */
function LayerCard({
  layer,
  who,
  affected,
  onSaved,
}: {
  layer: PromptLayer;
  who: string;
  affected: number;
  onSaved(next: PromptLayer[]): void;
}) {
  const officeId = useApp((s) => s.officeId);
  /**
   * COLLAPSED BY DEFAULT, title only. (user, 02/09)
   *
   * Expanding all five layers at once turns the dialog into a wall of text that
   * people scroll past instead of reading. Title + token count is enough to pick
   * the layer worth opening; the body only means something once you have picked.
   *
   * `editing` DRAGS open with it: editing a collapsed block means not seeing what
   * you type.
   */
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(layer.text);
  const [busy, setBusy] = useState(false);
  const show = open || editing;

  useEffect(() => {
    setText(layer.text);
    setEditing(false);
  }, [layer.text, layer.id]);

  // Estimated with the backend's formula (tokens.ts) so the number does not jump on save.
  const tokens = editing ? Math.ceil(text.length / 3.2) : layer.tokens;
  const over = layer.limit !== undefined && tokens > layer.limit;
  const dirty = text !== layer.text;

  async function save() {
    if (!officeId) return;
    setBusy(true);
    try {
      const res = await api.savePromptLayer(officeId, who, layer.id, text);
      onSaved(res.layers);
      setEditing(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line">
      {/*
        The whole bar is the click target. A `div` + `role="button"` rather than a
        `<button>`: the pencil button lives INSIDE it, and a button nested in a
        button is invalid HTML — the browser un-nests it and the click then lands
        somewhere nobody can predict.
      */}
      <header
        role="button"
        tabIndex={0}
        aria-expanded={show}
        className={`flex cursor-pointer select-none items-center gap-2 px-3 py-2 ${show ? 'border-b border-line' : ''}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${show ? '' : '-rotate-90'}`}
        />
        {layer.editable ? (
          <Pencil className="h-3.5 w-3.5 shrink-0 text-ok" />
        ) : (
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted" />
        )}
        <span className="text-[13px] font-medium text-ink">{layer.title}</span>
        <span className="text-xs text-muted">
          {layer.editable ? t('promptLayer.editable') : t('promptLayer.readOnly')}
        </span>
        <div className="flex-1" />
        <span className={`text-xs tabular-nums ${over ? 'text-danger' : 'text-muted'}`}>
          {layer.limit !== undefined
            ? plural('promptLayer.tokensOfLimit', tokens, { limit: layer.limit })
            : plural('promptLayer.tokens', tokens)}
        </span>
        {layer.editable && !editing && (
          <Button
            size="iconSm"
            variant="ghost"
            aria-label={t('promptLayer.edit', { title: layer.title })}
            // The pencil = OPEN AND EDIT AT ONCE, in one click. `stopPropagation`
            // keeps it off the bar's toggle, which would collapse it right back.
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </header>

      <div className={`px-3 py-2 ${show ? '' : 'hidden'}`}>
        <p className="mb-2 text-xs leading-relaxed text-muted">{layer.note}</p>
        {layer.file && (
          <p className="mb-2 text-xs text-muted">
            {t('promptLayer.fileLabel')} <code className="text-ink">{layer.file}</code>
          </p>
        )}

        {editing ? (
          <>
            {/*
              The placeholder is a REAL EXAMPLE, not an instruction saying "write
              something here". A file's default content goes straight into the
              prefix cache of every call, so a line of guidance inside it is a tax
              levied forever to tell THE MODEL a sentence that only means something
              to A PERSON. Guidance belongs here — in the interface, at 0 tokens.
            */}
            <Textarea
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="font-mono text-[11.5px] leading-relaxed"
              placeholder={layer.placeholder ?? t('promptLayer.emptyPlaceholder')}
            />
            {over && (
              <p className="mt-1.5 text-xs text-danger">
                {t('promptLayer.overLimit', { limit: layer.limit ?? 0 })}
              </p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {plural('promptLayer.affected', affected)}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setText(layer.text);
                  setEditing(false);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button size="sm" variant="primary" disabled={!dirty || over || busy} onClick={() => void save()}>
                {busy ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </>
        ) : layer.text ? (
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-paper p-2 text-[11.5px] leading-relaxed text-muted">
            {layer.text}
          </pre>
        ) : (
          /* A DESIGNED empty state, not the word "(empty)". An empty layer is a
             valid choice and often the RIGHT one — say so, then show a real
             example so the user can see the shape of what they would write. */
          <div className="rounded border border-dashed border-line bg-paper p-2">
            {layer.placeholder && layer.editable && (
              <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-muted opacity-60">
                {layer.placeholder}
              </pre>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function PromptDialog({ who, onClose }: { who: string | null; onClose(): void }) {
  const officeId = useApp((s) => s.officeId);
  /*
    Do NOT read `allowCorePromptEdit` here. `layer.editable` is computed by the
    server and ALREADY folds that flag in (`prompt.ts §PromptLayer.editable`), and
    `PUT` refuses core layers on its own. Keeping a copy on the client means two
    places speaking about the same permission — one of them gets forgotten the day
    the rule changes.
  */
  const agentCount = useApp((s) => s.canvas?.nodes.filter((n) => n.kind === 'agent').length ?? 0);
  const [layers, setLayers] = useState<PromptLayer[] | null>(null);
  // The charter sits in EVERY employee's prefix; skills belong to one person.
  const affected = who === 'assistant' ? Math.max(1, agentCount) : 1;

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 `onClose` MUST NOT be in the deps — bug reported by the user 02/09.   │
   * │                                                                          │
   * │ The caller passes an arrow rebuilt on every render (`onClose={() =>      │
   * │ setPromptFor(null)}`), so **every time App re-renders** the deps change  │
   * │ ⇒ the effect re-runs ⇒ `setLayers(null)` ⇒ the dialog flashes back to    │
   * │ "Reading…" and reloads. A user halfway through editing a layer loses     │
   * │ everything they had typed.                                               │
   * │                                                                          │
   * │ A visible symptom needs SOMETHING re-rendering App continuously, and on  │
   * │ 02/09 there was one: the `GET /library` loop (see `library/store.ts      │
   * │ §pump`). But that fix only silenced the generator — this cell still has  │
   * │ to be right, because `canvas` changing is perfectly normal (an employee  │
   * │ starts running, a node gets dragged…) and none of those may wipe out     │
   * │ what the user is typing.                                                 │
   * │                                                                          │
   * │ ⇒ The effect depends only on **what it actually reads**: whose prompt is │
   * │ open, in which office. `onClose` goes through a ref — it is the way OUT, │
   * │ not an input to the load.                                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!who || !officeId) return;
    setLayers(null);
    api
      .prompt(officeId, who)
      .then((r) => setLayers(r.layers))
      .catch((err) => {
        toast(err instanceof Error ? err.message : t('promptLayer.loadFailed'));
        closeRef.current();
      });
  }, [who, officeId]);

  return (
    <Dialog open={!!who} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(46rem,94vw)]">
        <DialogHeader>
          <DialogTitle>
            {t('promptLayer.title', { who: who === 'assistant' ? t('chat.assistant') : (who ?? '') })}
          </DialogTitle>
        </DialogHeader>

        <div className="-mx-1 max-h-[58vh] overflow-y-auto px-1">
          {layers === null ? (
            <div className="py-6 text-[13px] text-muted">{t('common.reading')}</div>
          ) : (
            <div className="flex flex-col gap-3">
              {layers.map((l) => (
                <LayerCard
                  key={l.id}
                  layer={l}
                  who={who!}
                  onSaved={(next) => setLayers(next)}
                  affected={affected}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
